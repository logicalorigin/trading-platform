#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertFileIdentity,
  captureExecutableIdentity,
  captureFileIdentity,
  resolveCommandExecutable,
  resolveMarketDataWorkerCommand,
} from "../../../scripts/market-data-worker-lifecycle.mjs";
import {
  readProcessGroupIdentity,
} from "../../../scripts/process-group-child.mjs";
import {
  createProcInspector,
  reapPort,
} from "../../../scripts/reap-dev-port.mjs";

const launcherPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const pyrusDir = path.join(repoRoot, "artifacts", "pyrus");
const apiDir = path.join(repoRoot, "artifacts", "api-server");
const ibkrDir = path.join(repoRoot, "lib", "ibkr-session-host");

const ROLE_SPECS = Object.freeze({
  web: {
    packageFile: path.join(pyrusDir, "package.json"),
    packageName: "@workspace/pyrus",
    expectedScripts: {
      dev:
        "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH NIX_LD NIX_LD_LIBRARY_PATH; exec node ./scripts/runDevApp.mjs",
      "dev:replit":
        "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH NIX_LD NIX_LD_LIBRARY_PATH PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED SIGNAL_MONITOR_BAR_EVALUATION_ENABLED; export PYRUS_BACKGROUND_STOCK_AGGREGATE_STREAMS_ENABLED=1; exec node ./scripts/runDevApp.mjs",
      "dev:web":
        "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH NIX_LD NIX_LD_LIBRARY_PATH; export PORT=${PORT:-18747} BASE_PATH=${BASE_PATH:-/} VITE_PROXY_API_TARGET=${VITE_PROXY_API_TARGET:-http://127.0.0.1:8080}; exec vite --config vite.config.ts --host 0.0.0.0",
    },
    lifecycleEvent: "dev:web",
    cwd: pyrusDir,
    unsetEnv: [
      "REPLIT_LD_LIBRARY_PATH",
      "LD_LIBRARY_PATH",
      "NIX_LD",
      "NIX_LD_LIBRARY_PATH",
    ],
  },
  api: {
    packageFile: path.join(apiDir, "package.json"),
    packageName: "@workspace/api-server",
    expectedScripts: {
      build: "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH; node ./build.mjs",
      dev:
        "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH; export PORT=${PORT:-8080} NODE_ENV=development MALLOC_ARENA_MAX=${MALLOC_ARENA_MAX:-2} PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=${PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED:-false}; pnpm run build && exec node --enable-source-maps ./dist/index.mjs",
      start:
        "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH; exec node --enable-source-maps ./dist/index.mjs",
    },
    lifecycleEvent: "dev",
    cwd: apiDir,
    generatedEntry: path.join(apiDir, "dist", "index.mjs"),
    unsetEnv: ["REPLIT_LD_LIBRARY_PATH", "LD_LIBRARY_PATH"],
  },
  ibkr: {
    packageFile: path.join(ibkrDir, "package.json"),
    packageName: "@workspace/ibkr-session-host",
    expectedScripts: {
      build: "node ./build.mjs",
      dev: "pnpm run build && pnpm run start",
      start: "node --enable-source-maps ./dist/index.mjs",
    },
    lifecycleEvent: "start",
    cwd: ibkrDir,
    generatedEntry: path.join(ibkrDir, "dist", "index.mjs"),
    unsetEnv: [],
  },
  market: {
    packageFile: path.join(repoRoot, "package.json"),
    packageName: null,
    expectedScripts: {
      "market-data-worker:run":
        "node scripts/run-market-data-worker.mjs run -p market-data-worker -- run",
    },
    lifecycleEvent: "market-data-worker:run",
    cwd: repoRoot,
    unsetEnv: [],
  },
});

const MARKET_DATA_WORKER_ARGS = [
  "run",
  "-p",
  "market-data-worker",
  "--",
  "run",
];

function readDevEnvLocal() {
  try {
    const env = Object.create(null);
    const text = readFileSync(
      path.join(repoRoot, ".pyrus-runtime", "dev-env.local"),
      "utf8",
    );
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

const runtimeEnv = { ...process.env, ...readDevEnvLocal() };
const apiPort = runtimeEnv.PYRUS_API_PORT || "8080";
const webPort = runtimeEnv.PYRUS_FRONTEND_PORT || runtimeEnv.PORT || "18747";
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/healthz`;
const children = new Set();
const procInspector = createProcInspector();

let stopping = false;
let shutdownPromise;
let terminationRequestCount = 0;
let resolveFailure;
const firstFailure = new Promise((resolve) => {
  resolveFailure = resolve;
});

function nonEmpty(name) {
  return typeof runtimeEnv[name] === "string" && runtimeEnv[name].trim() !== "";
}

function nodeOptionsWithMaxOldSpace(maxOldSpaceMb) {
  const current = (runtimeEnv.NODE_OPTIONS || "").trim();
  if (/(^|\s)--max-old-space-size(?:=|\s|$)/.test(current)) return current;
  return [current, `--max-old-space-size=${maxOldSpaceMb}`]
    .filter(Boolean)
    .join(" ");
}

// This detects accidental package metadata drift before a role is launched and
// immediately before exec. It cannot close an adversarial check-to-exec race.
export function assertAuditedPackage(spec) {
  if (
    !spec ||
    typeof spec !== "object" ||
    typeof spec.packageFile !== "string" ||
    !spec.expectedScripts ||
    typeof spec.expectedScripts !== "object"
  ) {
    throw new Error("Audited package specification is invalid");
  }
  const packageJson = JSON.parse(readFileSync(spec.packageFile, "utf8"));
  if (spec.packageName && packageJson.name !== spec.packageName) {
    throw new Error(
      `Package identity drifted for ${spec.packageFile}: expected ${spec.packageName}`,
    );
  }
  for (const [name, expected] of Object.entries(spec.expectedScripts)) {
    if (packageJson.scripts?.[name] !== expected) {
      throw new Error(
        `Package script drifted for ${spec.packageFile} (${name})`,
      );
    }
  }
  return packageJson;
}

function lifecyclePath(cwd) {
  const entries = [
    path.join(cwd, "node_modules", ".bin"),
    path.join(repoRoot, "node_modules", ".bin"),
    ...(runtimeEnv.PATH || "").split(path.delimiter),
  ].filter(Boolean);
  return [...new Set(entries)].join(path.delimiter);
}

function lifecycleEnv(spec, overrides, identities) {
  const packageJson = assertAuditedPackage(spec);
  const env = { ...runtimeEnv, ...overrides };
  for (const name of spec.unsetEnv) delete env[name];
  for (const name of Object.keys(env)) {
    if (name.startsWith("npm_package_")) delete env[name];
  }
  env.PATH = lifecyclePath(spec.cwd);
  env.PWD = spec.cwd;
  env.INIT_CWD = repoRoot;
  env.npm_command = "run-script";
  env.npm_execpath = identities.pnpm.realpath;
  env.npm_node_execpath = identities.node.realpath;
  env.npm_lifecycle_event = spec.lifecycleEvent;
  env.npm_lifecycle_script = spec.expectedScripts[spec.lifecycleEvent];
  env.npm_package_json = spec.packageFile;
  if (typeof packageJson.name === "string") {
    env.npm_package_name = packageJson.name;
  }
  if (typeof packageJson.version === "string") {
    env.npm_package_version = packageJson.version;
  }
  return env;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, "'\\''")}'`;
}

function encodeRoleSnapshot(snapshot) {
  return Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64url");
}

function decodeRoleSnapshot(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("Role identity snapshot is missing");
  }
  const snapshot = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  );
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Role identity snapshot is invalid");
  }
  return snapshot;
}

function processIdentityFromStat(text) {
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const fields = text.slice(close + 2).trim().split(/\s+/u);
  const processGroup = Number(fields[2]);
  if (!Number.isSafeInteger(processGroup) || processGroup <= 0) return null;
  return {
    processGroup,
    startTimeTicks: fields[19] || null,
  };
}

function assertNoUnexpectedGroupMember(groupLeaderPid) {
  if (
    !Number.isSafeInteger(groupLeaderPid) ||
    groupLeaderPid <= 0 ||
    process.ppid !== groupLeaderPid
  ) {
    throw new Error("Role exec verifier is not attached to its group leader");
  }
  const unexpected = [];
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid === groupLeaderPid || pid === process.pid) continue;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      if (processIdentityFromStat(stat)?.processGroup === groupLeaderPid) {
        unexpected.push(pid);
      }
    } catch {
      // A process that exited during the scan is no longer a build helper.
    }
  }
  if (unexpected.length) {
    throw new Error(
      `Unexpected build-group member remains before exec: ${unexpected.join(",")}`,
    );
  }
}

function captureEntryGroupIdentity(entry) {
  if (entry.groupIdentity || !entry.child.pid) return;
  try {
    const identity = readProcessGroupIdentity(entry.child.pid);
    if (identity?.pid === entry.child.pid && identity.startTimeTicks) {
      entry.groupIdentity = identity;
    }
  } catch {
    // A later spawn callback gets one more opportunity to capture it.
  }
}

function ownedGroupMembers(entry) {
  const identity = entry.groupIdentity;
  if (!identity) return [];
  try {
    const current = processIdentityFromStat(
      readFileSync(`/proc/${identity.pid}/stat`, "utf8"),
    );
    if (
      !current ||
      current.startTimeTicks !== identity.startTimeTicks ||
      current.processGroup !== identity.pid
    ) {
      if (!entry.identityWarningReported) {
        entry.identityWarningReported = true;
        console.warn(
          `[pyrus-dev] refusing reused process-group identity for ${entry.name}`,
        );
      }
      return [];
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ESRCH") return [];
    // Linux retains an exited leader's PGID while its descendants remain.
  }
  const members = [];
  for (const candidate of readdirSync("/proc", { withFileTypes: true })) {
    if (!candidate.isDirectory() || !/^\d+$/u.test(candidate.name)) continue;
    const pid = Number(candidate.name);
    try {
      const current = processIdentityFromStat(
        readFileSync(`/proc/${pid}/stat`, "utf8"),
      );
      if (current?.processGroup === identity.pid) {
        members.push({ pid, startTimeTicks: current.startTimeTicks });
      }
    } catch {
      // A process exiting during inspection is already outside cleanup debt.
    }
  }
  return members;
}

function signalOwnedGroup(entry, signal) {
  const members = ownedGroupMembers(entry);
  if (members.length && entry.groupIdentity) {
    try {
      process.kill(-entry.groupIdentity.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.warn(
          `[pyrus-dev] failed to send ${signal} to ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
  }
  if (!entry.leaderEnded && entry.child.pid) {
    try {
      entry.child.kill(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.warn(
          `[pyrus-dev] failed to send ${signal} to ${entry.name} leader: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

async function waitForOwnedGroupToClear(entry, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!ownedGroupMembers(entry).length) return true;
    await delay(50);
  }
  return !ownedGroupMembers(entry).length;
}

function cleanOwnedGroup(entry) {
  if (entry.cleanupPromise) return entry.cleanupPromise;
  entry.cleanupPromise = (async () => {
    signalOwnedGroup(entry, "SIGTERM");
    if (!(await waitForOwnedGroupToClear(entry, 2_500))) {
      signalOwnedGroup(entry, "SIGKILL");
      await waitForOwnedGroupToClear(entry, 1_000);
    }
  })();
  return entry.cleanupPromise;
}

function verifyRoleExec(roleName, groupLeaderPid) {
  const spec = ROLE_SPECS[roleName];
  if (!spec) throw new Error(`Unknown role exec verifier: ${roleName}`);
  const snapshot = decodeRoleSnapshot(process.env.PYRUS_ROLE_EXEC_SNAPSHOT);
  if (snapshot.role !== roleName || !snapshot.identities) {
    throw new Error(`Role identity snapshot does not match ${roleName}`);
  }
  const required = [
    "node",
    "shell",
    ...(roleName === "api" || roleName === "ibkr" ? ["pnpm"] : []),
    ...(roleName === "web" ? ["vite"] : []),
    ...(roleName === "market" ? ["marketCommand"] : []),
  ];
  for (const name of required) {
    if (!snapshot.identities[name]) {
      throw new Error(`Role identity snapshot is missing ${name}`);
    }
    assertFileIdentity(snapshot.identities[name]);
  }
  assertAuditedPackage(spec);
  if (spec.generatedEntry) {
    const generated = captureFileIdentity(spec.generatedEntry);
    if (generated.realpath !== path.resolve(spec.generatedEntry)) {
      throw new Error(
        `Generated role entry must not be a symlink: ${spec.generatedEntry}`,
      );
    }
  }
  assertNoUnexpectedGroupMember(groupLeaderPid);
}

function registerChild(name, child) {
  const entry = {
    child,
    name,
    leaderEnded: false,
    groupIdentity: null,
    identityWarningReported: false,
    cleanupPromise: null,
    done: null,
  };
  entry.done = new Promise((resolve) => {
    const finish = (result) => {
      if (entry.leaderEnded) return;
      entry.leaderEnded = true;
      resolve(result);
      if (!stopping) {
        void cleanOwnedGroup(entry).then(
          () => {
            if (!stopping) resolveFailure({ name, ...result });
          },
          (error) => {
            console.warn(
              `[pyrus-dev] failed to clean ${name} after exit: ${error instanceof Error ? error.message : String(error)}`,
            );
            if (!stopping) resolveFailure({ name, ...result });
          },
        );
      }
    };
    child.once("error", (error) => finish({ error }));
    child.once("exit", (code, signal) => finish({ code, signal }));
  });
  captureEntryGroupIdentity(entry);
  child.once("spawn", () => captureEntryGroupIdentity(entry));
  children.add(entry);
  return entry;
}

function startAuditedRole({
  args,
  build = false,
  env,
  execCommand,
  identities,
  name,
  role,
}) {
  if (stopping) {
    throw new Error(`Cannot start ${name} while the app is shutting down`);
  }
  const spec = ROLE_SPECS[role];
  assertAuditedPackage(spec);
  const snapshot = encodeRoleSnapshot({ role, identities });
  const verify = [
    shellQuote(identities.node.realpath),
    shellQuote(launcherPath),
    "--verify-role-exec",
    shellQuote(role),
    '"$$"',
  ].join(" ");
  const commands = ["trap '' HUP"];
  if (build) {
    commands.push(
      `${shellQuote(identities.pnpm.realpath)} run build || exit $?`,
    );
  }
  commands.push(`${verify} || exit $?`);
  commands.push("unset PYRUS_ROLE_EXEC_SNAPSHOT");
  commands.push(
    `exec ${[shellQuote(execCommand), ...args.map(shellQuote)].join(" ")}`,
  );
  console.log(
    `[pyrus-dev] starting ${name}: ${execCommand} ${args.join(" ")}`,
  );
  const child = spawn(identities.shell.realpath, ["-c", commands.join("\n")], {
    cwd: spec.cwd,
    detached: true,
    env: {
      ...env,
      PYRUS_ROLE_EXEC_SNAPSHOT: snapshot,
    },
    stdio: "inherit",
  });
  return registerChild(name, child);
}

function resolveViteIdentity() {
  const requireFromPyrus = createRequire(
    path.join(pyrusDir, "package.json"),
  );
  const packageRoot = path.dirname(
    requireFromPyrus.resolve("vite/package.json"),
  );
  return captureExecutableIdentity(
    path.join(packageRoot, "bin", "vite.js"),
  );
}

function resolveStartupIdentities() {
  const node = captureExecutableIdentity(process.execPath);
  const shell = captureExecutableIdentity("/bin/sh");
  const pnpm = resolveCommandExecutable("pnpm", { env: runtimeEnv });
  if (!pnpm) throw new Error("pnpm executable could not be resolved");
  return {
    node,
    pnpm,
    shell,
    vite: resolveViteIdentity(),
  };
}

function forceOwnedGroups() {
  for (const entry of children) signalOwnedGroup(entry, "SIGKILL");
}

function requestShutdown(status) {
  terminationRequestCount += 1;
  if (terminationRequestCount === 1) {
    void shutdown(status);
    return;
  }
  forceOwnedGroups();
}

async function shutdown(status) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    const owned = [...children];
    await Promise.all(owned.map((entry) => cleanOwnedGroup(entry)));
    process.exit(status);
  })();
  return shutdownPromise;
}

async function waitForApi(apiRootPid) {
  const deadline = Date.now() + 90_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(apiHealthUrl, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        const owner = procInspector.portOwnerStatus(
          Number(apiPort),
          apiRootPid,
        );
        if (owner.owned) {
          console.log(`[pyrus-dev] API healthy at ${apiHealthUrl}`);
          return;
        }
        lastError = `healthy response came from a previous API process (${owner.detail})`;
        await delay(500);
        continue;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(
    `API did not become healthy at ${apiHealthUrl}: ${lastError}`,
  );
}

function workerConfigured() {
  const hasDatabase =
    nonEmpty("DATABASE_URL") ||
    nonEmpty("LOCAL_DATABASE_URL") ||
    (nonEmpty("PGHOST") && nonEmpty("PGDATABASE") && nonEmpty("PGUSER"));
  const hasMassive =
    nonEmpty("MASSIVE_API_KEY") || nonEmpty("MASSIVE_MARKET_DATA_API_KEY");
  return { start: hasDatabase && hasMassive, hasDatabase, hasMassive };
}

function workerEnv() {
  return {
    LOG_LEVEL: runtimeEnv.LOG_LEVEL || "warn",
    RUST_LOG: runtimeEnv.RUST_LOG || "market_data_worker=info,info",
    MARKET_DATA_WORKER_DB_POOL_MAX:
      runtimeEnv.MARKET_DATA_WORKER_DB_POOL_MAX || "1",
    ...(!nonEmpty("DATABASE_URL") && nonEmpty("LOCAL_DATABASE_URL")
      ? { DATABASE_URL: runtimeEnv.LOCAL_DATABASE_URL }
      : {}),
  };
}

function reapStaleListeners() {
  const ports = [apiPort, webPort];
  if (runtimeEnv.IBKR_SESSION_HOST_ENABLED === "1") {
    ports.push(
      runtimeEnv.IBKR_SESSION_HOST_PORT || "18748",
      "15000",
      "16080",
    );
  }
  for (const rawPort of new Set(ports)) {
    if (reapPort({ rawPort, env: runtimeEnv }) !== 0) {
      throw new Error(`Failed to free required startup port ${rawPort}`);
    }
  }
}

async function main() {
  process.on("SIGINT", () => requestShutdown(130));
  process.on("SIGTERM", () => requestShutdown(143));
  process.on("SIGHUP", () => {
    // The Replit artifact launcher deliberately ignores terminal hangup.
  });

  try {
    assertAuditedPackage(ROLE_SPECS.api);
    assertAuditedPackage(ROLE_SPECS.web);
    if (runtimeEnv.IBKR_SESSION_HOST_ENABLED === "1") {
      assertAuditedPackage(ROLE_SPECS.ibkr);
    }
    const baseIdentities = resolveStartupIdentities();
    reapStaleListeners();
    const api = startAuditedRole({
      name: "API",
      role: "api",
      build: true,
      identities: {
        node: baseIdentities.node,
        pnpm: baseIdentities.pnpm,
        shell: baseIdentities.shell,
      },
      execCommand: baseIdentities.node.realpath,
      args: ["--enable-source-maps", ROLE_SPECS.api.generatedEntry],
      env: lifecycleEnv(
        ROLE_SPECS.api,
        {
          PORT: apiPort,
          NODE_ENV: "development",
          PYRUS_DB_PROFILE: "api",
          LOG_LEVEL: runtimeEnv.LOG_LEVEL || "warn",
          MALLOC_ARENA_MAX: runtimeEnv.MALLOC_ARENA_MAX || "2",
          NODE_OPTIONS: nodeOptionsWithMaxOldSpace("2560"),
          PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED:
            runtimeEnv.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED || "false",
        },
        baseIdentities,
      ),
    });
    startAuditedRole({
      name: "PYRUS web",
      role: "web",
      identities: {
        node: baseIdentities.node,
        shell: baseIdentities.shell,
        vite: baseIdentities.vite,
      },
      execCommand: baseIdentities.node.realpath,
      args: [
        baseIdentities.vite.realpath,
        "--config",
        "vite.config.ts",
        "--host",
        "0.0.0.0",
      ],
      env: lifecycleEnv(
        ROLE_SPECS.web,
        {
          PORT: webPort,
          BASE_PATH: runtimeEnv.BASE_PATH || "/",
          MALLOC_ARENA_MAX: runtimeEnv.MALLOC_ARENA_MAX || "2",
          NODE_OPTIONS: nodeOptionsWithMaxOldSpace("1536"),
          VITE_PROXY_API_TARGET:
            runtimeEnv.VITE_PROXY_API_TARGET ||
            `http://127.0.0.1:${apiPort}`,
        },
        baseIdentities,
      ),
    });

    if (runtimeEnv.IBKR_SESSION_HOST_ENABLED === "1") {
      startAuditedRole({
        name: "IBKR session host",
        role: "ibkr",
        build: true,
        identities: {
          node: baseIdentities.node,
          pnpm: baseIdentities.pnpm,
          shell: baseIdentities.shell,
        },
        execCommand: baseIdentities.node.realpath,
        args: ["--enable-source-maps", ROLE_SPECS.ibkr.generatedEntry],
        env: lifecycleEnv(ROLE_SPECS.ibkr, {}, baseIdentities),
      });
    }

    await Promise.race([
      waitForApi(api.child.pid),
      firstFailure.then((failure) => {
        throw failure;
      }),
    ]);

    const worker = workerConfigured();
    if (worker.start) {
      assertAuditedPackage(ROLE_SPECS.market);
      const marketEnv = lifecycleEnv(
        ROLE_SPECS.market,
        workerEnv(),
        baseIdentities,
      );
      const launch = resolveMarketDataWorkerCommand(
        MARKET_DATA_WORKER_ARGS,
        { env: marketEnv },
      );
      assertFileIdentity(launch.executableIdentity);
      startAuditedRole({
        name: "market-data worker",
        role: "market",
        identities: {
          node: baseIdentities.node,
          shell: baseIdentities.shell,
          marketCommand: launch.executableIdentity,
        },
        execCommand: launch.command,
        args: launch.commandArgs,
        env: marketEnv,
      });
    } else {
      console.warn(
        `[pyrus-dev] market-data worker skipped: ${[
          !worker.hasDatabase && "database_unconfigured",
          !worker.hasMassive && "massive_provider_unconfigured",
        ]
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    console.log(`[pyrus-dev] ready: API ${apiPort}, web ${webPort}`);
    const failure = await firstFailure;
    const detail = failure.error
      ? failure.error instanceof Error
        ? failure.error.message
        : String(failure.error)
      : `code=${failure.code ?? "null"} signal=${failure.signal ?? "null"}`;
    console.error(`[pyrus-dev] ${failure.name} exited unexpectedly: ${detail}`);
    await shutdown(1);
  } catch (error) {
    const detail =
      error && typeof error === "object" && "name" in error && "error" in error
        ? `${error.name} failed to start: ${error.error instanceof Error ? error.error.message : String(error.error)}`
        : error &&
            typeof error === "object" &&
            "name" in error &&
            ("code" in error || "signal" in error)
          ? `${error.name} exited unexpectedly: code=${error.code ?? "null"} signal=${error.signal ?? "null"}`
          : error instanceof Error
            ? error.message
            : String(error);
    console.error(`[pyrus-dev] ${detail}`);
    await shutdown(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === launcherPath
) {
  if (process.argv[2] === "--verify-role-exec") {
    try {
      verifyRoleExec(process.argv[3], Number(process.argv[4]));
    } catch (error) {
      console.error(
        `[pyrus-dev] role exec verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  } else {
    void main();
  }
}
