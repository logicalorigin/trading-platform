import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  __pyrusSignalsPineAdapterTestInternals,
  createPyrusSignalsPineRuntimeAdapter,
  resolvePyrusSignalsRuntimeSettings,
} from "./pyrusSignalsPineAdapter.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const readRepoFile = (filename) =>
  readFileSync(path.join(repoRoot, filename), "utf8");

const rootPineSource = readRepoFile("pyrus-signals-smc-pro-v3.pine");
const bundledPineSource = readRepoFile(
  "artifacts/api-server/data/pine-seeds/pyrus-signals-smc-pro-v3.pine",
);
const fallbackPineSource = JSON.parse(
  readRepoFile("artifacts/api-server/data/pine-scripts.json"),
).find((script) => script.scriptKey === "pyrus-signals-smc-pro-v3")?.sourceCode;
const adapterSource = readRepoFile(
  "artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts",
);

const createAdapter = () => {
  const scriptKey = "pyrus-signals-smc-pro-v3";
  return createPyrusSignalsPineRuntimeAdapter({
    id: scriptKey,
    scriptKey,
    name: "Pyrus Signals",
    description: null,
    sourceCode: "",
    status: "ready",
    defaultPaneType: "price",
    chartAccessEnabled: true,
    notes: null,
    lastError: null,
    tags: [],
    metadata: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
};

const buildDualWickChartBars = (close, continuation) => {
  const values = [
    [100, 103, 97, 100],
    [100, 104, 96, 100],
    [100, 110, 90, 100],
    [100, 104, 96, 100],
    [100, 103, 97, 100],
    [100, 120, 80, close],
    ...(continuation === "long"
      ? [[100, 115, 95, 105]]
      : continuation === "short"
        ? [[100, 105, 85, 95]]
        : []),
  ];
  return values.map(([o, h, l, c], index) => {
    const time = 1_700_000_000 + index * 300;
    const ts = new Date(time * 1000).toISOString();
    return { time, ts, date: ts.slice(0, 10), o, h, l, c, v: 1000 };
  });
};

const computeDualWick = (close, continuation) =>
  createAdapter().compute({
    chartBars: buildDualWickChartBars(close, continuation),
    chartBarRanges: [],
    rawBars: [],
    dailyBars: [],
    settings: {
      timeHorizon: 2,
      bosConfirmation: "wicks",
      waitForBarClose: false,
    },
    timeframe: "5m",
    selectedIndicators: ["pyrus-signals-smc-pro-v3"],
    sourceSeries: [],
  });

test("Pyrus Signals Pine source copies stay byte-identical", () => {
  assert.equal(bundledPineSource, rootPineSource);
  assert.equal(fallbackPineSource, rootPineSource);
});

test("Pine signal confirmation and display controls stay wired", () => {
  assert.match(
    rootPineSource,
    /signalReady = not i_waitClose or barstate\.isconfirmed/,
  );
  assert.match(
    rootPineSource,
    /bullSignal = bullSignalSetup and signalReady/,
  );
  assert.match(
    rootPineSource,
    /bearSignal = bearSignalSetup and signalReady/,
  );
  assert.match(
    rootPineSource,
    /filtered\s+= i_fEnable and \(\(bullCHOCH and not bullSignalSetup\) or \(bearCHOCH and not bearSignalSetup\)\)/,
  );
  assert.match(rootPineSource, /alertcondition\(bullCHOCH,/);
  assert.match(rootPineSource, /alertcondition\(bearCHOCH,/);
  assert.match(rootPineSource, /alertcondition\(bullSignal,/);
  assert.match(rootPineSource, /alertcondition\(bearSignal,/);

  const offsetSwingPlots = rootPineSource.match(
    /plotshape\(is(?:HH|LH|HL|LL),[^\n]*offset=-th/g,
  );
  assert.equal(offsetSwingPlots?.length, 4);

  assert.equal((rootPineSource.match(/table\.new\(/g) ?? []).length, 1);
  assert.match(
    rootPineSource,
    /var table dash = table\.new\(panelPos, 3, 8,/,
  );
  assert.doesNotMatch(rootPineSource, /dash := table\.new/);
  assert.doesNotMatch(rootPineSource, /table\.clear\(dash/);

  assert.equal(
    (rootPineSource.match(/textcolor=i_revTxtCol/g) ?? []).length,
    2,
  );
  assert.match(
    rootPineSource,
    /mtfTxt\(d\) => d == 1 \? "BULL"\s+: d == -1 \? "BEAR" : "—"/,
  );
});

test("Pine inputs and higher-timeframe levels remain bounded and confirmed", () => {
  assert.match(
    rootPineSource,
    /i_revBars\s+= input\.int\(30,[^\n]*maxval=500/,
  );
  assert.match(
    rootPineSource,
    /i_srExt\s+= input\.int\(100,[^\n]*maxval=500/,
  );
  for (const riskInput of ["i_tp1rr", "i_tp2rr", "i_tp3rr"]) {
    assert.match(
      rootPineSource,
      new RegExp(`${riskInput}\\s+= input\\.float\\([^\\n]*minval=0\\.0[^\\n]*maxval=10`),
    );
  }
  assert.match(
    rootPineSource,
    /i_adxLen\s+= input\.int\(14,[^\n]*minval=1[^\n]*maxval=100/,
  );
  assert.match(
    rootPineSource,
    /volScoreLo = math\.min\(i_volMin, i_volMax\)/,
  );
  assert.match(
    rootPineSource,
    /volScoreHi = math\.max\(i_volMin, i_volMax\)/,
  );

  assert.match(
    rootPineSource,
    /\[pdH, pdL, pdC\] = request\.security\([^\n]*lookahead=barmerge\.lookahead_on\)/,
  );
  assert.match(
    rootPineSource,
    /todayO = request\.security\([^\n]*lookahead=barmerge\.lookahead_on\)/,
  );
  assert.match(
    rootPineSource,
    /\[pwH, pwL\] = request\.security\([^\n]*lookahead=barmerge\.lookahead_on\)/,
  );
  assert.match(rootPineSource, /var int dayStartBar\s+= bar_index/);
  assert.match(rootPineSource, /var int weekStartBar = bar_index/);

  for (const deadName of [
    "bbWidthPre",
    "volPctPre",
    "bodyBull",
    "candleCol",
    "diP",
    "diM",
  ]) {
    assert.doesNotMatch(rootPineSource, new RegExp(`\\b${deadName}\\b`));
  }
});

test("chart adapter honors close confirmation and neutral MTF state", () => {
  assert.match(
    adapterSource,
    /includeProvisionalSignals: !waitForBarClose/,
  );
  assert.match(
    adapterSource,
    /const passesSignalGates =\s*Boolean\(structureEvent\?\.actionable\) &&\s*Boolean\(structureEvent\?\.filterState\?\.passes\)/,
  );
  assert.match(
    adapterSource,
    /direction === -1 \? "BEAR" : "—"/,
  );
  assert.match(
    adapterSource,
    /direction === -1\s*\? bearColor\s*:\s*"#86837D"/,
  );
});

test("chart adapter keeps structure visible while close-gating actionable overlays", () => {
  const barCount = 120;
  const chartBars = Array.from({ length: barCount }, (_, index) => {
    let price = 100 - index * 0.15;
    if (index === 40) price = 112;
    const time = 1_700_000_000 + index * 300;
    const ts = new Date(time * 1000).toISOString();
    return {
      time,
      ts,
      date: ts.slice(0, 10),
      o: price,
      h: price + 0.5,
      l: price - 0.5,
      c: price,
      v: 1000,
    };
  });
  const lastBarIndex = chartBars.length - 1;
  chartBars[lastBarIndex] = {
    ...chartBars[lastBarIndex],
    o: 90,
    h: 130,
    l: 89,
    c: 129,
  };

  const scriptKey = "pyrus-signals-smc-pro-v3";
  const adapter = createAdapter();
  const compute = (waitForBarClose) =>
    adapter.compute({
      chartBars,
      chartBarRanges: [],
      rawBars: [],
      dailyBars: [],
      settings: {
        timeHorizon: 8,
        bosConfirmation: "close",
        waitForBarClose,
        showTpSl: true,
      },
      timeframe: "5m",
      selectedIndicators: [scriptKey],
      sourceSeries: [],
    });

  const closeOnly = compute(true);
  const closeOnlyLastEvents = closeOnly.events?.filter(
    (event) => event.barIndex === lastBarIndex,
  );
  assert.equal(
    closeOnlyLastEvents?.find((event) => event.eventType === "bullish_choch")
      ?.label,
    "CHOCH",
  );
  assert.equal(
    closeOnlyLastEvents?.some((event) => event.eventType === "buy_signal"),
    false,
  );
  assert.equal(
    closeOnly.zones?.some((zone) => zone.zoneType === "tp-sl"),
    false,
  );

  const live = compute(false);
  const liveLastEvents = live.events?.filter(
    (event) => event.barIndex === lastBarIndex,
  );
  assert.equal(
    liveLastEvents?.some((event) => event.eventType === "buy_signal"),
    true,
  );
  assert.deepEqual(
    live.zones
      ?.filter((zone) => zone.zoneType === "tp-sl")
      .map((zone) => zone.label),
    ["SL", "TP 1", "TP 2", "TP 3"],
  );
});

test("chart adapter renders one direction for dual-wick breaks", () => {
  const directionalEventTypes = new Set([
    "bull_break",
    "bear_break",
    "bullish_choch",
    "bearish_choch",
    "buy_signal",
    "sell_signal",
  ]);
  const at = (output, barIndex) =>
    output.events
      ?.filter(
        (event) =>
          event.barIndex === barIndex && directionalEventTypes.has(event.eventType),
      )
      .map((event) => event.eventType) ?? [];

  assert.deepEqual(at(computeDualWick(111), 5), [
    "bull_break",
    "buy_signal",
    "bullish_choch",
  ]);
  assert.deepEqual(at(computeDualWick(89), 5), [
    "bear_break",
    "sell_signal",
    "bearish_choch",
  ]);
  assert.deepEqual(at(computeDualWick(100), 5), []);
  assert.deepEqual(at(computeDualWick(100, "long"), 6), [
    "bull_break",
    "buy_signal",
    "bullish_choch",
  ]);
  assert.deepEqual(at(computeDualWick(100, "short"), 6), [
    "bear_break",
    "sell_signal",
    "bearish_choch",
  ]);
});

test("chart adapter normalizes public settings to Pine and core bounds", () => {
  const settings = resolvePyrusSignalsRuntimeSettings({
    volScoreMin: 8,
    volScoreMax: 2,
    sessions: ["new_york_am"],
    supportResistanceExtensionBars: 999,
    showLastBarOnly: true,
    plotOverrides: { bullMain: { visible: false } },
  });

  assert.equal(settings.volScoreMin, 2);
  assert.equal(settings.volScoreMax, 8);
  assert.deepEqual(settings.sessions, ["new_york_am"]);
  assert.equal(settings.supportResistanceExtensionBars, 500);
  assert.equal("showLastBarOnly" in settings, false);
  assert.equal("plotOverrides" in settings, false);
});

test("chart adapter uses the canonical timestamp boundary", () => {
  assert.equal(
    __pyrusSignalsPineAdapterTestInternals.resolveMarketBarTimeSeconds({
      time: 1_000_000_000_000,
    }),
    1_000_000_000,
  );
  assert.equal(
    __pyrusSignalsPineAdapterTestInternals.resolveMarketBarTimeSeconds({
      time: new Date(Number.NaN),
    }),
    null,
  );
});

test("dashboard session and MTF rows use the last bar and valid source direction", () => {
  const endMs = Date.parse("2026-07-19T12:00:00.000Z");
  const chartBars = Array.from({ length: 120 }, (_, index) => {
    const time = (endMs - (119 - index) * 86_400_000) / 1_000;
    const close = 100 + index;
    const ts = new Date(time * 1_000).toISOString();
    return {
      time,
      ts,
      date: ts.slice(0, 10),
      o: close - 1,
      h: close + 1,
      l: close - 2,
      c: close,
      v: 1_000,
    };
  });
  const output = createAdapter().compute({
    chartBars,
    chartBarRanges: [],
    rawBars: chartBars,
    dailyBars: chartBars,
    settings: {
      showDashboard: true,
      mtf1: "1h",
      mtf2: "4h",
      mtf3: "D",
    },
    timeframe: "1d",
    selectedIndicators: ["pyrus-signals-smc-pro-v3"],
    sourceSeries: [],
  });
  const dashboard = output.events?.find(
    (event) => event.eventType === "pyrus_signals_dashboard",
  );
  const session = dashboard?.meta?.rows?.find((row) => row.label === "SESSION");
  const mtfByLabel = new Map(
    dashboard?.meta?.mtf?.map((row) => [row.label, row.value]) ?? [],
  );

  assert.equal(session?.value, "CLSD");
  assert.equal(mtfByLabel.get("1h"), "—");
  assert.equal(mtfByLabel.get("1d"), "BULL");
});
