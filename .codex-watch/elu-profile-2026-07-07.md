# ELU profile - 2026-07-07

Profiler: `codex-worker` for `claude-lead`

## Profile method

Observed API PID: `140510`.

- `pgrep -f 'dist/index.mjs'` returned `1247`, `1551`, `21037`, `140510`.
- `/proc/140510/cmdline` was `/nix/store/.../node --enable-source-maps ./dist/index.mjs`.
- `.pyrus-runtime/flight-recorder/api-current.json` reported `"pid": 140510`.
- `140510` was the hot process: `ps` showed `MainThread` at 46.9% before profiling and 48.2%, 52.5%, 56.2% during profiling.
- Sent the only allowed signal: `kill -USR1 140510`.
- Inspector endpoint: `ws://127.0.0.1:9229/01ea86b5-8b63-4ffe-8360-cacf126124b1`.
- Captured a 45s V8 CPU profile via inspector `Profiler.enable`, `Profiler.start`, `Profiler.stop`.
- Profile file: `/tmp/api-elu-2026-07-07.cpuprofile`, 1.5 MB.
- Source mapping: `artifacts/api-server/dist/index.mjs.map`.

In-window pressure samples:

| Time UTC | MainThread CPU | `apiPressure.level` | `resourceLevel` | `hardResourceLevel` | Drivers | Heap / limit |
|---|---:|---|---|---|---|---:|
| 16:49:55 | 48.2% | high | high | high | ELU 98%, DB pool 12/12 active + 25 waiting, latency watch | 1045.6 / 2752 MB |
| 16:50:14 | 52.5% | high | watch | watch | ELU 94%, DB pool 12/12 active + 10 waiting, latency watch | 758.2 / 2752 MB |
| 16:50:32 | 56.2% | high | watch | watch | ELU 94%, DB pool 12/12 active + 10 waiting, latency watch | 618.6 / 2752 MB |
| 16:53:33 | not in profile window | high | normal | normal | ELU 98%, latency watch | 838.0 / 2752 MB |

## Top self-time frames

Total sampled time: 46.6s. Percentages are V8 self-time, source-mapped where possible.

| Rank | Self % | Self ms | Function | Source |
|---:|---:|---:|---|---|
| 1 | 11.96 | 5573.7 | `(idle)` | V8 |
| 2 | 9.11 | 4242.3 | `(garbage collector)` | V8 |
| 3 | 8.44 | 3932.9 | `_parseRowAsArray` | `node_modules/pg/lib/result.js:50` |
| 4 | 3.33 | 1549.5 | `signalMonitorMatrixStreamStateSignature` | `artifacts/api-server/src/services/signal-monitor.ts:9246` |
| 5 | 3.14 | 1463.3 | `lruCacheTouch` | `artifacts/api-server/src/services/signal-monitor.ts:7861` |
| 6 | 2.84 | 1323.0 | `fingerprintSignalMonitorMatrixCompletedBars` | `artifacts/api-server/src/services/signal-monitor.ts:7919` |
| 7 | 2.61 | 1217.9 | `handleRawMessage` | `artifacts/api-server/src/services/massive-stock-websocket.ts:410` |
| 8 | 2.34 | 1089.3 | `signalMonitorPyrusSettingsSignature` | `artifacts/api-server/src/services/signal-monitor.ts:7909` |
| 9 | 1.82 | 848.3 | `is` | `node_modules/drizzle-orm/src/entity.ts:12` |
| 10 | 1.64 | 763.4 | anonymous map/filter | `artifacts/api-server/src/services/signal-monitor.ts:4733` |
| 11 | 1.60 | 744.5 | `writeEvent` | `artifacts/api-server/src/routes/signal-monitor.ts:87` |
| 12 | 1.52 | 707.4 | `evaluateSignalMonitorMatrixStateFromStreamBars` | `artifacts/api-server/src/services/signal-monitor.ts:9091` |
| 13 | 1.46 | 679.2 | `normalizeSymbol` | `artifacts/api-server/src/lib/values.ts:197` |
| 14 | 1.23 | 573.9 | `evaluateSignalMonitorMatrixStateFromCompletedBars` | `artifacts/api-server/src/services/signal-monitor.ts:8020` |
| 15 | 1.22 | 568.0 | `getRecentStockMinuteAggregateHistory` | `artifacts/api-server/src/services/stock-aggregate-stream.ts:401` |

Ancestry groups, not mutually exclusive:

| Group | Profile % | ms | Evidence |
|---|---:|---:|---|
| Signal matrix stream/eval | 41.90 | 19519.8 | Stacks under `flushSignalMonitorMatrixStreamAggregates -> emitSignalMonitorMatrixStreamAggregateDelta -> evaluateSignalMonitorMatrixStateFromStreamBars` |
| Postgres/drizzle parse/map | 12.43 | 5789.5 | `_parseRowAsArray`, `pg-protocol`, Drizzle row mapping |
| SSE serialization/write | 10.66 | 4966.6 | `writeEvent`, `serializeSseEventData`, `writev`; much of this is the signal-matrix SSE route |
| Massive websocket fan-in | 4.77 | 2222.4 | `handleRawMessage`, `dispatchDataMessage`, `ws` receiver |
| `signal-monitor-evaluation-worker` | 0.76 | 354.3 | `handleStreamAggregate` and worker leaves |

## Verdict per consumer

### 1. Signal matrix stream/eval is the dominant main-thread burner

Observed: 41.9% ancestry time. The hot stacks are continuously entered from:

`flushSignalMonitorMatrixStreamAggregates` (`signal-monitor.ts:9860`) -> `emitSignalMonitorMatrixStreamAggregateDelta` (`signal-monitor.ts:9736`) -> `evaluateSignalMonitorMatrixStreamScopeDelta` (`signal-monitor.ts:9704`) -> `evaluateSignalMonitorMatrixStateFromStreamBars` (`signal-monitor.ts:9091`).

The earlier sibling finding does appear in the profile. `startSignalMonitorServerOwnedProducer` is boot-registered in `index.ts:306`. It registers a server-owned synthetic subscriber whose `onEvent` is a no-op at `signal-monitor.ts:10048-10102`. That subscriber keeps the matrix stream path alive without a UI client. The comments say this exists to evaluate and persist canonical signal monitor events.

Why it runs continuously: stock aggregate messages call `queueSignalMonitorMatrixStreamAggregate` (`signal-monitor.ts:9938`), which schedules a flush whenever any subscriber scope contains the symbol. The synthetic server-owned subscriber counts as a subscriber. With no real subscribers, the idle flush cadence is still every 3000ms (`signal-monitor.ts:481-484`), and each flush evaluates scoped symbols/timeframes, computes JSON state signatures (`signal-monitor.ts:9246`), touches LRU maps (`signal-monitor.ts:7861`), fingerprints 240 bars (`signal-monitor.ts:7919`), and may persist changed states.

Ponytail-minimal fix option: split the server-owned producer from the SSE subscriber path. For `serverOwnedProducer` subscribers, skip SSE-oriented `changedSignalMonitorMatrixStreamStates` JSON signatures and `onEvent` delta construction; use a cheap persist dirty key keyed on `{symbol,timeframe,latestBarAt,currentSignalAt,currentSignalDirection,status}` or persist only on completed-bar boundaries. This removes the no-op subscriber's UI-delta work without deleting the canonical producer.

### 2. Postgres row parsing/mapping is a secondary main-thread burner

Observed: 12.43% ancestry time, 8.44% self in `_parseRowAsArray` (`pg/lib/result.js:50`). The stack is socket read -> `pg-protocol` parse -> `_handleDataRow` -> `_parseRowAsArray`. Drizzle row mapping also appears (`drizzle-orm/src/entity.ts:12`, `src/utils.ts:15`, timestamp mapping).

Why it runs continuously: the signal-matrix stream and bootstrap/state paths read large row sets. The source comments at `signal-monitor.ts:9573-9583` say every matrix subscriber needs an environment-wide stored-state snapshot, historically around 12k rows at the 2000-symbol cap. During profiling, route stats also showed repeated `/signal-monitor/events`, `/diagnostics/runtime`, and 100 `/api/sparklines/seed` samples, with DB pool waiting up to 25.

Ponytail-minimal fix option: reduce rows before optimizing parsing. Keep the existing single-flight bootstrap, but avoid full-universe stored-state reads for synthetic producer/no-op paths and request only the active scope columns needed for signatures/persistence. If the same query feeds bootstrap and persistence, add a narrow projection first.

### 3. SSE serialization/write is substantial but partly downstream of #1

Observed: 10.66% ancestry time, with `writeEvent` at `routes/signal-monitor.ts:87` and `serializeSseEventData` at `sse-stream-diagnostics.ts:89`. Stack samples show `flushSignalMonitorMatrixStreamAggregates -> emitSignalMonitorMatrixStreamAggregateDelta -> onEvent -> writeEvent`.

Why it runs continuously: real SSE subscribers receive signal-matrix deltas, and the current stream path builds/writes events after per-state signature comparison. This overlaps with the signal-matrix producer path; it is not an independent root cause.

Ponytail-minimal fix option: after the server-owned producer bypass above, keep one serialization per event and avoid per-subscriber duplicate JSON work. Existing code already tries serialize-once in other streams; apply that local pattern only if real-subscriber SSE remains hot after the no-op producer fix.

## Signal evaluation worker starvation/shed check

Observed in profile: `signal-monitor-evaluation-worker` is not the main burner. It accounts for 0.76% ancestry time. Its hot leaf was `handleStreamAggregate` around `signal-monitor-evaluation-worker.ts:752`, reached from stock aggregate fanout.

Observed in source: the worker subscribes to stock aggregates when bar evaluation is enabled at `signal-monitor-evaluation-worker.ts:610-637`, batches pending stream messages at `signal-monitor-evaluation-worker.ts:665-714`, and schedules flushes at `signal-monitor-evaluation-worker.ts:741-749`.

Inferred: this worker can be starved by main-loop saturation because its timers, aggregate callbacks, advisory lock waits, and async continuations all share the same Node event loop. I did not find route-admission shedding directly targeting `signal-monitor-evaluation-worker`.

What actually gets shed/deferred at `high`:

- Route admission sheds only `decorative`, `deferred-analytics`, and `background-maintenance` when the admission pressure level is `high` (`route-admission.ts:207-219`). Middleware passes `pressure.hardResourceLevel`, not display `level` or event-loop-inclusive `resourceLevel` (`route-admission.ts:471-495`). Observed `/api/sparklines/seed` 429s match this route class.
- Signal-options worker degrades entry work only on `isApiResourcePressureHardBlock(pressure)` (`signal-options-worker.ts:733-740`). That helper returns `hardResourceLevel === "high"` (`resource-pressure.ts:603-607`).
- Overnight spot worker similarly uses `isApiResourcePressureHardBlock` for `skipEntryWork` (`overnight-spot-worker.ts:448-454`).
- Shadow account can serve stale/fast fallbacks when `resourceLevel === "high"` (`shadow-account.ts:8580-8583`, `8634-8637`, `8687`, `8711-8719`).
- Chart stale background refresh suppresses lower-priority refreshes when `resourceLevel === "high"` (`platform.ts:9318-9344`).
- Option-chain batch yielding reacts to `hardResourceLevel !== "normal"` or DB pool waiting (`platform.ts:11101-11120`).
- Flow scanner historical hydration stops at `resourceLevel >= high` (`platform.ts:17258-17274`).

## Memory-premise answer

Confirmed: memory is not what triggers the observed pressure/shedding.

Observed:

- During the profile, heap was 618.6-1045.6 MB against a 2752 MB V8 heap limit.
- Flight-recorder `apiHeapUsedPercent` was 7.1%, 8.6%, then 4.9% in the later ELU-only sample.
- RSS was 1035-1729.6 MB in pressure inputs.
- `/sys/fs/cgroup/memory.max` is 17179869184 bytes, 16384 MB.

Source thresholds:

- Heap pressure uses `apiHeapUsedPercent` with watch 70 and high 80 (`resource-pressure.ts:362-365`).
- RSS thresholds come from `resolveApiRssPressureThresholds`: with a 16GB cgroup limit, watch is 37.5% and high is 50% of memory limit, about 6144 MB and 8192 MB (`resource-pressure.ts:246-265`).
- Event-loop utilization high is `>= 0.9` (`resource-pressure.ts:97-106`, `280-286`).
- DB pool high requires active saturation plus at least 6 waiters (`resource-pressure.ts:288-314`).
- Display `level` includes RSS, heap, DB pool, event-loop utilization, client, and cache (`resource-pressure.ts:390-407`).
- `resourceLevel` includes RSS, heap, DB pool, and event-loop delay, not ELU utilization (`resource-pressure.ts:408-423`).
- `hardResourceLevel` includes only RSS, heap, and DB pool (`resource-pressure.ts:424-435`).

Therefore the owner's premise is correct: the 1.4-1.5GB-ish heap/2.75GB limit range is below the 70/80 heap thresholds, and RSS is below its cgroup-scaled thresholds. The high display pressure is ELU-driven; the in-window hard-resource high sample was DB-pool waiting, not memory.
