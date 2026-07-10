import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

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
    target: (_sessionId, kind) =>
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
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'");
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

      const released = await fetch(`${baseUrl}/sessions/${SESSION_ID}/release`, {
        method: "POST",
        headers,
      });
      assert.equal(released.status, 200);
      assert.deepEqual(await released.json(), {
        sessionId: SESSION_ID,
        released: true,
      });
    },
    "test-control-token",
  );
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
