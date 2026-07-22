import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as ts from "typescript";

const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
  "account.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function findFunctionDeclaration(name: string): ts.FunctionDeclaration {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name
    ) {
      return statement;
    }
  }
  throw new Error(`Missing ${name}`);
}

function functionSource(name: string): string {
  const target = findFunctionDeclaration(name);
  return source.slice(target.pos, target.end);
}

test("real account display quote demand expires when account reads stop", () => {
  assert.match(source, /const ACCOUNT_POSITION_MARKET_DATA_TTL_MS = 15_000;/);
});

test("real account positions declare account-monitor demand even for fast quote-free loads", () => {
  const publicLoader = functionSource("getAccountPositions");
  assert.doesNotMatch(
    publicLoader,
    /input\.liveQuotes\s*!==\s*false[\s\S]*declareAccountPositionOptionQuoteDemands/,
    "liveQuotes:false must not suppress derived account-monitor demand",
  );
  assert.doesNotMatch(
    publicLoader,
    /detail\s*!==\s*"fast"[\s\S]*declareAccountPositionOptionQuoteDemands/,
    "detail:fast must not suppress derived account-monitor demand",
  );

  const uncachedLoader = functionSource("buildAccountPositionsUncached");
  assert.match(
    uncachedLoader,
    /const allPositions = await timeAccountPositionsStage\([\s\S]*?listPositionsForUniverse\(universe,\s*mode,\s*timing\)/,
    "demand must be derived from the unfiltered real position set",
  );
  assert.match(
    uncachedLoader,
    /const positions = allPositions\.filter/,
    "visible response filtering must happen after collecting all positions",
  );
  assert.match(
    uncachedLoader,
    /const marketDataDemandPositions = allPositions\.filter\(/,
    "all open real positions must be used for market-data demand",
  );
  assert.match(
    uncachedLoader,
    /refreshAccountPositionEquityQuotes\(\s*marketDataDemandPositions/,
    "all open real equity positions must refresh Massive quote snapshots",
  );
  assert.match(
    uncachedLoader,
    /declareAccountPositionOptionQuoteDemands\(\s*marketDataDemandPositions/,
    "all open real option positions must be declared to account-monitor demand",
  );
});

test("shadow account positions preserve the requested fast-detail contract", () => {
  const publicLoader = functionSource("getAccountPositions");
  assert.match(
    publicLoader,
    /getShadowAccountPositions\(\{[\s\S]*?detail:\s*input\.detail,[\s\S]*?\}\)/,
    "detail:fast must cross the account-to-shadow service boundary",
  );
});

test("real account equity quote refresh does not reserve broker market-data lines", () => {
  const quoteRefresh = functionSource("refreshAccountPositionEquityQuotes");

  assert.match(
    quoteRefresh,
    /void fetchEquityQuoteSnapshotsForPositions\(positions\)/,
    "equity quote refresh must reuse the Massive-backed snapshot reader",
  );
  assert.doesNotMatch(
    quoteRefresh,
    /admissionOwner|admissionIntent|ttlMs|releaseMarketDataLeases/,
    "Massive equity quotes must not reserve or release broker market-data lines",
  );
});

test("fast real account positions hydrate quote snapshots when live quotes are requested", () => {
  const uncachedLoader = functionSource("buildAccountPositionsUncached");
  assert.match(
    uncachedLoader,
    /if\s*\(input\.detail === "fast"\)\s*\{[\s\S]*?input\.liveQuotes === false[\s\S]*?fetchEquityQuoteSnapshotsForPositions\(positions\)[\s\S]*?input\.liveQuotes === false[\s\S]*?fetchOptionQuoteSnapshotsForPositions\(positions\)[\s\S]*?\}/,
    "detail:fast with liveQuotes:true must read current account-monitor quote snapshots",
  );
});

test("fast real account positions do not await execution history for day PnL", () => {
  const uncachedLoader = functionSource("buildAccountPositionsUncached");
  assert.doesNotMatch(
    uncachedLoader,
    /\[\s*equityQuoteSnapshots,\s*optionQuoteSnapshots,\s*openDates\s*\]\s*=\s*await Promise\.all/,
    "detail:fast must not put optional execution history on the structural positions critical path",
  );
  assert.match(
    uncachedLoader,
    /openDates\s*=\s*readLastKnownExecutionOpenDatesForPositions\(\s*universe,\s*mode,\s*positions,?\s*\)/,
    "detail:fast must hydrate immediately from last-known execution open dates",
  );
  assert.match(
    uncachedLoader,
    /void fetchExecutionOpenDatesForPositions\(universe,\s*mode,\s*positions\)\.catch/,
    "detail:fast must refresh execution-derived open dates outside the response critical path",
  );

  const executionOpenDateLoader = functionSource(
    "fetchExecutionOpenDatesForPositions",
  );
  assert.match(
    executionOpenDateLoader,
    /positions\.some\(\(position\) => !position\.openedAt\)/,
    "execution open-date loading should be skipped when broker positions already include openedAt",
  );
  assert.match(
    executionOpenDateLoader,
    /readShortLivedAccountCache\(\s*accountPositionOpenDatesReadCache[\s\S]*?ACCOUNT_POSITION_OPEN_DATE_CACHE_TTL_MS/,
    "execution-derived open dates must be cached separately from the live polling interval",
  );
  assert.match(
    executionOpenDateLoader,
    /listExecutionsForUniverse\(universe,\s*mode,\s*\{\}\)/,
    "execution open-date loading must use the same execution source as full detail",
  );
  assert.match(
    executionOpenDateLoader,
    /buildExecutionOpenDatesForPositions\(positions,\s*executions\)/,
    "execution rows must be mapped back to visible broker positions",
  );
});
