import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveIbkrCredentialActionState,
  shouldAutoResumeIbkrCredentials,
  shouldClearIbkrPasswordAfterCredentialSubmit,
} from "./ibkrConnectionCredentialActionModel.js";

test("allows credential resume during an active launch before login handoff is ready", () => {
  const state = resolveIbkrCredentialActionState({
    activationActive: true,
    activationId: "activation-1",
    directActivationShouldReplaceCurrentLaunch: false,
    gatewayConnected: false,
    launchInFlight: true,
    managementToken: "management-token-1",
  });

  assert.equal(state.launchCancelable, true);
  assert.equal(state.resumeAvailable, true);
  assert.equal(state.primaryBlockedByActiveLaunch, false);
});

test("keeps replace-current-launch paths out of credential resume", () => {
  const state = resolveIbkrCredentialActionState({
    activationActive: true,
    activationId: "activation-1",
    directActivationShouldReplaceCurrentLaunch: true,
    gatewayConnected: false,
    launchInFlight: true,
    managementToken: "management-token-1",
  });

  assert.equal(state.launchCancelable, true);
  assert.equal(state.resumeAvailable, false);
  assert.equal(state.primaryBlockedByActiveLaunch, false);
});

test("keeps a runtime-reported active launch cancelable after local timers drift", () => {
  const state = resolveIbkrCredentialActionState({
    activationActive: false,
    activationId: "activation-1",
    directActivationShouldReplaceCurrentLaunch: false,
    gatewayConnected: false,
    launchInFlight: false,
    managementToken: "management-token-1",
    runtimeActivationActive: true,
  });

  assert.equal(state.launchCancelable, true);
  assert.equal(state.resumeAvailable, true);
  assert.equal(state.primaryBlockedByActiveLaunch, false);
});

test("blocks credential resume once the gateway is connected", () => {
  const state = resolveIbkrCredentialActionState({
    activationActive: true,
    activationId: "activation-1",
    directActivationShouldReplaceCurrentLaunch: false,
    gatewayConnected: true,
    launchInFlight: true,
    managementToken: "management-token-1",
  });

  assert.equal(state.launchCancelable, false);
  assert.equal(state.resumeAvailable, false);
  assert.equal(state.primaryBlockedByActiveLaunch, false);
});

test("auto-resumes typed credentials after the helper key was read but no envelope was posted", () => {
  assert.equal(
    shouldAutoResumeIbkrCredentials({
      activationId: "activation-1",
      attemptedActivationId: null,
      directActivationShouldReplaceCurrentLaunch: false,
      gatewayConnected: false,
      launchCancelInFlight: false,
      loginEnvelopeSubmitAttemptCount: 0,
      loginHandoffReady: true,
      loginKeyReadCount: 3,
      managementToken: "management-token-1",
      password: "password",
      runtimeActivationActive: true,
      username: " trader ",
    }),
    true,
  );
});

test("does not auto-resume after an envelope post has already reached Pyrus", () => {
  assert.equal(
    shouldAutoResumeIbkrCredentials({
      activationId: "activation-1",
      attemptedActivationId: null,
      gatewayConnected: false,
      loginEnvelopeSubmitAttemptCount: 1,
      loginHandoffReady: true,
      loginKeyReadCount: 3,
      managementToken: "management-token-1",
      password: "password",
      runtimeActivationActive: true,
      username: "trader",
    }),
    false,
  );
});

test("auto-resume is one-shot per activation", () => {
  assert.equal(
    shouldAutoResumeIbkrCredentials({
      activationId: "activation-1",
      attemptedActivationId: "activation-1",
      gatewayConnected: false,
      loginEnvelopeSubmitAttemptCount: 0,
      loginHandoffReady: true,
      loginKeyReadCount: 3,
      managementToken: "management-token-1",
      password: "password",
      runtimeActivationActive: true,
      username: "trader",
    }),
    false,
  );
});

test("clears the typed password after confirmed credential delivery", () => {
  assert.equal(
    shouldClearIbkrPasswordAfterCredentialSubmit({
      credentialsDelivered: true,
    }),
    true,
  );
});

test("retains the typed password when credential delivery does not complete", () => {
  assert.equal(
    shouldClearIbkrPasswordAfterCredentialSubmit({
      credentialsDelivered: false,
    }),
    false,
  );
});

test("clears the typed password for explicit non-retry terminal flows", () => {
  assert.equal(
    shouldClearIbkrPasswordAfterCredentialSubmit({
      clearPassword: true,
      credentialsDelivered: false,
    }),
    true,
  );
});
