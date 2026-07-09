# WO-R3B — Retry of WO-R3: commit signal-monitor dead-code (+T5) and census singletons

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). You HAVE commit
authority for exactly the files below. NEVER `git add -A`, `git add .`, or `git commit -a`.

CONTEXT: WO-R3 (see `.codex-watch/wo-r3-report.md`) passed typecheck + dead-symbol checks but
declined to commit because its verify command used vitest — this repo runs tests via
`pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <files>`. All three suites
were just smoke-verified green with that command (54/54 pass). WO-R3's candidate triage is ADOPTED
as-is — do not re-litigate inclusions/exclusions, just re-verify and commit.

## Commit A — signal-monitor dead-code + T5 ride-along
Stage: `artifacts/api-server/src/services/signal-monitor.ts`,
`artifacts/api-server/src/services/signal-monitor-stream.test.ts`
Message: `perf(signal-monitor): remove dead IBKR live-edge bar retry (bridge retired); carry T5 fingerprint-dedup ride-along for session 3bd7161e (WO-R3B)`

## Commit B — census/retirement singletons
Stage: `artifacts/api-server/src/services/algo-gateway.ts`,
`artifacts/api-server/src/services/runtime-flight-recorder.ts`,
`artifacts/api-server/src/services/runtime-flight-recorder.test.ts`
Message: `perf(runtime): slow-query firehose diet (census S3+D5); algo shadow display readiness post-IBKR retirement (WO-R3B)`

## Commit C — orphaned test rider (conditional)
`artifacts/api-server/src/services/signal-monitor-local-bar-cache-rollup.test.ts` asserts the
session-aware recent-window scan bound whose SOURCE change already landed in an earlier commit
(signal-monitor-local-bar-cache.ts is not dirty). It passes in the current tree. Commit it alone:
Message: `test(signal-monitor): local-bar-cache rollup session-aware scan-bound coverage (rides landed scan change) (WO-R3B)`
If it unexpectedly fails standalone, skip Commit C and report.

## Carried exclusions (leave dirty — other lanes)
- `artifacts/api-server/src/providers/ibkr/client.ts` (OAuth client support — hosted-connector lane)
- `lib/ibkr-contracts/src/client.ts` (dayPnl account-snapshot shape — account lane)

## Verify (before each commit)
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT=0.
2. `rg -c 'SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY|shouldAllowSignalMonitorBrokerLiveEdgeRetry|retryReplacesNonIbkrLatest|liveEdgePriority' --type ts artifacts lib` → no matches (rg exit 1).
3. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/runtime-flight-recorder.test.ts` → all pass.

## Guardrails
Do NOT touch: account.ts, backtest-worker/**, flow-universe.ts, snaptrade-*, backtesting.ts,
overnight-spot-worker.ts, platform.ts / market-data-store.ts (WO-R2B owns), diagnostics.ts,
automation.ts, lib/db/**, artifacts/pyrus/**, SESSION_HANDOFF*/POLISH_BACKLOG.md.
If verify fails: no commit for that unit; report verbatim.

Report → `.codex-watch/wo-r3b-report.md`: per-commit SHA + verify output tails.
