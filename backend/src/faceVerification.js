const crypto = require('node:crypto');
const db = require('./db');

const FACE_SCHEMA_VERSION = 1;
const FACE_CONSENT_VERSION = 'face-consent-2026-07';
const FACE_MODEL_VERSION = process.env.FACE_MODEL_VERSION || 'opencv-sface-2021dec-mediapipe-v2';
const SESSION_TTL_MS = 2 * 60 * 1000;
const ENTRY_GRANT_TTL_MS = 10 * 60 * 1000;
const PERIODIC_GRANT_TTL_MS = 15 * 60 * 1000;
const COMPLETION_GRANT_TTL_MS = 5 * 60 * 1000;
const MANUAL_GRANT_TTL_MS = 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
let schemaPromise = null;

const FACE_CHALLENGES = [
  ['blink', 'turn_left'],
  ['turn_right', 'blink'],
  ['turn_left', 'turn_right'],
  ['blink', 'turn_right']
];

const normalizeFaceSettings = (moduleSettings = {}) => {
  const raw = moduleSettings?.faceVerification;
  const enabled = Boolean(raw?.enabled) && !Boolean(moduleSettings?.isPublic);
  return {
    enabled,
    verifyOnEntry: enabled && raw?.verifyOnEntry !== false,
    verifyDuringModule: enabled && Boolean(raw?.verifyDuringModule),
    verifyOnCompletion: enabled && Boolean(raw?.verifyOnCompletion),
    schemaVersion: FACE_SCHEMA_VERSION
  };
};

const isFaceProtectedBuilderData = (builderData = {}) =>
  normalizeFaceSettings(builderData?.moduleSettings).enabled;

const getEncryptionKey = () => {
  const raw = String(process.env.BIOMETRIC_DATA_KEY || '').trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    try {
      key = Buffer.from(raw, 'base64');
    } catch (error) {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    const error = new Error('BIOMETRIC_DATA_KEY deve conter exatamente 32 bytes em hexadecimal ou base64.');
    error.statusCode = 503;
    error.code = 'BIOMETRIC_KEY_NOT_CONFIGURED';
    throw error;
  }
  return key;
};

const encryptBuffer = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
};

const decryptBuffer = ({ ciphertext, iv, tag }) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

const ensureFaceVerificationSchema = async () => {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS student_face_profiles (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        embedding_ciphertext BYTEA NOT NULL,
        embedding_iv BYTEA NOT NULL,
        embedding_tag BYTEA NOT NULL,
        model_version TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        consented_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS face_verification_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        challenge JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INT NOT NULL DEFAULT 0,
        failure_code TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_face_sessions_user
        ON face_verification_sessions(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS face_access_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        source_session_id UUID REFERENCES face_verification_sessions(id) ON DELETE SET NULL,
        granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_face_grants_lookup
        ON face_access_grants(user_id, module_id, purpose, expires_at DESC);
      CREATE TABLE IF NOT EXISTS face_review_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL UNIQUE REFERENCES face_verification_sessions(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
        owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        audit_image_ciphertext BYTEA,
        audit_image_iv BYTEA,
        audit_image_tag BYTEA,
        audit_image_mime TEXT,
        audit_image_expires_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        review_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_face_reviews_owner
        ON face_review_requests(owner_user_id, status, created_at DESC);
      CREATE TABLE IF NOT EXISTS biometric_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        student_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
};

const audit = async ({ actorUserId = null, studentUserId = null, moduleId = null, eventType, metadata = {} }) => {
  await ensureFaceVerificationSchema();
  await db.query(
    `INSERT INTO biometric_audit_log
       (actor_user_id, student_user_id, module_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId, studentUserId, moduleId, eventType, JSON.stringify(metadata)]
  );
};

const createChallenge = () => {
  const steps = FACE_CHALLENGES[crypto.randomInt(FACE_CHALLENGES.length)];
  return {
    nonce: crypto.randomBytes(24).toString('hex'),
    steps,
    schemaVersion: FACE_SCHEMA_VERSION
  };
};

const createVerificationSession = async ({ userId, moduleId = null, purpose }) => {
  await ensureFaceVerificationSchema();
  const allowedPurposes = new Set(['enrollment', 'entry', 'periodic', 'completion']);
  if (!allowedPurposes.has(purpose)) {
    const error = new Error('Finalidade de verificacao facial invalida.');
    error.statusCode = 400;
    throw error;
  }
  const { rows: blockedRows } = await db.query(
    `SELECT 1
      FROM face_review_requests
      WHERE user_id = $1
        AND module_id IS NOT DISTINCT FROM $2
        AND (
          status = 'pending'
          OR (status = 'denied' AND reviewed_at > NOW() - INTERVAL '30 minutes')
        )
      LIMIT 1`,
    [userId, moduleId]
  );
  if (blockedRows.length) {
    const error = new Error('Limite de tentativas atingido. Aguarde a revisao.');
    error.statusCode = 423;
    error.code = 'FACE_REVIEW_REQUIRED';
    throw error;
  }
  const { rows: activeRows } = await db.query(
    `SELECT id, purpose, challenge, expires_at, attempt_count
       FROM face_verification_sessions
      WHERE user_id = $1
        AND module_id IS NOT DISTINCT FROM $2
        AND purpose = $3
        AND status = 'pending'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, moduleId, purpose]
  );
  if (activeRows.length) return activeRows[0];
  const challenge = createChallenge();
  const { rows } = await db.query(
    `INSERT INTO face_verification_sessions
       (user_id, module_id, purpose, challenge, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW() + INTERVAL '2 minutes')
     RETURNING id, purpose, challenge, expires_at, attempt_count`,
    [userId, moduleId, purpose, JSON.stringify(challenge)]
  );
  return rows[0];
};

const getFaceProfile = async (userId) => {
  await ensureFaceVerificationSchema();
  const { rows } = await db.query(
    `SELECT user_id, model_version, consent_version, consented_at, status, enrolled_at, updated_at
       FROM student_face_profiles
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
};

const getDecryptedEmbedding = async (userId) => {
  const { rows } = await db.query(
    `SELECT embedding_ciphertext, embedding_iv, embedding_tag, model_version, status
       FROM student_face_profiles
      WHERE user_id = $1`,
    [userId]
  );
  const profile = rows[0];
  if (!profile || profile.status !== 'active') return null;
  return {
    embedding: JSON.parse(decryptBuffer({
      ciphertext: profile.embedding_ciphertext,
      iv: profile.embedding_iv,
      tag: profile.embedding_tag
    }).toString('utf8')),
    modelVersion: profile.model_version
  };
};

const callInferenceService = async ({ frames, challenge, referenceEmbedding = null }) => {
  const defaultServiceUrl = process.env.NODE_ENV === 'production'
    ? 'http://face-verification:8081'
    : 'http://127.0.0.1:8081';
  const baseUrl = String(process.env.FACE_SERVICE_URL || defaultServiceUrl).replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${baseUrl}/v1/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': String(process.env.FACE_SERVICE_INTERNAL_TOKEN || '')
      },
      body: JSON.stringify({
        challenge,
        referenceEmbedding,
        frames: frames.map((frame) => ({
          mimeType: frame.mimeType,
          data: frame.buffer.toString('base64')
        }))
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || 'O servico facial nao conseguiu analisar a captura.');
      error.statusCode = response.status >= 500 ? 503 : 422;
      error.code = payload?.code || 'FACE_SERVICE_ERROR';
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('A verificacao facial excedeu o tempo limite.');
      timeoutError.statusCode = 503;
      timeoutError.code = 'FACE_SERVICE_TIMEOUT';
      throw timeoutError;
    }
    if (!error.statusCode) {
      const unavailableError = new Error(
        'O servico de verificacao facial esta indisponivel. Tente novamente em alguns instantes.'
      );
      unavailableError.statusCode = 503;
      unavailableError.code = 'FACE_SERVICE_UNAVAILABLE';
      throw unavailableError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const grantDurationForPurpose = (purpose) => ({
  entry: ENTRY_GRANT_TTL_MS,
  periodic: PERIODIC_GRANT_TTL_MS,
  completion: COMPLETION_GRANT_TTL_MS,
  manual: MANUAL_GRANT_TTL_MS
}[purpose] || ENTRY_GRANT_TTL_MS);

const createAccessGrant = async ({ userId, moduleId, purpose, sessionId = null, grantedBy = null }) => {
  const expiresAt = new Date(Date.now() + grantDurationForPurpose(purpose));
  const { rows } = await db.query(
    `INSERT INTO face_access_grants
       (user_id, module_id, purpose, source_session_id, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, purpose, expires_at`,
    [userId, moduleId, purpose, sessionId, grantedBy, expiresAt]
  );
  return rows[0];
};

const hasActiveGrant = async (userId, moduleId, purposes) => {
  await ensureFaceVerificationSchema();
  const list = Array.isArray(purposes) ? purposes : [purposes];
  const { rows } = await db.query(
    `SELECT id, purpose, expires_at
       FROM face_access_grants
      WHERE user_id = $1
        AND module_id = $2
        AND purpose = ANY($3::text[])
        AND (
          purpose = 'manual'
          OR EXISTS (
            SELECT 1
              FROM student_face_profiles profile
             WHERE profile.user_id = face_access_grants.user_id
               AND profile.status = 'active'
               AND profile.model_version = $4
          )
        )
        AND expires_at > NOW()
      ORDER BY expires_at DESC
      LIMIT 1`,
    [userId, moduleId, list, FACE_MODEL_VERSION]
  );
  return rows[0] || null;
};

const getModuleFaceContext = async (userId, moduleId) => {
  await ensureFaceVerificationSchema();
  const { rows } = await db.query(
    `SELECT m.id, m.course_id, m.title, m.slug, m.description, m.builder_data, m.position, m.created_at,
            c.title AS course_title, c.owner_user_id
       FROM modules m
       JOIN courses c ON c.id = m.course_id
       JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
      WHERE m.id = $2
      LIMIT 1`,
    [userId, moduleId]
  );
  const module = rows[0];
  if (!module) return null;
  return { module, settings: normalizeFaceSettings(module.builder_data?.moduleSettings) };
};

const saveReviewAuditImage = async ({ session, imageBase64, mimeType = 'image/jpeg' }) => {
  if (!imageBase64) return;
  const image = Buffer.from(imageBase64, 'base64');
  if (!image.length || image.length > 1024 * 1024) return;
  const encrypted = encryptBuffer(image);
  const { rows } = session.module_id
    ? await db.query(
      `SELECT c.owner_user_id
         FROM modules m
         JOIN courses c ON c.id = m.course_id
        WHERE m.id = $1`,
      [session.module_id]
    )
    : await db.query(
      `SELECT owner_user_id
         FROM users
        WHERE id = $1`,
      [session.user_id]
    );
  await db.query(
    `INSERT INTO face_review_requests
       (session_id, user_id, module_id, owner_user_id, audit_image_ciphertext,
        audit_image_iv, audit_image_tag, audit_image_mime, audit_image_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '48 hours')
     ON CONFLICT (session_id) DO UPDATE
       SET audit_image_ciphertext = EXCLUDED.audit_image_ciphertext,
           audit_image_iv = EXCLUDED.audit_image_iv,
           audit_image_tag = EXCLUDED.audit_image_tag,
           audit_image_mime = EXCLUDED.audit_image_mime,
           audit_image_expires_at = EXCLUDED.audit_image_expires_at,
           updated_at = NOW()`,
    [session.id, session.user_id, session.module_id, rows[0]?.owner_user_id || null,
      encrypted.ciphertext, encrypted.iv, encrypted.tag, mimeType]
  );
};

const processVerification = async ({ userId, sessionId, frames, consentAccepted = false }) => {
  await ensureFaceVerificationSchema();
  const client = await db.getClient();
  let session;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *
         FROM face_verification_sessions
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [sessionId, userId]
    );
    session = rows[0];
    if (!session) {
      const error = new Error('Sessao facial nao encontrada.');
      error.statusCode = 404;
      throw error;
    }
    if (session.status === 'processing') {
      const error = new Error('Esta captura ja esta sendo processada.');
      error.statusCode = 409;
      throw error;
    }
    if (session.status === 'verified') {
      const error = new Error('Esta sessao facial ja foi utilizada.');
      error.statusCode = 409;
      throw error;
    }
    if (session.status === 'review_required' || Number(session.attempt_count) >= MAX_ATTEMPTS) {
      const error = new Error('Limite de tentativas atingido. Aguarde a revisao.');
      error.statusCode = 423;
      error.code = 'FACE_REVIEW_REQUIRED';
      throw error;
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE face_verification_sessions SET status = 'expired', updated_at = NOW() WHERE id = $1`, [session.id]);
      await client.query('COMMIT');
      const error = new Error('A sessao facial expirou. Inicie uma nova captura.');
      error.statusCode = 410;
      throw error;
    }
    if (session.purpose === 'enrollment' && !consentAccepted) {
      const error = new Error('O consentimento biometrico e obrigatorio.');
      error.statusCode = 400;
      throw error;
    }
    await client.query(
      `UPDATE face_verification_sessions
          SET status = 'processing', updated_at = NOW()
        WHERE id = $1`,
      [session.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {}
    throw error;
  } finally {
    client.release();
  }

  const reference = session.purpose === 'enrollment' ? null : await getDecryptedEmbedding(userId);
  if (session.purpose !== 'enrollment' && !reference) {
    await db.query(
      `UPDATE face_verification_sessions SET status = 'failed', failure_code = 'PROFILE_REQUIRED', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
    const error = new Error('Cadastre seu rosto no perfil antes de continuar.');
    error.statusCode = 428;
    error.code = 'FACE_PROFILE_REQUIRED';
    throw error;
  }
  if (session.purpose !== 'enrollment' && reference.modelVersion !== FACE_MODEL_VERSION) {
    await db.query(
      `UPDATE face_verification_sessions SET status = 'failed', failure_code = 'PROFILE_OUTDATED', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
    const error = new Error('Seu cadastro facial usa uma politica antiga. Cadastre o rosto novamente.');
    error.statusCode = 428;
    error.code = 'FACE_PROFILE_OUTDATED';
    throw error;
  }

  let result;
  try {
    result = await callInferenceService({
      frames,
      challenge: session.challenge,
      referenceEmbedding: reference?.embedding || null
    });
  } catch (error) {
    await db.query(
      `UPDATE face_verification_sessions SET status = 'pending', failure_code = $2, updated_at = NOW() WHERE id = $1`,
      [session.id, error.code || 'SERVICE_ERROR']
    );
    throw error;
  }

  if (result.verified && result.livenessPassed && Array.isArray(result.embedding)) {
    if (session.purpose === 'enrollment') {
      const encrypted = encryptBuffer(Buffer.from(JSON.stringify(result.embedding), 'utf8'));
      await db.query(
        `INSERT INTO student_face_profiles
           (user_id, embedding_ciphertext, embedding_iv, embedding_tag, model_version,
            consent_version, consented_at, status, enrolled_at, revoked_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'active', NOW(), NULL, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET embedding_ciphertext = EXCLUDED.embedding_ciphertext,
               embedding_iv = EXCLUDED.embedding_iv,
               embedding_tag = EXCLUDED.embedding_tag,
               model_version = EXCLUDED.model_version,
               consent_version = EXCLUDED.consent_version,
               consented_at = NOW(),
               status = 'active',
               enrolled_at = NOW(),
               revoked_at = NULL,
               updated_at = NOW()`,
        [userId, encrypted.ciphertext, encrypted.iv, encrypted.tag, result.modelVersion || FACE_MODEL_VERSION, FACE_CONSENT_VERSION]
      );
    } else {
      await createAccessGrant({
        userId,
        moduleId: session.module_id,
        purpose: session.purpose,
        sessionId: session.id
      });
    }
    await db.query(
      `UPDATE face_verification_sessions
          SET status = 'verified', verified_at = NOW(), failure_code = NULL, updated_at = NOW()
        WHERE id = $1`,
      [session.id]
    );
    await audit({
      actorUserId: userId,
      studentUserId: userId,
      moduleId: session.module_id,
      eventType: session.purpose === 'enrollment' ? 'face_enrolled' : 'face_verified',
      metadata: {
        purpose: session.purpose,
        matchPolicyVersion: Number(result.matchPolicy?.version) || 1,
        evaluatedFrames: Number(result.matchPolicy?.evaluatedFrames) || null,
        matchedFrames: Number(result.matchPolicy?.matchedFrames) || null
      }
    });
    return { verified: true, purpose: session.purpose };
  }

  const { rows } = await db.query(
    `UPDATE face_verification_sessions
        SET attempt_count = LEAST(3, attempt_count + 1),
            status = CASE WHEN attempt_count + 1 >= 3 THEN 'review_required' ELSE 'pending' END,
            failure_code = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [session.id, String(result.failureCode || 'FACE_NOT_CONFIRMED').slice(0, 80)]
  );
  const updated = rows[0];
  if (updated.status === 'review_required') {
    await saveReviewAuditImage({
      session: updated,
      imageBase64: result.auditImage,
      mimeType: result.auditImageMime || 'image/jpeg'
    });
  }
  await audit({
    actorUserId: userId,
    studentUserId: userId,
    moduleId: session.module_id,
    eventType: updated.status === 'review_required' ? 'face_review_requested' : 'face_verification_failed',
    metadata: { purpose: session.purpose, attempts: updated.attempt_count }
  });
  return {
    verified: false,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - Number(updated.attempt_count)),
    reviewRequired: updated.status === 'review_required',
    failureCode: updated.failure_code
  };
};

const revokeFaceProfile = async (userId) => {
  await ensureFaceVerificationSchema();
  await db.query(`DELETE FROM student_face_profiles WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM face_access_grants WHERE user_id = $1`, [userId]);
  await audit({ actorUserId: userId, studentUserId: userId, eventType: 'face_profile_revoked' });
};

const cleanupExpiredBiometricData = async () => {
  await ensureFaceVerificationSchema();
  await db.query(`
    UPDATE face_review_requests
       SET audit_image_ciphertext = NULL,
           audit_image_iv = NULL,
           audit_image_tag = NULL,
           audit_image_mime = NULL,
           updated_at = NOW()
     WHERE audit_image_expires_at <= NOW()
       AND audit_image_ciphertext IS NOT NULL;
    DELETE FROM face_access_grants WHERE expires_at < NOW() - INTERVAL '24 hours';
    UPDATE face_verification_sessions
       SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at <= NOW()
  `);
};

module.exports = {
  AUDIT_RETENTION_MS,
  FACE_CONSENT_VERSION,
  FACE_MODEL_VERSION,
  MAX_ATTEMPTS,
  audit,
  cleanupExpiredBiometricData,
  createAccessGrant,
  createVerificationSession,
  decryptBuffer,
  encryptBuffer,
  ensureFaceVerificationSchema,
  getFaceProfile,
  getModuleFaceContext,
  hasActiveGrant,
  isFaceProtectedBuilderData,
  normalizeFaceSettings,
  processVerification,
  revokeFaceProfile
};
