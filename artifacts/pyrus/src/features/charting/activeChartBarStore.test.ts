import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ACTIVE_CHART_BAR_SCOPES,
  getActiveChartBarStoreEntryCount,
  resetActiveChartBarStoreForTests,
  updateActiveChartBarState,
} from "./activeChartBarStore";

const buildBar = (index: number) => ({
  timestamp: new Date(1_700_000_000_000 + index * 60_000),
  time: 1_700_000_000_000 + index * 60_000,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100.5 + index,
  volume: 1000 + index,
});

test("activeChartBarStore prunes inactive historical bar scopes", () => {
  resetActiveChartBarStoreForTests();

  for (let index = 0; index < MAX_ACTIVE_CHART_BAR_SCOPES + 5; index += 1) {
    updateActiveChartBarState(`scope-${index}`, (current) => ({
      ...current,
      historicalBars: [buildBar(index)],
    }));
  }

  assert.equal(
    getActiveChartBarStoreEntryCount(),
    MAX_ACTIVE_CHART_BAR_SCOPES,
  );
});
