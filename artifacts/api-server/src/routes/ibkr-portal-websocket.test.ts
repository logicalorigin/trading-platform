import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import app from "../app";
import { createAuthSession } from "../services/auth";
import {
  ensureGateway,
  stopGateway,
} from "../services/ibkr-portal-gateway-manager";
import { attachIbkrPortalWebSocket } from "./ibkr-portal";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

function rejectedWebSocketStatus(
  url: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.on("error", () => undefined);
    socket.once("open", () => {
      socket.close();
      reject(new Error("WebSocket unexpectedly opened."));
    });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
  });
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}

test("IBKR noVNC WebSocket proxy authenticates and preserves the binary tunnel", async () => {
  await withTestDb(async () => {
    const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
    const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
    const previousFetch = globalThis.fetch;
    const upstreamServer = createServer();
    const upstreamWebSockets = new WebSocketServer({ server: upstreamServer });
    const apiServer = createServer(app);
    let appUserId: string | null = null;

    try {
      const upstreamPort = await listen(upstreamServer);
      let upstreamPath = "";
      let upstreamCookie = "";
      let upstreamAuthorization: string | undefined;
      upstreamWebSockets.on("connection", (socket, request) => {
        upstreamPath = request.url ?? "";
        upstreamCookie = request.headers.cookie ?? "";
        upstreamAuthorization = request.headers.authorization;
        socket.on("message", (data: RawData, isBinary: boolean) => {
          socket.send(data, { binary: isBinary });
        });
      });

      process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
      process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
      globalThis.fetch = (async (input) =>
        Response.json(
          String(input).endsWith("/release")
            ? { released: true }
            : {
                capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
                targets: {
                  cpg: { host: "127.0.0.1", port: upstreamPort },
                  console: { host: "127.0.0.1", port: upstreamPort },
                },
              },
        )) as typeof fetch;

      const [admin] = await db
        .insert(usersTable)
        .values({
          email: "ibkr-websocket-admin@example.com",
          passwordHash: "unused",
          role: "admin",
        })
        .returning();
      assert.ok(admin);
      appUserId = admin.id;
      const session = await createAuthSession({ userId: admin.id });
      await ensureGateway(admin.id);

      attachIbkrPortalWebSocket(apiServer);
      const apiPort = await listen(apiServer);
      const url =
        `ws://127.0.0.1:${apiPort}` +
        "/api/broker-execution/ibkr-portal/gateway/websockify?token=test";

      assert.equal(await rejectedWebSocketStatus(url), 401);
      assert.equal(
        await rejectedWebSocketStatus(url, {
          cookie: `pyrus_session=${session.sessionToken}`,
          origin: "https://attacker.invalid",
        }),
        403,
      );

      const client = new WebSocket(url, ["binary"], {
        headers: {
          authorization: "Bearer pyrus-secret",
          cookie:
            `pyrus_session=${session.sessionToken}; ` +
            "gateway_session=kept",
          origin: `http://127.0.0.1:${apiPort}`,
        },
      });
      await once(client, "open");
      assert.equal(client.protocol, "binary");

      const payload = Buffer.from([0, 255, 1, 128]);
      const echoed = once(client, "message");
      client.send(payload);
      const [data] = await echoed;

      assert.deepEqual(toBuffer(data as RawData), payload);
      assert.equal(upstreamPath, "/websockify?token=test");
      assert.equal(upstreamCookie, "gateway_session=kept");
      assert.equal(upstreamAuthorization, undefined);

      const closed = once(client, "close");
      client.close();
      await closed;
    } finally {
      if (appUserId) await stopGateway(appUserId);
      upstreamWebSockets.close();
      upstreamServer.close();
      apiServer.close();
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
});
