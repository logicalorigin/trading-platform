#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const strict = process.argv.includes("--strict");
const jsonOnly = process.argv.includes("--json");
const canonicalFrontendPort = String(
  process.env.RAYALGO_FRONTEND_PORT || process.env.PORT || "18747",
);
const canonicalApiPort = String(process.env.RAYALGO_API_PORT || "8080");
const canonicalBasePath = process.env.BASE_PATH || "/";
const commandEnv = { ...process.env };
delete commandEnv.LD_LIBRARY_PATH;
delete commandEnv.NIX_LD;
delete commandEnv.NIX_LD_LIBRARY_PATH;
delete commandEnv.REPLIT_LD_AUDIT;
delete commandEnv.REPLIT_LD_LIBRARY_PATH;

const readTextCommand = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      env: commandEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
};

const runTextCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || commandEnv,
    encoding: "utf8",
    timeout: options.timeout || 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || null,
  };
};

const probeHttpJson = (url) => {
  const result = runTextCommand("curl", ["-fsS", url], { timeout: 3_000 });
  let json = null;
  try {
    json = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {}
  return {
    url,
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    body: result.stdout.trim(),
    json,
    error: result.error || result.stderr.trim() || null,
  };
};

const readProcLink = (pid, name) => {
  try {
    return readlinkSync(`/proc/${pid}/${name}`);
  } catch {
    return null;
  }
};

const readProcEnv = (pid) => {
  try {
    return Object.fromEntries(
      readFileSync(`/proc/${pid}/environ`, "utf8")
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("=");
          return separator === -1
            ? [entry, ""]
            : [entry.slice(0, separator), entry.slice(separator + 1)];
        }),
    );
  } catch {
    return {};
  }
};

const parseProcessList = () => {
  const output = readTextCommand("ps", ["-eo", "pid,ppid,etime,cmd"]);
  return output
    .split("\n")
    .slice(1)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      const [, pid, ppid, etime, cmd] = match;
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        etime,
        cmd,
      };
    })
    .filter(Boolean);
};

const describePathStatus = (targetPath) => {
  if (!existsSync(targetPath)) {
    return { exists: false, path: path.relative(repoRoot, targetPath) };
  }
  const stat = statSync(targetPath);
  return {
    exists: true,
    path: path.relative(repoRoot, targetPath),
    mtime: stat.mtime.toISOString(),
    bytes: stat.size,
  };
};

const parseReplitPorts = () => {
  const replitPath = path.join(repoRoot, ".replit");
  if (!existsSync(replitPath)) {
    return [];
  }
  const ports = [];
  let current = null;
  for (const line of readFileSync(replitPath, "utf8").split("\n")) {
    if (/^\s*\[\[ports\]\]\s*$/.test(line)) {
      if (current) ports.push(current);
      current = {};
      continue;
    }
    if (!current) continue;
    const localMatch = line.match(/^\s*localPort\s*=\s*(\d+)/);
    if (localMatch) {
      current.localPort = Number(localMatch[1]);
      continue;
    }
    const externalMatch = line.match(/^\s*externalPort\s*=\s*(\d+)/);
    if (externalMatch) {
      current.externalPort = Number(externalMatch[1]);
    }
  }
  if (current) ports.push(current);
  return ports
    .filter((port) => Number.isFinite(port.localPort))
    .sort((left, right) => left.localPort - right.localPort);
};

const readCmdline = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")
      .filter(Boolean)
      .join(" ");
  } catch {
    return "";
  }
};

const decodeIpv4Address = (hexAddress) =>
  hexAddress
    .match(/../g)
    ?.reverse()
    .map((part) => String(Number.parseInt(part, 16)))
    .join(".") || hexAddress;

const readTcpListenerRows = (filePath, protocol) => {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts[3] !== "0A") {
        return null;
      }
      const [rawAddress, rawPort] = parts[1].split(":");
      return {
        protocol,
        address:
          protocol === "tcp4" ? decodeIpv4Address(rawAddress) : rawAddress,
        port: Number.parseInt(rawPort, 16),
        inode: parts[9],
      };
    })
    .filter(Boolean);
};

const mapSocketInodesToProcesses = () => {
  const processesByInode = new Map();
  for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
    let fds = [];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link = "";
      try {
        link = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = link.match(/^socket:\[(\d+)\]$/);
      if (!match) {
        continue;
      }
      if (!processesByInode.has(match[1])) {
        processesByInode.set(match[1], []);
      }
      processesByInode.get(match[1]).push({
        pid: Number(pid),
        cmd: readCmdline(pid),
      });
    }
  }
  return processesByInode;
};

const readListeningPorts = () => {
  const processesByInode = mapSocketInodesToProcesses();
  return [
    ...readTcpListenerRows("/proc/net/tcp", "tcp4"),
    ...readTcpListenerRows("/proc/net/tcp6", "tcp6"),
  ]
    .map((listener) => ({
      ...listener,
      processes: processesByInode.get(listener.inode) || [],
    }))
    .sort((left, right) => left.port - right.port);
};

const readChartSurfaceFingerprint = () => {
  const sourcePath = path.join(
    packageRoot,
    "src/features/charting/ResearchChartSurface.tsx",
  );
  try {
    const source = readFileSync(sourcePath, "utf8");
    const match = source.match(
      /RESEARCH_CHART_SURFACE_MODULE_VERSION\s*=\s*[\r\n\s]*["']([^"']+)["']/,
    );
    return {
      sourcePath: path.relative(repoRoot, sourcePath),
      version: match?.[1] || null,
    };
  } catch {
    return {
      sourcePath: path.relative(repoRoot, sourcePath),
      version: null,
    };
  }
};

const sanitizeDatabaseOutput = (text = "") =>
  text.replace(
    /(postgres(?:ql)?:\/\/)[^@\s]+@/gi,
    (_match, prefix) => `${prefix}***@`,
  );

const describeDatabaseUrl = () => {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return {
      configured: false,
      protocol: null,
      host: null,
      port: null,
      database: null,
      user: null,
      sslMode: null,
    };
  }

  try {
    const url = new URL(raw);
    return {
      configured: true,
      protocol: url.protocol.replace(/:$/, ""),
      host: url.hostname || null,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, "") || null,
      user: url.username ? `${url.username.slice(0, 2)}***` : null,
      sslMode:
        url.searchParams.get("sslmode") ||
        url.searchParams.get("ssl") ||
        "unspecified",
    };
  } catch (error) {
    return {
      configured: true,
      protocol: null,
      host: null,
      port: null,
      database: null,
      user: null,
      sslMode: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
};

const readDatabaseReachability = () => {
  const database = describeDatabaseUrl();
  if (!process.env.DATABASE_URL || database.parseError) {
    return {
      ...database,
      reachable: false,
      probe: null,
    };
  }

  const probe = runTextCommand("pg_isready", [
    "-d",
    process.env.DATABASE_URL,
    "-t",
    "3",
  ]);
  return {
    ...database,
    reachable: probe.status === 0,
    probe: {
      command: "pg_isready -d DATABASE_URL -t 3",
      status: probe.status,
      signal: probe.signal,
      output: sanitizeDatabaseOutput(`${probe.stdout}${probe.stderr}`).trim(),
      error: probe.error,
    },
  };
};

const readReplitPlaywrightStatus = () => {
  const prepareScript = path.join(
    packageRoot,
    "scripts/preparePlaywrightChromium.mjs",
  );
  const command = "pnpm --filter @workspace/rayalgo run test:e2e:replit";
  if (!existsSync(prepareScript)) {
    return {
      command,
      prepared: false,
      executable: null,
      error: "preparePlaywrightChromium.mjs was not found",
      directLaunchRisk: true,
    };
  }

  const result = runTextCommand(process.execPath, [prepareScript], {
    cwd: packageRoot,
    env: commandEnv,
    timeout: 20_000,
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  return {
    command,
    prepared: result.status === 0,
    executable: result.status === 0 ? result.stdout.trim() || null : null,
    error: result.status === 0 ? null : output || result.error,
    directLaunchRisk: Boolean(
      process.env.LD_LIBRARY_PATH ||
        process.env.REPLIT_LD_LIBRARY_PATH ||
        process.env.NIX_LD ||
        process.env.NIX_LD_LIBRARY_PATH,
    ),
  };
};

const isDistOlderThanRuntimeSources = (distStatus) => {
  if (!distStatus.exists) {
    return false;
  }
  const distMtime = statSync(path.join(repoRoot, distStatus.path)).mtimeMs;
  const sourcePaths = [
    path.join(packageRoot, "package.json"),
    path.join(packageRoot, "vite.config.ts"),
    path.join(packageRoot, "src/main.tsx"),
    path.join(packageRoot, "src/features/charting/ResearchChartSurface.tsx"),
    path.join(packageRoot, "src/features/trade/TradeEquityPanel.jsx"),
  ];
  return sourcePaths.some((sourcePath) => {
    try {
      return statSync(sourcePath).mtimeMs > distMtime;
    } catch {
      return false;
    }
  });
};

const processes = parseProcessList();
const isViteServerCommand = (command) =>
  /(?:^|[\/\s])vite(?:\.js)?(?:\s|$)/.test(command) ||
  command.includes("/vite/bin/vite.js");

const viteServers = processes
  .filter((processInfo) => {
    const command = processInfo.cmd;
    return (
      isViteServerCommand(command) &&
      /vite\.config\.ts/.test(command) &&
      !command.includes("checkDevRuntime.mjs")
    );
  })
  .map((processInfo) => {
    const cwd = readProcLink(processInfo.pid, "cwd");
    const env = readProcEnv(processInfo.pid);
    return {
      ...processInfo,
      cwd,
      cwdRelative: cwd ? path.relative(repoRoot, cwd) || "." : null,
      kind: processInfo.cmd.includes("preview") ? "preview" : "dev",
      port: env.PORT || null,
      basePath: env.BASE_PATH || null,
      proxyApiTarget: env.VITE_PROXY_API_TARGET || "http://127.0.0.1:8080",
      nodeEnv: env.NODE_ENV || null,
      loaderEnv: {
        hasLdLibraryPath: Boolean(env.LD_LIBRARY_PATH),
        hasReplitLdLibraryPath: Boolean(env.REPLIT_LD_LIBRARY_PATH),
        hasNixLd: Boolean(env.NIX_LD || env.NIX_LD_LIBRARY_PATH),
      },
    };
  });

const rayalgoViteServers = viteServers.filter(
  (server) => server.cwd && path.resolve(server.cwd) === packageRoot,
);

const warnings = [];
const failures = [];

if (rayalgoViteServers.length !== 1) {
  const message = `expected exactly one Rayalgo Vite server, found ${rayalgoViteServers.length}`;
  warnings.push(message);
  if (strict) failures.push(message);
}

for (const server of rayalgoViteServers) {
  if (!server.port) {
    const message = `Vite server ${server.pid} is missing PORT`;
    warnings.push(message);
    if (strict) failures.push(message);
  }
  if (!server.basePath) {
    const message = `Vite server ${server.pid} is missing BASE_PATH`;
    warnings.push(message);
    if (strict) failures.push(message);
  }
  if (server.kind !== "dev") {
    warnings.push(`Vite server ${server.pid} is running ${server.kind}, not dev`);
  }
  if (server.port && String(server.port) !== canonicalFrontendPort) {
    const message = `Vite server ${server.pid} is on PORT=${server.port}; canonical Rayalgo frontend port is ${canonicalFrontendPort}`;
    warnings.push(message);
    if (strict) failures.push(message);
  }
  if (server.basePath && server.basePath !== canonicalBasePath) {
    const message = `Vite server ${server.pid} has BASE_PATH=${server.basePath}; canonical base path is ${canonicalBasePath}`;
    warnings.push(message);
    if (strict) failures.push(message);
  }
  if (
    server.loaderEnv.hasLdLibraryPath ||
    server.loaderEnv.hasReplitLdLibraryPath ||
    server.loaderEnv.hasNixLd
  ) {
    warnings.push(
      `Vite server ${server.pid} inherited Replit/Nix loader env; restart with the sanitized package script`,
    );
  }
}

const projectPorts = parseReplitPorts();
const listeningPorts = readListeningPorts();
const listeningProjectPorts = projectPorts
  .map((port) => ({
    ...port,
    listeners: listeningPorts.filter((listener) => listener.port === port.localPort),
  }))
  .filter((port) => port.listeners.length > 0);
const apiListeners = listeningPorts.filter(
  (listener) => String(listener.port) === canonicalApiPort,
);
const apiListenerProcesses = apiListeners
  .flatMap((listener) => listener.processes)
  .map((processInfo) => {
    const cwd = readProcLink(processInfo.pid, "cwd");
    return {
      ...processInfo,
      cwd,
      cwdRelative: cwd ? path.relative(repoRoot, cwd) || "." : null,
    };
  });
const apiServerProcesses = apiListenerProcesses.filter(
  (processInfo) =>
    processInfo.cwdRelative === "artifacts/api-server" ||
    processInfo.cmd.includes("artifacts/api-server/dist/index.mjs") ||
    processInfo.cmd.includes("artifacts/api-server/node_modules") ||
    (processInfo.cmd.includes("./dist/index.mjs") &&
      processInfo.cwdRelative === "artifacts/api-server"),
);
const apiHealth =
  apiServerProcesses.length > 0
    ? probeHttpJson(`http://127.0.0.1:${canonicalApiPort}/api/healthz`)
    : {
        url: `http://127.0.0.1:${canonicalApiPort}/api/healthz`,
        ok: false,
        status: null,
        signal: null,
        body: "",
        json: null,
        error: "api server is not listening",
      };
const nonCanonicalFrontendListeners = listeningProjectPorts.filter(
  (port) =>
    String(port.localPort) !== canonicalFrontendPort &&
    port.localPort !== 8080 &&
    port.listeners.some((listener) =>
      listener.processes.some((processInfo) =>
        /vite|webpack|next|react-scripts|preview/i.test(processInfo.cmd),
      ),
    ),
);

for (const port of nonCanonicalFrontendListeners) {
  const message = `non-canonical frontend listener on local port ${port.localPort} (external ${port.externalPort ?? "n/a"})`;
  warnings.push(message);
  if (strict) failures.push(message);
}

if (rayalgoViteServers.length > 0 && apiServerProcesses.length !== 1) {
  const message = `expected exactly one Rayalgo API server on ${canonicalApiPort}, found ${apiServerProcesses.length}`;
  warnings.push(message);
  if (strict) failures.push(message);
}

if (apiServerProcesses.length > 0 && !apiHealth.ok) {
  const message = `Rayalgo API health probe failed at ${apiHealth.url}${apiHealth.error ? `: ${apiHealth.error}` : ""}`;
  warnings.push(message);
  if (strict) failures.push(message);
} else if (
  apiHealth.ok &&
  apiHealth.json &&
  apiHealth.json.status !== "ok"
) {
  const message = `Rayalgo API health probe returned unexpected status ${JSON.stringify(apiHealth.json)}`;
  warnings.push(message);
  if (strict) failures.push(message);
}

const distIndex = describePathStatus(path.join(packageRoot, "dist/public/index.html"));
if (distIndex.exists) {
  warnings.push(
    `built dist is present at ${distIndex.path}; verify previews use Vite dev when debugging HMR`,
  );
}
const distStaleAgainstSources = isDistOlderThanRuntimeSources(distIndex);
if (distStaleAgainstSources) {
  warnings.push(
    `built dist at ${distIndex.path} is older than current runtime/chart sources`,
  );
}

const chartSurfaceFingerprint = readChartSurfaceFingerprint();
if (!chartSurfaceFingerprint.version) {
  const message = "ResearchChartSurface runtime fingerprint was not found";
  warnings.push(message);
  if (strict) failures.push(message);
}

const databaseReachability = readDatabaseReachability();
if (!databaseReachability.configured) {
  warnings.push(
    "DATABASE_URL is not set; DB-backed persistence, signal monitor, and diagnostics are unavailable",
  );
} else if (databaseReachability.parseError) {
  warnings.push(`DATABASE_URL could not be parsed: ${databaseReachability.parseError}`);
} else if (!databaseReachability.reachable) {
  warnings.push(
    `Postgres is unreachable at ${databaseReachability.host}:${databaseReachability.port}/${databaseReachability.database}; DB-backed persistence and signal workers should degrade while IBKR transport can remain connected`,
  );
}

const browserVerification = readReplitPlaywrightStatus();
if (!browserVerification.prepared) {
  warnings.push(
    `Replit Playwright Chromium could not be prepared; use ${browserVerification.command} after installing Chromium and checking Nix browser libraries`,
  );
}

const snapshot = {
  checkedAt: new Date().toISOString(),
  packageRoot: path.relative(repoRoot, packageRoot),
  canonicalFrontendPort,
  canonicalApiPort,
  canonicalBasePath,
  canonicalLocalUrl: `http://127.0.0.1:${canonicalFrontendPort}${canonicalBasePath}`,
  gitSha:
    readTextCommand("git", ["rev-parse", "--short=12", "HEAD"]).trim() ||
    "unknown",
  gitBranch:
    readTextCommand("git", ["branch", "--show-current"]).trim() || "unknown",
  gitDirty: readTextCommand("git", ["status", "--short"]).trim().length > 0,
  viteServers,
  rayalgoViteServers,
  projectPorts,
  listeningProjectPorts,
  apiServerProcesses,
  apiHealth,
  nonCanonicalFrontendListeners,
  distIndex,
  distStaleAgainstSources,
  viteCache: describePathStatus(path.join(packageRoot, "node_modules/.vite")),
  chartSurfaceFingerprint,
  databaseReachability,
  browserVerification,
  warnings,
  failures,
};

if (jsonOnly) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  console.log(`Rayalgo runtime check (${snapshot.checkedAt})`);
  console.log(`repo: ${snapshot.gitBranch}@${snapshot.gitSha}${snapshot.gitDirty ? " dirty" : ""}`);
  console.log(`canonical local url: ${snapshot.canonicalLocalUrl}`);
  console.log(
    `api server: ${apiServerProcesses.length ? "listening" : "missing"} ${apiHealth.url}`,
  );
  if (apiHealth.error && !apiHealth.ok) {
    console.log(`api probe: ${apiHealth.error}`);
  }
  console.log(
    `chart surface: ${chartSurfaceFingerprint.version || "missing"} (${chartSurfaceFingerprint.sourcePath})`,
  );
  if (databaseReachability.configured) {
    console.log(
      `postgres: ${databaseReachability.reachable ? "reachable" : "unreachable"} ${databaseReachability.host || "unknown"}:${databaseReachability.port || "unknown"}/${databaseReachability.database || "unknown"} ssl=${databaseReachability.sslMode || "unknown"}`,
    );
    if (databaseReachability.probe?.output) {
      console.log(`postgres probe: ${databaseReachability.probe.output}`);
    }
  } else {
    console.log("postgres: DATABASE_URL not set");
  }
  console.log(
    `browser verification: ${browserVerification.prepared ? "patched chromium ready" : "patched chromium unavailable"}; command=${browserVerification.command}`,
  );
  console.log(`rayalgo vite servers: ${rayalgoViteServers.length}`);
  for (const server of rayalgoViteServers) {
    console.log(
      `- pid ${server.pid} ${server.kind} cwd=${server.cwdRelative} PORT=${server.port || ""} BASE_PATH=${server.basePath || ""} proxy=${server.proxyApiTarget}`,
    );
  }
  console.log(`rayalgo api servers: ${apiServerProcesses.length}`);
  for (const server of apiServerProcesses) {
    console.log(
      `- pid ${server.pid} cwd=${server.cwdRelative} ${server.cmd}`,
    );
  }
  if (viteServers.length !== rayalgoViteServers.length) {
    console.log(`other vite servers: ${viteServers.length - rayalgoViteServers.length}`);
  }
  if (listeningProjectPorts.length) {
    console.log("listening project ports:");
    for (const port of listeningProjectPorts) {
      const processesText = port.listeners
        .flatMap((listener) =>
          listener.processes.map((processInfo) => processInfo.cmd || processInfo.pid),
        )
        .filter(Boolean)
        .join(" | ");
      console.log(
        `- local ${port.localPort} -> external ${port.externalPort ?? "n/a"} ${processesText}`,
      );
    }
  }
  if (warnings.length) {
    console.log("warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

if (failures.length) {
  process.exitCode = 1;
}
