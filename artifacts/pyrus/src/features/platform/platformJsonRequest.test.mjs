import test from "node:test";
import assert from "node:assert/strict";

import { platformJsonRequest } from "./platformJsonRequest.js";

// platformJsonRequest schedules its abort timer via window.setTimeout, so the
// module needs a window with the timer functions in a Node test context.
globalThis.window = globalThis.window ?? {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (id) => clearTimeout(id),
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("adds an in-memory CSRF token to state-changing requests", async () => {
  let observedInit = null;
  globalThis.fetch = (_path, init) => {
    observedInit = init;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
  };

  await platformJsonRequest("/api/watchlists", {
    method: "POST",
    body: { name: "Tech" },
    csrfToken: "session-csrf",
  });

  assert.equal(observedInit.headers["X-CSRF-Token"], "session-csrf");
});

test("does not attach a CSRF token to read-only requests", async () => {
  let observedInit = null;
  globalThis.fetch = (_path, init) => {
    observedInit = init;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
  };

  await platformJsonRequest("/api/watchlists", {
    method: "GET",
    csrfToken: "session-csrf",
  });

  assert.equal(observedInit.headers["X-CSRF-Token"], undefined);
});

test("a native fetch transport failure is tagged for the shared retry policy", async () => {
  const cause = new TypeError("Failed to fetch");
  globalThis.fetch = async () => {
    throw cause;
  };

  await assert.rejects(
    () => platformJsonRequest("/api/test"),
    (error) => {
      assert.equal(error.name, "NetworkError");
      assert.equal(error.code, "request_network");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test("deterministic fetch configuration and programming errors stay untagged", async () => {
  const deterministicErrors = [
    new TypeError("Failed to parse URL from [object Object]"),
    new Error("fetch adapter bug"),
  ];

  for (const deterministicError of deterministicErrors) {
    globalThis.fetch = async () => {
      throw deterministicError;
    };

    await assert.rejects(
      () => platformJsonRequest("/api/test"),
      (error) => {
        assert.equal(error, deterministicError);
        assert.equal(error.code, undefined);
        return true;
      },
    );
  }
});

test("a deterministic JSON parse error stays untagged", async () => {
  const parseError = new SyntaxError("Unexpected token");
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw parseError;
    },
  });

  await assert.rejects(
    () => platformJsonRequest("/api/test"),
    (error) => {
      assert.equal(error, parseError);
      assert.equal(error.code, undefined);
      return true;
    },
  );
});

test("timeoutMs aborts a stalled request instead of hanging forever", async () => {
  // A fetch that never settles until its AbortSignal fires.
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      platformJsonRequest(
        "/api/settings/backend/actions/runtime.refresh",
        { method: "POST", body: { force: true }, timeoutMs: 80 },
      ),
    /timed out after 80ms/,
  );
  assert.ok(
    Date.now() - startedAt >= 60,
    "should wait roughly timeoutMs before aborting",
  );
});

test("a timeout error is tagged code=request_timeout so callers can treat it as non-fatal", async () => {
  // Callers can branch on this tag without parsing the message string.
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  await platformJsonRequest("/x", { method: "POST", body: {}, timeoutMs: 40 }).then(
    () => assert.fail("should have timed out"),
    (error) => {
      assert.equal(error.code, "request_timeout");
      assert.equal(error.timedOut, true);
    },
  );
});

test("timeoutMs remains active while the response body is parsed", async () => {
  globalThis.fetch = (_path, init) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });

  await platformJsonRequest("/x", { timeoutMs: 30 }).then(
    () => assert.fail("response parsing should have timed out"),
    (error) => {
      assert.equal(error.code, "request_timeout");
      assert.equal(error.timedOut, true);
    },
  );
});

test("caller cancellation remains active while the response body is parsed", async () => {
  const controller = new AbortController();
  globalThis.fetch = (_path, init) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });

  const request = platformJsonRequest("/x", {
    signal: controller.signal,
    timeoutMs: 1_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await request.then(
    () => assert.fail("response parsing should have been canceled"),
    (error) => {
      assert.equal(error.code, "request_canceled");
      assert.notEqual(error.timedOut, true);
    },
  );
});

test("an external cancel is tagged code=request_canceled, not request_timeout", async () => {
  const controller = new AbortController();
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  const request = platformJsonRequest("/x", { signal: controller.signal });
  controller.abort();

  await request.then(
    () => assert.fail("should have been canceled"),
    (error) => {
      assert.equal(error.code, "request_canceled");
      assert.notEqual(error.timedOut, true);
    },
  );
});

test("timeoutMs still bounds a request when the caller also supplies a signal", async () => {
  const callerController = new AbortController();
  let observedSignal = null;
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      observedSignal = init.signal;
      const guardId = setTimeout(
        () => reject(new Error("test guard: request timeout was not composed")),
        120,
      );
      init.signal.addEventListener("abort", () => {
        clearTimeout(guardId);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  await platformJsonRequest("/x", {
    signal: callerController.signal,
    timeoutMs: 30,
  }).then(
    () => assert.fail("should have timed out"),
    (error) => {
      assert.equal(error.code, "request_timeout");
      assert.equal(error.timedOut, true);
    },
  );

  assert.notEqual(
    observedSignal,
    callerController.signal,
    "fetch should receive the signal that composes caller cancellation and timeout",
  );
  assert.equal(callerController.signal.aborted, false);
});

test("caller cancellation wins over a later composed timeout", async () => {
  const callerController = new AbortController();
  let observedSignal = null;
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      observedSignal = init.signal;
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  const request = platformJsonRequest("/x", {
    signal: callerController.signal,
    timeoutMs: 1_000,
  });
  callerController.abort();

  await request.then(
    () => assert.fail("should have been canceled"),
    (error) => {
      assert.equal(error.code, "request_canceled");
      assert.notEqual(error.timedOut, true);
    },
  );
  assert.notEqual(observedSignal, callerController.signal);
});

test("without timeoutMs no abort signal is wired — the old unbounded behavior", async () => {
  let observedSignal = "unset";
  globalThis.fetch = (_path, init) => {
    observedSignal = init.signal;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ cleared: true }),
    });
  };

  const result = await platformJsonRequest("/x", { method: "POST", body: {} });
  assert.deepEqual(result, { cleared: true });
  assert.equal(
    observedSignal,
    undefined,
    "timeoutMs:0 wires no AbortController, so a stalled request would hang forever",
  );
});

test("an external abort signal can cancel an unbounded request", async () => {
  const controller = new AbortController();
  let observedSignal = null;
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      observedSignal = init.signal;
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  const request = platformJsonRequest("/x", { signal: controller.signal });
  controller.abort();

  await assert.rejects(() => request, /Request canceled/);
  assert.equal(observedSignal, controller.signal);
});

test("a fast success within the timeout still returns parsed JSON (happy path)", async () => {
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ cleared: true, reason: "no_override" }),
    });

  const result = await platformJsonRequest("/x", {
    method: "POST",
    body: { force: true },
    timeoutMs: 15000,
  });
  assert.deepEqual(result, { cleared: true, reason: "no_override" });
});

test("non-2xx errors carry retryAfterMs from Retry-After headers", async () => {
  globalThis.fetch = () =>
    Promise.resolve({
      ok: false,
      status: 429,
      headers: {
        get: (name) => (name.toLowerCase() === "retry-after" ? "3" : null),
      },
      json: async () => ({ message: "Request shed" }),
    });

  await platformJsonRequest("/x").then(
    () => assert.fail("should reject"),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 3_000);
    },
  );
});
