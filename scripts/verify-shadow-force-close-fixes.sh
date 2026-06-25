#!/usr/bin/env bash
# Verify the shadow-options stop-failsafe / ledger fixes end-to-end against the
# LIVE shadow-trading DB. Run this on the Replit box (where $DATABASE_URL ->
# helium is reachable) during or after a market session.
#
#   bash scripts/verify-shadow-force-close-fixes.sh
#
# Baseline = the rebuild that shipped the fixes (2026-06-25T02:47Z). Override:
#   BASELINE=2026-06-25T13:30:00Z bash scripts/verify-shadow-force-close-fixes.sh
set -euo pipefail
BASELINE="${BASELINE:-2026-06-25T02:47:00Z}"

echo "== First 5 FORCE-CLOSE exits since ${BASELINE} =="
echo "   Fix 1 = pnl present (loss => negative).  Fix 4 = exit price >= \$0.01."
psql "$DATABASE_URL" -P pager=off -c "
SET statement_timeout='10s';
SELECT occurred_at,
       symbol,
       left(deployment_id::text, 8)         AS deploy,
       payload->>'exitReason'               AS reason,
       (payload->>'exitPrice')::numeric     AS exit_px,
       (payload->>'pnl')::numeric           AS pnl,
       CASE
         WHEN payload->>'pnl' IS NULL                       THEN 'FIX1_FAIL: no pnl'
         WHEN (payload->>'exitPrice')::numeric < 0.01       THEN 'FIX4_FAIL: sub-penny'
         ELSE 'ok'
       END                                  AS verdict
FROM execution_events
WHERE event_type='signal_options_shadow_exit'
  AND payload->>'fillQuoteSource'='force'
  AND occurred_at >= '${BASELINE}'
ORDER BY occurred_at ASC
LIMIT 5;"

echo ""
echo "== Fix 3: any force-close on a NON-enabled / orphaned deployment? (expect 0) =="
psql "$DATABASE_URL" -P pager=off -t -c "
SET statement_timeout='10s';
SELECT count(*) AS forceclose_on_non_enabled_deployment
FROM execution_events e
WHERE e.event_type='signal_options_shadow_exit'
  AND e.payload->>'fillQuoteSource'='force'
  AND e.occurred_at >= '${BASELINE}'
  AND e.deployment_id NOT IN (SELECT id FROM algo_deployments WHERE enabled);"

echo ""
echo "== Halt sanity: realized pnl banked by force-close exits today (feeds daily-loss halt) =="
psql "$DATABASE_URL" -P pager=off -t -c "
SET statement_timeout='10s';
SELECT count(*)                                   AS force_exits,
       coalesce(sum((payload->>'pnl')::numeric),0) AS realized_pnl_sum
FROM execution_events
WHERE event_type='signal_options_shadow_exit'
  AND payload->>'fillQuoteSource'='force'
  AND occurred_at >= '${BASELINE}';"
