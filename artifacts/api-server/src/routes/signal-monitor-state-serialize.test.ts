import { test } from "node:test";
import assert from "node:assert/strict";

import { GetSignalMonitorStateResponse } from "@workspace/api-zod";

// The /signal-monitor/state route serializes getSignalMonitorState() output
// directly (JSON.stringify) instead of re-validating it through
// GetSignalMonitorStateResponse.parse() on every cache miss. That reflective
// re-walk of the full ~12k-state universe ran synchronously on the event loop
// (~0.4-1s per miss) and was the primary source of the periodic ~1s /state
// event-loop stalls. Dropping it is only safe if the schema does NOT reshape a
// schema-conformant value — i.e. it neither strips keys, reorders keys, nor
// coerces values in a way that changes the serialized bytes. This test locks
// that: it fails in CI if the schema gains a .transform()/.default()/.strip()
// effect (or the handler's shape drifts from the schema), instead of silently
// changing what the client receives.
//
// The fixture mirrors the exact shape getSignalMonitorState assembles
// (profileToResponse + stateToResponse[ForSnapshot] + coverage fill), in schema
// key order, with Date-valued temporal fields.

const at = (iso: string) => new Date(iso);

const value = {
  profile: {
    id: "profile-1",
    environment: "shadow" as const,
    enabled: true,
    watchlistId: null,
    timeframe: "15m" as const,
    pyrusSignalsSettings: { universeMode: "all_watchlists", nested: { k: 1 } },
    freshWindowBars: 5,
    pollIntervalSeconds: 60,
    maxSymbols: 2000,
    evaluationConcurrency: 4,
    lastEvaluatedAt: at("2026-07-10T21:00:00.000Z"),
    lastError: null,
    createdAt: at("2026-06-01T00:00:00.000Z"),
    updatedAt: at("2026-07-10T20:59:00.000Z"),
  },
  states: [
    // "ok" state carrying a live signal (all numeric/record fields populated).
    {
      id: "profile-1:AAA:15m",
      profileId: "profile-1",
      symbol: "AAA",
      timeframe: "15m" as const,
      currentSignalDirection: "buy" as const,
      currentSignalAt: at("2026-07-10T20:45:00.000Z"),
      currentSignalPrice: 12.34,
      currentSignalClose: 12.5,
      currentSignalMfePercent: 1.2,
      currentSignalMaePercent: -0.4,
      filterState: { trend: "up", score: 0.87 },
      latestBarAt: at("2026-07-10T21:00:00.000Z"),
      latestBarClose: 12.6,
      barsSinceSignal: 3,
      fresh: true,
      status: "ok" as const,
      active: true,
      lastEvaluatedAt: at("2026-07-10T21:00:00.000Z"),
      lastError: null,
      trendDirection: "bullish" as const,
      actionEligible: true,
      actionBlocker: null,
    },
    // Relabeled non-current lane (signal identity cleared, action blocked).
    {
      id: "profile-1:BBB:15m",
      profileId: "profile-1",
      symbol: "BBB",
      timeframe: "15m" as const,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      currentSignalClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
      filterState: null,
      latestBarAt: null,
      latestBarClose: null,
      barsSinceSignal: null,
      fresh: false,
      status: "stale" as const,
      active: true,
      lastEvaluatedAt: at("2026-07-10T20:30:00.000Z"),
      lastError: "stale lane",
      trendDirection: null,
      actionEligible: false,
      actionBlocker: "market_closed",
    },
    // Coverage-fill "unavailable" cell (buildUnavailableSignalMonitorSnapshotState).
    {
      id: "profile-1:CCC:15m:unavailable",
      profileId: "profile-1",
      symbol: "CCC",
      timeframe: "15m" as const,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      currentSignalClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
      filterState: null,
      latestBarAt: null,
      latestBarClose: null,
      barsSinceSignal: null,
      fresh: false,
      status: "unavailable" as const,
      active: true,
      lastEvaluatedAt: at("2026-07-10T21:00:00.000Z"),
      lastError: "No signal monitor state is available for this symbol/timeframe.",
      trendDirection: null,
      actionEligible: false,
      actionBlocker: "no_signal",
    },
  ],
  evaluatedAt: at("2026-07-10T21:00:00.000Z"),
  truncated: false,
  skippedSymbols: [] as string[],
  universeSymbols: ["AAA", "BBB", "CCC"],
  universe: {
    mode: "all_watchlists" as const,
    configuredMaxSymbols: 2000,
    resolvedSymbols: 3,
    pinnedSymbols: 0,
    expansionSymbols: 0,
    shortfall: 0,
    source: "all_watchlists" as const,
    fallbackUsed: false,
    degradedReason: null,
    rankedAt: at("2026-07-10T20:00:00.000Z"),
  },
  stateSource: "database" as const,
};

test("/signal-monitor/state: direct JSON.stringify is byte-identical to schema.parse", () => {
  const direct = JSON.stringify(value);
  const viaSchema = JSON.stringify(GetSignalMonitorStateResponse.parse(value));
  assert.equal(
    direct,
    viaSchema,
    "GetSignalMonitorStateResponse reshaped a schema-conformant value (strip/reorder/coerce); the /state route serializes handler output directly, so any such reshape would silently change the client payload.",
  );
});

test("/signal-monitor/state: fixture is schema-valid and rankedAt=null round-trips", () => {
  // Guards the nullable temporal branch that the fixture above sets non-null.
  const withNullRanked = {
    ...value,
    universe: { ...value.universe, rankedAt: null },
  };
  assert.doesNotThrow(() => GetSignalMonitorStateResponse.parse(withNullRanked));
  assert.equal(
    JSON.stringify(withNullRanked),
    JSON.stringify(GetSignalMonitorStateResponse.parse(withNullRanked)),
  );
});
