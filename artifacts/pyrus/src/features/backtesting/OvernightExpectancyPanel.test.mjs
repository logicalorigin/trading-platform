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
