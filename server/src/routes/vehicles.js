const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { paginate } = require('../utils/helpers');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// ── GET /api/vehicles ──
router.get('/', async (req, res, next) => {
  try {
    let sql = `SELECT v.*, c.name as company_name FROM vehicles v LEFT JOIN companies c ON v.company_id = c.id ORDER BY v.created_at DESC`;
    let params = [];
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      sql = `SELECT v.*, c.name as company_name FROM vehicles v LEFT JOIN companies c ON v.company_id = c.id WHERE v.company_id = $1 ORDER BY v.created_at DESC`;
      params = [req.user.company_id];
    }
    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM vehicles v`;
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      countSql += ` WHERE v.company_id = $1`;
    }
    const countRow = await queryOne(countSql, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const data = rows.map(r => ({ ...r, companies: { name: r.company_name } }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/vehicles ──
router.post('/', rbacMiddleware('vehicles', 'add'), auditLog('vehicles'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `INSERT INTO vehicles (plate_number, make, model, year, status, company_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.plate_number, b.make || null, b.model || null, b.year || null, b.status || 'active', b.company_id]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/vehicles/:id ──
router.put('/:id', rbacMiddleware('vehicles', 'edit'), auditLog('vehicles'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `UPDATE vehicles SET plate_number=$1, make=$2, model=$3, year=$4, status=$5, company_id=$6 WHERE id=$7 RETURNING *`,
      [b.plate_number, b.make, b.model, b.year, b.status, b.company_id, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/vehicles/:id ──
router.delete('/:id', rbacMiddleware('vehicles', 'delete'), auditLog('vehicles'), async (req, res, next) => {
  try {
    await query(`DELETE FROM vehicles WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Vehicle deleted' });
  } catch (err) { next(err); }
});

// ── GET /api/vehicles/documents ──
router.get('/documents', async (req, res, next) => {
  try {
    let sql = `SELECT d.*, v.plate_number, v.make, v.model FROM vehicle_documents d LEFT JOIN vehicles v ON d.vehicle_id = v.id`;
    let params = [];
    let clauses = [];

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      clauses.push(`v.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY d.expiry_date ASC';

    const rows = await queryAll(sql, params);
    const data = rows.map(r => ({ ...r, vehicles: { plate_number: r.plate_number, make: r.make, model: r.model } }));
    res.json({ data });
  } catch (err) { next(err); }
});

// ── GET /api/vehicles/documents/all (alias) ──
router.get('/documents/all', async (req, res, next) => {
  try {
    const rows = await queryAll(
      `SELECT d.*, v.plate_number, v.make, v.model FROM vehicle_documents d LEFT JOIN vehicles v ON d.vehicle_id = v.id ORDER BY d.expiry_date ASC`
    );
    const data = rows.map(r => ({ ...r, vehicles: { plate_number: r.plate_number, make: r.make, model: r.model } }));
    res.json({ data });
  } catch (err) { next(err); }
});

// ── POST /api/vehicles/documents ──
router.post('/documents', rbacMiddleware('vehicles', 'add'), auditLog('vehicles'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `INSERT INTO vehicle_documents (vehicle_id, doc_type, doc_number, expiry_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.vehicle_id, b.doc_type, b.doc_number, b.expiry_date]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/vehicles/documents/:id ──
router.put('/documents/:id', rbacMiddleware('vehicles', 'edit'), auditLog('vehicles'), async (req, res, next) => {
  try {
    const b = req.body;
    const row = await queryOne(
      `UPDATE vehicle_documents SET vehicle_id=$1, doc_type=$2, doc_number=$3, expiry_date=$4 WHERE id=$5 RETURNING *`,
      [b.vehicle_id, b.doc_type, b.doc_number, b.expiry_date, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Document not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/vehicles/documents/:id ──
router.delete('/documents/:id', rbacMiddleware('vehicles', 'delete'), auditLog('vehicles'), async (req, res, next) => {
  try {
    await query(`DELETE FROM vehicle_documents WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Document deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
