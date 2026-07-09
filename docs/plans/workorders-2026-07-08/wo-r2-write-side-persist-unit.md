# WO-R2 — Commit the write-side persist-streamlining unit (miss-storm fix)

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). You HAVE commit
authority for the exact files listed — nothing else. NEVER `git add -A`, `git add .`, or
`git commit -a`. Stage by explicit path only.

CONTEXT: Session 8939ce3f's write-side fix: bar_cache background-persist queue was shift()-dropping
closed bars with no retry (single writer drained ~1.5 bars/s against a saturated pool), so bars
never landed and every read re-gap-filled forever. The fix spans a return-contract change
(`persistMarketDataBars` → `boolean|"skipped"`) that flows market-data-store.ts → platform.ts
drain, so these files MUST land as ONE commit.

## The unit (one commit)
Source files:
- `artifacts/api-server/src/services/market-data-store.ts` — PersistMarketDataBarsResult contract,
  backoff-active short-circuit → "skipped", handleStoreError returns "skipped"|"failed"
  (pool-contention → skipped, no backoff).
- `artifacts/api-server/src/services/platform.ts` — barsBackgroundPersist queue: window-key
  coalescing, 512-entry bounded queue with drop counters, skipped/coalesced/dropped diagnostics,
  concurrency default 1→3; bars cache-scope normalization (buildBarsScopeKey
  allowHistoricalSynthesis), requireFreshHistorical plumbing + reuse guards; option-chain dead-code
  removal (IbkrOptionExpirationDates deletion, batchOptionChains simplification); ibkrBars producer
  removal in getBaseBarsImpl.
- `artifacts/api-server/src/routes/platform.ts` — SPARKLINE_SEED_DB_BATCH_SIZE 4→64;
  requireFreshHistorical query-flag parsing (2 sites).

Riding test files — VERIFY each one's diff actually pairs with the above sources before staging
(read the test diff; if it references SnapTrade/backtest/overnight/flow behavior, leave it out):
- `artifacts/api-server/src/routes/platform-sparkline-seed.test.ts`
- `artifacts/api-server/src/services/platform-bars-background-persist.test.ts`
- `artifacts/api-server/src/services/option-chain-policy.test.ts`
- `artifacts/api-server/src/routes/broker-execution.test.ts` — AUDIT this one: only include if its
  diff is exclusively about the platform/bars/option-chain changes above; otherwise leave dirty.

## Pre-commit safety check
The plan doc marks platform.ts as a previously "held" lane (T6 SSE double-fetch at ~:3104, T1b-4 at
:3094). Verified already: the diff's lowest hunk is @8341 — but RE-CONFIRM with
`git diff --unified=0 -- artifacts/api-server/src/services/platform.ts | grep '^@@' | head -3`.
If any hunk sits below line 8000, STOP and report.

## Verify (all must pass before the commit)
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT=0.
2. Targeted suites: `pnpm --filter @workspace/api-server exec vitest run src/services/platform-bars-background-persist.test.ts src/routes/platform-sparkline-seed.test.ts src/services/option-chain-policy.test.ts` (add broker-execution.test.ts if included).

Commit message: `perf(bars-persist): coalesce background persist by window key, bounded queue + skipped-state contract, concurrency 1->3; requireFreshHistorical scope gating; drop dead IBKR option-chain path (WO-R2)`

## Guardrails
- Do NOT touch: account.ts, backtest-worker/**, flow-universe.ts, snaptrade-*, backtesting.ts,
  overnight-spot-worker.ts, signal-monitor*.ts (WO-R3 owns those), diagnostics.ts, automation.ts,
  lib/db/** (other WOs), artifacts/pyrus/** (frontend), any SESSION_HANDOFF* / POLISH_BACKLOG.md.
- If typecheck or tests fail: no commit; report the failure verbatim.

Report → `.codex-watch/wo-r2-report.md`: commit SHA, verify output tails, which test files you
included/excluded and why.
