const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');

async function runMigrations() {
  // Create migrations tracking table
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[migrations] No migrations directory, skipping.');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrations] No migration files found.');
    return;
  }

  // Check which migrations are already applied
  const { rows } = await query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`[migrations] Applying: ${file}`);
    await query(sql);
    await query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`[migrations] Applied: ${file}`);
    count++;
  }

  if (count === 0) {
    console.log('[migrations] All migrations already applied.');
  } else {
    console.log(`[migrations] ${count} migration(s) applied successfully.`);
  }
}

module.exports = runMigrations;
