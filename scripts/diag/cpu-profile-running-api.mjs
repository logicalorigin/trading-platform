#!/usr/bin/env node
// CPU-profile a RUNNING node process (the live API) with zero app changes.
// Usage: node scripts/diag/cpu-profile-running-api.mjs <pid> [durationMs=15000] [outPath]
// Mechanism (from docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md §PROFILING TOOLS):
// SIGUSR1 opens the V8 inspector on the target; we attach over CDP (Node >=21
// global WebSocket), run Profiler sampling for the window, and print self-time
// aggregation as % of on-CPU samples. Profile a WARM process (uptime > a few min).

import { writeFile } from "node:fs/promises";

import {
  parseCpuProfilerArgs,
  readInspectorProcessId,
  summarizeCpuProfile,
} from "./cpu-profile-utils.mjs";

let options;
try {
  options = parseCpuProfilerArgs(process.argv.slice(2));
} catch (error) {
  console.error(
    "usage: cpu-profile-running-api.mjs <pid> [durationMs] [outPath]",
  );
  console.error(error.message);
  process.exit(1);
}
const { pid, durationMs, outPath } = options;

process.kill(pid, "SIGUSR1"); // idempotent: re-signals keep the inspector open
await new Promise((r) => setTimeout(r, 500));

const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const target = list.find((t) => t.webSocketDebuggerUrl);
if (!target) {
  console.error("no inspector target found on :9229");
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

const inspectedPid = readInspectorProcessId(
  await send("Runtime.evaluate", {
    expression: "process.pid",
    returnByValue: true,
  }),
);
if (inspectedPid !== pid) {
  ws.close();
  throw new Error(
    `inspector target pid ${inspectedPid ?? "unknown"} does not match requested pid ${pid}`,
  );
}

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });
await send("Profiler.start");
console.error(`profiling pid ${pid} for ${durationMs}ms ...`);
await new Promise((r) => setTimeout(r, durationMs));
const { profile } = await send("Profiler.stop");
ws.close();

if (outPath) {
  await writeFile(outPath, `${JSON.stringify(profile)}\n`);
  console.error(`raw profile: ${outPath}`);
}

const summary = summarizeCpuProfile(profile);
console.log(
  `total samples=${summary.totalSamples} idle=${summary.idleDurationUs} busy=${summary.busyDurationUs} ` +
    `(busy%=${summary.busyPercent.toFixed(1)})`,
);
console.log("top self-time as % of BUSY microseconds:");
for (const row of summary.rows.slice(0, 30)) {
  console.log(
    `${row.percent.toFixed(1).padStart(6)}%  ${Math.round(row.durationUs)
      .toString()
      .padStart(9)}  ${row.frame}`,
  );
}
