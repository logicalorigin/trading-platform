-- Speeds up the durable option-chain cache loads (loadDurableOptionChain /
-- loadDurableOptionExpirations) which filter WHERE underlying_instrument_id = $1
-- AND expiration_date >= <today> ORDER BY expiration_date. Without this composite
-- index the planner scans every contract for the underlying (including the
-- never-deactivated expired backlog -- ~216k bloated index entries / ~44k live on
-- hot underlyings) and sorts, ~7.5s, which stalls the option-metadata hot path and
-- starves live option-quote lines.
create index if not exists option_contracts_underlying_expiration_idx
  on option_contracts (underlying_instrument_id, expiration_date);
