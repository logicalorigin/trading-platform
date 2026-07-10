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

test("ensureBrokerageSession initializes the brokerage session after a web login", async () => {
  // A completed Client Portal web login (2FA done, "Client login succeeds")
  // leaves the gateway REST side unauthenticated until ssodh/init promotes it.
  const previousFetch = globalThis.fetch;
  const seen: string[] = [];
  let initialized = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    seen.push(path);
    if (path.endsWith("/iserver/auth/status")) {
      return Response.json({ authenticated: initialized, connected: true });
    }
    if (path.endsWith("/iserver/auth/ssodh/init")) {
      initialized = true;
      return Response.json({ authenticated: true });
    }
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["DU1234567"] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const status = await new IbkrClient(config()).ensureBrokerageSession();
    assert.equal(status.authenticated, true);
    assert.deepEqual(status.accounts, ["DU1234567"]);
    assert.ok(seen.some((path) => path.endsWith("/iserver/auth/ssodh/init")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ensureBrokerageSession recovers when auth/status throws 401 until init runs", async () => {
  // CPG rejects /iserver/auth/status outright with 401 (rather than returning
  // an unauthenticated body) until ssodh/init establishes the REST session.
  const previousFetch = globalThis.fetch;
  let initialized = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/auth/status")) {
      if (!initialized) return new Response("Unauthorized", { status: 401 });
      return Response.json({ authenticated: true, connected: true });
    }
    if (path.endsWith("/iserver/auth/ssodh/init")) {
      initialized = true;
      return Response.json({ authenticated: true });
    }
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["DU1234567"] });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const status = await new IbkrClient(config()).ensureBrokerageSession();
    assert.equal(status.authenticated, true);
    assert.deepEqual(status.accounts, ["DU1234567"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ensureBrokerageSession surfaces the status error when init cannot recover a 401", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/auth/status")) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (path.endsWith("/iserver/auth/ssodh/init")) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(() =>
      new IbkrClient(config()).ensureBrokerageSession(),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ensureBrokerageSession returns the logged-out status when init cannot recover", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/auth/status")) {
      return Response.json({ authenticated: false, connected: false });
    }
    if (path.endsWith("/iserver/auth/ssodh/init")) {
      return new Response("no session", { status: 401 });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const status = await new IbkrClient(config()).ensureBrokerageSession();
    assert.equal(status.authenticated, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("option position market-value fallback applies the contract multiplier", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/portfolio/DU1234567/positions/0")) {
      return Response.json([
        {
          conid: 12345,
          secType: "OPT",
          assetClass: "OPT",
          position: -2,
          ticker: "XYZ",
          expiry: "20260717",
          strike: 10,
          putOrCall: "C",
          multiplier: 100,
          avgPrice: 8,
          mktPrice: 12,
          unrealizedPnl: -800,
        },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const [position] = await new IbkrClient(config()).listPositions({
      accountId: "DU1234567",
      mode: "shadow",
    });
    assert.equal(position?.marketValue, -2_400);
    assert.equal(position?.unrealizedPnlPercent, -50);
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
