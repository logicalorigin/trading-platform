// Regenerates directional-features-parity.json — the JS-side golden fixture for
// the Python port of buildPyrusSignalsDirectionalFeatures (jobs.py
// _signal_directional_features) — and signal-matrix-pipeline-parity.json — the
// full-pipeline golden fixture that drives run_signal_matrix end to end
// (trend direction, bar aggregation, CHoCH/BOS loop, filter gates, snapshot).
// Run from the repo root:
//   pnpm --filter @workspace/api-server exec tsx ../../python/pyrus_compute/tests/fixtures/generate-directional-features-parity.mts
// The bars are produced by a seeded LCG so the fixtures are fully deterministic.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregatePyrusSignalsBarsForTimeframe,
  buildPyrusSignalsDirectionalFeatures,
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
  resolvePyrusSignalsTrendDirection,
  type PyrusSignalsBar,
  type PyrusSignalsSignalSettings,
  type PyrusSignalsTimeframeOption,
} from "../../../../lib/pyrus-signals-core/src/index";

let seed = 123456789;
const nextRandom = (): number => {
  // Park–Miller minimal standard LCG; deterministic across runs.
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};

const bars: PyrusSignalsBar[] = [];
let close = 100;
for (let i = 0; i < 160; i += 1) {
  const open = close;
  close = close + (nextRandom() - 0.5) * 2;
  const high = Math.max(open, close) + nextRandom() * 1.5;
  const low = Math.min(open, close) - nextRandom() * 1.5;
  const volume = 500 + Math.floor(nextRandom() * 2000);
  bars.push({
    time: 1_700_000_000 + i * 300,
    o: open,
    h: high,
    l: low,
    c: close,
    v: volume,
  });
}

const cases = [
  { index: 159, direction: 1, mtfDirections: [1, 1, 1], adx: 27.5, volatilityScore: 5.2, atr: 1.8 },
  { index: 159, direction: -1, mtfDirections: [1, -1, 0], adx: 15, volatilityScore: 8.4, atr: 0.9 },
  { index: 100, direction: 1, mtfDirections: [-1, -1, -1], adx: 40, volatilityScore: 2, atr: 3.2 },
  { index: 100, direction: -1, mtfDirections: [], adx: 22, volatilityScore: 6, atr: 0 },
  { index: 79, direction: 1, mtfDirections: [1, 0, -1], adx: 18, volatilityScore: 12, atr: 0.5 },
  { index: 5, direction: -1, mtfDirections: [1, 1, -1], adx: 30, volatilityScore: 6, atr: 2 },
  { index: 200, direction: 1, mtfDirections: [1, 1, 1], adx: 30, volatilityScore: 6, atr: 2 },
].map((input) => ({
  ...input,
  expected: buildPyrusSignalsDirectionalFeatures({
    chartBars: bars,
    index: input.index,
    direction: input.direction,
    mtfDirections: input.mtfDirections,
    adx: input.adx,
    volatilityScore: input.volatilityScore,
    atr: input.atr,
  }),
}));

const outPath = join(dirname(fileURLToPath(import.meta.url)), "directional-features-parity.json");
writeFileSync(outPath, `${JSON.stringify({ bars, cases }, null, 2)}\n`);
console.log(`wrote ${outPath} (${bars.length} bars, ${cases.length} cases)`);

// ---------------------------------------------------------------------------
// signal-matrix-pipeline-parity.json — full-pipeline golden fixture.
//
// Each case carries the complete settings object + bar series and the outputs
// of the authoritative JS evaluator, reduced to the shape run_signal_matrix
// serves: the last emitted signal (or null), its filterState, and the
// indicator-snapshot mtf/trend directions. The "h1-data-starved-htf-required"
// case pins the H1 regression: a required daily HTF gate whose WMA basis is
// never computable must resolve to direction 0 (neutral) and suppress the
// signal — a bullish default on the Python side emits a signal JS suppresses.
// ---------------------------------------------------------------------------

// Resolve from the TypeScript source of truth so the fixture cannot silently
// bless a hand-copied default that diverges from production.
const fullSettings = (
  overrides: Partial<PyrusSignalsSignalSettings> = {},
): PyrusSignalsSignalSettings => resolvePyrusSignalsSignalSettings(overrides);

// Port of tests/test_signal_matrix_directional_features.py
// _forming_bar_breakout_series: a mild downtrend with one clear swing high at
// i=40, then a decisive breakout on the final bar -> one bullish CHoCH on the
// live edge. 120 five-minute bars span ~10h, so 1h/4h/D aggregations can never
// satisfy basisLength=80 — the exact data-starved-HTF shape behind H1.
const breakoutBars: PyrusSignalsBar[] = [];
for (let i = 0; i < 120; i += 1) {
  const base = i === 40 ? 112.0 : 100.0 - i * 0.15;
  breakoutBars.push({
    time: 1_700_000_000 + i * 300,
    o: base,
    h: base + 0.5,
    l: base - 0.5,
    c: base,
    v: 1000,
  });
}
breakoutBars[119] = {
  time: 1_700_000_000 + 119 * 300,
  o: 90.0,
  h: 130.0,
  l: 89.0,
  c: 129.0,
  v: 1000,
};

// Seeded random walk (fresh LCG stream) long enough that short mtf timeframes
// with a small basisLength resolve to computable +/-1 directions.
let pipelineSeed = 987654321;
const nextPipelineRandom = (): number => {
  pipelineSeed = (pipelineSeed * 48271) % 2147483647;
  return pipelineSeed / 2147483647;
};
const randomWalkBars: PyrusSignalsBar[] = [];
let walkClose = 100;
for (let i = 0; i < 240; i += 1) {
  const open = walkClose;
  walkClose = walkClose + (nextPipelineRandom() - 0.5) * 2;
  const high = Math.max(open, walkClose) + nextPipelineRandom() * 1.5;
  const low = Math.min(open, walkClose) - nextPipelineRandom() * 1.5;
  const volume = 500 + Math.floor(nextPipelineRandom() * 2000);
  randomWalkBars.push({ time: 1_700_000_000 + i * 300, o: open, h: high, l: low, c: walkClose, v: volume });
}

const pipelineCaseInputs: Array<{
  name: string;
  symbol: string;
  timeframe: string;
  bars: PyrusSignalsBar[];
  lastBarClosed: boolean;
  settings: PyrusSignalsSignalSettings;
}> = [
  {
    // Filters are enabled but every optional gate is disabled, so this proves
    // the enabled pipeline can emit while still pinning data-starved MTFs.
    name: "breakout-filters-enabled",
    symbol: "PARITY1",
    timeframe: "5m",
    bars: breakoutBars,
    lastBarClosed: true,
    settings: fullSettings({ signalFiltersEnabled: true }),
  },
  {
    // The same live-edge breakout without a provider closure proof must remain
    // provisional under the production waitForBarClose default.
    name: "breakout-forming-bar-waits-for-close",
    symbol: "PARITY4",
    timeframe: "5m",
    bars: breakoutBars,
    lastBarClosed: false,
    settings: fullSettings(),
  },
  {
    // THE H1 case: required daily HTF whose basis is never computable. JS
    // resolves direction 0 -> mtfPass[2] false -> signal suppressed (null).
    name: "h1-data-starved-htf-required",
    symbol: "PARITY2",
    timeframe: "5m",
    bars: breakoutBars,
    lastBarClosed: true,
    settings: fullSettings({ signalFiltersEnabled: true, requireMtf3: true }),
  },
  {
    // Computable-HTF control: small basis + short mtf timeframes resolve to
    // +/-1 in both runtimes (guards aggregation + trend direction, not just
    // the H1 zero).
    name: "computable-htf-parity",
    symbol: "PARITY3",
    timeframe: "5m",
    bars: randomWalkBars,
    lastBarClosed: true,
    settings: fullSettings({
      signalFiltersEnabled: true,
      basisLength: 10,
      requireMtf1: true,
      requireMtf2: true,
      requireMtf3: true,
      mtf1: "5m",
      mtf2: "15m",
      mtf3: "30m",
    }),
  },
];

const normalizedDirection = (value: number): 1 | -1 | null =>
  value === 1 ? 1 : value === -1 ? -1 : null;

const finiteRounded = (value: number, digits = 1): number | null => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const resolveTrendAgeBars = (
  directions: number[],
  currentDirection: 1 | -1 | null,
): number | null => {
  if (!directions.length || currentDirection == null) return null;
  const lastIndex = directions.length - 1;
  let flipIndex = 0;
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const direction = normalizedDirection(directions[index]);
    if (direction != null && direction !== currentDirection) {
      flipIndex = index + 1;
      break;
    }
  }
  return Math.max(0, lastIndex - flipIndex);
};

const pipelineCases = pipelineCaseInputs.map((caseInput) => {
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: caseInput.bars,
    settings: caseInput.settings,
    includeProvisionalSignals: !caseInput.settings.waitForBarClose,
    lastBarClosed: caseInput.lastBarClosed,
  });
  const lastSignal = evaluation.signalEvents.at(-1) ?? null;

  const lastIndex = caseInput.bars.length - 1;
  const lastRegime = evaluation.regimeDirection[lastIndex];
  const lastTrend = evaluation.trendDirection[lastIndex];
  const currentDirection =
    lastRegime === 1 || lastRegime === -1
      ? lastRegime
      : lastTrend === 1 || lastTrend === -1
        ? lastTrend
        : null;
  const trendAgeBars = resolveTrendAgeBars(
    evaluation.regimeDirection,
    currentDirection,
  );
  const adx = finiteRounded(evaluation.adx[lastIndex]);
  const volatilityScore = finiteRounded(
    evaluation.volatilityScore[lastIndex],
    0,
  );
  const snapshotMtf = (
    [
      [caseInput.settings.mtf1, caseInput.settings.requireMtf1],
      [caseInput.settings.mtf2, caseInput.settings.requireMtf2],
      [caseInput.settings.mtf3, caseInput.settings.requireMtf3],
    ] as Array<[PyrusSignalsTimeframeOption, boolean]>
  ).map(([timeframe, required]) => {
    const direction = resolvePyrusSignalsTrendDirection(
      aggregatePyrusSignalsBarsForTimeframe(caseInput.bars, timeframe),
      caseInput.settings.basisLength,
    );
    return {
      timeframe,
      direction,
      required,
      pass: !required || (currentDirection != null && direction === currentDirection),
    };
  });

  return {
    name: caseInput.name,
    symbol: caseInput.symbol,
    timeframe: caseInput.timeframe,
    lastBarClosed: caseInput.lastBarClosed,
    settings: caseInput.settings,
    bars: caseInput.bars,
    expected: {
      status: "ok",
      signal: lastSignal,
      snapshot: {
        trendDirection: currentDirection,
        trendAgeBars,
        trendAgeBucket:
          trendAgeBars == null
            ? null
            : trendAgeBars > 50
              ? "old"
              : trendAgeBars > 20
                ? "mature"
                : "new",
        adx,
        strength: adx == null ? null : adx >= 25 ? "strong" : "weak",
        volatilityScore,
        mtf: snapshotMtf,
        filterState: lastSignal?.filterState ?? null,
      },
    },
  };
});

const pipelineOutPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "signal-matrix-pipeline-parity.json",
);
writeFileSync(pipelineOutPath, `${JSON.stringify({ cases: pipelineCases }, null, 2)}\n`);
for (const pipelineCase of pipelineCases) {
  console.log(
    `pipeline case ${pipelineCase.name}: signal=${
      pipelineCase.expected.signal
        ? `${pipelineCase.expected.signal.eventType}@${pipelineCase.expected.signal.barIndex}`
        : "null"
    } mtf=[${pipelineCase.expected.snapshot.mtf.map((entry) => entry.direction).join(", ")}]`,
  );
}
console.log(`wrote ${pipelineOutPath} (${pipelineCases.length} cases)`);
