#!/usr/bin/env node
// Diff (and, on explicit confirmation, restore) the checked-in canonical
// Replit startup config after a platform "Post-Recovery checkpoint" clobber.
//
// Usage:
//   pnpm run replit:config:restore              # diff only, exit 1 on drift
//   pnpm run replit:config:restore -- --write   # restore canonical copies
//
// Writing either live file may trigger a workspace reload. --write stages both
// replacements, then publishes replit.nix before .replit because missing Nix
// config bricks shells. A normal filesystem cannot make two path replacements
// one atomic transaction.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import {
  detectReplitConfigProblems,
  validateReplitStartupConfig,
} from "./replit-config-clobber.mjs";

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const USAGE = "Usage: node scripts/restore-replit-config.mjs [--write]";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DEFAULT_OPS = {
  closeSync,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
};

export function parseRestoreArgs(argv) {
  if (argv.length === 0) return { write: false };
  if (argv.length === 1 && argv[0] === "--write") return { write: true };
  throw new Error(USAGE);
}

function targetsFor(repoRoot) {
  const canonicalDir = path.join(repoRoot, "scripts", "replit-config");
  return [
    {
      live: ".replit",
      livePath: path.join(repoRoot, ".replit"),
      canonicalPath: path.join(canonicalDir, "dot-replit"),
    },
    {
      live: "replit.nix",
      livePath: path.join(repoRoot, "replit.nix"),
      canonicalPath: path.join(canonicalDir, "replit.nix"),
    },
  ];
}

function readRegularFile(file, relativeName, ops, allowMissing = false) {
  let descriptor;
  let stats;
  try {
    descriptor = ops.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    stats = ops.fstatSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        ops.closeSync(descriptor);
      } catch {
        // Preserve the original open/stat failure.
      }
    }
    if (allowMissing && error?.code === "ENOENT") {
      return {
        exists: false,
        contents: null,
        dev: null,
        ino: null,
        mode: null,
      };
    }
    const wrapped = new Error(`${relativeName} must exist as a regular file`, {
      cause: error,
    });
    wrapped.code = error?.code;
    throw wrapped;
  }
  if (!stats.isFile()) {
    if (descriptor !== undefined) ops.closeSync(descriptor);
    throw new Error(`${relativeName} must exist as a regular file`);
  }
  try {
    return {
      exists: true,
      contents: ops.readFileSync(descriptor),
      dev: stats.dev,
      ino: stats.ino,
      mode: stats.mode & 0o777,
    };
  } finally {
    ops.closeSync(descriptor);
  }
}

function contentsMatch(left, right) {
  if (Buffer.isBuffer(left) && Buffer.isBuffer(right)) {
    return left.equals(right);
  }
  return left === right;
}

function decodeUtf8(contents, relativeName) {
  try {
    return UTF8_DECODER.decode(contents);
  } catch (cause) {
    throw new Error(`${relativeName} is not valid UTF-8`, { cause });
  }
}

function stateMatches(left, right) {
  return (
    left.exists === right.exists &&
    contentsMatch(left.contents, right.contents) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode
  );
}

function stagedStateMatches(left, right) {
  return (
    contentsMatch(left.contents, right.contents) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode
  );
}

function stageFile({ destination, contents, mode, label, token, ops }) {
  const staged = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${label}-${token}`,
  );
  let descriptor;
  try {
    descriptor = ops.openSync(
      staged,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      mode,
    );
    ops.writeFileSync(descriptor, contents, { encoding: "utf8" });
    ops.fchmodSync(descriptor, mode);
    const descriptorStats = ops.fstatSync(descriptor);
    if (!descriptorStats.isFile()) {
      throw new Error(
        `staged ${path.basename(destination)} is not a regular file`,
      );
    }
    const expectedState = {
      contents,
      dev: descriptorStats.dev,
      ino: descriptorStats.ino,
      mode,
    };
    ops.closeSync(descriptor);
    descriptor = undefined;
    const stagedState = readRegularFile(staged, staged, ops);
    if (!stagedStateMatches(stagedState, expectedState)) {
      throw new Error(
        `staged ${path.basename(destination)} failed verification`,
      );
    }
    return { path: staged, expectedState };
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        ops.closeSync(descriptor);
      } catch {
        // Preserve the original stage failure.
      }
    }
    try {
      ops.rmSync(staged, { force: true });
    } catch {
      // The original staging failure remains the actionable error.
    }
    throw error;
  }
}

function verifyStagedFile(staged, ops) {
  const current = readRegularFile(staged.path, staged.path, ops);
  if (!stagedStateMatches(current, staged.expectedState)) {
    throw new Error(`${path.basename(staged.path)} changed after staging`);
  }
}

function restoreSnapshot(target, snapshot, token, ops) {
  if (!snapshot.exists) {
    ops.rmSync(target.livePath, { force: true });
    return;
  }
  const rollback = stageFile({
    destination: target.livePath,
    contents: snapshot.contents,
    mode: snapshot.mode,
    label: "rollback",
    token,
    ops,
  });
  try {
    verifyStagedFile(rollback, ops);
    ops.renameSync(rollback.path, target.livePath);
  } finally {
    ops.rmSync(rollback.path, { force: true });
  }
}

function errorDetail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.code ? `${error.code}: ${message}` : message;
}

export function runRestore({
  repoRoot = DEFAULT_REPO_ROOT,
  write = false,
  writeLine = console.log,
  warn = console.warn,
  error = console.error,
  ops: injectedOps = {},
  token = `${process.pid}-${randomUUID()}`,
} = {}) {
  const ops = { ...DEFAULT_OPS, ...injectedOps };
  const targets = targetsFor(repoRoot);
  const stagedPaths = new Map();
  const changed = [];
  let phase = "preflight";
  let activeTarget = null;
  let snapshots = [];
  let canonicalStates = [];

  function verifyCanonicalStates() {
    targets.forEach((target, index) => {
      activeTarget = target.live;
      const current = readRegularFile(
        target.canonicalPath,
        path.relative(repoRoot, target.canonicalPath),
        ops,
      );
      if (!stateMatches(current, canonicalStates[index])) {
        throw new Error(
          `${path.relative(repoRoot, target.canonicalPath)} changed after preflight`,
        );
      }
    });
  }

  try {
    canonicalStates = targets.map((target) => {
      activeTarget = target.live;
      return readRegularFile(
        target.canonicalPath,
        path.relative(repoRoot, target.canonicalPath),
        ops,
      );
    });
    const canonical = canonicalStates.map((state, index) =>
      decodeUtf8(
        state.contents,
        path.relative(repoRoot, targets[index].canonicalPath),
      ),
    );
    const canonicalProblems = validateReplitStartupConfig({
      replit: canonical[0],
      nix: canonical[1],
    });
    if (canonicalProblems.length > 0) {
      throw new Error(
        `canonical startup config is invalid: ${canonicalProblems.join("; ")}`,
      );
    }

    snapshots = targets.map((target) => {
      activeTarget = target.live;
      return readRegularFile(target.livePath, target.live, ops, true);
    });
    const liveEncodingProblems = [];
    const liveSources = snapshots.map((snapshot, index) => {
      if (!snapshot.exists) return null;
      try {
        return decodeUtf8(snapshot.contents, targets[index].live);
      } catch (encodingError) {
        liveEncodingProblems.push(encodingError.message);
        return null;
      }
    });
    const liveProblems = detectReplitConfigProblems({
      replit: liveSources[0],
      nix: liveSources[1],
    });
    liveProblems.unshift(...liveEncodingProblems);
    const states = targets.map((target, index) => {
      const snapshot = snapshots[index];
      const bytesMatch = contentsMatch(
        snapshot.contents,
        canonicalStates[index].contents,
      );
      const locked = snapshot.mode === 0o444;
      const writeBitsClear =
        snapshot.mode !== null && (snapshot.mode & 0o222) === 0;
      writeLine(
        `[restore-replit-config] ${target.live}: ${bytesMatch ? "matches canonical copy" : snapshot.exists ? "DIFFERS from canonical copy" : "MISSING"}; write bits ${writeBitsClear ? "clear" : "set or file missing"}${locked ? "" : " (expected exact mode 444)"}`,
      );
      return { bytesMatch, locked };
    });
    for (const problem of liveProblems) {
      warn(`[restore-replit-config] clobber signature: ${problem}`);
    }
    const drift =
      states.some((state) => !state.bytesMatch || !state.locked) ||
      liveProblems.length > 0;

    if (!write) {
      if (!drift) {
        writeLine(
          "[restore-replit-config] ok — live config is canonical and write bits are clear",
        );
        return 0;
      }
      warn(
        "[restore-replit-config] Drift detected. Restore with `pnpm run replit:config:restore -- --write`; each staged replacement may trigger a workspace reload. Then run `pnpm run audit:replit-startup`.",
      );
      return 1;
    }
    if (!drift) {
      writeLine(
        "[restore-replit-config] nothing to restore — live config is canonical and locked",
      );
      return 0;
    }

    phase = "staging";
    targets.forEach((target, index) => {
      activeTarget = target.live;
      stagedPaths.set(
        target.live,
        stageFile({
          destination: target.livePath,
          contents: canonicalStates[index].contents,
          mode: 0o444,
          label: "restore",
          token: `${token}-${index}`,
          ops,
        }),
      );
    });

    phase = "canonical pre-publication verification";
    verifyCanonicalStates();

    phase = "pre-publication verification";
    targets.forEach((target, index) => {
      activeTarget = target.live;
      const current = readRegularFile(target.livePath, target.live, ops, true);
      if (!stateMatches(current, snapshots[index])) {
        throw new Error(`${target.live} changed after preflight`);
      }
    });

    phase = "publication";
    [targets[1], targets[0]].forEach((target) => {
      const index = targets.indexOf(target);
      activeTarget = target.live;
      const current = readRegularFile(target.livePath, target.live, ops, true);
      if (!stateMatches(current, snapshots[index])) {
        throw new Error(`${target.live} changed before publication`);
      }
      verifyCanonicalStates();
      activeTarget = target.live;
      const staged = stagedPaths.get(target.live);
      verifyStagedFile(staged, ops);
      ops.renameSync(staged.path, target.livePath);
      stagedPaths.delete(target.live);
      changed.push({ target, snapshot: snapshots[index] });
      writeLine(`[restore-replit-config] restored + locked ${target.live}`);
    });

    phase = "post-write verification";
    const finalStates = targets.map((target, index) => {
      activeTarget = target.live;
      const state = readRegularFile(target.livePath, target.live, ops);
      if (
        !contentsMatch(state.contents, canonicalStates[index].contents) ||
        state.mode !== 0o444
      ) {
        throw new Error(`${target.live} did not reach canonical locked state`);
      }
      return decodeUtf8(state.contents, target.live);
    });
    const finalProblems = detectReplitConfigProblems({
      replit: finalStates[0],
      nix: finalStates[1],
    });
    if (finalProblems.length > 0) {
      throw new Error(
        `post-write validation failed: ${finalProblems.join("; ")}`,
      );
    }
    phase = "canonical final verification";
    verifyCanonicalStates();
    writeLine(
      "[restore-replit-config] Done. Both replacements were staged, then replit.nix and .replit were published in that order; wait for any workspace reload to settle, then run `pnpm run audit:replit-startup`.",
    );
    return 0;
  } catch (restoreError) {
    const rollbackErrors = [];
    for (const { target, snapshot } of changed.reverse()) {
      try {
        restoreSnapshot(target, snapshot, `${token}-${target.live}`, ops);
      } catch (rollbackError) {
        rollbackErrors.push(`${target.live}: ${errorDetail(rollbackError)}`);
      }
    }
    error(
      `[restore-replit-config] Restore failed during ${phase}${activeTarget ? ` for ${activeTarget}` : ""}: ${errorDetail(restoreError)}`,
    );
    if (["EACCES", "EPERM"].includes(restoreError?.code)) {
      error(
        "[restore-replit-config] The platform may block startup-config writes in this shell. Retry this same hardened command from the user-owned Shell pane: `pnpm run replit:config:restore -- --write`.",
      );
    }
    if (rollbackErrors.length > 0) {
      error(
        `[restore-replit-config] ROLLBACK FAILED: ${rollbackErrors.join("; ")}. Stop and inspect both startup files before retrying.`,
      );
    }
    return 1;
  } finally {
    for (const staged of stagedPaths.values()) {
      try {
        ops.rmSync(staged.path, { force: true });
      } catch {
        // A leftover same-directory stage is never a live startup path.
      }
    }
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseRestoreArgs(argv);
  } catch (parseError) {
    console.error(parseError.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = runRestore(options);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
