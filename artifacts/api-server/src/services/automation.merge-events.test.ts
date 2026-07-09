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
    const first = await listExecutionEvents({ deploymentId: "dep-1", limit: 50 });
    const second = await listExecutionEvents({ deploymentId: "dep-1", limit: 50 });

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
