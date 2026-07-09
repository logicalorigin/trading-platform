#!/usr/bin/env node
// CPU-profile a RUNNING node process (the live API) with zero app changes.
// Usage: node scripts/diag/cpu-profile-running-api.mjs <pid> [durationMs=15000]
// Mechanism (from docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md §PROFILING TOOLS):
// SIGUSR1 opens the V8 inspector on the target; we attach over CDP (Node >=21
// global WebSocket), run Profiler sampling for the window, and print self-time
// aggregation as % of on-CPU samples. Profile a WARM process (uptime > a few min).

const pid = Number(process.argv[2]);
const durationMs = Number(process.argv[3] ?? 15000);
if (!pid) {
  console.error("usage: cpu-profile-running-api.mjs <pid> [durationMs]");
  process.exit(1);
}

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

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });
await send("Profiler.start");
console.error(`profiling pid ${pid} for ${durationMs}ms ...`);
await new Promise((r) => setTimeout(r, durationMs));
const { profile } = await send("Profiler.stop");
ws.close();

// Aggregate SELF samples per function (exclude idle/program/GC into their own rows).
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const selfHits = new Map();
for (const n of profile.nodes) {
  const f = n.callFrame;
  const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").slice(-1)[0]}:${f.lineNumber + 1}`;
  selfHits.set(key, (selfHits.get(key) ?? 0) + (n.hitCount ?? 0));
}
const total = [...selfHits.values()].reduce((a, b) => a + b, 0);
const idleKeys = ["(idle) :0", "(program) :0"];
const idle = idleKeys.reduce((a, k) => a + (selfHits.get(k) ?? 0), 0);
const busy = total - idle;
console.log(`total samples=${total} idle=${idle} busy=${busy} (busy%=${((busy / total) * 100).toFixed(1)})`);
console.log(`top self-time as % of BUSY samples:`);
const rows = [...selfHits.entries()]
  .filter(([k]) => !idleKeys.includes(k))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30);
for (const [k, v] of rows) {
  console.log(`${((v / busy) * 100).toFixed(1).padStart(6)}%  ${v.toString().padStart(7)}  ${k}`);
}
