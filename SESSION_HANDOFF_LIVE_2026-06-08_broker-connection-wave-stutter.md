# Investigation — Broker Connection Sine-Wave Stutter / Frontend Lag

## Session Metadata

- Date: `2026-06-08`
- Repo Root: `/home/runner/workspace`
- Branch: `main`
- Request: "Front end is super laggy and unresponsive to scrolling and moving around." Refined
  by the user to: the **animated sine wave in the broker connection popover** stutters; it
  should move smoothly/fluidly. The wave lagging is a *symptom* — "it lags when the broker
  connection is bad." The errant change was made **today** (uncommitted/today's work).

## Success Criterion (user-defined)

- The broker-connection sine wave animates **smoothly and fluidly** again. That is the gauge
  of success; smooth wave == stable connection state + unblocked main thread.

## How the wave works (mechanism — observed in source)

- The wave is rendered by `IbkrPingWavelength` → `IbkrStatusWave` in
  `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx`.
  - Popover/header usage: `IbkrConnectionStatus.jsx:1467` and
    `HeaderStatusCluster.jsx:755` (`<IbkrPingWavelength connection=… tone=… />`).
- It is an **SMIL** animation: `<animate attributeName="points" dur={resolvedDuration}
  values={SINE_WAVE_VALUES} repeatCount="indefinite">` (`IbkrConnectionStatus.jsx:1319` and
  `:1336`).
- **SMIL interpolates on the main thread in Chrome.** Consequences:
  1. It **drops frames (stutters)** whenever the main thread is busy (long tasks).
  2. It **restarts** whenever `dur` changes, `active` toggles, or the element remounts.
- Wave speed (`dur`) is bucketed by ping:
  `resolveWaveDuration(connection, tone)` (`IbkrConnectionStatus.jsx:977`):
  - `ping = connection.lastPingMs`
  - `ping <= 180 → 0.9s`, `ping <= 650 → 1.45s`, else `2.15s`.
  - So `dur` flips (and the SMIL animation restarts) each time `lastPingMs` crosses 180 or
    650, or when the derived `streamState` toggles `active`.

The wave code itself is **unchanged since 2026-06-05** (commit `5ed27e8` "recognize attached
IBKR gateway with stale health"), which exists specifically to keep the connection status
*stable* so the wave does not flap. So the regression is not in the wave code — it is in the
**data and re-render cadence feeding it**.

## Root cause (today's change)

Documented in `SESSION_HANDOFF_2026-06-08_019ea765-6876-7d92-80df-62338c1ffa87.md`
("Broker Connection Repair", saved 09:06 MDT today). That session refactored the connection
popover so it is **"a view over warm session-derived broker state plus line usage,"** no
longer reading server-computed broad runtime diagnostics. It added a new client-side builder
`artifacts/pyrus/src/features/platform/ibkrConnectionSnapshot.js` →
`buildIbkrConnectionSnapshot`.

In `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx:2627`, that snapshot is
built with `nowMs: marketClockNow` and `marketClockNow` ticks **every 1000ms**
(`HeaderStatusCluster.jsx:2615` market-clock `setInterval`). Therefore:

- `gatewayBrokerSnapshot` → `gatewayPopoverModel` (and the connection/`streamState`/ping the
  wave consumes) is **recomputed every second** instead of read from a stable, server-computed
  diagnostic.
- The wave's SMIL subtree reconciles every second; any per-second change in derived
  `streamState`/`lastPingMs` flips `resolveWaveDuration`'s bucket or `active` → **restarts the
  animation** → visible stutter.
- When the broker connection is genuinely degraded, ping/`streamState` are erratic, so the
  bucket flips continuously → continuous restart. This is exactly "it lags when the broker
  connection is bad."
- Because SMIL is main-thread, the per-second rebuild (plus other per-second/5s work) also
  steals frame budget, compounding the stutter.

### Summary of the chain
`marketClockNow (1s)` → `buildIbkrConnectionSnapshot(nowMs)` (today) →
`gatewayBrokerSnapshot`/`gatewayPopoverModel` recomputed every second →
`connection.lastPingMs`/`streamState`/`active` may change → `resolveWaveDuration` bucket flips
→ SMIL `<animate>` restarts / drops frames → **sine wave stutters**.

## Secondary backend-data finding (separate, real, already fixed this session)

While investigating, found and fixed an unrelated payload bloat (kept — minor win, **not** the
wave cause):

- The uncommitted change to `getSession()` embedded the full
  `getIbkrBridgeActivationDiagnostics()` into `runtime.ibkr.activation`, including a
  50-entry `desktopAgentRequests[]` array not consumed by any frontend code.
- Measured `/api/session`: **18.4KB**, of which `activation` was **16.1KB** (the
  `desktopAgentRequests` array). `/api/session` is polled every 5s app-wide and reprocessed
  by the header each tick.
- Fix applied in `artifacts/api-server/src/services/platform.ts`
  (`sessionActivationDiagnostics()` helper) — drops `desktopAgentRequests` from the session
  embed (still available via `/api/diagnostics/runtime`). Verified live: session dropped to
  **~4KB** (−78%), activation to ~1.8KB (−89%).

## Broader context (from handoff `019ea765`)

The general scroll lag is also tied to **API resource pressure → frontend backoff + long
tasks**. Live probe this session: `/api/readiness` `pressureLevel: high`, driver
`api-latency:high:11378 ms`. Dominant slow route is **shadow account `positions`** (p95
~6.8s, max ~11.4s), with `ledger-bundle` (p95 ~4.6s) and `risk-build` (p95 ~2.8s) operations
behind it. `ledger-bundle` (`shadow-account.ts:3226`) still uses `staleStrategy: "never"` (it
blocks on rebuild every 10s TTL) unlike `positions` which was already moved to
`staleStrategy: "immediate"`. This is a candidate follow-up but is **separate** from the wave
stutter.

## Proposed fix (NOT yet applied — pending user confirmation)

Decouple the wave (ideally the whole connection snapshot) from the 1-second `marketClockNow`
rebuild and feed it a **stable** `streamState`/`lastPingMs`:

1. In `HeaderStatusCluster.jsx`, stop passing `nowMs: marketClockNow` into
   `buildIbkrConnectionSnapshot` for the wave path (or memoize the snapshot on stable inputs
   only — connection identity, streamState, lastPingMs bucket — not the raw 1s clock). Only the
   parts that truly need "now" (e.g., launch-activity countdowns) should depend on the clock.
2. Stabilize the wave input: derive `resolveWaveDuration`'s bucket from a debounced/last-stable
   `lastPingMs` so transient ping crossings don't restart SMIL.
3. (Optional, robustness) Consider isolating `IbkrStatusWave` in a `React.memo` boundary keyed
   only on `{state, durationBucket, color}` so parent re-renders cannot remount/restart it.

### Verification
- Open the broker connection popover under live data; the sine wave animates smoothly with no
  per-second jump/restart.
- DevTools Performance: no recurring long task / SMIL restart on the 1s cadence; wave frames
  steady.
- Confirm the wave still correctly changes speed/flat state on genuine connection state
  changes (healthy/quiet vs reconnecting/offline) — just without spurious restarts.
- `pnpm --filter @workspace/pyrus run typecheck` and the relevant
  `IbkrConnectionStatus`/`ibkrConnectionSnapshot` tests.

## Key files
- `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx` — wave (SMIL),
  `resolveWaveDuration` (977), `resolveIbkrStatusWaveProfile` (1054), `<animate>` (1319/1336).
- `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx` — `gatewayBrokerSnapshot`
  built with `nowMs: marketClockNow` (2627), market-clock 1s timer (2615), popover wave (755).
- `artifacts/pyrus/src/features/platform/ibkrConnectionSnapshot.js` — `buildIbkrConnectionSnapshot`
  (today's new builder; streamState at 126–130, `nowMs` usage at 48/163/204).
- `artifacts/pyrus/src/features/platform/streamSemantics.ts` — `canonicalizeStreamState`
  (handles `live→healthy`, underscore→kebab; not the bug).
- `artifacts/api-server/src/services/platform.ts` — `getSession()` + applied
  `sessionActivationDiagnostics()` payload fix.

## Status
- Root cause of the **wave stutter** identified (today's popover→session-derived /
  `marketClockNow` refactor). **No fix applied to the wave path yet** — awaiting user
  confirmation that this is the intended target before editing.
- Session-payload bloat fix applied + verified live (−78%).

## Continuation: startup task failure / signal-options deployment unavailable

### Observed
- User reported the Algo screen message:
  "Signal-Options Deployment Unavailable. No signal-options deployments are available yet.
  The default paper deployment should be seeded at startup."
- Live bounded probe showed `GET /api/algo/deployments` timing out/returning 500:
  - `.pyrus-runtime/flight-recorder/api-current.json` recorded
    `GET /api/algo/deployments` p95 ~30.4s and recent 500.
  - Manual `GET /api/algo/deployments` probe timed out at 8s against the old in-memory API.
  - Manual `POST /api/algo/signal-options/default-paper-deployment` returned 500 after ~30s
    before the patch.
- Process supervisor was not the failing task: API, Vite, Python compute, and
  `market-data-worker` were all alive.

### Root Cause
- The failing startup task is the API/default seed/read path for signal-options deployments,
  not Replit process startup.
- `src/index.ts` previously ran `ensureDefaultSignalOptionsPaperDeployment()` once at API
  startup and only logged if Postgres was unavailable; it did not retry.
- `GET /api/algo/deployments` was a bare DB read. Under transient Postgres pool/connection
  pressure it hard-failed with 500, so the UI could not see or repair the default paper
  deployment.

### Patch Applied
- `artifacts/api-server/src/services/automation.ts`
  - `listAlgoDeployments()` now:
    - detects existing signal-options deployments by config/name,
    - lazily ensures the default paper signal-options deployment when no visible
      signal-options deployment exists,
    - uses a short transient Postgres backoff,
    - returns cached deployments or `{ deployments: [], cacheStatus: "unavailable" }` on
      transient DB failure instead of 500.
- `artifacts/api-server/src/index.ts`
  - Added `ensureDefaultSignalOptionsPaperDeploymentWithRetry()`.
  - Startup seeding now retries transient DB failures with bounded backoff.
  - Signal Options, position tick, and overnight spot workers start immediately instead of
    waiting for a possibly 30s seed timeout.
- `artifacts/api-server/src/services/automation.test.ts`
  - Added focused tests for signal-options deployment detection and retired deployment
    filtering.

### Validation
- `pnpm --filter @workspace/api-server exec tsx --test src/services/automation.test.ts`
  passed.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/api-server run build` passed.
- `git diff --check -- artifacts/api-server/src/services/automation.ts artifacts/api-server/src/services/automation.test.ts artifacts/api-server/src/index.ts` passed.

### Follow-Up
- Running API process loaded old `dist/index.mjs`; normal Replit app restart is required for
  the live app to pick up this patch.

### Follow-Up Patch After Restart Check
- User restarted, then still saw a startup task failure.
- Observed after restart:
  - API/session was fast and IBKR bridge was present.
  - `GET /api/algo/deployments` still exceeded a 12s client budget.
  - `GET /api/algo/deployments?mode=paper` also exceeded a 12s client budget.
  - `/api/settings/ibkr-line-usage?detail=compact` was fast and reported one active IBKR line.
- Root cause refinement:
  - The first patch avoided eventual 500/retry loss, but the route could still wait too long
    for Postgres before the transient handler had a chance to return. That still fails the
    frontend startup task.
- Additional patch:
  - `artifacts/api-server/src/services/automation.ts` now uses single-flight loading plus a
    2.5s route budget for deployment listing.
  - If the DB read/seed exceeds the budget, the route returns cached deployments or
    `{ deployments: [], cacheStatus: "unavailable" }` quickly while the DB work continues in
    the background.
  - This prevents startup/UI calls from stacking behind the same saturated DB pool.
- Validation after the additional patch:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/automation.test.ts`
    passed.
  - `pnpm --filter @workspace/api-server run typecheck` passed.
  - `pnpm --filter @workspace/api-server run build` passed.
  - `git diff --check -- artifacts/api-server/src/services/automation.ts artifacts/api-server/src/services/automation.test.ts artifacts/api-server/src/index.ts` passed.
- Live status:
  - The running API process still predates the second patch. One more normal Replit app
    restart is required to load it.
