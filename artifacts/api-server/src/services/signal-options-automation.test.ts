import assert from "node:assert/strict";
import test from "node:test";
import { defaultSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  __signalOptionsAutomationInternalsForTests,
  buildSignalOptionsShadowOrderPlan,
  resolveSignalOptionsLiquidity,
  selectSignalOptionsContractFromChain,
  selectSignalOptionsExpiration,
  type SignalOptionsOptionQuote,
} from "./signal-options-automation";

const profile = defaultSignalOptionsExecutionProfile;

function quote(strike: number, right: "call" | "put"): SignalOptionsOptionQuote {
  return {
    contract: {
      ticker: `SPY260429${right === "call" ? "C" : "P"}${strike}`,
      underlying: "SPY",
      expirationDate: "2026-04-29",
      strike,
      right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `${right}-${strike}`,
    },
    bid: 1,
    ask: 1.2,
    last: 1.1,
    mark: 1.1,
    openInterest: 100,
    volume: 25,
    updatedAt: "2026-04-28T15:00:00.000Z",
    quoteFreshness: "live",
  };
}

test("selectSignalOptionsExpiration excludes 0DTE by default", () => {
  const selected = selectSignalOptionsExpiration(
    [
      { expirationDate: "2026-04-28" },
      { expirationDate: "2026-04-29" },
      { expirationDate: "2026-05-01" },
    ],
    profile,
    new Date("2026-04-28T15:00:00.000Z"),
  );

  assert.equal(selected?.expirationDate.toISOString().slice(0, 10), "2026-04-29");
  assert.equal(selected?.dte, 1);
});

test("selectSignalOptionsContractFromChain maps buy to call above and sell to put below", () => {
  const contracts = [
    quote(99, "call"),
    quote(101, "call"),
    quote(102, "call"),
    quote(98, "put"),
    quote(99, "put"),
    quote(101, "put"),
  ];

  const call = selectSignalOptionsContractFromChain({
    contracts,
    direction: "buy",
    signalPrice: 100,
    profile,
  });
  const put = selectSignalOptionsContractFromChain({
    contracts,
    direction: "sell",
    signalPrice: 100,
    profile,
  });

  assert.equal(call?.contract?.right, "call");
  assert.equal(call?.contract?.strike, 101);
  assert.equal(put?.contract?.right, "put");
  assert.equal(put?.contract?.strike, 99);
});

test("buildSignalOptionsShadowOrderPlan enforces liquidity and premium budget", () => {
  const liquid = quote(101, "call");
  const orderPlan = buildSignalOptionsShadowOrderPlan(liquid, profile);

  assert.equal(orderPlan.ok, true);
  assert.equal(orderPlan.quantity, 3);
  assert.equal(orderPlan.premiumAtRisk, 357);

  const wide = {
    ...liquid,
    bid: 1,
    ask: 2,
    mark: 1.5,
  };
  const liquidity = resolveSignalOptionsLiquidity(wide, profile);

  assert.equal(liquidity.ok, false);
  assert.ok(liquidity.reasons.includes("spread_too_wide"));
});

test("daily signal-options pnl includes realized exits and open marked positions", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const realizedExit = {
    id: "exit-1",
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    payload: { pnl: -25 },
    occurredAt: now,
  } as never;
  const yesterdayExit = {
    id: "exit-0",
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    payload: { pnl: -500 },
    occurredAt: new Date("2026-04-27T18:00:00.000Z"),
  } as never;
  const positions = [
    {
      entryPrice: 1.25,
      lastMarkPrice: 0.75,
      quantity: 2,
      selectedContract: { multiplier: 100 },
    },
    {
      entryPrice: 3,
      lastMarkPrice: 3.5,
      quantity: 1,
      selectedContract: { multiplier: 50 },
    },
    {
      entryPrice: 2,
      quantity: 1,
      selectedContract: { multiplier: 100 },
    },
  ] as never;

  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsDailyRealizedPnl(
      [realizedExit, yesterdayExit],
      now,
    ),
    -25,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsOpenUnrealizedPnl(
      positions,
    ),
    -75,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsDailyPnl(
      [realizedExit, yesterdayExit],
      positions,
      now,
    ),
    -100,
  );
});

test("cockpit snapshot helpers classify pipeline stages and attention items", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const deployment = {
    id: "deployment-1",
    name: "Signal Options Paper",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["SPY", "QQQ"],
    lastEvaluatedAt: now,
    lastSignalAt: now,
    lastError: null,
    updatedAt: now,
  } as never;
  const readiness = {
    ready: true,
    reason: null,
    message: "ready",
  } as never;
  const candidates = [
    {
      id: "candidate-1",
      symbol: "SPY",
      status: "skipped",
      actionStatus: "blocked",
      syncStatus: "synced",
      reason: "spread_too_wide",
      signalAt: now.toISOString(),
      selectedContract: { strike: 510, right: "call" },
      liquidity: { spreadPctOfMid: 80 },
      timeline: [
        {
          type: "signal_options_candidate_skipped",
          occurredAt: now.toISOString(),
        },
      ],
    },
    {
      id: "candidate-2",
      symbol: "QQQ",
      status: "open",
      actionStatus: "mismatch",
      syncStatus: "event_only",
      signalAt: now.toISOString(),
      selectedContract: { strike: 430, right: "call" },
      shadowLink: null,
      timeline: [
        {
          type: SIGNAL_OPTIONS_ENTRY_EVENT,
          occurredAt: now.toISOString(),
        },
      ],
    },
  ] as never;
  const activePositions = [
    {
      id: "position-1",
      symbol: "QQQ",
      openedAt: now.toISOString(),
      entryPrice: 1,
      lastMarkPrice: 0.95,
      stopPrice: 0.85,
      quantity: 1,
      selectedContract: { multiplier: 100 },
      lastMarkedAt: now.toISOString(),
    },
  ] as never;
  const risk = {
    dailyPnl: -1250,
    maxDailyLoss: 1000,
    dailyHaltActive: true,
  };

  const stages =
    __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
      deployment,
      readiness,
      candidates,
      activePositions,
      risk,
      events: [],
    });
  const attention =
    __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
      deployment,
      readiness,
      candidates,
      activePositions,
      risk,
      events: [],
    });

  assert.equal(stages.length, 7);
  assert.equal(
    stages.find((stage) => stage.id === "liquidity_risk_gate")?.status,
    "blocked",
  );
  assert.ok(
    attention.some((item) => item.id === "daily-loss-halt"),
  );
  assert.ok(
    attention.some((item) => item.id === "shadow-candidate-2"),
  );
});
