#!/usr/bin/env node
// Diff (and, on explicit confirm, restore) the checked-in canonical Replit
// startup config after a platform "Post-Recovery checkpoint" clobber.
//
// Usage:
//   pnpm run replit:config:restore              # diff only, exit 1 on drift
//   pnpm run replit:config:restore -- --write   # restore canonical copies
//
// IMPORTANT: writing .replit or replit.nix triggers ONE workspace reload
// (Replit's daemon re-evaluates modules/ports/env, kills shells, re-mounts the
// preview). --write batches both files back-to-back and re-locks them, so the
// reload happens once. Never wire this into automated startup paths.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectReplitConfigClobber } from "./replit-config-clobber.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDir = path.join(repoRoot, "scripts", "replit-config");

const targets = [
  { live: ".replit", canonical: path.join(canonicalDir, "dot-replit") },
  { live: "replit.nix", canonical: path.join(canonicalDir, "replit.nix") },
];

const write = process.argv.includes("--write");

let drift = false;
for (const target of targets) {
  const livePath = path.join(repoRoot, target.live);
  const canonical = readFileSync(target.canonical, "utf8");
  const live = existsSync(livePath) ? readFileSync(livePath, "utf8") : null;
  if (live === canonical) {
    console.log(`[restore-replit-config] ${target.live}: matches canonical copy`);
    continue;
  }
  drift = true;
  console.warn(
    `[restore-replit-config] ${target.live}: ${live === null ? "MISSING" : "DIFFERS from canonical copy"} (${path.relative(repoRoot, target.canonical)})`,
  );
}

const clobberProblems = detectReplitConfigClobber(repoRoot);
for (const problem of clobberProblems) {
  console.warn(`[restore-replit-config] clobber signature: ${problem}`);
}

if (!write) {
  if (drift || clobberProblems.length > 0) {
    console.warn(
      "[restore-replit-config] Drift detected. To restore the canonical startup config (triggers ONE workspace reload):",
    );
    console.warn("[restore-replit-config]   pnpm run replit:config:restore -- --write");
    console.warn(
      "[restore-replit-config] Then verify with: pnpm run audit:replit-startup",
    );
    process.exit(1);
  }
  console.log("[restore-replit-config] ok — live config matches canonical");
  process.exit(0);
}

if (!drift) {
  console.log("[restore-replit-config] nothing to restore — live config already canonical");
  process.exit(0);
}

console.warn(
  "[restore-replit-config] Restoring canonical .replit / replit.nix — the Replit workspace will reload ONCE (shells restart, preview re-mounts).",
);
let writeFailed = false;
for (const target of targets) {
  const livePath = path.join(repoRoot, target.live);
  const canonical = readFileSync(target.canonical, "utf8");
  const live = existsSync(livePath) ? readFileSync(livePath, "utf8") : null;
  if (live === canonical) continue;
  try {
    chmodSync(livePath, 0o644);
  } catch {
    // Missing file — write below creates it.
  }
  try {
    writeFileSync(livePath, canonical, "utf8");
    chmodSync(livePath, 0o444); // re-lock immediately (matches protect-replit-config.mjs lock mode)
    console.log(`[restore-replit-config] restored + locked ${target.live}`);
  } catch (error) {
    writeFailed = true;
    console.error(
      `[restore-replit-config] FAILED to write ${target.live}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (writeFailed) {
  // Known constraint: Replit blocks direct .replit writes from AGENT-owned
  // shells ("Direct edits to .replit and replit.nix are not allowed..."). The
  // user-owned Shell pane is not subject to that guard.
  console.error(
    [
      "[restore-replit-config] The write was blocked in this shell context.",
      "[restore-replit-config] Recovery options, in order:",
      "[restore-replit-config]   1. Run this exact command from the user-owned Shell pane (not an agent shell):",
      "[restore-replit-config]        pnpm run replit:config:restore -- --write",
      "[restore-replit-config]   2. Manual fallback from any shell that can write the files:",
      "[restore-replit-config]        chmod 644 .replit replit.nix",
      "[restore-replit-config]        cp scripts/replit-config/dot-replit .replit",
      "[restore-replit-config]        cp scripts/replit-config/replit.nix replit.nix",
      "[restore-replit-config]        pnpm run replit:config:lock",
      "[restore-replit-config] Then verify with: pnpm run audit:replit-startup",
    ].join("\n"),
  );
  process.exit(1);
}
console.log(
  "[restore-replit-config] Done. Run `pnpm run audit:replit-startup` after the workspace reload settles.",
);
