import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveWatchlistSparklineData } from "./PlatformWatchlist.jsx";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

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

test("watchlist signal display does not read the one-state monitor store or signal price", () => {
  const source = readLocalSource("./PlatformWatchlist.jsx");

  assert.equal(source.includes("useSignalMonitorStateForSymbol"), false);
  assert.equal(source.includes("useSignalMonitorSnapshot"), false);
  assert.equal(source.includes("currentSignalPrice"), false);
});

test("watchlist sparklines stay on sparkline data paths, not chart hydration", () => {
  const watchlistSource = readLocalSource("./PlatformWatchlist.jsx");
  const marketDataSource = readLocalSource("./MarketDataSubscriptionProvider.jsx");

  assert.equal(watchlistSource.includes("ResearchChartSurface"), false);
  assert.match(marketDataSource, /"market-sparklines"/);
  assert.match(
    marketDataSource,
    /useHydrationGate\(\{\s*enabled:\s*sparklineHistoryEnabled,\s*priority:\s*BARS_REQUEST_PRIORITY\.background,\s*family:\s*"sparkline",?\s*\}\)/s,
  );
  assert.match(
    marketDataSource,
    /getBarsRequest\([\s\S]*sparklineHydrationGate\.requestOptions/s,
  );
});

test("platform auxiliary signal surfaces receive bounded matrix overlays", () => {
  const source = readLocalSource("./PlatformApp.jsx");
  const shellSource = readLocalSource("./PlatformShell.jsx");
  const headerSource = readLocalSource("./AppHeader.jsx");
  const shellCallStart = source.indexOf("<PlatformShell");
  const shellCallEnd = source.indexOf(
    "selectedSymbol",
    shellCallStart,
  );
  const shellCallSource = source.slice(shellCallStart, shellCallEnd);

  assert.equal(source.includes("signalMatrixStates={signalMatrixSnapshot.states}"), false);
  assert.match(
    source,
    /const signalMonitorPublishedStates = useMemo\(\s*\(\) =>\s*mergeSignalEventsIntoMatrixStates\(\{/s,
  );
  assert.match(
    source,
    /states:\s*mergeSignalMatrixStates\(\{\s*currentStates:\s*signalMatrixSnapshot\.states,\s*incomingStates:\s*signalMonitorStates/s,
  );
  assert.match(
    source,
    /const signalMonitorStateRuntimeFallback = Boolean\(\s*signalMonitorStateQuery\.data\?\.stateSource === "runtime-fallback",?\s*\);/s,
  );
  assert.match(
    source,
    /const signalMonitorStates =\s*signalMonitorStateRuntimeFallback\s*\?\s*EMPTY_SIGNAL_MONITOR_STATES\s*:\s*signalMonitorStateQuery\.data\?\.states \|\| EMPTY_SIGNAL_MONITOR_STATES;/s,
  );
  assert.match(
    source,
    /const canonicalSignalMonitorEvents = useMemo\(/,
  );
  assert.match(
    source,
    /canonicalSignalMonitorEventsForMatrixMerge\(\{\s*events:\s*signalMonitorEvents,\s*sourceStatus:\s*signalMonitorEventsSourceStatus/s,
  );
  assert.match(
    source,
    /events:\s*canonicalSignalMonitorEvents/,
  );
  assert.match(
    source,
    /buildHeaderSignalContextSymbols\(\{\s*states:\s*signalMonitorPublishedStates,\s*events:\s*signalMonitorEvents/s,
  );
  assert.match(
    source,
    /resolveRecentSignalMarketDataSymbols\(signalMonitorPublishedStates\)/,
  );
  assert.match(
    source,
    /const signalMonitorStateBootstrapComplete = Boolean\([\s\S]*signalMonitorPublishedStates\.length > 0[\s\S]*\);/,
  );
  assert.match(
    source,
    /const signalMonitorStateBootstrapComplete = Boolean\([\s\S]*!signalMonitorStateRuntimeFallback[\s\S]*\);/,
  );
  assert.match(
    source,
    /signalMonitorState=\{\s*signalMonitorStateRuntimeFallback\s*\?\s*null\s*:\s*signalMonitorStateQuery\.data \|\| null\s*\}/s,
  );
  assert.match(
    source,
    /signalMonitorStateLoaded=\{Boolean\([\s\S]*!signalMonitorStateRuntimeFallback[\s\S]*\)\}/,
  );
  assert.equal(
    source.match(/signalMatrixStates=\{signalMonitorPublishedStates\}/g)?.length,
    1,
  );
  assert.match(source, /const headerBroadcastSignalMatrixStates = useMemo\(/);
  assert.match(source, /const watchlistSignalMonitorStates = useMemo\(/);
  assert.match(source, /const watchlistSignalMatrixStates = useMemo\(/);
  assert.match(source, /const activitySignalMatrixStates = useMemo\(/);
  assert.match(source, /filterSignalMatrixStatesForSymbols\(\{/);
  assert.match(source, /signalMonitorStates=\{watchlistSignalMonitorStates\}/);
  assert.match(source, /watchlistSignalMatrixStates=\{watchlistSignalMatrixStates\}/);
  assert.match(source, /activitySignalMatrixStates=\{activitySignalMatrixStates\}/);
  assert.equal(
    source.includes("const headerBroadcastSignalMatrixStates = signalMonitorPublishedStates;"),
    false,
  );
  assert.equal(
    shellSource.includes("...(Array.isArray(signalMatrixStates) ? signalMatrixStates : [])"),
    false,
  );
  assert.match(shellSource, /signalMatrixStates=\{watchlistSignalMatrixStates\}/);
  assert.match(shellSource, /signalMatrixStates=\{activitySignalMatrixStates\}/);
  assert.match(shellCallSource, /signalMonitorStates=\{watchlistSignalMonitorStates\}/);
  assert.equal(
    shellCallSource.includes("signalMonitorStates={signalMonitorStates}"),
    false,
  );
  assert.equal(
    headerSource.includes("headerSignalMatrixStates?.length ? headerSignalMatrixStates"),
    false,
  );
  assert.match(
    headerSource,
    /signalMatrixStates=\{headerSignalMatrixStates\}/,
  );
});
