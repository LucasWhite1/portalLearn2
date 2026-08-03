CREATE EXTENSION IF NOT EXISTS "pgcrypto";
SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'admin', 'professor')),
  class_name TEXT,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  platform_credits NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_credits_updated_at TIMESTAMPTZ DEFAULT NOW(),
  student_limit INT,
  storage_limit_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE NOT NULL,
  cover_image TEXT NOT NULL DEFAULT '',
  show_in_store BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, course_id)
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
  current_module TEXT DEFAULT 'Modulo 1',
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
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS classes_owner_name_unique
ON classes (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

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

CREATE TABLE IF NOT EXISTS platform_credit_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  text_cost NUMERIC(12,2) NOT NULL DEFAULT 0.5 CHECK (text_cost > 0),
  image_cost NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (image_cost > 0),
  three_d_import_cost NUMERIC(12,2) NOT NULL DEFAULT 5 CHECK (three_d_import_cost > 0),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_credit_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_credit_ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
  balance_after NUMERIC(12,2) NOT NULL,
  operation_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_credit_ledger_user
ON platform_credit_ledger(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_platform_credit_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'platform_credit_ledger is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_credit_ledger_immutable ON platform_credit_ledger;
CREATE TRIGGER platform_credit_ledger_immutable
  BEFORE UPDATE OR DELETE ON platform_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_platform_credit_ledger_mutation();

CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price_brl NUMERIC(12,2) NOT NULL CHECK (price_brl >= 30),
  credits NUMERIC(12,2) NOT NULL CHECK (credits > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO credit_packages (id, name, price_brl, credits, is_active, sort_order)
SELECT '00000000-0000-4000-8000-000000000100'::uuid, '100 créditos', 30, 100, TRUE, 10
WHERE NOT EXISTS (SELECT 1 FROM credit_packages);

CREATE TABLE IF NOT EXISTS credit_topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  package_id UUID REFERENCES credit_packages(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,
  amount_brl NUMERIC(12,2) NOT NULL CHECK (amount_brl >= 30),
  credits NUMERIC(12,2) NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELED','REFUNDED','CHARGEBACK')),
  external_reference TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT,
  provider_payment_id TEXT UNIQUE,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_topup_orders_user
ON credit_topup_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS student_face_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding_ciphertext BYTEA NOT NULL,
  embedding_iv BYTEA NOT NULL,
  embedding_tag BYTEA NOT NULL,
  model_version TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'reenrollment_required')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS face_verification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('enrollment', 'entry', 'periodic', 'completion')),
  challenge JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'verified', 'failed', 'review_required', 'expired')),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  failure_code TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_sessions_user
ON face_verification_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS face_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('entry', 'periodic', 'completion', 'manual')),
  source_session_id UUID REFERENCES face_verification_sessions(id) ON DELETE SET NULL,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_grants_lookup
ON face_access_grants(user_id, module_id, purpose, expires_at DESC);

CREATE TABLE IF NOT EXISTS face_review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES face_verification_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  audit_image_ciphertext BYTEA,
  audit_image_iv BYTEA,
  audit_image_tag BYTEA,
  audit_image_mime TEXT,
  audit_image_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved_once', 'attempts_reset', 'reenrollment_required', 'denied')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_reviews_owner
ON face_review_requests(owner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS biometric_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  student_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create the first administrator through a one-time deployment procedure.
-- Production credentials must never be embedded in a migration.
