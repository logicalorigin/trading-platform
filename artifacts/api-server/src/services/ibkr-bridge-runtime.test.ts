import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";
import {
  attachLegacyIbkrBridgeRuntime,
  attachIbkrBridgeRuntime,
  cancelLegacyIbkrBridgeActivation,
  claimLegacyIbkrBridgeLoginEnvelope,
  claimIbkrRemoteDesktopLaunchJob,
  completeIbkrRemoteDesktopJob,
  createIbkrRemoteBridgeLaunch,
  createIbkrRemoteBridgeShutdown,
  detachIbkrBridgeRuntime,
  getIbkrBridgeActivationDiagnostics,
  getIbkrBridgeLauncher,
  heartbeatIbkrRemoteDesktop,
  listIbkrRemoteDesktops,
  readIbkrRemoteDesktopJobStatus,
  readLegacyIbkrBridgeActivationStatus,
  readLegacyIbkrBridgeLoginKey,
  recordLegacyIbkrBridgeActivationProgress,
  registerIbkrRemoteDesktop,
  resetIbkrBridgeRuntimeStateForTests,
  submitLegacyIbkrBridgeLoginEnvelope,
  submitLegacyIbkrBridgeLoginKey,
} from "./ibkr-bridge-runtime";
import {
  getIbkrBridgeRuntimeConfig,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import { getBridgeHealthForSession } from "./platform-bridge-health";

const originalFetch = globalThis.fetch;
const previousRuntimeOverrideFile =
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
const previousRemoteDesktopsFile =
  process.env["IBKR_BRIDGE_REMOTE_DESKTOPS_FILE"];
const previousBridgeUrl = process.env["IBKR_BRIDGE_URL"];
const previousBridgeToken = process.env["IBKR_BRIDGE_API_TOKEN"];
const runtimeOverrideDir = mkdtempSync(
  join(tmpdir(), "rayalgo-bridge-runtime-test-"),
);
process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
  runtimeOverrideDir,
  "runtime.json",
);
process.env["IBKR_BRIDGE_REMOTE_DESKTOPS_FILE"] = join(
  runtimeOverrideDir,
  "remote-desktops.json",
);

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetIbkrBridgeRuntimeStateForTests();
  restoreEnv("IBKR_BRIDGE_URL", previousBridgeUrl);
  restoreEnv("IBKR_BRIDGE_API_TOKEN", previousBridgeToken);
});

test.after(() => {
  resetIbkrBridgeRuntimeStateForTests();
  rmSync(runtimeOverrideDir, { recursive: true, force: true });
  restoreEnv("IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE", previousRuntimeOverrideFile);
  restoreEnv("IBKR_BRIDGE_REMOTE_DESKTOPS_FILE", previousRemoteDesktopsFile);
  restoreEnv("IBKR_BRIDGE_URL", previousBridgeUrl);
  restoreEnv("IBKR_BRIDGE_API_TOKEN", previousBridgeToken);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function installBridgeFetchStub(expectedToken?: string): void {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const authorization =
      init?.headers &&
      typeof init.headers === "object" &&
      "Authorization" in init.headers
        ? String((init.headers as Record<string, unknown>)["Authorization"])
        : "";

    if (expectedToken) {
      assert.equal(authorization, `Bearer ${expectedToken}`);
    }

    if (url.endsWith("/healthz")) {
      return new Response(
        JSON.stringify({
          connected: true,
          authenticated: true,
          competing: false,
          accountsLoaded: true,
          accounts: ["DU123"],
          configuredLiveMarketDataMode: true,
          liveMarketDataAvailable: true,
          marketDataMode: "live",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (url.endsWith("/accounts")) {
      return new Response(JSON.stringify({ accounts: ["DU123"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  };
}

test("IBKR bridge launcher returns only the one-click protocol contract", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com/api/ignored?x=1",
  });

  assert.equal(launcher.apiBaseUrl, "https://pyrus.example.com");
  assert.equal(
    launcher.helperUrl,
    "https://pyrus.example.com/api/ibkr/bridge/helper.ps1",
  );
  assert.equal(
    launcher.bundleUrl,
    "https://pyrus.example.com/api/ibkr/bridge/bundle.tar.gz",
  );
  assert.equal("command" in launcher, false);
  assert.equal("helperInstallCommand" in launcher, false);
  assert.equal("installerUrl" in launcher, false);
  assert.match(launcher.launchUrl, /^rayalgo-ibkr:\/\/launch\?/);
  const launchParams = new URL(launcher.launchUrl).searchParams;
  assert.equal(launcher.activationId, launchParams.get("activationId"));
  assert.equal(
    launcher.helperVersion,
    "2026-05-20.remote-desktop-agent-v19",
  );
  assert.equal(launcher.autoLoginSupported, true);
  assert.equal(launcher.autoLoginConfigured, null);
  assert.equal(launcher.autoLoginMode, "ib-gateway-live");
  assert.match(launcher.autoLoginLaunchUrl, /^rayalgo-ibkr:\/\/launch\?/);
  assert.equal(launcher.credentialHandoff.mode, "ui-onetime");
  assert.equal(launcher.credentialHandoff.algorithm, "RSA-OAEP-256-CHUNKED");
  assert.match(launchParams.get("activationId") ?? "", /^[a-f0-9]{32}$/);
  assert.match(launchParams.get("callbackSecret") ?? "", /^[a-f0-9]{64}$/);
  assert.equal(launchParams.get("apiBaseUrl"), "https://pyrus.example.com");
  assert.equal(launchParams.get("bridgeToken"), launcher.bridgeToken);
  assert.equal(launchParams.get("managementToken"), launcher.managementToken);
  assert.equal(
    launchParams.get("helperUrl"),
    "https://pyrus.example.com/api/ibkr/bridge/helper.ps1",
  );
  assert.equal(launchParams.get("helperVersion"), launcher.helperVersion);
  assert.equal(launchParams.get("requiredCapability"), "bridgeBundle");
  assert.equal(launchParams.has("forceFreshTunnel"), false);
  assert.equal(
    launchParams.get("bundleUrl"),
    "https://pyrus.example.com/api/ibkr/bridge/bundle.tar.gz",
  );

  const autoLoginParams = new URL(launcher.autoLoginLaunchUrl).searchParams;
  assert.equal(autoLoginParams.get("activationId"), launcher.activationId);
  assert.equal(autoLoginParams.get("autoLogin"), "1");
  assert.equal(autoLoginParams.get("autoLoginMode"), "ib-gateway-live");
  assert.equal(autoLoginParams.get("loginMode"), "ui-onetime");
  for (const url of [
    launcher.launchUrl,
    launcher.autoLoginLaunchUrl,
  ]) {
    assert.doesNotMatch(url, /username|password|IbLoginId|IbPassword/i);
  }
});

test("IBKR bridge launcher can omit the bundle URL for repo-build fallback", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
    bundleUrl: null,
  });

  const launchParams = new URL(launcher.launchUrl).searchParams;
  assert.equal(launcher.bundleUrl, null);
  assert.equal(launchParams.has("bundleUrl"), false);
  assert.equal(launchParams.has("requiredCapability"), false);
});

test("IBKR remote desktop launch queues the same one-time launch for the paired desktop", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  const pairingActivationId = pairingParams.get("activationId");
  const pairingCallbackSecret = pairingParams.get("callbackSecret");
  assert.ok(pairingActivationId);
  assert.ok(pairingCallbackSecret);

  const registered = registerIbkrRemoteDesktop({
    activationId: pairingActivationId,
    callbackSecret: pairingCallbackSecret,
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  assert.equal(registered.ok, true);
  assert.equal(registered.desktop.online, false);
  assert.equal(listIbkrRemoteDesktops().onlineCount, 0);

  const heartbeat = heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.desktop.online, true);
  assert.equal(heartbeat.pendingJobCount, 0);
  assert.equal(listIbkrRemoteDesktops().onlineCount, 1);

  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com/api/ignored",
    body: { autoLogin: true },
  });
  assert.equal(remoteLaunch.apiBaseUrl, "https://pyrus.example.com");
  assert.equal(remoteLaunch.remoteLaunch.mode, "desktop-agent");
  assert.equal(remoteLaunch.remoteLaunch.desktop.desktopId, "desktop-win-main");

  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });
  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected a launch job claim.");
  }
  assert.equal(claimed.activationId, remoteLaunch.activationId);
  assert.equal(claimed.launchUrl, remoteLaunch.autoLoginLaunchUrl);

  const claimAgain = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
  });
  assert.deepEqual(claimAgain, {
    helperVersion: pairing.helperVersion,
    ready: false,
  });
});

test("IBKR remote desktop launch can queue a non-auto-login helper launch", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });

  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: false },
  });
  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });

  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected a launch job claim.");
  }
  assert.equal(claimed.launchUrl, remoteLaunch.launchUrl);
  assert.notEqual(claimed.launchUrl, remoteLaunch.autoLoginLaunchUrl);
});

test("IBKR remote desktop shutdown queues a shutdown job for the paired desktop", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });

  const queued = createIbkrRemoteBridgeShutdown({
    apiBaseUrl: "https://pyrus.example.com/api/ignored",
    body: { force: true },
  });
  assert.equal(queued.shutdown.action, "shutdown");
  assert.equal(queued.shutdown.desktop.desktopId, "desktop-win-main");
  assert.match(queued.shutdown.statusToken, /^[a-f0-9]{64}$/);
  assert.equal(
    readIbkrRemoteDesktopJobStatus({
      jobId: queued.shutdown.jobId,
      statusToken: queued.shutdown.statusToken,
    }).state,
    "queued",
  );

  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });
  if (!claimed.ready || claimed.action !== "shutdown") {
    assert.fail("Expected a shutdown job claim.");
  }
  assert.equal(claimed.expiresAt, queued.shutdown.expiresAt);
  assert.equal(claimed.helperVersion, pairing.helperVersion);
  assert.equal(claimed.jobId, queued.shutdown.jobId);
  assert.match(claimed.completionToken ?? "", /^[a-f0-9]{64}$/);
  const launchParams = new URL(claimed.launchUrl).searchParams;
  assert.equal(launchParams.get("apiBaseUrl"), "https://pyrus.example.com");
  assert.equal(
    launchParams.get("helperUrl"),
    "https://pyrus.example.com/api/ibkr/bridge/helper.ps1",
  );
  assert.equal(launchParams.get("helperVersion"), pairing.helperVersion);
  assert.equal(launchParams.get("jobId"), queued.shutdown.jobId);
  assert.equal(launchParams.get("completionToken"), claimed.completionToken);
  assert.equal(launchParams.get("shutdown"), "1");
  assert.equal(
    readIbkrRemoteDesktopJobStatus({
      jobId: queued.shutdown.jobId,
      statusToken: queued.shutdown.statusToken,
    }).state,
    "claimed",
  );
  assert.equal(
    completeIbkrRemoteDesktopJob({
      jobId: queued.shutdown.jobId,
      completionToken: claimed.completionToken,
      ok: true,
      message: "stopped",
    }).state,
    "completed",
  );
  assert.equal(
    readIbkrRemoteDesktopJobStatus({
      jobId: queued.shutdown.jobId,
      statusToken: queued.shutdown.statusToken,
    }).state,
    "completed",
  );
  assert.throws(() => {
    completeIbkrRemoteDesktopJob({
      jobId: queued.shutdown.jobId,
      completionToken: "wrong",
      ok: true,
    });
  }, /completion token is invalid/);
});

test("IBKR remote desktop shutdown gives outdated helpers a self-update launch URL", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v17",
    label: "TRADING-PC\\Riley",
  });

  const queued = createIbkrRemoteBridgeShutdown({
    apiBaseUrl: "https://pyrus.example.com",
    body: { force: true },
  });
  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v17",
  });

  if (!claimed.ready || claimed.action !== "shutdown") {
    assert.fail("Expected a shutdown job claim.");
  }
  assert.equal(claimed.jobId, queued.shutdown.jobId);
  assert.match(claimed.launchUrl, /^rayalgo-ibkr:\/\/launch\?/);
  assert.match(claimed.launchUrl, /shutdown=1/);
  assert.match(claimed.launchUrl, /helperVersion=2026-05-20\.remote-desktop-agent-v19/);
  assert.match(claimed.launchUrl, /jobId=/);
  assert.match(claimed.launchUrl, /completionToken=/);
});

test("IBKR remote desktop launch requires a paired online desktop", () => {
  assert.throws(
    () =>
      createIbkrRemoteBridgeLaunch({
        apiBaseUrl: "https://pyrus.example.com",
      }),
    /No paired Windows desktop agent is online/,
  );

  assert.throws(
    () =>
      registerIbkrRemoteDesktop({
        desktopId: "desktop-unpaired",
        desktopSecret: "s".repeat(64),
        helperVersion: "test",
      }),
    /must be paired/,
  );
});

test("IBKR remote desktop launch does not queue to a paired desktop without a polling heartbeat", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });

  assert.equal(listIbkrRemoteDesktops().onlineCount, 0);
  assert.throws(
    () =>
      createIbkrRemoteBridgeLaunch({
        apiBaseUrl: "https://pyrus.example.com",
      }),
    /No paired Windows desktop agent is online/,
  );
});

test("IBKR bridge login handoff stores only encrypted credential chunks", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.autoLoginLaunchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);

  assert.deepEqual(
    readLegacyIbkrBridgeLoginKey(activationId, {
      managementToken: launcher.managementToken,
    }),
    { ready: false },
  );

  assert.deepEqual(
    submitLegacyIbkrBridgeLoginKey(activationId, {
      callbackSecret,
      helperInstanceId: "helper-1",
      algorithm: "RSA-OAEP-256-CHUNKED",
      publicKeyJwk: {
        kty: "RSA",
        n: "modulus",
        e: "AQAB",
      },
    }),
    { ok: true },
  );

  const keyResult = readLegacyIbkrBridgeLoginKey(activationId, {
    managementToken: launcher.managementToken,
  });
  assert.equal(keyResult.ready, true);
  assert.equal(keyResult.ready && keyResult.helperInstanceId, "helper-1");

  assert.deepEqual(
    submitLegacyIbkrBridgeLoginEnvelope(activationId, {
      managementToken: launcher.managementToken,
      helperInstanceId: "helper-1",
      algorithm: "RSA-OAEP-256-CHUNKED",
      ciphertextChunks: ["encrypted-chunk-1", "encrypted-chunk-2"],
    }),
    { ok: true },
  );

  const claimed = claimLegacyIbkrBridgeLoginEnvelope(activationId, {
    callbackSecret,
    helperInstanceId: "helper-1",
  });
  assert.deepEqual(claimed, {
    envelope: {
      algorithm: "RSA-OAEP-256-CHUNKED",
      ciphertextChunks: ["encrypted-chunk-1", "encrypted-chunk-2"],
    },
    ready: true,
  });
  assert.deepEqual(
    claimLegacyIbkrBridgeLoginEnvelope(activationId, {
      callbackSecret,
      helperInstanceId: "helper-1",
    }),
    { ready: false },
  );
});

test("IBKR bridge login handoff requires the browser management token", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.autoLoginLaunchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);

  submitLegacyIbkrBridgeLoginKey(activationId, {
    callbackSecret,
    helperInstanceId: "helper-1",
    algorithm: "RSA-OAEP-256-CHUNKED",
    publicKeyJwk: {
      kty: "RSA",
      n: "modulus",
      e: "AQAB",
    },
  });

  assert.throws(
    () =>
      readLegacyIbkrBridgeLoginKey(activationId, {
        managementToken: "wrong-token",
      }),
    /management token is invalid/,
  );
  assert.throws(
    () =>
      submitLegacyIbkrBridgeLoginEnvelope(activationId, {
        managementToken: launcher.managementToken,
        helperInstanceId: "helper-2",
        algorithm: "RSA-OAEP-256-CHUNKED",
        ciphertextChunks: ["encrypted"],
      }),
    /handoff helper changed/,
  );
});

test("IBKR bridge activation cancellation stops helper credential polling", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.autoLoginLaunchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);

  const initialStatus = readLegacyIbkrBridgeActivationStatus(activationId, {
    callbackSecret,
  });
  assert.equal(initialStatus.active, true);
  assert.equal(initialStatus.canceled, false);
  assert.match(initialStatus.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    readLegacyIbkrBridgeActivationStatus(activationId, {
      managementToken: launcher.managementToken,
    }).active,
    true,
  );

  assert.deepEqual(
    cancelLegacyIbkrBridgeActivation(activationId, {
      managementToken: launcher.managementToken,
    }),
    { ok: true, canceled: true },
  );

  const status = readLegacyIbkrBridgeActivationStatus(activationId, {
    callbackSecret,
  });
  assert.equal(status.active, true);
  assert.equal(status.canceled, true);

  assert.deepEqual(
    claimLegacyIbkrBridgeLoginEnvelope(activationId, {
      callbackSecret,
      helperInstanceId: "helper-1",
    }),
    { ready: false, canceled: true },
  );
});

test("legacy IBKR bridge activation callbacks attach the runtime", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);
  installBridgeFetchStub(launcher.bridgeToken);

  assert.deepEqual(
    recordLegacyIbkrBridgeActivationProgress(activationId, {
      callbackSecret,
      status: "starting_bridge",
      step: "local_bridge_ready",
      message: "ready",
    }),
    { ok: true },
  );

  const attached = await attachLegacyIbkrBridgeRuntime(activationId, {
    callbackSecret,
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken: launcher.bridgeToken,
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: launcher.bridgeToken,
  });
});

test("legacy IBKR bridge activation accepts the helper persisted bridge token", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);
  const persistedBridgeToken = "p".repeat(64);
  installBridgeFetchStub(persistedBridgeToken);

  const attached = await attachLegacyIbkrBridgeRuntime(activationId, {
    callbackSecret,
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken: persistedBridgeToken,
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: persistedBridgeToken,
  });
  assert.equal(getIbkrBridgeActivationDiagnostics().activeCount, 0);
});

test("legacy IBKR bridge activation progress is available for diagnostics", () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);

  recordLegacyIbkrBridgeActivationProgress(activationId, {
    callbackSecret,
    status: "starting_bridge",
    step: "downloading_bridge_bundle",
    message: "Downloading bundle",
    helperVersion: launcher.helperVersion,
  });

  const diagnostics = getIbkrBridgeActivationDiagnostics();
  assert.equal(diagnostics.activeCount, 1);
  assert.equal(diagnostics.latestActivationId, activationId);
  assert.equal(diagnostics.latestProgress?.step, "downloading_bridge_bundle");
  assert.equal(diagnostics.latestProgress?.helperVersion, launcher.helperVersion);
  assert.equal(diagnostics.recentProgress.length, 1);
});

test("IBKR bridge attach validates and stores a local bridge runtime", async () => {
  const bridgeToken = "c".repeat(64);
  installBridgeFetchStub(bridgeToken);

  const attached = await attachIbkrBridgeRuntime({
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken,
    managementToken: "m".repeat(64),
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.equal(attached.bridgeUrl, "https://healthy.trycloudflare.com");
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: bridgeToken,
  });
  const sessionHealth = await getBridgeHealthForSession();
  assert.equal(sessionHealth?.connected, true);
  assert.equal(sessionHealth?.authenticated, true);
});

test("IBKR bridge attach recovers when the launch activation was lost", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  assert.ok(activationId);
  resetIbkrBridgeRuntimeStateForTests();
  installBridgeFetchStub(launcher.bridgeToken);

  const attached = await attachIbkrBridgeRuntime({
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken: launcher.bridgeToken,
    managementToken: launcher.managementToken,
    activationId,
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: launcher.bridgeToken,
  });
});

test("IBKR bridge attach accepts helper persisted token when management token matches activation", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  assert.ok(activationId);
  const persistedBridgeToken = "p".repeat(64);
  installBridgeFetchStub(persistedBridgeToken);

  const attached = await attachIbkrBridgeRuntime({
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken: persistedBridgeToken,
    managementToken: launcher.managementToken,
    activationId,
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: persistedBridgeToken,
  });
  assert.equal(getIbkrBridgeActivationDiagnostics().activeCount, 0);
});

test("legacy IBKR bridge completion recovers when the activation was lost", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);
  resetIbkrBridgeRuntimeStateForTests();
  installBridgeFetchStub(launcher.bridgeToken);

  const attached = await attachLegacyIbkrBridgeRuntime(activationId, {
    callbackSecret,
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken: launcher.bridgeToken,
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://healthy.trycloudflare.com",
    apiToken: launcher.bridgeToken,
  });
});

test("older legacy bridge activations cannot replace a newer runtime", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.launchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);
  installBridgeFetchStub(launcher.bridgeToken);

  setIbkrBridgeRuntimeOverride({
    baseUrl: "https://newer.trycloudflare.com",
    apiToken: "newer-token",
  });

  await assert.rejects(
    attachLegacyIbkrBridgeRuntime(activationId, {
      callbackSecret,
      bridgeUrl: "https://older.trycloudflare.com",
      bridgeToken: launcher.bridgeToken,
    }),
    /superseded by a newer launch/,
  );

  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://newer.trycloudflare.com",
    apiToken: "newer-token",
  });
});

test("older overlapping one-click activations cannot attach after a newer launch is issued", async () => {
  const older = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const olderParams = new URL(older.launchUrl).searchParams;
  const olderActivationId = olderParams.get("activationId");
  const olderCallbackSecret = olderParams.get("callbackSecret");
  assert.ok(olderActivationId);
  assert.ok(olderCallbackSecret);

  const newer = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const newerParams = new URL(newer.launchUrl).searchParams;
  const newerActivationId = newerParams.get("activationId");
  const newerCallbackSecret = newerParams.get("callbackSecret");
  assert.ok(newerActivationId);
  assert.ok(newerCallbackSecret);

  assert.throws(
    () =>
      recordLegacyIbkrBridgeActivationProgress(olderActivationId, {
        callbackSecret: olderCallbackSecret,
        status: "starting_bridge",
        step: "local_bridge_ready",
        message: "ready",
      }),
    /superseded by a newer launch/,
  );

  await assert.rejects(
    attachIbkrBridgeRuntime({
      bridgeUrl: "https://older.trycloudflare.com",
      bridgeToken: older.bridgeToken,
      managementToken: older.managementToken,
      activationId: olderActivationId,
    }),
    /superseded by a newer launch/,
  );

  installBridgeFetchStub(newer.bridgeToken);
  const attached = await attachIbkrBridgeRuntime({
    bridgeUrl: "https://newer.trycloudflare.com",
    bridgeToken: newer.bridgeToken,
    managementToken: newer.managementToken,
    activationId: newerActivationId,
  });

  assert.equal(attached.runtimeOverrideActive, true);
  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://newer.trycloudflare.com",
    apiToken: newer.bridgeToken,
  });
});

test("IBKR bridge detach requires the attach management token", async () => {
  const bridgeToken = "d".repeat(64);
  const managementToken = "e".repeat(64);
  installBridgeFetchStub(bridgeToken);

  await attachIbkrBridgeRuntime({
    bridgeUrl: "https://healthy.trycloudflare.com",
    bridgeToken,
    managementToken,
  });

  assert.throws(
    () => detachIbkrBridgeRuntime({ managementToken: "wrong" }),
    /managementToken is required|detach token is invalid/,
  );

  const detached = detachIbkrBridgeRuntime({ managementToken });

  assert.equal(detached.runtimeOverrideActive, false);
  assert.equal(getIbkrBridgeRuntimeConfig(), null);
});

test("IBKR bridge runtime ignores stale environment bridge URL", () => {
  process.env["IBKR_BRIDGE_URL"] = "https://env.trycloudflare.com/";
  process.env["IBKR_BRIDGE_API_TOKEN"] = "token-from-env";

  assert.equal(getIbkrBridgeRuntimeConfig(), null);
});

test("IBKR bridge runtime override is the only live bridge URL source", () => {
  process.env["IBKR_BRIDGE_URL"] = "https://env.trycloudflare.com/";
  process.env["IBKR_BRIDGE_API_TOKEN"] = "token-from-env";

  setIbkrBridgeRuntimeOverride({
    baseUrl: "https://override.trycloudflare.com",
    apiToken: "override-token",
  });

  assert.deepEqual(getIbkrBridgeRuntimeConfig(), {
    baseUrl: "https://override.trycloudflare.com",
    apiToken: "override-token",
  });
});
