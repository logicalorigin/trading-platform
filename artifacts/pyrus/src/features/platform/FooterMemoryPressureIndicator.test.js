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

test("footer memory pressure compact label renders mini bar slots", () => {
  const html = renderIndicator({
    level: "high",
    score: 72,
    trend: "rising",
    browserMemoryMb: 412,
    apiHeapUsedPercent: 38,
    activeWorkloadCount: 4,
    pressureDrivers: [
      { kind: "browser-memory", level: "high", score: 69 },
      { kind: "api-heap", level: "watch", score: 38 },
      { kind: "workload", level: "normal", score: 25 },
    ],
    dominantDrivers: [],
  });

  assert.match(html, /data-testid="footer-memory-pressure-mini-cluster"/);
  assert.match(html, /data-cluster-expanded="true"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-browser"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-api"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-workload"/);

  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-browser" style="[^"]*height:69%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-api" style="[^"]*height:38%/,
  );
  assert.match(
    html,
    /data-testid="footer-memory-pressure-mini-fill-workload" style="[^"]*height:25%/,
  );

  assert.match(html, /Browser 412M/);
  assert.match(html, /API 38%/);
  assert.match(html, /Workload 4/);
  assert.doesNotMatch(html, /Browser 412M · API/);
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
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-api"/);
  assert.match(html, /data-testid="footer-memory-pressure-mini-slot-workload"/);
  assert.match(html, /Browser --/);
  assert.match(html, /API --/);
  assert.match(html, /Workload 0/);
  assert.equal(
    (html.match(/data-testid="footer-memory-pressure-mini-fill-[^"]+" style="[^"]*height:0%/g) || [])
      .length,
    3,
  );
});

test("footer memory pressure mini bars keep metric labels visible", () => {
  const source = readFileSync(
    new URL("./FooterMemoryPressureIndicator.jsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(source, /import \{ AppTooltip \} from "@\/components\/ui\/tooltip"/);
  assert.match(source, /const MiniPressureBars = \(\{ signal \}\) =>/);
  assert.match(source, /data-cluster-expanded="true"/);
  assert.doesNotMatch(source, /setHovered/);
  assert.doesNotMatch(source, /forceExpanded/);
  assert.match(source, /preferences\.showCompactLabel \? <MiniPressureBars signal=\{signal\} \/> : null/);
  assert.match(source, /<AppTooltip key=\{bar\.key\} content=\{bar\.detail\}>/);

  assert.match(css, /\.ra-pressure-mini-cluster \{[\s\S]*?max-width: 240px/);
  assert.match(css, /\.ra-pressure-mini-label \{[\s\S]*?max-width: 80px/);
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
