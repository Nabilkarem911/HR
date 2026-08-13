const DEFAULT_PERMISSIONS = {
  super_admin: {
    dashboard: { view: true },
    companies: { view: true, add: true, edit: true, delete: true },
    employees: { view: true, add: true, edit: true, delete: true, hide_salary: false },
    attendance: { view: true, add: true, edit: true },
    requests: { view: true, add: true, edit: true },
    payroll: { view: true, add: true, edit: true, hide_net: false },
    letters: { view: true, add: true },
    compliance: { view: true, add: true, edit: true, delete: true },
    assets: { view: true, add: true, edit: true, delete: true },
    vehicles: { view: true, add: true, edit: true, delete: true },
    users: { view: true, add: true, edit: true, delete: true },
  },
  hr_manager: {
    dashboard: { view: true },
    companies: { view: true, add: true, edit: true, delete: false },
    employees: { view: true, add: true, edit: true, delete: false, hide_salary: false },
    attendance: { view: true, add: true, edit: true },
    requests: { view: true, add: true, edit: true },
    payroll: { view: true, add: true, edit: true, hide_net: false },
    letters: { view: true, add: true },
    compliance: { view: true, add: true, edit: true, delete: false },
    assets: { view: true, add: true, edit: true, delete: false },
    vehicles: { view: true, add: true, edit: true, delete: false },
    users: { view: true, add: false, edit: false, delete: false },
  },
  branch_manager: {
    dashboard: { view: true },
    companies: { view: true, add: false, edit: false, delete: false },
    employees: { view: true, add: false, edit: false, delete: false, hide_salary: true },
    attendance: { view: true, add: true, edit: true },
    requests: { view: true, add: true, edit: true },
    payroll: { view: true, add: false, edit: false, hide_net: true },
    letters: { view: true, add: true },
    compliance: { view: true, add: false, edit: false, delete: false },
    assets: { view: true, add: false, edit: false, delete: false },
    vehicles: { view: true, add: false, edit: false, delete: false },
    users: { view: false, add: false, edit: false, delete: false },
  },
  viewer: {
    dashboard: { view: true },
    companies: { view: true, add: false, edit: false, delete: false },
    employees: { view: true, hide_salary: true },
    attendance: { view: true, add: false, edit: false },
    requests: { view: true, add: false, edit: false },
    payroll: { view: true, add: false, edit: false, hide_net: true },
    letters: { view: true, add: false },
    compliance: { view: true, add: false, edit: false, delete: false },
    assets: { view: true, add: false, edit: false, delete: false },
    vehicles: { view: true, add: false, edit: false, delete: false },
    users: { view: false, add: false, edit: false, delete: false },
  },
  employee: {
    dashboard: { view: false },
    companies: { view: false, add: false, edit: false, delete: false },
    employees: { view: false, add: false, edit: false, delete: false, hide_salary: true },
    attendance: { view: false, add: false, edit: false },
    requests: { view: true, add: true, edit: false },
    payroll: { view: false, add: false, edit: false, hide_net: true },
    letters: { view: true, add: true },
    compliance: { view: false, add: false, edit: false, delete: false },
    assets: { view: false, add: false, edit: false, delete: false },
    vehicles: { view: false, add: false, edit: false, delete: false },
    users: { view: false, add: false, edit: false, delete: false },
  },
};

function getEffectivePermissions(role, customPermissions) {
  const base = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.viewer;
  if (!customPermissions || (typeof customPermissions === 'object' && Object.keys(customPermissions).length === 0)) {
    return base;
  }
  let parsed = customPermissions;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return base; }
  }
  const merged = JSON.parse(JSON.stringify(base));
  for (const mod of Object.keys(parsed)) {
    if (!merged[mod]) merged[mod] = {};
    for (const act of Object.keys(parsed[mod])) {
      merged[mod][act] = parsed[mod][act];
    }
  }
  return merged;
}

function hasPermission(user, module, action) {
  if (!user) return false;
  if (user.role === 'super_admin') {
    if (action.startsWith('hide_')) return false;
    return true;
  }
  const perms = getEffectivePermissions(user.role, user.custom_permissions);
  if (perms[module] && typeof perms[module][action] !== 'undefined') {
    return perms[module][action] === true;
  }
  return false;
}

function rbacMiddleware(module, action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasPermission(req.user, module, action)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

function attachPermissions(req, res, next) {
  if (req.user) {
    req.user.effectivePermissions = getEffectivePermissions(req.user.role, req.user.custom_permissions);
    req.user.hasPerm = (mod, act) => hasPermission(req.user, mod, act);
  }
  next();
}

module.exports = {
  DEFAULT_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  rbacMiddleware,
  attachPermissions,
};
