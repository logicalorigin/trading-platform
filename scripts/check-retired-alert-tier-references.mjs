#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanRoots = [
  "artifacts",
  "scripts",
].map((relPath) => path.join(repoRoot, relPath));

const ignoredDirs = new Set([
  ".git",
  ".replit-artifact",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "out-tsc",
  "reports",
]);

const ignoredPathParts = [
  "/data/theme-datasets/",
  "/features/research/data/",
  "/scripts/reports/",
  "scripts/check-retired-alert-tier-references.mjs",
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

const retiredAlertTier = ["crit", "ical"].join("");
const retiredAlertSynonym = ["sev", "ere"].join("");
const forbiddenPatterns = [
  new RegExp(`\\b${retiredAlertTier}\\b`, "i"),
  new RegExp(`\\b${retiredAlertSynonym}\\w*\\b`, "i"),
];
const MAX_TEXT_FILE_BYTES = 50_000_000;

function toRelPath(fullPath) {
  return path.relative(repoRoot, fullPath).replaceAll(path.sep, "/");
}

function shouldIgnore(relPath) {
  if (ignoredPathParts.some((part) => relPath.includes(part))) return true;
  return binaryExtensions.has(path.extname(relPath).toLowerCase());
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = toRelPath(fullPath);
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

for (const root of scanRoots) {
  for (const { fullPath, relPath } of walk(root)) {
    if (!existsSync(fullPath)) continue;
    const stats = statSync(fullPath);
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      failures.push(
        `${relPath}: file is larger than ${MAX_TEXT_FILE_BYTES} bytes; add an explicit guard exception before skipping retired vocabulary checks.`,
      );
      continue;
    }
    const source = readFileSync(fullPath, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (!forbiddenPatterns.some((pattern) => pattern.test(line))) return;
      failures.push(`${relPath}:${index + 1}: ${line.trim()}`);
    });
  }
}

if (failures.length > 0) {
  console.error(
    "[check-retired-alert-tier-references] retired alert-tier vocabulary remains in runtime source:",
  );
  for (const failure of failures.slice(0, 120)) {
    console.error(`  ${failure}`);
  }
  if (failures.length > 120) {
    console.error(`  ...and ${failures.length - 120} more`);
  }
  process.exit(1);
}

console.log(
  "[check-retired-alert-tier-references] ok: no retired alert-tier references remain",
);
