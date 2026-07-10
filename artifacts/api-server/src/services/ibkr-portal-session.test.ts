import assert from "node:assert/strict";
import test from "node:test";

import { ensureGateway, getGateway } from "./ibkr-portal-gateway-manager";
import {
  disconnectPortal,
  IBKR_PORTAL_LOGIN_PATH,
  readPortalReadiness,
} from "./ibkr-portal-session";

test("hosted IBKR login opens noVNC with its socket path inside the authenticated mount", () => {
  assert.equal(
    IBKR_PORTAL_LOGIN_PATH,
    "/api/broker-execution/ibkr-portal/gateway/vnc.html" +
      "?autoconnect=1&resize=scale" +
      "&path=api%2Fbroker-execution%2Fibkr-portal%2Fgateway%2Fwebsockify",
  );
});

test("hosted portal verifies paper accounts and releases live accounts", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const liveUserId = "33333333-3333-4333-8333-333333333333";
  const paperUserId = "44444444-4444-4444-8444-444444444444";
  const failedReleaseUserId = "88888888-8888-4888-8888-888888888888";
  const released = new Set<string>();
  let accountId = "U1234567";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.port === "18748") {
      const sessionId = url.pathname.split("/")[2] ?? "";
      if (url.pathname.endsWith("/release")) {
        if (sessionId === failedReleaseUserId) {
          return Response.json(
            { error: { code: "docker_failure" } },
            { status: 503 },
          );
        }
        released.add(sessionId);
        return Response.json({ released: true });
      }
      if (url.pathname.endsWith("/status")) {
        return Response.json({
          capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
        });
      }
      return Response.json({
        capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
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
        selectedAccount: accountId,
      });
    }
    if (url.pathname.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: [accountId] });
    }
    if (url.pathname.endsWith("/tickle")) {
      return Response.json({ session: "paper-session" });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    await ensureGateway(liveUserId);
    const liveReadiness = await readPortalReadiness(liveUserId);
    assert.equal(liveReadiness.status, "disconnected");
    assert.match(liveReadiness.message, /Only verified IBKR Paper Trading/);
    assert.equal(getGateway(liveUserId), null);
    assert(released.has(liveUserId));

    accountId = "DU1234567";
    await ensureGateway(paperUserId);
    const paperReadiness = await readPortalReadiness(paperUserId);
    assert.equal(paperReadiness.status, "connected");
    assert.equal(paperReadiness.selectedAccountId, "DU1234567");
    assert.equal(getGateway(paperUserId)?.paperAccountVerified, true);

    accountId = "U7654321";
    await ensureGateway(failedReleaseUserId);
    const failedReleaseReadiness = await readPortalReadiness(
      failedReleaseUserId,
    );
    assert.equal(failedReleaseReadiness.status, "disconnected");
    assert.match(
      failedReleaseReadiness.message,
      /could not be confirmed stopped/,
    );
    assert.equal(getGateway(failedReleaseUserId), null);
  } finally {
    await disconnectPortal(liveUserId).catch(() => undefined);
    await disconnectPortal(paperUserId).catch(() => undefined);
    await disconnectPortal(failedReleaseUserId).catch(() => undefined);
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
