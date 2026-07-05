import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

test("Client Portal trading guard verifies brokerage session before order actions", () => {
  const start = source.indexOf("export async function assertIbkrGatewayTradingAvailable");
  const end = source.indexOf("async function validateOrderIntentForRouting");

  assert.ok(start >= 0, "trading guard source must exist");
  assert.ok(end > start, "trading guard source boundary must exist");

  const guardSource = source.slice(start, end);

  assert.match(guardSource, /client\.ensureBrokerageSession\(\)/);
  assert.doesNotMatch(guardSource, /client\.listAccounts\(/);
  assert.match(guardSource, /authenticated: session\.authenticated/);
  assert.match(guardSource, /connected: session\.connected/);
});
