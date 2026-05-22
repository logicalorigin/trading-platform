import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import {
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

test("empty watchlist prewarm requests cancel in-flight prewarm work", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const emptyRequestStart = platformSource.indexOf("if (!requestedSignature) {");
  const emptyRequestEnd = platformSource.indexOf("if (requestedSignature === pendingIbkrWatchlistPrewarmSignature)", emptyRequestStart);
  const emptyRequestBlock = platformSource.slice(emptyRequestStart, emptyRequestEnd);

  assert.match(emptyRequestBlock, /ibkrWatchlistPrewarmSequence \+= 1;/);
  assert.match(emptyRequestBlock, /pendingIbkrWatchlistPrewarmSignature = null;/);
});

test("transient gateway readiness misses do not clear watchlist prewarm leases", () => {
  const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const notReadyStart = platformSource.indexOf("if (!health?.strictReady) {");
  const notReadyEnd = platformSource.indexOf("const primaryAdmission = admitMarketDataLeases", notReadyStart);
  const notReadyBlock = platformSource.slice(notReadyStart, notReadyEnd);

  assert.match(notReadyBlock, /prewarm skipped until Gateway is ready/);
  assert.doesNotMatch(notReadyBlock, /releaseMarketDataLeases/);
  assert.doesNotMatch(notReadyBlock, /syncWatchlistPrewarmBridgeGroups/);
});

test("watchlist filler is enabled by default and caps available slack", () => {
  delete process.env[FILLER_ENABLED_ENV_NAME];

  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: 90,
      nonFillerEquityLineCount: 45,
    }),
    40,
  );
});

test("watchlist filler respects total and equity bridge slack when enabled", () => {
  process.env[FILLER_ENABLED_ENV_NAME] = "true";

  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: 90,
      nonFillerEquityLineCount: 45,
    }),
    40,
  );
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 120,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: 90,
      nonFillerEquityLineCount: 45,
    }),
    20,
  );
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: null,
      nonFillerEquityLineCount: 45,
    }),
    40,
  );
});

test("watchlist filler cap tightens under resource pressure", () => {
  process.env[FILLER_ENABLED_ENV_NAME] = "true";

  updateApiResourcePressure({ rssMb: 950 });
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: null,
      nonFillerEquityLineCount: 45,
    }),
    12,
  );

  updateApiResourcePressure({ rssMb: 1_250 });
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: null,
      nonFillerEquityLineCount: 45,
    }),
    4,
  );

  updateApiResourcePressure({ rssMb: 1_650 });
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: null,
      nonFillerEquityLineCount: 45,
    }),
    0,
  );
});
