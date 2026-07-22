#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  hasPyrusWorkflowAncestry,
  parseProcStat,
  processIdentityMatches,
  readProcIdentity,
} from "../replit-process-authority.mjs";
import { createProcInspector } from "../reap-dev-port.mjs";
import {
  canonicalApiNodeOptionsFromEnviron,
  isValidHealthInstanceToken,
} from "./allocation-profile-utils.mjs";
import {
  assertApiDescendsFromSupervisor,
  assertApiProcessRole,
  assertFreshApiHeartbeat,
  assertSameProcessIdentity,
  assertStableApiPid,
  isRunDevSupervisorProcess,
  parseProcCmdline,
} from "./market-open-acceptance-utils.mjs";

export const WATCH_DEFAULTS = Object.freeze({
  durationMs: 900_000,
  sampleIntervalMs: 5_000,
  probeIntervalMs: 30_000,
  maxGapMs: 7_500,
  maxWallDriftMs: 2_000,
  recorderSetupAllowanceMs: 15_000,
  healthTimeoutMs: 5_000,
  recorderFlushMs: 1_500,
  apiPort: 8_080,
  frontendPort: 18_747,
});

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..");
const API_ROOT = path.join(REPO_ROOT, "artifacts", "api-server");
const PYRUS_ROOT = path.join(REPO_ROOT, "artifacts", "pyrus");
const API_ENTRYPOINT = "./dist/index.mjs";
const API_BUNDLE_PATH = path.join(API_ROOT, "dist", "index.mjs");
const API_SOURCE_MAP_PATH = `${API_BUNDLE_PATH}.map`;
const RECORDER_DIR = process.env.PYRUS_FLIGHT_RECORDER_DIR
  ? path.resolve(process.env.PYRUS_FLIGHT_RECORDER_DIR)
  : path.join(REPO_ROOT, ".pyrus-runtime", "flight-recorder");
const HEALTH_CONTENT_TYPE = "application/json; charset=utf-8";
const HEALTH_BODY = '{"status":"ok"}';
const MAX_HEALTH_BODY_BYTES = 1_024;
const MAX_HEARTBEAT_JSON_BYTES = 1024 * 1024;
const MAX_RECORDER_SLICE_BYTES = 64 * 1_024 * 1_024;
const RECORDER_CADENCE_TOLERANCE = 1.5;
const MAX_API_HEARTBEAT_INTERVAL_MS = Math.floor(
  WATCH_DEFAULTS.recorderSetupAllowanceMs / RECORDER_CADENCE_TOLERANCE,
);
const MAX_API_MEMORY_INTERVAL_MS = 60_000;
const MAX_API_FLUSH_INTERVAL_MS =
  WATCH_DEFAULTS.recorderSetupAllowanceMs - 1_000;
const INSPECTOR_PORT = 9_229;
const API_HEARTBEAT_INTERVAL_DEFAULT_MS = 5_000;
const API_MEMORY_INTERVAL_DEFAULT_MS = 30_000;
const API_FLUSH_INTERVAL_DEFAULT_MS = 1_000;
const EXECUTABLE_SOURCE_SPECS = Object.freeze([
  { name: "watch-source-00-same-process-runtime-watch.mjs", path: SCRIPT_PATH },
  {
    name: "watch-source-01-replit-process-authority.mjs",
    path: path.join(REPO_ROOT, "scripts", "replit-process-authority.mjs"),
  },
  {
    name: "watch-source-02-reap-dev-port.mjs",
    path: path.join(REPO_ROOT, "scripts", "reap-dev-port.mjs"),
  },
  {
    name: "watch-source-03-market-open-acceptance-utils.mjs",
    path: path.join(
      REPO_ROOT,
      "scripts",
      "diag",
      "market-open-acceptance-utils.mjs",
    ),
  },
  {
    name: "watch-source-04-allocation-profile-utils.mjs",
    path: path.join(
      REPO_ROOT,
      "scripts",
      "diag",
      "allocation-profile-utils.mjs",
    ),
  },
  {
    name: "watch-runtime-00-dist-index.mjs",
    path: API_BUNDLE_PATH,
    runtimeArtifact: true,
  },
  {
    name: "watch-runtime-01-dist-index.mjs.map",
    path: API_SOURCE_MAP_PATH,
    runtimeArtifact: true,
  },
]);

export function recorderTimingsFromEnviron(raw) {
  const environment = new Map();
  for (const entry of String(raw ?? "").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator > 0)
      environment.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  const interval = (name, fallback, max) => {
    const configured = environment.get(name);
    if (configured == null) return fallback;
    if (!/^[1-9][0-9]*$/u.test(configured)) {
      throw new Error(`${name} must be a positive integer interval`);
    }
    const parsed = Number(configured);
    if (!Number.isSafeInteger(parsed) || parsed > max) {
      throw new Error(`${name} exceeds the same-process watch contract`);
    }
    return parsed;
  };
  const apiHeartbeatIntervalMs = interval(
    "PYRUS_API_FLIGHT_RECORDER_INTERVAL_MS",
    API_HEARTBEAT_INTERVAL_DEFAULT_MS,
    MAX_API_HEARTBEAT_INTERVAL_MS,
  );
  const apiMemoryIntervalMs = interval(
    "PYRUS_API_FLIGHT_RECORDER_MEMORY_SAMPLE_MS",
    API_MEMORY_INTERVAL_DEFAULT_MS,
    MAX_API_MEMORY_INTERVAL_MS,
  );
  const apiFlushIntervalMs = interval(
    "PYRUS_API_FLIGHT_RECORDER_FLUSH_MS",
    API_FLUSH_INTERVAL_DEFAULT_MS,
    MAX_API_FLUSH_INTERVAL_MS,
  );
  return {
    apiHeartbeatIntervalMs,
    apiHeartbeatMaxGapMs: Math.ceil(
      apiHeartbeatIntervalMs * RECORDER_CADENCE_TOLERANCE,
    ),
    apiMemoryIntervalMs,
    apiMemoryMaxGapMs: Math.ceil(
      apiMemoryIntervalMs * RECORDER_CADENCE_TOLERANCE,
    ),
    apiFlushIntervalMs,
    recorderSettleMs: Math.max(
      WATCH_DEFAULTS.recorderFlushMs,
      apiFlushIntervalMs + 1_000,
    ),
  };
}

export { canonicalApiNodeOptionsFromEnviron };

export function assertCanonicalApiNodeOptionsUnchanged(expected, observed) {
  if (typeof expected !== "string" || typeof observed !== "string") {
    throw new Error("canonical API NODE_OPTIONS evidence must be a string");
  }
  if (expected !== observed) {
    throw new Error("API NODE_OPTIONS changed during the same-process watch");
  }
  return true;
}

export function boundedWatchInterruptionReason(signal, maxLength = 256) {
  if (!Number.isSafeInteger(maxLength) || maxLength <= 0 || maxLength > 1_024) {
    throw new Error("watch interruption reason bound is invalid");
  }
  if (!signal?.aborted) return null;
  const reason = errorMessage(signal.reason ?? "watch interrupted")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .trim();
  return (reason || "watch interrupted").slice(0, maxLength);
}

export function recordWatchInterruption(
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
    throw new Error("watch interruption inputs are invalid");
  }
  setExitCode(1);
  if (!abortController.signal.aborted) {
    abortController.abort(new Error(`watch interrupted by ${signalName}`));
  }
}

export function watchEvidenceAcceptance({
  primaryError,
  finalizationErrors,
  signal,
}) {
  if (!Array.isArray(finalizationErrors)) {
    throw new Error("watch finalization errors must be an array");
  }
  const interruptionReason = boundedWatchInterruptionReason(signal);
  return {
    evidenceIntegrityPassed:
      primaryError == null &&
      finalizationErrors.length === 0 &&
      interruptionReason == null,
    interruptionReason,
  };
}

export function assertRuntimeChainRoles(
  chain,
  { repoRoot, apiRoot, pyrusRoot },
) {
  if (!Array.isArray(chain) || chain.length !== 5) {
    throw new Error(
      `runtime chain must contain exactly API, API launcher, supervisor, workflow launcher, and pid2; found ${chain?.length ?? "n-a"}`,
    );
  }
  for (let index = 0; index < chain.length - 1; index += 1) {
    if (chain[index]?.ppid !== chain[index + 1]?.pid) {
      throw new Error(`runtime chain parent link is broken at depth ${index}`);
    }
  }
  const cgroup = chain[0]?.cgroup;
  if (
    typeof cgroup !== "string" ||
    cgroup === "" ||
    chain.slice(0, 4).some((entry) => entry?.cgroup !== cgroup) ||
    typeof chain[4]?.cgroup !== "string" ||
    chain[4].cgroup === ""
  ) {
    throw new Error(
      "runtime application chain cgroup identity is incomplete or mixed",
    );
  }

  assertApiProcessRole(chain[0], apiRoot, API_ENTRYPOINT);
  const supervisorPid = positivePid(chain[2]?.pid, "supervisor chain pid");
  assertApiDescendsFromSupervisor(chain, supervisorPid);
  if (
    !exactPnpmRole(chain[1], repoRoot, [
      "--filter",
      "@workspace/api-server",
      "run",
      "dev",
    ])
  ) {
    throw new Error(
      "API launcher does not match the exact pnpm development role",
    );
  }
  if (
    chain[2]?.pid !== supervisorPid ||
    !isRunDevSupervisorProcess(chain[2]?.cmdlineRaw, chain[2]?.cwd, pyrusRoot)
  ) {
    throw new Error(
      "runtime chain does not contain the expected runDevApp supervisor role",
    );
  }
  if (
    !exactPnpmRole(chain[3], pyrusRoot, [
      "--filter",
      "@workspace/pyrus",
      "run",
      "dev:replit",
    ])
  ) {
    throw new Error(
      "workflow launcher does not match the exact PYRUS Replit role",
    );
  }
  if (cmdlineBasename(chain[4]?.cmdlineRaw) !== "pid2") {
    throw new Error("runtime chain does not terminate at pid2");
  }
  return chain;
}

export function assertChainUnchanged(expected, observed) {
  if (
    !Array.isArray(expected) ||
    !Array.isArray(observed) ||
    expected.length !== observed.length
  ) {
    throw new Error("runtime process chain length changed");
  }
  assertSameProcessIdentity(expected[0], observed[0]);
  for (let index = 0; index < expected.length; index += 1) {
    if (
      expected[index]?.ppid !== observed[index]?.ppid ||
      !processIdentityMatches(expected[index], observed[index])
    ) {
      throw new Error(`runtime process identity changed at depth ${index}`);
    }
  }
  return observed;
}

export function assertHeartbeatBinding({
  apiHeartbeat,
  chain,
  nowMs,
  maxAgeMs,
  apiMaxAgeMs = maxAgeMs,
}) {
  assertFreshApiHeartbeat(apiHeartbeat?.updatedAt, nowMs, apiMaxAgeMs);
  assertStableApiPid(
    chain?.[0]?.pid,
    positivePid(apiHeartbeat?.pid, "API heartbeat pid"),
  );
  if (positivePid(apiHeartbeat?.ppid, "API heartbeat ppid") !== chain[1]?.pid) {
    throw new Error(
      "API heartbeat ppid does not match the API launcher chain role",
    );
  }
  return {
    apiPid: chain[0].pid,
    apiLauncherPid: chain[1].pid,
    supervisorPid: positivePid(chain[2]?.pid, "supervisor chain pid"),
  };
}

export function assertApiHeartbeatProgress(
  previous,
  heartbeat,
  observedAtMs,
  intervalMs,
) {
  const updatedAtMs = Date.parse(heartbeat?.updatedAt);
  const maxGapMs = Math.ceil(intervalMs * RECORDER_CADENCE_TOLERANCE);
  const publication = heartbeat?.flightRecorder?.heartbeatPublication;
  const successfulPublicationSequence =
    publication?.successfulPublicationSequence;
  const cadenceViolationCount = publication?.cadenceViolationCount;
  const lastSuccessfulAttemptGapMs = publication?.lastSuccessfulAttemptGapMs;
  const maxSuccessfulAttemptGapMs = publication?.maxSuccessfulAttemptGapMs;
  const completionEvidenceThroughSequence =
    publication?.completionEvidenceThroughSequence;
  const completionCadenceViolationCount =
    publication?.completionCadenceViolationCount;
  const lastSuccessfulCompletionGapMs =
    publication?.lastSuccessfulCompletionGapMs;
  const maxSuccessfulCompletionGapMs =
    publication?.maxSuccessfulCompletionGapMs;
  const cadenceLimitMs = publication?.cadenceLimitMs;
  const writeFailureCount = publication?.writeFailureCount;
  if (
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(observedAtMs) ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    updatedAtMs > observedAtMs ||
    !Number.isSafeInteger(successfulPublicationSequence) ||
    successfulPublicationSequence <= 0 ||
    !Number.isSafeInteger(cadenceViolationCount) ||
    cadenceViolationCount < 0 ||
    !Number.isSafeInteger(writeFailureCount) ||
    writeFailureCount < 0 ||
    !Number.isFinite(maxSuccessfulAttemptGapMs) ||
    maxSuccessfulAttemptGapMs < 0 ||
    !Number.isSafeInteger(completionEvidenceThroughSequence) ||
    completionEvidenceThroughSequence !== successfulPublicationSequence - 1 ||
    !Number.isSafeInteger(completionCadenceViolationCount) ||
    completionCadenceViolationCount < 0 ||
    !Number.isFinite(maxSuccessfulCompletionGapMs) ||
    maxSuccessfulCompletionGapMs < 0 ||
    !Number.isFinite(cadenceLimitMs) ||
    cadenceLimitMs !== maxGapMs ||
    (lastSuccessfulAttemptGapMs !== null &&
      (!Number.isFinite(lastSuccessfulAttemptGapMs) ||
        lastSuccessfulAttemptGapMs < 0 ||
        lastSuccessfulAttemptGapMs > maxSuccessfulAttemptGapMs)) ||
    (lastSuccessfulCompletionGapMs !== null &&
      (!Number.isFinite(lastSuccessfulCompletionGapMs) ||
        lastSuccessfulCompletionGapMs < 0 ||
        lastSuccessfulCompletionGapMs > maxSuccessfulCompletionGapMs)) ||
    cadenceViolationCount >
      Math.max(0, successfulPublicationSequence - 2) +
        Number(lastSuccessfulAttemptGapMs > cadenceLimitMs) ||
    completionCadenceViolationCount >
      Math.max(0, completionEvidenceThroughSequence - 2) +
        Number(lastSuccessfulCompletionGapMs > cadenceLimitMs) ||
    (successfulPublicationSequence === 1
      ? lastSuccessfulAttemptGapMs !== null ||
        maxSuccessfulAttemptGapMs !== 0 ||
        cadenceViolationCount !== 0
      : lastSuccessfulAttemptGapMs === null) ||
    (successfulPublicationSequence === 2 &&
      (maxSuccessfulAttemptGapMs !== lastSuccessfulAttemptGapMs ||
        cadenceViolationCount !==
          Number(lastSuccessfulAttemptGapMs > cadenceLimitMs))) ||
    (successfulPublicationSequence <= 2
      ? lastSuccessfulCompletionGapMs !== null ||
        maxSuccessfulCompletionGapMs !== 0 ||
        completionCadenceViolationCount !== 0
      : lastSuccessfulCompletionGapMs === null) ||
    (successfulPublicationSequence === 3 &&
      (maxSuccessfulCompletionGapMs !== lastSuccessfulCompletionGapMs ||
        completionCadenceViolationCount !==
          Number(lastSuccessfulCompletionGapMs > cadenceLimitMs))) ||
    (cadenceViolationCount === 0
      ? maxSuccessfulAttemptGapMs > cadenceLimitMs
      : maxSuccessfulAttemptGapMs <= cadenceLimitMs) ||
    (completionCadenceViolationCount === 0
      ? maxSuccessfulCompletionGapMs > cadenceLimitMs
      : maxSuccessfulCompletionGapMs <= cadenceLimitMs)
  ) {
    throw new Error("API heartbeat progress inputs are invalid");
  }
  if (observedAtMs - updatedAtMs > maxGapMs) {
    throw new Error(
      `API heartbeat did not advance within the ${intervalMs}ms cadence`,
    );
  }
  if (!previous) {
    return {
      updatedAtMs,
      firstObservedAtMs: observedAtMs,
      advanceCount: 0,
      successfulPublicationSequence,
      cadenceViolationCount,
      completionEvidenceThroughSequence,
      completionCadenceViolationCount,
      writeFailureCount,
      lastSuccessfulAttemptGapMs,
      maxSuccessfulAttemptGapMs,
      lastSuccessfulCompletionGapMs,
      maxSuccessfulCompletionGapMs,
    };
  }
  if (
    updatedAtMs < previous.updatedAtMs ||
    successfulPublicationSequence < previous.successfulPublicationSequence ||
    cadenceViolationCount < previous.cadenceViolationCount ||
    completionEvidenceThroughSequence <
      previous.completionEvidenceThroughSequence ||
    completionCadenceViolationCount <
      previous.completionCadenceViolationCount ||
    writeFailureCount < previous.writeFailureCount ||
    maxSuccessfulAttemptGapMs < previous.maxSuccessfulAttemptGapMs ||
    maxSuccessfulCompletionGapMs < previous.maxSuccessfulCompletionGapMs
  ) {
    throw new Error("API heartbeat publication evidence moved backward");
  }
  const successfulPublicationAdvance =
    successfulPublicationSequence - previous.successfulPublicationSequence;
  const cadenceViolationAdvance =
    cadenceViolationCount - previous.cadenceViolationCount;
  const completionCadenceViolationAdvance =
    completionCadenceViolationCount - previous.completionCadenceViolationCount;
  if (
    cadenceViolationAdvance > successfulPublicationAdvance ||
    completionCadenceViolationAdvance > successfulPublicationAdvance
  ) {
    throw new Error(
      "API heartbeat cadence counter advanced faster than its publication evidence",
    );
  }
  if (
    successfulPublicationAdvance > 0 &&
    cadenceViolationAdvance === 0 &&
    (lastSuccessfulAttemptGapMs > cadenceLimitMs ||
      (maxSuccessfulAttemptGapMs > cadenceLimitMs &&
        maxSuccessfulAttemptGapMs > previous.maxSuccessfulAttemptGapMs))
  ) {
    throw new Error(
      "API heartbeat successful-attempt cadence counter did not advance with its violation evidence",
    );
  }
  if (
    successfulPublicationAdvance > 0 &&
    completionCadenceViolationAdvance === 0 &&
    (lastSuccessfulCompletionGapMs > cadenceLimitMs ||
      (maxSuccessfulCompletionGapMs > cadenceLimitMs &&
        maxSuccessfulCompletionGapMs > previous.maxSuccessfulCompletionGapMs))
  ) {
    throw new Error(
      "API heartbeat successful-completion cadence counter did not advance with its violation evidence",
    );
  }
  if (
    successfulPublicationAdvance === 1 &&
    (maxSuccessfulAttemptGapMs !==
      Math.max(
        previous.maxSuccessfulAttemptGapMs,
        lastSuccessfulAttemptGapMs ?? 0,
      ) ||
      maxSuccessfulCompletionGapMs !==
        Math.max(
          previous.maxSuccessfulCompletionGapMs,
          lastSuccessfulCompletionGapMs ?? 0,
        ))
  ) {
    throw new Error(
      "API heartbeat running maximum disagrees with its exact next gap",
    );
  }
  if (
    successfulPublicationAdvance === 1 &&
    cadenceViolationAdvance !==
      Number(lastSuccessfulAttemptGapMs > cadenceLimitMs)
  ) {
    throw new Error(
      "API heartbeat successful-attempt cadence counter disagrees with its exact next gap",
    );
  }
  if (
    successfulPublicationAdvance === 1 &&
    completionCadenceViolationAdvance !==
      Number(lastSuccessfulCompletionGapMs > cadenceLimitMs)
  ) {
    throw new Error(
      "API heartbeat successful-completion cadence counter disagrees with its exact next gap",
    );
  }
  if (cadenceViolationCount > previous.cadenceViolationCount) {
    throw new Error(
      `API heartbeat producer recorded a cadence violation: last successful-attempt gap ${lastSuccessfulAttemptGapMs}ms, limit ${cadenceLimitMs}ms`,
    );
  }
  if (
    completionCadenceViolationCount > previous.completionCadenceViolationCount
  ) {
    throw new Error(
      `API heartbeat producer recorded a completion cadence violation: last successful-completion gap ${lastSuccessfulCompletionGapMs}ms, limit ${cadenceLimitMs}ms`,
    );
  }
  if (writeFailureCount > previous.writeFailureCount) {
    throw new Error(
      `API heartbeat producer recorded ${writeFailureCount - previous.writeFailureCount} failed publication attempt(s)`,
    );
  }
  if (
    successfulPublicationSequence === previous.successfulPublicationSequence
  ) {
    if (
      updatedAtMs !== previous.updatedAtMs ||
      writeFailureCount !== previous.writeFailureCount ||
      lastSuccessfulAttemptGapMs !== previous.lastSuccessfulAttemptGapMs ||
      maxSuccessfulAttemptGapMs !== previous.maxSuccessfulAttemptGapMs ||
      completionEvidenceThroughSequence !==
        previous.completionEvidenceThroughSequence ||
      completionCadenceViolationCount !==
        previous.completionCadenceViolationCount ||
      lastSuccessfulCompletionGapMs !==
        previous.lastSuccessfulCompletionGapMs ||
      maxSuccessfulCompletionGapMs !== previous.maxSuccessfulCompletionGapMs
    ) {
      throw new Error(
        "API heartbeat payload changed without a successful publication sequence advance",
      );
    }
    if (observedAtMs - previous.firstObservedAtMs > maxGapMs) {
      throw new Error(
        `API heartbeat did not advance within the ${intervalMs}ms cadence`,
      );
    }
    return previous;
  }
  if (updatedAtMs <= previous.updatedAtMs) {
    throw new Error(
      "API heartbeat successful publication sequence advanced without a newer timestamp",
    );
  }
  return {
    updatedAtMs,
    firstObservedAtMs: observedAtMs,
    advanceCount:
      previous.advanceCount +
      successfulPublicationSequence -
      previous.successfulPublicationSequence,
    successfulPublicationSequence,
    cadenceViolationCount,
    completionEvidenceThroughSequence,
    completionCadenceViolationCount,
    writeFailureCount,
    lastSuccessfulAttemptGapMs,
    maxSuccessfulAttemptGapMs,
    lastSuccessfulCompletionGapMs,
    maxSuccessfulCompletionGapMs,
  };
}

export function assertExactListenerOwnership({
  listeningInodes,
  holders,
  leafHolder,
  expectedLeaf,
}) {
  assertLeafOwnsEveryListener(listeningInodes, leafHolder, expectedLeaf);
  if (!Array.isArray(holders) || holders.length !== 1) {
    throw new Error(
      `expected exactly one listening socket holder, found ${holders?.length ?? "n-a"}`,
    );
  }
  assertLeafOwnsEveryListener(listeningInodes, holders[0], expectedLeaf);
  return true;
}

export function assertInspectorPortClosed(listeningInodes, phase) {
  if (!(listeningInodes instanceof Set)) {
    throw new Error(`cannot inspect the inspector port ${phase}`);
  }
  if (listeningInodes.size > 0) {
    throw new Error(`inspector port ${INSPECTOR_PORT} is listening ${phase}`);
  }
  return true;
}

export function assertHealthPair(direct, frontend, expectedToken = null) {
  const directToken = assertHealthResponse(direct, "direct API");
  const frontendToken = assertHealthResponse(frontend, "frontend proxy");
  if (directToken !== frontendToken) {
    throw new Error("direct and frontend health instance tokens do not match");
  }
  if (expectedToken != null && directToken !== expectedToken) {
    throw new Error("health instance token changed during the watch");
  }
  return directToken;
}

export function assertSampleGap(previousMonoMs, currentMonoMs, maxGapMs) {
  if (
    ![previousMonoMs, currentMonoMs, maxGapMs].every(Number.isFinite) ||
    maxGapMs <= 0
  ) {
    throw new Error("sample timing bounds are invalid");
  }
  const gapMs = currentMonoMs - previousMonoMs;
  if (gapMs < 0)
    throw new Error("sample clock moved backward or samples are out of order");
  if (gapMs > maxGapMs) {
    throw new Error(`sample gap ${gapMs.toFixed(3)}ms exceeds ${maxGapMs}ms`);
  }
  return gapMs;
}

export function assertWallClockDrift(
  wallStartMs,
  wallNowMs,
  monoStartMs,
  monoNowMs,
  maxDriftMs,
) {
  if (
    ![wallStartMs, wallNowMs, monoStartMs, monoNowMs, maxDriftMs].every(
      Number.isFinite,
    ) ||
    maxDriftMs < 0
  ) {
    throw new Error("wall-clock drift inputs are invalid");
  }
  const driftMs = wallNowMs - wallStartMs - (monoNowMs - monoStartMs);
  if (Math.abs(driftMs) > maxDriftMs) {
    throw new Error(
      `wall-clock drift ${driftMs.toFixed(3)}ms exceeds ${maxDriftMs}ms`,
    );
  }
  return driftMs;
}

export function nextSampleTarget(
  startMonoMs,
  completedMonoMs,
  lastIndex,
  intervalMs,
  durationMs,
) {
  if (
    ![startMonoMs, completedMonoMs, lastIndex, intervalMs, durationMs].every(
      Number.isFinite,
    ) ||
    !Number.isInteger(lastIndex) ||
    lastIndex < 0 ||
    intervalMs <= 0 ||
    durationMs <= 0 ||
    !Number.isInteger(durationMs / intervalMs)
  ) {
    throw new Error("sample schedule inputs are invalid");
  }
  const finalIndex = durationMs / intervalMs;
  let index = lastIndex + 1;
  while (
    index <= finalIndex &&
    startMonoMs + index * intervalMs < completedMonoMs
  ) {
    index += 1;
  }
  if (index > finalIndex) return null;
  return {
    index,
    targetMonoMs: startMonoMs + index * intervalMs,
    skipped: index - lastIndex - 1,
  };
}

export function assertWatchCoverage(samples, durationMs, maxGapMs) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("no runtime watch samples were captured");
  }
  if (samples.some((sample) => sample?.ok !== true)) {
    throw new Error("one or more runtime watch samples failed");
  }
  if (samples[0].elapsedMs < 0 || samples[0].elapsedMs > maxGapMs) {
    throw new Error(
      "first runtime sample does not cover the watch start boundary",
    );
  }
  for (let index = 1; index < samples.length; index += 1) {
    assertSampleGap(
      samples[index - 1].elapsedMs,
      samples[index].elapsedMs,
      maxGapMs,
    );
  }
  if (samples.at(-1).elapsedMs < durationMs) {
    throw new Error(
      "last runtime sample does not cover the watch end boundary",
    );
  }
  return true;
}

export function utcDateKeysBetween(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error("recorder date bounds are invalid");
  }
  const keys = [];
  const cursor = new Date(startMs);
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(endMs);
  last.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function recorderSourceSpecs({
  recorderDir,
  startMs,
  endMs,
}) {
  return utcDateKeysBetween(startMs, endMs).map((key) => ({
    key: `api-${key}`,
    kind: "api",
    path: path.join(recorderDir, `api-events-${key}.jsonl`),
  }));
}

export function assertRecorderTransition(
  start,
  end,
  maxBytes = MAX_RECORDER_SLICE_BYTES,
) {
  if (!start || !end || start.key !== end.key || start.path !== end.path) {
    throw new Error("recorder watermark source identity is inconsistent");
  }
  if (
    typeof start.exists !== "boolean" ||
    typeof end.exists !== "boolean" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(start.size) ||
    start.size < 0 ||
    !Number.isSafeInteger(end.size) ||
    end.size < 0
  ) {
    throw new Error(`recorder byte watermark is invalid: ${start.path}`);
  }
  if (!start.exists) {
    if (!end.exists) return { readStart: 0, readEnd: 0, bytes: 0 };
    if (
      typeof end.dev !== "string" ||
      end.dev === "" ||
      typeof end.ino !== "string" ||
      end.ino === ""
    ) {
      throw new Error(`recorder final file identity is invalid: ${end.path}`);
    }
    if (end.size > maxBytes) {
      throw new Error(
        `recorder slice ${end.size} bytes exceeds the ${maxBytes}-byte cap`,
      );
    }
    return { readStart: 0, readEnd: end.size, bytes: end.size };
  }
  if (!end.exists)
    throw new Error(`recorder source disappeared: ${start.path}`);
  if (
    typeof start.dev !== "string" ||
    start.dev === "" ||
    typeof start.ino !== "string" ||
    start.ino === "" ||
    typeof end.dev !== "string" ||
    end.dev === "" ||
    typeof end.ino !== "string" ||
    end.ino === ""
  ) {
    throw new Error(`recorder file identity is invalid: ${start.path}`);
  }
  if (start.dev !== end.dev || start.ino !== end.ino) {
    throw new Error(
      `recorder source was replaced or changed identity: ${start.path}`,
    );
  }
  if (end.size < start.size) {
    throw new Error(`recorder source shrank or was truncated: ${start.path}`);
  }
  if (
    !Number.isSafeInteger(start.sliceStart) ||
    start.sliceStart < 0 ||
    start.sliceStart > start.size
  ) {
    throw new Error(`recorder start watermark is invalid: ${start.path}`);
  }
  const bytes = end.size - start.sliceStart;
  if (bytes > maxBytes) {
    throw new Error(
      `recorder slice ${bytes} bytes exceeds the ${maxBytes}-byte cap`,
    );
  }
  return {
    readStart: start.sliceStart,
    readEnd: end.size,
    bytes,
  };
}

export function assertAllSourcesWatermarked(specs, starts) {
  for (const spec of specs) {
    if (!starts.has(spec.key)) {
      throw new Error(
        `recorder source ${spec.key} has no pre-window watermark`,
      );
    }
  }
  return true;
}

export function parseJsonlSlice(text, label) {
  if (text === "") return [];
  if (!text.endsWith("\n")) {
    throw new Error(
      `${label} slice ends in a partial line beyond its final watermark`,
    );
  }
  return text
    .slice(0, -1)
    .split("\n")
    .map((line, index) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(
          `${label} contains malformed JSONL at line ${index + 1}`,
        );
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} JSONL line ${index + 1} is not an object`);
      }
      return value;
    });
}

export function filterRecorderEvents(records, { startMs, endMs, pid, label }) {
  positivePid(pid, `${label} slice pid`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error(`${label} event-time bounds are invalid`);
  }
  const events = [];
  let outsideWindowCount = 0;
  let excludedPidCount = 0;
  for (const record of records) {
    const timeMs =
      typeof record?.time === "string" ? Date.parse(record.time) : Number.NaN;
    if (!Number.isFinite(timeMs)) {
      throw new Error(`${label} recorder event has an invalid time`);
    }
    positivePid(record.pid, `${label} recorder event pid`);
    if (timeMs < startMs || timeMs > endMs) {
      outsideWindowCount += 1;
    } else if (record.pid !== pid) {
      excludedPidCount += 1;
    } else {
      events.push(record);
    }
  }
  return { events, outsideWindowCount, excludedPidCount };
}

function assertPeriodicEventCoverage(
  records,
  { event, startMs, endMs, maxGapMs, label, validate },
) {
  if (
    !Array.isArray(records) ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs < startMs ||
    !Number.isFinite(maxGapMs) ||
    maxGapMs <= 0
  ) {
    throw new Error(`${label} coverage inputs are invalid`);
  }
  const matching = records.filter((record) => record?.event === event);
  if (matching.length === 0) throw new Error(`${label} coverage is empty`);
  const times = matching.map((record, index) => {
    const timeMs = Date.parse(record?.time);
    if (!Number.isFinite(timeMs) || timeMs < startMs || timeMs > endMs) {
      throw new Error(
        `${label} coverage event ${index + 1} is outside the window`,
      );
    }
    validate?.(record, index);
    return timeMs;
  });
  for (let index = 1; index < times.length; index += 1) {
    const gapMs = times[index] - times[index - 1];
    if (gapMs < 0) throw new Error(`${label} coverage events are out of order`);
    if (gapMs > maxGapMs) {
      throw new Error(`${label} coverage gap ${gapMs}ms exceeds ${maxGapMs}ms`);
    }
  }
  if (times[0] - startMs > maxGapMs || endMs - times.at(-1) > maxGapMs) {
    throw new Error(`${label} coverage does not reach both watch boundaries`);
  }
  return {
    event,
    count: matching.length,
    firstAt: matching[0].time,
    lastAt: matching.at(-1).time,
    maxGapMs: Math.max(
      times[0] - startMs,
      endMs - times.at(-1),
      ...times.slice(1).map((timeMs, index) => timeMs - times[index]),
    ),
  };
}

export function assertRecorderEventCoverage(
  { api },
  { startMs, endMs, timings },
) {
  return {
    apiMemory: assertPeriodicEventCoverage(api, {
      event: "api-memory-sample",
      startMs,
      endMs,
      maxGapMs: timings?.apiMemoryMaxGapMs,
      label: "API memory",
      validate: (record) => {
        if (
          !Number.isFinite(record?.memoryMb?.rss) ||
          record.memoryMb.rss < 0
        ) {
          throw new Error("API memory coverage event has no valid RSS sample");
        }
      },
    }),
  };
}

export function assertNoDroppedLines(startCount, endCount) {
  if (
    !Number.isSafeInteger(startCount) ||
    startCount < 0 ||
    !Number.isSafeInteger(endCount) ||
    endCount < 0
  ) {
    throw new Error(
      "flight-recorder dropped-line count is missing or not a non-negative integer",
    );
  }
  const delta = endCount - startCount;
  if (delta < 0)
    throw new Error("flight-recorder dropped-line count decreased");
  if (delta > 0)
    throw new Error(
      `flight recorder dropped ${delta} JSONL line(s) during the watch`,
    );
  return delta;
}

export function buildSha256Lines(entries) {
  const validated = [...entries].map((entry) => {
    if (
      typeof entry?.name !== "string" ||
      entry.name === "" ||
      /[\r\n]/u.test(entry.name) ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256 ?? "")
    ) {
      throw new Error("SHA256 manifest entry has an invalid name or digest");
    }
    return entry;
  });
  const names = new Set();
  for (const entry of validated) {
    if (names.has(entry.name)) {
      throw new Error(`SHA256 manifest contains duplicate name: ${entry.name}`);
    }
    names.add(entry.name);
  }
  return validated
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256}  ${entry.name}\n`)
    .join("");
}

export function buildPrehashedJsonArtifact(name, value) {
  const json = JSON.stringify(value, null, 2);
  if (typeof json !== "string") {
    throw new Error("JSON evidence value is not serializable");
  }
  const content = `${json}\n`;
  const artifact = {
    name,
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  buildSha256Lines([artifact]);
  return artifact;
}

export function buildEvidenceVerdict(evidenceIntegrityPassed) {
  if (typeof evidenceIntegrityPassed !== "boolean") {
    throw new Error("evidence integrity verdict must be boolean");
  }
  return { evidenceIntegrityPassed, performanceVerdict: "unassessed" };
}

export function assertExecutableSourceHashesUnchanged(start, end) {
  if (
    !Array.isArray(start) ||
    !Array.isArray(end) ||
    start.length !== end.length
  ) {
    throw new Error("executable source hash inventory changed");
  }
  const endByPath = new Map(end.map((entry) => [entry?.path, entry]));
  if (endByPath.size !== end.length) {
    throw new Error(
      "executable source hash inventory contains duplicate paths",
    );
  }
  const startPaths = new Set();
  for (const entry of start) {
    const current = endByPath.get(entry?.path);
    if (
      typeof entry?.path !== "string" ||
      startPaths.has(entry.path) ||
      !/^[0-9a-f]{64}$/u.test(entry?.sha256 ?? "") ||
      current?.sha256 !== entry.sha256 ||
      ["device", "inode", "sizeBytes", "mtimeMs", "ctimeMs"].some(
        (key) => key in entry && current?.[key] !== entry[key],
      )
    ) {
      throw new Error(
        `executable source changed during the watch: ${entry?.path ?? "unknown"}`,
      );
    }
    startPaths.add(entry.path);
  }
  return true;
}

export async function assertExecutableSnapshotCopies(outDir, snapshots) {
  for (const snapshot of snapshots) {
    if (
      typeof snapshot?.name !== "string" ||
      path.basename(snapshot.name) !== snapshot.name ||
      !/^[0-9a-f]{64}$/u.test(snapshot?.sha256 ?? "") ||
      (await hashFile(path.join(outDir, snapshot.name))) !== snapshot.sha256
    ) {
      throw new Error(
        `executable snapshot copy changed: ${snapshot?.name ?? "unknown"}`,
      );
    }
  }
  return true;
}

export function assertRuntimeArtifactSnapshotsPredate({
  snapshots,
  apiIdentity,
  heartbeat,
  watchStartMs,
  bundlePath = API_BUNDLE_PATH,
  sourceMapPath = API_SOURCE_MAP_PATH,
}) {
  const args = parseProcCmdline(apiIdentity?.cmdlineRaw);
  const updatedAtMs = Date.parse(heartbeat?.updatedAt);
  const uptimeMs = heartbeat?.uptimeMs;
  const estimatedProcessStartMs = updatedAtMs - uptimeMs;
  if (
    !args ||
    args.length !== 3 ||
    path.resolve(apiIdentity?.cwd ?? "", args[2] ?? "") !== bundlePath ||
    sourceMapPath !== `${bundlePath}.map` ||
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(uptimeMs) ||
    uptimeMs < 0 ||
    !Number.isFinite(watchStartMs)
  ) {
    throw new Error("runtime artifact binding inputs are invalid");
  }
  const byPath = new Map(snapshots?.map((entry) => [entry?.path, entry]));
  if (!Array.isArray(snapshots) || byPath.size !== snapshots.length) {
    throw new Error("runtime artifact snapshot inventory is invalid");
  }
  for (const expectedPath of [bundlePath, sourceMapPath]) {
    const snapshot = byPath.get(expectedPath);
    const capturedAtMs = Date.parse(snapshot?.capturedAt);
    if (
      snapshot?.runtimeArtifact !== true ||
      !Number.isFinite(snapshot?.mtimeMs) ||
      !Number.isFinite(snapshot?.ctimeMs) ||
      !Number.isFinite(capturedAtMs) ||
      snapshot.mtimeMs > estimatedProcessStartMs + 1_000 ||
      snapshot.ctimeMs > estimatedProcessStartMs + 1_000 ||
      snapshot.mtimeMs > watchStartMs ||
      snapshot.ctimeMs > watchStartMs ||
      capturedAtMs > watchStartMs
    ) {
      throw new Error(
        `runtime artifact does not predate the watched API leaf and window: ${expectedPath}`,
      );
    }
  }
  return { estimatedProcessStartMs };
}

function exactPnpmRole(identity, expectedCwd, tail) {
  const args = parseProcCmdline(identity?.cmdlineRaw);
  return (
    args !== null &&
    identity?.cwd === expectedCwd &&
    binaryBasename(args[0]) === "node" &&
    binaryBasename(args[1]) === "pnpm" &&
    args.slice(2).length === tail.length &&
    args.slice(2).every((value, index) => value === tail[index])
  );
}

function binaryBasename(value) {
  return (
    String(value ?? "")
      .split("/")
      .pop() ?? ""
  );
}

function cmdlineBasename(raw) {
  return binaryBasename(parseProcCmdline(raw)?.[0]);
}

function positivePid(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function sameSet(left, right) {
  return (
    left instanceof Set &&
    right instanceof Set &&
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function assertLeafOwnsEveryListener(listeningInodes, holder, expectedLeaf) {
  if (!(listeningInodes instanceof Set) || listeningInodes.size === 0) {
    throw new Error("API port has no proven listening socket inode");
  }
  if (
    holder?.pid !== expectedLeaf?.pid ||
    holder?.startTimeTicks !== expectedLeaf?.startTimeTicks ||
    holder?.cgroup !== expectedLeaf?.cgroup
  ) {
    throw new Error(
      "listening socket holder does not match the exact API leaf identity",
    );
  }
  if (!sameSet(holder.socketInodes, listeningInodes)) {
    throw new Error(
      "API leaf has partial ownership and does not own every listening inode",
    );
  }
}

function assertHealthResponse(response, label) {
  if (response?.statusCode !== 200) {
    throw new Error(
      `${label} health status is ${response?.statusCode ?? "missing"}, not 200`,
    );
  }
  if (response?.body !== HEALTH_BODY) {
    throw new Error(
      `${label} health body does not exactly match ${HEALTH_BODY}`,
    );
  }
  if (response?.headers?.["content-type"] !== HEALTH_CONTENT_TYPE) {
    throw new Error(
      `${label} health content-type is not exactly ${HEALTH_CONTENT_TYPE}`,
    );
  }
  const token = response?.headers?.["x-pyrus-health-instance"];
  if (!isValidHealthInstanceToken(token)) {
    throw new Error(`${label} health instance token is missing or invalid`);
  }
  return token;
}

function readExactProcessChain(startPid) {
  const chain = [];
  const seen = new Set();
  let currentPid = positivePid(startPid, "process-chain start pid");
  while (!seen.has(currentPid) && chain.length < 16) {
    seen.add(currentPid);
    const identity = readProcIdentity(currentPid);
    let stat;
    try {
      stat = parseProcStat(readFileSync(`/proc/${currentPid}/stat`, "utf8"));
    } catch {
      stat = null;
    }
    if (!identity || !stat || identity.startTimeTicks !== stat.startTimeTicks) {
      throw new Error(`could not bind /proc identity for pid ${currentPid}`);
    }
    const entry = { ...identity, ppid: stat.ppid };
    chain.push(entry);
    if (cmdlineBasename(identity.cmdlineRaw) === "pid2") return chain;
    if (stat.ppid <= 0 || stat.ppid === currentPid) break;
    currentPid = stat.ppid;
  }
  throw new Error(
    "runtime process chain did not terminate at pid2 within 16 identities",
  );
}

export async function readStableBoundedJson(
  file,
  maxBytes = MAX_HEARTBEAT_JSON_BYTES,
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_HEARTBEAT_JSON_BYTES
  ) {
    throw new Error("JSON evidence byte bound is invalid");
  }
  const handle = await open(file, "r");
  let raw;
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${file} is not a regular file`);
    if (before.size > maxBytes) {
      throw new Error(`${file} exceeds the ${maxBytes}-byte JSON evidence cap`);
    }
    const buffer = Buffer.allocUnsafe(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      bytesRead > maxBytes ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytesRead !== after.size
    ) {
      throw new Error(`${file} changed while reading bounded JSON evidence`);
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, bytesRead),
    );
  } finally {
    await handle.close();
  }
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} does not contain a JSON object`);
  }
  return value;
}

function readApiProcessEnvironment(pid) {
  positivePid(pid, "API environment pid");
  const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
  return {
    recorderTimings: recorderTimingsFromEnviron(raw),
    nodeOptions: canonicalApiNodeOptionsFromEnviron(raw),
  };
}

async function captureRuntimeState(
  expectedChain = null,
  expectedTimings = null,
  expectedNodeOptions = undefined,
) {
  const apiHeartbeat = await readStableBoundedJson(
    path.join(RECORDER_DIR, "api-current.json"),
  );
  return withApiHeartbeatFailureContext(apiHeartbeat, () => {
    const chain = readExactProcessChain(
      positivePid(apiHeartbeat.pid, "API heartbeat pid"),
    );
    assertRuntimeChainRoles(chain, {
      repoRoot: REPO_ROOT,
      apiRoot: API_ROOT,
      pyrusRoot: PYRUS_ROOT,
    });
    const supervisorPid = chain[2].pid;
    if (!hasPyrusWorkflowAncestry(supervisorPid)) {
      throw new Error(
        `supervisor ${supervisorPid} does not have exact pid2-owned PYRUS workflow ancestry`,
      );
    }
    const environment = readApiProcessEnvironment(chain[0].pid);
    const recorderTimings = expectedTimings ?? environment.recorderTimings;
    if (expectedNodeOptions !== undefined) {
      assertCanonicalApiNodeOptionsUnchanged(
        expectedNodeOptions,
        environment.nodeOptions,
      );
    }
    assertHeartbeatBinding({
      apiHeartbeat,
      chain,
      nowMs: Date.now(),
      apiMaxAgeMs: recorderTimings.apiHeartbeatMaxGapMs,
    });
    if (expectedChain) assertChainUnchanged(expectedChain, chain);
    return {
      apiHeartbeat,
      chain,
      recorderTimings,
      nodeOptions: environment.nodeOptions,
    };
  });
}

export function attachLastObservedApiHeartbeat(error, heartbeat) {
  const failure =
    error instanceof Error ? error : new Error(errorMessage(error));
  if (!Object.hasOwn(failure, "lastObservedApiHeartbeat")) {
    Object.defineProperty(failure, "lastObservedApiHeartbeat", {
      value: heartbeat,
    });
  }
  return failure;
}

function lastObservedApiHeartbeatFromError(error) {
  return error instanceof Error &&
    Object.hasOwn(error, "lastObservedApiHeartbeat") &&
    error.lastObservedApiHeartbeat &&
    typeof error.lastObservedApiHeartbeat === "object" &&
    !Array.isArray(error.lastObservedApiHeartbeat)
    ? error.lastObservedApiHeartbeat
    : null;
}

export function withApiHeartbeatFailureContext(heartbeat, operation) {
  try {
    return operation();
  } catch (error) {
    throw attachLastObservedApiHeartbeat(error, heartbeat);
  }
}

async function waitForApiHeartbeatAfter(
  updatedAfterMs,
  expectedChain,
  recorderTimings,
  signal = null,
  expectedNodeOptions = undefined,
) {
  if (!Number.isFinite(updatedAfterMs)) {
    throw new Error("heartbeat advance watermark is invalid");
  }
  let lastObservedApiHeartbeat = null;
  try {
    const deadline = performance.now() + recorderTimings.apiHeartbeatMaxGapMs;
    while (performance.now() <= deadline) {
      const heartbeat = await readStableBoundedJson(
        path.join(RECORDER_DIR, "api-current.json"),
      );
      lastObservedApiHeartbeat = heartbeat;
      assertStableApiPid(
        expectedChain[0].pid,
        positivePid(heartbeat.pid, "API heartbeat pid"),
      );
      const updatedAtMs = Date.parse(heartbeat.updatedAt);
      if (!Number.isFinite(updatedAtMs))
        throw new Error("API heartbeat timestamp is invalid");
      if (updatedAtMs > updatedAfterMs) {
        return captureRuntimeState(
          expectedChain,
          recorderTimings,
          expectedNodeOptions,
        );
      }
      await sleep(200, undefined, signal ? { signal } : undefined);
    }
    throw new Error(
      `API heartbeat did not advance beyond ${new Date(updatedAfterMs).toISOString()} within ${recorderTimings.apiHeartbeatMaxGapMs}ms`,
    );
  } catch (error) {
    if (lastObservedApiHeartbeat !== null) {
      throw attachLastObservedApiHeartbeat(error, lastObservedApiHeartbeat);
    }
    throw error;
  }
}

function capturePortOwnership(procInspector, expectedLeaf) {
  const startedMonoMs = performance.now();
  const listeningInodes = procInspector.listeningInodes(WATCH_DEFAULTS.apiPort);
  if (listeningInodes === null) {
    throw new Error("Linux listening socket tables are unavailable");
  }
  const leafHolder = procInspector.readHolderForInodes(
    expectedLeaf.pid,
    listeningInodes,
  );
  const holders = procInspector.findHolders(listeningInodes);
  if (holders === null)
    throw new Error("Linux process table is unavailable for socket ownership");
  assertExactListenerOwnership({
    listeningInodes,
    holders,
    leafHolder,
    expectedLeaf,
  });
  return {
    ...serializeOwnership(
      listeningInodes,
      holders,
      leafHolder,
      "exhaustive-single-leaf",
    ),
    inspectionDurationMs: performance.now() - startedMonoMs,
  };
}

function captureClosedInspectorPort(procInspector, expectedLeaf, phase) {
  const listeningInodes = procInspector.listeningInodes(INSPECTOR_PORT);
  assertInspectorPortClosed(listeningInodes, phase);
  return {
    port: INSPECTOR_PORT,
    listeningInodes: [],
    apiPid: expectedLeaf.pid,
    apiStartTimeTicks: expectedLeaf.startTimeTicks,
  };
}

function serializeOwnership(listeningInodes, holders, leafHolder, mode) {
  const serializeHolder = (holder) =>
    holder
      ? { ...holder, socketInodes: [...holder.socketInodes].sort() }
      : null;
  return {
    mode,
    listeningInodes: [...listeningInodes].sort(),
    leafHolder: serializeHolder(leafHolder),
    holders: holders?.map(serializeHolder) ?? null,
  };
}

export async function requestHealth(
  port,
  label,
  signal,
  timeoutMs = WATCH_DEFAULTS.healthTimeoutMs,
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("health deadline must be a positive safe integer");
  }
  const startedWallMs = Date.now();
  const startedMonoMs = performance.now();
  const response = await new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const request = http.request(
      {
        agent: false,
        hostname: "127.0.0.1",
        port,
        path: "/api/healthz",
        method: "GET",
        headers: { accept: "application/json", connection: "close" },
      },
      (incoming) => {
        const chunks = [];
        let bytes = 0;
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_HEALTH_BODY_BYTES) {
            request.destroy(
              new Error(
                `${label} health body exceeded ${MAX_HEALTH_BODY_BYTES} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () =>
          finish(resolve, {
            statusCode: incoming.statusCode,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        incoming.on("aborted", () =>
          finish(
            reject,
            new Error(`${label} health response aborted before completion`),
          ),
        );
        incoming.on("error", (error) => finish(reject, error));
      },
    );
    const onAbort = () =>
      request.destroy(signal.reason ?? new Error("watch aborted"));
    deadlineTimer = setTimeout(() => {
      request.destroy(
        new Error(`${label} health timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    deadlineTimer.unref?.();
    request.on("error", (error) => finish(reject, error));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    request.end();
  });
  const endedMonoMs = performance.now();
  return {
    ...response,
    startedAt: new Date(startedWallMs).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: endedMonoMs - startedMonoMs,
  };
}

async function captureHealthPair(expectedToken, signal) {
  const [direct, frontend] = await Promise.all([
    requestHealth(WATCH_DEFAULTS.apiPort, "direct API", signal),
    requestHealth(WATCH_DEFAULTS.frontendPort, "frontend proxy", signal),
  ]);
  const token = assertHealthPair(direct, frontend, expectedToken);
  return { token, direct, frontend };
}

function droppedLineCount(apiHeartbeat) {
  const value = apiHeartbeat?.flightRecorder?.droppedJsonLineCount;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "API heartbeat does not expose a valid flightRecorder.droppedJsonLineCount",
    );
  }
  return value;
}

async function captureWatermark(spec, includeSliceStart) {
  let handle;
  try {
    handle = await open(spec.path, "r");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ...spec,
        exists: false,
        dev: null,
        ino: null,
        size: 0,
        sliceStart: 0,
      };
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile())
      throw new Error(`recorder source is not a regular file: ${spec.path}`);
    const watermark = {
      ...spec,
      exists: true,
      dev: String(info.dev),
      ino: String(info.ino),
      size: info.size,
      mtimeMs: info.mtimeMs,
    };
    if (includeSliceStart) {
      watermark.sliceStart = await completeLineBoundary(handle, info.size);
    }
    return watermark;
  } finally {
    await handle.close();
  }
}

async function completeLineBoundary(handle, size) {
  if (size === 0) return 0;
  const chunkSize = 64 * 1_024;
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - chunkSize);
    const buffer = Buffer.allocUnsafe(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    if (bytesRead !== buffer.length) {
      throw new Error("could not read the exact recorder start watermark");
    }
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline !== -1) {
      const boundary = start + lastNewline + 1;
      return boundary === size ? size : start + lastNewline + 1;
    }
    end = start;
  }
  return 0;
}

async function captureWatermarks(specs, includeSliceStart) {
  const values = [];
  for (const spec of specs)
    values.push(await captureWatermark(spec, includeSliceStart));
  return values;
}

async function readExactSlice(start, end) {
  const transition = assertRecorderTransition(start, end);
  if (transition.bytes === 0) return "";
  const handle = await open(end.path, "r");
  try {
    const before = await handle.stat();
    if (
      String(before.dev) !== end.dev ||
      String(before.ino) !== end.ino ||
      before.size < end.size
    ) {
      throw new Error(
        `recorder final watermark no longer identifies ${end.path}`,
      );
    }
    const buffer = Buffer.allocUnsafe(transition.bytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        transition.readStart + offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== transition.bytes) {
      throw new Error(
        `recorder watermark promised ${transition.bytes} bytes but only ${offset} were readable`,
      );
    }
    const after = await handle.stat();
    if (
      String(after.dev) !== end.dev ||
      String(after.ino) !== end.ino ||
      after.size < end.size
    ) {
      throw new Error(
        `recorder source changed identity while reading ${end.path}`,
      );
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } finally {
    await handle.close();
  }
}

async function writeExclusive(file, content) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveJson(file, value) {
  await writeExclusive(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeExclusiveJsonl(file, values) {
  await writeExclusive(
    file,
    values.length
      ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n`
      : "",
  );
}

async function appendEvidence(handle, value) {
  await handle.writeFile(`${JSON.stringify(value)}\n`);
  await handle.sync();
}

async function sleepUntil(targetMonoMs, signal) {
  while (performance.now() < targetMonoMs) {
    await sleep(Math.max(1, targetMonoMs - performance.now()), undefined, {
      signal,
    });
  }
}

async function runWatch({
  baseline,
  procInspector,
  samplesHandle,
  signal,
  window,
}) {
  const samples = [];
  const finalIndex =
    WATCH_DEFAULTS.durationMs / WATCH_DEFAULTS.sampleIntervalMs;
  let index = 0;
  let targetMonoMs = window.startMonoMs;
  let previousSampleMonoMs = window.startMonoMs;
  let healthToken = null;
  let probeCount = 0;
  let apiHeartbeatProgress = assertApiHeartbeatProgress(
    null,
    baseline.apiHeartbeat,
    window.startWallMs,
    baseline.recorderTimings.apiHeartbeatIntervalMs,
  );

  while (index <= finalIndex) {
    const scheduledElapsedMs = targetMonoMs - window.startMonoMs;
    let failureState = null;
    try {
      await sleepUntil(targetMonoMs, signal);
      const sampleStartedMonoMs = performance.now();
      const sampleStartedWallMs = Date.now();
      const gapMs = assertSampleGap(
        previousSampleMonoMs,
        sampleStartedMonoMs,
        WATCH_DEFAULTS.maxGapMs,
      );
      const wallDriftMs = assertWallClockDrift(
        window.startWallMs,
        sampleStartedWallMs,
        window.startMonoMs,
        sampleStartedMonoMs,
        WATCH_DEFAULTS.maxWallDriftMs,
      );
      const probeDue =
        index %
          (WATCH_DEFAULTS.probeIntervalMs / WATCH_DEFAULTS.sampleIntervalMs) ===
        0;
      const state = await captureRuntimeState(
        baseline.chain,
        baseline.recorderTimings,
        baseline.nodeOptions,
      );
      failureState = state;
      apiHeartbeatProgress = assertApiHeartbeatProgress(
        apiHeartbeatProgress,
        state.apiHeartbeat,
        Date.now(),
        baseline.recorderTimings.apiHeartbeatIntervalMs,
      );
      const ownership = capturePortOwnership(procInspector, state.chain[0]);
      const inspector = captureClosedInspectorPort(
        procInspector,
        state.chain[0],
        `at sample ${index}`,
      );
      let health = null;
      let postState = null;
      let postOwnership = null;
      let postInspector = null;
      if (probeDue) {
        health = await captureHealthPair(healthToken, signal);
        healthToken ??= health.token;
        postState = await captureRuntimeState(
          baseline.chain,
          baseline.recorderTimings,
          baseline.nodeOptions,
        );
        failureState = postState;
        apiHeartbeatProgress = assertApiHeartbeatProgress(
          apiHeartbeatProgress,
          postState.apiHeartbeat,
          Date.now(),
          baseline.recorderTimings.apiHeartbeatIntervalMs,
        );
        assertChainUnchanged(state.chain, postState.chain);
        postOwnership = capturePortOwnership(procInspector, postState.chain[0]);
        postInspector = captureClosedInspectorPort(
          procInspector,
          postState.chain[0],
          `after health probe ${index}`,
        );
        probeCount += 1;
      }
      const completedMonoMs = performance.now();
      const completedWallMs = Date.now();
      const completedWallDriftMs = assertWallClockDrift(
        window.startWallMs,
        completedWallMs,
        window.startMonoMs,
        completedMonoMs,
        WATCH_DEFAULTS.maxWallDriftMs,
      );
      const sample = {
        type: "sample",
        ok: true,
        index,
        scheduledElapsedMs,
        elapsedMs: sampleStartedMonoMs - window.startMonoMs,
        completedElapsedMs: completedMonoMs - window.startMonoMs,
        gapMs,
        wallDriftMs,
        completedWallDriftMs,
        observationStartedAt: new Date(sampleStartedWallMs).toISOString(),
        observationCompletedAt: new Date(completedWallMs).toISOString(),
        apiHeartbeat: state.apiHeartbeat,
        canonicalNodeOptions: state.nodeOptions,
        processChain: state.chain,
        ownership,
        inspector,
        health,
        postProbeApiHeartbeatUpdatedAt:
          postState?.apiHeartbeat?.updatedAt ?? null,
        postProbeOwnership: postOwnership,
        postProbeInspector: postInspector,
        apiHeartbeatAdvanceCount: apiHeartbeatProgress.advanceCount,
      };
      await appendEvidence(samplesHandle, sample);
      samples.push({ elapsedMs: sample.elapsedMs, ok: true });
      previousSampleMonoMs = sampleStartedMonoMs;
      if (index === finalIndex) break;

      const next = nextSampleTarget(
        window.startMonoMs,
        performance.now(),
        index,
        WATCH_DEFAULTS.sampleIntervalMs,
        WATCH_DEFAULTS.durationMs,
      );
      if (!next)
        throw new Error("sample work overran the final watch boundary");
      if (next.skipped > 0) {
        throw new Error(
          `sampling missed ${next.skipped} scheduled tick(s); catch-up is forbidden`,
        );
      }
      index = next.index;
      targetMonoMs = next.targetMonoMs;
    } catch (error) {
      await appendEvidence(samplesHandle, {
        type: "failure",
        ok: false,
        index,
        scheduledElapsedMs,
        elapsedMs: performance.now() - window.startMonoMs,
        observedAt: new Date().toISOString(),
        error: errorMessage(error),
        apiHeartbeat: failureState?.apiHeartbeat ?? null,
        processChain: failureState?.chain ?? null,
      });
      throw error;
    }
  }

  assertWatchCoverage(
    samples,
    WATCH_DEFAULTS.durationMs,
    WATCH_DEFAULTS.maxGapMs,
  );
  if (samples.length !== finalIndex + 1) {
    throw new Error(
      `expected ${finalIndex + 1} exact samples, captured ${samples.length}`,
    );
  }
  const expectedProbes =
    WATCH_DEFAULTS.durationMs / WATCH_DEFAULTS.probeIntervalMs + 1;
  if (probeCount !== expectedProbes) {
    throw new Error(
      `expected ${expectedProbes} exact health probes, captured ${probeCount}`,
    );
  }
  if (apiHeartbeatProgress.advanceCount === 0) {
    throw new Error("API heartbeat never advanced during the watch");
  }
  return {
    samples,
    healthToken,
    probeCount,
    apiHeartbeatAdvanceCount: apiHeartbeatProgress.advanceCount,
    apiHeartbeatProgress,
  };
}

async function finalizeRecorderSlices({
  startWatermarks,
  specs,
  windowStartMs,
  windowEndMs,
  apiPid,
  recorderTimings,
  outDir,
}) {
  const starts = new Map(startWatermarks.map((value) => [value.key, value]));
  assertAllSourcesWatermarked(specs, starts);
  const summaries = [];
  const errors = [];
  const eventsByKind = { api: [] };
  for (const spec of specs) {
    try {
      const start = starts.get(spec.key);
      const end = await captureWatermark(spec, false);
      const text = await readExactSlice(start, end);
      const records = parseJsonlSlice(text, spec.key);
      const filtered = filterRecorderEvents(records, {
        startMs: windowStartMs,
        endMs: windowEndMs,
        pid: apiPid,
        label: spec.key,
      });
      const output = `${spec.key}.jsonl`;
      await writeExclusiveJsonl(path.join(outDir, output), filtered.events);
      eventsByKind[spec.kind].push(...filtered.events);
      summaries.push({
        ...spec,
        startWatermark: start,
        endWatermark: end,
        output,
        parsedCount: records.length,
        matchedCount: filtered.events.length,
        outsideWindowCount: filtered.outsideWindowCount,
        excludedPidCount: filtered.excludedPidCount,
      });
    } catch (error) {
      errors.push({ source: spec.key, error: errorMessage(error) });
    }
  }
  let coverage = null;
  try {
    coverage = assertRecorderEventCoverage(eventsByKind, {
      startMs: windowStartMs,
      endMs: windowEndMs,
      timings: recorderTimings,
    });
  } catch (error) {
    errors.push({ source: "coverage", error: errorMessage(error) });
  }
  return { summaries, errors, coverage };
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function readStableExecutableSource(spec) {
  const handle = await open(spec.path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error(`executable source is not a file: ${spec.path}`);
    }
    const content = await handle.readFile();
    const [after, pathAfter] = await Promise.all([
      handle.stat(),
      stat(spec.path),
    ]);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.size !== pathAfter.size ||
      after.mtimeMs !== pathAfter.mtimeMs ||
      after.ctimeMs !== pathAfter.ctimeMs ||
      content.byteLength !== after.size
    ) {
      throw new Error(`executable source changed while reading: ${spec.path}`);
    }
    return {
      ...spec,
      content,
      capturedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: content.byteLength,
      device: String(after.dev),
      inode: String(after.ino),
      mtimeMs: after.mtimeMs,
      ctimeMs: after.ctimeMs,
    };
  } finally {
    await handle.close();
  }
}

async function snapshotExecutableSources(outDir) {
  const snapshots = [];
  for (const spec of EXECUTABLE_SOURCE_SPECS) {
    const { content, ...snapshot } = await readStableExecutableSource(spec);
    await writeExclusive(path.join(outDir, spec.name), content);
    snapshots.push(snapshot);
  }
  return snapshots;
}

async function currentExecutableSourceHashes(startSnapshots) {
  return Promise.all(
    startSnapshots.map(async (snapshot) => {
      const { content: _content, ...current } =
        await readStableExecutableSource(snapshot);
      return current;
    }),
  );
}

async function writeManifest(outDir, prehashedArtifacts = []) {
  const prehashedNames = new Set(prehashedArtifacts.map((entry) => entry.name));
  const entries = await readdir(outDir, { withFileTypes: true });
  const hashes = [];
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name !== "SHA256SUMS" &&
      !prehashedNames.has(entry.name)
    ) {
      hashes.push({
        name: entry.name,
        sha256: await hashFile(path.join(outDir, entry.name)),
      });
    }
  }
  hashes.push(
    ...prehashedArtifacts.map(({ name, sha256 }) => ({ name, sha256 })),
  );
  await writeExclusive(
    path.join(outDir, "SHA256SUMS"),
    buildSha256Lines(hashes),
  );
  await syncDirectory(outDir);
}

export async function commitResultEvidence(outDir, resultArtifact) {
  await writeManifest(outDir, [resultArtifact]);
  await writeExclusive(
    path.join(outDir, resultArtifact.name),
    resultArtifact.content,
  );
  await syncDirectory(outDir);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:.]/gu, "")
    .replace("T", "-")
    .replace("Z", "Z");
}

function parseArgs(args) {
  let out = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") {
      if (!args[index + 1]) throw new Error("--out requires a directory");
      out = path.resolve(args[++index]);
    } else if (args[index] === "--help") {
      return { help: true, out: null };
    } else {
      throw new Error(`unknown argument: ${args[index]}`);
    }
  }
  return { help: false, out };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/diag/same-process-runtime-watch.mjs [--out DIRECTORY]",
    );
    console.log(
      "Runs the fixed 900-second, 5-second-cadence same-process runtime watch.",
    );
    return;
  }

  const diagnosticsRoot = path.join(REPO_ROOT, ".pyrus-runtime", "diagnostics");
  await mkdir(diagnosticsRoot, { recursive: true });
  const outDir =
    args.out ??
    path.join(
      diagnosticsRoot,
      `same-process-runtime-watch-${stamp()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    );
  await mkdir(outDir, { recursive: false, mode: 0o700 });

  const abortController = new AbortController();
  const abort = (signalName) =>
    recordWatchInterruption(abortController, signalName);
  const onSigint = () => abort("SIGINT");
  const onSigterm = () => abort("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const procInspector = createProcInspector();
  const executableSourceStartSnapshots =
    await snapshotExecutableSources(outDir);
  const scriptStartHash = executableSourceStartSnapshots.find(
    (entry) => entry.path === SCRIPT_PATH,
  ).sha256;
  const anticipatedStartMs = Date.now();
  const anticipatedEndMs =
    anticipatedStartMs +
    WATCH_DEFAULTS.durationMs +
    WATCH_DEFAULTS.maxWallDriftMs +
    WATCH_DEFAULTS.maxGapMs +
    WATCH_DEFAULTS.recorderSetupAllowanceMs;
  const anticipatedSpecs = recorderSourceSpecs({
    recorderDir: RECORDER_DIR,
    startMs: anticipatedStartMs,
    endMs: anticipatedEndMs,
  });

  let samplesHandle = null;
  let baseline = null;
  let startWatermarks = [];
  let window = null;
  let watchSummary = null;
  let primaryError = null;
  const finalizationErrors = [];
  let recorderSlices = { summaries: [], errors: [], coverage: null };
  let executableSourceEndHashes = [];
  let finalDroppedLineCount = null;
  let droppedLineDelta = null;
  let finalApiHeartbeat = null;
  let finalWallDriftMs = null;
  let runtimeArtifactTiming = null;
  let interruptionReason = null;

  try {
    startWatermarks = await captureWatermarks(anticipatedSpecs, true);
    await writeExclusiveJson(
      path.join(outDir, "recorder-start-watermarks.json"),
      {
        capturedAt: new Date().toISOString(),
        anticipatedStartMs,
        anticipatedEndMs,
        watermarks: startWatermarks,
      },
    );
    const firstBaseline = await captureRuntimeState();
    finalApiHeartbeat = firstBaseline.apiHeartbeat;
    capturePortOwnership(procInspector, firstBaseline.chain[0]);
    captureClosedInspectorPort(
      procInspector,
      firstBaseline.chain[0],
      "before the watch baseline",
    );
    baseline = await waitForApiHeartbeatAfter(
      Date.parse(firstBaseline.apiHeartbeat.updatedAt),
      firstBaseline.chain,
      firstBaseline.recorderTimings,
      abortController.signal,
      firstBaseline.nodeOptions,
    );
    finalApiHeartbeat = baseline.apiHeartbeat;
    const baselineOwnership = capturePortOwnership(
      procInspector,
      baseline.chain[0],
    );
    const baselineInspector = captureClosedInspectorPort(
      procInspector,
      baseline.chain[0],
      "at the watch start boundary",
    );
    const startDroppedLineCount = droppedLineCount(baseline.apiHeartbeat);

    samplesHandle = await open(path.join(outDir, "samples.jsonl"), "wx", 0o600);
    window = { startWallMs: Date.now(), startMonoMs: performance.now() };
    runtimeArtifactTiming = assertRuntimeArtifactSnapshotsPredate({
      snapshots: executableSourceStartSnapshots,
      apiIdentity: baseline.chain[0],
      heartbeat: baseline.apiHeartbeat,
      watchStartMs: window.startWallMs,
    });
    await writeExclusiveJson(path.join(outDir, "metadata.json"), {
      schemaVersion: 3,
      evidenceModel: "procfs-api-to-pid2+api-flight-recorder-v1",
      contract: WATCH_DEFAULTS,
      outDir,
      recorderDir: RECORDER_DIR,
      recorderSettleMs: baseline.recorderTimings.recorderSettleMs,
      recorderSliceMaxBytes: MAX_RECORDER_SLICE_BYTES,
      recorderCompletenessCeiling:
        "Watermarks prove the exact on-disk byte range. The API recorder does not expose pending/in-flight async-buffer state, and event timestamps have millisecond resolution; a live-process slice cannot prove that every in-memory line reached disk or order events tied exactly at a window boundary.",
      producerCounterBoundaryCeiling:
        "Successful-write completion counters are visible one heartbeat later. The final successor is validated, but cumulative counters do not timestamp each violation; a counter increase first visible after the end boundary conservatively invalidates the watch even if the violation began just after that boundary.",
      heartbeatForensicCeiling:
        "finalApiHeartbeat preserves the newest successfully parsed bounded JSON object observed. Invalid UTF-8, malformed JSON, non-object JSON, and payloads over the 1 MiB cap fail before an embeddable object exists; the watcher does not perform an unbounded fallback read.",
      recorderTimings: baseline.recorderTimings,
      canonicalNodeOptions: baseline.nodeOptions,
      scriptPath: SCRIPT_PATH,
      scriptStartSha256: scriptStartHash,
      executableSourceSnapshots: executableSourceStartSnapshots,
      runtimeArtifactTiming,
      windowStartedAt: new Date(window.startWallMs).toISOString(),
      baseline: {
        processChain: baseline.chain,
        apiHeartbeat: baseline.apiHeartbeat,
        ownership: baselineOwnership,
        inspector: baselineInspector,
        droppedJsonLineCount: startDroppedLineCount,
      },
      recorderStartWatermarks: startWatermarks,
    });
    watchSummary = await runWatch({
      baseline,
      procInspector,
      samplesHandle,
      signal: abortController.signal,
      window,
    });
  } catch (error) {
    primaryError = error;
    finalApiHeartbeat = lastObservedApiHeartbeatFromError(error);
  } finally {
    window ??= { startWallMs: Date.now(), startMonoMs: performance.now() };
    window.endWallMs = Date.now();
    window.endMonoMs = performance.now();
    try {
      finalWallDriftMs = assertWallClockDrift(
        window.startWallMs,
        window.endWallMs,
        window.startMonoMs,
        window.endMonoMs,
        WATCH_DEFAULTS.maxWallDriftMs,
      );
    } catch (error) {
      finalizationErrors.push(`final wall-clock check: ${errorMessage(error)}`);
    }
    if (samplesHandle) {
      try {
        await samplesHandle.close();
      } catch (error) {
        finalizationErrors.push(`samples close: ${errorMessage(error)}`);
      }
    }

    if (baseline) {
      await sleep(baseline.recorderTimings.recorderSettleMs);
      try {
        const finalState = await waitForApiHeartbeatAfter(
          window.endWallMs,
          baseline.chain,
          baseline.recorderTimings,
          null,
          baseline.nodeOptions,
        );
        finalApiHeartbeat = finalState.apiHeartbeat;
        captureClosedInspectorPort(
          procInspector,
          finalState.chain[0],
          "at the watch end boundary",
        );
        if (watchSummary) {
          watchSummary.apiHeartbeatProgress = assertApiHeartbeatProgress(
            watchSummary.apiHeartbeatProgress,
            finalState.apiHeartbeat,
            Date.now(),
            baseline.recorderTimings.apiHeartbeatIntervalMs,
          );
          watchSummary.apiHeartbeatAdvanceCount =
            watchSummary.apiHeartbeatProgress.advanceCount;
        }
        finalDroppedLineCount = droppedLineCount(finalState.apiHeartbeat);
        droppedLineDelta = assertNoDroppedLines(
          droppedLineCount(baseline.apiHeartbeat),
          finalDroppedLineCount,
        );
      } catch (error) {
        finalApiHeartbeat =
          lastObservedApiHeartbeatFromError(error) ?? finalApiHeartbeat;
        finalizationErrors.push(
          `final runtime identity/publication/dropped-line check: ${errorMessage(error)}`,
        );
      }

      const actualSpecs = recorderSourceSpecs({
        recorderDir: RECORDER_DIR,
        startMs: window.startWallMs,
        endMs: window.endWallMs,
      });
      recorderSlices = await finalizeRecorderSlices({
        startWatermarks,
        specs: actualSpecs,
        windowStartMs: window.startWallMs,
        windowEndMs: window.endWallMs,
        apiPid: baseline.chain[0].pid,
        recorderTimings: baseline.recorderTimings,
        outDir,
      });
      finalizationErrors.push(
        ...recorderSlices.errors.map(
          (value) => `recorder ${value.source}: ${value.error}`,
        ),
      );
    }

    try {
      try {
        executableSourceEndHashes = await currentExecutableSourceHashes(
          executableSourceStartSnapshots,
        );
        assertExecutableSourceHashesUnchanged(
          executableSourceStartSnapshots,
          executableSourceEndHashes,
        );
        await assertExecutableSnapshotCopies(
          outDir,
          executableSourceStartSnapshots,
        );
      } catch (error) {
        finalizationErrors.push(
          `executable source check: ${errorMessage(error)}`,
        );
      }
      const acceptance = watchEvidenceAcceptance({
        primaryError,
        finalizationErrors,
        signal: abortController.signal,
      });
      interruptionReason = acceptance.interruptionReason;
      const scriptEndHash =
        executableSourceEndHashes.find((entry) => entry.path === SCRIPT_PATH)
          ?.sha256 ?? null;
      const resultArtifact = buildPrehashedJsonArtifact("result.json", {
        schemaVersion: 3,
        evidenceModel: "procfs-api-to-pid2+api-flight-recorder-v1",
        ...buildEvidenceVerdict(acceptance.evidenceIntegrityPassed),
        commitAcceptanceRequirement:
          "Require watcher process exit status 0; an interruption observed after result serialization forces a nonzero exit and invalidates acceptance.",
        interruptionReason,
        primaryError: primaryError ? errorMessage(primaryError) : null,
        finalizationErrors,
        windowStartedAt: new Date(window.startWallMs).toISOString(),
        windowEndedAt: new Date(window.endWallMs).toISOString(),
        monotonicDurationMs: window.endMonoMs - window.startMonoMs,
        wallDurationMs: window.endWallMs - window.startWallMs,
        finalWallDriftMs,
        watchSummary: watchSummary
          ? {
              sampleCount: watchSummary.samples.length,
              probeCount: watchSummary.probeCount,
              apiHeartbeatAdvanceCount: watchSummary.apiHeartbeatAdvanceCount,
              healthInstanceToken: watchSummary.healthToken,
            }
          : null,
        baselinePids: baseline
          ? {
              api: baseline.chain[0].pid,
              apiLauncher: baseline.chain[1].pid,
              supervisor: baseline.chain[2].pid,
              workflowLauncher: baseline.chain[3].pid,
              pid2: baseline.chain[4].pid,
            }
          : null,
        finalDroppedJsonLineCount: finalDroppedLineCount,
        droppedJsonLineDelta: droppedLineDelta,
        finalApiHeartbeat,
        recorderSlices: recorderSlices.summaries,
        recorderCoverage: recorderSlices.coverage,
        scriptStartSha256: scriptStartHash,
        scriptEndSha256: scriptEndHash,
        executableSourceStartHashes: executableSourceStartSnapshots.map(
          ({ path: sourcePath, sha256 }) => ({ path: sourcePath, sha256 }),
        ),
        executableSourceEndHashes,
        runtimeArtifactTiming,
        canonicalNodeOptions: baseline?.nodeOptions ?? null,
      });
      // File and directory fsyncs preserve this ordering: the manifest is
      // committed before the result it authenticates. A successful process
      // exit is still required because a post-result fsync error is external
      // to the already serialized evidence-integrity verdict.
      await commitResultEvidence(outDir, resultArtifact);
      const postCommitInterruptionReason = boundedWatchInterruptionReason(
        abortController.signal,
      );
      if (postCommitInterruptionReason != null) {
        interruptionReason ??= postCommitInterruptionReason;
      }
    } catch (error) {
      primaryError ??= error;
      console.error(`could not commit result evidence: ${errorMessage(error)}`);
    }
    interruptionReason ??= boundedWatchInterruptionReason(
      abortController.signal,
    );
    // Keep both handlers through natural exit. Removing them here creates a
    // window where an already-queued OS signal can lose its nonzero verdict.
  }

  console.log(`same-process runtime watch evidence: ${outDir}`);
  if (primaryError || finalizationErrors.length > 0 || interruptionReason) {
    if (primaryError) console.error(errorMessage(primaryError));
    for (const error of finalizationErrors) console.error(error);
    if (
      interruptionReason &&
      (!primaryError || errorMessage(primaryError) !== interruptionReason)
    ) {
      console.error(interruptionReason);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
