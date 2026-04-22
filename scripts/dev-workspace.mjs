import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;
const apiPort = process.env.API_PORT || "8080";
const frontendPort = process.env.PORT || "3007";
const apiBaseUrl =
  process.env.BACKTEST_API_BASE_URL || `http://127.0.0.1:${apiPort}/api`;
const viteProxyTarget =
  process.env.VITE_PROXY_API_TARGET || `http://127.0.0.1:${apiPort}`;

function startProcess(label, args, extraEnv = {}) {
  const child = spawn("pnpm", args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[workspace-dev] ${label} exited with ${reason}`);
    shutdown(code ?? 0);
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 1_500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (["1", "true", "yes", "on"].includes(String(process.env.START_IBKR_BRIDGE || "").toLowerCase())) {
  startProcess(
    "ibkr-bridge",
    ["--filter", "@workspace/ibkr-bridge", "run", "dev"],
    {
      PORT: process.env.IBKR_BRIDGE_PORT || "5002",
    },
  );
}

startProcess(
  "api-server",
  ["--filter", "@workspace/api-server", "run", "dev"],
  {
    PORT: apiPort,
  },
);
startProcess(
  "backtest-worker",
  ["--filter", "@workspace/backtest-worker", "run", "dev"],
  {
    BACKTEST_API_BASE_URL: apiBaseUrl,
  },
);
startProcess(
  "rayalgo",
  ["--filter", "@workspace/rayalgo", "run", "dev"],
  {
    PORT: frontendPort,
    BASE_PATH: process.env.BASE_PATH || "/",
    VITE_PROXY_API_TARGET: viteProxyTarget,
  },
);
