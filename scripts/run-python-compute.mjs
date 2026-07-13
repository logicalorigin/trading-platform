#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = resolve(repoRoot, "python/pyrus_compute");

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

const child = spawn("uv", args, {
  cwd: pythonRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
