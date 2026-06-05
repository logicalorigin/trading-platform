# Implementation Plan: Signals Row Drilldown

Last reviewed: 2026-06-01

## Implementation Status

Implemented in this workspace on 2026-06-01:

- `DenseVirtualTable` now supports optional fixed-height expanded detail rows without callers adding fake rows to the data set.
- The Signals screen no longer renders the separate detail side panel; row click toggles a row-owned drilldown.
- The drilldown is now a dense inspection band with a header fact strip, selected-symbol price context chart, decision thesis rail, interval proof matrix, gate matrix, provenance strip, and Trade action.
- The chart uses `useGetBars` only from the expanded row, requests a bounded bar window, renders a compact line/volume SVG, and marks the signal only when the signal timestamp falls inside the loaded bars window.
- The screen has a hydration progress rail above the table and visible-row interval hydration now prioritizes a larger foreground window so the active Signals page fills in faster without widening background pressure.
- Desktop and phone safe-QA screenshots were captured from the running local PYRUS app; desktop expanded drilldown rendered without console errors except backend 429 rate limiting from live data endpoints.
- Row controls expose `aria-expanded` and `aria-controls`; Enter and Space toggle the row; nested Trade actions stop propagation.
- Focused Signals source tests, row model tests, typecheck, diff whitespace checks, and production build pass.

Remaining follow-up:

- Re-run browser QA when the API is not returning 429s so the bar chart and interval matrix can be verified with live hydrated data rather than rate-limited placeholders.
- The shipped chart is intentionally compact and row-owned, not a full `ResearchChartFrame`; graduate it only if full study overlays or drawing interactions become necessary.
- Runtime chart richness depends on `/api/bars` returning bars for the expanded symbol/timeframe.

## Overview

Replace the Signals screen's separate signal detail side panel with an inline row drilldown. Clicking a signal row expands one focused detail band directly beneath that row. The drilldown should make the selected signal easier to understand without turning the table into a nested dashboard.

The design priority is: chart and current verdict first, explanation second, proof data third, raw/provenance detail last.

## Current State

- The Signals screen lives in `artifacts/pyrus/src/screens/SignalsScreen.jsx`.
- Current side-panel detail component: `SignalsDetailPanel`.
- Current table component: `DenseVirtualTable` in `artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx`.
- Current row model: `buildSignalsRows` in `artifacts/pyrus/src/features/signals/signalsRowModel.js`.
- Existing row data already includes primary state, interval matrix states, latest event, watchlist labels, direction, status, freshness, dashboard summary, coverage reason, signal price/time, latest bar time, evaluation time, and errors.

## Design Review Decisions

- Replace the side rail entirely. Do not keep a desktop side panel after inline expansion ships.
- Allow exactly one expanded row at a time. Clicking a different row moves the drilldown. Clicking the expanded row collapses it.
- Use a fixed-height expanded band, not unbounded dynamic height. The table should remain stable under virtualization.
- Load chart data only for the expanded row. Do not hydrate charts for all rows.
- Keep the drilldown curated. Raw JSON, full Pyrus settings editing, and watchlist mutation are out of scope for the first implementation.
- The drilldown is not a card grid. It is a row-owned workspace band with clear sections.

## Information Architecture

```text
Signals screen
  Header
    Page title
    Monitor/cache/interval status
    Summary metrics
  Toolbar
    Search, filters, monitor controls, Pyrus settings toggle
  Signal table
    Row
      Ticker, signal, stack, timeframe cells, trend, strength, age, volatility, MTF, bars, price, latest, coverage, Trade action
    Expanded row drilldown
      1. Chart and active signal verdict
      2. Signal thesis
      3. Interval proof matrix
      4. Pyrus dashboard and gate diagnostics
      5. Coverage, latest event, errors, actions
```

If only three things can be visible above the fold inside the drilldown, they are:

1. Symbol, direction, freshness, signal time/price.
2. Chart with signal marker.
3. Why the signal is actionable or not actionable now.

## Drilldown Content

### Header Strip

Show:

- Symbol.
- Status label and tone.
- Direction.
- Fresh/stale state.
- Bars since signal.
- Signal time.
- Signal price.
- Latest evaluated time.
- Watchlist badges.

### Chart

Start with one selected-symbol chart inside the expanded band.

Required behavior:

- Uses the active monitor timeframe when possible.
- Shows a loading state while chart bars hydrate.
- Shows an empty state when bars are unavailable.
- Marks the signal time/price if it falls inside the loaded window.
- Uses a bounded visual height so row expansion does not destabilize the table.

Preferred chart path:

- Reuse existing Pyrus chart infrastructure where practical.
- If `ResearchChartFrame` is too heavy for a row band, start with a smaller chart model that uses existing chart bar normalization and later graduate to the full frame.
- Pyrus Signals overlay markers can ship after the base chart if that keeps the first implementation small.

### Signal Thesis

Show a compact explanation:

- Current verdict: buy, sell, no signal, pending, or attention needed.
- Ranking reason: status priority, direction, recency, universe rank.
- Coverage reason from `row.coverageReason`.
- Source: primary monitor state, interval matrix, latest event fallback, or unavailable.

### Interval Proof Matrix

For each `SIGNALS_TABLE_TIMEFRAMES` entry:

- Timeframe.
- Direction.
- Fresh state.
- Bars since signal.
- Current signal time/price.
- Latest bar time.
- Last evaluated time.
- Status/error.

This section should scan as a table, not a list of cards.

### Pyrus Dashboard And Gates

Show from `dashboardSummary` and `indicatorSnapshot`:

- Trend direction.
- Strength.
- ADX.
- Volatility score.
- Trend age bars and bucket.
- MTF rows with required/pass/block/watch state.
- Filter/gate state when present.

Gate diagnostics must be concise. Show meaningful named gates first. Keep raw filter payload behind a compact disclosure only if needed.

### Coverage, Latest Event, Errors, Actions

Show:

- Coverage reason.
- Watchlist membership.
- Latest event direction/timeframe/time/price/source.
- Last error if present.
- Open in Trade action.
- Optional copy ticker action.

Do not add watchlist mutation in this slice.

## Responsive And Accessibility Requirements

Desktop:

- Expanded band uses a two-column layout: chart on the left, explanation/proof on the right.
- Bottom area can span full width for coverage/latest event/actions.
- Minimum visual height should be stable and sufficient for a readable chart.

Tablet:

- Keep chart first.
- Place thesis and interval proof side by side only if width allows.
- Otherwise stack chart, thesis, interval proof, gate diagnostics.

Phone:

- Stack all sections.
- Row tap expands inline under the row.
- The expanded content may use internal scrolling if needed.
- Keep primary actions within thumb reach.
- Touch targets must be at least 44px where practical.

Keyboard and screen reader:

- The expandable row control exposes `aria-expanded`.
- The detail band has a stable `id` referenced by `aria-controls`.
- Enter and Space toggle expansion when focus is on the row control.
- Nested buttons, especially Open in Trade, stop propagation and do not collapse the row.
- The expanded band starts with a clear accessible label such as `{SYMBOL} signal drilldown`.
- Focus should remain predictable after expand/collapse. Do not trap focus inside the detail band.

## Non-Goals

- No full Pyrus Signals settings editor inside the row.
- No raw JSON as the primary UI.
- No chart hydration for every visible row.
- No watchlist add/remove mutation.
- No broad redesign of the Signals header or toolbar.
- No Replit startup config changes.

## Dependency Graph

```text
DenseVirtualTable expanded-row support
  -> Signals expanded-row state and table layout
    -> SignalsRowDrilldown content parity
      -> Lazy selected-symbol chart hydration
        -> Pyrus overlay markers and richer chart proof
          -> Browser QA and polish
```

## Implementation Tasks

### Task 1: Add Expanded-Row Support To `DenseVirtualTable`

**Description:** Extend the virtual table so a caller can render one fixed-height detail band after a row without breaking current fixed-row behavior.

**Acceptance criteria:**

- `DenseVirtualTable` supports optional detail rendering behind new props.
- Existing callers behave the same when the detail props are absent.
- Expanded detail row participates in virtualized height calculations.
- Detail row width matches the table min width and aligns with the row grid.
- Implementation does not require callers to mutate source data with fake detail rows.

**Verification:**

- Run focused Pyrus source/tests that cover Signals and dense table usage.
- Manually check Flow and Trade chain surfaces still render dense tables.
- `git diff --check -- artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx`

**Dependencies:** None.

**Files likely touched:**

- `artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx`

**Estimated scope:** Medium.

### Task 2: Replace Side Panel With Inline Expansion State

**Description:** Remove the Signals screen's side-panel layout and make row selection expand/collapse an inline drilldown.

**Acceptance criteria:**

- Signals content grid becomes one table-first column on desktop and compact layouts.
- Side-panel `SignalsDetailPanel` render paths are removed.
- One row can be expanded at a time.
- Clicking the active expanded row collapses it.
- Clicking Open in Trade does not toggle expansion.
- Selected symbol still syncs through `onSelectSymbol`.

**Verification:**

- Add or update a source/behavior test proving the side panel is gone and inline drilldown is present.
- Run `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/signals/signalsRowModel.validation.js src/features/platform/platformRootSource.validation.js --validation-name-pattern "Signals"`
- `git diff --check -- artifacts/pyrus/src/screens/SignalsScreen.jsx`

**Dependencies:** Task 1.

**Files likely touched:**

- `artifacts/pyrus/src/screens/SignalsScreen.jsx`
- `artifacts/pyrus/src/features/platform/platformRootSource.validation.js`

**Estimated scope:** Medium.

### Task 3: Build `SignalsRowDrilldown` With Content Parity

**Description:** Extract a row-owned drilldown component that preserves useful side-panel information and adds the reviewed hierarchy.

**Acceptance criteria:**

- Header strip shows symbol, status, direction, freshness, bars, signal time, signal price, and watchlists.
- Thesis section explains verdict, source, ranking/coverage, and current actionability.
- Interval proof matrix shows all configured Signals table timeframes.
- Dashboard/gate section shows trend, strength, ADX, volatility, trend age, MTF, and filter state when present.
- Latest event, error, and Trade action are visible without requiring the old side panel.
- Empty/missing fields use existing missing-value conventions.

**Verification:**

- Add focused model/component-source tests for the drilldown sections.
- Run `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/signals/signalsRowModel.validation.js src/features/platform/platformRootSource.validation.js --validation-name-pattern "Signals"`
- Browser QA later confirms text does not overlap at desktop and mobile widths.

**Dependencies:** Task 2.

**Files likely touched:**

- `artifacts/pyrus/src/screens/SignalsScreen.jsx`

**Estimated scope:** Medium.

### Task 4: Lazy-Load Chart Data For The Expanded Row

**Description:** Add chart hydration for only the currently expanded signal row, with safe loading/empty/error states and a signal marker.

**Acceptance criteria:**

- Chart request is enabled only when a row is expanded.
- Switching expanded rows cancels or supersedes stale chart state.
- Chart loading, empty, error, and route-pressure states are visible and bounded.
- Signal marker appears when signal time/price falls inside loaded chart bars.
- The implementation does not increase matrix hydration pressure for all table rows.

**Verification:**

- Add a source test that chart hydration is gated by expanded-row state.
- Run focused Pyrus chart and Signals tests.
- Browser QA with `?pyrusQa=safe`: expand a row, verify a bounded chart area, loading/empty state if bars are unavailable, and no all-row chart hydration.

**Dependencies:** Task 3.

**Files likely touched:**

- `artifacts/pyrus/src/screens/SignalsScreen.jsx`
- Potentially existing charting hook/model files if a small reusable signal chart hook is extracted.

**Estimated scope:** Medium to Large. Keep base chart and Pyrus overlay markers separable if this grows.

### Task 5: Add Keyboard, ARIA, And Mobile Polish

**Description:** Finish the interaction quality so the drilldown is not mouse-only or desktop-only.

**Acceptance criteria:**

- Row control exposes `aria-expanded` and `aria-controls`.
- Expanded band has stable `id` and accessible label.
- Enter and Space toggle expansion from the row control.
- Nested actions do not collapse the row.
- Phone layout stacks sections in priority order.
- Text and controls do not overlap at narrow widths.

**Verification:**

- Browser QA desktop and mobile viewports with `?pyrusQa=safe`.
- Keyboard smoke: Tab to row, Enter/Space expand, Tab through Trade action, collapse without focus loss.
- `pnpm --filter @workspace/pyrus run typecheck`

**Dependencies:** Tasks 2-4.

**Files likely touched:**

- `artifacts/pyrus/src/screens/SignalsScreen.jsx`
- `artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx`

**Estimated scope:** Small to Medium.

## Checkpoints

### Checkpoint 1: Inline Expansion Without Chart

After Tasks 1-3:

- Signals uses inline expansion and no side rail.
- All side-panel information has an inline equivalent.
- Dense table callers outside Signals still work.
- Focused Signals tests pass.

### Checkpoint 2: Chart And Proof Data

After Task 4:

- Expanded row chart loads only for selected row.
- Loading/empty/error chart states are explicit.
- Signal marker behavior is validated.

### Checkpoint 3: Implementation Ready

After Task 5:

- Desktop/tablet/phone behavior is verified.
- Keyboard and ARIA behavior is verified.
- Pyrus typecheck passes.
- Safe browser QA evidence is captured.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Virtualized table height bugs | Expanded content clips, overlaps, or jumps during scroll | Add explicit expanded-row support in `DenseVirtualTable`; keep detail height bounded. |
| Route pressure from charts | Signals screen becomes slower or hits 429s | Enable chart requests only for the expanded row and show route-pressure state. |
| Drilldown becomes too dense | Users cannot scan why a signal matters | Keep chart/verdict/thesis above proof data; move raw payloads behind disclosure or omit them. |
| Mobile row interaction is unclear | Taps feel accidental and controls conflict | Add visible expansion affordance, 44px touch targets, and propagation-safe nested actions. |
| Accessibility regression | Keyboard and screen-reader users cannot use drilldown | Specify `aria-expanded`, `aria-controls`, stable labels, and keyboard toggle behavior. |

## Validation Commands

Use targeted commands first:

```bash
pnpm --filter @workspace/pyrus exec node JS validation runner src/features/signals/signalsRowModel.validation.js
pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/platformRootSource.validation.js --validation-name-pattern "Signals"
pnpm --filter @workspace/pyrus run typecheck
git diff --check -- artifacts/pyrus/src/screens/SignalsScreen.jsx artifacts/pyrus/src/features/signals/signalsRowModel.js artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx docs/plans/signals-row-drilldown.md
```

Browser QA:

```text
Open the running app with ?pyrusQa=safe.
Wait for the Signals screen readiness selectors.
Expand and collapse several rows.
Verify Open in Trade does not toggle expansion.
Verify desktop and mobile layouts do not overlap.
Verify chart loading/empty/error state is bounded.
```

Do not use Replit's generated Configure workflow and do not edit startup config for this feature.

## Open Questions

- Should chart overlay markers ship in the first chart slice, or should the first chart slice only show bars plus the current signal marker?
- Should expanded-row state persist across filter/sort changes, or collapse whenever filters change?
- Should a collapsed row remain selected for header/watchlist context, or should expansion be the only selected state?

Recommended defaults for implementation:

- Ship base chart plus current signal marker first; add Pyrus overlay markers after the base interaction is stable.
- Preserve expansion across sort/filter only if the symbol remains visible; otherwise collapse.
- Keep selected symbol and expanded symbol the same for now to avoid two competing focus states.
