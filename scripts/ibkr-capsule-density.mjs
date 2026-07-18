#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { readCapsuleReleaseManifest } from "./ibkr-capsule-release.mjs";
import { preloadCapsuleImage } from "./lib/ibkr-capsule-image.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const densityEntry = path.join(
  repoRoot,
  "lib/ibkr-session-host/dist/density.mjs",
);

function validateOperatorText(name, value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`The ${name} is invalid.`);
  }
}

async function spawnDensity(args) {
  await access(densityEntry);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [densityEntry, ...args], {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    const forwardSigint = () => child.kill("SIGINT");
    const forwardSigterm = () => child.kill("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    };
    process.on("SIGINT", forwardSigint);
    process.on("SIGTERM", forwardSigterm);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      cleanup();
      resolve(code ?? 1);
    });
  });
}

async function assertDefaultRunnerReady(reportPath) {
  await Promise.all([access(densityEntry), access(path.dirname(reportPath))]);
  try {
    await access(reportPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error("The capsule density report path must be new.");
}

export async function runCapsuleDensityRelease(input, options = {}) {
  if (input.execute !== true) {
    throw new Error("Capsule density execution requires --execute.");
  }
  const env = options.env ?? process.env;
  if (
    env.IBKR_GATEWAY_FLEET_ENABLED !== "0" ||
    env.IBKR_SESSION_HOST_ENABLED !== "0"
  ) {
    throw new Error(
      "Capsule density execution requires fleet routing and the production session host to be explicitly disabled.",
    );
  }
  validateOperatorText("deployment ID", input.deploymentId);
  validateOperatorText("VM size", input.vmSize);
  validateOperatorText("manifest path", input.manifestPath);
  validateOperatorText("report path", input.reportPath);

  const reportPath = path.resolve(input.reportPath);
  if (options.runDensity === undefined) {
    await assertDefaultRunnerReady(reportPath);
  }
  const readManifest = options.readManifest ?? readCapsuleReleaseManifest;
  const preloadImage = options.preloadImage ?? preloadCapsuleImage;
  const runDensity = options.runDensity ?? spawnDensity;
  const { bytes, manifest } = await readManifest(input.manifestPath);
  await preloadImage(manifest.image.reference, {
    expectedLabels: manifest.image.labels,
  });
  const manifestSha256 = `sha256:${createHash("sha256")
    .update(bytes)
    .digest("hex")}`;
  return runDensity([
    `--image=${manifest.image.reference}`,
    `--manifest-sha256=${manifestSha256}`,
    `--release-commit=${manifest.source.commit}`,
    `--runtime-spec-digest=${manifest.attestations.runtimeSpecDigest}`,
    `--runtime-attestation-digest=${manifest.attestations.runtimeAttestationDigest}`,
    `--workload-identity-digest=${manifest.attestations.workloadIdentityDigest}`,
    `--deployment-id=${input.deploymentId}`,
    `--vm-size=${input.vmSize}`,
    `--report=${reportPath}`,
    "--execute",
  ]);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/ibkr-capsule-density.mjs --manifest=PATH --report=PATH --deployment-id=ID --vm-size=SIZE --execute",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "deployment-id": { type: "string" },
      execute: { type: "boolean", default: false },
      manifest: { type: "string" },
      report: { type: "string" },
      "vm-size": { type: "string" },
    },
    strict: true,
  });
  if (
    !values.manifest ||
    !values.report ||
    !values["deployment-id"] ||
    !values["vm-size"]
  ) {
    throw new Error(usage());
  }
  const code = await runCapsuleDensityRelease({
    deploymentId: values["deployment-id"],
    execute: values.execute,
    manifestPath: values.manifest,
    reportPath: values.report,
    vmSize: values["vm-size"],
  });
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[ibkr-capsule-density] ${
        error instanceof Error ? error.message : "failed"
      }`,
    );
    process.exitCode = 1;
  }
}
