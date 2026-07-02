-- Curated signal-universe ranking storage (signal-universe-ranking.ts).
-- One row per optionable catalog symbol, refreshed once per completed session:
-- 50/50 dollar-volume + volatility rank-percentile score, hysteresis-stable
-- `member` flag the signal-monitor expansion orders by, and an auditable
-- `excluded_reason` for every curation drop (bond ETFs, SPACs, preferreds,
-- OTC, insufficient data).
CREATE TABLE IF NOT EXISTS "signal_universe_rankings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "symbol" varchar(64) NOT NULL,
  "score" numeric(20, 6) NOT NULL DEFAULT '0',
  "rank" integer,
  "dollar_volume" numeric(24, 2),
  "volatility" numeric(18, 6),
  "optionable" boolean NOT NULL DEFAULT false,
  "excluded_reason" varchar(160),
  "member" boolean NOT NULL DEFAULT false,
  "ranked_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "signal_universe_rankings_symbol_idx"
  ON "signal_universe_rankings" ("symbol");
CREATE INDEX IF NOT EXISTS "signal_universe_rankings_rank_idx"
  ON "signal_universe_rankings" ("rank");
CREATE INDEX IF NOT EXISTS "signal_universe_rankings_member_idx"
  ON "signal_universe_rankings" ("member");
