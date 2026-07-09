import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluatePyrusSignalsFixture,
  findFirstStableDifference,
  formatStableDifference,
  projectEvaluationTail,
  PYRUS_SIGNALS_FIXTURE_TAIL_BARS,
  PYRUS_SIGNALS_PARITY_FIXTURES,
  PYRUS_SIGNALS_WARMUP_SAMPLE_SIZES,
  stableSerialize,
} from "./parity-fixtures";

type WarmupResult = {
  fixtureName: string;
  fixtureLength: number;
  sampleSize: number;
  identical: boolean;
  difference: string | null;
};

const compareWarmup = (
  fixtureName: string,
  barsLength: number,
  fullProjection: ReturnType<typeof projectEvaluationTail>,
  sampleSize: number,
  sampleProjection: ReturnType<typeof projectEvaluationTail>,
): WarmupResult => {
  const fullBytes = stableSerialize(fullProjection);
  const sampleBytes = stableSerialize(sampleProjection);
  if (fullBytes === sampleBytes) {
    return {
      fixtureName,
      fixtureLength: barsLength,
      sampleSize,
      identical: true,
      difference: null,
    };
  }
  return {
    fixtureName,
    fixtureLength: barsLength,
    sampleSize,
    identical: false,
    difference: formatStableDifference(
      findFirstStableDifference(fullProjection, sampleProjection),
    ),
  };
};

const results: WarmupResult[] = [];

for (const fixture of PYRUS_SIGNALS_PARITY_FIXTURES) {
  const fullEvaluation = evaluatePyrusSignalsFixture(fixture.bars);
  const fullProjection = projectEvaluationTail(
    fullEvaluation,
    fixture.bars.length,
    PYRUS_SIGNALS_FIXTURE_TAIL_BARS,
  );
  for (const sampleSize of PYRUS_SIGNALS_WARMUP_SAMPLE_SIZES) {
    const sampleBars = fixture.bars.slice(-sampleSize);
    const sampleEvaluation = evaluatePyrusSignalsFixture(sampleBars);
    const sampleProjection = projectEvaluationTail(
      sampleEvaluation,
      sampleBars.length,
      PYRUS_SIGNALS_FIXTURE_TAIL_BARS,
    );
    results.push(
      compareWarmup(
        fixture.name,
        fixture.bars.length,
        fullProjection,
        sampleSize,
        sampleProjection,
      ),
    );
  }
}

const smallestIdenticalSample =
  PYRUS_SIGNALS_WARMUP_SAMPLE_SIZES.find((sampleSize) =>
    results
      .filter((result) => result.sampleSize === sampleSize)
      .every((result) => result.identical),
  ) ?? null;
const conclusion =
  smallestIdenticalSample === null
    ? "none below 1000"
    : smallestIdenticalSample < 1000
      ? `${smallestIdenticalSample} bars`
      : "none below 1000; 1000 bars is the first identical sample";

const header = [
  "# Warmup Sensitivity Report - 2026-07-09",
  "",
  "Observed consumer window: `SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240` at `artifacts/api-server/src/services/signal-monitor.ts:474`; backfilled-base storage keeps `input.bars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT)` at `:5968`; the live stream path evaluates `mergedBars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT)` at `:10584`; production evaluation passes `includeProvisionalSignals: !settings.waitForBarClose` and `lastBarClosed` at `:8582-8587`.",
  "",
  "Projection rule: per-bar arrays are compared over the last 240 bars. Tail events are filtered to the same window and normalized to tail-local `barIndex`/`id`, because the signal monitor consumes relative positions from the provided completed-bar series.",
  "",
  "Default settings source: `lib/pyrus-signals-core/src/index.ts:172-206`; warmup constant remains `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS = 1000` at `:164`.",
  "",
  "| Fixture | Bars | 240 | 300 | 380 | 460 | 540 | 700 | 1000 |",
  "| --- | ---: | --- | --- | --- | --- | --- | --- | --- |",
];

const rows = PYRUS_SIGNALS_PARITY_FIXTURES.map((fixture) => {
  const cells = PYRUS_SIGNALS_WARMUP_SAMPLE_SIZES.map((sampleSize) => {
    const result = results.find(
      (candidate) =>
        candidate.fixtureName === fixture.name &&
        candidate.sampleSize === sampleSize,
    );
    if (!result) {
      return "missing";
    }
    return result.identical
      ? "IDENTICAL"
      : `first divergent: ${result.difference ?? "unknown"}`;
  });
  return `| ${fixture.name} | ${fixture.bars.length} | ${cells.join(" | ")} |`;
});

const conclusionLines = [
  "",
  "## Conclusion",
  "",
  `Smallest N byte-identical across all fixtures: ${conclusion}.`,
  "Compared surface: the last 240 bars, matching the signal-monitor matrix consumer window.",
  "Runtime action: report only; no warmup constant changed.",
  "",
];

const report = [...header, ...rows, ...conclusionLines].join("\n");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const reportPath = resolve(
  repoRoot,
  "docs/plans/warmup-sensitivity-2026-07-09.md",
);

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, report, "utf8");

console.log(`Wrote ${reportPath}`);
console.log(`Warmup conclusion: ${conclusion}`);
