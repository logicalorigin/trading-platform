import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPyrusSignalsPineRuntimeAdapter } from "./pyrusSignalsPineAdapter.ts";

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
  const adapter = createPyrusSignalsPineRuntimeAdapter({
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
