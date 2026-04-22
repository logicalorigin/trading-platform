import test from "node:test";
import assert from "node:assert/strict";
import { getBarTimeMs } from "../market/time.js";
import { buildChartDisplayModel, buildChartSeriesModel } from "./displayModel.js";
import { resolveResearchChartSourceSlice, shouldPreferSyncResearchChartModel } from "./researchChartModelWindow.js";

function createOptionBar(date, hour, min, open, high, low, close, volume = 100) {
  return {
    date,
    ts: `${date} ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    hour,
    min,
    o: open,
    h: high,
    l: low,
    c: close,
    v: volume,
  };
}

test("option chart display model preserves option-native threshold segments for a selected trade", () => {
  const optionBars = [
    createOptionBar("2024-03-28", 11, 49, 2.62, 2.7, 2.55, 2.66),
    createOptionBar("2024-03-28", 11, 50, 2.66, 2.8, 2.62, 2.74),
    createOptionBar("2024-03-28", 11, 51, 2.8, 3.02, 2.74, 2.95),
    createOptionBar("2024-03-28", 12, 34, 2.3, 2.42, 2.2, 2.31),
    createOptionBar("2024-03-28", 12, 35, 2.29, 2.32, 2.12, 2.16),
    createOptionBar("2024-03-28", 12, 36, 2.12, 2.2, 2.0, 2.04),
  ];

  const selectedTrade = {
    tradeId: "BT-0001-20240328-1150-RAYALGO-L-SPY240328C00521000",
    ts: "2024-03-28 11:50",
    et: "2024-03-28 12:35",
    strat: "rayalgo",
    dir: "long",
    optionTicker: "O:SPY240328C00521000",
    expiryDate: "2024-03-28",
    ic: true,
    k: 521,
    qty: 1,
    oe: 2.74,
    ep: 2.25,
    entryBasePrice: 2.74,
    exitBasePrice: 2.25,
    exitTriggerPrice: 2.25,
    stopLossPrice: 1.37,
    takeProfitPrice: 3.69,
    trailActivationPrice: 2.95,
    lastTrailStopPrice: 2.48,
    pnl: -58.17,
    er: "time_cliff_0dte",
    sp: 523.55,
    entrySpotPrice: 523.55,
    exitSpotPrice: 523.22,
  };

  const model = buildChartDisplayModel({
    bars: optionBars,
    dailyBars: [],
    chartRange: "1W",
    effectiveTf: "1m",
    tfMin: 1,
    trades: [selectedTrade],
    pricingMode: "option_history",
    chartPriceContext: "option",
    indicatorOverlayTape: null,
  });

  assert.equal(model.tradeOverlays.length, 1);

  const overlay = model.tradeOverlays[0];
  assert.equal(overlay.tradeSelectionId, selectedTrade.tradeId);
  assert.equal(overlay.chartPriceContext, "option");
  assert.equal(overlay.entryPrice, selectedTrade.entryBasePrice);
  assert.equal(overlay.exitPrice, selectedTrade.exitBasePrice);

  const segments = Array.isArray(overlay.thresholdPath?.segments) ? overlay.thresholdPath.segments : [];
  assert.ok(segments.length >= 5);

  const segmentValueByKind = Object.fromEntries(segments.map((segment) => [segment.kind, segment.value]));
  assert.equal(segmentValueByKind.take_profit, selectedTrade.takeProfitPrice);
  assert.equal(segmentValueByKind.stop_loss, selectedTrade.stopLossPrice);
  assert.equal(segmentValueByKind.trail_arm, selectedTrade.trailActivationPrice);
  assert.equal(segmentValueByKind.trail_stop, selectedTrade.lastTrailStopPrice);
  assert.equal(segmentValueByKind.exit_trigger, selectedTrade.exitTriggerPrice);
});

function createResearchBars(dayCount = 10, minutesPerDay = 390, baseDateText = "2024-03-11") {
  const baseDate = new Date(`${baseDateText}T00:00:00Z`);
  const bars = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const currentDate = new Date(baseDate.getTime());
    currentDate.setUTCDate(baseDate.getUTCDate() + dayIndex);
    const date = currentDate.toISOString().slice(0, 10);
    for (let minuteOffset = 0; minuteOffset < minutesPerDay; minuteOffset += 1) {
      const totalMinutes = (9 * 60) + 30 + minuteOffset;
      const hour = Math.floor(totalMinutes / 60);
      const min = totalMinutes % 60;
      bars.push({
        date,
        ts: `${date} ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
        hour,
        min,
        o: 100 + dayIndex,
        h: 101 + dayIndex,
        l: 99 + dayIndex,
        c: 100.5 + dayIndex,
        v: 1000 + minuteOffset,
      });
    }
  }
  return bars;
}

function createDailyBar(date, close) {
  return {
    date,
    ts: date,
    time: 1,
    o: close - 1,
    h: close + 1,
    l: close - 2,
    c: close,
    v: 1000,
  };
}

test("daily chart series model can build from daily bars without raw intraday bars", () => {
  const dailyBars = [
    createDailyBar("2024-03-11", 500),
    createDailyBar("2024-03-12", 502),
    createDailyBar("2024-03-13", 501),
  ];

  const model = buildChartSeriesModel({
    bars: [],
    dailyBars,
    chartRange: "1Y",
    effectiveTf: "D",
    tfMin: 1,
  });

  assert.equal(model.chartBars.length, dailyBars.length);
  assert.deepEqual(model.chartBars.map((bar) => bar.date), dailyBars.map((bar) => bar.date));
  assert.equal(model.chartBarRanges.length, dailyBars.length);
  assert.ok(model.defaultVisibleLogicalRange);
});

test("research chart source slice falls back to the active tail window when no viewport is available", () => {
  const bars = createResearchBars();
  const slice = resolveResearchChartSourceSlice({
    bars,
    chartRange: "1D",
    chartWindowMode: "default",
    effectiveTf: "1m",
    tfMin: 1,
  });

  assert.equal(slice.reason, "tail");
  assert.equal(slice.endIndex, bars.length - 1);
  assert.ok(slice.startIndex > 0);
  assert.equal(slice.windowed, true);
});

test("research chart source slice ignores viewport and selected-trade focus in default mode", () => {
  const bars = createResearchBars();
  const baselineSlice = resolveResearchChartSourceSlice({
    bars,
    chartRange: "1D",
    chartWindowMode: "default",
    effectiveTf: "1m",
    tfMin: 1,
  });
  const viewportStartIndex = bars.length - 360;
  const viewportEndIndex = bars.length - 120;
  const selectedTradeEntryIndex = 24;
  const selectedTradeExitIndex = 48;
  const slice = resolveResearchChartSourceSlice({
    bars,
    chartRange: "1D",
    chartWindowMode: "default",
    effectiveTf: "1m",
    tfMin: 1,
    autoTimeBounds: {
      startMs: getBarTimeMs(bars[viewportStartIndex]),
      endMs: getBarTimeMs(bars[viewportEndIndex]),
    },
    selectedTrade: {
      ts: bars[selectedTradeEntryIndex].ts,
      et: bars[selectedTradeExitIndex].ts,
    },
  });

  assert.equal(slice.reason, "tail");
  assert.deepEqual(slice, baselineSlice);
  assert.ok(slice.startIndex > selectedTradeExitIndex);
});

test("custom viewport mode keeps the source slice on the active viewport instead of a distant selected trade", () => {
  const bars = createResearchBars();
  const viewportStartIndex = bars.length - 360;
  const viewportEndIndex = bars.length - 120;
  const selectedTradeEntryIndex = 24;
  const selectedTradeExitIndex = 48;
  const slice = resolveResearchChartSourceSlice({
    bars,
    chartRange: "1D",
    chartWindowMode: "custom",
    effectiveTf: "1m",
    tfMin: 1,
    autoTimeBounds: {
      startMs: getBarTimeMs(bars[viewportStartIndex]),
      endMs: getBarTimeMs(bars[viewportEndIndex]),
    },
    selectedTrade: {
      ts: bars[selectedTradeEntryIndex].ts,
      et: bars[selectedTradeExitIndex].ts,
    },
  });

  assert.equal(slice.reason, "viewport");
  assert.ok(slice.startIndex <= viewportStartIndex);
  assert.ok(slice.endIndex >= viewportEndIndex);
  assert.ok(slice.startIndex > selectedTradeExitIndex);
});


test("large all-candles models prefer synchronous generation to avoid worker clone pressure", () => {
  assert.equal(shouldPreferSyncResearchChartModel({ chartWindowMode: "all", modelBars: Array.from({ length: 12000 }, (_, index) => index) }), true);
  assert.equal(shouldPreferSyncResearchChartModel({ chartWindowMode: "all", modelBars: Array.from({ length: 6000 }, (_, index) => index) }), false);
  assert.equal(shouldPreferSyncResearchChartModel({ chartWindowMode: "default", modelBars: Array.from({ length: 24000 }, (_, index) => index) }), false);
});
