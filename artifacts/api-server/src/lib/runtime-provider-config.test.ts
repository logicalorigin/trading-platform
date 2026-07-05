import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetProviderRuntimeConfigCacheForTests,
  getFmpRuntimeConfig,
  getMassiveOptionsRecency,
  getMassiveRuntimeConfig,
  getMassiveStocksRecency,
} from "./runtime";

test("getMassiveRuntimeConfig memoizes by reference and is reset-able", () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";
  __resetProviderRuntimeConfigCacheForTests();

  const a = getMassiveRuntimeConfig();
  const b = getMassiveRuntimeConfig();
  assert.equal(a?.apiKey, "massive-test-key");
  assert.equal(a, b); // same reference -> memoized, no repeated env reads

  // reset reflects a changed env (proves the cache is invalidatable, not frozen)
  process.env["MASSIVE_API_KEY"] = "massive-test-key-2";
  __resetProviderRuntimeConfigCacheForTests();
  const c = getMassiveRuntimeConfig();
  assert.equal(c?.apiKey, "massive-test-key-2");
  assert.notEqual(a, c);

  delete process.env["MASSIVE_API_KEY"];
  __resetProviderRuntimeConfigCacheForTests();
});

test("getFmpRuntimeConfig memoizes by reference", () => {
  process.env["FMP_API_KEY"] = "fmp-test-key";
  __resetProviderRuntimeConfigCacheForTests();

  const a = getFmpRuntimeConfig();
  const b = getFmpRuntimeConfig();
  assert.equal(a?.apiKey, "fmp-test-key");
  assert.equal(a, b);

  delete process.env["FMP_API_KEY"];
  __resetProviderRuntimeConfigCacheForTests();
});

test("getMassiveStocksRecency memoizes and is reset-able", () => {
  process.env["MASSIVE_STOCKS_RECENCY"] = "delayed";
  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveStocksRecency(), "delayed");

  // mutate env without reset -> still cached value (proves memoization)
  process.env["MASSIVE_STOCKS_RECENCY"] = "realtime";
  assert.equal(getMassiveStocksRecency(), "delayed");

  // reset -> reflects new env
  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveStocksRecency(), "realtime");

  delete process.env["MASSIVE_STOCKS_RECENCY"];
  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveStocksRecency(), "realtime"); // default
});

test("getMassiveOptionsRecency memoizes and is reset-able", () => {
  process.env["MASSIVE_OPTIONS_RECENCY"] = "delayed";
  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveOptionsRecency(), "delayed");

  process.env["MASSIVE_OPTIONS_RECENCY"] = "realtime";
  assert.equal(getMassiveOptionsRecency(), "delayed");

  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveOptionsRecency(), "realtime");

  delete process.env["MASSIVE_OPTIONS_RECENCY"];
  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveOptionsRecency(), "realtime");
});

test("returns null when the provider key is absent", () => {
  delete process.env["MASSIVE_API_KEY"];
  delete process.env["MASSIVE_MARKET_DATA_API_KEY"];
  __resetProviderRuntimeConfigCacheForTests();
  assert.equal(getMassiveRuntimeConfig(), null);
  __resetProviderRuntimeConfigCacheForTests();
});
