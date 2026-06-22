const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { authMiddleware } = require('./middleware/auth');
const { attachPermissions } = require('./middleware/rbac');

// Routes
const authRoutes = require('./routes/auth');
const employeesRoutes = require('./routes/employees');
const companiesRoutes = require('./routes/companies');
const assetsRoutes = require('./routes/assets');
const complianceRoutes = require('./routes/compliance');
const requestsRoutes = require('./routes/requests');
const payrollRoutes = require('./routes/payroll');
const lettersRoutes = require('./routes/letters');
const vehiclesRoutes = require('./routes/vehicles');
const usersRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');

const app = express();

// ── Security & Utility Middleware ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Rate Limiting ──
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
});

// ── Health Check ──
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Routes ──
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api', authMiddleware, attachPermissions);
app.use('/api/employees', employeesRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/letters', lettersRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);

// ── Serve Frontend Static Files ──
const frontendPath = path.join(__dirname, '..', '..', 'public');
app.use(express.static(frontendPath));
app.use('/assets', express.static(path.join(frontendPath, 'assets')));
app.use('/pages', express.static(path.join(frontendPath, 'pages')));

// SPA fallback: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── 404 Handler ──
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error Handler ──
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate entry: record already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record not found (foreign key violation)' });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] HR-Gpack API running on port ${PORT}`);
});

module.exports = app;
