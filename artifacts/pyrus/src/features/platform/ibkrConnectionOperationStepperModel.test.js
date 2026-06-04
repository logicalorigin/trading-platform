import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIbkrDeactivateOperationStepper,
  buildIbkrLaunchOperationStepper,
  getIbkrLaunchActionProgressLabel,
} from "./ibkrConnectionOperationStepperModel.js";

const statuses = (model) => model.steps.map((step) => [step.label, step.status]);
const icons = (model) => model.steps.map((step) => [step.id, step.icon, step.motion]);

test("IBKR launch stepper maps helper progress through connection phases", () => {
  assert.deepEqual(
    icons(buildIbkrLaunchOperationStepper()),
    [
      ["request", "send", "dispatch"],
      ["credentials", "key", "secure"],
      ["gateway", "monitor", "boot"],
      ["bridge", "cable", "link"],
      ["tunnel", "network", "tunnel"],
    ],
  );

  assert.deepEqual(
    icons(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "updating_helper" },
          recentProgress: [{ step: "updating_helper" }],
        },
        inFlight: true,
      }),
    ),
    [
      ["request", "send", "dispatch"],
      ["update", "refresh", "spin"],
      ["credentials", "key", "secure"],
      ["gateway", "monitor", "boot"],
      ["bridge", "cable", "link"],
      ["tunnel", "network", "tunnel"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "updating_helper" },
          recentProgress: [{ step: "updating_helper" }],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "complete"],
      ["Update", "current"],
      ["Credentials", "pending"],
      ["Gateway", "pending"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "helper_launched" },
          recentProgress: [
            { step: "updating_helper" },
            { step: "helper_launched" },
          ],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "complete"],
      ["Update", "complete"],
      ["Credentials", "current"],
      ["Gateway", "pending"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "waiting_secure_credentials" },
          recentProgress: [
            { step: "helper_launched" },
            { step: "checking_gateway_socket" },
            { step: "waiting_secure_credentials" },
            { step: "encrypting_credentials" },
            { step: "credentials_sent_to_pyrus" },
          ],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "current"],
      ["Gateway", "pending"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "encrypting_credentials" },
      },
      inFlight: true,
    }),
    "Encrypting",
  );
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "credentials_received" },
      },
      inFlight: true,
    }),
    "Credentials sent",
  );
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "queued_on_pyrus" },
      },
      inFlight: true,
    }),
    "Queued",
  );
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "waiting_desktop_agent" },
      },
      inFlight: true,
    }),
    "Waiting desktop",
  );
  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "waiting_desktop_agent" },
          recentProgress: [
            { step: "queued_on_pyrus" },
            { step: "waiting_desktop_agent" },
          ],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "current"],
      ["Credentials", "pending"],
      ["Gateway", "pending"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "waiting_2fa" },
          recentProgress: [
            { step: "waiting_secure_credentials" },
            { step: "credentials_delivered" },
            { step: "waiting_2fa" },
          ],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "complete"],
      ["Gateway", "current"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "gateway_login_window_active" },
          recentProgress: [
            { step: "waiting_secure_credentials" },
            { step: "credentials_delivered" },
            { step: "gateway_window_login" },
            { step: "gateway_login_window_active" },
          ],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "complete"],
      ["Gateway", "current"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "local_bridge_ready" },
          recentProgress: [
            { step: "waiting_secure_credentials" },
            { step: "credentials_delivered" },
            { step: "waiting_2fa" },
            { step: "local_bridge_ready" },
          ],
        },
        inFlight: true,
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "complete"],
      ["Gateway", "complete"],
      ["Bridge", "current"],
      ["Tunnel", "pending"],
    ],
  );
});

test("IBKR launch stepper handles complete, cancel, and error outcomes", () => {
  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "connected", message: "IB Gateway bridge attached." },
          recentProgress: [{ step: "connected" }],
        },
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "complete"],
      ["Gateway", "complete"],
      ["Bridge", "complete"],
      ["Tunnel", "complete"],
    ],
  );
  const connectedAfterStaleActivation = buildIbkrLaunchOperationStepper({
    activationStatus: {
      canceled: true,
      latestProgress: {
        step: "cancel_requested",
        status: "canceled",
        message: "IB Gateway bridge launch was canceled.",
      },
    },
    error: "Timed out waiting for activation status.",
    gatewayConnected: true,
    message: "IB Gateway activation is running from the Windows helper.",
  });
  assert.deepEqual(statuses(connectedAfterStaleActivation), [
    ["Request", "complete"],
    ["Credentials", "complete"],
    ["Gateway", "complete"],
    ["Bridge", "complete"],
    ["Tunnel", "complete"],
  ]);
  assert.equal(
    connectedAfterStaleActivation.latestMessage,
    "IB Gateway bridge attached.",
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          canceled: true,
          latestProgress: { step: "cancel_requested", status: "canceled" },
          recentProgress: [
            { step: "waiting_secure_credentials" },
            { step: "cancel_requested", status: "canceled" },
          ],
        },
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "canceled"],
      ["Gateway", "pending"],
      ["Bridge", "pending"],
      ["Tunnel", "pending"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrLaunchOperationStepper({
        activationStatus: {
          latestProgress: { step: "retrying_tunnel" },
          recentProgress: [
            { step: "local_bridge_ready" },
            { step: "retrying_tunnel" },
          ],
        },
        error: "Cloudflare quick tunnel did not publish a URL.",
      }),
    ),
    [
      ["Request", "complete"],
      ["Credentials", "complete"],
      ["Gateway", "complete"],
      ["Bridge", "complete"],
      ["Tunnel", "error"],
    ],
  );
});

test("IBKR launch action label reflects the latest operation phase", () => {
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "updating_helper" },
      },
      busy: true,
    }),
    "Updating helper",
  );
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "waiting_secure_credentials" },
      },
      inFlight: true,
    }),
    "Waiting credentials",
  );
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { step: "gateway_login_window_unconfirmed" },
      },
      inFlight: true,
    }),
    "Check Gateway",
  );
  assert.equal(
    getIbkrLaunchActionProgressLabel({
      activationStatus: {
        latestProgress: { status: "starting_bridge" },
      },
      inFlight: true,
    }),
    "Starting bridge",
  );
});

test("IBKR deactivate stepper keeps synthesized queue/detach/refresh/desktop states", () => {
  assert.deepEqual(
    icons(buildIbkrDeactivateOperationStepper()),
    [
      ["queue", "clock", "queue"],
      ["detach", "unplug", "detach"],
      ["refresh", "refresh", "spin"],
      ["desktop", "power", "power"],
    ],
  );

  assert.deepEqual(
    statuses(
      buildIbkrDeactivateOperationStepper({
        queue: "warning",
        detach: "complete",
        refresh: "complete",
        desktop: "warning",
        message: "IBKR detached. Windows shutdown was not queued.",
      }),
    ),
    [
      ["Queue", "warning"],
      ["Detach", "complete"],
      ["Refresh", "complete"],
      ["Desktop", "warning"],
    ],
  );

  const detaching = buildIbkrDeactivateOperationStepper({
    queue: "current",
    detach: "current",
    message: "Queueing Windows shutdown and detaching backend runtime.",
  });
  assert.equal(detaching.activity.id, "detach");
  assert.equal(detaching.activity.label, "Detaching backend runtime");
  assert.equal(detaching.activity.motion, "detach");

  const waitingForDesktop = buildIbkrDeactivateOperationStepper({
    queue: "complete",
    detach: "complete",
    refresh: "complete",
    desktop: "current",
  });
  assert.equal(waitingForDesktop.activity.id, "desktop");
  assert.equal(waitingForDesktop.activity.label, "Stopping IB Gateway");

  const finished = buildIbkrDeactivateOperationStepper({
    queue: "complete",
    detach: "complete",
    refresh: "complete",
    desktop: "complete",
  });
  assert.equal(finished.activity, null);
});
