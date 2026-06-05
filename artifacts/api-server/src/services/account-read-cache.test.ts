import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("account page routes do not cache full live account responses", () => {
  const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /const ACCOUNT_ROUTE_DERIVED_RESPONSE_CACHE_TTL_MS = 15_000;/,
  );
  assert.match(
    source,
    /const ACCOUNT_ROUTE_EQUITY_HISTORY_RESPONSE_CACHE_TTL_MS = 5_000;/,
  );
  assert.doesNotMatch(source, /ACCOUNT_ROUTE_LIVE_RESPONSE_CACHE_TTL_MS/);
  assert.match(source, /const accountRouteResponseCache = new Map/);
  assert.match(source, /function readAccountRouteResponseCache/);

  for (const route of [
    "summary",
    "allocation",
    "positions",
    "risk",
    "cash-activity",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`readAccountRouteResponseCache\\(\\s*"${route}"`),
    );
  }

  assert.doesNotMatch(source, /if \(!input\.benchmark\)/);
  assert.match(
    source,
    /readAccountRouteResponseCache\(\s*"equity-history"[\s\S]*?input\.benchmark[\s\S]*?ACCOUNT_ROUTE_DERIVED_RESPONSE_CACHE_TTL_MS[\s\S]*?ACCOUNT_ROUTE_EQUITY_HISTORY_RESPONSE_CACHE_TTL_MS/,
  );
});
