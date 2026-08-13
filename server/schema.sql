-- ═══════════════════════════════════════════════════════════
-- HR-Gpack Complete Database Schema
-- PostgreSQL 12+
-- ═══════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- 1. companies
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. employees
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    emp_code          TEXT,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    email             TEXT UNIQUE,
    phone             TEXT,
    position          TEXT,
    job_title         TEXT,
    basic_salary      NUMERIC(12,2) DEFAULT 0,
    contract_salary   NUMERIC(12,2),
    hire_date         DATE,
    join_date         DATE,
    status            TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','on_leave','terminated')),
    company_id        UUID REFERENCES companies(id) ON DELETE SET NULL,
    iqama_number      TEXT,
    nationality       TEXT,
    iqama_profession  TEXT,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON employees(deleted_at);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- ─────────────────────────────────────────────
-- 3. system_users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_users (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email                TEXT UNIQUE NOT NULL,
    full_name            TEXT NOT NULL,
    role                 TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('super_admin','hr_manager','branch_manager','viewer','employee')),
    company_id           UUID REFERENCES companies(id) ON DELETE SET NULL,
    custom_permissions   JSONB DEFAULT '{}',
    phone                TEXT,
    employee_profile_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
    password_hash        TEXT,
    plain_password       TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_users_role ON system_users(role);
CREATE INDEX IF NOT EXISTS idx_system_users_company_id ON system_users(company_id);
CREATE INDEX IF NOT EXISTS idx_system_users_employee_profile_id ON system_users(employee_profile_id);

-- ─────────────────────────────────────────────
-- 4. employee_documents (compliance)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_documents (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE,
    doc_type     TEXT NOT NULL,
    doc_number   TEXT,
    expiry_date  DATE,
    file_url     TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_docs_employee_id ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_docs_expiry_date ON employee_documents(expiry_date);

-- ─────────────────────────────────────────────
-- 5. employee_assets
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_assets (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id   UUID REFERENCES employees(id) ON DELETE CASCADE,
    asset_type    TEXT,
    asset_name    TEXT NOT NULL,
    serial_number TEXT,
    assigned_date DATE NOT NULL,
    status        TEXT DEFAULT 'assigned' CHECK (status IN ('assigned','returned','damaged','lost')),
    returned_date DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_assets_employee_id ON employee_assets(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_assets_status ON employee_assets(status);

-- ─────────────────────────────────────────────
-- 6. employee_requests (leaves & loans)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL CHECK (request_type IN ('leave','loan')),
    start_date   DATE,
    end_date     DATE,
    total_days   NUMERIC(5,1),
    amount       NUMERIC(12,2),
    paid_amount  NUMERIC(12,2) DEFAULT 0,
    reason       TEXT,
    status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','processed')),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_req_employee_id ON employee_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_req_status ON employee_requests(status);
CREATE INDEX IF NOT EXISTS idx_emp_req_type ON employee_requests(request_type);

-- ─────────────────────────────────────────────
-- 7. issued_letters
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS issued_letters (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id        UUID REFERENCES employees(id) ON DELETE CASCADE,
    letter_type        TEXT NOT NULL,
    reference_number   TEXT,
    ref_no             TEXT,
    content_snapshot   TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_letters_employee_id ON issued_letters(employee_id);

-- ─────────────────────────────────────────────
-- 8. monthly_attendance
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_attendance (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    emp_id         UUID REFERENCES employees(id) ON DELETE CASCADE,
    company_id     UUID REFERENCES companies(id) ON DELETE SET NULL,
    month_year     TEXT NOT NULL,
    days_present   NUMERIC(5,1) DEFAULT 0,
    days_absent    NUMERIC(5,1) DEFAULT 0,
    hours_overtime NUMERIC(5,1) DEFAULT 0,
    hours_late     NUMERIC(5,1) DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(emp_id, month_year)
);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_id ON monthly_attendance(emp_id);
CREATE INDEX IF NOT EXISTS idx_attendance_month_year ON monthly_attendance(month_year);

-- ─────────────────────────────────────────────
-- 9. payroll_records
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id     UUID REFERENCES employees(id) ON DELETE CASCADE,
    company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,
    month           INT,
    year            INT,
    month_year      TEXT NOT NULL,
    basic_salary    NUMERIC(12,2) DEFAULT 0,
    allowances      NUMERIC(12,2) DEFAULT 0,
    overtime_pay    NUMERIC(12,2) DEFAULT 0,
    deductions      NUMERIC(12,2) DEFAULT 0,
    loan_deduction  NUMERIC(12,2) DEFAULT 0,
    manual_bonus    NUMERIC(12,2) DEFAULT 0,
    manual_penalty  NUMERIC(12,2) DEFAULT 0,
    net_salary      NUMERIC(12,2) DEFAULT 0,
    notes           TEXT,
    status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, month_year)
);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_id ON payroll_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_month_year ON payroll_records(month_year);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_records(status);

-- ─────────────────────────────────────────────
-- 10. vehicles
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plate_number TEXT,
    make         TEXT,
    model        TEXT,
    year         INT,
    status       TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
    company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_company_id ON vehicles(company_id);

-- ─────────────────────────────────────────────
-- 11. vehicle_documents
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_documents (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id   UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    doc_type     TEXT NOT NULL,
    doc_number   TEXT,
    expiry_date  DATE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_docs_vehicle_id ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_docs_expiry_date ON vehicle_documents(expiry_date);

-- ─────────────────────────────────────────────
-- 12. audit_logs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action       TEXT,
    action_name  TEXT,
    module       TEXT,
    module_name  TEXT,
    entity_type  TEXT,
    actor_name   TEXT,
    user_name    TEXT,
    user_email   TEXT,
    created_by   UUID,
    company_id   UUID,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs(module);

-- ─────────────────────────────────────────────
-- 13. system_settings
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key   TEXT UNIQUE NOT NULL,
    setting_value TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ═══════════════════════════════════════════════════════════
