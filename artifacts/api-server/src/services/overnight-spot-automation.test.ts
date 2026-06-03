import assert from "node:assert/strict";
import test from "node:test";
import type { PyrusSignalsSignalEvent } from "@workspace/pyrus-signals-core";
import {
  OVERNIGHT_SPOT_LIVE_CONFIRM_ENV,
  OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
  OVERNIGHT_SPOT_LIVE_ENABLE_ENV,
  buildOvernightSpotClientOrderId,
  buildOvernightSpotExecutionEventDraft,
  overnightSpotSignalFromPyrus,
  planOvernightSpotOrder,
  resolveOvernightSpotProfile,
  type OvernightSpotProfile,
} from "./overnight-spot-automation";

const now = new Date("2026-06-03T02:30:00.000Z");

function profile(
  patch: Partial<OvernightSpotProfile> = {},
): OvernightSpotProfile {
  return {
    ...resolveOvernightSpotProfile({
      config: {
        overnightSpot: {
          enabled: true,
          executionMode: "shadow",
          accountId: "DU1234567",
          defaultOrderNotional: 1_000,
          maxOrderNotional: 1_500,
          maxShareQuantity: 10,
        },
      },
    }),
    ...patch,
  };
}

function quote(patch = {}) {
  return {
    bid: 100,
    ask: 100.1,
    mid: 100.05,
    updatedAt: now,
    freshness: "live",
    marketDataMode: "live",
    ...patch,
  };
}

function pyrusSignal(
  patch: Partial<PyrusSignalsSignalEvent> = {},
): PyrusSignalsSignalEvent {
  return {
    id: "sig-1",
    eventType: "buy_signal",
    direction: "long",
    barIndex: 42,
    time: now.getTime(),
    ts: now.toISOString(),
    price: 100,
    close: 100,
    actionable: true,
    filtered: false,
    filterState: {
      enabled: true,
      direction: 1,
      mtfDirections: [1, 1, 1],
      adx: 32,
      volatilityScore: 0.5,
      sessionKey: "asia",
      mtfPass: [true, true, true],
      adxPass: true,
      volatilityPass: true,
      sessionPass: true,
      passes: true,
    },
    ...patch,
  };
}

test("overnight spot profile defaults are disabled and capless", () => {
  const resolved = resolveOvernightSpotProfile();

  assert.equal(resolved.enabled, false);
  assert.equal(resolved.executionMode, "disabled");
  assert.equal(resolved.tradingSession, "overnight");
  assert.equal(resolved.maxOrderNotional, 0);
  assert.equal(resolved.maxShareQuantity, 0);
});

test("Pyrus buy signals become long-only overnight spot entries", () => {
  const signal = overnightSpotSignalFromPyrus({
    symbol: "spy",
    signal: pyrusSignal(),
  });

  assert.equal(signal.symbol, "SPY");
  assert.equal(signal.side, "buy");
  assert.equal(signal.stage, "entry");
  assert.equal(signal.actionable, true);
  assert.equal(signal.source, "pyrus");
});

test("builds a shadow IBKR overnight stock limit order from an actionable Pyrus signal", () => {
  const signal = overnightSpotSignalFromPyrus({
    symbol: "SPY",
    signal: pyrusSignal(),
  });
  const result = planOvernightSpotOrder({
    profile: profile(),
    deploymentId: "deployment-1",
    deploymentMode: "paper",
    signal,
    quote: quote(),
    now,
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") {
    return;
  }

  assert.equal(result.order.accountId, "DU1234567");
  assert.equal(result.order.mode, "paper");
  assert.equal(result.order.assetClass, "equity");
  assert.equal(result.order.type, "limit");
  assert.equal(result.order.timeInForce, "day");
  assert.equal(result.order.tradingSession, "overnight");
  assert.equal(result.order.includeOvernight, true);
  assert.equal(result.order.optionContract, null);
  assert.equal(result.order.source, "automation");
  assert.equal(result.order.quantity, 9);
  assert.equal(result.order.limitPrice, 100.16);
  assert.match(result.clientOrderId, /^overnight-spot-spy-entry-buy-/);
  assert.equal(result.facts.optionsUnsupported, true);
  assert.equal(result.facts.primaryExchangeResolvedByBridge, true);
});

test("live mode remains blocked without deployment and environment gates", () => {
  const result = planOvernightSpotOrder({
    profile: profile({ executionMode: "live" }),
    deploymentId: "deployment-1",
    deploymentMode: "paper",
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
    }),
    quote: quote(),
    now,
    env: {},
  });

  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") {
    return;
  }
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.code),
    [
      "overnight_spot_live_deployment_required",
      "overnight_spot_live_env_disabled",
      "overnight_spot_live_env_unconfirmed",
    ],
  );
});

test("live mode builds confirmed live requests only when explicit env gates are set", () => {
  const result = planOvernightSpotOrder({
    profile: profile({ executionMode: "live" }),
    deploymentId: "deployment-1",
    deploymentMode: "live",
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
    }),
    quote: quote(),
    now,
    env: {
      [OVERNIGHT_SPOT_LIVE_ENABLE_ENV]: "1",
      [OVERNIGHT_SPOT_LIVE_CONFIRM_ENV]: OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") {
    return;
  }
  assert.equal(result.order.mode, "live");
  assert.equal(result.order.confirm, true);
  assert.equal(result.eventType, "overnight_spot_live_entry");
});

test("long-only policy allows exits only against an existing long position", () => {
  const sellSignal = overnightSpotSignalFromPyrus({
    symbol: "SPY",
    signal: pyrusSignal({
      id: "sig-sell",
      eventType: "sell_signal",
      direction: "short",
    }),
    quantity: 2,
  });

  const missingPosition = planOvernightSpotOrder({
    profile: profile(),
    signal: sellSignal,
    quote: quote(),
    existingPositionQuantity: 0,
    now,
  });
  assert.equal(missingPosition.status, "blocked");
  if (missingPosition.status === "blocked") {
    assert.ok(
      missingPosition.blockers.some(
        (blocker) => blocker.code === "overnight_spot_exit_position_required",
      ),
    );
  }

  const readyExit = planOvernightSpotOrder({
    profile: profile(),
    signal: sellSignal,
    quote: quote(),
    existingPositionQuantity: 5,
    now,
  });
  assert.equal(readyExit.status, "ready");
  if (readyExit.status === "ready") {
    assert.equal(readyExit.order.side, "sell");
    assert.equal(readyExit.order.quantity, 2);
  }
});

test("long-only policy blocks duplicate entries when a long position is already open", () => {
  const result = planOvernightSpotOrder({
    profile: profile(),
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
    }),
    quote: quote(),
    existingPositionQuantity: 3,
    now,
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.ok(
      result.blockers.some(
        (blocker) =>
          blocker.code === "overnight_spot_same_direction_position_open",
      ),
    );
  }
});

test("stale quotes and wide overnight spreads block orders", () => {
  const stale = planOvernightSpotOrder({
    profile: profile(),
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
    }),
    quote: quote({ updatedAt: new Date(now.getTime() - 60_000) }),
    now,
  });
  assert.equal(stale.status, "blocked");
  if (stale.status === "blocked") {
    assert.ok(
      stale.blockers.some(
        (blocker) => blocker.code === "overnight_spot_quote_stale",
      ),
    );
  }

  const wide = planOvernightSpotOrder({
    profile: profile(),
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
    }),
    quote: quote({ bid: 98, ask: 102 }),
    now,
  });
  assert.equal(wide.status, "blocked");
  if (wide.status === "blocked") {
    assert.ok(
      wide.blockers.some(
        (blocker) => blocker.code === "overnight_spot_spread_too_wide",
      ),
    );
  }
});

test("requested orders over configured caps are blocked instead of resized", () => {
  const result = planOvernightSpotOrder({
    profile: profile({ maxShareQuantity: 1, maxOrderNotional: 150 }),
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
      quantity: 2,
    }),
    quote: quote(),
    now,
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.ok(
      result.blockers.some(
        (blocker) => blocker.code === "overnight_spot_quantity_cap_exceeded",
      ),
    );
    assert.ok(
      result.blockers.some(
        (blocker) => blocker.code === "overnight_spot_notional_cap_exceeded",
      ),
    );
  }
});

test("client order ids are stable for the same deployment signal tuple", () => {
  const first = buildOvernightSpotClientOrderId({
    deploymentId: "deployment-1",
    symbol: "SPY",
    side: "buy",
    stage: "entry",
    signalId: "sig-1",
    signalAt: now,
  });
  const second = buildOvernightSpotClientOrderId({
    deploymentId: "deployment-1",
    symbol: "spy",
    side: "buy",
    stage: "entry",
    signalId: "sig-1",
    signalAt: now,
  });

  assert.equal(first, second);
});

test("ready plans can be converted into automation execution event drafts", () => {
  const result = planOvernightSpotOrder({
    profile: profile(),
    deploymentId: "deployment-1",
    signal: overnightSpotSignalFromPyrus({
      symbol: "SPY",
      signal: pyrusSignal(),
    }),
    quote: quote(),
    now,
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") {
    return;
  }

  const draft = buildOvernightSpotExecutionEventDraft(result, {
    deploymentId: "deployment-1",
    occurredAt: now,
  });

  assert.equal(draft.deploymentId, "deployment-1");
  assert.equal(draft.providerAccountId, "DU1234567");
  assert.equal(draft.symbol, "SPY");
  assert.equal(draft.eventType, "overnight_spot_shadow_entry");
  assert.equal(draft.occurredAt, now);
});
