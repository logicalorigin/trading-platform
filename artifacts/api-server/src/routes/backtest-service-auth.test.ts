import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import app from "../app";

const TOKEN = "backtest-worker-service-token-32-bytes";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}/api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function withServiceToken(
  token: string | undefined,
  run: () => Promise<void>,
): Promise<void> {
  const previous = process.env["PYRUS_BACKTEST_WORKER_TOKEN"];
  const previousNext = process.env["PYRUS_BACKTEST_WORKER_NEXT_TOKEN"];
  try {
    if (token === undefined) delete process.env["PYRUS_BACKTEST_WORKER_TOKEN"];
    else process.env["PYRUS_BACKTEST_WORKER_TOKEN"] = token;
    delete process.env["PYRUS_BACKTEST_WORKER_NEXT_TOKEN"];
    await run();
  } finally {
    if (previous === undefined) delete process.env["PYRUS_BACKTEST_WORKER_TOKEN"];
    else process.env["PYRUS_BACKTEST_WORKER_TOKEN"] = previous;
    if (previousNext === undefined) {
      delete process.env["PYRUS_BACKTEST_WORKER_NEXT_TOKEN"];
    } else {
      process.env["PYRUS_BACKTEST_WORKER_NEXT_TOKEN"] = previousNext;
    }
  }
}

test("internal backtest option resolution is hidden when service auth is disabled", async () => {
  await withServiceToken(undefined, () =>
    withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/backtests/internal/resolve-option-contract`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      assert.equal(response.status, 404);
    }),
  );
});

test("internal backtest option resolution requires the exact service bearer", async () => {
  await withServiceToken(TOKEN, () =>
    withServer(async (baseUrl) => {
      const path = `${baseUrl}/backtests/internal/resolve-option-contract`;
      for (const authorization of [undefined, "Bearer wrong-token-that-is-still-32-bytes"]) {
        const response = await fetch(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: "{}",
        });
        assert.equal(response.status, 401);
      }

      const admitted = await fetch(path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(admitted.status, 400);
    }),
  );
});

test("bars accepts the exact worker bearer while anonymous callers remain blocked", async () => {
  await withServiceToken(TOKEN, () =>
    withServer(async (baseUrl) => {
      const path = `${baseUrl}/bars`;
      for (const authorization of [
        undefined,
        "Bearer wrong-token-that-is-still-32-bytes",
      ]) {
        const response = await fetch(path, {
          headers: authorization ? { authorization } : {},
        });
        assert.equal(response.status, 401);
      }

      const admitted = await fetch(path, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(admitted.status, 400);
    }),
  );
});
