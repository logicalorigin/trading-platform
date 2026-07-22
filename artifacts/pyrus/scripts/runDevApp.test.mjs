import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertAuditedPackage } from "./runDevApp.mjs";

const launcherPath = fileURLToPath(new URL("./runDevApp.mjs", import.meta.url));
const reapPortPath = fileURLToPath(
  new URL("../../../scripts/reap-dev-port.mjs", import.meta.url),
);
const processAuthorityPath = fileURLToPath(
  new URL("../../../scripts/replit-process-authority.mjs", import.meta.url),
);
const marketLifecyclePath = fileURLToPath(
  new URL("../../../scripts/market-data-worker-lifecycle.mjs", import.meta.url),
);
const processGroupChildPath = fileURLToPath(
  new URL("../../../scripts/process-group-child.mjs", import.meta.url),
);

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function readJsonLines(file) {
  try {
    return (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch {
    return [];
  }
}

test("audited package scripts fail closed on drift", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pyrus-role-drift-"));
  const packageFile = path.join(tempDir, "package.json");
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  await writeFile(
    packageFile,
    JSON.stringify({
      name: "@workspace/test-role",
      scripts: { dev: "exec node app.mjs" },
    }),
  );
  const spec = {
    packageFile,
    packageName: "@workspace/test-role",
    expectedScripts: { dev: "exec node app.mjs" },
  };
  assert.equal(assertAuditedPackage(spec).name, "@workspace/test-role");
  await writeFile(
    packageFile,
    JSON.stringify({
      name: "@workspace/test-role",
      scripts: { dev: "node changed.mjs" },
    }),
  );
  assert.throws(() => assertAuditedPackage(spec), /script drifted/i);
});

test("workflow uses direct leaves, replaces stale listeners, and reaps stubborn groups", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pyrus-launcher-test-"));
  const binDir = path.join(tempDir, "bin");
  const isolatedRepo = path.join(tempDir, "repo");
  const pyrusDir = path.join(isolatedRepo, "artifacts", "pyrus");
  const apiDir = path.join(isolatedRepo, "artifacts", "api-server");
  const ibkrDir = path.join(isolatedRepo, "lib", "ibkr-session-host");
  const isolatedLauncherDir = path.join(pyrusDir, "scripts");
  const isolatedScriptsDir = path.join(isolatedRepo, "scripts");
  const isolatedLauncherPath = path.join(
    isolatedLauncherDir,
    "runDevApp.mjs",
  );
  const viteDir = path.join(isolatedRepo, "node_modules", "vite");
  const viteBin = path.join(viteDir, "bin", "vite.js");
  const buildLog = path.join(tempDir, "pnpm-builds.jsonl");
  const roleLog = path.join(tempDir, "role-leaves.jsonl");
  const helperLog = path.join(tempDir, "build-helper.jsonl");
  const healthRequested = path.join(tempDir, "health-requested");
  const releaseHealth = path.join(tempDir, "release-health");
  const apiPort = await unusedPort();
  await Promise.all([
    mkdir(binDir),
    mkdir(isolatedLauncherDir, { recursive: true }),
    mkdir(isolatedScriptsDir, { recursive: true }),
    mkdir(apiDir, { recursive: true }),
    mkdir(ibkrDir, { recursive: true }),
    mkdir(path.dirname(viteBin), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(launcherPath, isolatedLauncherPath),
    copyFile(
      reapPortPath,
      path.join(isolatedScriptsDir, "reap-dev-port-real.mjs"),
    ),
    copyFile(
      processAuthorityPath,
      path.join(isolatedScriptsDir, "replit-process-authority.mjs"),
    ),
    copyFile(
      marketLifecyclePath,
      path.join(isolatedScriptsDir, "market-data-worker-lifecycle.mjs"),
    ),
    copyFile(
      processGroupChildPath,
      path.join(isolatedScriptsDir, "process-group-child.mjs"),
    ),
    writeFile(
      path.join(isolatedScriptsDir, "reap-dev-port.mjs"),
      `import {
  createProcInspector,
  reapPort as reapRealPort,
} from "./reap-dev-port-real.mjs";

const allowedPorts = new Set(
  String(process.env.PYRUS_TEST_OWNED_PORTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const ignoredProductionPorts = new Set(["18748", "15000", "16080"]);

export { createProcInspector };

export function reapPort(input) {
  const port = String(input?.rawPort ?? "").trim();
  if (ignoredProductionPorts.has(port)) return 0;
  if (!allowedPorts.has(port)) {
    throw new Error(\`test reaper refused non-owned port \${port}\`);
  }
  return reapRealPort(input);
}
`,
    ),
  ]);
  await Promise.all([
    writeFile(
      path.join(isolatedRepo, "package.json"),
      JSON.stringify({
        name: "workspace",
        scripts: {
          "market-data-worker:run":
            "node scripts/run-market-data-worker.mjs run -p market-data-worker -- run",
        },
      }),
    ),
    writeFile(
      path.join(pyrusDir, "package.json"),
      JSON.stringify({
        name: "@workspace/pyrus",
        scripts: {
          dev: "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH NIX_LD NIX_LD_LIBRARY_PATH; exec node ./scripts/runDevApp.mjs",
          "dev:replit":
            "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH NIX_LD NIX_LD_LIBRARY_PATH PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED SIGNAL_MONITOR_BAR_EVALUATION_ENABLED; export PYRUS_BACKGROUND_STOCK_AGGREGATE_STREAMS_ENABLED=1; exec node ./scripts/runDevApp.mjs",
          "dev:web":
            "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH NIX_LD NIX_LD_LIBRARY_PATH; export PORT=${PORT:-18747} BASE_PATH=${BASE_PATH:-/} VITE_PROXY_API_TARGET=${VITE_PROXY_API_TARGET:-http://127.0.0.1:8080}; exec vite --config vite.config.ts --host 0.0.0.0",
        },
      }),
    ),
    writeFile(
      path.join(apiDir, "package.json"),
      JSON.stringify({
        name: "@workspace/api-server",
        scripts: {
          build:
            "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH; node ./build.mjs",
          dev: "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH; export PORT=${PORT:-8080} NODE_ENV=development MALLOC_ARENA_MAX=${MALLOC_ARENA_MAX:-2} PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=${PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED:-false}; pnpm run build && exec node --enable-source-maps ./dist/index.mjs",
          start:
            "unset REPLIT_LD_LIBRARY_PATH LD_LIBRARY_PATH; exec node --enable-source-maps ./dist/index.mjs",
        },
      }),
    ),
    writeFile(
      path.join(ibkrDir, "package.json"),
      JSON.stringify({
        name: "@workspace/ibkr-session-host",
        scripts: {
          build: "node ./build.mjs",
          dev: "pnpm run build && pnpm run start",
          start: "node --enable-source-maps ./dist/index.mjs",
        },
      }),
    ),
    writeFile(
      path.join(viteDir, "package.json"),
      JSON.stringify({
        name: "vite",
        type: "module",
        exports: {
          "./package.json": "./package.json",
        },
      }),
    ),
    writeFile(
      viteBin,
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
const processGroup = Number(readFileSync("/proc/self/stat", "utf8").slice(readFileSync("/proc/self/stat", "utf8").lastIndexOf(")") + 2).trim().split(/\\s+/)[2]);
const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
appendFileSync(process.env.FAKE_ROLE_LOG, JSON.stringify({
  role: "web",
  pid: process.pid,
  ppid: process.ppid,
  processGroup,
  cwd: process.cwd(),
  descendantPid: descendant.pid,
  lifecycleEvent: process.env.npm_lifecycle_event,
  lifecycleScript: process.env.npm_lifecycle_script,
  packageName: process.env.npm_package_name,
  initCwd: process.env.INIT_CWD,
  ldLibraryPath: process.env.LD_LIBRARY_PATH ?? null,
  nixLd: process.env.NIX_LD ?? null,
}) + "\\n");
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`,
    ),
  ]);
  await chmod(viteBin, 0o755);
  await writeFile(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
appendFileSync(process.env.FAKE_BUILD_LOG, JSON.stringify({
  pid: process.pid,
  cwd: process.cwd(),
  args: process.argv.slice(2),
}) + "\\n");
const role = path.basename(process.cwd()) === "api-server"
  ? "api"
  : path.basename(process.cwd()) === "ibkr-session-host"
    ? "ibkr"
    : null;
if (!role || process.argv.slice(2).join(" ") !== "run build") {
  process.exit(64);
}
if (role === "api" && process.env.FAKE_LEAK_BUILD_HELPER === "1") {
  const helper = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
  helper.unref();
  appendFileSync(process.env.FAKE_HELPER_LOG, JSON.stringify({ pid: helper.pid }) + "\\n");
}
mkdirSync(path.join(process.cwd(), "dist"), { recursive: true });
writeFileSync(path.join(process.cwd(), "dist", "index.mjs"), [
  'import { spawn } from "node:child_process";',
  'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
  'import http from "node:http";',
  'const role = ' + JSON.stringify(role) + ';',
  'const stat = readFileSync("/proc/self/stat", "utf8");',
  'const processGroup = Number(stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\\\\s+/)[2]);',
  'const descendant = spawn(process.execPath, ["-e", "process.on(\\'SIGTERM\\',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });',
  'appendFileSync(process.env.FAKE_ROLE_LOG, JSON.stringify({ role, pid: process.pid, ppid: process.ppid, processGroup, cwd: process.cwd(), descendantPid: descendant.pid, lifecycleEvent: process.env.npm_lifecycle_event, lifecycleScript: process.env.npm_lifecycle_script, packageName: process.env.npm_package_name, initCwd: process.env.INIT_CWD, ldLibraryPath: process.env.LD_LIBRARY_PATH ?? null }) + "\\\\n");',
  'if (role === "api") http.createServer((_request, response) => {',
  '  writeFileSync(process.env.FAKE_HEALTH_REQUESTED, "1");',
  '  const timer = setInterval(() => {',
  '    if (!existsSync(process.env.FAKE_HEALTH_RELEASE)) return;',
  '    clearInterval(timer);',
  '    response.writeHead(200);',
  '    response.end("ok");',
  '  }, 5);',
  '}).listen(Number(process.env.PORT), "127.0.0.1");',
  'process.on("SIGTERM", () => {});',
  'setInterval(() => {}, 1_000);',
].join("\\n"));
`,
  );
  await chmod(path.join(binDir, "pnpm"), 0o755);
  await writeFile(
    path.join(binDir, "cargo"),
    `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { appendFileSync, readFileSync } = require("node:fs");
const stat = readFileSync("/proc/self/stat", "utf8");
const processGroup = Number(stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\\s+/)[2]);
const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
appendFileSync(process.env.FAKE_ROLE_LOG, JSON.stringify({
  role: "market",
  pid: process.pid,
  ppid: process.ppid,
  processGroup,
  cwd: process.cwd(),
  descendantPid: descendant.pid,
  lifecycleEvent: process.env.npm_lifecycle_event,
  lifecycleScript: process.env.npm_lifecycle_script,
  packageName: process.env.npm_package_name,
  initCwd: process.env.INIT_CWD,
}) + "\\n");
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`,
  );
  await chmod(path.join(binDir, "cargo"), 0o755);

  const staleListener = spawn(
    process.execPath,
    [
      "-e",
      "const server=require('node:net').createServer();server.listen(0,'127.0.0.1',()=>console.log(server.address().port));",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const [stalePortOutput] = await once(staleListener.stdout, "data");
  const stalePort = Number(String(stalePortOutput).trim());
  assert.ok(Number.isInteger(stalePort) && stalePort > 0);
  const staleListenerExit = once(staleListener, "exit");
  await delay(50);

  const launcher = spawn(process.execPath, [isolatedLauncherPath], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_BUILD_LOG: buildLog,
      FAKE_ROLE_LOG: roleLog,
      FAKE_HELPER_LOG: helperLog,
      FAKE_HEALTH_REQUESTED: healthRequested,
      FAKE_HEALTH_RELEASE: releaseHealth,
      PYRUS_API_PORT: String(apiPort),
      PYRUS_FRONTEND_PORT: String(stalePort),
      PYRUS_TEST_OWNED_PORTS: `${apiPort},${stalePort}`,
      DATABASE_URL: "postgres://test.invalid/test",
      MASSIVE_API_KEY: "test",
      IBKR_SESSION_HOST_ENABLED: "1",
      IBKR_SESSION_HOST_PORT: "18748",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let launcherStderr = "";
  launcher.stderr.setEncoding("utf8");
  launcher.stderr.on("data", (chunk) => {
    launcherStderr += chunk;
  });
  const launcherExit = new Promise((resolve) => {
    launcher.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let secondLauncher = null;

  t.after(async () => {
    for (const { pid } of await readJsonLines(roleLog)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }
    for (const { pid } of await readJsonLines(helperLog)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    try {
      launcher.kill("SIGKILL");
    } catch {}
    try {
      secondLauncher?.kill("SIGKILL");
    } catch {}
    try {
      staleListener.kill("SIGKILL");
    } catch {}
    await rm(tempDir, { recursive: true, force: true });
  });

  await Promise.race([
    staleListenerExit,
    delay(1_000).then(() => {
      throw new Error(
        `launcher did not replace the stale port listener: ${launcherStderr.trim()}`,
      );
    }),
  ]);
  await waitUntil(async () => {
    try {
      return (await readFile(healthRequested, "utf8")) === "1";
    } catch {
      return false;
    }
  }).catch((error) => {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${launcherStderr.trim()}`,
    );
  });
  await waitUntil(async () => {
    const roles = await readJsonLines(roleLog);
    return roles.some(({ role }) => role === "api") &&
      roles.some(({ role }) => role === "web") &&
      roles.some(({ role }) => role === "ibkr");
  });
  assert.equal(
    (await readJsonLines(roleLog)).some(({ role }) => role === "market"),
    false,
  );
  const builds = await readJsonLines(buildLog);
  assert.equal(builds.length, 2);
  assert.ok(builds.every(({ args }) => args.join(" ") === "run build"));
  assert.deepEqual(
    new Set(builds.map(({ cwd }) => cwd)),
    new Set([apiDir, ibkrDir]),
  );
  for (const { pid } of builds) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }

  await writeFile(releaseHealth, "1");
  await waitUntil(async () =>
    (await readJsonLines(roleLog)).some(({ role }) => role === "market"),
  );
  const roles = await readJsonLines(roleLog);
  const expectedRoleContract = {
    api: {
      cwd: apiDir,
      lifecycleEvent: "dev",
      packageName: "@workspace/api-server",
    },
    web: {
      cwd: pyrusDir,
      lifecycleEvent: "dev:web",
      packageName: "@workspace/pyrus",
    },
    ibkr: {
      cwd: ibkrDir,
      lifecycleEvent: "start",
      packageName: "@workspace/ibkr-session-host",
    },
    market: {
      cwd: isolatedRepo,
      lifecycleEvent: "market-data-worker:run",
      packageName: "workspace",
    },
  };
  for (const role of roles) {
    const expected = expectedRoleContract[role.role];
    assert.ok(expected);
    assert.equal(role.ppid, launcher.pid);
    assert.equal(role.processGroup, role.pid);
    assert.equal(role.cwd, expected.cwd);
    assert.equal(role.lifecycleEvent, expected.lifecycleEvent);
    assert.equal(role.packageName, expected.packageName);
    assert.equal(role.initCwd, isolatedRepo);
    assert.ok(role.lifecycleScript);
  }
  assert.equal(roles.find(({ role }) => role === "api").ldLibraryPath, null);
  assert.equal(roles.find(({ role }) => role === "web").ldLibraryPath, null);
  assert.equal(roles.find(({ role }) => role === "web").nixLd, null);

  launcher.kill("SIGHUP");
  await delay(100);
  assert.doesNotThrow(() => process.kill(launcher.pid, 0));
  for (const { pid } of roles) {
    assert.doesNotThrow(() => process.kill(pid, 0));
  }

  const shutdownStartedAt = Date.now();
  launcher.kill("SIGTERM");
  await delay(25);
  launcher.kill("SIGTERM");

  const exit = await Promise.race([
    launcherExit,
    delay(2_000).then(() => {
      throw new Error("repeated signal did not escalate shutdown within 2s");
    }),
  ]);
  assert.deepEqual(exit, { code: 143, signal: null });
  assert.ok(Date.now() - shutdownStartedAt < 2_000);
  await waitUntil(() =>
    roles.every(({ pid, descendantPid }) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if (error?.code !== "ESRCH") return false;
      }
      try {
        process.kill(descendantPid, 0);
        return false;
      } catch (error) {
        return error?.code === "ESRCH";
      }
    }),
  );

  const failedBuildLog = path.join(tempDir, "failed-builds.jsonl");
  const failedRoleLog = path.join(tempDir, "failed-roles.jsonl");
  const failedHelperLog = path.join(tempDir, "failed-helper.jsonl");
  const failedApiPort = await unusedPort();
  const failedWebPort = await unusedPort();
  secondLauncher = spawn(process.execPath, [isolatedLauncherPath], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_BUILD_LOG: failedBuildLog,
      FAKE_ROLE_LOG: failedRoleLog,
      FAKE_HELPER_LOG: failedHelperLog,
      FAKE_LEAK_BUILD_HELPER: "1",
      FAKE_HEALTH_REQUESTED: path.join(tempDir, "failed-health-requested"),
      FAKE_HEALTH_RELEASE: path.join(tempDir, "failed-health-release"),
      PYRUS_API_PORT: String(failedApiPort),
      PYRUS_FRONTEND_PORT: String(failedWebPort),
      PYRUS_TEST_OWNED_PORTS: `${failedApiPort},${failedWebPort}`,
      IBKR_SESSION_HOST_ENABLED: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let failedStderr = "";
  secondLauncher.stderr.setEncoding("utf8");
  secondLauncher.stderr.on("data", (chunk) => {
    failedStderr += chunk;
  });
  const failedExitPromise = once(secondLauncher, "exit");
  await waitUntil(async () => (await readJsonLines(failedHelperLog)).length > 0);
  const [failedCode, failedSignal] = await Promise.race([
    failedExitPromise,
    delay(8_000).then(() => {
      throw new Error("build-helper rejection did not stop the launcher");
    }),
  ]);
  assert.deepEqual({ code: failedCode, signal: failedSignal }, {
    code: 1,
    signal: null,
  });
  assert.match(failedStderr, /unexpected build-group member/i);
  for (const { pid } of await readJsonLines(failedHelperLog)) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
});
