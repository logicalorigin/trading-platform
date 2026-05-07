import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserApiBaseUrl } from "./runtime-config";

test("runtime config ignores loopback API bases on external browser origins", () => {
  assert.equal(
    resolveBrowserApiBaseUrl(
      "http://127.0.0.1:8080",
      "https://rayalgo.example.replit.dev/",
    ),
    null,
  );
  assert.equal(
    resolveBrowserApiBaseUrl(
      "http://localhost:8080/",
      "https://rayalgo.example.replit.dev/",
    ),
    null,
  );
});

test("runtime config allows loopback API bases for local browser origins", () => {
  assert.equal(
    resolveBrowserApiBaseUrl(
      "http://127.0.0.1:8080/",
      "http://127.0.0.1:18747/",
    ),
    "http://127.0.0.1:8080",
  );
});

