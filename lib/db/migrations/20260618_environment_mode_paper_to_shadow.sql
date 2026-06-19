-- Rename the environment_mode enum value 'paper' -> 'shadow'.
--
-- "shadow" is the single canonical name for the simulated environment (where
-- strategies are tested before going live); "paper" was a redundant synonym.
-- Only the value is renamed; the other value ('live') is unchanged.
--
-- ALTER TYPE ... RENAME VALUE atomically relabels the value across EVERY column
-- typed environment_mode (algo_deployments.mode, algo_strategies.mode,
-- broker_accounts.mode, broker_connections.mode, order_requests.mode,
-- signal_monitor_profiles.environment, signal_monitor_events.environment,
-- signal_monitor_breadth_snapshots.environment) with no row rewrite, no data
-- loss. Reversible: ALTER TYPE environment_mode RENAME VALUE 'shadow' TO 'paper'.
--
-- Apply manually (drizzle-kit push is disabled on the shared dev DB after the
-- 2026-06-15 data-loss incident).

ALTER TYPE environment_mode RENAME VALUE 'paper' TO 'shadow';
