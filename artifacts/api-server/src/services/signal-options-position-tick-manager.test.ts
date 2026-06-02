import assert from "node:assert/strict";
import { setImmediate as delayImmediate } from "node:timers/promises";
import test from "node:test";
import type { AlgoDeployment, ExecutionEvent } from "@workspace/db";
import {
  defaultSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import type { OptionQuoteSnapshotPayload } from "./bridge-option-quote-stream";
import { createSignalOptionsPositionTickManager } from "./signal-options-position-tick-manager";
import type { SignalOptionsPosition } from "./signal-options-automation";

function deployment(overrides: Partial<AlgoDeployment> = {}): AlgoDeployment {
  const now = new Date("2026-06-01T14:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    strategyId: "22222222-2222-4222-8222-222222222222",
    name: "Signal Options",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["SPY"],
    config: {
      signalOptions: {
        exitPolicy: {
          greekPositionManagement: {
            enabled: true,
          },
        },
      },
    },
    lastEvaluatedAt: null,
    lastSignalAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function position(
  overrides: Partial<SignalOptionsPosition> = {},
): SignalOptionsPosition {
  return {
    id: "position-1",
    candidateId: "candidate-1",
    symbol: "SPY",
    direction: "buy",
    optionRight: "call",
    timeframe: "15m",
    signalAt: "2026-06-01T14:00:00.000Z",
    openedAt: "2026-06-01T14:00:00.000Z",
    entryPrice: 3,
    quantity: 1,
    peakPrice: 3,
    stopPrice: 1.5,
    premiumAtRisk: 300,
    selectedContract: {
      underlying: "SPY",
      ticker: "SPY260605C00590000",
      expirationDate: "2026-06-05",
      strike: 590,
      right: "call",
      multiplier: 100,
      providerContractId: "9001",
    },
    lastMarkPrice: 3,
    lastMarkedAt: "2026-06-01T14:00:00.000Z",
    lastStop: null,
    lastWireTrail: null,
    signalQuality: null,
    entryGreeks: null,
    greekBaselineSource: null,
    ...overrides,
  };
}

function quote(providerContractId = "9001", price = 3.25): QuoteSnapshot {
  return {
    symbol: "SPY",
    price,
    bid: Number((price - 0.05).toFixed(2)),
    ask: Number((price + 0.05).toFixed(2)),
    bidSize: 10,
    askSize: 11,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: 100,
    openInterest: 1_000,
    impliedVolatility: 0.3,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.04,
    vega: 0.1,
    updatedAt: new Date("2026-06-01T14:01:00.000Z"),
    providerContractId,
    transport: "client_portal",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-06-01T14:01:00.000Z"),
    ageMs: 0,
  };
}

function payload(quotes: QuoteSnapshot[]): OptionQuoteSnapshotPayload {
  return {
    underlying: "SPY",
    quotes: quotes.map((item) => ({ ...item, source: "ibkr" })),
    transport: "client_portal",
    delayed: false,
    fallbackUsed: false,
  };
}

function greekProfile(): SignalOptionsExecutionProfile {
  return {
    ...defaultSignalOptionsExecutionProfile,
    exitPolicy: {
      ...defaultSignalOptionsExecutionProfile.exitPolicy,
      greekPositionManagement: {
        enabled: true,
      },
    },
  };
}

test("position tick manager subscribes active positions and manages matching quote callbacks", async () => {
  const testDeployment = deployment();
  const initialPosition = position();
  const subscribeCalls: Array<{
    owner: string;
    providerContractIds: string[];
    requiresGreeks?: boolean;
    onSnapshot: (snapshot: OptionQuoteSnapshotPayload) => void;
  }> = [];
  let unsubscribeCount = 0;
  const managedPositions: SignalOptionsPosition[] = [];

  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => [testDeployment],
    listActivePositions: async () => ({
      positions: [initialPosition],
      events: [] as ExecutionEvent[],
    }),
    subscribeDemand: (input, onSnapshot) => {
      subscribeCalls.push({
        owner: input.owner,
        providerContractIds: input.providerContractIds,
        requiresGreeks: input.requiresGreeks,
        onSnapshot,
      });
      return () => {
        unsubscribeCount += 1;
      };
    },
    manageQuote: async (input) => {
      managedPositions.push(input.position);
      return {
        managed: true,
        position: {
          ...input.position,
          peakPrice: input.quote.price,
          lastMarkPrice: input.quote.price,
        },
      };
    },
    resolveProfile: () => greekProfile(),
    isLiveSession: () => true,
    loadPyrusSignalsSettings: async () => null,
    logger: { debug() {}, info() {}, warn() {} },
  });

  await manager.runOnce();

  assert.equal(subscribeCalls.length, 1);
  assert.equal(
    subscribeCalls[0]?.owner,
    "signal-options-position-mark:11111111-1111-4111-8111-111111111111:position-1:tick",
  );
  assert.deepEqual(subscribeCalls[0]?.providerContractIds, ["9001"]);
  assert.equal(subscribeCalls[0]?.requiresGreeks, true);

  subscribeCalls[0]?.onSnapshot(payload([quote("other", 9), quote("9001", 3.4)]));
  await delayImmediate();
  subscribeCalls[0]?.onSnapshot(payload([quote("9001", 3.8)]));
  await delayImmediate();

  assert.equal(managedPositions.length, 2);
  assert.equal(managedPositions[0]?.peakPrice, 3);
  assert.equal(managedPositions[1]?.peakPrice, 3.4);

  manager.stop();
  assert.equal(unsubscribeCount, 1);
});

test("position tick manager releases subscriptions for positions no longer active", async () => {
  const testDeployment = deployment();
  let activePositions = [position()];
  let unsubscribeCount = 0;

  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => [testDeployment],
    listActivePositions: async () => ({
      positions: activePositions,
      events: [] as ExecutionEvent[],
    }),
    subscribeDemand: () => {
      return () => {
        unsubscribeCount += 1;
      };
    },
    manageQuote: async (input) => ({ managed: true, position: input.position }),
    isLiveSession: () => true,
    loadPyrusSignalsSettings: async () => null,
    logger: { debug() {}, info() {}, warn() {} },
  });

  await manager.runOnce();
  activePositions = [];
  await manager.runOnce();

  assert.equal(unsubscribeCount, 1);
});

test("position tick manager does not subscribe outside the live option session", async () => {
  const testDeployment = deployment();
  let subscribeCount = 0;

  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => [testDeployment],
    listActivePositions: async () => ({
      positions: [position()],
      events: [] as ExecutionEvent[],
    }),
    subscribeDemand: () => {
      subscribeCount += 1;
      return () => {};
    },
    manageQuote: async (input) => ({ managed: true, position: input.position }),
    isLiveSession: () => false,
    loadPyrusSignalsSettings: async () => null,
    logger: { debug() {}, info() {}, warn() {} },
  });

  await manager.runOnce();

  assert.equal(subscribeCount, 0);
});
