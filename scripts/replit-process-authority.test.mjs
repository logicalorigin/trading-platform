import assert from "node:assert/strict";
import test from "node:test";

import {
  ancestryReachesPid2,
  cmdlineIsPid2,
  hasPyrusWorkflowAncestry,
  isPid2OwnedReplitWorkflow,
  parseProcStat,
  processIdentityMatches,
  signalStableProcess,
} from "./replit-process-authority.mjs";

function fixtureReader(entries) {
  return (path) => {
    if (!(path in entries)) throw new Error(`missing fixture: ${path}`);
    return entries[path];
  };
}

function procStat(pid, command, ppid, startTimeTicks = "1000") {
  const fields = Array(20).fill("0");
  fields[0] = "S";
  fields[1] = String(ppid);
  fields[19] = startTimeTicks;
  return `${pid} (${command}) ${fields.join(" ")}`;
}

test("pid2 authority follows argv0 ancestry rather than numeric PID 2", () => {
  const entries = {
    "/proc/100/stat": procStat(100, "node child", 50),
    "/proc/100/cmdline": "node\0child.mjs\0",
    "/proc/100/cgroup": "0::/workflow.scope\n",
    "/proc/100/cwd": "/workspace/artifacts/pyrus",
    "/proc/50/stat": procStat(50, "node supervisor", 23),
    "/proc/50/cmdline":
      "node\0/opt/pnpm\0--filter\0@workspace/pyrus\0run\0dev:replit\0",
    "/proc/50/cgroup": "0::/workflow.scope\n",
    "/proc/50/cwd": "/workspace/artifacts/pyrus",
    "/proc/23/stat": procStat(23, "node", 13),
    "/proc/23/cmdline": "/opt/replit/pid2\0--pooled-fd=4\0",
    "/proc/13/stat": procStat(13, "pid1", 1),
    "/proc/13/cmdline": "/opt/replit/pid1\0",
  };
  const readFile = fixtureReader(entries);
  const readLink = fixtureReader(entries);

  assert.equal(ancestryReachesPid2(100, { readFile }), true);
  assert.equal(hasPyrusWorkflowAncestry(100, { readFile, readLink }), true);
  assert.equal(
    isPid2OwnedReplitWorkflow({
      env: { REPLIT_MODE: "workflow" },
      pid: 100,
      readFile,
      readLink,
    }),
    true,
  );
  assert.equal(
    isPid2OwnedReplitWorkflow({ env: {}, pid: 100, readFile }),
    false,
  );
});

test("pid2 ancestry does not authorize an ordinary shell execution scope", () => {
  const entries = {
    "/proc/100/stat": procStat(100, "node child", 50),
    "/proc/100/cmdline": "node\0fake-workflow.mjs\0",
    "/proc/100/cgroup": "0::/shell.scope\n",
    "/proc/100/cwd": "/workspace",
    "/proc/50/stat": procStat(50, "bash", 23),
    "/proc/50/cmdline": "bash\0--rcfile\0/replit-bashrc\0",
    "/proc/50/cgroup": "0::/shell.scope\n",
    "/proc/50/cwd": "/workspace",
    "/proc/23/stat": procStat(23, "node", 13),
    "/proc/23/cmdline": "pid2\0--pooled-fd=4\0",
    "/proc/13/stat": procStat(13, "pid1", 1),
    "/proc/13/cmdline": "/opt/replit/pid1\0",
  };
  const readFile = fixtureReader(entries);
  const readLink = fixtureReader(entries);

  assert.equal(ancestryReachesPid2(100, { readFile }), true);
  assert.equal(hasPyrusWorkflowAncestry(100, { readFile, readLink }), false);
  assert.equal(
    isPid2OwnedReplitWorkflow({
      env: { REPLIT_MODE: "workflow" },
      pid: 100,
      readFile,
      readLink,
    }),
    false,
  );
});

test("pid2 authority fails closed for spoofed numeric PID 2 loops and missing proc data", () => {
  assert.equal(
    ancestryReachesPid2(2, {
      readFile: fixtureReader({
        "/proc/2/stat": procStat(2, "shell", 1),
        "/proc/2/cmdline": "node\0fake-workflow.mjs\0",
        "/proc/1/stat": procStat(1, "init", 0),
        "/proc/1/cmdline": "init\0",
      }),
    }),
    false,
  );
  assert.equal(
    ancestryReachesPid2(10, {
      readFile: fixtureReader({
        "/proc/10/stat": procStat(10, "loop", 10),
        "/proc/10/cmdline": "node\0loop.mjs\0",
      }),
    }),
    false,
  );
  assert.equal(ancestryReachesPid2(10, { readFile: fixtureReader({}) }), false);
  assert.equal(
    ancestryReachesPid2(30, {
      readFile: fixtureReader({
        "/proc/30/stat": procStat(30, "fake pid2", 10),
        "/proc/30/cmdline": "pid2\0--forged\0",
      }),
    }),
    false,
  );
});

test("proc identity parsers handle spaces and match only pid2 argv0", () => {
  assert.deepEqual(
    parseProcStat(procStat(123, "node (worker) name", 45, "987")),
    { ppid: 45, startTimeTicks: "987" },
  );
  assert.equal(cmdlineIsPid2("pid2\0--flag\0"), true);
  assert.equal(cmdlineIsPid2("/usr/bin/pid2\0--flag\0"), true);
  assert.equal(cmdlineIsPid2("node\0/mnt/pid2/server.cjs\0"), false);
});

test("stable process signaling refuses changed PID instances", () => {
  const expected = {
    pid: 50,
    startTimeTicks: "1000",
    cgroup: "scope-a",
    cmdlineRaw: "node\0./scripts/runDevApp.mjs\0",
    cwd: "/workspace/artifacts/pyrus",
  };
  const signals = [];
  assert.equal(processIdentityMatches(expected, { ...expected }), true);
  assert.equal(
    processIdentityMatches(expected, { ...expected, startTimeTicks: "1001" }),
    false,
  );
  assert.equal(
    signalStableProcess(expected, "SIGTERM", {
      readIdentity: () => ({ ...expected, startTimeTicks: "1001" }),
      kill: (...args) => signals.push(args),
    }),
    false,
  );
  assert.deepEqual(signals, []);
  assert.equal(
    signalStableProcess(expected, "SIGTERM", {
      readIdentity: () => ({ ...expected }),
      kill: (...args) => signals.push(args),
    }),
    true,
  );
  assert.deepEqual(signals, [[50, "SIGTERM"]]);
});
