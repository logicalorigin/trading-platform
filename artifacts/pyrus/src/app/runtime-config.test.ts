import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserApiBaseUrl } from "./runtime-config";
import {
  PYRUS_QA_MODE_HEADER,
  isPyrusApiRequestUrl,
  resolvePyrusQaModeFromSearch,
  withPyrusQaHeader,
} from "./qa-mode";

test("runtime config ignores loopback API bases on external browser origins", () => {
  assert.equal(
    resolveBrowserApiBaseUrl(
      "http://127.0.0.1:8080",
      "https://pyrus.example.replit.dev/",
    ),
    null,
  );
  assert.equal(
    resolveBrowserApiBaseUrl(
      "http://localhost:8080/",
      "https://pyrus.example.replit.dev/",
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

test("QA mode parser recognizes safe mode and explicit opt-out", () => {
  assert.equal(resolvePyrusQaModeFromSearch("?pyrusQa=safe"), "safe");
  assert.equal(resolvePyrusQaModeFromSearch("?qaMode=safe"), "safe");
  assert.equal(resolvePyrusQaModeFromSearch("?pyrusQa=off"), "off");
  assert.equal(resolvePyrusQaModeFromSearch("?pyrusQa=1"), null);
});

test("QA mode only targets same-origin API requests", () => {
  assert.equal(isPyrusApiRequestUrl("/api/session", "https://app.example"), true);
  assert.equal(
    isPyrusApiRequestUrl(
      "https://app.example/api/bars?symbol=SPY",
      "https://app.example",
    ),
    true,
  );
  assert.equal(
    isPyrusApiRequestUrl("https://api.example/api/bars", "https://app.example"),
    false,
  );
});

test("QA mode request init adds the backend admission header", () => {
  const next = withPyrusQaHeader(
    { headers: { Accept: "application/json" } },
    "safe",
  );
  const headers = new Headers(next?.headers);
  assert.equal(headers.get(PYRUS_QA_MODE_HEADER), "safe");
  assert.equal(headers.get("Accept"), "application/json");
});
