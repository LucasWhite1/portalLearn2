const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./db');
const { ensureStudentPaymentSchema } = require('./studentPayments');
const {
  countProfessorStudents,
  ensureStudentProfessorLinksSchema,
  linkStudentToProfessor
} = require('./studentProfessorLinks');
const {
  sanitizeEmail,
  sanitizePhone,
  sanitizeSlug,
  sanitizeText,
  sanitizeNotificationMessage,
  isUuid
} = require('./security');

const PROPOSAL_TTL_MINUTES = 15;
const MAX_ACTIONS_PER_PROPOSAL = 20;
const MAX_HISTORY_ITEMS = 12;
const ALLOWED_ACTION_TYPES = new Set([
  'create_student',
  'update_student',
  'delete_student',
  'create_class',
  'delete_class',
  'create_course',
  'update_course',
  'delete_course',
  'enroll_students',
  'remove_enrollments',
  'send_notification',
  'send_chat_message',
  'decide_access_request',
  'mark_report_corrected',
  'update_student_payment_plan',
  'mark_student_payment_paid'
]);

const ACTION_LABELS = {
  create_student: 'Criar aluno',
  update_student: 'Atualizar aluno',
  delete_student: 'Excluir aluno',
  create_class: 'Criar turma',
  delete_class: 'Excluir turma',
  create_course: 'Criar curso',
  update_course: 'Atualizar curso',
  delete_course: 'Excluir curso',
  enroll_students: 'Matricular aluno(s)',
  remove_enrollments: 'Remover matrícula(s)',
  send_notification: 'Enviar notificação',
  send_chat_message: 'Responder no chat do curso',
  decide_access_request: 'Analisar solicitação de acesso',
  mark_report_corrected: 'Marcar relatório como corrigido',
  update_student_payment_plan: 'Atualizar financeiro do aluno',
  mark_student_payment_paid: 'Registrar mensalidade como paga'
};

const DANGEROUS_ACTIONS = new Set([
  'delete_student',
  'delete_class',
  'delete_course',
  'remove_enrollments',
  'update_student_payment_plan',
  'mark_student_payment_paid'
]);

const SECRET_PATTERNS = [
  /\b(?:senha|password|api[_ -]?key|chave de api|token|secret|smtp)\s*[:=]\s*\S+/gi,
  /\$aact_[a-z0-9_:-]{20,}/gi,
  /\bwhsec_[a-z0-9_-]{16,}\b/gi,
  /\bsk-[a-z0-9_-]{16,}\b/gi
];

const redactSecrets = (value) => {
  let text = String(value || '');
  SECRET_PATTERNS.forEach((pattern) => {
    text = text.replace(pattern, '[DADO SENSIVEL REMOVIDO]');
  });
  return text;
};

const containsSensitiveRequest = (value) => {
  const text = String(value || '').toLowerCase();
  return [
    'mostre a senha',
    'mostrar senha',
    'qual a senha',
    'password_hash',
    'session_secret',
    'database_url',
    'asaas_api_key',
    'api key salva',
    'chave de api salva',
    'token de autenticacao'
  ].some((phrase) => text.includes(phrase));
};

const cleanHistory = (history) =>
  (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: redactSecrets(sanitizeText(item?.content || '', 1600))
    }))
    .filter((item) => item.content);

const ensureAssistantTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_assistant_proposals (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_text TEXT NOT NULL,
      reply TEXT NOT NULL,
      actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_assistant_audit (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proposal_id UUID REFERENCES admin_ai_assistant_proposals(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      action_summary TEXT NOT NULL,
      action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_ai_assistant_proposals_user
    ON admin_ai_assistant_proposals(user_id, created_at DESC)
  `);
};

const ensureAssistantDataTables = async () => {
  await ensureStudentProfessorLinksSchema();
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL");
  await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL");
  await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL");
  await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb");
  await db.query(`
    ALTER TABLE enrollments
      ADD COLUMN IF NOT EXISTS report_corrected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS quiz_attempts JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS interactive_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS video_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS progress_events JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query("ALTER TABLE classes ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE");
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
};

const scopeSql = (role, alias, ownerColumn = 'owner_user_id', paramIndex = 1) =>
  role === 'professor' ? ` AND ${alias}.${ownerColumn} = $${paramIndex}` : '';

const scopeParams = (user) => (user.role === 'professor' ? [user.id] : []);

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const summarizeReportModules = (report, modules = []) => {
  const interactiveMap = asObject(report.interactive_progress);
  const videoMap = asObject(report.video_progress);
  const quizMap = asObject(report.quiz_attempts);
  const moduleTitleById = new Map(modules.map((module) => [module.id, module.title]));
  const moduleIds = new Set(modules.map((module) => module.id).filter(Boolean));
  Object.keys(interactiveMap).forEach((id) => id && moduleIds.add(id));
  Object.values(videoMap).forEach((entry) => entry?.moduleId && moduleIds.add(entry.moduleId));
  Object.keys(quizMap).forEach((key) => {
    const moduleId = String(key || '').split('::')[0];
    if (moduleId) moduleIds.add(moduleId);
  });
  return [...moduleIds].slice(0, 40).map((moduleId, index) => {
    const interactive = asObject(interactiveMap[moduleId]);
    const viewedSlides = Array.isArray(interactive.viewedSlides) ? interactive.viewedSlides.length : 0;
    const completedSlides = Array.isArray(interactive.completedSlides) ? interactive.completedSlides.length : 0;
    const totalSlides = Math.max(0, Number(interactive.totalSlides) || viewedSlides || completedSlides);
    const videos = Object.values(videoMap).filter((entry) => entry?.moduleId === moduleId);
    const watchedSeconds = videos.reduce((sum, entry) => sum + Math.max(0, Number(entry?.watchedSeconds) || 0), 0);
    const durationSeconds = videos.reduce((sum, entry) => sum + Math.max(0, Number(entry?.durationSeconds) || 0), 0);
    const completedVideos = videos.filter((entry) => entry?.completed === true).length;
    const quizzes = Object.entries(quizMap).filter(([key]) => String(key).startsWith(`${moduleId}::`));
    const answeredQuizzes = quizzes.filter(([, attempt]) => attempt?.answered === true).length;
    const correctQuizzes = quizzes.filter(([, attempt]) => attempt?.answered === true && attempt?.isCorrect === true).length;
    const quizScore = answeredQuizzes ? Math.round((correctQuizzes / answeredQuizzes) * 100) : null;
    const slideScore = totalSlides ? Math.round((completedSlides / totalSlides) * 100) : null;
    const videoScore = durationSeconds
      ? Math.round(Math.min(100, (watchedSeconds / durationSeconds) * 100))
      : videos.length
        ? Math.round((completedVideos / videos.length) * 100)
        : null;
    const scores = [quizScore, slideScore, videoScore].filter((value) => value !== null);
    return {
      moduleId,
      moduleTitle: moduleTitleById.get(moduleId) || `Módulo ${index + 1}`,
      quizScore,
      answeredQuizzes,
      correctQuizzes,
      viewedSlides,
      completedSlides,
      totalSlides,
      slideScore,
      videoCount: videos.length,
      completedVideos,
      watchedMinutes: Math.round(watchedSeconds / 60),
      videoScore,
      performanceScore: scores.length
        ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
        : 0
    };
  });
};

const loadAssistantContext = async (user) => {
  await ensureAssistantDataTables();
  await ensureStudentPaymentSchema();
  const params = scopeParams(user);
  const [studentsResult, coursesResult, classesResult, reportsResult, requestsResult, messagesResult, modulesResult, paymentsResult] = await Promise.all([
    db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.class_name, u.is_active,
              COALESCE(jsonb_agg(jsonb_build_object('courseId', c.id, 'courseTitle', c.title))
                FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS enrollments
       FROM users u
       LEFT JOIN enrollments e ON e.user_id = u.id
       LEFT JOIN courses c ON c.id = e.course_id${user.role === 'professor' ? ' AND c.owner_user_id = $1' : ''}
       WHERE u.role = 'student'${user.role === 'professor' ? ` AND EXISTS (
         SELECT 1 FROM professor_students relation
          WHERE relation.student_user_id = u.id AND relation.professor_user_id = $1
       )` : ''}
       GROUP BY u.id
       ORDER BY u.full_name
       LIMIT 250`,
      params
    ),
    db.query(
      `SELECT c.id, c.title, c.description, c.slug, c.show_in_store,
              COUNT(DISTINCT m.id)::int AS module_count,
              COUNT(DISTINCT e.user_id)::int AS student_count
       FROM courses c
       LEFT JOIN modules m ON m.course_id = c.id
       LEFT JOIN enrollments e ON e.course_id = c.id
       WHERE TRUE${scopeSql(user.role, 'c')}
       GROUP BY c.id
       ORDER BY c.title
       LIMIT 150`,
      params
    ),
    db.query(
      `SELECT cl.id, cl.name
       FROM classes cl
       WHERE TRUE${scopeSql(user.role, 'cl')}
       ORDER BY cl.name
       LIMIT 100`,
      params
    ),
    db.query(
       `SELECT u.id AS student_id, u.full_name AS student_name, c.id AS course_id,
              c.title AS course_title, e.current_module, e.grade, e.video_position,
              e.interactive_step, e.updated_at, e.report_corrected_at,
              e.quiz_attempts, e.interactive_progress, e.video_progress,
              COALESCE(jsonb_array_length(e.progress_events), 0) AS progress_event_count
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       WHERE TRUE${user.role === 'professor' ? ` AND c.owner_user_id = $1 AND EXISTS (
         SELECT 1 FROM professor_students relation
          WHERE relation.student_user_id = u.id AND relation.professor_user_id = $1
       )` : ''}
       ORDER BY e.updated_at DESC
       LIMIT 300`,
      params
    ),
    db.query(
      `SELECT car.id, car.status, car.created_at, car.user_id AS student_id,
              u.full_name AS student_name, car.course_id, c.title AS course_title
       FROM course_access_requests car
       JOIN users u ON u.id = car.user_id
       JOIN courses c ON c.id = car.course_id
       WHERE car.status = 'pending'${scopeSql(user.role, 'c')}
       ORDER BY car.created_at DESC
       LIMIT 100`,
      params
    ),
    db.query(
      `SELECT cm.id, cm.course_id, c.title AS course_title, cm.user_id,
              u.full_name, u.role, cm.message, cm.created_at
       FROM course_messages cm
       JOIN courses c ON c.id = cm.course_id
       JOIN users u ON u.id = cm.user_id
       WHERE TRUE${scopeSql(user.role, 'c')}
       ORDER BY cm.created_at DESC
       LIMIT 100`,
      params
    ),
    db.query(
      `SELECT m.id, m.course_id, m.title, m.position
       FROM modules m
       JOIN courses c ON c.id = m.course_id
       WHERE TRUE${scopeSql(user.role, 'c')}
       ORDER BY m.course_id, m.position NULLS LAST, m.created_at
       LIMIT 1000`,
      params
    ),
    db.query(
      `SELECT student.id AS student_id, relation.professor_user_id AS professor_id,
              professor.full_name AS professor_name,
              p.id AS plan_id, p.amount, p.due_day, p.billing_type, p.grace_days,
              p.auto_block, p.status AS plan_status, p.description, p.payment_instructions,
              p.provider_subscription_id,
              period.due_date, period.amount AS period_amount, period.status AS payment_status,
              period.failure_reason, period.paid_at
         FROM users student
         JOIN professor_students relation ON relation.student_user_id = student.id
         LEFT JOIN users professor ON professor.id = relation.professor_user_id
         LEFT JOIN student_payment_plans p
           ON p.student_user_id = student.id AND p.professor_user_id = relation.professor_user_id
         LEFT JOIN LATERAL (
           SELECT due_date, amount, status, failure_reason, paid_at
             FROM student_payment_periods
            WHERE plan_id = p.id
            ORDER BY due_date DESC
            LIMIT 1
         ) period ON TRUE
        WHERE student.role = 'student'${user.role === 'professor' ? ' AND relation.professor_user_id = $1' : ''}
        ORDER BY student.full_name
        LIMIT 250`,
      params
    )
  ]);

  const modulesByCourse = new Map();
  modulesResult.rows.forEach((module) => {
    if (!modulesByCourse.has(module.course_id)) modulesByCourse.set(module.course_id, []);
    modulesByCourse.get(module.course_id).push(module);
  });
  const reports = reportsResult.rows.map((report) => ({
    student_id: report.student_id,
    student_name: report.student_name,
    course_id: report.course_id,
    course_title: report.course_title,
    current_module: report.current_module,
    grade: report.grade,
    video_position: report.video_position,
    interactive_step: report.interactive_step,
    updated_at: report.updated_at,
    report_corrected_at: report.report_corrected_at,
    progress_event_count: Number(report.progress_event_count || 0),
    modulePerformance: summarizeReportModules(report, modulesByCourse.get(report.course_id) || [])
  }));
  const paymentByStudentId = new Map(paymentsResult.rows.map((payment) => [payment.student_id, {
    professorId: payment.professor_id,
    professorName: payment.professor_name,
    configured: Boolean(payment.plan_id),
    planId: payment.plan_id,
    amount: payment.amount === null ? null : Number(payment.amount),
    dueDay: payment.due_day === null ? null : Number(payment.due_day),
    billingType: payment.billing_type,
    graceDays: payment.grace_days === null ? null : Number(payment.grace_days),
    autoBlock: payment.auto_block,
    planStatus: payment.plan_status,
    description: payment.description,
    instructions: payment.payment_instructions,
    automaticReady: Boolean(payment.provider_subscription_id),
    currentPeriod: payment.due_date ? {
      dueDate: payment.due_date,
      amount: Number(payment.period_amount || payment.amount || 0),
      status: payment.payment_status,
      failureReason: payment.failure_reason,
      paidAt: payment.paid_at
    } : null
  }]));
  return {
    generatedAt: new Date().toISOString(),
    role: user.role,
    students: studentsResult.rows.map((student) => ({
      ...student,
      financial: paymentByStudentId.get(student.id) || { configured: false }
    })),
    courses: coursesResult.rows,
    classes: classesResult.rows,
    reports,
    pendingAccessRequests: requestsResult.rows,
    recentMessages: messagesResult.rows
  };
};

const findById = (items, id) => items.find((item) => item.id === id);
const validId = (value) => (isUuid(value) ? value : '');

const normalizeAction = (rawAction, context) => {
  const type = sanitizeText(rawAction?.type || '', 60);
  if (!ALLOWED_ACTION_TYPES.has(type)) return null;
  const action = { type };

  if (type === 'create_student') {
    action.fullName = sanitizeText(rawAction.fullName || '', 160);
    action.email = sanitizeEmail(rawAction.email || '');
    action.phone = sanitizePhone(rawAction.phone || '');
    action.className = sanitizeText(rawAction.className || 'Turma A', 120);
    if (!action.fullName || !action.email) return null;
  }

  if (['update_student', 'delete_student'].includes(type)) {
    action.studentId = validId(rawAction.studentId);
    if (!findById(context.students, action.studentId)) return null;
    if (type === 'update_student') {
      action.fullName = sanitizeText(rawAction.fullName || '', 160) || null;
      action.phone = sanitizePhone(rawAction.phone || '') || null;
      action.className = sanitizeText(rawAction.className || '', 120) || null;
      action.isActive = typeof rawAction.isActive === 'boolean' ? rawAction.isActive : null;
      if (!action.fullName && !action.phone && !action.className && action.isActive === null) return null;
    }
  }

  if (type === 'update_student_payment_plan') {
    action.studentId = validId(rawAction.studentId);
    if (!findById(context.students, action.studentId)) return null;
    const amount = Number(rawAction.amount);
    const dueDay = Number.parseInt(rawAction.dueDay, 10);
    const graceDays = Number.parseInt(rawAction.graceDays, 10);
    action.amount = Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null;
    action.dueDay = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 28 ? dueDay : null;
    action.billingType = ['MANUAL', 'PIX', 'BOLETO', 'CREDIT_CARD'].includes(String(rawAction.billingType || '').toUpperCase())
      ? String(rawAction.billingType).toUpperCase()
      : null;
    action.graceDays = Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= 60 ? graceDays : null;
    action.autoBlock = typeof rawAction.autoBlock === 'boolean' ? rawAction.autoBlock : null;
    action.status = ['ACTIVE', 'PAUSED'].includes(String(rawAction.status || '').toUpperCase())
      ? String(rawAction.status).toUpperCase()
      : null;
    action.description = sanitizeText(rawAction.description || '', 240) || null;
    action.instructions = sanitizeText(rawAction.instructions || '', 800) || null;
    if ([action.amount, action.dueDay, action.billingType, action.graceDays, action.autoBlock,
      action.status, action.description, action.instructions].every((value) => value === null)) return null;
  }

  if (type === 'mark_student_payment_paid') {
    action.studentId = validId(rawAction.studentId);
    if (!findById(context.students, action.studentId)) return null;
  }

  if (['create_class'].includes(type)) {
    action.name = sanitizeText(rawAction.name || '', 120);
    if (!action.name) return null;
  }

  if (type === 'delete_class') {
    action.classId = validId(rawAction.classId);
    if (!findById(context.classes, action.classId)) return null;
  }

  if (type === 'create_course') {
    action.title = sanitizeText(rawAction.title || '', 180);
    action.description = sanitizeText(rawAction.description || '', 4000);
    action.slug = sanitizeSlug(rawAction.slug || action.title);
    action.showInStore = rawAction.showInStore === true;
    if (!action.title || !action.slug) return null;
  }

  if (['update_course', 'delete_course'].includes(type)) {
    action.courseId = validId(rawAction.courseId);
    if (!findById(context.courses, action.courseId)) return null;
    if (type === 'update_course') {
      action.title = sanitizeText(rawAction.title || '', 180) || null;
      action.description = sanitizeText(rawAction.description || '', 4000) || null;
      action.slug = sanitizeSlug(rawAction.slug || '') || null;
      action.showInStore = typeof rawAction.showInStore === 'boolean' ? rawAction.showInStore : null;
      if (!action.title && !action.description && !action.slug && action.showInStore === null) return null;
    }
  }

  if (['enroll_students', 'remove_enrollments'].includes(type)) {
    action.courseId = validId(rawAction.courseId);
    action.studentIds = [...new Set((Array.isArray(rawAction.studentIds) ? rawAction.studentIds : [])
      .map(validId)
      .filter((id) => findById(context.students, id)))].slice(0, 100);
    if (!findById(context.courses, action.courseId) || !action.studentIds.length) return null;
  }

  if (type === 'send_notification') {
    action.message = sanitizeNotificationMessage(rawAction.message || '');
    action.targetType = ['all', 'class', 'student'].includes(rawAction.targetType) ? rawAction.targetType : '';
    action.targetValue = sanitizeText(rawAction.targetValue || '', 120) || null;
    if (!action.message || !action.targetType) return null;
    if (action.targetType === 'student' && !findById(context.students, action.targetValue)) return null;
    if (action.targetType === 'class' && !context.classes.some((item) => item.name === action.targetValue)) return null;
  }

  if (type === 'send_chat_message') {
    action.courseId = validId(rawAction.courseId);
    action.message = sanitizeText(rawAction.message || '', 1000);
    action.replyToMessageId = validId(rawAction.replyToMessageId) || null;
    if (!findById(context.courses, action.courseId) || !action.message) return null;
    if (action.replyToMessageId && !context.recentMessages.some((item) => item.id === action.replyToMessageId && item.course_id === action.courseId)) {
      return null;
    }
  }

  if (type === 'decide_access_request') {
    action.requestId = validId(rawAction.requestId);
    action.decision = ['approved', 'rejected'].includes(rawAction.decision) ? rawAction.decision : '';
    if (!context.pendingAccessRequests.some((item) => item.id === action.requestId) || !action.decision) return null;
  }

  if (type === 'mark_report_corrected') {
    action.studentId = validId(rawAction.studentId);
    action.courseId = validId(rawAction.courseId);
    if (!context.reports.some((item) => item.student_id === action.studentId && item.course_id === action.courseId)) return null;
  }

  return action;
};

const actionSummary = (action, context) => {
  const student = findById(context.students, action.studentId);
  const course = findById(context.courses, action.courseId);
  const classItem = findById(context.classes, action.classId);
  const names = (action.studentIds || [])
    .map((id) => findById(context.students, id)?.full_name)
    .filter(Boolean)
    .join(', ');
  const details = {
    create_student: `${action.fullName} (${action.email})`,
    update_student: student?.full_name || action.studentId,
    delete_student: student?.full_name || action.studentId,
    create_class: action.name,
    delete_class: classItem?.name || action.classId,
    create_course: action.title,
    update_course: course?.title || action.courseId,
    delete_course: course?.title || action.courseId,
    enroll_students: `${names} em ${course?.title || action.courseId}`,
    remove_enrollments: `${names} de ${course?.title || action.courseId}`,
    send_notification: `${action.targetType === 'all' ? 'Todos' : action.targetValue}: ${action.message}`,
    send_chat_message: `${course?.title || action.courseId}: ${action.message}`,
    decide_access_request: action.decision === 'approved' ? 'Aprovar solicitação' : 'Recusar solicitação',
    mark_report_corrected: `${student?.full_name || action.studentId} em ${course?.title || action.courseId}`,
    update_student_payment_plan: `${student?.full_name || action.studentId}${action.amount ? ` · ${action.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`,
    mark_student_payment_paid: student?.full_name || action.studentId
  };
  return `${ACTION_LABELS[action.type]}: ${details[action.type] || ''}`.slice(0, 600);
};

const normalizeAssistantResponse = (payload, context) => {
  const reply = sanitizeText(redactSecrets(payload?.reply || ''), 4000, { trim: true })
    .replace(/```[\s\S]*?```/g, '[conteudo tecnico omitido]');
  const actions = (Array.isArray(payload?.actions) ? payload.actions : [])
    .slice(0, MAX_ACTIONS_PER_PROPOSAL)
    .map((action) => normalizeAction(action, context))
    .filter(Boolean)
    .map((action) => ({
      ...action,
      label: ACTION_LABELS[action.type],
      summary: actionSummary(action, context),
      dangerous: DANGEROUS_ACTIONS.has(action.type)
    }));
  return {
    reply: reply || (actions.length ? 'Preparei as ações abaixo para sua confirmação.' : 'Não consegui concluir essa solicitação com segurança.'),
    actions
  };
};

const storeProposal = async ({ userId, requestText, response }) => {
  await ensureAssistantTables();
  if (!response.actions.length) return null;
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60 * 1000);
  await db.query(
    `INSERT INTO admin_ai_assistant_proposals
       (id, user_id, request_text, reply, actions, status, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6)`,
    [id, userId, sanitizeText(redactSecrets(requestText), 2000), response.reply, JSON.stringify(response.actions), expiresAt]
  );
  return { id, expiresAt };
};

const assertOwnedStudent = async (client, user, studentId) => {
  const { rows } = await client.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'student'${user.role === 'professor' ? ` AND EXISTS (
      SELECT 1 FROM professor_students relation
       WHERE relation.student_user_id = users.id AND relation.professor_user_id = $2
    )` : ''}`,
    user.role === 'professor' ? [studentId, user.id] : [studentId]
  );
  if (!rows.length) throw new Error('Aluno não encontrado ou fora da sua conta.');
};

const assertOwnedCourse = async (client, user, courseId) => {
  const { rows } = await client.query(
    `SELECT id FROM courses WHERE id = $1${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
    user.role === 'professor' ? [courseId, user.id] : [courseId]
  );
  if (!rows.length) throw new Error('Curso não encontrado ou fora da sua conta.');
};

const assertProfessorStorageForText = async (client, user, additionalBytes) => {
  if (user.role !== 'professor' || additionalBytes <= 0) return;
  const { rows } = await client.query(
    `SELECT u.storage_limit_bytes,
            (
              SELECT COALESCE(SUM(
                octet_length(COALESCE(c.title, '')) +
                octet_length(COALESCE(c.description, '')) +
                octet_length(COALESCE(c.slug, '')) +
                octet_length(COALESCE(c.cover_image, ''))
              ), 0)
              FROM courses c
              WHERE c.owner_user_id = u.id
            ) +
            (
              SELECT COALESCE(SUM(
                octet_length(COALESCE(m.title, '')) +
                octet_length(COALESCE(m.description, '')) +
                octet_length(COALESCE(m.slug, '')) +
                octet_length(COALESCE(m.builder_data::text, ''))
              ), 0)
              FROM modules m
              JOIN courses c ON c.id = m.course_id
              WHERE c.owner_user_id = u.id
            ) AS storage_used_bytes
     FROM users u
     WHERE u.id = $1 AND u.role = 'professor' AND u.is_active = TRUE`,
    [user.id]
  );
  if (!rows.length) throw new Error('Conta de professor inativa.');
  const limit = Number(rows[0].storage_limit_bytes || 0);
  const used = Number(rows[0].storage_used_bytes || 0);
  if (limit > 0 && used + additionalBytes > limit) {
    throw new Error('O limite de armazenamento da conta foi atingido.');
  }
};

const ensureOwnedClassName = async (client, user, className) => {
  const cleanName = sanitizeText(className || 'Turma A', 120) || 'Turma A';
  const existing = await client.query(
    `SELECT id FROM classes
     WHERE LOWER(name) = LOWER($1)${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
    user.role === 'professor' ? [cleanName, user.id] : [cleanName]
  );
  if (!existing.rows.length) {
    await client.query(
      'INSERT INTO classes (id, name, owner_user_id) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), cleanName, user.role === 'professor' ? user.id : null]
    );
  }
  return cleanName;
};

const dateOnly = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const ensureAssistantPaymentPeriod = async (client, plan) => {
  if (!plan || plan.status !== 'ACTIVE') return null;
  const now = new Date();
  const buildDueDate = (year, month) => new Date(year, month, Math.min(Number(plan.due_day), new Date(year, month + 1, 0).getDate()), 12);
  let dueDate = buildDueDate(now.getFullYear(), now.getMonth());
  const createdAt = plan.created_at ? new Date(plan.created_at) : null;
  if (createdAt && Number.isFinite(createdAt.getTime()) && dueDate < createdAt) {
    dueDate = buildDueDate(now.getFullYear(), now.getMonth() + 1);
  }
  const { rows } = await client.query(
    `INSERT INTO student_payment_periods (plan_id, due_date, amount, status, billing_type)
     VALUES ($1,$2,$3,'PENDING',$4)
     ON CONFLICT (plan_id, due_date) DO UPDATE SET
       amount = CASE WHEN student_payment_periods.status = 'PENDING' THEN EXCLUDED.amount ELSE student_payment_periods.amount END,
       billing_type = CASE WHEN student_payment_periods.status = 'PENDING' THEN EXCLUDED.billing_type ELSE student_payment_periods.billing_type END,
       updated_at = NOW()
     RETURNING *`,
    [plan.id, dateOnly(dueDate), plan.amount, plan.billing_type]
  );
  return rows[0];
};

const executeAction = async (client, user, action) => {
  if (action.type === 'create_student') {
    const duplicate = await client.query('SELECT id FROM users WHERE email = $1', [action.email]);
    if (duplicate.rows.length) throw new Error(`Já existe uma conta com o email ${action.email}.`);
    if (user.role === 'professor') {
      const quota = await client.query(
        `SELECT u.student_limit, COUNT(relation.student_user_id)::int AS student_count
         FROM users u
         LEFT JOIN professor_students relation
           ON relation.professor_user_id = u.id AND relation.active = TRUE
         WHERE u.id = $1 AND u.role = 'professor' AND u.is_active = TRUE
         GROUP BY u.id`,
        [user.id]
      );
      if (!quota.rows.length) throw new Error('Conta de professor inativa.');
      const limit = Number(quota.rows[0].student_limit || 0);
      if (limit > 0 && Number(quota.rows[0].student_count || 0) >= limit) {
        throw new Error(`Limite de alunos atingido (${limit}).`);
      }
    }
    const temporarySecret = crypto.randomBytes(32).toString('base64url');
    const passwordHash = await bcrypt.hash(temporarySecret, 10);
    const className = await ensureOwnedClassName(client, user, action.className);
    const studentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, full_name, email, phone, password_hash, role, class_name, is_active, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, 'student', $6, TRUE, $7)`,
      [studentId, action.fullName, action.email, action.phone || null, passwordHash, className, user.id]
    );
    if (user.role === 'professor') {
      await linkStudentToProfessor(client, {
        professorId: user.id,
        studentId,
        className,
        source: 'assistant-created'
      });
    }
    return 'Aluno criado. Por segurança, nenhuma senha foi exibida; o aluno deve usar "Esqueci minha senha" no primeiro acesso.';
  }

  if (action.type === 'update_student') {
    await assertOwnedStudent(client, user, action.studentId);
    const updates = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (action.fullName) add('full_name', action.fullName);
    if (action.phone) add('phone', action.phone);
    if (action.className) add('class_name', await ensureOwnedClassName(client, user, action.className));
    if (action.isActive !== null) add('is_active', action.isActive);
    values.push(action.studentId);
    const studentIdIndex = values.length;
    if (user.role === 'professor') values.push(user.id);
    const updateResult = await client.query(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${studentIdIndex} AND role = 'student'
       ${user.role === 'professor' ? `AND EXISTS (
         SELECT 1 FROM professor_students relation
          WHERE relation.student_user_id = users.id
            AND relation.professor_user_id = $${values.length}
       )` : ''}`,
      values
    );
    if (!updateResult.rowCount) throw new Error('Aluno não encontrado ou fora da sua conta.');
    return 'Aluno atualizado.';
  }

  if (action.type === 'delete_student') {
    await assertOwnedStudent(client, user, action.studentId);
    if (user.role === 'professor') {
      await client.query(
        `DELETE FROM enrollments enrollment USING courses course
          WHERE enrollment.user_id = $1
            AND enrollment.course_id = course.id
            AND course.owner_user_id = $2`,
        [action.studentId, user.id]
      );
      await client.query(
        'DELETE FROM student_payment_plans WHERE student_user_id = $1 AND professor_user_id = $2',
        [action.studentId, user.id]
      );
      await client.query(
        'DELETE FROM professor_students WHERE student_user_id = $1 AND professor_user_id = $2',
        [action.studentId, user.id]
      );
      return 'Aluno removido deste professor.';
    }
    const deleteResult = await client.query(
      `DELETE FROM users
       WHERE id = $1 AND role = 'student'${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
      user.role === 'professor' ? [action.studentId, user.id] : [action.studentId]
    );
    if (!deleteResult.rowCount) throw new Error('Aluno não encontrado ou fora da sua conta.');
    return 'Aluno excluído.';
  }

  if (action.type === 'update_student_payment_plan') {
    await assertOwnedStudent(client, user, action.studentId);
    const { rows: studentRows } = await client.query(
      `SELECT id, owner_user_id FROM users WHERE id=$1 AND role='student' FOR UPDATE`,
      [action.studentId]
    );
    const professorId = user.role === 'professor' ? user.id : studentRows[0]?.owner_user_id;
    if (!professorId) throw new Error('Este aluno não está vinculado a um professor responsável pela cobrança.');
    const { rows: planRows } = await client.query(
      `SELECT * FROM student_payment_plans WHERE professor_user_id=$1 AND student_user_id=$2 FOR UPDATE`,
      [professorId, action.studentId]
    );
    const current = planRows[0] || null;
    const next = {
      amount: action.amount ?? (current ? Number(current.amount) : null),
      dueDay: action.dueDay ?? (current ? Number(current.due_day) : null),
      billingType: action.billingType ?? current?.billing_type ?? 'MANUAL',
      graceDays: action.graceDays ?? (current ? Number(current.grace_days) : 5),
      autoBlock: action.autoBlock ?? (current ? Boolean(current.auto_block) : true),
      status: action.status ?? current?.status ?? 'ACTIVE',
      description: action.description ?? current?.description ?? 'Mensalidade de aulas',
      instructions: action.instructions ?? current?.payment_instructions ?? null
    };
    if (!Number.isFinite(next.amount) || next.amount <= 0 || !Number.isInteger(next.dueDay)) {
      throw new Error('Para criar uma mensalidade, informe o valor e o dia de vencimento.');
    }
    const changesProviderDefinition = Boolean(current) && (
      Number(current.amount) !== next.amount
      || Number(current.due_day) !== next.dueDay
      || current.billing_type !== next.billingType
      || current.status !== next.status
    );
    if (next.billingType !== 'MANUAL' && (!current?.provider_subscription_id || changesProviderDefinition)) {
      throw new Error('Esta alteração exige recriar ou sincronizar a cobrança no Asaas. Faça essa mudança na área Financeiro dos alunos.');
    }
    const { rows } = await client.query(
      `INSERT INTO student_payment_plans (
         professor_user_id,student_user_id,amount,due_day,billing_type,grace_days,
         auto_block,status,description,payment_instructions
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (professor_user_id,student_user_id) DO UPDATE SET
         amount=EXCLUDED.amount,due_day=EXCLUDED.due_day,billing_type=EXCLUDED.billing_type,
         grace_days=EXCLUDED.grace_days,auto_block=EXCLUDED.auto_block,status=EXCLUDED.status,
         description=EXCLUDED.description,payment_instructions=EXCLUDED.payment_instructions,updated_at=NOW()
       RETURNING *`,
      [professorId, action.studentId, next.amount, next.dueDay, next.billingType, next.graceDays,
        next.autoBlock, next.status, next.description, next.instructions]
    );
    await ensureAssistantPaymentPeriod(client, rows[0]);
    return `Financeiro do aluno atualizado: ${next.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, vencimento no dia ${next.dueDay}.`;
  }

  if (action.type === 'mark_student_payment_paid') {
    await assertOwnedStudent(client, user, action.studentId);
    const params = [action.studentId];
    let ownerClause = '';
    if (user.role === 'professor') {
      params.push(user.id);
      ownerClause = ' AND p.professor_user_id=$2';
    }
    const { rows } = await client.query(
      `SELECT p.* FROM student_payment_plans p WHERE p.student_user_id=$1${ownerClause} FOR UPDATE`,
      params
    );
    if (!rows.length) throw new Error('O aluno ainda não possui mensalidade configurada.');
    const period = await ensureAssistantPaymentPeriod(client, rows[0]);
    if (!period) throw new Error('O plano financeiro está pausado e não possui período atual para pagamento.');
    await client.query(
      `UPDATE student_payment_periods SET status='PAID',paid_at=NOW(),failure_reason=NULL,updated_at=NOW() WHERE id=$1`,
      [period.id]
    );
    return 'Mensalidade atual registrada como paga.';
  }

  if (action.type === 'create_class') {
    const duplicate = await client.query(
      `SELECT id FROM classes WHERE LOWER(name) = LOWER($1)${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
      user.role === 'professor' ? [action.name, user.id] : [action.name]
    );
    if (duplicate.rows.length) return 'A turma já existia.';
    await client.query(
      'INSERT INTO classes (id, name, owner_user_id) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), action.name, user.role === 'professor' ? user.id : null]
    );
    return 'Turma criada.';
  }

  if (action.type === 'delete_class') {
    const result = await client.query(
      `SELECT id, name FROM classes WHERE id = $1${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
      user.role === 'professor' ? [action.classId, user.id] : [action.classId]
    );
    if (!result.rows.length) throw new Error('Turma não encontrada.');
    const usage = await client.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE role = 'student' AND class_name = $1${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
      user.role === 'professor' ? [result.rows[0].name, user.id] : [result.rows[0].name]
    );
    if (Number(usage.rows[0].total) > 0) throw new Error('A turma ainda possui alunos.');
    await client.query('DELETE FROM classes WHERE id = $1', [action.classId]);
    return 'Turma excluída.';
  }

  if (action.type === 'create_course') {
    const courseBytes = Buffer.byteLength(
      `${action.title}${action.description || ''}${action.slug}`,
      'utf8'
    );
    await assertProfessorStorageForText(client, user, courseBytes);
    await client.query(
      `INSERT INTO courses (id, title, description, slug, show_in_store, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), action.title, action.description || '', action.slug, action.showInStore, user.role === 'professor' ? user.id : null]
    );
    return 'Curso criado.';
  }

  if (action.type === 'update_course') {
    await assertOwnedCourse(client, user, action.courseId);
    const currentCourseResult = await client.query(
      'SELECT title, description, slug FROM courses WHERE id = $1',
      [action.courseId]
    );
    const currentCourse = currentCourseResult.rows[0] || {};
    const currentBytes = Buffer.byteLength(
      `${currentCourse.title || ''}${currentCourse.description || ''}${currentCourse.slug || ''}`,
      'utf8'
    );
    const nextBytes = Buffer.byteLength(
      `${action.title || currentCourse.title || ''}${action.description || currentCourse.description || ''}${action.slug || currentCourse.slug || ''}`,
      'utf8'
    );
    await assertProfessorStorageForText(client, user, Math.max(0, nextBytes - currentBytes));
    const updates = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (action.title) add('title', action.title);
    if (action.description) add('description', action.description);
    if (action.slug) add('slug', action.slug);
    if (action.showInStore !== null) add('show_in_store', action.showInStore);
    values.push(action.courseId);
    const courseIdIndex = values.length;
    if (user.role === 'professor') values.push(user.id);
    const updateResult = await client.query(
      `UPDATE courses SET ${updates.join(', ')}
       WHERE id = $${courseIdIndex}${user.role === 'professor' ? ` AND owner_user_id = $${values.length}` : ''}`,
      values
    );
    if (!updateResult.rowCount) throw new Error('Curso não encontrado ou fora da sua conta.');
    return 'Curso atualizado.';
  }

  if (action.type === 'delete_course') {
    await assertOwnedCourse(client, user, action.courseId);
    const deleteResult = await client.query(
      `DELETE FROM courses WHERE id = $1${user.role === 'professor' ? ' AND owner_user_id = $2' : ''}`,
      user.role === 'professor' ? [action.courseId, user.id] : [action.courseId]
    );
    if (!deleteResult.rowCount) throw new Error('Curso não encontrado ou fora da sua conta.');
    return 'Curso excluído.';
  }

  if (['enroll_students', 'remove_enrollments'].includes(action.type)) {
    await assertOwnedCourse(client, user, action.courseId);
    for (const studentId of action.studentIds) {
      await assertOwnedStudent(client, user, studentId);
      if (action.type === 'enroll_students') {
        await client.query(
          `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, updated_at)
           VALUES ($1, $2, 0, '0', 'Módulo 1', 0, NOW())
           ON CONFLICT (user_id, course_id) DO NOTHING`,
          [studentId, action.courseId]
        );
      } else {
        await client.query('DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2', [studentId, action.courseId]);
      }
    }
    return action.type === 'enroll_students' ? 'Matrícula(s) concluída(s).' : 'Matrícula(s) removida(s).';
  }

  if (action.type === 'send_notification') {
    if (action.targetType === 'student') await assertOwnedStudent(client, user, action.targetValue);
    await client.query(
      `INSERT INTO notifications (id, message, target_type, target_value, attachments, created_by, owner_user_id)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6)`,
      [crypto.randomUUID(), action.message, action.targetType, action.targetValue, user.id, user.role === 'professor' ? user.id : null]
    );
    return 'Notificação enviada.';
  }

  if (action.type === 'send_chat_message') {
    await assertOwnedCourse(client, user, action.courseId);
    if (action.replyToMessageId) {
      const parent = await client.query(
        'SELECT id FROM course_messages WHERE id = $1 AND course_id = $2',
        [action.replyToMessageId, action.courseId]
      );
      if (!parent.rows.length) throw new Error('A mensagem original não existe mais.');
    }
    await client.query(
      `INSERT INTO course_messages (id, course_id, user_id, reply_to_message_id, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), action.courseId, user.id, action.replyToMessageId, action.message]
    );
    return 'Mensagem enviada no chat.';
  }

  if (action.type === 'decide_access_request') {
    const request = await client.query(
      `SELECT car.user_id, car.course_id, car.status,
              c.owner_user_id AS professor_user_id,
              professor.role AS professor_role, professor.student_limit,
              relation.active AS professor_link_active
       FROM course_access_requests car
       JOIN courses c ON c.id = car.course_id
       LEFT JOIN users professor ON professor.id = c.owner_user_id
       LEFT JOIN professor_students relation
         ON relation.professor_user_id = c.owner_user_id
        AND relation.student_user_id = car.user_id
       WHERE car.id = $1${user.role === 'professor' ? ' AND c.owner_user_id = $2' : ''}
       FOR UPDATE OF car`,
      user.role === 'professor' ? [action.requestId, user.id] : [action.requestId]
    );
    if (!request.rows.length || request.rows[0].status !== 'pending') throw new Error('Solicitação indisponível.');
    const accessRequest = request.rows[0];
    if (
      action.decision === 'approved'
      && accessRequest.professor_role === 'professor'
      && accessRequest.professor_link_active !== true
    ) {
      const activeStudents = await countProfessorStudents(accessRequest.professor_user_id, client);
      const limit = Number(accessRequest.student_limit || 0);
      if (limit > 0 && activeStudents >= limit) {
        throw new Error(`Limite de alunos atingido (${limit}). Adicione vagas ao plano antes de aprovar.`);
      }
    }
    await client.query('UPDATE course_access_requests SET status = $1, updated_at = NOW() WHERE id = $2', [action.decision, action.requestId]);
    if (action.decision === 'approved') {
      if (accessRequest.professor_user_id) {
        await linkStudentToProfessor(client, {
          professorId: accessRequest.professor_user_id,
          studentId: accessRequest.user_id,
          source: 'course-store-assistant'
        });
      }
      await client.query(
        `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, updated_at)
         VALUES ($1, $2, 0, '0', 'Módulo 1', 0, NOW())
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [accessRequest.user_id, accessRequest.course_id]
      );
    }
    return action.decision === 'approved' ? 'Solicitação aprovada.' : 'Solicitação recusada.';
  }

  if (action.type === 'mark_report_corrected') {
    await assertOwnedStudent(client, user, action.studentId);
    await assertOwnedCourse(client, user, action.courseId);
    const result = await client.query(
      `UPDATE enrollments SET report_corrected_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND course_id = $2`,
      [action.studentId, action.courseId]
    );
    if (!result.rowCount) throw new Error('Relatório não encontrado.');
    return 'Relatório marcado como corrigido.';
  }

  throw new Error('Ação não permitida.');
};

const executeProposal = async ({ proposalId, user }) => {
  await ensureAssistantTables();
  if (!isUuid(proposalId)) {
    const error = new Error('Proposta inválida.');
    error.statusCode = 400;
    throw error;
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE admin_ai_assistant_proposals
       SET status = 'executing'
       WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > NOW()
       RETURNING id, actions`,
      [proposalId, user.id]
    );
    if (!rows.length) {
      const error = new Error('Esta proposta expirou, já foi executada ou não pertence a você.');
      error.statusCode = 409;
      throw error;
    }
    const actions = Array.isArray(rows[0].actions) ? rows[0].actions : [];
    const results = [];
    for (const action of actions) {
      const result = await executeAction(client, user, action);
      results.push({ type: action.type, summary: action.summary, result });
      await client.query(
        `INSERT INTO admin_ai_assistant_audit
           (id, user_id, proposal_id, action_type, action_summary, action_payload, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'success')`,
        [crypto.randomUUID(), user.id, proposalId, action.type, action.summary, JSON.stringify(action)]
      );
    }
    await client.query(
      `UPDATE admin_ai_assistant_proposals SET status = 'executed', executed_at = NOW() WHERE id = $1`,
      [proposalId]
    );
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    await db.query(
      `UPDATE admin_ai_assistant_proposals
       SET status = CASE WHEN status = 'executing' THEN 'failed' ELSE status END
       WHERE id = $1 AND user_id = $2`,
      [proposalId, user.id]
    ).catch(() => {});
    await db.query(
      `INSERT INTO admin_ai_assistant_audit
         (id, user_id, proposal_id, action_type, action_summary, action_payload, status, error_message)
       VALUES ($1, $2, $3, 'proposal', 'Falha ao executar proposta', '{}'::jsonb, 'failed', $4)`,
      [crypto.randomUUID(), user.id, proposalId, sanitizeText(error.message || 'Falha desconhecida', 1000)]
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  cleanHistory,
  containsSensitiveRequest,
  ensureAssistantTables,
  executeProposal,
  loadAssistantContext,
  normalizeAssistantResponse,
  redactSecrets,
  storeProposal,
  __test: {
    actionSummary,
    cleanHistory,
    containsSensitiveRequest,
    executeAction,
    normalizeAction,
    normalizeAssistantResponse,
    redactSecrets,
    summarizeReportModules
  }
};
