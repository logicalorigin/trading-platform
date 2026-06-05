-- Promote legacy broad Signal Monitor profiles from watchlist-only coverage to
-- the 500-symbol expanded universe default.

alter table if exists signal_monitor_profiles
  alter column max_symbols set default 500;

alter table if exists signal_monitor_profiles
  alter column evaluation_concurrency set default 6;

update signal_monitor_profiles
   set max_symbols = case
         when coalesce(
           pyrus_signals_settings->>'__signalMonitorUniverseScope',
           pyrus_signals_settings->>'universeScope',
           ''
         ) <> 'selected_watchlist'
           and max_symbols < 500
         then 500
         else max_symbols
       end,
       pyrus_signals_settings = case
         when (
           case
             when coalesce(
               pyrus_signals_settings->>'__signalMonitorUniverseScopeDefaultVersion',
               ''
             ) ~ '^[0-9]+$'
             then (
               pyrus_signals_settings->>'__signalMonitorUniverseScopeDefaultVersion'
             )::integer
             else 0
           end
         ) < 2
           and coalesce(
             pyrus_signals_settings->>'__signalMonitorUniverseScope',
             pyrus_signals_settings->>'universeScope',
             ''
           ) in ('', 'all_watchlists', 'all_watchlists_only')
         then jsonb_set(
           jsonb_set(
             coalesce(pyrus_signals_settings, '{}'::jsonb),
             '{__signalMonitorUniverseScope}',
             to_jsonb('all_watchlists_plus_universe'::text),
             true
           ),
           '{__signalMonitorUniverseScopeDefaultVersion}',
           '2'::jsonb,
           true
         )
         else pyrus_signals_settings
       end,
       updated_at = now()
 where (
         coalesce(
           pyrus_signals_settings->>'__signalMonitorUniverseScope',
           pyrus_signals_settings->>'universeScope',
           ''
         ) <> 'selected_watchlist'
         and max_symbols < 500
       )
    or (
         (
           case
             when coalesce(
               pyrus_signals_settings->>'__signalMonitorUniverseScopeDefaultVersion',
               ''
             ) ~ '^[0-9]+$'
             then (
               pyrus_signals_settings->>'__signalMonitorUniverseScopeDefaultVersion'
             )::integer
             else 0
           end
         ) < 2
         and coalesce(
           pyrus_signals_settings->>'__signalMonitorUniverseScope',
           pyrus_signals_settings->>'universeScope',
           ''
         ) in ('', 'all_watchlists', 'all_watchlists_only')
       );
