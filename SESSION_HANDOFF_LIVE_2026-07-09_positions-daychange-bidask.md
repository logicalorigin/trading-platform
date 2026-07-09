# LIVE coordination — positions day-change / bid-ask vs the DB-pool/ELU pressure work

Owner: positions/shadow-account session (riley). For the agent working on DB-pool/ELU saturation (WO-P2 / `db-pool-elu-saturation-rootcause-plan`).

## Bid/ask latency is a symptom of your pressure work
The positions-table **Bid/Ask** column lags the **Spot** column. Root cause traced to the
persistent high resource pressure you're fixing:
- Spot (underlying) rides a persistent Massive **equity** websocket (`useRuntimeTickerSnapshots`)
  that is not route-admission-shed.
- Bid/Ask (option) needs server-side option-quote work (Massive OPRA aggregate → normalize →
  push via `/api/ws/options/quotes` + `bridge-option-quote-stream.ts`). Under pressure
  (DB pool 12/12 + ~44 waiting, ELU ~99%) that work is **shed/starved** (route-admission
  returned 429 on diagnostics probes), so bid/ask falls back to the slow path (3s REST /
  positions poll).
- Massive options realtime IS configured (`getMassiveOptionsRecency()` defaults `realtime`), so
  this is not a config gap.

**Success criterion to add to your pressure work:** on the account positions table, option
Bid/Ask should update at the same cadence as Spot once the pool/ELU saturation is resolved. I am
**not** making a conflicting route-admission-shedding change — leaving that to you.

## Changes I committed on `main` (so we don't collide)
- `17f9a8a8` — option-quote realtime freeze (future-tick clamp) + option-math fixes: `live-streams.ts`, `PositionsPanel.jsx`, `snapTradeAccountPanelModel.js`.
- `4dd80549` — prior-day shadow option $0 day change (`selectShadowPositionDayChange`): `shadow-account.ts`.
- `df70c38c` — mirror-repair idempotency + **day-change decoupled from pressure**: `shadow-account.ts`.

## Heads-up that touches YOUR area (shadow read fast path)
In `df70c38c` the **pressure fast-fallback** (`buildFastShadowPositionsResponse`) now runs a
**baseline-marks-only** `readShadowPositionDayChanges(..., { fetchMissingOptionQuotes: false })`
**only to bootstrap positions not yet in the last-known day-change cache** — once warm it adds
zero DB load. This was needed because the fast path blanked day change to $0 under sustained
pressure. If your pool work changes the fast-path contract, keep this bootstrap gated so it never
adds load when the cache is warm. We are both editing `shadow-account.ts` — coordinate merges.
