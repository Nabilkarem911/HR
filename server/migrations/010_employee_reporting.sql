-- 010_employee_reporting.sql
-- ORG-002: Add employee reporting relationships (manager_id self-referential FK).
-- Additive only: one nullable column + index on employees. No existing column/table modified or dropped.
-- Rollback: ALTER TABLE employees DROP COLUMN IF EXISTS manager_id;

-- ─────────────────────────────────────────────
-- 1. Link employees to their direct manager (self-referential)
-- ─────────────────────────────────────────────
ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);
