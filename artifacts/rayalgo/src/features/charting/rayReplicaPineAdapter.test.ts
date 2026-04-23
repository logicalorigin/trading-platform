import assert from "node:assert/strict";
import test from "node:test";
import {
  createRayReplicaPineRuntimeAdapter,
  RAY_REPLICA_PINE_SCRIPT_KEY,
} from "./rayReplicaPineAdapter";
import type { ChartBar, StudySpec } from "./types";

const SCRIPT_RECORD = {
  scriptKey: RAY_REPLICA_PINE_SCRIPT_KEY,
} as any;

const TEST_SETTINGS = {
  timeHorizon: 3,
  bosConfirmation: "close",
  basisLength: 5,
  atrLength: 2,
  atrSmoothing: 2,
  volatilityMultiplier: 1,
  wireSpread: 0.5,
  shadowLength: 5,
  shadowStdDev: 2,
  adxLength: 2,
  showWires: true,
  showShadow: false,
  showKeyLevels: false,
  showStructure: false,
  showOrderBlocks: false,
  showSupportResistance: false,
  showTpSl: false,
  showDashboard: false,
  showRegimeWindows: false,
  colorCandles: false,
  waitForBarClose: true,
};

const baseTime = Date.UTC(2026, 0, 2, 14, 30) / 1000;

const toChartBar = (
  index: number,
  close: number,
  overrides: Partial<Pick<ChartBar, "o" | "h" | "l" | "c" | "v">> = {},
  timeOffsetSeconds = index * 60,
): ChartBar => {
  const open = overrides.o ?? close;
  const high = overrides.h ?? Math.max(open, close) + 1;
  const low = overrides.l ?? Math.min(open, close) - 1;
  const time = baseTime + timeOffsetSeconds;
  const ts = new Date(time * 1000).toISOString();

  return {
    time,
    ts,
    date: ts.slice(0, 10),
    o: open,
    h: high,
    l: low,
    c: overrides.c ?? close,
    v: overrides.v ?? 10_000 + index,
  };
};

const buildFlipBars = (): ChartBar[] => [
  toChartBar(0, 100, { h: 101, l: 99 }),
  toChartBar(1, 101, { h: 102, l: 100 }),
  toChartBar(2, 102, { h: 103, l: 101 }),
  toChartBar(3, 103, { h: 104, l: 102 }),
  toChartBar(4, 104, { h: 105, l: 103 }),
  toChartBar(5, 105, { h: 106, l: 104 }),
  toChartBar(6, 108, { h: 110, l: 107 }),
  toChartBar(7, 106, { h: 107, l: 105 }),
  toChartBar(8, 105, { h: 106, l: 104 }),
  toChartBar(9, 104, { h: 105, l: 103 }),
  toChartBar(10, 112, { h: 113, l: 111 }),
  toChartBar(11, 108, { h: 109, l: 107 }),
  toChartBar(12, 100, { h: 101, l: 99 }),
  toChartBar(13, 92, { h: 93, l: 90 }),
  toChartBar(14, 98, { h: 99, l: 96 }),
  toChartBar(15, 101, { h: 102, l: 99 }),
  toChartBar(16, 100, { h: 101, l: 98 }),
  toChartBar(17, 88, { h: 89, l: 87 }),
  toChartBar(18, 86, { h: 87, l: 85 }),
  toChartBar(19, 85, { h: 86, l: 84 }),
];

const buildGapBars = (): ChartBar[] => {
  const bars = buildFlipBars();
  return bars.map((bar, index) =>
    index >= 12
      ? {
          ...bar,
          time: bar.time + 600,
          ts: new Date((bar.time + 600) * 1000).toISOString(),
        }
      : bar,
  );
};

const buildShortWarmupBars = (): ChartBar[] => [
  toChartBar(0, 50),
  toChartBar(1, 50.25),
  toChartBar(2, 50.5),
  toChartBar(3, 50.75),
];

const computeRayReplica = (chartBars: ChartBar[]) =>
  createRayReplicaPineRuntimeAdapter(SCRIPT_RECORD).compute({
    chartBars,
    rawBars: [],
    timeframe: "1m",
    selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
    settings: TEST_SETTINGS,
  });

const findStudy = (studySpecs: StudySpec[] | undefined, suffix: string) => {
  const study = studySpecs?.find((spec) => spec.key.endsWith(suffix));
  assert.ok(study, `Expected study with suffix ${suffix}`);
  return study;
};

const finiteIndexes = (study: StudySpec): number[] =>
  study.data.reduce<number[]>((indexes, point, index) => {
    if (Number.isFinite(point.value)) {
      indexes.push(index);
    }
    return indexes;
  }, []);

test("RayReplica wire studies preserve whitespace points for inactive bars", () => {
  const bars = buildFlipBars();
  const output = computeRayReplica(bars);
  const bullWire = findStudy(output.studySpecs, "-bull-wire-1");

  assert.equal(bullWire.data.length, bars.length);
  assert.equal(bullWire.data[0].time, bars[0].time);
  assert.equal(bullWire.data[0].value, undefined);
  assert.ok(finiteIndexes(bullWire).length > 0);
});

test("RayReplica cuts previous-side wires at a bearish regime flip", () => {
  const output = computeRayReplica(buildFlipBars());
  const bullMain = findStudy(output.studySpecs, "-bull-main");
  const bullWire = findStudy(output.studySpecs, "-bull-wire-1");
  const bearMain = findStudy(output.studySpecs, "-bear-main");
  const bearWire = findStudy(output.studySpecs, "-bear-wire-1");
  const bearStartIndex = finiteIndexes(bearMain)[0];

  assert.equal(bearStartIndex, 17);
  assert.ok(Number.isFinite(bullMain.data[16].value));
  assert.ok(Number.isFinite(bullWire.data[16].value));
  assert.equal(bullMain.data[17].value, undefined);
  assert.equal(bullWire.data[17].value, undefined);
  assert.ok(Number.isFinite(bearMain.data[17].value));
  assert.ok(Number.isFinite(bearWire.data[17].value));
});

test("RayReplica emits a hard whitespace boundary across bar-time gaps", () => {
  const output = computeRayReplica(buildGapBars());
  const wireStudies =
    output.studySpecs?.filter(
      (spec) =>
        spec.key.endsWith("-bull-main") ||
        spec.key.endsWith("-bear-main") ||
        spec.key.includes("-bull-wire-") ||
        spec.key.includes("-bear-wire-"),
    ) ?? [];

  assert.ok(wireStudies.length > 0);
  wireStudies.forEach((study) => {
    assert.equal(study.data[12].value, undefined, study.key);
  });
});

test("RayReplica adapter reuse does not leak wire values between series", () => {
  const adapter = createRayReplicaPineRuntimeAdapter(SCRIPT_RECORD);
  adapter.compute({
    chartBars: buildFlipBars(),
    rawBars: [],
    timeframe: "1m",
    selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
    settings: TEST_SETTINGS,
  });
  const output = adapter.compute({
    chartBars: buildShortWarmupBars(),
    rawBars: [],
    timeframe: "1m",
    selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
    settings: TEST_SETTINGS,
  });
  const wireStudies =
    output.studySpecs?.filter(
      (spec) =>
        spec.key.endsWith("-bull-main") ||
        spec.key.endsWith("-bear-main") ||
        spec.key.includes("-bull-wire-") ||
        spec.key.includes("-bear-wire-"),
    ) ?? [];

  assert.ok(wireStudies.length > 0);
  wireStudies.forEach((study) => {
    assert.equal(study.data.length, buildShortWarmupBars().length);
    assert.deepEqual(finiteIndexes(study), [], study.key);
  });
});
