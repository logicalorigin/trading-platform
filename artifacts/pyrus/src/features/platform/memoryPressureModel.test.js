import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemoryPressureState,
  isPressureLevelAtLeast,
  MEMORY_PRESSURE_THRESHOLDS,
  resolveBrowserMemoryThresholds,
} from "./memoryPressureModel.js";
import { memoryPressureFillPercent } from "./FooterMemoryPressureIndicator.jsx";
import {
  buildMemoryPressurePopoverModel,
  formatMemoryThresholdValue,
} from "./memoryPressurePopoverModel.js";

test("memory pressure model stays normal for quiet workloads", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 96,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 42,
    activeWorkloadCount: 2,
    pollCount: 1,
    streamCount: 1,
    chartScopeCount: 2,
    prependScopeCount: 0,
    queryCount: 18,
    heavyQueryCount: 1,
    storeEntryCount: 20,
  });

  assert.equal(result.level, "normal");
  assert.equal(result.trend, "steady");
});

test("memory pressure model escalates on direct browser memory growth", () => {
  const result = buildMemoryPressureState(
    {
      browserMemoryMb: 340,
      browserSource: "performance.memory",
      browserMemoryLimitMb: 512,
      apiHeapUsedPercent: 55,
      activeWorkloadCount: 7,
      pollCount: 3,
      streamCount: 3,
      chartScopeCount: 8,
      prependScopeCount: 1,
      queryCount: 72,
      heavyQueryCount: 12,
      storeEntryCount: 64,
    },
    {
      history: [{ score: 8, level: "watch" }],
    },
  );

  assert.equal(result.level, "watch");
  assert.equal(result.trend, "rising");
  assert.ok(
    result.dominantDrivers.some((driver) => driver.kind === "browser-memory"),
  );
});

test("memory pressure model stays normal after direct memory recovery", () => {
  const result = buildMemoryPressureState(
    {
      browserMemoryMb: 178,
      browserSource: "performance.memory",
      apiHeapUsedPercent: 68,
      activeWorkloadCount: 7,
      pollCount: 3,
      streamCount: 2,
      chartScopeCount: 7,
      prependScopeCount: 0,
      queryCount: 60,
      heavyQueryCount: 6,
      storeEntryCount: 28,
    },
    {
      previousState: { level: "watch", score: 34 },
      history: [{ score: 35, level: "watch" }, { score: 31, level: "watch" }],
    },
  );

  assert.equal(result.level, "normal");
  assert.equal(isPressureLevelAtLeast(result.level, "watch"), false);
});

test("memory pressure model releases stale critical state when current drivers are not critical", () => {
  const result = buildMemoryPressureState(
    {
      browserMemoryMb: 40,
      browserSource: "performance.memory",
      apiHeapUsedPercent: 31,
      activeWorkloadCount: 7,
      pollCount: 6,
      streamCount: 1,
      chartScopeCount: 18,
      prependScopeCount: 0,
      queryCount: 85,
      heavyQueryCount: 4,
      storeEntryCount: 24,
    },
    {
      previousState: { level: "critical", score: 22 },
      history: [{ score: 22, level: "critical" }],
    },
  );

  assert.equal(result.level, "normal");
  assert.equal(
    result.dominantDrivers.some((driver) => driver.level === "critical"),
    false,
  );
});

test("memory pressure model does not mark normal poll fanout as critical", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 40,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 40,
    activeWorkloadCount: 8,
    pollCount: 7,
    streamCount: 1,
    chartScopeCount: 13,
    prependScopeCount: 0,
    queryCount: 79,
    heavyQueryCount: 4,
    storeEntryCount: 24,
  });

  assert.equal(result.level, "normal");
  assert.equal(
    result.pressureDrivers.find((driver) => driver.kind === "workload")
      ?.metrics.find((metric) => metric.key === "pollCount")?.level,
    "normal",
  );
});

test("memory pressure model treats active worker count as metadata only", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 40,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 30,
    activeWorkloadCount: 50,
    pollCount: 30,
    streamCount: 15,
    chartScopeCount: 2,
    prependScopeCount: 0,
    queryCount: 8,
    heavyQueryCount: 0,
    storeEntryCount: 12,
  });

  const workloadDriver = result.pressureDrivers.find(
    (driver) => driver.kind === "workload",
  );

  assert.equal(result.level, "normal");
  assert.equal(result.score, 0);
  assert.equal(workloadDriver?.level, "normal");
  assert.equal(
    workloadDriver?.metrics.find((metric) => metric.key === "activeWorkloadCount")
      ?.value,
    50,
  );
  assert.equal(
    workloadDriver?.metrics.find((metric) => metric.key === "pollCount")?.level,
    "normal",
  );
  assert.deepEqual(result.dominantDrivers, []);
});

test("memory pressure thresholds are exported for detail views", () => {
  assert.deepEqual(
    MEMORY_PRESSURE_THRESHOLDS.browserMemoryMb["performance.memory"],
    { watch: 1000, high: 1500, critical: 2500 },
  );
  assert.deepEqual(
    MEMORY_PRESSURE_THRESHOLDS.browserHeapLimitRatio,
    { watch: 0.6, high: 0.75, critical: 0.9 },
  );
  assert.deepEqual(
    resolveBrowserMemoryThresholds({
      source: "performance.memory",
      limitMb: 4096,
    }),
    { watch: 2457.6, high: 3072, critical: 3686.4 },
  );
  assert.deepEqual(
    MEMORY_PRESSURE_THRESHOLDS.apiHeapUsedPercent,
    { watch: 70, high: 78, critical: 85 },
  );
  assert.equal(
    formatMemoryThresholdValue(
      MEMORY_PRESSURE_THRESHOLDS.chartHydration.chartScopeCount.critical,
      "MB",
    ),
    "none",
  );
});

test("memory pressure model returns full driver threshold breakdown", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 421,
    browserSource: "performance.memory",
    browserMemoryLimitMb: 460,
    apiHeapUsedPercent: 79,
    activeWorkloadCount: 12,
    pollCount: 2,
    streamCount: 2,
    chartScopeCount: 2,
    prependScopeCount: 4,
    queryCount: 20,
    heavyQueryCount: 55,
    storeEntryCount: 181,
  });

  assert.equal(result.pressureDrivers.length, 6);
  assert.equal(
    result.pressureDrivers.find((driver) => driver.kind === "browser-memory")
      ?.level,
    "critical",
  );
  assert.equal(
    result.pressureDrivers.find((driver) => driver.kind === "api-heap")?.level,
    "high",
  );
  assert.equal(
    result.pressureDrivers
      .find((driver) => driver.kind === "query-cache")
      ?.metrics.find((metric) => metric.key === "heavyQueryCount")?.level,
    "critical",
  );
  assert.equal(
    result.dominantDrivers.some(
      (driver) => driver.kind === "query-cache" || driver.kind === "runtime-stores",
    ),
    false,
  );
});

test("memory pressure model does not mark 600 MB browser heap as critical when far below browser limit", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 600,
    browserMemoryLimitMb: 4096,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 30,
    activeWorkloadCount: 2,
    pollCount: 1,
    streamCount: 1,
    chartScopeCount: 2,
    prependScopeCount: 0,
    queryCount: 12,
    heavyQueryCount: 0,
    storeEntryCount: 12,
  });
  const browserDriver = result.pressureDrivers.find(
    (driver) => driver.kind === "browser-memory",
  );
  const browserMetric = browserDriver?.metrics.find(
    (metric) => metric.key === "browserMemoryMb",
  );

  assert.equal(result.level, "normal");
  assert.equal(browserDriver?.level, "normal");
  assert.equal(result.browserMemoryLimitMb, 4096);
  assert.deepEqual(browserMetric?.thresholds, {
    watch: 2457.6,
    high: 3072,
    critical: 3686.4,
  });
});

test("memory pressure model keeps non-memory workload pressure out of footer level", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 40,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 30,
    activeWorkloadCount: 25,
    pollCount: 15,
    streamCount: 8,
    chartScopeCount: 50,
    prependScopeCount: 5,
    queryCount: 300,
    heavyQueryCount: 60,
    storeEntryCount: 220,
  });

  assert.equal(result.level, "normal");
  assert.equal(result.score, 0);
  assert.deepEqual(result.dominantDrivers, []);
  assert.equal(
    result.pressureDrivers.find((driver) => driver.kind === "workload")?.level,
    "normal",
  );
  assert.equal(
    result.pressureDrivers.find((driver) => driver.kind === "query-cache")?.level,
    "critical",
  );
});

test("memory pressure popover ignores non-memory critical drivers as critical reason", () => {
  const pressure = buildMemoryPressureState({
    browserMemoryMb: 40,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 30,
    activeWorkloadCount: 25,
    pollCount: 15,
    streamCount: 8,
    chartScopeCount: 50,
    prependScopeCount: 5,
    queryCount: 300,
    heavyQueryCount: 60,
    storeEntryCount: 220,
  });
  const model = buildMemoryPressurePopoverModel(pressure);

  assert.equal(model.level, "normal");
  assert.equal(model.criticalReason, null);
});

test("memory pressure popover model includes diagnostics backed RAM details", () => {
  const pressure = buildMemoryPressureState({
    browserMemoryMb: 96,
    browserMemoryLimitMb: 512,
    browserSource: "performance.memory",
    sourceQuality: "medium",
    apiHeapUsedPercent: 72.5,
    activeWorkloadCount: 1,
    pollCount: 0,
    streamCount: 0,
    chartScopeCount: 0,
    prependScopeCount: 0,
    queryCount: 4,
    heavyQueryCount: 0,
    storeEntryCount: 8,
  });
  const model = buildMemoryPressurePopoverModel(
    {
      ...pressure,
      measurement: {
        memory: {
          source: "performance.memory",
          usedJsHeapSize: 64 * 1024 * 1024,
          totalJsHeapSize: 128 * 1024 * 1024,
          jsHeapSizeLimit: 512 * 1024 * 1024,
        },
        isolation: {
          crossOriginIsolated: false,
          memoryApiAvailable: true,
          memoryApiUsed: false,
        },
      },
    },
    {
      snapshots: [
        {
          subsystem: "resource-pressure",
          metrics: {
            heapUsedPercent: 72.5,
            heapUsedMb: 128.25,
            heapTotalMb: 256,
            heapLimitMb: 4096,
            rssMb: 512,
            externalMb: 12,
            arrayBuffersMb: 6,
            eventLoopP95Ms: 3.2,
          },
        },
      ],
    },
  );

  assert.equal(
    model.browserRows.find((row) => row.label === "Used heap")?.value,
    "64 MB",
  );
  assert.equal(
    model.browserRows.find((row) => row.label === "Reported limit")?.value,
    "512 MB",
  );
  assert.equal(
    model.apiRows.find((row) => row.label === "Heap used")?.value,
    "128.3 MB",
  );
  assert.equal(model.apiRows.find((row) => row.label === "RSS")?.value, "512 MB");
  assert.ok(
    model.thresholdRows.some(
      (row) =>
        row.label === "performance.memory" &&
        row.summary.includes("critical 2500 MB"),
    ),
  );
  assert.ok(
    model.thresholdRows.some(
      (row) =>
        row.label === "Limit ratio" &&
        row.summary.includes("critical 90%"),
    ),
  );
  assert.ok(model.driverRows.some((row) => row.kind === "api-heap"));
});

test("memory pressure footer fill uses score with level fallback", () => {
  assert.equal(memoryPressureFillPercent({ score: 67.2, level: "normal" }), 67);
  assert.equal(memoryPressureFillPercent({ score: -4, level: "critical" }), 0);
  assert.equal(memoryPressureFillPercent({ score: 133, level: "critical" }), 100);
  assert.equal(memoryPressureFillPercent({ level: "high" }), 68);
});

test("memory pressure popover separates load score from critical driver", () => {
  const model = buildMemoryPressurePopoverModel({
    level: "critical",
    score: 50,
    trend: "steady",
    pressureDrivers: [
      {
        kind: "browser-memory",
        label: "Browser memory",
        level: "critical",
        detail: "900 MB",
        contribution: 48,
      },
    ],
  });

  assert.equal(
    model.statusRows.find((row) => row.label === "Load score")?.value,
    "50 pts",
  );
  assert.equal(model.criticalReason, "Browser memory 900 MB");
});
