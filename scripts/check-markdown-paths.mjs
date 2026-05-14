#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maintainedDocs = [
  "AGENTS.md",
  "APP_SURFACE_OWNERSHIP_REVIEW.md",
  "CLAUDE.md",
  "REPO_CLEANUP_INVENTORY.md",
  "replit.md",
  "scripts/README.md",
].filter((docPath) => fs.existsSync(path.join(repoRoot, docPath)));

const fileLikeExtension =
  /\.(cjs|js|jsx|json|md|mjs|ps1|sh|toml|ts|tsx|txt|yaml|yml)$/i;
const rootQualifiedPrefixes = ["artifacts/", "lib/", "scripts/", ".agents/"];

const extractCandidates = (markdown) => {
  const candidates = [];
  const inlineCodePattern = /`([^`\n]+)`/g;
  const markdownLinkPattern = /\[[^\]]+\]\(([^)#][^)]*)\)/g;

  for (const pattern of [inlineCodePattern, markdownLinkPattern]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      candidates.push(match[1]);
    }
  }

  return candidates;
};

const normalizeCandidate = (candidate, docPath) => {
  const trimmed = candidate.trim().replace(/^<|>$/g, "").replace(/[.,;:]$/g, "");
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("@") ||
    trimmed.startsWith("/") ||
    trimmed.includes("://") ||
    /[\s$|*?{}[\]<>=\\%]/.test(trimmed) ||
    trimmed.includes("...")
  ) {
    return null;
  }

  const isRelativePath = trimmed.startsWith("./") || trimmed.startsWith("../");
  const isRootQualified = rootQualifiedPrefixes.some((prefix) =>
    trimmed.startsWith(prefix),
  );
  const isDocLocalFile =
    docPath.includes("/") && !trimmed.includes("/") && fileLikeExtension.test(trimmed);
  const isExistingRootFile =
    !trimmed.includes("/") && fs.existsSync(path.join(repoRoot, trimmed));

  if (!isRelativePath && !isRootQualified && !isDocLocalFile && !isExistingRootFile) {
    return null;
  }

  return trimmed;
};

const candidateExists = (docPath, candidate) => {
  const withoutLine = candidate.replace(/:\d+(?::\d+)?$/, "");
  const candidates = path.isAbsolute(withoutLine)
    ? [withoutLine]
    : [
        path.resolve(path.dirname(path.join(repoRoot, docPath)), withoutLine),
        path.resolve(repoRoot, withoutLine),
      ];

  return candidates.some((candidatePath) => fs.existsSync(candidatePath));
};

const missing = [];

for (const docPath of maintainedDocs) {
  const markdown = fs.readFileSync(path.join(repoRoot, docPath), "utf8");
  for (const rawCandidate of extractCandidates(markdown)) {
    const candidate = normalizeCandidate(rawCandidate, docPath);
    if (candidate && !candidateExists(docPath, candidate)) {
      missing.push({ docPath, candidate });
    }
  }
}

if (missing.length > 0) {
  console.error(
    `[check-markdown-paths] missing ${missing.length} path reference(s) in maintained docs:`,
  );
  for (const { docPath, candidate } of missing) {
    console.error(`  - ${docPath}: ${candidate}`);
  }
  process.exit(1);
}

console.log(`[check-markdown-paths] ok: ${maintainedDocs.length} maintained docs checked`);
