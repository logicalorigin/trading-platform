# Throttle/cap/shed audit - 2026-07-07

Auditor: `codex-worker` for `claude-lead`
Mode: investigation only. Read source, tests, git blame/log, and one read-only Postgres query. No code changes or commits.

## Executive findings

Observed: the old low-memory complaint is fixed in current source. `resolveApiRssPressureThresholds()` scales cgroup memory >=8GB to watch=37.5% and high=50% (`artifacts/api-server/src/services/resource-pressure.ts:246`, `:258-261`). On a 16GB microVM that is ~6144/8192 MB. The cgroup-derived path dates to `97287dc4` (2026-05-28), the current percentages to `90eb7a06` (2026-06-03), and diagnostics' old fixed 1.5GiB RSS warning was explicitly removed in `d2114c1f` (2026-06-15) (`runtime-flight-recorder.ts:620-633`).

Observed: current route admission does set `Retry-After` for sheds (`route-admission.ts:514-519`): 15s under high pressure and 30s in safe-QA (`:191-218`). The older "429 has no Retry-After" statement is stale for current source.

Observed: current Pyrus signal sparkline seed retries are capped and Retry-After-aware. `fetchSparklineSeed()` parses `retry-after` (`MarketDataSubscriptionProvider.jsx:283-287`), signal seed retries at most twice and uses that delay (`:839-856`), and the shared parser/default retry delay landed across `queryDefaults.js:17-55` in `7fcf8b50`. The seed-specific delay path is blamed to `7159cb2a`. Market sparkline seed has `retry:false` (`MarketDataSubscriptionProvider.jsx:767-788`). Therefore the live 100-200ms 429 bursts are not explained by a single current-source React Query tight retry loop; likely causes are multiple clients, query-key churn, or a live process older than current source.

Observed conflict: comments in `resource-pressure.ts:97-102` say ELU does not affect scan gating, but `getOptionsFlowScannerPressureGate()` consumes all pressure drivers except `automation` and `api-latency` (`platform.ts:1331-1362`), and tests assert ELU watch/high throttles the scanner to effectiveConcurrency=1 and lineBudget=32 (`options-flow-scanner-pressure.test.ts:63-109`). Treat code/tests as authoritative: ELU throttles the scanner today.

Observed: the scanner lag is directly man-made. With plannedHorizonCount=755, batchSize=4, intervalMs=15000, current cycle is `ceil(755/4)*15000 = 2,835,000ms = 47.25m` (`platform.ts:12445-12460`, `:12569-12694`). Retuning normal scanner cadence to batchSize=16 and intervalMs=5000 would make the same horizon 240,000ms = 4.0m, but that should wait until CPU/DB root fixes land because current live pressure is ELU 100% and DB pool 12/12 + 16 waiting.

Observed DB fact: `SHOW max_connections` returned `112`; role connection limit is `-1` (unlimited). The app's pool max 12 is a deliberate policy, not a Postgres/server cap (`lib/db/src/index.ts:194-206`).

## Recommendation order

### Safe to change now

1. Do not remove or loosen the main finite-resource sheds while live DB pressure is 12/12 active + 16 waiting. Current sheds save downstream route DB/cache work; removing them would route retry bursts into the exact constrained resource.
2. Verify deployment parity for Retry-After and client retry handling. Current source has both; if live traffic still shows 100-200ms repeats from the same client after a 429 with `Retry-After: 15`, the active build or request source is not matching current source.
3. Treat `/api/sparklines/seed` shed amplification as a client/server contract issue, not as "remove the shed now." Current fix seam is already present: server `Retry-After` + client honor. If bursts continue on current build, next seam is to stop key churn/duplicate clients or return a non-retry result for seed sheds.

### Change only after CPU/DB root fixes land

1. Retune scanner normal cadence from batchSize=4/interval=15000 to batchSize=16/interval=5000. Current 47.25m cycle becomes 4.0m for 755 names. Keep high-pressure cap at concurrency=1/lineBudget=32 until live ELU and pool waiters are stable.
2. Split scanner pressure caps by watch vs high. Current single pressure cap makes even ELU watch throttle to 1/32. Proposed behavior after root fixes: watch -> concurrency 2, lineBudget 64; high -> keep 1/32.
3. Bars cache: raise `BARS_CACHE_MAX_ENTRIES` from 4096 to 8192 as a first step only after memory and DB churn are stable. Current 4096 was sized for ~3k working set; a 2000-symbol x 6-timeframe workload can exceed it.
4. Signal-monitor: raise worker history fallback batch 48 -> 96 after ELU/DB headroom, then size the stream completed-bars cache from 8000 to at least 12288 if memory allows. Do not raise `SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT` above 2000 until bounded-active-set/worker-offload work exists.
5. DB pool: keep 12 now. After query/result parsing fixes, test `DB_POOL_MAX=16` only if ELU is below ~70%, pool waiting persists, and foreground p95 improves. Server capacity (112) is not the limiting fact; Node result parsing is.
6. Background persist/write caps: consider bars background persist 1 -> 2 and option-chain batch concurrency 1 -> 2 only after pool waiters are consistently zero under RTH load.

No REMOVE-now candidate was found. Every current source-level restriction either protects a live saturated resource or has a cited prior incident behind it. The main stale items are sizing/cadence values that became too small for the 2000-symbol/16GB world, not guards that can be deleted safely today.

## Resource pressure thresholds and consumers

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| RSS fallback 3072/4608 MB plus cgroup scaling to 37.5%/50% for >=8GB | `resource-pressure.ts:80-83`, `:246-265` | cgroup scaling from `97287dc4`; current percentage values from `90eb7a06`; fixed 1.5GiB diagnostics warning removed by `d2114c1f` (`runtime-flight-recorder.ts:620-633`) | 16GB host watches at ~6144MB and high at ~8192MB; live high is not old 1.4GB memory shed | KEEP |
| Heap watch/high 70%/80% | `resource-pressure.ts:362-365` | Generic finite-memory guard; participates in `resourceLevel` and `hardResourceLevel` | No live evidence that heap is dominant; still finite-resource protection | KEEP |
| API route latency 1000ms/10000ms | `resource-pressure.ts:84-85`, `:268-271`, `:455-460` | `b44bc105`; kept as visibility only. Tests prove latency driver does not raise saturation or hard-block (`resource-pressure.test.ts:10-39`) | Live `/diagnostics/client-metrics` p95 25562ms raises `api-latency` driver, but does not trigger admission/trading hard block | KEEP |
| Event-loop delay 150ms/400ms | `resource-pressure.ts:86-96`, `:274-277`, `:373-375`, `:408-423` | `0dfa3376`; old 60ms watch was below healthy baseline and 1-3s bar-cache freeze needed a real high line | Live 1337ms is high; drives `resourceLevel` after 2 samples and gates scanner/backfill/shadow/readiness, not route sheds | KEEP |
| ELU watch/high 0.75/0.90 | `resource-pressure.ts:97-106`, `:280-285`, `:400-407` | `8bbfd5e8`; catches CPU saturation that delay misses | Live 100% marks headline high and throttles scanner via `platform.ts:1331-1362`; not used by route admission/hardResourceLevel | KEEP signal; RETUNE scanner consumption after root fixes |
| DB pool high if waiting>=6 and active>=max | `resource-pressure.ts:288-314` | `bc9aa7d7`; avoids flapping on normal shallow fan-out while treating half-pool queue as real saturation | Live 12/12 + 16 waiting is high and, after 2 samples, hardResourceLevel high | KEEP now |
| 2-sample high enter/exit hysteresis | `resource-pressure.ts:109-130`, `:408-435`; tests `resource-pressure.test.ts:96-119`, `:223-276` | `d3685e34` and `0c284e27`; prevents single-sample RSS/pool freeze | High finite-resource pressure needs roughly two 15s samples before hard blocking | KEEP |
| `level` vs `resourceLevel` vs `hardResourceLevel` split | `resource-pressure.ts:13-33`, `:390-435`, `:594-607` | `5e05a3bd`, `8bbfd5e8`, `0c284e27`; CPU x-ray found DB row parsing/GC, not scan bodies, as ELU blocker | Route sheds use hard finite resources only; scanner/backfills use broader pressure; headline includes ELU | KEEP |
| Client/cache pressure capped at watch | `resource-pressure.ts:384-387`, `:496-508` | Prevents client/cache telemetry from becoming a hard server gate | Can make headline watch but not hard shed | KEEP |
| Automation long-scan pressure | `resource-pressure.ts:388-389`, `:512-520` | Scanner-specific visibility | Flow scanner gate explicitly ignores `automation` driver (`platform.ts:1346-1354`) | KEEP as diagnostic |

Primary pressure consumers found:

- Route admission sheds lower-priority classes on `hardResourceLevel` high (`route-admission.ts:471-493`).
- Scanner throttles on non-normal pressure drivers except `automation`/`api-latency` (`platform.ts:1331-1362`).
- Bars stale background refresh skips at `resourceLevel === "high"` unless priority >=8 (`platform.ts:9318-9343`).
- Option chain batch yields on hardResourceLevel non-normal, any DB waiter, or active>=max (`platform.ts:11101-11120`).
- Option metadata durable writes skip on hardResourceLevel non-normal, any DB waiter, or active>=max (`option-metadata-store.ts:152-170`).
- Signal monitor backfill skips at `resourceLevel === "high"` (`signal-monitor.ts:5066-5073`, `:5160-5175`).
- Diagnostics event DB persist skips at `resourceLevel === "high"` (`diagnostics.ts:3188-3211`).
- Signal-options and overnight workers degrade entry work under `isApiResourcePressureHardBlock()` (`signal-options-worker.ts:733-749`, `overnight-spot-worker.ts:448-466`).
- Shadow positions serve stale/fast fallback at `resourceLevel === "high"` (`shadow-account.ts:8648-8800`, `:9461-9466`).
- Readiness degrades at `resourceLevel === "high"` (`readiness.ts:196-203`).
- Signal-options performance uses `level !== "normal"` for pressure fallback (`signal-options-automation.ts:11281-11423`).
- Runtime flight recorder records pressure snapshots/events but takes no action (`runtime-flight-recorder.ts:511-525`, `:638-700`).

## Route admission and sparkline seed amplification

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Route classes and visible/deferred request family rules | `route-admission.ts:7-18`, `:98-179`, `:252-397` | `3c122e86` safe-QA/admission base; `e8d784d9` preserved visible reads | `fetchPriority >=8` is visible unless passive/deferred family; chart families visible at priority>=6; passive sparkline remains non-visible | KEEP |
| Safe-QA shed set | `route-admission.ts:191-204` | `3c122e86`; browser QA safety | safe-QA sheds live-data, stream, decorative, deferred-analytics, background-maintenance; decorative is 204, others 429, Retry-After 30s | KEEP |
| High-pressure shed set | `route-admission.ts:207-218` | `e8d784d9`; preserve visible reads | hardResourceLevel high sheds only decorative/deferred-analytics/background-maintenance; Retry-After 15s | KEEP now |
| `/sparklines/seed` forced deferred | `route-admission.ts:278-283`; test `route-admission.test.ts:308-322`, `:377-392` | `0c284e27`; seed is background hydration, live rows use `/bars` | Live seed request is shed under DB hard pressure even with `requestFamily=signal-sparkline-seed`, `fetchPriority=6` | RETUNE after root fixes |
| Route shed headers | `route-admission.ts:497-519` | `d3685e34` added `Retry-After`; `0c284e27` aligned actionable pressure headers with hardResourceLevel | Current source returns `X-Pyrus-Route-Class`, pressure headers, and `Retry-After` | KEEP; verify deployed |

What the shed saves: for `/api/sparklines/seed`, admission returns before `loadSparklineSeedBarsBySymbol()` and avoids historical `bar_cache` reads (`routes/platform.ts:2446-2483`). That saves the constrained DB pool and Node row parsing.

What the shed costs: every 429 still burns request parsing, classification, pressure snapshot lookup, response serialization, client handling, and possible retry. If the client ignores `Retry-After` or remount/key churn creates new seed queries, the shed becomes an amplification loop. Current source has the Retry-After seam; live evidence should be checked against response headers and deployed commit.

## Sparkline seed caps

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Server seed max symbols 600, DB batch 4, DB concurrency default 1 | `routes/platform.ts:736-746` | `0c284e27`; runtime evidence found 31-32 symbol chunks took 10s+ and composed client/server concurrency saturated the 12-slot pool | Admitted seed request serializes DB backfill globally via `runSparklineSeedDbBackfill()` (`:968-981`) | KEEP now |
| Server seed cache 5m, max 16000, in-flight 128 | `routes/platform.ts:911-922`, `:1062-1075` | `e2d481c9`, `8fa630fd`, `0c284e27`; prevent repeated page/tab/client seed passes over hot `bar_cache` | Coalesces identical in-flight requests and caches historical backfill; live edge comes from in-process local bars | KEEP |
| Server seed uses history only for DB backfill | `routes/platform.ts:1148-1167` | `0c284e27`; reading websocket live edge back from `bar_cache` made seed dominant slow route | Reduces admitted seed load but still expensive when cache cold | KEEP |
| Client market seed chunk 96 and no retry | `MarketDataSubscriptionProvider.jsx:767-788` | existing BARS defaults plus explicit `retry:false` | Market seed cannot tight-loop retries after shed | KEEP |
| Client signal seed concurrency 1 | `MarketDataSubscriptionProvider.jsx:80-84`, `:302-347` | `0c284e27`; one seed POST in flight so this path cannot multiply DB readers | A single client signal seed serializes chunks | KEEP |
| Client signal seed Retry-After-aware retry max 2 | `MarketDataSubscriptionProvider.jsx:249-256`, `:283-287`, `:839-856`; `queryDefaults.js:17-55` | `7159cb2a` seed-specific; `7fcf8b50` shared query defaults / STA recovery | Current source waits server Retry-After on 429 and caps retries; not a tight loop | KEEP; verify live build |

## Scanner caps

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Interval 15000ms | `platform.ts:11287-11290` | `b65202c3` original scanner runtime | With 755 names and batch 4, cycle is 47.25m | RETUNE after root fixes |
| Batch size 4 | `platform.ts:11376-11379` | default changed in `0c284e27`; comment at `:11380-11382` says Massive source still burns API loop during startup/RTH | Direct source of 47m horizon | RETUNE after root fixes to 16 |
| Default concurrency 2, max 4 | `platform.ts:11380-11387`; scanner service `options-flow-scanner.ts:138-141` notes a prior 2->8 bump (`337cb24`) overwhelmed shared DB/IB tunnel | Protects DB and loop; current effectiveConcurrency is lower due pressure | KEEP now |
| Pressure concurrency 1 and pressure line budget 32 | `platform.ts:11364-11371`, `:11504-11553`; tests `options-flow-scanner-pressure.test.ts:36-109` | `0c284e27`; avoid scanner adding loop/DB load under pressure | Live ELU high forces effectiveConcurrency=1 and maxDeepScanLines=32 | KEEP high cap; split watch/high later |
| Scanner gate ignores latency but not ELU | `platform.ts:1331-1362` | `0dfa3376` ignored api-latency because slow broker route cannot be relieved by scans; `0c284e27` made non-normal drivers throttle | Live api-latency does not throttle scanner, but ELU watch/high does | RETUNE consumption after root fixes |
| Coverage health target 5m | `platform.ts:2013-2030`, `:12667-12677` | Intended active target coverage | Current 47m marks lagging | KEEP target |
| Cycle estimator | `platform.ts:12445-12460` | diagnostic math | Confirms live cycle and retune math | KEEP |

Retune math for current 755 symbols:

- current 4/15000: 2,835,000ms = 47.25m.
- proposed 16/5000: 240,000ms = 4.00m.
- less aggressive 16/6000: 288,000ms = 4.80m.
- keeping 15000ms would require batch 40 for 285,000ms = 4.75m, which creates burstier work.

## Signal-monitor caps

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Max symbols limit 2000 | `signal-monitor.ts:500-504` | `d40afa47`; raised 500->2000, comments say scaling further needs bounded-active-set + pg-decode worker offload | Prevents full catalog expansion; protects memory and 12-conn DB pool | KEEP now |
| Completed bars cache TTL/stale 30s, max 3072 | `signal-monitor.ts:445-464`, prune `:6813-6831` | `d40afa47`; re-enabled after state-model repair, serve-side freshness check prevents stale bars | 3072 covers old ~500x6 working set, not 2000x6; under 2000 scope it can evict/reload | RETUNE only with bounded active set/after ELU fixes |
| Serve-side freshness margin 2000ms | `signal-monitor.ts:452-457`, `:6898-6920` | `d40afa47`; cache refused when a newer completed bar must exist | Prevents TTL from serving old closed bucket | KEEP |
| Stream flush 300ms, idle flush 3000ms | `signal-monitor.ts:472-485`, `:9925-10007` | `42f47e7b` reduced 150->300; `34d54d98` added 3000ms idle cadence | Real subscribers get ~300ms; server-owned/idle producer coalesces 3s | KEEP |
| Evaluation concurrency default 6, cap 10 | `signal-monitor.ts:508-514`, worker `signal-monitor-evaluation-worker.ts:352-357` | `337cb24`; bound eval fan-out | Helps protect DB; lengthens rotation | KEEP now |
| Worker history fallback batch 48 | `signal-monitor-evaluation-worker.ts:35-38`, `:226-231`, `:314-322` | `8e2e6acc`; bounded trade/signal monitor history fallback | 2000 scoped symbols require ~42 batches; best case ~210s plus work | RETUNE after root fixes to 96 |
| Backfill refresh cadence, concurrency 3, warmed cap 64 | `signal-monitor.ts:4971-4991`, processing `:5214-5235` | `783fe06e`, `d40afa47`; backfill is off-path and must not crowd eval/chart serving | Under high pressure, coverage can lag because warmed cells trickle and pressure skip blocks cycles | KEEP now |
| Shared background DB gate default 6 | `signal-monitor.ts:4998-5012` | `91df94c0`; backfill(3)+persist(6)=9 of 12 caused active 12/waiting 4 | Reserves foreground DB headroom | KEEP |
| Backfill pressure skip | `signal-monitor.ts:5066-5073`, `:5160-5175` | `783fe06e`; backfill is getBars load that feeds pressure | Live high pressure stops deep-history refresh | KEEP now |
| Stream completed-bars cache max 8000 | `signal-monitor.ts:7846-7872`, use `:9118-9178` | `e2d481c9`; avoids repeated per-cell bar aggregation; `d40afa47` replaced clear-on-overflow with LRU | 2000x6 = 12000 cells, so 8000 evicts ~4000 cells | RETUNE after root fixes to >=12288 if memory OK |
| Local bar cache retention 72h, max cells 30000, prefetch concurrency 1, target rows/query 480, persist flush 5000ms | `signal-monitor-local-bar-cache.ts:57-83`, `:184-217`, `:758-767`, `:1127-1258` | `0c284e27`; 30000 covers 2000*6*2 cells, concurrency 1 yields to foreground, row budget avoids slow high-limit chunks, mixed flush reduces write fan-out | Keeps local bar cache from evicting its loaded universe; slow to prefetch under pressure | KEEP now; concurrency retune after root fixes |

## Bars, option-chain, and cache caps

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| `/api/bars` TTL 30s, stale TTL 10m | `platform.ts:8978-8983` | original coalescing; upstream history slot can hold 7-15s | Live default matches supplied ttlMs=30000/staleTtlMs=600000 | KEEP |
| Completed bars TTL 10m | `platform.ts:8984-8992` | `0c284e27`; 30s live TTL gave ~0% hit rate for completed 5m revisits | Closed buckets can be reused and avoid provider/CPU load | KEEP |
| Bars maxEntries 4096 | `platform.ts:8993-8999` | `0c284e27`; 1024 evicted old ~3k working set before reuse | For 2000x6-like use, can still eviction-thrash | RETUNE after root fixes to 8192 first |
| Background stale refresh skip at `resourceLevel=high`, min priority 8 | `platform.ts:9012-9014`, `:9318-9343`, counter `:9957-9980` | `de481871`, `9c9d5ac`; background chart refresh should yield under pressure | Live `backgroundRefreshPressureSkipped=27`; lower-priority stale refreshes stop under high | KEEP now |
| Bars background persist concurrency default 1, max 4 | `platform.ts:9055-9077`, enqueue `:10921-10937` | `0c284e27`; closed buckets persist in background without hammering DB | Live backgroundPersist concurrency 1 | RETUNE after DB fixes to 2 if queue grows |
| Option chain cache TTL/stale and max 128 | `platform.ts:11228-11273` | original option-chain cache | Limits chain memory; no direct live evidence of bad eviction | KEEP |
| Option chain batch concurrency 1 | `platform.ts:11274-11277` | `0c284e27`; batch path is background/deferred | Slows batch chain hydration but preserves pool | KEEP now |
| Option chain batch pressure yield | `platform.ts:11101-11120`, consumers `:16148`, `:16259` | `0c284e27`; avoid batch work when hard resources or DB waiters exist | Under live 16 waiters, batch yields | KEEP now |

## DB pool

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Pool max 12 on helium, 10 elsewhere | `lib/db/src/index.ts:194-210`, pool config `:230-254` | `a445b909` raised from 6; `e0df391d` corrected comment: 12 is deliberate app policy, not provider cap. Bigger pool piles result parsing onto one Node loop | Live pool saturates at 12/12 + 16 waiting; app cap is binding but protects ELU | KEEP now; experiment 16 later |
| Statement timeout 15s on helium | `lib/db/src/index.ts:222-229`, config `:244-251` | `fdce8949`; stalled query pins scarce connections and causes acquire timeouts | Releases pathological long queries; above normal writes and historical GET /bars p95 cited in comment | KEEP |
| Pool stats no connection | `lib/db/src/index.ts:494-522` | `c4ba2e52`; observability of active/waiting | Pressure sampling does not acquire a DB connection | KEEP |

Read-only DB query result:

```json
{
  "max_connections": "112",
  "role_connection_limit": -1,
  "current_user": "postgres",
  "host": null
}
```

Conclusion: DB pool 12 is man-made and current, but not stale enough to remove. It is a queueing cap around a single-thread Node/result-parsing bottleneck.

## Diagnostics self-instrumentation

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Diagnostics collector every 15000ms; request window 5m | `diagnostics.ts:203-213`, start `:4724-4753` | original diagnostics cadence | Pressure snapshots and API p95 are computed every 15s | KEEP |
| In-memory snapshots/events 2000/500 | `diagnostics.ts:213-218` | original memory bounds | Keeps latest diagnostics available even when DB writes skip | KEEP |
| History/events/export caps by pressure | `diagnostics.ts:220-247`, normalizer `:3395-3420` | `a91fa797`; later reads current pressure from `15d3c10e` | Live high caps events at 150 (`pressureLimited:true`), matching supplied evidence | KEEP |
| Diagnostic snapshot DB persist | `diagnostics.ts:3120-3135`, collect `:4317-4319` | source inserts snapshots as one statement | Snapshots still persist unless DB errors; not pressure-skipped in this function | KEEP |
| Diagnostic event DB persist skip under high resourceLevel | `diagnostics.ts:3188-3211` | `15d3c10e`; avoid write-storm feedback loop when DB is overloaded | Event kept in memory + flight recorder, not DB, while high | KEEP |
| Client metrics post every 30s | `performanceMetrics.ts:16-20`, `:485-515`; Diagnostics screen also posts every 30s while active (`DiagnosticsScreen.jsx:353-361`, `:1003-1018`) | frontend diagnostics cadence | Live dominant slow route was `POST /diagnostics/client-metrics` p95 25562ms; route class is active-screen and not admission-shed (`route-admission.ts:347-365`) | KEEP caps; investigate route cost separately |

Diagnostics does back off its heavier reads and event DB persistence under the pressure it measures. It does not shed `/diagnostics/client-metrics`; that route can still be a slow-route driver, but request latency is visibility-only and does not hard-block work.

## Other pressure-gated skips and fallbacks

| Restriction | Source | Why added / blame | Current live effect | Verdict |
|---|---|---|---|---|
| Durable option metadata write max concurrency 1, batch 128 | `option-metadata-store.ts:106-113` | `0c284e27`; option metadata writes are background | Live `writeSkippedPressure=160` means writes are being withheld under pressure | KEEP now |
| Durable option metadata skips on hardResourceLevel non-normal, any waiter, or pool full | `option-metadata-store.ts:152-170` | `0c284e27`; avoid background writes competing for scarce pool | With 16 waiters, skips are correct; the any-waiter part may be conservative later | KEEP now; retune later |
| Signal-options worker positions-only degrade under hard block | `signal-options-worker.ts:733-749` | `0c284e27`; full pause left positions unmanaged and did not return loop time | Entry work skipped only under finite-resource hard block; exits/marks continue | KEEP |
| Overnight spot worker exit-only degrade under hard block | `overnight-spot-worker.ts:448-466` | `0c284e27`; full pause left longs unmanaged | Entry work skipped under finite-resource hard block | KEEP |
| Shadow stale/fast fallback under resourceLevel high, last-known stops cap 1000 | `shadow-account.ts:8648-8800`, `:9448-9470` | `ce8393be`, `2fb4501b`; older `level != normal` fallback blanked SL/TRL nearly constantly | Under live resource high, canonical heavy build may be skipped, but stop fields should be preserved from last-known cache | KEEP |
| Signal-options performance pressure fallback on `level !== normal` | `signal-options-automation.ts:11281-11423` | `0c284e27`; avoid heavy performance payload under pressure while background refresh starts | Because `level` includes ELU, current ELU high can serve cache/cold fallback | RETUNE after root fixes; do not loosen now |
| Readiness degraded on `resourceLevel === high` | `readiness.ts:196-203`, `:240-247` | readiness should expose server saturation | Live resource high marks app degraded | KEEP |
| Bridge option quote stream schedules refresh on pressure changes | `bridge-option-quote-stream.ts:1190-1194` | keep demand/pressure state fresh | Does not shed; can schedule refresh when demand exists | KEEP |
| Runtime flight recorder RSS/DB pressure events | `runtime-flight-recorder.ts:638-700` | observability only; RSS warning aligned to cgroup threshold | Records memory/db pressure no more than once per minute while active; no behavior gate | KEEP |

## Final verdict summary

KEEP now:

- Route admission finite-resource shed.
- DB pool 12 and statement timeout.
- Sparkline seed server concurrency/cache and client retry cap.
- Signal-monitor max symbols 2000, background DB gate, high-pressure backfill skip.
- Bars stale refresh pressure skip and option-chain/metadata pressure skips.
- Diagnostics pressure caps and DB-persist skip.
- Worker degrade-to-exit/positions-only behavior.

RETUNE after CPU/DB root fixes:

- Scanner normal cadence: batch 4/15s -> 16/5s.
- Scanner watch pressure behavior: split watch from high instead of throttling all non-normal pressure to 1/32.
- Bars max entries: 4096 -> 8192 first.
- Signal monitor history fallback: 48 -> 96.
- Signal stream completed-bars cache: 8000 -> >=12288 if memory is acceptable.
- Background write/persist concurrency: only after pool waiters are consistently zero.
- DB pool: test 16 only after row parsing/query demand is reduced.

REMOVE:

- None recommended from current source. Removing the main guards under the supplied live pressure would plausibly recreate verified incidents: DB pool starvation, bar-cache/provider storms, stale/blank signal surfaces, and unmanaged trading positions.
