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

  const uncachedLoader = functionSource("getAccountPositionsUncached");
  assert.match(
    uncachedLoader,
    /const allPositions = await listPositionsForUniverse\(universe, mode\);/,
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
    /declareAccountPositionEquityQuoteDemands\(\s*marketDataDemandPositions/,
    "all open real equity positions must be declared to account-monitor demand",
  );
  assert.match(
    uncachedLoader,
    /declareAccountPositionOptionQuoteDemands\(\s*marketDataDemandPositions/,
    "all open real option positions must be declared to account-monitor demand",
  );
});

test("fast real account positions hydrate quote snapshots when live quotes are requested", () => {
  const uncachedLoader = functionSource("getAccountPositionsUncached");
  assert.match(
    uncachedLoader,
    /if\s*\(input\.detail === "fast"\)\s*\{[\s\S]*?input\.liveQuotes === false[\s\S]*?fetchEquityQuoteSnapshotsForPositions\(positions\)[\s\S]*?input\.liveQuotes === false[\s\S]*?fetchOptionQuoteSnapshotsForPositions\(positions\)[\s\S]*?\}/,
    "detail:fast with liveQuotes:true must read current account-monitor quote snapshots",
  );
});

test("fast real account positions hydrate execution open dates for day PnL", () => {
  const uncachedLoader = functionSource("getAccountPositionsUncached");
  assert.match(
    uncachedLoader,
    /if\s*\(input\.detail === "fast"\)\s*\{[\s\S]*?fetchExecutionOpenDatesForPositions\(universe,\s*mode,\s*positions\)[\s\S]*?\}/,
    "detail:fast must fetch execution-derived open dates before market hydration",
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
