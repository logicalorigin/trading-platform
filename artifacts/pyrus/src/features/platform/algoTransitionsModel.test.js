import assert from "node:assert/strict";
import test from "node:test";

import {
  appendToRingBuffer,
  buildTransitionsBufferStore,
  collectEventTransitions,
  diffSignalSnapshots,
  eventToTransition,
  limitToWindow,
  mergeTransitions,
} from "./algoTransitionsModel";

test("signal snapshot diff emits fresh→stale transitions", () => {
  const prev = [
    { symbol: "SPY", timeframe: "5m", fresh: true, status: "ok" },
    { symbol: "NVDA", timeframe: "5m", fresh: true, status: "ok" },
  ];
  const next = [
    { symbol: "SPY", timeframe: "5m", fresh: false, status: "ok" },
    { symbol: "NVDA", timeframe: "5m", fresh: true, status: "ok" },
  ];
  const transitions = diffSignalSnapshots(prev, next, "2026-05-18T14:30:00.000Z");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].symbol, "SPY");
  assert.equal(transitions[0].prevState, "fresh");
  assert.equal(transitions[0].nextState, "stale");
  assert.equal(transitions[0].kind, "signal");
});

test("signal snapshot diff surfaces a new symbol as unavailable→fresh", () => {
  const next = [{ symbol: "TSLA", timeframe: "5m", fresh: true, status: "ok" }];
  const transitions = diffSignalSnapshots([], next, "2026-05-18T14:30:00.000Z");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].prevState, "unavailable");
  assert.equal(transitions[0].nextState, "fresh");
});

test("collectEventTransitions filters by relevant event types and time window", () => {
  const events = [
    { id: 1, eventType: "signal_options_entry", occurredAt: "2026-05-18T14:30:10.000Z", symbol: "SPY" },
    { id: 2, eventType: "trade_filled", occurredAt: "2026-05-18T14:30:11.000Z", symbol: "QQQ" },
    { id: 3, eventType: "signal_options_skipped", occurredAt: "2026-05-18T14:28:00.000Z", symbol: "NVDA" },
  ];
  const sinceMs = Date.parse("2026-05-18T14:29:30.000Z");
  const transitions = collectEventTransitions(events, { sinceMs });
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].symbol, "SPY");
  assert.equal(transitions[0].kind, "event");
});

test("mergeTransitions deduplicates by id and sorts newest first", () => {
  const merged = mergeTransitions([
    { id: "a", timeMs: 100 },
    { id: "b", timeMs: 200 },
    { id: "a", timeMs: 150 },
    { id: "c", timeMs: 50 },
  ]);
  assert.deepEqual(merged.map((t) => t.id), ["b", "a", "c"]);
  const a = merged.find((t) => t.id === "a");
  assert.equal(a.timeMs, 150);
});

test("appendToRingBuffer caps the buffer at the configured max", () => {
  const seed = Array.from({ length: 20 }, (_, index) => ({
    id: `seed:${index}`,
    timeMs: 1000 + index,
  }));
  const incoming = [
    { id: "new:0", timeMs: 2_000 },
    { id: "new:1", timeMs: 2_001 },
    { id: "new:2", timeMs: 2_002 },
  ];
  const result = appendToRingBuffer(seed, incoming, { max: 20 });
  assert.equal(result.length, 20);
  assert.equal(result[0].id, "new:2");
  assert.equal(result[1].id, "new:1");
  assert.equal(result[2].id, "new:0");
  assert.equal(result.at(-1).id, "seed:3");
});

test("limitToWindow drops transitions older than the window", () => {
  const nowMs = 10_000;
  const recent = limitToWindow(
    [
      { id: "recent", timeMs: 9_500 },
      { id: "old", timeMs: 7_000 },
    ],
    { windowMs: 60_000, nowMs },
  );
  assert.equal(recent.length, 2);
  const tighter = limitToWindow(
    [
      { id: "recent", timeMs: 9_500 },
      { id: "old", timeMs: 7_000 },
    ],
    { windowMs: 1_000, nowMs },
  );
  assert.equal(tighter.length, 1);
  assert.equal(tighter[0].id, "recent");
});

test("transitions buffer store prunes other deployments on switch", () => {
  const store = buildTransitionsBufferStore({ max: 5 });
  store.push("dep-1", [{ id: "a", timeMs: 100 }]);
  store.push("dep-2", [{ id: "b", timeMs: 200 }]);
  store.prune("dep-1");
  assert.deepEqual(
    store.get("dep-1").map((t) => t.id),
    ["a"],
  );
  assert.deepEqual(store.get("dep-2"), []);
});

test("eventToTransition stamps a stable id from the event id when available", () => {
  const transition = eventToTransition({
    id: "abc-123",
    eventType: "signal_options_entry",
    symbol: "SPY",
    occurredAt: "2026-05-18T14:30:00.000Z",
  });
  assert.equal(transition.id, "event:abc-123");
  assert.equal(transition.kind, "event");
  assert.equal(transition.symbol, "SPY");
});
