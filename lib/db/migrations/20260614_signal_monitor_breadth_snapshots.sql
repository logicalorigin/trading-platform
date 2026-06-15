-- Periodic snapshots of standing signal breadth (symbols on buy vs sell) per
-- timeframe, plus an aggregate row (timeframe = 'all'). Recorded going forward
-- so the Signals breadth sparklines read an exact, universe-bounded history
-- instead of replaying the full event log on every request.

create table if not exists signal_monitor_breadth_snapshots (
  id uuid primary key default gen_random_uuid(),
  environment environment_mode not null,
  timeframe varchar(16) not null,
  captured_at timestamptz not null,
  buy integer not null default 0,
  sell integer not null default 0,
  total integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signal_monitor_breadth_snapshots_env_captured_idx
  on signal_monitor_breadth_snapshots (environment, captured_at);

create index if not exists signal_monitor_breadth_snapshots_env_tf_captured_idx
  on signal_monitor_breadth_snapshots (environment, timeframe, captured_at);
