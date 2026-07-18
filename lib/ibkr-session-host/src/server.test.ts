import assert from "node:assert/strict";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import test from "node:test";

import {
  decodeIbkrHostControlKey,
  signIbkrHostControlRequest,
  verifyIbkrHostControlReceipt,
} from "@workspace/ibkr-contracts/control-auth";

import { CapsuleError } from "./capsule";
import { createSessionHostServer } from "./server";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const BOOT_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_NOT_AFTER_NS = "1234567890123456";

function leaseRequest(controlAttemptId: string) {
  return {
    version: 1 as const,
    bootId: BOOT_ID,
    grantNotAfterNs: GRANT_NOT_AFTER_NS,
    controlAttemptId,
  };
}

async function withServer(
  dockerReady: boolean,
  run: (baseUrl: string) => Promise<void>,
  controlToken?: string,
): Promise<void> {
  const server = createSessionHostServer({
    controlToken,
    ensureSession: async (sessionId) => ({
      name: "pyrus-ibkr-slot-1",
      status: sessionId === SESSION_ID ? "ready" : "occupied",
    }),
    releaseSession: async () => undefined,
    readiness: () =>
      dockerReady
        ? { ready: true }
        : { ready: false, code: "docker_unavailable" },
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 0 },
    }),
    statusSession: async (sessionId) =>
      sessionId === SESSION_ID
        ? { name: "pyrus-ibkr-slot-1", status: "ready" }
        : null,
    target: (_sessionId, _generation, kind) =>
      kind === "cpg"
        ? { host: "127.0.0.1", port: 15000 }
        : { host: "127.0.0.1", port: 16080 },
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("serves a minimal redacted liveness response with security headers", async () => {
  await withServer(false, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      service: "ibkr-session-host",
      status: "ok",
      mode: "paper",
      capacity: { max: 1, active: 0 },
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("content-security-policy"),
      "default-src 'none'",
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    for (const forbidden of [
      "sha256",
      "11111111-1111-4111-8111-111111111111",
      "token",
      "stderr",
      "/home/",
    ]) {
      assert(!serialized.includes(forbidden));
    }
  });
});

test("refreshes runtime readiness instead of serving a startup snapshot", async () => {
  let ready = false;
  const server = createSessionHostServer({
    readiness: () =>
      ready ? { ready: true } : { ready: false, code: "docker_unavailable" },
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 0 },
    }),
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${baseUrl}/readyz`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${baseUrl}/readyz`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("keeps readiness separate from liveness and sanitizes Docker failure", async () => {
  await withServer(false, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      service: "ibkr-session-host",
      status: "degraded",
      code: "docker_unavailable",
      mode: "paper",
      capacity: { max: 1, active: 0 },
    });
  });
});

test("reports ready only after the Docker preflight succeeds", async () => {
  await withServer(true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/readyz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      service: "ibkr-session-host",
      status: "ready",
      mode: "paper",
      capacity: { max: 1, active: 0 },
    });
  });
});

test("keeps session control closed without the bearer token", async () => {
  await withServer(true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions/${SESSION_ID}/ensure`, {
      method: "POST",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: { code: "unauthorized", message: "Unauthorized." },
    });
  });
});

test("accepts one signed host-bound request and rejects its replay", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 9).toString("base64url"),
  )!;
  const overlapKey = decodeIbkrHostControlKey(
    Buffer.alloc(32, 10).toString("base64url"),
  )!;
  const hostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let ensures = 0;
  const leases: unknown[] = [];
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      overlapKey,
      nowSeconds: () => 1_784_200_000,
    },
    ensureSession: async (_sessionId, _generation, _slotNumber, lease) => {
      ensures += 1;
      leases.push(lease);
      return { name: "pyrus-ibkr-slot-1", status: "ready" };
    },
    issueLeaseGrant: leaseRequest,
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
    target: (_sessionId, _generation, kind) =>
      kind === "cpg"
        ? { host: "127.0.0.1", port: 15000 }
        : { host: "127.0.0.1", port: 16080 },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const legacyPath = `/sessions/${SESSION_ID}/ensure`;
    const legacy = await fetch(`http://127.0.0.1:${port}${legacyPath}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        nonce: "b".repeat(32),
        path: legacyPath,
        timestampSeconds: 1_784_200_000,
      }),
    });
    assert.equal(legacy.status, 400);
    assert.equal(legacy.headers.get("x-pyrus-control-receipt"), null);
    assert.deepEqual(await legacy.json(), {
      error: {
        code: "control_attempt_invalid",
        message: "IBKR session control failed.",
      },
    });
    const routePath = `/sessions/${SESSION_ID}/generations/7/slots/1/ensure`;
    const controlAttemptId = "33333333-3333-4333-8333-333333333333";
    const path = `${routePath}?controlAttemptId=${controlAttemptId}`;
    const headers = signIbkrHostControlRequest({
      hostId,
      key: overlapKey,
      method: "POST",
      nonce: "c".repeat(32),
      path,
      timestampSeconds: 1_784_200_000,
    });
    const first = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
    });
    assert.equal(first.status, 200);
    const firstBody = await first.text();
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "ensure",
        body: firstBody,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(first.headers.entries()),
        key,
        status: first.status,
      }),
      true,
    );
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "ensure",
        body: firstBody,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(first.headers.entries()),
        key: overlapKey,
        status: first.status,
      }),
      false,
    );
    assert.deepEqual(JSON.parse(firstBody), {
      action: "ensure",
      controlAttemptId,
      sessionId: SESSION_ID,
      generation: 7,
      slotNumber: 1,
      capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      lease: {
        version: 1,
        bootId: BOOT_ID,
        grantNotAfterNs: GRANT_NOT_AFTER_NS,
      },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
    const primaryAttemptId = "44444444-4444-4444-8444-444444444444";
    const primaryPath = `${routePath}?controlAttemptId=${primaryAttemptId}`;
    const primary = await fetch(`http://127.0.0.1:${port}${primaryPath}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        nonce: "d".repeat(32),
        path: primaryPath,
        timestampSeconds: 1_784_200_000,
      }),
    });
    assert.equal(primary.status, 200);
    const replay = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
    });
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), {
      error: { code: "unauthorized", message: "Unauthorized." },
    });
    const rejectedAttemptId = "55555555-5555-4555-8555-555555555555";
    const rejectedPath = `${routePath}?controlAttemptId=${rejectedAttemptId}`;
    const rejectedBody = "{}";
    const rejected = await fetch(`http://127.0.0.1:${port}${rejectedPath}`, {
      body: rejectedBody,
      method: "POST",
      headers: signIbkrHostControlRequest({
        body: rejectedBody,
        hostId,
        key,
        method: "POST",
        nonce: "f".repeat(32),
        path: rejectedPath,
        timestampSeconds: 1_784_200_000,
      }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), {
      action: "ensure",
      controlAttemptId: rejectedAttemptId,
      error: {
        code: "control_body_invalid",
        message: "IBKR session control failed.",
      },
    });
    assert.equal(ensures, 2);
    assert.deepEqual(leases, [
      leaseRequest(controlAttemptId),
      leaseRequest(primaryAttemptId),
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("mints a signed fleet lease from the session host clock", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 29).toString("base64url"),
  )!;
  const hostId = "29292929-2929-4929-8929-292929292929";
  const controlAttemptId = "39393939-3939-4939-8939-393939393939";
  const hostLease = {
    version: 1 as const,
    bootId: "49494949-4949-4949-8949-494949494949",
    controlAttemptId,
    grantNotAfterNs: "292000000000",
  };
  let receivedLease: unknown;
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      nowSeconds: () => 1_784_200_000,
    },
    ensureSession: async (_sessionId, _generation, _slotNumber, lease) => {
      receivedLease = lease;
      return { name: "pyrus-ibkr-slot-1", status: "ready" };
    },
    issueLeaseGrant: (attemptId) => {
      assert.equal(attemptId, controlAttemptId);
      return hostLease;
    },
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
    target: (_sessionId, _generation, kind) =>
      kind === "cpg"
        ? { host: "127.0.0.1", port: 15000 }
        : { host: "127.0.0.1", port: 16080 },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const path =
      `/sessions/${SESSION_ID}/generations/7/slots/1/ensure` +
      `?controlAttemptId=${controlAttemptId}`;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        nonce: "2".repeat(32),
        path,
        timestampSeconds: 1_784_200_000,
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(receivedLease, hostLease);
    assert.deepEqual(await response.json(), {
      action: "ensure",
      controlAttemptId,
      sessionId: SESSION_ID,
      generation: 7,
      slotNumber: 1,
      capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      lease: {
        version: hostLease.version,
        bootId: hostLease.bootId,
        grantNotAfterNs: hostLease.grantNotAfterNs,
      },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("rejects malformed encoded session paths without stopping the host", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 30).toString("base64url"),
  )!;
  const server = createSessionHostServer({
    controlIdentity: {
      hostId: "30303030-3030-4030-8030-303030303030",
      key,
    },
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 0 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const malformed = await fetch(
      `http://127.0.0.1:${port}/sessions/%/ensure`,
      { method: "POST" },
    );
    assert.equal(malformed.status, 404);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("rejects malformed signed control-attempt queries before side effects", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 11).toString("base64url"),
  )!;
  const hostId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let ensures = 0;
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      nowSeconds: () => 1_784_200_000,
    },
    ensureSession: async () => {
      ensures += 1;
      return { name: "pyrus-ibkr-slot-1", status: "ready" };
    },
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 0 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const routePath = `/sessions/${SESSION_ID}/generations/7/slots/1/ensure`;
    const attempts = [
      "",
      "?controlAttemptId=not-a-uuid",
      "?controlAttemptId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaA",
      "?control%41ttemptId=33333333-3333-4333-8333-333333333333",
      "?controlAttemptId=33333333-3333-4333-8333-333333333333&extra=1",
      "?controlAttemptId=33333333-3333-4333-8333-333333333333&controlAttemptId=44444444-4444-4444-8444-444444444444",
    ];
    for (const [index, search] of attempts.entries()) {
      const path = `${routePath}${search}`;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: signIbkrHostControlRequest({
          hostId,
          key,
          method: "POST",
          nonce: String(index + 1).repeat(32),
          path,
          timestampSeconds: 1_784_200_000,
        }),
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("x-pyrus-control-receipt"), null);
      assert.deepEqual(await response.json(), {
        error: {
          code: "control_attempt_invalid",
          message: "IBKR session control failed.",
        },
      });
    }
    assert.equal(ensures, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("accepts only an exact signed keepalive grant before acknowledging it", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 16).toString("base64url"),
  )!;
  const hostId = "abababab-abab-4bab-8bab-abababababab";
  const controlAttemptId = "88888888-8888-4888-8888-888888888888";
  const path =
    `/sessions/${SESSION_ID}/generations/7/slots/2/keepalive` +
    `?controlAttemptId=${controlAttemptId}`;
  const lease = leaseRequest(controlAttemptId);
  let received: unknown;
  let markStarted!: () => void;
  let completeKeepalive!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const keepalive = new Promise<void>((resolve) => {
    completeKeepalive = resolve;
  });
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      nowSeconds: () => 1_784_200_000,
    },
    keepaliveSession: async (_sessionId, _generation, _slotNumber, input) => {
      received = input;
      markStarted();
      await keepalive;
    },
    issueLeaseGrant: () => lease,
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 2, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    let settled = false;
    const pending = fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        nonce: "8".repeat(32),
        path,
        timestampSeconds: 1_784_200_000,
      }),
    }).then((response) => {
      settled = true;
      return response;
    });
    await started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    completeKeepalive();
    const response = await pending;
    const responseBody = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(received, lease);
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "keepalive",
        body: responseBody,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(response.headers.entries()),
        key,
        status: response.status,
      }),
      true,
    );
    assert.deepEqual(JSON.parse(responseBody), {
      action: "keepalive",
      controlAttemptId,
      sessionId: SESSION_ID,
      generation: 7,
      slotNumber: 2,
      keptAlive: true,
      lease: {
        version: lease.version,
        bootId: lease.bootId,
        grantNotAfterNs: lease.grantNotAfterNs,
      },
    });
  } finally {
    completeKeepalive();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("rejects invalid keepalive grants before side effects", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 17).toString("base64url"),
  )!;
  const hostId = "acacacac-acac-4cac-8cac-acacacacacac";
  const controlAttemptId = "99999999-9999-4999-8999-999999999999";
  const routePath = `/sessions/${SESSION_ID}/generations/7/slots/1/keepalive`;
  const path = `${routePath}?controlAttemptId=${controlAttemptId}`;
  const validBody = JSON.stringify(leaseRequest(controlAttemptId));
  let keepalives = 0;
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      nowSeconds: () => 1_784_200_000,
    },
    keepaliveSession: async () => {
      keepalives += 1;
    },
    issueLeaseGrant: leaseRequest,
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const tampered = await fetch(`http://127.0.0.1:${port}${path}`, {
      body: `${validBody} `,
      method: "POST",
      headers: signIbkrHostControlRequest({
        body: validBody,
        hostId,
        key,
        method: "POST",
        nonce: "9".repeat(32),
        path,
        timestampSeconds: 1_784_200_000,
      }),
    });
    assert.equal(tampered.status, 401);
    assert.equal(tampered.headers.get("x-pyrus-control-receipt"), null);

    const oversizedBody = "x".repeat(513);
    const oversized = await fetch(`http://127.0.0.1:${port}${path}`, {
      body: oversizedBody,
      method: "POST",
      headers: signIbkrHostControlRequest({
        body: oversizedBody,
        hostId,
        key,
        method: "POST",
        nonce: "a".repeat(32),
        path,
        timestampSeconds: 1_784_200_000,
      }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get("x-pyrus-control-receipt"), null);

    const invalidBodies = [
      "{",
      JSON.stringify({ ...leaseRequest(controlAttemptId), extra: true }),
      JSON.stringify(leaseRequest("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
    ];
    for (const [index, body] of invalidBodies.entries()) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        body,
        method: "POST",
        headers: signIbkrHostControlRequest({
          body,
          hostId,
          key,
          method: "POST",
          nonce: String(index + 1).repeat(32),
          path,
          timestampSeconds: 1_784_200_000,
        }),
      });
      const responseBody = await response.text();
      assert.equal(response.status, 400);
      assert.equal(
        verifyIbkrHostControlReceipt({
          action: "keepalive",
          body: responseBody,
          controlAttemptId,
          expectedHostId: hostId,
          headers: Object.fromEntries(response.headers.entries()),
          key,
          status: response.status,
        }),
        true,
      );
      assert.deepEqual(JSON.parse(responseBody), {
        action: "keepalive",
        controlAttemptId,
        error: {
          code: "control_body_invalid",
          message: "IBKR session control failed.",
        },
      });
    }

    const legacy = await fetch(`http://127.0.0.1:${port}${routePath}`, {
      body: validBody,
      method: "POST",
      headers: signIbkrHostControlRequest({
        body: validBody,
        hostId,
        key,
        method: "POST",
        nonce: "e".repeat(32),
        path: routePath,
        timestampSeconds: 1_784_200_000,
      }),
    });
    assert.equal(legacy.status, 400);
    assert.equal(legacy.headers.get("x-pyrus-control-receipt"), null);
    assert.equal(keepalives, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("does not acknowledge a failed keepalive as successful", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 18).toString("base64url"),
  )!;
  const hostId = "adadadad-adad-4dad-8dad-adadadadadad";
  const controlAttemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const path =
    `/sessions/${SESSION_ID}/generations/7/slots/1/keepalive` +
    `?controlAttemptId=${controlAttemptId}`;
  const server = createSessionHostServer({
    controlIdentity: { hostId, key },
    issueLeaseGrant: leaseRequest,
    keepaliveSession: async () => {
      throw new Error("sensitive failure");
    },
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        path,
      }),
    });
    const responseBody = await response.text();

    assert.equal(response.status, 503);
    assert.equal(responseBody.includes("keptAlive"), false);
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "keepalive",
        body: responseBody,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(response.headers.entries()),
        key,
        status: response.status,
      }),
      true,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("signs an exact receipt for a missing fenced session", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 12).toString("base64url"),
  )!;
  const hostId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const controlAttemptId = "55555555-5555-4555-8555-555555555555";
  const path =
    `/sessions/${SESSION_ID}/generations/8/slots/2/status` +
    `?controlAttemptId=${controlAttemptId}`;
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      nowSeconds: () => 1_784_200_000,
    },
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 0 },
    }),
    statusSession: async () => null,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "GET",
        nonce: "f".repeat(32),
        path,
        timestampSeconds: 1_784_200_000,
      }),
    });
    const responseBody = await response.text();
    assert.equal(response.status, 404);
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "status",
        body: responseBody,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(response.headers.entries()),
        key,
        status: response.status,
      }),
      true,
    );
    assert.deepEqual(JSON.parse(responseBody), {
      action: "status",
      controlAttemptId,
      sessionId: SESSION_ID,
      generation: 8,
      slotNumber: 2,
      capsule: null,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("emits a release receipt only after cleanup completes", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 14).toString("base64url"),
  )!;
  const hostId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const controlAttemptId = "66666666-6666-4666-8666-666666666666";
  const path =
    `/sessions/${SESSION_ID}/generations/9/slots/1/release` +
    `?controlAttemptId=${controlAttemptId}`;
  let markStarted!: () => void;
  let completeCleanup!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const cleanup = new Promise<void>((resolve) => {
    completeCleanup = resolve;
  });
  const server = createSessionHostServer({
    controlIdentity: {
      hostId,
      key,
      nowSeconds: () => 1_784_200_000,
    },
    readiness: () => ({ ready: true }),
    releaseSession: async () => {
      markStarted();
      await cleanup;
    },
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    let settled = false;
    const pending = fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        nonce: "a".repeat(32),
        path,
        timestampSeconds: 1_784_200_000,
      }),
    }).then((response) => {
      settled = true;
      return response;
    });
    await started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    completeCleanup();
    const response = await pending;
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "release",
        body,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(response.headers.entries()),
        key,
        status: response.status,
      }),
      true,
    );
    assert.deepEqual(JSON.parse(body), {
      action: "release",
      controlAttemptId,
      sessionId: SESSION_ID,
      generation: 9,
      slotNumber: 1,
      released: true,
    });
  } finally {
    completeCleanup();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("proxies a signed generation-fenced CPG data request", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 13).toString("base64url"),
  )!;
  const hostId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const upstream = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          authorization: request.headers.authorization ?? null,
          body: Buffer.concat(chunks).toString("utf8"),
          controlHost: request.headers["x-pyrus-control-host"] ?? null,
          url: request.url,
        }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const resolutions: Array<[string, number, number, string]> = [];
  const server = createSessionHostServer({
    controlIdentity: { hostId, key },
    readiness: () => ({ ready: true }),
    resolveTarget: async (sessionId, generation, slotNumber, kind) => {
      resolutions.push([sessionId, generation, slotNumber, kind]);
      return { host: "127.0.0.1", port: upstreamPort };
    },
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const path =
      `/sessions/${SESSION_ID}/generations/7/slots/1/data/cpg` +
      "/v1/api/tickle?probe=1";
    const body = JSON.stringify({ tickle: true });
    const headers = signIbkrHostControlRequest({
      body,
      hostId,
      key,
      method: "POST",
      path,
    });
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      body,
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      authorization: null,
      body,
      controlHost: null,
      url: "/v1/api/tickle?probe=1",
    });
    assert.deepEqual(resolutions, [[SESSION_ID, 7, 1, "cpg"]]);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      ),
    ]);
  }
});

test("proxies a signed generation-fenced console WebSocket", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 15).toString("base64url"),
  )!;
  const hostId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let upstreamUrl = "";
  let upstreamAuthorization: string | undefined;
  const upgradedSockets: Duplex[] = [];
  const upstream = createHttpServer();
  upstream.on("upgrade", (request, socket) => {
    upgradedSockets.push(socket);
    upstreamUrl = request.url ?? "";
    upstreamAuthorization = request.headers.authorization;
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    socket.on("data", (chunk) => socket.write(chunk));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const server = createSessionHostServer({
    controlIdentity: { hostId, key },
    readiness: () => ({ ready: true }),
    resolveTarget: async () => ({ host: "127.0.0.1", port: upstreamPort }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const path =
      `/sessions/${SESSION_ID}/generations/9/slots/1/data/console` +
      "/websockify?probe=1";
    const headers = signIbkrHostControlRequest({
      hostId,
      key,
      method: "GET",
      path,
    });
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest({
        headers: {
          ...headers,
          connection: "Upgrade",
          upgrade: "websocket",
        },
        host: "127.0.0.1",
        method: "GET",
        path,
        port,
      });
      request.once("upgrade", (_response, socket) => {
        socket.once("data", (chunk) => {
          try {
            assert.equal(chunk.toString(), "synthetic-frame");
            socket.destroy();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        socket.write("synthetic-frame");
      });
      request.once("response", (response) => {
        response.resume();
        reject(new Error(`unexpected response ${response.statusCode}`));
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(upstreamUrl, "/websockify?probe=1");
    assert.equal(upstreamAuthorization, undefined);
  } finally {
    for (const socket of upgradedSockets) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});

test("serves authenticated ensure/status/release responses without secrets", async () => {
  await withServer(
    true,
    async (baseUrl) => {
      const headers = { authorization: "Bearer test-control-token" };
      const ensured = await fetch(`${baseUrl}/sessions/${SESSION_ID}/ensure`, {
        method: "POST",
        headers,
      });
      const ensureBody = await ensured.json();
      assert.equal(ensured.status, 200);
      assert.deepEqual(ensureBody, {
        sessionId: SESSION_ID,
        capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      });
      for (const forbidden of ["sha256", "stderr", "/home/"]) {
        assert(!JSON.stringify(ensureBody).includes(forbidden));
      }

      const status = await fetch(`${baseUrl}/sessions/${SESSION_ID}/status`, {
        headers,
      });
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), {
        sessionId: SESSION_ID,
        capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      });

      const released = await fetch(
        `${baseUrl}/sessions/${SESSION_ID}/release`,
        {
          method: "POST",
          headers,
        },
      );
      assert.equal(released.status, 200);
      assert.deepEqual(await released.json(), {
        sessionId: SESSION_ID,
        released: true,
      });
    },
    "test-control-token",
  );
});

test("rejects bearer-only control of an explicit generation fence", async () => {
  const calls: Array<[string, string, number, number]> = [];
  const server = createSessionHostServer({
    controlToken: "test-control-token",
    ensureSession: async (sessionId, generation, slotNumber) => {
      calls.push(["ensure", sessionId, generation, slotNumber]);
      return { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" };
    },
    releaseSession: async (sessionId, generation, slotNumber) => {
      calls.push(["release", sessionId, generation, slotNumber]);
    },
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 2, active: 1 },
    }),
    statusSession: async (sessionId, generation, slotNumber) => {
      calls.push(["status", sessionId, generation, slotNumber]);
      return { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" };
    },
    target: (_sessionId, _generation, kind, slotNumber) => ({
      host: "127.0.0.1",
      port: kind === "cpg" ? 15000 + slotNumber - 1 : 16080 + slotNumber - 1,
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/sessions/${SESSION_ID}/generations/7/slots/2`;
    const headers = { authorization: "Bearer test-control-token" };
    const ensured = await fetch(`${base}/ensure`, { method: "POST", headers });
    assert.deepEqual(await ensured.json(), {
      error: {
        code: "control_attempt_invalid",
        message: "IBKR session control failed.",
      },
    });
    assert.equal(ensured.status, 400);
    assert.equal((await fetch(`${base}/status`, { headers })).status, 400);
    assert.equal(
      (await fetch(`${base}/release`, { method: "POST", headers })).status,
      400,
    );
    assert.deepEqual(calls, []);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("signs a redacted conflict for a stale generation", async () => {
  const key = decodeIbkrHostControlKey(
    Buffer.alloc(32, 15).toString("base64url"),
  )!;
  const hostId = "ffffffff-ffff-4fff-bfff-ffffffffffff";
  const controlAttemptId = "77777777-7777-4777-8777-777777777777";
  const path =
    `/sessions/${SESSION_ID}/generations/7/slots/1/ensure` +
    `?controlAttemptId=${controlAttemptId}`;
  const server = createSessionHostServer({
    controlIdentity: { hostId, key },
    ensureSession: async () => {
      throw new CapsuleError("stale_generation", "sensitive detail");
    },
    issueLeaseGrant: leaseRequest,
    readiness: () => ({ ready: true }),
    snapshot: () => ({
      mode: "paper",
      capacity: { max: 1, active: 1 },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: signIbkrHostControlRequest({
        hostId,
        key,
        method: "POST",
        path,
      }),
    });
    const responseBody = await response.text();
    assert.equal(response.status, 409);
    assert.equal(
      verifyIbkrHostControlReceipt({
        action: "ensure",
        body: responseBody,
        controlAttemptId,
        expectedHostId: hostId,
        headers: Object.fromEntries(response.headers.entries()),
        key,
        status: response.status,
      }),
      true,
    );
    assert.deepEqual(JSON.parse(responseBody), {
      action: "ensure",
      controlAttemptId,
      error: {
        code: "stale_generation",
        message: "IBKR session control failed.",
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("reports missing session status as a redacted 404", async () => {
  await withServer(
    true,
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/sessions/22222222-2222-4222-8222-222222222222/status`,
        { headers: { authorization: "Bearer test-control-token" } },
      );
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        sessionId: "22222222-2222-4222-8222-222222222222",
        capsule: null,
      });
    },
    "test-control-token",
  );
});

test("keeps unrelated routes unavailable", async () => {
  await withServer(true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/capsules`, { method: "POST" });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "not_found", message: "Not found." },
    });
  });
});
