import assert from "node:assert/strict";
import test from "node:test";

import { __algoAutomationInternalsForTests as internals } from "./automation";

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
