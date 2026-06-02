-- Canonicalize market data provider naming from Polygon to Massive.
-- Fresh schema migrations already use Massive; this migration upgrades existing
-- databases that still have the old persisted provider names.

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_name = 'option_contracts'
       and column_name = 'polygon_ticker'
  ) and not exists (
    select 1
      from information_schema.columns
     where table_name = 'option_contracts'
       and column_name = 'massive_ticker'
  ) then
    alter table option_contracts rename column polygon_ticker to massive_ticker;
  end if;
end
$$;

alter index if exists option_contracts_polygon_ticker_idx
  rename to option_contracts_massive_ticker_idx;

do $$
begin
  if exists (
    select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'market_data_provider'
       and e.enumlabel = 'polygon'
  ) and not exists (
    select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'market_data_provider'
       and e.enumlabel = 'massive'
  ) then
    alter type market_data_provider rename value 'polygon' to 'massive';
  end if;
end
$$;

update instrument_aliases
   set provider = 'massive',
       updated_at = now()
 where provider = 'polygon';

update quote_cache
   set source = 'massive',
       updated_at = now()
 where source = 'polygon';

alter table if exists quote_cache
  alter column source set default 'massive';

update bar_cache
   set source = replace(source, 'polygon', 'massive'),
       updated_at = now()
 where source like '%polygon%';

alter table if exists bar_cache
  alter column source set default 'massive';

update option_chain_snapshots
   set source = replace(source, 'polygon', 'massive'),
       updated_at = now()
 where source like '%polygon%';

alter table if exists option_chain_snapshots
  alter column source set default 'massive';

update provider_request_log
   set provider = 'massive',
       updated_at = now()
 where provider = 'polygon';

update flow_events
   set provider = 'massive',
       updated_at = now()
 where provider = 'polygon';

alter table if exists flow_events
  alter column provider set default 'massive';

update flow_event_hydration_sessions
   set provider = 'massive',
       updated_at = now()
 where provider = 'polygon';

alter table if exists flow_event_hydration_sessions
  alter column provider set default 'massive';

update universe_catalog_listings
   set providers = array_replace(providers, 'polygon', 'massive'),
       trade_provider = case when trade_provider = 'polygon' then 'massive' else trade_provider end,
       data_provider_preference = case
         when data_provider_preference = 'polygon' then 'massive'
         else data_provider_preference
       end,
       updated_at = now()
 where 'polygon' = any(providers)
    or trade_provider = 'polygon'
    or data_provider_preference = 'polygon';

do $$
begin
  if exists (
    select 1
      from information_schema.tables
     where table_name = 'historical_bar_datasets'
  ) then
    update historical_bar_datasets
       set source = replace(source, 'polygon', 'massive'),
           updated_at = now()
     where source like '%polygon%';

    alter table historical_bar_datasets
      alter column source set default 'massive';
  end if;
end
$$;
