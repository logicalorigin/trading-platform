import assert from "node:assert/strict";
import test from "node:test";

import { runWithIbkrPortalUser } from "./ibkr-portal-context";
import {
  ensureGateway,
  markGatewayPaperAccountVerified,
  stopGateway,
} from "./ibkr-portal-gateway-manager";
import {
  getIbkrClientPortalClient,
  isIbkrClientPortalConfigured,
} from "./ibkr-client-runtime";

test("an unverified hosted gateway cannot fall back to the global IBKR runtime", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousGlobalUrl = process.env["IBKR_CLIENT_PORTAL_BASE_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "66666666-6666-4666-8666-666666666666";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_CLIENT_PORTAL_BASE_URL"] = "http://127.0.0.1:5999/v1/api";
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/release")) {
      return Response.json({ released: true });
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
    await ensureGateway(appUserId);
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

    assert.equal(markGatewayPaperAccountVerified(appUserId), true);
    assert.equal(
      runWithIbkrPortalUser(appUserId, isIbkrClientPortalConfigured),
      true,
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
