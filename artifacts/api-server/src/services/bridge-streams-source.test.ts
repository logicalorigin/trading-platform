import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridgeStreamsSource = readFileSync(
  new URL("./bridge-streams.ts", import.meta.url),
  "utf8",
);

test("account monitor skips routine IBKR equity quote demand under Massive realtime", () => {
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
  assert.match(requestBlock, /if \(options\.massiveStocksRealtime\) \{/);
  assert.match(requestBlock, /return null;/);
  assert.match(requestBlock, /requiresGreeks: !options\.massiveStocksRealtime/);

  assert.ok(prewarmBlock);
  assert.match(prewarmBlock, /isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(prewarmBlock, /clearAccountMonitorQuotePrewarm\(owner\)/);

  assert.ok(refreshBlock);
  assert.match(refreshBlock, /const massiveStocksRealtime = isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(refreshBlock, /marketDataRequestFromInstrument\(position, \{/);
  assert.match(refreshBlock, /marketDataRequestFromInstrument\(order, \{/);
});
