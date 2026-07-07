-- Slice 9: per-user audit event ledger.
-- Additive append-only table for security/product lifecycle events. Payloads are
-- intentionally capped to avoid repeating the high-volume jsonb bloat pattern
-- called out in docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md.

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES users(id),
  event_type varchar(96) NOT NULL,
  subject_type varchar(64),
  subject_id text,
  resource_type varchar(64),
  resource_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_payload_object_chk CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT audit_events_payload_size_chk CHECK (octet_length(payload::text) <= 8192)
);

CREATE INDEX IF NOT EXISTS audit_events_app_user_created_at_idx
  ON audit_events (app_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_event_type_created_at_idx
  ON audit_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_subject_idx
  ON audit_events (subject_type, subject_id);

CREATE INDEX IF NOT EXISTS audit_events_resource_idx
  ON audit_events (resource_type, resource_id);
