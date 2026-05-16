import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountHeaderStrip.jsx", import.meta.url), "utf8");

test("strip renders a connection status dot derived from broker auth + account freshness", () => {
  assert.match(source, /const StatusDot\b/);
  assert.match(source, /resolveStatus\(brokerAuthenticated, accountFreshness\)/);
  assert.match(source, /<StatusDot tone=\{status\.tone\} title=\{status\.title\} \/>/);
});

test("strip resolves status to red when the bridge is not authenticated", () => {
  assert.match(source, /brokerAuthenticated === false[\s\S]+?tone:\s*T\.red/);
});

test("strip carries five metrics — Net, Cash, BP, Margin, Cushion", () => {
  assert.match(source, /label:\s*"Net"/);
  assert.match(source, /label:\s*"Cash"/);
  assert.match(source, /label:\s*"BP"/);
  assert.match(source, /label:\s*"Margin"/);
  assert.match(source, /label:\s*"Cushion"/);
  assert.doesNotMatch(source, /label:\s*"Day"/);
  assert.doesNotMatch(source, /label:\s*"Total"/);
});
