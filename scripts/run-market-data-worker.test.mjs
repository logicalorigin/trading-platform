import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveMarketDataWorkerCommand,
  runMarketDataWorker,
} from "./run-market-data-worker.mjs";
import {
  createProcessGroupShutdownController,
  readProcessGroupIdentity,
  waitForProcessGroupChild,
} from "./process-group-child.mjs";

const scriptPath = fileURLToPath(
  new URL("./run-market-data-worker.mjs", import.meta.url),
);

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function waitForFile(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`file did not appear: ${file}`);
}

async function waitForPidGone(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`pid ${pid} survived market-data runner cleanup`);
}

test("market-data runner is safe to import for focused tests", async () => {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(scriptPath)})`,
    ],
    { stdio: "pipe" },
  );
  const outcome = await waitForExit(child);
  assert.deepEqual(outcome, { code: 0, signal: null });
});

test("market-data command selection is strict and preserves cargo arguments", () => {
  assert.deepEqual(
    resolveMarketDataWorkerCommand(["build", "--release"], {
      hasCommand: (command) => command === "cargo",
    }),
    { command: "cargo", commandArgs: ["build", "--release"] },
  );
  const fallback = resolveMarketDataWorkerCommand(["run", "a'b"], {
    hasCommand: (command) => command === "nix-shell",
  });
  assert.equal(fallback.command, "nix-shell");
  assert.equal(fallback.commandArgs.at(-1), `'cargo' 'run' 'a'\\''b'`);
  assert.throws(
    () => resolveMarketDataWorkerCommand([], { hasCommand: () => true }),
    /usage/i,
  );
  assert.throws(
    () =>
      resolveMarketDataWorkerCommand(["build"], { hasCommand: () => false }),
    /neither cargo nor nix-shell/i,
  );
});

test("spawn failure removes every wrapper signal listener", async () => {
  const before = new Map(
    ["SIGHUP", "SIGINT", "SIGTERM"].map((signal) => [
      signal,
      process.listenerCount(signal),
    ]),
  );
  const messages = [];
  const outcome = await runMarketDataWorker(["build"], {
    error: (message) => messages.push(message),
    hasCommand: (command) => command === "cargo",
    shutdownGraceMs: 100,
    spawnChild() {
      const error = new Error("injected spawn failure");
      error.code = "EACCES";
      throw error;
    },
  });
  assert.equal(outcome.code, 127);
  assert.equal(outcome.errorCode, "EACCES");
  assert.match(messages.join("\n"), /EACCES/);
  for (const [signal, count] of before) {
    assert.equal(process.listenerCount(signal), count);
  }
});

test("process-group identity depends only on PID and kernel start time", () => {
  const fields = Array(20).fill("0");
  fields[0] = "S";
  fields[1] = "1";
  fields[19] = "987";
  const reads = [];
  const identity = readProcessGroupIdentity(101, {
    readFile(file) {
      reads.push(file);
      if (file === "/proc/101/stat") {
        return `101 (non-dumpable child) ${fields.join(" ")}`;
      }
      throw new Error(`unexpected read: ${file}`);
    },
  });

  assert.deepEqual(identity, {
    pid: 101,
    startTimeTicks: "987",
  });
  assert.deepEqual(reads, ["/proc/101/stat"]);
});

test("process-group shutdown rejects unsupported platforms before use", () => {
  assert.throws(
    () =>
      createProcessGroupShutdownController({
        graceMs: 5_000,
        platform: "darwin",
      }),
    /requires Linux/i,
  );
});

test("shutdown identity tolerates mutable process metadata", () => {
  const signals = new EventEmitter();
  const sent = [];
  let reads = 0;
  const shutdown = createProcessGroupShutdownController({
    graceMs: 5_000,
    signalSource: signals,
    readIdentity: () => ({
      pid: 101,
      startTimeTicks: "1",
      cgroup: reads++ === 0 ? "initial" : "moved",
    }),
    kill: (pid, signal) => sent.push({ pid, signal }),
    platform: "linux",
  });

  assert.equal(shutdown.attach({ pid: 101 }), true);
  signals.emit("SIGTERM");
  assert.deepEqual(sent, [{ pid: -101, signal: "SIGTERM" }]);
  shutdown.complete(shutdown.finish(0, null, null));
});

test("a repeated startup signal escalates as soon as the child attaches", () => {
  const signals = new EventEmitter();
  const sent = [];
  const identity = { pid: 101, startTimeTicks: "1", cgroup: "test" };
  const shutdown = createProcessGroupShutdownController({
    graceMs: 5_000,
    signalSource: signals,
    readIdentity: () => identity,
    kill: (pid, signal) => sent.push({ pid, signal }),
    platform: "linux",
  });

  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  shutdown.attach({ pid: identity.pid });

  assert.deepEqual(sent, [
    { pid: -identity.pid, signal: "SIGTERM" },
    { pid: -identity.pid, signal: "SIGKILL" },
  ]);
  const outcome = shutdown.complete(shutdown.finish(null, "SIGKILL", null));
  assert.equal(outcome.signal, "SIGTERM");
  assert.equal(outcome.escalated, true);
});

test("a queued child exit wins over a transient process identity miss", async () => {
  const child = new EventEmitter();
  let killed = false;
  child.pid = 101;
  child.kill = () => {
    killed = true;
  };
  const shutdown = createProcessGroupShutdownController({
    graceMs: 5_000,
    signalSource: new EventEmitter(),
    readIdentity: () => null,
    platform: "linux",
  });

  const outcomePromise = waitForProcessGroupChild(child, shutdown);
  child.emit("exit", 0, null);
  const outcome = shutdown.complete(await outcomePromise);

  assert.equal(outcome.code, 0);
  assert.equal(outcome.errorCode, null);
  assert.equal(killed, false);
});

test("a transient identity miss is retried before the child is rejected", async () => {
  const child = new EventEmitter();
  let killed = false;
  let reads = 0;
  child.pid = 101;
  child.kill = () => {
    killed = true;
  };
  const shutdown = createProcessGroupShutdownController({
    graceMs: 5_000,
    signalSource: new EventEmitter(),
    readIdentity: () =>
      reads++ === 0 ? null : { pid: 101, startTimeTicks: "1", cgroup: "test" },
    platform: "linux",
  });

  const outcomePromise = waitForProcessGroupChild(child, shutdown);
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 23, null);
  const outcome = shutdown.complete(await outcomePromise);

  assert.equal(reads, 2);
  assert.equal(killed, false);
  assert.equal(outcome.code, 23);
  assert.equal(outcome.errorCode, null);
});

test("a child SIGPIPE is reported as a nonzero numeric exit", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "market-data-sigpipe-"));
  const cargoPath = path.join(root, "cargo");
  try {
    writeFileSync(
      cargoPath,
      ["#!/bin/sh", "trap - PIPE", 'kill -PIPE "$$"', "exit 99", ""].join("\n"),
    );
    chmodSync(cargoPath, 0o755);
    const runner = spawn(process.execPath, [scriptPath, "run"], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
      },
      stdio: "ignore",
    });

    assert.deepEqual(await waitForExit(runner), {
      code: 128 + osConstants.signals.SIGPIPE,
      signal: null,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nonzero cargo exit is preserved", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "market-data-exit-"));
  const cargoPath = path.join(root, "cargo");
  try {
    writeFileSync(cargoPath, ["#!/bin/sh", "exit 23", ""].join("\n"));
    chmodSync(cargoPath, 0o755);
    const runner = spawn(process.execPath, [scriptPath, "build"], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
      },
      stdio: "ignore",
    });

    assert.deepEqual(await waitForExit(runner), {
      code: 23,
      signal: null,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a repeated wrapper signal immediately removes the detached worker group", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "market-data-runner-"));
  const cargoPath = path.join(root, "cargo");
  const readyFile = path.join(root, "ready.json");
  let runner = null;
  let leaderPid = null;
  let descendantPid = null;
  try {
    writeFileSync(
      cargoPath,
      [
        "#!/usr/bin/env node",
        'const { spawn } = require("node:child_process");',
        'const { writeFileSync } = require("node:fs");',
        'const child = spawn(process.execPath, ["-e", "process.on(\'SIGTERM\',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });',
        'process.on("SIGTERM", () => {});',
        "writeFileSync(process.env.READY_FILE, JSON.stringify({ leaderPid: process.pid, descendantPid: child.pid }));",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
    );
    chmodSync(cargoPath, 0o755);
    runner = spawn(process.execPath, [scriptPath, "run"], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        READY_FILE: readyFile,
      },
      stdio: "ignore",
    });
    await waitForFile(readyFile);
    ({ leaderPid, descendantPid } = JSON.parse(
      readFileSync(readyFile, "utf8"),
    ));
    process.kill(runner.pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 25));
    process.kill(runner.pid, "SIGTERM");
    const outcome = await withTimeout(
      waitForExit(runner),
      2_000,
      "repeated signal did not stop the market-data wrapper",
    );
    assert.equal(outcome.signal, "SIGTERM");
    await waitForPidGone(leaderPid);
    await waitForPidGone(descendantPid);
  } finally {
    if (runner?.pid) {
      try {
        process.kill(runner.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    if (leaderPid) {
      try {
        process.kill(-leaderPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
