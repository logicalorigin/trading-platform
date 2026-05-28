export type ApiResourcePressureLevel = "normal" | "watch" | "high" | "critical";

export type ApiResourcePressureDriver = {
  kind: string;
  label: string;
  level: ApiResourcePressureLevel;
  detail: string | null;
  score: number | null;
};

export type ApiResourcePressureCaps = {
  signalOptions: {
    maintenanceOnly: boolean;
    skipDeploymentScans: boolean;
    signalRefreshAllowed: boolean;
    actionScansAllowed: boolean;
    positionMarksAllowed: boolean;
    watchlistPrewarmAllowed: boolean;
  };
};

export type ApiResourcePressureSnapshot = {
  level: ApiResourcePressureLevel;
  observedAt: string;
  drivers: ApiResourcePressureDriver[];
  caps: ApiResourcePressureCaps;
  inputs: {
    rssMb: number | null;
    apiHeapUsedPercent: number | null;
    apiP95LatencyMs: number | null;
    dominantSlowRouteP95Ms: number | null;
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
  critical: 3,
};

const NORMAL_INPUTS: ApiResourcePressureSnapshot["inputs"] = {
  rssMb: null,
  apiHeapUsedPercent: null,
  apiP95LatencyMs: null,
  dominantSlowRouteP95Ms: null,
  clientLevel: null,
  cacheLevel: null,
  automationActiveLongScanCount: null,
};

const API_RSS_HARD_BLOCK_MB = 3_000;

let currentInputs: ApiResourcePressureSnapshot["inputs"] = { ...NORMAL_INPUTS };

const normalizeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeApiResourcePressureLevel(
  value: unknown,
): ApiResourcePressureLevel {
  if (value === "critical" || value === "high" || value === "watch") {
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
  thresholds: { watch: number; high: number; critical: number },
): ApiResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= thresholds.critical) return "critical";
  if (value >= thresholds.high) return "high";
  if (value >= thresholds.watch) return "watch";
  return "normal";
}

function routeLatencyLevel(value: number | null): ApiResourcePressureLevel {
  if (value === null) return "normal";
  return value >= 1_000 ? "watch" : "normal";
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

export function getApiResourcePressureCaps(
  level: ApiResourcePressureLevel = currentSnapshot.level,
): ApiResourcePressureCaps {
  switch (level) {
    case "critical":
      return {
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: false,
          signalRefreshAllowed: true,
          actionScansAllowed: false,
          positionMarksAllowed: true,
          watchlistPrewarmAllowed: false,
        },
      };
    case "high":
      return {
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: false,
          signalRefreshAllowed: true,
          actionScansAllowed: true,
          positionMarksAllowed: true,
          watchlistPrewarmAllowed: false,
        },
      };
    case "watch":
      return {
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: false,
          signalRefreshAllowed: true,
          actionScansAllowed: true,
          positionMarksAllowed: true,
          watchlistPrewarmAllowed: true,
        },
      };
    default:
      return {
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: false,
          signalRefreshAllowed: true,
          actionScansAllowed: true,
          positionMarksAllowed: true,
          watchlistPrewarmAllowed: true,
        },
      };
  }
}

function buildSnapshot(
  inputs: ApiResourcePressureSnapshot["inputs"],
): ApiResourcePressureSnapshot {
  const rssLevel = levelFromThresholds(inputs.rssMb, {
    watch: 900,
    high: 1_200,
    critical: 1_600,
  });
  const heapLevel = levelFromThresholds(inputs.apiHeapUsedPercent, {
    watch: 70,
    high: 80,
    critical: 90,
  });
  const slowRouteMs = Math.max(
    inputs.apiP95LatencyMs ?? 0,
    inputs.dominantSlowRouteP95Ms ?? 0,
  );
  const slowRouteLevel = routeLatencyLevel(
    slowRouteMs > 0 ? slowRouteMs : null,
  );
  const rawClientLevel = inputs.clientLevel ?? "normal";
  const clientLevel = capLevel(rawClientLevel, "watch");
  const rawCacheLevel = inputs.cacheLevel ?? "normal";
  const cacheLevel = capLevel(rawCacheLevel, "watch");
  const automationCount = inputs.automationActiveLongScanCount ?? 0;
  const automationLevel = automationCount > 0 ? "high" : "normal";
  const level = maxLevel(
    rssLevel,
    heapLevel,
    slowRouteLevel,
    clientLevel,
    cacheLevel,
    automationLevel,
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
    observedAt: new Date().toISOString(),
    drivers,
    caps: getApiResourcePressureCaps(level),
    inputs: { ...inputs },
  };
}

let currentSnapshot: ApiResourcePressureSnapshot = buildSnapshot(currentInputs);
const pressureChangeListeners = new Set<
  (snapshot: ApiResourcePressureSnapshot) => void
>();

export function subscribeApiResourcePressureChanges(
  listener: (snapshot: ApiResourcePressureSnapshot) => void,
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
  pressureChangeListeners.forEach((listener) => {
    try {
      listener(currentSnapshot);
    } catch {
      // Resource-pressure listeners must not affect diagnostics sampling.
    }
  });
  return currentSnapshot;
}

export function getApiResourcePressureSnapshot(): ApiResourcePressureSnapshot {
  return currentSnapshot;
}

export function isApiResourcePressureHardBlock(
  snapshot: ApiResourcePressureSnapshot = currentSnapshot,
): boolean {
  if (snapshot.level !== "critical") {
    return false;
  }
  return snapshot.drivers.some((driver) => {
    if (driver.level !== "critical") {
      return false;
    }
    if (driver.kind === "api-rss") {
      return Number(driver.score) >= API_RSS_HARD_BLOCK_MB;
    }
    return true;
  });
}

export function __resetApiResourcePressureForTests(): void {
  currentInputs = { ...NORMAL_INPUTS };
  currentSnapshot = buildSnapshot(currentInputs);
}
