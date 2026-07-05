# Broker Connection UX — progress, success sequence, and card-native actions

Status: DRAFT for design review (2026-07-04). Owner: settings/broker area.
Scope: `artifacts/pyrus/src/screens/settings/` (SnapTradeConnectPanel.jsx and connect models),
shared animation primitives in `features/platform/PlatformApp.jsx` / `index.css`.

## Problems (from user + current-state audit)

1. Connection progress is fragmented: spinners on buttons, status text rows, and outcome
   banners live far from the broker card the user is acting on.
2. Action buttons (Connect / Sync / Open Portal / Continue login) sit in a shared panel area
   below the card grid instead of on the broker they belong to.
3. The "connected" green ring (BrokerChoiceButton, box-shadow) is static and appears with no
   acknowledgement moment; failures are text-only banners.
4. Popup-driven flows (IBKR Portal, OAuth) leave the popup dangling after success — the app
   knows it's connected (3s status poll) but never closes the popup or celebrates.

## Design

### A. Card-native actions (user request)
Move each broker's action buttons INTO its card footer. The card becomes the single surface:

```
┌──────────────────────────────┐
│ ◉ IBKR (Client Portal)   ✓  │  ← identity + status glyph
│ Stocks · Options · Futures   │  ← tradable asset types (Task #3 lands here)
│ 2 accounts · synced 12:04    │  ← connected metadata (or status microcopy)
│ ┌────────────┐ ┌───────────┐ │
│ │  Sync now  │ │ Disconnect│ │  ← contextual actions per state
│ └────────────┘ └───────────┘ │
└──────────────────────────────┘
```

Buttons are contextual to the card's lifecycle state (below). The shared panel area keeps
only cross-broker content (SnapTrade registration, global sync summary).

### B. One lifecycle, one visual grammar (all 4 connectors)
Map each connector model's states onto a shared visual state machine so IBKR Portal,
SnapTrade, Robinhood, and Schwab read identically:

| Lifecycle state | Mapped from | Ring | Motion | Actions on card |
|---|---|---|---|---|
| idle | not_connected / disconnected | hairline neutral | none | Connect |
| working | gateway_starting, registering, pending | accent **indeterminate arc** (conic-gradient rotating) | 1.2s linear rotation | Cancel |
| awaiting-user | needs_login, popup open, competing | accent arc, slow **breathing pulse** | 1.8s ease-in-out (reuse `ibkrStatusPulse`) | Continue login / Focus window |
| success (transient ~900ms) | first poll returning connected | arc sweeps to full circle → solid green | sweep 450ms ease-out-quart → glow pulse 300ms → checkmark stroke draw-in 300ms | (none — sequence) |
| connected | connected / synced | solid green ring + soft outer glow | 6s subtle sheen sweep (optional, low opacity) | Sync now · Disconnect |
| error (transient) | error / denied | amber flash, 2×2px shake 240ms | then settles to idle+error line | Retry |
| impaired | expired (Schwab 7-day), impaired | amber **dashed** ring | none | Reconnect |

- `prefers-reduced-motion`: all transient motion collapses to instant state swaps; rings stay.
- Success sequence also **closes the connect popup** the model opened (the model owns the
  window handle) — acknowledgement happens on the card, not in the abandoned popup. This also
  hides the IBKR post-login landing quirk while backend follow-up work settles.

### C. Implementation shape (incremental, no behavior change first)
1. `useConnectionLifecycle(connectorState) -> {phase, ring, actions[]}` — pure mapping,
   unit-testable, one per connector model (thin adapters).
2. `BrokerCardRing` component: SVG ring overlay (arc = stroke-dasharray on a circle; conic
   fallback not needed) replacing the box-shadow ring in `BrokerChoiceButton` (lines 370-424).
3. New keyframes co-located with existing ones (`premiumFlowSpin`, `ibkrStatusPulse` in
   PlatformApp.jsx): `brokerRingSweep`, `brokerRingGlow`, `brokerCheckDraw`, `brokerErrorShake`.
   Add motion tokens (`--motion-fast: 150ms; --motion-base: 300ms; --motion-slow: 600ms`,
   `--ease-out-quart`).
4. Move action buttons into cards; delete the now-empty panel button rows; keep SnapTrade
   registration flow in the panel (it is not per-broker).
5. Success sequence + popup close wired to the existing 3s status polls (IBKR: SnapTradeConnectPanel
   connectIbkrPortal loop; OAuth: outcome banner handlers).

Verify each step: `pnpm --filter @workspace/pyrus run typecheck`; visual pass via
`pnpm shot "https://$REPLIT_DEV_DOMAIN/?screen=settings" --wait-for [broker-grid-selector]`
in idle / working / connected states (state-forcing via model mock or QA hook if available).

## Out of scope
- Backend status semantics (unchanged).
- Header pill (`HeaderSnapTradeBrokerStatus`) — follow-up to adopt the same grammar.
- Per-broker asset-type DATA (Task #3 decides source/shape; the card reserves the line).
