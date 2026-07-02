# Bug Report — 2026-06-26

**Window:** 13:56–14:03 UTC (~5 min live watch)
**Target:** live API process pid 535 (~4h uptime), shared helium dev DB, public preview
**Method:** flight recorder (`.pyrus-runtime/flight-recorder/api-current.json`), event stream
(`api-events-2026-06-26.jsonl`), `/api/healthz` sampled every 30s for 10 ticks, public preview,
and direct `psql` against `DATABASE_URL`.

**Top line:** the app is **up and serving** (preview renders `PYRUS Platform`, `healthz` = ok every
tick, no crash during the window) but **not healthy** — it is under sustained HIGH pressure and
throwing real errors continuously. Severity legend: 🔴 critical · 🟠 high · 🟡 medium · ⚪ minor.

---

## 🔴 Bug 1 — Unapplied migration: `option_contracts.broker_contract_id` does not exist

**Status:** observed, root cause confirmed. Live and ongoing (re-confirmed 15:03 UTC — latest error
`2026-06-26T15:03:15Z`, 56 in the trailing window).

Every read and write to `option_contracts` is failing continuously:

```
error: column "broker_contract_id" does not exist
error: column "broker_contract_id" of relation "option_contracts" does not exist
```

**Evidence**
- **164×** today; **still firing in the current hour** (40× in hour 13:00 UTC). Affects both
  `SELECT` and `UPDATE` — option-contract metadata **reads error out AND upsert writes are lost**.
- Live DB check: `select count(*) from information_schema.columns where table_name='option_contracts'
  and column_name='broker_contract_id'` → **0**. Column is absent.
- Code expects it: `artifacts/api-server/src/services/option-metadata-store.ts` selects/updates
  `optionContractsTable.brokerContractId` (lines 431–476, 828, 974–990); also referenced in
  `providers/ibkr/client.ts`, `services/platform.ts`, and the generated client schema
  (`lib/api-client-react/src/generated/api.schemas.ts:2235`).
- Migration **exists but was never applied:** `lib/db/migrations/20260626_option_contract_broker_contract_id.sql`
  (dated today) runs `alter table public.option_contracts add column if not exists broker_contract_id`.
  No automated runner here — `drizzle push` is intentionally disabled (post 2026-06-15 data-loss
  incident); SQL migrations are applied manually, and this one wasn't.

**Fix (NOT done — mutates the shared live DB, outside a "watch" task):** apply that migration's SQL
against `DATABASE_URL`, then re-watch.

---

## 🟠 Bug 2 — DB pool saturation + event loop pinned (cascade, likely driven by #1)

**Status:** observed, sustained the entire window. Cause-of-cascade inferred, not fully proven.

**Evidence**
- Pool **maxed** start→end: `max 12, active 12, waiting 8 → 15` (15 queued at the tick-8 spike).
- Event-loop **utilization 99.6%**, delay p95 ~350 ms–1.5 s; API pressure `level: high` at start and end.
- Today's event stream: **13,821** `api-db-query-slow` + **6,275** `api-db-pool-acquire-slow`.
- Slow user-facing routes at window close: `POST /api/sparklines/seed` p95 **31 s**, `GET /bars`
  **10.5 s**, `/sparklines/seed` 12.8 s.
- `bar_cache` bulk INSERT **timed out at 15.6 s** (`canceling statement due to statement timeout`,
  15 waiting); 22 statement-timeouts on the bars/sparkline batch query today.
- Load trend (new slow-events per 30s tick): ~58–95 baseline, then **433 then 343** in the final
  minute — pressure was **worsening**, not settling.

**Causal note (hypothesis):** the `broker_contract_id` failures hammer `option_contracts` in a hot
refresh path, each holding a pool connection until it errors, plausibly starving the pool and
serializing the bars/sparkline writes behind it. The bars timeouts are real regardless. Treat
"#1 is the primary driver of #2" as a strong hypothesis — confirmable by applying the migration and
re-watching the pool/`waiting` count.

---

## 🟡 Bug 3 — `GET /accounts` returns 503 "IBKR is not configured" (likely expected here)

**Status:** CONFIRMED (re-checked 15:03 UTC). Downgraded 🟠→🟡 — likely expected in this env.

`GET /accounts` → `503` with `title: "IBKR is not configured"`, `detail: "Real account data requires a
configured IBKR bridge. Shadow account data remains available."` So it is the **not-configured**
variant, not missing tables: `/accounts/flex/health` confirms `flexConfigured: true, schemaReady: true,
missingTables: []`. Source `artifacts/api-server/src/services/account.ts:3876`. **No fix needed unless
real IBKR accounts are meant to be wired in this environment** — shadow account data still serves.

---

## 🟠 Bug 4 — `/api/ibkr/desktop/jobs/claim` 401 flood

**Status:** observed, continuous. Cause unverified.

The desktop-connector poll loop (`jobs/claim`, `register`, `heartbeat`) returns **401 repeatedly**
and dominates the failure feed — it pushed the 4xx rate to **167 vs 143 2xx** over the window.
Cheap (10–160 ms) and possibly expected if no authenticated desktop bridge is attached, but it is
continuous and drowns the telemetry. Likely auth/secret rejection inside `registerIbkrRemoteDesktop`
(`artifacts/api-server/src/routes/platform.ts:1745–1778`).

---

## ✅ Bug 5 — Watchlist % change reads 0 for every symbol (prevClose never attached to live quotes) — FIXED 15:1x UTC

**Status:** ROOT-CAUSED, FIXED, and VERIFIED LIVE. (Originally observed by user; not in the first
backend-only watch.)

**Fix applied** (`artifacts/api-server/src/services/platform.ts`): the day-change context cache
(`stock-quote-day-change-context.ts`) was only ever seeded by quotes that already carried a usable
`prevClose` — which on the Massive realtime path nothing does — so `getSymbolsNeedingStockQuoteDayChangeContext`
and `recordStockQuoteDayChangeContexts` had **zero callers** and the cache stayed permanently empty.
Added `seedStockQuoteDayChangeContext(symbols)` in the Massive-realtime branch of
`getQuoteSnapshotsUncached`: it fetches the Massive REST snapshot (`client.getQuoteSnapshots`, which
*does* carry `prevClose`/open/high/low) for symbols whose context is missing or past its 30s TTL,
best-effort and fire-and-forget (no added latency to the quote response; an in-flight guard prevents a
fetch stampede). The existing `enrichStockQuoteWithDayChangeContext` then fills `prevClose`/`change`/
`changePercent` from the seeded baseline.

**Verification (live, post-restart):** `GET /quotes/snapshot?symbols=SPY,AAPL,QQQ` now returns real,
moving day-change: SPY `prevClose 734.30 → −0.26%`, AAPL `275.15 → +1.64%`, QQQ `716.38 → −0.94%`
(updates each poll with price). Typecheck clean; API rebuilt+restarted in place (pid 46269).

**Note:** this is the live-quote/websocket transport. The IBKR-bridge and overnight transports already
carried `prevClose`. If the watchlist still shows 0% for some symbol, it would be one not covered by
the Massive REST snapshot (e.g. an unsupported ticker) — report it and I'll extend coverage.

---

### (original diagnosis, retained for reference)

**Status:** observed by user, root cause verified with live runtime data. Distinct from #1, was NOT
in the original watch (that was backend-telemetry only — no UI inspection).

**Symptom:** the watchlist sidebar shows **% change = 0 for all symbols**.

**Evidence (live runtime, market open ~14:51 UTC):** `GET /api/quotes/snapshot?symbols=SPY,AAPL,QQQ`:

| symbol | price | freshness / transport | ageMs | prevClose | change | changePercent |
|--------|-------|-----------------------|-------|-----------|--------|---------------|
| SPY  | 733.08 | live / massive_websocket | 699 | **null** | **0** | **0** |
| AAPL | 279.32 | live / massive_websocket | 114 | **null** | **0** | **0** |
| QQQ  | 711.78 | live / massive_websocket | —   | **null** | **0** | **0** |

Price is **live and fresh** (sub-second age, real Massive websocket) — prices are NOT stale. But
`prevClose`, `open`, `high`, `low`, `volume` are **all null**, so `change`/`changePercent` come back 0.

**Code mechanism (verified):**
- Server: `massiveAggregateToBrokerQuote` (`artifacts/api-server/src/services/platform.ts:4630-4635`)
  **hardcodes** `change: 0, changePercent: 0, prevClose: null`. Live stock quotes served from the
  Massive websocket path carry no prior-close baseline.
- Client: `screens/algo/algoHelpers.js` computes `pct = ((price - ln) / ln) * 100` only when the
  baseline `ln` (prevClose) is non-null and non-zero; with `prevClose` null it stays 0.

**Conclusion:** the watchlist % move is **structurally 0 whenever quotes are served from the live
Massive websocket path**, because no prior-close / daily-OHLC reference is attached.

**Open question (cause-not-fully-verified):** whether a `prevClose` enrichment (from daily bars /
IBKR snapshot) is *supposed* to run and is failing under the bar-pipeline pressure in #2 (`GET /bars`
10.5 s, `POST /sparklines/seed` 31 s, `bar_cache` INSERT statement-timeouts) — or whether prevClose
was simply never wired for the websocket transport. The all-null OHLC alongside a live price suggests
a thin tick path missing the daily-enrichment merge. Verify by checking whether daily bars / prevClose
exist server-side for SPY and, if so, why they aren't merged into the websocket quote.

---

## ⚪ Minor

- **5xx rose 3 → 7** during the 5-minute window (includes the `/accounts` 503).
- **3,518** `diagnostic-event-db-persist-skipped` today — diagnostics being dropped, consistent with
  DB pressure.
- `POST /streams/stocks/aggregates/sessions/<id>/symbols` → 404 (stale/expired stream session).
- Earlier today (not during this window): 12 process exits / 11 shutdowns including **1
  `api-shutdown-forced`** (graceful shutdown timed out at 01:24 UTC).

---

---

# Second watch — 14:55–15:01 UTC (~5 min)

Fresh window, tuned to surface *new* issues (novel error strings, RSS/heap trend, endpoint probes).
The process had restarted to **pid 15906 at 14:44:16** — verified benign: `dist/index.mjs` was rebuilt
at 14:44:10, six seconds before restart = a **rebuild+restart (in-place reload)**, not a crash.
**Overall health degraded during this window** (5xx climbed steadily, pool saturation worsened).

## 🔴 Bug 6 — `POST /api/sparklines/seed` returns HTTP 500 (and 25s timeouts)

**Status:** observed, live. New.

- Confirmed in `recentFailures`: **`500 /api/sparklines/seed`**.
- Also the **dominant slow route** at window close: p95 **25,301 ms** (12 samples). Earlier window it
  was 31 s. So the route both **times out and hard-errors**.
- Almost certainly the surfaced form of the `bar_cache` bulk-INSERT statement-timeout in #2 (the seed
  writes sparkline bars into `bar_cache`; that INSERT cancels at the statement-timeout → 500). Same
  root as #2/#9.

## 🟠 Bug 7 — Request health collapsing: 5xx 3→16 in 5 min, ~77% of requests non-2xx

**Status:** observed, trend. New (degradation rate).

- 5xx counter rose **3 → 16** across the 10 ticks; 4xx rose **44 → 231**.
- Final mix over the window: **69 2xx vs 231 4xx + 16 5xx** — roughly **3 of every 4 requests fail**.
- 4xx is dominated by the relentless `/api/ibkr/desktop/jobs/claim` 401 loop (#4); 5xx by sparkline
  seed (#6). Pool `waiting` ended at **17–19** (active 12/12).
- One 30s tick logged **819 `diagnostic-event-db-persist-skipped`** — diagnostics dropped en masse
  when the DB fell behind.

## 🟠 Bug 8 — Market-data persist worker has failed ingest jobs needing operator review

**Status:** observed via `/api/diagnostics/runtime`. New. Likely current.

`marketDataWorkPlan.persistJobs` / `massiveSnapshot`:
```json
{ "owner": "rust-market-data-worker", "provider": "massive",
  "intent": "persisted-forward-refresh", "kind": "market_data_ingest_jobs",
  "status": "failed", "jobCount": 2, "reason": "worker jobs need retry or operator review" }
```
The persisted-forward-refresh worker (the path that writes daily/forward bars) has **2 failed jobs
parked for operator review**. This is the upstream of #5 (null `prevClose`) and #9 (bars cache miss).

## 🟠 Bug 9 — Bars cache 100% miss; cache never populates

**Status:** observed via `/api/diagnostics/runtime` `api.resourceCaches.bars.hydration`. New.

`cacheHit: 0, cacheMiss: 83, providerFetch: 137, providerPage: 137` — **every** bars request misses
the cache and re-fetches from the provider. Consistent with the `bar_cache` INSERT timeouts (#2): if
writes never commit, the cache stays empty, so reads always miss → more provider load → more pressure.
Explains slow `/bars` (10.5 s) and contributes to the missing `prevClose` (#5).

## 🟡 Bug 10 — Flow premium-distribution `degraded`: 4.7% classification coverage

**Status:** observed live. New. Cause inferred.

`GET /api/flow/premium-distribution?underlying=SPY` → `status: "degraded"`,
`classificationCoverage: 0.047` (4.7%). Only ~5% of options premium is being classified. Quote/trade
access both report "available", so the gap is most plausibly **downstream of #1** — option-contract
lookups failing (`broker_contract_id`) means premium can't be attributed to contracts. Inferred, not
proven.

## 🟠 Bug 11 — STA signal table stale (20+ min) while the live matrix is fresh — signal-event persistence runs minutes behind the bar clock

**Status:** observed by user, investigated against live runtime. New. Root cause: emit/persist
backlog (same DB-throughput class as #2/#8/#9). One measurement was confounded by a restart (noted).

**Symptom:** at algo control panel 1:1 (1m exec / 1m MTF), the most recent **1m signal in the STA
table was ~23 min old** during regular trading hours, while the live STA **matrix** looked current.

**Two distinct data paths (verified live):**
- **STA matrix** = live SSE (`/api/signal-monitor/matrix/stream` + `/signal-monitor/state`). Its
  per-symbol `latestBar` was **15:18:00 (~1 min old)** — fresh, current bars. Ephemeral compute, **no
  DB write in its path**.
- **STA table "received" rows** = `GET /api/signal-monitor/events` → the **persisted
  `signal_monitor_events` DB table** (`sourceStatus: "database"`). A row appears only when the engine
  **emits a signal AND writes it to the DB**.

So the table is pointed at the durable event DB; the matrix at live compute. That split is why one can
be stale while the other is fresh — the matrix never waits on the database.

**Evidence — emit lag (`signalAt` = bar close, `emittedAt` = DB persist), sampled live 15:24 UTC:**

| symbol | tf | signalAt | emittedAt | emit lag |
|--------|----|----------|-----------|----------|
| GEV  | 1m  | 15:15:00 | 15:18:23 | 3.4 min |
| AVAV | 1m  | 15:12:00 | 15:18:06 | 6.1 min |
| AAT  | 15m | 15:00:00 | 15:22:12 | **22.2 min** |
| GOOGL| 1m  | 14:56:00 | 15:03:54 | 7.9 min |

The signal engine persists signals **minutes-to-tens-of-minutes behind the live bar** (1–22 min
observed, and growing — the 15:00 bars were only landing at ~15:22). Between 15:20 and 15:24 **no new
1m event was persisted** even though bars 15:16–15:23 had closed and the matrix had them. The table
trails the matrix by exactly this persist lag; when the lag balloons (DB pool saturation, the
`diagnostic-event-db-persist-skipped` flood in #7) it shows as the 20+ min staleness observed.

**Why it matters:** at 1:1 the algo is meant to act on the 1-minute cadence. A signal table running
20+ min behind means execution/MTF-gating decisions reference state from ~20 bars ago — entries/exits
mispriced or missed, setups that formed-and-resolved inside the gap never recorded, and the panel
*looks* live (matrix fresh) while the durable signal record an operator/audit trusts is far behind.

**Honest caveat (self-confound):** the first 22-min reading (sampled 15:18) was inflated by warmup —
the API was restarted at ~15:10 for the Bug 5 fix, which reset the in-process signal monitor; it
resumed emitting ~15:18. But re-sampling warm (15:24) still shows 1–22 min lags and a growing backlog,
so the staleness is real beyond the restart.

**Likely cause (inferred):** the signal scan/emit/persist loop is starved by the same event-loop +
DB-pool pressure cascade as #2 — it processes the 3000-state universe many minutes behind real time
and its DB writes queue/drop. Confirming check: watch the steady-state emit lag now that the process
is warm, and instrument where in scan→emit→persist the time goes.

**Loose end (unverified):** `/api/signal-monitor/state` returns `stateSource: "database"` with
`evaluatedAt: 2026-06-23T18:32` (~3 days old) despite fresh per-symbol bars — possibly a static field,
possibly a durable state-eval persist stale for days. Needs confirmation before being claimed as a bug.

---

## ⚪ Second-watch minor / refinements

- **`/accounts` 503 is "IBKR is not configured"** (not the missing-tables variant). `/accounts/flex/health`
  confirms `flexConfigured: true, schemaReady: true, missingTables: []`. Shadow account data remains
  available. **Likely expected in this market-data-only dev env — downgrade #3 unless real IBKR
  accounts are meant to be wired here.**
- **Intermittent >8s stalls on normally-fast endpoints:** `/accounts/flex/health` and
  `/flow/premium-distribution` each timed out at 8s once, then returned in 0.07–1.5s on retry — a
  user-visible symptom of the pool saturation in #2, not separate bugs.
- **Memory:** RSS grew **865 → 1687 MB then plateaued ~1680**; heapUsed sawtooths (400–953 MB) so GC
  is reclaiming. Growth-then-plateau with working GC — **not a proven leak**, but worth watching given
  the earlier process ran ~2.0 GB RSS.
- **`marketDataIngest.recentProviderFailures` (FFIN "no usable stock snapshot") are STALE — dated
  2026-06-22**, retained in the diagnostics buffer; not a live issue.
- Storage layer itself is healthy: `status: ok, reachable: true, readWriteVerified: true, pingMs: 496`.
  `pythonCompute` lane healthy. So the bottleneck is query/pool throughput, not DB reachability.

---

## Recommendation

Most findings cluster into **one DB-throughput failure** plus a few independents:

1. **Apply the `broker_contract_id` migration (#1)** — stops 164+ errors/hour on `option_contracts`,
   and should lift the option-metadata write failures behind #10's low classification coverage.
2. **Fix the market-data persist worker's 2 failed jobs (#8)** and the `bar_cache` INSERT timeouts
   (#2/#6/#9) — the engine behind the 100% bars cache miss (#9), the `sparklines/seed` 500s (#6), and
   slow `/bars`. Check the statement-timeout vs. batch-insert size, and whether the pool (max 12) needs
   raising or the option_contracts hot-loop (#1) is starving it. (Note: #5 — watchlist % = 0 — is
   already **fixed** independently by seeding `prevClose` from the Massive REST snapshot, so it no
   longer depends on this bar-pipeline repair.)
3. **Decide whether the desktop 401 loop (#4) is expected here** — it alone is ~3/4 of all 4xx and is
   drowning telemetry. If no desktop bridge should be attached, stop the client poll or fix its auth.
4. After #1 + #2, **re-watch**: pool `waiting`, 5xx trend (was climbing 3→16), bars cache hit rate,
   and `prevClose` on `/quotes/snapshot`. Confirm #3 (IBKR-not-configured) is expected for this env.

The process is up and prices stream live, but under sustained HIGH pressure with ~77% of requests
failing and 5xx climbing — this is not a steady state.

**The DB-throughput bottleneck surfaces on every persistence path:** option metadata (#1), bars
(#2/#9), sparkline seed (#6), market-data persist jobs (#8), dropped diagnostics (#7), and now the
**signal-event persist lag (#11)** that leaves the STA table 20+ min behind its own live matrix. These
are the same root viewed from different features — fixing the pool/persist throughput should lift them
together. (#5 watchlist % is already fixed independently.)
