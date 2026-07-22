import assert from "node:assert/strict";
import test from "node:test";

import { _testing as marketCalendarTesting } from "@workspace/market-calendar";

import {
  __signalMonitorInternalsForTests,
  isSignalMonitorActionPausedMarketSessionAt,
} from "./signal-monitor";

test("signal market-session context is reused within the same minute", () => {
  marketCalendarTesting.resetCalendarCaches();
  __signalMonitorInternalsForTests.resetMarketSessionContextCacheForTests();

  isSignalMonitorActionPausedMarketSessionAt(
    new Date("2026-07-14T15:30:12.000Z"),
  );
  isSignalMonitorActionPausedMarketSessionAt(
    new Date("2026-07-14T15:30:58.999Z"),
  );

  assert.equal(
    __signalMonitorInternalsForTests.getMarketSessionContextCacheSizeForTests(),
    1,
  );
});

test("signal market-session context retains a full 2000-symbol matrix working set", () => {
  marketCalendarTesting.resetCalendarCaches();
  __signalMonitorInternalsForTests.resetMarketSessionContextCacheForTests();

  const firstMinute = Date.parse("2026-07-13T13:30:00.000Z");
  const fullMatrixContexts = 2_000 * 6 + 1;
  for (let minute = 0; minute < fullMatrixContexts; minute += 1) {
    isSignalMonitorActionPausedMarketSessionAt(
      new Date(firstMinute + minute * 60_000),
    );
  }

  assert.equal(
    __signalMonitorInternalsForTests.getMarketSessionContextCacheSizeForTests(),
    fullMatrixContexts,
  );

  const contextsPastBound = 400;
  for (
    let minute = fullMatrixContexts;
    minute < fullMatrixContexts + contextsPastBound;
    minute += 1
  ) {
    isSignalMonitorActionPausedMarketSessionAt(
      new Date(firstMinute + minute * 60_000),
    );
  }

  assert.equal(
    __signalMonitorInternalsForTests.getMarketSessionContextCacheSizeForTests(),
    12_288,
  );
  assert.equal(
    __signalMonitorInternalsForTests.hasMarketSessionContextAtForTests(
      new Date(firstMinute),
    ),
    false,
  );
  assert.equal(
    __signalMonitorInternalsForTests.hasMarketSessionContextAtForTests(
      new Date(
        firstMinute +
          (fullMatrixContexts + contextsPastBound - 1) * 60_000,
      ),
    ),
    true,
  );
});

test("signal market-session context skips next-open interval metadata", () => {
  marketCalendarTesting.resetCalendarCaches();
  __signalMonitorInternalsForTests.resetMarketSessionContextCacheForTests();

  const originalParse = Date.parse;
  let parseCalls = 0;
  Date.parse = (value) => {
    parseCalls += 1;
    return originalParse(value);
  };

  try {
    isSignalMonitorActionPausedMarketSessionAt(
      new Date("2026-07-14T15:30:12.000Z"),
    );
    __signalMonitorInternalsForTests.resetMarketSessionContextCacheForTests();
    isSignalMonitorActionPausedMarketSessionAt(
      new Date("2026-07-18T15:30:12.000Z"),
    );
    assert.equal(parseCalls, 0);
  } finally {
    Date.parse = originalParse;
  }
});
