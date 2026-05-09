-- Agent proposal system, API tokens, audit log, and basis provenance.
-- Safe to apply to existing databases; uses IF NOT EXISTS for additive changes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_address text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS basis_source text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS basis_evidence_url text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS basis_set_by text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS basis_set_at timestamp;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS basis_notes text;

ALTER TABLE tax_lots ADD COLUMN IF NOT EXISTS basis_source text;
ALTER TABLE tax_lots ADD COLUMN IF NOT EXISTS basis_evidence_url text;
ALTER TABLE tax_lots ADD COLUMN IF NOT EXISTS basis_set_by text;
ALTER TABLE tax_lots ADD COLUMN IF NOT EXISTS basis_set_at timestamp;
ALTER TABLE tax_lots ADD COLUMN IF NOT EXISTS basis_notes text;

CREATE TABLE IF NOT EXISTS dismissed_wallets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  address text NOT NULL,
  reason text,
  created_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dismissed_wallets_user_address_idx
  ON dismissed_wallets (user_id, lower(address));

CREATE TABLE IF NOT EXISTS proposals (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  actor text NOT NULL,
  actor_type text NOT NULL DEFAULT 'agent',
  action text NOT NULL,
  target_type text NOT NULL,
  target_id varchar,
  payload jsonb NOT NULL,
  reasoning text,
  evidence_url text,
  confidence numeric(5, 4),
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text,
  error_message text,
  created_at timestamp DEFAULT now(),
  decided_at timestamp,
  decided_by text,
  applied_at timestamp
);

CREATE INDEX IF NOT EXISTS proposals_user_status_created_idx
  ON proposals (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS proposals_user_idempotency_key_idx
  ON proposals (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id varchar,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
  ON audit_log (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_approve boolean DEFAULT false,
  auto_approve_threshold numeric(5, 4),
  last_used_at timestamp,
  expires_at timestamp,
  revoked_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_tokens_user_created_idx
  ON api_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS api_tokens_hash_active_idx
  ON api_tokens (token_hash)
  WHERE revoked_at IS NULL;
