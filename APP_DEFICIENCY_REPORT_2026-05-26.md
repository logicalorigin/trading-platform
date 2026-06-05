# PYRUS App Deficiency Report - 2026-05-26

## Scope

I inspected the running PYRUS app at `http://127.0.0.1:18747/` against the API at `http://127.0.0.1:8080/` in desktop `1440x900` and phone `390x844` viewports. Screens covered: Market, Flow, GEX, Trade, Account, Research, Algo, Backtest, Diagnostics, and Settings.

This is an evidence-backed first broad pass plus read-only feature, interaction, safe-control, current-state, deep-scroll/control, accessibility, static API mutation, non-clicking mutation-affordance, and global-shell/navigation passes. The app changed after the first report draft, so the newest artifacts are authoritative where they conflict with older findings. This is not yet a full destructive-action QA matrix for every mutation, order path, save path, and backend state transition.

## Environment And Validation

- App/API were already running.
- API health passed: `curl http://127.0.0.1:8080/api/healthz`.
- Session was live and bridge-ready: `/api/session` reported `environment: live`, two accounts, `ibkrBridge.connected: true`, `strictReady: true`, and `liveMarketDataAvailable: true`.
- Typechecks passed:
  - `pnpm --filter @workspace/pyrus run typecheck`
  - `pnpm --filter @workspace/api-server run typecheck`
- Headless Chromium initially failed on missing `libgbm.so.1`. `replit.nix` includes `pkgs.libgbm`, and direct browser QA launch now works when the Nix libgbm path is injected:

```sh
LD_LIBRARY_PATH=/nix/store/wilz94hzz4q3fss6qvv625zvww4a6s4s-mesa-libgbm-25.0.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
```

## Evidence Artifacts

- Full 10-page desktop/phone pass: `output/app-deficiency-audit/`
- 30s long pass for Market/GEX/Research/Algo: `output/app-deficiency-audit-long/`
- 30s isolated Algo rerun: `output/app-deficiency-audit-algo-rerun/`
- 30s isolated Trade reruns: `output/app-deficiency-audit-trade-rerun/`, `output/app-deficiency-audit-trade-current/`
- Read-only feature/control audit: `output/app-deficiency-feature-audit/`
- Read-only interaction audit for mobile Trade tabs and Account deferred scroll: `output/app-deficiency-interaction-audit/`
- Read-only safe-control audit for Market layout buttons, Flow filter/column toggles, GEX table/graph, Research search/tabs, Diagnostics tabs, and Settings search/category navigation: `output/app-deficiency-safe-control-audit/`
- Current-state feature rerun after later app changes: `output/app-deficiency-current-feature-audit/`
- Targeted current smoke after later `runtimeControlModel.js` changes: `output/app-deficiency-current-smoke-20260526-2137/`
- Deep read-only scroll/control audit: `output/app-deficiency-deep-readonly-audit/`
- Accessibility-tree audit using Chrome CDP `Accessibility.getFullAXTree`: `output/app-deficiency-accessibility-audit/`
- Static API mutation endpoint inventory: `output/app-deficiency-api-mutation-inventory/`
- Non-clicking UI mutation-affordance inventory: `output/app-deficiency-mutation-affordance-audit/`
- Global shell/header/mobile navigation audit: `output/app-deficiency-global-shell-audit/`
- Audit runner: `tmp/pyrus-page-audit.mjs`
- Feature/control runner: `tmp/pyrus-feature-audit.mjs`
- Interaction runner: `tmp/pyrus-interaction-audit.mjs`
- Safe-control runner: `tmp/pyrus-safe-control-audit.mjs`
- Deep read-only runner: `tmp/pyrus-deep-readonly-audit.mjs`
- Accessibility runner: `tmp/pyrus-accessibility-audit.mjs`
- Static API mutation inventory runner: `tmp/pyrus-api-mutation-inventory.mjs`
- UI mutation-affordance runner: `tmp/pyrus-mutation-affordance-audit.mjs`
- Global shell runner: `tmp/pyrus-global-shell-audit.mjs`

## Top Findings

| Severity | Area | Deficiency | Evidence |
| --- | --- | --- | --- |
| Priority | Diagnostics/API | App diagnostics remain `DOWN`/`priority`; API/resource pressure is warning and route latency shifts between options, signal, quotes, account, and Algo routes. | Latest diagnostics snapshot reported API p95 `2378ms`, p99 `6163ms`, RSS `3737.6 MB`, event-loop max `9948.9ms`, resource-pressure `down`/`priority`, and dominant slow route `/algo/deployments/.../cockpit` p95 `9877ms`. Diagnostics tabs still showed option-chain degradation, order read timeouts, stale signal-options inputs, gateway blocks, and memory guidance to pause optional scanners. Screenshots: `output/app-deficiency-deep-readonly-audit/desktop-diagnostics-diagnostics-memory.png`, `phone-diagnostics-diagnostics-events.png`. |
| High | Algo | Algo remains inconsistent by viewport/run. Desktop currently mounts the live grid, but phone can still miss `algo-live-grid`; even when the grid mounts, signal table and positions remain loading. | Targeted smoke: desktop missing `algo-operations-signal-table` and `algo-status-toggle-enable`; phone missing `algo-live-grid`, `algo-operations-header`, `algo-operations-signal-table`, `algo-status-deployment-select`, and `algo-status-toggle-enable` with `Loading signal operations...`. Accessibility/deep runs also saw `Signal Options Gateway Blocked`, `60-61 blocked`, `Loading signal table...`, and `Loading positions...`. |
| High | Trade | Trade option chain/hydration remains stuck even when panels mount. Mobile Chart, Chain, Ticket, and Positions tabs all remain under `CHAIN loading`; desktop shows no live greeks and no live contract depth. | Interaction audit screenshots: `output/app-deficiency-interaction-audit/phone-trade-tab-chain.png`, `phone-trade-tab-ticket.png`, `phone-trade-tab-positions.png`. Feature audit desktop text includes `CHAIN loading`, `Loading option history`, `No live greeks`, `No live contract market depth`. |
| High | Market | Desktop chart hydration is intermittent and layout-control dependent; multi-chart states can show per-symbol stuck placeholders despite bar data existing. | Safe-control initial 6-chart state showed NVDA, DIA, AAPL, MSFT, and TSLA `15m spot bars are not hydrated`; switching to `1x1` cleared those placeholders, then `RESET VIEWS` reintroduced `TQQQ 15m spot bars are not hydrated`. Earlier: `output/app-deficiency-audit-long/desktop-market.png`. Direct `/api/bars?symbol=SPY&timeframe=15m&limit=160` returned 131 bars with last bar `2026-05-26T20:30:00.000Z`. Screenshots: `output/app-deficiency-safe-control-audit/market-desktop-initial.png`, `market-desktop-reset-views.png`. |
| High | Options backend/UI | Option metadata chains load, but snapshot hydration is pathological and diagnostics mark options degraded. | `/api/options/expirations?underlying=SPY` returned 37 expirations. Metadata chain returned 26 contracts in `9.18s`; batch returned 52 contracts in `7.56s`; `quoteHydration=snapshot` took `45.05s` and returned 0 contracts. Trade code starts expirations at `artifacts/pyrus/src/screens/TradeScreen.jsx:2349`, active chain at `:2507`, batch chains at `:2602`. |
| Medium | Account mobile | Phone Account metrics are cramped/clipped. | `output/app-deficiency-audit/phone-account.png`; audit found rails with large internal overflow, including `account-hero-performance-rail` client width `318` vs scroll width `802`. |
| Medium | Flow | Flow renders and filter/column controls respond, but its classification source remains degraded/stale. | Feature and safe-control audits show `Option quote-match data is unavailable from the current Polygon/Massive endpoint; side bars use option trade tick-test.` Safe-control filter and column toggles kept the same degraded state. Screenshots: `output/app-deficiency-safe-control-audit/flow-desktop-filters-toggle.png`, `flow-desktop-columns-toggle.png`. |
| Medium | Research/GEX | Cold page loads are slow enough to show loader states; Research can expose a `LOADING...` marker, and GEX graph/table views remain without Flow context. | Deep audit desktop Research initially showed `Loading curated research themes...`, `Loading universe...STATIC`, and `Loading research workspace`; search for `NVDA` worked, but Comps again showed `85 cos / 209 linksLOADING...`. Safe-control GEX Table/Graph states both showed `Flow context unavailable`. Screenshots: `output/app-deficiency-deep-readonly-audit/desktop-research-initial.png`, `desktop-research-research-comps.png`, `output/app-deficiency-safe-control-audit/gex-desktop-table.png`. |
| Medium | Backtest | Backtest has multiple intentionally reserved or unfinished surfaces beyond the earlier blocked strategy row. | Deep audit showed `Promoted Drafts 0 visible`, `Pine Port (Pending) · vpending_v1 · blocked`, option replay chart reserved/not hydrated, `Skip telemetry is not included in the current run payload`, `Optimizer history is not surfaced in this page yet`, `Adapter Pending`, and `awaiting adapter`. Screenshots: `output/app-deficiency-deep-readonly-audit/desktop-backtest-initial.png`, `desktop-backtest-backtest-lens-long.png`, `phone-backtest-initial.png`. |
| Medium | Settings/Data & Broker | Settings exposes the same options-chain and bridge failure path directly in Data & Broker. | Deep audit search for `IBKR` and Data & Broker navigation showed `HTTP 500 Internal Server Error: The IBKR bridge hit an unexpected error`, `Upstream request failed`, and `IBKR bridge request to /options/chains timed out after 45000ms`. Screenshots: `output/app-deficiency-deep-readonly-audit/desktop-settings-settings-data-broker.png`, `phone-settings-settings-data-broker.png`. |
| Medium | Accessibility/control semantics | The accessibility tree exposes unnamed controls, duplicate ambiguous control names, and pervasive sub-40px targets on operational pages. | CDP accessibility audit found unnamed interactive controls on desktop Market `9`, desktop Trade `6`, desktop Backtest `15`, phone Backtest `14`, and phone Trade `4`. Duplicate names include `button:2m no signal - unknown` x40, `button:BUY` x25, `checkbox:Enabled` x17, `spinbutton:Warn` x17, and date-picker spinbutton labels repeated across Backtest. Artifacts: `output/app-deficiency-accessibility-audit/accessibility-audit-results.json`. |
| Medium | Live mutation coverage | The app exposes a large safety-priority mutation surface that has not been executed in this pass because the session is live/bridge-ready and those actions can trade, alter automation, save settings, queue jobs, cancel jobs, or change bridge/runtime state. | Static route inventory found 66 mutation endpoints, including 8 order endpoints, 10 Algo/automation endpoints, 8 Backtest/Pine endpoints, 9 persistence/settings endpoints, and 24 runtime/bridge endpoints. Non-clicking UI inventory saw 41 enabled mutation-like affordances across Market, Flow, Algo, Backtest, Settings, Research, and workspace tab state. This is a coverage gap, not a confirmed functional failure. Artifacts: `output/app-deficiency-api-mutation-inventory/`, `output/app-deficiency-mutation-affordance-audit/`. |
| Medium | Global shell/Bloomberg | Core shell overlays mostly open, and phone route navigation works, but the Bloomberg Live dock is not reliable. Desktop launcher did not expose player controls after 20s; phone opened the dock but remained `LOADING` with `bufferStalledError`. | Global shell audit: desktop command palette, notifications, IBKR popover, signal/flow tape settings, and sidebar collapse passed. Phone primary nav and More-sheet secondary nav passed for all screens. Bloomberg evidence: `output/app-deficiency-global-shell-audit/desktop-desktop-bloomberg-live-failed.png`, `phone-phone-bloomberg-live.png`; JSON: `global-shell-audit-results.json`. |
| Low/Needs decision | Global header/tape | The signal/broadcast lane intentionally scrolls, but it creates many offscreen/clipped interactive buttons and very small targets. | Feature audit repeatedly recorded header tape widths around `11706px` desktop and `8885px` phone, with 19-24px high ticker buttons. Treat as a UX/accessibility risk unless the marquee is intentionally non-touch-primary. |

## Page-By-Page Notes

### Global Shell

- Desktop command palette, notifications drawer, IBKR status popover, signal tape settings, flow tape settings, and watchlist/algo-sidebar collapse all opened or changed state without page errors in the global-shell audit.
- Phone primary bottom navigation passed for Market, Flow, Trade, and Account. The More sheet also routed successfully to GEX, Research, Algo, Backtest, Diagnostics, and Settings.
- Phone top-level sheets opened for Portfolio Pulse, Algo Monitor, Watchlist, IBKR status, Signal Tape Settings, and Flow Tape Settings.
- Bloomberg Live is the weak global feature. On desktop, clicking the fixed `Open Bloomberg Live` launcher did not expose `Close/Collapse/Reload/Open Bloomberg` player controls after a 20s wait. On phone, Bloomberg opened a player dock, but it stayed in `LOADING` and exposed `bufferStalledError` in the shell text.
- Global shell density remains an accessibility/operability risk. The audit counted 263/263 initial desktop shell controls below 40px, 34/39 phone shell controls below 40px, and 292/298 controls below 40px inside the phone Watchlist drawer. These counts include intentionally dense tape/watchlist controls, but they are still relevant for mobile and assistive-input use.
- Header Flow tape settings surfaced scanner degradation directly in the global frame: desktop showed `Coverage 1/500`, and phone settings exposed `PAUSED` / `EMPTY` alongside the existing `priority` state.

### Market

- Current-state feature rerun previously saw a desktop Market root crash before `market-workspace` mounted: `SyntaxError: Identifier 'formatRuntimeCount' has already been declared`. The later deep pass and latest targeted smoke both loaded desktop Market, so this is no longer a current repro but should remain a regression test.
- Desktop: chart grid stayed in not-hydrated placeholder state after 30s in the long audit, then loaded in the later feature audit. Treat this as intermittent hydration/readiness, not a permanent blank state.
- Phone: SPY chart did hydrate in the long audit, so the failure is desktop/grid-specific or multi-chart-specific.
- Direct bars API contradicts the UI state: SPY 15m returned 131 bars through `2026-05-26T20:30:00.000Z`.
- Latest targeted smoke showed desktop `No live calendar data`; phone showed `SPY 15m spot bars are not hydrated for the broker feed yet`, `flow loading`, `No live sector flow`, and `No live calendar data`.
- Safe-control evidence makes the grid-specific behavior reproducible: the initial 6-chart layout showed five not-hydrated symbols, `1x1` cleared them, and `RESET VIEWS` reintroduced a not-hydrated TQQQ card while `No live calendar data` persisted.
- Accessibility-tree audit found desktop Market has 414 interactive accessibility nodes, 9 unnamed interactive controls, and repeated ambiguous chart/ticker controls such as `2m no signal - unknown` x40, `15m no signal - unknown` x40, `BUY` x25, and `SELL` x20.

### Flow

- Current-state feature rerun previously saw a desktop Flow root crash before `flow-main-layout` mounted with the same `formatRuntimeCount` syntax error as Market. The later deep pass and latest targeted smoke both loaded Flow, so this is now a regression risk rather than an active repro.
- Page rendered and did not crash.
- Later feature audit showed 4 visible flow rows, so the original `0/550` state was transient or session-dependent.
- Degradation remains: quote-match data is unavailable and Flow falls back to option trade tick-test classification.
- Filter and column toggles responded in the safe-control audit, but every state retained the quote-match unavailable/stale/down issue lines. The control surface works; the data quality does not.
- Accessibility-tree audit found Flow is mostly named, but repeated row actions all share identical accessible names (`Pin flow row`, `Copy flow contract`, `Open flow row in Trade`) across rows, which makes screen-reader context ambiguous without row-specific labels.

### GEX

- Cold load showed `Loading GEX for SPY` in the first broad pass.
- By 30s, desktop and phone rendered.
- Direct `/api/gex/SPY` returned usable rows, but source status was `partial` and `flowContextStatus` was `unavailable`, so the page is data-degraded even when visible.
- Safe-control Table and Graph clicks both rendered, but both continued to expose `Flow context unavailable`.
- Accessibility-tree audit found a small number of unnamed controls on GEX (desktop 3, phone 1) and widespread small targets, but the larger deficiency remains missing Flow context.

### Trade

- Desktop feature audit showed the core trade panels mounted, but issue text still included `CHAIN loading`, `Loading option history`, `No live greeks`, and `No live contract market depth`.
- Phone interaction audit confirmed tab switching works for Chart, Chain, Ticket, and Positions, but every state still carried `CHAIN loading`.
- Deep phone audit added a chart-specific failure: the Chart tab showed `SPY 5m spot bars are not hydrated for the broker feed yet`, then Chain/Ticket/Positions tabs mounted while retaining chain/greeks readiness issues.
- Latest targeted smoke still showed desktop `CHAIN loading`, `Loading option history`, `Loading option chain`, and `STALE`; phone still missed the chain/ticket test IDs on the initial Chart tab and showed `SPY 5m spot bars are not hydrated`.
- Phone Ticket tab mounted the order ticket and could preview a shadow order, so the mobile ticket surface itself is not missing; it is operating against stale/partial chain state.
- Backend evidence says the metadata chain route can return contracts, so this is not just a missing route. Snapshot hydration and slow `/options/chains` are likely contributing, and the UI also needs clearer failure/partial states.
- Accessibility-tree audit found unnamed interactive controls on Trade (desktop 6, phone 4) and nearly all visible DOM controls below a 40px touch target threshold in the audited viewport.

### Account

- Desktop rendered without a hard failure in this pass.
- Phone rendered but key metric rails are too dense and clipped, especially the hero performance rail and exposure metrics.
- A follow-up scroll probe confirmed deferred Account sections do mount after idle/scroll; do not classify Positions, Orders, or Cash as missing based only on the initial first-viewport screenshot.
- Deep scroll audit found no desktop Account issue lines across scroll states and calendar day selection. Phone calendar day selection surfaced `Health unavailable`; treat this as a secondary mobile/date-detail deficiency, not a missing Account page.
- Accessibility-tree audit was comparatively clean on accessible names, but phone Account still had 35 of 36 visible DOM controls below 40px in the first viewport.

### Research

- First pass showed the research workspace loader.
- Long pass loaded the graph, but the later feature audit still showed `85 cos / 209 linksLOADING...` embedded in the graph summary. The main issue is readiness state leakage and cold-load perception, not a persistent blank page.
- Safe-control search and tab checks did work: searching `NVDA` returned 27 matches, and Comps/Macro clicks did not introduce new issue lines. Keep this classified as intermittent readiness leakage, not a broken search/tab feature.
- Deep desktop audit still caught cold-load text (`Loading curated research themes...`, `Loading universe...STATIC`, `Loading research workspace`) and then reproduced the Comps `85 cos / 209 linksLOADING...` marker after a successful `NVDA` search. Phone Research did not reproduce the issue in the deep pass.
- Accessibility-tree audit reproduced the desktop cold-load text again, with only one unnamed interactive node; phone Research had no unnamed interactive nodes in this pass.

### Algo

- Current app behavior remains inconsistent. Deep audit confirmed `algo-live-grid` visible on phone, but the later targeted smoke missed `algo-live-grid`, `algo-operations-header`, `algo-operations-signal-table`, `algo-status-deployment-select`, and `algo-status-toggle-enable` on phone with `Loading signal operations...`.
- Desktop currently mounts the live grid, but still misses `algo-operations-signal-table` and `algo-status-toggle-enable`, and shows `Loading signal table...` / `Loading positions...`.
- Gateway/signal readiness is still degraded. Current audits saw `Signal Options Gateway Blocked`, `60-61 blocked`, and loading operations states.
- Settings can be opened read-only, but it does not resolve the stuck signal table/positions state.
- Accessibility-tree audit found 1-2 unnamed interactive controls on Algo, including an unnamed deployment combobox on phone, plus the same blocked/loading issue text.

### Backtest

- Rendered in desktop and phone.
- Feature and deep audits show `Promoted Drafts 0 visible` and `Pine Port (Pending) · vpending_v1 · blocked`, so part of the strategy/backtest surface is unfinished or intentionally blocked.
- Deep scrolling found additional reserved/incomplete surfaces: the option replay chart is reserved but not hydrated, skip telemetry is not included in the current run payload, optimizer history is not surfaced, Pine adapter state is pending/awaiting adapter, and benchmark data can be unavailable for the selected run.
- Backtest lens buttons are partly data-dependent. `Losers`, `Long`, `Short`, and `Recent` clicked in desktop deep audit; `Winners` was not available in that state. Some chart toolbar controls were not present or not clickable in the Backtest chart state captured by the audit.
- Accessibility-tree audit found the largest naming problem outside Market: desktop Backtest had 15 unnamed interactive controls, phone Backtest had 14, mostly comboboxes that expose values without accessible names. It also found repeated generic date-picker controls (`Show date picker`, `Month`, `Day`, `Year`) and `button:•` x4.

### Diagnostics

- The app itself reports `DOWN`/`priority`.
- Visible active alerts included API p95 latency warnings, gateway readiness blocks, degraded/stale option chains, signal-options stale/unavailable inputs, open-orders timeouts, and COEP reports for the Replit bridge script.
- The API is under high memory and route-latency pressure, so this is a root-cause area before polishing individual screens.
- Safe-control API, Memory, and Events tabs were navigable, but they retained the same `DOWN`/`priority` state. The Memory tab explicitly surfaced operator guidance to pause optional scanners and clear stale caches.
- Latest direct diagnostics evidence uses the `snapshots` shape and still reports `status: down`, `severity: priority`, API p95 `2378ms`, p99 `6163ms`, RSS `3737.6 MB`, event-loop max `9948.9ms`, and resource-pressure `down`/`priority`.
- Deep Diagnostics tabs confirmed recurring issue categories: open-orders snapshot timeout/read-probe degraded, signal-options stale inputs, option-chain upstream failure, gateway blocked counts, automation scan failures, and chart payload shape errors.
- Accessibility-tree audit found many repeated, contextless configuration controls in Diagnostics: `checkbox:Enabled` x17, `checkbox:Audible` x17, `spinbutton:Warn` x17, `spinbutton:Priority` x17, and `Dismiss` x7. The accessibility tree names are present, but repeated without row-specific context.

### Settings

- Rendered in desktop and phone.
- It correctly surfaces the global `priority` diagnostics status, so Settings itself is not failing, but it is another visible entry point into the same runtime health problem.
- Safe-control search for `IBKR` and Data & Broker navigation surfaced hard backend errors: `Upstream request failed` and `IBKR bridge request to /options/chains timed out after 45000ms`.
- Deep read-only Settings repeated the same failure and added `HTTP 500 Internal Server Error: The IBKR bridge hit an unexpected error`. Data & Broker also showed line budget pressure context such as `119 active · 120 reserved`, `Warm-up pending`, and `Account pending`.
- With the `IBKR` search filter active, clicking `System` left Data & Broker content visible; this may be expected filtered navigation, but the current interaction can make category switching feel trapped while search is active.
- Accessibility-tree audit found Settings has few unnamed controls in the actual accessibility tree, but the DOM still exposes 6 unlabeled controls and most visible controls are below 40px.

## Mutation Surface Inventory

No mutation endpoint or destructive/live UI action was invoked. The pass only inventoried source routes and visible controls so the remaining QA surface is explicit.

- Static API inventory found 155 total route endpoints and 66 mutation endpoints: 24 runtime/bridge, 10 automation/Algo, 9 persistence/settings, 8 trading/order, 8 Backtest/Pine, 3 signal-monitor, and 4 mutation-like data/job endpoints.
- Safety-priority order endpoints include `/orders`, `/orders/preview`, `/orders/submit`, `/orders/:orderId/replace`, `/orders/:orderId/cancel`, `/shadow/orders`, `/shadow/orders/preview`, and `/accounts/:accountId/orders/:orderId/cancel`.
- Automation endpoints include deployment create/enable/pause, strategy settings patch, signal-options shadow-scan/backfill/deviation/profile, default paper deployment, and Flow scanner benchmark.
- Backtest/Pine endpoints include study save, run queue, internal option-contract resolution, promote, sweep queue, job cancel, and Pine script create/update.
- Runtime/bridge endpoints include diagnostics threshold/storage/client reports, IBKR desktop register/heartbeat/job actions, remote launch/shutdown, activation/login-key/envelope actions, bridge attach/detach, stock stream session symbols, and IBKR lane settings.
- The non-clicking UI inventory found 41 enabled mutation-like affordances. Examples: Market `RESET VIEWS`, Flow `Pause`/`Stop Flow scan`/`Save preset`, Algo `Disable`/`Run scan`/`Pause`, Backtest `Promote`/`Save Study`/`Save Script`/`Reset`, Settings `Reset`/`Reset to defaults`, and Research graph layout reset.
- Workspace tab `Close` controls in Trade are counted separately as workspace state, not order cancellation. The one UI `trading/order` classification came from an Algo pipeline label/test id containing `Exit/Close`, so it should be treated as a heuristic flag rather than a confirmed order action button.

## Feature/Interaction Audit Caveats

- I did not click destructive or live-trading mutation paths such as place/cancel order, enable/disable deployment, run scan, save/apply settings, delete/remove, or reset actions.
- The safe-control pass clicked only read-only or non-mutating controls: chart layout buttons, filter/column drawers, view tabs, search fields, and diagnostics/settings category tabs.
- The deep read-only pass clicked only read-only UI state controls: mobile Trade tabs, Account calendar day selection, Research search/view tabs, Algo Settings, Backtest trade lenses, Diagnostics tabs, and Settings search/Data & Broker category. It did not queue runs, save/apply settings, save Pine scripts, place/cancel orders, enable/disable deployments, start scans, or delete anything.
- The accessibility pass used Chrome's accessibility tree plus DOM control metrics. It is stronger evidence for accessible names than the earlier DOM-only label heuristic, but it is not a full WCAG/axe audit.
- The static mutation endpoint inventory is source parsing. It does not validate auth, request schemas, idempotency, side effects, or backend success/failure behavior.
- The UI mutation-affordance inventory is label/testId based and intentionally non-clicking. It identifies remaining test surface, not confirmed broken behavior.
- The global shell pass opened only overlays, navigation surfaces, sidebars, and media dock entry points. It did not toggle scan enablement, change settings, mutate watchlists, or operate bridge controls inside the opened panels.
- Current-state artifacts can differ because the app is running from a dirty dev tree. Example: `output/app-deficiency-current-feature-audit/` captured a desktop Market/Flow root crash, while `output/app-deficiency-deep-readonly-audit/` and `output/app-deficiency-current-smoke-20260526-2137/` later loaded both routes.
- Some small-target and clipped-control counts include intentionally scrolling ticker/tape lanes; those counts are useful UX/accessibility evidence but need product design judgment before being treated as bugs.
- Account first-viewport probes can underreport deferred sections. A follow-up scroll probe confirmed deferred Account content mounts.

## Recommended Fix Order

1. Fix Diagnostics/API pressure first: API RSS, `/signal-monitor/matrix`, `/options/chains`, `/quotes/snapshot`, and account/equity-history slow routes.
2. Add a regression smoke for the previously observed `formatRuntimeCount` root crash on desktop Market/Flow; latest targeted smoke passed, but the crash was real in a prior dirty-build run.
3. Fix Algo route consistency and downstream readiness: phone should reliably mount `algo-live-grid`, and `algo-operations-signal-table` / positions should resolve or fail visibly after the live grid mounts.
4. Fix Trade hydration behavior: separate metadata chain display from heavy snapshot hydration, show partial metadata rows immediately, and make chain/chart failures explicit.
5. Fix Market chart hydration/readiness so existing bar API data consistently reaches the multi-chart grid.
6. Fix option snapshot hydration so `quoteHydration=snapshot` does not spend ~45s and return zero contracts when metadata chain rows are available.
7. Tune phone Account rails for wrapping or vertical stacking instead of clipped horizontal density, and investigate phone calendar date detail `Health unavailable`.
8. Resolve Flow quote-match degradation or show it as a first-class degraded data source with operator guidance.
9. Decide whether Backtest reserved surfaces are acceptable placeholders; if not, finish or hide option replay, skip telemetry, optimizer history, Pine adapter, and promoted draft surfaces until they are wired.
10. Fix Bloomberg Live dock startup so desktop launcher and phone More-sheet entry reliably expose player controls and clear failure states instead of staying absent/loading/stalled.
11. Fix accessibility semantics and target sizing for the dense operational controls: label comboboxes/buttons with row-specific context, remove duplicate generic names where screen readers cannot distinguish rows, and set an explicit policy for ticker/tape controls.
12. Create a paper/sandbox mutation harness before exercising order submit/cancel/replace, Algo enable/pause/scan, settings apply/actions, bridge attach/detach, and Backtest queue/promote paths.
13. Add targeted browser QA regression tests for the hard failures: Market/Flow no root crash, Algo signal table visible after live grid, Trade active chain visible after tab switch, Market desktop chart hydrates when bars exist, Diagnostics route pressure alerting, and Bloomberg dock opens to visible controls.
