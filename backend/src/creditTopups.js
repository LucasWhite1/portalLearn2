const crypto = require('crypto');
const db = require('./db');
const {
  MINIMUM_TOPUP_BRL,
  applyCreditChange,
  ensurePlatformCreditTables
} = require('./platformCredits');
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
const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const REVERSAL_EVENTS = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED']);

const checkoutUrlFromResponse = (checkout) => {
  if (checkout?.link) return checkout.link;
  if (!checkout?.id) return '';
  return `${ASAAS_ENV === 'production' ? 'https://www.asaas.com' : 'https://sandbox.asaas.com'}/checkoutSession/show/${encodeURIComponent(checkout.id)}`;
};

const serializeOrder = (row) => ({
  id: row.id,
  packageName: row.package_name,
  amount: Number(row.amount_brl),
  credits: Number(row.credits),
  status: row.status,
  checkoutUrl: row.checkout_url || null,
  expiresAt: row.expires_at,
  paidAt: row.paid_at,
  createdAt: row.created_at
});

const createCreditTopupCheckout = async (req, packageId) => {
  await ensurePlatformCreditTables();
  if (req.user?.role !== 'professor') {
    throw Object.assign(new Error('Somente professores podem recarregar créditos.'), { statusCode: 403 });
  }
  if (!ASAAS_API_KEY) {
    throw Object.assign(new Error('A recarga ainda não foi configurada no Asaas.'), { statusCode: 503 });
  }
  const { rows: packageRows } = await db.query(
    'SELECT * FROM credit_packages WHERE id=$1 AND is_active=TRUE',
    [packageId]
  );
  const creditPackage = packageRows[0];
  if (!creditPackage || Number(creditPackage.price_brl) < MINIMUM_TOPUP_BRL) {
    throw Object.assign(new Error('Pacote de créditos indisponível.'), { statusCode: 404 });
  }
  const { rows: reusableRows } = await db.query(
    `SELECT * FROM credit_topup_orders
      WHERE user_id=$1 AND package_id=$2 AND status='PENDING' AND expires_at > NOW()
        AND checkout_url IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [req.user.id, creditPackage.id]
  );
  if (reusableRows[0]) return { order: serializeOrder(reusableRows[0]), reused: true };

  const orderId = crypto.randomUUID();
  const externalReference = `credits:${orderId}:${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.query(
    `INSERT INTO credit_topup_orders (
       id,user_id,package_id,package_name,amount_brl,credits,status,external_reference,expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8)`,
    [
      orderId,
      req.user.id,
      creditPackage.id,
      creditPackage.name,
      creditPackage.price_brl,
      creditPackage.credits,
      externalReference,
      expiresAt
    ]
  );
  const payload = {
    billingTypes: ['PIX', 'CREDIT_CARD'],
    chargeTypes: ['DETACHED'],
    minutesToExpire: 60,
    externalReference,
    items: [{
      externalReference: `credit-package:${creditPackage.id}`,
      name: sanitizeText(creditPackage.name, 30),
      description: `${Number(creditPackage.credits)} créditos da plataforma Criatyve`.slice(0, 150),
      quantity: 1,
      value: Number(creditPackage.price_brl)
    }]
  };
  if (/^https:\/\//i.test(PUBLIC_APP_URL)) {
    const callback = `${PUBLIC_APP_URL}/admin.html`;
    payload.callback = {
      successUrl: `${callback}?creditTopup=success&order=${encodeURIComponent(orderId)}`,
      cancelUrl: `${callback}?creditTopup=cancel&order=${encodeURIComponent(orderId)}`,
      expiredUrl: `${callback}?creditTopup=expired&order=${encodeURIComponent(orderId)}`
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
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const firstError = Array.isArray(body?.errors) ? body.errors[0] : null;
      throw Object.assign(new Error(firstError?.description || 'Não foi possível criar o checkout de créditos.'), {
        statusCode: response.status
      });
    }
    const checkoutUrl = checkoutUrlFromResponse(body);
    if (!checkoutUrl) throw Object.assign(new Error('O Asaas não retornou um checkout válido.'), { statusCode: 502 });
    const { rows } = await db.query(
      `UPDATE credit_topup_orders SET provider_checkout_id=$2,checkout_url=$3,raw_payload=$4,updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [orderId, sanitizeText(body.id, 120) || null, checkoutUrl, body]
    );
    return { order: serializeOrder(rows[0]), reused: false };
  } catch (error) {
    await db.query(
      `UPDATE credit_topup_orders SET status='CANCELED',updated_at=NOW() WHERE id=$1`,
      [orderId]
    ).catch(() => {});
    throw error;
  }
};

const getCreditTopupOrder = async (userId, orderId) => {
  await ensurePlatformCreditTables();
  const { rows } = await db.query(
    'SELECT * FROM credit_topup_orders WHERE id=$1 AND user_id=$2',
    [orderId, userId]
  );
  return rows[0] ? serializeOrder(rows[0]) : null;
};

const findTopupOrder = async (payment) => {
  const externalReference = sanitizeText(payment?.externalReference || '', 200);
  const checkoutId = sanitizeText(payment?.checkoutSession || '', 120);
  const paymentId = sanitizeText(payment?.id || '', 120);
  const { rows } = await db.query(
    `SELECT * FROM credit_topup_orders
      WHERE ($1 <> '' AND external_reference=$1)
         OR ($2 <> '' AND provider_checkout_id=$2)
         OR ($3 <> '' AND provider_payment_id=$3)
      ORDER BY created_at DESC LIMIT 1`,
    [externalReference, checkoutId, paymentId]
  );
  return rows[0] || null;
};

const processCreditTopupWebhook = async (eventPayload, fetchVerifiedPayment) => {
  await ensurePlatformCreditTables();
  const eventType = sanitizeText(eventPayload?.event || '', 80).toUpperCase();
  const incomingPayment = eventPayload?.payment;
  if (!incomingPayment?.id) return null;
  const order = await findTopupOrder(incomingPayment);
  if (!order) return null;
  if (![...PAID_EVENTS, ...REVERSAL_EVENTS].includes(eventType)) {
    return { handled: true, ignored: true, reason: 'topup-event-not-actionable' };
  }
  const verified = await fetchVerifiedPayment(incomingPayment.id);
  if (!verified || verified.id !== incomingPayment.id) {
    throw new Error('Não foi possível confirmar a recarga diretamente no Asaas.');
  }
  const verifiedOrder = await findTopupOrder(verified);
  if (!verifiedOrder || verifiedOrder.id !== order.id) {
    throw new Error('A cobrança não pertence ao pedido de recarga informado.');
  }
  if (
    Number(Number(verified.value || 0).toFixed(2)) !== Number(Number(order.amount_brl).toFixed(2))
    || (verified.checkoutSession && order.provider_checkout_id && verified.checkoutSession !== order.provider_checkout_id)
  ) {
    throw new Error('O valor ou checkout confirmado não corresponde ao pacote de créditos.');
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: lockedRows } = await client.query(
      'SELECT * FROM credit_topup_orders WHERE id=$1 FOR UPDATE',
      [order.id]
    );
    const locked = lockedRows[0];
    if (PAID_EVENTS.has(eventType)) {
      if (!['CONFIRMED', 'RECEIVED'].includes(String(verified.status || '').toUpperCase())) {
        throw new Error('A recarga ainda não foi confirmada pelo Asaas.');
      }
      await applyCreditChange({
        userId: locked.user_id,
        amount: Number(locked.credits),
        operationType: 'topup_paid',
        idempotencyKey: `topup:${locked.id}`,
        referenceType: 'credit_topup_order',
        referenceId: locked.id,
        metadata: { amountBrl: Number(locked.amount_brl), packageName: locked.package_name }
      }, client);
      await client.query(
        `UPDATE credit_topup_orders SET status='PAID',provider_payment_id=$2,paid_at=COALESCE(paid_at,NOW()),
          raw_payload=$3,updated_at=NOW() WHERE id=$1`,
        [locked.id, verified.id, eventPayload]
      );
    } else {
      if (locked.status === 'PAID' || ['REFUNDED', 'CHARGEBACK'].includes(locked.status)) {
        await applyCreditChange({
          userId: locked.user_id,
          amount: -Number(locked.credits),
          operationType: eventType === 'PAYMENT_CHARGEBACK_REQUESTED' ? 'topup_chargeback' : 'topup_refund',
          idempotencyKey: `topup-reversal:${locked.id}`,
          referenceType: 'credit_topup_order',
          referenceId: locked.id,
          metadata: { eventType }
        }, client);
      } else {
        throw new Error('A recarga não foi creditada e não pode ser revertida.');
      }
      await client.query(
        `UPDATE credit_topup_orders SET status=$2,reversed_at=COALESCE(reversed_at,NOW()),raw_payload=$3,updated_at=NOW()
          WHERE id=$1`,
        [locked.id, eventType === 'PAYMENT_CHARGEBACK_REQUESTED' ? 'CHARGEBACK' : 'REFUNDED', eventPayload]
      );
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
  createCreditTopupCheckout,
  getCreditTopupOrder,
  processCreditTopupWebhook
};
