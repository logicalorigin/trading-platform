import assert from "node:assert/strict";
import test from "node:test";

import type { IbkrRuntimeConfig } from "../../lib/runtime";
import { IbkrClient } from "./client";

function config(): IbkrRuntimeConfig {
  return {
    baseUrl: "http://127.0.0.1:15000/v1/api",
    bearerToken: null,
    cookie: null,
    defaultAccountId: null,
    extOperator: null,
    extraHeaders: {},
    username: null,
    password: null,
    allowInsecureTls: true,
    paperAccountOnly: true,
  };
}

test("paper-only IBKR client rejects an authenticated live account", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/auth/status")) {
      return Response.json({ authenticated: true, connected: true });
    }
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => new IbkrClient(config()).ensureBrokerageSession(),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_paper_account_required",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("paper-only IBKR client accepts an authenticated paper account", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/auth/status")) {
      return Response.json({ authenticated: true, connected: true });
    }
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["DU1234567"] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const status = await new IbkrClient(config()).ensureBrokerageSession();
    assert.equal(status.selectedAccountId, "DU1234567");
    assert.deepEqual(status.accounts, ["DU1234567"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("paper-only IBKR client rejects live account references inside raw orders", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["DU1234567"] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        new IbkrClient(config()).submitRawOrders({
          accountId: "DU1234567",
          orders: [{ acctId: "U7654321", orderType: "MKT" }],
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_paper_account_required",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
