import assert from "node:assert/strict";
import test from "node:test";

import { resolveIbkrCredentialActionState } from "./ibkrConnectionCredentialActionModel.js";

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
