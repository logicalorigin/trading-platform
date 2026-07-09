#!/usr/bin/env node
// Detached kill-watchdog for the PYRUS dev supervisor (WO-RESTART-FORENSICS).
//
// Purpose: discriminate FUTURE abrupt supervisor tree-kills (manual pid2-tracked
// restart vs platform/pid2 reconcile vs resource/policy kill) without asking, per
// the "Minimal instrumentation proposal" in
// .codex-watch/wo-restart-forensics-report.md. Riley confirmed the already-
// investigated kills were his own manual restarts; this only observes the next one.
//
// Shape: one cheap procfs/cgroup sampler, launched DETACHED (own session) by the
// supervisor so a process-group tree-kill of the supervisor does not take it down,
// writing append-line JSONL under .pyrus-runtime/ so samples up to the kill instant
// survive even a whole-cgroup kill (page cache persists; no per-line fsync). One
// watchdog at a time (pidfile lock); self-exits if no supervisor is seen for >10 min
// so it never leaks across a container replacement.
//
// No DB, no HTTP, no config surface beyond PYRUS_API_PORT (shared with the
// supervisor). Sampling is a handful of small virtual-file reads per second, 4x
// faster only while a build descendant is present (reload/start windows).

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const apiPort = process.env.PYRUS_API_PORT || "8080";
const runtimeDir = path.join(repoRoot, ".pyrus-runtime", "kill-watchdog");
const logPath = path.join(runtimeDir, `samples-${apiPort}.jsonl`);
const lockPath = path.join(runtimeDir, `watchdog-${apiPort}.pid`);

const STEADY_INTERVAL_MS = 1000;
const BUILD_INTERVAL_MS = 250; // faster only while a build descendant exists
const STALE_EXIT_MS = 10 * 60 * 1000; // no supervisor for >10 min -> exit
const ROTATE_BYTES = 16 * 1024 * 1024;

const onceMode = process.argv.includes("--once");

// ---- cheap readers -------------------------------------------------------

function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
function readCmdline(pid) {
  const raw = readText(`/proc/${pid}/cmdline`);
  return raw ? raw.replace(/\0/g, " ").trim() : "";
}
function toInt(s) {
  if (s == null) return null;
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
}
function toMax(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "max") return "max";
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function bytesToMb(v) {
  return typeof v === "number" ? Math.round(v / 1048576) : v;
}
function mtimeMs(p) {
  try {
    return Math.round(statSync(p).mtimeMs);
  } catch {
    return null;
  }
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
// /proc/<pid>/stat: fields after the final ')' are state ppid pgrp ... starttime(f22)
function statFields(stat) {
  const i = stat.lastIndexOf(")");
  return i === -1 ? [] : stat.slice(i + 2).split(" ");
}

function readCgroup(base, withCpu) {
  const r = {};
  r.pidsCur = toInt(readText(`${base}/pids.current`));
  r.pidsMax = toMax(readText(`${base}/pids.max`));
  r.pidsPeak = toInt(readText(`${base}/pids.peak`));
  const pe = readText(`${base}/pids.events`);
  r.pidsEvtMax = pe ? toInt((pe.match(/(?:^|\n)max (\d+)/) || [])[1]) : null;
  r.memCurMb = bytesToMb(toInt(readText(`${base}/memory.current`)));
  r.memMaxMb = bytesToMb(toMax(readText(`${base}/memory.max`)));
  r.memPeakMb = bytesToMb(toInt(readText(`${base}/memory.peak`)));
  const me = readText(`${base}/memory.events`) || "";
  const meGet = (k) => {
    const m = me.match(new RegExp(`(?:^|\\n)${k} (\\d+)`));
    return m ? Number(m[1]) : null;
  };
  r.oom = meGet("oom");
  r.oomKill = meGet("oom_kill");
  r.memEvtMax = meGet("max");
  if (withCpu) {
    const cs = readText(`${base}/cpu.stat`) || "";
    const csGet = (k) => {
      const m = cs.match(new RegExp(`(?:^|\\n)${k} (\\d+)`));
      return m ? Number(m[1]) : null;
    };
    r.cpuUsec = csGet("usage_usec");
    r.cpuThrottledUsec = csGet("throttled_usec");
    r.cpuNrThrottled = csGet("nr_throttled");
  }
  return r;
}

// ---- process scan (cache-by-pid; only new pids are read) -----------------

const procCache = new Map(); // pid -> { comm, ppid, isNode, isCodex, isBuild, isSupervisor }

function refreshProcs() {
  const live = new Set();
  for (const name of readdirSync("/proc")) {
    if (name < "0" || name > "9") continue; // fast numeric-first filter
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    live.add(pid);
    if (procCache.has(pid)) continue;
    const comm = (readText(`/proc/${pid}/comm`) || "").trim();
    const stat = readText(`/proc/${pid}/stat`);
    const ppid = stat ? Number(statFields(stat)[1]) : null;
    const isNode = comm === "node" || comm === "MainThread";
    let isCodex = /codex/i.test(comm);
    let isBuild = /esbuild|rollup|(^|\/)tsc$/.test(comm);
    let isSupervisor = false;
    if (isNode || isCodex) {
      const cmd = readCmdline(pid);
      if (cmd.includes("runDevApp.mjs")) isSupervisor = true;
      if (/codex/i.test(cmd)) isCodex = true;
      if (!isBuild && /build\.mjs|run build|\besbuild\b|\btsc\b|vite build/.test(cmd)) {
        isBuild = true;
      }
    }
    procCache.set(pid, { comm, ppid, isNode, isCodex, isBuild, isSupervisor });
  }
  for (const pid of procCache.keys()) if (!live.has(pid)) procCache.delete(pid);
  return live.size;
}

const bootId = (readText("/proc/sys/kernel/random/boot_id") || "").trim() || null;

function walkParents(pid) {
  const chain = [];
  let cur = pid;
  let pid2Owned = false;
  for (let guard = 0; cur && guard < 32; guard++) {
    const stat = readText(`/proc/${cur}/stat`);
    if (!stat) break;
    chain.push(cur);
    // Match argv0 === "pid2", never pid === 2 (pooled microVMs run pid2 at a
    // non-2 OS pid — CLAUDE.md verified 2026-07-05).
    const argv0 = readCmdline(cur).split(" ")[0];
    if (argv0 === "pid2") pid2Owned = true;
    const ppid = Number(statFields(stat)[1]);
    if (!ppid || ppid === cur) break;
    cur = ppid;
  }
  return { chain, pid2Owned };
}

let supMeta = null; // { pid, runId, pid2Owned, chain, scopePath }

function buildSupMeta(pid) {
  const { chain, pid2Owned } = walkParents(pid);
  const stat = readText(`/proc/${pid}/stat`);
  const startTicks = stat ? statFields(stat)[19] : null; // f22 starttime
  const cg = readText(`/proc/${pid}/cgroup`) || "";
  const m = cg.match(/^0::(.*)$/m);
  const scopePath = m ? m[1] : "/";
  return { pid, chain, pid2Owned, runId: `${bootId}:${pid}:${startTicks}`, scopePath };
}

function resolveSupervisor() {
  const candidates = [];
  for (const [pid, v] of procCache) if (v.isSupervisor) candidates.push(pid);
  if (candidates.length === 0) {
    supMeta = null;
    return null;
  }
  if (supMeta && candidates.includes(supMeta.pid)) return supMeta.pid; // stable
  let fallback = null;
  for (const pid of candidates) {
    const meta = buildSupMeta(pid);
    if (meta.pid2Owned) {
      supMeta = meta;
      return pid;
    }
    if (!fallback) fallback = meta;
  }
  supMeta = fallback;
  return fallback ? fallback.pid : null;
}

function rssMb(pid) {
  const s = readText(`/proc/${pid}/statm`);
  if (!s) return null;
  const pages = Number(s.split(" ")[1]);
  return Number.isFinite(pages) ? Math.round((pages * 4096) / 1048576) : null;
}

function childrenOf(supPid) {
  const out = [];
  for (const [pid, v] of procCache) {
    if (v.ppid === supPid) out.push({ pid, rssMb: rssMb(pid), comm: v.comm });
  }
  return out;
}

// ---- sample --------------------------------------------------------------

let seq = 0;
const startedAt = Date.now();

function buildSample() {
  const procNumeric = refreshProcs();
  const supPid = resolveSupervisor();
  let node = 0;
  let codex = 0;
  let build = false;
  for (const v of procCache.values()) {
    if (v.isNode) node++;
    if (v.isCodex) codex++;
    if (v.isBuild) build = true;
  }
  const meminfo = readText("/proc/meminfo") || "";
  const miGet = (k) => {
    const m = meminfo.match(new RegExp(`^${k}:\\s+(\\d+) kB`, "m"));
    return m ? Math.round(Number(m[1]) / 1024) : null;
  };
  const scopeBase =
    supMeta && supMeta.scopePath && supMeta.scopePath !== "/"
      ? "/sys/fs/cgroup" + supMeta.scopePath
      : null;
  return {
    t: new Date().toISOString(),
    mono: Math.round(performance.now()),
    seq: seq++,
    boot: bootId,
    sup: supPid,
    run: supMeta ? supMeta.runId : null,
    pid2Owned: supMeta ? supMeta.pid2Owned : null,
    chain: supMeta ? supMeta.chain : null,
    procNumeric,
    node,
    codex,
    build,
    children: supPid ? childrenOf(supPid) : [],
    scope: scopeBase ? { path: supMeta.scopePath, ...readCgroup(scopeBase, false) } : null,
    root: readCgroup("/sys/fs/cgroup", true),
    sys: { availMb: miGet("MemAvailable"), freeMb: miGet("MemFree") },
    mark: {
      envLatest: mtimeMs("/run/replit/env/latest.json"),
      envLast: mtimeMs("/run/replit/env/last.json"),
      toolchain: mtimeMs("/run/replit/toolchain.json"),
    },
  };
}

// ---- once mode (manual inspection) ---------------------------------------

if (onceMode) {
  process.stdout.write(JSON.stringify(buildSample()) + "\n");
  process.exit(0);
}

// ---- idempotency lock ----------------------------------------------------

mkdirSync(runtimeDir, { recursive: true });

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") return false;
      const owner = Number((readText(lockPath) || "").trim());
      if (owner && owner !== process.pid && pidAlive(owner)) return false; // live watchdog
      try {
        unlinkSync(lockPath); // stale lock -> take over
      } catch {}
    }
  }
  return false;
}

if (!acquireLock()) process.exit(0); // another watchdog already running

function releaseLock() {
  const owner = Number((readText(lockPath) || "").trim());
  if (owner === process.pid) {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}
process.once("exit", releaseLock);

// ---- durable append log --------------------------------------------------

let logFd = openSync(logPath, "a");
let logBytes = (() => {
  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
})();

function writeSample(obj) {
  const buf = Buffer.from(JSON.stringify(obj) + "\n");
  writeSync(logFd, buf); // to page cache; survives a SIGKILL, no fsync (fsync-light)
  logBytes += buf.length;
  if (logBytes >= ROTATE_BYTES) {
    try {
      closeSync(logFd);
      renameSync(logPath, logPath + ".1");
    } catch {}
    logFd = openSync(logPath, "a");
    logBytes = 0;
  }
}

// ---- sampling loop -------------------------------------------------------

let lastSupSeen = Date.now();
let timer = null;

function finalAndExit(reason) {
  try {
    writeSample({ t: new Date().toISOString(), seq: seq++, boot: bootId, event: "watchdog-exit", reason });
  } catch {}
  process.exit(0);
}

function tick() {
  let interval = STEADY_INTERVAL_MS;
  try {
    const sample = buildSample();
    writeSample(sample);
    if (sample.sup) lastSupSeen = Date.now();
    if (Date.now() - lastSupSeen > STALE_EXIT_MS) return finalAndExit("stale-no-supervisor");
    interval = sample.build ? BUILD_INTERVAL_MS : STEADY_INTERVAL_MS;
  } catch {}
  timer = setTimeout(tick, interval);
}

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => finalAndExit(sig));
}

writeSample({ t: new Date().toISOString(), seq: seq++, boot: bootId, event: "watchdog-start", pid: process.pid, startedAt });
tick();
