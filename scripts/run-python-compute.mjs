#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = resolve(repoRoot, "python/pyrus_compute");

const commands = {
  doctor: ["run", "python", "-m", "pyrus_compute.doctor"],
  benchmark: ["run", "python", "-m", "pyrus_compute.benchmark"],
  service: ["run", "python", "-m", "pyrus_compute.service"],
  lint: ["run", "ruff", "check"],
  typecheck: ["run", "mypy", "src"],
  test: ["run", "pytest"],
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
