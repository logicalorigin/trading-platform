import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";
import {
  attachLegacyIbkrBridgeRuntime,
  attachIbkrBridgeRuntime,
  detachIbkrBridgeRuntime,
  getIbkrBridgeLauncher,
  recordLegacyIbkrBridgeActivationProgress,
  resetIbkrBridgeRuntimeStateForTests,
} from "./ibkr-bridge-runtime";
import {
  getIbkrBridgeRuntimeConfig,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";

const originalFetch = globalThis.fetch;
const previousRuntimeOverrideFile =
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
const previousBridgeUrl = process.env["IBKR_BRIDGE_URL"];
const previousBridgeToken = process.env["IBKR_BRIDGE_API_TOKEN"];
const runtimeOverrideDir = mkdtempSync(
  join(tmpdir(), "rayalgo-bridge-runtime-test-"),
);
process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
  runtimeOverrideDir,
  "runtime.json",
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
    apiBaseUrl: "https://rayalgo.example.com/api/ignored?x=1",
  });

  assert.equal(launcher.apiBaseUrl, "https://rayalgo.example.com");
  assert.equal(
    launcher.helperUrl,
    "https://rayalgo.example.com/api/ibkr/bridge/helper.ps1",
  );
  assert.equal(
    launcher.bundleUrl,
    "https://rayalgo.example.com/api/ibkr/bridge/bundle.tar.gz",
  );
  assert.equal("command" in launcher, false);
  assert.equal("helperInstallCommand" in launcher, false);
  assert.equal("installerUrl" in launcher, false);
  assert.match(launcher.launchUrl, /^rayalgo-ibkr:\/\/launch\?/);
  const launchParams = new URL(launcher.launchUrl).searchParams;
  assert.equal(launcher.activationId, launchParams.get("activationId"));
  assert.equal(launcher.helperVersion, "2026-04-30.order-cache-v10");
  assert.match(launchParams.get("activationId") ?? "", /^[a-f0-9]{32}$/);
  assert.match(launchParams.get("callbackSecret") ?? "", /^[a-f0-9]{64}$/);
  assert.equal(launchParams.get("apiBaseUrl"), "https://rayalgo.example.com");
  assert.equal(launchParams.get("bridgeToken"), launcher.bridgeToken);
  assert.equal(launchParams.get("managementToken"), launcher.managementToken);
  assert.equal(
    launchParams.get("helperUrl"),
    "https://rayalgo.example.com/api/ibkr/bridge/helper.ps1",
  );
  assert.equal(launchParams.get("helperVersion"), launcher.helperVersion);
  assert.equal(launchParams.get("requiredCapability"), "bridgeBundle");
  assert.equal(launchParams.get("forceFreshTunnel"), "1");
  assert.equal(
    launchParams.get("bundleUrl"),
    "https://rayalgo.example.com/api/ibkr/bridge/bundle.tar.gz",
  );
});

test("legacy IBKR bridge activation callbacks attach the runtime", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://rayalgo.example.com",
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
      step: "bridge_ready",
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
});

test("IBKR bridge attach recovers when the launch activation was lost", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://rayalgo.example.com",
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

test("legacy IBKR bridge completion recovers when the activation was lost", async () => {
  const launcher = getIbkrBridgeLauncher({
    apiBaseUrl: "https://rayalgo.example.com",
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
    apiBaseUrl: "https://rayalgo.example.com",
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
    apiBaseUrl: "https://rayalgo.example.com",
  });
  const olderParams = new URL(older.launchUrl).searchParams;
  const olderActivationId = olderParams.get("activationId");
  const olderCallbackSecret = olderParams.get("callbackSecret");
  assert.ok(olderActivationId);
  assert.ok(olderCallbackSecret);

  const newer = getIbkrBridgeLauncher({
    apiBaseUrl: "https://rayalgo.example.com",
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
        step: "bridge_ready",
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
