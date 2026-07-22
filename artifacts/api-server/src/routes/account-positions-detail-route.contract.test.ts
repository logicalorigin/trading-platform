import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

test("account positions route preserves explicit fast and full detail values", () => {
  const routeStart = source.indexOf('router.get("/accounts/:accountId/positions"');
  assert.notEqual(routeStart, -1, "Missing account positions route");
  const routeEnd = source.indexOf("\n});", routeStart);
  assert.notEqual(routeEnd, -1, "Missing account positions route terminator");
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /req\.query\.detail === "fast"/);
  assert.match(route, /req\.query\.detail === "full"/);
  assert.match(route, /getAccountPositions\(\{[\s\S]*detail,/);
});
