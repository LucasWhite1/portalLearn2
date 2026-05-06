const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { compareImagesWithNanoBanana } = require('../aiProvider');
const { readImageSource } = require('../pixian');
const { getShare, listShares, addCameraRequest, addDrawingStroke, clearDrawingStrokes } = require('../liveStageShareStore');

const { sanitizeText, sanitizeMediaUrl, isUuid } = require('../security');

const router = express.Router();
let quizAttemptsColumnEnsured = false;
let interactiveProgressColumnEnsured = false;
let videoProgressColumnEnsured = false;
let progressEventsColumnEnsured = false;
let inputResponsesColumnEnsured = false;
let courseCoverColumnEnsured = false;
let courseStoreColumnEnsured = false;
let courseAccessRequestsTableEnsured = false;
let ownershipColumnsEnsured = false;
let courseColumnsEnsurePromise = null;
let enrollmentProgressColumnsEnsurePromise = null;
const LIVE_STAGE_SHARE_ID_REGEX = /^[0-9a-f]{32}$/i;

const ensureCourseCoverColumn = async () => {
  if (courseCoverColumnEnsured) {
    return;
  }
  if (!courseColumnsEnsurePromise) {
    courseColumnsEnsurePromise = db.query(
      `ALTER TABLE courses
         ADD COLUMN IF NOT EXISTS cover_image TEXT NOT NULL DEFAULT '',
         ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT FALSE`
    )
      .then(() => {
        courseCoverColumnEnsured = true;
        courseStoreColumnEnsured = true;
      })
      .catch((error) => {
        courseColumnsEnsurePromise = null;
        throw error;
      });
  }
  await courseColumnsEnsurePromise;
};

const ensureCourseStoreColumn = async () => {
  if (courseStoreColumnEnsured) {
    return;
  }
  await ensureCourseCoverColumn();
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

router.get('/public/modules/:moduleId', async (req, res) => {
  const { moduleId } = req.params;
  if (!isUuid(moduleId)) {
    return res.status(400).json({ message: 'Módulo inválido' });
  }
  const { rows } = await db.query(
    `SELECT m.id, m.course_id, m.title, m.slug, m.description, m.builder_data, m.position, m.created_at, c.title AS course_title
     FROM modules m
     JOIN courses c ON c.id = m.course_id
     WHERE m.id = $1`,
    [moduleId]
  );
  const module = rows[0];
  if (!module || !module.builder_data?.moduleSettings?.isPublic) {
    return res.status(404).json({ message: 'Módulo não encontrado' });
  }
  res.json({
    id: module.id,
    courseId: module.course_id,
    courseTitle: module.course_title,
    title: module.title,
    slug: module.slug,
    description: module.description,
    builder_data: module.builder_data,
    position: module.position,
    created_at: module.created_at,
    courseProgress: {}
  });
});

router.get('/live-stage/:shareId', requireAuth, async (req, res) => {
  await ensureOwnershipColumns();
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const share = getShare(shareId);
  if (!share) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }
  const payload = share.payload || {};
  if (req.user?.role !== 'student') {
    return res.status(403).json({ message: 'Somente alunos autenticados podem acessar a aula ao vivo.' });
  }
  let hasEnrollmentAccess = false;
  if (isUuid(payload.courseId)) {
    const { rows } = await db.query(
      `SELECT 1
         FROM enrollments e
        WHERE e.user_id = $1
          AND e.course_id = $2
        LIMIT 1`,
      [req.user.id, payload.courseId]
    );
    hasEnrollmentAccess = Boolean(rows[0]);
    if (!hasEnrollmentAccess) {
      return res.status(403).json({ message: 'Você não está matriculado neste curso ao vivo.' });
    }
  }
  const hasOwnerAccess = Boolean(share.ownerUserId && req.user.ownerUserId === share.ownerUserId);
  const hasAdminBroadcastAccess = share.ownerRole === 'admin';
  if (!hasEnrollmentAccess && !hasOwnerAccess && !hasAdminBroadcastAccess) {
    return res.status(403).json({ message: 'Esta aula ao vivo está disponível apenas para alunos deste professor.' });
  }
  res.json({
    id: payload.moduleId || `live-stage-${share.shareId}`,
    courseId: payload.courseId || `live-course-${share.shareId}`,
    courseTitle: 'Palco ao vivo',
    title: payload.title || 'Palco ao vivo',
    slug: `live-stage-${share.shareId}`,
    description: payload.description || null,
    builder_data: payload.builderData || {},
    courseProgress: {},
    liveShare: {
      shareId: share.shareId,
      activeSlideId: payload.activeSlideId || null,
      revision: share.revision,
      updatedAt: new Date(share.updatedAt).toISOString(),
      drawingStrokes: share.drawingStrokes || []
    }
  });
});

router.post('/live-stage/:shareId/request-camera', requireAuth, async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const share = getShare(shareId);
  if (!share) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }

  const { peerId } = req.body;
  if (!peerId) {
    return res.status(400).json({ message: 'PeerID é necessário.' });
  }

  const request = {
    userId: req.user.id,
    fullName: req.user.full_name || req.user.fullName,
    peerId: sanitizeText(peerId, 120)
  };

  const success = addCameraRequest(shareId, request);
  if (!success) {
    return res.status(500).json({ message: 'Não foi possível registrar a solicitação.' });
  }

  res.json({ success: true });
});

router.post('/live-stage/:shareId/drawing', requireAuth, async (req, res) => {
  const shareId = sanitizeText(req.params?.shareId || '', 64);
  if (!LIVE_STAGE_SHARE_ID_REGEX.test(shareId)) {
    return res.status(400).json({ message: 'Compartilhamento ao vivo inválido.' });
  }
  const share = getShare(shareId);
  if (!share) {
    return res.status(404).json({ message: 'Compartilhamento ao vivo não encontrado.' });
  }

  const { stroke } = req.body;
  if (!stroke || !Array.isArray(stroke.points)) {
    return res.status(400).json({ message: 'Dados do traço inválidos.' });
  }

  const success = addDrawingStroke(shareId, {
    userId: req.user.id,
    fullName: req.user.full_name || req.user.fullName,
    slideId: stroke.slideId,
    stroke: {
      id: stroke.id,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points
    }
  });

  res.json({ success: true });
});

router.delete('/live-stage/:shareId/drawing', requireAuth, async (req, res) => {
  const { shareId } = req.params;
  if (!isUuid(shareId)) {
    return res.status(400).json({ message: 'ID de compartilhamento inválido.' });
  }

  const success = clearDrawingStrokes(shareId);
  res.json({ success });
});

router.get('/live-stage', requireAuth, async (req, res) => {
  await ensureOwnershipColumns();
  if (req.user?.role !== 'student') {
    return res.json([]);
  }

  const { rows } = await db.query(
    `SELECT e.course_id, c.title
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = $1`,
    [req.user.id]
  );
  const enrolledCourseMap = rows.reduce((acc, course) => {
    acc[course.course_id] = course.title || 'Curso ao vivo';
    return acc;
  }, {});

  const shares = listShares()
    .filter((share) => {
      const payload = share?.payload || {};
      if (isUuid(payload.courseId) && enrolledCourseMap[payload.courseId]) {
        return true;
      }
      if (share.ownerRole === 'admin') {
        return true;
      }
      return Boolean(share.ownerUserId && req.user.ownerUserId === share.ownerUserId);
    })
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .map((share) => {
      const payload = share.payload || {};
      return {
        shareId: share.shareId,
        courseId: payload.courseId || null,
        courseTitle: isUuid(payload.courseId) ? enrolledCourseMap[payload.courseId] || 'Curso ao vivo' : 'Aula ao vivo',
        title: payload.title || 'Palco ao vivo',
        description: payload.description || null,
        activeSlideId: payload.activeSlideId || null,
        moduleId: payload.moduleId || null,
        updatedAt: new Date(share.updatedAt).toISOString()
      };
    });

  res.json(shares);
});

router.use(requireAuth);

const ensureQuizAttemptsColumn = async () => {
  if (quizAttemptsColumnEnsured) {
    return;
  }
  if (!enrollmentProgressColumnsEnsurePromise) {
    enrollmentProgressColumnsEnsurePromise = db.query(
      `ALTER TABLE enrollments
         ADD COLUMN IF NOT EXISTS quiz_attempts JSONB NOT NULL DEFAULT '{}'::jsonb,
         ADD COLUMN IF NOT EXISTS interactive_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
         ADD COLUMN IF NOT EXISTS video_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
         ADD COLUMN IF NOT EXISTS progress_events JSONB NOT NULL DEFAULT '[]'::jsonb,
         ADD COLUMN IF NOT EXISTS input_responses JSONB NOT NULL DEFAULT '{}'::jsonb`
    )
      .then(() => {
        quizAttemptsColumnEnsured = true;
        interactiveProgressColumnEnsured = true;
        videoProgressColumnEnsured = true;
        progressEventsColumnEnsured = true;
        inputResponsesColumnEnsured = true;
      })
      .catch((error) => {
        enrollmentProgressColumnsEnsurePromise = null;
        throw error;
      });
  }
  await enrollmentProgressColumnsEnsurePromise;
};

const ensureInteractiveProgressColumn = async () => {
  if (interactiveProgressColumnEnsured) {
    return;
  }
  await ensureQuizAttemptsColumn();
};

const ensureVideoProgressColumn = async () => {
  if (videoProgressColumnEnsured) {
    return;
  }
  await ensureQuizAttemptsColumn();
};

const ensureProgressEventsColumn = async () => {
  if (progressEventsColumnEnsured) {
    return;
  }
  await ensureQuizAttemptsColumn();
};

const ensureInputResponsesColumn = async () => {
  if (inputResponsesColumnEnsured) {
    return;
  }
  await ensureQuizAttemptsColumn();
};

const normalizeSlideStatsEntry = (value = {}) => ({
  viewed: Boolean(value.viewed),
  completed: Boolean(value.completed),
  viewedSeconds: Math.max(0, Number(value.viewedSeconds) || 0),
  updatedAt: value.updatedAt || null
});

const tryParseJson = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeJsonObject = (value) => {
  const parsed = tryParseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
};

const normalizeJsonArray = (value) => {
  const parsed = tryParseJson(value);
  return Array.isArray(parsed) ? parsed : null;
};

const toJsonbParam = (value) => (value === null || value === undefined ? null : JSON.stringify(value));

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

const sanitizeInputResponsePayload = (payload = {}, context = {}) => {
  const key = sanitizeText(payload?.key || '', 220);
  if (!key) {
    return null;
  }
  const submittedText = sanitizeText(payload?.text || '', 4000, { trim: false });
  const imageUrl = sanitizeMediaUrl(payload?.image || '');
  const audioUrl = sanitizeMediaUrl(payload?.audio || '');
  const videoUrl = sanitizeMediaUrl(payload?.video || '');
  return {
    key,
    moduleId: sanitizeText(payload?.moduleId || context.moduleId || '', 120) || null,
    moduleTitle: sanitizeText(payload?.moduleTitle || context.moduleTitle || '', 180) || null,
    slideId: sanitizeText(payload?.slideId || '', 120) || null,
    slideTitle: sanitizeText(payload?.slideTitle || '', 180) || null,
    elementId: sanitizeText(payload?.elementId || '', 120) || null,
    elementType: sanitizeText(payload?.elementType || 'input', 40) || 'input',
    text: submittedText || '',
    image: imageUrl || '',
    audio: audioUrl || '',
    video: videoUrl || '',
    matched: typeof payload?.matched === 'boolean' ? payload.matched : null,
    submittedAt: new Date().toISOString()
  };
};

const sanitizeProgressEventPayload = (event = {}, context = {}) => {
  const eventType = sanitizeText(event?.type || '', 40).toLowerCase();
  if (!eventType) {
    return null;
  }
  const rawDetails = event?.details && typeof event.details === 'object' && !Array.isArray(event.details) ? event.details : {};
  return {
    id: sanitizeText(event?.id || '', 80) || null,
    type: eventType,
    createdAt: new Date().toISOString(),
    moduleId: sanitizeText(event?.moduleId || context.moduleId || '', 120) || null,
    moduleTitle: sanitizeText(event?.moduleTitle || context.moduleTitle || '', 180) || null,
    slideId: sanitizeText(event?.slideId || '', 120) || null,
    slideTitle: sanitizeText(event?.slideTitle || '', 180) || null,
    elementId: sanitizeText(event?.elementId || '', 120) || null,
    elementType: sanitizeText(event?.elementType || '', 60) || null,
    summary: sanitizeText(event?.summary || '', 240) || null,
    details: {
      quizQuestion: sanitizeText(rawDetails.quizQuestion || '', 500) || null,
      selectedOptionText: sanitizeText(rawDetails.selectedOptionText || '', 500) || null,
      selectedIndex: Number.isFinite(Number(rawDetails.selectedIndex)) ? Number(rawDetails.selectedIndex) : null,
      correctOptionText: sanitizeText(rawDetails.correctOptionText || '', 500) || null,
      isCorrect: typeof rawDetails.isCorrect === 'boolean' ? rawDetails.isCorrect : null,
      lockOnWrong: typeof rawDetails.lockOnWrong === 'boolean' ? rawDetails.lockOnWrong : null,
      x: Number.isFinite(Number(rawDetails.x)) ? Number(Number(rawDetails.x).toFixed(2)) : null,
      y: Number.isFinite(Number(rawDetails.y)) ? Number(Number(rawDetails.y).toFixed(2)) : null,
      triggeredDetector: typeof rawDetails.triggeredDetector === 'boolean' ? rawDetails.triggeredDetector : null,
      viewedSeconds: Number.isFinite(Number(rawDetails.viewedSeconds))
        ? Number(Number(rawDetails.viewedSeconds).toFixed(2))
        : null,
      pointCount: Number.isFinite(Number(rawDetails.pointCount)) ? Math.max(0, Math.round(Number(rawDetails.pointCount))) : null,
      strokeWidth: Number.isFinite(Number(rawDetails.strokeWidth))
        ? Number(Number(rawDetails.strokeWidth).toFixed(2))
        : null,
      strokeColor: sanitizeText(rawDetails.strokeColor || '', 40) || null,
      submittedText: sanitizeText(rawDetails.submittedText || '', 500) || null,
      matched: typeof rawDetails.matched === 'boolean' ? rawDetails.matched : null,
      hasImage: typeof rawDetails.hasImage === 'boolean' ? rawDetails.hasImage : null,
      hasAudio: typeof rawDetails.hasAudio === 'boolean' ? rawDetails.hasAudio : null,
      hasVideo: typeof rawDetails.hasVideo === 'boolean' ? rawDetails.hasVideo : null,
      mediaType: sanitizeText(rawDetails.mediaType || '', 40) || null,
      mediaUrl: sanitizeMediaUrl(rawDetails.mediaUrl || '') || null
    }
  };
};

router.get('/profile', async (req, res) => {
  const { id } = req.user;
  const { rows } = await db.query(
    'SELECT id, full_name, email, phone, role, class_name, is_active FROM users WHERE id = $1',
    [id]
  );
  res.json(rows[0]);
});

router.get('/courses', async (req, res) => {
  const startedAt = Date.now();
  const isLite = String(req.query?.lite || '').trim() === '1';
  await ensureCourseCoverColumn();
  await ensureCourseStoreColumn();
  await ensureQuizAttemptsColumn();
  await ensureInteractiveProgressColumn();
  await ensureVideoProgressColumn();
  await ensureProgressEventsColumn();
  await ensureInputResponsesColumn();
  const ensuredAt = Date.now();
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.description, c.slug, c.cover_image, c.show_in_store,
            e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at, e.quiz_attempts, e.interactive_progress, e.video_progress, e.progress_events, e.input_responses
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1
     ORDER BY c.title`,
    [req.user.id]
  );
  const coursesAt = Date.now();
  if (!rows.length) {
    res.setHeader('X-Courses-Endpoint-Ms', String(Date.now() - startedAt));
    res.setHeader('X-Courses-Ensure-Ms', String(ensuredAt - startedAt));
    res.setHeader('X-Courses-Query-Ms', String(coursesAt - ensuredAt));
    res.setHeader('X-Courses-Modules-Ms', '0');
    return res.json([]);
  }
  const courseIds = rows.map((course) => course.id);
  const modulesResult = isLite
    ? await db.query(
      `SELECT id, course_id, title, slug, description, position, created_at,
              COALESCE(builder_data->'moduleSettings', '{}'::jsonb) AS module_settings,
              COALESCE(
                (
                  SELECT jsonb_agg(jsonb_build_object('id', slide_entry->>'id'))
                  FROM jsonb_array_elements(COALESCE(builder_data->'slides', '[]'::jsonb)) AS slide_entry
                ),
                '[]'::jsonb
              ) AS slide_refs
       FROM modules
       WHERE course_id = ANY($1)
       ORDER BY position NULLS LAST, created_at`,
      [courseIds]
    )
    : await db.query(
      `SELECT id, course_id, title, slug, description, builder_data, position, created_at
       FROM modules
       WHERE course_id = ANY($1)
       ORDER BY position NULLS LAST, created_at`,
      [courseIds]
    );
  const modulesAt = Date.now();
  const modulesByCourse = modulesResult.rows.reduce((acc, module) => {
    if (!acc[module.course_id]) {
      acc[module.course_id] = [];
    }
    acc[module.course_id].push(
      isLite
        ? {
          id: module.id,
          course_id: module.course_id,
          title: module.title,
          slug: module.slug,
          description: module.description,
          position: module.position,
          created_at: module.created_at,
          builder_data: {
            moduleSettings:
              module.module_settings && typeof module.module_settings === 'object' && !Array.isArray(module.module_settings)
                ? module.module_settings
                : {},
            slides: Array.isArray(module.slide_refs) ? module.slide_refs : []
          }
        }
        : module
    );
    return acc;
  }, {});
  const courses = rows.map((course) => ({
    id: course.id,
    title: course.title,
    description: course.description,
    slug: course.slug,
    cover_image: course.cover_image || '',
    show_in_store: course.show_in_store === true,
    progress: {
      video_position: course.video_position || 0,
      interactive_step: course.interactive_step || '0',
      current_module: course.current_module,
      grade: course.grade,
      quiz_attempts: course.quiz_attempts || {},
      interactive_progress: course.interactive_progress || {},
      video_progress: course.video_progress || {},
      progress_events: Array.isArray(course.progress_events) ? course.progress_events : [],
      input_responses: course.input_responses || {}
    },
    modules: modulesByCourse[course.id] || []
  }));
  const finishedAt = Date.now();
  res.setHeader('X-Courses-Endpoint-Ms', String(finishedAt - startedAt));
  res.setHeader('X-Courses-Ensure-Ms', String(ensuredAt - startedAt));
  res.setHeader('X-Courses-Query-Ms', String(coursesAt - ensuredAt));
  res.setHeader('X-Courses-Modules-Ms', String(modulesAt - coursesAt));
  if (finishedAt - startedAt > 1200) {
    console.info(
      `[student/courses] slow request ${finishedAt - startedAt}ms (lite=${isLite ? '1' : '0'}, ensure=${ensuredAt - startedAt}ms, courses=${coursesAt - ensuredAt}ms, modules=${modulesAt - coursesAt}ms, build=${finishedAt - modulesAt}ms, user=${req.user.id})`
    );
  }
  res.json(courses);
});

router.get('/store-courses', async (req, res) => {
  await ensureCourseCoverColumn();
  await ensureCourseStoreColumn();
  await ensureCourseAccessRequestsTable();
  await ensureOwnershipColumns();
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.description, c.slug, c.cover_image, c.show_in_store,
            COALESCE(COUNT(m.id), 0) AS module_count,
            car.status AS access_request_status
      FROM courses c
      LEFT JOIN modules m ON m.course_id = c.id
      LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
      LEFT JOIN course_access_requests car ON car.course_id = c.id AND car.user_id = $1
      WHERE c.show_in_store = TRUE
        AND e.course_id IS NULL
        AND (
          (SELECT owner_user_id FROM users WHERE id = $1) IS NOT DISTINCT FROM c.owner_user_id
        )
      GROUP BY c.id, c.title, c.description, c.slug, c.cover_image, c.show_in_store, car.status
      ORDER BY c.title`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/input/compare-image', async (req, res) => {
  const referenceImage = sanitizeMediaUrl(req.body?.referenceImage || '');
  const submittedImage = sanitizeMediaUrl(req.body?.submittedImage || '');
  try {
    const referenceAttachment = await mediaUrlToImageAttachment(referenceImage, 'referencia');
    const submittedAttachment = await mediaUrlToImageAttachment(submittedImage, 'resposta-aluno');
    if (!referenceAttachment || !submittedAttachment) {
      return res.status(400).json({ message: 'Envie duas imagens validas em formato suportado.' });
    }
    const { rows } = await db.query(
      `SELECT *
         FROM admin_ai_settings
        WHERE image_is_enabled = TRUE
          AND image_encrypted_api_key IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1`
    );
    const settingsRow = rows[0];
    if (!settingsRow) {
      return res.status(400).json({ message: 'A comparacao de imagem nao esta configurada no painel admin.' });
    }
    const result = await compareImagesWithNanoBanana({
      imageSettings: settingsRow,
      referenceAttachment,
      submittedAttachment
    });
    return res.json({
      matched: Boolean(result.matched),
      confidence: result.confidence,
      reason: result.reason || ''
    });
  } catch (error) {
    console.error('Nao foi possivel comparar as imagens do input.', error);
    return res.status(500).json({ message: error.message || 'Nao foi possivel comparar as imagens.' });
  }
});

router.post('/store-courses/:courseId/request-access', async (req, res) => {
  await ensureCourseStoreColumn();
  await ensureCourseAccessRequestsTable();
  await ensureOwnershipColumns();
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'Curso inválido.' });
  }
  const { rows: courseRows } = await db.query(
    `SELECT id, show_in_store
     FROM courses
     WHERE id = $1
       AND owner_user_id IS NOT DISTINCT FROM (SELECT owner_user_id FROM users WHERE id = $2)`,
    [courseId, req.user.id]
  );
  const course = courseRows[0];
  if (!course || course.show_in_store !== true) {
    return res.status(404).json({ message: 'Curso indisponível na loja.' });
  }
  const { rows: enrollmentRows } = await db.query(
    'SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2',
    [req.user.id, courseId]
  );
  if (enrollmentRows.length) {
    return res.status(409).json({ message: 'Você já possui acesso a este curso.' });
  }
  await db.query(
    `INSERT INTO course_access_requests (id, user_id, course_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', NOW(), NOW())
     ON CONFLICT (user_id, course_id)
     DO UPDATE SET status = 'pending', updated_at = NOW()`,
    [require('uuid').v4(), req.user.id, courseId]
  );
  res.status(201).json({ success: true, status: 'pending' });
});

router.get('/notifications', async (req, res) => {
  await ensureOwnershipColumns();
  const params = [req.user.className, req.user.id, req.user.ownerUserId || null];
  const { rows } = await db.query(
    `SELECT id, message, target_type, target_value, created_at
     FROM notifications
     WHERE (
       target_type = 'all'
       OR (target_type = 'class' AND target_value = $1)
       OR (target_type = 'student' AND target_value = $2)
     )
       AND (owner_user_id IS NOT DISTINCT FROM $3)
     ORDER BY created_at DESC
      LIMIT 25`,
     params
  );
  res.json(rows);
});

router.get('/progress', async (req, res) => {
  await ensureQuizAttemptsColumn();
  await ensureInteractiveProgressColumn();
  await ensureVideoProgressColumn();
  await ensureProgressEventsColumn();
  await ensureInputResponsesColumn();
  const { rows } = await db.query(
    `SELECT c.id, c.title, e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at, e.quiz_attempts, e.interactive_progress, e.video_progress, e.progress_events, e.input_responses
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/progress', async (req, res) => {
  await ensureQuizAttemptsColumn();
  await ensureInteractiveProgressColumn();
  await ensureVideoProgressColumn();
  await ensureProgressEventsColumn();
  await ensureInputResponsesColumn();
  const courseId = sanitizeText(req.body?.courseId || '', 80);
  const type = sanitizeText(req.body?.type || '', 20);
  const value = req.body?.value;
  const currentModule = sanitizeText(req.body?.currentModule || '', 180);
  const grade = req.body?.grade;
  const quizAttempt = req.body?.quizAttempt;
  const interactiveProgress = req.body?.interactiveProgress;
  const videoProgress = req.body?.videoProgress;
  const progressEvent = req.body?.progressEvent;
  const inputResponse = req.body?.inputResponse;
  if (!isUuid(courseId) || !['video', 'interactive'].includes(type)) {
    return res.status(400).json({ message: 'courseId e type são obrigatórios' });
  }
  const videoPosition = type === 'video' ? value : undefined;
  const interactiveStep = type === 'interactive' ? value : undefined;
  const moduleValue = currentModule ?? null;
  const gradeValue = typeof grade === 'number' ? grade : null;
  let storedQuizAttempts = null;
  let storedInteractiveProgress = null;
  let storedVideoProgress = null;
  let storedProgressEvents = null;
  let storedInputResponses = null;

  if (quizAttempt?.key && typeof quizAttempt.key === 'string' && quizAttempt.key.length <= 180) {
    const { rows: existingRows } = await db.query(
      'SELECT quiz_attempts FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );
    const existingQuizAttempts = normalizeJsonObject(existingRows[0]?.quiz_attempts);
    storedQuizAttempts = existingQuizAttempts ? { ...existingQuizAttempts } : {};
    if (!(quizAttempt.key in storedQuizAttempts)) {
      storedQuizAttempts[quizAttempt.key] = {
        answered: Boolean(quizAttempt.answered),
        selectedIndex: Number.isFinite(Number(quizAttempt.selectedIndex)) ? Number(quizAttempt.selectedIndex) : null,
        isCorrect: Boolean(quizAttempt.isCorrect),
        lockedAt: new Date().toISOString()
      };
    }
  }

  if (interactiveProgress?.moduleId && typeof interactiveProgress.moduleId === 'string' && interactiveProgress.moduleId.length <= 120) {
    const { rows: existingRows } = await db.query(
      'SELECT interactive_progress FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );
    const existingInteractiveProgress = normalizeJsonObject(existingRows[0]?.interactive_progress);
    storedInteractiveProgress = existingInteractiveProgress ? { ...existingInteractiveProgress } : {};
    const existingModuleProgress =
      storedInteractiveProgress[interactiveProgress.moduleId] &&
      typeof storedInteractiveProgress[interactiveProgress.moduleId] === 'object'
        ? storedInteractiveProgress[interactiveProgress.moduleId]
        : {};
    const viewedSlides = new Set(Array.isArray(existingModuleProgress.viewedSlides) ? existingModuleProgress.viewedSlides : []);
    const completedSlides = new Set(Array.isArray(existingModuleProgress.completedSlides) ? existingModuleProgress.completedSlides : []);
    (interactiveProgress.viewedSlides || []).slice(0, 300).forEach((entry) => entry && viewedSlides.add(sanitizeText(entry, 120)));
    (interactiveProgress.completedSlides || []).slice(0, 300).forEach((entry) => entry && completedSlides.add(sanitizeText(entry, 120)));
    const existingSlideStats =
      existingModuleProgress.slideStats && typeof existingModuleProgress.slideStats === 'object'
        ? { ...existingModuleProgress.slideStats }
        : {};
    const incomingSlideStats =
      interactiveProgress.slideStats && typeof interactiveProgress.slideStats === 'object'
        ? interactiveProgress.slideStats
        : {};
    Object.entries(incomingSlideStats).forEach(([slideKey, slideValue]) => {
      if (!slideKey || !slideValue || typeof slideValue !== 'object') {
        return;
      }
      if (String(slideKey).length > 120) {
        return;
      }
      const previous = normalizeSlideStatsEntry(existingSlideStats[slideKey]);
      const next = normalizeSlideStatsEntry(slideValue);
      existingSlideStats[slideKey] = {
        viewed: Boolean(previous.viewed || next.viewed || next.viewedSeconds > 0),
        completed: Boolean(previous.completed || next.completed),
        viewedSeconds: Math.max(previous.viewedSeconds, next.viewedSeconds),
        updatedAt: next.updatedAt || previous.updatedAt || new Date().toISOString()
      };
      if (existingSlideStats[slideKey].viewed) {
        viewedSlides.add(String(slideKey));
      }
      if (existingSlideStats[slideKey].completed) {
        completedSlides.add(String(slideKey));
      }
    });
    storedInteractiveProgress[interactiveProgress.moduleId] = {
      moduleId: sanitizeText(interactiveProgress.moduleId, 120),
      totalSlides: Math.max(
        Number(existingModuleProgress.totalSlides) || 0,
        Number(interactiveProgress.totalSlides) || 0
      ),
      viewedSlides: Array.from(viewedSlides),
      completedSlides: Array.from(completedSlides),
      slideStats: existingSlideStats,
      isCompleted:
        Number(interactiveProgress.totalSlides) > 0
          ? completedSlides.size >= Math.max(Number(existingModuleProgress.totalSlides) || 0, Number(interactiveProgress.totalSlides) || 0)
          : Boolean(existingModuleProgress.isCompleted || interactiveProgress.isCompleted),
      lastSlideId: sanitizeText(interactiveProgress.lastSlideId || existingModuleProgress.lastSlideId || '', 120) || null,
      updatedAt: new Date().toISOString()
    };
  }

  if (videoProgress?.key && typeof videoProgress.key === 'string' && videoProgress.key.length <= 180) {
    const { rows: existingRows } = await db.query(
      'SELECT video_progress FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );
    const existingVideoProgress = normalizeJsonObject(existingRows[0]?.video_progress);
    storedVideoProgress = existingVideoProgress ? { ...existingVideoProgress } : {};
    const previous =
      storedVideoProgress[videoProgress.key] && typeof storedVideoProgress[videoProgress.key] === 'object'
        ? storedVideoProgress[videoProgress.key]
        : {};
    storedVideoProgress[videoProgress.key] = {
      watchedSeconds: Math.max(Number(previous.watchedSeconds) || 0, Number(videoProgress.watchedSeconds) || 0),
      durationSeconds: Math.max(Number(previous.durationSeconds) || 0, Number(videoProgress.durationSeconds) || 0),
      completed: Boolean(previous.completed || videoProgress.completed),
      moduleId: sanitizeText(videoProgress.moduleId || previous.moduleId || '', 120) || null,
      slideId: sanitizeText(videoProgress.slideId || previous.slideId || '', 120) || null,
      elementId: sanitizeText(videoProgress.elementId || previous.elementId || '', 120) || null,
      updatedAt: new Date().toISOString()
    };
  }

  if (progressEvent && typeof progressEvent === 'object') {
    const { rows: existingRows } = await db.query(
      'SELECT progress_events FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );
    const existingEventsRaw = normalizeJsonArray(existingRows[0]?.progress_events) || [];
    const existingEvents = existingEventsRaw
      .map((entry) => normalizeJsonObject(entry) || (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null))
      .filter(Boolean);
    const nextEvent = sanitizeProgressEventPayload(progressEvent, {
      moduleId: interactiveProgress?.moduleId || videoProgress?.moduleId || '',
      moduleTitle: currentModule || ''
    });
    if (nextEvent) {
      storedProgressEvents = [...existingEvents, nextEvent].slice(-500);
    }
  }

  if (inputResponse && typeof inputResponse === 'object') {
    const { rows: existingRows } = await db.query(
      'SELECT input_responses FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );
    const existingInputResponses = normalizeJsonObject(existingRows[0]?.input_responses);
    storedInputResponses = existingInputResponses ? { ...existingInputResponses } : {};
    const nextResponse = sanitizeInputResponsePayload(inputResponse, {
      moduleId: interactiveProgress?.moduleId || videoProgress?.moduleId || '',
      moduleTitle: currentModule || ''
    });
    if (nextResponse?.key) {
      storedInputResponses[nextResponse.key] = nextResponse;
    }
  }

  const effectiveInteractiveProgress = storedInteractiveProgress;
  const overallInteractiveStep = (() => {
    if (!effectiveInteractiveProgress || typeof effectiveInteractiveProgress !== 'object') {
      return interactiveStep ?? null;
    }
    const moduleEntries = Object.values(effectiveInteractiveProgress).filter((entry) => entry && typeof entry === 'object');
    const totalSlides = moduleEntries.reduce((sum, entry) => sum + (Number(entry.totalSlides) || 0), 0);
    const completedSlides = moduleEntries.reduce(
      (sum, entry) => sum + (Array.isArray(entry.completedSlides) ? entry.completedSlides.length : 0),
      0
    );
    return totalSlides > 0 ? `${completedSlides}/${totalSlides}` : interactiveStep ?? null;
  })();

  await db.query(
    `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, quiz_attempts, interactive_progress, video_progress, progress_events, input_responses, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb), COALESCE($8::jsonb, '{}'::jsonb), COALESCE($9::jsonb, '{}'::jsonb), COALESCE($10::jsonb, '[]'::jsonb), COALESCE($11::jsonb, '{}'::jsonb), NOW())
     ON CONFLICT (user_id, course_id)
       DO UPDATE SET
         video_position = COALESCE($3, enrollments.video_position),
         interactive_step = COALESCE($4, enrollments.interactive_step),
         current_module = COALESCE($5, enrollments.current_module),
         grade = COALESCE($6, enrollments.grade),
         quiz_attempts = COALESCE($7::jsonb, enrollments.quiz_attempts),
         interactive_progress = COALESCE($8::jsonb, enrollments.interactive_progress),
         video_progress = COALESCE($9::jsonb, enrollments.video_progress),
         progress_events = COALESCE($10::jsonb, enrollments.progress_events),
         input_responses = COALESCE($11::jsonb, enrollments.input_responses),
         updated_at = NOW()`,
    [
      req.user.id,
      courseId,
      videoPosition ?? null,
      overallInteractiveStep,
      moduleValue,
      gradeValue,
      toJsonbParam(storedQuizAttempts),
      toJsonbParam(storedInteractiveProgress),
      toJsonbParam(storedVideoProgress),
      toJsonbParam(storedProgressEvents),
      toJsonbParam(storedInputResponses)
    ]
  );
  if (storedQuizAttempts || storedInteractiveProgress || storedVideoProgress || storedProgressEvents || storedInputResponses) {
    return res.json({
      ok: true,
      quizAttempts: storedQuizAttempts || undefined,
      storedQuizAttempt: storedQuizAttempts && quizAttempt?.key ? storedQuizAttempts[quizAttempt.key] : undefined,
      interactiveProgress: storedInteractiveProgress || undefined,
      interactiveStep: overallInteractiveStep || undefined,
      videoProgress: storedVideoProgress || undefined,
      progressEvents: storedProgressEvents || undefined,
      inputResponses: storedInputResponses || undefined
    });
  }
  res.status(204).send();
});

module.exports = router;
