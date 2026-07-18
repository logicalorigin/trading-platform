import assert from "node:assert/strict";
import test from "node:test";

import { preloadCapsuleImage } from "./ibkr-capsule-image.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE_ID = `sha256:${"b".repeat(64)}`;
const REMOTE_IMAGE = `registry.example.test/pyrus/ibkr-capsule@${DIGEST}`;
const LABELS = {
  "io.pyrus.ibkr.runtime-spec": `sha256:${"c".repeat(64)}`,
  "io.pyrus.ibkr.workload-identity": "d".repeat(64),
};

function inspection(reference = REMOTE_IMAGE, overrides = {}) {
  return {
    Architecture: "amd64",
    Config: {
      Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
      Healthcheck: null,
      Labels: LABELS,
      User: "10001:10001",
      Volumes: null,
    },
    Id: IMAGE_ID,
    Os: "linux",
    RepoDigests: reference.startsWith("sha256:") ? [] : [reference],
    ...overrides,
  };
}

test("an already-present exact digest is inspected without a registry pull", async () => {
  const calls = [];
  const result = await preloadCapsuleImage(REMOTE_IMAGE, {
    expectedLabels: LABELS,
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return {
        code: 0,
        stderr: "",
        stdout: `${JSON.stringify(inspection())}\n`,
      };
    },
  });

  assert.deepEqual(result, {
    imageId: IMAGE_ID,
    imageReference: REMOTE_IMAGE,
    pulled: false,
  });
  assert.deepEqual(calls, [
    ["docker", ["image", "inspect", "--format", "{{json .}}", REMOTE_IMAGE]],
  ]);
});

test("a fresh target pulls only the exact linux/amd64 digest and then inspects it", async () => {
  const calls = [];
  let inspections = 0;
  const result = await preloadCapsuleImage(REMOTE_IMAGE, {
    expectedLabels: LABELS,
    runCommand: async (command, args) => {
      calls.push([command, args]);
      if (args[0] === "pull") {
        return { code: 0, stderr: "", stdout: "pulled\n" };
      }
      inspections += 1;
      return inspections === 1
        ? { code: 1, stderr: "missing", stdout: "" }
        : {
            code: 0,
            stderr: "",
            stdout: JSON.stringify(inspection()),
          };
    },
  });

  assert.equal(result.pulled, true);
  assert.deepEqual(calls, [
    ["docker", ["image", "inspect", "--format", "{{json .}}", REMOTE_IMAGE]],
    ["docker", ["pull", "--platform", "linux/amd64", REMOTE_IMAGE]],
    ["docker", ["image", "inspect", "--format", "{{json .}}", REMOTE_IMAGE]],
  ]);
});

test("local image IDs are never interpreted as pull targets", async () => {
  const calls = [];

  await assert.rejects(
    preloadCapsuleImage(IMAGE_ID, {
      runCommand: async (command, args) => {
        calls.push([command, args]);
        return { code: 1, stderr: "missing", stdout: "" };
      },
    }),
    /local capsule image is unavailable/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][0], "image");
});

test("mutable references and mismatched immutable image metadata fail closed", async () => {
  await assert.rejects(
    preloadCapsuleImage("registry.example.test/pyrus/ibkr-capsule:latest", {
      runCommand: async () => {
        throw new Error("runner must not be called");
      },
    }),
    /immutable sha256/,
  );

  await assert.rejects(
    preloadCapsuleImage(REMOTE_IMAGE, {
      expectedLabels: LABELS,
      runCommand: async () => ({
        code: 0,
        stderr: "",
        stdout: JSON.stringify(
          inspection(REMOTE_IMAGE, {
            Config: {
              ...inspection().Config,
              Labels: {
                ...LABELS,
                "io.pyrus.ibkr.runtime-spec": `sha256:${"e".repeat(64)}`,
              },
            },
          }),
        ),
      }),
    }),
    /capsule image metadata is invalid/,
  );
});
