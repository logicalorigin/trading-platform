# Monday-open verification runbook (2026-07-13)

Everything landed 2026-07-11 (ELU workstream, session `a42afc2e`) was verified on a
closed-market Saturday; Monday's open is the decisive test. Run these checks during
the first hour of the session. Each check names its pass signal and its rollback.

Commits under test: `9ff0b1be` (/state zod drop), `21c51f03` (cell truncation),
`e0d50912` (backfill coarse-first), `b64d7af9` (deployment banner), `afd31574`
(retention chain), plus flags `PYRUS_SIGNALS_STORED_BARS_DELTA=on` +
`PYRUS_SIGNALS_INCREMENTAL_EVAL=on` (`.pyrus-runtime/dev-env.local`).

## 1. The headline: event-loop utilization under market load

- Watch: flight recorder `api-current.json` → `apiPressure.inputs.eventLoopUtilization`
  and `memoryMb.heapUsed`, sampled through 09:30–10:30 ET.
- PASS: ELU stays well below ~0.9 sustained (prior regime: pinned at 1.0 within
  minutes of open); heap not sawtoothing against the 2.7GB ceiling.
- Context: 2026-07-09 market-open profile had busy 95.8%, GC 32.6% of busy.

## 2. Stored-bars cache reuse (never observable on the weekend)

- Watch: `/api/diagnostics/runtime` → `ibkr.streams.signalMonitorLocalBars.storedBarsCache`.
- PASS: `hitCount` > 0 and climbing; `deltaReadCount` > 0;
  `invalidationTruncateCount` >> `invalidationFullCount` during the session;
  `storedBarsDelta.gapFallbacks` a small fraction of `deltaReads`.
- FAIL/rollback: if `storedBarsDelta.shadowMismatches` > 0 (only counts in shadow) or
  served data looks wrong → set `PYRUS_SIGNALS_STORED_BARS_DELTA=shadow` in
  `dev-env.local` + SIGUSR2.

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

## Known residuals (expected, not failures)

- RSS still climbs toward ~2GB: the retained-set shrink (F2) is designed but not
  implemented — census counters (`signalMonitorResidentBars`, `storedBarsCache.barCount`)
  are live to attribute it.
- Host CPU oversubscription (2 cores shared with concurrent agent stacks) inflates all
  latencies regardless of app fixes; statement timeouts under load-15 are environmental.
- The episodic ~54s whole-process stall (one occurrence 07-11 17:31Z) is unexplained;
  if it recurs, the flight recorder memory-sample gap is the signature.
