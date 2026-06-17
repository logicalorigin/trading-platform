import assert from "node:assert/strict";
import test from "node:test";

import {
  selectHeaderIbkrLineUsageSnapshot,
  shouldActivateHeaderIbkrLineUsage,
} from "./headerIbkrLineUsagePolicy.js";

test("header IBKR line usage stays active regardless of popover state", () => {
  assert.equal(
    shouldActivateHeaderIbkrLineUsage({
      safeQaMode: false,
      lineUsageAvailable: true,
    }),
    true,
  );
});

test("header IBKR line usage is suppressed in safe QA mode", () => {
  assert.equal(
    shouldActivateHeaderIbkrLineUsage({
      safeQaMode: false,
      lineUsageAvailable: true,
    }),
    true,
  );
  assert.equal(
    shouldActivateHeaderIbkrLineUsage({
      safeQaMode: true,
      lineUsageAvailable: true,
    }),
    false,
  );
});

test("compact line usage snapshot stays available for the trigger model", () => {
  const snapshot = { updatedAt: "2026-06-08T19:30:00.000Z" };
  assert.equal(
    selectHeaderIbkrLineUsageSnapshot({
      lineUsageSnapshot: snapshot,
    }),
    snapshot,
  );
});
