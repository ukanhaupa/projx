ALTER TABLE admin_panel.admin_users
  ADD COLUMN IF NOT EXISTS totp_secret_enc      TEXT,
  ADD COLUMN IF NOT EXISTS totp_enrolled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_failed_attempts  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfa_locked_until     TIMESTAMPTZ;

ALTER TABLE admin_panel.admin_sessions
  ADD COLUMN IF NOT EXISTS mfa_passed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS admin_panel.admin_recovery_codes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   BIGINT NOT NULL REFERENCES admin_panel.admin_users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_recovery_codes_admin_idx
  ON admin_panel.admin_recovery_codes (admin_id) WHERE used_at IS NULL;
