#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const apiPort = process.env.RAYALGO_API_PORT || "8080";
const webPort = process.env.RAYALGO_FRONTEND_PORT || process.env.PORT || "18747";
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/healthz`;
const apiPortHex = Number(apiPort).toString(16).toUpperCase().padStart(4, "0");

let shuttingDown = false;
const children = new Set();

function spawnService(name, args, env) {
  console.log(`[rayalgo-dev] starting ${name}: pnpm ${args.join(" ")}`);
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
        console.log(`[rayalgo-dev] API healthy at ${apiHealthUrl}`);
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

try {
  const api = spawnService(
    "API",
    ["--filter", "@workspace/api-server", "run", "dev"],
    { PORT: apiPort, LOG_LEVEL: process.env.LOG_LEVEL || "warn" },
  );
  const apiExit = exitPromise("API", api);
  await waitForApi(apiExit, api.pid);

  const web = spawnService(
    "RayAlgo web",
    ["--filter", "@workspace/rayalgo", "run", "dev:web"],
    {
      PORT: webPort,
      BASE_PATH: process.env.BASE_PATH || "/",
      VITE_PROXY_API_TARGET:
        process.env.VITE_PROXY_API_TARGET || `http://127.0.0.1:${apiPort}`,
    },
  );

  const firstExit = await Promise.race([apiExit, exitPromise("RayAlgo web", web)]);
  const code = firstExit.code ?? (firstExit.signal ? 1 : 0);
  console.error(
    `[rayalgo-dev] ${firstExit.name} exited: code=${firstExit.code ?? "null"} signal=${firstExit.signal ?? "null"}`,
  );
  await shutdown(code);
} catch (error) {
  console.error(
    `[rayalgo-dev] ${error instanceof Error ? error.message : String(error)}`,
  );
  await shutdown(1);
}
