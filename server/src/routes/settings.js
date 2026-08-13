const express = require('express');
const { query, queryOne, queryAll } = require('../config/db');

const router = express.Router();

// ── GET /api/settings ──
router.get('/', async (req, res, next) => {
  try {
    const rows = await queryAll(`SELECT * FROM system_settings ORDER BY setting_key ASC`);
    const result = {};
    rows.forEach(r => { result[r.setting_key] = r.setting_value; });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// ── GET /api/settings/:key ──
router.get('/:key', async (req, res, next) => {
  try {
    const row = await queryOne(`SELECT * FROM system_settings WHERE setting_key = $1`, [req.params.key]);
    if (!row) return res.status(404).json({ error: 'Setting not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── PUT /api/settings/:key (upsert) ──
router.put('/:key', async (req, res, next) => {
  try {
    const { setting_value } = req.body;
    const row = await queryOne(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2
       RETURNING *`,
      [req.params.key, setting_value]
    );
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ── POST /api/settings ──
router.post('/', async (req, res, next) => {
  try {
    const { setting_key, setting_value } = req.body;
    const row = await queryOne(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2
       RETURNING *`,
      [setting_key, setting_value]
    );
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

module.exports = router;
