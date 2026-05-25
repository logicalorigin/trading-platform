#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

const ignoredDirs = new Set([
  ".cache",
  ".claude",
  ".config",
  ".git",
  ".local",
  ".upm",
  ".vendor",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "output",
  "out-tsc",
  "test-results",
  "tmp",
  "attached_assets",
  "playwright-report",
  "blob-report",
]);

const ignoredPathParts = [
  "scripts/check-legacy-branding.mjs",
  "SESSION_HANDOFF_",
  "SESSION_HANDOFF_CURRENT.md",
  "SESSION_HANDOFF_MASTER.md",
];

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".dmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".log",
]);

const forbidden = [
  /ray[-_ ]?algo/i,
  /ray[-_ ]?replica/i,
  /rayReplica/,
  /RAY_REPLICA/,
];

const allowed = [];

function shouldIgnore(relPath) {
  if (ignoredPathParts.some((part) => relPath.includes(part))) return true;
  return binaryExtensions.has(path.extname(relPath).toLowerCase());
}

function isAllowed(relPath, line) {
  return allowed.some(
    (entry) => entry.path === relPath && entry.line.test(line),
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(repoRoot, fullPath).replaceAll(path.sep, "/");
    if (shouldIgnore(relPath)) continue;
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

const failures = [];

for (const { fullPath, relPath } of walk(repoRoot)) {
  if (!existsSync(fullPath) || statSync(fullPath).size > 2_000_000) continue;
  const source = readFileSync(fullPath, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!forbidden.some((pattern) => pattern.test(line))) return;
    if (isAllowed(relPath, line)) return;
    failures.push(`${relPath}:${index + 1}: ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error(
    "[check-legacy-branding] retired branding remains outside the compatibility allowlist:",
  );
  for (const failure of failures.slice(0, 80)) {
    console.error(`  ${failure}`);
  }
  if (failures.length > 80) {
    console.error(`  ...and ${failures.length - 80} more`);
  }
  process.exit(1);
}

console.log("[check-legacy-branding] ok: no retired branding remains");
