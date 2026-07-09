# WO-R4B — Retry of WO-R4 units 1-2: diagnostics census + automation read coalescing

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). You HAVE commit
authority for exactly the files below. NEVER `git add -A`, `git add .`, or `git commit -a`.

CONTEXT: WO-R4 (`.codex-watch/wo-r4-report.md`) committed unit 3 and declined units 1-2 only
because its verify command used vitest — this repo runs tests via
`pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <files>`. WO-R4's provenance
findings are ADOPTED: do not re-litigate, just verify with the correct command and commit.

## Commit A — diagnostics storage-census batching (source only)
Stage: `artifacts/api-server/src/services/diagnostics.ts`
(WO-R4 verified: batches buildMonitoredStorageTableStats N+1 into one union-all query;
lane-classification.md:153.)
Message: `perf(diagnostics): batch monitored-storage-table stats into one union-all query (WO-R4B)`

## Commit B — orphaned test rider (conditional)
`artifacts/api-server/src/services/diagnostics-ibkr-metrics.test.ts` is ibkr-datapath-removal lane
coverage (lane-classification.md:100) whose source behavior is already landed; it does NOT pair
with the census hunk. If it passes standalone
(`pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/diagnostics-ibkr-metrics.test.ts`),
commit it alone:
Message: `test(diagnostics): retired-IBKR bridge metrics coverage (rides landed datapath removal) (WO-R4B)`
If it fails, leave dirty and report.

## Commit C — automation execution-events read coalescing
Stage: `artifacts/api-server/src/services/automation.ts`,
`artifacts/api-server/src/services/automation.merge-events.test.ts`
(WO-R4 verified: 2s executionEventsListCache + in-flight dedup = census S6; the test pairs.)
Message: `perf(automation): 2s shared cache + in-flight dedup for listExecutionEvents (census S6) (WO-R4B)`

## Verify (before each commit)
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT=0.
2. The relevant suite(s) via tsx --test as above; for Commit C:
   `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/automation.merge-events.test.ts`.

## Guardrails
Do NOT touch: account.ts, backtest-worker/**, flow-universe.ts, snaptrade-*, backtesting.ts,
overnight-spot-worker.ts, platform*.ts, market-data-store.ts, signal-monitor*.ts,
lib/db/** (schema/index.ts stays dirty for the overnight lane), artifacts/pyrus/**,
SESSION_HANDOFF*/POLISH_BACKLOG.md, untracked files.
If verify fails for a unit: that unit stays dirty; report verbatim.

Report → `.codex-watch/wo-r4b-report.md`: per-commit SHA + verify output tails.
