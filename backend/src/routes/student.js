const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const { sanitizeText, isUuid } = require('../security');

const router = express.Router();
let quizAttemptsColumnEnsured = false;
let interactiveProgressColumnEnsured = false;
let videoProgressColumnEnsured = false;

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

router.use(requireAuth);

const ensureQuizAttemptsColumn = async () => {
  if (quizAttemptsColumnEnsured) {
    return;
  }
  await db.query(
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS quiz_attempts JSONB NOT NULL DEFAULT '{}'::jsonb"
  );
  quizAttemptsColumnEnsured = true;
};

const ensureInteractiveProgressColumn = async () => {
  if (interactiveProgressColumnEnsured) {
    return;
  }
  await db.query(
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS interactive_progress JSONB NOT NULL DEFAULT '{}'::jsonb"
  );
  interactiveProgressColumnEnsured = true;
};

const ensureVideoProgressColumn = async () => {
  if (videoProgressColumnEnsured) {
    return;
  }
  await db.query(
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS video_progress JSONB NOT NULL DEFAULT '{}'::jsonb"
  );
  videoProgressColumnEnsured = true;
};

const normalizeSlideStatsEntry = (value = {}) => ({
  viewed: Boolean(value.viewed),
  completed: Boolean(value.completed),
  viewedSeconds: Math.max(0, Number(value.viewedSeconds) || 0),
  updatedAt: value.updatedAt || null
});

router.get('/profile', async (req, res) => {
  const { id } = req.user;
  const { rows } = await db.query(
    'SELECT id, full_name, email, phone, role, class_name, is_active FROM users WHERE id = $1',
    [id]
  );
  res.json(rows[0]);
});

router.get('/courses', async (req, res) => {
  await ensureQuizAttemptsColumn();
  await ensureInteractiveProgressColumn();
  await ensureVideoProgressColumn();
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.description, c.slug,
            e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at, e.quiz_attempts, e.interactive_progress, e.video_progress
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1
     ORDER BY c.title`,
    [req.user.id]
  );
  if (!rows.length) {
    return res.json([]);
  }
  const courseIds = rows.map((course) => course.id);
  const modulesResult = await db.query(
    `SELECT id, course_id, title, slug, description, builder_data, position, created_at
     FROM modules
     WHERE course_id = ANY($1)
     ORDER BY position NULLS LAST, created_at`,
    [courseIds]
  );
  const modulesByCourse = modulesResult.rows.reduce((acc, module) => {
    if (!acc[module.course_id]) {
      acc[module.course_id] = [];
    }
    acc[module.course_id].push(module);
    return acc;
  }, {});
  const courses = rows.map((course) => ({
    id: course.id,
    title: course.title,
    description: course.description,
    slug: course.slug,
    progress: {
      video_position: course.video_position || 0,
      interactive_step: course.interactive_step || '0',
      current_module: course.current_module,
      grade: course.grade,
      quiz_attempts: course.quiz_attempts || {},
      interactive_progress: course.interactive_progress || {},
      video_progress: course.video_progress || {}
    },
    modules: modulesByCourse[course.id] || []
  }));
  res.json(courses);
});

router.get('/notifications', async (req, res) => {
  const params = [req.user.className, req.user.id];
  const { rows } = await db.query(
    `SELECT id, message, target_type, target_value, created_at
     FROM notifications
     WHERE target_type = 'all'
       OR (target_type = 'class' AND target_value = $1)
       OR (target_type = 'student' AND target_value = $2)
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
  const { rows } = await db.query(
    `SELECT c.id, c.title, e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at, e.quiz_attempts, e.interactive_progress, e.video_progress
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
  const courseId = sanitizeText(req.body?.courseId || '', 80);
  const type = sanitizeText(req.body?.type || '', 20);
  const value = req.body?.value;
  const currentModule = sanitizeText(req.body?.currentModule || '', 180);
  const grade = req.body?.grade;
  const quizAttempt = req.body?.quizAttempt;
  const interactiveProgress = req.body?.interactiveProgress;
  const videoProgress = req.body?.videoProgress;
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

  if (quizAttempt?.key && typeof quizAttempt.key === 'string' && quizAttempt.key.length <= 180) {
    const { rows: existingRows } = await db.query(
      'SELECT quiz_attempts FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );
    storedQuizAttempts = existingRows[0]?.quiz_attempts && typeof existingRows[0].quiz_attempts === 'object'
      ? { ...existingRows[0].quiz_attempts }
      : {};
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
    storedInteractiveProgress =
      existingRows[0]?.interactive_progress && typeof existingRows[0].interactive_progress === 'object'
        ? { ...existingRows[0].interactive_progress }
        : {};
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
    storedVideoProgress =
      existingRows[0]?.video_progress && typeof existingRows[0].video_progress === 'object'
        ? { ...existingRows[0].video_progress }
        : {};
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
    `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, quiz_attempts, interactive_progress, video_progress, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb), COALESCE($8, '{}'::jsonb), COALESCE($9, '{}'::jsonb), NOW())
     ON CONFLICT (user_id, course_id)
       DO UPDATE SET
         video_position = COALESCE($3, enrollments.video_position),
         interactive_step = COALESCE($4, enrollments.interactive_step),
         current_module = COALESCE($5, enrollments.current_module),
         grade = COALESCE($6, enrollments.grade),
         quiz_attempts = COALESCE($7, enrollments.quiz_attempts),
         interactive_progress = COALESCE($8, enrollments.interactive_progress),
         video_progress = COALESCE($9, enrollments.video_progress),
         updated_at = NOW()`,
    [
      req.user.id,
      courseId,
      videoPosition ?? null,
      overallInteractiveStep,
      moduleValue,
      gradeValue,
      storedQuizAttempts,
      storedInteractiveProgress,
      storedVideoProgress
    ]
  );
  if (storedQuizAttempts || storedInteractiveProgress || storedVideoProgress) {
    return res.json({
      ok: true,
      quizAttempts: storedQuizAttempts || undefined,
      storedQuizAttempt: storedQuizAttempts && quizAttempt?.key ? storedQuizAttempts[quizAttempt.key] : undefined,
      interactiveProgress: storedInteractiveProgress || undefined,
      interactiveStep: overallInteractiveStep || undefined,
      videoProgress: storedVideoProgress || undefined
    });
  }
  res.status(204).send();
});

module.exports = router;
