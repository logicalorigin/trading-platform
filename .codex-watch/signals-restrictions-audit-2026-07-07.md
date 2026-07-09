# Signals restrictions audit - 2026-07-07

Auditor: `codex-worker` for `claude-lead`  
Mode: read-only source + read-only SQL. Only this report was written.

## Executive verdict

Observed root cause for the owner's Age-sort "missing data": the visible `Age` column is **not** `bars_since_signal`; it is `dashboardSummary.trendAgeBars` from `indicatorSnapshot`. DB bootstrap cannot persist that field. It synthesizes only `indicatorSnapshot.trendDirection` and hard-codes `trendAgeBars:null`, so rows hydrated only from stored state render `Age` as `-`. Live matrix deltas can fill full indicator snapshots, but coverage is partial and delayed. Sorting by Age correctly pushes finite-age rows ahead of null-age rows, making the missing bootstrap-only/unstale cells prominent.

Verified contributors:

- Verified primary: stored bootstrap omits trend age (`trendAgeBars:null`) at `artifacts/api-server/src/services/signal-monitor.ts:12276`.
- Verified secondary: partial 15m/1h live coverage. SQL at 17:03Z showed only `172/2699` directional 15m cells and `172/1301` directional 1h cells had `latest_bar_at >= 16:00Z`.
- Verified not root: current comparator guards nulls. `finiteNumberOrNull` rejects null/empty before numeric coercion at `artifacts/pyrus/src/features/signals/signalsRowModel.js:108`, and `compareNumberAsc` puts nulls last at `:122`.
- Unverified as current root: pagination. Signals uses `DenseVirtualTable` virtualization, not page slicing; it renders all sorted rows with default overscan 12 at `artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx:34`.

## Inventory

| Layer | Restriction | Source | Value/config | Impact | Verdict |
|---|---|---|---|---|---|
| Generation | Global signal max symbols | `artifacts/api-server/src/services/signal-monitor.ts:500` | hardcoded `SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT = 2000`; profile DB has `max_symbols=2000` | Catalog has 5,744 active optionable ranked symbols; 3,744 ranked symbols are outside top 2,000. Active DB state has 3,515 symbols, but current resolver/FE cap is 2,000. | Stale/undersized. Relax only after ELU fix and bounded active-set plan. |
| Generation | Universe resolver slices source symbols | `signal-monitor.ts:3562`, `:3801`, `:3847`, `:3893` | hardcoded/profile cap | 92 watchlist symbols are pinned first, then ranked expansion fills to 2,000. Anything after slice cannot be in current profile/SSE scope. | Invisible-and-confusing: surface truncated/skipped. |
| Generation | Worker history fallback batch | `artifacts/api-server/src/services/signal-monitor-evaluation-worker.ts:38`, `:314` | hardcoded `48`, min(profile max, 48) | At 2,000 scoped symbols: `ceil(2000/48)=42` ticks. With 5s wakeup, best-case full pass per profile timeframe is about 210s plus work. | Perf guard, but too small once universe is 2,000. |
| Generation | Worker wakeup / poll | `signal-monitor-evaluation-worker.ts:35`, `:831` | hardcoded 5s wakeup; DB profile `poll_interval_seconds=60` | Rotation bypasses poll while cursor >0, then waits 60s after full pass. Worst-case revisit about 210s + 60s for 2,000 symbols. | Keep until ELU fix; then consider bigger batch. |
| Generation | Evaluation concurrency | `signal-monitor-evaluation-worker.ts:352`; `signal-monitor.ts:508`, `:1081` | profile DB `6`, hard cap `10` | Batches of 48 are processed 6 at a time. Protects DB/API but lengthens refresh. | Keep now; relax after ELU/DB headroom. |
| Generation | Rotation order bias | `signal-monitor-evaluation-worker.ts:131`, `:315`; `signal-monitor.ts:3622` | pinned watchlist symbols interleaved/priority | Pinned symbols get favored; expansion tail lags. | Keep but surface pinned vs expansion coverage. |
| Generation | Backfill pressure skip | `signal-monitor.ts:5066`, `:5160` | hardcoded skip when `resourceLevel === "high"` | Deep-history base refresh stops under high resource pressure. Context ELU profile showed high pressure driven by signal matrix stream work, so aggregated TFs can stay cold. | Keep guard, but relaxable after ELU producer fix. |
| Generation | Backfill cycle cap | `signal-monitor.ts:4971`, `:4986`, `:4991` | refresh: 1m/2m/5m 5m, 15m 10m, 1h 30m, 1d 4h; concurrency 3; warmed cap 64 cells/cycle | Steady-state full 12k-cell refresh at 64/cycle is hours-scale; cold cells bypass cap, but pressure skip can prevent cold fill. | Too opaque; surface coverage and pressure-skip. |
| Generation | Background DB gate | `signal-monitor.ts:5009` | env `SIGNAL_MONITOR_BACKGROUND_DB_CONCURRENCY`, default 6 | Prevents backfill+persist from consuming all 12 pool slots; can delay background hydration. | Justified perf guard. |
| Transport/API | SSE bootstrap frame size | `artifacts/api-server/src/routes/signal-monitor.ts:239` | hardcoded 2,000 states/frame | No data loss, but progressive hydration. Full 12k bootstrap becomes 6 frames. | Keep. |
| Transport/API | Stream scope symbol cap | `signal-monitor.ts:833` | hardcoded 2,000 symbols | Requests beyond 2,000 are truncated/skipped in scope metadata; UI can see fewer symbols than DB has. | Stale/undersized; surface clearly. |
| Transport/API | Exact-cell cap | `signal-monitor.ts:940` | returns `null` | No exact-cell cap currently. | No restriction. |
| Transport/API | State route cache | `routes/signal-monitor.ts:254` | hardcoded 15s serialized cache | `/signal-monitor/state` can show up to 15s stale, but avoids repeated multi-MB stringify/read. | Keep. |
| Transport/API | State rows cache | `signal-monitor.ts:13449` | hardcoded 5s | Stored-state reads can lag 5s. | Keep. |
| Transport/API | Breadth route cache | `routes/signal-monitor.ts:262` | hardcoded 5s serialized cache | Recent in-flight edit already adds short cache. Display-only. | Keep. |
| Transport/API | SSE bootstrap snapshot cache | `signal-monitor.ts:9652` | hardcoded 30s TTL | Reconnect/widen can reuse snapshot; client merge should not overwrite fresher deltas. | Keep. |
| Transport/API | Events route pagination | `signal-monitor.ts:1515`, `:2751`; `api.ts:5596` | default 100, max 1000; UI asks 250 at `SignalsScreen.jsx:138` | Events are not full history unless cursor followed. PlatformApp does follow pages elsewhere; SignalsScreen local query only displays 250. | Invisible-and-confusing for sparkline/history context. |
| Transport/API | Events list cache | `signal-monitor.ts:13538` | hardcoded 5s via state row TTL | Can lag event list by 5s. | Keep. |
| Transport/API | SSE flush cadence | `signal-monitor.ts:478`, `:482`, `:9941` | env-overridable 300ms with real subscriber, 3,000ms idle/server-owned | Idle/server-owned producer coalesces deltas for 3s. Real UI reschedules to 300ms. | Keep; ELU fix already targets producer overhead. |
| Transport/API | Completed bars LRU | `signal-monitor.ts:450`, `:464`, `:7860` | 30s TTL; cache 3,072 completed-bar entries; stream bars cache 8,000 | A 2,000 x 6 scope is 12,000 cells. Stream cache evicts ~4,000 cells even at cap; completed-bars cache covers ~25.6% of cells. Eviction causes recompute/DB load, not direct UI blanks. | Stale/undersized for 2,000x6; change after ELU fix. |
| Transport/API | Heavy eval cache | `signal-monitor.ts:7825` | 12,288 entries | Covers 2,000x6 with headroom. | Keep. |
| UI | Hydration renderable rule | `signalsMatrixHydration.js:16` | status ok/stale only, active, no lastError, latestBarAt/currentSignalAt; excludes idle | SQL: screen-renderable all active cells, hydration-plan renderable is lower for idle lanes (15m 3354/3379; 1h 3085/3112). | Invisible-and-confusing: idle counted missing by strip. |
| UI | Hydration chunk caps | `signalsMatrixHydration.js:9` | `null`, no chunk cap | No UI-side batching cap currently. | No restriction. |
| UI | Row assembly | `signalsRowModel.js:997` | tracked symbols from universe/states/events, then bounded in screen | Rows can include trend-only directions; displaySignalAt can be null. SQL: 2,261 distinct symbols have at least one directional cell with null `current_signal_at`. | Data semantics confusing; label trend-only vs signal. |
| UI | Age column | `SignalsScreen.jsx:4305`; `formatAge` at `:453` | desktop column; Age = `dashboardSummary.trendAgeBars` | Missing when no full `indicatorSnapshot` or trendAge null. Not the Bars column. | Root symptom. |
| UI | Age sort | `signalsRowModel.js:1312` | sort by `dashboardSummary.trendAgeBars`; null last | Comparator is sane now; sort surfaces finite-age rows and exposes nulls/missing, not NaN. | Keep comparator; fix data/label. |
| UI | Bars sort | `signalsRowModel.js:1336` | sort by `row.barsSinceSignal` | SQL: directional active rows have 0 null `bars_since_signal`, but REST hides it when `current_signal_at` is null. | Not Age root; can still confuse. |
| UI | Virtualization | `DenseVirtualTable.jsx:34`, `:50`, `:396` | default overscan 12, no page cap | Only DOM virtualization. It should not remove data from sorted array. | Keep. |
| Retention/DB | Event retention | `lib/db/src/retention.ts:226`, `:304` | env `SIGNAL_MONITOR_EVENT_RETENTION_DAYS`, default 120; preserves latest trusted per cell | SQL: 183 events older than 120d exist now; retention would prune old non-latest rows only. Not Age-sort root. | Keep. |
| Retention/DB | Inactive state retention | `retention.ts:251`, `:305` | env `SIGNAL_MONITOR_INACTIVE_STATE_RETENTION_DAYS`, default 90; active rows never deleted | Not causing visible active-row missing data. | Keep. |
| Retention/DB | Breadth snapshot retention | `retention.ts:125`, `:299` | env default 90d | Affects charts only; fallback exists. | Keep. |

## Rotation math vs observed staleness

Facts:

- Shadow profile: timeframe `5m`, `fresh_window_bars=8`, `poll_interval_seconds=60`, `max_symbols=2000`, `evaluation_concurrency=6`, last evaluated `2026-07-07 16:55:44Z`.
- Worker fallback batch: `min(profile.maxSymbols, HISTORY_FALLBACK_BATCH_SYMBOLS=48)`.
- Worker wakeup: 5s. While cursor is non-zero, it does not wait for the 60s poll interval.
- Best-case legacy full scoped refresh: `ceil(2000/48) * 5s = 210s`, plus actual bar-load/eval time, then up to 60s until the next rotation starts.

Observed SQL at 17:03Z:

| timeframe | directional | latest >= 16:00Z | evaluated >= 16:00Z | newest latest bar |
|---|---:|---:|---:|---|
| 15m | 2699 | 172 | 173 | 16:45Z |
| 1h | 1301 | 172 | 172 | 16:00Z |
| 1m | 3422 | 1916 | 1916 | 16:56Z |
| 2m | 3126 | 1635 | 1635 | 16:53Z |
| 5m | 3114 | 1651 | 1652 | 16:55Z |

Conclusion: the 15m/1h staleness does **not** match the 210s best-case legacy rotation if that path had healthy current coverage. It matches the parallel ELU finding: the stream/producer path is the main-thread burner and the evaluation worker/backfill are starved/deferred, while backfill also skips under high pressure. The profile cap means only 2,000 symbols are in the current scoped universe; older active DB rows outside that cap can remain as confusing stored state.

## Age-sort root cause

Source chain:

- Column label: `Age` at `artifacts/pyrus/src/screens/SignalsScreen.jsx:4305`.
- Display value: `formatAge(row.original.dashboardSummary)` at `SignalsScreen.jsx:4315`.
- `formatAge` reads `dashboardSummary.trendAgeBars` at `SignalsScreen.jsx:453`.
- `dashboardSummary.trendAgeBars` comes from `state.indicatorSnapshot.trendAgeBars` via `resolveDashboardSnapshot` and `resolveDashboardSummary` at `signalsRowModel.js:323` and `:378`.
- Stored DB bootstrap converts DB state to matrix state at `signal-monitor.ts:12246`; it hard-codes `indicatorSnapshot.trendAgeBars:null` at `:12282`.
- Full stream evaluation builds real `indicatorSnapshot` at `signal-monitor.ts:8111`.
- Sort uses `dashboardSummary.trendAgeBars` at `signalsRowModel.js:1312`.
- Null comparator is guarded at `signalsRowModel.js:108` and `:122`; null sorts last, no NaN/0 bug observed in current source.

SQL facts:

- Active shadow cells: 20,185.
- Directional active cells: 14,712.
- Directional cells with null `bars_since_signal`: 0.
- Directional cells with null `current_signal_at`: 6,407 total across timeframes (15m 1,583; 1h 157; 1m 553; 2m 2,067; 5m 2,012; 1d 35).
- Distinct active symbols: 3,515; distinct symbols with a direction: 3,466; distinct symbols with a directional/null-signal-at cell: 2,261.

Root-cause label:

- (a) Null-age comparator bug: refuted for current source.
- (b) Unhydrated/bootstrap-only cells prominent under sort: verified.
- (c) Pagination/virtualization interaction: refuted for pagination; virtualization only limits DOM rows.
- (d) Data join bug: partially verified as a semantic join gap, not a SQL join bug. Stored state lacks trend-age fields by schema/design, so DB bootstrap cannot populate the UI's Age metric.

## Ponytail-ordered fix list

1. Cheapest proper fix: make the Age column honest.
   - File: `artifacts/pyrus/src/screens/SignalsScreen.jsx:4305`.
   - Change: label `Age` as trend age only when `dashboardSummary.trendAgeBars` is finite; otherwise show an explicit compact state such as `live --`/`stored --` via existing row data, or rename to `Trend age`.
   - Risk: low. No backend load. Makes missingness explain itself.

2. Use existing durable data for a fallback Age display.
   - File: `artifacts/pyrus/src/features/signals/signalsRowModel.js:378`.
   - Change: if `trendAgeBars` is null, fall back to finite `barsSinceSignal` for display only, with a source flag so trend age and signal bars are not conflated.
   - Risk: medium semantic risk. Ponytail note: do not invent storage yet; reuse already-delivered `barsSinceSignal`.

3. Persist minimal trend-age fields if product truly wants Age to mean indicator trend age everywhere.
   - Files: `lib/db/src/schema/signal-monitor.ts:45`, `artifacts/api-server/src/services/signal-monitor.ts:12276`, writer around `:8919`.
   - Change: add `trend_age_bars` and `trend_age_bucket` to `signal_monitor_symbol_states`, write them from `indicatorSnapshot`, and bootstrap them instead of null.
   - Risk: migration + writer/read contract. Correct root fix, but not first ponytail step.

4. Surface universe truncation/coverage.
   - Files: `SignalsScreen.jsx:4666`, `signal-monitor.ts:9545`.
   - Change: show `truncated/skippedSymbols/activeScopeSymbols` next to `Intervals`, especially when configured cap is 2,000 and DB/catalog universe is larger.
   - Risk: low. Reduces "missing data" ambiguity.

5. After ELU producer fix lands, increase generation coverage cautiously.
   - Files: `signal-monitor-evaluation-worker.ts:38`, `signal-monitor.ts:500`, `:7860`.
   - Proposed sequence: raise history fallback batch 48 -> 96 first; then size stream completed-bars cache to cover scoped cells (`>= 12,288`) if memory is acceptable; only then consider max symbol cap above 2,000.
   - Risk: high before ELU fix; moderate after. Needs DB/ELU measurement.

6. Fix hydration strip semantics for idle.
   - File: `signalsMatrixHydration.js:16`.
   - Change: count `idle` as hydrated if screen renderability treats it as renderable, or split missing vs idle.
   - Risk: low. This is presentation accuracy, not generation.

