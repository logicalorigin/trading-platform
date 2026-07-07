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
const DEFAULT_NODE_OPTIONS = "--max-old-space-size=3072";

function usage() {
  console.error(`Usage: node scripts/run-validation-command.mjs [options] -- <command> [args...]

Options:
  --label NAME              Ledger label for the validation command.
  --ledger PATH             Validation command JSONL ledger.
  --lock-file PATH          Single-validation lock file.

Environment overrides:
  NODE_OPTIONS              Defaults to ${DEFAULT_NODE_OPTIONS} when unset.
`);
}

function parseArgs(argv) {
  const parsed = {
    label: null,
    ledgerPath: DEFAULT_LEDGER,
    lockFile: DEFAULT_LOCK_FILE,
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.command.length) {
    throw new Error("Missing command after --");
  }

  parsed.label = parsed.label ?? parsed.command[0];
  return parsed;
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

function commandSummary(command) {
  return command.join(" ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const baseEvent = {
    schemaVersion: 1,
    time: startedAt.toISOString(),
    event: "validation-command",
    label: options.label,
    cwd: process.cwd(),
    command: options.command,
    commandSummary: commandSummary(options.command),
    pid: process.pid,
  };

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
