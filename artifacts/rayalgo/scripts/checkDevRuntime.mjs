#!/usr/bin/env node

import { execFileSync } from "node:child_process";
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

const snapshot = {
  checkedAt: new Date().toISOString(),
  packageRoot: path.relative(repoRoot, packageRoot),
  canonicalFrontendPort,
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
  nonCanonicalFrontendListeners,
  distIndex,
  distStaleAgainstSources,
  viteCache: describePathStatus(path.join(packageRoot, "node_modules/.vite")),
  chartSurfaceFingerprint,
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
    `chart surface: ${chartSurfaceFingerprint.version || "missing"} (${chartSurfaceFingerprint.sourcePath})`,
  );
  console.log(`rayalgo vite servers: ${rayalgoViteServers.length}`);
  for (const server of rayalgoViteServers) {
    console.log(
      `- pid ${server.pid} ${server.kind} cwd=${server.cwdRelative} PORT=${server.port || ""} BASE_PATH=${server.basePath || ""} proxy=${server.proxyApiTarget}`,
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
