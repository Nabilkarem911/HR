const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

function requireCompanyScope(req, res) {
  if (req.user.role !== 'super_admin' && !req.user.company_id) {
    res.status(403).json({ error: 'Company scope is required' });
    return false;
  }
  return true;
}

async function getEmployeeCompany(employeeId) {
  return queryOne(
    `SELECT id, company_id FROM employees WHERE id = $1`,
    [employeeId]
  );
}

async function getAssetOwnership(assetId) {
  return queryOne(
    `SELECT a.id, a.employee_id, e.company_id
     FROM employee_assets a
     LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.id = $1`,
    [assetId]
  );
}

async function assertEmployeeAccess(req, res, employeeId) {
  if (!requireCompanyScope(req, res)) return null;
  const employee = await getEmployeeCompany(employeeId);
  if (!employee) {
    res.status(404).json({ error: 'Employee not found' });
    return null;
  }
  if (employee.company_id !== req.user.company_id) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return employee;
}

// ── GET /api/assets ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { company_id } = req.query;
    const clauses = [];
    const params = [];

    if (req.user.role !== 'super_admin') {
      clauses.push(`e.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (company_id) {
      clauses.push(`e.company_id = $${params.length + 1}`);
      params.push(company_id);
    }

    const whereClause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const baseFrom = ` FROM employee_assets a LEFT JOIN employees e ON a.employee_id = e.id`;
    const sql = `SELECT a.*, e.first_name, e.last_name, e.company_id${baseFrom}${whereClause} ORDER BY a.created_at DESC`;

    const { page, limit, offset } = paginate(req);
    const countRow = await queryOne(`SELECT COUNT(*) as count${baseFrom}${whereClause}`, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const data = rows.map(r => ({
      ...r,
      employees: { id: r.employee_id, first_name: r.first_name, last_name: r.last_name, company_id: r.company_id },
    }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/assets ──
router.post('/', rbacMiddleware('assets', 'add'), auditLog('assets'), async (req, res, next) => {
  try {
    const b = req.body;
    if (req.user.role !== 'super_admin' && !(await assertEmployeeAccess(req, res, b.employee_id))) return;
    const row = await queryOne(
      `INSERT INTO employee_assets (employee_id, asset_type, asset_name, serial_number, assigned_date, status) VALUES ($1,$2,$3,$4,$5,'assigned') RETURNING *`,
      [b.employee_id, b.asset_type, b.asset_name, b.serial_number || null, b.assigned_date]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/assets/:id ──
router.put('/:id', rbacMiddleware('assets', 'edit'), auditLog('assets'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      const b = req.body;
      const row = await queryOne(
        `UPDATE employee_assets SET status = $1, returned_date = $2 WHERE id = $3 RETURNING *`,
        [b.status, b.returned_date || null, req.params.id]
      );
      if (!row) return res.status(404).json({ error: 'Asset not found' });
      return res.json({ data: row });
    }

    if (!requireCompanyScope(req, res)) return;
    const asset = await getAssetOwnership(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!asset.company_id || asset.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    const row = await queryOne(
      `UPDATE employee_assets
       SET status = $1, returned_date = $2
       WHERE id = $3
         AND employee_id IN (SELECT id FROM employees WHERE company_id = $4)
       RETURNING *`,
      [b.status, b.returned_date || null, req.params.id, req.user.company_id]
    );
    if (!row) return res.status(404).json({ error: 'Asset not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/assets/:id ──
router.delete('/:id', rbacMiddleware('assets', 'delete'), auditLog('assets'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      await query(`DELETE FROM employee_assets WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'Asset deleted' });
    }

    if (!requireCompanyScope(req, res)) return;
    const asset = await getAssetOwnership(req.params.id);
    if (!asset) return res.json({ message: 'Asset deleted' });
    if (!asset.company_id || asset.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      `DELETE FROM employee_assets a
       USING employees e
       WHERE a.id = $1
         AND a.employee_id = e.id
         AND e.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
