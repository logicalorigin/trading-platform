#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const agentsDir = path.join(repoRoot, ".agents");
const sessionsDir = path.join(agentsDir, "sessions");
const indexPath = path.join(agentsDir, "SESSION_INDEX.md");
const recoveryReadmePath = path.join(agentsDir, "README.md");
const rollingHandoffPath = path.join(repoRoot, "SESSION_HANDOFF.md");
const terminalStatuses = new Set(["completed", "cancelled", "aborted", "archived", "superseded"]);
const defaultRecoveryWindowHours = 72;
const defaultRecoverDisplayLimit = 8;

const argv = process.argv.slice(2);
const command = argv[0] || "show";
const options = parseArgs(argv.slice(1));

const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const sessionId = sanitizeSessionId(
  options.session
  || options.session_id
  || process.env.CODEX_THREAD_ID
  || `manual-${nowIso.replace(/[:]/g, "").replace(/\..*$/, "")}`,
);
const sessionFile = path.join(sessionsDir, `${sessionId}.md`);

switch (command) {
  case "recover":
    recoverSession();
    break;
  case "start":
    startSession();
    break;
  case "note":
    appendNote();
    break;
  case "show":
    showSession();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
}

function startSession() {
  ensureLayout();

  const branch = getBranchName();
  const replitSession = process.env.REPLIT_SESSION || "unknown";
  const cwd = process.cwd();
  const resumeFrom = sanitizeSessionId(options.resume || options.resume_from || "");
  const forceNew = isTruthy(options["force-new"] || options.force_new || options.force);
  const startedAt = fileExists(sessionFile)
    ? readMeta(readFile(sessionFile)).started_at_utc || nowIso
    : nowIso;
  const goal = collapseWhitespace(
    options.goal
    || options.g
    || options._.join(" ")
    || "Document current Codex session state and recovery context.",
  );
  const status = collapseWhitespace(options.status || "active");
  const initialNote = collapseWhitespace(options.note || "");
  const recoveryCandidates = !fileExists(sessionFile) && !resumeFrom && !forceNew
    ? getRecoveryCandidates({
      excludeSessionId: sessionId,
      branch,
      cwd,
      replitSession,
      recentHours: getRecoveryWindowHours(),
    })
    : [];
  const blockingRecoveryCandidates = recoveryCandidates.filter((candidate) => candidate.strongMatch);

  if (blockingRecoveryCandidates.length) {
    printRecoveryBlocker({
      branch,
      cwd,
      replitSession,
      candidates: blockingRecoveryCandidates,
      relatedCandidates: recoveryCandidates.filter((candidate) => !candidate.strongMatch),
    });
    process.exitCode = 2;
    return;
  }

  if (recoveryCandidates.length) {
    printRecoveryWarning({
      branch,
      cwd,
      replitSession,
      candidates: recoveryCandidates,
    });
  }

  if (resumeFrom && !findSessionEntryById(resumeFrom)) {
    console.error(`Cannot resume unknown session: ${resumeFrom}`);
    process.exitCode = 1;
    return;
  }

  let content;
  if (fileExists(sessionFile)) {
    content = readFile(sessionFile);
    content = upsertMeta(content, "last_updated_utc", nowIso);
    content = upsertMeta(content, "status", status);
    if (goal) {
      content = upsertMeta(content, "goal", goal);
    }
  } else {
    content = buildTemplate({
      sessionId,
      startedAt,
      lastUpdatedAt: nowIso,
      branch,
      cwd,
      replitSession,
      status,
      goal,
    });

    if (resumeFrom) {
      content = appendSectionBullet(content, "Timeline", `\`${nowIso}\` Resumed from prior session \`${resumeFrom}\`.`);
      content = appendSectionBullet(content, "Recovery Notes", `Recovered from prior ledger \`${resumeFrom}\`.`);
    }
  }

  if (initialNote) {
    content = appendSectionBullet(content, "Timeline", `\`${nowIso}\` ${initialNote}`);
    content = upsertMeta(content, "last_updated_utc", nowIso);
  }

  fs.writeFileSync(sessionFile, content);
  rewriteIndex();
  process.stdout.write(`${sessionFile}\n`);
}

function recoverSession() {
  ensureLayout();

  const branch = getBranchName();
  const replitSession = process.env.REPLIT_SESSION || "unknown";
  const cwd = process.cwd();
  const candidates = getRecoveryCandidates({
    excludeSessionId: sessionId,
    branch,
    cwd,
    replitSession,
    recentHours: getRecoveryWindowHours(),
  });

  if (!candidates.length) {
    process.stdout.write(
      `No unresolved recovery candidates found for branch ${branch} in ${cwd}.\n` +
      "You can start a fresh ledger with:\n" +
      '  npm run session:start -- --goal "<current goal>"\n',
    );
    return;
  }

  const lines = [
    `Recovery candidates for branch ${branch} in ${cwd}:`,
    "",
    "Resume by starting the current thread with one of these prior ledgers:",
    `  npm run session:start -- --resume ${candidates[0].sessionId} --goal "<current goal>"`,
    "",
  ];

  const displayCandidates = candidates.slice(0, getRecoverDisplayLimit());

  for (const candidate of displayCandidates) {
    lines.push(
      `- ${candidate.sessionId} | ${candidate.status} | ${candidate.lastUpdated || "unknown"} | ${candidate.goal || "No goal recorded"}`,
    );
    lines.push(`  ledger: ${path.relative(repoRoot, candidate.absolutePath)}`);
    lines.push(`  match: ${candidate.matchSummary}`);
  }

  if (displayCandidates.length < candidates.length) {
    lines.push("");
    lines.push(`... ${candidates.length - displayCandidates.length} more related ledgers omitted.`);
  }

  lines.push("");
  lines.push("Use --force-new with session:start only when you intend to ignore these unresolved ledgers.");
  process.stdout.write(`${lines.join("\n")}\n`);
}

function appendNote() {
  ensureLayout();

  const text = collapseWhitespace(options.note || options.text || options._.join(" "));
  if (!text) {
    console.error("Usage: node scripts/codex_session_log.cjs note -- \"checkpoint note\"");
    process.exitCode = 1;
    return;
  }

  if (!fileExists(sessionFile)) {
    const seeded = buildTemplate({
      sessionId,
      startedAt: nowIso,
      lastUpdatedAt: nowIso,
      branch: getBranchName(),
      cwd: process.cwd(),
      replitSession: process.env.REPLIT_SESSION || "unknown",
      status: collapseWhitespace(options.status || "active"),
      goal: "Document current Codex session state and recovery context.",
    });
    fs.writeFileSync(sessionFile, seeded);
  }

  let content = readFile(sessionFile);
  content = upsertMeta(content, "last_updated_utc", nowIso);
  if (options.status) {
    content = upsertMeta(content, "status", collapseWhitespace(options.status));
  }
  content = appendSectionBullet(content, "Timeline", `\`${nowIso}\` ${text}`);
  fs.writeFileSync(sessionFile, content);
  rewriteIndex();
  process.stdout.write(`${sessionFile}\n`);
}

function showSession() {
  ensureLayout();
  if (!fileExists(sessionFile)) {
    process.stdout.write(`${sessionFile}\n`);
    return;
  }
  process.stdout.write(readFile(sessionFile));
}

function ensureLayout() {
  fs.mkdirSync(sessionsDir, { recursive: true });
  if (!fileExists(recoveryReadmePath)) {
    fs.writeFileSync(
      recoveryReadmePath,
      "# Codex Session Recovery\n\nUse `.agents/sessions/<CODEX_THREAD_ID>.md` as the canonical per-session ledger.\n",
    );
  }
}

function buildTemplate({
  sessionId,
  startedAt,
  lastUpdatedAt,
  branch,
  cwd,
  replitSession,
  status,
  goal,
}) {
  return `# Codex Session Ledger

- \`session_id\`: \`${sessionId}\`
- \`started_at_utc\`: \`${startedAt}\`
- \`last_updated_utc\`: \`${lastUpdatedAt}\`
- \`branch\`: \`${branch}\`
- \`cwd\`: \`${cwd}\`
- \`replit_session\`: \`${replitSession}\`
- \`status\`: \`${status}\`
- \`goal\`: \`${goal}\`

## Linked Docs

- [Session Index](../SESSION_INDEX.md)
- [Recovery Standard](../README.md)
- [Existing Rolling Handoff](../../${path.basename(rollingHandoffPath)})

## Scope

- pending

## Files In Play

- pending

## Timeline

- \`${lastUpdatedAt}\` Session ledger created.

## Verification

- pending

## Next Actions

- pending

## Recovery Notes

- Resume from this file first during deharness recovery.
`;
}

function rewriteIndex() {
  ensureLayout();
  const entries = loadSessionEntries()
    .sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)));

  const lines = [
    "# Codex Session Index",
    "",
    "Read this file first during crash/deharness recovery. Open the newest relevant session ledger before using git/log inference.",
    "",
    "| last_updated_utc | status | branch | session_id | goal | ledger |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of entries) {
    const ledgerLink = `[.agents/sessions/${entry.fileName}](./sessions/${entry.fileName})`;
    lines.push(
      `| ${escapeTable(entry.lastUpdated)} | ${escapeTable(entry.status)} | \`${escapeBackticks(entry.branch)}\` | \`${escapeBackticks(entry.sessionId)}\` | ${escapeTable(entry.goal)} | ${ledgerLink} |`,
    );
  }

  lines.push("");
  fs.writeFileSync(indexPath, `${lines.join("\n")}`);
}

function readMeta(content) {
  return {
    session_id: matchMeta(content, "session_id"),
    started_at_utc: matchMeta(content, "started_at_utc"),
    last_updated_utc: matchMeta(content, "last_updated_utc"),
    branch: matchMeta(content, "branch"),
    cwd: matchMeta(content, "cwd"),
    replit_session: matchMeta(content, "replit_session"),
    status: matchMeta(content, "status"),
    goal: matchMeta(content, "goal"),
  };
}

function matchMeta(content, key) {
  const pattern = new RegExp(`^- \\\`${escapeRegExp(key)}\\\`: \\\`([^\\n]*)\\\`$`, "m");
  return content.match(pattern)?.[1] || "";
}

function upsertMeta(content, key, value) {
  const escapedValue = escapeBackticks(value);
  const line = `- \`${key}\`: \`${escapedValue}\``;
  const pattern = new RegExp(`^- \\\`${escapeRegExp(key)}\\\`: \\\`[^\\n]*\\\`$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  const headerPattern = /^# Codex Session Ledger\n\n/m;
  if (headerPattern.test(content)) {
    return content.replace(headerPattern, `# Codex Session Ledger\n\n${line}\n`);
  }
  return `${line}\n${content}`;
}

function appendSectionBullet(content, heading, bulletText) {
  const headingLine = `## ${heading}`;
  if (!content.includes(headingLine)) {
    return `${content.trimEnd()}\n\n${headingLine}\n\n- ${bulletText}\n`;
  }

  const startIndex = content.indexOf(headingLine);
  const afterHeadingIndex = startIndex + headingLine.length;
  const remainder = content.slice(afterHeadingIndex);
  const nextHeadingOffset = remainder.search(/\n## /);

  if (nextHeadingOffset === -1) {
    const sectionBody = remainder.trimEnd();
    return `${content.slice(0, afterHeadingIndex)}${sectionBody}\n\n- ${bulletText}\n`;
  }

  const sectionEndIndex = afterHeadingIndex + nextHeadingOffset;
  const section = content.slice(0, sectionEndIndex).replace(/\n*$/, "\n");
  const rest = content.slice(sectionEndIndex);
  return `${section}- ${bulletText}${rest}`;
}

function parseArgs(parts) {
  const result = { _: [] };
  let passthrough = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (passthrough) {
      result._.push(part);
      continue;
    }
    if (part === "--") {
      passthrough = true;
      continue;
    }
    if (!part.startsWith("--")) {
      result._.push(part);
      continue;
    }

    const trimmed = part.slice(2);
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex !== -1) {
      result[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
      continue;
    }

    const next = parts[index + 1];
    if (next && !next.startsWith("--")) {
      result[trimmed] = next;
      index += 1;
      continue;
    }

    result[trimmed] = "true";
  }
  return result;
}

function getBranchName() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|");
}

function escapeBackticks(value) {
  return String(value || "").replace(/`/g, "'");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isTruthy(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function getRecoveryWindowHours() {
  const parsed = Number(options["window-hours"] || options.window_hours || defaultRecoveryWindowHours);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultRecoveryWindowHours;
}

function getRecoverDisplayLimit() {
  const parsed = Number(options.limit || options["display-limit"] || options.display_limit || defaultRecoverDisplayLimit);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultRecoverDisplayLimit;
}

function sanitizeSessionId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function loadSessionEntries() {
  ensureLayout();
  return fs.readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const absolutePath = path.join(sessionsDir, name);
      const content = readFile(absolutePath);
      const meta = readMeta(content);
      return {
        absolutePath,
        fileName: name,
        sessionId: meta.session_id || path.basename(name, ".md"),
        startedAt: meta.started_at_utc || "",
        lastUpdated: meta.last_updated_utc || meta.started_at_utc || "",
        status: meta.status || "unknown",
        branch: meta.branch || "unknown",
        cwd: meta.cwd || "",
        replitSession: meta.replit_session || "",
        goal: meta.goal || "No goal recorded",
      };
    });
}

function findSessionEntryById(targetSessionId) {
  return loadSessionEntries().find((entry) => entry.sessionId === targetSessionId) || null;
}

function getRecoveryCandidates({
  excludeSessionId,
  branch,
  cwd,
  replitSession,
  recentHours,
}) {
  const nowMs = Date.parse(nowIso);
  const recentWindowMs = recentHours * 60 * 60 * 1000;

  return loadSessionEntries()
    .filter((entry) => entry.sessionId !== excludeSessionId)
    .filter((entry) => !terminalStatuses.has(String(entry.status || "").toLowerCase()))
    .filter((entry) => entry.branch === branch)
    .filter((entry) => entry.cwd === cwd)
    .filter((entry) => {
      const updatedMs = Date.parse(entry.lastUpdated || entry.startedAt || "");
      const recentlyUpdated = Number.isFinite(updatedMs) && (nowMs - updatedMs) <= recentWindowMs;
      const sameReplitSession = entry.replitSession && replitSession && entry.replitSession === replitSession;
      return sameReplitSession || recentlyUpdated;
    })
    .map((entry) => rankRecoveryCandidate(entry, { nowMs, recentHours, replitSession }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(right.lastUpdated).localeCompare(String(left.lastUpdated));
    });
}

function rankRecoveryCandidate(entry, { nowMs, recentHours, replitSession }) {
  const matchReasons = ["same repo cwd", "same branch"];
  let score = 5;
  const sameReplitSession = Boolean(
    entry.replitSession
    && replitSession
    && entry.replitSession === replitSession,
  );

  if (sameReplitSession) {
    score += 4;
    matchReasons.push("same REPLIT_SESSION");
  }

  const updatedMs = Date.parse(entry.lastUpdated || entry.startedAt || "");
  if (Number.isFinite(updatedMs)) {
    const ageHours = (nowMs - updatedMs) / (60 * 60 * 1000);
    if (ageHours <= 6) {
      score += 3;
      matchReasons.push("updated within 6h");
    } else if (ageHours <= 24) {
      score += 2;
      matchReasons.push("updated within 24h");
    } else if (ageHours <= recentHours) {
      score += 1;
      matchReasons.push(`updated within ${recentHours}h`);
    }
  }

  return {
    ...entry,
    score,
    strongMatch: sameReplitSession,
    matchSummary: matchReasons.join(", "),
  };
}

function printRecoveryBlocker({ branch, cwd, replitSession, candidates, relatedCandidates = [] }) {
  const lines = [
    "Refusing to create a brand-new session ledger while same-session recovery candidates already exist.",
    `Context: branch=${branch}, cwd=${cwd}, REPLIT_SESSION=${replitSession}`,
    "",
    "Recover first with:",
    "  npm run session:recover",
    "",
    "Then resume intentionally with one of:",
  ];

  for (const candidate of candidates) {
    lines.push(`  npm run session:start -- --resume ${candidate.sessionId} --goal "<current goal>"`);
  }

  if (relatedCandidates.length) {
    lines.push("");
    lines.push("Other recent related ledgers:");
    for (const candidate of relatedCandidates.slice(0, 5)) {
      lines.push(`  - ${candidate.sessionId} | ${candidate.lastUpdated || "unknown"} | ${candidate.goal || "No goal recorded"}`);
    }
  }

  lines.push("");
  lines.push("Use --force-new only when you explicitly want a separate thread.");
  console.error(lines.join("\n"));
}

function printRecoveryWarning({ branch, cwd, replitSession, candidates }) {
  const lines = [
    "Proceeding with a new session ledger, but recent related ledgers exist.",
    `Context: branch=${branch}, cwd=${cwd}, REPLIT_SESSION=${replitSession}`,
    "",
    "Review them first if you are recovering from a crash/deharness event:",
    "  npm run session:recover",
  ];

  for (const candidate of candidates.slice(0, 5)) {
    lines.push(`  - ${candidate.sessionId} | ${candidate.lastUpdated || "unknown"} | ${candidate.goal || "No goal recorded"} | ${candidate.matchSummary}`);
  }

  lines.push("");
  console.error(lines.join("\n"));
}
