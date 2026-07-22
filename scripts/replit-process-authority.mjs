import { readFileSync, readlinkSync } from "node:fs";

export function parseProcStat(content) {
  const end = String(content).lastIndexOf(")");
  if (end === -1) return null;
  const fields = String(content)
    .slice(end + 2)
    .trim()
    .split(/\s+/u);
  const ppid = Number(fields[1]);
  const startTimeTicks = fields[19];
  return Number.isSafeInteger(ppid) && ppid >= 0 && startTimeTicks
    ? { ppid, startTimeTicks }
    : null;
}

export function cmdlineIsPid2(raw) {
  const argv0 = String(raw).split("\0")[0] ?? "";
  return argv0.split("/").pop() === "pid2";
}

function cmdlineBasename(raw) {
  const argv0 = String(raw).split("\0")[0] ?? "";
  return argv0.split("/").pop() ?? "";
}

function pid2IsPlatformRooted(stat, readFile) {
  if (!stat || stat.ppid <= 0) return false;
  try {
    const parentCmdline = readFile(`/proc/${stat.ppid}/cmdline`, "utf8");
    const parentName = cmdlineBasename(parentCmdline);
    if (stat.ppid === 1) return parentName === "pid0";
    const parentStat = parseProcStat(
      readFile(`/proc/${stat.ppid}/stat`, "utf8"),
    );
    if (parentName !== "pid1" || !parentStat) return false;
    if (parentStat.ppid === 0) return true;
    return (
      parentStat.ppid === 1 &&
      cmdlineBasename(readFile("/proc/1/cmdline", "utf8")) === "pid0"
    );
  } catch {
    return false;
  }
}

function isPyrusWorkflowRoot(identity, expectedCgroup) {
  if (!identity || identity.cgroup !== expectedCgroup) return false;
  const argv = identity.cmdlineRaw.split("\0").filter(Boolean);
  const command = argv.map((value) => value.split("/").pop());
  return (
    command[0] === "node" &&
    command[1] === "pnpm" &&
    argv.slice(2).join("\0") ===
      ["--filter", "@workspace/pyrus", "run", "dev:replit"].join("\0") &&
    identity.cwd.endsWith("/artifacts/pyrus")
  );
}

export function ancestryReachesPid2(
  startPid,
  { readFile = readFileSync, maxDepth = 64 } = {},
) {
  if (!Number.isSafeInteger(startPid) || startPid <= 0) return false;
  const seen = new Set();
  let current = startPid;

  while (current > 0 && !seen.has(current) && seen.size < maxDepth) {
    seen.add(current);
    let cmdline;
    let stat;
    try {
      cmdline = readFile(`/proc/${current}/cmdline`, "utf8");
      stat = parseProcStat(readFile(`/proc/${current}/stat`, "utf8"));
    } catch {
      return false;
    }
    if (cmdlineIsPid2(cmdline)) {
      return pid2IsPlatformRooted(stat, readFile);
    }
    if (!stat || stat.ppid <= 0 || stat.ppid === current) return false;
    current = stat.ppid;
  }
  return false;
}

export function hasPyrusWorkflowAncestry(
  startPid,
  { readFile = readFileSync, readLink = readlinkSync, maxDepth = 64 } = {},
) {
  if (!Number.isSafeInteger(startPid) || startPid <= 0) return false;
  let expectedCgroup;
  try {
    expectedCgroup = readFile(`/proc/${startPid}/cgroup`, "utf8").trim();
  } catch {
    return false;
  }
  if (!expectedCgroup) return false;

  const seen = new Set();
  let current = startPid;
  let childIdentity = null;
  while (current > 0 && !seen.has(current) && seen.size < maxDepth) {
    seen.add(current);
    let stat;
    let cmdlineRaw;
    try {
      stat = parseProcStat(readFile(`/proc/${current}/stat`, "utf8"));
      cmdlineRaw = readFile(`/proc/${current}/cmdline`, "utf8");
    } catch {
      return false;
    }
    if (cmdlineIsPid2(cmdlineRaw)) {
      return (
        pid2IsPlatformRooted(stat, readFile) &&
        isPyrusWorkflowRoot(childIdentity, expectedCgroup)
      );
    }
    if (!stat || stat.ppid <= 0 || stat.ppid === current) return false;
    try {
      childIdentity = {
        cmdlineRaw,
        cgroup: readFile(`/proc/${current}/cgroup`, "utf8").trim(),
        cwd: readLink(`/proc/${current}/cwd`),
      };
    } catch {
      return false;
    }
    current = stat.ppid;
  }
  return false;
}

export function readProcIdentity(
  pid,
  { readFile = readFileSync, readLink = readlinkSync } = {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = parseProcStat(readFile(`/proc/${pid}/stat`, "utf8"));
    const cmdlineRaw = readFile(`/proc/${pid}/cmdline`, "utf8");
    const cgroup = readFile(`/proc/${pid}/cgroup`, "utf8").trim();
    const cwd = readLink(`/proc/${pid}/cwd`);
    return stat && cmdlineRaw && cgroup && cwd
      ? { pid, startTimeTicks: stat.startTimeTicks, cgroup, cmdlineRaw, cwd }
      : null;
  } catch {
    return null;
  }
}

export function processIdentityMatches(expected, current) {
  return (
    Number.isSafeInteger(expected?.pid) &&
    expected.pid === current?.pid &&
    typeof expected.startTimeTicks === "string" &&
    expected.startTimeTicks === current.startTimeTicks &&
    typeof expected.cgroup === "string" &&
    expected.cgroup !== "" &&
    expected.cgroup === current.cgroup &&
    expected.cmdlineRaw === current.cmdlineRaw &&
    expected.cwd === current.cwd
  );
}

export function signalStableProcess(
  expected,
  signal,
  { readIdentity = readProcIdentity, kill = process.kill } = {},
) {
  const current = readIdentity(expected?.pid);
  if (!processIdentityMatches(expected, current)) return false;
  // ponytail: Node exposes no pidfd signal primitive; this immediate identity
  // recheck is the platform ceiling until Node can bind a signal to an inode.
  kill(expected.pid, signal);
  return true;
}

export function isPid2OwnedReplitWorkflow({
  env = process.env,
  pid = process.pid,
  readFile = readFileSync,
  readLink = readlinkSync,
  hasWorkflowAncestry,
} = {}) {
  return (
    env.REPLIT_MODE === "workflow" &&
    (hasWorkflowAncestry ??
      hasPyrusWorkflowAncestry(pid, { readFile, readLink })) === true
  );
}
