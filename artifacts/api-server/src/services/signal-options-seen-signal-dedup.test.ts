import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  signalOptionsSeenSignalsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { and, eq } from "drizzle-orm";

import {
  __signalOptionsAutomationInternalsForTests,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  type SignalOptionsPosition,
} from "./signal-options-automation";

const {
  SIGNAL_OPTIONS_SEEN_SIGNAL_SKIP_REASON_VALUES,
  extractSignalOptionsSeenSignalRow,
  isRetryableSignalOptionsSkip,
  isRetryableSignalOptionsSkipFromRow,
  isSignalOptionsSeenSignalStoreCandidate,
} = __signalOptionsAutomationInternalsForTests;

function skippedEvent(input: {
  reason: string;
  payload?: Record<string, unknown>;
}) {
  return {
    id: `00000000-0000-4000-8000-${input.reason.length
      .toString()
      .padStart(12, "0")}`,
    deploymentId: "11111111-1111-4111-8111-111111111111",
    algoRunId: null,
    providerAccountId: "shadow",
    symbol: "SPY",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    summary: "skip",
    occurredAt: new Date("2026-07-07T12:00:00.000Z"),
    createdAt: new Date("2026-07-07T12:00:00.000Z"),
    updatedAt: new Date("2026-07-07T12:00:00.000Z"),
    payload: {
      signalKey: `sig:${input.reason}`,
      reason: input.reason,
      candidate: {
        symbol: "SPY",
        direction: "buy",
      },
      selectedContract: {
        providerContractId: "base-contract",
      },
      ...(input.payload ?? {}),
    },
  };
}

test("seen-signal golden: column-backed retryability matches JSONB retryability over the reason corpus", () => {
  const scenarios = [
    {
      name: "base",
      payload: {},
      options: {},
    },
    {
      name: "profile controls disabled",
      payload: {},
      options: {
        dailyLossHaltEnabled: false,
        premiumBudgetEnabled: false,
        tradingAllowanceEnabled: false,
      },
    },
    {
      name: "market data forced",
      payload: {
        retryable: true,
        selectedContract: {},
        signal: {
          filterState: {
            mtfSource: "legacy",
            mtfDirections: [1],
          },
        },
      },
      options: {
        forceRetryMarketData: true,
      },
    },
    {
      name: "gateway recovered",
      payload: {
        preflight: true,
      },
      options: {
        gatewayReady: true,
      },
    },
    {
      name: "budgets expanded",
      payload: {
        premiumCap: 100,
        available: 25,
      },
      options: {
        currentPremiumCap: 150,
        currentTradingAllowanceAvailable: 50,
        premiumBudgetEnabled: true,
        tradingAllowanceEnabled: true,
      },
    },
    {
      name: "same direction still open",
      payload: {
        candidate: {
          symbol: "SPY",
          direction: "buy",
          selectedContract: {
            providerContractId: "candidate-contract",
          },
        },
      },
      options: {
        activePositions: [
          {
            symbol: "SPY",
            direction: "buy",
            selectedContract: {
              providerContractId: "different-contract",
            },
          } as unknown as SignalOptionsPosition,
        ],
      },
    },
    {
      name: "retryable option debug",
      payload: {
        chainDebug: {
          reason: "options_upstream_failure",
        },
        expirationsDebug: {
          reason: "durable_option_expirations_after_upstream_failure",
        },
      },
      options: {},
    },
    {
      name: "profile updated after skip",
      payload: {},
      options: {
        profileUpdatedAt: new Date("2026-07-07T12:00:01.000Z"),
      },
    },
  ];

  for (const reason of SIGNAL_OPTIONS_SEEN_SIGNAL_SKIP_REASON_VALUES) {
    for (const scenario of scenarios) {
      const event = skippedEvent({
        reason,
        payload: scenario.payload,
      });
      const row = extractSignalOptionsSeenSignalRow(event);
      assert.ok(row, `${reason} should extract for ${scenario.name}`);
      assert.equal(
        isRetryableSignalOptionsSkip(event, scenario.options),
        isRetryableSignalOptionsSkipFromRow(row, scenario.options),
        `${reason} retryability mismatch for ${scenario.name}`,
      );
    }
  }
});

test("seen-signal golden F1: same-direction match key excludes providerContractId", () => {
  const event = skippedEvent({
    reason: "same_direction_position_open",
    payload: {
      candidate: {
        symbol: "spy",
        direction: "buy",
        selectedContract: {
          providerContractId: "candidate-contract",
        },
      },
      selectedContract: {
        providerContractId: "payload-contract",
      },
    },
  });
  const row = extractSignalOptionsSeenSignalRow(event);
  assert.ok(row);
  assert.equal(row.candidateMatchKey, "SPY|buy");
  assert.equal(row.candidateMatchKey.includes("contract"), false);
  assert.equal(
    isRetryableSignalOptionsSkipFromRow(row, {
      activePositions: [
        {
          symbol: "SPY",
          direction: "buy",
          selectedContract: {
            providerContractId: "different-live-contract",
          },
        } as unknown as SignalOptionsPosition,
      ],
    }),
    false,
  );
});

test("seen-signal golden F2: mark-feed degraded and position-mark skips are excluded from the store", () => {
  for (const reason of [
    "position_mark_feed_degraded",
    "position_mark_unavailable",
    "position_mark_failed",
    "position_mark_timeout",
  ]) {
    const event = skippedEvent({ reason });
    assert.equal(isSignalOptionsSeenSignalStoreCandidate(event), false);
    assert.equal(extractSignalOptionsSeenSignalRow(event), null);
  }

  const historical = skippedEvent({
    reason: "adx_below_minimum",
    payload: {
      backfillEventKey: "signal_options_backfill:SPY:skip",
      metadata: { runMode: "historical_backfill" },
    },
  }) as unknown as ExecutionEvent;
  assert.equal(isSignalOptionsSeenSignalStoreCandidate(historical), false);
  assert.equal(extractSignalOptionsSeenSignalRow(historical), null);
});

test("seen-signal max-open-symbol skips retry only after capacity recovers", () => {
  const event = skippedEvent({ reason: "max_open_symbols_reached" });
  const row = extractSignalOptionsSeenSignalRow(event);
  assert.ok(row);

  for (const options of [
    {
      openSymbolCapEnabled: true,
      currentOpenSymbols: 5,
      maxOpenSymbols: 5,
      expected: false,
    },
    {
      openSymbolCapEnabled: true,
      currentOpenSymbols: 4,
      maxOpenSymbols: 5,
      expected: true,
    },
    {
      openSymbolCapEnabled: false,
      currentOpenSymbols: 5,
      maxOpenSymbols: 5,
      expected: true,
    },
    {
      openSymbolCapEnabled: true,
      currentOpenSymbols: null,
      maxOpenSymbols: 5,
      expected: false,
    },
  ]) {
    assert.equal(
      isRetryableSignalOptionsSkip(event, options),
      options.expected,
    );
    assert.equal(
      isRetryableSignalOptionsSkipFromRow(row, options),
      options.expected,
    );
  }
});

test("deterministic entry-gate skips do not need an option contract to become terminal", () => {
  for (const reason of [
    "inverse_put_blocked",
    "mtf_not_aligned",
    "mtf_pattern_mismatch",
  ]) {
    const event = skippedEvent({
      reason,
      payload: {
        selectedContract: {},
        entryGate: {
          ok: false,
          reason,
          mtfDirections: [1, -1],
          mtfTimeframes: ["1m", "5m"],
        },
      },
    });
    const row = extractSignalOptionsSeenSignalRow(event);
    assert.ok(row, `${reason} should be persisted`);
    assert.equal(
      isRetryableSignalOptionsSkip(event),
      false,
      `${reason} must not retry merely because no contract was selected`,
    );
    assert.equal(
      isRetryableSignalOptionsSkipFromRow(row),
      false,
      `${reason} row must not retry merely because no contract was selected`,
    );
    const profileUpdatedAt = new Date("2026-07-07T12:00:01.000Z");
    assert.equal(
      isRetryableSignalOptionsSkip(event, { profileUpdatedAt }),
      true,
      `${reason} should re-evaluate after its governing profile changes`,
    );
    assert.equal(
      isRetryableSignalOptionsSkipFromRow(row, { profileUpdatedAt }),
      true,
      `${reason} row should re-evaluate after its governing profile changes`,
    );
  }
});

test("seen-signal transient action blockers retry only after current state changes", () => {
  for (const reason of [
    "data_stale",
    "market_idle",
    "signal_age_unavailable",
  ]) {
    const event = skippedEvent({ reason });
    const row = extractSignalOptionsSeenSignalRow(event);
    assert.ok(row, `${reason} should be persisted for recovery`);
    const signalKey = `sig:${reason}`;

    for (const [currentBlocker, expected] of [
      [reason, false],
      [null, true],
      ["signal_age_unavailable", reason !== "signal_age_unavailable"],
    ] as const) {
      const options = {
        currentActionBlockersBySignalKey: new Map([
          [signalKey, currentBlocker],
        ]),
      };
      assert.equal(
        isRetryableSignalOptionsSkip(event, options),
        expected,
        `${reason} event with current blocker ${currentBlocker}`,
      );
      assert.equal(
        isRetryableSignalOptionsSkipFromRow(row, options),
        expected,
        `${reason} row with current blocker ${currentBlocker}`,
      );
    }

    assert.equal(isRetryableSignalOptionsSkip(event), false);
    assert.equal(isRetryableSignalOptionsSkipFromRow(row), false);
  }
});

test("seen-signal golden: extracted columns preserve the payload fields used for writes", () => {
  const event = skippedEvent({
    reason: "trading_allowance_exhausted",
    payload: {
      retryable: true,
      preflight: true,
      premiumCap: 123.45,
      available: 67.89,
      candidate: {
        symbol: "dia",
        direction: "sell",
        signal: {
          filterState: {
            mtfSource: "signal_matrix",
            mtfDirections: [1, -1, 1, -1, 1, -1],
          },
        },
      },
      chainDebug: {
        reason: "options_upstream_failure",
      },
      expirationsDebug: {
        reason: "option_expirations_refresh_deferred",
      },
    },
  });
  const row = extractSignalOptionsSeenSignalRow(event);
  assert.ok(row);
  assert.equal(row.deploymentId, event.deploymentId);
  assert.equal(row.providerAccountId, event.providerAccountId);
  assert.equal(row.eventId, event.id);
  assert.equal(row.symbol, "DIA");
  assert.equal(row.signalKey, "sig:trading_allowance_exhausted");
  assert.equal(row.reason, "trading_allowance_exhausted");
  assert.equal(row.candidateMatchKey, "DIA|sell");
  assert.equal(row.payloadRetryable, true);
  assert.equal(row.preflight, true);
  assert.equal(row.hasSelectedContract, true);
  assert.equal(row.hasSignalMatrixMtf, true);
  assert.equal(row.premiumCap, 123.45);
  assert.equal(row.available, 67.89);
  assert.equal(row.chainDebugReason, "options_upstream_failure");
  assert.equal(
    row.expirationsDebugReason,
    "option_expirations_refresh_deferred",
  );
  assert.equal(row.sourceKind, "live");
});

test("seen-signal upsert keeps the newest total event identity", async () => {
  await withTestDb(async () => {
    const [strategy] = await db
      .insert(algoStrategiesTable)
      .values({
        name: "Seen-signal ordering test",
        mode: "shadow",
        enabled: true,
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(strategy);
    const [deployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        strategyId: strategy.id,
        name: "Seen-signal ordering deployment",
        mode: "shadow",
        enabled: true,
        providerAccountId: "shadow",
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(deployment);

    const event = (input: {
      id: string;
      signalKey: string;
      occurredAt: string;
    }) =>
      ({
        ...skippedEvent({ reason: "adx_below_minimum" }),
        id: input.id,
        deploymentId: deployment.id,
        occurredAt: new Date(input.occurredAt),
        payload: {
          ...skippedEvent({ reason: "adx_below_minimum" }).payload,
          signalKey: input.signalKey,
        },
      }) as unknown as ExecutionEvent;

    const signalKey = "ordered-signal";
    const older = event({
      id: "00000000-0000-4000-8000-000000000001",
      signalKey,
      occurredAt: "2026-07-07T12:00:00.000Z",
    });
    const newer = event({
      id: "00000000-0000-4000-8000-000000000002",
      signalKey,
      occurredAt: "2026-07-07T12:00:02.000Z",
    });
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      newer,
    );
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      older,
    );

    const [persisted] = await db
      .select()
      .from(signalOptionsSeenSignalsTable)
      .where(
        and(
          eq(signalOptionsSeenSignalsTable.deploymentId, deployment.id),
          eq(signalOptionsSeenSignalsTable.signalKey, signalKey),
        ),
      );
    assert.equal(persisted?.eventId, newer.id);
    assert.equal(persisted?.sourceKind, "live");
    assert.equal(
      persisted?.occurredAt.toISOString(),
      "2026-07-07T12:00:02.000Z",
    );
    assert.equal(
      __signalOptionsAutomationInternalsForTests
        .seenSignalKeysFromStoreRows([persisted!], {
          profileUpdatedAt: new Date("2026-07-07T12:00:01.000Z"),
        })
        .has(signalKey),
      true,
    );

    const ascendingSignalKey = "ordered-signal-ascending";
    const ascendingOlder = event({
      id: "00000000-0000-4000-8000-000000000005",
      signalKey: ascendingSignalKey,
      occurredAt: "2026-07-07T12:00:04.000Z",
    });
    const ascendingNewer = event({
      id: "00000000-0000-4000-8000-000000000006",
      signalKey: ascendingSignalKey,
      occurredAt: "2026-07-07T12:00:05.000Z",
    });
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      ascendingOlder,
    );
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      ascendingNewer,
    );
    const [ascending] = await db
      .select()
      .from(signalOptionsSeenSignalsTable)
      .where(
        and(
          eq(signalOptionsSeenSignalsTable.deploymentId, deployment.id),
          eq(signalOptionsSeenSignalsTable.signalKey, ascendingSignalKey),
        ),
      );
    assert.equal(ascending?.eventId, ascendingNewer.id);

    const tiedSignalKey = "tied-signal";
    const lowerId = event({
      id: "00000000-0000-4000-8000-000000000003",
      signalKey: tiedSignalKey,
      occurredAt: "2026-07-07T12:00:03.000Z",
    });
    const higherId = event({
      id: "00000000-0000-4000-8000-000000000004",
      signalKey: tiedSignalKey,
      occurredAt: "2026-07-07T12:00:03.000Z",
    });
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      higherId,
    );
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      lowerId,
    );
    const [tied] = await db
      .select()
      .from(signalOptionsSeenSignalsTable)
      .where(
        and(
          eq(signalOptionsSeenSignalsTable.deploymentId, deployment.id),
          eq(signalOptionsSeenSignalsTable.signalKey, tiedSignalKey),
        ),
      );
    assert.equal(tied?.eventId, higherId.id);

    const ascendingTiedSignalKey = "tied-signal-ascending";
    const ascendingLowerId = event({
      id: "00000000-0000-4000-8000-000000000007",
      signalKey: ascendingTiedSignalKey,
      occurredAt: "2026-07-07T12:00:06.000Z",
    });
    const ascendingHigherId = event({
      id: "00000000-0000-4000-8000-000000000008",
      signalKey: ascendingTiedSignalKey,
      occurredAt: "2026-07-07T12:00:06.000Z",
    });
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      ascendingLowerId,
    );
    await __signalOptionsAutomationInternalsForTests.upsertSignalOptionsSeenSignal(
      ascendingHigherId,
    );
    const [ascendingTied] = await db
      .select()
      .from(signalOptionsSeenSignalsTable)
      .where(
        and(
          eq(signalOptionsSeenSignalsTable.deploymentId, deployment.id),
          eq(signalOptionsSeenSignalsTable.signalKey, ascendingTiedSignalKey),
        ),
      );
    assert.equal(ascendingTied?.eventId, ascendingHigherId.id);
  });
});

test("seen-signal phase 1 provenance migration adds its default and check idempotently", async () => {
  await withTestDb(async ({ client }) => {
    const [strategy] = await db
      .insert(algoStrategiesTable)
      .values({
        name: "Seen-signal phase 1 migration test",
        mode: "shadow",
        enabled: true,
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(strategy);
    const [deployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        strategyId: strategy.id,
        name: "Seen-signal phase 1 migration deployment",
        mode: "shadow",
        enabled: true,
        providerAccountId: "shadow",
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(deployment);

    await client.exec(`
      ALTER TABLE signal_options_seen_signals
        DROP CONSTRAINT IF EXISTS signal_options_seen_signals_source_kind_chk;
      ALTER TABLE signal_options_seen_signals
        DROP COLUMN IF EXISTS source_kind;
    `);
    const phase1Migration = await readFile(
      new URL(
        "../../../../lib/db/migrations/20260717_signal_options_seen_signal_source_kind.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await client.exec(phase1Migration);
    await client.exec(phase1Migration);

    const column = await client.query<{
      column_default: string | null;
      is_nullable: string;
    }>(`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'signal_options_seen_signals'
        AND column_name = 'source_kind'
    `);
    assert.equal(column.rows[0]?.is_nullable, "NO");
    assert.match(column.rows[0]?.column_default ?? "", /unknown/);

    const constraint = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_constraint
      WHERE conname = 'signal_options_seen_signals_source_kind_chk'
        AND conrelid = 'signal_options_seen_signals'::regclass
    `);
    assert.equal(constraint.rows[0]?.count, 1);

    const inserted = await client.query<{ source_kind: string }>(
      `INSERT INTO signal_options_seen_signals
        (deployment_id, signal_key, reason, occurred_at)
       VALUES ($1, 'phase-1-default', 'adx_below_minimum', '2026-07-07T12:00:00Z')
       RETURNING source_kind`,
      [deployment.id],
    );
    assert.equal(inserted.rows[0]?.source_kind, "unknown");
    await assert.rejects(
      client.query(
        `INSERT INTO signal_options_seen_signals
          (deployment_id, signal_key, reason, occurred_at, source_kind)
         VALUES ($1, 'phase-1-invalid', 'adx_below_minimum', '2026-07-07T12:01:00Z', 'invalid')`,
        [deployment.id],
      ),
      /signal_options_seen_signals_source_kind_chk/,
    );
  });
});

test("seen-signal provenance fences history before limits and across a phased rollout", async () => {
  await withTestDb(async ({ client }) => {
    const [strategy] = await db
      .insert(algoStrategiesTable)
      .values({
        name: "Seen-signal history fence test",
        mode: "shadow",
        enabled: true,
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(strategy);
    const [deployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        strategyId: strategy.id,
        name: "Seen-signal history fence deployment",
        mode: "shadow",
        enabled: true,
        providerAccountId: "shadow",
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(deployment);
    const [otherDeployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        strategyId: strategy.id,
        name: "Seen-signal other deployment",
        mode: "shadow",
        enabled: true,
        providerAccountId: "shadow",
        symbolUniverse: ["SPY"],
        config: {},
      })
      .returning();
    assert.ok(otherDeployment);

    await client.query(
      `insert into signal_options_seen_signals
        (deployment_id, signal_key, reason, occurred_at, source_kind)
       values
        ($1, 'known-history-newest', 'adx_below_minimum', '2026-07-07T12:04:00.000Z', 'historical'),
        ($1, 'known-history-second', 'adx_below_minimum', '2026-07-07T12:03:00.000Z', 'historical'),
        ($1, 'retained-live', 'adx_below_minimum', '2026-07-07T12:02:00.000Z', 'live'),
        ($1, 'legacy-unknown', 'adx_below_minimum', '2026-07-07T12:01:00.000Z', 'unknown')`,
      [deployment.id],
    );

    const rows =
      await __signalOptionsAutomationInternalsForTests.listSignalOptionsSeenSignalRowsForTests(
        deployment.id,
        2,
      );
    assert.deepEqual(
      rows.map((row) => row.signalKey),
      ["retained-live", "legacy-unknown"],
    );

    const phase1Migration = await readFile(
      new URL(
        "../../../../lib/db/migrations/20260717_signal_options_seen_signal_source_kind.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await client.exec(phase1Migration);
    await client.exec(phase1Migration);

    const historicalPayloads: Record<string, unknown>[] = [
      { backfillEventKey: " backfill:key " },
      { metadata: { runSource: "\u00a0signal_options_backfill\u00a0" } },
      { metadata: { sourceType: " signal_options_replay " } },
      { metadata: { runMode: "historical_backfill" } },
      { metadata: { runMode: "replay" } },
      { backfill: { source: "\tsignal_options_backfill\n" } },
      { replay: { source: " signal_options_replay " } },
    ];
    const livePayloads: Record<string, unknown>[] = [
      { backfillEventKey: " \t\n" },
      { backfillEventKey: 123 },
      { metadata: { runMode: " replay " } },
    ];
    const linkedFixtures = [...historicalPayloads, ...livePayloads].map(
      (payload, index) => ({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        signalKey: `migration-linked-${index}`,
        payload,
      }),
    );
    const crossDeploymentEventId = "30000000-0000-4000-8000-000000000002";
    const rollingHistoricalSeedEventId = "40000000-0000-4000-8000-000000000001";
    const rollingLiveSeedEventId = "40000000-0000-4000-8000-000000000002";
    const rollingLiveEventId = "40000000-0000-4000-8000-000000000003";
    const rollingHistoricalEventId = "40000000-0000-4000-8000-000000000004";
    await db.insert(executionEventsTable).values([
      ...linkedFixtures.map((fixture, index) => ({
        id: fixture.id,
        deploymentId: deployment.id,
        providerAccountId: "shadow",
        symbol: "SPY",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: "migration provenance fixture",
        payload: fixture.payload,
        occurredAt: new Date(
          `2026-07-07T13:${String(index).padStart(2, "0")}:00Z`,
        ),
      })),
      {
        id: crossDeploymentEventId,
        deploymentId: otherDeployment.id,
        providerAccountId: "shadow",
        symbol: "SPY",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: "cross-deployment provenance fixture",
        payload: { backfillEventKey: "cross-deployment-history" },
        occurredAt: new Date("2026-07-07T13:10:00Z"),
      },
      {
        id: rollingHistoricalSeedEventId,
        deploymentId: deployment.id,
        providerAccountId: "shadow",
        symbol: "SPY",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: "rolling historical seed fixture",
        payload: { backfillEventKey: "rolling-history-seed" },
        occurredAt: new Date("2026-07-07T13:11:00Z"),
      },
      {
        id: rollingLiveSeedEventId,
        deploymentId: deployment.id,
        providerAccountId: "shadow",
        symbol: "SPY",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: "rolling live seed fixture",
        payload: { signalKey: "rolling-historical" },
        occurredAt: new Date("2026-07-07T13:12:00Z"),
      },
      {
        id: rollingLiveEventId,
        deploymentId: deployment.id,
        providerAccountId: "shadow",
        symbol: "SPY",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: "rolling live writer fixture",
        payload: { signalKey: "rolling-live" },
        occurredAt: new Date("2026-07-07T14:00:00Z"),
      },
      {
        id: rollingHistoricalEventId,
        deploymentId: deployment.id,
        providerAccountId: "shadow",
        symbol: "SPY",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: "rolling historical writer fixture",
        payload: { backfillEventKey: "rolling-history" },
        occurredAt: new Date("2026-07-07T14:01:00Z"),
      },
    ]);
    await db.insert(signalOptionsSeenSignalsTable).values([
      ...linkedFixtures.map((fixture, index) => ({
        deploymentId: deployment.id,
        eventId: fixture.id,
        signalKey: fixture.signalKey,
        reason: "adx_below_minimum",
        occurredAt: new Date(
          `2026-07-07T13:${String(index).padStart(2, "0")}:00Z`,
        ),
        sourceKind: "unknown" as const,
      })),
      {
        deploymentId: deployment.id,
        eventId: "30000000-0000-4000-8000-000000000001",
        signalKey: "migration-orphan",
        reason: "adx_below_minimum",
        occurredAt: new Date("2026-07-07T13:59:00Z"),
        sourceKind: "unknown" as const,
      },
      {
        deploymentId: deployment.id,
        eventId: crossDeploymentEventId,
        signalKey: "migration-cross-deployment",
        reason: "adx_below_minimum",
        occurredAt: new Date("2026-07-07T13:10:00Z"),
        sourceKind: "unknown" as const,
      },
      {
        deploymentId: deployment.id,
        eventId: rollingHistoricalSeedEventId,
        signalKey: "rolling-live",
        reason: "adx_below_minimum",
        occurredAt: new Date("2026-07-07T13:11:00Z"),
        sourceKind: "historical" as const,
      },
      {
        deploymentId: deployment.id,
        eventId: rollingLiveSeedEventId,
        signalKey: "rolling-historical",
        reason: "adx_below_minimum",
        occurredAt: new Date("2026-07-07T13:12:00Z"),
        sourceKind: "live" as const,
      },
    ]);

    // Simulate a still-running old writer winning conflicts after a source-aware
    // writer labeled both rows. It replaces event_id but omits source_kind, so
    // both labels are stale until every old writer drains and phase 2 repairs the
    // winning events in both directions.
    await client.query(
      `insert into signal_options_seen_signals
        (deployment_id, event_id, signal_key, reason, occurred_at)
       values
        ($1, $2, 'rolling-live', 'adx_below_minimum', '2026-07-07T14:00:00Z'),
        ($1, $3, 'rolling-historical', 'adx_below_minimum', '2026-07-07T14:01:00Z')
       on conflict (deployment_id, signal_key) do update set
        event_id = excluded.event_id,
        reason = excluded.reason,
        occurred_at = excluded.occurred_at,
        updated_at = excluded.updated_at`,
      [deployment.id, rollingLiveEventId, rollingHistoricalEventId],
    );
    const phase1Rows =
      await __signalOptionsAutomationInternalsForTests.listSignalOptionsSeenSignalRowsForTests(
        deployment.id,
        100,
      );
    const phase1Keys = new Set(phase1Rows.map((row) => row.signalKey));
    assert.equal(phase1Keys.has("rolling-live"), false);
    assert.equal(phase1Keys.has("rolling-historical"), true);

    const phase2Migration = await readFile(
      new URL(
        "../../../../lib/db/migrations/20260717_signal_options_seen_signal_source_kind_phase2.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      phase2Migration,
      /sidecar\."event_id"\s+IS NOT DISTINCT FROM classified\.event_id/i,
      "phase 2 must not overwrite a new writer that changed the classified event link while waiting on the row",
    );
    await client.exec(phase2Migration);
    await client.exec(phase2Migration);

    const classifiedRows = await db
      .select()
      .from(signalOptionsSeenSignalsTable)
      .where(eq(signalOptionsSeenSignalsTable.deploymentId, deployment.id));
    const sourceKindByKey = new Map(
      classifiedRows.map((row) => [row.signalKey, row.sourceKind]),
    );
    for (let index = 0; index < historicalPayloads.length; index += 1) {
      assert.equal(
        sourceKindByKey.get(`migration-linked-${index}`),
        "historical",
      );
    }
    for (
      let index = historicalPayloads.length;
      index < linkedFixtures.length;
      index += 1
    ) {
      assert.equal(sourceKindByKey.get(`migration-linked-${index}`), "live");
    }
    assert.equal(sourceKindByKey.get("migration-orphan"), "unknown");
    assert.equal(sourceKindByKey.get("migration-cross-deployment"), "unknown");
    assert.equal(sourceKindByKey.get("rolling-live"), "live");
    assert.equal(sourceKindByKey.get("rolling-historical"), "historical");

    const phase2Rows =
      await __signalOptionsAutomationInternalsForTests.listSignalOptionsSeenSignalRowsForTests(
        deployment.id,
        100,
      );
    assert.deepEqual(
      phase2Rows.map((row) => row.signalKey).sort(),
      [
        "legacy-unknown",
        "migration-cross-deployment",
        ...livePayloads.map(
          (_, index) => `migration-linked-${historicalPayloads.length + index}`,
        ),
        "migration-orphan",
        "retained-live",
        "rolling-live",
      ].sort(),
    );
  });
});
