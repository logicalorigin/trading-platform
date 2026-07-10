import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import app from "../app";

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}/api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("execution and account stream routes reject unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/executions",
      "/streams/orders",
      "/streams/executions",
      "/streams/accounts",
      "/ExEcUtIoNs",
      "/StReAmS/OrDeRs",
      "/StReAmS/ExEcUtIoNs",
      "/StReAmS/AcCoUnTs",
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 401) {
        await response.body?.cancel();
      }
      assert.equal(response.status, 401, path);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "auth_required",
        path,
      );
    }
  });
});

test("flow scanner benchmark rejects unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/flow/scanner/benchmark",
      "/FlOw/ScAnNeR/BeNcHmArK",
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      assert.equal(response.status, 401, path);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "auth_required",
        path,
      );
    }
  });
});
