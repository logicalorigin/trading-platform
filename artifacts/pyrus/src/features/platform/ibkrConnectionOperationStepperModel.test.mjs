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
