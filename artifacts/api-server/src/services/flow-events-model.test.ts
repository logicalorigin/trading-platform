import assert from "node:assert/strict";
import test from "node:test";
import {
  deferredFlowEventsResult,
  filterFlowEventsForRequest,
  flowEventsFilterCacheKey,
  flowSource,
  isCacheableFlowEventsResult,
  isFlowScannerSnapshotAllowedForFallbackPolicy,
  normalizeFlowEventsFilters,
  shouldPreserveCachedFlowEvents,
  type FlowEventsResult,
} from "./flow-events-model";

const now = new Date("2026-05-06T15:00:00.000Z");
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000);

test("flow event filters normalize request values", () => {
  assert.deepEqual(
    normalizeFlowEventsFilters({
      scope: "unusual",
      minPremium: "999999999",
      maxDte: "2.6",
    }),
    {
      scope: "unusual",
      minPremium: 50_000_000,
      maxDte: 3,
    },
  );

  assert.deepEqual(
    normalizeFlowEventsFilters({
      scope: "all",
      minPremium: "-1",
      maxDte: "",
    }),
    {
      scope: "all",
      minPremium: 0,
      maxDte: null,
    },
  );
});

test("flow event filters apply unusual, premium, dte, and limit policy", () => {
  const filters = normalizeFlowEventsFilters({
    scope: "unusual",
    minPremium: 100_000,
    maxDte: 7,
  });
  const events = [
    {
      id: "stale",
      isUnusual: true,
      premium: 200_000,
      expirationDate: daysFromNow(20),
    },
    {
      id: "accepted",
      unusualScore: 4,
      premium: 150_000,
      expirationDate: daysFromNow(2),
    },
    {
      id: "too-small",
      unusualScore: 10,
      premium: 10_000,
      expirationDate: daysFromNow(2),
    },
    {
      id: "second",
      side: "buy",
      premium: 125_000,
      expirationDate: daysFromNow(3),
    },
  ];

  const filtered = filterFlowEventsForRequest(events, filters, 2, 1);
  assert.deepEqual(filtered, [events[1]]);
});

test("flow cache helpers preserve live data across transient empty sources", () => {
  const cached: { value: FlowEventsResult; staleExpiresAt: number } = {
    value: {
      events: [{ id: "live" }],
      source: flowSource({
        provider: "ibkr",
        status: "live",
        ibkrStatus: "loaded",
      }),
    },
    staleExpiresAt: now.getTime() + 1_000,
  };
  const transientEmpty = deferredFlowEventsResult({
    underlying: "SPY",
    filters: normalizeFlowEventsFilters({}),
    limit: 5,
    reason: "options_flow_scanner_queued",
  });

  assert.equal(isCacheableFlowEventsResult(transientEmpty), false);
  assert.equal(
    shouldPreserveCachedFlowEvents(
      cached,
      transientEmpty,
      now.getTime(),
    ),
    true,
  );
});

test("flow scanner snapshot policy rejects polygon fallback unless allowed", () => {
  const snapshot = {
    source: flowSource({
      provider: "polygon",
      status: "fallback",
      fallbackUsed: true,
    }),
  };

  assert.equal(isFlowScannerSnapshotAllowedForFallbackPolicy(snapshot, false), false);
  assert.equal(isFlowScannerSnapshotAllowedForFallbackPolicy(snapshot, true), true);
  assert.equal(
    flowEventsFilterCacheKey(normalizeFlowEventsFilters({ scope: "unusual" })),
    "unusual:0:any",
  );
});
