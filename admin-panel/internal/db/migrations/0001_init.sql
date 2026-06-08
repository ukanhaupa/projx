CREATE SCHEMA IF NOT EXISTS admin_panel;

CREATE TABLE IF NOT EXISTS admin_panel.admin_users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_panel.admin_sessions (
  token      TEXT PRIMARY KEY,
  admin_id   BIGINT NOT NULL REFERENCES admin_panel.admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
  ON admin_panel.admin_sessions (expires_at);
