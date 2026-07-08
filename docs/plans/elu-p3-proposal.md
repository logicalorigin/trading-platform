# ELU P3 — DISCUSSION PROPOSAL (decision doc, no implementation authorized)

Date: 2026-07-08 · Author: agent (read-only pass over live tree + live CPU profiles)
Base plan: `docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md` (2026-07-02)
Evidence tier labels used throughout: **[observed]** = read from source/profile now · **[inferred]** = connected from observations · **[unknown]** = not verified.

---

## 1. Current-state verification (all read today, file:line)

### 1a. The two jsonb-payload targets of the original P3 are ALREADY FIXED on main

| Plan target | Status today | Evidence |
|---|---|---|
| `signal_monitor_events` list read parses jsonb `payload` per row | **CLOSED** — payload no longer selected at all | [observed] Projected 11-column select with no `payload`: `artifacts/api-server/src/services/signal-monitor.ts:14431-14444`; `eventToResponse` now takes a scalar `Pick<...>` with no payload field: `signal-monitor.ts:1494-1523`. Landed in commit `e8109c69` ("drop unused jsonb payload from events list response"). Plus a 5s TTL + single-flight cache on the rows read (`signal-monitor.ts:14310-14317`, TTL at `14287`), i.e. the plan's "orthogonal short-TTL cache" ALSO landed. |
| `execution_events` list read parses jsonb `payload` + runs `normalizeLegacyAlgoBranding` per row | **CLOSED** — scalar projection, payload opt-in | [observed] `readExecutionEventsUncached` selects 10 scalar columns and only adds `payload` when `includePayload`: `automation.ts:1252-1276`; `executionEventToResponse` runs `normalizeLegacyAlgoBranding` only on the opt-in path, default `payload: {}`: `automation.ts:779-800`. 2s TTL list cache: `automation.ts:96, 1324-1343`. Landed in commit `8e23dfbc` ("scalar-project execution_events feed, keep payload opt-in"). The consumer audit the plan demanded is reflected in the checked-in comment (`automation.ts:1245-1251`): the load-bearing payload consumer is the separate deployment-scoped cached path, not this list. |

So the question "does eventToResponse for execution_events still parse+transform payload via normalizeLegacyAlgoBranding?" — **No, not on the default feed** [observed]. It still does on the explicit `includePayload` detail path, which is the intended shape of plan option A.

### 1b. `signal_monitor_symbol_states` reads

- Still **full-row** (`db.select().from(signalMonitorSymbolStatesTable)`): `signal-monitor.ts:14380-14389` — the row includes one jsonb column, `filter_state` (`lib/db/src/schema/signal-monitor.ts:78`), plus `last_error text` and 7 numerics [observed].
- Now behind a **5s TTL + single-flight cache with write-invalidation** (`SIGNAL_MONITOR_STATE_ROWS_CACHE_TTL_MS = 5_000`, `signal-monitor.ts:14287-14295`, invalidation `14323-14362`) [observed]. The July-2 plan measured this read at 73k rows/45s; the cache + single-flight has since collapsed caller fan-in, so that row-volume number is stale [inferred — no fresh row attribution run].

### 1c. Other changes since the plan (2026-07-02 → today)

- `f2b8286f` — breadth hydration SQL-bucketed + route-cached (plan option D, partially landed) [observed in git log + commit stat].
- `d00ad0a5` — bar OHLCV read as float8 for native decode (precedent for cheap-decode projection work) [observed in git log].
- `/signal-monitor/state` route now has a **15s serialized-string cache + in-flight dedup** (`routes/signal-monitor.ts:254-260, 316-343`); comment documents the payload as **~10 MB at the 2000-symbol cap**, serialized once per miss [observed].
- Uncommitted workstream-A diff in `signal-monitor.ts` is **+1,160/−269 (net +891)** — NOT the +249 stated in the brief [observed via `git diff --stat`]. It adds a local-memory gap-fill path (`loadSignalMonitorLocalMemoryGapFillBars` `signal-monitor.ts:5074`, `mergeCompletedBarsWithLocalMemoryGapFill` `:5100` — absent at HEAD) and touches `stateToResponseForSnapshot` (+3 lines).
- The **live bundle includes the uncommitted code**: `LocalMemoryGapFill` appears 6× in `artifacts/api-server/dist/index.mjs` [observed]. Today's profile therefore covers workstream-A code.

---

## 2. Fresh evidence — independently re-derived from the profiles on disk

I re-parsed both profiles with identical methodology (self-time by frame; stack-inclusive share = samples whose ancestry contains the named function). Files: `.pyrus-runtime/api-cpu-544.cpuprofile` (Jul 2, 46,397 samples — matches the plan's numbers exactly, so it is the plan's baseline) and `.pyrus-runtime/api-cpu-5820.cpuprofile` (Jul 8, 52,576 samples). Both are 15s windows — single-snapshot variance applies [observed, caveat noted].

| Metric | Jul 2 | Jul 8 | Δ |
|---|---|---|---|
| GC self-time | 8.1% | **15.8%** | ~2× |
| (idle) | 14.4% | **3.0%** | loop far more saturated |
| `_parseRowAsArray` self | 18.2% | 8.7% | halved — projections worked |
| pg parse+map stack-incl (`_parseRowAsArray`+`mapFromDriverValue`+`parseDataRowMessage`+`handleDataRow`) | n/m | **17.4%** | still material |
| Minute-bar aggregation cluster, stack-incl | n/m | **21.1%** | now the #1 named cluster |
| `readSignalMonitorStateFresh` stack-incl | 7.4% | **22.3%** | **3×** |
| `signalMonitorStreamLaneLatestCompletedBarAt` stack-incl | 2.3% | **14.3%** | **6×** |
| Matrix-stream flush stack-incl | 0.0% | **8.0%** | new load |
| `serializeSseEventData` self | 0.0% | 2.9% (SSE cluster incl ~4.6%) | new load |
| `normalizeLegacyAlgoBranding` self | — | 1.6% | see 2b |

### 2a. Where the aggregation cluster actually burns [observed]

Hot ancestry of the cluster's biggest frames (Jul 8):

```
(anon) <- mergeSignalMonitorStockMinuteAggregates <- loadSignalMonitorStreamSourceMinuteBars
       <- loadSignalMonitorStreamCompletedBars <- signalMonitorStreamLaneLatestCompletedBarAt
       <- stateToResponseForSnapshot            (2.1% + 1.0% + ...)
       <- readSignalMonitorStateFresh           (1.3% + ...)
```

Mechanism, verified in source:
- `/signal-monitor/state` (route `routes/signal-monitor.ts:316`, 15s cache miss) → `getSignalMonitorState` (`signal-monitor.ts:14755`, `markNonCurrentStale: true`) → `readSignalMonitorStateFresh` (`:14589`) → **per state row** (~universe × timeframes, ~12k rows at cap per the route comment) `stateToResponseForSnapshot` (`:1315`) unconditionally calls `signalMonitorStreamLaneLatestCompletedBarAt` (`:1331` → `:5144`), which runs a **full minute-bar load + copy + sort + bucket-group re-aggregation** (`loadSignalMonitorStreamCompletedBars :4955` → `loadSignalMonitorStreamSourceMinuteBars :4899` → `aggregateStockMinuteBarsForTimeframe :4662`, limit 64 buckets) — just to read the timestamp of the **last completed bar**.
- The memo that would collapse this (`signalMonitorStreamSourceMinuteBarsMemo`) is **`null` by default** (`:4845-4848`) and is only activated inside the matrix-flush loop (`withSignalMonitorStreamSourceMinuteBarsMemo`, sole call site `:10652`) — **the snapshot/read path runs memo-less**, re-loading and re-copying the ring per row [observed].
- Allocation churn feeding the GC doubling [inferred from observed code]: `getRecentStockMinuteAggregateHistory` returns fresh `{...message}` copies of up to 4h of minute bars **per call** (`stock-aggregate-stream.ts:421-425`); `aggregateStockMinuteBarsForTimeframe` builds throwaway arrays/Maps/Sets per call (`signal-monitor.ts:4672-4798`); plus the ~10 MB `JSON.stringify` per state-cache miss (`routes/signal-monitor.ts:332`). Causal link GC←these allocators is **unverified** (no allocation profile taken); the CPU profile only proves the calls are hot.

### 2b. Workstream-A regression hypothesis: **REJECTED for this cluster** [observed]

- The new gap-fill code paths account for **0.1%** stack-inclusive in today's profile.
- The hot stacks run through `stateToResponseForSnapshot`/`readSignalMonitorStateFresh`/`signalMonitorStreamLaneLatestCompletedBarAt`, all of which **exist at HEAD** (verified via `git show HEAD:...`: lines 1321, 4883, 13631).
- What DID change 07-02→07-08 is the load shape: state-read cluster 7.4%→22.3%, matrix flush 0%→8.0%. Cause of that growth is **unverified** (candidates: server-owned matrix producer commits `795ce87c`/`34d54d98`/`3e6e000b`, more subscribers/symbols, market conditions). The single confirming check: diff memo/flush counters and universe size between the two dates via the flight recorder, or re-profile after reverting nothing — see sequence below.

### 2c. `normalizeLegacyAlgoBranding` (the old option-B blocker) moved

Its hot caller today is `shadowAnalysisTradeEvent` (`shadow-account.ts:10218`, call sites `:10033, :10913, :11058`) at **1.51%**; the events-feed path (`eventToResponse2`) is 0.06% [observed]. The plan's B-blocker on the events read is moot.

### 2d. Context from the brief, not independently re-verified here [provided evidence]

ELU pinned 1.0, pool 12/12 + 28 waiting, 400 slow queries ≥2s in 3min; slow-query tables today: `execution_events`, `shadow_positions`, `bar_cache`, `shadow_accounts`, `option_contracts`, `shadow_fills`; live incidents `signal_options_worker_failure` (scan timeout), `signal_options_scan_stale`, api p95 2941ms.

---

## 3. Options A–D reassessed against today's profile

| Option | Expected win TODAY | Risk | Effort | Verdict |
|---|---|---|---|---|
| **A** Lazy/opt-in payload (events lists) | ~0 — already landed for both tables (`e8109c69`, `8e23dfbc`) | — | — | **CLOSED — done.** Mark plan complete. |
| **B** `payload::text` passthrough | ~0 — the two target reads no longer select payload at all (strictly better than `::text`). Residual jsonb on hot reads is `symbol_states.filter_state` behind the 5s cache; bounded by pg-decode share of that one read — est. **≤1-3%** [inferred, unmeasured] | Low | Low-Med | **CLOSE as designed.** Fold any residual into "states-read projection" below, gated on a fresh row-attribution measurement. |
| **C** Worker + transferable Buffer | The one endpoint that dominates (`/signal-monitor/state`, 22.3% incl) COULD be moved off-loop — but most of its cost is avoidable re-aggregation, not irreducible work. Moving waste to a worker still wastes a core on a 2-core box shared with trading. | High (infra, pool split) | High | **PARKED.** Reconsider only if, after P3v2 step 1, the state read still dominates. |
| **D** Aggregate in SQL | Partially landed (breadth, `f2b8286f`). Today's dominant JS aggregation is over the **in-memory ring**, not DB rows — D does not address it. | Low | Med | **Opportunistic only.** No named candidate right now. |

**Bottom line: P3-as-written is complete-or-moot. The lever moved.** The July-2 payload-parse premise (18.2% pg parse) is half-solved and the loop got MORE saturated anyway: the growth is in (1) per-row ring re-aggregation on the state-read path (22.3% incl), (2) GC/allocation churn (15.8%), (3) matrix-flush aggregation (8.0%), (4) SSE serialization (~4.6%).

---

## 4. Proposal: what P3 becomes — "P3v2: take avoidable compute off the loop"

Ranked by verified share; each slice independently measurable. **Discussion only — nothing below is authorized.**

### Slice 1 — stop re-aggregating the ring per state row (targets the 14.3% + a GC share)
- **1a (cheapest, hours):** activate the existing memo around snapshot shaping — wrap the row-mapping in `readSignalMonitorStateFresh` (and the passive variant) in `withSignalMonitorStreamSourceMinuteBarsMemo` (mechanism already exists at `:4852`, currently only used at `:10652`). Collapses the per-row minute-bar load+copy to once per symbol (timeframes share it). Also: compute `streamLatestBarAt` lazily in `stateToResponseForSnapshot` (`:1331` computes it even when `markNonCurrentStale` is false and the value is unused). Risk: low — same `evaluatedAt` across the read; memo is call-scoped. Note the memo does NOT cover `aggregateStockMinuteBarsForTimeframe` itself, so this is a partial win.
- **1b (the real fix, ~1-2 days):** `signalMonitorStreamLaneLatestCompletedBarAt` needs only the **latest completed bucket's close time** — derivable from the ring tail in O(tail) without bucket-grouping 120-300 bars into Maps/Sets/sorted arrays (limit 64) per row. Either compute it directly, or maintain a per-(symbol,timeframe) "latest completed bucket end" incrementally on aggregate ingest. Risk: medium — must preserve `isSignalMonitorBarComplete` semantics (provisional/delayed bars); trading-adjacent (currentness gates staleness relabels), so parity tests first.
- **1c (structural, ~1 wk):** incremental aggregation — maintain rolling per-(symbol,timeframe) aggregated series updated on minute-bar close instead of per-call re-bucketing. Also relieves the flush path (8.0%). Risk: med-high (partial-bar, delayed-flag, gap-fill semantics). Only if 1a+1b re-profile says it's still needed.

### Slice 2 — allocation churn / GC (15.8%)
Do **nothing bespoke yet**: slice 1 removes the dominant allocators (per-row `{...message}` history copies at `stock-aggregate-stream.ts:421-425`, per-row aggregation temporaries). Re-profile after slice 1; only then consider shared/frozen history slices or preallocation. Rationale: GC←allocator attribution is unverified; fixing callers first is cheaper than an object-reuse regime.

### Slice 3 — residual pg decode (17.4% incl)
Row attribution first (the July-2 `instrumentQuery` tap, 45s, revert after) against today's slow-query tables (`shadow_*`, `option_contracts`, `bar_cache`, `execution_events`). Then targeted projections: `symbol_states` hot read dropping `filter_state`/`last_error` (needs a consumer audit of `DbSignalMonitorSymbolState` field use), float8-style native decode for hot numerics (`d00ad0a5` precedent). Est. single-digit % [inferred].

### Slice 4 — SSE serialization (~4.6% incl)
`serializeSseEventData` is a bare `JSON.stringify` per emit (`sse-stream-diagnostics.ts:89-96`); `stableStringify3` (1.2%) computes change-detection signatures. Proposals: serialize once per broadcast and share bytes across subscribers (whether per-subscriber re-serialization happens today is **[unknown]** — audit `platform.ts`, `massive-stock-quote-stream.ts`, `stock-aggregate-stream.ts` call sites first); replace signature stringify with a cheap structural hash or reuse the emitted string as the signature. Counters already exist for before/after (`getSseEmitCounters`, `sse-stream-diagnostics.ts:98`).

### Slice 5 — `shadowAnalysisTradeEvent` branding walk (1.5%)
Move `normalizeLegacyAlgoBranding` to ingest for shadow analysis events, or add a has-legacy-token fast-path skip in the walk (`algo-branding.ts:72`). Small, independent.

---

## 5. Recommended sequence, each step with its cheapest confirming measurement

| # | Step | Confirming measurement (before → after) |
|---|---|---|
| 0 | Land or park workstream-A first (tree hygiene: +891 uncommitted lines in the same file P3v2 must touch) | `git status` clean on `signal-monitor.ts` |
| 1 | Slice 1a (memo wrap + lazy `streamLatestBarAt`) | 15s profile via `scripts/diag/cpu-profile-running-api.mjs`: incl `signalMonitorStreamLaneLatestCompletedBarAt` share; memo hit/miss counters (`getSignalMonitorStreamSourceMinuteBarsMemoStats`, `signal-monitor.ts:4862`) |
| 2 | Slice 1b (O(1) latest-completed-bucket) | Same profile metric → target <3%; GC self-time delta; `/signal-monitor/state` route timing in flight recorder |
| 3 | Re-profile decision gate: is GC still >10%? is state read still >10%? | 15s profile, normalized to on-CPU time (idle drifts between runs) |
| 4 | Slice 3 row attribution (45s `instrumentQuery` tap, revert) | rows-by-table delta vs July-2 table in the plan |
| 5 | Slice 4 SSE audit + signature caching if per-subscriber serialization is confirmed | `getSseEmitCounters()` bytes/stringifyMs before/after |

---

## 6. Open questions for Riley

1. **Scope of the state poll:** the `/signal-monitor/state` response is ~10 MB and the matrix SSE stream exists — is a 12k-row full-universe poll still a product requirement, or can the poll shrink (fewer timeframes, current-only, longer TTL than 15s)? Cutting the payload beats optimizing its production.
2. **Does `markNonCurrentStale` need per-row ring currentness on every poll**, or can currentness ride on producer-maintained state (updated at bar close)? This decides whether 1b is a micro-opt or an architecture change.
3. **Workstream-A landing order** — P3v2 slice 1 edits the same regions of `signal-monitor.ts` as the uncommitted +891 lines. Land A first, or rebase P3v2 onto it?
4. **What grew the state-read/flush load 3-6× since Jul 2?** (unverified — candidates: server-owned producer commits, subscriber count, universe size). Worth one flight-recorder archaeology pass before trusting the Jul 8 snapshot as the steady state?
5. **Acceptance bar:** is the goal ELU < some threshold during market hours, or incident silence (`signal_options_scan_stale`, p95)? Determines when P3v2 stops.

## 7. Discrepancies vs the briefing (for the record)

- Uncommitted diff is +1,160/−269 (net +891), not +249 [observed].
- Aggregation cluster measures **21.1%** stack-inclusive (brief said 12-15%; methodology likely differed).
- `handleRawMessage` lives in `massive-stock-websocket.ts:410`, not `massive-stock-quote-stream.ts` [observed].
- Workstream-A as regression suspect for the cluster: **rejected** — new gap-fill code is 0.1% of samples; the hot path pre-exists at HEAD (§2b).
