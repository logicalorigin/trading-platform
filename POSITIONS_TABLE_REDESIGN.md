# Positions Table Redesign — TWS-Inspired

**Goal:** Bring Pyrus's positions tables closer to the look and feel of Interactive Brokers TWS — power-user density, tabular numerics, P&L-only color, optional columns via a picker, pinned aggregate summary — while preserving Pyrus-specific value (algo context, source filtering, paper/live toggle).

**Choices locked in this session:**
- Scope: **all three** surfaces (Account `PositionsPanel`, Algo `OperationsPositionsTable`, Trade `TradePositionsPanel`).
- Direction: **TWS power-user dense.**
- Grouping: **flat list** (no group-by-underlying). User asked explicitly to keep flat. The summary row carries the aggregate weight that grouping would otherwise carry.
- Greeks: **opt-in via column picker** (saved preference). Off by default.

---

## What changes at a glance

### Before (today)
```
SYMBOL          OPENED      BID/ASK    QTY     AVG/MARK    DAY        UNREAL      VALUE/WT    βΔ
[sparkline]                 1.45/1.55          $1.20       +$25.00    +$210.00    $3,450      +12.4
AAPL            5/15 9:33   1.50  3%   100     $1.45       +0.7%      +21.0%      4.2%
                            fresh
```
*(stacked 2-line cells, sparkline always on, mixed tone usage)*

### After (TWS-style)
```
                                        DAY                    UNREALIZED          POSITION
SYMBOL    QTY    AVG     LAST    BID    ASK    DAY $    DAY %   UNREAL $  UNREAL %  VALUE     WT %    ACTIONS
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
AAPL      100    1.45    1.50    1.49   1.51   +25.00  +1.69   +21.00    +14.48    +3,450    4.2     ⋯ ⊕ ✕
NVDA C..  -2     2.10    2.05    2.03   2.07   -10.00  -2.38    -8.00    -3.81      -41,000  -1.1    ⋯ ⊕ ✕
TLT       250    87.40   86.85   86.83  86.87  -137.50 -0.63   -2,725.00 -1.26     21,712.50 26.5    ⋯ ⊕ ✕
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
SUMMARY · 3 positions · Net Liq $24,621 · Day -$122 (-0.49%) · Unreal -$2,712 (-12.4%) · Net Δ +51.3
```
*(single-line rows, tabular nums right-aligned, color reserved for P&L only, pinned summary)*

---

## Default column set

### Equity / ETF positions (default columns)
| # | Column | Format | Source |
|---|---|---|---|
| 1 | **Symbol** | mono, left | `symbol` + `description` (tooltip) |
| 2 | **Qty** | tabular, right | `quantity` (red text if negative) |
| 3 | **Avg Cost** | tabular, right, $ | `averageCost` |
| 4 | **Last** | tabular, right, $ | `mark` |
| 5 | **Bid** | tabular, right, $ | optional default-off for equities |
| 6 | **Ask** | tabular, right, $ | optional default-off for equities |
| 7 | **Day $** | tabular, right, signed | `dayChange` (P&L tone) |
| 8 | **Day %** | tabular, right, signed % | `dayChangePercent` (P&L tone) |
| 9 | **Unreal $** | tabular, right, signed | `unrealizedPnl` (P&L tone) |
| 10 | **Unreal %** | tabular, right, signed % | `unrealizedPnlPercent` (P&L tone) |
| 11 | **Market Value** | tabular, right, $ | `marketValue` |
| 12 | **Wt %** | tabular, right, % | `weightPercent` |
| 13 | **Actions** | hover-revealed icons | Trade · Chart · Close |

### Option positions (default columns — additive)
| # | Column | Format | Source |
|---|---|---|---|
| 1 | **Symbol** | `AAPL 5/24 $150 P` mono, left | `optionContract` formatter |
| 2 | **Qty (ct)** | tabular, right | `quantity` (multiplier in tooltip) |
| 3 | **Avg Cost** | tabular, right, $ | `averageCost` |
| 4 | **Mark** | tabular, right, $ | `optionQuote.mark` (fallback `mark`) |
| 5 | **Bid** | tabular, right, $ | `optionQuote.bid` |
| 6 | **Ask** | tabular, right, $ | `optionQuote.ask` |
| 7 | **Spread %** | tabular, right, % | computed (Ask − Bid) / Mid |
| 8 | **Day $** / **Day %** | as above |  |
| 9 | **Unreal $** / **Unreal %** | as above |  |
| 10 | **Market Value** | tabular, right, $ |  |
| 11 | **Wt %** | tabular, right, % |  |
| 12 | **Actions** | hover icons | Trade · Roll · Chart · Close |

### Optional columns (column picker, off by default)
| Column | When to show |
|---|---|
| **Opened** | Useful for tax-lot reasoning; off by default to save width |
| **Source** | Manual / Automation / Watchlist BT badge (Pyrus-specific) |
| **Signal context** | Automation-only: signal score, tier, stop distance, premium at risk |
| **Sparkline** | Intraday mini-chart in the symbol cell |
| **Sector** | For equities |
| **Δ Delta** | Options only — per-contract delta |
| **Γ Gamma** | Options only |
| **Θ Theta** | Options only |
| **V Vega** | Options only |
| **IV** | Options only — implied vol |
| **β Δ** | Beta-weighted delta (current default, becomes opt-in) |
| **Quote freshness** | "realtime" / "delayed" / "stale" pill |
| **Quote age** | seconds since last quote update |
| **Open interest** | Options only |
| **Volume** | Today's volume |

Column picker UI: a `⚙` icon next to the filter pills opens a popover with checkboxes grouped by **Identity / Pricing / P&L / Position / Greeks / Context**. Selection persists per surface (Account vs. Trade vs. Algo) in user preferences.

---

## Visual specs

### Row
- **Height:** 32px desktop · 36px tablet · 56px phone (phone keeps 2-line layout — see Mobile)
- **Padding:** 6px top/bottom, 10px left/right
- **Border:** 1px bottom, `T.borderDim` (lighter than today's `T.border`)
- **Hover:** `T.bg2` background, action icons fade in (opacity 0 → 1, 100ms)
- **Selected:** `T.accent` 1px left accent (replaces today's direction-toned 3px shadow)

### Typography
- **Numbers:** `font-variant-numeric: tabular-nums`, `font-feature-settings: "tnum"`. Apply at column level on every numeric column, not at row level.
- **Symbol:** mono font for the symbol cell (`T.mono`), `fs(12)`, medium weight. Description shown in tooltip on hover.
- **Cell text size:** `fs(11)` for numerics, `fs(12)` for symbol, `fs(10)` for the optional opened-at column.
- **Lower-case header labels:** TWS uses small-caps headers in 10px. Pyrus today already uppercases. Keep uppercase, but drop to `fs(9)` with `letter-spacing: 0.04em` and `T.textMuted`.

### Alignment
- **Symbol:** left
- **Qty:** right (TWS convention — qty is a number, treat it as one)
- **All prices, $ amounts, %:** right, tabular nums
- **Actions:** right edge of row
- Use a `grid-template-columns` with fixed `px` widths for narrow numeric columns (`56px`, `72px`) and `minmax()` only for the symbol column. This is what gives TWS its rock-solid column alignment.

### Color (the most important change)
- **Reserve green / red for P&L cells only.** Day $, Day %, Unreal $, Unreal %, and the summary aggregates. Nothing else.
- **Negative qty:** keep red text (TWS convention) — this is treating qty as a P&L-adjacent value, fine to keep.
- **Quote freshness:** if shown, render as a small dot (●) in `T.green` / `T.amber` / `T.textDim` next to the price. Don't tint the whole price cell.
- **Source / Automation / Sector chips:** neutral tones only (`T.bg2` background, `T.textSec` text). Move tone usage out of these.
- **Selected / hover:** `T.accent` only. Drop the direction-toned glow background entirely from positions rows.

### Sticky behavior
- **Symbol column sticky-left** when horizontal scroll engages (it will, once the column picker enables Greeks etc.). `position: sticky; left: 0; background: T.bg1; box-shadow: 2px 0 0 T.borderDim` on scroll.
- **Header row sticky-top** inside the scroll body (already true; keep).
- **Summary row sticky-bottom** of the scroll body, pinned above pagination footer.

---

## Aggregate summary row

Pinned at the **bottom** of the scroll body, above pagination. Single line, tabular nums.

```
SUMMARY · 17 positions · Net Liq $124,621 · Day +$832 (+0.67%) · Unreal +$8,940 (+7.71%) · Net Δ +137.4 · Net Θ -42.1
```

- Includes: position count · net liquidation · day P&L $/% · unrealized P&L $/% · net delta (always for options-bearing portfolios) · net theta (when Greeks columns are enabled).
- Aggregates respect the active asset filter and source filter — so users see "Options total" or "Automation positions total" as they slice the view.
- Tone: P&L numbers use the P&L color rule; everything else neutral.

---

## Sorting & filtering

### Sort
- Single-column sort (today's pattern) — TWS supports multi-col but the muscle memory is single. Keep it simple.
- Click header to cycle: unsorted → desc → asc → unsorted.
- Sort caret rendered as `▼` / `▲` at `fs(9)`, full-opacity active, hidden on inactive (replaces the always-visible `ArrowUpDown` icon).
- Sortable columns: Symbol, Qty, Avg Cost, Last/Mark, Day $, Day %, Unreal $, Unreal %, Market Value, Wt %, (Δ when Greeks shown).

### Filter
- Keep today's filter pills: **asset class** (All / Equity / ETF / Option) + **source** (All / Manual / Automation / Watchlist BT / Mixed).
- Add **symbol search** input next to the pills (matches the same recommendation in the Signals-to-Action audit; consistent across tables).
- Move both into the second header tier (title + summary on top tier, controls on second tier) so the controls row doesn't fight title space at narrow widths.

---

## Hover actions (replaces today's read-only rows)

On row hover, three icon buttons fade in at the right edge:
- **⊕ Trade** — opens the Trade ticket pre-filled with the position contract; behaves like clicking the symbol in TWS Mosaic.
- **Chart** — opens the Market screen focused on the symbol.
- **✕ Close** — opens a confirm-and-route ticket to flatten the position. Matches `TradePositionsPanel`'s existing close button.

Options get a fourth action:
- **↻ Roll** — opens a roll ticket scaffold (existing ticket flow with the source contract pre-selected).

Implementation note: today's `TradePositionsPanel` has only the ✕ close affordance inline. Extend that pattern into the redesigned `PositionsPanel`.

---

## Per-surface adaptations

### A. `PositionsPanel` — Account screen (canonical implementation)
- Full redesign per the spec above.
- Default-on columns: Symbol, Qty, Avg, Last, Day $, Day %, Unreal $, Unreal %, Market Value, Wt %, Actions.
- Off by default: Bid, Ask, Spread %, Opened, Source, Signal context, Sparkline, Sector, Δ, Γ, Θ, V, IV, β Δ, Quote freshness, Quote age, Open interest, Volume.
- Pagination: bump to **50 rows/page** (TWS doesn't paginate; we still need a ceiling). Footer keeps total + paginator.
- Drop the stacked 2-line cell pattern entirely — `DataCell` analog should be a single-line tabular cell.

### B. `OperationsPositionsTable` — Algo Live
- Wrapper around the redesigned `PositionsPanel`; configures defaults appropriate to options-only context:
  - Default-on columns expand to include: Δ, Θ, Bid, Ask, Spread %, Signal context (Pyrus-specific value).
  - Asset filter still locked to Options.
  - Source filter still locked to "automation."
  - Summary row labels swap: "Net Δ" and "Net Θ" become primary KPIs alongside Day / Unreal.
- Right-rail text remains as-is.

### C. `TradePositionsPanel` — Trade screen
- Smaller surface (compact grid). Adopt the visual rules (single-line, tabular nums, P&L-only color) but keep its current 9-column compact grid template — don't introduce the column picker here. This is the "in-flight" view, not the "manage portfolio" view.
- Change set:
  - Tabular nums on all numeric cells.
  - P&L cell becomes two columns (`P&L $` + `P&L %`) instead of stacked.
  - Strip the `${T.accent}08` background on user-submitted rows; replace with the same 1px left accent the canonical positions row uses.
  - Hover actions: gain ⊕ Trade and Chart in addition to ✕ Close.
  - Bid/Ask becomes two columns instead of a 2-line stacked cell.

---

## Mobile

Phone width keeps a 2-line row layout (the single-line dense rule doesn't survive below ~480px). Redesign rules:
- **Line 1:** Symbol · Qty · Last · P&L pill (`+$25 / +1.7%`).
- **Line 2:** Avg cost · Bid/Ask · Source / Opened (compact).
- **Tap row** → bottom sheet with full column data + actions (mirror the Signal table's phone pattern).
- Summary row stays pinned bottom, same content but truncated to: `17 pos · Day +0.67% · Unr +7.71% · Δ+137`.
- Filter pills collapse into a single `Filter` dropdown below ~640px (matches Signals-to-Action audit recommendation — same component, reuse it).

---

## Files most likely to change

| File | Change |
|---|---|
| `artifacts/pyrus/src/screens/account/PositionsPanel.jsx` | Row + cell rebuild, column picker, summary row, hover actions, mobile fork rewrite |
| `artifacts/pyrus/src/screens/account/positionDisplayModel.js` | New formatters: separate `bid`, `ask`, `spreadPercent`, separate `dayChange$` / `dayChange%`, Greeks formatters, summary aggregator |
| `artifacts/pyrus/src/screens/account/accountPositionRows.js` | Surface Greeks fields onto row model (already present in `optionQuote`); add aggregate computer |
| `artifacts/pyrus/src/screens/account/accountUtils.jsx` | Tighten P&L tone helper to the documented palette (P&L-only color rule); add `tabularRight` cell helper |
| `artifacts/pyrus/src/screens/algo/OperationsPositionsTable.jsx` | Pass updated default-column set; opt in to Greeks columns by default |
| `artifacts/pyrus/src/features/trade/TradePositionsPanel.jsx` | Tabular nums, P&L-only color, split bid/ask + day/unreal columns, hover actions, drop accent backgrounds |
| `artifacts/pyrus/src/components/platform/primitives.jsx` (or a new `TableColumnPicker.jsx`) | New `<ColumnPickerPopover>` component; reusable across surfaces |
| `artifacts/pyrus/src/lib/uiTokens.jsx` | Add `T.borderDim` (lighter row divider), `T.mono`, `tabularNumStyle` helper if not present |
| `artifacts/pyrus/src/features/platform/userPreferences/` (or wherever prefs live) | Column-visibility preference store, keyed by surface |

Tests:
- `artifacts/pyrus/src/screens/account/PositionsPanel.validation.{js,jsx}` — update for new column contract, column picker, summary row.
- `artifacts/pyrus/src/features/trade/TradePositionsPanel.validation.{js,jsx}` — update grid template + action surface.
- New: `artifacts/pyrus/src/components/platform/TableColumnPicker.validation.jsx`.

---

## Phased delivery

### Phase 1 — visual baseline (1–2 days, ships value immediately)
1. Tabular-nums + right-aligned numerics across all three surfaces.
2. P&L-only color rule (strip decorative tones from positions rows).
3. Single-line dense rows in `PositionsPanel` (drop 2-line stacked cells); split Avg/Mark, Day, Unreal, Value/Weight into discrete columns.
4. Pinned summary row in `PositionsPanel`.
5. Symbol column sticky-left.

### Phase 2 — column customization + actions (2–3 days)
6. `<ColumnPickerPopover>` component + preference store.
7. Default-off Greeks, IV, OI, Volume, Quote freshness columns (data already on the row model).
8. Hover actions on all three surfaces: ⊕ Trade · Chart · ✕ Close (· ↻ Roll for options).
9. Symbol search input in the header strip.

### Phase 3 — polish + mobile (1–2 days)
10. Mobile row rebuild (2-line) + bottom-sheet detail.
11. Filter-pill dropdown collapse below 640px.
12. Summary-row aggregates respect filters.
13. Pagination ceiling to 50 rows/page on the Account table.

### Phase 4 (optional, gated on feedback) — TWS-style extras
14. Multi-column sort.
15. Column reorder (drag handles in the picker).
16. Saved column presets per surface (e.g., "Day trader", "Options trader", "Long-term").

---

## What we deliberately are NOT doing (and why)

- **Group-by-underlying for options.** You asked to keep the list flat. The pinned summary row + Wt % column carry the aggregate weight that grouping would otherwise provide.
- **Right-click context menus.** Web context menus fight the browser's own. Hover actions cover the same use cases without the platform inconsistency.
- **Multi-currency UI.** Pyrus is USD-only today; designing for multi-currency would add columns nobody needs yet. The numeric formatters should not preclude it though.
- **Removing the source / automation context features.** These are Pyrus's value-add over TWS. They become opt-in columns, not removed.

---

## Verification path

1. Run the app and screenshot:
   - Account screen positions panel at 1440px / 1024px / 414px, before vs after.
   - Algo Live ops positions table (options-only) at 1440px / 1024px.
   - Trade screen positions panel inside the layout it lives in.
2. Eyeball with realistic data: a mix of long equity, short equity, long options, short options, multi-leg spreads as separate legs.
3. Toggle the column picker through every combination of Greeks / freshness / signal context to confirm width math holds and the sticky symbol column behaves on overflow.
4. Test paper-mode vs. live-mode (the `mode: environment` query arg) to confirm both data sources render identically.
5. Run unit tests: `pnpm --filter @pyrus/pyrus run test`.
6. If any Replit startup file is touched (`.replit`, `artifacts/*/.replit-artifact/artifact.toml`, dev scripts, `scripts/reap-dev-port.mjs`), per `CLAUDE.md` run `pnpm run audit:replit-startup`.

---

## Open questions worth your input before Phase 1

- **Wt %** — current denominator is total portfolio value. TWS uses net liquidation, which differs when there's margin debit. Confirm Pyrus should match TWS or stay with current logic.
- **Day P&L baseline** — what does "day" mean for a position opened intra-day? TWS uses entry price as the day baseline for same-day positions. Confirm Pyrus's current behavior and whether to change.
- **Column-preference storage** — does Pyrus already have a user-preference store on the API side, or should the column picker persist to `localStorage` only? Affects Phase 2 scope.
- **Actions plumbing** — does the Trade ticket already accept an `openWith(position)` entrypoint, or does opening a pre-filled ticket from `PositionsPanel` require a small new API? Confirms whether hover actions are a Phase 2 or Phase 3 task.
