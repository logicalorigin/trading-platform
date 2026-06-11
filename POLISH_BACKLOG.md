# PYRUS Frontend Polish & Finish — Backlog

Recursive page-by-page polish review toward a launch-ready, outside-audience-facing frontend, enforcing the existing design system (`uiTokens.jsx` / `--ra-*` + shared primitives). The **review** captures everything; only *execution* of heavy redesigns is deferred per-item. Methodology: `~/.claude/plans/merry-crunching-lightning.md`.

## Conventions
- **Finding fields:** `id` · `finding` · `evidence` (`file:line` / `screenshot` + `{state, source}`) · `confidence` (high|low) · `severity` (P0 launch-blocking / P1 fix-now / P2 next-touch / P3 nice) · `scope` (polish | systemic | system-evolution | redesign) · `effort` (S<1d / M 1–3d / L>3d) · `reach` (#pages) · `parent` (SYS-NN) · `doc-ref` · `status` (open|planned|approved|done|wontfix).
- **Dedup:** a systemic nit lives once as a `SYS-NN` (§0); pages reference it and bump its `reach` — never re-logged per page.
- **Screenshot labels:** `forced-fixture` (authoritative) · `live-after-hours` (low confidence) · `source-only`.

---

## §0 — Systemic register (Pass 0 — 15 findings)
Cross-cutting findings in the shared substrate (tokens, primitives, shell, motion, a11y policy). Pages append their id to `reach` rather than re-logging. **Auto-promote rule:** reach≥5 & effort≤M ⇒ do-now (marked ⭑).

| id | title | systemic root | scope | sev | effort | reach |
|----|-------|---------------|-------|-----|--------|-------|
| ⭑SYS-01 | `fs()` 10px floor collapses 6 sub-10 type roles (micro/label/control/tableHeader/tableCell/caption → all 10px at default scale) — small-text hierarchy flattened. **✅ FIXED — floor 10→7, typecheck green** | `uiTokens.jsx:356` vs `:175-180` | systemic | P1 | S | most (91 files) |
| ⭑SYS-02 | `cssColorMix` redeclared in ~23 files (local copies drop the canonical `Math.round`). **✅ FIXED — all local copies removed; every consumer now imports the canonical `cssColorMix` (with `Math.round`) from `uiTokens.jsx`; typecheck green** | `uiTokens.jsx:150` | systemic | P1 | S | many |
| ⭑SYS-03 | Local `CSS_COLOR` maps re-hardcode `var(--ra-*)` in ~20 files; already drifting. **✅ FIXED — all local maps removed (incl. `Object.freeze` copies) and replaced with the canonical `CSS_COLOR` import; verified zero value divergence before applying; 35 files, net −654 LOC; typecheck green** | `uiTokens.jsx:114` | systemic | P1 | M | many |
| ⭑SYS-04 | Two divergent card surfaces (`Card` vs `SurfacePanel`) + ~35 hand-rolled; no single card source of truth. **◑ SoT ESTABLISHED — new `surfaceStyle()` helper in `primitives.jsx` is the single recipe (bg1/border/radius/elevation); `Card` + `SurfacePanel` refactored onto it with ZERO visual change (typecheck green; live-verified Card computed style identical: bg `#090D18`, 1px border, 10px radius). Reality check: SurfacePanel only 2 uses, Card 21, **71 files hand-roll `bg1` surfaces** → these migrate to `surfaceStyle()` incrementally during each screen's Tier pass (with live verify). Per user: SoT-now-migrate-per-screen. **Blind-sweep assessed + rejected:** 76 `bg1` style-objects scanned — regex can't reliably parse JS style objects (nested `${}`/conditional braces), and most `bg1` usages are NOT cards (panel bgs, inputs, bars) where `surfaceStyle()`'s border+radius+overflow would be wrong. Card-shaped ones carry varying radii/borders/shadows that don't all match a `surfaceStyle` variant. → migration stays **per-screen** during Tier passes (live-verify each), not a mechanical sweep** | `primitives.jsx` | systemic | P1 | M | most (71 hand-rolled) |
| ⭑SYS-05 | `.ra-touch-target` enforces 44px only on phone — no desktop/tablet min target (name implies a guarantee it doesn't give). **✅ FIXED — base rule now floors every viewport at the WCAG 2.2 24px minimum; phone + tablet get the full 44px. Live-verified: desktop probe = 24px, tablet (`data-viewport=tablet`) = 44px** | `index.css:829` | systemic | P1 | S | most |
| ⭑SYS-06 | ~60 inline transitions hardcode durations/`all`, bypassing the `--ra-motion-*` tokens the code calls authoritative. **✅ FIXED — shared widgets + 58 inline-style transitions across 29 screen/feature files mapped to `--ra-motion-*` tokens (nearest-token snap, property/easing preserved). Remaining edge cases (3): 2× `width 0.4s` (no token > slow/260ms) + 1 PhotonicsObservatory template-CSS block → left for Research/account Tier passes. Typecheck green; live render clean (423 btns, no JS errors)** | `index.css:406-412` | systemic | P1 | M | many |
| SYS-07 | `transition: all` on shared `Pill` (+others) animates layout → reflow jank. **✅ FIXED — every `transition: all` in JS removed. `Pill` + 6 screen-level sites (PhotonicsObservatory ×3, ResearchCalendarView, ResearchThemeSwitcher, algo/PipelineStrip) expanded to explicit `background-color/border-color/color/box-shadow/transform` (excludes layout props → no reflow) on mapped motion tokens. Typecheck green** | `primitives.jsx:803` | systemic | P2 | S | some |
| SYS-08 | Two tab systems (`TabBar` vs `SegmentedControl`) — divergent markup/motion/a11y | `tabs.jsx:19` vs `primitives.jsx:1213` | system-evolution | P2 | M | many |
| ⭑SYS-09 | Focus ring = low-contrast 2px box-shadow, no offset → clipped by `overflow:hidden` cards; `outline:none` global leaves no fallback. **✅ FIXED — global `button`/`[tabindex]` focus-visible now use `outline: 2px solid var(--ra-color-accent)` + `outline-offset: 2px` (unclippable, high-contrast); typecheck green; **live-verified** on a real focused button (`outline: 2px solid rgb(22,139,255)`, `outline-offset: 2px`)** | `index.css:1956-1964` | systemic | P2 | S | most |
| SYS-10 | No card/list loading-skeleton composites; two loading idioms; `Skeleton` lacks `role=status` | `primitives.jsx:1498` | system-evolution | P2 | M | many |
| ⭑SYS-11 | `Button` hover via imperative JS style mutation (fragile; `ActionButton` must re-mutate to undo). **✅ FIXED — hover moved to CSS `.ra-btn:hover` driven by inline `--ra-btn-bg/-hover`/`--ra-btn-color/-hover` custom props; removed JS `onMouseEnter`/`onMouseLeave` mutations in `Button.jsx` and the compensating `onMouseLeave` re-mutation in `ActionButton.jsx`; typecheck green** | `Button.jsx` / `ActionButton.jsx` | systemic | P2 | M | most |
| SYS-12 | value-flash duration mismatch (motion table 620ms vs impl `680`); non-token | `motion.jsx:25/32` | polish | P3 | S | some |
| SYS-13 | Inconsistent selection callback naming (`onChange`/`onSelect`/`onValueChange`/`onToggle`) | `components/ui/*` | systemic | P3 | M | many |
| SYS-14 | Duplicate `@keyframes raSkeletonShimmer` in index.css (drift risk) | `index.css:1186/1914` | polish | P3 | S | few |
| SYS-15 | P&L/direction by color alone at the format layer (no sign/▲▼ helper) — colorblind gap | `formatters.js:31` | system-evolution | P3 | M | most |

---

## §DOCS — Existing audit/redesign docs (completion audit)
The 8 curated docs feeding this review. Item-level Done/Partial/Open status is verified during each page's completion-audit step.

| doc | primary pages | type | status |
|-----|---------------|------|--------|
| APP_RESPONSIVENESS_AUDIT_2026-06-09.md | Flow, Account, Signals, Trade, Market, * | perf/responsiveness | partial (some 2026-06-09 fixes verified) |
| PAGE_LOAD_PERFORMANCE_AUDIT.md | Account, Trade, Flow, Research | perf | pending |
| AUDIT_FINDINGS_2026-05-13.md | Flow, platform | mixed | pending |
| SIGNALS_TO_ACTION_AUDIT.md | Algo (OperationsSignalTable) | UX/redesign | pending |
| POSITIONS_TABLE_REDESIGN.md | Account, Algo, Trade | redesign | pending |
| ALGO_RIGHT_RAIL_REDESIGN.md | Algo | redesign | pending |
| WATCHLIST_CARD_REDESIGN.md | Market (watchlist) | redesign | pending |
| CONNECTION_ACTION_UX_PLAN.md | platform-wide | UX | pending |

---

## Global Chrome (Phase B) — audit 2026-06-10
Shell that frames every screen (header cluster, sidebars, footer, toasts, command palette, mobile nav). 3 parallel source audits + live probes, all fact-checked against current source.

### Already resolved by Phase A (verified, no action)
- **Focus rings on `<button>`** — every "button missing focus ring" finding (HeaderKpiStrip, CommandPalette options, ActionButton retry, etc.) is covered by the global `button:focus-visible` outline (SYS-09). **Live-verified: focused button = `2px solid` accent.**
- **Touch-target floor** — `.ra-touch-target` now floors 24px desktop / 44px touch (SYS-05). Controls carrying the class are covered.

### False findings (corrected — primitives already exist)
- `ConfirmDialog.jsx` and `ConnectionStatusPill.jsx` **exist** in `components/ui/` — the CONNECTION_ACTION_UX "Phase 1a/1c not implemented" findings are wrong. `IbkrConnectionStatus.jsx` already references reconnect/`bridge/attach`. No duplicate primitives built.

### Fixed this pass
- **GC-01** `PlatformShell.jsx:570` resize transition `"width 0.2s"` → `width var(--ra-motion-standard) var(--ra-motion-ease)` (SYS-06 straggler the codemod skipped — ternary form). `status: done`
- **GC-02** `Drawer.jsx:120` mobile close button was a fixed 32px on a touch-only surface → added `className="ra-touch-target"` so it inherits the 44px mobile floor (SYS-05). `status: done`

### Open — actionable (ranked)
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| GC-03 | Many icon-only buttons lack `aria-label`/`title`. **◑ CHROME DONE — source review shows chrome buttons are already well-labeled (header nav `aria-label={screen.label}`, command palette, notifications, mobile icons, drawer close); added the one genuinely-missing label (theme toggle in HeaderStatusCluster). The ~82 unnamed buttons are overwhelmingly SCREEN CONTENT (ticker chips, watchlist rows) → fold into each screen's a11y dimension during Tier passes.** | HeaderStatusCluster theme toggle + per-screen | a11y | P1 | chrome done; content→Tier |
| GC-04 | JS hover via `event.currentTarget.style` mutation in 7 chrome files (same fragile pattern SYS-11 fixed in Button). **✅ FIXED — all 11 hover-mutation sites converted to declarative CSS hover classes (`.ra-hover-accent-bg/-bgfg/-bgbd/-pill/-brighten` in index.css + per-instance `.ra-h-toast`). Rest state stays in each control's inline base; side-effects preserved (AppHeader `handleScreenIntent` already on `onPointerEnter`). Typecheck green; live-verified class applied + `:hover` rule in loaded CSS + rest state correct; render clean (403 btns)** | AppHeader, HeaderKpiStrip, HeaderAccountStrip, HeaderStatusCluster, PortfolioPulseZone, MobileMoreSheet, ToastStack | ds-adherence | P2 | done |
| GC-05 | Non-`<button>` interactive elements get no focus ring (SYS-09 only covers `button`/`[tabindex]`): `HeaderAccountStrip` selector div, `PlatformShell` resize handle | HeaderAccountStrip.jsx:86; PlatformShell.jsx:581 | a11y | P2 | open |
| GC-06 | `PlatformAlgoMonitorSidebar` CompactMetric + signal-row hand-roll `bg1` surface/gradient → migrate to `surfaceStyle()`; verify direction not color-only | PlatformAlgoMonitorSidebar.jsx:764,898 | ds/visual | P2 | open |
| GC-07 | `HeaderAccountStrip` shows bare `MISSING_VALUE` with no loading/error distinction (state-coverage gap per DESIGN.md) | HeaderAccountStrip.jsx:132 | state | P2 | open |
| GC-08 | Infinite-loop `animation:` durations (1.8s pulse, 820–860ms spins) are outside the 90–260ms transition-token scale — NOT SYS-06 targets; leave as loop durations unless a loop-token scale is added | HeaderStatusCluster.jsx:769,2129,2680 | ds | P3 | wontfix(noted) |

_(GC-03/04 are sized for per-component passes — GC-03 best folded into each screen's a11y dimension during Tier passes; GC-04 mirrors SYS-11 and wants the same CSS-hover treatment per file.)_

## Tier 1 — Market · Signals · Trade · Account
_(pending — review begins after Pass 0)_

### Market — full audit (2026-06-10)
Source audit (4 dimensions) + DOM probes. Note: pixel screenshots unavailable this session (`sharp` install broken) — color/style fixes verified via computed-style probes (dark theme) instead.

**SYS-04 surface down-payment (no-op, correct):** Market's real card panels already use `<Card>` (10+ in MarketScreen/MarketActivityPanel/MultiChartGrid) → inherit `surfaceStyle()` SoT for free. Remaining hand-rolled `bg1` surfaces are controls/chart-cells/toolbars at `RADII.xs` — NOT cards; converting would be wrong. Refines SYS-04: the "71 bg1" count is mostly non-card surfaces.

**Fixed this pass** (typecheck green; render clean 404 btns):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| MKT-01 | Decorative white-overlay gradient on chart-cell placeholder (DESIGN.md rejects decorative gradients) → solid theme-aware token | MarketChartCell.jsx:105 → `cssColorMix(CSS_COLOR.text, 3)` | visual | P2 | done |
| MKT-03 | Flow-indicator padding hardcoded px → `sp()` (density-aware) | MarketChartPremiumFlowIndicator.jsx:182 | ds | P2 | done |
| MKT-06 | Toolbar buttons (Reset Size/Views) hardcoded `rgba(255,255,255,0.08)` → `cssColorMix(CSS_COLOR.text, 8)` (theme-aware; probe-verified identical in dark) | MultiChartGrid.jsx ×2 | ds | P2 | done |
| MKT-07 | Sector-flow row buttons (`padding: sp("2px 0")`, no min target) lacked `.ra-touch-target` → added (24/44px floor) | MarketScreen.jsx:893 | a11y | P2 | done |

**Open** (deferred — lower value / transient / needs visual verify):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| MKT-02 | Loading-skeleton `<Card>` wraps bordered/rounded cells (cards-in-cards) — but transient skeleton + cells are legit repeated chart placeholders; revisit if it reads wrong | MarketScreen.jsx:148-233 | visual | P3 | open |
| MKT-04 | Flow-indicator grid-template divider heights hardcoded `1fr 5px`/`6px` (structural; awkward to tokenize) | MarketChartPremiumFlowIndicator.jsx:179 | ds | P3 | open |
| MKT-05 | Resize-handle divider colors hardcoded grey rgba | MultiChartGrid.jsx:1018-1019 | ds | P2 | open |
| MKT-08 | Resize-handle focus box-shadow hardcoded blue rgba → should be accent token | MultiChartGrid.jsx (3×) | ds | P3 | open |
| MKT-09 | `MarketToolbarLabel` icon wrapper: prefer `aria-hidden` (label already in tooltip) | MarketActivityPanel.jsx:481 | a11y | P3 | open |
| MKT-10 | Chart preset label shows "N-chart desktop preset" on phone (confusing wording on mobile) | MultiChartGrid.jsx:1276 | responsive | P2 | open (needs screenshot to verify fix) |

### Signals — full audit (2026-06-10)
Source audit (4 dims) + DOM probes. Screenshots unavailable (`sharp` broken) — visual/scale checks degraded. **Verdict: screen is well-built and largely doctrine-compliant; no safe high-confidence fixes warranted this pass.**

**Strengths verified:**
- **Colors 100% tokenized** — 0 hardcoded `rgba()`, 0 hex in `SignalsScreen.jsx`.
- **Direction is multi-cue everywhere** (satisfies DESIGN.md "color never the only cue"): `DirectionBadge` and `CompactIntervalCell` both render `ArrowUp`/`ArrowDown`/`Clock3` glyph + uppercase text + tone color + sparkline shape (SignalsScreen.jsx:762-786, 1510-1517).
- **Semantic color correct** — gate matrix `block`→red is doctrine-correct (DESIGN.md line 11 lists "blocked" under red), `pass`→green is operational (not directional green).

**Rejected agent findings (false positives):**
| id | claim | verdict |
|----|-------|---------|
| ~~SIG-A~~ | "color-only buy/sell direction cues" (P0) | FALSE — arrow glyph + text + color throughout |
| ~~SIG-B~~ | "decorative gradient on interval rails" (P0) `:2564` | FALSE — 3px `tone→bg3` directional **data bar** (allowed data-viz, `aria-hidden`) |
| ~~SIG-C~~ | "gate `block` should be amber not red" (P1) `:2615` | FALSE — DESIGN.md puts "blocked" under red |

**Open (minor / deferred — need visual verify or systemic):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| SIG-01 | SR edge: directional glyphs/sparklines are `aria-hidden`; screen-reader direction relies on value text → part of **[[SYS-15]]** (format-layer sign/▲▼ + aria helper, app-wide). Bump SYS-15 reach. | SignalsScreen.jsx:1565,1593 | a11y | P3 | open→SYS-15 |
| SIG-02 | 10 hardcoded SVG `fontSize="N"`/`fontWeight="N"` in chart `<text>` → `fs()`/`FONT_WEIGHTS` would make scale-aware BUT risks overflowing fixed chart label slots at non-default scale; needs screenshot verify | SignalsScreen.jsx:2313,2385,… | ds | P3 | open (needs screenshots) |
| SIG-03 | Dense-table row lacks per-row loading/stale/error visual (state shown in drilldown + StatusPill only); broad, needs visual verify | SignalsScreen.jsx:4810-4862 | state | P2 | open (needs screenshots) |
| SIG-04 | Empty state has context ("matches current filters") but no recovery action; `DataUnavailableState` supports `action` prop → could add "Clear filters" | SignalsScreen.jsx:4869 | state | P3 | open |

### Trade — full audit (2026-06-10)
Source audit (4 dims) + live capture (screenshots restored). Screen renders chrome + loading skeletons (Spot chart / Option chain / Ticket); heavy panels (ticket/positions/chain) are broker-data-gated so their internals were source-verified.

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| TRD-01 | **`ConfirmDialog` had no focus management** — `role=dialog`/`aria-modal`/Escape/backdrop-dismiss present, but focus never moved into the dialog, Tab wasn't trapped, focus not restored on close. WCAG modal gap on the shared primitive behind the **destructive broker confirmation**. **FIXED** — added focus-in (lands on Cancel, the least-destructive control), Tab/Shift+Tab trap, and focus-restore-on-close in `components/ui/ConfirmDialog.jsx`. Benefits every confirm dialog app-wide. Live open-dialog test is broker-data-gated; logic + typecheck + build verified. | ConfirmDialog.jsx:24-90 | a11y | P1 | done |

**Rejected agent findings (false positives — fact-checked):**
| claim | verdict |
|-------|---------|
| "P&L / direction color-only" (#1-5, #11, P1×6) | FALSE — `tradeSignedMoney` emits `+$/−$`, `formatSignedPercent` emits `+/−`; sign + color = multi-cue. 11 files use signed formatters. |
| "hardcoded rgba() wrapper" (#7) `TradeChainPanel:166` | FALSE — `rgba()` helper delegates to canonical `cssColorMix`; not a hardcoded literal. |
| "order ticket loading layout jump" (#13) | FALSE — live screenshot shows loading skeletons (Spot/Chain/Ticket) with stable dimensions. |

**Open (minor / deferred):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| TRD-02 | `TradeWorkspaceChrome` status dots put `aria-label` on a non-interactive `<span>` (ignored by SR) → use `title` or sr-only text | TradeWorkspaceChrome.jsx:170-183 | a11y | P3 | open |
| TRD-03 | `PayoffDiagram` gain/loss zones lack text legend ("Profit/Loss zone") — color+fill only | PayoffDiagram.jsx:131-164 | polish | P3 | open |
| TRD-04 | `BrokerActionConfirmDialog` destructive affordance is tone+note; could add a ⚠ glyph for redundancy | BrokerActionConfirmDialog.jsx:40 | a11y | P3 | open |
| TRD-05 | `TradePositionsPanel` empty/stale-row coverage — verify with live broker data (panel was data-gated this pass) | TradePositionsPanel.jsx | state | P2 | open (needs data) |

**SYS-15 update:** color-only P&L/direction is **largely mitigated app-wide** — signed money/percent formatters + `ArrowUp/Down` glyphs are used consistently (Signals, Trade verified). Residual is SR `aria-hidden` on decorative glyphs. Downgrade SYS-15 confidence/urgency accordingly.

### Account — full audit (2026-06-10)
Source audit (4 dims, ~15 panels) + live capture (screen renders fully). Dense multi-panel financial dashboard (P&L calendar, exposure, equity curve, positions, allocation).

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| ACC-01 | `TradingAnalysisWorkbench` filter modal: hardcoded `rgba(0,0,0,0.35)` drop-shadow + backdrop scrim (theme-naive black) → `cssColorMix(CSS_COLOR.bg0, 35)` (theme-aware, matches `ConfirmDialog` scrim convention). Only hardcoded-color file on the whole screen. | TradingAnalysisWorkbench.jsx:1820,1831 | ds | P2 | done |

**Rejected agent findings (false positives — fact-checked):**
| claim | verdict |
|-------|---------|
| "decorative gradient on AccountReturnsPanel calendar cells" (#7) `:357` | FALSE — `linear-gradient(0deg, X, X)` with **identical stops** is the CSS idiom for layering a SOLID accent tint over `tone.background` (selection highlight), not a decorative gradient. |
| IntradayPnlPanel SVG gradient / RiskDashboard arch / CashFunding colors (#10,13,14) | agent self-marked PASS — confirmed compliant. |

**Open (real — state coverage, deferred: M-effort + need stale/empty data to verify):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| ACC-02 | **Equity curve** shows snapshot timestamp but no amber stale cue when `asOf` is old (primary read; DESIGN.md: "amber freshness cue, no layout jump") | EquityCurvePanel.jsx:721-750 | state | P1 | open |
| ACC-03 | **Positions** detects `freshness==="stale"` but rows show no stale/amber cue (DESIGN.md dense-table "row-level stale cue") | PositionsPanel.jsx:438,1782 | state | P1 | open |
| ACC-04 | `AllocationPanel` no loading skeleton (blank/shift while `allocationQuery.isPending`) + empty state lacks recovery action | AllocationPanel.jsx:136-154 | state | P2 | open |
| ACC-05 | `PortfolioExposurePanel` allocation-query error path lacks inline retry on all branches (risk-query has it) | PortfolioExposurePanel.jsx:1264-1285 | state | P2 | open |
| ACC-06 | `SetupHealthPanel` green status-dot glow (`0 0 8px green`) — possibly intentional "live" cue vs decorative; left pending visual judgment | SetupHealthPanel.jsx:35 | visual | P3 | open |

_Note: ACC-02/03/04/05 are the genuine next-touch work on Account — a shared "stale freshness Pill" + loading-skeleton pattern would close them together. Deferred because they need stale/pending data states to build+verify safely._

## Tier 2 — Flow · GEX · Research · Algo · Backtest

### Flow — full audit (2026-06-11)
Source audit (4 dims) of `FlowScreen.jsx` (6.5k LOC) + `features/flow/*`. Dev server was up; fixes verified by source + typecheck (live re-shoot pending — see note). Feeder doc `AUDIT_FINDINGS_2026-05-13.md` is a runtime/DB bug report, not design — no design items to fold in.

**Strengths verified:**
- **Colors fully tokenized** — 0 hardcoded `rgba()`/hex across all Flow files.
- **Direction is multi-cue** — `toneForOptionSide` + "C"/"P" badges + "Call flow"/"Put flow" / "Bull"/"Bear" / "BID/MID/ASK" text labels everywhere → hue is never the only cue.
- **Established directional system** — screen defines `FLOW_BUY_TONE`/`FLOW_BULLISH_TONE` (= blue via `toneForDirectionalIntent`) + `FLOW_SELL_TONE`/`FLOW_BEARISH_TONE` (red) and routes ~25 sites through them; `toneForOptionSide` (blue/red) used ~10×.

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| FLOW-01 | **Directional-green drift** — a cluster of inline sites hardcoded `green` for **call/buy/bull** directional intent, violating DESIGN.md (directional buy/call/bullish = **blue**, green is "banned only when reading directional market intent") **and** bypassing the screen's own `FLOW_BULLISH_TONE`/`FLOW_BUY_TONE`/`toneForOptionSide` (already blue, used ~35× on the same screen). Not the rejected "color-only" pattern — this is **wrong-hue + internal inconsistency** on the screen's **primary read** (directional pressure). All sites carry text cues ("Bull"/"Bear"/"C"/"P"/"BUY"/"Ask·buy"), so hue change is multi-cue-safe. Routed every site through the canonical constants (symmetric pairs; red conversions are visual no-ops since `FLOW_BEARISH_TONE===red`). 11 sites: ContractDetailInline `cpColor`:479, ask-spread:554/557/559, SIDE:908; FlowScreen call/put-premium:5211, netColor:1556, "Bullish balance":2849, "Bull/Bear" summary:4804, net:4808, Bull/Bear/Net spans:4853/4859/4868, "Ask/buy" exec:5510. ContractDetailInline gained the `semanticToneModel` import. | see ids | ds/semantic (visual) | P2 | done |

**Open (deferred — lower confidence / ambiguous data-viz, needs live visual judgment):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| FLOW-02 | Bid/ask **quote-ladder** coloring uses green-for-call at the ask while **bid is hardcoded red** regardless of side → ambiguous (book-side ladder vs direction). Converting to blue is plausibly correct but the anchored-red bid makes semantics unclear; left for live visual judgment. | FlowScreen.jsx:3253 (ask price), 3271 (spread gradient end-stop) | ds/semantic | P3 | open (needs screenshot) |
| FLOW-03 | **News-sentiment** score uses green(+)/red(−). Distinct axis from order-flow direction (external news tone, not buy/sell pressure) → intentionally **not** recolored to blue to avoid over-reach; flag for a doctrine call on whether news sentiment counts as "directional market intent". | FlowScreen.jsx:5632; ContractDetailInline.jsx:966 | ds/semantic | P3 | open |
| FLOW-04 | `ProgressBar` fill uses `transition: width 0.4s ease` — non-token duration (no `--ra-motion-*` token > 260ms). One-shot fill inside `overflow:hidden` (no reflow); a progress-fill **data motion**, not a UI state transition. Same class as GC-08 won't-fix loop durations → leave unless a >260ms motion-token tier is introduced. This resolves the SYS-06 "FlowScannerStatusPanel width 0.4s" deferred edge case. | FlowScannerStatusPanel.jsx:89 | motion | P3 | wontfix(noted) → closes SYS-06 edge |

**SYS-04 (surfaces):** down-payment **no-op** (like Market) — Flow's `bg1` usages are control/bar/chart surfaces (ProgressBar track, `ScannerMetric` at `RADII.sm`), not card recipes; 0 `surfaceStyle()` conversions warranted.
**State coverage:** loading/empty/error idioms present across FlowScreen (29 refs), ContractDetailInline (16), FlowDistributionScannerPanel (9) — no high-confidence gap found source-side; per-row stale cue would need live stale data (same residual as ACC-03/SIG-03).

### GEX — full audit (2026-06-11)
Source audit (4 dims) of `GexScreen.jsx` (2.3k LOC) + `features/gex/*` via parallel dimension agents, all fact-checked against source. Feeder doc `GEX_*` n/a. Fixes verified by source + typecheck (green).

**Strengths verified (3 of 4 dims clean):**
- **Colors fully tokenized** — 0 raw hex/`rgba()` literals across all GEX files. Call/bullish = blue (`GEX_CALL_TONE`/`GEX_BULLISH_TONE` via `toneForDirectionalIntent`), put/bearish = red; no directional-green drift (unlike Flow). Squeeze-factor green/amber/red is a **quality/readiness meter** (not a directional-intent read) and the heatmap green↔red is a **diverging data-viz scale** (legend swatches are `aria-hidden` + text-labelled) — both doctrine-allowed, confirmed.
- **Motion / DS-adherence clean** — 0 inline `transition:`/`transition: all` stragglers; Recharts animations explicitly disabled; spacing via `sp()`, weights via `FONT_WEIGHTS`, radii via `RADII`, surfaces via `Card`/`surfaceStyle()` (control/header/tooltip surfaces correctly opt out). No rework.

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| GEX-01 | Heatmap **Expand/Collapse** button (`height: dim(26)`) and **"view all"** inline button (`padding: 0`, no min target) lacked `.ra-touch-target` → no 44px touch floor (SYS-05). Added the class to both (desktop unchanged — 26px > 24px floor; touch floors to 44px). | GexScreen.jsx:815, 942 | a11y | P2 | done |
| GEX-02 | Decorative `<Zap>` score icon not `aria-hidden` (score already rendered as `{score}/100` text adjacent) → added `aria-hidden="true"` (matches SignalsScreen lucide convention). | GexScreen.jsx:1162 | a11y | P3 | done |

**Open (deferred — state coverage; most need live stale/empty/pending data to build+verify safely, per ACC-02/03 pattern):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| GEX-03 | **Error state has no inline retry** — `chainError` renders `DataUnavailableState variant="error"` (`role=alert`) but no recovery action, though `DataUnavailableState` has an `action` prop and `gexQuery.refetch` is available. Doctrine: error states get inline retry. Recommended fix = pass `action={<retry button onClick={gexQuery.refetch}>}`; deferred because GEX imports no Button primitive and the retry-button styling wants visual judgment (would be the app's first `action=` on this component; `InlineError` is account-scoped so not reusable here). | GexScreen.jsx:2010-2015 | state | P2 | open |
| GEX-04 | **KPI strip** shows "Updated {label}" timestamp but no amber stale tone when `sourceLastUpdatedAt` is old (DESIGN.md: timestamp + amber tone). | GexScreen.jsx:1999 | state | P1 | open (needs stale data) |
| GEX-05 | **Strike-profile dense table** has no row-level stale/data-issue cue though rows carry `updatedAt`/`quoteFreshness` (DESIGN.md dense-table row cue — same residual as ACC-03/SIG-03). | GexScreen.jsx:1335-1459 | state | P2 | open (needs mixed-age data) |
| GEX-06 | Strike-profile / expiry / OI **charts + heatmap** lack an explicit empty-state message when their row arrays are `[]` (top-level guards cover most paths; per-chart empty would show blank inside a ready frame). | GexScreen.jsx:549,632,696,769 | state | P3 | open (needs empty data) |
| GEX-07 | `backgroundLoading` (`isFetching && !isPending`) is computed (1684) but unused → no "refreshing" affordance on background refetch (DESIGN.md: label refreshing, preserve last values). | GexScreen.jsx:1684 | state | P3 | open (needs refetch state) |

**SYS-04 (surfaces):** no-op (like Market/Flow) — card panels already use `<Card>` (→ `surfaceStyle()` SoT for free); remaining `bg1` surfaces are table-headers/tooltips/metric-tiles/progress-tracks, not card recipes. 0 conversions warranted.

### Research — full audit (2026-06-11)
Source audit (4 dims) of `screens/ResearchScreen.jsx` (clean shell) + `features/research/PhotonicsObservatory.jsx` (4.8k LOC) + `features/research/components/*` + `lib/researchApi.js`, via 3 parallel dimension agents, all fact-checked against source. Fixes verified by source + typecheck (green); live re-shoot pending (full stack).

**Strengths verified:**
- **Semantic color clean — no directional-intent drift (unlike Flow).** Line-by-line: every `CSS_COLOR.green`/`red` encodes **financial outcome** (DCF/return/growth/EPS-beat/off-52w), **operational health** (live-source dots, `dataStatus="live"`, prefetch-done, copy-success), or **diverging data-viz scales** (peScale/grScale/aiScale, growth & macro heatmaps). Research's primary read = "market context / analysis conclusion," not buy/sell pressure — no surface to mis-color. Confirmed no blue mis-use.
- **Color tokenized in .jsx** — 0 raw hex/`rgba()` in the 6 `.jsx` files (the one `rgb()` is a runtime brightness-shade helper; `toneAlpha` wraps the sanctioned `cssColorMix`). The ~249 hex in `data/research{Themes,Graph,Symbols}.js` are **categorical sector/theme palettes** (consumed as `vc.c` chart strokes / graph node colors) — data-viz, doctrine-allowed, out of scope.
- **font-size / font-weight** all tokenized (`fs()`/`textSize()`, `FONT_WEIGHTS.*`); 0 raw stragglers.

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| RES-01 | **Real CSS bug** — the root reset rule inside the `<style>` template literal read `padding: sp(0)` with no `${}` interpolation, so the browser received the literal string `sp(0)` and dropped the declaration → the intended `padding: 0` reset silently failed across the entire Research subtree. Fixed to `padding: 0`. | PhotonicsObservatory.jsx:4583 | ds(bug) | P1 | done |
| RES-02 | **SYS-06 edge (closes workplan "PhotonicsObservatory template-CSS block")** — 4 nodes carried `className="ra-panel-enter"` **and** an inline `animation: "fadeIn 0.2–0.3s ease"`; the inline shorthand overrode the class's tokenized entrance (`raPanelEnter` @ `--ra-motion-standard` 190ms) **and** bypassed the `.ra-panel-enter` reduced-motion overrides in index.css, substituting an off-scale 300ms fade. Dropped the inline `animation` so the class carries the tokenized, reduced-motion-aware entrance. | PhotonicsObservatory.jsx:4208,4784,4816,4823 | motion | P2 | done |
| RES-03 | Root `<style>` button transition used raw `0.12s` ×4 props (off the `--ra-motion-*` scale) → replaced with `var(--ra-motion-fast)` (140ms). | PhotonicsObservatory.jsx:4605 | ds/motion | P3 | done |
| RES-04 | Search-clear button was glyph-only (`✕`) with no accessible name → added `aria-label="Clear search"`. | PhotonicsObservatory.jsx:4699 | a11y | P3 | done |

**Open — systematic a11y clusters (recommend one focused sub-pass w/ live keyboard + screen-reader verification):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| RES-05 | **Keyboard-unreachable clickables (~16)** — table rows + chips + cards + graph-filter blocks use `<div>/<tr> onClick` with no `role`/`tabIndex`/`onKeyDown`; with the global focus ring covering only `<button>`/`[tabindex]` (SYS-09), all are keyboard-dead and focus-ringless. The screen's dominant a11y gap (zero coverage). Several sit inside d3-graph interaction zones → convert to `<button>` or add `role="button" tabIndex={0}`+`onKeyDown` carefully, live-verify graph interactions don't regress. | PhotonicsObservatory.jsx:994,4112,2086,2097,2232,2249,3138,3191,3322,3343,3407,3431,3450,3465,3523,4189; ResearchCalendarView.jsx:246 | a11y | P1 | open |
| RES-06 | **Charts lack accessible labels (8 of 9)** — recharts price/revenue/EPS/valuation charts + Sankey/donut/force-graph SVGs + macro heatmap grid have no `aria-label`/`role="img"` and aren't `aria-hidden` (DESIGN.md: charts get aria-label or explicit hide). Only `MicroSparkline` is handled (correctly `aria-hidden`). | PhotonicsObservatory.jsx:1357,2121,2297,3485,2972,3394,4048,4161 | a11y | P2 | open |
| RES-07 | Touch targets below floor lack `.ra-touch-target`: search-clear (16px, nested in input overlay → **needs live check** that a 44px touch min doesn't break the overlay), settings gear (28px), GraphToolbar mode buttons (`padding:1px 4px`). | PhotonicsObservatory.jsx:4699,4681,3606-3624 | a11y | P3 | open (needs live) |

**Open — state coverage (DESIGN.md table; several need live data):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| RES-08 | **Header KPI/status pill swallows `error`** — `refreshData` can set `dataStatus="error"` but the pill only branches `live`/`loading`/else → an error renders the neutral grey "STATIC" label, no red tone, no retry at the strip (retry exists behind the gear → SettingsPanel, so recovery is reachable but unsurfaced). Add an `error` branch (red + retry). | PhotonicsObservatory.jsx:4541,4544,4650-4652 | state | P2 | open |
| RES-09 | **Error conflated with empty (no retry)** — `fetchSECFilings`/`fetchTranscript`/calendar fetch return `null` on failure and `[]`/`null` on genuine absence; both collapse to the same "No … data returned" copy, so a network error is indistinguishable from "none exists," with no retry though refetch fns exist. | PhotonicsObservatory.jsx:1599,1706-1710,1792-1795; researchApi.js:199-214 | state | P2 | open |
| RES-10 | **PeerTable "1M trend" stuck on "loading…" permanently** — column renders `liveHist[t]?.length>=2 ? <Sparkline> : "loading…"`, but parent `liveHist` is `{}` and never populated (`backgroundPrefetchHist` is a no-op early-return) → every peer shows an indefinite spinner that never resolves. Render a real "—"/empty state or wire/remove the column. (Touches data plumbing — beyond a pure design quick-win.) | PhotonicsObservatory.jsx:1557-1564; researchApi.js:164-166 | state | P2 | open |
| RES-11 | No screen-wide **amber stale/freshness cue** — live quotes refresh on 300s and caches carry `fetchedAt`, but no "as of HH:MM" / amber tone is ever surfaced (incl. the Detail headline price at 2461, which shows no live/authored/stale indicator though freshness is known and shown in the stats grid). Same residual class as GEX-04/ACC-02. | PhotonicsObservatory.jsx:2461-2466 + screen-wide | state/stale | P3 | open (needs live) |
| RES-12 | Filter-to-zero (Comps/Graph) within a populated universe renders bare "0 companies" + empty table/canvas, no "clear filters" recovery (CalendarView does this well at ResearchCalendarView.jsx:208-212 — reuse pattern). PriceChart loading shows no skeleton inside its stable 240px frame. | PhotonicsObservatory.jsx:4097-4099,4815-4819,1356-1400 | state | P3 | open |

**Open — visual / DS (judgment or M-effort tails):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| RES-13 | **Decorative orb/gradient layers** — root paints two radial-gradient accent/blue washes (4581) + a second absolutely-positioned header orb (4619, also a raw hex-alpha concat `${currentTheme.accent}14` → should be `toneAlpha(…, 0.08)`). DESIGN.md rejects "decorative gradient/orb/blob layers," but opacities are ultra-low (0.015–0.08) so removal-vs-keep is a **live screenshot call** (like FLOW-02). | PhotonicsObservatory.jsx:4581,4619 | visual/ds | P2 | open (needs screenshot) |
| RES-14 | **SYS-04 NOT a no-op here** (unlike Market/Flow/GEX) — a hand-rolled card recipe (`bg1` + 1px border + `RADII.md` + `ELEVATION.sm`) is declared as `STYLE_CARD` and re-inlined ~8×; this is the exact `surfaceStyle({elevated:true})`/`Card` contract, and the file imports neither. Route true framed-tool card surfaces through `surfaceStyle()`/`Card`. | PhotonicsObservatory.jsx:134 (STYLE_CARD)+744,777,1304,3222,4046,4183,4789; ResearchSettingsPanel.jsx:5 | ds (SYS-04) | P3 | open |
| RES-15 | Emoji used as icons (📅 tab, 📋 ↗ ✕ ✓) alongside the lucide `Settings` icon + `Icon` primitive → inconsistent icon language. Replace with lucide via `<Icon>`. | PhotonicsObservatory.jsx:4730,2493,2535,2539,4805; ResearchSettingsPanel.jsx:32 | visual | P3 | open |
| RES-16 | Raw-px `gap` (76×) and `width`/`height` dot/swatch sizes (~48×) not run through `sp()`/`dim()` while `padding`/`fontSize` are tokenized — density-scale inconsistency. **App-wide pattern, not Research-specific** → candidate SYS-level item, not a per-screen blind sweep. | PhotonicsObservatory.jsx (throughout) | ds | P3 | open (defer to SYS) |
| RES-17 | Responsive: fixed `repeat(3|4,1fr)` grids without `minmax`/collapse (1047,3178,3284,3426,3461), Detail `1.2fr .8fr` two-col with no phone stack (4253), graph tooltips `minWidth:320–480` (overflow at 390), empty-state `margin:"60px auto"` (4764), macro heatmap fixed label-col grids without scroll wrapper (3519,4161). | PhotonicsObservatory.jsx (see ids) | responsive | P2 | open (needs 834/390 shoot) |

**SYS-06 edge:** the "PhotonicsObservatory template-CSS block" deferred edge is **closed** by RES-02/RES-03 (remaining `slideUp`/`shimmer`/`researchObservatoryPulse`/`researchWorkspaceSpin` are decorative/loading loops in the GC-08 won't-fix class — outside the 90–260ms transition scale, not competing with live numeric data).

### Algo — full audit (2026-06-11)
Source audit (4 dims) of the Algo tree — `AlgoScreen.jsx` (2k LOC) + `screens/algo/*` + `features/platform/PlatformAlgoMonitorSidebar.jsx`, ~19k LOC across 23 `.jsx` files (the largest screen) — via 2 cluster-partitioned dimension agents (signal table/row/drill; shell/strips/rail/settings/sidebar), all fact-checked against source. Fixes verified by source + typecheck + unit tests (28/28 algo tests pass via `node --import tsx --test`; bare `node --test` can't load `.jsx`).

**Strengths verified — Algo is the most-developed screen (like Market/Signals):**
- **Both feeder redesigns substantially APPLIED.** `SIGNALS_TO_ACTION_AUDIT.md` (decision pill + inline action col + sort affordance + symbol search + verdict-toned "fresh&hot" gradient + mobile metric grid) and `ALGO_RIGHT_RAIL_REDESIGN.md` (container-query frames, CompactSettingCell/Switch/SegmentedControl, HaltStrip board, ContractSelectionCell + strike ladder, ExitLadderTrack, SaveBar) are all implemented. The redesign docs are now largely historical — verify against, don't re-derive.
- **Near-fully tokenized** — across 19k LOC only 4 raw `rgba()` (shadows/scrim, below) + 0 `transition: all` + 0 non-token motion durations. Color flows through `CSS_COLOR`/`cssColorMix`/`cssColorAlpha`.
- **a11y baseline strong** (unlike Research) — no keyboard-dead `<div onClick>`; interactive elements are native `<button>/<select>/<input>` with `aria-label`s; decorative glyphs `aria-hidden`; rich contextual empty states; consolidated amber stale/error `role="status"` banner.

**Fixed this pass** (typecheck + 28 unit tests green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| ALG-01 | **Directional-green drift (Flow FLOW-01 family)** — the signal-direction tone helpers hardcoded **bull/buy/long → `CSS_COLOR.green`** (sell/short → red) on the screen's directional read; DESIGN.md requires directional intent = **blue (buy/bull)** / red (sell/bear). Routed through the canonical `toneForDirectionalIntent` (`semanticToneModel.js`, same helper GEX/Flow use): bull→blue is the fix, bear→red a visual no-op (`directionSell===CSS_COLOR.red`). Multi-cue-safe (BULL/BEAR/BUY/SELL text labels everywhere). 3 sites across 2 files: `signalDirectionMeta` (sidebar:362,365), `directionMeta` (OperationsSignalRow:305,313), `actionIntentTokenTone` (OperationsSignalRow:1166,1167). | see ids | ds/semantic | P2 | done |
| ALG-02 | AlgoAuditPanel event-disclosure toggle `<button>`s (×2) lacked `aria-expanded` → added `aria-expanded={isExpanded}`. | AlgoAuditPanel.jsx:564,688 | a11y | P3 | done |

**Resolved — directional-color conflict (doctrine decision 2026-06-11):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| ALG-03 | **Strike ladder colored calls green / puts red** (CALLS header, slot tone, save-summary tone). Per DESIGN.md call-side = **blue**, same drift as ALG-01 — **but** the approved feeder `ALGO_RIGHT_RAIL_REDESIGN.md` Part E specified green calls / red puts. **Decision: doctrine wins** → converted calls green→blue via `toneForDirectionalIntent("bullish")` (puts→red no-op); feeder spec reconciled to blue calls (lines 29, 154, dated note). 3 sites, all multi-cue (CALL/PUT text + slot labels). | AlgoSettingsRegion.jsx:1298,1354,2585 | ds/semantic | P2 | done |

**Open — DS / SYS-04 (surfaceStyle migration — NOT a no-op here, like Research):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| ALG-04 | Hand-rolled card recipes (border + `RADII.md` + bg1, ± manual shadow) that match the `surfaceStyle()`/`Card` contract; files don't import it. ExitLadderTrack edit popover also hand-rolls a `0 12px 28px` shadow = `ELEVATION.lg`. | AlgoSettingsRegion.jsx:1751-1769; AlgoLivePage.jsx:100-108; AlgoAuditPanel.jsx:336-339 | ds (SYS-04) | P2 | open |
| ALG-05 | Raw `fontWeight: 600` should be `FONT_WEIGHTS.label` (AlgoLivePage doesn't import FONT_WEIGHTS → small sweep, batch). | AlgoLivePage.jsx:283,1048,1109; HaltStrip.jsx:626; OperationsStatusOrb.jsx:151; PipelineStrip.jsx:257 | visual | P3 | open |
| ALG-06 | Raw `rgba(0,0,0,…)` shadows/scrim: AlgoSaveBar:52 (upward bar shadow — no matching ELEVATION token, legitimately bespoke), AlgoSaveBar:112 (popover ≈ `ELEVATION.lg` → tokenize), AlgoLivePage:1407 (scrim — no token), 1417 (bottom-sheet upward shadow — bespoke). Mostly leave; only 112 is a clean tokenize. Consider `ELEVATION.bar`/`CSS_COLOR.scrim` if these recur. | see ids | ds | P3 | open |

**Open — a11y / state coverage:**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| ALG-07 | `EmptyOperationsState` form controls strip the focus ring (`border:none`+`outline:none`) → no visible keyboard focus. | AlgoLivePage.jsx:161-205 | a11y | P2 | open |
| ALG-08 | **Dead focus affordance + orphaned drill** — every signal row `<div role="row">` carries the `.ra-signal-row-focus` `:focus-visible` styling but has no `tabIndex`/`onClick`/`onKeyDown` so it can never focus; and `OperationsSignalDrill` (620 LOC) is imported nowhere — the table renders no row-select/drill path. Product/arch question: wire the row→drill path (add keyboard-activatable row) or remove the dead class + orphaned drill. | OperationsSignalRow.jsx:2362-2363,2864 + index.css:1677-1700; OperationsSignalDrill.jsx (whole) | a11y/state | P2 | open |
| ALG-09 | AlgoAuditPanel "table" is a div-grid with no table ARIA roles (header↔cell association visual-only); STATE: assumes `events` always settled — no loading/error/stale branch (pending vs zero-events indistinguishable). AlgoSettingsRegion `!controlBaselineReady` renders dimmed stale controls (opacity 0.55) with no skeleton → "loading" looks identical to "no deployment focused". | AlgoAuditPanel.jsx:466-499,447-462; AlgoSettingsRegion.jsx:2706-2710 | a11y/state | P3 | open (state items need live data) |

**GC-06 (deferred tail) — RESOLVED:** PlatformAlgoMonitorSidebar signal-row directional gradient (764) is **multi-cue** (`BigDirectionGlyph` + BULL/BEAR + action label, not color-only) ✔; its tone is fixed by ALG-01 (green→blue). `CompactMetric` (898) + `WireTrailStatusBand` cells are **control/metric-tile surfaces** (bg1 @ `RADII.xs`, no shadow) → correct SYS-04 opt-out, no conversion. GC-06 closed.

### Backtest — full audit (2026-06-11)
Source audit (4 dims) of `BacktestScreen.jsx` (134 LOC shell) + `features/backtesting/BacktestingPanels.tsx` (7.3k LOC, THE surface) via 2 parallel dimension agents, fact-checked. **Completes Tier 2.**

**Conventions confirmed:** colors flow through a passed **`theme: ThemeTokens`** object (`theme.bg0`/`text`/`green`…) + `cssColorAlpha` — that IS the tokenized system here (not global `CSS_COLOR`). Charts = recharts wrapped in shared `ResearchChartFrame`.

**Strengths verified:**
- **Color tokenized** — only 1 raw literal (`#ffffff`, BT-04); 0 rgba/hex elsewhere. `getStatusColor` (887) is correct operational health; all P&L/Best/Worst greens are financial-outcome + numeric sign co-cue; **direction (long/short) is rendered neutral, not green/red** — no directional drift.
- **Empty states exemplary** — every list/table/chart has contextual zero-state copy (not bare "No data"); dense trade ledger is `overflowX:auto` + `minWidth` + stable `<thead>`; 5-stage execution-phase stepper for long runs; spot-chart has full loading/error/empty branches.
- **Motion clean** — 0 inline transition/animation durations (delegated to shared CSS classes).

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| BT-01 | Draft-strategy **"Return" metric hardcoded `theme.green` unconditionally** → a negative total return rendered green (decorative green on a sign-bearing financial outcome). Made sign-aware (`>=0 ? green : red`), mirroring the Net-PnL headline pattern (4258). Neighboring Max DD (`theme.red`, always loss-framed) + Sharpe (`theme.accent`) are correct. | BacktestingPanels.tsx:1287 | ds/semantic | P2 | done |

**Open — systematic a11y (this surface has ZERO in-file a11y: 0 `aria-*`/`role`/`tabIndex`/`.ra-touch-target`; the 24 aria refs are inside the imported `ResearchChartFrame`, not here). Recommend a focused a11y sub-pass w/ live keyboard+SR:**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| BT-02 | **Keyboard-dead interactions (P1)** — trade-row selection `<tr onClick>` (5856, the primary trades interaction) and the **error/info banner** `<div onClick={setBanner(null)}>` (2930, the ONLY surface for every mutation error: study/run/sweep/promote/cancel/pine) both lack `role`/`tabIndex`/`onKeyDown` → not keyboard-activatable, no focus ring. Banner also lacks a `role="status"`/`alert` live region. | BacktestingPanels.tsx:5856,2930 | a11y | P1 | open |
| BT-03 | **7 charts lack accessible names** — 5 recharts BarCharts (P&L-by-hour 4742, trade-waterfall 5389, P&L-distribution 5455, exit-reasons 5520, hold-profile 5589) + 2 `ResearchChartFrame`s (spot 3653, options 3794) have no `aria-label`/`role="img"`, none `aria-hidden`; adjacent headings are unassociated siblings. | see ids | a11y | P2 | open |
| BT-04 | Segmented toggles convey selection by background color only (no `aria-pressed`): universeMode (3282/3293), summaryTradeLens (4634), indicator library (3554), spotHistoryMode (3472). Plus `#ffffff` raw button text color (987 → wants a `theme.onAccent` token). Touch: `.ra-touch-target` used 0×; shared `buttonStyle` (~24–28px) under the 44px floor across ~23 buttons. | see ids | a11y | P3 | open |

**Open — state coverage (queries swallow error+loading):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| BT-05 | **8 queries consumed as `.data ?? []` with no `isError`/`isLoading`** (runs/jobs/studies/runDetail/runChart/studyPreview/strategies/drafts) → a failed fetch collapses into the same empty copy (indistinguishable from genuinely empty, no retry though refetch exists), and loading shows empty copy then pops in (layout jump, no skeleton). Also: the mutation error banner is dismiss-only with no retry though each mutation is re-invokable; no amber "refreshing" cue on background refetch though timestamps are shown. | BacktestingPanels.tsx:1624-1748,2677-2905 | state | P2 | open (error/loading need live to see) |

**Open — DS / responsive:**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| BT-06 | **SYS-04 real gap (not no-op)** — hand-rolls `cardStyle()` (bg2 + border + ~RADII.sm, no shadow/luminous) used **34×** instead of the shared `surfaceStyle()`/`Card` (bg1 + RADII.md) the other screens use → token AND visual (bg2 vs bg1) divergence on true panel bands (leave the bg0 cell/row/empty-state opt-outs). | BacktestingPanels.tsx:1005 (def)+34 sites | ds (SYS-04) | P2 | open |
| BT-07 | `fontWeight` hardcoded `400` at **56 sites** (no FONT_WEIGHTS import); every weight is 400 → no weight-based hierarchy. Sweep: import FONT_WEIGHTS, consider `.label`/`.medium` for section titles/values. Also raw sticky-toolbar shadow (2973 → `ELEVATION.md`). | BacktestingPanels.tsx (56 sites)+2973 | visual/ds | P3 | open |
| BT-08 | Two-column `minmax(0,1fr) minmax(320px,0.95fr)` grids (Logs/Execution-Phases 6166, Persisted-Results/Compare 6333) don't collapse on phone though `backtestIsPhone` exists (only drives root padding) → 320px min overflows 390px viewport; other 2-col grids (4434,6296,6711) render cramped two-up with no collapse. | see ids | responsive | P2 | open (needs 390 shoot) |

_(Tier 2 COMPLETE: Flow · GEX · Research · Algo · Backtest all audited.)_

## Tier 3 — Diagnostics · Settings  _(lower "functional-and-clean" bar)_

### Diagnostics + Settings — full audit (2026-06-11)
Source audit (4 dims, a11y/state-weighted per the Tier-3 bar) of `DiagnosticsScreen.jsx` (1.9k LOC) + `SettingsScreen.jsx` (3.7k LOC) + `settings/{DiagnosticThresholdSettingsPanel,IbkrLaneArchitecturePanel}.jsx` via 2 parallel agents, fact-checked. **Completes the screen-by-screen audit sweep (Tier 1 + Tier 2 + Tier 3).**

**Strengths verified (recon hypothesis corrected):**
- **Keyboard reachability is GOOD** — both agents confirmed essentially every `onClick` is on a native `<button>`/`<input>`/`<label>` (the recon's "35/19 div-onClick" was a grep artifact — same-line `<button` filtering). **No keyboard-dead clickable cluster** (unlike Research/Backtest). Native `button:focus-visible` ring covers them (SYS-09).
- **Fully tokenized** — 0 raw hex/rgba; 0 `transition: all`; weights mostly `FONT_WEIGHTS.*` (Diagnostics 0 raw; Settings has some). The ~96 `CSS_COLOR.green` are **operational health** (connected/synced/healthy/enabled), doctrine-correct on config screens; the `"green"` literal (SettingsScreen:2047) is a theme-option value. No directional drift.
- **Settings state coverage strong** — mutation error/saving/success(toast) paths surfaced; 2 destructive actions already `window.confirm`-gated; contextual empty states.

**Fixed this pass** (typecheck green):
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| DIAG-01 | Live-updating stream-state indicator (`LIVE/RECONNECTING/POLLING/ERROR` + age) was a bare `<span>` → SSE state changes silent to screen readers. Added `role="status" aria-live="polite"`. | DiagnosticsScreen.jsx:1234 | a11y | P2 | done |

**Open — Settings state coverage (highest product value — destructive data loss):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| SET-01 | **Irreversible destructive actions fire immediately with no confirmation/undo** — "Reset defaults" (wipes ~20 workspace keys), Clear ticker/trade/flow history, Clear storage prefs, Reset synced prefs, Reset alerts, Clear dismissals. Some are styled `danger`=red but none confirm. The screen **already uses `window.confirm`** twice (storage prune 1778, bridge override 3052) → reuse that pattern. | SettingsScreen.jsx:2559,2741-2780,1909-1947,2012,2488,2526 | state | P2 | open (behavior change — wants greenlight) |
| SET-02 | **Storage-clear errors swallowed** (`catch {}`) with no toast/feedback — user clicks "Clear chart scale prefs" and gets zero success/failure signal. | SettingsScreen.jsx:1168-1190 | state | P2 | open |

**Open — systematic a11y (both screens; 0 `aria-*` in-file except 1; recommend folding into the cross-screen a11y sub-pass w/ live SR):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| DIAG-02 | Audio diagnostic alerts + the Active-Alerts list have **no SR-equivalent live region** (audio chime is the only new-alert cue); also no `role="status"` on the alerts container. | DiagnosticsScreen.jsx:1300-1364 | a11y | P2 | open (needs live SR) |
| TIER3-A11Y | **Hand-rolled tab rails lack `role="tab"`/`aria-selected`/`tablist`** (Diagnostics 1273, Settings 3466 — both have the accessible `SegmentedControl` primitive available); **Settings panel titles render as `<div>` not headings** (SurfacePanel, ~30 panels → no heading outline); **IbkrLane inputs unlabeled** (select/number/list/add-symbol next to `<div>` labels, no `<label>`/`aria-label`: IbkrLane 198/214/222/370/548); settings search input placeholder-only (587); toggle-button groups lack `aria-pressed` (Settings 3204-3252, 2450, 2805); checkbox-switches lack `role="switch"` (optional, Tier-3 floor met by labeled checkbox). | see ids | a11y | P2/P3 | open |
| TIER3-TOUCH | `.ra-touch-target` used **0×** across all Tier-3 files → hand-rolled `smallButton` (~17–30px) + tab buttons (~23px) below the 44px touch floor (~25+ buttons each screen). Shared `Button` already floors correctly → route through it or add the class (needs touch-width live check). | DiagnosticsScreen smallButton 1844 + tabs 1272; SettingsScreen smallButton 376 + tabs 3466; panels | a11y | P2 | open (needs touch shoot) |

**Open — Diagnostics state coverage + responsive (mostly needs-live):**
| id | finding | evidence | dim | sev | status |
|----|---------|----------|-----|-----|--------|
| DIAG-03 | Fetch errors swallowed (`.catch(()=>{})`) on history/events/detail/poll → render as empty/neutral, no error tone or retry though `loadHistoryAndEvents` refetch exists. No loading skeletons (value pop-in) and no amber stale cue when the snapshot ages out during reconnect. | DiagnosticsScreen.jsx:878-883,945-998,1366-1389,1234 | state | P3 | open (needs live) |
| DIAG-04 | Storage + Events tabs use fixed 2-col grids that don't collapse on phone (others use `auto-fit minmax`). | DiagnosticsScreen.jsx:1806-1818,1820-1834 | responsive | P3 | open |
| SET-03 | Stale-while-loading without "refreshing" cue (SignalMonitor 2841, ThresholdPanel 257, Lane 937); IbkrLane fixed multi-col grids don't stack (239,590,751); fontWeight raw 500/600 → `FONT_WEIGHTS.*` (376,3476); hand-rolled `SettingCard` inside `Panel` = borderline nested-card mosaic (680-734). | see ids | state/responsive/ds | P3 | open |

_(Tier 3 COMPLETE → **all screens audited**: Tier 1 (Market/Signals/Trade/Account) · Tier 2 (Flow/GEX/Research/Algo/Backtest) · Tier 3 (Diagnostics/Settings).)_
