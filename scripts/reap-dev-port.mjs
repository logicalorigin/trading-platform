#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

const logPrefix = "[reapDevPort]";

const rawPort = process.env.PORT;
if (!rawPort) {
  console.error(`${logPrefix} PORT env var not set; skipping reap.`);
  process.exit(0);
}

const port = Number(rawPort);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`${logPrefix} Invalid PORT value '${rawPort}'; skipping reap.`);
  process.exit(0);
}

const myPid = process.pid;
const myPpid = process.ppid;

const portHex = port.toString(16).toUpperCase().padStart(4, "0");
const portSuffix = `:${portHex}`;

function inodesListeningOnPort() {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const localAddr = parts[1];
      const state = parts[3];
      const inode = parts[9];
      if (state !== "0A") continue;
      if (!localAddr || !localAddr.endsWith(portSuffix)) continue;
      inodes.add(inode);
    }
  }
  return inodes;
}

function pidsHoldingInodes(inodes) {
  if (inodes.size === 0) return new Set();
  const pids = new Set();
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return pids;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === myPid || pid === myPpid) continue;
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
      const m = target.match(/^socket:\[(\d+)\]$/);
      if (m && inodes.has(m[1])) {
        pids.add(pid);
        break;
      }
    }
  }
  return pids;
}

function readCgroup(pid) {
  try {
    return readFileSync(`/proc/${pid}/cgroup`, "utf8").trim();
  } catch {
    return null;
  }
}

const myCgroup = readCgroup(process.pid);
const runningInsideReplitWorkflow =
  process.env.REPLIT_MODE === "workflow" ||
  process.env.PYRUS_REPLIT_RUN === "1" ||
  process.env.RAYALGO_REPLIT_RUN === "1";

// Returns pids that share our cgroup (safe to reap) vs pids in a different
// cgroup (usually a separate supervised service).
function partitionByCgroup(pids) {
  const sameCgroup = new Set();
  const foreignCgroup = new Map(); // pid -> cgroup string
  for (const pid of pids) {
    const cg = readCgroup(pid);
    if (myCgroup && cg && cg === myCgroup) {
      sameCgroup.add(pid);
    } else {
      foreignCgroup.set(pid, cg ?? "<unknown>");
    }
  }
  return { sameCgroup, foreignCgroup };
}

function describePid(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replaceAll("\0", " ")
      .trim();
    return `${pid} (${cmd.slice(0, 120)})`;
  } catch {
    return String(pid);
  }
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (err) {
      if (err && err.code !== "ESRCH") {
        console.warn(
          `${logPrefix} Failed to send ${signal} to ${pid}: ${err.message}`,
        );
      }
    }
  }
}

function waitForPortToFree(timeoutMs) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = inodesListeningOnPort();
    if (remaining.size === 0) {
      return Date.now() - start;
    }
    execSync("sleep 0.1");
  }
  return null;
}

const initialInodes = inodesListeningOnPort();
if (initialInodes.size === 0) {
  process.exit(0);
}

const pids = pidsHoldingInodes(initialInodes);
if (pids.size === 0) {
  console.warn(
    `${logPrefix} Port ${port} is held but the owning PID is not in /proc (likely owned by another user). Letting the dev server surface the conflict.`,
  );
  process.exit(0);
}

const { sameCgroup, foreignCgroup } = partitionByCgroup(pids);

if (foreignCgroup.size > 0) {
  if (runningInsideReplitWorkflow) {
    const replaceablePids = new Set(foreignCgroup.keys());
    console.warn(
      `${logPrefix} Port ${port} is held by PID(s) from another Replit execution scope: ${[...replaceablePids].map(describePid).join(", ")}. Replacing them because this command is running inside a Replit workflow...`,
    );
    killPids(replaceablePids, "SIGTERM");

    const elapsed = waitForPortToFree(2_000);
    if (elapsed !== null) {
      console.warn(
        `${logPrefix} Port ${port} freed after replacing previous Replit execution in ${elapsed}ms.`,
      );
      process.exit(0);
    }

    const remainingReplaceablePids = new Set(
      [...pidsHoldingInodes(inodesListeningOnPort())].filter((pid) =>
        replaceablePids.has(pid),
      ),
    );
    if (remainingReplaceablePids.size > 0) {
      console.warn(
        `${logPrefix} Port ${port} still held after SIGTERM; sending SIGKILL to previous Replit execution PID(s): ${[...remainingReplaceablePids].join(", ")}.`,
      );
      killPids(remainingReplaceablePids, "SIGKILL");
      execSync("sleep 0.3");
    }

    if (inodesListeningOnPort().size === 0) {
      console.warn(`${logPrefix} Port ${port} freed.`);
      process.exit(0);
    }
  }

  const lines = [];
  for (const [pid, cg] of foreignCgroup) {
    lines.push(`  ${describePid(pid)} cgroup=${cg}`);
  }
  console.error(
    `${logPrefix} Refusing to reap port ${port}: it is held by a process in a different cgroup. Shell-launched dev commands must not kill the live Replit workflow; only commands already running inside a Replit workflow may reclaim a foreign execution scope on their pinned port.\n${logPrefix} Holder(s):\n${lines.join("\n")}\n${logPrefix} My cgroup: ${myCgroup ?? "<unknown>"}\n${logPrefix} Current REPLIT_MODE: ${process.env.REPLIT_MODE ?? "<unset>"}\n${logPrefix} Current PYRUS_REPLIT_RUN: ${process.env.PYRUS_REPLIT_RUN ?? "<unset>"}\n${logPrefix} Current RAYALGO_REPLIT_RUN: ${process.env.RAYALGO_REPLIT_RUN ?? "<unset>"}\n${logPrefix} If you meant to restart the live app, use the Replit workflow restart action. Exiting non-zero so the dev server fails fast with EADDRINUSE.`,
  );
  process.exit(1);
}

if (sameCgroup.size === 0) {
  // Defensive: should not happen, but exit cleanly if classification produced nothing.
  process.exit(0);
}

console.warn(
  `${logPrefix} Port ${port} held by orphan PIDs in our cgroup: ${[...sameCgroup].map(describePid).join(", ")}. Reaping...`,
);

killPids(sameCgroup, "SIGTERM");

const elapsed = waitForPortToFree(2_000);
if (elapsed !== null) {
  console.warn(
    `${logPrefix} Port ${port} freed after SIGTERM in ${elapsed}ms.`,
  );
  process.exit(0);
}

const stragglerPids = pidsHoldingInodes(inodesListeningOnPort());
const stragglers = partitionByCgroup(stragglerPids).sameCgroup;
if (stragglers.size > 0) {
  console.warn(
    `${logPrefix} Port ${port} still held after SIGTERM; sending SIGKILL to: ${[...stragglers].join(", ")}.`,
  );
  killPids(stragglers, "SIGKILL");
  execSync("sleep 0.3");
}

const finalInodes = inodesListeningOnPort();
if (finalInodes.size === 0) {
  console.warn(`${logPrefix} Port ${port} freed.`);
  process.exit(0);
}

console.error(
  `${logPrefix} Failed to free port ${port}; the dev server should fail with EADDRINUSE.`,
);
process.exit(0);
