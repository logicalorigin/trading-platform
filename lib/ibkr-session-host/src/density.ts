import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { readLinuxBoottimeNs } from "./lease-clock";

import {
  CapsuleError,
  CapsuleManager,
  type CapsuleLeaseGrant,
  type RuntimeReadiness,
  type SessionHostConfig,
  checkCapsuleRuntime,
  execFileCommandRunner,
  loadSessionHostConfig,
} from "./capsule";
import { CapsuleFleetManager } from "./fleet";

const DENSITY_SCHEMA = "pyrus.ibkr.capsule-density.v1";
const DEFAULT_LEVELS = [1, 2, 5, 10, 15, 20] as const;
const DEFAULT_SAMPLE_INTERVAL_MS = 10_000;
const DEFAULT_INTERMEDIATE_HOLD_MS = 120_000;
const DEFAULT_FINAL_HOLD_MS = 600_000;
const BOOT_API_SAMPLE_INTERVAL_MS = 5_000;
// Match production: PID 1 adds 120 seconds, so a 20-second grant yields a
// 140-second capsule deadline inside the 155-second database replacement fence.
const GRANT_WINDOW_NS = 20_000_000_000n;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const WORKLOAD_IDENTITY_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const BOOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IMAGE_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/u;

export type DensityFleet = Pick<
  CapsuleFleetManager,
  "ensure" | "keepalive" | "release" | "status"
>;

type DensityPlacement = {
  bootDurationMs: number;
  sessionId: string;
  slotNumber: number;
};

type DensityCapsuleSample = {
  cpuPercent: string;
  memoryPercent: string;
  memoryUsage: string;
  name: string;
  oomKilled: boolean;
  pids: string;
  restartCount: number;
  running: boolean;
};

type DensitySample = {
  api: {
    latencyMs: number;
    ok: boolean;
    status: number | null;
  };
  capsules: DensityCapsuleSample[];
  host: {
    loadAverage: [number, number, number];
    memoryAvailableBytes: number;
    memoryTotalBytes: number;
    swapFreeBytes: number;
    swapTotalBytes: number;
  };
  target: number;
};

export type CapsuleDensityRuntime = {
  acquireControlPort: () => Promise<() => Promise<void>>;
  createLeaseGrant: (action: "ensure" | "keepalive") => CapsuleLeaseGrant;
  createSessionId: (slotNumber: number) => string;
  delay: (durationMs: number) => Promise<void>;
  fleet: DensityFleet;
  listExistingCapsules: () => Promise<string[]>;
  now: () => Date;
  onProgress?: (event: string) => void;
  readRuntimeReadiness: () => Promise<RuntimeReadiness>;
  sample: (
    target: number,
    placements: readonly DensityPlacement[],
  ) => Promise<DensitySample>;
  sampleApi: () => Promise<DensitySample["api"]>;
};

type CapsuleDensityRelease = {
  deploymentId: string;
  imageReference: string;
  manifestSha256: string;
  releaseCommit: string;
  runtimeAttestationDigest: string;
  runtimeSpecDigest: string;
  vmSize: string;
  workloadIdentityDigest: string;
};

type CapsuleDensityPlan = {
  finalHoldMs: number;
  intermediateHoldMs: number;
  levels: readonly number[];
  sampleIntervalMs: number;
};

type DensityStageReport = {
  bootApiSamples: Array<DensitySample["api"] & { sampledAt: string }>;
  placements: DensityPlacement[];
  readyAt: string;
  samples: Array<DensitySample & { sampledAt: string }>;
  startedAt: string;
  target: number;
};

type CapsuleDensityReport = {
  cleanup: {
    complete: boolean;
    releaseFailures: number[];
    remainingCapsules: string[];
  };
  completedAt: string;
  plan: CapsuleDensityPlan;
  release: CapsuleDensityRelease;
  schema: typeof DENSITY_SCHEMA;
  stages: DensityStageReport[];
  startedAt: string;
  verdict: {
    failureCode: string | null;
    mechanicalPass: boolean;
    promotionApplied: false;
  };
};

class DensityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DensityError";
  }
}

function validateTextIdentity(name: string, value: string): void {
  if (
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new DensityError("invalid_density_input", `${name} is invalid.`);
  }
}

function validateRelease(release: CapsuleDensityRelease): void {
  validateTextIdentity("deployment ID", release.deploymentId);
  validateTextIdentity("VM size", release.vmSize);
  if (
    !IMAGE_REFERENCE_PATTERN.test(release.imageReference) ||
    !SHA256_PATTERN.test(release.manifestSha256) ||
    !COMMIT_PATTERN.test(release.releaseCommit) ||
    !SHA256_PATTERN.test(release.runtimeAttestationDigest) ||
    !SHA256_PATTERN.test(release.runtimeSpecDigest) ||
    !WORKLOAD_IDENTITY_PATTERN.test(release.workloadIdentityDigest)
  ) {
    throw new DensityError(
      "invalid_density_input",
      "The density release identity is invalid.",
    );
  }
}

function validatePlan(plan: CapsuleDensityPlan): void {
  if (
    plan.levels.length < 1 ||
    plan.levels.some(
      (level, index) =>
        !Number.isInteger(level) ||
        level < 1 ||
        level > 20 ||
        (index > 0 && level <= plan.levels[index - 1]!),
    ) ||
    !Number.isSafeInteger(plan.sampleIntervalMs) ||
    plan.sampleIntervalMs < 1 ||
    !Number.isSafeInteger(plan.intermediateHoldMs) ||
    plan.intermediateHoldMs < 0 ||
    !Number.isSafeInteger(plan.finalHoldMs) ||
    plan.finalHoldMs < 0
  ) {
    throw new DensityError(
      "invalid_density_plan",
      "The capsule density plan is invalid.",
    );
  }
}

function failureCodeFor(error: unknown): string {
  if (error instanceof DensityError || error instanceof CapsuleError) {
    return error.code;
  }
  return "density_failed";
}

function sampleIsHealthy(
  sample: DensitySample,
  placements: readonly DensityPlacement[],
): boolean {
  if (
    !sample.api.ok ||
    sample.api.status !== 200 ||
    !Number.isFinite(sample.api.latencyMs) ||
    sample.api.latencyMs < 0 ||
    sample.target !== placements.length ||
    sample.capsules.length !== placements.length ||
    !Number.isFinite(sample.host.memoryTotalBytes) ||
    sample.host.memoryTotalBytes <= 0 ||
    !Number.isFinite(sample.host.memoryAvailableBytes) ||
    sample.host.memoryAvailableBytes < 0 ||
    sample.host.memoryAvailableBytes > sample.host.memoryTotalBytes ||
    !Number.isFinite(sample.host.swapTotalBytes) ||
    sample.host.swapTotalBytes < 0 ||
    !Number.isFinite(sample.host.swapFreeBytes) ||
    sample.host.swapFreeBytes < 0 ||
    sample.host.swapFreeBytes > sample.host.swapTotalBytes ||
    sample.host.loadAverage.some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    return false;
  }
  const expectedNames = new Set(
    placements.map(({ slotNumber }) => `pyrus-ibkr-slot-${slotNumber}`),
  );
  return sample.capsules.every(
    (capsule) =>
      expectedNames.delete(capsule.name) &&
      capsule.running &&
      !capsule.oomKilled &&
      capsule.restartCount === 0 &&
      capsule.cpuPercent.length > 0 &&
      capsule.memoryPercent.length > 0 &&
      capsule.memoryUsage.length > 0 &&
      capsule.pids.length > 0,
  );
}

function apiSampleIsHealthy(sample: DensitySample["api"]): boolean {
  return (
    sample.ok &&
    sample.status === 200 &&
    Number.isFinite(sample.latencyMs) &&
    sample.latencyMs >= 0
  );
}

async function renewAndSample(
  target: number,
  placements: readonly DensityPlacement[],
  runtime: CapsuleDensityRuntime,
): Promise<DensitySample & { sampledAt: string }> {
  for (const { sessionId, slotNumber } of placements) {
    await runtime.fleet.keepalive(
      sessionId,
      1,
      slotNumber,
      runtime.createLeaseGrant("keepalive"),
    );
  }
  const sample = await runtime.sample(target, placements);
  if (!sampleIsHealthy(sample, placements)) {
    throw new DensityError(
      "density_sample_unhealthy",
      "A density health sample failed.",
    );
  }
  return { ...sample, sampledAt: runtime.now().toISOString() };
}

async function holdAndSample(
  target: number,
  holdMs: number,
  placements: readonly DensityPlacement[],
  runtime: CapsuleDensityRuntime,
  sampleIntervalMs: number,
): Promise<Array<DensitySample & { sampledAt: string }>> {
  const samples = [await renewAndSample(target, placements, runtime)];
  let elapsedMs = 0;
  while (elapsedMs < holdMs) {
    const waitMs = Math.min(sampleIntervalMs, holdMs - elapsedMs);
    await runtime.delay(waitMs);
    elapsedMs += waitMs;
    samples.push(await renewAndSample(target, placements, runtime));
  }
  return samples;
}

export async function runCapsuleDensity(
  release: CapsuleDensityRelease,
  runtime: CapsuleDensityRuntime,
  plan: CapsuleDensityPlan = {
    finalHoldMs: DEFAULT_FINAL_HOLD_MS,
    intermediateHoldMs: DEFAULT_INTERMEDIATE_HOLD_MS,
    levels: DEFAULT_LEVELS,
    sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
  },
): Promise<CapsuleDensityReport> {
  const startedAt = runtime.now().toISOString();
  const stages: DensityStageReport[] = [];
  const active: DensityPlacement[] = [];
  const releaseFailures: number[] = [];
  let releaseControlPort: (() => Promise<void>) | null = null;
  let failureCode: string | null = null;
  let remainingCapsules: string[] = [];

  try {
    validateRelease(release);
    validatePlan(plan);
    releaseControlPort = await runtime.acquireControlPort();
    const readiness = await runtime.readRuntimeReadiness();
    if (!readiness.ready) {
      throw new DensityError(
        readiness.code,
        "The capsule runtime is not ready.",
      );
    }
    remainingCapsules = (await runtime.listExistingCapsules()).sort();
    if (remainingCapsules.length > 0) {
      throw new DensityError(
        "existing_capsules",
        "The density runner requires an empty capsule host.",
      );
    }

    for (const target of plan.levels) {
      runtime.onProgress?.(`stage_${target}_start`);
      const stageStartedAt = runtime.now();
      const additions = Array.from(
        { length: target - active.length },
        (_, index) => active.length + index + 1,
      );
      let additionsComplete = false;
      const additionsPromise = Promise.allSettled(
        additions.map(async (slotNumber) => {
          const sessionId = runtime.createSessionId(slotNumber);
          const bootStartedAt = runtime.now().getTime();
          await runtime.fleet.ensure(
            sessionId,
            1,
            slotNumber,
            runtime.createLeaseGrant("ensure"),
          );
          active.push({
            bootDurationMs: Math.max(
              0,
              runtime.now().getTime() - bootStartedAt,
            ),
            sessionId,
            slotNumber,
          });
        }),
      ).finally(() => {
        additionsComplete = true;
      });
      const bootApiSamples: DensityStageReport["bootApiSamples"] = [];
      let bootApiHealthy = true;
      let bootSampleFailure: unknown = null;
      try {
        do {
          const sample = await runtime.sampleApi();
          bootApiSamples.push({
            ...sample,
            sampledAt: runtime.now().toISOString(),
          });
          if (!apiSampleIsHealthy(sample)) bootApiHealthy = false;
          if (!additionsComplete) {
            await runtime.delay(BOOT_API_SAMPLE_INTERVAL_MS);
          }
        } while (!additionsComplete);
      } catch (error) {
        bootSampleFailure = error;
      }
      const additionsSettled = await additionsPromise;
      if (bootSampleFailure) throw bootSampleFailure;
      const failedAddition = additionsSettled.find(
        (result) => result.status === "rejected",
      );
      if (failedAddition?.status === "rejected") {
        throw failedAddition.reason;
      }
      if (!bootApiHealthy) {
        throw new DensityError(
          "api_unhealthy_during_boot",
          "The application API was unhealthy while density capsules booted.",
        );
      }
      active.sort((left, right) => left.slotNumber - right.slotNumber);
      const readyAt = runtime.now().toISOString();
      const holdMs =
        target === plan.levels.at(-1)
          ? plan.finalHoldMs
          : plan.intermediateHoldMs;
      const samples = await holdAndSample(
        target,
        holdMs,
        active,
        runtime,
        plan.sampleIntervalMs,
      );
      stages.push({
        bootApiSamples,
        placements: active.map((placement) => ({ ...placement })),
        readyAt,
        samples,
        startedAt: stageStartedAt.toISOString(),
        target,
      });
      runtime.onProgress?.(`stage_${target}_pass`);
    }
  } catch (error) {
    failureCode = failureCodeFor(error);
    runtime.onProgress?.(`failed_${failureCode}`);
  } finally {
    const placements = [...active].sort(
      (left, right) => right.slotNumber - left.slotNumber,
    );
    const releases = await Promise.allSettled(
      placements.map(({ sessionId, slotNumber }) =>
        runtime.fleet.release(sessionId, 1, slotNumber),
      ),
    );
    releases.forEach((result, index) => {
      if (result.status === "rejected") {
        releaseFailures.push(placements[index]!.slotNumber);
      }
    });
    if (releaseControlPort) {
      try {
        remainingCapsules = (await runtime.listExistingCapsules()).sort();
      } catch {
        failureCode ??= "cleanup_unconfirmed";
        remainingCapsules = ["unconfirmed"];
      }
      try {
        await releaseControlPort();
      } catch {
        failureCode ??= "control_port_cleanup_failed";
      }
    }
  }

  const cleanupComplete =
    releaseFailures.length === 0 && remainingCapsules.length === 0;
  if (!cleanupComplete) failureCode ??= "cleanup_unconfirmed";
  return {
    cleanup: {
      complete: cleanupComplete,
      releaseFailures,
      remainingCapsules,
    },
    completedAt: runtime.now().toISOString(),
    plan,
    release,
    schema: DENSITY_SCHEMA,
    stages,
    startedAt,
    verdict: {
      failureCode,
      mechanicalPass: failureCode === null && cleanupComplete,
      promotionApplied: false,
    },
  };
}

function parseJsonLines(value: string): Array<Record<string, unknown>> {
  return value
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid Docker JSON");
      }
      return parsed as Record<string, unknown>;
    });
}

function parseMeminfo(value: string): DensitySample["host"] {
  const fields = new Map(
    value
      .split("\n")
      .map((line) => /^([A-Za-z_]+):\s+([0-9]+)\s+kB$/u.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1]!, Number(match[2]!) * 1024]),
  );
  const memoryTotalBytes = fields.get("MemTotal");
  const memoryAvailableBytes = fields.get("MemAvailable");
  const swapTotalBytes = fields.get("SwapTotal");
  const swapFreeBytes = fields.get("SwapFree");
  if (
    typeof memoryTotalBytes !== "number" ||
    !Number.isSafeInteger(memoryTotalBytes) ||
    typeof memoryAvailableBytes !== "number" ||
    !Number.isSafeInteger(memoryAvailableBytes) ||
    typeof swapTotalBytes !== "number" ||
    !Number.isSafeInteger(swapTotalBytes) ||
    typeof swapFreeBytes !== "number" ||
    !Number.isSafeInteger(swapFreeBytes)
  ) {
    throw new Error("invalid Linux memory metrics");
  }
  return {
    loadAverage: [0, 0, 0],
    memoryAvailableBytes,
    memoryTotalBytes,
    swapFreeBytes,
    swapTotalBytes,
  };
}

async function acquireControlPort(
  config: SessionHostConfig,
): Promise<() => Promise<void>> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.bindHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch {
    throw new DensityError(
      "session_host_active",
      "The production session host control port is already active.",
    );
  }
  return () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function listExistingCapsules(
  config: SessionHostConfig,
): Promise<string[]> {
  const result = await execFileCommandRunner(config.dockerBinary, [
    "container",
    "ls",
    "--all",
    "--format",
    "{{.Names}}",
  ]);
  if (result.code !== 0) {
    throw new DensityError(
      "docker_unavailable",
      "Docker capsule state could not be inspected.",
    );
  }
  return result.stdout
    .split("\n")
    .filter((name) => name.startsWith("pyrus-ibkr-slot-"));
}

function loadBootId(): string {
  let bootId = "";
  try {
    bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    // The production topology is Linux-only; validation below fails closed.
  }
  if (!BOOT_ID_PATTERN.test(bootId)) {
    throw new DensityError(
      "lease_clock_unavailable",
      "The Linux boot identity is unavailable.",
    );
  }
  return bootId;
}

async function fetchApiHealth(): Promise<DensitySample["api"]> {
  const startedAt = Date.now();
  try {
    const response = await fetch("http://127.0.0.1:18747/api/healthz", {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel();
    return {
      latencyMs: Date.now() - startedAt,
      ok: response.status === 200,
      status: response.status,
    };
  } catch {
    return {
      latencyMs: Date.now() - startedAt,
      ok: false,
      status: null,
    };
  }
}

async function sampleHostAndCapsules(
  config: SessionHostConfig,
  target: number,
  placements: readonly DensityPlacement[],
): Promise<DensitySample> {
  const names = placements.map(
    ({ slotNumber }) => `pyrus-ibkr-slot-${slotNumber}`,
  );
  const [inspection, stats, meminfo, loadavg, api] = await Promise.all([
    execFileCommandRunner(config.dockerBinary, [
      "container",
      "inspect",
      "--format",
      "{{json .}}",
      ...names,
    ]),
    execFileCommandRunner(config.dockerBinary, [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      ...names,
    ]),
    readFile("/proc/meminfo", "utf8"),
    readFile("/proc/loadavg", "utf8"),
    fetchApiHealth(),
  ]);
  if (inspection.code !== 0 || stats.code !== 0) {
    throw new DensityError(
      "docker_sample_failed",
      "Docker density state could not be sampled.",
    );
  }
  const inspected = parseJsonLines(inspection.stdout);
  const statsByName = new Map(
    parseJsonLines(stats.stdout).map((record) => [
      String(record["Name"] ?? ""),
      record,
    ]),
  );
  const host = parseMeminfo(meminfo);
  const loadFields = loadavg.trim().split(/\s+/).slice(0, 3).map(Number);
  if (
    loadFields.length !== 3 ||
    loadFields.some((value) => !Number.isFinite(value))
  ) {
    throw new DensityError(
      "host_sample_failed",
      "Linux load metrics could not be sampled.",
    );
  }
  host.loadAverage = [loadFields[0]!, loadFields[1]!, loadFields[2]!];
  const capsules = inspected.map((record): DensityCapsuleSample => {
    const name = String(record["Name"] ?? "").replace(/^\//u, "");
    const state =
      record["State"] &&
      typeof record["State"] === "object" &&
      !Array.isArray(record["State"])
        ? (record["State"] as Record<string, unknown>)
        : {};
    const resource = statsByName.get(name);
    return {
      cpuPercent: String(resource?.["CPUPerc"] ?? ""),
      memoryPercent: String(resource?.["MemPerc"] ?? ""),
      memoryUsage: String(resource?.["MemUsage"] ?? ""),
      name,
      oomKilled: state["OOMKilled"] === true,
      pids: String(resource?.["PIDs"] ?? ""),
      restartCount: Number(record["RestartCount"]),
      running:
        state["Running"] === true &&
        state["Restarting"] === false &&
        state["Status"] === "running",
    };
  });
  return { api, capsules, host, target };
}

function createDefaultRuntime(
  config: SessionHostConfig,
  signal: AbortSignal,
): CapsuleDensityRuntime {
  let bootId: string | null = null;
  const fleet = new CapsuleFleetManager(
    config.capacity,
    (slotNumber) =>
      new CapsuleManager(config, execFileCommandRunner, undefined, slotNumber),
  );
  const requireActive = (): void => {
    if (signal.aborted) {
      throw new DensityError(
        "density_interrupted",
        "The capsule density run was interrupted.",
      );
    }
  };
  return {
    acquireControlPort: () => acquireControlPort(config),
    createLeaseGrant: (_action) => {
      requireActive();
      return {
        bootId: (bootId ??= loadBootId()),
        controlAttemptId: randomUUID(),
        grantNotAfterNs: String(readLinuxBoottimeNs() + GRANT_WINDOW_NS),
        version: 1,
      };
    },
    createSessionId: () => randomUUID(),
    delay: (durationMs) =>
      new Promise((resolve, reject) => {
        requireActive();
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(
            new DensityError(
              "density_interrupted",
              "The capsule density run was interrupted.",
            ),
          );
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, durationMs);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    fleet,
    listExistingCapsules: () => listExistingCapsules(config),
    now: () => new Date(),
    onProgress: (event) => console.log(`[ibkr-capsule-density] ${event}`),
    readRuntimeReadiness: async () => {
      requireActive();
      return checkCapsuleRuntime(execFileCommandRunner, config);
    },
    sample: async (target, placements) => {
      requireActive();
      const sample = await sampleHostAndCapsules(config, target, placements);
      requireActive();
      return sample;
    },
    sampleApi: async () => {
      requireActive();
      const sample = await fetchApiHealth();
      requireActive();
      return sample;
    },
  };
}

function usage(): string {
  return [
    "Usage:",
    "  node lib/ibkr-session-host/dist/density.mjs --image=REPOSITORY@sha256:... --manifest-sha256=sha256:... --release-commit=COMMIT --runtime-spec-digest=sha256:... --runtime-attestation-digest=sha256:... --workload-identity-digest=HEX --deployment-id=ID --vm-size=SIZE --report=PATH --execute",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "deployment-id": { type: "string" },
      execute: { type: "boolean", default: false },
      image: { type: "string" },
      "manifest-sha256": { type: "string" },
      "release-commit": { type: "string" },
      report: { type: "string" },
      "runtime-attestation-digest": { type: "string" },
      "runtime-spec-digest": { type: "string" },
      "vm-size": { type: "string" },
      "workload-identity-digest": { type: "string" },
    },
    strict: true,
  });
  if (
    !values.execute ||
    !values.image ||
    !values["manifest-sha256"] ||
    !values["release-commit"] ||
    !values["runtime-attestation-digest"] ||
    !values["runtime-spec-digest"] ||
    !values["workload-identity-digest"] ||
    !values["deployment-id"] ||
    !values["vm-size"] ||
    !values.report
  ) {
    throw new Error(usage());
  }
  if (
    process.env["IBKR_GATEWAY_FLEET_ENABLED"] !== "0" ||
    process.env["IBKR_SESSION_HOST_ENABLED"] !== "0"
  ) {
    throw new Error(
      "Capsule density execution requires fleet routing and the production session host to be explicitly disabled.",
    );
  }

  const reportPath = path.resolve(values.report);
  const reportFile = await open(reportPath, "wx");
  const abortController = new AbortController();
  const interrupt = (): void => abortController.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const config = loadSessionHostConfig({
      IBKR_SESSION_CAPSULE_IMAGE: values.image,
      IBKR_SESSION_HOST_CAPACITY: "20",
      IBKR_SESSION_HOST_MODE: "paper",
      IBKR_SESSION_HOST_PORT: "18748",
    });
    const report = await runCapsuleDensity(
      {
        deploymentId: values["deployment-id"],
        imageReference: values.image,
        manifestSha256: values["manifest-sha256"],
        releaseCommit: values["release-commit"],
        runtimeAttestationDigest: values["runtime-attestation-digest"],
        runtimeSpecDigest: values["runtime-spec-digest"],
        vmSize: values["vm-size"],
        workloadIdentityDigest: values["workload-identity-digest"],
      },
      createDefaultRuntime(config, abortController.signal),
    );
    await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.verdict.mechanicalPass) process.exitCode = 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await reportFile.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(
      `[ibkr-capsule-density] ${
        error instanceof Error ? error.message : "failed"
      }`,
    );
    process.exitCode = 1;
  });
}
