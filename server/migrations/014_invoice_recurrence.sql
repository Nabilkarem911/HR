-- 014: Recurring invoice scheduling
-- is_recurring: whether the invoice auto-generates a new payment each cycle
-- due_day: day-of-month the invoice falls due (e.g. 9 = 9th of each month)
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS due_day INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'invoices_due_day_check'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_due_day_check CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31));
    END IF;
END $$;
