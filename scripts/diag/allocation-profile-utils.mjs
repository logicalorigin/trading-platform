import path from "node:path";
import { tmpdir } from "node:os";

export const DEFAULT_ALLOCATION_PROFILE_DURATION_MS = 30_000;
export const MAX_ALLOCATION_PROFILE_DURATION_MS = 15 * 60_000;
export const ALLOCATION_SAMPLING_MODE = Object.freeze({
  kind: "sampled-js-heap-allocations",
  samplingIntervalBytes: 65_536,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
export const HEAP_PROFILER_SAMPLING_PARAMS = Object.freeze({
  samplingInterval: ALLOCATION_SAMPLING_MODE.samplingIntervalBytes,
  includeObjectsCollectedByMajorGC:
    ALLOCATION_SAMPLING_MODE.includeObjectsCollectedByMajorGC,
  includeObjectsCollectedByMinorGC:
    ALLOCATION_SAMPLING_MODE.includeObjectsCollectedByMinorGC,
});

const HEALTH_INSTANCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_API_NODE_OPTIONS = "--max-old-space-size=2560";

export function assertDefaultSigusr1InspectorOptions(nodeOptions) {
  const configured = String(nodeOptions ?? "");
  if (configured && configured !== CANONICAL_API_NODE_OPTIONS) {
    throw new Error(
      "NODE_OPTIONS is not the canonical API memory option and may alter the SIGUSR1 inspector",
    );
  }
}

export function canonicalApiNodeOptionsFromEnviron(raw) {
  const values = String(raw ?? "")
    .split("\0")
    .filter((entry) => entry.startsWith("NODE_OPTIONS="))
    .map((entry) => entry.slice("NODE_OPTIONS=".length));
  if (values.length > 1) {
    throw new Error("API process environment contains duplicate NODE_OPTIONS");
  }
  const nodeOptions = values[0] ?? "";
  assertDefaultSigusr1InspectorOptions(nodeOptions);
  return nodeOptions;
}

export function allocationProfilerInterruptionError(signalName) {
  if (signalName == null) return null;
  if (signalName !== "SIGINT" && signalName !== "SIGTERM") {
    throw new Error("allocation profiler recorded an invalid interruption");
  }
  return new Error(`allocation profiling interrupted by ${signalName}`);
}

export function recordAllocationProfilerInterruption(
  abortController,
  signalName,
  setExitCode = (value) => {
    process.exitCode = value;
  },
) {
  if (
    !(abortController instanceof AbortController) ||
    (signalName !== "SIGINT" && signalName !== "SIGTERM") ||
    typeof setExitCode !== "function"
  ) {
    throw new Error("allocation profiler interruption inputs are invalid");
  }
  setExitCode(1);
  if (!abortController.signal.aborted) {
    abortController.abort(
      new Error(`allocation profiling interrupted by ${signalName}`),
    );
  }
}

export function assertInspectorTargetBinding({
  identity,
  listeningInodes,
  holders,
}) {
  if (!(listeningInodes instanceof Set) || listeningInodes.size === 0) {
    throw new Error("inspector target has no listening socket");
  }
  if (!Array.isArray(holders) || holders.length !== 1) {
    throw new Error("inspector target is not the sole listener owner");
  }
  const holder = holders[0];
  if (
    holder?.pid !== identity?.pid ||
    holder?.startTimeTicks !== identity?.startTimeTicks ||
    holder?.cgroup !== identity?.cgroup ||
    !sameStringSet(holder?.socketInodes, listeningInodes)
  ) {
    throw new Error("inspector listener is not bound to the requested process");
  }
  return true;
}

export function profileArtifactPaths(profilePath) {
  return {
    profilePath,
    provenancePath: `${profilePath}.provenance.json`,
    bundleEvidencePath: `${profilePath}.dist-index.mjs`,
    sourceMapEvidencePath: `${profilePath}.dist-index.mjs.map`,
  };
}

export function assertAllocationTargetBinding({
  requestedPid,
  identity,
  heartbeat,
  nowMs,
  maxHeartbeatAgeMs,
  healthInstanceToken,
  listeningInodes,
  holders,
}) {
  const heartbeatAtMs = Date.parse(heartbeat?.updatedAt);
  if (
    !Number.isSafeInteger(requestedPid) ||
    requestedPid <= 0 ||
    identity?.pid !== requestedPid ||
    heartbeat?.pid !== requestedPid ||
    !Number.isSafeInteger(identity?.ppid) ||
    identity.ppid <= 0 ||
    heartbeat?.ppid !== identity.ppid ||
    !Number.isFinite(heartbeat?.uptimeMs) ||
    heartbeat.uptimeMs < 0 ||
    !Number.isFinite(heartbeatAtMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(maxHeartbeatAgeMs) ||
    maxHeartbeatAgeMs <= 0 ||
    nowMs - heartbeatAtMs < 0 ||
    nowMs - heartbeatAtMs > maxHeartbeatAgeMs
  ) {
    throw new Error(
      "allocation target heartbeat does not bind the requested process",
    );
  }
  if (!isValidHealthInstanceToken(healthInstanceToken)) {
    throw new Error("allocation target health instance is missing or invalid");
  }
  if (!(listeningInodes instanceof Set) || listeningInodes.size === 0) {
    throw new Error("allocation target has no bound listening socket");
  }
  if (!Array.isArray(holders) || holders.length !== 1) {
    throw new Error("allocation target is not the sole listening socket owner");
  }
  const holder = holders[0];
  if (
    holder?.pid !== requestedPid ||
    holder?.startTimeTicks !== identity?.startTimeTicks ||
    typeof identity?.cgroup !== "string" ||
    identity.cgroup === "" ||
    holder?.cgroup !== identity.cgroup ||
    !sameStringSet(holder?.socketInodes, listeningInodes)
  ) {
    throw new Error("allocation target does not own every listening socket");
  }
  return true;
}

export function isValidHealthInstanceToken(value) {
  return typeof value === "string" && HEALTH_INSTANCE_PATTERN.test(value);
}

export async function cleanupHeapProfilerStrict(inspector, samplingStarted) {
  const errors = [];
  if (samplingStarted) {
    try {
      await inspector.send("HeapProfiler.stopSampling");
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await inspector.send("HeapProfiler.disable");
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "heap profiler cleanup failed");
  }
}

export function parseAllocationProfilerArgs(
  argv,
  { cwd = process.cwd(), tempDirectory = tmpdir(), nowMs = Date.now() } = {},
) {
  if (argv.length < 1 || argv.length > 3) {
    throw new Error("expected <pid> [durationMs] [outPath]");
  }
  const pid = Number(argv[0]);
  const durationMs = Number(argv[1] ?? DEFAULT_ALLOCATION_PROFILE_DURATION_MS);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("pid must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_ALLOCATION_PROFILE_DURATION_MS
  ) {
    throw new Error(
      `durationMs must be a positive safe integer no greater than ${MAX_ALLOCATION_PROFILE_DURATION_MS}`,
    );
  }

  const suppliedOutPath = argv[2];
  if (
    suppliedOutPath != null &&
    (suppliedOutPath.trim() === "" || suppliedOutPath.includes("\0"))
  ) {
    throw new Error("outPath must be a non-empty filesystem path");
  }
  const defaultName = `pyrus-allocation-${pid}-${utcStamp(nowMs)}.heapprofile`;
  const outPath = path.resolve(
    suppliedOutPath == null ? tempDirectory : cwd,
    suppliedOutPath ?? defaultName,
  );
  return { pid, durationMs, outPath };
}

export function validateInspectorWebSocketUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("inspector target returned an invalid websocket URL");
  }
  if (
    url.protocol !== "ws:" ||
    url.port !== "9229" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("inspector websocket URL is not loopback port 9229");
  }
  return url.href;
}

export function summarizeAllocationProfile(profile, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("allocation profile duration must be positive and finite");
  }
  if (!profile?.head || typeof profile.head !== "object") {
    throw new Error("allocation profile requires a head node");
  }

  const byFrame = new Map();
  const stack = [profile.head];
  let totalBytes = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      throw new Error("allocation profile contains an invalid node");
    }
    if (!Number.isSafeInteger(node.selfSize) || node.selfSize < 0) {
      throw new Error("allocation profile contains an invalid selfSize");
    }
    const children = node.children ?? [];
    if (!Array.isArray(children)) {
      throw new Error("allocation profile contains invalid children");
    }
    for (const child of children) stack.push(child);

    totalBytes += node.selfSize;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new Error(
        "allocation profile byte total exceeds safe integer range",
      );
    }
    if (node.selfSize === 0) continue;
    const frame = normalizedCallFrame(node.callFrame);
    const current = byFrame.get(frame.key) ?? {
      frame: frame.label,
      selfSizeBytes: 0,
    };
    current.selfSizeBytes += node.selfSize;
    byFrame.set(frame.key, current);
  }

  const durationSeconds = durationMs / 1_000;
  const rows = [...byFrame.values()]
    .map((row) => ({
      ...row,
      selfSizeMb: bytesToMb(row.selfSizeBytes),
      mbPerSec: bytesToMb(row.selfSizeBytes) / durationSeconds,
      percent: totalBytes > 0 ? (row.selfSizeBytes / totalBytes) * 100 : 0,
    }))
    .sort(
      (left, right) =>
        right.selfSizeBytes - left.selfSizeBytes ||
        left.frame.localeCompare(right.frame),
    );

  return {
    samplingMode: ALLOCATION_SAMPLING_MODE,
    durationMs,
    totalBytes,
    totalMb: bytesToMb(totalBytes),
    mbPerSec: bytesToMb(totalBytes) / durationSeconds,
    rows,
  };
}

function normalizedCallFrame(callFrame = {}) {
  const functionName = callFrame.functionName || "(anonymous)";
  const scriptId = String(callFrame.scriptId ?? "");
  const url = callFrame.url || "(native)";
  const line = Number.isInteger(callFrame.lineNumber)
    ? Math.max(0, callFrame.lineNumber + 1)
    : 0;
  const column = Number.isInteger(callFrame.columnNumber)
    ? Math.max(0, callFrame.columnNumber + 1)
    : 0;
  return {
    key: JSON.stringify([functionName, scriptId, url, line, column]),
    label: `${functionName} ${url}:${line}:${column} [script ${scriptId || "n-a"}]`,
  };
}

function bytesToMb(bytes) {
  return bytes / 1024 / 1024;
}

function sameStringSet(left, right) {
  return (
    left instanceof Set &&
    right instanceof Set &&
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function utcStamp(nowMs) {
  const date = new Date(nowMs);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("default output timestamp is invalid");
  }
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}
