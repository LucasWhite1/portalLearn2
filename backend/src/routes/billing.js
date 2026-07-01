const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db');
const { decryptStoredSecret } = require('../aiConfigCrypto');
const {
  sanitizeText,
  sanitizeEmail,
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
const APP_NAME = sanitizeText(process.env.ASAAS_APP_NAME || 'Criatyve/1.0', 120) || 'Criatyve/1.0';
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

const ACTIVE_PAYMENT_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const TRIAL_ACTIVATION_EVENTS = new Set(['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const DEACTIVATION_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
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
    studentLimit: 15,
    storageLimitBytes: 1024 * 1024 * 1024,
    aiCredits: 100
  },
  'trial-30-dias': {
    id: 'trial-30-dias',
    label: 'Criatyve Trial 30 dias',
    price: Number.isFinite(PRO_MONTHLY_PRICE) ? PRO_MONTHLY_PRICE : 97.90,
    description: `Teste de ${TRIAL_DAYS} dias do plano Criatyve Pro`,
    nextDueDate: () => formatDateOnly(addDaysToDate(new Date(), TRIAL_DAYS)),
    trialDays: TRIAL_DAYS,
    studentLimit: 15,
    storageLimitBytes: 1024 * 1024 * 1024,
    aiCredits: 100
  }
};

const getPlanConfig = (planKey = '') => PLANS[planKey] || PLANS.pro;

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
  const match = normalized.match(/^checkout:(pro|trial-30-dias):/i);
  return match ? match[1].toLowerCase() : '';
};

const buildRandomPassword = () => crypto.randomBytes(9).toString('base64url') + 'Aa1!';
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
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_credits NUMERIC(12,2) NOT NULL DEFAULT 0');
  await db.query('ALTER TABLE users ALTER COLUMN ai_credits TYPE NUMERIC(12,2) USING COALESCE(ai_credits, 0)::numeric(12,2)');
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_credits_updated_at TIMESTAMPTZ DEFAULT NOW()');
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
      error_message TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
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

const persistCheckoutLead = async ({ externalReference, planCode, payerName, payerEmail, amount, checkoutResponse }) => {
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
        status,
        raw_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'CHECKOUT_CREATED', $7, NOW())
    `,
    [
      'asaas',
      sanitizeText(externalReference || '', 160) || null,
      sanitizeText(planCode || '', 40) || 'pro',
      sanitizeText(payerName || '', 160) || null,
      sanitizeEmail(payerEmail || '') || null,
      Number.isFinite(Number(amount)) ? Number(amount) : null,
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
  const providerCustomerId = sanitizeText(payment?.customer || '', 80) || null;
  const amount = Number.isFinite(Number(payment?.value)) ? Number(payment.value) : plan.price;
  if (Math.abs(amount - plan.price) > 0.009) {
    throw new Error('O valor confirmado pelo Asaas nao corresponde ao plano contratado.');
  }
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
         )
       ORDER BY CASE WHEN provider_payment_id = $1 THEN 0 ELSE 1 END
       LIMIT 1
    `,
    [providerPaymentId, checkoutExternalReference]
  );
  const existingSubscription = existingRows[0] || null;
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
               status = $10,
               last_event_type = $11,
               raw_payload = $12,
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
        status,
        eventType,
        payment
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
        status,
        last_event_type,
        raw_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
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

  const { rows: existingUsers } = await client.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  let professor = existingUsers[0] || null;
  let temporaryPassword = null;

  if (!professor) {
    temporaryPassword = buildRandomPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const professorId = crypto.randomUUID();
    await client.query(
      `
        INSERT INTO users (
          id, full_name, email, phone, password_hash, role, class_name, is_active, owner_user_id,
          ai_credits, ai_credits_updated_at, student_limit, storage_limit_bytes
        )
        VALUES ($1, $2, $3, NULL, $4, 'professor', 'Professor', TRUE, NULL, $5, NOW(), $6, $7)
      `,
      [
        professorId,
        fullName,
        email,
        passwordHash,
        plan.aiCredits,
        plan.studentLimit,
        plan.storageLimitBytes
      ]
    );
    const { rows: createdUsers } = await client.query('SELECT * FROM users WHERE id = $1', [professorId]);
    professor = createdUsers[0];
  } else {
    if (!['professor', 'admin'].includes(professor.role)) {
      throw new Error('Ja existe uma conta com este email em outro perfil. Ajuste manualmente antes de ativar a assinatura.');
    }
    await client.query(
      `
        UPDATE users
           SET full_name = COALESCE(NULLIF($1, ''), full_name),
               is_active = TRUE,
               ai_credits = COALESCE(ai_credits, 0),
               ai_credits_updated_at = NOW(),
               student_limit = COALESCE($2, student_limit),
               storage_limit_bytes = COALESCE($3, storage_limit_bytes)
         WHERE id = $4
      `,
      [fullName, plan.studentLimit, plan.storageLimitBytes, professor.id]
    );
    const { rows: refreshedUsers } = await client.query('SELECT * FROM users WHERE id = $1', [professor.id]);
    professor = refreshedUsers[0];
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
    temporaryPassword
  };
};

const deactivateProfessorFromSubscription = async (client, subscription, nextStatus) => {
  if (subscription?.user_id) {
    await client.query('UPDATE users SET is_active = FALSE WHERE id = $1', [subscription.user_id]);
  }
  await client.query(
    `
      UPDATE billing_subscriptions
         SET status = $1,
             deactivated_at = NOW(),
             updated_at = NOW()
       WHERE id = $2
    `,
    [nextStatus, subscription.id]
  );
};

const shouldActivateAccountForEvent = (eventType, planCode) => {
  if (planCode === 'trial-30-dias') {
    return TRIAL_ACTIVATION_EVENTS.has(eventType);
  }
  return ACTIVE_PAYMENT_EVENTS.has(eventType);
};

const processAsaasWebhookEvent = async (eventPayload) => {
  await ensureBillingTables();
  const eventId = sanitizeText(eventPayload?.id || '', 120);
  const eventType = sanitizeText(eventPayload?.event || '', 80);
  let payment = eventPayload?.payment && typeof eventPayload.payment === 'object' ? { ...eventPayload.payment } : null;

  if (!eventId || !eventType || !payment?.id) {
    return { ignored: true, reason: 'invalid-payload' };
  }
  let eventPlanCode = normalizePlanCodeFromExternalReference(payment.externalReference || '');
  if (!eventPlanCode) {
    const { rows } = await db.query(
      `SELECT checkout_external_reference, plan_code
         FROM billing_subscriptions
        WHERE provider = 'asaas' AND provider_payment_id = $1
        LIMIT 1`,
      [sanitizeText(payment.id, 80)]
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
        INSERT INTO asaas_webhook_events (asaas_event_id, event_type, processing_status, payload)
        VALUES ($1, $2, 'PENDING', $3)
      `,
      [eventId, eventType, eventPayload]
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
            SET processing_status = 'PENDING', payload = $2, error_message = NULL, processed_at = NULL
          WHERE asaas_event_id = $1`,
        [eventId, eventPayload]
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
    } else if (DEACTIVATION_EVENTS.has(eventType)) {
      await deactivateProfessorFromSubscription(client, subscription, eventType);
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
  if (!name || !email) {
    const message = 'Informe nome e email antes de iniciar o checkout. O email sera usado para enviar login e senha.';
    return redirect ? res.status(400).send(message) : res.status(400).json({ message });
  }

  const publicBaseUrl = buildPublicBaseUrl(req);
  const externalReference = `checkout:${plan.id}:${crypto.randomUUID()}`;
  const payload = {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire: 60,
    externalReference,
    items: [
      {
        externalReference: plan.id,
        name: plan.label.slice(0, 30),
        description: plan.description.slice(0, 150),
        quantity: 1,
        value: plan.price
      }
    ],
    subscription: {
      cycle: 'MONTHLY',
      nextDueDate: plan.nextDueDate()
    }
  };

  if (isPublicCallbackUrl(publicBaseUrl)) {
    const callbackBase = `${publicBaseUrl}/checkout-status.html`;
    payload.callback = {
      successUrl: `${callbackBase}?status=success&plan=${encodeURIComponent(plan.id)}`,
      cancelUrl: `${callbackBase}?status=cancel&plan=${encodeURIComponent(plan.id)}`,
      expiredUrl: `${callbackBase}?status=expired&plan=${encodeURIComponent(plan.id)}`
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
      amount: plan.price,
      checkoutResponse: responseBody
    });

    if (redirect) {
      return res.redirect(303, checkoutUrl);
    }

    return res.json({
      provider: 'asaas',
      plan: plan.id,
      trialDays: plan.trialDays,
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

router.get('/checkout-session', checkoutRateLimiter, (req, res) => createCheckoutSession(req, res, { redirect: true }));
router.post('/checkout-session', checkoutRateLimiter, (req, res) => createCheckoutSession(req, res));

router.post('/webhook/asaas', async (req, res) => {
  if (!buildWebhookTokenIsValid(req)) {
    return res.status(401).json({ received: false, message: 'Token do webhook invalido.' });
  }

  try {
    const result = await processAsaasWebhookEvent(req.body || {});
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
