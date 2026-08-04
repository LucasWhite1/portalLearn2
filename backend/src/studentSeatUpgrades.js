const crypto = require('crypto');
const db = require('./db');
const { sanitizeText } = require('./security');

const ASAAS_ENV = String(process.env.ASAAS_ENV || 'sandbox').toLowerCase() === 'production'
  ? 'production'
  : 'sandbox';
const ASAAS_BASE_URL = sanitizeText(
  process.env.ASAAS_BASE_URL || (ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3'),
  255
);
const ASAAS_API_KEY = sanitizeText(process.env.ASAAS_API_KEY || '', 255);
const APP_NAME = sanitizeText(process.env.ASAAS_APP_NAME || 'Criatyve/1.0', 120);
const PUBLIC_APP_URL = sanitizeText(process.env.PUBLIC_APP_URL || '', 255).replace(/\/+$/, '');
const INCLUDED_STUDENT_LIMIT = Number.parseInt(process.env.ASAAS_INCLUDED_STUDENT_LIMIT || '15', 10) || 15;
const PRO_MONTHLY_PRICE = Number.parseFloat(process.env.ASAAS_PRO_MONTHLY_PRICE || '97.90');
const EXTRA_STUDENT_MONTHLY_PRICE = Number.parseFloat(process.env.ASAAS_EXTRA_STUDENT_MONTHLY_PRICE || '9.70');
const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const REVERSAL_EVENTS = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED']);

let tablesEnsured = false;

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;
const getExtraStudentPrice = () => (
  Number.isFinite(EXTRA_STUDENT_MONTHLY_PRICE) && EXTRA_STUDENT_MONTHLY_PRICE > 0
    ? EXTRA_STUDENT_MONTHLY_PRICE
    : 9.70
);
const getPlanMonthlyAmount = (studentLimit) => roundCurrency(
  (Number.isFinite(PRO_MONTHLY_PRICE) ? PRO_MONTHLY_PRICE : 97.90)
  + Math.max(0, Number(studentLimit || 0) - INCLUDED_STUDENT_LIMIT) * getExtraStudentPrice()
);
const calculateSeatUpgrade = ({ currentLimit, quantity }) => {
  const normalizedLimit = Math.max(INCLUDED_STUDENT_LIMIT, Math.round(Number(currentLimit) || 0));
  const normalizedQuantity = Math.round(Number(quantity) || 0);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1 || normalizedQuantity > 500) {
    throw Object.assign(new Error('Escolha entre 1 e 500 vagas adicionais.'), { statusCode: 400 });
  }
  return {
    currentLimit: normalizedLimit,
    quantity: normalizedQuantity,
    targetLimit: normalizedLimit + normalizedQuantity,
    unitPrice: getExtraStudentPrice(),
    amount: roundCurrency(normalizedQuantity * getExtraStudentPrice())
  };
};

const ensureStudentSeatUpgradeTables = async () => {
  if (tablesEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_seat_upgrade_orders (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quantity INT NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12,2) NOT NULL,
      amount_brl NUMERIC(12,2) NOT NULL,
      previous_student_limit INT NOT NULL,
      target_student_limit INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      external_reference TEXT NOT NULL UNIQUE,
      provider_checkout_id TEXT,
      provider_payment_id TEXT,
      checkout_url TEXT,
      expires_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      reversed_at TIMESTAMPTZ,
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_student_seat_upgrade_orders_user
    ON student_seat_upgrade_orders(user_id, status, created_at DESC)`);
  tablesEnsured = true;
};

const checkoutUrlFromResponse = (checkout) => {
  if (checkout?.link) return checkout.link;
  if (!checkout?.id) return '';
  return `${ASAAS_ENV === 'production' ? 'https://www.asaas.com' : 'https://sandbox.asaas.com'}/checkoutSession/show/${encodeURIComponent(checkout.id)}`;
};

const serializeOrder = (row) => ({
  id: row.id,
  quantity: Number(row.quantity),
  unitPrice: Number(row.unit_price),
  amount: Number(row.amount_brl),
  previousStudentLimit: Number(row.previous_student_limit),
  targetStudentLimit: Number(row.target_student_limit),
  status: row.status,
  checkoutUrl: row.checkout_url || null,
  expiresAt: row.expires_at,
  paidAt: row.paid_at,
  createdAt: row.created_at
});

const createStudentSeatUpgradeCheckout = async (req, quantity) => {
  await ensureStudentSeatUpgradeTables();
  if (req.user?.role !== 'professor') {
    throw Object.assign(new Error('Somente professores podem adicionar vagas.'), { statusCode: 403 });
  }
  if (!ASAAS_API_KEY) {
    throw Object.assign(new Error('A compra de vagas ainda não foi configurada no Asaas.'), { statusCode: 503 });
  }
  const { rows: userRows } = await db.query(
    `SELECT id, student_limit FROM users WHERE id=$1 AND role='professor' AND is_active=TRUE`,
    [req.user.id]
  );
  if (!userRows[0]) throw Object.assign(new Error('Professor não encontrado ou desativado.'), { statusCode: 404 });
  const purchase = calculateSeatUpgrade({ currentLimit: userRows[0].student_limit, quantity });
  const { rows: reusableRows } = await db.query(
    `SELECT * FROM student_seat_upgrade_orders
      WHERE user_id=$1 AND quantity=$2 AND target_student_limit=$3
        AND status='PENDING' AND expires_at > NOW() AND checkout_url IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [req.user.id, purchase.quantity, purchase.targetLimit]
  );
  if (reusableRows[0]) return { order: serializeOrder(reusableRows[0]), reused: true };

  const orderId = crypto.randomUUID();
  const externalReference = `student-seats:${orderId}:${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.query(
    `INSERT INTO student_seat_upgrade_orders (
       id,user_id,quantity,unit_price,amount_brl,previous_student_limit,target_student_limit,
       status,external_reference,expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9)`,
    [orderId, req.user.id, purchase.quantity, purchase.unitPrice, purchase.amount,
      purchase.currentLimit, purchase.targetLimit, externalReference, expiresAt]
  );
  const payload = {
    billingTypes: ['PIX', 'CREDIT_CARD'],
    chargeTypes: ['DETACHED'],
    minutesToExpire: 60,
    externalReference,
    items: [{
      externalReference: `student-seats:${orderId}`,
      name: `${purchase.quantity} vaga(s) adicional(is)`.slice(0, 30),
      description: `Ampliação mensal do limite para ${purchase.targetLimit} alunos na Criatyve.`.slice(0, 150),
      quantity: 1,
      value: purchase.amount
    }]
  };
  if (/^https:\/\//i.test(PUBLIC_APP_URL)) {
    const callback = `${PUBLIC_APP_URL}/admin.html`;
    payload.callback = {
      successUrl: `${callback}?seatUpgrade=success&order=${encodeURIComponent(orderId)}`,
      cancelUrl: `${callback}?seatUpgrade=cancel&order=${encodeURIComponent(orderId)}`,
      expiredUrl: `${callback}?seatUpgrade=expired&order=${encodeURIComponent(orderId)}`
    };
  }
  try {
    const response = await fetch(`${ASAAS_BASE_URL}/checkouts`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': APP_NAME, access_token: ASAAS_API_KEY },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const firstError = Array.isArray(body?.errors) ? body.errors[0] : null;
      throw Object.assign(new Error(firstError?.description || 'Não foi possível criar o checkout de vagas.'), { statusCode: response.status });
    }
    const checkoutUrl = checkoutUrlFromResponse(body);
    if (!checkoutUrl) throw Object.assign(new Error('O Asaas não retornou um checkout válido.'), { statusCode: 502 });
    const { rows } = await db.query(
      `UPDATE student_seat_upgrade_orders SET provider_checkout_id=$2,checkout_url=$3,raw_payload=$4,updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [orderId, sanitizeText(body.id, 120) || null, checkoutUrl, body]
    );
    return { order: serializeOrder(rows[0]), reused: false };
  } catch (error) {
    await db.query(`UPDATE student_seat_upgrade_orders SET status='CANCELED',updated_at=NOW() WHERE id=$1`, [orderId]).catch(() => {});
    throw error;
  }
};

const getStudentSeatUpgradeOrder = async (userId, orderId) => {
  await ensureStudentSeatUpgradeTables();
  const { rows } = await db.query('SELECT * FROM student_seat_upgrade_orders WHERE id=$1 AND user_id=$2', [orderId, userId]);
  return rows[0] ? serializeOrder(rows[0]) : null;
};

const findOrder = async (payment) => {
  const { rows } = await db.query(
    `SELECT * FROM student_seat_upgrade_orders
      WHERE ($1 <> '' AND external_reference=$1)
         OR ($2 <> '' AND provider_checkout_id=$2)
         OR ($3 <> '' AND provider_payment_id=$3)
      ORDER BY created_at DESC LIMIT 1`,
    [sanitizeText(payment?.externalReference || '', 200), sanitizeText(payment?.checkoutSession || '', 120), sanitizeText(payment?.id || '', 120)]
  );
  return rows[0] || null;
};

const updateRecurringSubscriptionAmount = async (userId, studentLimit) => {
  const { rows } = await db.query(
    `SELECT id, provider_subscription_id FROM billing_subscriptions
      WHERE user_id=$1 AND provider='asaas' AND provider_subscription_id IS NOT NULL AND status='ACTIVE'
      ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  const subscription = rows[0];
  const amount = getPlanMonthlyAmount(studentLimit);
  if (!subscription?.provider_subscription_id) return;
  const response = await fetch(`${ASAAS_BASE_URL}/subscriptions/${encodeURIComponent(subscription.provider_subscription_id)}`, {
    method: 'PUT',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': APP_NAME, access_token: ASAAS_API_KEY },
    body: JSON.stringify({ value: amount, updatePendingPayments: false })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Array.isArray(body?.errors) ? body.errors[0] : null;
    throw new Error(firstError?.description || 'Não foi possível atualizar o valor mensal da assinatura no Asaas.');
  }
  await db.query('UPDATE billing_subscriptions SET amount=$2,student_limit=GREATEST(COALESCE(student_limit,0),$3),updated_at=NOW() WHERE id=$1',
    [subscription.id, amount, studentLimit]);
};

const processStudentSeatUpgradeWebhook = async (eventPayload, fetchVerifiedPayment) => {
  await ensureStudentSeatUpgradeTables();
  const eventType = sanitizeText(eventPayload?.event || '', 80).toUpperCase();
  const incomingPayment = eventPayload?.payment;
  if (!incomingPayment?.id) return null;
  const order = await findOrder(incomingPayment);
  if (!order) return null;
  if (![...PAID_EVENTS, ...REVERSAL_EVENTS].includes(eventType)) {
    return { handled: true, ignored: true, reason: 'seat-upgrade-event-not-actionable' };
  }
  const verified = await fetchVerifiedPayment(incomingPayment.id);
  if (!verified || verified.id !== incomingPayment.id) throw new Error('Não foi possível confirmar a compra de vagas diretamente no Asaas.');
  const verifiedOrder = await findOrder(verified);
  if (!verifiedOrder || verifiedOrder.id !== order.id) throw new Error('A cobrança não pertence ao pedido de vagas informado.');
  if (Number(Number(verified.value || 0).toFixed(2)) !== Number(Number(order.amount_brl).toFixed(2))) {
    throw new Error('O valor confirmado não corresponde à compra de vagas.');
  }
  if (PAID_EVENTS.has(eventType)) {
    if (!['CONFIRMED', 'RECEIVED'].includes(String(verified.status || '').toUpperCase())) {
      throw new Error('A compra de vagas ainda não foi confirmada pelo Asaas.');
    }
    if (order.status !== 'PAID') await updateRecurringSubscriptionAmount(order.user_id, order.target_student_limit);
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM student_seat_upgrade_orders WHERE id=$1 FOR UPDATE', [order.id]);
    const locked = rows[0];
    if (PAID_EVENTS.has(eventType)) {
      await client.query('UPDATE users SET student_limit=GREATEST(COALESCE(student_limit,0),$2) WHERE id=$1 AND role=\'professor\'', [locked.user_id, locked.target_student_limit]);
      await client.query(`UPDATE student_seat_upgrade_orders SET status='PAID',provider_payment_id=$2,paid_at=COALESCE(paid_at,NOW()),raw_payload=$3,updated_at=NOW() WHERE id=$1`, [locked.id, verified.id, eventPayload]);
    } else {
      const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS total FROM users WHERE owner_user_id=$1 AND role='student' AND is_active=TRUE`, [locked.user_id]);
      const safeLimit = Math.max(Number(locked.previous_student_limit), Number(countRows[0]?.total || 0));
      await client.query('UPDATE users SET student_limit=$2 WHERE id=$1 AND role=\'professor\'', [locked.user_id, safeLimit]);
      await client.query(`UPDATE student_seat_upgrade_orders SET status=$2,reversed_at=COALESCE(reversed_at,NOW()),raw_payload=$3,updated_at=NOW() WHERE id=$1`, [locked.id, eventType === 'PAYMENT_CHARGEBACK_REQUESTED' ? 'CHARGEBACK' : 'REFUNDED', eventPayload]);
    }
    await client.query('COMMIT');
    return { handled: true, processed: true, orderId: order.id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  calculateSeatUpgrade,
  createStudentSeatUpgradeCheckout,
  ensureStudentSeatUpgradeTables,
  getExtraStudentPrice,
  getStudentSeatUpgradeOrder,
  processStudentSeatUpgradeWebhook
};
