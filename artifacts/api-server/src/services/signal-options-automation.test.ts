import assert from "node:assert/strict";
import test from "node:test";

import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";

const signalState = (
  symbol: string,
  signalAt: string,
  direction: "buy" | "sell" = "buy",
) =>
  ({
    id: `${symbol}:5m`,
    profileId: "paper-profile",
    symbol,
    timeframe: "5m",
    currentSignalDirection: direction,
    currentSignalAt: signalAt,
    currentSignalPrice: 100,
    latestBarAt: signalAt,
    barsSinceSignal: 0,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: signalAt,
    lastError: null,
  }) as never;

test("Signal Options cockpit treats after-hours execution gate as info", () => {
  const items = __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
    deployment: {
      lastError: null,
      lastEvaluatedAt: null,
      updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    },
    readiness: {
      ready: false,
      reason: "market_session_quiet",
      message: "Options strategy execution is outside the regular options session.",
      diagnostics: {},
    },
    candidates: [],
    activePositions: [],
    risk: {},
    events: [],
  } as never);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "gateway-readiness");
  assert.equal(items[0].severity, "info");
  assert.equal(items[0].summary, "Options session is closed.");
});

test("Signal Options cockpit keeps real gateway failures as warnings", () => {
  const items = __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
    deployment: {
      lastError: null,
      lastEvaluatedAt: null,
      updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    },
    readiness: {
      ready: false,
      reason: "gateway_login_required",
      message: "IB Gateway is connected, but the broker session is not authenticated.",
      diagnostics: {},
    },
    candidates: [],
    activePositions: [],
    risk: {},
    events: [],
  } as never);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "gateway-readiness");
  assert.equal(items[0].severity, "warning");
});

test("Signal Options MTF matrix symbols follow cursor, seen set, and worker cap", () => {
  const states = [
    signalState("SPY", "2026-06-08T14:20:00.000Z"),
    signalState("AAPL", "2026-06-08T14:19:00.000Z"),
    signalState("MSFT", "2026-06-08T14:18:00.000Z", "sell"),
    signalState("TSLA", "2026-06-08T14:17:00.000Z"),
  ];
  const seenSignals = new Set([
    __signalOptionsAutomationInternalsForTests.buildSignalKey(
      states[1],
      "2026-06-08T14:19:00.000Z",
    ),
  ]);

  assert.deepEqual(
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsMtfMatrixSymbols({
      states,
      universe: new Set(["SPY", "AAPL", "MSFT", "TSLA"]),
      seenSignals,
      startIndex: 1,
      maxSymbols: 2,
    }),
    ["MSFT", "TSLA"],
  );
});

test("Signal Options action states stay on configured execution timeframe", () => {
  const states = [
    {
      ...(signalState("SPY", "2026-06-08T18:31:00.000Z") as Record<
        string,
        unknown
      >),
      id: "SPY:2m",
      timeframe: "2m",
      barsSinceSignal: 1,
    },
    {
      ...(signalState(
        "SPY",
        "2026-06-08T16:35:00.000Z",
        "sell",
      ) as Record<string, unknown>),
      barsSinceSignal: 25,
    },
    {
      ...(signalState("AAPL", "2026-06-08T18:30:00.000Z") as Record<
        string,
        unknown
      >),
      id: "AAPL:15m",
      timeframe: "15m",
      barsSinceSignal: 1,
    },
  ] as never[];

  const ordered = __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
    states,
    universe: new Set(["SPY", "AAPL"]),
    timeframe: "5m",
  });

  assert.deepEqual(
    ordered.map((state) => [
      state.symbol,
      state.timeframe,
      state.currentSignalDirection,
    ]),
    [["SPY", "5m", "sell"]],
  );

  const unfiltered = __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
    states,
    universe: new Set(["SPY", "AAPL"]),
  });

  assert.deepEqual(
    unfiltered.map((state) => state.timeframe),
    ["2m", "15m", "5m"],
  );
});

test("Signal Options dashboard candidates use deterministic display tie-breakers", () => {
  const candidates = [
    {
      id: "SIGOPT-paper-TSLA-buy-1780617600000",
      symbol: "TSLA",
      direction: "buy",
      signalAt: "2026-06-05T00:00:00.000Z",
      timeline: [],
    },
    {
      id: "SIGOPT-paper-META-buy-1780617600000",
      symbol: "META",
      direction: "buy",
      signalAt: "2026-06-05T00:00:00.000Z",
      timeline: [],
    },
    {
      id: "SIGOPT-paper-LITE-buy-1780929600000",
      symbol: "LITE",
      direction: "buy",
      signalAt: "2026-06-08T14:40:00.000Z",
      timeline: [],
    },
  ];
  const compare =
    __signalOptionsAutomationInternalsForTests.compareSignalOptionsCandidatesForDisplay as (
      left: Record<string, unknown>,
      right: Record<string, unknown>,
    ) => number;

  candidates.sort(compare);

  assert.deepEqual(
    candidates.map((candidate) => candidate.symbol),
    ["LITE", "META", "TSLA"],
  );
});

test("Signal Options forced signal refresh fallback preserves cached state", () => {
  const state = {
    deployment: { id: "deployment-paper" },
    profile: { id: "paper-profile" },
    mode: "shadow",
    signals: [{ symbol: "SPY" }],
    candidates: [{ symbol: "SPY" }],
    dataQuality: {},
    activePositions: [],
    risk: {},
    events: [],
  };
  const fallback =
    __signalOptionsAutomationInternalsForTests.signalOptionsSignalRefreshFallbackState({
      deployment: { id: "deployment-paper" },
      profile: { id: "paper-profile" },
      events: [],
      state,
      cachedAt: "2026-06-08T14:20:00.000Z",
      expiresAt: 0,
      staleExpiresAt: 0,
    } as never) as Record<string, unknown>;

  assert.equal(fallback["cacheStatus"], "stale");
  assert.equal(fallback["degraded"], true);
  assert.equal(fallback["stale"], true);
  assert.equal(
    fallback["reason"],
    "signal_options_state_signal_refresh_failed_fallback",
  );
  assert.deepEqual(fallback["signals"], state.signals);
  assert.deepEqual(fallback["candidates"], state.candidates);
});

test("Signal Options position mark keeps stale quote distinct from missing bid/ask", () => {
  const resolution =
    __signalOptionsAutomationInternalsForTests.resolvePositionMarkQuote({
      quote: {
        bid: 3.5,
        ask: 4.4,
        mark: 4.5,
        last: 4.5,
        quoteFreshness: "stale",
        marketDataMode: "live",
      },
      profile: {
        liquidityGate: {
          requireBidAsk: true,
          requireFreshQuote: true,
          minBid: 0.01,
          maxSpreadPctOfMid: 35,
        },
        liquidityHaltControls: {
          bidAskRequiredEnabled: true,
          freshQuoteRequiredEnabled: true,
          spreadGateEnabled: true,
          minBidGateEnabled: true,
        },
      },
    } as never) as {
      ok: boolean;
      reason: string | null;
      markPrice: number | null;
      liquidity: {
        bid: number | null;
        ask: number | null;
        reasons: string[];
      };
    };

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "quote_not_fresh");
  assert.equal(resolution.markPrice, 3.95);
  assert.equal(resolution.liquidity.bid, 3.5);
  assert.equal(resolution.liquidity.ask, 4.4);
  assert.deepEqual(resolution.liquidity.reasons, ["quote_not_fresh"]);
});

test("Signal Options stale position mark summary names stale quote", () => {
  assert.equal(
    __signalOptionsAutomationInternalsForTests.positionMarkUnavailableSummary({
      symbol: "CLS",
      markReason: "quote_not_fresh",
    }),
    "CLS shadow mark skipped: option quote stale",
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.positionMarkUnavailableMessage(
      "quote_not_fresh",
    ),
    "The option quote was stale or unavailable for the open shadow position.",
  );
});
