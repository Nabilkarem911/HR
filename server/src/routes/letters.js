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

// ── GET /api/letters ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    let sql = `SELECT l.*, e.first_name, e.last_name, e.company_id FROM issued_letters l LEFT JOIN employees e ON l.employee_id = e.id`;
    let params = [];
    let clauses = [];

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      clauses.push(`e.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (req.user.role === 'employee' && req.user.employee_profile_id) {
      clauses.push(`l.employee_id = $${params.length + 1}`);
      params.push(req.user.employee_profile_id);
    }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY l.created_at DESC';

    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM issued_letters l LEFT JOIN employees e ON l.employee_id = e.id`;
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

// ── POST /api/letters ──
router.post('/', rbacMiddleware('letters', 'add'), auditLog('letters'), async (req, res, next) => {
  try {
    const b = req.body;
    if (req.user.role !== 'super_admin' && !(await assertEmployeeAccess(req, res, b.employee_id))) return;
    const refNo = 'LTR-' + Date.now().toString().slice(-8);
    const row = await queryOne(
      `INSERT INTO issued_letters (employee_id, letter_type, reference_number, ref_no, content_snapshot) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.employee_id, b.letter_type, refNo, refNo, b.content_snapshot || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── GET /api/letters/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const scopeClause = req.user.role === 'super_admin' ? '' : ' AND e.company_id = $2';
    const params = req.user.role === 'super_admin'
      ? [req.params.id]
      : [req.params.id, req.user.company_id];
    const row = await queryOne(
      `SELECT l.*, e.first_name, e.last_name, e.job_title, e.position, e.hire_date, e.join_date, e.basic_salary, e.contract_salary, e.company_id, c.name as company_name
       FROM issued_letters l LEFT JOIN employees e ON l.employee_id = e.id LEFT JOIN companies c ON e.company_id = c.id
       WHERE l.id = $1${scopeClause}`,
      params
    );
    if (!row) return res.status(404).json({ error: 'Letter not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

module.exports = router;
