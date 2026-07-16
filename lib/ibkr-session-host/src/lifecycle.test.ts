import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";

import {
  CapsuleError,
  loadSessionHostConfig,
  type RuntimeReadiness,
} from "./capsule";
import type { IbkrHostControlIdentity } from "./control-config";
import {
  createIbkrHostLifecycleClient,
  loadIbkrHostLifecycleConfig,
} from "./lifecycle";

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 7);
const OVERLAP_KEY = Buffer.alloc(32, 8);
const IDENTITY: IbkrHostControlIdentity = {
  hostId: HOST_ID,
  key: KEY,
  overlapKey: OVERLAP_KEY,
};
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `ghcr.io/pyrus/ibkr-capsule@${IMAGE_DIGEST}`;
const RUNTIME_SPEC_DIGEST = `sha256:${"b".repeat(64)}`;
const RUNTIME_ATTESTATION_DIGEST = `sha256:${"c".repeat(64)}`;
const WORKLOAD_IDENTITY_DIGEST = "d".repeat(64);
const NOW_SECONDS = 1_800_000_000;

function validEnv(): Record<string, string> {
  return {
    IBKR_SESSION_HOST_API_ORIGIN: "http://127.0.0.1:8080/",
    IBKR_SESSION_HOST_FAILURE_DOMAIN: "reserved-vm-primary",
    IBKR_SESSION_HOST_RUNTIME_ATTESTATION_DIGEST:
      RUNTIME_ATTESTATION_DIGEST,
    IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST: RUNTIME_SPEC_DIGEST,
    IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST: WORKLOAD_IDENTITY_DIGEST,
  };
}

function hostConfig() {
  return loadSessionHostConfig({
    IBKR_SESSION_CAPSULE_IMAGE: IMAGE,
    IBKR_SESSION_HOST_CAPACITY: "20",
  });
}

test("loads lifecycle attestation only for a complete signed host identity", () => {
  assert.equal(
    loadIbkrHostLifecycleConfig({
      controlIdentity: null,
      env: {},
      hostConfig: hostConfig(),
    }),
    null,
  );

  const config = loadIbkrHostLifecycleConfig({
    controlIdentity: IDENTITY,
    env: validEnv(),
    hostConfig: hostConfig(),
  });
  assert.deepEqual(config, {
    apiOrigin: "http://127.0.0.1:8080",
    controlIdentity: IDENTITY,
    heartbeat: {
      verifiedWorkloadIdentityDigest: WORKLOAD_IDENTITY_DIGEST,
      runtimeAttestationDigest: RUNTIME_ATTESTATION_DIGEST,
    },
    registration: {
      workloadIdentityDigest: WORKLOAD_IDENTITY_DIGEST,
      controlOrigin: "http://127.0.0.1:18748",
      imageDigest: IMAGE_DIGEST,
      runtimeSpecDigest: RUNTIME_SPEC_DIGEST,
      runtimeAttestationDigest: RUNTIME_ATTESTATION_DIGEST,
      failureDomain: "reserved-vm-primary",
      measuredSlotCapacity: 20,
    },
  });
});

test("rejects incomplete attestation and every non-loopback API origin", () => {
  const invalidEnvironments = [
    {},
    {
      ...validEnv(),
      IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST: "short",
    },
    {
      ...validEnv(),
      IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST: "sha256:short",
    },
    {
      ...validEnv(),
      IBKR_SESSION_HOST_RUNTIME_ATTESTATION_DIGEST: "sha256:short",
    },
    { ...validEnv(), IBKR_SESSION_HOST_FAILURE_DOMAIN: "" },
    {
      ...validEnv(),
      IBKR_SESSION_HOST_API_ORIGIN: "http://localhost:8080",
    },
    {
      ...validEnv(),
      IBKR_SESSION_HOST_API_ORIGIN: "http://127.0.0.2:8080",
    },
    {
      ...validEnv(),
      IBKR_SESSION_HOST_API_ORIGIN: "https://api.example.invalid",
    },
    {
      ...validEnv(),
      IBKR_SESSION_HOST_API_ORIGIN: "http://127.0.0.1:8080/api",
    },
  ];
  for (const env of invalidEnvironments) {
    assert.throws(
      () =>
        loadIbkrHostLifecycleConfig({
          controlIdentity: IDENTITY,
          env,
          hostConfig: hostConfig(),
        }),
      CapsuleError,
    );
  }
});

test("defaults the lifecycle API to the configured supervisor API port", () => {
  const env = validEnv();
  delete env["IBKR_SESSION_HOST_API_ORIGIN"];
  env["PYRUS_API_PORT"] = "9080";
  assert.equal(
    loadIbkrHostLifecycleConfig({
      controlIdentity: IDENTITY,
      env,
      hostConfig: hostConfig(),
    })?.apiOrigin,
    "http://127.0.0.1:9080",
  );
});

test("registers, heartbeats, and re-registers after a failed heartbeat", async () => {
  const config = loadIbkrHostLifecycleConfig({
    controlIdentity: IDENTITY,
    env: validEnv(),
    hostConfig: hostConfig(),
  });
  assert.ok(config);
  const actions: string[] = [];
  let requestNumber = 0;
  const lifecycle = createIbkrHostLifecycleClient(config, {
    nowSeconds: () => NOW_SECONDS,
    readiness: async () => ({ ready: true }),
    request: async (url, init) => {
      requestNumber += 1;
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      const action = path.endsWith("/heartbeat") ? "heartbeat" : "register";
      actions.push(action);
      const body = String(init.body ?? "");
      assert.deepEqual(
        verifyIbkrHostControlRequest({
          body,
          expectedHostId: HOST_ID,
          headers: init.headers,
          key: KEY,
          method: "POST",
          nowSeconds: NOW_SECONDS,
          path,
        }).valid,
        true,
      );
      assert.equal(parsed.origin, "http://127.0.0.1:8080");
      assert.equal(init.redirect, "error");

      if (requestNumber === 3) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          hostId: HOST_ID,
          status: action === "register" ? "quarantined" : "active",
          heartbeatExpiresAt: "2027-01-15T08:00:30.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(await lifecycle.runOnce(), "registered");
  assert.equal(await lifecycle.runOnce(), "heartbeat");
  assert.equal(await lifecycle.runOnce(), "request_failed");
  assert.equal(await lifecycle.runOnce(), "registered");
  assert.deepEqual(actions, [
    "register",
    "heartbeat",
    "heartbeat",
    "register",
  ]);
  lifecycle.stop();
});

test("withholds lifecycle traffic while runtime readiness is degraded", async () => {
  const config = loadIbkrHostLifecycleConfig({
    controlIdentity: IDENTITY,
    env: validEnv(),
    hostConfig: hostConfig(),
  });
  assert.ok(config);
  let readiness: RuntimeReadiness = {
    ready: false,
    code: "docker_unavailable",
  };
  let calls = 0;
  const lifecycle = createIbkrHostLifecycleClient(config, {
    readiness: async () => readiness,
    request: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          hostId: HOST_ID,
          status: "quarantined",
          heartbeatExpiresAt: "2027-01-15T08:00:30.000Z",
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(await lifecycle.runOnce(), "runtime_unready");
  assert.equal(calls, 0);
  readiness = { ready: true };
  assert.equal(await lifecycle.runOnce(), "registered");
  assert.equal(calls, 1);
  lifecycle.stop();
});

test("rejects oversized or identity-mismatched API responses", async () => {
  const config = loadIbkrHostLifecycleConfig({
    controlIdentity: IDENTITY,
    env: validEnv(),
    hostConfig: hostConfig(),
  });
  assert.ok(config);
  const responses = [
    new Response("x".repeat(16 * 1024 + 1), { status: 200 }),
    new Response(
      JSON.stringify({
        hostId: "22222222-2222-4222-8222-222222222222",
        status: "quarantined",
        heartbeatExpiresAt: "2027-01-15T08:00:30.000Z",
      }),
      { status: 200 },
    ),
  ];
  const lifecycle = createIbkrHostLifecycleClient(config, {
    readiness: async () => ({ ready: true }),
    request: async () => responses.shift()!,
  });

  assert.equal(await lifecycle.runOnce(), "request_failed");
  assert.equal(await lifecycle.runOnce(), "request_failed");
  lifecycle.stop();
});
