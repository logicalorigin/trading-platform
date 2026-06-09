import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function routeSource(path: string): string {
  const start = source.indexOf(`router.get("${path}"`);
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
