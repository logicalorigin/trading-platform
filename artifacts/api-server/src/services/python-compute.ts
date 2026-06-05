import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../lib/logger";

export type PythonComputeStatus =
  | "disabled"
  | "starting"
  | "healthy"
  | "degraded"
  | "stopped";

export type PythonComputeDiagnostics = {
  enabled: boolean;
  status: PythonComputeStatus;
  cwd: string;
  host: string;
  port: number;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  restartCount: number;
  laneId?: PythonComputeLaneId;
  label?: string;
  jobTypes?: PythonComputeJobType[];
};

export type PythonComputeLaneId = "risk" | "research" | "backtest";

export type PythonComputeJobType =
  | "benchmark_matrix"
  | "greek_scenario_matrix"
  | "portfolio_optimization"
  | "portfolio_risk"
  | "signal_matrix";

export type PythonComputeJobRequest = {
  jobType: PythonComputeJobType;
  schemaVersion?: 1;
  input?: Record<string, unknown>;
  options?: {
    timeoutMs?: number;
  };
};

export type PythonComputeJobAccepted = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
};

export type PythonComputeJobResult = PythonComputeJobAccepted & {
  jobType: PythonComputeJobType;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  warnings: string[];
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

export type PythonComputeRunJobOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type RuntimeConfig = {
  enabled: boolean;
  cwd: string;
  host: string;
  port: number;
  startupTimeoutMs: number;
};

type RuntimeDeps = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cwd?: string;
  spawnProcess?: typeof spawn;
  fetch?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  laneDefinition?: PythonComputeLaneDefinition;
};

const DEFAULT_PORT = 18_768;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_GLOBAL_MAX_ACTIVE_JOBS = 6;

type PythonComputeLaneTemplate = {
  id: PythonComputeLaneId;
  label: string;
  defaultPort: number;
  enabledEnv: string;
  rootEnv: string;
  hostEnv: string;
  portEnv: string;
  startupTimeoutEnv: string;
  fallbackEnvPrefix?: "legacy";
  jobTypes: PythonComputeJobType[];
};

export type PythonComputeLaneDefinition = {
  id: PythonComputeLaneId;
  label: string;
  config: RuntimeConfig;
  jobTypes: PythonComputeJobType[];
};

export type PythonComputeLaneDiagnostics = PythonComputeDiagnostics & {
  laneId: PythonComputeLaneId;
  label: string;
  jobTypes: PythonComputeJobType[];
  activeRoutedJobs: number;
  rejectedJobs: number;
};

export type PythonComputeRouterDiagnostics = PythonComputeDiagnostics & {
  lanes: Record<PythonComputeLaneId, PythonComputeLaneDiagnostics>;
  global: {
    activeJobs: number;
    maxActiveJobs: number;
    rejectedJobs: number;
  };
  routing: Record<PythonComputeJobType, PythonComputeLaneId>;
};

export type PythonComputeRuntimeLike = {
  start(): Promise<PythonComputeDiagnostics>;
  stop(): void;
  getDiagnostics(): PythonComputeDiagnostics;
  submitJob(
    request: PythonComputeJobRequest,
    timeoutMs?: number,
  ): Promise<PythonComputeJobAccepted>;
  getJob(jobId: string, timeoutMs?: number): Promise<PythonComputeJobResult>;
  cancelJob(jobId: string, timeoutMs?: number): Promise<PythonComputeJobResult>;
};

const PYTHON_COMPUTE_LANE_TEMPLATES: PythonComputeLaneTemplate[] = [
  {
    id: "risk",
    label: "Risk compute",
    defaultPort: DEFAULT_PORT,
    enabledEnv: "PYRUS_PYTHON_RISK_COMPUTE_ENABLED",
    rootEnv: "PYRUS_PYTHON_RISK_COMPUTE_ROOT",
    hostEnv: "PYRUS_PYTHON_RISK_COMPUTE_HOST",
    portEnv: "PYRUS_PYTHON_RISK_COMPUTE_PORT",
    startupTimeoutEnv: "PYRUS_PYTHON_RISK_COMPUTE_STARTUP_TIMEOUT_MS",
    fallbackEnvPrefix: "legacy",
    jobTypes: [
      "greek_scenario_matrix",
      "portfolio_optimization",
      "portfolio_risk",
    ],
  },
  {
    id: "research",
    label: "Research/chart compute",
    defaultPort: 18_770,
    enabledEnv: "PYRUS_PYTHON_RESEARCH_COMPUTE_ENABLED",
    rootEnv: "PYRUS_PYTHON_RESEARCH_COMPUTE_ROOT",
    hostEnv: "PYRUS_PYTHON_RESEARCH_COMPUTE_HOST",
    portEnv: "PYRUS_PYTHON_RESEARCH_COMPUTE_PORT",
    startupTimeoutEnv: "PYRUS_PYTHON_RESEARCH_COMPUTE_STARTUP_TIMEOUT_MS",
    jobTypes: ["benchmark_matrix", "signal_matrix"],
  },
  {
    id: "backtest",
    label: "Backtest compute",
    defaultPort: 18_771,
    enabledEnv: "PYRUS_PYTHON_BACKTEST_COMPUTE_ENABLED",
    rootEnv: "PYRUS_PYTHON_BACKTEST_COMPUTE_ROOT",
    hostEnv: "PYRUS_PYTHON_BACKTEST_COMPUTE_HOST",
    portEnv: "PYRUS_PYTHON_BACKTEST_COMPUTE_PORT",
    startupTimeoutEnv: "PYRUS_PYTHON_BACKTEST_COMPUTE_STARTUP_TIMEOUT_MS",
    jobTypes: [],
  },
];

const JOB_TYPE_LANE: Record<PythonComputeJobType, PythonComputeLaneId> = {
  benchmark_matrix: "research",
  greek_scenario_matrix: "risk",
  portfolio_optimization: "risk",
  portfolio_risk: "risk",
  signal_matrix: "research",
};

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function legacyEnvName(
  template: PythonComputeLaneTemplate,
  suffix: "ENABLED" | "ROOT" | "HOST" | "PORT" | "STARTUP_TIMEOUT_MS",
): string[] {
  if (template.fallbackEnvPrefix !== "legacy") {
    return [];
  }
  return [`PYRUS_PYTHON_COMPUTE_${suffix}`];
}

export function resolvePythonComputeRoot(cwd = process.cwd()): string {
  const fromRepoRoot = resolve(cwd, "python/pyrus_compute");
  if (existsSync(resolve(fromRepoRoot, "pyproject.toml"))) {
    return fromRepoRoot;
  }
  return resolve(cwd, "../../python/pyrus_compute");
}

export function resolvePythonComputeConfig(
  deps: RuntimeDeps = {},
): RuntimeConfig {
  const env = deps.env ?? process.env;
  const cwd = env["PYRUS_PYTHON_COMPUTE_ROOT"] ?? resolvePythonComputeRoot(deps.cwd);
  return {
    enabled: truthyEnv(env["PYRUS_PYTHON_COMPUTE_ENABLED"]),
    cwd,
    host: env["PYRUS_PYTHON_COMPUTE_HOST"] ?? "127.0.0.1",
    port: readPositiveInteger(env["PYRUS_PYTHON_COMPUTE_PORT"], DEFAULT_PORT),
    startupTimeoutMs: readPositiveInteger(
      env["PYRUS_PYTHON_COMPUTE_STARTUP_TIMEOUT_MS"],
      DEFAULT_STARTUP_TIMEOUT_MS,
    ),
  };
}

function resolvePythonComputeLaneConfig(
  template: PythonComputeLaneTemplate,
  deps: RuntimeDeps = {},
): RuntimeConfig {
  const env = deps.env ?? process.env;
  const cwd =
    readEnvValue(env, [template.rootEnv, ...legacyEnvName(template, "ROOT")]) ??
    resolvePythonComputeRoot(deps.cwd);
  return {
    enabled: truthyEnv(
      readEnvValue(env, [
        template.enabledEnv,
        ...legacyEnvName(template, "ENABLED"),
      ]),
    ),
    cwd,
    host:
      readEnvValue(env, [template.hostEnv, ...legacyEnvName(template, "HOST")]) ??
      "127.0.0.1",
    port: readPositiveInteger(
      readEnvValue(env, [template.portEnv, ...legacyEnvName(template, "PORT")]),
      template.defaultPort,
    ),
    startupTimeoutMs: readPositiveInteger(
      readEnvValue(env, [
        template.startupTimeoutEnv,
        ...legacyEnvName(template, "STARTUP_TIMEOUT_MS"),
      ]),
      DEFAULT_STARTUP_TIMEOUT_MS,
    ),
  };
}

export function resolvePythonComputeLaneDefinitions(
  deps: RuntimeDeps = {},
): PythonComputeLaneDefinition[] {
  return PYTHON_COMPUTE_LANE_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    config: resolvePythonComputeLaneConfig(template, deps),
    jobTypes: [...template.jobTypes],
  }));
}

export function routePythonComputeJobType(
  jobType: PythonComputeJobType,
): PythonComputeLaneId {
  return JOB_TYPE_LANE[jobType];
}

export class PythonComputeRuntime implements PythonComputeRuntimeLike {
  private child: ChildProcess | null = null;
  private diagnostics: PythonComputeDiagnostics;
  private stopping = false;
  private readonly config: RuntimeConfig;
  private readonly spawnProcess: typeof spawn;
  private readonly fetchFn: typeof fetch;
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly laneId: PythonComputeLaneId;
  private readonly label: string;
  private readonly jobTypes: PythonComputeJobType[];

  constructor(deps: RuntimeDeps = {}) {
    const laneDefinition = deps.laneDefinition;
    this.config = laneDefinition?.config ?? resolvePythonComputeConfig(deps);
    this.spawnProcess = deps.spawnProcess ?? spawn;
    this.fetchFn = deps.fetch ?? fetch;
    this.delayFn = deps.delay ?? delay;
    this.laneId = laneDefinition?.id ?? "risk";
    this.label = laneDefinition?.label ?? "Python compute";
    this.jobTypes = laneDefinition?.jobTypes ?? [
      "benchmark_matrix",
      "greek_scenario_matrix",
      "portfolio_optimization",
      "portfolio_risk",
    ];
    this.diagnostics = {
      enabled: this.config.enabled,
      status: this.config.enabled ? "stopped" : "disabled",
      cwd: this.config.cwd,
      host: this.config.host,
      port: this.config.port,
      pid: null,
      startedAt: null,
      lastError: null,
      restartCount: 0,
      laneId: this.laneId,
      label: this.label,
      jobTypes: [...this.jobTypes],
    };
  }

  getDiagnostics(): PythonComputeDiagnostics {
    return { ...this.diagnostics };
  }

  async start(): Promise<PythonComputeDiagnostics> {
    if (!this.config.enabled) {
      return this.getDiagnostics();
    }
    if (this.child) {
      return this.getDiagnostics();
    }
    if (!existsSync(resolve(this.config.cwd, "pyproject.toml"))) {
      this.markDegraded(`Python compute root is missing: ${this.config.cwd}`);
      return this.getDiagnostics();
    }

    this.stopping = false;
    this.diagnostics.status = "starting";
    this.diagnostics.lastError = null;
    this.diagnostics.startedAt = new Date().toISOString();
    const child = this.spawnProcess(
      "uv",
      ["run", "python", "-m", "pyrus_compute.service"],
      {
        cwd: this.config.cwd,
        env: {
          ...process.env,
          PYRUS_PYTHON_COMPUTE_HOST: this.config.host,
          PYRUS_PYTHON_COMPUTE_PORT: String(this.config.port),
          PYRUS_PYTHON_COMPUTE_LANE: this.laneId,
          PYRUS_PYTHON_COMPUTE_ALLOWED_JOB_TYPES: this.jobTypes.join(","),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.diagnostics.pid = child.pid ?? null;
    child.stdout?.on("data", (chunk: Buffer) => {
      logger.info({ output: chunk.toString("utf8").trim() }, "Python compute stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logger.warn({ output: chunk.toString("utf8").trim() }, "Python compute stderr");
    });
    child.once("error", (error) => {
      this.child = null;
      this.markDegraded(error.message);
    });
    child.once("exit", (code, signal) => {
      this.child = null;
      this.diagnostics.pid = null;
      if (this.stopping) {
        this.diagnostics.status = "stopped";
        return;
      }
      this.markDegraded(
        `Python compute exited with code ${code ?? "null"} signal ${signal ?? "null"}.`,
      );
      this.scheduleRestart();
    });

    try {
      await this.waitForHealth();
      this.diagnostics.status = "healthy";
      logger.info(
        {
          pid: this.diagnostics.pid,
          port: this.config.port,
        },
        "Python compute service started",
      );
    } catch (error) {
      this.markDegraded(error instanceof Error ? error.message : String(error));
    }
    return this.getDiagnostics();
  }

  async submitJob(
    request: PythonComputeJobRequest,
    timeoutMs = 10_000,
  ): Promise<PythonComputeJobAccepted> {
    await this.ensureHealthy();
    return this.fetchJson<PythonComputeJobAccepted>(
      "/jobs",
      {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 1,
          input: {},
          ...request,
        }),
      },
      timeoutMs,
    );
  }

  async getJob(jobId: string, timeoutMs = 10_000): Promise<PythonComputeJobResult> {
    await this.ensureHealthy();
    return this.fetchJson<PythonComputeJobResult>(
      `/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
      timeoutMs,
    );
  }

  async cancelJob(jobId: string, timeoutMs = 10_000): Promise<PythonComputeJobResult> {
    await this.ensureHealthy();
    return this.fetchJson<PythonComputeJobResult>(
      `/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
      timeoutMs,
    );
  }

  async runJob(
    request: PythonComputeJobRequest,
    options: PythonComputeRunJobOptions = {},
  ): Promise<PythonComputeJobResult> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 100);
    const deadline = Date.now() + timeoutMs;
    const accepted = await this.submitJob(request, timeoutMs);

    while (Date.now() < deadline) {
      const remainingMs = Math.max(100, deadline - Date.now());
      const result = await this.getJob(accepted.jobId, remainingMs);
      if (
        result.status === "completed" ||
        result.status === "failed" ||
        result.status === "cancelled"
      ) {
        return result;
      }
      await this.delayFn(Math.min(pollIntervalMs, remainingMs));
    }

    await this.cancelJob(accepted.jobId, 1_000).catch(() => null);
    throw new Error(`Python compute job ${accepted.jobId} timed out after ${timeoutMs}ms.`);
  }

  stop(): void {
    this.stopping = true;
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.diagnostics.pid = null;
    this.diagnostics.status = this.config.enabled ? "stopped" : "disabled";
  }

  private async ensureHealthy(): Promise<void> {
    const diagnostics = await this.start();
    if (diagnostics.status !== "healthy") {
      throw new Error(
        `Python compute service is ${diagnostics.status}: ${diagnostics.lastError ?? "unavailable"}`,
      );
    }
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchFn(
        `http://${this.config.host}:${this.config.port}${path}`,
        {
          ...init,
          headers: {
            "content-type": "application/json",
            ...(init.headers ?? {}),
          },
          signal: controller.signal,
        },
      );
      const body = (await response.json()) as T;
      if (!response.ok) {
        throw new Error(`Python compute request failed with HTTP ${response.status}`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.config.startupTimeoutMs;
    const url = `http://${this.config.host}:${this.config.port}/health`;
    let lastError = "health probe did not run";
    while (Date.now() < deadline) {
      try {
        const response = await this.fetchFn(url, { method: "GET" });
        if (response.ok) {
          const body = (await response.json()) as { ok?: unknown };
          if (body.ok === true) {
            return;
          }
          lastError = "health response was not ok";
        } else {
          lastError = `health returned ${response.status}`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await this.delayFn(250);
    }
    throw new Error(`Python compute health check timed out: ${lastError}`);
  }

  private markDegraded(error: string): void {
    this.diagnostics.status = "degraded";
    this.diagnostics.lastError = error;
    logger.warn({ error }, "Python compute service degraded");
  }

  private scheduleRestart(): void {
    if (!this.config.enabled || this.stopping) {
      return;
    }
    this.diagnostics.restartCount += 1;
    const backoffMs = Math.min(
      30_000,
      1_000 * 2 ** Math.min(this.diagnostics.restartCount, 5),
    );
    setTimeout(() => {
      void this.start().catch((error) => {
        this.markDegraded(error instanceof Error ? error.message : String(error));
      });
    }, backoffMs).unref();
  }
}

function terminalJobStatus(status: PythonComputeJobResult["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function prefixedJobId(laneId: PythonComputeLaneId, jobId: string): string {
  return `${laneId}:${jobId}`;
}

function unprefixJobId(
  jobId: string,
): { laneId: PythonComputeLaneId; jobId: string } | null {
  const [rawLane, ...rest] = jobId.split(":");
  if (
    (rawLane === "risk" || rawLane === "research" || rawLane === "backtest") &&
    rest.length > 0
  ) {
    return { laneId: rawLane, jobId: rest.join(":") };
  }
  return null;
}

function readGlobalMaxActiveJobs(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  return readPositiveInteger(
    env["PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS"],
    DEFAULT_GLOBAL_MAX_ACTIVE_JOBS,
  );
}

export class PythonComputeRouter {
  private readonly runtimes: Record<PythonComputeLaneId, PythonComputeRuntimeLike>;
  private readonly laneDefinitions: Record<PythonComputeLaneId, PythonComputeLaneDefinition>;
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly maxActiveJobs: number;
  private readonly activeJobs = new Map<
    string,
    { laneId: PythonComputeLaneId; innerJobId: string }
  >();
  private readonly laneRejectedJobs: Record<PythonComputeLaneId, number> = {
    risk: 0,
    research: 0,
    backtest: 0,
  };
  private rejectedJobs = 0;

  constructor(
    deps: RuntimeDeps & {
      laneDefinitions?: PythonComputeLaneDefinition[];
      runtimes?: Partial<Record<PythonComputeLaneId, PythonComputeRuntimeLike>>;
    } = {},
  ) {
    const laneDefinitions = deps.laneDefinitions ?? resolvePythonComputeLaneDefinitions(deps);
    this.laneDefinitions = Object.fromEntries(
      laneDefinitions.map((definition) => [definition.id, definition]),
    ) as Record<PythonComputeLaneId, PythonComputeLaneDefinition>;
    this.runtimes = {
      risk:
        deps.runtimes?.risk ??
        new PythonComputeRuntime({
          ...deps,
          laneDefinition: this.laneDefinitions.risk,
        }),
      research:
        deps.runtimes?.research ??
        new PythonComputeRuntime({
          ...deps,
          laneDefinition: this.laneDefinitions.research,
        }),
      backtest:
        deps.runtimes?.backtest ??
        new PythonComputeRuntime({
          ...deps,
          laneDefinition: this.laneDefinitions.backtest,
        }),
    };
    this.delayFn = deps.delay ?? delay;
    this.maxActiveJobs = readGlobalMaxActiveJobs(deps.env ?? process.env);
  }

  async start(): Promise<PythonComputeRouterDiagnostics> {
    await Promise.all(Object.values(this.runtimes).map((runtime) => runtime.start()));
    return this.getDiagnostics();
  }

  stop(): void {
    Object.values(this.runtimes).forEach((runtime) => runtime.stop());
    this.activeJobs.clear();
  }

  getDiagnostics(): PythonComputeRouterDiagnostics {
    const lanes = Object.fromEntries(
      (Object.keys(this.runtimes) as PythonComputeLaneId[]).map((laneId) => {
        const diagnostics = this.runtimes[laneId].getDiagnostics();
        return [
          laneId,
          {
            ...diagnostics,
            laneId,
            label: this.laneDefinitions[laneId].label,
            jobTypes: [...this.laneDefinitions[laneId].jobTypes],
            activeRoutedJobs: Array.from(this.activeJobs.values()).filter(
              (job) => job.laneId === laneId,
            ).length,
            rejectedJobs: this.laneRejectedJobs[laneId],
          },
        ];
      }),
    ) as Record<PythonComputeLaneId, PythonComputeLaneDiagnostics>;
    const primary = lanes.risk;
    return {
      ...primary,
      lanes,
      global: {
        activeJobs: this.activeJobs.size,
        maxActiveJobs: this.maxActiveJobs,
        rejectedJobs: this.rejectedJobs,
      },
      routing: { ...JOB_TYPE_LANE },
    };
  }

  async submitJob(
    request: PythonComputeJobRequest,
    timeoutMs = 10_000,
  ): Promise<PythonComputeJobAccepted> {
    const laneId = routePythonComputeJobType(request.jobType);
    if (this.activeJobs.size >= this.maxActiveJobs) {
      this.rejectedJobs += 1;
      this.laneRejectedJobs[laneId] += 1;
      throw new Error("Python compute global capacity exhausted.");
    }
    const accepted = await this.runtimes[laneId].submitJob(request, timeoutMs);
    const routedJobId = prefixedJobId(laneId, accepted.jobId);
    this.activeJobs.set(routedJobId, { laneId, innerJobId: accepted.jobId });
    return {
      ...accepted,
      jobId: routedJobId,
    };
  }

  async getJob(jobId: string, timeoutMs = 10_000): Promise<PythonComputeJobResult> {
    const routed = this.resolveJobRoute(jobId);
    const result = await this.runtimes[routed.laneId].getJob(
      routed.innerJobId,
      timeoutMs,
    );
    const routedJobId = prefixedJobId(routed.laneId, result.jobId);
    if (terminalJobStatus(result.status)) {
      this.clearActiveJob(routedJobId);
      this.clearActiveJob(jobId);
    }
    return {
      ...result,
      jobId: routedJobId,
    };
  }

  async cancelJob(
    jobId: string,
    timeoutMs = 10_000,
  ): Promise<PythonComputeJobResult> {
    const routed = this.resolveJobRoute(jobId);
    const result = await this.runtimes[routed.laneId].cancelJob(
      routed.innerJobId,
      timeoutMs,
    );
    const routedJobId = prefixedJobId(routed.laneId, result.jobId);
    this.clearActiveJob(routedJobId);
    this.clearActiveJob(jobId);
    return {
      ...result,
      jobId: routedJobId,
    };
  }

  async runJob(
    request: PythonComputeJobRequest,
    options: PythonComputeRunJobOptions = {},
  ): Promise<PythonComputeJobResult> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 100);
    const deadline = Date.now() + timeoutMs;
    const accepted = await this.submitJob(request, timeoutMs);

    try {
      while (Date.now() < deadline) {
        const remainingMs = Math.max(100, deadline - Date.now());
        const result = await this.getJob(accepted.jobId, remainingMs);
        if (terminalJobStatus(result.status)) {
          return result;
        }
        await this.delayFn(Math.min(pollIntervalMs, remainingMs));
      }

      await this.cancelJob(accepted.jobId, 1_000).catch(() => null);
      throw new Error(`Python compute job ${accepted.jobId} timed out after ${timeoutMs}ms.`);
    } finally {
      this.clearActiveJob(accepted.jobId);
    }
  }

  private clearActiveJob(jobId: string): void {
    const routed = this.resolveJobRoute(jobId);
    const routedJobId = prefixedJobId(routed.laneId, routed.innerJobId);
    this.activeJobs.delete(routedJobId);
    this.activeJobs.delete(jobId);
  }

  private resolveJobRoute(jobId: string): {
    laneId: PythonComputeLaneId;
    innerJobId: string;
  } {
    const active = this.activeJobs.get(jobId);
    if (active) {
      return active;
    }
    const parsed = unprefixJobId(jobId);
    if (parsed) {
      return { laneId: parsed.laneId, innerJobId: parsed.jobId };
    }
    return { laneId: "risk", innerJobId: jobId };
  }
}

const pythonComputeRouter = new PythonComputeRouter();

export async function startPythonComputeRuntime(): Promise<PythonComputeRouterDiagnostics> {
  return pythonComputeRouter.start();
}

export function stopPythonComputeRuntime(): void {
  pythonComputeRouter.stop();
}

export function getPythonComputeDiagnostics(): PythonComputeRouterDiagnostics {
  return pythonComputeRouter.getDiagnostics();
}

export function submitPythonComputeJob(
  request: PythonComputeJobRequest,
  timeoutMs?: number,
): Promise<PythonComputeJobAccepted> {
  return pythonComputeRouter.submitJob(request, timeoutMs);
}

export function getPythonComputeJob(
  jobId: string,
  timeoutMs?: number,
): Promise<PythonComputeJobResult> {
  return pythonComputeRouter.getJob(jobId, timeoutMs);
}

export function cancelPythonComputeJob(
  jobId: string,
  timeoutMs?: number,
): Promise<PythonComputeJobResult> {
  return pythonComputeRouter.cancelJob(jobId, timeoutMs);
}

export function runPythonComputeJob(
  request: PythonComputeJobRequest,
  options?: PythonComputeRunJobOptions,
): Promise<PythonComputeJobResult> {
  return pythonComputeRouter.runJob(request, options);
}
