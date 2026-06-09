import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import {
  __bridgeStreamsInternalsForTests,
  resolvePositionQuoteStreamSource,
  subscribePositionQuoteSnapshots,
} from "./bridge-streams";
import {
  getBridgeQuoteStreamDiagnostics,
  __resetBridgeQuoteStreamForTests,
  __setBridgeQuoteRuntimeConfiguredForTests,
} from "./bridge-quote-stream";
import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
} from "./market-data-admission";
import {
  __resetRecentAccountPositionQuoteSymbolsForTests,
  recordRecentAccountPositionQuoteSymbols,
} from "./account-position-quote-symbols";

const source = readFileSync(new URL("./bridge-streams.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const start = source.indexOf(`export function ${name}`);
  const asyncStart = source.indexOf(`export async function ${name}`);
  const offset = start >= 0 ? start : asyncStart;
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextExport = source.indexOf("\nexport ", offset + 1);
  return source.slice(offset, nextExport >= 0 ? nextExport : source.length);
}

afterEach(() => {
  __resetBridgeQuoteStreamForTests();
  __resetMarketDataAdmissionForTests();
  __resetRecentAccountPositionQuoteSymbolsForTests();
});

test("position equity quote stream advertises IBKR bridge source", () => {
  assert.equal(resolvePositionQuoteStreamSource(), "ibkr-bridge");
});

test("position equity quote snapshots bypass Massive and fetch from IBKR bridge", () => {
  const body = functionSource("fetchPositionQuoteSnapshotPayload");
  assert.match(body, /const positionSymbols = filterPositionQuoteSymbols\(symbols\);/);
  assert.match(body, /return fetchBridgeQuoteSnapshots\(positionSymbols,\s*\{/);
  assert.match(body, /intent:\s*"account-monitor-live"/);
  assert.match(body, /fallbackProvider:\s*"none"/);
  assert.match(body, /hydrate:\s*false/);
  assert.doesNotMatch(body, /fetchQuoteSnapshotPayload/);
  assert.doesNotMatch(body, /isMassiveStocksRealtimeConfigured/);
});

test("market-depth snapshots require fresh authenticated IBKR health before bridge fetch", () => {
  const body = functionSource("fetchMarketDepthSnapshotPayload");

  assert.match(body, /getBridgeHealthForSession\(\{\s*waitForInitialRefresh:\s*false,\s*waitForStaleRefresh:\s*false,\s*\}\)/);
  assert.match(body, /health\.connected !== true/);
  assert.match(body, /health\.authenticated !== true/);
  assert.match(body, /health\.healthFresh === false/);
  assert.match(body, /code:\s*"ibkr_market_depth_unavailable"/);
  assert.match(body, /bridgeClient\.getMarketDepth\(input\)/);
});

test("position equity quote subscriptions bypass Massive and subscribe to IBKR bridge", () => {
  const body = functionSource("subscribePositionQuoteSnapshots");
  assert.match(body, /filterPositionQuoteSymbols\(requestedSymbols\)/);
  assert.match(body, /subscribeBridgeQuoteSnapshots\(\s*normalizedSymbols,\s*onSnapshot,/);
  assert.match(body, /ownerPrefix:\s*"account-position-quote-stream"/);
  assert.match(body, /intent:\s*"account-monitor-live"/);
  assert.match(body, /fallbackProvider:\s*"none"/);
  assert.match(body, /subscribeMarketDataLeaseChanges/);
  assert.match(body, /POSITION_QUOTE_SUBSCRIPTION_RECONCILE_MS/);
  assert.doesNotMatch(body, /fetchBridgeQuoteSnapshots\(normalizedSymbols/);
  assert.doesNotMatch(body, /if \(!normalizedSymbols\.length\)\s*\{\s*return \(\) => \{\};\s*\}/);
  assert.doesNotMatch(body, /subscribeMassiveStockQuoteSnapshots/);
  assert.doesNotMatch(body, /isMassiveStocksRealtimeConfigured/);
});

test("position equity quote stream filters to account-position account-monitor symbols", () => {
  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "account-position-option-quotes:U24762790:F",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "F" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "account-position-option-quotes:ui:ABT",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "ABT" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "account-position-quote-stream:stale-client",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "AAOI" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "bridge-quote-stream:1",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "NVDA" }],
    fallbackProvider: "massive",
  });

  assert.deepEqual(
    __bridgeStreamsInternalsForTests.filterPositionQuoteSymbols([
      "AAOI",
      "ABT",
      "F",
      "FCEL",
      "NVDA",
    ]),
    ["F", "FCEL"],
  );
});

test("position equity quote stream allows recently observed account-position symbols", () => {
  recordRecentAccountPositionQuoteSymbols("account-position-equity-quotes:U24762790", [
    "FCEL",
    "NVDA",
  ]);
  admitMarketDataLeases({
    owner: "account-position-quote-stream:stale-client",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "AAOI" }],
    fallbackProvider: "none",
  });

  assert.deepEqual(
    __bridgeStreamsInternalsForTests.filterPositionQuoteSymbols([
      "AAOI",
      "FCEL",
      "NVDA",
    ]),
    ["FCEL", "NVDA"],
  );
});

test("position equity quote stream does not subscribe when no account-position demand exists", () => {
  admitMarketDataLeases({
    owner: "account-position-quote-stream:stale-client",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
  });

  assert.deepEqual(
    __bridgeStreamsInternalsForTests.filterPositionQuoteSymbols(["FCEL"]),
    [],
  );
});

test("position equity quote subscriptions create a bridge consumer for account-position demand", () => {
  __setBridgeQuoteRuntimeConfiguredForTests(true);
  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "account-position-option-quotes:U24762790:F",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "F" }],
    fallbackProvider: "cache",
  });
  admitMarketDataLeases({
    owner: "account-position-option-quotes:U24762790:NVDA",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "NVDA" }],
    fallbackProvider: "cache",
  });

  const unsubscribe = subscribePositionQuoteSnapshots(
    ["FCEL", "F", "NVDA"],
    () => {},
  );

  assert.deepEqual(getBridgeQuoteStreamDiagnostics().desiredSymbols, [
    "F",
    "FCEL",
    "NVDA",
  ]);
  assert.equal(getBridgeQuoteStreamDiagnostics().activeConsumerCount, 1);

  unsubscribe();
});

test("position equity quote subscriptions reconcile when account-position demand arrives later", () => {
  __setBridgeQuoteRuntimeConfiguredForTests(true);

  const unsubscribe = subscribePositionQuoteSnapshots(["FCEL"], () => {});
  assert.equal(getBridgeQuoteStreamDiagnostics().activeConsumerCount, 0);

  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
  });

  assert.deepEqual(getBridgeQuoteStreamDiagnostics().desiredSymbols, ["FCEL"]);
  assert.equal(getBridgeQuoteStreamDiagnostics().activeConsumerCount, 1);

  unsubscribe();
});
