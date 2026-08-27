const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── Company scope helpers (same pattern as companies.js) ──
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

// ── GET /api/organization/tree ──
// Returns a single hierarchical payload: companies → branches → departments → job_positions
router.get('/tree', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;

    let companySql = `SELECT id, name, logo_url FROM companies WHERE deleted_at IS NULL ORDER BY created_at ASC`;
    let companyParams = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      companySql = `SELECT id, name, logo_url FROM companies WHERE id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`;
      companyParams = [req.user.company_id];
    }
    const companies = await queryAll(companySql, companyParams);
    if (companies.length === 0) return res.json({ data: [] });

    const companyIds = companies.map(c => c.id);

    // Branches
    const branches = await queryAll(
      `SELECT id, company_id, name, code, address, phone FROM branches WHERE deleted_at IS NULL AND company_id = ANY($1) ORDER BY name ASC`,
      [companyIds]
    );

    // Departments
    const departments = await queryAll(
      `SELECT id, company_id, branch_id, parent_id, name, code FROM departments WHERE deleted_at IS NULL AND company_id = ANY($1) ORDER BY name ASC`,
      [companyIds]
    );

    // Job positions
    const positions = await queryAll(
      `SELECT id, company_id, department_id, title, code, grade FROM job_positions WHERE deleted_at IS NULL AND company_id = ANY($1) ORDER BY title ASC`,
      [companyIds]
    );

    // Build tree
    const branchMap = new Map();
    const deptMap = new Map();
    const posMap = new Map();

    for (const b of branches) {
      b.departments = [];
      branchMap.set(b.id, b);
    }
    for (const d of departments) {
      d.departments = [];
      d.job_positions = [];
      deptMap.set(d.id, d);
    }
    for (const p of positions) {
      p.departments = [];
      posMap.set(p.id, p);
    }

    // Link departments to branches or root
    for (const d of departments) {
      if (d.parent_id && deptMap.has(d.parent_id)) {
        deptMap.get(d.parent_id).departments.push(d);
      } else if (d.branch_id && branchMap.has(d.branch_id)) {
        branchMap.get(d.branch_id).departments.push(d);
      }
    }

    // Link job positions to departments
    for (const p of positions) {
      if (p.department_id && deptMap.has(p.department_id)) {
        deptMap.get(p.department_id).job_positions.push(p);
      }
    }

    // Link branches to companies
    for (const c of companies) {
      c.branches = branches.filter(b => b.company_id === c.id);
      // Departments without a branch attach directly to company
      c.departments = departments.filter(d => d.company_id === c.id && !d.branch_id && !d.parent_id);
    }

    res.json({ data: companies });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// BRANCHES
// ═══════════════════════════════════════════════

// ── GET /api/organization/branches ──
router.get('/branches', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { company_id } = req.query;
    let sql = `SELECT b.*, c.name as company_name FROM branches b LEFT JOIN companies c ON b.company_id = c.id WHERE b.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql += ` AND b.company_id = $${idx}`;
      params.push(req.user.company_id);
      idx++;
    } else if (company_id) {
      sql += ` AND b.company_id = $${idx}`;
      params.push(company_id);
      idx++;
    }

    sql += ` ORDER BY b.created_at DESC`;
    const rows = await queryAll(sql, params);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/organization/branches ──
router.post('/branches', rbacMiddleware('organization', 'add'), validateBody(['name', 'company_id']), auditLog('organization'), async (req, res, next) => {
  try {
    const { name, code, address, phone, company_id } = req.body;
    if (!assertCompanyAccess(req, res, company_id)) return;
    const row = await queryOne(
      `INSERT INTO branches (company_id, name, code, address, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [company_id, name, code || null, address || null, phone || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/organization/branches/:id ──
router.put('/branches/:id', rbacMiddleware('organization', 'edit'), auditLog('organization'), async (req, res, next) => {
  try {
    const existing = await queryOne(`SELECT * FROM branches WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Branch not found' });
    if (!assertCompanyAccess(req, res, existing.company_id)) return;

    const { name, code, address, phone } = req.body;
    const row = await queryOne(
      `UPDATE branches SET name = COALESCE($1, name), code = COALESCE($2, code), address = COALESCE($3, address), phone = COALESCE($4, phone) WHERE id = $5 RETURNING *`,
      [name || null, code || null, address || null, phone || null, req.params.id]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/organization/branches/:id (soft delete) ──
router.delete('/branches/:id', rbacMiddleware('organization', 'delete'), auditLog('organization'), async (req, res, next) => {
  try {
    const existing = await queryOne(`SELECT company_id FROM branches WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Branch not found' });
    if (!assertCompanyAccess(req, res, existing.company_id)) return;
    await query(`UPDATE branches SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Branch archived' });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════

// ── GET /api/organization/departments ──
router.get('/departments', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { company_id, branch_id } = req.query;
    let sql = `SELECT d.*, c.name as company_name, b.name as branch_name, p.name as parent_name FROM departments d LEFT JOIN companies c ON d.company_id = c.id LEFT JOIN branches b ON d.branch_id = b.id LEFT JOIN departments p ON d.parent_id = p.id WHERE d.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql += ` AND d.company_id = $${idx}`;
      params.push(req.user.company_id);
      idx++;
    } else if (company_id) {
      sql += ` AND d.company_id = $${idx}`;
      params.push(company_id);
      idx++;
    }

    if (branch_id) {
      sql += ` AND d.branch_id = $${idx}`;
      params.push(branch_id);
      idx++;
    }

    sql += ` ORDER BY d.created_at DESC`;
    const rows = await queryAll(sql, params);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/organization/departments ──
router.post('/departments', rbacMiddleware('organization', 'add'), validateBody(['name', 'company_id']), auditLog('organization'), async (req, res, next) => {
  try {
    const { name, code, company_id, branch_id, parent_id } = req.body;
    if (!assertCompanyAccess(req, res, company_id)) return;

    // Validate parent belongs to same company if provided
    if (parent_id) {
      const parent = await queryOne(`SELECT company_id FROM departments WHERE id = $1 AND deleted_at IS NULL`, [parent_id]);
      if (!parent) return res.status(400).json({ error: 'Parent department not found' });
      if (parent.company_id !== company_id) return res.status(400).json({ error: 'Parent department must belong to the same company' });
    }

    // Validate branch belongs to same company if provided
    if (branch_id) {
      const branch = await queryOne(`SELECT company_id FROM branches WHERE id = $1 AND deleted_at IS NULL`, [branch_id]);
      if (!branch) return res.status(400).json({ error: 'Branch not found' });
      if (branch.company_id !== company_id) return res.status(400).json({ error: 'Branch must belong to the same company' });
    }

    const row = await queryOne(
      `INSERT INTO departments (company_id, branch_id, parent_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [company_id, branch_id || null, parent_id || null, name, code || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/organization/departments/:id ──
router.put('/departments/:id', rbacMiddleware('organization', 'edit'), auditLog('organization'), async (req, res, next) => {
  try {
    const existing = await queryOne(`SELECT * FROM departments WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Department not found' });
    if (!assertCompanyAccess(req, res, existing.company_id)) return;

    const { name, code, branch_id, parent_id } = req.body;

    // Prevent self-reference cycle
    if (parent_id && parent_id === req.params.id) {
      return res.status(400).json({ error: 'Department cannot be its own parent' });
    }

    if (parent_id) {
      const parent = await queryOne(`SELECT company_id FROM departments WHERE id = $1 AND deleted_at IS NULL`, [parent_id]);
      if (!parent) return res.status(400).json({ error: 'Parent department not found' });
      if (parent.company_id !== existing.company_id) return res.status(400).json({ error: 'Parent department must belong to the same company' });
    }

    if (branch_id) {
      const branch = await queryOne(`SELECT company_id FROM branches WHERE id = $1 AND deleted_at IS NULL`, [branch_id]);
      if (!branch) return res.status(400).json({ error: 'Branch not found' });
      if (branch.company_id !== existing.company_id) return res.status(400).json({ error: 'Branch must belong to the same company' });
    }

    const row = await queryOne(
      `UPDATE departments SET name = COALESCE($1, name), code = COALESCE($2, code), branch_id = COALESCE($3, branch_id), parent_id = COALESCE($4, parent_id) WHERE id = $5 RETURNING *`,
      [name || null, code || null, branch_id || null, parent_id || null, req.params.id]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/organization/departments/:id (soft delete) ──
router.delete('/departments/:id', rbacMiddleware('organization', 'delete'), auditLog('organization'), async (req, res, next) => {
  try {
    const existing = await queryOne(`SELECT company_id FROM departments WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Department not found' });
    if (!assertCompanyAccess(req, res, existing.company_id)) return;
    await query(`UPDATE departments SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Department archived' });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// JOB POSITIONS
// ═══════════════════════════════════════════════

// ── GET /api/organization/job-positions ──
router.get('/job-positions', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { company_id, department_id } = req.query;
    let sql = `SELECT j.*, c.name as company_name, d.name as department_name FROM job_positions j LEFT JOIN companies c ON j.company_id = c.id LEFT JOIN departments d ON j.department_id = d.id WHERE j.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql += ` AND j.company_id = $${idx}`;
      params.push(req.user.company_id);
      idx++;
    } else if (company_id) {
      sql += ` AND j.company_id = $${idx}`;
      params.push(company_id);
      idx++;
    }

    if (department_id) {
      sql += ` AND j.department_id = $${idx}`;
      params.push(department_id);
      idx++;
    }

    sql += ` ORDER BY j.created_at DESC`;
    const rows = await queryAll(sql, params);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/organization/job-positions ──
router.post('/job-positions', rbacMiddleware('organization', 'add'), validateBody(['title', 'company_id']), auditLog('organization'), async (req, res, next) => {
  try {
    const { title, code, grade, description, company_id, department_id } = req.body;
    if (!assertCompanyAccess(req, res, company_id)) return;

    if (department_id) {
      const dept = await queryOne(`SELECT company_id FROM departments WHERE id = $1 AND deleted_at IS NULL`, [department_id]);
      if (!dept) return res.status(400).json({ error: 'Department not found' });
      if (dept.company_id !== company_id) return res.status(400).json({ error: 'Department must belong to the same company' });
    }

    const row = await queryOne(
      `INSERT INTO job_positions (company_id, department_id, title, code, grade, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [company_id, department_id || null, title, code || null, grade || null, description || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/organization/job-positions/:id ──
router.put('/job-positions/:id', rbacMiddleware('organization', 'edit'), auditLog('organization'), async (req, res, next) => {
  try {
    const existing = await queryOne(`SELECT * FROM job_positions WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Job position not found' });
    if (!assertCompanyAccess(req, res, existing.company_id)) return;

    const { title, code, grade, description, department_id } = req.body;

    if (department_id) {
      const dept = await queryOne(`SELECT company_id FROM departments WHERE id = $1 AND deleted_at IS NULL`, [department_id]);
      if (!dept) return res.status(400).json({ error: 'Department not found' });
      if (dept.company_id !== existing.company_id) return res.status(400).json({ error: 'Department must belong to the same company' });
    }

    const row = await queryOne(
      `UPDATE job_positions SET title = COALESCE($1, title), code = COALESCE($2, code), grade = COALESCE($3, grade), description = COALESCE($4, description), department_id = COALESCE($5, department_id) WHERE id = $6 RETURNING *`,
      [title || null, code || null, grade || null, description || null, department_id || null, req.params.id]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/organization/job-positions/:id (soft delete) ──
router.delete('/job-positions/:id', rbacMiddleware('organization', 'delete'), auditLog('organization'), async (req, res, next) => {
  try {
    const existing = await queryOne(`SELECT company_id FROM job_positions WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Job position not found' });
    if (!assertCompanyAccess(req, res, existing.company_id)) return;
    await query(`UPDATE job_positions SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Job position archived' });
  } catch (err) { next(err); }
});

module.exports = router;
