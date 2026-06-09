import assert from "node:assert/strict";
import test from "node:test";

import {
  selectHeaderIbkrLineUsageSnapshot,
  shouldActivateHeaderIbkrLineUsage,
} from "./headerIbkrLineUsagePolicy.js";

test("header IBKR line usage stays active while the popover is closed", () => {
  assert.equal(
    shouldActivateHeaderIbkrLineUsage({
      popoverOpen: false,
      safeQaMode: false,
      lineUsageAvailable: true,
    }),
    true,
  );
});

test("header IBKR line usage is suppressed in safe QA mode", () => {
  assert.equal(
    shouldActivateHeaderIbkrLineUsage({
      popoverOpen: true,
      safeQaMode: false,
      lineUsageAvailable: true,
    }),
    true,
  );
  assert.equal(
    shouldActivateHeaderIbkrLineUsage({
      popoverOpen: true,
      safeQaMode: true,
      lineUsageAvailable: true,
    }),
    false,
  );
});

test("closed header popover keeps compact line usage available for the trigger model", () => {
  const snapshot = { updatedAt: "2026-06-08T19:30:00.000Z" };
  assert.equal(
    selectHeaderIbkrLineUsageSnapshot({
      popoverOpen: false,
      lineUsageSnapshot: snapshot,
    }),
    snapshot,
  );
  assert.equal(
    selectHeaderIbkrLineUsageSnapshot({
      popoverOpen: true,
      lineUsageSnapshot: snapshot,
    }),
    snapshot,
  );
});
