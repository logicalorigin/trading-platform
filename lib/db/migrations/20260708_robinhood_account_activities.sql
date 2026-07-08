-- Robinhood per-trade realized P&L history (auto-backfill).
-- Mirrors snaptrade_account_activities: the Robinhood MCP get_pnl_trade_history
-- tool returns closing trades with realized P&L already computed, so this stores
-- them directly (no cost-basis reconstruction). Populated by the history
-- scheduler + on-connect hook so account P&L is present without a page open.
-- Robinhood P&L trades carry no stable server id, so activity_key is a
-- deterministic hash of the row identity (see robinhood-account-history.ts).

CREATE TABLE IF NOT EXISTS robinhood_account_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES broker_accounts(id),
  activity_key varchar(128) NOT NULL,
  closed_at timestamptz NOT NULL,
  symbol varchar(96),
  side varchar(16),
  quantity numeric(20, 6),
  price numeric(20, 6),
  realized_gain numeric(20, 6),
  currency varchar(16) NOT NULL DEFAULT 'USD',
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS robinhood_account_activities_account_idx
  ON robinhood_account_activities (account_id);

CREATE INDEX IF NOT EXISTS robinhood_account_activities_account_closed_at_idx
  ON robinhood_account_activities (account_id, closed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS robinhood_account_activities_unique_idx
  ON robinhood_account_activities (account_id, activity_key);
