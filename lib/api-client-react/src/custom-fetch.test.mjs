import assert from "node:assert/strict";
import test from "node:test";

import {
  __customFetchInternalsForTests,
  customFetch,
  setCsrfTokenGetter,
} from "./custom-fetch.ts";

const { applyBaseUrl } = __customFetchInternalsForTests;
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  setCsrfTokenGetter(null);
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    delete globalThis.window;
  }
});

test("customFetch can apply a per-request base URL to relative API paths", () => {
  assert.equal(
    applyBaseUrl(
      "/api/algo/deployments/deployment-1/signal-options/profile",
      "http://127.0.0.1:8080/",
    ),
    "http://127.0.0.1:8080/api/algo/deployments/deployment-1/signal-options/profile",
  );
  assert.equal(
    applyBaseUrl(
      "http://127.0.0.1:18747/api/session",
      "http://127.0.0.1:8080",
    ),
    "http://127.0.0.1:18747/api/session",
  );
});

async function captureRequestHeaders(input, options) {
  let requestHeaders = null;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  };

  await customFetch(input, {
    responseType: "json",
    timeoutMs: null,
    ...options,
  });
  return requestHeaders;
}

test("customFetch auto-attaches session CSRF only to same-origin unsafe browser requests", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "https://app.synthetic.invalid/workspace" },
      dispatchEvent() {},
    },
  });
  let getterCalls = 0;
  setCsrfTokenGetter(() => {
    getterCalls += 1;
    return "session-csrf";
  });

  const cases = [
    ["/api/test", {}, "session-csrf"],
    ["https://app.synthetic.invalid:443/api/test", {}, "session-csrf"],
    ["https://external.synthetic.invalid/api/test", {}, null],
    ["//external.synthetic.invalid/api/test", {}, null],
    [
      "/api/test",
      { baseUrl: "https://external.synthetic.invalid" },
      null,
    ],
    [
      new Request("https://external.synthetic.invalid/api/test", {
        method: "POST",
      }),
      {},
      null,
    ],
  ];

  for (const [input, overrides, expected] of cases) {
    const options =
      input instanceof Request
        ? overrides
        : {
            method: "POST",
            body: JSON.stringify({ enabled: true }),
            ...overrides,
          };
    const headers = await captureRequestHeaders(input, options);
    assert.equal(headers.get("x-csrf-token"), expected, String(input));
  }
  assert.equal(getterCalls, 2);
});

test("customFetch fails closed for origin-bearing requests outside a browser", async () => {
  delete globalThis.window;
  setCsrfTokenGetter(() => "session-csrf");

  const cases = [
    ["/api/test", "session-csrf"],
    ["api/test", "session-csrf"],
    ["https://app.synthetic.invalid/api/test", null],
    ["//app.synthetic.invalid/api/test", null],
    ["\\\\external.synthetic.invalid/api/test", null],
  ];

  for (const [input, expected] of cases) {
    const headers = await captureRequestHeaders(input, {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(headers.get("x-csrf-token"), expected, input);
  }
});

test("customFetch preserves safe methods and explicit caller CSRF headers", async () => {
  setCsrfTokenGetter(() => "session-csrf");

  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const headers = await captureRequestHeaders("/api/test", { method });
    assert.equal(headers.get("x-csrf-token"), null, method);
  }

  const explicit = await captureRequestHeaders(
    "https://external.synthetic.invalid/api/test",
    {
      method: "PATCH",
      headers: { "X-CSRF-Token": "caller-owned" },
      body: JSON.stringify({ enabled: true }),
    },
  );
  assert.equal(explicit.get("x-csrf-token"), "caller-owned");
});
