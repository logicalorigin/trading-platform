import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseRetryAfterMs,
  retryDelayWithRetryAfter,
  retryUnlessTimeout,
} from "./queryDefaults.js";

const appProvidersSource = readFileSync(
  new URL("../../app/AppProviders.tsx", import.meta.url),
  "utf8",
);

test("parseRetryAfterMs accepts seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("2"), 2_000);
  assert.equal(
    parseRetryAfterMs(
      "Tue, 07 Jul 2026 17:00:10 GMT",
      Date.parse("2026-07-07T17:00:00.000Z"),
    ),
    10_000,
  );
  assert.equal(parseRetryAfterMs("not-a-date"), null);
});

test("retryDelayWithRetryAfter honors 429 Retry-After with positive jitter", () => {
  const delay = retryDelayWithRetryAfter(
    (attempt) => 1_000 * (attempt + 1),
    () => 0.5,
  );

  assert.equal(delay(0, { status: 429, retryAfterMs: 2_500 }), 2_625);
  assert.equal(delay(1, { status: 503, retryAfterMs: 2_500 }), 2_000);
  assert.equal(delay(2, { status: 429, retryAfterMs: null }), 3_000);
});

test("retryUnlessTimeout retries only network and explicitly transient HTTP failures", () => {
  const retry = retryUnlessTimeout(2);

  assert.equal(retry(0, { name: "TimeoutError" }), false);
  assert.equal(retry(0, { code: "request_timeout" }), false);
  assert.equal(retry(0, { timedOut: true }), false);
  assert.equal(retry(0, { name: "AbortError" }), false);
  assert.equal(retry(0, { code: "request_canceled" }), false);
  assert.equal(retry(0, { code: "request_network" }), true);
  assert.equal(retry(0, { status: 408 }), true);
  assert.equal(retry(0, { status: 425 }), true);
  assert.equal(retry(0, { status: 429 }), true);
  assert.equal(retry(0, { status: 503 }), true);
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(retry(0, { status }), false, `HTTP ${status} is deterministic`);
  }
  assert.equal(retry(0, new Error("programming failure")), false);
  assert.equal(retry(2, { code: "request_network" }), false);
});

test("the global React Query client uses the shared timeout-aware retry policy", () => {
  assert.match(
    appProvidersSource,
    /import \{ retryUnlessTimeout \} from "\.\.\/features\/platform\/queryRetry";/,
  );
  assert.match(appProvidersSource, /retry:\s*retryUnlessTimeout\(1\)/);
});
