import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createSessionHostServer } from "./server";

async function withServer(
  dockerReady: boolean,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createSessionHostServer({
    readiness: () =>
      dockerReady
        ? { ready: true }
        : { ready: false, code: "docker_unavailable" },
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

test("does not expose a control surface in the foundation slice", async () => {
  await withServer(true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/capsules`, { method: "POST" });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "not_found", message: "Not found." },
    });
  });
});
