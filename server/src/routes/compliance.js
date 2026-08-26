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

async function getDocumentOwnership(documentId) {
  return queryOne(
    `SELECT d.id, d.employee_id, e.company_id
     FROM employee_documents d
     LEFT JOIN employees e ON e.id = d.employee_id
     WHERE d.id = $1`,
    [documentId]
  );
}

async function assertEmployeeAccess(req, res, employeeId) {
  if (!requireCompanyScope(req, res)) return null;
  const employee = await getEmployeeCompany(employeeId);
  if (!employee) {
    res.status(404).json({ error: 'Employee not found' });
    return null;
  }
  if (req.user.role !== 'super_admin' && employee.company_id !== req.user.company_id) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return employee;
}

// ── GET /api/compliance ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    let sql = `SELECT d.*, e.first_name, e.last_name, e.company_id FROM employee_documents d LEFT JOIN employees e ON d.employee_id = e.id`;
    let params = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql += ` WHERE e.company_id = $1`;
      params.push(req.user.company_id);
    }
    sql += ` ORDER BY d.expiry_date ASC`;

    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM employee_documents d LEFT JOIN employees e ON d.employee_id = e.id`;
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      countSql += ` WHERE e.company_id = $1`;
    }
    const countRow = await queryOne(countSql, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    const data = rows.map(r => ({
      ...r,
      employees: { id: r.employee_id, first_name: r.first_name, last_name: r.last_name, company_id: r.company_id },
    }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/compliance ──
router.post('/', rbacMiddleware('compliance', 'add'), auditLog('compliance'), async (req, res, next) => {
  try {
    const b = req.body;
    if (req.user.role !== 'super_admin' && !(await assertEmployeeAccess(req, res, b.employee_id))) return;
    const row = await queryOne(
      `INSERT INTO employee_documents (employee_id, doc_type, doc_number, expiry_date, file_url) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.employee_id, b.doc_type, b.doc_number, b.expiry_date, b.file_url || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/compliance/:id ──
router.put('/:id', rbacMiddleware('compliance', 'edit'), auditLog('compliance'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      const b = req.body;
      const row = await queryOne(
        `UPDATE employee_documents SET employee_id=$1, doc_type=$2, doc_number=$3, expiry_date=$4 WHERE id=$5 RETURNING *`,
        [b.employee_id, b.doc_type, b.doc_number, b.expiry_date, req.params.id]
      );
      if (!row) return res.status(404).json({ error: 'Document not found' });
      return res.json({ data: row });
    }

    const currentDocument = await getDocumentOwnership(req.params.id);
    if (!currentDocument) return res.status(404).json({ error: 'Document not found' });
    if (!currentDocument.company_id || currentDocument.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    if (!(await assertEmployeeAccess(req, res, b.employee_id))) return;
    const row = await queryOne(
      `UPDATE employee_documents
       SET employee_id=$1, doc_type=$2, doc_number=$3, expiry_date=$4
       WHERE id=$5
         AND employee_id IN (SELECT id FROM employees WHERE company_id = $6)
       RETURNING *`,
      [b.employee_id, b.doc_type, b.doc_number, b.expiry_date, req.params.id, req.user.company_id]
    );
    if (!row) return res.status(404).json({ error: 'Document not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/compliance/:id ──
router.delete('/:id', rbacMiddleware('compliance', 'delete'), auditLog('compliance'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      await query(`DELETE FROM employee_documents WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'Document deleted' });
    }

    if (!requireCompanyScope(req, res)) return;
    const document = await getDocumentOwnership(req.params.id);
    if (!document) return res.json({ message: 'Document deleted' });
    if (!document.company_id || document.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      `DELETE FROM employee_documents d
       USING employees e
       WHERE d.id = $1
         AND d.employee_id = e.id
         AND e.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    res.json({ message: 'Document deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
