-- ═══════════════════════════════════════════════════════════
-- Migration 001: Database Audit Fixes
-- 1. Add updated_at to all tables
-- 2. Add soft delete (deleted_at) to companies & system_users
-- 3. Add index on system_users.phone (login performance)
-- 4. Auto-update trigger for updated_at
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. updated_at columns
-- ─────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE issued_letters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE monthly_attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE vehicle_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ─────────────────────────────────────────────
-- 2. Soft delete columns
-- ─────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_companies_deleted_at ON companies(deleted_at);
CREATE INDEX IF NOT EXISTS idx_system_users_deleted_at ON system_users(deleted_at);

-- ─────────────────────────────────────────────
-- 3. Phone index on system_users (login lookup)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_system_users_phone ON system_users(phone);

-- ─────────────────────────────────────────────
-- 3.5 Fix existing empty-string emails (NULL doesn't violate UNIQUE)
-- ─────────────────────────────────────────────
UPDATE employees SET email = NULL WHERE email = '';
UPDATE system_users SET email = NULL WHERE email = '';

-- ─────────────────────────────────────────────
-- 4. Auto-update trigger for updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY[
            'companies', 'employees', 'system_users', 'employee_documents',
            'employee_assets', 'employee_requests', 'issued_letters',
            'monthly_attendance', 'vehicles', 'vehicle_documents',
            'system_settings'
        ])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', t, t
        );
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
            t, t
        );
    END LOOP;
END $$;
