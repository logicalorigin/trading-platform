# Monday-open verification runbook (2026-07-13)

The retained-bar, PostgreSQL connection, and IBKR market-data retirement changes were
verified under closed-market load on Sunday. Monday's open is the decisive real-market
test. Run these checks from 09:30 through 10:30 ET. Each check names its pass signal
and its rollback or escalation condition.

Current commits under test: `6132abf5` (compact retained bars, physical-connect gate,
and graceful pool shutdown), `0267f80c` and `04cc869b` (advisory-connect race fences),
`250714ae` (resident-census test isolation), and `89c32762` (IBKR quote-line retirement).
Earlier July 11 commits and the `PYRUS_SIGNALS_STORED_BARS_DELTA=on` and
`PYRUS_SIGNALS_INCREMENTAL_EVAL=on` flags remain in scope.

Sunday matched baseline after a sanctioned reload: 3,126,180 stored bars in 8,000
cells; `compactBarCount` exactly matched `barCount`, `objectBarCount` was zero, and
`compactBytes` was 150,056,640. Post-fill heap cycled between about 1.41 and 1.92 GB,
ELU between about 0.32 and 0.81, and event-loop p95 between about 39 and 152 ms. The
old failure at the same bar count was about 2.46 GB heap, ELU near 1.0, about 1,812 ms
event-loop p95, then OOM.

## 1. The headline: event-loop utilization under market load

- Watch: flight recorder `api-current.json` → `apiPressure.inputs.eventLoopUtilization`
  and `memoryMb.heapUsed`, plus `/api/diagnostics/runtime` → `api.eventLoopDelayMs`,
  sampled through 09:30–10:30 ET.
- PASS: ELU is not sustained near 0.9–1.0, event-loop p95 does not return to a
  sustained >1s regime, heap continues to reclaim between evaluation waves, and the
  process does not approach the old 2.46 GB heap/OOM signature.
- Context: 2026-07-09 market-open profile had busy 95.8%, GC 32.6% of busy.

## 2. Compact stored-bars retention and reuse

- Watch: `/api/diagnostics/runtime` → `ibkr.streams.signalMonitorLocalBars.storedBarsCache`.
- PASS: `barCount === compactBarCount`, `objectBarCount === 0`, `hitCount` and
  `deltaReadCount` continue climbing, and
  `invalidationTruncateCount` >> `invalidationFullCount` during the session;
  `storedBarsDelta.gapFallbacks` a small fraction of `deltaReads`.
- Also watch `ibkr.streams.signalMonitorResidentBars.completedBarsCache`; it must be
  present so the census accounts for completed-bar retention outside the stored cache.
- FAIL/rollback: if `storedBarsDelta.shadowMismatches` > 0 (only counts in shadow) or
  served data looks wrong, first set `PYRUS_SIGNALS_STORED_BARS_DELTA=shadow` in
  `dev-env.local` and use the sanctioned SIGUSR2 reload. If compact/object parity
  itself fails, capture the full diagnostic before using the normal reviewed revert
  workflow for `6132abf5`.

## 3. Incremental evaluator parity (first real engagement Monday)

- Watch: same endpoint → `signalMonitorIncrementalEval`: `seeds`/`appends` should start
  counting at the first bar closes; `shadowMismatches` (the 1-in-500 on-mode self-check)
  and `matrixServeMismatchCount` must stay ~0.
- FAIL/rollback: mismatches climbing → `PYRUS_SIGNALS_INCREMENTAL_EVAL=shadow` + SIGUSR2.
  (The 35 serve-mismatches on the 07-10 process remain unexplained — if they recur,
  capture `lastMatrixServeMismatchCellKey` before rolling back.)

## 4. 1h/1d repopulation (the STA mixed-MTF fix)

- The coarse-first backfill only runs when the producer sees aggregates (quiet-producer
  gate), so its first real run is Monday pre-open/open.
- Check after ~15–30 min of session:
  `SELECT timeframe, count(DISTINCT symbol) FROM bar_cache WHERE timeframe IN ('1h','1d') GROUP BY 1`
  — PASS: symbol counts climbing well past 3 (ratchet: each process lifetime adds more).
- Then eyeball the STA table: 1h/1d lanes should stop showing mixed/contradictory MTF
  alignment as their history fills.
- Watch the provider-fetch load while the 1d group warms (2,000 symbols × 240 daily
  bars): `resourceCaches.bars.hydration.providerFetch` rate and API pressure. Fetches
  are concurrency-3 per group and stop recurring once rows persist.

## 5. Deployment banner

- The Algo screen through the open: banner may still flash during genuine outage
  windows (reloads) but must recover on its own within ~2 poll intervals.
- Server side: `GET /algo/deployments` p95 in `api-current.json` `requests.topRoutes`
  should sit far below 20s (execution_events is now 18k live rows; PnL attach is
  bounded at 4s).

## 6. Retention keeps running

- `rg '"snapshot-retention-sweep"' .pyrus-runtime/flight-recorder/api-events-<date>.jsonl`
  — PASS: events present every ~6h per surviving process, `error: null` on most tables.
  `signal_monitor_events` may report a timeout error under load; that is isolated by
  design and self-heals when load drops.
- Owner follow-up (Riley, manual, per `execution-events-reclaim-runbook-2026-07-09.md`):
  `VACUUM (FULL, ANALYZE) execution_events;` outside RTH — live set is now ~18k rows,
  physical file still ~3.4GB until then.

## 7. PostgreSQL physical connections stay bounded

- Watch `/api/diagnostics/runtime` → `api.resourcePressure.inputs.dbPoolActive`,
  `dbPoolWaiting`, and `dbPoolMax`. Correlate with established API-process sockets:
  `lsof -nP -a -p "$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t | head -1)" -iTCP -sTCP:ESTABLISHED | awk 'NR==1 || $9 ~ /:5432/'`.
- Sunday evidence: the old API's 14 PostgreSQL sockets fell to zero during the
  sanctioned reload; the new process started with 2, peaked at 15 during hydration,
  and settled to 7–13 with no sustained pool waiters.
- PASS: no sustained `dbPoolWaiting`, no unbounded established-socket growth, and a
  transient SQLSTATE `53300` produces backoff/one-probe behavior rather than a
  reconnect storm. Existing idle pool clients must remain usable while the gate is open.
- Escalate before changing limits: capture the runtime diagnostic, API PID socket list,
  and the first nested `53300` error. Do not respond by increasing pool sizes.

## 8. Massive owns quote data; IBKR remains trading/session only

- Watch `/api/diagnostics/runtime` → `ibkr.streams.marketDataAdmission`. The `ibkr`
  container name is retained for diagnostic compatibility; active quote admission is
  for Massive option streams.
- PASS: no lease owner contains `watchlist-prewarm`, `bridge-startup`, account-monitor
  equity snapshots, shadow-equity snapshots, or signal-options contract selection.
  `pressure.ibkrPressure` and `pressure.scannerPressureLineCap` stay `null`, and
  `pressure.scannerPressureDampingActive` stays `false`.
- Massive flow coverage must keep refreshing after transient database failures. Watch
  `optionsFlowScanner.coverage`: `coverageHealth` should remain `healthy` and
  `cycleScannedSymbols` should advance during the open. Sunday reached 92 of 755 with
  an estimated 47.25-minute cycle before off-hours work stopped advancing; Monday
  should provide the first full-cycle acceptance window.
- IBKR account, order, execution, and session reads must remain healthy. Do not remove
  their `ibkr-bridge` source values.

## Known residuals (expected, not failures)

- Full-cache hits still materialize temporary bar and `Date` objects for consumers.
  Sunday showed collectible heap sawtoothing, so monitor ELU/GC rather than treating
  every short heap peak as retained growth.
- `compactBytes` counts typed-array payload bytes, not all cache metadata overhead;
  use it with heap/RSS and the resident-bar census rather than as total memory.
- Two option-data SSE `ready` events still emit `source: "ibkr-bridge"` as a public-wire
  compatibility token even though their producers are Massive-backed. Changing this
  ambiguous `source` semantic requires an explicit product decision. Stock quote SSE
  already reports `massive`; account/order/execution values remain correctly IBKR.
- Host CPU oversubscription (2 cores shared with concurrent agent stacks) inflates all
  latencies regardless of app fixes; statement timeouts under load-15 are environmental.
- The episodic ~54s whole-process stall (one occurrence 07-11 17:31Z) is unexplained;
  if it recurs, the flight recorder memory-sample gap is the signature.
