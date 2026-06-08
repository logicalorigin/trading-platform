import assert from "node:assert/strict";
import test from "node:test";

import { resolveWatchlistSparklineData } from "./PlatformWatchlist.jsx";

test("watchlist sparkline resolver uses live snapshot spark bars first", () => {
  const snapshotSparkBars = [{ close: 100 }, { close: 101 }];
  const snapshotSpark = [100, 101, 102];
  const fallbackSparkBars = [{ close: 90 }, { close: 91 }];
  const generatedSparkline = [{ v: 80 }, { v: 81 }];

  assert.deepEqual(
    resolveWatchlistSparklineData(
      {
        sparkBars: snapshotSparkBars,
        spark: snapshotSpark,
      },
      {
        sparkBars: fallbackSparkBars,
      },
      generatedSparkline,
    ),
    {
      data: snapshotSparkBars,
      source: "snapshot-spark-bars",
    },
  );
});

test("watchlist sparkline resolver keeps fallback sparkline data when live data is missing", () => {
  const fallbackSparkBars = [{ close: 90 }, { close: 91 }];
  const fallbackSpark = [90, 91, 92];

  assert.deepEqual(resolveWatchlistSparklineData({}, { sparkBars: fallbackSparkBars }), {
    data: fallbackSparkBars,
    source: "fallback-spark-bars",
  });
  assert.deepEqual(resolveWatchlistSparklineData({}, { spark: fallbackSpark }), {
    data: fallbackSpark,
    source: "fallback-spark",
  });
});

test("watchlist sparkline resolver ignores non-drawable live fallback data", () => {
  const fallbackSparkBars = [{ close: 90 }, { close: 91 }];

  assert.deepEqual(
    resolveWatchlistSparklineData(
      {
        sparkBars: [
          { timestamp: "2026-06-08T20:00:00.000Z" },
          { timestamp: "2026-06-08T20:01:00.000Z" },
        ],
        spark: [
          { timestamp: "2026-06-08T20:00:00.000Z" },
          { timestamp: "2026-06-08T20:01:00.000Z" },
        ],
      },
      { sparkBars: fallbackSparkBars },
    ),
    {
      data: fallbackSparkBars,
      source: "fallback-spark-bars",
    },
  );
});

test("watchlist sparkline resolver uses generated price fallback when live data is missing", () => {
  const generatedSparkline = [{ v: 511.11 }, { v: 512.34 }];

  assert.deepEqual(
    resolveWatchlistSparklineData(
      {
        symbol: "SPY",
        price: 512.34,
        chg: 1.23,
        pct: 0.24,
      },
      {
        price: 512.34,
      },
      generatedSparkline,
    ),
    {
      data: generatedSparkline,
      source: "generated-price-fallback",
    },
  );
});

test("watchlist sparkline resolver does not let non-drawable live data mask generated fallback", () => {
  const generatedSparkline = [{ v: 511.11 }, { v: 512.34 }];

  assert.deepEqual(
    resolveWatchlistSparklineData(
      {
        sparkBars: [{ timestamp: "2026-06-08T20:00:00.000Z" }],
        spark: [{ timestamp: "2026-06-08T20:00:00.000Z" }],
      },
      {},
      generatedSparkline,
    ),
    {
      data: generatedSparkline,
      source: "generated-price-fallback",
    },
  );
});
