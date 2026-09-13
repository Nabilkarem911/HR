-- ─────────────────────────────────────────────
-- 011: Social Insurance Amount per Employee
-- Additive: nullable NUMERIC column for GOSI/social insurance monthly amount
-- ─────────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS social_insurance_amount NUMERIC(12,2) DEFAULT 0;

COMMENT ON COLUMN employees.social_insurance_amount IS 'Monthly social insurance (GOSI) amount for the employee';
