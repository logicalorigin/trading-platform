-- Persist the close of the bar at latest_bar_at so the STA "Move since signal"
-- column can render synchronously from the matrix state. Nullable: states with
-- no evaluated bar (error/unavailable lanes) leave it null, and the UI falls
-- back to live-quote/sparkline hydration as before.

alter table if exists signal_monitor_symbol_states
  add column if not exists latest_bar_close numeric(18, 6);
