#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function usage() {
  console.log(`Usage: node scripts/diagnose-agent-restarts.mjs [--json] [--dir PATH] [--codex-dir PATH] [--workflow-log-dir PATH] [--since ISO_OR_DURATION] [--around ISO_TIMESTAMP] [--window-minutes N]

Builds an observe-only restart attribution report from PYRUS flight recorder,
Replit workflow logs, and surviving Codex session/log files.

Duration examples for --since: 30m, 2h, 1d.`);
}

function parseDuration(value) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)(m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function parseTime(value, nowMs = Date.now()) {
  if (!value) return null;
  const duration = parseDuration(value);
  if (duration !== null) return new Date(nowMs - duration);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    flightRecorderDir: defaultFlightRecorderDir,
    codexDir: defaultCodexDir,
    workflowLogDir: defaultWorkflowLogDir,
    since: new Date(Date.now() - DEFAULT_SINCE_MS),
    around: null,
    windowMs: DEFAULT_WINDOW_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--dir") {
      parsed.flightRecorderDir = path.resolve(requiredValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--codex-dir") {
      parsed.codexDir = path.resolve(requiredValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--workflow-log-dir") {
      parsed.workflowLogDir = path.resolve(requiredValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--since") {
      const value = requiredValue(argv, ++index, arg);
      const parsedTime = parseTime(value);
      if (!parsedTime) throw new Error(`Invalid --since value: ${value}`);
      parsed.since = parsedTime;
      continue;
    }
    if (arg === "--around") {
      const value = requiredValue(argv, ++index, arg);
      const parsedTime = parseTime(value);
      if (!parsedTime) throw new Error(`Invalid --around value: ${value}`);
      parsed.around = parsedTime;
      continue;
    }
    if (arg === "--window-minutes") {
      const value = Number(requiredValue(argv, ++index, arg));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--window-minutes requires a positive number");
      }
      parsed.windowMs = value * 60 * 1000;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJsonl(filePath) {
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { parseError: true, raw: line.slice(0, 500) };
        }
      });
  } catch {
    return [];
  }
}

function listFilesRecursive(dir, predicate, results = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(fullPath, predicate, results);
    } else if (entry.isFile() && predicate(fullPath, entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
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
  } catch {
    return { path: filePath, exists: false };
  }
}

function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  text = text.replace(/code=[^&"\s]+/gi, "code=<redacted>");
  text = text.replace(/token=[^&"\s]+/gi, "token=<redacted>");
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");
  text = text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://<redacted>");
  text = text.replace(/(DATABASE_URL=)[^\s"']+/gi, "$1<redacted>");
  text = text.replace(/(PYRUS_MARKETING_DASHBOARD_TOKEN=)[^\s"']+/gi, "$1<redacted>");
  text = text.replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s]+/gi, "$1<redacted>");
  return text;
}

function riskCategories(input) {
  const text = `${input.name || ""}\n${input.command || ""}\n${input.output || ""}`.toLowerCase();
  const categories = [];
  if (/(restart_workflow|run replit|configure your app|workflow|replit.*restart|dev:replit|riker\.replit|artifact\.toml|\.replit)/.test(text)) {
    categories.push("workflow-risk");
  }
  if (/(chromium|chrome|browser\.newpage|page\.goto|pyrusqa=safe|node --input-type=module)/.test(text)) {
    categories.push("browser-risk");
  }
  if (/(curl .*127\.0\.0\.1|curl .*localhost|psql |signal-monitor\/matrix|diagnostics\/latest|\/api\/streams|sleep \d+)/.test(text)) {
    categories.push("live-api-risk");
  }
  if (/(sandbox_permissions|require_escalated|approval|denied|unauthorized|oauth|plugin)/.test(text)) {
    categories.push("policy-risk");
  }
  if (/(process running with session id|timed out|timeout|killed|sigkill|rss|memory|cpu|find \/var\/log|journalctl|dmesg)/.test(text)) {
    categories.push("resource-risk");
  }
  return [...new Set(categories)];
}

function outputRiskCategories(output) {
  const text = String(output || "").toLowerCase();
  const categories = [];
  const operationalOutput =
    /(process running with session id|process exited with code [1-9]|timed out|killed|sigkill|drizzlequeryerror|error:|unauthorized|request aborted|connection terminated unexpectedly|write_stdin failed|stdin is closed|\brss\b|memory\.current|memory\.peak|oom|p95latencyms)/.test(text);
  if (!operationalOutput) return categories;
  if (/(restart_workflow|run replit app|configure your app|dev:replit|\.replit-artifact\/artifact\.toml)/.test(text)) {
    categories.push("workflow-risk");
  }
  if (/(chromium|chrome crash reports|browser\.newpage|page\.goto)/.test(text)) {
    categories.push("browser-risk");
  }
  if (/(curl:|http:\/\/127\.0\.0\.1|http:\/\/localhost|signal-monitor\/matrix|diagnostics\/latest|\/api\/streams)/.test(text)) {
    categories.push("live-api-risk");
  }
  if (/(sandbox_permissions|require_escalated|approval|denied|unauthorized|oauth|plugin sync)/.test(text)) {
    categories.push("policy-risk");
  }
  if (/(process running with session id|timed out|killed|sigkill|\brss\b|memory|cpu|find \/var\/log|journalctl|dmesg|write_stdin failed|stdin is closed)/.test(text)) {
    categories.push("resource-risk");
  }
  return [...new Set(categories)];
}

function collectIncidents(dir, since, around, windowMs) {
  const incidents = readJsonl(path.join(dir, "incidents.jsonl"))
    .filter((incident) => incident && typeof incident === "object")
    .map((incident) => ({
      ...incident,
      observedAtMs: Date.parse(incident.observedAt || ""),
    }))
    .filter((incident) => Number.isFinite(incident.observedAtMs));

  if (around) {
    const start = around.getTime() - windowMs;
    const end = around.getTime() + windowMs;
    return incidents.filter(
      (incident) => incident.observedAtMs >= start && incident.observedAtMs <= end,
    );
  }

  return incidents.filter((incident) => incident.observedAtMs >= since.getTime());
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

function collectCodexSessionActivity(codexDir) {
  const sessionRoot = path.join(codexDir, "sessions");
  const files = listFilesRecursive(
    sessionRoot,
    (_filePath, name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
  ).sort();
  const activities = [];

  for (const filePath of files) {
    const sessionFile = path.relative(codexDir, filePath);
    for (const [lineIndex, item] of readJsonl(filePath).entries()) {
      const timestampMs = Date.parse(item.timestamp || "");
      if (!Number.isFinite(timestampMs) || item.type !== "response_item") continue;
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
          line: lineIndex + 1,
          tool: payload.name || "unknown",
          categories,
          summary: truncate(redact(command || payload.arguments || ""), 500),
        });
      }
      if (payload.type === "function_call_output") {
        const output = payload.output || "";
        const categories = outputRiskCategories(output);
        if (categories.length === 0) continue;
        activities.push({
          timestamp: item.timestamp,
          timestampMs,
          source: "codex-session-output",
          sessionFile,
          line: lineIndex + 1,
          tool: payload.call_id || "output",
          categories,
          summary: truncate(redact(output).replace(/\s+/g, " "), 500),
        });
      }
    }
  }

  return activities;
}

function collectCodexSqliteLogActivity(codexDir) {
  const files = listFilesRecursive(
    codexDir,
    (_filePath, name) => /^logs_.*\.sqlite$/.test(name),
  ).sort();
  const rows = [];
  for (const filePath of files) {
    const script = [
      "import sqlite3, json, sys",
      "conn=sqlite3.connect(sys.argv[1])",
      "cur=conn.cursor()",
      "terms=['unauthorized','oauth','plugin','browser','spawn','sandbox','approval','denied','workflow','replit','timeout','failed']",
      "conds=' OR '.join(['lower(feedback_log_body) like ? or lower(target) like ?' for _ in terms])",
      "params=[]",
      "[params.extend([f'%{t}%', f'%{t}%']) for t in terms]",
      "q='select ts, ts_nanos, level, target, feedback_log_body from logs where '+conds+' order by id'",
      "for ts,nanos,level,target,msg in cur.execute(q, params): print(json.dumps({'ts':ts,'ts_nanos':nanos,'level':level,'target':target,'message':msg}))",
    ].join("\n");
    const result = spawnSync("python", ["-c", script, filePath], { encoding: "utf8" });
    if (result.status !== 0) continue;
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        const timestampMs = Number(row.ts) * 1000 + Math.floor(Number(row.ts_nanos || 0) / 1e6);
        const message = row.message || "";
        const categories = riskCategories({ command: row.target, output: message });
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
        // Ignore malformed diagnostic rows.
      }
    }
  }
  return rows;
}

function collectWorkflowLogs(workflowLogDir, incidents, windowMs) {
  const files = listFilesRecursive(
    workflowLogDir,
    (_filePath, name) => name.endsWith(".shell.exec.0"),
  );
  const incidentWindows = incidents.map((incident) => ({
    start: incident.observedAtMs - windowMs,
    end: incident.observedAtMs + windowMs,
  }));
  return files
    .map(fileInfo)
    .filter((info) =>
      Number.isFinite(info.mtimeMs) &&
      (incidentWindows.length === 0 ||
        incidentWindows.some((window) => info.mtimeMs >= window.start && info.mtimeMs <= window.end)),
    )
    .map((info) => ({
      ...info,
      path: path.relative(repoRoot, info.path),
      tail: readTextTail(info.path, 8).map((line) => truncate(redact(line), 400)),
    }));
}

function readTextTail(filePath, limit) {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

function truncate(text, length) {
  const value = String(text || "");
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function activityNear(activities, incident, windowMs) {
  const start = incident.observedAtMs - windowMs;
  const end = incident.observedAtMs + windowMs;
  return activities
    .filter((activity) => activity.timestampMs >= start && activity.timestampMs <= end)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(-20);
}

function incidentAttribution(incident, nearbyActivity) {
  if (incident.classification === "container-replaced") {
    return {
      summary: "Replit runtime/container replacement observed from guest boot evidence; host trigger unavailable inside guest",
      hostTriggerAvailable: false,
      nearbyAgentActivityAvailable: nearbyActivity.length > 0,
    };
  }
  if (incident.classification === "same-container-supervisor-abrupt") {
    return {
      summary: "Replit workflow/supervisor relaunched while prior supervisor heartbeat was fresh; exact host trigger depends on nearby activity evidence",
      hostTriggerAvailable: false,
      nearbyAgentActivityAvailable: nearbyActivity.length > 0,
    };
  }
  return {
    summary: "classification-specific attribution unavailable",
    hostTriggerAvailable: false,
    nearbyAgentActivityAvailable: nearbyActivity.length > 0,
  };
}

function buildReport(options) {
  const incidents = collectIncidents(
    options.flightRecorderDir,
    options.since,
    options.around,
    options.windowMs,
  );
  const activities = [
    ...collectCodexSessionActivity(options.codexDir),
    ...collectCodexSqliteLogActivity(options.codexDir),
  ].sort((a, b) => a.timestampMs - b.timestampMs);
  const workflowLogs = collectWorkflowLogs(options.workflowLogDir, incidents, options.windowMs);
  const runtimeFiles = collectRuntimeFileInfo();

  return {
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
    runtimeFiles,
    incidentCount: incidents.length,
    incidents: incidents.map((incident) => {
      const nearbyActivity = activityNear(activities, incident, options.windowMs);
      return {
        observedAt: incident.observedAt,
        classification: incident.classification,
        confidence: incident.confidence,
        severity: incident.severity,
        message: incident.message,
        previousUpdatedAt: incident.previousUpdatedAt,
        evidence: incident.evidence ?? [],
        lastEvent: incident.lastEvent ?? null,
        attribution: incidentAttribution(incident, nearbyActivity),
        nearbyActivity,
      };
    }),
    workflowLogs,
    codexActivityCount: activities.length,
    codexActivityTail: activities.slice(-20),
  };
}

function value(input) {
  return input === null || input === undefined || input === "" ? "unknown" : String(input);
}

function printReport(report) {
  console.log("PYRUS Agent Restart Attribution");
  console.log(`Mode: ${report.mode}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Window: ${report.inputs.windowMinutes} minutes`);
  console.log(`Flight recorder: ${report.inputs.flightRecorderDir}`);
  console.log(`Codex dir: ${report.inputs.codexDir}`);

  console.log("\nRuntime Files");
  for (const file of report.runtimeFiles) {
    console.log(`  ${file.path}: ${value(file.mtime)} size=${value(file.size)}`);
  }

  console.log(`\nIncidents: ${report.incidentCount}`);
  if (report.incidents.length === 0) {
    console.log("  none in selected window");
  }
  for (const incident of report.incidents) {
    console.log(`\n- ${value(incident.observedAt)} ${value(incident.classification)} ${value(incident.confidence)}`);
    console.log(`  message: ${value(incident.message)}`);
    console.log(`  previous updated: ${value(incident.previousUpdatedAt)}`);
    console.log(`  attribution: ${incident.attribution.summary}`);
    console.log(
      `  nearby agent activity: ${incident.attribution.nearbyAgentActivityAvailable ? "available" : "none found"}`,
    );
    if (!incident.attribution.hostTriggerAvailable) {
      console.log("  host trigger: unavailable inside guest unless Replit exposes a host-side audit record");
    }
    for (const activity of incident.nearbyActivity.slice(-10)) {
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

  console.log(`\nCodex Risk Activity Tail: ${report.codexActivityTail.length}/${report.codexActivityCount}`);
  for (const activity of report.codexActivityTail.slice(-10)) {
    console.log(
      `  ${activity.timestamp} ${activity.categories.join(",")} ${activity.source} ${activity.tool}: ${activity.summary}`,
    );
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
}
