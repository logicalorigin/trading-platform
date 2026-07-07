import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CANONICAL_PORTS, SUPERVISOR_PGREP_PATTERN } from "../config";

const execFileAsync = promisify(execFile);

async function pgrepSupervisor(): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", SUPERVISOR_PGREP_PATTERN], {
      timeout: 4000,
    });
    return stdout
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // pgrep exits non-zero when there is no match.
    return [];
  }
}

// Pure: extract ppid from a /proc/<pid>/stat line. "pid (comm) state ppid ..."
// — comm may contain spaces/parens, so slice past the final ')' before splitting.
function parsePpidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close === -1) return null;
  const fields = stat.slice(close + 2).split(" ");
  const ppid = Number(fields[1]); // [0]=state, [1]=ppid
  return Number.isInteger(ppid) ? ppid : null;
}

async function ppidOf(pid: number): Promise<number | null> {
  try {
    return parsePpidFromStat(await readFile(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

// Pure: is this cmdline the Replit pid2 server? On pooled microVMs (pid0
// -pid2-pooling) the pid2 SERVER runs at an arbitrary OS pid (observed: 23)
// with argv0 "pid2" but comm "node" — so match cmdline argv0, never comm,
// and never the numeric pid. /proc/<pid>/cmdline is NUL-separated.
function cmdlineIsPid2(cmdline: string): boolean {
  const argv0 = cmdline.split("\0")[0] ?? "";
  return argv0.split("/").pop() === "pid2";
}

async function isPid2(pid: number): Promise<boolean> {
  if (pid === 2) return true; // legacy non-pooled containers: pid2 is literally pid 2
  try {
    return cmdlineIsPid2(await readFile(`/proc/${pid}/cmdline`, "utf8"));
  } catch {
    return false;
  }
}

async function walkToPid2(pid: number): Promise<{ chain: number[]; reachesPid2: boolean }> {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | null = pid;
  let reachesPid2 = false;
  while (current !== null && current > 0 && !seen.has(current) && chain.length < 64) {
    seen.add(current);
    chain.push(current);
    if (await isPid2(current)) {
      reachesPid2 = true;
      break;
    }
    current = await ppidOf(current);
  }
  return { chain, reachesPid2 };
}

async function readLockFile(apiPort: number): Promise<{
  path: string;
  present: boolean;
  pid: number | null;
  raw: string | null;
}> {
  const lockPath = `/tmp/pyrus/pyrus-dev-supervisor-${apiPort}.lock`;
  try {
    const raw = (await readFile(lockPath, "utf8")).trim();
    const match = raw.match(/\d+/u);
    return { path: lockPath, present: true, pid: match ? Number(match[0]) : null, raw };
  } catch {
    return { path: lockPath, present: false, pid: null, raw: null };
  }
}

export interface SupervisorState {
  pgrepPattern: string;
  supervisors: Array<{ pid: number; parentChain: number[]; reachesPid2: boolean }>;
  pid2Owned: boolean;
  lock: { path: string; present: boolean; pid: number | null; raw: string | null };
  note: string;
}

export async function readSupervisorState(): Promise<SupervisorState> {
  const pids = await pgrepSupervisor();
  const supervisors = await Promise.all(
    pids.map(async (pid) => {
      const { chain, reachesPid2 } = await walkToPid2(pid);
      return { pid, parentChain: chain, reachesPid2 };
    }),
  );
  const pid2Owned = supervisors.some((s) => s.reachesPid2);
  const lock = await readLockFile(8080);
  const note = pids.length === 0
    ? "No dev supervisor running (pgrep found none). The app is fully stopped — a human must hit Run once so pid2 spawns the tracked workflow (see CLAUDE.md)."
    : pid2Owned
      ? "Supervisor parent chain reaches pid2 — preview is correctly attached."
      : "Supervisor is NOT pid2-owned (chain does not reach pid2). The Replit preview is likely detached (shows 'crashed / ports did not open') even though the app may be running. See CLAUDE.md.";
  return { pgrepPattern: SUPERVISOR_PGREP_PATTERN, supervisors, pid2Owned, lock, note };
}

function parseListeningPorts(content: string): number[] {
  const ports: number[] = [];
  const lines = content.split("\n").slice(1); // drop header
  for (const line of lines) {
    const cols = line.trim().split(/\s+/u);
    if (cols.length < 4) continue;
    const local = cols[1]; // hex "IP:PORT"
    const state = cols[3]; // 0A = LISTEN
    if (state !== "0A" || local === undefined) continue;
    const portHex = local.split(":")[1];
    if (portHex === undefined) continue;
    const port = parseInt(portHex, 16);
    if (Number.isInteger(port)) ports.push(port);
  }
  return ports;
}

async function readListeningPorts(): Promise<Set<number>> {
  const ports = new Set<number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const content = await readFile(file, "utf8");
      for (const port of parseListeningPorts(content)) ports.add(port);
    } catch {
      // ignore unavailable proc files
    }
  }
  return ports;
}

export interface PortBindings {
  canonical: Array<{ port: number; role: string; listening: boolean }>;
  note: string;
}

export async function readPortBindings(): Promise<PortBindings> {
  const listening = await readListeningPorts();
  const canonical = CANONICAL_PORTS.map((entry) => ({
    ...entry,
    listening: listening.has(entry.port),
  }));
  const apiUp = canonical.find((c) => c.port === 8080)?.listening ?? false;
  return {
    canonical,
    note: apiUp
      ? "API port 8080 is LISTENing."
      : "API port 8080 is NOT LISTENing — the API process is down or not bound.",
  };
}

// Test-only surface (consumed by procinfo.test.mjs). Mirrors the repo's
// __customFetchInternalsForTests convention.
export const __procinfoInternalsForTests = { parsePpidFromStat, parseListeningPorts, cmdlineIsPid2 };
