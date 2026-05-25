import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./checkDevRuntime.mjs", import.meta.url), "utf8");

test("runtime doctor browser prep is opt-in", () => {
  assert.match(source, /PYRUS_DOCTOR_PREPARE_BROWSER/);
  assert.match(source, /PYRUS_DOCTOR_PREPARE_BROWSER/);
  assert.match(source, /if \(!browserPrepRequested\) \{/);
  assert.match(source, /skipped: true/);
  assert.match(source, /optInEnv: "PYRUS_DOCTOR_PREPARE_BROWSER=1"/);
});

test("runtime doctor browser prep kills the process group on timeout", () => {
  assert.match(source, /const runKillableTextCommand = \(command, args, options = \{\}\) =>/);
  assert.match(source, /detached: true/);
  assert.match(source, /result\.error\?\.code === "ETIMEDOUT"/);
  assert.match(source, /process\.kill\(-result\.pid, signal\)/);
  assert.match(source, /killedProcessGroup/);
});

test("runtime doctor reports stale browser libgbm scans", () => {
  assert.match(source, /const readBrowserPrepScanProcesses = \(\) =>/);
  assert.match(source, /\/libgbm\\\.so\//);
  assert.match(source, /orphanedBrowserPrepScans/);
  assert.match(source, /Stale browser library scan PID/);
});
