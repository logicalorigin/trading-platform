-- Census S14: the shared optionability gate on universe_catalog_listings is a
-- three-arm jsonb disjunction evaluated per row at 5 universe-scan call sites
-- (signal-monitor catalog expansion, flow-universe seed/expansion,
-- flow-universe planner, gex-universe refresh, signal-universe ranking); with
-- no matching index each scan is a full seq scan over the catalog. All three
-- arms are IMMUTABLE-compatible (jsonb -> / ->>, coalesce, ~* /
-- texticregexeq), so a partial index can adopt the predicate verbatim — the
-- predicate text below must stay byte-identical to the call sites' SQL so the
-- planner can prove implication by exact match. Keyed on normalized_ticker:
-- the servable scans order by and join through it. `active = true` is
-- deliberately NOT part of the predicate: one call site binds it as a query
-- parameter, which would defeat partial-index matching under generic plans.
-- Sites that OR this gate with flow_universe_rankings.metadata (planner, gex
-- refresh) form a cross-relation OR that no single-table index can serve;
-- they are unchanged by design.
--
-- Additive only; apply manually (drizzle-kit push is disabled on the shared
-- dev DB after the 2026-06-15 data-loss incident). CONCURRENTLY, so run it
-- outside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS universe_catalog_optionable_ticker_idx
  ON universe_catalog_listings (normalized_ticker)
  WHERE (
    coalesce(contract_meta->>'derivativeSecTypes', '') ~* '(^|,)\s*OPT\s*(,|$)'
    or contract_meta->>'optionabilityStatus' = 'verified'
    or contract_meta->'optionability'->>'status' = 'verified'
  );

ANALYZE universe_catalog_listings;
