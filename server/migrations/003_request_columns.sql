-- ═══════════════════════════════════════════════════════════
-- Migration 003: Add missing columns to employee_requests
-- Adds: hr_notes, is_paid, auto_deduct, monthly_deduction,
--       months_installment, company_id
-- ═══════════════════════════════════════════════════════════

ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS hr_notes TEXT;
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT true;
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS auto_deduct BOOLEAN DEFAULT false;
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS monthly_deduction NUMERIC(12,2) DEFAULT 0;
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS months_installment INTEGER DEFAULT 1;
ALTER TABLE employee_requests ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emp_req_company_id ON employee_requests(company_id);
