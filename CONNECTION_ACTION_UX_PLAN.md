# Connection-Action UX Audit → Implementation Plan

## Context

The platform has ~50 backend action endpoints (broker connect/disconnect, market data start/stop, scanner start/stop, order place/cancel, watchlist add/remove, settings save/reset, etc.) wired to ~15 UI surfaces that grew organically. The result is **five different ways to render "connected" status, three disabled-opacity values, two `Button` definitions, no Reconnect button when the gateway needs one, silent stream errors, no undo on destructive actions, and one modal with no Escape handler**.

Existing foundations are solid — `Button` (with loading variant), `Pill`, `Badge`, `StatusPill`, `PulseDot`, `Drawer`, `BrokerActionConfirmDialog`, a token system in `uiTokens.jsx`, and a toast context. They're just under-used and duplicated in places. The goal of this work is **one mental model for connection-action controls**, applied across every existing surface — no new surfaces.

## Scope

- **Full pass**: build 3 shared primitives, standardize labels and behavior across all existing surfaces, fix the 5 worst gaps.
- **No new surfaces** (the Live Actions drawer idea is dropped — existing header cluster already carries connection status).
- **Include high-leverage backend changes**: bridge state push, structured stream error codes, `lastActivityAt`.

---

## Phase 1 — Shared primitives

Three new components in `artifacts/pyrus/src/components/ui/`. Each replaces ad-hoc implementations spread across the app.

### 1a. `ConnectionStatusPill.jsx`
Drop-in for any connection lifecycle. Built on existing `StatusPill` from `components/platform/primitives.jsx`.

- Props: `status: "disconnected" | "connecting" | "connected" | "degraded" | "reconnecting" | "error"`, `lastSyncAt?: Date | string | null`, `size?: "sm" | "md"`, `label?: string` (override).
- Maps status → tone via existing `T.green` / `T.amber` / `T.red` / `T.accent` / `T.textDim` tokens; uses existing `PulseDot` for the dot.
- Renders "Updated 3s ago" subline when `lastSyncAt` provided (use existing relative-time formatter in `lib/formatters.js`).

### 1b. `ActionButton.jsx`
Unified imperative-action button. Built on existing `Button` (`components/ui/Button.jsx`) — adds:

- States: `idle | pending | error | cooldown` (driven by `pending`, `error`, `cooldownUntil` props).
- `pending`: shows existing `SpinnerIcon` + swaps label with `pendingLabel`.
- `error`: red border + inline `<RotateCcw>` retry chip on the right edge — no separate toast needed for "click again to retry".
- `cooldown`: disabled with a countdown chip; consumed from the new backend `cooldownMs` hint on backoff errors (Phase 4).
- Standardizes disabled opacity to a single value (pick 0.55 to match canonical `Button`); replaces ad-hoc 0.62 in `AlgoStatusBar.jsx`'s `compactButton()` and 0.68 in `IbkrConnectionLane`.

### 1c. `ConfirmDialog.jsx`
Generalized from existing `features/trade/BrokerActionConfirmDialog.jsx`. Keep all its current strengths (backdrop blur, red border for destructive, review-grid `lines`, error display, "Submitting…" state) and:

- Add Escape key handler and backdrop-click dismiss (current dialog has neither — `BrokerActionConfirmDialog.jsx:29`).
- Slots: `title`, `detail`, `lines`, `confirmLabel`, `confirmTone`, `pending`, `error`, `onConfirm`, `onCancel`, `destructive: boolean`.
- Use existing `Button` for confirm/cancel (current dialog uses raw `<button>` at lines 163, 182).
- `BrokerActionConfirmDialog` becomes a 10-line wrapper that pre-fills the destructive tone.

### 1d. Cleanups bundled into Phase 1
- **Delete the duplicate `Button`** in `components/platform/primitives.jsx` (around line 1053); update imports to use `components/ui/Button.jsx`.
- Remove the local `compactButton()` factory in `screens/algo/AlgoStatusBar.jsx:5` — replaced by `ActionButton size="sm"`.

---

## Phase 2 — Label and behavior standardization

Pick one verb set per action type and apply across every action surface from the audit:

| Action semantics | Verbs |
|---|---|
| Stateful long-lived connection (broker, gateway) | **Connect / Disconnect / Reconnect** |
| Process you start and stop (scanner, scan run, stream subscription) | **Start / Stop / Restart** |
| Boolean toggle that doesn't have a "process" feel (deployments, alerts) | **Enable / Disable** |
| Form mutation | **Save / Discard / Reset** |

Surface-by-surface changes:

- `screens/algo/AlgoStatusBar.jsx` — "ENABLE / PAUSE" → "Enable / Disable" (matches the boolean nature; "Pause" implied a process that this isn't). "RUN SCAN" → "Run scan" via `ActionButton` with `pendingLabel="Scanning…"`.
- `features/flow/FlowScannerStatusPanel.jsx` — already on "Start scan / Stop scan"; just swap the underlying `Pill` for `ActionButton` so pending state is visible.
- `features/platform/IbkrConnectionStatus.jsx` — keep status pill, but **add a Reconnect button** (see Phase 3).
- `screens/SettingsScreen.jsx` and the per-panel save/discard buttons — already on Save / Discard / Reset; just swap primitive to `ActionButton`.
- `features/trade/TradeOrderTicket.jsx`, `TradePositionsPanel.jsx` — keep "Submit order" / "Cancel" labels, swap to `ActionButton` for consistent pending state.

---

## Phase 3 — Five highest-impact UX fixes

Each uses the Phase 1 primitives.

### 3a. Gateway Reconnect button
**File:** `features/platform/IbkrConnectionStatus.jsx`
When `connected === false` or `strictReady === false`, render an `ActionButton` labeled "Reconnect" next to the `ConnectionStatusPill`. Wire to existing `POST /api/ibkr/bridge/attach` (`attachIbkrBridgeRuntime`, `routes/platform.ts:1234`). For activation-flow failures (no runtime to attach), navigate to the existing activation screen instead. This closes the loop where the UI currently says "Reconnect needed" but offers no action.

### 3b. Live-data stream error visibility
**Files:** `features/platform/live-streams.ts`, `features/platform/HeaderStatusCluster.jsx`
Currently SSE stream failures from `useIbkrQuoteSnapshotStream` and `useIbkrOptionQuoteStream` are silent. Add a shared `useLiveStreamHealth()` hook that aggregates last-error and last-event-age across active streams, and render a `ConnectionStatusPill` for "Live data" in the existing `HeaderStatusCluster` (no new surface — it slots into the existing cluster next to the bridge pill). Status transitions: `connected` (events flowing) → `degraded` (no events 15s+) → `error` (SSE error received). Backend changes in Phase 4 give this codes to act on.

### 3c. Toast undo for destructive actions
**Files:** `features/platform/platformContexts.jsx` (ToastContext), `features/platform/PlatformShell.jsx` (`ToastStack` ~line 1480), `features/platform/PlatformWatchlist.jsx`
Extend the toast spec with `action?: { label, onAction, timeoutMs }`. `ToastStack` renders an inline action button next to dismiss when present. Apply first to watchlist remove: optimistic remove + push toast `"Removed AAPL. Undo"` with a 10s timeout that re-adds the symbol via the existing `POST /api/watchlists/:id/items` endpoint if the action fires before timeout. Same pattern is reusable for any future destructive optimistic action.

### 3d. Run-scan pending feedback
**File:** `screens/algo/AlgoStatusBar.jsx`
Replace the local `compactButton()` for "RUN SCAN" with `ActionButton pendingLabel="Scanning…"`. Already covered by Phase 2 swap; called out separately because users specifically can't tell their click registered today.

### 3e. Confirmation for destructive non-broker actions
**Files:** `screens/algo/AlgoStatusBar.jsx`, `features/platform/PlatformWatchlist.jsx`, `screens/SettingsScreen.jsx` (and any settings panel with a Reset)
Wire `ConfirmDialog` to:
- Algo "Disable" *only when the deployment is currently live* (don't prompt when disabling an already-paused deployment).
- Watchlist bulk-remove (keeps existing selection UX; final action goes through confirm).
- Settings "Reset" buttons across panels.
For Algo Disable specifically: confirm copy notes that pending positions are unaffected, so the user knows what Disable actually does.

---

## Phase 4 — Backend changes

Three high-leverage server changes that unlock UI work above and remove polling.

### 4a. Push bridge state via existing diagnostics stream
**Files:** `artifacts/api-server/src/services/diagnostics.ts`, `artifacts/api-server/src/routes/diagnostics.ts`, `artifacts/ibkr-bridge/src/tws-provider.ts`
The bridge already maintains a health snapshot (`BridgeHealthSnapshot`). When its `connected`, `authenticated`, `socketConnected`, `serverConnectivity`, or `marketDataMode` fields change, emit a `bridge-state` event on the existing `/api/diagnostics/stream` SSE channel. Client `useBridgeConnection` hook listens and updates instead of polling `/api/broker-connections`. Saves a polling loop and makes the new `ConnectionStatusPill` truly real-time.

Add a derived **`connecting`** state to the snapshot: `connected === false && lastAttemptAt within 5s && lastError === null`. Currently the UI has to infer this; surfacing it explicitly lets the pill render the right intermediate state.

### 4b. Structured stream error codes
**File:** `artifacts/ibkr-bridge/src/app.ts` (lines 131–143, capacity error handling)
Today stream errors are pattern-matched on `error.message`. Replace with a structured `code` field on the SSE `error` event:
- `lane_queue_full` (was "lane queue is full")
- `subscription_limit` (was "max number of tickers" / "ticker limit" / "subscription limit")
- `bridge_unauthorized`, `bridge_unreachable`, `bridge_auth_failed`, `bridge_no_accounts`

Include `cooldownMs` when applicable so the new `ActionButton` cooldown chip has something to display.

### 4c. `lastActivityAt` on broker connection
**Files:** `artifacts/api-server/src/services/platform.ts`, `artifacts/ibkr-bridge/src/service.ts`
Add `lastActivityAt: ISO string | null` to the broker connection payload — the timestamp of the last successfully received event/quote/tickle. Feeds the `lastSyncAt` prop of `ConnectionStatusPill` so users can tell "stale" apart from "never connected."

---

## Files to be modified

**New:**
- `artifacts/pyrus/src/components/ui/ConnectionStatusPill.jsx`
- `artifacts/pyrus/src/components/ui/ActionButton.jsx`
- `artifacts/pyrus/src/components/ui/ConfirmDialog.jsx`
- `artifacts/pyrus/src/features/platform/useLiveStreamHealth.ts`

**Modified (existing patterns reused):**
- `artifacts/pyrus/src/components/platform/primitives.jsx` — remove duplicate `Button`; keep `Pill`, `Badge`, `StatusPill`, etc.
- `artifacts/pyrus/src/components/ui/Button.jsx` — no API change; `ActionButton` composes it.
- `artifacts/pyrus/src/features/trade/BrokerActionConfirmDialog.jsx` — shrink to wrapper over `ConfirmDialog`.
- `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.jsx` — pill + Reconnect button.
- `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx` — slot in live-data pill.
- `artifacts/pyrus/src/features/platform/live-streams.ts` — emit health events.
- `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx` — undo toast.
- `artifacts/pyrus/src/features/platform/platformContexts.jsx` — toast `action` field.
- `artifacts/pyrus/src/features/platform/PlatformShell.jsx` — ToastStack renders action.
- `artifacts/pyrus/src/screens/algo/AlgoStatusBar.jsx` — labels, ActionButton, confirm on Disable.
- `artifacts/pyrus/src/features/flow/FlowScannerStatusPanel.jsx` — swap Pill for ActionButton.
- `artifacts/pyrus/src/screens/SettingsScreen.jsx` + settings panels — confirm on Reset.
- `artifacts/api-server/src/services/diagnostics.ts` — `bridge-state` event.
- `artifacts/api-server/src/services/platform.ts` — `lastActivityAt` field.
- `artifacts/ibkr-bridge/src/tws-provider.ts` — derive `connecting`, emit on change.
- `artifacts/ibkr-bridge/src/app.ts` — structured error codes.
- `artifacts/ibkr-bridge/src/service.ts` — track `lastActivityAt`.

For test files, mirror existing `*.validation.ts` next to each modified service; the pyrus side follows the same `*.validation.js` convention seen in `positionDisplayModel.validation.js`.

---

## Implementation order

1. Phase 1 primitives (no functional change yet, just shared building blocks).
2. Phase 4 backend changes — UI consumes them in Phase 3, so backend should land first.
3. Phase 2 label/behavior standardization — mechanical pass once `ActionButton` exists.
4. Phase 3 high-impact fixes — depends on 1, 2, and 4.

Each phase is independently verifiable and can ship as its own commit/PR.

---

## Verification

Per phase:

1. **Phase 1**: `pnpm --filter pyrus typecheck` + unit tests for the three new components (snapshot of each state — idle/pending/error/cooldown for `ActionButton`; disconnected/connecting/connected/degraded/reconnecting/error for `ConnectionStatusPill`; open/closed/Escape/backdrop for `ConfirmDialog`).
2. **Phase 4**: `pnpm --filter @workspace/api-server test` + `pnpm --filter @workspace/ibkr-bridge test`. Manually subscribe to `/api/diagnostics/stream` (curl or browser) and verify `bridge-state` events fire when the bridge transitions. Verify SSE error event now carries `code` and `cooldownMs` (force a capacity error in dev).
3. **Phase 2**: visual diff — start dev (`pnpm run dev` per artifact, or the standard Replit App run); confirm every action surface in the audit reads consistently. Type check.
4. **Phase 3**: end-to-end manual tests:
   - Kill the bridge process → header pill goes `connected` → `degraded` → `error`; Reconnect button appears in `IbkrConnectionStatus`; clicking it calls `attachIbkrBridgeRuntime`; pill returns to `connected`.
   - Remove a watchlist symbol → toast appears with "Undo"; click Undo within 10s → symbol returns; let toast expire → symbol stays removed.
   - Click "Run scan" → button shows spinner + "Scanning…" until result arrives.
   - Click "Disable" on a live algo deployment → confirm dialog appears; Escape closes it; confirm proceeds.
   - Open `BrokerActionConfirmDialog` (any order flow) → Escape now dismisses it (regression check).

Cross-cutting:
- `pnpm run audit:replit-startup` if any artifact dev command changes (none expected, but defensive).
- a11y spot-check: tab order through each modified action surface; `aria-label` on the new pulse dots; focus returns to the trigger after `ConfirmDialog` closes.

---

## Out of scope

- New surfaces (no Live Actions drawer; existing header cluster carries the new status pill).
- Replacing the toast system — only extending it with an `action` field.
- Command palette / global hotkey system — separate initiative.
- Granular activation-flow progress (backend gap from the audit) — deferred; the Reconnect button covers the most common recovery path.
- Lane-pressure broadcast to clients (audit gap) — deferred.
