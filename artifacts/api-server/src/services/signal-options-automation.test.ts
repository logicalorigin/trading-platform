import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defaultSignalOptionsExecutionProfile,
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import { resolvePyrusSignalsSignalSettings } from "@workspace/pyrus-signals-core";
import {
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
  SIGNAL_OPTIONS_MARK_EVENT,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  __signalOptionsAutomationInternalsForTests,
  buildSignalOptionsPerformanceFromInputs,
  buildSignalOptionsShadowOrderPlan,
  resolveSignalOptionsLiquidity,
  selectSignalOptionsContractFromChain,
  selectSignalOptionsExpiration,
  type SignalOptionsOptionQuote,
} from "./signal-options-automation";
import {
  normalizeAlgoDeploymentProviderAccountId,
  SHADOW_PROVIDER_ACCOUNT_ID,
} from "./algo-deployment-account";
import { registerSignalOptionsWorkerSnapshotGetter } from "./signal-options-worker-state";
import {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} from "./resource-pressure";

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

function pricedQuote(
  strike: number,
  right: "call" | "put",
  bid: number,
  ask: number,
): SignalOptionsOptionQuote {
  return {
    ...quote(strike, right),
    bid,
    ask,
    last: Number(((bid + ask) / 2).toFixed(2)),
    mark: Number(((bid + ask) / 2).toFixed(2)),
  };
}

test("default paper signal-options startup uses bounded signal monitor profile", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /DEFAULT_SIGNAL_OPTIONS_MONITOR_MAX_SYMBOLS = 60/);
  assert.match(source, /DEFAULT_SIGNAL_OPTIONS_MONITOR_CONCURRENCY = 2/);
  assert.match(source, /SIGNAL_OPTIONS_MONITOR_FULL_REFRESH_CONCURRENCY = 6/);
  assert.match(source, /DEFAULT_SIGNAL_OPTIONS_MONITOR_POLL_SECONDS = 60/);
  assert.match(source, /withSignalMonitorUniverseScope/);
  assert.match(
    source,
    /resolveSignalOptionsMonitorFullRefresh\(\{[\s\S]*universe: input\.universe/,
  );
  assert.match(
    source,
    /maxSymbolsOverride:\s*fullRefresh\.symbols\.length/,
  );
  assert.match(source, /pressureCapMode:\s*"bypass-soft"/);
  assert.match(
    source,
    /evaluationConcurrencyOverride:\s*SIGNAL_OPTIONS_MONITOR_FULL_REFRESH_CONCURRENCY/,
  );
  assert.match(
    source,
    /hardPressureBlock[\s\S]*resolveSignalOptionsMonitorBatch/,
  );
  assert.match(
    source,
    /await normalizeDefaultSignalOptionsPaperSignalMonitorProfile\(\)/,
  );
  assert.match(source, /await updateSignalMonitorProfile\(patch\)/);
});

test("signal-options scans request Massive-primary signal monitor bars", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const monitorStateBlock = source.match(
    /async function loadSignalOptionsMonitorState[\s\S]*?\nfunction candidateFromEvent/,
  )?.[0];

  assert.match(
    monitorStateBlock ?? "",
    /evaluateSignalMonitorProfileSymbols\(\{[\s\S]*barSourcePolicy:\s*SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY/,
  );
  assert.match(
    monitorStateBlock ?? "",
    /evaluateSignalMonitor\(\{[\s\S]*barSourcePolicy:\s*SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY/,
  );
  assert.match(
    source,
    /const SIGNAL_OPTIONS_SIGNAL_SOURCE_POLICY = "massive-primary";/,
  );
  assert.match(
    source,
    /const SIGNAL_OPTIONS_MONITOR_BAR_SOURCE_POLICY = "mixed" as const;/,
  );
  assert.doesNotMatch(monitorStateBlock ?? "", /barSourcePolicy:\s*"ibkr-only"/);
  assert.doesNotMatch(
    monitorStateBlock ?? "",
    /return current;/,
  );
});

test("signal-options scans publish fresh signal state before heavy action work", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const scanBody = source.match(
    /async function runSignalOptionsShadowScanUnlocked[\s\S]*?\nexport async function updateSignalOptionsExecutionProfile/,
  )?.[0];

  assert.ok(scanBody);
  assert.ok(
    scanBody.indexOf("await loadSignalOptionsMonitorState") <
      scanBody.indexOf("const initialEvents = await listDeploymentEvents"),
  );
  assert.ok(
    scanBody.indexOf("lastEvaluatedAt: signalScanCompletedAt") <
      scanBody.indexOf("refreshActivePosition"),
  );
  assert.ok(
    scanBody.indexOf("shouldDeferSignalOptionsHeavyWork") <
      scanBody.indexOf("refreshActivePosition"),
  );
  assert.ok(
    scanBody.indexOf("createSignalOptionsActionWorkBudget") <
      scanBody.indexOf("refreshActivePosition"),
  );
  assert.match(scanBody, /rememberSignalOptionsActionCursor/);
  assert.match(scanBody, /unmanagedPositionSymbols\.size === 0/);
  assert.match(scanBody, /activeScanPhase:\s*"deferred"/);
  assert.match(scanBody, /lastSignalScanAt:\s*signalScanCompletedAt\.toISOString\(\)/);
  assert.match(scanBody, /heavyWorkDeferred:\s*true/);
});

test("signal-options continues heavy action work under RSS-only API pressure", () => {
  updateApiResourcePressure({ rssMb: resolveApiRssPressureThresholds().high });
  try {
    const decision =
      __signalOptionsAutomationInternalsForTests.shouldDeferSignalOptionsHeavyWork();

    assert.equal(decision.pressure.level, "high");
    assert.equal(decision.defer, false);
  } finally {
    __resetApiResourcePressureForTests();
  }
});

test("signal-options defers heavy action work under hard API pressure", () => {
  updateApiResourcePressure({ apiHeapUsedPercent: 91 });
  try {
    const decision =
      __signalOptionsAutomationInternalsForTests.shouldDeferSignalOptionsHeavyWork();

    assert.equal(decision.pressure.level, "critical");
    assert.equal(decision.defer, true);
  } finally {
    __resetApiResourcePressureForTests();
  }
});

test("signal-options state resolves paper-enabled before UUID lookup", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const lookupBlock = source.match(
    /async function getDeploymentOrThrow[\s\S]*?\nasync function listDeploymentEvents/,
  )?.[0];

  assert.match(source, /const UUID_PATTERN =/);
  assert.match(source, /async function getDeploymentByAlias/);
  assert.match(source, /alias !== "paper-enabled"/);
  assert.match(
    lookupBlock ?? "",
    /UUID_PATTERN\.test\(deploymentId\)[\s\S]*where\(eq\(algoDeploymentsTable\.id,\s*deploymentId\)\)[\s\S]*:\s*await getDeploymentByAlias\(deploymentId\)/,
  );
});

test("signal-options dashboard endpoints share a cached state snapshot", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const stateEndpoint = source.match(
    /export async function listSignalOptionsAutomationState[\s\S]*?\n}\n\nasync function buildAlgoDeploymentCockpitPayload/,
  )?.[0];
  const cockpitEndpoint = source.match(
    /async function buildAlgoDeploymentCockpitPayload[\s\S]*?\nexport async function getAlgoDeploymentCockpit/,
  )?.[0];
  const performanceEndpoint = source.match(
    /export async function getSignalOptionsPerformance[\s\S]*?\nfunction formatEnumReason/,
  )?.[0];

  assert.match(source, /const signalOptionsDashboardCache = new Map/);
  assert.match(source, /async function getSignalOptionsDashboardSnapshot/);
  assert.match(stateEndpoint ?? "", /getSignalOptionsDashboardSnapshot\(input\)/);
  assert.match(cockpitEndpoint ?? "", /getSignalOptionsDashboardSnapshot/);
  assert.match(performanceEndpoint ?? "", /getSignalOptionsDashboardSnapshot/);
  assert.doesNotMatch(
    performanceEndpoint ?? "",
    /buildStatePayload\(\{ deployment, profile, events \}\)/,
  );
});

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

test("historical backfill expiration candidates skip weekends within DTE window", () => {
  const candidates =
    __signalOptionsAutomationInternalsForTests.selectHistoricalExpirationCandidates(
      new Date("2026-05-08T15:00:00.000Z"),
      profile,
    );

  assert.deepEqual(
    candidates.map((candidate) => ({
      date: candidate.expirationDate.toISOString().slice(0, 10),
      dte: candidate.dte,
    })),
    [{ date: "2026-05-11", dte: 3 }],
  );
});

test("historical backfill strike and ticker helpers mirror signal-options defaults", () => {
  const callStrikes =
    __signalOptionsAutomationInternalsForTests.selectHistoricalStrikeCandidates({
      signalPrice: 100.25,
      direction: "buy",
      profile,
    });
  const putStrikes =
    __signalOptionsAutomationInternalsForTests.selectHistoricalStrikeCandidates({
      signalPrice: 100.25,
      direction: "sell",
      profile,
    });
  const ticker =
    __signalOptionsAutomationInternalsForTests.buildHistoricalPolygonOptionTicker({
      underlying: "SPY",
      expirationDate: new Date("2026-05-11T00:00:00.000Z"),
      strike: callStrikes[0]!,
      right: "call",
    });

  assert.equal(callStrikes[0], 101);
  assert.equal(putStrikes[0], 100);
  assert.equal(ticker, "O:SPY260511C00101000");
});

test("historical backfill order plan sizes from option bar close", () => {
  const trade = {
    price: 1.25,
    size: 4,
    occurredAt: new Date("2026-05-11T13:30:01.000Z"),
    sequenceNumber: 1,
    conditionCodes: [],
    exchange: "323",
  };
  const orderPlan =
    __signalOptionsAutomationInternalsForTests.buildHistoricalOrderPlan(
      trade.price,
      profile,
      {
        source: "polygon-option-trade",
        trade,
        markPrice: 1.2,
      },
    );

  assert.equal(orderPlan.ok, true);
  assert.equal(orderPlan.simulatedFillPrice, 1.25);
  assert.equal(orderPlan.quantity, 3);
  assert.equal(orderPlan.premiumAtRisk, 375);
  assert.equal(orderPlan.historicalPricing, true);
  assert.equal(orderPlan.historicalFill.source, "polygon-option-trade");
  assert.equal(orderPlan.historicalFill.trade?.price, 1.25);
});

test("historical option trade fills use the first timely Polygon print", () => {
  const at = new Date("2026-05-11T13:30:00.000Z");
  const trades = [
    {
      price: 1.2,
      size: 1,
      occurredAt: new Date("2026-05-11T13:29:59.999Z"),
      sequenceNumber: 1,
      conditionCodes: [],
      exchange: null,
    },
    {
      price: 1.25,
      size: 1,
      occurredAt: new Date("2026-05-11T13:30:00.500Z"),
      sequenceNumber: 2,
      conditionCodes: [],
      exchange: null,
    },
    {
      price: 1.3,
      size: 1,
      occurredAt: new Date("2026-05-11T13:31:30.000Z"),
      sequenceNumber: 3,
      conditionCodes: [],
      exchange: null,
    },
  ];

  const fill =
    __signalOptionsAutomationInternalsForTests.selectHistoricalOptionTradeFill({
      trades,
      at,
      maxDelayMs: 60_000,
    });
  const late =
    __signalOptionsAutomationInternalsForTests.selectHistoricalOptionTradeFill({
      trades: [trades[2]!],
      at,
      maxDelayMs: 60_000,
    });

  assert.equal(fill?.price, 1.25);
  assert.equal(late, null);
});

test("historical backfill option entries require a timely option bar", () => {
  const signalAt = new Date("2026-05-14T14:00:00.000Z");

  assert.equal(
    __signalOptionsAutomationInternalsForTests.isHistoricalOptionEntryBarTimely(
      signalAt,
      new Date("2026-05-14T14:01:00.000Z"),
    ),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.isHistoricalOptionEntryBarTimely(
      signalAt,
      new Date("2026-05-14T14:01:01.000Z"),
    ),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.isHistoricalOptionEntryBarTimely(
      signalAt,
      new Date("2026-05-14T13:59:59.000Z"),
    ),
    false,
  );
});

test("signal-options replay prices option marks from 1m regular-session bars", () => {
  assert.equal(
    __signalOptionsAutomationInternalsForTests.SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME,
    "1m",
  );

  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /timeframe:\s*SIGNAL_OPTIONS_OPTION_MARK_TIMEFRAME/);
  assert.match(source, /outsideRth:\s*false/);
  assert.match(source, /skipBrokerContractResolution:\s*true/);
  assert.doesNotMatch(source, /providerContractId:\s*result\.providerContractId\s*\?\?\s*optionTicker/);
});

test("position mark quote snapshots map onto signal option quotes", () => {
  const quote =
    __signalOptionsAutomationInternalsForTests.quoteSnapshotToSignalOptionsQuote({
      contract: {
        ticker: "SMCI20260515P32",
        underlying: "SMCI",
        expirationDate: "2026-05-15",
        strike: 32,
        right: "put",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "old-conid",
      },
      quote: {
        symbol: "SMCI",
        price: 1.29,
        bid: 1.27,
        ask: 1.34,
        bidSize: 10,
        askSize: 12,
        change: 0,
        changePercent: 0,
        volume: 2541,
        openInterest: 12,
        impliedVolatility: 0.7,
        delta: -0.42,
        gamma: 0.03,
        theta: -0.01,
        vega: 0.04,
        updatedAt: new Date("2026-05-12T16:32:18.332Z"),
        providerContractId: "fresh-conid",
        transport: "client_portal",
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: new Date("2026-05-12T16:32:18.332Z"),
        ageMs: 25,
      } as never,
    });

  assert.equal(quote.contract?.providerContractId, "fresh-conid");
  assert.equal(quote.contract?.right, "put");
  assert.equal(quote.bid, 1.27);
  assert.equal(quote.ask, 1.34);
  assert.equal(quote.last, 1.29);
  assert.equal(quote.mark, 1.29);
  assert.equal(quote.quoteFreshness, "live");
  assert.equal(quote.marketDataMode, "live");
  assert.equal(quote.ageMs, 25);
});

test("signal-options worker refreshes degraded monitor state before scanning", () => {
  const now = new Date("2026-05-14T14:00:00.000Z");
  const universe = new Set(["SPY"]);
  const currentState = {
    profile: {
      id: "signal-profile-paper",
      timeframe: "5m",
      pollIntervalSeconds: 60,
      lastEvaluatedAt: "2026-05-14T13:59:20.000Z",
    },
    states: [{ symbol: "SPY", status: "ok", fresh: false }],
  };

  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRefreshSignalOptionsMonitorState({
      evaluated: currentState,
      universe,
      now,
    }),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRefreshSignalOptionsMonitorState({
      evaluated: {
        ...currentState,
        profile: {
          ...currentState.profile,
          lastEvaluatedAt: "2026-05-14T13:58:00.000Z",
        },
      },
      universe,
      now,
    }),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRefreshSignalOptionsMonitorState({
      evaluated: {
        ...currentState,
        profile: {
          ...currentState.profile,
          lastEvaluatedAt: "2026-05-14T13:54:00.000Z",
        },
      },
      universe,
      now,
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRefreshSignalOptionsMonitorState({
      evaluated: {
        ...currentState,
        states: [{ symbol: "SPY", status: "stale", fresh: false }],
      },
      universe,
      now,
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRefreshSignalOptionsMonitorState({
      evaluated: {
        ...currentState,
        states: [{ symbol: "QQQ", status: "ok", fresh: true }],
      },
      universe,
      now,
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRefreshSignalOptionsMonitorState({
      evaluated: {
        profile: {
          id: "runtime-fallback-paper",
          pollIntervalSeconds: 60,
          lastEvaluatedAt: null,
        },
        states: [{ symbol: "SPY", status: "ok", fresh: false }],
      },
      universe,
      now,
    }),
    false,
  );
});

test("signal-options scan timestamp keeps latest observed fresh signal", () => {
  const latestSignalDate =
    __signalOptionsAutomationInternalsForTests.latestSignalDate;
  const earlier = new Date("2026-05-18T17:55:00.000Z");

  assert.equal(
    latestSignalDate(null, "2026-05-18T18:05:00.000Z")?.toISOString(),
    "2026-05-18T18:05:00.000Z",
  );
  assert.equal(
    latestSignalDate(earlier, "2026-05-18T18:05:00.000Z")?.toISOString(),
    "2026-05-18T18:05:00.000Z",
  );
  assert.equal(
    latestSignalDate(earlier, "2026-05-18T17:45:00.000Z"),
    earlier,
  );
  assert.equal(latestSignalDate(earlier, "not-a-date"), earlier);
});

test("signal-options worker scan summary stays lightweight and universe-scoped", () => {
  const summary =
    __signalOptionsAutomationInternalsForTests.buildWorkerScanSummary({
      states: [
        {
          symbol: "SPY",
          fresh: true,
          status: "ok",
          latestBarAt: "2026-05-18T18:20:00.000Z",
        },
        {
          symbol: "QQQ",
          fresh: false,
          status: "stale",
          latestBarAt: "2026-05-18T18:10:00.000Z",
        },
        {
          symbol: "DIA",
          fresh: false,
          status: "unavailable",
          latestBarAt: null,
        },
      ] as never,
      universe: new Set(["SPY", "QQQ"]),
      candidateCount: 3,
      blockedCandidateCount: 2,
    });

  assert.deepEqual(summary, {
    signalCount: 2,
    freshSignalCount: 1,
    staleSignalCount: 1,
    unavailableSignalCount: 0,
    latestSignalBarAt: "2026-05-18T18:20:00.000Z",
    oldestSignalBarAt: "2026-05-18T18:10:00.000Z",
    lastSignalScanAt: null,
    signalSourcePolicy: "massive-primary",
    heavyWorkDeferred: false,
    activeScanPhase: null,
    resourcePressureLevel: null,
    candidateCount: 3,
    blockedCandidateCount: 2,
    batch: null,
  });
});

test("signal-options monitor batches rotate through the deployment universe", () => {
  const resolveBatch =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsMonitorBatch;
  const profile = {
    maxSymbols: 16,
    evaluationConcurrency: 1,
    timeframe: "5m",
  } as never;
  const universe = new Set(["SPY", "AAPL", "MSFT", "TSLA", "NVDA"]);
  const deploymentId = "deploy-batch-rotation-test";

  const first = resolveBatch({
    deploymentId,
    universe,
    profile,
    capacity: 2,
  });
  const second = resolveBatch({
    deploymentId,
    universe,
    profile,
    capacity: 2,
  });
  const third = resolveBatch({
    deploymentId,
    universe,
    profile,
    capacity: 2,
  });
  const reset = resolveBatch({
    deploymentId,
    universe: new Set(["QQQ", "DIA"]),
    profile,
    capacity: 2,
  });

  assert.deepEqual(first.symbols, ["SPY", "AAPL"]);
  assert.equal(first.nextIndex, 2);
  assert.deepEqual(second.symbols, ["MSFT", "TSLA"]);
  assert.equal(second.nextIndex, 4);
  assert.deepEqual(third.symbols, ["NVDA", "SPY"]);
  assert.equal(third.nextIndex, 1);
  assert.deepEqual(reset.symbols, ["QQQ", "DIA"]);
  assert.equal(reset.startIndex, 0);
});

test("signal-options manual monitor refresh covers the full deployment universe", () => {
  const resolveFullRefresh =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsMonitorFullRefresh;
  const fullRefresh = resolveFullRefresh({
    universe: new Set([
      "SPY",
      "AAPL",
      "MSFT",
      "TSLA",
      "NVDA",
      "QQQ",
      "AMD",
      "META",
      "PLTR",
      "COIN",
      "HOOD",
      "RBLX",
      "RKLB",
      "SMCI",
      "VXX",
      "VIXY",
      "AVGO",
      "IWM",
    ]),
  });

  assert.equal(fullRefresh.symbols.length, 18);
  assert.equal(fullRefresh.universeCount, 18);
  assert.equal(fullRefresh.batchSize, 18);
  assert.equal(fullRefresh.fullUniverse, true);
  assert.equal(fullRefresh.nextIndex, 0);
});

test("active position marks record changed downside prices", () => {
  const position = {
    peakPrice: 2.55,
    stopPrice: 1.27,
    lastMarkPrice: null,
  };

  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMark({
      position: position as never,
      peakPrice: 2.55,
      stopPrice: 1.27,
      markPrice: 2.4,
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMark({
      position: { ...position, lastMarkPrice: 2.4 } as never,
      peakPrice: 2.55,
      stopPrice: 1.27,
      markPrice: 2.4,
    }),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMark({
      position: { ...position, lastMarkPrice: 2.4 } as never,
      peakPrice: 2.55,
      stopPrice: 1.27,
      markPrice: 2.39,
    }),
    true,
  );
});

test("active position scan marks once per UTC minute", () => {
  const shouldRecord =
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMarkForScan;

  assert.equal(
    shouldRecord({
      position: { lastMarkedAt: null } as never,
      markAt: new Date("2026-05-12T14:30:15.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldRecord({
      position: { lastMarkedAt: "2026-05-12T14:30:02.000Z" } as never,
      markAt: new Date("2026-05-12T14:30:59.000Z"),
    }),
    false,
  );
  assert.equal(
    shouldRecord({
      position: { lastMarkedAt: "2026-05-12T14:30:59.000Z" } as never,
      markAt: new Date("2026-05-12T14:31:00.000Z"),
    }),
    true,
  );
});

test("position mark quote matching finds the exact selected contract", () => {
  const selected = quote(102, "call");
  const match =
    __signalOptionsAutomationInternalsForTests.findSignalOptionsQuoteForContract({
      contracts: [quote(101, "call"), selected, quote(103, "put")],
      selectedContract: selected.contract as Record<string, unknown>,
    });
  const providerMismatch =
    __signalOptionsAutomationInternalsForTests.findSignalOptionsQuoteForContract({
      contracts: [
        {
          ...selected,
          contract: {
            ...selected.contract,
            providerContractId: "different-provider-contract",
          },
        },
      ],
      selectedContract: selected.contract as Record<string, unknown>,
    });

  assert.equal(match?.contract?.providerContractId, "call-102");
  assert.equal(providerMismatch, null);
});

test("position mark quote resolver requires current positive marks", () => {
  const live =
    __signalOptionsAutomationInternalsForTests.resolvePositionMarkQuote({
      quote: quote(102, "call"),
      profile,
    });
  const missingMark =
    __signalOptionsAutomationInternalsForTests.resolvePositionMarkQuote({
      quote: {
        ...quote(102, "call"),
        bid: null,
        ask: null,
        last: null,
        mark: null,
      },
      profile,
    });
  const stale =
    __signalOptionsAutomationInternalsForTests.resolvePositionMarkQuote({
      quote: {
        ...quote(102, "call"),
        quoteFreshness: "stale",
      },
      profile,
    });

  assert.equal(live.ok, true);
  assert.equal(live.markPrice, 1.1);
  assert.equal(missingMark.ok, false);
  assert.equal(missingMark.reason, "missing_mark");
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "quote_not_fresh");
});

test("position mark skip diagnostics are rate-limited by open position", () => {
  const shouldRecord =
    __signalOptionsAutomationInternalsForTests.shouldRecordPositionMarkSkip;
  const position = {
    id: "position-1",
    candidateId: "candidate-1",
  } as never;
  const events = [
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-05-13T15:00:00.000Z"),
      payload: {
        reason: "position_mark_unavailable",
        position: {
          id: "position-1",
          candidateId: "candidate-1",
        },
      },
    },
  ] as never;

  assert.equal(
    shouldRecord({
      events,
      position,
      reason: "position_mark_unavailable",
      now: new Date("2026-05-13T15:02:00.000Z"),
    }),
    false,
  );
  assert.equal(
    shouldRecord({
      events,
      position,
      reason: "position_mark_unavailable",
      now: new Date("2026-05-13T15:06:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldRecord({
      events,
      position,
      reason: "position_mark_failed",
      now: new Date("2026-05-13T15:02:00.000Z"),
    }),
    true,
  );
});

test("historical backfill closes expired positions once the contract reaches expiration", () => {
  const position = {
    nextBarIndex: 0,
    optionBars: [
      { timestamp: "2026-05-01T19:45:00.000Z" },
      { timestamp: "2026-05-04T13:30:00.000Z" },
    ],
    selectedContract: { expirationDate: "2026-05-01" },
  } as any;

  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldCloseBackfillPositionAtExpiration({
      position,
      until: new Date("2026-05-01T20:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldCloseBackfillPositionAtExpiration({
      position,
      until: new Date("2026-04-30T20:00:00.000Z"),
    }),
    false,
  );
});

test("historical backfill defaults to April 1 through the latest completed trading day", () => {
  const window =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsBackfillWindow(
      { now: new Date("2026-05-14T14:00:00.000Z") },
    );
  const eventKey =
    __signalOptionsAutomationInternalsForTests.backfillEventKey([
      "deployment",
      "SPY",
      "entry",
    ]);

  assert.equal(window.startDate, "2026-04-01");
  assert.equal(window.endDate, "2026-05-13");
  assert.equal(window.session, "regular");
  assert.equal(
    eventKey,
    "signal_options_backfill:1:deployment:SPY:entry",
  );
});

test("historical backfill equity bar limit spans the full requested window plus warmup", () => {
  const window =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsBackfillWindow(
      {
        start: "2026-04-01",
        end: "2026-05-21",
        now: new Date("2026-05-21T21:01:00.000Z"),
      },
    );
  const limit =
    __signalOptionsAutomationInternalsForTests.historicalBackfillEquityBarLimit({
      timeframe: "5m",
      window,
    });

  assert.ok(limit > 5_000);
});

test("Pyrus Signals backfill settings patch overrides time horizon without dropping nested profile settings", () => {
  const baseSettings = {
    marketStructure: {
      timeHorizon: 10,
      bosConfirmation: "close",
      chochVolumeGate: 1,
    },
    confirmation: {
      requireAdx: true,
      adxMin: 24,
    },
    bands: {
      basisLength: 80,
    },
  };
  const merged =
    __signalOptionsAutomationInternalsForTests.mergePyrusSignalsSettingsPatch(
      baseSettings,
      { timeHorizon: 4, chochAtrBuffer: 0.25 },
    );
  const resolved = resolvePyrusSignalsSignalSettings(merged);

  assert.equal(resolved.timeHorizon, 4);
  assert.equal(resolved.bosConfirmation, "close");
  assert.equal(resolved.chochAtrBuffer, 0.25);
  assert.equal(resolved.chochVolumeGate, 1);
  assert.equal(resolved.requireAdx, true);
  assert.equal(resolved.adxMin, 24);
  assert.equal(resolved.basisLength, 80);
  assert.equal(
    (baseSettings.marketStructure as Record<string, unknown>).timeHorizon,
    10,
  );
});

test("signal-options backfill API forwards run-local Pyrus Signals overrides", () => {
  const routeSource = readFileSync(
    new URL("../routes/automation.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    routeSource,
    /pyrusSignalsSettingsPatch:\s*body\.pyrusSignalsSettingsPatch/,
  );
  assert.match(routeSource, /signalTimeframe:\s*body\.signalTimeframe/);
  assert.match(
    routeSource,
    /forceDeploymentUniverse:\s*body\.forceDeploymentUniverse/,
  );
  assert.match(serviceSource, /profileSettings:\s*pyrusSignalsSettings/);
  assert.doesNotMatch(
    serviceSource,
    /update\(signalMonitorProfilesTable\)[\s\S]*pyrusSignalsSettings/,
  );
});

test("historical backfill default end advances after the New York close", () => {
  const window =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsBackfillWindow(
      { now: new Date("2026-05-14T21:01:00.000Z") },
    );

  assert.equal(window.startDate, "2026-04-01");
  assert.equal(window.endDate, "2026-05-14");
});

test("historical backfill explicit dates override April-to-latest defaults", () => {
  const window =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsBackfillWindow(
      {
        start: "2026-05-04",
        end: "2026-05-08",
        session: "all",
        now: new Date("2026-05-14T21:01:00.000Z"),
      },
    );

  assert.equal(window.startDate, "2026-05-04");
  assert.equal(window.endDate, "2026-05-08");
  assert.equal(window.session, "all");
});

test("historical backfill rejects inverted explicit date ranges", () => {
  assert.throws(
    () =>
      __signalOptionsAutomationInternalsForTests.resolveSignalOptionsBackfillWindow(
        {
          start: "2026-05-08",
          end: "2026-05-04",
          now: new Date("2026-05-14T21:01:00.000Z"),
        },
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid_signal_options_backfill_range",
  );
});

test("signal-options replay overwrites existing shadow ledger rows for the resolved window", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /if \(replay && input\.replaceReplayRows !== false && commit\) \{[\s\S]*resetSignalOptionsReplayRowsForRange\(\{[\s\S]*marketDateFrom: window\.startDate,[\s\S]*marketDateTo: window\.endDate,[\s\S]*windowStart: window\.from,[\s\S]*cleanupEnd: window\.to,/,
  );
});

test("signal-options backtest uses its own historical event source and position key", () => {
  const replay = {
    runId: "run-1",
    marketDate: "2026-05-12",
    deploymentId: "deployment-1",
    deploymentName: "Pyrus Signals Options Shadow Paper",
  };
  const eventKey =
    __signalOptionsAutomationInternalsForTests.backfillEventKey(
      ["deployment", "SPY", "entry"],
      "signal_options_replay",
    );
  const payload =
    __signalOptionsAutomationInternalsForTests.historicalEventPayload({
      source: "signal_options_replay",
      deployment: { id: "deployment-1", name: replay.deploymentName } as never,
      backfillEventKey: eventKey,
      replay,
      payload: {
        candidate: { id: "candidate-opposite-signal" },
        position: { candidateId: "candidate-1" },
      },
    });

  assert.equal(eventKey, "signal_options_replay:1:deployment:SPY:entry");
  assert.equal(payload.replay?.marketDate, "2026-05-12");
  assert.equal(payload.metadata?.sourceType, "signal_options_replay");
  assert.equal(payload.metadata?.strategyLabel, "Options Backtest");
  assert.equal(
    payload.metadata?.positionKey,
    "signal_options_replay:2026-05-12:deployment-1:candidate-1",
  );
});

test("signal-options replay stamps event dates while preserving entry-scoped position keys", () => {
  const replay = {
    runId: "run-1",
    marketDate: "2026-05-12",
    deploymentId: "deployment-1",
    deploymentName: "Pyrus Signals Options Shadow Paper",
  };
  const payload =
    __signalOptionsAutomationInternalsForTests.historicalEventPayload({
      source: "signal_options_replay",
      deployment: { id: "deployment-1", name: replay.deploymentName } as never,
      backfillEventKey: "signal_options_replay:1:deployment:SPY:mark",
      replay,
      occurredAt: new Date("2026-05-13T15:00:00.000Z"),
      payload: {
        position: {
          candidateId: "candidate-1",
          openedAt: "2026-05-12T18:30:00.000Z",
        },
      },
    });

  assert.equal(payload.replay?.marketDate, "2026-05-13");
  assert.equal(payload.metadata?.marketDate, "2026-05-13");
  assert.equal(payload.metadata?.positionMarketDate, "2026-05-12");
  assert.equal(
    payload.metadata?.positionKey,
    "signal_options_replay:2026-05-12:deployment-1:candidate-1",
  );
});

test("live signal-options state excludes replay events and orphan mark skips", () => {
  const occurredAt = new Date("2026-05-19T14:00:00.000Z");
  const liveEntry = {
    id: "live-entry",
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    symbol: "OUST",
    deploymentId: "deployment-1",
    occurredAt,
    payload: {
      candidate: {
        id: "live-candidate",
        symbol: "OUST",
        direction: "buy",
        optionRight: "call",
        signalAt: occurredAt.toISOString(),
      },
      position: {
        candidateId: "live-candidate",
        entryPrice: 1.25,
        quantity: 1,
      },
      selectedContract: {
        underlying: "OUST",
        expirationDate: "2026-05-22",
        strike: 29,
        right: "call",
        multiplier: 100,
      },
    },
  };
  const replayEntry = {
    id: "replay-entry",
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    symbol: "NVDA",
    deploymentId: "deployment-1",
    occurredAt: new Date("2026-05-19T14:01:00.000Z"),
    payload: {
      metadata: {
        sourceType: "signal_options_replay",
        runMode: "replay",
        runSource: "signal_options_replay",
      },
      replay: { source: "signal_options_replay" },
      candidate: {
        id: "replay-candidate",
        symbol: "NVDA",
        direction: "buy",
        signalAt: "2026-05-19T14:01:00.000Z",
      },
      position: {
        candidateId: "replay-candidate",
        entryPrice: 8.25,
        quantity: 1,
      },
      selectedContract: {
        underlying: "NVDA",
        expirationDate: "2026-05-22",
        strike: 220,
        right: "call",
        multiplier: 100,
      },
    },
  };
  const orphanMarkSkip = {
    id: "orphan-mark-skip",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    symbol: "NVDA",
    deploymentId: "deployment-1",
    occurredAt: new Date("2026-05-19T14:02:00.000Z"),
    payload: {
      reason: "position_mark_unavailable",
      position: { candidateId: "replay-candidate" },
    },
  };
  const liveMarkSkip = {
    id: "live-mark-skip",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    symbol: "OUST",
    deploymentId: "deployment-1",
    occurredAt: new Date("2026-05-19T14:03:00.000Z"),
    payload: {
      reason: "position_mark_unavailable",
      position: { candidateId: "live-candidate" },
    },
  };

  const stateEvents =
    __signalOptionsAutomationInternalsForTests.stateSignalOptionsEvents([
      liveMarkSkip,
      orphanMarkSkip,
      replayEntry,
      liveEntry,
    ] as never);

  assert.deepEqual(
    stateEvents.activePositions.map((position) => position.symbol),
    ["OUST"],
  );
  assert.deepEqual(
    stateEvents.signalEvents.map((event) => event.id),
    ["live-mark-skip", "live-entry"],
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.isSignalOptionsReplayEvent(
      replayEntry as never,
    ),
    true,
  );
});

test("live signal-options state recovers active positions from mark payloads", () => {
  const occurredAt = new Date("2026-05-20T17:50:24.255Z");
  const markedPosition = {
    id: "deployment-1:AAPL",
    candidateId: "candidate-aapl",
    symbol: "AAPL",
    direction: "buy",
    optionRight: "call",
    timeframe: "5m",
    signalAt: "2026-05-20T13:30:00.000Z",
    openedAt: "2026-05-20T13:58:05.907Z",
    entryPrice: 6.44,
    quantity: 2,
    peakPrice: 7.25,
    stopPrice: 4.51,
    premiumAtRisk: 1288,
    selectedContract: {
      underlying: "AAPL",
      expirationDate: "2026-05-22",
      strike: 295,
      right: "call",
      multiplier: 100,
    },
    lastMarkPrice: 6.97,
    lastMarkedAt: occurredAt.toISOString(),
  };
  const markEvent = {
    id: "mark-aapl",
    eventType: SIGNAL_OPTIONS_MARK_EVENT,
    symbol: "AAPL",
    deploymentId: "deployment-1",
    occurredAt,
    payload: {
      position: markedPosition,
      selectedContract: markedPosition.selectedContract,
      stop: {
        stopPrice: 5.8,
        exitReason: null,
        wireTrail: {
          enabled: true,
          active: true,
          selectedRung: "wire2",
          selectedWirePrice: 198.4,
          latestUnderlyingClose: 202.15,
          greekFresh: true,
        },
      },
    },
  };
  const recovered =
    __signalOptionsAutomationInternalsForTests.stateSignalOptionsEvents([
      markEvent,
    ] as never);

  assert.deepEqual(
    recovered.activePositions.map((position) => [
      position.symbol,
      position.candidateId,
      position.entryPrice,
      position.quantity,
      position.lastMarkPrice,
    ]),
    [["AAPL", "candidate-aapl", 6.44, 2, 6.97]],
  );
  assert.equal(recovered.activePositions[0]?.lastStop?.stopPrice, 5.8);
  assert.deepEqual(recovered.activePositions[0]?.lastWireTrail, {
    enabled: true,
    active: true,
    selectedRung: "wire2",
    selectedWirePrice: 198.4,
    latestUnderlyingClose: 202.15,
    greekFresh: true,
  });
  assert.deepEqual(
    recovered.signalEvents.map((event) => event.id),
    ["mark-aapl"],
  );

  const staleAfterExit =
    __signalOptionsAutomationInternalsForTests.stateSignalOptionsEvents([
      {
        id: "exit-aapl",
        eventType: SIGNAL_OPTIONS_EXIT_EVENT,
        symbol: "AAPL",
        deploymentId: "deployment-1",
        occurredAt: new Date("2026-05-20T17:49:00.000Z"),
        payload: {
          position: markedPosition,
          selectedContract: markedPosition.selectedContract,
        },
      },
      markEvent,
    ] as never);

  assert.deepEqual(staleAfterExit.activePositions, []);
});

test("live signal-options state does not recover positions from mark-skip payloads", () => {
  const markSkipEvent = {
    id: "mark-skip-aapl",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    symbol: "AAPL",
    deploymentId: "deployment-1",
    occurredAt: new Date("2026-05-20T17:50:24.255Z"),
    payload: {
      reason: "position_mark_unavailable",
      position: {
        id: "deployment-1:AAPL",
        candidateId: "candidate-aapl",
        symbol: "AAPL",
        direction: "buy",
        optionRight: "call",
        timeframe: "5m",
        signalAt: "2026-05-20T13:30:00.000Z",
        openedAt: "2026-05-20T13:58:05.907Z",
        entryPrice: 6.44,
        quantity: 2,
        selectedContract: {
          underlying: "AAPL",
          expirationDate: "2026-05-22",
          strike: 295,
          right: "call",
          multiplier: 100,
        },
      },
    },
  };

  const stateEvents =
    __signalOptionsAutomationInternalsForTests.stateSignalOptionsEvents([
      markSkipEvent,
    ] as never);

  assert.deepEqual(stateEvents.activePositions, []);
  assert.deepEqual(stateEvents.signalEvents, []);
});

test("signal-options active positions drop zero-quantity shadow ledger links", () => {
  const activePositions = [
    { candidateId: "candidate-smci", symbol: "SMCI" },
    { candidateId: "candidate-aapl", symbol: "AAPL" },
    { candidateId: "candidate-nvda", symbol: "NVDA" },
  ];
  const reconciled =
    __signalOptionsAutomationInternalsForTests.reconcileActivePositionsWithShadowLinks(
      activePositions as never,
      {
        byEventId: new Map(),
        byCandidateId: new Map([
          [
            "candidate-smci",
            {
              orderId: "smci-order",
              fillId: "smci-fill",
              positionId: "smci-position",
              positionQuantity: 0,
            },
          ],
          [
            "candidate-aapl",
            {
              orderId: "aapl-order",
              fillId: "aapl-fill",
              positionId: "aapl-position",
              positionQuantity: 2,
            },
          ],
        ]),
      } as never,
    );

  assert.deepEqual(
    reconciled.map((position) => position.symbol),
    ["AAPL", "NVDA"],
  );
});

test("historical backfill uses signal monitor watchlist symbols before deployment symbols", () => {
  const universe =
    __signalOptionsAutomationInternalsForTests.buildSignalOptionsBackfillUniverse({
      deploymentSymbols: ["SPY", "QQQ"],
      signalMonitorSymbols: ["spy", "qqq", "aapl", "nvda", "AAPL"],
      watchlistId: "watchlist-1",
    });

  assert.equal(universe.source, "signal_monitor_watchlist");
  assert.equal(universe.watchlistId, "watchlist-1");
  assert.deepEqual(universe.symbols, ["SPY", "QQQ", "AAPL", "NVDA"]);
});

test("historical backfill falls back to deployment symbols without a watchlist universe", () => {
  const universe =
    __signalOptionsAutomationInternalsForTests.buildSignalOptionsBackfillUniverse({
      deploymentSymbols: ["spy", "QQQ", "spy"],
      signalMonitorSymbols: [],
    });

  assert.equal(universe.source, "deployment");
  assert.deepEqual(universe.symbols, ["SPY", "QQQ"]);
});

test("signal-options performance filters automation trades and reports rule blockers", () => {
  const deploymentId = "11111111-1111-1111-1111-111111111111";
  const expandedProfile = {
    ...profile,
    riskCaps: {
      ...profile.riskCaps,
      maxOpenSymbols: 2,
      maxDailyLoss: 2000,
    },
  };
  const occurredAt = new Date("2026-05-12T15:00:00.000Z");
  const state = {
    activePositions: [
      {
        id: "pos-1",
        symbol: "SPY",
        lastMarkPrice: 1.4,
        premiumAtRisk: 375,
      },
      {
        id: "pos-2",
        symbol: "QQQ",
        lastMarkPrice: null,
        premiumAtRisk: 450,
      },
    ],
    risk: {
      openSymbols: 2,
      openPremium: 825,
      openUnrealizedPnl: 50,
      dailyRealizedPnl: 0,
      dailyPnl: 50,
      dailyHaltActive: false,
    },
  };
  const events = [
    {
      id: "entry-1",
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      symbol: "SPY",
      deploymentId,
      occurredAt,
      payload: {
        action: { brokerSubmission: false },
        candidate: {
          id: "SIGOPT-11111111-SPY-buy-1",
          deploymentId,
          symbol: "SPY",
          direction: "buy",
          optionRight: "call",
          timeframe: "15m",
          signalAt: occurredAt.toISOString(),
          signal: { filterState: { adx: 35, mtfDirections: [1, 1] } },
        },
        selectedExpiration: { dte: 1 },
        selectedContract: {
          right: "call",
          expirationDate: "2026-05-13",
          strike: 101,
          multiplier: 100,
        },
        orderPlan: {
          ok: true,
          quantity: 3,
          premiumAtRisk: 375,
          liquidity: { ok: true },
        },
      },
    },
    {
      id: "skip-1",
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      symbol: "MSFT",
      deploymentId,
      occurredAt: new Date("2026-05-12T15:01:00.000Z"),
      payload: {
        reason: "max_open_symbols_reached",
      },
    },
    {
      id: "mark-1",
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      symbol: "QQQ",
      deploymentId,
      occurredAt: new Date("2026-05-12T15:02:00.000Z"),
      payload: {
        reason: "position_mark_unavailable",
      },
    },
  ];
  const performance = buildSignalOptionsPerformanceFromInputs({
    deploymentId,
    profile: expandedProfile,
    state: state as never,
    events: events as never,
    shadowTradeDiagnostics: {
      context: { range: "1M" },
      tradeEvents: [
        {
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-11111111-SPY-buy-1",
          deploymentId,
        },
      ],
      openLots: [
        {
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-11111111-QQQ-buy-1",
          metadata: { candidate: { deploymentId } },
        },
      ],
      roundTrips: [
        {
          id: "trade-1",
          symbol: "SPY",
          assetClass: "option",
          quantity: 3,
          openDate: "2026-05-12T15:00:00.000Z",
          closeDate: "2026-05-12T16:00:00.000Z",
          avgOpen: 1.25,
          avgClose: 1.65,
          realizedPnl: 120,
          realizedPnlPercent: 32,
          fees: 2,
          holdDurationMinutes: 60,
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-11111111-SPY-buy-1",
          entryMetadata: {
            candidate: { deploymentId, optionRight: "call" },
            selectedExpiration: { dte: 1 },
            selectedContract: {
              right: "call",
              expirationDate: "2026-05-13",
              strike: 101,
            },
          },
          metadata: { reason: "runner_trail_stop" },
        },
        {
          id: "manual-trade",
          symbol: "AAPL",
          realizedPnl: 999,
          sourceType: "manual",
          strategyLabel: null,
          entryMetadata: {},
          metadata: {},
        },
        {
          id: "other-deployment",
          symbol: "NVDA",
          realizedPnl: 999,
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-other-NVDA-buy-1",
          entryMetadata: {
            candidate: {
              deploymentId: "22222222-2222-2222-2222-222222222222",
            },
          },
          metadata: {},
        },
      ],
    },
  });

  assert.equal(performance.summary.closedTrades, 1);
  assert.equal(performance.summary.realizedPnl, 120);
  assert.equal(performance.summary.openLots, 1);
  assert.equal(performance.openExposure.maxOpenSymbols, 2);
  assert.equal(performance.openExposure.atOpenSymbolCapacity, true);
  assert.deepEqual(performance.topBlockers[0], {
    reason: "max_open_symbols_reached",
    label: "max open symbols reached",
    count: 1,
  });
  assert.equal(
    performance.ruleAdherence.find((rule) => rule.id === "max_open_symbols")?.status,
    "warning",
  );
  assert.equal(
    performance.ruleAdherence.find((rule) => rule.id === "position_marking")?.status,
    "warning",
  );
  assert.equal(performance.recentClosedTrades[0]?.symbol, "SPY");
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

test("signal-options contract selection falls back to cheaper call strikes", () => {
  const selection =
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsContractPlanFromChain({
      contracts: [
        pricedQuote(101, "call", 12, 12.2),
        pricedQuote(102, "call", 7, 7.2),
        pricedQuote(103, "call", 6, 6.2),
      ],
      direction: "buy",
      signalPrice: 100,
      profile: {
        ...profile,
        riskCaps: { ...profile.riskCaps, maxPremiumPerEntry: 1_000 },
      },
    });

  assert.equal(selection.ok, true);
  assert.equal(selection.fallbackUsed, true);
  assert.equal(selection.selectedQuote?.contract?.strike, 102);
  assert.equal(selection.orderPlan?.ok, true);
  assert.equal(selection.orderPlan?.quantity, 1);
});

test("signal-options contract selection honors ordered strike slot preferences", () => {
  const selection =
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsContractPlanFromChain({
      contracts: [
        pricedQuote(101, "call", 12, 12.2),
        pricedQuote(102, "call", 5, 5.2),
        pricedQuote(103, "call", 4, 4.2),
      ],
      direction: "buy",
      signalPrice: 100,
      profile: resolveSignalOptionsExecutionProfile({
        ...profile,
        optionSelection: {
          ...profile.optionSelection,
          callStrikeSlots: [4, 3],
          callStrikeSlot: 4,
        },
        riskCaps: { ...profile.riskCaps, maxPremiumPerEntry: 1_000 },
      }),
    });

  assert.equal(selection.ok, true);
  assert.equal(selection.fallbackUsed, false);
  assert.equal(selection.preferredSlot, 4);
  assert.equal(selection.selectedSlot, 4);
  assert.equal(selection.selectedQuote?.contract?.strike, 102);
  assert.equal(selection.attempts.length, 1);
});

test("signal-options contract selection tries selected slots before generated fallbacks", () => {
  const selection =
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsContractPlanFromChain({
      contracts: [
        pricedQuote(101, "call", 12, 12.2),
        pricedQuote(102, "call", 12, 12.2),
        pricedQuote(103, "call", 4, 4.2),
      ],
      direction: "buy",
      signalPrice: 100,
      profile: resolveSignalOptionsExecutionProfile({
        ...profile,
        optionSelection: {
          ...profile.optionSelection,
          callStrikeSlots: [3, 5],
          callStrikeSlot: 3,
        },
        riskCaps: { ...profile.riskCaps, maxPremiumPerEntry: 1_000 },
      }),
    });

  assert.equal(selection.ok, true);
  assert.equal(selection.fallbackUsed, true);
  assert.equal(selection.preferredSlot, 3);
  assert.equal(selection.selectedSlot, 5);
  assert.equal(selection.selectedQuote?.contract?.strike, 103);
  assert.deepEqual(
    selection.attempts.map((attempt) => attempt.slot),
    [3, 5],
  );
});

test("signal-options contract selection falls back to cheaper put strikes", () => {
  const selection =
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsContractPlanFromChain({
      contracts: [
        pricedQuote(97, "put", 6, 6.2),
        pricedQuote(98, "put", 7, 7.2),
        pricedQuote(99, "put", 12, 12.2),
      ],
      direction: "sell",
      signalPrice: 100,
      profile: {
        ...profile,
        riskCaps: { ...profile.riskCaps, maxPremiumPerEntry: 1_000 },
      },
    });

  assert.equal(selection.ok, true);
  assert.equal(selection.fallbackUsed, true);
  assert.equal(selection.selectedQuote?.contract?.strike, 98);
  assert.equal(selection.orderPlan?.ok, true);
  assert.equal(selection.orderPlan?.quantity, 1);
});

test("signal-options contract fallback keeps liquidity gates intact", () => {
  const selection =
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsContractPlanFromChain({
      contracts: [
        pricedQuote(101, "call", 12, 12.2),
        pricedQuote(102, "call", 5, 12),
        pricedQuote(103, "call", 4, 10),
      ],
      direction: "buy",
      signalPrice: 100,
      profile: {
        ...profile,
        riskCaps: { ...profile.riskCaps, maxPremiumPerEntry: 1_000 },
      },
    });

  assert.equal(selection.ok, false);
  assert.equal(selection.selectedQuote?.contract?.strike, 101);
  assert.equal(selection.orderPlan?.ok, false);
  assert.equal(selection.orderPlan?.reason, "premium_budget_too_small");
  assert.equal(selection.attempts[1]?.orderPlan.reason, "spread_too_wide");
});

test("signal-options scan requests a bounded strike window for selected and fallback slots", () => {
  const strikesAroundMoney =
    __signalOptionsAutomationInternalsForTests.signalOptionsStrikesAroundMoney;

  assert.equal(
    strikesAroundMoney({ profile, optionRight: "put" }),
    3,
  );
  assert.equal(
    strikesAroundMoney({ profile, optionRight: "call" }),
    3,
  );
  assert.equal(
    strikesAroundMoney({
      profile: {
        ...profile,
        optionSelection: {
          ...profile.optionSelection,
          putStrikeSlot: 0,
          callStrikeSlot: 5,
        },
      },
      optionRight: "put",
    }),
    3,
  );
  assert.equal(
    strikesAroundMoney({
      profile: {
        ...profile,
        optionSelection: {
          ...profile.optionSelection,
          putStrikeSlot: 0,
          callStrikeSlot: 5,
        },
      },
      optionRight: "call",
    }),
    3,
  );
});

test("seen signal keys allow retries after transient option-chain skips", () => {
  const signalKey = "profile:SPY:15m:sell:2026-05-12T15:00:00.000Z";
  const seenSignalKeys =
    __signalOptionsAutomationInternalsForTests.seenSignalKeys;

  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "no_contract_for_strike_slot",
            chainDebug: {
              reason: "options_upstream_failure",
            },
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "option_chain_backoff",
            retryable: true,
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "option_expiration_backoff",
            retryable: true,
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "bear_regime_gate_failed",
            entryGate: {
              reasons: ["adx_below_minimum"],
            },
          },
        },
      ] as never),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "daily_loss_halt_active",
              selectedContract: { ticker: "SPY20260522C500" },
            },
          },
        ] as never,
        { dailyLossHaltEnabled: false },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "daily_loss_halt_active",
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "daily_loss_halt_active",
            selectedContract: { ticker: "SPY20260522C500" },
          },
        },
      ] as never),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "max_open_symbols_reached",
            candidate: { selectedContract: { ticker: "SPY20260522C500" } },
          },
        },
      ] as never),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "algo_gateway_not_ready",
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "market_session_quiet",
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "market_session_quiet",
              preflight: true,
            },
          },
        ] as never,
        { gatewayReady: false },
      ),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "market_session_quiet",
              preflight: true,
            },
          },
        ] as never,
        { gatewayReady: true },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "market_session_quiet",
              selectedContract: { ticker: "SPY20260522C500" },
            },
          },
        ] as never,
        { gatewayReady: true },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "algo_gateway_not_ready",
              selectedContract: { ticker: "SPY20260522C500" },
            },
          },
        ] as never,
        { gatewayReady: false },
      ),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "algo_gateway_not_ready",
              selectedContract: { ticker: "SPY20260522C500" },
            },
          },
        ] as never,
        { gatewayReady: true },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "premium_budget_too_small",
              premiumCap: 500,
            },
          },
        ] as never,
        { currentPremiumCap: 1_000 },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "missing_bid_ask",
            retryable: true,
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "premium_budget_too_small",
              premiumCap: 1_000,
            },
          },
        ] as never,
        { currentPremiumCap: 1_000 },
      ),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "missing_bid_ask",
            },
          },
        ] as never,
        { forceRetryMarketData: true },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "same_direction_position_open",
              candidate: {
                symbol: "SPY",
                direction: "buy",
              },
            },
          },
        ] as never,
        { activePositions: [] },
      ),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            payload: {
              signalKey,
              reason: "same_direction_position_open",
              candidate: {
                symbol: "SPY",
                direction: "buy",
              },
            },
          },
        ] as never,
        {
          activePositions: [
            {
              symbol: "SPY",
              direction: "buy",
            },
          ] as never,
        },
      ),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "no_expiration_in_dte_window",
            expirationsDebug: {
              reason: "options_backoff",
            },
          },
        },
        {
          eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
          payload: { signalKey },
        },
      ] as never),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys(
        [
          {
            eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
            occurredAt: new Date("2026-05-12T15:01:00.000Z"),
            payload: {
              signalKey,
              reason: "no_expiration_in_dte_window",
            },
          },
        ] as never,
        { profileUpdatedAt: new Date("2026-05-12T15:02:00.000Z") },
      ),
    ),
    [],
  );
});

test("signal-options classifies option market-data backoff without hiding it as contract misses", () => {
  const {
    classifySignalOptionsSkipReason,
    optionBackoffFromDebug,
    optionChainBackoffFromAttempts,
  } = __signalOptionsAutomationInternalsForTests;

  const chainBackoff = optionChainBackoffFromAttempts([
    {
      contractCount: 0,
      chainDebug: {
        reason: "options_backoff",
        backoffRemainingMs: 1234,
      },
    },
  ]);

  assert.equal(chainBackoff?.reason, "option_chain_backoff");
  assert.equal(chainBackoff?.source, "chain");
  assert.equal(chainBackoff?.backoffRemainingMs, 1234);
  assert.equal(
    optionChainBackoffFromAttempts([
      {
        contractCount: 1,
        chainDebug: {
          reason: "options_backoff",
          backoffRemainingMs: 1234,
        },
      },
    ]),
    null,
  );

  const expirationBackoff = optionBackoffFromDebug({
    debug: {
      reason: "options_backoff",
      backoffRemainingMs: 555,
    },
    reason: "option_expiration_backoff",
    source: "expiration",
  });
  assert.equal(expirationBackoff?.reason, "option_expiration_backoff");
  assert.equal(expirationBackoff?.source, "expiration");
  assert.equal(expirationBackoff?.backoffRemainingMs, 555);

  assert.equal(
    classifySignalOptionsSkipReason("option_chain_backoff"),
    "contract_resolution",
  );
  assert.equal(
    classifySignalOptionsSkipReason("option_expiration_backoff"),
    "contract_resolution",
  );
});

test("signal-options risk halts block execution after contract planning", () => {
  const executionBlocker =
    __signalOptionsAutomationInternalsForTests.signalOptionsExecutionBlocker;
  const gatewayExecutionBlocker =
    __signalOptionsAutomationInternalsForTests.signalOptionsGatewayExecutionBlocker;

  assert.deepEqual(
    executionBlocker({
      dailyHaltActive: true,
      dailyPnl: -1250,
      profile,
      openSymbols: 0,
    }),
    {
      reason: "daily_loss_halt_active",
      detail: {
        dailyPnl: -1250,
        maxDailyLoss: profile.riskCaps.maxDailyLoss,
      },
    },
  );
  assert.deepEqual(
    executionBlocker({
      dailyHaltActive: false,
      dailyPnl: 0,
      profile,
      openSymbols: 0,
      positionMarkHaltActive: true,
      degradedPositionSymbols: ["TQQQ", "SMH", "SMH"],
    }),
    {
      reason: "position_mark_feed_degraded",
      detail: {
        symbols: ["SMH", "TQQQ"],
        count: 2,
      },
    },
  );
  assert.deepEqual(
    executionBlocker({
      dailyHaltActive: false,
      dailyPnl: 0,
      profile: {
        ...profile,
        riskCaps: { ...profile.riskCaps, maxOpenSymbols: 2 },
      },
      openSymbols: 2,
    }),
    {
      reason: "max_open_symbols_reached",
      detail: {
        openSymbols: 2,
        maxOpenSymbols: 2,
      },
    },
  );
  assert.equal(
    executionBlocker({
      dailyHaltActive: false,
      dailyPnl: 0,
      profile,
      openSymbols: 0,
    }),
    null,
  );
  assert.equal(
    executionBlocker({
      dailyHaltActive: false,
      dailyPnl: 0,
      profile: {
        ...profile,
        positionHaltControls: {
          ...profile.positionHaltControls,
          positionMarkFeedHaltEnabled: false,
        },
      },
      openSymbols: 0,
      positionMarkHaltActive: true,
      degradedPositionSymbols: ["TQQQ"],
    }),
    null,
  );
  assert.equal(
    executionBlocker({
      dailyHaltActive: true,
      dailyPnl: -1250,
      profile: {
        ...profile,
        riskHaltControls: {
          ...profile.riskHaltControls,
          dailyLossHaltEnabled: false,
        },
      },
      openSymbols: 0,
    }),
    null,
  );
  assert.equal(
    executionBlocker({
      dailyHaltActive: false,
      dailyPnl: 0,
      profile: {
        ...profile,
        riskCaps: { ...profile.riskCaps, maxOpenSymbols: 2 },
        riskHaltControls: {
          ...profile.riskHaltControls,
          openSymbolCapEnabled: false,
        },
      },
      openSymbols: 2,
    }),
    null,
  );
  assert.equal(
    gatewayExecutionBlocker({
      ready: true,
      reason: null,
      message: "ready",
      diagnostics: {},
    }),
    null,
  );
  assert.deepEqual(
    gatewayExecutionBlocker({
      ready: false,
      reason: "gateway_socket_disconnected",
      message: "IB Gateway disconnected.",
      diagnostics: { connected: false },
    }),
    {
      reason: "gateway_socket_disconnected",
      detail: {
        readiness: {
          ready: false,
          reason: "gateway_socket_disconnected",
          message: "IB Gateway disconnected.",
          diagnostics: { connected: false },
        },
      },
    },
  );
  assert.deepEqual(
    gatewayExecutionBlocker({
      ready: false,
      reason: "market_session_quiet",
      message: "The market session is closed for algorithm execution.",
      diagnostics: { strictReason: "market_session_quiet" },
    }),
    {
      reason: "market_session_quiet",
      detail: {
        readiness: {
          ready: false,
          reason: "market_session_quiet",
          message: "The market session is closed for algorithm execution.",
          diagnostics: { strictReason: "market_session_quiet" },
        },
      },
    },
  );
  assert.equal(
    gatewayExecutionBlocker(
      {
        ready: false,
        reason: "gateway_socket_disconnected",
        message: "IB Gateway disconnected.",
        diagnostics: { connected: false },
      },
      {
        ...profile,
        infrastructureHaltControls: {
          ...profile.infrastructureHaltControls,
          gatewayReadinessBlockEnabled: false,
        },
      },
    ),
    null,
  );
});

test("signal-options candidates preserve Pyrus Signals signal to shadow action mapping", () => {
  const signalAt = "2026-04-28T15:30:00.000Z";
  const state = {
    profileId: "11111111-1111-1111-1111-111111111111",
    symbol: "spy",
    timeframe: "15m",
    currentSignalDirection: "sell",
    currentSignalAt: signalAt,
    currentSignalPrice: 508.25,
    latestBarAt: "2026-04-28T15:35:00.000Z",
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
  };
  const candidate =
    __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
      deployment: {
        id: "deployment-123456789",
        name: "Shadow Options",
      } as never,
      state: state as never,
      signalAt,
      signalKey: "profile:SPY:15m:sell:2026-04-28T15:30:00.000Z",
      signalMetadata: {
        eventId: "event-1",
        source: "pyrus-signals",
        filterState: { mtf: "aligned" },
      },
    });

  assert.equal(candidate.optionRight, "put");
  assert.equal(candidate.action?.optionAction, "buy_put");
  assert.equal(candidate.action?.executionMode, "shadow");
  assert.equal(candidate.action?.destinationAccountId, "shadow");
  assert.equal(candidate.action?.brokerSubmission, false);
  assert.equal(candidate.signal?.source, "pyrus-signals");
  assert.equal(candidate.signal?.barsSinceSignal, 1);
  assert.deepEqual(candidate.signal?.filterState, { mtf: "aligned" });
});

test("fresh signal snapshots create potential shadow action candidates", () => {
  const signalAt = "2026-04-28T15:30:00.000Z";
  const deployment = {
    id: "deployment-123456789",
    name: "Shadow Options",
  } as never;
  const baseSignal = {
    profileId: "11111111-1111-1111-1111-111111111111",
    signalKey: "profile:SPY:15m:buy:2026-04-28T15:30:00.000Z",
    source: "pyrus-signals",
    eventId: null,
    symbol: "spy",
    timeframe: "15m",
    direction: "buy",
    signalAt,
    signalPrice: 508.25,
    latestBarAt: "2026-04-28T15:35:00.000Z",
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
    filterState: { mtf: "aligned" },
  };

  const buyCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: baseSignal as never,
    });
  const sellCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        ...baseSignal,
        signalKey: "profile:QQQ:15m:sell:2026-04-28T15:30:00.000Z",
        symbol: "qqq",
        direction: "sell",
      } as never,
    });
  const staleCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        ...baseSignal,
        fresh: false,
      } as never,
    });
  const stillFreshCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        ...baseSignal,
        latestBarAt: "2026-04-28T15:45:00.000Z",
        barsSinceSignal: 6,
      } as never,
    });

  assert.ok(buyCandidate);
  assert.equal(buyCandidate.symbol, "SPY");
  assert.equal(buyCandidate.status, "candidate");
  assert.equal(buyCandidate.optionRight, "call");
  assert.equal(buyCandidate.action?.optionAction, "buy_call");
  assert.equal(buyCandidate.action?.executionMode, "shadow");
  assert.equal(buyCandidate.selectedContract, null);
  assert.equal(buyCandidate.reason, null);
  assert.ok(sellCandidate);
  assert.equal(sellCandidate.optionRight, "put");
  assert.equal(sellCandidate.action?.optionAction, "buy_put");
  assert.equal(staleCandidate, null);
  assert.ok(stillFreshCandidate);
  assert.equal(stillFreshCandidate.symbol, "SPY");
});

test("signal-options state only treats fresh signal states as action rows", () => {
  const isActionable =
    __signalOptionsAutomationInternalsForTests.isSignalOptionsActionableSignalState;

  assert.equal(
    isActionable({
      fresh: true,
      currentSignalDirection: "buy",
      currentSignalAt: "2026-05-28T20:00:00.000Z",
      barsSinceSignal: 0,
    } as never),
    true,
  );
  assert.equal(
    isActionable({
      fresh: true,
      currentSignalDirection: "buy",
      currentSignalAt: "2026-05-28T19:55:00.000Z",
      barsSinceSignal: 1,
    } as never),
    true,
  );
  assert.equal(
    isActionable({
      fresh: true,
      currentSignalDirection: "buy",
      currentSignalAt: "2026-05-28T19:50:00.000Z",
      barsSinceSignal: 6,
    } as never),
    true,
  );
  assert.equal(
    isActionable({
      fresh: false,
      currentSignalDirection: "buy",
      currentSignalAt: "2026-05-28T19:35:00.000Z",
      barsSinceSignal: 0,
    } as never),
    false,
  );
  assert.equal(
    isActionable({
      fresh: true,
      currentSignalDirection: null,
      currentSignalAt: "2026-05-28T20:00:00.000Z",
      barsSinceSignal: 0,
    } as never),
    false,
  );
});

test("scan events override matching live signal previews without losing mappings", () => {
  const signalAt = "2026-04-28T15:30:00.000Z";
  const deployment = {
    id: "deployment-123456789",
    name: "Shadow Options",
  } as never;
  const preview =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        profileId: "11111111-1111-1111-1111-111111111111",
        signalKey: "profile:SPY:15m:buy:2026-04-28T15:30:00.000Z",
        source: "pyrus-signals",
        eventId: null,
        symbol: "SPY",
        timeframe: "15m",
        direction: "buy",
        signalAt,
        signalPrice: 508.25,
        latestBarAt: "2026-04-28T15:35:00.000Z",
        barsSinceSignal: 1,
        fresh: true,
        status: "ok",
        filterState: null,
      } as never,
    });
  assert.ok(preview);

  const eventCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromEvent({
      id: "event-1",
      deploymentId: "deployment-123456789",
      symbol: "SPY",
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T15:31:00.000Z"),
      payload: {
        candidate: {
          id: preview.id,
          deploymentId: "deployment-123456789",
          deploymentName: ["Ray", "Replica Signal Options Shadow Paper"].join(""),
          symbol: "SPY",
          direction: "buy",
          optionRight: "call",
          timeframe: "15m",
          signalAt,
          signalPrice: 508.25,
        },
        selectedContract: {
          ticker: "SPY260429C510",
          strike: 510,
          right: "call",
        },
        reason: "spread_too_wide",
      },
    } as never);
  assert.ok(eventCandidate);

  const merged =
    __signalOptionsAutomationInternalsForTests.mergeSignalOptionsCandidate(
      preview,
      eventCandidate,
    );

  assert.equal(eventCandidate.id, preview.id);
  assert.equal(
    eventCandidate.deploymentName,
    "Pyrus Signals Options Shadow Paper",
  );
  assert.equal(merged.id, preview.id);
  assert.equal(merged.deploymentName, "Pyrus Signals Options Shadow Paper");
  assert.equal(merged.status, "skipped");
  assert.equal(merged.reason, "spread_too_wide");
  assert.deepEqual(merged.selectedContract, {
    ticker: "SPY260429C510",
    strike: 510,
    right: "call",
  });
  assert.equal(merged.action?.optionAction, "buy_call");
  assert.equal(merged.signal?.signalKey, preview.signal?.signalKey);
});

test("later shadow entries clear earlier skipped candidate blockers", () => {
  const signalAt = "2026-05-18T18:15:00.000Z";
  const baseEvent = {
    deploymentId: "deployment-123456789",
    symbol: "VXX",
    occurredAt: new Date("2026-05-18T18:31:57.000Z"),
  };
  const candidate = {
    id: "SIGOPT-deploy-VXX-buy-1779128100000",
    deploymentId: "deployment-123456789",
    symbol: "VXX",
    direction: "buy",
    optionRight: "call",
    timeframe: "5m",
    signalAt,
    signalPrice: 27.34,
  };
  const skipped =
    __signalOptionsAutomationInternalsForTests.candidateFromEvent({
      ...baseEvent,
      id: "event-skip",
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      payload: {
        candidate,
        reason: "no_contract_for_strike_slot",
      },
    } as never);
  const entry =
    __signalOptionsAutomationInternalsForTests.candidateFromEvent({
      ...baseEvent,
      id: "event-entry",
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      occurredAt: new Date("2026-05-18T18:36:58.000Z"),
      payload: {
        candidate: {
          ...candidate,
          selectedContract: { ticker: "VXX20260522C27" },
          orderPlan: { quantity: 3 },
        },
        selectedContract: { ticker: "VXX20260522C27" },
        orderPlan: { quantity: 3 },
      },
    } as never);
  const mark =
    __signalOptionsAutomationInternalsForTests.candidateFromEvent({
      ...baseEvent,
      id: "event-mark",
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      occurredAt: new Date("2026-05-18T18:42:13.000Z"),
      payload: {
        position: {
          candidateId: candidate.id,
          symbol: "VXX",
          direction: "buy",
          selectedContract: { ticker: "VXX20260522C27" },
        },
      },
    } as never);
  assert.ok(skipped);
  assert.ok(entry);
  assert.ok(mark);

  const mergedAfterEntry =
    __signalOptionsAutomationInternalsForTests.mergeSignalOptionsCandidate(
      skipped,
      entry,
    );
  const mergedAfterMark =
    __signalOptionsAutomationInternalsForTests.mergeSignalOptionsCandidate(
      mergedAfterEntry,
      mark,
    );
  const action =
    __signalOptionsAutomationInternalsForTests.deriveCandidateActionStatus({
      candidate: mergedAfterMark,
      events: [
        { eventType: SIGNAL_OPTIONS_SKIPPED_EVENT },
        { eventType: SIGNAL_OPTIONS_ENTRY_EVENT },
        { eventType: SIGNAL_OPTIONS_MARK_EVENT },
      ] as never,
      shadowLink: { orderId: "shadow-order", positionQuantity: 3 } as never,
    });

  assert.equal(mergedAfterMark.status, "open");
  assert.equal(mergedAfterMark.reason, null);
  assert.equal(action.actionStatus, "shadow_filled");
});

test("signal-options candidate with closed shadow position reports closed", () => {
  const action =
    __signalOptionsAutomationInternalsForTests.deriveCandidateActionStatus({
      candidate: {
        id: "candidate-smci",
        status: "open",
        orderPlan: { quantity: 5 },
      } as never,
      events: [{ eventType: SIGNAL_OPTIONS_ENTRY_EVENT }] as never,
      shadowLink: {
        orderId: "shadow-order",
        fillId: "shadow-fill",
        positionId: "shadow-position",
        positionQuantity: 0,
      } as never,
    });

  assert.equal(action.actionStatus, "closed");
  assert.equal(action.syncStatus, "synced");
});

test("signal-options deployments normalize execution to the shadow account", () => {
  assert.equal(
    normalizeAlgoDeploymentProviderAccountId({
      providerAccountId: "DU1234567",
      config: { signalOptions: profile },
    }),
    SHADOW_PROVIDER_ACCOUNT_ID,
  );
  assert.equal(
    normalizeAlgoDeploymentProviderAccountId({
      providerAccountId: "DU1234567",
      config: { parameters: { executionMode: "signal_options" } },
    }),
    SHADOW_PROVIDER_ACCOUNT_ID,
  );
  assert.equal(
    normalizeAlgoDeploymentProviderAccountId({
      providerAccountId: "DU1234567",
      config: { parameters: { executionMode: "backtest" } },
    }),
    "DU1234567",
  );
});

test("signal-options profile normalization fills entry-gate policy defaults", () => {
  const legacyProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        bearishRegime: {
          enabled: false,
        },
      },
    },
  });
  const customProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: {
          enabled: false,
          requiredCount: 2,
        },
        blockedPutSymbols: ["sqqq", "PSQ", "sqqq"],
      },
      exitPolicy: {
        earlyExitBars: 3,
        earlyExitLossPct: 15,
        overnightExitEnabled: true,
      },
    },
  });

  assert.deepEqual(legacyProfile.entryGate.mtfAlignment, {
    enabled: true,
    requiredCount: 2,
  });
  assert.ok(legacyProfile.entryGate.blockedPutSymbols.includes("SQQQ"));
  assert.equal(legacyProfile.entryGate.bearishRegime.enabled, false);
  assert.deepEqual(customProfile.entryGate.mtfAlignment, {
    enabled: false,
    requiredCount: 2,
  });
  assert.deepEqual(customProfile.entryGate.blockedPutSymbols, ["PSQ", "SQQQ"]);
  assert.equal(customProfile.exitPolicy.hardStopPct, -40);
  assert.equal(customProfile.exitPolicy.earlyExitBars, 3);
  assert.equal(customProfile.exitPolicy.earlyExitLossPct, 15);
  assert.equal(customProfile.exitPolicy.overnightExitEnabled, true);
  assert.equal(customProfile.exitPolicy.overnightMinGainPct, 20);
});

test("signal-options entry gate requires MTF alignment and blocks inverse puts", () => {
  const buildCandidate = (
    direction: "buy" | "sell",
    filterState: Record<string, unknown>,
    symbol = "SPY",
  ) =>
    __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
      deployment: {
        id: "deployment-123456789",
        name: "Shadow Options",
      } as never,
      state: {
        profileId: "11111111-1111-1111-1111-111111111111",
        symbol,
        timeframe: "15m",
        currentSignalDirection: direction,
        currentSignalAt: "2026-04-28T15:30:00.000Z",
        currentSignalPrice: 508.25,
        latestBarAt: "2026-04-28T15:45:00.000Z",
        barsSinceSignal: 1,
        fresh: true,
        status: "ok",
      } as never,
      signalAt: "2026-04-28T15:30:00.000Z",
      signalKey: `profile:${symbol}:15m:${direction}:2026-04-28T15:30:00.000Z`,
      signalMetadata: {
        eventId: "event-1",
        source: "pyrus-signals",
        filterState,
      },
    });

  const bullishPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 18,
        mtfDirections: [1, 1, 1],
      }),
      profile,
    });
  const mixedPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 28,
        mtfDirections: [-1, 1, 1],
      }),
      profile,
    });
  const partiallyAlignedPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 23,
        mtfDirections: [-1, -1, 1],
      }),
      profile,
    });
  const alignedPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 28,
        mtfDirections: [-1, -1, -1],
      }),
      profile,
    });
  const weakAlignedPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 24,
        mtfDirections: [-1, -1, -1],
      }),
      profile,
    });
  const call =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("buy", {
        adx: 12,
        mtfDirections: [1, 1, 1],
      }),
      profile,
    });
  const mixedCall =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("buy", {
        adx: 35,
        mtfDirections: [-1, 1, 1],
      }),
      profile,
    });
  const blockedInversePut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate(
        "sell",
        {
          adx: 35,
          mtfDirections: [-1, -1, -1],
        },
        "SQQQ",
      ),
      profile,
    });
  const allowedInverseCall =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate(
        "buy",
        {
          adx: 35,
          mtfDirections: [1, 1, 1],
        },
        "SQQQ",
      ),
      profile,
    });
  const allEntryControlsOff =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate(
        "sell",
        {
          adx: 10,
          mtfDirections: [1, 1, 1],
        },
        "SQQQ",
      ),
      profile: {
        ...profile,
        entryHaltControls: {
          mtfAlignmentEnabled: false,
          inversePutBlocklistEnabled: false,
          bearishRegimeEnabled: false,
        },
      },
    });

  assert.equal(bullishPut.ok, false);
  assert.equal(bullishPut.reason, "mtf_not_aligned");
  assert.deepEqual(bullishPut.reasons, [
    "mtf_not_aligned",
    "adx_below_minimum",
    "mtf_fully_bullish",
  ]);
  assert.equal(mixedPut.ok, false);
  assert.equal(mixedPut.reason, "mtf_not_aligned");
  assert.equal(partiallyAlignedPut.ok, true);
  assert.equal(partiallyAlignedPut.effectiveMinAdx, 22);
  assert.equal(alignedPut.ok, true);
  assert.equal(weakAlignedPut.ok, true);
  assert.equal(call.ok, true);
  assert.equal(mixedCall.ok, true);
  assert.equal(blockedInversePut.ok, false);
  assert.equal(blockedInversePut.reason, "inverse_put_blocked");
  assert.deepEqual(blockedInversePut.reasons, ["inverse_put_blocked"]);
  assert.equal(allowedInverseCall.ok, true);
  assert.equal(allEntryControlsOff.ok, true);
});

test("signal-options tuned exit profile uses the aggressive trail ladder", () => {
  const comboProfile = tunedSignalOptionsExecutionProfile;
  const inactive =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 4.5,
      markPrice: 4.4,
      profile: comboProfile,
    });
  const active =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 5.5,
      markPrice: 4.5,
      profile: comboProfile,
    });
  const fiveX =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 1,
      peakPrice: 5,
      markPrice: 3.4,
      profile: comboProfile,
    });
  const tenX =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 1,
      peakPrice: 10,
      markPrice: 8.4,
      profile: comboProfile,
    });

  assert.equal(inactive.hardStopPrice, 2.8);
  assert.equal(inactive.trailActive, false);
  assert.equal(inactive.stopPrice, 2.8);
  assert.equal(active.hardStopPrice, 2.8);
  assert.equal(active.trailActive, true);
  assert.equal(active.givebackPct, 25);
  assert.equal(active.trailStopPrice, 4.6);
  assert.equal(active.stopPrice, 4.6);
  assert.equal(active.exitReason, "runner_trail_stop");
  assert.deepEqual(active.progressiveTrailStep, {
    activationPct: 30,
    minLockedGainPct: 15,
    givebackPct: 25,
  });
  assert.equal(fiveX.givebackPct, 30);
  assert.equal(fiveX.trailStopPrice, 3.5);
  assert.equal(fiveX.exitReason, "runner_trail_stop");
  assert.equal(tenX.givebackPct, 15);
  assert.equal(tenX.trailStopPrice, 8.5);
  assert.equal(tenX.exitReason, "runner_trail_stop");
});

test("signal-options wire trail exits on structural break while premium holds", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      trailActivationPct: 35,
      wireGreekTrail: {
        enabled: true,
        rungByProfit: [{ activationPct: 35, rung: "wire3" }],
      },
    },
  });
  const holding =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 6,
      markPrice: 5.4,
      profile,
      direction: "buy",
      currentGreeks: {
        delta: 0.65,
        gamma: 0.07,
        theta: -0.05,
        updatedAt: new Date("2026-05-28T14:30:00.000Z"),
      },
      entryGreeks: { delta: 0.6 },
      now: new Date("2026-05-28T14:30:05.000Z"),
      wireContext: {
        latestBarAt: "2026-05-28T14:30:00.000Z",
        latestClose: 101,
        regimeDirection: 1,
        previousRegimeDirection: 1,
        lowerBand: 100,
        bullWires: [99, 98, 97],
      },
    });
  const broken =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 6,
      markPrice: 5.4,
      profile,
      direction: "buy",
      currentGreeks: {
        delta: 0.65,
        gamma: 0.07,
        theta: -0.05,
        updatedAt: new Date("2026-05-28T14:30:00.000Z"),
      },
      entryGreeks: { delta: 0.6 },
      now: new Date("2026-05-28T14:30:05.000Z"),
      wireContext: {
        latestBarAt: "2026-05-28T14:30:00.000Z",
        latestClose: 96.9,
        regimeDirection: 1,
        previousRegimeDirection: 1,
        lowerBand: 100,
        bullWires: [99, 98, 97],
      },
    });

  assert.equal(holding.exitReason, null);
  assert.equal(holding.wireTrail.active, true);
  assert.equal(holding.wireTrail.selectedRung, "wire3");
  assert.equal(holding.wireTrail.structureBreak, false);
  assert.equal(broken.exitReason, "wire_structure_break");
  assert.equal(broken.wireTrail.structureBreak, true);
});

test("signal-options wire trail greek layer tightens and stale greeks fall back", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      wireGreekTrail: {
        enabled: true,
        rungByProfit: [{ activationPct: 35, rung: "wire2" }],
      },
    },
  });
  const freshTighten =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 6,
      markPrice: 5.4,
      profile,
      direction: "buy",
      currentGreeks: {
        delta: 0.45,
        gamma: 0.02,
        theta: -0.5,
        updatedAt: new Date("2026-05-28T14:30:00.000Z"),
      },
      entryGreeks: { delta: 0.6 },
      now: new Date("2026-05-28T14:30:05.000Z"),
      wireContext: {
        latestBarAt: "2026-05-28T14:30:00.000Z",
        latestClose: 98.8,
        regimeDirection: 1,
        previousRegimeDirection: 1,
        lowerBand: 100,
        bullWires: [99, 98, 97],
      },
    });
  const staleNeutral =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 6,
      markPrice: 5.4,
      profile,
      direction: "buy",
      currentGreeks: {
        delta: 0.75,
        gamma: 0.07,
        theta: -0.05,
        updatedAt: new Date("2026-05-28T14:29:00.000Z"),
      },
      entryGreeks: { delta: 0.6 },
      now: new Date("2026-05-28T14:30:00.000Z"),
      wireContext: {
        latestBarAt: "2026-05-28T14:30:00.000Z",
        latestClose: 98.5,
        regimeDirection: 1,
        previousRegimeDirection: 1,
        lowerBand: 100,
        bullWires: [99, 98, 97],
      },
    });

  assert.equal(freshTighten.wireTrail.selectedRung, "wire1");
  assert.equal(freshTighten.exitReason, "wire_structure_break");
  assert.deepEqual(freshTighten.wireTrail.greekAdjustment.reasons, [
    "delta_decay",
    "theta_burden",
  ]);
  assert.equal(staleNeutral.wireTrail.selectedRung, "wire2");
  assert.equal(staleNeutral.wireTrail.greekFresh, false);
  assert.equal(staleNeutral.wireTrail.greekFallbackReason, "stale_greeks");
});

test("signal-options live marks reject frozen market data for exits", () => {
  const frozenQuote: SignalOptionsOptionQuote = {
    ...quote(100, "call"),
    bid: 1.41,
    ask: 1.41,
    last: 1.41,
    mark: 1.41,
    quoteFreshness: "live",
    marketDataMode: "frozen",
  };
  const liveQuote: SignalOptionsOptionQuote = {
    ...frozenQuote,
    quoteFreshness: "live",
    marketDataMode: "live",
  };

  const frozenLiquidity = resolveSignalOptionsLiquidity(frozenQuote, profile);
  const frozenResolution =
    __signalOptionsAutomationInternalsForTests.resolvePositionMarkQuote({
      quote: frozenQuote,
      profile,
    });

  assert.equal(frozenLiquidity.ok, false);
  assert.ok(frozenLiquidity.reasons.includes("quote_not_fresh"));
  assert.equal(frozenResolution.ok, false);
  assert.equal(frozenResolution.reason, "quote_not_fresh");
  assert.equal(
    __signalOptionsAutomationInternalsForTests.isSignalOptionsLiveExitQuoteEligible({
      quote: frozenQuote,
      markSource: "provider_snapshot",
      usedShadowMarkFallback: false,
    }),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.isSignalOptionsLiveExitQuoteEligible({
      quote: liveQuote,
      markSource: "provider_snapshot",
      usedShadowMarkFallback: false,
    }),
    true,
  );
});

test("signal-options live exits reject shadow mark fallback pricing", () => {
  const fallbackQuote: SignalOptionsOptionQuote = {
    ...quote(100, "call"),
    bid: null,
    ask: null,
    last: 4.17,
    mark: 4.17,
    quoteFreshness: "shadow_position_mark",
    marketDataMode: "shadow",
  };

  assert.equal(
    __signalOptionsAutomationInternalsForTests.isSignalOptionsLiveExitQuoteEligible({
      quote: fallbackQuote,
      markSource: "shadow_position_mark",
      usedShadowMarkFallback: false,
    }),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.isSignalOptionsLiveExitQuoteEligible({
      quote: fallbackQuote,
      markSource: "provider_snapshot",
      usedShadowMarkFallback: true,
    }),
    false,
  );
});

test("signal-options shadow mark fallback only uses in-session option marks", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const fallbackBody = source.match(
    /async function readShadowPositionMarkFallback\([\s\S]*?\nfunction isFreshShadowPositionMarkFallback/,
  )?.[0];

  assert.ok(fallbackBody);
  assert.match(fallbackBody, /eligibleMarks = marks\.filter/);
  assert.match(
    fallbackBody,
    /isLiveOptionTradingSession\(mark\.asOf,\s*position\.selectedContract\)/,
  );
  assert.match(fallbackBody, /peak = eligibleMarks\.reduce/);
});

test("signal-options active position refresh blocks live mark hydration under pressure caps", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const refreshBody = source.match(
    /async function refreshActivePosition\([\s\S]*?\nasync function emitSkippedCandidate/,
  )?.[0];

  assert.ok(refreshBody);
  assert.match(refreshBody, /positionMarksAllowed/);
  assert.match(refreshBody, /resource_pressure_position_marks_blocked/);
  assert.match(refreshBody, /if \(!livePositionMarksAllowed\)/);
  assert.match(refreshBody, /if \(livePositionMarksAllowed && !markState\.resolution\?\.ok\)/);
});

test("signal-options progressive trail ladder raises locked profit by peak gain", () => {
  const ladderProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      hardStopPct: -30,
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 25, minLockedGainPct: 0, givebackPct: 35 },
        { activationPct: 35, minLockedGainPct: 15, givebackPct: 25 },
        { activationPct: 50, minLockedGainPct: 25, givebackPct: 25 },
      ],
      tightenAtFiveXGivebackPct: 30,
      tightenAtTenXGivebackPct: 15,
    },
  });

  const inactive =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 10,
      peakPrice: 12.4,
      markPrice: 10,
      profile: ladderProfile,
    });
  const firstStep =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 10,
      peakPrice: 12.5,
      markPrice: 9.9,
      profile: ladderProfile,
    });
  const secondStep =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 10,
      peakPrice: 13.5,
      markPrice: 11.4,
      profile: ladderProfile,
    });
  const thirdStep =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 10,
      peakPrice: 15,
      markPrice: 12.4,
      profile: ladderProfile,
    });

  assert.equal(inactive.trailActive, false);
  assert.equal(inactive.exitReason, null);
  assert.equal(firstStep.trailActive, true);
  assert.equal(firstStep.trailStopPrice, 10);
  assert.equal(firstStep.exitReason, "runner_trail_stop");
  assert.equal(secondStep.trailStopPrice, 11.5);
  assert.equal(secondStep.exitReason, "runner_trail_stop");
  assert.equal(thirdStep.trailStopPrice, 12.5);
  assert.equal(thirdStep.exitReason, "runner_trail_stop");
});

test("signal-options early invalidation exits losing positions after configured signal bars", () => {
  const earlyProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      exitPolicy: {
        earlyExitBars: 3,
        earlyExitLossPct: 15,
      },
    },
  });

  const tooSoon =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 4.6,
      markPrice: 3.2,
      profile: earlyProfile,
      barsSinceEntry: 2,
    });
  const invalidated =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 4.6,
      markPrice: 3.2,
      profile: earlyProfile,
      barsSinceEntry: 3,
    });

  assert.equal(tooSoon.exitReason, null);
  assert.equal(invalidated.exitReason, "early_invalidation");
  assert.ok(Math.abs(invalidated.markReturnPct + 20) < 1e-9);
});

test("signal-options overnight policy exits weak holds and tightened runners", () => {
  const overnightProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      exitPolicy: {
        overnightExitEnabled: true,
        overnightMinGainPct: 20,
        overnightRunnerGivebackPct: 15,
      },
    },
  });

  const weakHold =
    __signalOptionsAutomationInternalsForTests.computeOvernightPositionExit({
      entryPrice: 4,
      peakPrice: 4.6,
      markPrice: 4.4,
      profile: overnightProfile,
    });
  const runnerGiveback =
    __signalOptionsAutomationInternalsForTests.computeOvernightPositionExit({
      entryPrice: 4,
      peakPrice: 8,
      markPrice: 6.6,
      profile: overnightProfile,
    });
  const strongRunner =
    __signalOptionsAutomationInternalsForTests.computeOvernightPositionExit({
      entryPrice: 4,
      peakPrice: 8,
      markPrice: 7,
      profile: overnightProfile,
    });

  assert.equal(weakHold.exitReason, "overnight_risk_exit");
  assert.equal(runnerGiveback.exitReason, "overnight_runner_stop");
  assert.equal(runnerGiveback.overnightTrailStopPrice, 6.8);
  assert.equal(strongRunner.exitReason, null);
});

test("signal-options live overnight exit window is the final regular-session minutes", () => {
  const { isLiveOvernightExitWindow } =
    __signalOptionsAutomationInternalsForTests;

  assert.equal(
    isLiveOvernightExitWindow(new Date("2026-05-21T19:44:00.000Z")),
    false,
  );
  assert.equal(
    isLiveOvernightExitWindow(new Date("2026-05-21T19:45:00.000Z")),
    true,
  );
  assert.equal(
    isLiveOvernightExitWindow(new Date("2026-05-21T19:59:00.000Z")),
    true,
  );
  assert.equal(
    isLiveOvernightExitWindow(new Date("2026-05-21T20:00:00.000Z")),
    false,
  );
  assert.equal(
    isLiveOvernightExitWindow(new Date("2026-05-23T19:50:00.000Z")),
    false,
  );
});

test("signal-options live option exits respect post-close restrictions", () => {
  const { isLiveOptionTradingSession } =
    __signalOptionsAutomationInternalsForTests;
  const apldContract = {
    underlying: "APLD",
    expirationDate: "2026-05-29",
    strike: 46,
    right: "call",
  };
  const spyContract = {
    underlying: "SPY",
    expirationDate: "2026-05-29",
    strike: 600,
    right: "call",
  };

  assert.equal(
    isLiveOptionTradingSession(new Date("2026-05-27T19:59:00.000Z"), apldContract),
    true,
  );
  assert.equal(
    isLiveOptionTradingSession(new Date("2026-05-27T20:00:00.000Z"), apldContract),
    false,
  );
  assert.equal(
    isLiveOptionTradingSession(new Date("2026-05-27T20:14:00.000Z"), spyContract),
    true,
  );
  assert.equal(
    isLiveOptionTradingSession(new Date("2026-05-27T20:15:00.000Z"), spyContract),
    false,
  );
  assert.equal(
    isLiveOptionTradingSession(new Date("2026-05-27T20:56:00.000Z"), spyContract),
    false,
  );
});

test("signal-options conditional quality exits tighten weak entries and loosen strong runners", () => {
  const conditionalProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      exitPolicy: {
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        overnightExitEnabled: true,
        overnightMinGainPct: 10,
        conditionalQualityExitsEnabled: true,
        lowQualityEarlyExitBars: 4,
        lowQualityEarlyExitLossPct: 15,
        highQualityEarlyExitBars: 8,
        highQualityEarlyExitLossPct: 25,
        weakLiquidityTrailGivebackPct: 15,
        strongLiquidityTrailGivebackPct: 25,
        highQualityOvernightMinGainPct: -100,
      },
    },
  });
  const weakQuality = {
    tier: "low" as const,
    liquidityTier: "weak" as const,
    score: 2,
    reasons: ["weak_liquidity"],
    adx: 18,
    mtfMatches: 2,
    mtfDirections: [1, 1, -1],
    spreadPctOfMid: 35,
    bullishRegime: false,
  };
  const strongQuality = {
    tier: "high" as const,
    liquidityTier: "strong" as const,
    score: 5,
    reasons: ["mtf_full_alignment", "adx_confirmed", "strong_liquidity"],
    adx: 31,
    mtfMatches: 3,
    mtfDirections: [1, 1, 1],
    spreadPctOfMid: 10,
    bullishRegime: true,
  };

  const weakExit =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 4.2,
      markPrice: 3.36,
      profile: conditionalProfile,
      barsSinceEntry: 4,
      signalQuality: weakQuality,
    });
  const strongRunner =
    __signalOptionsAutomationInternalsForTests.computePositionStop({
      entryPrice: 4,
      peakPrice: 8,
      markPrice: 6.2,
      profile: conditionalProfile,
      barsSinceEntry: 6,
      signalQuality: strongQuality,
    });
  const strongOvernight =
    __signalOptionsAutomationInternalsForTests.computeOvernightPositionExit({
      entryPrice: 4,
      peakPrice: 4.4,
      markPrice: 3.9,
      profile: conditionalProfile,
      signalQuality: strongQuality,
    });

  assert.equal(weakExit.exitReason, "early_invalidation");
  assert.equal(weakExit.conditionalExitPolicy.earlyExitBars, 4);
  assert.equal(strongRunner.exitReason, null);
  assert.equal(strongRunner.conditionalExitPolicy.trailGivebackPct, 25);
  assert.equal(strongOvernight.exitReason, null);
  assert.equal(strongOvernight.conditionalExitPolicy?.overnightMinGainPct, -100);
});

test("signal-options entry quality returns a normalized 0-100 score breakdown", () => {
  const quality =
    __signalOptionsAutomationInternalsForTests.classifySignalOptionsEntryQuality({
      candidate: {
        id: "cand-1",
        symbol: "SPY",
        direction: "buy",
        optionRight: "call",
        timeframe: "5m",
        signalAt: "2026-05-21T14:30:00.000Z",
        signalPrice: 500,
        status: "candidate",
        quote: { marketDataMode: "live" },
        signal: {
          fresh: true,
          barsSinceSignal: 1,
          freshWindowBars: 4,
          filterState: {
            mtfDirections: [1, 1, 1],
            adx: 31,
          },
        },
      },
      orderPlan: {
        premiumAtRisk: 250,
        liquidity: { spreadPctOfMid: 12 },
      },
    });

  assert.equal(quality.score, 95);
  assert.equal(quality.tier, "high");
  assert.equal(quality.liquidityTier, "strong");
  assert.deepEqual(quality.components, {
    mtfAlignment: 25,
    freshness: 15,
    trendStrength: 15,
    liquidity: 20,
    riskFit: 10,
    dataQuality: 10,
    total: 95,
  });
  assert.deepEqual(quality.reasons.slice(0, 4), [
    "mtf_full_alignment",
    "adx_confirmed",
    "fresh_signal",
    "strong_liquidity",
  ]);
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

test("signal-options liquidity gate allows mark-only quotes when bid/ask are optional", () => {
  const markOnlyProfile = resolveSignalOptionsExecutionProfile({
    liquidityGate: {
      requireBidAsk: false,
      requireFreshQuote: false,
    },
  });
  const markOnly = {
    ...quote(101, "call"),
    bid: null,
    ask: null,
    mark: 1.1,
    last: 1.05,
  };

  const liquidity = resolveSignalOptionsLiquidity(markOnly, markOnlyProfile);

  assert.equal(liquidity.ok, true);
  assert.deepEqual(liquidity.reasons, []);
  assert.equal(liquidity.mid, 1.1);
  assert.equal(liquidity.spreadPctOfMid, null);
});

test("signal-options liquidity gate still blocks missing bid/ask when required", () => {
  const markOnly = {
    ...quote(101, "call"),
    bid: null,
    ask: null,
    mark: 1.1,
    last: 1.05,
  };

  const liquidity = resolveSignalOptionsLiquidity(markOnly, profile);

  assert.equal(liquidity.ok, false);
  assert.ok(liquidity.reasons.includes("missing_bid_ask"));
  assert.ok(!liquidity.reasons.includes("spread_too_wide"));
});

test("signal-options liquidity controls can disable quote gate blockers", () => {
  const staleWideQuote = {
    ...quote(101, "call"),
    bid: 0,
    ask: 2,
    mark: 1.1,
    last: 1.05,
    quoteFreshness: "stale",
  };
  const relaxedProfile = resolveSignalOptionsExecutionProfile({
    liquidityHaltControls: {
      bidAskRequiredEnabled: false,
      freshQuoteRequiredEnabled: false,
      spreadGateEnabled: false,
      minBidGateEnabled: false,
    },
  });

  const liquidity = resolveSignalOptionsLiquidity(staleWideQuote, relaxedProfile);

  assert.equal(liquidity.ok, true);
  assert.deepEqual(liquidity.reasons, []);
});

test("signal-options liquidity gate keeps freshness independent of bid/ask requirement", () => {
  const markOnlyProfile = resolveSignalOptionsExecutionProfile({
    liquidityGate: {
      requireBidAsk: false,
      requireFreshQuote: true,
    },
  });
  const staleMarkOnly = {
    ...quote(101, "call"),
    bid: null,
    ask: null,
    mark: 1.1,
    last: 1.05,
    quoteFreshness: "stale",
  };

  const liquidity = resolveSignalOptionsLiquidity(staleMarkOnly, markOnlyProfile);

  assert.equal(liquidity.ok, false);
  assert.deepEqual(liquidity.reasons, ["quote_not_fresh"]);
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
    {
      entryPrice: 4,
      lastMarkPrice: null,
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
    ready: false,
    reason: "market_session_quiet",
    message: "The market session is closed for algorithm execution.",
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
    {
      id: "candidate-3",
      symbol: "SPY",
      status: "candidate",
      actionStatus: "candidate",
      syncStatus: "synced",
      signalAt: now.toISOString(),
      action: { optionAction: "buy_call", executionMode: "shadow" },
      selectedContract: null,
      timeline: [],
    },
    {
      id: "candidate-4",
      symbol: "DIA",
      status: "skipped",
      actionStatus: "blocked",
      syncStatus: "synced",
      reason: "mtf_not_aligned",
      signalAt: now.toISOString(),
      action: { optionAction: "buy_put", executionMode: "shadow" },
      selectedContract: null,
      timeline: [
        {
          type: "signal_options_candidate_skipped",
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

  assert.equal(stages.length, 8);
  assert.equal(
    stages.find((stage) => stage.id === "liquidity_risk_gate")?.status,
    "blocked",
  );
  assert.equal(
    stages.find((stage) => stage.id === "liquidity_risk_gate")?.count,
    1,
  );
  assert.equal(
    stages.find((stage) => stage.id === "action_mapped")?.status,
    "healthy",
  );
  assert.equal(
    stages.find((stage) => stage.id === "action_mapped")?.count,
    2,
  );
  assert.ok(
    attention.some((item) => item.id === "daily-loss-halt"),
  );
  assert.ok(
    attention.every((item) => item.id !== "blocked-candidate-4"),
  );
  assert.ok(
    attention.some(
      (item) => item.id === "blocked-candidate-1" && item.stage === "liquidity_risk_gate",
    ),
  );
  assert.ok(
    attention.some((item) => item.id === "shadow-candidate-2"),
  );
});

test("cockpit scan stage exposes active scan age", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const scanStartedAt = new Date("2026-04-28T17:58:25.000Z");
  const deployment = {
    id: "deployment-active",
    name: "Signal Options Paper",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["SPY", "QQQ"],
    lastEvaluatedAt: new Date("2026-04-28T17:55:00.000Z"),
    lastSignalAt: null,
    lastError: null,
    updatedAt: now,
  } as never;
  const readiness = {
    ready: true,
    reason: null,
    message: "ready",
  } as never;

  __signalOptionsAutomationInternalsForTests.markSignalOptionsScanActive(
    "deployment-active",
    scanStartedAt,
  );
  try {
    const stages =
      __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
        deployment,
        readiness,
        candidates: [],
        activePositions: [],
        risk: {},
        events: [],
        now,
      });
    const scanStage = stages.find((stage) => stage.id === "scan_universe");

    assert.equal(scanStage?.status, "running");
    assert.equal(scanStage?.latestAt, scanStartedAt.toISOString());
    assert.equal(scanStage?.scanStartedAt, scanStartedAt.toISOString());
    assert.equal(scanStage?.scanAgeMs, 95_000);
    assert.equal(scanStage?.detail, "scan running for 1m 35s");
  } finally {
    __signalOptionsAutomationInternalsForTests.clearSignalOptionsScanActive(
      "deployment-active",
    );
  }
});

test("cockpit scan stage exposes resource-pressure pause state", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const pauseStartedAt = new Date("2026-04-28T17:52:00.000Z");
  const deployment = {
    id: "deployment-paused",
    name: "Signal Options Paper",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["SPY", "QQQ"],
    lastEvaluatedAt: new Date("2026-04-28T17:45:00.000Z"),
    lastSignalAt: null,
    lastError: null,
    updatedAt: now,
  } as never;
  const readiness = {
    ready: true,
    reason: null,
    message: "ready",
  } as never;
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 0,
    maintenance: {
      runCount: 0,
      totalClosedCount: 0,
      lastRunAt: null,
      lastError: null,
      lastClosedCount: 0,
      lastSkippedCount: 0,
      lastDueCount: 0,
      lastOrphanCount: 0,
    },
    deployments: [
      {
        deploymentId: "deployment-paused",
        lastCheckedAtMs: pauseStartedAt.getTime() - 60_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date("2026-04-28T17:45:00.000Z").toISOString(),
        lastError: null,
        lastSkippedAt: pauseStartedAt.toISOString(),
        lastSkipReason: "resource_pressure",
        skippedScanCount: 3,
        pressurePaused: true,
        pressurePauseStartedAt: pauseStartedAt.toISOString(),
        pressurePauseAgeMs: 480_000,
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 10_000,
        scanCount: 1,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 2,
        lastFreshSignalCount: 2,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: "2026-04-28T17:45:00.000Z",
        lastOldestSignalBarAt: "2026-04-28T17:45:00.000Z",
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));
  try {
    const stages =
      __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
        deployment,
        readiness,
        candidates: [],
        activePositions: [],
        risk: {},
        events: [],
        now,
      });
    const scanStage = stages.find((stage) => stage.id === "scan_universe");

    assert.equal(scanStage?.status, "attention");
    assert.equal(scanStage?.pressurePaused, true);
    assert.equal(scanStage?.pressurePauseStartedAt, pauseStartedAt.toISOString());
    assert.equal(scanStage?.pressurePauseAgeMs, 480_000);
    assert.equal(scanStage?.detail, "paused by resource pressure for 8m");
  } finally {
    registerSignalOptionsWorkerSnapshotGetter(() => ({
      started: false,
      tickRunning: false,
      deploymentCount: 0,
      activeDeploymentCount: 0,
      maintenance: {
        runCount: 0,
        totalClosedCount: 0,
        lastRunAt: null,
        lastError: null,
        lastClosedCount: 0,
        lastSkippedCount: 0,
        lastDueCount: 0,
        lastOrphanCount: 0,
      },
      deployments: [],
    }));
  }
});

test("cockpit attention ignores blockers invalidated by a profile update", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const deployment = {
    id: "deployment-1",
    name: "Signal Options Paper",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["MSTR"],
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
      symbol: "MSTR",
      status: "skipped",
      actionStatus: "blocked",
      syncStatus: "synced",
      reason: "no_expiration_in_dte_window",
      signalAt: "2026-04-28T17:45:00.000Z",
      selectedContract: null,
      timeline: [
        {
          type: "signal_options_candidate_skipped",
          occurredAt: "2026-04-28T17:50:00.000Z",
        },
      ],
    },
  ] as never;
  const events = [
    {
      eventType: "signal_options_profile_updated",
      occurredAt: new Date("2026-04-28T17:55:00.000Z"),
      payload: {},
    },
  ] as never;

  const stages =
    __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
      deployment,
      readiness,
      candidates,
      activePositions: [],
      risk: {},
      events,
    });
  const attention =
    __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
      deployment,
      readiness,
      candidates,
      activePositions: [],
      risk: {},
      events,
    });

  assert.notEqual(
    stages.find((stage) => stage.id === "contract_selected")?.status,
    "attention",
  );
  assert.deepEqual(attention, []);
});

test("cockpit attention ignores transient mark misses while a position mark is fresh", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const deployment = {
    id: "deployment-1",
    name: "Signal Options Paper",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["VXX"],
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
      symbol: "VXX",
      status: "skipped",
      actionStatus: "blocked",
      syncStatus: "synced",
      reason: "position_mark_unavailable",
      signalAt: now.toISOString(),
      timeline: [
        {
          type: SIGNAL_OPTIONS_SKIPPED_EVENT,
          occurredAt: now.toISOString(),
        },
      ],
    },
  ] as never;
  const activePositions = [
    {
      id: "position-1",
      symbol: "VXX",
      openedAt: now.toISOString(),
      entryPrice: 1,
      lastMarkPrice: 0.92,
      stopPrice: 0.62,
      quantity: 1,
      selectedContract: { multiplier: 100 },
      lastMarkedAt: now.toISOString(),
    },
  ] as never;

  const stages =
    __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
      deployment,
      readiness,
      candidates,
      activePositions,
      risk: {},
      events: [],
    });
  const attention =
    __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
      deployment,
      readiness,
      candidates,
      activePositions,
      risk: {},
      events: [],
    });

  assert.equal(
    stages.find((stage) => stage.id === "position_managed")?.status,
    "healthy",
  );
  assert.deepEqual(attention, []);
});

test("cockpit diagnostics summarize trade blockers and signal freshness", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const events = [
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T17:55:00.000Z"),
      payload: {
        reason: "bear_regime_gate_failed",
        entryGate: {
          reasons: ["adx_below_minimum", "mtf_fully_bullish"],
        },
      },
    },
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T17:56:00.000Z"),
      payload: {
        reason: "mtf_not_aligned",
        entryGate: {
          reasons: ["mtf_not_aligned"],
        },
      },
    },
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T17:56:30.000Z"),
      payload: {
        reason: "inverse_put_blocked",
        entryGate: {
          reasons: ["inverse_put_blocked"],
        },
      },
    },
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T17:56:45.000Z"),
      payload: {
        reason: "no_contract_for_strike_slot",
        chainDebug: {
          reason: "options_upstream_failure",
        },
      },
    },
    {
      eventType: SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
      occurredAt: new Date("2026-04-28T17:57:00.000Z"),
      payload: {
        source: "worker",
        reason: "ibkr_not_configured",
        count: 3,
        firstSeenAt: "2026-04-28T17:50:00.000Z",
        lastSeenAt: "2026-04-28T17:57:00.000Z",
      },
    },
    {
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      occurredAt: now,
      payload: {},
    },
  ] as never;
  const signals = [
    {
      symbol: "SPY",
      direction: "sell",
      fresh: true,
      status: "ok",
    },
    {
      symbol: "QQQ",
      direction: null,
      fresh: false,
      status: "stale",
    },
  ] as never;
  const candidates = [
    {
      id: "candidate-1",
      status: "skipped",
      actionStatus: "blocked",
      selectedContract: null,
    },
    {
      id: "candidate-2",
      status: "open",
      actionStatus: "ready",
      selectedContract: { strike: 510 },
    },
  ] as never;

  const diagnostics =
    __signalOptionsAutomationInternalsForTests.buildCockpitDiagnostics({
      signals,
      candidates,
      activePositions: [{}] as never,
      events,
    });

  assert.equal(diagnostics.eventWindow.total, 6);
  assert.equal(diagnostics.tradePath.blockedCandidates, 1);
  assert.equal(diagnostics.tradePath.contractsSelected, 1);
  assert.equal(diagnostics.tradePath.shadowFilledCandidates, 1);
  assert.equal(diagnostics.tradePath.entryEvents, 1);
  assert.equal(diagnostics.tradePath.gatewayBlocks, 3);
  assert.equal(diagnostics.lifecycle.candidates, 2);
  assert.equal(diagnostics.lifecycle.contractsSelected, 1);
  assert.equal(diagnostics.lifecycle.shadowEntries, 1);
  assert.equal(diagnostics.markHealth.activePositions, 1);
  assert.equal(diagnostics.markHealth.unmarked, 1);
  assert.equal(diagnostics.signalFreshness.fresh, 1);
  assert.equal(diagnostics.signalFreshness.notFresh, 1);
  assert.equal(diagnostics.signalFreshness.withoutDirection, 1);
  assert.equal(diagnostics.skipReasons.bear_regime_gate_failed, 1);
  assert.equal(diagnostics.skipReasons.mtf_not_aligned, 1);
  assert.equal(diagnostics.skipReasons.inverse_put_blocked, 1);
  assert.equal(diagnostics.skipReasons.ibkr_not_configured, 3);
  assert.equal(diagnostics.skipCategories.signal_policy, 3);
  assert.equal(diagnostics.skipCategories.contract_resolution, 1);
  assert.equal(diagnostics.skipCategories.gateway, 3);
  assert.equal(diagnostics.entryGateReasons.mtf_fully_bullish, 1);
  assert.equal(diagnostics.entryGateReasons.mtf_not_aligned, 1);
  assert.equal(diagnostics.entryGateReasons.inverse_put_blocked, 1);
  assert.equal(diagnostics.optionChainReasons.options_upstream_failure, 1);
  assert.equal(diagnostics.readinessIncidents.length, 1);
  assert.equal(diagnostics.readinessIncidents[0]?.source, "worker");
  assert.equal(diagnostics.readinessIncidents[0]?.reason, "ibkr_not_configured");
  assert.equal(diagnostics.readinessIncidents[0]?.count, 3);
});
