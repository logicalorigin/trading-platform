import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveWatchlistSparklineData } from "./PlatformWatchlist.jsx";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("watchlist renders the visible extended-hours badge (not hover-only)", () => {
  // Regression guard: 5b68e05 moved the after-hours session line to a hover-only
  // title; it must render as a VISIBLE badge in the row (session label + price +
  // tone-colored move, dimmed when delayed/stale). Guards against re-regressing.
  const source = readLocalSource("./PlatformWatchlist.jsx");
  assert.match(source, /const renderExtendedHoursBadge\s*=/);
  assert.match(source, /\{renderExtendedHoursBadge\(\)\}/);
  assert.match(source, /data-testid="watchlist-extended-hours"/);
  assert.match(source, /extendedHoursPositive/);
});

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

test("watchlist sparkline resolver returns empty when live data is missing (no synthetic fallback)", () => {
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
    ),
    {
      data: [],
      source: "empty",
    },
  );
});

test("watchlist sparkline resolver returns empty when live data is non-drawable (no synthetic fallback)", () => {
  assert.deepEqual(
    resolveWatchlistSparklineData(
      {
        sparkBars: [{ timestamp: "2026-06-08T20:00:00.000Z" }],
        spark: [{ timestamp: "2026-06-08T20:00:00.000Z" }],
      },
      {},
    ),
    {
      data: [],
      source: "empty",
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
  const marketDataSource = readLocalSource(
    "./MarketDataSubscriptionProvider.jsx",
  );

  assert.equal(watchlistSource.includes("ResearchChartSurface"), false);
  assert.match(marketDataSource, /"market-sparklines"/);
  assert.match(
    marketDataSource,
    /useHydrationGate\(\{\s*enabled:\s*sparklineHistoryEnabled,\s*priority:\s*BARS_REQUEST_PRIORITY\.background,\s*family:\s*"sparkline",?\s*\}\)/s,
  );
  const marketSparklineQueryBlock =
    marketDataSource.match(
      /const sparklineQuery = useQuery\(\{[\s\S]*?const signalSparklinePrioritySeedQuery = useQuery/s,
    )?.[0] || "";
  assert.match(
    marketSparklineQueryBlock,
    /queryFn:\s*\(\) =>\s*fetchSparklineSeedInChunks\(historySparklineSymbols/s,
  );
  assert.match(marketSparklineQueryBlock, /enabled:\s*sparklineHistoryEnabled/);
  assert.doesNotMatch(marketSparklineQueryBlock, /getBarsRequest\(/);
  assert.doesNotMatch(marketDataSource, /const SPARKLINE_HISTORY_LIMIT = 720/);
  assert.match(
    marketDataSource,
    /"signal-sparkline-seed"[\s\S]*"priority"[\s\S]*signalSparklinePrioritySeedSymbols/s,
  );
  assert.match(
    marketDataSource,
    /"signal-sparkline-seed"[\s\S]*"background"[\s\S]*signalSparklineBackgroundSeedSymbols/s,
  );
  assert.doesNotMatch(
    marketDataSource,
    /signalSparkline(?:Priority|Background)?SeedQuery[\s\S]{0,900}placeholderData:\s*\(previousData\) => previousData/s,
  );
  assert.match(marketDataSource, /SIGNAL_SPARKLINE_PRIORITY_SEED_SYMBOL_LIMIT/);
  assert.match(marketDataSource, /SIGNAL_SPARKLINE_BACKGROUND_SEED_CHUNK_SIZE/);
  assert.match(marketDataSource, /SPARKLINE_MIN_VISUAL_POINT_COUNT\s*=\s*8/);
  assert.match(
    marketDataSource,
    /queryFn:\s*\(\) =>\s*fetchSignalSparklineSeedInChunks\(signalSparklineBackgroundSeedSymbols\)/s,
  );
  assert.match(marketDataSource, /retry:\s*retryUnlessTimeout\(2\)/s);
  assert.match(
    marketDataSource,
    /const hasSeedBars = hasUsableSparklineBars\(seedBars\);[\s\S]*else if \(isAggregateOnly && hasCachedBars\) \{[\s\S]*bars = mergeSparklineBars\(cachedBars, aggregateBars\);[\s\S]*\} else if \(isAggregateOnly\) \{\s*bars = \[\];\s*\}/s,
  );
  assert.match(
    marketDataSource,
    /const hasMarketSeedBars = hasUsableSparklineBars\(marketSeedBars\);[\s\S]*const fallbackBars = hasMarketSeedBars[\s\S]*\? marketSeedBars[\s\S]*: hasAggregateBars[\s\S]*\? aggregateBars[\s\S]*: \[\];/s,
  );
  assert.match(
    marketDataSource,
    /const clearAggregateOnlySparklineSymbols = useMemo\(\(\) => \{[\s\S]*!signalSparklineSeedSettled[\s\S]*aggregateOnlySparklineSymbolSet\.has\(symbol\)[\s\S]*!hasUsableSparklineBars\(sparklineBarsBySymbol\[symbol\]\)/s,
  );
  assert.match(
    marketDataSource,
    /clearSparklineSymbols:\s*clearAggregateOnlySparklineSymbols/,
  );
});

test("signal matrix surfaces seed sparklines without the market history bars path", () => {
  const source = readLocalSource("./PlatformApp.jsx");

  assert.match(
    source,
    /const runtimeHistorySparklineSymbols = useMemo\(\s*\(\) => \(signalMatrixRouteRequestActive \? \[\] : runtimeSparklineSymbols\)/,
  );
  assert.match(
    source,
    /const runtimePrioritySparklineSymbols = useMemo\(\s*\(\) => \(signalMatrixRouteRequestActive \? \[\] : prioritySparklineSymbols\)/,
  );
  assert.match(
    source,
    /const runtimeAggregateOnlySparklineSymbols = useMemo\([\s\S]*\.\.\.runtimeSparklineSymbols,[\s\S]*\.\.\.prioritySparklineSymbols,[\s\S]*\.\.\.signalMonitorDisplaySymbols/s,
  );
  assert.match(
    source,
    /sparklineSymbols=\{safeQaMode \? \[\] : runtimeHistorySparklineSymbols\}/,
  );
  assert.match(
    source,
    /prioritySparklineSymbols=\{safeQaMode \? \[\] : runtimePrioritySparklineSymbols\}/,
  );
  assert.match(
    source,
    /aggregateOnlySparklineSymbols=\{\s*safeQaMode \? \[\] : runtimeAggregateOnlySparklineSymbols\s*\}/,
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
  assert.equal(source.includes("readSignalMatrixSnapshotCache"), false);
  assert.equal(source.includes("writeSignalMatrixSnapshotCache"), false);
  // Matrix truth is states only: the backend latches identity and reconciles
  // stored states from canonical events, so the client never overlays events
  // onto matrix cells.
  assert.match(
    source,
    /const signalMonitorPublishedStates = useMemo\(\s*\(\) =>\s*mergeSignalMatrixStates\(\{\s*currentStates:\s*signalMatrixSnapshot\.states,\s*incomingStates:\s*signalMonitorStates/s,
  );
  assert.doesNotMatch(source, /mergeSignalEventsIntoMatrixStates/);
  assert.doesNotMatch(source, /canonicalSignalMonitorEventsForMatrixMerge/);
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
  assert.match(
    shellSource,
    /const algoMonitorSurfaceDataEnabled = Boolean\(\s*desktopActivitySidebarVisible \|\|\s*mobileActivityVisible \|\|\s*algoFrameRuntimeEnabled,?\s*\);/s,
  );
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

test("platform signal matrix subscription narrowing does not prune published rows", () => {
  const source = readLocalSource("./PlatformApp.jsx");

  assert.match(
    source,
    /Pressure caps narrow new Signal Matrix subscriptions[\s\S]*must not[\s\S]*prune rows/,
  );
  assert.doesNotMatch(source, /knownSymbols:\s*signalMatrixUniverseSymbols/);
});
