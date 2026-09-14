const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { auditLog } = require('../middleware/auditLog');
const { runSchedulerTick, buildCycleLabel, nextDateForDay } = require('../services/scheduler');
const { sendWhatsAppMessage } = require('../services/wahaClient');
const { formatDualDate, toISODate } = require('../utils/helpers');

const router = express.Router();

// ── Allowed enum values ──
const VALID_CYCLES = ['monthly', 'quarterly', 'semi_annual', 'annual'];
const VALID_CATEGORIES = ['electricity', 'internet', 'warehouse', 'rent', 'gosi', 'water', 'other'];
const VALID_INVOICE_STATUS = ['active', 'paused', 'closed'];
const VALID_PAYMENT_STATUS = ['upcoming', 'due', 'overdue', 'paid'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Company scope helpers ──
function requireCompanyScope(req, res) {
  if (req.user.role !== 'super_admin' && !req.user.company_id) {
    res.status(403).json({ error: 'Company scope is required' });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════
// STATIC ROUTES (must be defined before /:id to avoid conflicts)
// ═══════════════════════════════════════════════════════

// ── GET /api/invoices (list) ──
router.get('/', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { status, category, search, date_from, date_to } = req.query;
    const where = [];
    const params = [];

    if (req.user.role !== 'super_admin') {
      where.push(`i.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (status) {
      where.push(`i.status = $${params.length + 1}`);
      params.push(status);
    }
    if (category) {
      where.push(`i.category = $${params.length + 1}`);
      params.push(category);
    }
    if (search) {
      where.push(`(i.title ILIKE $${params.length + 1} OR i.provider_name ILIKE $${params.length + 1}
        OR i.billing_number ILIKE $${params.length + 1} OR i.sadad_number ILIKE $${params.length + 1}
        OR i.account_number ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
      where.push(`i.next_due_date >= $${params.length + 1}`);
      params.push(date_from);
    }
    if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
      where.push(`i.next_due_date <= $${params.length + 1}`);
      params.push(date_to);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await queryAll(
      `SELECT i.*, c.name as company_name,
        (SELECT COUNT(*) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.status = 'overdue') as overdue_count,
        (SELECT COUNT(*) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.status = 'due') as due_count
       FROM invoices i
       LEFT JOIN companies c ON i.company_id = c.id
       ${whereClause}
       ORDER BY i.created_at DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/categories (list all active categories) ──
router.get('/categories', async (req, res, next) => {
  try {
    const where = [`c.is_active = true`];
    const params = [];
    // Show global categories (company_id IS NULL) + company-specific categories
    if (req.user.role !== 'super_admin' && req.user.company_id) {
      where.push(`(c.company_id IS NULL OR c.company_id = $${params.length + 1})`);
      params.push(req.user.company_id);
    }
    const rows = await queryAll(
      `SELECT c.*, co.name as company_name FROM invoice_categories c
       LEFT JOIN companies co ON c.company_id = co.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.sort_order ASC, c.name ASC`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/invoices/categories ──
router.post('/categories', rbacMiddleware('invoices', 'edit'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const b = req.body;
    if (!b.name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const companyId = req.user.role === 'super_admin' ? (b.company_id || null) : req.user.company_id;
    const row = await queryOne(
      `INSERT INTO invoice_categories (company_id, name, name_ar, icon, color, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [companyId, b.name, b.name_ar || null, b.icon || 'fa-tag', b.color || 'slate', b.sort_order || 0, b.is_active !== false]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/invoices/categories/:id ──
router.put('/categories/:id', rbacMiddleware('invoices', 'edit'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoice_categories WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    // Global categories (company_id IS NULL) can only be edited by super_admin
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const row = await queryOne(
      `UPDATE invoice_categories SET
        name = COALESCE($1, name),
        name_ar = COALESCE($2, name_ar),
        icon = COALESCE($3, icon),
        color = COALESCE($4, color),
        sort_order = COALESCE($5, sort_order),
        is_active = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [b.name || null, b.name_ar !== undefined ? b.name_ar : null, b.icon || null, b.color || null, b.sort_order !== undefined ? b.sort_order : null, b.is_active !== undefined ? b.is_active : null, req.params.id]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/invoices/categories/:id ──
router.delete('/categories/:id', rbacMiddleware('invoices', 'edit'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoice_categories WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await query(`DELETE FROM invoice_categories WHERE id = $1`, [req.params.id]);
    res.json({ data: { id: req.params.id } });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/stats ──
router.get('/stats', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const where = [];
    const params = [];
    if (req.user.role !== 'super_admin') {
      where.push(`p.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const stats = await queryOne(
      `SELECT
        COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('due','overdue')), 0) as total_due_amount,
        COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status = 'paid'), 0) as total_paid_amount
       FROM invoice_payments p
       ${whereClause}`,
      params
    );

    // Count upcoming: payments with status 'upcoming' + active invoices with future next_due_date (no payment yet)
    const upcomingRes = await queryOne(
      `SELECT COUNT(*) as count FROM (
         SELECT p.id FROM invoice_payments p WHERE p.status = 'upcoming' ${whereClause ? 'AND ' + whereClause.substring(6) : ''}
         UNION ALL
         SELECT i.id FROM invoices i WHERE i.status = 'active' AND i.next_due_date > CURRENT_DATE ${whereClause ? 'AND ' + whereClause.substring(6).replace(/p\./g, 'i.') : ''}
           AND NOT EXISTS (SELECT 1 FROM invoice_payments p2 WHERE p2.invoice_id = i.id AND p2.due_date = i.next_due_date)
       ) t`,
      params
    );

    // Count due: payments with status 'due' + active invoices due today (no payment yet)
    const dueRes = await queryOne(
      `SELECT COUNT(*) as count FROM (
         SELECT p.id FROM invoice_payments p WHERE p.status = 'due' ${whereClause ? 'AND ' + whereClause.substring(6) : ''}
         UNION ALL
         SELECT i.id FROM invoices i WHERE i.status = 'active' AND i.next_due_date = CURRENT_DATE ${whereClause ? 'AND ' + whereClause.substring(6).replace(/p\./g, 'i.') : ''}
           AND NOT EXISTS (SELECT 1 FROM invoice_payments p2 WHERE p2.invoice_id = i.id AND p2.due_date = i.next_due_date)
       ) t`,
      params
    );

    // Count overdue: payments with status 'overdue' + active invoices past due (no payment yet)
    const overdueRes = await queryOne(
      `SELECT COUNT(*) as count FROM (
         SELECT p.id FROM invoice_payments p WHERE p.status = 'overdue' ${whereClause ? 'AND ' + whereClause.substring(6) : ''}
         UNION ALL
         SELECT i.id FROM invoices i WHERE i.status = 'active' AND i.next_due_date < CURRENT_DATE ${whereClause ? 'AND ' + whereClause.substring(6).replace(/p\./g, 'i.') : ''}
           AND NOT EXISTS (SELECT 1 FROM invoice_payments p2 WHERE p2.invoice_id = i.id AND p2.due_date = i.next_due_date)
       ) t`,
      params
    );

    // Count paid: only from payments
    const paidRes = await queryOne(
      `SELECT COUNT(*) as count FROM invoice_payments p WHERE p.status = 'paid' ${whereClause ? 'AND ' + whereClause.substring(6) : ''}`,
      params
    );

    stats.upcoming = parseInt(upcomingRes.count) || 0;
    stats.due = parseInt(dueRes.count) || 0;
    stats.overdue = parseInt(overdueRes.count) || 0;
    stats.paid = parseInt(paidRes.count) || 0;

    res.json({ data: stats });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/payments/all ──
router.get('/payments/all', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const { status } = req.query;
    const where = [];
    const params = [];
    if (req.user.role !== 'super_admin') {
      where.push(`p.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    if (status) {
      where.push(`p.status = $${params.length + 1}`);
      params.push(status);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await queryAll(
      `SELECT p.*, i.title as invoice_title, i.category, i.provider_name, i.billing_number, i.sadad_number,
        c.name as company_name
       FROM invoice_payments p
       JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN companies c ON p.company_id = c.id
       ${whereClause}
       ORDER BY p.due_date DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── PUT /api/invoices/payments/:paymentId ──
router.put('/payments/:paymentId', rbacMiddleware('invoices', 'manage_payments'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.paymentId)) return res.status(400).json({ error: 'Invalid payment ID' });
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoice_payments WHERE id = $1`, [req.params.paymentId]);
    if (!existing) return res.status(404).json({ error: 'Payment not found' });
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    let status = b.status || existing.status;
    if (!VALID_PAYMENT_STATUS.includes(status)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    let paidDate = existing.paid_date;
    let paidAmount = existing.paid_amount;
    let paymentRef = existing.payment_ref;
    let paymentMethod = existing.payment_method;

    if (status === 'paid') {
      paidDate = b.paid_date || new Date().toISOString().split('T')[0];
      paidAmount = b.paid_amount !== undefined ? b.paid_amount : existing.amount;
      paymentRef = b.payment_ref !== undefined ? b.payment_ref : paymentRef;
      paymentMethod = b.payment_method || paymentMethod;
    }

    // Validate non-negative amounts
    if (paidAmount !== null && paidAmount < 0) {
      return res.status(400).json({ error: 'Paid amount cannot be negative' });
    }

    const row = await queryOne(
      `UPDATE invoice_payments SET
        status = $1, paid_date = $2, paid_amount = $3, payment_ref = $4, payment_method = $5, notes = $6
       WHERE id = $7 RETURNING *`,
      [status, paidDate, paidAmount, paymentRef, paymentMethod, b.notes !== undefined ? b.notes : existing.notes, req.params.paymentId]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/recipients/list ──
router.get('/recipients/list', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const where = [];
    const params = [];
    if (req.user.role !== 'super_admin') {
      where.push(`r.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await queryAll(
      `SELECT r.*, c.name as company_name FROM invoice_recipients r
       LEFT JOIN companies c ON r.company_id = c.id
       ${whereClause} ORDER BY r.created_at DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/invoices/recipients ──
router.post('/recipients', rbacMiddleware('invoices', 'manage_recipients'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const b = req.body;
    if (!b.name || !b.phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }
    const companyId = req.user.role === 'super_admin' ? (b.company_id || null) : req.user.company_id;
    const row = await queryOne(
      `INSERT INTO invoice_recipients (company_id, name, phone, role_label, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [companyId, b.name, b.phone, b.role_label || null, b.is_active !== false]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/invoices/recipients/:id ──
router.put('/recipients/:id', rbacMiddleware('invoices', 'manage_recipients'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid recipient ID' });
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoice_recipients WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Recipient not found' });
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const row = await queryOne(
      `UPDATE invoice_recipients SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        role_label = COALESCE($3, role_label),
        is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING *`,
      [b.name || null, b.phone || null, b.role_label !== undefined ? b.role_label : null, b.is_active !== undefined ? b.is_active : null, req.params.id]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/invoices/recipients/:id ──
router.delete('/recipients/:id', rbacMiddleware('invoices', 'manage_recipients'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid recipient ID' });
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoice_recipients WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Recipient not found' });
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await query(`DELETE FROM invoice_recipients WHERE id = $1`, [req.params.id]);
    res.json({ data: { id: req.params.id } });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/reminders/log ──
router.get('/reminders/log', async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const where = [];
    const params = [];
    if (req.user.role !== 'super_admin') {
      where.push(`i.company_id = $${params.length + 1}`);
      params.push(req.user.company_id);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await queryAll(
      `SELECT r.id, r.invoice_id, r.payment_id, r.recipient_phone, r.status, r.sent_at, r.created_at,
        i.title as invoice_title
       FROM invoice_reminders r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       ${whereClause}
       ORDER BY r.created_at DESC LIMIT 100`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/invoices/scheduler/tick ──
router.post('/scheduler/tick', rbacMiddleware('invoices', 'edit'), async (req, res, next) => {
  try {
    await runSchedulerTick();
    res.json({ data: { message: 'Scheduler tick executed' } });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// PARAMETRIC ROUTES (/:id — defined after all static routes)
// ═══════════════════════════════════════════════════════

// ── GET /api/invoices/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
    if (!requireCompanyScope(req, res)) return;
    const inv = await queryOne(
      `SELECT i.*, c.name as company_name FROM invoices i
       LEFT JOIN companies c ON i.company_id = c.id WHERE i.id = $1`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'super_admin' && inv.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ data: inv });
  } catch (err) { next(err); }
});

// ── POST /api/invoices ──
router.post('/', rbacMiddleware('invoices', 'add'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!requireCompanyScope(req, res)) return;
    const b = req.body;
    const companyId = req.user.role === 'super_admin' ? (b.company_id || null) : req.user.company_id;
    const isRecurring = b.is_recurring !== false; // default true for backward compatibility
    const dueDay = b.due_day !== undefined && b.due_day !== null && b.due_day !== ''
      ? Math.min(Math.max(parseInt(b.due_day) || 1, 1), 31) : null;

    // For recurring monthly invoices, derive next_due_date from due_day
    // (computed from start_date if it's in the future, otherwise from today)
    const today = new Date().toISOString().split('T')[0];
    const isMonthlyRecurring = isRecurring && (b.cycle || 'monthly') === 'monthly';
    const nextDueDate = (isMonthlyRecurring && dueDay)
      ? nextDateForDay(dueDay, (b.start_date && b.start_date > today) ? b.start_date : null)
      : b.next_due_date;

    if (!b.title || !b.start_date || !nextDueDate) {
      return res.status(400).json({ error: 'title, start_date, next_due_date are required' });
    }
    if (b.cycle && !VALID_CYCLES.includes(b.cycle)) {
      return res.status(400).json({ error: 'Invalid cycle' });
    }
    if (b.category && !VALID_CATEGORIES.includes(b.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (b.status && !VALID_INVOICE_STATUS.includes(b.status)) {
      return res.status(400).json({ error: 'Invalid invoice status' });
    }
    if (b.amount !== undefined && b.amount !== null && Number(b.amount) < 0) {
      return res.status(400).json({ error: 'Amount cannot be negative' });
    }

    const row = await queryOne(
      `INSERT INTO invoices (company_id, title, category, provider_name, account_number, billing_number, sadad_number, amount, cycle, start_date, end_date, next_due_date, reminder_days_before, status, notes, created_by, is_recurring, due_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        companyId, b.title, b.category || 'other', b.provider_name || null,
        b.account_number || null, b.billing_number || null, b.sadad_number || null,
        b.amount || 0, b.cycle || 'monthly', b.start_date, b.end_date || null,
        nextDueDate, b.reminder_days_before || 3, b.status || 'active',
        b.notes || null, req.user.id || null, isRecurring, dueDay
      ]
    );
    // Create the first payment record so stats show correctly
    if (nextDueDate) {
      const cycleLabel = buildCycleLabel(new Date(nextDueDate), b.cycle || 'monthly');
      await query(
        `INSERT INTO invoice_payments (invoice_id, company_id, cycle_label, due_date, amount, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, companyId, cycleLabel, nextDueDate, b.amount || 0, nextDueDate <= today ? 'due' : 'upcoming']
      );
    }
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/invoices/:id ──
router.put('/:id', rbacMiddleware('invoices', 'edit'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    if (b.cycle && !VALID_CYCLES.includes(b.cycle)) {
      return res.status(400).json({ error: 'Invalid cycle' });
    }
    if (b.category && !VALID_CATEGORIES.includes(b.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (b.status && !VALID_INVOICE_STATUS.includes(b.status)) {
      return res.status(400).json({ error: 'Invalid invoice status' });
    }
    if (b.amount !== undefined && b.amount !== null && Number(b.amount) < 0) {
      return res.status(400).json({ error: 'Amount cannot be negative' });
    }

    // Resolve recurrence fields
    const isRecurring = b.is_recurring !== undefined ? b.is_recurring !== false : existing.is_recurring !== false;
    const dueDay = b.due_day !== undefined
      ? (b.due_day === null || b.due_day === '' ? null : Math.min(Math.max(parseInt(b.due_day) || 1, 1), 31))
      : existing.due_day;
    // For recurring monthly invoices, recompute next_due_date only when due_day changed
    const effectiveCycle = b.cycle || existing.cycle;
    let nextDueDate = b.next_due_date || existing.next_due_date;
    const dueDayChanged = b.due_day !== undefined && dueDay !== existing.due_day;
    if (isRecurring && effectiveCycle === 'monthly' && dueDay && dueDayChanged) {
      nextDueDate = nextDateForDay(dueDay, null);
    }

    const row = await queryOne(
      `UPDATE invoices SET
        title = COALESCE($1, title),
        category = COALESCE($2, category),
        provider_name = COALESCE($3, provider_name),
        account_number = COALESCE($4, account_number),
        billing_number = COALESCE($5, billing_number),
        sadad_number = COALESCE($6, sadad_number),
        amount = COALESCE($7, amount),
        cycle = COALESCE($8, cycle),
        end_date = $9,
        next_due_date = COALESCE($10, next_due_date),
        reminder_days_before = COALESCE($11, reminder_days_before),
        status = COALESCE($12, status),
        notes = $13,
        is_recurring = $15,
        due_day = $16
       WHERE id = $14 RETURNING *`,
      [
        b.title || null, b.category || null, b.provider_name || null,
        b.account_number || null, b.billing_number || null, b.sadad_number || null,
        b.amount !== undefined ? b.amount : null, b.cycle || null,
        b.end_date !== undefined ? b.end_date : null, nextDueDate,
        b.reminder_days_before !== undefined ? b.reminder_days_before : null,
        b.status || null, b.notes !== undefined ? b.notes : null, req.params.id,
        isRecurring, dueDay
      ]
    );
    // Sync invoice_payments when next_due_date changes
    // (toISODate uses local date parts — toISOString() would shift the day in UTC+N timezones)
    const existingDue = toISODate(existing.next_due_date);
    if (nextDueDate && nextDueDate !== existingDue) {
      const cycleLabel = buildCycleLabel(new Date(nextDueDate), row.cycle);
      // Update existing unpaid payment or create new one
      const existingPayment = await queryOne(
        `SELECT id FROM invoice_payments WHERE invoice_id = $1 AND status = 'upcoming' AND due_date = $2`,
        [req.params.id, existingDue]
      );
      if (existingPayment) {
        await query(
          `UPDATE invoice_payments SET due_date = $1, cycle_label = $2, amount = $3 WHERE id = $4`,
          [nextDueDate, cycleLabel, row.amount, existingPayment.id]
        );
      } else {
        await query(
          `INSERT INTO invoice_payments (invoice_id, company_id, cycle_label, due_date, amount, status)
           VALUES ($1, $2, $3, $4, $5, 'upcoming')`,
          [req.params.id, row.company_id, cycleLabel, nextDueDate, row.amount]
        );
      }
    }
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── DELETE /api/invoices/:id ──
router.delete('/:id', rbacMiddleware('invoices', 'delete'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
    if (!requireCompanyScope(req, res)) return;
    const existing = await queryOne(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'super_admin' && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await query(`DELETE FROM invoices WHERE id = $1`, [req.params.id]);
    res.json({ data: { id: req.params.id } });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/:id/payments ──
router.get('/:id/payments', async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
    if (!requireCompanyScope(req, res)) return;
    // Check invoice ownership before returning payments
    const inv = await queryOne(`SELECT company_id FROM invoices WHERE id = $1`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'super_admin' && inv.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const rows = await queryAll(
      `SELECT p.*, i.title as invoice_title FROM invoice_payments p
       JOIN invoices i ON p.invoice_id = i.id
       WHERE p.invoice_id = $1 ORDER BY p.due_date DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/invoices/:id/payments ──
router.post('/:id/payments', rbacMiddleware('invoices', 'manage_payments'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
    if (!requireCompanyScope(req, res)) return;
    const inv = await queryOne(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'super_admin' && inv.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    if (!b.due_date) {
      return res.status(400).json({ error: 'due_date is required' });
    }
    if (b.status && !VALID_PAYMENT_STATUS.includes(b.status)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    if (b.amount !== undefined && b.amount !== null && Number(b.amount) < 0) {
      return res.status(400).json({ error: 'Amount cannot be negative' });
    }
    const row = await queryOne(
      `INSERT INTO invoice_payments (invoice_id, company_id, cycle_label, due_date, amount, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, inv.company_id, b.cycle_label || null, b.due_date, b.amount || 0, b.status || 'upcoming', b.notes || null]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// ── POST /api/invoices/:id/send-reminder ──
router.post('/:id/send-reminder', rbacMiddleware('invoices', 'send_reminders'), auditLog('invoices'), async (req, res, next) => {
  try {
    if (!UUID_REGEX.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice ID' });
    if (!requireCompanyScope(req, res)) return;
    const inv = await queryOne(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'super_admin' && inv.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (inv.status !== 'active') {
      return res.status(400).json({ error: 'Cannot send reminders for a paused or closed invoice' });
    }

    const payment = await queryOne(
      `SELECT * FROM invoice_payments WHERE invoice_id = $1 AND status IN ('upcoming','due','overdue') ORDER BY due_date ASC LIMIT 1`,
      [req.params.id]
    );

    const recipients = await queryAll(
      `SELECT name, phone, role_label FROM invoice_recipients WHERE (company_id = $1 OR company_id IS NULL) AND is_active = true`,
      [inv.company_id]
    );

    if (!recipients.length) {
      return res.json({ data: { sent: 0, failed: 0, message: 'No active recipients found' } });
    }

    const statusLabel = payment ? (payment.status === 'overdue' ? 'متأخرة' : 'مستحقة') : 'قادمة';
    const amountFormatted = Number(payment?.amount || inv.amount || 0).toLocaleString();
    const dueDateFormatted = formatDualDate(payment ? payment.due_date : inv.next_due_date);

    let message = `*تنبيه فاتورة ${statusLabel}*\n\n`;
    message += `*الفاتورة:* ${inv.title}\n`;
    if (inv.provider_name) message += `*المزود:* ${inv.provider_name}\n`;
    if (payment?.cycle_label) message += `*الدورة:* ${payment.cycle_label}\n`;
    message += `*تاريخ الاستحقاق:* ${dueDateFormatted}\n`;
    message += `*المبلغ:* ${amountFormatted} ر.س\n`;
    if (inv.billing_number) message += `*رقم الفاتورة:* ${inv.billing_number}\n`;
    if (inv.sadad_number) message += `*رقم سداد:* ${inv.sadad_number}\n`;
    message += `\nيرجى المتابعة والدفع في الوقت المحدد.`;

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      const result = await sendWhatsAppMessage(recipient.phone, message);
      const status = result.success ? 'sent' : 'failed';
      // Store only a truncated/sanitized response — never the token
      const wahaResponse = result.success
        ? (typeof result.response === 'string' ? result.response.substring(0, 500) : JSON.stringify(result.response).substring(0, 500))
        : String(result.error || '').substring(0, 500);

      await query(
        `INSERT INTO invoice_reminders (invoice_id, payment_id, recipient_phone, message, status, waha_response, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [inv.id, payment?.id || null, recipient.phone, message, status, wahaResponse]
      );
      if (result.success) sent++; else failed++;
    }

    res.json({ data: { sent, failed } });
  } catch (err) { next(err); }
});

module.exports = router;
