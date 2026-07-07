import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_EVENTS_DAYS = 7;
const DEFAULT_RETENTION_INCIDENTS_DAYS = 30;
const CPU_CLOCK_TICKS = 100;
const SECRET_ENV_PATTERN = /(TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|PG|AUTH|COOKIE|CREDENTIAL)/i;
const SAFE_ENV_NAMES = [
  "BASE_PATH",
  "NODE_ENV",
  "PORT",
  "PYRUS_API_PORT",
  "PYRUS_FRONTEND_PORT",
  "PYRUS_REPLIT_RUN",
  "REPLIT_MODE",
];
const SAFE_REPLIT_ENV_NAMES = [
  "REPLIT_CLUSTER",
  "REPLIT_CONTAINER",
  "REPLIT_PID1_VERSION",
  "REPLIT_SESSION",
  "REPL_IN_MICROVM",
];
const REPLIT_RUNTIME_FILES = {
  envLatest: "/run/replit/env/latest.json",
  envLast: "/run/replit/env/last.json",
  pid1Flags: "/run/replit/pid1/flags.json",
  toolchain: "/run/replit/toolchain.json",
};

function nowIso() {
  return new Date().toISOString();
}

function dateKey(iso = nowIso()) {
  return iso.slice(0, 10);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmpPath, filePath);
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unixSecondsToIso(value) {
  const parsed = safeNumber(value);
  return parsed === null ? null : new Date(parsed * 1000).toISOString();
}

function round(value, places = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readFileSnapshot(filePath) {
  try {
    if (!existsSync(filePath)) {
      return { exists: false };
    }
    const { mtimeMs, size } = statSync(filePath);
    return {
      exists: true,
      size,
      mtimeMs: round(mtimeMs, 0),
      mtimeIso: Number.isFinite(mtimeMs) ? new Date(mtimeMs).toISOString() : null,
    };
  } catch {
    return { exists: false };
  }
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function readReplitDbTokenClaims(env = process.env) {
  if (!env.REPLIT_DB_URL) return null;
  try {
    const url = new URL(env.REPLIT_DB_URL);
    const token = url.pathname.split("/").filter(Boolean).at(-1);
    const claims = decodeJwtPayload(token);
    if (!claims || typeof claims !== "object") return null;
    return {
      issuedAt: unixSecondsToIso(claims.iat),
      expiresAt: unixSecondsToIso(claims.exp),
    };
  } catch {
    return null;
  }
}

export function readReplitRuntimeSnapshot(env = process.env) {
  const safeEnv = {};
  for (const name of SAFE_REPLIT_ENV_NAMES) {
    if (Object.prototype.hasOwnProperty.call(env, name) && !SECRET_ENV_PATTERN.test(name)) {
      safeEnv[name] = env[name] ?? null;
    }
  }

  return {
    env: safeEnv,
    dbToken: readReplitDbTokenClaims(env),
    runtimeFiles: Object.fromEntries(
      Object.entries(REPLIT_RUNTIME_FILES).map(([name, filePath]) => [
        name,
        readFileSnapshot(filePath),
      ]),
    ),
  };
}

export function resolveFlightRecorderDir(repoRoot, env = process.env) {
  return env.PYRUS_FLIGHT_RECORDER_DIR
    ? path.resolve(env.PYRUS_FLIGHT_RECORDER_DIR)
    : path.join(repoRoot, ".pyrus-runtime", "flight-recorder");
}

export function readContainerBoot() {
  const stat = readText("/proc/stat");
  const match = stat?.match(/^btime\s+(\d+)$/m);
  const btime = match ? Number(match[1]) : null;
  return {
    btime,
    bootedAt:
      Number.isFinite(btime) && btime !== null
        ? new Date(btime * 1000).toISOString()
        : null,
    bootId: Number.isFinite(btime) && btime !== null ? `btime:${btime}` : null,
  };
}

function readProcessCommand(pid) {
  const raw = readText(`/proc/${pid}/cmdline`);
  return raw?.replaceAll("\0", " ").trim() || null;
}

function readProcessStat(pid) {
  const raw = readText(`/proc/${pid}/stat`);
  if (!raw) return null;
  const afterName = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
  return {
    state: afterName[0] ?? null,
    ppid: safeNumber(afterName[1]),
    pgid: safeNumber(afterName[2]),
    utimeTicks: safeNumber(afterName[11]),
    stimeTicks: safeNumber(afterName[12]),
    startTimeTicks: safeNumber(afterName[19]),
  };
}

function readStatusValue(pid, key) {
  const raw = readText(`/proc/${pid}/status`);
  const line = raw?.split("\n").find((entry) => entry.startsWith(`${key}:`));
  const match = line?.match(/:\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

function readProcessSample(pid, previousSample) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const stat = readProcessStat(pid);
  if (!stat) return null;
  const sampledAtMs = Date.now();
  const cpuTicks = (stat.utimeTicks ?? 0) + (stat.stimeTicks ?? 0);
  let cpuPercent = null;
  if (
    previousSample &&
    Number.isFinite(previousSample.sampledAtMs) &&
    Number.isFinite(previousSample.cpuTicks)
  ) {
    const elapsedMs = sampledAtMs - previousSample.sampledAtMs;
    const elapsedTicks = cpuTicks - previousSample.cpuTicks;
    if (elapsedMs > 0 && elapsedTicks >= 0) {
      const cpuSeconds = elapsedTicks / CPU_CLOCK_TICKS;
      const wallSeconds = elapsedMs / 1000;
      cpuPercent = round((cpuSeconds / wallSeconds / os.cpus().length) * 100, 1);
    }
  }
  const rssKb = readStatusValue(pid, "VmRSS");
  return {
    pid,
    ppid: stat.ppid,
    pgid: stat.pgid,
    state: stat.state,
    command: readProcessCommand(pid),
    rssMb: rssKb === null ? null : round(rssKb / 1024, 1),
    cpuPercent,
    cpuTicks,
    sampledAtMs,
    startTimeTicks: stat.startTimeTicks,
  };
}

function readCgroupKeyValues(filePath) {
  const raw = readText(filePath);
  if (!raw) return {};
  const values = {};
  for (const line of raw.trim().split("\n")) {
    const [key, value] = line.trim().split(/\s+/);
    if (key) values[key] = safeNumber(value);
  }
  return values;
}

function readCgroupNumber(filePath) {
  const raw = readText(filePath)?.trim();
  if (!raw || raw === "max") return raw === "max" ? "max" : null;
  return safeNumber(raw);
}

export function readCgroupSnapshot() {
  return {
    memory: {
      currentBytes: readCgroupNumber("/sys/fs/cgroup/memory.current"),
      maxBytes: readCgroupNumber("/sys/fs/cgroup/memory.max"),
      peakBytes: readCgroupNumber("/sys/fs/cgroup/memory.peak"),
      events: readCgroupKeyValues("/sys/fs/cgroup/memory.events"),
    },
    cpu: readCgroupKeyValues("/sys/fs/cgroup/cpu.stat"),
    pids: {
      current: readCgroupNumber("/sys/fs/cgroup/pids.current"),
      max: readCgroupNumber("/sys/fs/cgroup/pids.max"),
    },
  };
}

function sanitizeEnv(env = process.env) {
  const safe = {};
  for (const name of SAFE_ENV_NAMES) {
    if (Object.prototype.hasOwnProperty.call(env, name) && !SECRET_ENV_PATTERN.test(name)) {
      safe[name] = env[name] ?? null;
    }
  }
  return safe;
}

function pressureEvidence(previous) {
  const evidence = [];
  const apiProcess = previous?.processes?.api;
  const apiPressure = previous?.apiPressure;
  const eventLoopP95Ms = safeNumber(previous?.apiRuntime?.eventLoopP95Ms);
  const memoryEvents = previous?.cgroup?.memory?.events ?? {};

  if ((safeNumber(apiProcess?.rssMb) ?? 0) >= 1600) {
    evidence.push(`api-rss:${apiProcess.rssMb}MB`);
  }
  if ((safeNumber(apiProcess?.cpuPercent) ?? 0) >= 85) {
    evidence.push(`api-cpu:${apiProcess.cpuPercent}%`);
  }
  if (eventLoopP95Ms !== null && eventLoopP95Ms >= 1000) {
    evidence.push(`event-loop-p95:${eventLoopP95Ms}ms`);
  }
  if (apiPressure?.level === "warning") {
    evidence.push("api-pressure:warning");
  }
  if ((safeNumber(memoryEvents.oom) ?? 0) > 0) {
    evidence.push(`cgroup-oom:${memoryEvents.oom}`);
  }
  if ((safeNumber(memoryEvents.oom_kill) ?? 0) > 0) {
    evidence.push(`cgroup-oom-kill:${memoryEvents.oom_kill}`);
  }
  return evidence;
}

function lastRelevantChildExit(events, previous) {
  const source = events.length ? events : [previous?.lastEvent].filter(Boolean);
  // `expected` marks intentional kills (SIGUSR2 in-place reload, shutdown
  // teardown). A stale expected exit in the tail must never be read as the
  // run's terminal cause — that mislabeled reload exits as api-child-exit.
  return [...source]
    .reverse()
    .find((entry) => entry?.event === "child-exit" && entry.childName && !entry.expected);
}

function incidentSeverity(classification, contributingReasons) {
  if (classification === "api-child-exit" || classification === "web-child-exit") {
    return "warning";
  }
  if (classification === "container-replaced") {
    return contributingReasons.includes("suspected-resource-pressure")
      ? "warning"
      : "warning";
  }
  if (classification === "suspected-resource-pressure") {
    return "warning";
  }
  if (classification === "same-container-supervisor-abrupt") {
    return "warning";
  }
  return "info";
}

export function classifyPreviousRun(
  previous,
  events = [],
  currentBoot = readContainerBoot(),
  currentReplit = readReplitRuntimeSnapshot(),
) {
  if (!previous || typeof previous !== "object") {
    return {
      classification: "none",
      confidence: "low",
      shouldPersist: false,
      contributingReasons: [],
      evidence: ["no previous state"],
    };
  }

  const lastEvent = previous.lastEvent ?? events.at(-1) ?? null;
  const shutdownComplete =
    lastEvent?.event === "supervisor-shutdown-complete" ||
    previous.lifecycle?.phase === "shutdown-complete";
  const shutdownStatus = safeNumber(lastEvent?.status ?? previous.lifecycle?.status);
  const childExit = lastRelevantChildExit(events, previous);
  const pressure = pressureEvidence(previous);
  const contributingReasons = pressure.length > 0 ? ["suspected-resource-pressure"] : [];

  let classification = "unknown-external-replit-restart";
  let confidence = "low";
  let evidence = [];
  let shouldPersist = true;

  if (shutdownComplete && (shutdownStatus === null || shutdownStatus === 0 || shutdownStatus === 130 || shutdownStatus === 143)) {
    classification = "clean-restart";
    confidence = "high";
    shouldPersist = false;
    evidence = [`last-event:${lastEvent?.event ?? "shutdown-complete"}`];
  } else if (
    lastEvent?.event === "duplicate-check-complete" ||
    lastEvent?.event === "duplicate-check-live"
  ) {
    classification = "duplicate-workflow-noop";
    confidence = "high";
    shouldPersist = false;
    evidence = [`last-event:${lastEvent.event}`];
  } else if (
    lastEvent?.event === "supervisor-handoff-complete" ||
    lastEvent?.event === "supervisor-handoff-requested"
  ) {
    classification = "controlled-handoff";
    confidence = "high";
    evidence = [`last-event:${lastEvent.event}`];
  } else if (
    // Boot-id mismatch must outrank the child-exit branches: when the whole VM
    // was replaced, any child-exit left in the tail (e.g. from an earlier
    // in-place reload) predates the replacement and is not the terminal cause.
    previous.boot?.bootId &&
    currentBoot?.bootId &&
    previous.boot.bootId !== currentBoot.bootId
  ) {
    classification = "container-replaced";
    confidence = "medium";
    evidence = [
      `previous-boot:${previous.boot.bootId}`,
      `current-boot:${currentBoot.bootId}`,
    ];
    if (currentReplit.dbToken?.issuedAt) {
      evidence.push(`replit-db-token-issued:${currentReplit.dbToken.issuedAt}`);
    }
    if (currentReplit.runtimeFiles?.pid1Flags?.mtimeIso) {
      evidence.push(`replit-pid1-flags-mtime:${currentReplit.runtimeFiles.pid1Flags.mtimeIso}`);
    }
  } else if (childExit?.childName === "API") {
    classification = "api-child-exit";
    confidence = "high";
    evidence = [
      `api-exit:code=${childExit.code ?? "null"} signal=${childExit.signal ?? "null"}`,
    ];
  } else if (childExit?.childName === "PYRUS web") {
    classification = "web-child-exit";
    confidence = "high";
    evidence = [
      `web-exit:code=${childExit.code ?? "null"} signal=${childExit.signal ?? "null"}`,
    ];
  } else if (pressure.length > 0) {
    classification = "suspected-resource-pressure";
    confidence = "medium";
    evidence = [...pressure];
  } else {
    classification = "same-container-supervisor-abrupt";
    confidence = "medium";
    evidence = [`last-event:${lastEvent?.event ?? "unknown"}`];
  }

  if (pressure.length > 0 && !evidence.some((entry) => pressure.includes(entry))) {
    evidence.push(...pressure);
  }

  return {
    incidentId: [
      previous.boot?.bootId ?? "unknown-boot",
      previous.supervisor?.pid ?? previous.pid ?? "unknown-pid",
      Date.parse(previous.updatedAt ?? previous.time ?? "") || Date.now(),
    ]
      .join(":")
      .replace(/[^a-zA-Z0-9:._-]/g, "_")
      .slice(0, 96),
    classification,
    confidence,
    shouldPersist,
    contributingReasons,
    severity: incidentSeverity(classification, contributingReasons),
    evidence,
    previousUpdatedAt: previous.updatedAt ?? previous.time ?? null,
    previousBoot: previous.boot ?? null,
    previousReplit: previous.replit ?? null,
    currentReplit,
    lastEvent,
  };
}

function readJsonlTail(filePath, limit = 200) {
  const raw = readText(filePath);
  if (!raw) return [];
  return raw
    .trim()
    .split("\n")
    .slice(-limit)
    .map(parseJsonLine)
    .filter(Boolean);
}

function messageForIncident(incident) {
  const label = String(incident.classification || "unknown").replaceAll("-", " ");
  return `Previous Replit/PYRUS run classified as ${label}.`;
}

export function createFlightRecorder(options) {
  const repoRoot = options.repoRoot;
  const env = options.env ?? process.env;
  const recorderDir =
    options.recorderDir ?? resolveFlightRecorderDir(repoRoot, env);
  const currentPath = path.join(recorderDir, "current.json");
  const incidentsPath = path.join(recorderDir, "incidents.jsonl");
  const processSamples = new Map();
  let lastEvent = null;

  function eventPath(iso = nowIso()) {
    return path.join(recorderDir, `events-${dateKey(iso)}.jsonl`);
  }

  function appendEvent(event, detail = {}) {
    try {
      const entry = {
        schemaVersion: SCHEMA_VERSION,
        time: nowIso(),
        event,
        pid: process.pid,
        ppid: process.ppid,
        ...detail,
      };
      appendJsonLine(eventPath(entry.time), entry);
      lastEvent = entry;
      return entry;
    } catch {
      return null;
    }
  }

  function readPreviousCurrent() {
    return safeReadJson(currentPath);
  }

  function recentEvents(previous) {
    const dates = new Set([dateKey(), dateKey(previous?.updatedAt ?? previous?.time ?? nowIso())]);
    return [...dates].flatMap((key) =>
      readJsonlTail(path.join(recorderDir, `events-${key}.jsonl`), 200),
    );
  }

  function writeCurrent(partial) {
    try {
      const updatedAt = nowIso();
      const state = {
        schemaVersion: SCHEMA_VERSION,
        updatedAt,
        boot: readContainerBoot(),
        env: sanitizeEnv(env),
        replit: readReplitRuntimeSnapshot(env),
        lastEvent,
        ...partial,
      };
      atomicWriteJson(currentPath, state);
      return state;
    } catch {
      return null;
    }
  }

  function sampleProcesses(pids) {
    const result = {};
    for (const [name, pid] of Object.entries(pids)) {
      const previous = processSamples.get(name);
      const sample = readProcessSample(pid, previous);
      if (sample) {
        processSamples.set(name, sample);
        result[name] = sample;
      }
    }
    return result;
  }

  function writeHeartbeat(detail = {}) {
    return writeCurrent({
      lifecycle: {
        phase: detail.phase ?? null,
        status: detail.status ?? null,
      },
      supervisor: {
        pid: process.pid,
        ppid: process.ppid,
        lockPath: detail.lockPath ?? null,
        lockAcquired: Boolean(detail.lockAcquired),
      },
      children: detail.children ?? [],
      cgroup: readCgroupSnapshot(),
      processes: sampleProcesses({
        supervisor: process.pid,
        api: detail.apiPid,
        web: detail.webPid,
      }),
      apiHealth: detail.apiHealth ?? null,
      apiPressure: detail.apiPressure ?? null,
      apiRuntime: detail.apiRuntime ?? null,
      lastEvent,
    });
  }

  function previousSupervisorStillLive(previous) {
    const pid = safeNumber(previous?.supervisor?.pid ?? previous?.lastEvent?.pid);
    if (!pid || pid <= 0 || pid === process.pid) return false;
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return cmdline.includes("runDevApp.mjs");
    } catch {
      return false;
    }
  }

  function classifyAndPersistPreviousRun() {
    try {
      const previous = readPreviousCurrent();
      // A duplicate/probe launch classifying a supervisor that is STILL ALIVE
      // is not an incident: persisting here manufactured phantom
      // same-container-supervisor-abrupt entries for healthy running apps
      // (lastEvent=heartbeat, same boot) every time a second launch started.
      if (previousSupervisorStillLive(previous)) {
        return {
          classification: "previous-supervisor-live",
          confidence: "high",
          shouldPersist: false,
          contributingReasons: [],
          evidence: [
            `live-supervisor-pid:${previous?.supervisor?.pid ?? previous?.lastEvent?.pid}`,
          ],
        };
      }
      const incident = classifyPreviousRun(
        previous,
        recentEvents(previous),
        readContainerBoot(),
        readReplitRuntimeSnapshot(env),
      );
      if (incident.shouldPersist) {
        const persisted = {
          schemaVersion: SCHEMA_VERSION,
          observedAt: nowIso(),
          message: messageForIncident(incident),
          ...incident,
        };
        appendJsonLine(incidentsPath, persisted);
        return persisted;
      }
      return incident;
    } catch (error) {
      appendEvent("previous-run-classification-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        classification: "unknown-external-replit-restart",
        confidence: "low",
        shouldPersist: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function prune() {
    try {
      if (!existsSync(recorderDir)) return;
      const now = Date.now();
      const eventCutoff = now - DEFAULT_RETENTION_EVENTS_DAYS * 24 * 60 * 60 * 1000;
      for (const file of readdirSync(recorderDir)) {
        const match = file.match(/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!match) continue;
        if (Date.parse(`${match[1]}T00:00:00.000Z`) < eventCutoff) {
          rmSync(path.join(recorderDir, file), { force: true });
        }
      }

      const incidents = readJsonlTail(incidentsPath, 10_000).filter((entry) => {
        const observedAt = Date.parse(String(entry.observedAt ?? ""));
        return (
          !Number.isFinite(observedAt) ||
          observedAt >= now - DEFAULT_RETENTION_INCIDENTS_DAYS * 24 * 60 * 60 * 1000
        );
      });
      if (incidents.length > 0 || existsSync(incidentsPath)) {
        const tmpPath = `${incidentsPath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(
          tmpPath,
          incidents.map((entry) => JSON.stringify(entry)).join("\n") +
            (incidents.length ? "\n" : ""),
          { mode: 0o600 },
        );
        renameSync(tmpPath, incidentsPath);
      }
    } catch {
      // Retention cleanup must not interfere with startup.
    }
  }

  return {
    recorderDir,
    currentPath,
    incidentsPath,
    appendEvent,
    classifyAndPersistPreviousRun,
    prune,
    readPreviousCurrent,
    writeCurrent,
    writeHeartbeat,
  };
}
