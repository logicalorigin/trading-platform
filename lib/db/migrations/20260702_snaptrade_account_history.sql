CREATE TABLE IF NOT EXISTS snaptrade_account_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES broker_accounts(id),
  snaptrade_activity_id varchar(180) NOT NULL,
  trade_date timestamptz NOT NULL,
  settlement_date timestamptz,
  type varchar(64) NOT NULL,
  option_type varchar(48),
  symbol varchar(96),
  raw_symbol varchar(160),
  description text,
  option_ticker varchar(160),
  quantity numeric(20, 6),
  price numeric(20, 6),
  amount numeric(20, 6),
  fee numeric(20, 6),
  currency varchar(16) NOT NULL DEFAULT 'USD',
  external_reference_id varchar(180),
  raw_payload jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS snaptrade_account_activities_account_idx
  ON snaptrade_account_activities (account_id);

CREATE INDEX IF NOT EXISTS snaptrade_account_activities_account_trade_date_idx
  ON snaptrade_account_activities (account_id, trade_date DESC);

CREATE INDEX IF NOT EXISTS snaptrade_account_activities_symbol_idx
  ON snaptrade_account_activities (symbol);

CREATE UNIQUE INDEX IF NOT EXISTS snaptrade_account_activities_unique_idx
  ON snaptrade_account_activities (account_id, snaptrade_activity_id);
