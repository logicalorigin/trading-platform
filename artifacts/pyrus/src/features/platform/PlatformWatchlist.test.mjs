import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveWatchlistSparklineData } from "./PlatformWatchlist.jsx";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("STA and watchlist reads do not launder stale or built-in fallback data", () => {
  const source = readLocalSource("./PlatformApp.jsx");
  const freshnessSource = readLocalSource("./platformFreshnessBus.ts");
  const watchlistStart = source.indexOf("const watchlistsQuery = useListWatchlists");
  const watchlistEnd = source.indexOf("const marketScreenActive", watchlistStart);
  const profileStart = source.indexOf(
    "const signalMonitorProfileQuery = useGetSignalMonitorProfile",
  );
  const profileEnd = source.indexOf("const ibkrWorkPressure", profileStart);
  const eventsStart = source.indexOf("const signalMonitorEventsQuery = useQuery");
  const eventsEnd = source.indexOf(
    "completeBootProgressTask(\"signal-profile\"",
    eventsStart,
  );

  for (const offset of [watchlistStart, watchlistEnd, profileStart, profileEnd, eventsStart, eventsEnd]) {
    assert.notEqual(offset, -1);
  }

  const watchlistBlock = source.slice(watchlistStart, watchlistEnd);
  assert.doesNotMatch(watchlistBlock, /WATCHLIST\.map|\["SPY"\]/);
  assert.doesNotMatch(
    watchlistBlock,
    /const watchlists = useMemo\([\s\S]*watchlistsQuery\.isError\s*\? \[\]/s,
  );
  assert.match(
    watchlistBlock,
    /const watchlists = useMemo\([\s\S]*watchlistsQuery\.data\?\.watchlists \|\| \[\]/s,
  );
  assert.match(
    watchlistBlock,
    /resolveWatchlistCollectionState\(\{[\s\S]*hasResolvedData:[\s\S]*watchlistCount: watchlists\.length,[\s\S]*isError: watchlistsQuery\.isError,[\s\S]*isFetching: watchlistsQuery\.isFetching,/s,
  );
  assert.doesNotMatch(watchlistBlock, /isStale: watchlistsQuery\.isStale/);

  const profileBlock = source.slice(profileStart, profileEnd);
  assert.doesNotMatch(profileBlock, /placeholderData/);
  assert.match(profileBlock, /fetchedAt: signalMonitorProfileQuery\.dataUpdatedAt/);
  assert.match(profileBlock, /!signalMonitorProfileQuery\.isError/);

  const eventsBlock = source.slice(eventsStart, eventsEnd);
  assert.match(eventsBlock, /fetchedAt: signalMonitorEventsQuery\.dataUpdatedAt/);
  assert.match(eventsBlock, /!signalMonitorEventsQuery\.isError/);

  assert.match(freshnessSource, /fetchedAt\?: number/);
  assert.match(freshnessSource, /resolvedExpiresAt <= Date\.now\(\)/);
  assert.match(freshnessSource, /expiresAt: resolvedExpiresAt/);
});

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

test("watchlist management controls expose stable accessible names", () => {
  const source = readLocalSource("./PlatformWatchlist.jsx");
  assert.match(source, /placeholder="Filter\.\.\."\s+aria-label="Filter watchlist symbols"/);
  assert.match(
    source,
    /data-testid=\{[\s\S]*?watchlist-create-watchlist[\s\S]*?aria-label=\{mobileDense \? "Manage watchlist" : "Create watchlist"\}/,
  );
});

test("watchlist collection states stay truthful while cached rows remain visible", () => {
  const watchlistSource = readLocalSource("./PlatformWatchlist.jsx");
  const shellSource = readLocalSource("./PlatformShell.jsx");
  const mobileDrawerSource = readLocalSource("./MobileWatchlistDrawer.jsx");
  const appSource = readLocalSource("./PlatformApp.jsx");

  assert.match(watchlistSource, /data-testid="watchlist-collection-stale"/);
  assert.match(watchlistSource, /title="Loading watchlists"/);
  assert.match(watchlistSource, /title="Watchlists unavailable"/);
  assert.match(watchlistSource, /title=\{search\.trim\(\) \? "No matching symbols" :/);
  assert.match(appSource, /watchlistCollectionState=\{watchlistCollectionState\}/);
  assert.equal(
    shellSource.match(/collectionState=\{watchlistCollectionState\}/g)?.length,
    1,
  );
  assert.match(
    shellSource,
    /watchlistCollectionState=\{watchlistCollectionState\}/,
  );
  assert.match(
    mobileDrawerSource,
    /collectionState=\{watchlistCollectionState\}/,
  );
});

test("watchlist signal clusters preserve touch targets without spacing each arrow apart", () => {
  const source = readLocalSource("./PlatformWatchlist.jsx");

  assert.match(
    source,
    /data-testid="watchlist-signal-cluster"[\s\S]*?minHeight: dim\(mobileDense \? 44 : 24\)/,
  );
  assert.doesNotMatch(source, /interactiveTargetSize=\{mobileDense \? 44 : 24\}/);
  assert.match(source, /height: mobileDense \? "auto" : undefined/);
  assert.match(source, /minHeight: mobileDense \? 52 : undefined/);
});

test("watchlist rows expose native primary actions without nested activation", () => {
  const source = readLocalSource("./PlatformWatchlist.jsx");
  const testId = 'data-testid="watchlist-row-primary"';
  const primaryOffsets = [];
  let offset = source.indexOf(testId);

  while (offset >= 0) {
    primaryOffsets.push(offset);
    offset = source.indexOf(testId, offset + testId.length);
  }

  assert.equal(primaryOffsets.length, 2, "mobile and desktop rows each need a primary action");
  assert.match(
    source,
    /const handlePrimaryActionClick = \(event\) => \{\s*event\.stopPropagation\(\);\s*handleRowClick\(\);\s*\};/,
  );
  assert.equal(source.match(/onClick=\{handlePrimaryActionClick\}/g)?.length, 2);

  for (const primaryOffset of primaryOffsets) {
    const buttonOpen = source.lastIndexOf("<button", primaryOffset);
    const openingTagEnd = source.indexOf(">", primaryOffset);
    const buttonClose = source.indexOf("</button>", openingTagEnd);
    const openingTag = source.slice(buttonOpen, openingTagEnd);
    const buttonBody = source.slice(openingTagEnd, buttonClose);

    assert.ok(buttonOpen >= 0 && buttonOpen < primaryOffset);
    assert.match(openingTag, /type="button"/);
    assert.match(openingTag, /onClick=\{handlePrimaryActionClick\}/);
    assert.doesNotMatch(buttonBody, /<button|<SignalDots|renderSignalCluster|renderSelectionControl/);
  }
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

  assert.deepEqual(
    resolveWatchlistSparklineData({}, { sparkBars: fallbackSparkBars }),
    {
      data: fallbackSparkBars,
      source: "fallback-spark-bars",
    },
  );
  assert.deepEqual(
    resolveWatchlistSparklineData({}, { spark: fallbackSpark }),
    {
      data: fallbackSpark,
      source: "fallback-spark",
    },
  );
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

test("watchlist rows retain unchanged per-symbol matrix props across full-universe deltas", () => {
  const source = readLocalSource("./PlatformWatchlist.jsx");

  assert.match(
    source,
    /const previousSignalMatrixBySymbolRef = useRef\(\{\}\);/,
  );
  assert.match(
    source,
    /buildSignalMatrixBySymbol\(\s*signalMatrixStates,\s*WATCHLIST_SIGNAL_TIMEFRAMES,\s*previousSignalMatrixBySymbolRef\.current,\s*\)/,
  );
  assert.match(
    source,
    /previousSignalMatrixBySymbolRef\.current = signalMatrixBySymbol;/,
  );
  assert.doesNotMatch(
    source,
    /signalMatrixStates\.(?:slice|filter)\([^)]*(?:visible|viewport)/i,
  );
  assert.match(
    source,
    /const WATCHLIST_SIGNAL_DOTS_STYLE = \{ minWidth: dim\(52\), gap: sp\(3\) \};/,
  );
  assert.match(
    source,
    /const handleSignalClusterClick = useCallback\([\s\S]*?onSignalAction\?\.\(item\.sym, bestSignalState\)[\s\S]*?\[bestSignalState, item\.sym, onSignalAction\]/,
  );
  assert.match(
    source,
    /<SignalDots[\s\S]*?statesByTimeframe=\{signalStatesByTimeframe\}[\s\S]*?style=\{WATCHLIST_SIGNAL_DOTS_STYLE\}/,
  );
  assert.doesNotMatch(source, /onSelect=\{handleSignalSelect\}/);
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
      /const sparklineQuery = useQuery\(\{[\s\S]*?const signalSparklineSeedQuery = useQuery/s,
    )?.[0] || "";
  assert.match(
    marketSparklineQueryBlock,
    /queryFn:\s*\(\) =>\s*fetchSparklineSeedInChunks\(historySparklineSymbols/s,
  );
  assert.match(
    marketSparklineQueryBlock,
    /enabled:\s*sparklineHydrationGate\.enabled/,
  );
  assert.doesNotMatch(marketSparklineQueryBlock, /getBarsRequest\(/);
  assert.doesNotMatch(marketDataSource, /const SPARKLINE_HISTORY_LIMIT = 720/);
  // Signal sparkline seed is a SINGLE concurrent chunked query over ALL signal
  // symbols. The deprecated priority/background split (which hydrated rows in
  // symbol order, not data availability) must stay gone.
  assert.match(
    marketDataSource,
    /"signal-sparkline-seed"[\s\S]*signalSparklineSeedSymbols/s,
  );
  assert.match(
    marketDataSource,
    /queryFn:\s*\(\{\s*signal\s*\}\) =>\s*fetchSignalSparklineSeedInChunks\(signalSparklineSeedSymbols,\s*\{\s*onChunk: publishSignalSparklineSeedChunk,\s*signal,\s*\}\)/s,
  );
  assert.doesNotMatch(marketDataSource, /signalSparklinePrioritySeedQuery/);
  assert.doesNotMatch(marketDataSource, /signalSparklineBackgroundSeedQuery/);
  assert.doesNotMatch(
    marketDataSource,
    /SIGNAL_SPARKLINE_PRIORITY_SEED_SYMBOL_LIMIT/,
  );
  assert.doesNotMatch(
    marketDataSource,
    /SIGNAL_SPARKLINE_BACKGROUND_SEED_CHUNK_SIZE/,
  );
  assert.doesNotMatch(
    marketDataSource,
    /signalSparklineSeedQuery[\s\S]{0,900}placeholderData:\s*\(previousData\) => previousData/s,
  );
  assert.match(marketDataSource, /SPARKLINE_MIN_VISUAL_POINT_COUNT\s*=\s*2/);
  assert.match(
    marketDataSource,
    /SIGNAL_SPARKLINE_SEED_FETCH_CONCURRENCY\s*=\s*1/,
  );
  // Chunks fan out concurrently with a bounded cap (reusing settleWithConcurrency).
  assert.match(
    marketDataSource,
    /fetchSignalSparklineSeedInChunks = async[\s\S]*settleWithConcurrency\(/s,
  );
  assert.match(
    marketDataSource,
    /fetchSignalSparklineSeedInChunks = async[\s\S]*onChunk = null[\s\S]*onChunk\(chunkBarsBySymbol/s,
  );
  assert.match(
    marketDataSource,
    /item\?\.status === "pending"/,
    "cache-warming misses must remain distinguishable from final empty history",
  );
  assert.match(
    marketDataSource,
    /SIGNAL_SPARKLINE_SEED_PENDING_RETRY_DELAYS_MS/,
    "pending seed chunks need a bounded backoff instead of a tight retry loop",
  );
  assert.match(
    marketDataSource,
    /pendingChunks = nextPendingChunks/,
    "the seed pass must revisit cache-warming chunks",
  );
  assert.match(
    marketDataSource,
    /const publishSignalSparklineSeedChunk = useCallback\([\s\S]*syncRuntimeMarketData\([\s\S]*sparklineBarsBySymbol: visualBarsBySymbol/s,
  );
  assert.match(
    marketDataSource,
    /signalSeedChunkFlushCount:\s*signalSparklineSeedChunkFlushRef\.current\.count/s,
  );
  assert.match(
    marketDataSource,
    /const rejected = settled\.filter\(\(result\) => result\.status === "rejected"\);[\s\S]*if \(rejected\.length\) \{[\s\S]*throw rejected\[0\]\?\.reason/s,
  );
  assert.doesNotMatch(
    marketDataSource,
    /if \(!fulfilled\.length\) \{[\s\S]*return Object\.assign\(\{\}, \.\.\.fulfilled\.map/s,
  );
  assert.match(
    marketDataSource,
    /SIGNAL_SPARKLINE_SEED_FETCH_CONCURRENCY\s*=\s*1/,
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
    /const signalSparklineSeedSettled = Boolean\(\s*!signalSparklineSeedSymbols\.length \|\| signalSparklineSeedQuery\.isSuccess,\s*\);/s,
  );
  assert.doesNotMatch(marketDataSource, /signalSparklineSeedQuery\.isError/);
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
  const shellSource = readLocalSource("./PlatformShell.jsx");
  const marketDataSource = readLocalSource(
    "./MarketDataSubscriptionProvider.jsx",
  );
  const schedulerSource = readLocalSource("./appWorkScheduler.js");
  const signalWorkFastScreenBlock =
    /const signalWorkFastScreen = Boolean\([\s\S]*?\);/.exec(source)?.[0] ?? "";

  assert.equal(
    source.includes(
      "...(signalMatrixRouteRequestActive ? signalMonitorStateUniverseSymbols : [])",
    ),
    false,
  );
  assert.equal(source.includes("quoteSnapshotSeedSymbols"), false);
  assert.equal(marketDataSource.includes("quoteSnapshotSeedSymbols"), false);
  assert.match(
    source,
    /const runtimeSparklineSymbols = useMemo\([\s\S]*\.\.\.sparklineSymbols,[\s\S]*\.\.\.recentSignalMarketDataSymbols,[\s\S]*\.\.\.openPositionMarketDataSymbols/s,
  );
  assert.match(
    source,
    /const prioritySparklineSymbols = useMemo\([\s\S]*\.\.\.recentSignalMarketDataSymbols,[\s\S]*\.\.\.watchlistMarketDataSymbols,[\s\S]*\.\.\.openPositionMarketDataSymbols/s,
  );
  assert.match(
    source,
    /const runtimeHistorySparklineSymbols = useMemo\(\s*\(\) =>\s*signalMatrixRouteRequestActive \|\| screen === "trade"\s*\? \[\]\s*: runtimeSparklineSymbols/,
  );
  assert.match(
    source,
    /const runtimePrioritySparklineSymbols = useMemo\(\s*\(\) =>\s*signalMatrixRouteRequestActive \|\| screen === "trade"\s*\? \[\]\s*: prioritySparklineSymbols/,
  );
  assert.match(
    source,
    /const realtimeSignalAggregateUniverseSymbols = useMemo\(\(\) => \{[\s\S]*signalMatrixPressureCaps\.signalRealtimeAggregateSymbolLimit[\s\S]*signalMonitorUniverseSymbols\.slice\(0, limit\)/,
  );
  assert.match(
    source,
    /Keep the broad signal-scanning universe off the Trade screen quote[\s\S]*\.\.\.\(screen === "trade" \? \[\] : signalMonitorUniverseSymbols\)/,
  );
  assert.match(
    source,
    /const signalMatrixStreamReady = shouldRunSignalMatrixStream\(\{[\s\S]*screen,[\s\S]*backgroundAllowed: activeScreenBackgroundDataAllowed/s,
  );
  assert.match(
    schedulerSource,
    /activeScreen !== "trade"[\s\S]*\(backgroundAllowed \|\| foregroundSignalSurface\)/s,
  );
  assert.match(
    shellSource,
    /const tradeScreenConnectionPriority = activeScreen === "trade";[\s\S]*const algoFrameRuntimeEnabled = Boolean\([\s\S]*!tradeScreenConnectionPriority[\s\S]*const activitySidebarRealtimeStreamGateReason =[\s\S]*tradeScreenConnectionPriority[\s\S]*\? "trade-chart-priority"/s,
  );
  assert.match(
    shellSource,
    /tradeScreenConnectionPriority\s*\?\s*"trade-chart-priority"/,
  );
  assert.match(
    signalWorkFastScreenBlock,
    /const signalWorkFastScreen = Boolean\([\s\S]*marketScreenActive[\s\S]*screen === "signals"[\s\S]*flowScreenActive[\s\S]*screen === "algo"[\s\S]*\);/,
  );
  assert.equal(signalWorkFastScreenBlock.includes('screen === "trade"'), false);
  assert.match(
    source,
    /const signalMonitorEventsReady = Boolean\([\s\S]*screen !== "trade"[\s\S]*!criticalApiMutationPaused/s,
  );
  assert.doesNotMatch(
    source.match(
      /const signalMonitorEventsReady = Boolean\([\s\S]*?\);/,
    )?.[0] || "",
    /screen !== "algo"/,
  );
  assert.match(
    source,
    /const runtimeAggregateOnlySparklineSymbols = useMemo\(\s*\(\) =>\s*signalMatrixRouteRequestActive && screen !== "trade"\s*\?/,
  );
  const aggregateOnlySparklineBlock = source.slice(
    source.indexOf("const runtimeAggregateOnlySparklineSymbols"),
    source.indexOf(
      "const runtimeStreamedAggregateSymbols",
      source.indexOf("const runtimeAggregateOnlySparklineSymbols"),
    ),
  );
  assert.match(
    aggregateOnlySparklineBlock,
    /\?\s*signalMonitorSymbols\s*:\s*\[\]/s,
    "historical sparkline seeding must contain exactly the published STA row symbols",
  );
  assert.doesNotMatch(
    aggregateOnlySparklineBlock,
    /runtimeSparklineSymbols|prioritySparklineSymbols|signalMonitorUniverseSymbols/,
    "watchlist and broad scan symbols must not queue irrelevant history ahead of published STA rows",
  );
  const streamedAggregateBlock = source.slice(
    source.indexOf("const runtimeStreamedAggregateSymbols"),
    source.indexOf(
      "const headerBroadcastSignalMatrixStatesRef",
      source.indexOf("const runtimeStreamedAggregateSymbols"),
    ),
  );
  assert.match(
    streamedAggregateBlock,
    /realtimeSignalAggregateUniverseSymbols/,
    "realtime aggregate streaming must stay pressure-capped",
  );
  assert.doesNotMatch(
    streamedAggregateBlock,
    /runtimeAggregateOnlySparklineSymbols/,
    "the full historical seed universe must not leak into realtime streams",
  );
  assert.match(
    source,
    /sparklineSymbols=\{safeQaMode \? \[\] : runtimeHistorySparklineSymbols\}/,
  );
  assert.match(
    source,
    /prioritySparklineSymbols=\{\s*safeQaMode \? \[\] : runtimePrioritySparklineSymbols\s*\}/,
  );
  assert.match(
    source,
    /aggregateOnlySparklineSymbols=\{\s*safeQaMode \? \[\] : runtimeAggregateOnlySparklineSymbols\s*\}/,
  );
});

test("platform auxiliary signal surfaces receive bounded matrix overlays", () => {
  const source = readLocalSource("./PlatformApp.jsx");
  const schedulerSource = readLocalSource("./signalMatrixScheduler.js");
  const routerSource = readLocalSource("./PlatformScreenRouter.jsx");
  const shellSource = readLocalSource("./PlatformShell.jsx");
  const headerSource = readLocalSource("./AppHeader.jsx");
  const shellCallStart = source.indexOf("<PlatformShell");
  const shellCallEnd = source.indexOf("selectedSymbol", shellCallStart);
  const shellCallSource = source.slice(shellCallStart, shellCallEnd);

  assert.equal(
    source.includes("signalMatrixStates={signalMatrixSnapshot.states}"),
    false,
  );
  assert.equal(source.includes("readSignalMatrixSnapshotCache"), false);
  assert.equal(source.includes("writeSignalMatrixSnapshotCache"), false);
  assert.match(
    source,
    /SIGNAL_MATRIX_RETIRED_SNAPSHOT_CACHE_KEYS[\s\S]*pyrus:signal-matrix-snapshot:v5/,
  );
  assert.match(
    source,
    /SIGNAL_MATRIX_RETIRED_SNAPSHOT_CACHE_KEYS\.forEach\(\(key\) => \{[\s\S]*storage\.removeItem\(key\);/,
  );
  // Matrix truth is states only: the backend latches identity and reconciles
  // stored states from canonical events, so the client never overlays events
  // onto matrix cells.
  assert.match(
    source,
    /const signalMonitorPublishedStates =\s*signalMatrixSnapshot\.states \|\| EMPTY_SIGNAL_MONITOR_STATES;/,
    "canonical matrix states must not be copied and sorted through an empty merge",
  );
  assert.doesNotMatch(
    source,
    /incomingStates:\s*EMPTY_SIGNAL_MONITOR_STATES/,
  );
  assert.doesNotMatch(source, /mergeSignalEventsIntoMatrixStates/);
  assert.doesNotMatch(source, /canonicalSignalMonitorEventsForMatrixMerge/);
  assert.doesNotMatch(source, /useGetSignalMonitorState/);
  assert.doesNotMatch(source, /getGetSignalMonitorStateQueryKey/);
  assert.doesNotMatch(source, /signalMonitorStateQuery/);
  assert.doesNotMatch(source, /stateSource === "runtime-fallback"/);
  assert.doesNotMatch(source, /signalMonitorStateUniverseSymbols/);
  assert.match(
    source,
    /const signalMonitorUniverseSymbols = useMemo\(\(\) => \{[\s\S]*signalMonitorUniverseScope === "selected_watchlist"[\s\S]*signalMonitorUniverseScope === "all_watchlists"[\s\S]*SIGNAL_MONITOR_LOCAL_EXPANSION_SYMBOLS[\s\S]*normalizeSignalMonitorUniverseSymbols/s,
  );
  assert.match(
    source,
    /const signalMatrixUniverseDescriptor = useMemo\(\(\) => \{[\s\S]*source: resolveSignalMonitorUniverseSource\(signalMonitorUniverseScope\)[\s\S]*fallbackUsed: false/s,
  );
  assert.match(
    source,
    /const profileUniverseScopeSymbols = signalMatrixStreamUsesProfileUniverse[\s\S]*\? signalMonitorUniverseSymbolLimit[\s\S]*: 0;/,
  );
  assert.match(
    source,
    /const signalMatrixStaBootstrapTimeframes = useMemo\([\s\S]*buildSignalMatrixStaBootstrapTimeframes\(\{[\s\S]*staExecutionTimeframe: activeStaExecutionTimeframe,[\s\S]*staMtfTimeframes: activeStaMtfTimeframes,[\s\S]*profileTimeframe: signalMonitorProfile\?\.timeframe,/,
  );
  assert.match(source, /universe: signalMatrixUniverseDescriptor,/);
  assert.match(
    source,
    /signalMatrixUniverse=\{signalMatrixUniverseDescriptor\}/,
  );
  assert.match(
    routerSource,
    /signalMonitorDataManagedByPlatform[\s\S]*\? signalMonitorSymbols[\s\S]*: signalMonitorDisplaySymbols\?\.length/s,
  );
  assert.match(routerSource, /signalMatrixUniverse=\{signalMatrixUniverse\}/);
  assert.match(
    source,
    /useSignalMonitorMatrixStream\(\{[\s\S]*symbols: signalMatrixStreamUsesProfileUniverse[\s\S]*\? EMPTY_UNIVERSE_SYMBOLS[\s\S]*: signalMatrixUniverseSymbols,[\s\S]*profileUniverse: signalMatrixStreamUsesProfileUniverse/s,
  );
  assert.match(source, /timeframes: signalMatrixStreamTimeframes,/);
  const profileUniverseStreamKeyBlock = source.slice(
    source.indexOf("const signalMatrixProfileUniverseStreamKey"),
    source.indexOf(
      "const signalMatrixObservedUniverseSymbols",
      source.indexOf("const signalMatrixProfileUniverseStreamKey"),
    ),
  );
  assert.match(
    profileUniverseStreamKeyBlock,
    /buildSignalMatrixProfileUniverseStreamKey/,
  );
  assert.doesNotMatch(
    profileUniverseStreamKeyBlock,
    /updatedAt|lastEvaluatedAt/,
    "evaluation bookkeeping must not recreate the Signal Matrix EventSource",
  );
  assert.match(
    source,
    /setSignalMatrixFullTimeframeStreamEnabled\(true\);[\s\S]*SIGNAL_MATRIX_FULL_TIMEFRAME_WIDEN_DELAY_MS/,
  );
  assert.match(
    source,
    /const handleSignalMatrixStreamStates = useCallback\(\s*\(incomingStates, kind, payload = null\)/,
  );
  assert.match(
    source,
    /const framePublication = resolveSignalMatrixStreamFramePublication\(\s*kind,\s*payload,\s*\);[\s\S]*if \(framePublication\.markBootstrapReceived\) \{[\s\S]*setSignalMatrixBootstrapSequence/s,
    "intermediate bootstrap pages must not unlock the timeframe-widen re-key",
  );
  assert.match(
    source,
    /if \(framePublication\.publishHeaderStates\) \{[\s\S]*const candidateHeaderStates =[\s\S]*nextHeaderStates = retainEquivalentSignalBroadcastStates\(\s*signalHeaderPublishedStatesRef\.current,\s*candidateHeaderStates,\s*\);[\s\S]*signalHeaderPublishedStatesRef\.current = nextHeaderStates;[\s\S]*setSignalHeaderPublishedStates\(nextHeaderStates\)/s,
    "intermediate bootstrap pages and bookkeeping-only deltas must not replace the retained header projection",
  );
  assert.match(
    source,
    /if \(framePublication\.publishSnapshotStates\) \{\s*setSignalMatrixSnapshot\(nextSnapshot\);\s*\}/s,
    "the STA snapshot must not publish symbol-ordered partial bootstrap pages",
  );
  assert.match(
    source,
    /mergeSignalMatrixStreamSnapshot\(\{[\s\S]*coverage: nextCoverage,[\s\S]*skippedSymbols: nextSkippedSymbols,[\s\S]*truncated: nextTruncated/s,
  );
  assert.match(
    schedulerSource,
    /coverage: coverage \?\? currentSnapshot\.coverage \?\? null/,
  );
  assert.match(
    source,
    /if \(signalMatrixStreamUsesProfileUniverse\) return current;/,
  );
  assert.match(
    source,
    /streamProfileUniverse: signalMatrixStreamUsesProfileUniverse/,
  );
  assert.doesNotMatch(source, /signalMonitorStateQuery\.data\?\.states/);
  assert.doesNotMatch(
    source,
    /signalMonitorStateQuery\.data\?\.universeSymbols/,
  );
  assert.doesNotMatch(source, /lastSignalMonitorUniverseRef/);
  assert.match(
    source,
    /const headerSignalContextStates = useMemo\([\s\S]*retainEquivalentHeaderSignalContextStates\(\s*headerSignalContextStatesRef\.current,\s*signalHeaderPublishedStates,\s*\)[\s\S]*buildHeaderSignalContextSymbols\(\{\s*states:\s*headerSignalContextStates,\s*events:\s*signalMonitorEvents/s,
    "header symbol selection must ignore value changes that cannot alter context membership",
  );
  assert.equal(
    source.match(/buildHeaderSignalContextSymbols\(\{/g)?.length,
    1,
    "the same full signal universe must not be scanned twice for header context",
  );
  assert.equal(source.includes("headerBroadcastSignalContextSymbols"), false);
  assert.match(
    source,
    /resolveRecentSignalMarketDataSymbols\(signalMonitorPublishedStates\)/,
  );
  assert.match(
    source,
    /const signalMonitorStateBootstrapComplete = Boolean\([\s\S]*signalMatrixBootstrapComplete[\s\S]*signalMonitorPublishedStates\.length > 0[\s\S]*\);/,
  );
  assert.match(source, /signalMonitorState=\{null\}/);
  assert.match(source, /signalMonitorStateLoaded\s*\n/);
  assert.match(source, /signalMonitorStateLoading=\{false\}/);
  assert.match(source, /signalMonitorStateError=\{null\}/);
  assert.equal(
    source.match(/signalMatrixStates=\{signalMonitorPublishedStates\}/g)
      ?.length,
    1,
  );
  assert.match(source, /const headerBroadcastSignalMatrixStates = useMemo\(/);
  assert.match(source, /const watchlistSignalMonitorStates = useMemo\(/);
  assert.match(source, /const watchlistSignalMatrixStates = useMemo\(/);
  assert.match(
    source,
    /applyRuntimeSignalStatePrices\(\s*watchlistSignalMonitorStates,\s*activeWatchlist\?\.items,/,
  );
  assert.match(
    source,
    /const activitySignalMatrixStates = signalMonitorPublishedStates;/,
  );
  assert.equal(source.includes("activitySignalMatrixSymbols"), false);
  assert.equal(source.includes("symbols: activitySignalMatrixSymbols"), false);
  assert.match(source, /filterSignalMatrixStatesForSymbols\(\{/);
  assert.match(source, /signalMonitorStates=\{watchlistSignalMonitorStates\}/);
  assert.match(
    source,
    /watchlistSignalMatrixStates=\{signalMonitorPublishedStates\}/,
  );
  assert.match(
    source,
    /activitySignalMatrixStates=\{activitySignalMatrixStates\}/,
  );
  assert.equal(
    source.includes(
      "const headerBroadcastSignalMatrixStates = signalMonitorPublishedStates;",
    ),
    false,
  );
  assert.equal(
    shellSource.includes(
      "...(Array.isArray(signalMatrixStates) ? signalMatrixStates : [])",
    ),
    false,
  );
  assert.match(
    shellSource,
    /signalMatrixStates=\{watchlistSignalMatrixStates\}/,
  );
  assert.match(
    shellSource,
    /signalMatrixStates=\{activitySignalMatrixStates\}/,
  );
  assert.match(
    shellSource,
    /const explicitAlgoActivitySurfaceOpen = Boolean\(\s*activeScreen === "algo" \|\|\s*desktopActivitySidebarVisible \|\|[\s\S]*notificationsOpen,\s*\);/s,
  );
  assert.match(
    shellSource,
    /const algoMonitorSurfaceDataEnabled = Boolean\(\s*!criticalApiMutationPaused &&\s*!tradeScreenConnectionPriority &&\s*explicitAlgoActivitySurfaceOpen,?\s*\);/s,
  );
  assert.match(
    shellSource,
    /activeScreen === "algo" \|\|\s*desktopActivitySidebarVisible \|\|\s*mobileActivityVisible/,
  );
  assert.match(
    shellCallSource,
    /signalMonitorStates=\{watchlistSignalMonitorStates\}/,
  );
  assert.equal(
    shellCallSource.includes("signalMonitorStates={signalMonitorStates}"),
    false,
  );
  assert.equal(
    headerSource.includes(
      "headerSignalMatrixStates?.length ? headerSignalMatrixStates",
    ),
    false,
  );
  assert.match(headerSource, /signalMatrixStates=\{headerSignalMatrixStates\}/);
  assert.match(
    source,
    /publishSignalMonitorSnapshot\(\{[\s\S]*states: signalMonitorPublishedStates,[\s\S]*broadcastStates: headerBroadcastSignalMatrixStates,/s,
    "the global store must keep canonical states while the header subscribes to the bounded projection",
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

test("platform prioritizes signal matrix bootstrap ahead of market streams", () => {
  const source = readLocalSource("./PlatformApp.jsx");
  const routerSource = readLocalSource("./PlatformScreenRouter.jsx");
  const shellSource = readLocalSource("./PlatformShell.jsx");
  const algoScreenSource = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const algoSidebarSource = readLocalSource("./PlatformAlgoMonitorSidebar.jsx");
  const mobileActivitySource = readLocalSource("./MobileActivitySheet.jsx");

  assert.match(
    source,
    /const signalMatrixStreamPriorityGateActive = Boolean\(\s*signalMatrixStreamReady &&[\s\S]*?!signalMatrixStaBootstrapReceived &&[\s\S]*?signalMonitorProfile\?\.enabled !== false,/,
  );
  assert.match(
    source,
    /const signalMatrixAuxiliaryStreamGateReason =\s*signalMatrixStreamPriorityGateActive \? "signal-matrix-bootstrap" : null;/,
  );
  assert.match(
    source,
    /const runtimeStreamedQuoteSymbols = useMemo\(\s*\(\) => \[\.\.\.new Set\(streamedQuoteSymbols\)\]/,
  );
  assert.match(
    source,
    /const runtimeStreamedAggregateSymbols = useMemo\(\s*\(\) =>\s*\[\s*\.\.\.new Set\(\[\s*\.\.\.baseStreamedAggregateSymbols,[\s\S]*\.\.\.realtimeSignalAggregateUniverseSymbols,/,
  );
  assert.match(
    source,
    /quoteStreamRuntimeEnabled=\{\s*!safeQaMode && workSchedule\.streams\.watchlistQuoteStream/,
  );
  assert.match(
    source,
    /quoteStreamDisabledReason=\{quoteStreamGateReason\}/,
  );
  assert.match(
    source,
    /marketStockAggregateStreamingEnabled=\{\s*!safeQaMode && workSchedule\.streams\.marketStockAggregates/,
  );
  assert.match(
    source,
    /realtimeStreamGateReason=\{signalMatrixAuxiliaryStreamGateReason\}/,
  );
  assert.doesNotMatch(source, /signalMatrixMarketDataStreamGateReason/);
  assert.match(
    routerSource,
    /realtimeStreamGateReason = null,[\s\S]*<MemoAlgoScreen[\s\S]*realtimeStreamGateReason=\{realtimeStreamGateReason\}/,
  );
  assert.match(
    shellSource,
    /const tradeScreenConnectionPriority = activeScreen === "trade";[\s\S]*const algoFrameRuntimeEnabled = Boolean\(\s*frameAuxiliaryDataEnabled &&[\s\S]*!tradeScreenConnectionPriority &&[\s\S]*!criticalApiMutationPaused &&/,
  );
  assert.match(
    shellSource,
    /const explicitAlgoActivitySurfaceOpen = Boolean\(\s*activeScreen === "algo" \|\|\s*desktopActivitySidebarVisible \|\|[\s\S]*notificationsOpen,\s*\);/s,
  );
  assert.match(
    shellSource,
    /const algoMonitorSurfaceDataEnabled = Boolean\(\s*!criticalApiMutationPaused &&\s*!tradeScreenConnectionPriority &&/,
  );
  assert.doesNotMatch(shellSource, /shellAlgoRealtimeStreamsEnabled/);
  assert.doesNotMatch(shellSource, /useAlgoCockpitStream/);
  assert.doesNotMatch(shellSource, /externalStreamFreshness/);
  assert.match(
    shellSource,
    /const activitySidebarRealtimeStreamGateReason =\s*activeScreen === "algo"[\s\S]*\? "algo-screen-primary-stream"[\s\S]*tradeScreenConnectionPriority[\s\S]*\? "trade-chart-priority"[\s\S]*: realtimeStreamGateReason;/,
  );
  assert.match(
    shellSource,
    /<PlatformAlgoMonitorSidebar[\s\S]*realtimeStreamGateReason=\{activitySidebarRealtimeStreamGateReason\}/,
  );
  assert.match(
    mobileActivitySource,
    /<PlatformAlgoMonitorSidebar[\s\S]*realtimeStreamGateReason=\{realtimeStreamGateReason\}/,
  );
  assert.match(
    algoScreenSource,
    /const algoRealtimeStreamsEnabled = Boolean\(\s*algoLiveDataQueriesEnabled && !realtimeStreamGateReason,/,
  );
  assert.match(
    algoScreenSource,
    /useAlgoCockpitStream\(\{[\s\S]*enabled: algoRealtimeStreamsEnabled,/,
  );
  assert.match(
    algoScreenSource,
    /useShadowAccountSnapshotStream\(\{[\s\S]*enabled: algoRealtimeStreamsEnabled,/,
  );
  assert.match(
    algoSidebarSource,
    /const ownStreamEnabled = Boolean\(\s*queryEnabled &&[\s\S]*deploymentId &&[\s\S]*!realtimeStreamGateReason,?\s*\);[\s\S]*useAlgoCockpitStream\(\{[\s\S]*enabled: ownStreamEnabled,/,
  );
  assert.match(
    algoSidebarSource,
    /const registryFreshnessEnabled = Boolean\(\s*queryEnabled &&[\s\S]*deploymentId &&[\s\S]*realtimeStreamGateReason === "algo-screen-primary-stream",?\s*\);[\s\S]*useAlgoCockpitRegistryFreshness\(\s*deploymentId,\s*ALGO_COCKPIT_STREAM_FRESH_MS,\s*registryFreshnessEnabled,?\s*\)/,
  );
  assert.doesNotMatch(algoSidebarSource, /externalStreamFreshness/);
});

test("platform account discovery does not depend on a retired IBKR session payload", () => {
  const source = readLocalSource("./PlatformApp.jsx");

  assert.match(
    source,
    /const accountsReadyForBoot = Boolean\(sessionQuery\.data\);/,
  );
  assert.match(
    source,
    /const accountsQueryEnabled = Boolean\(\s*!safeQaMode && accountsReadyForBoot,/,
  );
  assert.doesNotMatch(source, /ibkrBridge|brokerAccountsReadyForBoot/);
});

test("watchlist sparklines hold the muted pending stroke until the row's signal state hydrates", () => {
  // Launch regression: runtime snapshots (price/spark bars) hydrate seconds
  // before the signal matrix/events. Rows fell through to MicroSparkline's
  // financial green/red trend default and flashed the old green style before
  // flipping to the signal-mapped blue/red. The gate must be PER ROW — the
  // matrix streams in symbol by symbol, so app-level "matrix delivered
  // something" evidence still let un-evaluated rows flash green mid-boot.
  const source = readLocalSource("./PlatformWatchlist.jsx");
  assert.match(source, /resolveSignalSparklineFallbackColor\(\{/);
  assert.match(source, /signalStateHydrated: rowSignalStateHydrated,/);
  // Row hydration evidence: a signal event for the symbol, or a matrix state
  // carrying evaluation timing for the symbol.
  assert.match(
    source,
    /const rowSignalStateHydrated =\s*signalEvents\.length > 0 \|\|\s*Object\.values\(signalStatesByTimeframe \|\| \{\}\)\.some\(/,
  );
  assert.match(
    source,
    /state\.latestBarAt \|\| state\.currentSignalAt \|\| state\.lastEvaluatedAt/,
  );
  // No-signal rows remain semantically neutral after hydration; they never
  // switch to the generic financial green/red price mode.
  assert.match(
    source,
    /: rowSignalStateHydrated\s*\?\s*"neutral"\s*:\s*"pending"/,
  );
  assert.doesNotMatch(source, /: rowSignalStateHydrated\s*\?\s*"price"/);
});
