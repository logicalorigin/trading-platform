import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Polygon delayed stock stream closes connecting sockets without unhandled errors", () => {
  const source = readFileSync(
    new URL("./polygon-delayed-stream.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /function recordSocketError/);
  assert.match(source, /currentSocket\.on\("error"/);
  assert.match(
    source,
    /currentSocket\.readyState === WebSocket\.CONNECTING[\s\S]*currentSocket\.terminate\(\)/,
  );
  assert.match(
    source,
    /socket && socket\.readyState === WebSocket\.CONNECTING[\s\S]*return;/,
  );
  assert.doesNotMatch(source, /removeAllListeners\(\);\s*socket\.close\(\)/);
});
