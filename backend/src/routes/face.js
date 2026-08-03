const express = require('express');
const Busboy = require('busboy');
const { createRateLimiter, isUuid } = require('../security');
const {
  FACE_CONSENT_VERSION,
  FACE_MODEL_VERSION,
  createVerificationSession,
  ensureFaceVerificationSchema,
  getFaceProfile,
  getModuleFaceContext,
  hasActiveGrant,
  normalizeFaceSettings,
  processVerification,
  revokeFaceProfile
} = require('../faceVerification');

const router = express.Router();
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_BYTES = 700 * 1024;
const MAX_FRAMES = 36;
const ALLOWED_FRAME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const faceSessionRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyFn: (req) => `face-session:${req.user?.id || req.ip}`
});
const faceCaptureRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyFn: (req) => `face-capture:${req.user?.id || req.ip}`
});

const parseFaceCapture = (req) => new Promise((resolve, reject) => {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
    const error = new Error('Envie a captura facial como multipart/form-data.');
    error.statusCode = 415;
    reject(error);
    return;
  }
  const fields = {};
  const frames = [];
  let totalBytes = 0;
  let settled = false;
  const fail = (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  };
  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: {
        files: MAX_FRAMES,
        fileSize: MAX_FRAME_BYTES,
        fields: 8,
        fieldSize: 2048
      }
    });
  } catch (error) {
    error.statusCode = 400;
    fail(error);
    return;
  }
  busboy.on('field', (name, value) => {
    fields[String(name).slice(0, 80)] = String(value).slice(0, 2048);
  });
  busboy.on('file', (name, stream, info) => {
    const mimeType = String(info?.mimeType || '').toLowerCase();
    if (name !== 'frames' || !ALLOWED_FRAME_TYPES.has(mimeType)) {
      stream.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    stream.on('data', (chunk) => {
      size += chunk.length;
      totalBytes += chunk.length;
      if (size > MAX_FRAME_BYTES || totalBytes > MAX_CAPTURE_BYTES) {
        const error = new Error('A captura facial excedeu o limite de 8 MB.');
        error.statusCode = 413;
        fail(error);
        stream.resume();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('limit', () => {
      const error = new Error('Um dos quadros da captura facial e muito grande.');
      error.statusCode = 413;
      fail(error);
    });
    stream.on('end', () => {
      if (!settled && size > 0) {
        frames.push({ buffer: Buffer.concat(chunks), mimeType });
      }
    });
  });
  busboy.on('filesLimit', () => {
    const error = new Error(`Envie no maximo ${MAX_FRAMES} quadros.`);
    error.statusCode = 413;
    fail(error);
  });
  busboy.on('error', fail);
  busboy.on('finish', () => {
    if (settled) return;
    if (frames.length < 8) {
      const error = new Error('A captura precisa conter pelo menos 8 quadros validos.');
      error.statusCode = 400;
      fail(error);
      return;
    }
    settled = true;
    resolve({ fields, frames });
  });
  req.pipe(busboy);
});

const requireStudent = (req, res, next) => {
  if (req.user?.role !== 'student') {
    return res.status(403).json({ message: 'A verificacao facial esta disponivel somente para alunos.' });
  }
  return next();
};

router.get('/face/status', requireStudent, asyncHandler(async (req, res) => {
  const profile = await getFaceProfile(req.user.id);
  const profileIsCurrent = profile?.status === 'active' && profile?.model_version === FACE_MODEL_VERSION;
  res.json({
    enrolled: profileIsCurrent,
    status: profile?.status === 'active' && !profileIsCurrent ? 'outdated' : (profile?.status || 'not_enrolled'),
    requiresReenrollment: profile?.status === 'active' && !profileIsCurrent,
    enrolledAt: profile?.enrolled_at || null,
    consentVersion: FACE_CONSENT_VERSION,
    modelVersion: profile?.model_version || null
  });
}));

router.post('/face/enrollment/session', requireStudent, faceSessionRateLimiter, asyncHandler(async (req, res) => {
  if (req.body?.consentAccepted !== true) {
    return res.status(400).json({ message: 'Confirme o consentimento biometrico antes de continuar.' });
  }
  const session = await createVerificationSession({
    userId: req.user.id,
    purpose: 'enrollment'
  });
  res.status(201).json(session);
}));

router.post('/face/enrollment/complete', requireStudent, faceCaptureRateLimiter, asyncHandler(async (req, res) => {
  const { fields, frames } = await parseFaceCapture(req);
  if (!isUuid(fields.sessionId)) {
    return res.status(400).json({ message: 'Sessao facial invalida.' });
  }
  const result = await processVerification({
    userId: req.user.id,
    sessionId: fields.sessionId,
    frames,
    consentAccepted: fields.consentAccepted === 'true'
  });
  res.status(result.verified ? 200 : 422).json(result);
}));

router.delete('/face/profile', requireStudent, asyncHandler(async (req, res) => {
  await revokeFaceProfile(req.user.id);
  res.json({ revoked: true });
}));

router.post('/modules/:moduleId/face/session', requireStudent, faceSessionRateLimiter, asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  if (!isUuid(moduleId)) {
    return res.status(400).json({ message: 'Modulo invalido.' });
  }
  const context = await getModuleFaceContext(req.user.id, moduleId);
  if (!context) {
    return res.status(404).json({ message: 'Modulo nao encontrado ou aluno nao matriculado.' });
  }
  const settings = context.settings;
  if (!settings.enabled) {
    return res.status(400).json({ message: 'Este modulo nao exige verificacao facial.' });
  }
  const purpose = String(req.body?.purpose || 'entry');
  const allowed = {
    entry: settings.verifyOnEntry,
    periodic: settings.verifyDuringModule,
    completion: settings.verifyOnCompletion
  };
  if (!allowed[purpose]) {
    return res.status(400).json({ message: 'Esta verificacao nao esta habilitada para o modulo.' });
  }
  const profile = await getFaceProfile(req.user.id);
  if (profile?.status !== 'active' || profile?.model_version !== FACE_MODEL_VERSION) {
    const outdated = profile?.status === 'active' && profile?.model_version !== FACE_MODEL_VERSION;
    return res.status(428).json({
      message: outdated
        ? 'Seu cadastro facial precisa ser atualizado no perfil antes de acessar este modulo.'
        : 'Cadastre seu rosto no perfil antes de acessar este modulo.',
      code: outdated ? 'FACE_PROFILE_OUTDATED' : 'FACE_PROFILE_REQUIRED'
    });
  }
  const session = await createVerificationSession({
    userId: req.user.id,
    moduleId,
    purpose
  });
  res.status(201).json(session);
}));

router.post('/modules/:moduleId/face/verify', requireStudent, faceCaptureRateLimiter, asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  if (!isUuid(moduleId)) {
    return res.status(400).json({ message: 'Modulo invalido.' });
  }
  const context = await getModuleFaceContext(req.user.id, moduleId);
  if (!context) {
    return res.status(404).json({ message: 'Modulo nao encontrado ou aluno nao matriculado.' });
  }
  const { fields, frames } = await parseFaceCapture(req);
  if (!isUuid(fields.sessionId)) {
    return res.status(400).json({ message: 'Sessao facial invalida.' });
  }
  const result = await processVerification({
    userId: req.user.id,
    sessionId: fields.sessionId,
    frames
  });
  res.status(result.verified ? 200 : 422).json(result);
}));

router.get('/modules/:moduleId/content', requireStudent, asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  if (!isUuid(moduleId)) {
    return res.status(400).json({ message: 'Modulo invalido.' });
  }
  const context = await getModuleFaceContext(req.user.id, moduleId);
  if (!context) {
    return res.status(404).json({ message: 'Modulo nao encontrado ou aluno nao matriculado.' });
  }
  const { module, settings } = context;
  if (settings.verifyOnEntry) {
    const grant = await hasActiveGrant(req.user.id, moduleId, ['entry', 'manual']);
    if (!grant) {
      const profile = await getFaceProfile(req.user.id);
      const profileIsCurrent = profile?.status === 'active' && profile?.model_version === FACE_MODEL_VERSION;
      const profileIsOutdated = profile?.status === 'active' && !profileIsCurrent;
      return res.status(profileIsCurrent ? 403 : 428).json({
        message: profileIsCurrent
          ? 'Confirme seu rosto para abrir este modulo.'
          : (profileIsOutdated
            ? 'Atualize seu cadastro facial no perfil antes de acessar este modulo.'
            : 'Cadastre seu rosto no perfil antes de acessar este modulo.'),
        code: profileIsCurrent
          ? 'FACE_VERIFICATION_REQUIRED'
          : (profileIsOutdated ? 'FACE_PROFILE_OUTDATED' : 'FACE_PROFILE_REQUIRED'),
        faceVerification: settings
      });
    }
  }
  res.json({
    id: module.id,
    course_id: module.course_id,
    courseId: module.course_id,
    courseTitle: module.course_title,
    title: module.title,
    slug: module.slug,
    description: module.description,
    builder_data: module.builder_data,
    position: module.position,
    created_at: module.created_at
  });
}));

router.use(asyncHandler(async (req, res, next) => {
  await ensureFaceVerificationSchema();
  next();
}));

module.exports = router;
