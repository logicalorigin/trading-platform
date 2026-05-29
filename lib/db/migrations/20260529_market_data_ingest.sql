-- Durable market-data ingest schema for the Rust worker.
-- This migration is intentionally idempotent so it can bootstrap the market-data
-- slice in a fresh database or verify an existing Drizzle-pushed schema.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'asset_class') then
    create type asset_class as enum ('equity', 'option');
  end if;
  if not exists (select 1 from pg_type where typname = 'option_right') then
    create type option_right as enum ('call', 'put');
  end if;
end
$$;

create table if not exists instruments (
  id uuid primary key default gen_random_uuid(),
  symbol varchar(64) not null,
  asset_class asset_class not null,
  name text,
  exchange varchar(32),
  currency varchar(16) not null default 'USD',
  underlying_symbol varchar(64),
  is_active boolean not null default true,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists instruments_symbol_idx on instruments (symbol);
create index if not exists instruments_asset_class_idx on instruments (asset_class);
create index if not exists instruments_underlying_symbol_idx on instruments (underlying_symbol);

create table if not exists option_contracts (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id),
  underlying_instrument_id uuid not null references instruments(id),
  polygon_ticker varchar(64) not null,
  provider_contract_id varchar(128),
  expiration_date date not null,
  strike numeric(18, 6) not null,
  "right" option_right not null,
  multiplier integer not null default 100,
  shares_per_contract integer not null default 100,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists option_contracts_polygon_ticker_idx on option_contracts (polygon_ticker);
create unique index if not exists option_contracts_provider_contract_id_idx on option_contracts (provider_contract_id);
create index if not exists option_contracts_underlying_idx on option_contracts (underlying_instrument_id);
create index if not exists option_contracts_expiration_idx on option_contracts (expiration_date);

create table if not exists quote_cache (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id),
  symbol varchar(64) not null,
  bid numeric(18, 6),
  ask numeric(18, 6),
  last numeric(18, 6),
  bid_size integer,
  ask_size integer,
  last_size integer,
  change numeric(18, 6),
  change_percent numeric(18, 6),
  source varchar(32) not null default 'polygon',
  as_of timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists quote_cache_instrument_idx on quote_cache (instrument_id);
create index if not exists quote_cache_symbol_idx on quote_cache (symbol);
create index if not exists quote_cache_as_of_idx on quote_cache (as_of);

create table if not exists bar_cache (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id),
  symbol varchar(64) not null,
  timeframe varchar(16) not null,
  starts_at timestamp with time zone not null,
  open numeric(18, 6) not null,
  high numeric(18, 6) not null,
  low numeric(18, 6) not null,
  close numeric(18, 6) not null,
  volume numeric(20, 4) not null,
  source varchar(32) not null default 'polygon',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists bar_cache_instrument_timeframe_source_starts_at_idx
  on bar_cache (instrument_id, timeframe, source, starts_at);
create index if not exists bar_cache_instrument_idx on bar_cache (instrument_id);
create index if not exists bar_cache_symbol_timeframe_idx on bar_cache (symbol, timeframe);
create index if not exists bar_cache_starts_at_idx on bar_cache (starts_at);

create table if not exists option_chain_snapshots (
  id uuid primary key default gen_random_uuid(),
  underlying_instrument_id uuid not null references instruments(id),
  option_contract_id uuid not null references option_contracts(id),
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
  source text not null default 'polygon',
  as_of timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists option_chain_snapshots_underlying_idx on option_chain_snapshots (underlying_instrument_id);
create index if not exists option_chain_snapshots_contract_idx on option_chain_snapshots (option_contract_id);
create index if not exists option_chain_snapshots_as_of_idx on option_chain_snapshots (as_of);

create table if not exists market_data_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  kind varchar(48) not null,
  symbol varchar(64) not null,
  timeframe varchar(16),
  window_start timestamp with time zone,
  window_end timestamp with time zone,
  priority integer not null default 5,
  status varchar(32) not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner varchar(128),
  lease_expires_at timestamp with time zone,
  last_heartbeat_at timestamp with time zone,
  next_run_at timestamp with time zone,
  dedupe_key varchar(256) not null,
  payload jsonb,
  last_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists market_data_ingest_jobs_dedupe_key_idx on market_data_ingest_jobs (dedupe_key);
create index if not exists market_data_ingest_jobs_status_priority_idx
  on market_data_ingest_jobs (status, priority, next_run_at, created_at);
create index if not exists market_data_ingest_jobs_symbol_kind_idx on market_data_ingest_jobs (symbol, kind);
create index if not exists market_data_ingest_jobs_lease_expires_idx on market_data_ingest_jobs (lease_expires_at);

create table if not exists provider_request_log (
  id uuid primary key default gen_random_uuid(),
  provider varchar(32) not null,
  endpoint_family varchar(64) not null,
  symbol varchar(64),
  request_key varchar(256),
  window_start timestamp with time zone,
  window_end timestamp with time zone,
  status varchar(32) not null,
  http_status integer,
  duration_ms integer,
  row_count integer,
  page_count integer,
  retry_count integer not null default 0,
  rate_limit_reset_at timestamp with time zone,
  error_code varchar(96),
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists provider_request_log_provider_created_idx on provider_request_log (provider, created_at);
create index if not exists provider_request_log_family_created_idx on provider_request_log (endpoint_family, created_at);
create index if not exists provider_request_log_symbol_created_idx on provider_request_log (symbol, created_at);

create table if not exists gex_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol varchar(64) not null,
  computed_at timestamp with time zone not null,
  spot numeric(18, 6) not null,
  net_gex numeric(24, 6) not null,
  option_count integer not null default 0,
  usable_option_count integer not null default 0,
  source_status varchar(32) not null default 'ok',
  source_message text,
  payload jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists gex_snapshots_symbol_computed_at_idx on gex_snapshots (symbol, computed_at);
create index if not exists gex_snapshots_symbol_latest_idx on gex_snapshots (symbol, computed_at);

create table if not exists flow_summaries (
  id uuid primary key default gen_random_uuid(),
  symbol varchar(64) not null,
  window_start timestamp with time zone not null,
  window_end timestamp with time zone not null,
  event_count integer not null default 0,
  bullish_premium numeric(24, 6) not null default 0,
  bearish_premium numeric(24, 6) not null default 0,
  neutral_premium numeric(24, 6) not null default 0,
  net_delta numeric(24, 6) not null default 0,
  source_status varchar(32) not null default 'ok',
  payload jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists flow_summaries_symbol_window_idx
  on flow_summaries (symbol, window_start, window_end);
create index if not exists flow_summaries_symbol_latest_idx on flow_summaries (symbol, window_end);
