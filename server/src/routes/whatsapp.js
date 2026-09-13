const express = require('express');
const { query, queryAll } = require('../config/db');
const { rbacMiddleware } = require('../middleware/rbac');
const { auditLog } = require('../middleware/auditLog');

const router = express.Router();

// WAHA settings keys managed by this module
const WAHA_KEYS = ['waha_api_url', 'waha_api_token', 'waha_session', 'waha_sender_phone'];

// ── Helper: load all WAHA settings as a flat object ──
async function loadWahaSettings() {
  const rows = await queryAll(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)`,
    [WAHA_KEYS]
  );
  const config = {};
  rows.forEach(r => { config[r.setting_key] = r.setting_value; });
  return config;
}

// ── Helper: upsert a setting ──
async function upsertSetting(key, value) {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2`,
    [key, value !== undefined && value !== null ? String(value) : '']
  );
}

// ── Helper: validate URL format (basic SSRF mitigation) ──
function isValidUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
}

// ── Helper: build WAHA base URL (strip trailing slash, validate) ──
function buildBaseUrl(config) {
  if (!config.waha_api_url) return null;
  if (!isValidUrl(config.waha_api_url)) return null;
  return config.waha_api_url.replace(/\/$/, '');
}

// ── Helper: build headers with optional auth token ──
// WAHA uses X-API-Key header (not Authorization Bearer)
function buildHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.waha_api_token) {
    headers['X-API-Key'] = config.waha_api_token;
  }
  return headers;
}

// ── Helper: fetch with timeout via AbortController ──
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 10000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ── Helper: require super_admin for edit operations (matches settings.js pattern) ──
function requireSuperAdmin(req, res) {
  if (req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden: super admin only' });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════
// GET /api/whatsapp/settings — return current WAHA config (token masked)
// ═══════════════════════════════════════════════════════
router.get('/settings', rbacMiddleware('whatsapp', 'view'), async (req, res, next) => {
  try {
    const config = await loadWahaSettings();
    // Mask the token for security — never expose full token to frontend
    const masked = { ...config };
    if (masked.waha_api_token) {
      const tok = masked.waha_api_token;
      masked.waha_api_token = tok.length > 8 ? tok.substring(0, 4) + '****' + tok.substring(tok.length - 4) : '****';
      masked.waha_api_token_set = true;
    } else {
      masked.waha_api_token_set = false;
    }
    res.json({ data: masked });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// PUT /api/whatsapp/settings — save WAHA config
// ═══════════════════════════════════════════════════════
router.put('/settings', rbacMiddleware('whatsapp', 'manage'), auditLog('settings'), async (req, res, next) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const b = req.body;

    // Upsert each provided field; skip token if it's the masked placeholder
    if (b.waha_api_url !== undefined) {
      if (b.waha_api_url && !isValidUrl(b.waha_api_url)) {
        return res.status(400).json({ error: 'Invalid WAHA API URL format' });
      }
      await upsertSetting('waha_api_url', b.waha_api_url);
    }
    if (b.waha_session !== undefined) {
      await upsertSetting('waha_session', b.waha_session);
    }
    if (b.waha_sender_phone !== undefined) {
      await upsertSetting('waha_sender_phone', b.waha_sender_phone);
    }
    // Only update token if a real value is provided (not the masked placeholder)
    if (b.waha_api_token !== undefined && b.waha_api_token !== '' && !b.waha_api_token.includes('****')) {
      await upsertSetting('waha_api_token', b.waha_api_token);
    }

    const updated = await loadWahaSettings();
    const masked = { ...updated };
    if (masked.waha_api_token) {
      const tok = masked.waha_api_token;
      masked.waha_api_token = tok.length > 8 ? tok.substring(0, 4) + '****' + tok.substring(tok.length - 4) : '****';
      masked.waha_api_token_set = true;
    } else {
      masked.waha_api_token_set = false;
    }
    res.json({ data: masked });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// GET /api/whatsapp/sessions — list all WAHA sessions
// ═══════════════════════════════════════════════════════
router.get('/sessions', rbacMiddleware('whatsapp', 'view'), async (req, res, next) => {
  try {
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.json({ data: { success: false, error: 'WAHA API URL not configured', sessions: [] } });
    }

    const headers = buildHeaders(config);
    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/sessions`, { method: 'GET', headers }, 10000);
      if (!resp.ok) {
        return res.json({ data: { success: false, error: `WAHA returned HTTP ${resp.status}`, sessions: [] } });
      }
      const text = await resp.text();
      let sessions = null;
      try { sessions = JSON.parse(text); } catch (_) {}
      return res.json({ data: { success: true, sessions: sessions || [] } });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { success: false, error: 'Connection timed out', sessions: [] } });
      }
      return res.json({ data: { success: false, error: err.message, sessions: [] } });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// POST /api/whatsapp/test — test connection to WAHA server
// ═══════════════════════════════════════════════════════
router.post('/test', rbacMiddleware('whatsapp', 'view'), async (req, res, next) => {
  try {
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.json({ data: { success: false, error: 'WAHA API URL not configured' } });
    }

    const headers = buildHeaders(config);
    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/sessions`, { method: 'GET', headers }, 10000);
      if (!resp.ok) {
        return res.json({ data: { success: false, error: `WAHA returned HTTP ${resp.status}` } });
      }
      const text = await resp.text();
      let sessions = null;
      try { sessions = JSON.parse(text); } catch (_) {}
      return res.json({ data: { success: true, message: 'Connection successful', sessions: sessions } });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { success: false, error: 'Connection timed out (10s)' } });
      }
      return res.json({ data: { success: false, error: err.message || 'Connection failed' } });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// GET /api/whatsapp/status — get current session status
// ═══════════════════════════════════════════════════════
router.get('/status', rbacMiddleware('whatsapp', 'view'), async (req, res, next) => {
  try {
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.json({ data: { connected: false, status: 'not_configured', message: 'WAHA API URL not configured' } });
    }

    const session = config.waha_session || 'default';
    const headers = buildHeaders(config);
    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/sessions/${session}`, { method: 'GET', headers }, 10000);
      if (resp.status === 404) {
        return res.json({ data: { connected: false, status: 'session_not_found', message: 'Session not started yet' } });
      }
      if (!resp.ok) {
        return res.json({ data: { connected: false, status: 'error', message: `WAHA returned HTTP ${resp.status}` } });
      }
      const text = await resp.text();
      let sessionData = null;
      try { sessionData = JSON.parse(text); } catch (_) {}

      // WAHA session status: STARTED, SCAN_QR_CODE, STOPPED, FAILED
      const status = sessionData?.status || 'unknown';
      const connected = status === 'STARTED' || status === 'WORKING';
      return res.json({
        data: {
          connected,
          status,
          message: connected ? 'WhatsApp connected and ready' : `Session status: ${status}`,
          sessionData: sessionData,
        }
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { connected: false, status: 'timeout', message: 'Connection timed out' } });
      }
      return res.json({ data: { connected: false, status: 'error', message: err.message } });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// POST /api/whatsapp/session/start — start the WAHA session
// ═══════════════════════════════════════════════════════
router.post('/session/start', rbacMiddleware('whatsapp', 'manage'), auditLog('settings'), async (req, res, next) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.status(400).json({ error: 'WAHA API URL not configured' });
    }

    const session = config.waha_session || 'default';
    const headers = buildHeaders(config);

    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/sessions/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: session }),
      }, 10000);

      if (!resp.ok) {
        const text = await resp.text();
        return res.json({ data: { success: false, error: `HTTP ${resp.status}: ${text.substring(0, 200)}` } });
      }
      const text = await resp.text();
      let result = null;
      try { result = JSON.parse(text); } catch (_) {}
      return res.json({ data: { success: true, message: 'Session start requested', result } });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { success: false, error: 'Connection timed out' } });
      }
      return res.json({ data: { success: false, error: err.message } });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// POST /api/whatsapp/session/stop — stop the WAHA session
// ═══════════════════════════════════════════════════════
router.post('/session/stop', rbacMiddleware('whatsapp', 'manage'), auditLog('settings'), async (req, res, next) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.status(400).json({ error: 'WAHA API URL not configured' });
    }

    const session = config.waha_session || 'default';
    const headers = buildHeaders(config);

    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/sessions/${session}/stop`, {
        method: 'POST',
        headers,
      }, 10000);

      if (!resp.ok) {
        const text = await resp.text();
        return res.json({ data: { success: false, error: `HTTP ${resp.status}` } });
      }
      return res.json({ data: { success: true, message: 'Session stopped' } });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { success: false, error: 'Connection timed out' } });
      }
      return res.json({ data: { success: false, error: err.message } });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// GET /api/whatsapp/qr — get QR code for linking WhatsApp
// ═══════════════════════════════════════════════════════
router.get('/qr', rbacMiddleware('whatsapp', 'view'), async (req, res, next) => {
  try {
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.status(400).json({ error: 'WAHA API URL not configured' });
    }

    const session = config.waha_session || 'default';
    const headers = buildHeaders(config);

    // WAHA QR endpoint: GET /api/sessions/{session}/qr
    // Returns image/png by default, or JSON with base64 if Accept: application/json
    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/sessions/${session}/qr`, {
        method: 'GET',
        headers: { ...headers, 'Accept': 'application/json' },
      }, 15000);

      if (resp.status === 404) {
        return res.json({ data: { success: false, error: 'Session not found. Start the session first.' } });
      }
      if (!resp.ok) {
        return res.json({ data: { success: false, error: `WAHA returned HTTP ${resp.status}` } });
      }

      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await resp.json();
        // WAHA may return { qr: "data:image/png;base64,..." } or raw base64
        const qr = json.qr || json.data || json.image || (typeof json === 'string' ? json : null);
        return res.json({ data: { success: true, qr: qr, raw: json } });
      } else {
        // Binary image — convert to base64
        const buffer = await resp.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return res.json({ data: { success: true, qr: `data:image/png;base64,${base64}` } });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { success: false, error: 'QR request timed out (15s). Make sure the session is started.' } });
      }
      return res.json({ data: { success: false, error: err.message } });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════
// POST /api/whatsapp/send-test — send a test WhatsApp message
// ═══════════════════════════════════════════════════════
router.post('/send-test', rbacMiddleware('whatsapp', 'manage'), async (req, res, next) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const config = await loadWahaSettings();
    const baseUrl = buildBaseUrl(config);
    if (!baseUrl) {
      return res.status(400).json({ error: 'WAHA API URL not configured' });
    }

    const phone = req.body.phone || config.waha_sender_phone;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required (provide in body or set waha_sender_phone)' });
    }

    const session = config.waha_session || 'default';
    const headers = buildHeaders(config);
    const message = req.body.message || 'رسالة اختبار من نظام Gpack-HR — تم ربط واتساب بنجاح. ✅';

    // Normalize phone — WAHA expects digits only (or digits@c.us), NOT + prefix
    let normalizedPhone = String(phone).replace(/[\s\-()]/g, '');
    if (normalizedPhone.startsWith('00')) normalizedPhone = normalizedPhone.slice(2);
    if (normalizedPhone.startsWith('0') && normalizedPhone.length > 1) normalizedPhone = '966' + normalizedPhone.slice(1);
    if (normalizedPhone.startsWith('+')) normalizedPhone = normalizedPhone.slice(1);
    if (!normalizedPhone.includes('@')) normalizedPhone = normalizedPhone + '@c.us';

    try {
      // WAHA send endpoint: POST /api/sendText with { chatId, text, session }
      const resp = await fetchWithTimeout(`${baseUrl}/api/sendText`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ chatId: normalizedPhone, text: message, session }),
      }, 15000);

      if (!resp.ok) {
        const text = await resp.text();
        return res.json({ data: { success: false, error: `HTTP ${resp.status}: ${text.substring(0, 200)}` } });
      }
      const text = await resp.text();
      let result = null;
      try { result = JSON.parse(text); } catch (_) {}
      return res.json({ data: { success: true, message: 'Test message sent', result } });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ data: { success: false, error: 'Request timed out (15s)' } });
      }
      return res.json({ data: { success: false, error: err.message } });
    }
  } catch (err) { next(err); }
});

module.exports = router;
