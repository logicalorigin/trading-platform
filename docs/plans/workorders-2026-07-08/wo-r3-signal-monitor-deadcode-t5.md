# WO-R3 — Commit signal-monitor dead-code removal (+3bd7161e T5 ride-along) + IBKR-retirement/census singletons

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). You HAVE commit
authority for the exact files listed — nothing else. NEVER `git add -A`, `git add .`, or
`git commit -a`. Stage by explicit path only.

CONTEXT: Session 8939ce3f removed the retired IBKR-bridge-era broker "live-edge" bar-retry path.
The same file also carries concurrent session 3bd7161e's T5 fingerprint-dedup hunks
(completedBarsFingerprint/settingsSignature threading) — the coordination plan
(docs/plans/2026-07-08-review-session-findings-plan.md, Phase 2) explicitly assigns THIS lane to
commit T5 on 3bd7161e's behalf. Committing the whole file is correct; the message must say so.

## Commit A — signal-monitor dead-code + T5 ride-along
Files: `artifacts/api-server/src/services/signal-monitor.ts`,
`artifacts/api-server/src/services/signal-monitor-stream.test.ts`,
`artifacts/api-server/src/services/signal-monitor-local-bar-cache-rollup.test.ts`
- Read the diffs. Expected in signal-monitor.ts: removal of SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY,
  shouldAllowSignalMonitorBrokerLiveEdgeRetry, the "live-edge" fetch mode, retryReplacesNonIbkrLatest,
  liveEdgePriority input, isMassiveStocksRealtimeConfigured import; PLUS additive
  completedBarsFingerprint/settingsSignature params (T5).
- Verify the two test diffs pair with these changes (removed live-edge expectations / fingerprint
  threading). If a test diff references unrelated behavior, leave it out and report.
- Commit message: `perf(signal-monitor): remove dead IBKR live-edge bar retry (bridge retired); carry T5 fingerprint-dedup ride-along for session 3bd7161e (WO-R3)`

## Commit B — IBKR-retirement + census singletons (audit each, then commit what qualifies)
Candidate files (audit hunks BEFORE staging; commit only those matching the stated lineage):
- `artifacts/api-server/src/providers/ibkr/client.ts` + `lib/ibkr-contracts/src/client.ts` —
  qualifies only if the hunks are IBKR client-portal retirement cleanup.
- `artifacts/api-server/src/services/algo-gateway.ts` — expected: resolveAlgoShadowDisplayReadiness
  with "IBKR Client Portal live-execution path is retired" comment.
- `artifacts/api-server/src/services/runtime-flight-recorder.ts` +
  `artifacts/api-server/src/services/runtime-flight-recorder.test.ts` — expected: slow-query
  firehose diet (census S3+D5): truncate SQL, drop stack, per-family rate-limit, intra-day byte
  cap (single hunk ~:726). NOTE: this is NOT the plan's T9 heartbeat-dedup — do not confuse them.
- Commit qualifying files together: `perf(runtime): slow-query firehose diet (census S3+D5); IBKR client-portal retirement cleanup; algo shadow display readiness (WO-R3)`
- Any candidate whose hunks don't match: leave dirty, report why.

## Verify (before each commit)
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT=0.
2. Dead symbols really gone: `rg -c 'SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY|shouldAllowSignalMonitorBrokerLiveEdgeRetry|retryReplacesNonIbkrLatest|liveEdgePriority' --type ts artifacts lib` → 0 hits.
3. Targeted suites: `pnpm --filter @workspace/api-server exec vitest run src/services/signal-monitor-stream.test.ts src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/runtime-flight-recorder.test.ts`.

## Guardrails
- Do NOT touch: account.ts, backtest-worker/**, flow-universe.ts, snaptrade-*, backtesting.ts,
  overnight-spot-worker.ts, platform.ts / market-data-store.ts (WO-R2 owns), diagnostics.ts,
  automation.ts, lib/db/** except lib/ibkr-contracts as listed, artifacts/pyrus/**,
  SESSION_HANDOFF* / POLISH_BACKLOG.md, `__mint-agent-session.mts`.
- If verify fails: no commit; report verbatim.

Report → `.codex-watch/wo-r3-report.md`: per-commit SHA, verify output tails, per-candidate
include/exclude decisions with the hunk evidence.
