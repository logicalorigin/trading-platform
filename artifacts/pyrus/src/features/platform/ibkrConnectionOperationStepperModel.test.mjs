import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIbkrDeactivateOperationStepper,
  buildIbkrLaunchOperationStepper,
  getIbkrLaunchActionProgressLabel,
} from "./ibkrConnectionOperationStepperModel.js";

test("deactivation stepper names confirmed shutdown as deactivated", () => {
  const model = buildIbkrDeactivateOperationStepper({
    queue: "complete",
    detach: "complete",
    refresh: "complete",
    desktop: "complete",
    message: "IBKR detached and Gateway stopped on the Windows desktop.",
  });

  assert.equal(model.title, "IBKR Deactivated");
  assert.equal(model.operation, "deactivate");
  assert.equal(model.activity, null);
  assert.equal(model.steps.every((step) => step.status === "complete"), true);
});

test("deactivation stepper keeps command label while shutdown is running", () => {
  const model = buildIbkrDeactivateOperationStepper({
    queue: "complete",
    detach: "complete",
    refresh: "complete",
    desktop: "current",
  });

  assert.equal(model.title, "Deactivate IBKR");
  assert.equal(model.activity?.id, "desktop");
});

test("detach bridge stepper does not claim Gateway deactivation", () => {
  const model = buildIbkrDeactivateOperationStepper({
    variant: "clear-state",
    detach: "complete",
    refresh: "complete",
    message: "IBKR bridge detached.",
  });

  assert.equal(model.title, "IBKR Bridge Detached");
  assert.equal(model.operation, "detach-bridge");
  assert.deepEqual(
    model.steps.map((step) => step.id),
    ["detach", "refresh"],
  );
  assert.equal(model.activity, null);
});

test("launch stepper keeps credential-key handoff progress in credentials phase", () => {
  const activationStatus = {
    latestProgress: {
      message: "Pyrus read the Windows helper credential key.",
      status: "waiting_gateway",
      step: "credential_key_read",
    },
    recentProgress: [
      {
        message: "Windows helper launched.",
        status: "launched",
        step: "helper_launched",
      },
      {
        message: "Windows helper published the credential key.",
        status: "waiting_gateway",
        step: "credential_key_published",
      },
      {
        message: "Pyrus read the Windows helper credential key.",
        status: "waiting_gateway",
        step: "credential_key_read",
      },
    ],
  };

  const model = buildIbkrLaunchOperationStepper({
    activationStatus,
    inFlight: true,
  });

  assert.equal(model.steps.find((step) => step.id === "request")?.status, "complete");
  assert.equal(model.steps.find((step) => step.id === "credentials")?.status, "current");
  assert.equal(model.latestMessage, "Pyrus read the Windows helper credential key.");
  assert.equal(
    getIbkrLaunchActionProgressLabel({ activationStatus, inFlight: true }),
    "Encrypting",
  );
});

test("launch stepper settles the active step into warning when the activation is stale", () => {
  // The desktop Gateway is off and the bridge tunnel origin is down (HTTP 530 /
  // Cloudflare 1033). The backend flags the activation insight as stale but keeps
  // it active (non-terminal). The active step must NOT keep animating as
  // "current"; it should settle into a non-animating "warning" so the spinner
  // stops and the UI reads as stalled/needs-attention.
  const activationStatus = {
    active: true,
    canceled: false,
    insight: { stale: true, severity: "attention" },
    latestProgress: {
      message: "Connecting bridge to the Gateway API.",
      status: "waiting_gateway",
      step: "waiting_bridge_gateway_api",
    },
  };

  const model = buildIbkrLaunchOperationStepper({
    activationStatus,
    inFlight: true,
  });

  assert.equal(model.steps.find((step) => step.id === "bridge")?.status, "warning");
  assert.equal(
    model.steps.some((step) => step.status === "current"),
    false,
  );
});

test("launch stepper surfaces a stalled message when no progress message is present", () => {
  const model = buildIbkrLaunchOperationStepper({
    activationStatus: {
      active: true,
      canceled: false,
      insight: { stale: true, severity: "attention" },
      latestProgress: { status: "waiting_gateway", step: "waiting_bridge_gateway_api" },
    },
    inFlight: true,
  });

  assert.match(model.latestMessage, /stalled/i);
});

test("launch stepper does not downgrade a stale activation once it is connected", () => {
  // Connected always wins: a late stale flag must not regress a confirmed attach.
  const model = buildIbkrLaunchOperationStepper({
    activationStatus: {
      active: true,
      canceled: false,
      insight: { stale: true, severity: "attention" },
      latestProgress: { status: "connected", step: "connected" },
    },
    gatewayConnected: true,
  });

  assert.equal(model.steps.every((step) => step.status === "complete"), true);
});

test("launch stepper settles into warning when the client watchdog flags stale even though the backend never did", () => {
  // The backend insight says NOT stale (or never arrived), but the client-side
  // watchdog observed no progress for too long. The stepper must still stop
  // animating so a silent backend can no longer leave the popover spinning.
  const model = buildIbkrLaunchOperationStepper({
    activationStatus: {
      active: true,
      canceled: false,
      insight: { stale: false, severity: "active" },
      latestProgress: { status: "starting_bridge", step: "preparing_bridge" },
    },
    inFlight: true,
    stale: true,
  });

  assert.equal(model.steps.find((step) => step.id === "bridge")?.status, "warning");
  assert.equal(
    model.steps.some((step) => step.status === "current"),
    false,
  );
  assert.match(model.latestMessage, /stalled/i);
});

test("launch stepper stalled message wins over the generic in-flight notice", () => {
  // Even when a caller passes the optimistic "running from the Windows helper"
  // notice, a stalled launch must surface the actionable retry/cancel message.
  const model = buildIbkrLaunchOperationStepper({
    activationStatus: {
      active: true,
      canceled: false,
      latestProgress: { status: "starting_bridge", step: "preparing_bridge" },
    },
    inFlight: true,
    message: "IB Gateway activation is running from the Windows helper.",
    stale: true,
  });

  assert.match(model.latestMessage, /stalled/i);
});

test("launch stepper ignores the client watchdog once the bridge is connected", () => {
  // A late watchdog flag must never regress a confirmed attach.
  const model = buildIbkrLaunchOperationStepper({
    activationStatus: {
      active: true,
      canceled: false,
      latestProgress: { status: "connected", step: "connected" },
    },
    gatewayConnected: true,
    stale: true,
  });

  assert.equal(model.steps.every((step) => step.status === "complete"), true);
});
