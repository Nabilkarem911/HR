-- ═══════════════════════════════════════════════════════════
-- Migration 005: Auto-increment building numbers for companies
-- ═══════════════════════════════════════════════════════════

-- Add building_number column to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS building_number INTEGER;

-- Backfill existing companies with sequential building numbers
WITH numbered AS (
    SELECT id, row_number() over (order by created_at, id) as rn FROM companies
)
UPDATE companies c SET building_number = n.rn
FROM numbered n WHERE c.id = n.id;

-- Create sequence for new companies
CREATE SEQUENCE IF NOT EXISTS companies_building_number_seq START WITH 1;

-- Align sequence with existing values
SELECT setval('companies_building_number_seq', coalesce((SELECT max(building_number) FROM companies), 0) + 1);

-- Set NOT NULL, unique, and auto-default
ALTER TABLE companies ALTER COLUMN building_number SET NOT NULL;
ALTER TABLE companies ALTER COLUMN building_number SET DEFAULT nextval('companies_building_number_seq');
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_building_number ON companies(building_number);
