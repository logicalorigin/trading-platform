export type ApiResourcePressureLevel = "normal" | "watch" | "high" | "critical";

export type ApiResourcePressureDriver = {
  kind: string;
  label: string;
  level: ApiResourcePressureLevel;
  detail: string | null;
  score: number | null;
};

export type ApiResourcePressureCaps = {
  watchlistFillerMaxSymbols: number;
  optionsFlow: {
    backgroundEnabled: boolean;
    radarBatchSizeMax: number;
    radarDeepCandidateMax: number;
    radarFallbackDeepCandidateMax: number;
    lineBudgetMax: number;
    scannerBatchSizeMax: number;
    intervalMsMin: number;
  };
  signalOptions: {
    maintenanceOnly: boolean;
    skipDeploymentScans: boolean;
  };
};

export type ApiResourcePressureSnapshot = {
  level: ApiResourcePressureLevel;
  observedAt: string;
  drivers: ApiResourcePressureDriver[];
  caps: ApiResourcePressureCaps;
  inputs: {
    rssMb: number | null;
    apiP95LatencyMs: number | null;
    dominantSlowRouteP95Ms: number | null;
    clientLevel: ApiResourcePressureLevel | null;
    cacheLevel: ApiResourcePressureLevel | null;
    optionsBackgroundBlockedReason: string | null;
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
  apiP95LatencyMs: null,
  dominantSlowRouteP95Ms: null,
  clientLevel: null,
  cacheLevel: null,
  optionsBackgroundBlockedReason: null,
  automationActiveLongScanCount: null,
};

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

export function getApiResourcePressureCaps(
  level: ApiResourcePressureLevel = currentSnapshot.level,
): ApiResourcePressureCaps {
  switch (level) {
    case "critical":
      return {
        watchlistFillerMaxSymbols: 0,
        optionsFlow: {
          backgroundEnabled: false,
          radarBatchSizeMax: 0,
          radarDeepCandidateMax: 0,
          radarFallbackDeepCandidateMax: 0,
          lineBudgetMax: 0,
          scannerBatchSizeMax: 0,
          intervalMsMin: 120_000,
        },
        signalOptions: {
          maintenanceOnly: true,
          skipDeploymentScans: true,
        },
      };
    case "high":
      return {
        watchlistFillerMaxSymbols: 4,
        optionsFlow: {
          backgroundEnabled: true,
          radarBatchSizeMax: 30,
          radarDeepCandidateMax: 1,
          radarFallbackDeepCandidateMax: 1,
          lineBudgetMax: 40,
          scannerBatchSizeMax: 8,
          intervalMsMin: 30_000,
        },
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: true,
        },
      };
    case "watch":
      return {
        watchlistFillerMaxSymbols: 12,
        optionsFlow: {
          backgroundEnabled: true,
          radarBatchSizeMax: 15,
          radarDeepCandidateMax: 2,
          radarFallbackDeepCandidateMax: 2,
          lineBudgetMax: 40,
          scannerBatchSizeMax: 20,
          intervalMsMin: 30_000,
        },
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: false,
        },
      };
    default:
      return {
        watchlistFillerMaxSymbols: 40,
        optionsFlow: {
          backgroundEnabled: true,
          radarBatchSizeMax: Number.MAX_SAFE_INTEGER,
          radarDeepCandidateMax: Number.MAX_SAFE_INTEGER,
          radarFallbackDeepCandidateMax: Number.MAX_SAFE_INTEGER,
          lineBudgetMax: Number.MAX_SAFE_INTEGER,
          scannerBatchSizeMax: Number.MAX_SAFE_INTEGER,
          intervalMsMin: 0,
        },
        signalOptions: {
          maintenanceOnly: false,
          skipDeploymentScans: false,
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
  const slowRouteMs = Math.max(
    inputs.apiP95LatencyMs ?? 0,
    inputs.dominantSlowRouteP95Ms ?? 0,
  );
  const slowRouteLevel = routeLatencyLevel(
    slowRouteMs > 0 ? slowRouteMs : null,
  );
  const clientLevel = inputs.clientLevel ?? "normal";
  const cacheLevel = inputs.cacheLevel ?? "normal";
  const optionsReason = inputs.optionsBackgroundBlockedReason;
  const optionsLevel =
    optionsReason === "options-lane-backoff"
      ? "high"
      : optionsReason === "options-lane-queued"
        ? "watch"
        : "normal";
  const automationCount = inputs.automationActiveLongScanCount ?? 0;
  const automationLevel = automationCount > 0 ? "high" : "normal";
  const level = maxLevel(
    rssLevel,
    slowRouteLevel,
    clientLevel,
    cacheLevel,
    optionsLevel,
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
      detail: clientLevel === "normal" ? null : clientLevel,
      score: null,
    }),
    driver({
      kind: "cache-pressure",
      label: "Cache pressure",
      level: cacheLevel,
      detail: cacheLevel === "normal" ? null : cacheLevel,
      score: null,
    }),
    driver({
      kind: "options-lane",
      label: "Options lane",
      level: optionsLevel,
      detail: optionsReason,
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

export function updateApiResourcePressure(
  inputs: PressureInputs,
): ApiResourcePressureSnapshot {
  currentInputs = {
    ...currentInputs,
    ...Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => {
        if (
          key === "rssMb" ||
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
  return currentSnapshot;
}

export function getApiResourcePressureSnapshot(): ApiResourcePressureSnapshot {
  return currentSnapshot;
}

export function __resetApiResourcePressureForTests(): void {
  currentInputs = { ...NORMAL_INPUTS };
  currentSnapshot = buildSnapshot(currentInputs);
}
