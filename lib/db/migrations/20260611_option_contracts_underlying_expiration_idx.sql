-- Speeds up the durable option-chain cache loads (loadDurableOptionChain /
-- loadDurableOptionExpirations) which filter WHERE underlying_instrument_id = $1
-- AND expiration_date >= <today> ORDER BY expiration_date. Without this composite
-- index the planner scans every contract for the underlying (including the
-- never-deactivated expired backlog -- ~216k bloated index entries / ~44k live on
-- hot underlyings) and sorts, ~7.5s, which stalls the option-metadata hot path and
-- starves live option-quote lines.
create index if not exists option_contracts_underlying_expiration_idx
  on option_contracts (underlying_instrument_id, expiration_date);

-- Refresh planner stats so the new composite index is actually chosen. On a
-- bloated/under-vacuumed table the planner otherwise BitmapAnds the two stale
-- single-column indexes (measured: 28s) instead of an index range scan (17ms).
analyze option_contracts;
