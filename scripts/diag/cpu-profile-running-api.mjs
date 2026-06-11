// One-shot CPU profiler for a running Node process via the V8 inspector.
// Usage: node scripts/diag/cpu-profile-running-api.mjs <pid> <durationMs>
// Sends SIGUSR1 to open the inspector, connects over the global WebSocket
// (Node >=22), records a CPU profile, writes it, and prints the hottest
// self-time frames. Read-only: profiling does not mutate app state.
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import process from "node:process";

const pid = Number(process.argv[2]);
const durationMs = Number(process.argv[3] ?? 12000);
if (!Number.isInteger(pid)) {
  console.error("usage: node cpu-profile-running-api.mjs <pid> [durationMs]");
  process.exit(1);
}

process.kill(pid, "SIGUSR1"); // opens inspector on 127.0.0.1:9229
await sleep(800);

const list = await (await fetch("http://127.0.0.1:9229/json")).json();
const wsUrl = list[0]?.webSocketDebuggerUrl;
if (!wsUrl) throw new Error("no inspector ws url; is the process up?");

const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((r) => (ws.onopen = r));
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
};

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });
await send("Profiler.start");
console.error(`profiling pid ${pid} for ${durationMs}ms...`);
await sleep(durationMs);
const { profile } = await send("Profiler.stop");
ws.close();

const out = `.pyrus-runtime/api-cpu-${pid}.cpuprofile`;
writeFileSync(out, JSON.stringify(profile));

// Aggregate self-time (sample count) per frame.
const selfHits = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const key = `${cf.functionName || "(anonymous)"} @ ${
    (cf.url || "").replace(/^.*\/artifacts\//, "artifacts/")
  }:${cf.lineNumber + 1}`;
  selfHits.set(key, (selfHits.get(key) ?? 0) + 1);
}
const total = profile.samples.length || 1;
const top = [...selfHits.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25);

console.log(`\n=== CPU profile written to ${out} (${total} samples) ===`);
console.log("self%   hits  frame");
for (const [frame, hits] of top) {
  console.log(
    `${((hits / total) * 100).toFixed(1).padStart(5)}  ${String(hits).padStart(5)}  ${frame}`,
  );
}
