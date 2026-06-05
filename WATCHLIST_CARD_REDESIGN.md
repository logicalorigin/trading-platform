# Watchlist Card Redesign — Fit-All Fluid Responsive Cards

## Context

The watchlist (left sidebar of the platform shell — 196–320px desktop / 380px mobile drawer / 40px
collapsed) renders symbols as dense 2-row rows in `PlatformWatchlist.jsx` (`WatchlistRow`, lines
160–703), with a separate 44px `mobile-dense` variant. Today a fixed-width signal cluster squeezes
long symbols, the sparkline↔price alignment is loose, and it gets cramped at narrow widths.

**Goal:** a **single responsive card** that **always shows every element** — symbol, algo signal
(BUY/SELL pill + 3 timeframe dots), price, day change $, % change, sparkline, volume, bid/ask — and
**never drops any of them**. Instead, elements **fluidly resize** (CSS container queries +
`cqi`/`clamp`) and **reflow** from one dense line (wide) to two lines (narrow). One code path
replaces the desktop + mobile-dense forks. Uses the CSS container-query approach adopted as the
app-wide standard (see `ALGO_RIGHT_RAIL_REDESIGN.md` Part A).

Frontend under `artifacts/pyrus/`. Stylesheet `src/index.css` (asserted by `lib/uiTokens.validation.js`).
No backend / schema changes.

## Decisions locked

- **Never drop elements** — all data always present, resized/reflowed to fit.
- **One responsive card** via CSS container queries (each card `container-type: inline-size`), replacing the desktop + `mobile-dense` variants.
- **Fluid sizing:** sparkline width + gaps scale with `cqi`+`clamp`; **text scales modestly** (clamp ~10–13px). **Floor: 10px text.**
- **Reflow ladder:** 1 line (wide) → **2 lines** (narrow). 3 lines is an absolute safety cap only; target is 1–2.
- **Element arrangement** (from the accepted preview):
  - **Wide (1 line):** `identity · symbol · signal(pill+dots) · price · chg$ · %chg · spark · vol · bid/ask`
  - **Narrow (2 lines):** line 1 = `identity · symbol · signal · price · %chg`; line 2 = `spark · chg$ · vol · bid/ask`
- **Signals stay prominent** (pill + 3 dots), never collapsed — they reflow, not shrink away.
- **Selected state:** background tint (`bg3`) only, no accent bar.
- **Live ticks:** subtle value flash (`useValueFlash`) **+ persistent green/red on %chg and chg$**.
- **Collapsed 40px rail:** a **micro-rail** (logo + direction dot per symbol); **any click expands** the sidebar.
- **Separation:** hairline `1px borderLight` divider between cards, no gaps.

## Data availability (verified)

`useRuntimeTickerSnapshot(sym)` → `{ price, bid, ask, chg, pct, volume, sparkBars, spark, name }`
(`runtimeMarketDataModel.js:68–77`; tracked in `runtimeTickerStore.js`). `bid`/`ask`/`volume` may be
null → render muted `—` (never drop the slot). Signal: `useSignalMonitorStateForSymbol(sym)` +
`signalStatesByTimeframe` (2m/5m/15m) for the dots. Reuse `MarketIdentityMark`, `MicroSparkline`,
`useValueFlash`, `formatQuotePrice`, `formatSignedPercent`, `sparklineConfig`.

---

## Part A — Container-query fluid card foundation (`index.css`)

- `.wl-card { container-type: inline-size; }` on each card root.
- **Fluid tokens (CSS custom props on the card):**
  `--wl-gap: clamp(2px, 1.5cqi, 8px)`, `--wl-font: clamp(10px, 2.8cqi, 13px)`,
  `--wl-font-sec: clamp(10px, 2.4cqi, 12px)`, `--wl-spark-w: clamp(28px, 16cqi, 64px)`.
- **Grid arrangement via `grid-template-areas`:**
  - Default (wide) — single row:
    `grid-template-areas: "id sym sig price chg pct spark vol quote"`; columns
    `auto auto auto auto auto auto var(--wl-spark-w) auto auto`, `column-gap: var(--wl-gap)`,
    `align-items: center`.
  - `@container (max-width: 300px)` — two rows:
    `"id sym sym sig"` / `"spark chg vol quote"` (price + %chg on row 1 right; chg$/vol/bid-ask on
    row 2) — exact area map tuned in implementation to match the accepted 2-line preview;
    `row-gap: 2px`.
  - `@container (max-width: 150px)` (safety) — allow a 3rd row before any crowding; never drop.
- `.tnum` (tabular-nums) on every numeric cell; numeric cells `text-align:right` + `min-width` per column so digits never clip.
- These classes live beside the algo-rail container-query utilities from the app-wide standard.

## Part B — Per-element spec

All colors/sizes from `uiTokens.jsx` (`CSS_COLOR.*`, `sp`, `dim`, `textSize`, `T`, `FONT_WEIGHTS`,
`RADII`, `cssColorMix`). Font size = `var(--wl-font)` unless noted.

1. **Card root** (`grid-area` host): `.wl-card`; `display:grid`; `padding: sp("6px 8px")`;
   `border-bottom:1px solid borderLight`; background transparent → `bg3` when selected →
   `cssColorMix(accent,9)` on drag-over; `min-width:0`. Click → `onSelect(sym)` (or toggle in
   selection mode). `ra-interactive` for hover.
2. **Identity mark** (`area:id`): `MarketIdentityMark`, `dim(18)`, `showCountryBadge={false}`.
3. **Symbol** (`area:sym`): `T.sans`, `var(--wl-font)`, `FONT_WEIGHTS.medium`, `CSS_COLOR.text`,
   `white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0` (the only element
   allowed to ellipsis; it gets the flexible space).
4. **Signal pill** (`area:sig`, part 1): BUY/SELL chip — `textSize("caption")` clamped, uppercase,
   `padding:sp("1px 5px")`, `border-radius:dim(RADII.pill)`, fixed `min-width` so it never reflows
   mid-word; BUY = `green` tone (`cssColorMix(green,14)` bg / `green` text), SELL = `red`. Fresh
   signal adds `box-shadow` glow (`ra-status-pulse`); stale = no glow, `0.7` opacity. Absent signal
   → pill omitted but the 3 dots still render (neutral).
5. **Signal dots** (`area:sig`, part 2): three `dim(7)` dots (2m/5m/15m) from
   `signalStatesByTimeframe`; green/red/`textMuted` per timeframe; fixed `min-width` slot; `title`
   tooltip per dot.
6. **Price** (`area:price`): `var(--wl-font)`, `FONT_WEIGHTS.medium`, `.tnum`, right-aligned,
   `formatQuotePrice`; `useValueFlash` className on tick.
7. **Day change $** (`area:chg`): `var(--wl-font-sec)`, `.tnum`, **persistent** green/red by sign
   (muted `—` if null); `formatSigned`.
8. **% change** (`area:pct`): `var(--wl-font-sec)`, `.tnum`, **persistent** green/red by sign;
   `formatSignedPercent`; muted `—` if null.
9. **Sparkline** (`area:spark`): `MicroSparkline`, `width:var(--wl-spark-w)`, `height:dim(14)`,
   stroke green/red by direction; falls back to seeded spark when no bars (existing logic).
10. **Volume** (`area:vol`): `var(--wl-font-sec)`, `.tnum`, `CSS_COLOR.textMuted`, compact format
    (`41M`); `—` if null.
11. **Bid/Ask** (`area:quote`): `var(--wl-font-sec)`, `.tnum`, `textMuted`, `"182.4/182.6"`; `—/—`
    if null; `nowrap`.
12. **Drag handle:** `GripVertical` `dim(12)`, opacity 0 → 0.6 on card hover, only when manual sort
    + `canDrag`; absolutely positioned at the left inset so it **reserves no layout** (no shift).
13. **Add / remove control:** monitored-only → `Plus` button (`dim(24)`) on hover/right; selection
    mode → 18px checkbox at left (existing behavior), shown only in those modes.
14. **States (every interactive element):** hover (card bg lift), focus-visible (`outline:1px solid
    accent`), disabled (opacity 0.55), selected (card `bg3`), drag/drag-over (per card root).

## Part C — Reflow behavior

Driven entirely by Part A `@container` rules — no JS width branching. Wide → one line; ≤300px → two
lines per the accepted layout; ≤150px safety → up to three. Fluid `clamp()` keeps the single line
intact as long as possible before each reflow; text never below 10px. Card height follows content
(1–2 rows typical).

## Part D — Micro-rail (40px collapsed)

When the sidebar is collapsed (`sidebarCollapsed`, `PlatformShell.jsx`), render a `WatchlistMicroRail`
instead of blank: a vertical list of `MarketIdentityMark` (`dim(18)`) each with a `dim(7)` direction
dot (signal tone) overlaid bottom-right; `title` = symbol. The whole rail (or any item) `onClick` →
the existing expand toggle (expands to full cards). `overflow-y:auto`, `ra-scroll-fade-y`.

## Part E — List, container, separation

- Cards in the existing vertical list (`PlatformWatchlist.jsx` ~1609); **hairline dividers**, no
  gaps; keep `ra-scroll-fade-y` scroll. Header / sort / filter / footer unchanged this pass.
- Remove the `mobile-dense` branch: the mobile drawer (`MobileWatchlistDrawer.jsx`, 380px) renders
  the same `.wl-card` (its width naturally yields the 1-line layout).

## Part F — Live ticks & null handling

`useValueFlash` on price (subtle neutral flash); %chg and chg$ keep **persistent** green/red. Null
`bid/ask/volume/chg/pct` → muted `—`, slot preserved.

## Files to modify

- `src/index.css` — `.wl-card` container-query grid + fluid tokens + `.tnum` reuse.
- `src/features/platform/PlatformWatchlist.jsx` — rewrite `WatchlistRow` to the single `.wl-card`;
  remove `mobile-dense` fork; wire bid/ask/volume; persistent %chg/chg$ color; selected = bg tint.
- `src/features/platform/MobileWatchlistDrawer.jsx` — drop `density="mobile-dense"`; use the responsive card.
- `src/features/platform/PlatformShell.jsx` — render `WatchlistMicroRail` in the collapsed sidebar.
- New `src/features/platform/WatchlistMicroRail.jsx` (Part D).
- `src/features/platform/watchlistModel.js` — surface `bid`/`ask`/`volume`/`chg`/`pct` onto the row model if not already; volume compact formatter (reuse if present).
- `lib/uiTokens.validation.js` — keep/extend `index.css` assertions.

## Verification

1. `pnpm --filter @workspace/pyrus typecheck`.
2. `pnpm --filter @workspace/pyrus run test` — add tests: `WatchlistRow` renders all elements
   (symbol, signal pill+dots, price, chg$, %chg, spark, vol, bid/ask) with no element dropped; null
   bid/ask/vol → `—`; selected → bg tint; persistent %chg color by sign; `WatchlistMicroRail` click
   expands. Keep `uiTokens.validation.js` green.
3. **Fluid/reflow smoke (key check):** run app → resize the watchlist sidebar across 196→320px and
   open the 380px mobile drawer. Confirm: at wide widths one dense line shows everything; as it
   narrows, sparkline + gaps shrink (cqi), text scales to its 10px floor, then content reflows to 2
   lines — **no element ever disappears**; numerics stay tabular and never clip; dividers + selected
   tint + live flash + persistent %chg color all read correctly. Collapse to 40px → micro-rail of
   logos + dots; click expands.
4. If any Replit startup file is touched (it won't be), run `pnpm run audit:replit-startup`.
