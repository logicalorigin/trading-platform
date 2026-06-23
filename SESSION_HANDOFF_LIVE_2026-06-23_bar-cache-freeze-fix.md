# LIVE Handoff — Massive price-freeze root cause + bar-cache fix (in flight)

- Session ID: `43e47bfc-4de9-4f06-a0ca-86d20fca55e2` (Claude Code)
- Saved (MT): 2026-06-23 (active workstream)
- Repo: `/home/runner/workspace` | Branch: `main` (ahead of `origin/main` by 1)
- Canonical handoff: `SESSION_HANDOFF_2026-06-23_43e47bfc-4de9-4f06-a0ca-86d20fca55e2.md` (auto-managed; this LIVE note is the source of truth for THIS workstream)

## Workstream
Resume the recovered bug hunt → diagnose & fix why **Massive prices appear to "freeze."**

## ROOT CAUSE (corrected — earlier theory was refuted by runtime data)
The Massive socket is HEALTHY (no reconnects/gaps). Prices "freeze" because the **single Node event loop freezes for 1–3s at a time** (GC pauses), and during the freeze ingested frames can't be processed/delivered.

**Cause is `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`:**
1. `handleMassiveAggregate` → `enqueueRollups` calls `rollupMinuteBars` for **5 timeframes**, each doing `[...allMinuteBarsForSymbol].sort()` over **up to 72h of 1-min bars** (`DEFAULT_MEMORY_RETENTION_MS` line 51) just to emit `limit:3` buckets → ~17 MB/s transient garbage across ~500 symbols.
2. `flushPendingPersistBars` drains the backlog **serially** (`for…await persistMarketDataBars`) → ~1.4 bars/s vs ~11.5/s inbound (8× deficit) → unbounded `pendingPersistBars`.
→ ~1/min major GC reclaiming ~820MB → event-loop max spikes 2863/1716/1315ms.

**Runtime evidence (GC watch, observed):** heap sawtooth 636→1583MB; GC drops coincide with worst event-loop freezes; quote socket healthy (eventCount +560k, 0 reconnects); `pendingPersistBarCount` 2872→5044 climbing. Samples: `/tmp/claude-1000/-home-runner-workspace/43e47bfc-.../scratchpad/gc-watch.jsonl`.

Related (another agent): under pressure the gate stops flow-scanner deep work but does NOT shed retained scanner quote leases (160+ live lines) — same event-loop-freeze symptom; their angle is the blunt pressure RESPONSE.

## ✅ MERGED TO MAIN — verified (2026-06-23)
Both subagent branches cherry-picked onto `main` and verified together:
- `d9e310a` perf: cap per-aggregate rollup to 4h window (rollup-churn fix). Bound proven: 239 bars scanned with 4800 retained (was 4800).
- `10dbd0d` perf: drain persist backlog with bounded concurrency (cap 5, env `PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_FLUSH_CONCURRENCY`).
- Cherry-pick conflict (both touched the constants block + `reset()`) resolved keep-both.
- Verified on merged tree: `pnpm --filter @workspace/api-server run typecheck` EXIT 0; all **7/7** `signal-monitor-local-bar-cache*` tests pass.
- `main` now ahead of `origin/main` by **3** (3b1ab21 + d9e310a + 10dbd0d) — UNPUSHED, NOT deployed (user's call).

## IN FLIGHT (now done) — 2 worktree-isolated subagents
Plan = `/planning-and-task-breakdown` output (in transcript). Fix split across disjoint functions of the same file + separate new test files → clean merge.
- **Agent A** (`fix/bar-cache-rollup-churn`): cap per-aggregate rollup input to the recent window (~4h, = 1h×3 + margin) so per-aggregate scan is O(recent), not O(72h). + test `signal-monitor-local-bar-cache-rollup.test.ts` (behavior-equality + bounded-scan). Commits on its branch in its worktree.
- **Agent B** (`fix/bar-cache-persist-drain`): parallelize `flushPendingPersistBars` with bounded concurrency (~5, env-overridable) + injectable persist seam; preserve in-flight guard, grouping, per-group failure-requeue (no double-count). + test `signal-monitor-local-bar-cache-persist.test.ts` (full drain / concurrency cap / failure requeue). Commits on its branch.

## NEXT STEPS (resume here)
1. When BOTH subagents complete: merge `fix/bar-cache-rollup-churn` + `fix/bar-cache-persist-drain` into the main working tree (cherry-pick both branches, or splice the disjoint functions + add both test files — they don't overlap).
2. Verify: `pnpm --filter @workspace/api-server run typecheck` (EXIT 0) + `cd artifacts/api-server && node --import tsx --test src/services/signal-monitor-local-bar-cache*.test.ts` (all pass).
3. Commit as ONE bar-cache fix. **Do NOT deploy/push — user's call.**
4. Deferred (not done):
   - Reduce `DEFAULT_MEMORY_RETENTION_MS` 72h → smaller (trade-off: more DB augmentation; flagged, conservative).
   - #2 route-admission sparkline shed: DB-backed `/sparklines/seed` exists + used by `MarketDataSubscriptionProvider.jsx`; verify at runtime whether sparkline `/bars` actually get 429-shed before changing.
   - #3 no-op `getApiResourcePressureCaps`: NOT dead code (consumed by `platform.ts:13599`, `diagnostics.ts:2798`, `isApiResourcePressureHardBlock`). Leave or implement real caps — do not blind-delete.
   - Scanner-lease shedding under pressure (the other agent's finding).

## GIT / COORDINATION STATE
- `main` ahead of `origin/main` by 1: `3b1ab21 fix(gex,bars): cache chart GEX snapshot SQL + cap bars prewarm fan-out` (unpushed; user pushes).
- Earlier this session, LANDED to main (merged `f0c0ea0`, user pushed): #1/#5 signal-matrix memoization `8303221`, #6 client-events whitelist `549e10b`, #7 backtests-400 `27502bd`, #8 overnight RTH gate `851f5fe`.
- **The user-requested "remove memoization + bar-close gate" in `signal-monitor.ts` is SUPERSEDED** — `8303221` is NOT the freeze cause (the bar-cache is). The memoization can be left or removed separately; it is NOT the fix for the freeze.
- `signal-monitor.ts` carries the concurrent agent's UNCOMMITTED idle-status feature (`signalMonitorLatestBarAvailabilityStatus`) — quiet as of ~13min. ~50 other uncommitted WIP files (account, pyrus screens, api-zod codegen, ibkr).

## KEY FILES
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts` — the fix target.
- `docs/plans/bug-hunt-recovery-2026-06-23.md` — recovered bug-hunt findings (all 8 dispositioned).
