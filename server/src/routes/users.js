const express = require('express');
const bcrypt = require('bcryptjs');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { getEffectivePermissions, DEFAULT_PERMISSIONS } = require('../middleware/rbac');
const { validateBody, validateEnum } = require('../middleware/validate');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

function requireCompanyScope(req, res) {
  if (req.user.role !== 'super_admin' && !req.user.company_id) {
    res.status(403).json({ error: 'Company scope is required' });
    return false;
  }
  return true;
}

async function getUserOwnership(userId) {
  return queryOne(
    `SELECT id, company_id FROM system_users WHERE id = $1`,
    [userId]
  );
}

async function assertEmployeeCompany(employeeProfileId, companyId, res) {
  if (!employeeProfileId) return true;
  const employee = await queryOne(
    `SELECT id, company_id FROM employees WHERE id = $1`,
    [employeeProfileId]
  );
  if (!employee) {
    res.status(404).json({ error: 'Employee not found' });
    return false;
  }
  if (employee.company_id !== companyId) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  return true;
}

// ── GET /api/users ──
router.get('/', rbacMiddleware('users', 'view'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { employee_profile_id } = req.query;
    if (employee_profile_id) {
      const scopeClause = req.user.role === 'super_admin' ? '' : ' AND company_id = $2';
      const params = req.user.role === 'super_admin'
        ? [employee_profile_id]
        : [employee_profile_id, req.user.company_id];
      const row = await queryOne(
        `SELECT id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, created_at
         FROM system_users
         WHERE employee_profile_id = $1 AND deleted_at IS NULL${scopeClause}`,
        params
      );
      return res.json({ data: row });
    }

    const scopeClause = req.user.role === 'super_admin' ? '' : ' AND company_id = $1';
    const params = req.user.role === 'super_admin' ? [] : [req.user.company_id];
    const rows = await queryAll(
      `SELECT id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, created_at
       FROM system_users
       WHERE role != 'employee' AND deleted_at IS NULL${scopeClause}
       ORDER BY created_at DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── GET /api/users/permissions/defaults ──
// MUST be before /:id to avoid conflict
router.get('/permissions/defaults', rbacMiddleware('users', 'view'), (req, res) => {
  res.json({ data: DEFAULT_PERMISSIONS });
});

// ── GET /api/users/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    // Allow users to fetch their own profile without users:view permission
    const isOwnProfile = req.user.id === req.params.id;
    if (!isOwnProfile && !req.user.hasPerm('users', 'view')) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    if (!isOwnProfile && !requireCompanyScope(req, res)) return;

    const ownershipClause = isOwnProfile ? '' : ' AND company_id = $2';
    const params = isOwnProfile
      ? [req.params.id]
      : [req.params.id, req.user.company_id];
    const row = await queryOne(
      `SELECT id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, created_at
       FROM system_users
       WHERE id = $1${ownershipClause}`,
      params
    );
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── POST /api/users ──
router.post('/', rbacMiddleware('users', 'add'), validateBody(['email', 'full_name']), validateEnum('role', ['super_admin', 'hr_manager', 'branch_manager', 'viewer', 'employee']), auditLog('users'), async (req, res, next) => {
  try {
    const b = req.body;
    const isSuperAdmin = req.user.role === 'super_admin';
    if (!isSuperAdmin) {
      if (!requireCompanyScope(req, res)) return;
      if (b.company_id && b.company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!(await assertEmployeeCompany(b.employee_profile_id, req.user.company_id, res))) return;
    }
    const companyId = isSuperAdmin ? b.company_id || null : req.user.company_id;
    let passwordHash = null;
    let plainPassword = null;
    if (b.plain_password) {
      plainPassword = b.plain_password;
    } else if (b.password) {
      passwordHash = bcrypt.hashSync(b.password, 10);
    }
    const row = await queryOne(
      `INSERT INTO system_users (email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, password_hash, plain_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id`,
      [b.email, b.full_name, b.role || 'viewer', companyId, b.custom_permissions || {}, b.phone || null, b.employee_profile_id || null, passwordHash, plainPassword]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/users/:id ──
router.put('/:id', rbacMiddleware('users', 'edit'), auditLog('users'), async (req, res, next) => {
  try {
    const b = req.body;
    const isSuperAdmin = req.user.role === 'super_admin';
    if (!isSuperAdmin) {
      if (!requireCompanyScope(req, res)) return;
      const targetUser = await getUserOwnership(req.params.id);
      const isOwnUser = req.user.id === req.params.id;
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      if (!isOwnUser && (!targetUser.company_id || targetUser.company_id !== req.user.company_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (b.company_id && b.company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!(await assertEmployeeCompany(b.employee_profile_id, req.user.company_id, res))) return;
    }

    let passwordUpdate = '';
    let params = [b.email, b.full_name, b.role, isSuperAdmin ? b.company_id || null : req.user.company_id, b.custom_permissions || {}, b.phone || null, b.employee_profile_id || null];
    if (b.plain_password) {
      passwordUpdate = `, plain_password = $8, password_hash = NULL`;
      params.push(b.plain_password);
    } else if (b.password) {
      const hash = bcrypt.hashSync(b.password, 10);
      passwordUpdate = `, password_hash = $8, plain_password = NULL`;
      params.push(hash);
    }
    params.push(req.params.id);
    const row = await queryOne(
      `UPDATE system_users SET email=$1, full_name=$2, role=$3, company_id=$4, custom_permissions=$5, phone=$6, employee_profile_id=$7${passwordUpdate} WHERE id=$${params.length} RETURNING id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id`,
      params
    );
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/users/:id ──
router.delete('/:id', rbacMiddleware('users', 'delete'), auditLog('users'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      await query(`UPDATE system_users SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'User archived' });
    }

    if (!requireCompanyScope(req, res)) return;
    const targetUser = await getUserOwnership(req.params.id);
    if (!targetUser) return res.json({ message: 'User archived' });
    if (!targetUser.company_id || targetUser.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      `UPDATE system_users SET deleted_at = NOW() WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    res.json({ message: 'User archived' });
  } catch (err) { next(err); }
});

module.exports = router;
