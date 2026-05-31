#!/usr/bin/env node
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RECORDER_DIR = path.join(
  repoRoot,
  ".pyrus-runtime",
  "flight-recorder",
);
const DEFAULT_LEDGER = path.join(
  repoRoot,
  ".pyrus-runtime",
  "validation",
  "commands.jsonl",
);
const DEFAULT_LOCK_FILE = path.join(
  repoRoot,
  ".pyrus-runtime",
  "validation",
  "validation.lock",
);
const DEFAULT_SUPERVISOR_LOCK = "/tmp/pyrus/pyrus-dev-supervisor-8080.lock";
const HOT_RUNTIME_WINDOW_MS = 120_000;
const DEFAULT_NODE_OPTIONS = "--max-old-space-size=3072";

function usage() {
  console.error(`Usage: node scripts/run-validation-command.mjs [options] -- <command> [args...]

Options:
  --label NAME              Ledger label for the validation command.
  --recorder-dir PATH       PYRUS flight-recorder directory.
  --ledger PATH             Validation command JSONL ledger.
  --lock-file PATH          Single-validation lock file.
  --supervisor-lock PATH    PYRUS dev supervisor lock file.
  --allow-hot-app           Allow execution even when the live app is hot.
  --no-live-runtime-guard   Disable live-runtime admission checks.

Environment overrides:
  PYRUS_ALLOW_HOT_VALIDATION=1   Bypass hot app refusal intentionally.
  CI=1                           Bypass hot app refusal for CI.
`);
}

function parseArgs(argv) {
  const parsed = {
    label: null,
    recorderDir: DEFAULT_RECORDER_DIR,
    ledgerPath: DEFAULT_LEDGER,
    lockFile: DEFAULT_LOCK_FILE,
    supervisorLock: DEFAULT_SUPERVISOR_LOCK,
    allowHotApp: false,
    liveRuntimeGuard: true,
    command: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      parsed.command = argv.slice(index + 1);
      break;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--label") {
      parsed.label = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--recorder-dir") {
      parsed.recorderDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--ledger") {
      parsed.ledgerPath = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--lock-file") {
      parsed.lockFile = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--supervisor-lock") {
      parsed.supervisorLock = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--allow-hot-app") {
      parsed.allowHotApp = true;
      continue;
    }
    if (arg === "--no-live-runtime-guard") {
      parsed.liveRuntimeGuard = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.command.length) {
    throw new Error("Missing command after --");
  }

  parsed.label = parsed.label ?? parsed.command[0];
  return parsed;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function msSince(value, nowMs) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return nowMs - parsed;
}

function runtimePhase(current) {
  return (
    current?.lifecycle?.phase ??
    current?.lastEvent?.phase ??
    current?.lastEvent?.event ??
    null
  );
}

function isRunningSupervisor(current, nowMs) {
  if (!current || typeof current !== "object") {
    return false;
  }
  const updatedAgoMs = msSince(current.updatedAt, nowMs);
  if (updatedAgoMs > HOT_RUNTIME_WINDOW_MS) {
    return false;
  }
  const phase = runtimePhase(current);
  return (
    phase === "running" ||
    current?.supervisor?.lockAcquired === true ||
    current?.lastEvent?.lockAcquired === true
  );
}

function readProcessCommand(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replaceAll("\0", " ")
      .trim();
  } catch {
    return "";
  }
}

function collectSupervisorLockEvidence(supervisorLock) {
  const lock = readJson(supervisorLock);
  const pid = Number(lock?.pid);
  const live =
    Number.isInteger(pid) &&
    pid > 0 &&
    pidIsLive(pid) &&
    readProcessCommand(pid).includes("runDevApp.mjs");
  return lock
    ? {
        path: supervisorLock,
        pid: Number.isInteger(pid) ? pid : null,
        startedAt: lock.startedAt ?? null,
        apiPort: lock.apiPort ?? null,
        webPort: lock.webPort ?? null,
        live,
      }
    : null;
}

function collectRuntimeEvidence(recorderDir, supervisorLock, nowMs) {
  const supervisor = readJson(path.join(recorderDir, "current.json"));
  const api = readJson(path.join(recorderDir, "api-current.json"));
  const supervisorRunning = isRunningSupervisor(supervisor, nowMs);
  const supervisorLockEvidence = collectSupervisorLockEvidence(supervisorLock);
  const apiUpdatedAgoMs = msSince(api?.updatedAt, nowMs);
  return {
    recorderDir,
    supervisor: supervisor
      ? {
          updatedAt: supervisor.updatedAt ?? null,
          phase: runtimePhase(supervisor),
          pid: supervisor?.supervisor?.pid ?? supervisor?.lastEvent?.pid ?? null,
          apiPid: supervisor?.lastEvent?.apiPid ?? null,
          webPid: supervisor?.lastEvent?.webPid ?? null,
          bootId: supervisor?.boot?.bootId ?? null,
          lockAcquired:
            supervisor?.supervisor?.lockAcquired ??
            supervisor?.lastEvent?.lockAcquired ??
            null,
          running: supervisorRunning,
        }
      : null,
    api: api
      ? {
          updatedAt: api.updatedAt ?? null,
          pid: api.pid ?? null,
          pressure: api?.apiPressure?.level ?? null,
          rssMb: api?.memoryMb?.rss ?? null,
          p95Ms: api?.requests?.p95Ms ?? null,
          fresh: apiUpdatedAgoMs <= HOT_RUNTIME_WINDOW_MS,
        }
      : null,
    supervisorLock: supervisorLockEvidence,
    hotRuntime: supervisorRunning || supervisorLockEvidence?.live === true,
  };
}

function mkdirFor(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeLedger(ledgerPath, event) {
  mkdirFor(ledgerPath);
  appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`);
}

function readLock(lockFile) {
  try {
    return JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

function pidIsLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function createLock(lockFile, label) {
  mkdirFor(lockFile);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          label,
          command: process.argv.slice(2),
          createdAt: new Date().toISOString(),
          host: os.hostname(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      return { acquired: true, existing: null, staleRemoved: attempt > 0 };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const existing = readLock(lockFile);
      if (pidIsLive(existing?.pid)) {
        return { acquired: false, existing, staleRemoved: false };
      }
      rmSync(lockFile, { force: true });
    }
  }
  return { acquired: false, existing: readLock(lockFile), staleRemoved: false };
}

function removeLock(lockFile) {
  try {
    rmSync(lockFile, { force: true });
  } catch {
    // Best effort cleanup.
  }
}

function shouldAllowHotApp(options) {
  return (
    options.allowHotApp ||
    process.env.PYRUS_ALLOW_HOT_VALIDATION === "1" ||
    process.env.CI === "1"
  );
}

function commandSummary(command) {
  return command.join(" ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runtime = collectRuntimeEvidence(
    options.recorderDir,
    options.supervisorLock,
    startedAt.getTime(),
  );
  const baseEvent = {
    schemaVersion: 1,
    time: startedAt.toISOString(),
    event: "validation-command",
    label: options.label,
    cwd: process.cwd(),
    command: options.command,
    commandSummary: commandSummary(options.command),
    pid: process.pid,
    runtime,
  };

  if (
    options.liveRuntimeGuard &&
    runtime.hotRuntime &&
    !shouldAllowHotApp(options)
  ) {
    writeLedger(options.ledgerPath, {
      ...baseEvent,
      status: "refused",
      reason: "live-pyrus-runtime-hot",
    });
    console.error(
      [
        `Refusing ${options.label}: live PYRUS/Replit runtime is hot.`,
        "Run a targeted no-emit test, quiesce the app, or set PYRUS_ALLOW_HOT_VALIDATION=1 for an intentional maintenance window.",
        `Ledger: ${options.ledgerPath}`,
      ].join("\n"),
    );
    process.exit(75);
  }

  const lock = createLock(options.lockFile, options.label);
  if (!lock.acquired) {
    writeLedger(options.ledgerPath, {
      ...baseEvent,
      status: "refused",
      reason: "validation-lock-held",
      lockFile: options.lockFile,
      existingLock: lock.existing,
    });
    console.error(`Refusing ${options.label}: validation lock is held at ${options.lockFile}`);
    process.exit(75);
  }

  writeLedger(options.ledgerPath, { ...baseEvent, status: "started" });

  const env = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? DEFAULT_NODE_OPTIONS,
  };

  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  const exit = await new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({ code: 127, signal: null, error: error.message });
    });
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, error: null });
    });
  });

  removeLock(options.lockFile);
  writeLedger(options.ledgerPath, {
    ...baseEvent,
    time: new Date().toISOString(),
    status: "finished",
    exit,
    durationMs: Date.now() - startedAt.getTime(),
  });

  if (exit.signal) {
    process.kill(process.pid, exit.signal);
    return;
  }
  process.exit(exit.code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
});
