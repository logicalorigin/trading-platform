import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeIbkrHostControlKey,
  deriveIbkrHostControlKey,
  verifyIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";
import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  approveIbkrGatewayHost,
  ensureIbkrGatewayBrokerConnection,
  ensureIbkrGatewaySessionIdentity,
  registerIbkrGatewayHost,
  tryAcquireIbkrGatewayLease,
} from "./ibkr-gateway-session-store";
import { getIbkrClientPortalClient } from "./ibkr-client-runtime";
import { runWithIbkrPortalUser } from "./ibkr-portal-context";

import {
  ensureGateway,
  getGateway,
  markGatewayPaperAccountVerified,
  prepareGatewayDataRequest,
  refreshGateway,
  stopGateway,
} from "./ibkr-portal-gateway-manager";

test("fleet mode routes every operation through the current signed generation fence", async () => {
  await withTestDb(async () => {
    const names = [
      "IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY",
      "IBKR_GATEWAY_FLEET_ENABLED",
      "IBKR_SESSION_HOST_ENABLED",
      "TRADING_MODE",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    const previousFetch = globalThis.fetch;
    const hostId = "00000000-0000-4000-8000-000000000009";
    const rootKey = Buffer.alloc(32, 19);
    const hostKey = deriveIbkrHostControlKey(rootKey, hostId);
    const sha = `sha256:${"9".repeat(64)}`;
    const workloadIdentityDigest = "8".repeat(64);
    const requests: Array<{
      body: string;
      headers: Record<string, string>;
      method: string;
      path: string;
      redirect: RequestInit["redirect"];
      signal: boolean;
    }> = [];
    let recoveryUserId: string | null = null;

    process.env["IBKR_GATEWAY_FLEET_ENABLED"] = "1";
    process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] =
      rootKey.toString("base64url");
    delete process.env["IBKR_SESSION_HOST_ENABLED"];
    process.env["TRADING_MODE"] = "shadow";

    const [user] = await db
      .insert(usersTable)
      .values({
        email: "synthetic-manager-fleet@example.invalid",
        passwordHash: "synthetic-unused-hash",
      })
      .returning({ id: usersTable.id });
    assert.ok(user);
    assert.ok(
      await registerIbkrGatewayHost({
        hostId,
        workloadIdentityDigest,
        controlOrigin: "https://host-nine.example.invalid",
        imageDigest: sha,
        runtimeSpecDigest: sha,
        runtimeAttestationDigest: sha,
        failureDomain: "synthetic-zone-nine",
        measuredSlotCapacity: 1,
      }),
    );
    assert.ok(
      await approveIbkrGatewayHost({
        hostId,
        workloadIdentityDigest,
        imageDigest: sha,
        runtimeSpecDigest: sha,
        runtimeAttestationDigest: sha,
        admissionSlotCapacity: 1,
      }),
    );

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        body: String(init?.body ?? ""),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: String(init?.method ?? "GET"),
        path: `${url.pathname}${url.search}`,
        redirect: init?.redirect,
        signal: init?.signal instanceof AbortSignal,
      });
      if (url.pathname.endsWith("/release")) {
        return Response.json({ released: true });
      }
      if (url.pathname.endsWith("/status")) {
        return Response.json({
          capsule: {
            loginCompletions: 2,
            name: "pyrus-ibkr-slot-1",
            status: "ready",
          },
          targets: {
            cpg: { host: "127.0.0.1", port: 15009 },
            console: { host: "127.0.0.1", port: 16089 },
          },
        });
      }
      if (url.pathname.endsWith("/data/cpg/v1/api/tickle")) {
        return Response.json({ session: "synthetic-session" });
      }
      return Response.json({
        capsule: {
          loginCompletions: 1,
          name: "pyrus-ibkr-slot-1",
          status: "ready",
        },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      });
    }) as typeof fetch;

    try {
      const [gateway, concurrentGateway] = await Promise.all([
        ensureGateway(user.id),
        ensureGateway(user.id),
      ]);
      assert.deepEqual(concurrentGateway, gateway);
      assert.equal(gateway.hosted, true);
      assert.equal(gateway.recovered, false);
      assert.equal("fleetFence" in gateway, false);
      assert.equal(markGatewayPaperAccountVerified(user.id), true);
      await runWithIbkrPortalUser(user.id, () =>
        getIbkrClientPortalClient().tickleSession(),
      );

      const body = JSON.stringify({ synthetic: true });
      const data = await prepareGatewayDataRequest({
        appUserId: user.id,
        body,
        headers: { "content-type": "application/json" },
        kind: "cpg",
        method: "POST",
        path: "/v1/api/tickle?probe=1",
        transport: "http",
      });
      assert.equal(data.url.protocol, "https:");
      assert.match(
        data.url.pathname,
        /^\/sessions\/[0-9a-f-]+\/generations\/1\/slots\/1\/data\/cpg\/v1\/api\/tickle$/,
      );
      assert.equal(data.url.search, "?probe=1");
      assert.equal(
        verifyIbkrHostControlRequest({
          expectedHostId: hostId,
          body,
          headers: data.headers,
          key: hostKey,
          method: "POST",
          path: `${data.url.pathname}${data.url.search}`,
        }).valid,
        true,
      );

      const websocket = await prepareGatewayDataRequest({
        appUserId: user.id,
        headers: {},
        kind: "console",
        method: "GET",
        path: "/websockify?probe=2",
        transport: "websocket",
      });
      assert.equal(websocket.url.protocol, "wss:");
      assert.match(websocket.url.pathname, /\/data\/console\/websockify$/);

      await stopGateway(user.id);
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.equal(
          verifyIbkrHostControlRequest({
            expectedHostId: hostId,
            body: request.body,
            headers: request.headers,
            key: hostKey,
            method: request.method,
            path: request.path,
          }).valid,
          true,
        );
      }
      assert.match(requests[0]!.path, /\/generations\/1\/slots\/1\/ensure$/);
      assert.equal(requests[0]!.redirect, "error");
      assert.equal(requests[0]!.signal, true);
      assert.match(requests[1]!.path, /\/data\/cpg\/v1\/api\/tickle$/);
      assert.equal(requests[1]!.body, "{}");
      assert.equal(requests[1]!.redirect, "manual");
      assert.match(requests[2]!.path, /\/generations\/1\/slots\/1\/release$/);
      assert.equal(requests[2]!.redirect, "error");

      const [recoveryUser] = await db
        .insert(usersTable)
        .values({
          email: "synthetic-manager-recovery@example.invalid",
          passwordHash: "synthetic-unused-hash",
        })
        .returning({ id: usersTable.id });
      assert.ok(recoveryUser);
      recoveryUserId = recoveryUser.id;
      const connection = await ensureIbkrGatewayBrokerConnection({
        appUserId: recoveryUser.id,
        mode: "shadow",
      });
      assert.ok(connection);
      assert.ok(
        await ensureIbkrGatewaySessionIdentity({
          appUserId: recoveryUser.id,
          brokerConnectionId: connection.id,
        }),
      );
      assert.equal(
        (
          await tryAcquireIbkrGatewayLease({
            appUserId: recoveryUser.id,
            brokerConnectionId: connection.id,
          })
        ).status,
        "acquired",
      );
      const recovered = await refreshGateway(recoveryUser.id);
      assert.equal(recovered?.recovered, true);
      assert.equal(recovered?.port, 15009);
      assert.equal(recovered?.proxyPort, 16089);
      await stopGateway(recoveryUser.id);
      assert.match(requests[3]!.path, /\/generations\/1\/slots\/1\/status$/);
      assert.match(requests[4]!.path, /\/generations\/1\/slots\/1\/release$/);
    } finally {
      if (recoveryUserId) {
        await stopGateway(recoveryUserId).catch(() => undefined);
      }
      await stopGateway(user.id).catch(() => undefined);
      globalThis.fetch = previousFetch;
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

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

test("hosted IBKR mode prefers signed host-bound control requests", async () => {
  const names = [
    "IBKR_SESSION_HOST_ENABLED",
    "IBKR_SESSION_HOST_CONTROL_TOKEN",
    "IBKR_SESSION_HOST_CONTROL_KEY",
    "IBKR_SESSION_HOST_ID",
    "IBKR_SESSION_HOST_URL",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  const previousFetch = globalThis.fetch;
  const appUserId = "12121212-1212-4121-8121-121212121212";
  const hostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const encodedKey = Buffer.alloc(32, 11).toString("base64url");
  const key = decodeIbkrHostControlKey(encodedKey)!;
  const requests: Array<{
    headers: Record<string, string>;
    method: string;
    path: string;
  }> = [];

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "legacy-token";
  process.env["IBKR_SESSION_HOST_CONTROL_KEY"] = encodedKey;
  process.env["IBKR_SESSION_HOST_ID"] = hostId;
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      method: String(init?.method ?? "GET"),
      path: url.pathname,
    });
    if (url.pathname.endsWith("/release")) {
      return Response.json({ released: true });
    }
    return Response.json({
      capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    await ensureGateway(appUserId);
    await stopGateway(appUserId);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(
        verifyIbkrHostControlRequest({
          expectedHostId: hostId,
          headers: request.headers,
          key,
          method: request.method,
          path: request.path,
        }).valid,
        true,
      );
      assert(!request.headers.authorization?.includes("legacy-token"));
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
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
