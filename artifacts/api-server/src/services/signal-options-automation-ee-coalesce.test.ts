import assert from "node:assert/strict";
import test from "node:test";

import { type ExecutionEvent } from "@workspace/db";

import { __signalOptionsAutomationInternalsForTests as internals } from "./signal-options-automation";

// WO-EE-FIREHOSE — pure decision logic for the candidate-skip coalescing window
// (Deliverable 1) and the shadow-mark EVENT-row floor (Deliverable 2). These
// exercise the injectable helpers with an explicit store + clock, so no DB is
// touched (the emit/insert wiring around them is verified by typecheck).
//
//   pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
//     src/services/signal-options-automation-ee-coalesce.test.ts

type SkipPayloadArgs = Parameters<
  typeof internals.buildSignalOptionsSkippedPayload
>[0];
type SkipCandidate = SkipPayloadArgs["candidate"];
type SkipWindow = Parameters<
  typeof internals.registerSignalOptionsSkipCoalesceWindow
>[0]["window"];

function makeWindow(overrides: Partial<SkipWindow> = {}): SkipWindow {
  return {
    eventId: "evt-1",
    firstSeenAt: new Date(0).toISOString(),
    createdAt: new Date(0),
    windowStartMs: 0,
    count: 1,
    ...overrides,
  };
}

test("skip coalesce: window opens within window, expires at the boundary", () => {
  const store = new Map<string, SkipWindow>();
  const key = internals.signalOptionsSkipCoalesceKey(
    "dep-1",
    "AAPL",
    "mtf_not_aligned",
    "sk-1",
  );
  const windowMs = 900_000;
  const t0 = 1_000_000;

  // No window yet -> caller inserts a fresh row.
  assert.equal(
    internals.getOpenSignalOptionsSkipCoalesceWindow({
      store,
      key,
      nowMs: t0,
      windowMs,
    }),
    null,
  );

  internals.registerSignalOptionsSkipCoalesceWindow({
    store,
    key,
    window: makeWindow({ eventId: "evt-1", windowStartMs: t0 }),
    maxKeys: internals.SIGNAL_OPTIONS_SKIP_COALESCE_MAX_KEYS,
  });

  // Just inside the window -> coalesce onto the same row.
  const open = internals.getOpenSignalOptionsSkipCoalesceWindow({
    store,
    key,
    nowMs: t0 + windowMs - 1,
    windowMs,
  });
  assert.ok(open);
  assert.equal(open.eventId, "evt-1");

  // At the boundary -> expired + evicted, caller re-inserts.
  assert.equal(
    internals.getOpenSignalOptionsSkipCoalesceWindow({
      store,
      key,
      nowMs: t0 + windowMs,
      windowMs,
    }),
    null,
  );
  assert.equal(store.size, 0);
});

test("skip coalesce: distinct signalKeys get distinct keys (seen-signal dedup safety)", () => {
  const k1 = internals.signalOptionsSkipCoalesceKey(
    "dep-1",
    "AAPL",
    "mtf_not_aligned",
    "sk-1",
  );
  const k2 = internals.signalOptionsSkipCoalesceKey(
    "dep-1",
    "AAPL",
    "mtf_not_aligned",
    "sk-2",
  );
  // Different signalKeys MUST NOT share a window, or a signal could be re-processed.
  assert.notEqual(k1, k2);
  // Same tuple collapses.
  assert.equal(
    internals.signalOptionsSkipCoalesceKey("dep-1", "AAPL", "r", "sk-1"),
    internals.signalOptionsSkipCoalesceKey("dep-1", "AAPL", "r", "sk-1"),
  );
});

test("skip coalesce: window index is LRU-bounded, evicting oldest", () => {
  const store = new Map<string, SkipWindow>();
  const maxKeys = 4;
  for (let i = 0; i < 10; i++) {
    internals.registerSignalOptionsSkipCoalesceWindow({
      store,
      key: `k-${i}`,
      window: makeWindow({ eventId: `e-${i}`, windowStartMs: i }),
      maxKeys,
    });
  }
  assert.equal(store.size, maxKeys);
  assert.equal(store.has("k-0"), false); // oldest evicted
  assert.equal(store.has("k-9"), true); // newest retained
});

test("skip coalesce: windowMs<=0 disables coalescing", () => {
  const store = new Map<string, SkipWindow>();
  const key = "k";
  internals.registerSignalOptionsSkipCoalesceWindow({
    store,
    key,
    window: makeWindow(),
    maxKeys: 10,
  });
  assert.equal(
    internals.getOpenSignalOptionsSkipCoalesceWindow({
      store,
      key,
      nowMs: 5,
      windowMs: 0,
    }),
    null,
  );
});

test("skip coalesce: payload keeps FULL last-skip fields + count/first/last (no trimming)", () => {
  const candidate = {
    symbol: "AAPL",
    signal: { s: 1 },
    action: { a: 2 },
    id: "cand-1",
  } as unknown as SkipCandidate;
  const payload = internals.buildSignalOptionsSkippedPayload({
    candidate,
    signalKey: "sk-1",
    reason: "mtf_not_aligned",
    detail: {
      retryable: true,
      chainDebug: { reason: "x" },
      entryGate: { reasons: ["g"] },
      premiumCap: 5,
    },
    count: 7,
    firstSeenAt: "2026-07-09T00:00:00.000Z",
    lastSeenAt: "2026-07-09T00:10:00.000Z",
  });
  // Consumers (seen-signal dedup + cockpit) read many nested fields; keep them all.
  assert.equal(payload.reason, "mtf_not_aligned");
  assert.equal(payload.signalKey, "sk-1");
  assert.deepEqual(payload.signal, { s: 1 });
  assert.deepEqual(payload.action, { a: 2 });
  assert.equal(payload.retryable, true);
  assert.deepEqual(payload.chainDebug, { reason: "x" });
  assert.deepEqual(payload.entryGate, { reasons: ["g"] });
  assert.equal(payload.premiumCap, 5);
  assert.equal(payload.count, 7);
  assert.equal(payload.firstSeenAt, "2026-07-09T00:00:00.000Z");
  assert.equal(payload.lastSeenAt, "2026-07-09T00:10:00.000Z");
  const snapshot = payload.candidate as Record<string, unknown>;
  assert.equal(snapshot.status, "skipped");
  assert.equal(snapshot.id, "cand-1");
});

test("mark floor: first allowed, repeat within floor blocked, allowed again after floor", () => {
  const store = new Map<string, number>();
  const key = "dep-1 AAPL";
  const floorMs = 300_000;
  const call = (nowMs: number) =>
    internals.signalOptionsMarkEventFloorAllows({
      store,
      key,
      nowMs,
      floorMs,
      maxKeys: 4096,
    });
  assert.equal(call(0), true);
  assert.equal(call(60_000), false);
  assert.equal(call(floorMs), true);
  assert.equal(call(floorMs + 60_000), false);
});

test("mark floor: floorMs<=0 always allows", () => {
  const store = new Map<string, number>();
  assert.equal(
    internals.signalOptionsMarkEventFloorAllows({
      store,
      key: "k",
      nowMs: 0,
      floorMs: 0,
      maxKeys: 10,
    }),
    true,
  );
  assert.equal(
    internals.signalOptionsMarkEventFloorAllows({
      store,
      key: "k",
      nowMs: 1,
      floorMs: 0,
      maxKeys: 10,
    }),
    true,
  );
});

test("mark floor: non-mark events always persist; marks floored per position", () => {
  internals.__resetSignalOptionsMarkEventFloorForTests();

  const nonMark = {
    eventType: "signal_options_shadow_entry",
    symbol: "AAPL",
    payload: {},
  } as unknown as ExecutionEvent;
  assert.equal(
    internals.shouldPersistSignalOptionsMarkEventRow({
      deploymentId: "dep-1",
      event: nonMark,
      occurredAt: new Date(0),
    }),
    true,
  );
  assert.equal(
    internals.shouldPersistSignalOptionsMarkEventRow({
      deploymentId: "dep-1",
      event: nonMark,
      occurredAt: new Date(1),
    }),
    true,
  );

  const mark = (positionId: string) =>
    ({
      eventType: "signal_options_shadow_mark",
      symbol: "AAPL",
      payload: { position: { id: positionId } },
    }) as unknown as ExecutionEvent;
  const persist = (positionId: string, ms: number) =>
    internals.shouldPersistSignalOptionsMarkEventRow({
      deploymentId: "dep-1",
      event: mark(positionId),
      occurredAt: new Date(ms),
    });

  // Env unset -> default 5min floor.
  assert.equal(internals.resolveSignalOptionsMarkEventMinIntervalMs(), 300_000);
  assert.equal(persist("p1", 0), true);
  assert.equal(persist("p1", 60_000), false); // within 5min -> event row skipped
  assert.equal(persist("p2", 60_000), true); // different position is independent
  assert.equal(persist("p1", 300_000), true); // after floor
});

test("mark floor: backfill/replay marks bypass the floor (idempotent reconstruction)", () => {
  internals.__resetSignalOptionsMarkEventFloorForTests();
  const backfillMark = {
    eventType: "signal_options_shadow_mark",
    symbol: "AAPL",
    payload: { position: { id: "p1" }, backfillEventKey: "bk-1" },
  } as unknown as ExecutionEvent;
  const persist = (ms: number) =>
    internals.shouldPersistSignalOptionsMarkEventRow({
      deploymentId: "dep-1",
      event: backfillMark,
      occurredAt: new Date(ms),
    });
  // Repeated historical marks within the floor window all persist.
  assert.equal(persist(0), true);
  assert.equal(persist(1_000), true);
  assert.equal(persist(2_000), true);
});
