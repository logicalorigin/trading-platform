import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function routeSource(path: string, method = "get"): string {
  const start = source.indexOf(`router.${method}("${path}",`);
  assert.notEqual(start, -1, `Missing ${path}`);
  const next = source.indexOf("\nrouter.", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("account positions route defaults to live quote hydration for all accounts", () => {
  const handler = routeSource("/accounts/:accountId/positions");
  assert.match(handler, /req\.query\.liveQuotes === "false"/);
  assert.doesNotMatch(
    handler,
    /SHADOW_ACCOUNT_ID/,
    "shadow accounts must not be opted out of live quotes by default",
  );
});

test("real account routes and streams require account admission", () => {
  [
    "/accounts",
    "/accounts/:accountId/summary",
    "/accounts/:accountId/equity-history",
    "/accounts/:accountId/allocation",
    "/accounts/:accountId/positions",
    "/accounts/:accountId/positions-at-date",
    "/accounts/:accountId/closed-trades",
    "/accounts/:accountId/orders",
    "/accounts/:accountId/risk",
    "/accounts/:accountId/cash-activity",
    "/streams/accounts/page",
    "/streams/accounts",
  ].forEach((path) => {
    assert.match(
      routeSource(path),
      /admitAccountRoute\(res/,
      `${path} should guard real-account access when IBKR is unconfigured`,
    );
  });
});
