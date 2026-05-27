import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import {
  __buildWatchlistPrewarmLineRequestsForTests,
  __getWatchlistPrewarmBridgeSyncBlockReasonForTests,
  __orderWatchlistWarmupSymbolsForTests,
  resolveIbkrWatchlistPrewarmSymbolLimit,
} from "./platform";
import { __resetMarketDataAdmissionForTests } from "./market-data-admission";
import { __resetApiResourcePressureForTests } from "./resource-pressure";

const PREWARM_LIMIT_ENV_NAME = "IBKR_MARKET_DATA_VISIBLE_LINES";
const originalValues = new Map(
  [PREWARM_LIMIT_ENV_NAME].map((name) => [name, process.env[name]]),
);

afterEach(() => {
  __resetMarketDataAdmissionForTests();
  __resetApiResourcePressureForTests();
  for (const [name, value] of originalValues) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("watchlist prewarm defaults to visible scanner-aware capacity", () => {
  delete process.env[PREWARM_LIMIT_ENV_NAME];

  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 90);
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(200), 120);
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(12), 12);
});

test("visible line env override can lower or raise the prewarm cap", () => {
  process.env[PREWARM_LIMIT_ENV_NAME] = "24";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 24);

  process.env[PREWARM_LIMIT_ENV_NAME] = "120";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 90);

  process.env[PREWARM_LIMIT_ENV_NAME] = "0";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 0);
});

test("api startup owns watchlist prewarm before background flow scanning", () => {
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const watchlistStart = indexSource.indexOf("startIbkrWatchlistPrewarmRuntime();");
  const flowStart = indexSource.indexOf("startOptionsFlowScanner();");

  assert.notEqual(watchlistStart, -1);
  assert.notEqual(flowStart, -1);
  assert.ok(watchlistStart < flowStart);
});

test("watchlist runtime reconciles bridge prewarm groups before DB resync", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const runtimeStart = platformSource.indexOf(
    "export function startIbkrWatchlistPrewarmRuntime",
  );
  const runtimeEnd = platformSource.indexOf(
    "subscribeMarketDataLeaseChanges",
    runtimeStart,
  );
  const runtimeBlock = platformSource.slice(runtimeStart, runtimeEnd);
  const startupReconcile = runtimeBlock.indexOf(
    'reconcileIbkrWatchlistPrewarmFromBridgeSoon("startup")',
  );
  const startupDbResync = runtimeBlock.indexOf(
    'scheduleIbkrWatchlistPrewarmFromDbSoon("startup")',
  );

  assert.notEqual(runtimeStart, -1);
  assert.ok(startupReconcile >= 0);
  assert.ok(startupDbResync >= 0);
  assert.ok(startupReconcile < startupDbResync);
  assert.match(
    runtimeBlock,
    /reconcileIbkrWatchlistPrewarmFromBridgeSoon\("runtime-resync"\)/,
  );
});

test("empty watchlist prewarm requests cancel in-flight prewarm work", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const emptyRequestStart = platformSource.indexOf("if (!requestedSignature) {");
  const emptyRequestEnd = platformSource.indexOf("if (requestedSignature === pendingIbkrWatchlistPrewarmSignature)", emptyRequestStart);
  const emptyRequestBlock = platformSource.slice(emptyRequestStart, emptyRequestEnd);

  assert.match(emptyRequestBlock, /ibkrWatchlistPrewarmSequence \+= 1;/);
  assert.match(emptyRequestBlock, /pendingIbkrWatchlistPrewarmSignature = null;/);
});

test("watchlist prewarm submits all lane sources to the lane policy resolver", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const resolverStart = platformSource.indexOf(
    "function resolveEquityLiveQuoteLaneSymbols",
  );
  const resolverEnd = platformSource.indexOf(
    "function collectWatchlistSymbols",
    resolverStart,
  );
  const resolverBlock = platformSource.slice(resolverStart, resolverEnd);
  const prewarmBody = platformSource.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];

  assert.notEqual(resolverStart, -1);
  assert.match(resolverBlock, /getOptionsFlowLaneSourceSymbols\(\)/);
  assert.match(resolverBlock, /"flow-universe": flowLaneSources\.flowUniverseSymbols/);
  assert.ok(prewarmBody);
  assert.match(prewarmBody, /resolveEquityLiveQuoteLaneSymbols\(symbols\)/);
});

test("lane architecture reports the same equity live sources used by watchlist prewarm", () => {
  const lanesSource = readFileSync(new URL("./ibkr-lanes.ts", import.meta.url), "utf8");
  const equityStart = lanesSource.indexOf(
    'label: laneLabels["equity-live-quotes"]',
  );
  const equityEnd = lanesSource.indexOf(
    'label: laneLabels["option-live-quotes"]',
    equityStart,
  );
  const equityBlock = lanesSource.slice(equityStart, equityEnd);

  assert.notEqual(equityStart, -1);
  assert.notEqual(equityEnd, -1);
  assert.match(equityBlock, /"built-in": flowLaneSources\.builtInSymbols/);
  assert.match(equityBlock, /watchlists: watchlistSymbols/);
  assert.match(equityBlock, /"flow-universe": flowUniverseSymbols/);
  assert.match(equityBlock, /resolveIbkrLaneSymbols\("equity-live-quotes"/);
});

test("watchlist prewarm orders all watchlist symbols before lane extras", () => {
  const result = __orderWatchlistWarmupSymbolsForTests({
    admittedSymbols: [
      "AAA",
      "AAB",
      "AAPL",
      "FLOW1",
      "FLOW2",
      "VRT",
      "VST",
      "ZBRA",
    ],
    watchlistSymbols: ["VRT", "VST", "ZBRA", "AAPL"],
    defaultSymbols: ["AAPL"],
    accountSymbols: [],
    limit: 5,
  });

  assert.deepEqual(result.symbols, ["AAPL", "VRT", "VST", "ZBRA", "AAA"]);
  assert.equal(result.overflowCount, 3);
});

test("watchlist prewarm line requests protect source symbols ahead of lane extras", () => {
  const requests = __buildWatchlistPrewarmLineRequestsForTests(
    ["flow1", "aapl", "vst"],
    ["AAPL", "VST"],
  );

  assert.deepEqual(requests, [
    { assetClass: "equity", symbol: "FLOW1", priorityOffset: -1 },
    { assetClass: "equity", symbol: "AAPL", priorityOffset: 1 },
    { assetClass: "equity", symbol: "VST", priorityOffset: 1 },
  ]);
});

test("watchlist prewarm rotates overflow while keeping default symbols pinned", () => {
  const first = __orderWatchlistWarmupSymbolsForTests({
    admittedSymbols: ["SPY", "AAA", "BBB", "CCC", "DDD", "EEE"],
    watchlistSymbols: ["AAA", "BBB", "CCC", "DDD", "EEE"],
    defaultSymbols: ["SPY"],
    accountSymbols: [],
    limit: 4,
    rotationOffset: 0,
    advanceRotation: true,
  });
  const second = __orderWatchlistWarmupSymbolsForTests({
    admittedSymbols: ["SPY", "AAA", "BBB", "CCC", "DDD", "EEE"],
    watchlistSymbols: ["AAA", "BBB", "CCC", "DDD", "EEE"],
    defaultSymbols: ["SPY"],
    accountSymbols: [],
    limit: 4,
    rotationOffset: first.nextRotationOffset,
    advanceRotation: true,
  });

  assert.deepEqual(first.symbols, ["SPY", "AAA", "BBB", "CCC"]);
  assert.deepEqual(second.symbols, ["SPY", "DDD", "EEE", "AAA"]);
});

test("watchlist prewarm rotates lane extras without displacing fitting watchlists", () => {
  const result = __orderWatchlistWarmupSymbolsForTests({
    admittedSymbols: [
      "SPY",
      "AAPL",
      "VRT",
      "VST",
      "ZBRA",
      "FLOW1",
      "FLOW2",
      "FLOW3",
      "FLOW4",
    ],
    watchlistSymbols: ["AAPL", "VRT", "VST", "ZBRA"],
    defaultSymbols: ["SPY"],
    accountSymbols: [],
    limit: 7,
    rotationOffset: 2,
    advanceRotation: true,
  });

  assert.deepEqual(result.symbols, [
    "SPY",
    "AAPL",
    "VRT",
    "VST",
    "ZBRA",
    "FLOW3",
    "FLOW4",
  ]);
  assert.equal(result.overflowCount, 2);
  assert.equal(result.nextRotationOffset, 0);
});

test("watchlist prewarm does not let account extras displace fitting watchlists", () => {
  const result = __orderWatchlistWarmupSymbolsForTests({
    admittedSymbols: ["AAPL", "VRT", "VST", "ZBRA", "FLOW1"],
    watchlistSymbols: ["AAPL", "VRT", "VST", "ZBRA"],
    defaultSymbols: [],
    accountSymbols: ["FCEL", "FRMI", "INDI", "SMCI"],
    limit: 5,
  });

  assert.deepEqual(result.symbols, ["AAPL", "VRT", "VST", "ZBRA", "FCEL"]);
  assert.equal(result.overflowCount, 4);
});

test("watchlist prewarm uses visible live lines and does not create filler leases", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const prewarmBody = platformSource.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];

  assert.ok(prewarmBody);
  assert.match(prewarmBody, /intent: "visible-live"/);
  assert.match(
    prewarmBody,
    /buildWatchlistPrewarmLineRequests\(cappedWarmupSymbols, symbols\)/,
  );
  assert.doesNotMatch(prewarmBody, /intent: "watchlist-live"/);
  assert.doesNotMatch(prewarmBody, /intent: "delayed-ok"/);
  assert.doesNotMatch(prewarmBody, /fillerSymbolLimit/);
});

test("watchlist prewarm defers and clears leases under resource pressure", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const prewarmBody = platformSource.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];

  assert.ok(prewarmBody);
  assert.match(prewarmBody, /getApiResourcePressureSnapshot\(\)/);
  assert.match(
    prewarmBody,
    /watchlistPrewarmAllowed === false[\s\S]*releaseMarketDataLeases\(\s*IBKR_WATCHLIST_PREWARM_OWNER,\s*"resource_pressure"/,
  );
  assert.match(
    prewarmBody,
    /watchlistPrewarmAllowed === false[\s\S]*releaseMarketDataLeases\(\s*IBKR_WATCHLIST_PREWARM_FILLER_OWNER,\s*"resource_pressure"/,
  );
  assert.match(
    prewarmBody,
    /watchlistPrewarmAllowed === false[\s\S]*syncWatchlistPrewarmBridgeGroups\(\{\s*primarySymbols: \[\],\s*\}\)/,
  );
});

test("bridge reconciliation preserves watchlist source priority offsets", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const reconcileBody = platformSource.match(
    /function reconcileIbkrWatchlistPrewarmFromBridgeDiagnostics\([\s\S]*?\nfunction reconcileIbkrWatchlistPrewarmFromBridgeSoon/,
  )?.[0];

  assert.ok(reconcileBody);
  assert.match(reconcileBody, /buildWatchlistPrewarmLineRequests\(primarySymbols\)/);
  assert.doesNotMatch(reconcileBody, /primarySymbols\.map\(\(symbol\) => \(\{/);
});

test("watchlist prewarm reruns when scanner lease churn hits an in-flight pass", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const prewarmBody = platformSource.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];

  assert.ok(prewarmBody);
  assert.match(
    platformSource,
    /let pendingIbkrWatchlistPrewarmRerunReason: string \| null = null;/,
  );
  assert.match(prewarmBody, /pendingIbkrWatchlistPrewarmRerunReason = reason;/);
  assert.match(prewarmBody, /after-pending/);
});

test("transient gateway readiness misses do not clear watchlist prewarm leases", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const prewarmBody = platformSource.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];
  assert.ok(prewarmBody);
  const notReadyStart = prewarmBody.indexOf("if (healthBlockReason) {");
  const notReadyEnd = prewarmBody.indexOf("const primaryAdmission = admitMarketDataLeases", notReadyStart);
  const notReadyBlock = prewarmBody.slice(notReadyStart, notReadyEnd);

  assert.match(notReadyBlock, /prewarm skipped until Gateway is ready/);
  assert.doesNotMatch(notReadyBlock, /releaseMarketDataLeases/);
  assert.doesNotMatch(notReadyBlock, /syncWatchlistPrewarmBridgeGroups/);
});

test("watchlist bridge sync skips stale streams and quote backoff at the sync boundary", () => {
  assert.equal(
    __getWatchlistPrewarmBridgeSyncBlockReasonForTests(
      { strictReady: false, strictReason: "market_session_quiet" },
      false,
    ),
    null,
  );
  assert.equal(
    __getWatchlistPrewarmBridgeSyncBlockReasonForTests(
      { strictReady: false, strictReason: "stream_not_fresh" },
      false,
    ),
    "stream_not_fresh",
  );
  assert.equal(
    __getWatchlistPrewarmBridgeSyncBlockReasonForTests(
      { strictReady: true },
      true,
    ),
    "quotes_backoff",
  );
  assert.equal(
    __getWatchlistPrewarmBridgeSyncBlockReasonForTests(
      { strictReady: true },
      false,
    ),
    null,
  );

  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const syncStart = platformSource.indexOf("async function syncWatchlistPrewarmBridgeGroups");
  const syncEnd = platformSource.indexOf("function scheduleIbkrWatchlistPrewarm", syncStart);
  const syncBlock = platformSource.slice(syncStart, syncEnd);

  assert.match(syncBlock, /getWatchlistPrewarmBridgeSyncBlockReason\(health\)/);
  assert.match(syncBlock, /isBridgeWorkBackedOff\("quotes"\)/);
  assert.match(syncBlock, /isBridgeWorkBackoffError\(error\)/);
  assert.match(syncBlock, /IBKR bridge watchlist prewarm sync skipped/);
});
