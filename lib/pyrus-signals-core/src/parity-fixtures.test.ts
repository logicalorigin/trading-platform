import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertAppendParity,
  evaluatePyrusSignalsFixture,
  findFirstStableDifference,
  formatStableDifference,
  PYRUS_SIGNALS_PARITY_FIXTURES,
  stableSerialize,
} from "./__fixtures__/parity-fixtures";

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
