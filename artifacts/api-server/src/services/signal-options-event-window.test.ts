import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __signalOptionsAutomationInternalsForTests as internals } from "./signal-options-automation";

const source = readFileSync(
  new URL("./signal-options-automation.ts", import.meta.url),
  "utf8",
);

test("Signal Options state event query filters event type before limiting", () => {
  const listDeploymentEventsSource =
    source.match(/async function listDeploymentEvents[\s\S]*?^}/m)?.[0] ?? "";

  assert.match(
    listDeploymentEventsSource,
    /sql`\$\{executionEventsTable\.eventType\} LIKE 'signal_options_%'`[\s\S]*identityLimit:/,
  );
  assert.match(
    source,
    /async function readCachedDeploymentEventQuery[\s\S]*\.where\(and\(\.\.\.input\.conditions\)\)[\s\S]*\.limit\(input\.identityLimit\)/,
  );
  assert.doesNotMatch(
    listDeploymentEventsSource,
    /like\(\s*executionEventsTable\.eventType,/,
    "the LIKE prefix must stay literal so Postgres can prove the partial index predicate",
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
