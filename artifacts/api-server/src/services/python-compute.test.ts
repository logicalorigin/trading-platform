import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import test from "node:test";

import { stopPythonComputeChildProcess } from "./python-compute";

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
