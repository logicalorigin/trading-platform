# Market Screen Redesign — Detailed Plan (rebuilt 2026-06-26)

> **Provenance.** Rebuilt after a Replit container reset dropped Claude session
> `c3030a2e-3cae-461e-b7e8-b52439aec3a0`, which had authored this plan in the now-wiped
> `~/.claude/plans/encapsulated-sprouting-cake.md`. The verbatim original is unrecoverable
> (transcript + plan file wiped with `~/.claude/`). This is a faithful reconstruction from the
> surviving activity log + a fresh re-exploration of the codebase, with two confirmed decisions:
> **(1) hero = Universe overview**, **(2) charts stay first-class**. Stored in the repo (not
> `~/.claude/`) so the next reset can't drop it.

## Goal

Redesign the **Market** overview page (`artifacts/pyrus/src/screens/MarketScreen.jsx`, route id
`"market"`) so it **leads with a scannable market-universe hero** (table/heatmap: breadth +
movers + flow heat), keeps the **multi-chart grid first-class**, and demotes the current
pulse/sector/leadership/news stack into tighter supporting rails and click-through drill-downs.

Success = the page answers "what's the market doing and what's worth pulling up a chart on?"
in the first screen, without scrolling, using data that already exists.

## Confirmed intent (from interview + recovery)

- **Working surface, first screen of the session.** Density and at-a-glance scanning matter more
  than marketing polish.
- **Hero focus: Universe overview** — a ranked, scannable universe table/heatmap is the top band.
- **Charts stay first-class** — the multi-chart grid is not removed or buried; it sits directly
  under the hero and remains the primary action surface.
- Gamma/flow becomes **supporting context + drill-down**, not the hero.

## Current state (re-explored 2026-06-26)

Entry: `MarketScreen.jsx` → `MarketScreenInner` (lines 215–1316); routed in
`PlatformScreenRouter.jsx:120-146`. Render order today:

1. **Multi-chart grid** — `features/market/MultiChartGrid.jsx` (+ `MarketChartCell.jsx`,
   `MarketChartPremiumFlowIndicator.jsx`). Layouts 1x1/2x2/2x3/3x3, resizable, localStorage state.
2. **Market Pulse cards** (4): breadth, put/call, vol proxy, sector flow (`MarketScreen.jsx:731-785`).
3. **Sector Flow panel** — `useMarketFlowSnapshotForStoreKey()` → `sectorFlow` (787-893).
4. **Leadership/Weakness** — computed from reference constants (895-949).
5. **Lower grid**: Rates Proxies / Breadth / Market Read (952-1090).
6. **News & Calendar** — `useGetNews()`, `useGetResearchEarningsCalendar()` (1092-1312).

**Known weaknesses to fix in passing** (do not expand scope beyond these):
- `MarketActivityPanel.jsx` (1379 lines) exists but is **rendered nowhere** — dead/incomplete.
- No universe-wide movers table; "Leadership" is built from hard-coded constant lists, not the
  live `/api/flow/universe` ranking.
- Empty/blank cards (News with no provider; Calendar when research off) stack awkwardly.
- Layout breakpoints are hard pixel jumps (`dim(1080)`, `dim(980)`).

## Available data (already exists — no backend work required for v1)

| Need | Hook / endpoint | Key fields |
|---|---|---|
| Universe rows + ranking | `useGetFlowUniverse()` → `GET /api/flow/universe` (`services/flow-universe.ts`) | ranked `symbols[]`, `coverage`, flowScore, dollarVolume, liquidityRank, verified |
| Per-symbol quotes | `useGetQuoteSnapshots(symbols)` → `GET /api/quotes/snapshot` | price, change, changePercent, volume, freshness, source |
| Sparklines (batch) | `POST /api/bars/batch` with `shape:'sparkline', pointLimit:48` | 48-pt close series per symbol |
| Live price/volume | `useMassiveStockAggregateStream` → `GET /api/streams/stocks/aggregates` (SSE) | streaming OHLCV per symbol |
| Aggregate flow heat | `useListAggregateFlowEvents()` → `GET /api/flow/events/aggregate` (10s) | per-symbol calls/puts/premium, `tickerFlow`, `putCall`, `sectorFlow` |
| GEX per symbol | `useGetGexDashboard(sym)` / `useGexProjection` → `GET /api/gex/{sym}` | netGex, flowContext.bullishShare, zero-gamma |
| Runtime sync cache | `runtimeMarketDataModel.js` (`syncRuntimeMarketData`) | sym, price, chg, pct, volume, spark, sparkBars |

## Reusable primitives (reuse, do not reinvent)

From `components/platform/primitives.jsx` + `signal-language/`:
- **`DenseVirtualTable`** (`components/platform/DenseVirtualTable.jsx`, 32px rows, virtualized,
  reorderable) — backbone of the universe hero table.
- **`MicroSparkline`** — trend line primitive for direct composition with row values.
- **`ScoreBar`** (red↔neutral↔green heat) and **`MetricChip`** / **`StatusPill`** / **`Badge`**.
- **`Card`** / **`SurfacePanel`** (`surfaceStyle()`), **`DataUnavailableState`**, **`Skeleton`**.
- **`SegmentedControl`** / **`InlineFilterBar`** for the hero's sort/filter controls.
- **`RadialStrokeGauge`** for breadth %.
- Tone: **always** route color through `semanticToneModel.js` (`toneForFinancialDelta`,
  `toneForDirectionalIntent`) and `signal-language/tones.js` — never hard-code.
- Format: `lib/formatters.js` (`formatQuotePrice`, `formatSignedPercent`, `fmtCompactNumber`,
  `fmtM`, `formatRelativeTimeShort`).

## Proposed layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MARKET   [breadth gauge] [put/call] [vol]   Sort:[Flow|%|Vol|α] 🔍filter │  ← HERO BAND (sticky)
├─────────────────────────────────────────────────────────────────────────┤
│ UNIVERSE  ▸ ranked, scannable, virtualized (DenseVirtualTable)            │
│  SYM   Price    Chg%    Vol     Flow heat        Spark        GEX         │
│  SPY   612.40  +0.82%   88.1M   ███▌ +$2.1M ↑    ╱╲╱‾        +netγ       │  ← click row →
│  NVDA  131.07  -1.34%  142.0M   ██▌  -$0.9M ↓    ‾╲╲_        -netγ       │    loads chart
│  …     (top N by selected sort; sticky header; row=32px)                  │
├─────────────────────────────────────────────────────────────────────────┤
│ CHARTS  ▸ multi-chart grid (UNCHANGED, first-class)   [1x1][2x2][2x3][3x3]│  ← directly under hero
│  ┌────────────┐ ┌────────────┐                                           │
│  │  chart +   │ │  chart +   │   (clicking a universe row sets a cell sym)│
│  │ prem flow  │ │ prem flow  │                                           │
│  └────────────┘ └────────────┘                                           │
├──────────────────────────────┬────────────────────────────────────────┐ │
│ SECTOR / LEADERSHIP (compact) │ NEWS · CALENDAR (compact, collapsible)  │ │  ← supporting rails
└──────────────────────────────┴────────────────────────────────────────┘ │
```

## Detailed UI element specs

### 1. Hero band (sticky header)
- **Container:** `SurfacePanel` (compact), sticky to top of scroll region.
- **Breadth gauge:** `RadialStrokeGauge` `value={breadth.advancePct*100}` max=100.
  Source `buildTrackedBreadthSummary()` (existing). Tone via `toneForFinancialDelta(advancers-decliners)`.
- **Put/Call chip:** `MetricChip label="P/C" value={putCall.ratio}` — `useListAggregateFlowEvents()` → `putCall`.
- **Vol chip:** `MetricChip label="VIXY" value={fmtSignedPercent(volProxy.pct)}` (existing `volatilityProxy`).
- **Sort control:** `SegmentedControl options=[Flow,%,Vol,α]` driving the table sort key.
- **Filter:** `InlineFilterBar` (text + sector chips) filtering universe rows client-side.

### 2. Universe hero table (NEW — the centerpiece)
- **Component:** new `features/market/MarketUniverseTable.jsx` built on `DenseVirtualTable`.
- **Rows:** `useGetFlowUniverse()` symbols, hydrated with `useGetQuoteSnapshots(symbols)` +
  batch sparklines (`/api/bars/batch shape:sparkline`) + per-symbol `tickerFlow` from
  `useListAggregateFlowEvents()`. Reuse `runtimeMarketDataModel` sync so rows share the app cache.
- **Columns + bindings:**
  | Col | Binding | Primitive | Tone |
  |---|---|---|---|
  | SYM | `snapshot.symbol` (+ name tooltip) | text | — |
  | Price | `snapshot.price` → `formatQuotePrice` | text | — |
  | Chg% | `snapshot.changePercent` → `formatSignedPercent` | text | `toneForFinancialDelta` |
  | Vol | `snapshot.volume` → `fmtCompactNumber` | text | — |
  | Flow heat | `tickerFlow[sym].premium` (net) | `ScoreBar` + `fmtM` + ↑/↓ | `toneForDirectionalIntent(bullishness)` |
  | Spark | batch sparkline 48-pt | `MicroSparkline` (auto green/red) | auto |
  | GEX | `gexDashboard.flowContext` netGex sign (lazy/optional) | `MetricChip` | bull/bear tone |
- **Row interaction:** click → set the active multi-chart cell's symbol (wire to MultiChartGrid's
  existing `sym` prop / chart-cell symbol setter). Hover = `surfaceStyle` highlight.
- **States:** `Skeleton` rows while pending; `DataUnavailableState variant="info"` if universe empty.
- **Perf:** virtualized (already in `DenseVirtualTable`); cap live-streamed symbols to visible rows.

### 3. Multi-chart grid (KEEP — first-class, moved under hero)
- **No structural change** to `MultiChartGrid.jsx`. Only: (a) move it to render *below* the hero,
  (b) accept a "set cell symbol" callback from the universe row click. Keep `PlatformErrorBoundary`
  + `MarketChartGridFallback` + layout/resize/localStorage behavior intact.

### 4. Supporting rails (compact, demoted)
- **Sector / Leadership:** keep `sectorFlow` + leaders/laggards but render as a single compact
  `SurfacePanel` with two columns; leaders/laggards now sourced from the **live universe ranking**
  (top/bottom of `useGetFlowUniverse()` by Chg%) instead of hard-coded constants.
- **News · Calendar:** keep `useGetNews()` / `useGetResearchEarningsCalendar()`, but make the panel
  **collapsible** and render a single tidy `DataUnavailableState` when both are empty (fixes the
  awkward blank-card stacking).
- **Remove dead code:** delete or wire `MarketActivityPanel.jsx` — confirm with user before deleting
  (it is currently rendered nowhere).

## Implementation phases

1. **Hero scaffold** → new sticky `SurfacePanel` header with breadth/PC/vol chips + sort/filter
   controls (no table yet). *Verify:* renders with existing pulse data, no regressions.
2. **Universe table** → `MarketUniverseTable.jsx` on `DenseVirtualTable`, wired to
   `useGetFlowUniverse` + quotes + batch sparklines. *Verify:* rows populate, sort/filter work,
   virtualization smooth at 200+ symbols.
3. **Chart wiring** → row-click sets a chart cell symbol; move grid under hero. *Verify:* clicking
   a row loads that symbol in the grid; grid resize/layout state still persists.
4. **Demote rails** → compact sector/leadership (from live ranking) + collapsible news/calendar.
   *Verify:* empty states collapse cleanly.
5. **Cleanup** → resolve `MarketActivityPanel` (wire or remove, with approval); fluid breakpoints.

## Verification (each phase)

- `pnpm --filter @workspace/pyrus run typecheck`
- targeted `vitest` for any new `*.test.mjs` (universe row model, sort/filter)
- build: `pnpm --filter @workspace/pyrus run build`
- runtime: reload API in place (SIGUSR2 to the pid2-owned `runDevApp.mjs`), then load
  `https://$REPLIT_DEV_DOMAIN/` → Market tab, confirm hero + table + chart-on-click.

## Build status — v1 shipped on a hidden demo page (2026-06-26)

Built on a **separate hidden page** (existing `MarketScreen` untouched), reachable only via
`?screen=market-demo`. Decisions: hidden URL-only access, all 3 sorts (Flow default), GEX column in v1.

- New: `artifacts/pyrus/src/screens/MarketDemoScreen.jsx` (hero band + universe table + chart grid + news rail).
- New: `artifacts/pyrus/src/features/market/MarketUniverseTable.jsx` (flow-ranked rows on `DenseVirtualTable`: Sym/Price/Chg%/Vol/Flow-heat/Trend/Net γ; quotes + aggregate-flow heat + runtime sparklines + per-visible-row GEX; row click → chart).
- Additive routing only: `screenModulePreloader.js`, `screenRegistry.jsx` (`hidden: true` entry), `PlatformScreenRouter.jsx`, `initialPlatformScreen.ts`, `?screen=` boot hook in `PlatformApp.jsx`, and `hidden` filtered out of `AppHeader` nav + `CommandPalette`.
- Verified: typecheck + build clean; Playwright headless confirmed the demo renders (hero + table + charts), the default route still shows the untouched Market screen, and no "Market Demo" leaks into the nav.

Known v1 limits (follow-ups): row count capped at 60; per-row GEX uses the heavy dashboard endpoint (wants a bulk GEX-universe endpoint); calendar rail deferred.

### Follow-up done — sector/leadership rail (2026-06-26)

New `artifacts/pyrus/src/features/market/MarketInternalsRail.jsx`, wired into `MarketDemoScreen`
beside the News rail. Two parts: **Sector flow** (top sectors by net call−put premium from the
platform-wide broad-market flow store `useMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY)`,
populated globally by `MarketFlowRuntimeLayer`), and **Leaders/Laggards** (top/bottom movers by %
change from the flow-ranked universe quotes — same query keys as the table, so react-query dedupes
the fetch). Clicking a mover loads it into the chart grid. Verified: typecheck + build clean;
headless render (scoped to the demo screen) shows the internals panel, sector flow, leaders, and
laggards with no page errors.

### Follow-up done — chart-grid state isolated (2026-06-26)

`MultiChartGrid` now takes an optional `trackStateKey` prop (default = canonical
`MARKET_GRID_TRACK_SESSION_KEY`, so the real Market page is unchanged). `readMarketGridTrackSession`
/ `writeMarketGridTrackSession` gained an optional `sessionKey` param. The demo passes
`"pyrus:market-grid-track-sizes:demo"`, so resizing the demo's grid can no longer share or clobber
the real Market page's saved column/row sizing. Verified: the two pages persist to distinct
sessionStorage keys; typecheck + build clean.

### Follow-up done — GEX cost fix: bulk endpoint (2026-06-26)

Resolves the known v1 limit "per-row GEX uses the heavy dashboard endpoint." The universe table's
Net γ column was firing one `GET /api/gex/{sym}` (the full GEX **dashboard** computation) per visible
row. Replaced with a single bulk read:

- **Spec:** new `GET /gex-snapshots?symbols=` (operationId `getGexSnapshots`) + `GexSnapshotsResponse`
  / `GexNetSnapshot` schemas in `lib/api-spec/openapi.yaml` (mirrors `/quotes/snapshot`).
- **Backend:** `getLatestGexSnapshotsForSymbols(symbols, maxAgeMs)` in `market-data-ingest.ts` — one
  `select distinct on (symbol) ... net_gex ... where symbol = any($1) order by symbol, computed_at desc`
  (uses the existing `gex_snapshots_symbol_latest_idx`; reads the canonical `net_gex` column, no jsonb
  parse). Thin `getGexSnapshots()` service wrapper in `gex.ts`; `GET /gex-snapshots` route in
  `routes/platform.ts` (registered before `/gex/:underlying`, no path collision).
- **Codegen:** regenerated `useGetGexSnapshots` hook + `GetGexSnapshots{QueryParams,Response}` zod.
- **Frontend:** `MarketUniverseTable.jsx` now issues one `useGetGexSnapshots(symbols)` query, builds a
  `netGexBySymbol` map, and renders a presentational `GexCell` per row (no per-row hook). Net cost for
  N rows: 1 cheap snapshot query instead of N heavy dashboard fetches. Same displayed value.
- Verified: api-server + pyrus + libs typecheck clean; pyrus + api-server build clean; fresh-context
  adversarial review = SHIP. **Pending:** live `curl /api/gex-snapshots?symbols=SPY,QQQ` + on-page
  render (dev app was stopped at implementation time; needs a Run-button bootstrap to test at runtime).

## Open questions before build

- **Universe size / default sort:** how many rows in the hero by default (e.g. top 50 by flow?),
  and which sort is the landing default — Flow, % change, or Volume?
- **GEX column:** include the per-symbol GEX column in v1 (adds a per-row `/api/gex/{sym}` cost), or
  defer it to drill-down only?
- **`MarketActivityPanel.jsx`:** wire it into the new rails, or delete it as dead code?
