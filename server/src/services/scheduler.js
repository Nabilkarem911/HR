/* ==========================================================================
   Invoice Scheduler — Runs periodically to:
   1. Generate invoice_payments for due cycles (when next_due_date arrives)
   2. Update payment statuses: upcoming → due → overdue
   3. Send WhatsApp reminders via WAHA for due/overdue invoices
   ========================================================================== */

const { query, queryAll, queryOne } = require('../config/db');
const { sendWhatsAppMessage } = require('./wahaClient');

const CYCLE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function buildCycleLabel(dueDate, cycle) {
  const d = new Date(dueDate);
  const monthName = ARABIC_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  if (cycle === 'quarterly') {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `Q${q} ${year}`;
  }
  if (cycle === 'semi_annual') {
    const half = d.getMonth() < 6 ? 'الأول' : 'الثاني';
    return `النصف ${half} ${year}`;
  }
  if (cycle === 'annual') {
    return `سنوي ${year}`;
  }
  return `${monthName} ${year}`;
}

function addCycleMonths(date, cycle) {
  const d = new Date(date);
  const months = CYCLE_MONTHS[cycle] || 1;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

// ── 1. Generate payment records for invoices whose next_due_date has arrived or is approaching ──
async function generateDuePayments() {
  const today = new Date().toISOString().split('T')[0];
  // Create payments for invoices due within 2 days (to enable pre-due reminders)
  const lookaheadDate = new Date();
  lookaheadDate.setDate(lookaheadDate.getDate() + 2);
  const lookahead = lookaheadDate.toISOString().split('T')[0];

  // Find active invoices where next_due_date <= today + 2 days and no payment exists for that date
  const dueInvoices = await queryAll(
    `SELECT id, company_id, title, amount, cycle, next_due_date
     FROM invoices
     WHERE status = 'active'
       AND next_due_date <= $1
       AND (end_date IS NULL OR end_date >= $2)
     ORDER BY next_due_date ASC`,
    [lookahead, today]
  );

  console.log(`[scheduler] generateDuePayments: today=${today}, lookahead=${lookahead}, found=${dueInvoices.length} invoices`);
  dueInvoices.forEach(inv => console.log(`  - ${inv.title}: next_due=${inv.next_due_date}`));

  let generated = 0;
  for (const inv of dueInvoices) {
    // Check if a payment already exists for this due_date
    const existing = await queryOne(
      `SELECT id FROM invoice_payments WHERE invoice_id = $1 AND due_date = $2`,
      [inv.id, inv.next_due_date]
    );
    if (existing) {
      // Payment already generated; advance next_due_date only when due date has arrived
      if (inv.next_due_date <= today) {
        const nextDate = addCycleMonths(inv.next_due_date, inv.cycle);
        await query(`UPDATE invoices SET next_due_date = $1 WHERE id = $2`, [nextDate, inv.id]);
      }
      continue;
    }

    const isDue = inv.next_due_date <= today;
    const cycleLabel = buildCycleLabel(inv.next_due_date, inv.cycle);
    await query(
      `INSERT INTO invoice_payments (invoice_id, company_id, cycle_label, due_date, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inv.id, inv.company_id, cycleLabel, inv.next_due_date, inv.amount || 0, isDue ? 'due' : 'upcoming']
    );

    // Only advance next_due_date when the due date has actually arrived
    if (isDue) {
      const nextDate = addCycleMonths(inv.next_due_date, inv.cycle);
      await query(`UPDATE invoices SET next_due_date = $1 WHERE id = $2`, [nextDate, inv.id]);
    }
    generated++;
  }

  return generated;
}

// ── 2. Update payment statuses (upcoming → due, due → overdue) ──
async function updatePaymentStatuses() {
  const today = new Date().toISOString().split('T')[0];

  // upcoming → due (due_date <= today and not paid)
  const dueResult = await query(
    `UPDATE invoice_payments
     SET status = 'due'
     WHERE status = 'upcoming' AND due_date <= $1
     RETURNING id`,
    [today]
  );

  // due → overdue (due_date < today and not paid)
  const overdueResult = await query(
    `UPDATE invoice_payments
     SET status = 'overdue'
     WHERE status = 'due' AND due_date < $1
     RETURNING id`,
    [today]
  );

  return {
    markedDue: dueResult.rowCount || 0,
    markedOverdue: overdueResult.rowCount || 0,
  };
}

// ── 3. Send WhatsApp reminders for due/overdue payments ──
async function sendReminders() {
  const today = new Date().toISOString().split('T')[0];

  // Find payments that need reminders:
  // - upcoming payments at 2 days or 1 day before due date
  // - due payments (due today)
  // - overdue payments (past due)
  // An invoice has reminder_days_before; we remind when due_date - reminder_days_before <= today
  const paymentsNeedingReminders = await queryAll(
    `SELECT p.id AS payment_id, p.invoice_id, p.cycle_label, p.due_date, p.amount, p.status,
            i.title, i.category, i.provider_name, i.billing_number, i.sadad_number,
            i.reminder_days_before, i.company_id,
            (p.due_date - CURRENT_DATE) AS days_remaining
     FROM invoice_payments p
     JOIN invoices i ON p.invoice_id = i.id
     WHERE p.status IN ('upcoming', 'due', 'overdue')
       AND (
         p.status IN ('due', 'overdue')
         OR (p.status = 'upcoming' AND (p.due_date - CURRENT_DATE) IN (1, 2))
       )
       AND p.id NOT IN (
         SELECT payment_id FROM invoice_reminders
         WHERE sent_at::date = $1 AND status = 'sent'
       )
     ORDER BY p.due_date ASC`,
    [today]
  );

  let sent = 0;
  let failed = 0;

  for (const p of paymentsNeedingReminders) {
    // Get active recipients for this company (or global recipients if company_id is NULL)
    const recipients = await queryAll(
      `SELECT name, phone, role_label FROM invoice_recipients
       WHERE (company_id = $1 OR company_id IS NULL) AND is_active = true`,
      [p.company_id]
    );

    if (!recipients.length) continue;

    const daysRemaining = Number(p.days_remaining);
    const statusLabel = p.status === 'overdue' ? 'متأخرة' : daysRemaining === 0 ? 'مستحقة اليوم' : daysRemaining === 1 ? 'تستحق غداً' : 'تستحق بعد يومين';
    const amountFormatted = Number(p.amount || 0).toLocaleString();
    const dueDateFormatted = new Date(p.due_date).toLocaleDateString('ar-SA');

    let message = `*تنبيه فاتورة ${statusLabel}*\n\n`;
    message += `*الفاتورة:* ${p.title}\n`;
    if (p.provider_name) message += `*المزود:* ${p.provider_name}\n`;
    message += `*الدورة:* ${p.cycle_label}\n`;
    message += `*تاريخ الاستحقاق:* ${dueDateFormatted}\n`;
    message += `*المبلغ:* ${amountFormatted} ر.س\n`;
    if (p.billing_number) message += `*رقم الفاتورة:* ${p.billing_number}\n`;
    if (p.sadad_number) message += `*رقم سداد:* ${p.sadad_number}\n`;
    message += `\nيرجى المتابعة والدفع في الوقت المحدد.`;

    for (const recipient of recipients) {
      const result = await sendWhatsAppMessage(recipient.phone, message);
      const status = result.success ? 'sent' : 'failed';
      const wahaResponse = result.success
        ? (typeof result.response === 'string' ? result.response : JSON.stringify(result.response))
        : result.error;

      await query(
        `INSERT INTO invoice_reminders (invoice_id, payment_id, recipient_phone, message, status, waha_response, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [p.invoice_id, p.payment_id, recipient.phone, message, status, wahaResponse]
      );

      if (result.success) sent++;
      else failed++;
    }
  }

  return { sent, failed };
}

// ── Distributed lock: prevents multiple server instances from running scheduler tick simultaneously ──
async function acquireSchedulerLock() {
  try {
    // Try to acquire a lock by inserting a row; if it already exists and is recent, skip
    const lockKey = 'invoice_scheduler_tick';
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - 5 * 60 * 1000); // 5 min lock expiry

    // Delete expired locks
    await query(`DELETE FROM system_settings WHERE setting_key = $1 AND updated_at < $2`, [lockKey, lockExpiry]);

    // Try to insert/update atomically using upsert with a condition
    const result = await queryOne(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
       WHERE system_settings.updated_at < $3
       RETURNING setting_key`,
      [lockKey, now.toISOString(), lockExpiry]
    );

    return result !== null;
  } catch (err) {
    console.error('[scheduler] Lock acquisition error:', err.message);
    return false;
  }
}

// ── Main tick: run all scheduler tasks ──
async function runSchedulerTick() {
  // Acquire distributed lock to prevent duplicate execution across instances
  const acquired = await acquireSchedulerLock();
  if (!acquired) {
    console.log('[scheduler] Skipped — another instance is running the tick');
    return;
  }

  try {
    const generated = await generateDuePayments();
    console.log(`[scheduler] generateDuePayments: ${generated} payments created`);
    const statusUpdates = await updatePaymentStatuses();
    console.log(`[scheduler] updatePaymentStatuses: due=${statusUpdates.markedDue}, overdue=${statusUpdates.markedOverdue}`);
    const reminders = await sendReminders();
    console.log(`[scheduler] sendReminders: sent=${reminders.sent}, failed=${reminders.failed}`);

    if (generated > 0 || statusUpdates.markedDue > 0 || statusUpdates.markedOverdue > 0 || reminders.sent > 0 || reminders.failed > 0) {
      console.log(`[scheduler] Payments generated: ${generated}, due: ${statusUpdates.markedDue}, overdue: ${statusUpdates.markedOverdue}, reminders sent: ${reminders.sent}, failed: ${reminders.failed}`);
    }
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
  }
}

// ── Start the scheduler with configurable interval (default: 1 hour) ──
let schedulerIntervalId = null;

function startScheduler(intervalMs) {
  if (schedulerIntervalId) return;

  // Allow disabling scheduler on secondary instances via env var
  if (process.env.SCHEDULER_ENABLED === 'false' || process.env.SCHEDULER_ENABLED === '0') {
    console.log('[scheduler] Scheduler disabled via SCHEDULER_ENABLED env var');
    return;
  }

  const interval = intervalMs || parseInt(process.env.SCHEDULER_INTERVAL_MS || '3600000'); // 1 hour default
  console.log(`[scheduler] Invoice scheduler started (interval: ${interval}ms)`);

  // Run once on startup (after 10s delay to let server fully start)
  setTimeout(() => {
    runSchedulerTick();
  }, 10000);

  // Then run periodically
  schedulerIntervalId = setInterval(() => {
    runSchedulerTick();
  }, interval);
}

function stopScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    console.log('[scheduler] Invoice scheduler stopped');
  }
}

module.exports = { startScheduler, stopScheduler, runSchedulerTick, buildCycleLabel };
