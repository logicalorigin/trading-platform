# WO-R5-B3A Report

## #11 - PhotonicsObservatory.jsx

- Reproduced: yes. Evidence: `PhotonicsObservatory.jsx:3677-3681` used vertical graph color from `VX[d.v].c`; `PhotonicsObservatory.jsx:3760-3766` rendered green/red profitability rings; `PhotonicsObservatory.jsx:4082-4086` hid the ring legend unless `colorMode !== "vertical"`.
- Stage-0 plan: `PhotonicsObservatory.jsx:3663-3671, 3759-3781, 4075-4086` - replace default vertical graph color with a non-semantic categorical palette, keep P&L ring red/green, and make the ring legend unconditional; verify with greps for `GRAPH_VERTICAL_COLORS`, ring legend, and removed `colorMode !== "vertical"`.
- Changed: `PhotonicsObservatory.jsx:139-147`, `PhotonicsObservatory.jsx:3677-3682`, `PhotonicsObservatory.jsx:3788-3791`, `PhotonicsObservatory.jsx:4085-4098`.
- Summary: default graph node stroke and inner fill now use a non-semantic vertical palette; brand colors remain available in non-default color modes; profitability ring legend is always visible.
- Stage-2 verification: `rg -n 'GRAPH_VERTICAL_COLORS|colorMode === "vertical"|ring =|colorMode !== "vertical"|BRAND\[d\.t\]' artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx` showed the in-file declaration and uses at lines 139, 3681, 3790, 4087, 4096 and no `colorMode !== "vertical"` match.
- Import/scope grep: same grep confirmed `GRAPH_VERTICAL_COLORS` is declared in this file before use; no new imports were introduced.
- Blocked/deferred: none.
- Stage-4 uncertainty: low. The authored vertical palette still includes warm hues, but not the app's red/green P&L pair in the default graph.

## #17 - GexScreen.jsx

- Reproduced: yes. Evidence: `GexScreen.jsx:2043-2080` rendered the primary gamma charts without a group heading; `GexScreen.jsx:2091-2120` nested `Open Interest Analysis` inside a grid column and placed volume under it; `GexScreen.jsx:2047,2094,2126,2143` used independent `auto-fit` chart grids.
- Stage-0 plan: `GexScreen.jsx:2043-2154` - add a primary gamma heading, lift OI and Volume into same-level headings, and replace chart-area grids with one shared column expression; verify with greps for headings, `chartGridColumns`, and remaining `auto-fit`.
- Changed: `GexScreen.jsx:1526-1529`, `GexScreen.jsx:2046-2172`.
- Summary: chart sections now use consistent same-level headings and a shared one/two-column chart grid; Volume Profile is no longer filed under Open Interest Analysis.
- Stage-2 verification: `rg -n 'chartGridColumns|auto-fit|SectionHeading title="Primary Gamma"|SectionHeading title="Open Interest Analysis"|SectionHeading title="Volume Profile"|LazyVolumeProfileChart|LazyExpiryChart' artifacts/pyrus/src/screens/GexScreen.jsx` showed `chartGridColumns` declared at line 1527 and used through the chart stack; the only remaining `auto-fit` was the top summary card at line 1835, outside the chart stack.
- Import/scope grep: same grep confirmed `chartGridColumns` is declared in component scope before use; no new imports were introduced.
- Blocked/deferred: none.
- Stage-4 uncertainty: low. Single-chart OI and Volume sections now occupy one column of the steady grid on non-phone layouts, which is intentional to keep chart widths aligned.

## #19 - AlgoSettingsRegion.jsx

- Reproduced: yes. Evidence: `AlgoSettingsRegion.jsx:156-173` set compact inputs to 22px high; `AlgoSettingsRegion.jsx:208-255` set switches to 27x16; `AlgoSettingsRegion.jsx:564-658` rendered boolean rows and value rows with different structures.
- Stage-0 plan: `AlgoSettingsRegion.jsx:156-173, 208-255, 564-658` - increase compact target sizing and make boolean/value cells use aligned label/control columns; verify with greps for constants, removed 16/22px compact targets, and in-file scope.
- Changed: `AlgoSettingsRegion.jsx:156-166`, `AlgoSettingsRegion.jsx:229-232`, `AlgoSettingsRegion.jsx:251-252`, `AlgoSettingsRegion.jsx:409-410`, `AlgoSettingsRegion.jsx:569-690`.
- Summary: compact inputs/chips and switches now use shared sizing constants, boolean and value settings align into consistent columns, and row height is 44px.
- Stage-2 verification: grep for `COMPACT_CONTROL_HEIGHT`, `COMPACT_SWITCH_WIDTH`, `COMPACT_SWITCH_HEIGHT`, `COMPACT_SWITCH_KNOB`, old 22px/16px compact heights, and the aligned `gridTemplateColumns` showed the new constants and aligned grids, with no remaining compact `height: dim(22)`, `height: dim(16)`, `minHeight: dim(16)`, or `minHeight: dim(20)` matches.
- Import/scope grep: `rg -n 'COMPACT_[A-Z_]+|CompactSwitch|CompactFieldInput|CompactLabel|gridColumn: "1 / -1"' artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx` confirmed all introduced constants/components are declared in this file before use; no new imports were introduced.
- Blocked/deferred: none. Field config remained untouched because `algoSettingsFields.js` is forbidden.
- Stage-4 uncertainty: low. The switch visual height is 28px, but the setting row target is 44px and the control is materially larger than before.

## #20 - PositionsPanel.jsx

- Reproduced: yes. Evidence: `PositionsPanel.jsx:4015-4038` rendered adjacent unlabelled asset/source `ToggleGroup`s; `PositionsPanel.jsx:127-134` labels the second group's all-state as `All Sources`, creating two adjacent all-style chips.
- Stage-0 plan: `PositionsPanel.jsx:4015-4038` - wrap asset/source chips in labelled groups and de-emphasize the rail when empty; verify with greps for `PositionFilterGroup`, `Asset`, `Source`, and unchanged `ToggleGroup` wiring.
- Changed: `PositionsPanel.jsx:1764-1793`, `PositionsPanel.jsx:4046-4072`.
- Summary: asset and source filters now have visible labels, subtle group containers, and the action rail dims when the table has no rows.
- Stage-2 verification: `rg -n 'PositionFilterGroup|positionFilterGroupStyle|label="Asset"|label="Source"|opacity: rows\.length|ToggleGroup options=\{ASSET_FILTERS\}|options=\{SOURCE_FILTERS\}' artifacts/pyrus/src/screens/account/PositionsPanel.jsx` showed the helper declaration and both labelled filter groups still using the original `ToggleGroup` calls.
- Import/scope grep: `rg -n 'cssColorMix|CSS_COLOR|FONT_WEIGHTS|RADII|T,|dim,|sp,|textSize|PositionFilterGroup' artifacts/pyrus/src/screens/account/PositionsPanel.jsx` confirmed helper dependencies were already imported and `PositionFilterGroup` is declared in-file before use.
- Blocked/deferred: Signals-screen half is intentionally out of scope because `SignalsScreen.jsx` is forbidden.
- Stage-4 uncertainty: none.

## Typecheck

Command:

```sh
cd /home/runner/workspace && pnpm --filter @workspace/pyrus run typecheck
```

Output:

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

Result: pass.
