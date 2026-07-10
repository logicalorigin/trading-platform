import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIncrementalPyrusSignalsEvaluator,
  type IncrementalPyrusSignalsEvaluationOptions,
} from "./incremental";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
  type PyrusSignalsEvaluation,
  type PyrusSignalsSignalSettings,
} from "./index";
import {
  assertStableEvaluationEqual,
  PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
  PYRUS_SIGNALS_PARITY_FIXTURES,
  stableSerialize,
} from "./__fixtures__/parity-fixtures";

const evaluateFresh = (
  chartBars: PyrusSignalsBar[],
  settings: PyrusSignalsSignalSettings,
  options: IncrementalPyrusSignalsEvaluationOptions,
): PyrusSignalsEvaluation =>
  evaluatePyrusSignalsSignals({
    chartBars,
    settings,
    includeProvisionalSignals: options.includeProvisionalSignals,
    lastBarClosed: options.lastBarClosed,
  });

const fixtureByName = (name: string) => {
  const fixture = PYRUS_SIGNALS_PARITY_FIXTURES.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(fixture, `missing fixture ${name}`);
  return fixture;
};

const seedEvaluator = (
  bars: PyrusSignalsBar[],
  settings: PyrusSignalsSignalSettings,
  options: IncrementalPyrusSignalsEvaluationOptions,
) => {
  const evaluator = createIncrementalPyrusSignalsEvaluator(settings, options);
  for (const bar of bars) {
    evaluator.append(bar);
  }
  return evaluator;
};

// Deterministic in-place mutation schedule for a forming bar: the timestamp
// and open never change while close/high/low/volume evolve tick by tick, the
// exact live pattern that defeats the append-only extension path.
const formingMutations = (
  base: PyrusSignalsBar,
  count: number,
): PyrusSignalsBar[] => {
  const scale = Math.max(
    Number.isFinite(base.c) ? Math.abs(base.c) : 1,
    0.01,
  );
  const mutations: PyrusSignalsBar[] = [];
  for (let k = 0; k < count; k += 1) {
    const drift =
      Math.sin(k * 1.7 + 0.4) * 0.03 * scale +
      (k % 4 === 3 ? -0.05 * scale : 0.015 * scale);
    const close = Number((base.c + drift).toFixed(6));
    const high = Number(
      Math.max(
        Number.isFinite(base.h) ? base.h : close,
        close + 0.002 * scale,
      ).toFixed(6),
    );
    const low = Number(
      Math.min(
        Number.isFinite(base.l) ? base.l : close,
        close - 0.002 * scale,
      ).toFixed(6),
    );
    mutations.push({
      ...base,
      h: high,
      l: low,
      c: close,
      v: Number((Number.isFinite(base.v) ? base.v + k * 3 : k * 3).toFixed(2)),
    });
  }
  return mutations;
};

const OPEN_TAIL_OPTIONS = {
  includeProvisionalSignals:
    !PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS.waitForBarClose,
  lastBarClosed: false,
} satisfies IncrementalPyrusSignalsEvaluationOptions;

test("forming-bar mutation parity: clone(checkpoint)+append is byte-identical to from-scratch for every mutation", () => {
  const waitForCloseSettings = resolvePyrusSignalsSignalSettings({
    waitForBarClose: true,
  });
  const filteredSettings = resolvePyrusSignalsSignalSettings({
    signalFiltersEnabled: true,
    requireAdx: true,
    adxMin: 15,
  });
  const scenarios: Array<{
    name: string;
    fixture: string;
    settings: PyrusSignalsSignalSettings;
    options: IncrementalPyrusSignalsEvaluationOptions;
    extraMutations?: (base: PyrusSignalsBar) => PyrusSignalsBar[];
  }> = [
    {
      name: "steady-uptrend defaults",
      fixture: "steady-uptrend",
      settings: PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
      options: OPEN_TAIL_OPTIONS,
    },
    {
      name: "choppy defaults",
      fixture: "choppy-mean-reverting",
      settings: PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
      options: OPEN_TAIL_OPTIONS,
    },
    {
      name: "gappy defaults",
      fixture: "gappy",
      settings: PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
      options: OPEN_TAIL_OPTIONS,
    },
    {
      name: "choppy waitForBarClose (open tail, non-provisional)",
      fixture: "choppy-mean-reverting",
      settings: waitForCloseSettings,
      options: {
        includeProvisionalSignals: !waitForCloseSettings.waitForBarClose,
        lastBarClosed: false,
      },
    },
    {
      name: "steady-uptrend filters enabled",
      fixture: "steady-uptrend",
      settings: filteredSettings,
      options: OPEN_TAIL_OPTIONS,
    },
    {
      name: "non-finite defaults (plus NaN-close tick)",
      fixture: "non-finite",
      settings: PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS,
      options: OPEN_TAIL_OPTIONS,
      extraMutations: (base) => [{ ...base, c: Number.NaN }],
    },
  ];

  const seriesLength = 300;
  for (const scenario of scenarios) {
    const fixture = fixtureByName(scenario.fixture);
    const bars = fixture.bars.slice(0, seriesLength);
    const closedPrefix = bars.slice(0, seriesLength - 1);
    const checkpoint = seedEvaluator(
      closedPrefix,
      scenario.settings,
      scenario.options,
    );
    const checkpointBytesBefore = stableSerialize(checkpoint.result());

    const mutations = [
      ...formingMutations(bars[seriesLength - 1], 12),
      ...(scenario.extraMutations?.(bars[seriesLength - 1]) ?? []),
    ];
    for (const [k, formingBar] of mutations.entries()) {
      const replay = checkpoint.clone();
      const incremental = replay.append(formingBar);
      const fresh = evaluateFresh(
        [...closedPrefix, formingBar],
        scenario.settings,
        scenario.options,
      );
      assertStableEvaluationEqual(
        incremental,
        fresh,
        `${scenario.name}: forming mutation ${k} diverged`,
      );
    }
    assert.equal(
      stableSerialize(checkpoint.result()),
      checkpointBytesBefore,
      `${scenario.name}: replays mutated the checkpoint`,
    );
  }
});

// Breakout series copied from the lastBarClosed suite: declining closes with a
// swing high (112) planted at index 40, so a forming bar 119 that crosses 112
// emits a bullish CHoCH — the mutation schedule crosses and un-crosses it.
const mkBar = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
): PyrusSignalsBar => ({
  time: 1_700_000_000 + index * 300,
  o: open,
  h: high,
  l: low,
  c: close,
  v: 1000,
});

const buildBreakoutClosedPrefix = (): PyrusSignalsBar[] => {
  const bars: PyrusSignalsBar[] = [];
  for (let index = 0; index <= 118; index += 1) {
    let base = 100 - index * 0.15;
    if (index === 40) {
      base = 112;
    }
    bars.push(mkBar(index, base, base + 0.5, base - 0.5, base));
  }
  return bars;
};

test("forming-bar mutation parity: signal emission and retraction on the forming bar stay byte-identical", () => {
  const closedPrefix = buildBreakoutClosedPrefix();
  const formingIndex = 119;
  const ticks: Array<{ bar: PyrusSignalsBar; breaks: boolean }> = [
    { bar: mkBar(formingIndex, 90, 90.5, 89.5, 90), breaks: false },
    { bar: mkBar(formingIndex, 90, 130, 89, 129), breaks: true },
    { bar: mkBar(formingIndex, 90, 90.7, 89.2, 90.2), breaks: false },
    { bar: mkBar(formingIndex, 90, 131, 88.5, 130.5), breaks: true },
    { bar: mkBar(formingIndex, 90, 91, 88, 88.5), breaks: false },
  ];

  const variants: Array<{
    name: string;
    settings: PyrusSignalsSignalSettings;
    options: IncrementalPyrusSignalsEvaluationOptions;
    expectSignalWhenBreaking: boolean;
  }> = [
    {
      // Provisional signals allowed: the forming-bar breakout emits an
      // actionable signal event and later mutations retract it.
      name: "provisional",
      settings: resolvePyrusSignalsSignalSettings({}),
      options: { includeProvisionalSignals: true, lastBarClosed: false },
      expectSignalWhenBreaking: true,
    },
    {
      // waitForBarClose with an open tail: the CHoCH structure event appears
      // (actionable=false) but no signal event until the bar closes.
      name: "wait-for-close open tail",
      settings: resolvePyrusSignalsSignalSettings({ waitForBarClose: true }),
      options: { includeProvisionalSignals: false, lastBarClosed: false },
      expectSignalWhenBreaking: false,
    },
  ];

  for (const variant of variants) {
    const checkpoint = seedEvaluator(
      closedPrefix,
      variant.settings,
      variant.options,
    );
    for (const [k, tick] of ticks.entries()) {
      const replay = checkpoint.clone();
      const incremental = replay.append(tick.bar);
      const fresh = evaluateFresh(
        [...closedPrefix, tick.bar],
        variant.settings,
        variant.options,
      );
      assertStableEvaluationEqual(
        incremental,
        fresh,
        `${variant.name}: breakout tick ${k} diverged`,
      );
      // Guard against a vacuous scenario: the breaking ticks must actually
      // produce the forming-bar event the parity claims to cover.
      const freshStructure = fresh.structureEvents.some(
        (event) => event.barIndex === formingIndex,
      );
      const freshSignal = fresh.signalEvents.some(
        (event) => event.barIndex === formingIndex,
      );
      assert.equal(
        freshStructure,
        tick.breaks,
        `${variant.name}: tick ${k} structure emission mismatch`,
      );
      assert.equal(
        freshSignal,
        tick.breaks && variant.expectSignalWhenBreaking,
        `${variant.name}: tick ${k} signal emission mismatch`,
      );
    }
  }
});

test("clone independence: original and clone share no mutable state", () => {
  const fixture = fixtureByName("choppy-mean-reverting");
  const settings = PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS;
  const options = OPEN_TAIL_OPTIONS;

  const original = seedEvaluator(
    fixture.bars.slice(0, 300),
    settings,
    options,
  );
  const clone = original.clone();
  assert.equal(
    stableSerialize(clone.result()),
    stableSerialize(original.result()),
    "clone must start byte-identical to its source",
  );

  // Advance ONLY the clone: the original must not move.
  const originalBytesBefore = stableSerialize(original.result());
  for (const bar of fixture.bars.slice(300, 320)) {
    clone.append(bar);
  }
  assert.equal(
    stableSerialize(original.result()),
    originalBytesBefore,
    "appending to the clone mutated the original",
  );
  assertStableEvaluationEqual(
    clone.result(),
    evaluateFresh(fixture.bars.slice(0, 320), settings, options),
    "advanced clone diverged from from-scratch",
  );

  // Advance the original down a DIFFERENT path: the clone must not move.
  const cloneBytesBefore = stableSerialize(clone.result());
  const divergentBar: PyrusSignalsBar = {
    ...fixture.bars[300],
    h: Number((fixture.bars[300].h + 1.25).toFixed(6)),
    c: Number((fixture.bars[300].c + 1.1).toFixed(6)),
    v: 4_242,
  };
  original.append(divergentBar);
  assert.equal(
    stableSerialize(clone.result()),
    cloneBytesBefore,
    "appending to the original mutated the clone",
  );
  assertStableEvaluationEqual(
    original.result(),
    evaluateFresh(
      [...fixture.bars.slice(0, 300), divergentBar],
      settings,
      options,
    ),
    "diverged original mismatched from-scratch",
  );
});

test("checkpoint walk-forward: replay every tick, advance on close, byte-identical across bar closes", () => {
  const fixture = fixtureByName("steady-uptrend");
  const settings = PYRUS_SIGNALS_DEFAULT_FIXTURE_SETTINGS;
  const options = OPEN_TAIL_OPTIONS;
  const start = 280;
  const steps = 20;

  const checkpoint = seedEvaluator(
    fixture.bars.slice(0, start),
    settings,
    options,
  );
  for (let t = start; t < start + steps; t += 1) {
    const closedPrefix = fixture.bars.slice(0, t);
    const finalBar = fixture.bars[t];
    // Two in-flight ticks, then the final tick equals the bar's closing
    // content — mirroring how the wiring replays until the bar closes.
    const ticks = [...formingMutations(finalBar, 2), finalBar];
    for (const [k, tick] of ticks.entries()) {
      const replay = checkpoint.clone();
      const incremental = replay.append(tick);
      const fresh = evaluateFresh([...closedPrefix, tick], settings, options);
      assertStableEvaluationEqual(
        incremental,
        fresh,
        `walk-forward t=${t} tick=${k} diverged`,
      );
    }
    // The bar closes: the checkpoint itself absorbs the final content.
    checkpoint.append(finalBar);
  }
  assertStableEvaluationEqual(
    checkpoint.result(),
    evaluateFresh(fixture.bars.slice(0, start + steps), settings, options),
    "advanced checkpoint diverged from from-scratch",
  );
});
