import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixProfileUniverseStreamKey,
  resolveSignalMatrixStreamFramePublication,
} from "./signalMatrixBootstrapModel.js";

test("intermediate bootstrap pages stay staged until the complete snapshot", () => {
  assert.deepEqual(
    resolveSignalMatrixStreamFramePublication("bootstrap", {
      bootstrapPage: { complete: false },
    }),
    {
      markBootstrapReceived: false,
      publishHeaderStates: false,
      publishSnapshotStates: false,
    },
  );
});

test("the final bootstrap page unlocks timeframe widening and header publication", () => {
  assert.deepEqual(
    resolveSignalMatrixStreamFramePublication("bootstrap", {
      bootstrapPage: { complete: true },
    }),
    {
      markBootstrapReceived: true,
      publishHeaderStates: true,
      publishSnapshotStates: true,
    },
  );
});

test("delta frames publish normally and legacy single-frame bootstraps stay compatible", () => {
  assert.deepEqual(
    resolveSignalMatrixStreamFramePublication("state-delta", null),
    {
      markBootstrapReceived: false,
      publishHeaderStates: true,
      publishSnapshotStates: true,
    },
  );
  assert.deepEqual(
    resolveSignalMatrixStreamFramePublication("bootstrap", null),
    {
      markBootstrapReceived: true,
      publishHeaderStates: true,
      publishSnapshotStates: true,
    },
  );
});

test("evaluation-only profile timestamps do not re-key the matrix stream", () => {
  const input = {
    profile: {
      id: "profile-1",
      watchlistId: "watchlist-1",
      enabled: true,
      timeframe: "5m",
      freshWindowBars: 3,
      pyrusSignalsSettings: { universeScope: "all_watchlists" },
      updatedAt: "2026-07-17T12:00:00.000Z",
      lastEvaluatedAt: "2026-07-17T12:00:00.000Z",
    },
    universeScope: "all_watchlists",
    universeSymbolLimit: 500,
    watchlistSymbolsKey: "AAPL,MSFT",
  };
  const nextEvaluation = {
    ...input,
    profile: {
      ...input.profile,
      updatedAt: "2026-07-17T12:01:00.000Z",
      lastEvaluatedAt: "2026-07-17T12:01:00.000Z",
    },
  };

  assert.equal(
    buildSignalMatrixProfileUniverseStreamKey(input),
    buildSignalMatrixProfileUniverseStreamKey(nextEvaluation),
  );
});

test("semantic universe and signal configuration changes re-key the matrix stream", () => {
  const input = {
    profile: {
      id: "profile-1",
      watchlistId: "watchlist-1",
      enabled: true,
      timeframe: "5m",
      freshWindowBars: 3,
      pyrusSignalsSettings: { universeScope: "all_watchlists" },
    },
    universeScope: "all_watchlists",
    universeSymbolLimit: 500,
    watchlistSymbolsKey: "AAPL,MSFT",
  };
  const currentKey = buildSignalMatrixProfileUniverseStreamKey(input);
  const changes = [
    { profile: { ...input.profile, watchlistId: "watchlist-2" } },
    { universeScope: "selected_watchlist" },
    { universeSymbolLimit: 250 },
    { watchlistSymbolsKey: "AAPL,NVDA" },
    { profile: { ...input.profile, freshWindowBars: 4 } },
    {
      profile: {
        ...input.profile,
        pyrusSignalsSettings: { universeScope: "all_watchlists", basis: 80 },
      },
    },
  ];

  changes.forEach((patch) => {
    assert.notEqual(
      buildSignalMatrixProfileUniverseStreamKey({
        ...input,
        ...patch,
      }),
      currentKey,
    );
  });
});
