const db = require('./db');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WARNING_DAYS = 7;
const PAYMENT_FAILURE_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
]);
const PAYMENT_PENDING_EVENTS = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_AWAITING_RISK_ANALYSIS',
  'PAYMENT_AUTHORIZED'
]);

let schemaPromise = null;

const addCalendarMonth = (value) => {
  const source = new Date(value);
  const day = source.getUTCDate();
  const result = new Date(source);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
};

const calculateNextAccessExpiration = (currentExpiration, now = new Date()) => {
  const current = currentExpiration ? new Date(currentExpiration) : null;
  const baseline = current && Number.isFinite(current.getTime()) && current > now ? current : now;
  return addCalendarMonth(baseline);
};

const getBillingAccessState = (user = {}, now = new Date(), warningDays = DEFAULT_WARNING_DAYS) => {
  const managed = user.role === 'professor' && user.billing_access_managed === true;
  if (!managed) {
    return { managed: false, state: 'legacy', blocked: false, daysRemaining: null };
  }

  const expiration = user.subscription_access_expires_at
    ? new Date(user.subscription_access_expires_at)
    : null;
  const validExpiration = expiration && Number.isFinite(expiration.getTime());
  const daysRemaining = validExpiration
    ? Math.max(0, Math.ceil((expiration.getTime() - now.getTime()) / DAY_MS))
    : 0;
  const lastEvent = String(user.subscription_last_event_type || '').toUpperCase();

  if (!validExpiration || expiration <= now) {
    return { managed, state: 'expired', blocked: true, daysRemaining: 0, expiration, lastEvent };
  }
  if (PAYMENT_FAILURE_EVENTS.has(lastEvent)) {
    return { managed, state: 'payment_failed', blocked: false, daysRemaining, expiration, lastEvent };
  }
  if (PAYMENT_PENDING_EVENTS.has(lastEvent)) {
    return { managed, state: 'payment_pending', blocked: false, daysRemaining, expiration, lastEvent };
  }
  if (daysRemaining <= warningDays) {
    return { managed, state: 'due_soon', blocked: false, daysRemaining, expiration, lastEvent };
  }
  return { managed, state: 'active', blocked: false, daysRemaining, expiration, lastEvent };
};

const ensureBillingAccessSchema = async (client = db) => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS billing_access_managed BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS subscription_access_expires_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS subscription_plan_code TEXT,
          ADD COLUMN IF NOT EXISTS subscription_billing_type TEXT,
          ADD COLUMN IF NOT EXISTS subscription_payment_status TEXT,
          ADD COLUMN IF NOT EXISTS subscription_last_event_type TEXT,
          ADD COLUMN IF NOT EXISTS subscription_payment_url TEXT
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS billing_payment_periods (
          provider_payment_id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          billing_subscription_id BIGINT,
          access_started_at TIMESTAMPTZ NOT NULL,
          access_expires_at TIMESTAMPTZ NOT NULL,
          event_type TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
};

module.exports = {
  DEFAULT_WARNING_DAYS,
  PAYMENT_FAILURE_EVENTS,
  PAYMENT_PENDING_EVENTS,
  addCalendarMonth,
  calculateNextAccessExpiration,
  ensureBillingAccessSchema,
  getBillingAccessState
};
