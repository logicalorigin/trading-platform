# Findings: Signal Matrix doesn't pick up live SSE-pushed ticker signals

> Coordination note from a parallel agent (Claude). Verified from source + a live runtime probe on 2026-06-09 (after-hours). Read-only investigation — no signal source files were edited. Verify against your in-flight work before acting.

## TL;DR (the break)

The backend **evaluates signals from live Massive ticker data and emits them over an SSE stream**, but the **frontend signal matrix never subscribes to that stream** — it only REST-polls stored DB snapshots. So live, ticker-driven signal deltas never reach the matrix UI. Key formats match; this is a *missing subscription*, not a key/shape mismatch.

## Evidence

### Backend emits live (OBSERVED — source + runtime probe)
- Live Massive aggregate (AM) ticks feed signal eval: `signal-monitor.ts:3386` subscribes via `subscribeMutableStockMinuteAggregates(...)`; new ticks queue per-symbol eval batched at `SIGNAL_MONITOR_MATRIX_STREAM_FLUSH_MS = 150ms` (`signal-monitor.ts:331`, `:6273-6312`), evaluate from live stream bars (`:6121-6151`, `evaluateSignalMonitorMatrixStateFromStreamBars`), and emit `state-delta` events to subscribers (`:6153-6234`).
- SSE route is registered and functional: `GET /api/signal-monitor/matrix/stream` (`routes/signal-monitor.ts:162`) → `subscribeSignalMonitorMatrixStream(...)`, emits `bootstrap`, `state-delta`, `stream-status`, `error`.
- **Runtime probe** (`curl -N /api/signal-monitor/matrix/stream?environment=paper&symbols=SPY,AAPL,NVDA,TSLA,AMD&timeframes=1m,5m`) returned a `bootstrap` event with freshly-evaluated states (AAPL/AMD/NVDA/SPY, each with `currentSignalDirection`, `currentSignalAt`, `fresh`, `status`). (After-hours, so `status:"stale"` — but the stream itself is alive and would push deltas as ticks arrive in-session.)

### Frontend never subscribes (OBSERVED — source)
- Zero SSE consumers of the matrix stream in `artifacts/pyrus/src`: no `streamSignalMonitorMatrix`, no `state-delta`, no `EventSource` to `matrix/stream`. The only hit for `matrix/stream` is a display label string: `PlatformAlgoMonitorSidebar.jsx:1567` `loadingEndpoint="/api/signal-monitor/matrix"`.
- The matrix gets state **only via REST polling**: `useGetSignalMonitorState(...)` → `/api/signal-monitor/state` at `PlatformApp.jsx:3050`, `SignalsScreen.jsx:3206`, `SettingsScreen.jsx:879`. That endpoint returns stored DB snapshots, not the live-evaluated stream.
- `publishSignalMonitorSnapshot()` (`signalMonitorStore.js`) is fed only from the REST query result (`PlatformApp.jsx` ~5054), so the store only ever holds polled/stored data.

### Not a key mismatch (OBSERVED)
- Backend state key = `` `${symbol}:${timeframe}` `` uppercase (`signal-monitor.ts:5921`); frontend `signalMatrixStateKey` = same (`features/signals/signalMatrixStateMerge.js:15`). Timeframes (`1m,2m,5m,15m,1h,1d`) and direction (`null|buy|sell`) match. So once subscribed, deltas would map onto cells directly.

## Suggested fix direction (frontend-only)
Wire a live SSE consumer for the matrix:
1. Open `EventSource('/api/signal-monitor/matrix/stream?environment=…&symbols=…&timeframes=…')` (or `cells=…`) scoped to the active matrix cells.
2. Handle `bootstrap` (seed) + `state-delta` (merge) + `stream-status`.
3. Merge deltas into the signal store keyed by `symbol:timeframe` and feed `publishSignalMonitorSnapshot()` so STA bubbles/cells (and the downstream signal toasts) update live.
4. Keep REST `/api/signal-monitor/state` as the cold-start / fallback snapshot; let SSE drive live updates. Mind the existing matrix pressure/chunk caps when choosing scope (don't open an unbounded 500×6 live stream — scope to visible/active cells).

## Caveats / not verified
- Did not confirm `state-delta` emission *during market hours* (probe was after-hours; only `bootstrap` observed). Backend wiring strongly implies it, but worth a live in-session probe.
- The investigation read the working tree while it was being actively edited; line numbers may have shifted.
