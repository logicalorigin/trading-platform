import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveIbkrBridgeProcessActions,
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

test("does not offer credential resume for a stale activation after an API restart", () => {
  // Repro of the "stuck at waiting desktop" reconnect bug: the API process
  // restarted with the browser tab still open, so the client-only
  // `bridgeActivationActive` flag stayed set while the backend has no active
  // activation and the 10-min in-flight window has expired. Resume must NOT be
  // offered (it would deliver credentials to a dead activation and hang); the
  // submit must fall through to a fresh launch instead.
  const state = resolveIbkrCredentialActionState({
    activationActive: true, // stale client-only optimism, must be ignored
    activationId: "stale-activation",
    directActivationShouldReplaceCurrentLaunch: false,
    gatewayConnected: false,
    launchInFlight: false, // in-flight window expired
    managementToken: "stale-management-token",
    runtimeActivationActive: false, // backend has no live activation
  });

  assert.equal(state.resumeAvailable, false);
  assert.equal(state.launchCancelable, false);
  assert.equal(state.primaryBlockedByActiveLaunch, false);
});

test("bridge process actions do not expose deactivate for configured-only state", () => {
  const actions = resolveIbkrBridgeProcessActions({
    bridgeRuntimeOverrideActive: false,
    gatewayConnectedForBridge: false,
    runtime: {
      configured: true,
      bridgeUrlConfigured: true,
      connected: false,
    },
  });

  assert.equal(actions.deactivateAction, null);
  assert.equal(actions.cancelLaunchAction, null);
});

test("bridge process actions expose force-clear cleanup for an active override even without bridge proof", () => {
  // A stale/dead override (or one whose proof fields were stripped from the
  // session response) must still be clearable; otherwise the deactivate control
  // silently no-ops and the user is stranded with an un-clearable override.
  const actions = resolveIbkrBridgeProcessActions({
    bridgeRuntimeOverrideActive: true,
    bridgeManagementToken: null,
    gatewayConnectedForBridge: false,
    runtime: {
      runtimeOverrideActive: true,
      bridgeReachable: false,
      connected: false,
      authenticated: false,
    },
  });

  assert.equal(actions.deactivateAction?.mode, "detach-bridge");
  assert.equal(actions.deactivateAction?.label, "Detach bridge");
  assert.equal(actions.deactivateAction?.queueRemoteShutdown, false);
});

test("bridge process actions do not expose cleanup for an active override while a launch is in flight", () => {
  const actions = resolveIbkrBridgeProcessActions({
    bridgeRuntimeOverrideActive: true,
    bridgeManagementToken: null,
    bridgeLaunchInFlight: true,
    gatewayConnectedForBridge: false,
    runtime: { runtimeOverrideActive: true },
  });

  assert.equal(actions.deactivateAction, null);
});

test("bridge process actions expose detach label for reachable override without a management token", () => {
  const actions = resolveIbkrBridgeProcessActions({
    bridgeRuntimeOverrideActive: true,
    bridgeManagementToken: null,
    gatewayConnectedForBridge: false,
    runtime: {
      runtimeOverrideActive: true,
      bridgeReachable: true,
    },
  });

  assert.equal(actions.deactivateAction?.mode, "detach-bridge");
  assert.equal(actions.deactivateAction?.label, "Detach bridge");
  assert.equal(actions.deactivateAction?.queueRemoteShutdown, false);
});

test("bridge process actions expose managed deactivate only for a managed attached bridge", () => {
  const actions = resolveIbkrBridgeProcessActions({
    bridgeManagementToken: "management-token-1",
    bridgeRuntimeOverrideActive: true,
    gatewayConnectedForBridge: true,
    runtime: {
      runtimeOverrideActive: true,
      bridgeReachable: true,
      connected: true,
    },
  });

  assert.equal(actions.deactivateAction?.mode, "managed-teardown");
  assert.equal(actions.deactivateAction?.label, "Deactivate");
  assert.equal(actions.deactivateAction?.queueRemoteShutdown, true);
});

test("bridge process actions hide managed deactivate while launch cancel owns the process", () => {
  const actions = resolveIbkrBridgeProcessActions({
    bridgeLaunchCancelable: true,
    bridgeLaunchInFlight: true,
    bridgeManagementToken: "management-token-1",
    bridgeRuntimeOverrideActive: true,
    gatewayConnectedForBridge: false,
  });

  assert.equal(actions.deactivateAction, null);
  assert.equal(actions.cancelLaunchAction?.mode, "cancel-launch");
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
      loginEnvelopeSubmitted: false,
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

test("auto-resumes typed credentials when helper key is ready but unread", () => {
  assert.equal(
    shouldAutoResumeIbkrCredentials({
      activationId: "activation-1",
      attemptedActivationId: null,
      directActivationShouldReplaceCurrentLaunch: false,
      gatewayConnected: false,
      launchCancelInFlight: false,
      loginEnvelopeSubmitAttemptCount: 0,
      loginEnvelopeSubmitted: false,
      loginHandoffReady: true,
      loginKeyReadCount: 0,
      managementToken: "management-token-1",
      password: "password",
      runtimeActivationActive: true,
      username: "trader",
    }),
    true,
  );
});

test("auto-resumes typed credentials after a failed envelope attempt was not accepted", () => {
  assert.equal(
    shouldAutoResumeIbkrCredentials({
      activationId: "activation-1",
      attemptedActivationId: null,
      gatewayConnected: false,
      loginEnvelopeSubmitAttemptCount: 1,
      loginEnvelopeSubmitted: false,
      loginHandoffReady: true,
      loginKeyReadCount: 1,
      managementToken: "management-token-1",
      password: "password",
      runtimeActivationActive: true,
      username: "trader",
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
      loginEnvelopeSubmitted: true,
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
      loginEnvelopeSubmitted: false,
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
