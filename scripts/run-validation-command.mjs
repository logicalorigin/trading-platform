#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  createProcessGroupShutdownController,
  normalizeProcessErrorCode,
  waitForProcessGroupChild,
} from "./process-group-child.mjs";
import { readProcIdentity } from "./replit-process-authority.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_LEDGER = path.join(
  repoRoot,
  ".pyrus-runtime",
  "validation",
  "commands.jsonl",
);
export const DEFAULT_VALIDATION_LOCK_FILE = path.join(
  repoRoot,
  ".pyrus-runtime",
  "validation",
  "validation.lock",
);
export const DEFAULT_VALIDATION_NODE_OPTIONS = "--max-old-space-size=3072";
const MAX_LOCK_BYTES = 16 * 1024;
const MAX_LEDGER_EVENT_BYTES = 16 * 1024;
const CHILD_SHUTDOWN_GRACE_MS = 5_000;
const TERMINAL_CONTROLS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export const MAX_VALIDATION_LEDGER_BYTES = 1024 * 1024;

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

function usage(writeLine = console.error) {
  writeLine(`Usage: node scripts/run-validation-command.mjs [options] -- <command> [args...]

Options:
  --label NAME              Ledger label for the validation command.
  --ledger PATH             Validation command JSONL ledger.
  --lock-file PATH          Single-validation lock file.

Environment overrides:
  NODE_OPTIONS              Defaults to ${DEFAULT_VALIDATION_NODE_OPTIONS} when unset.
`);
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function labelIsValid(label) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(label ?? "");
}

export function parseValidationArgs(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    return { help: true };
  }

  const parsed = {
    label: null,
    ledgerPath: DEFAULT_LEDGER,
    lockFile: DEFAULT_VALIDATION_LOCK_FILE,
    command: [],
  };
  const seen = new Set();
  let delimiterSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      parsed.command = argv.slice(index + 1);
      delimiterSeen = true;
      break;
    }
    if (["--help", "-h"].includes(arg)) {
      throw new Error(`${arg} must be used by itself`);
    }
    if (!["--label", "--ledger", "--lock-file"].includes(arg)) {
      throw new Error(`Unknown argument: ${safeDisplay(arg)}`);
    }
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    const value = optionValue(argv, index, arg);
    if (arg === "--label") parsed.label = value;
    if (arg === "--ledger") parsed.ledgerPath = path.resolve(value);
    if (arg === "--lock-file") parsed.lockFile = path.resolve(value);
    index += 1;
  }

  if (!delimiterSeen || !parsed.command.length || !parsed.command[0]) {
    throw new Error("Missing command after --");
  }
  if (parsed.command[0].includes("\0")) {
    throw new Error("Command must not contain NUL bytes");
  }
  parsed.label = parsed.label ?? path.basename(parsed.command[0]);
  if (!labelIsValid(parsed.label)) {
    throw new Error(
      "Label must use 1-80 letters, numbers, dots, underscores, colons, or hyphens",
    );
  }
  if (parsed.ledgerPath === parsed.lockFile) {
    throw new Error("Ledger and lock file must use different paths");
  }
  return parsed;
}

function mkdirFor(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function readLockState(lockFile) {
  let descriptor;
  try {
    descriptor = openSync(lockFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile())
      throw new Error("Validation lock must be a regular file");
    const signature = {
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
    if (stats.size > MAX_LOCK_BYTES) {
      return { parsed: null, raw: null, signature };
    }
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const raw = buffer.subarray(0, offset).toString("utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed lock has no claimable owner identity.
    }
    return { parsed, raw, signature };
  } finally {
    closeSync(descriptor);
  }
}

function sameLockState(left, right) {
  return (
    left?.raw === right?.raw &&
    left?.signature?.dev === right?.signature?.dev &&
    left?.signature?.ino === right?.signature?.ino &&
    left?.signature?.size === right?.signature?.size &&
    left?.signature?.mtimeMs === right?.signature?.mtimeMs
  );
}

function pidIsLive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockOwnerIsLive(lock, hostname = os.hostname()) {
  const owner = lock?.parsed;
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    return true;
  }
  if (typeof owner.host === "string" && owner.host !== hostname) {
    return true;
  }
  const identity = readProcIdentity(owner.pid);
  if (!identity) return pidIsLive(owner.pid);
  if (typeof owner.startTimeTicks !== "string") return true;
  return identity.startTimeTicks === owner.startTimeTicks;
}

function removeUnchangedLock(lockFile, expected) {
  const current = readLockState(lockFile);
  if (!sameLockState(expected, current)) return false;
  // ponytail: Node exposes no unlink-by-inode primitive; this immediate
  // identity/content recheck is the filesystem ceiling before path removal.
  const final = readLockState(lockFile);
  if (!sameLockState(current, final)) return false;
  rmSync(lockFile);
  return true;
}

function removeTempIfOwned(tempPath, identity) {
  try {
    const state = readLockState(tempPath);
    if (
      state?.signature?.dev === identity?.dev &&
      state?.signature?.ino === identity?.ino
    ) {
      rmSync(tempPath);
    }
  } catch {
    // A leftover private temp path is not the published validation lock.
  }
}

function publishLock(lockFile, body, afterPublish) {
  const tempPath = path.join(
    path.dirname(lockFile),
    `.${path.basename(lockFile)}.${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor;
  let identity = null;
  try {
    descriptor = openSync(
      tempPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    const stats = fstatSync(descriptor);
    identity = { dev: stats.dev, ino: stats.ino };
    writeFileSync(descriptor, body, "utf8");
    fchmodSync(descriptor, 0o600);
    linkSync(tempPath, lockFile);
    afterPublish?.(lockFile);
    const published = readLockState(lockFile);
    if (
      published?.signature?.dev !== identity.dev ||
      published?.signature?.ino !== identity.ino ||
      published.raw !== body
    ) {
      throw new Error("Published validation lock failed identity verification");
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    removeTempIfOwned(tempPath, identity);
    throw error;
  }
  closeSync(descriptor);
  removeTempIfOwned(tempPath, identity);
}

export function createValidationLock(lockFile, label, { afterPublish } = {}) {
  mkdirFor(lockFile);
  const selfIdentity = readProcIdentity(process.pid);
  if (!selfIdentity?.startTimeTicks) {
    throw new Error("Cannot establish validation lock process identity");
  }
  const lockId = randomUUID();
  const body = JSON.stringify({
    schemaVersion: 2,
    lockId,
    pid: process.pid,
    startTimeTicks: selfIdentity.startTimeTicks,
    label,
    createdAt: new Date().toISOString(),
    host: os.hostname(),
  });

  let staleRemoved = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      publishLock(lockFile, body, afterPublish);
      return { acquired: true, lockId, existing: null, staleRemoved };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readLockState(lockFile);
      if (!existing) continue;
      if (lockOwnerIsLive(existing)) {
        const owner = existing.parsed ?? {};
        return {
          acquired: false,
          lockId: null,
          staleRemoved,
          existing: {
            pid: Number.isSafeInteger(owner.pid) ? owner.pid : null,
            label: safeDisplay(owner.label || "unknown", 80),
            createdAt:
              typeof owner.createdAt === "string" ? owner.createdAt : null,
          },
        };
      }
      staleRemoved = removeUnchangedLock(lockFile, existing) || staleRemoved;
    }
  }
  return {
    acquired: false,
    lockId: null,
    staleRemoved,
    existing: null,
  };
}

export function removeValidationLock(lockFile, lockId) {
  try {
    const state = readLockState(lockFile);
    if (!state || state.parsed?.lockId !== lockId) return false;
    return removeUnchangedLock(lockFile, state);
  } catch {
    return false;
  }
}

function ledgerNeedsSchemaReset(descriptor, size) {
  if (size === 0) return false;
  if (size > MAX_VALIDATION_LEDGER_BYTES) return false;
  const contents = Buffer.alloc(size);
  let offset = 0;
  while (offset < contents.length) {
    const bytesRead = readSync(
      descriptor,
      contents,
      offset,
      contents.length - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  for (const line of contents
    .subarray(0, offset)
    .toString("utf8")
    .split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (
        event?.schemaVersion !== 2 ||
        "command" in event ||
        "commandSummary" in event ||
        "existingLock" in event
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

export function writeValidationLedger(ledgerPath, event) {
  const line = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  if (line.byteLength > MAX_LEDGER_EVENT_BYTES) {
    throw new Error("Validation ledger event exceeds the byte limit");
  }
  mkdirFor(ledgerPath);
  let descriptor;
  try {
    descriptor = openSync(
      ledgerPath,
      constants.O_CREAT |
        constants.O_RDWR |
        constants.O_APPEND |
        constants.O_NOFOLLOW,
      0o600,
    );
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new Error("Validation ledger must be a regular file");
    }
    fchmodSync(descriptor, 0o600);
    const resetReason = ledgerNeedsSchemaReset(descriptor, stats.size)
      ? "legacy-sensitive-schema"
      : stats.size + line.byteLength > MAX_VALIDATION_LEDGER_BYTES
        ? "size-cap"
        : null;
    if (resetReason) {
      ftruncateSync(descriptor, 0);
      writeFileSync(
        descriptor,
        `${JSON.stringify({
          schemaVersion: 2,
          time: new Date().toISOString(),
          event: "ledger-reset",
          reason: resetReason,
        })}\n`,
        "utf8",
      );
    }
    writeFileSync(descriptor, line);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertValidationOptions(options) {
  if (
    !Array.isArray(options?.command) ||
    !options.command.length ||
    options.command.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    ) ||
    !options.command[0]
  ) {
    throw new Error("Validation command is required");
  }
  if (
    typeof options.ledgerPath !== "string" ||
    typeof options.lockFile !== "string" ||
    options.ledgerPath.includes("\0") ||
    options.lockFile.includes("\0") ||
    path.resolve(options.ledgerPath) === path.resolve(options.lockFile)
  ) {
    throw new Error("Ledger and lock file must use different paths");
  }
  if (!labelIsValid(options.label)) {
    throw new Error("Validation label is invalid");
  }
}

function resolveValidationStatePaths(options) {
  mkdirFor(options.ledgerPath);
  mkdirFor(options.lockFile);
  const ledgerPath = path.join(
    realpathSync(path.dirname(options.ledgerPath)),
    path.basename(options.ledgerPath),
  );
  const lockFile = path.join(
    realpathSync(path.dirname(options.lockFile)),
    path.basename(options.lockFile),
  );
  if (ledgerPath === lockFile) {
    throw new Error("Ledger and lock file must use different physical paths");
  }
  let ledgerStats = null;
  let lockStats = null;
  try {
    ledgerStats = lstatSync(ledgerPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    lockStats = lstatSync(lockFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (
    ledgerStats &&
    lockStats &&
    ledgerStats.dev === lockStats.dev &&
    ledgerStats.ino === lockStats.ino
  ) {
    throw new Error("Ledger and lock file must not share an inode");
  }
  return { ledgerPath, lockFile };
}

export async function runValidationCommand(
  inputOptions,
  {
    afterFinishingLedger,
    beforeLock,
    error = console.error,
    shutdownGraceMs = CHILD_SHUTDOWN_GRACE_MS,
    spawnChild = spawn,
  } = {},
) {
  assertValidationOptions(inputOptions);
  if (
    !Number.isSafeInteger(shutdownGraceMs) ||
    shutdownGraceMs <= 0 ||
    shutdownGraceMs > 60_000 ||
    (afterFinishingLedger !== undefined &&
      typeof afterFinishingLedger !== "function") ||
    (beforeLock !== undefined && typeof beforeLock !== "function") ||
    typeof error !== "function" ||
    typeof spawnChild !== "function"
  ) {
    throw new Error("Validation runner dependencies are invalid");
  }
  const options = {
    ...inputOptions,
    ...resolveValidationStatePaths(inputOptions),
  };
  const shutdown = createProcessGroupShutdownController({
    graceMs: shutdownGraceMs,
    onSignalError(signal, signalError) {
      error(
        `Could not forward ${signal} to validation child: ${safeDisplay(signalError?.message || signalError)}`,
      );
    },
  });
  const startedAt = new Date();
  const startedMonotonic = performance.now();
  const baseEvent = {
    schemaVersion: 2,
    time: startedAt.toISOString(),
    event: "validation-command",
    label: options.label,
    pid: process.pid,
  };
  let lock = null;
  let outcome = { code: 1, signal: null, errorCode: "VALIDATION_FAILED" };
  let startedLogged = false;
  let refusalReason = null;
  try {
    beforeLock?.();
    lock = createValidationLock(options.lockFile, options.label);
    if (!lock.acquired) {
      const owner = lock.existing;
      error(
        `Refusing ${options.label}: validation lock is held${owner?.pid ? ` by pid ${owner.pid}` : ""}${owner?.label ? ` (${owner.label})` : ""}`,
      );
      outcome = shutdown.finish(75, null, "VALIDATION_LOCK_HELD");
      refusalReason = "validation-lock-held";
    } else {
      writeValidationLedger(options.ledgerPath, {
        ...baseEvent,
        status: "started",
      });
      startedLogged = true;
      const env = {
        ...process.env,
        NODE_OPTIONS:
          process.env.NODE_OPTIONS ?? DEFAULT_VALIDATION_NODE_OPTIONS,
      };
      const child = spawnChild(options.command[0], options.command.slice(1), {
        cwd: process.cwd(),
        detached: true,
        env,
        stdio: "inherit",
      });
      outcome = await waitForProcessGroupChild(child, shutdown);
    }
  } catch (caughtError) {
    outcome = shutdown.finish(
      127,
      null,
      normalizeProcessErrorCode(caughtError),
    );
    error(
      `Validation ${options.label} failed: ${safeDisplay(caughtError?.message || caughtError)}`,
    );
  } finally {
    if (startedLogged) {
      try {
        writeValidationLedger(options.ledgerPath, {
          ...baseEvent,
          time: new Date().toISOString(),
          status: "finishing",
          exit: outcome,
          durationMs: Math.max(0, performance.now() - startedMonotonic),
        });
      } catch (ledgerError) {
        error(
          `Could not finalize validation ledger: ${safeDisplay(ledgerError?.message || ledgerError)}`,
        );
        if (outcome.code === 0 && !outcome.signal) {
          outcome = {
            code: 1,
            signal: null,
            errorCode: "LEDGER_FINALIZE_FAILED",
          };
        }
      }
    }
    try {
      afterFinishingLedger?.();
    } catch (hookError) {
      error(
        `Validation finalization failed: ${safeDisplay(hookError?.message || hookError)}`,
      );
      if (outcome.code === 0 && !outcome.signal) {
        outcome = {
          code: 1,
          signal: null,
          errorCode: "VALIDATION_FINALIZE_FAILED",
        };
      }
    }
    if (
      lock?.acquired &&
      !removeValidationLock(options.lockFile, lock.lockId)
    ) {
      error(
        "Validation lock ownership changed before cleanup; the replacement lock was preserved",
      );
      if (outcome.code === 0 && !outcome.signal) {
        outcome = {
          code: 1,
          signal: null,
          errorCode: "LOCK_CLEANUP_FAILED",
        };
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
    outcome = shutdown.complete(outcome);
    if (startedLogged) {
      try {
        writeValidationLedger(options.ledgerPath, {
          ...baseEvent,
          time: new Date().toISOString(),
          status: "finished",
          exit: outcome,
          durationMs: Math.max(0, performance.now() - startedMonotonic),
        });
      } catch (ledgerError) {
        error(
          `Could not write final validation outcome: ${safeDisplay(ledgerError?.message || ledgerError)}`,
        );
        if (outcome.code === 0 && !outcome.signal) {
          outcome = {
            code: 1,
            signal: null,
            errorCode: "LEDGER_FINALIZE_FAILED",
          };
        }
      }
    }
  }
  return refusalReason ? { ...outcome, reason: refusalReason } : outcome;
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseValidationArgs(argv);
  } catch (error) {
    console.error(safeDisplay(error?.message || error));
    usage();
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    usage(console.log);
    return;
  }
  const outcome = await runValidationCommand(options);
  if (outcome.wrapperSignal) {
    process.kill(process.pid, outcome.wrapperSignal);
    return;
  }
  process.exitCode = outcome.code;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(safeDisplay(error?.message || error));
    process.exitCode = 1;
  });
}
