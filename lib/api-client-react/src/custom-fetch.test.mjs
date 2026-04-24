import assert from "node:assert/strict";
import test from "node:test";

const { customFetch, resetCustomFetchDedupeForTests } = await import(
  "./custom-fetch.ts"
);

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
