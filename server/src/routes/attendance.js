const express = require('express');
const { pool, query, queryOne, queryAll } = require('../config/db');
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

async function getEmployeeCompany(employeeId, client = null) {
  const result = client
    ? await client.query(`SELECT id, company_id FROM employees WHERE id = $1`, [employeeId])
    : await query(`SELECT id, company_id FROM employees WHERE id = $1`, [employeeId]);
  return result.rows[0] || null;
}

async function assertEmployeeAccess(req, res, employeeId, client = null) {
  if (!requireCompanyScope(req, res)) return null;
  const employee = await getEmployeeCompany(employeeId, client);
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

// ── GET /api/attendance ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { month_year, company_id } = req.query;
    let sql = `SELECT a.*, e.first_name, e.last_name FROM monthly_attendance a LEFT JOIN employees e ON a.emp_id = e.id`;
    let params = [];
    let clauses = [];

    if (req.user.role !== 'super_admin' && req.user.company_id) {
      clauses.push(`e.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (month_year) { clauses.push(`a.month_year = $${params.length + 1}`); params.push(month_year); }
    if (company_id) { clauses.push(`a.company_id = $${params.length + 1}`); params.push(company_id); }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY a.created_at DESC';

    const { page, limit, offset } = paginate(req);
    let countSql = `SELECT COUNT(*) as count FROM monthly_attendance a LEFT JOIN employees e ON a.emp_id = e.id`;
    if (clauses.length) countSql += ' WHERE ' + clauses.join(' AND ');
    const countRow = await queryOne(countSql, params);
    const rows = await queryAll(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    const data = rows.map(r => ({
      ...r,
      employees: { id: r.emp_id, first_name: r.first_name, last_name: r.last_name },
    }));
    res.json({ data, total: parseInt(countRow?.count || 0), page, limit });
  } catch (err) { next(err); }
});

// ── DELETE /api/attendance (delete by filters) ──
router.delete('/', rbacMiddleware('attendance', 'edit'), auditLog('attendance'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { month_year, company_id, emp_id_in } = req.query;
    let clauses = [];
    let params = [];

    if (month_year) { clauses.push(`a.month_year = $${params.length + 1}`); params.push(month_year); }
    if (company_id) { clauses.push(`a.company_id = $${params.length + 1}`); params.push(company_id); }
    if (emp_id_in) {
      let arr = emp_id_in;
      try { arr = JSON.parse(arr); } catch (_) {}
      if (!Array.isArray(arr)) arr = [arr];
      const placeholders = arr.map((_, i) => `$${params.length + 1 + i}`).join(',');
      clauses.push(`a.emp_id IN (${placeholders})`);
      params.push(...arr);
    }

    if (clauses.length === 0) {
      return res.status(400).json({ error: 'At least one filter required for delete' });
    }

    if (req.user.role === 'super_admin') {
      const result = await query(
        `DELETE FROM monthly_attendance a WHERE ${clauses.join(' AND ')} RETURNING id`,
        params
      );
      return res.json({ data: result.rows, deleted: result.rowCount });
    }

    const scopeParam = params.length + 1;
    const targetCount = await queryOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id = $${scopeParam})::int AS in_scope
       FROM monthly_attendance a
       LEFT JOIN employees e ON e.id = a.emp_id
       WHERE ${clauses.join(' AND ')}`,
      [...params, req.user.company_id]
    );
    if (targetCount.total !== targetCount.in_scope) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await query(
      `DELETE FROM monthly_attendance a
       USING employees e
       WHERE a.emp_id = e.id
         AND e.company_id = $${scopeParam}
         AND ${clauses.join(' AND ')}
       RETURNING a.id`,
      [...params, req.user.company_id]
    );
    res.json({ data: result.rows, deleted: result.rowCount });
  } catch (err) { next(err); }
});

// ── POST /api/attendance/batch ──
router.post('/batch', rbacMiddleware('attendance', 'add'), auditLog('attendance'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
    if (records.length === 0) return res.status(201).json({ data: [] });

    if (req.user.role !== 'super_admin') {
      for (const b of records) {
        if (!(await assertEmployeeAccess(req, res, b.emp_id))) return;
      }
    }

    const client = await pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');

      if (req.user.role !== 'super_admin') {
        for (const b of records) {
          if (!(await assertEmployeeAccess(req, res, b.emp_id, client))) {
            await client.query('ROLLBACK');
            return;
          }
        }
      }

      const deleteGroups = new Map();
      for (const b of records) {
        const key = String(b.month_year);
        if (!deleteGroups.has(key)) deleteGroups.set(key, []);
        if (!deleteGroups.get(key).includes(b.emp_id)) deleteGroups.get(key).push(b.emp_id);
      }

      for (const [monthYear, employeeIds] of deleteGroups) {
        const placeholders = employeeIds.map((_, i) => `$${i + 2}`).join(',');
        const deleteParams = [monthYear, ...employeeIds];
        if (req.user.role === 'super_admin') {
          await client.query(
            `DELETE FROM monthly_attendance
             WHERE month_year = $1 AND emp_id IN (${placeholders})`,
            deleteParams
          );
        } else {
          await client.query(
            `DELETE FROM monthly_attendance a
             USING employees e
             WHERE a.month_year = $1
               AND a.emp_id IN (${placeholders})
               AND a.emp_id = e.id
               AND e.company_id = $${employeeIds.length + 2}`,
            [...deleteParams, req.user.company_id]
          );
        }
      }

      for (const b of records) {
        const rowResult = await client.query(
          `INSERT INTO monthly_attendance (emp_id, company_id, month_year, days_present, days_absent, hours_overtime, hours_late)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (emp_id, month_year) DO UPDATE SET days_present=$4, days_absent=$5, hours_overtime=$6, hours_late=$7
           RETURNING *`,
          [b.emp_id, req.user.role === 'super_admin' ? b.company_id : req.user.company_id, b.month_year, b.days_present || 0, b.days_absent || 0, b.hours_overtime || 0, b.hours_late || 0]
        );
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

// ── PUT /api/attendance/:id ──
router.put('/:id', rbacMiddleware('attendance', 'edit'), auditLog('attendance'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      const b = req.body;
      const row = await queryOne(
        `UPDATE monthly_attendance SET days_present=$1, days_absent=$2, hours_overtime=$3, hours_late=$4 WHERE id=$5 RETURNING *`,
        [b.days_present, b.days_absent, b.hours_overtime, b.hours_late, req.params.id]
      );
      if (!row) return res.status(404).json({ error: 'Record not found' });
      return res.json({ data: row });
    }

    if (!requireCompanyScope(req, res)) return;
    const attendance = await queryOne(
      `SELECT a.id, e.company_id
       FROM monthly_attendance a
       LEFT JOIN employees e ON e.id = a.emp_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!attendance) return res.status(404).json({ error: 'Record not found' });
    if (!attendance.company_id || attendance.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    const row = await queryOne(
      `UPDATE monthly_attendance
       SET days_present=$1, days_absent=$2, hours_overtime=$3, hours_late=$4
       WHERE id=$5
         AND emp_id IN (SELECT id FROM employees WHERE company_id = $6)
       RETURNING *`,
      [b.days_present, b.days_absent, b.hours_overtime, b.hours_late, req.params.id, req.user.company_id]
    );
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

module.exports = router;
