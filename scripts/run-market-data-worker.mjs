#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS = 5_000;

if (!args.length) {
  console.error("Usage: node scripts/run-market-data-worker.mjs <cargo args...>");
  process.exit(2);
}

const hasCommand = (command) =>
  spawnSync("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], {
    stdio: "ignore",
  }).status === 0;

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

let command;
let commandArgs;
if (hasCommand("cargo")) {
  command = "cargo";
  commandArgs = args;
} else if (hasCommand("nix-shell")) {
  command = "nix-shell";
  commandArgs = [
    "-p",
    "cargo",
    "rustc",
    "rustfmt",
    "pkg-config",
    "openssl",
    "--run",
    ["cargo", ...args].map(shellQuote).join(" "),
  ];
} else {
  console.error("Neither cargo nor nix-shell is available.");
  process.exit(127);
}

const child = spawn(command, commandArgs, {
  detached: true,
  stdio: "inherit",
});

let shutdownForwarded = false;
let killTimer = null;

function signalExitCode(signal) {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}

function signalChildGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Ignore already-exited children.
    }
  }
}

function forwardShutdown(signal) {
  if (shutdownForwarded) return;
  shutdownForwarded = true;
  signalChildGroup(signal);
  killTimer = setTimeout(
    () => signalChildGroup("SIGKILL"),
    MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS,
  );
  killTimer.unref?.();
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.once(signal, () => forwardShutdown(signal));
}

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (killTimer) clearTimeout(killTimer);
  if (typeof code === "number") {
    process.exit(code);
  }
  process.exit(signal ? signalExitCode(signal) : 1);
});
