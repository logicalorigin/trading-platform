#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const apiPort = process.env.RAYALGO_API_PORT || "8080";
const webPort = process.env.RAYALGO_FRONTEND_PORT || process.env.PORT || "18747";
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/healthz`;

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

async function shutdown(status = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killChild(child, "SIGTERM");
  await delay(1500);
  for (const child of children) killChild(child, "SIGKILL");
  process.exit(status);
}

async function waitForApi(childExit) {
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
      console.log(`[rayalgo-dev] API healthy at ${apiHealthUrl}`);
      return;
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
  await waitForApi(apiExit);

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
