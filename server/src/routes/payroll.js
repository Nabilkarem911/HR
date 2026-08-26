const express = require('express');
const { pool, query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { maskSalary, paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

function requireCompanyScope(req, res) {
  if (req.user.role !== 'super_admin' && !req.user.company_id) {
    res.status(403).json({ error: 'Company scope is required' });
    return false;
  }
  return true;
}

async function getPayrollEmployee(employeeId, client = null) {
  const result = client
    ? await client.query(`SELECT id, company_id FROM employees WHERE id = $1`, [employeeId])
    : await query(`SELECT id, company_id FROM employees WHERE id = $1`, [employeeId]);
  return result.rows[0] || null;
}

async function assertPayrollEmployeeAccess(req, res, employeeId, requestedCompanyId, client = null) {
  if (!requireCompanyScope(req, res)) return null;

  const employee = await getPayrollEmployee(employeeId, client);
  if (!employee) {
    res.status(404).json({ error: 'Employee not found' });
    return null;
  }

  if (req.user.role !== 'super_admin') {
    if (employee.company_id !== req.user.company_id ||
        (requestedCompanyId !== undefined && requestedCompanyId !== null && requestedCompanyId !== '' && requestedCompanyId !== req.user.company_id)) {
      res.status(403).json({ error: 'Access denied' });
      return null;
    }
  }

  return employee;
}

function getPayrollAmounts(body, defaultMissing = 0) {
  return {
    allowances: body.allowances ?? body.total_allowances ?? defaultMissing,
    deductions: body.deductions ?? body.total_deductions ?? defaultMissing,
  };
}

function approvedPayrollError() {
  const error = new Error('Approved payroll cannot be modified');
  error.status = 409;
  return error;
}

// ── GET /api/payroll ──
router.get('/', rbacMiddleware('payroll', 'view'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
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
    if (!(await assertPayrollEmployeeAccess(req, res, b.employee_id, b.company_id))) return;

    const monthYear = b.month_year || (b.month && b.year ? `${b.year}-${String(b.month).padStart(2, '0')}` : null);
    if (!monthYear) return res.status(400).json({ error: 'month_year or month+year required' });
    const companyId = req.user.role === 'super_admin' ? b.company_id : req.user.company_id;
    const { allowances, deductions } = getPayrollAmounts(b);
    const row = await queryOne(
      `INSERT INTO payroll_records (employee_id, company_id, month, year, month_year, basic_salary, allowances, overtime_pay, deductions, loan_deduction, manual_bonus, manual_penalty, net_salary, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (employee_id, month_year) DO UPDATE SET basic_salary=$6, allowances=$7, overtime_pay=$8, deductions=$9, loan_deduction=$10, manual_bonus=$11, manual_penalty=$12, net_salary=$13, notes=$14, status=$15, updated_at=NOW()
       WHERE payroll_records.status IS DISTINCT FROM 'approved'
       RETURNING *`,
      [b.employee_id, companyId, b.month || null, b.year || null, monthYear, b.basic_salary, allowances, b.overtime_pay || 0, deductions, b.loan_deduction || 0, b.manual_bonus || 0, b.manual_penalty || 0, b.net_salary, b.notes || null, b.status || 'draft']
    );
    if (!row) return res.status(409).json({ error: 'Approved payroll cannot be modified' });
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/payroll/:id ──
router.put('/:id', rbacMiddleware('payroll', 'edit'), auditLog('payroll'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const payroll = await queryOne(
      `SELECT p.employee_id, p.status, e.company_id
       FROM payroll_records p
       LEFT JOIN employees e ON p.employee_id = e.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!payroll) return res.status(404).json({ error: 'Payroll record not found' });
    if (req.user.role !== 'super_admin' && payroll.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (payroll.status === 'approved') {
      return res.status(409).json({ error: 'Approved payroll cannot be modified' });
    }

    const b = req.body;
    const { allowances, deductions } = getPayrollAmounts(b, null);
    const row = await queryOne(
      `UPDATE payroll_records SET basic_salary=$1, allowances=$2, overtime_pay=$3, deductions=$4, loan_deduction=$5, manual_bonus=$6, manual_penalty=$7, net_salary=$8, notes=$9, status=$10, updated_at=NOW()
       WHERE id=$11
         AND ($12 = 'super_admin' OR employee_id IN (SELECT id FROM employees WHERE company_id = $13))
         AND status IS DISTINCT FROM 'approved'
       RETURNING *`,
      [b.basic_salary, allowances, b.overtime_pay, deductions, b.loan_deduction, b.manual_bonus || 0, b.manual_penalty || 0, b.net_salary, b.notes || null, b.status, req.params.id, req.user.role, req.user.company_id || null]
    );
    if (!row) return res.status(404).json({ error: 'Payroll record not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/payroll (delete by filters, e.g. draft payslips) ──
router.delete('/', rbacMiddleware('payroll', 'edit'), auditLog('payroll'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { month, year, month_year, status, employee_id_in } = req.query;
    let clauses = [];
    let params = [];

    if (month_year) { clauses.push(`p.month_year = $${params.length + 1}`); params.push(month_year); }
    if (month) { clauses.push(`p.month = $${params.length + 1}`); params.push(parseInt(month)); }
    if (year) { clauses.push(`p.year = $${params.length + 1}`); params.push(parseInt(year)); }
    if (status) { clauses.push(`p.status = $${params.length + 1}`); params.push(status); }
    if (employee_id_in) {
      let arr = employee_id_in;
      try { arr = JSON.parse(arr); } catch (_) {}
      if (!Array.isArray(arr)) arr = [arr];
      const placeholders = arr.map((_, i) => `$${params.length + 1 + i}`).join(',');
      clauses.push(`p.employee_id IN (${placeholders})`);
      params.push(...arr);
    }

    if (clauses.length === 0) {
      return res.status(400).json({ error: 'At least one filter required for delete' });
    }

    if (req.user.role === 'super_admin') {
      const result = await query(
        `DELETE FROM payroll_records p WHERE ${clauses.join(' AND ')} RETURNING p.id`,
        params
      );
      return res.json({ data: result.rows, deleted: result.rowCount });
    }

    const scopeParam = params.length + 1;
    const scopeParams = [...params, req.user.company_id];
    const targetCount = await queryOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id = $${scopeParam})::int AS in_scope
       FROM payroll_records p
       LEFT JOIN employees e ON e.id = p.employee_id
       WHERE ${clauses.join(' AND ')}`,
      scopeParams
    );
    if (targetCount.total !== targetCount.in_scope) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await query(
      `DELETE FROM payroll_records p
       USING employees e
       WHERE p.employee_id = e.id
         AND e.company_id = $${scopeParam}
         AND ${clauses.join(' AND ')}
       RETURNING p.id`,
      scopeParams
    );
    res.json({ data: result.rows, deleted: result.rowCount });
  } catch (err) { next(err); }
});

// ── POST /api/payroll/batch ──
router.post('/batch', rbacMiddleware('payroll', 'add'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });

    const processableRecords = records.filter(b => {
      return b.month_year || (b.month && b.year);
    });
    if (processableRecords.length === 0) {
      return res.status(201).json({ data: [] });
    }

    const client = await pool.connect();
    const results = [];

    try {
      await client.query('BEGIN');

      // Validate every record before writing any record, preventing a mixed-company batch.
      for (const b of processableRecords) {
        if (!(await assertPayrollEmployeeAccess(req, res, b.employee_id, b.company_id, client))) {
          await client.query('ROLLBACK');
          return;
        }
      }

      for (const b of processableRecords) {
        const monthYear = b.month_year || (b.month && b.year ? `${b.year}-${String(b.month).padStart(2, '0')}` : null);
        const { allowances, deductions } = getPayrollAmounts(b);
        const rowResult = await client.query(
          `INSERT INTO payroll_records (employee_id, company_id, month, year, month_year, basic_salary, allowances, overtime_pay, deductions, loan_deduction, manual_bonus, manual_penalty, net_salary, notes, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (employee_id, month_year) DO UPDATE SET basic_salary=$6, allowances=$7, overtime_pay=$8, deductions=$9, loan_deduction=$10, manual_bonus=$11, manual_penalty=$12, net_salary=$13, notes=$14, status=$15, updated_at=NOW()
           WHERE payroll_records.status IS DISTINCT FROM 'approved'
           RETURNING *`,
          [b.employee_id, req.user.role === 'super_admin' ? b.company_id : req.user.company_id, b.month || null, b.year || null, monthYear, b.basic_salary, allowances, b.overtime_pay || 0, deductions, b.loan_deduction || 0, b.manual_bonus || 0, b.manual_penalty || 0, b.net_salary, b.notes || null, b.status || 'draft']
        );
        if (!rowResult.rows[0]) throw approvedPayrollError();
        results.push(rowResult.rows[0]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({ data: results });
  } catch (err) { next(err); }
});

module.exports = router;
