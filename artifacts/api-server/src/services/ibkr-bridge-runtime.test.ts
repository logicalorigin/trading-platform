import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import {
  cancelLegacyIbkrBridgeActivation,
  claimIbkrRemoteDesktopLaunchJob,
  claimIbkrRemoteDesktopLaunchJobWithWait,
  claimLegacyIbkrBridgeLoginEnvelope,
  completeLegacyIbkrBridgeHelperUpdate,
  createIbkrRemoteBridgeLaunch,
  getIbkrBridgeActivationDiagnostics,
  getIbkrBridgeLauncher,
  getIbkrBridgeRuntimeSessionState,
  heartbeatIbkrRemoteDesktop,
  readLegacyIbkrBridgeLoginKey,
  readLegacyIbkrBridgeActivationStatus,
  recordLegacyIbkrBridgeActivationProgress,
  registerIbkrRemoteDesktop,
  submitLegacyIbkrBridgeLoginEnvelope,
  submitLegacyIbkrBridgeLoginKey,
} from "./ibkr-bridge-runtime";

const testDataDir = mkdtempSync(join(tmpdir(), "pyrus-ibkr-runtime-"));
process.env["PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE"] = join(
  testDataDir,
  "remote-desktops.json",
);

after(() => {
  rmSync(testDataDir, { force: true, recursive: true });
  delete process.env["PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE"];
});

function readCallbackSecret(launchUrl: string): string {
  const value = new URL(launchUrl).searchParams.get("callbackSecret");
  assert(value, "launcher URL should include a callback secret");
  return value;
}

test("canceled IBKR activations reject later helper progress without overwriting cancel state", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const callbackSecret = readCallbackSecret(launcher.launchUrl);

  recordLegacyIbkrBridgeActivationProgress(launcher.activationId, {
    callbackSecret,
    message: "Helper launch requested.",
    status: "starting_bridge",
    step: "helper_launch_requested",
  });

  cancelLegacyIbkrBridgeActivation(launcher.activationId, {
    managementToken: launcher.managementToken,
  });

  assert.throws(
    () =>
      recordLegacyIbkrBridgeActivationProgress(launcher.activationId, {
        callbackSecret,
        message: "Late helper progress after cancellation.",
        status: "starting_bridge",
        step: "post_cancel_probe",
      }),
    (error) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ibkr_bridge_activation_canceled",
      ),
  );

  const status = readLegacyIbkrBridgeActivationStatus(launcher.activationId, {
    managementToken: launcher.managementToken,
  });

  assert.equal(status.canceled, true);
  assert.equal(status.latestProgress?.step, "cancel_requested");
  assert.equal(status.recentProgress.at(-1)?.step, "cancel_requested");
  assert.equal(
    status.recentProgress.some((event) => event.step === "post_cancel_probe"),
    false,
  );
});

test("remote launch queues to a registered desktop even when its helper heartbeat is stale", () => {
  const pairingLauncher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const desktopId = "desktop-stale-home";
  const desktopSecret = "desktop-stale-home-secret-123456";

  const registration = registerIbkrRemoteDesktop({
    activationId: pairingLauncher.activationId,
    callbackSecret: readCallbackSecret(pairingLauncher.launchUrl),
    desktopId,
    desktopSecret,
    helperVersion: "2026-06-04.ib-async-sidecar-v6-fast-agent",
    label: "Home Windows",
  });

  assert.equal(registration.desktop.desktopId, desktopId);
  assert.equal(
    registration.helperVersion,
    "2026-06-04.ib-async-sidecar-v6-fast-agent",
  );
  assert.equal(registration.helperUpdateRequired, true);
  assert.equal(registration.desktop.online, false);
  assert.equal(registration.desktop.helperCompatibility, "known_bad");
  const runtimeState = getIbkrBridgeRuntimeSessionState();
  assert.equal(runtimeState.desktopAgentRegistered, true);
  assert.equal(runtimeState.desktopAgentRegisteredCount, 1);
  assert.equal(runtimeState.desktopAgentOnline, false);
  assert.equal(
    runtimeState.desktopAgentHelperVersion,
    "2026-06-04.ib-async-sidecar-v6-fast-agent",
  );
  assert.equal(runtimeState.desktopAgentCompatibility, "known_bad");
  assert.equal(runtimeState.desktopAgentCompatible, false);
  assert.equal(runtimeState.desktopAgentKnownBad, true);
  assert.equal(runtimeState.desktopAgentUpgradeRequired, true);

  const launcher = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.test",
    body: { autoLogin: true },
    bundleUrl: null,
  });

  assert.equal(launcher.remoteLaunch.desktop.desktopId, desktopId);
  assert.equal(launcher.remoteLaunch.desktop.online, false);
  assert.equal(
    readLegacyIbkrBridgeActivationStatus(launcher.activationId, {
      managementToken: launcher.managementToken,
    }).latestProgress?.step,
    "queued_on_pyrus",
  );

  const claim = claimIbkrRemoteDesktopLaunchJob({
    desktopId,
    desktopSecret,
    helperVersion: "2026-06-04.ib-async-sidecar-v6-fast-agent",
  });

  assert.equal(claim.ready, true);
  assert.equal(claim.action, "launch");
  assert.equal(claim.activationId, launcher.activationId);
  assert.equal(claim.helperVersion, launcher.helperVersion);
  assert.equal(claim.jobId, launcher.remoteLaunch.jobId);
  assert.equal(
    new URL(claim.launchUrl).searchParams.get("helperVersion"),
    launcher.helperVersion,
  );
  assert.equal(
    new URL(claim.launchUrl).searchParams.get("desktopAgentLaunch"),
    "1",
  );
  assert.equal(
    readLegacyIbkrBridgeActivationStatus(launcher.activationId, {
      managementToken: launcher.managementToken,
    }).latestProgress?.step,
    "helper_launch_requested",
  );
});

test("remote helper update-only launch uses an update-only protocol URL", () => {
  const pairingLauncher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const desktopId = "desktop-update-only-home";
  const desktopSecret = "desktop-update-only-home-secret-123456";

  registerIbkrRemoteDesktop({
    activationId: pairingLauncher.activationId,
    callbackSecret: readCallbackSecret(pairingLauncher.launchUrl),
    desktopId,
    desktopSecret,
    helperVersion: pairingLauncher.helperVersion,
    label: "Home Windows",
  });

  const launch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.test",
    body: { autoLogin: false, desktopId, helperUpdateOnly: true },
    bundleUrl: null,
  });
  const claim = claimIbkrRemoteDesktopLaunchJob({
    desktopId,
    desktopSecret,
    helperVersion: pairingLauncher.helperVersion,
  });

  assert.equal(claim.ready, true);
  assert.equal(claim.action, "launch");
  if (claim.action !== "launch") {
    throw new Error("expected launch job");
  }
  assert.equal(claim.activationId, launch.activationId);
  assert.equal(new URL(claim.launchUrl).searchParams.get("helperUpdateOnly"), "1");
  assert.equal(new URL(claim.launchUrl).searchParams.get("autoLogin"), null);
});

test("helper update-only completion clears the active activation", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const callbackSecret = readCallbackSecret(launcher.launchUrl);

  const result = completeLegacyIbkrBridgeHelperUpdate(launcher.activationId, {
    callbackSecret,
  });
  const diagnostics = getIbkrBridgeActivationDiagnostics();

  assert.deepEqual(result, { completed: true, ok: true });
  assert.equal(diagnostics.activeCount, 0);
  assert.equal(diagnostics.latestActivation?.canceled, true);
  assert.equal(diagnostics.latestProgress?.step, "helper_update_completed");
});

test("desktop idle polling returns helper update hints", () => {
  const pairingLauncher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const desktopId = "desktop-idle-update-home";
  const desktopSecret = "desktop-idle-update-home-secret-123456";
  const oldHelperVersion = "2026-06-04.ib-async-sidecar-v8-foreground-guard";

  const registration = registerIbkrRemoteDesktop({
    activationId: pairingLauncher.activationId,
    callbackSecret: readCallbackSecret(pairingLauncher.launchUrl),
    desktopId,
    desktopSecret,
    helperVersion: oldHelperVersion,
    label: "Home Windows",
  });
  assert.equal(registration.helperVersion, oldHelperVersion);
  assert.equal(registration.targetHelperVersion, pairingLauncher.helperVersion);
  assert.equal(registration.helperUpdateRequired, true);

  const heartbeat = heartbeatIbkrRemoteDesktop({
    desktopId,
    desktopSecret,
    helperVersion: oldHelperVersion,
    label: "Home Windows",
  });
  assert.equal(heartbeat.helperVersion, oldHelperVersion);
  assert.equal(heartbeat.targetHelperVersion, pairingLauncher.helperVersion);
  assert.equal(heartbeat.helperUpdateRequired, true);

  const emptyClaim = claimIbkrRemoteDesktopLaunchJob({
    desktopId,
    desktopSecret,
    helperVersion: oldHelperVersion,
  });
  assert.equal(emptyClaim.ready, false);
  assert.equal(emptyClaim.helperVersion, oldHelperVersion);
  assert.equal(emptyClaim.targetHelperVersion, pairingLauncher.helperVersion);
  assert.equal(emptyClaim.helperUpdateRequired, true);
});

test("stale desktop helper claim with wait returns update hint without long-polling", async () => {
  const pairingLauncher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const desktopId = "desktop-stale-wait-home";
  const desktopSecret = "desktop-stale-wait-home-secret-123456";
  const oldHelperVersion = "2026-06-09.ib-async-sidecar-v15-graceful-deactivate";

  registerIbkrRemoteDesktop({
    activationId: pairingLauncher.activationId,
    callbackSecret: readCallbackSecret(pairingLauncher.launchUrl),
    desktopId,
    desktopSecret,
    helperVersion: oldHelperVersion,
    label: "Home Windows",
  });

  const startedAt = Date.now();
  const claim = await claimIbkrRemoteDesktopLaunchJobWithWait({
    desktopId,
    desktopSecret,
    helperVersion: oldHelperVersion,
    waitMs: 5_000,
  });

  assert.equal(claim.ready, false);
  assert.equal(claim.helperUpdateRequired, true);
  assert.equal(claim.targetHelperVersion, pairingLauncher.helperVersion);
  assert.ok(Date.now() - startedAt < 500);
});

test("desktop heartbeat persists helper heartbeat evidence", () => {
  const pairingLauncher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const desktopId = "desktop-heartbeat-home";
  const desktopSecret = "desktop-heartbeat-home-secret-123456";

  registerIbkrRemoteDesktop({
    activationId: pairingLauncher.activationId,
    callbackSecret: readCallbackSecret(pairingLauncher.launchUrl),
    desktopId,
    desktopSecret,
    helperVersion: "2026-06-04.ib-async-sidecar-v8-foreground-guard",
    label: "Home Windows",
  });

  const heartbeat = heartbeatIbkrRemoteDesktop({
    desktopId,
    desktopSecret,
    helperVersion: pairingLauncher.helperVersion,
    label: "Home Windows",
  });

  assert.equal(heartbeat.desktop.online, true);
  assert.equal(heartbeat.desktop.helperCompatibility, "compatible");

  const persisted = JSON.parse(
    readFileSync(
      process.env["PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE"] || "",
      "utf8",
    ),
  );
  const desktop = persisted.desktops.find(
    (item: { desktopId?: string }) => item.desktopId === desktopId,
  );
  assert.ok(desktop);
  assert.equal(desktop.helperVersion, heartbeat.helperVersion);
  assert.ok(desktop.lastHeartbeatAt);
  assert.ok(desktop.helperHeartbeatAtByVersion[heartbeat.helperVersion]);
});

test("credential handoff records key publish, key read, and envelope receipt progress", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const callbackSecret = readCallbackSecret(launcher.launchUrl);

  submitLegacyIbkrBridgeLoginKey(launcher.activationId, {
    algorithm: "RSA-OAEP-256-CHUNKED",
    callbackSecret,
    helperInstanceId: "helper-instance-1",
    publicKeyJwk: { kty: "RSA", n: "test", e: "AQAB" },
  });

  assert.equal(
    readLegacyIbkrBridgeActivationStatus(launcher.activationId, {
      managementToken: launcher.managementToken,
    }).latestProgress?.step,
    "credential_key_published",
  );

  const key = readLegacyIbkrBridgeLoginKey(launcher.activationId, {
    managementToken: launcher.managementToken,
  });
  assert.equal(key.ready, true);

  assert.equal(
    readLegacyIbkrBridgeActivationStatus(launcher.activationId, {
      managementToken: launcher.managementToken,
    }).latestProgress?.step,
    "credential_key_read",
  );

  submitLegacyIbkrBridgeLoginEnvelope(launcher.activationId, {
    algorithm: "RSA-OAEP-256-CHUNKED",
    ciphertextChunks: ["encrypted"],
    helperInstanceId: "helper-instance-1",
    managementToken: launcher.managementToken,
  });

  const status = readLegacyIbkrBridgeActivationStatus(launcher.activationId, {
    managementToken: launcher.managementToken,
  });
  assert.deepEqual(
    status.recentProgress.map((event) => event.step),
    [
      "credential_key_published",
      "credential_key_read",
      "credentials_received",
    ],
  );
});

test("credential envelope submission is idempotent after server acceptance", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const callbackSecret = readCallbackSecret(launcher.launchUrl);

  submitLegacyIbkrBridgeLoginKey(launcher.activationId, {
    algorithm: "RSA-OAEP-256-CHUNKED",
    callbackSecret,
    helperInstanceId: "helper-instance-idempotent",
    publicKeyJwk: { kty: "RSA", n: "test", e: "AQAB" },
  });

  const firstSubmit = submitLegacyIbkrBridgeLoginEnvelope(launcher.activationId, {
    algorithm: "RSA-OAEP-256-CHUNKED",
    ciphertextChunks: ["encrypted"],
    helperInstanceId: "helper-instance-idempotent",
    managementToken: launcher.managementToken,
  });
  assert.deepEqual(firstSubmit, { ok: true });

  const duplicateSubmit = submitLegacyIbkrBridgeLoginEnvelope(
    launcher.activationId,
    {
      algorithm: "RSA-OAEP-256-CHUNKED",
      ciphertextChunks: ["encrypted"],
      helperInstanceId: "helper-instance-idempotent",
      managementToken: launcher.managementToken,
    },
  );
  assert.equal(duplicateSubmit.ok, true);

  const claim = claimLegacyIbkrBridgeLoginEnvelope(launcher.activationId, {
    callbackSecret,
    helperInstanceId: "helper-instance-idempotent",
  });
  assert.equal(claim.ready, true);

  const postClaimSubmit = submitLegacyIbkrBridgeLoginEnvelope(
    launcher.activationId,
    {
      algorithm: "RSA-OAEP-256-CHUNKED",
      ciphertextChunks: ["encrypted"],
      helperInstanceId: "helper-instance-idempotent",
      managementToken: launcher.managementToken,
    },
  );
  assert.equal(postClaimSubmit.ok, true);

  const diagnostics = getIbkrBridgeActivationDiagnostics();
  assert.equal(diagnostics.latestActivation?.loginEnvelopeSubmitted, true);
  assert.ok(diagnostics.latestActivation?.loginEnvelopeSubmittedAt);
  assert.equal(
    diagnostics.latestActivation?.loginEnvelopeSubmitAttemptCount,
    3,
  );
  assert.equal(
    diagnostics.latestActivation?.lastLoginEnvelopeSubmitErrorCode,
    null,
  );
});

test("claimed login envelope can be re-claimed by the same helper within the window", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });
  const callbackSecret = readCallbackSecret(launcher.launchUrl);

  submitLegacyIbkrBridgeLoginKey(launcher.activationId, {
    algorithm: "RSA-OAEP-256-CHUNKED",
    callbackSecret,
    helperInstanceId: "helper-reclaim",
    publicKeyJwk: { kty: "RSA", n: "test", e: "AQAB" },
  });

  submitLegacyIbkrBridgeLoginEnvelope(launcher.activationId, {
    algorithm: "RSA-OAEP-256-CHUNKED",
    ciphertextChunks: ["chunk-a", "chunk-b"],
    helperInstanceId: "helper-reclaim",
    managementToken: launcher.managementToken,
  });

  const firstClaim = claimLegacyIbkrBridgeLoginEnvelope(launcher.activationId, {
    callbackSecret,
    helperInstanceId: "helper-reclaim",
  });
  assert.equal(firstClaim.ready, true);
  assert.deepEqual(firstClaim.envelope?.ciphertextChunks, ["chunk-a", "chunk-b"]);

  // A helper that claimed but failed to deliver the credentials to IB Gateway
  // can re-claim the same envelope and retry. Before the fix, the one-time
  // handoff was consumed on first claim (ready:false on re-claim), stranding the
  // activation with no recovery path short of a brand-new activation.
  const reclaim = claimLegacyIbkrBridgeLoginEnvelope(launcher.activationId, {
    callbackSecret,
    helperInstanceId: "helper-reclaim",
  });
  assert.equal(reclaim.ready, true);
  assert.deepEqual(reclaim.envelope?.ciphertextChunks, ["chunk-a", "chunk-b"]);

  // The first claim timestamp is preserved as the two-factor phase anchor.
  const diagnostics = getIbkrBridgeActivationDiagnostics();
  assert.ok(diagnostics.latestActivation?.timings.loginEnvelopeClaimedAt);
});

test("a launch that never attaches is failed after the hard non-terminal window", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.test",
    bundleUrl: null,
  });

  const beforePrune = getIbkrBridgeActivationDiagnostics();
  assert.equal(beforePrune.latestActivationId, launcher.activationId);
  assert.equal(beforePrune.latestActivation?.canceled, false);

  // Advance past the 10-minute hard non-terminal window. A successful attach
  // deletes the activation, so a never-attached launch must be marked failed
  // here instead of lingering active for the full TTL.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60_000;
    const afterPrune = getIbkrBridgeActivationDiagnostics();
    assert.equal(afterPrune.activeCount, 0);
    assert.equal(afterPrune.latestActivation?.canceled, true);
    assert.equal(afterPrune.latestProgress?.step, "error");
  } finally {
    Date.now = realNow;
  }
});
