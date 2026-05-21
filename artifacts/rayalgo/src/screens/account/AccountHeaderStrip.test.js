import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountHeaderStrip.jsx", import.meta.url), "utf8");

test("strip renders a connection status dot derived from broker auth + account freshness", () => {
  assert.match(source, /const StatusDot\b/);
  assert.match(source, /resolveStatus\(\s*brokerAuthenticated,\s*accountFreshness,\s*brokerFreshness,\s*shadowMode,/);
  assert.match(source, /<StatusDot tone=\{status\.tone\} title=\{status\.title\} \/>/);
});

test("strip distinguishes account stream freshness from broker realtime freshness", () => {
  assert.match(source, /brokerRealtimeFresh/);
  assert.match(source, /Account stream fresh · broker realtime fresh/);
  assert.match(source, /Account stream fresh · broker realtime stale/);
  assert.doesNotMatch(source, /Bridge live · account fresh/);
});

test("strip accepts the account section control at the right edge", () => {
  assert.match(source, /sectionControl = null/);
  assert.match(
    source,
    /<StatusDot tone=\{status\.tone\} title=\{status\.title\} \/>[\s\S]*<HeaderMetric key=\{metric\.label\} \{\.\.\.metric\} \/>[\s\S]*\{sectionControl \? \(/,
  );
  assert.match(source, /flex:\s*"1 1 0"/);
  assert.match(source, /overflowX:\s*"auto"/);
  assert.match(source, /marginLeft:\s*sp\(6\)/);
});

test("strip resolves status to red when the bridge is not authenticated", () => {
  assert.match(source, /brokerAuthenticated === false[\s\S]+?tone:\s*T\.red/);
});

test("strip keeps secondary account metrics while hero owns Net", () => {
  assert.doesNotMatch(source, /label:\s*"Net"/);
  assert.doesNotMatch(source, /metrics\.netLiquidation/);
  assert.match(source, /label:\s*"Cash"/);
  assert.match(source, /label:\s*"BP"/);
  assert.match(source, /label:\s*"Margin"/);
  assert.match(source, /label:\s*"Cushion"/);
  assert.doesNotMatch(source, /label:\s*"Day"/);
  assert.doesNotMatch(source, /label:\s*"Total"/);
});
