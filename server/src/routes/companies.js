const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

function requireCompanyScope(req, res) {
  if (req.user.role !== 'super_admin' && !req.user.company_id) {
    res.status(403).json({ error: 'Company scope is required' });
    return false;
  }
  return true;
}

function assertCompanyAccess(req, res, companyId) {
  if (!requireCompanyScope(req, res)) return false;
  if (req.user.role !== 'super_admin' && companyId !== req.user.company_id) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  return true;
}

// ── GET /api/companies ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    let sql = `SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY created_at ASC`;
    let params = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql = `SELECT * FROM companies WHERE id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`;
      params = [req.user.company_id];
    }
    const rows = await queryAll(sql, params);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── GET /api/companies/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const row = await queryOne(`SELECT * FROM companies WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Company not found' });
    if (!assertCompanyAccess(req, res, row.id)) return;
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── POST /api/companies ──
router.post('/', rbacMiddleware('companies', 'add'), validateBody(['name']), auditLog('companies'), async (req, res, next) => {
  try {
    const { name, logo_url } = req.body;
    const row = await queryOne(`INSERT INTO companies (name, building_number, logo_url) VALUES ($1, nextval('companies_building_number_seq'), $2) RETURNING *`, [name, logo_url || null]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/companies/:id ──
router.put('/:id', rbacMiddleware('companies', 'edit'), auditLog('companies'), async (req, res, next) => {
  try {
    const { name, logo_url } = req.body;
    if (req.user.role === 'super_admin') {
      const row = await queryOne(`UPDATE companies SET name = $1, logo_url = $2 WHERE id = $3 RETURNING *`, [name, logo_url || null, req.params.id]);
      if (!row) return res.status(404).json({ error: 'Company not found' });
      return res.json({ data: row });
    }

    if (!requireCompanyScope(req, res)) return;
    const company = await queryOne(`SELECT id FROM companies WHERE id = $1`, [req.params.id]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (!assertCompanyAccess(req, res, company.id)) return;

    const row = await queryOne(
      `UPDATE companies SET name = $1, logo_url = $2 WHERE id = $3 AND id = $4 RETURNING *`,
      [name, logo_url || null, req.params.id, req.user.company_id]
    );
    if (!row) return res.status(404).json({ error: 'Company not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/companies/:id ──
router.delete('/:id', rbacMiddleware('companies', 'delete'), auditLog('companies'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      await query(`UPDATE companies SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'Company archived' });
    }

    if (!requireCompanyScope(req, res)) return;
    const company = await queryOne(`SELECT id FROM companies WHERE id = $1`, [req.params.id]);
    if (!company) return res.json({ message: 'Company archived' });
    if (!assertCompanyAccess(req, res, company.id)) return;

    await query(
      `UPDATE companies SET deleted_at = NOW() WHERE id = $1 AND id = $2`,
      [req.params.id, req.user.company_id]
    );
    res.json({ message: 'Company archived' });
  } catch (err) { next(err); }
});

// ── GET /api/companies/:id/employees ──
router.get('/:id/employees', async (req, res, next) => {
  try {
    if (!assertCompanyAccess(req, res, req.params.id)) return;
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
