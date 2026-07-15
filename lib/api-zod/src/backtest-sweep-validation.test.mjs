import assert from "node:assert/strict";
import test from "node:test";

import { CreateBacktestSweepBody } from "./generated/api.ts";

const validSweep = {
  studyId: "study-fixture",
  mode: "walk_forward",
  baseParameters: {},
  dimensions: [],
  randomCandidateBudget: null,
  walkForwardTrainingMonths: 24,
  walkForwardTestMonths: 6,
  walkForwardStepMonths: 6,
};

test("walk-forward month inputs must be positive integers", () => {
  for (const field of [
    "walkForwardTrainingMonths",
    "walkForwardTestMonths",
    "walkForwardStepMonths",
  ]) {
    for (const value of [0, -1, 0.5]) {
      assert.equal(
        CreateBacktestSweepBody.safeParse({
          ...validSweep,
          [field]: value,
        }).success,
        false,
        `${field} accepted ${value}`,
      );
    }
  }

  assert.equal(CreateBacktestSweepBody.safeParse(validSweep).success, true);
  assert.equal(
    CreateBacktestSweepBody.safeParse({
      ...validSweep,
      walkForwardTrainingMonths: null,
      walkForwardTestMonths: null,
      walkForwardStepMonths: null,
    }).success,
    true,
  );
});
