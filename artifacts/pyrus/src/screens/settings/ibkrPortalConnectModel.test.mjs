import assert from "node:assert/strict";
import test from "node:test";

import {
  IBKR_OFFICIAL_CLIENT_SERVICES_URL,
  IBKR_OFFICIAL_CLIENT_PORTAL_URL,
  IBKR_PORTAL_LOGIN_TIMEOUT_MS,
  buildIbkrPortalProgressModel,
  formatIbkrPortalStatus,
  hasIbkrPortalLoginTimedOut,
  isTerminalIbkrPortalConnectStatus,
  restoreIbkrPortalFocus,
  startIbkrPortalConnectWithRecovery,
} from "./ibkrPortalConnectModel.js";

test("IBKR portal connect returns the first successful start without a status probe", async () => {
  let startCalls = 0;
  let statusCalls = 0;
  let waitCalls = 0;
  const started = { loginPath: "/ibkr-viewer.html", status: "needs_login" };

  const result = await startIbkrPortalConnectWithRecovery({
    start: async () => {
      startCalls += 1;
      return started;
    },
    readStatus: async () => {
      statusCalls += 1;
      return { gatewayRunning: true, status: "needs_login" };
    },
    wait: async () => {
      waitCalls += 1;
    },
  });

  assert.equal(result, started);
  assert.equal(startCalls, 1);
  assert.equal(statusCalls, 0);
  assert.equal(waitCalls, 0);
});

test("IBKR portal connect re-adopts a backend-completed login after a lost response", async () => {
  const originalError = new Error("network changed");
  const recovered = { loginPath: "/ibkr-viewer.html", status: "needs_login" };
  let startCalls = 0;
  let statusCalls = 0;
  let waitCalls = 0;

  const result = await startIbkrPortalConnectWithRecovery({
    start: async () => {
      startCalls += 1;
      if (startCalls === 1) throw originalError;
      return recovered;
    },
    readStatus: async () => {
      statusCalls += 1;
      return { gatewayRunning: true, status: "needs_login" };
    },
    wait: async () => {
      waitCalls += 1;
    },
  });

  assert.equal(result, recovered);
  assert.equal(startCalls, 2);
  assert.equal(statusCalls, 1);
  assert.equal(waitCalls, 0);
});

test("IBKR portal connect retries one status read after a network-change burst", async () => {
  const originalError = new Error("network changed");
  const recovered = { loginPath: "/ibkr-viewer.html", status: "needs_login" };
  const calls = [];

  const result = await startIbkrPortalConnectWithRecovery({
    start: async () => {
      calls.push("start");
      if (calls.filter((call) => call === "start").length === 1) {
        throw originalError;
      }
      return recovered;
    },
    readStatus: async () => {
      calls.push("status");
      if (calls.filter((call) => call === "status").length === 1) {
        throw new Error("network still changing");
      }
      return { gatewayRunning: true, status: "needs_login" };
    },
    wait: async () => {
      calls.push("wait");
    },
  });

  assert.equal(result, recovered);
  assert.deepEqual(calls, ["start", "status", "wait", "status", "start"]);
});

test("IBKR portal connect re-adopts a gateway that is still starting after a lost response", async () => {
  const originalError = new Error("response lost");
  const recovered = {
    loginPath: "/ibkr-viewer.html",
    status: "gateway_starting",
  };
  let startCalls = 0;

  const result = await startIbkrPortalConnectWithRecovery({
    start: async () => {
      startCalls += 1;
      if (startCalls === 1) throw originalError;
      return recovered;
    },
    readStatus: async () => ({
      gatewayRunning: false,
      status: "gateway_starting",
    }),
  });

  assert.equal(result, recovered);
  assert.equal(startCalls, 2);
});

test("IBKR portal connect does not retry when server truth is disconnected", async () => {
  const originalError = new Error("connect failed");
  let startCalls = 0;
  let waitCalls = 0;

  await assert.rejects(
    startIbkrPortalConnectWithRecovery({
      start: async () => {
        startCalls += 1;
        throw originalError;
      },
      readStatus: async () => ({
        gatewayRunning: false,
        status: "disconnected",
      }),
      wait: async () => {
        waitCalls += 1;
      },
    }),
    (error) => error === originalError,
  );
  assert.equal(startCalls, 1);
  assert.equal(waitCalls, 0);
});

test("IBKR portal connect preserves the original error when status is unavailable", async () => {
  const originalError = new Error("connect failed");
  let startCalls = 0;
  let statusCalls = 0;
  let waitCalls = 0;

  await assert.rejects(
    startIbkrPortalConnectWithRecovery({
      start: async () => {
        startCalls += 1;
        throw originalError;
      },
      readStatus: async () => {
        statusCalls += 1;
        throw new Error("status unavailable");
      },
      wait: async () => {
        waitCalls += 1;
      },
    }),
    (error) => error === originalError,
  );
  assert.equal(startCalls, 1);
  assert.equal(statusCalls, 2);
  assert.equal(waitCalls, 1);
});

test("IBKR portal connect retries at most once and preserves the original error", async () => {
  const originalError = new Error("response lost");
  let startCalls = 0;
  let statusCalls = 0;
  let waitCalls = 0;

  await assert.rejects(
    startIbkrPortalConnectWithRecovery({
      start: async () => {
        startCalls += 1;
        throw startCalls === 1
          ? originalError
          : new Error("retry response lost");
      },
      readStatus: async () => {
        statusCalls += 1;
        return {
          gatewayRunning: true,
          status: "needs_login",
        };
      },
      wait: async () => {
        waitCalls += 1;
      },
    }),
    (error) => error === originalError,
  );
  assert.equal(startCalls, 2);
  assert.equal(statusCalls, 1);
  assert.equal(waitCalls, 0);
});

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
      message:
        "IBKR sign-in response received. PYRUS is opening the API session and loading accounts; this connection is not active yet.",
    },
  });
  assert.equal(verifying.title, "IBKR sign-in received");
  assert.match(verifying.detail, /opening the API session/i);
  assert.equal(verifying.showLoginViewer, false);
  assert.equal(verifying.showVerificationRecovery, false);
  assert.deepEqual(
    verifying.steps.map(({ status }) => status),
    ["complete", "complete", "current"],
  );

  const verificationUnavailable = buildIbkrPortalProgressModel({
    readiness: {
      status: "needs_login",
      gatewayRunning: true,
      authenticated: false,
      browserLoginComplete: true,
      apiSessionActivationFailed: true,
      selectedAccountId: null,
      accounts: [],
      message:
        "IBKR sign-in response received, but the API session is still unavailable. PYRUS is checking the session; this connection is not active.",
    },
  });
  assert.equal(
    verificationUnavailable.title,
    "IBKR sign-in received",
  );
  assert.equal(
    verificationUnavailable.detail,
    "IBKR sign-in response received, but the API session is still unavailable. PYRUS is checking the session; this connection is not active.",
  );
  assert.equal(verificationUnavailable.connected, false);
  assert.equal(verificationUnavailable.showLoginViewer, false);
  assert.equal(verificationUnavailable.showVerificationRecovery, true);
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
  assert.equal(
    connected.detail,
    "U1234567 · 2 trading accounts available",
  );
  assert.equal(connected.showVerificationRecovery, false);

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
  assert.equal(competing.showVerificationRecovery, false);
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

  assert.equal(IBKR_PORTAL_LOGIN_TIMEOUT_MS, 6 * 60_000 + 30_000);
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

test("IBKR recovery links only to the official HTTPS Client Portal", () => {
  const destination = new URL(IBKR_OFFICIAL_CLIENT_PORTAL_URL);
  const support = new URL(IBKR_OFFICIAL_CLIENT_SERVICES_URL);

  assert.equal(destination.protocol, "https:");
  assert.equal(destination.hostname, "ndcdyn.interactivebrokers.com");
  assert.equal(destination.pathname, "/sso/Login");
  assert.equal(support.protocol, "https:");
  assert.equal(support.hostname, "www.interactivebrokers.com");
  assert.equal(support.pathname, "/en/support/individuals.php");
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
