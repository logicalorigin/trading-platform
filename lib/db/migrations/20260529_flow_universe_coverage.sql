-- Durable universe coverage and scanner-selection dependencies.
-- Idempotent by design so fresh databases can bootstrap the option-flow
-- universe without relying on an ad hoc Drizzle push.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'asset_class') then
    create type asset_class as enum ('equity', 'option');
  end if;
  if not exists (select 1 from pg_type where typname = 'universe_market') then
    create type universe_market as enum (
      'stocks',
      'etf',
      'indices',
      'futures',
      'fx',
      'crypto',
      'otc'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'universe_hydration_status') then
    create type universe_hydration_status as enum (
      'pending',
      'hydrated',
      'not_found',
      'ambiguous',
      'failed'
    );
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

create table if not exists universe_catalog_listings (
  id uuid primary key default gen_random_uuid(),
  listing_key varchar(160) not null,
  market universe_market not null,
  ticker varchar(64) not null,
  normalized_ticker varchar(64) not null,
  root_symbol varchar(64),
  name text not null,
  normalized_name text not null,
  normalized_exchange_mic varchar(32),
  exchange_display varchar(64),
  locale varchar(32),
  type varchar(32),
  active boolean not null default true,
  primary_exchange varchar(64),
  currency_name varchar(64),
  cik varchar(32),
  composite_figi varchar(64),
  share_class_figi varchar(64),
  provider_contract_id varchar(128),
  providers text[] not null default '{}',
  trade_provider varchar(32),
  data_provider_preference varchar(32),
  ibkr_hydration_status universe_hydration_status not null default 'pending',
  ibkr_hydration_attempted_at timestamp with time zone,
  ibkr_hydrated_at timestamp with time zone,
  ibkr_hydration_error text,
  contract_description text,
  contract_meta jsonb,
  last_updated_at timestamp with time zone,
  last_seen_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists universe_catalog_listing_key_idx on universe_catalog_listings (listing_key);
create index if not exists universe_catalog_market_idx on universe_catalog_listings (market);
create index if not exists universe_catalog_ticker_idx on universe_catalog_listings (normalized_ticker);
create index if not exists universe_catalog_root_idx on universe_catalog_listings (root_symbol);
create index if not exists universe_catalog_name_idx on universe_catalog_listings (normalized_name);
create index if not exists universe_catalog_provider_contract_idx on universe_catalog_listings (provider_contract_id);
create index if not exists universe_catalog_figi_idx on universe_catalog_listings (composite_figi);
create index if not exists universe_catalog_share_class_figi_idx on universe_catalog_listings (share_class_figi);
create index if not exists universe_catalog_cik_idx on universe_catalog_listings (cik);
create index if not exists universe_catalog_hydration_idx on universe_catalog_listings (market, active, ibkr_hydration_status);

create table if not exists universe_catalog_sync_states (
  id uuid primary key default gen_random_uuid(),
  scope_key varchar(160) not null,
  phase varchar(32) not null,
  market universe_market not null,
  active_only boolean not null default true,
  cursor text,
  last_processed_listing_key varchar(160),
  pages_synced integer not null default 0,
  rows_synced integer not null default 0,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_error text,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists universe_catalog_sync_scope_idx on universe_catalog_sync_states (scope_key);
create index if not exists universe_catalog_sync_phase_idx on universe_catalog_sync_states (phase, market, active_only);

create table if not exists universe_source_memberships (
  id uuid primary key default gen_random_uuid(),
  source_id varchar(64) not null,
  source_symbol varchar(64) not null,
  normalized_ticker varchar(64) not null,
  listing_key varchar(160),
  market universe_market not null,
  active boolean not null default true,
  first_seen_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  last_missing_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists universe_source_membership_source_symbol_idx
  on universe_source_memberships (source_id, source_symbol);
create index if not exists universe_source_membership_source_idx on universe_source_memberships (source_id);
create index if not exists universe_source_membership_ticker_idx on universe_source_memberships (normalized_ticker);
create index if not exists universe_source_membership_listing_key_idx on universe_source_memberships (listing_key);
create index if not exists universe_source_membership_market_idx on universe_source_memberships (market);
create index if not exists universe_source_membership_active_idx on universe_source_memberships (active);

create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlists(id),
  instrument_id uuid not null references instruments(id),
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists watchlist_items_watchlist_idx on watchlist_items (watchlist_id);
create unique index if not exists watchlist_items_unique_item_idx on watchlist_items (watchlist_id, instrument_id);

create table if not exists flow_universe_rankings (
  id uuid primary key default gen_random_uuid(),
  symbol varchar(64) not null,
  market varchar(32) not null,
  price numeric(18, 6),
  volume numeric(20, 2),
  dollar_volume numeric(24, 2),
  market_cap numeric(24, 2),
  liquidity_rank integer,
  flow_score numeric(20, 6) not null default 0,
  previous_session_flow_score numeric(20, 6) not null default 0,
  eligible boolean not null default false,
  reason varchar(160),
  source varchar(32) not null default 'ibkr',
  selected boolean not null default false,
  selected_at timestamp with time zone,
  last_scanned_at timestamp with time zone,
  last_flow_at timestamp with time zone,
  cooldown_until timestamp with time zone,
  failure_count integer not null default 0,
  ranked_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists flow_universe_rankings_symbol_idx on flow_universe_rankings (symbol);
create index if not exists flow_universe_rankings_selected_idx on flow_universe_rankings (selected);
create index if not exists flow_universe_rankings_eligible_idx on flow_universe_rankings (eligible);
create index if not exists flow_universe_rankings_rank_idx on flow_universe_rankings (liquidity_rank);
create index if not exists flow_universe_rankings_flow_score_idx on flow_universe_rankings (flow_score);
create index if not exists flow_universe_rankings_cooldown_idx on flow_universe_rankings (cooldown_until);
