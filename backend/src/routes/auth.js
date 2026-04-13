const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { createSession, invalidateSession } = require('../sessionStore');
const { requireAuth } = require('../middleware/auth');
const { sanitizeEmail, sanitizeText, createRateLimiter, isSessionToken } = require('../security');

const router = express.Router();
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  keyFn: (req) => `${req.ip}:${sanitizeEmail(req.body?.email || '')}`
});

router.post('/login', loginRateLimiter, async (req, res) => {
  const email = sanitizeEmail(req.body?.email || '');
  const password = sanitizeText(req.body?.password || '', 256, { trim: false });
  if (!email || !password) {
    return res.status(400).json({ message: 'Email e senha são obrigatórios' });
  }

  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ message: 'Credenciais inválidas' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ message: 'Credenciais inválidas' });
  }

  if (!user.is_active) {
    return res.status(403).json({ message: 'Conta bloqueada. Verifique o pagamento.' });
  }

  const sessionToken = createSession({
    id: user.id,
    role: user.role,
    fullName: user.full_name,
    email: user.email,
    className: user.class_name
  });

  res.json({
    token: sessionToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      className: user.class_name,
      isActive: user.is_active
    }
  });
});

router.post('/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (isSessionToken(token)) {
    invalidateSession(token);
  }
  res.status(204).send();
});

module.exports = router;
