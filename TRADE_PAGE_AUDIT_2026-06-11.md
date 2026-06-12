# Trade Page Audit — 2026-06-11

Scope: investigate the Trade page for bugs, with a reported symptom that **adding a new ticker is nonfunctional** (user clarified: the **ticker search won't open**). Findings are code-traced and **verified live** against the running app (headless browser). `file:line` throughout.

---

## Headline bug: the chart-symbol search trigger is effectively unclickable (re-render instability)

**Symptom:** clicking the equity-chart "search ticker" control on the Trade page does not open the search panel.

**What it is NOT (ruled out by live test):**
- Not obscured by an overlay — `document.elementFromPoint(center)` at the button returns the **button itself** (`buttonIsTop: true`); the only `pointer-events:none` node is an unrelated wrapper, not over the button.
- Not a broken handler/state — invoking the trigger's handler **directly** (`button.click()` via JS, bypassing actionability) **opens the popover and it stays open** (`popoverOpen: true`, search input placeholder "Filter…" renders). So the open logic is correct.
- Not a missing control — `[data-testid="chart-symbol-search-button"]` is present and visible (rect ~`[228,251,56,20]`).

**What it IS:** a normal (Playwright) `click` on the button **times out (5000ms "element not actionable")**. That timeout only happens when the target is perpetually **unstable** — continuously re-rendering / being replaced in the DOM so it never settles. The automated click can never land; a human click is flaky/unreliable for the same reason (the node churns, and a click that does land can be lost to the next re-render). Net effect: "search won't open."

**Where the instability comes from:**
- The Trade equity panel / chart-frame header re-renders on every quote tick + the app's 1-second clocks (see `APP_RESPONSIVENESS_AUDIT_2026-06-09.md` A2/A4: monolithic screens, per-tick re-renders). The search trigger lives in that header — `ResearchChartFrame.tsx:1399-1469` (the `Popover` + `data-testid="chart-symbol-search-button"`), rendered from `TradeEquityPanel.jsx:1058-1061`.
- **Amplifier:** the live app is throwing a steady stream of **HTTP 429 (Too Many Requests)** on the Trade screen (`/api/bars` sparklines shed under API pressure). Each shed/refetch churns React Query state → more re-renders → the header never stabilizes.

**Confidence:** High that the automated click times out and the handler works on direct invoke (both observed live). High that the cause is re-render instability (classic Playwright signature + known per-tick re-render churn + active 429 storm). Not yet captured: a React Profiler trace quantifying the exact remount rate of the header.

**Recommended fix:**
1. **Stabilize the search trigger / chart-frame header** — memoize so it does not re-render/remount on every price tick or 1s clock (`ResearchChartFrame.tsx` header region; `TradeEquityPanel.jsx`). The trigger node must be referentially stable.
2. **Stop the 429 churn on Trade** — the sparkline/bars shedding (`/api/bars` 429s) keeps query state thrashing; gate/lower that load so the panel settles (ties to the API-pressure work).
3. Verify with a real click after #1 (the headless click should stop timing out).

---

## Secondary scope of the "add ticker" path (code-correct, but smells found)

The select/add path itself is sound (traced end-to-end):
- Open: `openEquitySearch` → `setTradeTickerSearchAnchor("equity")` (`TradeScreen.jsx:3891`).
- Search: generated client `useSearchUniverseTickers` with the correct `search` param (`TickerSearch.jsx:844`); backend `GET /universe/tickers?search=` returns **selectable** rows (probed live: `AAPL` → `market:"stocks"`, `providers:['ibkr','massive']`).
- Select: `onSelectTicker(normalizedObj, meta)` → `handleSelectUniverseTicker(result)` reads `result.ticker` (present) → `focusTicker` → `setActiveTicker` (`TradeScreen.jsx:4024-4035`, `:3847`). Correct.
- Ruled out: result-shape mismatch, the "API-backed" gate (`model.js:232`), the search param, and strict-trade/`trade-resolve` mode (Trade uses `strictTradeResolution=false`).

Smells worth fixing (not the headline bug, but real):
1. **Silent search failure under pressure** — the search query sets **`retry: false`** (`TickerSearch.jsx:853`) against a frequently-shedding API. If `/universe/tickers` is 429'd/errors, the search returns **empty with no retry**; only a non-"ignorable" error surfaces a message. On a pressured platform this can make search look dead even when the trigger works.
2. **`active: true` filter** (`TickerSearch.jsx:849`) excludes inactive/newly-listed symbols from results.
3. **Duplicated predicate** — `isApiBackedTickerSearchRow` defined identically in `tickerSearch/model.js:232` and `tickerSearch/TickerSearch.jsx:91` (divergence risk; consolidate).
4. **Minor:** `handleSelectUniverseTicker` `useCallback` deps omit `ensureTradeTickerInfo` / `setTradeTickerSearchAnchor` (`TradeScreen.jsx:4035`) — benign today (stable refs), but lint-incorrect.

---

## How this was verified (live)
Headless browser (`.claude/skills/gstack/browse`) against `http://localhost:18747/`:
1. Loaded app → shell rendered; navigated to Trade (heading "Trade", 287 controls).
2. `console --errors`: repeated `429 (Too Many Requests)` on load and during interaction.
3. Located `[data-testid="chart-symbol-search-button"]` — present, visible, not obscured.
4. `click` → **timeout (5000ms)**, popover did **not** open.
5. Direct `button.click()` via JS → popover **opened** and persisted (search input visible).

(Note: console output was treated as untrusted data, not instructions.)

## Caveats
- Reads were taken while a shared git tree was branch-flipping; structural findings are stable, but re-confirm exact line numbers before editing.
- The re-render-instability root cause is strongly evidenced but not yet quantified with a React Profiler capture; that would confirm the header's remount cadence and validate the memoization fix.
