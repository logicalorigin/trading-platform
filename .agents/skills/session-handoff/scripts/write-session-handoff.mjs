#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function fail(message) {
  process.stderr.write(`session-handoff: ${message}\n`);
  process.exit(1);
}

function requireArgValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    intervalMs: 60_000,
    master: null,
    maxCycles: null,
    output: null,
    outputDir: null,
    overwrite: false,
    session: null,
    skipMaster: false,
    watch: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output") {
      args.output = requireArgValue(argv, index, value);
      index += 1;
      continue;
    }

    if (value === "--output-dir") {
      args.outputDir = requireArgValue(argv, index, value);
      index += 1;
      continue;
    }

    if (value === "--overwrite") {
      args.overwrite = true;
      continue;
    }

    if (value === "--watch") {
      args.watch = true;
      continue;
    }

    if (value === "--interval-ms") {
      args.intervalMs = parsePositiveInteger(
        requireArgValue(argv, index, value),
        value,
      );
      index += 1;
      continue;
    }

    if (value === "--max-cycles") {
      args.maxCycles = parsePositiveInteger(
        requireArgValue(argv, index, value),
        value,
      );
      index += 1;
      continue;
    }

    if (value === "--master") {
      args.master = requireArgValue(argv, index, value);
      index += 1;
      continue;
    }

    if (value === "--no-master") {
      args.skipMaster = true;
      continue;
    }

    if (value === "--session") {
      args.session = requireArgValue(argv, index, value);
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${value}`);
  }

  if (args.output && !args.session) {
    throw new Error("--output is only valid with --session");
  }

  if (args.output && args.outputDir) {
    throw new Error("--output and --output-dir cannot be used together");
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
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}${path.sep}`) ||
    normalizedRight.startsWith(`${normalizedLeft}${path.sep}`)
  );
}

function loadThreadsFromState() {
  const statePath = path.join(homedir(), ".codex", "state_5.sqlite");

  if (!existsSync(statePath)) {
    return [];
  }

  const db = new DatabaseSync(statePath, { readonly: true });

  try {
    return db
      .prepare(
        [
          "SELECT",
          "  id,",
          "  rollout_path,",
          "  created_at,",
          "  updated_at,",
          "  source,",
          "  model_provider,",
          "  cwd,",
          "  title,",
          "  sandbox_policy,",
          "  approval_mode,",
          "  tokens_used,",
          "  has_user_event,",
          "  git_sha,",
          "  git_branch,",
          "  git_origin_url,",
          "  cli_version,",
          "  first_user_message,",
          "  agent_nickname,",
          "  agent_role,",
          "  memory_mode,",
          "  model,",
          "  reasoning_effort,",
          "  agent_path,",
          "  created_at_ms,",
          "  updated_at_ms",
          "FROM threads",
          "ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC",
        ].join(" "),
      )
      .all();
  } finally {
    db.close();
  }
}

function loadRecentUserMessagesFromHistory(sessionId, limit = 12) {
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
          ? formatMountainTimestamp(new Date(entry.ts * 1000))
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

function findExistingHandoffForSession(repoRoot, sessionId) {
  if (!sessionId || sessionId === "unknown-session") {
    return null;
  }

  return (
    listRootHandoffFiles(repoRoot).find((fileName) =>
      fileName.endsWith(`_${sessionId}.md`),
    ) ?? null
  );
}

function formatBulletList(values, formatter, emptyText = "- None found.") {
  if (values.length === 0) {
    return emptyText;
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
    ".webm",
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

const HANDOFF_TIME_ZONE = "America/Denver";
const HANDOFF_TIME_ZONE_LABEL = "MT";

function mountainDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HANDOFF_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatMountainDate(value = new Date()) {
  const parts = mountainDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatMountainTimestamp(value = new Date()) {
  const parts = mountainDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName ?? HANDOFF_TIME_ZONE_LABEL}`;
}

function threadTimestampMs(thread, fieldPrefix = "updated") {
  const ms = Number(thread?.[`${fieldPrefix}_at_ms`]);
  if (Number.isFinite(ms) && ms > 0) {
    return ms;
  }

  const seconds = Number(thread?.[`${fieldPrefix}_at`]);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  return Date.now();
}

function threadDate(thread) {
  return formatMountainDate(new Date(threadTimestampMs(thread, "created")));
}

function defaultHandoffFileName(thread) {
  return `SESSION_HANDOFF_${threadDate(thread)}_${thread.id}.md`;
}

function outputPathForThread({ args, repoRoot, thread }) {
  if (args.output) {
    return path.resolve(args.output);
  }

  const outputDir = args.outputDir ? path.resolve(args.outputDir) : repoRoot;
  const existingFileName = args.outputDir
    ? null
    : findExistingHandoffForSession(repoRoot, thread.id);
  return path.join(outputDir, existingFileName ?? defaultHandoffFileName(thread));
}

function textFromValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item?.text === "string") {
          return item.text;
        }
        if (typeof item?.content === "string") {
          return item.content;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function payloadText(payload) {
  return (
    textFromValue(payload?.message) ||
    textFromValue(payload?.text) ||
    textFromValue(payload?.content)
  ).trim();
}

function parseFunctionArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === "object") {
    return rawArguments;
  }

  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

function commandFromExecEnd(payload) {
  if (Array.isArray(payload?.command)) {
    return payload.command.join(" ");
  }

  if (typeof payload?.command === "string") {
    return payload.command;
  }

  return "";
}

function commandFromFunctionCall(payload) {
  const args = parseFunctionArguments(payload?.arguments);
  return args.cmd || args.command || "";
}

function functionCallSummary(payload) {
  const name = payload?.name ?? "tool";
  if (name === "exec_command") {
    return `Tool: exec_command ${oneLine(commandFromFunctionCall(payload), 180)}`;
  }

  if (name === "write_stdin") {
    const args = parseFunctionArguments(payload?.arguments);
    return `Tool: write_stdin session ${args.session_id ?? "unknown"}`;
  }

  return `Tool: ${name} ${oneLine(payload?.arguments ?? "", 160)}`;
}

function isValidationCommand(command) {
  return /\b(node\s+--check|pnpm\s+(run\s+)?(test|typecheck|build|lint)|npm\s+(run\s+)?(test|typecheck|build|lint)|yarn\s+(test|typecheck|build|lint)|bun\s+(test|run\s+(test|typecheck|build|lint))|vitest|playwright\s+test|tsc\b|cargo\s+test|go\s+test)\b/i.test(
    command,
  );
}

function compactActivity(activity) {
  const maxItems = 18;
  if (activity.length <= maxItems) {
    return activity;
  }

  const first = activity.slice(0, 6);
  const last = activity.slice(-10);
  return [
    ...first,
    {
      timestamp: null,
      text: `… ${activity.length - first.length - last.length} lower-signal transcript events omitted …`,
    },
    ...last,
  ];
}

function loadRolloutSummary(rolloutPath) {
  const summary = {
    activity: [],
    userMessages: [],
    validations: [],
  };

  if (!rolloutPath || rolloutPath === "unknown" || !existsSync(rolloutPath)) {
    return summary;
  }

  const lines = readFileSync(rolloutPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const activity = [];
  const validations = [];
  const userMessages = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = entry.timestamp ?? null;
    const payload = entry.payload ?? {};
    const type = payload.type ?? entry.type;

    if (type === "user_message") {
      const text = payloadText(payload);
      if (text) {
        const message = { timestamp, text };
        userMessages.push(message);
        activity.push({ timestamp, text: `User: ${oneLine(text, 180)}` });
      }
      continue;
    }

    if (type === "agent_message") {
      const text = payloadText(payload);
      if (text) {
        activity.push({ timestamp, text: `Agent: ${oneLine(text, 180)}` });
      }
      continue;
    }

    if (type === "function_call") {
      activity.push({ timestamp, text: functionCallSummary(payload) });
      continue;
    }

    if (type === "exec_command_end") {
      const command = commandFromExecEnd(payload);
      const exitCode =
        typeof payload.exit_code === "number" ? payload.exit_code : null;

      if (isValidationCommand(command)) {
        validations.push({
          timestamp,
          text: `${oneLine(command, 180)}${exitCode === null ? "" : ` (exit ${exitCode})`}`,
        });
      }

      if (exitCode !== null && exitCode !== 0) {
        activity.push({
          timestamp,
          text: `Tool failed: ${oneLine(command, 180)} (exit ${exitCode})`,
        });
      }
    }
  }

  summary.activity = compactActivity(activity);
  summary.userMessages = userMessages;
  summary.validations = validations.slice(-12);
  return summary;
}

function mergeUserMessages(historyMessages, rolloutMessages, limit = 12) {
  const byText = new Map();

  for (const message of [...historyMessages, ...rolloutMessages]) {
    const key = oneLine(message.text, 1000).toLowerCase();
    if (!key) {
      continue;
    }
    byText.set(key, message);
  }

  return [...byText.values()]
    .sort((left, right) =>
      String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? "")),
    )
    .slice(-limit);
}

function markdownTimestamp(timestamp) {
  return timestamp ? `\`${timestamp}\`` : "`unknown-time`";
}

function upsertMasterIndexEntry({
  branch,
  generatedAt,
  generatedAtUtc,
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
    .find((line) => line.includes(`\`${sessionId}\``));
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
      : "Saved; see handoff";
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
    `| Last Updated (${HANDOFF_TIME_ZONE_LABEL}) | Session ID | Handoff | Workstream | Branch | HEAD | Status |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
  ].join("\n");

  if (!existsSync(masterPath)) {
    writeFileSync(masterPath, `${header}\n${rowLine}\n`, "utf8");
    return;
  }

  const lines = existing.split("\n");
  const filtered = lines
    .filter((line) => !line.includes(`\`${sessionId}\``))
    .map((line) =>
      line.startsWith("| Last Updated (")
        ? `| Last Updated (${HANDOFF_TIME_ZONE_LABEL}) | Session ID | Handoff | Workstream | Branch | HEAD | Status |`
        : line,
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

function extractMarkdownSection(markdown, heading) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const contentStart = markdown.indexOf("\n\n", start);
  if (contentStart === -1) {
    return null;
  }

  const next = markdown.indexOf("\n## ", contentStart + 2);
  return markdown
    .slice(contentStart + 2, next === -1 ? markdown.length : next)
    .trimEnd();
}

function replaceMarkdownSection(markdown, heading, content) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) {
    return markdown;
  }

  const contentStart = markdown.indexOf("\n\n", start);
  if (contentStart === -1) {
    return markdown;
  }

  const next = markdown.indexOf("\n## ", contentStart + 2);
  const before = markdown.slice(0, contentStart + 2);
  const after = next === -1 ? "" : markdown.slice(next);
  return `${before}${content.trimEnd()}\n${after}`;
}

function meaningfulEditableSection(content) {
  const trimmed = content?.trim();
  return Boolean(trimmed) && !/Replace this (section|item)/i.test(trimmed);
}

function mergeEditableSections(existingMarkdown, generatedMarkdown) {
  let merged = generatedMarkdown;

  for (const heading of [
    "What Changed This Session",
    "Current Status",
    "Next Recommended Steps",
  ]) {
    const existingSection = extractMarkdownSection(existingMarkdown, heading);
    if (meaningfulEditableSection(existingSection)) {
      merged = replaceMarkdownSection(merged, heading, existingSection);
    }
  }

  return merged;
}

function readlinkSafe(targetPath) {
  try {
    return readlinkSync(targetPath);
  } catch {
    return null;
  }
}

function readTextSafe(targetPath) {
  try {
    return readFileSync(targetPath, "utf8");
  } catch {
    return null;
  }
}

function extractSessionIdFromRollout(rolloutPath) {
  return (
    path
      .basename(rolloutPath)
      .match(/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})\.jsonl$/)
      ?.[1] ?? null
  );
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function readFdTargets(procPath) {
  const fdRoot = path.join(procPath, "fd");
  const targets = [];

  try {
    for (const fd of readdirSync(fdRoot)) {
      const target = readlinkSafe(path.join(fdRoot, fd));
      if (target) {
        targets.push(target);
      }
    }
  } catch {
    // Process may have exited during inspection.
  }

  return targets;
}

function codexProcessKind(cmdline) {
  if (/\/codex\/codex(?:\s|$)/.test(cmdline)) {
    return "native";
  }

  if (/\/@openai\/codex\/bin\/codex\.js(?:\s|$)/.test(cmdline)) {
    return "wrapper";
  }

  return null;
}

function parseProcParentPid(procPath) {
  const stat = readTextSafe(path.join(procPath, "stat"));
  const match = stat?.match(/^\d+\s+\(.+\)\s+\S+\s+(\d+)\s+/);
  return match?.[1] ?? null;
}

function listCodexTmpLocks() {
  const tmpRoot = path.join(homedir(), ".codex", "tmp", "arg0");
  const locks = [];

  try {
    for (const dirName of readdirSync(tmpRoot)) {
      const lockPath = path.join(tmpRoot, dirName, ".lock");
      if (!existsSync(lockPath)) {
        continue;
      }

      const stat = statSync(lockPath);
      locks.push({ lockPath, mtimeMs: stat.mtimeMs });
    }
  } catch {
    return [];
  }

  return locks
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((entry) => entry.lockPath);
}

function listLiveCodexTerminals(repoRoot) {
  const procRoot = "/proc";
  let entries = [];

  try {
    entries = readdirSync(procRoot);
  } catch {
    return [];
  }

  const processes = [];

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }

    const procPath = path.join(procRoot, entry);
    const cmdline = readTextSafe(path.join(procPath, "cmdline"))
      ?.replace(/\0/g, " ")
      .trim();
    const kind = cmdline ? codexProcessKind(cmdline) : null;
    if (!kind) {
      continue;
    }

    const cwd = readlinkSafe(path.join(procPath, "cwd"));
    if (!pathRelated(repoRoot, cwd)) {
      continue;
    }

    const tty = readlinkSafe(path.join(procPath, "fd", "0"));
    if (!tty?.startsWith("/dev/pts/")) {
      continue;
    }

    const fdTargets = readFdTargets(procPath);

    processes.push({
      cmdline,
      cwd,
      fdTargets,
      kind,
      parentPid: parseProcParentPid(procPath),
      pid: entry,
      tty,
    });
  }

  const tmpLockPaths = listCodexTmpLocks();
  const byTty = new Map();

  for (const proc of processes) {
    const group = byTty.get(proc.tty) ?? {
      cwd: proc.cwd,
      lockPaths: [],
      nativePids: [],
      pids: [],
      processes: [],
      rolloutPaths: [],
      sessionIds: [],
      tty: proc.tty,
      wrapperPids: [],
    };

    group.cwd = group.cwd ?? proc.cwd;
    group.pids.push(proc.pid);
    group.processes.push(proc);
    if (proc.kind === "native") {
      group.nativePids.push(proc.pid);
    } else {
      group.wrapperPids.push(proc.pid);
    }

    group.rolloutPaths.push(
      ...proc.fdTargets.filter(
        (target) =>
          target.includes("/.codex/sessions/") && target.endsWith(".jsonl"),
      ),
    );
    group.lockPaths.push(
      ...proc.fdTargets.filter(
        (target) => target.includes("/.codex/tmp/") && target.endsWith(".lock"),
      ),
    );

    byTty.set(proc.tty, group);
  }

  return [...byTty.values()].map((terminal) => {
    const rolloutPaths = uniq(terminal.rolloutPaths);
    return {
      ...terminal,
      lockPaths: uniq([...terminal.lockPaths, ...tmpLockPaths]),
      nativePids: uniq(terminal.nativePids),
      pid: terminal.nativePids[0] ?? terminal.wrapperPids[0] ?? terminal.pids[0],
      pids: uniq(terminal.pids),
      rolloutPaths,
      sessionIds: uniq(rolloutPaths.map(extractSessionIdFromRollout)),
      wrapperPids: uniq(terminal.wrapperPids),
    };
  });
}

function buildMarkdown({
  branch,
  changedFiles,
  diffStat,
  generatedAt,
  generatedAtUtc,
  headSha,
  latestCommitSessionId,
  latestCommitSubject,
  priorHandoffs,
  recentMessages,
  repoRoot,
  rolloutSummary,
  statusShort,
  thread,
}) {
  return `# Session Handoff — ${threadDate(thread)}

## Session Metadata

- Session ID: \`${thread.id}\`
- Saved At (${HANDOFF_TIME_ZONE_LABEL}): \`${generatedAt}\`
- Saved At (UTC): \`${generatedAtUtc}\`
- Repo Root: \`${repoRoot}\`
- Thread CWD: \`${thread.cwd ?? "unknown"}\`
- Rollout Path: \`${thread.rollout_path ?? "unknown"}\`
- Branch: \`${branch || thread.git_branch || "unknown"}\`
- HEAD: \`${headSha || thread.git_sha || "unknown"}\`
- Latest Commit: \`${latestCommitSubject || "unknown"}\`
- Latest Commit Session ID: \`${latestCommitSessionId ?? "unknown"}\`
- Title: ${thread.title ?? "Unknown"}
- Model: \`${thread.model ?? "unknown"}\`
- Reasoning Effort: \`${thread.reasoning_effort ?? "unknown"}\`
- Tokens Used: \`${thread.tokens_used ?? "unknown"}\`

## Current User Request

${thread.first_user_message ?? thread.title ?? "Unknown"}

## Prior Handoffs

${formatBulletList(priorHandoffs, (value) => `- \`${value}\``)}

## Recent User Messages

${formatBulletList(
  recentMessages,
  (message) => `- ${markdownTimestamp(message.timestamp)} ${message.text}`,
)}

## Session Activity Summary

${formatBulletList(
  rolloutSummary.activity,
  (event) => `- ${event.timestamp ? `\`${event.timestamp}\` ` : ""}${event.text}`,
  "- No rollout activity summary available.",
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

## Validations Detected In Transcript

${formatBulletList(
  rolloutSummary.validations,
  (event) => `- ${event.timestamp ? `\`${event.timestamp}\` ` : ""}${event.text}`,
  "- None detected in this session transcript.",
)}

## What Changed This Session

- Replace this section with the concrete product and code changes completed in the session.

## Current Status

- Replace this section with current validation status, blockers, and any known runtime gaps.

## Next Recommended Steps

1. Replace this item with the highest-priority next step.
2. Replace this item with the next validation or bring-up step.
`;
}

function writeHandoff(outputPath, markdown, overwrite) {
  const existed = existsSync(outputPath);

  if (!existed || overwrite) {
    writeFileSync(outputPath, markdown, "utf8");
    return existed ? "overwrote" : "created";
  }

  const existing = readFileSync(outputPath, "utf8");
  const merged = mergeEditableSections(existing, markdown);
  writeFileSync(outputPath, merged, "utf8");
  return "updated";
}

function saveHandoffsOnce(args, { failOnEmpty = true } = {}) {
  const repoRoot = resolveRepoRoot(process.cwd());
  const allThreads = loadThreadsFromState();
  const repoThreads = allThreads.filter(
    (thread) =>
      typeof thread.cwd === "string" && pathRelated(repoRoot, thread.cwd),
  );
  const threadsToSave = args.session
    ? allThreads.filter((thread) => thread.id === args.session)
    : repoThreads;

  if (threadsToSave.length === 0) {
    const message = args.session
      ? `no Codex thread found for session ${args.session}`
      : `no persisted Codex threads found for repo ${repoRoot}`;
    if (failOnEmpty) {
      fail(message);
    }
    return {
      liveWarnings: listLiveCodexTerminals(repoRoot),
      message,
      repoRoot,
      savedOutputs: [],
    };
  }

  threadsToSave.sort(
    (left, right) => threadTimestampMs(left) - threadTimestampMs(right),
  );

  const branch = runGit(repoRoot, ["branch", "--show-current"]) || "Unavailable";
  const headSha = runGit(repoRoot, ["rev-parse", "HEAD"]) || "Unavailable";
  const latestCommitSubject = runGit(repoRoot, ["log", "-1", "--pretty=%s"]);
  const latestCommitBody = runGit(repoRoot, ["log", "-1", "--pretty=%B"]);
  const latestCommitSessionId =
    latestCommitBody.match(/Replit-Commit-Session-Id:\s*(.+)/)?.[1]?.trim() ??
    null;
  const statusShort = runGit(repoRoot, ["status", "--short", "--branch"]);
  const diffStat =
    runGit(repoRoot, ["diff", "--stat"]) ||
    "No tracked changes relative to HEAD.";
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
  const masterPath = args.master
    ? path.resolve(args.master)
    : path.join(repoRoot, "SESSION_HANDOFF_MASTER.md");

  const savedOutputs = [];

  for (const thread of threadsToSave) {
    const outputPath = outputPathForThread({ args, repoRoot, thread });
    const currentFileName = path.basename(outputPath);
    const rolloutSummary = loadRolloutSummary(thread.rollout_path);
    const recentMessages = mergeUserMessages(
      loadRecentUserMessagesFromHistory(thread.id),
      rolloutSummary.userMessages,
    );
    const priorHandoffs = listPriorHandoffs(repoRoot, currentFileName);
    const generatedAtUtc = new Date().toISOString();
    const generatedAt = formatMountainTimestamp(new Date(generatedAtUtc));
    const markdown = buildMarkdown({
      branch,
      changedFiles,
      diffStat,
      generatedAt,
      generatedAtUtc,
      headSha,
      latestCommitSessionId,
      latestCommitSubject,
      priorHandoffs,
      recentMessages,
      repoRoot,
      rolloutSummary,
      statusShort,
      thread,
    });
    const action = writeHandoff(outputPath, markdown, args.overwrite);

    if (!args.skipMaster) {
      upsertMasterIndexEntry({
        branch,
        generatedAt,
        generatedAtUtc,
        headSha,
        masterPath,
        outputFileName: currentFileName,
        sessionId: thread.id,
        threadTitle: thread.title,
      });
    }

    savedOutputs.push({ action, outputPath, sessionId: thread.id });
  }

  const persistedThreadIds = new Set(allThreads.map((thread) => thread.id));
  const liveWarnings = listLiveCodexTerminals(repoRoot).filter(
    (terminal) =>
      terminal.sessionIds.length === 0 ||
      !terminal.sessionIds.some((sessionId) =>
        persistedThreadIds.has(sessionId),
      ),
  );

  return {
    liveWarnings,
    repoRoot,
    savedOutputs,
  };
}

function printSaveResult(result, { watchCycle = null } = {}) {
  const prefix =
    typeof watchCycle === "number" ? `watch cycle ${watchCycle}: ` : "";

  if (result.message) {
    process.stderr.write(`session-handoff: ${prefix}${result.message}\n`);
  }

  for (const output of result.savedOutputs) {
    process.stdout.write(
      `${prefix}${output.action}: ${output.outputPath} (${output.sessionId})\n`,
    );
  }

  for (const terminal of result.liveWarnings) {
    process.stderr.write(
      [
        `session-handoff: ${prefix}warning: live Codex terminal has no handoffable persisted session`,
        `pid=${terminal.pid}`,
        `pids=${terminal.pids.join(",") || "unknown"}`,
        `wrapperPids=${terminal.wrapperPids.join(",") || "none"}`,
        `nativePids=${terminal.nativePids.join(",") || "none"}`,
        `tty=${terminal.tty}`,
        `cwd=${terminal.cwd}`,
        `rollouts=${terminal.rolloutPaths.join(",") || "none"}`,
        `locks=${terminal.lockPaths.slice(-3).join(",") || "unknown"}`,
      ].join(" ") + "\n",
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function watchHandoffs(args) {
  process.stderr.write(
    [
      "session-handoff: watch mode started",
      `interval=${args.intervalMs}ms`,
      args.maxCycles ? `maxCycles=${args.maxCycles}` : null,
    ]
      .filter(Boolean)
      .join("; ") + "\n",
  );

  let cycle = 0;
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
  };

  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  while (!stopRequested) {
    cycle += 1;

    try {
      const result = saveHandoffsOnce(args, { failOnEmpty: false });
      printSaveResult(result, { watchCycle: cycle });
    } catch (error) {
      process.stderr.write(
        `session-handoff: watch cycle ${cycle} failed: ${error.message}\n`,
      );
    }

    if (!stopRequested) {
      if (args.maxCycles && cycle >= args.maxCycles) {
        break;
      }
      await sleep(args.intervalMs);
    }
  }

  process.stderr.write("session-handoff: watch mode stopped\n");
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}

if (args.watch) {
  await watchHandoffs(args);
} else {
  printSaveResult(saveHandoffsOnce(args));
}
