const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/assets ──
router.get('/', async (req, res, next) => {
  try {
    const { company_id } = req.query;
    let sql = `SELECT a.*, e.first_name, e.last_name, e.company_id FROM employee_assets a LEFT JOIN employees e ON a.employee_id = e.id ORDER BY a.created_at DESC`;
    let params = [];
    let where = false;

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql = `SELECT a.*, e.first_name, e.last_name, e.company_id FROM employee_assets a LEFT JOIN employees e ON a.employee_id = e.id WHERE e.company_id = $1 ORDER BY a.created_at DESC`;
      params = [req.user.company_id];
      where = true;
    }

    if (company_id) {
      if (where) {
        sql += ` AND e.company_id = $${params.length + 1}`;
      } else {
        sql = sql.replace('ORDER BY', `WHERE e.company_id = $1 ORDER BY`);
      }
      params.push(company_id);
    }

    const { page, limit, offset } = paginate(req);
    const countRow = await queryOne(`SELECT COUNT(*) as count FROM employee_assets a LEFT JOIN employees e ON a.employee_id = e.id${where ? ' WHERE ' + (req.user.role !== 'super_admin' && req.user.company_id ? 'e.company_id = $1' : '') : ''}`, params);
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
    const b = req.body;
    const row = await queryOne(
      `UPDATE employee_assets SET status = $1, returned_date = $2 WHERE id = $3 RETURNING *`,
      [b.status, b.returned_date || null, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Asset not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/assets/:id ──
router.delete('/:id', rbacMiddleware('assets', 'delete'), auditLog('assets'), async (req, res, next) => {
  try {
    await query(`DELETE FROM employee_assets WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
