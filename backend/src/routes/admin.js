const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { encryptApiKey } = require('../aiConfigCrypto');
const {
  buildPublicAiSettings,
  proposeMagicPenActions,
  proposeNextSlideAction,
  proposeSlideExecutionPlan,
  proposeSlideActions,
  testAiConnection,
  generateBackgroundMaskWithNanoBanana,
  compareImagesWithNanoBanana
} = require('../aiProvider');
const { readImageSource } = require('../pixian');
const { extractAudioFromMediaSource, transcribeMediaSource } = require('../mediaProcessing');
const { createShare, updateShare, deleteShare, clearDrawingStrokes, removeDrawingStroke, getShare, updateCursorPosition, listCursorPositions } = require('../liveStageShareStore');
const {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeSlug,
  sanitizeMediaUrl,
  sanitizeBuilderData,
  sanitizeNotificationMessage,
  isUuid
} = require('../security');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['admin', 'professor']));
const TEMPLATE_STORE_DIR = path.resolve(__dirname, '../../../template-store');
const TEMPLATE_STORE_KEY_REGEX = /^[a-z0-9._-]+$/i;
let courseCoverColumnEnsured = false;
let courseStoreColumnEnsured = false;
let courseAccessRequestsTableEnsured = false;
let classesTableEnsured = false;
let progressEventsColumnEnsured = false;
let adminSmtpSettingsEnsured = false;
let professorSmtpSettingsEnsured = false;
let ownershipColumnsEnsured = false;
let professorCreditColumnsEnsured = false;
let professorQuotaColumnsEnsured = false;
let reportCorrectionColumnEnsured = false;
let studentSignupLinksTableEnsured = false;
const LIVE_STAGE_SHARE_ID_REGEX = /^[0-9a-f]{32}$/i;

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

const sanitizeLiveStageSharePayload = (payload = {}) => ({
  moduleId: isUuid(payload?.moduleId) ? payload.moduleId : null,
  courseId: isUuid(payload?.courseId) ? payload.courseId : null,
  title: sanitizeText(payload?.title || 'Palco ao vivo', 180) || 'Palco ao vivo',
  description: sanitizeText(payload?.description || '', 4000) || null,
  activeSlideId: sanitizeText(payload?.activeSlideId || '', 120) || null,
  builderData: sanitizeBuilderData(payload?.builderData)
});

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
  if (professorCreditColumnsEnsured) {
    return;
  }
  await db.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_credits NUMERIC(12,2) NOT NULL DEFAULT 0'
  );
  await db.query(
    'ALTER TABLE users ALTER COLUMN ai_credits TYPE NUMERIC(12,2) USING COALESCE(ai_credits, 0)::numeric(12,2)'
  );
  await db.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_credits_updated_at TIMESTAMPTZ DEFAULT NOW()'
  );
  professorCreditColumnsEnsured = true;
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
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  studentSignupLinksTableEnsured = true;
};

router.post('/live-stage-shares', async (req, res) => {
  const payload = sanitizeLiveStageSharePayload(req.body);
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
  const share = updateShare(shareId, req.user.id, payload);
  if (!share) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }
  res.json(buildLiveStageShareResponse(share));
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

  const success = removeDrawingStroke(shareId, strokeId);
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

const hashSignupLinkToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const getProfessorCreditsValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Number(numeric.toFixed(2))) : 0;
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

const parseAiCreditCostInput = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Number(numeric.toFixed(2));
};

const ensureGlobalAdmin = (req, res) => {
  if (!isGlobalAdmin(req)) {
    res.status(403).json({ message: 'Somente o admin pode gerenciar professores.' });
    return false;
  }
  return true;
};

const buildProfessorCreditPayload = (row) => ({
  aiCredits: getProfessorCreditsValue(row?.ai_credits),
  aiCreditsUpdatedAt: row?.ai_credits_updated_at || null
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

const getProfessorStudentCount = async (professorId) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM users
      WHERE role = 'student'
        AND owner_user_id = $1`,
    [professorId]
  );
  return Number(rows[0]?.total || 0);
};

const getProfessorStorageUsageBytes = async (professorId) => {
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
     )
     SELECT (owned_courses.total + owned_modules.total)::bigint AS total
     FROM owned_courses, owned_modules`,
    [professorId]
  );
  return Number(rows[0]?.total || 0);
};

const getProfessorQuotaStatus = async (professorId) => {
  await ensureProfessorCreditColumns();
  await ensureProfessorQuotaColumns();
  const { rows } = await db.query(
    `SELECT id, role, is_active, ai_credits, ai_credits_updated_at, student_limit, storage_limit_bytes
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
        aiCredits: status.aiCredits,
        aiCreditsUpdatedAt: status.aiCreditsUpdatedAt,
        isActive: status.isActive
      }
    : null;
};

const getAiCreditCostPerCall = async (userId) => {
  await ensureAdminAiImageColumns();
  const { rows } = await db.query(
    `SELECT ai_credit_cost_per_call
       FROM admin_ai_settings
      WHERE admin_user_id = $1`,
    [userId]
  );
  return parseAiCreditCostInput(rows[0]?.ai_credit_cost_per_call) ?? 0.5;
};

const consumeProfessorAiCredit = async (req, featureLabel) => {
  if (!isProfessor(req)) {
    return {
      charged: false,
      remainingCredits: null,
      costPerCall: 0,
      refund: async () => {}
    };
  }
  await ensureProfessorCreditColumns();
  const costPerCall = await getAiCreditCostPerCall(req.user.id);
  const { rows } = await db.query(
    `UPDATE users
        SET ai_credits = ai_credits - $2,
            ai_credits_updated_at = NOW()
      WHERE id = $1
        AND role = 'professor'
        AND is_active = TRUE
        AND ai_credits >= $2
    RETURNING ai_credits, ai_credits_updated_at`,
    [req.user.id, costPerCall]
  );
  if (!rows.length) {
    const currentStatus = await getProfessorQuotaStatus(req.user.id);
    const exhaustedMessage = currentStatus?.isActive === false
      ? 'Sua conta de professor est\u00e1 desativada.'
      : `Seus cr\u00e9ditos de IA acabaram. Pe\u00e7a ao admin para adicionar novos cr\u00e9ditos antes de usar ${featureLabel}.`;
    const error = new Error(exhaustedMessage);
    error.statusCode = 403;
    error.code = 'PROFESSOR_AI_CREDITS_EXHAUSTED';
    error.creditStatus = currentStatus || { aiCredits: 0, aiCreditsUpdatedAt: null, isActive: true };
    throw error;
  }
  let refunded = false;
  return {
    charged: true,
    remainingCredits: getProfessorCreditsValue(rows[0].ai_credits),
    costPerCall,
    refund: async () => {
      if (refunded) {
        return;
      }
      refunded = true;
      await db.query(
        `UPDATE users
            SET ai_credits = ai_credits + $2,
                ai_credits_updated_at = NOW()
          WHERE id = $1
            AND role = 'professor'`,
        [req.user.id, costPerCall]
      );
    }
  };
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
  ownershipColumnsEnsured = true;
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

const ensureProfessorSmtpSettingsTable = async () => {
  if (professorSmtpSettingsEnsured) {
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS professor_smtp_settings (
      professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      host TEXT,
      port INT,
      secure BOOLEAN,
      user_email TEXT,
      user_pass TEXT,
      from_email TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  professorSmtpSettingsEnsured = true;
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
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(
    `INSERT INTO classes (id, name)
     VALUES ($1, 'Turma A')
     ON CONFLICT (name) DO NOTHING`,
    [uuidv4()]
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

const ensureClassExists = async (className) => {
  const cleanClassName = sanitizeText(className || '', 120);
  if (!cleanClassName) {
    return 'Turma A';
  }
  await ensureClassesTable();
  await db.query(
    `INSERT INTO classes (id, name)
     VALUES ($1, $2)
     ON CONFLICT (name) DO NOTHING`,
    [uuidv4(), cleanClassName]
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

const ADMIN_AI_SETTINGS_SELECT = `SELECT admin_user_id, provider_key, provider_label, base_url, model, encrypted_api_key, ai_credit_cost_per_call,
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
    `ALTER TABLE admin_ai_settings
       ADD COLUMN IF NOT EXISTS ai_credit_cost_per_call NUMERIC(12,2) NOT NULL DEFAULT 0.5`
  );
  adminAiImageColumnsEnsured = true;
};

router.get('/students', async (req, res) => {
  await ensureClassesTable();
  await ensureOwnershipColumns();
  const params = [];
  let studentQuery = `SELECT id, full_name, email, phone, role, class_name, is_active, created_at
                      FROM users
                      WHERE role = 'student'`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    studentQuery += ` AND owner_user_id = $1`;
  }
  studentQuery += ' ORDER BY full_name';
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
  const { rows } = await db.query(
    `SELECT id, name, created_at
     FROM classes
     ORDER BY name`
  );
  res.json(rows);
});

router.post('/classes', async (req, res) => {
  await ensureClassesTable();
  const name = sanitizeText(req.body?.name || '', 120);
  if (!name) {
    return res.status(400).json({ message: 'Informe o nome da turma.' });
  }
  const id = uuidv4();
  const { rows } = await db.query(
    `INSERT INTO classes (id, name)
     VALUES ($1, $2)
     ON CONFLICT (name) DO NOTHING
     RETURNING id, name, created_at`,
    [id, name]
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
  const { rows } = await db.query('SELECT id, name FROM classes WHERE id = $1', [classId]);
  const classRow = rows[0];
  if (!classRow) {
    return res.status(404).json({ message: 'Turma nÃ£o encontrada.' });
  }
  const usage = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM users
     WHERE role = 'student' AND class_name = $1`,
    [classRow.name]
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
    `SELECT id, full_name, email, phone, role, is_active, ai_credits, ai_credits_updated_at, student_limit, storage_limit_bytes, created_at
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
  const parsedCredits = parseCreditsInput(req.body?.aiCredits);
  const aiCredits = parsedCredits === null ? 0 : Math.max(0, parsedCredits);
  const studentLimit = parseOptionalLimitInput(req.body?.studentLimit, { allowZero: false });
  const storageLimitBytes = parseStorageLimitGbInput(req.body?.storageLimitGb);
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha s\u00e3o obrigat\u00f3rios.' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();
  try {
    await db.query(
      `INSERT INTO users (
         id, full_name, email, phone, password_hash, role, class_name, is_active, ai_credits, ai_credits_updated_at, student_limit, storage_limit_bytes
       )
       VALUES ($1, $2, $3, $4, $5, 'professor', $6, TRUE, $7, NOW(), $8, $9)`,
      [id, fullName, email, phone || null, hashedPassword, 'Professor', aiCredits, studentLimit, storageLimitBytes]
    );
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'J\u00e1 existe um usu\u00e1rio com este email.' });
    }
    throw error;
  }
  res.status(201).json({ id, fullName, email, aiCredits, studentLimit, storageLimitBytes });
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
  const { rows } = await db.query(
    `UPDATE users
        SET ai_credits = ai_credits + $1,
            ai_credits_updated_at = NOW()
      WHERE id = $2
        AND role = 'professor'
    RETURNING id, ai_credits, ai_credits_updated_at`,
    [creditAmount, id]
  );
  if (!rows.length) {
    return res.status(404).json({ message: 'Professor n\u00e3o encontrado.' });
  }
  res.json({
    success: true,
    addedCredits: creditAmount,
    ...buildProfessorCreditPayload(rows[0])
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

router.get('/me/professor-credits', async (req, res) => {
  if (!['admin', 'professor'].includes(req.user?.role || '')) {
    return res.status(403).json({ message: 'Permiss\u00e3o negada.' });
  }
  const status = await getProfessorQuotaStatus(req.user.id);
  const payload = {
    role: req.user.role,
    ...(status || {
      aiCredits: null,
      aiCreditsUpdatedAt: null,
      isActive: req.user?.role === 'admin' ? true : null,
      studentLimit: null,
      storageLimitBytes: null,
      studentCount: null,
      storageUsedBytes: null
    })
  };
  if (isGlobalAdmin(req)) {
    payload.aiCreditCostPerCall = await getAiCreditCostPerCall(req.user.id);
  }
  res.json(payload);
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
  const inviteToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSignupLinkToken(inviteToken);
  await db.query(
    `INSERT INTO student_signup_links (professor_user_id, token_hash, revoked_at, created_at, updated_at)
     VALUES ($1, $2, NULL, NOW(), NOW())
     ON CONFLICT (professor_user_id)
     DO UPDATE SET token_hash = EXCLUDED.token_hash, revoked_at = NULL, updated_at = NOW()`,
    [req.user.id, tokenHash]
  );
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    professorName: req.user.fullName || (isGlobalAdmin(req) ? 'Admin' : 'Professor'),
    inviteUrl: `${origin}/login.html?invite=${inviteToken}`,
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
  const className = await ensureClassExists(req.body?.className || 'Turma A');
  const isActive = req.body?.isActive;
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha sÃ£o obrigatÃ³rios' });
  }
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
  const id = uuidv4();
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
  if (!(await ensureProfessorOwnsStudent(req, id)) || !(await ensureProfessorOwnsCourse(req, courseId))) {
    return res.status(404).json({ message: 'Matricula nao encontrada' });
  }
  await db.query('DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2', [id, courseId]);
  res.status(204).send();
});

router.put('/students/:id', async (req, res) => {
  await ensureOwnershipColumns();
  const { id } = req.params;
  if (!(await ensureProfessorOwnsStudent(req, id))) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno invÃ¡lido' });
  }
  const fullName = sanitizeText(req.body?.fullName || '', 160);
  const hasClassName = Object.prototype.hasOwnProperty.call(req.body || {}, 'className');
  const className = hasClassName ? await ensureClassExists(req.body?.className || 'Turma A') : '';
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
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.status(204).send();
});

router.put('/students/:id/status', async (req, res) => {
  await ensureOwnershipColumns();
  const { id } = req.params;
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
  await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [isActive, id]);
  res.status(204).send();
});

router.delete('/students/:id', async (req, res) => {
  await ensureOwnershipColumns();
  if (!(await ensureProfessorOwnsStudent(req, req.params.id))) {
    return res.status(404).json({ message: 'Aluno nao encontrado' });
  }
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: 'Aluno invÃ¡lido' });
  }
  await db.query('DELETE FROM users WHERE id = $1 AND role = \'student\'', [req.params.id]);
  res.status(204).send();
});

router.get('/reports', async (req, res) => {
  await ensureProgressEventsColumn();
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
  let query = `SELECT u.id user_id, u.full_name, u.email, u.phone, u.class_name, c.id course_id, c.title course_title,
                      e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at,
                      e.report_corrected_at,
                      COALESCE(jsonb_array_length(e.progress_events), 0) AS progress_event_count
               FROM enrollments e
               JOIN users u ON u.id = e.user_id
               JOIN courses c ON c.id = e.course_id`;
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
  await ensureProgressEventsColumn();
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
                      COALESCE(COUNT(DISTINCT m.id), 0) AS module_count,
                      COALESCE(COUNT(DISTINCT car.id) FILTER (WHERE car.status = 'pending'), 0) AS pending_request_count
               FROM courses c
               LEFT JOIN modules m ON m.course_id = c.id
               LEFT JOIN course_access_requests car ON car.course_id = c.id`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' WHERE c.owner_user_id = $1';
  }
  query += `
               GROUP BY c.id, c.title, c.description, c.slug, c.cover_image, c.show_in_store
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
  const id = uuidv4();
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

router.post('/images/remove-background', async (req, res) => {
  await ensureAdminAiImageColumns();
  const src = sanitizeMediaUrl(req.body?.src || '');
  if (!src) {
    return res.status(400).json({ message: 'Informe a imagem para remover o fundo.' });
  }
  let creditCharge = null;
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a remoção de fundo com IA');
    const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
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
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
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
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
    });
  }
});

router.post('/input/compare-image', async (req, res) => {
  await ensureAdminAiImageColumns();
  const referenceImage = sanitizeMediaUrl(req.body?.referenceImage || '');
  const submittedImage = sanitizeMediaUrl(req.body?.submittedImage || '');
  let creditCharge = null;
  try {
    creditCharge = await consumeProfessorAiCredit(req, 'a comparação de imagens com IA');
    const referenceAttachment = await mediaUrlToImageAttachment(referenceImage, 'referencia');
    const submittedAttachment = await mediaUrlToImageAttachment(submittedImage, 'resposta');
    if (!referenceAttachment || !submittedAttachment) {
      return res.status(400).json({ message: 'Envie duas imagens validas em formato suportado.' });
    }
    const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
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
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    const message = error?.message || 'Nao foi possivel comparar as imagens.';
    res.status(error?.statusCode || 500).json({
      message,
      code: error?.code || null,
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
    });
  }
});

router.post('/media/extract-audio', async (req, res) => {
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

router.post('/media/transcribe', async (req, res) => {
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
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
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
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
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
  const id = uuidv4();
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
  let query = `SELECT id, message, target_type, target_value, created_by, created_at
               FROM notifications`;
  if (isProfessor(req)) {
    params.push(req.user.id);
    query += ' WHERE owner_user_id = $1';
  }
  query += ' ORDER BY created_at DESC LIMIT 50';
  const { rows } = await db.query(query, params);
  res.json(rows);
});

router.post('/notifications', async (req, res) => {
  await ensureOwnershipColumns();
  const message = sanitizeNotificationMessage(req.body?.message || '');
  const targetType = sanitizeText(req.body?.targetType || '', 20);
  const targetValue = sanitizeText(req.body?.targetValue || '', 120);
  if (!message) {
    return res.status(400).json({ message: 'Mensagem obrigatÃ³ria' });
  }
  if (!['student', 'class', 'all'].includes(targetType)) {
    return res.status(400).json({ message: 'targetType deve ser student, class ou all' });
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO notifications (id, message, target_type, target_value, created_by, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, message, targetType, targetValue || null, req.user.id, isProfessor(req) ? req.user.id : null]
  );
  res.status(201).json({ id });
});

router.delete('/notifications/:notificationId', async (req, res) => {
  const { notificationId } = req.params;
  if (!isUuid(notificationId)) {
    return res.status(400).json({ message: 'NotificaÃ§Ã£o invÃ¡lida' });
  }
  const { rowCount } = await db.query('DELETE FROM notifications WHERE id = $1', [notificationId]);
  if (!rowCount) {
    return res.status(404).json({ message: 'NotificaÃ§Ã£o nÃ£o encontrada' });
  }
  res.status(204).send();
});

router.get('/ai-settings', async (req, res) => {
  await ensureAdminAiImageColumns();
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  res.json(buildPublicAiSettings(rows[0], { includeCreditCost: isGlobalAdmin(req) }));
});

router.put('/ai-settings', async (req, res) => {
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
    aiCreditCostPerCall
  } = req.body || {};
  if (!baseUrl || !model) {
    return res.status(400).json({ message: 'baseUrl e model sÃ£o obrigatÃ³rios.' });
  }
  if (!imageBaseUrl || !imageModel) {
    return res.status(400).json({ message: 'imageBaseUrl e imageModel sÃ£o obrigatÃ³rios.' });
  }

  const cleanBaseUrl = sanitizeMediaUrl(baseUrl, { allowData: false }).replace(/\/+$/, '');
  const cleanModel = String(model).trim();
  const cleanProviderKey = String(providerKey || 'custom-compatible').trim() || 'custom-compatible';
  const cleanProviderLabel = String(providerLabel || 'Provedor compatÃ­vel').trim() || 'Provedor compatÃ­vel';
  const cleanImageBaseUrl = sanitizeMediaUrl(imageBaseUrl, { allowData: false }).replace(/\/+$/, '');
  const cleanImageModel = String(imageModel || 'gemini-2.5-flash-image').trim() || 'gemini-2.5-flash-image';
  const cleanImageProviderKey = String(imageProviderKey || 'google-gemini-image').trim() || 'google-gemini-image';
  const cleanImageProviderLabel = String(imageProviderLabel || 'Nano Banana').trim() || 'Nano Banana';
  const cleanAiCreditCostPerCall = parseAiCreditCostInput(aiCreditCostPerCall) ?? 0.5;

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
       ai_credit_cost_per_call, system_prompt, require_confirmation, is_enabled, updated_at,
       image_provider_key, image_provider_label, image_base_url, image_model, image_encrypted_api_key, image_is_enabled
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14, $15, $16)
     ON CONFLICT (admin_user_id)
     DO UPDATE SET
       provider_key = EXCLUDED.provider_key,
       provider_label = EXCLUDED.provider_label,
       base_url = EXCLUDED.base_url,
       model = EXCLUDED.model,
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       ai_credit_cost_per_call = EXCLUDED.ai_credit_cost_per_call,
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
      cleanAiCreditCostPerCall,
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

  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  res.json(buildPublicAiSettings(rows[0], { includeCreditCost: isGlobalAdmin(req) }));
});

router.post('/ai-settings/test', async (req, res) => {
  await ensureAdminAiImageColumns();
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'Configure e ative a integraÃ§Ã£o antes de testar.' });
  }
  try {
    const reply = await testAiConnection(settingsRow);
    res.json({ ok: true, reply });
  } catch (error) {
    res.status(400).json({ message: error.message || 'NÃ£o foi possÃ­vel validar a integraÃ§Ã£o.' });
  }
});

router.post('/ai/slide-actions', async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const slides = sanitizeBuilderData({ slides: Array.isArray(req.body?.slides) ? req.body.slides : [] }).slides || [];
  const activeSlideId = sanitizeText(req.body?.activeSlideId || '', 120);
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  const executionPlan = req.body?.executionPlan && typeof req.body.executionPlan === 'object' ? req.body.executionPlan : null;
  const currentPlanItem = req.body?.currentPlanItem && typeof req.body.currentPlanItem === 'object' ? req.body.currentPlanItem : null;
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que a IA deve fazer.' });
  }
  let creditCharge = null;
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integraÃ§Ã£o de IA deste admin nÃ£o estÃ¡ configurada ou ativa.' });
  }

  try {
    creditCharge = await consumeProfessorAiCredit(req, 'o assistente de IA para slides');
    const actions = await proposeSlideActions({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      stageSize: stageSize || null,
      attachments: Array.isArray(attachments) ? attachments : [],
      executionPlan,
      currentPlanItem
    });
    res.json({
      actions,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nÃ£o conseguiu propor aÃ§Ãµes vÃ¡lidas.',
      code: error?.code || null,
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
    });
  }
});

router.post('/ai/slide-actions/plan', async (req, res) => {
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
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
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
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nÃ£o conseguiu planejar a execuÃ§Ã£o.',
      code: error?.code || null,
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
    });
  }
});

router.post('/ai/slide-actions/step', async (req, res) => {
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
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
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
    res.json({
      ...result,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nÃ£o conseguiu gerar a prÃ³xima aÃ§Ã£o.',
      code: error?.code || null,
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
    });
  }
});

router.post('/ai/magic-pen', async (req, res) => {
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
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
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
    res.json({
      ...result,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label,
      professorCreditsRemaining: creditCharge?.remainingCredits ?? null
    });
  } catch (error) {
    if (creditCharge?.charged) {
      await creditCharge.refund();
    }
    res.status(error?.statusCode || 400).json({
      message: error.message || 'A IA nao conseguiu executar o pincel magico.',
      code: error?.code || null,
      professorCreditsRemaining: error?.creditStatus?.aiCredits ?? null
    });
  }
});

router.get('/smtp-settings', async (req, res) => {
  await ensureAdminSmtpSettingsTable();
  await ensureProfessorSmtpSettingsTable();
  if (isProfessor(req)) {
    const { rows } = await db.query(
      'SELECT host, port, secure, user_email, user_pass, from_email FROM professor_smtp_settings WHERE professor_user_id = $1',
      [req.user.id]
    );
    return res.json(
      sanitizeSmtpSettingsResponse(rows[0] || null, {
        usingFallback: !isSmtpConfigUsable(rows[0]),
        scope: 'professor'
      })
    );
  }
  const { rows } = await db.query('SELECT host, port, secure, user_email, user_pass, from_email FROM admin_smtp_settings WHERE id = 1');
  res.json(sanitizeSmtpSettingsResponse(rows[0] || null, { usingFallback: false, scope: 'admin' }));
});

router.put('/smtp-settings', async (req, res) => {
  await ensureAdminSmtpSettingsTable();
  await ensureProfessorSmtpSettingsTable();
  const { host, port, secure, user_email, user_pass, from_email } = req.body || {};
  const cleanHost = sanitizeText(host || '', 255);
  const cleanUserEmail = sanitizeEmail(user_email || '');
  const cleanFromEmail = sanitizeEmail(from_email || '');
  const cleanPassword = sanitizeText(user_pass || '', 512, { trim: false });
  const cleanPort = Number.isFinite(Number(port)) ? Number(port) : null;
  const cleanSecure = secure !== false;

  if (isProfessor(req)) {
    const { rows } = await db.query(
      'SELECT user_pass FROM professor_smtp_settings WHERE professor_user_id = $1',
      [req.user.id]
    );
    const nextPassword = cleanPassword || rows[0]?.user_pass || '';
    const shouldFallback = !cleanHost && !cleanUserEmail && !cleanFromEmail && !nextPassword;
    if (shouldFallback) {
      await db.query('DELETE FROM professor_smtp_settings WHERE professor_user_id = $1', [req.user.id]);
      return res.status(204).send();
    }
    await db.query(
      `INSERT INTO professor_smtp_settings (
         professor_user_id, host, port, secure, user_email, user_pass, from_email, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (professor_user_id)
       DO UPDATE SET
         host = EXCLUDED.host,
         port = EXCLUDED.port,
         secure = EXCLUDED.secure,
         user_email = EXCLUDED.user_email,
         user_pass = EXCLUDED.user_pass,
         from_email = EXCLUDED.from_email,
         updated_at = NOW()`,
      [req.user.id, cleanHost, cleanPort, cleanSecure, cleanUserEmail, nextPassword, cleanFromEmail]
    );
    return res.status(204).send();
  }

  const { rows } = await db.query('SELECT user_pass FROM admin_smtp_settings WHERE id = 1');
  if (rows.length === 0) {
    await db.query(
      'INSERT INTO admin_smtp_settings (id, host, port, secure, user_email, user_pass, from_email) VALUES (1, $1, $2, $3, $4, $5, $6)',
      [cleanHost, cleanPort, cleanSecure, cleanUserEmail, cleanPassword, cleanFromEmail]
    );
  } else {
    const nextPassword = cleanPassword || rows[0]?.user_pass || '';
    await db.query(
      'UPDATE admin_smtp_settings SET host = $1, port = $2, secure = $3, user_email = $4, user_pass = $5, from_email = $6, updated_at = NOW() WHERE id = 1',
      [cleanHost, cleanPort, cleanSecure, cleanUserEmail, nextPassword, cleanFromEmail]
    );
  }
  res.status(204).send();
});

module.exports = router;

