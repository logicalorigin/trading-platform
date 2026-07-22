#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

const ignoredPathParts = [
  "/data/theme-datasets/",
  "/features/research/data/",
  "/reports/",
];
const ignoredPathPrefixes = ["scripts/reports/"];
const ignoredPaths = new Set([
  "scripts/check-retired-alert-tier-references.mjs",
]);

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
const typedSourceExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
// Comment-only lines (prose like "critical path" / "most severe first" / "severed the link")
// use the retired words in ordinary English, not as an alert-tier identifier or value — skip them.
const commentLinePrefixes = ["//", "/*", "*"];
function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return commentLinePrefixes.some((prefix) => trimmed.startsWith(prefix));
}

const containsRetiredAlertTier = (text) =>
  forbiddenPatterns.some((pattern) => pattern.test(text));

function scriptKindFor(extension) {
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".ts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function retiredAlertTierReferenceLines(source, extension) {
  const references = new Set();
  if (!typedSourceExtensions.has(extension)) {
    source.split(/\r?\n/).forEach((line, index) => {
      if (!isCommentOnlyLine(line) && containsRetiredAlertTier(line)) {
        references.add(index);
      }
    });
    return references;
  }

  const sourceFile = ts.createSourceFile(
    `retired-alert-tier-scan${extension}`,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKindFor(extension),
  );
  const visit = (node) => {
    if (ts.isIdentifier(node) && containsRetiredAlertTier(node.text)) {
      references.add(
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line,
      );
    } else if (
      (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
      !/\s/.test(node.text) &&
      containsRetiredAlertTier(node.text)
    ) {
      references.add(
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

export function hasRetiredAlertTierReference(source, extension) {
  return retiredAlertTierReferenceLines(source, extension).size > 0;
}

export function isScanPath(relPath) {
  return relPath.startsWith("artifacts/") || relPath.startsWith("scripts/");
}

export function shouldIgnore(relPath) {
  if (
    ignoredPaths.has(relPath) ||
    ignoredPathPrefixes.some((prefix) => relPath.startsWith(prefix)) ||
    ignoredPathParts.some((part) => relPath.includes(part))
  ) {
    return true;
  }
  return binaryExtensions.has(path.extname(relPath).toLowerCase());
}

function listFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((relPath) => isScanPath(relPath) && !shouldIgnore(relPath))
    .map((relPath) => ({
      fullPath: path.join(repoRoot, relPath),
      relPath,
    }));
}

const main = () => {
  const failures = [];

  for (const { fullPath, relPath } of listFiles()) {
    if (!existsSync(fullPath)) continue;
    const stats = statSync(fullPath);
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      failures.push(
        `${relPath}: file is larger than ${MAX_TEXT_FILE_BYTES} bytes; add an explicit guard exception before skipping retired vocabulary checks.`,
      );
      continue;
    }
    const source = readFileSync(fullPath, "utf8");
    const lines = source.split(/\r?\n/);
    for (const index of retiredAlertTierReferenceLines(
      source,
      path.extname(relPath).toLowerCase(),
    )) {
      const line = lines[index] ?? "";
      failures.push(`${relPath}:${index + 1}: ${line.trim()}`);
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
    process.exitCode = 1;
    return;
  }

  console.log(
    "[check-retired-alert-tier-references] ok: no retired alert-tier references remain",
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
