#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProcessGroupShutdownController,
  normalizeProcessErrorCode,
  waitForProcessGroupChild,
} from "./process-group-child.mjs";

const MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS = 5_000;
const TERMINAL_CONTROLS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

class RunnerError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function safeDisplay(value, maxCodePoints = 300) {
  const normalized = String(value ?? "")
    .replace(TERMINAL_CONTROLS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const points = Array.from(normalized);
  return points.length <= maxCodePoints
    ? normalized
    : `${points.slice(0, maxCodePoints).join("")}…`;
}

export function commandIsAvailable(command, { spawnCommand = spawnSync } = {}) {
  if (typeof command !== "string" || !command || command.includes("\0")) {
    return false;
  }
  const result = spawnCommand(
    "sh",
    ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command],
    { stdio: "ignore", timeout: 5_000 },
  );
  return !result.error && result.status === 0;
}

const shellQuote = (value) => `'${String(value).replace(/'/gu, "'\\''")}'`;

export function resolveMarketDataWorkerCommand(
  args,
  { hasCommand = commandIsAvailable } = {},
) {
  if (
    !Array.isArray(args) ||
    !args.length ||
    args.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    )
  ) {
    throw new RunnerError(
      "Usage: node scripts/run-market-data-worker.mjs <cargo args...>",
      2,
    );
  }
  if (hasCommand("cargo")) {
    return { command: "cargo", commandArgs: [...args] };
  }
  if (hasCommand("nix-shell")) {
    return {
      command: "nix-shell",
      commandArgs: [
        "-p",
        "cargo",
        "rustc",
        "rustfmt",
        "pkg-config",
        "openssl",
        "--run",
        ["cargo", ...args].map(shellQuote).join(" "),
      ],
    };
  }
  throw new RunnerError("Neither cargo nor nix-shell is available.", 127);
}

export async function runMarketDataWorker(
  args,
  {
    error = console.error,
    hasCommand = commandIsAvailable,
    shutdownGraceMs = MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS,
    spawnChild = spawn,
  } = {},
) {
  if (
    typeof error !== "function" ||
    typeof hasCommand !== "function" ||
    typeof spawnChild !== "function" ||
    !Number.isSafeInteger(shutdownGraceMs) ||
    shutdownGraceMs <= 0 ||
    shutdownGraceMs > 60_000
  ) {
    throw new Error("Market-data runner dependencies are invalid");
  }
  const { command, commandArgs } = resolveMarketDataWorkerCommand(args, {
    hasCommand,
  });
  const shutdown = createProcessGroupShutdownController({
    graceMs: shutdownGraceMs,
    onSignalError(signal, signalError) {
      error(
        `Could not forward ${signal} to market-data worker: ${safeDisplay(signalError?.message || signalError)}`,
      );
    },
  });
  let outcome;
  try {
    const child = spawnChild(command, commandArgs, {
      detached: true,
      stdio: "inherit",
    });
    outcome = await waitForProcessGroupChild(child, shutdown);
  } catch (caughtError) {
    outcome = shutdown.finish(
      127,
      null,
      normalizeProcessErrorCode(caughtError),
    );
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    outcome = shutdown.complete(
      outcome ?? {
        code: 127,
        signal: null,
        errorCode: "WORKER_START_FAILED",
      },
    );
  }
  if (outcome.errorCode) {
    error(`Could not start market-data worker (${outcome.errorCode})`);
  }
  return outcome;
}

async function main(args = process.argv.slice(2)) {
  try {
    const outcome = await runMarketDataWorker(args);
    if (outcome.wrapperSignal) {
      process.kill(process.pid, outcome.wrapperSignal);
      return;
    }
    process.exitCode = outcome.code;
  } catch (error) {
    console.error(safeDisplay(error?.message || error));
    process.exitCode = Number.isSafeInteger(error?.exitCode)
      ? error.exitCode
      : 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
