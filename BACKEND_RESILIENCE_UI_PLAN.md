# Implementation Plan: Red "!" markers for backend backoffs / timeouts / fallbacks / loadsheds

> **Retired 2026-07-12:** `ResilienceMarker` had no production consumers, and
> Account contracts explicitly reject resilience-marker wiring. The component
> was removed by user decision; references below are historical and must not be
> treated as implementation requirements.

Companion to `BACKEND_RESILIENCE_CATALOGUE.md` (the ~140-instance catalogue + backend→widget mapping). This is the task breakdown.

## Overview

Surface every backend resilience event (backoff, timeout, fallback, loadshed, + the "left-out" categories: circuit-breaker, health-gate, reconnect, error-swallow, stale-cache, skip-guard, kill-switch, shutdown) as a **per-widget red "!"** in the `pyrus` frontend, so degradations are easy to find. Scope is locked to **all tiers, per-widget**.

The work is **mostly wiring, not building**: the backend already emits structured signals (`degraded`/`stale`/`reason`/`fallbackUsed`/error codes/pressure state) and the frontend already has the marker primitive (`DataIssueInlineIcon` → red `AlertTriangle` + tooltip) and a generic collector (`collectDataIssuesFromRecord`). Genuinely new code is limited to: (a) widgets whose payloads don't yet carry the signal fields, (b) "no-widget" items routed to Diagnostics, (c) silent error-swallow sites that emit nothing today.

## Architecture Decisions

1. **Dedicated red "!" marker (DECIDED Q1: literal exclamation, not AlertTriangle).** Add one small `ResilienceMarker` component that renders a literal red exclamation (`CircleAlert` from lucide, red) + the existing tooltip body (`FailurePointContent`), so resilience markers are visually distinct from the existing AlertTriangle failure icons. It still consumes the same `DataIssue` objects from `collectDataIssuesFromRecord` — only the glyph differs. Built once in Phase 0 (Task 0.3), reused everywhere.
2. **Reuse the collector.** Each widget feeds its backend record into `collectDataIssuesFromRecord` (or `collectQuoteDataIssues` / `collectChartSourceDataIssues` / `collectCoverageDataIssues`) from `features/platform/dataIssueModel.js`. It already maps `degraded/stale/fallbackUsed/unavailableCode/reason` and suppresses market-closed "quiet" noise.
3. **Signal transport priority:** (1) fields already on the widget's query payload → pure frontend wiring; (2) fields the backend computes but doesn't serialize → add to the response shape (surgical backend edit); (3) signals with no request/response home (pressure, shutdown, error-swallow) → expose via the existing diagnostics endpoint and render on `DiagnosticsScreen`, not a trading widget.
4. **No-widget items go to Diagnostics, not trading panels.** Graceful shutdown, sweep concurrency, ingest retries, SSE coalesce/heartbeat internals get a "resilience activity" section on `DiagnosticsScreen`. A trading-card "!" for an internal coalesce timer would be noise.
5. **Severity convention (DECIDED Q2): amber for self-healing, red for hard.** User-facing data degradations (stale/degraded/fallback/timeout served to a widget) → red `!`. Transient self-healing pressure (reconnecting, brief DB backoff, lane queue blip) → amber `!`. The `ResilienceMarker` takes a `severity` and picks red vs amber; the collector's `warning`/`attention` normalization drives it.
6. **No-widget items attach to nearest widget (DECIDED Q3): no Diagnostics-only dumping.** Every signal maps to the nearest visible surface (see Phase 3 nearest-widget table); the global/app-level ones (shutdown) attach to the existing header `ConnectionStatusPill`.
7. **Error-swallow: instrument only failure-hiding catches (DECIDED Q4), skip intentional best-effort no-ops.** Skip `tickle()` keepalive swallow (best-effort; connection state already tracked elsewhere). Instrument the ones hiding real failures: shadow-account polling catch, ibkr-connection-audit probe catches. (Phase 4.)
8. **Each task is a vertical slice:** backend field present → collector wired → marker rendered on the specific widget → typecheck + manual verify. One widget per task.

## Verification commands (used throughout)
- Frontend typecheck: `pnpm -C artifacts/pyrus run typecheck`
- Backend typecheck: `pnpm -C artifacts/api-server run typecheck`
- Targeted tests: the touched `*.test.ts` / `*.test.mjs` via the package's test runner (e.g. existing `platform-option-degraded-reasons.test.ts`, `live-streams.test.mjs`).
- Manual UI: `/qa` or `/browse` the affected screen and force the degradation (see each task's manual check).

---

## Task List

### Phase 0 — Foundation (de-risk before wiring)

#### Task 0.1: Payload-field gap audit
**Description:** For every widget in the §8 mapping, confirm whether its query/stream payload already carries the resilience fields (`degraded`/`stale`/`reason`/`fallbackUsed`/`backoffRemainingMs`/coverage) the collector consumes, or whether a backend response change is required. Produce a definitive per-widget "fields present? Y/N + which backend file to edit" table appended to the catalogue.
**Acceptance criteria:**
- [ ] Each Phase 1–2 widget marked "frontend-only" or "needs backend field X in file Y".
- [ ] No widget left as "unknown".
**Verification:**
- [ ] Table reviewed against actual route/service response builders (grep the serializer for each field).
**Dependencies:** None.
**Files likely touched:** `BACKEND_RESILIENCE_CATALOGUE.md` (doc only).
**Scope:** S.

#### Task 0.2: Shared widget-issue wrapper + reason dictionary
**Description:** Add a thin `features/platform/resilienceIssues.js` wrapper (`collectWidgetIssues(record, { label, source })` delegating to `collectDataIssuesFromRecord`) and a `reason → human text` dictionary covering the catalogue's reason codes (`orders_backoff`, `orders_cached_stale`, `options_backoff`, `option_chart_stale_fallback`, `open_orders_timeout`, `write_backpressure_timeout`, lane codes, etc.) so tooltips read in plain language. Only add if 0.1 shows ≥3 widgets need the same glue; otherwise skip and use the collector directly.
**Acceptance criteria:**
- [ ] Reason dictionary maps every reason code surfaced in Phases 1–2.
- [ ] Wrapper has a unit test covering stale/degraded/fallback/backoff inputs.
**Verification:**
- [ ] `pnpm -C artifacts/pyrus run typecheck`; new unit test passes.
**Dependencies:** 0.1.
**Files likely touched:** `artifacts/pyrus/src/features/platform/resilienceIssues.js` (+ test).
**Scope:** S.

#### Task 0.3: `ResilienceMarker` component (literal red/amber "!")
**Description:** Build the single dedicated marker: a literal exclamation (`CircleAlert`, red for `warning` / amber for `attention`) wrapping the existing `FailurePointContent` tooltip body. API: `<ResilienceMarker issues={DataIssue[]} side align size />` — summarizes "primary + X more" like `DataIssueInlineIcon` but with the distinct exclamation glyph and the amber/red split. This is the one new UI primitive; every widget task reuses it.
**Acceptance criteria:**
- [ ] Renders red "!" for a `warning` issue, amber "!" for `attention`, nothing for empty issues.
- [ ] Tooltip shows reason/summary/source from the `DataIssue`.
- [ ] Visually distinct from existing `AlertTriangle` failure icons.
**Verification:**
- [ ] `pnpm -C artifacts/pyrus run typecheck`; render test (red vs amber vs none).
**Dependencies:** None (parallel with 0.1).
**Files likely touched:** `artifacts/pyrus/src/components/platform/ResilienceMarker.jsx` (+ test).
**Scope:** S.

#### Checkpoint: Foundation — ✅ DONE (awaiting human review before Phase 1)
- [x] Gap audit complete; every Phase 1–2 widget has a known transport path → catalogue §9.
- [x] `ResilienceMarker` built (`components/platform/ResilienceMarker.jsx`) — literal red/amber `CircleAlert`, distinct from AlertTriangle.
- [x] `resilienceIssues.js` helper + reason dictionary + 7 passing `node:test` unit tests.
- [x] `pnpm -C artifacts/pyrus run typecheck` clean (0 errors). **Review with human before wiring widgets.**

> Audit reshaped the split: 4 already-wired, 3 frontend-only (orders, equity, intraday-PnL), 8 backend-add. New **Decision D1** (option-chain degraded: body vs headers) needed before Task 1.3.

---

### Phase 1 — Tier 1, user-facing degradation (highest value)

> All Phase 1–3 widget tasks render the **`ResilienceMarker`** (Task 0.3), not `DataIssueInlineIcon`. Where a widget already shows `DataIssueInlineIcon` for other reasons, the resilience marker is added alongside it (distinct glyph) unless the existing icon already covers the resilience reason.

> **PROGRESS (frontend-only wins landed):** ✅ Orders (`TradesOrdersPanel.jsx`), ✅ Equity curve (`EquityCurvePanel.jsx`), ✅ Intraday P&L (`IntradayPnlPanel.jsx`), ✅ Risk coverage (`RiskDashboardPanel.jsx` — skipped greek positions, data already on `greekScenarios.coverage`). All marker-wired from fields already on the payload; `pnpm -C artifacts/pyrus typecheck` clean, account + resilience tests pass. Smoke: app serves + mounts clean, no console errors; full Account-panel visual verify blocked by browse-daemon instability + broken screenshots in this sandbox.
> **AUDIT CORRECTION:** Risk is **frontend-only**, not backend-add — `resolveAccountGreekScenarios` already returns `coverage.{skippedPositions,skipped.*}` and the response ships `greekScenarios` (freeform JsonObject), so no codegen. Backend-add count drops 8 → 7.
> **TRANSPORT REALITY (investigated each remaining item):**
> - **CODEGEN-BLOCKED (REST contract, orval):** positions, allocation, cash, option-chain body. These add fields to orval-generated response schemas (`AccountPositionsResponse`, `GetOptionChainResponse`, etc.). Regen is **not reproducible in this sandbox** — a no-op `orval` run rewrote 545 generated files (version drift + the wrapper's `fix-api-zod-index`/copy post-processing that the hot-runtime guard blocks). Must be done on a dev machine where `pnpm -C lib/api-spec codegen` runs clean, then populate the service + wire the widget.
> - **STREAM-BASED (bypass orval, but need runtime verification):** quote-stream reconnect (`QuoteStreamPayload` is hand-typed `{quotes}` — would need a backend SSE-payload change to add `pressure`/reconnect), broker-stream staleness (exported hook `useBrokerStreamFreshnessSnapshot` already exists + `streamFreshness.test.ts`, but redundant with the orders `stale` marker already shipped, and the `accountFresh` flag false-positives on startup unless guarded). These touch the **live quote/account feed** and can't be runtime-verified here (browse daemon unstable in this sandbox), so deferred to avoid shipping false-positive markers on a live trading UI.
> - **LEAVE AS-IS (per Decision Q1):** flow scanner, quote header, bars/chart already show `DataIssueInlineIcon` for their degradation. Q1 wanted the new marker to *stand out from* existing icons, so these are intentionally not swapped.
>
> Net: the 4 shipped widget markers are the complete safely-verifiable set for this environment. Remaining work needs a codegen-capable + browser-testable dev machine.

#### Task 1.1: Orders panel "!" (Account → TradesOrdersPanel)
**Description:** Surface `orders_backoff` / `orders_cached_stale` / degraded-orders on the orders panel. Backend already emits `{degraded, stale, reason, backoffRemainingMs}` on the orders payload (`platform.ts:2865+`). Wire the record through `collectWidgetIssues` and render `DataIssueInlineIcon` on the panel header/affected rows.
**Acceptance criteria:**
- [ ] When orders are served stale/degraded, a red "!" with the reason tooltip shows on the orders panel.
- [ ] No "!" when orders are live.
**Verification:**
- [ ] `pnpm -C artifacts/pyrus run typecheck`.
- [ ] Manual: force `orders_backoff` (bridge backoff / mock) and confirm marker + tooltip.
**Dependencies:** 0.1 (0.2 if created).
**Files likely touched:** `artifacts/pyrus/src/screens/account/TradesOrdersPanel.jsx`; possibly `artifacts/api-server/src/.../orders` serializer if 0.1 flags a missing field.
**Scope:** S.

#### Task 1.2: Quote/positions fallback "!" (Trade quote header + Account PositionsPanel)
**Description:** Surface quote-snapshot fallback / stale quotes (`tws-provider.ts:5053`, quote payload `freshness`/`fallbackUsed`). PositionsPanel already imports `DataIssueInlineIcon`; verify it consumes quote-fallback reasons and extend the quote header on TradeScreen using `collectQuoteDataIssues`.
**Acceptance criteria:**
- [ ] Stale/fallback/delayed quote → "!" on quote header and position rows.
- [ ] Existing PositionsPanel marker covers the account-backoff reasons.
**Verification:**
- [ ] Typecheck; manual with a delayed/fallback quote.
**Dependencies:** 0.1.
**Files likely touched:** `screens/TradeScreen.jsx`, `screens/account/PositionsPanel.jsx`.
**Scope:** M.

#### Task 1.3: Option chain reason completeness (Trade → Option chain)
**Description:** Option chain already shows `DataIssueInlineIcon` (TradeScreen:354/362). Confirm ALL option degraded reasons are mapped: `options_backoff`, `option_chart_stale_fallback`, empty-retry exhaustion, metadata-only. Close any gaps against `platform-option-degraded-reasons.test.ts`.
**Acceptance criteria:**
- [ ] Each option reason code renders a marker; verified against the existing test's reason list.
**Verification:**
- [ ] Run `platform-option-degraded-reasons.test.ts`; typecheck; manual on an in-backoff symbol.
**Dependencies:** 0.1.
**Files likely touched:** `screens/TradeScreen.jsx`; maybe `services/platform.ts` if a reason isn't serialized.
**Scope:** S.

#### Task 1.4: Flow scanner failover "!" (Flow → Scanner/Distribution)
**Description:** Surface `fallbackUsed` / `FlowSourceStatus` (`flow-events-model.ts`) when flow falls back IBKR→Massive, and premium-distribution partial/timeout. FlowScreen already imports the icon; wire `flowSourceState`/`fallbackUsed` through the collector.
**Acceptance criteria:**
- [ ] Massive-fallback or partial distribution → "!" with "using fallback data" tooltip.
**Verification:**
- [ ] Typecheck; manual by forcing a massive fallback.
**Dependencies:** 0.1.
**Files likely touched:** `screens/FlowScreen.jsx`, `features/platform/flowSourceState.js`.
**Scope:** M.

#### Task 1.5: GEX degradation "!" (GEX → Dashboard)
**Description:** Surface GEX 504 timeouts and `unavailable` expirations (`gex-projection.ts:673`). GexScreen already uses FailurePoint; ensure the timeout path and per-expiration unavailability both render.
**Acceptance criteria:**
- [ ] GEX load timeout → "!"; unavailable expirations flagged.
**Verification:**
- [ ] Typecheck; manual with a slow/failed GEX load.
**Dependencies:** 0.1.
**Files likely touched:** `screens/GexScreen.jsx`.
**Scope:** S.

#### Task 1.6: Risk coverage "!" (Account → RiskDashboardPanel)
**Description:** Surface `skippedPositions` + `skipped.missing*` (`account-risk-model.ts:280`) using `collectCoverageDataIssues` — a "!" when risk is computed from partial position coverage.
**Acceptance criteria:**
- [ ] Skipped positions / missing greeks → "partial coverage" "!".
**Verification:**
- [ ] Typecheck; manual with a position missing greek/mark data.
**Dependencies:** 0.1; needs coverage fields on the risk payload (confirm in 0.1).
**Files likely touched:** `screens/account/RiskDashboardPanel.jsx`; possibly `services/account-risk-model.ts` serializer.
**Scope:** M.

#### Task 1.7: Bars/chart stale-fallback "!" (Trade/Market charts)
**Description:** Surface `option_chart_stale_fallback` / `allowStale` bars (`platform.ts:9074`, route:548) via `collectChartSourceDataIssues` on chart widgets.
**Acceptance criteria:**
- [ ] Stale/degraded bars → "!" on the chart.
**Verification:**
- [ ] Typecheck; manual with a stale bar fallback.
**Dependencies:** 0.1.
**Files likely touched:** chart components under `features/charting/`, `screens/TradeScreen.jsx`/`MarketScreen.jsx`.
**Scope:** M.

#### Checkpoint: Phase 1
- [ ] All Tier-1 widgets show "!" under their degradation, none under healthy state.
- [ ] `pnpm -C artifacts/pyrus run typecheck` + touched tests pass.
- [ ] `/qa` pass on Account, Trade, Flow, GEX screens. **Human review.**

---

### Phase 2 — Tier 2, operational pressure (amber, anti-cry-wolf)

#### Task 2.1: Account DB-backoff "!" (equity/PnL/allocation/cash panels)
**Description:** Surface transient PostgreSQL backoff windows (`account.ts`, `shadow-account.ts`, `watchlistDbBackoff` reason `list-stale-db-backoff`) as amber "!" on the affected account panels while the backoff is active.
**Acceptance criteria:** [ ] Active DB backoff → amber "!" with remaining-time tooltip; clears on recovery.
**Verification:** [ ] Typecheck; manual by triggering a DB backoff window.
**Dependencies:** 0.1; backoff state must be exposed on these payloads (confirm 0.1 — likely a backend add).
**Files likely touched:** `screens/account/*Panel.jsx`; `services/account.ts` / `shadow-account.ts` to serialize backoff state.
**Scope:** M.

#### Task 2.2: Reconnect-in-progress "!" (streaming quote/option widgets)
**Description:** Surface `reconnectScheduled`/`reconnectCount`/stall-reconnect on streaming widgets (`bridge-quote-stream.ts`, `massive-stock-websocket.ts`) as amber "reconnecting" "!".
**Acceptance criteria:** [ ] Stream reconnecting → amber "!"; clears when stream resumes.
**Verification:** [ ] Typecheck; manual by dropping a stream.
**Dependencies:** 0.1; reconnect state via stream-status payload (`features/platform/live-streams.ts`).
**Files likely touched:** `features/platform/live-streams.ts`, quote/option widgets.
**Scope:** M.

#### Task 2.3: Bridge pressure / lane shed "!" + footer tie-in
**Description:** Surface lane queue-full / backoff / shed (`work-scheduler.ts`, `bridge-governor.ts`, `market-data-admission` shed) where bridge data renders, and tie into the existing `FooterMemoryPressureIndicator` (already consumes `lineUsage.pressure.state`) so the footer also reflects lane pressure.
**Acceptance criteria:** [ ] Lane backoff/queue-full/shed → marker on dependent widgets + footer reflects pressure.
**Verification:** [ ] Typecheck; manual under induced bridge pressure.
**Dependencies:** 0.1.
**Files likely touched:** `features/platform/FooterMemoryPressureIndicator.jsx`, `features/platform/memoryPressureClient.js`, affected widgets.
**Scope:** M.

#### Checkpoint: Phase 2
- [ ] Operational pressure shows amber markers that clear on recovery (no stuck "!").
- [ ] Typecheck + tests pass. **Human review for cry-wolf tuning.**

---

### Phase 3 — Tier 3 + no-widget items → nearest visible widget (DECIDED Q3)

**Nearest-widget mapping** (each Tier-3 / "no-widget" signal attaches here):
| Signal | Nearest widget |
|---|---|
| SSE coalesce / heartbeat / backpressure (quote/option streams) | the streaming quote header / option-chain widget it feeds |
| `quoteEmitCoalesceMs` / `genericTickSampleMs` sampling active | quote header (amber, only if sustained) |
| Backtest sweep concurrency cap (`MAX_PARALLEL_SWEEP_RUNS`) | Algo/backtest results panel |
| Market-data ingest job retries (`market-data-ingest.ts`) | the affected symbol's freshness on its data widget |
| Graceful shutdown (api/bridge) | global header `ConnectionStatusPill` (app-level) |

#### Task 3.1: Streaming-internal signals → streaming widgets
**Description:** Attach coalesce/heartbeat/backpressure/sampling markers to the quote header and option-chain streaming widgets via the stream-status payload. Amber, and only when sustained (not every 20ms coalesce tick) to avoid flicker.
**Acceptance criteria:** [ ] Sustained SSE backpressure / sampling on a stream → amber "!" on that stream's widget; transient ticks do not flicker.
**Verification:** [ ] Typecheck; manual under induced backpressure; confirm no flicker at steady state.
**Dependencies:** 0.3, 2.2 (stream-status transport).
**Files likely touched:** `features/platform/live-streams.ts`, quote/option widgets.
**Scope:** M.

#### Task 3.2: Backtest + ingest signals → their widgets
**Description:** Attach sweep-concurrency cap (backtest results panel) and ingest-retry (affected data widget) markers. Add any missing fields to the backtest/ingest payloads.
**Acceptance criteria:** [ ] Sweep at concurrency cap → marker on backtest panel; ingest retrying → marker on the affected data widget.
**Verification:** [ ] Typecheck; manual by inducing a sweep batch / ingest retry.
**Dependencies:** 0.3.
**Files likely touched:** Algo/backtest panel, data widgets; `backtest-worker` / `market-data-ingest.ts` serializers if fields missing.
**Scope:** M.

#### Task 3.3: Shutdown signal → header ConnectionStatusPill
**Description:** Reflect graceful shutdown / drain on the existing header `ConnectionStatusPill` (it already has a `degraded`/`disconnected` variant) — the app-level "nearest widget."
**Acceptance criteria:** [ ] During shutdown/drain, the header pill shows the degraded state with reason.
**Verification:** [ ] Typecheck; manual by triggering `shutdownApi`.
**Dependencies:** 0.3.
**Files likely touched:** `components/ui/ConnectionStatusPill.jsx`, its status source.
**Scope:** S.

#### Checkpoint: Phase 3
- [ ] Every Tier-3 / no-widget catalogue row attaches to a real widget per the mapping, or is explicitly marked "internal, not surfaced" with rationale.
- [ ] No steady-state flicker. **Human review.**

---

### Phase 4 — Error-swallow instrumentation (DECIDED Q4: failure-hiding only)

**SKIPPED as intentional best-effort no-ops** (leave silent, document why):
- `ibkr-bridge/tws-provider.ts:2168,2243` `void tickle().catch(()=>{})` keepalive — best-effort; real connection state is already tracked by `connectionState`/`serverConnectivity` and surfaced via the broker-health gate. Instrumenting it would double-count and flicker.
> If 0.1/review finds any of these actually masks a user-visible failure, promote it back into scope — note it at the Phase-3 checkpoint.

#### Task 4.1: Instrument shadow-account polling-catch
**Description:** Add a record-only signal (failure counter + `lastError` + `lastErrorAt`) to the `shadow-account-streams.ts:134` warn-and-continue catch — this hides data staleness today. No control-flow change. Surface on the nearest account widget (per Q3).
**Acceptance criteria:** [ ] Polling failures counted + reach the account widget as an amber "!"; polling still continues.
**Verification:** [ ] `pnpm -C artifacts/api-server run typecheck`; targeted test that a thrown poll records the counter.
**Dependencies:** 0.3; an account widget marker from Phase 1/2.
**Files likely touched:** `artifacts/api-server/src/services/shadow-account-streams.ts`, account widget.
**Scope:** S.

#### Task 4.2: Instrument ibkr-connection-audit empty catches
**Description:** Replace empty `catch {}` at `ibkr-connection-audit.ts:280,332,428` with a recorded probe-failure signal (record-only). These hide probe failures during connection diagnosis. Surface on the broker-health / connection surface (nearest widget).
**Acceptance criteria:** [ ] Each previously-silent probe failure is recorded in the audit trail and reaches the connection-health surface.
**Verification:** [ ] Typecheck; existing audit tests pass + new assertion.
**Dependencies:** 0.3; 3.3 (ConnectionStatusPill surface).
**Files likely touched:** `artifacts/api-server/src/services/ibkr-connection-audit.ts`.
**Scope:** S.

#### Checkpoint: Complete
- [ ] Every catalogue instance is either surfaced on its nearest widget or explicitly classified "internal/intentional, not surfaced" with rationale.
- [ ] All typechecks + touched tests pass; `/qa` clean across screens.
- [ ] No stuck/false markers under healthy operation. Final human review.

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Signal not actually on a widget's payload → silent gaps | High | Task 0.1 gap audit before any wiring; mark each as frontend-only vs backend-add |
| Cry-wolf: transient Tier-2/3 blips flash "!" constantly | Med | Amber (attention) for self-healing states; collector already suppresses market-closed "quiet" reasons; tune thresholds at Phase-2 checkpoint |
| Marker clutter on dense panels | Med | `DataIssueInlineIcon` already summarizes "primary + X more"; one icon per widget header |
| Per-render cost of computing issues | Low | Memoize collector calls on payload identity |
| Error-swallow instrumentation changes timing/behavior | Med | Record-only; no control-flow change; unit test each |
| False positives off-hours | Med | Reuse existing `reasonLooksQuiet` market-closed suppression |

## Resolved Decisions
- **Q1 → Literal red `!`.** Dedicated `ResilienceMarker` (red/amber `CircleAlert`), distinct from existing AlertTriangle failure icons. (Task 0.3.)
- **Q2 → Amber for self-healing, red for hard.** Reconnect / brief backoff / lane blip = amber; stale/fallback/timeout served to user = red.
- **Q3 → Force onto nearest widget.** No Diagnostics-only dumping; Phase 3 nearest-widget mapping; shutdown → header `ConnectionStatusPill`.
- **Q4 → Failure-hiding catches only.** Skip intentional best-effort `tickle()` keepalive; instrument shadow-account polling + connection-audit probe catches.

## Remaining unknowns (resolved by Task 0.1, not blocking approval)
- Which exact widget payloads already carry the signal fields vs need a surgical backend add — the gap audit answers this per widget before any wiring.
