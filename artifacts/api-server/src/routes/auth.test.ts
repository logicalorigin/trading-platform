import assert from "node:assert/strict";
import { once } from "node:events";
import test, { beforeEach } from "node:test";
import type { AddressInfo } from "node:net";

import { withTestDb } from "@workspace/db/testing";
import app from "../app";
import { __resetAuthRateLimitsForTests } from "./auth";

beforeEach(() => {
  __resetAuthRateLimitsForTests();
});

type AuthRouteBody = {
  user: {
    email: string;
    role?: string;
  };
  csrfToken: string;
};

const withBootstrapToken = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
  process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = "setup-token";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
    } else {
      process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = previous;
    }
  }
};

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
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

test("auth routes bootstrap, read session, and require CSRF for logout", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "owner@example.com",
            password: "correct horse battery staple",
            bootstrapToken: "setup-token",
          }),
        });
        assert.equal(bootstrapResponse.status, 200);
        const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
        assert.match(cookie, /pyrus_session=/);
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
        assert.doesNotMatch(cookie, /correct horse battery staple/);

        const bootstrapBody =
          (await bootstrapResponse.json()) as AuthRouteBody;
        assert.equal(bootstrapBody.user.email, "owner@example.com");
        assert.equal(typeof bootstrapBody.csrfToken, "string");

        const sessionResponse = await fetch(`${baseUrl}/auth/session`, {
          headers: { cookie },
        });
        assert.equal(sessionResponse.status, 200);
        const sessionBody = (await sessionResponse.json()) as AuthRouteBody;
        assert.equal(sessionBody.user.email, "owner@example.com");
        assert.equal(typeof sessionBody.csrfToken, "string");

        const blockedLogout = await fetch(`${baseUrl}/auth/logout`, {
          method: "POST",
          headers: { cookie },
        });
        assert.equal(blockedLogout.status, 403);

        const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
          method: "POST",
          headers: {
            cookie,
            "x-csrf-token": sessionBody.csrfToken,
          },
        });
        assert.equal(logoutResponse.status, 200);
        assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
      }),
    ),
  );
});

test("first bootstrapped user is admin and bootstrap is single-use", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const first = await fetch(`${baseUrl}/auth/bootstrap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "owner@example.com",
            password: "correct horse battery staple",
            bootstrapToken: "setup-token",
          }),
        });
        assert.equal(first.status, 200);
        const firstBody = (await first.json()) as AuthRouteBody;
        assert.equal(firstBody.user.role, "admin");

        const second = await fetch(`${baseUrl}/auth/bootstrap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "second@example.com",
            password: "correct horse battery staple",
            bootstrapToken: "setup-token",
          }),
        });
        assert.equal(second.status, 409);
        const secondBody = (await second.json()) as { code?: string };
        assert.equal(secondBody.code, "bootstrap_already_complete");
      }),
    ),
  );
});

test("login is rate limited after repeated failed attempts", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      let sawRateLimit = false;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const response = await fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "nobody@example.com",
            password: "wrong-password-guess",
          }),
        });
        if (response.status === 429) {
          const body = (await response.json()) as { code?: string };
          assert.equal(body.code, "rate_limited");
          sawRateLimit = true;
          break;
        }
        await response.arrayBuffer();
      }
      assert.equal(sawRateLimit, true);
    }),
  );
});

test("password login rejects a cross-site form without replacing the session", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "owner@example.com",
            password: "correct horse battery staple",
            bootstrapToken: "setup-token",
          }),
        });
        assert.equal(bootstrapResponse.status, 200);

        const crossSiteLogin = await fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://attacker.example",
          },
          body: new URLSearchParams({
            email: "owner@example.com",
            password: "correct horse battery staple",
          }),
        });
        assert.equal(crossSiteLogin.status, 403);
        assert.equal(crossSiteLogin.headers.get("set-cookie"), null);
        const crossSiteBody = (await crossSiteLogin.json()) as {
          code?: string;
        };
        assert.equal(crossSiteBody.code, "invalid_login_origin");

        const crossSiteMetadataLogin = await fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "sec-fetch-site": "cross-site",
          },
          body: new URLSearchParams({
            email: "owner@example.com",
            password: "correct horse battery staple",
          }),
        });
        assert.equal(crossSiteMetadataLogin.status, 403);
        assert.equal(crossSiteMetadataLogin.headers.get("set-cookie"), null);

        const sameOriginLogin = await fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: new URL(baseUrl).origin,
            "sec-fetch-site": "same-origin",
          },
          body: new URLSearchParams({
            email: "owner@example.com",
            password: "correct horse battery staple",
          }),
        });
        assert.equal(sameOriginLogin.status, 200);
        assert.match(
          sameOriginLogin.headers.get("set-cookie") ?? "",
          /pyrus_session=/,
        );
      }),
    ),
  );
});

test("session cookies are Secure outside explicit HTTP development", async () => {
  const previousNodeEnv = process.env["NODE_ENV"];
  try {
    await withBootstrapToken(async () =>
      withTestDb(async () =>
        withServer(async (baseUrl) => {
          process.env["NODE_ENV"] = "development";
          const httpBootstrap = await fetch(`${baseUrl}/auth/bootstrap`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "owner@example.com",
              password: "correct horse battery staple",
              bootstrapToken: "setup-token",
            }),
          });
          assert.equal(httpBootstrap.status, 200);
          assert.doesNotMatch(
            httpBootstrap.headers.get("set-cookie") ?? "",
            /Secure/i,
          );

          __resetAuthRateLimitsForTests();
          const httpsLogin = await fetch(`${baseUrl}/auth/login`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-proto": "https",
            },
            body: JSON.stringify({
              email: "owner@example.com",
              password: "correct horse battery staple",
            }),
          });
          assert.equal(httpsLogin.status, 200);
          assert.match(httpsLogin.headers.get("set-cookie") ?? "", /Secure/i);

          process.env["NODE_ENV"] = "production";
          const productionLogin = await fetch(`${baseUrl}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "owner@example.com",
              password: "correct horse battery staple",
            }),
          });
          assert.equal(productionLogin.status, 200);
          assert.match(
            productionLogin.headers.get("set-cookie") ?? "",
            /Secure/i,
          );

          delete process.env["NODE_ENV"];
          const defaultLogin = await fetch(`${baseUrl}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "owner@example.com",
              password: "correct horse battery staple",
            }),
          });
          assert.equal(defaultLogin.status, 200);
          assert.match(
            defaultLogin.headers.get("set-cookie") ?? "",
            /Secure/i,
          );
        }),
      ),
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = previousNodeEnv;
    }
  }
});
