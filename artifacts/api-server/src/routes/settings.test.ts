import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("IBKR line usage route coalesces expensive snapshots", () => {
  const routeSource = readFileSync(
    new URL("./settings.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /const IBKR_LINE_USAGE_ROUTE_CACHE_TTL_MS = 2_000/);
  assert.match(routeSource, /let ibkrLineUsageRouteInFlight/);
  assert.match(routeSource, /async function getCachedIbkrLineUsageSnapshot/);
  assert.match(routeSource, /if \(ibkrLineUsageRouteInFlight\) \{/);
  assert.match(routeSource, /return ibkrLineUsageRouteInFlight/);
  assert.match(
    routeSource,
    /res\.json\(await getCachedIbkrLineUsageSnapshot\(\)\)/,
  );
  assert.match(routeSource, /let writeInFlight = false/);
  assert.match(routeSource, /if \(closed \|\| writeInFlight\) \{/);
  assert.match(
    routeSource,
    /writeSseEvent\(res, "ibkr-line-usage", await getCachedIbkrLineUsageSnapshot\(\)\)/,
  );
});
