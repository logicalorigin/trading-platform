#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const args = {
    master: null,
    skipMaster: false,
    output: null,
    overwrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output") {
      args.output = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--overwrite") {
      args.overwrite = true;
      continue;
    }

    if (value === "--master") {
      args.master = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--no-master") {
      args.skipMaster = true;
      continue;
    }
  }

  return args;
}

function runGit(repoRoot, gitArgs) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...gitArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    const stderr =
      typeof error?.stderr === "string" ? error.stderr.trim() : "";
    return stderr || "Unavailable";
  }
}

function resolveRepoRoot(startDir) {
  const result = runGit(startDir, ["rev-parse", "--show-toplevel"]);
  if (result && result !== "Unavailable") {
    return path.resolve(result);
  }

  return path.resolve(startDir);
}

function pathRelated(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}${path.sep}`) ||
    normalizedRight.startsWith(`${normalizedLeft}${path.sep}`)
  );
}

function loadCurrentThread(repoRoot) {
  const statePath = path.join(homedir(), ".codex", "state_5.sqlite");

  if (!existsSync(statePath)) {
    return null;
  }

  const db = new DatabaseSync(statePath, { readonly: true });

  try {
    const rows = db
      .prepare(
        [
          "SELECT",
          "  id,",
          "  rollout_path,",
          "  cwd,",
          "  title,",
          "  first_user_message,",
          "  git_branch,",
          "  git_sha,",
          "  created_at_ms,",
          "  updated_at_ms",
          "FROM threads",
          "ORDER BY updated_at_ms DESC",
        ].join(" "),
      )
      .all();

    return (
      rows.find((row) => typeof row.cwd === "string" && pathRelated(repoRoot, row.cwd)) ??
      rows[0] ??
      null
    );
  } finally {
    db.close();
  }
}

function loadRecentUserMessages(sessionId, limit = 12) {
  const historyPath = path.join(homedir(), ".codex", "history.jsonl");

  if (!existsSync(historyPath) || !sessionId) {
    return [];
  }

  const lines = readFileSync(historyPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const messages = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.session_id !== sessionId || typeof entry.text !== "string") {
        continue;
      }

      const timestamp =
        typeof entry.ts === "number"
          ? new Date(entry.ts * 1000).toISOString()
          : null;

      messages.push({
        timestamp,
        text: entry.text.trim(),
      });
    } catch {
      continue;
    }
  }

  return messages.slice(-limit);
}

function listPriorHandoffs(repoRoot, currentFileName) {
  const status = runGit(repoRoot, [
    "ls-files",
    "--others",
    "--cached",
    "--exclude-standard",
    "SESSION_HANDOFF_*.md",
  ]);

  if (!status || status === "Unavailable") {
    return [];
  }

  return status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /^SESSION_HANDOFF_\d{4}-\d{2}-\d{2}_.+\.md$/.test(path.basename(line)),
    )
    .filter((line) => path.basename(line) !== currentFileName)
    .sort()
    .reverse();
}

function listRootHandoffFiles(repoRoot) {
  const files = new Set();

  try {
    for (const fileName of readdirSync(repoRoot)) {
      if (/^SESSION_HANDOFF_\d{4}-\d{2}-\d{2}_.+\.md$/.test(fileName)) {
        files.add(fileName);
      }
    }
  } catch {
    // Fall back to git-only discovery below.
  }

  const gitFiles = runGit(repoRoot, [
    "ls-files",
    "--others",
    "--cached",
    "--exclude-standard",
    "SESSION_HANDOFF_*.md",
  ]);

  if (gitFiles && gitFiles !== "Unavailable") {
    for (const filePath of gitFiles.split("\n")) {
      const fileName = path.basename(filePath.trim());
      if (/^SESSION_HANDOFF_\d{4}-\d{2}-\d{2}_.+\.md$/.test(fileName)) {
        files.add(fileName);
      }
    }
  }

  return [...files].sort().reverse();
}

function findExistingHandoffForSession(repoRoot, sessionPrefix) {
  if (!sessionPrefix || sessionPrefix === "unknown") {
    return null;
  }

  return (
    listRootHandoffFiles(repoRoot).find((fileName) =>
      fileName.endsWith(`_${sessionPrefix}.md`),
    ) ?? null
  );
}

function formatBulletList(values, formatter) {
  if (values.length === 0) {
    return "- None found.";
  }

  return values.map(formatter).join("\n");
}

function isHighSignalPath(filePath) {
  const ignoredPrefixes = [
    ".vendor/",
    "test-results/",
    "artifacts/rayalgo/test-results/",
  ];
  const ignoredSuffixes = [
    ".png",
    ".gif",
    ".jpg",
    ".jpeg",
    ".deb",
    ".so.0",
    ".so.0.8000.0",
    ".gz",
  ];

  if (ignoredPrefixes.some((prefix) => filePath.startsWith(prefix))) {
    return false;
  }

  if (ignoredSuffixes.some((suffix) => filePath.endsWith(suffix))) {
    return false;
  }

  return true;
}

function oneLine(value, maxLength = 120) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function tableCell(value) {
  return oneLine(value || "unknown", 120).replace(/\|/g, "\\|");
}

function upsertMasterIndexEntry({
  branch,
  generatedAt,
  headSha,
  masterPath,
  outputFileName,
  sessionId,
  threadTitle,
}) {
  const existing = existsSync(masterPath)
    ? readFileSync(masterPath, "utf8")
    : null;
  const existingLine = existing
    ?.split("\n")
    .find(
      (line) =>
        line.includes(`\`${sessionId}\``) ||
        line.includes(`\`${outputFileName}\``),
    );
  const existingCells = existingLine
    ?.split("|")
    .map((cell) => cell.trim());
  const workstream =
    existingCells?.[4] && existingCells[4] !== "unknown"
      ? existingCells[4]
      : tableCell(threadTitle || "Updated handoff");
  const status =
    existingCells?.[7] && existingCells[7] !== "unknown"
      ? existingCells[7]
      : "Updated; see handoff";
  const shortHead =
    typeof headSha === "string" && headSha.length >= 12
      ? headSha.slice(0, 12)
      : headSha || "unknown";
  const row = [
    generatedAt,
    `\`${sessionId}\``,
    `\`${outputFileName}\``,
    workstream,
    tableCell(branch || "unknown"),
    `\`${shortHead}\``,
    status,
  ].join(" | ");
  const rowLine = `| ${row} |`;

  const header = [
    "# Session Handoff Master",
    "",
    "Index of durable per-session handoff files. Keep detailed notes in the session handoff; keep this file short and discoverable by session ID.",
    "",
    "## Sessions",
    "",
    "| Last Updated (UTC) | Session ID | Handoff | Workstream | Branch | HEAD | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ].join("\n");

  if (!existsSync(masterPath)) {
    writeFileSync(masterPath, `${header}\n${rowLine}\n`, "utf8");
    return;
  }

  const lines = existing.split("\n");
  const filtered = lines.filter(
    (line) =>
      !line.includes(`\`${sessionId}\``) &&
      !line.includes(`\`${outputFileName}\``),
  );
  const separatorIndex = filtered.findIndex((line) =>
    line.startsWith("| --- |"),
  );

  if (separatorIndex === -1) {
    const trimmed = existing.trimEnd();
    writeFileSync(
      masterPath,
      `${trimmed}\n\n${header.split("\n").slice(4).join("\n")}\n${rowLine}\n`,
      "utf8",
    );
    return;
  }

  filtered.splice(separatorIndex + 1, 0, rowLine);
  writeFileSync(masterPath, `${filtered.join("\n").trimEnd()}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(process.cwd());
const thread = loadCurrentThread(repoRoot);
const sessionId = typeof thread?.id === "string" ? thread.id : "unknown-session";
const sessionPrefix = sessionId.slice(0, 8);
const today = new Date().toISOString().slice(0, 10);
const existingSessionFile = args.output
  ? null
  : findExistingHandoffForSession(repoRoot, sessionPrefix);
const defaultFileName =
  existingSessionFile ?? `SESSION_HANDOFF_${today}_${sessionPrefix}.md`;
const outputPath = args.output
  ? path.resolve(args.output)
  : path.join(repoRoot, defaultFileName);
const currentFileName = path.basename(outputPath);
const masterPath = args.master
  ? path.resolve(args.master)
  : path.join(repoRoot, "SESSION_HANDOFF_MASTER.md");
const recentMessages = loadRecentUserMessages(sessionId);
const priorHandoffs = listPriorHandoffs(repoRoot, currentFileName);
const branch = runGit(repoRoot, ["branch", "--show-current"]) || "Unavailable";
const headSha = runGit(repoRoot, ["rev-parse", "HEAD"]) || "Unavailable";
const latestCommitSubject = runGit(repoRoot, ["log", "-1", "--pretty=%s"]);
const latestCommitBody = runGit(repoRoot, ["log", "-1", "--pretty=%B"]);
const latestCommitSessionId =
  latestCommitBody.match(/Replit-Commit-Session-Id:\s*(.+)/)?.[1]?.trim() ??
  null;
const statusShort = runGit(repoRoot, ["status", "--short", "--branch"]);
const diffStat =
  runGit(repoRoot, ["diff", "--stat"]) || "No tracked changes relative to HEAD.";
const rawChangedFiles = (
  runGit(repoRoot, ["diff", "--name-only"]) ||
  runGit(repoRoot, ["diff", "--name-only", "HEAD~1..HEAD"])
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const changedFiles = (rawChangedFiles.filter(isHighSignalPath).length > 0
  ? rawChangedFiles.filter(isHighSignalPath)
  : rawChangedFiles)
  .slice(0, 30);
const generatedAt = new Date().toISOString();

const markdown = `# Session Handoff — ${today}

## Session Metadata

- Session ID: \`${sessionId}\`
- Saved At (UTC): \`${generatedAt}\`
- Repo Root: \`${repoRoot}\`
- Thread CWD: \`${thread?.cwd ?? "unknown"}\`
- Rollout Path: \`${thread?.rollout_path ?? "unknown"}\`
- Branch: \`${branch || thread?.git_branch || "unknown"}\`
- HEAD: \`${headSha || thread?.git_sha || "unknown"}\`
- Latest Commit: \`${latestCommitSubject || "unknown"}\`
- Latest Commit Session ID: \`${latestCommitSessionId ?? "unknown"}\`
- Title: ${thread?.title ?? "Unknown"}

## Current User Request

${thread?.first_user_message ?? thread?.title ?? "Unknown"}

## Prior Handoffs

${formatBulletList(priorHandoffs, (value) => `- \`${value}\``)}

## Recent User Messages

${formatBulletList(
  recentMessages,
  (message) =>
    `- ${message.timestamp ? `\`${message.timestamp}\`` : "`unknown-time`"} ${message.text}`,
)}

## High-Signal Changed Files

${formatBulletList(changedFiles, (value) => `- \`${value}\``)}

## Repo State Snapshot

\`\`\`text
${statusShort || "Unavailable"}
\`\`\`

## Diff Summary

\`\`\`text
${diffStat || "Unavailable"}
\`\`\`

## What Changed This Session

- Replace this section with the concrete product and code changes completed in the session.

## Current Status

- Replace this section with current validation status, blockers, and any known runtime gaps.

## Next Recommended Steps

1. Replace this item with the highest-priority next step.
2. Replace this item with the next validation or bring-up step.
`;

if (args.overwrite || !existsSync(outputPath)) {
  writeFileSync(outputPath, markdown, "utf8");
}
if (!args.skipMaster) {
  upsertMasterIndexEntry({
    branch,
    generatedAt,
    headSha,
    masterPath,
    outputFileName: currentFileName,
    sessionId,
    threadTitle: thread?.title,
  });
}
process.stdout.write(`${outputPath}\n`);
