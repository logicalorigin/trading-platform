alter table signal_monitor_symbol_states
  add column if not exists filter_state jsonb;
