import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  useQuery,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import {
  AUTH_SESSION_QUERY_KEY,
  AuthProvider,
  applyAuthSessionTransition,
  clearUserScopedQueryCache,
  postAuthJson,
  readAuthSession,
} from "./authSession.jsx";

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

function installReactRootGlobals() {
  const globalNames = [
    "document",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "React",
    "window",
  ];
  const previousGlobals = globalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const noop = () => {};
  const document = {
    activeElement: null,
    addEventListener: noop,
    defaultView: globalThis,
    nodeType: 9,
    removeEventListener: noop,
  };
  const container = {
    addEventListener: noop,
    firstChild: null,
    lastChild: null,
    nodeType: 1,
    ownerDocument: document,
    parentNode: null,
    removeEventListener: noop,
    tagName: "DIV",
  };
  document.documentElement = container;
  globalThis.document = document;
  globalThis.HTMLIFrameElement = class {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.React = React;
  globalThis.window = globalThis;

  return {
    container,
    restore() {
      previousGlobals.forEach(([name, descriptor]) => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      });
    },
  };
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

test("an auth mutation waits for a definite server response without a client deadline", async () => {
  AbortSignal.timeout = () => {
    throw new Error("auth mutation installed an ambiguous client deadline");
  };
  let resolveFetch;
  let requestInit;
  globalThis.fetch = (path, init = {}) => {
    assert.equal(path, "/api/auth/login");
    requestInit = init;
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };

  const pending = postAuthJson("/api/auth/login", {
    email: "operator@example.com",
    password: "correct horse battery staple",
  });
  await Promise.resolve();

  assert.equal(requestInit.signal, undefined);
  const session = {
    user: { id: "user-a", entitlements: [] },
    csrfToken: "csrf-a",
    expiresAt: "2026-07-17T00:00:00.000Z",
  };
  resolveFetch(
    new Response(JSON.stringify(session), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.deepEqual(await pending, session);
});

test("both sign-in surfaces adopt the definitive POST response without a second session read", () => {
  const loginGate = readFileSync(
    new URL("./LoginGate.jsx", import.meta.url),
    "utf8",
  );
  const headerSession = readFileSync(
    new URL("../platform/HeaderSessionStatus.jsx", import.meta.url),
    "utf8",
  );

  assert.match(loginGate, /adoptSession\(session\)/);
  assert.doesNotMatch(loginGate, /await refresh\(\)/);
  assert.match(headerSession, /postAuthJson,\s*useAuthSession/);
  assert.doesNotMatch(headerSession, /async function postAuthJson/);
  assert.match(headerSession, /authSession\.adoptSession\(session\)/);
  assert.match(
    headerSession,
    /await postAuthJson\(\s*"\/api\/auth\/logout",[\s\S]*?finishAuthChange\(\{ user: null, csrfToken: null \}\)/,
  );
  assert.doesNotMatch(headerSession, /authSession\.refresh\(\)/);
});

test("an auth identity change evicts private queries before the next observer mounts", () => {
  const client = new QueryClient();
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: "user-a" },
  });
  client.setQueryData(["/api/algo/deployments"], {
    deployments: [{ id: "private-user-a-deployment" }],
  });
  client.setQueryData(["/api/accounts"], {
    accounts: [{ id: "private-user-a-account" }],
  });
  const priorIdentityObserver = new QueryObserver(client, {
    queryKey: ["/api/algo/deployments"],
    enabled: false,
  });
  const unsubscribePriorIdentity = priorIdentityObserver.subscribe(() => {});

  clearUserScopedQueryCache(client);

  assert.deepEqual(client.getQueryData(AUTH_SESSION_QUERY_KEY), {
    user: { id: "user-a" },
  });
  assert.equal(client.getQueryData(["/api/algo/deployments"]), undefined);
  assert.equal(client.getQueryData(["/api/accounts"]), undefined);
  // An already-mounted old-identity observer keeps its current render until the
  // auth identity boundary unmounts it; the next identity mounts cleanly.
  assert.deepEqual(priorIdentityObserver.getCurrentResult().data, {
    deployments: [{ id: "private-user-a-deployment" }],
  });
  unsubscribePriorIdentity();
  const nextIdentityObserver = new QueryObserver(client, {
    queryKey: ["/api/algo/deployments"],
    enabled: false,
  });
  assert.equal(nextIdentityObserver.getCurrentResult().data, undefined);
  client.clear();
});

test("a definitive auth response replaces identity after evicting private cache", () => {
  const client = new QueryClient();
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: "user-a" },
    csrfToken: "csrf-a",
  });
  client.setQueryData(["/api/accounts"], {
    accounts: [{ id: "private-user-a-account" }],
  });
  const nextSession = {
    user: { id: "user-b" },
    csrfToken: "csrf-b",
  };

  applyAuthSessionTransition(client, nextSession);

  assert.equal(client.getQueryData(["/api/accounts"]), undefined);
  assert.deepEqual(client.getQueryData(AUTH_SESSION_QUERY_KEY), nextSession);
  client.clear();
});

test("the StrictMode auth boundary remounts private observers only on identity change or revocation", async () => {
  const priorSession = {
    user: {
      id: "user-a",
      email: "a@example.com",
      displayName: "A",
      role: "member",
      entitlements: [],
    },
    csrfToken: "csrf-a",
  };
  const equivalentSession = {
    ...priorSession,
    csrfToken: "csrf-a-rotated",
  };
  const nextSession = {
    user: {
      id: "user-b",
      email: "b@example.com",
      displayName: "B",
      role: "member",
      entitlements: [],
    },
    csrfToken: "csrf-b",
  };
  const anonymousSession = {
    user: null,
    csrfToken: null,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(AUTH_SESSION_QUERY_KEY, priorSession);
  client.setQueryData(["/api/accounts"], {
    accounts: [{ id: "private-user-a-account" }],
  });
  const responses = [equivalentSession, nextSession, anonymousSession];
  let observedAccountId = null;
  let privateProbeMounts = 0;
  function PrivateAccountProbe() {
    const query = useQuery({
      queryKey: ["/api/accounts"],
      queryFn: async () => ({ accounts: [] }),
      enabled: false,
    });
    observedAccountId = query.data?.accounts?.[0]?.id ?? null;
    React.useEffect(() => {
      privateProbeMounts += 1;
    }, []);
    return null;
  }
  globalThis.fetch = async (path) => {
    assert.equal(path, "/api/auth/session");
    const session = responses.shift();
    assert.ok(session, "unexpected extra auth-session fetch");
    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const { container, restore } = installReactRootGlobals();
  const root = createRoot(container);
  let unmounted = false;
  try {
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            QueryClientProvider,
            { client },
            React.createElement(
              AuthProvider,
              null,
              React.createElement(PrivateAccountProbe),
            ),
          ),
        ),
      );
    });
    assert.equal(observedAccountId, "private-user-a-account");
    const priorIdentityMounts = privateProbeMounts;
    await act(async () => {
      await client.refetchQueries({
        queryKey: AUTH_SESSION_QUERY_KEY,
        type: "active",
      });
    });
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    assert.deepEqual(
      client.getQueryData(AUTH_SESSION_QUERY_KEY),
      equivalentSession,
    );
    assert.deepEqual(client.getQueryData(["/api/accounts"]), {
      accounts: [{ id: "private-user-a-account" }],
    });
    assert.equal(observedAccountId, "private-user-a-account");
    assert.equal(privateProbeMounts, priorIdentityMounts);

    await act(async () => {
      await client.refetchQueries({
        queryKey: AUTH_SESSION_QUERY_KEY,
        type: "active",
      });
    });
    await act(() => new Promise((resolve) => setImmediate(resolve)));

    assert.deepEqual(client.getQueryData(AUTH_SESSION_QUERY_KEY), nextSession);
    assert.equal(client.getQueryData(["/api/accounts"]), undefined);
    assert.equal(observedAccountId, null);
    assert.ok(privateProbeMounts > priorIdentityMounts);
    const nextIdentityMounts = privateProbeMounts;

    await act(async () => {
      client.setQueryData(["/api/accounts"], {
        accounts: [{ id: "private-user-b-account" }],
      });
      await Promise.resolve();
    });
    assert.deepEqual(client.getQueryData(["/api/accounts"]), {
      accounts: [{ id: "private-user-b-account" }],
    });
    await act(async () => {
      await client.refetchQueries({
        queryKey: AUTH_SESSION_QUERY_KEY,
        type: "active",
      });
    });
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    assert.deepEqual(
      client.getQueryData(AUTH_SESSION_QUERY_KEY),
      anonymousSession,
    );
    assert.equal(client.getQueryData(["/api/accounts"]), undefined);
    assert.ok(
      privateProbeMounts > nextIdentityMounts,
      `private observer did not remount (${privateProbeMounts} <= ${nextIdentityMounts})`,
    );
    assert.equal(observedAccountId, null);
    assert.equal(responses.length, 0);

    await act(async () => root.unmount());
    unmounted = true;
    client.setQueryData(["/api/accounts"], {
      accounts: [{ id: "post-unmount-private-account" }],
    });
    client.setQueryData(AUTH_SESSION_QUERY_KEY, priorSession);
    assert.deepEqual(client.getQueryData(["/api/accounts"]), {
      accounts: [{ id: "post-unmount-private-account" }],
    });
  } finally {
    if (!unmounted) {
      await act(async () => root.unmount());
    }
    client.clear();
    restore();
  }
});
