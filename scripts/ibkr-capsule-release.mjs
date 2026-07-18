#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  execFileCommand,
  isImmutableCapsuleImageReference,
  preloadCapsuleImage,
} from "./lib/ibkr-capsule-image.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const IDENTITY_PATTERN = /^[a-f0-9]{64}$/u;
const RELEASE_SCHEMA = "pyrus.ibkr.capsule.release.v1";
const WORKLOAD_INPUTS = [
  "lib/ibkr-session-host/capsule/.dockerignore",
  "lib/ibkr-session-host/capsule/Dockerfile",
  "lib/ibkr-session-host/capsule/chromium-managed-policy.json",
  "lib/ibkr-session-host/capsule/paper-only-extension/manifest.json",
  "lib/ibkr-session-host/capsule/paper-only-extension/paper-only.js",
  "lib/ibkr-session-host/capsule/pyrus-capsule-entrypoint",
  "lib/ibkr-session-host/capsule/pyrus-capsule-health",
  "lib/ibkr-session-host/capsule/pyrus-capsule-relay.py",
  "lib/ibkr-session-host/capsule/pyrus-capsule-supervisor.py",
];
const RUNTIME_SPEC_INPUTS = [
  "artifacts/pyrus/scripts/runIbkrSessionHost.mjs",
  "artifacts/pyrus/scripts/runProductionApp.mjs",
  "lib/ibkr-session-host/src/capsule.ts",
  "lib/ibkr-session-host/src/chromium-seccomp.json",
  "scripts/lib/ibkr-capsule-image.mjs",
];

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function repositoryIsValid(value) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 255 ||
    value.includes("@") ||
    !/^[a-z0-9][a-z0-9._:/-]*$/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment)) {
    return false;
  }
  const leaf = segments.at(-1);
  if (segments.slice(1).some((segment) => segment.includes(":"))) {
    return false;
  }
  const registryColon = segments[0].indexOf(":");
  return (
    registryColon < 0 ||
    /^[0-9]{1,5}$/u.test(segments[0].slice(registryColon + 1))
  );
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createGitSourceSnapshot(input) {
  const snapshotRoot = await mkdtemp(
    path.join(os.tmpdir(), "pyrus-ibkr-capsule-release-"),
  );
  const archivePath = path.join(snapshotRoot, "source.tar");
  try {
    const archive = await input.runCommand(
      "git",
      [
        "archive",
        "--format=tar",
        "--output",
        archivePath,
        input.sourceCommit,
        "--",
        ...(input.sourcePaths ??
          new Set([...WORKLOAD_INPUTS, ...RUNTIME_SPEC_INPUTS])),
      ],
      { cwd: input.repoRoot },
    );
    if (archive.code !== 0) {
      throw new Error("The committed release source could not be archived.");
    }
    const extract = await input.runCommand(
      "tar",
      ["-xf", archivePath, "-C", snapshotRoot],
      { cwd: snapshotRoot },
    );
    if (extract.code !== 0) {
      throw new Error("The committed release source could not be extracted.");
    }
    await rm(archivePath, { force: true });
    return {
      cleanup: () => rm(snapshotRoot, { force: true, recursive: true }),
      root: snapshotRoot,
    };
  } catch (error) {
    await rm(snapshotRoot, { force: true, recursive: true });
    throw error;
  }
}

async function digestFiles(repoRoot, domain, files) {
  const digest = createHash("sha256");
  const inputs = [];
  digest.update(`${domain}\0`, "utf8");

  for (const relativePath of [...files].sort()) {
    const data = await readFile(path.join(repoRoot, relativePath));
    const fileDigest = createHash("sha256").update(data).digest("hex");
    const encodedPath = Buffer.from(relativePath, "utf8");
    digest.update(String(encodedPath.byteLength), "ascii");
    digest.update("\0", "ascii");
    digest.update(encodedPath);
    digest.update("\0", "ascii");
    digest.update(String(data.byteLength), "ascii");
    digest.update("\0", "ascii");
    digest.update(data);
    inputs.push({ path: relativePath, sha256: `sha256:${fileDigest}` });
  }

  return { digest: digest.digest("hex"), inputs };
}

export function runtimeAttestationDigestFor(input) {
  const payload = JSON.stringify({
    imageDigest: input.imageDigest,
    platform: "linux/amd64",
    runtimeSpecDigest: input.runtimeSpecDigest,
    schema: "pyrus.ibkr.capsule.runtime-attestation.v1",
    sourceCommit: input.sourceCommit,
    workloadIdentityDigest: input.workloadIdentityDigest,
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

async function requireCleanSource(repoRoot, runCommand) {
  const status = await runCommand(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repoRoot },
  );
  if (status.code !== 0 || status.stdout.trim().length > 0) {
    throw new Error("Capsule publication requires a clean source tree.");
  }
  const revision = await runCommand("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
  });
  const commit = revision.stdout.trim();
  if (revision.code !== 0 || !COMMIT_PATTERN.test(commit)) {
    throw new Error("The release source commit could not be resolved.");
  }
  return commit;
}

function releaseLabels(input) {
  return {
    "io.pyrus.ibkr.capsule-lease-protocol": "1",
    "io.pyrus.ibkr.runtime-spec": input.runtimeSpecDigest,
    "io.pyrus.ibkr.workload-identity": input.workloadIdentityDigest,
    "org.opencontainers.image.revision": input.sourceCommit,
  };
}

export async function publishCapsuleRelease(input) {
  const runCommand = input.runCommand ?? execFileCommand;
  const repoRoot = path.resolve(input.repoRoot ?? defaultRepoRoot);
  const manifestPath = path.resolve(input.manifestPath);
  const metadataPath = path.resolve(input.metadataPath);
  const buildNetwork = input.buildNetwork ?? "default";
  if (!repositoryIsValid(input.repository)) {
    throw new Error("The capsule repository is invalid.");
  }
  if (!["default", "host"].includes(buildNetwork)) {
    throw new Error("The capsule build network must be default or host.");
  }
  if (
    manifestPath === metadataPath ||
    (await pathExists(manifestPath)) ||
    (await pathExists(metadataPath))
  ) {
    throw new Error("Release evidence output paths must be new and distinct.");
  }

  const sourceCommit = await requireCleanSource(repoRoot, runCommand);
  const createSourceSnapshot =
    input.createSourceSnapshot ??
    ((snapshotInput) => createGitSourceSnapshot(snapshotInput));
  const sourceSnapshot = await createSourceSnapshot({
    repoRoot,
    runCommand,
    sourceCommit,
  });
  return (async () => {
    const workload = await digestFiles(
      sourceSnapshot.root,
      "PYRUS-IBKR-CAPSULE-WORKLOAD-IDENTITY-V1",
      WORKLOAD_INPUTS,
    );
    const runtimeSpec = await digestFiles(
      sourceSnapshot.root,
      "PYRUS-IBKR-CAPSULE-RUNTIME-SPEC-V1",
      RUNTIME_SPEC_INPUTS,
    );
    const workloadIdentityDigest = workload.digest;
    const runtimeSpecDigest = `sha256:${runtimeSpec.digest}`;
    const labels = releaseLabels({
      runtimeSpecDigest,
      sourceCommit,
      workloadIdentityDigest,
    });
    const tag = `${input.repository}:git-${sourceCommit}`;
    const contextPath = path.join(
      sourceSnapshot.root,
      "lib/ibkr-session-host/capsule",
    );
    const dockerfilePath = path.join(contextPath, "Dockerfile");
    await Promise.all([
      mkdir(path.dirname(manifestPath), { recursive: true }),
      mkdir(path.dirname(metadataPath), { recursive: true }),
    ]);

    const buildArgs = [
      "buildx",
      "build",
      "--file",
      dockerfilePath,
      "--platform",
      "linux/amd64",
      "--provenance=mode=max",
      "--sbom=true",
    ];
    for (const [name, value] of Object.entries(labels).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      buildArgs.push("--label", `${name}=${value}`);
    }
    buildArgs.push("--tag", tag, "--metadata-file", metadataPath);
    if (buildNetwork === "host") {
      buildArgs.push("--network", "host");
    }
    buildArgs.push("--push", contextPath);

    const build = await runCommand("docker", buildArgs, {
      cwd: repoRoot,
      timeoutMs: 60 * 60_000,
    });
    if (build.code !== 0) {
      throw new Error("The capsule build or registry publication failed.");
    }

    let metadata;
    let metadataBytes;
    try {
      metadataBytes = await readFile(metadataPath);
      metadata = asRecord(JSON.parse(metadataBytes.toString("utf8")));
    } catch {
      metadata = null;
    }
    const imageDigest = metadata?.["containerimage.digest"];
    if (
      typeof imageDigest !== "string" ||
      !SHA256_PATTERN.test(imageDigest) ||
      !asRecord(metadata?.["buildx.build.provenance"])
    ) {
      throw new Error(
        "Build metadata did not contain an immutable image digest.",
      );
    }
    const imageReference = `${input.repository}@${imageDigest}`;
    const preload = await preloadCapsuleImage(imageReference, {
      expectedLabels: labels,
      runCommand,
    });
    const runtimeAttestationDigest = runtimeAttestationDigestFor({
      imageDigest,
      runtimeSpecDigest,
      sourceCommit,
      workloadIdentityDigest,
    });
    const manifest = {
      attestations: {
        runtimeAttestationDigest,
        runtimeSpecDigest,
        workloadIdentityDigest,
      },
      build: {
        metadataSha256: `sha256:${createHash("sha256")
          .update(metadataBytes)
          .digest("hex")}`,
        network: buildNetwork,
        provenance: "mode=max",
        sbom: true,
        tool: "docker buildx",
      },
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
      image: {
        digest: imageDigest,
        expectedConfig: {
          architecture: "amd64",
          entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
          healthcheck: null,
          os: "linux",
          user: "10001:10001",
          volumes: null,
        },
        labels,
        localImageId: preload.imageId,
        platform: "linux/amd64",
        publishTag: tag,
        reference: imageReference,
      },
      inputs: {
        runtimeSpec: runtimeSpec.inputs,
        workload: workload.inputs,
      },
      schema: RELEASE_SCHEMA,
      source: {
        clean: true,
        commit: sourceCommit,
        context: "lib/ibkr-session-host/capsule",
        dockerfile: "lib/ibkr-session-host/capsule/Dockerfile",
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    return manifest;
  })().finally(() => sourceSnapshot.cleanup());
}

function parseReleaseManifest(value) {
  const manifest = asRecord(value);
  const source = asRecord(manifest?.source);
  const image = asRecord(manifest?.image);
  const expectedConfig = asRecord(image?.expectedConfig);
  const attestations = asRecord(manifest?.attestations);
  const labels = asRecord(image?.labels);
  const labelNames = labels ? Object.keys(labels).sort() : [];
  if (
    manifest?.schema !== RELEASE_SCHEMA ||
    source?.clean !== true ||
    !COMMIT_PATTERN.test(String(source?.commit ?? "")) ||
    typeof image?.reference !== "string" ||
    !isImmutableCapsuleImageReference(image.reference) ||
    !image.reference.includes("@") ||
    !SHA256_PATTERN.test(String(image?.digest ?? "")) ||
    !image.reference.endsWith(`@${image.digest}`) ||
    image?.platform !== "linux/amd64" ||
    !SHA256_PATTERN.test(String(image?.localImageId ?? "")) ||
    expectedConfig?.architecture !== "amd64" ||
    expectedConfig?.os !== "linux" ||
    expectedConfig?.user !== "10001:10001" ||
    !Array.isArray(expectedConfig?.entrypoint) ||
    expectedConfig.entrypoint.length !== 1 ||
    expectedConfig.entrypoint[0] !==
      "/usr/local/bin/pyrus-capsule-supervisor.py" ||
    expectedConfig?.healthcheck !== null ||
    expectedConfig?.volumes !== null ||
    !IDENTITY_PATTERN.test(
      String(attestations?.workloadIdentityDigest ?? ""),
    ) ||
    !SHA256_PATTERN.test(String(attestations?.runtimeSpecDigest ?? "")) ||
    !SHA256_PATTERN.test(
      String(attestations?.runtimeAttestationDigest ?? ""),
    ) ||
    !labels ||
    labelNames.join("\0") !==
      [
        "io.pyrus.ibkr.capsule-lease-protocol",
        "io.pyrus.ibkr.runtime-spec",
        "io.pyrus.ibkr.workload-identity",
        "org.opencontainers.image.revision",
      ]
        .sort()
        .join("\0")
  ) {
    throw new Error("The capsule release manifest is invalid.");
  }
  const expectedAttestation = runtimeAttestationDigestFor({
    imageDigest: image.digest,
    runtimeSpecDigest: attestations.runtimeSpecDigest,
    sourceCommit: source.commit,
    workloadIdentityDigest: attestations.workloadIdentityDigest,
  });
  if (
    attestations.runtimeAttestationDigest !== expectedAttestation ||
    labels["io.pyrus.ibkr.runtime-spec"] !== attestations.runtimeSpecDigest ||
    labels["io.pyrus.ibkr.workload-identity"] !==
      attestations.workloadIdentityDigest ||
    labels["org.opencontainers.image.revision"] !== source.commit ||
    labels["io.pyrus.ibkr.capsule-lease-protocol"] !== "1"
  ) {
    throw new Error("The capsule release manifest is internally inconsistent.");
  }
  return manifest;
}

export async function readCapsuleReleaseManifest(manifestPath) {
  let bytes;
  try {
    bytes = await readFile(path.resolve(manifestPath));
    const manifest = parseReleaseManifest(JSON.parse(bytes.toString("utf8")));
    return { bytes, manifest };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("The capsule release manifest")
    ) {
      throw error;
    }
    throw new Error("The capsule release manifest could not be read.");
  }
}

export async function preloadCapsuleRelease(input) {
  const { manifest } = await readCapsuleReleaseManifest(input.manifestPath);
  return preloadCapsuleImage(manifest.image.reference, {
    expectedLabels: manifest.image.labels,
    runCommand: input.runCommand ?? execFileCommand,
  });
}

function usage() {
  return [
    "Usage:",
    "  node scripts/ibkr-capsule-release.mjs publish --repository=REGISTRY/OWNER/IMAGE --manifest=PATH [--metadata=PATH] [--build-network=default|host]",
    "  node scripts/ibkr-capsule-release.mjs preload --manifest=PATH",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      "build-network": { type: "string" },
      manifest: { type: "string" },
      metadata: { type: "string" },
      repository: { type: "string" },
    },
    strict: true,
  });
  const command = positionals[0];
  if (positionals.length !== 1 || !values.manifest) {
    throw new Error(usage());
  }
  if (command === "publish") {
    if (!values.repository) throw new Error(usage());
    const manifestPath = path.resolve(values.manifest);
    const metadataPath = path.resolve(
      values.metadata ?? `${manifestPath}.build-metadata.json`,
    );
    const manifest = await publishCapsuleRelease({
      buildNetwork: values["build-network"],
      manifestPath,
      metadataPath,
      repository: values.repository,
    });
    console.log(
      JSON.stringify({
        imageReference: manifest.image.reference,
        manifestPath,
        runtimeAttestationDigest:
          manifest.attestations.runtimeAttestationDigest,
        runtimeSpecDigest: manifest.attestations.runtimeSpecDigest,
        workloadIdentityDigest: manifest.attestations.workloadIdentityDigest,
      }),
    );
    return;
  }
  if (
    command === "preload" &&
    !values.repository &&
    !values.metadata &&
    !values["build-network"]
  ) {
    const result = await preloadCapsuleRelease({
      manifestPath: values.manifest,
    });
    console.log(JSON.stringify(result));
    return;
  }
  throw new Error(usage());
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[ibkr-capsule-release] ${
        error instanceof Error ? error.message : "failed"
      }`,
    );
    process.exitCode = 1;
  }
}
