-- 008_company_logo.sql
-- Add company logo URL for letter headers.

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS logo_url TEXT;
