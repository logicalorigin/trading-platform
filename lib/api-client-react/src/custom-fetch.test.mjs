import assert from "node:assert/strict";
import test from "node:test";

import {
  __customFetchInternalsForTests,
  customFetch,
  resetCustomFetchDedupeForTests,
  setCsrfTokenGetter,
} from "./custom-fetch.ts";

const {
  applyBaseUrl,
  isHeavyGetPath,
  resolveDefaultRequestTimeoutMs,
} = __customFetchInternalsForTests;

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

test("account Positions gets a timeout budget larger than its two sequential provider deadlines", () => {
  const positionsPath = "/api/accounts/DU123456/positions";
  assert.equal(isHeavyGetPath(positionsPath), true);
  assert.equal(resolveDefaultRequestTimeoutMs(positionsPath, "GET"), 45_000);

  const summaryPath = "/api/accounts/DU123456/summary";
  assert.equal(isHeavyGetPath(summaryPath), false);
  assert.equal(resolveDefaultRequestTimeoutMs(summaryPath, "GET"), 20_000);
});

async function captureRequestHeaders(options, input = "/api/test") {
  const originalFetch = globalThis.fetch;
  let requestHeaders = null;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await customFetch(input, {
      responseType: "json",
      timeoutMs: null,
      ...options,
    });
    return requestHeaders;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("customFetch attaches the configured CSRF token to unsafe methods", async () => {
  setCsrfTokenGetter(() => "csrf-from-session");
  try {
    const headers = await captureRequestHeaders({
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(headers.get("x-csrf-token"), "csrf-from-session");
  } finally {
    setCsrfTokenGetter(null);
  }
});

test("customFetch never sends the session CSRF token cross-origin", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: new URL("https://app.synthetic.invalid/workspace"),
    dispatchEvent() {},
  };
  setCsrfTokenGetter(() => "synthetic-csrf-from-session");
  try {
    const headers = await captureRequestHeaders(
      {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      },
      "https://external.synthetic.invalid/api/test",
    );
    assert.equal(headers.get("x-csrf-token"), null);
  } finally {
    setCsrfTokenGetter(null);
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("customFetch does not attach a CSRF token to safe methods", async () => {
  setCsrfTokenGetter(() => "csrf-from-session");
  try {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const headers = await captureRequestHeaders({ method });
      assert.equal(headers.get("x-csrf-token"), null, method);
    }
  } finally {
    setCsrfTokenGetter(null);
  }
});

test("customFetch preserves an explicitly supplied CSRF token", async () => {
  setCsrfTokenGetter(() => "csrf-from-session");
  try {
    const headers = await captureRequestHeaders({
      method: "PATCH",
      headers: { "X-CSRF-Token": "explicit-token" },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(headers.get("x-csrf-token"), "explicit-token");
  } finally {
    setCsrfTokenGetter(null);
  }
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

test("customFetch tags transport rejection separately from deterministic failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("failed to fetch");
  };
  try {
    await assert.rejects(
      () => customFetch("/api/test", { responseType: "json", timeoutMs: null }),
      (error) => {
        assert.equal(error.name, "NetworkError");
        assert.equal(error.code, "request_network");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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
