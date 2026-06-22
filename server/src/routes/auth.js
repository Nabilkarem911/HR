const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, queryAll } = require('../config/db');
const { generateToken } = require('../middleware/auth');
const { getEffectivePermissions } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

// ── POST /api/auth/login ──
router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    // Try ESS (employee) login first — find by email or phone, then verify with bcrypt
    const essUser = await queryOne(
      `SELECT * FROM system_users WHERE role = 'employee' AND (email = $1 OR phone = $1)`,
      [identifier]
    );

    if (essUser) {
      if (essUser.password_hash) {
        if (!bcrypt.compareSync(password, essUser.password_hash)) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      } else if (essUser.plain_password) {
        if (password !== essUser.plain_password) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        const hash = bcrypt.hashSync(password, 10);
        await queryOne('UPDATE system_users SET password_hash = $1, plain_password = NULL WHERE id = $2', [hash, essUser.id]);
      } else {
        return res.status(401).json({ error: 'No password set for this user' });
      }

      const token = generateToken({
        id: essUser.id,
        email: essUser.email,
        role: essUser.role,
        company_id: essUser.company_id,
        employee_profile_id: essUser.employee_profile_id,
        custom_permissions: essUser.custom_permissions,
      });
      return res.json({
        token,
        user: {
          id: essUser.id,
          email: essUser.email,
          full_name: essUser.full_name,
          role: essUser.role,
          company_id: essUser.company_id,
          employee_profile_id: essUser.employee_profile_id,
          custom_permissions: getEffectivePermissions(essUser.role, essUser.custom_permissions),
        },
      });
    }

    // Admin / HR login — find by email or phone
    let adminUser = await queryOne(
      `SELECT * FROM system_users WHERE email = $1 AND role != 'employee'`,
      [identifier]
    );

    if (!adminUser) {
      adminUser = await queryOne(
        `SELECT * FROM system_users WHERE phone = $1 AND role != 'employee'`,
        [identifier]
      );
    }

    if (!adminUser) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    if (adminUser.password_hash) {
      const valid = bcrypt.compareSync(password, adminUser.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    } else if (adminUser.plain_password) {
      if (password !== adminUser.plain_password) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const hash = bcrypt.hashSync(password, 10);
      await queryOne('UPDATE system_users SET password_hash = $1, plain_password = NULL WHERE id = $2', [hash, adminUser.id]);
    } else {
      return res.status(401).json({ error: 'No password set for this user' });
    }

    const token = generateToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      company_id: adminUser.company_id,
      employee_profile_id: adminUser.employee_profile_id,
      custom_permissions: adminUser.custom_permissions,
    });

    res.json({
      token,
      user: {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name,
        role: adminUser.role,
        company_id: adminUser.company_id,
        employee_profile_id: adminUser.employee_profile_id,
        custom_permissions: getEffectivePermissions(adminUser.role, adminUser.custom_permissions),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──
router.get('/me', async (req, res, next) => {
  try {
    // This runs after authMiddleware via the main app mounting
    // But auth routes are mounted BEFORE authMiddleware, so we need manual check
    const { authMiddleware } = require('../middleware/auth');
    // Actually, let's handle it inline since this route is under /api/auth which bypasses the global auth
    return res.status(401).json({ error: 'Use the /api/auth/me-protected route' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me (protected — mounted after auth middleware in app.js) ──
// Since /api/auth is mounted before the global authMiddleware, we need a separate approach.
// We'll use a manual token check here.
router.get('/profile', async (req, res, next) => {
  try {
    const { verifyToken } = require('../middleware/auth');
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = verifyToken(authHeader.split(' ')[1]);
    if (!decoded) return res.status(401).json({ error: 'Invalid token' });

    const user = await queryOne(
      `SELECT id, email, full_name, role, company_id, employee_profile_id, custom_permissions FROM system_users WHERE id = $1`,
      [decoded.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      ...user,
      custom_permissions: getEffectivePermissions(user.role, user.custom_permissions),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ──
router.post('/logout', (req, res) => {
  // JWT is stateless — client just discards the token
  res.json({ message: 'Logged out successfully' });
});

// ── GET /api/auth/lookup-phone ──
router.get('/lookup-phone', async (req, res, next) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone parameter required' });

    const user = await queryOne(
      `SELECT email FROM system_users WHERE phone = $1 AND role != 'employee' LIMIT 1`,
      [phone]
    );
    if (!user) return res.json({ email: null });
    res.json({ email: user.email });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
