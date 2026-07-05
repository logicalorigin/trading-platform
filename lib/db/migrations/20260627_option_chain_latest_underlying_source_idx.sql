-- Speed GEX/current-chain reads that qualify latest option snapshots by both
-- underlying and source. This is additive and safe to run while the worker is
-- live because it uses CONCURRENTLY.

create index concurrently if not exists option_chain_latest_underlying_source_idx
  on option_chain_latest (underlying_instrument_id, source);

analyze option_chain_latest;
