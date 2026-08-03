const assert = require('assert');

const state = {
  balance: 10,
  ledger: new Map(),
  locked: false,
  waiters: []
};

const acquireLock = () => new Promise((resolve) => {
  if (!state.locked) {
    state.locked = true;
    resolve();
    return;
  }
  state.waiters.push(resolve);
});

const releaseLock = () => {
  const next = state.waiters.shift();
  if (next) {
    next();
    return;
  }
  state.locked = false;
};

const query = async (sql, params = [], client = null) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  if (text === 'BEGIN') return { rows: [] };
  if (text === 'COMMIT' || text === 'ROLLBACK') {
    if (client?.hasLock) {
      client.hasLock = false;
      releaseLock();
    }
    return { rows: [] };
  }
  if (text.includes('FROM platform_credit_ledger WHERE idempotency_key')) {
    const movement = state.ledger.get(params[0]);
    return { rows: movement ? [{ id: movement.id, balance_after: movement.balance }] : [] };
  }
  if (text.includes('FROM users WHERE id=$1 FOR UPDATE')) {
    await acquireLock();
    client.hasLock = true;
    return { rows: [{ platform_credits: state.balance, is_active: true, role: 'professor' }] };
  }
  if (text.startsWith('UPDATE users SET platform_credits=')) {
    state.balance = Number(params[1]);
    return { rows: [] };
  }
  if (text.startsWith('INSERT INTO platform_credit_ledger')) {
    state.ledger.set(params[7], { id: params[0], balance: Number(params[3]) });
    return { rows: [] };
  }
  if (text.includes('SELECT * FROM platform_credit_settings')) {
    return { rows: [{ text_cost: 0.5, image_cost: 1, three_d_import_cost: 5 }] };
  }
  return { rows: [], rowCount: 0 };
};

const fakeDb = {
  query: (sql, params) => query(sql, params),
  getClient: async () => {
    const client = { hasLock: false };
    client.query = (sql, params) => query(sql, params, client);
    client.release = () => {
      if (client.hasLock) {
        client.hasLock = false;
        releaseLock();
      }
    };
    return client;
  }
};

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
const {
  MINIMUM_TOPUP_BRL,
  applyCreditChange,
  normalizeCredits,
  saveCreditPackage
} = require('../src/platformCredits');

const run = async () => {
  assert.strictEqual(MINIMUM_TOPUP_BRL, 30);
  assert.strictEqual(normalizeCredits(5.678), 5.68);

  const operations = await Promise.allSettled([
    applyCreditChange({
      userId: 'professor-1',
      amount: -7,
      operationType: 'test_consume',
      idempotencyKey: 'concurrent-a',
      requireSufficient: true
    }),
    applyCreditChange({
      userId: 'professor-1',
      amount: -7,
      operationType: 'test_consume',
      idempotencyKey: 'concurrent-b',
      requireSufficient: true
    })
  ]);
  assert.strictEqual(operations.filter((item) => item.status === 'fulfilled').length, 1);
  assert.strictEqual(operations.filter((item) => item.status === 'rejected').length, 1);
  assert.strictEqual(state.balance, 3);

  const duplicate = await applyCreditChange({
    userId: 'professor-1',
    amount: -7,
    operationType: 'test_consume',
    idempotencyKey: 'concurrent-a',
    requireSufficient: true
  });
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(state.balance, 3);

  await applyCreditChange({
    userId: 'professor-1',
    amount: -10,
    operationType: 'chargeback',
    idempotencyKey: 'chargeback-a',
    requireSufficient: false
  });
  assert.strictEqual(state.balance, -7);

  await assert.rejects(
    saveCreditPackage('admin-1', { name: 'Inválido', price: 29.99, credits: 100 }),
    /preço mínimo/i
  );
  console.log('platformCredits tests: ok');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
