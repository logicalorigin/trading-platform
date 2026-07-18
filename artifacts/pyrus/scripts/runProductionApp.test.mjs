import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveProductionServices,
  superviseProductionServices,
} from "./runProductionApp.mjs";

const repoRoot = "/synthetic/repo";
const ROOT_KEY = Buffer.alloc(32, 41);
const OVERLAP_ROOT_KEY = Buffer.alloc(32, 42);
const HOST_ID = "11111111-1111-4111-8111-111111111111";

function deriveHostKey(rootKey) {
  return createHmac("sha256", rootKey)
    .update(`PYRUS-IBKR-HOST-CONTROL-KEY-V1\0${HOST_ID}`)
    .digest("base64url");
}

function baseEnv() {
  return {
    HOME: "/home/runner",
    LANG: "C.UTF-8",
    NODE_ENV: "production",
    PATH: "/usr/bin:/bin",
    PORT: "18747",
    PYRUS_SERVE_WEB: "1",
  };
}

function enabledHostEnv() {
  return {
    ...baseEnv(),
    IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY: ROOT_KEY.toString("base64url"),
    IBKR_SESSION_CAPSULE_IMAGE: `sha256:${"a".repeat(64)}`,
    IBKR_SESSION_HOST_ENABLED: "1",
    IBKR_SESSION_HOST_FAILURE_DOMAIN: "reserved-vm-primary",
    IBKR_SESSION_HOST_ID: HOST_ID,
    IBKR_SESSION_HOST_RUNTIME_ATTESTATION_DIGEST: `sha256:${"b".repeat(64)}`,
    IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST: `sha256:${"c".repeat(64)}`,
    IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST: "d".repeat(64),
  };
}

test("production serves the fullstack API alone while the host is disabled", () => {
  const services = resolveProductionServices(baseEnv(), repoRoot);

  assert.equal(services.length, 1);
  assert.equal(services[0].name, "API");
  assert.equal(
    services[0].entry,
    "/synthetic/repo/artifacts/api-server/dist/index.mjs",
  );
  assert.equal(services[0].env.PORT, "18747");
  assert.equal(services[0].env.PYRUS_SERVE_WEB, "1");
});

test("enabled production starts a least-privilege co-located session host", () => {
  const env = {
    ...enabledHostEnv(),
    DATABASE_URL: "postgres://sensitive.invalid/db",
    IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY:
      OVERLAP_ROOT_KEY.toString("base64url"),
    IBKR_SESSION_HOST_CONTROL_KEY: "externally-supplied-host-key",
    IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY:
      "externally-supplied-overlap-host-key",
    IBKR_SESSION_COOKIE: "legacy-session-cookie",
    SNAPTRADE_API_KEY: "broker-secret",
  };
  const [api, host] = resolveProductionServices(env, repoRoot);

  assert.equal(api.name, "API");
  assert.equal(
    api.env.IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY,
    ROOT_KEY.toString("base64url"),
  );
  assert.equal(host.name, "IBKR session host");
  assert.equal(
    host.entry,
    "/synthetic/repo/artifacts/pyrus/scripts/runIbkrSessionHost.mjs",
  );
  assert.equal(host.env.IBKR_SESSION_HOST_CONTROL_KEY, deriveHostKey(ROOT_KEY));
  assert.equal(
    host.env.IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY,
    deriveHostKey(OVERLAP_ROOT_KEY),
  );
  assert.equal(host.env.IBKR_SESSION_HOST_ID, env.IBKR_SESSION_HOST_ID);
  assert.equal(host.env.PYRUS_API_PORT, "18747");
  assert.equal(host.env.DOCKER_HOST, "unix:///var/run/docker.sock");
  assert.equal(host.env.DATABASE_URL, undefined);
  assert.equal(host.env.IBKR_SESSION_COOKIE, undefined);
  assert.equal(host.env.IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY, undefined);
  assert.equal(
    host.env.IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY,
    undefined,
  );
  assert.equal(host.env.SNAPTRADE_API_KEY, undefined);
});

test("production fails closed on an incoherent co-located topology", () => {
  assert.throws(
    () =>
      resolveProductionServices(
        { ...baseEnv(), IBKR_GATEWAY_FLEET_ENABLED: "1" },
        repoRoot,
      ),
    /requires the co-located session host/,
  );
  assert.throws(
    () =>
      resolveProductionServices(
        {
          ...enabledHostEnv(),
          IBKR_SESSION_HOST_PORT: "18747",
        },
        repoRoot,
      ),
    /must not share the external API port/,
  );
  assert.throws(
    () => resolveProductionServices({ ...baseEnv(), PORT: "0" }, repoRoot),
    /production API port/,
  );
  assert.throws(
    () =>
      resolveProductionServices(
        { ...baseEnv(), PYRUS_SERVE_WEB: "0" },
        repoRoot,
      ),
    /must serve the built web app/,
  );
  const { IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY: _rootKey, ...missingRoot } =
    enabledHostEnv();
  assert.throws(
    () => resolveProductionServices(missingRoot, repoRoot),
    /complete signed lifecycle configuration/,
  );
  assert.throws(
    () =>
      resolveProductionServices(
        {
          ...enabledHostEnv(),
          IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY: "invalid",
        },
        repoRoot,
      ),
    /control root keys are invalid/,
  );
  assert.throws(
    () =>
      resolveProductionServices(
        {
          ...enabledHostEnv(),
          IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY:
            ROOT_KEY.toString("base64url"),
        },
        repoRoot,
      ),
    /control root keys are invalid/,
  );
});

test("production supervisor owns child shutdown without a shell", () => {
  const source = readFileSync(
    new URL("./runProductionApp.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /child\.kill\("SIGTERM"\)/);
  assert.match(source, /child\.kill\("SIGKILL"\)/);
  assert.match(source, /process\.once\("SIGINT"/);
  assert.match(source, /process\.once\("SIGTERM"/);
  assert.doesNotMatch(source, /shell\s*:\s*true/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:env|secret|key)/i);
});

test("a host exit terminates the API and preserves the fatal code", async () => {
  class FakeChild extends EventEmitter {
    kills = [];

    kill(signal) {
      this.kills.push(signal);
      queueMicrotask(() => this.emit("exit", 0, signal));
      return true;
    }
  }

  const api = new FakeChild();
  const host = new FakeChild();
  const children = [api, host];
  const exits = [];
  const completion = superviseProductionServices(
    [
      { name: "API", entry: "/api.mjs", env: {} },
      { name: "IBKR session host", entry: "/host.mjs", env: {} },
    ],
    {
      log: () => undefined,
      logError: () => undefined,
      onExit: (code) => exits.push(code),
      signalTarget: new EventEmitter(),
      spawnProcess: () => children.shift(),
    },
  );

  host.emit("exit", 17, null);
  assert.equal(await completion, 17);
  assert.deepEqual(api.kills, ["SIGTERM"]);
  assert.deepEqual(host.kills, []);
  assert.deepEqual(exits, [17]);
});
