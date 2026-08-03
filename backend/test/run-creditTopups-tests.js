const assert = require('assert');

process.env.ASAAS_ENV = 'sandbox';
process.env.ASAAS_API_KEY = '$aact_test_only';
process.env.ASAAS_APP_NAME = 'Criatyve/Test';
process.env.PUBLIC_APP_URL = 'https://portal.example.com';

const packageRow = {
  id: '00000000-0000-4000-8000-000000000100',
  name: '100 créditos',
  price_brl: 30,
  credits: 100,
  is_active: true
};
const state = {
  order: null,
  movements: new Set(),
  credited: 0,
  checkoutPayload: null
};

const executeQuery = async (sql, params = []) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
  if (text.includes('FROM credit_packages WHERE id=$1 AND is_active=TRUE')) {
    return { rows: params[0] === packageRow.id ? [packageRow] : [] };
  }
  if (text.includes("status='PENDING' AND expires_at > NOW()")) return { rows: [] };
  if (text.startsWith('INSERT INTO credit_topup_orders')) {
    state.order = {
      id: params[0],
      user_id: params[1],
      package_id: params[2],
      package_name: params[3],
      amount_brl: Number(params[4]),
      credits: Number(params[5]),
      status: 'PENDING',
      external_reference: params[6],
      expires_at: params[7],
      checkout_url: null,
      created_at: new Date()
    };
    return { rows: [] };
  }
  if (text.startsWith('UPDATE credit_topup_orders SET provider_checkout_id=')) {
    Object.assign(state.order, {
      provider_checkout_id: params[1],
      checkout_url: params[2],
      raw_payload: params[3]
    });
    return { rows: [state.order] };
  }
  if (text.startsWith("UPDATE credit_topup_orders SET status='CANCELED'")) {
    state.order.status = 'CANCELED';
    return { rows: [] };
  }
  if (text.includes('SELECT * FROM credit_topup_orders') && text.includes('external_reference=$1')) {
    return { rows: [state.order] };
  }
  if (text.includes('SELECT * FROM credit_topup_orders WHERE id=$1 FOR UPDATE')) {
    return { rows: [state.order] };
  }
  if (text.includes("SET status='PAID'")) {
    Object.assign(state.order, {
      status: 'PAID',
      provider_payment_id: params[1],
      raw_payload: params[2]
    });
    return { rows: [] };
  }
  return { rows: [] };
};

const fakeDb = {
  query: executeQuery,
  getClient: async () => ({
    query: executeQuery,
    release: () => {}
  })
};
const fakeCredits = {
  MINIMUM_TOPUP_BRL: 30,
  ensurePlatformCreditTables: async () => {},
  applyCreditChange: async (movement) => {
    if (state.movements.has(movement.idempotencyKey)) return { duplicate: true };
    state.movements.add(movement.idempotencyKey);
    state.credited += Number(movement.amount);
    return { duplicate: false };
  }
};

const dbPath = require.resolve('../src/db');
const creditsPath = require.resolve('../src/platformCredits');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
require.cache[creditsPath] = { id: creditsPath, filename: creditsPath, loaded: true, exports: fakeCredits };

global.fetch = async (url, options) => {
  assert.strictEqual(url, 'https://api-sandbox.asaas.com/v3/checkouts');
  state.checkoutPayload = JSON.parse(options.body);
  return {
    ok: true,
    json: async () => ({ id: 'checkout-1', link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1' })
  };
};

const {
  createCreditTopupCheckout,
  processCreditTopupWebhook
} = require('../src/creditTopups');

const run = async () => {
  const result = await createCreditTopupCheckout({
    user: { id: 'professor-1', role: 'professor' },
    body: { price: 1, credits: 999999 }
  }, packageRow.id);
  assert.strictEqual(result.order.amount, 30);
  assert.strictEqual(result.order.credits, 100);
  assert.deepStrictEqual(state.checkoutPayload.billingTypes, ['PIX', 'CREDIT_CARD']);
  assert.deepStrictEqual(state.checkoutPayload.chargeTypes, ['DETACHED']);
  assert.strictEqual(state.checkoutPayload.items[0].value, 30);

  const event = {
    event: 'PAYMENT_CONFIRMED',
    payment: { id: 'payment-1', checkoutSession: 'checkout-1' }
  };
  const verify = async () => ({
    id: 'payment-1',
    checkoutSession: 'checkout-1',
    value: 30,
    status: 'CONFIRMED'
  });
  await processCreditTopupWebhook(event, verify);
  await processCreditTopupWebhook(event, verify);
  assert.strictEqual(state.credited, 100);
  assert.strictEqual(state.movements.size, 1);

  await assert.rejects(
    processCreditTopupWebhook({
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'payment-2', checkoutSession: 'checkout-1' }
    }, async () => ({
      id: 'payment-2',
      checkoutSession: 'checkout-1',
      value: 29,
      status: 'CONFIRMED'
    })),
    /valor ou checkout/i
  );
  console.log('creditTopups tests: ok');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
