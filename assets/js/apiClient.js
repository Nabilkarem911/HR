/* ==========================================================================
   HR-Gpack API Client — Drop-in replacement for supabaseClient.js
   Mimics the Supabase JS client interface but routes all calls to the
   custom Express backend via fetch().
   ========================================================================== */

const API_BASE_URL = window.API_BASE_URL || '/api';

// ── Table Name Aliases (maps frontend table names to backend route names) ──
const TABLE_ALIASES = {
    'payslips': 'payroll',
    'system_users': 'users',
    'monthly_attendance': 'attendance',
    'employee_documents': 'compliance',
    'employee_assets': 'assets',
    'employee_requests': 'requests',
    'issued_letters': 'letters',
    'system_settings': 'settings',
    'vehicle_documents': 'vehicles/documents',
};

function resolveTable(table) {
    return TABLE_ALIASES[table] || table;
}

// ── Token Management ──
function getToken() {
    return localStorage.getItem('hr_auth_token') || null;
}
function setToken(token) {
    localStorage.setItem('hr_auth_token', token);
}
function clearToken() {
    localStorage.removeItem('hr_auth_token');
    localStorage.removeItem('ess_session');
}

// ── Core fetch wrapper ──
async function apiRequest(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const res = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}

        if (!res.ok) {
            if (res.status === 401) {
                clearToken();
                if (window.location.pathname !== '/login.html' && window.location.pathname !== '/') {
                    window.location.href = 'login.html';
                }
            }
            const errMsg = json?.error || text || `HTTP ${res.status}`;
            return { data: null, error: { message: errMsg, code: res.status === 409 ? '23505' : null } };
        }

        return { data: json, error: null };
    } catch (err) {
        return { data: null, error: { message: err.message || 'Network error' } };
    }
}

// ── Auth API (mimics supabase.auth) ──
const authApi = {
    async getSession() {
        const token = getToken();
        if (!token) return { data: { session: null }, error: null };

        const { data, error } = await apiRequest('GET', '/auth/profile');
        if (error) return { data: { session: null }, error: null };

        return {
            data: {
                session: {
                    user: { id: data.id, email: data.email },
                    user_meta: data,
                }
            },
            error: null
        };
    },

    async signInWithPassword({ email, password }) {
        const { data, error } = await apiRequest('POST', '/auth/login', { identifier: email, password });
        if (error) return { data: null, error };
        if (data && data.token) {
            setToken(data.token);
        }
        return { data: { session: { user: data.user } }, error: null };
    },

    async getUser() {
        const { data: session } = await authApi.getSession();
        if (!session || !session.session) return { data: { user: null }, error: null };
        return { data: { user: session.session.user }, error: null };
    },

    async signOut() {
        await apiRequest('POST', '/auth/logout');
        clearToken();
        return { error: null };
    },

    onAuthStateChange(callback) {
        // No-op: we use token-based polling instead of realtime
        return { subscription: { unsubscribe: () => {} } };
    }
};

// ── Query Builder (mimics supabase.from('table')) ──
function from(rawTable) {
    const table = resolveTable(rawTable);
    const state = {
        method: 'GET',
        path: `/${table}`,
        filters: {},
        body: null,
        selectColumns: '*',
        singleMode: false,
        orderField: null,
        orderAsc: true,
        limitVal: null,
        rangeFrom: null,
        rangeTo: null,
        orClause: null,
        inFilters: {},
        notFilters: {},
        isFilters: {},
        countMode: null,
        headMode: false,
    };

    const builder = {
        select(cols = '*', opts = {}) {
            state.method = 'GET';
            state.selectColumns = cols;
            if (opts.count) state.countMode = opts.count;
            if (opts.head) state.headMode = true;
            return this;
        },

        insert(rows) {
            state.method = 'POST';
            state.body = Array.isArray(rows) ? rows[0] : rows;
            state.insertArray = Array.isArray(rows) ? rows : null;
            return this;
        },

        upsert(rows, opts = {}) {
            state.method = 'POST';
            state.isUpsert = true;
            state.upsertConflict = opts.onConflict || null;
            state.body = Array.isArray(rows) ? rows[0] : rows;
            state.insertArray = Array.isArray(rows) ? rows : null;
            return this;
        },

        update(payload) {
            state.method = 'PUT';
            state.body = payload;
            return this;
        },

        delete() {
            state.method = 'DELETE';
            return this;
        },

        eq(col, val) {
            state.filters[col] = val;
            return this;
        },

        neq(col, val) {
            state.notFilters[col] = val;
            return this;
        },

        ilike(col, pattern) {
            state.filters[`${col}_like`] = pattern.replace(/%/g, '');
            return this;
        },

        in(col, arr) {
            state.inFilters[col] = arr;
            return this;
        },

        gte(col, val) {
            state.filters[`${col}_gte`] = val;
            return this;
        },

        lte(col, val) {
            state.filters[`${col}_lte`] = val;
            return this;
        },

        gt(col, val) {
            state.filters[`${col}_gt`] = val;
            return this;
        },

        lt(col, val) {
            state.filters[`${col}_lt`] = val;
            return this;
        },

        or(clause) {
            state.orClause = clause;
            return this;
        },

        is(col, val) {
            state.isFilters[col] = val;
            return this;
        },

        order(field, opts = {}) {
            state.orderField = field;
            state.orderAsc = opts.ascending !== false;
            return this;
        },

        limit(n) {
            state.limitVal = n;
            return this;
        },

        range(from, to) {
            state.rangeFrom = from;
            state.rangeTo = to;
            return this;
        },

        single() {
            state.singleMode = true;
            return this._execute();
        },

        maybeSingle() {
            state.singleMode = true;
            return this._execute();
        },

        async _execute() {
            const params = new URLSearchParams();

            // Handle search/or clause (special case for employee search)
            if (state.orClause) {
                const parts = state.orClause.split(',');
                let searchTerm = null;
                for (const p of parts) {
                    const m = p.match(/\.eq\.(.+)/);
                    if (m) { searchTerm = m[1]; break; }
                }
                if (searchTerm) params.set('search', searchTerm);
            }

            for (const [k, v] of Object.entries(state.filters)) {
                if (k === 'id' || k === 'setting_key') continue; // handled via path
                params.set(k, v);
            }
            for (const [k, v] of Object.entries(state.inFilters)) {
                params.set(`${k}_in`, JSON.stringify(v));
            }
            for (const [k, v] of Object.entries(state.notFilters)) {
                params.set(`${k}_neq`, v);
            }
            for (const [k, v] of Object.entries(state.isFilters)) {
                if (v === null) {
                    params.set(`${k}_isnull`, 'true');
                } else {
                    params.set(k, v);
                }
            }

            if (state.limitVal) params.set('limit', state.limitVal);

            let path = `/${table}`;
            const qs = params.toString();

            // Determine the primary key value for /:key path routing
            const pkVal = state.filters.id || state.filters.setting_key;

            // For single() on select with eq('id', val) or eq('setting_key', val), use /:key endpoint
            if (state.singleMode && state.method === 'GET' && pkVal) {
                path = `/${table}/${pkVal}`;
            } else if (state.method === 'PUT' && pkVal) {
                // UPDATE by key → PUT /:key
                path = `/${table}/${pkVal}`;
            } else if (state.method === 'DELETE' && state.filters.id) {
                // DELETE by id → DELETE /:id
                path = `/${table}/${state.filters.id}`;
            } else if (state.method === 'DELETE' && state.inFilters.employee_id) {
                // DELETE with filters → use query params
                path = `/${table}?${qs}`;
            } else if (qs) {
                path += `?${qs}`;
            }

            // For upsert, use /batch endpoint if array
            let body = state.body;
            if (state.isUpsert && state.insertArray) {
                path = `/${table}/batch`;
                body = { records: state.insertArray };
            }

            const { data, error } = await apiRequest(state.method, path, body);

            if (error) return { data: null, error };

            // Head mode: return count only (no data rows)
            if (state.headMode && state.countMode) {
                const rows = (data && data.data) ? data.data : (Array.isArray(data) ? data : []);
                return { data: null, error: null, count: rows.length };
            }

            if (state.singleMode) {
                const row = (data && data.data) ? data.data : data;
                return { data: row, error: null };
            }

            const rows = (data && data.data) ? data.data : data;
            return { data: rows, error: null };
        },

        then(onFulfilled, onRejected) {
            return this._execute().then(onFulfilled, onRejected);
        },
    };

    return builder;
}

// ── RPC (mimics supabase.rpc) ──
async function rpc(fnName, params) {
    // Map known RPC functions to REST endpoints
    if (fnName === 'get_email_by_phone') {
        const { data, error } = await apiRequest('GET', `/auth/lookup-phone?phone=${encodeURIComponent(params.p_phone)}`);
        return { data: data?.email || null, error };
    }
    return { data: null, error: { message: `RPC ${fnName} not supported` } };
}

// ── Assign to window.db (drop-in replacement) ──
window.db = {
    auth: authApi,
    from,
    rpc,
};

// ── Global Utilities (same as supabaseClient.js) ──
window.checkAuth = async function () {
    const { data: { session } } = await authApi.getSession();
    return session;
};

window.showError = (message) => {
    alert('خطأ: ' + message);
};

window.showSuccess = (message) => {
    alert('نجاح: ' + message);
};
