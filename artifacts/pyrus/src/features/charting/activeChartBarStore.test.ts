import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getActiveChartBarStoreEntryCount,
  MAX_ACTIVE_CHART_BAR_SCOPES,
  resetActiveChartBarStoreForTests,
  updateActiveChartBarState,
} from "./activeChartBarStore";

test("retains a newly updated scope when pruning the inactive cache", () => {
  resetActiveChartBarStoreForTests();

  for (let index = 0; index < MAX_ACTIVE_CHART_BAR_SCOPES; index += 1) {
    updateActiveChartBarState(`existing-${index}`, (current) => ({
      ...current,
      olderHistoryPageCount: index + 1,
    }));
  }

  updateActiveChartBarState("new-scope", (current) => ({
    ...current,
    olderHistoryPageCount: 99,
  }));

  let retainedPageCount = -1;
  updateActiveChartBarState("new-scope", (current) => {
    retainedPageCount = current.olderHistoryPageCount;
    return current;
  });

  assert.equal(retainedPageCount, 99);
  assert.equal(getActiveChartBarStoreEntryCount(), MAX_ACTIVE_CHART_BAR_SCOPES);
});
