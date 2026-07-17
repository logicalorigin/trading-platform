import assert from "node:assert/strict";
import test from "node:test";

import {
  __customFetchInternalsForTests,
  customFetch,
  resetCustomFetchDedupeForTests,
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

test("customFetch makes one transport attempt so React Query owns GET retries", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ message: "temporarily unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      () =>
        customFetch("/api/test", {
          responseType: "json",
          timeoutMs: null,
        }),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      },
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("customFetch tags recognized native transport rejection", async () => {
  const originalFetch = globalThis.fetch;
  const cause = new TypeError("failed to fetch");
  globalThis.fetch = async () => {
    throw cause;
  };
  try {
    await assert.rejects(
      () => customFetch("/api/test", { responseType: "json", timeoutMs: null }),
      (error) => {
        assert.equal(error.name, "NetworkError");
        assert.equal(error.code, "request_network");
        assert.equal(error.cause, cause);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("customFetch preserves deterministic invalid-URL rejection", async () => {
  const invalidUrlError = new TypeError(
    "Failed to parse URL from [object Object]",
  );
  globalThis.fetch = async () => {
    throw invalidUrlError;
  };

  await assert.rejects(
    () => customFetch("/api/test", { responseType: "json", timeoutMs: null }),
    (error) => {
      assert.equal(error, invalidUrlError);
      assert.equal(error.code, undefined);
      return true;
    },
  );
});

test("customFetch preserves pre-response programming rejection", async () => {
  const programmingError = new Error("fetch adapter bug");
  globalThis.fetch = async () => {
    throw programmingError;
  };

  await assert.rejects(
    () => customFetch("/api/test", { responseType: "json", timeoutMs: null }),
    (error) => {
      assert.equal(error, programmingError);
      assert.equal(error.code, undefined);
      return true;
    },
  );
});

test("canceling the creator of a shared heavy GET does not cancel joined callers", async () => {
  resetCustomFetchDedupeForTests();
  const originalFetch = globalThis.fetch;
  let resolveFetch;
  let upstreamSignal;
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    upstreamSignal = init.signal;
    return new Promise((resolve, reject) => {
      resolveFetch = resolve;
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  };

  try {
    const creator = new AbortController();
    const joiner = new AbortController();
    const first = customFetch("/api/bars?symbol=AAPL", {
      signal: creator.signal,
      responseType: "json",
      timeoutMs: null,
    });
    const second = customFetch("/api/bars?symbol=AAPL", {
      signal: joiner.signal,
      responseType: "json",
      timeoutMs: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    creator.abort();

    await assert.rejects(first, (error) => error?.name === "AbortError");
    assert.equal(upstreamSignal.aborted, false);
    resolveFetch(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
    assert.deepEqual(await second, { ok: true });
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetCustomFetchDedupeForTests();
  }
});

test("shared heavy GETs never coalesce across API origins", async () => {
  resetCustomFetchDedupeForTests();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (input) => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ url: String(input) }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const [first, second] = await Promise.all([
      customFetch("/api/bars?symbol=AAPL", {
        baseUrl: "https://api-a.example",
        responseType: "json",
        timeoutMs: null,
      }),
      customFetch("/api/bars?symbol=AAPL", {
        baseUrl: "https://api-b.example",
        responseType: "json",
        timeoutMs: null,
      }),
    ]);

    assert.equal(fetchCalls, 2);
    assert.equal(first.url, "https://api-a.example/api/bars?symbol=AAPL");
    assert.equal(second.url, "https://api-b.example/api/bars?symbol=AAPL");
  } finally {
    globalThis.fetch = originalFetch;
    resetCustomFetchDedupeForTests();
  }
});

test("a queued heavy GET timeout includes queue wait and never starts stale work", async () => {
  resetCustomFetchDedupeForTests();
  const originalFetch = globalThis.fetch;
  const releases = [];
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    return new Promise((resolve, reject) => {
      releases.push(() =>
        resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          }),
        ),
      );
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  };

  try {
    const blockers = Array.from({ length: 6 }, (_, index) =>
      customFetch(`/api/bars?symbol=BLOCK${index}`, {
        responseType: "json",
        timeoutMs: null,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCalls, 6);

    await assert.rejects(
      () =>
        customFetch("/api/bars?symbol=QUEUED", {
          responseType: "json",
          timeoutMs: 20,
        }),
      (error) => error?.name === "TimeoutError",
    );
    assert.equal(fetchCalls, 6, "expired queued work must not reach fetch");

    releases.forEach((release) => release());
    await Promise.all(blockers);
  } finally {
    globalThis.fetch = originalFetch;
    resetCustomFetchDedupeForTests();
  }
});

test("queued heavy GET priority ages so older work cannot starve", async () => {
  resetCustomFetchDedupeForTests();
  const originalPerformanceNow = Object.getOwnPropertyDescriptor(
    globalThis.performance,
    "now",
  );
  let clockMs = 0;
  Object.defineProperty(globalThis.performance, "now", {
    configurable: true,
    value: () => clockMs,
  });

  const pending = [];
  globalThis.fetch = (input) =>
    new Promise((resolve) => {
      pending.push({
        input: String(input),
        release: () =>
          resolve(
            new Response(JSON.stringify({ ok: true }), {
              headers: { "content-type": "application/json" },
            }),
          ),
        released: false,
      });
    });

  const releaseStarted = () => {
    for (const request of pending) {
      if (!request.released) {
        request.released = true;
        request.release();
      }
    }
  };

  try {
    const blockers = Array.from({ length: 6 }, (_, index) =>
      customFetch(`/api/bars?symbol=BLOCK${index}`, {
        responseType: "json",
        timeoutMs: null,
      }),
    );
    assert.equal(pending.length, 6);

    const older = customFetch("/api/bars?symbol=OLDER", {
      headers: { "x-pyrus-fetch-priority": "0" },
      responseType: "json",
      timeoutMs: null,
    });
    clockMs = 20_000;
    const newer = customFetch("/api/bars?symbol=NEWER", {
      headers: { "x-pyrus-fetch-priority": "12" },
      responseType: "json",
      timeoutMs: null,
    });

    pending[0].released = true;
    pending[0].release();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(pending[6]?.input, "/api/bars?symbol=OLDER");

    const requests = [...blockers, older, newer];
    for (let attempt = 0; attempt < requests.length; attempt += 1) {
      releaseStarted();
      await new Promise((resolve) => setImmediate(resolve));
      if (pending.length === requests.length) break;
    }
    releaseStarted();
    await Promise.all(requests);
  } finally {
    if (originalPerformanceNow) {
      Object.defineProperty(
        globalThis.performance,
        "now",
        originalPerformanceNow,
      );
    } else {
      delete globalThis.performance.now;
    }
    resetCustomFetchDedupeForTests();
  }
});
