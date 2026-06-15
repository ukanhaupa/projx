CREATE TABLE IF NOT EXISTS service_configs (
    id          UUID PRIMARY KEY,
    purpose     VARCHAR(64) NOT NULL UNIQUE,
    config      TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
    id          UUID PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    published   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS posts_deleted_at_idx ON posts (deleted_at);
