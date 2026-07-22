import { spawn } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

import {
  createProcessGroupShutdownController,
  normalizeProcessErrorCode,
  waitForProcessGroupChild,
} from "./process-group-child.mjs";

const MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS = 5_000;
const TERMINAL_CONTROLS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export class MarketDataRunnerError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function safeMarketDataDisplay(value, maxCodePoints = 300) {
  const normalized = String(value ?? "")
    .replace(TERMINAL_CONTROLS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const points = Array.from(normalized);
  return points.length <= maxCodePoints
    ? normalized
    : `${points.slice(0, maxCodePoints).join("")}...`;
}

function statTimestampNs(stat, name) {
  const exact = stat[`${name}Ns`];
  if (typeof exact === "bigint") return String(exact);
  const milliseconds = stat[`${name}Ms`];
  return String(BigInt(Math.trunc(Number(milliseconds) * 1_000_000)));
}

export function captureFileIdentity(
  file,
  {
    executable = false,
    accessFile = accessSync,
    realpathFile = realpathSync,
    statFile = statSync,
  } = {},
) {
  if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) {
    throw new Error("Executable identity requires an absolute path");
  }
  const realpath = realpathFile(file);
  if (!path.isAbsolute(realpath)) {
    throw new Error(`Resolved executable path is not absolute: ${realpath}`);
  }
  const stat = statFile(realpath, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Resolved executable is not a regular file: ${realpath}`);
  }
  if (executable) accessFile(realpath, fsConstants.X_OK);
  return {
    realpath,
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    size: String(stat.size),
    mtimeNs: statTimestampNs(stat, "mtime"),
    ctimeNs: statTimestampNs(stat, "ctime"),
    executable,
  };
}

export function captureExecutableIdentity(file, dependencies = {}) {
  return captureFileIdentity(file, {
    ...dependencies,
    executable: true,
  });
}

export function assertFileIdentity(identity, dependencies = {}) {
  if (
    !identity ||
    typeof identity !== "object" ||
    typeof identity.realpath !== "string"
  ) {
    throw new Error("Executable identity is missing");
  }
  const current = captureFileIdentity(identity.realpath, {
    ...dependencies,
    executable: identity.executable === true,
  });
  for (const key of [
    "realpath",
    "dev",
    "ino",
    "mode",
    "size",
    "mtimeNs",
    "ctimeNs",
    "executable",
  ]) {
    if (current[key] !== identity[key]) {
      throw new Error(
        `Executable identity drifted for ${identity.realpath} (${key})`,
      );
    }
  }
  return current;
}

// This catches accidental executable drift between launch preparation and the
// final spawn. It is not an adversarial check-to-exec security boundary.
export function resolveCommandExecutable(
  command,
  {
    cwd = process.cwd(),
    env = process.env,
    captureIdentity = captureExecutableIdentity,
  } = {},
) {
  if (typeof command !== "string" || !command || command.includes("\0")) {
    return null;
  }
  const candidates = command.includes(path.sep)
    ? [path.resolve(cwd, command)]
    : String(env.PATH ?? "")
        .split(path.delimiter)
        .map((entry) => path.resolve(entry || cwd, command));
  for (const candidate of candidates) {
    try {
      return {
        ...captureIdentity(candidate),
        invocationPath: candidate,
      };
    } catch {
      // Match PATH lookup semantics: continue to the next executable entry.
    }
  }
  return null;
}

export function commandIsAvailable(
  command,
  { cwd = process.cwd(), env = process.env } = {},
) {
  return Boolean(resolveCommandExecutable(command, { cwd, env }));
}

const shellQuote = (value) => `'${String(value).replace(/'/gu, "'\\''")}'`;

export function resolveMarketDataWorkerCommand(
  args,
  {
    env = process.env,
    resolveExecutable = (command) =>
      resolveCommandExecutable(command, { env }),
  } = {},
) {
  if (
    !Array.isArray(args) ||
    !args.length ||
    args.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    )
  ) {
    throw new MarketDataRunnerError(
      "Usage: node scripts/run-market-data-worker.mjs <cargo args...>",
      2,
    );
  }
  const cargo = resolveExecutable("cargo");
  if (cargo) {
    return {
      command: cargo.realpath,
      commandArgs: [...args],
      executableIdentity: cargo,
      identityScope: "cargo",
    };
  }
  const nixShell = resolveExecutable("nix-shell");
  if (nixShell) {
    return {
      // nix-shell is commonly a symlink to the multi-call `nix` binary. It
      // must be invoked through the nix-shell path so Nix selects that mode.
      command: nixShell.invocationPath ?? nixShell.realpath,
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
      executableIdentity: nixShell,
      // ponytail: ceiling = the host nix-shell identity. Exact identity for
      // cargo inside the generated Nix environment requires an exec-capable
      // resolver shared with Nix, not a second shell lifecycle implementation.
      identityScope: "nix-shell",
    };
  }
  throw new MarketDataRunnerError(
    "Neither cargo nor nix-shell is available.",
    127,
  );
}

export async function runMarketDataWorker(
  args,
  {
    assertIdentity = assertFileIdentity,
    error = console.error,
    env = process.env,
    resolveExecutable,
    shutdownGraceMs = MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS,
    spawnChild = spawn,
  } = {},
) {
  if (
    typeof assertIdentity !== "function" ||
    typeof error !== "function" ||
    (resolveExecutable !== undefined &&
      typeof resolveExecutable !== "function") ||
    typeof spawnChild !== "function" ||
    !Number.isSafeInteger(shutdownGraceMs) ||
    shutdownGraceMs <= 0 ||
    shutdownGraceMs > 60_000
  ) {
    throw new Error("Market-data runner dependencies are invalid");
  }
  const launch = resolveMarketDataWorkerCommand(args, {
    env,
    ...(resolveExecutable ? { resolveExecutable } : {}),
  });
  const shutdown = createProcessGroupShutdownController({
    graceMs: shutdownGraceMs,
    onSignalError(signal, signalError) {
      error(
        `Could not forward ${signal} to market-data worker: ${safeMarketDataDisplay(signalError?.message || signalError)}`,
      );
    },
  });
  let outcome;
  try {
    assertIdentity(launch.executableIdentity);
    const child = spawnChild(launch.command, launch.commandArgs, {
      detached: true,
      env,
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
