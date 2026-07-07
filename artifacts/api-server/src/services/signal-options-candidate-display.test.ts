import assert from "node:assert/strict";
import test from "node:test";

import { selectSignalOptionsCandidatesForDisplay } from "./signal-options-automation";

const candidate = (id: string, positionId?: string) => ({
  id,
  shadowLink: positionId ? { positionId } : null,
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

test("returns all candidates unchanged when at or under the limit", () => {
  const rows = [candidate("a"), candidate("b")];
  assert.deepEqual(selectSignalOptionsCandidatesForDisplay(rows, [], 5), rows);
});

test("keeps the top-N by order and drops non-position overflow", () => {
  const rows = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
  assert.deepEqual(
    ids(selectSignalOptionsCandidatesForDisplay(rows, [], 2)),
    ["a", "b"],
  );
});

test("rescues an open-position candidate (shadowLink.positionId) that falls below the cut", () => {
  const rows = [
    candidate("a"),
    candidate("b"),
    candidate("c"),
    candidate("pos", "position-1"),
  ];
  assert.deepEqual(
    ids(selectSignalOptionsCandidatesForDisplay(rows, [], 2)),
    ["a", "b", "pos"],
  );
});

test("rescues a candidate matching an active position's candidateId", () => {
  const rows = [
    candidate("a"),
    candidate("b"),
    candidate("c"),
    candidate("open-cand"),
  ];
  assert.deepEqual(
    ids(
      selectSignalOptionsCandidatesForDisplay(
        rows,
        [{ candidateId: "open-cand" }],
        2,
      ),
    ),
    ["a", "b", "open-cand"],
  );
});

test("does not duplicate a position candidate already within the cut", () => {
  const rows = [candidate("pos", "p1"), candidate("b"), candidate("c")];
  assert.deepEqual(
    ids(
      selectSignalOptionsCandidatesForDisplay(rows, [{ candidateId: "pos" }], 2),
    ),
    ["pos", "b"],
  );
});
