-- Optional quote fields for future quote-enriched option backtest bars.
-- Current Massive Options Developer history remains aggregate/OHLCV-only; these
-- columns are nullable so existing cached equity/option bars stay valid.

alter table historical_bars
  add column if not exists bid numeric(18, 6),
  add column if not exists ask numeric(18, 6),
  add column if not exists mid numeric(18, 6),
  add column if not exists quote_as_of timestamp with time zone,
  add column if not exists provider_contract_id varchar(128);

create index if not exists historical_bars_provider_contract_quote_idx
  on historical_bars (provider_contract_id, quote_as_of)
  where provider_contract_id is not null and quote_as_of is not null;
