import assert from "node:assert/strict";
import test from "node:test";

import {
  createProcInspector,
  holderIdentityMatches,
  parsePort,
  reapPort,
  safeDisplay,
} from "./reap-dev-port.mjs";

const holder = {
  pid: 200,
  startTimeTicks: "1000",
  cgroup: "scope-a",
  socketInodes: new Set(["123"]),
  command: "node server.mjs",
};

function makeHarness({
  holderCgroup = "scope-a",
  ancestry = false,
  revalidate = true,
  freeOn = "SIGTERM",
  unavailable = false,
} = {}) {
  let occupied = true;
  let time = 0;
  const signals = [];
  const logs = [];
  const currentHolder = { ...holder, cgroup: holderCgroup };
  const proc = {
    listeningInodes() {
      if (unavailable) return null;
      return occupied ? new Set(["123"]) : new Set();
    },
    findHolders() {
      return [currentHolder];
    },
    readCgroup() {
      return "scope-a";
    },
    hasPyrusWorkflowAncestry() {
      return ancestry;
    },
    revalidateHolder() {
      return revalidate;
    },
  };
  return {
    proc,
    signals,
    logs,
    now: () => time,
    sleep(ms) {
      time += ms;
    },
    kill(pid, signal) {
      signals.push([pid, signal]);
      if (signal === freeOn) occupied = false;
    },
    warn(line) {
      logs.push(["warn", line]);
    },
    error(line) {
      logs.push(["error", line]);
    },
  };
}

test("reap-dev-port validates a decimal TCP port before proc access", () => {
  assert.equal(parsePort("8080"), 8080);
  for (const value of [undefined, "", "1.5", "0", "65536", "1e3", "NaN"]) {
    assert.throws(() => parsePort(value), /PORT/);
  }
});

test("proc listener inspection permits an absent address family but not unreadable evidence", () => {
  const tcp = [
    "sl local_address rem_address st tx rx tr tm retr uid timeout inode",
    "0: 00000000:1F90 00000000:0000 0A 0 0 0 0 0 123",
  ].join("\n");
  const absentIpv6 = Object.assign(new Error("missing"), { code: "ENOENT" });
  const accepted = createProcInspector({
    readFile(file) {
      if (file === "/proc/net/tcp") return tcp;
      throw absentIpv6;
    },
  }).listeningInodes(8080);
  assert.deepEqual(accepted, new Set(["123"]));

  const unavailable = createProcInspector({
    readFile(file) {
      if (file === "/proc/net/tcp") return tcp;
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
  }).listeningInodes(8080);
  assert.equal(unavailable, null);
});

test("reap-dev-port permits stable same-scope holders and bounds escalation", () => {
  const termHarness = makeHarness();
  assert.equal(
    reapPort({
      rawPort: "8080",
      env: {},
      pid: 100,
      ppid: 99,
      ...termHarness,
    }),
    0,
  );
  assert.deepEqual(termHarness.signals, [[200, "SIGTERM"]]);

  const killHarness = makeHarness({ freeOn: "SIGKILL" });
  assert.equal(
    reapPort({
      rawPort: "8080",
      env: {},
      pid: 100,
      ppid: 99,
      ...killHarness,
    }),
    0,
  );
  assert.deepEqual(killHarness.signals, [
    [200, "SIGTERM"],
    [200, "SIGKILL"],
  ]);
});

test("reap-dev-port refuses shell-spoofed foreign authority and unknown evidence", () => {
  for (const harness of [
    makeHarness({ holderCgroup: "scope-b", ancestry: false }),
    makeHarness({ holderCgroup: null, ancestry: true }),
    makeHarness({ revalidate: false }),
    makeHarness({ unavailable: true }),
  ]) {
    assert.equal(
      reapPort({
        rawPort: "8080",
        env: { REPLIT_MODE: "workflow" },
        pid: 100,
        ppid: 99,
        ...harness,
      }),
      1,
    );
    assert.deepEqual(harness.signals, []);
  }
});

test("reap-dev-port permits a pid2-owned workflow to replace a stable foreign scope", () => {
  const harness = makeHarness({ holderCgroup: "scope-b", ancestry: true });
  assert.equal(
    reapPort({
      rawPort: "8080",
      env: { REPLIT_MODE: "workflow" },
      pid: 100,
      ppid: 99,
      ...harness,
    }),
    0,
  );
  assert.deepEqual(harness.signals, [[200, "SIGTERM"]]);
});

test("reap-dev-port refuses partially attributed listener sockets", () => {
  const harness = makeHarness();
  harness.proc.listeningInodes = () => new Set(["123", "unattributed"]);

  assert.equal(
    reapPort({
      rawPort: "8080",
      env: {},
      pid: 100,
      ppid: 99,
      ...harness,
    }),
    1,
  );
  assert.deepEqual(harness.signals, []);
});

test("reap-dev-port accepts a holder that exits during discovery", () => {
  const harness = makeHarness();
  let inspections = 0;
  harness.proc.listeningInodes = () => {
    inspections += 1;
    return inspections === 1 ? new Set(["123"]) : new Set();
  };
  harness.proc.findHolders = () => [];

  assert.equal(
    reapPort({
      rawPort: "8080",
      env: {},
      pid: 100,
      ppid: 99,
      ...harness,
    }),
    0,
  );
  assert.deepEqual(harness.signals, []);
});

test("reap-dev-port accepts identity evidence that disappears with the listener", () => {
  const harness = makeHarness();
  let inspections = 0;
  harness.proc.listeningInodes = () => {
    inspections += 1;
    return inspections === 1 ? new Set(["123"]) : new Set();
  };
  harness.proc.findHolders = () => [
    { ...holder, startTimeTicks: null, cgroup: null },
  ];

  assert.equal(
    reapPort({
      rawPort: "8080",
      env: {},
      pid: 100,
      ppid: 99,
      ...harness,
    }),
    0,
  );
  assert.deepEqual(harness.signals, []);
});

test("reap-dev-port never SIGKILLs a holder whose identity changed after TERM", () => {
  const harness = makeHarness({ freeOn: "never" });
  let checks = 0;
  harness.proc.revalidateHolder = () => {
    checks += 1;
    return checks <= 2;
  };

  assert.equal(
    reapPort({
      rawPort: "8080",
      env: {},
      pid: 100,
      ppid: 99,
      ...harness,
    }),
    1,
  );
  assert.deepEqual(harness.signals, [[200, "SIGTERM"]]);
});

test("holder validation binds PID start time cgroup and original socket", () => {
  const current = { ...holder, socketInodes: new Set(["123", "456"]) };
  assert.equal(holderIdentityMatches(holder, current, new Set(["123"])), true);
  assert.equal(
    holderIdentityMatches(
      holder,
      { ...current, startTimeTicks: "1001" },
      new Set(["123"]),
    ),
    false,
  );
  assert.equal(
    holderIdentityMatches(
      holder,
      { ...current, cgroup: "scope-b" },
      new Set(["123"]),
    ),
    false,
  );
  assert.equal(holderIdentityMatches(holder, current, new Set(["999"])), false);
});

test("reap-dev-port display text is one bounded terminal-safe Unicode line", () => {
  const rendered = safeDisplay("A\u001b[31mB\n\u202e😀Z", 4);
  assert.equal(rendered, "AB 😀…");
  assert.doesNotMatch(rendered, /[\r\n\u001b\u202e]/u);
});
