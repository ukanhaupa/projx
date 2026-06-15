CREATE TABLE IF NOT EXISTS auth_users (
    id                UUID PRIMARY KEY,
    email             VARCHAR(320) NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    name              VARCHAR(200) NOT NULL DEFAULT '',
    role              VARCHAR(32) NOT NULL DEFAULT 'user',
    mfa_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret        TEXT,
    email_verified_at TIMESTAMPTZ,
    failed_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until      TIMESTAMPTZ,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_users_email_idx ON auth_users (email);
CREATE INDEX IF NOT EXISTS auth_users_deleted_at_idx ON auth_users (deleted_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id                  UUID PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL UNIQUE,
    parent_session_id   UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
    ip_address          VARCHAR(64),
    user_agent          TEXT,
    revoked_at          TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_parent_idx ON auth_sessions (parent_session_id);
CREATE INDEX IF NOT EXISTS auth_sessions_revoked_idx ON auth_sessions (revoked_at);

CREATE TABLE IF NOT EXISTS auth_password_reset_tokens (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_password_reset_user_idx ON auth_password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS auth_email_verify_tokens (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_email_verify_user_idx ON auth_email_verify_tokens (user_id);

CREATE TABLE IF NOT EXISTS auth_recovery_codes (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL UNIQUE,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_recovery_codes_user_idx ON auth_recovery_codes (user_id);
