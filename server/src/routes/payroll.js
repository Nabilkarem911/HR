const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { maskSalary, paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/payroll ──
router.get('/', async (req, res, next) => {
  try {
    const { month_year, month, year, status, company_id } = req.query;
    let sql = `SELECT p.*, e.first_name, e.last_name, e.company_id FROM payroll_records p LEFT JOIN employees e ON p.employee_id = e.id`;
    let params = [];
    let clauses = [];

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      clauses.push(`e.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (company_id) { clauses.push(`p.company_id = $${params.length + 1}`); params.push(company_id); }
    if (month_year) { clauses.push(`p.month_year = $${params.length + 1}`); params.push(month_year); }
    if (month) { clauses.push(`p.month = $${params.length + 1}`); params.push(parseInt(month)); }
    if (year) { clauses.push(`p.year = $${params.length + 1}`); params.push(parseInt(year)); }
    if (status) { clauses.push(`p.status = $${params.length + 1}`); params.push(status); }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY p.created_at DESC';

    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM payroll_records p LEFT JOIN employees e ON p.employee_id = e.id`;
    if (clauses.length) countSql += ' WHERE ' + clauses.join(' AND ');
    const countRow = await queryOne(countSql, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    const shouldHide = req.user.hasPerm('payroll', 'hide_net');
    const data = rows.map(r => {
      const row = { ...r, employees: { id: r.employee_id, first_name: r.first_name, last_name: r.last_name, company_id: r.company_id } };
      delete row.first_name; delete row.last_name; delete row.company_id;
      return maskSalary(row, shouldHide);
    });
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/payroll (upsert) ──
router.post('/', rbacMiddleware('payroll', 'add'), auditLog('payroll'), async (req, res, next) => {
  try {
    const b = req.body;
    const monthYear = b.month_year || (b.month && b.year ? `${b.year}-${String(b.month).padStart(2, '0')}` : null);
    if (!monthYear) return res.status(400).json({ error: 'month_year or month+year required' });
    const row = await queryOne(
      `INSERT INTO payroll_records (employee_id, company_id, month, year, month_year, basic_salary, allowances, overtime_pay, deductions, loan_deduction, manual_bonus, manual_penalty, net_salary, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (employee_id, month_year) DO UPDATE SET basic_salary=$6, allowances=$7, overtime_pay=$8, deductions=$9, loan_deduction=$10, manual_bonus=$11, manual_penalty=$12, net_salary=$13, notes=$14, status=$15, updated_at=NOW()
       RETURNING *`,
      [b.employee_id, b.company_id, b.month || null, b.year || null, monthYear, b.basic_salary, b.allowances || 0, b.overtime_pay || 0, b.deductions || 0, b.loan_deduction || 0, b.manual_bonus || 0, b.manual_penalty || 0, b.net_salary, b.notes || null, b.status || 'draft']
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/payroll/:id ──
router.put('/:id', rbacMiddleware('payroll', 'edit'), auditLog('payroll'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `UPDATE payroll_records SET basic_salary=$1, allowances=$2, overtime_pay=$3, deductions=$4, loan_deduction=$5, manual_bonus=$6, manual_penalty=$7, net_salary=$8, notes=$9, status=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,
      [b.basic_salary, b.allowances, b.overtime_pay, b.deductions, b.loan_deduction, b.manual_bonus || 0, b.manual_penalty || 0, b.net_salary, b.notes || null, b.status, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Payroll record not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/payroll (delete by filters, e.g. draft payslips) ──
router.delete('/', rbacMiddleware('payroll', 'edit'), auditLog('payroll'), async (req, res, next) => {
  try {
    const { month, year, month_year, status, employee_id_in } = req.query;
    let clauses = [];
    let params = [];

    if (month_year) { clauses.push(`month_year = $${params.length + 1}`); params.push(month_year); }
    if (month) { clauses.push(`month = $${params.length + 1}`); params.push(parseInt(month)); }
    if (year) { clauses.push(`year = $${params.length + 1}`); params.push(parseInt(year)); }
    if (status) { clauses.push(`status = $${params.length + 1}`); params.push(status); }
    if (employee_id_in) {
      let arr = employee_id_in;
      try { arr = JSON.parse(employee_id_in); } catch (_) {}
      if (!Array.isArray(arr)) arr = [arr];
      const placeholders = arr.map((_, i) => `$${params.length + 1 + i}`).join(',');
      clauses.push(`employee_id IN (${placeholders})`);
      params.push(...arr);
    }

    if (clauses.length === 0) {
      return res.status(400).json({ error: 'At least one filter required for delete' });
    }

    const result = await query(
      `DELETE FROM payroll_records WHERE ${clauses.join(' AND ')} RETURNING id`,
      params
    );
    res.json({ data: result.rows, deleted: result.rowCount });
  } catch (err) { next(err); }
});

// ── POST /api/payroll/batch ──
router.post('/batch', rbacMiddleware('payroll', 'add'), async (req, res, next) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
    const results = [];
    for (const b of records) {
      const monthYear = b.month_year || (b.month && b.year ? `${b.year}-${String(b.month).padStart(2, '0')}` : null);
      if (!monthYear) continue;
      const row = await queryOne(
        `INSERT INTO payroll_records (employee_id, company_id, month, year, month_year, basic_salary, allowances, overtime_pay, deductions, loan_deduction, manual_bonus, manual_penalty, net_salary, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (employee_id, month_year) DO UPDATE SET basic_salary=$6, allowances=$7, overtime_pay=$8, deductions=$9, loan_deduction=$10, manual_bonus=$11, manual_penalty=$12, net_salary=$13, notes=$14, status=$15, updated_at=NOW()
         RETURNING *`,
        [b.employee_id, b.company_id, b.month || null, b.year || null, monthYear, b.basic_salary, b.allowances || 0, b.overtime_pay || 0, b.deductions || 0, b.loan_deduction || 0, b.manual_bonus || 0, b.manual_penalty || 0, b.net_salary, b.notes || null, b.status || 'draft']
      );
      results.push(row);
    }
    res.status(201).json({ data: results });
  } catch (err) { next(err); }
});

module.exports = router;
