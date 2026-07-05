-- Speeds up durable option-chain cache reads:
--   WHERE underlying_instrument_id = ?
--     AND is_active = true
--     AND expiration_date >= <today>
--   ORDER BY expiration_date, strike, right
--
-- The older option_contracts_underlying_expiration_idx is still useful, but it
-- leaves active-row filtering and strike/right ordering to runtime work on hot
-- underlyings with thousands of future contracts. Keep this as a partial index
-- so expired/inactive backlog does not bloat the hot read path.
CREATE INDEX CONCURRENTLY IF NOT EXISTS option_contracts_active_chain_order_idx
  ON option_contracts (underlying_instrument_id, expiration_date, strike, "right")
  WHERE is_active = true;

ANALYZE option_contracts;
