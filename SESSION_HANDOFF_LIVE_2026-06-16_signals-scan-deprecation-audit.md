# SESSION HANDOFF (LIVE) — Signals scan-deprecation purge

- **Date/time:** 2026-06-16 ~12:25 MT (18:25 UTC)
- **Runtime:** Claude Code session `5b7a1ccb-21e8-42e4-aa10-7b8866084d3a` (CWD `/home/runner/workspace`)
- **Resumed:** 2026-06-16 by session `1a7b063f-27ad-44ae-b4a1-c76c45e2948b` — re-verified both "Done" edits still intact in working tree; Bash now unblocked.
- **Workstream:** Signals audit (picked up from dropped session `48fdb1bc`). User goal: signals run as **ticker-data SSE → matrix push**; remove the scanning system/worker that runs redundantly alongside it. Decision: **disable the scan, keep code dormant + rename it.**

## Corrected architecture (verified from source)
- **Live path (KEEP):** stock-aggregate (ticker) stream → `queueSignalMonitorMatrixStreamAggregate` → `flushSignalMonitorMatrixStreamAggregates` (signal-monitor.ts:6897) → `emitSignalMonitorMatrixStreamAggregateDelta` (6791) → `evaluateSignalMonitorMatrixStreamScopeDelta` (stream eval) + `persistSignalMonitorMatrixStatesBestEffort`. **No `isSignalMonitorBarEvaluationEnabled()` in this path** — gated only on streaming availability + a subscriber. The server-owned producer (7064-7220) provides the always-on subscriber. This is the "passive signal source."
- **Legacy scan (DISABLE):** `isSignalMonitorBarEvaluationEnabled()` (5710) gates `loadSignalMonitorCompletedBars` (4872 → 503 "passive signal source"), `refreshSignalMonitorBackfilledBaseBars` (3576), on-demand evaluate (7550/7789), `readSignalMonitorStateFresh` (9631), and the `trade-monitor-worker` poll/rotation scan.
- **The bug:** api-server `dev` script (package.json:7) hardcoded `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true` → the legacy scan ran redundantly alongside the SSE producer (this was the earlier wrong note "scan is off" — it was only unset in the interactive shell, force-true for the node process).

## Done this session
1. `artifacts/api-server/src/index.ts` — removed `startTradeMonitorWorker` + `startSignalMonitorLocalBarCacheWarmup` from `backgroundWorkers` (260-271) and their imports; added a do-not-re-add comment. (verified: no remaining refs)
2. `artifacts/api-server/package.json:7` — dev script flag `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED` set `true` → **`false`**. (THE key lever)

## Remaining (tasks #2,#3,#4,#5,#6)
- **Rename** `trade-monitor-worker.ts` → e.g. `signal-monitor-evaluation-worker.ts` + all up/downstream refs (re-grep before rename). **Re-grep on resume found a 2nd importer:** `artifacts/api-server/src/services/background-worker-pressure.test.ts` imports `trade-monitor-worker` (index.ts ref already removed) — update it during the rename; it also affects typecheck. Keep `/signal-monitor/evaluate` dormant (NOT removed).
- **Fix Tracked count**: SettingsScreen.jsx:2939 uses `stateSummary.total` (raw rows). Change to distinct ACTIVE symbols.
- **Retire SCAN vocabulary**: signalMonitorStatusModel.js:127-170 (SCANNING/SCAN ON/OFF/ERROR) → stream/SSE labels; consumers SettingsScreen.jsx + HeaderBroadcastScrollerStack.jsx.
- **Prune stale states** (DESTRUCTIVE, needs psql): delete `active=false` rows from `signal_monitor_symbol_states` (was 3704 rows / 2373 active / 664 symbols; paper profile = the live one).

## MUST-DO before declaring done
- **Restart required:** flag change only takes effect on api-server restart (USER controls restarts).
- **Post-restart verify:** confirm `signal_monitor_symbol_states.updated_at` keeps advancing + events keep flowing with flag=false (proves passive SSE path still computes). If writes STOP → revert package.json flag to true.
- ✅ **`pnpm run audit:replit-startup`** — PASS at resume (`[check-replit-startup-guards] ok`). Was required because the artifact dev script was edited.
- ✅ **`pnpm --filter @workspace/api-server run typecheck`** — PASS at resume (clean; confirms index.ts import removals leave no dangling refs).

## Working-tree caveat (UPDATED 2026-06-16 — original caveat now historical)
- ✅ The three workstreams below were **already committed together** in Replit full-checkpoint `c4ba2e5` ("Transitioned from Plan to Build mode", 13:01 MT), so they are **no longer uncommitted** and the original "stage only `index.ts` + `package.json`, leave the rest for their own commits" warning is moot. Verified via `git show --stat c4ba2e5`:
  - **Signals scan-deprecation:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/package.json` — committed in `c4ba2e5`.
  - **Broker-connection UI audit:** `HeaderStatusCluster.jsx`, `AccountScreen.jsx` (see `BROKER_CONNECTION_UI_AUDIT_2026-06-16.md`) — committed in `c4ba2e5`.
  - **Signal-score-threshold rescale (0–10 → 0–100):** `artifacts/pyrus/src/components/platform/signal-language/thresholds.js` — **DONE / committed in `c4ba2e5`**, verified fully applied across all consumers and both client+server score engines (no 0–10 stragglers).
- Note: the original caveat reflected the pre-13:01 working tree. Later signals work (e.g. the `trade-monitor-worker.ts` → `signal-monitor-evaluation-worker.ts` rename) lands as its own separate, still-uncommitted change set — keep staging by workstream.

## Blocked right now
- ~~Bash (grep/typecheck/psql) transient classifier-unavailable window~~ → **CLEARED at resume.** typecheck / `audit:replit-startup` / psql are runnable again.

**Do NOT** "fix" the NUL byte in signal-monitor.ts (~offset 43831) — deliberate `${symbol}\0${timeframe}` map-key delimiter, committed in 783fe06.
