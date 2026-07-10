import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import app from "../app";
import { createAuthSession } from "../services/auth";

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

test("admin backend settings mutations reject missing CSRF", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const [admin] = await db
        .insert(usersTable)
        .values({
          email: "settings-admin@example.com",
          passwordHash: "unused-hash",
          role: "admin",
        })
        .returning();
      const session = await createAuthSession({ userId: admin!.id });
      const routes = [
        { path: "/settings/backend/apply", body: { changes: [] } },
        { path: "/settings/backend/actions/not-found", body: {} },
      ];

      const responses = await Promise.all(
        routes.map(async ({ path, body }) => {
          const response = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: {
              cookie: `pyrus_session=${session.sessionToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
          return { path, response, body: await response.json() };
        }),
      );

      for (const { path, response, body } of responses) {
        assert.equal(response.status, 403, path);
        assert.equal(
          (body as { code?: string }).code,
          "invalid_csrf_token",
          path,
        );
      }
    }),
  );
});
