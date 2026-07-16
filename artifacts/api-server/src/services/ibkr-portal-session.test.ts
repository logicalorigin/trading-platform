import assert from "node:assert/strict";
import test from "node:test";

import { ensureGateway, getGateway } from "./ibkr-portal-gateway-manager";
import {
  beginPortalReadinessQuietWindow,
  connectPortal,
  disconnectPortal,
  readPortalReadiness,
} from "./ibkr-portal-session";

test("hosted portal accepts only nonempty all-paper account sets", async (t) => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const rejectedAccountCases = [
    {
      accountIds: ["U1234567"],
      label: "live",
      userId: "33333333-3333-4333-8333-333333333333",
    },
    {
      accountIds: ["DU1234567", "U7654321"],
      label: "mixed",
      userId: "34343434-3434-4434-8434-343434343434",
    },
    {
      accountIds: [],
      label: "empty",
      userId: "35353535-3535-4535-8535-353535353535",
    },
    {
      accountIds: ["PAPER"],
      label: "ambiguous",
      userId: "36363636-3636-4636-8636-363636363636",
    },
  ] as const;
  const paperUserId = "44444444-4444-4444-8444-444444444444";
  const releaseFailureUserId = "37373737-3737-4737-8737-373737373737";
  const needsLoginUserId = "55555555-5555-4555-8555-555555555555";
  const delayedPaperUserId = "66666666-6666-4666-8666-666666666666";
  const failedAfterLoginUserId = "67676767-6767-4767-8767-676767676767";
  const recoveredLoginUserId = "77777777-7777-4777-8777-777777777777";
  const recoveredStartingUserId = "88888888-8888-4888-8888-888888888888";
  const monitorRaceUserId = "99999999-9999-4999-8999-999999999999";
  const released = new Set<string>();
  const releaseFailures = new Set<string>();
  let accountIds: readonly string[] = rejectedAccountCases[0].accountIds;
  let authenticated = true;
  let forceBrokerageUnauthorized = false;
  let authStatusCalls = 0;
  let ssodhInitCalls = 0;
  let tickleCalls = 0;
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
        if (releaseFailures.has(sessionId)) {
          return new Response("unavailable", { status: 503 });
        }
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
    if (url.pathname.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: accountIds });
    }
    if (url.pathname.endsWith("/tickle")) {
      tickleCalls += 1;
      return Response.json({ session: "paper-session" });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    t.mock.timers.enable({ apis: ["setInterval"] });
    try {
      for (const testCase of rejectedAccountCases) {
        accountIds = testCase.accountIds;
        await ensureGateway(testCase.userId);
        const readiness = await readPortalReadiness(testCase.userId);
        assert.equal(readiness.status, "disconnected", testCase.label);
        assert.match(readiness.message, /sign in with.*Paper Trading/i);
        assert.equal(getGateway(testCase.userId), null, testCase.label);
        assert(released.has(testCase.userId), testCase.label);
      }
      t.mock.timers.tick(55_000);
      await Promise.resolve();
      assert.equal(tickleCalls, 0, "rejected accounts must never start keepalive");
    } finally {
      t.mock.timers.reset();
    }

    accountIds = ["U9876543"];
    await ensureGateway(releaseFailureUserId);
    releaseFailures.add(releaseFailureUserId);
    await assert.rejects(() => readPortalReadiness(releaseFailureUserId));
    assert(!released.has(releaseFailureUserId));
    releaseFailures.delete(releaseFailureUserId);
    await disconnectPortal(releaseFailureUserId);

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
        callsBeforeReplacementPoll + 1,
        "the replacement monitor remains the active generation",
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
      loginCompletions.set(delayedPaperUserId, 7);
      const delayedPaperStart = await connectPortal(delayedPaperUserId);
      assert.equal(delayedPaperStart.status, "needs_login");
      const duringLogin = await readPortalReadiness(delayedPaperUserId);
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
      accountIds = ["DU2468101"];
      const initCallsBeforeCompletion = ssodhInitCalls;
      loginCompletions.set(delayedPaperUserId, 8);
      const completionObserved = await readPortalReadiness(delayedPaperUserId);
      assert.equal(completionObserved.status, "needs_login");
      assert.equal(
        completionObserved.browserLoginComplete,
        true,
        "a new capsule marker is safe progress evidence before API verification",
      );
      assert.equal(authStatusCalls, callsBeforeConnect);

      t.mock.timers.tick(19_999);
      const stillQuiet = await readPortalReadiness(delayedPaperUserId);
      assert.equal(stillQuiet.status, "needs_login");
      assert.equal(
        authStatusCalls,
        callsBeforeConnect,
        "a new capsule completion lets CPG finish its own authentication retries",
      );

      t.mock.timers.tick(1);
      const delayedReadiness = await readPortalReadiness(delayedPaperUserId);
      assert.equal(delayedReadiness.status, "connected");
      assert.equal(delayedReadiness.browserLoginComplete, true);
      assert.equal(authStatusCalls, callsBeforeConnect + 1);
      assert.equal(
        ssodhInitCalls,
        initCallsBeforeCompletion,
        "the hosted portal leaves the stateful SSO handshake to CPG",
      );
      assert.equal(delayedReadiness.selectedAccountId, "DU2468101");
      assert.ok(
        getGateway(delayedPaperUserId),
        "paper login keeps its gateway",
      );
      assert(!released.has(delayedPaperUserId));

      loginCompletions.set(failedAfterLoginUserId, 0);
      await connectPortal(failedAfterLoginUserId);
      forceBrokerageUnauthorized = true;
      loginCompletions.set(failedAfterLoginUserId, 1);
      const failedCompletion = await readPortalReadiness(
        failedAfterLoginUserId,
      );
      assert.equal(failedCompletion.browserLoginComplete, true);
      t.mock.timers.tick(20_000);
      const failedVerification = await readPortalReadiness(
        failedAfterLoginUserId,
      );
      assert.equal(failedVerification.status, "needs_login");
      assert.equal(failedVerification.browserLoginComplete, true);
      assert.equal(failedVerification.authenticated, false);
      assert.match(failedVerification.message, /browser login completed/i);
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
      forceBrokerageUnauthorized = false;
    } finally {
      forceBrokerageUnauthorized = false;
      t.mock.timers.reset();
    }
  } finally {
    for (const testCase of rejectedAccountCases) {
      await disconnectPortal(testCase.userId).catch(() => undefined);
    }
    releaseFailures.delete(releaseFailureUserId);
    await disconnectPortal(releaseFailureUserId).catch(() => undefined);
    await disconnectPortal(paperUserId).catch(() => undefined);
    await disconnectPortal(needsLoginUserId).catch(() => undefined);
    await disconnectPortal(delayedPaperUserId).catch(() => undefined);
    await disconnectPortal(failedAfterLoginUserId).catch(() => undefined);
    await disconnectPortal(recoveredLoginUserId).catch(() => undefined);
    await disconnectPortal(recoveredStartingUserId).catch(() => undefined);
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
