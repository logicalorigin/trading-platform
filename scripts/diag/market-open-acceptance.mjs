#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  readlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

import {
  parseCpuProfileSummaryOutput,
  readInspectorProcessId,
} from "./cpu-profile-utils.mjs";
import {
  acceptanceFailedStepKeys,
  assertApiDescendsFromSupervisor,
  assertApiProcessRole,
  assertFreshApiHeartbeat,
  assertRuntimeSamplesComplete,
  assertSameProcessIdentity,
  assertStableApiPid,
  calculateCounterRate,
  classifyIncrementalAcceptanceCounters,
  cleanupHeapProfiler,
  createSingleFlightRunner,
  diffRuntimeCounters,
  isWithinAcceptanceWindow,
  isRunDevSupervisorProcess,
  pickRuntimeAcceptanceSnapshot,
  psqlEnvironment,
  summarizeRuntimeSamples,
  terminateChildWithFallback,
  validateRuntimeAcceptanceSnapshot,
  withTimeout,
} from "./market-open-acceptance-utils.mjs";

const REPO_ROOT = process.cwd();
const API_ROOT = path.join(REPO_ROOT, "artifacts", "api-server");
const API_ENTRYPOINT = "./dist/index.mjs";
const PYRUS_ROOT = path.join(REPO_ROOT, "artifacts", "pyrus");
const RECORDER_DIR = path.join(REPO_ROOT, ".pyrus-runtime", "flight-recorder");
const CPU_PROFILE_MS = 20_000;
const ALLOC_PROFILE_MS = 20_000;
const SYMBOL_STATE_GATE_MS = 60_000;
const RUNTIME_SAMPLE_MS = 5_000;
const CDP_COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_KILL_GRACE_MS = 2_000;
const configuredHeartbeatMs = Number.parseInt(
  process.env.PYRUS_API_FLIGHT_RECORDER_INTERVAL_MS ?? "5000",
  10,
);
const MAX_API_HEARTBEAT_AGE_MS =
  Number.isFinite(configuredHeartbeatMs) && configuredHeartbeatMs > 0
    ? configuredHeartbeatMs * 3
    : 15_000;
const INSPECTOR_URL = "http://127.0.0.1:9229/json/list";
const RUNTIME_URL = "http://127.0.0.1:8080/api/diagnostics/runtime";
const REQUIRED_STEPS = [
  "identity",
  "counterBaseline",
  "symbolStateGate",
  "cpuProfile",
  "allocationProfile",
  "counterFinal",
  "counters",
  "firehose",
];

const BASELINES = {
  gcBusyPercent: 32.6,
  parseRowAllocPercent: 50.7,
  busyPercent: 95.8,
  oldSpaceMb: 1596,
  dbWaitersRange: [28, 65],
  authSessionsMaxSec: 60,
  barCacheSelectTotalSec: 9380,
  storedBarsHitCount: 0,
  storedBarsDeltaReadCount: 0,
  executionEventsReadMaxSec: 9.4,
};

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(
  REPO_ROOT,
  args.out ?? path.join("scripts", "reports", "open-acceptance", utcStamp()),
);

await mkdir(outDir, { recursive: true });

const state = {
  capturedAt: new Date().toISOString(),
  outDir,
  steps: {},
};

console.log(
  `market-open acceptance capture -> ${path.relative(REPO_ROOT, outDir)}`,
);

await runStep("identity", "1. identity", captureIdentity);
await runStep(
  "counterBaseline",
  "2. runtime counter baseline",
  captureRuntimeSnapshot,
);
state.windowStartedAt = new Date().toISOString();
const runtimeSampler = startRuntimeSampler();
try {
  await runStep(
    "symbolStateGate",
    "3. BUS-3B symbol-state write-rate gate",
    captureSymbolStateGate,
  );
  await Promise.all([
    runStep("cpuProfile", "4a. CPU profile", captureCpuProfile),
    runStep(
      "allocationProfile",
      "4b. allocation profile",
      captureAllocationProfile,
    ),
  ]);
} finally {
  await runtimeSampler.stop();
}
await runStep(
  "counterFinal",
  "5. runtime counter final",
  captureRuntimeSnapshot,
);
state.windowEndedAt = new Date().toISOString();
state.runtimeSamples = runtimeSampler.samples;
state.steps.counters = buildCounterWindowStep();
await runStep("firehose", "6. exact-window firehose", captureFirehoseWindow);

const failedSteps = acceptanceFailedStepKeys(state.steps, REQUIRED_STEPS);
state.acceptance = { passed: failedSteps.length === 0, failedSteps };
const summaryRows = buildSummaryRows(state);
state.summaryRows = summaryRows;

const reportMd = renderReport(state, summaryRows);
await writeFile(path.join(outDir, "report.md"), reportMd);
await writeFile(
  path.join(outDir, "capture.json"),
  `${JSON.stringify(state, null, 2)}\n`,
);

console.log("");
console.log(renderMarkdownTable(summaryRows));
console.log("");
console.log(`report.md: ${path.join(outDir, "report.md")}`);
if (failedSteps.length) {
  console.error(`capture incomplete: ${failedSteps.join(", ")}`);
  process.exitCode = 1;
}

async function runStep(key, label, fn) {
  console.log(label);
  try {
    if (key !== "identity") await currentApiPid();
    const data = await fn();
    if (key !== "identity") await currentApiPid();
    state.steps[key] = { ok: true, data };
    if (data?.verdictLine) {
      console.log(data.verdictLine);
    }
  } catch (error) {
    const message = errorMessage(error);
    state.steps[key] = { ok: false, unavailable: message };
    console.log(`unavailable: ${message}`);
  }
}

async function captureIdentity() {
  const apiCurrentPath = path.join(RECORDER_DIR, "api-current.json");
  const currentPath = path.join(RECORDER_DIR, "current.json");
  const apiCurrent = await readJson(apiCurrentPath);
  const current = await readJsonIfExists(currentPath);
  assertFreshApiHeartbeat(
    apiCurrent.updatedAt,
    Date.now(),
    MAX_API_HEARTBEAT_AGE_MS,
  );
  const apiPid = finiteNumber(apiCurrent.pid);
  assertStableApiPid(apiPid, apiPid);
  if (!pidIsAlive(apiPid)) {
    throw new Error(
      `recorded API pid is unavailable or dead: ${apiPid ?? "n-a"}`,
    );
  }
  const apiProcessIdentity = await readProcIdentity(apiPid);
  assertSameProcessIdentity(apiProcessIdentity, apiProcessIdentity);
  assertApiProcessRole(apiProcessIdentity, API_ROOT, API_ENTRYPOINT);
  const supervisors = await findRunDevSupervisors();
  const currentSupervisorPid = finiteNumber(current?.supervisor?.pid);
  const supervisorPid =
    currentSupervisorPid &&
    supervisors.some((item) => item.pid === currentSupervisorPid)
      ? currentSupervisorPid
      : (supervisors[0]?.pid ?? currentSupervisorPid ?? null);
  const supervisorAncestry = supervisorPid
    ? await processAncestry(supervisorPid)
    : [];
  const pid2Owned = supervisorAncestry.some((entry) =>
    cmdlineIsPid2(entry.cmdlineRaw ?? ""),
  );
  const gitSha =
    findRecordedGitSha(apiCurrent) ?? findRecordedGitSha(current) ?? null;

  if (supervisors.length !== 1) {
    throw new Error(
      `expected one runDevApp supervisor, found ${supervisors.length}`,
    );
  }
  if (!pid2Owned) {
    throw new Error(`supervisor ${supervisorPid ?? "n-a"} is not pid2-owned`);
  }
  const apiAncestry = await processAncestry(apiPid);
  assertApiDescendsFromSupervisor(apiAncestry, supervisorPid);

  return {
    apiCurrentPath: path.relative(REPO_ROOT, apiCurrentPath),
    apiPid,
    apiPpid: finiteNumber(apiCurrent.ppid),
    uptimeMs: finiteNumber(apiCurrent.uptimeMs),
    uptime: formatDurationMs(finiteNumber(apiCurrent.uptimeMs)),
    runningGitSha: gitSha ?? "not recorded",
    supervisorPid,
    supervisorMatchCount: supervisors.length,
    supervisorCandidatePids: supervisors.map((item) => item.pid),
    pid2Owned,
    apiProcessIdentity,
    apiAncestry,
    supervisorAncestry,
    apiCurrent,
    supervisorCurrent: current?.supervisor ?? null,
  };
}

async function captureSymbolStateGate() {
  const first = await readSymbolStateWriteCounter();
  await sleep(SYMBOL_STATE_GATE_MS);
  const second = await readSymbolStateWriteCounter();
  const { elapsedMs, deltaRows, rowsPerMin } = calculateCounterRate(
    first,
    second,
  );
  const rounded = String(Math.round(rowsPerMin));
  return {
    first,
    second,
    elapsedMs,
    deltaRows,
    rowsPerMin,
    verdictLine: `BUS-3B gate: ${rounded}/min (dispatch if >=300)`,
  };
}

async function captureCpuProfile() {
  const apiPid = await currentApiPid();
  if (!apiPid) throw new Error("api pid unavailable");
  try {
    return await runCpuProfiler(apiPid);
  } catch (error) {
    if (!/ECONNREFUSED/i.test(errorMessage(error))) throw error;
    await sleep(3_000);
    return await runCpuProfiler(apiPid);
  }
}

async function runCpuProfiler(apiPid) {
  const script = path.join(
    REPO_ROOT,
    "scripts",
    "diag",
    "cpu-profile-running-api.mjs",
  );
  const rawProfilePath = path.join(outDir, "cpu.cpuprofile");
  const result = await runCommand(
    process.execPath,
    [script, String(apiPid), String(CPU_PROFILE_MS), rawProfilePath],
    { timeoutMs: CPU_PROFILE_MS + 15_000 },
  );
  if (result.code !== 0) {
    throw new Error(
      `cpu profiler exited ${result.code}: ${trimForError(result.stderr || result.stdout)}`,
    );
  }
  const parsed = parseCpuProfileSummaryOutput(result.stdout);
  return {
    apiPid,
    durationMs: CPU_PROFILE_MS,
    rawProfilePath: path.relative(REPO_ROOT, rawProfilePath),
    busyPercent: parsed.busyPercent,
    gcPercent: parsed.gcPercent,
    topRows: parsed.rows.slice(0, 10),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function captureAllocationProfile() {
  const apiPid = await currentApiPid();
  if (!apiPid) throw new Error("api pid unavailable");
  const rawProfilePath = path.join(outDir, "allocation.heapprofile");
  const inspector = await openInspector(apiPid);
  let samplingStarted = false;
  try {
    await inspector.send("HeapProfiler.enable");
    await inspector.send("HeapProfiler.startSampling", {
      samplingInterval: 65_536,
    });
    samplingStarted = true;
    await sleep(ALLOC_PROFILE_MS);
    const { profile } = await inspector.send("HeapProfiler.stopSampling");
    samplingStarted = false;
    await writeFile(rawProfilePath, `${JSON.stringify(profile)}\n`);
    const heapStats = await evaluateHeapStats(inspector);
    const aggregate = aggregateHeapProfile(profile);
    return {
      apiPid,
      durationMs: ALLOC_PROFILE_MS,
      rawProfilePath: path.relative(REPO_ROOT, rawProfilePath),
      totalAllocatedBytes: aggregate.totalBytes,
      mbPerSec: aggregate.totalBytes / 1024 / 1024 / (ALLOC_PROFILE_MS / 1000),
      parseRowAsArrayPercent: aggregate.parseRowAsArrayPercent,
      oldSpaceUsedMb: heapStats.oldSpaceUsedMb,
      heapStats,
      topRows: aggregate.rows.slice(0, 15),
    };
  } finally {
    await cleanupHeapProfiler(inspector, samplingStarted);
    inspector.close();
  }
}

async function captureRuntimeSnapshot() {
  const response = await fetch(RUNTIME_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `GET ${RUNTIME_URL} -> ${response.status}: ${trimForError(await response.text())}`,
    );
  }
  const runtime = await response.json();
  return validateRuntimeAcceptanceSnapshot(
    pickRuntimeAcceptanceSnapshot(runtime),
  );
}

async function captureFirehoseWindow() {
  const cutoffMs = Date.parse(state.windowStartedAt);
  const now = Date.parse(state.windowEndedAt);
  if (!Number.isFinite(cutoffMs) || !Number.isFinite(now) || now < cutoffMs) {
    throw new Error("acceptance window bounds are unavailable");
  }
  const dates = new Set([
    new Date(cutoffMs).toISOString().slice(0, 10),
    new Date(now).toISOString().slice(0, 10),
  ]);
  const files = (await readdir(RECORDER_DIR))
    .filter((name) =>
      [...dates].some((date) => name === `api-events-${date}.jsonl`),
    )
    .map((name) => path.join(RECORDER_DIR, name));
  if (files.length === 0) {
    throw new Error(`no api-events files for ${[...dates].join(", ")}`);
  }

  const byShape = new Map();
  let scannedLines = 0;
  let parsedSlowEvents = 0;
  let includedEvents = 0;
  for (const file of files) {
    const rl = readline.createInterface({
      input: createReadStream(file, {
        encoding: "utf8",
        highWaterMark: 1024 * 1024,
      }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      scannedLines += 1;
      if (!line.includes('"api-db-query-slow"')) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.event !== "api-db-query-slow") continue;
      parsedSlowEvents += 1;
      const timeMs = Date.parse(event.time);
      if (!isWithinAcceptanceWindow(timeMs, cutoffMs, now)) continue;
      includedEvents += 1;
      const shape = sqlShape(event.sql, event.queryName);
      const current = byShape.get(shape) ?? {
        shape,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        firstAt: event.time,
        lastAt: event.time,
      };
      const durationMs = finiteNumber(event.durationMs) ?? 0;
      current.count += 1;
      current.totalMs += durationMs;
      current.maxMs = Math.max(current.maxMs, durationMs);
      current.firstAt = minIso(current.firstAt, event.time);
      current.lastAt = maxIso(current.lastAt, event.time);
      byShape.set(shape, current);
    }
  }

  const rows = [...byShape.values()].sort((a, b) => b.totalMs - a.totalMs);
  return {
    files: files.map((file) => path.relative(REPO_ROOT, file)),
    windowStart: new Date(cutoffMs).toISOString(),
    windowEnd: new Date(now).toISOString(),
    scannedLines,
    parsedSlowEvents,
    includedEvents,
    topRows: rows.slice(0, 12),
    derived: deriveFirehoseMetrics(rows),
  };
}

async function currentApiPid() {
  const apiCurrent = await readJsonIfExists(
    path.join(RECORDER_DIR, "api-current.json"),
  );
  assertFreshApiHeartbeat(
    apiCurrent?.updatedAt,
    Date.now(),
    MAX_API_HEARTBEAT_AGE_MS,
  );
  const identity = stepData(state, "identity");
  const identityPid = finiteNumber(identity?.apiPid);
  const freshPid = finiteNumber(apiCurrent?.pid);
  assertStableApiPid(identityPid, freshPid);
  if (!pidIsAlive(identityPid)) {
    throw new Error(`API pid ${identityPid} is no longer alive`);
  }
  const currentIdentity = await readProcIdentity(identityPid);
  assertSameProcessIdentity(identity?.apiProcessIdentity, currentIdentity);
  assertApiProcessRole(currentIdentity, API_ROOT, API_ENTRYPOINT);
  assertApiDescendsFromSupervisor(
    await processAncestry(identityPid),
    identity?.supervisorPid,
  );
  return identityPid;
}

function startRuntimeSampler() {
  const samples = [];
  const runner = createSingleFlightRunner(async () => {
    try {
      const apiPid = await currentApiPid();
      const startedAt = performance.now();
      const snapshot = await captureRuntimeSnapshot();
      samples.push({
        at: new Date().toISOString(),
        apiPid,
        fetchDurationMs: performance.now() - startedAt,
        snapshot,
      });
    } catch (error) {
      samples.push({
        at: new Date().toISOString(),
        error: errorMessage(error),
      });
    }
  });
  runner.run();
  const timer = setInterval(() => runner.run(), RUNTIME_SAMPLE_MS);
  timer.unref?.();
  return {
    samples,
    async stop() {
      clearInterval(timer);
      await runner.wait();
    },
  };
}

function buildCounterWindowStep() {
  const before = stepData(state, "counterBaseline");
  const after = stepData(state, "counterFinal");
  if (!before || !after) {
    return { ok: false, unavailable: "runtime counter boundary unavailable" };
  }
  try {
    assertRuntimeSamplesComplete(state.runtimeSamples, {
      windowStart: state.windowStartedAt,
      windowEnd: state.windowEndedAt,
      maxGapMs: RUNTIME_SAMPLE_MS * 2,
    });
  } catch (error) {
    return { ok: false, unavailable: errorMessage(error) };
  }
  const runtimeWindow = summarizeRuntimeSamples([
    { at: state.windowStartedAt, snapshot: before },
    ...state.runtimeSamples,
    { at: state.windowEndedAt, snapshot: after },
  ]);
  return {
    ok: true,
    data: {
      windowStart: state.windowStartedAt,
      windowEnd: state.windowEndedAt,
      before,
      after,
      delta: diffRuntimeCounters(before.counters, after.counters),
      runtimeWindow,
    },
  };
}

async function readSymbolStateWriteCounter() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const query = [
    "select coalesce((",
    "  select n_tup_ins + n_tup_upd",
    "  from pg_stat_user_tables",
    "  where relname = 'signal_monitor_symbol_states'",
    "), 0);",
  ].join(" ");
  const result = await runCommand(
    "psql",
    ["-AtX", "-v", "ON_ERROR_STOP=1", "-c", query],
    {
      env: psqlEnvironment(databaseUrl),
      timeoutMs: 30_000,
    },
  );
  if (result.code !== 0) {
    throw new Error(
      `psql exited ${result.code}: ${trimForError(result.stderr || result.stdout)}`,
    );
  }
  const total = Number(result.stdout.trim());
  if (!Number.isFinite(total)) {
    throw new Error(
      `psql returned non-numeric counter: ${JSON.stringify(result.stdout.trim())}`,
    );
  }
  return { at: new Date().toISOString(), atMs: Date.now(), total };
}

async function openInspector(pid) {
  process.kill(pid, "SIGUSR1");
  await sleep(500);
  const response = await fetch(INSPECTOR_URL, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`inspector list returned ${response.status}`);
  const list = await response.json();
  const target = list.find((item) => item.webSocketDebuggerUrl);
  if (!target) throw new Error("no inspector target found on :9229");
  const inspector = await connectCdp(target.webSocketDebuggerUrl);
  try {
    const inspectedPid = readInspectorProcessId(
      await inspector.send("Runtime.evaluate", {
        expression: "process.pid",
        returnByValue: true,
      }),
    );
    if (inspectedPid !== pid) {
      throw new Error(
        `inspector target pid ${inspectedPid ?? "unknown"} does not match requested pid ${pid}`,
      );
    }
    return inspector;
  } catch (error) {
    inspector.close();
    throw error;
  }
}

async function connectCdp(url) {
  if (typeof WebSocket !== "function") {
    throw new Error("global WebSocket is unavailable in this Node runtime");
  }
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  });
  ws.addEventListener("close", () => {
    for (const { reject } of pending.values())
      reject(new Error("inspector websocket closed"));
    pending.clear();
  });
  try {
    await withTimeout(opened, 5_000, "inspector websocket open");
  } catch (error) {
    ws.close();
    throw error;
  }
  return {
    send(method, params = {}) {
      return withTimeout(
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        }),
        CDP_COMMAND_TIMEOUT_MS,
        `inspector ${method}`,
      );
    },
    close() {
      try {
        ws.close();
      } catch {
        // Best-effort cleanup only.
      }
    },
  };
}

async function evaluateHeapStats(inspector) {
  const expression = [
    "(() => {",
    "  try {",
    "    const v8 = process.getBuiltinModule",
    "      ? process.getBuiltinModule('node:v8')",
    "      : require('node:v8');",
    "    return { ok: true, spaces: v8.getHeapSpaceStatistics(), memory: process.memoryUsage() };",
    "  } catch (error) {",
    "    return { ok: false, error: String(error), memory: process.memoryUsage() };",
    "  }",
    "})()",
  ].join("\n");
  const result = await inspector.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  const value = result?.result?.value ?? null;
  const oldSpace = Array.isArray(value?.spaces)
    ? value.spaces.find((space) => space?.space_name === "old_space")
    : null;
  return {
    ok: Boolean(value?.ok),
    error: value?.error ?? null,
    oldSpaceUsedMb: oldSpace ? bytesToMb(oldSpace.space_used_size) : null,
    spaces: value?.spaces ?? null,
    memory: value?.memory ?? null,
  };
}

function aggregateHeapProfile(profile) {
  const byFrame = new Map();
  let totalBytes = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const selfSize = finiteNumber(node.selfSize) ?? 0;
    const frame = formatCallFrame(node.callFrame);
    totalBytes += selfSize;
    const current = byFrame.get(frame) ?? 0;
    byFrame.set(frame, current + selfSize);
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile?.head);
  const rows = [...byFrame.entries()]
    .map(([frame, selfSizeBytes]) => ({
      frame,
      selfSizeBytes,
      selfSizeMb: bytesToMb(selfSizeBytes),
      percent: totalBytes > 0 ? (selfSizeBytes / totalBytes) * 100 : null,
    }))
    .sort((a, b) => b.selfSizeBytes - a.selfSizeBytes);
  const parseRowBytes = rows
    .filter((row) => /_parseRowAsArray/i.test(row.frame))
    .reduce((sum, row) => sum + row.selfSizeBytes, 0);
  return {
    totalBytes,
    parseRowAsArrayPercent:
      totalBytes > 0 ? (parseRowBytes / totalBytes) * 100 : null,
    rows,
  };
}

function deriveFirehoseMetrics(rows) {
  const authRows = rows.filter((row) => /auth_sessions/i.test(row.shape));
  const barCacheSelectRows = rows.filter(
    (row) => /bar_cache/i.test(row.shape) && /\bselect\b/i.test(row.shape),
  );
  const executionEventReadRows = rows.filter(
    (row) =>
      /execution_events/i.test(row.shape) && /\bselect\b/i.test(row.shape),
  );
  return {
    authSessionsMaxSec: maxSeconds(authRows.map((row) => row.maxMs)),
    barCacheSelectTotalSec: sumSeconds(
      barCacheSelectRows.map((row) => row.totalMs),
    ),
    executionEventsReadMaxSec: maxSeconds(
      executionEventReadRows.map((row) => row.maxMs),
    ),
  };
}

function buildSummaryRows(reportState) {
  const cpu = stepData(reportState, "cpuProfile");
  const alloc = stepData(reportState, "allocationProfile");
  const counters = stepData(reportState, "counters");
  const firehose = stepData(reportState, "firehose");
  const counterDelta = counters?.delta ?? {};
  const after = counters?.after;
  const storedBarsCache = after?.diagnostics?.storedBarsCache;
  const incremental = after?.diagnostics?.incremental;
  const scannerCoverage = after?.diagnostics?.scannerCoverage;
  const firehoseMetrics = firehose?.derived ?? {};
  const dbWaiters = finiteNumber(counters?.runtimeWindow?.peakDbTotalWaiting);
  const storedBarsWindow = {
    hitCount: counterDelta.storedBarsHitCount,
    deltaReadCount: counterDelta.storedBarsDeltaReadCount,
  };
  const incrementalAcceptance =
    classifyIncrementalAcceptanceCounters(counterDelta);

  return [
    {
      metric: "GC % of busy CPU",
      baseline: `${BASELINES.gcBusyPercent}%`,
      captured: formatMaybePercent(cpu?.gcPercent),
      verdict: compareLower(cpu?.gcPercent, BASELINES.gcBusyPercent),
      notes: "20s CPU profile",
    },
    {
      metric: "_parseRowAsArray allocation %",
      baseline: `${BASELINES.parseRowAllocPercent}%`,
      captured: formatMaybePercent(alloc?.parseRowAsArrayPercent),
      verdict: compareLower(
        alloc?.parseRowAsArrayPercent,
        BASELINES.parseRowAllocPercent,
      ),
      notes: "20s HeapProfiler sampling",
    },
    {
      metric: "busy%",
      baseline: `${BASELINES.busyPercent}%`,
      captured: formatMaybePercent(cpu?.busyPercent),
      verdict: compareLower(cpu?.busyPercent, BASELINES.busyPercent),
      notes: "CPU profile header",
    },
    {
      metric: "old_space used",
      baseline: `${BASELINES.oldSpaceMb} MB`,
      captured: formatMaybeMb(alloc?.oldSpaceUsedMb),
      verdict: compareLower(alloc?.oldSpaceUsedMb, BASELINES.oldSpaceMb),
      notes: "CDP Runtime.evaluate v8 heap spaces",
    },
    {
      metric: "DB pool waiters",
      baseline: `${BASELINES.dbWaitersRange[0]}-${BASELINES.dbWaitersRange[1]}`,
      captured: formatMaybeNumber(dbWaiters, 0),
      verdict: compareLowerRange(
        dbWaiters,
        BASELINES.dbWaitersRange[0],
        BASELINES.dbWaitersRange[1],
      ),
      notes: "5s peak of raw pool + admission queue",
    },
    {
      metric: "auth_sessions max queue",
      baseline: `${BASELINES.authSessionsMaxSec}s`,
      captured: formatMaybeSeconds(firehoseMetrics.authSessionsMaxSec),
      verdict: compareLower(
        firehoseMetrics.authSessionsMaxSec,
        BASELINES.authSessionsMaxSec,
      ),
      notes: "exact acceptance-window slow-query firehose",
    },
    {
      metric: "bar_cache SELECT total",
      baseline: `${BASELINES.barCacheSelectTotalSec}s`,
      captured: formatMaybeSeconds(firehoseMetrics.barCacheSelectTotalSec),
      verdict: compareLower(
        firehoseMetrics.barCacheSelectTotalSec,
        BASELINES.barCacheSelectTotalSec,
      ),
      notes: "exact acceptance-window slow-query firehose",
    },
    {
      metric: "storedBarsCache hit/delta",
      baseline: `${BASELINES.storedBarsHitCount} / ${BASELINES.storedBarsDeltaReadCount}`,
      captured:
        counters == null
          ? "n-a"
          : `${formatMaybeNumber(counterDelta.storedBarsHitCount, 0)} / ${formatMaybeNumber(
              counterDelta.storedBarsDeltaReadCount,
              0,
            )}`,
      verdict: compareStoredBars(storedBarsWindow),
      notes: "exact-window counter delta",
    },
    {
      metric: "stored bars compact/object",
      baseline: "compact=bars / object=0",
      captured: storedBarsCache
        ? `${formatMaybeNumber(storedBarsCache.compactBarCount, 0)}/${formatMaybeNumber(
            storedBarsCache.barCount,
            0,
          )} / ${formatMaybeNumber(storedBarsCache.objectBarCount, 0)}`
        : "n-a",
      verdict:
        storedBarsCache &&
        storedBarsCache.compactBarCount === storedBarsCache.barCount &&
        storedBarsCache.objectBarCount === 0
          ? "PASS"
          : "FAIL",
      notes: "end-of-window resident cache",
    },
    {
      metric: "incremental evaluator parity",
      baseline: "0 shadow mismatches",
      captured: formatMaybeNumber(counterDelta.incrementalShadowMismatches, 0),
      verdict: incrementalAcceptance.parityVerdict,
      notes: "exact-window incremental-vs-from-scratch checks",
    },
    {
      metric: "stored-state transition churn",
      baseline: "observational",
      captured: formatMaybeNumber(counterDelta.matrixServeMismatchCount, 0),
      verdict: incrementalAcceptance.storedStateChurnVerdict,
      notes: incremental?.lastMatrixServeMismatchCellKey
        ? `latest cell: ${incremental.lastMatrixServeMismatchCellKey}`
        : "legacy matrixServeMismatchCount wire field",
    },
    {
      metric: "matrix SSE / scanner progress",
      baseline: ">0 events / full cycle",
      captured: `${formatMaybeNumber(counterDelta.matrixEventCount, 0)} / ${formatMaybeNumber(
        scannerCoverage?.cycleScannedSymbols,
        0,
      )}/${formatMaybeNumber(scannerCoverage?.selectedSymbols, 0)}`,
      verdict: "OBSERVE",
      notes: "exact-window events; end-of-window scanner coverage",
    },
    {
      metric: "execution_events read max",
      baseline: `~${BASELINES.executionEventsReadMaxSec}s`,
      captured: formatMaybeSeconds(firehoseMetrics.executionEventsReadMaxSec),
      verdict: compareLower(
        firehoseMetrics.executionEventsReadMaxSec,
        BASELINES.executionEventsReadMaxSec,
      ),
      notes: "exact acceptance-window slow-query firehose",
    },
  ];
}

function renderReport(reportState, summaryRows) {
  const identity = stepData(reportState, "identity");
  const gate = stepData(reportState, "symbolStateGate");
  const cpu = stepData(reportState, "cpuProfile");
  const alloc = stepData(reportState, "allocationProfile");
  const counters = stepData(reportState, "counters");
  const firehose = stepData(reportState, "firehose");
  const unavailable = Object.entries(reportState.steps)
    .filter(([, value]) => !value.ok)
    .map(([key, value]) => `- ${key}: unavailable: ${value.unavailable}`);

  return [
    "# Market-open acceptance capture",
    "",
    `Captured: ${reportState.capturedAt}`,
    `Output dir: ${reportState.outDir}`,
    `Capture completeness: ${reportState.acceptance?.passed ? "COMPLETE" : "INCOMPLETE"}`,
    reportState.acceptance?.failedSteps?.length
      ? `Failed steps: ${reportState.acceptance.failedSteps.join(", ")}`
      : "Failed steps: none",
    "",
    "## Summary",
    "",
    renderMarkdownTable(summaryRows),
    "",
    gate?.verdictLine
      ? `## BUS-3B Gate\n\n${gate.verdictLine}\n`
      : "## BUS-3B Gate\n\nunavailable\n",
    "## Identity",
    "",
    identity
      ? renderKeyValues({
          "api pid": identity.apiPid,
          "api ppid": identity.apiPpid,
          uptime: identity.uptime,
          "running git SHA": identity.runningGitSha,
          "supervisor pid": identity.supervisorPid,
          "supervisor matches": identity.supervisorMatchCount,
          "pid2 owned": identity.pid2Owned,
        })
      : "unavailable",
    "",
    "## CPU Top Self-Time",
    "",
    cpu?.rawProfilePath
      ? `Raw profile: ${cpu.rawProfilePath}`
      : "Raw profile: unavailable",
    "",
    cpu?.topRows?.length
      ? renderRows(cpu.topRows, ["percent", "durationUs", "frame"])
      : "unavailable",
    "",
    "## Allocation Top Self-Size",
    "",
    alloc?.rawProfilePath
      ? `Raw profile: ${alloc.rawProfilePath}`
      : "Raw profile: unavailable",
    "",
    alloc
      ? renderKeyValues({
          "allocated MB/s": formatMaybeNumber(alloc.mbPerSec, 2),
          "total allocated MB": formatMaybeNumber(
            bytesToMb(alloc.totalAllocatedBytes),
            2,
          ),
          "_parseRowAsArray allocation": formatMaybePercent(
            alloc.parseRowAsArrayPercent,
          ),
          "old_space used": formatMaybeMb(alloc.oldSpaceUsedMb),
        })
      : "unavailable",
    "",
    alloc?.topRows?.length
      ? renderRows(
          alloc.topRows.map((row) => ({
            percent: formatMaybePercent(row.percent),
            selfSizeMb: formatMaybeNumber(row.selfSizeMb, 2),
            frame: row.frame,
          })),
          ["percent", "selfSizeMb", "frame"],
        )
      : "unavailable",
    "",
    "## Runtime Acceptance Window",
    "",
    counters ? fencedJson(counters) : "unavailable",
    "",
    "## Firehose Top 12",
    "",
    firehose?.topRows?.length
      ? renderRows(
          firehose.topRows.map((row) => ({
            count: row.count,
            totalSec: formatMaybeNumber(row.totalMs / 1000, 1),
            maxSec: formatMaybeNumber(row.maxMs / 1000, 1),
            shape: row.shape,
          })),
          ["count", "totalSec", "maxSec", "shape"],
        )
      : "No api-db-query-slow events in the acceptance window.",
    "",
    unavailable.length
      ? ["## Unavailable", "", ...unavailable, ""].join("\n")
      : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function renderMarkdownTable(rows) {
  const headers = ["Metric", "Baseline", "Captured", "Verdict", "Notes"];
  const body = rows.map((row) => [
    row.metric,
    row.baseline,
    row.captured,
    row.verdict,
    row.notes,
  ]);
  return renderTable(headers, body);
}

function renderRows(rows, keys) {
  const body = rows.map((row) => keys.map((key) => String(row[key] ?? "")));
  return renderTable(keys, body);
}

function renderTable(headers, body) {
  const escapeCell = (value) =>
    String(value ?? "n-a")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function renderKeyValues(values) {
  return Object.entries(values)
    .map(([key, value]) => `- ${key}: ${value ?? "n-a"}`)
    .join("\n");
}

function fencedJson(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a directory");
      parsed.out = value;
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "usage: node scripts/diag/market-open-acceptance.mjs [--out <dir>]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonIfExists(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function findRunDevSupervisors() {
  const entries = await readdir("/proc", { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    const identity = await readProcIdentity(pid);
    const cmdlineRaw = identity?.cmdlineRaw ?? "";
    const cmdline = printableCmdline(cmdlineRaw);
    if (isRunDevSupervisorProcess(cmdlineRaw, identity?.cwd, PYRUS_ROOT)) {
      matches.push({ pid, cmdline });
    }
  }
  return matches.sort((a, b) => a.pid - b.pid);
}

async function processAncestry(pid) {
  const chain = [];
  const seen = new Set();
  let current = pid;
  while (current && !seen.has(current)) {
    seen.add(current);
    const cmdlineRaw = await readProcCmdlineRaw(current);
    const ppid = await readProcPpid(current);
    chain.push({
      pid: current,
      ppid,
      cmdline: printableCmdline(cmdlineRaw),
      cmdlineRaw,
    });
    if (!ppid || ppid === current) break;
    current = ppid;
  }
  return chain;
}

async function readProcCmdlineRaw(pid) {
  try {
    return await readFile(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

async function readProcIdentity(pid) {
  // ponytail: /proc fingerprinting is the Node platform ceiling; use pidfd when Node exposes it.
  try {
    const [content, cmdlineRaw, cwd] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/cmdline`, "utf8"),
      readlink(`/proc/${pid}/cwd`),
    ]);
    const end = content.lastIndexOf(")");
    if (end === -1 || !cmdlineRaw) return null;
    const fields = content
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    const startTimeTicks = fields[19];
    return startTimeTicks ? { pid, startTimeTicks, cmdlineRaw, cwd } : null;
  } catch {
    return null;
  }
}

async function readProcPpid(pid) {
  try {
    const content = await readFile(`/proc/${pid}/stat`, "utf8");
    const end = content.lastIndexOf(")");
    if (end === -1) return null;
    const fields = content
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    const ppid = Number(fields[1]);
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

function printableCmdline(raw) {
  return raw.split("\0").filter(Boolean).join(" ");
}

function cmdlineIsPid2(raw) {
  const argv0 = raw.split("\0").find(Boolean) ?? "";
  return argv0 === "pid2" || argv0.endsWith("/pid2");
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findRecordedGitSha(value) {
  let found = null;
  const visit = (node, key = "") => {
    if (found || node == null) return;
    if (typeof node !== "object") {
      if (
        typeof node === "string" &&
        /(?:git.*sha|gitsha|commit|bundle.*sha|sha)/i.test(key) &&
        /^[0-9a-f]{7,40}$/i.test(node)
      ) {
        found = node;
      }
      return;
    }
    for (const [childKey, childValue] of Object.entries(node))
      visit(childValue, childKey);
  };
  visit(value);
  return found;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let forceKillTimer = null;
    const timer =
      options.timeoutMs == null
        ? null
        : setTimeout(() => {
            if (settled) return;
            forceKillTimer = terminateChildWithFallback(
              child,
              options.killGraceMs ?? COMMAND_KILL_GRACE_MS,
              () => {
                if (settled) return;
                settled = true;
                child.stdout.destroy();
                child.stderr.destroy();
                reject(
                  new Error(
                    `command timed out after ${options.timeoutMs}ms and was force-killed`,
                  ),
                );
              },
            );
            stderr += `\ncommand timed out after ${options.timeoutMs}ms`;
          }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function formatCallFrame(callFrame) {
  const fn = callFrame?.functionName || "(anonymous)";
  const url = callFrame?.url ? path.basename(callFrame.url) : "";
  const line =
    callFrame && Number.isFinite(callFrame.lineNumber)
      ? `:${callFrame.lineNumber + 1}`
      : "";
  return `${fn} ${url}${line}`.trim();
}

function sqlShape(sql, queryName) {
  if (queryName) return `queryName:${queryName}`;
  if (!sql) return "unknown";
  return String(sql)
    .replace(/'([^']|'')*'/g, "'?'")
    .replace(/\$\d+/g, "$?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 260);
}

function stepData(reportState, key) {
  const step = reportState.steps[key];
  return step?.ok ? step.data : null;
}

function compareLower(value, baseline) {
  const current = finiteNumber(value);
  if (current === null) return "n-a";
  if (current < baseline) return "BETTER";
  if (current > baseline) return "WORSE";
  return "n-a";
}

function compareLowerRange(value, low, high) {
  const current = finiteNumber(value);
  if (current === null) return "n-a";
  if (current < low) return "BETTER";
  if (current > high) return "WORSE";
  return "n-a";
}

function compareStoredBars(storedBarsCache) {
  if (!storedBarsCache) return "n-a";
  const hit = finiteNumber(storedBarsCache.hitCount);
  const delta = finiteNumber(storedBarsCache.deltaReadCount);
  if (hit === null && delta === null) return "n-a";
  if (
    (hit ?? 0) > BASELINES.storedBarsHitCount ||
    (delta ?? 0) > BASELINES.storedBarsDeltaReadCount
  ) {
    return "BETTER";
  }
  return "WORSE";
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bytesToMb(bytes) {
  const number = finiteNumber(bytes);
  return number === null ? null : number / 1024 / 1024;
}

function maxSeconds(values) {
  const numbers = values.map(finiteNumber).filter((value) => value !== null);
  if (numbers.length === 0) return 0;
  return Math.max(...numbers) / 1000;
}

function sumSeconds(values) {
  return (
    values.reduce((sum, value) => sum + (finiteNumber(value) ?? 0), 0) / 1000
  );
}

function formatMaybePercent(value) {
  const number = finiteNumber(value);
  return number === null ? "n-a" : `${number.toFixed(1)}%`;
}

function formatMaybeMb(value) {
  const number = finiteNumber(value);
  return number === null ? "n-a" : `${number.toFixed(0)} MB`;
}

function formatMaybeSeconds(value) {
  const number = finiteNumber(value);
  return number === null ? "n-a" : `${number.toFixed(1)}s`;
}

function formatMaybeNumber(value, digits = 1) {
  const number = finiteNumber(value);
  if (number === null) return "n-a";
  return digits === 0 ? String(Math.round(number)) : number.toFixed(digits);
}

function formatDurationMs(ms) {
  const number = finiteNumber(ms);
  if (number === null) return "n-a";
  const seconds = Math.floor(number / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function minIso(left, right) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxIso(left, right) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function utcStamp() {
  return new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:]/g, "-");
}

function trimForError(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function errorMessage(error) {
  return error?.stack || error?.message || String(error);
}
