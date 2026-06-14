import assert from "node:assert/strict";
import test from "node:test";

import { __ibkrLineUsageSnapshotInternalsForTests } from "./useIbkrLineUsageSnapshot.js";

const { getSharedLineUsageSnapshot, publishSharedLineUsageSnapshot, resetSharedLineUsageSnapshotsForTests } =
  __ibkrLineUsageSnapshotInternalsForTests;

test("shared IBKR line usage snapshot keeps the newest payload across consumers", () => {
  resetSharedLineUsageSnapshotsForTests();

  publishSharedLineUsageSnapshot("compact", {
    updatedAt: "2026-06-12T17:32:00.000Z",
    admission: {
      activeLineCount: 4,
      budget: { maxLines: 200 },
    },
  });
  publishSharedLineUsageSnapshot("compact", {
    updatedAt: "2026-06-12T17:32:05.000Z",
    admission: {
      activeLineCount: 165,
      budget: { maxLines: 200 },
    },
  });
  publishSharedLineUsageSnapshot("compact", {
    updatedAt: "2026-06-12T17:32:01.000Z",
    admission: {
      activeLineCount: 4,
      budget: { maxLines: 200 },
    },
  });

  assert.equal(
    getSharedLineUsageSnapshot("compact").admission.activeLineCount,
    165,
  );
});

test("shared IBKR line usage snapshots are isolated by detail level", () => {
  resetSharedLineUsageSnapshotsForTests();

  publishSharedLineUsageSnapshot("compact", {
    updatedAt: "2026-06-12T17:32:00.000Z",
    admission: { activeLineCount: 165 },
  });
  publishSharedLineUsageSnapshot("full", {
    updatedAt: "2026-06-12T17:32:00.000Z",
    admission: { activeLineCount: 4 },
  });

  assert.equal(
    getSharedLineUsageSnapshot("compact").admission.activeLineCount,
    165,
  );
  assert.equal(
    getSharedLineUsageSnapshot("full").admission.activeLineCount,
    4,
  );
});
