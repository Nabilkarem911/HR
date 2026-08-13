const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { maskSalary, paginate } = require('../utils/helpers');
const { validateBody } = require('../middleware/validate');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/employees (list with filters) ──
router.get('/', async (req, res, next) => {
  if (!req.user.hasPerm('employees', 'view')) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  getList(req, res, next);
});

async function getList(req, res, next) {
  try {
    const { search, status, company_id } = req.query;
    const params = [];
    let where = ['deleted_at IS NULL'];
    let idx = 1;

    if (search) {
      where.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx} OR emp_code ILIKE $${idx} OR iqama_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) { where.push(`status = $${idx}`); params.push(status); idx++; }
    if (company_id) { where.push(`company_id = $${idx}`); params.push(company_id); idx++; }

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      where.push(`company_id = $${idx}`); params.push(req.user.company_id); idx++;
    }

    const sql = `SELECT e.*, c.name as company_name FROM employees e LEFT JOIN companies c ON e.company_id = c.id WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC`;
    const { page, limit, offset } = paginate(req);
    const countRow = await queryOne(`SELECT COUNT(*) as count FROM employees e WHERE ${where.join(' AND ')}`, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    const shouldHide = req.user.hasPerm('employees', 'hide_salary');
    const data = rows.map(r => {
      const row = { ...r, companies: { name: r.company_name } };
      delete row.company_name;
      return maskSalary(row, shouldHide);
    });

    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
}

// ── GET /api/employees/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    const emp = await queryOne(
      `SELECT e.*, c.name as company_name FROM employees e LEFT JOIN companies c ON e.company_id = c.id WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    if (req.user.role !== 'super_admin' && req.user.company_id && emp.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const shouldHide = req.user.hasPerm('employees', 'hide_salary');
    const row = { ...emp, companies: { name: emp.company_name } };
    delete row.company_name;
    res.json({ data: maskSalary(row, shouldHide) });
  } catch (err) { next(err); }
});

// ── POST /api/employees ──
router.post('/', rbacMiddleware('employees', 'add'), validateBody(['first_name', 'last_name']), auditLog('employees'), async (req, res, next) => {
  try {
    const b = req.body;
    const empCode = 'EMP-' + Date.now().toString().slice(-6);
    const email = b.email && b.email.trim() ? b.email.trim() : null;
    const row = await queryOne(
      `INSERT INTO employees (emp_code, first_name, last_name, email, phone, position, job_title, basic_salary, contract_salary, hire_date, join_date, status, company_id, iqama_number, nationality, iqama_profession)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [empCode, b.first_name, b.last_name, email, b.phone || null, b.position || null, b.job_title || null, b.basic_salary || 0, b.contract_salary || null, b.hire_date || null, b.hire_date || null, b.status || 'active', b.company_id || null, b.iqama_number || null, b.nationality || null, b.iqama_profession || null]
    );
    res.status(201).json({ data: row });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'employees_email_key') {
      return res.status(409).json({ error: 'هذا البريد الإلكتروني مستخدم بالفعل' });
    }
    next(err);
  }
});

// ── PUT /api/employees/:id ──
router.put('/:id', rbacMiddleware('employees', 'edit'), auditLog('employees'), async (req, res, next) => {
  try {
    const b = req.body;
    const email = b.email && b.email.trim() ? b.email.trim() : null;
    const row = await queryOne(
      `UPDATE employees SET first_name=$1, last_name=$2, email=$3, phone=$4, position=$5, job_title=$6, basic_salary=$7, contract_salary=$8, hire_date=$9, join_date=$10, status=$11, company_id=$12, iqama_number=$13, nationality=$14, iqama_profession=$15 WHERE id=$16 AND deleted_at IS NULL RETURNING *`,
      [b.first_name, b.last_name, email, b.phone || null, b.position || null, b.job_title || null, b.basic_salary || 0, b.contract_salary || null, b.hire_date || null, b.hire_date || null, b.status, b.company_id || null, b.iqama_number || null, b.nationality || null, b.iqama_profession || null, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    res.json({ data: row });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'employees_email_key') {
      return res.status(409).json({ error: 'هذا البريد الإلكتروني مستخدم بالفعل' });
    }
    next(err);
  }
});

// ── DELETE /api/employees/:id (soft delete) ──
router.delete('/:id', rbacMiddleware('employees', 'delete'), auditLog('employees'), async (req, res, next) => {
  try {
    await query(`UPDATE employees SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Employee archived' });
  } catch (err) { next(err); }
});

module.exports = router;
