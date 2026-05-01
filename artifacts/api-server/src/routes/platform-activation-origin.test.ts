import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const { getIbkrBridgeRequestOrigin } = await import("./platform");

const ENV_NAMES = [
  "IBKR_BRIDGE_API_BASE_URL",
  "RAYALGO_PUBLIC_API_BASE_URL",
  "PUBLIC_API_BASE_URL",
  "REPLIT_DEV_DOMAIN",
  "REPLIT_DOMAINS",
];
const ORIGINAL_ENV = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

function makeRequest(input: {
  protocol?: string;
  headers?: Record<string, string | undefined>;
}): Pick<Request, "get" | "protocol"> {
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );

  return {
    protocol: input.protocol ?? "http",
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Pick<Request, "get" | "protocol">;
}

test.beforeEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

test.after(() => {
  for (const name of ENV_NAMES) {
    const value = ORIGINAL_ENV[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("IBKR bridge launcher origin prefers explicit public API base URL", () => {
  process.env["IBKR_BRIDGE_API_BASE_URL"] =
    "https://api.rayalgo.example.com/api/ignored?x=1";

  const origin = getIbkrBridgeRequestOrigin(
    makeRequest({
      headers: {
        host: "127.0.0.1:8080",
        origin: "http://localhost:5173",
      },
    }),
  );

  assert.equal(origin, "https://api.rayalgo.example.com");
});

test("IBKR bridge launcher origin uses forwarded public host from frontend proxy", () => {
  const origin = getIbkrBridgeRequestOrigin(
    makeRequest({
      protocol: "http",
      headers: {
        host: "127.0.0.1:8080",
        "x-forwarded-host": "rayalgo-public.example.com",
        "x-forwarded-proto": "http",
        origin: "http://localhost:5173",
      },
    }),
  );

  assert.equal(origin, "https://rayalgo-public.example.com");
});

test("IBKR bridge launcher origin does not emit loopback browser origins", () => {
  const origin = getIbkrBridgeRequestOrigin(
    makeRequest({
      headers: {
        host: "127.0.0.1:8080",
        origin: "http://localhost:5173",
      },
    }),
  );

  assert.equal(origin, "http://127.0.0.1:8080");
});

test("IBKR bridge launcher origin uses Replit dev domain when proxy headers are loopback", () => {
  process.env["REPLIT_DEV_DOMAIN"] =
    "abc-00-example.riker.replit.dev";

  const origin = getIbkrBridgeRequestOrigin(
    makeRequest({
      protocol: "http",
      headers: {
        host: "127.0.0.1:8080",
        "x-forwarded-host": "127.0.0.1:18747",
        "x-forwarded-proto": "http",
        origin: "http://127.0.0.1:18747",
      },
    }),
  );

  assert.equal(origin, "https://abc-00-example.riker.replit.dev");
});

test("IBKR bridge launcher origin can use a non-loopback browser origin", () => {
  const origin = getIbkrBridgeRequestOrigin(
    makeRequest({
      headers: {
        host: "127.0.0.1:8080",
        origin: "https://rayalgo-preview.example.com",
      },
    }),
  );

  assert.equal(origin, "https://rayalgo-preview.example.com");
});
