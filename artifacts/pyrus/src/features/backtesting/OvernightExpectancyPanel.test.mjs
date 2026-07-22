import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { jsonRequest } from "./OvernightExpectancyPanel.tsx";
import { retryUnlessTimeout } from "../platform/queryRetry.ts";

const source = readFileSync(
  new URL("./OvernightExpectancyPanel.tsx", import.meta.url),
  "utf8",
);
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("overnight expectancy queries normalize native transport failures", () => {
  assert.match(
    source,
    /import \{ fetchWithNetworkError \} from "\.\.\/platform\/fetchWithNetworkError\.js";/,
  );
  assert.match(source, /const response = await fetchWithNetworkError\(url, \{/);
});

test("overnight study input uses UTC range validation and accessible controls", () => {
  assert.match(
    source,
    /import \{ toUtcDateRangeIso \} from "\.\/backtestingDateRanges";/,
  );
  assert.match(
    source,
    /const selectedDateRange = toUtcDateRangeIso\(startsOn, endsOn\);/,
  );
  assert.match(
    source,
    /if \(!selectedDateRange \|\| selectedTimeframes\.length === 0\)/,
  );
  assert.match(source, /signalTimeframes: selectedTimeframes,\s+\.\.\.selectedDateRange,/);
  assert.doesNotMatch(source, /new Date\(`\$\{startsOn\}T00:00:00\.000Z`\)/);
  assert.match(source, /aria-label="Overnight start date"/);
  assert.match(source, /aria-label="Overnight end date"/);
  assert.match(source, /role="group"\s+aria-labelledby="overnight-signal-timeframes-label"/);
  assert.match(source, /aria-pressed=\{timeframeSet\.has\(timeframe\)\}/);
  assert.match(source, /aria-label="Sample timeframe"/);
});

test("overnight expectancy preserves transient HTTP status for query retry", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "temporarily unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });

  const error = await jsonRequest(
    "/api/backtests/overnight-expectancy/test",
  ).then(
    () => assert.fail("jsonRequest should reject a 503 response"),
    (failure) => failure,
  );

  assert.equal(error.status, 503);
  assert.equal(retryUnlessTimeout(1)(0, error), true);
  assert.equal(retryUnlessTimeout(1)(1, error), false);
});
