# Account-Data Speed + Loader/Boot Readiness — Plan & Findings (2026-06-11)

Consolidates three connected issues raised in this session, with exact change points and the decisions already made. Companion to `LOADING_LAUNCH_AUDIT_2026-06-11.md`. Findings verified against `main`.

**Decisions locked:**
- Stale-serve policy: **serve cached account data immediately + a small spinner (no text)**; swap to live when the bridge returns.
- Readiness scope: tighten **all 9** mere-visibility screens.

---

## 1. Why real account data is slow to display (root cause — confirmed)

The account-page data path is **bridge-first, never cache-first**:
- `GET /accounts/:id/positions` → `getAccountPositions` → `getAccountPositionsUncached` → `getLiveAccountUniverse` → `readLiveAccountUniverseUncached` → **`await listIbkrAccounts(mode)`** (live IBKR bridge), then a `Promise.all` of bridge-backed reads (`account.ts:4667,4836,1172,1184`).
- The frontend account page subscribes to the **account-page stream**, and its **first emit awaits the live bridge payload**: `subscribeAccountPageSnapshots` → `const snapshot = await fetchAccountPageLivePayload(input)` (`account-page-streams.ts:881`). Even `fetchAccountPageSnapshotPayload` awaits `fetchAccountPageLivePayload` (`:791`) — there is **no persisted-DB-snapshot-first path** today.
- The bridge governor caps **account concurrency 2 / orders 1 / health 1** with 15s backoff (`bridge-governor.ts:61`), so under contention these block tens of seconds — matching the 58–73s p95 measured earlier.
- The DB-persisted snapshot (`accountSnapshot` read/persist, `account.ts:266-267,881-893`) is only used as a **fallback on bridge error** (`getPersistedBackedAccounts`, `account.ts:1199`), not as a fast first paint.

**Net:** every account-page load (and the boot overlay that waits on `accountPrimaryFresh`) blocks on the slow bridge.

### Fix: cache-first / stale-while-revalidate first emit
1. In `subscribeAccountPageSnapshots` (`account-page-streams.ts:836`), **before** the live fetch, read the **persisted DB snapshot** (via the `account.ts` `accountSnapshot` read layer) and emit it immediately, tagged `stale: true` / `refreshing: true`, with its `asOf`. (The `stale` field already exists on payloads, e.g. `deferredShadowOrders` `:315`.)
2. Then run the existing live fetch; emit the fresh payload when it returns (already wired at `:881`).
3. If no persisted snapshot exists (first-ever load), fall back to the current bridge-first wait.
4. Frontend: render the cached payload immediately; show a **small spinner (no text)** whenever the payload is `stale`/`refreshing`; remove the spinner when fresh.

This makes real (recent) account data paint instantly and `accountPrimaryFresh` flip fast — which is the prerequisite for the readiness work below.

---

## 2. Boot overlay dismisses before data is fresh (readiness — rec 2)

The boot overlay is gated on the active screen's `primaryReady` (`PlatformApp.jsx:1342-1362`, overlay `!bootProgress.complete` `:~5825`). **Account/Algo already report real data-readiness** using the proven pattern:
`primaryReady = isVisible && (primaryStreamFresh || primaryFallbackReady)` — where `primaryFallbackReady` is a timeout safety-net (`AlgoScreen.jsx:405-427`, `AccountScreen.jsx:1420-1547`).

**9 screens still report mere visibility** → overlay dismisses before their data is fresh:
`MarketScreen:264`, `FlowScreen:4475`, `GexScreen:1720`, `TradeScreen:3561`, `SignalsScreen:3897` (`Boolean(active)`), `ResearchScreen:94`, `BacktestScreen:79`, `DiagnosticsScreen:756` (`diagnosticsVisible`), `SettingsScreen:3298` (`settingsVisible`).

### Fix: extract a shared, safe readiness hook + apply to all 9
1. Add `useScreenPrimaryReady({ isVisible, fresh, fallbackMs })` (mirrors `AlgoScreen.jsx:413-427`): returns `isVisible && (fresh || fallbackReady)`, where `fallbackReady` flips true after `fallbackMs` (guaranteed-dismiss safety net — **without it, a screen whose `fresh` never fires would hang the overlay forever**). Refactor Account/Algo onto it (no behavior change) to prove it.
2. For each data screen, pass its real primary-fresh signal: Market/Flow/GEX/Trade/Signals each have a primary stream/query — gate `fresh` on that (Trade's primary is the equity chart/quote stream; Flow/GEX on their primary stream; Signals on the matrix).
3. For lighter screens (Research/Backtest/Diagnostics/Settings), `fresh` = their main query/content settled (near-immediate); the timeout guarantees dismissal regardless.
4. **Do not** regress `bootPolicy.js` (Market intentionally blocks only on `session`; do not add `watchlists` back globally).

---

## 3. Other visibility/viewport gating (inventory for #2)
- **19 query `enabled` sites** gated on visibility (`enabled: isVisible/visible/pageVisible`) — these defer data until a screen/panel is visible, which is correct for off-screen panels but means a screen can report "visible" before its gated queries have even started. The readiness hook (#2) must gate on the query's freshness, not just `isVisible`.
- **Viewport-gated render**: `DeferredRender.jsx` + `ResearchChartSurface.tsx` use `IntersectionObserver` to defer heavy render until in-view — keep (good), but their loaders should reflect data state, not just in-view.

---

## 4. Sequenced implementation plan
1. **Account cache-first first-emit** (`account-page-streams.ts` + the `account.ts` persisted-snapshot read) — biggest user-visible win; makes data paint instantly.
2. **Small spinner on `stale`/`refreshing`** in the account page UI (no text).
3. **Shared `useScreenPrimaryReady` hook** + refactor Account/Algo onto it (no behavior change) + regression test.
4. **Apply the hook to the 9 screens**, gating `fresh` on each screen's real primary signal, timeout as safety net.
5. Verify: boot overlay dismisses only when primary content is shown; account page paints cached data instantly + spinner → live; no screen can hang the overlay (timeout proven per screen).

## 5. Risks / caveats
- **Stuck-overlay regression** is the top risk for #2/#4 — every screen MUST have the timeout fallback; add a test that asserts `primaryReady` becomes true within `fallbackMs` even if `fresh` never fires.
- Account/position data is trading-sensitive — serving cached data is display-only (decision: spinner, no actions gated); verify no order/trade path consumes the `stale` payload as authoritative.
- Implementation/deploy reliability has been the session-long blocker (shared git tree branch-flipping; verify on a clean `main` checkout, build, and a single restart).
