import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_VALIDATION_LEDGER_BYTES,
  createValidationLock,
  parseValidationArgs,
  removeValidationLock,
  runValidationCommand,
  writeValidationLedger,
} from "./run-validation-command.mjs";

const scriptPath = fileURLToPath(
  new URL("./run-validation-command.mjs", import.meta.url),
);

function mode(file) {
  return lstatSync(file).mode & 0o777;
}

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

function waitForOutput(stream, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`output did not match ${pattern}`)),
      timeoutMs,
    );
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      const match = output.match(pattern);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match);
    });
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
  throw new Error(`pid ${pid} survived validation cleanup`);
}

test("validation command parser rejects ambiguous or unsafe options", () => {
  const parsed = parseValidationArgs([
    "--label",
    "typecheck:libs",
    "--",
    "tsc",
    "--build",
  ]);
  assert.deepEqual(parsed.command, ["tsc", "--build"]);
  assert.equal(parsed.label, "typecheck:libs");
  assert.match(parsed.ledgerPath, /commands\.jsonl$/);
  assert.match(parsed.lockFile, /validation\.lock$/);
  assert.throws(
    () =>
      parseValidationArgs([
        "--label",
        "first",
        "--label",
        "second",
        "--",
        "true",
      ]),
    /duplicate/i,
  );
  assert.throws(
    () => parseValidationArgs(["--ledger", "--", "true"]),
    /value/i,
  );
  assert.throws(
    () => parseValidationArgs(["--unknown", "value", "--", "true"]),
    /unknown/i,
  );
  assert.throws(
    () => parseValidationArgs(["--label", "unsafe\nlabel", "--", "true"]),
    /label/i,
  );
  const sharedPath = path.join(tmpdir(), "shared-validation-state");
  assert.throws(
    () =>
      parseValidationArgs([
        "--ledger",
        sharedPath,
        "--lock-file",
        sharedPath,
        "--",
        "true",
      ]),
    /different paths/i,
  );
});

test("validation lock cleanup cannot delete a replacement owner", () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-lock-"));
  const lockFile = path.join(root, "validation.lock");
  try {
    const acquired = createValidationLock(lockFile, "test");
    assert.equal(acquired.acquired, true);
    const body = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.equal(body.lockId, acquired.lockId);
    assert.equal(typeof body.startTimeTicks, "string");
    assert.equal("command" in body, false);
    assert.equal(mode(lockFile), 0o600);
    assert.deepEqual(readdirSync(root), ["validation.lock"]);

    writeFileSync(
      lockFile,
      JSON.stringify({
        ...body,
        lockId: "replacement-owner",
      }),
    );
    assert.equal(removeValidationLock(lockFile, acquired.lockId), false);
    assert.equal(existsSync(lockFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lock publication verification preserves a replacement path", () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-lock-publish-"));
  const lockFile = path.join(root, "validation.lock");
  const replacement = JSON.stringify({
    schemaVersion: 2,
    lockId: "replacement-owner",
    pid: process.pid,
    startTimeTicks: "replacement-start",
    label: "replacement",
  });
  try {
    assert.throws(
      () =>
        createValidationLock(lockFile, "test", {
          afterPublish(publishedPath) {
            rmSync(publishedPath);
            writeFileSync(publishedPath, replacement);
          },
        }),
      /identity verification/i,
    );
    assert.equal(readFileSync(lockFile, "utf8"), replacement);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct callers cannot alias ledger and lock paths", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-paths-"));
  const sharedPath = path.join(root, "shared");
  try {
    await assert.rejects(
      runValidationCommand({
        command: [process.execPath, "-e", "process.exit(0)"],
        label: "same-path",
        ledgerPath: sharedPath,
        lockFile: sharedPath,
      }),
      /different paths/i,
    );
    await assert.rejects(
      runValidationCommand({
        command: [process.execPath, "-e", "process.exit(0)"],
        label: "unsafe\nlabel",
        ledgerPath: path.join(root, "ledger"),
        lockFile: path.join(root, "lock"),
      }),
      /label/i,
    );
    await assert.rejects(
      runValidationCommand({
        command: [process.execPath, "unsafe\0argument"],
        label: "unsafe-command",
        ledgerPath: path.join(root, "ledger"),
        lockFile: path.join(root, "lock"),
      }),
      /command/i,
    );
    assert.equal(existsSync(sharedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("physical parent aliases cannot merge ledger and lock", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-path-alias-"));
  const realParent = path.join(root, "real");
  const aliasParent = path.join(root, "alias");
  try {
    mkdirSync(realParent);
    symlinkSync(realParent, aliasParent, "dir");
    const physicalState = path.join(realParent, "state");
    await assert.rejects(
      runValidationCommand({
        command: [process.execPath, "-e", "process.exit(0)"],
        label: "alias-test",
        ledgerPath: physicalState,
        lockFile: path.join(aliasParent, "state"),
      }),
      /physical paths/i,
    );
    assert.equal(existsSync(physicalState), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation lock refuses an unproven malformed owner", () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-lock-"));
  const lockFile = path.join(root, "validation.lock");
  try {
    writeFileSync(lockFile, "");
    const refused = createValidationLock(lockFile, "test");
    assert.equal(refused.acquired, false);
    assert.equal(existsSync(lockFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation lock preserves a different-host owner", () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-lock-host-"));
  const lockFile = path.join(root, "validation.lock");
  try {
    writeFileSync(
      lockFile,
      JSON.stringify({
        schemaVersion: 2,
        lockId: "different-host",
        pid: 999_999,
        startTimeTicks: "1",
        label: "remote",
        host: "not-this-host",
      }),
    );
    const refused = createValidationLock(lockFile, "test");
    assert.equal(refused.acquired, false);
    assert.equal(
      JSON.parse(readFileSync(lockFile, "utf8")).lockId,
      "different-host",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation lock binds a live PID to its process start time", () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-lock-"));
  const lockFile = path.join(root, "validation.lock");
  try {
    const first = createValidationLock(lockFile, "first");
    assert.equal(first.acquired, true);
    const refused = createValidationLock(lockFile, "second");
    assert.equal(refused.acquired, false);
    assert.equal(
      JSON.parse(readFileSync(lockFile, "utf8")).lockId,
      first.lockId,
    );
    assert.equal(removeValidationLock(lockFile, first.lockId), true);

    writeFileSync(
      lockFile,
      JSON.stringify({
        schemaVersion: 2,
        lockId: "reused-pid",
        pid: process.pid,
        startTimeTicks: "not-this-process",
        label: "stale",
        host: hostname(),
      }),
    );
    const replacement = createValidationLock(lockFile, "replacement");
    assert.equal(replacement.acquired, true);
    assert.equal(replacement.staleRemoved, true);
    assert.equal(removeValidationLock(lockFile, replacement.lockId), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("queued startup signal survives a lock-held refusal", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-lock-signal-"));
  const lockFile = path.join(root, "validation.lock");
  const ledgerPath = path.join(root, "commands.jsonl");
  try {
    const owner = createValidationLock(lockFile, "owner");
    const outcome = await runValidationCommand(
      {
        command: [process.execPath, "-e", "process.exit(0)"],
        label: "refused",
        ledgerPath,
        lockFile,
      },
      {
        beforeLock: () => process.emit("SIGTERM"),
        error: () => {},
      },
    );
    assert.equal(outcome.signal, "SIGTERM");
    assert.equal(outcome.reason, "validation-lock-held");
    assert.equal(
      JSON.parse(readFileSync(lockFile, "utf8")).lockId,
      owner.lockId,
    );
    assert.equal(removeValidationLock(lockFile, owner.lockId), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation ledger is bounded private and rejects symlinks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-ledger-"));
  const ledger = path.join(root, "commands.jsonl");
  const external = path.join(root, "external");
  try {
    writeFileSync(ledger, Buffer.alloc(MAX_VALIDATION_LEDGER_BYTES + 1, 0x78));
    chmodSync(ledger, 0o644);
    writeValidationLedger(ledger, {
      schemaVersion: 2,
      event: "validation-command",
      status: "started",
      label: "test",
    });
    const body = readFileSync(ledger, "utf8");
    assert.match(body, /"event":"ledger-reset"/);
    assert.match(body, /"status":"started"/);
    assert.ok(lstatSync(ledger).size <= MAX_VALIDATION_LEDGER_BYTES);
    assert.equal(mode(ledger), 0o600);

    writeFileSync(
      ledger,
      [
        JSON.stringify({
          schemaVersion: 2,
          event: "validation-command",
          status: "finished",
        }),
        JSON.stringify({
          schemaVersion: 1,
          command: ["TOP_SECRET_LEGACY_ARGUMENT"],
        }),
        "",
      ].join("\n"),
    );
    writeValidationLedger(ledger, {
      schemaVersion: 2,
      event: "validation-command",
      status: "started",
      label: "test",
    });
    assert.doesNotMatch(
      readFileSync(ledger, "utf8"),
      /TOP_SECRET_LEGACY_ARGUMENT/,
    );

    rmSync(ledger);
    writeFileSync(external, "external");
    symlinkSync(external, ledger);
    assert.throws(
      () =>
        writeValidationLedger(ledger, {
          schemaVersion: 2,
          event: "validation-command",
          status: "started",
          label: "test",
        }),
      /regular file|ELOOP/i,
    );
    assert.equal(readFileSync(external, "utf8"), "external");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation ledger omits raw command arguments", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-command-"));
  const ledger = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  const secret = "TOP_SECRET_ARGUMENT_123";
  try {
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        "--label",
        "test",
        "--ledger",
        ledger,
        "--lock-file",
        lockFile,
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
        secret,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    assert.deepEqual(await waitForExit(child), { code: 0, signal: null });
    const body = readFileSync(ledger, "utf8");
    assert.doesNotMatch(body, new RegExp(secret));
    assert.doesNotMatch(body, /process\.exit\(0\)/);
    assert.match(body, /"status":"started"/);
    assert.match(body, /"status":"finished"/);
    assert.equal(mode(ledger), 0o600);
    assert.equal(existsSync(lockFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("spawn failure is ledgered and releases the lock", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-spawn-error-"));
  const ledger = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  try {
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        "--label",
        "spawn-error",
        "--ledger",
        ledger,
        "--lock-file",
        lockFile,
        "--",
        path.join(root, "missing-command"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    assert.deepEqual(await waitForExit(child), { code: 127, signal: null });
    const body = readFileSync(ledger, "utf8");
    assert.match(body, /"status":"finished"/);
    assert.match(body, /"errorCode":"ENOENT"/);
    assert.equal(existsSync(lockFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second wrapper signal immediately kills the validation group", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-signal-"));
  const ledger = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  let nestedPid = null;
  try {
    const wrapper = spawn(
      process.execPath,
      [
        scriptPath,
        "--label",
        "signal-test",
        "--ledger",
        ledger,
        "--lock-file",
        lockFile,
        "--",
        process.execPath,
        "-e",
        [
          'process.on("SIGTERM",()=>console.log("TERM_SEEN"));',
          "console.log(`READY:${process.pid}`);",
          "setInterval(()=>{},1000);",
        ].join(""),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exitPromise = waitForExit(wrapper);
    nestedPid = Number((await waitForOutput(wrapper.stdout, /READY:(\d+)/))[1]);

    wrapper.kill("SIGTERM");
    await waitForOutput(wrapper.stdout, /TERM_SEEN/);
    wrapper.kill("SIGINT");
    assert.deepEqual(
      await withTimeout(exitPromise, 2_000, "wrapper did not escalate"),
      { code: null, signal: "SIGTERM" },
    );
    assert.equal(existsSync(lockFile), false);
    const body = readFileSync(ledger, "utf8");
    assert.match(body, /"signal":"SIGTERM"/);
    assert.match(body, /"childSignal":"SIGKILL"/);
    assert.match(body, /"escalated":true/);
    await waitForPidGone(nestedPid);
  } finally {
    if (nestedPid) {
      try {
        process.kill(nestedPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("leader exit cannot leave a TERM-ignoring descendant", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-descendant-"));
  const ledger = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  const grandchildReady = path.join(root, "grandchild-ready");
  let grandchildPid = null;
  try {
    const grandchildCode = [
      'const fs=require("node:fs");',
      'process.on("SIGTERM",()=>{});',
      `fs.writeFileSync(${JSON.stringify(grandchildReady)},String(process.pid));`,
      "setInterval(()=>{},1000);",
    ].join("");
    const leaderCode = [
      'const fs=require("node:fs");',
      'const {spawn}=require("node:child_process");',
      `const ready=${JSON.stringify(grandchildReady)};`,
      `const child=spawn(process.execPath,["-e",${JSON.stringify(grandchildCode)}],{stdio:"ignore"});`,
      'process.on("SIGTERM",()=>process.exit(0));',
      "const timer=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(timer);console.log(`GRANDCHILD:${child.pid}`)}},10);",
    ].join("");
    const wrapper = spawn(
      process.execPath,
      [
        scriptPath,
        "--label",
        "descendant-test",
        "--ledger",
        ledger,
        "--lock-file",
        lockFile,
        "--",
        process.execPath,
        "-e",
        leaderCode,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exitPromise = waitForExit(wrapper);
    grandchildPid = Number(
      (await waitForOutput(wrapper.stdout, /GRANDCHILD:(\d+)/))[1],
    );
    wrapper.kill("SIGTERM");
    assert.deepEqual(
      await withTimeout(exitPromise, 2_000, "wrapper left descendant running"),
      { code: null, signal: "SIGTERM" },
    );
    await waitForPidGone(grandchildPid);
    assert.equal(existsSync(lockFile), false);
  } finally {
    if (grandchildPid) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("shutdown timer escalates a TERM-ignoring validation child", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-timer-"));
  const ledgerPath = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  const readyFile = path.join(root, "ready");
  let nestedPid = null;
  try {
    const childCode = [
      'const fs=require("node:fs");',
      'process.on("SIGTERM",()=>{});',
      `fs.writeFileSync(${JSON.stringify(readyFile)},String(process.pid));`,
      "setInterval(()=>{},1000);",
    ].join("");
    const outcomePromise = runValidationCommand(
      {
        command: [process.execPath, "-e", childCode],
        label: "timer-test",
        ledgerPath,
        lockFile,
      },
      { shutdownGraceMs: 100 },
    );
    await waitForFile(readyFile);
    nestedPid = Number(readFileSync(readyFile, "utf8"));
    process.kill(process.pid, "SIGTERM");
    const outcome = await withTimeout(
      outcomePromise,
      2_000,
      "shutdown timer did not escalate",
    );
    assert.equal(outcome.signal, "SIGTERM");
    assert.equal(outcome.childSignal, "SIGKILL");
    assert.equal(outcome.escalated, true);
    await waitForPidGone(nestedPid);
    assert.equal(existsSync(lockFile), false);
  } finally {
    if (nestedPid) {
      try {
        process.kill(nestedPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup signal is queued until the validation child is attached", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-startup-signal-"));
  const ledgerPath = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  try {
    const outcomePromise = runValidationCommand(
      {
        command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
        label: "startup-signal",
        ledgerPath,
        lockFile,
      },
      {
        shutdownGraceMs: 100,
        spawnChild(command, args, options) {
          process.emit("SIGTERM");
          return spawn(command, args, options);
        },
      },
    );
    const outcome = await withTimeout(
      outcomePromise,
      2_000,
      "startup signal was not handled",
    );
    assert.equal(outcome.signal, "SIGTERM");
    assert.equal(existsSync(lockFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("signal after the finishing ledger is folded before lock cleanup", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-final-signal-"));
  const ledgerPath = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  try {
    const outcome = await runValidationCommand(
      {
        command: [process.execPath, "-e", "process.exit(0)"],
        label: "final-signal",
        ledgerPath,
        lockFile,
      },
      { afterFinishingLedger: () => process.emit("SIGTERM") },
    );
    assert.equal(outcome.signal, "SIGTERM");
    const events = readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.status),
      ["started", "finishing", "finished"],
    );
    assert.equal(events.at(-1).exit.signal, "SIGTERM");
    assert.equal(existsSync(lockFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failing finalization dependency cannot strand the lock", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "validation-final-failure-"));
  const ledgerPath = path.join(root, "commands.jsonl");
  const lockFile = path.join(root, "validation.lock");
  try {
    const outcome = await runValidationCommand(
      {
        command: [process.execPath, "-e", "process.exit(0)"],
        label: "final-failure",
        ledgerPath,
        lockFile,
      },
      {
        afterFinishingLedger: () => {
          throw new Error("injected finalization failure");
        },
        error: () => {},
      },
    );
    assert.equal(outcome.code, 1);
    assert.equal(outcome.errorCode, "VALIDATION_FINALIZE_FAILED");
    assert.equal(existsSync(lockFile), false);
    const finalEvent = JSON.parse(
      readFileSync(ledgerPath, "utf8").trim().split("\n").at(-1),
    );
    assert.equal(finalEvent.status, "finished");
    assert.equal(finalEvent.exit.errorCode, "VALIDATION_FINALIZE_FAILED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
