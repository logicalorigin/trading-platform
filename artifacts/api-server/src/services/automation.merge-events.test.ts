import assert from "node:assert/strict";
import test from "node:test";

import {
  __algoAutomationInternalsForTests as internals,
  listExecutionEvents,
} from "./automation";

// --- Section 6.5: listExecutionEvents union merge-sort ----------------------
// Each branch arrives already desc-sorted and per-branch limited; the merge must
// return the global top-`limit` by occurred_at desc.
test("mergeExecutionEventRows interleaves two desc-sorted branches by occurred_at desc", () => {
  const ledger = [
    { occurredAt: new Date("2026-06-12T18:00:00.000Z"), id: "L1" },
    { occurredAt: new Date("2026-06-12T16:00:00.000Z"), id: "L2" },
    { occurredAt: new Date("2026-06-12T14:00:00.000Z"), id: "L3" },
  ];
  const diagnostics = [
    { occurredAt: new Date("2026-06-12T17:00:00.000Z"), id: "D1" },
    { occurredAt: new Date("2026-06-12T15:00:00.000Z"), id: "D2" },
  ];

  const merged = internals.mergeExecutionEventRows(ledger, diagnostics, 100);
  assert.deepEqual(
    merged.map((row) => row.id),
    ["L1", "D1", "L2", "D2", "L3"],
  );
});

test("mergeExecutionEventRows applies the outer limit after merging", () => {
  const ledger = [
    { occurredAt: new Date("2026-06-12T18:00:00.000Z"), id: "L1" },
    { occurredAt: new Date("2026-06-12T16:00:00.000Z"), id: "L2" },
  ];
  const diagnostics = [
    { occurredAt: new Date("2026-06-12T17:00:00.000Z"), id: "D1" },
    { occurredAt: new Date("2026-06-12T15:00:00.000Z"), id: "D2" },
  ];

  const merged = internals.mergeExecutionEventRows(ledger, diagnostics, 2);
  assert.deepEqual(
    merged.map((row) => row.id),
    ["L1", "D1"],
  );
});

test("mergeExecutionEventRows handles one empty branch", () => {
  const ledger = [
    { occurredAt: new Date("2026-06-12T18:00:00.000Z"), id: "L1" },
    { occurredAt: new Date("2026-06-12T16:00:00.000Z"), id: "L2" },
  ];

  const merged = internals.mergeExecutionEventRows(ledger, [], 100);
  assert.deepEqual(
    merged.map((row) => row.id),
    ["L1", "L2"],
  );
});

test("listExecutionEvents shares one read within the short TTL", async () => {
  internals.clearExecutionEventsListCacheForTests();
  let reads = 0;
  internals.setListExecutionEventsReaderForTests(async () => {
    reads += 1;
    return { events: [] };
  });

  try {
    const first = await listExecutionEvents({
      deploymentId: "dep-1",
      limit: 50,
    });
    const second = await listExecutionEvents({
      deploymentId: "dep-1",
      limit: 50,
    });

    assert.equal(reads, 1);
    assert.equal(first, second);
  } finally {
    internals.setListExecutionEventsReaderForTests(null);
    internals.clearExecutionEventsListCacheForTests();
  }
});

test("listExecutionEvents cache keys include deployment, limit, and payload flag", async () => {
  internals.clearExecutionEventsListCacheForTests();
  let reads = 0;
  internals.setListExecutionEventsReaderForTests(async () => {
    reads += 1;
    return { events: [] };
  });

  try {
    await listExecutionEvents({ deploymentId: "dep-1", limit: 50 });
    await listExecutionEvents({ deploymentId: "dep-2", limit: 50 });
    await listExecutionEvents({ deploymentId: "dep-2", limit: 100 });
    await listExecutionEvents({
      deploymentId: "dep-2",
      limit: 100,
      includePayload: true,
    });

    assert.equal(reads, 4);
  } finally {
    internals.setListExecutionEventsReaderForTests(null);
    internals.clearExecutionEventsListCacheForTests();
  }
});

const eventIdentity = (
  source: "execution_events" | "automation_diagnostics",
  id: string,
  occurredAt: string,
  updatedAt = occurredAt,
) => ({
  source,
  id,
  occurredAt: new Date(occurredAt),
  updatedAt: new Date(updatedAt),
});

test("warm event materialization reuses unchanged rows without loading payloads", async () => {
  const identities = [
    eventIdentity("execution_events", "L1", "2026-06-12T18:00:00.000Z"),
    eventIdentity("automation_diagnostics", "D1", "2026-06-12T17:00:00.000Z"),
  ];
  let payloadLoads = 0;
  const load = async (requested: typeof identities) => {
    payloadLoads += 1;
    return requested.map((identity) => ({
      ...identity,
      value: { id: identity.id, payload: `${identity.id}-payload` },
    }));
  };

  const cold = await internals.materializeExecutionEventRows(
    identities,
    undefined,
    load,
  );
  const warm = await internals.materializeExecutionEventRows(
    identities,
    cold.cache,
    load,
  );

  assert.equal(payloadLoads, 1);
  assert.deepEqual(warm.rows, cold.rows);
});

test("warm event materialization loads only a row whose version changed", async () => {
  const initial = [
    eventIdentity("execution_events", "L1", "2026-06-12T18:00:00.000Z"),
    eventIdentity("automation_diagnostics", "D1", "2026-06-12T17:00:00.000Z"),
  ];
  const loadedIds: string[][] = [];
  const load = async (requested: typeof initial) => {
    loadedIds.push(requested.map((identity) => identity.id));
    return requested.map((identity) => ({
      ...identity,
      value: {
        id: identity.id,
        version: identity.updatedAt.toISOString(),
      },
    }));
  };
  const cold = await internals.materializeExecutionEventRows(
    initial,
    undefined,
    load,
  );
  const updated = [
    initial[0],
    eventIdentity(
      "automation_diagnostics",
      "D1",
      "2026-06-12T17:00:00.000Z",
      "2026-06-12T18:30:00.000Z",
    ),
  ];

  const warm = await internals.materializeExecutionEventRows(
    updated,
    cold.cache,
    load,
  );

  assert.deepEqual(loadedIds, [["L1", "D1"], ["D1"]]);
  assert.equal(warm.rows[0], cold.rows[0]);
  assert.notEqual(warm.rows[1], cold.rows[1]);
});

test("warm event materialization follows authoritative deletion and order", async () => {
  const initial = [
    eventIdentity("execution_events", "L1", "2026-06-12T18:00:00.000Z"),
    eventIdentity("automation_diagnostics", "D1", "2026-06-12T17:00:00.000Z"),
    eventIdentity("execution_events", "L2", "2026-06-12T16:00:00.000Z"),
  ];
  const load = async (requested: typeof initial) =>
    requested.map((identity) => ({
      ...identity,
      value: { id: identity.id },
    }));
  const cold = await internals.materializeExecutionEventRows(
    initial,
    undefined,
    load,
  );
  let warmLoads = 0;

  const warm = await internals.materializeExecutionEventRows(
    [initial[2], initial[0]],
    cold.cache,
    async () => {
      warmLoads += 1;
      return [];
    },
  );

  assert.equal(warmLoads, 0);
  assert.deepEqual(
    warm.rows.map((row) => row.id),
    ["L2", "L1"],
  );
  assert.equal(warm.cache.size, 2);
});
