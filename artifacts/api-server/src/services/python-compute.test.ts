import assert from "node:assert/strict";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PythonComputeRouter,
  PythonComputeRuntime,
  resolvePythonComputeLaneDefinitions,
  resolvePythonComputeConfig,
  resolvePythonComputeRoot,
  routePythonComputeJobType,
  type PythonComputeJobAccepted,
  type PythonComputeJobRequest,
  type PythonComputeJobResult,
  type PythonComputeLaneId,
  type PythonComputeRuntimeLike,
} from "./python-compute";

function fakeChildProcess(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, "pid", { value: pid });
  child.stdout = null;
  child.stderr = null;
  child.kill = (() => true) as ChildProcess["kill"];
  return child;
}

test("python compute config is disabled by default", () => {
  const config = resolvePythonComputeConfig({
    env: {},
    cwd: "/workspace",
  });

  assert.equal(config.enabled, false);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 18_768);
});

test("python compute lane definitions preserve legacy risk config and declare split lanes", () => {
  const definitions = resolvePythonComputeLaneDefinitions({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_PORT: "19991",
      PYRUS_PYTHON_RESEARCH_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_RESEARCH_COMPUTE_PORT: "19992",
      PYRUS_PYTHON_BACKTEST_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_BACKTEST_COMPUTE_PORT: "19993",
    },
    cwd: "/workspace",
  });

  assert.deepEqual(
    definitions.map((definition) => definition.id),
    ["risk", "research", "backtest"],
  );
  assert.equal(definitions[0]?.config.enabled, true);
  assert.equal(definitions[0]?.config.port, 19991);
  assert.equal(definitions[1]?.config.enabled, true);
  assert.equal(definitions[1]?.config.port, 19992);
  assert.equal(definitions[2]?.config.enabled, true);
  assert.equal(definitions[2]?.config.port, 19993);
  assert.equal(routePythonComputeJobType("greek_scenario_matrix"), "risk");
  assert.equal(routePythonComputeJobType("portfolio_risk"), "risk");
  assert.equal(routePythonComputeJobType("benchmark_matrix"), "research");
  assert.equal(routePythonComputeJobType("signal_matrix"), "research");
});

test("python compute root resolves from repo root", () => {
  const repo = mkdtempSync(join(tmpdir(), "pyrus-repo-"));
  const pythonRoot = join(repo, "python", "pyrus_compute");
  mkdirSync(pythonRoot, { recursive: true });
  writeFileSync(join(pythonRoot, "pyproject.toml"), "[project]\nname = 'x'\n");

  assert.equal(resolvePythonComputeRoot(repo), pythonRoot);
  assert.equal(resolvePythonComputeConfig({ env: {}, cwd: repo }).cwd, pythonRoot);
});

test("disabled python compute runtime does not spawn", async () => {
  let spawned = false;
  const runtime = new PythonComputeRuntime({
    env: {},
    spawnProcess: (() => {
      spawned = true;
      throw new Error("should not spawn");
    }) as typeof spawn,
  });

  const diagnostics = await runtime.start();
  assert.equal(spawned, false);
  assert.equal(diagnostics.status, "disabled");
});

test("enabled python compute runtime starts and reports healthy", async () => {
  const root = mkdtempSync(join(tmpdir(), "pyrus-compute-healthy-"));
  writeFileSync(join(root, "pyproject.toml"), "[project]\nname = 'pyrus-compute'\n");
  const child = fakeChildProcess(1234);
  const calls: Array<{ command: string; args: string[] }> = [];

  const runtime = new PythonComputeRuntime({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ROOT: root,
      PYRUS_PYTHON_COMPUTE_PORT: "19999",
    },
    spawnProcess: ((command: string, args: string[]) => {
      calls.push({ command, args });
      return child;
    }) as typeof spawn,
    fetch: (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
    delay: async () => {},
  });

  const diagnostics = await runtime.start();
  assert.equal(diagnostics.status, "healthy");
  assert.equal(diagnostics.pid, 1234);
  assert.equal(calls[0]?.command, "uv");
  assert.deepEqual(calls[0]?.args, ["run", "python", "-m", "pyrus_compute.service"]);

  runtime.stop();
});

test("python compute runtime submits jobs through the internal HTTP client", async () => {
  const root = mkdtempSync(join(tmpdir(), "pyrus-compute-client-"));
  writeFileSync(join(root, "pyproject.toml"), "[project]\nname = 'pyrus-compute'\n");
  const child = fakeChildProcess(4321);
  const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const responses = [
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({ jobId: "job-1", status: "queued" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
  ];

  const runtime = new PythonComputeRuntime({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ROOT: root,
      PYRUS_PYTHON_COMPUTE_PORT: "19998",
    },
    spawnProcess: (() => child) as typeof spawn,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected fetch");
      }
      return response;
    }) as typeof fetch,
    delay: async () => {},
  });

  const accepted = await runtime.submitJob({
    jobType: "portfolio_optimization",
    input: {
      positions: [
        { symbol: "A", currentWeight: 0.5 },
        { symbol: "B", currentWeight: 0.5 },
      ],
    },
  });

  assert.deepEqual(accepted, { jobId: "job-1", status: "queued" });
  assert.equal(fetchCalls[1]?.url, "http://127.0.0.1:19998/jobs");
  assert.equal(fetchCalls[1]?.init?.method, "POST");
  assert.match(String(fetchCalls[1]?.init?.body), /portfolio_optimization/);

  runtime.stop();
});

function completedJob(
  jobId: string,
  jobType: PythonComputeJobRequest["jobType"],
): PythonComputeJobResult {
  return {
    jobId,
    jobType,
    status: "completed",
    createdAt: "2026-06-04T20:00:00.000Z",
    startedAt: "2026-06-04T20:00:00.000Z",
    completedAt: "2026-06-04T20:00:00.010Z",
    durationMs: 10,
    warnings: [],
    result: { ok: true },
    error: null,
  };
}

function fakeRuntime(input: {
  laneId: PythonComputeLaneId;
  acceptedJobId: string;
  onSubmit?: (request: PythonComputeJobRequest) => void;
}): PythonComputeRuntimeLike {
  return {
    start: async () => ({
      enabled: true,
      status: "healthy",
      cwd: `/tmp/${input.laneId}`,
      host: "127.0.0.1",
      port: 18_000,
      pid: 123,
      startedAt: "2026-06-04T20:00:00.000Z",
      lastError: null,
      restartCount: 0,
      laneId: input.laneId,
      label: input.laneId,
      jobTypes: [],
    }),
    stop: () => {},
    getDiagnostics: () => ({
      enabled: true,
      status: "healthy",
      cwd: `/tmp/${input.laneId}`,
      host: "127.0.0.1",
      port: 18_000,
      pid: 123,
      startedAt: "2026-06-04T20:00:00.000Z",
      lastError: null,
      restartCount: 0,
      laneId: input.laneId,
      label: input.laneId,
      jobTypes: [],
    }),
    submitJob: async (request): Promise<PythonComputeJobAccepted> => {
      input.onSubmit?.(request);
      return { jobId: input.acceptedJobId, status: "queued" };
    },
    getJob: async (jobId) =>
      completedJob(jobId, "greek_scenario_matrix"),
    cancelJob: async (jobId) => ({
      ...completedJob(jobId, "greek_scenario_matrix"),
      status: "cancelled",
    }),
  };
}

test("python compute router prefixes jobs and routes risk work to the risk lane", async () => {
  const submissions: Array<{ laneId: PythonComputeLaneId; jobType: string }> = [];
  const router = new PythonComputeRouter({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS: "2",
    },
    runtimes: {
      risk: fakeRuntime({
        laneId: "risk",
        acceptedJobId: "job-risk-1",
        onSubmit: (request) => submissions.push({ laneId: "risk", jobType: request.jobType }),
      }),
      research: fakeRuntime({
        laneId: "research",
        acceptedJobId: "job-research-1",
        onSubmit: (request) =>
          submissions.push({ laneId: "research", jobType: request.jobType }),
      }),
      backtest: fakeRuntime({
        laneId: "backtest",
        acceptedJobId: "job-backtest-1",
        onSubmit: (request) =>
          submissions.push({ laneId: "backtest", jobType: request.jobType }),
      }),
    },
  });

  const accepted = await router.submitJob({
    jobType: "greek_scenario_matrix",
    input: { positions: [] },
  });
  const result = await router.getJob(accepted.jobId);

  assert.equal(accepted.jobId, "risk:job-risk-1");
  assert.deepEqual(submissions, [{ laneId: "risk", jobType: "greek_scenario_matrix" }]);
  assert.equal(result.jobId, "risk:job-risk-1");
  assert.equal(router.getDiagnostics().global.activeJobs, 0);
});

test("python compute router enforces global capacity before submitting more jobs", async () => {
  const router = new PythonComputeRouter({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS: "1",
    },
    runtimes: {
      risk: {
        ...fakeRuntime({ laneId: "risk", acceptedJobId: "job-risk-1" }),
        getJob: async (jobId) => ({
          ...completedJob(jobId, "greek_scenario_matrix"),
          status: "running",
          completedAt: null,
          durationMs: null,
          result: null,
        }),
      },
      research: fakeRuntime({ laneId: "research", acceptedJobId: "job-research-1" }),
      backtest: fakeRuntime({ laneId: "backtest", acceptedJobId: "job-backtest-1" }),
    },
  });

  await router.submitJob({
    jobType: "greek_scenario_matrix",
    input: { positions: [] },
  });

  await assert.rejects(
    () =>
      router.submitJob({
        jobType: "benchmark_matrix",
        input: { rows: 100, trials: 1 },
      }),
    /global capacity exhausted/,
  );
  assert.equal(router.getDiagnostics().global.rejectedJobs, 1);
});

test("python compute router clears active jobs when run polling fails", async () => {
  const router = new PythonComputeRouter({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS: "1",
    },
    runtimes: {
      risk: {
        ...fakeRuntime({ laneId: "risk", acceptedJobId: "job-risk-poll" }),
        getJob: async () => {
          throw new Error("poll failed");
        },
      },
      research: fakeRuntime({ laneId: "research", acceptedJobId: "job-research-1" }),
      backtest: fakeRuntime({ laneId: "backtest", acceptedJobId: "job-backtest-1" }),
    },
    delay: async () => {},
  });

  await assert.rejects(
    () =>
      router.runJob(
        {
          jobType: "greek_scenario_matrix",
          input: { positions: [] },
        },
        { timeoutMs: 1_000, pollIntervalMs: 25 },
      ),
    /poll failed/,
  );
  assert.equal(router.getDiagnostics().global.activeJobs, 0);
});

test("python compute router clears active jobs when timeout cancellation fails", async () => {
  const router = new PythonComputeRouter({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS: "1",
    },
    runtimes: {
      risk: {
        ...fakeRuntime({ laneId: "risk", acceptedJobId: "job-risk-timeout" }),
        cancelJob: async () => {
          throw new Error("cancel failed");
        },
      },
      research: fakeRuntime({ laneId: "research", acceptedJobId: "job-research-1" }),
      backtest: fakeRuntime({ laneId: "backtest", acceptedJobId: "job-backtest-1" }),
    },
    delay: async () => {},
  });

  await assert.rejects(
    () =>
      router.runJob(
        {
          jobType: "greek_scenario_matrix",
          input: { positions: [] },
        },
        { timeoutMs: 0, pollIntervalMs: 25 },
      ),
    /timed out after 0ms/,
  );
  assert.equal(router.getDiagnostics().global.activeJobs, 0);
});

test("python compute runtime runs jobs until completion", async () => {
  const root = mkdtempSync(join(tmpdir(), "pyrus-compute-run-"));
  writeFileSync(join(root, "pyproject.toml"), "[project]\nname = 'pyrus-compute'\n");
  const child = fakeChildProcess(5678);
  const responses = [
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({ jobId: "job-2", status: "queued" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    new Response(
      JSON.stringify({
        jobId: "job-2",
        jobType: "greek_scenario_matrix",
        status: "running",
        createdAt: "2026-05-29T20:00:00.000Z",
        startedAt: "2026-05-29T20:00:00.000Z",
        completedAt: null,
        durationMs: null,
        warnings: [],
        result: null,
        error: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
    new Response(
      JSON.stringify({
        jobId: "job-2",
        jobType: "greek_scenario_matrix",
        status: "completed",
        createdAt: "2026-05-29T20:00:00.000Z",
        startedAt: "2026-05-29T20:00:00.000Z",
        completedAt: "2026-05-29T20:00:00.010Z",
        durationMs: 10,
        warnings: [],
        result: { scenarioCount: 1 },
        error: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ];

  const runtime = new PythonComputeRuntime({
    env: {
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ROOT: root,
      PYRUS_PYTHON_COMPUTE_PORT: "19997",
    },
    spawnProcess: (() => child) as typeof spawn,
    fetch: (async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected fetch");
      }
      return response;
    }) as typeof fetch,
    delay: async () => {},
  });

  const result = await runtime.runJob(
    { jobType: "greek_scenario_matrix", input: { positions: [] } },
    { timeoutMs: 1_000, pollIntervalMs: 25 },
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result, { scenarioCount: 1 });

  runtime.stop();
});
