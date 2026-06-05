# Algo Right-Rail Control-Panel Redesign + CSS Container-Query Width System

## Context

The Algo page right-rail control panel — a scrollable controls frame (`HaltStrip` +
`AlgoSettingsRegion`), a separate fixed-height read-only diagnostics frame
(`AlgoDiagnosticsFooter`), and a sticky `AlgoSaveBar` — is dense and hard to scan: a confusing
two-tier layout (compact summary groups *and* full-size sections), flat dropdowns/number inputs for
inherently spatial concepts (strike offsets, exit ladders), and halt status reduced to a tiny dot.
Width adaptation is entirely JS-driven (inline `gridTemplateColumns` from `useElementSize` +
`responsiveFlags` in `artifacts/pyrus/src/lib/responsive.ts`); there are no CSS container queries.

This redesign delivers bespoke visuals for the spatial controls, a unified consistently-aligned
dense layout, and a move to **CSS container queries** as the new app-wide width-adaptation standard
— applied fully to the rail now, with a documented convention and rollout checklist for the other
screens.

All files under `artifacts/pyrus/`. Package `@workspace/pyrus`. Single global stylesheet
`artifacts/pyrus/src/index.css` (imported in `main.tsx`; class-based; **read/asserted by
`artifacts/pyrus/src/lib/uiTokens.validation.js`** — keep it green). No backend / OpenAPI /
`optionSelection` / `exitPolicy` schema changes; no new dependencies.

## Decisions locked

- **Width adaptation:** CSS container queries (`@container`) replace in-rail JS grid templates; new app-wide standard. Convention now, rollout-checklist for other screens later.
- **Settings structure:** unify the two tiers into one — each setting appears once, as a **dense compact cell** (inputs + toggles only, **no sliders**), all sections open, **impact chips kept**.
- **Sections (top → bottom):** `HaltStrip` board (top), then settings: **Signal · Risk · Gates · Contract · Fills · Exits · Quality Exits** (Overnight folds into Exits).
- **Bespoke visuals:** strike ladder, horizontal exit track, halt status board.
- **Strike ladder:** schematic slot ladder (no live quotes), **two radio columns** (CALL/PUT), ATM divider, **6 slots kept**, DTE folded in. **Green calls / red puts.**
- **Exit track:** horizontal PnL axis for %-positioned levels; non-axis fields as compact cells below; markers edit via **click → inline numeric input**.
- **Halt board:** always-expanded, clearer; active/forced rows pop.
- **Diagnostics frame & save bar:** polish only.

## Design-token vocabulary (used by every spec below)

From `lib/uiTokens.jsx`: `CSS_COLOR.{bg0,bg1,bg2,bg3,border,borderLight,text,textSec,textDim,textMuted,
accent,onAccent,green,red,amber,cyan}`; helpers `sp()`, `dim()`, `textSize()`, `cssColorMix`,
`cssColorAlpha`; `T.{sans,data}`; `FONT_WEIGHTS.{regular,label,emphasis}`; `RADII.{xs,sm,md}`.
Standard tints: status surfaces use `cssColorMix(tone, 7)` background / `cssColorMix(tone, 21)` border.

---

# Part A — Foundation: container queries + alignment

### A1. `index.css` reflow utilities
- `.algo-rail-cq { container-type: inline-size; }` — applied to the controls scroll body and the diagnostics frame in `AlgoRightRail.jsx`.
- `.algo-settings-grid` — `display:grid; column-gap:var(--sp5); row-gap:var(--sp4); align-items:start;`
  default `grid-template-columns: repeat(4, minmax(0,1fr));`
  `@container (max-width:560px){ repeat(3,…) }` · `(max-width:420px){ repeat(2,…) }` · `(max-width:300px){ 1fr }`.
  (Step widths reproduce today's phone<768 / narrow<1024 behavior but keyed to the ~380px rail.)
- `.algo-diag-kpi-grid` — default `repeat(6,minmax(0,1fr))`; `@container (max-width:520px){ repeat(3,…) }` · `(max-width:320px){ repeat(2,…) }`.
- `.algo-cell--wide{ grid-column: span 2; }`, `.algo-cell--full{ grid-column: 1 / -1; }`.

### A2. Alignment utility + rule
- `.tnum{ font-variant-numeric: tabular-nums; }`.
- **Rule (documented in code comment + this doc):** numeric values/inputs are right-aligned and `.tnum`; labels left; tabular layouts use fixed-px numeric columns + a `minmax()` label column (the `DenseVirtualTable` pattern, made uniform).

### A3. Retire in-rail JS reflow
Remove `gridTemplateFor` / `compactGridTemplateFor` + `algoIsPhone` / `algoIsNarrow` layout branching
from `AlgoSettingsRegion.jsx`, and `controlColumns` from `HaltStrip.jsx`; apply the classes above.

---

# Part B — Shared cell primitives (spec'd once, reused everywhere)

### B1. `SettingsSectionHeader` (exists; keep, restyle)
- **Anatomy:** flex row, baseline-aligned, space-between. Left = label `<span>`; right = optional helper.
- **Label:** `T.sans`, `textSize("caption")`, `FONT_WEIGHTS.emphasis`, uppercase, `letter-spacing:0.08em`, `CSS_COLOR.textDim`.
- **Helper:** `textSize("micro")`, `CSS_COLOR.textMuted`, `white-space:nowrap`; shows `"{n} unsaved"` when section dirty count > 0, else null.
- **Divider/spacing:** `border-bottom:1px solid borderLight`; `padding-bottom:sp(4)`; `margin-bottom:sp(3)`.

### B2. Compact cell `CompactSettingCell` (exists; becomes the universal field control)
- **Container:** `<label>` flex column, `gap:sp(2)`, `min-height:dim(42)`, `min-width:0`. `.algo-cell--wide` when the field is wide (compound/steps).
- **Row 1 — `CompactLabel`:** flex row, `gap:sp(2)`, baseline.
  - Label text: `T.sans`, `textSize("caption")`, `FONT_WEIGHTS.label`, `CSS_COLOR.textSec`, single-line ellipsis.
  - **Dirty dot:** `dim(5)` circle, `CSS_COLOR.accent`; shown when `fieldKey(field) ∈ dirtyFieldKeys`; `transition: opacity 120ms`.
  - **Impact chip** (kept): pill, `textSize("micro")`, `padding:sp("0 4px")`, `border-radius:dim(RADII.xs)`; text `"{count}/{total}"` or `"{n} block"`; tone amber (`cssColorMix(amber,12)` bg) when count>0 and `warningWhenNonZero!==false`, else `CSS_COLOR.textMuted` neutral. `title` tooltip lists sample symbols.
- **Row 2 — input (`CompactFieldInput`)** by `field.type`:
  - `number`: `<input type=number>` — `compactInputStyle`: `height:dim(24)`, `padding:sp("0 6px")`, `border:1px solid border` (→`red` if invalid), `border-radius:dim(RADII.xs)`, `background:bg1`, `color:text`, `font:T.data`, `font-size:textSize("caption")`, **right-aligned + `.tnum`**, `min/max/step` from field, optional unit suffix span (`textMuted`, `compactUnitLabel`).
  - `boolean`: `CompactSwitch` (B3), right-aligned in the row.
  - `select`/`segmented`: native select or `SegmentedControl` (B4) at `dim(24)` height.
  - **No `slider`** — any field typed `slider`/`logSlider` renders as `number` with a stepper.
- **States:** default; **hover** (input border → `cssColorMix(accent,40)`); **focus-visible** (`outline:1px solid accent; outline-offset:1px`); **disabled** (`opacity:0.55; pointer-events:none` when no `focusedDeployment` or a mutation is pending); **invalid** (red border + `textSize("micro")` red message replacing the unit line); **dirty** (dot visible).

### B3. `CompactSwitch` toggle (exists)
- **Track:** `dim(27)×dim(16)`, `border-radius:999px`, `border:1px solid`; off = `border`/transparent, on = `accent` border + `cssColorMix(accent,18)` fill. **Knob:** `dim(11)` circle, animated `transform` `transition:140ms`.
- **States:** hover (border → accent), focus-visible (outline as B2), disabled (opacity 0.55). `role="switch"`, `aria-checked`, `aria-label` from field label.

### B4. `SegmentedControl` (exists, `primitives.jsx`)
- Equal-width segments at `dim(24)` height; selected segment `accent` text + `cssColorMix(accent,14)` bg; others `textSec`. `role="radiogroup"`. Used for enumerated fields (e.g. `bosConfirmation`).

---

# Part C — HaltStrip status board (bespoke)

Always-expanded board; data wiring unchanged (`deriveSignalOptionsHaltControlStatus`, `cockpit`,
`overallHaltState`, `*HaltControls.*`, `InlineSwitch`, `CompactSettingInput`).

### C1. Board container
- `padding:sp("8px 12px")`; groups stacked, `gap:sp(3)`. Header row: deployment name (`T.sans`, `textSize("body")`, `FONT_WEIGHTS.label`, `text`) left; **overall status pill** (C4) right.

### C2. Group section
- Each group `<section>`; non-first gets `border-top:1px solid borderLight; padding-top:sp(2)`.
- **Group header:** group label (`textSize("micro")`, weight 600, uppercase, `textSec`) + **rollup chip** (C4 mini) reflecting the worst child state.
- Controls in `.algo-settings-grid`.

### C3. Halt control row `ControlToggleCell`
- **Container:** flex column, `gap:sp(2)`, `min-height:dim(42)` (toggle-only = `dim(22)`), `min-width:0`, `position:relative`, `padding-left:sp(2)`.
- **Left accent bar:** `::before`, `width:dim(2)`, full height, `border-radius:1px`; color = state tone; visible only for `active`/`forced` (else transparent) — this is the "pop".
- **Row 1:** status icon (13px lucide, tinted by state) · short label (`textSize("caption")`, `FONT_WEIGHTS.label`, ellipsis, color by enabled state) · dirty dot (B2) · **state pill** (C4) · `InlineSwitch` (`dim(25)×dim(14)`).
- **Row 2 (if `valueField`):** `CompactSettingInput` — number, `.tnum` right-aligned, unit suffix.
- **`title` tooltip:** `"{label} · {stateLabel} · {n} recent blocks · {current}→{baseline}"`.

### C4. State pill (`Armed | Active | Off | Forced`)
- Pill: `textSize("micro")`, `FONT_WEIGHTS.label`, `padding:sp("0 5px")`, `border-radius:999px`, `border:1px solid tone`, `background:cssColorMix(tone,7)`, `color:tone`.
- Tones: **Armed** = `cyan`; **Active** = `red`; **Off** = `amber`; **Forced** = `red` (solid border, `cssColorMix(red,9)` bg). Overall pill (header) uses `overallHaltState` label/color; mini rollup chip = same, smaller.

---

# Part D — Unified settings region

`algoSettingsFields.js`: replace the two-tier exports with one `SETTINGS_SECTIONS` array
(`{id,label,fields[]}`), each field once, rendered as a B2 cell. Mapping (existing paths):

| Section | Fields (paths) |
|---|---|
| Signal | `signalTimeframe`, `timeHorizon`, `bosConfirmation`, `chochAtrBuffer`, `chochBodyExpansionAtr`, `chochVolumeGate` |
| Risk | `riskCaps.maxPremiumPerEntry`, `maxContracts`, `maxOpenSymbols`, `maxDailyLoss` |
| Gates | `entryGate.mtfAlignment.enabled`/`requiredCount`, `entryGate.bearishRegime.minAdx`/`enabled`/`rejectFullyBullishMtf` |
| Contract | `optionSelection.*` → **Part E block** |
| Fills | `liquidityGate.maxSpreadPctOfMid`/`minBid`/`requireBidAsk`/`requireFreshQuote`, `fillPolicy.ttlSeconds`/`chaseSteps` |
| Exits | **Part F track** + cells: `exitPolicy.earlyExitBars`, `progressiveTrailEnabled`/`progressiveTrailSteps`, `flipOnOppositeSignal`, `overnightExitEnabled`/`overnightMinGainPct`/`overnightRunnerGivebackPct` |
| Quality Exits | `exitPolicy.conditionalQualityExitsEnabled` + low/high quality bars/loss, weak/strong liquidity giveback, HQ overnight min |

- `AlgoSettingsRegion.jsx`: one loop over `SETTINGS_SECTIONS`; each section = `SettingsSectionHeader` + a `.algo-settings-grid`; **Contract** and **Exits** sections use a custom renderer (bespoke block then remaining cells). Delete `settingsRegionFields`, the full-size `SettingsFormRow` path, and `isCompactSettingPath` filtering. Section dirty count drives the header helper.
- `ExpandedLimitsSection` banner: keep; align text `.tnum`; APPLY button unchanged.

---

# Part E — Contract block (`ContractSelectionCell`)

Spans `.algo-cell--full`. Controls six `optionSelection.*` fields (no schema change).

### E1. DTE row
- `.algo-settings-grid` of 3 cells: **Min DTE** compound (number input + `allow0DTE` `CompactSwitch`, reusing the old `minDtePolicy` pairing), **Target DTE**, **Max DTE** — all number, `.tnum`, unit `"d"`.

### E2. Strike ladder
- **Grid:** `grid-template-columns: minmax(0,1fr) dim(44) dim(44)` (STRIKE label flexible; CALL/PUT fixed). Row height `dim(26)`.
- **Header row:** `STRIKE · CALL · PUT` — `textSize("micro")`, uppercase, `textMuted`; CALL/PUT centered; dirty dot next to CALL/PUT when that slot field is dirty.
- **6 slot rows**, descending value 5→0 (`Upper +2 … Lower −2`); label `textSize("caption")`, `textSec`.
- **ATM divider:** between slot 3 (`ATM upper`) and slot 2 (`ATM lower`): full-width `1px` `borderLight` line with centered `─── ATM ───` micro caption; ATM rows (3,2) get `background:cssColorMix(text,3)`.
- **Radio cell (CALL / PUT):** `role="radio"` button, `dim(18)` hit area centered in the column.
  - Unselected: `dim(10)` ring (`1px solid border`).
  - **Selected:** filled disc — **CALL = `green`**, **PUT = `red`** (`background:tone`, `box-shadow:0 0 0 2px cssColorMix(tone,18)`).
  - Hover: ring → `cssColorMix(tone,50)`; row bg `bg2`. Focus-visible: outline (B2). Disabled: opacity 0.55.
  - Click patches `optionSelection.callStrikeSlot` / `putStrikeSlot` (mutually exclusive per column).
- **A11y:** each column `role="radiogroup"` with `aria-label="Call strike slot"/"Put strike slot"`; arrow-key navigation moves selection within the column; `aria-checked` on cells.
- **Test hooks:** `algo-strike-ladder`, `algo-strike-ladder-{call|put}-{slot}`.
- **Wiring:** one `{kind:"contractSelect"}` group entry; `resolveCompactRailItem` branch resolves the 6 fields via `getSettingFieldByPath`; render branch in `AlgoSettingsRegion.jsx`. Profile-slice → `patchProfileDraftPath`.

---

# Part F — Exit track (`ExitLadderTrack`)

Spans `.algo-cell--full`; below it a `.algo-settings-grid` of the non-axis cells.

### F1. Axis
- Horizontal rail, `height:dim(2)`, `background:border`, with a domain spanning min(hardStop, earlyLoss) … max(10x). Entry tick at 0% drawn as a `dim(2)×dim(14)` `textDim` vertical with `0%` caption below.
- Axis labels (min/0/max) `textSize("micro")`, `textMuted`, `.tnum`.

### F2. Markers (one per %-positioned `exitPolicy.*` level)
- Levels: hard stop, early-exit loss (left of 0); trail activation, min locked gain, 5x tighten, 10x tighten (right of 0). Position = value mapped along the domain.
- **Marker:** `dim(10)` disc on the axis; loss/stop tone `red`, gain/trail tone `green`, neutral `accent`; label above (key) + value below (`.tnum`), `textSize("micro")`.
- **States:** hover (disc grows to `dim(12)`, `box-shadow` ring); focus-visible outline; dirty → accent ring; collision handling — if two markers overlap, stagger labels vertically.
- **Edit (click → inline input):** clicking a marker opens a small popover anchored to it: a single `CompactSettingInput` (number, `.tnum`, unit `%`, min/max/step from field) + done/esc. Enter/blur commits via `patchProfileDraftPath`; Esc cancels. Only one popover open at a time.
- **Test hooks:** `algo-exit-track`, `algo-exit-track-marker-{key}`, `algo-exit-track-input-{key}`.

### F3. Non-axis cells (below track)
- B2 cells: `earlyExitBars` (number, unit `bars`), `progressiveTrailEnabled` (toggle), `progressiveTrailSteps` (`.algo-cell--wide`, text via `format/parseProgressiveTrailSteps`), `flipOnOppositeSignal` (toggle), `overnightExitEnabled` (toggle), `overnightMinGainPct` (number %), `overnightRunnerGivebackPct` (number %). Keep dirty dots + impact chips.

---

# Part G — Diagnostics + save bar (polish only)

### G1. `AlgoDiagnosticsFooter` → `AlgoDiagnosticsTab` (readOnly)
- Keep the separate fixed-height frame (desktop `210px`, phone `30vh`) with its own scroll + top border.
- KPI cards (Fresh/Stale/Blocked/Filled/Marks/Gateway) → `.algo-diag-kpi-grid`; each card: uppercase micro label + big `.tnum` value, color-coded (red Blocked/Gateway >0; else green/cyan/amber). `DiagPanel` rows: label left, value right `.tnum`.

### G2. `AlgoSaveBar`
- Keep sticky bottom (`position:sticky; bottom:0; z-index:20`), `bg1`, top `border`, upward shadow.
- Clean: `"All changes saved"` + green check, buttons disabled. Dirty: `"{n} unsaved changes"` button (chevron) opening a popover (`max-height:240px`, scroll) listing `section · field` + `old→new` in `.tnum` `T.data`. Buttons: **Discard** (ghost; confirm if >5) and **Save changes** (primary; spinner while pending; `aria-keyshortcuts` Cmd/Ctrl+S). Esc closes popover.

---

## Files to modify

- `index.css` — Part A utilities.
- `screens/algo/AlgoRightRail.jsx` — `container-type` on controls + diagnostics frames.
- `screens/algo/algoSettingsFields.js` — `SETTINGS_SECTIONS`, `contractSelect` resolver branch, drop two-tier exports.
- `screens/algo/AlgoSettingsRegion.jsx` — single section loop; B2 cells; `ContractSelectionCell`; `ExitLadderTrack`; remove full-size path.
- `screens/algo/HaltStrip.jsx` — board redesign (C1–C4) + class reflow.
- `screens/algo/AlgoDiagnosticsTab.jsx`, `AlgoDiagnosticsFooter.jsx`, `AlgoSaveBar.jsx` — polish (G).
- `lib/uiTokens.validation.js` — keep/extend `index.css` assertions.
- Delete `SettingsFormRow.jsx` only if no other importer.

## Verification

1. `pnpm --filter @workspace/pyrus typecheck`.
2. `pnpm --filter @workspace/pyrus run test` — add focused tests: `ContractSelectionCell` (CALL/PUT click patches correct path+slot; selected renders `aria-checked`; arrow-key nav), `ExitLadderTrack` (marker click opens input; commit patches correct `exitPolicy.*`; Esc cancels), `HaltStrip` (state pill + left-accent per status). Keep `uiTokens.validation.js` green.
3. **Container-query reflow smoke (key check):** run app → Algo page → resize window / collapse-expand shell sidebars so the rail width changes. Confirm halt board, sections, strike ladder, exit track, diagnostics reflow purely via CSS at ~380px and phone. Verify green-call/red-put tones, tabular right-aligned numerics, all element states (hover/focus/disabled/dirty/invalid), dirty dots, and save/discard.
4. If any Replit startup file is touched (it should not be), run `pnpm run audit:replit-startup`.

## Part H — App-wide rollout checklist (follow-up, not this PR)

Document Part A as the standard, then migrate container-driven screens off `useElementSize` + inline
templates to `@container` + the alignment conventions, in priority order:

1. `AccountScreen.jsx` / `PositionsPanel.jsx` (densest tables; pairs with the TWS positions-table plan).
2. `GexScreen.jsx`, `FlowScreen.jsx`.
3. `TradeScreen.jsx` / `TradeChainPanel.jsx`.
4. `PlatformShell.jsx` — keep `useViewport` for shell-level decisions (sidebar collapse, header KPI tiers); adopt `@container` only for inner content grids.

Each step: swap inline grid templates for the shared classes, set `container-type` on the screen
root/cards, apply `.tnum`/right-align to numeric columns, verify reflow by resizing.
