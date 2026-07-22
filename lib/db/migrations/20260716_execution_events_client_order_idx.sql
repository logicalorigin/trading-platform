-- Exact overnight client-order idempotency lookups must not scan an arbitrary
-- prefix of a deployment's execution ledger.
--
-- CONCURRENTLY: builds without locking writes; run outside a transaction with
-- statement_timeout disabled. drizzle-kit push remains disabled on the shared
-- development database.
-- The explicit character set matches JavaScript String.prototype.trim, which
-- is used by the legacy payload reader; PostgreSQL's one-argument btrim only
-- removes ordinary spaces.
CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_deployment_client_order_idx
  ON execution_events (
    deployment_id,
    (coalesce(
      nullif(btrim(payload->>'clientOrderId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), ''),
      nullif(btrim(payload->'order'->>'clientOrderId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), ''),
      nullif(btrim(payload->'plan'->>'clientOrderId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '')
    ))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS automation_diagnostics_deployment_client_order_any_idx
  ON automation_diagnostics (
    deployment_id,
    (coalesce(
      nullif(btrim(payload->>'clientOrderId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), ''),
      nullif(btrim(payload->'order'->>'clientOrderId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), ''),
      nullif(btrim(payload->'plan'->>'clientOrderId', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '')
    ))
  );
