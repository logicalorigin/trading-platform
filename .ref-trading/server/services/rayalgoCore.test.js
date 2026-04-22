import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRayAlgoSignalPayload,
  normalizeRayAlgoSignalClass,
  RAYALGO_EVENT_TYPE_SIGNAL,
  RAYALGO_EVENT_TYPE_TREND_CHANGE,
} from "./rayalgoCore.js";

test("normalizeRayAlgoSignalPayload preserves generic pine signal event type", () => {
  const normalized = normalizeRayAlgoSignalPayload({
    source: "pine",
    symbol: "SPY",
    timeframe: "5",
    eventType: "signal",
    direction: "buy",
    ts: "2026-03-26T10:00:00.000Z",
    conviction: 0.61,
    components: {
      emaCross: 1,
      bandTrend: 1,
      bandRetest: 0,
    },
  });

  assert.equal(normalized?.eventType, RAYALGO_EVENT_TYPE_SIGNAL);
  assert.equal(normalized?.signalClass, null);
  assert.equal(normalized?.direction, "buy");
  assert.equal(normalized?.components?.bandTrend, 1);
  assert.equal(normalized?.components?.bandRetest, 0);
});

test("normalizeRayAlgoSignalPayload normalizes explicit trend-change signal class", () => {
  const normalized = normalizeRayAlgoSignalPayload({
    source: "local",
    symbol: "SPY",
    timeframe: "5",
    eventType: "trend_change",
    signalClass: "trend_change",
    direction: "short",
    ts: "2026-03-26T10:05:00.000Z",
    conviction: 0.72,
  });

  assert.equal(normalized?.eventType, RAYALGO_EVENT_TYPE_TREND_CHANGE);
  assert.equal(normalized?.signalClass, RAYALGO_EVENT_TYPE_TREND_CHANGE);
  assert.equal(normalized?.direction, "sell");
  assert.equal(normalizeRayAlgoSignalClass(normalized?.eventType), RAYALGO_EVENT_TYPE_TREND_CHANGE);
});
