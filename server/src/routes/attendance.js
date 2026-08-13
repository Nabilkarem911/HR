const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/attendance ──
router.get('/', async (req, res, next) => {
  try {
    const { month_year, company_id } = req.query;
    let sql = `SELECT a.*, e.first_name, e.last_name FROM monthly_attendance a LEFT JOIN employees e ON a.emp_id = e.id`;
    let params = [];
    let clauses = [];

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      clauses.push(`a.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (month_year) { clauses.push(`a.month_year = $${params.length + 1}`); params.push(month_year); }
    if (company_id) { clauses.push(`a.company_id = $${params.length + 1}`); params.push(company_id); }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY a.created_at DESC';

    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM monthly_attendance a LEFT JOIN employees e ON a.emp_id = e.id`;
    if (clauses.length) countSql += ' WHERE ' + clauses.join(' AND ');
    const countRow = await queryOne(countSql, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    const data = rows.map(r => ({
      ...r,
      employees: { id: r.emp_id, first_name: r.first_name, last_name: r.last_name },
    }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── DELETE /api/attendance (delete by filters) ──
router.delete('/', rbacMiddleware('attendance', 'edit'), auditLog('attendance'), async (req, res, next) => {
  try {
    const { month_year, company_id, emp_id_in } = req.query;
    let clauses = [];
    let params = [];

    if (month_year) { clauses.push(`month_year = $${params.length + 1}`); params.push(month_year); }
    if (company_id) { clauses.push(`company_id = $${params.length + 1}`); params.push(company_id); }
    if (emp_id_in) {
      let arr = emp_id_in;
      try { arr = JSON.parse(emp_id_in); } catch (_) {}
      if (!Array.isArray(arr)) arr = [arr];
      const placeholders = arr.map((_, i) => `$${params.length + 1 + i}`).join(',');
      clauses.push(`emp_id IN (${placeholders})`);
      params.push(...arr);
    }

    if (clauses.length === 0) {
      return res.status(400).json({ error: 'At least one filter required for delete' });
    }

    const result = await query(
      `DELETE FROM monthly_attendance WHERE ${clauses.join(' AND ')} RETURNING id`,
      params
    );
    res.json({ data: result.rows, deleted: result.rowCount });
  } catch (err) { next(err); }
});

// ── POST /api/attendance/batch ──
router.post('/batch', rbacMiddleware('attendance', 'add'), auditLog('attendance'), async (req, res, next) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
    const results = [];
    for (const b of records) {
      const row = await queryOne(
        `INSERT INTO monthly_attendance (emp_id, company_id, month_year, days_present, days_absent, hours_overtime, hours_late)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (emp_id, month_year) DO UPDATE SET days_present=$4, days_absent=$5, hours_overtime=$6, hours_late=$7
         RETURNING *`,
        [b.emp_id, b.company_id, b.month_year, b.days_present || 0, b.days_absent || 0, b.hours_overtime || 0, b.hours_late || 0]
      );
      results.push(row);
    }
    res.status(201).json({ data: results });
  } catch (err) { next(err); }
});

// ── PUT /api/attendance/:id ──
router.put('/:id', rbacMiddleware('attendance', 'edit'), auditLog('attendance'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `UPDATE monthly_attendance SET days_present=$1, days_absent=$2, hours_overtime=$3, hours_late=$4 WHERE id=$5 RETURNING *`,
      [b.days_present, b.days_absent, b.hours_overtime, b.hours_late, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

module.exports = router;
