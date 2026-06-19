# LIVE Handoff — Signal Matrix staleness / STA "source unavailable" → event-loop starvation

- **Date:** 2026-06-17 (market open, ~mid-session MT)
- **Branch:** main
- **Why this exists:** container went into **recovery mode** mid-edit (`pnpm` returned
  `Transport endpoint is not connected`); user is restarting. Capturing exact state so work resumes
  cleanly.
- **Working-style note (user):** independent audit BEFORE building; fix one-at-a-time, most glaring
  blocker first; layman summaries; container caution. See memory `working-style-audits-and-increments`.

## User goal
Investigate why the **Signal Matrix / Signals table / Algo STA panel** is "not staying up to date."
User flagged the banner **"STA action source is currently unavailable. Failed source Cockpit,
State."** and asked to look for systemic causes (bad DB read/write routing, load-shedding under
pressure, split-brain across screens).

## Root cause (PROVEN live, market hours)
- **Node API event loop is jammed by synchronous CPU in 1–4s bursts.** Proof: `GET /api/healthz`
  (no DB/IBKR) took **0.5–3.8s**; `api.eventLoopDelayMs` mean 1.4s, p95/max 5.5–6.7s. **Postgres
  was IDLE during the jams** (`pg_stat_activity`: 0 active, 0 lock waits) → Node-side, NOT DB locks.
- Under the jam, `apiP95Latency` hit ~47s → resource pressure goes **"high"** → **PYRUS route
  admission sheds routes** (live HTTP **429 `api-resource-pressure-high`**, even on diagnostics).
  So `/signal-monitor/state` + cockpit + `signal-options/state` time out **together**.
- **The "mismatch":** the matrix table renders the last-known **SSE snapshot** (looks alive) while
  the STA health banner is computed from the **deployment-scoped `cockpit` + `signal-options/state`
  REST queries** (a DIFFERENT pipeline that times out) — NOT from the matrix that actually feeds STA
  rows (`algoHelpers.js:850-857`).
- **TWO distinct problems (don't conflate):** (1) event-loop CPU freezes — dominant CPU blocker NOT
  yet measured; (2) **DB pool saturation** (hard 12-conn cap) driving 28–51s shadow/account route
  latency — IO-bound, tied to the known `option_chain_snapshots` write contention.

## Independent audit FALSIFIED the first Track-B direction (verified in code)
- Shadow-account reads are **IO-bound VICTIMS, not CPU blockers**: `getShadowAccountPositions`
  `.map()` (`services/shadow-account.ts:8404-8662`) has **0 `await`s** — all heavy IO is awaited
  ABOVE it; account is a $25k paper acct (~5–50 positions). So yielding it would do nothing.
- Single-flight cache **already exists** (`withShadowReadCache` `shadow-account.ts:783`, 10s TTL).
- **Leading remaining CPU suspect:** `/signal-monitor/state` re-runs Zod `.parse` + `res.json` of
  the ~1.5 MB / ~3000-state payload on EVERY poll. (But freezes likely = aggregate small-op load,
  not one villain → Track B0 measurement still recommended for certainty.)

## DONE — Track A (UI mismatch fix), VERIFIED before container broke
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`: gated the false banner so it only
  fires on a genuinely empty matrix.
  - Change at the `sourceHealthBanner` declaration (~line 1702):
    `sourceHealth.degraded || sourceHealth.stale` → `(sourceHealth.degraded || sourceHealth.stale) && !staFilteredRows.length`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs`: added test
  `"STA source-health banner only fires on a genuinely empty matrix"`.
- ✅ Verified earlier: `tsx --test OperationsSignalTable.test.mjs` = 10/10 pass;
  `pnpm --filter @workspace/pyrus typecheck` clean.

## IN PROGRESS — Track B "no-regret serialize fix" (edits applied, TYPECHECK PENDING)
File: `artifacts/api-server/src/routes/signal-monitor.ts`. Both edits applied; tree is CONSISTENT
(no dangling old-name refs; `getCachedSignalMonitorState` had only one caller). Confirmed no custom
`json spaces/replacer/escape` settings, so `res.type("application/json").send(serialized)` is
equivalent output to `res.json(data)`.

- ⚠️ **TYPECHECK COULD NOT RUN** — `pnpm --filter @workspace/api-server typecheck` failed with
  `Transport endpoint is not connected` (the container recovery issue). **MUST run after restart.**

Exact changes (for recovery if the tree is lost):

1) Cache helper — was `getCachedSignalMonitorState` returning the object (re-parsed+re-stringified
   per poll). Now `getCachedSerializedSignalMonitorState` returns `Promise<string>`, validating +
   serializing ONCE per 1.5s fill:
```ts
const signalMonitorStateReadCache = new Map<
  string,
  { at: number; promise: Promise<string> }
>();

function getCachedSerializedSignalMonitorState(
  input: Parameters<typeof getSignalMonitorState>[0],
): Promise<string> {
  // ...same key/TTL/prune/evict logic...
  const promise = getSignalMonitorState(input).then((raw) =>
    JSON.stringify(GetSignalMonitorStateResponse.parse(raw)),
  );
  // ...set/catch-evict/return...
}
```
2) Route `GET /signal-monitor/state` (~line 240):
```ts
router.get("/signal-monitor/state", async (req, res) => {
  const query = GetSignalMonitorStateQueryParams.parse(req.query);
  const serialized = await getCachedSerializedSignalMonitorState({
    ...query,
    environment: resolveSignalSourceEnvironment(),
  });
  res.type("application/json").send(serialized);
});
```

## MUST-DO after container restart
1. `pnpm --filter @workspace/api-server typecheck` — confirm Track B compiles (was blocked by the
   container error; it's the only unverified step).
2. `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/OperationsSignalTable.test.mjs`
   — re-confirm Track A (should still be 10/10).
3. Restart api-server (rebuild) so the route change loads — **user controls restarts**.
4. Verify live: `/api/signal-monitor/state` latency drops, `api.eventLoopDelayMs.p95` improves,
   `healthz` < 50ms, matrix `updated_at` advances ≤ ~90s in market hours, STA banner no longer
   false-fires while matrix has rows.

## Working-tree files touched (this workstream)
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx` (Track A — DONE/verified)
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs` (Track A test — DONE/verified)
- `artifacts/api-server/src/routes/signal-monitor.ts` (Track B — edits applied, typecheck pending)

## Deferred / next
- **Track B0:** measure the true CPU blocker (labeled `appendRuntimeFlightRecorderEvent("api-event-loop-block",…)` spans around the state serialize / shadow IO / SSE, OR a one-shot `node --cpu-prof`) before any further backend change.
  - **MEASURED 2026-06-17 13:28 MDT (post-rebuild, Track B live).** No single dominant *sustained* CPU block remains: windowed `eventLoopP95Ms` ≈ 45–60 (was ~5500 pre-fix), `eventLoopMaxMs` ≈ 286–581, resource pressure `normal`/`watch` (was `high`+429-shedding). `/healthz` mostly <0.3s with rare bursts to ~1.67s. **Residual jam candidate = GC pressure** (RSS ~2.4–2.56 GB; `old_space` ~99% full at 855 MB; `heapUsedMb` swinging 627↔925 ⇒ active major GC), plus in-process `res.json()` serialize + array math on heavy routes (`/gex/:u/projection` ≈4.9s, `/bars` chart-visible). **Python-offload/bridge theory FALSIFIED:** the `pyrus_compute` sidecar (localhost:18768) is **running** + all lanes enabled (`PYRUS_PYTHON_*_ENABLED=1`), is **bridge-independent**, and its disabled-fallback returns an *empty* result (`account-portfolio-risk.ts:421-430`), not in-process compute — so a down sidecar would starve data, not block the loop. GEX does **not** use python-compute at all. IBKR bridge is `degraded` (separate concern; affects data freshness, not CPU). Track B's serialize-once is the high-value fix; remaining work is GC/memory, not a hot code path.
- **Problem 2:** DB-pool (12-conn) saturation + `option_chain_snapshots` write-batch fix
  (`MARKET_DATA_OPTION_CHAIN_WRITE_BATCH_SIZE=64` NOT applied; see `docs/plans/option-chain-snapshot-write-contention-fix.md`).
- **SSE stringify-once:** only on true broadcast streams (NOT the matrix delta path — payloads are
  per-subscriber, `signal-monitor.ts:6962-6968`); rework `serializeSseEventData` counters.
- Optional: same serialize-once pattern for `/signal-monitor/breadth-history` + `/events` (smaller; not done).

## Reference
- Plans: `~/.claude/plans/linear-foraging-breeze.md` (Track A+C, approved/done);
  `~/.claude/plans/track-b-event-loop-fix.md` (corrected after audit).
- Memory: `signal-matrix-staleness-failure-modes.md`, `option-chain-write-db-contention.md`.
- ibkr-perf sampler was STARTED (`POST /api/diagnostics/ibkr-perf/control {action:start}`); stop got
  shed by pressure; will stop on its own. Output: `.pyrus-runtime/flight-recorder/ibkr-perf-*`.

## Caveats
- Container in recovery (`Transport endpoint is not connected`) → Track B is hand-reviewed but
  **not typechecked**; treat unverified until step 1 above passes.
- Do NOT "fix" the NUL byte in `signal-monitor.ts` (deliberate `${symbol}\0${timeframe}` map-key
  delimiter).
