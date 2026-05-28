import { MEMORY_PRESSURE_THRESHOLDS } from "./memoryPressureModel.js";

const MISSING_VALUE = "--";
const THRESHOLD_LEVELS = ["watch", "high", "critical"];

const PRESSURE_THRESHOLD_ROWS = [
  {
    group: "Browser memory",
    label: "Memory API",
    unit: "MB",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.browserMemoryMb.measureUserAgentSpecificMemory,
  },
  {
    group: "Browser memory",
    label: "performance.memory",
    unit: "MB",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.browserMemoryMb["performance.memory"],
  },
  {
    group: "Browser memory",
    label: "Heuristic",
    unit: "MB",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.browserMemoryMb.heuristic,
  },
  {
    group: "API",
    label: "Heap used",
    unit: "%",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.apiHeapUsedPercent,
  },
  {
    group: "Workload",
    label: "Active work",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.workload.activeWorkloadCount,
  },
  {
    group: "Workload",
    label: "Polls",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.workload.pollCount,
  },
  {
    group: "Workload",
    label: "Streams",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.workload.streamCount,
  },
  {
    group: "Charts",
    label: "Hydration scopes",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.chartHydration.chartScopeCount,
  },
  {
    group: "Charts",
    label: "Prepend scopes",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.chartHydration.prependScopeCount,
  },
  {
    group: "Queries",
    label: "Query count",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.queryCache.queryCount,
  },
  {
    group: "Queries",
    label: "Heavy queries",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.queryCache.heavyQueryCount,
  },
  {
    group: "Stores",
    label: "Runtime entries",
    thresholds: MEMORY_PRESSURE_THRESHOLDS.runtimeStores.storeEntryCount,
  },
];

const numeric = (value) => {
  if (value == null || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const round = (value, precision = 0) => {
  const number = numeric(value);
  if (number == null) return null;
  const multiplier = 10 ** precision;
  return Math.round(number * multiplier) / multiplier;
};

export const formatMemoryDetailValue = (value, unit = "", precision = 0) => {
  const rounded = round(value, precision);
  if (rounded == null) return MISSING_VALUE;
  const separator = unit && unit !== "%" ? " " : "";
  return `${rounded}${separator}${unit}`;
};

const formatRawBytesAsMb = (value) => {
  const bytes = numeric(value);
  if (bytes == null) return MISSING_VALUE;
  return formatMemoryDetailValue(bytes / 1024 / 1024, "MB", 1);
};

export const formatMemoryThresholdValue = (value, unit = "") => {
  const rounded = round(value, 0);
  if (rounded == null) return "none";
  const separator = unit && unit !== "%" ? " " : "";
  return `${rounded}${separator}${unit}`;
};

const formatObservedAt = (value) => {
  if (!value) return MISSING_VALUE;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const ageSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.round(ageSeconds / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const boolLabel = (value) => {
  if (value === true) return "yes";
  if (value === false) return "no";
  return MISSING_VALUE;
};

const readResourcePressureMetrics = (diagnosticsPayload) =>
  diagnosticsPayload?.snapshots?.find?.(
    (snapshot) => snapshot?.subsystem === "resource-pressure",
  )?.metrics || null;

const readApiMetrics = (signal, diagnosticsPayload) => {
  const diagnosticsMetrics = readResourcePressureMetrics(diagnosticsPayload);
  if (diagnosticsMetrics) return diagnosticsMetrics;
  const server = signal?.server;
  if (
    server &&
    (server.heapUsedMb != null ||
      server.heapLimitMb != null ||
      server.rssMb != null ||
      server.eventLoopP95Ms != null)
  ) {
    return server;
  }
  return null;
};

const buildThresholdSummary = (thresholds, unit = "") =>
  THRESHOLD_LEVELS.map(
    (level) => `${level} ${formatMemoryThresholdValue(thresholds?.[level], unit)}`,
  ).join(" / ");

const buildThresholdRows = () =>
  PRESSURE_THRESHOLD_ROWS.map((row) => ({
    ...row,
    summary: buildThresholdSummary(row.thresholds, row.unit),
  }));

const buildDriverRows = (signal) => {
  const drivers = Array.isArray(signal?.pressureDrivers)
    ? signal.pressureDrivers
    : Array.isArray(signal?.dominantDrivers)
      ? signal.dominantDrivers
      : [];
  return drivers.map((driver) => ({
    kind: driver.kind,
    label: driver.label || driver.kind || "Driver",
    level: driver.level || "normal",
    detail: driver.detail || MISSING_VALUE,
    contribution: formatMemoryDetailValue(driver.contribution, "pts", 1),
    metrics: Array.isArray(driver.metrics)
      ? driver.metrics.map((metric) => ({
          key: metric.key,
          label: metric.label || metric.key,
          level: metric.level || "normal",
          value: formatMemoryDetailValue(metric.value, metric.unit || "", 1),
          source: metric.source || null,
          thresholds: buildThresholdSummary(metric.thresholds, metric.unit || ""),
        }))
      : [],
  }));
};

export const buildMemoryPressurePopoverModel = (
  signal = {},
  diagnosticsPayload = null,
) => {
  const memory = signal?.measurement?.memory || {};
  const isolation = signal?.measurement?.isolation || {};
  const apiMetrics = readApiMetrics(signal, diagnosticsPayload);
  const apiHeapUsedPercent =
    signal?.apiHeapUsedPercent ??
    signal?.server?.apiHeapUsedPercent ??
    signal?.server?.heapUsedPercent ??
    apiMetrics?.heapUsedPercent;
  const driverRows = buildDriverRows(signal);
  const criticalDriver = driverRows.find((driver) => driver.level === "critical");

  return {
    level: signal?.level || "normal",
    criticalReason: criticalDriver
      ? `${criticalDriver.label}${criticalDriver.detail !== MISSING_VALUE ? ` ${criticalDriver.detail}` : ""}`
      : null,
    statusRows: [
      { label: "Level", value: String(signal?.level || "normal").toUpperCase() },
      { label: "Load score", value: formatMemoryDetailValue(signal?.score, "pts", 1) },
      { label: "Trend", value: String(signal?.trend || "steady").toUpperCase() },
      { label: "Observed", value: formatObservedAt(signal?.observedAt) },
    ],
    browserRows: [
      {
        label: "Estimate",
        value: formatMemoryDetailValue(signal?.browserMemoryMb, "MB", 1),
      },
      {
        label: "Source",
        value: signal?.browserSource || memory.source || MISSING_VALUE,
      },
      {
        label: "Confidence",
        value: signal?.sourceQuality || memory.confidence || MISSING_VALUE,
      },
      { label: "Measured bytes", value: formatRawBytesAsMb(memory.bytes) },
      { label: "Used heap", value: formatRawBytesAsMb(memory.usedJsHeapSize) },
      { label: "Heap total", value: formatRawBytesAsMb(memory.totalJsHeapSize) },
      { label: "Heap limit", value: formatRawBytesAsMb(memory.jsHeapSizeLimit) },
      {
        label: "Breakdown entries",
        value: formatMemoryDetailValue(memory.breakdownCount),
      },
      {
        label: "Cross-origin isolated",
        value: boolLabel(isolation.crossOriginIsolated),
      },
      {
        label: "Memory API available",
        value: boolLabel(isolation.memoryApiAvailable),
      },
      { label: "Memory API used", value: boolLabel(isolation.memoryApiUsed) },
    ],
    apiRows: [
      {
        label: "Heap pressure",
        value: formatMemoryDetailValue(apiHeapUsedPercent, "%", 1),
      },
      {
        label: "Heap used",
        value: formatMemoryDetailValue(apiMetrics?.heapUsedMb, "MB", 1),
      },
      {
        label: "Heap total",
        value: formatMemoryDetailValue(apiMetrics?.heapTotalMb, "MB", 1),
      },
      {
        label: "Heap limit",
        value: formatMemoryDetailValue(apiMetrics?.heapLimitMb, "MB", 1),
      },
      { label: "RSS", value: formatMemoryDetailValue(apiMetrics?.rssMb, "MB", 1) },
      {
        label: "External",
        value: formatMemoryDetailValue(apiMetrics?.externalMb, "MB", 1),
      },
      {
        label: "Array buffers",
        value: formatMemoryDetailValue(apiMetrics?.arrayBuffersMb, "MB", 1),
      },
      {
        label: "Event loop p95",
        value: formatMemoryDetailValue(apiMetrics?.eventLoopP95Ms, "ms", 1),
      },
    ],
    driverRows,
    thresholdRows: buildThresholdRows(),
  };
};
