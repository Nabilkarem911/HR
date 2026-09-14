const { query, queryOne, queryAll } = require('../config/db');

const VALID_COLUMN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

function sanitizeColumn(name) {
  if (!VALID_COLUMN.test(name)) {
    throw new Error(`Invalid column name: ${name}`);
  }
  return name;
}

function buildWhereClause(filters) {
  const clauses = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(filters)) {
    if (val === undefined || val === null || val === '') continue;
    if (key.endsWith('_like')) {
      const realKey = sanitizeColumn(key.replace('_like', ''));
      clauses.push(`${realKey} ILIKE $${idx}`);
      values.push(`%${val}%`);
    } else if (key.endsWith('_gte')) {
      const realKey = sanitizeColumn(key.replace('_gte', ''));
      clauses.push(`${realKey} >= $${idx}`);
      values.push(val);
    } else if (key.endsWith('_lte')) {
      const realKey = sanitizeColumn(key.replace('_lte', ''));
      clauses.push(`${realKey} <= $${idx}`);
      values.push(val);
    } else if (key.endsWith('_gt')) {
      const realKey = sanitizeColumn(key.replace('_gt', ''));
      clauses.push(`${realKey} > $${idx}`);
      values.push(val);
    } else if (key.endsWith('_lt')) {
      const realKey = sanitizeColumn(key.replace('_lt', ''));
      clauses.push(`${realKey} < $${idx}`);
      values.push(val);
    } else if (key.endsWith('_neq')) {
      const realKey = sanitizeColumn(key.replace('_neq', ''));
      clauses.push(`${realKey} != $${idx}`);
      values.push(val);
    } else if (key.endsWith('_in')) {
      const realKey = sanitizeColumn(key.replace('_in', ''));
      let arr = val;
      try { arr = JSON.parse(val); } catch (_) {}
      if (!Array.isArray(arr)) arr = [arr];
      const placeholders = arr.map((_, i) => `$${idx + i}`).join(',');
      clauses.push(`${realKey} IN (${placeholders})`);
      values.push(...arr);
      idx += arr.length - 1;
    } else if (key.endsWith('_isnull')) {
      const realKey = sanitizeColumn(key.replace('_isnull', ''));
      if (val === true || val === 'true') {
        clauses.push(`${realKey} IS NULL`);
      } else {
        clauses.push(`${realKey} IS NOT NULL`);
      }
    } else {
      const realKey = sanitizeColumn(key);
      clauses.push(`${realKey} = $${idx}`);
      values.push(val);
    }
    idx++;
  }
  return {
    clause: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
    values,
  };
}

function applyCompanyFilter(req, baseQuery, params) {
  if (req.user.role !== 'super_admin' && req.user.company_id) {
    if (baseQuery.includes('WHERE')) {
      baseQuery += ' AND company_id = $' + (params.length + 1);
    } else {
      baseQuery += ' WHERE company_id = $' + (params.length + 1);
    }
    params.push(req.user.company_id);
  }
  return { query: baseQuery, params };
}

function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function maskSalary(row, shouldHide) {
  if (!shouldHide) return row;
  const masked = { ...row };
  if (masked.basic_salary !== undefined) masked.basic_salary = null;
  if (masked.contract_salary !== undefined) masked.contract_salary = null;
  if (masked.net_salary !== undefined) masked.net_salary = null;
  if (masked.manual_bonus !== undefined) masked.manual_bonus = null;
  if (masked.manual_penalty !== undefined) masked.manual_penalty = null;
  if (masked.allowances !== undefined) masked.allowances = null;
  if (masked.overtime_pay !== undefined) masked.overtime_pay = null;
  if (masked.deductions !== undefined) masked.deductions = null;
  if (masked.loan_deduction !== undefined) masked.loan_deduction = null;
  masked._salary_masked = true;
  return masked;
}

module.exports = { buildWhereClause, applyCompanyFilter, paginate, maskSalary, sanitizeColumn };

// Convert a pg DATE value (local-midnight Date) or string to 'YYYY-MM-DD'.
// NOTE: toISOString() must NOT be used here — it shifts the day back in UTC+N timezones.
function toISODate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.split('T')[0];
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Format a date showing both Hijri and Gregorian calendars, e.g.
// "٣ ربيع الآخر ١٤٤٨هـ / ١٤ سبتمبر ٢٠٢٦م"
function formatDualDate(date) {
  // pg DATE arrives as local-midnight Date; 'YYYY-MM-DD' strings parse as UTC
  // midnight. Normalizing to local noon keeps the rendered day stable in any TZ.
  let d;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, dd] = date.split('-').map(Number);
    d = new Date(y, m - 1, dd, 12, 0, 0);
  } else {
    d = new Date(date);
    if (!isNaN(d.getTime())) d.setHours(12, 0, 0, 0);
  }
  if (isNaN(d.getTime())) return String(date || '-');
  const hijri = d.toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const greg = d.toLocaleDateString('ar-EG-u-ca-gregory', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return `${hijri} / ${greg}م`;
}

module.exports.formatDualDate = formatDualDate;
module.exports.toISODate = toISODate;
