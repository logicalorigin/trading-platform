import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("account page routes cache full live read responses briefly", () => {
  const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

  assert.match(source, /const ACCOUNT_ROUTE_LIVE_RESPONSE_CACHE_TTL_MS = 5_000;/);
  assert.match(
    source,
    /const ACCOUNT_ROUTE_DERIVED_RESPONSE_CACHE_TTL_MS = 15_000;/,
  );
  assert.match(source, /const accountRouteResponseCache = new Map/);
  assert.match(source, /function readAccountRouteResponseCache/);

  for (const route of [
    "summary",
    "allocation",
    "positions",
    "risk",
    "cash-activity",
  ]) {
    assert.match(
      source,
      new RegExp(
        `readAccountRouteResponseCache\\(\\s*"${route}"[\\s\\S]*?ACCOUNT_ROUTE_LIVE_RESPONSE_CACHE_TTL_MS`,
      ),
    );
  }

  assert.match(
    source,
    /readAccountRouteResponseCache\(\s*"equity-history"[\s\S]*?input\.benchmark[\s\S]*?ACCOUNT_ROUTE_DERIVED_RESPONSE_CACHE_TTL_MS[\s\S]*?ACCOUNT_ROUTE_LIVE_RESPONSE_CACHE_TTL_MS/,
  );
});
