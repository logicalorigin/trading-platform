#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const scriptPath = path.resolve("scripts/run-validation-command.mjs");

function tempCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "pyrus-validation-guard-"));
  const recorderDir = path.join(dir, "recorder");
  const ledger = path.join(dir, "commands.jsonl");
  const lockFile = path.join(dir, "validation.lock");
  const supervisorLock = path.join(dir, "pyrus-dev-supervisor-8080.lock");
  return { dir, recorderDir, ledger, lockFile, supervisorLock };
}

function writeSupervisor(recorderDir, overrides = {}) {
  writeFileSync(
    path.join(recorderDir, "current.json"),
    JSON.stringify({
      updatedAt: overrides.updatedAt ?? new Date().toISOString(),
      lifecycle: { phase: overrides.phase ?? "running" },
      supervisor: { pid: 123, lockAcquired: true },
      lastEvent: { apiPid: 456, webPid: 789, lockAcquired: true },
      boot: { bootId: "btime:test" },
    }),
  );
}

function writeApi(recorderDir) {
  writeFileSync(
    path.join(recorderDir, "api-current.json"),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      pid: 456,
      memoryMb: { rss: 1024 },
      apiPressure: { level: "watch" },
      requests: { p95Ms: 1234 },
    }),
  );
}

function runGuard(paths, command, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.CI;
  delete childEnv.PYRUS_ALLOW_HOT_VALIDATION;
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--label",
      "test-command",
      "--recorder-dir",
      paths.recorderDir,
      "--ledger",
      paths.ledger,
      "--lock-file",
      paths.lockFile,
      "--supervisor-lock",
      paths.supervisorLock,
      "--",
      ...command,
    ],
    {
      encoding: "utf8",
      env: { ...childEnv, ...env },
    },
  );
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGKILL");
  await new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

function readLedger(ledger) {
  return readFileSync(ledger, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("refuses broad validation while the live PYRUS runtime is hot", () => {
  const paths = tempCase();
  mkdirSync(paths.recorderDir, { recursive: true });
  writeSupervisor(paths.recorderDir);
  writeApi(paths.recorderDir);

  const result = runGuard(paths, [process.execPath, "-e", "process.exit(0)"]);

  assert.equal(result.status, 75);
  assert.match(result.stderr, /live PYRUS\/Replit runtime is hot/);
  const events = readLedger(paths.ledger);
  assert.equal(events[0].status, "refused");
  assert.equal(events[0].reason, "live-pyrus-runtime-hot");
});

test("runs when the runtime evidence is stale", () => {
  const paths = tempCase();
  mkdirSync(paths.recorderDir, { recursive: true });
  writeSupervisor(paths.recorderDir, { updatedAt: "2020-01-01T00:00:00.000Z" });
  writeApi(paths.recorderDir);

  const result = runGuard(paths, [process.execPath, "-e", "process.exit(0)"]);

  assert.equal(result.status, 0);
  const events = readLedger(paths.ledger);
  assert.equal(events[0].status, "started");
  assert.equal(events[1].status, "finished");
  assert.equal(events[1].exit.code, 0);
});

test("explicit hot-validation override records and executes the command", () => {
  const paths = tempCase();
  mkdirSync(paths.recorderDir, { recursive: true });
  writeSupervisor(paths.recorderDir);
  writeApi(paths.recorderDir);

  const result = runGuard(
    paths,
    [process.execPath, "-e", "process.exit(0)"],
    { PYRUS_ALLOW_HOT_VALIDATION: "1" },
  );

  assert.equal(result.status, 0);
  const events = readLedger(paths.ledger);
  assert.equal(events[0].status, "started");
  assert.equal(events[1].status, "finished");
});

test("refuses when only the live supervisor lock is available", async () => {
  const paths = tempCase();
  const supervisor = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", "runDevApp.mjs"],
    { stdio: "ignore" },
  );
  try {
    await delay(50);
    writeFileSync(
      paths.supervisorLock,
      JSON.stringify({
        pid: supervisor.pid,
        startedAt: new Date().toISOString(),
        apiPort: "8080",
        webPort: "18747",
      }),
    );

    const result = runGuard(paths, [process.execPath, "-e", "process.exit(0)"]);

    assert.equal(result.status, 75);
    const events = readLedger(paths.ledger);
    assert.equal(events[0].status, "refused");
    assert.equal(events[0].reason, "live-pyrus-runtime-hot");
    assert.equal(events[0].runtime.supervisorLock.live, true);
  } finally {
    await stopChild(supervisor);
  }
});

test("removes a stale validation lock before running", () => {
  const paths = tempCase();
  mkdirSync(paths.recorderDir, { recursive: true });
  writeSupervisor(paths.recorderDir, { updatedAt: "2020-01-01T00:00:00.000Z" });
  writeFileSync(paths.lockFile, JSON.stringify({ pid: 999999999, label: "old" }));

  const result = runGuard(paths, [process.execPath, "-e", "process.exit(0)"]);

  assert.equal(result.status, 0);
  const events = readLedger(paths.ledger);
  assert.equal(events[0].status, "started");
  assert.equal(events[1].status, "finished");
});

test("refuses while another validation lock holder is live", () => {
  const paths = tempCase();
  mkdirSync(paths.recorderDir, { recursive: true });
  writeSupervisor(paths.recorderDir, { updatedAt: "2020-01-01T00:00:00.000Z" });
  writeFileSync(paths.lockFile, JSON.stringify({ pid: process.pid, label: "active" }));

  const result = runGuard(paths, [process.execPath, "-e", "process.exit(0)"]);

  assert.equal(result.status, 75);
  assert.match(result.stderr, /validation lock is held/);
  const events = readLedger(paths.ledger);
  assert.equal(events[0].status, "refused");
  assert.equal(events[0].reason, "validation-lock-held");
});
