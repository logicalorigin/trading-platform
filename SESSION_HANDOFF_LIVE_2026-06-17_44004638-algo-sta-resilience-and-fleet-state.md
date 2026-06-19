# LIVE HANDOFF — session 44004638 — algo/STA resilience + fleet coordination state

**Written:** 2026-06-17, just before a user-initiated container restart (app went into recovery: `healthz` HTTP 000, app processes dead, only Replit `pid2` supervisor alive).
**My uncommitted working-tree changes survive the container restart** (the repl FS persists) — verify them after reboot, don't lose them.

---

## ROOT CAUSE (the thing behind everything)
Shared **12-connection** Postgres ("helium") is saturated by slow `option_chain_snapshots` writes (**18–45 s** each), which hog a connection lane and starve the Node API. Cascade: algo page backoff/reload loop, idle monitor, stale signals, **API event-loop stalls**, and graceful **SIGTERM** supervisor restarts (NOT crashes/OOM — confirmed). Under this load the container just dropped into recovery mode.

There are **two distinct event-loop contributors**:
1. **DB-await latency** (the lane-hog) → fixed by the redesign (below).
2. **A synchronous ~8–11 s CPU block (`#7`)** → DB-independent (event-loop p95 stayed 8430 ms while DB latency fell to ~70 ms). A rebuild does NOT fix this.

---

## MY STAGED/DONE CODE CHANGES (uncommitted in working tree — verify, don't revert)
1. **PART 1 (done, vite-HMR-live):** `artifacts/pyrus/src/features/platform/PlatformApp.jsx` (~3285–3320). Added `lastSignalMonitorUniverseRef` high-water mark so `signalMonitorStateUniverseSymbols` doesn't collapse to empty during a `runtime-fallback` flap → SSE matrix stream URL stops churning → **stops the algo page backoff/reload loop**.
2. **#2 (done, in dist after restart):** `artifacts/api-server/src/services/automation.ts`. Added exported `applyDeploymentToListCache` (~line 304) + wired into `createAlgoDeployment`/`setAlgoDeploymentEnabled`/`updateAlgoDeploymentStrategySettings` (~525/578/670). Write-through keeps `deploymentListCache` coherent on saves → fixes **"old control inputs / deployment unavailable"** stale-fallback bug. Unit test added in `automation.test.ts`. **KNOWN GAP (same bug class, deferred):** the profile path `updateSignalOptionsExecutionProfile` (`signal-options-automation.ts:~17518`) also writes the deployment row — not fixed to avoid a circular import; fix by relocating the cache to a shared module.
3. **#6 (done, in dist after restart):** `artifacts/api-server/src/services/python-compute.ts`. Added `probeHealthOnce` (timed) + `reprobeIfDegraded` (fired from `getDiagnostics`) + refactored `waitForHealth`. Self-heals the **"Risk compute degraded"** false-stick after a transient boot-probe failure. Verified post-restart: python `/health` → ok:true.
4. **Bridge fix (subagent, done, HMR-live):** `artifacts/pyrus/src/features/platform/ibkrConnectionOperationStepperModel.js` (+ test). When the bridge is unreachable (HTTP 530/Cloudflare 1033), the launch stepper now settles to a non-animating "warning" instead of an infinite spinner. **Open follow-up:** the Deactivate/Detach button stays suppressed during a stale launch (only Cancel-launch is offered) — user may want Deactivate enabled on unreachable.

## NOTES I INJECTED FOR OTHER SESSIONS (cross-session files)
- `docs/plans/option-chain-upsert-latest-redesign-REVIEW-FIXES.md` — paste-ready fix for the 2 dual-write bugs (for ff8a6f9d).
- `SESSION_HANDOFF_LIVE_2026-06-17_option-chain-dual-write-blocking-fixes.md` — beacon for same.

---

## 🔴 CRITICAL LANDMINES (address first after reboot)
1. **Dual-write data-loss bug shipped UNFIXED.** Session **ff8a6f9d** added a Rust+Node dual-write (`option-metadata-store.ts:541–575`, `ingest.rs`) implementing the redesign's Phase 1 — and it went live in the last rebuild WITH 2 bugs:
   - **Bug 1:** intra-batch `ON CONFLICT` throw — `snapshotRows` not deduped by `optionContractId` before the `(optionContractId, source)` upsert → Postgres "cannot affect row a second time".
   - **Bug 2:** non-atomic dual-write — legacy insert + upsert are separate statements (not `db.transaction`); on upsert failure the catch arms durable backoff → **future option-chain writes silently suppressed**.
   - Harmless ONLY while no market data flows (`writeSuccess/Failure=0`, `marketDataMode=null`). **When the bridge/market data returns, it can silently stop saving option-chain data.** Fix (in the REVIEW-FIXES doc): dedup the upsert batch + wrap both writes in `db.transaction`. **Confirm `option-metadata-store.ts` has `db.transaction` before market data flows.**
2. **The redesign migration is safe to apply** (`lib/db/migrations/20260617_option_chain_latest.sql` — additive, lock-safe, reversible; history-drop verified safe). Applying it + fixing the 2 bugs is the real meltdown relief.

---

## TASK STATUS
- ✅ #1 PART1 · ✅ #2 deploy-cache · ✅ #6 risk-compute · ✅ #12 GEX moot (route already reads worker snapshot).
- 🔵 #3 signal-monitor transient-postgres backoff → **OWNED BY bca66aa5** (actively coding it). Don't edit `signal-monitor.ts`. Pattern: `createTransientPostgresBackoff` from `../lib/transient-db-error` (see `automation.ts:56` `deploymentListDbBackoff` usage).
- 🔵 #4 PART 2 per-timeframe bar backfill → signal-monitor lane (bca66aa5). QUARANTINED: signal-data semantics → needs adversarial review + user sign-off before landing.
- ⏳ #7 **~8–11 s synchronous event-loop freeze** → CONFIRMED still present after the rebuild (eventLoopDelayMs mean 5360 / p95 8430 ms, DB latency low). DB-independent CPU block. Candidates: `gex.ts` response-shaping (1053/1318) or `shadow-account.ts:12392` sort — both UNCHANGED in tree. **Was about to live-profile to pin the exact function when the app dropped into recovery.** Next: once stable, profile (SIGUSR1 inspector + CDP, or `--cpu-prof` restart) during a natural freeze; then chunk the hot synchronous pass. CONTESTED topic (4 sessions mention event-loop/gex) — claim `gex.ts`/`shadow-account.ts` before editing.
- 🟡 #8 diagnostics gaps (reset classifier blind to pressure in `runDevApp.mjs` heartbeat + "memory pressure" mislabel in `diagnostics.ts`) → in_progress, locations imprecise, low priority, `runDevApp.mjs` is startup-sensitive (run `pnpm run audit:replit-startup` if touched).
- 🔵 #9 root DB fix = upsert-latest redesign → **OWNED BY ff8a6f9d**. I reviewed it (verdict: safe-with-fixes). See landmine #1.
- ⏳ #10/#11 0b reclaim-held-connections / 0c partition `DB_POOL_MAX` → lower priority (redesign relieves the pool at the source); worker-lock files + `lib/db/src/index.ts`.

---

## FLEET MAP (4+ concurrent Claude sessions editing this repo)
- **44004638 (ME):** algo/STA resilience + reviewing others' work.
- **ff8a6f9d:** option-chain upsert-latest redesign (root DB fix) — owns `option-metadata-store.ts`, `ingest.rs`, the migration. Has the 2 dual-write bugs to fix.
- **bca66aa5:** signal-monitor (incl. #3 backoff).
- **597ef7e5:** PlatformApp.
- **d3be8676:** event-loop/gex mentions (idle-ish).
- **COORDINATION MODEL (user-confirmed):** I'm a *peer lane-owner*, not lead. The **user routes** cross-session messages — other sessions do NOT auto-read my file notes (verified: 0 references). **Never edit a file another session is actively modifying** — `git status --short <file>` first; if dirty/not mine, hand off via a note + tell the user.

## VERIFICATION TIMELINE (pre-recovery)
- restart #1: container survived; meltdown persisted (healthz 4.2 s, event-loop 1723 ms).
- rebuild/restart #2: healthz fast between freezes (12–46 ms) but event-loop p95 8430 ms (freeze worse/more frequent).
- → container dropped to **recovery** (healthz 000, app procs gone).

## IMMEDIATE NEXT STEPS AFTER CONTAINER RESTART
1. **Before market data flows:** confirm `option-metadata-store.ts` has `db.transaction` + dedup (dual-write fix landed). If not, do NOT let market data flow / get ff8a6f9d to fix it.
2. Apply the migration + deploy the (fixed) redesign → the real meltdown relief.
3. Verify my staged fixes: #2 (save a setting → controls reflect it, no stale), #6 (risk-compute healthy), PART 1 (algo loop stopped).
4. #7: live-profile to pin the synchronous freeze, then chunk it (coordinate on gex.ts/shadow-account.ts first).
5. Re-check the fleet (`git status`, session activity) — ownership may have shifted while the container was down.
