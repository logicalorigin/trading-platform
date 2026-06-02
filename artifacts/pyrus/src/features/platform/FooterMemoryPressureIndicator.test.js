import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/tooltip.tsx";
import { FooterMemoryPressureIndicator } from "./FooterMemoryPressureIndicator.jsx";

const renderIndicator = (signal) =>
  renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(FooterMemoryPressureIndicator, { signal }),
    ),
  );

test("footer memory pressure compact label renders four horizontal consumption bars", () => {
  const html = renderIndicator({
    level: "high",
    score: 72,
    trend: "rising",
    browserMemoryMb: 412,
    browserSource: "performance.memory",
    apiRssMb: 1024,
    apiRssThresholds: { watch: 2048, high: 3072, critical: 4096 },
    apiHeapUsedPercent: 38,
    activeWorkloadCount: 4,
    storeEntryCount: 64,
    pressureDrivers: [
      { kind: "browser-memory", level: "high", score: 69 },
      { kind: "api-rss", level: "normal", score: 1024 },
      { kind: "api-heap", level: "watch", score: 38 },
      { kind: "workload", level: "normal", score: 4 },
      { kind: "runtime-stores", level: "watch", score: 64 },
    ],
    dominantDrivers: [],
  });

  assert.match(html, /data-testid="footer-memory-pressure-mini-cluster"/);
  assert.match(html, /data-cluster-expanded="true"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-browser"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-api-rss"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-api-heap"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-runtime"/);

  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-browser" style="[^"]*width:98%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-api-rss" style="[^"]*width:25%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-api-heap" style="[^"]*width:38%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-runtime" style="[^"]*width:36%/,
  );

  assert.match(html, /Browser 412M/);
  assert.match(html, /RSS 1024M/);
  assert.match(html, /Heap 38%/);
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
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-api-rss"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-api-heap"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-runtime"/);
  assert.match(html, /Browser --/);
  assert.match(html, /RSS --/);
  assert.match(html, /Heap --/);
  assert.match(html, /Runtime 0/);
  assert.equal(
    (html.match(/data-testid="footer-memory-pressure-mini-fill-[^"]+" style="[^"]*width:0%/g) || [])
      .length,
    4,
  );
});

test("footer memory pressure mini bars scale API RSS from backend thresholds", () => {
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

  assert.match(html, /RSS 1639M/);
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-api-rss" style="[^"]*width:82%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-api-heap" style="[^"]*width:22%/,
  );
  assert.doesNotMatch(html, /style="[^"]*width:100%[^"]*"[^>]*footer-memory-pressure-mini-fill-api-rss/);
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
  assert.match(source, /const MiniPressureBars = \(\{ signal, showLabels = true \}\) =>/);
  assert.match(source, /MEMORY_PRESSURE_THRESHOLDS\.runtimeStores\.storeEntryCount/);
  assert.match(source, /data-cluster-expanded="true"/);
  assert.doesNotMatch(source, /setHovered/);
  assert.doesNotMatch(source, /forceExpanded/);
  assert.match(source, /<MiniPressureBars signal=\{signal\} showLabels=\{preferences\.showCompactLabel\} \/>/);
  assert.match(source, /<AppTooltip key=\{bar\.key\} content=\{bar\.detail\}>/);
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
