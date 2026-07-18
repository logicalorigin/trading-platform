import assert from "node:assert/strict";
import test from "node:test";

import { runIbkrSessionHost } from "./runIbkrSessionHost.mjs";

test("the host wrapper verifies the exact capsule before importing host code", async () => {
  const events = [];
  const env = {
    IBKR_SESSION_CAPSULE_IMAGE: `registry.example.test/pyrus/ibkr@sha256:${"a".repeat(64)}`,
    IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST: `sha256:${"b".repeat(64)}`,
    IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST: "c".repeat(64),
  };

  await runIbkrSessionHost(env, {
    importHost: async () => {
      events.push(["import"]);
    },
    preloadCapsule: async (imageReference, options) => {
      events.push(["preload", imageReference, options.expectedLabels]);
    },
  });

  assert.deepEqual(events, [
    [
      "preload",
      env.IBKR_SESSION_CAPSULE_IMAGE,
      {
        "io.pyrus.ibkr.capsule-lease-protocol": "1",
        "io.pyrus.ibkr.runtime-spec": env.IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST,
        "io.pyrus.ibkr.workload-identity":
          env.IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST,
      },
    ],
    ["import"],
  ]);
});

test("the host wrapper fails before import when image preload fails", async () => {
  let imported = false;

  await assert.rejects(
    runIbkrSessionHost(
      {
        IBKR_SESSION_CAPSULE_IMAGE: `sha256:${"d".repeat(64)}`,
        IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST: `sha256:${"e".repeat(64)}`,
        IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST: "f".repeat(64),
      },
      {
        importHost: async () => {
          imported = true;
        },
        preloadCapsule: async () => {
          throw new Error("preload rejected");
        },
      },
    ),
    /preload rejected/,
  );
  assert.equal(imported, false);
});
