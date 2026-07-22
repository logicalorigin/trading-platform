import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import { __signalOptionsAutomationInternalsForTests as internals } from "./signal-options-automation";
import { isHistoricalSignalOptionsLifecycleEvent } from "./signal-options-exit-claims";

const source = readFileSync(
  new URL("./signal-options-automation.ts", import.meta.url),
  "utf8",
);
const exitClaimsSource = readFileSync(
  new URL("./signal-options-exit-claims.ts", import.meta.url),
  "utf8",
);

test("live event SQL keeps null-marker rows and filters history before limiting", async () => {
  await withTestDb(async () => {
    const strategyId = "00000000-0000-4000-8000-000000000501";
    const deploymentId = "00000000-0000-4000-8000-000000000502";
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Live event SQL boundary",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Live event SQL boundary",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(executionEventsTable).values([
      {
        id: "00000000-0000-4000-8000-000000000503",
        deploymentId,
        symbol: "CRM",
        eventType: "signal_options_shadow_entry",
        summary: "live",
        payload: {},
        occurredAt: new Date("2026-07-16T14:30:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-000000000504",
        deploymentId,
        symbol: "CRM",
        eventType: "signal_options_shadow_entry",
        summary: "historical",
        payload: {
          backfillEventKey: "signal_options_backfill:CRM:entry",
          metadata: { runMode: "historical_backfill" },
        },
        occurredAt: new Date("2026-07-16T14:31:00.000Z"),
      },
    ]);

    const events = await internals.listDeploymentEventsForTests(
      deploymentId,
      1,
      { liveOnly: true },
    );
    assert.deepEqual(
      events.map((event) => event.id),
      ["00000000-0000-4000-8000-000000000503"],
    );

    await db.insert(executionEventsTable).values([
      {
        id: "00000000-0000-4000-8000-000000000505",
        deploymentId,
        symbol: "CRM",
        eventType: "signal_options_candidate_skipped",
        summary: "live skip",
        payload: {
          reason: "adx_below_minimum",
          signalKey: "live-signal",
        },
        occurredAt: new Date("2026-07-16T14:32:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-000000000506",
        deploymentId,
        symbol: "CRM",
        eventType: "signal_options_candidate_skipped",
        summary: "historical skip",
        payload: {
          reason: "adx_below_minimum",
          signalKey: "historical-signal",
          backfillEventKey: "signal_options_backfill:CRM:skip",
          metadata: { runMode: "historical_backfill" },
        },
        occurredAt: new Date("2026-07-16T14:33:00.000Z"),
      },
    ]);
    const skipEvents =
      await internals.listDeploymentEntryCandidateSkipEventsForTests(
        deploymentId,
      );
    assert.deepEqual(
      skipEvents.map((event) => event.id),
      ["00000000-0000-4000-8000-000000000505"],
    );
  });
});

test("live event SQL exactly matches JavaScript historical marker semantics", async () => {
  await withTestDb(async () => {
    const strategyId = "00000000-0000-4000-8000-000000000601";
    const deploymentId = "00000000-0000-4000-8000-000000000602";
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Historical marker parity",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Historical marker parity",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["CRM"],
      config: {},
    });

    const cases: Array<{
      label: string;
      payload: Record<string, unknown>;
    }> = [
      { label: "empty", payload: {} },
      {
        label: "whitespace backfill key",
        payload: { backfillEventKey: " \t\u00a0\ufeff" },
      },
      { label: "numeric backfill key", payload: { backfillEventKey: 42 } },
      {
        label: "object backfill key",
        payload: { backfillEventKey: { key: "value" } },
      },
      {
        label: "trimmed nonempty backfill key",
        payload: { backfillEventKey: "\u00a0event-key\ufeff" },
      },
      {
        label: "run source",
        payload: { metadata: { runSource: "signal_options_backfill" } },
      },
      {
        label: "trimmed run source",
        payload: { metadata: { runSource: " signal_options_replay\t" } },
      },
      {
        label: "trimmed source type",
        payload: { metadata: { sourceType: "\u00a0signal_options_backfill" } },
      },
      {
        label: "historical run mode",
        payload: { metadata: { runMode: "historical_backfill" } },
      },
      {
        label: "replay run mode",
        payload: { metadata: { runMode: "replay" } },
      },
      {
        label: "run mode remains untrimmed",
        payload: { metadata: { runMode: " replay " } },
      },
      {
        label: "trimmed backfill source",
        payload: { backfill: { source: " signal_options_backfill\n" } },
      },
      {
        label: "trimmed replay source",
        payload: { replay: { source: "\ufeffsignal_options_replay\u00a0" } },
      },
      { label: "null markers", payload: { metadata: null } },
      {
        label: "newest padded history is filtered before limit",
        payload: {
          metadata: { runSource: "\u00a0signal_options_backfill\ufeff" },
        },
      },
    ];
    const rows = cases.map((fixture, index) => ({
      id: `00000000-0000-4000-8000-${String(610 + index).padStart(12, "0")}`,
      deploymentId,
      symbol: "CRM",
      eventType: "signal_options_shadow_entry",
      summary: fixture.label,
      payload: fixture.payload,
      occurredAt: new Date(Date.UTC(2026, 6, 16, 15, index)),
    }));
    await db.insert(executionEventsTable).values(rows);

    const expectedLiveIds = rows
      .filter(
        (_, index) =>
          !isHistoricalSignalOptionsLifecycleEvent({
            payload: cases[index].payload,
          }),
      )
      .map((row) => row.id)
      .reverse();
    const events = await internals.listDeploymentEventsForTests(
      deploymentId,
      cases.length,
      { liveOnly: true },
    );
    assert.deepEqual(
      events.map((event) => event.id),
      expectedLiveIds,
    );

    const latestLive = await internals.listDeploymentEventsForTests(
      deploymentId,
      1,
      { liveOnly: true },
    );
    assert.deepEqual(
      latestLive.map((event) => event.id),
      expectedLiveIds.slice(0, 1),
    );
  });
});

test("Signal Options state event query filters event type before limiting", () => {
  const listDeploymentEventsSource =
    source.match(/async function listDeploymentEvents[\s\S]*?^}/m)?.[0] ?? "";
  const deploymentConditionsSource =
    source.match(
      /function signalOptionsDeploymentEventConditions[\s\S]*?^}/m,
    )?.[0] ?? "";

  assert.match(
    deploymentConditionsSource,
    /sql`\$\{executionEventsTable\.eventType\} LIKE 'signal_options_%'`/,
  );
  assert.match(
    listDeploymentEventsSource,
    /signalOptionsDeploymentEventConditions[\s\S]*identityLimit:/,
  );
  assert.match(
    source,
    /async function readCachedDeploymentEventQuery[\s\S]*\.where\(and\(\.\.\.input\.conditions\)\)[\s\S]*\.limit\(input\.identityLimit\)/,
  );
  assert.doesNotMatch(
    deploymentConditionsSource,
    /like\(\s*executionEventsTable\.eventType,/,
    "the LIKE prefix must stay literal so Postgres can prove the partial index predicate",
  );
});

test("live event readers exclude canonical historical rows before applying their limits", () => {
  const historicalSql =
    exitClaimsSource.match(
      /export function signalOptionsHistoricalLifecycleEventSql[\s\S]*?^}/m,
    )?.[0] ?? "";
  assert.match(historicalSql, /backfillEventKey/);
  assert.match(historicalSql, /historical_backfill/);
  assert.match(historicalSql, /SIGNAL_OPTIONS_BACKFILL_SOURCE/);
  assert.match(historicalSql, /SIGNAL_OPTIONS_REPLAY_SOURCE/);
  assert.match(
    source,
    /function signalOptionsHistoricalEventSql[\s\S]*signalOptionsHistoricalLifecycleEventSql\(executionEventsTable\.payload\)/,
  );

  const conditions =
    source.match(
      /function signalOptionsDeploymentEventConditions[\s\S]*?^}/m,
    )?.[0] ?? "";
  assert.match(
    conditions,
    /options\.liveOnly[\s\S]*conditions\.push\(sql`not \(\$\{signalOptionsHistoricalEventSql\(\)\}\)`\)/,
  );

  for (const reader of [
    "listDeploymentEvents",
    "listDeploymentEventsExcludingFirehose",
  ]) {
    const body =
      source.match(
        new RegExp(`async function ${reader}[\\s\\S]*?^}`, "m"),
      )?.[0] ?? "";
    assert.match(
      body,
      /signalOptionsDeploymentEventConditions[\s\S]*identityLimit:/,
    );
  }
  const sinceReader =
    source.match(/async function listDeploymentEventsSince[\s\S]*?^}/m)?.[0] ??
    "";
  assert.match(
    sinceReader,
    /signalOptionsDeploymentEventConditions[\s\S]*\.limit\(/,
  );

  assert.match(
    source,
    /listDeploymentEvents\([\s\S]*?\{ liveOnly: true \},?\s*\)/,
  );
  assert.match(
    source,
    /listDeploymentEventsSince\([\s\S]*?\{ liveOnly: true \},?\s*\)/,
  );
  assert.match(
    source,
    /listDeploymentEventsExcludingFirehose\([\s\S]*?\{ liveOnly: true \},?\s*\)/,
  );
});

const identity = (id: string, occurredAt: string, updatedAt = occurredAt) => ({
  id,
  occurredAt: new Date(occurredAt),
  updatedAt: new Date(updatedAt),
});

test("warm deployment event materialization performs zero payload loads", async () => {
  const identities = [
    identity("event-2", "2026-07-12T18:02:00.000Z"),
    identity("event-1", "2026-07-12T18:01:00.000Z"),
  ];
  let loads = 0;
  const load = async (ids: string[]) => {
    loads += 1;
    return new Map(ids.map((id) => [id, { id, payload: `${id}-payload` }]));
  };
  const cold = await internals.materializeDeploymentEventRowsForTests({
    identities,
    load,
  });
  const warm = await internals.materializeDeploymentEventRowsForTests({
    identities,
    cache: cold.cache,
    load,
  });

  assert.equal(loads, 1);
  assert.deepEqual(warm.rows, cold.rows);
});

test("deployment event materialization loads only one changed row", async () => {
  const initial = [
    identity("event-2", "2026-07-12T18:02:00.000Z"),
    identity("event-1", "2026-07-12T18:01:00.000Z"),
  ];
  const loadedIds: string[][] = [];
  const load = async (ids: string[]) => {
    loadedIds.push(ids);
    return new Map(ids.map((id) => [id, { id, load: loadedIds.length }]));
  };
  const cold = await internals.materializeDeploymentEventRowsForTests({
    identities: initial,
    load,
  });
  const changed = [
    identity("event-2", "2026-07-12T18:02:00.000Z", "2026-07-12T18:03:00.000Z"),
    initial[1],
  ];
  const warm = await internals.materializeDeploymentEventRowsForTests({
    identities: changed,
    cache: cold.cache,
    load,
  });

  assert.deepEqual(loadedIds, [["event-2", "event-1"], ["event-2"]]);
  assert.notEqual(warm.rows[0], cold.rows[0]);
  assert.equal(warm.rows[1], cold.rows[1]);
});

test("deployment event materialization defers a row changed during full loading", async () => {
  const authoritative = identity(
    "event-1",
    "2026-07-12T18:01:00.000Z",
    "2026-07-12T18:01:00.000Z",
  );
  const changedDuringLoad = {
    ...authoritative,
    updatedAt: new Date("2026-07-12T18:02:00.000Z"),
  };
  const loadedIds: string[][] = [];
  const load = async (ids: string[]) => {
    loadedIds.push(ids);
    return new Map(ids.map((id) => [id, changedDuringLoad]));
  };
  const cache = new Map();
  const raced = await internals.materializeDeploymentEventRowsForTests({
    identities: [authoritative],
    cache,
    load,
    versionOf: (row: typeof changedDuringLoad) =>
      `${row.occurredAt.getTime()}:${row.updatedAt.getTime()}`,
  });
  assert.deepEqual(raced.rows, []);
  assert.equal(raced.cache.has("event-1"), false);

  const resolved = await internals.materializeDeploymentEventRowsForTests({
    identities: [changedDuringLoad],
    cache,
    load,
    versionOf: (row: typeof changedDuringLoad) =>
      `${row.occurredAt.getTime()}:${row.updatedAt.getTime()}`,
  });

  assert.deepEqual(loadedIds, [["event-1"], ["event-1"]]);
  assert.equal(resolved.rows[0], changedDuringLoad);
});

test("deployment event materialization follows authoritative deletion and order", async () => {
  const initial = [
    identity("event-3", "2026-07-12T18:03:00.000Z"),
    identity("event-2", "2026-07-12T18:02:00.000Z"),
    identity("event-1", "2026-07-12T18:01:00.000Z"),
  ];
  const cold = await internals.materializeDeploymentEventRowsForTests({
    identities: initial,
    load: async (ids: string[]) => new Map(ids.map((id) => [id, { id }])),
  });
  const warm = await internals.materializeDeploymentEventRowsForTests({
    identities: [initial[2], initial[0]],
    cache: cold.cache,
    load: async () => {
      throw new Error("unchanged rows must not reload");
    },
  });

  assert.deepEqual(
    warm.rows.map((row) => row.id),
    ["event-1", "event-3"],
  );
});

test("deployment event materialization does not evict rows still in its identity window", async () => {
  const cachedIdentities = [
    identity("event-1", "2026-07-12T18:01:00.000Z"),
    identity("event-2", "2026-07-12T18:02:00.000Z"),
  ];
  const cold = await internals.materializeDeploymentEventRowsForTests({
    identities: cachedIdentities,
    maxRows: 2,
    load: async (ids: string[]) => new Map(ids.map((id) => [id, { id }])),
  });
  const warm = await internals.materializeDeploymentEventRowsForTests({
    identities: [
      identity("event-3", "2026-07-12T18:03:00.000Z"),
      ...cachedIdentities,
    ],
    cache: cold.cache,
    maxRows: 2,
    load: async (ids: string[]) => new Map(ids.map((id) => [id, { id }])),
  });

  assert.deepEqual(
    warm.rows.map((row) => row.id),
    ["event-3", "event-1", "event-2"],
  );
  assert.equal(warm.cache.size, 2);
});

test("day event materialization reports overflow without loading its sentinel", async () => {
  const loadedIds: string[][] = [];
  const materialized = await internals.materializeDeploymentEventRowsForTests({
    identities: [
      identity("event-1", "2026-07-12T18:01:00.000Z"),
      identity("event-2", "2026-07-12T18:02:00.000Z"),
      identity("overflow", "2026-07-12T18:03:00.000Z"),
    ],
    visibleLimit: 2,
    load: async (ids: string[]) => {
      loadedIds.push(ids);
      return new Map(ids.map((id) => [id, { id }]));
    },
  });

  assert.equal(materialized.overflow, true);
  assert.deepEqual(loadedIds, [["event-1", "event-2"]]);
  assert.deepEqual(
    materialized.rows.map((row) => row.id),
    ["event-1", "event-2"],
  );
});

test("deployment event limits are canonicalized", () => {
  assert.equal(internals.normalizeDeploymentEventLimitForTests(20.1, 500), 20);
  assert.equal(internals.normalizeDeploymentEventLimitForTests(20.9, 500), 20);
  assert.equal(
    internals.normalizeDeploymentEventLimitForTests(Number.NaN, 500),
    500,
  );
  assert.equal(internals.normalizeDeploymentEventLimitForTests(0, 500), 1);
  assert.equal(
    internals.normalizeDeploymentEventLimitForTests(20_000, 500),
    10_000,
  );
});

test("deployment event readers share cached rows by id and version", async () => {
  internals.clearDeploymentEventRowCacheForTests();
  const identities = [identity("shared-event", "2026-07-12T18:01:00.000Z")];
  let loads = 0;

  try {
    await internals.materializeSharedDeploymentEventRowsForTests({
      identities,
      load: async (ids) => {
        loads += 1;
        return new Map(
          ids.map((id) => [
            id,
            {
              id,
              payload: "loaded",
              occurredAt: identities[0].occurredAt,
              updatedAt: identities[0].updatedAt,
            } as never,
          ]),
        );
      },
    });
    const fromSecondReader =
      await internals.materializeSharedDeploymentEventRowsForTests({
        identities,
        load: async () => {
          throw new Error("a second query kind must reuse the shared row");
        },
      });

    assert.equal(loads, 1);
    assert.equal(fromSecondReader.rows[0]?.id, "shared-event");
  } finally {
    internals.clearDeploymentEventRowCacheForTests();
  }
});

test("deployment event row cache evicts its oldest row at its global bound", () => {
  internals.clearDeploymentEventRowCacheForTests();
  const maxRows = internals.getDeploymentEventRowCacheMaxRowsForTests();

  try {
    for (let index = 1; index <= maxRows + 1; index += 1) {
      internals.setDeploymentEventRowCacheForTests(`event-${index}`);
    }
    assert.equal(
      internals.hasDeploymentEventRowCacheIdForTests("event-1"),
      false,
    );
    assert.equal(
      internals.hasDeploymentEventRowCacheIdForTests(`event-${maxRows + 1}`),
      true,
    );
    assert.equal(internals.getDeploymentEventRowCacheSizeForTests(), maxRows);
  } finally {
    internals.clearDeploymentEventRowCacheForTests();
  }
});

test("execution event payload updates always advance updatedAt", () => {
  const payloadUpdates = [
    ...source.matchAll(/\.update\(executionEventsTable\)([\s\S]*?)\.where\(/g),
  ]
    .map((match) => match[1])
    .filter((update) => /\bpayload\s*[:,]/.test(update));

  assert.equal(payloadUpdates.length, 2);
  for (const update of payloadUpdates) {
    assert.match(update, /updatedAt\s*:/);
  }
});
