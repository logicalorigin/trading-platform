#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensurePatchedPlaywrightChromium } from "./preparePlaywrightChromium.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultPlaywrightArgs = [
  "e2e/warmup-policy.spec.ts",
  "--project=chromium",
  "--reporter=list",
];
const playwrightArgs =
  process.argv.length > 2 ? process.argv.slice(2) : defaultPlaywrightArgs;
const skipBuild = process.env.PYRUS_WARMUP_POLICY_SKIP_BUILD === "1";
const requestedPort = Number.parseInt(
  process.env.PYRUS_WARMUP_POLICY_PORT || "",
  10,
);

let apiProcess = null;

function spawnCommand(name, command, args, env = {}) {
  console.log(`[warmup-prod] ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return child;
}

function waitForExit(name, child) {
  return new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${name} failed: code=${code ?? "null"} signal=${signal ?? "null"}`,
        ),
      );
    });
  });
}

function waitForUnexpectedExit(name, child) {
  return new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `${name} exited before the warmup matrix completed: code=${code ?? "null"} signal=${signal ?? "null"}`,
        ),
      );
    });
  });
}

async function runCommand(name, command, args, env = {}) {
  const child = spawnCommand(name, command, args, env);
  await waitForExit(name, child);
}

async function getFreePort() {
  if (Number.isFinite(requestedPort) && requestedPort > 0) {
    return requestedPort;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Could not allocate a local test port."));
        }
      });
    });
  });
}

async function waitForHttp(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not checked";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function killProcessTree(child) {
  if (!child?.pid || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
}

async function shutdownApi() {
  if (!apiProcess) return;
  killProcessTree(apiProcess);
  await delay(1_500);
  if (!apiProcess.killed) {
    try {
      process.kill(-apiProcess.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  apiProcess = null;
}

process.once("SIGINT", () => {
  void shutdownApi().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void shutdownApi().finally(() => process.exit(143));
});

try {
  const port = await getFreePort();
  const executablePath = await ensurePatchedPlaywrightChromium();

  if (!skipBuild) {
    await runCommand("build web", "pnpm", [
      "--filter",
      "@workspace/pyrus",
      "run",
      "build",
    ]);
    await runCommand("build API", "pnpm", [
      "--filter",
      "@workspace/api-server",
      "run",
      "build",
    ]);
  }

  apiProcess = spawnCommand(
    "start production API/web",
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "start"],
    {
      NODE_ENV: "production",
      PORT: String(port),
      PYRUS_SERVE_WEB: "1",
      LOG_LEVEL: process.env.LOG_LEVEL || "warn",
    },
  );

  await Promise.race([
    waitForUnexpectedExit("production API/web", apiProcess),
    (async () => {
      await waitForHttp(`http://127.0.0.1:${port}/api/healthz`, "API health");
      await waitForHttp(`http://127.0.0.1:${port}/`, "web root");
    })(),
  ]);

  console.log(`[warmup-prod] running warmup matrix at http://127.0.0.1:${port}`);
  await runCommand(
    "warmup Playwright",
    "pnpm",
    ["--filter", "@workspace/pyrus", "exec", "playwright", "test", ...playwrightArgs],
    {
      PLAYWRIGHT_PORT: String(port),
      PYRUS_PLAYWRIGHT_NO_WEB_SERVER: "1",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath,
      PYRUS_WARMUP_POLICY_MOCK_API:
        process.env.PYRUS_WARMUP_POLICY_MOCK_API || "1",
    },
  );
} finally {
  await shutdownApi();
}
