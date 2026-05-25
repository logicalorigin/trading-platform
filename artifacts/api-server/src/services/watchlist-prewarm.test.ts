import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import {
  __getWatchlistPrewarmBridgeSyncBlockReasonForTests,
  resolveIbkrWatchlistFillerSymbolLimit,
  resolveIbkrWatchlistPrewarmSymbolLimit,
} from "./platform";
import { __resetMarketDataAdmissionForTests } from "./market-data-admission";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

const PREWARM_LIMIT_ENV_NAME = "IBKR_MARKET_DATA_WATCHLIST_LINES";
const FILLER_ENABLED_ENV_NAME = "IBKR_MARKET_DATA_ENABLE_FILLER_PREWARM";
const FILLER_MAX_ENV_NAME = "IBKR_WATCHLIST_PREWARM_FILLER_MAX_SYMBOLS";
const originalValues = new Map(
  [
    PREWARM_LIMIT_ENV_NAME,
    FILLER_ENABLED_ENV_NAME,
    FILLER_MAX_ENV_NAME,
  ].map((name) => [name, process.env[name]]),
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

test("watchlist prewarm defaults to an 80-symbol primary prewarm cap", () => {
  delete process.env[PREWARM_LIMIT_ENV_NAME];

  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 80);
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(12), 12);
});

test("watchlist line env override can lower or raise the primary prewarm cap", () => {
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

test("watchlist filler leases are persistent and reclaimed by priority, not TTL expiry", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const prewarmBody = platformSource.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];

  assert.ok(prewarmBody);
  assert.match(prewarmBody, /owner: IBKR_WATCHLIST_PREWARM_FILLER_OWNER/);
  assert.doesNotMatch(prewarmBody, /ttlMs:/);
  assert.doesNotMatch(platformSource, /IBKR_MARKET_DATA_FILLER_TTL_MS/);
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

test("watchlist filler is enabled by default", () => {
  delete process.env[FILLER_ENABLED_ENV_NAME];

  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    80,
  );
});

test("watchlist filler respects total slack with the default cap", () => {
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    80,
  );
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 120,
      nonFillerLineCount: 100,
    }),
    20,
  );
});

test("watchlist filler env override can lower or raise the filler cap", () => {
  process.env[FILLER_ENABLED_ENV_NAME] = "true";
  process.env[FILLER_MAX_ENV_NAME] = "12";

  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    12,
  );

  process.env[FILLER_MAX_ENV_NAME] = "200";

  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 120,
      targetFillLines: 200,
      nonFillerLineCount: 85,
    }),
    115,
  );
});

test("watchlist filler is capped or disabled by API resource pressure", () => {
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    80,
  );

  updateApiResourcePressure({ rssMb: 950 });
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    80,
  );

  updateApiResourcePressure({ rssMb: 1_250 });
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    0,
  );

  updateApiResourcePressure({ rssMb: 1_650 });
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
    }),
    0,
  );
});
