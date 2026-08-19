-- ═══════════════════════════════════════════════════════════
-- Migration 004: Make employee email unique only for active records
-- Soft-deleted employees should not block re-use of their email.
-- ═══════════════════════════════════════════════════════════

-- Drop the blanket unique constraint on employees.email
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_key;

-- Create a partial unique index that only enforces uniqueness on non-deleted employees
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email_unique ON employees(email) WHERE deleted_at IS NULL;
