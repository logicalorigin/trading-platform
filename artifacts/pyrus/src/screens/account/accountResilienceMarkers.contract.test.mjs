import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Account history failures are explicit query errors. These guards prevent the
// retired stale/degraded response metadata from reintroducing cached-history UI.
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("Orders panel rejects retired degraded/stale snapshot metadata", () => {
  const src = read("./TradesOrdersPanel.jsx");
  assert.doesNotMatch(src, /collectWidgetIssues\(query\.data/);
  assert.doesNotMatch(src, /ordersIssues/);
  assert.match(src, /error=\{query\.error\}/);
});

test("Equity Curve rejects retired stale-history presentation metadata", () => {
  const src = read("./EquityCurvePanel.jsx");
  assert.doesNotMatch(src, /isStale|staleReason|equityIssues/);
  assert.doesNotMatch(src, /ResilienceMarker|collectWidgetIssues/);
});

test("Intraday P&L rejects retired stale-history presentation metadata", () => {
  const src = read("./IntradayPnlPanel.jsx");
  assert.doesNotMatch(src, /isStale|staleReason|pnlIssues/);
  assert.doesNotMatch(src, /ResilienceMarker|collectWidgetIssues/);
});
