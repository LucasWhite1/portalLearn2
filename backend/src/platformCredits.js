const crypto = require('crypto');
const db = require('./db');
const { sanitizeText } = require('./security');

const CREDIT_TYPES = new Set(['text', 'image', 'three_d_import']);
const MINIMUM_TOPUP_BRL = 30;
let tablesReadyPromise = null;

const normalizeCredits = (value, { allowNegative = true } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Number(numeric.toFixed(2));
  if (!allowNegative && normalized < 0) return null;
  return normalized;
};

const ensurePlatformCreditTables = async () => {
  if (tablesReadyPromise) return tablesReadyPromise;
  tablesReadyPromise = (async () => {
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name='ai_credits'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name='platform_credits'
        ) THEN
          ALTER TABLE users RENAME COLUMN ai_credits TO platform_credits;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name='ai_credits_updated_at'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name='platform_credits_updated_at'
        ) THEN
          ALTER TABLE users RENAME COLUMN ai_credits_updated_at TO platform_credits_updated_at;
        END IF;
      END $$;
    `);
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_credits NUMERIC(12,2) NOT NULL DEFAULT 0');
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_credits_updated_at TIMESTAMPTZ DEFAULT NOW()');
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name='ai_credits'
        ) THEN
          UPDATE users
             SET platform_credits = CASE
                   WHEN platform_credits = 0 AND ai_credits <> 0 THEN ai_credits
                   ELSE platform_credits
                 END;
          ALTER TABLE users DROP COLUMN ai_credits;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name='ai_credits_updated_at'
        ) THEN
          UPDATE users
             SET platform_credits_updated_at = COALESCE(platform_credits_updated_at, ai_credits_updated_at, NOW());
          ALTER TABLE users DROP COLUMN ai_credits_updated_at;
        END IF;
      END $$;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS platform_credit_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        text_cost NUMERIC(12,2) NOT NULL DEFAULT 0.5 CHECK (text_cost > 0),
        image_cost NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (image_cost > 0),
        three_d_import_cost NUMERIC(12,2) NOT NULL DEFAULT 5 CHECK (three_d_import_cost > 0),
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      INSERT INTO platform_credit_settings (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);
    try {
      await db.query(`
        UPDATE platform_credit_settings settings
           SET text_cost = source.ai_credit_cost_per_call,
               image_cost = source.image_ai_credit_cost_per_call
          FROM (
            SELECT ai.ai_credit_cost_per_call, ai.image_ai_credit_cost_per_call
              FROM admin_ai_settings ai
              JOIN users admin_user ON admin_user.id = ai.admin_user_id
             WHERE admin_user.role = 'admin'
             ORDER BY ai.updated_at DESC
             LIMIT 1
          ) source
         WHERE settings.id = 1
           AND settings.updated_by IS NULL
      `);
    } catch {
      // Older databases may not have the AI settings table yet.
    }
    try {
      await db.query(`
        ALTER TABLE admin_ai_settings
          DROP COLUMN IF EXISTS ai_credit_cost_per_call,
          DROP COLUMN IF EXISTS image_ai_credit_cost_per_call
      `);
    } catch {
      // Fresh databases may create AI settings after the credit subsystem.
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS platform_credit_ledger (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
        balance_after NUMERIC(12,2) NOT NULL,
        operation_type TEXT NOT NULL,
        reference_type TEXT,
        reference_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_platform_credit_ledger_user ON platform_credit_ledger(user_id, created_at DESC)');
    await db.query(`
      CREATE OR REPLACE FUNCTION reject_platform_credit_ledger_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'platform_credit_ledger is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS platform_credit_ledger_immutable ON platform_credit_ledger;
      CREATE TRIGGER platform_credit_ledger_immutable
        BEFORE UPDATE OR DELETE ON platform_credit_ledger
        FOR EACH ROW EXECUTE FUNCTION reject_platform_credit_ledger_mutation()
    `);
    await db.query(`
      INSERT INTO platform_credit_ledger (
        id,user_id,amount,balance_after,operation_type,reference_type,reference_id,idempotency_key,metadata
      )
      SELECT md5('platform-credit-opening:' || user_account.id::text)::uuid,
             user_account.id, user_account.platform_credits, user_account.platform_credits,
             'migration_opening_balance', 'user', user_account.id::text,
             'migration:opening-balance:' || user_account.id::text,
             '{"source":"ai_credits"}'::jsonb
        FROM users user_account
       WHERE user_account.role = 'professor'
         AND user_account.platform_credits <> 0
      ON CONFLICT (idempotency_key) DO NOTHING
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS credit_packages (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        price_brl NUMERIC(12,2) NOT NULL CHECK (price_brl >= 30),
        credits NUMERIC(12,2) NOT NULL CHECK (credits > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      INSERT INTO credit_packages (id, name, price_brl, credits, is_active, sort_order)
      SELECT '00000000-0000-4000-8000-000000000100'::uuid, '100 créditos', 30, 100, TRUE, 10
      WHERE NOT EXISTS (SELECT 1 FROM credit_packages)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS credit_topup_orders (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        package_id UUID REFERENCES credit_packages(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL,
        amount_brl NUMERIC(12,2) NOT NULL CHECK (amount_brl >= 30),
        credits NUMERIC(12,2) NOT NULL CHECK (credits > 0),
        status TEXT NOT NULL DEFAULT 'PENDING',
        external_reference TEXT NOT NULL UNIQUE,
        provider_checkout_id TEXT,
        provider_payment_id TEXT UNIQUE,
        checkout_url TEXT,
        expires_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        reversed_at TIMESTAMPTZ,
        raw_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELED','REFUNDED','CHARGEBACK'))
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_credit_topup_orders_user ON credit_topup_orders(user_id, created_at DESC)');
  })().catch((error) => {
    tablesReadyPromise = null;
    throw error;
  });
  return tablesReadyPromise;
};

const serializeCosts = (row) => ({
  text: Number(row?.text_cost || 0.5),
  image: Number(row?.image_cost || 1),
  threeDImport: Number(row?.three_d_import_cost || 5)
});

const getCreditCosts = async (client = db) => {
  await ensurePlatformCreditTables();
  const { rows } = await client.query('SELECT * FROM platform_credit_settings WHERE id = 1');
  return serializeCosts(rows[0]);
};

const updateCreditCosts = async (adminUserId, values) => {
  await ensurePlatformCreditTables();
  const text = normalizeCredits(values?.text, { allowNegative: false });
  const image = normalizeCredits(values?.image, { allowNegative: false });
  const threeDImport = normalizeCredits(values?.threeDImport, { allowNegative: false });
  if (!text || !image || !threeDImport) {
    throw Object.assign(new Error('Todos os custos devem ser maiores que zero.'), { statusCode: 400 });
  }
  const { rows } = await db.query(
    `UPDATE platform_credit_settings
        SET text_cost=$1, image_cost=$2, three_d_import_cost=$3, updated_by=$4, updated_at=NOW()
      WHERE id=1
      RETURNING *`,
    [text, image, threeDImport, adminUserId]
  );
  return serializeCosts(rows[0]);
};

const getPlatformCreditStatus = async (userId) => {
  await ensurePlatformCreditTables();
  const { rows } = await db.query(
    `SELECT platform_credits, platform_credits_updated_at, role, is_active
       FROM users WHERE id=$1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    platformCredits: Number(rows[0].platform_credits || 0),
    platformCreditsUpdatedAt: rows[0].platform_credits_updated_at || null,
    role: rows[0].role,
    isActive: rows[0].is_active !== false
  };
};

const applyCreditChange = async ({
  userId,
  amount,
  operationType,
  idempotencyKey,
  referenceType = null,
  referenceId = null,
  metadata = {},
  requireSufficient = false
}, externalClient = null) => {
  await ensurePlatformCreditTables();
  const normalizedAmount = normalizeCredits(amount);
  if (!normalizedAmount) throw Object.assign(new Error('Movimentação de crédito inválida.'), { statusCode: 400 });
  const client = externalClient || await db.getClient();
  const ownsTransaction = !externalClient;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id, balance_after FROM platform_credit_ledger WHERE idempotency_key=$1',
      [sanitizeText(idempotencyKey, 200)]
    );
    if (existing.rows[0]) {
      if (ownsTransaction) await client.query('COMMIT');
      return { duplicate: true, ledgerId: existing.rows[0].id, balance: Number(existing.rows[0].balance_after) };
    }
    const locked = await client.query(
      `SELECT platform_credits, is_active, role FROM users WHERE id=$1 FOR UPDATE`,
      [userId]
    );
    const user = locked.rows[0];
    if (!user || user.role !== 'professor') {
      throw Object.assign(new Error('Professor não encontrado para movimentação de créditos.'), { statusCode: 404 });
    }
    const current = Number(user.platform_credits || 0);
    if (normalizedAmount < 0 && requireSufficient && (user.is_active === false || current < Math.abs(normalizedAmount))) {
      const error = new Error(user.is_active === false
        ? 'Sua conta de professor está desativada.'
        : `Saldo insuficiente. Necessário: ${Math.abs(normalizedAmount)} crédito(s).`);
      error.statusCode = 403;
      error.code = 'PLATFORM_CREDITS_EXHAUSTED';
      error.platformCredits = current;
      error.requiredCredits = Math.abs(normalizedAmount);
      throw error;
    }
    const balance = Number((current + normalizedAmount).toFixed(2));
    await client.query(
      `UPDATE users SET platform_credits=$2, platform_credits_updated_at=NOW() WHERE id=$1`,
      [userId, balance]
    );
    const ledgerId = crypto.randomUUID();
    await client.query(
      `INSERT INTO platform_credit_ledger (
         id,user_id,amount,balance_after,operation_type,reference_type,reference_id,idempotency_key,metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        ledgerId,
        userId,
        normalizedAmount,
        balance,
        sanitizeText(operationType, 80),
        referenceType ? sanitizeText(referenceType, 80) : null,
        referenceId ? sanitizeText(referenceId, 200) : null,
        sanitizeText(idempotencyKey, 200),
        JSON.stringify(metadata || {})
      ]
    );
    if (ownsTransaction) await client.query('COMMIT');
    return { duplicate: false, ledgerId, balance };
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
};

const consumePlatformCredits = async (req, feature, creditType, options = {}) => {
  if (req.user?.role !== 'professor') {
    return { charged: false, remainingCredits: null, totalCost: 0, refund: async () => {} };
  }
  if (!CREDIT_TYPES.has(creditType)) throw new Error('Tipo de consumo de crédito inválido.');
  const costs = await getCreditCosts();
  const cost = creditType === 'image' ? costs.image : creditType === 'three_d_import' ? costs.threeDImport : costs.text;
  const units = Math.max(1, Math.min(50, Math.trunc(Number(options.units) || 1)));
  const totalCost = Number((cost * units).toFixed(2));
  const operationId = options.operationId || crypto.randomUUID();
  const debit = await applyCreditChange({
    userId: req.user.id,
    amount: -totalCost,
    operationType: `consume_${creditType}`,
    idempotencyKey: `consume:${operationId}`,
    referenceType: options.referenceType || 'feature',
    referenceId: options.referenceId || operationId,
    metadata: { feature: sanitizeText(feature, 160), units, unitCost: cost },
    requireSufficient: true
  });
  let refunded = false;
  return {
    charged: true,
    operationId,
    ledgerId: debit.ledgerId,
    remainingCredits: debit.balance,
    totalCost,
    costPerUnit: cost,
    refund: async (reason = 'operation_failed') => {
      if (refunded) return;
      refunded = true;
      await applyCreditChange({
        userId: req.user.id,
        amount: totalCost,
        operationType: `refund_${creditType}`,
        idempotencyKey: `refund:${debit.ledgerId}`,
        referenceType: 'ledger',
        referenceId: debit.ledgerId,
        metadata: { reason: sanitizeText(reason, 160) }
      });
    }
  };
};

const serializePackage = (row) => ({
  id: row.id,
  name: row.name,
  price: Number(row.price_brl),
  credits: Number(row.credits),
  active: row.is_active === true,
  sortOrder: Number(row.sort_order || 0),
  updatedAt: row.updated_at
});

const listCreditPackages = async ({ activeOnly = false } = {}) => {
  await ensurePlatformCreditTables();
  const { rows } = await db.query(
    `SELECT * FROM credit_packages ${activeOnly ? 'WHERE is_active=TRUE' : ''}
      ORDER BY sort_order, price_brl, created_at`
  );
  return rows.map(serializePackage);
};

const saveCreditPackage = async (adminUserId, input, packageId = null) => {
  await ensurePlatformCreditTables();
  const name = sanitizeText(input?.name, 80);
  const price = normalizeCredits(input?.price, { allowNegative: false });
  const credits = normalizeCredits(input?.credits, { allowNegative: false });
  const active = input?.active !== false;
  const sortOrder = Math.max(-10000, Math.min(10000, Math.trunc(Number(input?.sortOrder) || 0)));
  if (!name || price === null || price < MINIMUM_TOPUP_BRL || !credits) {
    throw Object.assign(new Error('Pacote inválido. O preço mínimo é R$ 30 e os créditos devem ser positivos.'), {
      statusCode: 400
    });
  }
  const { rows } = packageId
    ? await db.query(
      `UPDATE credit_packages SET name=$1,price_brl=$2,credits=$3,is_active=$4,sort_order=$5,updated_at=NOW()
        WHERE id=$6 RETURNING *`,
      [name, price, credits, active, sortOrder, packageId]
    )
    : await db.query(
      `INSERT INTO credit_packages (id,name,price_brl,credits,is_active,sort_order,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [crypto.randomUUID(), name, price, credits, active, sortOrder, adminUserId]
    );
  if (!rows[0]) throw Object.assign(new Error('Pacote não encontrado.'), { statusCode: 404 });
  return serializePackage(rows[0]);
};

module.exports = {
  MINIMUM_TOPUP_BRL,
  applyCreditChange,
  consumePlatformCredits,
  ensurePlatformCreditTables,
  getCreditCosts,
  getPlatformCreditStatus,
  listCreditPackages,
  normalizeCredits,
  saveCreditPackage,
  updateCreditCosts
};
