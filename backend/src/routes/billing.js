const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db');
const { decryptStoredSecret } = require('../aiConfigCrypto');
const { processCreditTopupWebhook } = require('../creditTopups');
const { processStudentSeatUpgradeWebhook } = require('../studentSeatUpgrades');
const { applyCreditChange, ensurePlatformCreditTables } = require('../platformCredits');
const { sendMetaPurchaseEvent } = require('../metaConversions');
const { requireAuth } = require('../middleware/auth');
const {
  PAYMENT_FAILURE_EVENTS,
  PAYMENT_PENDING_EVENTS,
  calculateNextAccessExpiration,
  ensureBillingAccessSchema,
  getBillingAccessState
} = require('../billingAccess');
const {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  createRateLimiter,
  assertSafeRemoteUrl
} = require('../security');

const router = express.Router();

const checkoutRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 6,
  keyFn: (req) => sanitizeText(req.ip || req.headers['x-forwarded-for'] || 'anonymous', 160)
});

const ASAAS_SANDBOX_URL = 'https://api-sandbox.asaas.com/v3';
const ASAAS_PRODUCTION_URL = 'https://api.asaas.com/v3';
const TRIAL_DAYS = Number.parseInt(process.env.ASAAS_TRIAL_DAYS || '30', 10) || 30;
const PRO_MONTHLY_PRICE = Number.parseFloat(process.env.ASAAS_PRO_MONTHLY_PRICE || '97.90');
const INCLUDED_STUDENT_LIMIT = Number.parseInt(process.env.ASAAS_INCLUDED_STUDENT_LIMIT || '15', 10) || 15;
const EXTRA_STUDENT_MONTHLY_PRICE = Number.parseFloat(process.env.ASAAS_EXTRA_STUDENT_MONTHLY_PRICE || '9.70');
const PRO_PLATFORM_CREDITS = Number.parseFloat(process.env.ASAAS_PRO_PLATFORM_CREDITS || process.env.ASAAS_PRO_AI_CREDITS || '100');
const TRIAL_PLATFORM_CREDITS = Number.parseFloat(process.env.ASAAS_TRIAL_PLATFORM_CREDITS || process.env.ASAAS_TRIAL_AI_CREDITS || '10');
const APP_NAME = sanitizeText(process.env.ASAAS_APP_NAME || 'Criatyve/1.0', 120) || 'Criatyve/1.0';
const LEGAL_TERMS_VERSION = '2026-07-28';
const ASAAS_API_KEY = sanitizeText(process.env.ASAAS_API_KEY || '', 255);
const ASAAS_WEBHOOK_AUTH_TOKEN = sanitizeText(process.env.ASAAS_WEBHOOK_AUTH_TOKEN || '', 255);
const ASAAS_ENV = String(process.env.ASAAS_ENV || 'sandbox').toLowerCase() === 'production'
  ? 'production'
  : 'sandbox';
const ASAAS_BASE_URL = sanitizeText(
  process.env.ASAAS_BASE_URL || (ASAAS_ENV === 'production' ? ASAAS_PRODUCTION_URL : ASAAS_SANDBOX_URL),
  255
);
const PUBLIC_APP_URL = sanitizeText(process.env.PUBLIC_APP_URL || '', 255).replace(/\/+$/, '');
const ASAAS_WEBHOOK_ENFORCE_SOURCE_IP = String(process.env.ASAAS_WEBHOOK_ENFORCE_SOURCE_IP || '')
  .toLowerCase() === 'true';
const ASAAS_WEBHOOK_ALLOWED_IPS = new Set(
  String(process.env.ASAAS_WEBHOOK_ALLOWED_IPS || '')
    .split(',')
    .map((entry) => sanitizeText(entry, 64))
    .filter(Boolean)
);
const ASAAS_PRODUCTION_WEBHOOK_IPS = new Set([
  '52.67.12.206',
  '18.230.8.159',
  '54.94.136.112',
  '54.94.183.101'
]);
const ASAAS_CHECKOUT_BILLING_TYPES = new Set(['CREDIT_CARD', 'PIX']);

const normalizeCheckoutBillingTypes = (value, fallback = ['CREDIT_CARD']) => {
  const entries = Array.isArray(value) ? value : String(value || '').split(',');
  const billingTypes = entries
    .map((entry) => sanitizeText(entry, 30).toUpperCase())
    .filter((entry) => ASAAS_CHECKOUT_BILLING_TYPES.has(entry));

  return billingTypes.length ? Array.from(new Set(billingTypes)) : fallback;
};

const PRO_BILLING_TYPES = normalizeCheckoutBillingTypes(
  process.env.ASAAS_PRO_BILLING_TYPES || 'PIX,CREDIT_CARD',
  ['PIX', 'CREDIT_CARD']
);
const TRIAL_BILLING_TYPES = normalizeCheckoutBillingTypes(
  process.env.ASAAS_TRIAL_BILLING_TYPES || 'CREDIT_CARD',
  ['CREDIT_CARD']
);

const sanitizeCpfCnpj = (value) => sanitizeText(value || '', 32).replace(/\D/g, '').slice(0, 14);

const ACTIVE_PAYMENT_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const ACCESS_REVOCATION_EVENTS = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED'
]);

let billingTablesEnsured = false;
let billingTablesEnsurePromise = null;
let adminSmtpSettingsEnsured = false;
let professorQuotaColumnsEnsured = false;
let professorCreditColumnsEnsured = false;
let roleAndOwnershipEnsured = false;

const addDaysToDate = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatDateOnly = (value) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildPublicBaseUrl = (req) => {
  if (PUBLIC_APP_URL) {
    return PUBLIC_APP_URL;
  }
  const forwardedProto = sanitizeText(req.headers['x-forwarded-proto'] || '', 16).toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : req.protocol || 'http';
  const host = sanitizeText(req.get('host') || '', 255);
  return host ? `${protocol}://${host}` : 'http://localhost:4000';
};

const isPublicCallbackUrl = (baseUrl = '') => {
  if (!baseUrl) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
};

const PLANS = {
  pro: {
    id: 'pro',
    label: 'Criatyve Pro',
    price: Number.isFinite(PRO_MONTHLY_PRICE) ? PRO_MONTHLY_PRICE : 97.90,
    description: 'Assinatura mensal da plataforma Criatyve Pro',
    nextDueDate: () => formatDateOnly(new Date()),
    trialDays: 0,
    billingTypes: PRO_BILLING_TYPES,
    studentLimit: INCLUDED_STUDENT_LIMIT,
    storageLimitBytes: 1024 * 1024 * 1024,
    platformCredits: Number.isFinite(PRO_PLATFORM_CREDITS) ? PRO_PLATFORM_CREDITS : 100
  },
  'pro-unlimited': {
    id: 'pro-unlimited',
    label: 'Criatyve Pro Ilimitado',
    price: Number.isFinite(PRO_MONTHLY_PRICE) ? PRO_MONTHLY_PRICE : 97.90,
    description: 'Assinatura mensal Criatyve Pro com alunos ilimitados, 1 GB e 100 creditos de IA',
    nextDueDate: () => formatDateOnly(new Date()),
    trialDays: 0,
    billingTypes: PRO_BILLING_TYPES,
    studentLimit: 0,
    unlimitedStudents: true,
    storageLimitBytes: 1024 * 1024 * 1024,
    platformCredits: Number.isFinite(PRO_PLATFORM_CREDITS) ? PRO_PLATFORM_CREDITS : 100
  },
  'trial-30-dias': {
    id: 'trial-30-dias',
    label: 'Criatyve Trial 30 dias',
    price: Number.isFinite(PRO_MONTHLY_PRICE) ? PRO_MONTHLY_PRICE : 97.90,
    description: `Teste de ${TRIAL_DAYS} dias do plano Criatyve Pro`,
    nextDueDate: () => formatDateOnly(addDaysToDate(new Date(), TRIAL_DAYS)),
    trialDays: TRIAL_DAYS,
    billingTypes: TRIAL_BILLING_TYPES,
    studentLimit: INCLUDED_STUDENT_LIMIT,
    storageLimitBytes: 1024 * 1024 * 1024,
    platformCredits: Number.isFinite(TRIAL_PLATFORM_CREDITS) ? TRIAL_PLATFORM_CREDITS : 10
  }
};

const getPlanConfig = (planKey = '') => PLANS[planKey] || PLANS.pro;

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getExtraStudentPrice = () =>
  Number.isFinite(EXTRA_STUDENT_MONTHLY_PRICE) && EXTRA_STUDENT_MONTHLY_PRICE > 0
    ? EXTRA_STUDENT_MONTHLY_PRICE
    : 9.70;

const normalizeRequestedStudentLimit = (value, plan) => {
  if (plan?.unlimitedStudents) return 0;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const baseLimit = Number(plan?.studentLimit) || INCLUDED_STUDENT_LIMIT;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return baseLimit;
  }
  return Math.min(Math.max(parsed, baseLimit), 100000);
};

const buildPlanPurchase = ({ plan, requestedStudentLimit, existingStudentLimit = 0 } = {}) => {
  if (plan?.unlimitedStudents) {
    return {
      amount: roundCurrency(Number(plan?.price) || 0),
      baseLimit: 0,
      studentLimit: 0,
      unlimitedStudents: true,
      extraStudents: 0,
      extraAmount: 0,
      extraStudentPrice: 0
    };
  }
  const baseLimit = Number(plan?.studentLimit) || INCLUDED_STUDENT_LIMIT;
  const resolvedStudentLimit = Math.max(
    baseLimit,
    normalizeRequestedStudentLimit(requestedStudentLimit, plan),
    Number.isFinite(Number(existingStudentLimit)) ? Number(existingStudentLimit) : 0
  );
  const extraStudents = Math.max(0, resolvedStudentLimit - baseLimit);
  const extraAmount = roundCurrency(extraStudents * getExtraStudentPrice());
  const amount = roundCurrency((Number(plan?.price) || 0) + extraAmount);
  return {
    amount,
    baseLimit,
    studentLimit: resolvedStudentLimit,
    extraStudents,
    extraAmount,
    extraStudentPrice: getExtraStudentPrice()
  };
};

const resolveCheckoutPaymentMode = (plan, requestedBillingType) => {
  const requested = sanitizeText(requestedBillingType || '', 30).toUpperCase();
  const configuredBillingTypes = Array.isArray(plan?.billingTypes) ? plan.billingTypes : ['CREDIT_CARD'];
  if (plan?.trialDays === 0 && requested === 'PIX' && configuredBillingTypes.includes('PIX')) {
    return {
      billingTypes: ['PIX'],
      chargeTypes: ['DETACHED'],
      paymentMode: 'pix_detached',
      subscription: null
    };
  }

  return {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    paymentMode: 'credit_card_recurrent',
    subscription: {
      cycle: 'MONTHLY',
      nextDueDate: plan.nextDueDate()
    }
  };
};

const findExistingProfessorBillingLimit = async (email) => {
  const normalizedEmail = sanitizeEmail(email || '');
  if (!normalizedEmail) return 0;
  await ensureBillingTables();
  const { rows } = await db.query(
    `
      SELECT GREATEST(
        COALESCE((
          SELECT MAX(student_limit)
            FROM users
           WHERE LOWER(email) = LOWER($1)
             AND role IN ('professor', 'admin')
        ), 0),
        COALESCE((
          SELECT MAX(student_limit)
            FROM billing_subscriptions
           WHERE LOWER(payer_email) = LOWER($1)
             AND provider = 'asaas'
             AND (status = 'ACTIVE' OR user_id IS NOT NULL)
        ), 0)
      ) AS student_limit
    `,
    [normalizedEmail]
  );
  return Number.isFinite(Number(rows[0]?.student_limit)) ? Number(rows[0].student_limit) : 0;
};

const buildCheckoutUrl = (checkoutResponse) => {
  if (checkoutResponse?.link) {
    return checkoutResponse.link;
  }
  if (checkoutResponse?.id) {
    const checkoutHost = ASAAS_ENV === 'production' ? 'https://www.asaas.com' : 'https://sandbox.asaas.com';
    return `${checkoutHost}/checkoutSession/show/${encodeURIComponent(checkoutResponse.id)}`;
  }
  return '';
};

const normalizePlanCodeFromExternalReference = (externalReference = '') => {
  const normalized = sanitizeText(externalReference, 160);
  const match = normalized.match(/^checkout:(pro|pro-unlimited|trial-30-dias):/i);
  return match ? match[1].toLowerCase() : '';
};

const buildRandomPassword = () => crypto.randomBytes(9).toString('base64url') + 'Aa1!';

const normalizeIpAddress = (value = '') => {
  const normalized = sanitizeText(value, 120).split(',')[0].trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
};

const hasRequiredLegalConsent = (source = {}) =>
  source?.termsAccepted === true || source?.acceptTerms === true || source?.terms_accepted === true;

const extractWebhookSourceIp = (req) =>
  normalizeIpAddress(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '');

const isWebhookSourceIpAllowed = (req) => {
  const sourceIp = extractWebhookSourceIp(req);
  if (!ASAAS_WEBHOOK_ENFORCE_SOURCE_IP) {
    return true;
  }
  if (!sourceIp) {
    return false;
  }
  if (ASAAS_WEBHOOK_ALLOWED_IPS.size) {
    return ASAAS_WEBHOOK_ALLOWED_IPS.has(sourceIp);
  }
  if (ASAAS_ENV === 'production') {
    return ASAAS_PRODUCTION_WEBHOOK_IPS.has(sourceIp);
  }
  return true;
};

const buildWebhookTokenIsValid = (req) => {
  if (!ASAAS_WEBHOOK_AUTH_TOKEN) {
    return false;
  }
  if (ASAAS_WEBHOOK_AUTH_TOKEN === 'coloque-um-token-forte-do-webhook-aqui') {
    return false;
  }
  if (ASAAS_WEBHOOK_AUTH_TOKEN.length < 24) {
    return false;
  }
  const headerToken = sanitizeText(req.headers['asaas-access-token'] || '', 255, { trim: false });
  if (!headerToken) return false;
  const expected = Buffer.from(ASAAS_WEBHOOK_AUTH_TOKEN);
  const received = Buffer.from(headerToken);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

const fetchAsaasPayment = async (paymentId) => {
  const normalizedPaymentId = sanitizeText(paymentId || '', 80);
  if (!normalizedPaymentId || !ASAAS_API_KEY) return null;
  const response = await fetch(`${ASAAS_BASE_URL}/payments/${encodeURIComponent(normalizedPaymentId)}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': APP_NAME,
      access_token: ASAAS_API_KEY
    }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
};

const fetchAsaasCustomer = async (customerId) => {
  const normalizedCustomerId = sanitizeText(customerId || '', 80);
  if (!normalizedCustomerId || !ASAAS_API_KEY) {
    return null;
  }
  const response = await fetch(`${ASAAS_BASE_URL}/customers/${encodeURIComponent(normalizedCustomerId)}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': APP_NAME,
      access_token: ASAAS_API_KEY
    }
  });
  if (!response.ok) {
    return null;
  }
  return response.json().catch(() => null);
};

const ensureRoleAndOwnershipSetup = async () => {
  if (roleAndOwnershipEnsured) return;
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL');
  await db.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL');
  await db.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL');
  roleAndOwnershipEnsured = true;
};

const ensureProfessorCreditColumns = async () => {
  if (professorCreditColumnsEnsured) return;
  await ensurePlatformCreditTables();
  professorCreditColumnsEnsured = true;
};

const ensureProfessorQuotaColumns = async () => {
  if (professorQuotaColumnsEnsured) return;
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_limit INT');
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT');
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

const ensureBillingTables = async () => {
  if (billingTablesEnsured) return;
  if (!billingTablesEnsurePromise) {
    billingTablesEnsurePromise = (async () => {
  await ensureRoleAndOwnershipSetup();
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
  await ensureAdminSmtpSettingsTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      provider_payment_id TEXT UNIQUE,
      checkout_external_reference TEXT,
      plan_code TEXT NOT NULL,
      payer_name TEXT,
      payer_email TEXT,
      amount NUMERIC(12,2),
      student_limit INT,
      terms_accepted_at TIMESTAMPTZ,
      terms_version TEXT,
      marketing_consent_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'PENDING',
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      activated_at TIMESTAMPTZ,
      deactivated_at TIMESTAMPTZ,
      last_event_type TEXT,
      raw_payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_provider_subscription_idx
      ON billing_subscriptions(provider, provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS asaas_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      asaas_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      processing_status TEXT NOT NULL DEFAULT 'PENDING',
      payload JSONB NOT NULL,
      source_ip TEXT,
      error_message TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query('ALTER TABLE asaas_webhook_events ADD COLUMN IF NOT EXISTS source_ip TEXT');
  await db.query('ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS student_limit INT');
  await db.query('ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
  await db.query('ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS terms_version TEXT');
  await db.query('ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ');
  await ensureBillingAccessSchema();
  await db.query(`
    WITH latest_subscription AS (
      SELECT DISTINCT ON (user_id)
             user_id, id, provider_payment_id, plan_code, last_event_type, raw_payload
        FROM billing_subscriptions
       WHERE user_id IS NOT NULL
         AND status = 'ACTIVE'
       ORDER BY user_id, updated_at DESC, id DESC
    )
    UPDATE users u
       SET billing_access_managed = TRUE,
           subscription_access_expires_at = NOW() + INTERVAL '1 month',
           subscription_plan_code = latest.plan_code,
           subscription_billing_type = COALESCE(NULLIF(UPPER(latest.raw_payload->>'billingType'), ''), u.subscription_billing_type),
           subscription_payment_status = 'ACTIVE',
           subscription_last_event_type = COALESCE(latest.last_event_type, 'PAYMENT_CONFIRMED'),
           subscription_payment_url = COALESCE(NULLIF(latest.raw_payload->>'invoiceUrl', ''), u.subscription_payment_url)
      FROM latest_subscription latest
     WHERE u.id = latest.user_id
       AND u.role = 'professor'
       AND u.billing_access_managed = FALSE
  `);
  await db.query(`
    INSERT INTO billing_payment_periods (
      provider_payment_id, user_id, billing_subscription_id,
      access_started_at, access_expires_at, event_type
    )
    SELECT b.provider_payment_id, b.user_id, b.id, NOW(),
           u.subscription_access_expires_at, 'MIGRATED_ACTIVE_PAYMENT'
      FROM billing_subscriptions b
      JOIN users u ON u.id = b.user_id
     WHERE b.provider_payment_id IS NOT NULL
       AND b.status = 'ACTIVE'
       AND u.billing_access_managed = TRUE
       AND u.subscription_access_expires_at IS NOT NULL
    ON CONFLICT (provider_payment_id) DO NOTHING
  `);
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT');
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ');
  billingTablesEnsured = true;
    })().catch((error) => {
      billingTablesEnsurePromise = null;
      throw error;
    });
  }
  await billingTablesEnsurePromise;
};

const isSmtpConfigUsable = (settings) =>
  Boolean(settings?.host && settings?.user_email && settings?.user_pass);

const loadAdminSmtpSettings = async () => {
  await ensureAdminSmtpSettingsTable();
  const { rows } = await db.query(
    'SELECT host, port, secure, user_email, user_pass, from_email FROM admin_smtp_settings WHERE id = 1'
  );
  return rows[0] || null;
};

const sendProfessorAccessEmail = async ({ fullName, email, temporaryPassword, planCode }) => {
  const smtp = await loadAdminSmtpSettings();
  if (!isSmtpConfigUsable(smtp)) {
    console.error(`SMTP nao configurado. Nao foi possivel enviar o acesso para ${email}.`);
    return false;
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
    family: 4
  });

  const loginUrl = `${PUBLIC_APP_URL || 'http://localhost:4000'}/login.html`;
  const subject = planCode === 'trial-30-dias'
    ? 'Seu acesso de teste na Criatyve foi liberado'
    : 'Seu acesso na Criatyve foi liberado';

  await transporter.sendMail({
    from: smtp.from_email || smtp.user_email,
    to: email,
    subject,
    text:
      `Ola ${fullName},\n\n` +
      `Seu acesso na Criatyve foi criado com sucesso.\n\n` +
      `Login: ${email}\n` +
      `Senha temporaria: ${temporaryPassword}\n\n` +
      `Acesse: ${loginUrl}\n\n` +
      `Assim que entrar, recomendamos trocar a senha.`,
    html:
      `<p>Ola ${fullName},</p>` +
      `<p>Seu acesso na <strong>Criatyve</strong> foi criado com sucesso.</p>` +
      `<p><strong>Login:</strong> ${email}<br><strong>Senha temporaria:</strong> ${temporaryPassword}</p>` +
      `<p><a href="${loginUrl}">Entrar na Criatyve</a></p>` +
      `<p>Assim que entrar, recomendamos trocar a senha.</p>`
  });
  return true;
};

const persistCheckoutLead = async ({
  externalReference,
  planCode,
  payerName,
  payerEmail,
  amount,
  studentLimit,
  termsAccepted,
  marketingConsent,
  checkoutResponse
}) => {
  await ensureBillingTables();
  await db.query(
    `
      INSERT INTO billing_subscriptions (
        provider,
        checkout_external_reference,
        plan_code,
        payer_name,
        payer_email,
        amount,
        student_limit,
        terms_accepted_at,
        terms_version,
        marketing_consent_at,
        status,
        raw_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'CHECKOUT_CREATED', $11, NOW())
    `,
    [
      'asaas',
      sanitizeText(externalReference || '', 160) || null,
      sanitizeText(planCode || '', 40) || 'pro',
      sanitizeText(payerName || '', 160) || null,
      sanitizeEmail(payerEmail || '') || null,
      Number.isFinite(Number(amount)) ? Number(amount) : null,
      Number.isFinite(Number(studentLimit)) ? Math.max(0, Math.round(Number(studentLimit))) : null,
      termsAccepted ? new Date() : null,
      termsAccepted ? LEGAL_TERMS_VERSION : null,
      marketingConsent === false ? null : new Date(),
      checkoutResponse || null
    ]
  );
};

const upsertBillingSubscriptionRecord = async (client, eventType, payment, customerDetails) => {
  const planCode = normalizePlanCodeFromExternalReference(payment?.externalReference || '');
  if (!planCode || !PLANS[planCode]) {
    throw new Error('A cobranca nao pertence a um checkout valido da Criatyve.');
  }
  const plan = getPlanConfig(planCode);
  const providerPaymentId = sanitizeText(payment?.id || '', 80);
  const providerSubscriptionId = sanitizeText(payment?.subscription || '', 80) || null;
  const providerCheckoutSessionId = sanitizeText(payment?.checkoutSession || '', 120) || null;
  const providerCustomerId = sanitizeText(payment?.customer || '', 80) || null;
  const amount = Number.isFinite(Number(payment?.value)) ? Number(payment.value) : plan.price;
  const status = sanitizeText(payment?.status || eventType || 'PENDING', 80) || 'PENDING';
  const checkoutExternalReference = sanitizeText(payment?.externalReference || '', 160) || null;

  const { rows: existingRows } = await client.query(
    `
      SELECT *
        FROM billing_subscriptions
       WHERE provider = 'asaas'
         AND (
           provider_payment_id = $1
           OR checkout_external_reference = $2
           OR provider_subscription_id = $3
           OR COALESCE(raw_payload->>'id', '') = $4
         )
       ORDER BY CASE
         WHEN provider_payment_id = $1 THEN 0
         WHEN checkout_external_reference = $2 THEN 1
         WHEN provider_subscription_id = $3 THEN 2
         ELSE 3
       END
       LIMIT 1
    `,
    [providerPaymentId, checkoutExternalReference, providerSubscriptionId, providerCheckoutSessionId]
  );
  const existingSubscription = existingRows[0] || null;
  const expectedAmount = Number.isFinite(Number(existingSubscription?.amount))
    ? Number(existingSubscription.amount)
    : plan.price;
  if (Math.abs(amount - expectedAmount) > 0.009) {
    throw new Error('O valor confirmado pelo Asaas nao corresponde ao checkout contratado.');
  }
  const expectedStudentLimit = plan.unlimitedStudents
    ? 0
    : Number.isFinite(Number(existingSubscription?.student_limit))
      ? Math.max(plan.studentLimit, Math.round(Number(existingSubscription.student_limit)))
      : plan.studentLimit;
  const payerEmail = sanitizeEmail(
    customerDetails?.email ||
    payment?.customerEmail ||
    existingSubscription?.payer_email ||
    ''
  );
  const payerName = sanitizeText(
    customerDetails?.name ||
    payment?.customerName ||
    existingSubscription?.payer_name ||
    'Professor Criatyve',
    160
  ) || 'Professor Criatyve';

  if (existingSubscription) {
    const { rows } = await client.query(
      `
        UPDATE billing_subscriptions
           SET provider_customer_id = $2,
               provider_subscription_id = $3,
               provider_payment_id = $4,
               checkout_external_reference = $5,
               plan_code = $6,
               payer_name = $7,
               payer_email = $8,
               amount = $9,
               student_limit = CASE WHEN $17::boolean THEN 0 ELSE GREATEST(COALESCE(student_limit, 0), $10) END,
               terms_accepted_at = COALESCE(terms_accepted_at, $14),
               terms_version = COALESCE(terms_version, $15),
               marketing_consent_at = COALESCE(marketing_consent_at, $16),
               status = $11,
               last_event_type = $12,
               raw_payload = $13,
               updated_at = NOW()
         WHERE id = $1
         RETURNING *
      `,
      [
        existingSubscription.id,
        providerCustomerId,
        providerSubscriptionId,
        providerPaymentId,
        checkoutExternalReference,
        planCode,
        payerName,
        payerEmail || null,
        amount,
        expectedStudentLimit,
        status,
        eventType,
        payment,
        existingSubscription.terms_accepted_at || null,
        existingSubscription.terms_version || null,
        existingSubscription.marketing_consent_at || null,
        Boolean(plan.unlimitedStudents)
      ]
    );
    return rows[0];
  }

  const { rows } = await client.query(
    `
      INSERT INTO billing_subscriptions (
        provider,
        provider_customer_id,
        provider_subscription_id,
        provider_payment_id,
        checkout_external_reference,
        plan_code,
        payer_name,
        payer_email,
        amount,
        student_limit,
        terms_accepted_at,
        terms_version,
        marketing_consent_at,
        status,
        last_event_type,
        raw_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, NULL, $11, $12, $13, NOW())
      RETURNING *
    `,
    [
      'asaas',
      providerCustomerId,
      providerSubscriptionId,
      providerPaymentId,
      checkoutExternalReference,
      planCode,
      payerName,
      payerEmail || null,
      amount,
      expectedStudentLimit,
      status,
      eventType,
      payment
    ]
  );
  return rows[0];
};

const activateProfessorFromSubscription = async (client, subscription) => {
  const email = sanitizeEmail(subscription?.payer_email || '');
  if (!email) {
    throw new Error('Nao foi possivel ativar o professor porque o email do pagador nao foi encontrado.');
  }
  const fullName = sanitizeText(subscription?.payer_name || 'Professor Criatyve', 160) || 'Professor Criatyve';
  const plan = getPlanConfig(subscription?.plan_code || 'pro');
  const contractedStudentLimit = plan.unlimitedStudents
    ? 0
    : Math.max(
      Number(plan.studentLimit) || INCLUDED_STUDENT_LIMIT,
      Number.isFinite(Number(subscription?.student_limit)) ? Math.round(Number(subscription.student_limit)) : 0
    );
  let temporaryPassword = null;
  temporaryPassword = buildRandomPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const professorId = crypto.randomUUID();
  const insertResult = await client.query(
    `
      INSERT INTO users (
        id, full_name, email, phone, password_hash, role, class_name, is_active, owner_user_id,
        platform_credits, platform_credits_updated_at, student_limit, storage_limit_bytes,
        terms_accepted_at, terms_version, marketing_consent_at
      )
      VALUES ($1, $2, $3, NULL, $4, 'professor', 'Professor', TRUE, NULL, $5, NOW(), $6, $7, $8, $9, $10)
      ON CONFLICT (email) DO NOTHING
      RETURNING *
    `,
    [
      professorId,
      fullName,
      email,
      passwordHash,
      0,
      contractedStudentLimit,
      plan.storageLimitBytes,
      subscription?.terms_accepted_at || null,
      subscription?.terms_version || null,
      subscription?.marketing_consent_at || null
    ]
  );
  let professor = insertResult.rows[0] || null;

  if (!professor) {
    temporaryPassword = null;
    const { rows: existingUsers } = await client.query(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [email]
    );
    professor = existingUsers[0] || null;
    if (!professor) {
      throw new Error('Nao foi possivel localizar o professor apos confirmar o pagamento.');
    }
    if (!['professor', 'admin'].includes(professor.role)) {
      throw new Error('Ja existe uma conta com este email em outro perfil. Ajuste manualmente antes de ativar a assinatura.');
    }
    await client.query(
      `
        UPDATE users
           SET full_name = COALESCE(NULLIF($1, ''), full_name),
               is_active = TRUE,
               student_limit = CASE WHEN $8::boolean THEN 0 ELSE GREATEST(COALESCE(student_limit, 0), $2) END,
               storage_limit_bytes = GREATEST(COALESCE(storage_limit_bytes, 0), $3),
               terms_accepted_at = COALESCE(terms_accepted_at, $4),
               terms_version = COALESCE(terms_version, $5),
               marketing_consent_at = COALESCE(marketing_consent_at, $6)
         WHERE id = $7
      `,
      [
        fullName,
        contractedStudentLimit,
        plan.storageLimitBytes,
        subscription?.terms_accepted_at || null,
        subscription?.terms_version || null,
        subscription?.marketing_consent_at || null,
        professor.id,
        Boolean(plan.unlimitedStudents)
      ]
    );
    const { rows: refreshedUsers } = await client.query('SELECT * FROM users WHERE id = $1', [professor.id]);
    professor = refreshedUsers[0];
  }

  const includedCreditGrant = Math.max(0, Number(plan.platformCredits || 0) - Number(professor.platform_credits || 0));
  if (professor.role === 'professor' && includedCreditGrant > 0) {
    const providerPaymentId = sanitizeText(subscription?.provider_payment_id || '', 80);
    const grant = await applyCreditChange({
      userId: professor.id,
      amount: includedCreditGrant,
      operationType: 'plan_included_credits',
      idempotencyKey: `plan-credits:${providerPaymentId || subscription.id}`,
      referenceType: 'billing_subscription',
      referenceId: subscription.id,
      metadata: { planCode: subscription.plan_code }
    }, client);
    professor.platform_credits = grant.balance;
  }

  let paymentPeriodCreated = false;
  if (professor.role === 'professor') {
    const providerPaymentId = sanitizeText(subscription?.provider_payment_id || '', 80);
    if (!providerPaymentId) {
      throw new Error('A cobranca confirmada nao possui identificador para liberar o periodo de acesso.');
    }
    const { rows: lockedUsers } = await client.query(
      `SELECT subscription_access_expires_at
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [professor.id]
    );
    const now = new Date();
    const currentExpiration = lockedUsers[0]?.subscription_access_expires_at || null;
    const nextExpiration = calculateNextAccessExpiration(currentExpiration, now);
    const accessStart = currentExpiration && new Date(currentExpiration) > now
      ? new Date(currentExpiration)
      : now;
    const periodResult = await client.query(
      `INSERT INTO billing_payment_periods (
         provider_payment_id, user_id, billing_subscription_id,
         access_started_at, access_expires_at, event_type
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider_payment_id) DO NOTHING
       RETURNING provider_payment_id`,
      [providerPaymentId, professor.id, subscription.id, accessStart, nextExpiration, subscription.last_event_type || 'PAYMENT_CONFIRMED']
    );
    paymentPeriodCreated = periodResult.rows.length > 0;
    const payment = subscription.raw_payload || {};
    const billingType = sanitizeText(payment.billingType || '', 30).toUpperCase() || null;
    const paymentUrl = sanitizeText(payment.invoiceUrl || '', 500) || null;
    await client.query(
      `UPDATE users
          SET is_active = TRUE,
              billing_access_managed = TRUE,
              subscription_access_expires_at = CASE
                WHEN $2::boolean THEN $3
                ELSE subscription_access_expires_at
              END,
              subscription_plan_code = $4,
              subscription_billing_type = COALESCE($5, subscription_billing_type),
              subscription_payment_status = 'ACTIVE',
              subscription_last_event_type = $6,
              subscription_payment_url = COALESCE($7, subscription_payment_url)
        WHERE id = $1`,
      [
        professor.id,
        periodResult.rows.length > 0,
        nextExpiration,
        subscription.plan_code,
        billingType,
        subscription.last_event_type || 'PAYMENT_CONFIRMED',
        paymentUrl
      ]
    );
    professor.subscription_access_expires_at = periodResult.rows.length > 0
      ? nextExpiration
      : currentExpiration;
  }

  await client.query(
    `
      UPDATE billing_subscriptions
         SET user_id = $1,
             activated_at = COALESCE(activated_at, NOW()),
             deactivated_at = NULL,
             status = 'ACTIVE',
             updated_at = NOW()
       WHERE id = $2
    `,
    [professor.id, subscription.id]
  );

  return {
    professor,
    temporaryPassword,
    paymentPeriodCreated
  };
};

const updateProfessorPaymentIssue = async (client, subscription, nextStatus, { revokeAccess = false } = {}) => {
  if (subscription?.user_id) {
    await client.query(
      `UPDATE users
          SET subscription_access_expires_at = CASE WHEN $3 THEN NOW() ELSE subscription_access_expires_at END,
              subscription_payment_status = $2,
              subscription_last_event_type = $2,
              subscription_billing_type = COALESCE($4, subscription_billing_type),
              subscription_payment_url = COALESCE($5, subscription_payment_url)
        WHERE id = $1
          AND role = 'professor'`,
      [
        subscription.user_id,
        nextStatus,
        revokeAccess,
        sanitizeText(subscription.raw_payload?.billingType || '', 30).toUpperCase() || null,
        sanitizeText(subscription.raw_payload?.invoiceUrl || '', 500) || null
      ]
    );
  }
  await client.query(
    `
      UPDATE billing_subscriptions
         SET status = $1,
              deactivated_at = CASE WHEN $3 THEN NOW() ELSE deactivated_at END,
              updated_at = NOW()
       WHERE id = $2
    `,
    [nextStatus, subscription.id, revokeAccess]
  );
};

const shouldActivateAccountForEvent = (eventType, planCode) => {
  return ACTIVE_PAYMENT_EVENTS.has(eventType);
};

const processAsaasWebhookEvent = async (eventPayload, requestMeta = {}) => {
  await ensureBillingTables();
  const eventId = sanitizeText(eventPayload?.id || '', 120);
  const eventType = sanitizeText(eventPayload?.event || '', 80);
  let payment = eventPayload?.payment && typeof eventPayload.payment === 'object' ? { ...eventPayload.payment } : null;
  const sourceIp = sanitizeText(requestMeta.sourceIp || '', 120) || null;

  if (!eventId || !eventType || !payment?.id) {
    return { ignored: true, reason: 'invalid-payload' };
  }
  const topupResult = await processCreditTopupWebhook(eventPayload, fetchAsaasPayment);
  if (topupResult?.handled) {
    return {
      processed: Boolean(topupResult.processed),
      duplicate: Boolean(topupResult.duplicate),
      ignored: Boolean(topupResult.ignored),
      creditTopup: true
    };
  }
  const seatUpgradeResult = await processStudentSeatUpgradeWebhook(eventPayload, fetchAsaasPayment);
  if (seatUpgradeResult?.handled) {
    return {
      processed: Boolean(seatUpgradeResult.processed),
      duplicate: Boolean(seatUpgradeResult.duplicate),
      ignored: Boolean(seatUpgradeResult.ignored),
      studentSeatUpgrade: true
    };
  }
  let eventPlanCode = normalizePlanCodeFromExternalReference(payment.externalReference || '');
  if (!eventPlanCode) {
    const { rows } = await db.query(
      `SELECT checkout_external_reference, plan_code
         FROM billing_subscriptions
        WHERE provider = 'asaas'
          AND (
            provider_payment_id = $1
            OR provider_subscription_id = $2
            OR COALESCE(raw_payload->>'id', '') = $3
          )
        LIMIT 1`,
      [
        sanitizeText(payment.id, 80),
        sanitizeText(payment.subscription || '', 80),
        sanitizeText(payment.checkoutSession || '', 120)
      ]
    );
    const existingSubscription = rows[0];
    if (!existingSubscription) {
      return { ignored: true, reason: 'unrelated-payment' };
    }
    eventPlanCode = existingSubscription.plan_code;
    payment.externalReference = existingSubscription.checkout_external_reference;
  }

  try {
    await db.query(
      `
        INSERT INTO asaas_webhook_events (asaas_event_id, event_type, processing_status, payload, source_ip)
        VALUES ($1, $2, 'PENDING', $3, $4)
      `,
      [eventId, eventType, eventPayload, sourceIp]
    );
  } catch (error) {
    if (error?.code === '23505') {
      const { rows } = await db.query(
        'SELECT processing_status FROM asaas_webhook_events WHERE asaas_event_id = $1',
        [eventId]
      );
      if (rows[0]?.processing_status !== 'ERROR') {
        return { duplicate: true };
      }
      await db.query(
        `UPDATE asaas_webhook_events
            SET processing_status = 'PENDING', payload = $2, source_ip = $3, error_message = NULL, processed_at = NULL
          WHERE asaas_event_id = $1`,
        [eventId, eventPayload, sourceIp]
      );
    } else {
      throw error;
    }
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const isActivationEvent = shouldActivateAccountForEvent(eventType, eventPlanCode);
    let verifiedPayment = payment;
    if (isActivationEvent) {
      verifiedPayment = await fetchAsaasPayment(payment.id);
      if (!verifiedPayment || verifiedPayment.id !== payment.id) {
        throw new Error('Nao foi possivel confirmar a cobranca diretamente no Asaas.');
      }
      if (!sanitizeText(verifiedPayment.externalReference || '', 160) && payment.externalReference) {
        verifiedPayment.externalReference = payment.externalReference;
      }
      const verifiedPlanCode = normalizePlanCodeFromExternalReference(verifiedPayment.externalReference || '');
      if (verifiedPlanCode !== eventPlanCode) {
        throw new Error('A referencia da cobranca confirmada pelo Asaas e invalida.');
      }
      if (ACTIVE_PAYMENT_EVENTS.has(eventType) && !['CONFIRMED', 'RECEIVED'].includes(String(verifiedPayment.status || '').toUpperCase())) {
        throw new Error('A cobranca ainda nao esta confirmada no Asaas.');
      }
    }
    const customerDetails = await fetchAsaasCustomer(verifiedPayment.customer);
    const subscription = await upsertBillingSubscriptionRecord(client, eventType, verifiedPayment, customerDetails);
    let activationResult = null;

    if (shouldActivateAccountForEvent(eventType, subscription.plan_code)) {
      activationResult = await activateProfessorFromSubscription(client, subscription);
    } else if (ACCESS_REVOCATION_EVENTS.has(eventType)) {
      await updateProfessorPaymentIssue(client, subscription, eventType, { revokeAccess: true });
    } else if (PAYMENT_FAILURE_EVENTS.has(eventType) || PAYMENT_PENDING_EVENTS.has(eventType) || eventType === 'PAYMENT_DELETED') {
      await updateProfessorPaymentIssue(client, subscription, eventType);
    }

    await client.query(
      `
        UPDATE asaas_webhook_events
           SET processing_status = 'DONE',
               processed_at = NOW()
         WHERE asaas_event_id = $1
      `,
      [eventId]
    );

    await client.query('COMMIT');

    if (activationResult?.professor && activationResult?.temporaryPassword) {
      await sendProfessorAccessEmail({
        fullName: activationResult.professor.full_name,
        email: activationResult.professor.email,
        temporaryPassword: activationResult.temporaryPassword,
        planCode: subscription.plan_code
      }).catch((error) => {
        console.error('Erro ao enviar email de acesso do professor:', error.message);
      });
    }

    if (activationResult?.paymentPeriodCreated) {
      try {
        const metaResult = await sendMetaPurchaseEvent({
          payment: verifiedPayment,
          subscription: {
            ...subscription,
            plan_label: getPlanConfig(subscription.plan_code).label
          },
          customer: customerDetails || {},
          eventSourceUrl: PUBLIC_APP_URL
        });
        if (metaResult?.sent) {
          console.info(`Meta Purchase enviado para o pagamento ${subscription.provider_payment_id}.`);
        }
      } catch (metaError) {
        // A confirmacao do Asaas nao pode falhar por indisponibilidade temporaria da Meta.
        console.error(`Erro ao enviar Purchase para a Meta: ${metaError.message}`);
      }
    }

    return {
      processed: true,
      eventType,
      planCode: subscription.plan_code,
      userCreated: Boolean(activationResult?.professor)
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await db.query(
      `
        UPDATE asaas_webhook_events
           SET processing_status = 'ERROR',
               error_message = $2,
               processed_at = NOW()
         WHERE asaas_event_id = $1
      `,
      [eventId, sanitizeText(error.message || 'Erro ao processar webhook.', 1000)]
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const createCheckoutSession = async (req, res, { redirect = false } = {}) => {
  if (!ASAAS_API_KEY) {
    const message = 'O checkout ainda nao foi configurado. Preencha a chave ASAAS_API_KEY no backend/.env.';
    return redirect ? res.status(503).send(message) : res.status(503).json({ message });
  }

  const source = req.method === 'GET' ? req.query : req.body;
  const plan = getPlanConfig(sanitizeText(source?.plan || 'pro', 40));
  const name = sanitizeText(source?.name || '', 120);
  const email = sanitizeEmail(source?.email || '');
  const phone = sanitizePhone(source?.phone || '');
  const cpfCnpj = sanitizeCpfCnpj(source?.cpfCnpj || source?.document || '');
  const postalCode = sanitizeText(source?.postalCode || source?.zipCode || '', 16).replace(/\D/g, '').slice(0, 8);
  const address = sanitizeText(source?.address || '', 120);
  const addressNumber = sanitizeText(source?.addressNumber || source?.number || '', 20);
  const province = sanitizeText(source?.province || source?.neighborhood || '', 80);
  const complement = sanitizeText(source?.complement || source?.addressComplement || '', 80);
  if (!hasRequiredLegalConsent(source)) {
    const message = 'Para continuar, aceite os Termos de Uso e Privacidade.';
    return redirect ? res.status(400).send(message) : res.status(400).json({ message });
  }
  if (!name || !email) {
    const message = 'Informe nome e email antes de iniciar o checkout. O email sera usado para enviar login e senha.';
    return redirect ? res.status(400).send(message) : res.status(400).json({ message });
  }
  if (!cpfCnpj || !postalCode || !address || !addressNumber || !province) {
    const message = 'Informe CPF/CNPJ, CEP, endereco, numero e bairro antes de iniciar o checkout.';
    return redirect ? res.status(400).send(message) : res.status(400).json({ message });
  }
  const existingStudentLimit = await findExistingProfessorBillingLimit(email);
  const purchase = buildPlanPurchase({
    plan,
    requestedStudentLimit: source?.studentCount ?? source?.students ?? source?.studentLimit,
    existingStudentLimit
  });

  const publicBaseUrl = buildPublicBaseUrl(req);
  const externalReference = `checkout:${plan.id}:${crypto.randomUUID()}`;
  const itemDescription = purchase.unlimitedStudents
    ? `${plan.description}. Sem cobranca por aluno ou compra de vagas.`
    : purchase.extraStudents > 0
    ? `${plan.description}. Inclui ${purchase.studentLimit} alunos no portal (${purchase.extraStudents} extras).`
    : plan.description;
  const paymentMode = resolveCheckoutPaymentMode(plan, source?.billingType || source?.paymentMethod);
  const payload = {
    billingTypes: paymentMode.billingTypes,
    chargeTypes: paymentMode.chargeTypes,
    minutesToExpire: 60,
    externalReference,
    items: [
      {
        externalReference: plan.id,
        name: plan.label.slice(0, 30),
        description: itemDescription.slice(0, 150),
        quantity: 1,
        value: purchase.amount
      }
    ]
  };

  if (paymentMode.subscription) {
    payload.subscription = paymentMode.subscription;
  }

  payload.customerData = {
    name,
    email,
    cpfCnpj,
    postalCode,
    address,
    addressNumber,
    province
  };
  if (phone) {
    payload.customerData.phone = phone;
  }
  if (complement) {
    payload.customerData.complement = complement;
  }

  if (isPublicCallbackUrl(publicBaseUrl)) {
    const callbackBase = `${publicBaseUrl}/checkout-status.html`;
    payload.callback = {
      successUrl: `${callbackBase}?status=success&plan=${encodeURIComponent(plan.id)}&students=${encodeURIComponent(String(purchase.studentLimit))}`,
      cancelUrl: `${callbackBase}?status=cancel&plan=${encodeURIComponent(plan.id)}&students=${encodeURIComponent(String(purchase.studentLimit))}`,
      expiredUrl: `${callbackBase}?status=expired&plan=${encodeURIComponent(plan.id)}&students=${encodeURIComponent(String(purchase.studentLimit))}`
    };
  }

  if (name || email) {
    payload.description = `${plan.label}${name ? ` - ${name}` : ''}${email ? ` (${email})` : ''}`.slice(0, 200);
  }

  try {
    const response = await fetch(`${ASAAS_BASE_URL}/checkouts`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': APP_NAME,
        access_token: ASAAS_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const firstError = Array.isArray(responseBody?.errors) ? responseBody.errors[0] : null;
      const errorPayload = {
        message: firstError?.description || 'Nao foi possivel iniciar o checkout no Asaas.',
        provider: 'asaas'
      };
      return redirect ? res.status(response.status).send(errorPayload.message) : res.status(response.status).json(errorPayload);
    }

    const checkoutUrl = buildCheckoutUrl(responseBody);
    if (!checkoutUrl) {
      const errorPayload = {
        message: 'O Asaas respondeu sem link de checkout utilizavel.',
        provider: 'asaas'
      };
      return redirect ? res.status(502).send(errorPayload.message) : res.status(502).json(errorPayload);
    }

    await persistCheckoutLead({
      externalReference,
      planCode: plan.id,
      payerName: name,
      payerEmail: email,
      amount: purchase.amount,
      studentLimit: purchase.studentLimit,
      unlimitedStudents: Boolean(purchase.unlimitedStudents),
      termsAccepted: true,
      marketingConsent: source?.marketingConsent !== false,
      checkoutResponse: responseBody
    });

    if (redirect) {
      return res.redirect(303, checkoutUrl);
    }

    return res.json({
      provider: 'asaas',
      plan: plan.id,
      trialDays: plan.trialDays,
      amount: purchase.amount,
      studentLimit: purchase.studentLimit,
      extraStudents: purchase.extraStudents,
      extraStudentPrice: purchase.extraStudentPrice,
      billingTypes: paymentMode.billingTypes,
      chargeTypes: paymentMode.chargeTypes,
      paymentMode: paymentMode.paymentMode,
      checkoutId: responseBody.id || null,
      checkoutUrl
    });
  } catch (error) {
    console.error('Erro ao criar checkout Asaas', error);
    const errorPayload = {
      message: 'Falha ao conectar com o gateway de pagamento.',
      provider: 'asaas'
    };
    return redirect ? res.status(502).send(errorPayload.message) : res.status(502).json(errorPayload);
  }
};

const normalizeAsaasPaymentUrl = (value) => {
  try {
    const parsed = new URL(String(value || ''));
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (hostname === 'asaas.com' || hostname.endsWith('.asaas.com'))
      ? parsed.toString()
      : null;
  } catch (error) {
    return null;
  }
};

const describeBillingAccess = (access, user, subscription) => {
  const automaticRenewal = user.subscription_billing_type === 'CREDIT_CARD'
    && Boolean(subscription?.provider_subscription_id);
  const descriptions = {
    PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'O cartão não autorizou a cobrança. Isso pode acontecer por limite insuficiente, dados desatualizados ou bloqueio do banco.',
    PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'O pagamento no cartão não foi aprovado pela análise de segurança. Tente novamente ou escolha Pix.',
    PAYMENT_OVERDUE: 'A mensalidade está vencida. Regularize a cobrança para evitar ou remover o bloqueio do portal.'
  };
  let message = '';
  if (access.state === 'expired') {
    message = 'Sua assinatura venceu. Faça o pagamento do próximo mês para continuar usando o portal.';
  } else if (access.state === 'payment_failed') {
    message = descriptions[access.lastEvent] || 'Não foi possível confirmar a renovação. Revise o pagamento ou escolha outra forma.';
  } else if (access.state === 'payment_pending') {
    message = 'A renovação está sendo processada. O acesso atual continua disponível até a data informada.';
  } else if (access.state === 'due_soon') {
    message = automaticRenewal
      ? `Sua assinatura vence em ${access.daysRemaining} dia(s). A cobrança no cartão será tentada automaticamente.`
      : `Sua assinatura vence em ${access.daysRemaining} dia(s). Gere o pagamento do próximo mês para não perder o acesso.`;
  }
  return { automaticRenewal, message };
};

const loadProfessorSubscription = async (userId) => {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.student_limit,
            u.billing_access_managed, u.subscription_access_expires_at,
            u.subscription_plan_code, u.subscription_billing_type,
            u.subscription_payment_status, u.subscription_last_event_type,
            u.subscription_payment_url,
            b.id AS billing_subscription_id, b.provider_subscription_id,
            b.amount, b.plan_code, b.status AS billing_status
       FROM users u
       LEFT JOIN LATERAL (
         SELECT id, provider_subscription_id, amount, plan_code, status
           FROM billing_subscriptions
          WHERE user_id = u.id OR LOWER(payer_email) = LOWER(u.email)
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
       ) b ON TRUE
      WHERE u.id = $1 AND u.role = 'professor'`,
    [userId]
  );
  return rows[0] || null;
};

router.get('/subscription/status', requireAuth, async (req, res) => {
  await ensureBillingTables();
  if (req.user.role !== 'professor') {
    return res.json({ managed: false, state: 'not_applicable', blocked: false });
  }
  const user = await loadProfessorSubscription(req.user.id);
  if (!user) return res.status(404).json({ message: 'Conta de professor não encontrada.' });
  const access = getBillingAccessState(user);
  const details = describeBillingAccess(access, user, user);
  return res.json({
    managed: access.managed,
    state: access.state,
    blocked: access.blocked,
    daysRemaining: access.daysRemaining,
    accessExpiresAt: access.expiration?.toISOString() || null,
    billingType: user.subscription_billing_type || null,
    paymentStatus: user.subscription_payment_status || null,
    lastEventType: user.subscription_last_event_type || null,
    paymentUrl: normalizeAsaasPaymentUrl(user.subscription_payment_url),
    automaticRenewal: details.automaticRenewal,
    message: details.message
  });
});

router.post('/renewal-checkout', requireAuth, checkoutRateLimiter, async (req, res) => {
  await ensureBillingTables();
  if (!ASAAS_API_KEY) return res.status(503).json({ message: 'O checkout ainda não foi configurado.' });
  if (req.user.role !== 'professor') return res.status(403).json({ message: 'Renovação disponível apenas para professores.' });

  const user = await loadProfessorSubscription(req.user.id);
  if (!user?.billing_access_managed) {
    return res.status(409).json({ message: 'Esta conta não possui uma assinatura gerenciada pelo checkout.' });
  }
  const billingType = sanitizeText(req.body?.billingType || 'PIX', 30).toUpperCase();
  if (!['PIX', 'CREDIT_CARD'].includes(billingType)) {
    return res.status(400).json({ message: 'Escolha Pix ou cartão de crédito.' });
  }
  const access = getBillingAccessState(user);
  const existingPaymentUrl = normalizeAsaasPaymentUrl(user.subscription_payment_url);
  if (billingType === 'CREDIT_CARD' && existingPaymentUrl && ['payment_failed', 'expired'].includes(access.state)) {
    return res.json({ checkoutUrl: existingPaymentUrl, paymentMode: 'existing_card_invoice' });
  }
  if (billingType === 'CREDIT_CARD' && user.provider_subscription_id && !['payment_failed', 'expired'].includes(access.state)) {
    return res.status(409).json({
      message: 'A renovação deste cartão já é automática. Aguarde a tentativa de cobrança na data de vencimento.'
    });
  }

  if (user.provider_subscription_id && ['payment_failed', 'expired'].includes(access.state)) {
    const cancelResponse = await fetch(`${ASAAS_BASE_URL}/subscriptions/${encodeURIComponent(user.provider_subscription_id)}`, {
      method: 'DELETE',
      headers: { accept: 'application/json', 'user-agent': APP_NAME, access_token: ASAAS_API_KEY }
    });
    if (!cancelResponse.ok && cancelResponse.status !== 404) {
      return res.status(502).json({
        message: billingType === 'PIX'
          ? 'Não foi possível interromper a cobrança anterior no cartão. Aguarde e tente novamente.'
          : 'Não foi possível substituir a assinatura anterior no cartão. Tente por Pix.'
      });
    }
  }

  const plan = getPlanConfig(user.plan_code || user.subscription_plan_code || 'pro');
  const purchase = buildPlanPurchase({ plan, requestedStudentLimit: user.student_limit });
  if (Number.isFinite(Number(user.amount)) && Number(user.amount) > 0) purchase.amount = Number(user.amount);
  const externalReference = `checkout:${plan.id}:${crypto.randomUUID()}`;
  const paymentMode = resolveCheckoutPaymentMode(plan, billingType);
  const publicBaseUrl = buildPublicBaseUrl(req);
  const callbackBase = `${publicBaseUrl}/checkout-status.html`;
  const callbackQuery = `plan=${encodeURIComponent(plan.id)}&renewal=1`;
  const payload = {
    billingTypes: paymentMode.billingTypes,
    chargeTypes: paymentMode.chargeTypes,
    minutesToExpire: 60,
    externalReference,
    items: [{
      externalReference: plan.id,
      name: `${plan.label} - renovação`.slice(0, 30),
      description: (purchase.unlimitedStudents
        ? 'Renovação mensal com alunos ilimitados no portal.'
        : `Renovação mensal com acesso para ${purchase.studentLimit} alunos.`).slice(0, 150),
      quantity: 1,
      value: purchase.amount
    }],
    customerData: { name: user.full_name, email: user.email },
    description: `${plan.label} - renovação (${user.email})`.slice(0, 200)
  };
  if (paymentMode.subscription) payload.subscription = paymentMode.subscription;
  if (isPublicCallbackUrl(publicBaseUrl)) {
    payload.callback = {
      successUrl: `${callbackBase}?status=success&${callbackQuery}`,
      cancelUrl: `${callbackBase}?status=cancel&${callbackQuery}`,
      expiredUrl: `${callbackBase}?status=expired&${callbackQuery}`
    };
  }

  try {
    const response = await fetch(`${ASAAS_BASE_URL}/checkouts`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': APP_NAME,
        access_token: ASAAS_API_KEY
      },
      body: JSON.stringify(payload)
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const firstError = Array.isArray(responseBody?.errors) ? responseBody.errors[0] : null;
      return res.status(response.status).json({ message: firstError?.description || 'Não foi possível iniciar a renovação.' });
    }
    const checkoutUrl = buildCheckoutUrl(responseBody);
    if (!checkoutUrl) return res.status(502).json({ message: 'O Asaas não retornou o link de pagamento.' });
    await persistCheckoutLead({
      externalReference,
      planCode: plan.id,
      payerName: user.full_name,
      payerEmail: user.email,
      amount: purchase.amount,
      studentLimit: purchase.studentLimit,
      termsAccepted: true,
      marketingConsent: false,
      checkoutResponse: responseBody
    });
    return res.json({ checkoutUrl, paymentMode: paymentMode.paymentMode });
  } catch (error) {
    console.error('Erro ao criar renovação Asaas', error);
    return res.status(502).json({ message: 'Falha ao conectar com o gateway de pagamento.' });
  }
});

router.get('/checkout-session', checkoutRateLimiter, (req, res) => createCheckoutSession(req, res, { redirect: true }));
router.post('/checkout-session', checkoutRateLimiter, (req, res) => createCheckoutSession(req, res));

router.post('/webhook/asaas', async (req, res) => {
  if (!buildWebhookTokenIsValid(req)) {
    return res.status(401).json({ received: false, message: 'Token do webhook invalido.' });
  }
  if (!isWebhookSourceIpAllowed(req)) {
    return res.status(403).json({ received: false, message: 'Origem do webhook nao autorizada.' });
  }

  try {
    const result = await processAsaasWebhookEvent(req.body || {}, {
      sourceIp: extractWebhookSourceIp(req)
    });
    return res.status(200).json({
      received: true,
      duplicate: Boolean(result?.duplicate),
      ignored: Boolean(result?.ignored)
    });
  } catch (error) {
    console.error('Erro ao processar webhook do Asaas:', error);
    return res.status(500).json({ received: false, processingError: true });
  }
});

module.exports = router;
