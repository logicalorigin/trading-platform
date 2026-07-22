import assert from "node:assert/strict";
import test from "node:test";

import * as signalMonitorStoreModule from "./signalMonitorStore.js";
import {
  __signalMonitorStoreTestHooks,
  getSignalMonitorBroadcastSnapshotForTests,
  getSignalMonitorSnapshotForTests,
  publishSignalMonitorSnapshot,
  resetSignalMonitorStoreForTests,
  selectPreferredSignalMonitorState,
  subscribeToSignalMonitorBroadcastSnapshotForTests,
  subscribeToSignalMonitorSnapshotForTests,
} from "./signalMonitorStore.js";

const makeSignalState = (symbol, overrides = {}) => ({
  symbol,
  timeframe: "5m",
  currentSignalDirection: "bullish",
  currentSignalAt: "2026-06-09T14:00:00.000Z",
  currentSignalPrice: 100,
  latestBarAt: "2026-06-09T14:05:00.000Z",
  barsSinceSignal: 1,
  fresh: true,
  status: "ok",
  lastEvaluatedAt: "2026-06-09T14:05:10.000Z",
  ...overrides,
});

const publishStates = (states) => {
  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states,
    events: [],
    universe: null,
    pending: false,
  });
};

test("preferred symbol state uses backend actionability, not the fresh flag", () => {
  // Same symbol, no preferred-timeframe match: the backend-actionable state
  // wins even when the other copy claims fresh and newer activity.
  const eligible = makeSignalState("AAPL", {
    timeframe: "15m",
    fresh: false,
    actionEligible: true,
    lastEvaluatedAt: "2026-06-09T14:05:10.000Z",
  });
  const freshButIneligible = makeSignalState("AAPL", {
    timeframe: "1h",
    fresh: true,
    actionEligible: false,
    lastEvaluatedAt: "2026-06-09T14:06:10.000Z",
  });

  assert.equal(
    selectPreferredSignalMonitorState(freshButIneligible, eligible, ""),
    eligible,
  );
  assert.equal(
    selectPreferredSignalMonitorState(eligible, freshButIneligible, ""),
    eligible,
  );
});

test("degraded snapshots replace prior states and events", () => {
  resetSignalMonitorStoreForTests();
  try {
    publishStates([makeSignalState("AAPL")]);
    assert.equal(getSignalMonitorSnapshotForTests().states.length, 1);

    // Outages stay explicit; prior data must not remain as a fallback screen.
    publishSignalMonitorSnapshot({
      profile: { timeframe: "5m" },
      states: [],
      events: [],
      universe: null,
      pending: false,
      degraded: true,
    });
    const degraded = getSignalMonitorSnapshotForTests();
    assert.equal(degraded.degraded, true);
    assert.deepEqual(degraded.states, []);
    assert.deepEqual(degraded.events, []);

    // Recovery with real data replaces the outage snapshot.
    publishStates([makeSignalState("MSFT")]);
    const recovered = getSignalMonitorSnapshotForTests();
    assert.equal(recovered.degraded, false);
    assert.equal(recovered.states[0].symbol, "MSFT");
  } finally {
    resetSignalMonitorStoreForTests();
  }
});

test("signal monitor symbol versions are pruned after a symbol leaves the snapshot", () => {
  resetSignalMonitorStoreForTests();

  publishStates([makeSignalState("AAPL")]);

  assert.equal(__signalMonitorStoreTestHooks.symbolVersionCount(), 1);
  assert.equal(__signalMonitorStoreTestHooks.symbolVersion("aapl"), 1);

  publishStates([]);

  assert.equal(__signalMonitorStoreTestHooks.symbolVersion("AAPL"), 0);
  assert.equal(__signalMonitorStoreTestHooks.symbolVersionCount(), 0);
});

test("signal monitor symbol listeners still observe removal and re-entry after pruning", () => {
  resetSignalMonitorStoreForTests();
  let calls = 0;
  const unsubscribe = __signalMonitorStoreTestHooks.subscribeSymbol("msft", () => {
    calls += 1;
  });

  try {
    publishStates([makeSignalState("MSFT")]);
    assert.equal(calls, 1);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersion("MSFT"), 1);

    publishStates([]);
    assert.equal(calls, 2);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersion("MSFT"), 0);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersionCount(), 0);

    publishStates([
      makeSignalState("MSFT", {
        currentSignalAt: "2026-06-09T14:10:00.000Z",
        latestBarAt: "2026-06-09T14:15:00.000Z",
        lastEvaluatedAt: "2026-06-09T14:15:10.000Z",
      }),
    ]);
    assert.equal(calls, 3);
    assert.equal(__signalMonitorStoreTestHooks.symbolVersion("MSFT"), 1);
  } finally {
    unsubscribe();
    resetSignalMonitorStoreForTests();
  }
});

test("action eligibility changes notify global and symbol subscribers", () => {
  resetSignalMonitorStoreForTests();
  let globalCalls = 0;
  let symbolCalls = 0;

  publishStates([
    makeSignalState("AAPL", {
      actionEligible: true,
      actionBlocker: null,
    }),
  ]);
  const unsubscribeGlobal = subscribeToSignalMonitorSnapshotForTests(() => {
    globalCalls += 1;
  });
  const unsubscribeSymbol = __signalMonitorStoreTestHooks.subscribeSymbol(
    "AAPL",
    () => {
      symbolCalls += 1;
    },
  );

  try {
    publishStates([
      makeSignalState("AAPL", {
        actionEligible: false,
        actionBlocker: "data_stale",
      }),
    ]);

    assert.equal(globalCalls, 1);
    assert.equal(symbolCalls, 1);
    assert.equal(
      getSignalMonitorSnapshotForTests().states[0].actionEligible,
      false,
    );
  } finally {
    unsubscribeGlobal();
    unsubscribeSymbol();
    resetSignalMonitorStoreForTests();
  }
});

test("action blocker reason changes notify global and symbol subscribers", () => {
  resetSignalMonitorStoreForTests();
  let globalCalls = 0;
  let symbolCalls = 0;

  publishStates([
    makeSignalState("MSFT", {
      actionEligible: false,
      actionBlocker: "data_stale",
    }),
  ]);
  const unsubscribeGlobal = subscribeToSignalMonitorSnapshotForTests(() => {
    globalCalls += 1;
  });
  const unsubscribeSymbol = __signalMonitorStoreTestHooks.subscribeSymbol(
    "MSFT",
    () => {
      symbolCalls += 1;
    },
  );

  try {
    publishStates([
      makeSignalState("MSFT", {
        actionEligible: false,
        actionBlocker: "market_idle",
      }),
    ]);

    assert.equal(globalCalls, 1);
    assert.equal(symbolCalls, 1);
    assert.equal(
      getSignalMonitorSnapshotForTests().states[0].actionBlocker,
      "market_idle",
    );
  } finally {
    unsubscribeGlobal();
    unsubscribeSymbol();
    resetSignalMonitorStoreForTests();
  }
});

test("last error changes notify canonical global and symbol subscribers", () => {
  resetSignalMonitorStoreForTests();
  let globalCalls = 0;
  let symbolCalls = 0;

  publishStates([makeSignalState("NVDA", { lastError: null })]);
  const unsubscribeGlobal = subscribeToSignalMonitorSnapshotForTests(() => {
    globalCalls += 1;
  });
  const unsubscribeSymbol = __signalMonitorStoreTestHooks.subscribeSymbol(
    "NVDA",
    () => {
      symbolCalls += 1;
    },
  );

  try {
    publishStates([
      makeSignalState("NVDA", { lastError: "bars unavailable" }),
    ]);

    assert.equal(globalCalls, 1);
    assert.equal(symbolCalls, 1);
    assert.equal(
      getSignalMonitorSnapshotForTests().states[0].lastError,
      "bars unavailable",
    );
  } finally {
    unsubscribeGlobal();
    unsubscribeSymbol();
    resetSignalMonitorStoreForTests();
  }
});

test("broadcast subscribers ignore evaluation churn that cannot change the header", () => {
  resetSignalMonitorStoreForTests();
  let broadcastCalls = 0;
  let globalCalls = 0;

  publishStates([
    makeSignalState("AAPL", {
      currentSignalMfePercent: 1.2,
      currentSignalMaePercent: -0.4,
      filterState: { ribbon: "bullish", strength: 1 },
      indicatorSnapshot: {
        trendDirection: "bullish",
        emaFast: 100,
      },
    }),
  ]);
  const unsubscribeBroadcast =
    subscribeToSignalMonitorBroadcastSnapshotForTests(() => {
      broadcastCalls += 1;
    });
  const unsubscribeGlobal = subscribeToSignalMonitorSnapshotForTests(() => {
    globalCalls += 1;
  });

  try {
    publishStates([
      makeSignalState("AAPL", {
        lastEvaluatedAt: "2026-06-09T14:05:15.000Z",
        latestBarAt: "2026-06-09T14:05:05.000Z",
        currentSignalMfePercent: 1.3,
        currentSignalMaePercent: -0.3,
        filterState: { ribbon: "bullish", strength: 2 },
        indicatorSnapshot: {
          trendDirection: "bullish",
          emaFast: 101,
        },
      }),
    ]);

    assert.equal(broadcastCalls, 0);
    assert.equal(globalCalls, 1);
    assert.equal(
      getSignalMonitorSnapshotForTests().states[0].lastEvaluatedAt,
      "2026-06-09T14:05:15.000Z",
    );
    assert.equal(
      getSignalMonitorBroadcastSnapshotForTests().states[0].lastEvaluatedAt,
      "2026-06-09T14:05:10.000Z",
    );
  } finally {
    unsubscribeBroadcast();
    unsubscribeGlobal();
    resetSignalMonitorStoreForTests();
  }
});

test("broadcast state retention preserves identity until a rendered field changes", () => {
  const retainEquivalentSignalBroadcastStates =
    signalMonitorStoreModule.retainEquivalentSignalBroadcastStates;
  assert.equal(typeof retainEquivalentSignalBroadcastStates, "function");

  const current = [makeSignalState("MSFT")];
  const bookkeepingOnly = [
    makeSignalState("MSFT", {
      lastEvaluatedAt: "2026-06-09T14:05:15.000Z",
      currentSignalMfePercent: 2.1,
    }),
  ];
  const priceChanged = [
    makeSignalState("MSFT", {
      currentSignalPrice: 101,
    }),
  ];

  assert.equal(
    retainEquivalentSignalBroadcastStates(current, bookkeepingOnly),
    current,
  );
  assert.equal(
    retainEquivalentSignalBroadcastStates(current, priceChanged),
    priceChanged,
  );
});

test("intermediate canonical bootstrap pages do not notify a retained header projection", () => {
  resetSignalMonitorStoreForTests();
  let broadcastCalls = 0;
  let globalCalls = 0;
  const aapl = makeSignalState("AAPL");

  publishSignalMonitorSnapshot({
    profile: { timeframe: "5m" },
    states: [aapl],
    broadcastStates: [aapl],
  });
  const unsubscribeBroadcast =
    subscribeToSignalMonitorBroadcastSnapshotForTests(() => {
      broadcastCalls += 1;
    });
  const unsubscribeGlobal = subscribeToSignalMonitorSnapshotForTests(() => {
    globalCalls += 1;
  });

  try {
    publishSignalMonitorSnapshot({
      profile: { timeframe: "5m" },
      states: [aapl, makeSignalState("MSFT")],
      broadcastStates: [makeSignalState("AAPL")],
    });
    assert.equal(globalCalls, 1);
    assert.equal(broadcastCalls, 0);

    publishSignalMonitorSnapshot({
      profile: { timeframe: "5m" },
      states: [aapl, makeSignalState("MSFT")],
      broadcastStates: [
        makeSignalState("AAPL", { currentSignalPrice: 101 }),
      ],
    });
    assert.equal(broadcastCalls, 1);
  } finally {
    unsubscribeBroadcast();
    unsubscribeGlobal();
    resetSignalMonitorStoreForTests();
  }
});

test("profile evaluation metadata does not wake the closed header subscriber", () => {
  resetSignalMonitorStoreForTests();
  let broadcastCalls = 0;
  let globalCalls = 0;
  const states = [makeSignalState("AAPL")];

  publishSignalMonitorSnapshot({
    profile: {
      id: "profile-1",
      timeframe: "5m",
      updatedAt: "2026-07-17T12:00:00.000Z",
      lastEvaluatedAt: "2026-07-17T12:00:00.000Z",
    },
    states,
    broadcastStates: states,
  });
  const unsubscribeBroadcast =
    subscribeToSignalMonitorBroadcastSnapshotForTests(() => {
      broadcastCalls += 1;
    });
  const unsubscribeGlobal = subscribeToSignalMonitorSnapshotForTests(() => {
    globalCalls += 1;
  });

  try {
    publishSignalMonitorSnapshot({
      profile: {
        id: "profile-1",
        timeframe: "5m",
        updatedAt: "2026-07-17T12:01:00.000Z",
        lastEvaluatedAt: "2026-07-17T12:01:00.000Z",
      },
      states,
      broadcastStates: states,
    });
    assert.equal(globalCalls, 1);
    assert.equal(broadcastCalls, 0);
  } finally {
    unsubscribeBroadcast();
    unsubscribeGlobal();
    resetSignalMonitorStoreForTests();
  }
});
