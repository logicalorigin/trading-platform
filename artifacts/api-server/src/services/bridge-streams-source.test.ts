import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridgeStreamsSource = readFileSync(
  new URL("./bridge-streams.ts", import.meta.url),
  "utf8",
);

test("account monitor keeps IBKR equity position demand under Massive realtime", () => {
  const requestBlock = bridgeStreamsSource.match(
    /function marketDataRequestFromInstrument\([\s\S]*?\n}\n\nfunction prewarmAccountMonitorQuotes/,
  )?.[0];
  const prewarmBlock = bridgeStreamsSource.match(
    /function prewarmAccountMonitorQuotes\([\s\S]*?\n}\n\nfunction clearAccountMonitorQuotePrewarm/,
  )?.[0];
  const refreshBlock = bridgeStreamsSource.match(
    /function refreshAccountMonitorLeases\([\s\S]*?\n}\n\nfunction updateAccountMonitorPositions/,
  )?.[0];

  assert.ok(requestBlock);
  assert.match(requestBlock, /massiveStocksRealtime/);
  assert.doesNotMatch(requestBlock, /if \(options\.massiveStocksRealtime\) \{\s*return null;\s*\}/);
  assert.match(requestBlock, /return symbol \? \{ assetClass: "equity", symbol \} : null;/);
  assert.match(requestBlock, /requiresGreeks: !options\.massiveStocksRealtime/);

  assert.ok(prewarmBlock);
  assert.match(prewarmBlock, /isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(prewarmBlock, /clearAccountMonitorQuotePrewarm\(owner\)/);

  assert.ok(refreshBlock);
  assert.match(refreshBlock, /const massiveStocksRealtime = isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(refreshBlock, /marketDataRequestFromInstrument\(position, \{/);
  assert.match(refreshBlock, /marketDataRequestFromInstrument\(order, \{/);
});

test("foreground equity quote SSE uses Massive when realtime stocks are configured", () => {
  const subscribeBlock = bridgeStreamsSource.match(
    /export function subscribeQuoteSnapshots\([\s\S]*?\n}\n\nexport function subscribePositionQuoteSnapshots/,
  )?.[0];

  assert.ok(subscribeBlock);
  assert.match(subscribeBlock, /isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(subscribeBlock, /subscribeMassiveStockQuoteSnapshots\(normalizedSymbols, onSnapshot\)/);
  assert.match(subscribeBlock, /subscribeBridgeQuoteSnapshots\(normalizedSymbols, onSnapshot\)/);
});

test("position quote SSE uses Massive when realtime stocks are configured", () => {
  const subscribeBlock = bridgeStreamsSource.match(
    /export function subscribePositionQuoteSnapshots\([\s\S]*?\n}\n\nexport function subscribeOptionChains/,
  )?.[0];

  assert.ok(subscribeBlock);
  assert.match(subscribeBlock, /isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(subscribeBlock, /subscribeMassiveStockQuoteSnapshots\(normalizedSymbols, onSnapshot\)/);
  assert.match(subscribeBlock, /subscribeBridgeQuoteSnapshots\(normalizedSymbols, onSnapshot\)/);
});
