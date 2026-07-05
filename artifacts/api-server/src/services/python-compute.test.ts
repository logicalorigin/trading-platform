import assert from "node:assert/strict";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setImmediate as waitImmediate } from "node:timers/promises";

import {
  PythonComputeRuntime,
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

const fakeSpawnedChild = (pid = 1234) =>
  Object.assign(new EventEmitter(), {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill() {
      return true;
    },
  }) as unknown as ChildProcess;

test("Python compute stop terminates the process group on non-Windows hosts", () => {
  const { child, calls } = fakeChild(1234);
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  stopPythonComputeChildProcess(child, {
    platform: "linux",
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

  stopPythonComputeChildProcess(child, {
    platform: "linux",
    kill() {
      const error = new Error("unsupported process group") as Error & { code: string };
      error.code = "EINVAL";
      throw error;
    },
  });

  assert.deepEqual(calls, [{ signal: "SIGTERM" }]);
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
    runtime.stop();
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
    runtime.stop();
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
    runtime.stop();
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
    runtime.stop();
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
