import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluatePyrusSignalsFixture,
  PYRUS_SIGNALS_PARITY_FIXTURES,
  stableSerialize,
} from "./parity-fixtures";

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "goldens",
);

await mkdir(fixtureDirectory, { recursive: true });

for (const fixture of PYRUS_SIGNALS_PARITY_FIXTURES) {
  const evaluation = evaluatePyrusSignalsFixture(fixture.bars);
  const filePath = join(fixtureDirectory, `${fixture.name}.json`);
  await writeFile(filePath, stableSerialize(evaluation), "utf8");
}

console.log(
  `Regenerated ${PYRUS_SIGNALS_PARITY_FIXTURES.length} pyrus signal parity goldens.`,
);
