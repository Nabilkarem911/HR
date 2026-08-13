const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/requests ──
router.get('/', async (req, res, next) => {
  try {
    const { status, request_type } = req.query;
    let sql = `SELECT r.*, e.first_name, e.last_name, e.company_id FROM employee_requests r LEFT JOIN employees e ON r.employee_id = e.id`;
    let params = [];
    let clauses = [];

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      clauses.push(`e.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (req.user.role === 'employee' && req.user.employee_profile_id) {
      clauses.push(`r.employee_id = $${params.length + 1}`);
      params.push(req.user.employee_profile_id);
    }
    if (status) { clauses.push(`r.status = $${params.length + 1}`); params.push(status); }
    if (request_type) { clauses.push(`r.request_type = $${params.length + 1}`); params.push(request_type); }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY r.created_at DESC';

    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM employee_requests r LEFT JOIN employees e ON r.employee_id = e.id`;
    if (clauses.length) countSql += ' WHERE ' + clauses.join(' AND ');
    const countRow = await queryOne(countSql, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    const data = rows.map(r => ({
      ...r,
      employees: { id: r.employee_id, first_name: r.first_name, last_name: r.last_name, company_id: r.company_id },
    }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/requests ──
router.post('/', rbacMiddleware('requests', 'add'), auditLog('requests'), async (req, res, next) => {
  try {
    const b = req.body;
    const empId = req.user.employee_profile_id || b.employee_id;
    const row = await queryOne(
      `INSERT INTO employee_requests (employee_id, request_type, start_date, end_date, total_days, amount, reason, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [empId, b.request_type, b.start_date || null, b.end_date || null, b.total_days || null, b.amount || null, b.reason || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/requests/:id (approve/reject/process) ──
router.put('/:id', rbacMiddleware('requests', 'edit'), auditLog('requests'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `UPDATE employee_requests SET status = $1, paid_amount = COALESCE($2, paid_amount) WHERE id = $3 RETURNING *`,
      [b.status, b.paid_amount || null, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Request not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

module.exports = router;
