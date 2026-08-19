-- ═══════════════════════════════════════════════════════════
-- Migration 006: Auto-increment employee numbers and rebuild emp_code
-- ═══════════════════════════════════════════════════════════

-- Add emp_number column to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emp_number INTEGER;

-- Backfill existing employees with sequential employee numbers
WITH numbered AS (
    SELECT id, row_number() over (order by created_at, id) as rn FROM employees
)
UPDATE employees e SET emp_number = n.rn
FROM numbered n WHERE e.id = n.id;

-- Regenerate emp_code for existing employees based on their company building number
UPDATE employees e
SET emp_code =
    CASE
        WHEN c.building_number IS NOT NULL THEN c.building_number || '-' || lpad(e.emp_number::text, 3, '0')
        ELSE lpad(e.emp_number::text, 3, '0')
    END
FROM companies c
WHERE e.company_id = c.id;

-- Handle employees with no company
UPDATE employees
SET emp_code = lpad(emp_number::text, 3, '0')
WHERE company_id IS NULL;

-- Create sequence for new employees
CREATE SEQUENCE IF NOT EXISTS employees_emp_number_seq START WITH 1;

-- Align sequence with existing values
SELECT setval('employees_emp_number_seq', coalesce((SELECT max(emp_number) FROM employees), 0) + 1);

-- Set NOT NULL, unique, and auto-default
ALTER TABLE employees ALTER COLUMN emp_number SET NOT NULL;
ALTER TABLE employees ALTER COLUMN emp_number SET DEFAULT nextval('employees_emp_number_seq');
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_emp_number ON employees(emp_number);
