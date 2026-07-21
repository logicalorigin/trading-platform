import assert from "node:assert/strict";
import test from "node:test";

import { runWithIbkrPortalUser } from "./ibkr-portal-context";
import { ensureGateway } from "./ibkr-portal-gateway-manager";
import {
  getIbkrClientPortalClient,
  isIbkrClientPortalConfigured,
} from "./ibkr-client-runtime";
import { disconnectPortal, readPortalReadiness } from "./ibkr-portal-session";

test("an authenticated real account remains connected and owner-scoped", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "91919191-9191-4919-8919-919191919191";
  let released = false;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.port === "18748") {
      if (url.pathname.endsWith("/release")) {
        released = true;
        return Response.json({ released: true });
      }
      if (url.pathname.endsWith("/status")) {
        return Response.json({
          capsule: {
            name: "pyrus-ibkr-slot-1",
            status: "ready",
            loginCompletions: 0,
          },
        });
      }
      return Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: "ready",
          loginCompletions: 0,
        },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      });
    }
    if (url.pathname.endsWith("/iserver/auth/status")) {
      return Response.json({
        authenticated: true,
        connected: true,
        established: true,
        isPaper: false,
        selectedAccount: "U1234567",
      });
    }
    if (url.pathname.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        isPaper: false,
        selectedAccount: "U1234567",
      });
    }
    if (url.pathname.endsWith("/tickle")) {
      return Response.json({ session: "live-session" });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    await ensureGateway(appUserId);
    const readiness = await readPortalReadiness(appUserId);
    assert.equal(readiness.status, "connected");
    assert.equal(readiness.authenticated, true);
    assert.equal(readiness.established, true);
    assert.equal(readiness.isPaper, false);
    assert.equal(readiness.selectedAccountId, "U1234567");
    assert.equal(released, false, "a real account must retain its gateway");

    assert.equal(
      runWithIbkrPortalUser(appUserId, isIbkrClientPortalConfigured),
      true,
    );
    const session = await runWithIbkrPortalUser(appUserId, () =>
      getIbkrClientPortalClient().ensureBrokerageSession({
        initializeIfNeeded: false,
      }),
    );
    assert.equal(session.authenticated, true);
    assert.equal(session.isPaper, false);
    assert.equal(session.selectedAccountId, "U1234567");
  } finally {
    await disconnectPortal(appUserId).catch(() => undefined);
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
