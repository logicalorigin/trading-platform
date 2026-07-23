import { readFileSync } from "node:fs";

export type ApiResourcePressureLevel = "normal" | "watch" | "high";

export type ApiResourcePressureDriver = {
  kind: string;
  label: string;
  level: ApiResourcePressureLevel;
  detail: string | null;
  score: number | null;
};

export type ApiResourcePressureSnapshot = {
  // Display/telemetry pressure: rss + heap + local DB pool + client + cache.
  // Request latency is intentionally EXCLUDED so a slow external (broker/shadow)
  // route can't latch a misleading pressure headline — a single slow sample
  // lingered in the 5-min latency window long enough to read `watch` for minutes.
  // Latency is still surfaced via the `api-latency` driver and the independent
  // API-latency severity instead.
  level: ApiResourcePressureLevel;
  // Server-saturation level: rss + heap + event-loop delay + local DB pool
  // exhaustion. Trading caps gate on this, NOT on request latency — a slow
  // external (broker) route inflates request latency without saturating the
  // server, and must not freeze signal/action work.
  resourceLevel: ApiResourcePressureLevel;
  // Finite-resource telemetry/backward-consumer level: max(rss, heap, db pool).
  // DB admission owns DB-pool pacing, so route shedding does not consume this.
  hardResourceLevel: ApiResourcePressureLevel;
  // Process-memory emergency circuit: max(rss, heap), independently hysteretic.
  // Route admission may shed lower-priority work only on this process-wide risk;
  // a saturated DB lane must not disable unrelated routes.
  memoryResourceLevel: ApiResourcePressureLevel;
  observedAt: string;
  drivers: ApiResourcePressureDriver[];
  scannerPressure: {
    level: ApiResourcePressureLevel;
    drivers: ApiResourcePressureDriver[];
    activeLongScanCount: number | null;
  };
  inputs: {
    rssMb: number | null;
    apiHeapUsedPercent: number | null;
    apiP95LatencyMs: number | null;
    dominantSlowRouteP95Ms: number | null;
    eventLoopDelayP95Ms: number | null;
    eventLoopUtilization: number | null;
    dbPoolActive: number | null;
    dbPoolWaiting: number | null;
    dbPoolMax: number | null;
    clientLevel: ApiResourcePressureLevel | null;
    cacheLevel: ApiResourcePressureLevel | null;
    automationActiveLongScanCount: number | null;
  };
};

type PressureInputs = Partial<ApiResourcePressureSnapshot["inputs"]>;

const PRESSURE_RANK: Record<ApiResourcePressureLevel, number> = {
  normal: 0,
  watch: 1,
  high: 2,
};

const NORMAL_INPUTS: ApiResourcePressureSnapshot["inputs"] = {
  rssMb: null,
  apiHeapUsedPercent: null,
  apiP95LatencyMs: null,
  dominantSlowRouteP95Ms: null,
  eventLoopDelayP95Ms: null,
  eventLoopUtilization: null,
  dbPoolActive: null,
  dbPoolWaiting: null,
  dbPoolMax: null,
  clientLevel: null,
  cacheLevel: null,
  automationActiveLongScanCount: null,
};

const FALLBACK_API_RSS_PRESSURE_THRESHOLDS = {
  watch: 3_072,
  high: 4_608,
} as const;
const API_ROUTE_LATENCY_WATCH_MS = 1_000;
const API_ROUTE_LATENCY_HIGH_MS = 10_000;
// Event-loop delay thresholds: the direct measure of server CPU/loop saturation
// (unlike request latency, which external I/O waits inflate). Calibrated to the
// observed healthy baseline (~130-186ms p95 under the 500-symbol workload): the
// old 60ms watch line sat BELOW normal operation, so every sample read "watch"
// and transient ~300-470ms spikes hit "high". watch=150 keeps healthy steady
// state in "normal"; high=400 (with the 2-sample hysteresis) trips only on
// sustained multi-hundred-ms-to-second stalls (genuine loop saturation, e.g. the
// bar-cache freeze's 1-3s spikes), not transient bursts. Pairs with the
// finer-yield work that drops the baseline further.
const API_EVENT_LOOP_DELAY_WATCH_MS = 150;
const API_EVENT_LOOP_DELAY_HIGH_MS = 400;
// Event-loop UTILIZATION thresholds (0..1): fraction of wall-clock the loop was
// active over the window. This is the saturation signal event-loop DELAY misses —
// a loop pegged at ~90%+ CPU by many back-to-back medium tasks shows only modest
// delay (~200-600ms) yet starves SSE price delivery, so the headline `level` read
// "normal" while a core was maxed. Feeds the DISPLAY level only (not
// resourceLevel/hardResourceLevel), so trading/admission/scan gating is unchanged.
// Initial estimates: watch clears normal busy operation; high trips only on genuine
// saturation. Confirm against live ELU and tune if needed.
const API_EVENT_LOOP_UTILIZATION_WATCH = 0.75;
const API_EVENT_LOOP_UTILIZATION_HIGH = 0.9;
const CGROUP_MEMORY_MAX_PATH = "/sys/fs/cgroup/memory.max";
const MB = 1024 * 1024;
const RESOURCE_HIGH_ENTER_SAMPLE_COUNT = 2;
const RESOURCE_HIGH_EXIT_SAMPLE_COUNT = 2;

let currentInputs: ApiResourcePressureSnapshot["inputs"] = { ...NORMAL_INPUTS };

type ResourceLevelHysteresisState = {
  stable: ApiResourcePressureLevel;
  consecutiveHigh: number;
  consecutiveClear: number;
};

const newResourceLevelHysteresisState = (): ResourceLevelHysteresisState => ({
  stable: "normal",
  consecutiveHigh: 0,
  consecutiveClear: 0,
});

// Each aggregate enters/exits "high" on its own sample sequence, so sharing
// hysteresis state would cross-contaminate unrelated resource lanes.
const resourceLevelHysteresis = newResourceLevelHysteresisState();
const hardResourceLevelHysteresis = newResourceLevelHysteresisState();
const memoryResourceLevelHysteresis = newResourceLevelHysteresisState();

const normalizeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeApiResourcePressureLevel(
  value: unknown,
): ApiResourcePressureLevel {
  if (value === "high" || value === "watch") {
    return value;
  }
  if (value === "shed") {
    return "high";
  }
  return "normal";
}

function maxLevel(
  ...levels: Array<ApiResourcePressureLevel | null | undefined>
): ApiResourcePressureLevel {
  return levels.reduce<ApiResourcePressureLevel>((current, next) => {
    const normalized = normalizeApiResourcePressureLevel(next);
    return PRESSURE_RANK[normalized] > PRESSURE_RANK[current]
      ? normalized
      : current;
  }, "normal");
}

function capLevel(
  level: ApiResourcePressureLevel,
  maximum: ApiResourcePressureLevel,
): ApiResourcePressureLevel {
  return PRESSURE_RANK[level] > PRESSURE_RANK[maximum] ? maximum : level;
}

function levelFromThresholds(
  value: number | null,
  thresholds: { watch: number; high: number },
): ApiResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= thresholds.high) return "high";
  if (value >= thresholds.watch) return "watch";
  return "normal";
}

function applyResourceLevelHysteresis(
  state: ResourceLevelHysteresisState,
  input: {
    rawLevel: ApiResourcePressureLevel;
    immediateHigh: boolean;
  },
): ApiResourcePressureLevel {
  if (input.immediateHigh) {
    state.stable = "high";
    state.consecutiveHigh = RESOURCE_HIGH_ENTER_SAMPLE_COUNT;
    state.consecutiveClear = 0;
    return state.stable;
  }

  if (input.rawLevel === "high") {
    state.consecutiveHigh += 1;
    state.consecutiveClear = 0;
    if (
      state.stable === "high" ||
      state.consecutiveHigh >= RESOURCE_HIGH_ENTER_SAMPLE_COUNT
    ) {
      state.stable = "high";
      return state.stable;
    }
    state.stable = maxLevel(state.stable, "watch");
    return state.stable;
  }

  state.consecutiveHigh = 0;
  if (state.stable === "high") {
    state.consecutiveClear += 1;
    if (state.consecutiveClear < RESOURCE_HIGH_EXIT_SAMPLE_COUNT) {
      return state.stable;
    }
  }

  state.consecutiveClear = 0;
  state.stable = input.rawLevel;
  return state.stable;
}

function readPositiveNumberEnv(name: string): number | null {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readCgroupMemoryLimitMb(): number | null {
  try {
    const raw = readFileSync(CGROUP_MEMORY_MAX_PATH, "utf8").trim();
    if (!raw || raw === "max") {
      return null;
    }
    const bytes = Number(raw);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return null;
    }
    return Math.round(bytes / MB);
  } catch {
    return null;
  }
}

// Container memory ceiling (cgroup v2 memory.max), in MB, or null when
// unbounded/unreadable. Exposed so heap pressure can be scaled against real
// container memory rather than the ~2.7GB V8 heap ceiling.
export function getContainerMemoryLimitMb(): number | null {
  return readCgroupMemoryLimitMb();
}

export function resolveApiRssPressureThresholds(
  memoryLimitMb = readCgroupMemoryLimitMb(),
): { watch: number; high: number } {
  const envWatch = readPositiveNumberEnv("API_RSS_PRESSURE_WATCH_MB");
  const envHigh = readPositiveNumberEnv("API_RSS_PRESSURE_HIGH_MB");
  if (envWatch !== null || envHigh !== null) {
    return {
      watch: envWatch ?? FALLBACK_API_RSS_PRESSURE_THRESHOLDS.watch,
      high: envHigh ?? FALLBACK_API_RSS_PRESSURE_THRESHOLDS.high,
    };
  }

  if (memoryLimitMb !== null && memoryLimitMb >= 8_192) {
    return {
      watch: Math.round(memoryLimitMb * 0.375),
      high: Math.round(memoryLimitMb * 0.5),
    };
  }

  return { ...FALLBACK_API_RSS_PRESSURE_THRESHOLDS };
}

function routeLatencyLevel(value: number | null): ApiResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= API_ROUTE_LATENCY_HIGH_MS) return "high";
  return value >= API_ROUTE_LATENCY_WATCH_MS ? "watch" : "normal";
}

function eventLoopDelayLevel(value: number | null): ApiResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= API_EVENT_LOOP_DELAY_HIGH_MS) return "high";
  return value >= API_EVENT_LOOP_DELAY_WATCH_MS ? "watch" : "normal";
}

function eventLoopUtilizationLevel(
  value: number | null,
): ApiResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= API_EVENT_LOOP_UTILIZATION_HIGH) return "high";
  return value >= API_EVENT_LOOP_UTILIZATION_WATCH ? "watch" : "normal";
}

// A full pool (active>=max) with only a few transient waiters is normal fan-out
// (~10 concurrent sub-reads per dashboard load, per lib/db pool comment), not
// sustained saturation - escalating it to "high" fires every back-pressure gate
// (admission shed, diagnostics-persist skip, backfill skip, shadow fast-fallback,
// signal-options worker degrade) and made the signal flap. Require a real, DEEP
// queue (>= half the 12-connection pool) on top of the existing 2-sample
// hysteresis before "high", so a busy-but-serviceable pool stays "watch". This
// only de-flaps the signal; genuine relief is reducing concurrent demand on the
// hard pool, not tuning the threshold. Override live with DB_POOL_HIGH_MIN_WAITERS.
const DB_POOL_HIGH_MIN_WAITERS =
  readPositiveNumberEnv("DB_POOL_HIGH_MIN_WAITERS") ?? 6;

function dbPoolLevel(input: {
  active: number | null;
  waiting: number | null;
  max: number | null;
}): ApiResourcePressureLevel {
  const waiting = input.waiting ?? 0;
  const max = input.max !== null && input.max > 0 ? input.max : null;
  const activeSaturated =
    input.active !== null && max !== null && input.active >= max;
  if (waiting >= DB_POOL_HIGH_MIN_WAITERS && activeSaturated) {
    return "high";
  }
  if (waiting > 0 || activeSaturated) return "watch";
  return "normal";
}

function dbPoolDetail(input: {
  active: number | null;
  waiting: number | null;
  max: number | null;
}): string | null {
  if (input.active === null && input.waiting === null && input.max === null) {
    return null;
  }
  const active =
    input.active === null
      ? "unknown"
      : input.max && input.max > 0
        ? `${input.active}/${input.max} active`
        : `${input.active} active`;
  const waiting = input.waiting === null ? null : `${input.waiting} waiting`;
  return waiting ? `${active}, ${waiting}` : active;
}

function driver(input: {
  kind: string;
  label: string;
  level: ApiResourcePressureLevel;
  detail: string | null;
  score: number | null;
}): ApiResourcePressureDriver | null {
  if (input.level === "normal") {
    return null;
  }
  return input;
}

function cappedDriverDetail(
  rawLevel: ApiResourcePressureLevel,
  cappedLevel: ApiResourcePressureLevel,
): string | null {
  if (rawLevel === "normal") return null;
  return rawLevel === cappedLevel ? rawLevel : `${rawLevel} capped at ${cappedLevel}`;
}

function buildSnapshot(
  inputs: ApiResourcePressureSnapshot["inputs"],
): ApiResourcePressureSnapshot {
  const rssLevel = levelFromThresholds(
    inputs.rssMb,
    resolveApiRssPressureThresholds(),
  );
  const heapLevel = levelFromThresholds(inputs.apiHeapUsedPercent, {
    watch: 70,
    high: 80,
  });
  const slowRouteMs = Math.max(
    inputs.apiP95LatencyMs ?? 0,
    inputs.dominantSlowRouteP95Ms ?? 0,
  );
  const slowRouteLevel = routeLatencyLevel(
    slowRouteMs > 0 ? slowRouteMs : null,
  );
  const eventLoopLevel = eventLoopDelayLevel(
    inputs.eventLoopDelayP95Ms ?? null,
  );
  const eventLoopUtilizationLevelValue = eventLoopUtilizationLevel(
    inputs.eventLoopUtilization ?? null,
  );
  const poolLevel = dbPoolLevel({
    active: inputs.dbPoolActive,
    waiting: inputs.dbPoolWaiting,
    max: inputs.dbPoolMax,
  });
  const rawClientLevel = inputs.clientLevel ?? "normal";
  const clientLevel = capLevel(rawClientLevel, "watch");
  const rawCacheLevel = inputs.cacheLevel ?? "normal";
  const cacheLevel = capLevel(rawCacheLevel, "watch");
  const automationCount = inputs.automationActiveLongScanCount ?? 0;
  const automationLevel = automationCount > 0 ? "high" : "normal";
  // Request latency is EXCLUDED from `level`: a slow external (broker/shadow)
  // route is external I/O, not server saturation, and a single slow sample
  // lingered in the 5-min latency window long enough to latch a misleading
  // `watch`. Latency stays visible via the `api-latency` driver below and the
  // independent API-latency severity; runtime gates use latency-excluded levels.
  // Event-loop UTILIZATION is INCLUDED in `level` (display/telemetry only) so the
  // headline stops reading "normal" while the single loop is CPU-saturated — the
  // freeze signature that event-loop DELAY under-reports. It is deliberately NOT
  // added to any actionable pressure level below.
  const level = maxLevel(
    rssLevel,
    heapLevel,
    poolLevel,
    eventLoopUtilizationLevelValue,
    clientLevel,
    cacheLevel,
  );
  // Actual server saturation: memory + event-loop + local DB pool exhaustion.
  // Request latency is excluded so a slow external (broker) route can't freeze
  // signal/action work. rss, heap and dbPool are noisy 15s-spaced point samples,
  // so they all go through the SAME 2-sample hysteresis as event-loop: a single
  // blip caps at "watch" and only sustained (≥2 consecutive samples ≈ 30s)
  // saturation reaches "high". rss previously instant-tripped high on a single
  // sample. It now follows the same point-sample policy: one reading remains
  // visible without freezing trading, while sustained high RSS still sheds via
  // the hysteresis.
  const rawResourceLevel = maxLevel(rssLevel, heapLevel, poolLevel, eventLoopLevel);
  const resourceLevel = applyResourceLevelHysteresis(resourceLevelHysteresis, {
    rawLevel: rawResourceLevel,
    immediateHigh: false,
  });
  // Finite-resource saturation telemetry/backward-consumer level (no event-loop
  // delay). rss/heap/pool all go through the 2-sample hysteresis.
  const rawHardResourceLevel = maxLevel(rssLevel, heapLevel, poolLevel);
  const hardResourceLevel = applyResourceLevelHysteresis(
    hardResourceLevelHysteresis,
    {
      rawLevel: rawHardResourceLevel,
      immediateHigh: false,
    },
  );
  const memoryResourceLevel = applyResourceLevelHysteresis(
    memoryResourceLevelHysteresis,
    {
      rawLevel: maxLevel(rssLevel, heapLevel),
      immediateHigh: false,
    },
  );

  const drivers = [
    driver({
      kind: "api-rss",
      label: "API RSS",
      level: rssLevel,
      detail: inputs.rssMb === null ? null : `${Math.round(inputs.rssMb)} MB`,
      score: inputs.rssMb,
    }),
    driver({
      kind: "api-heap",
      label: "API heap",
      level: heapLevel,
      detail:
        inputs.apiHeapUsedPercent === null
          ? null
          : `${Math.round(inputs.apiHeapUsedPercent)}%`,
      score: inputs.apiHeapUsedPercent,
    }),
    driver({
      kind: "api-latency",
      label: "API latency",
      level: slowRouteLevel,
      detail: slowRouteMs > 0 ? `${Math.round(slowRouteMs)} ms` : null,
      score: slowRouteMs > 0 ? slowRouteMs : null,
    }),
    driver({
      kind: "api-event-loop",
      label: "API event loop",
      level: eventLoopLevel,
      detail:
        inputs.eventLoopDelayP95Ms === null
          ? null
          : `${Math.round(inputs.eventLoopDelayP95Ms)} ms`,
      score: inputs.eventLoopDelayP95Ms,
    }),
    driver({
      kind: "api-event-loop-utilization",
      label: "API event-loop utilization",
      level: eventLoopUtilizationLevelValue,
      detail:
        inputs.eventLoopUtilization == null
          ? null
          : `${Math.round(inputs.eventLoopUtilization * 100)}%`,
      score:
        inputs.eventLoopUtilization == null
          ? null
          : Math.round(inputs.eventLoopUtilization * 1000) / 1000,
    }),
    driver({
      kind: "db-pool",
      label: "DB pool",
      level: poolLevel,
      detail: dbPoolDetail({
        active: inputs.dbPoolActive,
        waiting: inputs.dbPoolWaiting,
        max: inputs.dbPoolMax,
      }),
      score: inputs.dbPoolWaiting ?? null,
    }),
    driver({
      kind: "client-pressure",
      label: "Client pressure",
      level: clientLevel,
      detail: cappedDriverDetail(rawClientLevel, clientLevel),
      score: null,
    }),
    driver({
      kind: "cache-pressure",
      label: "Cache pressure",
      level: cacheLevel,
      detail: cappedDriverDetail(rawCacheLevel, cacheLevel),
      score: null,
    }),
  ].filter((entry): entry is ApiResourcePressureDriver => Boolean(entry));

  const scannerDrivers = [
    driver({
      kind: "automation",
      label: "Signal-options automation",
      level: automationLevel,
      detail: automationCount > 0 ? `${automationCount} long scan(s)` : null,
      score: automationCount,
    }),
  ].filter((entry): entry is ApiResourcePressureDriver => Boolean(entry));

  return {
    level,
    resourceLevel,
    hardResourceLevel,
    memoryResourceLevel,
    observedAt: new Date().toISOString(),
    drivers,
    scannerPressure: {
      level: maxLevel(...scannerDrivers.map((entry) => entry.level)),
      drivers: scannerDrivers,
      activeLongScanCount: inputs.automationActiveLongScanCount,
    },
    inputs: { ...inputs },
  };
}

let currentSnapshot: ApiResourcePressureSnapshot = buildSnapshot(currentInputs);
const pressureChangeListeners = new Set<
  (snapshot: ApiResourcePressureSnapshot) => void | PromiseLike<void>
>();

export function subscribeApiResourcePressureChanges(
  listener: (
    snapshot: ApiResourcePressureSnapshot,
  ) => void | PromiseLike<void>,
): () => void {
  pressureChangeListeners.add(listener);
  return () => {
    pressureChangeListeners.delete(listener);
  };
}

export function updateApiResourcePressure(
  inputs: PressureInputs,
): ApiResourcePressureSnapshot {
  currentInputs = {
    ...currentInputs,
    ...Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => {
        if (
          key === "rssMb" ||
          key === "apiHeapUsedPercent" ||
          key === "apiP95LatencyMs" ||
          key === "dominantSlowRouteP95Ms" ||
          key === "eventLoopDelayP95Ms" ||
          key === "eventLoopUtilization" ||
          key === "dbPoolActive" ||
          key === "dbPoolWaiting" ||
          key === "dbPoolMax" ||
          key === "automationActiveLongScanCount"
        ) {
          return [key, normalizeNumber(value)];
        }
        if (key === "clientLevel" || key === "cacheLevel") {
          return [key, value === null ? null : normalizeApiResourcePressureLevel(value)];
        }
        return [key, value ?? null];
      }),
    ),
  };
  currentSnapshot = buildSnapshot(currentInputs);
  [...pressureChangeListeners].forEach((listener) => {
    try {
      const result = listener(currentSnapshot);
      if (result) {
        void Promise.resolve(result).catch(() => {
          // Resource-pressure listeners must not affect diagnostics sampling.
        });
      }
    } catch {
      // Resource-pressure listeners must not affect diagnostics sampling.
    }
  });
  return currentSnapshot;
}

export function getApiResourcePressureSnapshot(): ApiResourcePressureSnapshot {
  return currentSnapshot;
}

// Gates on `hardResourceLevel` (finite-resource exhaustion: rss/heap/db-pool),
// NOT `resourceLevel` — so a busy event loop (a SYMPTOM, not a finite resource)
// no longer pauses trading scans. This is Stage 2 of the event-loop-pressure
// decouple: a 30s CPU x-ray (2026-07, ELU high) confirmed the loop blocker is DB
// row parsing (`_parseRowAsArray` ~20% self-time, driven by the bar_cache read
// firehose) and GC — NOT the deployment-scan bodies, which never appeared in the
// profile. Pausing scans therefore did not return loop time (self-defeating), so
// scans now pause only when a finite resource (pool/memory) is genuinely
// exhausted. See docs/plans/event-loop-pressure-decouple-price-path.md.
export function isApiResourcePressureHardBlock(
  snapshot: ApiResourcePressureSnapshot = currentSnapshot,
): boolean {
  return snapshot.hardResourceLevel === "high";
}

export function __resetApiResourcePressureForTests(): void {
  currentInputs = { ...NORMAL_INPUTS };
  Object.assign(resourceLevelHysteresis, newResourceLevelHysteresisState());
  Object.assign(hardResourceLevelHysteresis, newResourceLevelHysteresisState());
  Object.assign(memoryResourceLevelHysteresis, newResourceLevelHysteresisState());
  currentSnapshot = buildSnapshot(currentInputs);
}
