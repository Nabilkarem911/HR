const express = require('express');
const bcrypt = require('bcryptjs');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { getEffectivePermissions, DEFAULT_PERMISSIONS } = require('../middleware/rbac');
const { validateBody, validateEnum } = require('../middleware/validate');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/users ──
router.get('/', rbacMiddleware('users', 'view'), async (req, res, next) => {
  try {
    const rows = await queryAll(
      `SELECT id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, created_at FROM system_users WHERE role != 'employee' ORDER BY created_at DESC`
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
    const row = await queryOne(
      `SELECT id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, created_at FROM system_users WHERE id = $1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── POST /api/users ──
router.post('/', rbacMiddleware('users', 'add'), validateBody(['email', 'full_name']), validateEnum('role', ['super_admin', 'hr_manager', 'branch_manager', 'viewer', 'employee']), auditLog('users'), async (req, res, next) => {
  try {
    const b = req.body;
    const passwordHash = bcrypt.hashSync(b.password || '123456', 10);
    const row = await queryOne(
      `INSERT INTO system_users (email, full_name, role, company_id, custom_permissions, phone, employee_profile_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, email, full_name, role, company_id, custom_permissions, phone, employee_profile_id`,
      [b.email, b.full_name, b.role || 'viewer', b.company_id || null, b.custom_permissions || {}, b.phone || null, b.employee_profile_id || null, passwordHash]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/users/:id ──
router.put('/:id', rbacMiddleware('users', 'edit'), auditLog('users'), async (req, res, next) => {
  try {
    const b = req.body;
    let passwordUpdate = '';
    let params = [b.email, b.full_name, b.role, b.company_id || null, b.custom_permissions || {}, b.phone || null, b.employee_profile_id || null];
    if (b.password) {
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
    await query(`DELETE FROM system_users WHERE id = $1`, [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
