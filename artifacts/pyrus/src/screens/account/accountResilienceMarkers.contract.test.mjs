import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Contract guard for the backend-resilience "!" markers wired into the account
// panels (feat a43991a). There is no React-render test infra in pyrus, so this
// pins the wiring by source so a future edit can't silently break it. The two
// failure modes it defends against:
//   1. Silent no-op: the panel feeds the collector a `reason` only. The shared
//      collector (dataIssueModel) triggers ONLY on stale/degraded/fallback/error
//      — `reason` is descriptive text, never a trigger — so a marker keyed off
//      `reason` alone would never appear, and healthy vs never-fires look identical.
//   2. Lost healthy-state guard: the marker must stay hidden when there are no
//      issues, so a healthy account screen is visually unchanged.
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("Orders panel feeds the raw payload (degraded/stale triggers) and guards the marker", () => {
  const src = read("./TradesOrdersPanel.jsx");
  assert.match(src, /import \{ ResilienceMarker \}/);
  // Passes the whole payload; backend sets top-level degraded/stale on every
  // orders degradation path, which the collector triggers on.
  assert.match(src, /collectWidgetIssues\(query\.data, \{ valueLabel: "Orders", source: "broker" \}\)/);
  // Severity derived from the reason code (transient -> amber, hard -> red).
  assert.match(src, /severity=\{resilienceSeverityForReason\(ordersIssues\[0\]\?\.reason\)\}/);
  // Hidden when healthy.
  assert.match(src, /ordersIssues\.length \?/);
});

test("Equity Curve maps isStale -> stale (collector trigger) and guards the marker", () => {
  const src = read("./EquityCurvePanel.jsx");
  assert.match(src, /import \{ ResilienceMarker \}/);
  // The collector reads `stale`, not `isStale`; the panel MUST translate, or the
  // marker silently never fires.
  assert.match(src, /stale: query\.data\?\.isStale === true/);
  assert.match(src, /reason: query\.data\?\.staleReason/);
  assert.match(src, /equityIssues\.length \?/);
  assert.match(src, /<ResilienceMarker issues=\{equityIssues\}/);
});

test("Intraday P&L maps isStale -> stale (collector trigger) and guards the marker", () => {
  const src = read("./IntradayPnlPanel.jsx");
  assert.match(src, /import \{ ResilienceMarker \}/);
  assert.match(src, /stale: query\?\.data\?\.isStale === true/);
  assert.match(src, /reason: query\?\.data\?\.staleReason/);
  assert.match(src, /pnlIssues\.length \? <ResilienceMarker/);
});

