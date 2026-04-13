const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');

const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '50mb';
const frontendDir = path.resolve(__dirname, '../../frontend');

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.static(frontendDir));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      message: `Arquivo muito grande para salvar o módulo. Limite atual: ${JSON_BODY_LIMIT}.`
    });
  }
  console.error(err);
  res.status(500).json({ message: 'Erro interno' });
});

module.exports = app;
