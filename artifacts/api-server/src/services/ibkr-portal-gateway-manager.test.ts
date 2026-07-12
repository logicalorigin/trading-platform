import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureGateway,
  getGateway,
  markGatewayPaperAccountVerified,
  refreshGateway,
  stopGateway,
} from "./ibkr-portal-gateway-manager";

test("hosted IBKR mode provisions through the loopback session host", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "11111111-1111-4111-8111-111111111111";
  const requests: Array<{ method: string; url: string; authorization: string | null }> = [];
  let statusReads = 0;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748/";
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (String(input).endsWith("/release")) {
      return Response.json({ released: true });
    }
    if (String(input).endsWith("/status")) {
      statusReads += 1;
      return Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: statusReads === 1 ? 2 : 1,
        },
      });
    }
    return Response.json({
      capsule: {
        name: "pyrus-ibkr-slot-1",
        status: "occupied",
        loginCompletions: 1,
      },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    const gateway = await ensureGateway(appUserId);
    assert.deepEqual(gateway, {
      appUserId,
      baseUrl: "http://127.0.0.1:15000/v1/api",
      hosted: true,
      loginCompletions: 1,
      origin: "http://127.0.0.1:15000",
      port: 15000,
      proxyOrigin: "http://127.0.0.1:16080",
      proxyPort: 16080,
      paperAccountVerified: false,
      recovered: false,
      status: "starting",
      startedAt: gateway.startedAt,
    });
    assert.deepEqual(getGateway(appUserId), gateway);

    const readyGateway = await refreshGateway(appUserId);
    assert.equal(readyGateway?.status, "ready");
    assert.equal(readyGateway?.loginCompletions, 2);
    assert.equal(markGatewayPaperAccountVerified(appUserId), true);
    assert.equal(getGateway(appUserId)?.paperAccountVerified, true);
    const staleGateway = await refreshGateway(appUserId);
    assert.equal(staleGateway?.loginCompletions, 2);

    await stopGateway(appUserId);

    assert.deepEqual(requests, [
      {
        method: "POST",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/ensure`,
        authorization: "Bearer host-token",
      },
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
      {
        method: "POST",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/release`,
        authorization: "Bearer host-token",
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("coalesces concurrent hosted status reads to prevent out-of-order state", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "19191919-1919-4191-8191-191919191919";
  let statusReads = 0;
  let markStatusStarted!: () => void;
  let releaseStatus!: () => void;
  const statusStarted = new Promise<void>((resolve) => {
    markStatusStarted = resolve;
  });
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/release")) {
      return Response.json({ released: true });
    }
    if (url.endsWith("/status")) {
      statusReads += 1;
      markStatusStarted();
      await statusGate;
      return Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 2,
        },
      });
    }
    return Response.json({
      capsule: {
        name: "pyrus-ibkr-slot-1",
        status: "ready",
        loginCompletions: 1,
      },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    await ensureGateway(appUserId);
    const first = refreshGateway(appUserId);
    await statusStarted;
    const second = refreshGateway(appUserId);
    await new Promise((resolve) => setImmediate(resolve));
    try {
      assert.equal(statusReads, 1);
    } finally {
      releaseStatus();
    }
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult?.status, "ready");
    assert.deepEqual(secondResult, firstResult);
  } finally {
    releaseStatus();
    await stopGateway(appUserId).catch(() => undefined);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("hosted IBKR mode recovers an owned gateway after an API reload", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "12121212-1212-4121-8121-121212121212";
  const requests: Array<{
    method: string;
    url: string;
    authorization: string | null;
  }> = [];
  let statusReads = 0;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (String(input).endsWith("/status")) {
      statusReads += 1;
      if (statusReads > 1) {
        return Response.json({ capsule: null }, { status: 404 });
      }
      return Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 3,
        },
      });
    }
    if (String(input).endsWith("/ensure")) {
      throw new Error("readiness recovery must not provision a capsule");
    }
    return Response.json({ released: true });
  }) as typeof fetch;

  try {
    assert.equal(getGateway(appUserId), null);
    const recovered = await refreshGateway(appUserId);
    assert.equal(recovered?.status, "ready");
    assert.equal(recovered?.hosted, true);
    assert.equal(recovered?.loginCompletions, 3);
    assert.equal(recovered?.port, 15000);
    assert.equal(recovered?.proxyPort, 16080);
    assert.deepEqual(getGateway(appUserId), recovered);
    assert.deepEqual(requests, [
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
    ]);
    assert.equal(await refreshGateway(appUserId), null);
    assert.equal(getGateway(appUserId), null);
    assert.deepEqual(requests, [
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
    ]);
  } finally {
    await stopGateway(appUserId).catch(() => undefined);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("concurrent hosted recovery and ensure preserve the freshest count", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "13131313-1313-4131-8131-131313131313";
  let resolveStale!: (response: Response) => void;
  let resolveFresh!: (response: Response) => void;
  const stale = new Promise<Response>((resolve) => {
    resolveStale = resolve;
  });
  const fresh = new Promise<Response>((resolve) => {
    resolveFresh = resolve;
  });
  let statusReads = 0;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/release")) {
      return Response.json({ released: true });
    }
    statusReads += 1;
    return statusReads === 1 ? stale : fresh;
  }) as typeof fetch;

  try {
    const staleEnsure = ensureGateway(appUserId);
    const freshRefresh = refreshGateway(appUserId);
    resolveFresh(
      Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 2,
        },
      }),
    );
    assert.equal((await freshRefresh)?.loginCompletions, 2);
    resolveStale(
      Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 1,
        },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      }),
    );
    assert.equal((await staleEnsure).loginCompletions, 2);
    assert.equal(getGateway(appUserId)?.recovered, false);
    assert.equal(getGateway(appUserId)?.loginCompletions, 2);
  } finally {
    await stopGateway(appUserId).catch(() => undefined);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("a stale hosted 404 cannot delete a replacement gateway", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "16161616-1616-4161-8161-161616161616";
  let ensureReads = 0;
  let statusReads = 0;
  let resolveStaleStatus!: (response: Response) => void;
  const staleStatus = new Promise<Response>((resolve) => {
    resolveStaleStatus = resolve;
  });

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/release")) {
      return Response.json({ released: true });
    }
    if (String(input).endsWith("/status")) {
      statusReads += 1;
      if (statusReads === 1) return staleStatus;
      return Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 2,
        },
      });
    }
    ensureReads += 1;
    return Response.json({
      capsule: {
        name: "pyrus-ibkr-slot-1",
        status: "ready",
        loginCompletions: ensureReads,
      },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    await ensureGateway(appUserId);
    const staleRefresh = refreshGateway(appUserId);
    await stopGateway(appUserId);
    const replacement = await ensureGateway(appUserId);
    assert.equal(replacement.loginCompletions, 2);
    const replacementRefresh = refreshGateway(appUserId);

    resolveStaleStatus(Response.json({ capsule: null }, { status: 404 }));
    assert.equal(await staleRefresh, null);
    assert.equal((await replacementRefresh)?.loginCompletions, 2);
    assert.equal(statusReads, 2);
    assert.equal(getGateway(appUserId)?.loginCompletions, 2);
  } finally {
    await stopGateway(appUserId).catch(() => undefined);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("hosted stop invalidates in-flight recovery and ensure responses", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const recoveryUserId = "17171717-1717-4171-8171-171717171717";
  const ensureUserId = "18181818-1818-4181-8181-181818181818";
  let resolveRecovery!: (response: Response) => void;
  let resolveEnsure!: (response: Response) => void;
  const recoveryResponse = new Promise<Response>((resolve) => {
    resolveRecovery = resolve;
  });
  const ensureResponse = new Promise<Response>((resolve) => {
    resolveEnsure = resolve;
  });

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/release")) {
      return Response.json({ released: true });
    }
    if (url.includes(recoveryUserId) && url.endsWith("/status")) {
      return recoveryResponse;
    }
    if (url.includes(ensureUserId) && url.endsWith("/ensure")) {
      return ensureResponse;
    }
    throw new Error(`unexpected host request: ${url}`);
  }) as typeof fetch;

  try {
    const staleRecovery = refreshGateway(recoveryUserId);
    await stopGateway(recoveryUserId);
    resolveRecovery(
      Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 3,
        },
      }),
    );
    assert.equal(await staleRecovery, null);
    assert.equal(getGateway(recoveryUserId), null);

    const staleEnsure = ensureGateway(ensureUserId);
    const stopping = stopGateway(ensureUserId);
    resolveEnsure(
      Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 1,
        },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      }),
    );
    await stopping;
    await assert.rejects(staleEnsure);
    assert.equal(getGateway(ensureUserId), null);
  } finally {
    await stopGateway(recoveryUserId).catch(() => undefined);
    await stopGateway(ensureUserId).catch(() => undefined);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("hosted IBKR disconnect releases an owned gateway after an API reload", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "14141414-1414-4141-8141-141414141414";
  const requests: Array<{
    method: string;
    url: string;
    authorization: string | null;
  }> = [];

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({ released: true });
  }) as typeof fetch;

  try {
    assert.equal(getGateway(appUserId), null);
    await stopGateway(appUserId);
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/release`,
        authorization: "Bearer host-token",
      },
    ]);
    assert.equal(getGateway(appUserId), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("hosted IBKR recovery does not provision a missing gateway", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "13131313-1313-4131-8131-131313131313";
  const requests: Array<{
    method: string;
    url: string;
    authorization: string | null;
  }> = [];

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({ capsule: null }, { status: 404 });
  }) as typeof fetch;

  try {
    assert.equal(await refreshGateway(appUserId), null);
    assert.deepEqual(requests, [
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("hosted IBKR mode rejects non-loopback relay targets", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousFetch = globalThis.fetch;
  const appUserId = "22222222-2222-4222-8222-222222222222";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  globalThis.fetch = (async () =>
    Response.json({
      capsule: {
        name: "pyrus-ibkr-slot-1",
        status: "ready",
        loginCompletions: 0,
      },
      targets: {
        cpg: { host: "169.254.169.254", port: 80 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => ensureGateway(appUserId),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_session_host_response_invalid",
    );
    assert.equal(getGateway(appUserId), null);
  } finally {
    await stopGateway(appUserId);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
  }
});

test("hosted IBKR mode surfaces release failures after removing broker routing", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousFetch = globalThis.fetch;
  const appUserId = "77777777-7777-4777-8777-777777777777";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/release")) {
      return Response.json(
        { error: { code: "docker_failure" } },
        { status: 503 },
      );
    }
    return Response.json({
      capsule: {
        name: "pyrus-ibkr-slot-1",
        status: "ready",
        loginCompletions: 0,
      },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    await ensureGateway(appUserId);
    await assert.rejects(
      () => stopGateway(appUserId),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_session_host_control_failed",
    );
    assert.equal(getGateway(appUserId), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
  }
});

test("hosted IBKR mode rejects a non-loopback control URL without sending its token", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://169.254.169.254/latest";
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return Response.json({});
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => ensureGateway("99999999-9999-4999-8999-999999999999"),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_session_host_config_invalid",
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});
