-- 009_org_structure.sql
-- ORG-001: Add branches, departments, job_positions, and link employees to org structure.
-- Additive only: new tables + nullable columns on employees. No existing column/table is modified or dropped.
-- Rollback: DROP TABLE IF EXISTS job_positions, departments, branches CASCADE;
--           ALTER TABLE employees DROP COLUMN IF EXISTS branch_id, department_id, job_position_id;

-- ─────────────────────────────────────────────
-- 1. branches (company-level physical locations)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    code         TEXT,
    address      TEXT,
    phone        TEXT,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches(company_id);
CREATE INDEX IF NOT EXISTS idx_branches_deleted_at ON branches(deleted_at);

-- ─────────────────────────────────────────────
-- 2. departments (logical units, optionally under a branch, with optional parent for hierarchy)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id    UUID REFERENCES branches(id) ON DELETE SET NULL,
    parent_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    code         TEXT,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_departments_company_id ON departments(company_id);
CREATE INDEX IF NOT EXISTS idx_departments_branch_id ON departments(branch_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent_id ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_departments_deleted_at ON departments(deleted_at);

-- ─────────────────────────────────────────────
-- 3. job_positions (titles/roles, optionally under a department)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_positions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    code          TEXT,
    grade         TEXT,
    description   TEXT,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_positions_company_id ON job_positions(company_id);
CREATE INDEX IF NOT EXISTS idx_job_positions_department_id ON job_positions(department_id);
CREATE INDEX IF NOT EXISTS idx_job_positions_deleted_at ON job_positions(deleted_at);

-- ─────────────────────────────────────────────
-- 4. Link employees to org structure (additive nullable columns)
--    Existing position/job_title text fields remain untouched as fallback.
-- ─────────────────────────────────────────────
ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS branch_id        UUID REFERENCES branches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS job_position_id  UUID REFERENCES job_positions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_job_position_id ON employees(job_position_id);

-- ─────────────────────────────────────────────
-- 5. updated_at triggers for new tables
-- ─────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY['branches', 'departments', 'job_positions'])
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;
