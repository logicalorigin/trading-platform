import assert from "node:assert/strict";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PythonComputeRuntime,
  resolvePythonComputeConfig,
  resolvePythonComputeRoot,
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
