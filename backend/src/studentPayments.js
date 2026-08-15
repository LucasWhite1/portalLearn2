const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { encryptSecret, decryptStoredSecret } = require('./aiConfigCrypto');
const { sanitizeText, isUuid } = require('./security');
const { ensureStudentProfessorLinksSchema } = require('./studentProfessorLinks');

const adminRouter = express.Router();
const studentRouter = express.Router();
const webhookRouter = express.Router();
const ASAAS_BASE_URL = String(process.env.ASAAS_BASE_URL || (
  String(process.env.ASAAS_ENV || 'sandbox').toLowerCase() === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3'
)).replace(/\/+$/, '');
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
const APP_NAME = sanitizeText(process.env.ASAAS_APP_NAME || 'Criatyve/1.0', 120) || 'Criatyve/1.0';
const ASAAS_ROOT_API_KEY = sanitizeText(process.env.ASAAS_API_KEY || '', 500, { trim: true });
const PAYMENT_TYPES = new Set(['MANUAL', 'PIX', 'BOLETO', 'CREDIT_CARD']);
const PLAN_STATUSES = new Set(['ACTIVE', 'PAUSED']);
const SUBACCOUNT_CONSENT_VERSION = '2026-08-03';
let schemaReady = false;
let schemaPromise = null;

const dateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const addMonths = (value, months) => {
  const date = new Date(`${dateOnly(value)}T12:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
};

const dueDateForMonth = (dueDay, reference = new Date()) => {
  const day = Math.min(Math.max(Number.parseInt(dueDay, 10) || 1, 1), 28);
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), day, 12));
};

const hashToken = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const digitsOnly = (value, maxLength = 32) => sanitizeText(value || '', maxLength).replace(/\D/g, '').slice(0, maxLength);
const COMPANY_TYPES = new Set(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']);
const SUBACCOUNT_WEBHOOK_EVENTS = [
  'PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED', 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING', 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED', 'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING', 'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
  'ACCOUNT_STATUS_DOCUMENT_APPROVED', 'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_DOCUMENT_PENDING', 'ACCOUNT_STATUS_DOCUMENT_REJECTED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED', 'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING', 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED'
];

const buildSubaccountWebhook = (professorId, email, authToken) => ({
  name: 'Criatyve - financeiro do professor',
  url: `${PUBLIC_APP_URL}/api/billing/webhook/student-payments/${professorId}`,
  email,
  enabled: true,
  interrupted: false,
  apiVersion: 3,
  authToken,
  sendType: 'SEQUENTIALLY',
  events: SUBACCOUNT_WEBHOOK_EVENTS
});

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const ensureStudentPaymentSchema = async () => {
  await ensureStudentProfessorLinksSchema();
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS professor_payment_settings (
        professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        provider_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK (provider_mode IN ('MANUAL', 'ASAAS')),
        provider_api_key_encrypted TEXT,
        provider_account_id TEXT,
        provider_wallet_id TEXT,
        provider_account_name TEXT,
        provider_status TEXT NOT NULL DEFAULT 'DISCONNECTED',
        webhook_token_hash TEXT,
        onboarding_data JSONB,
        onboarding_checked_at TIMESTAMPTZ,
        subaccount_consent_version TEXT,
        subaccount_consented_at TIMESTAMPTZ,
        connected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS student_payment_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 28),
        billing_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (billing_type IN ('MANUAL','PIX','BOLETO','CREDIT_CARD')),
        grace_days INT NOT NULL DEFAULT 5 CHECK (grace_days BETWEEN 0 AND 60),
        auto_block BOOLEAN NOT NULL DEFAULT TRUE,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
        description TEXT,
        payment_instructions TEXT,
        provider_customer_id TEXT,
        provider_subscription_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (professor_user_id, student_user_id)
      );

      CREATE TABLE IF NOT EXISTS student_payment_periods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES student_payment_plans(id) ON DELETE CASCADE,
        due_date DATE NOT NULL,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','OVERDUE','FAILED','CANCELED','REFUNDED','CHARGEBACK')),
        billing_type TEXT NOT NULL CHECK (billing_type IN ('MANUAL','PIX','BOLETO','CREDIT_CARD')),
        provider_payment_id TEXT UNIQUE,
        payment_url TEXT,
        failure_reason TEXT,
        paid_at TIMESTAMPTZ,
        raw_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (plan_id, due_date)
      );

      CREATE INDEX IF NOT EXISTS idx_student_payment_plans_professor
        ON student_payment_plans(professor_user_id, status, due_day);
      CREATE INDEX IF NOT EXISTS idx_student_payment_periods_plan
        ON student_payment_periods(plan_id, due_date DESC);

      ALTER TABLE professor_payment_settings
        ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
        ADD COLUMN IF NOT EXISTS onboarding_data JSONB,
        ADD COLUMN IF NOT EXISTS onboarding_checked_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS subaccount_consent_version TEXT,
        ADD COLUMN IF NOT EXISTS subaccount_consented_at TIMESTAMPTZ;
    `).then(() => { schemaReady = true; }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
};

const getPeriodState = (period, plan, now = new Date()) => {
  if (!plan || plan.status !== 'ACTIVE') return 'paused';
  if (!period) return 'pending';
  const stored = String(period.status || 'PENDING').toUpperCase();
  if (stored === 'PAID') return 'paid';
  if (stored === 'REFUNDED') return 'refunded';
  if (stored === 'CHARGEBACK') return 'chargeback';
  const due = new Date(`${dateOnly(period.due_date)}T23:59:59.999Z`);
  const graceEnd = new Date(due);
  graceEnd.setUTCDate(graceEnd.getUTCDate() + Number(plan.grace_days || 0));
  if (now > graceEnd) return 'blocked';
  if (stored === 'FAILED') return 'failed';
  if (stored === 'CANCELED') return 'canceled';
  if (now > due) return 'overdue';
  const warningStart = new Date(due);
  warningStart.setUTCDate(warningStart.getUTCDate() - 5);
  return now >= warningStart ? 'due_soon' : 'pending';
};

const shouldBlockStudentPayment = (period, plan, now = new Date()) => (
  Boolean(plan?.auto_block) && ['blocked', 'chargeback', 'refunded'].includes(getPeriodState(period, plan, now))
);

const asaasRequest = async (apiKey, path, options = {}) => {
  const response = await fetch(`${ASAAS_BASE_URL}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': APP_NAME,
      access_token: apiKey,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.map((item) => item.description).filter(Boolean).join(' ') || payload?.message;
    const error = new Error(detail || 'O Asaas recusou a operação.');
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return payload;
};

const getSettings = async (professorId) => {
  await ensureStudentPaymentSchema();
  const { rows } = await db.query(
    `SELECT * FROM professor_payment_settings WHERE professor_user_id = $1`,
    [professorId]
  );
  return rows[0] || null;
};

const getProfessorApiKey = async (professorId) => {
  const settings = await getSettings(professorId);
  if (settings?.provider_mode !== 'ASAAS' || !settings.provider_api_key_encrypted) {
    const error = new Error('Conecte a conta Asaas do professor antes de gerar cobranças automáticas.');
    error.statusCode = 409;
    throw error;
  }
  if (!['CONNECTED', 'APPROVED'].includes(settings.provider_status)) {
    const error = new Error('Conclua e aguarde a aprovação cadastral da subconta Asaas antes de gerar cobranças automáticas.');
    error.statusCode = 409;
    throw error;
  }
  return { settings, apiKey: decryptStoredSecret(settings.provider_api_key_encrypted) };
};

const ensureCurrentPeriod = async (plan, now = new Date()) => {
  if (!plan || plan.status !== 'ACTIVE') return null;
  let calculatedDueDate = dueDateForMonth(plan.due_day, now);
  const createdAt = plan.created_at ? new Date(plan.created_at) : null;
  if (createdAt && Number.isFinite(createdAt.getTime()) && calculatedDueDate < createdAt) {
    calculatedDueDate = addMonths(calculatedDueDate, 1);
  }
  const dueDate = dateOnly(calculatedDueDate);
  const { rows } = await db.query(
    `INSERT INTO student_payment_periods (plan_id, due_date, amount, status, billing_type)
     VALUES ($1, $2, $3, 'PENDING', $4)
     ON CONFLICT (plan_id, due_date) DO UPDATE SET
       amount = CASE WHEN student_payment_periods.status = 'PENDING' THEN EXCLUDED.amount ELSE student_payment_periods.amount END,
       billing_type = CASE WHEN student_payment_periods.status = 'PENDING' THEN EXCLUDED.billing_type ELSE student_payment_periods.billing_type END,
       updated_at = NOW()
     RETURNING *`,
    [plan.id, dueDate, plan.amount, plan.billing_type]
  );
  return rows[0];
};

const serializePayment = (plan, period, now = new Date()) => {
  const state = getPeriodState(period, plan, now);
  return {
    planId: plan?.id || null,
    amount: Number(period?.amount ?? plan?.amount ?? 0),
    dueDay: Number(plan?.due_day || 1),
    dueDate: dateOnly(period?.due_date),
    billingType: period?.billing_type || plan?.billing_type || 'MANUAL',
    graceDays: Number(plan?.grace_days || 0),
    autoBlock: Boolean(plan?.auto_block),
    planStatus: plan?.status || 'PAUSED',
    state,
    blocked: shouldBlockStudentPayment(period, plan, now),
    paymentUrl: period?.payment_url || null,
    failureReason: period?.failure_reason || null,
    paidAt: period?.paid_at || null,
    instructions: plan?.payment_instructions || null
  };
};

const loadPlanWithCurrentPeriod = async (studentId, professorId = null) => {
  await ensureStudentPaymentSchema();
  const params = [studentId];
  let professorClause = '';
  if (professorId) {
    params.push(professorId);
    professorClause = ' AND p.professor_user_id = $2';
  }
  const { rows } = await db.query(
    `SELECT p.*, u.full_name AS student_name, u.email AS student_email, u.phone AS student_phone
       FROM student_payment_plans p
       JOIN users u ON u.id = p.student_user_id
      WHERE p.student_user_id = $1${professorClause}
      LIMIT 1`,
    params
  );
  const plan = rows[0];
  if (!plan) return { plan: null, period: null };
  const period = await ensureCurrentPeriod(plan);
  return { plan, period };
};

const PAYMENT_STATE_PRIORITY = new Map([
  ['blocked', 0], ['chargeback', 1], ['refunded', 2], ['failed', 3],
  ['overdue', 4], ['due_soon', 5], ['pending', 6], ['paid', 7], ['paused', 8]
]);

const getStudentPaymentStatuses = async (studentId, { includeHistory = false } = {}) => {
  await ensureStudentPaymentSchema();
  const { rows } = await db.query(
    `SELECT p.*, professor.full_name AS professor_name
       FROM student_payment_plans p
       JOIN users professor ON professor.id = p.professor_user_id
       JOIN professor_students relation
         ON relation.professor_user_id = p.professor_user_id
        AND relation.student_user_id = p.student_user_id
        AND relation.active = TRUE
      WHERE p.student_user_id = $1
      ORDER BY professor.full_name`,
    [studentId]
  );
  const plans = [];
  for (const plan of rows) {
    const period = await ensureCurrentPeriod(plan);
    const serialized = {
      professorId: plan.professor_user_id,
      professorName: plan.professor_name,
      ...serializePayment(plan, period)
    };
    if (includeHistory) {
      const history = await db.query(
        `SELECT due_date, amount, status, billing_type, payment_url, failure_reason, paid_at
           FROM student_payment_periods
          WHERE plan_id = $1
          ORDER BY due_date DESC
          LIMIT 12`,
        [plan.id]
      );
      serialized.history = history.rows.map((item) => ({
        dueDate: dateOnly(item.due_date), amount: Number(item.amount), status: item.status,
        billingType: item.billing_type, paymentUrl: item.payment_url,
        failureReason: item.failure_reason, paidAt: item.paid_at
      }));
    }
    plans.push(serialized);
  }
  plans.sort((left, right) =>
    (PAYMENT_STATE_PRIORITY.get(left.state) ?? 99) - (PAYMENT_STATE_PRIORITY.get(right.state) ?? 99)
  );
  return plans;
};

const ensureAsaasCustomer = async (plan, apiKey) => {
  if (plan.provider_customer_id) return plan.provider_customer_id;
  const customer = await asaasRequest(apiKey, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: plan.student_name,
      email: plan.student_email,
      mobilePhone: String(plan.student_phone || '').replace(/\D/g, '') || undefined,
      externalReference: `student:${plan.student_user_id}`,
      notificationDisabled: false
    })
  });
  await db.query(
    `UPDATE student_payment_plans SET provider_customer_id = $1, updated_at = NOW() WHERE id = $2`,
    [customer.id, plan.id]
  );
  return customer.id;
};

const upsertProviderPayment = async (plan, payment) => {
  const providerId = sanitizeText(payment?.id || '', 100);
  if (!providerId) return null;
  const statusMap = {
    RECEIVED: 'PAID', CONFIRMED: 'PAID', RECEIVED_IN_CASH: 'PAID',
    OVERDUE: 'OVERDUE', REFUNDED: 'REFUNDED', CHARGEBACK_REQUESTED: 'CHARGEBACK',
    CHARGEBACK_DISPUTE: 'CHARGEBACK', DELETED: 'CANCELED', CANCELED: 'CANCELED'
  };
  const eventStatusMap = {
    PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'FAILED',
    PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'FAILED'
  };
  const status = eventStatusMap[String(payment._eventType || '').toUpperCase()]
    || statusMap[String(payment.status || '').toUpperCase()]
    || 'PENDING';
  const dueDate = dateOnly(payment.dueDate) || dateOnly(dueDateForMonth(plan.due_day));
  const snapshot = {
    id: providerId,
    status: payment.status || null,
    billingType: payment.billingType || null,
    subscription: payment.subscription || null,
    externalReference: payment.externalReference || null
  };
  const { rows } = await db.query(
    `INSERT INTO student_payment_periods (
       plan_id, due_date, amount, status, billing_type, provider_payment_id,
       payment_url, failure_reason, paid_at, raw_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (plan_id, due_date) DO UPDATE SET
       amount = EXCLUDED.amount,
       status = EXCLUDED.status,
       billing_type = EXCLUDED.billing_type,
       provider_payment_id = EXCLUDED.provider_payment_id,
       payment_url = COALESCE(EXCLUDED.payment_url, student_payment_periods.payment_url),
       failure_reason = EXCLUDED.failure_reason,
       paid_at = COALESCE(EXCLUDED.paid_at, student_payment_periods.paid_at),
       raw_payload = EXCLUDED.raw_payload,
       updated_at = NOW()
     RETURNING *`,
    [
      plan.id,
      dueDate,
      Number(payment.value || plan.amount),
      status,
      PAYMENT_TYPES.has(String(payment.billingType || '').toUpperCase()) ? String(payment.billingType).toUpperCase() : plan.billing_type,
      providerId,
      sanitizeText(payment.invoiceUrl || payment.bankSlipUrl || '', 1000) || null,
      status === 'FAILED'
        ? sanitizeText(payment.failureReason || payment.refusalReason || 'Pagamento não aprovado pelo Asaas.', 500)
        : null,
      status === 'PAID' ? (payment.paymentDate || payment.clientPaymentDate || new Date()) : null,
      JSON.stringify(snapshot)
    ]
  );
  return rows[0];
};

const syncAsaasPlan = async (plan) => {
  const { apiKey } = await getProfessorApiKey(plan.professor_user_id);
  const customerId = await ensureAsaasCustomer(plan, apiKey);
  let subscriptionId = plan.provider_subscription_id;
  if (!subscriptionId) {
    const nextDue = dueDateForMonth(plan.due_day);
    if (nextDue < new Date()) nextDue.setUTCMonth(nextDue.getUTCMonth() + 1);
    const subscription = await asaasRequest(apiKey, '/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId,
        billingType: plan.billing_type,
        value: Number(plan.amount),
        nextDueDate: dateOnly(nextDue),
        cycle: 'MONTHLY',
        description: plan.description || 'Mensalidade de aulas',
        externalReference: `student-plan:${plan.id}`
      })
    });
    subscriptionId = subscription.id;
    await db.query(
      `UPDATE student_payment_plans SET provider_subscription_id = $1, updated_at = NOW() WHERE id = $2`,
      [subscriptionId, plan.id]
    );
  }
  const payments = await asaasRequest(apiKey, `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=20`);
  for (const payment of Array.isArray(payments?.data) ? payments.data : []) {
    await upsertProviderPayment(plan, payment);
  }
  return subscriptionId;
};

const configureSignupPaymentPlan = async ({
  professorId,
  studentId,
  amount,
  dueDay,
  preferredBillingType = 'PIX',
  graceDays = 5,
  autoBlock = true,
  description = 'Mensalidade de aulas',
  instructions = ''
}) => {
  await ensureStudentPaymentSchema();
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return null;

  const studentResult = await db.query(
    `SELECT id, full_name, email, phone
       FROM users
      WHERE id = $1 AND role = 'student'
        AND EXISTS (
          SELECT 1 FROM professor_students relation
           WHERE relation.student_user_id = users.id
             AND relation.professor_user_id = $2
             AND relation.active = TRUE
        )`,
    [studentId, professorId]
  );
  if (!studentResult.rows.length) return null;

  const settings = await getSettings(professorId);
  const asaasReady = settings?.provider_mode === 'ASAAS'
    && Boolean(settings.provider_api_key_encrypted)
    && ['CONNECTED', 'APPROVED'].includes(settings.provider_status);
  const requestedBillingType = PAYMENT_TYPES.has(String(preferredBillingType || '').toUpperCase())
    ? String(preferredBillingType).toUpperCase()
    : 'PIX';
  const billingType = asaasReady && requestedBillingType !== 'MANUAL' ? requestedBillingType : 'MANUAL';
  const normalizedDueDay = Math.min(Math.max(Number.parseInt(dueDay, 10) || 1, 1), 28);
  const normalizedGraceDays = Math.min(Math.max(Number.parseInt(graceDays, 10) || 0, 0), 60);

  const { rows } = await db.query(
    `INSERT INTO student_payment_plans (
       professor_user_id, student_user_id, amount, due_day, billing_type,
       grace_days, auto_block, status, description, payment_instructions
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9)
     ON CONFLICT (professor_user_id, student_user_id) DO UPDATE SET
       amount = EXCLUDED.amount, due_day = EXCLUDED.due_day,
       billing_type = EXCLUDED.billing_type, grace_days = EXCLUDED.grace_days,
       auto_block = EXCLUDED.auto_block, status = 'ACTIVE',
       description = EXCLUDED.description,
       payment_instructions = EXCLUDED.payment_instructions,
       updated_at = NOW()
     RETURNING *`,
    [
      professorId,
      studentId,
      Number(normalizedAmount.toFixed(2)),
      normalizedDueDay,
      billingType,
      normalizedGraceDays,
      autoBlock !== false,
      sanitizeText(description, 240) || 'Mensalidade de aulas',
      sanitizeText(instructions, 800) || null
    ]
  );
  const student = studentResult.rows[0];
  const plan = {
    ...rows[0],
    student_name: student.full_name,
    student_email: student.email,
    student_phone: student.phone
  };
  await ensureCurrentPeriod(plan);
  if (billingType !== 'MANUAL') await syncAsaasPlan(plan);
  return { planId: plan.id, billingType, automaticReady: billingType !== 'MANUAL' };
};

const requireProfessor = (req, res) => {
  if (req.user?.role === 'professor') return true;
  res.status(403).json({ message: 'Esta área financeira pertence ao professor.' });
  return false;
};

const summarizeStudentPayments = (students = []) => {
  const configured = students.filter((student) => student.plan);
  const received = configured.filter((student) => student.payment?.state === 'paid');
  const pending = configured.filter((student) => ['pending', 'due_soon', 'overdue'].includes(student.payment?.state));
  const overdue = configured.filter((student) => ['overdue', 'blocked', 'failed', 'chargeback'].includes(student.payment?.state));
  return {
    totalStudents: students.length,
    activeStudents: students.filter((student) => student.accountActive).length,
    configured: configured.length,
    monthlyExpected: configured.filter((student) => student.plan?.status === 'ACTIVE')
      .reduce((sum, student) => sum + Number(student.plan.amount || 0), 0),
    received: received.reduce((sum, student) => sum + Number(student.payment?.amount || 0), 0),
    pending: pending.reduce((sum, student) => sum + Number(student.payment?.amount || 0), 0),
    overdue: overdue.length,
    blocked: configured.filter((student) => student.payment?.blocked).length
  };
};

const buildGlobalStudentPaymentOverview = async () => {
  await ensureStudentPaymentSchema();
  const { rows } = await db.query(
    `SELECT professor.id AS professor_id, professor.full_name AS professor_name,
            professor.email AS professor_email, professor.is_active AS professor_active,
            settings.provider_mode, settings.provider_status,
            student.id, student.full_name, student.email, student.phone, student.class_name,
            student.is_active,
            p.id AS plan_id, p.amount, p.due_day, p.billing_type, p.grace_days,
            p.auto_block, p.status AS plan_status, p.description, p.payment_instructions,
            p.provider_subscription_id, p.created_at AS plan_created_at
       FROM users professor
       LEFT JOIN professor_payment_settings settings ON settings.professor_user_id = professor.id
       LEFT JOIN professor_students relation
         ON relation.professor_user_id = professor.id AND relation.active = TRUE
       LEFT JOIN users student ON student.id = relation.student_user_id AND student.role = 'student'
       LEFT JOIN student_payment_plans p
         ON p.student_user_id = student.id AND p.professor_user_id = professor.id
      WHERE professor.role = 'professor'
      ORDER BY professor.full_name, student.full_name`
  );
  const now = new Date();
  const professorMap = new Map();
  for (const row of rows) {
    let professor = professorMap.get(row.professor_id);
    if (!professor) {
      professor = {
        id: row.professor_id,
        name: row.professor_name,
        email: row.professor_email,
        accountActive: Boolean(row.professor_active),
        paymentSettings: {
          mode: row.provider_mode || 'MANUAL',
          status: row.provider_status || 'DISCONNECTED'
        },
        students: []
      };
      professorMap.set(row.professor_id, professor);
    }
    if (!row.id) continue;
    let payment = null;
    if (row.plan_id) {
      const plan = {
        id: row.plan_id,
        amount: row.amount,
        due_day: row.due_day,
        billing_type: row.billing_type,
        grace_days: row.grace_days,
        auto_block: row.auto_block,
        status: row.plan_status,
        payment_instructions: row.payment_instructions,
        created_at: row.plan_created_at
      };
      payment = serializePayment(plan, await ensureCurrentPeriod(plan, now), now);
    }
    professor.students.push({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      className: row.class_name,
      accountActive: Boolean(row.is_active),
      plan: row.plan_id ? {
        id: row.plan_id,
        amount: Number(row.amount),
        dueDay: Number(row.due_day),
        billingType: row.billing_type,
        graceDays: Number(row.grace_days),
        autoBlock: Boolean(row.auto_block),
        status: row.plan_status,
        description: row.description || '',
        automaticReady: Boolean(row.provider_subscription_id)
      } : null,
      payment
    });
  }

  const professors = Array.from(professorMap.values()).map((professor) => {
    professor.summary = summarizeStudentPayments(professor.students);
    return professor;
  });
  const allStudents = professors.flatMap((professor) => professor.students);
  return {
    generatedAt: now.toISOString(),
    summary: {
      professors: professors.length,
      students: allStudents.length,
      configured: professors.reduce((sum, professor) => sum + professor.summary.configured, 0),
      monthlyExpected: professors.reduce((sum, professor) => sum + professor.summary.monthlyExpected, 0),
      received: professors.reduce((sum, professor) => sum + professor.summary.received, 0),
      pending: professors.reduce((sum, professor) => sum + professor.summary.pending, 0),
      overdue: professors.reduce((sum, professor) => sum + professor.summary.overdue, 0),
      blocked: professors.reduce((sum, professor) => sum + professor.summary.blocked, 0)
    },
    professors
  };
};

adminRouter.get('/student-payments/global-overview', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Visão consolidada disponível apenas para o administrador.' });
  }
  res.json(await buildGlobalStudentPaymentOverview());
});

adminRouter.get('/student-payments/overview', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  await ensureStudentPaymentSchema();
  const { rows: students } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.class_name, u.is_active,
            p.id AS plan_id, p.amount, p.due_day, p.billing_type, p.grace_days,
            p.auto_block, p.status AS plan_status, p.description, p.payment_instructions,
            p.provider_customer_id, p.provider_subscription_id, p.created_at AS plan_created_at
       FROM professor_students relation
       JOIN users u ON u.id = relation.student_user_id
       LEFT JOIN student_payment_plans p
         ON p.student_user_id = u.id AND p.professor_user_id = $1
      WHERE relation.professor_user_id = $1
        AND relation.active = TRUE
        AND u.role = 'student'
      ORDER BY u.full_name`,
    [req.user.id]
  );
  const now = new Date();
  const entries = [];
  for (const row of students) {
    let payment = null;
    if (row.plan_id) {
      const plan = {
        id: row.plan_id,
        amount: row.amount,
        due_day: row.due_day,
        billing_type: row.billing_type,
        grace_days: row.grace_days,
        auto_block: row.auto_block,
        status: row.plan_status,
        payment_instructions: row.payment_instructions,
        created_at: row.plan_created_at
      };
      payment = serializePayment(plan, await ensureCurrentPeriod(plan, now), now);
    }
    entries.push({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      className: row.class_name,
      accountActive: row.is_active,
      plan: row.plan_id ? {
        id: row.plan_id,
        amount: Number(row.amount),
        dueDay: Number(row.due_day),
        billingType: row.billing_type,
        graceDays: Number(row.grace_days),
        autoBlock: Boolean(row.auto_block),
        status: row.plan_status,
        description: row.description || '',
        instructions: row.payment_instructions || '',
        automaticReady: Boolean(row.provider_subscription_id)
      } : null,
      payment
    });
  }
  const settings = await getSettings(req.user.id);
  const configured = entries.filter((item) => item.plan);
  res.json({
    settings: {
      mode: settings?.provider_mode || 'MANUAL',
      status: settings?.provider_status || 'DISCONNECTED',
      accountName: settings?.provider_account_name || null,
      walletId: settings?.provider_wallet_id || null,
      accountId: settings?.provider_account_id || null,
      connectedAt: settings?.connected_at || null,
      hasApiKey: Boolean(settings?.provider_api_key_encrypted),
      onboarding: settings?.onboarding_data || null,
      onboardingCheckedAt: settings?.onboarding_checked_at || null
    },
    summary: {
      configured: configured.length,
      received: configured.filter((item) => item.payment?.state === 'paid').reduce((sum, item) => sum + item.payment.amount, 0),
      pending: configured.filter((item) => ['pending', 'due_soon', 'overdue'].includes(item.payment?.state)).reduce((sum, item) => sum + item.payment.amount, 0),
      overdue: configured.filter((item) => ['overdue', 'blocked', 'failed', 'chargeback'].includes(item.payment?.state)).length,
      blocked: configured.filter((item) => item.payment?.blocked).length
    },
    students: entries
  });
});

adminRouter.put('/student-payments/settings', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  await ensureStudentPaymentSchema();
  const mode = String(req.body?.mode || 'MANUAL').toUpperCase();
  if (!['MANUAL', 'ASAAS'].includes(mode)) return res.status(400).json({ message: 'Modo financeiro inválido.' });
  if (mode === 'MANUAL') {
    await db.query(
      `INSERT INTO professor_payment_settings (professor_user_id, provider_mode, provider_status)
       VALUES ($1, 'MANUAL', 'MANUAL')
       ON CONFLICT (professor_user_id) DO UPDATE SET provider_mode = 'MANUAL', provider_status = 'MANUAL', updated_at = NOW()`,
      [req.user.id]
    );
    return res.json({ mode: 'MANUAL', status: 'MANUAL' });
  }
  const existingSettings = await getSettings(req.user.id);
  const apiKey = sanitizeText(req.body?.apiKey || '', 500, { trim: true });
  if (!apiKey && existingSettings?.provider_api_key_encrypted) {
    await db.query(
      `UPDATE professor_payment_settings SET provider_mode = 'ASAAS', updated_at = NOW() WHERE professor_user_id = $1`,
      [req.user.id]
    );
    return res.json({
      mode: 'ASAAS',
      status: existingSettings.provider_status,
      accountName: existingSettings.provider_account_name || null
    });
  }
  if (!apiKey) return res.status(400).json({ message: 'Crie uma subconta Asaas dentro do portal.' });
  const account = await asaasRequest(apiKey, '/myAccount');
  const webhookToken = crypto.randomBytes(32).toString('hex');
  if (!PUBLIC_APP_URL) return res.status(409).json({ message: 'Configure PUBLIC_APP_URL antes de conectar os webhooks do professor.' });
  const webhookUrl = `${PUBLIC_APP_URL}/api/billing/webhook/student-payments/${req.user.id}`;
  const webhookPayload = buildSubaccountWebhook(req.user.id, req.user.email, webhookToken);
  const existingWebhooks = await asaasRequest(apiKey, '/webhooks');
  const existingWebhook = (Array.isArray(existingWebhooks?.data) ? existingWebhooks.data : [])
    .find((item) => item.url === webhookUrl || item.name === webhookPayload.name);
  await asaasRequest(apiKey, existingWebhook?.id ? `/webhooks/${encodeURIComponent(existingWebhook.id)}` : '/webhooks', {
    method: existingWebhook?.id ? 'PUT' : 'POST',
    body: JSON.stringify(webhookPayload)
  });
  await db.query(
    `INSERT INTO professor_payment_settings (
       professor_user_id, provider_mode, provider_api_key_encrypted, provider_wallet_id,
       provider_account_name, provider_status, webhook_token_hash, connected_at
     ) VALUES ($1,'ASAAS',$2,$3,$4,'CONNECTED',$5,NOW())
     ON CONFLICT (professor_user_id) DO UPDATE SET
       provider_mode = 'ASAAS', provider_api_key_encrypted = EXCLUDED.provider_api_key_encrypted,
       provider_wallet_id = EXCLUDED.provider_wallet_id, provider_account_name = EXCLUDED.provider_account_name,
       provider_status = 'CONNECTED', webhook_token_hash = EXCLUDED.webhook_token_hash,
       connected_at = NOW(), updated_at = NOW()`,
    [
      req.user.id,
      encryptSecret(apiKey),
      sanitizeText(account.walletId || '', 120) || null,
      sanitizeText(account.name || account.companyName || req.user.fullName || '', 180) || null,
      hashToken(webhookToken)
    ]
  );
  res.json({ mode: 'ASAAS', status: 'CONNECTED', accountName: account.name || account.companyName || null });
});

adminRouter.post('/student-payments/subaccount', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  await ensureStudentPaymentSchema();
  if (!ASAAS_ROOT_API_KEY) {
    return res.status(503).json({ message: 'A conta principal Asaas ainda não foi configurada na plataforma.' });
  }
  if (!PUBLIC_APP_URL) {
    return res.status(409).json({ message: 'Configure PUBLIC_APP_URL antes de criar subcontas.' });
  }
  const currentSettings = await getSettings(req.user.id);
  if (currentSettings?.provider_account_id || currentSettings?.provider_api_key_encrypted) {
    return res.status(409).json({ message: 'Este professor já possui uma conta Asaas vinculada.' });
  }

  const name = sanitizeText(req.body?.name || req.user.fullName || '', 160);
  const email = sanitizeText(req.body?.email || req.user.email || '', 180).toLowerCase();
  const cpfCnpj = digitsOnly(req.body?.cpfCnpj, 14);
  const mobilePhone = digitsOnly(req.body?.mobilePhone, 11);
  const postalCode = digitsOnly(req.body?.postalCode, 8);
  const personType = cpfCnpj.length === 11 ? 'FISICA' : cpfCnpj.length === 14 ? 'JURIDICA' : '';
  const birthDate = sanitizeText(req.body?.birthDate || '', 10);
  const companyType = sanitizeText(req.body?.companyType || '', 30).toUpperCase();
  const incomeValue = Number(req.body?.incomeValue);
  const address = sanitizeText(req.body?.address || '', 180);
  const addressNumber = sanitizeText(req.body?.addressNumber || '', 30);
  const complement = sanitizeText(req.body?.complement || '', 100);
  const province = sanitizeText(req.body?.province || '', 100);
  const consentAccepted = req.body?.consentAccepted === true;

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Informe nome e email válidos.' });
  if (!personType) return res.status(400).json({ message: 'Informe um CPF ou CNPJ válido.' });
  if (personType === 'FISICA' && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ message: 'Informe a data de nascimento do titular.' });
  }
  if (personType === 'JURIDICA' && !COMPANY_TYPES.has(companyType)) {
    return res.status(400).json({ message: 'Informe o tipo da empresa.' });
  }
  if (mobilePhone.length < 10 || postalCode.length !== 8 || !address || !addressNumber || !province) {
    return res.status(400).json({ message: 'Preencha telefone, CEP e endereço completos.' });
  }
  if (!Number.isFinite(incomeValue) || incomeValue <= 0) {
    return res.status(400).json({ message: 'Informe a renda ou o faturamento mensal.' });
  }
  if (!consentAccepted) {
    return res.status(400).json({ message: 'Confirme a autorização para criar a conta e enviar os dados ao Asaas.' });
  }

  const webhookToken = crypto.randomBytes(32).toString('hex');
  const accountPayload = {
    name,
    email,
    loginEmail: email,
    cpfCnpj,
    mobilePhone,
    incomeValue: Number(incomeValue.toFixed(2)),
    address,
    addressNumber,
    complement: complement || undefined,
    province,
    postalCode,
    site: PUBLIC_APP_URL,
    webhooks: [buildSubaccountWebhook(req.user.id, email, webhookToken)]
  };
  if (personType === 'FISICA') accountPayload.birthDate = birthDate;
  if (personType === 'JURIDICA') accountPayload.companyType = companyType;

  const account = await asaasRequest(ASAAS_ROOT_API_KEY, '/accounts', {
    method: 'POST',
    body: JSON.stringify(accountPayload)
  });
  if (!account?.apiKey || !account?.walletId) {
    return res.status(502).json({ message: 'O Asaas criou a conta sem retornar as credenciais necessárias.' });
  }
  const initialOnboarding = {
    general: 'PENDING',
    commercialInfo: 'PENDING',
    bankAccountInfo: 'PENDING',
    documentation: 'PENDING',
    documents: []
  };
  await db.query(
    `INSERT INTO professor_payment_settings (
       professor_user_id, provider_mode, provider_api_key_encrypted, provider_account_id,
       provider_wallet_id, provider_account_name, provider_status, webhook_token_hash,
       onboarding_data, subaccount_consent_version, subaccount_consented_at, connected_at, updated_at
     ) VALUES ($1,'ASAAS',$2,$3,$4,$5,'PENDING',$6,$7::jsonb,$8,NOW(),NOW(),NOW())
     ON CONFLICT (professor_user_id) DO UPDATE SET
       provider_mode = 'ASAAS', provider_api_key_encrypted = EXCLUDED.provider_api_key_encrypted,
       provider_account_id = EXCLUDED.provider_account_id, provider_wallet_id = EXCLUDED.provider_wallet_id,
       provider_account_name = EXCLUDED.provider_account_name, provider_status = 'PENDING',
       webhook_token_hash = EXCLUDED.webhook_token_hash, onboarding_data = EXCLUDED.onboarding_data,
       subaccount_consent_version = EXCLUDED.subaccount_consent_version,
       subaccount_consented_at = EXCLUDED.subaccount_consented_at,
       connected_at = NOW(), onboarding_checked_at = NULL, updated_at = NOW()`,
    [
      req.user.id,
      encryptSecret(account.apiKey),
      sanitizeText(account.id || '', 120) || null,
      sanitizeText(account.walletId, 120),
      sanitizeText(account.name || name, 180),
      hashToken(webhookToken),
      JSON.stringify(initialOnboarding),
      SUBACCOUNT_CONSENT_VERSION
    ]
  );
  res.status(201).json({
    created: true,
    accountName: account.name || name,
    status: 'PENDING',
    waitSeconds: 15
  });
});

adminRouter.get('/student-payments/subaccount/onboarding', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  const settings = await getSettings(req.user.id);
  if (!settings?.provider_api_key_encrypted || !settings.provider_account_id) {
    return res.status(404).json({ message: 'Crie a subconta Asaas primeiro.' });
  }
  const connectedAt = settings.connected_at ? new Date(settings.connected_at) : null;
  const elapsedSeconds = connectedAt && Number.isFinite(connectedAt.getTime())
    ? Math.floor((Date.now() - connectedAt.getTime()) / 1000)
    : 15;
  if (elapsedSeconds < 15) {
    return res.json({
      ready: false,
      waitSeconds: 15 - elapsedSeconds,
      status: settings.provider_status,
      onboarding: settings.onboarding_data || null
    });
  }
  const apiKey = decryptStoredSecret(settings.provider_api_key_encrypted);
  const accountStatus = await asaasRequest(apiKey, '/myAccount/status/');
  const documentResult = await asaasRequest(apiKey, '/myAccount/documents');
  const documents = (Array.isArray(documentResult?.data) ? documentResult.data : []).map((item) => {
    let onboardingUrl = null;
    try {
      const parsed = new URL(String(item.onboardingUrl || ''));
      if (parsed.protocol === 'https:' && (parsed.hostname === 'asaas.com' || parsed.hostname.endsWith('.asaas.com'))) {
        onboardingUrl = parsed.toString();
      }
    } catch (error) {
      onboardingUrl = null;
    }
    return {
      id: sanitizeText(item.id || '', 120),
      type: sanitizeText(item.type || '', 80),
      title: sanitizeText(item.title || 'Documento solicitado', 180),
      description: sanitizeText(item.description || '', 500),
      status: sanitizeText(item.status || 'PENDING', 40).toUpperCase(),
      onboardingUrl
    };
  });
  const onboarding = {
    general: sanitizeText(accountStatus.general || 'PENDING', 40).toUpperCase(),
    commercialInfo: sanitizeText(accountStatus.commercialInfo || 'PENDING', 40).toUpperCase(),
    bankAccountInfo: sanitizeText(accountStatus.bankAccountInfo || 'PENDING', 40).toUpperCase(),
    documentation: sanitizeText(accountStatus.documentation || 'PENDING', 40).toUpperCase(),
    documents
  };
  const providerStatus = onboarding.general === 'APPROVED' ? 'APPROVED' : onboarding.general;
  await db.query(
    `UPDATE professor_payment_settings
        SET provider_status = $2, onboarding_data = $3::jsonb,
            onboarding_checked_at = NOW(), updated_at = NOW()
      WHERE professor_user_id = $1`,
    [req.user.id, providerStatus, JSON.stringify(onboarding)]
  );
  res.json({ ready: true, status: providerStatus, onboarding });
});

adminRouter.put('/student-payments/plans/:studentId', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  await ensureStudentPaymentSchema();
  const studentId = req.params.studentId;
  if (!isUuid(studentId)) return res.status(400).json({ message: 'Aluno inválido.' });
  const owned = await db.query(
    `SELECT id, full_name, email, phone
       FROM users
      WHERE id = $1 AND role = 'student'
        AND EXISTS (
          SELECT 1 FROM professor_students relation
           WHERE relation.student_user_id = users.id
             AND relation.professor_user_id = $2
             AND relation.active = TRUE
        )`,
    [studentId, req.user.id]
  );
  if (!owned.rows.length) return res.status(404).json({ message: 'Aluno não encontrado.' });
  const amount = Number(req.body?.amount);
  const dueDay = Number.parseInt(req.body?.dueDay, 10);
  const graceDays = Number.parseInt(req.body?.graceDays ?? 5, 10);
  const billingType = String(req.body?.billingType || 'MANUAL').toUpperCase();
  const status = String(req.body?.status || 'ACTIVE').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'Informe uma mensalidade válida.' });
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return res.status(400).json({ message: 'O vencimento deve estar entre os dias 1 e 28.' });
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) return res.status(400).json({ message: 'A tolerância deve estar entre 0 e 60 dias.' });
  if (!PAYMENT_TYPES.has(billingType) || !PLAN_STATUSES.has(status)) return res.status(400).json({ message: 'Configuração de cobrança inválida.' });
  if (billingType !== 'MANUAL') await getProfessorApiKey(req.user.id);
  const currentPlanResult = await db.query(
    `SELECT * FROM student_payment_plans WHERE professor_user_id = $1 AND student_user_id = $2`,
    [req.user.id, studentId]
  );
  const currentPlan = currentPlanResult.rows[0] || null;
  const providerDefinitionChanged = Boolean(currentPlan?.provider_subscription_id) && (
    Number(currentPlan.amount) !== Number(amount.toFixed(2))
    || Number(currentPlan.due_day) !== dueDay
    || currentPlan.billing_type !== billingType
    || status !== 'ACTIVE'
  );
  if (providerDefinitionChanged) {
    const { apiKey } = await getProfessorApiKey(req.user.id);
    await asaasRequest(apiKey, `/subscriptions/${encodeURIComponent(currentPlan.provider_subscription_id)}`, {
      method: 'DELETE'
    });
  }
  const { rows } = await db.query(
    `INSERT INTO student_payment_plans (
       professor_user_id, student_user_id, amount, due_day, billing_type,
       grace_days, auto_block, status, description, payment_instructions
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (professor_user_id, student_user_id) DO UPDATE SET
       amount = EXCLUDED.amount, due_day = EXCLUDED.due_day, billing_type = EXCLUDED.billing_type,
       grace_days = EXCLUDED.grace_days, auto_block = EXCLUDED.auto_block,
       status = EXCLUDED.status, description = EXCLUDED.description,
       payment_instructions = EXCLUDED.payment_instructions, updated_at = NOW(),
       provider_subscription_id = CASE
         WHEN student_payment_plans.billing_type <> EXCLUDED.billing_type
           OR student_payment_plans.amount <> EXCLUDED.amount
           OR student_payment_plans.due_day <> EXCLUDED.due_day
           OR EXCLUDED.status <> 'ACTIVE' THEN NULL
         ELSE student_payment_plans.provider_subscription_id END
     RETURNING *`,
    [
      req.user.id, studentId, Number(amount.toFixed(2)), dueDay, billingType, graceDays,
      req.body?.autoBlock !== false, status,
      sanitizeText(req.body?.description || 'Mensalidade de aulas', 240) || null,
      sanitizeText(req.body?.instructions || '', 800) || null
    ]
  );
  const plan = { ...rows[0], ...owned.rows[0], student_name: owned.rows[0].full_name, student_email: owned.rows[0].email, student_phone: owned.rows[0].phone };
  await ensureCurrentPeriod(plan);
  if (billingType !== 'MANUAL' && status === 'ACTIVE') await syncAsaasPlan(plan);
  res.json({ planId: plan.id, automaticReady: billingType !== 'MANUAL' });
});

adminRouter.post('/student-payments/plans/:planId/mark-paid', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  await ensureStudentPaymentSchema();
  const planId = req.params.planId;
  if (!isUuid(planId)) return res.status(400).json({ message: 'Plano inválido.' });
  const { rows } = await db.query(
    `SELECT * FROM student_payment_plans WHERE id = $1 AND professor_user_id = $2`,
    [planId, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Mensalidade não encontrada.' });
  const period = await ensureCurrentPeriod(rows[0]);
  await db.query(
    `UPDATE student_payment_periods
        SET status = 'PAID', paid_at = NOW(), failure_reason = NULL, updated_at = NOW()
      WHERE id = $1`,
    [period.id]
  );
  res.json({ paid: true });
});

adminRouter.post('/student-payments/plans/:planId/sync', async (req, res) => {
  if (!requireProfessor(req, res)) return;
  await ensureStudentPaymentSchema();
  const { rows } = await db.query(
    `SELECT p.*, u.full_name AS student_name, u.email AS student_email, u.phone AS student_phone
       FROM student_payment_plans p JOIN users u ON u.id = p.student_user_id
      WHERE p.id = $1 AND p.professor_user_id = $2`,
    [req.params.planId, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Mensalidade não encontrada.' });
  if (rows[0].billing_type === 'MANUAL') return res.status(409).json({ message: 'Esta cobrança é manual.' });
  await syncAsaasPlan(rows[0]);
  res.json({ synchronized: true });
});

studentRouter.get('/payments/status', async (req, res) => {
  if (req.user?.role !== 'student') return res.status(403).json({ message: 'Área exclusiva do aluno.' });
  const plans = await getStudentPaymentStatuses(req.user.id, { includeHistory: true });
  if (!plans.length) return res.json({ configured: false, blocked: false, history: [], plans: [] });
  res.json({
    configured: true,
    ...plans[0],
    blocked: plans.some((plan) => plan.blocked),
    plans
  });
});

studentRouter.post('/payments/refresh', async (req, res) => {
  if (req.user?.role !== 'student') return res.status(403).json({ message: 'Área exclusiva do aluno.' });
  const professorId = isUuid(req.body?.professorId) ? req.body.professorId : null;
  const { plan } = await loadPlanWithCurrentPeriod(req.user.id, professorId);
  if (!plan) return res.status(404).json({ message: 'Mensalidade não configurada.' });
  if (plan.billing_type !== 'MANUAL') await syncAsaasPlan(plan);
  const refreshed = await loadPlanWithCurrentPeriod(req.user.id, plan.professor_user_id);
  res.json(serializePayment(refreshed.plan, refreshed.period));
});

const requireStudentPaymentAccess = async (req, res, next) => {
  if (req.user?.role !== 'student' || /^\/public\//.test(req.path)) return next();
  const courseId = isUuid(req.body?.courseId) ? req.body.courseId : null;
  if (!courseId) return next();
  const { rows } = await db.query('SELECT owner_user_id FROM courses WHERE id = $1', [courseId]);
  const professorId = rows[0]?.owner_user_id || null;
  if (!professorId) return next();
  const { plan, period } = await loadPlanWithCurrentPeriod(req.user.id, professorId);
  if (!plan || !shouldBlockStudentPayment(period, plan)) return next();
  return res.status(402).json({
    message: 'Mensalidade vencida. Regularize o pagamento para continuar acessando os cursos.',
    code: 'STUDENT_PAYMENT_REQUIRED',
    payment: serializePayment(plan, period)
  });
};

webhookRouter.post('/webhook/student-payments/:professorId', async (req, res) => {
  await ensureStudentPaymentSchema();
  const professorId = req.params.professorId;
  if (!isUuid(professorId)) return res.status(404).json({ received: false });
  const settings = await getSettings(professorId);
  const suppliedToken = sanitizeText(req.headers['asaas-access-token'] || '', 500, { trim: false });
  if (!settings?.webhook_token_hash || !safeEqual(hashToken(suppliedToken), settings.webhook_token_hash)) {
    return res.status(401).json({ received: false });
  }
  const eventType = sanitizeText(req.body?.event || '', 120).toUpperCase();
  if (eventType.startsWith('ACCOUNT_STATUS_')) {
    const sourceAccountId = sanitizeText(req.body?.account?.id || '', 120);
    if (settings.provider_account_id && sourceAccountId && sourceAccountId !== settings.provider_account_id) {
      return res.status(202).json({ received: true, ignored: true });
    }
    const accountStatus = req.body?.accountStatus && typeof req.body.accountStatus === 'object'
      ? req.body.accountStatus
      : {};
    const onboardingStatus = {
      general: sanitizeText(accountStatus.general || 'PENDING', 40).toUpperCase(),
      commercialInfo: sanitizeText(accountStatus.commercialInfo || 'PENDING', 40).toUpperCase(),
      bankAccountInfo: sanitizeText(accountStatus.bankAccountInfo || 'PENDING', 40).toUpperCase(),
      documentation: sanitizeText(accountStatus.documentation || 'PENDING', 40).toUpperCase()
    };
    const providerStatus = onboardingStatus.general === 'APPROVED' ? 'APPROVED' : onboardingStatus.general;
    await db.query(
      `UPDATE professor_payment_settings
          SET provider_status = $2,
              onboarding_data = COALESCE(onboarding_data, '{}'::jsonb) || $3::jsonb,
              onboarding_checked_at = NOW(), updated_at = NOW()
        WHERE professor_user_id = $1`,
      [professorId, providerStatus, JSON.stringify(onboardingStatus)]
    );
    return res.json({ received: true });
  }
  const paymentId = sanitizeText(req.body?.payment?.id || '', 100);
  if (!paymentId) return res.status(202).json({ received: true, ignored: true });
  const apiKey = decryptStoredSecret(settings.provider_api_key_encrypted);
  const payment = await asaasRequest(apiKey, `/payments/${encodeURIComponent(paymentId)}`);
  payment._eventType = sanitizeText(req.body?.event || '', 100);
  let planRows = [];
  if (payment.subscription) {
    planRows = (await db.query(
      `SELECT * FROM student_payment_plans WHERE professor_user_id = $1 AND provider_subscription_id = $2`,
      [professorId, payment.subscription]
    )).rows;
  }
  if (!planRows.length) {
    const reference = String(payment.externalReference || '');
    const planId = reference.startsWith('student-plan:') ? reference.slice('student-plan:'.length) : '';
    if (isUuid(planId)) {
      planRows = (await db.query(
        `SELECT * FROM student_payment_plans WHERE professor_user_id = $1 AND id = $2`,
        [professorId, planId]
      )).rows;
    }
  }
  if (!planRows.length) return res.status(202).json({ received: true, ignored: true });
  await upsertProviderPayment(planRows[0], payment);
  res.json({ received: true });
});

module.exports = {
  adminRouter,
  studentRouter,
  webhookRouter,
  ensureStudentPaymentSchema,
  configureSignupPaymentPlan,
  buildGlobalStudentPaymentOverview,
  getStudentPaymentStatuses,
  requireStudentPaymentAccess,
  __test: {
    dateOnly,
    dueDateForMonth,
    addMonths,
    getPeriodState,
    shouldBlockStudentPayment,
    buildSubaccountWebhook,
    summarizeStudentPayments
  }
};
