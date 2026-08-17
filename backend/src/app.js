const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');
const faceRoutes = require('./routes/face');
const adminFaceRoutes = require('./routes/adminFace');
const billingRoutes = require('./routes/billing');
const chatRoutes = require('./routes/chat');
const {
  adminRouter: studentPaymentsAdminRoutes,
  studentRouter: studentPaymentsStudentRoutes,
  webhookRouter: studentPaymentsWebhookRoutes,
  requireStudentPaymentAccess
} = require('./studentPayments');
const { requireAuth, requireRole } = require('./middleware/auth');

const app = express();
const ADMIN_JSON_BODY_LIMIT = process.env.ADMIN_JSON_BODY_LIMIT || process.env.JSON_BODY_LIMIT || '50mb';
const STUDENT_JSON_BODY_LIMIT = process.env.STUDENT_JSON_BODY_LIMIT || process.env.JSON_BODY_LIMIT || '50mb';
const studentJsonParser = express.json({ limit: STUDENT_JSON_BODY_LIMIT });
const frontendDir = path.resolve(__dirname, '../../frontend');
const templateStoreDir = path.resolve(__dirname, '../../template-store');
const threeVendorDir = path.resolve(__dirname, '../node_modules/three');
const isProductionEnvironment = ['production', 'prod'].includes(
  String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase()
);
const configuredAllowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...configuredAllowedOrigins];

try {
  const publicOrigin = new URL(String(process.env.PUBLIC_APP_URL || '')).origin;
  if (publicOrigin && !allowedOrigins.includes(publicOrigin)) allowedOrigins.push(publicOrigin);
} catch (error) {
  // PUBLIC_APP_URL is validated at startup in production.
}

const allowAnyOrigin = !isProductionEnvironment && configuredAllowedOrigins.length === 0;
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://connect.facebook.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
      "img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; frame-src 'self' https:; " +
      "connect-src 'self' http://localhost:* http://127.0.0.1:* https://0.peerjs.com wss://0.peerjs.com https://connect.facebook.net https://www.facebook.com; worker-src 'self' blob:; form-action 'self'"
  );
  res.setHeader('Cache-Control', 'no-store');
  if (isProductionEnvironment && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (allowAnyOrigin || !origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    const error = new Error('Origem nao permitida pelo CORS');
    error.statusCode = 403;
    return callback(error);
  },
  credentials: true
}));
app.use('/vendor/three', express.static(threeVendorDir, {
  dotfiles: 'deny',
  fallthrough: false,
  immutable: true,
  maxAge: '30d',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  }
}));
app.use('/template-store', express.static(templateStoreDir, {
  dotfiles: 'deny',
  fallthrough: false,
  maxAge: '1h',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  }
}));
app.use(express.static(frontendDir, {
  dotfiles: 'deny',
  index: false,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (path.extname(filePath).toLowerCase() === '.html') {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  }
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/checkout', (req, res) => {
  const requestedPlan = String(req.query?.plan || 'pro');
  const plan = ['pro', 'pro-unlimited', 'trial-30-dias'].includes(requestedPlan) ? requestedPlan : 'pro';
  res.redirect(303, `/checkout.html?plan=${encodeURIComponent(plan)}`);
});

const publicStudentModuleRequest = (req) =>
  req.method === 'GET' && (
    /^\/public\/modules\/[0-9a-f-]+$/i.test(req.path) ||
    /^\/public\/3d-assets\/[0-9a-f-]+\/file$/i.test(req.path)
  );
const requireStudentApiAuth = (req, res, next) => {
  if (publicStudentModuleRequest(req)) return next();
  return requireAuth(req, res, next);
};

app.use('/api/auth', express.json({ limit: '64kb' }), authRoutes);
app.use(
  '/api/admin',
  requireAuth,
  requireRole(['admin', 'professor']),
  express.json({ limit: ADMIN_JSON_BODY_LIMIT }),
  adminFaceRoutes,
  studentPaymentsAdminRoutes,
  adminRoutes
);
app.use(
  '/api/student',
  studentJsonParser,
  requireStudentApiAuth,
  studentPaymentsStudentRoutes,
  requireStudentPaymentAccess,
  faceRoutes,
  studentRoutes
);
app.use('/api/billing', express.json({ limit: '256kb' }), studentPaymentsWebhookRoutes, billingRoutes);
app.use('/api/chat', requireAuth, express.json({ limit: '64kb' }), chatRoutes);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'O corpo da requisicao excede o tamanho permitido para esta rota.' });
  }
  if (err?.type === 'stream.not.readable') {
    return res.status(400).json({ message: 'Nao foi possivel ler o corpo da requisicao. Tente enviar novamente.' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'JSON invalido.' });
  }
  if (err?.statusCode === 503 && String(err?.code || '').startsWith('FACE_SERVICE_')) {
    console.warn(`[face] ${err.code}: servico interno indisponivel.`);
    return res.status(503).json({
      message: err.message,
      code: err.code
    });
  }
  console.error(err);
  return res.status(err?.statusCode || 500).json({
    message: err?.statusCode ? err.message : 'Erro interno'
  });
});

module.exports = app;
