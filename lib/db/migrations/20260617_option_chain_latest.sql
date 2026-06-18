-- ============================================================
-- 20260617_option_chain_latest.sql
--
-- Additive, reversible: create the upsert "latest-per-(contract,source)" table
-- that replaces the append-only option_chain_snapshots firehose (18-45s batch
-- writes that pin a backend on the shared 12-connection helium Postgres and
-- starve the Node app). option_chain_snapshots is LEFT FULLY INTACT for
-- rollback; this file performs NO destructive statements.
--
-- NO foreign keys: this is a derived cache (the worker writes
-- instruments -> option_contracts -> latest in order, so parents always exist),
-- and inline `references` would take a blocking ShareRowExclusiveLock on the
-- hot instruments/option_contracts tables — which would worsen the very
-- contention this redesign fixes. Integrity is maintained by the ingest order.
--
-- Upsert key = (option_contract_id, source), NOT contract alone: four source
-- families (massive / ibkr-* / signal-options:* / signal-options:decision:*)
-- write the same contract; GEX reads source='massive' only, so a contract-only
-- key would let a non-massive write clobber the massive row and corrupt GEX.
--
-- drizzle-kit push is disabled on the shared dev DB (2026-06-15 data-loss
-- incident) — apply this MANUALLY. gen_random_uuid() comes from pgcrypto,
-- already created in 20260529_market_data_ingest.sql.
-- ============================================================

create table if not exists option_chain_latest (
  id uuid primary key default gen_random_uuid(),
  underlying_instrument_id uuid not null,
  option_contract_id uuid not null,
  bid numeric(18, 6),
  ask numeric(18, 6),
  last numeric(18, 6),
  mark numeric(18, 6),
  implied_volatility numeric(18, 6),
  delta numeric(18, 6),
  gamma numeric(18, 6),
  theta numeric(18, 6),
  vega numeric(18, 6),
  open_interest integer,
  volume integer,
  source text not null default 'massive',
  as_of timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Upsert conflict target: one row per (contract, source).
create unique index if not exists option_chain_latest_contract_source_key
  on option_chain_latest (option_contract_id, source);

-- GEX reader: join on underlying_instrument_id, then filter source='massive'.
create index if not exists option_chain_latest_underlying_idx
  on option_chain_latest (underlying_instrument_id);

analyze option_chain_latest;
