import assert from "node:assert/strict";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setImmediate as waitImmediate } from "node:timers/promises";

import {
  PythonComputeRouter,
  PythonComputeRuntime,
  type PythonComputeLaneDefinition,
  type PythonComputeRuntimeLike,
  readPythonComputeProcessIdentity,
  stopPythonComputeChildProcess,
} from "./python-compute";

const fakeChild = (pid = 1234) => {
  const calls: Array<{ signal: NodeJS.Signals }> = [];
  const child = {
    pid,
    kill(signal: NodeJS.Signals) {
      calls.push({ signal });
      return true;
    },
  } as unknown as ChildProcess;

  return { child, calls };
};

const fakeSpawnedChild = (pid = 1234) => {
  const child = Object.assign(new EventEmitter(), {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill(signal: NodeJS.Signals = "SIGTERM") {
      queueMicrotask(() => child.emit("exit", null, signal));
      return true;
    },
  });
  return child as unknown as ChildProcess;
};

test("Python compute process identity parses commands containing parentheses", () => {
  const fields = Array.from({ length: 20 }, () => "0");
  fields[19] = "987";

  assert.deepEqual(
    readPythonComputeProcessIdentity(1234, {
      readFile: () => `1234 (python ) worker) ${fields.join(" ")}`,
    }),
    { pid: 1234, startTimeTicks: "987" },
  );
});

test("Python compute stop terminates the process group on non-Windows hosts", () => {
  const { child, calls } = fakeChild(1234);
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const identity = { pid: 1234, startTimeTicks: "1" };

  stopPythonComputeChildProcess(child, {
    expectedIdentity: identity,
    platform: "linux",
    readIdentity: () => identity,
    kill(pid, signal) {
      killCalls.push({ pid, signal: signal as NodeJS.Signals });
      return true;
    },
  });

  assert.deepEqual(killCalls, [{ pid: -1234, signal: "SIGTERM" }]);
  assert.deepEqual(calls, []);
});

test("Python compute stop falls back to direct child termination when group kill fails", () => {
  const { child, calls } = fakeChild(1234);
  const identity = { pid: 1234, startTimeTicks: "1" };

  stopPythonComputeChildProcess(child, {
    expectedIdentity: identity,
    platform: "linux",
    readIdentity: () => identity,
    kill() {
      const error = new Error("unsupported process group") as Error & { code: string };
      error.code = "EINVAL";
      throw error;
    },
  });

  assert.deepEqual(calls, [{ signal: "SIGTERM" }]);
});

test("Python compute stop refuses a reused process-group leader", () => {
  const { child, calls } = fakeChild(1234);
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  stopPythonComputeChildProcess(child, {
    expectedIdentity: { pid: 1234, startTimeTicks: "1" },
    platform: "linux",
    readIdentity: () => ({ pid: 1234, startTimeTicks: "2" }),
    kill(pid, signal) {
      killCalls.push({ pid, signal: signal as NodeJS.Signals });
      return true;
    },
  });

  assert.deepEqual(killCalls, []);
  assert.deepEqual(calls, []);
});

test("Python compute stop drains descendants after the group leader exits", () => {
  const { child, calls } = fakeChild(1234);
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  stopPythonComputeChildProcess(child, {
    allowMissingLeader: true,
    expectedIdentity: { pid: 1234, startTimeTicks: "1" },
    platform: "linux",
    readIdentity: () => null,
    signal: "SIGKILL",
    kill(pid, signal) {
      killCalls.push({ pid, signal: signal as NodeJS.Signals });
      return true;
    },
  });

  assert.deepEqual(killCalls, [{ pid: -1234, signal: "SIGKILL" }]);
  assert.deepEqual(calls, []);
});

test("Python compute stop does not drain a missing leader with another child's identity", () => {
  const { child, calls } = fakeChild(1234);
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  stopPythonComputeChildProcess(child, {
    allowMissingLeader: true,
    expectedIdentity: { pid: 9999, startTimeTicks: "1" },
    platform: "linux",
    readIdentity: () => null,
    signal: "SIGKILL",
    kill(pid, signal) {
      killCalls.push({ pid, signal: signal as NodeJS.Signals });
      return true;
    },
  });

  assert.deepEqual(killCalls, []);
  assert.deepEqual(calls, []);
});

test("Python compute runtime enforces the checked-in uv lock", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), '[project]\nname = "test"\n');
  let spawned = false;
  let spawnedCommand: string | null = null;
  let spawnedArgs: readonly string[] = [];
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 1,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: ((command: string, args: readonly string[]) => {
      spawned = true;
      spawnedCommand = command;
      spawnedArgs = args;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async () => {
      if (!spawned) {
        throw new Error("not started");
      }
      return new Response(
        JSON.stringify({ ok: true, service: "pyrus-compute", lane: "risk" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const diagnostics = await runtime.start();
    assert.equal(diagnostics.status, "healthy");
    assert.equal(spawnedCommand, "uv");
    assert.deepEqual(spawnedArgs, [
      "run",
      "--locked",
      "--no-env-file",
      "python",
      "-m",
      "pyrus_compute.service",
    ]);
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute runtime refuses unsupported host platforms before spawn", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), '[project]\nname = "test"\n');
  let spawnCalls = 0;
  const runtime = new PythonComputeRuntime({
    platform: "darwin",
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 1,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => {
      spawnCalls += 1;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async () => {
      throw new Error("not started");
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const diagnostics = await runtime.start();
    assert.equal(spawnCalls, 0);
    assert.equal(diagnostics.status, "degraded");
    assert.match(diagnostics.lastError ?? "", /requires Linux/i);
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute runtime launches with its configured environment", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), '[project]\nname = "test"\n');
  let spawned = false;
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  const runtime = new PythonComputeRuntime({
    env: { PYRUS_TEST_CONFIG: "present" },
    laneDefinition: {
      id: "research",
      label: "Research compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.2",
        port: 18_770,
        startupTimeoutMs: 1,
      },
      jobTypes: ["benchmark_matrix", "signal_matrix"],
    },
    spawnProcess: ((_command: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      spawned = true;
      spawnedEnv = options.env;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async () => {
      if (!spawned) {
        throw new Error("not started");
      }
      return new Response(
        JSON.stringify({ ok: true, service: "pyrus-compute", lane: "research" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const diagnostics = await runtime.start();
    assert.equal(diagnostics.status, "healthy");
    assert.equal(spawnedEnv?.PYRUS_TEST_CONFIG, "present");
    assert.equal(spawnedEnv?.HOME, undefined);
    assert.equal(spawnedEnv?.PYRUS_PYTHON_COMPUTE_HOST, "127.0.0.2");
    assert.equal(spawnedEnv?.PYRUS_PYTHON_COMPUTE_PORT, "18770");
    assert.equal(spawnedEnv?.PYRUS_PYTHON_COMPUTE_LANE, "research");
    assert.equal(
      spawnedEnv?.PYRUS_PYTHON_COMPUTE_ALLOWED_JOB_TYPES,
      "benchmark_matrix,signal_matrix",
    );
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute stop prevents a pending start from spawning", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), '[project]\nname = "test"\n');
  let enterProbe = () => {};
  let releaseProbe = () => {};
  const probeEntered = new Promise<void>((resolve) => {
    enterProbe = () => resolve();
  });
  const probeRelease = new Promise<void>((resolve) => {
    releaseProbe = () => resolve();
  });
  let spawnCalls = 0;
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 1,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => {
      spawnCalls += 1;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async () => {
      enterProbe();
      await probeRelease;
      throw new Error("not running");
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const start = runtime.start();
    await probeEntered;
    await runtime.stop();
    releaseProbe();
    const diagnostics = await start;

    assert.equal(spawnCalls, 0);
    assert.equal(diagnostics.status, "stopped");
    assert.equal(diagnostics.pid, null);
  } finally {
    await runtime.stop();
    releaseProbe();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute stop waits and escalates a resistant child group", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), '[project]\nname = "test"\n');
  const child = fakeSpawnedChild(4321);
  const identity = { pid: 4321, startTimeTicks: "1" };
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  let spawned = false;
  const runtime = new PythonComputeRuntime({
    shutdownGraceMs: 10,
    readProcessIdentity: () => identity,
    killProcess(pid, signal) {
      const normalizedSignal = signal as NodeJS.Signals;
      killCalls.push({ pid, signal: normalizedSignal });
      if (normalizedSignal === "SIGKILL") {
        queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
      }
      return true;
    },
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 1,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => {
      spawned = true;
      return child;
    }) as typeof spawn,
    fetch: (async () => {
      if (!spawned) throw new Error("not started");
      return new Response(
        JSON.stringify({ ok: true, service: "pyrus-compute", lane: "risk" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const started = await runtime.start();
    assert.equal(started.status, "healthy");

    await runtime.stop();

    assert.deepEqual(killCalls, [
      { pid: -4321, signal: "SIGTERM" },
      { pid: -4321, signal: "SIGKILL" },
    ]);
    assert.equal(runtime.getDiagnostics().status, "stopped");
    assert.equal(runtime.getDiagnostics().pid, null);
  } finally {
    child.emit("exit", null, "SIGKILL");
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute diagnostics re-probes a degraded live child", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname = \"test\"\n");
  let allowRecovery = false;
  let fetchCalls = 0;
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 1,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => fakeSpawnedChild()) as typeof spawn,
    fetch: (async () => {
      fetchCalls += 1;
      if (!allowRecovery) {
        throw new Error("not ready");
      }
      return new Response(JSON.stringify({ ok: true, service: "pyrus-compute", lane: "risk" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const initial = await runtime.start();
    assert.equal(initial.status, "degraded");

    await waitImmediate();
    allowRecovery = true;
    runtime.getDiagnostics();
    await waitImmediate();

    const recovered = runtime.getDiagnostics();
    assert.equal(recovered.status, "healthy");
    assert.equal(recovered.lastError, null);
    assert.ok(fetchCalls >= 2);
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute concurrent jobs coalesce into a single spawn", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname = \"test\"\n");
  let spawnCalls = 0;
  let healthy = false;
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 5_000,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => {
      spawnCalls += 1;
      healthy = true;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        if (!healthy) {
          throw new Error("not ready");
        }
        return new Response(
          JSON.stringify({ ok: true, service: "pyrus-compute", lane: "risk" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/jobs") && init?.method === "POST") {
        return new Response(JSON.stringify({ jobId: "job-1", status: "queued" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ jobId: "job-1", status: "completed", output: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
    // Short poll delays resolve immediately; the 2500ms caller-budget timer
    // must stay pending so the healthy start wins the ensureHealthy race.
    delay: (ms: number) => (ms >= 2_500 ? new Promise<void>(() => {}) : Promise.resolve()),
    probePortOpen: async () => false,
  });

  try {
    const results = await Promise.all([
      runtime.runJob({ jobType: "portfolio_risk", input: {} }, { timeoutMs: 2_500 }),
      runtime.runJob({ jobType: "portfolio_risk", input: {} }, { timeoutMs: 2_500 }),
      runtime.runJob({ jobType: "portfolio_risk", input: {} }, { timeoutMs: 2_500 }),
    ]);

    assert.equal(spawnCalls, 1);
    for (const result of results) {
      assert.equal(result.status, "completed");
    }
    assert.equal(runtime.getDiagnostics().status, "healthy");
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute request-path startup wait is bounded by the caller budget", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname = \"test\"\n");
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        // Far larger than the caller budget: the old behavior blocked the
        // request on this full window.
        startupTimeoutMs: 60_000,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => fakeSpawnedChild()) as typeof spawn,
    fetch: (async () => {
      throw new Error("never healthy");
    }) as typeof fetch,
    // The 2500ms budget delay resolves immediately; waitForHealth's 250ms
    // poll delays never resolve, so the coalesced start stays pending.
    delay: (ms: number) => (ms >= 2_500 ? Promise.resolve() : new Promise<void>(() => {})),
    probePortOpen: async () => false,
  });

  try {
    const startedAt = Date.now();
    await assert.rejects(
      runtime.submitJob({ jobType: "portfolio_risk", input: {} }, 2_500),
      /not healthy within 2500ms/,
    );
    assert.ok(Date.now() - startedAt < 5_000);
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute startup wait fails fast when the child exits", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pyrus-python-compute-"));
  writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname = \"test\"\n");
  const child = fakeSpawnedChild();
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd,
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 60_000,
      },
      jobTypes: ["portfolio_risk"],
    },
    spawnProcess: (() => child) as typeof spawn,
    fetch: (async () => {
      // Simulate a fast-crashing spawn: the first startup probe fails and the
      // child dies before the next poll.
      queueMicrotask(() => child.emit("exit", 1, null));
      throw new Error("connection refused");
    }) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => false,
  });

  try {
    const startedAt = Date.now();
    const diagnostics = await runtime.start();
    assert.equal(diagnostics.status, "degraded");
    assert.match(diagnostics.lastError ?? "", /exited during startup/);
    assert.ok(Date.now() - startedAt < 5_000);
  } finally {
    await runtime.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Python compute runtime reuses a compatible listener before spawning", async () => {
  let spawned = false;
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "research",
      label: "Research/chart compute",
      config: {
        enabled: true,
        cwd: "/missing-but-unused",
        host: "127.0.0.1",
        port: 18_770,
        startupTimeoutMs: 1,
      },
      jobTypes: ["benchmark_matrix", "signal_matrix"],
    },
    spawnProcess: (() => {
      spawned = true;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async () =>
      new Response(
        JSON.stringify({ ok: true, service: "pyrus-compute", lane: "research" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => true,
  });

  const diagnostics = await runtime.start();

  assert.equal(diagnostics.status, "healthy");
  assert.equal(diagnostics.pid, null);
  assert.equal(diagnostics.reusedExisting, true);
  assert.equal(spawned, false);
});

test("Python compute runtime does not spawn into an incompatible occupied port", async () => {
  let spawned = false;
  const runtime = new PythonComputeRuntime({
    laneDefinition: {
      id: "research",
      label: "Research/chart compute",
      config: {
        enabled: true,
        cwd: "/missing-but-unused",
        host: "127.0.0.1",
        port: 18_770,
        startupTimeoutMs: 1,
      },
      jobTypes: ["benchmark_matrix", "signal_matrix"],
    },
    spawnProcess: (() => {
      spawned = true;
      return fakeSpawnedChild();
    }) as typeof spawn,
    fetch: (async () =>
      new Response(
        JSON.stringify({ ok: true, service: "pyrus-compute", lane: "risk" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch,
    delay: async () => {},
    probePortOpen: async () => true,
  });

  const diagnostics = await runtime.start();

  assert.equal(diagnostics.status, "degraded");
  assert.match(diagnostics.lastError ?? "", /port 18770 is already in use/i);
  assert.equal(spawned, false);
});

test("Python compute reserves global capacity before an asynchronous submission completes", async () => {
  let releaseFirst = () => {};
  let firstEntered = () => {};
  const firstSubmissionEntered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  const firstSubmissionRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let submitCalls = 0;
  const runtime: PythonComputeRuntimeLike = {
    async start() {
      return this.getDiagnostics();
    },
    async stop() {},
    getDiagnostics() {
      return {
        enabled: true,
        status: "healthy",
        cwd: "/tmp",
        host: "127.0.0.1",
        port: 18_770,
        pid: null,
        startedAt: null,
        lastError: null,
        restartCount: 0,
        reusedExisting: true,
      };
    },
    async submitJob() {
      submitCalls += 1;
      if (submitCalls === 1) {
        firstEntered();
        await firstSubmissionRelease;
      }
      return { jobId: `job-${submitCalls}`, status: "queued" };
    },
    async getJob(jobId) {
      return {
        jobId,
        jobType: "signal_matrix",
        status: "completed",
        createdAt: new Date(0).toISOString(),
        startedAt: null,
        completedAt: new Date(0).toISOString(),
        durationMs: 0,
        warnings: [],
        result: {},
        error: null,
      };
    },
    async cancelJob(jobId) {
      return {
        jobId,
        jobType: "signal_matrix",
        status: "cancelled",
        createdAt: new Date(0).toISOString(),
        startedAt: null,
        completedAt: new Date(0).toISOString(),
        durationMs: 0,
        warnings: [],
        result: null,
        error: null,
      };
    },
  };
  const laneDefinitions: PythonComputeLaneDefinition[] = [
    {
      id: "risk",
      label: "Risk compute",
      config: {
        enabled: true,
        cwd: "/tmp",
        host: "127.0.0.1",
        port: 18_768,
        startupTimeoutMs: 1_000,
      },
      jobTypes: ["portfolio_risk"],
    },
    {
      id: "research",
      label: "Research compute",
      config: {
        enabled: true,
        cwd: "/tmp",
        host: "127.0.0.1",
        port: 18_770,
        startupTimeoutMs: 1_000,
      },
      jobTypes: ["signal_matrix"],
    },
    {
      id: "backtest",
      label: "Backtest compute",
      config: {
        enabled: false,
        cwd: "/tmp",
        host: "127.0.0.1",
        port: 18_771,
        startupTimeoutMs: 1_000,
      },
      jobTypes: [],
    },
  ];
  const router = new PythonComputeRouter({
    env: { PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS: "1" },
    laneDefinitions,
    runtimes: {
      risk: runtime,
      research: runtime,
      backtest: runtime,
    },
  });
  const first = router.submitJob({
    jobType: "signal_matrix",
    input: {},
  });
  await firstSubmissionEntered;

  try {
    await assert.rejects(
      router.submitJob({ jobType: "signal_matrix", input: {} }),
      /global capacity exhausted/i,
    );
    assert.equal(submitCalls, 1);
  } finally {
    releaseFirst();
    await first;
  }
});
