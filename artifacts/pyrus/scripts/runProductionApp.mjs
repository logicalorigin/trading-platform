import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SHUTDOWN_GRACE_MS = 10_000;
const HOST_SYSTEM_ENV = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
];
const REQUIRED_SIGNED_HOST_ENV = [
  "IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY",
  "IBKR_SESSION_CAPSULE_IMAGE",
  "IBKR_SESSION_HOST_CONTROL_KEY",
  "IBKR_SESSION_HOST_FAILURE_DOMAIN",
  "IBKR_SESSION_HOST_ID",
  "IBKR_SESSION_HOST_RUNTIME_ATTESTATION_DIGEST",
  "IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST",
  "IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST",
];

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid ${label}.`);
  }
  return port;
}

function hostEnvironment(env, apiPort) {
  const hostEnv = {};
  for (const name of HOST_SYSTEM_ENV) {
    if (typeof env[name] === "string") hostEnv[name] = env[name];
  }
  for (const [name, value] of Object.entries(env)) {
    if (
      name.startsWith("IBKR_SESSION_") &&
      name !== "IBKR_SESSION_HOST_CONTROL_TOKEN" &&
      typeof value === "string"
    ) {
      hostEnv[name] = value;
    }
  }
  return {
    ...hostEnv,
    DOCKER_HOST: "unix:///var/run/docker.sock",
    IBKR_SESSION_HOST_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
    IBKR_SESSION_HOST_BIND: "127.0.0.1",
    NODE_ENV: "production",
    PYRUS_API_PORT: String(apiPort),
  };
}

export function resolveProductionServices(
  env = process.env,
  root = repoRoot,
) {
  const apiPort = parsePort(env.PORT, "production API port");
  if (env.NODE_ENV !== "production" || env.PYRUS_SERVE_WEB !== "1") {
    throw new Error("Production API must serve the built web app.");
  }
  const hostEnabled = env.IBKR_SESSION_HOST_ENABLED === "1";
  if (env.IBKR_GATEWAY_FLEET_ENABLED === "1" && !hostEnabled) {
    throw new Error("Fleet routing requires the co-located session host.");
  }
  if (
    hostEnabled &&
    REQUIRED_SIGNED_HOST_ENV.some((name) => !nonEmpty(env[name]))
  ) {
    throw new Error(
      "The production session host requires complete signed lifecycle configuration.",
    );
  }

  const services = [
    {
      name: "API",
      entry: path.join(root, "artifacts/api-server/dist/index.mjs"),
      env: { ...env, PORT: String(apiPort) },
    },
  ];
  if (!hostEnabled) return services;

  const hostPort = parsePort(
    env.IBKR_SESSION_HOST_PORT ?? "18748",
    "IBKR session host port",
  );
  if (hostPort === apiPort) {
    throw new Error(
      "The IBKR session host must not share the external API port.",
    );
  }
  services.push({
    name: "IBKR session host",
    entry: path.join(root, "lib/ibkr-session-host/dist/index.mjs"),
    env: hostEnvironment(env, apiPort),
  });
  return services;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

export function superviseProductionServices(services, options = {}) {
  const states = [];
  const signalTarget = options.signalTarget ?? process;
  const log = options.log ?? ((message) => console.log(message));
  const logError = options.logError ?? ((message) => console.error(message));
  const spawnProcess =
    options.spawnProcess ??
    ((service) =>
      spawn(process.execPath, ["--enable-source-maps", service.entry], {
        cwd: repoRoot,
        env: service.env,
        stdio: "inherit",
      }));
  let shuttingDown = false;
  let shutdownPromise = null;
  let resolveSupervisor;
  const supervisorCompletion = new Promise((resolve) => {
    resolveSupervisor = resolve;
  });

  const onSigint = () => void shutdown(130);
  const onSigterm = () => void shutdown(143);
  const removeSignalHandlers = () => {
    signalTarget.removeListener?.("SIGINT", onSigint);
    signalTarget.removeListener?.("SIGTERM", onSigterm);
  };

  const shutdown = (exitCode) => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = (async () => {
      for (const { child, finished } of states) {
        if (!finished()) child.kill("SIGTERM");
      }
      await Promise.race([
        Promise.all(states.map(({ completion }) => completion)),
        delay(SHUTDOWN_GRACE_MS),
      ]);
      for (const { child, finished } of states) {
        if (!finished()) child.kill("SIGKILL");
      }
      await Promise.race([
        Promise.all(states.map(({ completion }) => completion)),
        delay(1_000),
      ]);
      removeSignalHandlers();
      options.onExit?.(exitCode);
      resolveSupervisor(exitCode);
    })();
    return shutdownPromise;
  };

  for (const service of services) {
    log(`[pyrus-production] starting ${service.name}`);
    const child = spawnProcess(service);
    let result = null;
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    const finish = (nextResult) => {
      if (result) return;
      result = nextResult;
      resolveCompletion(nextResult);
    };
    child.once("error", () => finish({ code: 1, signal: null }));
    child.once("exit", (code, signal) => finish({ code, signal }));
    const state = {
      child,
      completion,
      finished: () => result !== null,
      name: service.name,
    };
    states.push(state);
    void completion.then(({ code, signal }) => {
      if (shuttingDown) return;
      logError(
        `[pyrus-production] ${service.name} exited: code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      void shutdown(typeof code === "number" && code !== 0 ? code : 1);
    });
  }

  if (signalTarget === process) {
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  } else {
    signalTarget.once("SIGINT", onSigint);
    signalTarget.once("SIGTERM", onSigterm);
  }
  return supervisorCompletion;
}

export function runProductionApp(env = process.env) {
  return superviseProductionServices(resolveProductionServices(env), {
    onExit: (exitCode) => {
      process.exitCode = exitCode;
    },
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    void runProductionApp();
  } catch {
    console.error("[pyrus-production] startup_failed");
    process.exitCode = 1;
  }
}
