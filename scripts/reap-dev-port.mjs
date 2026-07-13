#!/usr/bin/env node
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  hasPyrusWorkflowAncestry,
  isPid2OwnedReplitWorkflow,
  parseProcStat,
} from "./replit-process-authority.mjs";

const LOG_PREFIX = "[reapDevPort]";
const CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export function safeDisplay(value, maxCodePoints = 300) {
  const clean = stripVTControlCharacters(String(value ?? ""))
    .replace(CONTROL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const points = Array.from(clean);
  return points.length > maxCodePoints
    ? `${points.slice(0, maxCodePoints).join("")}…`
    : clean;
}

export function parsePort(rawPort) {
  if (!/^[0-9]+$/u.test(rawPort ?? "")) {
    throw new Error("PORT must be a decimal integer from 1 through 65535");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a decimal integer from 1 through 65535");
  }
  return port;
}

function setsIntersect(...sets) {
  const [first, ...rest] = sets;
  if (!first) return false;
  for (const value of first) {
    if (rest.every((set) => set?.has(value))) return true;
  }
  return false;
}

export function holderIdentityMatches(expected, current, listeningInodes) {
  return (
    Number.isSafeInteger(expected?.pid) &&
    expected.pid === current?.pid &&
    typeof expected.startTimeTicks === "string" &&
    expected.startTimeTicks === current.startTimeTicks &&
    typeof expected.cgroup === "string" &&
    expected.cgroup !== "" &&
    expected.cgroup === current.cgroup &&
    setsIntersect(expected.socketInodes, current.socketInodes, listeningInodes)
  );
}

function socketInodesForPid(pid, candidateInodes, readDir, readLink) {
  let fds;
  try {
    fds = readDir(`/proc/${pid}/fd`);
  } catch {
    return null;
  }
  const found = new Set();
  for (const fd of fds) {
    try {
      const match = /^socket:\[(\d+)\]$/u.exec(
        readLink(`/proc/${pid}/fd/${fd}`),
      );
      if (match && candidateInodes.has(match[1])) found.add(match[1]);
    } catch {
      // File descriptors can close during inspection; stable identity is
      // revalidated immediately before every signal.
    }
  }
  return found;
}

export function createProcInspector({
  readFile = readFileSync,
  readDir = readdirSync,
  readLink = readlinkSync,
} = {}) {
  function listeningInodes(port) {
    const suffix = `:${port.toString(16).toUpperCase().padStart(4, "0")}`;
    const inodes = new Set();
    let inspectedTables = 0;
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text;
      try {
        text = readFile(file, "utf8");
        inspectedTables += 1;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        return null;
      }
      for (const line of text.split("\n").slice(1)) {
        const fields = line.trim().split(/\s+/u);
        if (
          fields.length >= 10 &&
          fields[3] === "0A" &&
          fields[1]?.endsWith(suffix)
        ) {
          inodes.add(fields[9]);
        }
      }
    }
    return inspectedTables > 0 ? inodes : null;
  }

  function readCgroup(pid) {
    try {
      return readFile(`/proc/${pid}/cgroup`, "utf8").trim() || null;
    } catch {
      return null;
    }
  }

  function readHolder(pid, socketInodes) {
    let stat;
    let command = "";
    try {
      stat = parseProcStat(readFile(`/proc/${pid}/stat`, "utf8"));
      command = readFile(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      stat = null;
    }
    return {
      pid,
      startTimeTicks: stat?.startTimeTicks ?? null,
      cgroup: readCgroup(pid),
      socketInodes,
      command: safeDisplay(command.replaceAll("\0", " "), 120),
    };
  }

  function findHolders(inodes, excludedPids = new Set()) {
    let entries;
    try {
      entries = readDir("/proc");
    } catch {
      return null;
    }
    const holders = [];
    for (const entry of entries) {
      if (!/^\d+$/u.test(entry)) continue;
      const pid = Number(entry);
      if (excludedPids.has(pid)) continue;
      const socketInodes = socketInodesForPid(pid, inodes, readDir, readLink);
      if (socketInodes?.size > 0) holders.push(readHolder(pid, socketInodes));
    }
    return holders;
  }

  function revalidateHolder(expected, port) {
    const currentListening = listeningInodes(port);
    if (!currentListening) return false;
    const socketInodes = socketInodesForPid(
      expected.pid,
      currentListening,
      readDir,
      readLink,
    );
    if (!socketInodes) return false;
    return holderIdentityMatches(
      expected,
      readHolder(expected.pid, socketInodes),
      currentListening,
    );
  }

  return {
    listeningInodes,
    findHolders,
    readCgroup,
    hasPyrusWorkflowAncestry: (pid) =>
      hasPyrusWorkflowAncestry(pid, { readFile, readLink }),
    revalidateHolder,
  };
}

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPortToFree({ proc, port, timeoutMs, now, sleep }) {
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  while (now() < deadline) {
    const inodes = proc.listeningInodes(port);
    if (inodes === null) return { state: "unavailable" };
    if (inodes.size === 0) {
      return { state: "freed", elapsedMs: Math.max(0, now() - startedAt) };
    }
    sleep(Math.min(100, Math.max(1, deadline - now())));
  }
  const inodes = proc.listeningInodes(port);
  if (inodes === null) return { state: "unavailable" };
  return inodes.size === 0
    ? { state: "freed", elapsedMs: Math.max(0, now() - startedAt) }
    : { state: "occupied" };
}

function describeHolder(holder) {
  return `${holder.pid} (${safeDisplay(holder.command || "unknown", 120)}) cgroup=${safeDisplay(holder.cgroup || "<unknown>", 300)}`;
}

function portIsConfirmedFree(proc, port) {
  return proc.listeningInodes(port)?.size === 0;
}

function sendValidatedSignals({ targets, signal, port, proc, kill, warn }) {
  if (!targets.every((holder) => proc.revalidateHolder(holder, port))) {
    return 0;
  }
  let sent = 0;
  for (const holder of targets) {
    if (!proc.revalidateHolder(holder, port)) continue;
    try {
      // ponytail: Node exposes no pidfd signal primitive; revalidate the PID,
      // start time, cgroup, and socket immediately before the numeric signal.
      kill(holder.pid, signal);
      sent += 1;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        warn(
          `${LOG_PREFIX} Failed to send ${signal} to ${holder.pid}: ${safeDisplay(error?.message || error)}`,
        );
      }
    }
  }
  return sent;
}

export function reapPort({
  rawPort,
  env = process.env,
  pid = process.pid,
  ppid = process.ppid,
  proc = createProcInspector(),
  kill = process.kill,
  now = performance.now.bind(performance),
  sleep = defaultSleep,
  warn = console.warn,
  error = console.error,
}) {
  let port;
  try {
    port = parsePort(rawPort);
  } catch (parseError) {
    error(`${LOG_PREFIX} ${safeDisplay(parseError.message)}`);
    return 1;
  }

  const initialInodes = proc.listeningInodes(port);
  if (initialInodes === null) {
    error(`${LOG_PREFIX} Cannot inspect listeners for port ${port}.`);
    return 1;
  }
  if (initialInodes.size === 0) return 0;

  const holders = proc.findHolders(initialInodes, new Set([pid, ppid]));
  if (!holders || holders.length === 0) {
    if (portIsConfirmedFree(proc, port)) return 0;
    error(
      `${LOG_PREFIX} Port ${port} is listening but its owner could not be safely attributed.`,
    );
    return 1;
  }
  const attributedInodes = new Set(
    holders.flatMap((holder) => [...(holder.socketInodes ?? [])]),
  );
  if ([...initialInodes].some((inode) => !attributedInodes.has(inode))) {
    if (portIsConfirmedFree(proc, port)) return 0;
    error(
      `${LOG_PREFIX} Port ${port} has listener sockets whose owners could not all be safely attributed.`,
    );
    return 1;
  }
  const myCgroup = proc.readCgroup(pid);
  if (
    !myCgroup ||
    holders.some(
      (holder) =>
        !holder.cgroup ||
        !holder.startTimeTicks ||
        !(holder.socketInodes instanceof Set) ||
        holder.socketInodes.size === 0,
    )
  ) {
    if (portIsConfirmedFree(proc, port)) return 0;
    error(
      `${LOG_PREFIX} Refusing to signal port ${port} holders because process identity or cgroup evidence is unavailable.`,
    );
    return 1;
  }

  const sameScope = holders.filter((holder) => holder.cgroup === myCgroup);
  const foreignScope = holders.filter((holder) => holder.cgroup !== myCgroup);
  if (sameScope.length > 0 && foreignScope.length > 0) {
    error(
      `${LOG_PREFIX} Refusing mixed-scope holders on port ${port}: ${holders.map(describeHolder).join(", ")}`,
    );
    return 1;
  }

  let targets = sameScope;
  if (foreignScope.length > 0) {
    const authorized = isPid2OwnedReplitWorkflow({
      env,
      pid,
      hasWorkflowAncestry: proc.hasPyrusWorkflowAncestry(pid),
    });
    if (!authorized) {
      error(
        `${LOG_PREFIX} Refusing different-scope holders on port ${port}; REPLIT_MODE alone is not authority and this process has no verified pid2 ancestry. Holder(s): ${foreignScope.map(describeHolder).join(", ")}`,
      );
      return 1;
    }
    targets = foreignScope;
  }
  if (targets.length === 0) {
    error(`${LOG_PREFIX} Port ${port} has no safely attributable holder.`);
    return 1;
  }

  warn(
    `${LOG_PREFIX} Port ${port} held in ${foreignScope.length > 0 ? "a different verified Replit execution scope" : "the current execution scope"}: ${targets.map(describeHolder).join(", ")}. Sending SIGTERM.`,
  );
  const termSent = sendValidatedSignals({
    targets,
    signal: "SIGTERM",
    port,
    proc,
    kill,
    warn,
  });
  if (termSent === 0) {
    const current = proc.listeningInodes(port);
    if (current?.size === 0) return 0;
    error(
      `${LOG_PREFIX} Refusing to signal port ${port}; holder identity or socket ownership changed before SIGTERM.`,
    );
    return 1;
  }

  const termWait = waitForPortToFree({
    proc,
    port,
    timeoutMs: 2_000,
    now,
    sleep,
  });
  if (termWait.state === "freed") {
    warn(
      `${LOG_PREFIX} Port ${port} freed after SIGTERM in ${termWait.elapsedMs}ms.`,
    );
    return 0;
  }
  if (termWait.state === "unavailable") {
    error(`${LOG_PREFIX} Listener evidence became unavailable after SIGTERM.`);
    return 1;
  }

  warn(`${LOG_PREFIX} Port ${port} still held; revalidating before SIGKILL.`);
  sendValidatedSignals({
    targets,
    signal: "SIGKILL",
    port,
    proc,
    kill,
    warn,
  });
  sleep(300);

  const finalInodes = proc.listeningInodes(port);
  if (finalInodes?.size === 0) {
    warn(`${LOG_PREFIX} Port ${port} freed.`);
    return 0;
  }
  error(
    `${LOG_PREFIX} ${finalInodes === null ? "Cannot verify whether" : "Failed to free"} port ${port}.`,
  );
  return 1;
}

function main() {
  process.exitCode = reapPort({ rawPort: process.env.PORT });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
