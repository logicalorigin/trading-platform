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
};

export type PythonComputeJobType =
  | "benchmark_matrix"
  | "greek_scenario_matrix"
  | "portfolio_optimization"
  | "portfolio_risk";

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
};

const DEFAULT_PORT = 18_768;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

export class PythonComputeRuntime {
  private child: ChildProcess | null = null;
  private diagnostics: PythonComputeDiagnostics;
  private stopping = false;
  private readonly config: RuntimeConfig;
  private readonly spawnProcess: typeof spawn;
  private readonly fetchFn: typeof fetch;
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(deps: RuntimeDeps = {}) {
    this.config = resolvePythonComputeConfig(deps);
    this.spawnProcess = deps.spawnProcess ?? spawn;
    this.fetchFn = deps.fetch ?? fetch;
    this.delayFn = deps.delay ?? delay;
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

const pythonComputeRuntime = new PythonComputeRuntime();

export async function startPythonComputeRuntime(): Promise<PythonComputeDiagnostics> {
  return pythonComputeRuntime.start();
}

export function stopPythonComputeRuntime(): void {
  pythonComputeRuntime.stop();
}

export function getPythonComputeDiagnostics(): PythonComputeDiagnostics {
  return pythonComputeRuntime.getDiagnostics();
}

export function submitPythonComputeJob(
  request: PythonComputeJobRequest,
  timeoutMs?: number,
): Promise<PythonComputeJobAccepted> {
  return pythonComputeRuntime.submitJob(request, timeoutMs);
}

export function getPythonComputeJob(
  jobId: string,
  timeoutMs?: number,
): Promise<PythonComputeJobResult> {
  return pythonComputeRuntime.getJob(jobId, timeoutMs);
}

export function cancelPythonComputeJob(
  jobId: string,
  timeoutMs?: number,
): Promise<PythonComputeJobResult> {
  return pythonComputeRuntime.cancelJob(jobId, timeoutMs);
}

export function runPythonComputeJob(
  request: PythonComputeJobRequest,
  options?: PythonComputeRunJobOptions,
): Promise<PythonComputeJobResult> {
  return pythonComputeRuntime.runJob(request, options);
}
