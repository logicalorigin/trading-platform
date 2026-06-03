import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/tooltip.tsx";
import {
  FooterApiSourcePressureIndicator,
  FooterMemoryPressureIndicator,
  buildApiSourcePressureBars,
} from "./FooterMemoryPressureIndicator.jsx";

const renderIndicator = (signal) =>
  renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(FooterMemoryPressureIndicator, { signal }),
    ),
  );

const renderApiSourceIndicator = (runtimeControl) =>
  renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(FooterApiSourcePressureIndicator, { runtimeControl }),
    ),
  );

test("footer API source pressure renders separate IBKR and Massive bars", () => {
  const html = renderApiSourceIndicator({
    lineUsage: {
      available: true,
      summary: "171 of 200",
      warnings: 0,
      total: {
        used: 171,
        cap: 200,
        free: 29,
        streamState: "healthy",
      },
      bridge: {
        used: 171,
        cap: 200,
        streamState: "healthy",
      },
    },
    massive: {
      configured: true,
      status: "ok",
      label: "OK",
      rest: {
        status: "ok",
        label: "OK",
        lastRequestSummary: "bars SPY 1 minute · 2 rows",
      },
      websocket: {
        status: "ok",
        label: "OK",
        channelSummary: "AM, Q, T",
        subscribedSymbolCount: 12,
      },
    },
  });

  assert.match(html, /data-testid="footer-api-source-pressure-cluster"/);
  assert.match(html, /data-testid="footer-api-source-pressure-slot-ibkr"/);
  assert.match(html, /data-testid="footer-api-source-pressure-slot-massive"/);
  assert.match(
    html,
    /data-testid="footer-api-source-pressure-fill-ibkr" style="[^"]*width:86%/,
  );
  assert.match(
    html,
    /data-testid="footer-api-source-pressure-fill-massive" style="[^"]*width:18%/,
  );
  assert.match(html, /IBKR 171\/200/);
  assert.match(html, /Massive OK/);
});

test("footer API source pressure keeps fallback provider slots", () => {
  const bars = buildApiSourcePressureBars(null);
  assert.deepEqual(
    bars.map((bar) => [bar.key, bar.level, bar.fillPercent, bar.label]),
    [
      ["ibkr", "normal", 0, "IBKR --"],
      ["massive", "normal", 0, "Massive --"],
    ],
  );

  const html = renderApiSourceIndicator(null);
  assert.match(html, /data-testid="footer-api-source-pressure-slot-ibkr"/);
  assert.match(html, /data-testid="footer-api-source-pressure-slot-massive"/);
  assert.match(html, /IBKR --/);
  assert.match(html, /Massive --/);
});

test("footer API source pressure maps Massive degradation without a fake quota", () => {
  const bars = buildApiSourcePressureBars({
    massive: {
      configured: true,
      status: "degraded",
      label: "Degraded",
      rest: {
        status: "degraded",
        label: "Degraded",
        lastError: "429 rate limit",
      },
      websocket: {
        status: "ok",
        label: "OK",
      },
    },
  });
  const massive = bars.find((bar) => bar.key === "massive");

  assert.equal(massive.level, "high");
  assert.equal(massive.fillPercent, 88);
  assert.equal(massive.detail, "Massive Degraded · 429 rate limit");
});

test("footer memory pressure compact label renders non-provider consumption bars", () => {
  const html = renderIndicator({
    level: "high",
    score: 72,
    trend: "rising",
    browserMemoryMb: 412,
    browserMemoryLimitMb: 4096,
    browserSource: "performance.memory",
    apiRssMb: 1024,
    apiRssThresholds: { watch: 2048, high: 3072, critical: 4096 },
    apiHeapUsedPercent: 38,
    activeWorkloadCount: 4,
    queryCount: 80,
    heavyQueryCount: 10,
    storeEntryCount: 64,
    pressureDrivers: [
      { kind: "browser-memory", level: "high", score: 69 },
      { kind: "api-rss", level: "normal", score: 1024 },
      { kind: "api-heap", level: "watch", score: 38 },
      { kind: "query-cache", level: "watch", score: 80 },
      { kind: "workload", level: "normal", score: 4 },
      { kind: "runtime-stores", level: "watch", score: 64 },
    ],
    dominantDrivers: [],
  });

  assert.match(html, /data-testid="footer-memory-pressure-mini-cluster"/);
  assert.match(html, /data-cluster-expanded="true"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-browser"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-cache"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-runtime"/);
  assert.doesNotMatch(html, /data-testid="footer-memory-pressure-mini-slot-api"/);
  assert.doesNotMatch(html, /data-testid="footer-memory-pressure-mini-slot-api-heap"/);

  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-browser" style="[^"]*width:11%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-cache" style="[^"]*width:33%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-runtime" style="[^"]*width:36%/,
  );

  assert.match(html, /Browser 412M/);
  assert.match(html, /Cache 80/);
  assert.match(html, /Runtime 64/);
  assert.doesNotMatch(html, /height:69%/);
});

test("footer memory pressure mini bars keep empty fallback slots", () => {
  const html = renderIndicator({
    level: "normal",
    score: 12,
    trend: "steady",
    pressureDrivers: [],
    dominantDrivers: [],
  });

  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-browser"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-cache"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-runtime"/);
  assert.doesNotMatch(html, /data-testid="footer-memory-pressure-mini-slot-api"/);
  assert.match(html, /Browser --/);
  assert.match(html, /Cache --/);
  assert.match(html, /Runtime 0/);
  assert.equal(
    (html.match(/data-testid="footer-memory-pressure-mini-fill-[^"]+" style="[^"]*width:0%/g) || [])
      .length,
    3,
  );
});

test("footer memory pressure mini bars keep API process memory out of compact provider bar space", () => {
  const html = renderIndicator({
    level: "critical",
    score: 92,
    trend: "rising",
    browserMemoryMb: 180,
    apiHeapUsedPercent: 22,
    apiRssMb: 1639,
    apiRssThresholds: { watch: 1000, high: 1500, critical: 2000 },
    activeWorkloadCount: 2,
    storeEntryCount: 12,
    pressureDrivers: [
      {
        kind: "api-rss",
        label: "API RSS",
        level: "critical",
        detail: "1639 MB",
        score: 1639,
      },
      { kind: "api-heap", label: "API heap", level: "normal", score: 22 },
      { kind: "workload", label: "Active workload", level: "normal", score: 2 },
      { kind: "runtime-stores", label: "Runtime stores", level: "normal", score: 12 },
    ],
    dominantDrivers: [
      {
        kind: "api-rss",
        label: "API RSS",
        level: "critical",
        detail: "1639 MB",
      },
    ],
  });

  assert.doesNotMatch(html, /data-testid="footer-memory-pressure-mini-slot-api"/);
  assert.doesNotMatch(html, /data-testid="footer-memory-pressure-mini-fill-api"/);
  assert.match(html, /API RSS 1639M/);
});

test("footer memory pressure shows level instead of score percent", () => {
  const html = renderIndicator({
    level: "critical",
    score: 50,
    trend: "steady",
    browserMemoryMb: 900,
    apiHeapUsedPercent: 44,
    activeWorkloadCount: 2,
    pressureDrivers: [
      {
        kind: "browser-memory",
        label: "Browser memory",
        level: "critical",
        score: 900,
      },
    ],
    dominantDrivers: [
      {
        kind: "browser-memory",
        label: "Browser memory",
        level: "critical",
        detail: "900 MB",
      },
    ],
  });

  assert.match(html, />critical</);
  assert.doesNotMatch(html, />50%<\/span>/);
});

test("footer memory pressure mini bars keep metric labels visible", () => {
  const source = readFileSync(
    new URL("./FooterMemoryPressureIndicator.jsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(source, /import \{ AppTooltip \} from "@\/components\/ui\/tooltip"/);
  assert.match(source, /FailurePointContent/);
  assert.match(source, /buildMemoryPressureFailurePoint/);
  assert.match(source, /const MiniPressureBars = \(\{ signal, showLabels = true \}\) =>/);
  assert.match(source, /MEMORY_PRESSURE_THRESHOLDS\.queryCache\.queryCount/);
  assert.match(source, /MEMORY_PRESSURE_THRESHOLDS\.runtimeStores\.storeEntryCount/);
  assert.match(source, /data-cluster-expanded="true"/);
  assert.doesNotMatch(source, /setHovered/);
  assert.doesNotMatch(source, /forceExpanded/);
  assert.match(source, /<MiniPressureBars signal=\{signal\} showLabels=\{preferences\.showCompactLabel\} \/>/);
  assert.match(source, /content=\{<FailurePointContent point=\{failurePoint\} compact \/>/);
  assert.doesNotMatch(source, /width: dim\(64\)/);

  assert.match(css, /\.ra-pressure-mini-cluster \{[\s\S]*?max-width: 360px/);
  assert.match(css, /\.ra-pressure-mini-label \{[\s\S]*?max-width: 72px/);
  assert.match(css, /\.ra-pressure-mini-label \{[\s\S]*?opacity: 1/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-pressure-mini-cluster,[\s\S]*?\.ra-pressure-mini-label[\s\S]*?transition: opacity/,
  );
  assert.match(
    css,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-pressure-mini-cluster,[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \.ra-pressure-mini-label/,
  );
});
