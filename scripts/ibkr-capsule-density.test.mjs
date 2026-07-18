import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { runCapsuleDensityRelease } from "./ibkr-capsule-density.mjs";

const MANIFEST_BYTES = Buffer.from('{"fixture":"release"}\n');
const IMAGE_REFERENCE = `registry.example.test/pyrus/ibkr-capsule@sha256:${"a".repeat(64)}`;
const MANIFEST = {
  attestations: {
    runtimeAttestationDigest: `sha256:${"b".repeat(64)}`,
    runtimeSpecDigest: `sha256:${"c".repeat(64)}`,
    workloadIdentityDigest: "d".repeat(64),
  },
  image: {
    labels: {
      "io.pyrus.ibkr.capsule-lease-protocol": "1",
      "io.pyrus.ibkr.runtime-spec": `sha256:${"c".repeat(64)}`,
      "io.pyrus.ibkr.workload-identity": "d".repeat(64),
      "org.opencontainers.image.revision": "e".repeat(40),
    },
    reference: IMAGE_REFERENCE,
  },
  source: { commit: "e".repeat(40) },
};

test("preloads the reviewed manifest digest before starting the fixed density runner", async () => {
  const events = [];
  const result = await runCapsuleDensityRelease(
    {
      deploymentId: "deployment-123",
      execute: true,
      manifestPath: "/evidence/release.json",
      reportPath: "/evidence/density.json",
      vmSize: "reserved-vm-fixture",
    },
    {
      env: {
        IBKR_GATEWAY_FLEET_ENABLED: "0",
        IBKR_SESSION_HOST_ENABLED: "0",
      },
      preloadImage: async (reference, options) => {
        events.push(["preload", reference, options]);
        return {
          imageId: `sha256:${"f".repeat(64)}`,
          imageReference: reference,
          pulled: false,
        };
      },
      readManifest: async () => ({
        bytes: MANIFEST_BYTES,
        manifest: MANIFEST,
      }),
      runDensity: async (args) => {
        events.push(["run", args]);
        return 0;
      },
    },
  );

  const manifestSha256 = `sha256:${createHash("sha256")
    .update(MANIFEST_BYTES)
    .digest("hex")}`;
  assert.deepEqual(events[0], [
    "preload",
    IMAGE_REFERENCE,
    { expectedLabels: MANIFEST.image.labels },
  ]);
  assert.deepEqual(events[1], [
    "run",
    [
      `--image=${IMAGE_REFERENCE}`,
      `--manifest-sha256=${manifestSha256}`,
      `--release-commit=${MANIFEST.source.commit}`,
      `--runtime-spec-digest=${MANIFEST.attestations.runtimeSpecDigest}`,
      `--runtime-attestation-digest=${MANIFEST.attestations.runtimeAttestationDigest}`,
      `--workload-identity-digest=${MANIFEST.attestations.workloadIdentityDigest}`,
      "--deployment-id=deployment-123",
      "--vm-size=reserved-vm-fixture",
      "--report=/evidence/density.json",
      "--execute",
    ],
  ]);
  assert.equal(result, 0);
});

test("refuses a dry invocation before reading, pulling, or running anything", async () => {
  let sideEffects = 0;
  await assert.rejects(
    runCapsuleDensityRelease(
      {
        deploymentId: "deployment-123",
        execute: false,
        manifestPath: "/evidence/release.json",
        reportPath: "/evidence/density.json",
        vmSize: "reserved-vm-fixture",
      },
      {
        env: {
          IBKR_GATEWAY_FLEET_ENABLED: "0",
          IBKR_SESSION_HOST_ENABLED: "0",
        },
        preloadImage: async () => {
          sideEffects += 1;
          throw new Error("unexpected preload");
        },
        readManifest: async () => {
          sideEffects += 1;
          throw new Error("unexpected read");
        },
        runDensity: async () => {
          sideEffects += 1;
          return 0;
        },
      },
    ),
    /requires --execute/,
  );
  assert.equal(sideEffects, 0);
});

test("does not start density when exact-image preload fails", async () => {
  let ran = false;
  await assert.rejects(
    runCapsuleDensityRelease(
      {
        deploymentId: "deployment-123",
        execute: true,
        manifestPath: "/evidence/release.json",
        reportPath: "/evidence/density.json",
        vmSize: "reserved-vm-fixture",
      },
      {
        env: {
          IBKR_GATEWAY_FLEET_ENABLED: "0",
          IBKR_SESSION_HOST_ENABLED: "0",
        },
        preloadImage: async () => {
          throw new Error("image mismatch");
        },
        readManifest: async () => ({
          bytes: MANIFEST_BYTES,
          manifest: MANIFEST,
        }),
        runDensity: async () => {
          ran = true;
          return 0;
        },
      },
    ),
    /image mismatch/,
  );
  assert.equal(ran, false);
});

test("requires both fleet routing and the production host to be disabled", async () => {
  let sideEffects = 0;
  await assert.rejects(
    runCapsuleDensityRelease(
      {
        deploymentId: "deployment-123",
        execute: true,
        manifestPath: "/evidence/release.json",
        reportPath: "/evidence/density.json",
        vmSize: "reserved-vm-fixture",
      },
      {
        env: {
          IBKR_GATEWAY_FLEET_ENABLED: "1",
          IBKR_SESSION_HOST_ENABLED: "1",
        },
        preloadImage: async () => {
          sideEffects += 1;
          throw new Error("unexpected preload");
        },
        readManifest: async () => {
          sideEffects += 1;
          throw new Error("unexpected read");
        },
        runDensity: async () => {
          sideEffects += 1;
          return 0;
        },
      },
    ),
    /explicitly disabled/,
  );
  assert.equal(sideEffects, 0);
});
