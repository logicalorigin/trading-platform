import assert from "node:assert/strict";
import test from "node:test";

const {
  customFetch,
  resetCustomFetchDedupeForTests,
  setCustomFetchTransientRetryDelaysForTests,
} = await import("./custom-fetch.ts");

const originalFetch = globalThis.fetch;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test.afterEach(() => {
  resetCustomFetchDedupeForTests();
  globalThis.fetch = originalFetch;
});

test("non-session startup metadata GETs are timeboxed without caller wiring", async () => {
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal);
    await new Promise((resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason ?? new Error("aborted")),
        { once: true },
      );
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await assert.rejects(
    () => customFetch("/api/watchlists", { responseType: "json" }),
    /timed out after 2500ms|TimeoutError/,
  );
});

test("API GETs retry transient proxy failures", async () => {
  setCustomFetchTransientRetryDelaysForTests([0, 0]);
  const statuses = [502, 503, 200];
  const requested = [];

  globalThis.fetch = async (input) => {
    requested.push(String(input));
    const status = statuses.shift() ?? 200;
    if (status !== 200) {
      return new Response("proxy warming", {
        status,
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  assert.deepEqual(
    await customFetch("/api/session", { responseType: "json" }),
    { ok: true },
  );
  assert.deepEqual(requested, ["/api/session", "/api/session", "/api/session"]);
});

test("API POSTs do not retry transient proxy failures", async () => {
  setCustomFetchTransientRetryDelaysForTests([0, 0]);
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response("proxy warming", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  };

  await assert.rejects(
    () =>
      customFetch("/api/session", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
        responseType: "json",
      }),
    (error) =>
      error?.name === "ApiError" &&
      error.status === 502 &&
      error.data === "proxy warming",
  );
  assert.equal(calls, 1);
});

test("non-API GETs do not retry transient proxy failures", async () => {
  setCustomFetchTransientRetryDelaysForTests([0, 0]);
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response("proxy warming", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  };

  await assert.rejects(
    () => customFetch("/assets/app.json", { responseType: "json" }),
    (error) => error?.name === "ApiError" && error.status === 502,
  );
  assert.equal(calls, 1);
});

test("identical heavy GETs share one upstream fetch", async () => {
  const responseReady = deferred();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await responseReady.promise;
    return new Response(JSON.stringify({ calls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const first = customFetch("/api/bars?b=2&a=1", { responseType: "json" });
  const second = customFetch("/api/bars?a=1&b=2", { responseType: "json" });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  responseReady.resolve();

  assert.deepEqual(await Promise.all([first, second]), [
    { calls: 1 },
    { calls: 1 },
  ]);
});

test("distinct heavy GETs are capped at three upstream fetches", async () => {
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  const pending = [];
  globalThis.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const gate = deferred();
    pending.push(gate);
    await gate.promise;
    active -= 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const requests = Array.from({ length: 5 }, (_, index) =>
    customFetch(`/api/bars?symbol=T${index}`, { responseType: "json" }).finally(
      () => {
        completed += 1;
      },
    ),
  );

  while (completed < requests.length) {
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(maxActive <= 3);
    const ready = pending.splice(0, pending.length);
    ready.forEach((gate) => gate.resolve());
  }

  await Promise.all(requests);
  assert.equal(maxActive, 3);
});

test("option-chain GETs run before queued bar GETs", async () => {
  const started = [];
  const pending = new Map();
  globalThis.fetch = async (input) => {
    const url = String(input);
    started.push(url);
    const gate = deferred();
    pending.set(url, gate);
    await gate.promise;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const activeBars = Array.from({ length: 3 }, (_, index) =>
    customFetch(`/api/bars?symbol=ACTIVE${index}`, { responseType: "json" }),
  );

  while (started.length < 3) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const queuedBars = Array.from({ length: 2 }, (_, index) =>
    customFetch(`/api/bars?symbol=QUEUED${index}`, { responseType: "json" }),
  );
  const queuedChain = customFetch(
    "/api/options/chains?underlying=SPY&expirationDate=2026-04-24",
    { responseType: "json" },
  );

  pending.get("/api/bars?symbol=ACTIVE0").resolve();
  while (started.length < 4) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(
    started[3],
    "/api/options/chains?underlying=SPY&expirationDate=2026-04-24",
  );

  pending.forEach((gate) => gate.resolve());
  while (started.length < 6) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  pending.forEach((gate) => gate.resolve());
  await Promise.all([...activeBars, ...queuedBars, queuedChain]);
});

test("prioritized bar GETs run before lower-priority queued bar GETs", async () => {
  const started = [];
  const pending = new Map();
  const priorityHeaderSeen = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    started.push(url);
    priorityHeaderSeen.push(new Headers(init?.headers).has("x-rayalgo-fetch-priority"));
    const gate = deferred();
    pending.set(url, gate);
    await gate.promise;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const activeBars = Array.from({ length: 3 }, (_, index) =>
    customFetch(`/api/bars?symbol=ACTIVE${index}`, { responseType: "json" }),
  );

  while (started.length < 3) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const queuedLow = customFetch("/api/bars?symbol=LOW", {
    headers: { "x-rayalgo-fetch-priority": "-2" },
    responseType: "json",
  });
  const queuedHigh = customFetch("/api/bars?symbol=HIGH", {
    headers: { "x-rayalgo-fetch-priority": "8" },
    responseType: "json",
  });

  pending.get("/api/bars?symbol=ACTIVE0").resolve();
  while (started.length < 4) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(started[3], "/api/bars?symbol=HIGH");
  assert.equal(priorityHeaderSeen[3], false);

  pending.forEach((gate) => gate.resolve());
  while (started.length < 5) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  pending.forEach((gate) => gate.resolve());
  await Promise.all([...activeBars, queuedLow, queuedHigh]);
});

test("bar priority header does not split identical request dedupe", async () => {
  const responseReady = deferred();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await responseReady.promise;
    return new Response(JSON.stringify({ calls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const first = customFetch("/api/bars?symbol=SPY", {
    headers: { "x-rayalgo-fetch-priority": "-2" },
    responseType: "json",
  });
  const second = customFetch("/api/bars?symbol=SPY", {
    headers: { "x-rayalgo-fetch-priority": "8" },
    responseType: "json",
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  responseReady.resolve();

  assert.deepEqual(await Promise.all([first, second]), [
    { calls: 1 },
    { calls: 1 },
  ]);
});

test("aborting one waiter does not abort shared upstream work", async () => {
  const responseReady = deferred();
  const controller = new AbortController();
  let calls = 0;
  let upstreamSignal;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    upstreamSignal = init?.signal;
    await responseReady.promise;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const first = customFetch("/api/options/chains?underlying=SPY", {
    signal: controller.signal,
    responseType: "json",
  });
  const second = customFetch("/api/options/chains?underlying=SPY", {
    responseType: "json",
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(calls, 1);
  assert.equal(upstreamSignal, undefined);

  responseReady.resolve();
  assert.deepEqual(await second, { ok: true });
});

test("bar GET aborts propagate to upstream fetch", async () => {
  const controller = new AbortController();
  let upstreamSignal;
  globalThis.fetch = async (_input, init) => {
    upstreamSignal = init?.signal;
    await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () =>
          reject(
            new DOMException("The operation was aborted.", "AbortError"),
          ),
        { once: true },
      );
    });
  };

  const request = customFetch("/api/bars?symbol=SPY", {
    signal: controller.signal,
    responseType: "json",
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(request, { name: "AbortError" });
  assert.equal(upstreamSignal?.aborted, true);
});

test("queued bar GET aborts before consuming a heavy slot", async () => {
  const started = [];
  const pending = new Map();
  globalThis.fetch = async (input) => {
    const url = String(input);
    started.push(url);
    const gate = deferred();
    pending.set(url, gate);
    await gate.promise;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const activeBars = Array.from({ length: 3 }, (_, index) =>
    customFetch(`/api/bars?symbol=ACTIVE${index}`, { responseType: "json" }),
  );

  while (started.length < 3) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const controller = new AbortController();
  const queued = customFetch("/api/bars?symbol=QUEUED_ABORT", {
    signal: controller.signal,
    responseType: "json",
  });
  controller.abort();

  await assert.rejects(queued, { name: "AbortError" });
  pending.get("/api/bars?symbol=ACTIVE0").resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(started, [
    "/api/bars?symbol=ACTIVE0",
    "/api/bars?symbol=ACTIVE1",
    "/api/bars?symbol=ACTIVE2",
  ]);

  pending.forEach((gate) => gate.resolve());
  await Promise.all(activeBars);
});

test("heavy GETs with different credentials do not share one fetch", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ calls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await Promise.all([
    customFetch("/api/bars?symbol=SPY", {
      credentials: "include",
      responseType: "json",
    }),
    customFetch("/api/bars?symbol=SPY", {
      credentials: "omit",
      responseType: "json",
    }),
  ]);

  assert.equal(calls, 2);
});

test("non-heavy paths are not deduped", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ calls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await Promise.all([
    customFetch("/api/session", { responseType: "json" }),
    customFetch("/api/session", { responseType: "json" }),
  ]);

  assert.equal(calls, 2);
});
