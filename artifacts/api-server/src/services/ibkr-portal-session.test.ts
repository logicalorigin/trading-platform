import assert from "node:assert/strict";
import test from "node:test";

import { ensureGateway, getGateway } from "./ibkr-portal-gateway-manager";
import {
  beginPortalReadinessQuietWindow,
  connectPortal,
  disconnectPortal,
  readPortalReadiness,
} from "./ibkr-portal-session";

test("hosted portal connects authenticated real and paper accounts", async (t) => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const liveUserId = "33333333-3333-4333-8333-333333333333";
  const paperUserId = "44444444-4444-4444-8444-444444444444";
  const needsLoginUserId = "55555555-5555-4555-8555-555555555555";
  const delayedLiveUserId = "66666666-6666-4666-8666-666666666666";
  const failedAfterLoginUserId = "67676767-6767-4767-8767-676767676767";
  const recoveredLoginUserId = "77777777-7777-4777-8777-777777777777";
  const recoveredStartingUserId = "88888888-8888-4888-8888-888888888888";
  const markerlessAuthenticatedUserId =
    "89898989-8989-4989-8989-898989898989";
  const monitorRaceUserId = "99999999-9999-4999-8999-999999999999";
  const released = new Set<string>();
  let accountIds: readonly string[] = ["U1234567"];
  let authenticated = true;
  let forceBrokerageUnauthorized = false;
  let authStatusCalls = 0;
  let reauthenticateCalls = 0;
  let ssodhInitCalls = 0;
  const loginCompletions = new Map<string, number>();
  const capsuleStatuses = new Map<string, "ready" | "occupied">();
  const hostStatusCalls = new Map<string, number>();
  let blockedStatusUserId: string | null = null;
  let blockedStatus: Promise<void> | null = null;

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.port === "18748") {
      const sessionId = url.pathname.split("/")[2] ?? "";
      const completionCount = loginCompletions.get(sessionId) ?? 0;
      if (url.pathname.endsWith("/release")) {
        released.add(sessionId);
        return Response.json({ released: true });
      }
      if (url.pathname.endsWith("/status")) {
        hostStatusCalls.set(
          sessionId,
          (hostStatusCalls.get(sessionId) ?? 0) + 1,
        );
        if (sessionId === blockedStatusUserId && blockedStatus) {
          await blockedStatus;
        }
        return Response.json({
          capsule: {
            name: "pyrus-ibkr-slot-1",
            status: capsuleStatuses.get(sessionId) ?? "ready",
            loginCompletions: completionCount,
          },
        });
      }
      return Response.json({
        capsule: {
          name: "pyrus-ibkr-slot-1",
          status: capsuleStatuses.get(sessionId) ?? "ready",
          loginCompletions: completionCount,
        },
        targets: {
          cpg: { host: "127.0.0.1", port: 15000 },
          console: { host: "127.0.0.1", port: 16080 },
        },
      });
    }
    if (url.pathname.endsWith("/iserver/auth/status")) {
      authStatusCalls += 1;
      if (forceBrokerageUnauthorized) {
        return new Response("Unauthorized", { status: 401 });
      }
      return Response.json({
        authenticated,
        connected: authenticated,
        selectedAccount: accountIds[0],
      });
    }
    if (url.pathname.endsWith("/iserver/auth/ssodh/init")) {
      ssodhInitCalls += 1;
      if (forceBrokerageUnauthorized) {
        return new Response("Unauthorized", { status: 401 });
      }
      return Response.json({ authenticated });
    }
    if (url.pathname.endsWith("/iserver/reauthenticate")) {
      reauthenticateCalls += 1;
      return Response.json({ message: "triggered" });
    }
    if (url.pathname.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: accountIds });
    }
    if (url.pathname.endsWith("/tickle")) {
      return Response.json({ session: "client-portal-session" });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    await ensureGateway(liveUserId);
    const liveReadiness = await readPortalReadiness(liveUserId);
    assert.equal(liveReadiness.status, "connected");
    assert.equal(liveReadiness.selectedAccountId, "U1234567");
    assert.equal(getGateway(liveUserId)?.paperAccountVerified, true);
    assert(!released.has(liveUserId));

    accountIds = ["DU1234567"];
    await ensureGateway(paperUserId);
    const paperReadiness = await readPortalReadiness(paperUserId);
    assert.equal(paperReadiness.status, "connected");
    assert.equal(paperReadiness.selectedAccountId, "DU1234567");
    assert.equal(getGateway(paperUserId)?.paperAccountVerified, true);

    authenticated = false;
    await ensureGateway(needsLoginUserId);
    const needsLoginReadiness = await readPortalReadiness(needsLoginUserId);
    assert.equal(needsLoginReadiness.status, "needs_login");
    assert.equal(needsLoginReadiness.browserLoginComplete, false);
    assert.equal(needsLoginReadiness.loginPath, null);
    assert.equal(
      ssodhInitCalls,
      0,
      "the hosted portal does not promote a brokerage session before browser login completes",
    );

    const callsBeforeQuietWindow = authStatusCalls;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      beginPortalReadinessQuietWindow(needsLoginUserId);
      const quietReadiness = await readPortalReadiness(needsLoginUserId);
      assert.equal(quietReadiness.status, "needs_login");
      assert.equal(
        authStatusCalls,
        callsBeforeQuietWindow,
        "post-login quiet window must not probe CPG readiness",
      );

      t.mock.timers.tick(19_999);
      beginPortalReadinessQuietWindow(needsLoginUserId);
      t.mock.timers.tick(1);
      await readPortalReadiness(needsLoginUserId);
      assert.equal(
        authStatusCalls,
        callsBeforeQuietWindow,
        "an old timer must not clear a replacement quiet window",
      );

      t.mock.timers.tick(19_999);
      await readPortalReadiness(needsLoginUserId);
      assert.equal(
        authStatusCalls,
        callsBeforeQuietWindow + 1,
        "readiness probing resumes when the replacement window expires",
      );

      beginPortalReadinessQuietWindow(needsLoginUserId);
      await connectPortal(needsLoginUserId);
      await readPortalReadiness(needsLoginUserId);
      assert.equal(
        authStatusCalls,
        callsBeforeQuietWindow + 1,
        "a fresh connect keeps CPG readiness quiet throughout browser login",
      );
    } finally {
      t.mock.timers.reset();
    }

    t.mock.timers.enable({
      apis: ["setTimeout", "Date"],
      now: Date.now(),
    });
    try {
      authenticated = false;
      const callsBeforeRecovery = authStatusCalls;
      const recoveredReadiness = await readPortalReadiness(recoveredLoginUserId);
      assert.equal(recoveredReadiness.status, "needs_login");
      assert.equal(
        authStatusCalls,
        callsBeforeRecovery,
        "API reload recovery restores the pre-completion readiness guard",
      );
      capsuleStatuses.set(recoveredStartingUserId, "occupied");
      const recoveredStarting = await readPortalReadiness(
        recoveredStartingUserId,
      );
      assert.equal(recoveredStarting.status, "gateway_starting");

      t.mock.timers.setTime(Date.now() + 6 * 60_000);
      t.mock.timers.tick(3_000);
      await new Promise((resolve) => setImmediate(resolve));
      assert(
        released.has(recoveredLoginUserId),
        "API reload recovery restores bounded orphan cleanup",
      );
      assert(released.has(recoveredStartingUserId));
    } finally {
      t.mock.timers.reset();
    }

    const markerlessLoginStartedAt = Date.now();
    t.mock.timers.enable({
      apis: ["setTimeout", "Date"],
      now: markerlessLoginStartedAt,
    });
    try {
      authenticated = false;
      accountIds = ["U1357911"];
      const callsBeforeMarkerlessAuthentication = authStatusCalls;
      const initCallsBeforeMarkerlessAuthentication = ssodhInitCalls;
      await connectPortal(markerlessAuthenticatedUserId);
      authenticated = true;

      t.mock.timers.setTime(markerlessLoginStartedAt + 26_999);
      t.mock.timers.tick(1);
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(2_999);
      assert.equal(
        authStatusCalls,
        callsBeforeMarkerlessAuthentication,
        "browser login remains undisturbed before the bounded status probe",
      );

      t.mock.timers.tick(1);
      await new Promise((resolve) => setImmediate(resolve));

      assert(
        !released.has(markerlessAuthenticatedUserId),
        "an authenticated gateway must remain active when its login-completion marker is missing",
      );
      assert.equal(
        getGateway(markerlessAuthenticatedUserId)?.paperAccountVerified,
        true,
        "the monitor promptly promotes authoritative markerless brokerage status",
      );
      assert.equal(
        authStatusCalls,
        callsBeforeMarkerlessAuthentication + 2,
        "markerless promotion uses one status-only probe and one verified readiness check",
      );
      assert.equal(
        ssodhInitCalls,
        initCallsBeforeMarkerlessAuthentication,
        "markerless detection leaves the stateful SSO handshake entirely to CPG",
      );
    } finally {
      t.mock.timers.reset();
    }

    const monitorRaceStartedAt = Date.now();
    t.mock.timers.enable({
      apis: ["setTimeout", "Date"],
      now: monitorRaceStartedAt,
    });
    try {
      let releaseBlockedStatus!: () => void;
      blockedStatus = new Promise<void>((resolve) => {
        releaseBlockedStatus = resolve;
      });
      blockedStatusUserId = monitorRaceUserId;
      await connectPortal(monitorRaceUserId);
      t.mock.timers.tick(3_000);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(hostStatusCalls.get(monitorRaceUserId), 1);

      t.mock.timers.setTime(monitorRaceStartedAt + 5 * 60_000);
      await connectPortal(monitorRaceUserId);
      blockedStatusUserId = null;
      blockedStatus = null;
      releaseBlockedStatus();
      await new Promise((resolve) => setImmediate(resolve));
      const callsBeforeReplacementPoll =
        hostStatusCalls.get(monitorRaceUserId) ?? 0;

      t.mock.timers.setTime(monitorRaceStartedAt + 6 * 60_000);
      t.mock.timers.tick(3_000);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        hostStatusCalls.get(monitorRaceUserId),
        callsBeforeReplacementPoll + 2,
        "the replacement monitor performs its markerless probe and readiness poll",
      );
      assert(
        !released.has(monitorRaceUserId),
        "the old monitor expiry cannot release the replacement gateway",
      );
      await disconnectPortal(monitorRaceUserId);
    } finally {
      blockedStatusUserId = null;
      blockedStatus = null;
      t.mock.timers.reset();
    }

    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const callsBeforeConnect = authStatusCalls;
      loginCompletions.set(delayedLiveUserId, 7);
      const delayedLiveStart = await connectPortal(delayedLiveUserId);
      assert.equal(delayedLiveStart.status, "needs_login");
      const duringLogin = await readPortalReadiness(delayedLiveUserId);
      assert.equal(duringLogin.status, "needs_login");
      assert.equal(
        duringLogin.browserLoginComplete,
        false,
        "an existing capsule marker is only the baseline for a new login attempt",
      );
      assert.equal(
        authStatusCalls,
        callsBeforeConnect,
        "browser login must not race against backend auth-status probes",
      );

      authenticated = true;
      accountIds = ["U2468101"];
      const initCallsBeforeCompletion = ssodhInitCalls;
      loginCompletions.set(delayedLiveUserId, 8);
      const completionObserved = await readPortalReadiness(delayedLiveUserId);
      assert.equal(completionObserved.status, "needs_login");
      assert.equal(
        completionObserved.browserLoginComplete,
        true,
        "a new capsule marker is safe progress evidence before API verification",
      );
      assert.equal(authStatusCalls, callsBeforeConnect);

      t.mock.timers.tick(19_999);
      const stillQuiet = await readPortalReadiness(delayedLiveUserId);
      assert.equal(stillQuiet.status, "needs_login");
      assert.equal(
        authStatusCalls,
        callsBeforeConnect,
        "a new capsule completion lets CPG finish its own authentication retries",
      );

      t.mock.timers.tick(1);
      const delayedReadiness = await readPortalReadiness(delayedLiveUserId);
      assert.equal(delayedReadiness.status, "connected");
      assert.equal(delayedReadiness.browserLoginComplete, true);
      assert.equal(authStatusCalls, callsBeforeConnect + 1);
      assert.equal(
        ssodhInitCalls,
        initCallsBeforeCompletion,
        "the hosted portal leaves the stateful SSO handshake to CPG",
      );
      assert.equal(delayedReadiness.selectedAccountId, "U2468101");
      assert.ok(
        getGateway(delayedLiveUserId),
        "real-account login keeps its gateway",
      );
      assert(!released.has(delayedLiveUserId));
      assert.equal(reauthenticateCalls, 0);

      loginCompletions.set(failedAfterLoginUserId, 0);
      await connectPortal(failedAfterLoginUserId);
      forceBrokerageUnauthorized = true;
      loginCompletions.set(failedAfterLoginUserId, 1);
      const failedCompletion = await readPortalReadiness(
        failedAfterLoginUserId,
      );
      assert.equal(failedCompletion.browserLoginComplete, true);
      assert.equal(failedCompletion.apiSessionActivationFailed, false);
      t.mock.timers.tick(20_000);
      const failedVerification = await readPortalReadiness(
        failedAfterLoginUserId,
      );
      assert.equal(failedVerification.status, "needs_login");
      assert.equal(failedVerification.browserLoginComplete, true);
      assert.equal(failedVerification.authenticated, false);
      assert.equal(failedVerification.apiSessionActivationFailed, true);
      assert.match(failedVerification.message, /sign-in response received/i);
      assert.match(failedVerification.message, /connection is not active/i);
      assert.doesNotMatch(
        failedVerification.message,
        /401|auth\/status|ssodh|Unauthorized/i,
      );
      assert.equal(
        ssodhInitCalls,
        initCallsBeforeCompletion,
        "an unauthorized status probe must not start a competing SSO handshake",
      );
      assert.equal(
        reauthenticateCalls,
        0,
        "hosted readiness must not call IBKR's deprecated reauthentication endpoint",
      );
      t.mock.timers.tick(20_000);
      const persistentFailure = await readPortalReadiness(
        failedAfterLoginUserId,
      );
      assert.equal(persistentFailure.status, "needs_login");
      assert.equal(persistentFailure.apiSessionActivationFailed, true);
      assert.match(persistentFailure.message, /connection is not active/i);
      assert.equal(
        reauthenticateCalls,
        0,
        "repeated status polling must remain free of deprecated reauthentication calls",
      );
      forceBrokerageUnauthorized = false;
    } finally {
      forceBrokerageUnauthorized = false;
      t.mock.timers.reset();
    }
  } finally {
    await disconnectPortal(liveUserId).catch(() => undefined);
    await disconnectPortal(paperUserId).catch(() => undefined);
    await disconnectPortal(needsLoginUserId).catch(() => undefined);
    await disconnectPortal(delayedLiveUserId).catch(() => undefined);
    await disconnectPortal(failedAfterLoginUserId).catch(() => undefined);
    await disconnectPortal(recoveredLoginUserId).catch(() => undefined);
    await disconnectPortal(recoveredStartingUserId).catch(() => undefined);
    await disconnectPortal(markerlessAuthenticatedUserId).catch(
      () => undefined,
    );
    await disconnectPortal(monitorRaceUserId).catch(() => undefined);
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
