import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildMemoryPressureServerSummaryFromDiagnostics,
  buildResponseHeaderPressureSummary,
  mergeMemoryPressureRuntimeState,
  mergeMemoryPressureServerSummary,
} from "./useMemoryPressureSignal.js";

test("memory pressure monitor streams server diagnostics outside safe QA mode", () => {
  const source = readFileSync(
    new URL("./useMemoryPressureSignal.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /import \{ isPyrusSafeQaMode \}/);
  assert.match(source, /const safeQaMode = isPyrusSafeQaMode\(\)/);
  assert.match(source, /const DIAGNOSTICS_STREAM_URL = "\/api\/diagnostics\/stream"/);
  assert.match(source, /new window\.EventSource\(DIAGNOSTICS_STREAM_URL\)/);
  assert.match(source, /source\.addEventListener\("ready"/);
  assert.match(source, /source\.addEventListener\("snapshot"/);
  assert.match(source, /const workloadStats = useRuntimeWorkloadStats\(pageVisible\)/);
  assert.match(source, /if \(!streamDiagnosticsAvailable && !safeQaMode && now >= nextServerRefreshAtRef\.current\)/);
  assert.match(source, /const API_PRESSURE_EVENT = "pyrus:api-pressure"/);
  assert.match(source, /window\.addEventListener\(API_PRESSURE_EVENT, handleApiPressure\)/);
  assert.match(source, /buildResponseHeaderPressureSummary/);
});

test("memory pressure server summary can be built from streamed diagnostics snapshots", () => {
  const result = buildMemoryPressureServerSummaryFromDiagnostics({
    footerMemoryPressure: {
      level: "normal",
      apiHeapUsedPercent: 18.2,
      apiRssMb: 1450,
      apiRssThresholds: { watch: 2048, high: 3072, critical: 4096 },
      browserMemoryMb: 88,
      dominantDrivers: [],
    },
    snapshots: [
      {
        subsystem: "resource-pressure",
        metrics: {
          pressureLevel: "high",
          heapUsedPercent: 18.2,
          rssMb: 1450,
          apiRssThresholds: { watch: 2048, high: 3072, critical: 4096 },
          dominantDrivers: [
            {
              kind: "api-latency",
              label: "API latency",
              level: "high",
              detail: "2300 ms",
              score: 2300,
            },
          ],
        },
      },
    ],
  });

  assert.equal(result.level, "normal");
  assert.equal(result.apiRssMb, 1450);
  assert.equal(result.apiHeapUsedPercent, 18.2);
  assert.deepEqual(result.apiRssThresholds, {
    watch: 2048,
    high: 3072,
    critical: 4096,
  });
  assert.deepEqual(result.dominantDrivers, []);
});

test("memory pressure monitor honors stricter resource-pressure diagnostics", () => {
  const result = mergeMemoryPressureServerSummary({
    footerMemoryPressure: {
      level: "normal",
      apiHeapUsedPercent: 20.5,
      apiRssMb: 2603.6,
      apiRssThresholds: { watch: 2048, high: 3072, critical: 4096 },
      browserMemoryMb: 123,
      dominantDrivers: [],
    },
    resourceMetrics: {
      pressureLevel: "critical",
      heapUsedPercent: 20.5,
      rssMb: 2603.6,
      dominantDrivers: [
        {
          kind: "api-rss",
          label: "API RSS",
          level: "critical",
          detail: "2604 MB",
          score: 2603.6,
        },
      ],
    },
  });

  assert.equal(result.level, "critical");
  assert.equal(result.apiHeapUsedPercent, 20.5);
  assert.equal(result.apiRssMb, 2603.6);
  assert.deepEqual(result.apiRssThresholds, {
    watch: 2048,
    high: 3072,
    critical: 4096,
  });
  assert.equal(result.browserMemoryMb, 123);
  assert.equal(result.dominantDrivers[0].kind, "api-rss");
});

test("memory pressure monitor keeps scanner pressure out of footer level", () => {
  const result = mergeMemoryPressureServerSummary({
    footerMemoryPressure: {
      level: "normal",
      apiHeapUsedPercent: 20.5,
      browserMemoryMb: 123,
      dominantDrivers: [],
    },
    resourceMetrics: {
      pressureLevel: "normal",
      apiPressureLevel: "normal",
      apiResourcePressure: {
        level: "normal",
        scannerPressure: {
          level: "high",
          activeLongScanCount: 1,
          drivers: [
            {
              kind: "automation",
              label: "Signal-options automation",
              level: "high",
              detail: "1 long scan(s)",
            },
          ],
        },
      },
      dominantDrivers: [],
    },
  });

  assert.equal(result.level, "normal");
  assert.deepEqual(result.dominantDrivers, []);
});

test("memory pressure monitor keeps non-memory resource pressure out of footer level", () => {
  const result = mergeMemoryPressureServerSummary({
    footerMemoryPressure: {
      level: "normal",
      apiHeapUsedPercent: 18.2,
      browserMemoryMb: null,
      dominantDrivers: [],
    },
    resourceMetrics: {
      pressureLevel: "watch",
      apiPressureLevel: "watch",
      heapUsedPercent: 18.2,
      dominantDrivers: [
        {
          kind: "api-latency",
          label: "API latency",
          level: "watch",
          detail: "1250 ms",
          score: 1250,
        },
        {
          kind: "cache-pressure",
          label: "Cache pressure",
          level: "watch",
          detail: "watch",
          score: null,
        },
      ],
    },
  });

  assert.equal(result.level, "normal");
  assert.deepEqual(result.dominantDrivers, []);
});

test("memory pressure runtime state surfaces API RSS drivers in footer state", () => {
  const result = mergeMemoryPressureRuntimeState(
    {
      level: "normal",
      browserMemoryMb: 120,
      apiHeapUsedPercent: 22,
      sourceQuality: "low",
      pressureDrivers: [
        { kind: "browser-memory", label: "Browser memory", level: "normal" },
        { kind: "api-heap", label: "API heap", level: "normal" },
      ],
      dominantDrivers: [],
    },
    {
      level: "critical",
      rssMb: 1639.1,
      apiRssThresholds: { watch: 1000, high: 1500, critical: 2000 },
      apiHeapUsedPercent: 22,
      sourceQuality: "medium",
      dominantDrivers: [
        {
          kind: "api-rss",
          label: "API RSS",
          level: "critical",
          detail: "1639 MB",
          score: 1639.1,
        },
      ],
    },
  );

  assert.equal(result.level, "critical");
  assert.equal(result.apiRssMb, 1639.1);
  assert.deepEqual(result.apiRssThresholds, {
    watch: 1000,
    high: 1500,
    critical: 2000,
  });
  assert.equal(result.sourceQuality, "medium");
  assert.equal(result.pressureDrivers[0].kind, "api-rss");
  assert.equal(result.dominantDrivers[0].kind, "api-rss");
});

test("response pressure headers populate server pressure when diagnostics are shed", () => {
  const result = buildResponseHeaderPressureSummary(
    {
      pressureLevel: "critical",
      admissionAction: "shed",
      admissionReason: "api-resource-pressure-critical",
      status: 503,
      method: "GET",
      url: "/api/diagnostics/latest",
      observedAt: "2026-06-01T22:41:27.204Z",
    },
    null,
  );

  assert.equal(result.level, "critical");
  assert.equal(result.pressureLevel, "critical");
  assert.equal(result.apiPressureLevel, "critical");
  assert.equal(result.effectivePressureLevel, "critical");
  assert.equal(result.sourceQuality, "response-header");
  assert.equal(result.admissionAction, "shed");
  assert.equal(result.admissionReason, "api-resource-pressure-critical");
  assert.equal(result.lastHeaderStatus, 503);
});

test("response pressure headers keep stricter pressure briefly after shed", () => {
  const critical = buildResponseHeaderPressureSummary({
    pressureLevel: "critical",
    admissionAction: "shed",
    admissionReason: "api-resource-pressure-critical",
    status: 503,
    method: "GET",
    url: "/api/diagnostics/latest",
    observedAt: "2026-06-01T22:41:27.000Z",
  });

  const next = buildResponseHeaderPressureSummary(
    {
      pressureLevel: "watch",
      admissionAction: "allow",
      status: 200,
      method: "GET",
      url: "/api/session",
      observedAt: "2026-06-01T22:41:30.000Z",
    },
    critical,
  );

  assert.equal(next.effectivePressureLevel, "critical");
  assert.equal(next.pressureLevel, "critical");
  assert.equal(next.lastHeaderPressureLevel, "watch");
  assert.equal(next.lastHeaderStatus, 200);
});
