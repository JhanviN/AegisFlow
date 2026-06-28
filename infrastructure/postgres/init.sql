-- AegisFlow Audit Schema
-- SOC 2 compliant immutable audit trail with cryptographic signatures

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL DEFAULT 'compliance_audit',
    payload_hash VARCHAR(64) NOT NULL,
    structural_signature VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT audit_events_tx_unique UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_idempotency ON audit_events (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_signature ON audit_events (structural_signature);

CREATE TABLE IF NOT EXISTS audit_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_hash VARCHAR(64) NOT NULL,
    event_count INTEGER NOT NULL,
    events JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_batches_created ON audit_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS dlq_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic VARCHAR(128) NOT NULL,
    partition_id INTEGER,
    offset BIGINT,
    error_message TEXT,
    payload JSONB,
    headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_created ON dlq_events (created_at DESC);

-- Materialized view for compliance reporting
CREATE MATERIALIZED VIEW IF NOT EXISTS audit_summary AS
SELECT
    tenant_id,
    DATE_TRUNC('hour', created_at) AS hour_bucket,
    COUNT(*) AS event_count,
    COUNT(DISTINCT idempotency_key) AS unique_transactions
FROM audit_events
GROUP BY tenant_id, DATE_TRUNC('hour', created_at);

CREATE INDEX IF NOT EXISTS idx_audit_summary ON audit_summary (tenant_id, hour_bucket);
