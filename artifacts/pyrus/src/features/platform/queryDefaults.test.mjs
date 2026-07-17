import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { customFetch } from "../../../../../lib/api-client-react/src/custom-fetch.ts";
import { fetchWithNetworkError } from "./fetchWithNetworkError.js";
import {
  parseRetryAfterMs,
  retryDelayWithRetryAfter,
  retryUnlessTimeout,
} from "./queryDefaults.js";

const appProvidersSource = readFileSync(
  new URL("../../app/AppProviders.tsx", import.meta.url),
  "utf8",
);
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

test("normalized custom and raw fetch transport failures reach the bounded retry policy", async () => {
  const retry = retryUnlessTimeout(2);
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  const customFetchError = await customFetch("/api/test", {
    responseType: "json",
    timeoutMs: null,
  }).then(
    () => assert.fail("customFetch should reject"),
    (error) => error,
  );
  const rawFetchError = await fetchWithNetworkError("/api/test").then(
    () => assert.fail("fetchWithNetworkError should reject"),
    (error) => error,
  );

  for (const error of [customFetchError, rawFetchError]) {
    assert.equal(error.name, "NetworkError");
    assert.equal(error.code, "request_network");
    assert.equal(retry(0, error), true);
    assert.equal(retry(1, error), true);
    assert.equal(retry(2, error), false);
  }
});

test("deterministic failures stay terminal end to end", async () => {
  const retry = retryUnlessTimeout(2);
  const invalidUrlError = new TypeError(
    "Failed to parse URL from [object Object]",
  );
  globalThis.fetch = async () => {
    throw invalidUrlError;
  };
  const customFetchInvalidUrl = await customFetch("/api/test", {
    responseType: "json",
    timeoutMs: null,
  }).then(
    () => assert.fail("customFetch should reject"),
    (error) => error,
  );
  const rawFetchInvalidUrl = await fetchWithNetworkError("/api/test").then(
    () => assert.fail("fetchWithNetworkError should reject"),
    (error) => error,
  );

  assert.equal(customFetchInvalidUrl, invalidUrlError);
  assert.equal(rawFetchInvalidUrl, invalidUrlError);

  globalThis.fetch = async () =>
    new Response("{", {
      headers: { "content-type": "application/json" },
    });
  const parseError = await customFetch("/api/test", {
    responseType: "json",
    timeoutMs: null,
  }).then(
    () => assert.fail("customFetch should reject invalid JSON"),
    (error) => error,
  );
  assert.equal(parseError.name, "ResponseParseError");

  for (const error of [
    customFetchInvalidUrl,
    rawFetchInvalidUrl,
    parseError,
    new Error("programming failure"),
    { code: "network_error" },
  ]) {
    assert.equal(retry(0, error), false);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(
      retry(0, { status }),
      false,
      `HTTP ${status} is deterministic`,
    );
  }
  assert.equal(
    retry(0, {
      status: 400,
      code: "request_network",
      name: "NetworkError",
    }),
    false,
    "an explicit deterministic HTTP status wins over conflicting tags",
  );
});

test("timeouts and cancellations stay terminal", () => {
  const retry = retryUnlessTimeout(2);

  for (const error of [
    { name: "TimeoutError" },
    { code: "request_timeout" },
    { timedOut: true },
    { name: "AbortError" },
    { code: "request_canceled" },
  ]) {
    assert.equal(retry(0, error), false);
  }
});

test("explicit transient HTTP statuses retry only within the configured bound", () => {
  const retry = retryUnlessTimeout(2);

  for (const status of [408, 425, 429, 500, 503, 599]) {
    assert.equal(retry(0, { status }), true, `HTTP ${status} should retry`);
    assert.equal(retry(1, { status }), true, `HTTP ${status} should retry`);
    assert.equal(retry(2, { status }), false, `HTTP ${status} reached bound`);
  }
});

test("the global React Query client uses the shared retry policy", () => {
  assert.match(
    appProvidersSource,
    /import \{ retryUnlessTimeout \} from "\.\.\/features\/platform\/queryRetry";/,
  );
  assert.match(appProvidersSource, /retry:\s*retryUnlessTimeout\(1\)/);
});
