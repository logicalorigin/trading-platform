# WO-07 Round-5 Frontend Audit Triage

Date: 2026-07-07  
Worker: codex-worker for claude-lead session f68a9158  
Scope: read-only investigation; no source edits, no commits, no runtime/browser pass.  
Observed HEAD: `1d5e0b9d`

## Counts

- Round-5 shortlist: 22 findings.
- Fixed since audit at HEAD: 3 (`#01`, `#06`, `#21`).
- Still open or partially open: 19.
- Legacy Round-2/4 residuals found at HEAD: 5 actionable leftovers plus 2 prior won't-fix rulings to preserve.
- Live-eyeball pass: deferred. Source inspection can verify markup/state paths, but cannot close visual-only claims like graph overlap or clipped labels.

## Prior Decisions To Preserve

| Origin | Status | Finding | Verdict |
|---|---:|---|---|
| Round 2 #09/#10 | won't-fix | GEX heatmap red/green diverging scale | Riley decided this is an allowed data-viz scale. Do not recolor to blue. |
| Round 2 #11 / FLOW-03 | won't-fix | Flow news sentiment green/red | Riley decided news sentiment is editorial tone, not buy/sell direction. Do not recolor. |
| Round 2 #43/#44 | won't-fix | Research ambient orbs/glow | Riley kept subtle RES-13 decorative depth. Do not reopen from Round-2 alone. |

## Round-5 Open-Set Table

| # | Class | Current evidence | Verdict | Dispatch |
|---:|---|---|---|---|
| 01 | loading duplication | `DataUnavailableState` only passes wait status when `loadingWaitItems` exist; Account fallback no longer imports `ContainerLoadingStatus`. `PlatformAlgoMonitorSidebar.jsx:1532` still passes `loadingEndpoint`, but shared primitive suppresses the duplicate simple loading line. | fixed | none |
| 02 | market chart chrome | `ResearchChartSurface.tsx:12214` always renders toolbar groups when `showToolbar`; controls at `12270` remain in per-cell surface. | still open | structural |
| 03 | Algo broker-down duplication | `AlgoLivePage.jsx:940` emits `broker off`; `AlgoStatusBar.jsx:155` emits `BROKER OFF`; `AlgoLivePage.jsx:944` and `AlgoStatusBar.jsx:171` can also emit `bridgeTone`. | still open | structural |
| 04 | Flow scanner clipped/status space | `FlowScannerStatusPanel.jsx:243-246` still ellipsizes source label; current batch value is capped at 3 symbols at `309`; empty Algo Monitor still occupies a normal sidebar state at `PlatformAlgoMonitorSidebar.jsx:1540`. Needs screenshot to confirm severity. | still open, live-unverified | structural |
| 05 | duplicated theme control | `SettingsScreen.jsx:1545` has Dark/Light segmented control; `SettingsScreen.jsx:1640` has System/Dark/Light Select. They still can report different states. | still open | structural |
| 06 | unknown/error color fall-through | `SettingsScreen.jsx:2581-2586` maps error/critical red and warning/unknown/degraded amber. `DiagnosticsScreen.jsx:218-222` maps unknown/degraded to warning. | fixed | none |
| 07 | Account KPI ticker | `AccountHeroBlock.jsx:164-175` splits Adj return/P&L, but `performanceRailMetrics` still appends many equal rail metrics and renders horizontally. | partially open | structural |
| 08 | Research graph overlap | Source still uses compact graph `W=680,H=390`, charge `-10`, collision `r+3` at `PhotonicsObservatory.jsx:3660` and `3728-3735`; labels render for all nodes at `3795-3811`. Needs visual pass for exact overlap. | still open | structural |
| 09 | Backtest empty lead / duplicate create | `BacktestingPanels.tsx:1316` still renders Promoted Drafts; empty workbench action at `2841` and form action at `3106` both create/save study. | still open | structural |
| 10 | Signals repeated interval state | Hydration strip still renders per-timeframe chips at `SignalsScreen.jsx:3023-3157`; interval tiles/header still exist (`4571` header label path). | still open | structural |
| 11 | Research red/green mixed encodings | Fill color defaults to vertical at `PhotonicsObservatory.jsx:3671`; profit ring is green/red at `3763`; ring legend only renders when `colorMode !== "vertical"` at `4082`. | still open | judgment |
| 12 | Diagnostics glyphs / n/o | Glyph legend exists (`MachineStateDiagram.jsx:1598-1607`), but glyph vocabulary remains `?`, `◌`, `!`, `–` at `200-207`, and `"not observed" -> "n/o"` remains at `723`. | partially open | mechanical |
| 13 | Flow preset chips duplicate filters | Preset row still renders at `FlowScreen.jsx:4397-4423`; filter panel repeats Flow and Min Premium pills at `3763-3795`. | still open | structural |
| 14 | nested chart loading surfaces | `ResearchChartSurface.tsx:13942-13952` still renders a bordered elevated panel over skeleton; trade chain moved to `DataUnavailableState` but chart surface issue remains. | partially open | primitive/surface |
| 15 | trade chart empty/loading paradigms | `TradeChainPanel.jsx:812-820` still amber/loading; `ResearchChartSurface.tsx:13936-13985` has separate chart empty style. Needs screen pass for side-by-side consistency. | still open, live-unverified | primitive/surface |
| 16 | watchlist management chrome | Full menu/name is improved, but management buttons/sort/filter remain dense in `PlatformWatchlist.jsx:1484-1668`. Account-specific hiding not observed. | partially open | structural |
| 17 | GEX inconsistent headings/grids | Primary grid at `GexScreen.jsx:2000-2046` has no top group heading; OI heading is nested in a grid column at `2060`; repeated independent auto-fit grids remain. | still open | structural |
| 18 | contradictory counts/loading | Market label is fixed to `N charts · N hydrated` at `MultiChartGrid.jsx:1331-1334`. Flow tape header at `FlowScreen.jsx:4606-4617` still labels tape counts while distribution panel follows separately. | partially open | mechanical |
| 19 | Algo settings cramped/mixed controls | Progressive trail/control cluster still uses tight auto-fit cells and green step tiles at `AlgoSettingsRegion.jsx:2461-2541`; source still suggests dense mixed control wall. Needs visual pass for 44px claim. | still open | structural |
| 20 | Signals/account filter bands | Signals icon buttons now have aria-labels/tooltips at `SignalsScreen.jsx:4785-4822`; Account positions filter group not verified as fixed. | partially open | structural |
| 21 | Backtest design-doc prose | Round-5 phrases no longer found by source search; persistent prose reduced to concrete form summary. | fixed | none |
| 22 | weak GEX symbol selector | Symbol control still an input embedded in a small field next to louder segmented controls at `GexScreen.jsx:1606-1650`; no top-left symbol title observed. | still open | structural |

## Legacy Round-2/4 Residuals At HEAD

| Origin | file:line | Issue | Canonical replacement | Effort | Batch |
|---|---|---|---|---:|---|
| Round 2 follow-up | `artifacts/pyrus/src/features/market/MarketActivityPanel.jsx:760` | Signal row buy direction still uses `CSS_COLOR.green`. | `SEMANTIC_TONE.directionBuy` or `toneForDirectionalIntent("buy")`; keep red for sell. | S | mechanical color |
| Round 4 platform-shell family | `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1399` | Watchlist menu "Default" label still green though default selection should be accent. | `CSS_COLOR.accent`; if tinted fill needed, `cssColorMix(CSS_COLOR.accent, 7)`. | S | mechanical color |
| Round 2 skipped primitive | `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:1338` | Static period return chip remains hand-rolled; prior Pill swap was skipped because `Pill` is interactive. | Keep until a static `Badge`/`PillStatic` API with tooltip/static semantics exists. | M | judgment/primitive API |
| Round 2 skipped primitive | `artifacts/pyrus/src/features/backtesting/PatternDiscoveryPanel.tsx:229` | `FamilyChip` remains custom because canonical `Badge` lacked title passthrough. | Add/confirm `Badge title` support, then migrate. | M | primitive/surface |
| Round 4 low typography | `artifacts/pyrus/src/screens/algo/PipelineStrip.jsx:255` | Raw `fontWeight: 600` remains. | `FONT_WEIGHTS.label`. | S | mechanical color/tone |

Obsolete/fixed legacy checks observed: Market combobox raw input from Round 2 #47 no longer exists in `MarketActivityPanel`; QuoteStrip uses `MetricChip`; Footer `LevelPill` uses `StatusPill`; Watchlist desktop/mobile default buttons use accent at `1513-1515` and `1864-1867`.

## Dispatch Batches

### Batch A - Mechanical Color/Tone Swaps

Estimated files touched: 5.

| file:line | Issue | Canonical replacement | Effort |
|---|---|---|---:|
| `features/market/MarketActivityPanel.jsx:760` | Directional buy still green. | `toneForDirectionalIntent("buy")` / `SEMANTIC_TONE.directionBuy`. | S |
| `features/platform/PlatformWatchlist.jsx:1399` | Default watchlist label in menu still green. | `CSS_COLOR.accent`. | S |
| `screens/diagnostics/MachineStateDiagram.jsx:723` | `n/o` abbreviation remains. | Replace with `not observed` or `no data`; keep status detail truncation readable. | S |
| `screens/diagnostics/MachineStateDiagram.jsx:200-207` | Unknown uses `?`, which reads as help. | Use plain legend-backed label or less-help-like glyph; keep legend counts at `1598`. | M |
| `screens/algo/PipelineStrip.jsx:255` | Raw font weight. | `FONT_WEIGHTS.label`. | S |

### Batch B - Primitive / `surfaceStyle` / Empty-State Migrations

Estimated files touched: 5-6, depending on whether primitive API is extended.

| file:line | Issue | Canonical replacement | Effort |
|---|---|---|---:|
| `features/charting/ResearchChartSurface.tsx:13942` | Loading/empty state is still an elevated card over chart skeleton. | Flat centered label on skeleton; no border/bg/shadow; merge eyebrow/title. | M |
| `features/trade/TradeChainPanel.jsx:812` | Chain loading uses amber `DataUnavailableState`; verify against sibling chart panels. | Standard loading treatment across spot chart, option chart, chain. | M |
| `features/backtesting/PatternDiscoveryPanel.tsx:229` | `FamilyChip` custom due missing `Badge` title passthrough. | Add `title` support to `Badge` or use a static chip primitive, then migrate. | M |
| `features/research/PhotonicsObservatory.jsx:1338` | Static return chip still custom. | Static `Badge`/`MetricChip` variant, not interactive `Pill`. | M |
| `components/platform/primitives.jsx` or `components/ui/*` | Needed only if adding a static chip/title-capable primitive. | Minimal primitive API addition; preserve noninteractive semantics. | M |

### Batch C - Structural Layout / De-Card / Single-Source UI

Estimated files touched: 12-15. Split further if assigning to multiple workers.

| file:line | Issue | Canonical replacement | Effort |
|---|---|---|---:|
| `features/market/MarketChartCell.jsx:528` + `features/charting/ResearchChartSurface.tsx:12214` | Per-cell toolbar chrome remains always present when enabled. | Rest state: ticker/timeframe/expand only; reveal tools on hover/focus; overflow for secondary actions. | L |
| `screens/algo/AlgoLivePage.jsx:940` + `screens/algo/AlgoStatusBar.jsx:155` | Broker/bridge state duplicated. | One authoritative status chip plus one gateway action surface. | M |
| `features/flow/FlowScannerStatusPanel.jsx:243` + `features/platform/PlatformAlgoMonitorSidebar.jsx:1540` | Flow scanner may still truncate while empty monitor claims rail. | Allocate width to scanner; collapse idle Algo Monitor or stack in fixed right rail. | M |
| `screens/SettingsScreen.jsx:1545` + `1640` | Theme setting duplicated. | One source of truth; likely keep Appearance System/Dark/Light and remove App Preferences theme row. | M |
| `screens/account/AccountHeroBlock.jsx:164` | KPI rail still crowded. | 2-3 headline stat tiles, secondary metrics in labeled cluster/disclosure. | M |
| `features/backtesting/BacktestingPanels.tsx:1316`, `2841`, `3106` | Empty Promoted Drafts leads, create/save study duplicated. | Move/collapse drafts below workspace; make one create-study path and consistent label. | M |
| `screens/SignalsScreen.jsx:3023` + interval tiles/header | Interval idle/hydration repeated. | Single home for per-interval hydration; summary only in header. | M |
| `screens/FlowScreen.jsx:3763` + `4397` | Presets duplicate filters. | Presets visibly set filter panel; one active-filter summary. | M |
| `features/platform/PlatformWatchlist.jsx:1484-1668` | Full management chrome remains in narrow rail/account context. | Full name, overflow management, passive Account rail or hidden management controls. | M |
| `screens/GexScreen.jsx:2000`, `2060`, `2079` | GEX headings/grids inconsistent. | Consistent top-level section headings and one predictable analytics grid. | M |
| `screens/GexScreen.jsx:1606` | GEX symbol selector too weak. | Prominent bordered symbol/search field and top-left symbol title. | S-M |

### Batch D - Judgment Calls / Riley Or Live-Eyeball Needed

Estimated files touched after decisions: 3-5.

| file:line | Issue | Decision needed | Effort |
|---|---|---|---:|
| `features/research/PhotonicsObservatory.jsx:3660-3811` | Graph overlap/clipping is visual. | Run authenticated live-eyeball pass; then tune collision/charge/labels only if screenshots still show overlap. | M |
| `features/research/PhotonicsObservatory.jsx:3671`, `3763`, `4082` | Red/green categorical vs P&L ring conflict. | Riley should decide whether vertical fills may stay branded/category colors or must avoid red/green in default graph. | M |
| `screens/algo/AlgoSettingsRegion.jsx:2461-2541` | Algo settings cramped/mixed controls. | Live screenshot required before changing dense trading controls. | M |
| `screens/account/PositionsPanel.jsx` | Round-5 #20 account filter-band state not source-confirmed in this pass. | Live/check targeted source after Riley chooses whether to include account filter redesign with watchlist work. | M |
| `features/research/PhotonicsObservatory.jsx:1338` | Static return chip primitive migration. | Decide whether to add static chip primitive or accept local custom because `Pill` is interactive. | M |

## Protan Verdict

Verdict: inert.

Observed usages:

- `index.css:808` defines `:root[data-pyrus-color-mode="protan"]` and remaps P&L/buy/sell/long/short tokens to blue/amber.
- `features/gex/useGexZeroGamma.js:25` watches `data-pyrus-color-mode` so GEX zero-gamma token refreshes if the attribute changes.
- `lib/uiTokens.jsx:222` only comments that semantic glow recipes propagate through the CSS var layer.
- `components/platform/signal-language/tones.js:16` defines a `protanopia` palette, but it aliases `DEFAULT_TONES`; it is not wired to the document attribute.
- `PlatformAppDiagnostics.test.mjs:263` asserts GEX observes the attribute.
- Source search found no setter for `data-pyrus-color-mode`, no user preference, and no command/UI path that applies `protan` or `protanopia`.

Recommendation: delete or wire, but do not leave halfway. Prefer a small wire-up if accessibility mode is still product intent: add `appearance.colorMode` preference (`default`, `protan`) in Settings, apply `document.documentElement.setAttribute("data-pyrus-color-mode", value)` in `PlatformApp`, and make signal-language palette read the same preference. Estimated effort: M, likely 3 files plus one test. If not product intent, delete CSS branch, GEX observer attribute, inert palette alias, and the diagnostics assertion. Estimated effort: S, 4 files.

## Suggested Next Work Orders

1. WO-51: Batch A mechanical color/tone swaps, 5 files, no product decisions.
2. WO-52: Batch B primitive/static chip and chart loading-state cleanup, 5-6 files, may need tiny primitive API addition.
3. WO-53: Batch C structural single-source UI, split by screen if capacity is limited.
4. WO-54: Batch D live-eyeball/Riley decisions plus protan wire-vs-delete decision.

