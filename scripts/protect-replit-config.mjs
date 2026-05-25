#!/usr/bin/env node
import { chmodSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const protectedFiles = [
  ".replit",
  "replit.nix",
  "artifacts/pyrus/.replit-artifact/artifact.toml",
];

const action = process.argv[2] ?? "status";

if (!["lock", "unlock", "status"].includes(action)) {
  console.error(
    "Usage: node scripts/protect-replit-config.mjs [lock|unlock|status]",
  );
  process.exit(1);
}

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function writeStatus(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  const stats = statSync(fullPath);
  const mode = modeString(stats.mode);
  const writable = (stats.mode & 0o222) !== 0;
  console.log(
    `${relPath}: mode ${mode} ${writable ? "writable" : "read-only"}`,
  );
}

for (const relPath of protectedFiles) {
  const fullPath = path.join(repoRoot, relPath);
  if (action === "lock") chmodSync(fullPath, 0o444);
  if (action === "unlock") chmodSync(fullPath, 0o644);
  writeStatus(relPath);
}

if (action === "lock") {
  console.log(
    "Replit startup config is locked. Run `pnpm run replit:config:unlock` only for an intentional startup-config maintenance window.",
  );
}
