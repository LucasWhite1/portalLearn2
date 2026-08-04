const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { createSession, invalidateSession, invalidateUserSessions } = require('../sessionStore');
const { requireAuth } = require('../middleware/auth');
const { sanitizeEmail, sanitizePhone, sanitizeText, createRateLimiter, isSessionToken, getPasswordValidationError, assertSafeRemoteUrl } = require('../security');
const nodemailer = require('nodemailer');
const { decryptStoredSecret } = require('../aiConfigCrypto');
const { ensurePlatformCreditTables } = require('../platformCredits');
const { ensureBillingAccessSchema, getBillingAccessState } = require('../billingAccess');
const { configureSignupPaymentPlan } = require('../studentPayments');
const { shouldAutoApproveSignup } = require('../studentSignupPolicy');

let resetTokenColumnsEnsured = false;
let roleAndOwnershipEnsured = false;
let roleAndOwnershipEnsurePromise = null;
let professorQuotaColumnsEnsured = false;
let professorQuotaColumnsEnsurePromise = null;
let adminSmtpSettingsEnsured = false;
let classesTableEnsured = false;
let studentSignupLinksTableEnsured = false;
let legalConsentColumnsEnsured = false;
const SIGNUP_LINK_TOKEN_REGEX = /^[a-f0-9]{64}$/i;
const LEGAL_TERMS_VERSION = '2026-07-28';
const resetPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip}:${sanitizeEmail(req.body?.email || '')}:reset-password`
});

const ensureRoleAndOwnershipSetup = async () => {
  if (roleAndOwnershipEnsured) return;
  if (!roleAndOwnershipEnsurePromise) {
    roleAndOwnershipEnsurePromise = (async () => {
      await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      await db.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);

      const demoCredentials = [
        { email: 'admin@curso.com', password: 'AdminPass2026!' },
        { email: 'aluno@curso.com', password: 'AlunoLeva10!' },
        { email: 'professor@curso.com', password: 'ProfessorPass2026!' }
      ];
      const { rows: demoUsers } = await db.query(
        'SELECT id, email, password_hash FROM users WHERE email = ANY($1::text[])',
        [demoCredentials.map((entry) => entry.email)]
      );
      const unsafeDefaultAdminIds = [];
      for (const demoUser of demoUsers) {
        const credential = demoCredentials.find((entry) => entry.email === demoUser.email);
        if (credential && await bcrypt.compare(credential.password, demoUser.password_hash)) {
          await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [demoUser.id]);
          if (demoUser.email === 'admin@curso.com') {
            unsafeDefaultAdminIds.push(demoUser.id);
          }
        }
      }
      await db.query(
        `UPDATE users
            SET is_active = TRUE
          WHERE role = 'admin'
            AND NOT (id = ANY($1::uuid[]))`,
        [unsafeDefaultAdminIds]
      );
      roleAndOwnershipEnsured = true;
    })().catch((error) => {
      roleAndOwnershipEnsurePromise = null;
      throw error;
    });
  }
  await roleAndOwnershipEnsurePromise;
};

const ensureProfessorQuotaColumns = async () => {
  if (professorQuotaColumnsEnsured) return;
  if (!professorQuotaColumnsEnsurePromise) {
    professorQuotaColumnsEnsurePromise = (async () => {
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS student_limit INT
  `);
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT
  `);
  professorQuotaColumnsEnsured = true;
    })().catch((error) => {
      professorQuotaColumnsEnsurePromise = null;
      throw error;
    });
  }
  await professorQuotaColumnsEnsurePromise;
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

const ensureClassesTable = async () => {
  if (classesTableEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query('ALTER TABLE classes ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE');
  await db.query('ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_name_key');
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS classes_owner_name_unique
    ON classes (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  `);
  await db.query(
    `INSERT INTO classes (id, name)
     VALUES ($1, 'Turma A')
     ON CONFLICT DO NOTHING`,
    [crypto.randomUUID()]
  );
  classesTableEnsured = true;
};

const ensureStudentSignupLinksTable = async () => {
  if (studentSignupLinksTableEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_signup_links (
      professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
      monthly_amount NUMERIC(12,2),
      due_day INT NOT NULL DEFAULT 10,
      billing_type TEXT NOT NULL DEFAULT 'PIX',
      grace_days INT NOT NULL DEFAULT 5,
      auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      payment_description TEXT,
      payment_instructions TEXT,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE student_signup_links
      ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS due_day INT NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'PIX',
      ADD COLUMN IF NOT EXISTS grace_days INT NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS payment_description TEXT,
      ADD COLUMN IF NOT EXISTS payment_instructions TEXT;
    CREATE TABLE IF NOT EXISTS student_signup_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
      auto_approval_requested BOOLEAN NOT NULL DEFAULT FALSE,
      monthly_amount NUMERIC(12,2),
      due_day INT NOT NULL DEFAULT 10,
      billing_type TEXT NOT NULL DEFAULT 'PIX',
      grace_days INT NOT NULL DEFAULT 5,
      auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      payment_description TEXT,
      payment_instructions TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_student_signup_requests_professor
      ON student_signup_requests(professor_user_id, status, created_at DESC)
  `);
  studentSignupLinksTableEnsured = true;
};

const ensureLegalConsentColumns = async () => {
  if (legalConsentColumnsEnsured) return;
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT');
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ');
  legalConsentColumnsEnsured = true;
};

const hasRequiredLegalConsent = (body = {}) =>
  body?.termsAccepted === true || body?.acceptTerms === true || body?.terms_accepted === true;

const normalizeSignupLinkToken = (value = '') => {
  const normalized = sanitizeText(value, 128).toLowerCase();
  return SIGNUP_LINK_TOKEN_REGEX.test(normalized) ? normalized : '';
};

const hashSignupLinkToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const hashResetPasswordToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const setSessionCookie = (res, token) => {
  const isProduction = ['production', 'prod'].includes(String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase());
  const parts = [
    `criatyve_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=86400'
  ];
  if (isProduction) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const clearSessionCookie = (res) => {
  const isProduction = ['production', 'prod'].includes(String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase());
  const parts = ['criatyve_session=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (isProduction) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const buildSessionPayload = (user, res) => {
  const sessionToken = createSession({
    id: user.id,
    role: user.role,
    fullName: user.full_name,
    email: user.email,
    className: user.class_name,
    ownerUserId: user.owner_user_id || null,
    platformCredits: Number.isFinite(Number(user.platform_credits)) ? Number(user.platform_credits) : 0,
    studentLimit: Number.isFinite(Number(user.student_limit)) ? Number(user.student_limit) : null,
    storageLimitBytes: Number.isFinite(Number(user.storage_limit_bytes)) ? Number(user.storage_limit_bytes) : null,
    billing_access_managed: user.billing_access_managed === true,
    subscription_access_expires_at: user.subscription_access_expires_at || null,
    subscription_plan_code: user.subscription_plan_code || null,
    subscription_billing_type: user.subscription_billing_type || null,
    subscription_payment_status: user.subscription_payment_status || null,
    subscription_last_event_type: user.subscription_last_event_type || null,
    subscription_payment_url: user.subscription_payment_url || null
  });
  setSessionCookie(res, sessionToken);
  return {
    token: 'cookie-session',
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      className: user.class_name,
      ownerUserId: user.owner_user_id || null,
      isActive: user.role === 'admin' ? true : user.is_active,
      platformCredits: user.role === 'professor' && Number.isFinite(Number(user.platform_credits))
        ? Number(user.platform_credits)
        : null,
      studentLimit: Number.isFinite(Number(user.student_limit)) ? Number(user.student_limit) : null,
      storageLimitBytes: Number.isFinite(Number(user.storage_limit_bytes)) ? Number(user.storage_limit_bytes) : null,
      billingAccess: getBillingAccessState(user)
    }
  };
};

const getProfessorSignupAvailability = async (professorId, client = db) => {
  await ensureProfessorQuotaColumns();
  const { rows } = await client.query(
    `SELECT id, full_name, role, is_active, student_limit
       FROM users
      WHERE id = $1`,
    [professorId]
  );
  const professor = rows[0];
  if (!professor || !['professor', 'admin'].includes(professor.role)) {
    return null;
  }
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS total
       FROM users
      WHERE role = 'student'
        AND owner_user_id = $1
        AND is_active = TRUE`,
    [professorId]
  );
  const studentCount = Number(countResult.rows[0]?.total || 0);
  const studentLimit = Number.isFinite(Number(professor.student_limit)) ? Number(professor.student_limit) : null;
  const limitReached = Boolean(studentLimit && studentCount >= studentLimit);
  return {
    professorId,
    professorName: professor.full_name,
    isActive: professor.is_active !== false,
    studentLimit,
    studentCount,
    limitReached: professor.role === 'professor' ? limitReached : false
  };
};

const isSmtpConfigUsable = (settings) =>
  Boolean(settings?.host && settings?.user_email && settings?.user_pass);

const resolveSmtpSettingsForStudent = async () => {
  await ensureAdminSmtpSettingsTable();
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
const authIpRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyFn: (req) => `${req.ip}:auth-ip`
});
const signupLinkLookupRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyFn: (req) => `${req.ip}:signup-link-lookup`
});
const signupLinkRegisterRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip}:${sanitizeEmail(req.body?.email || '')}:signup-link-register`
});
const selfSignupRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: (req) => `${req.ip}:${sanitizeEmail(req.body?.email || '')}:self-signup`
});
const signupIpRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyFn: (req) => `${req.ip}:signup-ip`
});

router.post('/login', authIpRateLimiter, loginRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensurePlatformCreditTables();
  await ensureProfessorQuotaColumns();
  await ensureBillingAccessSchema();
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

  const usesUnsafeDefaultAdminCredential =
    user.role === 'admin'
    && user.email === 'admin@curso.com'
    && password === 'AdminPass2026!';
  if (usesUnsafeDefaultAdminCredential) {
    return res.status(403).json({
      message: 'A senha padrão do administrador foi bloqueada por segurança. Redefina a senha antes de entrar.'
    });
  }
  if (!user.is_active && user.role !== 'admin') {
    if (user.role === 'student') {
      await ensureStudentSignupLinksTable();
      const request = await db.query(
        'SELECT status FROM student_signup_requests WHERE student_user_id = $1',
        [user.id]
      );
      if (request.rows[0]?.status === 'PENDING') {
        return res.status(403).json({
          message: 'Seu cadastro aguarda autorização do professor.',
          code: 'STUDENT_APPROVAL_PENDING'
        });
      }
      if (request.rows[0]?.status === 'REJECTED') {
        return res.status(403).json({
          message: 'Seu cadastro não foi autorizado pelo professor.',
          code: 'STUDENT_APPROVAL_REJECTED'
        });
      }
    }
    return res.status(403).json({ message: 'Conta bloqueada. Verifique o pagamento.' });
  }
  if (user.role === 'admin' && user.is_active === false) {
    await db.query(
      `UPDATE users SET is_active = TRUE WHERE id = $1 AND role = 'admin'`,
      [user.id]
    );
    user.is_active = true;
  }

  res.json(buildSessionPayload(user, res));
});

router.post('/signup', signupIpRateLimiter, selfSignupRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensurePlatformCreditTables();
  await ensureProfessorQuotaColumns();
  await ensureClassesTable();
  await ensureLegalConsentColumns();

  const fullName = sanitizeText(req.body?.fullName || '', 160);
  const email = sanitizeEmail(req.body?.email || '');
  const phone = sanitizePhone(req.body?.phone || '');
  const password = sanitizeText(req.body?.password || '', 256, { trim: false });
  const roleInput = sanitizeText(req.body?.role || '', 32).toLowerCase();
  const role = roleInput === 'professor' ? 'professor' : roleInput === 'student' ? 'student' : '';

  if (!hasRequiredLegalConsent(req.body)) {
    return res.status(400).json({ message: 'Para criar a conta, aceite os Termos de Uso e Privacidade.' });
  }
  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ message: 'Nome, email, senha e tipo de conta são obrigatórios.' });
  }
  if (role === 'professor') {
    return res.status(403).json({
      message: 'O cadastro de professor nao pode ser feito por esta rota. Use o checkout da assinatura ou o painel administrativo.'
    });
  }
  const passwordError = getPasswordValidationError(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const { rows: existingRows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingRows.length) {
    return res.status(409).json({ message: 'Já existe um usuário cadastrado com este email.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = crypto.randomUUID();
  const isProfessor = role === 'professor';
  const className = isProfessor ? 'Professor' : 'Turma A';
  const platformCredits = 0;
  const studentLimit = isProfessor ? 25 : null;
  const storageLimitBytes = isProfessor ? 5 * 1024 * 1024 * 1024 : null;

  try {
    await db.query(
      `INSERT INTO users (
         id, full_name, email, phone, password_hash, role, class_name, is_active, owner_user_id,
         platform_credits, platform_credits_updated_at, student_limit, storage_limit_bytes,
         terms_accepted_at, terms_version, marketing_consent_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, NOW(), $10, $11, NOW(), $12, $13)`,
      [
        userId,
        fullName,
        email,
        phone || null,
        passwordHash,
        role,
        className,
        null,
        platformCredits,
        studentLimit,
        storageLimitBytes,
        LEGAL_TERMS_VERSION,
        req.body?.marketingConsent === false ? null : new Date()
      ]
    );
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Já existe um usuário cadastrado com este email.' });
    }
    throw error;
  }

  const { rows: createdRows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  return res.status(201).json(buildSessionPayload(createdRows[0], res));
});

router.post('/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (isSessionToken(token)) {
    invalidateSession(token);
  }
  if (isSessionToken(req.sessionToken)) {
    invalidateSession(req.sessionToken);
  }
  clearSessionCookie(res);
  res.status(204).send();
});

router.post('/forgot-password', authIpRateLimiter, loginRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureResetTokenColumns();
  await ensureAdminSmtpSettingsTable();
  const email = sanitizeEmail(req.body?.email || '');
  if (!email) {
    return res.status(400).json({ message: 'Email é obrigatório' });
  }

  res.json({ message: 'Se o email estiver cadastrado, um token de recuperação foi enviado.' });

  const { rows } = await db.query(
    'SELECT id, full_name, owner_user_id FROM users WHERE email = $1 AND role IN ($2, $3)',
    [email, 'student', 'professor']
  );
  const user = rows[0];
  if (!user) return;

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 3600000);
  const tokenHash = hashResetPasswordToken(token);

  await db.query(
    'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
    [tokenHash, expires, user.id]
  );

  try {
    const smtp = await resolveSmtpSettingsForStudent();
    
    if (!isSmtpConfigUsable(smtp)) {
      console.error('SMTP nao configurado. O token de recuperacao nao foi enviado.');
      return;
    }
    await assertSafeRemoteUrl(`https://${smtp.host}`);

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure !== false,
      auth: {
        user: smtp.user_email,
        pass: decryptStoredSecret(smtp.user_pass)
      },
      tls: { rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
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

router.post('/reset-password', authIpRateLimiter, resetPasswordRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureResetTokenColumns();
  const email = sanitizeEmail(req.body?.email || '');
  const token = sanitizeText(req.body?.token || '', 128);
  const newPassword = sanitizeText(req.body?.newPassword || '', 256, { trim: false });

  if (!email || !token || !newPassword) {
    return res.status(400).json({ message: 'Email, token e nova senha são obrigatórios' });
  }
  const passwordError = getPasswordValidationError(newPassword);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const tokenHash = hashResetPasswordToken(token);

  const { rows } = await db.query(
    'SELECT id, reset_password_expires FROM users WHERE email = $1 AND reset_password_token = $2',
    [email, tokenHash]
  );
  
  const user = rows[0];
  if (!user) {
    return res.status(400).json({ message: 'Token inválido ou expirado' });
  }

  if (new Date() > new Date(user.reset_password_expires)) {
    return res.status(400).json({ message: 'Token expirado' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const { rows: updatedRows } = await db.query(
    `UPDATE users
        SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL
      WHERE id = $2 AND reset_password_token = $3
    RETURNING id`,
    [hashedPassword, user.id, tokenHash]
  );
  if (!updatedRows.length) {
    return res.status(400).json({ message: 'Token invalido ou ja utilizado' });
  }
  invalidateUserSessions(user.id);

  res.json({ message: 'Senha atualizada com sucesso' });
});

router.get('/student-signup-link/:token', signupLinkLookupRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureProfessorQuotaColumns();
  await ensureStudentSignupLinksTable();
  const inviteToken = normalizeSignupLinkToken(req.params.token || '');
  if (!inviteToken) {
    return res.status(404).json({ message: 'Link de cadastro inválido.' });
  }
  const tokenHash = hashSignupLinkToken(inviteToken);
  const { rows } = await db.query(
    `SELECT professor_user_id, auto_approve, monthly_amount, due_day, billing_type, grace_days, created_at
       FROM student_signup_links
      WHERE token_hash = $1
        AND revoked_at IS NULL`,
    [tokenHash]
  );
  const invite = rows[0];
  if (!invite) {
    return res.status(404).json({ message: 'Link de cadastro inválido ou expirado.' });
  }
  const availability = await getProfessorSignupAvailability(invite.professor_user_id, db);
  if (!availability) {
    return res.status(404).json({ message: 'Link de cadastro inválido ou expirado.' });
  }
  if (!availability.isActive) {
    return res.json({
      professorName: availability.professorName,
      acceptingRegistrations: false,
      message: 'Este link de cadastro está indisponível no momento.'
    });
  }
  res.json({
    professorName: availability.professorName,
    acceptingRegistrations: true,
    approvalMode: invite.auto_approve ? 'AUTOMATIC' : 'MANUAL',
    monthlyAmount: invite.monthly_amount === null ? null : Number(invite.monthly_amount),
    dueDay: Number(invite.due_day || 10),
    billingType: invite.billing_type || 'PIX',
    studentLimit: availability.studentLimit,
    studentCount: availability.studentCount,
    limitReached: availability.limitReached,
    createdAt: invite.created_at
  });
});

router.post('/student-signup-link/:token/register', signupIpRateLimiter, signupLinkRegisterRateLimiter, async (req, res) => {
  await ensureRoleAndOwnershipSetup();
  await ensureProfessorQuotaColumns();
  await ensureStudentSignupLinksTable();
  await ensureClassesTable();
  await ensureLegalConsentColumns();
  const inviteToken = normalizeSignupLinkToken(req.params.token || '');
  const fullName = sanitizeText(req.body?.fullName || '', 160);
  const email = sanitizeEmail(req.body?.email || '');
  const phone = sanitizePhone(req.body?.phone || '');
  const password = sanitizeText(req.body?.password || '', 256, { trim: false });
  if (!hasRequiredLegalConsent(req.body)) {
    return res.status(400).json({ message: 'Para criar a conta, aceite os Termos de Uso e Privacidade.' });
  }
  if (!inviteToken) {
    return res.status(404).json({ message: 'Link de cadastro inválido.' });
  }
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha são obrigatórios.' });
  }
  const passwordError = getPasswordValidationError(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  const tokenHash = hashSignupLinkToken(inviteToken);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: inviteRows } = await client.query(
      `SELECT l.*
         FROM student_signup_links l
         JOIN users u ON u.id = l.professor_user_id
        WHERE l.token_hash = $1
          AND l.revoked_at IS NULL
          AND u.role IN ('professor', 'admin')
        FOR UPDATE OF u`,
      [tokenHash]
    );
    const invite = inviteRows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Link de cadastro inválido ou expirado.' });
    }
    const availability = await getProfessorSignupAvailability(invite.professor_user_id, client);
    if (!availability?.isActive) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Este link de cadastro está indisponível no momento.' });
    }
    const { rows: existingUsers } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUsers.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Já existe um usuário cadastrado com este email.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const autoApproved = shouldAutoApproveSignup({
      autoApprove: invite.auto_approve,
      limitReached: availability.limitReached,
      professorActive: availability.isActive
    });
    await client.query(
      `INSERT INTO classes (id, name, owner_user_id)
       VALUES ($1, 'Turma A', $2)
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), invite.professor_user_id]
    );
    await client.query(
      `INSERT INTO users (
         id, full_name, email, phone, password_hash, role, class_name, is_active, owner_user_id,
         terms_accepted_at, terms_version, marketing_consent_at
       )
       VALUES ($1, $2, $3, $4, $5, 'student', $6, $7, $8, NOW(), $9, $10)`,
      [
        userId,
        fullName,
        email,
        phone || null,
        passwordHash,
        'Turma A',
        autoApproved,
        invite.professor_user_id,
        LEGAL_TERMS_VERSION,
        req.body?.marketingConsent === false ? null : new Date()
      ]
    );
    await client.query(
      `INSERT INTO student_signup_requests (
         student_user_id, professor_user_id, status, auto_approval_requested,
         monthly_amount, due_day, billing_type, grace_days, auto_block,
         payment_description, payment_instructions, reviewed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        userId,
        invite.professor_user_id,
        autoApproved ? 'APPROVED' : 'PENDING',
        invite.auto_approve === true,
        invite.monthly_amount,
        invite.due_day,
        invite.billing_type,
        invite.grace_days,
        invite.auto_block,
        invite.payment_description,
        invite.payment_instructions,
        autoApproved ? new Date() : null
      ]
    );
    const { rows: createdRows } = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    if (!autoApproved) {
      return res.status(201).json({
        approvalRequired: true,
        status: 'PENDING',
        message: availability.limitReached
          ? 'Cadastro enviado ao professor. A aprovação será possível quando houver vaga no limite de alunos.'
          : 'Cadastro enviado. Aguarde a autorização do professor para entrar.'
      });
    }
    try {
      await configureSignupPaymentPlan({
        professorId: invite.professor_user_id,
        studentId: userId,
        amount: invite.monthly_amount,
        dueDay: invite.due_day,
        preferredBillingType: invite.billing_type,
        graceDays: invite.grace_days,
        autoBlock: invite.auto_block,
        description: invite.payment_description,
        instructions: invite.payment_instructions
      });
    } catch (paymentError) {
      console.error('Falha ao preparar cobrança do cadastro aprovado:', paymentError.message);
    }
    return res.status(201).json(buildSessionPayload(createdRows[0], res));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Já existe um usuário cadastrado com este email.' });
    }
    throw error;
  } finally {
    client.release();
  }
});

module.exports = router;
