#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFlightRecorder } from "./flightRecorder.mjs";
import {
  RESTORE_COMMAND,
  detectReplitConfigClobber,
} from "../../../scripts/replit-config-clobber.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const apiPort = process.env.PYRUS_API_PORT || "8080";
const webPort =
  process.env.PYRUS_FRONTEND_PORT ||
  process.env.PORT ||
  "18747";
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/healthz`;
const apiPortHex = Number(apiPort).toString(16).toUpperCase().padStart(4, "0");
const supervisorLockDir = process.env.PYRUS_DEV_LOCK_DIR || "/tmp/pyrus";
const supervisorLockPath = path.join(
  supervisorLockDir,
  `pyrus-dev-supervisor-${apiPort}.lock`,
);
const lifecycleLogPath = path.join(
  supervisorLockDir,
  `pyrus-dev-lifecycle-${apiPort}.jsonl`,
);
const flightRecorder = createFlightRecorder({ repoRoot });
const supervisorLockWaitMs = Number(process.env.PYRUS_DEV_LOCK_WAIT_MS || "8000");
const supervisorTakeoverGraceMs = Number(
  process.env.PYRUS_DEV_TAKEOVER_GRACE_MS || "20000",
);
const MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS = 5_000;
const API_NODE_MAX_OLD_SPACE_MB = "2560";
const WEB_NODE_MAX_OLD_SPACE_MB = "1536";
// PYRUS_REPLIT_RUN is a tag set by dev:replit. It is not authority to
// replace a live supervisor because any shell can set it by running that
// package script. Only Replit's workflow env may request handoff/reaping.
const runningInsideReplitWorkflow = process.env.REPLIT_MODE === "workflow";
const forceSupervisorTakeover = process.env.PYRUS_DEV_FORCE_RESTART === "1";
const duplicateCheckOnly = process.env.PYRUS_DEV_DUPLICATE_CHECK_ONLY === "1";

let shuttingDown = false;
let supervisorLockAcquired = false;
let lifecycleHeartbeatTimer = null;
let lifecyclePhase = "initializing";
let apiChild = null;
let webChild = null;
let workerChild = null;
// In-place API reload (agent-driven, SIGUSR2): rebuild + restart the API child
// WITHOUT tearing down the supervisor, so the Replit preview (anchored to this
// supervisor process) and the web dev server stay attached and just reflect the
// new backend. `reloadInProgress` makes the fatal-exit watcher ignore the
// intentional API exit during a reload; `resolveFatalExit` is the running-phase
// teardown trigger that real (unexpected) child crashes still fire.
let reloadInProgress = false;
let resolveFatalExit = null;
const children = new Set();

function writeLifecycleEvent(event, detail = {}) {
  const payload = {
    time: new Date().toISOString(),
    event,
    pid: process.pid,
    ppid: process.ppid,
    apiPort,
    webPort,
    replitMode: process.env.REPLIT_MODE || null,
    pyrusReplitRun: process.env.PYRUS_REPLIT_RUN || null,
    lockPath: supervisorLockPath,
    ...detail,
  };
  try {
    mkdirSync(supervisorLockDir, { recursive: true });
    appendFileSync(
      lifecycleLogPath,
      `${JSON.stringify(payload)}\n`,
      "utf8",
    );
  } catch {
    // Lifecycle evidence must never block app startup or shutdown.
  }
  flightRecorder.appendEvent(event, payload);
}

function readPreviousLifecycleState() {
  try {
    const lines = readFileSync(lifecycleLogPath, "utf8")
      .trim()
      .split("\n")
      .slice(-200)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const supervisorLines = lines.filter(
      (entry) =>
        ![
          "duplicate-check-start",
          "duplicate-check-complete",
          "launch-start",
        ].includes(String(entry.event || "")),
    );
    const lastHeartbeat = [...supervisorLines]
      .reverse()
      .find((entry) => entry.event === "heartbeat");
    const lastEvent = supervisorLines.at(-1) || null;
    if (!lastEvent) {
      return { classification: "none" };
    }
    if (lastEvent.event === "supervisor-shutdown-complete") {
      return { classification: "clean", lastEvent };
    }
    if (isLiveSupervisorPid(Number(lastEvent.pid))) {
      return { classification: "live", lastEvent, lastHeartbeat };
    }
    return {
      classification: lastHeartbeat ? "abrupt-or-external" : "unknown",
      lastEvent,
      lastHeartbeat,
    };
  } catch {
    return { classification: "unavailable" };
  }
}

function currentChildrenSnapshot() {
  return [...children].map((child) => ({
    pid: child.pid || null,
    killed: Boolean(child.killed),
    rssMb: processRssMb(child.pid),
  }));
}

const PROC_PAGE_SIZE_BYTES = 4096;

function processRssMb(pid) {
  if (!pid) return null;
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, "utf8").split(" ");
    const rssPages = Number(statm[1]);
    if (!Number.isFinite(rssPages)) return null;
    return Math.round((rssPages * PROC_PAGE_SIZE_BYTES) / 1024 / 1024);
  } catch {
    return null;
  }
}

// System-wide memory (all processes, not just ours), surfaced in the heartbeat
// trail + get_supervisor_state. NOTE: the 2026-07-03 "container replacement under
// memory pressure" this was added for was later shown to be a fixed ~6h infra
// microVM recycle, not a memory kill (oom_kill=0, ~5.6/16GB peak) — so this is
// telemetry, useful for attributing a *future* eviction vs an infra recycle, not
// evidence the box runs out of memory. See the 2026-07 supervisor-wiring audit.
function systemMemorySnapshotMb() {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const readKb = (key) => {
      const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"));
      return match ? Math.round(Number(match[1]) / 1024) : null;
    };
    return {
      totalMb: readKb("MemTotal"),
      availableMb: readKb("MemAvailable"),
      freeMb: readKb("MemFree"),
    };
  } catch {
    return null;
  }
}

function currentFlightHeartbeat(extra = {}) {
  return {
    phase: lifecyclePhase,
    lockAcquired: supervisorLockAcquired,
    apiPid: apiChild?.pid ?? null,
    webPid: webChild?.pid ?? null,
    workerPid: workerChild?.pid ?? null,
    children: currentChildrenSnapshot(),
    supervisorRssMb: processRssMb(process.pid),
    systemMemoryMb: systemMemorySnapshotMb(),
    ...extra,
  };
}

function nonEmptyEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function nodeOptionsWithMaxOldSpace(maxOldSpaceMb) {
  const existing = (process.env.NODE_OPTIONS || "").trim();
  if (/(^|\s)--max-old-space-size(?:=|\s|$)/.test(existing)) {
    return existing;
  }
  return [existing, `--max-old-space-size=${maxOldSpaceMb}`]
    .filter(Boolean)
    .join(" ");
}

function defaultDevMallocArenaMax() {
  return process.env.MALLOC_ARENA_MAX || "2";
}

function apiServiceEnv() {
  return {
    PORT: apiPort,
    PYRUS_DB_PROFILE: "api",
    LOG_LEVEL: process.env.LOG_LEVEL || "warn",
    MALLOC_ARENA_MAX: defaultDevMallocArenaMax(),
    NODE_OPTIONS: nodeOptionsWithMaxOldSpace(API_NODE_MAX_OLD_SPACE_MB),
  };
}

function webServiceEnv() {
  return {
    PORT: webPort,
    BASE_PATH: process.env.BASE_PATH || "/",
    MALLOC_ARENA_MAX: defaultDevMallocArenaMax(),
    NODE_OPTIONS: nodeOptionsWithMaxOldSpace(WEB_NODE_MAX_OLD_SPACE_MB),
    VITE_PROXY_API_TARGET:
      process.env.VITE_PROXY_API_TARGET || `http://127.0.0.1:${apiPort}`,
  };
}

function hasMarketDataWorkerDatabaseConfig() {
  return Boolean(
    nonEmptyEnv("DATABASE_URL") ||
      nonEmptyEnv("LOCAL_DATABASE_URL") ||
      (nonEmptyEnv("PGHOST") && nonEmptyEnv("PGDATABASE") && nonEmptyEnv("PGUSER")),
  );
}

function hasMarketDataWorkerProviderConfig() {
  return Boolean(
    nonEmptyEnv("MASSIVE_API_KEY") ||
      nonEmptyEnv("MASSIVE_MARKET_DATA_API_KEY"),
  );
}

function resolveMarketDataWorkerStartup() {
  const skippedReasons = [];
  if (!hasMarketDataWorkerDatabaseConfig()) {
    skippedReasons.push("database_unconfigured");
  }
  if (!hasMarketDataWorkerProviderConfig()) {
    skippedReasons.push("massive_provider_unconfigured");
  }
  return {
    start: skippedReasons.length === 0,
    skippedReasons,
  };
}

function marketDataWorkerEnv() {
  return {
    LOG_LEVEL: process.env.LOG_LEVEL || "warn",
    RUST_LOG: process.env.RUST_LOG || "market_data_worker=info,info",
    // Rust worker serializes ingest + retention on one connection.
    MARKET_DATA_WORKER_DB_POOL_MAX:
      process.env.MARKET_DATA_WORKER_DB_POOL_MAX || "1",
    ...(nonEmptyEnv("DATABASE_URL") || !nonEmptyEnv("LOCAL_DATABASE_URL")
      ? {}
      : { DATABASE_URL: process.env.LOCAL_DATABASE_URL }),
  };
}

function startLifecycleHeartbeat() {
  if (lifecycleHeartbeatTimer) return;
  lifecycleHeartbeatTimer = setInterval(() => {
    const heartbeat = currentFlightHeartbeat();
    writeLifecycleEvent("heartbeat", heartbeat);
    flightRecorder.writeHeartbeat(heartbeat);
  }, 5_000);
  lifecycleHeartbeatTimer.unref?.();
}

function stopLifecycleHeartbeat() {
  if (!lifecycleHeartbeatTimer) return;
  clearInterval(lifecycleHeartbeatTimer);
  lifecycleHeartbeatTimer = null;
}

function readDevEnvLocal() {
  // Optional per-container env overrides (KEY=VALUE lines, # comments).
  // Re-read on every spawn so a SIGUSR2 in-place reload picks up flag flips
  // (e.g. SIGNAL_OPTIONS_TALLY) without the full workflow restart that
  // Replit secrets changes require.
  try {
    const out = {};
    const text = readFileSync(
      path.join(repoRoot, ".pyrus-runtime", "dev-env.local"),
      "utf8",
    );
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

function spawnService(name, args, env) {
  console.log(`[pyrus-dev] starting ${name}: pnpm ${args.join(" ")}`);
  const child = spawn("pnpm", args, {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, ...readDevEnvLocal(), ...env },
    stdio: "inherit",
  });
  children.add(child);
  writeLifecycleEvent("child-start", {
    childName: name,
    childPid: child.pid || null,
    args,
  });
  child.once("exit", (code, signal) => {
    writeLifecycleEvent("child-exit", {
      childName: name,
      childPid: child.pid || null,
      code,
      signal,
      // Intentional kills (SIGUSR2 in-place reload, shutdown teardown) are
      // marked so the next launch's classifier never reads a stale reload
      // exit as the run's terminal cause (phantom api-child-exit incidents).
      expected: reloadInProgress || shuttingDown || undefined,
    });
    children.delete(child);
  });
  return child;
}

function exitPromise(name, child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ name, code, signal });
    });
  });
}

function killChild(child, signal) {
  if (!child.pid || child.killed) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Ignore already-exited children.
    }
  }
}

function readProcessCommand(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replaceAll("\0", " ")
      .trim();
  } catch {
    return "";
  }
}

function readProcessCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readSupervisorLock() {
  try {
    const raw = readFileSync(supervisorLockPath, "utf8");
    try {
      return { state: "valid", lock: JSON.parse(raw), raw };
    } catch {
      return { state: "invalid", lock: null, raw };
    }
  } catch (error) {
    return {
      state: error?.code === "ENOENT" ? "missing" : "invalid",
      lock: null,
      raw: null,
    };
  }
}

function isLiveSupervisorPid(pid) {
  return pidIsAlive(pid) && readProcessCommand(pid).includes("runDevApp.mjs");
}

function unlinkSupervisorLockForPid(pid) {
  const lockState = readSupervisorLock();
  if (lockState.state === "valid" && Number(lockState.lock?.pid) === pid) {
    unlinkSupervisorLockState(lockState);
  }
}

function unlinkSupervisorLockState(lockState) {
  try {
    const currentLockState = readSupervisorLock();
    if (lockState.raw !== null && currentLockState.raw !== lockState.raw) {
      return;
    }
    if (lockState.raw === null && currentLockState.state === "valid") {
      return;
    }
    unlinkSync(supervisorLockPath);
  } catch {
    // Another process may have removed it first.
  }
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    writeLifecycleEvent("signal-sent", { targetPid: pid, signal });
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    console.warn(
      `[pyrus-dev] failed to send ${signal} to supervisor PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function supervisorLockAgeMs(lock) {
  const startedAt = Date.parse(typeof lock?.startedAt === "string" ? lock.startedAt : "");
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Date.now() - startedAt);
}

function formatDurationMs(value) {
  if (!Number.isFinite(value)) return "unknown age";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${Math.round(value / 1000)}s`;
}

// Tenths-of-a-second formatter for launch/reload metrics, where sub-second
// resolution actually matters (formatDurationMs rounds to whole seconds and is
// reused by the supervisor-age messages, so it stays as-is).
function formatLaunchMs(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function checkDuplicateReplitStartOnly() {
  const lockState = readSupervisorLock();
  if (lockState.state !== "valid") {
    console.warn(
      `[pyrus-dev] duplicate-check-only found no valid PYRUS dev supervisor lock at ${supervisorLockPath}; exiting without starting API/web processes.`,
    );
    return false;
  }

  const ownerPid = Number(lockState.lock?.pid);
  if (!Number.isInteger(ownerPid) || ownerPid <= 0 || !isLiveSupervisorPid(ownerPid)) {
    console.warn(
      `[pyrus-dev] duplicate-check-only found no live PYRUS dev supervisor for lock owner ${Number.isInteger(ownerPid) ? ownerPid : "unknown"}; exiting without starting API/web processes.`,
    );
    return false;
  }

  if (runningInsideReplitWorkflow && !forceSupervisorTakeover) {
    const ageMs = supervisorLockAgeMs(lockState.lock);
    console.warn(
      `[pyrus-dev] duplicate-check-only found live PYRUS dev supervisor ${ownerPid}${ageMs === null ? "" : ` for ${formatDurationMs(ageMs)}`}; a real Replit workflow start would request controlled handoff.`,
    );
    writeLifecycleEvent("duplicate-check-live", { ownerPid, ageMs });
    return true;
  }

  console.warn(
    `[pyrus-dev] duplicate-check-only found live PYRUS dev supervisor ${ownerPid}, but this launch is not a Replit workflow; exiting without starting API/web processes.`,
  );
  return false;
}

function removeSupervisorLock() {
  if (!supervisorLockAcquired) return;
  unlinkSupervisorLockForPid(process.pid);
  supervisorLockAcquired = false;
}

async function waitForSupervisorToExit(pid, timeoutMs) {
  const waitMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 20_000;
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    if (!isLiveSupervisorPid(pid)) {
      unlinkSupervisorLockForPid(pid);
      return true;
    }
    await delay(500);
  }

  return !isLiveSupervisorPid(pid);
}

async function requestSupervisorHandoff(ownerPid, { requestMessage = null } = {}) {
  const graceMs =
    Number.isFinite(supervisorTakeoverGraceMs) && supervisorTakeoverGraceMs >= 0
      ? supervisorTakeoverGraceMs
      : 20_000;

  console.warn(
    requestMessage ||
      `[pyrus-dev] another PYRUS dev supervisor is already running as PID ${ownerPid}; requesting controlled handoff so this Replit workflow owns the app without overlapping API/web processes.`,
  );
  writeLifecycleEvent("supervisor-handoff-requested", { ownerPid });

  if (!sendSignal(ownerPid, "SIGTERM")) {
    throw new Error(`Could not signal previous PYRUS dev supervisor ${ownerPid}.`);
  }

  if (await waitForSupervisorToExit(ownerPid, graceMs)) {
    console.warn(
      `[pyrus-dev] previous PYRUS dev supervisor ${ownerPid} stopped; continuing startup in this workflow.`,
    );
    writeLifecycleEvent("supervisor-handoff-complete", { ownerPid });
    return;
  }

  console.warn(
    `[pyrus-dev] previous PYRUS dev supervisor ${ownerPid} did not stop after ${graceMs}ms; sending SIGKILL before this workflow starts replacement processes.`,
  );
  if (!sendSignal(ownerPid, "SIGKILL")) {
    throw new Error(`Could not kill previous PYRUS dev supervisor ${ownerPid}.`);
  }

  if (!(await waitForSupervisorToExit(ownerPid, 3_000))) {
    throw new Error(
      `Previous PYRUS dev supervisor ${ownerPid} did not exit; refusing to start overlapping API/web processes.`,
    );
  }
}

async function acquireSupervisorLock() {
  const waitMs =
    Number.isFinite(supervisorLockWaitMs) && supervisorLockWaitMs >= 0
      ? supervisorLockWaitMs
      : 8000;
  const deadline = Date.now() + waitMs;

  while (true) {
    try {
      mkdirSync(supervisorLockDir, { recursive: true });
      writeFileSync(
        supervisorLockPath,
        `${JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          apiPort,
          webPort,
        })}\n`,
        { flag: "wx", mode: 0o600 },
      );
      supervisorLockAcquired = true;
      writeLifecycleEvent("lock-acquired");
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    const lockState = readSupervisorLock();
    if (lockState.state === "missing") {
      continue;
    }
    if (lockState.state === "invalid") {
      unlinkSupervisorLockState(lockState);
      continue;
    }

    const ownerPid = Number(lockState.lock?.pid);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
      unlinkSupervisorLockState(lockState);
      continue;
    }
    if (!isLiveSupervisorPid(ownerPid)) {
      unlinkSupervisorLockForPid(ownerPid);
      continue;
    }

    if (runningInsideReplitWorkflow && !forceSupervisorTakeover) {
      const ageMs = supervisorLockAgeMs(lockState.lock);
      writeLifecycleEvent("duplicate-start-handoff", { ownerPid, ageMs });
      await requestSupervisorHandoff(ownerPid, {
        requestMessage: `[pyrus-dev] Replit workflow start found PYRUS dev supervisor ${ownerPid} already alive${ageMs === null ? "" : ` for ${formatDurationMs(ageMs)}`}; treating this as an intentional Run-button restart and requesting controlled handoff to this workflow without overlapping API/web processes.`,
      });
      continue;
    }

    if (Date.now() >= deadline) {
      if (runningInsideReplitWorkflow) {
        await requestSupervisorHandoff(ownerPid);
        continue;
      }

      console.error(
        `[pyrus-dev] another PYRUS dev supervisor is already running as PID ${ownerPid}; refusing to start a shell-launched duplicate because it could cause an overlapping workflow restart cascade. Use the default Replit Run workflow to replace the live app.`,
      );
      return false;
    }

    await delay(500);
  }
}

function inodesListeningOnPortHex(portHex) {
  const inodes = new Set();
  let inspected = false;

  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = readFileSync(file, "utf8");
      inspected = true;
    } catch {
      continue;
    }

    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const localAddr = parts[1];
      const state = parts[3];
      const inode = parts[9];
      if (state === "0A" && localAddr?.endsWith(`:${portHex}`)) {
        inodes.add(inode);
      }
    }
  }

  return inspected ? inodes : null;
}

function pidsHoldingInodes(inodes) {
  const pids = new Set();
  if (!inodes || inodes.size === 0) return pids;

  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;

    let fdEntries;
    try {
      fdEntries = readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }

    for (const fd of fdEntries) {
      let target;
      try {
        target = readlinkSync(`/proc/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = target.match(/^socket:\[(\d+)\]$/);
      if (match && inodes.has(match[1])) {
        pids.add(Number(entry));
        break;
      }
    }
  }

  return pids;
}

function processGroupId(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return Number(fields[2]);
  } catch {
    return null;
  }
}

function pathIsInRepo(candidatePath) {
  return (
    candidatePath === repoRoot ||
    candidatePath.startsWith(`${repoRoot}${path.sep}`)
  );
}

function isMarketDataWorkerCommand(command) {
  return (
    command.includes("pnpm run market-data-worker:run") ||
    command.includes("scripts/run-market-data-worker.mjs run -p market-data-worker -- run") ||
    command.includes("cargo run -p market-data-worker -- run") ||
    command.includes("target/debug/market-data-worker run")
  );
}

function staleMarketDataWorkerGroups() {
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }

  const currentPgid = processGroupId(process.pid);
  const groups = new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;

    const command = readProcessCommand(pid);
    if (!isMarketDataWorkerCommand(command)) continue;
    if (!pathIsInRepo(readProcessCwd(pid))) continue;

    const pgid = processGroupId(pid);
    if (!Number.isInteger(pgid) || pgid <= 0 || pgid === currentPgid) {
      continue;
    }

    const group = groups.get(pgid) || { pgid, pids: [], commands: [] };
    group.pids.push(pid);
    group.commands.push(command);
    groups.set(pgid, group);
  }
  return [...groups.values()];
}

function signalProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

async function reapStaleMarketDataWorkers() {
  if (!runningInsideReplitWorkflow && !forceSupervisorTakeover) {
    return;
  }

  const groups = staleMarketDataWorkerGroups();
  if (groups.length === 0) return;

  const detail = groups.map((group) => ({
    pgid: group.pgid,
    pids: group.pids,
  }));
  console.warn(
    `[pyrus-dev] reaping ${groups.length} stale market-data worker process group${groups.length === 1 ? "" : "s"} before starting this workflow's worker: ${detail
      .map((group) => `${group.pgid}[${group.pids.join(",")}]`)
      .join(" ")}`,
  );
  writeLifecycleEvent("stale-market-data-worker-reap-start", { groups: detail });

  for (const group of groups) signalProcessGroup(group.pgid, "SIGTERM");
  await delay(MARKET_DATA_WORKER_SHUTDOWN_GRACE_MS);

  const stillAlive = staleMarketDataWorkerGroups().filter((group) =>
    groups.some((candidate) => candidate.pgid === group.pgid),
  );
  for (const group of stillAlive) signalProcessGroup(group.pgid, "SIGKILL");

  writeLifecycleEvent("stale-market-data-worker-reap-complete", {
    groups: detail,
    killedGroups: stillAlive.map((group) => group.pgid),
  });
}

function apiPortOwnerStatus(apiRootPid) {
  // Replit may briefly overlap workflow executions; only accept health from
  // the API process group spawned by this supervisor.
  const inodes = inodesListeningOnPortHex(apiPortHex);
  if (inodes === null) {
    return { owned: true, detail: "port ownership unavailable" };
  }
  if (inodes.size === 0) {
    return { owned: false, detail: `no listener on ${apiPort}` };
  }

  const pids = pidsHoldingInodes(inodes);
  if (pids === null) {
    return { owned: true, detail: "port owner lookup unavailable" };
  }
  if (pids.size === 0) {
    return { owned: false, detail: `no owning pid found for ${apiPort}` };
  }

  const owners = [...pids].map((pid) => ({
    pid,
    processGroupId: processGroupId(pid),
  }));
  const currentOwner = owners.find((owner) => owner.processGroupId === apiRootPid);
  if (currentOwner) {
    return { owned: true, detail: `pid ${currentOwner.pid}` };
  }

  return {
    owned: false,
    detail: `listener owned by ${owners
      .map((owner) => `${owner.pid}/pgid=${owner.processGroupId ?? "unknown"}`)
      .join(", ")}`,
  };
}

async function shutdown(status = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  lifecyclePhase = "shutdown-start";
  writeLifecycleEvent("supervisor-shutdown-start", { status });
  flightRecorder.writeHeartbeat(currentFlightHeartbeat({ status }));
  for (const child of children) killChild(child, "SIGTERM");
  await delay(1500);
  for (const child of children) killChild(child, "SIGKILL");
  stopLifecycleHeartbeat();
  removeSupervisorLock();
  lifecyclePhase = "shutdown-complete";
  writeLifecycleEvent("supervisor-shutdown-complete", { status });
  flightRecorder.writeHeartbeat(currentFlightHeartbeat({ status, children: [] }));
  process.exit(status);
}

function ignoreWorkflowHangup() {
  try {
    writeLifecycleEvent("signal-ignored", { signal: "SIGHUP" });
    console.warn(
      "[pyrus-dev] ignoring SIGHUP from the workflow console so the Replit-owned API/web supervisor stays attached; use Stop/SIGTERM for an intentional shutdown.",
    );
  } catch {
    // Ignore logging failures if the console stream is already gone.
  }
}

async function waitForApi(childExit, apiRootPid) {
  const deadline = Date.now() + 90_000;
  let lastError = "not ready";

  while (Date.now() < deadline) {
    const exited = await Promise.race([
      childExit.then((result) => ({ type: "exit", result })),
      fetch(apiHealthUrl, { signal: AbortSignal.timeout(1500) })
        .then((res) => ({ type: "health", ok: res.ok, status: res.status }))
        .catch((error) => ({ type: "health-error", error })),
    ]);

    if (exited.type === "exit") {
      throw new Error(
        `API exited before becoming healthy: code=${exited.result.code ?? "null"} signal=${exited.result.signal ?? "null"}`,
      );
    }

    if (exited.type === "health" && exited.ok) {
      const ownerStatus = apiPortOwnerStatus(apiRootPid);
      if (ownerStatus.owned) {
        console.log(`[pyrus-dev] API healthy at ${apiHealthUrl}`);
        return;
      }
      lastError = `healthy response came from a previous API process (${ownerStatus.detail})`;
      await delay(500);
      continue;
    }

    lastError =
      exited.type === "health"
        ? `status ${exited.status}`
        : exited.error instanceof Error
          ? exited.error.message
          : String(exited.error);
    await delay(500);
  }

  throw new Error(`API did not become healthy at ${apiHealthUrl}: ${lastError}`);
}

// Non-blocking observability probe: resolves with ms-from-launch the first time
// the web (vite) dev server answers an HTTP request, or null if it never does
// within the window. This NEVER gates startup — web readiness is intentionally
// not on the startup blocking path; the probe only lets the launch summary attribute
// where the seconds went from the supervisor's point of view.
async function probeWebReady(startedAt) {
  const url = `http://127.0.0.1:${webPort}/`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (shuttingDown) return null;
    try {
      await fetch(url, { signal: AbortSignal.timeout(1500) });
      return Date.now() - startedAt;
    } catch {
      // Listener not up yet (or request aborted); keep polling.
    }
    await delay(500);
  }
  return null;
}

// Running-phase supervision: a child exit resolves `resolveFatalExit` (→ teardown)
// so real crashes still surface — EXCEPT an intentional in-place API reload, which
// `reloadInProgress` masks so the supervisor and the attached preview survive.
function watchFatalExit(name, exitP, { reloadable = false } = {}) {
  exitP.then((result) => {
    if (shuttingDown) return;
    if (reloadable && reloadInProgress) return;
    if (resolveFatalExit) resolveFatalExit({ name, ...result });
  });
}

// Agent-driven backend reload (SIGUSR2): rebuild + restart ONLY the API child in
// place. The supervisor never exits, so the Replit preview (anchored to this
// process) and the web dev server stay attached and just reflect the new bundle.
async function reloadApiInPlace() {
  if (shuttingDown) return;
  if (reloadInProgress) {
    console.warn("[pyrus-dev] SIGUSR2 ignored: an API reload is already in progress");
    return;
  }
  if (!apiChild) {
    console.warn("[pyrus-dev] SIGUSR2 ignored: no API child to reload");
    return;
  }
  reloadInProgress = true;
  const reloadStartedAt = Date.now();
  lifecyclePhase = "api-reloading";
  writeLifecycleEvent("api-reload-start", { childPid: apiChild.pid || null });
  console.log(
    "[pyrus-dev] SIGUSR2: reloading API in place (rebuild + restart); supervisor + web preview stay attached",
  );
  try {
    const old = apiChild;
    const oldExit = exitPromise("API", old);
    killChild(old, "SIGTERM");
    const stopped = await Promise.race([
      oldExit.then(() => true),
      delay(supervisorTakeoverGraceMs).then(() => false),
    ]);
    if (!stopped) {
      killChild(old, "SIGKILL");
      await delay(1000);
    }
    const api = spawnService(
      "API",
      ["--filter", "@workspace/api-server", "run", "dev"],
      apiServiceEnv(),
    );
    apiChild = api;
    const apiExit = exitPromise("API", api);
    watchFatalExit("API", apiExit, { reloadable: true });
    await waitForApi(apiExit, api.pid);
    lifecyclePhase = "running";
    const reloadMs = Date.now() - reloadStartedAt;
    writeLifecycleEvent("api-reload-complete", {
      childPid: api.pid || null,
      durationMs: reloadMs,
    });
    flightRecorder.writeHeartbeat(currentFlightHeartbeat());
    console.log(
      `[pyrus-dev] API reload complete and healthy in ${formatLaunchMs(reloadMs)}; preview now reflects the new code`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLifecycleEvent("api-reload-failed", { message });
    console.error(`[pyrus-dev] API reload failed: ${message}`);
    reloadInProgress = false;
    await shutdown(1);
    return;
  }
  reloadInProgress = false;
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.on("SIGUSR2", () => void reloadApiInPlace());
process.on("SIGHUP", ignoreWorkflowHangup);
process.once("exit", removeSupervisorLock);

try {
  flightRecorder.prune();
  const previousFlightIncident = flightRecorder.classifyAndPersistPreviousRun();
  writeLifecycleEvent("previous-run-classified", {
    incident: previousFlightIncident,
  });

  if (duplicateCheckOnly) {
    writeLifecycleEvent("duplicate-check-start", {
      previous: readPreviousLifecycleState(),
      forceSupervisorTakeover,
      runningInsideReplitWorkflow,
    });
    const ok = checkDuplicateReplitStartOnly();
    writeLifecycleEvent("duplicate-check-complete", { ok });
    process.exit(ok ? 0 : 2);
  }

  const previousLifecycleState = readPreviousLifecycleState();
  writeLifecycleEvent("launch-start", {
    previous: previousLifecycleState,
    forceSupervisorTakeover,
    runningInsideReplitWorkflow,
  });

  // Recovery-clobber detection (warn only — NEVER auto-write .replit or
  // replit.nix from the supervisor: a save of either file triggers a full
  // workspace reload). Replit's platform "Post-Recovery checkpoint" flow can
  // rewrite .replit from control-plane state and delete replit.nix, which
  // bricks shells and detaches the Run button from the PYRUS workflow.
  try {
    const clobberProblems = detectReplitConfigClobber(repoRoot);
    if (clobberProblems.length > 0) {
      const banner = [
        "".padEnd(76, "!"),
        "[pyrus-dev] REPLIT STARTUP CONFIG CLOBBER DETECTED (recovery-checkpoint signature):",
        ...clobberProblems.map((problem) => `[pyrus-dev]   - ${problem}`),
        `[pyrus-dev] Restore the checked-in canonical config with: ${RESTORE_COMMAND}`,
        "[pyrus-dev] (diff first with: pnpm run replit:config:restore) — the restore write triggers ONE workspace reload.",
        "".padEnd(76, "!"),
      ].join("\n");
      console.error(banner);
      writeLifecycleEvent("replit-config-clobber-detected", {
        problems: clobberProblems,
        restoreCommand: RESTORE_COMMAND,
      });
    }
  } catch (error) {
    console.warn(
      `[pyrus-dev] replit-config clobber detection unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const lockAcquired = await acquireSupervisorLock();
  if (!lockAcquired) {
    writeLifecycleEvent("lock-refused-exit");
    stopLifecycleHeartbeat();
    process.exit(1);
  }
  writeLifecycleEvent("supervisor-start", {
    previous: previousLifecycleState,
    forceSupervisorTakeover,
    runningInsideReplitWorkflow,
  });
  startLifecycleHeartbeat();
  flightRecorder.writeHeartbeat(currentFlightHeartbeat());

  // Phase-duration instrumentation: measured from the moment this supervisor owns
  // the lock and begins spawning services, so the numbers reflect launch cost (not
  // time spent waiting to hand off a previous supervisor).
  const launchStartedAt = Date.now();
  let apiHealthyMs = null;
  let workerStartedMs = null;
  let webReadyMs = null;

  lifecyclePhase = "api-starting";
  const api = spawnService(
    "API",
    ["--filter", "@workspace/api-server", "run", "dev"],
    apiServiceEnv(),
  );
  apiChild = api;
  flightRecorder.writeHeartbeat(currentFlightHeartbeat());
  const apiExit = exitPromise("API", api);

  // Start the web (vite) dev server in parallel with API boot. First paint is
  // fully client-rendered and API-independent (static boot shell + LogoLoader),
  // and the /api proxy tolerates the API being briefly unavailable during boot,
  // so overlapping vite startup (incl. cold optimizeDeps prebundle) with the
  // API health gate puts the browser preview in front of the user sooner.
  lifecyclePhase = "web-starting";
  const web = spawnService(
    "PYRUS web",
    ["--filter", "@workspace/pyrus", "run", "dev:web"],
    webServiceEnv(),
  );
  webChild = web;
  const webExit = exitPromise("PYRUS web", web);
  writeLifecycleEvent("web-started", {
    childPid: web.pid || null,
    sinceLaunchMs: Date.now() - launchStartedAt,
  });
  flightRecorder.writeHeartbeat(currentFlightHeartbeat());

  // Observe (without gating) when vite first serves, so the launch summary can
  // attribute web readiness from the supervisor's point of view.
  probeWebReady(launchStartedAt)
    .then((ms) => {
      if (ms === null) return;
      webReadyMs = ms;
      console.log(
        `[pyrus-dev] web dev server ready in ${formatLaunchMs(ms)} (from launch)`,
      );
      writeLifecycleEvent("web-ready", { durationMs: ms });
    })
    .catch(() => {});

  // Wait for the API to become healthy, but fail fast if the web child dies
  // during the boot window — exitWatchers below is not assembled until after the
  // gate, so an early web crash must be covered here explicitly.
  const apiHealthGate = await Promise.race([
    waitForApi(apiExit, api.pid).then(() => ({ type: "api-healthy" })),
    webExit.then((result) => ({ type: "web-early-exit", result })),
  ]);
  if (apiHealthGate.type === "web-early-exit") {
    const { result } = apiHealthGate;
    console.error(
      `[pyrus-dev] PYRUS web exited before API became healthy: code=${result.code ?? "null"} signal=${result.signal ?? "null"}`,
    );
    await shutdown(result.code ?? (result.signal ? 1 : 0));
  }
  lifecyclePhase = "api-healthy";
  apiHealthyMs = Date.now() - launchStartedAt;
  writeLifecycleEvent("api-healthy", {
    childPid: api.pid || null,
    durationMs: apiHealthyMs,
  });
  flightRecorder.writeHeartbeat(currentFlightHeartbeat());

  let workerExit = null;
  const workerStartup = resolveMarketDataWorkerStartup();
  if (workerStartup.start) {
    await reapStaleMarketDataWorkers();
    lifecyclePhase = "worker-starting";
    const worker = spawnService(
      "market-data worker",
      ["run", "market-data-worker:run"],
      marketDataWorkerEnv(),
    );
    workerChild = worker;
    workerExit = exitPromise("market-data worker", worker);
    workerStartedMs = Date.now() - launchStartedAt;
    writeLifecycleEvent("worker-started", {
      childPid: worker.pid || null,
      durationMs: workerStartedMs,
    });
    flightRecorder.writeHeartbeat(currentFlightHeartbeat());
  } else {
    lifecyclePhase = "worker-skipped";
    console.warn(
      `[pyrus-dev] market-data worker skipped: ${workerStartup.skippedReasons.join(", ")}`,
    );
    writeLifecycleEvent("worker-skipped", {
      reasons: workerStartup.skippedReasons,
    });
    flightRecorder.writeHeartbeat(currentFlightHeartbeat());
  }

  lifecyclePhase = "running";
  const totalMs = Date.now() - launchStartedAt;
  const summaryParts = [
    `api ${apiHealthyMs === null ? "?" : formatLaunchMs(apiHealthyMs)} to healthy`,
    webReadyMs === null ? "web still starting" : `web ${formatLaunchMs(webReadyMs)}`,
    workerStartup.start
      ? `worker +${formatLaunchMs(Math.max(0, (workerStartedMs ?? totalMs) - (apiHealthyMs ?? 0)))}`
      : "worker skipped",
  ];
  console.log(
    `[pyrus-dev] launch ready in ${formatLaunchMs(totalMs)} — ${summaryParts.join(", ")}`,
  );
  writeLifecycleEvent("launch-ready", {
    totalMs,
    apiHealthyMs,
    webReadyMs,
    workerStartedMs,
    workerSkipped: !workerStartup.start,
  });
  flightRecorder.writeHeartbeat(currentFlightHeartbeat());

  // The first UNEXPECTED child exit tears the supervisor down (surfacing the
  // crash). An intentional in-place API reload (SIGUSR2 → reloadApiInPlace) is
  // masked by `reloadInProgress` and re-arms its own watcher, so a backend reload
  // does NOT reach here and the supervisor + preview survive it.
  const firstExit = await new Promise((resolve) => {
    resolveFatalExit = resolve;
    watchFatalExit("API", apiExit, { reloadable: true });
    watchFatalExit("PYRUS web", webExit);
    if (workerExit) {
      watchFatalExit("market-data worker", workerExit);
    }
  });
  const code = firstExit.code ?? (firstExit.signal ? 1 : 0);
  console.error(
    `[pyrus-dev] ${firstExit.name} exited: code=${firstExit.code ?? "null"} signal=${firstExit.signal ?? "null"}`,
  );
  await shutdown(code);
} catch (error) {
  writeLifecycleEvent("supervisor-error", {
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(
    `[pyrus-dev] ${error instanceof Error ? error.message : String(error)}`,
  );
  await shutdown(1);
}
