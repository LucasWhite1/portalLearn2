const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { createSession, invalidateSession } = require('../sessionStore');
const { requireAuth } = require('../middleware/auth');
const { sanitizeEmail, sanitizeText, createRateLimiter, isSessionToken } = require('../security');
const nodemailer = require('nodemailer');

let resetTokenColumnsEnsured = false;
let roleAndOwnershipEnsured = false;
let professorCreditColumnsEnsured = false;
let professorQuotaColumnsEnsured = false;
let adminSmtpSettingsEnsured = false;
let professorSmtpSettingsEnsured = false;

const ensureRoleAndOwnershipSetup = async () => {
  if (roleAndOwnershipEnsured) return;
  await db.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check
  `);
  await db.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'admin', 'professor'))
  `);
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await db.query(`
    ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await db.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);

  const { rows } = await db.query("SELECT id FROM users WHERE email = $1", ['professor@curso.com']);
  if (!rows.length) {
    const passwordHash = await bcrypt.hash('ProfessorPass2026!', 10);
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, password_hash, role, class_name, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'professor', $5, TRUE)`,
      ['Professor Exemplo', 'professor@curso.com', '+55 11 11111-1111', passwordHash, 'Professor']
    );
  }
  roleAndOwnershipEnsured = true;
};

const ensureProfessorCreditColumns = async () => {
  if (professorCreditColumnsEnsured) return;
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_credits NUMERIC(12,2) NOT NULL DEFAULT 0
  `);
  await db.query(`
    ALTER TABLE users
    ALTER COLUMN ai_credits TYPE NUMERIC(12,2)
    USING COALESCE(ai_credits, 0)::numeric(12,2)
  `);
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_credits_updated_at TIMESTAMPTZ DEFAULT NOW()
  `);
  professorCreditColumnsEnsured = true;
};

const ensureProfessorQuotaColumns = async () => {
  if (professorQuotaColumnsEnsured) return;
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS student_limit INT
  `);
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT
  `);
  professorQuotaColumnsEnsured = true;
};

const ensureAdminSmtpSettingsTable = async () => {
  if (adminSmtpSettingsEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_smtp_settings (
      id INT PRIMARY KEY DEFAULT 1,
      host TEXT,
      port INT,
      secure BOOLEAN,
      user_email TEXT,
      user_pass TEXT,
      from_email TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (id = 1)
    )
  `);
  adminSmtpSettingsEnsured = true;
};

const ensureProfessorSmtpSettingsTable = async () => {
  if (professorSmtpSettingsEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS professor_smtp_settings (
      professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      host TEXT,
      port INT,
      secure BOOLEAN,
      user_email TEXT,
      user_pass TEXT,
      from_email TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  professorSmtpSettingsEnsured = true;
};

const isSmtpConfigUsable = (settings) =>
  Boolean(settings?.host && settings?.user_email && settings?.user_pass);

const resolveSmtpSettingsForStudent = async (studentOwnerUserId) => {
  await ensureAdminSmtpSettingsTable();
  await ensureProfessorSmtpSettingsTable();
  if (studentOwnerUserId) {
    const { rows } = await db.query(
      'SELECT host, port, secure, user_email, user_pass, from_email FROM professor_smtp_settings WHERE professor_user_id = $1',
      [studentOwnerUserId]
    );
    if (isSmtpConfigUsable(rows[0])) {
      return rows[0];
    }
  }
  const { rows } = await db.query(
    'SELECT host, port, secure, user_email, user_pass, from_email FROM admin_smtp_settings WHERE id = 1'
  );
  return rows[0] || null;
};

const ensureResetTokenColumns = async () => {
  if (resetTokenColumnsEnsured) return;
  // Make sure admin_smtp_settings table exists as well, or just let admin.js handle it?
  // We handle only users table here.
  try {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reset_password_token TEXT,
      ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ
    `);
    resetTokenColumnsEnsured = true;
  } catch (e) {
    console.error(e);
  }
};


const router = express.Router();
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  keyFn: (req) => `${req.ip}:${sanitizeEmail(req.body?.email || '')}`
});

router.post('/login', loginRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
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
    className: user.class_name,
    ownerUserId: user.owner_user_id || null,
    aiCredits: Number.isFinite(Number(user.ai_credits)) ? Number(user.ai_credits) : 0,
    studentLimit: Number.isFinite(Number(user.student_limit)) ? Number(user.student_limit) : null,
    storageLimitBytes: Number.isFinite(Number(user.storage_limit_bytes)) ? Number(user.storage_limit_bytes) : null
  });

  res.json({
    token: sessionToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      className: user.class_name,
      ownerUserId: user.owner_user_id || null,
      isActive: user.is_active,
      aiCredits: Number.isFinite(Number(user.ai_credits)) ? Number(user.ai_credits) : 0,
      studentLimit: Number.isFinite(Number(user.student_limit)) ? Number(user.student_limit) : null,
      storageLimitBytes: Number.isFinite(Number(user.storage_limit_bytes)) ? Number(user.storage_limit_bytes) : null
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

router.post('/forgot-password', loginRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureResetTokenColumns();
  await ensureAdminSmtpSettingsTable();
  await ensureProfessorSmtpSettingsTable();
  const email = sanitizeEmail(req.body?.email || '');
  if (!email) {
    return res.status(400).json({ message: 'Email é obrigatório' });
  }

  res.json({ message: 'Se o email estiver cadastrado, um token de recuperação foi enviado.' });

  const { rows } = await db.query(
    'SELECT id, full_name, owner_user_id FROM users WHERE email = $1 AND role = $2',
    [email, 'student']
  );
  const user = rows[0];
  if (!user) return;

  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 3600000);

  await db.query(
    'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
    [token, expires, user.id]
  );

  try {
    const smtp = await resolveSmtpSettingsForStudent(user.owner_user_id || null);
    
    if (!isSmtpConfigUsable(smtp)) {
      console.error('SMTP não configurado. Token não enviado:', token);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure !== false,
      auth: {
        user: smtp.user_email,
        pass: smtp.user_pass
      },
      tls: {
        rejectUnauthorized: false
      },
      family: 4 // Força o uso de IPv4 para evitar erros ENETUNREACH
    });

    await transporter.sendMail({
      from: smtp.from_email || smtp.user_email,
      to: email,
      subject: 'Recuperação de Senha',
      text: `Olá ${user.full_name},\n\nSeu token de recuperação de senha é: ${token}\n\nEle é válido por 1 hora.`,
      html: `<p>Olá ${user.full_name},</p><p>Seu token de recuperação de senha é: <strong>${token}</strong></p><p>Ele é válido por 1 hora.</p>`
    });
  } catch (err) {
    console.error('Erro ao enviar email de recuperação:', err.message);
  }
});

router.post('/reset-password', async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureResetTokenColumns();
  const email = sanitizeEmail(req.body?.email || '');
  const token = sanitizeText(req.body?.token || '', 10);
  const newPassword = sanitizeText(req.body?.newPassword || '', 256, { trim: false });

  if (!email || !token || !newPassword) {
    return res.status(400).json({ message: 'Email, token e nova senha são obrigatórios' });
  }

  const { rows } = await db.query(
    'SELECT id, reset_password_expires FROM users WHERE email = $1 AND reset_password_token = $2',
    [email, token]
  );
  
  const user = rows[0];
  if (!user) {
    return res.status(400).json({ message: 'Token inválido ou expirado' });
  }

  if (new Date() > new Date(user.reset_password_expires)) {
    return res.status(400).json({ message: 'Token expirado' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await db.query(
    'UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
    [hashedPassword, user.id]
  );

  res.json({ message: 'Senha atualizada com sucesso' });
});

module.exports = router;
