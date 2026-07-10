import assert from "node:assert/strict";
import test from "node:test";

import { ensureGateway, getGateway } from "./ibkr-portal-gateway-manager";
import {
  connectPortal,
  disconnectPortal,
  readPortalReadiness,
} from "./ibkr-portal-session";

test("hosted portal connects any authenticated account (not paper-only)", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const liveUserId = "33333333-3333-4333-8333-333333333333";
  const paperUserId = "44444444-4444-4444-8444-444444444444";
  const needsLoginUserId = "55555555-5555-4555-8555-555555555555";
  const delayedLiveUserId = "66666666-6666-4666-8666-666666666666";
  const released = new Set<string>();
  let accountId = "U1234567";
  let authenticated = true;
  let authStatusCalls = 0;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.port === "18748") {
      const sessionId = url.pathname.split("/")[2] ?? "";
      if (url.pathname.endsWith("/release")) {
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
      authStatusCalls += 1;
      return Response.json({
        authenticated,
        connected: authenticated,
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
    // A live (non-DU) account is a first-class Client Portal connection.
    await ensureGateway(liveUserId);
    const liveReadiness = await readPortalReadiness(liveUserId);
    assert.equal(liveReadiness.status, "connected");
    assert.equal(liveReadiness.selectedAccountId, "U1234567");
    assert.equal(getGateway(liveUserId)?.paperAccountVerified, true);
    assert(!released.has(liveUserId));

    accountId = "DU1234567";
    await ensureGateway(paperUserId);
    const paperReadiness = await readPortalReadiness(paperUserId);
    assert.equal(paperReadiness.status, "connected");
    assert.equal(paperReadiness.selectedAccountId, "DU1234567");
    assert.equal(getGateway(paperUserId)?.paperAccountVerified, true);

    authenticated = false;
    await ensureGateway(needsLoginUserId);
    const needsLoginReadiness = await readPortalReadiness(needsLoginUserId);
    assert.equal(needsLoginReadiness.status, "needs_login");
    assert.equal(needsLoginReadiness.loginPath, null);

    const callsBeforeConnect = authStatusCalls;
    const delayedLiveStart = await connectPortal(delayedLiveUserId);
    assert.equal(delayedLiveStart.status, "needs_login");
    assert.equal(
      authStatusCalls,
      callsBeforeConnect,
      "connect must return the login surface without blocking on auth status",
    );
    authenticated = true;
    accountId = "U2468101";
    const delayedReadiness = await readPortalReadiness(delayedLiveUserId);
    assert.equal(delayedReadiness.status, "connected");
    assert.equal(delayedReadiness.selectedAccountId, "U2468101");
    assert.ok(getGateway(delayedLiveUserId), "live login keeps its gateway");
    assert(!released.has(delayedLiveUserId));
  } finally {
    await disconnectPortal(liveUserId).catch(() => undefined);
    await disconnectPortal(paperUserId).catch(() => undefined);
    await disconnectPortal(needsLoginUserId).catch(() => undefined);
    await disconnectPortal(delayedLiveUserId).catch(() => undefined);
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
