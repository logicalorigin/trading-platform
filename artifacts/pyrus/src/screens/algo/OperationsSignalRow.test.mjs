import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_HERO_LOWER_ROW_HEIGHT,
  SIGNAL_HERO_SPARKLINE_HEIGHT,
  SIGNAL_HERO_SPARKLINE_MAX_WIDTH,
  SIGNAL_HERO_SPARKLINE_MIN_WIDTH,
  SIGNAL_HERO_SPARKLINE_WIDTH,
  SIGNAL_HERO_TOP_ROW_HEIGHT,
  SIGNAL_TABLE_ROW_HEIGHT,
  SIGNAL_TRADE_BUTTON_SIZE,
  directionMeta,
  resolveStaSparklineSignalTreatment,
  resolveSparklineData,
  resolveSparklineDataSource,
} from "./OperationsSignalRow.jsx";

const makeSparkBars = (count, start = 100) =>
  Array.from({ length: count }, (_, index) => ({
    close: start + index,
    timestamp: `2026-06-08T20:${String(index).padStart(2, "0")}:00.000Z`,
  }));

test("STA signal direction labels remain executable BUY/SELL labels", () => {
  assert.equal(directionMeta("buy").label, "BUY");
  assert.equal(directionMeta("long").label, "BUY");
  assert.equal(directionMeta("bullish").label, "BUY");

  assert.equal(directionMeta("sell").label, "SELL");
  assert.equal(directionMeta("short").label, "SELL");
  assert.equal(directionMeta("bearish").label, "SELL");
});

test("STA signal direction trend wording remains available separately", () => {
  assert.equal(directionMeta("buy").trend, "BULLISH");
  assert.equal(directionMeta("bullish").trend, "BULLISH");
  assert.equal(directionMeta("sell").trend, "BEARISH");
  assert.equal(directionMeta("bearish").trend, "BEARISH");
});

test("STA sparkline resolver keeps hydrated quote sparklines ahead of signal data", () => {
  const snapshotSparkBars = makeSparkBars(48, 100);
  const snapshotSpark = makeSparkBars(48, 200);
  const signalSparkBars = makeSparkBars(48, 90);

  assert.equal(
    resolveSparklineData(
      {
        sparkBars: snapshotSparkBars,
        spark: snapshotSpark,
      },
      {
        sparkBars: signalSparkBars,
      },
    ),
    snapshotSparkBars,
  );
  assert.equal(
    resolveSparklineDataSource({ sparkBars: snapshotSparkBars }),
    "runtime-spark-bars",
  );
});

test("STA sparkline resolver rejects legacy signal-row sparkline payloads", () => {
  const signalSparkBars = makeSparkBars(48, 90);
  const signalSpark = makeSparkBars(48, 80);
  const signalBars = makeSparkBars(48, 70).map((bar) => ({
    c: bar.close,
    timestamp: bar.timestamp,
  }));

  assert.deepEqual(
    resolveSparklineData({}, { sparkBars: signalSparkBars }),
    [],
  );
  assert.deepEqual(resolveSparklineData({}, { spark: signalSpark }), []);
  assert.deepEqual(resolveSparklineData({}, { bars: signalBars }), []);
  assert.deepEqual(
    resolveSparklineData({ sparkBars: makeSparkBars(4, 90) }, {}),
    [],
  );
  assert.equal(
    resolveSparklineDataSource({ sparkBars: makeSparkBars(4, 90) }),
    "empty",
  );
});

test("STA sparkline treatment follows signal direction instead of price slope", () => {
  assert.deepEqual(resolveStaSparklineSignalTreatment("buy"), {
    color: "var(--ra-blue-500)",
    mode: "current",
    direction: "buy",
  });
  assert.deepEqual(resolveStaSparklineSignalTreatment("sell"), {
    color: "var(--ra-red-500)",
    mode: "current",
    direction: "sell",
  });
  assert.deepEqual(
    resolveStaSparklineSignalTreatment("buy", { hasTimeline: true }),
    {
      color: null,
      mode: "timeline",
      direction: "buy",
    },
  );
  assert.deepEqual(resolveStaSparklineSignalTreatment(null), {
    color: null,
    mode: "price",
    direction: null,
  });
});

test("STA sparkline resolver rejects non-drawable fallback bars", () => {
  assert.deepEqual(
    resolveSparklineData(
      {},
      {
        bars: [
          { timestamp: "2026-06-08T20:00:00.000Z" },
          { timestamp: "2026-06-08T20:01:00.000Z" },
        ],
      },
    ),
    [],
  );
});

test("STA signal sparkline uses a bounded dynamic visual budget", () => {
  assert.equal(SIGNAL_HERO_SPARKLINE_MIN_WIDTH, 24);
  assert.equal(SIGNAL_HERO_SPARKLINE_WIDTH, 40);
  assert.equal(SIGNAL_HERO_SPARKLINE_MAX_WIDTH, 52);
  assert.ok(SIGNAL_HERO_SPARKLINE_MIN_WIDTH < SIGNAL_HERO_SPARKLINE_WIDTH);
  assert.ok(SIGNAL_HERO_SPARKLINE_WIDTH < SIGNAL_HERO_SPARKLINE_MAX_WIDTH);
  assert.equal(SIGNAL_HERO_SPARKLINE_HEIGHT, 14);
});

test("STA signal hero rows fit inside the fixed table row", () => {
  assert.equal(SIGNAL_HERO_TOP_ROW_HEIGHT, 14);
  assert.equal(SIGNAL_HERO_LOWER_ROW_HEIGHT, 14);
  assert.equal(SIGNAL_TRADE_BUTTON_SIZE, SIGNAL_HERO_TOP_ROW_HEIGHT);
  assert.ok(
    SIGNAL_HERO_TOP_ROW_HEIGHT + SIGNAL_HERO_LOWER_ROW_HEIGHT <=
      SIGNAL_TABLE_ROW_HEIGHT,
  );
});
