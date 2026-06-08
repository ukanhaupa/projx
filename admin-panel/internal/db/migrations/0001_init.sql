CREATE SCHEMA IF NOT EXISTS admin_panel;

CREATE TABLE IF NOT EXISTS admin_panel.admin_users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'read_only'
                CHECK (role IN ('read_only', 'read_write')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_panel.admin_sessions (
  token            TEXT PRIMARY KEY,
  admin_id         BIGINT NOT NULL REFERENCES admin_panel.admin_users(id) ON DELETE CASCADE,
  expires_at       TIMESTAMPTZ NOT NULL,
  write_mode_until TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
  ON admin_panel.admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_panel.write_audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  performed_by BIGINT NOT NULL REFERENCES admin_panel.admin_users(id) ON DELETE RESTRICT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  table_schema TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  record_id    TEXT,
  action       TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_value    JSONB,
  new_value    JSONB,
  prev_hash    TEXT,
  row_hash     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS write_audit_log_table_idx
  ON admin_panel.write_audit_log (table_schema, table_name);
CREATE INDEX IF NOT EXISTS write_audit_log_record_idx
  ON admin_panel.write_audit_log (record_id);
CREATE INDEX IF NOT EXISTS write_audit_log_by_actor_idx
  ON admin_panel.write_audit_log (performed_by, performed_at DESC);
