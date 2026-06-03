import assert from "node:assert/strict";
import test from "node:test";
import {
  runOvernightSpotSignalScan,
  type OvernightSpotExecutionDependencies,
  type OvernightSpotSignalState,
} from "./overnight-spot-execution";

const now = new Date("2026-06-03T02:30:00.000Z");

function deployment(patch: Record<string, unknown> = {}) {
  return {
    id: "deployment-1",
    name: "Overnight Spot",
    mode: "paper" as const,
    enabled: true,
    providerAccountId: "DU1234567",
    symbolUniverse: ["SPY"],
    config: {
      parameters: {
        signalTimeframe: "15m",
      },
      overnightSpot: {
        enabled: true,
        executionMode: "shadow",
        accountId: "DU1234567",
        defaultOrderNotional: 1_000,
        maxOrderNotional: 1_500,
        maxShareQuantity: 10,
      },
    },
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function signalState(
  patch: Partial<OvernightSpotSignalState> = {},
): OvernightSpotSignalState {
  return {
    profileId: "profile-1",
    symbol: "SPY",
    timeframe: "15m",
    currentSignalDirection: "buy",
    currentSignalAt: now,
    currentSignalPrice: 100,
    fresh: true,
    status: "ok",
    barsSinceSignal: 0,
    latestBarAt: now,
    lastEvaluatedAt: now,
    ...patch,
  };
}

function quote() {
  return {
    symbol: "SPY",
    bid: 100,
    ask: 100.1,
    mid: 100.05,
    updatedAt: now,
  };
}

function createDependencies(overrides: Partial<OvernightSpotExecutionDependencies> = {}) {
  const events: Array<Record<string, any>> = [];
  const shadowOrders: Array<Record<string, any>> = [];
  const liveOrders: Array<Record<string, any>> = [];
  const evaluated: string[] = [];
  const notified: Array<Record<string, unknown>> = [];

  const dependencies: OvernightSpotExecutionDependencies = {
    loadDeployment: async () => deployment(),
    evaluateSignals: async (input) => {
      evaluated.push(input.deploymentId);
    },
    loadSignalStates: async () => [signalState()],
    loadQuotes: async () => new Map([["SPY", quote()]]),
    loadPositionQuantities: async () => new Map(),
    findExistingEventByClientOrderId: async () => null,
    insertExecutionEvent: async (input) => {
      const event = {
        id: `event-${events.length + 1}`,
        ...input,
      };
      events.push(event);
      return event;
    },
    placeShadowOrder: async (order) => {
      shadowOrders.push(order);
      return { id: `shadow-${shadowOrders.length}`, status: "filled" };
    },
    placeLiveOrder: async (order) => {
      liveOrders.push(order);
      return { id: `live-${liveOrders.length}`, status: "submitted" };
    },
    notifyChanged: (input) => {
      notified.push(input);
    },
    ...overrides,
  };

  return { dependencies, events, shadowOrders, liveOrders, evaluated, notified };
}

test("overnight spot scan tracks current signals without executing by default", async () => {
  const { dependencies, events, shadowOrders, evaluated } = createDependencies();

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: "deployment-1",
      forceEvaluate: true,
      runActions: false,
      now,
    },
    dependencies,
  );

  assert.deepEqual(evaluated, ["deployment-1"]);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.trackedCount, 1);
  assert.equal(result.executedCount, 0);
  assert.equal(shadowOrders.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "overnight_spot_signal_tracked");
  assert.match(String(events[0].payload.clientOrderId), /^overnight-spot-spy-entry-buy-/);
  assert.equal(events[0].payload.plan.status, "ready");
});
test("overnight spot scan executes shadow orders only when actions are requested", async () => {
  const { dependencies, events, shadowOrders } = createDependencies();

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: "deployment-1",
      runActions: true,
      now,
    },
    dependencies,
  );

  assert.equal(result.executedCount, 1);
  assert.equal(result.trackedCount, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "overnight_spot_shadow_entry");
  assert.equal(shadowOrders.length, 1);
  assert.equal(shadowOrders[0].source, "automation");
  assert.equal(shadowOrders[0].sourceEventId, "event-1");
  assert.equal(shadowOrders[0].tradingSession, "overnight");
  assert.equal(shadowOrders[0].includeOvernight, true);
});

test("overnight spot scan skips duplicate signal tuples by client order id", async () => {
  const { dependencies, events, shadowOrders } = createDependencies({
    findExistingEventByClientOrderId: async (input) => ({
      id: "existing-event",
      eventType: "overnight_spot_shadow_entry",
      clientOrderId: input.clientOrderId,
    }),
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: "deployment-1",
      runActions: true,
      now,
    },
    dependencies,
  );

  assert.equal(result.skippedCount, 1);
  assert.equal(result.executedCount, 0);
  assert.equal(result.trackedCount, 0);
  assert.equal(events.length, 0);
  assert.equal(shadowOrders.length, 0);
});

test("overnight spot scan records blocked exit signals without sending orders", async () => {
  const { dependencies, events, shadowOrders } = createDependencies({
    loadSignalStates: async () => [
      signalState({
        currentSignalDirection: "sell",
      }),
    ],
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: "deployment-1",
      runActions: true,
      now,
    },
    dependencies,
  );

  assert.equal(result.blockedCount, 1);
  assert.equal(result.executedCount, 0);
  assert.equal(shadowOrders.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "overnight_spot_signal_blocked");
  assert.deepEqual(
    events[0].payload.plan.blockers.map((blocker: { code: string }) => blocker.code),
    ["overnight_spot_exit_position_required"],
  );
});
