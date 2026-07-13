#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const JSONL_TAIL_BYTES = 256 * 1024;

function usage() {
  console.log(`Usage: node scripts/inspect-replit-flight-recorder.mjs [--json] [--dir PATH]

Reads PYRUS Replit restart evidence from .pyrus-runtime/flight-recorder.
Use --json for machine-readable output.`);
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    dir: process.env.PYRUS_FLIGHT_RECORDER_DIR
      ? path.resolve(process.env.PYRUS_FLIGHT_RECORDER_DIR)
      : path.join(repoRoot, ".pyrus-runtime", "flight-recorder"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--dir requires a path");
      }
      parsed.dir = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function readJsonlTail(filePath, limit, maxBytes = JSONL_TAIL_BYTES) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const size = fstatSync(fd).size;
    if (size === 0) return [];
    const length = Math.min(size, maxBytes);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }
    return text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { parseError: true, raw: line.slice(0, 500) };
        }
      });
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The evidence read has already completed or failed.
      }
    }
  }
}

function eventText(event) {
  return [event?.name, event?.message, event?.stack]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n");
}

function isPostgresDisconnectEvent(event) {
  if (!event || typeof event !== "object") {
    return false;
  }
  if (event.event !== "uncaught-exception" && event.event !== "node-warning") {
    return false;
  }

  const text = eventText(event);
  return (
    /connection terminated unexpectedly/i.test(text) ||
    /connection terminated due to connection timeout/i.test(text) ||
    /node_modules\/(?:\.pnpm\/)?pg@?[^/]*\/node_modules\/pg\/lib\/client\.js/i.test(text) ||
    /node_modules\/pg\/lib\/client\.js/i.test(text)
  );
}

function listJsonlFiles(dir, prefix) {
  try {
    return readdirSync(dir)
      .filter((file) => file.startsWith(prefix) && file.endsWith(".jsonl"))
      .sort();
  } catch {
    return [];
  }
}

function collectEvidence(dir) {
  const supervisorCurrent = safeReadJson(path.join(dir, "current.json"));
  const apiCurrent = safeReadJson(path.join(dir, "api-current.json"));
  const incidents = readJsonlTail(path.join(dir, "incidents.jsonl"), 20);
  const recentSupervisorEvents = listJsonlFiles(dir, "events-")
    .slice(-2)
    .flatMap((file) => readJsonlTail(path.join(dir, file), 20));
  const recentApiEvents = listJsonlFiles(dir, "api-events-")
    .slice(-2)
    .flatMap((file) => readJsonlTail(path.join(dir, file), 20));

  return {
    recorderDir: dir,
    exists: existsSync(dir),
    supervisorCurrent,
    apiCurrent,
    incidents,
    latestIncident: incidents.at(-1) ?? null,
    recentSupervisorEvents,
    recentApiEvents,
    recentPostgresDisconnects: recentApiEvents.filter(isPostgresDisconnectEvent),
  };
}

export function value(input) {
  if (input === null || input === undefined || input === "") return "unknown";
  const rendered = stripVTControlCharacters(String(input))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return rendered || "unknown";
}

export function incidentAttribution(incident) {
  if (!incident) {
    return "none";
  }
  if (incident.classification === "container-replaced") {
    return [
      "Replit runtime/container replacement observed from guest boot evidence",
      "host trigger unavailable inside guest",
    ].join("; ");
  }
  if (incident.classification === "api-child-exit") {
    return "PYRUS API child process exited inside the workspace";
  }
  if (incident.classification === "web-child-exit") {
    return "PYRUS web child process exited inside the workspace";
  }
  if (incident.classification === "suspected-resource-pressure") {
    return "guest resource pressure observed before restart";
  }
  if (incident.classification === "same-container-supervisor-abrupt") {
    return "supervisor stopped without clean shutdown in the same container";
  }
  if (incident.classification === "controlled-handoff") {
    return "controlled supervisor handoff recorded inside the workspace";
  }
  return "classification-specific attribution unavailable";
}

function printReplitSnapshot(snapshot) {
  console.log("\nReplit Runtime");
  if (!snapshot || typeof snapshot !== "object") {
    console.log("  none recorded");
    return;
  }

  const env = snapshot.env ?? {};
  const dbToken = snapshot.dbToken ?? {};
  const files = snapshot.runtimeFiles ?? {};
  console.log(`  session: ${value(env.REPLIT_SESSION)}`);
  console.log(`  cluster: ${value(env.REPLIT_CLUSTER)}`);
  console.log(`  container: ${value(env.REPLIT_CONTAINER)}`);
  console.log(`  pid1 version: ${value(env.REPLIT_PID1_VERSION)}`);
  console.log(`  db token issued: ${value(dbToken.issuedAt)}`);
  console.log(`  env latest mtime: ${value(files.envLatest?.mtimeIso)}`);
  console.log(`  pid1 flags mtime: ${value(files.pid1Flags?.mtimeIso)}`);
}

function printEventTail(title, events) {
  console.log(`\n${title}`);
  if (events.length === 0) {
    console.log("  none");
    return;
  }
  for (const event of events.slice(-8)) {
    const name = value(event.event);
    const pid = value(event.pid);
    const child = event.childName ? ` child=${value(event.childName)}` : "";
    const code = event.code !== undefined ? ` code=${value(event.code)}` : "";
    const signal = event.signal !== undefined ? ` signal=${value(event.signal)}` : "";
    console.log(`  ${value(event.time)} ${name} pid=${pid}${child}${code}${signal}`);
  }
}

function printPostgresDisconnects(events) {
  console.log("\nRecent Postgres Disconnects");
  if (events.length === 0) {
    console.log("  none");
    return;
  }

  for (const event of events.slice(-5)) {
    const message = value(event.message);
    const stackFirstFrame =
      typeof event.stack === "string"
        ? event.stack.split("\n").slice(1, 2).join("").trim()
        : "";
    const stackSuffix = stackFirstFrame ? ` (${value(stackFirstFrame)})` : "";
    console.log(
      `  ${value(event.time)} ${value(event.event)} pid=${value(event.pid)} ${message}${stackSuffix}`,
    );
  }
}

function printEvidence(evidence) {
  console.log("PYRUS Replit Flight Recorder");
  console.log(`Directory: ${value(evidence.recorderDir)}`);
  if (!evidence.exists) {
    console.log("Status: no recorder directory yet");
    return;
  }

  const supervisor = evidence.supervisorCurrent ?? {};
  const api = evidence.apiCurrent ?? {};
  const latest = evidence.latestIncident ?? {};
  const lifecycle = supervisor.lifecycle ?? {};
  const supervisorInfo = supervisor.supervisor ?? {};
  const memory = api.memoryMb ?? {};
  const requests = api.requests ?? {};
  const apiPressure = api.apiPressure ?? {};

  console.log("\nSupervisor");
  console.log(`  updated: ${value(supervisor.updatedAt)}`);
  console.log(`  phase: ${value(lifecycle.phase)}`);
  console.log(`  pid: ${value(supervisorInfo.pid)}`);
  console.log(`  lock acquired: ${value(supervisorInfo.lockAcquired)}`);
  console.log(`  boot: ${value(supervisor.boot?.bootId)}`);
  printReplitSnapshot(supervisor.replit);

  console.log("\nAPI");
  console.log(`  updated: ${value(api.updatedAt)}`);
  console.log(`  pid: ${value(api.pid)}`);
  console.log(`  pressure: ${value(apiPressure.level)}`);
  console.log(`  rss: ${value(memory.rss)} MB`);
  console.log(`  request p95: ${value(requests.p95Ms)} ms`);

  console.log("\nLatest Incident");
  if (!evidence.latestIncident) {
    console.log("  none");
  } else {
    console.log(`  observed: ${value(latest.observedAt)}`);
    console.log(`  classification: ${value(latest.classification)}`);
    console.log(`  confidence: ${value(latest.confidence)}`);
    console.log(`  severity: ${value(latest.severity)}`);
    console.log(`  attribution: ${incidentAttribution(latest)}`);
    console.log(`  message: ${value(latest.message)}`);
    const reasons = Array.isArray(latest.contributingReasons)
      ? latest.contributingReasons.join(", ")
      : null;
    const incidentEvidence = Array.isArray(latest.evidence)
      ? latest.evidence.join(", ")
      : null;
    console.log(`  reasons: ${value(reasons)}`);
    console.log(`  evidence: ${value(incidentEvidence)}`);
  }

  console.log(`\nIncident Count: ${evidence.incidents.length}`);
  printPostgresDisconnects(evidence.recentPostgresDisconnects);
  printEventTail("Recent Supervisor Events", evidence.recentSupervisorEvents);
  printEventTail("Recent API Events", evidence.recentApiEvents);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const evidence = collectEvidence(args.dir);
    if (args.json) {
      console.log(JSON.stringify(evidence, null, 2));
    } else {
      printEvidence(evidence);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
