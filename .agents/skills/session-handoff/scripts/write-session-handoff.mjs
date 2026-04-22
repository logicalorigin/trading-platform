#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const args = {
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output") {
      args.output = argv[index + 1] ?? null;
      index += 1;
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
    .filter((line) => path.basename(line) !== currentFileName)
    .sort()
    .reverse();
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

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(process.cwd());
const thread = loadCurrentThread(repoRoot);
const sessionId = typeof thread?.id === "string" ? thread.id : "unknown-session";
const sessionPrefix = sessionId.slice(0, 8);
const today = new Date().toISOString().slice(0, 10);
const defaultFileName = `SESSION_HANDOFF_${today}_${sessionPrefix}.md`;
const outputPath = args.output
  ? path.resolve(args.output)
  : path.join(repoRoot, defaultFileName);
const currentFileName = path.basename(outputPath);
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

writeFileSync(outputPath, markdown, "utf8");
process.stdout.write(`${outputPath}\n`);
