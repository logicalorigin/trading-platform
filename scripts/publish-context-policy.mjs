import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

export const publishContextLimitBytes = 7_000_000_000;

// .replitignore declares Dockerignore-compatible syntax. Every pattern that can
// hold runtime or generated state is recursive; ** also matches the repo root.
export const requiredPublishExclusions = Object.freeze([
  "**/.git",
  "**/.agents",
  "**/.claude",
  "**/.codex",
  "**/.codex-watch*",
  "**/.codex-log-watch",
  "**/.pyrus-runtime",
  "**/.local",
  "**/.cache",
  "**/.config",
  "**/.gstack",
  "**/.pythonlibs",
  "**/.venv",
  "**/.vendor",
  "**/.mypy_cache",
  "**/.pytest_cache",
  "**/.ruff_cache",
  "**/node_modules",
  "**/target",
  "**/dist",
  "**/coverage",
  "**/tmp",
  "**/output",
  "**/reports",
  "**/.headless-shots",
  "**/test-results",
  "**/playwright-report",
  "**/attached_assets",
  "security/pentest",
  "**/SESSION_HANDOFF_*.md",
  "**/CODEX_HANDOFF_*.md",
  "**/CLAUDE_HANDOFF_*.md",
  "**/AGENT_CHAT*.md",
  "**/AGENT_CHAT*.jsonl",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/.[eE][nN][vV]",
  "**/.[eE][nN][vV].*",
  "!.env.example",
  "**/*.[pP][eE][mM]",
  "**/*.[kK][eE][yY]",
  "**/*.[pP]12",
  "**/*.[pP][fF][xX]",
  "**/*.[jJ][kK][sS]",
  "**/*.[kK][eE][yY][sS][tT][oO][rR][eE]",
  "**/*.cpuprofile",
]);

const protectedDirectoryNames = new Set([
  ".git",
  ".agents",
  ".claude",
  ".codex",
  ".codex-log-watch",
  ".pyrus-runtime",
  ".local",
  ".cache",
  ".config",
  ".gstack",
  ".pythonlibs",
  ".venv",
  ".vendor",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "node_modules",
  "target",
  "dist",
  "coverage",
  "tmp",
  "output",
  "reports",
  ".headless-shots",
  "test-results",
  "playwright-report",
  "attached_assets",
]);

export function parsePublishIgnore(ignoreText) {
  return ignoreText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function isProtectedPublishPath(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  const parts = normalized.split("/");
  const base = parts.at(-1) ?? "";
  const lowerBase = base.toLowerCase();

  if (
    parts.some(
      (part) =>
        protectedDirectoryNames.has(part) || part.startsWith(".codex-watch"),
    ) ||
    normalized === "security/pentest" ||
    normalized.startsWith("security/pentest/")
  ) {
    return true;
  }

  if (
    /^(?:SESSION_HANDOFF_|CODEX_HANDOFF_|CLAUDE_HANDOFF_).*\.md$/u.test(
      base,
    ) ||
    /^AGENT_CHAT.*\.(?:md|jsonl)$/u.test(base) ||
    base === "AGENTS.md" ||
    base === "CLAUDE.md"
  ) {
    return true;
  }

  if (
    lowerBase === ".env" ||
    (lowerBase.startsWith(".env.") && normalized !== ".env.example")
  ) {
    return true;
  }

  return (
    /\.(?:pem|key|p12|pfx|jks|keystore)$/iu.test(base) ||
    base.endsWith(".cpuprofile")
  );
}

function archiveEntryBytes(fileBytes) {
  return 1_024 + Math.ceil(fileBytes / 512) * 512;
}

export function auditPublishContext({
  root,
  ignoreText,
  limitBytes = publishContextLimitBytes,
}) {
  const failures = [];
  const ignoreEntries = parsePublishIgnore(ignoreText);
  const missing = requiredPublishExclusions.filter(
    (entry) => !ignoreEntries.includes(entry),
  );
  if (missing.length > 0) {
    failures.push(
      `Replit publish context must exclude protected paths and file types; missing: ${missing.join(", ")}.`,
    );
  }
  const unexpectedReincludes = ignoreEntries.filter(
    (entry) => entry.startsWith("!") && entry !== "!.env.example",
  );
  if (unexpectedReincludes.length > 0) {
    failures.push(
      `Replit publish context must not re-include protected content; unexpected rules: ${unexpectedReincludes.join(", ")}.`,
    );
  }

  let includedBytes = 0;
  let includedFiles = 0;
  let archiveEstimateBytes = 1_024;

  function walk(dirPath, relativeDir = "") {
    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
      failures.push(
        `Publish context could not read ${relativeDir || "."}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    for (const entry of entries) {
      const relPath = relativeDir
        ? path.join(relativeDir, entry.name)
        : entry.name;
      if (isProtectedPublishPath(relPath)) continue;

      const fullPath = path.join(dirPath, entry.name);
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch (error) {
        failures.push(
          `Publish context could not inspect ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      if (stat.isSymbolicLink()) {
        failures.push(
          `Publish context contains an included symbolic link with ambiguous snapshot semantics: ${relPath}.`,
        );
      } else if (stat.isDirectory()) {
        archiveEstimateBytes += 512;
        walk(fullPath, relPath);
      } else if (stat.isFile()) {
        includedBytes += stat.size;
        includedFiles += 1;
        archiveEstimateBytes += archiveEntryBytes(stat.size);
      } else {
        failures.push(
          `Publish context contains an unsupported special file: ${relPath}.`,
        );
      }
    }
  }

  walk(root);
  const measuredBytes = Math.max(includedBytes, archiveEstimateBytes);
  if (measuredBytes > limitBytes) {
    failures.push(
      `Replit publish context estimate is ${measuredBytes} bytes, above the ${limitBytes}-byte release ceiling.`,
    );
  }

  return {
    failures,
    includedBytes,
    includedFiles,
    archiveEstimateBytes,
  };
}
