#!/usr/bin/env node
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";

import {
  extractCustomExecCommands,
  textFromCodexValue,
} from "./lib/codex-rollout.mjs";
import {
  redactPersistedText as redact,
  redactPersistedValue,
} from "./lib/redact-persisted-text.mjs";

const repoRoot = process.env.PYRUS_AGENT_RESTART_REPO_ROOT
  ? path.resolve(process.env.PYRUS_AGENT_RESTART_REPO_ROOT)
  : path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultCodexDir = process.env.PYRUS_AGENT_RESTART_CODEX_DIR
  ? path.resolve(process.env.PYRUS_AGENT_RESTART_CODEX_DIR)
  : path.join(process.env.HOME || "/home/runner", ".codex");
const defaultFlightRecorderDir = process.env.PYRUS_FLIGHT_RECORDER_DIR
  ? path.resolve(process.env.PYRUS_FLIGHT_RECORDER_DIR)
  : path.join(repoRoot, ".pyrus-runtime", "flight-recorder");
const defaultWorkflowLogDir = process.env.PYRUS_WORKFLOW_LOG_DIR
  ? path.resolve(process.env.PYRUS_WORKFLOW_LOG_DIR)
  : path.join(repoRoot, ".local", "state", "workflow-logs");

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_SINCE_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_DISCOVERY_ENTRIES = 50_000;
const MAX_SESSION_FILES = 200;
const MAX_SQLITE_FILES = 20;
const MAX_SQLITE_ROWS = 1_000;
const MAX_CODEX_RISK_ACTIVITIES = 1_000;
const MAX_WORKFLOW_FILES = 100;
const MAX_JSONL_TAIL_BYTES = 1024 * 1024;
const MAX_WORKFLOW_TAIL_BYTES = 128 * 1024;
const SQLITE_TIMEOUT_MS = 5_000;
const SQLITE_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_WARNINGS = 100;

function usage() {
  console.log(`Usage: node scripts/diagnose-agent-restarts.mjs [--json] [--dir PATH] [--codex-dir PATH] [--workflow-log-dir PATH] [--since ISO_OR_DURATION] [--around ISO_TIMESTAMP] [--window-minutes N]

Builds an observe-only restart attribution report from PYRUS flight recorder,
Replit workflow logs, and surviving Codex session/log files.

Duration examples for --since: 30m, 2h, 1d.`);
}

function parseDuration(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)(m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  const multiplier =
    unit === "m"
      ? 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  const durationMs = amount * multiplier;
  return Number.isSafeInteger(durationMs) && durationMs <= MAX_DATE_MS
    ? durationMs
    : null;
}

function parseTime(value, nowMs = Date.now()) {
  if (!value) return null;
  const duration = parseDuration(value);
  if (duration !== null) return new Date(nowMs - duration);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function parseRestartArgs(argv, nowMs = Date.now()) {
  const { values, tokens } = parseNodeArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    tokens: true,
    options: {
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      dir: { type: "string" },
      "codex-dir": { type: "string" },
      "workflow-log-dir": { type: "string" },
      since: { type: "string" },
      around: { type: "string" },
      "window-minutes": { type: "string" },
    },
  });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) {
      throw new Error(`Duplicate --${token.name} option.`);
    }
    seen.add(token.name);
  }

  const parsed = {
    help: values.help === true,
    json: false,
    flightRecorderDir: defaultFlightRecorderDir,
    codexDir: defaultCodexDir,
    workflowLogDir: defaultWorkflowLogDir,
    since: new Date(nowMs - DEFAULT_SINCE_MS),
    around: null,
    windowMs: DEFAULT_WINDOW_MS,
  };
  parsed.json = values.json === true;
  if (values.dir !== undefined) {
    if (!values.dir.trim()) throw new Error("--dir requires a non-empty path");
    parsed.flightRecorderDir = path.resolve(values.dir);
  }
  if (values["codex-dir"] !== undefined) {
    if (!values["codex-dir"].trim()) {
      throw new Error("--codex-dir requires a non-empty path");
    }
    parsed.codexDir = path.resolve(values["codex-dir"]);
  }
  if (values["workflow-log-dir"] !== undefined) {
    if (!values["workflow-log-dir"].trim()) {
      throw new Error("--workflow-log-dir requires a non-empty path");
    }
    parsed.workflowLogDir = path.resolve(values["workflow-log-dir"]);
  }
  if (values.since !== undefined) {
    const since = parseTime(values.since, nowMs);
    if (!since) throw new Error(`Invalid --since value: ${values.since}`);
    parsed.since = since;
  }
  if (values.around !== undefined) {
    const around = parseTime(values.around, nowMs);
    if (!around) throw new Error(`Invalid --around value: ${values.around}`);
    parsed.around = around;
  }
  if (values["window-minutes"] !== undefined) {
    const windowMs = Number(values["window-minutes"]) * 60 * 1000;
    if (
      !Number.isSafeInteger(windowMs) ||
      windowMs <= 0 ||
      windowMs > MAX_DATE_MS
    ) {
      throw new Error(
        "--window-minutes requires a positive number with a safe millisecond value",
      );
    }
    parsed.windowMs = windowMs;
  }
  return parsed;
}

function addWarning(warnings, message) {
  if (warnings.includes(message)) return;
  if (warnings.length < MAX_EVIDENCE_WARNINGS) {
    warnings.push(message);
  } else if (
    !warnings.includes("Additional evidence warnings were truncated.")
  ) {
    warnings.push("Additional evidence warnings were truncated.");
  }
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown error";
}

function listFilesRecursive(dir, predicate, warnings, label) {
  const results = [];
  let entryCount = 0;
  let capped = false;

  function visit(currentDir) {
    if (capped) return;
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
        b.name.localeCompare(a.name),
      );
    } catch (error) {
      addWarning(
        warnings,
        `${label} directory unreadable (${errorCode(error)}): ${currentDir}`,
      );
      return;
    }
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_DISCOVERY_ENTRIES) {
        capped = true;
        break;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && predicate(fullPath, entry.name))
        results.push(fullPath);
      if (capped) break;
    }
  }

  visit(dir);
  if (capped) {
    addWarning(
      warnings,
      `${label} discovery stopped at ${MAX_DISCOVERY_ENTRIES} entries.`,
    );
  }
  return results;
}

function readFileTail(filePath, maxBytes, warnings, label) {
  let descriptor;
  try {
    descriptor = openSync(filePath, "r");
    const size = fstatSync(descriptor).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
      addWarning(
        warnings,
        `${label} was read from a bounded tail of ${maxBytes} bytes: ${filePath}`,
      );
    }
    return { text, truncated: start > 0 };
  } catch (error) {
    addWarning(
      warnings,
      `${label} unreadable (${errorCode(error)}): ${filePath}`,
    );
    return { text: "", truncated: false };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readJsonlTail(filePath, warnings, label) {
  const { text, truncated } = readFileTail(
    filePath,
    MAX_JSONL_TAIL_BYTES,
    warnings,
    label,
  );
  const records = [];
  let malformed = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;
    try {
      records.push({
        value: JSON.parse(line),
        line: truncated ? null : index + 1,
      });
    } catch {
      malformed += 1;
    }
  }
  if (malformed > 0) {
    addWarning(
      warnings,
      `${label} contained ${malformed} malformed JSONL line(s): ${filePath}`,
    );
  }
  return records;
}

function inspectFiles(files, warnings, label) {
  const inspected = files.map(fileInfo);
  for (const info of inspected) {
    if (!Number.isFinite(info.mtimeMs)) {
      addWarning(
        warnings,
        `${label} file unavailable during selection (${info.error ?? "unknown error"}): ${info.path}`,
      );
    }
  }
  return inspected;
}

export function selectRecentFiles(files, range, limit, warnings, label) {
  const selected = inspectFiles(files, warnings, label)
    .filter(
      (info) => Number.isFinite(info.mtimeMs) && info.mtimeMs >= range.startMs,
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (selected.length > limit) {
    addWarning(
      warnings,
      `${label} file selection was capped at ${limit} of ${selected.length}.`,
    );
  }
  return selected.slice(0, limit).map((info) => info.path);
}

function fileInfo(filePath) {
  try {
    const stat = statSync(filePath);
    return {
      path: filePath,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { path: filePath, exists: false, error: errorCode(error) };
  }
}

function capRecentActivities(activities, warnings, label) {
  if (activities.length <= MAX_CODEX_RISK_ACTIVITIES) return;
  activities.sort((left, right) => left.timestampMs - right.timestampMs);
  activities.splice(0, activities.length - MAX_CODEX_RISK_ACTIVITIES);
  addWarning(
    warnings,
    `${label} activity was capped at ${MAX_CODEX_RISK_ACTIVITIES} newest matches.`,
  );
}

function riskCategories(input) {
  const text =
    `${input.name || ""}\n${input.command || ""}\n${input.output || ""}`.toLowerCase();
  const categories = [];
  if (
    /(restart_workflow|run replit|configure your app|workflow|replit.*restart|dev:replit|riker\.replit|artifact\.toml|\.replit)/.test(
      text,
    )
  ) {
    categories.push("workflow-risk");
  }
  if (
    /(chromium|chrome|browser\.newpage|page\.goto|pyrusqa=safe|node --input-type=module)/.test(
      text,
    )
  ) {
    categories.push("browser-risk");
  }
  if (
    /(curl .*127\.0\.0\.1|curl .*localhost|psql |signal-monitor\/matrix|diagnostics\/latest|\/api\/streams|sleep \d+)/.test(
      text,
    )
  ) {
    categories.push("live-api-risk");
  }
  if (
    /(sandbox_permissions|require_escalated|approval|denied|unauthorized|oauth|plugin)/.test(
      text,
    )
  ) {
    categories.push("policy-risk");
  }
  if (
    /(process running with session id|timed out|timeout|killed|sigkill|rss|memory|cpu|find \/var\/log|journalctl|dmesg)/.test(
      text,
    )
  ) {
    categories.push("resource-risk");
  }
  return [...new Set(categories)];
}

function outputRiskCategories(output) {
  const text = String(output || "").toLowerCase();
  const categories = [];
  const operationalOutput =
    /(process running with session id|process exited with code [1-9]|timed out|killed|sigkill|drizzlequeryerror|error:|unauthorized|request aborted|connection terminated unexpectedly|write_stdin failed|stdin is closed|\brss\b|memory\.current|memory\.peak|oom|p95latencyms)/.test(
      text,
    );
  if (!operationalOutput) return categories;
  if (
    /(restart_workflow|run replit app|configure your app|dev:replit|\.replit-artifact\/artifact\.toml)/.test(
      text,
    )
  ) {
    categories.push("workflow-risk");
  }
  if (
    /(chromium|chrome crash reports|browser\.newpage|page\.goto)/.test(text)
  ) {
    categories.push("browser-risk");
  }
  if (
    /(curl:|http:\/\/127\.0\.0\.1|http:\/\/localhost|signal-monitor\/matrix|diagnostics\/latest|\/api\/streams)/.test(
      text,
    )
  ) {
    categories.push("live-api-risk");
  }
  if (
    /(sandbox_permissions|require_escalated|approval|denied|unauthorized|oauth|plugin sync)/.test(
      text,
    )
  ) {
    categories.push("policy-risk");
  }
  if (
    /(process running with session id|timed out|killed|sigkill|\brss\b|memory|cpu|find \/var\/log|journalctl|dmesg|write_stdin failed|stdin is closed)/.test(
      text,
    )
  ) {
    categories.push("resource-risk");
  }
  return [...new Set(categories)];
}

function collectIncidents(dir, range, warnings) {
  const records = readJsonlTail(
    path.join(dir, "incidents.jsonl"),
    warnings,
    "Flight-recorder incidents",
  );
  let invalidRecords = 0;
  const incidents = records
    .map((record) => record.value)
    .filter((incident) => {
      const valid =
        incident && typeof incident === "object" && !Array.isArray(incident);
      if (!valid) invalidRecords += 1;
      return valid;
    })
    .map((incident) => ({
      ...incident,
      observedAtMs: Date.parse(incident.observedAt || ""),
    }))
    .filter((incident) => {
      const valid = Number.isFinite(incident.observedAtMs);
      if (!valid) invalidRecords += 1;
      return valid;
    });
  if (invalidRecords > 0) {
    addWarning(
      warnings,
      `Flight-recorder incidents contained ${invalidRecords} invalid record(s).`,
    );
  }
  return incidents.filter(
    (incident) =>
      incident.observedAtMs >= range.startMs &&
      incident.observedAtMs <= range.endMs,
  );
}

function collectRuntimeFileInfo() {
  return [
    "/run/replit/env/latest.json",
    "/run/replit/env/last.json",
    "/run/replit/pid1/flags.json",
    "/run/replit/toolchain.json",
  ].map(fileInfo);
}

function parseFunctionArguments(args) {
  if (!args) return {};
  if (typeof args === "object") return args;
  try {
    return JSON.parse(args);
  } catch {
    return { raw: String(args) };
  }
}

export function collectCodexSessionActivity(
  codexDir,
  range = { startMs: 0, endMs: Date.now() },
  warnings = [],
) {
  const sessionRoot = path.join(codexDir, "sessions");
  const files = selectRecentFiles(
    listFilesRecursive(
      sessionRoot,
      (_filePath, name) =>
        name.startsWith("rollout-") && name.endsWith(".jsonl"),
      warnings,
      "Codex session",
    ),
    range,
    MAX_SESSION_FILES,
    warnings,
    "Codex session",
  ).sort();
  const activities = [];

  for (const filePath of files) {
    const sessionFile = path.relative(codexDir, filePath);
    for (const record of readJsonlTail(filePath, warnings, "Codex session")) {
      const item = record.value;
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const timestampMs = Date.parse(item.timestamp || "");
      if (
        !Number.isFinite(timestampMs) ||
        timestampMs < range.startMs ||
        timestampMs > range.endMs ||
        item.type !== "response_item"
      ) {
        continue;
      }
      const payload = item.payload ?? {};
      if (payload.type === "function_call") {
        const args = parseFunctionArguments(payload.arguments);
        const command = args.cmd || args.command || payload.arguments || "";
        const categories = riskCategories({
          name: payload.name,
          command,
          output: payload.arguments,
        });
        if (categories.length === 0) continue;
        activities.push({
          timestamp: item.timestamp,
          timestampMs,
          source: "codex-session",
          sessionFile,
          line: record.line,
          tool: payload.name || "unknown",
          categories,
          summary: truncate(redact(command || payload.arguments || ""), 500),
        });
      }
      if (payload.type === "function_call_output") {
        const output = textFromCodexValue(payload.output);
        const categories = outputRiskCategories(output);
        if (categories.length === 0) continue;
        activities.push({
          timestamp: item.timestamp,
          timestampMs,
          source: "codex-session-output",
          sessionFile,
          line: record.line,
          tool: payload.call_id || "output",
          categories,
          summary: truncate(redact(output).replace(/\s+/g, " "), 500),
        });
      }
      if (payload.type === "custom_tool_call" && payload.name === "exec") {
        const extracted = extractCustomExecCommands(payload.input);
        if (extracted.unknownInvocations > 0) {
          addWarning(
            warnings,
            `Codex session contained ${extracted.unknownInvocations} unparsed exec invocation(s): ${sessionFile}`,
          );
        }
        for (const command of extracted.commands) {
          const categories = riskCategories({ name: "exec_command", command });
          if (categories.length === 0) continue;
          activities.push({
            timestamp: item.timestamp,
            timestampMs,
            source: "codex-session",
            sessionFile,
            line: record.line,
            tool: "exec_command",
            categories,
            summary: truncate(redact(command), 500),
          });
        }
      }
      if (payload.type === "custom_tool_call_output") {
        const output = textFromCodexValue(payload.output);
        const categories = outputRiskCategories(output);
        if (categories.length > 0) {
          activities.push({
            timestamp: item.timestamp,
            timestampMs,
            source: "codex-session-output",
            sessionFile,
            line: record.line,
            tool: payload.call_id || "output",
            categories,
            summary: truncate(redact(output).replace(/\s+/g, " "), 500),
          });
        }
      }
    }
    capRecentActivities(activities, warnings, "Codex session risk");
  }

  return activities;
}

export function collectCodexSqliteLogActivity(
  codexDir,
  range = { startMs: 0, endMs: Date.now() },
  warnings = [],
  spawn = spawnSync,
) {
  const files = selectRecentFiles(
    listFilesRecursive(
      codexDir,
      (_filePath, name) => /^logs_.*\.sqlite$/.test(name),
      warnings,
      "Codex SQLite log",
    ),
    range,
    MAX_SQLITE_FILES,
    warnings,
    "Codex SQLite log",
  ).sort();
  const rows = [];
  for (const filePath of files) {
    const script = [
      "import sqlite3, json, os, sys",
      "from urllib.parse import quote",
      "uri='file:'+quote(os.path.abspath(sys.argv[1]), safe='/')+'?mode=ro'",
      "conn=sqlite3.connect(uri, uri=True, timeout=1)",
      "conn.execute('pragma query_only=on')",
      "cur=conn.cursor()",
      "terms=['unauthorized','oauth','plugin','browser','spawn','sandbox','approval','denied','workflow','replit','timeout','failed']",
      "conds=' OR '.join(['lower(feedback_log_body) like ? or lower(target) like ?' for _ in terms])",
      "params=[float(sys.argv[2]), float(sys.argv[3])]",
      "[params.extend([f'%{t}%', f'%{t}%']) for t in terms]",
      "params.append(int(sys.argv[4]))",
      "q='select ts, ts_nanos, level, target, feedback_log_body from logs where ts >= ? and ts <= ? and ('+conds+') order by ts desc, ts_nanos desc limit ?'",
      "for ts,nanos,level,target,msg in cur.execute(q, params): print(json.dumps({'ts':ts,'ts_nanos':nanos,'level':level,'target':target,'message':msg}))",
    ].join("\n");
    const result = spawn(
      "python",
      [
        "-c",
        script,
        filePath,
        String(range.startMs / 1000),
        String(range.endMs / 1000),
        String(MAX_SQLITE_ROWS + 1),
      ],
      {
        encoding: "utf8",
        maxBuffer: SQLITE_MAX_BUFFER_BYTES,
        timeout: SQLITE_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    if (result.status !== 0) {
      addWarning(
        warnings,
        `Codex SQLite log query failed (${result.error?.code ?? `status ${result.status}`}): ${filePath}`,
      );
      continue;
    }
    const outputLines = String(result.stdout || "")
      .split(/\r?\n/)
      .filter(Boolean);
    if (outputLines.length > MAX_SQLITE_ROWS) {
      addWarning(
        warnings,
        `Codex SQLite log query was capped at ${MAX_SQLITE_ROWS} rows: ${filePath}`,
      );
    }
    for (const line of outputLines.slice(0, MAX_SQLITE_ROWS)) {
      try {
        const row = JSON.parse(line);
        const timestampMs =
          Number(row.ts) * 1000 + Math.floor(Number(row.ts_nanos || 0) / 1e6);
        if (
          !Number.isFinite(timestampMs) ||
          timestampMs < range.startMs ||
          timestampMs > range.endMs
        ) {
          continue;
        }
        const message = row.message || "";
        const categories = riskCategories({
          command: row.target,
          output: message,
        });
        if (categories.length === 0) continue;
        rows.push({
          timestamp: new Date(timestampMs).toISOString(),
          timestampMs,
          source: "codex-log",
          sessionFile: path.relative(codexDir, filePath),
          tool: row.target || row.level || "log",
          categories,
          summary: truncate(redact(message).replace(/\s+/g, " "), 500),
        });
      } catch {
        addWarning(
          warnings,
          `Codex SQLite log returned a malformed diagnostic row: ${filePath}`,
        );
      }
    }
    capRecentActivities(rows, warnings, "Codex SQLite risk");
  }
  return rows;
}

function collectWorkflowLogs(
  workflowLogDir,
  incidents,
  range,
  windowMs,
  warnings,
) {
  const files = listFilesRecursive(
    workflowLogDir,
    (_filePath, name) => name.endsWith(".shell.exec.0"),
    warnings,
    "Workflow log",
  );
  const selectedWindows =
    incidents.length > 0
      ? incidents.map((incident) => ({
          start: incident.observedAtMs - windowMs,
          end: incident.observedAtMs + windowMs,
        }))
      : [{ start: range.startMs, end: range.endMs }];
  const selected = inspectFiles(files, warnings, "Workflow log")
    .filter(
      (info) =>
        Number.isFinite(info.mtimeMs) &&
        selectedWindows.some(
          (window) =>
            info.mtimeMs >= window.start && info.mtimeMs <= window.end,
        ),
    )
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  if (selected.length > MAX_WORKFLOW_FILES) {
    addWarning(
      warnings,
      `Workflow log selection was capped at ${MAX_WORKFLOW_FILES} of ${selected.length}.`,
    );
  }
  return selected.slice(-MAX_WORKFLOW_FILES).map((info) => ({
    ...info,
    path: path.relative(repoRoot, info.path),
    tail: readTextTail(info.path, 8, warnings).map((line) =>
      truncate(redact(line), 400),
    ),
  }));
}

function readTextTail(filePath, limit, warnings) {
  return readFileTail(
    filePath,
    MAX_WORKFLOW_TAIL_BYTES,
    warnings,
    "Workflow log",
  )
    .text.split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);
}

function truncate(text, length) {
  const value = String(text || "");
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function timestampBoundary(activities, target, afterMatches) {
  let low = 0;
  let high = activities.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const timestampMs = activities[middle].timestampMs;
    if (timestampMs < target || (afterMatches && timestampMs === target)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function riskActivityNear(activities, incident, windowMs) {
  const start = incident.observedAtMs - windowMs;
  const end = incident.observedAtMs + windowMs;
  const first = timestampBoundary(activities, start, false);
  const afterLast = timestampBoundary(activities, end, true);
  return activities.slice(Math.max(first, afterLast - 20), afterLast);
}

function incidentAttribution(incident, nearbyRiskActivity, evidenceComplete) {
  const nearbyRiskActivityStatus =
    nearbyRiskActivity.length > 0
      ? "available"
      : evidenceComplete
        ? "no_matching_risk_activity"
        : "unknown";
  const nearbyRiskActivityAvailable =
    nearbyRiskActivityStatus === "available"
      ? true
      : nearbyRiskActivityStatus === "no_matching_risk_activity"
        ? false
        : null;
  if (incident.classification === "container-replaced") {
    return {
      summary:
        "Replit runtime/container replacement observed from guest boot evidence; host trigger unavailable inside guest",
      hostTriggerAvailable: false,
      nearbyRiskActivityAvailable,
      nearbyRiskActivityStatus,
    };
  }
  if (incident.classification === "same-container-supervisor-abrupt") {
    return {
      summary:
        "Replit workflow/supervisor relaunched while prior supervisor heartbeat was fresh; exact host trigger depends on nearby matching risk activity evidence",
      hostTriggerAvailable: false,
      nearbyRiskActivityAvailable,
      nearbyRiskActivityStatus,
    };
  }
  return {
    summary: "classification-specific attribution unavailable",
    hostTriggerAvailable: false,
    nearbyRiskActivityAvailable,
    nearbyRiskActivityStatus,
  };
}

function clampDateMs(value) {
  return Math.max(-MAX_DATE_MS, Math.min(MAX_DATE_MS, value));
}

export function selectedRanges(options) {
  const nowMs = options.nowMs ?? Date.now();
  if (options.around) {
    return {
      incident: {
        startMs: clampDateMs(options.around.getTime() - options.windowMs),
        endMs: clampDateMs(options.around.getTime() + options.windowMs),
      },
      evidence: {
        startMs: clampDateMs(options.around.getTime() - options.windowMs),
        endMs: clampDateMs(options.around.getTime() + options.windowMs),
      },
    };
  }
  return {
    incident: {
      startMs: clampDateMs(options.since.getTime()),
      endMs: clampDateMs(nowMs),
    },
    evidence: {
      startMs: clampDateMs(options.since.getTime() - options.windowMs),
      endMs: clampDateMs(nowMs),
    },
  };
}

export function buildReport(options) {
  const warnings = [];
  const ranges = selectedRanges(options);
  const incidents = collectIncidents(
    options.flightRecorderDir,
    ranges.incident,
    warnings,
  );
  const riskActivities = [
    ...collectCodexSessionActivity(options.codexDir, ranges.evidence, warnings),
    ...collectCodexSqliteLogActivity(
      options.codexDir,
      ranges.evidence,
      warnings,
    ),
  ].sort((a, b) => a.timestampMs - b.timestampMs);
  capRecentActivities(riskActivities, warnings, "Combined Codex risk");
  const workflowLogs = collectWorkflowLogs(
    options.workflowLogDir,
    incidents,
    ranges.incident,
    options.windowMs,
    warnings,
  );
  const runtimeFiles = collectRuntimeFileInfo();
  const evidenceComplete = warnings.length === 0;

  return redactPersistedValue({
    generatedAt: new Date().toISOString(),
    mode: "observe-only",
    inputs: {
      flightRecorderDir: options.flightRecorderDir,
      codexDir: options.codexDir,
      workflowLogDir: options.workflowLogDir,
      since: options.since.toISOString(),
      around: options.around?.toISOString() ?? null,
      windowMinutes: options.windowMs / 60_000,
    },
    evidenceCompleteness: {
      complete: evidenceComplete,
      warnings,
    },
    runtimeFiles,
    incidentCount: incidents.length,
    incidents: incidents.map((incident) => {
      const nearbyRiskActivity = riskActivityNear(
        riskActivities,
        incident,
        options.windowMs,
      );
      return {
        observedAt: incident.observedAt,
        classification: incident.classification,
        confidence: incident.confidence,
        severity: incident.severity,
        message: incident.message,
        previousUpdatedAt: incident.previousUpdatedAt,
        evidence: incident.evidence ?? [],
        lastEvent: incident.lastEvent ?? null,
        attribution: incidentAttribution(
          incident,
          nearbyRiskActivity,
          evidenceComplete,
        ),
        nearbyRiskActivity,
      };
    }),
    workflowLogs,
    codexRiskActivityCount: riskActivities.length,
    codexRiskActivityTail: riskActivities.slice(-20),
  });
}

function value(input) {
  return input === null || input === undefined || input === ""
    ? "unknown"
    : String(input);
}

function printReport(report) {
  console.log("PYRUS Agent Restart Attribution");
  console.log(`Mode: ${report.mode}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Window: ${report.inputs.windowMinutes} minutes`);
  console.log(`Flight recorder: ${report.inputs.flightRecorderDir}`);
  console.log(`Codex dir: ${report.inputs.codexDir}`);
  console.log(
    `Evidence complete: ${report.evidenceCompleteness.complete ? "yes" : "no"}`,
  );
  for (const warning of report.evidenceCompleteness.warnings) {
    console.log(`  warning: ${warning}`);
  }

  console.log("\nRuntime Files");
  for (const file of report.runtimeFiles) {
    console.log(
      `  ${file.path}: ${value(file.mtime)} size=${value(file.size)}`,
    );
  }

  console.log(`\nIncidents: ${report.incidentCount}`);
  if (report.incidents.length === 0) {
    console.log(
      report.evidenceCompleteness.complete
        ? "  none in selected window"
        : "  none observed in selected window; evidence is incomplete",
    );
  }
  for (const incident of report.incidents) {
    console.log(
      `\n- ${value(incident.observedAt)} ${value(incident.classification)} ${value(incident.confidence)}`,
    );
    console.log(`  message: ${value(incident.message)}`);
    console.log(`  previous updated: ${value(incident.previousUpdatedAt)}`);
    console.log(`  attribution: ${incident.attribution.summary}`);
    console.log(
      `  nearby matching risk activity: ${incident.attribution.nearbyRiskActivityStatus.replaceAll("_", " ")}`,
    );
    if (!incident.attribution.hostTriggerAvailable) {
      console.log(
        "  host trigger: unavailable inside guest unless Replit exposes a host-side audit record",
      );
    }
    for (const activity of incident.nearbyRiskActivity.slice(-10)) {
      console.log(
        `    ${activity.timestamp} ${activity.categories.join(",")} ${activity.source} ${activity.tool}: ${activity.summary}`,
      );
    }
  }

  console.log(`\nWorkflow Logs Near Incidents: ${report.workflowLogs.length}`);
  for (const log of report.workflowLogs.slice(-8)) {
    console.log(`  ${log.mtime} ${log.path} size=${log.size}`);
    for (const line of log.tail.slice(-3)) {
      console.log(`    ${line}`);
    }
  }

  console.log(
    `\nCodex Risk Activity Tail: ${report.codexRiskActivityTail.length}/${report.codexRiskActivityCount}`,
  );
  for (const activity of report.codexRiskActivityTail.slice(-10)) {
    console.log(
      `  ${activity.timestamp} ${activity.categories.join(",")} ${activity.source} ${activity.tool}: ${activity.summary}`,
    );
  }
}

if (import.meta.main) {
  try {
    const options = parseRestartArgs(process.argv.slice(2));
    if (options.help) {
      usage();
      process.exit(0);
    }
    const report = buildReport(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } catch (error) {
    console.error(
      redact(error instanceof Error ? error.message : String(error)),
    );
    usage();
    process.exit(1);
  }
}
