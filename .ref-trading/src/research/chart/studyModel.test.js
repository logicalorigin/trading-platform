import test from "node:test";
import assert from "node:assert/strict";
import { buildStudyModel } from "./studyModel.js";

function createBar(index, close) {
  return {
    time: Date.UTC(2024, 0, 1, 14, 30 + index),
    o: close - 0.25,
    h: close + 0.5,
    l: close - 0.75,
    c: close,
    v: 1000 + index * 10,
  };
}

const SAMPLE_BARS = Array.from({ length: 32 }, (_, index) => createBar(index, 100 + index * 0.35));

test("buildStudyModel shows only the lower RayAlgo band during a bullish trend window", () => {
  const { studySpecs } = buildStudyModel({
    chartBars: SAMPLE_BARS,
    strategy: "rayalgo",
    rayalgoTrendDirection: "long",
  });

  const basis = studySpecs.find((spec) => spec.key === "rayalgoBandBasis");
  const upper = studySpecs.find((spec) => spec.key === "rayalgoBandUpper");
  const lower = studySpecs.find((spec) => spec.key === "rayalgoBandLower");

  assert.equal(basis?.options?.visible, false);
  assert.equal(upper?.options?.visible, false);
  assert.equal(lower?.options?.visible, true);
  assert.equal(lower?.options?.lineWidth, 3);
});

test("buildStudyModel shows only the upper RayAlgo band during a bearish trend window", () => {
  const { studySpecs } = buildStudyModel({
    chartBars: SAMPLE_BARS,
    strategy: "rayalgo",
    rayalgoTrendDirection: "short",
  });

  const upper = studySpecs.find((spec) => spec.key === "rayalgoBandUpper");
  const lower = studySpecs.find((spec) => spec.key === "rayalgoBandLower");

  assert.equal(upper?.options?.visible, true);
  assert.equal(upper?.options?.lineWidth, 3);
  assert.equal(lower?.options?.visible, false);
});
