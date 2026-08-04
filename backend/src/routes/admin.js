const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { encryptApiKey, encryptSecret } = require('../aiConfigCrypto');
const {
  buildPublicAiSettings,
  editImageElementWithNanoBanana,
  proposeMagicPenActions,
  proposeAdminAssistantTurn,
  proposeNextSlideAction,
  proposeSlideExecutionPlan,
  proposeSlideActions,
  testAiConnection,
  generateBackgroundMaskWithNanoBanana,
  compareImagesWithNanoBanana
} = require('../aiProvider');
const {
  cleanHistory,
  containsSensitiveRequest,
  ensureAssistantTables,
  executeProposal,
  loadAssistantContext,
  normalizeAssistantResponse,
  redactSecrets,
  storeProposal
} = require('../adminAssistant');
const { readImageSource } = require('../pixian');
const { extractAudioFromMediaSource, transcribeMediaSource } = require('../mediaProcessing');
const { createShare, updateShare, updateThreeDTransform, deleteShare, clearDrawingStrokes, removeDrawingStroke, getShare, updateCursorPosition, listCursorPositions, removeCameraRequest } = require('../liveStageShareStore');
const {
  createThreeDAssetFromRemote,
  createThreeDAssetFromRequest,
  deleteThreeDAsset,
  ensureThreeDAssetsTable,
  getThreeDAsset,
  listThreeDAssets,
  sendThreeDAssetFile,
  serializeAsset
} = require('../threeDAssets');
const {
  getExternalThreeDModel,
  getProviderUserAgent,
  isApprovedExternalModelUrl,
  isApprovedExternalThumbnailUrl,
  searchExternalThreeDModels
} = require('../externalThreeDCatalog');
const {
  applyCreditChange,
  consumePlatformCredits,
  ensurePlatformCreditTables,
  getCreditCosts,
  getPlatformCreditStatus,
  listCreditPackages,
  saveCreditPackage,
  updateCreditCosts
} = require('../platformCredits');
const {
  createCreditTopupCheckout,
  getCreditTopupOrder
} = require('../creditTopups');
const {
  createStudentSeatUpgradeCheckout,
  getExtraStudentPrice,
  getStudentSeatUpgradeOrder
} = require('../studentSeatUpgrades');
const { ensureBillingAccessSchema, getBillingAccessState } = require('../billingAccess');
const { configureSignupPaymentPlan } = require('../studentPayments');
const { canApproveStudent } = require('../studentSignupPolicy');
const {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeSlug,
  sanitizeMediaUrl,
  sanitizeBuilderData,
  sanitizeNotificationMessage,
  getPasswordValidationError,
  createRateLimiter,
  assertSafeRemoteUrl,
  isUuid
} = require('../security');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['admin', 'professor']));
const TEMPLATE_STORE_DIR = path.resolve(__dirname, '../../../template-store');
const TEMPLATE_STORE_KEY_REGEX = /^[a-z0-9._-]+$/i;
const NOTIFICATION_FILE_DATA_URL_REGEX = /^data:(application\/pdf|application\/msword|application\/vnd\.ms-(powerpoint|excel)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet)|text\/plain|application\/zip|image\/[a-z0-9.+-]+);base64,[a-z0-9+/=\s]+$/i;
const MAX_NOTIFICATION_FILE_BYTES = 8 * 1024 * 1024;
let courseCoverColumnEnsured = false;
let courseStoreColumnEnsured = false;
let courseAccessRequestsTableEnsured = false;
let classesTableEnsured = false;
let progressEventsColumnEnsured = false;
let enrollmentProgressColumnsEnsured = false;
let adminSmtpSettingsEnsured = false;
let ownershipColumnsEnsured = false;
let professorQuotaColumnsEnsured = false;
let reportCorrectionColumnEnsured = false;
let studentSignupLinksTableEnsured = false;
const LIVE_STAGE_SHARE_ID_REGEX = /^[0-9a-f]{32}$/i;
const mediaHeavyRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyFn: (req) => `media-heavy:${req.user?.id || req.ip}`
});
const externalThreeDSearchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyFn: (req) => `external-3d-search:${req.user?.id || req.ip}`
});
const aiRequestRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => `admin-ai:${req.user?.id || req.ip}`
});
const liveThreeDTransformRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 720,
  keyFn: (req) => `live-3d:${req.user?.id || req.ip}`
});

const slugify = (value) => {
  if (!value) return '';
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

const mediaUrlToImageAttachment = async (value, fallbackName = 'imagem') => {
  const source = await readImageSource(value);
  if (!source?.mimeType || !source?.buffer) {
    return null;
  }
  return {
    mimeType: String(source.mimeType).toLowerCase(),
    data: source.buffer.toString('base64'),
    name: source.filename || fallbackName
  };
};

const sanitizeModulePayload = ({ title, description, builderData, slug }) => {
  const cleanTitle = sanitizeText(title, 180);
  const cleanDescription = sanitizeText(description || '', 4000);
  const cleanSlug = sanitizeSlug(slug || cleanTitle) || slugify(cleanTitle);
  const cleanBuilderData = sanitizeBuilderData(builderData);
  return {
    cleanTitle,
    cleanDescription: cleanDescription || null,
    cleanSlug,
    cleanBuilderData
  };
};

const getModuleFaceSettingsError = (builderData = {}) => {
  const moduleSettings = builderData?.moduleSettings || {};
  if (moduleSettings.isPublic && moduleSettings.faceVerification?.enabled) {
    return 'Um modulo publico nao pode exigir verificacao facial.';
  }
  return '';
};

const sanitizeLiveStageSharePayload = (payload = {}) => ({
  moduleId: isUuid(payload?.moduleId) ? payload.moduleId : null,
  courseId: isUuid(payload?.courseId) ? payload.courseId : null,
  title: sanitizeText(payload?.title || 'Palco ao vivo', 180) || 'Palco ao vivo',
  description: sanitizeText(payload?.description || '', 4000) || null,
  activeSlideId: sanitizeText(payload?.activeSlideId || '', 120) || null,
  builderData: sanitizeBuilderData(payload?.builderData)
});

const professorOwnsLiveStagePayload = async (req, payload) => {
  if (!isProfessor(req)) return true;
  if (payload.courseId) {
    const { rows } = await db.query(
      'SELECT 1 FROM courses WHERE id = $1 AND owner_user_id = $2',
      [payload.courseId, req.user.id]
    );
    if (!rows.length) return false;
  }
  if (payload.moduleId) {
    const params = [payload.moduleId, req.user.id];
    let query = `SELECT 1
                   FROM modules m
                   JOIN courses c ON c.id = m.course_id
                  WHERE m.id = $1
                    AND c.owner_user_id = $2`;
    if (payload.courseId) {
      params.push(payload.courseId);
      query += ' AND m.course_id = $3';
    }
    const { rows } = await db.query(query, params);
    if (!rows.length) return false;
  }
  return true;
};

const buildLiveStageShareResponse = (share) => ({
  shareId: share.shareId,
  revision: share.revision,
  updatedAt: new Date(share.updatedAt).toISOString(),
  cameraRequests: share.cameraRequests || [],
  drawingStrokes: share.drawingStrokes || []
});

const isGlobalAdmin = (req) => req.user?.role === 'admin';
const isProfessor = (req) => req.user?.role === 'professor';

const ensureProfessorCreditColumns = async () => {
  await ensurePlatformCreditTables();
};

const ensureProfessorQuotaColumns = async () => {
  if (professorQuotaColumnsEnsured) {
    return;
  }
  await db.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS student_limit INT'
  );
  await db.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT'
  );
  professorQuotaColumnsEnsured = true;
};

const ensureReportCorrectionColumn = async () => {
  if (reportCorrectionColumnEnsured) {
    return;
  }
  await db.query(
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS report_corrected_at TIMESTAMPTZ"
  );
  reportCorrectionColumnEnsured = true;
};

const ensureStudentSignupLinksTable = async () => {
  if (studentSignupLinksTableEnsured) {
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_signup_links (
      professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
      monthly_amount NUMERIC(12,2),
      due_day INT NOT NULL DEFAULT 10,
      billing_type TEXT NOT NULL DEFAULT 'PIX',
      grace_days INT NOT NULL DEFAULT 5,
      auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      payment_description TEXT,
      payment_instructions TEXT,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE student_signup_links
      ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS due_day INT NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'PIX',
      ADD COLUMN IF NOT EXISTS grace_days INT NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS payment_description TEXT,
      ADD COLUMN IF NOT EXISTS payment_instructions TEXT;
    CREATE TABLE IF NOT EXISTS student_signup_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
      auto_approval_requested BOOLEAN NOT NULL DEFAULT FALSE,
      monthly_amount NUMERIC(12,2),
      due_day INT NOT NULL DEFAULT 10,
      billing_type TEXT NOT NULL DEFAULT 'PIX',
      grace_days INT NOT NULL DEFAULT 5,
      auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      payment_description TEXT,
      payment_instructions TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_student_signup_requests_professor
      ON student_signup_requests(professor_user_id, status, created_at DESC)
  `);
  studentSignupLinksTableEnsured = true;
};

router.post('/live-stage-shares', async (req, res) => {
  const payload = sanitizeLiveStageSharePayload(req.body);
  if (!(await professorOwnsLiveStagePayload(req, payload))) {
    return res.status(404).json({ message: 'Curso ou modulo da aula ao vivo nao encontrado.' });
  }
  const share = createShare({
    ownerUserId: req.user.id,
    ownerRole: req.user.role || null,
    payload
  });
  res.status(201).json(buildLiveStageShareResponse(share));
});

router.put('/live-stage-shares/:shareId', async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const payload = sanitizeLiveStageSharePayload(req.body);
  if (!(await professorOwnsLiveStagePayload(req, payload))) {
    return res.status(404).json({ message: 'Curso ou modulo da aula ao vivo nao encontrado.' });
  }
  const share = updateShare(shareId, req.user.id, payload);
  if (!share) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }
  res.json(buildLiveStageShareResponse(share));
});

router.post('/live-stage-shares/:shareId/3d-transform', liveThreeDTransformRateLimiter, async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const quaternion = Array.isArray(req.body?.quaternion)
    ? req.body.quaternion.slice(0, 4).map(Number)
    : [];
  const position = Array.isArray(req.body?.position)
    ? req.body.position.slice(0, 2).map(Number)
    : [0, 0];
  const zoom = Number(req.body?.zoom);
  const slideId = sanitizeText(req.body?.slideId || '', 120);
  if (
    !slideId ||
    quaternion.length !== 4 ||
    quaternion.some((value) => !Number.isFinite(value)) ||
    position.length !== 2 ||
    position.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(zoom)
  ) {
    return res.status(400).json({ message: 'Transformação 3D inválida.' });
  }
  const transform = updateThreeDTransform(shareId, req.user.id, {
    slideId,
    quaternion: quaternion.map((value) => Math.max(-1, Math.min(1, value))),
    position: position.map((value) => Math.max(-0.5, Math.min(0.5, value))),
    zoom: Math.max(0.5, Math.min(2.5, zoom)),
    sequence: Math.max(0, Math.trunc(Number(req.body?.sequence) || 0))
  });
  if (!transform) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }
  res.json({ received: true, transform });
});

router.delete('/live-stage-shares/:shareId', async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const deleted = deleteShare(shareId, req.user.id);
  if (!deleted) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }
  res.status(204).end();
});

router.delete('/live-stage-shares/:shareId/drawing', requireAuth, requireRole(['admin', 'professor']), async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'ID de compartilhamento inválido.' });
  }

  const share = getShare(shareId);
  if (!share || share.ownerUserId !== req.user.id) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo nao encontrado.' });
  }
  const success = clearDrawingStrokes(shareId);
  res.json({ success });
});

router.delete('/live-stage-shares/:shareId/drawing/:strokeId', requireAuth, requireRole(['admin', 'professor']), async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'ID de compartilhamento invÃ¡lido.' });
  }

  const strokeId = sanitizeText(req.params?.strokeId || '', 160);
  if (!strokeId) {
    return res.status(400).json({ message: 'ID do traÃ§o invÃ¡lido.' });
  }
  const share = getShare(shareId);
  if (!share || share.ownerUserId !== req.user.id) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo nao encontrado.' });
  }
  const success = removeDrawingStroke(shareId, strokeId);
  res.json({ success });
});

router.post('/live-stage-shares/:shareId/camera-requests/respond', async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo invalido.' });
  }
  const share = getShare(shareId);
  if (!share || share.ownerUserId !== req.user.id) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo nao encontrado.' });
  }

  const userId = sanitizeText(req.body?.userId || '', 80);
  const peerId = sanitizeText(req.body?.peerId || '', 120);
  const fullName = sanitizeText(req.body?.fullName || '', 160);
  const approved = req.body?.approved === true;
  if (!userId && !peerId) {
    return res.status(400).json({ message: 'Solicitacao de camera invalida.' });
  }

  const success = removeCameraRequest(
    shareId,
    { userId, peerId, fullName },
    { markRejected: !approved }
  );
  res.json({ success });
});

router.get('/live-stage-shares/:shareId/cursors', async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const share = getShare(shareId);
  if (!share || share.ownerUserId !== req.user.id) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }
  res.json({ cursors: listCursorPositions(shareId) || [] });
});

router.post('/live-stage-shares/:shareId/cursor', async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const share = getShare(shareId);
  if (!share || share.ownerUserId !== req.user.id) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }

  const active = req.body?.active !== false;
  const success = updateCursorPosition(shareId, {
    userId: req.user.id,
    peerKey: `teacher:${req.user.id}`,
    role: req.user.role || 'professor',
    fullName: req.user.full_name || req.user.fullName || 'Professor',
    x: Number(req.body?.x),
    y: Number(req.body?.y),
    active
  });
  if (!success) {
    return res.status(500).json({ message: 'Não foi possível atualizar o cursor.' });
  }
  res.json({ success: true });
});

router.get('/3d-assets', async (req, res) => {
  try {
    res.json({ assets: await listThreeDAssets(req.user.id) });
  } catch (error) {
    console.error('Erro ao listar ativos 3D:', error);
    res.status(500).json({ message: 'Não foi possível carregar os modelos 3D.' });
  }
});

router.post('/3d-assets', mediaHeavyRateLimiter, async (req, res) => {
  let creditCharge = null;
  try {
    creditCharge = await consumePlatformCredits(req, 'a importação de modelo 3D', 'three_d_import');
    const result = await createThreeDAssetFromRequest(req, {
      assertQuota: (additionalBytes) => assertProfessorStorageLimit(req, additionalBytes)
    });
    if (result.duplicate && creditCharge?.charged) {
      await creditCharge.refund('duplicate_3d_asset');
      creditCharge = null;
    }
    const status = await getPlatformCreditStatus(req.user.id);
    res.status(result.duplicate ? 200 : 201).json({
      ...result,
      platformCreditsRemaining: status?.platformCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) await creditCharge.refund('3d_import_failed').catch(() => {});
    if (!error.statusCode || error.statusCode >= 500) {
      console.error('Erro ao importar modelo 3D:', error);
    }
    res.status(error.statusCode || 400).json({
      message: error.message || 'Não foi possível importar o modelo 3D.',
      code: error.code || null,
      quotaStatus: error.quotaStatus || null,
      platformCreditsRemaining: error.platformCredits ?? null,
      requiredCredits: error.requiredCredits ?? null
    });
  }
});

router.get('/3d-assets/:assetId/file', async (req, res) => {
  const asset = await getThreeDAsset(req.params.assetId);
  if (!asset || (!isGlobalAdmin(req) && asset.owner_user_id !== req.user.id)) {
    return res.status(404).json({ message: 'Modelo 3D não encontrado.' });
  }
  return sendThreeDAssetFile(req, res, asset, req.query.variant);
});

router.get('/3d-assets/:assetId', async (req, res) => {
  const asset = await getThreeDAsset(req.params.assetId);
  if (!asset || (!isGlobalAdmin(req) && asset.owner_user_id !== req.user.id)) {
    return res.status(404).json({ message: 'Modelo 3D não encontrado.' });
  }
  res.json({ asset: serializeAsset(asset) });
});

router.delete('/3d-assets/:assetId', async (req, res) => {
  try {
  const result = await deleteThreeDAsset(req.params.assetId, req.user.id, {
    allowAnyOwner: isGlobalAdmin(req)
  });
  if (result.reason === 'referenced') {
    return res.status(409).json({ message: 'Este modelo está sendo usado por um módulo e não pode ser excluído.' });
  }
  if (!result.deleted) {
    return res.status(404).json({ message: 'Modelo 3D não encontrado.' });
  }
  res.status(204).end();
  } catch (error) {
    console.error('Erro ao excluir modelo 3D:', error);
    res.status(500).json({ message: 'NÃ£o foi possÃ­vel excluir o modelo 3D agora.' });
  }
});

router.get('/3d-catalog/search', externalThreeDSearchRateLimiter, async (req, res) => {
  try {
    const items = await searchExternalThreeDModels(req.user.id, req.query.q || '');
    res.json({ items });
  } catch (error) {
    res.status(error.statusCode || 502).json({
      message: error.message || 'Não foi possível consultar o catálogo online.'
    });
  }
});

router.get('/3d-catalog/:externalId/thumbnail', async (req, res) => {
  const item = getExternalThreeDModel(req.user.id, req.params.externalId);
  if (!item?.thumbnailUri) return res.status(404).end();
  try {
    const thumbnailUrl = new URL(item.thumbnailUri);
    if (!isApprovedExternalThumbnailUrl(thumbnailUrl, item.provider)) return res.status(404).end();
    const response = await fetch(thumbnailUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'image/*', 'user-agent': getProviderUserAgent() }
    });
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (!response.ok || declaredSize > 3 * 1024 * 1024) return res.status(404).end();
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return res.status(404).end();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch {
    return res.status(404).end();
  }
});

router.get('/3d-catalog/:externalId/preview', async (req, res) => {
  const item = getExternalThreeDModel(req.user.id, req.params.externalId);
  if (!item?.uri || item.preview3d === false || Number(item.size || 0) > 40 * 1024 * 1024) {
    return res.status(404).end();
  }
  try {
    const modelUrl = new URL(item.uri);
    if (!isApprovedExternalModelUrl(modelUrl, item.provider)) return res.status(404).end();
    const response = await fetch(modelUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
      headers: {
        accept: 'model/gltf-binary,application/octet-stream',
        'user-agent': getProviderUserAgent()
      }
    });
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (!response.ok || !response.body || declaredSize > 40 * 1024 * 1024) return res.status(404).end();
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', 'inline; filename="preview-criatyve.glb"');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return Readable.fromWeb(response.body).pipe(res);
  } catch {
    return res.status(404).end();
  }
});

router.post('/3d-catalog/:externalId/import', mediaHeavyRateLimiter, async (req, res) => {
  const item = getExternalThreeDModel(req.user.id, req.params.externalId);
  if (!item) {
    return res.status(410).json({ message: 'Esta busca expirou. Pesquise novamente para importar o modelo.' });
  }
  if (item.provider === 'SKETCHFAB' || !item.uri) {
    return res.status(403).json({
      message: 'O Sketchfab exige login individual do professor para baixar. Abra o modelo e faça o download pela sua conta.'
    });
  }
  let creditCharge = null;
  try {
    creditCharge = await consumePlatformCredits(req, 'a importação de modelo do catálogo 3D', 'three_d_import', {
      referenceType: 'external_3d_model',
      referenceId: item.sourceAssetId || req.params.externalId
    });
    const result = await createThreeDAssetFromRemote(
      req.user.id,
      {
        url: item.uri,
        originalName: item.title,
        provider: item.provider,
        resources: item.resources
      },
      {
        assertQuota: (bytes) => assertProfessorStorageLimit(req, bytes),
        sourceProvider: item.provider,
        sourceReference: item.sourceAssetId || item.uri,
        sourceLicense: item.license || 'CC0'
      }
    );
    if (result.duplicate && creditCharge?.charged) {
      await creditCharge.refund('duplicate_3d_asset');
      creditCharge = null;
    }
    const status = await getPlatformCreditStatus(req.user.id);
    return res.status(result.duplicate ? 200 : 201).json({
      ...result,
      platformCreditsRemaining: status?.platformCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) await creditCharge.refund('3d_catalog_import_failed').catch(() => {});
    if (!error.statusCode || error.statusCode >= 500) {
      console.error('Erro ao importar modelo do catálogo online:', error);
    }
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Não foi possível importar este modelo.',
      code: error.code || null,
      quotaStatus: error.quotaStatus || null,
      platformCreditsRemaining: error.platformCredits ?? null,
      requiredCredits: error.requiredCredits ?? null
    });
  }
});

const hashSignupLinkToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const getProfessorCreditsValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
};

const parseCreditsInput = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(numeric.toFixed(2));
};

const parseOptionalLimitInput = (value, { allowZero = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = Math.trunc(numeric);
  if (normalized < 0 || (!allowZero && normalized === 0)) {
    return null;
  }
  return normalized;
};

const parseStorageLimitGbInput = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.round(numeric * 1024 * 1024 * 1024);
};

const ensureGlobalAdmin = (req, res) => {
  if (!isGlobalAdmin(req)) {
    res.status(403).json({ message: 'Somente o admin pode gerenciar professores.' });
    return false;
  }
  return true;
};

const loadEffectiveAiSettings = async (req) => {
  if (isGlobalAdmin(req)) {
    return db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  }
  return db.query(
    `${ADMIN_AI_SETTINGS_SELECT}
      WHERE admin_user_id = (
        SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1
      )`
  );
};

const buildProfessorCreditPayload = (row) => ({
  platformCredits: getProfessorCreditsValue(row?.platform_credits),
  platformCreditsUpdatedAt: row?.platform_credits_updated_at || null
});

const getProfessorLimitPayload = (row) => ({
  studentLimit: Number.isFinite(Number(row?.student_limit)) ? Number(row.student_limit) : null,
  storageLimitBytes: Number.isFinite(Number(row?.storage_limit_bytes)) ? Number(row.storage_limit_bytes) : null
});

const estimateTextStorageBytes = (...values) =>
  values.reduce((total, value) => total + Buffer.byteLength(String(value || ''), 'utf8'), 0);

const estimateModuleStorageBytes = ({ title, description, slug, builderData }) =>
  estimateTextStorageBytes(title, description, slug, JSON.stringify(builderData || {}));

const estimateCourseStorageBytes = ({ title, description, slug, coverImage }) =>
  estimateTextStorageBytes(title, description, slug, coverImage);

const estimateNotificationAttachmentsStorageBytes = (attachments = []) =>
  (Array.isArray(attachments) ? attachments : []).reduce((total, attachment) => {
    const declaredSize = Number(attachment?.size);
    if (Number.isFinite(declaredSize) && declaredSize > 0) {
      return total + Math.trunc(declaredSize);
    }
    const url = String(attachment?.url || '');
    if (url.startsWith('data:')) {
      const base64 = url.split(',')[1] || '';
      return total + Buffer.byteLength(base64, 'base64');
    }
    return total + Buffer.byteLength(url, 'utf8');
  }, 0);

const getProfessorStudentCount = async (professorId) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM users
      WHERE role = 'student'
        AND owner_user_id = $1
        AND is_active = TRUE`,
    [professorId]
  );
  return Number(rows[0]?.total || 0);
};

const getProfessorStorageUsageBytes = async (professorId) => {
  await ensureOwnershipColumns();
  await ensureThreeDAssetsTable();
  const { rows } = await db.query(
    `WITH owned_courses AS (
       SELECT
         COALESCE(SUM(
           octet_length(COALESCE(title, '')) +
           octet_length(COALESCE(description, '')) +
           octet_length(COALESCE(slug, '')) +
           octet_length(COALESCE(cover_image, ''))
         ), 0)::bigint AS total
       FROM courses
       WHERE owner_user_id = $1
     ),
     owned_modules AS (
       SELECT
         COALESCE(SUM(
           octet_length(COALESCE(m.title, '')) +
           octet_length(COALESCE(m.description, '')) +
           octet_length(COALESCE(m.slug, '')) +
           octet_length(COALESCE(m.builder_data::text, ''))
         ), 0)::bigint AS total
       FROM modules m
       JOIN courses c ON c.id = m.course_id
       WHERE c.owner_user_id = $1
     ),
     owned_notifications AS (
       SELECT
         COALESCE(SUM(
           CASE
             WHEN attachment.value ? 'size' AND (attachment.value->>'size') ~ '^[0-9]+$'
               THEN (attachment.value->>'size')::bigint
             ELSE octet_length(COALESCE(attachment.value->>'url', ''))
           END
         ), 0)::bigint AS total
       FROM notifications n
       LEFT JOIN LATERAL jsonb_array_elements(COALESCE(n.attachments, '[]'::jsonb)) AS attachment(value) ON TRUE
       WHERE n.owner_user_id = $1 OR n.created_by = $1
     ),
     owned_3d_assets AS (
       SELECT COALESCE(SUM(desktop_size + mobile_size + poster_size), 0)::bigint AS total
       FROM three_d_assets
       WHERE owner_user_id = $1
         AND status = 'READY'
     )
     SELECT (
       owned_courses.total +
       owned_modules.total +
       owned_notifications.total +
       owned_3d_assets.total
     )::bigint AS total
     FROM owned_courses, owned_modules, owned_notifications, owned_3d_assets`,
    [professorId]
  );
  return Number(rows[0]?.total || 0);
};

const getProfessorQuotaStatus = async (professorId) => {
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
  const { rows } = await db.query(
    `SELECT id, role, is_active, platform_credits, platform_credits_updated_at, student_limit, storage_limit_bytes
       FROM users
      WHERE id = $1`,
    [professorId]
  );
  const row = rows[0];
  if (!row || row.role !== 'professor') {
    return null;
  }
  const [studentCount, storageUsedBytes] = await Promise.all([
    getProfessorStudentCount(professorId),
    getProfessorStorageUsageBytes(professorId)
  ]);
  return {
    ...buildProfessorCreditPayload(row),
    ...getProfessorLimitPayload(row),
    studentCount,
    storageUsedBytes,
    isActive: row.is_active !== false
  };
};

const getProfessorCreditStatus = async (userId) => {
  const status = await getProfessorQuotaStatus(userId);
  return status
    ? {
        platformCredits: status.platformCredits,
        platformCreditsUpdatedAt: status.platformCreditsUpdatedAt,
        isActive: status.isActive
      }
    : null;
};

const consumeProfessorAiCredit = (req, featureLabel, options = {}) =>
  consumePlatformCredits(
    req,
    featureLabel,
    options.creditType === 'image' ? 'image' : 'text',
    { units: options.units }
  );

const countGeneratedImageCharges = (value) => {
  const actions = Array.isArray(value?.actions) ? value.actions : Array.isArray(value) ? value : [];
  let count = 0;
  actions.forEach((action) => {
    if (typeof action?.slide?.backgroundImage === 'string' && action.slide.backgroundImage.startsWith('data:image/')) {
      count += 1;
    }
    if (typeof action?.element?.src === 'string' && action.element.src.startsWith('data:image/')) {
      count += 1;
    }
    if (typeof action?.element?.actionConfig?.url === 'string' && action.element.actionConfig.url.startsWith('data:image/')) {
      count += 1;
    }
  });
  return count;
};

const assertProfessorStudentLimit = async (req) => {
  if (!isProfessor(req)) {
    return;
  }
  const status = await getProfessorQuotaStatus(req.user.id);
  if (!status?.studentLimit || status.studentLimit < 1) {
    return;
  }
  if (status.studentCount >= status.studentLimit) {
    const error = new Error(`Seu limite de alunos foi atingido (${status.studentLimit}).`);
    error.statusCode = 403;
    error.code = 'PROFESSOR_STUDENT_LIMIT_REACHED';
    error.quotaStatus = status;
    throw error;
  }
};

const assertProfessorStorageLimit = async (req, additionalBytes) => {
  if (!isProfessor(req)) {
    return;
  }
  const growth = Number.isFinite(Number(additionalBytes)) ? Math.max(0, Math.round(Number(additionalBytes))) : 0;
  if (growth <= 0) {
    return;
  }
  const status = await getProfessorQuotaStatus(req.user.id);
  if (!status?.storageLimitBytes || status.storageLimitBytes < 1) {
    return;
  }
  if (status.storageUsedBytes + growth > status.storageLimitBytes) {
    const error = new Error('O limite de armazenamento deste professor foi atingido para os cursos.');
    error.statusCode = 403;
    error.code = 'PROFESSOR_STORAGE_LIMIT_REACHED';
    error.quotaStatus = status;
    throw error;
  }
};

const ensureOwnershipColumns = async () => {
  if (ownershipColumnsEnsured) {
    return;
  }
  await db.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL"
  );
  await db.query(
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL"
  );
  await db.query(
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL"
  );
  await db.query(
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb"
  );
  ownershipColumnsEnsured = true;
};

const parsePlatformCreditCostInput = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(2));
};

const sanitizeNotificationAttachments = (value = [], message = '') => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/\r?\n/)
      .map((url) => ({ url }));
  const attachments = [];
  const seen = new Set();
  const pushAttachment = (entry = {}) => {
    const rawUrl = typeof entry === 'string' ? entry : entry.url;
    const rawTextUrl = String(rawUrl || '').trim();
    const normalizedTextUrl = rawTextUrl.startsWith('www.') ? `https://${rawTextUrl}` : rawTextUrl;
    let url = sanitizeMediaUrl(normalizedTextUrl, { allowData: false });
    if (!url && NOTIFICATION_FILE_DATA_URL_REGEX.test(rawTextUrl)) {
      const base64 = rawTextUrl.split(',')[1] || '';
      const estimatedBytes = Buffer.byteLength(base64, 'base64');
      if (estimatedBytes <= MAX_NOTIFICATION_FILE_BYTES) {
        url = rawTextUrl;
      }
    }
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    let fallbackTitle = 'Documento';
    try {
      const parsed = new URL(url);
      const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[a-z0-9]{2,8}$/i, '');
      fallbackTitle = fileName || parsed.hostname || fallbackTitle;
    } catch (error) {
      fallbackTitle = 'Documento';
    }
    attachments.push({
      title: sanitizeText(entry.title || fallbackTitle, 120) || 'Documento',
      url,
      mimeType: sanitizeText(entry.mimeType || '', 120) || null,
      size: Math.max(0, Math.min(MAX_NOTIFICATION_FILE_BYTES, Number(entry.size) || 0)) || null
    });
  };
  rawItems.slice(0, 10).forEach(pushAttachment);
  return attachments.slice(0, 10);
};

const getNotificationDataAttachment = (attachments = [], attachmentIndex = 0) => {
  const index = Number.parseInt(String(attachmentIndex), 10);
  if (!Array.isArray(attachments) || !Number.isInteger(index) || index < 0 || index >= attachments.length) {
    return null;
  }
  const attachment = attachments[index];
  const url = String(attachment?.url || '');
  if (!NOTIFICATION_FILE_DATA_URL_REGEX.test(url)) {
    return null;
  }
  const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_NOTIFICATION_FILE_BYTES) {
    return null;
  }
  return {
    buffer,
    mimeType: sanitizeText(attachment.mimeType || match[1], 120) || 'application/octet-stream',
    title: sanitizeText(attachment.title || 'documento', 160) || 'documento'
  };
};

const sendNotificationDataAttachment = (res, attachment) => {
  const safeFileName = attachment.title.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160) || 'documento';
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Length', String(attachment.buffer.length));
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFileName)}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`);
  res.send(attachment.buffer);
};

const ensureProfessorOwnsStudent = async (req, studentId) => {
  const params = [studentId];
  let query = "SELECT id FROM users WHERE id = $1 AND role = 'student'";
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += " AND owner_user_id = $2";
  }
  const { rows } = await db.query(query, params);
  return rows[0] || null;
};

const ensureProfessorOwnsCourse = async (req, courseId) => {
  const params = [courseId];
  let query = 'SELECT id FROM courses WHERE id = $1';
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND owner_user_id = $2';
  }
  const { rows } = await db.query(query, params);
  return rows[0] || null;
};

const buildStudentOwnershipWriteClause = (req, idParamIndex) =>
  isProfessor(req)
    ? `id = $${idParamIndex} AND role = 'student' AND owner_user_id = $${idParamIndex + 1}`
    : `id = $${idParamIndex} AND role = 'student'`;

const ensureCourseCoverColumn = async () => {
  if (courseCoverColumnEnsured) {
    return;
  }
  await db.query(
    'ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_image TEXT NOT NULL DEFAULT \'\''
  );
  courseCoverColumnEnsured = true;
};

const ensureCourseStoreColumn = async () => {
  if (courseStoreColumnEnsured) {
    return;
  }
  await db.query(
    'ALTER TABLE courses ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT FALSE'
  );
  courseStoreColumnEnsured = true;
};

const ensureCourseAccessRequestsTable = async () => {
  if (courseAccessRequestsTableEnsured) {
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS course_access_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, course_id)
    )
  `);
  courseAccessRequestsTableEnsured = true;
};

const ensureAdminSmtpSettingsTable = async () => {
  if (adminSmtpSettingsEnsured) {
    return;
  }
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

const isSmtpConfigUsable = (settings) =>
  Boolean(settings?.host && settings?.user_email && settings?.user_pass);

const sanitizeSmtpSettingsResponse = (settings, extras = {}) => ({
  host: settings?.host || '',
  port: settings?.port || '',
  secure: settings?.secure !== false,
  user_email: settings?.user_email || '',
  user_pass: '',
  from_email: settings?.from_email || '',
  hasPassword: Boolean(settings?.user_pass),
  ...extras
});

const ensureClassesTable = async () => {
  if (classesTableEnsured) {
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query('ALTER TABLE classes ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE');
  await db.query('ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_name_key');
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS classes_owner_name_unique
    ON classes (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  `);
  await db.query(
    `INSERT INTO classes (id, name)
     VALUES ($1, 'Turma A')
     ON CONFLICT DO NOTHING`,
    [crypto.randomUUID()]
  );
  classesTableEnsured = true;
};

const ensureProgressEventsColumn = async () => {
  if (progressEventsColumnEnsured) {
    return;
  }
  await db.query(
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS progress_events JSONB NOT NULL DEFAULT '[]'::jsonb"
  );
  progressEventsColumnEnsured = true;
};

const ensureEnrollmentProgressColumns = async () => {
  if (enrollmentProgressColumnsEnsured) {
    return;
  }
  await db.query(
    `ALTER TABLE enrollments
       ADD COLUMN IF NOT EXISTS quiz_attempts JSONB NOT NULL DEFAULT '{}'::jsonb,
       ADD COLUMN IF NOT EXISTS interactive_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
       ADD COLUMN IF NOT EXISTS video_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
       ADD COLUMN IF NOT EXISTS progress_events JSONB NOT NULL DEFAULT '[]'::jsonb,
       ADD COLUMN IF NOT EXISTS input_responses JSONB NOT NULL DEFAULT '{}'::jsonb`
  );
  progressEventsColumnEnsured = true;
  enrollmentProgressColumnsEnsured = true;
};

const ensureClassExists = async (req, className) => {
  const cleanClassName = sanitizeText(className || '', 120);
  if (!cleanClassName) {
    return 'Turma A';
  }
  await ensureClassesTable();
  await db.query(
    `INSERT INTO classes (id, name, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [crypto.randomUUID(), cleanClassName, isProfessor(req) ? req.user.id : null]
  );
  return cleanClassName;
};

const readTemplateStoreFiles = async () => {
  try {
    const entries = await fs.readdir(TEMPLATE_STORE_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const readTemplateStorePayload = async (fileName) => {
  const fullPath = path.join(TEMPLATE_STORE_DIR, fileName);
  const rawText = await fs.readFile(fullPath, 'utf8');
  const payload = JSON.parse(rawText);
  const templateSource =
    payload?.kind === 'curso-slide-template'
      ? payload.template
      : payload?.template && (payload.template.builderData || payload.template.builder_data)
        ? payload.template
        : payload?.builderData || payload?.builder_data
          ? payload
          : payload;
  const builderData = templateSource?.builderData || templateSource?.builder_data || templateSource;
  const slides = Array.isArray(builderData?.slides) ? builderData.slides : [];
  if (!slides.length) {
    throw new Error('Template sem slides.');
  }
  return {
    fileName,
    key: fileName.replace(/\.json$/i, ''),
    payload,
    title: String(templateSource?.title || '').trim() || fileName.replace(/\.json$/i, ''),
    description: String(templateSource?.description || '').trim() || '',
    slideCount: slides.length,
    previewSlide: slides[0] || null,
    stageSize:
      builderData?.stageSize && Number(builderData.stageSize.width) > 0 && Number(builderData.stageSize.height) > 0
        ? {
            width: Number(builderData.stageSize.width),
            height: Number(builderData.stageSize.height)
          }
        : { width: 1280, height: 720 },
    category: String(payload?.store?.category || '').trim() || 'Geral',
    badge: String(payload?.store?.badge || '').trim() || '',
    accentColor: String(payload?.store?.accentColor || '').trim() || '',
    summary: String(payload?.store?.summary || '').trim() || '',
    thumbnail: String(payload?.store?.thumbnail || '').trim() || ''
  };
};

const readTemplateStoreCatalog = async () => {
  const fileNames = await readTemplateStoreFiles();
  const results = await Promise.all(
    fileNames.map(async (fileName) => {
      try {
        const item = await readTemplateStorePayload(fileName);
        const stats = await fs.stat(path.join(TEMPLATE_STORE_DIR, fileName));
        return {
          key: item.key,
          fileName: item.fileName,
          title: item.title,
          description: item.description,
          slideCount: item.slideCount,
          previewSlide: item.previewSlide,
          stageSize: item.stageSize,
          category: item.category,
          badge: item.badge,
          accentColor: item.accentColor,
          summary: item.summary,
          thumbnail: item.thumbnail,
          updatedAt: stats.mtime.toISOString()
        };
      } catch (error) {
        console.warn(`Template da loja ignorado (${fileName}):`, error.message || error);
        return null;
      }
    })
  );
  return results.filter(Boolean);
};

let adminAiImageColumnsEnsured = false;
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';

const ADMIN_AI_SETTINGS_SELECT = `SELECT admin_user_id, provider_key, provider_label, base_url, model, encrypted_api_key,
        system_prompt, require_confirmation, is_enabled, updated_at,
        image_provider_key, image_provider_label, image_base_url, image_model, image_encrypted_api_key, image_is_enabled
   FROM admin_ai_settings`;

const ensureAdminAiImageColumns = async () => {
  if (adminAiImageColumnsEnsured) {
    return;
  }
  await db.query(
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS image_provider_key TEXT NOT NULL DEFAULT 'google-gemini-image'`
  );
  await db.query(
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS image_provider_label TEXT NOT NULL DEFAULT 'Nano Banana'`
  );
  await db.query(
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS image_base_url TEXT NOT NULL DEFAULT 'https://generativelanguage.googleapis.com/v1beta'`
  );
  await db.query(
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS image_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-image'`
  );
  await db.query(
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS image_encrypted_api_key TEXT`
  );
  await db.query(
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS image_is_enabled BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await db.query(
    `UPDATE admin_ai_settings
        SET model = $1,
            updated_at = NOW()
      WHERE LOWER(provider_key) = 'deepseek'
        AND model = 'deepseek-chat'`,
    [DEFAULT_DEEPSEEK_MODEL]
  );
  adminAiImageColumnsEnsured = true;
};

router.get('/students', async (req, res) => {
  await ensureClassesTable();
  await ensureOwnershipColumns();
  await ensureStudentSignupLinksTable();
  const params = [];
  let studentQuery = `SELECT s.id, s.full_name, s.email, s.phone, s.role, s.class_name, s.is_active, s.created_at,
                             s.owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email,
                             signup.status AS signup_approval_status,
                             signup.monthly_amount AS signup_monthly_amount,
                             signup.billing_type AS signup_billing_type,
                             signup.due_day AS signup_due_day
                      FROM users s
                      LEFT JOIN users owner ON owner.id = s.owner_user_id
                      LEFT JOIN student_signup_requests signup ON signup.student_user_id = s.id
                      WHERE s.role = 'student'`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    studentQuery += ` AND s.owner_user_id = $1`;
  }
  studentQuery += ` ORDER BY
    CASE signup.status WHEN 'PENDING' THEN 0 WHEN 'REJECTED' THEN 2 ELSE 1 END,
    s.created_at DESC`;
  const result = await db.query(studentQuery, params);

  const students = await Promise.all(
    result.rows.map(async (student) => {
    const { rows: enrollments } = await db.query(
      `SELECT c.id, c.title, c.description, c.slug, e.video_position, e.interactive_step, e.current_module, e.grade
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         WHERE e.user_id = $1`,
        [student.id]
      );
      return { ...student, enrollments };
    })
  );

  res.json(students);
});

router.get('/classes', async (req, res) => {
  await ensureClassesTable();
  if (isProfessor(req)) {
    await ensureClassExists(req, 'Turma A');
  }
  const { rows } = await db.query(
    `SELECT id, name, created_at
     FROM classes
     ${isProfessor(req) ? 'WHERE owner_user_id = $1' : ''}
     ORDER BY name`
    , isProfessor(req) ? [req.user.id] : []
  );
  res.json(rows);
});

router.post('/classes', async (req, res) => {
  await ensureClassesTable();
  const name = sanitizeText(req.body?.name || '', 120);
  if (!name) {
    return res.status(400).json({ message: 'Informe o nome da turma.' });
  }
  const id = crypto.randomUUID();
  const ownerUserId = isProfessor(req) ? req.user.id : null;
  const { rows } = await db.query(
    `INSERT INTO classes (id, name, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING id, name, created_at`,
    [id, name, ownerUserId]
  );
  if (!rows.length) {
    return res.status(409).json({ message: 'Esta turma jÃ¡ existe.' });
  }
  res.status(201).json(rows[0]);
});

router.delete('/classes/:classId', async (req, res) => {
  await ensureClassesTable();
  const { classId } = req.params;
  if (!isUuid(classId)) {
    return res.status(400).json({ message: 'Turma invÃ¡lida.' });
  }
  const { rows } = await db.query(
    `SELECT id, name, owner_user_id FROM classes WHERE id = $1${isProfessor(req) ? ' AND owner_user_id = $2' : ''}`,
    isProfessor(req) ? [classId, req.user.id] : [classId]
  );
  const classRow = rows[0];
  if (!classRow) {
    return res.status(404).json({ message: 'Turma nÃ£o encontrada.' });
  }
  const usageParams = [classRow.name];
  let usageOwnerSql = ' AND owner_user_id IS NULL';
  if (isProfessor(req)) {
    usageParams.push(req.user.id);
    usageOwnerSql = ' AND owner_user_id = $2';
  } else if (classRow.owner_user_id) {
    usageParams.push(classRow.owner_user_id);
    usageOwnerSql = ' AND owner_user_id = $2';
  }
  const usage = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM users
     WHERE role = 'student' AND class_name = $1${usageOwnerSql}`,
    usageParams
  );
  if (Number(usage.rows[0]?.total || 0) > 0) {
    return res.status(409).json({ message: 'Esta turma possui alunos vinculados.' });
  }
  await db.query('DELETE FROM classes WHERE id = $1', [classId]);
  res.status(204).send();
});

router.get('/professors', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) {
    return;
  }
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
  const { rows } = await db.query(
    `SELECT id, full_name, email, phone, role, is_active, platform_credits, platform_credits_updated_at, student_limit, storage_limit_bytes, created_at
       FROM users
      WHERE role = 'professor'
      ORDER BY full_name`
  );
  const payload = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      is_active: row.is_active,
      created_at: row.created_at,
      studentCount: await getProfessorStudentCount(row.id),
      storageUsedBytes: await getProfessorStorageUsageBytes(row.id),
      ...buildProfessorCreditPayload(row),
      ...getProfessorLimitPayload(row)
    }))
  );
  res.json(payload);
});

router.post('/professors', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) {
    return;
  }
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
  const fullName = sanitizeText(req.body?.fullName, 160);
  const email = sanitizeEmail(req.body?.email || '');
  const phone = sanitizePhone(req.body?.phone || '');
  const password = sanitizeText(req.body?.password || '', 256, { trim: false });
  const parsedCredits = parseCreditsInput(req.body?.platformCredits);
  const platformCredits = parsedCredits === null ? 0 : Math.max(0, parsedCredits);
  const studentLimit = parseOptionalLimitInput(req.body?.studentLimit, { allowZero: false });
  const storageLimitBytes = parseStorageLimitGbInput(req.body?.storageLimitGb);
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha s\u00e3o obrigat\u00f3rios.' });
  }
  const passwordError = getPasswordValidationError(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();
  try {
    await db.query(
      `INSERT INTO users (
         id, full_name, email, phone, password_hash, role, class_name, is_active, platform_credits, platform_credits_updated_at, student_limit, storage_limit_bytes
       )
       VALUES ($1, $2, $3, $4, $5, 'professor', $6, TRUE, 0, NOW(), $7, $8)`,
      [id, fullName, email, phone || null, hashedPassword, 'Professor', studentLimit, storageLimitBytes]
    );
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'J\u00e1 existe um usu\u00e1rio com este email.' });
    }
    throw error;
  }
  if (platformCredits > 0) {
    await applyCreditChange({
      userId: id,
      amount: platformCredits,
      operationType: 'admin_initial_grant',
      referenceType: 'professor',
      referenceId: id,
      idempotencyKey: `professor-initial:${id}`,
      metadata: { adminUserId: req.user.id }
    });
  }
  res.status(201).json({ id, fullName, email, platformCredits, studentLimit, storageLimitBytes });
});

router.put('/professors/:id/status', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) {
    return;
  }
  await ensureProfessorCreditColumns();
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Professor inv\u00e1lido.' });
  }
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'Informe isActive como boolean.' });
  }
  const { rows } = await db.query(
    `UPDATE users
        SET is_active = $1
      WHERE id = $2
        AND role = 'professor'
    RETURNING id`,
    [isActive, id]
  );
  if (!rows.length) {
    return res.status(404).json({ message: 'Professor n\u00e3o encontrado.' });
  }
  res.status(204).send();
});

router.delete('/professors/:id', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) {
    return;
  }
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Professor invalido.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: professorRows } = await client.query(
      `SELECT id
         FROM users
        WHERE id = $1
          AND role = 'professor'`,
      [id]
    );
    if (!professorRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Professor nao encontrado.' });
    }

    await client.query('DELETE FROM notifications WHERE created_by = $1 OR owner_user_id = $1', [id]);
    await client.query('DELETE FROM users WHERE owner_user_id = $1 AND role = \'student\'', [id]);
    await client.query('DELETE FROM courses WHERE owner_user_id = $1', [id]);
    await client.query('UPDATE modules SET created_by = NULL WHERE created_by = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1 AND role = \'professor\'', [id]);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.post('/professors/:id/credits', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) {
    return;
  }
  await ensureProfessorCreditColumns();
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Professor inv\u00e1lido.' });
  }
  const creditAmount = parseCreditsInput(req.body?.credits);
  if (creditAmount === null || creditAmount <= 0) {
    return res.status(400).json({ message: 'Informe uma quantidade positiva de cr\u00e9ditos.' });
  }
  const professor = await db.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'professor'`,
    [id]
  );
  if (!professor.rows.length) {
    return res.status(404).json({ message: 'Professor n\u00e3o encontrado.' });
  }
  const movement = await applyCreditChange({
    userId: id,
    amount: creditAmount,
    operationType: 'admin_adjustment',
    referenceType: 'admin',
    referenceId: req.user.id,
    idempotencyKey: `admin-adjustment:${req.user.id}:${crypto.randomUUID()}`,
    metadata: {
      reason: sanitizeText(req.body?.reason || 'Ajuste manual do administrador', 300)
    }
  });
  res.json({
    success: true,
    addedCredits: creditAmount,
    platformCredits: movement.balance,
    platformCreditsUpdatedAt: new Date().toISOString()
  });
});

router.put('/professors/:id/limits', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) {
    return;
  }
  await ensureProfessorQuotaColumns();
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Professor inválido.' });
  }
  const hasStudentLimit = Object.prototype.hasOwnProperty.call(req.body || {}, 'studentLimit');
  const hasStorageLimitGb = Object.prototype.hasOwnProperty.call(req.body || {}, 'storageLimitGb');
  if (!hasStudentLimit && !hasStorageLimitGb) {
    return res.status(400).json({ message: 'Informe ao menos um limite para atualizar.' });
  }
  const updates = [];
  const values = [];
  let idx = 1;
  if (hasStudentLimit) {
    const studentLimit = req.body?.studentLimit === '' ? null : parseOptionalLimitInput(req.body?.studentLimit, { allowZero: false });
    if (req.body?.studentLimit !== '' && req.body?.studentLimit !== null && studentLimit === null) {
      return res.status(400).json({ message: 'Informe um limite de alunos válido.' });
    }
    updates.push(`student_limit = $${idx}`);
    values.push(studentLimit);
    idx += 1;
  }
  if (hasStorageLimitGb) {
    const storageLimitBytes = req.body?.storageLimitGb === '' ? null : parseStorageLimitGbInput(req.body?.storageLimitGb);
    if (req.body?.storageLimitGb !== '' && req.body?.storageLimitGb !== null && storageLimitBytes === null) {
      return res.status(400).json({ message: 'Informe um limite de armazenamento válido em GB.' });
    }
    updates.push(`storage_limit_bytes = $${idx}`);
    values.push(storageLimitBytes);
    idx += 1;
  }
  values.push(id);
  const { rows } = await db.query(
    `UPDATE users
        SET ${updates.join(', ')}
      WHERE id = $${idx}
        AND role = 'professor'
    RETURNING id, student_limit, storage_limit_bytes`,
    values
  );
  if (!rows.length) {
    return res.status(404).json({ message: 'Professor não encontrado.' });
  }
  res.json({
    success: true,
    ...getProfessorLimitPayload(rows[0])
  });
});

router.get('/me/platform-credits', async (req, res) => {
  if (!['admin', 'professor'].includes(req.user?.role || '')) {
    return res.status(403).json({ message: 'Permiss\u00e3o negada.' });
  }
  const status = await getProfessorQuotaStatus(req.user.id);
  const payload = {
    role: req.user.role,
    ...(status || {
      platformCredits: null,
      platformCreditsUpdatedAt: null,
      isActive: req.user?.role === 'admin' ? true : null,
      studentLimit: null,
      storageLimitBytes: null,
      studentCount: null,
      storageUsedBytes: null
    })
  };
  payload.costs = await getCreditCosts();
  res.json(payload);
});

router.get('/professors/financial-overview', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) return;
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
  await ensureBillingAccessSchema();

  const tableResult = await db.query("SELECT to_regclass('public.billing_subscriptions') AS billing_table");
  const hasBillingTable = Boolean(tableResult.rows[0]?.billing_table);
  const billingColumns = hasBillingTable
    ? `latest.plan_code, latest.amount, latest.status AS billing_status,
       latest.activated_at, latest.deactivated_at, latest.last_event_type AS billing_last_event_type,
       latest.provider_subscription_id,
       latest.raw_payload->>'billingType' AS latest_billing_type,
       latest.raw_payload->>'invoiceUrl' AS latest_invoice_url`
    : `NULL::text AS plan_code, NULL::numeric AS amount, NULL::text AS billing_status,
       NULL::timestamptz AS activated_at, NULL::timestamptz AS deactivated_at,
       NULL::text AS billing_last_event_type, NULL::text AS provider_subscription_id,
       NULL::text AS latest_billing_type, NULL::text AS latest_invoice_url`;
  const billingJoin = hasBillingTable
    ? `LEFT JOIN LATERAL (
         SELECT plan_code, amount, status, activated_at, deactivated_at,
                last_event_type, provider_subscription_id, raw_payload
           FROM billing_subscriptions
          WHERE user_id = u.id OR LOWER(payer_email) = LOWER(u.email)
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
       ) latest ON TRUE`
    : '';
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
            u.platform_credits, u.platform_credits_updated_at, u.student_limit,
            u.storage_limit_bytes, u.created_at, u.billing_access_managed,
            u.subscription_access_expires_at, u.subscription_plan_code,
            u.subscription_billing_type, u.subscription_payment_status,
            u.subscription_last_event_type, u.subscription_payment_url,
            ${billingColumns},
            COALESCE(student_stats.student_count, 0)::int AS student_count
       FROM users u
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS student_count
           FROM users student
          WHERE student.role = 'student' AND student.owner_user_id = u.id AND student.is_active = TRUE
       ) student_stats ON TRUE
       ${billingJoin}
      WHERE u.role = 'professor'
      ORDER BY u.full_name`
  );

  const now = new Date();
  const professors = await Promise.all(rows.map(async (row) => {
    const access = getBillingAccessState(row, now);
    const planCode = row.plan_code || row.subscription_plan_code || null;
    return {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      is_active: row.is_active,
      created_at: row.created_at,
      studentCount: Number(row.student_count || 0),
      storageUsedBytes: await getProfessorStorageUsageBytes(row.id),
      ...buildProfessorCreditPayload(row),
      ...getProfessorLimitPayload(row),
      billing: {
        managed: access.managed,
        state: access.state,
        blocked: access.blocked,
        daysRemaining: access.daysRemaining,
        accessExpiresAt: access.expiration?.toISOString() || null,
        planCode,
        planLabel: planCode === 'pro'
          ? 'Criatyve Pro'
          : planCode === 'trial-30-dias'
            ? 'Trial 30 dias'
            : 'Cadastro manual',
        amount: row.amount !== null && Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
        billingType: String(row.latest_billing_type || row.subscription_billing_type || '').toUpperCase() || null,
        paymentStatus: row.subscription_payment_status || row.billing_status || null,
        lastEventType: row.subscription_last_event_type || row.billing_last_event_type || null,
        automaticRenewal: Boolean(row.provider_subscription_id),
        activatedAt: row.activated_at || null,
        deactivatedAt: row.deactivated_at || null
      }
    };
  }));

  const managed = professors.filter((professor) => professor.billing.managed);
  const active = managed.filter((professor) => !professor.billing.blocked && professor.is_active);
  const atRiskStates = new Set(['payment_failed', 'expired']);
  const projectedMonthlyRevenue = active.reduce(
    (sum, professor) => sum + Number(professor.billing.amount || 0),
    0
  );
  let receivedThisMonth = 0;
  if (hasBillingTable) {
    const receivedResult = await db.query(`
      SELECT COALESCE(SUM(subscription.amount), 0)::numeric AS total
        FROM billing_payment_periods period
        JOIN billing_subscriptions subscription ON subscription.id = period.billing_subscription_id
       WHERE period.created_at >= DATE_TRUNC('month', NOW())
         AND period.event_type <> 'MIGRATED_ACTIVE_PAYMENT'
    `);
    receivedThisMonth = Number(receivedResult.rows[0]?.total || 0);
  }
  const planMap = new Map();
  managed.forEach((professor) => {
    const key = professor.billing.planLabel;
    const current = planMap.get(key) || { plan: key, professors: 0, monthlyRevenue: 0 };
    current.professors += 1;
    if (!professor.billing.blocked && professor.is_active) {
      current.monthlyRevenue += Number(professor.billing.amount || 0);
    }
    planMap.set(key, current);
  });

  res.json({
    generatedAt: now.toISOString(),
    summary: {
      totalProfessors: professors.length,
      managedSubscriptions: managed.length,
      activeSubscriptions: active.length,
      dueSoon: managed.filter((professor) => professor.billing.state === 'due_soon').length,
      atRisk: managed.filter((professor) => atRiskStates.has(professor.billing.state)).length,
      manuallyBlocked: professors.filter((professor) => !professor.is_active).length,
      projectedMonthlyRevenue,
      receivedThisMonth,
      totalStudents: professors.reduce((sum, professor) => sum + professor.studentCount, 0),
      pixSubscriptions: active.filter((professor) => professor.billing.billingType === 'PIX').length,
      cardSubscriptions: active.filter((professor) => professor.billing.billingType === 'CREDIT_CARD').length,
      planBreakdown: Array.from(planMap.values()).sort((a, b) => b.professors - a.professors)
    },
    professors
  });
});

router.get('/credit-packages', async (req, res) => {
  res.json(await listCreditPackages({ activeOnly: isProfessor(req) }));
});

router.post('/credit-packages', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) return;
  try {
    const creditPackage = await saveCreditPackage(req.user.id, req.body || {});
    res.status(201).json(creditPackage);
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message || 'Nao foi possivel criar o pacote.' });
  }
});

router.put('/credit-packages/:packageId', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) return;
  if (!isUuid(req.params.packageId)) {
    return res.status(400).json({ message: 'Pacote invalido.' });
  }
  try {
    res.json(await saveCreditPackage(req.user.id, req.body || {}, req.params.packageId));
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message || 'Nao foi possivel atualizar o pacote.' });
  }
});

router.post('/credit-topups/checkout', async (req, res) => {
  if (!isProfessor(req)) {
    return res.status(403).json({ message: 'Somente professores podem recarregar creditos.' });
  }
  if (!isUuid(req.body?.packageId)) {
    return res.status(400).json({ message: 'Selecione um pacote de creditos valido.' });
  }
  try {
    res.status(201).json(await createCreditTopupCheckout(req, req.body.packageId));
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message || 'Nao foi possivel criar a recarga.' });
  }
});

router.get('/credit-topups/:orderId', async (req, res) => {
  if (!isProfessor(req) || !isUuid(req.params.orderId)) {
    return res.status(403).json({ message: 'Pedido de recarga invalido.' });
  }
  const order = await getCreditTopupOrder(req.user.id, req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Pedido de recarga nao encontrado.' });
  res.json(order);
});

router.post('/student-seats/checkout', async (req, res) => {
  if (!isProfessor(req)) {
    return res.status(403).json({ message: 'Somente professores podem adicionar vagas.' });
  }
  try {
    res.status(201).json(await createStudentSeatUpgradeCheckout(req, req.body?.quantity));
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message || 'Não foi possível criar a compra de vagas.' });
  }
});

router.get('/student-seats/orders/:orderId', async (req, res) => {
  if (!isProfessor(req) || !isUuid(req.params.orderId)) {
    return res.status(403).json({ message: 'Pedido de vagas inválido.' });
  }
  const order = await getStudentSeatUpgradeOrder(req.user.id, req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Pedido de vagas não encontrado.' });
  res.json(order);
});

router.post('/student-signup-link', async (req, res) => {
  await ensureStudentSignupLinksTable();
  await ensureProfessorQuotaColumns();
  if (!isProfessor(req) && !isGlobalAdmin(req)) {
    return res.status(403).json({ message: 'Apenas admin e professores podem gerar este link.' });
  }
  const quotaStatus = isProfessor(req) ? await getProfessorQuotaStatus(req.user.id) : null;
  if (isProfessor(req) && !quotaStatus?.isActive) {
    return res.status(403).json({ message: 'Sua conta de professor está desativada.' });
  }
  const studentCount = isProfessor(req)
    ? Number(quotaStatus?.studentCount || 0)
    : await getProfessorStudentCount(req.user.id);
  const monthlyAmount = Number(req.body?.monthlyAmount);
  const dueDay = Number.parseInt(req.body?.dueDay, 10);
  const graceDays = Number.parseInt(req.body?.graceDays ?? 5, 10);
  const billingType = String(req.body?.billingType || 'PIX').toUpperCase();
  const allowedBillingTypes = new Set(['PIX', 'BOLETO', 'CREDIT_CARD']);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
    return res.status(400).json({ message: 'Informe o valor mensal cobrado dos alunos deste link.' });
  }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    return res.status(400).json({ message: 'O vencimento deve estar entre os dias 1 e 28.' });
  }
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) {
    return res.status(400).json({ message: 'A tolerância deve estar entre 0 e 60 dias.' });
  }
  if (!allowedBillingTypes.has(billingType)) {
    return res.status(400).json({ message: 'Escolha Pix, boleto ou cartão para a cobrança via Asaas.' });
  }
  const inviteToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSignupLinkToken(inviteToken);
  await db.query(
    `INSERT INTO student_signup_links (
       professor_user_id, token_hash, auto_approve, monthly_amount, due_day,
       billing_type, grace_days, auto_block, payment_description,
       payment_instructions, revoked_at, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NOW(),NOW())
     ON CONFLICT (professor_user_id)
     DO UPDATE SET token_hash = EXCLUDED.token_hash,
       auto_approve = EXCLUDED.auto_approve,
       monthly_amount = EXCLUDED.monthly_amount,
       due_day = EXCLUDED.due_day,
       billing_type = EXCLUDED.billing_type,
       grace_days = EXCLUDED.grace_days,
       auto_block = EXCLUDED.auto_block,
       payment_description = EXCLUDED.payment_description,
       payment_instructions = EXCLUDED.payment_instructions,
       revoked_at = NULL, updated_at = NOW()`,
    [
      req.user.id,
      tokenHash,
      req.body?.autoApprove === true,
      Number(monthlyAmount.toFixed(2)),
      dueDay,
      billingType,
      graceDays,
      req.body?.autoBlock !== false,
      sanitizeText(req.body?.description || 'Mensalidade de aulas', 240) || null,
      sanitizeText(req.body?.instructions || '', 800) || null
    ]
  );
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    professorName: req.user.fullName || (isGlobalAdmin(req) ? 'Admin' : 'Professor'),
    inviteUrl: `${origin}/login.html?invite=${inviteToken}`,
    autoApprove: req.body?.autoApprove === true,
    monthlyAmount: Number(monthlyAmount.toFixed(2)),
    dueDay,
    billingType,
    studentLimit: isProfessor(req) ? quotaStatus?.studentLimit ?? null : null,
    studentCount
  });
});

router.post('/students', async (req, res) => {
  await ensureOwnershipColumns();
  await ensureProfessorQuotaColumns();
  const fullName = sanitizeText(req.body?.fullName, 160);
  const email = sanitizeEmail(req.body?.email || '');
  const phone = sanitizePhone(req.body?.phone || '');
  const password = sanitizeText(req.body?.password || '', 256, { trim: false });
  const className = await ensureClassExists(req, req.body?.className || 'Turma A');
  const isActive = req.body?.isActive;
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha sÃ£o obrigatÃ³rios' });
  }
  const passwordError = getPasswordValidationError(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  try {
    await assertProfessorStudentLimit(req);
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      message: error.message,
      code: error.code || null,
      quotaStatus: error.quotaStatus || null
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, full_name, email, phone, password_hash, role, class_name, is_active, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, 'student', $6, $7, $8)`,
    [id, fullName, email, phone || null, hashedPassword, className || 'Turma A', isActive !== false, req.user.id]
  );

  res.status(201).json({ id, fullName, email });
});

router.post('/students/:id/enroll', async (req, res) => {
  await ensureOwnershipColumns();
  const { id } = req.params;
  const courseId = sanitizeText(req.body?.courseId || '', 80);
  if (!isUuid(id) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'courseId obrigatÃ³rio' });
  }
  const studentRow = await ensureProfessorOwnsStudent(req, id);
  const courseRow = await ensureProfessorOwnsCourse(req, courseId);
  if (!courseRow) {
    return res.status(404).json({ message: 'Curso nao encontrado' });
  }
  if (!studentRow) {
    return res.status(404).json({ message: 'Curso nÃ£o encontrado' });
  }
  await db.query(
    `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, updated_at)
     VALUES ($1, $2, 0, '0', 'MÃ³dulo 1', 0, NOW())
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [id, courseId]
  );
  res.status(204).send();
});

router.delete('/students/:id/enrollments/:courseId', async (req, res) => {
  const { id, courseId } = req.params;
  await ensureOwnershipColumns();
  if (!isUuid(id) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'Matricula invalida' });
  }
  if (!(await ensureProfessorOwnsStudent(req, id)) || !(await ensureProfessorOwnsCourse(req, courseId))) {
    return res.status(404).json({ message: 'Matricula nao encontrada' });
  }
  const params = [id, courseId];
  let query = `DELETE FROM enrollments
                     WHERE user_id = $1
                       AND course_id = $2
                       AND EXISTS (
                         SELECT 1
                           FROM users u
                           JOIN courses c ON c.id = enrollments.course_id
                          WHERE u.id = enrollments.user_id
                            AND u.role = 'student'`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND u.owner_user_id = $3 AND c.owner_user_id = $3';
  }
  query += ')';
  await db.query(query, params);
  res.status(204).send();
});

router.put('/students/:id', async (req, res) => {
  await ensureOwnershipColumns();
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno invalido' });
  }
  if (!(await ensureProfessorOwnsStudent(req, id))) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno invÃ¡lido' });
  }
  const fullName = sanitizeText(req.body?.fullName || '', 160);
  const hasClassName = Object.prototype.hasOwnProperty.call(req.body || {}, 'className');
  const className = hasClassName ? await ensureClassExists(req, req.body?.className || 'Turma A') : '';
  const isActive = req.body?.isActive;
  const phone = sanitizePhone(req.body?.phone || '');
  const updates = [];
  const values = [];
  let idx = 1;
  if (fullName) {
    updates.push(`full_name = $${idx}`);
    values.push(fullName);
    idx += 1;
  }
  if (phone) {
    updates.push(`phone = $${idx}`);
    values.push(phone);
    idx += 1;
  }
  if (hasClassName) {
    updates.push(`class_name = $${idx}`);
    values.push(className);
    idx += 1;
  }
  if (typeof isActive === 'boolean') {
    updates.push(`is_active = $${idx}`);
    values.push(isActive);
    idx += 1;
  }
  if (!updates.length) {
    return res.status(400).json({ message: 'Nenhum campo obrigatÃ³rio informado' });
  }

  values.push(id);
  const idParamIndex = values.length;
  if (isProfessor(req)) {
    values.push(req.user.id);
  }
  const { rowCount } = await db.query(
    `UPDATE users
        SET ${updates.join(', ')}
      WHERE ${buildStudentOwnershipWriteClause(req, idParamIndex)}`,
    values
  );
  if (!rowCount) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  res.status(204).send();
});

router.put('/students/:id/status', async (req, res) => {
  await ensureOwnershipColumns();
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno invalido' });
  }
  if (!(await ensureProfessorOwnsStudent(req, id))) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno invÃ¡lido' });
  }
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'Informe isActive como booleano' });
  }
  if (isActive && isProfessor(req)) {
    await ensureStudentSignupLinksTable();
    const current = await db.query(
      `SELECT student.is_active, request.status AS signup_status
         FROM users student
         LEFT JOIN student_signup_requests request ON request.student_user_id = student.id
        WHERE student.id = $1 AND student.role = 'student' AND student.owner_user_id = $2`,
      [id, req.user.id]
    );
    if (['PENDING', 'REJECTED'].includes(current.rows[0]?.signup_status)) {
      return res.status(409).json({ message: 'Use a ação Aprovar para autorizar este cadastro.' });
    }
    if (current.rows[0]?.is_active === false) await assertProfessorStudentLimit(req);
  }
  const params = [isActive, id];
  if (isProfessor(req)) {
    params.push(req.user.id);
  }
  const { rowCount } = await db.query(
    `UPDATE users
        SET is_active = $1
      WHERE ${buildStudentOwnershipWriteClause(req, 2)}`,
    params
  );
  if (!rowCount) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  res.status(204).send();
});

router.put('/students/:id/signup-approval', async (req, res) => {
  await ensureOwnershipColumns();
  await ensureProfessorQuotaColumns();
  await ensureStudentSignupLinksTable();
  const studentId = req.params.id;
  const decision = String(req.body?.decision || '').toUpperCase();
  if (!isUuid(studentId) || !['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ message: 'Informe uma decisão válida para o cadastro.' });
  }

  const client = await db.getClient();
  let signupRequest = null;
  try {
    await client.query('BEGIN');
    const params = [studentId];
    let ownershipSql = '';
    if (isProfessor(req)) {
      params.push(req.user.id);
      ownershipSql = ' AND request.professor_user_id = $2';
    }
    const { rows } = await client.query(
      `SELECT request.*, student.is_active, student.owner_user_id,
              professor.role AS professor_role, professor.student_limit
         FROM student_signup_requests request
         JOIN users student ON student.id = request.student_user_id AND student.role = 'student'
         JOIN users professor ON professor.id = request.professor_user_id
        WHERE request.student_user_id = $1${ownershipSql}
        FOR UPDATE OF request, student, professor`,
      params
    );
    signupRequest = rows[0];
    if (!signupRequest) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Solicitação de cadastro não encontrada.' });
    }

    if (decision === 'APPROVED' && !signupRequest.is_active) {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total
           FROM users
          WHERE role = 'student' AND owner_user_id = $1 AND is_active = TRUE`,
        [signupRequest.professor_user_id]
      );
      const activeStudents = Number(countResult.rows[0]?.total || 0);
      const studentLimit = Number(signupRequest.student_limit || 0);
      if (!canApproveStudent({
        professorRole: signupRequest.professor_role,
        studentLimit,
        activeStudents,
        alreadyActive: signupRequest.is_active
      })) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          message: `O limite de ${studentLimit} aluno(s) está preenchido. Adicione vagas ao plano para aprovar este cadastro.`,
          code: 'PROFESSOR_STUDENT_LIMIT_REACHED',
          quotaStatus: { studentLimit, studentCount: activeStudents },
          seatUpgrade: {
            available: signupRequest.professor_role === 'professor',
            unitPrice: getExtraStudentPrice(),
            minimumQuantity: 1
          }
        });
      }
    }

    await client.query(
      `UPDATE student_signup_requests
          SET status = $2, reviewed_at = NOW(), updated_at = NOW()
        WHERE student_user_id = $1`,
      [studentId, decision]
    );
    await client.query(
      `UPDATE users SET is_active = $2 WHERE id = $1 AND role = 'student'`,
      [studentId, decision === 'APPROVED']
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  let payment = null;
  let paymentWarning = null;
  if (decision === 'APPROVED' && signupRequest.monthly_amount !== null) {
    try {
      payment = await configureSignupPaymentPlan({
        professorId: signupRequest.professor_user_id,
        studentId,
        amount: signupRequest.monthly_amount,
        dueDay: signupRequest.due_day,
        preferredBillingType: signupRequest.billing_type,
        graceDays: signupRequest.grace_days,
        autoBlock: signupRequest.auto_block,
        description: signupRequest.payment_description,
        instructions: signupRequest.payment_instructions
      });
    } catch (error) {
      paymentWarning = 'O aluno foi aprovado, mas a cobrança automática precisa ser sincronizada no financeiro.';
      console.error('Falha ao preparar cobrança após aprovação:', error.message);
    }
  }
  res.json({ approved: decision === 'APPROVED', payment, paymentWarning });
});

router.delete('/students/:id', async (req, res) => {
  await ensureOwnershipColumns();
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: 'Aluno invalido' });
  }
  if (!(await ensureProfessorOwnsStudent(req, req.params.id))) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: 'Aluno invÃ¡lido' });
  }
  const params = [req.params.id];
  if (isProfessor(req)) {
    params.push(req.user.id);
  }
  const { rowCount } = await db.query(
    `DELETE FROM users
      WHERE ${buildStudentOwnershipWriteClause(req, 1)}`,
    params
  );
  if (!rowCount) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  res.status(204).send();
});

router.get('/reports', async (req, res) => {
  await ensureEnrollmentProgressColumns();
  await ensureReportCorrectionColumn();
  await ensureOwnershipColumns();
  const params = [];
  const reportVisibilityCondition = `
    (
      COALESCE(e.video_position, 0) > 0
      OR NULLIF(COALESCE(e.interactive_step, ''), '') IS NOT NULL AND COALESCE(e.interactive_step, '0') <> '0'
      OR NULLIF(COALESCE(e.current_module, ''), '') IS NOT NULL
      OR e.grade IS NOT NULL
      OR e.report_corrected_at IS NOT NULL
      OR COALESCE(jsonb_array_length(e.progress_events), 0) > 0
      OR COALESCE(e.quiz_attempts, '{}'::jsonb) <> '{}'::jsonb
      OR COALESCE(e.interactive_progress, '{}'::jsonb) <> '{}'::jsonb
      OR COALESCE(e.video_progress, '{}'::jsonb) <> '{}'::jsonb
      OR COALESCE(e.input_responses, '{}'::jsonb) <> '{}'::jsonb
    )`;
  let query = `SELECT u.id user_id, u.full_name, u.email, u.phone, u.class_name,
                      u.owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email,
                      c.id course_id, c.title course_title,
                      e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at,
                      e.report_corrected_at,
                      e.quiz_attempts, e.interactive_progress, e.video_progress,
                      COALESCE(jsonb_array_length(e.progress_events), 0) AS progress_event_count
               FROM enrollments e
               JOIN users u ON u.id = e.user_id
               JOIN courses c ON c.id = e.course_id
               LEFT JOIN users owner ON owner.id = u.owner_user_id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ` WHERE u.owner_user_id = $1 AND c.owner_user_id = $1 AND ${reportVisibilityCondition}`;
  } else {
    query += ` WHERE ${reportVisibilityCondition}`;
  }
  query += ' ORDER BY u.full_name, c.title';
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.post('/reports/:userId/:courseId/correct', async (req, res) => {
  await ensureReportCorrectionColumn();
  await ensureOwnershipColumns();
  const { userId, courseId } = req.params;
  if (!isUuid(userId) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'Parâmetros inválidos.' });
  }
  const params = [userId, courseId];
  let query = `
    UPDATE enrollments e
    SET report_corrected_at = NOW(), updated_at = NOW()
    FROM users u, courses c
    WHERE e.user_id = $1
      AND e.course_id = $2
      AND u.id = e.user_id
      AND c.id = e.course_id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND u.owner_user_id = $3 AND c.owner_user_id = $3';
  }
  query += ' RETURNING e.user_id, e.course_id, e.report_corrected_at';
  const { rows } = await db.query(query, params);
  if (!rows[0]) {
    return res.status(404).json({ message: 'Relatório não encontrado.' });
  }
  res.json({ ok: true, correctedAt: rows[0].report_corrected_at });
});

router.delete('/reports/:userId/:courseId/corrected', async (req, res) => {
  await ensureReportCorrectionColumn();
  await ensureOwnershipColumns();
  const { userId, courseId } = req.params;
  if (!isUuid(userId) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'Parâmetros inválidos.' });
  }
  const params = [userId, courseId];
  let query = `
    UPDATE enrollments e
    SET video_position = 0,
        interactive_step = NULL,
        current_module = NULL,
        grade = NULL,
        quiz_attempts = '{}'::jsonb,
        interactive_progress = '{}'::jsonb,
        video_progress = '{}'::jsonb,
        progress_events = '[]'::jsonb,
        input_responses = '{}'::jsonb,
        report_corrected_at = NULL,
        updated_at = NOW()
    FROM users u, courses c
    WHERE e.user_id = $1
      AND e.course_id = $2
      AND u.id = e.user_id
      AND c.id = e.course_id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND u.owner_user_id = $3 AND c.owner_user_id = $3';
  }
  query += ' RETURNING e.user_id, e.course_id';
  const { rows } = await db.query(query, params);
  if (!rows[0]) {
    return res.status(404).json({ message: 'Relatório não encontrado.' });
  }
  res.json({ ok: true });
});

router.get('/reports/:userId/:courseId/timeline', async (req, res) => {
  await ensureEnrollmentProgressColumns();
  const { userId, courseId } = req.params;
  if (!isUuid(userId) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'ParÃ¢metros invÃ¡lidos.' });
  }
  const params = [userId, courseId];
  let query =
    `SELECT u.full_name, u.email, c.title AS course_title, e.current_module, e.updated_at, e.progress_events
     FROM enrollments e
     JOIN users u ON u.id = e.user_id
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 AND e.course_id = $2`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND u.owner_user_id = $3 AND c.owner_user_id = $3';
  }
  const { rows } = await db.query(query, params);
  const enrollment = rows[0];
  if (!enrollment) {
    return res.status(404).json({ message: 'RelatÃ³rio nÃ£o encontrado.' });
  }
  const events = Array.isArray(enrollment.progress_events) ? [...enrollment.progress_events].reverse() : [];
  res.json({
    student: {
      fullName: enrollment.full_name,
      email: enrollment.email
    },
    course: {
      title: enrollment.course_title,
      currentModule: enrollment.current_module,
      updatedAt: enrollment.updated_at
    },
    events
  });
});

router.get('/reports/:userId/:courseId/replay', async (req, res) => {
  await ensureEnrollmentProgressColumns();
  await ensureOwnershipColumns();
  const { userId, courseId } = req.params;
  if (!isUuid(userId) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'ParÃ¢metros invÃ¡lidos.' });
  }
  const params = [userId, courseId];
  let query =
    `SELECT u.full_name, u.email,
            c.id AS course_id, c.title AS course_title, c.description AS course_description, c.slug AS course_slug,
            e.current_module, e.updated_at, e.video_position, e.interactive_step, e.grade,
            e.quiz_attempts, e.interactive_progress, e.video_progress, e.progress_events, e.input_responses
     FROM enrollments e
     JOIN users u ON u.id = e.user_id
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 AND e.course_id = $2`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND u.owner_user_id = $3 AND c.owner_user_id = $3';
  }
  const { rows } = await db.query(query, params);
  const enrollment = rows[0];
  if (!enrollment) {
    return res.status(404).json({ message: 'RelatÃ³rio nÃ£o encontrado.' });
  }
  const modulesResult = await db.query(
    `SELECT id, course_id, title, slug, description, builder_data, position, created_at
     FROM modules
     WHERE course_id = $1
     ORDER BY position NULLS LAST, created_at`,
    [courseId]
  );
  res.json({
    student: {
      id: userId,
      fullName: enrollment.full_name,
      email: enrollment.email
    },
    course: {
      id: enrollment.course_id,
      title: enrollment.course_title,
      description: enrollment.course_description,
      slug: enrollment.course_slug,
      currentModule: enrollment.current_module,
      updatedAt: enrollment.updated_at,
      progress: {
        video_position: enrollment.video_position || 0,
        interactive_step: enrollment.interactive_step || '0',
        current_module: enrollment.current_module,
        grade: enrollment.grade,
        quiz_attempts: enrollment.quiz_attempts || {},
        interactive_progress: enrollment.interactive_progress || {},
        video_progress: enrollment.video_progress || {},
        progress_events: Array.isArray(enrollment.progress_events) ? enrollment.progress_events : [],
        input_responses: enrollment.input_responses || {}
      }
    },
    modules: modulesResult.rows,
    events: Array.isArray(enrollment.progress_events) ? enrollment.progress_events : []
  });
});

router.get('/courses', async (req, res) => {
  await ensureCourseCoverColumn();
  await ensureCourseStoreColumn();
  await ensureCourseAccessRequestsTable();
  await ensureOwnershipColumns();
  const params = [];
  let query = `SELECT c.id, c.title, c.description, c.slug, c.cover_image, c.show_in_store,
                      c.owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email,
                      COALESCE(COUNT(DISTINCT m.id), 0) AS module_count,
                      COALESCE(COUNT(DISTINCT car.id) FILTER (WHERE car.status = 'pending'), 0) AS pending_request_count
               FROM courses c
               LEFT JOIN users owner ON owner.id = c.owner_user_id
               LEFT JOIN modules m ON m.course_id = c.id
               LEFT JOIN course_access_requests car ON car.course_id = c.id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' WHERE c.owner_user_id = $1';
  }
  query += `
               GROUP BY c.id, c.title, c.description, c.slug, c.cover_image, c.show_in_store,
                        c.owner_user_id, owner.full_name, owner.email
               ORDER BY c.title`;
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.get('/course-access-requests', async (req, res) => {
  await ensureCourseAccessRequestsTable();
  await ensureOwnershipColumns();
  const params = [];
  let query = `SELECT car.id, car.user_id, car.course_id, car.status, car.created_at, car.updated_at,
                      u.full_name AS student_name, u.email AS student_email, u.phone AS student_phone, u.class_name AS student_class_name,
                      c.title AS course_title, c.slug AS course_slug, c.cover_image AS course_cover_image
               FROM course_access_requests car
               JOIN users u ON u.id = car.user_id
               JOIN courses c ON c.id = car.course_id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' WHERE c.owner_user_id = $1';
  }
  query += `
               ORDER BY
                 CASE car.status
                   WHEN 'pending' THEN 0
                   WHEN 'approved' THEN 1
                   WHEN 'rejected' THEN 2
                   ELSE 3
                 END,
                 car.created_at DESC`;
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.post('/course-access-requests/:requestId/decision', async (req, res) => {
  await ensureCourseAccessRequestsTable();
  await ensureOwnershipColumns();
  const { requestId } = req.params;
  if (!isUuid(requestId)) {
    return res.status(400).json({ message: 'SolicitaÃ§Ã£o invÃ¡lida.' });
  }
  const decision = sanitizeText(req.body?.decision || '', 20).toLowerCase();
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Informe uma decisÃ£o vÃ¡lida.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT car.id, car.user_id, car.course_id, car.status, c.title AS course_title, u.full_name AS student_name
       FROM course_access_requests car
       JOIN courses c ON c.id = car.course_id
       JOIN users u ON u.id = car.user_id
       WHERE car.id = $1
       ${isProfessor(req) ? 'AND c.owner_user_id = $2' : ''}
       FOR UPDATE`,
      isProfessor(req) ? [requestId, req.user.id] : [requestId]
    );
    const request = rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'SolicitaÃ§Ã£o nÃ£o encontrada.' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Esta solicitaÃ§Ã£o jÃ¡ foi analisada.' });
    }

    await client.query(
      `UPDATE course_access_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [decision, requestId]
    );

    if (decision === 'approved') {
      await client.query(
        `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, updated_at)
         VALUES ($1, $2, 0, '0/0 slides', 'MÃ³dulo 1', 0, NOW())
         ON CONFLICT (user_id, course_id)
         DO NOTHING`,
        [request.user_id, request.course_id]
      );
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      status: decision,
      courseTitle: request.course_title,
      studentName: request.student_name
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.post('/courses', async (req, res) => {
  await ensureCourseCoverColumn();
  await ensureCourseStoreColumn();
  await ensureOwnershipColumns();
  await ensureProfessorQuotaColumns();
  const title = sanitizeText(req.body?.title || '', 180);
  const description = sanitizeText(req.body?.description || '', 4000);
  const slug = sanitizeSlug(req.body?.slug || title);
  const coverImage = sanitizeMediaUrl(req.body?.coverImage || '');
  const showInStore = req.body?.showInStore === true;
  if (!title || !slug) {
    return res.status(400).json({ message: 'TÃ­tulo e slug sÃ£o obrigatÃ³rios' });
  }
  try {
    await assertProfessorStorageLimit(req, estimateCourseStorageBytes({ title, description, slug, coverImage }));
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      message: error.message,
      code: error.code || null,
      quotaStatus: error.quotaStatus || null
    });
  }
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO courses (id, title, description, slug, cover_image, show_in_store, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, title, description || '', slug, coverImage, showInStore, isProfessor(req) ? req.user.id : null]
  );
  res.status(201).json({ id, title, description, slug, cover_image: coverImage, show_in_store: showInStore });
});

router.put('/courses/:id', async (req, res) => {
  await ensureOwnershipColumns();
  await ensureCourseCoverColumn();
  await ensureCourseStoreColumn();
  await ensureProfessorQuotaColumns();
  const { id } = req.params;
  if (!(await ensureProfessorOwnsCourse(req, id))) {
    return res.status(404).json({ message: 'Curso nao encontrado' });
  }
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Curso invÃ¡lido' });
  }
  const title = sanitizeText(req.body?.title || '', 180);
  const description = sanitizeText(req.body?.description || '', 4000);
  const slug = sanitizeSlug(req.body?.slug || '');
  const hasCoverImage = Object.prototype.hasOwnProperty.call(req.body || {}, 'coverImage');
  const coverImage = hasCoverImage ? sanitizeMediaUrl(req.body?.coverImage || '') : null;
  const hasShowInStore = Object.prototype.hasOwnProperty.call(req.body || {}, 'showInStore');
  const showInStore = hasShowInStore ? req.body?.showInStore === true : null;
  const existingCourseResult = await db.query(
    'SELECT title, description, slug, cover_image FROM courses WHERE id = $1',
    [id]
  );
  const existingCourse = existingCourseResult.rows[0];
  const nextCourseState = {
    title: title || existingCourse?.title || '',
    description: description || existingCourse?.description || '',
    slug: slug || existingCourse?.slug || '',
    coverImage: hasCoverImage ? coverImage : (existingCourse?.cover_image || '')
  };
  const storageDelta = estimateCourseStorageBytes(nextCourseState) - estimateCourseStorageBytes({
    title: existingCourse?.title || '',
    description: existingCourse?.description || '',
    slug: existingCourse?.slug || '',
    coverImage: existingCourse?.cover_image || ''
  });
  try {
    await assertProfessorStorageLimit(req, storageDelta);
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      message: error.message,
      code: error.code || null,
      quotaStatus: error.quotaStatus || null
    });
  }
  const updates = [];
  const values = [];
  let idx = 1;
  if (title) {
    updates.push(`title = $${idx}`);
    values.push(title);
    idx += 1;
  }
  if (description) {
    updates.push(`description = $${idx}`);
    values.push(description);
    idx += 1;
  }
  if (slug) {
    updates.push(`slug = $${idx}`);
    values.push(slug);
    idx += 1;
  }
  if (hasCoverImage) {
    updates.push(`cover_image = $${idx}`);
    values.push(coverImage);
    idx += 1;
  }
  if (hasShowInStore) {
    updates.push(`show_in_store = $${idx}`);
    values.push(showInStore);
    idx += 1;
  }
  if (!updates.length) {
    return res.status(400).json({ message: 'Informe pelo menos um campo para atualizar' });
  }
  values.push(id);
  await db.query(`UPDATE courses SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.status(204).send();
});

router.delete('/courses/:id', async (req, res) => {
  await ensureOwnershipColumns();
  if (!(await ensureProfessorOwnsCourse(req, req.params.id))) {
    return res.status(404).json({ message: 'Curso nao encontrado' });
  }
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: 'Curso invÃ¡lido' });
  }
  await db.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

router.get('/courses/:courseId/modules', async (req, res) => {
  await ensureOwnershipColumns();
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'Curso invÃ¡lido' });
  }
  if (!(await ensureProfessorOwnsCourse(req, courseId))) {
    return res.status(404).json({ message: 'Curso nao encontrado' });
  }
  const { rows } = await db.query(
    `SELECT id, course_id, title, slug, description, builder_data, position, created_at
     FROM modules
     WHERE course_id = $1
     ORDER BY position NULLS LAST, created_at`,
    [courseId]
  );
  res.json(rows);
});

router.get('/template-store', async (req, res) => {
  const templates = await readTemplateStoreCatalog();
  res.json({
    templates,
    folder: 'template-store'
  });
});

router.get('/template-store/:templateKey', async (req, res) => {
  const templateKey = String(req.params.templateKey || '').trim();
  if (!TEMPLATE_STORE_KEY_REGEX.test(templateKey)) {
    return res.status(400).json({ message: 'Template invÃ¡lido' });
  }
  const fileName = `${templateKey}.json`;
  const files = await readTemplateStoreFiles();
  if (!files.includes(fileName)) {
    return res.status(404).json({ message: 'Template nÃ£o encontrado' });
  }
  try {
    const template = await readTemplateStorePayload(fileName);
    res.json({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      description: template.description,
      category: template.category,
      summary: template.summary,
      payload: template.payload
    });
  } catch (error) {
    res.status(500).json({ message: 'NÃ£o foi possÃ­vel carregar o template da loja.' });
  }
});

router.post('/images/remove-background', mediaHeavyRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const src = sanitizeMediaUrl(req.body?.src || '');
  if (!src) {
    return res.status(400).json({ message: 'Informe a imagem para remover o fundo.' });
  }
  let creditCharge = null;
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a remocao de fundo com IA', { creditType: 'image' });
    const { rows } = await loadEffectiveAiSettings(req);
    const settingsRow = rows[0];
    if (!settingsRow?.image_encrypted_api_key || settingsRow.image_is_enabled === false) {
      return res.status(400).json({ message: 'Configure e ative a Nano Banana no painel admin antes de remover o fundo.' });
    }
    const imageSource = await readImageSource(src);
    const result = await generateBackgroundMaskWithNanoBanana({
      imageSettings: settingsRow,
      attachment: {
        name: imageSource.filename,
        mimeType: imageSource.mimeType,
        data: imageSource.buffer.toString('base64')
      }
    });
    res.json({
      ...result,
      platformCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    const message = error?.message || 'Nao foi possivel remover o fundo da imagem.';
    const statusCode =
      error?.statusCode ||
      (/Configure.*Nano Banana/i.test(message) ? 503 :
      /Falha ao chamar o provedor de imagem/i.test(message) ? 502 :
      /baixar a imagem/i.test(message) ? 400 :
      500);
    res.status(statusCode).json({
      message,
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/input/compare-image', mediaHeavyRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const referenceImage = sanitizeMediaUrl(req.body?.referenceImage || '');
  const submittedImage = sanitizeMediaUrl(req.body?.submittedImage || '');
  let creditCharge = null;
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a comparacao de imagens com IA', { creditType: 'image' });
    const referenceAttachment = await mediaUrlToImageAttachment(referenceImage, 'referencia');
    const submittedAttachment = await mediaUrlToImageAttachment(submittedImage, 'resposta');
    if (!referenceAttachment || !submittedAttachment) {
      return res.status(400).json({ message: 'Envie duas imagens validas em formato suportado.' });
    }
    const { rows } = await loadEffectiveAiSettings(req);
    const settingsRow = rows[0];
    if (!settingsRow?.image_encrypted_api_key || settingsRow.image_is_enabled === false) {
      return res.status(400).json({ message: 'Configure e ative a Nano Banana no painel admin antes de comparar imagens.' });
    }
    const result = await compareImagesWithNanoBanana({
      imageSettings: settingsRow,
      referenceAttachment,
      submittedAttachment
    });
    res.json({
      matched: Boolean(result.matched),
      confidence: result.confidence,
      reason: result.reason || '',
      platformCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    const message = error?.message || 'Nao foi possivel comparar as imagens.';
    res.status(error?.statusCode || 500).json({
      message,
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/media/extract-audio', mediaHeavyRateLimiter, async (req, res) => {
  const src = sanitizeMediaUrl(req.body?.src || '');
  if (!src) {
    return res.status(400).json({ message: 'Informe o video para extrair o audio.' });
  }
  try {
    const result = await extractAudioFromMediaSource(src);
    res.json(result);
  } catch (error) {
    const message = error?.message || 'Nao foi possivel extrair o audio do video.';
    const statusCode =
      /baixar a midia/i.test(message) ? 400 :
      /nao parece ser um arquivo de video/i.test(message) ? 400 :
      /whisper/i.test(message) ? 503 :
      500;
    res.status(statusCode).json({ message });
  }
});

router.post('/media/transcribe', mediaHeavyRateLimiter, async (req, res) => {
  const sourceType = String(req.body?.sourceType || 'audio').trim().toLowerCase() === 'video' ? 'video' : 'audio';
  const src = sanitizeMediaUrl(req.body?.src || '');
  if (!src) {
    return res.status(400).json({ message: 'Informe a midia para transcrever.' });
  }
  let creditCharge = null;
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a transcrição de mídia com IA');
    const result = await transcribeMediaSource(src, { sourceType, language: 'pt' });
    res.json({
      ...result,
      platformCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    const message = error?.message || 'Nao foi possivel transcrever a midia.';
    const statusCode =
      error?.statusCode ||
      (/baixar a midia/i.test(message) ? 400 :
      /arquivo de (audio|video)/i.test(message) ? 400 :
      /whisper/i.test(message) ? 503 :
      500);
    res.status(statusCode).json({
      message,
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/courses/:courseId/modules', async (req, res) => {
  await ensureOwnershipColumns();
  await ensureProfessorQuotaColumns();
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'Curso invÃ¡lido' });
  }
  const { cleanTitle, cleanDescription, cleanSlug, cleanBuilderData } = sanitizeModulePayload(req.body || {});
  const faceSettingsError = getModuleFaceSettingsError(cleanBuilderData);
  if (faceSettingsError) {
    return res.status(400).json({ message: faceSettingsError, code: 'PUBLIC_FACE_VERIFICATION_CONFLICT' });
  }
  if (!cleanTitle || !cleanBuilderData || !Array.isArray(cleanBuilderData.slides)) {
    return res.status(400).json({ message: 'TÃ­tulo e conteÃºdo do mÃ³dulo sÃ£o obrigatÃ³rios' });
  }
  if (!(await ensureProfessorOwnsCourse(req, courseId))) {
    return res.status(404).json({ message: 'Curso nÃ£o encontrado' });
  }
  try {
    await assertProfessorStorageLimit(req, estimateModuleStorageBytes({
      title: cleanTitle,
      description: cleanDescription,
      slug: cleanSlug,
      builderData: cleanBuilderData
    }));
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      message: error.message,
      code: error.code || null,
      quotaStatus: error.quotaStatus || null
    });
  }
  const moduleSlugCandidate = cleanSlug || slugify(cleanTitle);
  const id = crypto.randomUUID();
  const moduleSlug = moduleSlugCandidate || id;
  await db.query(
    `INSERT INTO modules (id, course_id, title, slug, description, builder_data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, courseId, cleanTitle, moduleSlug, cleanDescription, cleanBuilderData, req.user.id]
  );
  res.status(201).json({ id });
});

router.put('/courses/:courseId/modules/:moduleId', async (req, res) => {
  await ensureOwnershipColumns();
  await ensureProfessorQuotaColumns();
  const { courseId, moduleId } = req.params;
  if (!isUuid(courseId) || !isUuid(moduleId)) {
    return res.status(400).json({ message: 'MÃ³dulo invÃ¡lido' });
  }
  if (!(await ensureProfessorOwnsCourse(req, courseId))) {
    return res.status(404).json({ message: 'Curso nÃ£o encontrado' });
  }
  const { cleanTitle, cleanDescription, cleanSlug, cleanBuilderData } = sanitizeModulePayload(req.body || {});
  const faceSettingsError = getModuleFaceSettingsError(cleanBuilderData);
  if (faceSettingsError) {
    return res.status(400).json({ message: faceSettingsError, code: 'PUBLIC_FACE_VERIFICATION_CONFLICT' });
  }
  if (!cleanTitle || !cleanBuilderData || !Array.isArray(cleanBuilderData.slides)) {
    return res.status(400).json({ message: 'TÃ­tulo e conteÃºdo do mÃ³dulo sÃ£o obrigatÃ³rios' });
  }
  const { rows: moduleRows } = await db.query(
    'SELECT id, title, description, slug, builder_data FROM modules WHERE id = $1 AND course_id = $2',
    [moduleId, courseId]
  );
  if (!moduleRows.length) {
    return res.status(404).json({ message: 'MÃ³dulo nÃ£o encontrado' });
  }
  const previousModule = moduleRows[0];
  const storageDelta = estimateModuleStorageBytes({
    title: cleanTitle,
    description: cleanDescription,
    slug: cleanSlug,
    builderData: cleanBuilderData
  }) - estimateModuleStorageBytes({
    title: previousModule.title,
    description: previousModule.description,
    slug: previousModule.slug,
    builderData: previousModule.builder_data
  });
  try {
    await assertProfessorStorageLimit(req, storageDelta);
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      message: error.message,
      code: error.code || null,
      quotaStatus: error.quotaStatus || null
    });
  }
  const moduleSlugCandidate = cleanSlug || slugify(cleanTitle);
  const moduleSlug = moduleSlugCandidate || moduleId;
  await db.query(
    `UPDATE modules
     SET title = $1,
         description = $2,
         builder_data = $3,
         slug = $4,
         updated_at = NOW()
     WHERE id = $5 AND course_id = $6`,
    [cleanTitle, cleanDescription, cleanBuilderData, moduleSlug, moduleId, courseId]
  );
  res.status(204).send();
});

router.delete('/courses/:courseId/modules/:moduleId', async (req, res) => {
  await ensureOwnershipColumns();
  const { courseId, moduleId } = req.params;
  if (!isUuid(courseId) || !isUuid(moduleId)) {
    return res.status(400).json({ message: 'MÃ³dulo invÃ¡lido' });
  }
  if (!(await ensureProfessorOwnsCourse(req, courseId))) {
    return res.status(404).json({ message: 'Curso nÃ£o encontrado' });
  }
  const { rows: moduleRows } = await db.query(
    'SELECT id FROM modules WHERE id = $1 AND course_id = $2',
    [moduleId, courseId]
  );
  if (!moduleRows.length) {
    return res.status(404).json({ message: 'MÃ³dulo nÃ£o encontrado' });
  }
  await db.query('DELETE FROM modules WHERE id = $1 AND course_id = $2', [moduleId, courseId]);
  res.status(204).send();
});

router.get('/notifications', async (req, res) => {
  await ensureOwnershipColumns();
  const params = [];
  let query = `SELECT n.id, n.message, n.target_type, n.target_value, n.attachments, n.created_by, n.created_at,
                      n.owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email
               FROM notifications n
               LEFT JOIN users owner ON owner.id = n.owner_user_id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' WHERE n.owner_user_id = $1';
  }
  query += ' ORDER BY n.created_at DESC LIMIT 50';
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.get('/notifications/:notificationId/attachments/:attachmentIndex', async (req, res) => {
  await ensureOwnershipColumns();
  const { notificationId, attachmentIndex } = req.params;
  if (!isUuid(notificationId)) {
    return res.status(400).json({ message: 'Notificacao invalida' });
  }
  const params = [notificationId];
  let query = 'SELECT attachments FROM notifications WHERE id = $1';
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' AND owner_user_id = $2';
  }
  const { rows } = await db.query(query, params);
  const attachment = getNotificationDataAttachment(rows[0]?.attachments, attachmentIndex);
  if (!attachment) {
    return res.status(404).json({ message: 'Anexo nao encontrado.' });
  }
  sendNotificationDataAttachment(res, attachment);
});

router.post('/notifications', async (req, res) => {
  await ensureOwnershipColumns();
  const message = sanitizeNotificationMessage(req.body?.message || '');
  const targetType = sanitizeText(req.body?.targetType || '', 20);
  const targetValue = sanitizeText(req.body?.targetValue || '', 120);
  const attachments = sanitizeNotificationAttachments(req.body?.attachments || req.body?.attachmentUrls || [], message);
  if (!message) {
    return res.status(400).json({ message: 'Mensagem obrigatÃ³ria' });
  }
  if (!['student', 'class', 'all'].includes(targetType)) {
    return res.status(400).json({ message: 'targetType deve ser student, class ou all' });
  }
  const attachmentBytes = estimateNotificationAttachmentsStorageBytes(attachments);
  if (attachmentBytes > 0) {
    try {
      await assertProfessorStorageLimit(req, attachmentBytes);
    } catch (error) {
      return res.status(error?.statusCode || 403).json({
        message: error.message || 'O limite de armazenamento deste professor foi atingido.',
        code: error.code || 'PROFESSOR_STORAGE_LIMIT_REACHED',
        quotaStatus: error.quotaStatus || null
      });
    }
  }
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO notifications (id, message, target_type, target_value, attachments, created_by, owner_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [id, message, targetType, targetValue || null, JSON.stringify(attachments), req.user.id, isProfessor(req) ? req.user.id : null]
  );
  res.status(201).json({ id, attachments });
});

router.delete('/notifications/:notificationId', async (req, res) => {
  const { notificationId } = req.params;
  if (!isUuid(notificationId)) {
    return res.status(400).json({ message: 'NotificaÃ§Ã£o invÃ¡lida' });
  }
  const { rowCount } = await db.query(
    `DELETE FROM notifications
      WHERE id = $1${isProfessor(req) ? ' AND owner_user_id = $2' : ''}`,
    isProfessor(req) ? [notificationId, req.user.id] : [notificationId]
  );
  if (!rowCount) {
    return res.status(404).json({ message: 'NotificaÃ§Ã£o nÃ£o encontrada' });
  }
  res.status(204).send();
});

router.get('/ai-settings', async (req, res) => {
  await ensureAdminAiImageColumns();
  const { rows } = await loadEffectiveAiSettings(req);
  res.json({
    ...buildPublicAiSettings(rows[0], { includeCreditCost: false }),
    platformCreditCosts: await getCreditCosts()
  });
});

router.put('/ai-settings', async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) return;
  await ensureAdminAiImageColumns();
  const {
    providerKey,
    providerLabel,
    baseUrl,
    model,
    apiKey,
    systemPrompt,
    requireConfirmation,
    isEnabled,
    imageProviderLabel,
    imageProviderKey,
    imageBaseUrl,
    imageModel,
    imageApiKey,
    imageEnabled,
    aiCreditCostPerCall,
    aiTextCreditCostPerCall,
    aiImageCreditCostPerCall,
    threeDImportCreditCost
  } = req.body || {};
  if (!baseUrl || !model) {
    return res.status(400).json({ message: 'baseUrl e model sÃ£o obrigatÃ³rios.' });
  }
  if (!imageBaseUrl || !imageModel) {
    return res.status(400).json({ message: 'imageBaseUrl e imageModel sÃ£o obrigatÃ³rios.' });
  }

  const cleanBaseUrl = sanitizeMediaUrl(baseUrl, { allowData: false }).replace(/\/+$/, '');
  const cleanModel =
    String(providerKey || '').trim().toLowerCase() === 'deepseek' && String(model || '').trim() === 'deepseek-chat'
      ? DEFAULT_DEEPSEEK_MODEL
      : String(model).trim();
  const cleanProviderKey = String(providerKey || 'custom-compatible').trim() || 'custom-compatible';
  const cleanProviderLabel = String(providerLabel || 'Provedor compatÃ­vel').trim() || 'Provedor compatÃ­vel';
  const cleanImageBaseUrl = sanitizeMediaUrl(imageBaseUrl, { allowData: false }).replace(/\/+$/, '');
  const cleanImageModel = String(imageModel || 'gemini-2.5-flash-image').trim() || 'gemini-2.5-flash-image';
  const cleanImageProviderKey = String(imageProviderKey || 'google-gemini-image').trim() || 'google-gemini-image';
  const cleanImageProviderLabel = String(imageProviderLabel || 'Nano Banana').trim() || 'Nano Banana';
  const currentCosts = await getCreditCosts();
  const cleanAiCreditCostPerCall = parsePlatformCreditCostInput(aiTextCreditCostPerCall ?? aiCreditCostPerCall) ?? currentCosts.text;
  const cleanImageAiCreditCostPerCall = parsePlatformCreditCostInput(aiImageCreditCostPerCall) ?? currentCosts.image;
  const cleanThreeDImportCreditCost = parsePlatformCreditCostInput(threeDImportCreditCost) ?? currentCosts.threeDImport;

  const { rows: existingRows } = await db.query(
    'SELECT encrypted_api_key, image_encrypted_api_key FROM admin_ai_settings WHERE admin_user_id = $1',
    [req.user.id]
  );
  const encryptedApiKey = apiKey
    ? encryptApiKey(String(apiKey).trim())
    : existingRows[0]?.encrypted_api_key;
  const encryptedImageApiKey = imageApiKey
    ? encryptApiKey(String(imageApiKey).trim())
    : existingRows[0]?.image_encrypted_api_key;

  if (!encryptedApiKey) {
    return res.status(400).json({ message: 'Informe uma API key para salvar a integraÃ§Ã£o.' });
  }
  if (!encryptedImageApiKey) {
    return res.status(400).json({ message: 'Informe a API key da Nano Banana para salvar a integraÃ§Ã£o.' });
  }

  await db.query(
    `INSERT INTO admin_ai_settings (
       admin_user_id, provider_key, provider_label, base_url, model, encrypted_api_key,
       system_prompt, require_confirmation, is_enabled, updated_at,
       image_provider_key, image_provider_label, image_base_url, image_model, image_encrypted_api_key, image_is_enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13, $14, $15)
      ON CONFLICT (admin_user_id)
      DO UPDATE SET
       provider_key = EXCLUDED.provider_key,
       provider_label = EXCLUDED.provider_label,
       base_url = EXCLUDED.base_url,
       model = EXCLUDED.model,
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       system_prompt = EXCLUDED.system_prompt,
       require_confirmation = EXCLUDED.require_confirmation,
       is_enabled = EXCLUDED.is_enabled,
       image_provider_key = EXCLUDED.image_provider_key,
       image_provider_label = EXCLUDED.image_provider_label,
       image_base_url = EXCLUDED.image_base_url,
       image_model = EXCLUDED.image_model,
       image_encrypted_api_key = EXCLUDED.image_encrypted_api_key,
       image_is_enabled = EXCLUDED.image_is_enabled,
       updated_at = NOW()`,
    [
      req.user.id,
      cleanProviderKey,
      cleanProviderLabel,
      cleanBaseUrl,
      cleanModel,
      encryptedApiKey,
      systemPrompt ? sanitizeText(systemPrompt, 8000, { trim: false }) : null,
      requireConfirmation !== false,
      isEnabled !== false,
      cleanImageProviderKey,
      cleanImageProviderLabel,
      cleanImageBaseUrl,
      cleanImageModel,
      encryptedImageApiKey,
      imageEnabled !== false
    ]
  );

  await updateCreditCosts(req.user.id, {
    text: cleanAiCreditCostPerCall,
    image: cleanImageAiCreditCostPerCall,
    threeDImport: cleanThreeDImportCreditCost
  });
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  res.json({
    ...buildPublicAiSettings(rows[0], { includeCreditCost: false }),
    platformCreditCosts: await getCreditCosts()
  });
});

router.post('/ai-settings/test', aiRequestRateLimiter, async (req, res) => {
  if (!ensureGlobalAdmin(req, res)) return;
  await ensureAdminAiImageColumns();
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'Configure e ative a integraÃ§Ã£o antes de testar.' });
  }
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'o teste da integracao de IA');
    const reply = await testAiConnection(settingsRow);
    res.json({ ok: true, reply, platformCreditsRemaining: creditCharge?.remainingCredits ?? null });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({ message: error.message || 'Nao foi possivel validar a integracao.', code: error?.code || null, platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null });
  }
});

router.post('/assistant/chat', aiRequestRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  await ensureAssistantTables();
  const rawMessage = sanitizeText(req.body?.message || '', 2000, { trim: true });
  if (!rawMessage) {
    return res.status(400).json({ message: 'Escreva o que você quer fazer no painel.' });
  }
  if (containsSensitiveRequest(rawMessage)) {
    return res.json({
      reply: 'Não posso mostrar ou manipular senhas, tokens, chaves, configurações privadas ou código interno. Posso ajudar com alunos, cursos, matrículas, relatórios, notificações, chats e o financeiro dos alunos.',
      actions: [],
      proposalId: null,
      requiresConfirmation: false
    });
  }
  const { rows } = await loadEffectiveAiSettings(req);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'Ative a integração de IA para usar a assistente do painel.' });
  }

  let creditCharge = null;
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a assistente do painel');
    const context = await loadAssistantContext(req.user);
    const modelPayload = await proposeAdminAssistantTurn({
      settingsRow,
      message: redactSecrets(rawMessage),
      history: cleanHistory(req.body?.history),
      context
    });
    const response = normalizeAssistantResponse(modelPayload, context);
    const proposal = await storeProposal({
      userId: req.user.id,
      requestText: rawMessage,
      response
    });
    return res.json({
      reply: response.reply,
      actions: response.actions.map(({ label, summary, dangerous }) => ({ label, summary, dangerous })),
      proposalId: proposal?.id || null,
      proposalExpiresAt: proposal?.expiresAt || null,
      requiresConfirmation: response.actions.length > 0,
      platformCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    return res.status(error?.statusCode || 400).json({
      message: error.message || 'A assistente não conseguiu processar o pedido.',
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/assistant/proposals/:proposalId/execute', aiRequestRateLimiter, async (req, res) => {
  try {
    const results = await executeProposal({
      proposalId: req.params.proposalId,
      user: req.user
    });
    return res.json({
      success: true,
      message: results.length === 1
        ? results[0].result
        : `${results.length} ações foram executadas com sucesso.`,
      results
    });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({
      message: error.message || 'Não foi possível executar a proposta.'
    });
  }
});

router.get('/assistant/audit', async (req, res) => {
  await ensureAssistantTables();
  const { rows } = await db.query(
    `SELECT id, proposal_id, action_type, action_summary, status, error_message, created_at
     FROM admin_ai_assistant_audit
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/ai/slide-actions', aiRequestRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const slides = sanitizeBuilderData({ slides: Array.isArray(req.body?.slides) ? req.body.slides : [] }).slides || [];
  const activeSlideId = sanitizeText(req.body?.activeSlideId || '', 120);
  const selectedElementId = sanitizeText(req.body?.selectedElementId || '', 120);
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  const executionPlan = req.body?.executionPlan && typeof req.body.executionPlan === 'object' ? req.body.executionPlan : null;
  const currentPlanItem = req.body?.currentPlanItem && typeof req.body.currentPlanItem === 'object' ? req.body.currentPlanItem : null;
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que a IA deve fazer.' });
  }
  let creditCharge = null;
  let imageCreditCharge = null;
  const { rows } = await loadEffectiveAiSettings(req);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integraÃ§Ã£o de IA deste admin nÃ£o estÃ¡ configurada ou ativa.' });
  }

  try {
    const usesPlannedDeterministicLayout = (
      executionPlan?.mode === 'deck'
      && Boolean(currentPlanItem?.targetSlideId || currentPlanItem?.id)
      && Boolean(currentPlanItem?.contentBrief?.keyMessage)
    );
    if (!usesPlannedDeterministicLayout) {
      creditCharge = await consumeProfessorAiCredit(req, 'o assistente de IA para slides');
    }
    const actions = await proposeSlideActions({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      selectedElementId: selectedElementId || null,
      stageSize: stageSize || null,
      attachments: Array.isArray(attachments) ? attachments : [],
      executionPlan,
      currentPlanItem
    });
    const generatedImageCount = countGeneratedImageCharges(actions);
    if (generatedImageCount > 0) {
      imageCreditCharge = await consumeProfessorAiCredit(req, 'a geracao de imagem com IA', {
        creditType: 'image',
        units: generatedImageCount
      });
    }
    res.json({
      actions,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      platformCreditsRemaining: imageCreditCharge?.remainingCredits ?? creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (imageCreditCharge?.charged) {
      await imageCreditCharge.refund();
    }
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nÃ£o conseguiu propor aÃ§Ãµes vÃ¡lidas.',
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/ai/slide-actions/plan', aiRequestRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const slides = sanitizeBuilderData({ slides: Array.isArray(req.body?.slides) ? req.body.slides : [] }).slides || [];
  const activeSlideId = sanitizeText(req.body?.activeSlideId || '', 120);
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que a IA deve fazer.' });
  }
  let creditCharge = null;
  const { rows } = await loadEffectiveAiSettings(req);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integraÃ§Ã£o de IA deste admin nÃ£o estÃ¡ configurada ou ativa.' });
  }

  try {
    creditCharge = await consumeProfessorAiCredit(req, 'o planejamento de slides com IA');
    const plan = await proposeSlideExecutionPlan({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      stageSize: stageSize || null,
      attachments: Array.isArray(attachments) ? attachments : []
    });
    res.json({
      plan,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      platformCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nÃ£o conseguiu planejar a execuÃ§Ã£o.',
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/ai/slide-actions/step', aiRequestRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const slides = sanitizeBuilderData({ slides: Array.isArray(req.body?.slides) ? req.body.slides : [] }).slides || [];
  const activeSlideId = sanitizeText(req.body?.activeSlideId || '', 120);
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const stepIndex = Number.isFinite(Number(req.body?.stepIndex)) ? Number(req.body.stepIndex) : 0;
  const reviewMode = Boolean(req.body?.reviewMode);
  const recentActions = Array.isArray(req.body?.recentActions) ? req.body.recentActions.slice(0, 30) : [];
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  const executionPlan = req.body?.executionPlan && typeof req.body.executionPlan === 'object' ? req.body.executionPlan : null;
  const currentPlanItem = req.body?.currentPlanItem && typeof req.body.currentPlanItem === 'object' ? req.body.currentPlanItem : null;
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que a IA deve fazer.' });
  }
  let creditCharge = null;
  let imageCreditCharge = null;
  const { rows } = await loadEffectiveAiSettings(req);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integraÃ§Ã£o de IA deste admin nÃ£o estÃ¡ configurada ou ativa.' });
  }

  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a geração incremental de ações com IA');
    const result = await proposeNextSlideAction({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      stageSize: stageSize || null,
      stepIndex,
      reviewMode,
      recentActions,
      attachments,
      executionPlan,
      currentPlanItem
    });
    const generatedImageCount = countGeneratedImageCharges(result?.action ? [result.action] : []);
    if (generatedImageCount > 0) {
      imageCreditCharge = await consumeProfessorAiCredit(req, 'a geracao de imagem com IA', {
        creditType: 'image',
        units: generatedImageCount
      });
    }
    res.json({
      ...result,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      platformCreditsRemaining: imageCreditCharge?.remainingCredits ?? creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (imageCreditCharge?.charged) {
      await imageCreditCharge.refund();
    }
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nÃ£o conseguiu gerar a prÃ³xima aÃ§Ã£o.',
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/ai/magic-pen', aiRequestRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const slides = sanitizeBuilderData({ slides: Array.isArray(req.body?.slides) ? req.body.slides : [] }).slides || [];
  const activeSlideId = sanitizeText(req.body?.activeSlideId || '', 120);
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  const sourceBounds = req.body?.sourceBounds && typeof req.body.sourceBounds === 'object' ? req.body.sourceBounds : null;
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que o pincel magico deve criar.' });
  }
  let creditCharge = null;
  let imageCreditCharge = null;
  const { rows } = await loadEffectiveAiSettings(req);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integracao de IA deste admin nao esta configurada ou ativa.' });
  }

  try {
    creditCharge = await consumeProfessorAiCredit(req, 'o pincel magico');
    const result = await proposeMagicPenActions({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      stageSize: stageSize || null,
      attachments,
      sourceBounds
    });
    const generatedImageCount = countGeneratedImageCharges(result);
    if (generatedImageCount > 0) {
      imageCreditCharge = await consumeProfessorAiCredit(req, 'a geracao de imagem com IA no pincel magico', {
        creditType: 'image',
        units: generatedImageCount
      });
    }
    res.json({
      ...result,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      platformCreditsRemaining: imageCreditCharge?.remainingCredits ?? creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (imageCreditCharge?.charged) {
      await imageCreditCharge.refund();
    }
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nao conseguiu executar o pincel magico.',
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.post('/ai/edit-image-element', aiRequestRateLimiter, async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const sourceImage = sanitizeMediaUrl(req.body?.src || '');
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const sourceBounds = req.body?.sourceBounds && typeof req.body.sourceBounds === 'object' ? req.body.sourceBounds : null;
  if (!request) {
    return res.status(400).json({ message: 'Descreva como a IA deve editar a imagem base.' });
  }
  if (!sourceImage) {
    return res.status(400).json({ message: 'Informe a imagem base para editar.' });
  }
  let imageCreditCharge = null;
  const { rows } = await loadEffectiveAiSettings(req);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integracao de IA deste admin nao esta configurada ou ativa.' });
  }

  try {
    const attachment = await mediaUrlToImageAttachment(sourceImage, 'imagem-base');
    if (!attachment) {
      return res.status(400).json({ message: 'Nao foi possivel preparar a imagem base para a IA.' });
    }
    imageCreditCharge = await consumeProfessorAiCredit(req, 'a edicao de imagem com IA no editor de imagem', {
      creditType: 'image'
    });
    const src = await editImageElementWithNanoBanana({
      settingsRow,
      request,
      attachments: [attachment],
      sourceBounds,
      stageSize
    });
    res.json({
      src,
      providerLabel: settingsRow.provider_label,
      platformCreditsRemaining: imageCreditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (imageCreditCharge?.charged) {
      await imageCreditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nao conseguiu editar a imagem base.',
      code: error?.code || null,
      platformCreditsRemaining: error?.platformCredits ?? error?.creditStatus?.platformCredits ?? null
    });
  }
});

router.get('/smtp-settings', async (req, res) => {
  await ensureAdminSmtpSettingsTable();
  if (!isGlobalAdmin(req)) {
    return res.status(403).json({ message: 'Somente o admin principal pode visualizar o SMTP.' });
  }
  const { rows } = await db.query('SELECT host, port, secure, user_email, user_pass, from_email FROM admin_smtp_settings WHERE id = 1');
  res.json(sanitizeSmtpSettingsResponse(rows[0] || null, { usingFallback: false, scope: 'admin' }));
});

router.put('/smtp-settings', async (req, res) => {
  await ensureAdminSmtpSettingsTable();
  if (!isGlobalAdmin(req)) {
    return res.status(403).json({ message: 'Somente o admin principal pode configurar o SMTP.' });
  }
  const { host, port, secure, user_email, user_pass, from_email } = req.body || {};
  const cleanHost = sanitizeText(host || '', 255);
  const cleanUserEmail = sanitizeEmail(user_email || '');
  const cleanFromEmail = sanitizeEmail(from_email || '');
  const cleanPassword = sanitizeText(user_pass || '', 512, { trim: false });
  const encryptedPassword = cleanPassword ? encryptSecret(cleanPassword) : '';
  const cleanPort = Number.isFinite(Number(port)) ? Number(port) : null;
  const cleanSecure = secure !== false;

  if (cleanPort !== null && (!Number.isInteger(cleanPort) || cleanPort < 1 || cleanPort > 65535)) {
    return res.status(400).json({ message: 'Porta SMTP invalida.' });
  }
  if (cleanHost) {
    try {
      await assertSafeRemoteUrl(`https://${cleanHost}`);
    } catch (error) {
      return res.status(400).json({ message: 'O servidor SMTP informado nao e permitido.' });
    }
  }

  const { rows } = await db.query('SELECT user_pass FROM admin_smtp_settings WHERE id = 1');
  if (rows.length === 0) {
    await db.query(
      'INSERT INTO admin_smtp_settings (id, host, port, secure, user_email, user_pass, from_email) VALUES (1, $1, $2, $3, $4, $5, $6)',
      [cleanHost, cleanPort, cleanSecure, cleanUserEmail, encryptedPassword, cleanFromEmail]
    );
  } else {
    const nextPassword = encryptedPassword || rows[0]?.user_pass || '';
    await db.query(
      'UPDATE admin_smtp_settings SET host = $1, port = $2, secure = $3, user_email = $4, user_pass = $5, from_email = $6, updated_at = NOW() WHERE id = 1',
      [cleanHost, cleanPort, cleanSecure, cleanUserEmail, nextPassword, cleanFromEmail]
    );
  }
  res.status(204).send();
});

module.exports = router;

