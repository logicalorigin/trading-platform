# Trading Workspace UI And Feature Expansion Plan

## Objective

Implement a phased evolution of the trading app into a connected, fast active-trading workspace with richer UI, linked A/B/C workspaces, stronger scanner/watchlist coverage, dense chart improvements, a Market calendar overlay, TradingView-style earnings markers, and a disciplined lightweight animation system.

This plan is intended for a long-running Codex goal workflow. Work should be executed incrementally, with each phase independently buildable, testable, and reviewable. Do not attempt this as one large rewrite.

## Current Baseline Notes

- Recent chart regression work is already committed through:
  - `8fbfc21` - unified Market charts with the Trade spot chart path.
  - `18bb5bf` - aligned Market chart flow scanner line budget.
  - `4f52a03` - bounded chart broker hydration windows.
  - `884d234` - guarded chart hydration source wiring and event metadata.
  - `da4183f` - surfaced chart source freshness state.
  - `452e6cd` - bounded stale `/api/bars` in-flight waits.
  - `e443356` - restored the header market-data line usage readout.
- Future work should not repeat those completed fixes unless a new regression is observed.
- Before any phase starts, inspect current files, tests, and git status again. This document may be stale relative to later commits.

## Operating Rules For The Implementing Agent

- Preserve existing dirty worktree changes. Never revert unrelated user edits.
- Before each phase, inspect current files and tests again; this plan may be stale relative to later commits.
- Keep patches phase-scoped.
- Prefer existing repo patterns over new abstractions.
- Avoid new heavy dependencies unless explicitly approved.
- Use CSS-only or existing lightweight React/CSS utilities for motion; do not add Framer Motion.
- After each phase, run targeted tests and record what passed/failed.
- Keep performance in view: bundle size, lazy loading, live-update render scope, chart responsiveness, and motion cost.

## Current Confirmed Decisions

- Use explicit A/B/C linked workspace groups.
- Linked groups sync symbol and active timeframe by default.
- Workspace presets are a high-level switcher.
- Dense chart frames prioritize plot area.
- Scanner default becomes `all_watchlists`.
- Earnings markers default-on for all stock charts.
- Mobile priority is monitoring plus safe trade management.
- Active-Trader-style execution lane is preview/confirmation-first.
- Broad command launcher is deferred.
- Market calendar lives in the Market screen as a modal overlay.
- Calendar layout is a month grid.
- Calendar event model should be extensible toward all market events.
- V1 calendar implementation should phase in earnings first.
- Universe discovery should support paginated full-list behavior.
- Calendar detail opens a modal with details, mini chart, and link to Trade.
- Animation tone: trading-terminal functional motion with some premium polish.
- Loading style: skeleton plus explicit status first; spinners only for unknown waits.
- Live data feedback: moderate flashes that settle quickly.
- Animation priority: whole shell first, then charts/scanners/trade details as phases touch them.
- Reduced motion: respect system preference; do not add a new app-level reduced-motion setting unless already present and easy to reuse.

## Execution Chunks

These chunks preserve the detailed phases below while making the work easier to execute and validate.

1. **Stability And Visual QA Gate**
   - Covers Phase 0 and the regression-sensitive checks from all later phases.
   - Do this before visual or workflow expansion.

2. **Shared Shell, Motion, Loading, And Status Language**
   - Covers Phase 1 and Phase 2.
   - Establish shared primitives before adding linked workspaces, presets, calendar, or workflow motion.

3. **Workspace Context Model**
   - Covers Phase 3 and Phase 4.
   - Add A/B/C linked context first, then workspace presets on top of that state.

4. **Scanner, Watchlist, And Dense Chart Improvements**
   - Covers Phase 5 and Phase 6.
   - Respect existing IBKR line caps and the shared chart path.

5. **Market Calendar And Earnings**
   - Covers Phase 7 and Phase 8.
   - Build the calendar foundation first, then backend earnings data, API clients, and chart markers.

6. **Trading Workflows And Portfolio Workflows**
   - Covers Phase 9 and Phase 11.
   - Keep all execution preview/confirmation-first.

7. **Watchlist Alert Affordances And Mobile**
   - Covers Phase 10 and Phase 12.
   - Keep the full user-authored alert rule builder deferred.

## Cross-Phase Guardrails

- Do not regress the Market chart path back away from the shared Trade spot chart implementation.
- Do not reintroduce chart snapback while panning away from the live edge.
- Do not use Polygon/Massive as the realtime source when IBKR live rotation should be used.
- Keep flow scanner use within the reserved line budget.
- Keep the header market-data line readout visible even if runtime diagnostics are degraded.
- Keep generated API clients in sync with OpenAPI whenever backend contracts change.
- Do not treat mocked validation as live validation. Distinguish local/test validation from live broker/data validation.
- Prefer visible degraded states over silent fallback.
- Keep each phase independently committable.

## Phase 0: Stabilize Visual QA

Goal: Make the app reliably inspectable in dev before UI work expands.

- Resolve the dev-time Vite/HMR overlay around the currently modified `ResearchChartSurface.tsx`.
- Confirm tsc and production build still pass.
- Preserve unrelated dirty changes in chart/account/market/test files.
- Re-run screenshots for all screens after fix.
- Confirm API/auth failures show contextual panel-level degraded states.

Acceptance:

- Dev server renders without the React Babel overlay.
- All nine screens can be opened in Playwright.
- Typecheck and build pass.

Implementation notes:

- Start with `git status --short`, current entrypoints, and current e2e config.
- Use focused browser checks before broad visual work.
- Record any live-data caveats separately from deterministic test results.

## Phase 1: Shell, Visual Language, And Motion Foundation

Goal: Establish a consistent trading-terminal UI language and motion system before adding larger workflows.

- Reorganize shell chrome into stable visual zones:
  - nav
  - symbol/watchlist context
  - account/broker readiness
  - market/session status
  - signal/flow tapes
  - bottom diagnostics
- Reduce header tape dominance, especially on mobile.
- Replace remaining text glyph controls with `lucide-react` icons and tooltips.
- Standardize panel headers with title, active context, link chip placeholder, freshness/provider state, primary action, overflow/settings action.
- Add shared state labels: live, delayed, stale, simulated, shadow, disconnected, degraded, loading.
- Add shell-level motion primitives:
  - panel enter fade/slide
  - popover/modal scale-fade
  - mobile overlay fade
  - sidebar/watchlist width transition
  - active row focus rail
  - link/status chip flash
  - refresh icon spin only while pending
- Motion tone:
  - functional, short, and data-state driven
  - premium enough to feel intentional
  - no decorative or constant background animation
- Reduced motion:
  - use `prefers-reduced-motion`
  - disable nonessential transitions/animations
  - keep necessary state changes visible through color, labels, and static indicators

Acceptance:

- Existing navigation behavior is unchanged.
- Header remains usable at desktop, tablet, and phone widths.
- No visible text/control overlap.
- Shell animations are disabled under system reduced-motion.

Implementation notes:

- Keep shell work separate from chart internals.
- Avoid a landing-page/marketing visual style; this app should remain dense, operational, and fast.
- Verify header and bottom diagnostics at desktop, tablet, and phone widths.

## Phase 2: Loading And Status Animation System

Goal: Replace generic waits with informative skeleton/status states across the app.

### Global Loading Rules

- Prefer skeleton + status text over spinners.
- Use spinners only for unknown waits where no structure/progress is knowable.
- Every loading state should answer:
  - what is loading
  - for which symbol/account/provider
  - whether it is waiting, fetching, hydrating, streaming, or degraded
- Avoid large page-wide spinners except when an entire screen is blocked.
- Keep all skeletons stable-size so layout does not jump.

### Chart Loading

- Initial chart:
  - skeleton plot area with faint grid/axis frame
  - compact center status: symbol, timeframe, provider
  - spinner only if the chart has no known frame/data state
- Chart hydration/backfill:
  - thin top progress/status strip
  - states: fetching history, hydrating indicators, waiting for live bars, streaming
  - no large spinner over candles once data exists
- Dense grids:
  - smaller skeleton/status treatment
  - no center text that blocks candles in 2x3/3x3 after first data paint

### Scanner Loading

- Scanner header status chip with source mode and symbol count/cap.
- Active scan sweep on scanner panel only while scan is running.
- Progress text when reliable: scanned count, queued count, cap.
- Spinner only when the backend provides no progress signal.

### Option Chain Loading

- Row skeletons with subtle shimmer.
- Expiration hydration chip.
- Newly hydrated rows get a short row-enter or background flash.
- Avoid pulsing every row in large chains.

### Flow Tape Loading

- Stream connection status pulse in header.
- Initial rows use skeletons.
- New rows fade/slide in with capped stagger.
- Pinned row uses focus rail, not a constant pulse.

### Calendar Loading

- Month-grid skeleton blocks.
- Pending provider days show event-dot shimmer.
- Detail modal mini chart uses a small chart skeleton.
- Universe pagination shows row skeletons, not a blocking spinner.

### Account/Research/Settings Loading

- Metric tile skeletons.
- Table row skeletons.
- Panel-level degraded messages for provider/API failures.
- Settings and diagnostics use static status chips rather than animated noise.

Acceptance:

- Charts, scanners, option chains, flow tape, calendar, and account tables have informative loading states.
- Spinners are limited to unknown waits.
- Loading states do not shift layout.
- Reduced-motion mode disables shimmer/sweep while keeping static skeletons.

Implementation notes:

- Build shared primitives only if they remove real duplication.
- Verify that skeletons do not resize panels after data arrives.
- Do not add new animation dependencies.

## Phase 3: Linked Workspace Model

Goal: Add platform-style symbol/timeframe linking without a layout rewrite.

- Add linked workspace groups A, B, C.
- Each supported panel can be linked or unlinked.
- Linked context syncs symbol and active timeframe by default.
- Persist link state using existing workspace/local persistence patterns.
- Add link chips to Market chart cells, Trade chart/ticket context, Flow ticker lens/detail, Account positions/orders, Research detail/chart views.
- Broadcast sources: watchlist row selection, Flow row action, Account position/order selection, Research ticker selection, Market calendar event action later.
- On broadcast:
  - link chip flashes briefly
  - affected panels show a short focus rail
  - unlinked panels do not animate or change

Acceptance:

- Selecting a watchlist symbol updates linked panels.
- Unlinked panels retain their own symbol/timeframe.
- Link state survives reload.
- Unit tests cover link-state behavior.

Implementation notes:

- Start with a pure model and persistence tests before wiring UI.
- Keep broadcasts explicit and inspectable.
- Do not create a global live-data fanout as a side effect of linking.

## Phase 4: Workspace Presets

Goal: Add a high-level workspace switcher without adding drag/drop complexity.

- Add presets: Market Monitor, Options Trade, Flow Review, Market Calendar, Risk Review, Automation Desk.
- Presets may switch screens and restore lightweight state.
- Persist per-preset collapsed panels, selected tabs, grid layout, flow columns, account section, sidebar state, active linked group.
- Add "restore preset defaults".
- Preset switch animation:
  - no whole-app crossfade
  - use panel focus rails and restored-context chips
  - keep transition under roughly 200ms

Acceptance:

- Switching presets is deterministic.
- Presets do not destroy user workspace state unexpectedly.
- No heavy layout/grid dependency is introduced.

Implementation notes:

- Build on Phase 3 linked workspace state.
- Keep preset state lightweight and serializable.
- Add reset behavior only after persistence behavior is covered.

## Phase 5: Watchlist Signals And Scanner Coverage

Goal: Improve watchlist signal readability and scanner breadth.

- Replace unlabeled 2m/5m/15m dots with compact mini badges showing `barsSinceSignal`.
- Format counts as 0 through 99, then 99+.
- Preserve color semantics: buy = blue, sell = red, no signal = muted outline.
- Tooltip includes timeframe, direction, freshness, full bar count, error text.
- Preserve existing interval click behavior.
- Add symbol helpers:
  - `activeWatchlistSymbols`
  - `allWatchlistSymbols`
  - `widerUniverseSymbols`
- Add scanner source modes:
  - `active_watchlist`
  - `all_watchlists`
  - `all_watchlists_plus_universe`
- Default scanner source mode: `all_watchlists`.
- Flow scanner pins all watchlist symbols before `/api/flow/universe` symbols.
- Signal matrix passes explicit all-watchlist symbols, capped by existing profile `maxSymbols`.
- Use scanner loading/status patterns from Phase 2.

Acceptance:

- Watchlist badges do not overflow.
- Scanner symbol union de-dupes and preserves priority.
- Signal matrix includes non-active watchlist symbols.
- Unit tests cover formatter and symbol builders.

Implementation notes:

- Keep scanner expansion within existing backend caps.
- Preserve current interval click behavior exactly.
- Test symbol ordering and dedupe separately from UI.

## Phase 6: Dense Chart Frames

Goal: Reclaim plot area and legibility in 2x3 and 3x3 chart grids.

- Prioritize plot area in dense grid layouts.
- Keep full controls in 1x1/solo layouts.
- Compact controls in dense frames.
- Add chart number-format helper for price axis, legend, crosshair labels, overlay labels.
- Use dynamic precision based on price/range.
- Compact large values with K/M/B.
- Reduce repeated RayReplica/dashboard/level labels.
- Add overlay label budget rules.
- Preserve key controls: symbol, timeframe, link chip, reset, settings, chart focus.
- Ensure chart loading/hydration states stay compact in dense grids.

Acceptance:

- Market 2x3 and 3x3 screenshots show cleaner axes/overlays.
- No clipped controls.
- Chart tests cover formatting and overlay budgeting.

Implementation notes:

- Preserve the shared Market/Trade chart path.
- Do not alter panning/live-edge behavior without focused regression tests.
- Include desktop screenshot checks for 2x3 and 3x3 grids.

## Phase 7: Market Calendar Overlay Foundation

Goal: Add a Market-screen calendar modal foundation that can grow into all market events.

- Add Market calendar entry point.
- Calendar opens as modal overlay.
- Use month-grid layout on desktop.
- On mobile, adapt to compact agenda/detail if needed.
- Event model extensible across earnings, revenue reports, dividends, splits, IPOs, economic events, conferences, other market events.
- V1 provider-backed implementation starts with earnings.
- Include filters: active watchlist, all watchlists, held positions, universe discovery, event type, date range, timing, provider state.
- Universe discovery supports paginated full-list behavior.
- Event detail modal includes full metadata, provider/freshness, mini chart, watchlist/position relation, link to Trade, optional linked-chart handoff.
- Use calendar loading patterns from Phase 2.

Acceptance:

- Calendar modal opens/closes reliably.
- Month grid renders without clipping.
- Event detail modal works.
- Empty/degraded/provider-missing states render.

Implementation notes:

- Implement the event model before provider expansion.
- Keep calendar in the Market screen, not as a new app shell.
- Do not fetch a broad universe synchronously on modal open.

## Phase 8: Earnings Data And Chart Markers

Goal: Wire earnings data into the calendar and stock charts.

### Backend

- Add earnings cache keyed by symbol + date + reportingTime.
- Store provider, EPS estimate/actual, revenue estimate/actual, fiscal period, confirmed/estimated status, fetchedAt.
- Reuse existing FMP research provider.
- Fetch monthly chunks for past 2 years through next 180 days.
- Add `GET /api/research/earnings-events?symbol=AAPL&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Query cache first.
- Refresh stale/missing chunks with bounded timeout.
- Keep existing `/api/research/earnings-calendar` unchanged.

### API/Client

- Extend OpenAPI.
- Regenerate API client/zod layers.

### Frontend

- Convert earnings to chart overlay events: `eventType: "earnings"`, `placement: "timescale"`, `label: "E"`.
- Tooltip includes date, BMO/AMC/DMH/unknown, EPS/revenue estimate/actual, fiscal period, provider.
- Anchor BMO near first bar, AMC near last bar, daily/date-only events on day bar.
- Enable by default on Market stock charts, Trade equity chart, Research stock charts.
- Do not show earnings markers on option contract charts in v1.
- Market calendar consumes same earnings-event model.

### Marker Motion

- first render scale/fade
- hover tooltip quick fade
- selected event gets static focus ring or one short pulse

Acceptance:

- Earnings cache/unit tests pass.
- Endpoint filters by symbol/date range.
- E markers render and hover correctly.
- Calendar detail shows earnings event details and mini chart.
- Existing Market calendar card remains unchanged.

Implementation notes:

- Backend contract and generated clients must be committed with frontend usage.
- Fetch earnings only for visible active stock charts.
- Keep option contract charts free of earnings markers in v1.

## Phase 9: Flow And Trade Workflow

Goal: Make Flow-to-Trade handoff predictable while keeping execution guarded.

- Add Flow row action rail: pin, chart option, open underlying chart, send to ticket, mute ticker, copy contract.
- Strengthen pinned Flow detail: execution quality, option identity, underlying context, related prints, Trade handoff.
- Improve Trade hierarchy: selected contract strip, clearer ticket mode, bid/mid/ask flash, position-aware defaults, inline disabled/live-trading reasons.
- Add Active-Trader-style execution lane as preview-only.
- Route all execution through current confirmation safeguards.
- Motion:
  - row enter for new flow
  - focus rail for pinned/selected rows
  - moderate bid/mid/ask value flashes
  - no animation that implies an order was placed before confirmation

Acceptance:

- Flow row action behavior covered by tests.
- Preview lane cannot bypass confirmation.
- Trade options layout tests pass.

Implementation notes:

- Keep execution preview/confirmation-first.
- Do not add fast-submit trading.
- Add tests proving the preview lane cannot bypass existing safeguards.

## Phase 10: Watchlists, Alerts, And Scanner Presets

Goal: Add useful scanner affordances before user-authored alert rules.

- Start with scanner presets: momentum, earnings week, unusual calls, unusual puts, high relative volume, held positions.
- Add watchlist badges: earnings soon, active signal, flow spike, open position, stale/no data, linked target.
- Preserve sorting.
- Make active sort/filter state clearer.
- Defer full user-authored alert-rule builder.
- Motion:
  - fresh-signal badges may pulse briefly
  - stale/no-data badges remain static
  - preset changes use quick chip/focus feedback

Acceptance:

- Presets selectable and persisted.
- Badges fit dense rows.
- Existing watchlist scan tests remain green.

Implementation notes:

- Build scanner presets using existing scanner/profile architecture where possible.
- Avoid creating a broad alert-rule builder in this phase.
- Keep stale/no-data states static and readable.

## Phase 11: Account, Risk, Algo, Backtest

Goal: Make reporting screens actionable without bloating the shell.

- Account position opens linked Trade.
- Order/closed trade opens detail and chart context where feasible.
- Risk concentration filters related positions/orders.
- Add shared portfolio risk strip: buying power, open risk, day P&L, margin pressure, concentration, live/shadow.
- Algo/Backtest: send candidate to Trade, compare recent backtest, show live/shadow state, surface blocked reasons.
- Add earnings-aware warnings and backtest earnings windows later.
- Use Phase 2 loading and moderate value flashes for metrics.

Acceptance:

- Account workflow links are explicit and reversible.
- No accidental trade execution.
- Existing Account/Algo/Backtest tests remain green or are updated intentionally.

Implementation notes:

- Keep Account links explicit; do not surprise-switch trading context without link state.
- Treat live/shadow state as a trust surface.
- Earnings-aware warnings can follow after Phase 8 data is in place.

## Phase 12: Mobile UX

Goal: Optimize for monitoring plus safe management.

- Mobile Market: selected chart, compact watchlist drawer, calendar modal adapts to agenda/detail.
- Mobile Flow: card tape with sticky filter/sort.
- Mobile Trade: chart, chain, ticket as stacked tabs.
- Mobile Account: risk summary, positions, orders.
- Reduce mobile header density.
- Disable or simplify nonessential animation on phone widths if screenshots/perf show jank.

Acceptance:

- Mobile screenshots for Market, Flow, Trade, Account pass visual checks.
- Watchlist signal badges and dense chart controls do not overflow.
- Safe trading confirmations remain visible.

Implementation notes:

- Mobile is for monitoring plus safe management, not full desktop parity.
- Test with real narrow widths, not only responsive CSS assumptions.
- Confirm confirmations remain visible above mobile keyboards/overlays where relevant.

## Deferred Or Later

- Broad command launcher.
- Full user-authored watchlist alert-rule builder.
- Drag-and-drop custom layout engine.
- Economic events and all non-earnings event providers unless needed earlier.
- Fast-submit trading from Active Trader lane.
- App-specific reduced-motion setting unless already present and trivial to reuse.

## Performance Guardrails

- No Framer Motion.
- No new charting library.
- No heavy drag-grid library.
- No broad command-palette dependency.
- Keep Research/theme datasets lazy.
- Fetch earnings only for visible active stock charts.
- Calendar universe discovery is paginated.
- Scanner expansion respects existing limits.
- Avoid global live-data fanout.
- Use transform/opacity animation where possible.
- Track large bundle areas: `vendor-hls`.

## Validation Matrix

Run these checks as relevant to touched areas:

- `pnpm --filter @workspace/rayalgo typecheck`
- `PORT=18747 BASE_PATH=/ pnpm --filter @workspace/rayalgo build`
- `PORT=18747 BASE_PATH=/ pnpm --filter @workspace/rayalgo bundle:audit`
- `pnpm --filter @workspace/rayalgo test:unit`
- Focused backend/API tests when backend is touched.
- Focused Playwright tests for changed screens.
- Desktop/mobile screenshots for visual phases.
- System reduced-motion verification for animation phases.
- `git diff --check`

Additional validation guidance:

- When backend endpoints change, run focused API tests plus generated client validation.
- When chart behavior changes, rerun Market and Trade chart hydration/panning tests.
- When flow source logic changes, verify IBKR-vs-Polygon source metadata and line budget behavior.
- When UI motion changes, verify `prefers-reduced-motion`.
- When mobile layout changes, capture Market, Flow, Trade, and Account screenshots.

## Final Completion Criteria

- App runs in dev without overlay blockers.
- All nine screens remain navigable.
- Linked workspaces, scanner coverage, dense chart frames, Market calendar foundation, earnings markers, and useful lightweight loading/live-state animations are implemented and tested.
- Bundle/performance guardrails are respected.
- Existing dirty worktree changes are preserved.
- Final handoff documents implemented phases, skipped/deferred items, test results, and residual risks.
