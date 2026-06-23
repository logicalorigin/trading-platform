-- Persist the actual underlying close of the signal bar.
--
-- current_signal_price is the indicator-authored signal/offset level. STA Move
-- and indicator KPIs need the real equity close at the signal, so keep both
-- values distinct instead of repurposing the existing field.

ALTER TABLE signal_monitor_symbol_states
  ADD COLUMN IF NOT EXISTS current_signal_close numeric(18, 6);
