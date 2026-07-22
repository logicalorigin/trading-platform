import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountPositionSourceForProvider,
  combineAccountPositionSources,
} from "./account-trade-model";

const accountSource = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

test("position provenance names the provider that supplied the holding", () => {
  assert.equal(accountPositionSourceForProvider("ibkr"), "IBKR_POSITIONS");
  assert.equal(
    accountPositionSourceForProvider("snaptrade"),
    "SNAPTRADE_POSITIONS",
  );
  assert.equal(
    accountPositionSourceForProvider("robinhood"),
    "ROBINHOOD_POSITIONS",
  );
  assert.equal(accountPositionSourceForProvider("schwab"), "SCHWAB_POSITIONS");
  assert.equal(accountPositionSourceForProvider("unknown"), "BROKER_POSITIONS");
  assert.equal(accountPositionSourceForProvider(null), "BROKER_POSITIONS");
});

test("combined position provenance remains exact until providers differ", () => {
  assert.equal(
    combineAccountPositionSources(["IBKR_POSITIONS", "IBKR_POSITIONS"]),
    "IBKR_POSITIONS",
  );
  assert.equal(
    combineAccountPositionSources([
      "IBKR_POSITIONS",
      "SNAPTRADE_POSITIONS",
    ]),
    "MIXED_BROKER_POSITIONS",
  );
  assert.equal(combineAccountPositionSources([]), "BROKER_POSITIONS");
});

test("real account position rows derive provenance instead of hardcoding IBKR", () => {
  const start = accountSource.indexOf("async function buildAccountPositionsUncached");
  const end = accountSource.indexOf(
    "\nexport async function getAccountPositionsAtDate",
    start,
  );
  assert.notEqual(start, -1, "Missing real account positions builder");
  assert.notEqual(end, -1, "Missing real account positions builder boundary");
  const builder = accountSource.slice(start, end);

  assert.match(builder, /accountPositionSourceForProvider/);
  assert.match(builder, /combineAccountPositionSources/);
  assert.doesNotMatch(builder, /source:\s*"IBKR_POSITIONS"/);
});
