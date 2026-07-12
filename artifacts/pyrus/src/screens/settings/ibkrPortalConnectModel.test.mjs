import assert from "node:assert/strict";
import test from "node:test";

import {
  IBKR_PORTAL_LOGIN_TIMEOUT_MS,
  buildIbkrPortalProgressModel,
  formatIbkrPortalStatus,
  hasIbkrPortalLoginTimedOut,
  isTerminalIbkrPortalConnectStatus,
  restoreIbkrPortalFocus,
} from "./ibkrPortalConnectModel.js";

test("IBKR portal progress distinguishes browser login from verified connection", () => {
  const starting = buildIbkrPortalProgressModel({
    connecting: true,
    readiness: {
      status: "gateway_starting",
      gatewayRunning: true,
      authenticated: false,
      browserLoginComplete: false,
      selectedAccountId: null,
      accounts: [],
      message: "Starting the IBKR gateway…",
    },
  });
  assert.equal(starting.title, "Starting IBKR Client Portal");
  assert.deepEqual(
    starting.steps.map(({ status }) => status),
    ["current", "pending", "pending"],
  );

  const awaitingLogin = buildIbkrPortalProgressModel({
    readiness: {
      status: "needs_login",
      gatewayRunning: true,
      authenticated: false,
      browserLoginComplete: false,
      selectedAccountId: null,
      accounts: [],
      message: "Gateway is running. Log in to IBKR to finish connecting.",
    },
  });
  assert.equal(awaitingLogin.title, "Complete your IBKR login");
  assert.deepEqual(
    awaitingLogin.steps.map(({ status }) => status),
    ["complete", "current", "pending"],
  );

  const verifying = buildIbkrPortalProgressModel({
    readiness: {
      status: "needs_login",
      gatewayRunning: true,
      authenticated: false,
      browserLoginComplete: true,
      selectedAccountId: null,
      accounts: [],
      message: "Gateway is running. Log in to IBKR to finish connecting.",
    },
  });
  assert.equal(verifying.title, "Verifying your IBKR session");
  assert.match(verifying.detail, /accepted your login/i);
  assert.deepEqual(
    verifying.steps.map(({ status }) => status),
    ["complete", "complete", "current"],
  );
});

test("IBKR portal progress requires authenticated server truth for success", () => {
  const connectedReadiness = {
    status: "connected",
    gatewayRunning: true,
    authenticated: true,
    browserLoginComplete: true,
    selectedAccountId: "U1234567",
    accounts: ["U1234567", "U7654321"],
    message: "Connected to IBKR.",
  };
  const connected = buildIbkrPortalProgressModel({
    readiness: connectedReadiness,
  });
  assert.equal(connected.connected, true);
  assert.equal(
    connected.steps.every(({ status }) => status === "complete"),
    true,
  );
  assert.equal(connected.title, "Connected to IBKR");
  assert.equal(connected.detail, "U1234567 · 2 accounts available");

  const unverified = buildIbkrPortalProgressModel({
    readiness: {
      ...connectedReadiness,
      authenticated: false,
    },
  });
  assert.equal(unverified.connected, false);
  assert.equal(unverified.steps.at(-1)?.status, "current");
});

test("IBKR portal progress keeps competing sessions on the re-login step", () => {
  const competing = buildIbkrPortalProgressModel({
    readiness: {
      status: "competing",
      gatewayRunning: true,
      authenticated: false,
      browserLoginComplete: true,
      selectedAccountId: null,
      accounts: [],
      message: "Another live IBKR session is competing. Re-login to take over.",
    },
  });

  assert.equal(competing.title, "IBKR session needs attention");
  assert.equal(competing.showLoginViewer, true);
  assert.deepEqual(
    competing.steps.map(({ status }) => status),
    ["complete", "current", "pending"],
  );
});

test("IBKR portal progress ignores stale disconnected copy during startup", () => {
  const starting = buildIbkrPortalProgressModel({
    connecting: true,
    readiness: {
      status: "disconnected",
      gatewayRunning: false,
      authenticated: false,
      browserLoginComplete: false,
      selectedAccountId: null,
      accounts: [],
      message: "Not connected. Start a connection to log in to IBKR.",
    },
  });

  assert.equal(starting.title, "Starting IBKR Client Portal");
  assert.doesNotMatch(starting.detail, /not connected/i);
});

test("IBKR portal model recognizes terminal hosted-login failures", () => {
  assert.equal(formatIbkrPortalStatus("disconnected"), "not connected");
  assert.equal(
    isTerminalIbkrPortalConnectStatus({
      status: "disconnected",
      gatewayRunning: false,
    }),
    true,
  );
  assert.equal(
    isTerminalIbkrPortalConnectStatus({
      status: "needs_login",
      gatewayRunning: true,
    }),
    false,
  );
});

test("IBKR portal timeout preserves the post-login finalization grace", () => {
  const startedAt = 1_000;

  assert.equal(IBKR_PORTAL_LOGIN_TIMEOUT_MS, 5 * 60_000 + 30_000);
  assert.equal(
    hasIbkrPortalLoginTimedOut(
      startedAt,
      startedAt + IBKR_PORTAL_LOGIN_TIMEOUT_MS,
    ),
    false,
  );
  assert.equal(
    hasIbkrPortalLoginTimedOut(
      startedAt,
      startedAt + IBKR_PORTAL_LOGIN_TIMEOUT_MS + 1,
    ),
    true,
  );
});

test("IBKR portal focus returns only to a stable mounted target", () => {
  let focusCalls = 0;
  const target = {
    isConnected: true,
    focus() {
      focusCalls += 1;
    },
  };

  assert.equal(restoreIbkrPortalFocus(target), true);
  assert.equal(focusCalls, 1);
  assert.equal(
    restoreIbkrPortalFocus({
      isConnected: false,
      focus() {
        focusCalls += 1;
      },
    }),
    false,
  );
  assert.equal(restoreIbkrPortalFocus(null), false);
  assert.equal(focusCalls, 1);
});
