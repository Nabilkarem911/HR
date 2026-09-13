-- ─────────────────────────────────────────────
-- 012: Invoices & Payment Tracking Module
-- Recurring bills (electricity, internet, warehouse, rent, GOSI, etc.)
-- with cycle-based payments, status tracking, and WAHA WhatsApp reminders
-- ─────────────────────────────────────────────

-- 1. invoices: recurring bill definitions
CREATE TABLE IF NOT EXISTS invoices (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id        UUID REFERENCES companies(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    category          TEXT NOT NULL DEFAULT 'other',
    provider_name     TEXT,
    account_number    TEXT,
    billing_number    TEXT,
    sadad_number      TEXT,
    amount            NUMERIC(12,2) DEFAULT 0,
    cycle             TEXT NOT NULL DEFAULT 'monthly',
    start_date        DATE NOT NULL,
    end_date          DATE,
    next_due_date     DATE NOT NULL,
    reminder_days_before INT DEFAULT 3,
    status            TEXT NOT NULL DEFAULT 'active',
    notes             TEXT,
    created_by        UUID,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_next_due ON invoices(next_due_date);

-- 2. invoice_payments: individual payment cycles
CREATE TABLE IF NOT EXISTS invoice_payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,
    cycle_label     TEXT,
    due_date        DATE NOT NULL,
    amount          NUMERIC(12,2) DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'upcoming',
    paid_date       DATE,
    paid_amount     NUMERIC(12,2),
    payment_ref     TEXT,
    payment_method  TEXT,
    paid_by         UUID,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_status ON invoice_payments(status);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_due_date ON invoice_payments(due_date);

-- 3. invoice_recipients: who gets WhatsApp notifications
CREATE TABLE IF NOT EXISTS invoice_recipients (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    role_label  TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_recipients_company ON invoice_recipients(company_id);

-- 4. invoice_reminders: log of reminders sent via WAHA
CREATE TABLE IF NOT EXISTS invoice_reminders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      UUID REFERENCES invoices(id) ON DELETE CASCADE,
    payment_id      UUID REFERENCES invoice_payments(id) ON DELETE CASCADE,
    recipient_phone TEXT,
    message         TEXT,
    status          TEXT DEFAULT 'pending',
    waha_response   TEXT,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice ON invoice_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_payment ON invoice_reminders(payment_id);

-- Add new tables to the updated_at trigger loop
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY['invoices', 'invoice_payments', 'invoice_recipients'])
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;
