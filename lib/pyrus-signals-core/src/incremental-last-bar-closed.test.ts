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
  stableSerialize,
} from "./__fixtures__/parity-fixtures";

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

const buildBreakoutWithFollowingBar = (): PyrusSignalsBar[] => {
  const bars: PyrusSignalsBar[] = [];
  const breakoutIndex = 119;
  for (let index = 0; index <= breakoutIndex; index += 1) {
    let base = 100 - index * 0.15;
    if (index === 40) {
      base = 112;
    }
    bars.push(mkBar(index, base, base + 0.5, base - 0.5, base));
  }
  bars[breakoutIndex] = mkBar(breakoutIndex, 90, 130, 89, 129);
  bars.push(mkBar(breakoutIndex + 1, 129, 130, 128, 129));
  return bars;
};

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

const assertAppendParityForOptions = (
  series: PyrusSignalsBar[],
  settings: PyrusSignalsSignalSettings,
  options: IncrementalPyrusSignalsEvaluationOptions,
): void => {
  const evaluator = createIncrementalPyrusSignalsEvaluator(settings, options);
  for (let index = 0; index < series.length; index += 1) {
    const incremental = evaluator.append(series[index]);
    const prefix = series.slice(0, index + 1);
    const fresh = evaluateFresh(prefix, settings, options);
    assertStableEvaluationEqual(
      incremental,
      fresh,
      `append parity diverged at k=${prefix.length} options=${JSON.stringify(
        options,
      )}`,
    );
  }
};

test("incremental evaluator mirrors public defaults for provisional signals", () => {
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: true });
  const series = buildBreakoutWithFollowingBar();
  const evaluator = createIncrementalPyrusSignalsEvaluator(settings);

  for (let index = 0; index < series.length; index += 1) {
    const incremental = evaluator.append(series[index]);
    const fresh = evaluatePyrusSignalsSignals({
      chartBars: series.slice(0, index + 1),
      settings,
    });
    assert.equal(stableSerialize(incremental), stableSerialize(fresh));
  }
});

test("incremental evaluator matches lastBarClosed false and true parity", () => {
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: true });
  const series = buildBreakoutWithFollowingBar();
  const openTailOptions = {
    includeProvisionalSignals: !settings.waitForBarClose,
    lastBarClosed: false,
  } satisfies IncrementalPyrusSignalsEvaluationOptions;
  const closedTailOptions = {
    includeProvisionalSignals: !settings.waitForBarClose,
    lastBarClosed: true,
  } satisfies IncrementalPyrusSignalsEvaluationOptions;

  assertAppendParityForOptions(series, settings, openTailOptions);
  assertAppendParityForOptions(series, settings, closedTailOptions);

  const breakoutIndex = 119;
  const openAtBreakout = evaluateFresh(
    series.slice(0, breakoutIndex + 1),
    settings,
    openTailOptions,
  );
  assert.equal(
    openAtBreakout.signalEvents.some(
      (signal) => signal.barIndex === breakoutIndex,
    ),
    false,
  );

  const openAfterNextBar = evaluateFresh(
    series.slice(0, breakoutIndex + 2),
    settings,
    openTailOptions,
  );
  assert.ok(
    openAfterNextBar.signalEvents.some(
      (signal) => signal.barIndex === breakoutIndex && signal.actionable,
    ),
  );
});

test("incremental evaluator matches mixed production lastBarClosed identities", () => {
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: true });
  const series = buildBreakoutWithFollowingBar();
  const openTailOptions = {
    includeProvisionalSignals: !settings.waitForBarClose,
    lastBarClosed: false,
  } satisfies IncrementalPyrusSignalsEvaluationOptions;
  const closedTailOptions = {
    includeProvisionalSignals: !settings.waitForBarClose,
    lastBarClosed: true,
  } satisfies IncrementalPyrusSignalsEvaluationOptions;
  const openEvaluator = createIncrementalPyrusSignalsEvaluator(
    settings,
    openTailOptions,
  );
  const closedEvaluator = createIncrementalPyrusSignalsEvaluator(
    settings,
    closedTailOptions,
  );

  for (let index = 0; index < series.length; index += 1) {
    const openResult = openEvaluator.append(series[index]);
    const closedResult = closedEvaluator.append(series[index]);
    const lastBarClosed = index % 3 === 2;
    const options = lastBarClosed ? closedTailOptions : openTailOptions;
    const incremental = lastBarClosed ? closedResult : openResult;
    const fresh = evaluateFresh(series.slice(0, index + 1), settings, options);
    assertStableEvaluationEqual(
      incremental,
      fresh,
      `mixed append parity diverged at k=${index + 1} lastBarClosed=${
        lastBarClosed ? "true" : "false"
      }`,
    );
  }
});
