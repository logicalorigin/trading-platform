#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
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

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const apiPort = process.env.PYRUS_API_PORT || process.env.RAYALGO_API_PORT || "8080";
const webPort =
  process.env.PYRUS_FRONTEND_PORT ||
  process.env.RAYALGO_FRONTEND_PORT ||
  process.env.PORT ||
  "18747";
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/healthz`;
const apiPortHex = Number(apiPort).toString(16).toUpperCase().padStart(4, "0");
const supervisorLockDir = process.env.RAYALGO_DEV_LOCK_DIR || "/tmp/rayalgo";
const supervisorLockPath = path.join(
  supervisorLockDir,
  `rayalgo-dev-supervisor-${apiPort}.lock`,
);
const supervisorLockWaitMs = Number(
  process.env.PYRUS_DEV_LOCK_WAIT_MS || process.env.RAYALGO_DEV_LOCK_WAIT_MS || "8000",
);
const supervisorTakeoverGraceMs = Number(
  process.env.PYRUS_DEV_TAKEOVER_GRACE_MS ||
    process.env.RAYALGO_DEV_TAKEOVER_GRACE_MS ||
    "20000",
);
const runningInsideReplitWorkflow =
  process.env.REPLIT_MODE === "workflow" ||
  process.env.PYRUS_REPLIT_RUN === "1" ||
  process.env.RAYALGO_REPLIT_RUN === "1";

let shuttingDown = false;
let supervisorLockAcquired = false;
const children = new Set();

function spawnService(name, args, env) {
  console.log(`[pyrus-dev] starting ${name}: pnpm ${args.join(" ")}`);
  const child = spawn("pnpm", args, {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
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

function readProcessParentId(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return Number(fields[1]);
  } catch {
    return null;
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

function launchedByCodexAgent() {
  let pid = process.ppid;
  for (let depth = 0; Number.isInteger(pid) && pid > 1 && depth < 32; depth += 1) {
    const command = readProcessCommand(pid);
    if (command.includes("@openai/codex") || command.includes("/codex/codex")) {
      return true;
    }
    pid = readProcessParentId(pid);
  }
  return false;
}

function assertAllowedLauncher() {
  if (
    process.env.PYRUS_DEV_ALLOW_CODEX_RUN !== "1" &&
    process.env.RAYALGO_DEV_ALLOW_CODEX_RUN !== "1" &&
    launchedByCodexAgent()
  ) {
    console.error(
      "[pyrus-dev] refusing to start the full app supervisor from a Codex-owned shell. Use the default Replit Run App entry so Replit owns the API/web lifecycle.",
    );
    process.exit(1);
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
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    console.warn(
      `[pyrus-dev] failed to send ${signal} to supervisor PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
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

async function requestSupervisorHandoff(ownerPid) {
  const graceMs =
    Number.isFinite(supervisorTakeoverGraceMs) && supervisorTakeoverGraceMs >= 0
      ? supervisorTakeoverGraceMs
      : 20_000;

  console.warn(
    `[pyrus-dev] another PYRUS dev supervisor is already running as PID ${ownerPid}; requesting controlled handoff so this Replit workflow owns the app without overlapping API/web processes.`,
  );

  if (!sendSignal(ownerPid, "SIGTERM")) {
    throw new Error(`Could not signal previous PYRUS dev supervisor ${ownerPid}.`);
  }

  if (await waitForSupervisorToExit(ownerPid, graceMs)) {
    console.warn(
      `[pyrus-dev] previous PYRUS dev supervisor ${ownerPid} stopped; continuing startup in this workflow.`,
    );
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
  for (const child of children) killChild(child, "SIGTERM");
  await delay(1500);
  for (const child of children) killChild(child, "SIGKILL");
  removeSupervisorLock();
  process.exit(status);
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

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.once("exit", removeSupervisorLock);

try {
  assertAllowedLauncher();

  const lockAcquired = await acquireSupervisorLock();
  if (!lockAcquired) {
    process.exit(1);
  }

  const api = spawnService(
    "API",
    ["--filter", "@workspace/api-server", "run", "dev"],
    { PORT: apiPort, LOG_LEVEL: process.env.LOG_LEVEL || "warn" },
  );
  const apiExit = exitPromise("API", api);
  await waitForApi(apiExit, api.pid);

  const web = spawnService(
    "PYRUS web",
    ["--filter", "@workspace/pyrus", "run", "dev:web"],
    {
      PORT: webPort,
      BASE_PATH: process.env.BASE_PATH || "/",
      VITE_PROXY_API_TARGET:
        process.env.VITE_PROXY_API_TARGET || `http://127.0.0.1:${apiPort}`,
    },
  );

  const firstExit = await Promise.race([apiExit, exitPromise("PYRUS web", web)]);
  const code = firstExit.code ?? (firstExit.signal ? 1 : 0);
  console.error(
    `[pyrus-dev] ${firstExit.name} exited: code=${firstExit.code ?? "null"} signal=${firstExit.signal ?? "null"}`,
  );
  await shutdown(code);
} catch (error) {
  console.error(
    `[pyrus-dev] ${error instanceof Error ? error.message : String(error)}`,
  );
  await shutdown(1);
}
