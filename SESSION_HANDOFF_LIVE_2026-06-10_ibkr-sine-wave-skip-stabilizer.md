# Live Session Handoff — IBKR Sine-Wave Skip Stabilizer (header)

- Last Updated (MT): `2026-06-10 (in progress)`
- Session ID: `claude:dcb9d3ed-2ba2-406c-9ed4-e272a7d12214` (Claude Code; container has no ~/.codex)
- CWD: `/home/runner/workspace`
- Branch: `main`
- Status: IMPLEMENTATION

## User Request
Pick up the first dropped session (Codex `019eb3df` — broker connection popover / latency),
grounded in the fixes made earlier today that improved lagging / latency / **sine-wave skipping**
in the header.

## Grounding (verified)
- The "sine wave" = IBKR status ping-wave: `IbkrStatusWave` / `IbkrPingWavelength` in
  `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx`. It is an **SMIL** `<animate
  attributeName="points" dur=… values=SINE_WAVE_VALUES repeatCount="indefinite">` (lines ~1303/1320).
- Diagnosis from `SESSION_HANDOFF_LIVE_2026-06-08_broker-connection-wave-stutter.md`: SMIL runs on
  the main thread and **restarts whenever `dur` changes, `active` toggles, or the element remounts**
  → visible "skip". `resolveWaveDuration` (IbkrConnectionStatus.jsx:961) buckets raw `lastPingMs`
  (≤180→0.9s, ≤650→1.45s, else 2.15s) so transient ping crossings flip `dur` and restart SMIL.
- That note proposed 3 fixes:
  - **#1 decouple snapshot from the 1s `marketClockNow`** — APPLIED (uncommitted) at
    `HeaderStatusCluster.jsx:2867-2897` (memo comment "feeds the SMIL ping wave"); NOT in HEAD.
  - **#2 stabilize the wave input (debounced/last-stable)** — NOT done → THIS SESSION.
  - **#3 React.memo isolate the wave** — NOT done; deliberately SKIPPED (callers pass inline
    `tone`/`style` objects so shallow memo wouldn't hold; #2 removes the restart vector).
- Tests are pure-fn `.test.mjs` (node:test + assert, no React renderer). No existing wave tests.

## Change (this session)
- NEW `artifacts/pyrus/src/features/platform/ibkrWaveMotionModel.js` — pure, timestamp-driven
  stabilizer: `advanceWaveMotion(state, incoming, nowMs)` commits a new `{animated,duration}` only
  after it holds unchanged for `WAVE_MOTION_DWELL_MS` (800ms); a flip back / new target before the
  dwell cancels the pending change, so sub-second jitter never reaches the SMIL `<animate>`.
- `IbkrConnectionStatus.jsx` — add thin `useStableWaveMotion(animated, duration)` hook driving the
  pure model; `IbkrStatusWave` now renders the **stabilized** `animated` + `duration` (single choke
  point → fixes popover ping, header lane waves, Algo signal table waves at once).
- NEW `ibkrWaveMotionModel.test.mjs` — deterministic dwell/jitter/reset/flat-normalize tests.

## Validation (done)
- `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/ibkrWaveMotionModel.test.mjs`
  = **6/6 pass**.
- `pnpm --filter @workspace/pyrus run typecheck` = **EXIT 0**.
- Frontend-only; HMR/refresh to load. Uncommitted in working tree.

## Next
1. Live-verify in browser under live data: open broker popover, wave animates smoothly with no
   per-second restart; DevTools Performance shows no recurring SMIL restart on the ping cadence;
   confirm the wave still changes speed/flat on genuine *sustained* ping/state changes (≥0.8s).
2. Commit alongside the already-applied fix #1 (HeaderStatusCluster snapshot memo) as a coherent
   "wave stutter" slice.
