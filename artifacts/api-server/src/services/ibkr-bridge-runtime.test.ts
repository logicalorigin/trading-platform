import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";
import {
  attachLegacyIbkrBridgeRuntime,
  attachIbkrBridgeRuntime,
  cancelLegacyIbkrBridgeActivation,
  claimLegacyIbkrBridgeLoginEnvelope,
  claimLegacyIbkrBridgeLoginEnvelopeWithWait,
  claimIbkrRemoteDesktopLaunchJob,
  claimIbkrRemoteDesktopLaunchJobWithWait,
  completeIbkrRemoteDesktopJob,
  createIbkrRemoteBridgeLaunch,
  createIbkrRemoteBridgeShutdown,
  detachIbkrBridgeRuntime,
  getIbkrBridgeActivationDiagnostics,
  getIbkrBridgeHelperMetadata,
  getIbkrBridgeLauncher,
  getIbkrBridgeRuntimeSessionState,
  heartbeatIbkrRemoteDesktop,
  listIbkrRemoteDesktops,
  readIbkrRemoteDesktopJobStatus,
  readLegacyIbkrBridgeActivationStatus,
  readLegacyIbkrBridgeLoginKey,
  readLegacyIbkrBridgeLoginKeyWithWait,
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
  join(tmpdir(), "pyrus-bridge-runtime-test-"),
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

test("IBKR remote desktop registry defaults to persistent API data storage", () => {
  const source = readFileSync(
    new URL("./ibkr-bridge-runtime.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /IBKR_BRIDGE_REMOTE_DESKTOPS_FILE/);
  assert.match(source, /PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE/);
  assert.match(source, /PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE/);
  assert.match(source, /artifacts[\s\S]*api-server[\s\S]*data[\s\S]*ibkr-remote-desktops\.json/);
  assert.doesNotMatch(
    source,
    /return join\(tmpdir\(\), "pyrus", "ibkr-remote-desktops\.json"\)/,
  );
});

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
  assert.match(launcher.launchUrl, /^pyrus-ibkr:\/\/launch\?/);
  const launchParams = new URL(launcher.launchUrl).searchParams;
  assert.equal(launcher.activationId, launchParams.get("activationId"));
  assert.equal(
    launcher.helperVersion,
    "2026-06-04.ib-async-sidecar-v8-foreground-guard",
  );
  assert.equal(launcher.autoLoginSupported, true);
  assert.equal(launcher.autoLoginConfigured, null);
  assert.equal(launcher.autoLoginMode, "ib-gateway-live");
  assert.match(launcher.autoLoginLaunchUrl, /^pyrus-ibkr:\/\/launch\?/);
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
  assert.match(claimed.launchUrl, /^pyrus-ibkr:\/\/launch\?/);

  const claimAgain = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
  });
  assert.deepEqual(claimAgain, {
    helperVersion: pairing.helperVersion,
    ready: false,
  });
});

test("IBKR remote desktop launch claim long-polls until a job is queued", async () => {
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

  const claimPromise = claimIbkrRemoteDesktopLaunchJobWithWait({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    waitMs: 500,
  });
  await wait(20);
  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com/api/ignored",
    body: { autoLogin: true },
  });

  const claimed = await claimPromise;
  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected long-poll claim to return the queued launch job.");
  }
  assert.equal(claimed.activationId, remoteLaunch.activationId);
  assert.equal(claimed.jobId, remoteLaunch.remoteLaunch.jobId);
});

test("IBKR runtime session state exposes desktop reconnect readiness by helper version", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  const activationId = pairingParams.get("activationId");
  const callbackSecret = pairingParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);

  registerIbkrRemoteDesktop({
    activationId,
    callbackSecret,
    desktopId: "desktop-win-runtime-state",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-runtime-state",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
  });

  const oldHelper = getIbkrBridgeRuntimeSessionState();
  assert.equal(oldHelper.runtimeOverrideActive, false);
  assert.equal(oldHelper.desktopAgentOnline, true);
  assert.equal(
    oldHelper.desktopAgentHelperVersion,
    "2026-05-20.remote-desktop-agent-v19",
  );
  assert.equal(oldHelper.desktopAgentUpgradeRequired, true);
  assert.equal(oldHelper.reconnectAvailable, false);

  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-runtime-state",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });

  const currentHelper = getIbkrBridgeRuntimeSessionState();
  assert.equal(currentHelper.desktopAgentExpectedHelperVersion, pairing.helperVersion);
  assert.equal(currentHelper.desktopAgentHelperVersion, pairing.helperVersion);
  assert.equal(currentHelper.desktopAgentUpgradeRequired, false);
  assert.equal(currentHelper.reconnectAvailable, true);

  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-runtime-state",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
  });

  const stillCurrentHelper = getIbkrBridgeRuntimeSessionState();
  assert.equal(stillCurrentHelper.desktopAgentHelperVersion, pairing.helperVersion);
  assert.equal(stillCurrentHelper.desktopAgentUpgradeRequired, false);
  assert.equal(stillCurrentHelper.reconnectAvailable, true);
  assert.equal(
    listIbkrRemoteDesktops().desktops[0]?.helperVersion,
    pairing.helperVersion,
  );

  setIbkrBridgeRuntimeOverride({
    baseUrl: "https://runtime-bridge.example.com",
    apiToken: "runtime-token",
  });
  assert.equal(getIbkrBridgeRuntimeSessionState().reconnectAvailable, false);
});

test("IBKR runtime treats current-helper variants as reconnect-ready without forced update", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const compatibleHelperVersion =
    "2026-06-04.ib-async-sidecar-v8-foreground-guard-local-repair";
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-compatible",
    desktopSecret: "s".repeat(64),
    helperVersion: compatibleHelperVersion,
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-compatible",
    desktopSecret: "s".repeat(64),
    helperVersion: compatibleHelperVersion,
    label: "TRADING-PC\\Riley",
  });

  const state = getIbkrBridgeRuntimeSessionState();
  assert.equal(state.desktopAgentOnline, true);
  assert.equal(state.desktopAgentHelperVersion, compatibleHelperVersion);
  assert.equal(state.desktopAgentCompatibility, "compatible");
  assert.equal(state.desktopAgentCompatible, true);
  assert.equal(state.desktopAgentKnownBad, false);
  assert.equal(state.desktopAgentUpgradeRequired, false);
  assert.equal(state.reconnectAvailable, true);

  const desktop = listIbkrRemoteDesktops().desktops[0];
  assert.equal(desktop?.helperCompatibility, "compatible");
  assert.equal(desktop?.helperCompatible, true);
  assert.equal(desktop?.helperKnownBad, false);
  assert.equal(desktop?.helperUpdateRequired, false);

  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: true },
  });
  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-compatible",
    desktopSecret: "s".repeat(64),
    helperVersion: compatibleHelperVersion,
  });

  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected compatible helper variant to claim launch job.");
  }
  assert.equal(claimed.activationId, remoteLaunch.activationId);
  assert.equal(
    new URL(claimed.launchUrl).searchParams.get("helperVersion"),
    compatibleHelperVersion,
  );
});

test("IBKR runtime marks known-bad helpers as update-required while preserving self-repair launch", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const knownBadHelperVersion = "2026-06-04.ib-async-sidecar-v6-fast-agent";
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-known-bad",
    desktopSecret: "s".repeat(64),
    helperVersion: knownBadHelperVersion,
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-known-bad",
    desktopSecret: "s".repeat(64),
    helperVersion: knownBadHelperVersion,
    label: "TRADING-PC\\Riley",
  });

  const state = getIbkrBridgeRuntimeSessionState();
  assert.equal(state.desktopAgentOnline, true);
  assert.equal(state.desktopAgentHelperVersion, knownBadHelperVersion);
  assert.equal(state.desktopAgentCompatibility, "known_bad");
  assert.equal(state.desktopAgentCompatible, false);
  assert.equal(state.desktopAgentKnownBad, true);
  assert.equal(state.desktopAgentUpgradeRequired, true);
  assert.equal(state.reconnectAvailable, false);

  const desktop = listIbkrRemoteDesktops().desktops[0];
  assert.equal(desktop?.helperCompatibility, "known_bad");
  assert.equal(desktop?.helperCompatible, false);
  assert.equal(desktop?.helperKnownBad, true);
  assert.equal(desktop?.helperUpdateRequired, true);

  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: true },
  });
  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-known-bad",
    desktopSecret: "s".repeat(64),
    helperVersion: knownBadHelperVersion,
  });

  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected known-bad helper to claim self-repair launch job.");
  }
  assert.equal(claimed.activationId, remoteLaunch.activationId);
  assert.equal(
    new URL(claimed.launchUrl).searchParams.get("helperVersion"),
    pairing.helperVersion,
  );
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
  assert.match(claimed.launchUrl, /^pyrus-ibkr:\/\/launch\?/);
});

test("IBKR remote desktop launch stays current but shutdown reaches duplicate helpers", () => {
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
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
    label: "TRADING-PC\\Riley",
  });

  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: true },
  });
  assert.deepEqual(
    claimIbkrRemoteDesktopLaunchJob({
      desktopId: "desktop-win-main",
      desktopSecret: "s".repeat(64),
      helperVersion: "2026-05-20.remote-desktop-agent-v19",
    }),
    {
      helperVersion: pairing.helperVersion,
      ready: false,
    },
  );

  const launchClaim = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });
  if (!launchClaim.ready || launchClaim.action !== "launch") {
    assert.fail("Expected current helper to claim launch job.");
  }
  assert.equal(launchClaim.jobId, remoteLaunch.remoteLaunch.jobId);

  const pendingLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: true },
  });
  const shutdown = createIbkrRemoteBridgeShutdown({
    apiBaseUrl: "https://pyrus.example.com",
    body: { force: true },
  });

  const shutdownClaim = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
  });
  if (!shutdownClaim.ready || shutdownClaim.action !== "launch") {
    assert.fail("Expected duplicate helper to claim shutdown job.");
  }
  assert.equal(shutdownClaim.jobId, shutdown.shutdown.jobId);
  assert.equal(shutdownClaim.shutdown, true);
  assert.notEqual(shutdownClaim.jobId, pendingLaunch.remoteLaunch.jobId);
  assert.deepEqual(
    claimIbkrRemoteDesktopLaunchJob({
      desktopId: "desktop-win-main",
      desktopSecret: "s".repeat(64),
      helperVersion: pairing.helperVersion,
    }),
    {
      helperVersion: pairing.helperVersion,
      ready: false,
    },
  );
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
    assert.fail("Expected current helper to claim shutdown inline.");
  }
  assert.equal(claimed.expiresAt, queued.shutdown.expiresAt);
  assert.equal(claimed.helperVersion, pairing.helperVersion);
  assert.equal(claimed.jobId, queued.shutdown.jobId);
  assert.match(claimed.launchUrl, /^pyrus-ibkr:\/\/launch\?/);
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

  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected shutdown to be delivered as a launch job claim.");
  }
  assert.equal(claimed.jobId, queued.shutdown.jobId);
  assert.equal(claimed.activationId, null);
  assert.equal(claimed.shutdown, true);
  assert.match(claimed.launchUrl, /^pyrus-ibkr:\/\/launch\?/);
  assert.match(claimed.launchUrl, /shutdown=1/);
  assert.match(
    claimed.launchUrl,
    /helperVersion=2026-06-04\.ib-async-sidecar-v8-foreground-guard/,
  );
  assert.match(claimed.launchUrl, /jobId=/);
  assert.match(claimed.launchUrl, /completionToken=/);
});

test("IBKR remote desktop launch bootstraps outdated helpers before switching to Pyrus protocol", () => {
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
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
    label: "TRADING-PC\\Riley",
  });

  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: true },
  });
  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: "2026-05-20.remote-desktop-agent-v19",
  });

  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected a launch job claim.");
  }
  assert.equal(claimed.launchUrl, remoteLaunch.autoLoginLaunchUrl);
  assert.match(claimed.launchUrl, /^pyrus-ibkr:\/\/launch\?/);
  assert.match(
    claimed.launchUrl,
    /helperVersion=2026-06-04\.ib-async-sidecar-v8-foreground-guard/,
  );
  assert.match(claimed.launchUrl, /helperUrl=https%3A%2F%2Fpyrus\.example\.com%2Fapi%2Fibkr%2Fbridge%2Fhelper\.ps1/);
});

test("IBKR remote desktop claim keeps jobs for the current helper", () => {
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
    body: { autoLogin: true },
  });
  assert.match(remoteLaunch.autoLoginLaunchUrl, /^pyrus-ibkr:\/\/launch\?/);

  assert.deepEqual(
    claimIbkrRemoteDesktopLaunchJob({
      desktopId: "desktop-win-main",
      desktopSecret: "s".repeat(64),
      helperVersion: "2026-05-20.remote-desktop-agent-v19",
    }),
    {
      helperVersion: pairing.helperVersion,
      ready: false,
    },
  );

  const claimed = claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-main",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });

  if (!claimed.ready || claimed.action !== "launch") {
    assert.fail("Expected a launch job claim.");
  }
  assert.match(claimed.launchUrl, /^pyrus-ibkr:\/\/launch\?/);
  assert.equal(
    new URL(claimed.launchUrl).searchParams.get("activationId"),
    remoteLaunch.activationId,
  );
  assert.equal(
    new URL(claimed.launchUrl).searchParams.get("helperVersion"),
    pairing.helperVersion,
  );
});

test("IBKR Windows helper restarts stale Gateway sessions instead of cycling bridge clients", () => {
  const source = readFileSync(
    new URL("../../../../scripts/windows/pyrus-ibkr-helper.ps1", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /\$HelperVersion = '2026-06-04\.ib-async-sidecar-v8-foreground-guard'/,
  );
  assert.match(source, /\[int\]\$AgentPollSeconds = 1/);
  assert.match(source, /waitMs = 25000/);
  assert.match(
    source,
    /\/api\/ibkr\/desktop\/jobs\/claim' -Body \$body -TimeoutSec 30/,
  );
  assert.match(source, /\[Math\]::Max\(1, \[Math\]::Min\(30, \$AgentPollSeconds\)\)/);
  assert.match(source, /\$env:PYRUS_IBKR_SIDECAR_PROXY_TIMEOUT_MS = '30000'/);
  assert.match(source, /pyrus-ibkr-helper\.ps1/);
  assert.match(source, /function Invoke-BridgeGatewayReconnectIfNeeded/);
  assert.match(source, /waiting_bridge_gateway_api/);
  assert.match(source, /retrying_tunnel/);
  assert.match(source, /sidecar_restart_for_bundle/);
  assert.match(source, /--protocol', 'http2'/);
  assert.match(source, /--edge-ip-version', '4'/);
  assert.match(source, /\$strictReason -eq 'gateway_socket_disconnected'/);
  assert.match(source, /gateway_server_disconnected/);
  assert.match(source, /gateway_login_required/);
  assert.match(source, /function Get-IBGatewayWindowCandidateScore/);
  assert.match(source, /function Test-IBGatewayCredentialWindowCandidate/);
  assert.match(source, /public static extern IntPtr GetForegroundWindow\(\)/);
  assert.match(source, /function Get-ForegroundWindowSnapshot/);
  assert.match(source, /function Get-ForegroundIBGatewayCredentialWindowCandidate/);
  assert.match(source, /function Assert-IBGatewayCredentialWindowForeground/);
  assert.match(source, /Get-IBGatewayWindowCandidate -RequireCredentialWindow/);
  assert.match(source, /Waiting for the IB Gateway login window title before typing credentials/);
  assert.match(source, /the Gateway credential window is still not foreground/);
  assert.match(source, /Refusing to type credentials into the wrong window/);
  assert.match(source, /Wait-IBGatewayWindow -TimeoutSeconds \$windowWaitSeconds -AllowForegroundFallback/);
  assert.match(source, /gateway_login_window_unconfirmed/);
  assert.doesNotMatch(source, /gateway_foreground_fallback/);
  assert.doesNotMatch(source, /Pyrus will type credentials in 5 seconds/);
  assert.match(source, /function Restart-DesktopAgentProcessWithCurrentHelper/);
  assert.match(source, /Restarting Pyrus IBKR desktop agent process \$pidNumber with current helper/);
  assert.match(source, /Restart-DesktopAgentProcessWithCurrentHelper -BaseUrl \$script:ApiBaseUrl/);
  assert.match(source, /gateway_login_window_active/);
  assert.match(source, /function Set-ClipboardTextForPaste/);
  assert.match(source, /\[System\.Windows\.Forms\.TextDataFormat\]::UnicodeText/);
  assert.match(source, /function Wait-IBGatewayLiveApiSocket/);
  assert.match(source, /Still waiting for IBKR Mobile\/2FA approval and live API socket 4001/);
  assert.match(source, /Submitted one-time credentials to IB Gateway/);
  assert.match(
    source,
    /if \(\$script:AutoLoginCredentialClaimed\)\s*\{\s*return \$false\s*\}/,
  );
  assert.match(source, /continue clientIdLoop/);
  assert.match(source, /Start auto-login again from Pyrus/);
  assert.match(source, /already used its one-time credential handoff/);
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

test("IBKR bridge login key read long-polls until helper publishes key", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const launchParams = new URL(launcher.autoLoginLaunchUrl).searchParams;
  const activationId = launchParams.get("activationId");
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(activationId);
  assert.ok(callbackSecret);

  const keyPromise = readLegacyIbkrBridgeLoginKeyWithWait(activationId, {
    managementToken: launcher.managementToken,
    waitMs: 500,
  });
  await wait(20);
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

  const keyResult = await keyPromise;
  assert.equal(keyResult.ready, true);
  assert.equal(keyResult.ready && keyResult.helperInstanceId, "helper-1");
});

test("IBKR bridge login envelope claim long-polls until browser submits credentials", async () => {
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

  const claimPromise = claimLegacyIbkrBridgeLoginEnvelopeWithWait(activationId, {
    callbackSecret,
    helperInstanceId: "helper-1",
    waitMs: 500,
  });
  await wait(20);
  submitLegacyIbkrBridgeLoginEnvelope(activationId, {
    managementToken: launcher.managementToken,
    helperInstanceId: "helper-1",
    algorithm: "RSA-OAEP-256-CHUNKED",
    ciphertextChunks: ["encrypted-chunk-1", "encrypted-chunk-2"],
  });
  const diagnostics = getIbkrBridgeActivationDiagnostics();
  assert.equal(diagnostics.latestProgress?.step, "credentials_received");

  const claimed = await claimPromise;
  assert.deepEqual(claimed, {
    envelope: {
      algorithm: "RSA-OAEP-256-CHUNKED",
      ciphertextChunks: ["encrypted-chunk-1", "encrypted-chunk-2"],
    },
    ready: true,
  });
});

test("new IBKR bridge launch supersedes older credential handoff windows", () => {
  const first = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const firstParams = new URL(first.autoLoginLaunchUrl).searchParams;
  const firstActivationId = firstParams.get("activationId");
  const firstCallbackSecret = firstParams.get("callbackSecret");
  assert.ok(firstActivationId);
  assert.ok(firstCallbackSecret);

  submitLegacyIbkrBridgeLoginKey(firstActivationId, {
    callbackSecret: firstCallbackSecret,
    helperInstanceId: "helper-old",
    algorithm: "RSA-OAEP-256-CHUNKED",
    publicKeyJwk: {
      kty: "RSA",
      n: "modulus",
      e: "AQAB",
    },
  });

  const second = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const secondParams = new URL(second.autoLoginLaunchUrl).searchParams;
  const secondActivationId = secondParams.get("activationId");
  assert.ok(secondActivationId);
  assert.notEqual(secondActivationId, firstActivationId);

  assert.equal(getIbkrBridgeActivationDiagnostics().activeCount, 1);
  assert.equal(
    getIbkrBridgeActivationDiagnostics().latestActivationId,
    secondActivationId,
  );
  assert.throws(
    () =>
      claimLegacyIbkrBridgeLoginEnvelope(firstActivationId, {
        callbackSecret: firstCallbackSecret,
        helperInstanceId: "helper-old",
      }),
    /superseded by a newer launch/,
  );
});

test("IBKR bridge helper metadata is read-only and does not create activations", () => {
  const before = getIbkrBridgeActivationDiagnostics();
  assert.equal(before.activeCount, 0);
  assert.equal(before.latestActivationId, null);

  const metadata = getIbkrBridgeHelperMetadata();

  assert.equal(metadata.helperVersion, getIbkrBridgeRuntimeSessionState().desktopAgentExpectedHelperVersion);
  assert.equal(metadata.onlineCount, 0);
  assert.equal(metadata.latestDesktop, null);
  assert.equal(metadata.runtime.runtimeOverrideActive, false);
  const after = getIbkrBridgeActivationDiagnostics();
  assert.equal(after.activeCount, 0);
  assert.equal(after.latestActivationId, null);
  assert.equal(after.latestProgress, null);
  assert.deepEqual(after.recentProgress, []);
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
  assert.equal(initialStatus.insight.currentPhase, "request");
  assert.equal(initialStatus.insight.currentOwner, "pyrus");
  assert.equal(initialStatus.insight.severity, "progress");
  assert.match(initialStatus.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(initialStatus.latestProgress, null);
  assert.deepEqual(initialStatus.recentProgress, []);
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
  assert.equal(status.insight.currentPhase, "canceled");
  assert.equal(status.insight.currentOwner, "user");
  assert.equal(status.insight.severity, "error");
  assert.equal(status.insight.stale, false);
  assert.equal(status.latestProgress?.step, "cancel_requested");
  assert.equal(status.latestProgress?.status, "canceled");
  assert.match(status.latestProgress?.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.recentProgress.length, 1);

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

  const status = readLegacyIbkrBridgeActivationStatus(activationId, {
    managementToken: launcher.managementToken,
  });
  assert.equal(status.latestProgress?.step, "downloading_bridge_bundle");
  assert.equal(status.insight.currentPhase, "bridge");
  assert.equal(status.insight.currentOwner, "desktopHelper");
  assert.equal(status.insight.timeline.some((row) => row.id === "bridge"), true);
  assert.equal(status.insight.phaseDurations.bridge.startedAt !== null, true);
  assert.equal(status.latestProgress?.helperVersion, launcher.helperVersion);
  assert.equal(status.latestProgress?.message, "Downloading bundle");
  assert.match(status.latestProgress?.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.recentProgress.length, 1);

  const diagnostics = getIbkrBridgeActivationDiagnostics();
  assert.equal(diagnostics.activeCount, 1);
  assert.equal(diagnostics.latestActivationId, activationId);
  assert.equal(diagnostics.latestActivation?.canceled, false);
  assert.equal(diagnostics.latestActivation?.loginEnvelopeSubmitted, false);
  assert.equal(diagnostics.latestActivation?.loginEnvelopeSubmittedAt, null);
  assert.equal(diagnostics.latestActivation?.loginHandoffCreatedAt, null);
  assert.equal(diagnostics.latestActivation?.loginHandoffReady, false);
  assert.equal(diagnostics.latestProgress?.step, "downloading_bridge_bundle");
  assert.equal(diagnostics.insight.currentPhase, "bridge");
  assert.equal(diagnostics.insight.currentOwner, "desktopHelper");
  assert.equal(diagnostics.latestProgress?.helperVersion, launcher.helperVersion);
  assert.equal(diagnostics.recentProgress.length, 1);
  assert.ok(diagnostics.latestActivation?.timings.issuedAt);
  assert.equal(
    typeof diagnostics.latestActivation?.progressStepTimings
      .downloading_bridge_bundle,
    "string",
  );
});

test("legacy IBKR bridge activation diagnostics expose launch and credential timing", () => {
  const pairing = getIbkrBridgeLauncher({
    apiBaseUrl: "https://pyrus.example.com",
  });
  const pairingParams = new URL(pairing.launchUrl).searchParams;
  registerIbkrRemoteDesktop({
    activationId: pairingParams.get("activationId"),
    callbackSecret: pairingParams.get("callbackSecret"),
    desktopId: "desktop-win-timing",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  heartbeatIbkrRemoteDesktop({
    desktopId: "desktop-win-timing",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
    label: "TRADING-PC\\Riley",
  });
  const remoteLaunch = createIbkrRemoteBridgeLaunch({
    apiBaseUrl: "https://pyrus.example.com",
    body: { autoLogin: true },
  });
  const launchParams = new URL(remoteLaunch.autoLoginLaunchUrl).searchParams;
  const callbackSecret = launchParams.get("callbackSecret");
  assert.ok(callbackSecret);

  claimIbkrRemoteDesktopLaunchJob({
    desktopId: "desktop-win-timing",
    desktopSecret: "s".repeat(64),
    helperVersion: pairing.helperVersion,
  });
  submitLegacyIbkrBridgeLoginKey(remoteLaunch.activationId, {
    callbackSecret,
    helperInstanceId: "helper-1",
    algorithm: "RSA-OAEP-256-CHUNKED",
    publicKeyJwk: {
      kty: "RSA",
      n: "modulus",
      e: "AQAB",
    },
  });
  const key = readLegacyIbkrBridgeLoginKey(remoteLaunch.activationId, {
    managementToken: remoteLaunch.managementToken,
  });
  assert.equal(key.ready, true);
  submitLegacyIbkrBridgeLoginEnvelope(remoteLaunch.activationId, {
    managementToken: remoteLaunch.managementToken,
    helperInstanceId: "helper-1",
    algorithm: "RSA-OAEP-256-CHUNKED",
    ciphertextChunks: ["encrypted-chunk-1"],
  });
  claimLegacyIbkrBridgeLoginEnvelope(remoteLaunch.activationId, {
    callbackSecret,
    helperInstanceId: "helper-1",
  });

  const diagnostics = getIbkrBridgeActivationDiagnostics();
  assert.equal(diagnostics.latestActivationId, remoteLaunch.activationId);
  assert.ok(diagnostics.latestActivation?.timings.launchJobCreatedAt);
  assert.ok(diagnostics.latestActivation?.timings.launchJobClaimedAt);
  assert.ok(diagnostics.latestActivation?.timings.loginKeyPublishedAt);
  assert.ok(diagnostics.latestActivation?.timings.loginKeyReadAt);
  assert.ok(diagnostics.latestActivation?.timings.loginKeyReadReadyAt);
  assert.ok(diagnostics.latestActivation?.timings.loginEnvelopeReceivedAt);
  assert.ok(diagnostics.latestActivation?.timings.loginEnvelopeClaimedAt);
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
