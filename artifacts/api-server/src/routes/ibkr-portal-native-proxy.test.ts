import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import app from "../app";
import { createAuthSession } from "../services/auth";
import {
  __resetIbkrPortalEmbedSessionsForTests,
  issueIbkrPortalEmbedGrant,
} from "../services/ibkr-portal-embed-session";
import {
  ensureGateway,
  stopGateway,
} from "../services/ibkr-portal-gateway-manager";
import { findRepoRoot } from "../services/runtime-flight-recorder";

const CLIENT_MOUNT = "/api/broker-execution/ibkr-portal/client";
const PROXY_TRAIL_PATH = `${findRepoRoot()}/.pyrus-runtime/ibkr-portal-proxy-trail.jsonl`;

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

test("native IBKR proxy uses the CPG target and keeps app credentials out of the login request", async () => {
  await withTestDb(async () => {
    const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
    const previousEmbedOrigin = process.env["IBKR_PORTAL_EMBED_ORIGIN"];
    const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
    const previousFetch = globalThis.fetch;
    const cpgServer = createServer();
    const consoleServer = createServer((_request, response) => {
      response.writeHead(500).end("wrong target");
    });
    const apiServer = createServer(app);
    let appUserId: string | null = null;
    let upstreamBody = "";
    let upstreamCookie = "";
    let upstreamAuthorization: string | undefined;
    let upstreamCsrf: string | undefined;
    let upstreamOrigin: string | undefined;
    let upstreamReferer: string | undefined;
    const upstreamRequests: string[] = [];

    try {
      const cpgPort = await listen(cpgServer);
      const consolePort = await listen(consoleServer);
      cpgServer.on("request", (request, response) => {
        upstreamRequests.push(`${request.method ?? "GET"} ${request.url ?? "/"}`);
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          upstreamBody = Buffer.concat(chunks).toString("utf8");
          upstreamCookie = request.headers.cookie ?? "";
          upstreamAuthorization = request.headers.authorization;
          upstreamCsrf = request.headers["x-csrf-token"] as string | undefined;
          upstreamOrigin = request.headers.origin;
          upstreamReferer = request.headers.referer;

          if (request.url === "/") {
            response
              .writeHead(302, {
                location: "/sso/Login",
                "set-cookie": "gateway_session=kept; Path=/; Secure; HttpOnly",
              })
              .end();
            return;
          }
          if (request.url === "/sso/Login") {
            response.writeHead(200, {
              "content-security-policy":
                "default-src 'self'; frame-ancestors 'none'",
              "content-type": "text/html; charset=utf-8",
              "set-cookie": "gateway_session=kept; Domain=.ibkr.com; Path=/sso; Secure; HttpOnly",
              "x-frame-options": "DENY",
            });
            response.end(
              '<!doctype html><html><head><script>if (window != top) { top.location.href = location.href; }</script></head><body><script src="/asset.js"></script></body></html>',
            );
            return;
          }
          if (request.url === "/sso/Dispatcher") {
            response.writeHead(200, {
              "content-type": "text/plain; charset=utf-8",
              location: "/restricted/",
            });
            response.end("Client login succeeds");
            return;
          }
          if (request.url === "/too-large") {
            response.writeHead(200, { "content-type": "application/octet-stream" });
            response.end(Buffer.alloc(5 * 1024 * 1024, 0x61));
            return;
          }
          if (request.url === "/broken") {
            response.writeHead(200, { "content-type": "text/plain" });
            response.write("partial");
            response.socket?.destroy();
            return;
          }
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("accepted");
        });
      });

      process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
      process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input));
        if (url.port !== "18748") return previousFetch(input, init);
        return Response.json(
          url.pathname.endsWith("/release")
            ? { released: true }
            : {
                capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
                targets: {
                  cpg: { host: "127.0.0.1", port: cpgPort },
                  console: { host: "127.0.0.1", port: consolePort },
                },
              },
        );
      }) as typeof fetch;

      const [admin] = await db
        .insert(usersTable)
        .values({
          email: "ibkr-native-proxy-admin@example.com",
          passwordHash: "unused",
          role: "admin",
        })
        .returning();
      assert.ok(admin);
      appUserId = admin.id;
      const session = await createAuthSession({ userId: admin.id });
      await ensureGateway(admin.id);

      const apiPort = await listen(apiServer);
      const origin = `http://127.0.0.1:${apiPort}`;
      const embedOrigin = `http://localhost:${apiPort}`;
      process.env["IBKR_PORTAL_EMBED_ORIGIN"] = embedOrigin;
      const appAuthHeaders = {
        cookie: `pyrus_session=${session.sessionToken}; gateway_session=kept`,
      };

      const denied = await previousFetch(`${origin}${CLIENT_MOUNT}/`, {
        redirect: "manual",
      });
      assert.equal(denied.status, 401);
      const sameOriginDenied = await previousFetch(
        `${origin}${CLIENT_MOUNT}/`,
        { headers: appAuthHeaders, redirect: "manual" },
      );
      assert.equal(sameOriginDenied.status, 401);

      const connected = await previousFetch(
        `${origin}/api/broker-execution/ibkr-portal/connect`,
        {
          method: "POST",
          headers: {
            ...appAuthHeaders,
            "content-type": "application/json",
            origin,
            "x-csrf-token": session.csrfToken,
          },
          body: "{}",
        },
      );
      assert.equal(connected.status, 200);
      const connectBody = (await connected.json()) as { loginPath: string };
      assert.equal(
        connectBody.loginPath,
        "/api/broker-execution/ibkr-portal/gateway/vnc.html" +
          "?autoconnect=1&resize=scale" +
          "&path=api%2Fbroker-execution%2Fibkr-portal%2Fgateway%2Fwebsockify",
      );

      const embedGrant = issueIbkrPortalEmbedGrant({
        appUserId: admin.id,
        parentOrigin: origin,
        embedOrigin,
      });
      const authorizeUrl =
        `${embedOrigin}${CLIENT_MOUNT}/authorize?code=` + embedGrant.code;

      const wrongOriginAuthorizeUrl = authorizeUrl.replace(
        "http://localhost:",
        "http://127.0.0.1:",
      );
      const wrongOrigin = await previousFetch(wrongOriginAuthorizeUrl, {
        redirect: "manual",
      });
      assert.equal(wrongOrigin.status, 401);

      const authorized = await previousFetch(authorizeUrl, {
        redirect: "manual",
      });
      assert.equal(authorized.status, 303);
      assert.equal(authorized.headers.get("location"), `${CLIENT_MOUNT}/`);
      const embedCookie = authorized.headers.get("set-cookie") ?? "";
      assert.match(embedCookie, /pyrus_ibkr_embed=/);
      assert.match(embedCookie, /HttpOnly/i);
      assert.match(embedCookie, /SameSite=None/i);
      assert.match(embedCookie, /Secure/i);
      assert.match(embedCookie, new RegExp(`Path=${CLIENT_MOUNT}/`));
      assert.doesNotMatch(embedCookie, /Domain=/i);
      assert.doesNotMatch(embedCookie, /pyrus_session=/);
      assert.equal(authorized.headers.get("referrer-policy"), "no-referrer");

      const replayed = await previousFetch(authorizeUrl, {
        redirect: "manual",
      });
      assert.equal(replayed.status, 401);

      const embedAuthHeaders = {
        cookie:
          `${embedCookie.split(";", 1)[0]}; gateway_session=kept; ` +
          "XYZAB=srp-session; XYZAB_AM.LOGIN=service-session; " +
          "replit_session=platform-secret; theme=dark",
      };
      const root = await previousFetch(`${embedOrigin}${CLIENT_MOUNT}/`, {
        headers: embedAuthHeaders,
        redirect: "manual",
      });
      assert.equal(root.status, 302);
      assert.equal(root.headers.get("location"), `${CLIENT_MOUNT}/sso/Login`);

      const login = await previousFetch(
        `${embedOrigin}${CLIENT_MOUNT}/sso/Login`,
        { headers: embedAuthHeaders },
      );
      const html = await login.text();
      assert.equal(login.status, 200);
      assert.equal(login.headers.get("x-frame-options"), null);
      assert.match(
        login.headers.get("content-security-policy") ?? "",
        new RegExp(`frame-ancestors ${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
      assert.match(
        login.headers.get("content-security-policy") ?? "",
        /default-src 'self'/,
      );
      assert.doesNotMatch(
        login.headers.get("content-security-policy") ?? "",
        /frame-ancestors 'none'/,
      );
      assert.equal(
        login.headers.get("cross-origin-resource-policy"),
        "cross-origin",
      );
      assert.equal(login.headers.get("cache-control"), "no-store");
      // Not paper-only (user decision 2026-07-10): the login page must reach
      // the browser without any injected paper-lock script, while the
      // frame-bust stripping stays in place.
      assert.doesNotMatch(html, /data-pyrus-paper-only/);
      assert.doesNotMatch(html, /forcePaperMode/);
      assert.doesNotMatch(html, /top\.location\.href\s*=\s*location\.href/);
      assert.match(html, new RegExp(`src="${CLIENT_MOUNT}/asset\\.js"`));
      assert.doesNotMatch(login.headers.get("set-cookie") ?? "", /Domain=/i);
      assert.match(
        login.headers.get("set-cookie") ?? "",
        new RegExp(`Path=${CLIENT_MOUNT}/sso`),
      );

      const formBody = "username=paper-user&password=test-only";
      const submitted = await previousFetch(
        `${embedOrigin}/api/Authenticator`,
        {
          method: "POST",
          headers: {
            ...embedAuthHeaders,
            authorization: "Bearer pyrus-secret",
            "content-type": "application/x-www-form-urlencoded",
            origin: embedOrigin,
            referer: `${embedOrigin}${CLIENT_MOUNT}/sso/Login`,
            "x-csrf-token": "pyrus-csrf-secret",
          },
          body: formBody,
        },
      );
      assert.equal(submitted.status, 200);
      assert.equal(await submitted.text(), "accepted");
      assert.equal(upstreamBody, formBody);
      assert.equal(
        upstreamCookie,
        "gateway_session=kept; XYZAB=srp-session; " +
          "XYZAB_AM.LOGIN=service-session",
      );
      assert.equal(upstreamAuthorization, undefined);
      assert.equal(upstreamCsrf, undefined);
      assert.equal(upstreamOrigin, `http://127.0.0.1:${cpgPort}`);
      assert.equal(
        upstreamReferer,
        `http://127.0.0.1:${cpgPort}/sso/Login`,
      );

      const trailOffset = await stat(PROXY_TRAIL_PATH).then(
        ({ size }) => size,
        () => 0,
      );
      const dispatched = await previousFetch(
        `${embedOrigin}${CLIENT_MOUNT}/sso/Dispatcher`,
        {
          method: "POST",
          headers: {
            ...embedAuthHeaders,
            "content-type": "application/x-www-form-urlencoded",
            origin: embedOrigin,
            referer: `${embedOrigin}${CLIENT_MOUNT}/sso/Login`,
          },
          body: "loginType=2&forwardTo=22",
        },
      );
      assert.equal(dispatched.status, 200);

      let dispatcherTrace: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 20 && !dispatcherTrace; attempt += 1) {
        const appended = (await readFile(PROXY_TRAIL_PATH)).subarray(trailOffset);
        dispatcherTrace = appended
          .toString("utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((entry) => entry["path"] === "client:/sso/Dispatcher");
        if (!dispatcherTrace) await delay(10);
      }
      assert.deepEqual(dispatcherTrace?.["forwardedCookieNames"], [
        "XYZAB",
        "XYZAB_AM.LOGIN",
        "gateway_session",
      ]);
      assert.equal(dispatcherTrace?.["stage"], "dispatcher_succeeded");
      assert.equal(
        dispatcherTrace?.["location"],
        `${CLIENT_MOUNT}/restricted/`,
      );
      assert.doesNotMatch(JSON.stringify(dispatcherTrace), /srp-session|service-session|kept/);

      const requestsBeforeQuietStatus = upstreamRequests.length;
      const quietStatus = await previousFetch(
        `${origin}/api/broker-execution/ibkr-portal/status`,
        { headers: appAuthHeaders },
      );
      assert.equal(quietStatus.status, 200);
      assert.equal(
        ((await quietStatus.json()) as { status?: string }).status,
        "needs_login",
      );
      assert.equal(
        upstreamRequests.length,
        requestsBeforeQuietStatus,
        "exact Dispatcher success pauses every readiness probe",
      );

      const requestsBeforeHostilePost = upstreamRequests.length;
      const hostilePost = await previousFetch(
        `${embedOrigin}${CLIENT_MOUNT}/sso/Authenticator`,
        {
          method: "POST",
          headers: {
            ...embedAuthHeaders,
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://evil.example",
            referer: "https://evil.example/attack",
            "sec-fetch-site": "cross-site",
          },
          body: formBody,
        },
      );
      assert.equal(hostilePost.status, 403);
      assert.equal(upstreamRequests.length, requestsBeforeHostilePost);

      const requestsBeforeOrder = upstreamRequests.length;
      const rawOrder = await previousFetch(
        `${embedOrigin}${CLIENT_MOUNT}/v1/api/iserver/account/U1234567/orders`,
        {
          method: "POST",
          headers: {
            ...embedAuthHeaders,
            "content-type": "application/json",
            origin: embedOrigin,
            referer: `${embedOrigin}${CLIENT_MOUNT}/sso/Login`,
          },
          body: JSON.stringify({
            orders: [{ acctId: "U1234567", side: "BUY", quantity: 1 }],
          }),
        },
      );
      assert.equal(rawOrder.status, 403);
      assert.equal(upstreamRequests.length, requestsBeforeOrder);

      const oversized = await previousFetch(
        `${embedOrigin}${CLIENT_MOUNT}/too-large`,
        { headers: embedAuthHeaders },
      );
      assert.equal(oversized.status, 502);
      assert.deepEqual(await oversized.json(), {
        error: "ibkr_portal_gateway_proxy_error",
      });

      const broken = await previousFetch(
        `${embedOrigin}${CLIENT_MOUNT}/broken`,
        { headers: embedAuthHeaders },
      );
      assert.equal(broken.status, 502);
      assert.deepEqual(await broken.json(), {
        error: "ibkr_portal_gateway_proxy_error",
      });
    } finally {
      if (appUserId) await stopGateway(appUserId).catch(() => undefined);
      __resetIbkrPortalEmbedSessionsForTests();
      apiServer.close();
      cpgServer.close();
      consoleServer.close();
      await Promise.allSettled([
        once(apiServer, "close"),
        once(cpgServer, "close"),
        once(consoleServer, "close"),
      ]);
      globalThis.fetch = previousFetch;
      if (previousEnabled === undefined) {
        delete process.env["IBKR_SESSION_HOST_ENABLED"];
      } else {
        process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
      }
      if (previousEmbedOrigin === undefined) {
        delete process.env["IBKR_PORTAL_EMBED_ORIGIN"];
      } else {
        process.env["IBKR_PORTAL_EMBED_ORIGIN"] = previousEmbedOrigin;
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
