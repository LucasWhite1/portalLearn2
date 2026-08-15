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
  billing_access_managed BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_access_expires_at TIMESTAMPTZ,
  subscription_plan_code TEXT,
  subscription_billing_type TEXT,
  subscription_payment_status TEXT,
  subscription_last_event_type TEXT,
  subscription_payment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_signup_links (
  professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_amount NUMERIC(12,2),
  due_day INT NOT NULL DEFAULT 10,
  billing_type TEXT NOT NULL DEFAULT 'PIX',
  grace_days INT NOT NULL DEFAULT 5,
  auto_block BOOLEAN NOT NULL DEFAULT TRUE,
  payment_description TEXT,
  payment_instructions TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_signup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  auto_approval_requested BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_amount NUMERIC(12,2),
  due_day INT NOT NULL DEFAULT 10,
  billing_type TEXT NOT NULL DEFAULT 'PIX',
  grace_days INT NOT NULL DEFAULT 5,
  auto_block BOOLEAN NOT NULL DEFAULT TRUE,
  payment_description TEXT,
  payment_instructions TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_signup_requests_professor
ON student_signup_requests(professor_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS professor_students (
  professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'legacy',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (professor_user_id, student_user_id)
);

CREATE INDEX IF NOT EXISTS idx_professor_students_student
ON professor_students(student_user_id, active, professor_user_id);

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

CREATE TABLE IF NOT EXISTS student_seat_upgrade_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  amount_brl NUMERIC(12,2) NOT NULL,
  previous_student_limit INT NOT NULL,
  target_student_limit INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELED','REFUNDED','CHARGEBACK')),
  external_reference TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT,
  provider_payment_id TEXT,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_seat_upgrade_orders_user
ON student_seat_upgrade_orders(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS professor_payment_settings (
  professor_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK (provider_mode IN ('MANUAL', 'ASAAS')),
  provider_api_key_encrypted TEXT,
  provider_account_id TEXT,
  provider_wallet_id TEXT,
  provider_account_name TEXT,
  provider_status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  webhook_token_hash TEXT,
  onboarding_data JSONB,
  onboarding_checked_at TIMESTAMPTZ,
  subaccount_consent_version TEXT,
  subaccount_consented_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE professor_payment_settings
  ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_data JSONB,
  ADD COLUMN IF NOT EXISTS onboarding_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subaccount_consent_version TEXT,
  ADD COLUMN IF NOT EXISTS subaccount_consented_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS student_payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  billing_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (billing_type IN ('MANUAL','PIX','BOLETO','CREDIT_CARD')),
  grace_days INT NOT NULL DEFAULT 5 CHECK (grace_days BETWEEN 0 AND 60),
  auto_block BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  description TEXT,
  payment_instructions TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (professor_user_id, student_user_id)
);

CREATE TABLE IF NOT EXISTS student_payment_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES student_payment_plans(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','OVERDUE','FAILED','CANCELED','REFUNDED','CHARGEBACK')),
  billing_type TEXT NOT NULL CHECK (billing_type IN ('MANUAL','PIX','BOLETO','CREDIT_CARD')),
  provider_payment_id TEXT UNIQUE,
  payment_url TEXT,
  failure_reason TEXT,
  paid_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_student_payment_plans_professor
ON student_payment_plans(professor_user_id, status, due_day);

CREATE INDEX IF NOT EXISTS idx_student_payment_periods_plan
ON student_payment_periods(plan_id, due_date DESC);

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
