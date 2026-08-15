const express = require('express');
const db = require('../db');
const { isUuid, sanitizeText } = require('../security');
const { ensureStudentProfessorLinksSchema } = require('../studentProfessorLinks');
const {
  audit,
  decryptBuffer,
  ensureFaceVerificationSchema
} = require('../faceVerification');

const router = express.Router();
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
const REVIEW_DECISIONS = new Set(['approve_once', 'reset_attempts', 'require_reenrollment', 'deny']);

const getReview = async (reviewId, user) => {
  await ensureFaceVerificationSchema();
  const values = [reviewId];
  let scope = '';
  if (user.role !== 'admin') {
    values.push(user.id);
    scope = `AND r.owner_user_id = $${values.length}`;
  }
  const { rows } = await db.query(
    `SELECT r.*, s.purpose, s.attempt_count, s.failure_code,
            u.full_name AS student_name, u.email AS student_email,
            m.title AS module_title, c.title AS course_title
       FROM face_review_requests r
       JOIN face_verification_sessions s ON s.id = r.session_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN modules m ON m.id = r.module_id
       LEFT JOIN courses c ON c.id = m.course_id
      WHERE r.id = $1 ${scope}
      LIMIT 1`,
    values
  );
  return rows[0] || null;
};

router.get('/face-reviews', asyncHandler(async (req, res) => {
  await ensureFaceVerificationSchema();
  const values = [];
  let scope = '';
  if (req.user.role !== 'admin') {
    values.push(req.user.id);
    scope = `WHERE r.owner_user_id = $${values.length}`;
  }
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.created_at, r.reviewed_at, r.audit_image_expires_at,
            s.purpose, s.attempt_count,
            u.id AS student_id, u.full_name AS student_name, u.email AS student_email,
            m.id AS module_id, m.title AS module_title, c.title AS course_title
       FROM face_review_requests r
       JOIN face_verification_sessions s ON s.id = r.session_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN modules m ON m.id = r.module_id
       LEFT JOIN courses c ON c.id = m.course_id
       ${scope}
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 200`,
    values
  );
  res.json(rows.map((row) => ({
    ...row,
    auditImageAvailable: Boolean(row.audit_image_expires_at && new Date(row.audit_image_expires_at).getTime() > Date.now())
  })));
}));

router.get('/face-reviews/:reviewId/image', asyncHandler(async (req, res) => {
  if (!isUuid(req.params.reviewId)) {
    return res.status(400).json({ message: 'Revisao invalida.' });
  }
  const review = await getReview(req.params.reviewId, req.user);
  if (!review) {
    return res.status(404).json({ message: 'Revisao nao encontrada.' });
  }
  if (!review.audit_image_ciphertext || new Date(review.audit_image_expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ message: 'A imagem temporaria desta revisao ja foi removida.' });
  }
  const image = decryptBuffer({
    ciphertext: review.audit_image_ciphertext,
    iv: review.audit_image_iv,
    tag: review.audit_image_tag
  });
  res.setHeader('Content-Type', review.audit_image_mime || 'image/jpeg');
  res.setHeader('Content-Length', String(image.length));
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(image);
}));

router.post('/face-reviews/:reviewId/decision', asyncHandler(async (req, res) => {
  if (!isUuid(req.params.reviewId)) {
    return res.status(400).json({ message: 'Revisao invalida.' });
  }
  const decision = sanitizeText(req.body?.decision || '', 40);
  const note = sanitizeText(req.body?.note || '', 500);
  if (!REVIEW_DECISIONS.has(decision)) {
    return res.status(400).json({ message: 'Decisao de revisao invalida.' });
  }
  const review = await getReview(req.params.reviewId, req.user);
  if (!review) {
    return res.status(404).json({ message: 'Revisao nao encontrada.' });
  }
  if (review.status !== 'pending') {
    return res.status(409).json({ message: 'Esta revisao ja foi concluida.' });
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (decision === 'approve_once') {
      if (!review.module_id) {
        const error = new Error('A revisao nao esta vinculada a um modulo.');
        error.statusCode = 400;
        throw error;
      }
      await client.query(
        `INSERT INTO face_access_grants
           (user_id, module_id, purpose, granted_by, expires_at)
         VALUES ($1, $2, 'manual', $3, NOW() + INTERVAL '1 hour')`,
        [review.user_id, review.module_id, req.user.id]
      );
    } else if (decision === 'reset_attempts') {
      await client.query(
        `UPDATE face_verification_sessions
            SET status = 'expired', updated_at = NOW()
          WHERE id = $1`,
        [review.session_id]
      );
    } else if (decision === 'require_reenrollment') {
      await client.query(
        `UPDATE student_face_profiles
            SET status = 'reenrollment_required', updated_at = NOW()
          WHERE user_id = $1`,
        [review.user_id]
      );
      await client.query(`DELETE FROM face_access_grants WHERE user_id = $1`, [review.user_id]);
    }
    const storedStatus = {
      approve_once: 'approved_once',
      reset_attempts: 'attempts_reset',
      require_reenrollment: 'reenrollment_required',
      deny: 'denied'
    }[decision];
    await client.query(
      `UPDATE face_review_requests
          SET status = $2, reviewed_by = $3, reviewed_at = NOW(),
              review_note = $4, updated_at = NOW()
        WHERE id = $1`,
      [review.id, storedStatus, req.user.id, note || null]
    );
    await client.query('COMMIT');
    await audit({
      actorUserId: req.user.id,
      studentUserId: review.user_id,
      moduleId: review.module_id,
      eventType: 'face_review_decision',
      metadata: { decision }
    });
    res.json({ updated: true, status: storedStatus });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {}
    throw error;
  } finally {
    client.release();
  }
}));

router.post('/face-manual-grants', asyncHandler(async (req, res) => {
  await ensureFaceVerificationSchema();
  await ensureStudentProfessorLinksSchema();
  const studentId = sanitizeText(req.body?.studentId || '', 80);
  const moduleId = sanitizeText(req.body?.moduleId || '', 80);
  const note = sanitizeText(req.body?.note || '', 500);
  if (!isUuid(studentId) || !isUuid(moduleId)) {
    return res.status(400).json({ message: 'Selecione um aluno e um modulo validos.' });
  }
  const values = [studentId, moduleId];
  let ownerScope = '';
  if (req.user.role !== 'admin') {
    values.push(req.user.id);
    ownerScope = `AND c.owner_user_id = $3 AND EXISTS (
      SELECT 1 FROM professor_students relation
       WHERE relation.student_user_id = u.id AND relation.professor_user_id = $3
    )`;
  }
  const { rows } = await db.query(
    `SELECT u.id AS student_id, m.id AS module_id, m.builder_data
       FROM users u
       JOIN enrollments e ON e.user_id = u.id
       JOIN modules m ON m.id = $2 AND m.course_id = e.course_id
       JOIN courses c ON c.id = m.course_id
      WHERE u.id = $1
        AND u.role = 'student'
        ${ownerScope}
      LIMIT 1`,
    values
  );
  const target = rows[0];
  if (!target) {
    return res.status(404).json({ message: 'Aluno, matricula ou modulo nao encontrado.' });
  }
  if (!target.builder_data?.moduleSettings?.faceVerification?.enabled) {
    return res.status(400).json({ message: 'Este modulo nao exige verificacao facial.' });
  }
  await db.query(
    `INSERT INTO face_access_grants
       (user_id, module_id, purpose, granted_by, expires_at)
     VALUES ($1, $2, 'manual', $3, NOW() + INTERVAL '1 hour')`,
    [studentId, moduleId, req.user.id]
  );
  await audit({
    actorUserId: req.user.id,
    studentUserId: studentId,
    moduleId,
    eventType: 'face_manual_access_granted',
    metadata: { reason: note || 'accessibility_or_camera_unavailable' }
  });
  res.status(201).json({ granted: true, expiresInMinutes: 60 });
}));

module.exports = router;
