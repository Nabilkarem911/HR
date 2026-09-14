-- ─────────────────────────────────────────────
-- 015: Invoice Payments Integrity (additive, non-destructive)
-- 1. Detect (do NOT auto-fix) duplicate (invoice_id, due_date) pairs
-- 2. Add UNIQUE(invoice_id, due_date) ONLY if no duplicates exist
-- 3. Indexes for archive queries (paid_date) and paid_by lookups
-- ─────────────────────────────────────────────

-- 1. Report any existing duplicate payment cycles.
--    If duplicates are found, the constraint below is skipped (never forced)
--    and a NOTICE is raised so an operator can review manually.
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT invoice_id, due_date
    FROM invoice_payments
    GROUP BY invoice_id, due_date
    HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE NOTICE 'invoice_payments: % duplicate (invoice_id, due_date) pair(s) detected — UNIQUE constraint NOT added. Manual review required.', dup_count;
  END IF;
END $$;

-- 2. Add the unique constraint only when safe (no duplicates, not already present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoice_payments_invoice_due')
     AND NOT EXISTS (
       SELECT 1 FROM (
         SELECT invoice_id, due_date
         FROM invoice_payments
         GROUP BY invoice_id, due_date
         HAVING COUNT(*) > 1
       ) t
     ) THEN
    ALTER TABLE invoice_payments
      ADD CONSTRAINT uq_invoice_payments_invoice_due UNIQUE (invoice_id, due_date);
  END IF;
END $$;

-- 3. Helper indexes for archive + paid_by queries (partial, cheap)
CREATE INDEX IF NOT EXISTS idx_invoice_payments_paid_date
  ON invoice_payments(paid_date)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS idx_invoice_payments_paid_by
  ON invoice_payments(paid_by)
  WHERE paid_by IS NOT NULL;
