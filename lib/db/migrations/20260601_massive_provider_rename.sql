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

delete from instrument_aliases old_alias
 where old_alias.provider = 'polygon'
   and exists (
     select 1
       from instrument_aliases new_alias
      where new_alias.provider = 'massive'
        and new_alias.alias_value = old_alias.alias_value
   );

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

delete from bar_cache old_bar
 where old_bar.source like '%polygon%'
   and exists (
     select 1
       from bar_cache new_bar
      where new_bar.instrument_id = old_bar.instrument_id
        and new_bar.timeframe = old_bar.timeframe
        and new_bar.starts_at = old_bar.starts_at
        and new_bar.source = replace(old_bar.source, 'polygon', 'massive')
   );

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

delete from flow_events old_event
 where old_event.provider = 'polygon'
   and old_event.provider_event_key is not null
   and exists (
     select 1
       from flow_events new_event
      where new_event.provider = 'massive'
        and new_event.provider_event_key = old_event.provider_event_key
   );

update flow_events
   set provider = 'massive',
       updated_at = now()
 where provider = 'polygon';

alter table if exists flow_events
  alter column provider set default 'massive';

delete from flow_event_hydration_sessions old_session
 where old_session.provider = 'polygon'
   and exists (
     select 1
       from flow_event_hydration_sessions new_session
      where new_session.underlying_symbol = old_session.underlying_symbol
        and new_session.provider = 'massive'
        and new_session.market_date = old_session.market_date
   );

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
