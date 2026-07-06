# PYRUS Frontend Design Audit — Round 5 (2026-07-06)

Fifth sweep — a **full app-wide VISUAL design-quality** pass (broader lens than Round-4's token-drift): crowding, muddled hierarchy, redundant/no-single-job surfaces, inconsistent control paradigms, misalignment, poor empty-state design, decoration-over-affordance. Grounded in **authenticated screenshots of all 11 screens** reviewed against `DESIGN.md`.

- **Method:** authenticated headless screenshots (11 screens) → per-screen vision review (workflow `wf_97c2a0a2-4cc`, 11 reviewers + synthesis) → ranked worst-offenders. Raw findings: `docs/audits/frontend-audit-round5-2026-07-06.raw.json`.
- **Result:** **57 real findings → 22 ranked** (10 high / 12 medium). Visual board (screenshots + fixes): https://claude.ai/code/artifact/e89449eb-f9be-480e-80a6-40c0b5f11db6
- **Scope decision (user):** full app-wide, "discover + show me" — surface the shortlist for the owner to approve before remediating (except clearly-safe fixes).

## ✅ Done this session (the safe bucket)

**Shortlist #01 — loading-state duplication (the #1 highest-impact, most pervasive defect)** — resolved app-wide via **two shared-component fixes**. Typecheck green. **Uncommitted** in the working tree.

1. `components/platform/primitives.jsx` — `DataUnavailableState` no longer renders the redundant auto-synthesized `ContainerLoadingStatus` wait-line for the simple `loading` case (title+detail+spinner is the message). Removed the now-orphaned `loadingEndpoint` prop. **Kills the dup on:** market, trade (option chain), account monitor, algo (STA table + monitor), backtest (monitor) — every auto-path `DataUnavailableState` loader.
2. `screens/AccountScreen.jsx` — `AccountPanelSuspenseFallback` dropped its debug wait-line (was leaking literal source paths e.g. `src/screens/account/PortfolioExposurePanel` + "…panel module / reads …" copy to users). Removed the `ContainerLoadingStatus` import, the `waitItems`/`endpoint` plumbing, and all **9** inert call-site `waitItems` arrays.

> `GexScreen.jsx` uses an explicit `loadingWaitItems` too, but its copy is user-facing (`"SPY GEX inputs"`) — **verified clean, left alone.**

## ⚠️ Uncommitted inventory (what the next agent should commit)

| File | Change | Commit as |
|---|---|---|
| `components/platform/primitives.jsx` | Round-5 #01 loading-dup fix | Round-5 loading-state cleanup |
| `screens/AccountScreen.jsx` | Round-5 #01 account debug-copy fix | (same commit) |
| `scripts/headless-shot.mjs` | tooling: `--settle`, `--storage-state` (reusable visual-QA) | separate chore commit |
| `FRONTEND_AUDIT_ROUND5.md`, `docs/audits/frontend-audit-round5-2026-07-06.raw.json` | this handoff + raw findings | docs commit |
| `artifacts/api-server/__mint-agent-session.mts` | untracked throwaway (OUT path → this session's scratch) | do NOT commit; revert OUT path if desired |

- **Do NOT bundle** `features/platform/PlatformWatchlist.jsx` — it still carries an **unrelated in-flight signal-workstream change** (`signalBarsSinceTokens`), not part of Round 5.
- HEAD is `9ec12d78` (Round-4 complete). Commit directly on `main` per this workstream's convention (Rounds 3/4 did).

## 🔁 Visual-QA infrastructure (how to reproduce populated screenshots)

The app gates data screens behind auth; unauthenticated screens render empty. To capture **populated** screens:

1. **Mint an agent session** (QA admin `qa-chooser-temp`): `cd artifacts/api-server && node_modules/.bin/tsx __mint-agent-session.mts` → writes a Playwright `storageState` cookie file (valid ~24h; re-mint when expired). Edit its `OUT` const to your session scratchpad first.
2. **Screenshot recipe** (waits for real content, not the boot gate):
   `node scripts/headless-shot.mjs "https://$REPLIT_DEV_DOMAIN/?screen=<slug>" --out <p.png> --viewport 1440x900 --full --wait-for '[data-testid="platform-screen-stack"]' --wait 20000 --settle 7000 --storage-state <storageState.json> --json`
   - Slugs: `market signals flow gex trade account research algo backtest diagnostics settings`.
   - `.ra-shell` is NOT a "loaded" signal (the boot gate has it too) — key off `platform-screen-stack`.
3. **Algo control panel** without data: `/preview-algo.html` (dev harness mounts `AlgoSettingsRegion` + `HaltStrip` with the default profile).

## 📋 Suggested next batches

- **Done:** #01 (shipped, needs commit).
- **Mechanical quick wins (low-risk, high-clarity):** #06 (semantic-color fall-through: green on unknown/error), #18 (header counts contradict body — "0 visible"/"0/0 shown Loading"), #21 (backtest design-doc prose copy).
- **High-impact, moderate:** #03 (broker-down state re-announced ~5× on algo), #05 (theme setting shown twice with conflicting values), #07 (account KPI ticker), #09 (backtest empty-lead + duplicate create-study), #10 (signals interval state ×3).
- **Significant restructures (scope separately):** #02 (market chart-cell chrome → hover reveal), #08 (research graph layout).
- **Note:** several findings misattribute the exact source line — **verify each against source before fixing** (Round-5 learning: e.g. market "0 visible" was pinned to `cfg.count` which can never be 0). Get owner approval on restructuring items before editing.

## Ranked shortlist (22)

### #01 · HIGH · mechanical · market, trade, account, backtest, diagnostics, settings, algo ✅ SHIPPED
**Algo Monitor loading state repeats itself 2-3x + leaks raw timer**

- **Issue:** The shared Algo Monitor / DataUnavailableState loading component prints the same copy twice or three times in every right-rail across the app: a title ('Loading algo monitor'), a subtitle ('Pulling deployment cockpit data.'), then a third concatenated wait-line re-emitting title+detail verbatim plus a raw elapsed counter ('… - 0.0s' / '11.1s'). This appears on 7+ screens, so a routine loading state reads as broken everywhere, and surfacing raw internal timings (and, on account, module/implementation debug copy) breaks the calm-workspace doctrine.
- **Fix:** Fix once at the source: in formatLoadingWaitLine, when the visible title/detail already render above the wait-line, suppress the duplicate and show only a subtle elapsed timer (or fold '· 0.0s' into the detail). Gate the raw seconds + module/implementation copy behind a diagnostics flag.
- **Files:** `components/platform/ContainerLoadingStatus.jsx`, `features/platform/PlatformAlgoMonitorSidebar.jsx`

### #02 · HIGH · significant · market
**Per-cell chart chrome dominates the market grid (controls louder than data)**

- **Issue:** Each of the six MultiChartGrid cells wraps its price panel in ~25 unlabeled icon-only controls (top toolbar, 7-icon left rail, bottom-right cluster, footer) tiled 6x, so the grid reads as a dense field of tiny affordances while the primary read — price action — is the quietest thing on the page. Hierarchy is inverted and tap targets are cramped.
- **Fix:** Demote per-cell chrome to hover/focus reveal (show only ticker + timeframe + expand at rest; surface drawing/indicator toolbars on cell focus). Collapse undo/redo/camera/gear/+4 into one overflow menu, add aria-labels to icon controls, and let the price panel own the visual weight.
- **Files:** `features/market/MarketChartCell.jsx`, `features/charting/ResearchChartSurface.tsx`

### #03 · HIGH · moderate · algo
**One broker-down fact re-announced ~5x on Algo screen**

- **Issue:** The 'bridge is down' state is broadcast by four+ competing surfaces at once: WARNING + BROKER OFF + OFFLINE header pills (WARNING and OFFLINE are the same derived state, BROKER OFF is its cause), the left status strip (NO SIGNAL DATA / NO ALGO EVENTS), the WIRE TRAIL 'ARMED' pill, and the center GATEWAY 'Start the broker bridge' callout. A trader scanning for the single actionable state sees a cluster of red/amber chips that all mean one thing, burying the primary read.
- **Fix:** Collapse to one authoritative status chip (e.g. amber 'BROKER OFF') and drop the redundant WARNING+OFFLINE pills; let the single GATEWAY callout own the start-the-bridge next-action. Don't re-render the same broker state in the status strip and WIRE TRAIL.
- **Files:** `screens/algo/AlgoLivePage.jsx`, `screens/algo/AlgoStatusBar.jsx`

### #04 · HIGH · moderate · flow
**Flow Scanner clips its live status mid-word while empty Algo Monitor hogs equal width**

- **Issue:** During active scanning the Flow Scanner truncates the exact content a trader is watching — 'SCANNIN', 'warmi…', ticker pills clipped to 'ASML scan..', 'Q..', 'M..' — because the equally-wide Algo Monitor beside it sits completely empty ('No algo deployment'). Space is misallocated so the primary live read (which symbols the scanner covers + coverage state) is unreadable.
- **Fix:** Give the Flow Scanner column enough width to render labels + pills, reclaiming width from the empty Algo Monitor (collapse it to a thin strip until a deployment exists, or stack both right panels in one fixed-width rail instead of competing horizontally).
- **Files:** `features/flow/FlowScannerStatusPanel.jsx`, `features/platform/PlatformAlgoMonitorSidebar.jsx`

### #05 · HIGH · moderate · settings
**Theme setting exposed twice with two paradigms showing conflicting values**

- **Issue:** Theme is controlled by two separate widgets that disagree: a segmented Dark/Light toggle in 'App Preferences' (showing LIGHT) and a System/Dark/Light dropdown in 'Appearance' (showing System). A trader sees the same setting reported as both 'Light' and 'System' and can't tell which is authoritative — and it blurs why 'App Preferences' and 'Appearance' are separate sections at all.
- **Fix:** Expose theme through ONE control (keep the Appearance System/Dark/Light dropdown as single source synced to the live theme, or keep one quick-toggle and drop the dropdown). Never show conflicting values.
- **Files:** `screens/SettingsScreen.jsx`

### #06 · HIGH · mechanical · settings, diagnostics
**Green 'healthy' color painted on unknown/error states**

- **Issue:** Status chips fall through to green (healthy) for non-healthy states: the Settings Diagnostics chip renders GREEN while reading 'unknown' (only severity==='warning' turns amber; unknown/error/critical stay green), and the Diagnostics top-row spends buy/bullish BLUE on a neutral 'UNKNOWN' state. Color is the only cue and it misrepresents system health in a workspace whose whole job is trustable freshness.
- **Fix:** Map unknown/missing/degraded to amber and error/critical to red; reserve green for verified-healthy. Use amber/neutral (not blue) for UNKNOWN. Add a non-color cue (icon/word) so severity isn't hue-only.
- **Files:** `screens/SettingsScreen.jsx`, `screens/DiagnosticsScreen.jsx`

### #07 · HIGH · moderate · account
**Account performance summary is a cryptic single-line ticker of ~13 equal-weight KPIs**

- **Issue:** The Account screen's primary read is one thin line of ~13 uppercase abbreviated metrics at equal weight ('ADJ RETURN — · P&L Δ — · TRADES 0 · … PF — · EXP — · CURDD — · DEV — · INT —'), most values em-dashes. The two truly primary numbers read the same size as 11 tertiary ratios, so a trader can't scan account health and must decode abbreviations.
- **Fix:** Promote 2-3 headline metrics (Adj return, P&L Δ, Trades/Win) into a real StatTile row with larger value type; demote PF/Exp/MaxDD/CurDD/Fees/Dev/Int into a labeled secondary cluster or 'more stats' disclosure. Spell out / tooltip the abbreviations.
- **Files:** `screens/account/AccountHeroBlock.jsx`

### #08 · HIGH · significant · research
**Research relationship map is unreadable where it matters (overlapping bubbles + colliding labels)**

- **Issue:** The force-directed graph — the entire point of the Graph view — collapses its densest region (center-left) into an illegible pile: 2-letter node codes stack on top of each other and company labels collide into strings like 'PANW 50 NOVT / SBGSY / CRWD / COIN', while the right third sits nearly empty. The primary read is unusable.
- **Fix:** Increase node collision radius / charge repulsion and spread nodes across the full canvas width instead of clumping. Suppress labels below a size threshold (show on hover/selection) so small-node text stops colliding.
- **Files:** `features/research/PhotonicsObservatory.jsx`

### #09 · HIGH · moderate · backtest
**Backtest leads with an empty section and duplicates the 'create study' action**

- **Issue:** The configure→run→inspect screen leads with an empty 'Promoted Drafts' results band ('No promoted draft strategies yet'), pushing the actual work below it. Then two stacked surfaces both claim to create a study: Research Workbench's empty state with a [Create study] button and the Backtest Inputs form directly below with its own [Save Study] button (both call handleCreateStudy). A trader can't tell which is authoritative or how the two actions differ.
- **Fix:** Move Promoted Drafts below the config + charts workspace (or collapse to a thin strip). Collapse to one study-creation surface: the Research Workbench 'Create study' button should scroll/focus the Backtest Inputs form, and both button labels should match.
- **Files:** `features/backtesting/BacktestingPanels.tsx`

### #10 · HIGH · moderate · signals
**Signals screen has no single primary read — interval/idle state echoed across 3+ surfaces**

- **Issue:** The identical 1M/2M/5M/15M/1H/1D idle set is rendered three times on one screen — interval tiles ('idle / B 0 — S 0'), the hydration-strip chips ('1M idle 2M idle …'), and the header 'Intervals idle' pill — plus a summary stat row (BUY/SELL/NET 0) that overlaps the per-interval tiles' B/net/S. Everything reads '0' at equal weight, so there is no authoritative surface and no primary read.
- **Fix:** Pick one home for per-interval hydration/idle (fold the hydration-strip chips into the tiles, or only render the strip while actively hydrating; let the header pill be the single summary). Don't decompose BUY/SELL/NET in both the summary row and the tiles.
- **Files:** `screens/SignalsScreen.jsx`

### #11 · MEDIUM · moderate · research
**Research bubbles carry two conflicting red/green encodings that fight the app palette**

- **Issue:** Each node uses red/green twice for different meanings: fill = categorical 'Vertical' (NVDA green, AMD red) while a separate outer ring = profitability (green profitable / red unprofitable). So red/green means sector on the fill but P&L on the ring, colliding with the app's own palette (blue=buy, red=sell, green=P&L) — a giant green NVDA beside a red AMD reads as bullish-vs-bearish when it's neither. The ring legend only shows in non-default color modes, so the default view's rings are unexplained and the key sits below the fold.
- **Fix:** Always show the ring legend and co-locate the color key next to the color-mode toggle. Stop using red/green for categorical vertical fills — reserve red/green for the P&L ring and give verticals a distinct hue ramp.
- **Files:** `features/research/PhotonicsObservatory.jsx`

### #12 · MEDIUM · moderate · diagnostics
**Diagnostics diagram uses 5 cryptic glyphs + 'n/o' jargon with no legend**

- **Issue:** The primary Backend Data Machine diagram mixes five status glyphs (?, ✓, !, –, ○) plus the unexplained 'n/o' abbreviation with no legend anywhere. '?' reads as 'help', repeated '? n/o' on Broker Feed / Signals / Algo Engine gives no plain meaning, and a trader can't map the 'Degraded — 4 states need attention' header to which glyph counts as attention.
- **Fix:** Add a compact glyph legend (OK / warn / unknown / idle / info) near the title and replace 'n/o' with 'no data' / 'not reporting'. Distinguish unknown/not-observed from help (hollow dot or amber 'stale' tag).
- **Files:** `screens/diagnostics/MachineStateDiagram.jsx`, `screens/diagnostics/machineStateDiagramModel.js`

### #13 · MEDIUM · moderate · flow
**Flow preset chips duplicate the Filters panel with no active-state link**

- **Issue:** Flow-type and premium-threshold controls are duplicated across two co-visible surfaces: the PRESET SCANS chip row (Sweeps/Blocks/Repeats/Golden, $50K+/$250K+) repeats the Filters panel directly below (Sweep/Block/Repeat/Golden; $50K/$100K/$250K). Two overlapping ways to set the same filter, stacked, with no indication of precedence or which is active.
- **Fix:** Make presets a true shortcut layer that visibly sets the Filters-panel chips (panel = single source of truth), or drop the overlapping chips from one surface. Show one active-filter summary, not two independent control sets.
- **Files:** `screens/FlowScreen.jsx`

### #14 · MEDIUM · moderate · market, trade
**Nested cards + double-labeled loading overlays in market/trade chart surfaces**

- **Issue:** Loading placeholders render as bordered, shadowed boxes floated inside already-bordered chart cells (a card inside a card) — six identical pop-out panels on market, and a dashed box inside the panel's own dashed border on the trade option chain. They also double-label ('SPOT FEED' eyebrow above 'LOADING' title). The trade spot-feed variant uses an opaque card bleeding over ghost candles that reads like a render glitch.
- **Fix:** Render loading copy as a flat centered label directly on the skeleton (no border/bg/shadow) so it reads as part of the chart surface. Drop the redundant eyebrow or merge into one line. Remove the double dashed frame on the option chain.
- **Files:** `features/charting/ResearchChartSurface.tsx`, `features/trade/TradeChainPanel.jsx`, `features/trade/TradeEquityPanel.jsx`

### #15 · MEDIUM · moderate · trade
**Trade chart band shows three inconsistent empty/loading paradigms side by side**

- **Issue:** The three adjacent chart/chain panels each use a different empty-state kit: spot chart = left-aligned solid gray card, uppercase-mono, no spinner; option chart = left-aligned sentence-case bare text, no card, no spinner; option chain = center-aligned amber with spinner in a dashed box. Different alignment, casing, container, and spinner rule in one band that should read as one calm system.
- **Fix:** Standardize one empty/loading treatment across the band: same alignment, type case, container, and a consistent spinner rule (spinner for 'loading', static prompt for 'awaiting user action').
- **Files:** `features/trade/TradeEquityPanel.jsx`, `features/trade/TradeChainPanel.jsx`

### #16 · MEDIUM · moderate · account, signals
**Watchlist editor chrome duplicated onto screens where it has no job**

- **Issue:** The full watchlist-management rail (W… truncated selector, RENAME/DEFAULT/DELETE, MANUAL/SIGNAL/%CHG/A-Z tabs, Filter, DESC, +ADD) is crowded into a narrow rail with tiny targets, and on the Account screen it serves none of the account/positions job while duplicating the ticker set already in the global tape. The active list name is truncated to 'W…' so a trader can't read which list is active.
- **Fix:** Show the full watchlist name; consolidate the sort tabs + rename/default/delete into an overflow menu. On Account, hide the management chrome or reduce the rail to a passive account-context list so account data owns the primary column.
- **Files:** `features/platform/PlatformWatchlist.jsx`

### #17 · MEDIUM · moderate · gex
**GEX 13-panel stack has inconsistent, incomplete section headings + shifting grid widths**

- **Issue:** The primary gamma family (Strike Profile, DEX, Heatmap, Gamma-by-Expiry) gets NO group heading while secondary Greeks get full-width heading bands; 'Open Interest Analysis' is nested inside a grid column at a different indent and wrongly files Volume Profile under it. Separately, independent auto-fit grids give charts different column counts row to row (3-up → full-width → 2-up), reading as a shifting mosaic instead of a steady workspace.
- **Fix:** Give every chart group a consistent top-level full-width SectionHeading at the same nesting level; move the OI heading out of the grid column. Standardize the analytics area on one predictable grid so charts keep uniform width down the page.
- **Files:** `screens/GexScreen.jsx`

### #18 · MEDIUM · mechanical · flow, market
**Section headers/counts contradict the content they label (loading vs error conflation)**

- **Issue:** Headers describe a state the body contradicts: the Flow 'Options Flow Tape · 0 / 0 shown · Loading' header sits atop a fully-rendered 12-ticker distribution grid (the count describes the still-loading tape below, not what fills the panel), and it pairs a blue 'Loading' pill with an amber ⚠ triangle — conflating 'in progress' with 'data issue'. On market, the charts band reads '0 visible' while six cells are on screen.
- **Fix:** Give the distribution grid its own header separate from the tape's '0 shown' count so the count describes visible content. Separate loading (spinner/blue) from a real degradation warning (amber ⚠ only on actual issue). Relabel '0 visible' to what it means (e.g. '6 charts · 0 hydrated').
- **Files:** `screens/FlowScreen.jsx`, `features/market/MultiChartGrid.jsx`

### #19 · MEDIUM · moderate · algo
**Algo settings panel mixes control paradigms with sub-44px cramped targets**

- **Issue:** The AlgoSettingsRegion mixes label+toggle rows with label+toggle+number-field rows where the toggle floats between label and value, so its relationship to the number is ambiguous (does it enable the field or gate the limit?) and toggle/value columns don't align across rows. Rows are tightly packed with decorative icons and switches well under 44px, making a dense config wall hard to scan and click.
- **Fix:** Align into consistent columns (label | toggle | value), tie the number field visually to its toggle (disabled-dim when off), give rows uniform rhythm and larger hit areas, and drop the decorative per-row icons.
- **Files:** `screens/algo/AlgoSettingsRegion.jsx`

### #20 · MEDIUM · moderate · signals, account
**Signals & account filter bands: unlabeled icon buttons + unlabeled chip groups over empty data**

- **Issue:** Dense control bands crowd tiny unlabeled affordances above zero-row tables. Signals packs eight dropdowns then four icon-only buttons (filter/power/expand/refresh) with no labels — power-toggle is indistinguishable from refresh. Account stacks two unlabeled chip groups (ALL·EQUITY·STOCK·ETF·OPTION running into ALL SOURCES·MANUAL·AUTOMATION·…) with two different 'All' pills and no separator, louder than the empty data they filter.
- **Fix:** Give icon buttons visible/tooltip labels + adequate hit area. Group filters into primary + a 'More filters' overflow, and add group labels ('Type', 'Source') or dividers between chip groups. De-emphasize the filter band when the table is empty.
- **Files:** `screens/SignalsScreen.jsx`, `screens/account/PositionsPanel.jsx`

### #21 · MEDIUM · mechanical · backtest
**Backtest bands carry design-doc prose instead of concrete status**

- **Issue:** Every band opens with a paragraph of internal layout-rationale narration ('This keeps the main page analysis-first while still putting the warning inputs above the chart workspace.', 'The spot chart is the primary visual truth surface.'). Four such paragraphs stack down the page, leaking design language into the product and adding heavy reading load that breaks the calm scan.
- **Fix:** Delete the layout-rationale prose. Keep at most a short concrete hint per band; move any genuine onboarding into a one-time help affordance, not persistent body text.
- **Files:** `features/backtesting/BacktestingPanels.tsx`

### #22 · MEDIUM · moderate · gex
**GEX primary symbol selector is the weakest-looking control on the screen**

- **Issue:** The most important control — which underlying you analyze — is an 82px borderless transparent text input with only a 14px search glyph, sitting left of two loud SegmentedControls. It reads as static text, not an editable/searchable field, has no dropdown affordance, and the whole row is right-aligned leaving the prime top-left empty with no screen/symbol title anchoring 'GEX'.
- **Fix:** Promote the symbol selector to the primary control (bordered field, focus ring, chevron/search affordance, more weight than the Graph/Table toggle) and anchor the top-left with a screen/symbol title (e.g. 'SPY · Gamma Exposure').
- **Files:** `screens/GexScreen.jsx`

## Cross-cutting themes

1. Shared loading/empty-state component (ContainerLoadingStatus + Algo Monitor sidebar) duplicates its own copy and leaks raw timers/module debug strings on 7+ screens — one source-level fix removes the single most pervasive polish defect app-wide.
2. The same value/status/control is repeatedly rendered in two or more places with no single authoritative surface (broker state x5 on algo, interval idle x3 on signals, theme x2 on settings, flow filters x2, restart count x2, watchlist tickers duplicating the tape) — the app lacks a single-source-of-truth discipline for status.
3. Semantic color is applied by fall-through rather than by meaning: green leaks onto unknown/error states, blue onto neutral, amber onto live values, and red/green get reused categorically in research — color is frequently the only cue and it misrepresents health/direction.
4. Inverted hierarchy: controls and chrome are consistently louder than data (market chart chrome, algo settings wall, account KPI ticker, GEX symbol input), so the primary read is buried on multiple screens.
5. Cards-inside-cards and inconsistent empty/loading paradigms (nested dashed frames, floated pop-out boxes, three different kits in one band) break the calm unframed-workspace doctrine.
6. Icon-only and unlabeled affordances (chart toolbars, signals/account filter bars, diagnostics glyphs) force decoding and fail a11y label/hit-area rules.
7. Right rails are poorly budgeted: empty Algo Monitor panels claim width that live scanners/data need, then anchor otherwise-blank dead space.

## Worst problem per screen

| Screen | Worst |
|---|---|
| market | Per-cell chart chrome (~25 unlabeled icon controls x6 cells) dominates the grid so it reads controls-first, price-action-last — hierarchy inverted. |
| signals | No single primary read — the same interval/idle state is duplicated across interval tiles, the hydration strip, and the header pill, with every tile showing an equal-weight '0'. |
| flow | The live Flow Scanner clips its own status and ticker pills mid-word while the equally-wide empty Algo Monitor beside it wastes the space the scanner needs. |
| gex | The primary gamma content (Strike Profile/DEX/Heatmap/Expiry) carries no section heading while secondary Greeks do, so a ~13-panel stack is chunked inconsistently and headings can't be trusted to navigate. |
| trade | The option-chain panel restates its loading message twice inside two nested dashed frames — the shared loading component repeating itself. |
| account | The primary performance summary is a cryptic single-line ticker of ~13 equal-weight abbreviated KPIs, so nothing anchors the eye and it must be decoded. |
| research | The 'AI Trade' relationship map — the point of the Graph view — collapses into an illegible pile of overlapping bubbles and colliding labels in its densest region while the right third sits empty. |
| algo | The single 'broker/gateway bridge is down' fact is announced ~5 times (WARNING + BROKER OFF + OFFLINE pills, status strip, GATEWAY callout), so the actionable indicator can't be identified. |
| backtest | An empty 'Promoted Drafts' band leads the page while two overlapping 'create a study' surfaces (Research Workbench empty state + Backtest Inputs form) both claim the primary action. |
| diagnostics | The right-rail Algo Monitor loading panel prints the exact same sentence twice; the diagram's cryptic glyph vocabulary (no legend, 'n/o' jargon) is a close second. |
| settings | Theme exists as two different controls in two sections (segmented LIGHT vs dropdown System) showing conflicting values, so the trader can't tell which is authoritative. |
