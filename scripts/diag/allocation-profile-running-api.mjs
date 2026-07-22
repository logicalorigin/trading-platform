#!/usr/bin/env node
// Sample V8 heap allocations in the already-running API without reloading it.
// Usage: node scripts/diag/allocation-profile-running-api.mjs <pid> [durationMs=30000] [outPath]
// Collected objects are included. This is statistical allocation traffic, not
// retained-heap measurement, and excludes external/ArrayBuffer backing/native bytes.

import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import {
  HEAP_PROFILER_SAMPLING_PARAMS,
  allocationProfilerInterruptionError,
  assertAllocationTargetBinding,
  assertInspectorTargetBinding,
  canonicalApiNodeOptionsFromEnviron,
  cleanupHeapProfilerStrict,
  isValidHealthInstanceToken,
  parseAllocationProfilerArgs,
  profileArtifactPaths,
  recordAllocationProfilerInterruption,
  summarizeAllocationProfile,
  validateInspectorWebSocketUrl,
} from "./allocation-profile-utils.mjs";
import { readInspectorProcessId } from "./cpu-profile-utils.mjs";
import {
  assertApiDescendsFromSupervisor,
  assertApiProcessRole,
  isRunDevSupervisorProcess,
  withTimeout,
} from "./market-open-acceptance-utils.mjs";
import { createProcInspector } from "../reap-dev-port.mjs";
import {
  hasPyrusWorkflowAncestry,
  parseProcStat,
  processIdentityMatches,
  readProcIdentity,
  signalStableProcess,
} from "../replit-process-authority.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const API_ROOT = path.join(REPO_ROOT, "artifacts", "api-server");
const API_ENTRYPOINT = "./dist/index.mjs";
const API_BUNDLE_PATH = path.join(API_ROOT, "dist", "index.mjs");
const API_SOURCE_MAP_PATH = `${API_BUNDLE_PATH}.map`;
const PYRUS_ROOT = path.join(REPO_ROOT, "artifacts", "pyrus");
const RECORDER_DIR = process.env.PYRUS_FLIGHT_RECORDER_DIR
  ? path.resolve(process.env.PYRUS_FLIGHT_RECORDER_DIR)
  : path.join(REPO_ROOT, ".pyrus-runtime", "flight-recorder");
const API_HEARTBEAT_PATH = path.join(RECORDER_DIR, "api-current.json");
const API_PORT = 8_080;
const INSPECTOR_PORT = 9_229;
const INSPECTOR_URL = "http://127.0.0.1:9229/json/list";
const INSPECTOR_DISCOVERY_TIMEOUT_MS = 5_000;
const CDP_COMMAND_TIMEOUT_MS = 60_000;
const HEARTBEAT_MAX_AGE_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5_000;
const INTERRUPT_CLEANUP_TIMEOUT_MS = 5_000;
const NORMAL_CLEANUP_TIMEOUT_MS = CDP_COMMAND_TIMEOUT_MS + 5_000;
const INSPECTOR_CLOSE_EXPRESSION =
  'process.getBuiltinModule("node:inspector").close()';

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  let options;
  try {
    options = parseAllocationProfilerArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      "usage: allocation-profile-running-api.mjs <pid> [durationMs=30000] [outPath]",
    );
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
  if (options) {
    try {
      await runAllocationProfile(options);
    } catch (error) {
      console.error(errorMessage(error));
      process.exitCode = 1;
    }
  }
}

export async function runAllocationProfile({ pid, durationMs, outPath }) {
  const artifactPaths = profileArtifactPaths(outPath);
  await Promise.all(
    Object.values(artifactPaths).map((artifactPath) =>
      assertOutputPathReady(artifactPath),
    ),
  );
  const procInspector = createProcInspector();
  assertInspectorPortClosed(procInspector, "before SIGUSR1");
  const interruption = installInterruptionHandlers();

  let inspector = null;
  let samplingStarted = false;
  let signalSent = false;
  let samplingError = null;
  let cleanupError = null;
  let deactivationError = null;
  let profile;
  let inspectorOwnership;
  let initialBinding;
  let attachedBinding;
  let finalBinding;
  let sourceEvidence;
  let samplingStartAcknowledgedAt;
  let samplingStopRequestedAt;
  let profileReceivedAt;
  let stopResponseLatencyMs;
  let samplingStartedMonoMs;
  let samplingStopRequestedMonoMs;

  try {
    initialBinding = await captureValidatedTarget(pid, procInspector);
    sourceEvidence = await captureSourceEvidence();
    assertSourceEvidencePredatesProcess(sourceEvidence, initialBinding);
    interruption.controller.signal.throwIfAborted();

    const preSignalBinding = await captureValidatedTarget(
      pid,
      procInspector,
      initialBinding.healthInstanceToken,
    );
    assertSameBinding(initialBinding, preSignalBinding, "before SIGUSR1");
    if (!signalStableProcess(preSignalBinding.identity, "SIGUSR1")) {
      throw new Error(`API process ${pid} changed before SIGUSR1`);
    }
    signalSent = true;

    inspector = await openInspector(pid);
    inspectorOwnership = captureInspectorTarget(
      procInspector,
      initialBinding.identity,
    );
    attachedBinding = await captureValidatedTarget(
      pid,
      procInspector,
      initialBinding.healthInstanceToken,
    );
    assertSameBinding(
      initialBinding,
      attachedBinding,
      "before allocation sampling",
    );

    await inspector.send("HeapProfiler.enable");
    await inspector.send(
      "HeapProfiler.startSampling",
      HEAP_PROFILER_SAMPLING_PARAMS,
    );
    samplingStarted = true;
    samplingStartAcknowledgedAt = new Date().toISOString();
    samplingStartedMonoMs = performance.now();
    console.error(`sampling allocations in pid ${pid} for ${durationMs}ms ...`);
    await sleep(durationMs, undefined, {
      signal: interruption.controller.signal,
    });
    samplingStopRequestedAt = new Date().toISOString();
    samplingStopRequestedMonoMs = performance.now();
    ({ profile } = await inspector.send("HeapProfiler.stopSampling"));
    profileReceivedAt = new Date().toISOString();
    stopResponseLatencyMs = performance.now() - samplingStopRequestedMonoMs;
    samplingStarted = false;
  } catch (error) {
    samplingError = error;
  } finally {
    if (!inspector && signalSent) {
      try {
        inspector = await openInspector(pid);
      } catch (error) {
        deactivationError = new Error(
          "could not reconnect to deactivate the SIGUSR1-opened inspector",
          { cause: error },
        );
      }
    }
    if (inspector) {
      const cleanupTimeoutMs = interruption.signal
        ? INTERRUPT_CLEANUP_TIMEOUT_MS
        : NORMAL_CLEANUP_TIMEOUT_MS;
      try {
        await cleanupWithDeadline(inspector, samplingStarted, cleanupTimeoutMs);
      } catch (error) {
        cleanupError = error;
      }
      try {
        await deactivateInspector(inspector, procInspector);
      } catch (error) {
        deactivationError = deactivationError
          ? new AggregateError(
              [deactivationError, error],
              "inspector reconnect and deactivation both failed",
            )
          : error;
      } finally {
        inspector.close();
      }
    }
    // Retain the handlers through natural exit. Removing them here creates a
    // window where an already-queued OS signal can lose its nonzero verdict.
  }

  const protocolErrors = [
    samplingError,
    cleanupError,
    deactivationError,
    allocationProfilerInterruptionError(interruption.signal),
  ].filter(Boolean);
  if (protocolErrors.length > 0) {
    throw protocolErrors.length === 1
      ? protocolErrors[0]
      : new AggregateError(
          protocolErrors,
          "allocation sampling, cleanup, or inspector deactivation failed",
        );
  }
  if (
    !profile ||
    samplingStartedMonoMs == null ||
    samplingStopRequestedMonoMs == null
  ) {
    throw new Error(
      "allocation sampling completed without a measured profile window",
    );
  }

  finalBinding = await captureValidatedTarget(
    pid,
    procInspector,
    initialBinding.healthInstanceToken,
  );
  assertSameBinding(initialBinding, finalBinding, "after allocation sampling");
  assertInspectorPortClosed(procInspector, "after profiler deactivation");
  await assertSourceEvidenceUnchanged(sourceEvidence);

  const measuredDurationMs =
    samplingStopRequestedMonoMs - samplingStartedMonoMs;
  if (!Number.isFinite(measuredDurationMs) || measuredDurationMs <= 0) {
    throw new Error("measured allocation sampling duration is invalid");
  }
  const summary = summarizeAllocationProfile(profile, measuredDurationMs);
  const profileContent = `${JSON.stringify(profile)}\n`;
  await Promise.all([
    writeExclusive(artifactPaths.profilePath, profileContent),
    writeExclusive(
      artifactPaths.bundleEvidencePath,
      sourceEvidence.bundle.content,
    ),
    writeExclusive(
      artifactPaths.sourceMapEvidencePath,
      sourceEvidence.sourceMap.content,
    ),
  ]);
  const provenance = buildProvenance({
    artifactPaths,
    requestedDurationMs: durationMs,
    measuredDurationMs,
    samplingStartAcknowledgedAt,
    samplingStopRequestedAt,
    profileReceivedAt,
    stopResponseLatencyMs,
    initialBinding,
    attachedBinding,
    finalBinding,
    sourceEvidence,
    inspectorOwnership,
    profileContent,
  });
  await writeExclusive(
    artifactPaths.provenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
  );

  console.error(`raw profile: ${artifactPaths.profilePath}`);
  console.error(`provenance: ${artifactPaths.provenancePath}`);
  console.log(
    `mode=${summary.samplingMode.kind} ` +
      `samplingIntervalBytes=${summary.samplingMode.samplingIntervalBytes} ` +
      `collectedByMajorGC=${summary.samplingMode.includeObjectsCollectedByMajorGC} ` +
      `collectedByMinorGC=${summary.samplingMode.includeObjectsCollectedByMinorGC} ` +
      "retainedHeapMeasurement=false includesExternalNativeBytes=false",
  );
  console.log(
    `total sampled bytes=${summary.totalBytes} totalMB=${summary.totalMb.toFixed(2)} ` +
      `MBps=${summary.mbPerSec.toFixed(2)} measuredDurationMs=${summary.durationMs.toFixed(3)} ` +
      `requestedDurationMs=${durationMs}`,
  );
  console.log("top sampled allocation bytes by call frame:");
  for (const row of summary.rows.slice(0, 30)) {
    console.log(
      `${row.percent.toFixed(1).padStart(6)}%  ${String(row.selfSizeBytes).padStart(12)}  ` +
        `${row.mbPerSec.toFixed(2).padStart(8)} MBps  ${row.frame}`,
    );
  }
}

async function captureValidatedTarget(
  pid,
  procInspector,
  expectedToken = null,
) {
  const [heartbeat, healthInstanceToken] = await Promise.all([
    readJson(API_HEARTBEAT_PATH),
    readHealthInstanceToken(),
  ]);
  const identity = validatedApiIdentity(pid, procInspector);
  const listeningInodes = procInspector.listeningInodes(API_PORT);
  if (listeningInodes === null) {
    throw new Error("Linux listening socket tables are unavailable");
  }
  const holders = procInspector.findHolders(listeningInodes);
  if (holders === null) throw new Error("Linux process table is unavailable");
  assertAllocationTargetBinding({
    requestedPid: pid,
    identity,
    heartbeat,
    nowMs: Date.now(),
    maxHeartbeatAgeMs: HEARTBEAT_MAX_AGE_MS,
    healthInstanceToken,
    listeningInodes,
    holders,
  });
  if (expectedToken != null && healthInstanceToken !== expectedToken) {
    throw new Error("API health instance changed during allocation profiling");
  }
  const revalidatedIdentity = validatedApiIdentity(pid, procInspector);
  if (
    !processIdentityMatches(identity, revalidatedIdentity) ||
    identity.ppid !== revalidatedIdentity.ppid ||
    identity.cgroup !== revalidatedIdentity.cgroup
  ) {
    throw new Error(
      "API process identity changed while binding profiler target",
    );
  }
  return {
    capturedAt: new Date().toISOString(),
    identity,
    heartbeat: {
      pid: heartbeat.pid,
      ppid: heartbeat.ppid,
      updatedAt: heartbeat.updatedAt,
      uptimeMs: heartbeat.uptimeMs,
    },
    healthInstanceToken,
    listeningInodes: [...listeningInodes].sort(),
  };
}

function assertSameBinding(expected, observed, phase) {
  if (
    !processIdentityMatches(expected?.identity, observed?.identity) ||
    expected?.identity?.ppid !== observed?.identity?.ppid ||
    expected?.identity?.cgroup !== observed?.identity?.cgroup ||
    expected?.healthInstanceToken !== observed?.healthInstanceToken
  ) {
    throw new Error(`API process binding changed ${phase}`);
  }
}

async function readHealthInstanceToken() {
  const response = await fetch(`http://127.0.0.1:${API_PORT}/api/healthz`, {
    headers: { accept: "application/json", connection: "close" },
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  const body = await response.text();
  const token = response.headers.get("x-pyrus-health-instance");
  if (
    response.status !== 200 ||
    body !== '{"status":"ok"}' ||
    response.headers.get("content-type") !==
      "application/json; charset=utf-8" ||
    !isValidHealthInstanceToken(token)
  ) {
    throw new Error(
      "direct API health response does not bind one valid instance",
    );
  }
  return token;
}

async function readJson(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} does not contain a JSON object`);
  }
  return value;
}

function assertInspectorPortClosed(procInspector, phase) {
  const listeningInodes = procInspector.listeningInodes(INSPECTOR_PORT);
  if (listeningInodes === null) {
    throw new Error(`cannot inspect the inspector port ${phase}`);
  }
  if (listeningInodes.size > 0) {
    const holders = procInspector.findHolders(listeningInodes);
    throw new Error(
      `inspector port ${INSPECTOR_PORT} is already listening ${phase}; holders=${holders?.map((holder) => holder.pid).join(",") ?? "unavailable"}`,
    );
  }
}

function captureInspectorTarget(procInspector, identity) {
  const listeningInodes = procInspector.listeningInodes(INSPECTOR_PORT);
  if (listeningInodes === null) {
    throw new Error("cannot inspect the activated inspector port");
  }
  const holders = procInspector.findHolders(listeningInodes);
  if (holders === null) {
    throw new Error("cannot enumerate the activated inspector listener");
  }
  assertInspectorTargetBinding({ identity, listeningInodes, holders });
  return {
    listeningInodes: [...listeningInodes].sort(),
    holders: holders.map((holder) => ({
      pid: holder.pid,
      startTimeTicks: holder.startTimeTicks,
      cgroup: holder.cgroup,
      socketInodes: [...holder.socketInodes].sort(),
    })),
  };
}

async function cleanupWithDeadline(inspector, samplingStarted, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  await cleanupHeapProfilerStrict(
    {
      send(method, params = {}) {
        const remainingMs = Math.max(
          1,
          Math.ceil(deadline - performance.now()),
        );
        return inspector.send(method, params, remainingMs);
      },
    },
    samplingStarted,
  );
}

async function deactivateInspector(inspector, procInspector) {
  let commandError = null;
  try {
    await inspector.send(
      "Runtime.evaluate",
      { expression: INSPECTOR_CLOSE_EXPRESSION },
      INTERRUPT_CLEANUP_TIMEOUT_MS,
    );
  } catch (error) {
    // inspector.close() forcibly terminates this WebSocket, so rejection is
    // expected; the listening socket check below is the authoritative result.
    commandError = error;
  } finally {
    inspector.close();
  }
  const deadline = performance.now() + INTERRUPT_CLEANUP_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const inodes = procInspector.listeningInodes(INSPECTOR_PORT);
    if (inodes === null) {
      throw new Error("cannot verify that the inspector listener closed", {
        cause: commandError ?? undefined,
      });
    }
    if (inodes.size === 0) return;
    await sleep(Math.min(50, Math.max(1, deadline - performance.now())));
  }
  throw new Error(
    "SIGUSR1-opened inspector remained active after deactivation",
    {
      cause: commandError ?? undefined,
    },
  );
}

function installInterruptionHandlers() {
  const controller = new AbortController();
  let receivedSignal = null;
  const interrupt = (signal) => {
    receivedSignal ??= signal;
    recordAllocationProfilerInterruption(controller, signal);
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return {
    controller,
    get signal() {
      return receivedSignal;
    },
  };
}

async function captureSourceEvidence() {
  const capturedAt = new Date().toISOString();
  const [bundle, sourceMap] = await Promise.all([
    readStableFileSnapshot(API_BUNDLE_PATH),
    readStableFileSnapshot(API_SOURCE_MAP_PATH),
  ]);
  return { capturedAt, bundle, sourceMap };
}

async function assertSourceEvidenceUnchanged(evidence) {
  const [bundle, sourceMap] = await Promise.all([
    readStableFileSnapshot(API_BUNDLE_PATH),
    readStableFileSnapshot(API_SOURCE_MAP_PATH),
  ]);
  for (const [label, initial, current] of [
    ["API bundle", evidence.bundle, bundle],
    ["API source map", evidence.sourceMap, sourceMap],
  ]) {
    if (
      initial.sha256 !== current.sha256 ||
      initial.sizeBytes !== current.sizeBytes
    ) {
      throw new Error(`${label} changed during allocation profiling`);
    }
  }
}

function assertSourceEvidencePredatesProcess(evidence, binding) {
  const updatedAtMs = Date.parse(binding?.heartbeat?.updatedAt);
  const uptimeMs = binding?.heartbeat?.uptimeMs;
  if (
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(uptimeMs) ||
    uptimeMs < 0
  ) {
    throw new Error("API heartbeat cannot establish process start time");
  }
  const estimatedProcessStartMs = updatedAtMs - uptimeMs;
  for (const snapshot of [evidence.bundle, evidence.sourceMap]) {
    if (Date.parse(snapshot.mtime) > estimatedProcessStartMs + 1_000) {
      throw new Error(
        `source evidence is newer than the profiled API process: ${snapshot.sourcePath}`,
      );
    }
  }
}

async function readStableFileSnapshot(sourcePath) {
  const handle = await open(sourcePath, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile())
      throw new Error(`source evidence is not a file: ${sourcePath}`);
    const content = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      content.byteLength !== after.size
    ) {
      throw new Error(`source evidence changed while reading: ${sourcePath}`);
    }
    return {
      sourcePath,
      content,
      sizeBytes: content.byteLength,
      sha256: sha256(content),
      mtime: after.mtime.toISOString(),
      device: after.dev,
      inode: after.ino,
    };
  } finally {
    await handle.close();
  }
}

function buildProvenance({
  artifactPaths,
  requestedDurationMs,
  measuredDurationMs,
  samplingStartAcknowledgedAt,
  samplingStopRequestedAt,
  profileReceivedAt,
  stopResponseLatencyMs,
  initialBinding,
  attachedBinding,
  finalBinding,
  sourceEvidence,
  inspectorOwnership,
  profileContent,
}) {
  const source = (snapshot, evidencePath) => ({
    sourcePath: snapshot.sourcePath,
    evidencePath,
    sha256: snapshot.sha256,
    sizeBytes: snapshot.sizeBytes,
    mtime: snapshot.mtime,
    device: snapshot.device,
    inode: snapshot.inode,
  });
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile: {
      path: artifactPaths.profilePath,
      sha256: sha256(profileContent),
      sizeBytes: Buffer.byteLength(profileContent),
      mode: "sampled-js-heap-allocations",
    },
    timing: {
      requestedDurationMs,
      measuredSamplingDurationMs: measuredDurationMs,
      measurementBasis: "start-command-acknowledged-to-stop-command-requested",
      samplingStartAcknowledgedAt,
      samplingStopRequestedAt,
      profileReceivedAt,
      stopResponseLatencyMs,
    },
    target: {
      initial: serializableBinding(initialBinding),
      attached: serializableBinding(attachedBinding),
      final: serializableBinding(finalBinding),
    },
    inspector: {
      activation: "SIGUSR1",
      endpoint: INSPECTOR_URL,
      preexistingListener: false,
      deactivation: "Runtime.evaluate node:inspector.close()",
      deactivationListenerClosedObserved: true,
      activatedListenerOwnership: inspectorOwnership,
    },
    sourceEvidenceCapturedAt: sourceEvidence.capturedAt,
    sourceMappingBasis: {
      bundleAndMapPredateProcessAndStayedByteIdentical: true,
      loadedScriptBytesDirectlyReadFromV8: false,
    },
    sources: {
      bundle: source(sourceEvidence.bundle, artifactPaths.bundleEvidencePath),
      sourceMap: source(
        sourceEvidence.sourceMap,
        artifactPaths.sourceMapEvidencePath,
      ),
    },
    runtime: { nodeVersion: process.version, profilerPid: process.pid },
  };
}

function serializableBinding(binding) {
  return {
    capturedAt: binding.capturedAt,
    identity: {
      pid: binding.identity.pid,
      ppid: binding.identity.ppid,
      startTimeTicks: binding.identity.startTimeTicks,
      cwd: binding.identity.cwd,
      argv: binding.identity.cmdlineRaw.split("\0").filter(Boolean),
      cgroup: binding.identity.cgroup,
    },
    heartbeat: binding.heartbeat,
    estimatedProcessStartedAt: new Date(
      Date.parse(binding.heartbeat.updatedAt) - binding.heartbeat.uptimeMs,
    ).toISOString(),
    healthInstanceToken: binding.healthInstanceToken,
    apiPort: API_PORT,
    listeningInodes: binding.listeningInodes,
  };
}

async function writeExclusive(file, content) {
  await writeFile(file, content, { flag: "wx", mode: 0o600 });
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function validatedApiIdentity(pid, procInspector) {
  const identity = readProcIdentity(pid);
  if (!identity) throw new Error(`API process ${pid} is unavailable`);
  assertApiProcessRole(identity, API_ROOT, API_ENTRYPOINT);
  canonicalApiNodeOptionsFromEnviron(
    readFileSync(`/proc/${pid}/environ`, "utf8"),
  );
  if (!hasPyrusWorkflowAncestry(pid)) {
    throw new Error(
      `API process ${pid} lacks canonical pid2 workflow ancestry`,
    );
  }
  const ancestry = processAncestry(pid);
  const supervisors = ancestry.filter((entry) =>
    isRunDevSupervisorProcess(entry.cmdlineRaw, entry.cwd, PYRUS_ROOT),
  );
  if (supervisors.length !== 1) {
    throw new Error(
      `API process ${pid} ancestry has ${supervisors.length} canonical runDevApp supervisors`,
    );
  }
  assertApiDescendsFromSupervisor(ancestry, supervisors[0].pid);
  const parsed = parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
  const cgroup = procInspector.readCgroup(pid);
  if (
    !parsed ||
    parsed.startTimeTicks !== identity.startTimeTicks ||
    typeof cgroup !== "string" ||
    cgroup === ""
  ) {
    throw new Error(`API process ${pid} has incomplete process authority`);
  }
  return { ...identity, ppid: parsed.ppid, cgroup };
}

function processAncestry(pid) {
  const ancestry = [];
  const seen = new Set();
  let current = pid;
  while (current > 0 && !seen.has(current) && ancestry.length < 64) {
    seen.add(current);
    const identity = readProcIdentity(current);
    if (!identity) break;
    const parsed = parseProcStat(readFileSync(`/proc/${current}/stat`, "utf8"));
    ancestry.push({ ...identity, ppid: parsed?.ppid ?? null });
    if (!parsed || parsed.ppid <= 0 || parsed.ppid === current) break;
    current = parsed.ppid;
  }
  return ancestry;
}

async function assertOutputPathReady(outPath) {
  const parent = path.dirname(outPath);
  const parentStat = await stat(parent).catch((error) => {
    throw new Error(`output directory is unavailable: ${parent}`, {
      cause: error,
    });
  });
  if (!parentStat.isDirectory()) {
    throw new Error(`output parent is not a directory: ${parent}`);
  }
  await access(parent, constants.W_OK).catch((error) => {
    throw new Error(`output directory is not writable: ${parent}`, {
      cause: error,
    });
  });
  try {
    await lstat(outPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error(`cannot inspect output path: ${outPath}`, { cause: error });
  }
  throw new Error(`refusing to overwrite existing output path: ${outPath}`);
}

async function openInspector(pid) {
  const target = await discoverInspectorTarget();
  const inspector = await connectCdp(
    validateInspectorWebSocketUrl(target.webSocketDebuggerUrl),
  );
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

async function discoverInspectorTarget() {
  const deadline = performance.now() + INSPECTOR_DISCOVERY_TIMEOUT_MS;
  let lastError = new Error("no inspector target found");
  while (performance.now() < deadline) {
    const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
    try {
      const response = await fetch(INSPECTOR_URL, {
        signal: AbortSignal.timeout(Math.min(1_000, remainingMs)),
      });
      if (!response.ok) {
        throw new Error(`inspector list returned ${response.status}`);
      }
      const list = await response.json();
      const targets = Array.isArray(list)
        ? list.filter((item) => item?.webSocketDebuggerUrl)
        : [];
      if (targets.length !== 1) {
        throw new Error(
          `expected one inspector target, found ${targets.length}`,
        );
      }
      return targets[0];
    } catch (error) {
      lastError = error;
      const delayMs = Math.min(100, deadline - performance.now());
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw new Error(
    `inspector target unavailable after ${INSPECTOR_DISCOVERY_TIMEOUT_MS}ms: ${errorMessage(lastError)}`,
    { cause: lastError },
  );
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
  const rejectPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      rejectPending(new Error("inspector websocket returned invalid JSON"));
      ws.close();
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error
      ? reject(new Error(message.error.message ?? "inspector command failed"))
      : resolve(message.result);
  });
  ws.addEventListener("close", () => {
    rejectPending(new Error("inspector websocket closed"));
  });
  try {
    await withTimeout(opened, 5_000, "inspector websocket open");
  } catch (error) {
    ws.close();
    throw error;
  }
  return {
    send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
      return withTimeout(response, timeoutMs, `inspector ${method}`).finally(
        () => pending.delete(id),
      );
    },
    close() {
      try {
        ws.close();
      } catch {
        // Best-effort connection cleanup after protocol cleanup.
      }
    },
  };
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return `${error.message}: ${error.errors.map(errorMessage).join("; ")}`;
  }
  if (error instanceof Error) {
    return error.cause
      ? `${error.message}: ${errorMessage(error.cause)}`
      : error.message;
  }
  return String(error);
}
