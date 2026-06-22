const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/companies ──
router.get('/', async (req, res, next) => {
  try {
    let sql = `SELECT * FROM companies ORDER BY created_at ASC`;
    let params = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql = `SELECT * FROM companies WHERE id = $1 ORDER BY created_at ASC`;
      params = [req.user.company_id];
    }
    const rows = await queryAll(sql, params);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── GET /api/companies/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    const row = await queryOne(`SELECT * FROM companies WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Company not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── POST /api/companies ──
router.post('/', rbacMiddleware('companies', 'add'), validateBody(['name']), auditLog('companies'), async (req, res, next) => {
  try {
    const { name } = req.body;
    const row = await queryOne(`INSERT INTO companies (name) VALUES ($1) RETURNING *`, [name]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/companies/:id ──
router.put('/:id', rbacMiddleware('companies', 'edit'), auditLog('companies'), async (req, res, next) => {
  try {
    const { name } = req.body;
    const row = await queryOne(`UPDATE companies SET name = $1 WHERE id = $2 RETURNING *`, [name, req.params.id]);
    if (!row) return res.status(404).json({ error: 'Company not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/companies/:id ──
router.delete('/:id', rbacMiddleware('companies', 'delete'), auditLog('companies'), async (req, res, next) => {
  try {
    await query(`DELETE FROM companies WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Company deleted' });
  } catch (err) { next(err); }
});

// ── GET /api/companies/:id/employees ──
router.get('/:id/employees', async (req, res, next) => {
  try {
    const rows = await queryAll(
      `SELECT id, first_name, last_name, job_title, basic_salary, status FROM employees WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.params.id]
    );
    const shouldHide = req.user.hasPerm('employees', 'hide_salary');
    const data = rows.map(r => shouldHide ? { ...r, basic_salary: null, _salary_masked: true } : r);
    res.json({ data });
  } catch (err) { next(err); }
});

module.exports = router;
