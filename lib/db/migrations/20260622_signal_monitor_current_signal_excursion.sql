alter table signal_monitor_symbol_states
  add column if not exists current_signal_mfe_percent numeric(18, 6),
  add column if not exists current_signal_mae_percent numeric(18, 6);
