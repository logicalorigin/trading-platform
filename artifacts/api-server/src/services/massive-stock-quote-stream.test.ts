import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  __massiveStockQuoteStreamInternalsForTests,
  getCurrentMassiveStockQuoteSnapshots,
} from "./massive-stock-quote-stream";

test.afterEach(() => {
  __massiveStockQuoteStreamInternalsForTests.reset();
});

test("Massive stock quote stream maps quote and trade messages to live snapshots", () => {
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "Q",
    sym: "SPY",
    bp: 500,
    ap: 500.2,
    bs: 10,
    as: 12,
    t: Date.parse("2026-05-27T20:30:00.000Z"),
  });
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "SPY",
    p: 500.12,
    s: 100,
    t: Date.parse("2026-05-27T20:30:01.000Z"),
  });

  const [quote] = getCurrentMassiveStockQuoteSnapshots(["SPY"]);

  assert.equal(quote?.symbol, "SPY");
  assert.equal(quote?.source, "massive");
  assert.equal(quote?.price, 500.12);
  assert.equal(quote?.bid, 500);
  assert.equal(quote?.ask, 500.2);
  assert.equal(quote?.freshness, "live");
  assert.equal(quote?.delayed, false);
});

test("Massive stock quote stream closes connecting sockets without unhandled errors", () => {
  const source = readFileSync(
    new URL("./massive-stock-quote-stream.ts", import.meta.url),
    "utf8",
  );

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
