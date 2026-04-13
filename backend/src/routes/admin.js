const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { encryptApiKey } = require('../aiConfigCrypto');
const {
  buildPublicAiSettings,
  proposeNextSlideAction,
  proposeSlideActions,
  testAiConnection,
  generateBackgroundMaskWithNanoBanana
} = require('../aiProvider');
const { readImageSource } = require('../pixian');
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
router.use(requireRole('admin'));
const TEMPLATE_STORE_DIR = path.resolve(__dirname, '../../../template-store');
const TEMPLATE_STORE_KEY_REGEX = /^[a-z0-9._-]+$/i;

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
  adminAiImageColumnsEnsured = true;
};

router.get('/students', async (req, res) => {
  const result = await db.query(
    `SELECT id, full_name, email, phone, role, class_name, is_active, created_at FROM users WHERE role = 'student' ORDER BY full_name`
  );

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

router.post('/students', async (req, res) => {
  const fullName = sanitizeText(req.body?.fullName, 160);
  const email = sanitizeEmail(req.body?.email || '');
  const phone = sanitizePhone(req.body?.phone || '');
  const password = sanitizeText(req.body?.password || '', 256, { trim: false });
  const className = sanitizeText(req.body?.className || 'Turma A', 120);
  const isActive = req.body?.isActive;
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha são obrigatórios' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();
  await db.query(
    `INSERT INTO users (id, full_name, email, phone, password_hash, role, class_name, is_active)
     VALUES ($1, $2, $3, $4, $5, 'student', $6, $7)`,
    [id, fullName, email, phone || null, hashedPassword, className || 'Turma A', isActive !== false]
  );

  res.status(201).json({ id, fullName, email });
});

router.post('/students/:id/enroll', async (req, res) => {
  const { id } = req.params;
  const courseId = sanitizeText(req.body?.courseId || '', 80);
  if (!isUuid(id) || !isUuid(courseId)) {
    return res.status(400).json({ message: 'courseId obrigatório' });
  }
  const { rows: courseRows } = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
  if (!courseRows.length) {
    return res.status(404).json({ message: 'Curso não encontrado' });
  }
  await db.query(
    `INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade, updated_at)
     VALUES ($1, $2, 0, '0', 'Módulo 1', 0, NOW())
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [id, courseId]
  );
  res.status(204).send();
});

router.delete('/students/:id/enrollments/:courseId', async (req, res) => {
  const { id, courseId } = req.params;
  await db.query('DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2', [id, courseId]);
  res.status(204).send();
});

router.put('/students/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno inválido' });
  }
  const fullName = sanitizeText(req.body?.fullName || '', 160);
  const className = sanitizeText(req.body?.className || '', 120);
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
  if (className) {
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
    return res.status(400).json({ message: 'Nenhum campo obrigatório informado' });
  }

  values.push(id);
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.status(204).send();
});

router.put('/students/:id/status', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Aluno inválido' });
  }
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'Informe isActive como booleano' });
  }
  await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [isActive, id]);
  res.status(204).send();
});

router.delete('/students/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: 'Aluno inválido' });
  }
  await db.query('DELETE FROM users WHERE id = $1 AND role = \'student\'', [req.params.id]);
  res.status(204).send();
});

router.get('/reports', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id user_id, u.full_name, u.email, u.phone, u.class_name, c.id course_id, c.title course_title,
            e.video_position, e.interactive_step, e.current_module, e.grade, e.updated_at
     FROM enrollments e
     JOIN users u ON u.id = e.user_id
     JOIN courses c ON c.id = e.course_id
     ORDER BY u.full_name, c.title`
  );
  res.json(rows);
});

router.get('/courses', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.description, c.slug, COALESCE(COUNT(m.id), 0) AS module_count
     FROM courses c
     LEFT JOIN modules m ON m.course_id = c.id
     GROUP BY c.id, c.title, c.description, c.slug
     ORDER BY c.title`
  );
  res.json(rows);
});

router.post('/courses', async (req, res) => {
  const title = sanitizeText(req.body?.title || '', 180);
  const description = sanitizeText(req.body?.description || '', 4000);
  const slug = sanitizeSlug(req.body?.slug || title);
  if (!title || !slug) {
    return res.status(400).json({ message: 'Título e slug são obrigatórios' });
  }
  const id = uuidv4();
  await db.query(
    'INSERT INTO courses (id, title, description, slug) VALUES ($1, $2, $3, $4)',
    [id, title, description || '', slug]
  );
  res.status(201).json({ id, title, description, slug });
});

router.put('/courses/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: 'Curso inválido' });
  }
  const title = sanitizeText(req.body?.title || '', 180);
  const description = sanitizeText(req.body?.description || '', 4000);
  const slug = sanitizeSlug(req.body?.slug || '');
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
  if (!updates.length) {
    return res.status(400).json({ message: 'Informe pelo menos um campo para atualizar' });
  }
  values.push(id);
  await db.query(`UPDATE courses SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.status(204).send();
});

router.delete('/courses/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: 'Curso inválido' });
  }
  await db.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

router.get('/courses/:courseId/modules', async (req, res) => {
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'Curso inválido' });
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
    return res.status(400).json({ message: 'Template inválido' });
  }
  const fileName = `${templateKey}.json`;
  const files = await readTemplateStoreFiles();
  if (!files.includes(fileName)) {
    return res.status(404).json({ message: 'Template não encontrado' });
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
    res.status(500).json({ message: 'Não foi possível carregar o template da loja.' });
  }
});

router.post('/images/remove-background', async (req, res) => {
  await ensureAdminAiImageColumns();
  const src = sanitizeMediaUrl(req.body?.src || '');
  if (!src) {
    return res.status(400).json({ message: 'Informe a imagem para remover o fundo.' });
  }
  try {
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
    res.json(result);
  } catch (error) {
    const message = error?.message || 'Não foi possível remover o fundo da imagem.';
    const statusCode =
      /Configure.*Nano Banana/i.test(message) ? 503 :
      /Falha ao chamar o provedor de imagem/i.test(message) ? 502 :
      /baixar a imagem/i.test(message) ? 400 :
      500;
    res.status(statusCode).json({ message });
  }
});

router.post('/courses/:courseId/modules', async (req, res) => {
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ message: 'Curso inválido' });
  }
  const { cleanTitle, cleanDescription, cleanSlug, cleanBuilderData } = sanitizeModulePayload(req.body || {});
  if (!cleanTitle || !cleanBuilderData || !Array.isArray(cleanBuilderData.slides)) {
    return res.status(400).json({ message: 'Título e conteúdo do módulo são obrigatórios' });
  }
  const { rows: courseRows } = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);
  if (!courseRows.length) {
    return res.status(404).json({ message: 'Curso não encontrado' });
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
  const { courseId, moduleId } = req.params;
  if (!isUuid(courseId) || !isUuid(moduleId)) {
    return res.status(400).json({ message: 'Módulo inválido' });
  }
  const { cleanTitle, cleanDescription, cleanSlug, cleanBuilderData } = sanitizeModulePayload(req.body || {});
  if (!cleanTitle || !cleanBuilderData || !Array.isArray(cleanBuilderData.slides)) {
    return res.status(400).json({ message: 'Título e conteúdo do módulo são obrigatórios' });
  }
  const { rows: moduleRows } = await db.query(
    'SELECT id FROM modules WHERE id = $1 AND course_id = $2',
    [moduleId, courseId]
  );
  if (!moduleRows.length) {
    return res.status(404).json({ message: 'Módulo não encontrado' });
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
  const { courseId, moduleId } = req.params;
  if (!isUuid(courseId) || !isUuid(moduleId)) {
    return res.status(400).json({ message: 'Módulo inválido' });
  }
  const { rows: moduleRows } = await db.query(
    'SELECT id FROM modules WHERE id = $1 AND course_id = $2',
    [moduleId, courseId]
  );
  if (!moduleRows.length) {
    return res.status(404).json({ message: 'Módulo não encontrado' });
  }
  await db.query('DELETE FROM modules WHERE id = $1 AND course_id = $2', [moduleId, courseId]);
  res.status(204).send();
});

router.get('/notifications', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, message, target_type, target_value, created_by, created_at FROM notifications ORDER BY created_at DESC LIMIT 50`
  );
  res.json(rows);
});

router.post('/notifications', async (req, res) => {
  const message = sanitizeNotificationMessage(req.body?.message || '');
  const targetType = sanitizeText(req.body?.targetType || '', 20);
  const targetValue = sanitizeText(req.body?.targetValue || '', 120);
  if (!message) {
    return res.status(400).json({ message: 'Mensagem obrigatória' });
  }
  if (!['student', 'class', 'all'].includes(targetType)) {
    return res.status(400).json({ message: 'targetType deve ser student, class ou all' });
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO notifications (id, message, target_type, target_value, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, message, targetType, targetValue || null, req.user.id]
  );
  res.status(201).json({ id });
});

router.delete('/notifications/:notificationId', async (req, res) => {
  const { notificationId } = req.params;
  if (!isUuid(notificationId)) {
    return res.status(400).json({ message: 'Notificação inválida' });
  }
  const { rowCount } = await db.query('DELETE FROM notifications WHERE id = $1', [notificationId]);
  if (!rowCount) {
    return res.status(404).json({ message: 'Notificação não encontrada' });
  }
  res.status(204).send();
});

router.get('/ai-settings', async (req, res) => {
  await ensureAdminAiImageColumns();
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  res.json(buildPublicAiSettings(rows[0]));
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
    imageEnabled
  } = req.body || {};
  if (!baseUrl || !model) {
    return res.status(400).json({ message: 'baseUrl e model são obrigatórios.' });
  }
  if (!imageBaseUrl || !imageModel) {
    return res.status(400).json({ message: 'imageBaseUrl e imageModel são obrigatórios.' });
  }

  const cleanBaseUrl = sanitizeMediaUrl(baseUrl, { allowData: false }).replace(/\/+$/, '');
  const cleanModel = String(model).trim();
  const cleanProviderKey = String(providerKey || 'custom-compatible').trim() || 'custom-compatible';
  const cleanProviderLabel = String(providerLabel || 'Provedor compatível').trim() || 'Provedor compatível';
  const cleanImageBaseUrl = sanitizeMediaUrl(imageBaseUrl, { allowData: false }).replace(/\/+$/, '');
  const cleanImageModel = String(imageModel || 'gemini-2.5-flash-image').trim() || 'gemini-2.5-flash-image';
  const cleanImageProviderKey = String(imageProviderKey || 'google-gemini-image').trim() || 'google-gemini-image';
  const cleanImageProviderLabel = String(imageProviderLabel || 'Nano Banana').trim() || 'Nano Banana';

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
    return res.status(400).json({ message: 'Informe uma API key para salvar a integração.' });
  }
  if (!encryptedImageApiKey) {
    return res.status(400).json({ message: 'Informe a API key da Nano Banana para salvar a integração.' });
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

  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  res.json(buildPublicAiSettings(rows[0]));
});

router.post('/ai-settings/test', async (req, res) => {
  await ensureAdminAiImageColumns();
  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'Configure e ative a integração antes de testar.' });
  }
  try {
    const reply = await testAiConnection(settingsRow);
    res.json({ ok: true, reply });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Não foi possível validar a integração.' });
  }
});

router.post('/ai/slide-actions', async (req, res) => {
  await ensureAdminAiImageColumns();
  const request = sanitizeText(req.body?.request || '', 1800, { trim: true });
  const slides = sanitizeBuilderData({ slides: Array.isArray(req.body?.slides) ? req.body.slides : [] }).slides || [];
  const activeSlideId = sanitizeText(req.body?.activeSlideId || '', 120);
  const stageSize = req.body?.stageSize && typeof req.body.stageSize === 'object' ? req.body.stageSize : null;
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que a IA deve fazer.' });
  }

  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integração de IA deste admin não está configurada ou ativa.' });
  }

  try {
    const actions = await proposeSlideActions({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      stageSize: stageSize || null,
      attachments: Array.isArray(attachments) ? attachments : []
    });
    res.json({
      actions,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'A IA não conseguiu propor ações válidas.' });
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
  if (!request) {
    return res.status(400).json({ message: 'Descreva o que a IA deve fazer.' });
  }

  const { rows } = await db.query(`${ADMIN_AI_SETTINGS_SELECT} WHERE admin_user_id = $1`, [req.user.id]);
  const settingsRow = rows[0];
  if (!settingsRow?.is_enabled) {
    return res.status(400).json({ message: 'A integração de IA deste admin não está configurada ou ativa.' });
  }

  try {
    const result = await proposeNextSlideAction({
      settingsRow,
      request,
      slides,
      activeSlideId: activeSlideId || null,
      stageSize: stageSize || null,
      stepIndex,
      reviewMode,
      recentActions,
      attachments
    });
    res.json({
      ...result,
      requireConfirmation: settingsRow.require_confirmation !== false,
      providerLabel: settingsRow.provider_label
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'A IA não conseguiu gerar a próxima ação.' });
  }
});

module.exports = router;
