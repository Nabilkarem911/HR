-- ═══════════════════════════════════════════════════════════
-- Migration 002: Fix ESS passwords
-- Employees who were created with default password '123456' (hashed)
-- need their plain_password set from their iqama_number
-- ═══════════════════════════════════════════════════════════

-- For ESS users (role='employee') that have a password_hash but no plain_password,
-- and have an employee_profile_id, reset to use iqama_number as plain_password
UPDATE system_users
SET plain_password = e.iqama_number,
    password_hash = NULL
FROM employees e
WHERE system_users.role = 'employee'
  AND system_users.employee_profile_id = e.id
  AND system_users.plain_password IS NULL
  AND system_users.password_hash IS NOT NULL
  AND e.iqama_number IS NOT NULL
  AND e.iqama_number != '';
