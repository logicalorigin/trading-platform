import assert from "node:assert/strict";
import test from "node:test";

import {
  __setDbForTests,
  algoDeploymentsTable,
  algoStrategiesTable,
  automationDiagnosticsTable,
  currentDbLane,
  db,
  executionEventsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import {
  __overnightSpotExecutionInternalsForTests as internals,
  defaultOvernightSpotExecutionDependencies,
  deploymentHasOvernightSpotProfile,
  runOvernightSpotSignalScan,
  type OvernightSpotExecutionDependencies,
  type OvernightSpotExecutionEventInput,
} from "./overnight-spot-execution";
import {
  OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
  type EquityExecutionStyle,
  type OvernightSpotOrderRequest,
} from "./overnight-spot-automation";

const SHADOW_DEPLOYMENT = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Overnight Spot Test",
  mode: "shadow" as const,
  enabled: true,
  providerAccountId: "shadow",
  symbolUniverse: ["AAPL"],
  config: {
    overnightSpot: {
      enabled: true,
      executionMode: "shadow",
      // Bypass the actionable-signal filter so the injected state always reaches
      // the dedup gate; this test targets the idempotency lookup, not signal
      // freshness/session gating.
      requireActionableSignal: false,
    },
  },
};

const LIVE_DEPLOYMENT = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Overnight Spot Live Test",
  mode: "live" as const,
  enabled: true,
  providerAccountId: "DU1234567",
  symbolUniverse: ["AAPL"],
  config: {
    overnightSpot: {
      enabled: true,
      executionMode: "live",
      requireActionableSignal: false,
      defaultOrderNotional: 1_000,
      maxOrderNotional: 2_000,
      maxShareQuantity: 20,
      maxSpreadPercent: 5,
      maxSignalAgeMs: 2 * 60 * 60 * 1000,
    },
  },
};

const BUY_STATE = {
  profileId: "profile-1",
  symbol: "AAPL",
  timeframe: "1d",
  currentSignalDirection: "buy" as const,
  currentSignalAt: new Date("2026-06-12T16:00:00.000Z"),
  currentSignalPrice: 100,
  fresh: true,
  status: "ok",
  barsSinceSignal: 0,
};

// Build a fully-injected dependency set whose order placement is spied. Any test
// that places an order is a FAILURE of idempotency, so the spies start "not
// called" and we assert they stay that way on a skip.
function buildScanDeps(
  overrides: Partial<OvernightSpotExecutionDependencies> = {},
): {
  deps: OvernightSpotExecutionDependencies;
  calls: {
    placeLiveOrder: number;
    placeShadowOrder: number;
    insertExecutionEvent: number;
    insertDiagnosticEvent: number;
    markLiveOrderIntent: number;
    sequence: string[];
    insertedEvents: OvernightSpotExecutionEventInput[];
    markedIntents: Array<{
      status: string;
      reason?: string | null;
      intentEvent: Record<string, unknown>;
    }>;
  };
} {
  const calls = {
    placeLiveOrder: 0,
    placeShadowOrder: 0,
    insertExecutionEvent: 0,
    insertDiagnosticEvent: 0,
    markLiveOrderIntent: 0,
    sequence: [] as string[],
    insertedEvents: [] as OvernightSpotExecutionEventInput[],
    markedIntents: [] as Array<{
      status: string;
      reason?: string | null;
      intentEvent: Record<string, unknown>;
    }>,
  };
  const deps: OvernightSpotExecutionDependencies = {
    loadDeployment: async () => SHADOW_DEPLOYMENT,
    evaluateSignals: async () => {},
    loadSignalStates: async () => [BUY_STATE],
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 99, ask: 101, mid: 100, updatedAt: new Date() }],
      ]),
    loadPositionQuantities: async () => new Map(),
    findExistingEventByClientOrderId: async () => null,
    insertExecutionEvent: async (input) => {
      calls.insertExecutionEvent += 1;
      calls.sequence.push(`insert:${input.eventType}`);
      calls.insertedEvents.push(input);
      return { id: `ledger-event-${calls.insertExecutionEvent}`, ...input };
    },
    insertDiagnosticEvent: async (input) => {
      calls.insertDiagnosticEvent += 1;
      calls.sequence.push(`diagnostic:${input.eventType}`);
      return {
        id: `diagnostic-event-${calls.insertDiagnosticEvent}`,
        ...input,
      };
    },
    placeShadowOrder: async () => {
      calls.placeShadowOrder += 1;
      calls.sequence.push("placeShadowOrder");
      return { id: "shadow-order" };
    },
    placeLiveOrder: async () => {
      calls.placeLiveOrder += 1;
      calls.sequence.push("placeLiveOrder");
      return { id: "live-order" };
    },
    markLiveOrderIntent: async (input) => {
      calls.markLiveOrderIntent += 1;
      calls.sequence.push(`mark:${input.status}`);
      calls.markedIntents.push({
        status: input.status,
        reason: input.reason,
        intentEvent: input.intentEvent,
      });
      return { ...input.intentEvent, payload: { status: input.status } };
    },
    notifyChanged: () => {},
    ...overrides,
  };
  return { deps, calls };
}

test("equity execution routes quotes and orders through the active selected style", async (t) => {
  const cases = [
    {
      name: "day-only RTH",
      styles: ["day"],
      marketSessionKey: "rth",
      expectedStyle: "day",
      expectedTradingSession: "regular",
      expectedIncludeOvernight: false,
    },
    {
      name: "combined RTH",
      styles: ["day", "overnight"],
      marketSessionKey: "rth",
      expectedStyle: "day",
      expectedTradingSession: "regular",
      expectedIncludeOvernight: false,
    },
    {
      name: "combined overnight",
      styles: ["day", "overnight"],
      marketSessionKey: "overnight",
      expectedStyle: "overnight",
      expectedTradingSession: "overnight",
      expectedIncludeOvernight: true,
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const now = new Date("2026-06-12T16:01:00.000Z");
      const deployment = {
        ...SHADOW_DEPLOYMENT,
        config: {
          equityExecution: {
            styles: [...testCase.styles],
            enabled: true,
            executionMode: "shadow",
            requireActionableSignal: false,
            defaultOrderNotional: 1_000,
            maxOrderNotional: 2_000,
            maxShareQuantity: 20,
            maxSpreadPercent: 5,
          },
        },
      };
      const quoteStyles: string[] = [];
      const orders: OvernightSpotOrderRequest[] = [];
      const { deps } = buildScanDeps({
        loadDeployment: async () => deployment,
        loadQuotes: async (_symbols, executionStyle) => {
          quoteStyles.push(String(executionStyle));
          return new Map([
            ["AAPL", { bid: 100, ask: 100.1, mid: 100.05, updatedAt: now }],
          ]);
        },
        placeShadowOrder: async (order) => {
          orders.push(order);
          return { id: "shadow-order" };
        },
      });

      const result = await runOvernightSpotSignalScan(
        {
          deploymentId: deployment.id,
          runActions: true,
          marketSessionKey: testCase.marketSessionKey,
          now,
        },
        deps,
      );

      assert.equal(result.results[0]?.status, "executed");
      assert.deepEqual(quoteStyles, [testCase.expectedStyle]);
      assert.equal(orders[0]?.tradingSession, testCase.expectedTradingSession);
      assert.equal(
        orders[0]?.includeOvernight,
        testCase.expectedIncludeOvernight,
      );
    });
  }
});

test("manual equity scan stops before work when the current session has no selected style", async () => {
  let evaluated = 0;
  let loadedSignals = 0;
  let loadedQuotes = 0;
  const { deps, calls } = buildScanDeps({
    loadDeployment: async () => ({
      ...SHADOW_DEPLOYMENT,
      config: {
        equityExecution: {
          styles: ["day", "overnight"] satisfies EquityExecutionStyle[],
          enabled: true,
          executionMode: "shadow",
        },
      },
    }),
    evaluateSignals: async () => {
      evaluated += 1;
    },
    loadSignalStates: async () => {
      loadedSignals += 1;
      return [BUY_STATE];
    },
    loadQuotes: async () => {
      loadedQuotes += 1;
      return new Map();
    },
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      forceEvaluate: true,
      runActions: true,
      now: new Date("2026-06-09T12:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.candidateCount, 0);
  assert.equal(evaluated, 0);
  assert.equal(loadedSignals, 0);
  assert.equal(loadedQuotes, 0);
  assert.equal(calls.placeShadowOrder, 0);
});

test("canonical day-only equity execution remains eligible for the worker list", () => {
  assert.equal(
    deploymentHasOvernightSpotProfile({
      ...SHADOW_DEPLOYMENT,
      config: {
        equityExecution: {
          styles: ["day"],
          enabled: true,
          executionMode: "shadow",
        },
      },
    }),
    true,
  );
});

test("overnight spot skips recording duplicate recent blocked plans", () => {
  const existing = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      plan: {
        blockers: [{ code: "overnight_spot_quote_required" }],
      },
    },
  };
  const plan = {
    status: "blocked",
    blockers: [{ code: "overnight_spot_quote_required" }],
  };

  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing,
      plan: plan as never,
    }),
    true,
  );
});

test("overnight spot suppresses an unchanged blocked plan regardless of age (no time window)", () => {
  const existing = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      plan: {
        blockers: [{ code: "overnight_spot_quote_required" }],
      },
    },
  };
  const plan = {
    status: "blocked",
    blockers: [{ code: "overnight_spot_quote_required" }],
  };

  // Even an hours-old prior block with identical codes is suppressed now that we
  // log on transition only (the 30-minute re-log window was removed).
  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing,
      plan: plan as never,
    }),
    true,
  );
});

test("overnight spot does not dedupe when blocker codes change", () => {
  const existing = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      plan: {
        blockers: [{ code: "overnight_spot_quote_required" }],
      },
    },
  };
  const plan = {
    status: "blocked",
    blockers: [{ code: "overnight_spot_spread_too_wide" }],
  };

  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing,
      plan: plan as never,
    }),
    false,
  );
});

// --- Section 6.6: writer routing (no DB) -----------------------------------
// (Covered indirectly by the scan tests below, which assert insertDiagnosticEvent
// fires for blocked/tracked and the order paths fire insertExecutionEvent.)

test("diagnostic inserts execute inside the background DB lane", async () => {
  const observedLanes: string[] = [];
  const rows = {
    then(
      resolve: (value: Array<{ id: string }>) => unknown,
      reject?: (error: unknown) => unknown,
    ) {
      observedLanes.push(currentDbLane());
      return Promise.resolve([{ id: "diagnostic-event" }]).then(resolve, reject);
    },
  };
  const fakeDb = {
    insert() {
      return {
        values() {
          return {
            returning() {
              return rows;
            },
          };
        },
      };
    },
    delete() {
      return {
        where() {
          return Promise.resolve([]);
        },
      };
    },
  };
  const restoreDb = __setDbForTests(fakeDb as never);

  try {
    await defaultOvernightSpotExecutionDependencies.insertDiagnosticEvent({
      deploymentId: SHADOW_DEPLOYMENT.id,
      providerAccountId: SHADOW_DEPLOYMENT.providerAccountId,
      symbol: "AAPL",
      eventType: "overnight_spot_signal_blocked",
      summary: "lane regression",
      payload: {},
      occurredAt: new Date("2026-07-17T12:00:00.000Z"),
    });
    assert.equal(observedLanes[0], "background");
  } finally {
    restoreDb();
  }
});

// --- Section 6.1: order idempotency across the table boundary ---------------
// A terminal order row lives in the LEDGER (execution_events). The scan must
// skip placing an order and must NOT call placeLiveOrder/placeShadowOrder.
test("scan skips placing an order when a ledger terminal event exists (idempotency across boundary)", async () => {
  const clientOrderIds: string[] = [];
  const { deps, calls } = buildScanDeps({
    // Capture the deterministic clientOrderId the scan computes, then return a
    // terminal LEDGER row for it (as the union reader would).
    findExistingEventByClientOrderId: async ({ clientOrderId }) => {
      clientOrderIds.push(clientOrderId);
      return {
        id: "ledger-live-entry",
        eventType: "overnight_spot_live_entry",
        occurredAt: new Date("2026-06-12T16:30:00.000Z"),
        payload: { clientOrderId },
      };
    },
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: true,
      marketSessionKey: "overnight",
      now: new Date("2026-06-12T17:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.status, "skipped");
  assert.equal(result.results[0]?.reason, "duplicate_client_order_id");
  assert.equal(result.results[0]?.eventType, "overnight_spot_live_entry");
  // The order MUST NOT be placed.
  assert.equal(calls.placeLiveOrder, 0);
  assert.equal(calls.placeShadowOrder, 0);
  assert.equal(calls.insertExecutionEvent, 0);
  assert.equal(calls.insertDiagnosticEvent, 0);
  assert.ok(clientOrderIds.length >= 1);
});

test("live scan writes a durable intent before broker placement and marks it filled", async () => {
  const now = new Date("2026-06-12T16:01:00.000Z");
  const { deps, calls } = buildScanDeps({
    loadDeployment: async () => LIVE_DEPLOYMENT,
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 100, ask: 100.1, mid: 100.05, updatedAt: now }],
      ]),
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: LIVE_DEPLOYMENT.id,
      runActions: true,
      marketSessionKey: "overnight",
      now,
      env: {
        PYRUS_ENABLE_LIVE_OVERNIGHT_SPOT: "1",
        PYRUS_CONFIRM_LIVE_OVERNIGHT_SPOT: OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
      },
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.status, "executed");
  assert.deepEqual(calls.sequence, [
    "insert:overnight_spot_live_order_intent",
    "placeLiveOrder",
    "insert:overnight_spot_live_entry",
    "mark:filled",
  ]);
  assert.equal(calls.placeLiveOrder, 1);
  assert.equal(calls.insertExecutionEvent, 2);
  assert.equal(calls.markLiveOrderIntent, 1);

  const intent = calls.insertedEvents[0];
  assert.equal(intent?.eventType, "overnight_spot_live_order_intent");
  assert.equal(
    (intent?.payload.intent as Record<string, unknown>)?.status,
    "pending",
  );
  assert.equal(
    calls.insertedEvents[1]?.payload.sourceIntentEventId,
    "ledger-event-1",
  );
  assert.equal(calls.markedIntents[0]?.status, "filled");
  assert.equal(calls.markedIntents[0]?.intentEvent.id, "ledger-event-1");
});

test("scan stops before shadow placement when its lease is lost after the ledger write", async () => {
  const controller = new AbortController();
  const now = new Date("2026-06-12T16:01:00.000Z");
  const { deps, calls } = buildScanDeps({
    loadDeployment: async () => ({
      ...SHADOW_DEPLOYMENT,
      config: {
        overnightSpot: {
          ...SHADOW_DEPLOYMENT.config.overnightSpot,
          defaultOrderNotional: 1_000,
          maxOrderNotional: 2_000,
          maxShareQuantity: 20,
          maxSpreadPercent: 5,
        },
      },
    }),
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 100, ask: 100.1, mid: 100.05, updatedAt: now }],
      ]),
  });
  const insertExecutionEvent = deps.insertExecutionEvent;
  deps.insertExecutionEvent = async (input) => {
    const event = await insertExecutionEvent(input);
    controller.abort(new Error("overnight lease lost"));
    return event;
  };

  await assert.rejects(
    runOvernightSpotSignalScan(
      {
        deploymentId: SHADOW_DEPLOYMENT.id,
        runActions: true,
        marketSessionKey: "overnight",
        now,
        signal: controller.signal,
      },
      deps,
    ),
    /overnight lease lost/,
  );
  assert.equal(calls.insertExecutionEvent, 1);
  assert.equal(calls.placeShadowOrder, 0);
});

test("a successor reuses the orphan shadow event after lease loss", async () => {
  const controller = new AbortController();
  const now = new Date("2026-06-12T16:01:00.000Z");
  const events = new Map<string, Record<string, unknown>>();
  const orders = new Map<string, Record<string, unknown>>();
  let abortAfterFirstWrite = true;
  const { deps } = buildScanDeps({
    loadDeployment: async () => ({
      ...SHADOW_DEPLOYMENT,
      config: {
        overnightSpot: {
          ...SHADOW_DEPLOYMENT.config.overnightSpot,
          defaultOrderNotional: 1_000,
          maxOrderNotional: 2_000,
          maxShareQuantity: 20,
          maxSpreadPercent: 5,
        },
      },
    }),
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 100, ask: 100.1, mid: 100.05, updatedAt: now }],
      ]),
    findExistingEventByClientOrderId: async ({ clientOrderId }) => {
      if (!orders.has(clientOrderId)) return null;
      return (
        [...events.values()].find(
          (event) =>
            (event.payload as Record<string, unknown> | undefined)
              ?.clientOrderId === clientOrderId,
        ) ?? null
      );
    },
    insertExecutionEvent: async (input) => {
      const id = input.id ?? `event-${events.size + 1}`;
      const existing = events.get(id);
      if (existing) return existing;
      const event = { id, ...input };
      events.set(id, event);
      if (abortAfterFirstWrite) {
        abortAfterFirstWrite = false;
        controller.abort(new Error("overnight lease lost"));
      }
      return event;
    },
    placeShadowOrder: async (order) => {
      orders.set(order.clientOrderId, order);
      return { id: "shadow-order", ...order };
    },
  });

  await assert.rejects(
    runOvernightSpotSignalScan(
      {
        deploymentId: SHADOW_DEPLOYMENT.id,
        runActions: true,
        marketSessionKey: "overnight",
        now,
        signal: controller.signal,
      },
      deps,
    ),
    /overnight lease lost/,
  );
  const retry = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: true,
      marketSessionKey: "overnight",
      now,
    },
    deps,
  );

  assert.equal(retry.results[0]?.status, "executed");
  assert.equal(events.size, 1);
  assert.equal(orders.size, 1);
});

test("live scan stops before broker placement when its lease is lost after the intent write", async () => {
  const controller = new AbortController();
  const now = new Date("2026-06-12T16:01:00.000Z");
  const { deps, calls } = buildScanDeps({
    loadDeployment: async () => LIVE_DEPLOYMENT,
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 100, ask: 100.1, mid: 100.05, updatedAt: now }],
      ]),
  });
  const insertExecutionEvent = deps.insertExecutionEvent;
  deps.insertExecutionEvent = async (input) => {
    const event = await insertExecutionEvent(input);
    if (input.eventType === "overnight_spot_live_order_intent") {
      controller.abort(new Error("overnight lease lost"));
    }
    return event;
  };

  await assert.rejects(
    runOvernightSpotSignalScan(
      {
        deploymentId: LIVE_DEPLOYMENT.id,
        runActions: true,
        marketSessionKey: "overnight",
        now,
        signal: controller.signal,
        env: {
          PYRUS_ENABLE_LIVE_OVERNIGHT_SPOT: "1",
          PYRUS_CONFIRM_LIVE_OVERNIGHT_SPOT: OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
        },
      },
      deps,
    ),
    /overnight lease lost/,
  );
  assert.deepEqual(calls.sequence, ["insert:overnight_spot_live_order_intent"]);
  assert.equal(calls.placeLiveOrder, 0);
});

test("live scan finishes durable reconciliation after broker placement has started", async () => {
  const controller = new AbortController();
  const now = new Date("2026-06-12T16:01:00.000Z");
  const { deps, calls } = buildScanDeps({
    loadDeployment: async () => LIVE_DEPLOYMENT,
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 100, ask: 100.1, mid: 100.05, updatedAt: now }],
      ]),
  });
  const placeLiveOrder = deps.placeLiveOrder;
  deps.placeLiveOrder = async (order) => {
    controller.abort(new Error("overnight lease lost"));
    return placeLiveOrder(order);
  };

  await assert.rejects(
    runOvernightSpotSignalScan(
      {
        deploymentId: LIVE_DEPLOYMENT.id,
        runActions: true,
        marketSessionKey: "overnight",
        now,
        signal: controller.signal,
        env: {
          PYRUS_ENABLE_LIVE_OVERNIGHT_SPOT: "1",
          PYRUS_CONFIRM_LIVE_OVERNIGHT_SPOT: OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
        },
      },
      deps,
    ),
    /overnight lease lost/,
  );
  assert.deepEqual(calls.sequence, [
    "insert:overnight_spot_live_order_intent",
    "placeLiveOrder",
    "insert:overnight_spot_live_entry",
    "mark:filled",
  ]);
});

test("scan flags pending live intents for reconciliation and does not double-submit", async () => {
  const clientOrderIds: string[] = [];
  const { deps, calls } = buildScanDeps({
    loadDeployment: async () => LIVE_DEPLOYMENT,
    findExistingEventByClientOrderId: async ({ clientOrderId }) => {
      clientOrderIds.push(clientOrderId);
      return {
        id: "pending-intent-event",
        eventType: "overnight_spot_live_order_intent",
        occurredAt: new Date("2026-06-12T16:00:00.000Z"),
        payload: {
          clientOrderId,
          intent: { status: "pending" },
        },
      };
    },
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: LIVE_DEPLOYMENT.id,
      runActions: true,
      marketSessionKey: "overnight",
      now: new Date("2026-06-12T16:01:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.status, "skipped");
  assert.equal(
    result.results[0]?.reason,
    "live_order_intent_reconciliation_required",
  );
  assert.equal(calls.placeLiveOrder, 0);
  assert.equal(calls.insertExecutionEvent, 0);
  assert.equal(calls.markLiveOrderIntent, 1);
  assert.equal(calls.markedIntents[0]?.status, "reconciliation_required");
  assert.equal(
    calls.markedIntents[0]?.reason,
    "live_order_intent_without_terminal_state",
  );
  assert.ok(clientOrderIds.length >= 1);
});

test("stale reconciliation cannot regress a filled live intent", async () => {
  await withTestDb(async () => {
    const pendingAt = new Date("2026-06-12T16:00:00.000Z");
    const [intentEvent] = await db
      .insert(executionEventsTable)
      .values({
        eventType: "overnight_spot_live_order_intent",
        summary: "pending live intent",
        payload: {
          clientOrderId: "stale-reconciliation-client-order",
          intent: {
            status: "pending",
            createdAt: pendingAt.toISOString(),
            updatedAt: pendingAt.toISOString(),
          },
        },
        occurredAt: pendingAt,
      })
      .returning();
    assert.ok(intentEvent);

    const terminalEventId = "33333333-3333-4333-8333-333333333333";
    const filled = await internals.markLiveOrderIntent({
      intentEvent,
      status: "filled",
      occurredAt: new Date("2026-06-12T16:01:00.000Z"),
      terminalEventId,
      terminalEventType: "overnight_spot_live_entry",
      brokerOrder: { id: "broker-order-1", status: "Filled" },
    });
    assert.ok(filled);

    const stale = await internals.markLiveOrderIntent({
      intentEvent,
      status: "reconciliation_required",
      occurredAt: new Date("2026-06-12T16:02:00.000Z"),
      reason: "stale_pending_reader",
    });
    assert.equal(stale, null);

    const [persisted] = await db
      .select()
      .from(executionEventsTable)
      .where(eq(executionEventsTable.id, intentEvent.id));
    const payload = persisted?.payload as Record<string, unknown>;
    const intent = payload.intent as Record<string, unknown>;
    assert.equal(intent.status, "filled");
    assert.equal(intent.terminalEventId, terminalEventId);
    assert.equal(intent.terminalEventType, "overnight_spot_live_entry");
    assert.deepEqual(payload.brokerOrder, {
      id: "broker-order-1",
      status: "Filled",
    });
  });
});

// --- Section 6.2: clientOrderId with BOTH a diagnostics blocked row AND a
// ledger terminal row -> merge returns the terminal (newest) -> skip. ---------
test("selectExistingEventByClientOrderId returns the newest (terminal) row across both tables", async () => {
  const clientOrderId = "deterministic-sha256";
  // Blocked row is OLDER and lives in diagnostics; terminal row is NEWER and
  // lives in the ledger. The newest (terminal) must win so a placed order
  // shadows the earlier block (no re-place).
  const blockedRow = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T16:00:00.000Z"),
    payload: { clientOrderId },
  };
  const terminalRow = {
    eventType: "overnight_spot_live_entry",
    occurredAt: new Date("2026-06-12T16:30:00.000Z"),
    payload: { clientOrderId },
  };

  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [terminalRow],
    diagnosticRows: [blockedRow],
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  assert.equal(selected?.eventType, "overnight_spot_live_entry");

  // And the idempotency predicate skips on it.
  assert.equal(
    internals.shouldSkipExistingClientOrderEvent({
      existing: selected as never,
      runActions: true,
    }),
    true,
  );
});

// --- Section 6.3: blocked-dedup across the boundary -------------------------
// The blocked marker now lives in DIAGNOSTICS. The merge must still surface it
// for shouldSkipDuplicateBlockedPlan when no terminal row exists.
test("selectExistingEventByClientOrderId surfaces a diagnostics blocked row for blocked-dedup", async () => {
  const clientOrderId = "blocked-only-id";
  const blockedRow = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T16:00:00.000Z"),
    payload: {
      clientOrderId,
      plan: { blockers: [{ code: "overnight_spot_quote_required" }] },
    },
  };

  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [],
    diagnosticRows: [blockedRow],
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  assert.equal(selected?.eventType, "overnight_spot_signal_blocked");

  // It is NOT a terminal-order event, so idempotency does not fire...
  assert.equal(
    internals.shouldSkipExistingClientOrderEvent({
      existing: selected as never,
      runActions: true,
    }),
    false,
  );
  // ...but blocked-dedup does (identical blocker codes).
  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing: selected as never,
      plan: {
        status: "blocked",
        blockers: [{ code: "overnight_spot_quote_required" }],
      } as never,
    }),
    true,
  );
});

// --- Section 6.4: pure merge helper ----------------------------------------
test("selectExistingEventByClientOrderId merges by occurred_at desc and matches payload", async () => {
  const clientOrderId = "merge-target";
  // Interleave timestamps across the two arrays; the newest matching row wins.
  const ledgerRows = [
    {
      eventType: "overnight_spot_order_failed",
      occurredAt: new Date("2026-06-12T15:00:00.000Z"),
      payload: { clientOrderId },
    },
    {
      eventType: "overnight_spot_live_entry",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: { clientOrderId },
    },
  ];
  const diagnosticRows = [
    {
      eventType: "overnight_spot_signal_blocked",
      occurredAt: new Date("2026-06-12T16:00:00.000Z"),
      payload: { clientOrderId },
    },
    {
      eventType: "overnight_spot_signal_blocked",
      occurredAt: new Date("2026-06-12T18:00:00.000Z"),
      payload: { clientOrderId: "different-id" },
    },
  ];

  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows,
    diagnosticRows,
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  // Newest row (18:00) does not match the clientOrderId; newest MATCHING is the
  // 17:00 live entry.
  assert.equal(selected?.eventType, "overnight_spot_live_entry");
});

test("selectExistingEventByClientOrderId skips a shadow event without a shadow order", async () => {
  const clientOrderId = "shadow-no-order";
  const shadowRow = {
    eventType: "overnight_spot_shadow_entry",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: { clientOrderId },
  };
  const fallbackBlocked = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T16:00:00.000Z"),
    payload: { clientOrderId },
  };

  // hasShadowOrder=false -> the shadow row is skipped, falling through to the
  // next match (the older blocked row). Matches the original behavior.
  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [shadowRow],
    diagnosticRows: [fallbackBlocked],
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  assert.equal(selected?.eventType, "overnight_spot_signal_blocked");

  // hasShadowOrder=true -> the shadow row IS the match.
  const selectedWithOrder = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [shadowRow],
    diagnosticRows: [fallbackBlocked],
    clientOrderId,
    hasShadowOrder: async () => true,
  });
  assert.equal(selectedWithOrder?.eventType, "overnight_spot_shadow_entry");
});

test("client-order lookup preserves trimmed nested legacy ids beyond newer unrelated rows", async () => {
  await withTestDb(async () => {
    const strategyId = "44444444-4444-4444-8444-444444444444";
    const deploymentId = "55555555-5555-4555-8555-555555555555";
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Overnight idempotency test",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Overnight idempotency test",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["AAPL"],
      config: {},
    });

    const clientOrderId = "older-than-one-thousand-newer-rows";
    const baseMs = new Date("2026-06-12T16:00:00.000Z").getTime();
    await db.insert(executionEventsTable).values([
      {
        deploymentId,
        eventType: "overnight_spot_live_entry",
        summary: "target ledger row",
        payload: {
          clientOrderId: "\t\n",
          plan: { clientOrderId: `\u00a0${clientOrderId}\u2009` },
        },
        occurredAt: new Date(baseMs),
      },
      ...Array.from({ length: 1_000 }, (_, index) => ({
        deploymentId,
        eventType: "overnight_spot_signal_tracked",
        summary: `newer ledger noise ${index}`,
        payload: { clientOrderId: `ledger-noise-${index}` },
        occurredAt: new Date(baseMs + index + 1),
      })),
    ]);

    const selectedLedger =
      await defaultOvernightSpotExecutionDependencies.findExistingEventByClientOrderId(
        { deploymentId, clientOrderId },
      );
    assert.equal(selectedLedger?.eventType, "overnight_spot_live_entry");

    await db.insert(automationDiagnosticsTable).values([
      {
        deploymentId,
        eventType: "overnight_spot_signal_blocked",
        summary: "newer target diagnostic row",
        payload: {
          clientOrderId: "\r\t",
          order: { clientOrderId: `\u202f${clientOrderId}\ufeff` },
        },
        occurredAt: new Date(baseMs + 2_000),
      },
      ...Array.from({ length: 1_000 }, (_, index) => ({
        deploymentId,
        eventType: "overnight_spot_signal_tracked",
        summary: `newer diagnostic noise ${index}`,
        payload: { clientOrderId: `diagnostic-noise-${index}` },
        occurredAt: new Date(baseMs + 2_001 + index),
      })),
    ]);

    const selected =
      await defaultOvernightSpotExecutionDependencies.findExistingEventByClientOrderId(
        { deploymentId, clientOrderId },
      );
    assert.equal(selected?.eventType, "overnight_spot_signal_blocked");
  });
});

// --- Section 6.6 (direct): writer routing via the scan ---------------------
// A ready plan in shadow mode places a shadow order and writes the shadow
// execution event to the LEDGER (insertExecutionEvent), NOT diagnostics.
test("scan routes shadow execution events to the ledger, not diagnostics", async () => {
  const { deps, calls } = buildScanDeps();
  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: true,
      marketSessionKey: "overnight",
      now: new Date("2026-06-12T17:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  // Either executed (ready) or blocked depending on plan gating; in both cases
  // assert the routing invariant holds for whatever was written.
  if (result.results[0]?.status === "executed") {
    assert.equal(calls.placeShadowOrder, 1);
    assert.equal(calls.insertExecutionEvent, 1);
    assert.equal(calls.insertDiagnosticEvent, 0);
  } else if (result.results[0]?.status === "blocked") {
    // A blocked plan writes the blocked telemetry to DIAGNOSTICS.
    assert.equal(calls.placeShadowOrder, 0);
    assert.equal(calls.insertExecutionEvent, 0);
    assert.equal(calls.insertDiagnosticEvent, 1);
  } else {
    assert.fail(`unexpected status ${result.results[0]?.status}`);
  }
});

// A tracked plan (runActions=false, recordSignals=true) writes the tracked
// telemetry to DIAGNOSTICS, never the ledger, and never places an order.
test("scan routes tracked telemetry to diagnostics and places no order", async () => {
  const { deps, calls } = buildScanDeps();
  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: false,
      recordSignals: true,
      marketSessionKey: "overnight",
      now: new Date("2026-06-12T17:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  // With runActions=false a ready plan is "tracked"; a blocked plan is "blocked".
  // Both moved types route to diagnostics; no order is placed either way.
  assert.equal(calls.placeLiveOrder, 0);
  assert.equal(calls.placeShadowOrder, 0);
  assert.equal(calls.insertExecutionEvent, 0);
  assert.equal(calls.insertDiagnosticEvent, 1);
  assert.ok(
    result.results[0]?.status === "tracked" ||
      result.results[0]?.status === "blocked",
  );
});

// --- Section 6.6: automation_diagnostics 7-day retention prune ---------------
const HOUR_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * HOUR_MS;

test("computeAutomationDiagnosticsPrune throttles within the hour and cuts at 7 days", () => {
  const now = new Date("2026-06-24T12:00:00.000Z").getTime();

  // Pruned 10 min ago -> skip.
  assert.equal(
    internals.computeAutomationDiagnosticsPrune(now, now - 10 * 60 * 1000)
      .shouldPrune,
    false,
  );

  // Never pruned, or > 1h ago, or exactly at the 1h boundary -> prune, cutoff = now - 7d.
  for (const lastPruneMs of [0, now - 2 * HOUR_MS, now - HOUR_MS]) {
    const decision = internals.computeAutomationDiagnosticsPrune(
      now,
      lastPruneMs,
    );
    assert.equal(decision.shouldPrune, true);
    assert.equal(decision.cutoff.getTime(), now - SEVEN_DAYS_MS);
  }
});

test("pruneAutomationDiagnostics deletes when due, throttles repeats, advances the window", async () => {
  internals.resetAutomationDiagnosticsPruneForTests();
  const cutoffs: Date[] = [];
  const del = async (cutoff: Date) => {
    cutoffs.push(cutoff);
  };
  // First call (module state starts at 0) is always due.
  const t0 = new Date("2026-07-01T00:00:00.000Z");
  await internals.pruneAutomationDiagnostics(t0, del);
  assert.equal(cutoffs.length, 1);
  assert.equal(cutoffs[0]?.getTime(), t0.getTime() - SEVEN_DAYS_MS);

  // 5 min later -> throttled, no delete.
  await internals.pruneAutomationDiagnostics(
    new Date(t0.getTime() + 5 * 60 * 1000),
    del,
  );
  assert.equal(cutoffs.length, 1);

  // 61 min later -> due again, cutoff tracks the new now.
  const t2 = new Date(t0.getTime() + 61 * 60 * 1000);
  await internals.pruneAutomationDiagnostics(t2, del);
  assert.equal(cutoffs.length, 2);
  assert.equal(cutoffs[1]?.getTime(), t2.getTime() - SEVEN_DAYS_MS);
  internals.resetAutomationDiagnosticsPruneForTests();
});
