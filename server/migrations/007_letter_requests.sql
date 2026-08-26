-- 007_letter_requests.sql
-- Add letter request support to employee_requests without breaking existing leave/loan flow.

ALTER TABLE employee_requests
    ADD COLUMN IF NOT EXISTS letter_type TEXT,
    ADD COLUMN IF NOT EXISTS letter_id UUID REFERENCES issued_letters(id) ON DELETE SET NULL;

-- Widen request_type check to include 'letter' (drop & recreate safely for PostgreSQL < 14)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'employee_requests_request_type_check'
        AND conrelid = 'employee_requests'::regclass
    ) THEN
        ALTER TABLE employee_requests DROP CONSTRAINT employee_requests_request_type_check;
    END IF;
    ALTER TABLE employee_requests
        ADD CONSTRAINT employee_requests_request_type_check
        CHECK (request_type IN ('leave','loan','letter'));
END $$;
