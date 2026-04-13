CREATE EXTENSION IF NOT EXISTS "pgcrypto";
SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'admin')),
  class_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  builder_data JSONB NOT NULL,
  position INT DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (course_id, slug)
 );

CREATE TABLE IF NOT EXISTS enrollments (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  video_position NUMERIC DEFAULT 0,
  interactive_step TEXT DEFAULT '0',
  current_module TEXT DEFAULT 'Módulo 1',
  grade NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('student', 'class', 'all')),
  target_value TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_ai_settings (
  admin_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL DEFAULT 'deepseek',
  provider_label TEXT NOT NULL DEFAULT 'DeepSeek',
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  system_prompt TEXT,
  require_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  image_provider_key TEXT NOT NULL DEFAULT 'google-gemini-image',
  image_provider_label TEXT NOT NULL DEFAULT 'Nano Banana',
  image_base_url TEXT NOT NULL DEFAULT 'https://generativelanguage.googleapis.com/v1beta',
  image_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-image',
  image_encrypted_api_key TEXT,
  image_is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

WITH admin AS (
  INSERT INTO users (full_name, email, phone, password_hash, role, class_name)
  VALUES (
    'Admin do Curso',
    'admin@curso.com',
    '+55 11 0000-0000',
    crypt('AdminPass2026!', gen_salt('bf')),
    'admin',
    'Administração'
  )
  RETURNING id
)
INSERT INTO notifications (message, target_type, target_value, created_by)
VALUES ('Bem-vindo ao portal do curso. Confira todas as aulas disponíveis na aba Conteúdos.', 'all', NULL, (SELECT id FROM admin));

INSERT INTO courses (title, description, slug)
VALUES
  ('Fundamentos da Experiência', 'Uma trilha guiada com vídeos e quizzes interativos para dominar as práticas essenciais.', 'fundamentos-da-experiencia'),
  ('Laboratório de Projetos', 'Simule situações reais com atividades interativas e protótipos.', 'laboratorio-de-projetos');

INSERT INTO users (full_name, email, phone, password_hash, role, class_name)
VALUES (
  'Aluno Exemplo',
  'aluno@curso.com',
  '+55 11 99999-0000',
  crypt('AlunoLeva10!', gen_salt('bf')),
  'student',
  'Turma Master'
);

WITH student AS (
  SELECT id FROM users WHERE email = 'aluno@curso.com'
),
course_ids AS (
  SELECT id FROM courses ORDER BY title
)
INSERT INTO enrollments (user_id, course_id, video_position, interactive_step, current_module, grade)
SELECT (SELECT id FROM student), id, 120, '3.2', 'Módulo 02 · Laboratório', 88
FROM course_ids
LIMIT 1;

WITH admin_id AS (
  SELECT id FROM users WHERE email = 'admin@curso.com'
)
INSERT INTO notifications (message, target_type, target_value, created_by)
SELECT message, target_type, target_value, admin_id.id
FROM admin_id,
LATERAL (
  VALUES
    ('Não esqueça de atualizar sua planilha de atividades até sexta.', 'class', 'Turma Master'),
    ('Turma Master: nova aula prática liberada no laboratório de projetos.', 'class', 'Turma Master')
) AS msgs(message, target_type, target_value);
