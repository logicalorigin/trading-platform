# WO-R5-B4 Report

## Finding #02 - Market grid chrome dominates price

- Reproduced: yes. `FRONTEND_AUDIT_ROUND5.md:59-64` states each market grid cell repeats top toolbar, left rail, bottom cluster/footer chrome and makes price action the quietest read. Source mapping confirmed `MarketChartCell.jsx:579-598` renders `TradeEquityPanel` inside each cell and passes a chart frame placement into the shared `ResearchChartFrame` path.
- Stage-0 plan: scope a quieter market-only compact placement through `chartFrameDensity.tsx`, then have only `MarketChartCell` select it for compact market-grid cells; acceptance check is that existing `workspace`, `workspace-passive`, `compact-active`, and `compact-passive` policies remain unchanged and no non-market caller selects the new placement.
- Scoping lever: new `market-compact-active` / `market-compact-passive` frame placements in `chartFrameDensity.tsx`. Existing shared placements are unchanged at `chartFrameDensity.tsx:24-40` and `chartFrameDensity.tsx:53-61`; market-only placements are added at `chartFrameDensity.tsx:42-47` and `chartFrameDensity.tsx:63-67`.
- Files/line ranges changed:
  - `artifacts/pyrus/src/features/charting/chartFrameDensity.tsx:5-67`
  - `artifacts/pyrus/src/features/market/MarketChartCell.jsx:38-59`
  - `artifacts/pyrus/src/features/market/MarketChartCell.jsx:551-598`
- Change summary: compact market cells now use market-only frame placements with smaller overlay gutters. Market-cell scoped CSS mutes toolbar/control opacity and saturation, scales icons down, and restores full visibility on hover/focus. Controls remain rendered and focusable; no toolbar, rail, footer, or search control was removed.
- Stage-2 verification:
  - Non-market unchanged proof: `rg` found `market-compact` only in `chartFrameDensity.tsx` and `MarketChartCell.jsx`; `TradeEquityPanel.jsx:140` still defaults non-market compact charts to `"compact-active"` or `"workspace"`. Existing shared placement values remain unchanged at `chartFrameDensity.tsx:24-40` and `chartFrameDensity.tsx:53-61`.
  - Trade chart: source path still uses `TradeEquityPanel` default placement (`TradeEquityPanel.jsx:140`) unless a caller passes a placement; `TradeScreen` does not introduce `market-compact`.
  - Research chart: no `market-compact` references under research chart consumers; `ResearchChartFrame` still resolves old placement names through unchanged policies.
  - Account equity chart: `rg` showed account equity uses `screens/account/EquityCurveChart.jsx`, not the new market placement path; no `market-compact` references under account screens.
  - New identifier check: `MARKET_CHART_CELL_CHROME_CSS`, `MARKET_GRID_CHROME_PLACEMENT`, `market-compact-active`, and `market-compact-passive` are defined and referenced in-scope by `rg`.
- Blocked/deferred notes: no code blocker. Runtime/browser visual QA was not run; verification is source-scoping plus typecheck.
- Stage-4 uncertainty: the source scoping is strong, but without a screenshot I cannot quantify the final visual balance. The top risk, shared-chart regression, is mitigated by additive placement names and by only selecting them from `MarketChartCell`.

## Finding #08 - Research force graph illegible pile

- Reproduced: yes. `FRONTEND_AUDIT_ROUND5.md:101-106` states the graph collapses dense center labels and leaves the right third empty. Source mapping found the force setup at `PhotonicsObservatory.jsx:3754-3761` and label rendering at `PhotonicsObservatory.jsx:3821-3843`.
- Stage-0 plan: normalize graph x targets across the canvas, increase charge/collision/link spacing, and suppress labels below a prominence threshold while restoring labels on hover/selection/search; acceptance check is that labels remain reachable through the original node hover/click targets and #11 vertical colors plus profitability ring legend remain.
- Files/line ranges changed:
  - `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:153`
  - `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:3626-3628`
  - `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:3714-3761`
  - `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:3821-3843`
  - `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:4037-4052`
- Change summary: graph targets now stretch authored/auto positions across the full SVG width, node repulsion/collision is stronger, and labels render by default only for prominent nodes. Small-node ticker and data labels remain available through hover, click selection, connected-node selection, search match, and zone focus.
- Stage-2 verification:
  - Force tuning present: `forceManyBody().strength(-34).distanceMax(170)` and `forceCollide().radius(d => d.r + 12).strength(1)` at `PhotonicsObservatory.jsx:3758-3759`; x target spreading at `PhotonicsObservatory.jsx:3714-3728`.
  - Labels reachable: original node groups still own `mouseenter`, `mousemove`, `mouseleave`, `click`, drag, and dblclick handlers at `PhotonicsObservatory.jsx:3845-3920`; only text `fill-opacity` changes at `PhotonicsObservatory.jsx:3827-3843` and `PhotonicsObservatory.jsx:4037-4052`.
  - #11 intact: `GRAPH_VERTICAL_COLORS` remains at `PhotonicsObservatory.jsx:139-147`, the vertical color fill path remains at `PhotonicsObservatory.jsx:3806`, `profit-ring` remains at `PhotonicsObservatory.jsx:3792` and `PhotonicsObservatory.jsx:4055`, and the always-visible ring legend remains at `PhotonicsObservatory.jsx:4123-4136`.
  - New identifier check: `GRAPH_PROMINENT_LABEL_RADIUS`, `shouldShowGraphNodeLabel`, `spreadTargetX`, `resolveNodeLabelOpacity`, `node-label`, and `node-sub-label` are defined/referenced in-scope by `rg`.
- Blocked/deferred notes: no code blocker. Runtime/browser visual QA was not run; verification is source-scoping plus typecheck.
- Stage-4 uncertainty: stronger force tuning can change the exact graph composition across datasets. The main risk is over-spreading a small universe, but target normalization is bounded to the SVG and y targets are clamped.

## Process Note

- Work-order exception: I accidentally ran `git status --short` during initial repo-state inspection before rereading the hard constraint. No further git commands were run.

## Typecheck Output

Command:

```sh
pnpm --filter @workspace/pyrus run typecheck
```

Output:

```text
> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```
