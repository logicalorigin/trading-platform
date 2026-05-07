import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRayReplicaSignals,
  resolveRayReplicaSignalSettings,
} from "@workspace/rayreplica-core";
import { buildChartParityModel, getChartParityScenario } from "./chartFixtures";
import { defaultIndicatorRegistry } from "./indicators";
import {
  createRayReplicaPineRuntimeAdapter,
  DEFAULT_RAY_REPLICA_SETTINGS,
  resolveRayReplicaRuntimeSettings,
  RAY_REPLICA_PINE_SCRIPT_KEY,
} from "./rayReplicaPineAdapter";
import type { ChartBar, IndicatorEvent, StudySpec } from "./types";

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

test("RayReplica preserves the legacy bottom-left dashboard default", () => {
  assert.equal(DEFAULT_RAY_REPLICA_SETTINGS.dashboardPosition, "bottom-left");
  assert.equal(DEFAULT_RAY_REPLICA_SETTINGS.signalOffsetAtr, 3.0);
});

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

const AAPL_APRIL_23_FIVE_MINUTE_BARS = [
  [1776864600, 267.82, 268.15, 267.03, 267.32],
  [1776864900, 267.35, 267.85, 266.87, 267.84],
  [1776865200, 267.825, 268.6, 267.6, 268.24],
  [1776865500, 268.3, 269.12, 268.2901, 268.545],
  [1776865800, 268.51, 268.97, 268.345, 268.56],
  [1776866100, 268.56, 268.82, 268.17, 268.5],
  [1776866400, 268.44, 269.1, 268.43, 269.085],
  [1776866700, 269.085, 269.79, 268.9101, 269.68],
  [1776867000, 269.675, 270.78, 269.675, 270.665],
  [1776867300, 270.6601, 271.5, 270.34, 271.36],
  [1776867600, 271.35, 271.78, 271.19, 271.58],
  [1776867900, 271.58, 271.94, 271.3299, 271.94],
  [1776868200, 271.94, 272.56, 271.8501, 272.35],
  [1776868500, 272.31, 272.38, 271.82, 271.85],
  [1776868800, 271.85, 272.09, 271.595, 271.6298],
  [1776869100, 271.615, 271.8494, 270.98, 271.01],
  [1776869400, 271.01, 271.67, 271, 271.67],
  [1776869700, 271.64, 271.79, 271.06, 271.28],
  [1776870000, 271.27, 271.79, 271.21, 271.66],
  [1776870300, 271.65, 271.92, 271.4348, 271.7001],
  [1776870600, 271.73, 272.25, 271.73, 272.21],
  [1776870900, 272.23, 272.3192, 271.9, 272.205],
  [1776871200, 272.21, 272.35, 272.1, 272.2],
  [1776871500, 272.2, 272.765, 272.19, 272.4001],
  [1776871800, 272.4, 272.92, 272.26, 272.69],
  [1776872100, 272.73, 272.85, 272.47, 272.48],
  [1776872400, 272.49, 273.2509, 272.48, 272.84],
  [1776872700, 272.85, 272.99, 272.68, 272.85],
  [1776873000, 272.87, 273.1, 272.77, 273.0382],
  [1776873300, 273.03, 273.15, 272.88, 273.01],
  [1776873600, 273.02, 273.19, 272.81, 273.06],
  [1776873900, 273.06, 273.505, 273.06, 273.29],
  [1776874200, 273.2798, 273.34, 272.89, 273.2],
  [1776874500, 273.22, 273.38, 272.8132, 272.8132],
  [1776874800, 272.86, 272.99, 272.74, 272.74],
  [1776875100, 272.74, 272.895, 272.55, 272.69],
  [1776875400, 272.7, 272.91, 272.62, 272.895],
  [1776875700, 272.92, 272.93, 272.4, 272.745],
  [1776876000, 272.78, 272.8, 272.49, 272.765],
  [1776876300, 272.75, 272.7799, 272.46, 272.76],
  [1776876600, 272.74, 272.7899, 272.36, 272.51],
  [1776876900, 272.54, 272.62, 272.43, 272.495],
  [1776877200, 272.48, 272.75, 272.4701, 272.56],
  [1776877500, 272.55, 273.26, 272.48, 273.25],
  [1776877800, 273.23, 273.42, 272.99, 273.18],
  [1776878100, 273.18, 273.3805, 272.5, 272.9201],
  [1776878400, 272.92, 273.35, 272.91, 273.23],
  [1776878700, 273.22, 273.3, 273.08, 273.23],
  [1776879000, 273.24, 273.5299, 273.19, 273.44],
  [1776879300, 273.44, 273.65, 273.38, 273.575],
  [1776879600, 273.575, 273.63, 273.4601, 273.58],
  [1776879900, 273.585, 273.7172, 273.525, 273.605],
  [1776880200, 273.59, 273.61, 273.1717, 273.44],
  [1776880500, 273.43, 273.62, 273.415, 273.47],
  [1776880800, 273.47, 273.74, 273.42, 273.45],
  [1776881100, 273.4602, 273.54, 273.31, 273.355],
  [1776881400, 273.355, 273.46, 273.24, 273.26],
  [1776881700, 273.26, 273.26, 272.9701, 273.04],
  [1776882000, 273.04, 273.13, 272.765, 272.79],
  [1776882300, 272.795, 272.8394, 272.62, 272.685],
  [1776882600, 272.71, 272.78, 272.56, 272.58],
  [1776882900, 272.585, 272.775, 272.53, 272.62],
  [1776883200, 272.615, 272.621, 272.28, 272.42],
  [1776883500, 272.43, 272.52, 272.3602, 272.43],
  [1776883800, 272.42, 272.44, 272.2801, 272.315],
  [1776884100, 272.3, 272.46, 272.1005, 272.42],
  [1776884400, 272.43, 272.6551, 272.26, 272.615],
  [1776884700, 272.63, 272.665, 272.27, 272.47],
  [1776885000, 272.475, 272.5, 272.27, 272.35],
  [1776885300, 272.345, 272.5, 272.27, 272.48],
  [1776885600, 272.48, 272.75, 272.385, 272.75],
  [1776885900, 272.75, 272.82, 272.64, 272.71],
  [1776886200, 272.73, 272.91, 272.57, 272.89],
  [1776886500, 272.89, 273, 272.785, 272.86],
  [1776886800, 272.89, 273, 272.8, 272.85],
  [1776931200, 271.88, 272.73, 271.2283, 272.16],
  [1776931500, 272.01, 272.1, 272, 272.07],
  [1776931800, 272.31, 272.34, 272.31, 272.34],
  [1776932100, 272.315, 272.4, 272.315, 272.4],
  [1776932700, 272.5, 272.5, 272.5, 272.5],
  [1776933000, 272.23, 272.31, 272.23, 272.31],
  [1776933300, 272.21, 272.21, 272.21, 272.21],
  [1776933600, 272.29, 272.44, 272.2166, 272.23],
  [1776933900, 272.25, 272.29, 272.25, 272.29],
  [1776934200, 272.2, 272.27, 272.2, 272.27],
  [1776934800, 272.26, 272.3, 272.2, 272.23],
  [1776935100, 272.06, 272.08, 272.06, 272.08],
  [1776935700, 272.19, 272.2, 272.19, 272.19],
  [1776936000, 272.33, 272.35, 272.32, 272.35],
  [1776936300, 272.18, 272.18, 272.18, 272.18],
  [1776936600, 272.24, 272.36, 272.22, 272.22],
  [1776936900, 272.29, 272.29, 272.01, 272.01],
  [1776937500, 272, 272, 271.9, 271.98],
  [1776938100, 272, 272.12, 272, 272.12],
  [1776938400, 272.25, 272.25, 272.25, 272.25],
  [1776938700, 272.21, 272.24, 272.15, 272.15],
  [1776939300, 271.99, 272, 271.9, 272],
  [1776939600, 272, 272, 272, 272],
  [1776939900, 272.12, 272.12, 272.1, 272.1],
  [1776940200, 272.09, 272.6, 272.09, 272.6],
  [1776940500, 272.6, 272.6, 272.43, 272.43],
  [1776940800, 272.45, 272.47, 272.45, 272.47],
  [1776941100, 272.3838, 272.3838, 272.3838, 272.3838],
  [1776941700, 272.74, 272.75, 272.6, 272.75],
  [1776942000, 272.4716, 273, 272.4716, 273],
  [1776942300, 273, 273, 272.75, 272.75],
  [1776942600, 272.874, 272.8849, 272.79, 272.79],
  [1776942900, 272.85, 272.85, 272.8, 272.82],
  [1776943200, 272.91, 272.99, 272.9043, 272.98],
  [1776943500, 272.94, 273, 272.92, 272.92],
  [1776943800, 273, 273.0591, 272.94, 272.96],
  [1776944100, 272.9, 273.03, 272.84, 273],
  [1776944400, 273.11, 273.16, 273.0089, 273.16],
  [1776944700, 273.17, 273.6, 273.17, 273.52],
  [1776945000, 273.57, 273.68, 273.15, 273.68],
  [1776945300, 273.67, 273.95, 273.64, 273.95],
  [1776945600, 273.69, 274, 273.2, 273.81],
  [1776945900, 273.85, 274.4, 273.76, 274.4],
  [1776946200, 274.4, 274.4545, 274.3, 274.3237],
  [1776946500, 274.35, 274.3855, 274.13, 274.3],
  [1776946800, 274.35, 274.35, 274, 274.1699],
  [1776947100, 274.15, 274.2, 274.01, 274.01],
  [1776947400, 274.2, 274.5, 274.16, 274.4],
  [1776947700, 274.4779, 274.5, 274.35, 274.5],
  [1776948000, 274.3581, 274.65, 274.3581, 274.4977],
  [1776948300, 274.5, 274.6, 274.25, 274.48],
  [1776948600, 274.35, 275.02, 274.3, 274.88],
  [1776948900, 274.85, 274.85, 274.55, 274.7],
  [1776949200, 274.8, 274.89, 274.7217, 274.85],
  [1776949500, 274.7851, 275.04, 274.78, 274.9877],
  [1776949800, 275, 275.25, 274.71, 274.74],
  [1776950100, 274.8, 274.9, 274.5096, 274.69],
  [1776950400, 274.71, 274.846, 274.25, 274.2837],
  [1776950700, 274.33, 275.2, 274, 274.9],
  [1776951000, 275.045, 275.68, 274.15, 275.09],
  [1776951300, 275.09, 275.77, 274.38, 274.46],
  [1776951600, 274.4433, 274.62, 273.1355, 273.53],
  [1776951900, 273.5, 274.045, 273.13, 273.57],
  [1776952200, 273.5, 273.83, 273.3, 273.68],
  [1776952500, 273.73, 274.1488, 273.64, 273.71],
  [1776952800, 273.695, 274.2728, 273.43, 273.97],
  [1776953100, 274, 274.6, 273.9, 274.57],
  [1776953400, 274.53, 274.53, 273.86, 273.9],
  [1776953700, 273.88, 274.5385, 273.86, 274.26],
  [1776954000, 274.275, 274.41, 273.91, 274.23],
  [1776954300, 274.21, 274.27, 273.64, 273.94],
  [1776954600, 273.97, 274.21, 273.91, 274.04],
  [1776954900, 274.055, 274.19, 273.64, 273.76],
  [1776955200, 273.7899, 273.7899, 273.338, 273.59],
  [1776955500, 273.63, 274, 273.59, 273.92],
  [1776955800, 273.91, 274.29, 273.88, 274.2],
  [1776956100, 274.175, 274.31, 273.93, 273.93],
  [1776956400, 273.935, 274.13, 273.7, 273.745],
  [1776956700, 273.73, 273.78, 273.42, 273.64],
  [1776957000, 273.63, 273.71, 273.27, 273.37],
  [1776957300, 273.38, 273.62, 273.3101, 273.48],
  [1776957600, 273.46, 273.8, 273.45, 273.69],
  [1776957900, 273.68, 273.84, 273.595, 273.68],
  [1776958200, 273.645, 274.41, 273.6, 274.06],
  [1776958500, 274.07, 274.07, 273.66, 273.81],
  [1776958800, 273.8, 273.8, 273.28, 273.32],
  [1776959100, 273.3, 273.48, 273.0305, 273.43],
  [1776959400, 273.42, 273.57, 273.2103, 273.25],
  [1776959700, 273.2799, 273.57, 273.21, 273.41],
  [1776960000, 273.42, 273.435, 273.08, 273.22],
  [1776960300, 273.21, 273.355, 273.1701, 273.325],
  [1776960600, 273.335, 273.4599, 273.22, 273.355],
  [1776960900, 273.35, 273.6, 273.3201, 273.46],
  [1776961200, 273.47, 273.6, 273.27, 273.49],
  [1776961500, 273.4991, 273.68, 273.49, 273.6],
  [1776961800, 273.6, 273.9927, 273.44, 273.515],
  [1776962100, 273.515, 273.67, 273.34, 273.36],
  [1776962400, 273.35, 273.4, 272.96, 273.06],
  [1776962700, 273.06, 273.23, 273.025, 273.14],
  [1776963000, 273.145, 273.2, 272.99, 273.15],
  [1776963300, 273.145, 273.24, 273, 273],
  [1776963600, 273.02, 273.035, 272.52, 272.67],
  [1776963900, 272.6603, 272.7681, 272.43, 272.51],
] as const;

const buildAaplApril23FiveMinuteBars = (): ChartBar[] =>
  AAPL_APRIL_23_FIVE_MINUTE_BARS.map(
    ([time, open, high, low, close], index) => {
      const ts = new Date(time * 1000).toISOString();
      return {
        time,
        ts,
        date: ts.slice(0, 10),
        o: open,
        h: high,
        l: low,
        c: close,
        v: 100_000 + index,
      };
    },
  );

const buildShortWarmupBars = (): ChartBar[] => [
  toChartBar(0, 50),
  toChartBar(1, 50.25),
  toChartBar(2, 50.5),
  toChartBar(3, 50.75),
];

const computeRayReplica = (
  chartBars: ChartBar[],
  settings: Record<string, unknown> = TEST_SETTINGS,
  timeframe = "1m",
) =>
  createRayReplicaPineRuntimeAdapter(SCRIPT_RECORD).compute({
    chartBars,
    rawBars: [],
    timeframe,
    selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
    settings,
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

type VisualTransition = {
  barIndex: number;
  ts: string;
  from: 1 | -1;
  to: 1 | -1;
};

const signalEventForDirection = (direction: 1 | -1) =>
  direction === 1 ? "buy_signal" : "sell_signal";

const chochEventForDirection = (direction: 1 | -1) =>
  direction === 1 ? "bullish_choch" : "bearish_choch";

const findVisualTransitions = (
  chartBars: ChartBar[],
  studySpecs: StudySpec[] | undefined,
): VisualTransition[] => {
  const bullMain = findStudy(studySpecs, "-bull-main");
  const bearMain = findStudy(studySpecs, "-bear-main");
  const transitions: VisualTransition[] = [];
  let previousDirection: 1 | -1 | null = null;

  chartBars.forEach((bar, index) => {
    const direction = Number.isFinite(bullMain.data[index]?.value)
      ? 1
      : Number.isFinite(bearMain.data[index]?.value)
        ? -1
        : null;

    if (direction == null) {
      return;
    }
    if (previousDirection != null && previousDirection !== direction) {
      transitions.push({
        barIndex: index,
        ts: bar.ts,
        from: previousDirection,
        to: direction,
      });
    }
    previousDirection = direction;
  });

  return transitions;
};

const findUnexpectedUnpairedTransitions = (
  chartBars: ChartBar[],
  studySpecs: StudySpec[] | undefined,
  events: IndicatorEvent[] | undefined,
  label: string,
) => {
  const visibleEvents = events ?? [];
  const firstStructureBar = Math.min(
    ...visibleEvents
      .filter(
        (event) =>
          event.eventType === "buy_signal" ||
          event.eventType === "sell_signal" ||
          event.eventType === "bullish_choch" ||
          event.eventType === "bearish_choch",
      )
      .map((event) => event.barIndex ?? Number.POSITIVE_INFINITY),
  );

  return findVisualTransitions(chartBars, studySpecs).flatMap((transition) => {
    if (transition.barIndex < firstStructureBar) {
      return [];
    }

    const expectedSignal = signalEventForDirection(transition.to);
    const expectedChoch = chochEventForDirection(transition.to);
    const nearbyEvents = visibleEvents.filter(
      (event) =>
        typeof event.barIndex === "number" &&
        Math.abs(event.barIndex - transition.barIndex) <= 2,
    );
    const paired = nearbyEvents.some(
      (event) => event.eventType === expectedSignal,
    );
    const gatedChoch = nearbyEvents.some(
      (event) =>
        event.eventType === expectedChoch &&
        (event.meta?.gated === true || event.label === "CHOCH"),
    );

    return paired || gatedChoch
      ? []
      : [
          {
            label,
            ...transition,
            nearbyEvents: nearbyEvents.map((event) => ({
              barIndex: event.barIndex,
              eventType: event.eventType,
              label: event.label,
            })),
          },
        ];
  });
};

const assertNoUnexpectedUnpairedTransitions = (
  chartBars: ChartBar[],
  studySpecs: StudySpec[] | undefined,
  events: IndicatorEvent[] | undefined,
  label: string,
) => {
  const unexpected = findUnexpectedUnpairedTransitions(
    chartBars,
    studySpecs,
    events,
    label,
  );
  assert.deepEqual(
    unexpected,
    [],
    `Unexpected RayReplica visual trend flips:\n${JSON.stringify(
      unexpected,
      null,
      2,
    )}`,
  );
};

test("RayReplica wire studies preserve whitespace points for inactive bars", () => {
  const bars = buildFlipBars();
  const output = computeRayReplica(bars);
  const bullWire = findStudy(output.studySpecs, "-bull-wire-1");

  assert.equal(bullWire.data.length, bars.length);
  assert.equal(bullWire.data[0].time, bars[0].time);
  assert.equal(bullWire.data[0].value, undefined);
  assert.ok(finiteIndexes(bullWire).length > 0);
});

test("RayReplica runtime settings preserve Pine bounds and empty session defaults", () => {
  const runtime = resolveRayReplicaRuntimeSettings({
    timeHorizon: 2,
    structureLineStyle: "dotted",
    chochAtrBuffer: 0.25,
    chochBodyExpansionAtr: 1.5,
    chochVolumeGate: 1.2,
    basisLength: 1,
    atrLength: 1,
    atrSmoothing: 1,
    wireSpread: 0.01,
    shadowLength: 1,
    shadowStdDev: 0.001,
    adxLength: 1,
    volumeMaLength: 1,
    adxMin: 1,
    signalOffsetAtr: 2.75,
    showBos: false,
    showChoch: true,
    showSwings: false,
    showTrendReversal: false,
    trendReversalLengthBars: 42,
    trendReversalTextColor: "#ffeeaa",
    orderBlockMaxActivePerSide: 9,
    supportResistancePivotStrength: 11,
    supportResistanceMinZoneDistancePercent: 0.08,
    supportResistanceThicknessMultiplier: 0.4,
    supportResistanceMaxZones: 9,
    supportResistanceExtensionBars: 140,
    keyLevelLineStyle: "dotted",
    keyLevelLabelSize: "normal",
    keyLevelLabelOffsetBars: 12,
    showPriorDayHigh: false,
    showPriorDayLow: true,
    showPriorDayClose: false,
    showTodayOpen: true,
    showPriorWeekHigh: false,
    showPriorWeekLow: true,
    shadowColor: "#11223344",
    filteredCandleColor: "#445566",
    tp1Rr: 0.1,
    tp2Rr: 0.2,
    tp3Rr: 0.3,
    sessions: [],
  });
  const core = resolveRayReplicaSignalSettings({
    timeHorizon: 2,
    chochAtrBuffer: 0.25,
    chochBodyExpansionAtr: 1.5,
    chochVolumeGate: 1.2,
    basisLength: 1,
    atrLength: 1,
    atrSmoothing: 1,
    shadowLength: 1,
    shadowStdDev: 0.001,
    adxLength: 1,
    volumeMaLength: 1,
    adxMin: 1,
    signalOffsetAtr: 2.75,
    sessions: [],
  });

  assert.deepEqual(DEFAULT_RAY_REPLICA_SETTINGS.sessions, []);
  assert.equal(runtime.timeHorizon, 2);
  assert.equal(runtime.structureLineStyle, "dotted");
  assert.equal(runtime.chochAtrBuffer, 0.25);
  assert.equal(runtime.chochBodyExpansionAtr, 1.5);
  assert.equal(runtime.chochVolumeGate, 1.2);
  assert.equal(runtime.basisLength, 1);
  assert.equal(runtime.atrLength, 1);
  assert.equal(runtime.atrSmoothing, 1);
  assert.equal(runtime.wireSpread, 0.01);
  assert.equal(runtime.shadowLength, 1);
  assert.equal(runtime.shadowStdDev, 0.001);
  assert.equal(runtime.adxLength, 1);
  assert.equal(runtime.volumeMaLength, 1);
  assert.equal(runtime.adxMin, 1);
  assert.equal(runtime.signalOffsetAtr, 2.75);
  assert.equal(runtime.showBos, false);
  assert.equal(runtime.showChoch, true);
  assert.equal(runtime.showSwings, false);
  assert.equal(runtime.showTrendReversal, false);
  assert.equal(runtime.trendReversalLengthBars, 42);
  assert.equal(runtime.trendReversalTextColor, "#ffeeaa");
  assert.equal(runtime.orderBlockMaxActivePerSide, 9);
  assert.equal(runtime.supportResistancePivotStrength, 11);
  assert.equal(runtime.supportResistanceMinZoneDistancePercent, 0.08);
  assert.equal(runtime.supportResistanceThicknessMultiplier, 0.4);
  assert.equal(runtime.supportResistanceMaxZones, 9);
  assert.equal(runtime.supportResistanceExtensionBars, 140);
  assert.equal(runtime.keyLevelLineStyle, "dotted");
  assert.equal(runtime.keyLevelLabelSize, "normal");
  assert.equal(runtime.keyLevelLabelOffsetBars, 12);
  assert.equal(runtime.showPriorDayHigh, false);
  assert.equal(runtime.showPriorDayLow, true);
  assert.equal(runtime.showPriorDayClose, false);
  assert.equal(runtime.showTodayOpen, true);
  assert.equal(runtime.showPriorWeekHigh, false);
  assert.equal(runtime.showPriorWeekLow, true);
  assert.equal(runtime.shadowColor, "#11223344");
  assert.equal(runtime.filteredCandleColor, "#445566");
  assert.equal(runtime.tp1Rr, 0.1);
  assert.equal(runtime.tp2Rr, 0.2);
  assert.equal(runtime.tp3Rr, 0.3);
  assert.deepEqual(runtime.sessions, []);

  assert.equal(core.timeHorizon, 2);
  assert.equal(core.chochAtrBuffer, 0.25);
  assert.equal(core.chochBodyExpansionAtr, 1.5);
  assert.equal(core.chochVolumeGate, 1.2);
  assert.equal(core.basisLength, 1);
  assert.equal(core.atrLength, 1);
  assert.equal(core.atrSmoothing, 1);
  assert.equal(core.shadowLength, 1);
  assert.equal(core.shadowStdDev, 0.001);
  assert.equal(core.adxLength, 1);
  assert.equal(core.volumeMaLength, 1);
  assert.equal(core.adxMin, 1);
  assert.equal(core.signalOffsetAtr, 2.75);
  assert.deepEqual(core.sessions, []);
});

test("RayReplica display session toggles return background windows", () => {
  const output = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showLondonSession: true,
    showRegimeWindows: false,
  });

  assert.equal(output.windows?.length, 1);
  assert.equal(output.windows?.[0]?.meta?.style, "background");
  assert.equal(output.windows?.[0]?.meta?.label, "london");
});

test("RayReplica CHOCH ATR, body, and volume gates suppress reversals only when enabled", () => {
  const bars = buildFlipBars();
  const baseline = evaluateRayReplicaSignals({
    chartBars: bars,
    settings: resolveRayReplicaSignalSettings({
      ...TEST_SETTINGS,
      chochAtrBuffer: 0,
      chochBodyExpansionAtr: 0,
      chochVolumeGate: 0,
    }),
  });
  const atrBuffered = evaluateRayReplicaSignals({
    chartBars: bars,
    settings: resolveRayReplicaSignalSettings({
      ...TEST_SETTINGS,
      chochAtrBuffer: 5,
      chochBodyExpansionAtr: 0,
      chochVolumeGate: 0,
    }),
  });
  const bodyBuffered = evaluateRayReplicaSignals({
    chartBars: bars,
    settings: resolveRayReplicaSignalSettings({
      ...TEST_SETTINGS,
      chochAtrBuffer: 0,
      chochBodyExpansionAtr: 5,
      chochVolumeGate: 0,
    }),
  });
  const volumeBuffered = evaluateRayReplicaSignals({
    chartBars: bars,
    settings: resolveRayReplicaSignalSettings({
      ...TEST_SETTINGS,
      chochAtrBuffer: 0,
      chochBodyExpansionAtr: 0,
      chochVolumeGate: 5,
    }),
  });

  assert.ok(
    baseline.structureEvents.some(
      (event) =>
        event.eventType === "bullish_choch" ||
        event.eventType === "bearish_choch",
    ),
  );
  assert.ok(baseline.signalEvents.length > 0);
  assert.equal(atrBuffered.signalEvents.length, 0);
  assert.equal(bodyBuffered.signalEvents.length, 0);
  assert.equal(volumeBuffered.signalEvents.length, 0);
});

test("RayReplica filtered candle color applies on CHOCH bars that fail the signal filters", () => {
  const filteredColor = "#334455";
  const output = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showChoch: true,
    colorCandles: true,
    signalFiltersEnabled: true,
    requireAdx: true,
    adxMin: 100,
    filteredCandleColor: filteredColor,
  });
  const filteredChoch = output.events?.find(
    (event) =>
      event.eventType === "bullish_choch" ||
      event.eventType === "bearish_choch",
  );

  if (!filteredChoch) {
    assert.fail("Expected at least one filtered CHOCH event");
  }
  assert.equal(
    output.events?.some(
      (event) =>
        event.eventType === "buy_signal" || event.eventType === "sell_signal",
    ),
    false,
  );
  assert.equal(
    output.barStyleByIndex?.[filteredChoch.barIndex]?.color,
    filteredColor,
  );
});

test("RayReplica swing labels honor the Pine swing toggle independently from structure breaks", () => {
  const withSwings = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: true,
    showChoch: true,
    showSwings: true,
  });
  const withoutSwings = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: true,
    showChoch: true,
    showSwings: false,
  });

  assert.ok(withSwings.events?.some((event) => event.eventType === "swing_label"));
  assert.equal(
    withoutSwings.events?.filter((event) => event.eventType === "swing_label")
      .length,
    0,
  );
  assert.ok(
    withoutSwings.events?.some((event) => event.eventType === "bull_break"),
  );
});

test("RayReplica BOS and CHOCH toggles match Pine gating without hiding break circles or signals", () => {
  const noBos = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: false,
    showChoch: true,
    showSwings: true,
  });
  const noChoch = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: true,
    showChoch: false,
    showSwings: true,
  });

  assert.equal(
    noBos.events?.filter((event) => event.eventType === "bullish_bos" || event.eventType === "bearish_bos").length,
    0,
  );
  assert.ok(noBos.events?.some((event) => event.eventType === "bull_break" || event.eventType === "bear_break"));
  assert.equal(
    noChoch.events?.filter((event) => event.eventType === "bullish_choch" || event.eventType === "bearish_choch").length,
    0,
  );
  assert.ok(noChoch.events?.some((event) => event.eventType === "buy_signal" || event.eventType === "sell_signal"));
});

test("RayReplica trend-reversal toggle suppresses only the reversal line", () => {
  const withReversal = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: true,
    showChoch: true,
    showTrendReversal: true,
  });
  const withoutReversal = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: true,
    showChoch: true,
    showTrendReversal: false,
  });

  assert.ok(withReversal.zones?.some((zone) => zone.zoneType === "trend-reversal"));
  assert.equal(
    withoutReversal.zones?.filter((zone) => zone.zoneType === "trend-reversal")
      .length,
    0,
  );
});

test("RayReplica BOS and CHOCH structure line labels render without pills", () => {
  const output = computeRayReplica(buildFlipBars(), {
    ...TEST_SETTINGS,
    showStructure: true,
    showBos: true,
    showChoch: true,
  });
  const structureZones =
    output.zones?.filter(
      (zone) => zone.zoneType === "bos" || zone.zoneType === "choch",
    ) ?? [];

  assert.ok(structureZones.length > 0);
  structureZones.forEach((zone) => {
    assert.equal(zone.meta?.labelVariant, "plain");
    assert.equal(zone.meta?.labelFillColor, undefined);
  });
});

test("RayReplica key levels honor per-level toggles and carry Pine line metadata", () => {
  const adapter = createRayReplicaPineRuntimeAdapter(SCRIPT_RECORD);
  const chartBars = [
    toChartBar(0, 100, { o: 100, h: 104, l: 99, c: 103 }, 0),
    toChartBar(1, 103, { o: 103, h: 106, l: 101, c: 105 }, 300),
    toChartBar(2, 106, { o: 106, h: 110, l: 105, c: 109 }, 86_400),
    toChartBar(3, 109, { o: 109, h: 111, l: 107, c: 110 }, 86_700),
  ];
  const output = adapter.compute({
    chartBars,
    rawBars: [],
    dailyBars: [
      {
        time: chartBars[0].time,
        open: 100,
        high: 106,
        low: 99,
        close: 105,
      },
      {
        time: chartBars[2].time,
        open: 106,
        high: 111,
        low: 105,
        close: 110,
      },
    ],
    timeframe: "5m",
    selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
    settings: {
      ...DEFAULT_RAY_REPLICA_SETTINGS,
      showPriorDayHigh: true,
      showPriorDayLow: false,
      showPriorDayClose: false,
      showTodayOpen: true,
      showPriorWeekHigh: false,
      showPriorWeekLow: false,
      keyLevelLineStyle: "dotted",
      keyLevelLabelSize: "normal",
      keyLevelLabelOffsetBars: 11,
    },
  });

  const keyLevelIds = output.zones
    ?.filter((zone) => zone.zoneType === "key-level")
    .map((zone) => zone.id) ?? [];
  const todayOpenZone = output.zones?.find((zone) => zone.id.endsWith("-open"));
  const pdhZone = output.zones?.find((zone) => zone.id.endsWith("-pdh"));

  assert.deepEqual(
    keyLevelIds.sort(),
    [
      `${RAY_REPLICA_PINE_SCRIPT_KEY}-open`,
      `${RAY_REPLICA_PINE_SCRIPT_KEY}-pdh`,
    ],
  );
  assert.equal(todayOpenZone?.meta?.lineStyle, "dotted");
  assert.equal(todayOpenZone?.meta?.labelSize, "normal");
  assert.equal(todayOpenZone?.meta?.labelOffsetBars, 11);
  assert.notEqual(todayOpenZone?.meta?.labelVariant, "plain");
  assert.equal(pdhZone?.meta?.lineStyle, "dotted");
});

test("RayReplica signal offset matches the Pine ATR offset setting", () => {
  const scenario = getChartParityScenario("rayreplica");
  const tight = buildChartParityModel(scenario, {
    indicatorSettings: {
      [RAY_REPLICA_PINE_SCRIPT_KEY]: {
        ...DEFAULT_RAY_REPLICA_SETTINGS,
        signalOffsetAtr: 0,
      },
    },
    indicatorRegistry: {
      ...defaultIndicatorRegistry,
      [RAY_REPLICA_PINE_SCRIPT_KEY]: createRayReplicaPineRuntimeAdapter(
        SCRIPT_RECORD,
      ),
    },
  });
  const wide = buildChartParityModel(scenario, {
    indicatorSettings: {
      [RAY_REPLICA_PINE_SCRIPT_KEY]: {
        ...DEFAULT_RAY_REPLICA_SETTINGS,
        signalOffsetAtr: 3,
      },
    },
    indicatorRegistry: {
      ...defaultIndicatorRegistry,
      [RAY_REPLICA_PINE_SCRIPT_KEY]: createRayReplicaPineRuntimeAdapter(
        SCRIPT_RECORD,
      ),
    },
  });
  const tightBuy = tight.indicatorEvents.find((event) => event.eventType === "buy_signal");
  const wideBuy = wide.indicatorEvents.find((event) => event.eventType === "buy_signal");

  assert.equal(tightBuy?.barIndex, wideBuy?.barIndex);
  assert.equal(tightBuy?.direction, "long");
  assert.equal(wideBuy?.direction, "long");
  assert.ok(typeof tightBuy?.meta?.price === "number");
  assert.ok(typeof wideBuy?.meta?.price === "number");
  assert.ok((wideBuy?.meta?.price as number) < (tightBuy?.meta?.price as number));
});

test("RayReplica blanks both sides on a bearish regime flip and starts the new side on the next bar", () => {
  const output = computeRayReplica(buildFlipBars());
  const bullMain = findStudy(output.studySpecs, "-bull-main");
  const bullWire = findStudy(output.studySpecs, "-bull-wire-1");
  const bearMain = findStudy(output.studySpecs, "-bear-main");
  const bearWire = findStudy(output.studySpecs, "-bear-wire-1");
  const bearStartIndex = finiteIndexes(bearMain)[0];

  assert.equal(bearStartIndex, 18);
  assert.ok(Number.isFinite(bullMain.data[16].value));
  assert.ok(Number.isFinite(bullWire.data[16].value));
  assert.equal(bullMain.data[17].value, undefined);
  assert.equal(bullWire.data[17].value, undefined);
  assert.equal(bearMain.data[17].value, undefined);
  assert.equal(bearWire.data[17].value, undefined);
  assert.ok(Number.isFinite(bearMain.data[18].value));
  assert.ok(Number.isFinite(bearWire.data[18].value));
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

test("RayReplica hard gaps preserve structure state so visual flips stay signal-paired", () => {
  const bars = buildGapBars();
  const output = computeRayReplica(bars);
  const sellSignalBar = output.events?.find(
    (event) => event.eventType === "sell_signal",
  )?.barIndex;
  const bearMain = findStudy(output.studySpecs, "-bear-main");

  assert.equal(sellSignalBar, 17);
  const resolvedSellSignalBar = sellSignalBar ?? -1;
  assert.equal(bearMain.data[resolvedSellSignalBar].value, undefined);
  assert.ok(Number.isFinite(bearMain.data[resolvedSellSignalBar + 1]?.value));
  assertNoUnexpectedUnpairedTransitions(
    bars,
    output.studySpecs,
    output.events,
    "synthetic-hard-gap",
  );
});

test("RayReplica AAPL 5m Apr 23 fixture has no unpaired post-gap visual trend flips", () => {
  const bars = buildAaplApril23FiveMinuteBars();
  const output = computeRayReplica(
    bars,
    {
      ...DEFAULT_RAY_REPLICA_SETTINGS,
      showKeyLevels: false,
      showOrderBlocks: false,
      showSupportResistance: false,
      showTpSl: false,
      showDashboard: false,
      showShadow: false,
      showRegimeWindows: false,
    },
    "5m",
  );

  assert.ok(
    bars.some((bar) => bar.ts === "2026-04-23T14:45:00.000Z"),
    "fixture should include AAPL 10:45am ET on 2026-04-23",
  );
  assertNoUnexpectedUnpairedTransitions(
    bars,
    output.studySpecs,
    output.events,
    "AAPL-5m-2026-04-23",
  );
});

test("RayReplica built-in parity fixtures have no unexpected unpaired visual trend flips", () => {
  (["core", "panes", "history", "rayreplica"] as const).forEach((id) => {
    const scenario = getChartParityScenario(id);
    const model = buildChartParityModel(scenario, {
      selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
      indicatorSettings: {
        [RAY_REPLICA_PINE_SCRIPT_KEY]: {
          ...DEFAULT_RAY_REPLICA_SETTINGS,
          showKeyLevels: false,
          showOrderBlocks: false,
          showSupportResistance: false,
          showTpSl: false,
          showDashboard: false,
          showShadow: false,
          showRegimeWindows: false,
        },
      },
      indicatorRegistry: {
        ...defaultIndicatorRegistry,
        [RAY_REPLICA_PINE_SCRIPT_KEY]: createRayReplicaPineRuntimeAdapter(
          SCRIPT_RECORD,
        ),
      },
    });

    assertNoUnexpectedUnpairedTransitions(
      model.chartBars,
      model.studySpecs,
      model.indicatorEvents,
      id,
    );
  });
});

test("RayReplica blanks the flip bar around opposite signals in the real parity fixture", () => {
  const scenario = getChartParityScenario("rayreplica");
  const model = buildChartParityModel(scenario, {
    indicatorSettings: {
      [RAY_REPLICA_PINE_SCRIPT_KEY]: {
        ...DEFAULT_RAY_REPLICA_SETTINGS,
        showKeyLevels: false,
        showOrderBlocks: false,
        showSupportResistance: false,
        showTpSl: false,
        showDashboard: false,
        showShadow: false,
        showRegimeWindows: false,
      },
    },
    indicatorRegistry: {
      ...defaultIndicatorRegistry,
      [RAY_REPLICA_PINE_SCRIPT_KEY]: createRayReplicaPineRuntimeAdapter(
        SCRIPT_RECORD,
      ),
    },
  });
  const bullMain = findStudy(model.studySpecs, "-bull-main");
  const bearMain = findStudy(model.studySpecs, "-bear-main");
  const sellSignalBar = model.indicatorEvents.find(
    (event) => event.eventType === "sell_signal",
  )?.barIndex;
  const buySignalBar = model.indicatorEvents
    .filter((event) => event.eventType === "buy_signal")
    .at(-1)?.barIndex;

  assert.equal(sellSignalBar, 187);
  assert.equal(buySignalBar, 210);

  assert.ok(Number.isFinite(bullMain.data[sellSignalBar - 1]?.value));
  assert.equal(bullMain.data[sellSignalBar]?.value, undefined);
  assert.ok(Number.isFinite(bearMain.data[sellSignalBar + 1]?.value));

  assert.ok(Number.isFinite(bearMain.data[buySignalBar - 1]?.value));
  assert.equal(bearMain.data[buySignalBar]?.value, undefined);
  assert.ok(Number.isFinite(bullMain.data[buySignalBar + 1]?.value));
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
