import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";

import app, { __httpBoundaryInternalsForTests } from "./app";

async function withAppServer(
  serverApp: Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = serverApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function withServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  return withAppServer(app, (baseUrl) => run(`${baseUrl}/api`));
}

async function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("CORS is default-deny and reflects only an exact configured origin", async () => {
  await withEnv(
    {
      PYRUS_CORS_ALLOWED_ORIGINS:
        "https://app.example,http://127.0.0.1:5173," +
        "http://insecure.example,https://bad.example/path,*",
    },
    () =>
      withServer(async (baseUrl) => {
        const sameOrigin = await fetch(`${baseUrl}/healthz`);
        assert.equal(sameOrigin.status, 200);
        assert.equal(sameOrigin.headers.get("access-control-allow-origin"), null);

        const attacker = await fetch(`${baseUrl}/healthz`, {
          headers: { origin: "https://attacker.example" },
        });
        assert.equal(attacker.status, 200);
        assert.equal(attacker.headers.get("access-control-allow-origin"), null);
        assert.equal(
          attacker.headers.get("access-control-allow-credentials"),
          null,
        );

        const allowed = await fetch(`${baseUrl}/healthz`, {
          method: "OPTIONS",
          headers: {
            origin: "https://app.example",
            "access-control-request-method": "GET",
            "access-control-request-headers": "X-CSRF-Token, Content-Type",
          },
        });
        assert.equal(allowed.status, 204);
        assert.equal(
          allowed.headers.get("access-control-allow-origin"),
          "https://app.example",
        );
        assert.equal(
          allowed.headers.get("access-control-allow-methods"),
          "GET,HEAD,POST,OPTIONS",
        );
        assert.equal(
          allowed.headers.get("access-control-allow-headers"),
          "Authorization,Content-Type,X-CSRF-Token",
        );
        assert.equal(allowed.headers.get("access-control-max-age"), "600");
        assert.equal(
          allowed.headers.get("access-control-allow-credentials"),
          null,
        );
        assert.notEqual(
          allowed.headers.get("access-control-allow-origin"),
          "*",
        );
      }),
  );
});

test("gzip appends Accept-Encoding without erasing CORS Vary", async () => {
  const gzipApp = express();
  gzipApp.use((_req, res, next) => {
    res.vary("Origin");
    next();
  });
  gzipApp.use(__httpBoundaryInternalsForTests.gzipJsonResponses);
  gzipApp.get("/large", (_req, res) => {
    res.json({ value: "x".repeat(2_048) });
  });

  await withAppServer(gzipApp, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/large`, {
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.deepEqual(
      new Set(
        (response.headers.get("vary") ?? "")
          .split(",")
          .map((value) => value.trim().toLowerCase()),
      ),
      new Set(["origin", "accept-encoding"]),
    );
    await response.arrayBuffer();
  });
});

test("API responses carry baseline security and no-store headers", async () => {
  await withEnv(
    { NODE_ENV: "development", PYRUS_SERVE_WEB: "0" },
    () =>
      withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/healthz`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("x-powered-by"), null);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
        assert.equal(response.headers.get("referrer-policy"), "same-origin");
        assert.equal(
          response.headers.get("permissions-policy"),
          "camera=(), microphone=(), geolocation=(), payment=()",
        );
        assert.equal(
          response.headers.get("x-permitted-cross-domain-policies"),
          "none",
        );
        assert.equal(
          response.headers.get("content-security-policy"),
          "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
        );
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("strict-transport-security"), null);
      }),
  );
});

test("HSTS is emitted only while serving the production web app", async () => {
  await withServer(async (baseUrl) => {
    await withEnv(
      { NODE_ENV: "production", PYRUS_SERVE_WEB: "0" },
      async () => {
        const apiOnly = await fetch(`${baseUrl}/healthz`);
        assert.equal(apiOnly.headers.get("strict-transport-security"), null);
      },
    );
    await withEnv(
      { NODE_ENV: "production", PYRUS_SERVE_WEB: "1" },
      async () => {
        const productionWeb = await fetch(`${baseUrl}/healthz`);
        assert.equal(
          productionWeb.headers.get("strict-transport-security"),
          "max-age=31536000",
        );
      },
    );
  });
});

test("the JSON parser rejects request bodies above its 100kb limit", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(101 * 1_024) }),
    });
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      type: "https://pyrus.local/problems/payload-too-large",
      title: "Payload too large",
      status: 413,
      detail: "The request body exceeds the allowed size.",
    });
  });
});
