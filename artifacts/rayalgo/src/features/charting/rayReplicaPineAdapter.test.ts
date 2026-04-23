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

const computeRayReplica = (
  chartBars: ChartBar[],
  settings: Record<string, unknown> = TEST_SETTINGS,
) =>
  createRayReplicaPineRuntimeAdapter(SCRIPT_RECORD).compute({
    chartBars,
    rawBars: [],
    timeframe: "1m",
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
