import assert from "node:assert/strict";
import test from "node:test";

import {
  deferredFlowEventsResult,
  filterFlowEventsForRequest,
  flowEventMatchesFilters,
} from "./flow-events-model";

test("deferred flow scanner results report Massive as the data provider", () => {
  const result = deferredFlowEventsResult({
    underlying: "SPY",
    limit: 1,
    filters: { scope: "all", minPremium: 0, maxDte: null },
    reason: "options_flow_scanner_snapshot_pending",
  });

  assert.equal(result.source.provider, "massive");
  assert.deepEqual(result.source.attemptedProviders, ["massive"]);
  assert.equal(result.source.ibkrReason, "options_flow_scanner_snapshot_pending");
});

test("unfiltered flow requests do not parse unused expiration data", () => {
  const expirationDate = {
    toString() {
      throw new Error("expiration should not be parsed");
    },
  };

  assert.equal(
    flowEventMatchesFilters(
      { expirationDate },
      { scope: "all", minPremium: 0, maxDte: null },
      undefined,
    ),
    true,
  );
});

test("flow filtering stops after reaching the requested limit", () => {
  const unreadEvent = {
    get premium() {
      throw new Error("events beyond the limit should not be read");
    },
  };

  assert.deepEqual(
    filterFlowEventsForRequest(
      [{ premium: 1 }, unreadEvent],
      { scope: "all", minPremium: 0, maxDte: null },
      undefined,
      1,
    ),
    [{ premium: 1 }],
  );
});

test("narrow flow filters retain premium, unusual, and DTE semantics", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");
  const event = {
    premium: 150_000,
    expirationDate: "2026-07-10T00:00:00.000Z",
    side: "buy",
  };

  assert.equal(
    flowEventMatchesFilters(
      event,
      { scope: "unusual", minPremium: 100_000, maxDte: 1 },
      2,
      now,
    ),
    true,
  );
  assert.equal(
    flowEventMatchesFilters(
      event,
      { scope: "all", minPremium: 200_000, maxDte: null },
      undefined,
      now,
    ),
    false,
  );
  assert.equal(
    flowEventMatchesFilters(
      event,
      { scope: "all", minPremium: 0, maxDte: 0 },
      undefined,
      now,
    ),
    false,
  );
});
