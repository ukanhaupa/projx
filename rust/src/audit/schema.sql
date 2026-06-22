CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY,
    table_name VARCHAR(255) NOT NULL,
    record_id VARCHAR(255) NOT NULL,
    action VARCHAR(16) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    performed_by VARCHAR(255) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs (table_name);

CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs (record_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
