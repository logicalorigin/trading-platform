import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  throw new Error("Timed out waiting for Python runner fixture");
}

function pidIsLive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

test("Python compute runner enforces the checked-in uv lock", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pyrus-python-runner-"));
  const capturePath = path.join(directory, "args");
  const uvPath = path.join(directory, "uv");
  writeFileSync(
    uvPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$PYRUS_TEST_CAPTURE"\n',
  );
  chmodSync(uvPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-python-compute.mjs", "doctor"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ""}`,
          PYRUS_TEST_CAPTURE: capturePath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(capturePath, "utf8").trim().split("\n"), [
      "run",
      "--locked",
      "--no-env-file",
      "python",
      "-m",
      "pyrus_compute.doctor",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Python compute runner rejects inherited commands and discarded arguments", () => {
  const inherited = spawnSync(
    process.execPath,
    ["scripts/run-python-compute.mjs", "__proto__"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(inherited.status, 2);
  assert.match(inherited.stderr, /Unknown Python compute command/);
  assert.doesNotMatch(inherited.stderr, /__proto__/);

  const extra = spawnSync(
    process.execPath,
    ["scripts/run-python-compute.mjs", "doctor", "--discarded"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /do not accept extra arguments/);
  assert.doesNotMatch(extra.stderr, /--discarded/);
});

test(
  "Python compute runner forwards wrapper shutdown to its child",
  { timeout: 10_000 },
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pyrus-python-runner-"));
    const childPidPath = path.join(directory, "child-pid");
    const uvPath = path.join(directory, "uv");
    writeFileSync(
      uvPath,
      `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.PYRUS_TEST_CHILD_PID, String(process.pid));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => process.exit(0));
}
setInterval(() => {}, 1000);
`,
    );
    chmodSync(uvPath, 0o755);

    let childPid = null;
    const runner = spawn(
      process.execPath,
      ["scripts/run-python-compute.mjs", "doctor"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ""}`,
          PYRUS_TEST_CHILD_PID: childPidPath,
        },
        stdio: "ignore",
      },
    );

    try {
      await waitFor(() => {
        try {
          childPid = Number(readFileSync(childPidPath, "utf8"));
          return Number.isSafeInteger(childPid) && childPid > 0;
        } catch {
          return false;
        }
      });
      process.kill(runner.pid, "SIGTERM");
      const [code, signal] = await once(runner, "exit");
      assert.equal(code, null);
      assert.equal(signal, "SIGTERM");
      await waitFor(() => !pidIsLive(childPid));
    } finally {
      if (pidIsLive(runner.pid)) process.kill(runner.pid, "SIGKILL");
      if (pidIsLive(childPid)) process.kill(childPid, "SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
