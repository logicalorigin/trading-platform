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
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    delay: async () => {},
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
