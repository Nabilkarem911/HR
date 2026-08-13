const fs = require('fs');
const path = require('path');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/db');

async function initDb() {
  console.log('[initDb] Starting database initialization...');

  // Read and execute schema.sql
  const schemaPath = path.join(__dirname, '..', '..', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await query(schema);
  console.log('[initDb] Schema tables created.');

  // Seed super admin
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.SEED_ADMIN_FULL_NAME || 'Super Admin';

  const existing = await query('SELECT id FROM system_users WHERE email = $1 AND role = $2', [adminEmail, 'super_admin']);
  if (existing.rows.length === 0) {
    const hash = bcrypt.hashSync(adminPass, 10);
    await query(
      `INSERT INTO system_users (email, full_name, role, password_hash, custom_permissions) VALUES ($1, $2, 'super_admin', $3, '{}')`,
      [adminEmail, adminName, hash]
    );
    console.log(`[initDb] Super admin created: ${adminEmail}`);
  } else {
    console.log('[initDb] Super admin already exists, skipping seed.');
  }

  console.log('[initDb] Done.');
  await pool.end();
  process.exit(0);
}

initDb().catch(err => {
  console.error('[initDb] Error:', err.message);
  process.exit(1);
});
