#!/usr/bin/env node
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const rawPort = process.env.PORT;
if (!rawPort) {
  console.error("[reapDevPort] PORT env var not set; skipping reap.");
  process.exit(0);
}
const port = Number(rawPort);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`[reapDevPort] Invalid PORT value '${rawPort}'; skipping reap.`);
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
          `[reapDevPort] Failed to send ${signal} to ${pid}: ${err.message}`,
        );
      }
    }
  }
}

const initialInodes = inodesListeningOnPort();
if (initialInodes.size === 0) {
  process.exit(0);
}

const pids = pidsHoldingInodes(initialInodes);
if (pids.size === 0) {
  console.warn(
    `[reapDevPort] Port ${port} is held but the owning PID is not in /proc (likely owned by another user). Letting strictPort surface the conflict.`,
  );
  process.exit(0);
}

console.warn(
  `[reapDevPort] Port ${port} held by orphan PIDs: ${[...pids].map(describePid).join(", ")}. Reaping...`,
);

killPids(pids, "SIGTERM");

const start = Date.now();
const deadline = start + 2_000;
while (Date.now() < deadline) {
  const remaining = inodesListeningOnPort();
  if (remaining.size === 0) {
    console.warn(
      `[reapDevPort] Port ${port} freed after SIGTERM in ${Date.now() - start}ms.`,
    );
    process.exit(0);
  }
  execSync("sleep 0.1");
}

const stragglers = pidsHoldingInodes(inodesListeningOnPort());
if (stragglers.size > 0) {
  console.warn(
    `[reapDevPort] Port ${port} still held after SIGTERM; sending SIGKILL to: ${[...stragglers].join(", ")}.`,
  );
  killPids(stragglers, "SIGKILL");
  execSync("sleep 0.3");
}

const finalInodes = inodesListeningOnPort();
if (finalInodes.size === 0) {
  console.warn(`[reapDevPort] Port ${port} freed.`);
  process.exit(0);
}

console.error(
  `[reapDevPort] Failed to free port ${port}; vite will fail with EADDRINUSE (strictPort).`,
);
process.exit(0);
