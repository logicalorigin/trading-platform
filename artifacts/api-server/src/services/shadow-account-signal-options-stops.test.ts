import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  shadowAccountsTable,
  shadowOrdersTable,
  shadowPositionsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  recordShadowAutomationEvent,
  SHADOW_ACCOUNT_ID,
} from "./shadow-account";
import {
  computeSignalOptionsPositionStop,
  type SignalOptionsEntryQuality,
} from "./signal-options-exit-policy";

const optionContract = {
  underlying: "CRM",
  expirationDate: "2026-06-19",
  strike: 250,
  right: "call",
  multiplier: 100,
};

const actionableOptionQuotePricing = {
  valuationMark: 0.06,
  valuationEligible: true,
  valuationSource: "option_quote",
  valuationReason: "option_quote",
  quoteMark: 0.06,
  quoteBid: 0.05,
  quoteAsk: 0.07,
  quoteMid: 0.06,
  quoteSource: "option_quote",
  quoteFreshness: "live",
  marketDataMode: "live",
  quoteAsOf: new Date("2026-06-12T17:00:00.000Z"),
};

test("shadow-mark stop state uses the same composite lifecycle key throughout", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function enforceSignalOptionsTrailingStopFromShadowMark(",
  );
  const end = source.indexOf(
    "async function enforceSignalOptionsTrailingStopFromShadowMarkSafely(",
    start,
  );
  const enforcement = source.slice(start, end);

  assert.match(
    enforcement,
    /const electionPositionKey =\s*signalOptionsStopElectionPositionKey\(/,
  );
  assert.equal(
    enforcement.match(/positionKey: electionPositionKey/g)?.length,
    2,
  );
  assert.match(
    enforcement,
    /clearSignalOptionsStopElection\(electionPositionKey\)/,
  );
  assert.match(enforcement, /!stopElection\?\.elected/);
  assert.doesNotMatch(
    enforcement,
    /decision\.stop\.activeStopKind !== "hard_stop"/,
  );
  assert.match(
    enforcement,
    /const exitEvent = await recordSignalOptionsShadowMarkExit\(/,
  );
  assert.match(enforcement, /!stopQuoteEvidence\?\.fresh/);
  assert.match(
    enforcement,
    /stopQuoteEvidence\.ask > decision\.stop\.stopPrice/,
  );
  assert.match(
    enforcement,
    /if \(!exitEvent\) \{[\s\S]*?exited: false[\s\S]*?exit_fence_not_acquired/,
  );
});

test("shadow stop confirmation does not reuse entry-only spread caps", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function enforceSignalOptionsTrailingStopFromShadowMark(",
  );
  const end = source.indexOf(
    "async function enforceSignalOptionsTrailingStopFromShadowMarkSafely(",
    start,
  );
  const enforcement = source.slice(start, end);

  assert.doesNotMatch(
    enforcement,
    /liquidityGate\.maxSpreadPctOfMid|spreadEligible/,
  );
  assert.match(
    enforcement,
    /eligible:\s*input\.pricing\.valuationEligible\s*&&\s*input\.pricing\.valuationSource === "option_quote"/,
  );
});

test("automation entries preserve a lifecycle key supplied only by position payload", async () => {
  await withTestDb(async () => {
    const openedAt = new Date("2026-06-12T14:30:00.000Z");
    const lifecyclePositionKey =
      "option:CRM:2026-06-19:250:call:lifecycle-position-only";
    const contract = {
      ticker: "O:CRM260619C00250000",
      underlying: "CRM",
      expirationDate: "2026-06-19",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-derived-contract-key",
    };
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });

    await recordShadowAutomationEvent({
      id: "00000000-0000-4000-8000-000000000533",
      deploymentId: null,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_entry",
      summary: "CRM position-key-only entry",
      payload: {
        selectedContract: contract,
        orderPlan: { quantity: 1, simulatedFillPrice: 1 },
        position: {
          id: "deployment-position-key-only:CRM",
          positionKey: lifecyclePositionKey,
          openedAt: openedAt.toISOString(),
          quantity: 1,
          selectedContract: contract,
        },
      },
      occurredAt: openedAt,
      createdAt: openedAt,
      updatedAt: openedAt,
    });
    const [entryOrder] = await db.select().from(shadowOrdersTable);
    const [position] = await db.select().from(shadowPositionsTable);
    assert.ok(entryOrder);
    assert.ok(position);
    assert.deepEqual(
      [internals.shadowPositionKeyForOrder(entryOrder), position.positionKey],
      [lifecyclePositionKey, lifecyclePositionKey],
    );
  });
});

test("Signal Options shadow mark enforcement treats hard stops as actionable", () => {
  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 1.86,
    peakPrice: 1.86,
    markPrice: 0.06,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: actionableOptionQuotePricing,
    markAt: new Date("2026-06-12T17:00:00.000Z"),
  });

  assert.equal(decision.stop?.activeStopKind, "hard_stop");
  assert.equal(decision.stop?.exitReason, "hard_stop");
  assert.equal(decision.exitReason, "hard_stop");
  assert.equal(decision.exitPrice, 0.05);
});

test("Shadow option economics reject non-positive contract inputs at the trust boundary", () => {
  const valid = {
    ...optionContract,
    ticker: "O:CRM260619C00250000",
  };

  assert.equal(
    internals.asOptionContractForTests({ ...valid, strike: 0 }),
    null,
  );
  assert.equal(
    internals.asOptionContractForTests({ ...valid, multiplier: -100 }),
    null,
  );
  assert.equal(
    internals.asOptionContractForTests({ ...valid, sharesPerContract: 0 }),
    null,
  );
  assert.deepEqual(internals.asOptionContractForTests(valid), {
    ...valid,
    expirationDate: new Date("2026-06-19T00:00:00.000Z"),
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: null,
  });
  assert.equal(
    internals.marketMultiplierForTests({
      assetClass: "option",
      optionContract: {
        ...valid,
        multiplier: 0,
        sharesPerContract: -5,
      } as never,
    }),
    100,
  );
});

test("a fresh server receipt cannot launder hour-old market data into stop valuation", () => {
  const receivedAt = new Date();
  const pricing = internals.buildShadowOptionPricingPolicy({
    quote: {
      bid: 0.05,
      ask: 0.07,
      freshness: "live",
      dataUpdatedAt: new Date(receivedAt.getTime() - 60 * 60_000),
      latency: { apiServerReceivedAt: receivedAt },
    },
    fallbackMark: 1.86,
    quoteSource: "option_quote",
  });

  assert.equal(pricing.valuationEligible, false);
  assert.equal(pricing.valuationReason, "quote_stale_age");
  assert.equal(pricing.valuationMark, 1.86);
});

test("Shadow stop fallback hydrates only a durable executable-bid peak", () => {
  const durablePeak = internals.signalOptionsShadowExecutablePeakBaseline({
    entryPrice: 1,
    position: { executableBidPeak: "5" } as never,
    context: {
      latestEvent: {
        payload: {
          position: {
            peakPrice: 4,
            lastStop: { peakEvidenceSource: "executable_bid" },
          },
        },
      },
    } as never,
  });
  const unprovenPeak = internals.signalOptionsShadowExecutablePeakBaseline({
    entryPrice: 1,
    context: {
      latestEvent: {
        payload: {
          position: {
            peakPrice: 9,
            lastStop: { peakEvidenceSource: "valuation_mid" },
          },
        },
      },
    } as never,
  });

  assert.equal(durablePeak, 5);
  assert.equal(unprovenPeak, 1);
});

test("executable-bid checkpoints are lifecycle-bound and monotonic", () => {
  const openedAt = new Date("2026-06-12T16:00:00.000Z");
  const position = {
    openedAt,
    averageCost: "1",
    executableBidPeak: "2",
    executableBidPeakAsOf: new Date("2026-06-12T16:05:00.000Z"),
  };
  const payload = (input: {
    peakPrice: number;
    openedAt?: string;
    provenance?: string;
  }) => ({
    position: {
      openedAt: input.openedAt ?? openedAt.toISOString(),
      peakPrice: input.peakPrice,
      lastStop: {
        peakEvidenceSource: input.provenance ?? "executable_bid",
      },
    },
  });

  assert.deepEqual(
    internals.resolveSignalOptionsShadowExecutableBidPeakCheckpoint({
      position,
      payload: payload({ peakPrice: 3 }),
      occurredAt: new Date("2026-06-12T16:06:00.000Z"),
    }),
    {
      peak: 3,
      asOf: new Date("2026-06-12T16:06:00.000Z"),
    },
  );
  assert.equal(
    internals.resolveSignalOptionsShadowExecutableBidPeakCheckpoint({
      position,
      payload: payload({ peakPrice: 1.5 }),
      occurredAt: new Date("2026-06-12T16:07:00.000Z"),
    }),
    null,
  );
  assert.equal(
    internals.resolveSignalOptionsShadowExecutableBidPeakCheckpoint({
      position,
      payload: payload({
        peakPrice: 9,
        openedAt: "2026-06-11T16:00:00.000Z",
      }),
      occurredAt: new Date("2026-06-12T16:08:00.000Z"),
    }),
    null,
  );
  assert.equal(
    internals.resolveSignalOptionsShadowExecutableBidPeakCheckpoint({
      position,
      payload: payload({
        peakPrice: 9,
        provenance: "valuation_mid",
      }),
      occurredAt: new Date("2026-06-12T16:09:00.000Z"),
    }),
    null,
  );
});

test("Signal Options stop enforcement never inherits a platform context cross-account", () => {
  const position = {
    id: "shared-position-id",
    positionKey: "CRM:2026-06-19:250:C",
  } as never;

  assert.deepEqual(
    internals.signalOptionsShadowStopManagedOptionPositions(
      "member-shadow-account",
      [position],
    ),
    [],
  );
  assert.deepEqual(
    internals.signalOptionsShadowStopManagedOptionPositions("shadow", [
      position,
    ]),
    [position],
  );
});

test("Shadow stop diagnostics retain no credential-shaped error text", async () => {
  internals.resetSignalOptionsTrailingStopEnforcementFailureDiagnosticsForTests();
  const secret = "postgres://redacted.invalid/pyrus";
  const warnings: unknown[] = [];
  const result =
    await internals.enforceSignalOptionsTrailingStopFromShadowMarkSafely(
      {
        position: { id: "position-sensitive", symbol: "CRM" },
        contract: optionContract,
        quote: null,
        pricing: actionableOptionQuotePricing,
        markPrice: 0.06,
        markAt: new Date("2026-06-12T17:00:00.000Z"),
      } as never,
      {
        enforce: async () => {
          throw new Error(secret);
        },
        warn: (fields: unknown, message: string) => {
          warnings.push({ fields, message });
        },
      },
    );
  const diagnostics =
    internals.getSignalOptionsTrailingStopEnforcementFailureDiagnostics();

  assert.equal(result.reason, "enforcement_failed");
  assert.equal(
    (result as { diagnostic: { message: string } }).diagnostic.message,
    "Signal-options stop enforcement failed.",
  );
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
});

test("Shadow mark-exit mirror failure retains no credential-shaped error text", async () => {
  const secret = "postgresql://user:secret@redacted.invalid/pyrus?token=secret";
  const warnings: unknown[] = [];
  let repairs = 0;
  await internals.mirrorSignalOptionsShadowMarkExitForTests(
    {
      id: "event-sensitive",
      eventType: "signal_options_shadow_exit",
    } as never,
    {
      deploymentId: "deployment-sensitive",
      mode: "shadow",
    },
    {
      mirrorEvent: async () => {
        throw new Error(secret);
      },
      warn: (fields: unknown, message: string) => {
        warnings.push({ fields, message });
      },
      notifyRepair: () => {
        repairs += 1;
      },
    },
  );

  assert.equal(warnings.length, 1);
  assert.equal(repairs, 1);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
});

test("ordinary Shadow mirror repair retains no credential-shaped error text", async () => {
  const secret = "postgresql://user:secret@redacted.invalid/pyrus?token=secret";
  const warnings: unknown[] = [];
  const summary = await internals.repairSignalOptionsAutomationMirrorsForRead(
    "automation",
    {
      force: true,
      listCandidates: async () => [
        {
          id: "event-sensitive-repair",
          eventType: "signal_options_shadow_exit",
          payload: {},
          occurredAt: new Date("2026-06-12T17:00:00.000Z"),
        } as never,
      ],
      mirrorEvent: async () => {
        throw new Error(secret);
      },
      warn: (fields: unknown, message: string) => {
        warnings.push({ fields, message });
      },
    },
  );

  assert.equal(summary.errorCount, 1);
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
});

test("all Shadow mirror-repair warning paths use credential-safe diagnostics", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const slices = [
    source.slice(
      source.indexOf("function notifySignalOptionsShadowRepairRequested"),
      source.indexOf(
        "async function repairSignalOptionsAutomationMirrorsForRead",
      ),
    ),
    source.slice(
      source.indexOf(
        "async function repairSignalOptionsAutomationMirrorsForRead",
      ),
      source.indexOf("function shadowDateWindowUtc"),
    ),
  ];
  for (const warningPath of slices) {
    assert.doesNotMatch(warningPath, /\{\s*err:\s*error\b/);
    assert.match(warningPath, /warnSignalOptionsShadowFailure/);
  }
});

test("Shadow stop context preload failure reuses only a fresh matching lifecycle", async () => {
  internals.resetSignalOptionsShadowMarkExitContextLkgForTests();
  const secret = "postgresql://user:secret@redacted.invalid/pyrus?token=secret";
  const warnings: unknown[] = [];
  const position = {
    id: "position-lkg",
    positionKey: "CRM:2026-06-19:250:C",
    openedAt: new Date("2026-06-12T16:00:00.000Z"),
  } as never;
  const context = {
    deployment: { id: "deployment-lkg", enabled: true },
  } as never;
  const first =
    await internals.resolveSignalOptionsShadowMarkExitContextsWithLkg(
      [position],
      {
        resolve: async () => new Map([["position-lkg", context]]) as never,
        nowMs: 1_000,
      },
    );
  const duringFailure =
    await internals.resolveSignalOptionsShadowMarkExitContextsWithLkg(
      [position],
      {
        resolve: async () => {
          throw new Error(secret);
        },
        nowMs: 60_000,
        warn: (fields: unknown, message: string) => {
          warnings.push({ fields, message });
        },
      },
    );
  const afterTtl =
    await internals.resolveSignalOptionsShadowMarkExitContextsWithLkg(
      [position],
      {
        resolve: async () => {
          throw new Error("db admission timeout");
        },
        nowMs: 62_000,
      },
    );

  assert.equal(first.get("position-lkg"), context);
  assert.equal(duringFailure.get("position-lkg"), context);
  assert.equal(afterTtl.size, 0);
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
});

test("reopened contracts use the current lifecycle entry order", () => {
  const positionKey =
    "option:DKNG:2026-07-24:25:put:O:DKNG260724P00025000";
  const priorOpenedAt = new Date("2026-07-20T13:38:57.928Z");
  const currentOpenedAt = new Date("2026-07-20T17:25:52.952Z");
  const priorOrder = {
    id: "prior-dkng-entry",
    positionKey,
    symbol: "DKNG",
    assetClass: "option",
    side: "buy",
    placedAt: priorOpenedAt,
    optionContract: {
      ticker: "O:DKNG260724P00025000",
      underlying: "DKNG",
      expirationDate: "2026-07-24",
      strike: 25,
      right: "put",
      multiplier: 100,
      providerContractId: "O:DKNG260724P00025000",
    },
    payload: {
      positionKey,
      position: { openedAt: priorOpenedAt.toISOString(), entryPrice: 1.07 },
    },
  };
  const currentOrder = {
    ...priorOrder,
    id: "current-dkng-entry",
    placedAt: currentOpenedAt,
    payload: {
      positionKey,
      position: { openedAt: currentOpenedAt.toISOString(), entryPrice: 0.75 },
    },
  } as never;

  const orders = internals.shadowEntryOrdersByPositionLifecycleForTests(
    [{ positionKey, openedAt: currentOpenedAt }] as never,
    [currentOrder, priorOrder] as never,
  );

  assert.equal(orders.get(positionKey)?.id, "current-dkng-entry");
});

test("display trailing stops use the ledger fill basis", () => {
  const automationContext = internals.buildShadowAutomationContext({
    position: {
      symbol: "DKNG",
      positionKey: "option:DKNG:2026-07-24:25:put:O:DKNG260724P00025000",
      averageCost: "0.75",
      mark: "1.27",
    } as never,
    latestEvent: {
      id: "dkng-current-mark",
      occurredAt: new Date("2026-07-21T19:51:23.214Z"),
      payload: {
        profile: {
          exitPolicy: {
            hardStopPct: -20,
            trailActivationPct: 35,
            trailGivebackPct: 20,
            progressiveTrailEnabled: false,
          },
        },
        position: {
          openedAt: "2026-07-20T17:25:52.952Z",
          entryPrice: 1.07,
          peakPrice: 1.07,
        },
      },
    } as never,
    peakMarkPrice: 1.21,
  });

  assert.ok(automationContext);
  assert.equal(automationContext.entryPrice, 0.75);
  assert.equal(automationContext.trailActivationPrice, 1.01);
  assert.equal(automationContext.tradeManagement.trailActive, true);
  assert.equal(
    automationContext.tradeManagement.activeStopKind,
    "trailing_stop",
  );
});

test("progressive Shadow stop display uses its first activation rung", () => {
  const automationContext = internals.buildShadowAutomationContext({
    position: {
      symbol: "ABT",
      positionKey: "option:ABT:2026-07-24:103:put:O:ABT260724P00103000",
      averageCost: "2.34",
      mark: "3.475",
      executableBidPeak: "2.85",
    } as never,
    latestEvent: {
      id: "abt-progressive-mark",
      occurredAt: new Date("2026-07-21T20:21:01.508Z"),
      payload: {
        profile: {
          exitPolicy: {
            hardStopPct: -20,
            trailActivationPct: 35,
            progressiveTrailEnabled: true,
            progressiveTrailSteps: [
              { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
              { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
            ],
          },
        },
        position: {
          openedAt: "2026-07-20T18:59:31.923Z",
          entryPrice: 2.34,
          peakPrice: 2.85,
        },
        stop: {
          stopPrice: 2.34,
          activeStopPrice: 2.34,
          activeStopKind: "trailing_stop",
          hardStopPrice: 1.87,
          trailStopPrice: 2.34,
          trailActive: true,
          trailHasTakenOver: true,
          progressiveTrailStep: {
            activationPct: 20,
            minLockedGainPct: 0,
            givebackPct: 30,
          },
        },
      },
    } as never,
  });

  assert.ok(automationContext);
  assert.equal(automationContext.trailActivationPrice, 2.81);
  assert.equal(automationContext.tradeManagement.trailActivationPct, 20);
  assert.equal(automationContext.tradeManagement.activeTrailActivationPct, 20);
  assert.equal(automationContext.tradeManagement.minLockedGainPct, 0);
  assert.equal(automationContext.tradeManagement.givebackPct, 30);
  assert.equal(automationContext.tradeManagement.trailRetracementPct, 30);
  assert.equal(automationContext.tradeManagement.trailStopPrice, 2.7);

  const riskOverlay = internals.buildShadowPositionRiskOverlay({
    automationContext,
  });
  assert.ok(riskOverlay);
  assert.equal(riskOverlay.trailActivationPrice, 2.81);
  assert.equal(riskOverlay.trailActivationPct, 20);
  assert.equal(riskOverlay.activeTrailActivationPct, 20);
  assert.equal(riskOverlay.minLockedGainPct, 0);
  assert.equal(riskOverlay.givebackPct, 30);
  assert.equal(riskOverlay.trailRetracementPct, 30);
  assert.equal(riskOverlay.trailStopPrice, 2.7);
});

test("progressive Shadow stop display reports the active rung, not the first rung", () => {
  const automationContext = internals.buildShadowAutomationContext({
    position: {
      symbol: "AA",
      positionKey: "option:AA:2026-07-24:61:put:O:AA260724P00061000",
      averageCost: "1.59",
      mark: "2.04",
      executableBidPeak: "2.27",
    } as never,
    latestEvent: {
      id: "aa-progressive-mark",
      occurredAt: new Date("2026-07-22T16:13:00.000Z"),
      payload: {
        profile: {
          exitPolicy: {
            hardStopPct: -20,
            trailActivationPct: 35,
            progressiveTrailEnabled: true,
            progressiveTrailSteps: [
              { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
              { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
            ],
          },
        },
        position: {
          openedAt: "2026-07-20T18:59:31.923Z",
          entryPrice: 1.59,
          peakPrice: 2.27,
          lastStop: {
            stopPrice: 1.83,
            activeStopPrice: 1.83,
            activeStopKind: "trailing_stop",
            hardStopPrice: 1.27,
            trailStopPrice: 1.83,
            trailActive: true,
            trailHasTakenOver: true,
            progressiveTrailStep: {
              activationPct: 30,
              minLockedGainPct: 15,
              givebackPct: 25,
            },
          },
        },
      },
    } as never,
  });

  assert.ok(automationContext);
  assert.equal(automationContext.tradeManagement.trailActivationPct, 20);
  assert.equal(automationContext.tradeManagement.activeTrailActivationPct, 30);
  assert.equal(automationContext.tradeManagement.minLockedGainPct, 15);
  assert.equal(automationContext.tradeManagement.givebackPct, 25);
  assert.equal(automationContext.tradeManagement.trailActive, true);
  assert.equal(automationContext.tradeManagement.activeStopKind, "trailing_stop");
  assert.equal(automationContext.tradeManagement.trailStopPrice, 2.1);
});

test("stop context deployment reads avoid unrelated optional schema columns", () => {
  assert.deepEqual(
    Object.keys(internals.signalOptionsShadowDeploymentSelectionForTests),
    ["id", "name", "mode", "enabled", "providerAccountId", "config"],
  );
});

test("Shadow stop context lookup filters the exact live lifecycle before selecting an entry", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const singleStart = source.indexOf(
    "async function findSignalOptionsEntryOrderForPosition(",
  );
  const singleEnd = source.indexOf(
    "function signalOptionsEntryQualityFromRecord",
    singleStart,
  );
  const singleContextStart = source.indexOf(
    "async function resolveSignalOptionsShadowMarkExitContext(",
  );
  const singleContextEnd = source.indexOf(
    "async function resolveSignalOptionsShadowMarkExitContexts(",
    singleContextStart,
  );
  const batchStart = source.indexOf(
    "async function resolveSignalOptionsShadowMarkExitContexts(",
  );
  const batchEnd = source.indexOf(
    "function signalOptionsShadowExecutablePeakBaseline",
    batchStart,
  );
  const single = source.slice(singleStart, singleEnd);
  const singleContext = source.slice(singleContextStart, singleContextEnd);
  const batch = source.slice(batchStart, batchEnd);

  assert.match(
    single,
    /eq\(shadowOrdersTable\.placedAt,\s*position\.openedAt\)/,
  );
  assert.match(
    single,
    /shadowPositionKeyForOrder\(order\) === position\.positionKey/,
  );
  assert.match(
    single,
    /inArray\(shadowOrdersTable\.source,[\s\S]*?SIGNAL_OPTIONS_REPLAY_SOURCE/,
  );
  assert.match(single, /shadowOrderContractIdentifierSql/);
  assert.match(single, /\.limit\(2\)/);
  assert.match(
    singleContext,
    /shadowOrderMatchesSource\(entryOrder,\s*"automation"\)/,
  );
  assert.match(
    singleContext,
    /isHistoricalSignalOptionsShadowOrder\(entryOrder\)/,
  );
  assert.match(
    singleContext,
    /latestShadowAutomationManagementEvents\([\s\S]*?deploymentIdByPositionKey/,
  );
  assert.match(singleContext, /latestEvent,\s*signalQuality:/);
  assert.match(
    batch,
    /FROM \(VALUES \$\{requestedPositionsSql\}\) AS requested\(position_id, symbol, position_key, contract_identifier, opened_at\)/i,
  );
  assert.match(batch, /shadowOrderMatchesSourcePredicate\("automation"\)/);
  assert.match(
    batch,
    /shadowPositionKeyForOrder\(order\)[\s\S]*?key === requestedPositionKey/,
  );
  assert.match(
    batch,
    /shadow_orders\.placed_at = requested\.opened_at::timestamptz/i,
  );
  assert.match(batch, /signalOptionsHistoricalLifecycleEventSql\(/);
  assert.match(batch, /shadowOrderContractIdentifierSql/);
  assert.match(batch, /requested\.contract_identifier/i);
  assert.match(batch, /limit 2/i);
  assert.doesNotMatch(batch, /limit 1/i);
  assert.match(
    batch,
    /latestShadowAutomationManagementEvents\([\s\S]*?deploymentIdByPositionKey/,
  );
});

test("Shadow stop context preload maps equal-time same-symbol contracts independently", async () => {
  await withTestDb(async () => {
    const strategyId = "00000000-0000-4000-8000-000000000461";
    const deploymentId = "00000000-0000-4000-8000-000000000462";
    const openedAt = new Date("2026-06-12T14:30:00.000Z");
    const contract = (suffix: string, strike: number) => ({
      ticker: `O:CRM260619C00${strike}000`,
      underlying: "CRM",
      expirationDate: "2026-06-19",
      strike,
      right: "call",
      multiplier: 100,
      providerContractId: `crm-${suffix}`,
    });
    const firstContract = contract("250-call", 250);
    const secondContract = contract("255-call", 255);
    const positionKey = (selectedContract: ReturnType<typeof contract>) =>
      [
        "option",
        "CRM",
        "2026-06-19",
        selectedContract.strike,
        "call",
        selectedContract.providerContractId,
      ].join(":");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Contract-aware context",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Contract-aware context",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: ["CRM"],
      config: {},
    });
    const event = (
      id: string,
      candidateId: string,
      selectedContract: ReturnType<typeof contract>,
    ) => ({
      id,
      deploymentId,
      symbol: "CRM",
      eventType: "signal_options_shadow_entry",
      summary: "CRM contract entry",
      occurredAt: openedAt,
      payload: {
        selectedContract,
        candidate: { id: candidateId },
        position: {
          id: `${deploymentId}:CRM`,
          candidateId,
          openedAt: openedAt.toISOString(),
          selectedContract,
        },
      },
    });
    const firstEventId = "00000000-0000-4000-8000-000000000463";
    const secondEventId = "00000000-0000-4000-8000-000000000464";
    await db
      .insert(executionEventsTable)
      .values([
        event(firstEventId, "candidate-250", firstContract),
        event(secondEventId, "candidate-255", secondContract),
      ]);
    await db.insert(shadowOrdersTable).values([
      {
        accountId: SHADOW_ACCOUNT_ID,
        source: "automation",
        sourceEventId: firstEventId,
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        quantity: "1",
        optionContract: firstContract,
        payload: {},
        placedAt: openedAt,
      },
      {
        accountId: SHADOW_ACCOUNT_ID,
        source: "automation",
        sourceEventId: secondEventId,
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        quantity: "1",
        optionContract: secondContract,
        payload: {},
        placedAt: openedAt,
      },
    ]);
    const positions = [firstContract, secondContract].map(
      (selectedContract, index) => ({
        id: `00000000-0000-4000-8000-00000000046${index + 5}`,
        positionKey: positionKey(selectedContract),
        symbol: "CRM",
        optionContract: selectedContract,
        openedAt,
      }),
    );

    const contexts =
      await internals.resolveSignalOptionsShadowMarkExitContextsForTests(
        positions as never,
      );

    assert.equal(
      contexts.get(positions[0]!.id)?.entryOrder.sourceEventId,
      firstEventId,
    );
    assert.equal(
      contexts.get(positions[1]!.id)?.entryOrder.sourceEventId,
      secondEventId,
    );
  });
});

test("Shadow stop context uses the immutable entry lifecycle clock across a 1ms cash-row skew", async () => {
  await withTestDb(async () => {
    const strategyId = "00000000-0000-4000-8000-000000000491";
    const deploymentId = "00000000-0000-4000-8000-000000000492";
    const entryEventId = "00000000-0000-4000-8000-000000000493";
    const markEventId = "00000000-0000-4000-8000-000000000494";
    const lifecycleOpenedAt = new Date("2026-07-16T14:53:19.615Z");
    const cashOpenedAt = new Date("2026-07-16T14:53:19.616Z");
    const markedAt = new Date("2026-07-16T15:00:00.000Z");
    const positionKey =
      "option:CRM:2026-07-24:250:call:crm-lifecycle-clock";
    const contract = {
      ticker: "O:CRM260724C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-24",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-lifecycle-clock",
    };
    const positionPayload = {
      id: `${deploymentId}:CRM`,
      candidateId: "candidate-lifecycle-clock",
      symbol: "CRM",
      openedAt: lifecycleOpenedAt.toISOString(),
      positionKey,
      selectedContract: contract,
    };

    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Lifecycle clock",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Lifecycle clock",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(executionEventsTable).values([
      {
        id: entryEventId,
        deploymentId,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_entry",
        summary: "CRM entry",
        occurredAt: cashOpenedAt,
        payload: {
          metadata: { positionKey },
          candidate: { id: "candidate-lifecycle-clock" },
          position: positionPayload,
          selectedContract: contract,
        },
      },
      {
        id: markEventId,
        deploymentId,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_mark",
        summary: "CRM mark",
        occurredAt: markedAt,
        payload: {
          metadata: { positionKey },
          candidate: { id: "candidate-lifecycle-clock" },
          position: { ...positionPayload, peakPrice: 2 },
          stop: { stopPrice: 1.5, peakEvidenceSource: "executable_bid" },
          selectedContract: contract,
        },
      },
    ]);
    await db.insert(shadowOrdersTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      source: "automation",
      sourceEventId: entryEventId,
      symbol: "CRM",
      assetClass: "option",
      side: "buy",
      quantity: "1",
      optionContract: contract,
      payload: {
        metadata: { deploymentId, positionKey },
        candidate: { id: "candidate-lifecycle-clock" },
        position: positionPayload,
        selectedContract: contract,
      },
      placedAt: cashOpenedAt,
    });

    const [position] = [
      {
        id: "00000000-0000-4000-8000-000000000495",
        positionKey,
        symbol: "CRM",
        optionContract: contract,
        openedAt: cashOpenedAt,
      },
    ];
    const contexts =
      await internals.resolveSignalOptionsShadowMarkExitContextsForTests(
        [position] as never,
      );

    assert.equal(contexts.get(position.id)?.latestEvent?.id, markEventId);
  });
});

test("unchanged mark content still reaches stop enforcement", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function refreshShadowPositionMarks()",
  );
  const end = source.indexOf("async function ensureFreshShadowState", start);
  const refresh = source.slice(start, end);
  const queue = refresh.indexOf("stopChecks.push(");
  const unchangedGate = refresh.indexOf("priorMark === nextMark &&");
  const enforcement = refresh.indexOf("for (const check of stopChecks)");
  const markWrite = refresh.indexOf(
    "const appliedMarkWrites = await writeShadowPositionMarkBatch(",
  );
  const contextPreload = refresh.indexOf(
    "await resolveSignalOptionsShadowMarkExitContextsWithLkg",
  );
  const quoteFetch = refresh.indexOf("await fetchShadowOptionDayChangeQuotes");

  assert.notEqual(queue, -1);
  assert.notEqual(unchangedGate, -1);
  assert.notEqual(enforcement, -1);
  assert.notEqual(markWrite, -1);
  assert.notEqual(contextPreload, -1);
  assert.notEqual(quoteFetch, -1);
  assert.ok(queue < unchangedGate);
  assert.ok(enforcement < markWrite);
  assert.ok(contextPreload < quoteFetch);
  assert.match(
    refresh,
    /resolveSignalOptionsShadowMarkExitContextsWithLkg\(\s*stopManagedOptionPositions/,
  );
  assert.match(
    refresh,
    /signalOptionsShadowStopManagedOptionPositions\(\s*currentShadowAccountId\(\),\s*optionPositions/,
  );
  assert.match(refresh, /stopManagedOptionPositionIds\.has\(position\.id\)/);
  assert.match(
    refresh,
    /context:\s*stopContextByPositionId\.get\(position\.id\) \?\? null/,
  );
  assert.match(
    refresh,
    /for \(const check of stopChecks\)[\s\S]*?enforceSignalOptionsTrailingStopFromShadowMarkSafely\(\{[\s\S]*?context: check\.context/,
  );
  assert.match(
    refresh,
    /for \(const check of stopChecks\)[\s\S]*?executableBidPeakWrites\.push\(\{[\s\S]*?peak: enforcementPeak/,
  );
  assert.match(
    refresh,
    /writeShadowPositionMarkBatch\(\s*markWrites,\s*executableBidPeakWrites,\s*\)/,
  );
  assert.match(
    refresh,
    /if \(updatedCount \|\| executableBidPeakWrites\.length\) \{\s*invalidateShadowReadCachesAfterBackgroundMarkRefresh\(\);\s*\}/,
    "a durable bid-peak-only ratchet must invalidate cached display stops",
  );
  assert.match(
    refresh,
    /if \(!updatedCount && executableBidPeakWrites\.length\) \{\s*notifyShadowAccountChanged\(\{ reason: "mark_refresh" \}\);\s*\}/,
    "a durable bid-peak-only ratchet must wake presentation streams",
  );
  assert.match(
    refresh,
    /if \(updatedCount\) \{\s*for \(const \[source, latestMarkAt\] of latestMarkAtBySnapshotSource\)/,
    "a bid-peak-only ratchet must not manufacture a balance snapshot",
  );
});

test("automation mark mirrors publish bid-peak-only presentation changes", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function recordShadowAutomationMark(");
  const end = source.indexOf("\n}", start);
  assert.notEqual(start, -1, "Missing recordShadowAutomationMark");
  const body = source.slice(start, end === -1 ? undefined : end + 2);

  assert.match(
    body,
    /if \(result\.updated\) \{[\s\S]*?writeShadowBalanceSnapshot\([\s\S]*?\)[\s\S]*?\} else if \(result\.executableBidPeakUpdated\) \{\s*invalidateShadowReadCachesAfterBackgroundMarkRefresh\(\);\s*notifyShadowAccountChanged\(\{ reason: "mark_refresh" \}\);\s*\}/,
  );
});

test("a stop exit cannot be overwritten by a later stale mark batch", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function writeShadowPositionMarkBatch(");
  const end = source.indexOf(
    "export async function refreshShadowPositionMarks()",
    start,
  );
  const writeBatch = source.slice(start, end);

  assert.match(
    writeBatch,
    /where p\.id = batched\.position_id[\s\S]*?and p\.account_id = \$\{accountId\}[\s\S]*?and p\.status = 'open'[\s\S]*?and p\.opened_at = batched\.opened_at[\s\S]*?and p\.as_of <= batched\.as_of/,
  );
});

test("Signal Options shadow mark enforcement still treats runner trails as actionable", () => {
  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 2,
    peakPrice: 4,
    markPrice: 3.1,
    profile: tunedSignalOptionsExecutionProfile,
    pricing: {
      ...actionableOptionQuotePricing,
      valuationMark: 3.1,
      quoteMark: 3.1,
      quoteBid: 3,
      quoteAsk: 3.2,
      quoteMid: 3.1,
    },
    markAt: new Date("2026-06-12T17:00:00.000Z"),
  });

  assert.equal(decision.stop?.activeStopKind, "trailing_stop");
  assert.equal(decision.stop?.exitReason, "runner_trail_stop");
  assert.equal(decision.exitReason, "runner_trail_stop");
  assert.equal(decision.exitPrice, 3.01);
});

test("Shadow mark stop calculation cannot loosen a persisted trailing stop", () => {
  const nonMonotonicProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 20, minLockedGainPct: 20, givebackPct: 10 },
        { activationPct: 30, minLockedGainPct: 0, givebackPct: 30 },
      ],
    },
  });
  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: optionContract as never,
    entryPrice: 1,
    peakPrice: 1.3,
    markPrice: 1.25,
    priorStopPrice: 1.26,
    profile: nonMonotonicProfile,
    pricing: {
      ...actionableOptionQuotePricing,
      valuationMark: 1.25,
      quoteMark: 1.25,
      quoteBid: 1.2,
      quoteAsk: 1.3,
      quoteMid: 1.25,
    },
    markAt: new Date("2026-06-12T17:00:00.000Z"),
  });

  assert.equal(decision.stop?.stopPrice, 1.26);
  assert.equal(decision.stop?.trailStopPrice, 1.26);
});

test("Shadow stop state reads the highest persisted active-stop checkpoint", () => {
  const priorStop = internals.signalOptionsShadowPriorStopPrice({
    latestEvent: {
      payload: {
        position: {
          stopPrice: 1.1,
          lastStop: { activeStopPrice: 1.15 },
        },
        stop: { stopPrice: 1.18, activeStopPrice: 1.2 },
      },
    },
    entryEvent: {
      payload: { position: { stopPrice: 0.6 } },
    },
    entryOrder: {
      payload: { position: { stopPrice: 0.55 } },
    },
  } as never);

  assert.equal(priorStop, 1.2);
});

test("display stop ratchets from the durable executable-bid peak", () => {
  const automationContext = internals.buildShadowAutomationContext({
    position: {
      symbol: "DKNG",
      positionKey: "option:DKNG:2026-07-24:25:put:O:DKNG260724P00025000",
      averageCost: "0.75",
      mark: "1.50",
      executableBidPeak: "1.50",
    } as never,
    latestEvent: {
      id: "dkng-prior-mark",
      occurredAt: new Date("2026-07-21T19:51:23.214Z"),
      payload: {
        profile: {
          exitPolicy: {
            hardStopPct: -20,
            trailActivationPct: 35,
            trailGivebackPct: 20,
            progressiveTrailEnabled: false,
          },
        },
        position: {
          openedAt: "2026-07-20T17:25:52.952Z",
          entryPrice: 0.75,
          peakPrice: 1.21,
        },
        stop: {
          stopPrice: 0.97,
          activeStopPrice: 0.97,
          activeStopKind: "trailing_stop",
          trailStopPrice: 0.97,
          trailActive: true,
          trailHasTakenOver: true,
          peakEvidenceSource: "executable_bid",
        },
      },
    } as never,
    peakMarkPrice: 2.25,
  });

  assert.ok(automationContext);
  assert.equal(automationContext.peakPrice, 1.5);
  assert.equal(automationContext.peakEvidenceSource, "executable_bid");
  assert.equal(automationContext.stopPrice, 1.35);
  assert.equal(automationContext.tradeManagement.trailStopPrice, 1.35);
});

test("Signal Options display stop reuses the enforced wire/conditional stop snapshot", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      conditionalQualityExitsEnabled: true,
      wireGreekTrail: { enabled: true, deltaSizingEnabled: true },
    },
  });
  const signalQuality: SignalOptionsEntryQuality = {
    tier: "low",
    liquidityTier: "weak",
    score: 40,
    reasons: ["test"],
    adx: null,
    mtfMatches: 1,
    mtfDirections: [1],
    spreadPctOfMid: 1,
    bullishRegime: true,
  };
  const enforcedStop = computeSignalOptionsPositionStop({
    entryPrice: 1,
    peakPrice: 1.5,
    markPrice: 1.4,
    profile,
    direction: "buy",
    underlyingSpot: 100,
    wireContext: {
      timeframe: "1m",
      latestBarAt: new Date("2026-07-07T15:00:00Z"),
      previousBarAt: new Date("2026-07-07T14:59:00Z"),
      latestClose: 100,
      regimeDirection: 1,
      previousRegimeDirection: 1,
      bullWires: [102, 101, 99.5],
      bearWires: null,
      trendLine: 96,
    },
    currentGreeks: { delta: 0.5, ageMs: 1_000 },
    entryGreeks: { delta: 0.5, ageMs: 1_000 },
    signalQuality,
    barsSinceEntry: 6,
    wireTrailEnforceEnabled: true,
    now: new Date("2026-07-07T15:01:00Z"),
  });

  const automationContext = internals.buildShadowAutomationContext({
    position: {
      symbol: "CRM",
      positionKey: "CRM:2026-06-19:250:C",
      averageCost: "1",
      mark: "1.4",
    } as never,
    latestEvent: {
      id: "evt-stop",
      occurredAt: new Date("2026-07-07T15:01:00Z"),
      payload: {
        profile,
        position: {
          entryPrice: 1,
          peakPrice: 1.5,
          signalQuality,
        },
        stop: enforcedStop,
      },
    } as never,
    peakMarkPrice: 1.5,
  });

  assert.ok(automationContext);
  assert.equal(automationContext.stopPrice, enforcedStop.stopPrice);
  assert.equal(automationContext.activeStopPrice, enforcedStop.activeStopPrice);
  assert.equal(automationContext.activeStopKind, enforcedStop.activeStopKind);
  assert.equal(
    automationContext.tradeManagement.trailStopPrice,
    enforcedStop.trailStopPrice,
  );
  assert.equal(
    automationContext.tradeManagement.markReturnPct,
    enforcedStop.markReturnPct,
  );
});
