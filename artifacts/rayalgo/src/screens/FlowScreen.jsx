import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGetNews } from "@workspace/api-client-react";
import { useMarketFlowSnapshot } from "../features/platform/marketFlowStore";
import {
  Badge,
  Card,
  CardTitle,
  ContractDetailInline,
  DataUnavailableState,
  OrderFlowDonut,
  Pill,
  SizeBucketRow,
  _initialState,
  bridgeRuntimeMessage,
  bridgeRuntimeTone,
  flowProviderColor,
  fmtCompactNumber,
  fmtM,
  formatExpirationLabel,
  formatRelativeTimeShort,
  isFiniteNumber,
  mapNewsSentimentToScore,
  normalizeTickerSymbol,
  persistState,
  useLiveMarketFlow,
} from "../RayAlgoPlatform";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";

const UNUSUAL_SCANNER_BATCH_SIZE = 30;
const UNUSUAL_SCANNER_PER_SYMBOL_LIMIT = 25;
const UNUSUAL_SCANNER_MAX_WATCHLIST = Number.POSITIVE_INFINITY;
const UNUSUAL_SCANNER_INTERVAL_MS = 15_000;
const UNUSUAL_SORT_OPTIONS = [
  { id: "ratio", label: "Vol/OI", numeric: true },
  { id: "premium", label: "Premium", numeric: true },
  { id: "dte", label: "DTE", numeric: true },
  { id: "underlying", label: "Underlying", numeric: false },
];
const FLOW_ROWS_OPTIONS = [24, 40, 60, 100];
const FLOW_TAPE_OPTIONAL_COLUMNS = Object.freeze([
  { id: "side", label: "SIDE", toggleLabel: "Side", width: "62px" },
  { id: "execution", label: "EXEC", toggleLabel: "Exec", width: "68px" },
  { id: "type", label: "TYPE", toggleLabel: "Type", width: "72px" },
  { id: "premium", label: "PREMIUM", toggleLabel: "Prem", width: "88px" },
  { id: "size", label: "SIZE", toggleLabel: "Size", width: "64px" },
  { id: "oi", label: "OI", toggleLabel: "OI", width: "64px" },
  { id: "ratio", label: "V/OI", toggleLabel: "V/OI", width: "60px" },
  { id: "dte", label: "DTE", toggleLabel: "DTE", width: "56px" },
  { id: "iv", label: "IV", toggleLabel: "IV", width: "62px" },
  { id: "score", label: "SCORE", toggleLabel: "Score", width: "54px" },
]);
const DEFAULT_FLOW_VISIBLE_COLUMNS = FLOW_TAPE_OPTIONAL_COLUMNS.map(
  (column) => column.id,
);

const parseTickerTokens = (value) =>
  Array.from(
    new Set(
      String(value || "")
        .split(/[\s,]+/)
        .map((token) => normalizeTickerSymbol(token))
        .filter(Boolean),
    ),
  );

const getFlowExecutionMeta = (event) => {
  const normalizedSide = String(event?.side || "").toUpperCase();
  if (normalizedSide === "BUY") {
    return {
      label: event?.type === "SWEEP" ? "ASK+" : "ASK",
      color: event?.cp === "P" ? T.red : T.green,
    };
  }
  if (normalizedSide === "SELL") {
    return {
      label: event?.type === "BLOCK" ? "BID" : "BID-",
      color: T.red,
    };
  }
  return { label: "MID", color: T.textDim };
};

const FlowLoadingBlock = ({
  width = "100%",
  height = dim(10),
  style = {},
}) => (
  <div
    style={{
      width,
      height,
      borderRadius: dim(3),
      background: `${T.border}70`,
      opacity: 0.65,
      ...style,
    }}
  />
);

const FlowPlaceholderCard = ({
  title = "Loading",
  rows = 4,
  dense = false,
}) => (
  <Card
    style={{
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      gap: sp(dense ? 4 : 6),
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: fs(10),
          fontWeight: 700,
          fontFamily: T.display,
          color: T.textSec,
        }}
      >
        {title}
      </span>
      <FlowLoadingBlock width={dim(56)} height={dim(8)} />
    </div>
    {Array.from({ length: rows }).map((_, index) => (
      <FlowLoadingBlock
        key={`${title}_${index}`}
        width={index === rows - 1 ? "72%" : "100%"}
        height={dense ? dim(12) : dim(16)}
      />
    ))}
  </Card>
);

const FlowOverviewPanel = ({
  onJumpToTrade,
  session,
  symbols = [],
  isVisible = false,
}) => {
  const [savedScans, setSavedScans] = useState(
    _initialState.flowSavedScans || [],
  );
  const [activeScanId, setActiveScanId] = useState(
    _initialState.flowActiveScanId || null,
  );
  const [filter, setFilter] = useState(_initialState.flowFilter || "all");
  const [minPrem, setMinPrem] = useState(
    Number.isFinite(_initialState.flowMinPrem) ? _initialState.flowMinPrem : 0,
  );
  const [sortBy, setSortBy] = useState(_initialState.flowSortBy || "time");
  const [selectedEvt, setSelectedEvt] = useState(null);
  const [includeQuery, setIncludeQuery] = useState(
    _initialState.flowIncludeQuery || "",
  );
  const [excludeQuery, setExcludeQuery] = useState(
    _initialState.flowExcludeQuery || "",
  );
  const [density, setDensity] = useState(
    _initialState.flowDensity || "compact",
  );
  const [rowsPerPage, setRowsPerPage] = useState(
    Number.isFinite(_initialState.flowRowsPerPage)
      ? _initialState.flowRowsPerPage
      : 40,
  );
  const [livePaused, setLivePaused] = useState(
    Boolean(_initialState.flowLivePaused),
  );
  const [showUnusualScanner, setShowUnusualScanner] = useState(
    Boolean(_initialState.flowShowUnusualScanner),
  );
  const [showDeferredPanels, setShowDeferredPanels] = useState(false);
  const [activateNews, setActivateNews] = useState(false);
  const [pausedSnapshot, setPausedSnapshot] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState(() =>
    Array.isArray(_initialState.flowVisibleColumns) &&
    _initialState.flowVisibleColumns.length
      ? _initialState.flowVisibleColumns.filter((columnId) =>
          DEFAULT_FLOW_VISIBLE_COLUMNS.includes(columnId),
        )
      : DEFAULT_FLOW_VISIBLE_COLUMNS,
  );

  useEffect(() => {
    persistState({ flowSavedScans: savedScans });
  }, [savedScans]);

  useEffect(() => {
    persistState({
      flowActiveScanId: activeScanId,
      flowFilter: filter,
      flowMinPrem: minPrem,
      flowSortBy: sortBy,
      flowIncludeQuery: includeQuery,
      flowExcludeQuery: excludeQuery,
      flowDensity: density,
      flowRowsPerPage: rowsPerPage,
      flowLivePaused: livePaused,
      flowShowUnusualScanner: showUnusualScanner,
      flowVisibleColumns: visibleColumns,
    });
  }, [
    activeScanId,
    density,
    excludeQuery,
    filter,
    includeQuery,
    livePaused,
    minPrem,
    rowsPerPage,
    showUnusualScanner,
    sortBy,
    visibleColumns,
  ]);

  useEffect(() => {
    if (!activeScanId) return;
    if (!savedScans.some((scan) => scan.id === activeScanId)) {
      setActiveScanId(null);
    }
  }, [activeScanId, savedScans]);

  useEffect(() => {
    if (!isVisible || showDeferredPanels) return undefined;
    let frameId = null;
    if (typeof requestAnimationFrame === "function") {
      frameId = requestAnimationFrame(() => setShowDeferredPanels(true));
      return () => cancelAnimationFrame(frameId);
    }
    const timeoutId = setTimeout(() => setShowDeferredPanels(true), 16);
    return () => clearTimeout(timeoutId);
  }, [isVisible, showDeferredPanels]);

  useEffect(() => {
    if (!isVisible || activateNews) return undefined;
    const timeoutId = setTimeout(() => setActivateNews(true), 450);
    return () => clearTimeout(timeoutId);
  }, [activateNews, isVisible]);

  const liveFlowSnapshot = useMarketFlowSnapshot(symbols, {
    subscribe: isVisible && !livePaused,
  });
  const flowSnapshot =
    livePaused && pausedSnapshot ? pausedSnapshot : liveFlowSnapshot;
  const {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
    flowTide,
    tickerFlow,
    flowClock,
    sectorFlow,
    dteBuckets,
    marketOrderFlow,
  } = flowSnapshot;

  const watchlistSymbols = useMemo(
    () =>
      Array.from(
        new Set((symbols || []).map((symbol) => normalizeTickerSymbol(symbol))),
      ).filter(Boolean),
    [symbols],
  );

  const coverage = providerSummary.coverage || {
    totalSymbols: watchlistSymbols.length,
    scannedSymbols: 0,
    batchSize: watchlistSymbols.length,
    currentBatch: [],
    cycle: 0,
    isFetching: false,
    lastScannedAt: {},
    isRotating: false,
  };
  const oldestScanAt = useMemo(() => {
    const timestamps = Object.values(coverage.lastScannedAt || {});
    return timestamps.length ? Math.min(...timestamps) : null;
  }, [coverage.lastScannedAt]);
  const newestScanAt = useMemo(() => {
    const timestamps = Object.values(coverage.lastScannedAt || {});
    return timestamps.length ? Math.max(...timestamps) : null;
  }, [coverage.lastScannedAt]);

  const newsQuery = useGetNews(
    { limit: 12 },
    {
      query: {
        enabled: isVisible && activateNews,
        staleTime: 60_000,
        refetchInterval:
          isVisible && activateNews && !livePaused ? 60_000 : false,
        retry: false,
      },
    },
  );
  const newsItems = useMemo(() => {
    const articles = newsQuery.data?.articles || [];
    return articles.map((article) => ({
      id: article.id,
      title: article.title,
      time: formatRelativeTimeShort(article.publishedAt),
      tag:
        article.tickers?.[0] ||
        article.publisher?.name?.slice(0, 8)?.toUpperCase() ||
        "NEWS",
      sentimentScore: mapNewsSentimentToScore(article.sentiment),
      articleUrl: article.articleUrl,
      publisher: article.publisher?.name || null,
      tickers: Array.isArray(article.tickers)
        ? article.tickers.map((ticker) => normalizeTickerSymbol(ticker))
        : [],
    }));
  }, [newsQuery.data]);

  const includeTokens = useMemo(() => parseTickerTokens(includeQuery), [
    includeQuery,
  ]);
  const excludeTokens = useMemo(() => parseTickerTokens(excludeQuery), [
    excludeQuery,
  ]);

  const clusters = useMemo(() => {
    const map = {};
    for (const event of flowEvents) {
      const key =
        event.optionTicker ||
        `${event.ticker}_${event.strike}_${event.cp}_${formatExpirationLabel(
          event.expirationDate,
        )}`;
      if (!map[key]) {
        map[key] = {
          count: 0,
          totalPrem: 0,
          ids: [],
          firstTime: event.time,
          lastTime: event.time,
        };
      }
      map[key].count += 1;
      map[key].totalPrem += event.premium;
      map[key].ids.push(event.id);
      if (event.time < map[key].firstTime) map[key].firstTime = event.time;
      if (event.time > map[key].lastTime) map[key].lastTime = event.time;
    }
    return map;
  }, [flowEvents]);

  const clusterFor = (event) => {
    const key =
      event.optionTicker ||
      `${event.ticker}_${event.strike}_${event.cp}_${formatExpirationLabel(
        event.expirationDate,
      )}`;
    const cluster = clusters[key];
    return cluster && cluster.count >= 2 ? cluster : null;
  };

  const topContractsByTicker = useMemo(() => {
    if (!showDeferredPanels) return {};
    const groupedByTicker = {};
    for (const event of flowEvents) {
      if (!groupedByTicker[event.ticker]) groupedByTicker[event.ticker] = {};
      const key =
        event.optionTicker ||
        `${event.strike}_${event.cp}_${formatExpirationLabel(
          event.expirationDate,
        )}`;
      if (!groupedByTicker[event.ticker][key]) {
        groupedByTicker[event.ticker][key] = {
          strike: event.strike,
          cp: event.cp,
          dte: event.dte,
          vol: 0,
          premium: 0,
          count: 0,
          biggestEvt: event,
        };
      }
      const entry = groupedByTicker[event.ticker][key];
      entry.vol += event.vol;
      entry.premium += event.premium;
      entry.count += 1;
      if (event.premium > entry.biggestEvt.premium) entry.biggestEvt = event;
    }

    return Object.fromEntries(
      Object.entries(groupedByTicker).map(([ticker, contracts]) => [
        ticker,
        Object.values(contracts)
          .sort((left, right) => right.vol - left.vol)
          .slice(0, 3),
      ]),
    );
  }, [flowEvents, showDeferredPanels]);

  const filtered = useMemo(() => {
    let events = flowEvents
      .filter((event) => {
        const ticker = normalizeTickerSymbol(event.ticker);
        if (includeTokens.length && !includeTokens.includes(ticker)) return false;
        if (excludeTokens.includes(ticker)) return false;
        if (filter === "calls") return event.cp === "C";
        if (filter === "puts") return event.cp === "P";
        if (filter === "unusual") return event.isUnusual;
        if (filter === "golden") return event.golden;
        if (filter === "sweep") return event.type === "SWEEP";
        if (filter === "block") return event.type === "BLOCK";
        if (filter === "cluster") return clusterFor(event) !== null;
        return true;
      })
      .filter((event) => event.premium >= minPrem);

    if (sortBy === "premium") {
      events = [...events].sort((left, right) => right.premium - left.premium);
    } else if (sortBy === "score") {
      events = [...events].sort((left, right) => right.score - left.score);
    } else if (sortBy === "ratio") {
      events = [...events].sort(
        (left, right) =>
          (right.unusualScore || 0) - (left.unusualScore || 0) ||
          right.premium - left.premium,
      );
    } else if (sortBy === "ticker") {
      events = [...events].sort((left, right) =>
        String(left.ticker || "").localeCompare(String(right.ticker || "")),
      );
    } else {
      events = [...events].sort(
        (left, right) =>
          Date.parse(right.occurredAt || 0) - Date.parse(left.occurredAt || 0),
      );
    }

    return events;
  }, [
    clusterFor,
    excludeTokens,
    filter,
    flowEvents,
    includeTokens,
    minPrem,
    sortBy,
  ]);

  const visibleFlowRows = filtered.slice(0, rowsPerPage);
  const denseRows = density === "compact";
  const tapeColumns = [
    { id: "time", label: "TIME", width: "56px" },
    { id: "ticker", label: "TICK", width: "66px" },
    { id: "contract", label: "CONTRACT", width: "minmax(170px, 1.8fr)" },
    ...FLOW_TAPE_OPTIONAL_COLUMNS.filter((column) =>
      visibleColumns.includes(column.id),
    ),
  ];
  const tapeGridTemplate = tapeColumns.map((column) => column.width).join(" ");

  const totalCallPrem = flowEvents
    .filter((event) => event.cp === "C")
    .reduce((sum, event) => sum + event.premium, 0);
  const totalPutPrem = flowEvents
    .filter((event) => event.cp === "P")
    .reduce((sum, event) => sum + event.premium, 0);
  const netPrem = totalCallPrem - totalPutPrem;
  const goldenCount = flowEvents.filter((event) => event.golden).length;
  const blockCount = flowEvents.filter((event) => event.type === "BLOCK").length;
  const sweepCount = flowEvents.filter((event) => event.type === "SWEEP").length;
  const zeroDteCount = flowEvents.filter((event) => event.dte <= 1).length;
  const zeroDtePrem = flowEvents
    .filter((event) => event.dte <= 1)
    .reduce((sum, event) => sum + event.premium, 0);
  const cpRatio = totalCallPrem ? totalPutPrem / totalCallPrem : 0;
  const mostActive =
    [...tickerFlow].sort(
      (left, right) => right.calls + right.puts - (left.calls + left.puts),
    )[0] || { sym: MISSING_VALUE, calls: 0, puts: 0 };

  const xlTrades = flowEvents.filter((event) => event.premium >= 250000);
  const xlCallPrem =
    xlTrades
      .filter((event) => event.cp === "C" && event.side === "BUY")
      .reduce((sum, event) => sum + event.premium, 0) -
    xlTrades
      .filter((event) => event.cp === "C" && event.side === "SELL")
      .reduce((sum, event) => sum + event.premium, 0);
  const xlPutPrem =
    xlTrades
      .filter((event) => event.cp === "P" && event.side === "BUY")
      .reduce((sum, event) => sum + event.premium, 0) -
    xlTrades
      .filter((event) => event.cp === "P" && event.side === "SELL")
      .reduce((sum, event) => sum + event.premium, 0);
  const xlNet = xlCallPrem - xlPutPrem;
  const xlTotalAbs = Math.abs(xlCallPrem) + Math.abs(xlPutPrem) || 1;
  const compassScore = Math.round((xlNet / xlTotalAbs) * 100);
  const compassVerdict =
    compassScore >= 50
      ? "BULLISH"
      : compassScore >= 20
        ? "LEAN BULL"
        : compassScore >= -20
          ? "NEUTRAL"
          : compassScore >= -50
            ? "LEAN BEAR"
            : "BEARISH";
  const compassColor =
    compassScore >= 20 ? T.green : compassScore >= -20 ? T.amber : T.red;

  const maxTickerPrem = Math.max(
    1,
    ...tickerFlow.map((ticker) => ticker.calls + ticker.puts),
  );
  const flowClockActiveBuckets = flowClock.filter((bucket) => bucket.count > 0);
  const flowClockPeak =
    flowClockActiveBuckets.reduce(
      (best, bucket) =>
        !best || bucket.count > best.count || bucket.prem > best.prem
          ? bucket
          : best,
      null,
    )?.time || MISSING_VALUE;
  const flowClockAverage = Math.round(
    flowEvents.length / Math.max(1, flowClock.length),
  );

  const bridgeTone = bridgeRuntimeTone(session);
  const ibkrLoginRequired =
    Boolean(session?.configured?.ibkr) &&
    !session?.ibkrBridge?.authenticated &&
    !providerSummary.providers.includes("polygon");
  const flowDisplayLabel =
    !hasLiveFlow && ibkrLoginRequired
      ? "IBKR login required"
      : providerSummary.label === "IBKR snapshot live" &&
          session?.ibkrBridge?.liveMarketDataAvailable === false
        ? "IBKR delayed"
        : providerSummary.label;
  const flowDisplayColor =
    !hasLiveFlow && ibkrLoginRequired
      ? T.amber
      : flowDisplayLabel === "IBKR delayed"
        ? T.amber
        : providerSummary.color;
  const feedStateLabel = livePaused
    ? "Paused"
    : hasLiveFlow
      ? "Live"
      : flowStatus === "loading"
        ? "Loading"
        : "Degraded";
  const feedStateColor = livePaused
    ? T.amber
    : hasLiveFlow
      ? T.green
      : flowStatus === "loading"
        ? T.accent
        : T.red;
  const emptyFlowDetail =
    flowStatus === "loading"
      ? "Waiting on current options activity snapshots for the tracked symbols."
      : ibkrLoginRequired
        ? bridgeRuntimeMessage(session)
        : providerSummary.erroredSource?.errorMessage
          ? providerSummary.erroredSource.errorMessage
          : providerSummary.failures[0]?.error
            ? providerSummary.failures[0].error
            : providerSummary.fallbackUsed
              ? "IBKR returned no active snapshot flow and the Polygon trade fallback was empty."
              : "IBKR returned no active snapshot flow for the tracked symbols.";

  const activeTicker = normalizeTickerSymbol(
    selectedEvt?.ticker ||
      filtered[0]?.ticker ||
      tickerFlow[0]?.sym ||
      flowEvents[0]?.ticker ||
      watchlistSymbols[0] ||
      "",
  );
  const selectedTickerEvents = useMemo(
    () =>
      flowEvents.filter(
        (event) => normalizeTickerSymbol(event.ticker) === activeTicker,
      ),
    [activeTicker, flowEvents],
  );
  const selectedCallPremium = selectedTickerEvents.reduce(
    (sum, event) => sum + (event.cp === "C" ? event.premium : 0),
    0,
  );
  const selectedPutPremium = selectedTickerEvents.reduce(
    (sum, event) => sum + (event.cp === "P" ? event.premium : 0),
    0,
  );
  const selectedTickerSummary = {
    totalPremium: selectedTickerEvents.reduce(
      (sum, event) => sum + event.premium,
      0,
    ),
    unusualCount: selectedTickerEvents.filter((event) => event.isUnusual).length,
    zeroDteCount: selectedTickerEvents.filter((event) => event.dte <= 1).length,
    latestEvent: selectedTickerEvents[0] || null,
  };

  const executionScope = selectedTickerEvents.length
    ? selectedTickerEvents
    : visibleFlowRows.length
      ? visibleFlowRows
      : filtered;
  const executionStats = useMemo(() => {
    if (!showDeferredPanels) {
      return {
        askCount: 0,
        askPrem: 0,
        bidCount: 0,
        bidPrem: 0,
        midCount: 0,
        midPrem: 0,
        sweepCount: 0,
        sweepPrem: 0,
        blockCount: 0,
        blockPrem: 0,
        snapshotCount: 0,
        tradeCount: 0,
        avgSize: null,
        topExpiration: MISSING_VALUE,
      };
    }
    const stats = {
      askCount: 0,
      askPrem: 0,
      bidCount: 0,
      bidPrem: 0,
      midCount: 0,
      midPrem: 0,
      sweepCount: 0,
      sweepPrem: 0,
      blockCount: 0,
      blockPrem: 0,
      snapshotCount: 0,
      tradeCount: 0,
      avgSize: null,
      topExpiration: MISSING_VALUE,
    };
    const expirationPremium = new Map();
    let totalSize = 0;
    let sizeCount = 0;

    for (const event of executionScope) {
      if (event.side === "BUY") {
        stats.askCount += 1;
        stats.askPrem += event.premium;
      } else if (event.side === "SELL") {
        stats.bidCount += 1;
        stats.bidPrem += event.premium;
      } else {
        stats.midCount += 1;
        stats.midPrem += event.premium;
      }

      if (event.type === "SWEEP") {
        stats.sweepCount += 1;
        stats.sweepPrem += event.premium;
      } else if (event.type === "BLOCK") {
        stats.blockCount += 1;
        stats.blockPrem += event.premium;
      }

      if (event.basis === "snapshot") stats.snapshotCount += 1;
      else stats.tradeCount += 1;

      if (isFiniteNumber(event.vol)) {
        totalSize += event.vol;
        sizeCount += 1;
      }

      const expirationLabel = formatExpirationLabel(event.expirationDate);
      expirationPremium.set(
        expirationLabel,
        (expirationPremium.get(expirationLabel) || 0) + event.premium,
      );
    }

    stats.avgSize = sizeCount ? totalSize / sizeCount : null;
    stats.topExpiration =
      [...expirationPremium.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ||
      MISSING_VALUE;
    return stats;
  }, [executionScope, showDeferredPanels]);

  const strikeConcentration = useMemo(() => {
    if (!showDeferredPanels) return [];
    const grouped = new Map();
    selectedTickerEvents.forEach((event) => {
      const key = `${event.cp}${event.strike}`;
      const entry = grouped.get(key) || {
        key,
        label: `${event.cp}${event.strike}`,
        premium: 0,
        count: 0,
        event,
      };
      entry.premium += event.premium;
      entry.count += 1;
      if (event.premium > entry.event.premium) entry.event = event;
      grouped.set(key, entry);
    });
    return Array.from(grouped.values())
      .sort((left, right) => right.premium - left.premium)
      .slice(0, 5);
  }, [selectedTickerEvents, showDeferredPanels]);

  const signalQueue = useMemo(
    () =>
      !showDeferredPanels
        ? []
        : flowEvents
        .map((event) => {
          const cluster = clusterFor(event);
          const actionScore =
            (event.golden ? 30 : 0) +
            (event.isUnusual ? 18 : 0) +
            (cluster ? Math.min(18, cluster.count * 4) : 0) +
            (event.type === "SWEEP" ? 12 : event.type === "BLOCK" ? 10 : 4) +
            (event.dte <= 1 ? 8 : event.dte <= 7 ? 4 : 0) +
            Math.min(24, event.premium / 100000) +
            Math.min(10, (event.unusualScore || 0) * 2);
          return { event, actionScore, cluster };
        })
        .sort(
          (left, right) =>
            right.actionScore - left.actionScore ||
            right.event.premium - left.event.premium,
        )
        .slice(0, 6),
    [flowEvents, clusters, showDeferredPanels],
  );

  const selectedNewsItems = useMemo(() => {
    if (!activateNews) return [];
    if (!newsItems.length) return [];
    const tickerMatches = activeTicker
      ? newsItems.filter((item) => item.tickers.includes(activeTicker))
      : [];
    return (tickerMatches.length ? tickerMatches : newsItems).slice(0, 5);
  }, [activateNews, activeTicker, newsItems]);

  const summaryCards = [
    {
      label: "Total Premium",
      value: fmtM(totalCallPrem + totalPutPrem),
      sub: `${flowEvents.length} prints`,
      color: T.text,
    },
    {
      label: "Net Premium",
      value: `${netPrem >= 0 ? "+" : "-"}${fmtM(Math.abs(netPrem))}`,
      sub: netPrem >= 0 ? "Bullish balance" : "Bearish balance",
      color: netPrem >= 0 ? T.green : T.red,
    },
    {
      label: "0DTE",
      value: zeroDteCount,
      sub: fmtM(zeroDtePrem),
      color: T.amber,
    },
    {
      label: "Golden",
      value: goldenCount,
      sub: `${sweepCount} sweeps · ${blockCount} blocks`,
      color: T.cyan,
    },
    {
      label: "Leader",
      value: mostActive.sym,
      sub: fmtM(mostActive.calls + mostActive.puts),
      color: T.purple,
    },
    {
      label: "Smart Money",
      value: compassVerdict,
      sub: `${compassScore >= 0 ? "+" : ""}${compassScore} bias`,
      color: compassColor,
    },
  ];

  const handleToggleLivePaused = () => {
    if (livePaused) {
      setLivePaused(false);
      setPausedSnapshot(null);
      return;
    }
    setPausedSnapshot(liveFlowSnapshot);
    setLivePaused(true);
  };

  const toggleColumn = (columnId) => {
    setVisibleColumns((current) => {
      if (current.includes(columnId)) {
        return current.length > 1
          ? current.filter((id) => id !== columnId)
          : current;
      }
      return [
        ...FLOW_TAPE_OPTIONAL_COLUMNS.map((column) => column.id).filter(
          (id) => current.includes(id) || id === columnId,
        ),
      ];
    });
    setActiveScanId(null);
  };

  const saveCurrentScan = () => {
    const name = prompt(
      "Name this scan:",
      filter === "golden"
        ? "Golden sweeps"
        : filter === "unusual"
          ? "Unusual flow"
          : includeTokens.length
            ? `${includeTokens.join(", ")} flow`
            : `${filter} ≥${Math.round(minPrem / 1000)}K`,
    );
    if (!name) return;
    const newScan = {
      id: Date.now(),
      name,
      filter,
      minPrem,
      sortBy,
      includeQuery,
      excludeQuery,
      density,
      rowsPerPage,
      visibleColumns,
    };
    setSavedScans((current) => [...current, newScan].slice(-8));
    setActiveScanId(newScan.id);
  };

  const loadScan = (scan) => {
    setFilter(scan.filter || "all");
    setMinPrem(Number.isFinite(scan.minPrem) ? scan.minPrem : 0);
    setSortBy(scan.sortBy || "time");
    setIncludeQuery(scan.includeQuery || "");
    setExcludeQuery(scan.excludeQuery || "");
    setDensity(scan.density || "compact");
    setRowsPerPage(
      Number.isFinite(scan.rowsPerPage) ? scan.rowsPerPage : rowsPerPage,
    );
    setVisibleColumns(
      Array.isArray(scan.visibleColumns) && scan.visibleColumns.length
        ? scan.visibleColumns.filter((columnId) =>
            DEFAULT_FLOW_VISIBLE_COLUMNS.includes(columnId),
          )
        : DEFAULT_FLOW_VISIBLE_COLUMNS,
    );
    setActiveScanId(scan.id);
  };

  const deleteScan = (id) => {
    setSavedScans((current) => current.filter((scan) => scan.id !== id));
    if (activeScanId === id) setActiveScanId(null);
  };

  const renderTapeCell = (columnId, event) => {
    const sideColor =
      event.side === "BUY" ? T.green : event.side === "SELL" ? T.red : T.textDim;
    const cpColor = event.cp === "C" ? T.green : T.red;
    const scoreColor =
      event.score >= 80 ? T.amber : event.score >= 60 ? T.green : T.textDim;
    const typeColor =
      event.type === "SWEEP"
        ? T.amber
        : event.type === "BLOCK"
          ? T.accent
          : T.purple;
    const executionMeta = getFlowExecutionMeta(event);
    const cluster = clusterFor(event);
    const volToOi =
      isFiniteNumber(event.vol) && isFiniteNumber(event.oi) && event.oi > 0
        ? event.vol / event.oi
        : null;
    const premiumLabel =
      event.premium >= 1e6
        ? `$${(event.premium / 1e6).toFixed(2)}M`
        : `$${(event.premium / 1e3).toFixed(0)}K`;

    if (columnId === "time") {
      return <span style={{ color: T.textDim }}>{event.time}</span>;
    }
    if (columnId === "ticker") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            fontWeight: 700,
            color: T.text,
          }}
        >
          {event.golden ? <span style={{ color: T.amber }}>★</span> : null}
          {event.ticker}
        </span>
      );
    }
    if (columnId === "contract") {
      return (
        <div
          style={{
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            flexWrap: denseRows ? "nowrap" : "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(3),
              minWidth: 0,
              color: T.textSec,
            }}
          >
            <span style={{ color: cpColor, fontWeight: 700 }}>{event.cp}</span>
            <span style={{ fontWeight: 600 }}>{event.strike}</span>
            <span style={{ color: T.textDim }}>
              {formatExpirationLabel(event.expirationDate)}
            </span>
          </span>
          {cluster ? (
            <span
              title={`${cluster.count} prints · ${fmtM(cluster.totalPrem)} total premium`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(2),
                padding: sp("0px 4px"),
                borderRadius: dim(2),
                border: `1px solid ${T.cyan}40`,
                background: `${T.cyan}14`,
                color: T.cyan,
                fontSize: fs(8),
                fontWeight: 700,
              }}
            >
              🔁 {cluster.count}
            </span>
          ) : null}
          <Badge color={flowProviderColor(event.provider)}>
            {event.sourceLabel}
          </Badge>
        </div>
      );
    }
    if (columnId === "side") {
      return <Badge color={sideColor}>{event.side}</Badge>;
    }
    if (columnId === "execution") {
      return <Badge color={executionMeta.color}>{executionMeta.label}</Badge>;
    }
    if (columnId === "type") {
      return <Badge color={typeColor}>{event.type}</Badge>;
    }
    if (columnId === "premium") {
      return (
        <span
          style={{
            textAlign: "right",
            color:
              event.premium > 250000
                ? T.amber
                : event.premium > 100000
                  ? T.text
                  : T.textSec,
            fontWeight: 700,
          }}
        >
          {premiumLabel}
        </span>
      );
    }
    if (columnId === "size") {
      return (
        <span style={{ textAlign: "right", color: T.textSec }}>
          {fmtCompactNumber(event.vol)}
        </span>
      );
    }
    if (columnId === "oi") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {fmtCompactNumber(event.oi)}
        </span>
      );
    }
    if (columnId === "ratio") {
      return (
        <span
          style={{
            textAlign: "right",
            color: isFiniteNumber(volToOi) && volToOi > 1 ? T.amber : T.textDim,
            fontWeight: isFiniteNumber(volToOi) && volToOi > 1 ? 700 : 400,
          }}
        >
          {isFiniteNumber(volToOi) ? volToOi.toFixed(2) : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "dte") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {Number.isFinite(event.dte) ? `${event.dte}d` : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "iv") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {isFiniteNumber(event.iv)
            ? `${(event.iv * 100).toFixed(1)}%`
            : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "score") {
      return (
        <span style={{ textAlign: "center" }}>
          <Badge color={scoreColor}>{event.score}</Badge>
        </span>
      );
    }
    return null;
  };

  const toolbarChipStyle = (active, accent = T.accent) => ({
    padding: sp("3px 7px"),
    fontSize: fs(8),
    fontFamily: T.mono,
    border: `1px solid ${active ? accent : T.border}`,
    background: active ? `${accent}18` : T.bg2,
    color: active ? accent : T.textDim,
    cursor: "pointer",
    borderRadius: dim(3),
  });

  const unusualScannerLauncher = (
    <Card
      style={{
        padding: "8px 10px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: sp(10),
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
          }}
        >
          Unusual Flow Scanner
        </span>
        <span
          style={{
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
          }}
        >
          This scanner runs a second broad-watchlist flow sweep. It is kept off on first load so the main Flow page opens from the shared snapshot instead of waiting on another heavy pass.
        </span>
      </div>
      <button
        type="button"
        onClick={() => setShowUnusualScanner((current) => !current)}
        style={{
          ...toolbarChipStyle(
            showUnusualScanner,
            showUnusualScanner ? T.amber : T.accent,
          ),
          minWidth: dim(150),
          color: showUnusualScanner ? T.amber : T.accent,
          borderColor: showUnusualScanner ? T.amber : T.accent,
        }}
      >
        {showUnusualScanner ? "Hide unusual scan" : "Load unusual scan"}
      </button>
    </Card>
  );

  const flowHeader = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: sp(8),
        padding: sp("2px 2px 0"),
        fontSize: fs(8),
        fontFamily: T.mono,
        color: T.textDim,
      }}
    >
      <span>
        Flow source ·{" "}
        <span style={{ color: flowDisplayColor, fontWeight: 700 }}>
          {flowDisplayLabel}
        </span>
        <span style={{ marginLeft: sp(8) }}>
          Coverage{" "}
          <span style={{ color: T.text, fontWeight: 700 }}>
            {coverage.scannedSymbols}/
            {watchlistSymbols.length || coverage.scannedSymbols}
          </span>
          {coverage.isRotating
            ? ` · rotating ${coverage.batchSize}/cycle`
            : " · full watchlist"}
          {newestScanAt
            ? ` · latest ${formatRelativeTimeShort(
                new Date(newestScanAt).toISOString(),
              )}`
            : ""}
        </span>
      </span>
      <span
        title={bridgeRuntimeMessage(session)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          color: bridgeTone.color,
        }}
      >
        <span
          style={{
            width: dim(6),
            height: dim(6),
            background: bridgeTone.color,
            display: "inline-block",
          }}
        />
        IBKR {bridgeTone.label.toUpperCase()}
      </span>
    </div>
  );
  const isFlowLoadingShell = flowStatus === "loading" && !flowEvents.length;
  const shouldRenderDeferredPanels = showDeferredPanels && !isFlowLoadingShell;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(8),
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {flowHeader}

        <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: sp(10),
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
              <span
                style={{
                  fontSize: fs(12),
                  fontWeight: 800,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Flow Scanner
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Tape-first live options flow with inline context and saved presets.
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(4),
                  padding: sp("2px 6px"),
                  borderRadius: dim(3),
                  border: `1px solid ${feedStateColor}30`,
                  background: `${feedStateColor}12`,
                  color: feedStateColor,
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  fontWeight: 700,
                }}
              >
                {feedStateLabel}
              </span>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                {filtered.length} / {flowEvents.length} shown
              </span>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr) auto",
              gap: sp(6),
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              Include tickers
              <input
                value={includeQuery}
                onChange={(event) => {
                  setIncludeQuery(event.target.value);
                  setActiveScanId(null);
                }}
                placeholder="SPY, QQQ, NVDA"
                style={{
                  width: "100%",
                  padding: sp("6px 8px"),
                  background: T.bg1,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  fontFamily: T.mono,
                  fontSize: fs(10),
                }}
              />
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              Exclude tickers
              <input
                value={excludeQuery}
                onChange={(event) => {
                  setExcludeQuery(event.target.value);
                  setActiveScanId(null);
                }}
                placeholder="AAPL, TSLA"
                style={{
                  width: "100%",
                  padding: sp("6px 8px"),
                  background: T.bg1,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  fontFamily: T.mono,
                  fontSize: fs(10),
                }}
              />
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                alignItems: "flex-end",
              }}
            >
              <button
                onClick={handleToggleLivePaused}
                style={{
                  ...toolbarChipStyle(livePaused, livePaused ? T.amber : T.green),
                  minWidth: dim(104),
                }}
              >
                {livePaused ? "Resume live" : "Pause tape"}
              </button>
              <button
                onClick={saveCurrentScan}
                style={{
                  ...toolbarChipStyle(false),
                  color: T.accent,
                  borderColor: T.accent,
                  minWidth: dim(104),
                }}
              >
                Save preset
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              FLOW
            </span>
            {[
              ["all", "All"],
              ["calls", "Calls"],
              ["puts", "Puts"],
              ["unusual", "Unusual"],
              ["golden", "Golden"],
              ["sweep", "Sweep"],
              ["block", "Block"],
              ["cluster", "Repeat"],
            ].map(([key, label]) => (
              <Pill
                key={key}
                active={filter === key}
                onClick={() => {
                  setFilter(key);
                  setActiveScanId(null);
                }}
                color={key === "golden" ? T.amber : key === "cluster" ? T.cyan : undefined}
              >
                {label}
              </Pill>
            ))}
            <span style={{ marginLeft: sp(8), fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              MIN
            </span>
            {[
              [0, "All"],
              [50000, "$50K"],
              [100000, "$100K"],
              [250000, "$250K"],
            ].map(([value, label]) => (
              <Pill
                key={value}
                active={minPrem === value}
                onClick={() => {
                  setMinPrem(value);
                  setActiveScanId(null);
                }}
              >
                {label}
              </Pill>
            ))}
            <span style={{ marginLeft: sp(8), fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              SORT
            </span>
            {[
              ["time", "Time"],
              ["premium", "Premium"],
              ["score", "Score"],
              ["ratio", "V/OI"],
              ["ticker", "Ticker"],
            ].map(([key, label]) => (
              <Pill
                key={key}
                active={sortBy === key}
                onClick={() => {
                  setSortBy(key);
                  setActiveScanId(null);
                }}
              >
                {label}
              </Pill>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              DENSITY
            </span>
            {[
              ["compact", "Compact"],
              ["comfortable", "Comfort"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setDensity(value);
                  setActiveScanId(null);
                }}
                style={toolbarChipStyle(density === value)}
              >
                {label}
              </button>
            ))}
            <span style={{ marginLeft: sp(8), fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              ROWS
            </span>
            {FLOW_ROWS_OPTIONS.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setRowsPerPage(value);
                  setActiveScanId(null);
                }}
                style={toolbarChipStyle(rowsPerPage === value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              COLUMNS
            </span>
            {FLOW_TAPE_OPTIONAL_COLUMNS.map((column) => (
              <button
                key={column.id}
                onClick={() => toggleColumn(column.id)}
                style={toolbarChipStyle(
                  visibleColumns.includes(column.id),
                  visibleColumns.includes(column.id) ? T.text : T.border,
                )}
              >
                {column.toggleLabel}
              </button>
            ))}
          </div>

          {savedScans.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                PRESETS
              </span>
              {savedScans.map((scan) => (
                <div
                  key={scan.id}
                  onClick={() => loadScan(scan)}
                  title={`${scan.name} · ${scan.filter} · ${scan.sortBy}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(3),
                    padding: sp("3px 7px"),
                    borderRadius: dim(3),
                    border: `1px solid ${activeScanId === scan.id ? T.accent : T.border}`,
                    background: activeScanId === scan.id ? `${T.accent}18` : T.bg1,
                    cursor: "pointer",
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    color: activeScanId === scan.id ? T.accent : T.textSec,
                  }}
                >
                  <span>{scan.name}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteScan(scan.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: T.textMuted,
                      cursor: "pointer",
                      fontSize: fs(10),
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.9fr) minmax(300px, 0.95fr)",
            gap: 6,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            {selectedEvt ? (
              <ContractDetailInline
                evt={selectedEvt}
                onBack={() => setSelectedEvt(null)}
                onJumpToTrade={(event) => {
                  setSelectedEvt(null);
                  onJumpToTrade?.(event);
                }}
              />
            ) : null}

            <Card
              noPad
              style={{
                minHeight: dim(460),
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: sp("8px 10px 6px"),
                  borderBottom: `1px solid ${T.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: sp(10),
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
                  <span
                    style={{
                      fontSize: fs(11),
                      fontWeight: 700,
                      fontFamily: T.display,
                      color: T.text,
                    }}
                  >
                    Live Flow Tape
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.mono,
                    }}
                  >
                    {isFlowLoadingShell
                      ? "warming flow feed"
                      : `${activeTicker || "Market-wide"} · ${visibleFlowRows.length} visible rows${filtered.length > rowsPerPage ? ` · capped at ${rowsPerPage}` : ""}`}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: sp(8),
                    flexWrap: "wrap",
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    color: T.textDim,
                  }}
                >
                  <span>
                    Bull premium{" "}
                    <span style={{ color: T.green, fontWeight: 700 }}>
                      {fmtM(totalCallPrem)}
                    </span>
                  </span>
                  <span>
                    Bear premium{" "}
                    <span style={{ color: T.red, fontWeight: 700 }}>
                      {fmtM(totalPutPrem)}
                    </span>
                  </span>
                  <span>
                    Unusual{" "}
                    <span style={{ color: T.amber, fontWeight: 700 }}>
                      {flowEvents.filter((event) => event.isUnusual).length}
                    </span>
                  </span>
                </div>
              </div>

              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: tapeGridTemplate,
                    padding: sp("6px 10px"),
                    fontSize: fs(8),
                    fontWeight: 700,
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    borderBottom: `1px solid ${T.border}`,
                    gap: sp(4),
                    flexShrink: 0,
                    fontFamily: T.mono,
                  }}
                >
                  {tapeColumns.map((column) => (
                    <span
                      key={column.id}
                      style={{
                        textAlign:
                          column.id === "premium" ||
                          column.id === "size" ||
                          column.id === "oi" ||
                          column.id === "ratio" ||
                          column.id === "dte" ||
                          column.id === "iv"
                            ? "right"
                            : column.id === "score"
                              ? "center"
                              : "left",
                      }}
                    >
                      {column.label}
                    </span>
                  ))}
                </div>

                {isFlowLoadingShell ? (
                  <div style={{ flex: 1, overflowY: "auto" }}>
                    {Array.from({ length: rowsPerPage }).map((_, rowIndex) => (
                      <div
                        key={`tape_placeholder_${rowIndex}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: tapeGridTemplate,
                          padding: denseRows ? sp("4px 10px") : sp("7px 10px"),
                          gap: sp(4),
                          alignItems: "center",
                          borderBottom: `1px solid ${T.border}15`,
                        }}
                      >
                        {tapeColumns.map((column, columnIndex) => (
                          <FlowLoadingBlock
                            key={`${column.id}_${rowIndex}`}
                            width={
                              column.id === "contract"
                                ? columnIndex % 2 === 0
                                  ? "92%"
                                  : "78%"
                                : "70%"
                            }
                            height={denseRows ? dim(11) : dim(14)}
                            style={{
                              justifySelf:
                                column.id === "premium" ||
                                column.id === "size" ||
                                column.id === "oi" ||
                                column.id === "ratio" ||
                                column.id === "dte" ||
                                column.id === "iv"
                                  ? "end"
                                  : column.id === "score"
                                    ? "center"
                                    : "start",
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : filtered.length ? (
                <>
                  <div style={{ flex: 1, overflowY: "auto" }}>
                    {visibleFlowRows.map((event) => {
                      const selected = selectedEvt?.id === event.id;
                      return (
                        <div
                          key={event.id}
                          onClick={() =>
                            setSelectedEvt((previous) =>
                              previous?.id === event.id ? null : event,
                            )
                          }
                          onDoubleClick={() => onJumpToTrade?.(event)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: tapeGridTemplate,
                            padding: denseRows ? sp("4px 10px") : sp("7px 10px"),
                            fontSize: denseRows ? fs(9) : fs(10),
                            fontFamily: T.mono,
                            gap: sp(4),
                            alignItems: "center",
                            borderBottom: `1px solid ${T.border}15`,
                            background: selected
                              ? `${T.accent}12`
                              : event.golden
                                ? `${T.amber}0f`
                                : "transparent",
                            borderLeft: selected
                              ? `2px solid ${T.accent}`
                              : event.golden
                                ? `2px solid ${T.amber}`
                                : "2px solid transparent",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(entry) => {
                            if (!selected) {
                              entry.currentTarget.style.background = event.golden
                                ? `${T.amber}18`
                                : T.bg2;
                            }
                          }}
                          onMouseLeave={(entry) => {
                            entry.currentTarget.style.background = selected
                              ? `${T.accent}12`
                              : event.golden
                                ? `${T.amber}0f`
                                : "transparent";
                          }}
                        >
                          {tapeColumns.map((column) => (
                            <div key={`${event.id}_${column.id}`} style={{ minWidth: 0 }}>
                              {renderTapeCell(column.id, event)}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {filtered.length > rowsPerPage ? (
                    <div
                      style={{
                        padding: sp("6px 10px"),
                        borderTop: `1px solid ${T.border}`,
                        fontSize: fs(8),
                        color: T.textDim,
                        fontFamily: T.mono,
                      }}
                    >
                      Showing the first {rowsPerPage} matching prints. Narrow the scanner
                      or increase row count to inspect more.
                    </div>
                  ) : null}
                </>
                ) : (
                <div style={{ padding: sp(12) }}>
                  <DataUnavailableState
                    title={
                      flowEvents.length
                        ? "No prints match this scanner"
                        : "No live options activity"
                    }
                    detail={
                      flowEvents.length
                        ? "Adjust include/exclude tickers, minimum premium, or flow-type filters to widen the tape."
                        : emptyFlowDetail
                    }
                  />
                </div>
                )}
              </>
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            {shouldRenderDeferredPanels ? (
              <>
                <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
              <CardTitle
                right={
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.mono,
                    }}
                  >
                    {activeTicker || "No ticker"}
                  </span>
                }
              >
                Signal Context
              </CardTitle>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: sp(6),
                }}
              >
                {[
                  {
                    label: "Total premium",
                    value: fmtM(selectedTickerSummary.totalPremium),
                    color: T.text,
                  },
                  {
                    label: "Call / put",
                    value: `${fmtM(selectedCallPremium)} / ${fmtM(selectedPutPremium)}`,
                    color: selectedCallPremium >= selectedPutPremium ? T.green : T.red,
                  },
                  {
                    label: "Unusual",
                    value: selectedTickerSummary.unusualCount,
                    color: T.amber,
                  },
                  {
                    label: "0DTE",
                    value: selectedTickerSummary.zeroDteCount,
                    color: T.cyan,
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    style={{
                      border: `1px solid ${T.border}`,
                      background: T.bg1,
                      padding: sp("6px 8px"),
                    }}
                  >
                    <div
                      style={{
                        fontSize: fs(7),
                        fontFamily: T.mono,
                        color: T.textDim,
                        marginBottom: sp(2),
                      }}
                    >
                      {metric.label.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: fs(11),
                        fontWeight: 800,
                        color: metric.color,
                        fontFamily: T.mono,
                      }}
                    >
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>
                  {selectedEvt ? (
                    <div
                      style={{
                        padding: sp("8px 9px"),
                        border: `1px solid ${T.border}`,
                        background: T.bg1,
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(4),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: sp(6),
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(11),
                            fontWeight: 700,
                            fontFamily: T.mono,
                            color: T.text,
                          }}
                        >
                          {selectedEvt.ticker} {selectedEvt.cp}
                          {selectedEvt.strike}
                        </span>
                        <Badge color={getFlowExecutionMeta(selectedEvt).color}>
                          {getFlowExecutionMeta(selectedEvt).label}
                        </Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: sp(4),
                          flexWrap: "wrap",
                        }}
                      >
                        <Badge color={selectedEvt.cp === "C" ? T.green : T.red}>
                          {selectedEvt.side}
                        </Badge>
                        <Badge color={flowProviderColor(selectedEvt.provider)}>
                          {selectedEvt.sourceLabel}
                        </Badge>
                        <Badge color={selectedEvt.type === "SWEEP" ? T.amber : T.accent}>
                          {selectedEvt.type}
                        </Badge>
                        <Badge
                          color={
                            selectedEvt.score >= 80
                              ? T.amber
                              : selectedEvt.score >= 60
                                ? T.green
                                : T.textDim
                          }
                        >
                          {selectedEvt.score}
                        </Badge>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJumpToTrade?.(selectedEvt)}
                        style={{
                          ...toolbarChipStyle(false, T.accent),
                          alignSelf: "flex-start",
                          color: T.accent,
                        }}
                      >
                        Open in Trade
                      </button>
                    </div>
                  ) : null}
                </Card>

                <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
              <CardTitle>Execution Stats</CardTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: sp(6) }}>
                {[
                  { label: "Ask / buy", value: executionStats.askCount, sub: fmtM(executionStats.askPrem), color: T.green },
                  { label: "Bid / sell", value: executionStats.bidCount, sub: fmtM(executionStats.bidPrem), color: T.red },
                  { label: "Mid / other", value: executionStats.midCount, sub: fmtM(executionStats.midPrem), color: T.textDim },
                ].map((metric) => (
                  <div key={metric.label} style={{ padding: sp("6px 7px"), background: T.bg1, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>{metric.label.toUpperCase()}</div>
                    <div style={{ fontSize: fs(12), fontWeight: 800, fontFamily: T.mono, color: metric.color, marginTop: sp(1) }}>{metric.value}</div>
                    <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>{metric.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: sp(6) }}>
                <div style={{ padding: sp("6px 7px"), background: T.bg1, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>SWEEP / BLOCK</div>
                  <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>
                    {executionStats.sweepCount} / {executionStats.blockCount}
                  </div>
                  <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    {fmtM(executionStats.sweepPrem)} / {fmtM(executionStats.blockPrem)}
                  </div>
                </div>
                <div style={{ padding: sp("6px 7px"), background: T.bg1, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>AVG SIZE / TOP EXP</div>
                  <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>
                    {isFiniteNumber(executionStats.avgSize)
                      ? fmtCompactNumber(executionStats.avgSize)
                      : MISSING_VALUE}
                  </div>
                  <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    {executionStats.topExpiration}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                Basis mix · trade {executionStats.tradeCount} · snapshot {executionStats.snapshotCount}
              </div>
                </Card>

                <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(5) }}>
              <CardTitle
                right={
                  <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    ranked
                  </span>
                }
              >
                Why It Matters
              </CardTitle>
                  {signalQueue.map(({ event, actionScore, cluster }) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEvt(event)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: T.bg1,
                        border: `1px solid ${selectedEvt?.id === event.id ? T.accent : T.border}`,
                        padding: sp("7px 8px"),
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(3),
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: sp(6) }}>
                        <span style={{ fontSize: fs(10), fontWeight: 800, fontFamily: T.mono, color: T.text }}>
                          {event.ticker} {event.cp}
                          {event.strike}
                        </span>
                        <span style={{ fontSize: fs(8), fontFamily: T.mono, color: T.amber, fontWeight: 700 }}>
                          {actionScore.toFixed(0)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                        <Badge color={getFlowExecutionMeta(event).color}>
                          {getFlowExecutionMeta(event).label}
                        </Badge>
                        <Badge color={event.type === "SWEEP" ? T.amber : T.accent}>
                          {event.type}
                        </Badge>
                        {event.isUnusual ? <Badge color={T.cyan}>VOL/OI</Badge> : null}
                        {cluster ? <Badge color={T.cyan}>Repeat {cluster.count}×</Badge> : null}
                      </div>
                      <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                        {fmtM(event.premium)} · {event.time} ET · {event.dte}d
                      </div>
                    </button>
                  ))}
                </Card>

                <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
              <CardTitle
                right={
                  <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    {activeTicker || "market"}
                  </span>
                }
              >
                Catalyst Context
              </CardTitle>
                  {activateNews ? (
                    selectedNewsItems.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
                        {selectedNewsItems.map((item) => (
                          <a
                            key={item.id}
                            href={item.articleUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: sp(2),
                              padding: sp("6px 7px"),
                              textDecoration: "none",
                              color: T.text,
                              background: T.bg1,
                              border: `1px solid ${T.border}`,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: sp(6) }}>
                              <span style={{ fontSize: fs(8), fontFamily: T.mono, color: T.textDim }}>
                                {item.tag}
                              </span>
                              <span
                                style={{
                                  fontSize: fs(8),
                                  fontFamily: T.mono,
                                  color:
                                    item.sentimentScore > 0
                                      ? T.green
                                      : item.sentimentScore < 0
                                        ? T.red
                                        : T.textDim,
                                }}
                              >
                                {item.time}
                              </span>
                            </div>
                            <span style={{ fontSize: fs(10), lineHeight: 1.35 }}>{item.title}</span>
                            {item.publisher ? (
                              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                                {item.publisher}
                              </span>
                            ) : null}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <DataUnavailableState
                        title="No recent catalysts"
                        detail="Recent market news will appear here and anchor to the selected ticker when a symbol match exists."
                      />
                    )
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
                      <FlowLoadingBlock width="40%" />
                      <FlowLoadingBlock height={dim(14)} />
                      <FlowLoadingBlock height={dim(14)} width="88%" />
                      <FlowLoadingBlock height={dim(14)} width="76%" />
                    </div>
                  )}
              <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                {[
                  { label: "News", value: "Live", color: T.green },
                  { label: "Dark pool", value: "Not wired", color: T.textDim },
                  { label: "Insider", value: "Not wired", color: T.textDim },
                ].map((item) => (
                  <span
                    key={item.label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: sp(3),
                      padding: sp("2px 6px"),
                      borderRadius: dim(3),
                      background: `${item.color}12`,
                      border: `1px solid ${item.color}25`,
                      color: item.color,
                      fontSize: fs(8),
                      fontFamily: T.mono,
                    }}
                  >
                    {item.label} · {item.value}
                  </span>
                ))}
              </div>
                </Card>

                <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
              <CardTitle>Strike + Sector Map</CardTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                {strikeConcentration.length ? (
                  strikeConcentration.map((strike) => (
                    <div
                      key={strike.key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: sp(6),
                        padding: sp("5px 6px"),
                        background: T.bg1,
                        border: `1px solid ${T.border}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: fs(9),
                          fontWeight: 700,
                          fontFamily: T.mono,
                          color: strike.event.cp === "C" ? T.green : T.red,
                        }}
                      >
                        {strike.label}
                      </span>
                      <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                        {strike.count} prints · {fmtM(strike.premium)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    No strike concentration yet for the selected ticker.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                {sectorFlow.slice(0, 4).map((sector) => {
                  const total = sector.calls + sector.puts;
                  const bullish = sector.calls - sector.puts;
                  const callPct = total ? (sector.calls / total) * 100 : 50;
                  return (
                    <div key={sector.sector} style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(8), fontFamily: T.mono }}>
                        <span style={{ color: T.text }}>{sector.sector}</span>
                        <span style={{ color: bullish >= 0 ? T.green : T.red }}>
                          {bullish >= 0 ? "+" : "-"}
                          {fmtM(Math.abs(bullish))}
                        </span>
                      </div>
                      <div style={{ display: "flex", height: dim(6), overflow: "hidden", background: T.bg3 }}>
                        <div style={{ width: `${callPct}%`, background: T.green }} />
                        <div style={{ flex: 1, background: T.red }} />
                      </div>
                    </div>
                  );
                })}
              </div>
                </Card>
              </>
            ) : (
              <>
                <FlowPlaceholderCard title="Signal Context" rows={4} />
                <FlowPlaceholderCard title="Execution Stats" rows={4} />
                <FlowPlaceholderCard title="Why It Matters" rows={4} />
                <FlowPlaceholderCard title="Catalyst Context" rows={4} />
                <FlowPlaceholderCard title="Strike + Sector Map" rows={5} />
              </>
            )}
          </div>
        </div>

        {shouldRenderDeferredPanels ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                gap: 6,
              }}
            >
              {summaryCards.map((card) => (
                <Card key={card.label} style={{ padding: "6px 9px" }}>
                  <div
                    style={{
                      fontSize: fs(7),
                      fontWeight: 600,
                      color: T.textDim,
                      letterSpacing: "0.06em",
                      fontVariant: "all-small-caps",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: fs(16),
                      fontWeight: 800,
                      fontFamily: T.mono,
                      color: card.color,
                      marginTop: sp(2),
                    }}
                  >
                    {card.value}
                  </div>
                  <div
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.sans,
                      marginTop: sp(1),
                    }}
                  >
                    {card.sub}
                  </div>
                </Card>
              ))}
            </div>
            <div
              style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 6 }}
            >
              <div
                style={{
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(6),
                  padding: sp("8px 10px"),
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: fs(10),
                      fontWeight: 700,
                      fontFamily: T.display,
                      color: T.textSec,
                    }}
                  >
                    Premium Tide
                  </span>
                  <div
                    style={{
                      display: "flex",
                      gap: sp(8),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.green }}>■ Calls {fmtM(totalCallPrem)}</span>
                    <span style={{ color: T.red }}>■ Puts {fmtM(totalPutPrem)}</span>
                    <span style={{ color: T.accent, fontWeight: 700 }}>
                      Net {netPrem >= 0 ? "+" : ""}
                      {fmtM(Math.abs(netPrem))}
                    </span>
                  </div>
                </div>
                <div style={{ height: dim(200), width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={flowTide}>
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: fs(9), fill: T.textMuted }}
                      />
                      <YAxis
                        tick={{ fontSize: fs(9), fill: T.textMuted }}
                        tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: T.bg4,
                          border: `1px solid ${T.border}`,
                          borderRadius: dim(6),
                          fontSize: fs(10),
                          fontFamily: T.mono,
                        }}
                        formatter={(value) =>
                          `${value >= 0 ? "+" : ""}$${(value / 1e6).toFixed(2)}M`
                        }
                      />
                      <ReferenceLine
                        y={0}
                        stroke={T.textMuted}
                        strokeDasharray="2 2"
                      />
                      <Area
                        type="monotone"
                        dataKey="cumNet"
                        stroke={T.accent}
                        strokeWidth={2}
                        fill={T.accent}
                        fillOpacity={0.4}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <Card style={{ padding: "8px 10px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: fs(10),
                      fontWeight: 700,
                      fontFamily: T.display,
                      color: T.textSec,
                    }}
                  >
                    Ticker Leaders
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.mono,
                    }}
                  >
                    top contracts inline
                  </span>
                </div>
                {tickerFlow.map((ticker) => {
                  const total = ticker.calls + ticker.puts;
                  const net = ticker.calls - ticker.puts;
                  const callPct = total ? (ticker.calls / total) * 100 : 50;
                  const barWidth = (total / maxTickerPrem) * 100;
                  const topContracts = topContractsByTicker[ticker.sym] || [];
                  return (
                    <div
                      key={ticker.sym}
                      style={{
                        marginBottom: sp(6),
                        paddingBottom: sp(4),
                        borderBottom: `1px solid ${T.border}30`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: fs(9),
                          fontFamily: T.mono,
                          marginBottom: sp(1),
                        }}
                      >
                        <span style={{ fontWeight: 700, color: T.text }}>
                          {ticker.sym}
                        </span>
                        <span
                          style={{
                            color: net >= 0 ? T.green : T.red,
                            fontWeight: 600,
                          }}
                        >
                          {net >= 0 ? "+" : "-"}
                          {fmtM(Math.abs(net))}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: dim(8),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                          width: `${barWidth}%`,
                          marginBottom: sp(3),
                        }}
                      >
                        <div
                          style={{
                            width: `${callPct}%`,
                            background: T.green,
                            height: "100%",
                          }}
                        />
                        <div style={{ flex: 1, background: T.red, height: "100%" }} />
                      </div>
                      {topContracts.length ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, 1fr)",
                            gap: sp(3),
                          }}
                        >
                          {topContracts.map((contract) => {
                            const cpColor = contract.cp === "C" ? T.green : T.red;
                            const volLabel =
                              contract.vol >= 1000
                                ? `${(contract.vol / 1000).toFixed(1)}K`
                                : `${contract.vol}`;
                            return (
                              <div
                                key={`${ticker.sym}_${contract.cp}_${contract.strike}`}
                                onClick={() => setSelectedEvt(contract.biggestEvt)}
                                title={`${ticker.sym} ${contract.strike}${contract.cp} · ${fmtM(contract.premium)}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: sp(4),
                                  padding: sp("4px 6px"),
                                  background: `${cpColor}08`,
                                  border: `1px solid ${cpColor}30`,
                                  borderLeft: `2px solid ${cpColor}`,
                                  cursor: "pointer",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: fs(10),
                                    fontWeight: 800,
                                    fontFamily: T.mono,
                                    color: cpColor,
                                  }}
                                >
                                  {contract.cp}
                                  {contract.strike}
                                </span>
                                <div
                                  style={{
                                    flex: 1,
                                    display: "flex",
                                    justifyContent: "space-between",
                                    fontSize: fs(8),
                                    fontFamily: T.mono,
                                    color: T.textDim,
                                  }}
                                >
                                  <span>{volLabel}</span>
                                  <span>{contract.dte}d</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </Card>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 6,
              }}
            >
              <div
                style={{
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(6),
                  padding: "6px 10px",
                }}
              >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Flow Clock
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                activity by time
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: sp(2),
                height: dim(72),
                padding: "0 2px",
              }}
            >
              {flowClock.map((bucket, index) => {
                const maxCount = Math.max(...flowClock.map((item) => item.count), 1);
                const heightPct = (bucket.count / maxCount) * 100;
                const color =
                  bucket.prem > 1500000
                    ? T.amber
                    : bucket.prem > 1000000
                      ? T.accent
                      : T.textDim;
                return (
                  <div
                    key={index}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        height: `${heightPct}%`,
                        background: color,
                        borderRadius: "2px 2px 0 0",
                        minHeight: 2,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: fs(7),
                color: T.textMuted,
                fontFamily: T.mono,
                marginTop: sp(2),
                padding: "0 2px",
              }}
            >
              <span>9:30</span>
              <span>12:00</span>
              <span>16:00</span>
            </div>
            <div
              style={{
                marginTop: sp(2),
                padding: sp("3px 6px"),
                background: T.bg3,
                borderRadius: dim(3),
                fontSize: fs(8),
                fontFamily: T.mono,
                color: T.textDim,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                Peak{" "}
                <span style={{ color: T.amber, fontWeight: 600 }}>
                  {flowClockPeak}
                </span>
              </span>
              <span>
                Avg{" "}
                <span style={{ color: T.textSec, fontWeight: 600 }}>
                  {flowClockAverage}/30m
                </span>
              </span>
            </div>
          </div>

          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Order Flow
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                by trade size
              </span>
            </div>
            {(() => {
              const buy =
                marketOrderFlow.buyXL +
                marketOrderFlow.buyL +
                marketOrderFlow.buyM +
                marketOrderFlow.buyS;
              const sell =
                marketOrderFlow.sellXL +
                marketOrderFlow.sellL +
                marketOrderFlow.sellM +
                marketOrderFlow.sellS;
              const buyPct = buy + sell ? (buy / (buy + sell)) * 100 : 50;
              const maxValue = Math.max(
                marketOrderFlow.buyXL,
                marketOrderFlow.buyL,
                marketOrderFlow.buyM,
                marketOrderFlow.buyS,
                marketOrderFlow.sellXL,
                marketOrderFlow.sellL,
                marketOrderFlow.sellM,
                marketOrderFlow.sellS,
                1,
              );
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(8),
                      marginBottom: sp(2),
                    }}
                  >
                    <OrderFlowDonut
                      flow={marketOrderFlow}
                      size={dim(64)}
                      thickness={dim(10)}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(2),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontFamily: T.mono,
                          fontSize: fs(10),
                        }}
                      >
                        <span style={{ color: T.green, fontWeight: 700 }}>
                          ${buy.toFixed(0)}M
                        </span>
                        <span style={{ color: T.red, fontWeight: 700 }}>
                          ${sell.toFixed(0)}M
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: dim(4),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: T.green,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: T.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textDim,
                          fontFamily: T.mono,
                        }}
                      >
                        {buyPct.toFixed(1)}% buy ·{" "}
                        <span
                          style={{
                            color: buy >= sell ? T.green : T.red,
                            fontWeight: 600,
                          }}
                        >
                          {buy >= sell ? "BULLISH" : "BEARISH"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: sp(2),
                    }}
                  >
                    <SizeBucketRow
                      label="XL"
                      buy={marketOrderFlow.buyXL}
                      sell={marketOrderFlow.sellXL}
                      maxValue={maxValue}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={marketOrderFlow.buyL}
                      sell={marketOrderFlow.sellL}
                      maxValue={maxValue}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={marketOrderFlow.buyM}
                      sell={marketOrderFlow.sellM}
                      maxValue={maxValue}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={marketOrderFlow.buyS}
                      sell={marketOrderFlow.sellS}
                      maxValue={maxValue}
                    />
                  </div>
                </>
              );
            })()}
          </div>

          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Expiration Buckets
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                calls vs puts
              </span>
            </div>
            <div>
              {dteBuckets.map((bucket) => {
                const total = bucket.calls + bucket.puts;
                const callPct = total ? (bucket.calls / total) * 100 : 50;
                const maxTotal = Math.max(
                  1,
                  ...dteBuckets.map((item) => item.calls + item.puts),
                );
                const barWidth = (total / maxTotal) * 100;
                return (
                  <div key={bucket.bucket} style={{ marginBottom: 2 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: fs(8),
                        fontFamily: T.mono,
                        marginBottom: 1,
                      }}
                    >
                      <span style={{ color: T.textSec, fontWeight: 600 }}>
                        {bucket.bucket === "0DTE" ? (
                          <span style={{ color: T.amber, marginRight: 3 }}>⚡</span>
                        ) : null}
                        {bucket.bucket}
                      </span>
                      <span style={{ color: T.textDim }}>
                        {bucket.count} prints · {fmtM(total)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        height: dim(7),
                        borderRadius: dim(2),
                        overflow: "hidden",
                        background: T.bg3,
                        width: `${barWidth}%`,
                      }}
                    >
                      <div
                        style={{
                          width: `${callPct}%`,
                          background: T.green,
                          opacity: 0.85,
                        }}
                      />
                      <div style={{ flex: 1, background: T.red, opacity: 0.85 }} />
                    </div>
                  </div>
                );
              })}
            </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                gap: 6,
              }}
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <FlowPlaceholderCard key={`summary_${index}`} title="Loading" rows={2} dense />
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 6 }}>
              <FlowPlaceholderCard title="Premium Tide" rows={6} />
              <FlowPlaceholderCard title="Ticker Leaders" rows={6} />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 6,
              }}
            >
              <FlowPlaceholderCard title="Flow Clock" rows={5} />
              <FlowPlaceholderCard title="Order Flow" rows={5} />
              <FlowPlaceholderCard title="Expiration Buckets" rows={5} />
            </div>
          </>
        )}

        {unusualScannerLauncher}
        {showUnusualScanner ? (
          <UnusualScannerSection
            onJumpToTrade={onJumpToTrade}
            session={session}
            symbols={symbols}
            isVisible={isVisible}
          />
        ) : null}
      </div>
    </div>
  );
};

const UnusualScannerSection = ({
  onJumpToTrade,
  session,
  symbols = [],
  isVisible = false,
}) => {
  const [sortBy, setSortBy] = useState(
    () =>
      _initialState.flowUnusualSortBy || _initialState.unusualSortBy || "ratio",
  );
  const [sortDir, setSortDir] = useState(
    () =>
      _initialState.flowUnusualSortDir || _initialState.unusualSortDir || "desc",
  );
  const [sideFilter, setSideFilter] = useState(
    () =>
      _initialState.flowUnusualSideFilter ||
      _initialState.unusualSideFilter ||
      "all",
  );

  useEffect(() => {
    persistState({
      flowUnusualSortBy: sortBy,
      flowUnusualSortDir: sortDir,
      flowUnusualSideFilter: sideFilter,
    });
  }, [sideFilter, sortBy, sortDir]);

  const {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
  } = useLiveMarketFlow(symbols, {
    enabled: Boolean(session) && isVisible,
    limit: UNUSUAL_SCANNER_PER_SYMBOL_LIMIT,
    maxSymbols: UNUSUAL_SCANNER_MAX_WATCHLIST,
    batchSize: UNUSUAL_SCANNER_BATCH_SIZE,
    intervalMs: UNUSUAL_SCANNER_INTERVAL_MS,
  });

  const watchlistSymbols = useMemo(
    () =>
      [
        ...new Set(
          (symbols || [])
            .map((symbol) => symbol?.toUpperCase())
            .filter(Boolean),
        ),
      ],
    [symbols],
  );
  const totalWatchlistSymbols = watchlistSymbols.length;
  const coverage = providerSummary.coverage || {
    totalSymbols: totalWatchlistSymbols,
    scannedSymbols: 0,
    batchSize: UNUSUAL_SCANNER_BATCH_SIZE,
    currentBatch: [],
    cycle: 0,
    isFetching: false,
    lastScannedAt: {},
    isRotating: totalWatchlistSymbols > UNUSUAL_SCANNER_BATCH_SIZE,
  };
  const oldestScanAt = useMemo(() => {
    const stamps = Object.values(coverage.lastScannedAt || {});
    if (!stamps.length) return null;
    return Math.min(...stamps);
  }, [coverage.lastScannedAt]);
  const newestScanAt = useMemo(() => {
    const stamps = Object.values(coverage.lastScannedAt || {});
    if (!stamps.length) return null;
    return Math.max(...stamps);
  }, [coverage.lastScannedAt]);

  const unusualEvents = useMemo(
    () => flowEvents.filter((event) => event.isUnusual),
    [flowEvents],
  );

  const filteredEvents = useMemo(() => {
    if (sideFilter === "calls") {
      return unusualEvents.filter((event) => event.cp === "C");
    }
    if (sideFilter === "puts") {
      return unusualEvents.filter((event) => event.cp === "P");
    }
    return unusualEvents;
  }, [sideFilter, unusualEvents]);

  const sortedEvents = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    const events = [...filteredEvents];
    events.sort((left, right) => {
      let cmp = 0;
      if (sortBy === "ratio") {
        cmp = (left.unusualScore || 0) - (right.unusualScore || 0);
      } else if (sortBy === "premium") {
        cmp = (left.premium || 0) - (right.premium || 0);
      } else if (sortBy === "dte") {
        const leftDte = Number.isFinite(left.dte) ? left.dte : Infinity;
        const rightDte = Number.isFinite(right.dte) ? right.dte : Infinity;
        cmp = leftDte - rightDte;
      } else if (sortBy === "underlying") {
        cmp = String(left.ticker || "").localeCompare(String(right.ticker || ""));
      }
      if (cmp === 0) {
        cmp = (left.premium || 0) - (right.premium || 0);
      }
      return cmp * direction;
    });
    return events;
  }, [filteredEvents, sortBy, sortDir]);

  const totalPremium = unusualEvents.reduce(
    (sum, event) => sum + (event.premium || 0),
    0,
  );
  const callPremium = unusualEvents.reduce(
    (sum, event) => sum + (event.cp === "C" ? event.premium || 0 : 0),
    0,
  );
  const putPremium = unusualEvents.reduce(
    (sum, event) => sum + (event.cp === "P" ? event.premium || 0 : 0),
    0,
  );
  const uniqueUnderlyings = useMemo(
    () => new Set(unusualEvents.map((event) => event.ticker)).size,
    [unusualEvents],
  );
  const peakRatio = unusualEvents.reduce(
    (best, event) => Math.max(best, event.unusualScore || 0),
    0,
  );

  const bridgeTone = bridgeRuntimeTone(session);
  const ibkrLoginRequired =
    Boolean(session?.configured?.ibkr) &&
    !session?.ibkrBridge?.authenticated &&
    !providerSummary.providers.includes("polygon");
  const flowDisplayLabel =
    !hasLiveFlow && ibkrLoginRequired
      ? "IBKR login required"
      : providerSummary.label === "IBKR snapshot live" &&
          session?.ibkrBridge?.liveMarketDataAvailable === false
        ? "IBKR delayed"
        : providerSummary.label;
  const flowDisplayColor =
    !hasLiveFlow && ibkrLoginRequired
      ? T.amber
      : flowDisplayLabel === "IBKR delayed"
        ? T.amber
        : providerSummary.color;

  const handleSort = (id) => {
    if (sortBy === id) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(id);
    const option = UNUSUAL_SORT_OPTIONS.find((candidate) => candidate.id === id);
    setSortDir(option && !option.numeric ? "asc" : "desc");
  };

  const sortIndicator = (id) =>
    sortBy === id ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const emptyDetail =
    flowStatus === "loading"
      ? "Scanning the watchlist for contracts where today's volume already exceeds open interest."
      : ibkrLoginRequired
        ? bridgeRuntimeMessage(session)
        : providerSummary.failures[0]?.error
          ? providerSummary.failures[0].error
          : !flowEvents.length
            ? "No live options flow returned for the watchlist symbols yet."
            : "No contracts in the current watchlist have volume above open interest right now.";

  const headerBar = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: sp(8),
        padding: sp("2px 2px 0"),
        fontSize: fs(8),
        fontFamily: T.mono,
        color: T.textDim,
      }}
    >
      <span>
        Flow source ·{" "}
        <span style={{ color: flowDisplayColor, fontWeight: 700 }}>
          {flowDisplayLabel}
        </span>
        <span style={{ marginLeft: sp(8) }}>
          Coverage{" "}
          <span style={{ color: T.text, fontWeight: 700 }}>
            {coverage.scannedSymbols}/{totalWatchlistSymbols || coverage.scannedSymbols}
          </span>{" "}
          watchlist symbols
          {coverage.isRotating ? (
            <span style={{ marginLeft: sp(6), color: T.textMuted }}>
              · rotating {coverage.batchSize}/cycle
              {coverage.currentBatch?.length
                ? ` · scanning ${coverage.currentBatch[0]}${coverage.currentBatch.length > 1 ? `–${coverage.currentBatch[coverage.currentBatch.length - 1]}` : ""}`
                : ""}
            </span>
          ) : null}
          {newestScanAt ? (
            <span
              style={{ marginLeft: sp(6), color: T.textMuted }}
              title={
                oldestScanAt
                  ? `Oldest scan: ${new Date(oldestScanAt).toLocaleTimeString()} · Newest scan: ${new Date(newestScanAt).toLocaleTimeString()}`
                  : undefined
              }
            >
              · newest scan {formatRelativeTimeShort(new Date(newestScanAt).toISOString())}
              {coverage.isRotating && oldestScanAt && oldestScanAt !== newestScanAt
                ? ` · oldest ${formatRelativeTimeShort(new Date(oldestScanAt).toISOString())}`
                : ""}
            </span>
          ) : null}
        </span>
      </span>
      <span
        title={bridgeRuntimeMessage(session)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          color: bridgeTone.color,
        }}
      >
        <span
          style={{
            width: dim(6),
            height: dim(6),
            background: bridgeTone.color,
            display: "inline-block",
          }}
        />
        IBKR {bridgeTone.label.toUpperCase()}
      </span>
    </div>
  );

  const kpiCards = [
    {
      label: "UNUSUAL CONTRACTS",
      value: unusualEvents.length,
      sub: `${uniqueUnderlyings} underlying${uniqueUnderlyings === 1 ? "" : "s"}`,
      color: T.amber,
    },
    {
      label: "TOTAL PREMIUM",
      value: fmtM(totalPremium),
      sub: `${fmtM(callPremium)} C · ${fmtM(putPremium)} P`,
      color: T.text,
    },
    {
      label: "PEAK VOL/OI",
      value: peakRatio ? `${peakRatio.toFixed(peakRatio >= 10 ? 0 : 1)}×` : MISSING_VALUE,
      sub: "Highest ratio in scan",
      color: T.cyan,
    },
    {
      label: "CALL / PUT MIX",
      value: `${unusualEvents.filter((event) => event.cp === "C").length} / ${unusualEvents.filter((event) => event.cp === "P").length}`,
      sub: "Calls vs puts",
      color: T.purple,
    },
  ];

  return (
    <>
      <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(6),
        padding: "0 2px",
      }}
    >
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
            letterSpacing: "0.02em",
          }}
        >
          Unusual Flow Scanner
        </span>
        <div style={{ flex: 1, height: dim(1), background: T.border }} />
        <span
          style={{
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
          }}
        >
          broad watchlist rotation
        </span>
      </div>

      {headerBar}

      {watchlistSymbols.length > 0 ? (
        <Card style={{ padding: "6px 9px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: sp(8),
              marginBottom: sp(4),
            }}
          >
            <span
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                letterSpacing: "0.06em",
                fontVariant: "all-small-caps",
                fontWeight: 700,
              }}
            >
              Symbol Coverage
            </span>
            <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>
              {coverage.scannedSymbols}/{watchlistSymbols.length} scanned
              {coverage.cycle ? ` · cycle ${coverage.cycle}` : ""}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: sp(4),
              maxHeight: dim(96),
              overflowY: "auto",
            }}
          >
            {watchlistSymbols.map((symbol) => {
              const scannedAt = coverage.lastScannedAt?.[symbol] || null;
              const inFlight = coverage.currentBatch?.includes(symbol);
              const stale =
                scannedAt &&
                oldestScanAt &&
                newestScanAt &&
                newestScanAt - scannedAt > 60_000;
              const tone = inFlight
                ? T.accent
                : !scannedAt
                  ? T.textMuted
                  : stale
                    ? T.amber
                    : T.text;
              const labelText = scannedAt
                ? formatRelativeTimeShort(new Date(scannedAt).toISOString())
                : "pending";
              const tooltip = scannedAt
                ? `${symbol} · last scanned ${new Date(scannedAt).toLocaleTimeString()}`
                : `${symbol} · not yet scanned`;
              return (
                <span
                  key={symbol}
                  title={tooltip}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(3),
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    padding: sp("1px 5px"),
                    border: `1px solid ${tone}30`,
                    background: `${tone}12`,
                    color: tone,
                    borderRadius: dim(2),
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{symbol}</span>
                  <span style={{ color: T.textMuted }}>·</span>
                  <span>{inFlight ? "scanning…" : labelText}</span>
                </span>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
        }}
      >
        {kpiCards.map((card) => (
          <Card key={card.label} style={{ padding: "5px 9px" }}>
            <div
              style={{
                fontSize: fs(7),
                fontWeight: 600,
                color: T.textDim,
                letterSpacing: "0.06em",
                fontVariant: "all-small-caps",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: fs(18),
                fontWeight: 800,
                fontFamily: T.mono,
                color: card.color,
                marginTop: sp(2),
                lineHeight: 1,
              }}
            >
              {card.value}
            </div>
            <div
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.sans,
                marginTop: sp(1),
                lineHeight: 1,
              }}
            >
              {card.sub}
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
        <CardTitle
          right={
            <span
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              {sortedEvents.length} of {unusualEvents.length} shown
            </span>
          }
        >
          Unusual Flow Scanner
        </CardTitle>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(4),
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              marginRight: sp(4),
            }}
          >
            SIDE
          </span>
          {[
            { id: "all", label: "All" },
            { id: "calls", label: "Calls" },
            { id: "puts", label: "Puts" },
          ].map((option) => (
            <Pill
              key={option.id}
              active={sideFilter === option.id}
              onClick={() => setSideFilter(option.id)}
            >
              {option.label}
            </Pill>
          ))}
          <span
            style={{
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              marginLeft: sp(8),
              marginRight: sp(4),
            }}
          >
            SORT
          </span>
          {UNUSUAL_SORT_OPTIONS.map((option) => (
            <Pill
              key={option.id}
              active={sortBy === option.id}
              onClick={() => handleSort(option.id)}
            >
              {option.label}
              {sortIndicator(option.id)}
            </Pill>
          ))}
        </div>

        {sortedEvents.length ? (
          <div
            style={{
              border: `1px solid ${T.border}`,
              background: T.bg0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "60px minmax(0, 1.6fr) 60px 70px 70px 80px 90px 60px 70px",
                gap: sp(6),
                padding: sp("6px 8px"),
                background: T.bg2,
                borderBottom: `1px solid ${T.border}`,
                fontSize: fs(8),
                fontWeight: 700,
                color: T.textDim,
                fontFamily: T.mono,
                letterSpacing: "0.05em",
              }}
            >
              <span
                onClick={() => handleSort("underlying")}
                style={{ cursor: "pointer" }}
              >
                TICKER{sortIndicator("underlying")}
              </span>
              <span>CONTRACT</span>
              <span
                onClick={() => handleSort("dte")}
                style={{ cursor: "pointer", textAlign: "right" }}
              >
                DTE{sortIndicator("dte")}
              </span>
              <span style={{ textAlign: "right" }}>VOL</span>
              <span style={{ textAlign: "right" }}>OI</span>
              <span
                onClick={() => handleSort("ratio")}
                style={{ cursor: "pointer", textAlign: "right" }}
              >
                VOL/OI{sortIndicator("ratio")}
              </span>
              <span
                onClick={() => handleSort("premium")}
                style={{ cursor: "pointer", textAlign: "right" }}
              >
                PREMIUM{sortIndicator("premium")}
              </span>
              <span style={{ textAlign: "right" }}>SIDE</span>
              <span style={{ textAlign: "right" }}>TIME</span>
            </div>
            <div style={{ maxHeight: dim(520), overflowY: "auto" }}>
              {sortedEvents.map((event) => {
                const ratio = event.unusualScore || 0;
                const sideColor =
                  event.side === "BUY"
                    ? event.cp === "C"
                      ? T.green
                      : T.red
                    : event.side === "SELL"
                      ? T.textSec
                      : T.textDim;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onJumpToTrade?.(event)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns:
                        "60px minmax(0, 1.6fr) 60px 70px 70px 80px 90px 60px 70px",
                      gap: sp(6),
                      padding: sp("6px 8px"),
                      background: T.bg0,
                      border: "none",
                      borderBottom: `1px solid ${T.border}55`,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: T.mono,
                      fontSize: fs(10),
                      color: T.text,
                    }}
                    onMouseEnter={(entry) => {
                      entry.currentTarget.style.background = T.bg2;
                    }}
                    onMouseLeave={(entry) => {
                      entry.currentTarget.style.background = T.bg0;
                    }}
                    title="Open underlying chart and option chain"
                  >
                    <span style={{ fontWeight: 800 }}>{event.ticker}</span>
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: T.textSec,
                      }}
                    >
                      <span style={{ color: event.cp === "C" ? T.green : T.red, fontWeight: 700 }}>
                        {event.cp}
                      </span>{" "}
                      {event.strike}{" "}
                      <span style={{ color: T.textDim }}>
                        {formatExpirationLabel(event.expirationDate)}
                      </span>
                    </span>
                    <span style={{ textAlign: "right", color: T.textSec }}>
                      {Number.isFinite(event.dte) ? event.dte : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      {Number.isFinite(event.vol) ? event.vol.toLocaleString() : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "right", color: T.textSec }}>
                      {Number.isFinite(event.oi) ? event.oi.toLocaleString() : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: T.amber,
                        fontWeight: 800,
                      }}
                    >
                      {ratio ? `${ratio.toFixed(ratio >= 10 ? 0 : 1)}×` : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: T.text,
                        fontWeight: 700,
                      }}
                    >
                      {fmtM(event.premium)}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: sideColor,
                        fontWeight: 700,
                      }}
                    >
                      {event.side}
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {event.time}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <DataUnavailableState
            title="No unusual options activity"
            detail={emptyDetail}
          />
        )}
      </Card>
    </>
  );
};

export const FlowScreen = ({
  onJumpToTrade,
  session,
  symbols = [],
  isVisible = false,
}) => (
  <FlowOverviewPanel
    onJumpToTrade={onJumpToTrade}
    session={session}
    symbols={symbols}
    isVisible={isVisible}
  />
);

export default FlowScreen;
