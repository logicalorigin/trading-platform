import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createIncrementalPyrusSignalsEvaluator } from "./incremental";
import { resolvePyrusSignalsSignalSettings } from "./index";
import {
  assertAppendParity,
  evaluatePyrusSignalsFixture,
  findFirstStableDifference,
  formatStableDifference,
  minimumAppendParityLength,
  PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
  PYRUS_SIGNALS_PARITY_FIXTURES,
  stableSerialize,
} from "./__fixtures__/parity-fixtures";
import type {
  PyrusSignalsBar,
  PyrusSignalsEvaluation,
  PyrusSignalsSignalSettings,
} from "./index";

const goldenDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/goldens",
);

test("parity fixtures match committed golden evaluations", async () => {
  assert.ok(PYRUS_SIGNALS_PARITY_FIXTURES.length >= 11);

  for (const fixture of PYRUS_SIGNALS_PARITY_FIXTURES) {
    const goldenPath = join(goldenDirectory, `${fixture.name}.json`);
    const golden = await readFile(goldenPath, "utf8");
    const evaluation = evaluatePyrusSignalsFixture(fixture.bars);
    const actual = stableSerialize(evaluation);
    if (actual !== golden) {
      const expectedValue = JSON.parse(golden) as unknown;
      assert.fail(
        `${fixture.name} drifted from golden: ${formatStableDifference(
          findFirstStableDifference(expectedValue, evaluation),
        )}`,
      );
    }
  }
});

test("append parity harness passes with from-scratch evaluation over representative fixtures", () => {
  for (const fixtureName of ["steady-uptrend", "choppy-mean-reverting"]) {
    const fixture = PYRUS_SIGNALS_PARITY_FIXTURES.find(
      (candidate) => candidate.name === fixtureName,
    );
    assert.ok(fixture, `missing fixture ${fixtureName}`);
    assertAppendParity(fixture.bars.slice(0, 260), evaluatePyrusSignalsFixture);
  }
});

const createAppendParityAdapter = (
  settings: PyrusSignalsSignalSettings = PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
): ((series: PyrusSignalsBar[]) => PyrusSignalsEvaluation) => {
  const evaluator = createIncrementalPyrusSignalsEvaluator(settings);
  let appended = 0;
  return (series) => {
    assert.ok(
      series.length >= appended,
      "append parity adapter only supports growing prefixes",
    );
    while (appended < series.length) {
      evaluator.append(series[appended]);
      appended += 1;
    }
    return evaluator.result();
  };
};

const assertAppendParityWithSettings = (
  series: PyrusSignalsBar[],
  settings: PyrusSignalsSignalSettings,
): void => {
  const evaluator = createIncrementalPyrusSignalsEvaluator(settings);
  const start = Math.min(series.length, minimumAppendParityLength(settings));
  for (let index = 0; index < series.length; index += 1) {
    const incremental = evaluator.append(series[index]);
    const length = index + 1;
    if (length < start) {
      continue;
    }
    const fresh = evaluatePyrusSignalsFixture(series.slice(0, length), settings);
    const freshBytes = stableSerialize(fresh);
    const incrementalBytes = stableSerialize(incremental);
    if (freshBytes !== incrementalBytes) {
      assert.fail(
        `settings append parity diverged at k=${length}: ${formatStableDifference(
          findFirstStableDifference(fresh, incremental),
        )}`,
      );
    }
  }
};

test("incremental evaluator is append-identical across all parity fixtures", () => {
  const startedAt = performance.now();
  assert.ok(PYRUS_SIGNALS_PARITY_FIXTURES.length >= 11);
  for (const fixture of PYRUS_SIGNALS_PARITY_FIXTURES) {
    assertAppendParity(fixture.bars, createAppendParityAdapter());
  }
  const runtimeMs = performance.now() - startedAt;
  console.log(
    `append parity all fixtures runtime: ${runtimeMs.toFixed(3)}ms`,
  );
});

test("incremental evaluator matches from-scratch under non-default settings", () => {
  const variants = [
    resolvePyrusSignalsSignalSettings({
      timeHorizon: 5,
      basisLength: 34,
      atrLength: 10,
      atrSmoothing: 8,
      volumeMaLength: 12,
    }),
    resolvePyrusSignalsSignalSettings({
      timeHorizon: 12,
      bosConfirmation: "close",
      chochAtrBuffer: 0.25,
      chochBodyExpansionAtr: 0.35,
      chochVolumeGate: 1.1,
      shadowLength: 14,
      adxLength: 9,
      volumeMaLength: 7,
    }),
  ];
  const fixtureNames = ["steady-uptrend", "gappy"];

  for (const settings of variants) {
    for (const fixtureName of fixtureNames) {
      const fixture = PYRUS_SIGNALS_PARITY_FIXTURES.find(
        (candidate) => candidate.name === fixtureName,
      );
      assert.ok(fixture, `missing fixture ${fixtureName}`);
      assertAppendParityWithSettings(fixture.bars, settings);
    }
  }
});

test("incremental evaluators keep interleaved state isolated", () => {
  const leftFixture = PYRUS_SIGNALS_PARITY_FIXTURES.find(
    (fixture) => fixture.name === "steady-uptrend",
  );
  const rightFixture = PYRUS_SIGNALS_PARITY_FIXTURES.find(
    (fixture) => fixture.name === "choppy-mean-reverting",
  );
  assert.ok(leftFixture);
  assert.ok(rightFixture);

  const left = createIncrementalPyrusSignalsEvaluator(
    PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
  );
  const right = createIncrementalPyrusSignalsEvaluator(
    PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
  );
  const sampleLength = 320;
  for (let index = 0; index < sampleLength; index += 1) {
    const leftResult = left.append(leftFixture.bars[index]);
    const rightResult = right.append(rightFixture.bars[index]);
    if (index % 37 === 0 || index === sampleLength - 1) {
      assert.deepEqual(
        stableSerialize(leftResult),
        stableSerialize(
          evaluatePyrusSignalsFixture(leftFixture.bars.slice(0, index + 1)),
        ),
      );
      assert.deepEqual(
        stableSerialize(rightResult),
        stableSerialize(
          evaluatePyrusSignalsFixture(rightFixture.bars.slice(0, index + 1)),
        ),
      );
    }
  }
});

test("incremental last-100 appends are materially faster than rebuilding prefixes", () => {
  const fixture = PYRUS_SIGNALS_PARITY_FIXTURES.find(
    (candidate) => candidate.name === "steady-uptrend",
  );
  assert.ok(fixture);
  const evaluator = createIncrementalPyrusSignalsEvaluator(
    PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
  );
  for (const bar of fixture.bars.slice(0, 900)) {
    evaluator.append(bar);
  }

  const incrementalStartedAt = performance.now();
  for (const bar of fixture.bars.slice(900, 1000)) {
    evaluator.append(bar);
  }
  const incrementalMs = performance.now() - incrementalStartedAt;

  const freshStartedAt = performance.now();
  for (let length = 901; length <= 1000; length += 1) {
    evaluatePyrusSignalsFixture(fixture.bars.slice(0, length));
  }
  const freshMs = performance.now() - freshStartedAt;

  console.log(
    `perf sanity last100 incremental=${incrementalMs.toFixed(
      3,
    )}ms fresh100=${freshMs.toFixed(3)}ms ratio=${(
      freshMs / Math.max(incrementalMs, 0.001)
    ).toFixed(2)}x`,
  );
  assert.ok(
    incrementalMs < freshMs / 5,
    `incremental ${incrementalMs.toFixed(
      3,
    )}ms must be < fresh ${freshMs.toFixed(3)}ms / 5`,
  );
});
