import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAlgoSignalSparklinePressureLevel,
  shouldPauseAlgoSignalRowSparklines,
} from "./algoSignalSparklinePressure.js";

test("algo row sparklines stay enabled under normal and watch pressure", () => {
  assert.equal(shouldPauseAlgoSignalRowSparklines({ level: "normal" }), false);
  assert.equal(shouldPauseAlgoSignalRowSparklines({ level: "watch" }), false);
});

test("algo row sparklines pause under direct high pressure", () => {
  assert.equal(shouldPauseAlgoSignalRowSparklines({ level: "high" }), true);
});

test("algo row sparklines stay enabled for API-latency pressure alone", () => {
  const snapshot = {
    level: "normal",
    server: {
      apiPressureLevel: "high",
      pressureLevel: "watch",
    },
  };

  assert.equal(resolveAlgoSignalSparklinePressureLevel(snapshot), "normal");
  assert.equal(shouldPauseAlgoSignalRowSparklines(snapshot), false);
});

test("algo row sparklines pause when memory pressure is high", () => {
  const snapshot = {
    level: "normal",
    server: {
      effectivePressureLevel: "high",
      dominantDrivers: [
        {
          kind: "api-rss",
          level: "high",
        },
      ],
    },
  };

  assert.equal(resolveAlgoSignalSparklinePressureLevel(snapshot), "high");
  assert.equal(shouldPauseAlgoSignalRowSparklines(snapshot), true);
});
