import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIndicatorOverlayTape,
  resolveChartOverlaySourceBars,
  resolveResearchExecutionOverlayState,
} from "./researchExecutionOverlayUtils.js";

test("chart overlays stay on the local RayAlgo tape when a later replay payload arrives", () => {
  const localSignalOverlayTape = {
    events: [{ id: "local-signal", source: "local" }],
    zones: [{ id: "local-zone", source: "local" }],
    windows: [{ id: "local-window", source: "local" }],
  };
  const localIndicatorOverlayTapesByTf = {
    "5m": localSignalOverlayTape,
    "15m": {
      events: [{ id: "local-15m-signal", source: "local" }],
      zones: [{ id: "local-15m-zone", source: "local" }],
      windows: [],
    },
  };
  const replayIndicatorOverlayTape = {
    events: [{ id: "replay-signal", source: "replay" }],
    zones: [{ id: "replay-zone", source: "replay" }],
    windows: [{ id: "replay-window", source: "replay" }],
  };

  const initialState = resolveResearchExecutionOverlayState({
    signalOverlayTape: localSignalOverlayTape,
    localIndicatorOverlayTapesByTf,
    replayIndicatorOverlayTape: null,
  });
  const laterState = resolveResearchExecutionOverlayState({
    signalOverlayTape: localSignalOverlayTape,
    localIndicatorOverlayTapesByTf,
    replayIndicatorOverlayTape,
  });

  assert.equal(initialState.chartIndicatorOverlayTape, localSignalOverlayTape);
  assert.equal(laterState.chartIndicatorOverlayTape, localSignalOverlayTape);
  assert.equal(laterState.chartIndicatorOverlayTape, initialState.chartIndicatorOverlayTape);
  assert.equal(laterState.chartIndicatorOverlayTapesByTf, localIndicatorOverlayTapesByTf);
  assert.notEqual(laterState.chartIndicatorOverlayTape, replayIndicatorOverlayTape);
  assert.equal(laterState.replayIndicatorOverlayTape, replayIndicatorOverlayTape);
});

test("chart overlays only fall back to the replay tape when no local overlay exists", () => {
  const replayIndicatorOverlayTape = {
    events: [{ id: "replay-signal", source: "replay" }],
    zones: [],
    windows: [],
  };

  const resolved = resolveResearchExecutionOverlayState({
    signalOverlayTape: null,
    localIndicatorOverlayTapesByTf: {},
    replayIndicatorOverlayTape,
  });

  assert.equal(resolved.chartIndicatorOverlayTape, replayIndicatorOverlayTape);
  assert.deepEqual(resolved.chartIndicatorOverlayTapesByTf, {});
});

test("normalizeIndicatorOverlayTape returns stable empty arrays for missing replay overlays", () => {
  assert.deepEqual(normalizeIndicatorOverlayTape(null), {
    events: [],
    zones: [],
    windows: [],
  });

  assert.deepEqual(normalizeIndicatorOverlayTape({ events: [{ id: "partial" }] }), {
    events: [{ id: "partial" }],
    zones: [],
    windows: [],
  });
});

test("chart overlay bars prefer the full loaded chart history over the filtered execution window", () => {
  const chartBars = [{ ts: "2026-01-02 09:30" }, { ts: "2026-03-26 15:55" }];
  const executionBars = [{ ts: "2026-02-10 09:30" }];

  assert.equal(
    resolveChartOverlaySourceBars({ chartBars, executionBars }),
    chartBars,
  );
});

test("chart overlay bars fall back to the execution window when no chart history is loaded", () => {
  const executionBars = [{ ts: "2026-02-10 09:30" }];

  assert.equal(
    resolveChartOverlaySourceBars({ chartBars: null, executionBars }),
    executionBars,
  );
});
