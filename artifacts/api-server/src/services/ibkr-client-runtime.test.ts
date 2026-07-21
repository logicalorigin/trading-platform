import assert from "node:assert/strict";
import test from "node:test";

import { runWithIbkrPortalUser } from "./ibkr-portal-context";
import {
  ensureGateway,
  markGatewayPaperAccountVerified,
  stopGateway,
} from "./ibkr-portal-gateway-manager";
import {
  assertIbkrClientPortalGatewaySnapshot,
  getIbkrClientPortalGatewaySnapshot,
  getIbkrClientPortalClient,
  isIbkrClientPortalConfigured,
} from "./ibkr-client-runtime";

test("the portal runtime stays owner-scoped and supports a verified real account", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousGlobalUrl = process.env["IBKR_CLIENT_PORTAL_BASE_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "66666666-6666-4666-8666-666666666666";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_CLIENT_PORTAL_BASE_URL"] = "http://127.0.0.1:5999/v1/api";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/release")) {
      return Response.json({ released: true });
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
    return Response.json({
      capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    assert.equal(isIbkrClientPortalConfigured(), true);
    assert.equal(
      runWithIbkrPortalUser(appUserId, isIbkrClientPortalConfigured),
      false,
    );
    assert.throws(
      () => runWithIbkrPortalUser(appUserId, getIbkrClientPortalClient),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_client_portal_not_configured",
    );

    await ensureGateway(appUserId);
    assert.equal(
      runWithIbkrPortalUser(appUserId, isIbkrClientPortalConfigured),
      false,
    );

    assert.equal(await markGatewayPaperAccountVerified(appUserId), true);
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
    const snapshot = runWithIbkrPortalUser(
      appUserId,
      getIbkrClientPortalGatewaySnapshot,
    );
    assert.ok(snapshot);
    assert.equal(snapshot.appUserId, appUserId);
    assert.equal(snapshot.baseUrl, "http://127.0.0.1:15000/v1/api");
    assert.equal(
      runWithIbkrPortalUser(appUserId, () =>
        assertIbkrClientPortalGatewaySnapshot(snapshot),
      ).startedAt,
      snapshot.startedAt,
    );
    assert.throws(
      () =>
        runWithIbkrPortalUser(appUserId, () =>
          assertIbkrClientPortalGatewaySnapshot({
            ...snapshot,
            startedAt: snapshot.startedAt - 1,
          }),
        ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_client_portal_gateway_changed",
    );
  } finally {
    await stopGateway(appUserId);
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
    if (previousGlobalUrl === undefined) {
      delete process.env["IBKR_CLIENT_PORTAL_BASE_URL"];
    } else {
      process.env["IBKR_CLIENT_PORTAL_BASE_URL"] = previousGlobalUrl;
    }
  }
});
