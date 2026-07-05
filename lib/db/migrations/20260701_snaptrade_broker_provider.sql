-- Adds SnapTrade as a first-class broker connection provider.
-- This is required before persisting SnapTrade-backed broker_connections rows.

ALTER TYPE broker_provider ADD VALUE IF NOT EXISTS 'snaptrade';
