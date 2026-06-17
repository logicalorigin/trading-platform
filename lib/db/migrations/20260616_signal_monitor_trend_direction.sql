-- Persist the indicator's current trend (bullish/bearish) per symbol-state.
--
-- current_signal_direction holds the sparse stable-CROSSOVER direction (null when
-- no crossover is in the window). The indicator also computes an always-defined
-- current trend; persisting it lets the matrix bootstrap surface a buy/sell
-- direction for every warmed-up symbol on load, while the crossover keeps driving
-- "fresh" and the actionEligible trade-safety gate (a trend-only row has no
-- signalAt, so it is shown but never auto-tradeable).
--
-- Additive, nullable column; no data rewrite. Apply manually (drizzle-kit push is
-- disabled on the shared dev DB after the 2026-06-15 data-loss incident).
ALTER TABLE signal_monitor_symbol_states
  ADD COLUMN IF NOT EXISTS trend_direction varchar(8);
