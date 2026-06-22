const express = require('express');
const { queryOne, queryAll } = require('../config/db');

const router = express.Router();

// ── GET /api/dashboard/kpis ──
router.get('/kpis', async (req, res, next) => {
  try {
    let companyFilter = '';
    let params = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      companyFilter = 'WHERE company_id = $1';
      params = [req.user.company_id];
    }

    const totalEmployees = await queryOne(`SELECT COUNT(*) as count FROM employees WHERE deleted_at IS NULL ${companyFilter}`, params);
    const activeEmployees = await queryOne(`SELECT COUNT(*) as count FROM employees WHERE deleted_at IS NULL AND status = 'active' ${companyFilter}`, params);
    const totalCompanies = await queryOne(`SELECT COUNT(*) as count FROM companies`);
    const pendingRequests = await queryOne(
      `SELECT COUNT(*) as count FROM employee_requests r LEFT JOIN employees e ON r.employee_id = e.id WHERE r.status = 'pending' ${req.user.company_id && req.user.role !== 'super_admin' ? 'AND e.company_id = $1' : ''}`,
      params
    );

    res.json({
      data: {
        total_employees: parseInt(totalEmployees?.count || 0),
        active_employees: parseInt(activeEmployees?.count || 0),
        total_companies: parseInt(totalCompanies?.count || 0),
        pending_requests: parseInt(pendingRequests?.count || 0),
      },
    });
  } catch (err) { next(err); }
});

// ── GET /api/dashboard/compliance-radar ──
router.get('/compliance-radar', async (req, res, next) => {
  try {
    let sql = `SELECT d.*, e.first_name, e.last_name, e.company_id FROM employee_documents d LEFT JOIN employees e ON d.employee_id = e.id`;
    let params = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql += ` WHERE e.company_id = $1`;
      params.push(req.user.company_id);
    }
    sql += ` ORDER BY d.expiry_date ASC`;
    const docs = await queryAll(sql, params);

    const today = new Date();
    let expired = 0, warning = 0, safe = 0;
    docs.forEach(d => {
      if (!d.expiry_date) return;
      const diff = Math.ceil((new Date(d.expiry_date) - today) / (1000 * 60 * 60 * 24));
      if (diff < 0) expired++;
      else if (diff <= 60) warning++;
      else safe++;
    });

    res.json({ data: { expired, warning, safe, total: docs.length, documents: docs } });
  } catch (err) { next(err); }
});

// ── GET /api/dashboard/audit-logs ──
router.get('/audit-logs', async (req, res, next) => {
  try {
    const rows = await queryAll(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50`);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
