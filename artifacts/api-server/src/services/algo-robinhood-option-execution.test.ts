import assert from "node:assert/strict";
import test from "node:test";

import {
  algoAccountControlsTable,
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoStrategiesTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  executionEventsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import {
  executePreparedAlgoRobinhoodOptionEntry,
  loadRobinhoodAccountOptionRiskSnapshot,
  prepareAlgoRobinhoodOptionEntry,
  type ExecuteAlgoRobinhoodOptionEntryDependencies,
  type PrepareAlgoRobinhoodOptionEntryInput,
} from "./algo-robinhood-option-execution";
import type {
  RobinhoodOptionOrderInput,
  RobinhoodOptionOrderPlaceResponse,
  RobinhoodOptionOrderReviewResponse,
} from "./robinhood-option-orders";

const TEST_NOW = new Date("2026-07-21T20:00:00.000Z");
const TEST_QUOTE_TIME = "2026-07-21T19:59:55.000Z";

async function seedEntryFixture({
  tradingAllowanceEnabled = true,
}: { tradingAllowanceEnabled?: boolean } = {}) {
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: "algo-robinhood-entry@example.com",
      passwordHash: "unused",
      role: "admin",
    })
    .returning();
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Robinhood entry strategy",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL", "MSFT"],
      config: {},
    })
    .returning();
  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      appUserId: owner!.id,
      strategyId: strategy!.id,
      name: "Robinhood entry deployment",
      mode: "live",
      enabled: true,
      isDraft: false,
      symbolUniverse: ["AAPL", "MSFT"],
      config: {
        parameters: { executionMode: "signal_options" },
        signalOptions: {
          riskCaps: {
            maxContracts: 8,
            maxPremiumPerEntry: 1_500,
            maxOpenSymbols: 2,
            maxDailyLoss: 500,
            tradingAllowance: 10_000,
          },
          riskHaltControls: {
            dailyLossHaltEnabled: true,
            openSymbolCapEnabled: true,
            premiumBudgetEnabled: true,
            tradingAllowanceEnabled,
          },
        },
      },
    })
    .returning();
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: owner!.id,
      name: "Robinhood Agentic",
      connectionType: "broker",
      brokerProvider: "robinhood",
      mode: "live",
      status: "connected",
    })
    .returning();
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: owner!.id,
      connectionId: connection!.id,
      providerAccountId: "robinhood:987654321",
      displayName: "Agentic",
      mode: "live",
      includedInTrading: true,
      accountStatus: "open",
      capabilities: [
        "robinhood-agentic",
        "execution-ready",
        "orders",
        "executions",
        "robinhood-option-level:option_level_2",
      ],
      executionBlockers: [],
    })
    .returning();
  const [target] = await db
    .insert(algoDeploymentTargetsTable)
    .values({
      deploymentId: deployment!.id,
      brokerAccountId: account!.id,
      lifecycle: "active",
      allocationPercent: "20.00",
      allowanceUnit: "percent",
      allowanceValue: "20.000000",
      executionEnabled: true,
    })
    .returning();
  await db.insert(algoAccountControlsTable).values({
    appUserId: owner!.id,
    brokerAccountId: account!.id,
    hardCeilingPercent: "50.00",
    totalAlgoAllowanceUnit: "percent",
    totalAlgoAllowanceValue: "50.000000",
    dailyLossLimitUsd: "750.000000",
    dailyLossScope: "account_options_realized",
  });
  await db.insert(algoTargetPositionsTable).values({
    appUserId: owner!.id,
    deploymentId: deployment!.id,
    targetId: target!.id,
    strategyPositionKey: "position:MSFT:existing",
    symbol: "MSFT",
    contractSnapshot: { occSymbol: "MSFT  260821C00500000" },
    quantity: "1.000000",
    premiumBasis: "300.000000",
    status: "open",
    openedAt: new Date("2026-07-21T18:00:00.000Z"),
  });
  const [sourceEvent] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: deployment!.id,
      providerAccountId: account!.providerAccountId,
      symbol: "AAPL",
      eventType: "signal_options_entry_decision",
      summary: "Signal Options entry decision",
      payload: { strategyPositionKey: "position:AAPL:new" },
    })
    .returning();
  return {
    owner: owner!,
    deployment: deployment!,
    account: account!,
    target: target!,
    sourceEvent: sourceEvent!,
  };
}

type EntryFixture = Awaited<ReturnType<typeof seedEntryFixture>>;

function entryInput(
  fixture: EntryFixture,
): PrepareAlgoRobinhoodOptionEntryInput {
  return {
    appUserId: fixture.owner.id,
    deploymentId: fixture.deployment.id,
    targetId: fixture.target.id,
    sourceEventId: fixture.sourceEvent.id,
    strategyPositionKey: "position:AAPL:new",
    order: {
      contractSymbol: "O:AAPL260821C00210000",
      multiplier: 100,
      sharesPerContract: 100,
      chainSymbol: "AAPL",
      underlyingType: "equity",
      expiration: "2026-08-21",
      strike: 210,
      optionType: "Call",
      side: "Buy",
      positionEffect: "Open",
      orderType: "Limit",
      timeInForce: "Day",
      marketHours: "regular_hours",
      quantity: 10,
      limitPrice: 2.5,
      stopPrice: null,
    },
    platformCaps: {
      maxContracts: 6,
      maxPremium: 1_000,
      maxBalanceAgeMs: 45_000,
      maxQuoteAgeMs: 15_000,
      maxRiskAgeMs: 30_000,
    },
  };
}

function sizedOrder(input: PrepareAlgoRobinhoodOptionEntryInput) {
  return { ...input.order, quantity: 2 };
}

function reviewResponse(input: {
  fixture: EntryFixture;
  order: RobinhoodOptionOrderInput;
  alerts?: string[];
  orderChecks?: unknown;
}): RobinhoodOptionOrderReviewResponse {
  return {
    provider: "robinhood",
    checkedAt: TEST_NOW.toISOString(),
    account: {
      id: input.fixture.account.id,
      connectionId: input.fixture.account.connectionId,
      accountNumberLast4: "4321",
      displayName: "Agentic",
      baseCurrency: "USD",
      mode: "live",
      accountStatus: "open",
      executionReady: true,
      executionBlockers: [],
      lastSyncedAt: TEST_NOW.toISOString(),
    },
    order: {
      optionId: "robinhood-option-aapl-210-call",
      occSymbol: "AAPL  260821C00210000",
      multiplier: input.order.multiplier,
      sharesPerContract: input.order.sharesPerContract,
      chainSymbol: input.order.chainSymbol,
      underlyingType: "equity",
      expiration: input.order.expiration,
      strike: input.order.strike,
      optionType: input.order.optionType,
      side: input.order.side,
      positionEffect: input.order.positionEffect,
      orderType: input.order.orderType,
      timeInForce: input.order.timeInForce,
      marketHours: input.order.marketHours ?? "regular_hours",
      quantity: input.order.quantity,
      limitPrice: input.order.limitPrice ?? null,
      stopPrice: input.order.stopPrice ?? null,
    },
    review: {
      alerts: input.alerts ?? [],
      orderChecks: input.orderChecks ?? null,
      marketDataDisclosure: null,
      quote: {
        instrumentId: "robinhood-option-aapl-210-call",
        markPrice: 2.45,
        adjustedMarkPrice: 2.45,
        bidPrice: 2.4,
        askPrice: 2.5,
        previousClosePrice: 2.3,
        impliedVolatility: 0.25,
        delta: 0.5,
        gamma: 0.02,
        theta: -0.01,
        vega: 0.08,
        updatedAt: TEST_QUOTE_TIME,
      },
      estimate: {
        premium: 500,
        totalFee: 0,
        collateralAmount: null,
        collateralDirection: null,
        collateralInfinite: false,
      },
    },
  };
}

function placeResponse(input: {
  fixture: EntryFixture;
  order: RobinhoodOptionOrderInput;
  refId: string;
  reconcileRequired?: true;
}): RobinhoodOptionOrderPlaceResponse {
  const reviewed = reviewResponse({
    fixture: input.fixture,
    order: input.order,
  });
  return {
    provider: "robinhood",
    submittedAt: TEST_NOW.toISOString(),
    account: reviewed.account,
    order: {
      ...reviewed.order,
      brokerageOrderId: "robinhood-order-entry-1",
      state: "queued",
      refId: input.refId,
    },
    alerts: [],
    ...(input.reconcileRequired ? { reconcileRequired: true } : {}),
  };
}

function capitalLoader(fixture: EntryFixture) {
  return async ({
    appUserId,
    accountId,
  }: {
    appUserId: string;
    accountId: string;
  }) => {
    assert.equal(appUserId, fixture.owner.id);
    assert.equal(accountId, fixture.account.id);
    return {
      netLiquidation: 10_000,
      buyingPower: 4_000,
      observedAt: new Date("2026-07-21T19:59:45.000Z"),
    };
  };
}

function riskLoader(fixture: EntryFixture) {
  return async ({
    appUserId,
    accountId,
  }: {
    appUserId: string;
    accountId: string;
  }) => {
    assert.equal(appUserId, fixture.owner.id);
    assert.equal(accountId, fixture.account.id);
    return {
      dailyRealizedPnl: 0,
      openSymbols: ["MSFT"],
      observedAt: new Date("2026-07-21T19:59:50.000Z"),
    };
  };
}

test("Robinhood live risk reads account option P&L and target-owned open symbols", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const calls: Array<{ name: string; arguments?: Record<string, unknown> }> =
      [];

    const risk = await loadRobinhoodAccountOptionRiskSnapshot(
      {
        appUserId: fixture.owner.id,
        deploymentId: fixture.deployment.id,
        targetId: fixture.target.id,
        accountId: fixture.account.id,
      },
      {
        now: () => TEST_NOW,
        callTool: async (call) => {
          calls.push(call);
          return {
            data: {
              account_number: "987654321",
              window: "day",
              display_currency: "USD",
              data_points: [],
              total_returns: "-123.45",
              total_rate_of_return: "-1.23",
            },
            guide: "Realized P&L only.",
          };
        },
      },
    );

    assert.deepEqual(risk, {
      dailyRealizedPnl: -123.45,
      openSymbols: ["MSFT"],
      observedAt: TEST_NOW,
    });
    assert.deepEqual(calls, [
      {
        name: "get_realized_pnl",
        arguments: {
          account_number: "987654321",
          span: "day",
          asset_classes: ["option"],
          display_currency: "USD",
          timezone: "America/New_York",
        },
      },
    ]);
  });
});

test("Robinhood live risk fails closed on malformed provider P&L", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();

    await assert.rejects(
      () =>
        loadRobinhoodAccountOptionRiskSnapshot(
          {
            appUserId: fixture.owner.id,
            deploymentId: fixture.deployment.id,
            targetId: fixture.target.id,
            accountId: fixture.account.id,
          },
          {
            now: () => TEST_NOW,
            callTool: async () => ({
              data: {
                account_number: "987654321",
                window: "day",
                display_currency: "USD",
                total_returns: null,
              },
            }),
          },
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_live_risk_snapshot_unavailable",
    );
  });
});

test("Robinhood entry preparation defaults to the authoritative account risk loader", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const calls: Array<{ name: string; arguments?: Record<string, unknown> }> =
      [];

    const prepared = await prepareAlgoRobinhoodOptionEntry(
      entryInput(fixture),
      {
        now: () => TEST_NOW,
        loadCapital: capitalLoader(fixture),
        loadRiskOptions: {
          callTool: async (call) => {
            calls.push(call);
            return {
              data: {
                account_number: "987654321",
                window: "day",
                display_currency: "USD",
                total_returns: "0",
              },
            };
          },
        },
      },
    );

    assert.equal(prepared.reused, false);
    assert.equal(prepared.execution.status, "pending");
    assert.deepEqual(calls.map((call) => call.name), ["get_realized_pnl"]);
  });
});

test("Robinhood entry preparation rejects another same-symbol target position", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    await db.insert(algoTargetPositionsTable).values({
      appUserId: fixture.owner.id,
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
      strategyPositionKey: "position:AAPL:existing",
      symbol: "AAPL",
      contractSnapshot: { occSymbol: "AAPL  260821C00200000" },
      quantity: "1.000000",
      premiumBasis: "200.000000",
      status: "open",
      openedAt: new Date("2026-07-21T18:30:00.000Z"),
    });

    await assert.rejects(
      prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
        now: () => TEST_NOW,
        loadRisk: async () => {
          throw new Error("same-symbol guard must run before a broker risk read");
        },
        loadCapital: async () => {
          throw new Error("same-symbol guard must run before a capital read");
        },
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_live_target_symbol_position_exists",
    );
  });
});

test("Robinhood entry preparation sizes against live target exposure and reserves once", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const input = entryInput(fixture);
    let capitalReads = 0;
    const first = await prepareAlgoRobinhoodOptionEntry(input, {
      now: () => TEST_NOW,
      loadRisk: riskLoader(fixture),
      loadCapital: async ({ appUserId, accountId }) => {
        capitalReads += 1;
        assert.equal(appUserId, fixture.owner.id);
        assert.equal(accountId, fixture.account.id);
        return {
          netLiquidation: 10_000,
          buyingPower: 4_000,
          observedAt: new Date("2026-07-21T19:59:45.000Z"),
        };
      },
    });

    assert.equal(first.reused, false);
    assert.equal(first.sizing?.quantity, 2);
    assert.equal(first.sizing?.targetPremiumRemaining, 500);
    assert.equal(first.execution.requestedQuantity, "2.000000");
    assert.equal(first.execution.premiumAtRisk, "500.000000");
    assert.equal(first.execution.status, "pending");

    const second = await prepareAlgoRobinhoodOptionEntry(input, {
      now: () => new Date("2026-07-21T20:00:10.000Z"),
      loadRisk: async () => {
        throw new Error("idempotent retry must reuse the risk snapshot");
      },
      loadCapital: async () => {
        throw new Error("idempotent retry must reuse the durable reservation");
      },
    });
    assert.equal(second.reused, true);
    assert.equal(second.execution.id, first.execution.id);
    assert.equal(capitalReads, 1);
    assert.equal((await db.select().from(algoTargetExecutionsTable)).length, 1);
  });
});

test("Robinhood live entry uses target allowances without the legacy simulation allowance toggle", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture({ tradingAllowanceEnabled: false });

    const prepared = await prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
      now: () => TEST_NOW,
      loadRisk: riskLoader(fixture),
      loadCapital: async () => ({
        netLiquidation: 10_000,
        buyingPower: 4_000,
        observedAt: new Date("2026-07-21T19:59:45.000Z"),
      }),
    });

    assert.equal(prepared.sizing?.quantity, 2);
    assert.equal(prepared.sizing?.targetPremiumRemaining, 500);
  });
});

test("Robinhood entry preparation rejects a configured but staged target", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    await db
      .update(algoDeploymentTargetsTable)
      .set({ executionEnabled: false })
      .where(eq(algoDeploymentTargetsTable.id, fixture.target.id));

    await assert.rejects(
      () =>
        prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
          now: () => TEST_NOW,
          loadRisk: async () => {
            throw new Error("staged targets must stop before risk reads");
          },
          loadCapital: async () => {
            throw new Error("staged targets must stop before capital reads");
          },
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_target_execution_disabled",
    );
  });
});

test("Robinhood entry preparation blocks at the configured daily realized-loss halt", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    let capitalReads = 0;

    await assert.rejects(
      () =>
        prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
          now: () => TEST_NOW,
          loadRisk: async () => ({
            dailyRealizedPnl: -750,
            openSymbols: ["MSFT"],
            observedAt: new Date("2026-07-21T19:59:50.000Z"),
          }),
          loadCapital: async () => {
            capitalReads += 1;
            throw new Error("daily-loss halt must run before capital sizing");
          },
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_live_daily_realized_loss_halt",
    );
    assert.equal(capitalReads, 0);
  });
});

test("Robinhood entry preparation uses the shared account loss limit instead of the legacy deployment amount", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();

    const prepared = await prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
      now: () => TEST_NOW,
      loadRisk: async () => ({
        dailyRealizedPnl: -500,
        openSymbols: ["MSFT"],
        observedAt: new Date("2026-07-21T19:59:50.000Z"),
      }),
      loadCapital: capitalLoader(fixture),
    });

    assert.equal(prepared.sizing?.quantity, 2);
  });
});

test("Robinhood entry preparation fails closed when the shared account loss limit is unset", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    await db
      .update(algoAccountControlsTable)
      .set({ dailyLossLimitUsd: null })
      .where(eq(algoAccountControlsTable.brokerAccountId, fixture.account.id));

    await assert.rejects(
      () =>
        prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
          now: () => TEST_NOW,
          loadRisk: async () => {
            throw new Error("missing account loss limit must stop before risk reads");
          },
          loadCapital: async () => {
            throw new Error("missing account loss limit must stop before capital reads");
          },
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_account_daily_loss_limit_required",
    );
  });
});

test("Robinhood entry preparation blocks a new underlying at the open-symbol cap", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();

    await assert.rejects(
      () =>
        prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
          now: () => TEST_NOW,
          loadRisk: async () => ({
            dailyRealizedPnl: 0,
            openSymbols: ["MSFT", "NVDA"],
            observedAt: new Date("2026-07-21T19:59:50.000Z"),
          }),
          loadCapital: async () => {
            throw new Error("open-symbol halt must run before capital sizing");
          },
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_live_open_symbol_halt",
    );
  });
});

test("Robinhood entry preparation fails closed on a stale live risk snapshot", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();

    await assert.rejects(
      () =>
        prepareAlgoRobinhoodOptionEntry(entryInput(fixture), {
          now: () => TEST_NOW,
          loadRisk: async () => ({
            dailyRealizedPnl: 0,
            openSymbols: ["MSFT"],
            observedAt: new Date("2026-07-21T19:59:29.999Z"),
          }),
          loadCapital: async () => {
            throw new Error("stale risk must run before capital sizing");
          },
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "algo_live_risk_snapshot_stale",
    );
  });
});

test("Robinhood entry preparation checks risk freshness after the live snapshot returns", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const startedAt = new Date("2026-07-21T20:00:00.000Z");
    const riskObservedAt = new Date("2026-07-21T20:00:01.000Z");
    const checkedAt = new Date("2026-07-21T20:00:02.000Z");
    const times = [startedAt, checkedAt];

    const prepared = await prepareAlgoRobinhoodOptionEntry(
      entryInput(fixture),
      {
        now: () => times.shift() ?? checkedAt,
        loadRisk: async () => ({
          dailyRealizedPnl: 0,
          openSymbols: [],
          observedAt: riskObservedAt,
        }),
        loadCapital: capitalLoader(fixture),
      },
    );

    assert.equal(prepared.execution.status, "pending");
  });
});

test("Robinhood entry preparation checks capital freshness after the live snapshot returns", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const startedAt = new Date("2026-07-21T20:00:00.000Z");
    const riskCheckedAt = new Date("2026-07-21T20:00:01.000Z");
    const capitalObservedAt = new Date("2026-07-21T20:00:02.000Z");
    const capitalCheckedAt = new Date("2026-07-21T20:00:03.000Z");
    const times = [startedAt, riskCheckedAt, capitalCheckedAt];

    const prepared = await prepareAlgoRobinhoodOptionEntry(
      entryInput(fixture),
      {
        now: () => times.shift() ?? capitalCheckedAt,
        loadRisk: async () => ({
          dailyRealizedPnl: 0,
          openSymbols: [],
          observedAt: startedAt,
        }),
        loadCapital: async () => ({
          netLiquidation: 10_000,
          buyingPower: 4_000,
          observedAt: capitalObservedAt,
        }),
      },
    );

    assert.equal(prepared.execution.status, "pending");
  });
});

test("Robinhood entry execution reviews, tax-preflights, and places only once", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const input = entryInput(fixture);
    let reviewCalls = 0;
    let taxCalls = 0;
    let placeCalls = 0;
    const dependencies: ExecuteAlgoRobinhoodOptionEntryDependencies = {
      now: () => TEST_NOW,
      loadRisk: riskLoader(fixture),
      loadCapital: capitalLoader(fixture),
      reviewOrder: async (options) => {
        reviewCalls += 1;
        assert.equal(options.appUserId, fixture.owner.id);
        assert.equal(options.accountId, fixture.account.id);
        assert.equal(options.input.quantity, 2);
        return reviewResponse({
          fixture,
          order: options.input,
        });
      },
      createTaxPreflight: async (body, options) => {
        taxCalls += 1;
        assert.equal(options.appUserId, fixture.owner.id);
        assert.equal(body.order.accountId, fixture.account.id);
        assert.equal(body.order.optionAction, "buy_to_open");
        assert.equal(body.order.strategyIntent, "long_option");
        assert.equal(body.order.quantity, 2);
        return {
          action: "allow",
          preflightToken: `tax-entry-${taxCalls}`,
        };
      },
      placeOrder: async (options) => {
        placeCalls += 1;
        assert.equal(options.input.confirm, true);
        assert.equal(options.input.taxAcknowledgements, undefined);
        assert.match(String(options.input.taxPreflightToken), /^tax-entry-/);
        return placeResponse({
          fixture,
          order: options.input,
          refId: String(options.input.refId),
        });
      },
    };

    await Promise.all([
      executePreparedAlgoRobinhoodOptionEntry(input, dependencies),
      executePreparedAlgoRobinhoodOptionEntry(input, dependencies),
    ]);

    const [execution] = await db.select().from(algoTargetExecutionsTable);
    assert.equal(execution?.status, "submitted");
    assert.equal(execution?.brokerOrderId, "robinhood-order-entry-1");
    assert.equal(execution?.brokerOrderState, "queued");
    assert.ok(reviewCalls >= 1);
    assert.ok(taxCalls >= 1);
    assert.equal(placeCalls, 1);
  });
});

async function assertReviewRejected(input: {
  alerts?: string[];
  orderChecks?: unknown;
  expectedCode: string;
}) {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const entry = entryInput(fixture);
    let taxCalls = 0;
    let placeCalls = 0;
    const execution = await executePreparedAlgoRobinhoodOptionEntry(entry, {
      now: () => TEST_NOW,
      loadRisk: riskLoader(fixture),
      loadCapital: capitalLoader(fixture),
      reviewOrder: async (options) =>
        reviewResponse({
          fixture,
          order: options.input,
          alerts: input.alerts,
          orderChecks: input.orderChecks,
        }),
      createTaxPreflight: async () => {
        taxCalls += 1;
        throw new Error("unsafe reviews must stop before tax preflight");
      },
      placeOrder: async () => {
        placeCalls += 1;
        throw new Error("unsafe reviews must stop before broker placement");
      },
    });
    assert.equal(execution.status, "rejected");
    assert.equal(execution.errorCode, input.expectedCode);
    assert.equal(taxCalls, 0);
    assert.equal(placeCalls, 0);
  });
}

test("Robinhood entry execution rejects every review alert", async () => {
  await assertReviewRejected({
    alerts: ["manual review required"],
    expectedCode: "algo_robinhood_review_alert",
  });
});

test("Robinhood entry execution rejects every nonempty order check", async () => {
  await assertReviewRejected({
    orderChecks: { warning: "unclassified provider check" },
    expectedCode: "algo_robinhood_review_check",
  });
});

test("Robinhood entry execution never auto-acknowledges a tax warning", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const input = entryInput(fixture);
    let placeCalls = 0;
    const execution = await executePreparedAlgoRobinhoodOptionEntry(input, {
      now: () => TEST_NOW,
      loadRisk: riskLoader(fixture),
      loadCapital: capitalLoader(fixture),
      reviewOrder: async (options) =>
        reviewResponse({ fixture, order: options.input }),
      createTaxPreflight: async () => ({
        action: "warn_ack_required",
        preflightToken: "tax-warning",
      }),
      placeOrder: async () => {
        placeCalls += 1;
        throw new Error("tax warnings must stop before broker placement");
      },
    });
    assert.equal(execution.status, "rejected");
    assert.equal(execution.errorCode, "algo_tax_acknowledgement_required");
    assert.equal(placeCalls, 0);
  });
});

test("Robinhood entry execution fences an ambiguous submit for reconciliation", async () => {
  await withTestDb(async () => {
    const fixture = await seedEntryFixture();
    const input = entryInput(fixture);
    let reviewCalls = 0;
    let taxCalls = 0;
    let placeCalls = 0;
    const dependencies: ExecuteAlgoRobinhoodOptionEntryDependencies = {
      now: () => TEST_NOW,
      loadRisk: riskLoader(fixture),
      loadCapital: capitalLoader(fixture),
      reviewOrder: async (options) => {
        reviewCalls += 1;
        return reviewResponse({ fixture, order: options.input });
      },
      createTaxPreflight: async () => {
        taxCalls += 1;
        return { action: "allow", preflightToken: "tax-ambiguous" };
      },
      placeOrder: async () => {
        placeCalls += 1;
        throw new HttpError(502, "submission result unavailable", {
          code: "robinhood_option_order_submit_reconcile_required",
        });
      },
    };

    const first = await executePreparedAlgoRobinhoodOptionEntry(
      input,
      dependencies,
    );
    const retry = await executePreparedAlgoRobinhoodOptionEntry(
      input,
      dependencies,
    );
    assert.equal(first.status, "reconciliation_required");
    assert.equal(retry.status, "reconciliation_required");
    assert.equal(
      retry.errorCode,
      "robinhood_option_order_submit_reconcile_required",
    );
    assert.equal(reviewCalls, 1);
    assert.equal(taxCalls, 1);
    assert.equal(placeCalls, 1);
  });
});
