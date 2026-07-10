# WO-PRS-1 report

Status: **DONE**

## Safety gate: `bar_cache` is refetchable

Observed no non-refetchable consumer or writer in the scoped persist path.

- `market-data-store.ts:239-244` explicitly says a missed intraday persist self-heals on the next chart fetch through provider re-fetch, and `recentWindow=0` readers re-fetch through `getBars` on a store miss.
- `platform.ts:11138-11139` states that the foreground response already contains the provider bars and durable storage is only catching up before `queueBarsBackgroundPersist` is called.
- `platform.ts:10937-11008` treats incomplete stored coverage as a reason to fetch provider history; the only production enqueue at `platform.ts:11124-11152` persists that Massive response after it already exists in memory.

Therefore the queue contains best-effort cache writes, not ledger or user-authored state, and oldest-first shedding is safe.

## RSS root cause and live attribution

### Pre-fix mechanism

The RSS was stale, not foreign:

1. `getRuntimeDiagnostics()` sampled `process.memoryUsage()` in the API process before its asynchronous diagnostic work (`platform.ts:3311` in the pre-fix source).
2. `buildApiMetrics()` later read that earlier JSON value from `runtime.api.memoryMb.rss` (`diagnostics.ts:1130-1132,1188`).
3. The pre-fix `buildResourcePressureMetrics()` passed `numeric(api["rssMb"])` into `updateApiResourcePressure` at the pressure-update point (the changed block is now `diagnostics.ts:2779-2786,2853-2857`). This attached a new pressure `observedAt` to an RSS value captured much earlier.
4. The collector nominally runs every 15 seconds, but skips ticks while one collection is in flight (`diagnostics.ts:4975-5012`), so the capture-to-pressure-update gap can grow far beyond 15 seconds under load.
5. The flight recorder proves both values belong to the same process: it samples live `process.memoryUsage()` and tags `process.pid`, then places the cached pressure snapshot beside it (`runtime-flight-recorder.ts:508-525`). There is no foreign PID path.

### Before/after evidence

- Supplied before measurement: pressure `rssMb = 540.2` while API `VmRSS ~= 1,234 MB`.
- The first independent pre-edit live probe could not run: `.pyrus-runtime/flight-recorder/api-current.json` pointed to dead PID 337, `/proc/337/status` did not exist, port 8080 was closed, and no `runDevApp.mjs` supervisor was present. No worker started or signalled the app.
- When the sanctioned supervisor returned on its own, the live API PID was 73370. Closest direct comparison: `/proc/73370/status VmRSS = 1255.1836 MB`; `/api/diagnostics/runtime?detail=compact api.memoryMb.rss = 1255.2 MB`.
- That same response showed cached pressure `rssMb = 1157.2 MB` with `observedAt = 2026-07-10T00:59:34.806Z` and response timestamp `2026-07-10T00:59:59.012Z`. This is an honestly aged periodic snapshot. The fix ensures its RSS is sampled immediately before that `observedAt` is created; it does not claim every later read is a new pressure sample.
- Regression seam: stale runtime JSON `540.2 MB` plus injected live API-process RSS `1,234 MB` produces both diagnostic `rssMb = 1,234` and `getApiResourcePressureSnapshot().inputs.rssMb = 1,234` (`diagnostics-resource-pressure.test.ts:10-32`).

No 5-second heartbeat refresh was added. Calling the shared partial updater from the heartbeat would also advance the existing two-sample hysteresis using stale heap/pool/event-loop inputs, changing pressure semantics outside this work order.

## Implementation

- `platform.ts:9165-9178`: reads `BARS_PERSIST_SHED_QUEUE_DEPTH` dynamically (default 128) and trims FIFO pending entries with `shift()` only when `resourceLevel` is `watch` or `high` and the queue is above the threshold.
- `platform.ts:9181-9244`: extends the existing drain/enqueue pressure mechanism; the existing hard-pressure skip remains intact.
- `platform.ts:9271-9285`: keeps `dropped` as the aggregate and adds reason counter `droppedForPressure`.
- `platform.ts:3357-3368,3671-3683`: full `getRuntimeDiagnostics()` now exposes `api.resourcePressure`; persist queue diagnostics (including `droppedForPressure`) remain under `api.resourceCaches.bars.backgroundPersist`.
- `diagnostics.ts:2779-2786,2853-2857,2913`: samples the current API process RSS at the pressure-update point and returns the same sample in resource diagnostics.

## Regression coverage

- `platform-bars-background-persist.test.ts:168-250`: with concurrency 1 and shed depth 2, an active `HOLD` persist continues, depth 2 drops nothing, the third pending entry drops oldest `A`, `dropped` and `droppedForPressure` increment, and `B`/`C` complete.
- `platform-bars-background-persist.test.ts:365-379`: the ordinary 512-entry cap still drops oldest while `droppedForPressure` remains zero.
- `diagnostics-resource-pressure.test.ts:10-32`: stale runtime RSS cannot override the live API-process sample.

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` -> exit 0.
   - An earlier attempt reached TypeScript but failed in an unrelated, concurrently modified `shadow-account-eqh-demand.test.ts` because its matching implementation had not landed yet. The final scoped-code run passed after that shared edit settled; no out-of-scope file was changed by this worker.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/platform-bars-background-persist.test.ts src/services/diagnostics-resource-pressure.test.ts` -> 7 tests, 7 pass, 0 fail, exit 0.

## Commit

`fix(pressure): shed best-effort bar persists under pressure (was 229 queued); pressure RSS reads the live process (was 540 vs actual 1234) (WO-PRS-1)`

