#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setImmediate as waitImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  createProcessGroupShutdownController,
  normalizeProcessErrorCode,
  waitForProcessGroupChild,
} from "./process-group-child.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = resolve(repoRoot, "python/pyrus_compute");
const SHUTDOWN_GRACE_MS = 5_000;

const commands = {
  doctor: [
    "run",
    "--locked",
    "--no-env-file",
    "python",
    "-m",
    "pyrus_compute.doctor",
  ],
  benchmark: [
    "run",
    "--locked",
    "--no-env-file",
    "python",
    "-m",
    "pyrus_compute.benchmark",
  ],
  service: [
    "run",
    "--locked",
    "--no-env-file",
    "python",
    "-m",
    "pyrus_compute.service",
  ],
  lint: ["run", "--locked", "--no-env-file", "ruff", "check"],
  typecheck: ["run", "--locked", "--no-env-file", "mypy", "src"],
  test: ["run", "--locked", "--no-env-file", "pytest"],
};

const command = process.argv[2] ?? "doctor";
const args = commands[command];

if (!args) {
  console.error(`Unknown python compute command: ${command}`);
  console.error(`Expected one of: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

const shutdown = createProcessGroupShutdownController({
  graceMs: SHUTDOWN_GRACE_MS,
  onSignalError(signal, error) {
    console.error(
      `Could not forward ${signal} to Python compute: ${normalizeProcessErrorCode(error)}`,
    );
  },
});
let outcome;
try {
  const child = spawn("uv", args, {
    cwd: pythonRoot,
    detached: true,
    env: process.env,
    stdio: "inherit",
  });
  outcome = await waitForProcessGroupChild(child, shutdown);
} catch (error) {
  outcome = shutdown.finish(127, null, normalizeProcessErrorCode(error));
} finally {
  await waitImmediate();
  outcome = shutdown.complete(
    outcome ?? {
      code: 127,
      signal: null,
      errorCode: "PYTHON_COMPUTE_START_FAILED",
    },
  );
}

if (outcome.errorCode) {
  console.error(`Could not start Python compute (${outcome.errorCode})`);
}
if (outcome.wrapperSignal) {
  process.kill(process.pid, outcome.wrapperSignal);
} else {
  process.exitCode = outcome.code;
}
