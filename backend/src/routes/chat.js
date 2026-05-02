const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sanitizeText, isUuid, createRateLimiter } = require('../security');

const router = express.Router();
router.use(requireAuth);

const MSG_MAX_LENGTH = 1000;

const chatRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyFn: (req) => `chat:${req.user?.id || req.ip}`
});

let chatStorageEnsured = false;

const ensureChatStorage = async () => {
  if (chatStorageEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS course_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_to_message_id UUID NULL REFERENCES course_messages(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    ALTER TABLE course_messages
    ADD COLUMN IF NOT EXISTS reply_to_message_id UUID NULL REFERENCES course_messages(id) ON DELETE SET NULL
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_course_messages_course_id
    ON course_messages(course_id, created_at DESC)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS course_message_reads (
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (course_id, user_id)
    )
  `);
  chatStorageEnsured = true;
};

const isTeacherRole = (role) => role === 'admin' || role === 'professor';

const ensureCourseChatAccess = async ({ courseId, userId, role }) => {
  if (role === 'admin') {
    return true;
  }
  if (role === 'professor') {
    const { rows } = await db.query(
      'SELECT 1 FROM courses WHERE id = $1 AND owner_user_id = $2',
      [courseId, userId]
    );
    return rows.length > 0;
  }
  const { rows } = await db.query(
    'SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2',
    [courseId, userId]
  );
  return rows.length > 0;
};

const markCourseChatRead = async ({ courseId, userId }) => {
  await db.query(
    `INSERT INTO course_message_reads (course_id, user_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (course_id, user_id)
     DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
    [courseId, userId]
  );
};

router.get('/admin/courses', async (req, res) => {
  await ensureChatStorage();
  if (!isTeacherRole(req.user.role)) {
    return res.status(403).json({ message: 'Apenas admins e professores podem acessar esta area.' });
  }

  const params = [req.user.id];
  const { rows } = await db.query(
    `SELECT
        c.id,
        c.title,
        c.slug,
        c.cover_image,
        COALESCE(message_count.total_messages, 0) AS total_messages,
        COALESCE(unread.unread_count, 0) AS unread_count,
        last_message.message AS last_message,
        last_message.created_at AS last_message_created_at,
        last_user.full_name AS last_message_author,
        last_user.role AS last_message_role
     FROM courses c
     LEFT JOIN (
       SELECT course_id, COUNT(*)::int AS total_messages
       FROM course_messages
       GROUP BY course_id
     ) message_count ON message_count.course_id = c.id
     LEFT JOIN course_message_reads reads
       ON reads.course_id = c.id AND reads.user_id = $1
     LEFT JOIN LATERAL (
       SELECT cm.message, cm.created_at, cm.user_id
       FROM course_messages cm
       WHERE cm.course_id = c.id
       ORDER BY cm.created_at DESC
       LIMIT 1
     ) last_message ON TRUE
     LEFT JOIN users last_user ON last_user.id = last_message.user_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS unread_count
       FROM course_messages cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.course_id = c.id
         AND u.role = 'student'
         AND cm.created_at > COALESCE(reads.last_read_at, to_timestamp(0))
     ) unread ON TRUE
     ${req.user.role === 'professor' ? 'WHERE c.owner_user_id = $2' : ''}
     ORDER BY
       CASE WHEN COALESCE(unread.unread_count, 0) > 0 THEN 0 ELSE 1 END,
       last_message.created_at DESC NULLS LAST,
       c.title`,
    req.user.role === 'professor' ? [req.user.id, req.user.id] : params
  );

  res.json(rows);
});

router.get('/:courseId', async (req, res) => {
  await ensureChatStorage();
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'ID de curso invalido' });
  }

  const hasAccess = await ensureCourseChatAccess({
    courseId,
    userId: req.user.id,
    role: req.user.role
  });
  if (!hasAccess) {
    return res.status(403).json({ message: 'Acesso negado a este chat' });
  }

  if (isTeacherRole(req.user.role)) {
    await markCourseChatRead({ courseId, userId: req.user.id });
  }

  const { rows } = await db.query(
    `SELECT
        cm.id,
        cm.message,
        cm.created_at,
        cm.reply_to_message_id,
        u.full_name,
        u.role,
        parent.message AS reply_to_message,
        parent.created_at AS reply_to_created_at,
        parent_user.full_name AS reply_to_full_name,
        parent_user.role AS reply_to_role
     FROM course_messages cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN course_messages parent ON parent.id = cm.reply_to_message_id
     LEFT JOIN users parent_user ON parent_user.id = parent.user_id
     WHERE cm.course_id = $1
     ORDER BY cm.created_at ASC
     LIMIT 50`,
    [courseId]
  );

  res.json(rows);
});

router.post('/:courseId/read', async (req, res) => {
  await ensureChatStorage();
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'ID de curso invalido' });
  }

  const hasAccess = await ensureCourseChatAccess({
    courseId,
    userId: req.user.id,
    role: req.user.role
  });
  if (!hasAccess) {
    return res.status(403).json({ message: 'Acesso negado a este chat' });
  }

  await markCourseChatRead({ courseId, userId: req.user.id });
  res.status(204).send();
});

router.post('/:courseId', chatRateLimiter, async (req, res) => {
  await ensureChatStorage();
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'ID de curso invalido' });
  }

  const userId = req.user.id;
  const role = req.user.role;
  const rawMessage = req.body?.message || '';
  const message = sanitizeText(rawMessage, MSG_MAX_LENGTH);
  const replyToMessageId = req.body?.replyToMessageId || null;

  if (!message.trim()) {
    return res.status(400).json({ message: 'Mensagem nao pode ser vazia' });
  }
  if (replyToMessageId !== null && !isUuid(replyToMessageId)) {
    return res.status(400).json({ message: 'Mensagem respondida invalida.' });
  }

  const hasAccess = await ensureCourseChatAccess({ courseId, userId, role });
  if (!hasAccess) {
    return res.status(403).json({ message: role === 'admin' ? 'Acesso negado.' : 'Voce nao tem acesso a este curso' });
  }

  if (!isTeacherRole(role)) {
    const { rows: userRows } = await db.query(
      'SELECT is_active FROM users WHERE id = $1',
      [userId]
    );
    if (!userRows[0]?.is_active) {
      return res.status(403).json({ message: 'Conta bloqueada. Contate o administrador.' });
    }
  }

  let replyRow = null;
  if (replyToMessageId) {
    const { rows: replyRows } = await db.query(
      `SELECT cm.id, cm.message, cm.created_at, u.full_name, u.role
       FROM course_messages cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.id = $1 AND cm.course_id = $2`,
      [replyToMessageId, courseId]
    );
    replyRow = replyRows[0] || null;
    if (!replyRow) {
      return res.status(404).json({ message: 'A mensagem respondida nao foi encontrada neste curso.' });
    }
  }

  const { rows } = await db.query(
    `INSERT INTO course_messages (course_id, user_id, reply_to_message_id, message)
     VALUES ($1, $2, $3, $4)
     RETURNING id, message, created_at, reply_to_message_id`,
    [courseId, userId, replyToMessageId, message]
  );

  await markCourseChatRead({ courseId, userId });

  res.status(201).json({
    ...rows[0],
    full_name: req.user.fullName,
    role: req.user.role,
    reply_to_message: replyRow?.message || null,
    reply_to_created_at: replyRow?.created_at || null,
    reply_to_full_name: replyRow?.full_name || null,
    reply_to_role: replyRow?.role || null
  });
});

module.exports = router;
