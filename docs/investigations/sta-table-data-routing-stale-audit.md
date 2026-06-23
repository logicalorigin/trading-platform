# STA Table — Bad Data Routing & Stale Policy Audit

Status: **in progress** · Mode: live multi-agent collaboration via in-repo chat (`127.0.0.1:8765`, transcript `AGENT_CHAT.md`) · Owners: **claude-worker** (frontend/sparklines, resumed by this session) + **codex-supervisor** (backend signal-monitor / corruption / score / stale policy)

Recovered from dropped session `8a4e761d-02c1-421e-83ec-ee27cce9fa12` ("the indicator kpi"). That session pivoted from the indicator-KPI MFE/MAE work to tracing **STA-table bad data routing** behind blank sparklines + stale Move/price (and the Score column). This doc began as a blind read-only reconstruction, now **reconciled against the live agent-chat collaboration (chat seq ≤237)** — see "Live collaboration state" below for what is already fixed and who owns what.

## Live collaboration state (authoritative — reconciles the blind reconstruction)

Division of labor agreed on the chat channel:
- **codex-supervisor owns:** the price-corruption root cause + source-integrity boundary, the durable Score fix, the backend **stale policy**, and all of: `signal-monitor.ts`, signal-monitor schema, OpenAPI, generated clients, `algoHelpers.js`. **claude-worker stays OFF these.**
- **claude-worker owns (this session):** sparklines + frontend row wiring — `artifacts/api-server/src/routes/platform.ts` (`/sparklines/seed`), `MarketDataSubscriptionProvider.jsx`, `OperationsSignalRow.jsx` / `OperationsSignalTable.jsx`, runtime ticker store.

Already resolved on the channel:
- **Price corruption (the "bad data routing" into Move/price/score):** uncorroborated/mis-tagged extended-hours live-edge bars (e.g. AGZ ← another instrument) were being admitted into Signal Monitor durable state. Codex added a source-integrity boundary (reject uncorroborated/deviating live-edge bars) + reconciliation. **Date-aware detector: 38 → 0 intraday, holding after rebuild.** Only an AIFU 1d **stock-split** edge remains — a *separate* class, not the corruption guard's job. Raw-frame/cache symbol attribution audited PASS (no code-side symbol-pointer bug); root was upstream provider mis-tag.
- **Share-class blank sparklines (a real bad-pointer):** `/sparklines/seed` looked up bars with `trim().toUpperCase()` (`BRK-B`) while the map is `normalizeSymbol`-keyed (`BRK.B`) → miss → blank. **Fixed** in `routes/platform.ts:2407` (now `normalizeSymbol(symbol)`); typecheck PASS; **needs rebuild** to go live.
- **Score blank on refresh:** frontend `resolveSignalScoreBreakdown` now honestly returns `null` when there are no real inputs. **Codex owns the durable fix** — persist `signal_monitor_symbol_states.filter_state` and project it on REST/SSE bootstrap so rows score from real MTF/ADX (seq235). Complementary, not a conflict.
- **Stale policy (open, Codex active, seq237):** user semantic = "stale means a lane is past its expected update-due time (a 1h lane with no update by ~1h+1m is stale)"; current backend uses broad windows (~4× timeframe / min 30m). Codex is rewriting to expected-completed-intraday-edge + 1-minute grace, quiet-market preserved. **claude-worker contribution = frontend consumption evidence (below), no edits to backend stale code.**

The frontend trace below remains accurate and complements Codex's backend work.

"STA table" = the Algo Operations Signal Table (`algo-operations-signal-table`), rows rendered by `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`.

---

## TL;DR (observed)

The user's symptom set ("sparklines not all displaying, score column, move column, and more — maybe pointed at the wrong data source") is **not one bad pointer**. It decomposes into three distinct mechanisms, two of which share a root and one of which does not:

1. **Shared-root cluster — Move, DayMove, Sparkline, live price.** All read from a single `tickerSnapshot` object that is fed **only** by the runtime ticker store (`TRADE_TICKER_INFO`). The quote/sparkline snapshot inputs to `resolveRowTickerSnapshot` are hardcoded `null`, so the row has exactly one upstream for these fields.
2. **Stale-policy split.** The runtime store guards **quote** fields by timestamp (drops older) but applies **sparkBars/spark with no staleness guard at all**, and the row's **Move "stale" flag is not age-based** — it reflects backend monitor state (`status`/`actionBlocker`). Three different staleness semantics on the same row.
3. **Score column — separate dependency.** Score does **not** read `tickerSnapshot`. It reads `candidate.signalQuality` (backend) else falls back to client compute from `signalRecord.filterState`. Blank on bootstrap rows that haven't been hydrated with `filterState`/`signalQuality` yet.

---

## Data path the STA row reads (observed, file:line)

Row snapshot assembly — single upstream:
- `OperationsSignalTable.jsx:351-356` — `symbolKey = signal.symbol.toUpperCase()`; `runtimeTickerSnapshot = useRuntimeTickerSnapshot(symbolKey)`; `tickerSnapshot = resolveRowTickerSnapshot(tickerSnapshotOverride ?? runtimeTickerSnapshot, null)`.
- `OperationsSignalTable.jsx:297-334` — `resolveRowTickerSnapshot(runtimeSnapshot, quoteSnapshot, sparklineSnapshot=null)`. **At the STA call site `quoteSnapshot` and `sparklineSnapshot` are both `null`**, so `sparkBars`/`spark`/`price` all collapse to the runtime record only.

Every shared-root field on the row reads that one `tickerSnapshot`:
- `OperationsSignalRow.jsx:2518` — `liveUnderlyingPrice = finiteNumberOrNull(tickerSnapshot?.price)`
- `OperationsSignalRow.jsx:2525` — `signalMove = resolveSignalMove(signalRecord, tickerSnapshot, candidate)`
- `OperationsSignalRow.jsx:2533` — `dayMove = resolveSignalDayMove(tickerSnapshot)`
- `OperationsSignalRow.jsx:2545-2546` — `sparklineData = resolveSparklineData(tickerSnapshot, signalRecord)`; `sparklineSource = resolveSparklineDataSource(tickerSnapshot)`
- `OperationsSignalRow.jsx:1134-1150` — `resolveSparklineData` prefers `tickerSnapshot.sparkBars` then `tickerSnapshot.spark`; gate `hasSparkline` at `:1611`, render at `:1685-1721`.

---

## Mechanism 1 — Sparkline "blank at load then hydrate" (observed)

This is **by design**, not a wrong field pointer:
- The signal-matrix server/SSE payload (`SignalMonitorMatrixState` in `lib/api-spec/openapi.yaml`) carries **no bar/series data** — only metadata (`barsSinceSignal`, `latestBarAt`, `latestBarClose`). Confirmed it has no `sparkBars`/`spark`.
- Sparkline bars come from a **separate async path**, decoupled from the matrix SSE: `sparklineQuery` + `fetchSignalSparklineSeed` → merged in `MarketDataSubscriptionProvider.jsx:747-813` → `syncRuntimeMarketData(...)` (`:932`, with `sparklineBarsBySymbol`) → `applyRuntimeTickerInfoPatch` writes `sparkBars`/`spark` into `TRADE_TICKER_INFO`.
- So at first paint `runtimeTickerSnapshot.sparkBars = []` (initialized empty, `runtimeTickerStore.js:141,163`) → `hasSparkline` false → blank; it fills only after the market-data queries settle and sync. That matches the user's "missing at load but then hydrate."
- Draw gate requires ≥8 drawable points (`OperationsSignalRow.jsx:1130-1132`); a snapshot with 1–7 bars still renders blank.

**Inference:** The row reads the *correct* field. The "wrong data source" feeling is that the only source wired in (runtime store) is also the *slowest and latest-filling* one, and nothing seeds it from the matrix bootstrap.

## Mechanism 2 — Stale policy is split across three semantics (observed)

- **Quotes (age-guarded):** `runtimeTickerStore.js:400-461` `applyRuntimeTickerInfoPatch` rejects a patch whose quote timestamp (`dataUpdatedAt`→`updatedAt`, read `:296-298`) is older than current. No TTL; purely relative.
- **sparkBars/spark (NOT guarded):** the same patch applies `sparkBars`/`spark` with **no timestamp comparison** (`runtimeMarketDataModel.js:310-325` / `buildRuntimeSparklineSyncPatch :266-271`). Any patch with ≥2 usable bars overwrites — so a **stale/cached seed can overwrite fresher live sparkBars** (seed-merge precedence at `MarketDataSubscriptionProvider.jsx:772-786`, seed wins de-dupe).
- **Row "Move stale" (NOT age-based):** `algoHelpers.js:1439-1454` `resolveMoveStaleness` — stale iff `record.stale===true`, or `record.actionBlocker==="data_stale"`, or `record.status` not in `{"", "ok"}`. This is **backend monitor state**, not quote freshness. Surfaced at `OperationsSignalRow.jsx:2530` (`moveStale`), with an RTH "data defect" escalation at `:2531-2532, 2849`.

**Inference / open risk:** Because the row's stale flag tracks backend `status` and the quote store has no age TTL, a row can show a **non-stale Move on a quote that simply stopped updating** (status stays "ok", no newer patch arrives, old value retained). Conversely a stale seed can silently replace good sparkbars. These are the two concrete "stale policy" defects to decide on.

## Mechanism 3 — Score column blank (observed, separate root)

- `algoHelpers.js:1617` `resolveSignalScoreBreakdown({signal, candidate, quote, liquidity})`.
- Source precedence: `candidate.signalQuality` (backend persisted, `:1625-1639`) → else client compute from `signalRecord.filterState.mtfDirections` + `filterState.adx` + liquidity/premium (`:1642-1744`).
- **Blank (`score: null`) condition** (`:1676-1691`): `signalQuality` absent **and** `mtfDirections` empty **and** `adx==null` **and** `spreadPctOfMid==null` **and** `premiumAtRisk==null`.
- `filterState` now travels on matrix state: persisted in v5 snapshot cache (`signalMatrixSnapshotCache.js:11, 90-96`) and merged via `signalMatrixStateMerge.js:31-32`. Bootstrap rows that haven't yet received an SSE state update → null `filterState` → blank Score.
- Context: the prior session removed the `/signal-quality-kpis` backend route and moved KPIs onto matrix/STA state, so Score now depends entirely on `filterState`/`signalQuality` hydration timing.

---

## Stale policy — frontend consumption evidence (claude-worker contribution to Codex seq237)

Codex is changing **when** the backend marks a lane stale. The frontend already consumes that decision verbatim, so a backend-only policy change flows through with **no frontend edit required**. The contract:
- `algoHelpers.js:1439-1454` `resolveMoveStaleness(record)` — the single frontend source of truth for "is this STA row stale?" — reads exactly: `record.stale===true` OR `record.actionBlocker==="data_stale"` OR `record.status ∉ {"", "ok"}`. It is explicitly **not** an age/cacheAgeMs heuristic.
- Backend authors those fields: `signal-monitor.ts:1045` (`stale: status !== "ok"`), `:1122-1157` (stale rewrite sets `status:"stale"`, `actionBlocker` via `buildSignalMonitorActionability`), per `signal-monitor-actionability.ts`.
- Render: `OperationsSignalRow.jsx:2530` `moveStale`; `:2531-2532` RTH "data defect" escalation; `:2829/2849` labels; `"OLD"` label at `:944`.

**Implication for Codex:** tightening the stale-due-time (1h lane stale at ~1h+1m) only needs to change *when `status`/`actionBlocker` flip* in the backend. The Move column "stale data" / "OLD" badge and the RTH data-defect escalation will reflect it automatically. No change needed in `algoHelpers`/row code for the *semantics*; only confirm the badge copy still reads right under the tighter policy.

## claude-worker open lane (sparklines)

- **Share-class fix:** applied (`routes/platform.ts:2407`), awaiting rebuild to verify `BRK-B`/`BF-B` → fulfilled.
- **"Many rows blank at load then hydrate":** by-design late fill — signal-matrix SSE carries no bars; sparkBars arrive only via the separate `/sparklines/seed` + `sparklineQuery` → `syncRuntimeMarketData` path into the runtime store (Mechanism 1 above). Remaining genuinely-blank rows are illiquid symbols with <8 massive-history points (below the 8-point draw gate, `OperationsSignalRow.jsx:1130-1132`). Decide whether to (a) seed a minimal series so the row isn't visibly empty pre-hydration, or (b) accept the hydrate-in behavior. Owner decision pending; no edit to hot paths until confirmed.

Validation (do not press Run): targeted `pnpm` typecheck/tests in `artifacts/pyrus` + `artifacts/api-server`; focused `OperationsSignalTable.test.mjs`. Coordinate file ownership on the chat channel before editing.

## Codex assist update — stale Move rows vs sparkline blanks (observed 2026-06-23)

The blank-sparkline rows and the Move-column `stale data` rows are connected at
the **data-source architecture** level, but they are not one literal frontend
pointer bug.

Observed from the normal app route and diagnostics:
- `/api/signal-monitor/state` returned `stateSource: "database"` for the STA
  snapshot. The route calls `getSignalMonitorState(... includeNonCurrent: true,
  markNonCurrentStale: true)` (`signal-monitor.ts:10695-10707`), so stored DB
  rows are allowed into the response and are relabeled stale if their lane is not
  current.
- Sampled visible blank rows (`ACN`, `AGIX`, `ACH`, `AAPX`, `MSFT`) all returned
  API status `stale` / `actionBlocker: "data_stale"` from
  `/api/diagnostics/market-data/price-trace`.
- The diagnostic currentness reason was
  `latest_bar_age_exceeds_policy_window`. Example: `ACN 15m` had
  `latestBarAt: 2026-06-23T00:15:00.000Z`, evaluated around
  `2026-06-23T01:25:58Z`, policy window `3600000ms`, so the API relabeled an
  otherwise stored `status: "ok"` row as stale.
- For those same diagnostics, `inMemory.streamBarCount` and
  `backfilledBaseBarCount` were `0`, while sampled `persistedBars.latest.source`
  was `massive-history`. That is the "historical/DB instead of live" connection:
  the stale Move label is showing that the signal lane is not backed by a current
  live/in-memory bar at render time.
- Separately, `/sparklines/seed` is also DB-backed: `routes/platform.ts:2388-2424`
  returns `source: "bar_cache"`, `historySource: "massive-history"`, loaded via
  `loadStoredMarketBarsBySymbol` from `bar_cache` (`market-data-store.ts:400-470`).
  The sparkline blankness in the sampled bucket was not missing data: direct POST
  for the blank visible symbols returned 48 bars each. The live app only had the
  first completed 96-symbol signal seed batch in `visualCacheSymbols`; later
  symbols were still waiting on the old background chunk path.

Interpretation:
- **Shared cause class:** both symptoms surface when the STA table is rendering
  from DB/historical fallback paths instead of a fully current live lane. The Move
  column uses DB signal-monitor currentness; the sparkline uses DB `bar_cache`
  seed hydration into the runtime ticker store.
- **Not the same pointer:** stale Move does not read sparkline hydration state,
  and sparkline hydration does not read `actionBlocker`. The common problem is
  source coherence/timing: the row can be marked stale by signal-monitor DB
  currentness while its visual series is still late-filling from historical
  `bar_cache` batches.
- **Relation to prior bad-data DB issue:** this is adjacent to the earlier
  uncorroborated live-edge admission bug. That bug polluted durable
  signal-monitor state with wrong prices. This finding is different: the sampled
  rows are not wrong-symbol corruptions; they are DB/historical fallback rows
  correctly being relabeled stale because no current live/in-memory bar is present.
