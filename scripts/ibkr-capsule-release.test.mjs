import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createGitSourceSnapshot,
  preloadCapsuleRelease,
  publishCapsuleRelease,
  readCapsuleReleaseManifest,
  runtimeAttestationDigestFor,
} from "./ibkr-capsule-release.mjs";
import { execFileCommand } from "./lib/ibkr-capsule-image.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const COMMIT = "1".repeat(40);
const IMAGE_DIGEST = `sha256:${"2".repeat(64)}`;
const IMAGE_ID = `sha256:${"3".repeat(64)}`;
const REPOSITORY = "registry.example.test/pyrus/ibkr-capsule";

test("release builds from an immutable archive of the selected commit", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "pyrus-ibkr-source-snapshot-test-"),
  );
  await mkdir(path.join(fixtureRoot, "nested"));
  await Promise.all([
    writeFile(path.join(fixtureRoot, "workload.txt"), "workload-v1\n"),
    writeFile(path.join(fixtureRoot, "nested/runtime.txt"), "runtime-v1\n"),
  ]);
  execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=PYRUS Test",
      "-c",
      "user.email=pyrus-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: fixtureRoot },
  );
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixtureRoot,
    encoding: "utf8",
  }).trim();
  await writeFile(path.join(fixtureRoot, "workload.txt"), "dirty-worktree\n");

  const snapshot = await createGitSourceSnapshot({
    repoRoot: fixtureRoot,
    runCommand: execFileCommand,
    sourceCommit,
    sourcePaths: ["workload.txt", "nested/runtime.txt"],
  });
  assert.equal(
    await readFile(path.join(snapshot.root, "workload.txt"), "utf8"),
    "workload-v1\n",
  );
  assert.equal(
    await readFile(path.join(snapshot.root, "nested/runtime.txt"), "utf8"),
    "runtime-v1\n",
  );
  await snapshot.cleanup();
  await assert.rejects(access(snapshot.root));
});

test("publish builds one linux/amd64 image with provenance and emits a bound manifest", async () => {
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "pyrus-ibkr-release-test-"),
  );
  const manifestPath = path.join(outputRoot, "release.json");
  const metadataPath = path.join(outputRoot, "build-metadata.json");
  const calls = [];
  let buildLabels = {};
  let cleanedSnapshot = false;
  let inspections = 0;

  const runCommand = async (command, args) => {
    calls.push([command, args]);
    if (command === "git" && args[0] === "status") {
      return { code: 0, stderr: "", stdout: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { code: 0, stderr: "", stdout: `${COMMIT}\n` };
    }
    if (command === "docker" && args[0] === "buildx") {
      for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--label") {
          const separator = args[index + 1].indexOf("=");
          buildLabels[args[index + 1].slice(0, separator)] = args[
            index + 1
          ].slice(separator + 1);
        }
      }
      await writeFile(
        metadataPath,
        `${JSON.stringify({
          "buildx.build.provenance": { builder: { id: "fixture" } },
          "containerimage.digest": IMAGE_DIGEST,
        })}\n`,
      );
      return { code: 0, stderr: "", stdout: "published\n" };
    }
    if (command === "docker" && args[0] === "pull") {
      return { code: 0, stderr: "", stdout: "pulled\n" };
    }
    if (command === "docker" && args[0] === "image") {
      inspections += 1;
      if (inspections === 1) {
        return { code: 1, stderr: "not loaded", stdout: "" };
      }
      const reference = `${REPOSITORY}@${IMAGE_DIGEST}`;
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          Architecture: "amd64",
          Config: {
            Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
            Healthcheck: null,
            Labels: buildLabels,
            User: "10001:10001",
            Volumes: null,
          },
          Id: IMAGE_ID,
          Os: "linux",
          RepoDigests: [reference],
        }),
      };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };

  const manifest = await publishCapsuleRelease({
    buildNetwork: "host",
    createSourceSnapshot: async () => ({
      cleanup: async () => {
        cleanedSnapshot = true;
      },
      root: repoRoot,
    }),
    manifestPath,
    metadataPath,
    now: () => new Date("2026-07-17T17:00:00.000Z"),
    repoRoot,
    repository: REPOSITORY,
    runCommand,
  });

  const build = calls.find(
    ([command, args]) => command === "docker" && args[0] === "buildx",
  );
  assert(build);
  assert.deepEqual(build[1].slice(0, 2), ["buildx", "build"]);
  assert(build[1].includes("--push"));
  assert(build[1].includes("--provenance=mode=max"));
  assert(build[1].includes("--sbom=true"));
  assert.deepEqual(
    build[1].slice(
      build[1].indexOf("--platform"),
      build[1].indexOf("--platform") + 2,
    ),
    ["--platform", "linux/amd64"],
  );
  assert.deepEqual(
    build[1].slice(
      build[1].indexOf("--network"),
      build[1].indexOf("--network") + 2,
    ),
    ["--network", "host"],
  );

  assert.equal(manifest.schema, "pyrus.ibkr.capsule.release.v1");
  assert.equal(manifest.source.commit, COMMIT);
  assert.equal(manifest.image.reference, `${REPOSITORY}@${IMAGE_DIGEST}`);
  assert.equal(manifest.image.localImageId, IMAGE_ID);
  assert.equal(manifest.image.platform, "linux/amd64");
  assert.equal(manifest.build.provenance, "mode=max");
  assert.equal(manifest.build.sbom, true);
  assert.equal(cleanedSnapshot, true);
  assert.equal(manifest.attestations.workloadIdentityDigest.length, 64);
  assert.match(
    manifest.attestations.runtimeSpecDigest,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.equal(
    manifest.attestations.runtimeAttestationDigest,
    runtimeAttestationDigestFor({
      imageDigest: IMAGE_DIGEST,
      runtimeSpecDigest: manifest.attestations.runtimeSpecDigest,
      sourceCommit: COMMIT,
      workloadIdentityDigest: manifest.attestations.workloadIdentityDigest,
    }),
  );
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), manifest);
  const reviewed = await readCapsuleReleaseManifest(manifestPath);
  assert.deepEqual(reviewed.manifest, manifest);
  assert.equal(
    reviewed.bytes.toString("utf8"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const tamperedManifestPath = path.join(outputRoot, "tampered.json");
  await writeFile(
    tamperedManifestPath,
    JSON.stringify({
      ...manifest,
      image: {
        ...manifest.image,
        expectedConfig: {
          ...manifest.image.expectedConfig,
          user: "0:0",
        },
      },
    }),
  );
  await assert.rejects(
    preloadCapsuleRelease({
      manifestPath: tamperedManifestPath,
      runCommand: async () => {
        throw new Error("Docker must not be called for a tampered manifest.");
      },
    }),
    /release manifest is invalid/,
  );
});

test("publish refuses a dirty source tree before invoking Docker", async () => {
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "pyrus-ibkr-release-dirty-test-"),
  );
  const calls = [];

  await assert.rejects(
    publishCapsuleRelease({
      manifestPath: path.join(outputRoot, "release.json"),
      metadataPath: path.join(outputRoot, "metadata.json"),
      repoRoot,
      repository: REPOSITORY,
      runCommand: async (command, args) => {
        calls.push([command, args]);
        return {
          code: 0,
          stderr: "",
          stdout:
            command === "git" && args[0] === "status"
              ? " M lib/ibkr-session-host/capsule/Dockerfile\n"
              : "",
        };
      },
    }),
    /clean source tree/,
  );

  assert.deepEqual(
    calls.map(([command]) => command),
    ["git"],
  );
});
