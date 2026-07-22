import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import healthRouter, { HEALTH_INSTANCE_HEADER } from "./health";

test("health responses expose one process-lifetime opaque instance token", async () => {
  const app = express();
  app.use(healthRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const first = await fetch(`http://127.0.0.1:${port}/healthz`);
    const second = await fetch(`http://127.0.0.1:${port}/healthz`);
    const firstToken = first.headers.get(HEALTH_INSTANCE_HEADER);

    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: "ok" });
    assert.match(firstToken ?? "", /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
    assert.equal(second.headers.get(HEALTH_INSTANCE_HEADER), firstToken);
  } finally {
    server.close();
    await once(server, "close");
  }
});
