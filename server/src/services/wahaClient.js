/* ==========================================================================
   WAHA WhatsApp Client — Sends WhatsApp messages via WAHA REST API
   Config is stored in system_settings:
     - waha_api_url   (e.g. http://localhost:3000)
     - waha_api_token (optional bearer token)
     - waha_session   (optional session name, defaults to "default")
   ========================================================================== */

const { queryAll } = require('../config/db');

async function getWahaConfig() {
  const rows = await queryAll(
    `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key IN ('waha_api_url', 'waha_api_token', 'waha_session')`
  );
  const config = {};
  rows.forEach(r => { config[r.setting_key] = r.setting_value; });
  return config;
}

function normalizePhone(phone) {
  let cleaned = String(phone || '').replace(/[\s\-()]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  if (cleaned.startsWith('0') && cleaned.length > 1) cleaned = '+966' + cleaned.slice(1);
  if (!cleaned.startsWith('+') && /^\d{9,}$/.test(cleaned)) cleaned = '+966' + cleaned;
  return cleaned;
}

async function sendWhatsAppMessage(phone, message) {
  let config;
  try {
    config = await getWahaConfig();
  } catch (err) {
    return { success: false, error: 'Failed to load WAHA config: ' + err.message };
  }

  if (!config.waha_api_url) {
    return { success: false, error: 'WAHA API URL not configured' };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { success: false, error: 'Invalid phone number' };
  }

  const session = config.waha_session || 'default';
  const baseUrl = config.waha_api_url.replace(/\/$/, '');
  const url = `${baseUrl}/api/sessions/${session}/chats/send-text`;

  const headers = { 'Content-Type': 'application/json' };
  if (config.waha_api_token) {
    headers['Authorization'] = `Bearer ${config.waha_api_token}`;
  }

  const body = JSON.stringify({
    chatId: normalizedPhone,
    text: message,
  });

  // Use AbortController for timeout (Node 18+ native fetch)
  const controller = new AbortController();
  const timeoutMs = 15000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    if (!res.ok) {
      // Never include the token in error responses
      return { success: false, error: `HTTP ${res.status}` };
    }
    return { success: true, response: json || text };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'Request timed out' };
    }
    // Never include the token in error responses
    return { success: false, error: err.message || 'Network error' };
  }
}

module.exports = { sendWhatsAppMessage, getWahaConfig, normalizePhone };
