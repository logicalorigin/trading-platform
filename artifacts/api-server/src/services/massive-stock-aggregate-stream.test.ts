import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shared Massive stock stream closes connecting sockets without unhandled errors", () => {
  const source = readFileSync(
    new URL("./massive-stock-websocket.ts", import.meta.url),
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

test("aggregate and quote stream modules do not open separate Massive stock sockets", () => {
  const aggregateSource = readFileSync(
    new URL("./massive-stock-aggregate-stream.ts", import.meta.url),
    "utf8",
  );
  const quoteSource = readFileSync(
    new URL("./massive-stock-quote-stream.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(aggregateSource, /new WebSocket/);
  assert.doesNotMatch(quoteSource, /new WebSocket/);
  assert.match(aggregateSource, /subscribeMassiveStockWebSocket/);
  assert.match(quoteSource, /subscribeMassiveStockWebSocket/);
});
