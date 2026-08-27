const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
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

async function getVehicleOwnership(vehicleId) {
  return queryOne(
    `SELECT id, company_id FROM vehicles WHERE id = $1`,
    [vehicleId]
  );
}

async function getVehicleDocumentOwnership(documentId) {
  return queryOne(
    `SELECT d.id, d.vehicle_id, v.company_id
     FROM vehicle_documents d
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.id = $1`,
    [documentId]
  );
}

async function assertVehicleAccess(req, res, vehicleId) {
  if (!requireCompanyScope(req, res)) return null;
  const vehicle = await getVehicleOwnership(vehicleId);
  if (!vehicle) {
    res.status(404).json({ error: 'Vehicle not found' });
    return null;
  }
  if (!vehicle.company_id || vehicle.company_id !== req.user.company_id) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return vehicle;
}

// ── GET /api/vehicles ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const clauses = [];
    const params = [];

    if (req.user.role !== 'super_admin') {
      clauses.push(`v.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }

    const whereClause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const baseFrom = ` FROM vehicles v LEFT JOIN companies c ON v.company_id = c.id`;
    const sql = `SELECT v.*, c.name as company_name${baseFrom}${whereClause} ORDER BY v.created_at DESC`;
    const { page, limit, offset } = paginate(req);
    const countRow = await queryOne(`SELECT COUNT(*) as count${baseFrom}${whereClause}`, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const data = rows.map(r => ({ ...r, companies: { name: r.company_name } }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── POST /api/vehicles ──
router.post('/', rbacMiddleware('vehicles', 'add'), auditLog('vehicles'), async (req, res, next) => {
  try {
    const b = req.body;
    let companyId = b.company_id;
    if (req.user.role !== 'super_admin') {
      if (!requireCompanyScope(req, res)) return;
      if (b.company_id && b.company_id !== req.user.company_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      companyId = req.user.company_id;
    }
    const row = await queryOne(
      `INSERT INTO vehicles (plate_number, make, model, year, status, company_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.plate_number, b.make || null, b.model || null, b.year || null, b.status || 'active', companyId]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/vehicles/:id ──
router.put('/:id', rbacMiddleware('vehicles', 'edit'), auditLog('vehicles'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      const b = req.body;
      const row = await queryOne(
        `UPDATE vehicles SET plate_number=$1, make=$2, model=$3, year=$4, status=$5, company_id=$6 WHERE id=$7 RETURNING *`,
        [b.plate_number, b.make, b.model, b.year, b.status, b.company_id, req.params.id]
      );
      if (!row) return res.status(404).json({ error: 'Vehicle not found' });
      return res.json({ data: row });
    }

    if (!requireCompanyScope(req, res)) return;
    const vehicle = await getVehicleOwnership(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (!vehicle.company_id || vehicle.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    if (b.company_id && b.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const row = await queryOne(
      `UPDATE vehicles
       SET plate_number=$1, make=$2, model=$3, year=$4, status=$5, company_id=$6
       WHERE id=$7 AND company_id=$8
       RETURNING *`,
      [b.plate_number, b.make, b.model, b.year, b.status, vehicle.company_id, req.params.id, req.user.company_id]
    );
    if (!row) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/vehicles/:id ──
router.delete('/:id', rbacMiddleware('vehicles', 'delete'), auditLog('vehicles'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      await query(`DELETE FROM vehicles WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'Vehicle deleted' });
    }

    if (!requireCompanyScope(req, res)) return;
    const vehicle = await getVehicleOwnership(req.params.id);
    if (!vehicle) return res.json({ message: 'Vehicle deleted' });
    if (!vehicle.company_id || vehicle.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      `DELETE FROM vehicles WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    res.json({ message: 'Vehicle deleted' });
  } catch (err) { next(err); }
});

// ── GET /api/vehicles/documents ──
router.get('/documents', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const clauses = [];
    const params = [];
    if (req.user.role !== 'super_admin') {
      clauses.push(`v.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }

    const baseFrom = ` FROM vehicle_documents d LEFT JOIN vehicles v ON d.vehicle_id = v.id`;
    const whereClause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = await queryAll(`SELECT d.*, v.plate_number, v.make, v.model${baseFrom}${whereClause} ORDER BY d.expiry_date ASC`, params);
    const data = rows.map(r => ({ ...r, vehicles: { plate_number: r.plate_number, make: r.make, model: r.model } }));
    res.json({ data });
  } catch (err) { next(err); }
});

// ── GET /api/vehicles/documents/all (alias) ──
router.get('/documents/all', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const scopeClause = req.user.role === 'super_admin' ? '' : ' WHERE v.company_id = $1';
    const params = req.user.role === 'super_admin' ? [] : [req.user.company_id];
    const rows = await queryAll(
      `SELECT d.*, v.plate_number, v.make, v.model FROM vehicle_documents d LEFT JOIN vehicles v ON d.vehicle_id = v.id${scopeClause} ORDER BY d.expiry_date ASC`,
      params
    );
    const data = rows.map(r => ({ ...r, vehicles: { plate_number: r.plate_number, make: r.make, model: r.model } }));
    res.json({ data });
  } catch (err) { next(err); }
});

// ── POST /api/vehicles/documents ──
router.post('/documents', rbacMiddleware('vehicles', 'add'), auditLog('vehicles'), async (req, res, next) => {
  try {
    const b = req.body;
    if (req.user.role !== 'super_admin' && !(await assertVehicleAccess(req, res, b.vehicle_id))) return;
    const row = await queryOne(
      `INSERT INTO vehicle_documents (vehicle_id, doc_type, doc_number, expiry_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.vehicle_id, b.doc_type, b.doc_number, b.expiry_date]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/vehicles/documents/:id ──
router.put('/documents/:id', rbacMiddleware('vehicles', 'edit'), validateBody(['vehicle_id']), auditLog('vehicles'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      const b = req.body;
      const row = await queryOne(
        `UPDATE vehicle_documents SET vehicle_id=$1, doc_type=$2, doc_number=$3, expiry_date=$4 WHERE id=$5 RETURNING *`,
        [b.vehicle_id, b.doc_type, b.doc_number, b.expiry_date, req.params.id]
      );
      if (!row) return res.status(404).json({ error: 'Document not found' });
      return res.json({ data: row });
    }

    if (!requireCompanyScope(req, res)) return;
    const document = await getVehicleDocumentOwnership(req.params.id);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (!document.company_id || document.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    if (!(await assertVehicleAccess(req, res, b.vehicle_id))) return;
    const row = await queryOne(
      `UPDATE vehicle_documents
       SET vehicle_id=$1, doc_type=$2, doc_number=$3, expiry_date=$4
       WHERE id=$5
         AND vehicle_id IN (SELECT id FROM vehicles WHERE company_id = $6)
       RETURNING *`,
      [b.vehicle_id, b.doc_type, b.doc_number, b.expiry_date, req.params.id, req.user.company_id]
    );
    if (!row) return res.status(404).json({ error: 'Document not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/vehicles/documents/:id ──
router.delete('/documents/:id', rbacMiddleware('vehicles', 'delete'), auditLog('vehicles'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      await query(`DELETE FROM vehicle_documents WHERE id = $1`, [req.params.id]);
      return res.json({ message: 'Document deleted' });
    }

    if (!requireCompanyScope(req, res)) return;
    const document = await getVehicleDocumentOwnership(req.params.id);
    if (!document) return res.json({ message: 'Document deleted' });
    if (!document.company_id || document.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      `DELETE FROM vehicle_documents d
       USING vehicles v
       WHERE d.id = $1
         AND d.vehicle_id = v.id
         AND v.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    res.json({ message: 'Document deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
