#!/usr/bin/env node
import { chmodSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const USAGE =
  "Usage: node scripts/protect-replit-config.mjs [lock|unlock|status]";

export const PROTECTED_FILES = Object.freeze([
  ".replit",
  "replit.nix",
  "artifacts/pyrus/.replit-artifact/artifact.toml",
]);

export function parseAction(argv) {
  const action = argv[0] ?? "status";
  if (argv.length > 1 || !["lock", "unlock", "status"].includes(action)) {
    throw new Error(USAGE);
  }
  return action;
}

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function defaultChangeMode(fullPath, nextMode) {
  if (nextMode === 0o444) chmodSync(fullPath, 0o444);
  else if (nextMode === 0o644) chmodSync(fullPath, 0o644);
  else chmodSync(fullPath, nextMode);
}

function inspectTargets(repoRoot) {
  return PROTECTED_FILES.map((relPath) => {
    const fullPath = path.join(repoRoot, relPath);
    let stats;
    try {
      stats = lstatSync(fullPath);
    } catch (error) {
      throw new Error(`${relPath} must exist as a regular file`, {
        cause: error,
      });
    }
    if (!stats.isFile()) {
      throw new Error(`${relPath} must exist as a regular file`);
    }
    return { relPath, fullPath, originalMode: stats.mode & 0o777 };
  });
}

function writeStatus({ relPath, fullPath }, writeLine) {
  const stats = lstatSync(fullPath);
  if (!stats.isFile()) {
    throw new Error(`${relPath} must remain a regular file`);
  }
  const writable = (stats.mode & 0o222) !== 0;
  writeLine(
    `${relPath}: mode ${modeString(stats.mode)} write bits ${writable ? "set" : "clear"} (advisory)`,
  );
}

export function runConfigProtection({
  action,
  repoRoot = DEFAULT_REPO_ROOT,
  writeLine = console.log,
  changeMode = defaultChangeMode,
}) {
  if (!["lock", "unlock", "status"].includes(action)) {
    throw new Error(USAGE);
  }
  const targets = inspectTargets(repoRoot);
  const changed = [];

  if (action !== "status") {
    const nextMode = action === "lock" ? 0o444 : 0o644;
    try {
      for (const target of targets) {
        changeMode(target.fullPath, nextMode);
        changed.push(target);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const target of changed.reverse()) {
        try {
          changeMode(target.fullPath, target.originalMode);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Startup-config mode update failed and ${rollbackErrors.length} rollback operation(s) also failed: ${error?.message || error}`,
        );
      }
      throw error;
    }
  }

  for (const target of targets) writeStatus(target, writeLine);
  writeLine(
    "Mode bits block ordinary in-session writes only; Replit platform recovery or Git replacement can bypass or reset them. Run `pnpm run audit:replit-startup` to verify integrity and `pnpm run replit:config:restore` for recovery.",
  );
  if (action === "lock") {
    writeLine(
      "Write bits are clear. Run `pnpm run replit:config:unlock` only for an intentional startup-config maintenance window.",
    );
  }
}

function main(argv = process.argv.slice(2)) {
  try {
    runConfigProtection({ action: parseAction(argv) });
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
