# SESSION HANDOFF (LIVE) — Pool-contention / STA "degraded|stale" banner / launch-hang

- **Date/time:** 2026-06-16 (updated by recovery session continuing pane 2)
- **Runtime:** Claude Code recovery session (CWD `/home/runner/workspace`)
- **Provenance:** Reconstructed from screenshot `samples/6-16 reconect lost sessions.png` (pane 2) after a Replit container restart dropped the original multi-pane Claude session. Sibling dropped workstreams: signals scan-deprecation (`SESSION_HANDOFF_LIVE_2026-06-16_signals-scan-deprecation-audit.md`), broker-connection UI audit (`BROKER_CONNECTION_UI_AUDIT_2026-06-16.md`). **Scope: pool-contention workstream ONLY.** Do NOT touch broker-connection UI (HeaderStatusCluster/AccountScreen/IbkrConnectionStatus), signals scan-deprecation (signal-monitor / trade(now signal-monitor-evaluation)-worker), or signal-threshold-rescale (thresholds.js) — other agents own those.

---

## GROUNDING (re-verified against source 2026-06-16) — observed / inferred / unknown

### A. The STA banner is NOT driven by pg pool contention — CORRECTED
The recovered note's central claim ("banner == DB pool contention, same root cause as slow load + launch hang") is **NOT supported by source.** Corrected chain, all OBSERVED:

1. **Frontend banner** rendered by `OperationsSignalTable.jsx` (`role="status"` amber, ~lines 2040-2085); copy "STA action source is currently unavailable." (~line 1691). Shows when `sourceHealth.degraded || sourceHealth.stale` (~line 1689). — observed.
2. `sourceHealth` = `staActionSnapshot.sourceHealth` (`AlgoScreen.jsx:747`), from `resolveStableStaActionSnapshot({cockpit, signalOptionsState, cockpitFailed, signalOptionsStateFailed})` (`AlgoScreen.jsx:726-740`). — observed.
3. `resolveStableStaActionSnapshot` (`algoHelpers.js:463-516`): builds a snapshot per source; `chooseStaActionSourceSnapshot` (`:439-447`) picks one with `hasRows && !transient`. If NONE qualifies, falls to the `source:"empty"` branch (`:503-515`) which sets `stale=Boolean(staleSources.length)`, `degraded=Boolean(failedSources.length||staleSources.length)` → **banner fires.** — observed.
4. A source is `transient` (`algoHelpers.js:415-422`) when `record.stale===true || record.degraded===true || record.refreshing===true || cacheStatus==="stale" || reason.includes("timeout") || reason.includes("cache")`. — observed.
5. **Backend stamps `cacheStatus:"stale"` + `degraded:true` + `stale:true` on the NORMAL fast-summary path** whenever `preferStoredMonitorState` is true — `withSignalOptionsCacheMetadata` (`signal-options-automation.ts:9570-9592`, `degraded: cacheStatus==="stale" ? true : ...`), set at `:10265-10266` (`cacheStatus: !preferStoredMonitorState && !signalRefreshFailed ? "hit" : "stale"`). The `/signal-options/state` route defaults `refreshSignals=false` → `forceFreshSignals=false` → `preferStoredMonitorState=true` → **`cacheStatus:"stale"` on the default read.** reason string `signal_options_state_summary_fast_signal_state` also contains "cache"-adjacent text; reasons like `..._refreshing` / `..._stale_cache` match `reason.includes("cache")`. — observed.
6. **Source carrying the transient flags = `signalOptionsState` (the `/algo/deployments/:id/signal-options/state` payload), NOT cockpit.** `buildAlgoDeploymentCockpitPayload` return (`signal-options-automation.ts:10432-10489`) does NOT spread `...state` and does NOT place `degraded`/`stale`/`cacheStatus` at top level — it only spreads `state.signals`/`state.candidates`/`state.risk`/etc. So `cockpit.degraded`/`cockpit.stale`/`cockpit.cacheStatus` are undefined (unless route-admission injects them — see C, which never fires for cockpit). The `/signal-options/state` route (`routes/automation.ts:216-229`) returns the bare `state` which DOES carry top-level `cacheStatus:"stale"`/`degraded:true`/`stale:true`. — observed.
7. **Pool saturation (`waiting>0`) is NEVER consumed by the pressure model, route-admission, or the banner.** `grep` for `getPoolStats`/`waitingCount`/`.waiting` in `resource-pressure.ts` and `route-admission.ts` = empty. `updateApiResourcePressure` inputs (`diagnostics.ts:2672-2685`) = rss, heap%, request p95, dominant-slow-route p95, event-loop delay, clientLevel, cache-**occupancy** level, automation long-scan count — NO pool-waiting input. — observed.

**Corrected root cause of the banner:** it is a **cache-freshness signal** (the `/signal-options/state` payload is stale-stamped on the default stored-monitor-state path), NOT a pg-pool-contention signal. Pool contention could *co-occur* (a slow DB read lengthens the window during which stale cache is served), but the banner does not read pool state. Forcing the fan-out cap / worker-connection fix to "fix the banner" is not justified by evidence.

### B. The `cacheStatus === 'unavailable'` full-screen branch is genuinely DEAD — confirmed (with correction)
- Frontend full-screen "Signal-Options Deployment Data Unavailable" lives in `AlgoLivePage.jsx` `EmptyOperationsState` (~lines 76-89), gated `deploymentsQuery.data?.cacheStatus === "unavailable" && !deployments.length` (`AlgoScreen.jsx:511-515`). — observed.
- This is the **deployments-LIST** payload (`/algo/deployments`), NOT the cockpit (recovered note conflated them). — corrected, observed.
- Backend `listAlgoDeployments` cache (`automation.ts`): type allows `"hit"|"stale"|"unavailable"` (`:64`) but code only ever sets `"stale"` (`:264`, `:276`) or `"hit"` — **never `"unavailable"`.** `grep cacheStatus...unavailable` over `artifacts/api-server/src` (non-test) = only TYPE decls (`automation.ts:64`, `high-beta-universe.ts:131`), zero assignments. Branch is dead. — observed.

### C. route-admission `degraded`/`stale` do NOT reach the cockpit banner — confirmed
- `resolveApiRouteAdmission` sets `degraded:cacheOnly||shed`, `stale:cacheOnly||shed` (`route-admission.ts:381-382`). `cacheOnly`/`shed` come from `routeAdmissionAction` (`:168-215`) which only sheds for QA-safe-mode classes or `pressureLevel==="high"` + `decorative`/`deferred-analytics`/`background-maintenance`. — observed.
- The cockpit route `/^\/algo\/deployments\/[^/]+\/cockpit$/` classifies as **`active-screen`** (`:312`); `/signal-options/state` also `active-screen` (`:313`). `active-screen` is NEVER shed → admission `degraded/stale=false` → `withRouteAdmissionMetadata` injects nothing. — observed.

### D. Worker advisory locks — both already use `pool.connect()` (NOT a `db` pooled query), but still draw from the SHARED pool and hold it for the whole tick
- `signal-options-worker.ts:71-133` `acquirePostgresAdvisoryLock`: `pool.connect()` (`:72`), `begin` → `select pg_try_advisory_xact_lock($1)` (`:97`) → returns release closure → in the tick (`:182-228`) the lock is acquired BEFORE `runMaintenance` (`:189`) and released in `finally` (`:219`), so the pooled client is **held for the entire maintenance run.** — observed.
- `overnight-spot-worker.ts:198-258` identical pattern (`pool.connect()` `:199`, lock `:223`, held across scan). — observed.
- These are NOT on a dedicated out-of-pool `pg.Client`; they consume 1 shared-pool slot each for the tick duration. — observed. Whether this materially starves the `max:12` (helium) / `10` pool is **unknown** without runtime evidence (flight-recorder `api-db-pool-pressure` events / `apiDbPoolWaiting`).

### E. Already-implemented items from the recovered "fix set" (do NOT redo)
- **Observability hook (#3 / deliverable #2): DONE & committed** (commit `a445b90` + later). `getPoolStats()` `lib/db/src/index.ts:78-107` (max/total/idle/active/waiting). Wired to flight-recorder heartbeat `dbPool: getPoolStats()` (`runtime-flight-recorder.ts:416`) + dedicated `recordDbPoolPressureIfNeeded()` (`:495-529`) emitting `api-db-pool-pressure` when `waiting>0` + diagnostics surface `apiDbPoolWaiting/Active/Total/Max` (`:685-692`). The comment at `:499-502` ties it to correlating a "degraded/stale cockpit banner" with real pool contention. — observed.
- **Cache the deployments list: DONE.** `deploymentListCache` (`automation.ts:73`), `readDeploymentListCache` (`:257-282`). — observed.
- **Pool sizing: DONE** (helium `max` 6→12, `lib/db/src/index.ts:35-45`, commit `a445b90`). — observed.

---

## EDITS THIS SESSION
1. **Rebuilt `lib/db` TypeScript declarations** (`npx tsc --build lib/db/tsconfig.json --force`). The committed source `getPoolStats` (`lib/db/src/index.ts:97`) was AHEAD of the stale local `lib/db/dist/index.d.ts` (dated Jun 1, before `getPoolStats` existed). api-server resolves `@workspace/db` via TS **project references** (`artifacts/api-server/tsconfig.json:9-12` → `lib/db`), which read the compiled `dist/*.d.ts`, NOT `src`. So `tsc -p ... --noEmit` (the typecheck command — not `tsc -b`) failed: `error TS2305: Module '"@workspace/db"' has no exported member 'getPoolStats'` at `runtime-flight-recorder.ts:14`. Rebuild regenerated `dist/index.d.ts` to export `getPoolStats`+`PostgresPoolStats`.
   - `lib/db/dist` is **gitignored** → **zero tracked changes**, no source edits, declaration-only emit, no runtime impact. This is build-artifact hygiene, not a behavior change.
   - NOTE for future sessions: a clean checkout / `tsc -b` would regenerate this automatically; the failure was a stale local artifact.

**No source/behavior edits were made.** The fan-out cap and worker dedicated-connection behavior changes were intentionally NOT implemented — grounding (section A) shows the banner is not pool-driven, so forcing them is unjustified by evidence (per task rule: if grounding contradicts the theory, stop after instrumentation and report the corrected cause).

## VALIDATION
- `PYRUS_ALLOW_HOT_VALIDATION=1 pnpm --filter @workspace/api-server run typecheck` → **PASS (exit 0)** after the `lib/db` rebuild. (The validation guard refuses while the live runtime is hot; override used for a read-only `--noEmit` typecheck only — no runtime impact.)
- No artifact dev-script / startup / DB-startup-config edits → `audit:replit-startup` not required.

## REMAINING WORK / OPEN QUESTIONS
- **Decide the banner fix at product level (NOT a pool fix):** the STA banner fires on routine cache-staleness because `/signal-options/state` is stale-stamped on the default stored-monitor-state read (`signal-options-automation.ts:10266`). If the banner should mean "data genuinely unhealthy" (not "served from stored monitor state"), the fix is in the stale-stamping / frontend `transient` heuristic (`algoHelpers.js:415-422`), NOT in pool sizing/fan-out/worker locks. NEEDS USER DECISION — out of the original (mis-scoped) fix set.
- **Fan-out cap (#2) and worker dedicated-connection (#3):** only pursue if runtime flight-recorder evidence (`api-db-pool-pressure` events, `apiDbPoolWaiting>0` in `.pyrus-runtime/flight-recorder/api-current.json`) shows the pool actually saturating under the dashboard fan-out / worker ticks. The instrumentation to confirm this is already live; watch it during a slow load / launch hang. Without that evidence these remain unjustified.
- If pursued later: a true dedicated worker connection = a standalone `pg.Client` (importable via `pg` from `@workspace/db`) instead of `pool.connect()`, so the worker lock never consumes a shared-pool slot. Sites: `signal-options-worker.ts:71-133`, `overnight-spot-worker.ts:198-258`.

## REMINDER
- Restart is **USER-controlled.** The `lib/db` declaration rebuild affects only typecheck; there were no runtime/source changes, so **no api-server restart is needed for this session's work.** (Any future behavior change WOULD require a user-controlled api-server restart to take effect.)
- Do NOT commit (per task).
