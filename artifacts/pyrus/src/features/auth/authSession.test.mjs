import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { AUTH_SESSION_QUERY_KEY, readAuthSession } from "./authSession.jsx";

const originalFetch = globalThis.fetch;
const originalAbortSignalTimeout = AbortSignal.timeout;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalAbortSignalTimeout;
});

function installFastAuthTimeout(timeoutMs = 30) {
  AbortSignal.timeout = (requestedMs) => {
    assert.equal(requestedMs, 8000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    return controller.signal;
  };
}

function stubHungFetch() {
  let observedSignal = null;
  globalThis.fetch = (path, init = {}) => {
    assert.equal(path, "/api/auth/session");
    observedSignal = init.signal;
    return new Promise((_resolve, reject) => {
      observedSignal.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  };
  return () => observedSignal;
}

test("readAuthSession aborts a hung session fetch after the auth timeout", async () => {
  installFastAuthTimeout();
  const getObservedSignal = stubHungFetch();

  await assert.rejects(() => readAuthSession(), /aborted/);
  assert.equal(getObservedSignal()?.aborted, true);
});

test("a hung auth session query flips to isError within the timeout", async () => {
  installFastAuthTimeout();
  stubHungFetch();

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new QueryObserver(client, {
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: readAuthSession,
    retry: false,
  });

  const errorState = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("auth session query stayed loading")),
      250,
    );
    const unsubscribe = observer.subscribe((state) => {
      if (!state.isError) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(state);
    });
    observer.refetch().catch(() => {});
  });

  const state = await errorState;
  client.clear();
  assert.equal(state.isError, true);
  assert.equal(state.isLoading, false);
});
