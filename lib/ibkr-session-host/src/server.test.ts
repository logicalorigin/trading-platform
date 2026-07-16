import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  decodeIbkrHostControlKey,
  signIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";

import { CapsuleError } from "./capsule";
import { createSessionHostServer } from "./server";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

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
  const hostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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
    const path = `/sessions/${SESSION_ID}/generations/7/slots/1/ensure`;
    const headers = signIbkrHostControlRequest({
      hostId,
      key,
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
    const replay = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
    });
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), {
      error: { code: "unauthorized", message: "Unauthorized." },
    });
    assert.equal(ensures, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
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

test("routes an explicit generation-fenced host-slot placement", async () => {
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
      sessionId: SESSION_ID,
      generation: 7,
      slotNumber: 2,
      capsule: { name: "pyrus-ibkr-slot-2", status: "ready" },
      targets: {
        cpg: { host: "127.0.0.1", port: 15001 },
        console: { host: "127.0.0.1", port: 16081 },
      },
    });
    assert.equal((await fetch(`${base}/status`, { headers })).status, 200);
    assert.equal(
      (await fetch(`${base}/release`, { method: "POST", headers })).status,
      200,
    );
    assert.deepEqual(calls, [
      ["ensure", SESSION_ID, 7, 2],
      ["status", SESSION_ID, 7, 2],
      ["release", SESSION_ID, 7, 2],
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("returns a redacted conflict for a stale generation", async () => {
  const server = createSessionHostServer({
    controlToken: "test-control-token",
    ensureSession: async () => {
      throw new CapsuleError("stale_generation", "sensitive detail");
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
    const response = await fetch(
      `http://127.0.0.1:${port}/sessions/${SESSION_ID}/generations/7/slots/1/ensure`,
      {
        method: "POST",
        headers: { authorization: "Bearer test-control-token" },
      },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
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
