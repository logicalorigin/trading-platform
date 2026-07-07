import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRetryAfterMs,
  retryDelayWithRetryAfter,
} from "./queryDefaults.js";

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

test("retryDelayWithRetryAfter honors 429 Retry-After before fallback delay", () => {
  const delay = retryDelayWithRetryAfter((attempt) => 1_000 * (attempt + 1));

  assert.equal(delay(0, { status: 429, retryAfterMs: 2_500 }), 2_500);
  assert.equal(delay(1, { status: 503, retryAfterMs: 2_500 }), 2_000);
  assert.equal(delay(2, { status: 429, retryAfterMs: null }), 3_000);
});
