import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBaseUrl } from "./runtime";

test("resolveApiBaseUrl defaults to the local API artifact port", () => {
  assert.equal(resolveApiBaseUrl({}), "http://127.0.0.1:8080/api");
});

test("resolveApiBaseUrl honors the backtest-specific API override first", () => {
  assert.equal(
    resolveApiBaseUrl({
      API_BASE_URL: "http://127.0.0.1:9999/api",
      BACKTEST_API_BASE_URL: "https://rayalgo.example/api",
    }),
    "https://rayalgo.example/api",
  );
});

test("resolveApiBaseUrl falls back to the shared API override", () => {
  assert.equal(
    resolveApiBaseUrl({ API_BASE_URL: "https://shared.example/api" }),
    "https://shared.example/api",
  );
});
