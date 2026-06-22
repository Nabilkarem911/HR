const { query } = require('../config/db');

const MODULE_NAMES = {
  employees: 'الموظفين',
  companies: 'المنشآت',
  assets: 'العهد',
  compliance: 'الوثائق',
  requests: 'الطلبات',
  payroll: 'الرواتب',
  letters: 'الخطابات',
  vehicles: 'المركبات',
  users: 'المستخدمين',
  attendance: 'الحضور',
  settings: 'الإعدادات',
};

const ACTION_NAMES = {
  POST: 'إضافة',
  PUT: 'تعديل',
  DELETE: 'حذف',
};

function auditLog(module) {
  return async (req, res, next) => {
    const originalSend = res.send.bind(res);

    res.send = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const action = req.method;
        const moduleName = MODULE_NAMES[module] || module;
        const actionName = ACTION_NAMES[action] || action;

        let actorName = req.user?.email || 'system';
        let entityId = null;

        if (req.params.id) {
          entityId = req.params.id;
        } else if (req.body && req.body.id) {
          entityId = req.body.id;
        }

        try {
          let parsed = body;
          try { parsed = JSON.parse(body); } catch (_) {}
          if (parsed && parsed.data && parsed.data.id) {
            entityId = parsed.data.id;
          }
        } catch (_) {}

        query(
          `INSERT INTO audit_logs (action, action_name, module, module_name, entity_type, actor_name, user_name, user_email, created_by, company_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            action,
            actionName,
            module,
            moduleName,
            module,
            actorName,
            req.user?.full_name || actorName,
            req.user?.email || null,
            req.user?.id || null,
            req.user?.company_id || null,
          ]
        ).catch(() => {});
      }

      return originalSend(body);
    };

    next();
  };
}

module.exports = { auditLog };
