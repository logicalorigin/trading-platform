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

_(Research · Algo · Backtest — pending)_

## Tier 3 — Diagnostics · Settings  _(lower "functional-and-clean" bar)_
_(pending)_
