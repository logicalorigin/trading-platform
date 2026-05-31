#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

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

function readJsonlTail(filePath, limit) {
  try {
    return readFileSync(filePath, "utf8")
      .trim()
      .split("\n")
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

function value(input) {
  return input === null || input === undefined || input === "" ? "unknown" : String(input);
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
    const child = event.childName ? ` child=${event.childName}` : "";
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
    const stackSuffix = stackFirstFrame ? ` (${stackFirstFrame})` : "";
    console.log(
      `  ${value(event.time)} ${value(event.event)} pid=${value(event.pid)} ${message}${stackSuffix}`,
    );
  }
}

function printEvidence(evidence) {
  console.log("PYRUS Replit Flight Recorder");
  console.log(`Directory: ${evidence.recorderDir}`);
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
