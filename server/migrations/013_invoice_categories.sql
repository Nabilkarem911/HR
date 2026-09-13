-- ─────────────────────────────────────────────
-- 013: Invoice Categories — dynamic categories for invoice classification
-- Allows adding/editing/deleting categories via UI instead of hardcoded values
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    name_ar     TEXT,
    icon        TEXT DEFAULT 'fa-tag',
    color       TEXT DEFAULT 'slate',
    is_active   BOOLEAN DEFAULT true,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories (global, company_id = NULL means shared across all companies)
INSERT INTO invoice_categories (id, name, name_ar, icon, color, sort_order) VALUES
    (uuid_generate_v4(), 'electricity', 'كهرباء', 'fa-bolt', 'amber', 1),
    (uuid_generate_v4(), 'internet', 'إنترنت', 'fa-wifi', 'blue', 2),
    (uuid_generate_v4(), 'warehouse', 'مستودع', 'fa-warehouse', 'indigo', 3),
    (uuid_generate_v4(), 'rent', 'إيجار', 'fa-building', 'emerald', 4),
    (uuid_generate_v4(), 'gosi', 'تأمينات اجتماعية', 'fa-shield-halved', 'violet', 5),
    (uuid_generate_v4(), 'water', 'مياه', 'fa-droplet', 'cyan', 6),
    (uuid_generate_v4(), 'other', 'أخرى', 'fa-tag', 'slate', 99)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_invoice_categories_company ON invoice_categories(company_id);
CREATE INDEX IF NOT EXISTS idx_invoice_categories_active ON invoice_categories(is_active);

-- Add to updated_at trigger loop
DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_invoice_categories_updated_at ON invoice_categories;
    CREATE TRIGGER trg_invoice_categories_updated_at
        BEFORE UPDATE ON invoice_categories
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END $$;
