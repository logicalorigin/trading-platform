import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  memo,
  useRef,
  useState,
} from "react";
import {
  batchOptionChains as batchOptionChainsRequest,
  getOptionChain as getOptionChainRequest,
  listFlowEvents as listFlowEventsRequest,
  useGetOptionExpirations,
  useGetQuoteSnapshots,
  useListOrders,
  useListPositions,
} from "@workspace/api-client-react";
import {
  getStoredOptionQuoteSnapshot,
  useStoredOptionQuoteSnapshot,
  useIbkrOptionQuoteStream,
  useIbkrQuoteSnapshotStream,
} from "../features/platform/live-streams";
import {
  getChartBarLimit,
  getChartTimeframeDefinition,
  getChartTimeframeOptions,
  getInitialChartBarLimit,
} from "../features/charting/timeframes";
import { RayReplicaSettingsMenu } from "../features/charting/RayReplicaSettingsMenu";
import { ResearchChartFrame } from "../features/charting/ResearchChartFrame";
import {
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
  ResearchChartWidgetSidebar,
} from "../features/charting/ResearchChartWidgetChrome";
import {
  filterFlowEventsForOptionContract,
  filterFlowEventsForSymbol,
  flowEventsToChartEventConversion,
  getChartEventLookbackWindow,
  mergeFlowEventFeeds,
} from "../features/charting/chartEvents";
import { recordChartBarScopeState } from "../features/charting/chartHydrationStats";
import { resolveSpotChartFrameLayout } from "../features/charting/spotChartFrameLayout";
import { useDrawingHistory } from "../features/charting/useDrawingHistory";
import { useIndicatorLibrary } from "../features/charting/pineScripts";
import {
  RAY_REPLICA_PINE_SCRIPT_KEY,
  resolveRayReplicaRuntimeSettings,
} from "../features/charting/rayReplicaPineAdapter";
import {
  buildChartBarScopeKey,
  useDebouncedVisibleRangeExpansion,
  useMeasuredChartModel,
  useProgressiveChartBarLimit,
  useUnderfilledChartBackfill,
} from "../features/charting/chartHydrationRuntime";
import {
  clearTradeOptionChainSnapshot,
  getTradeOptionChainSnapshot,
  publishTradeOptionChainSnapshot,
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../features/platform/tradeOptionChainStore";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  filterFlowEventsForChartDisplay,
  useFlowTapeFilterState,
} from "../features/platform/flowFilterStore";
import {
  recordOptionHydrationMetric,
  setOptionHydrationDiagnostics,
} from "../features/platform/optionHydrationDiagnostics";
import {
  OPTION_CHART_BARS_QUERY_DEFAULTS,
  useOptionChartBars,
} from "../features/charting/useOptionChartBars.js";
import { resolveOptionChartSourceState } from "../features/charting/chartApiBars.js";
import {
  TradeEquityPanel,
  TradeL2Panel,
  TradeOrderTicket,
  TradePositionsPanel,
} from "../features/trade/TradePanels.jsx";
import { MiniChartTickerSearch } from "../features/platform/tickerSearch/TickerSearch.jsx";
import { mapFlowEventToUi } from "../features/flow/flowEventMapper";
import { TradeStrategyGreeksPanel } from "../features/trade/TradeStrategyGreeksPanel.jsx";
import {
  TickerTabStrip,
  TradeTickerHeader,
} from "../features/trade/TradeWorkspaceChrome.jsx";
import { useChartTimeframeFavorites } from "../features/charting/useChartTimeframeFavorites";
import {
  ensureTradeTickerInfo,
  publishRuntimeTickerSnapshot,
} from "../features/platform/runtimeTickerStore";
import {
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
} from "../features/platform/queryDefaults";
import {
  usePositions,
  useToast,
} from "../features/platform/platformContexts.jsx";
import { _initialState, persistState } from "../lib/workspaceState";
import {
  daysToExpiration,
  formatExpirationLabel,
  formatOptionContractLabel,
  formatRelativeTimeShort,
  getAtmStrikeFromPrice,
  isFiniteNumber,
  parseExpirationValue,
} from "../lib/formatters";
import { TradeChainPanel } from "../features/trade/TradeChainPanel";
import {
  buildOptionChainRowsFromApi,
  patchOptionChainRowWithQuoteGetter,
} from "../features/trade/optionChainRows";
import {
  OPTION_CHAIN_AUTO_BATCH_ENABLED,
  OPTION_CHAIN_BATCH_ACTIVE_CHUNKS,
  DEFAULT_OPTION_CHAIN_COVERAGE,
  OPTION_CHAIN_COVERAGE_VALUES,
  OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY,
  OPTION_CHAIN_FULL_STRIKE_COVERAGE,
  OPTION_CHAIN_METADATA_HYDRATION,
  getExpirationChainKey,
  normalizeTradeOptionChainCoverage,
  resolveTradeOptionChainHydrationPlan,
} from "../features/trade/optionChainLoadingPlan";
import {
  buildTradeOptionQuoteSubscriptionPlan,
} from "../features/trade/optionQuoteHydrationPlan";
import {
  clearTradeFlowSnapshot,
  publishTradeFlowSnapshot,
  useTradeFlowSnapshot,
} from "../features/platform/tradeFlowStore";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "../features/platform/marketFlowStore";
import { normalizeFlowOptionExpirationIso } from "../features/platform/flowOptionChartIdentity";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  getCurrentTheme,
  sp,
} from "../lib/uiTokens";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import {
  motionRowStyle,
  motionVars,
} from "../lib/motion";
import { isOpenPositionRow } from "../features/account/accountPositionRows.js";
import { AppTooltip } from "@/components/ui/tooltip";


const OPTION_CHAIN_QUERY_DEFAULTS = {
  staleTime: 5 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: 1,
  gcTime: 5 * 60_000,
};

const OPTION_EXPIRATION_QUERY_DEFAULTS = {
  ...OPTION_CHAIN_QUERY_DEFAULTS,
  staleTime: 5 * 60_000,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: false,
};

const TRADE_OPTION_CHART_TIMEFRAME = "1m";
const TRADE_OPTION_CHART_TIMEFRAME_OPTIONS = getChartTimeframeOptions("option");
const TRADE_OPTION_INDICATOR_PRESET_VERSION = 1;
const TRADE_OPTION_CHART_FRAME_LAYOUT = resolveSpotChartFrameLayout(false);
const DEFAULT_TRADE_OPTION_STUDIES = [RAY_REPLICA_PINE_SCRIPT_KEY];
export const TRADE_RECENT_TICKER_LIMIT = 16;

const normalizeIndicatorSelection = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  return source.filter((indicatorId) => {
    if (typeof indicatorId !== "string" || !indicatorId.trim()) {
      return false;
    }
    if (seen.has(indicatorId)) {
      return false;
    }
    seen.add(indicatorId);
    return true;
  });
};

const mergeIndicatorSelections = (...selections) =>
  normalizeIndicatorSelection(selections.flat(), []);

const resolvePersistedIndicatorPreset = ({
  indicators,
  defaults,
  persistedVersion,
  currentVersion,
}) => {
  const normalized = normalizeIndicatorSelection(indicators, defaults);
  return persistedVersion === currentVersion
    ? normalized
    : mergeIndicatorSelections(defaults, normalized);
};

const resolvePersistedRayReplicaSettings = (value) =>
  resolveRayReplicaRuntimeSettings(
    value && typeof value === "object" ? value : undefined,
  );

const buildRayReplicaIndicatorSettings = (settings) => ({
  [RAY_REPLICA_PINE_SCRIPT_KEY]: settings,
});

const isRayReplicaIndicatorSelected = (selectedIndicators = []) =>
  selectedIndicators.includes(RAY_REPLICA_PINE_SCRIPT_KEY);

const createTradeWorkspace = (ticker, patch = {}) => {
  const normalized = normalizeTradeTickerSymbol(ticker);
  const now = new Date().toISOString();
  return {
    id: normalized,
    ticker: normalized,
    updatedAt: now,
    selectedContract: {
      strike: null,
      cp: "C",
      exp: "",
      providerContractId: null,
    },
    equityChart: {
      timeframe: "5m",
      studies: [],
      rayReplicaSettings: null,
    },
    optionChart: {
      timeframe: TRADE_OPTION_CHART_TIMEFRAME,
      studies: [],
      rayReplicaSettings: null,
    },
    notes: {
      thesis: "",
      invalidation: "",
      target: "",
      stop: "",
      tags: [],
    },
    levels: [],
    orderDraft: null,
    chainHeatmapEnabled: false,
    ...patch,
  };
};

const normalizeTradeWorkspaces = ({ recentTickers = [], contracts = {}, stored = {} } = {}) => {
  const next = {};
  const sourceTickers = [
    ...new Set([
      ...Object.keys(stored || {}),
      ...recentTickers,
      ...Object.keys(contracts || {}),
    ].map(normalizeTradeTickerSymbol).filter(Boolean)),
  ];

  sourceTickers.forEach((ticker) => {
    const existing = stored?.[ticker] || {};
    next[ticker] = createTradeWorkspace(ticker, {
      ...existing,
      id: ticker,
      ticker,
      selectedContract: {
        strike: contracts?.[ticker]?.strike ?? existing.selectedContract?.strike ?? null,
        cp: contracts?.[ticker]?.cp ?? existing.selectedContract?.cp ?? "C",
        exp: contracts?.[ticker]?.exp ?? existing.selectedContract?.exp ?? "",
        providerContractId:
          contracts?.[ticker]?.providerContractId ??
          existing.selectedContract?.providerContractId ??
          null,
      },
      notes: { ...createTradeWorkspace(ticker).notes, ...(existing.notes || {}) },
      equityChart: { ...createTradeWorkspace(ticker).equityChart, ...(existing.equityChart || {}) },
      optionChart: { ...createTradeWorkspace(ticker).optionChart, ...(existing.optionChart || {}) },
      levels: Array.isArray(existing.levels) ? existing.levels : [],
      chainHeatmapEnabled: Boolean(existing.chainHeatmapEnabled),
    });
  });

  return next;
};

export const normalizeTradeTickerSymbol = (value) =>
  String(value ?? "").trim().toUpperCase();

export const resolveInitialTradeTicker = ({ persistedActive, sym, symPing } = {}) => {
  const pingSymbol =
    symPing && Number(symPing.n) > 0 ? normalizeTradeTickerSymbol(symPing.sym) : "";
  return (
    pingSymbol ||
    normalizeTradeTickerSymbol(sym) ||
    normalizeTradeTickerSymbol(persistedActive) ||
    "SPY"
  );
};

const getTradeOptionChainQueryKey = (
  ticker,
  chainKey,
  strikesAroundMoney = OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY,
  strikeCoverage = null,
  quoteHydration = OPTION_CHAIN_METADATA_HYDRATION,
) => [
  "trade-option-chain",
  ticker,
  chainKey || "__empty__",
  quoteHydration,
  strikeCoverage || "window",
  strikeCoverage === OPTION_CHAIN_FULL_STRIKE_COVERAGE
    ? OPTION_CHAIN_FULL_STRIKE_COVERAGE
    : strikesAroundMoney,
];

const getTradeOptionChainBatchQueryKey = (
  ticker,
  chainKeys,
  strikesAroundMoney = OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY,
  strikeCoverage = null,
  quoteHydration = OPTION_CHAIN_METADATA_HYDRATION,
) => [
  "trade-option-chain-batch",
  ticker,
  quoteHydration,
  strikeCoverage || "window",
  strikeCoverage === OPTION_CHAIN_FULL_STRIKE_COVERAGE
    ? OPTION_CHAIN_FULL_STRIKE_COVERAGE
    : strikesAroundMoney,
  ...chainKeys,
];

const buildOptionChainCoverageRequestParams = (request) => {
  if (request?.strikeCoverage) {
    return { strikeCoverage: request.strikeCoverage };
  }
  return { strikesAroundMoney: request?.strikesAroundMoney };
};

const isTradeHeavyQueryKey = (queryKey, ticker) => {
  if (!Array.isArray(queryKey)) {
    return false;
  }

  const family = queryKey[0];
  if (
    family === "trade-option-chain" ||
    family === "trade-option-chain-batch"
  ) {
    return !ticker || queryKey[1] === ticker;
  }

  if (family === "trade-flow") {
    return !ticker || queryKey[1] === ticker;
  }

  return false;
};

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const buildTradeChainRowsSignature = (rows = []) =>
  rows.map((row) => row?.k).filter((value) => value != null).join("|");

const formatOptionExpirationIsoDate = (value, actualDate) => {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (actualDate instanceof Date && !Number.isNaN(actualDate.getTime())) {
    return actualDate.toISOString().slice(0, 10);
  }

  return null;
};

const buildExpirationOptions = (expirations = []) => {
  const currentYear = new Date().getUTCFullYear();
  return expirations
    .map((entry) => {
      const actualDate = parseExpirationValue(entry?.expirationDate);
      const legacyValue = formatExpirationLabel(entry?.expirationDate);
      const isoDate = formatOptionExpirationIsoDate(
        entry?.expirationDate,
        actualDate,
      );
      const expirationYear = actualDate?.getUTCFullYear?.() ?? null;
      const label =
        expirationYear && expirationYear !== currentYear
          ? `${legacyValue}/${expirationYear}`
          : legacyValue;
      const value = isoDate || legacyValue;
      return {
        value,
        legacyValue,
        chainKey: isoDate ? String(isoDate) : value,
        label,
        dte: daysToExpiration(actualDate),
        actualDate,
        isoDate,
      };
    })
    .filter((entry) => entry.value && entry.value !== MISSING_VALUE)
    .sort(
      (left, right) =>
        (left.actualDate?.getTime?.() ?? 0) -
        (right.actualDate?.getTime?.() ?? 0),
    );
};

const doesExpirationOptionMatchValue = (option, value) =>
  Boolean(
    value &&
      option &&
      (option.value === value ||
        option.chainKey === value ||
        option.isoDate === value ||
        option.legacyValue === value ||
        option.label === value),
  );

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const getContractLabel = (contract, ticker) => {
  if (!contract) return `${ticker || MISSING_VALUE} CONTRACT`;
  return formatOptionContractLabel(contract, {
    symbol: ticker,
    includeSymbol: true,
    fallback: `${ticker || MISSING_VALUE} CONTRACT`,
  });
};

const getOptionMark = (bid, ask, last) => {
  if (isFiniteNumber(bid) && bid > 0 && isFiniteNumber(ask) && ask > 0) {
    return +((bid + ask) / 2).toFixed(2);
  }
  return isFiniteNumber(last) ? +last.toFixed(2) : null;
};

const normalizeMarketFreshness = (value, fallback = "metadata") => {
  if (
    value === "live" ||
    value === "delayed" ||
    value === "frozen" ||
    value === "delayed_frozen" ||
    value === "stale" ||
    value === "metadata" ||
    value === "unavailable" ||
    value === "pending"
  ) {
    return value;
  }
  return fallback;
};

const formatMarketFreshnessLabel = (value) => {
  const freshness = normalizeMarketFreshness(value, "unavailable");
  if (freshness === "delayed_frozen") return "delayed frozen";
  if (freshness === "metadata") return "metadata";
  if (freshness === "unavailable") return "unavailable";
  return freshness;
};

const getOptionChartEmptyCopy = ({ emptyReason, requestFailed, feedIssue }) => {
  if (requestFailed) {
    return {
      title: "Option history unavailable",
      detail:
        "The chart request did not complete. Select another contract or retry after the data service recovers.",
    };
  }
  if (emptyReason === "no-option-aggregate-bars") {
    return {
      title: "No option trades in this window",
      detail:
        "IBKR and Polygon returned no bars for this contract and timeframe.",
    };
  }
  if (emptyReason === "polygon-not-configured") {
    return {
      title: "Option aggregate feed unavailable",
      detail:
        "IBKR did not return chart bars and the Polygon/Massive fallback is not configured.",
    };
  }
  if (
    emptyReason === "missing-provider-contract-id" ||
    emptyReason === "option_contract_resolution_error" ||
    emptyReason === "option-contract-resolution-backoff"
  ) {
    return {
      title: "Option contract lookup unavailable",
      detail:
        "IBKR did not provide a current contract id. Option aggregates will display when available.",
    };
  }
  if (feedIssue) {
    return {
      title: "Broker history unavailable",
      detail:
        "IBKR option history was unavailable and no fallback option bars were returned.",
    };
  }
  return {
    title: "No option bars",
    detail:
      emptyReason?.replaceAll("-", " ") ||
      "No chart bars were returned for this contract and timeframe.",
  };
};

const buildLiveAwareOptionChainRows = (contracts, spotPrice) =>
  buildOptionChainRowsFromApi(contracts, spotPrice).map((row) =>
    patchOptionChainRowWithQuoteGetter(row, getStoredOptionQuoteSnapshot),
  );

const TradePanelShell = ({
  testId,
  title,
  meta = null,
  children,
  showHeader = true,
  fill = false,
}) => (
  <div
    data-testid={testId}
    className="ra-panel-enter"
    style={{
      height: fill ? "100%" : "auto",
      alignSelf: fill ? "stretch" : "start",
      minHeight: 0,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      background: T.bg1,
      border: `1px solid ${T.border}`,
      overflow: "hidden",
    }}
  >
    {showHeader ? (
      <div
        style={{
          minHeight: dim(26),
          padding: sp("4px 7px"),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          borderBottom: `1px solid ${T.border}`,
          fontFamily: T.mono,
        }}
      >
        <span
          style={{
            color: T.text,
            fontSize: fs(10),
            fontWeight: 400,
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
        {meta ? (
          <span
            style={{
              color: T.textDim,
              fontSize: fs(9),
              whiteSpace: "nowrap",
            }}
          >
            {meta}
          </span>
        ) : null}
      </div>
    ) : null}
    <div
      style={{
        flex: fill ? 1 : "0 1 auto",
        minHeight: 0,
        padding: sp(6),
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  </div>
);

const TradeContractDetailPanel = ({
  ticker,
  contract,
  heldContracts = [],
  flowEvents,
  liveDataEnabled = true,
  historicalDataEnabled = liveDataEnabled,
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const parentFlowEventsProvided = flowEvents !== undefined;
  const tradeFlowSnapshot = useTradeFlowSnapshot(ticker, {
    subscribe: !parentFlowEventsProvided,
  });
  const flowTapeFilters = useFlowTapeFilterState();
  const {
    favoriteTimeframes: optionFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleOptionFavoriteTimeframe,
  } = useChartTimeframeFavorites("option");
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const prewarmedFavoriteTimeframesRef = useRef(null);
  const { chainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    contract.exp,
  );
  const selectedRow = useMemo(
    () => chainRows.find((row) => row.k === contract.strike) || null,
    [chainRows, contract.strike],
  );
  const selectedContract =
    contract.cp === "P"
      ? selectedRow?.pContract || null
      : selectedRow?.cContract || null;
  const heldContract = useMemo(
    () =>
      heldContracts.find(
        (holding) =>
          holding.exp === contract.exp &&
          holding.cp === contract.cp &&
          holding.strike === contract.strike &&
          holding.providerContractId,
      ) || null,
    [contract.cp, contract.exp, contract.strike, heldContracts],
  );
  const providerContractId =
    selectedContract?.providerContractId ||
    heldContract?.providerContractId ||
    contract.providerContractId ||
    null;
  const optionTicker =
    typeof selectedContract?.ticker === "string" && selectedContract.ticker.trim()
      ? selectedContract.ticker.trim()
      : null;
  const optionExpirationIso = normalizeFlowOptionExpirationIso(
    selectedContract?.expirationDate || contract.exp,
  );
  const optionRight = contract.cp === "P" ? "put" : "call";
  const optionIdentityReady = Boolean(
    ticker &&
      optionExpirationIso &&
      optionRight &&
      Number.isFinite(contract.strike),
  );
  const [optionChartTimeframe, setOptionChartTimeframe] = useState(
    TRADE_OPTION_CHART_TIMEFRAME,
  );
  const [drawMode, setDrawMode] = useState(null);
  const [selectedIndicators, setSelectedIndicators] = useState(() =>
    resolvePersistedIndicatorPreset({
      indicators: _initialState.tradeOptionSelectedIndicators,
      defaults: DEFAULT_TRADE_OPTION_STUDIES,
      persistedVersion: _initialState.tradeOptionIndicatorPresetVersion,
      currentVersion: TRADE_OPTION_INDICATOR_PRESET_VERSION,
    }),
  );
  const [rayReplicaSettings, setRayReplicaSettings] = useState(() =>
    resolvePersistedRayReplicaSettings(_initialState.tradeOptionRayReplicaSettings),
  );
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const { drawings, addDrawing, clearDrawings } = useDrawingHistory();
  const optionProgressiveScopeKey = useMemo(() => {
    return buildChartBarScopeKey(
      "trade-contract-option-bars",
      ticker,
      optionExpirationIso,
      optionRight,
      Number.isFinite(contract.strike) ? contract.strike : null,
      optionTicker,
      providerContractId,
    );
  }, [
    contract.strike,
    optionExpirationIso,
    optionRight,
    optionTicker,
    providerContractId,
    ticker,
  ]);
  const optionProgressiveBars = useProgressiveChartBarLimit({
    scopeKey: optionProgressiveScopeKey,
    timeframe: optionChartTimeframe,
    role: "option",
    enabled: Boolean(historicalDataEnabled && optionIdentityReady),
    warmTargetLimit: useCallback(() => Promise.resolve(), []),
  });
  const {
    baseBars,
    baseTimeframe: optionChartBaseTimeframe,
    chartProviderContractId,
    displayBars,
    emptyOlderHistoryWindowCount,
    hasExhaustedOlderHistory,
    identityKey: optionContractScopeKey,
    isPrependingOlder,
    loadedBarCount,
    oldestLoadedAtMs,
    olderHistoryCursor,
    olderHistoryExhaustionReason,
    olderHistoryNextBeforeMs,
    olderHistoryPageCount,
    olderHistoryProvider,
    olderHistoryProviderCursor,
    olderHistoryProviderNextUrl,
    olderHistoryProviderPageCount,
    olderHistoryProviderPageLimitReached,
    prependOlderBars,
    prewarmTimeframe: prewarmFavoriteTimeframe,
    query: optionBarsQuery,
    baseBarsCacheStale: optionBaseBarsCacheStale,
    streamStatus: optionStreamStatus,
    streamedBars,
  } = useOptionChartBars({
    scope: "trade-contract",
    underlying: ticker,
    expirationDate: optionExpirationIso,
    right: optionRight,
    strike: contract.strike,
    optionTicker,
    providerContractId,
    timeframe: optionChartTimeframe,
    barsLimit: optionProgressiveBars.requestedLimit,
    enabled: Boolean(historicalDataEnabled && optionIdentityReady),
    liveEnabled: liveDataEnabled,
    queryDefaults: OPTION_CHART_BARS_QUERY_DEFAULTS,
    hydrationLabel: `${ticker} option ${optionChartTimeframe}`,
    hydrationActive: historicalDataEnabled,
    allowedTimeframes: TRADE_OPTION_CHART_TIMEFRAME_OPTIONS,
    getPrewarmLimit: (nextTimeframe) =>
      getInitialChartBarLimit(nextTimeframe, "option"),
  });
  const liveQuote = useStoredOptionQuoteSnapshot(chartProviderContractId);
  useEffect(() => {
    if (optionBarsQuery.data?.bars?.length) {
      optionProgressiveBars.hydrateFullWindow();
    }
  }, [
    optionBarsQuery.data?.bars?.length,
    optionProgressiveBars.hydrateFullWindow,
  ]);
  useUnderfilledChartBackfill({
    scopeKey: optionContractScopeKey,
    enabled: Boolean(
      historicalDataEnabled &&
        optionIdentityReady &&
        optionBarsQuery.data?.bars?.length,
    ),
    loadedBarCount,
    requestedLimit: optionProgressiveBars.requestedLimit,
    minPageSize: getInitialChartBarLimit(optionChartTimeframe, "option"),
    isPrependingOlder,
    hasExhaustedOlderHistory,
    prependOlderBars,
  });
  useEffect(() => {
    if (
      !historicalDataEnabled ||
      !optionBarsQuery.data?.bars?.length ||
      !optionFavoriteTimeframes.length
    ) {
      return;
    }

    const prewarmKey = [
      optionContractScopeKey,
      optionChartTimeframe,
      optionFavoriteTimeframes.join(","),
    ].join("::");
    if (prewarmedFavoriteTimeframesRef.current === prewarmKey) {
      return;
    }

    prewarmedFavoriteTimeframesRef.current = prewarmKey;
    optionFavoriteTimeframes.forEach(prewarmFavoriteTimeframe);
  }, [
    historicalDataEnabled,
    optionBarsQuery.data?.bars?.length,
    optionChartTimeframe,
    optionContractScopeKey,
    optionFavoriteTimeframes,
    prewarmFavoriteTimeframe,
  ]);
  const toggleIndicator = useCallback((studyId) => {
    setSelectedIndicators((current) =>
      current.includes(studyId)
        ? current.filter((value) => value !== studyId)
        : [...current, studyId],
    );
  }, []);
  useEffect(() => {
    persistState({
      tradeOptionSelectedIndicators: selectedIndicators,
      tradeOptionIndicatorPresetVersion: TRADE_OPTION_INDICATOR_PRESET_VERSION,
    });
  }, [selectedIndicators]);
  useEffect(() => {
    persistState({ tradeOptionRayReplicaSettings: rayReplicaSettings });
  }, [rayReplicaSettings]);
  const optionChartScopeKey =
    optionContractScopeKey ||
    [
      "trade-contract-option",
      ticker || "__missing__",
      optionExpirationIso || "__missing__",
      optionRight || "__missing__",
      Number.isFinite(contract.strike) ? contract.strike : "__missing__",
      optionChartTimeframe,
    ].join("::");
  const chartModel = useMeasuredChartModel({
    scopeKey: optionChartScopeKey,
    bars: displayBars,
    buildInput: {
      bars: displayBars,
      timeframe: optionChartTimeframe,
      defaultVisibleBarCount: getChartBarLimit(optionChartTimeframe, "option"),
      selectedIndicators,
      indicatorSettings,
      indicatorRegistry,
    },
    deps: [
      displayBars,
      optionContractScopeKey,
      ticker,
      optionExpirationIso,
      optionRight,
      contract.strike,
      indicatorRegistry,
      indicatorSettings,
      optionChartTimeframe,
      selectedIndicators,
    ],
  });
  const mergedFlowEvents = useMemo(
    () =>
      parentFlowEventsProvided
        ? Array.isArray(flowEvents)
          ? flowEvents
          : []
        : tradeFlowSnapshot.events || [],
    [flowEvents, parentFlowEventsProvided, tradeFlowSnapshot.events],
  );
  const selectedContractFlowEvents = useMemo(
    () =>
      filterFlowEventsForOptionContract(
        filterFlowEventsForChartDisplay(mergedFlowEvents, flowTapeFilters),
        {
          symbol: ticker,
          providerContractId,
          optionTicker,
          expirationDate: optionExpirationIso,
          right: optionRight,
          strike: contract.strike,
        },
      ),
    [
      contract.strike,
      flowTapeFilters,
      mergedFlowEvents,
      optionExpirationIso,
      optionRight,
      optionTicker,
      providerContractId,
      ticker,
    ],
  );
  const chartEventConversion = useMemo(
    () => flowEventsToChartEventConversion(selectedContractFlowEvents, ticker),
    [selectedContractFlowEvents, ticker],
  );
  const chartEvents = chartEventConversion.events;
  const chartFlowBadge = useMemo(() => {
    if (!chartEvents.length) {
      return null;
    }
    const topEvent =
      chartEvents
        .slice()
        .sort(
          (left, right) =>
            Number(right.metadata?.premium || 0) -
            Number(left.metadata?.premium || 0),
        )[0] || chartEvents[0];
    const bullishCount = chartEvents.filter(
      (event) => event.bias === "bullish",
    ).length;
    const bearishCount = chartEvents.filter(
      (event) => event.bias === "bearish",
    ).length;
    const bias =
      bullishCount > bearishCount
        ? "bullish"
        : bearishCount > bullishCount
          ? "bearish"
          : topEvent?.bias || "neutral";
    const color = bias === "bearish" ? T.red : bias === "bullish" ? T.green : T.amber;
    return {
      color,
      label:
        chartEvents.length > 1
          ? `${chartEvents.length} Flow`
          : `Flow ${topEvent?.label || 1}`,
      tooltip:
        chartEvents.length > 1
          ? `${chartEvents.length} flow events · ${
              topEvent?.summary || topEvent?.label || "top flow"
            }`
          : topEvent?.summary || "Flow",
    };
  }, [chartEvents]);
  const heldCount = heldContracts.length;
  const contractLabel = selectedContract
    ? getContractLabel(
        {
          strike: selectedContract.strike,
          cp: selectedContract.right === "put" ? "P" : "C",
          exp: contract.exp,
        },
        ticker,
      )
    : getContractLabel(contract, ticker);
  const sidePrefix = contract.cp === "P" ? "p" : "c";
  const rowBid = selectedRow?.[`${sidePrefix}Bid`] ?? null;
  const rowAsk = selectedRow?.[`${sidePrefix}Ask`] ?? null;
  const rowMark = selectedRow?.[`${sidePrefix}Prem`] ?? null;
  const rowFreshness = selectedRow?.[`${sidePrefix}Freshness`] ?? "metadata";
  const rowQuoteUpdatedAt = selectedRow?.[`${sidePrefix}QuoteUpdatedAt`] ?? null;
  const bid = isFiniteNumber(liveQuote?.bid) ? liveQuote.bid : rowBid;
  const ask = isFiniteNumber(liveQuote?.ask) ? liveQuote.ask : rowAsk;
  const last = isFiniteNumber(liveQuote?.price) ? liveQuote.price : rowMark;
  const mark = getOptionMark(bid, ask, last) ?? rowMark;
  const latestBar = displayBars[displayBars.length - 1] || null;
  const quoteFreshness = normalizeMarketFreshness(
    liveQuote?.freshness ?? rowFreshness,
    rowFreshness || "metadata",
  );
  const rawBarFreshness = normalizeMarketFreshness(
    optionBarsQuery.data?.freshness ?? latestBar?.freshness,
    displayBars.length ? "live" : "unavailable",
  );
  const chartEmptyReason = optionBarsQuery.data?.emptyReason || null;
  const chartDataSource = optionBarsQuery.data?.dataSource || "none";
  const chartFeedIssue = Boolean(optionBarsQuery.data?.feedIssue);
  const chartRequestLoading =
    optionIdentityReady &&
    (optionBarsQuery.isPending || optionBarsQuery.fetchStatus === "fetching");
  const chartRequestFailed = Boolean(optionBarsQuery.isError);
  const quoteUpdatedAt = liveQuote?.updatedAt || rowQuoteUpdatedAt || null;
  const barUpdatedAt = optionBarsQuery.data?.dataUpdatedAt || null;
  const previousBar =
    displayBars.length > 1 ? displayBars[displayBars.length - 2] : null;
  const lastPrice = latestBar?.c ?? mark ?? null;
  const changePercent =
    isFiniteNumber(lastPrice) &&
    isFiniteNumber(previousBar?.c) &&
    previousBar.c !== 0
      ? ((lastPrice - previousBar.c) / previousBar.c) * 100
      : null;
  const optionChartSourceState = resolveOptionChartSourceState({
    identityReady: optionIdentityReady,
    latestBar,
    status: optionStreamStatus,
    timeframe: optionChartTimeframe,
    liveDataEnabled,
    requestLoading: chartRequestLoading,
    requestFailed: chartRequestFailed,
    emptyReason: chartEmptyReason,
    feedIssue: chartFeedIssue,
    dataSource: chartDataSource,
    resolutionSource: optionBarsQuery.data?.resolutionSource,
    responseFreshness: optionBarsQuery.data?.freshness,
    cacheStale: optionBaseBarsCacheStale,
  });
  const barFreshness = normalizeMarketFreshness(
    optionChartSourceState.freshness,
    rawBarFreshness,
  );
  const statusLabel = optionChartSourceState.label;
  const optionChartEmptyCopy = getOptionChartEmptyCopy({
    emptyReason: chartEmptyReason,
    requestFailed: chartRequestFailed,
    feedIssue: chartFeedIssue,
  });
  const optionChartEmptyState = useMemo(
    () => ({
      eyebrow: "Option chart",
      title: chartRequestLoading
        ? "Loading option history"
        : optionIdentityReady
          ? optionChartEmptyCopy.title
          : "Select a contract",
      detail: chartRequestLoading
        ? "Resolving the option contract and requesting chart bars."
        : optionIdentityReady
          ? optionChartEmptyCopy.detail
          : "Choose an option row to load chart history.",
    }),
    [
      chartRequestLoading,
      optionChartEmptyCopy.detail,
      optionChartEmptyCopy.title,
      optionIdentityReady,
    ],
  );

  useEffect(() => {
    recordChartBarScopeState(optionContractScopeKey, {
      timeframe: optionChartTimeframe,
      role: "option",
      requestedLimit: optionProgressiveBars.requestedLimit,
      initialLimit: getInitialChartBarLimit(optionChartTimeframe, "option"),
      targetLimit: optionProgressiveBars.targetLimit,
      maxLimit: optionProgressiveBars.maxLimit,
      hydratedBaseCount: baseBars.length,
      renderedBarCount: displayBars.length,
      livePatchedBarCount: Math.max(0, streamedBars.length - baseBars.length),
      oldestLoadedAt: oldestLoadedAtMs
        ? new Date(oldestLoadedAtMs).toISOString()
        : null,
      isPrependingOlder,
      hasExhaustedOlderHistory,
      olderHistoryNextBeforeAt: olderHistoryNextBeforeMs
        ? new Date(olderHistoryNextBeforeMs).toISOString()
        : null,
      emptyOlderHistoryWindowCount,
      olderHistoryPageCount,
      olderHistoryProvider,
      olderHistoryExhaustionReason,
      olderHistoryProviderCursor,
      olderHistoryProviderNextUrl,
      olderHistoryProviderPageCount,
      olderHistoryProviderPageLimitReached,
      olderHistoryCursor,
      baseTimeframe: optionChartBaseTimeframe,
      chartHydrationStatus: statusLabel,
    });
  }, [
    baseBars.length,
    displayBars.length,
    emptyOlderHistoryWindowCount,
    hasExhaustedOlderHistory,
    isPrependingOlder,
    oldestLoadedAtMs,
    optionChartBaseTimeframe,
    optionChartTimeframe,
    optionContractScopeKey,
    optionProgressiveBars.maxLimit,
    optionProgressiveBars.requestedLimit,
    optionProgressiveBars.targetLimit,
    olderHistoryCursor,
    olderHistoryExhaustionReason,
    olderHistoryNextBeforeMs,
    olderHistoryPageCount,
    olderHistoryProvider,
    olderHistoryProviderCursor,
    olderHistoryProviderNextUrl,
    olderHistoryProviderPageCount,
    olderHistoryProviderPageLimitReached,
    statusLabel,
    streamedBars.length,
  ]);

  const expandOptionVisibleLogicalRange = useCallback(
    (range) => {
      optionProgressiveBars.expandForVisibleRange(range, displayBars.length, {
        hasExhaustedOlderHistory,
        isHydratingRequestedWindow:
          optionBarsQuery.fetchStatus === "fetching" &&
          optionProgressiveBars.requestedLimit > loadedBarCount,
        isPrependingOlder,
        oldestLoadedAtMs,
        prependOlderBars,
      });
    },
    [
      displayBars.length,
      hasExhaustedOlderHistory,
      isPrependingOlder,
      loadedBarCount,
      oldestLoadedAtMs,
      optionBarsQuery.fetchStatus,
      optionProgressiveBars.requestedLimit,
      prependOlderBars,
      optionProgressiveBars.expandForVisibleRange,
    ],
  );
  const scheduleOptionVisibleRangeExpansion =
    useDebouncedVisibleRangeExpansion(expandOptionVisibleLogicalRange, {
      resetKey: `${optionContractScopeKey}:${optionChartTimeframe}`,
      recheckKey: [
        optionContractScopeKey,
        optionChartTimeframe,
        displayBars.length,
        optionBarsQuery.fetchStatus === "fetching" ? "fetching" : "settled",
        isPrependingOlder ? "prepending" : "ready",
        hasExhaustedOlderHistory ? "exhausted" : "open",
      ].join(":"),
    });

  useEffect(() => {
    if (!ticker || !optionIdentityReady) {
      return;
    }
    setOptionHydrationDiagnostics({
      selectedProviderContractId: chartProviderContractId,
      chartHydrationStatus: statusLabel,
      quoteFreshness,
      barFreshness,
      chartEmptyReason,
    });
  }, [
    barFreshness,
    chartEmptyReason,
    chartProviderContractId,
    optionIdentityReady,
    quoteFreshness,
    statusLabel,
    ticker,
  ]);

  return (
    <TradePanelShell
      testId="trade-contract-chart-panel"
      title="CONTRACT"
      meta={heldCount ? `${heldCount} held / ${statusLabel}` : statusLabel}
      showHeader={false}
      fill
    >
      <div
        style={{
          height: "100%",
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) auto",
          gap: sp(6),
          minHeight: 0,
        }}
      >
        <div style={{ position: "relative", minHeight: 0, height: "100%" }}>
          <ResearchChartFrame
            dataTestId="trade-contract-option-chart"
            theme={T}
            themeKey={`${getCurrentTheme()}-trade-contract`}
            surfaceUiStateKey={`trade-contract-${chartProviderContractId || optionContractScopeKey}`}
            rangeIdentityKey={`trade-contract-option:${chartProviderContractId || optionContractScopeKey}:${optionChartTimeframe}`}
            model={chartModel}
            chartEvents={chartEvents}
            chartFlowDiagnostics={chartEventConversion}
            emptyState={optionChartEmptyState}
            drawings={drawings}
            drawMode={drawMode}
            onAddDrawing={addDrawing}
            showSurfaceToolbar={false}
            showLegend
            legend={{
              symbol: ticker || "OPTION",
              name: contractLabel,
              timeframe: optionChartTimeframe,
              statusLabel,
              statusTone: optionChartSourceState.tone,
              priceLabel: "Option",
              price: lastPrice,
              changePercent,
              meta: {
                open: latestBar?.o,
                high: latestBar?.h,
                low: latestBar?.l,
                close: latestBar?.c,
                volume: latestBar?.v,
                timestamp: latestBar?.ts,
                sourceLabel: statusLabel,
              },
              studies: availableStudies,
              selectedStudies: selectedIndicators,
            }}
            style={{ minHeight: 0, width: "100%" }}
            surfaceTopOverlay={(controls) => (
              <ResearchChartWidgetHeader
                theme={T}
                controls={controls}
                symbol={ticker || "OPTION"}
                name={contractLabel}
                priceLabel="Option"
                price={lastPrice}
                changePercent={changePercent}
                statusLabel={statusLabel}
                statusTone={optionChartSourceState.tone}
                timeframe={optionChartTimeframe}
                showInlineLegend={false}
                timeframeOptions={TRADE_OPTION_CHART_TIMEFRAME_OPTIONS}
                favoriteTimeframes={optionFavoriteTimeframes}
                onChangeTimeframe={setOptionChartTimeframe}
                onToggleFavoriteTimeframe={toggleOptionFavoriteTimeframe}
                onPrewarmTimeframe={prewarmFavoriteTimeframe}
                studies={availableStudies}
                selectedStudies={selectedIndicators}
                studySpecs={chartModel.studySpecs}
                onToggleStudy={toggleIndicator}
                meta={{
                  open: latestBar?.o,
                  high: latestBar?.h,
                  low: latestBar?.l,
                  close: latestBar?.c,
                  volume: latestBar?.v,
                  timestamp: latestBar?.ts,
                  sourceLabel: statusLabel,
                }}
                showSnapshotButton={false}
                rightSlot={
                  <RayReplicaSettingsMenu
                    theme={T}
                    settings={rayReplicaSettings}
                    onChange={setRayReplicaSettings}
                    disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
                  />
                }
              />
            )}
            surfaceTopOverlayHeight={
              TRADE_OPTION_CHART_FRAME_LAYOUT.surfaceTopOverlayHeight
            }
            surfaceLeftOverlay={(controls) => (
              <ResearchChartWidgetSidebar
                theme={T}
                controls={controls}
                drawMode={drawMode}
                drawingCount={drawings.length}
                onToggleDrawMode={setDrawMode}
                onClearDrawings={() => {
                  clearDrawings();
                  setDrawMode(null);
                }}
              />
            )}
            surfaceLeftOverlayWidth={
              TRADE_OPTION_CHART_FRAME_LAYOUT.surfaceLeftOverlayWidth
            }
            surfaceBottomOverlay={(controls) => (
              <ResearchChartWidgetFooter
                theme={T}
                controls={controls}
                studies={availableStudies}
                selectedStudies={selectedIndicators}
                studySpecs={chartModel.studySpecs}
                onToggleStudy={toggleIndicator}
                statusText={statusLabel}
              />
            )}
            surfaceBottomOverlayHeight={
              TRADE_OPTION_CHART_FRAME_LAYOUT.surfaceBottomOverlayHeight
            }
            onVisibleLogicalRangeChange={scheduleOptionVisibleRangeExpansion}
          />
          {displayBars.length && chartFlowBadge ? (
            <AppTooltip content={chartFlowBadge.tooltip}><div
              data-testid="trade-contract-option-chart-flow-badge"
              style={{
                position: "absolute",
                right: dim(10),
                top: dim(
                  TRADE_OPTION_CHART_FRAME_LAYOUT.surfaceTopOverlayHeight + 8,
                ),
                zIndex: 8,
                border: `1px solid ${chartFlowBadge.color}66`,
                background: `${chartFlowBadge.color}18`,
                color: chartFlowBadge.color,
                borderRadius: dim(3),
                padding: sp("4px 6px"),
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 400,
                pointerEvents: "auto",
                boxShadow: `0 0 0 1px ${T.bg4}cc`,
              }}
            >
              {chartFlowBadge.label}
            </div></AppTooltip>
          ) : null}
        </div>
        <div
          style={{
            color: T.textMuted,
            fontFamily: T.mono,
            fontSize: fs(9),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {contractLabel}
          {quoteUpdatedAt
            ? ` / ${formatMarketFreshnessLabel(quoteFreshness)} quote ${formatRelativeTimeShort(
                quoteUpdatedAt,
              )}`
            : barUpdatedAt
              ? ` / ${formatMarketFreshnessLabel(barFreshness)} bars ${formatRelativeTimeShort(
                  barUpdatedAt,
                )}`
            : changePercent != null
              ? ` / ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`
              : ""}
        </div>
      </div>
    </TradePanelShell>
  );
};

const TradeSpotFlowPanel = ({ ticker }) => {
  const flow = useTradeFlowSnapshot(ticker);
  const latest = flow.events?.[0] || null;

  return (
    <TradePanelShell
      testId="trade-spot-flow-panel"
      title="SPOT FLOW"
      meta={(flow.status || "empty").toUpperCase()}
    >
      <div
        style={{
          height: "auto",
          display: "grid",
          gridTemplateRows: "auto auto",
          gap: sp(6),
          color: T.textSec,
          fontFamily: T.sans,
          fontSize: fs(10),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            fontFamily: T.mono,
          }}
        >
          <span style={{ color: T.textDim }}>{ticker || MISSING_VALUE}</span>
          <span style={{ color: T.text }}>
            {flow.events?.length || 0} prints
          </span>
        </div>
        <div
          style={{
            border: `1px solid ${T.border}`,
            background: T.bg0,
            padding: sp(6),
            overflow: "hidden",
          }}
        >
          {latest ? (
            <div>
              <div style={{ color: T.text, fontWeight: 400 }}>
                {latest.side || "flow"}{" "}
                {latest.contract || latest.ticker || ticker}
              </div>
              <div style={{ marginTop: sp(4), color: T.textDim }}>
                {latest.occurredAt
                  ? formatRelativeTimeShort(latest.occurredAt)
                  : flow.status}
              </div>
            </div>
          ) : (
            <span style={{ color: T.textDim }}>No recent spot flow</span>
          )}
        </div>
      </div>
    </TradePanelShell>
  );
};

const TradeOptionsFlowPanel = ({ ticker }) => {
  const flow = useTradeFlowSnapshot(ticker);
  const events = (flow.events || []).slice(0, 6);

  return (
    <TradePanelShell
      testId="trade-options-flow-panel"
      title="OPTIONS FLOW"
      meta={(flow.status || "empty").toUpperCase()}
    >
      <div
        style={{
          height: "auto",
          display: "flex",
          flexDirection: "column",
          gap: sp(5),
          overflow: "hidden",
        }}
      >
        {events.length ? (
          events.map((event) => (
            <div
              key={event.id || `${event.contract}-${event.occurredAt}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: sp(8),
                border: `1px solid ${T.border}80`,
                background: T.bg0,
                padding: sp("6px 7px"),
                fontFamily: T.mono,
                fontSize: fs(9),
              }}
            >
              <span
                style={{
                  color: T.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {event.contract || event.ticker || ticker}
              </span>
              <span style={{ color: event.cp === "P" ? T.red : T.green }}>
                {event.side || event.cp || "flow"}
              </span>
            </div>
          ))
        ) : (
          <div
            style={{
              minHeight: dim(72),
              display: "grid",
              placeItems: "center",
              color: T.textDim,
              fontFamily: T.mono,
              fontSize: fs(10),
            }}
          >
            No recent options flow
          </div>
        )}
      </div>
    </TradePanelShell>
  );
};

const MemoTradeTickerHeader = memo(function MemoTradeTickerHeader(props) {
  return <TradeTickerHeader {...props} />;
});

const MemoTradeEquityPanel = memo(function MemoTradeEquityPanel(props) {
  return <TradeEquityPanel {...props} />;
});

const MemoTradeChainPanel = memo(function MemoTradeChainPanel(props) {
  return <TradeChainPanel {...props} />;
});

const MemoTradeContractDetailPanel = memo(
  function MemoTradeContractDetailPanel(props) {
    return <TradeContractDetailPanel {...props} />;
  },
);

const MemoTradeSpotFlowPanel = memo(function MemoTradeSpotFlowPanel(props) {
  return <TradeSpotFlowPanel {...props} />;
});

const MemoTradeOptionsFlowPanel = memo(
  function MemoTradeOptionsFlowPanel(props) {
    return <TradeOptionsFlowPanel {...props} />;
  },
);

const MemoTradeOrderTicket = memo(function MemoTradeOrderTicket(props) {
  return <TradeOrderTicket {...props} />;
});

const MemoTradeStrategyGreeksPanel = memo(
  function MemoTradeStrategyGreeksPanel(props) {
    return <TradeStrategyGreeksPanel {...props} />;
  },
);

const MemoTradeL2Panel = memo(function MemoTradeL2Panel(props) {
  return <TradeL2Panel {...props} />;
});

const MemoTradePositionsPanel = memo(function MemoTradePositionsPanel(props) {
  return <TradePositionsPanel {...props} />;
});

const TradeQuoteRuntime = ({
  ticker,
  enabled,
  stockAggregateStreamingEnabled,
}) => {
  const quoteQuery = useGetQuoteSnapshots(
    { symbols: ticker },
    {
      query: {
        enabled: Boolean(enabled && ticker),
        staleTime: 60_000,
        retry: false,
      },
    },
  );

  useIbkrQuoteSnapshotStream({
    symbols: ticker ? [ticker] : [],
    enabled: Boolean(stockAggregateStreamingEnabled && ticker && enabled),
  });

  useEffect(() => {
    const quote = quoteQuery.data?.quotes?.find(
      (item) => item.symbol?.toUpperCase() === ticker,
    );
    if (!quote || !ticker) {
      return;
    }

    const currentInfo = ensureTradeTickerInfo(ticker, ticker);
    publishRuntimeTickerSnapshot(ticker, ticker, {
      name: currentInfo.name || ticker,
      price: quote.price ?? currentInfo.price,
      chg: quote.change ?? currentInfo.chg,
      pct: quote.changePercent ?? currentInfo.pct,
      open: quote.open ?? currentInfo.open ?? null,
      high: quote.high ?? currentInfo.high ?? null,
      low: quote.low ?? currentInfo.low ?? null,
      prevClose: quote.prevClose ?? currentInfo.prevClose ?? null,
      volume: quote.volume ?? currentInfo.volume ?? null,
      updatedAt: quote.updatedAt ?? currentInfo.updatedAt ?? null,
    });
  }, [quoteQuery.data, ticker]);

  return null;
};

const TRADE_FLOW_LIVE_LIMIT = 80;
const TRADE_FLOW_HISTORY_LIMIT = 1000;
const TRADE_FLOW_MIN_HISTORY_BUCKET_SECONDS = 60;
const TRADE_FLOW_MAX_HISTORY_BUCKET_SECONDS = 3600;

const getTradeFlowHistoryBucketSeconds = (timeframe) => {
  const definition = getChartTimeframeDefinition(timeframe);
  const stepSeconds = definition?.stepMs
    ? Math.round(definition.stepMs / 1000)
    : 5 * 60;
  return Math.max(
    TRADE_FLOW_MIN_HISTORY_BUCKET_SECONDS,
    Math.min(TRADE_FLOW_MAX_HISTORY_BUCKET_SECONDS, stepSeconds),
  );
};

const TradeFlowRuntime = ({ ticker, enabled, timeframe = "5m" }) => {
  const flowEnabled = Boolean(enabled && ticker);
  const historicalFlowEventsRef = useRef({ key: "", events: [] });
  const historicalBucketSeconds = useMemo(
    () => getTradeFlowHistoryBucketSeconds(timeframe),
    [timeframe],
  );
  const historicalFlowWindow = useMemo(() => {
    const window = getChartEventLookbackWindow(timeframe);
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
  }, [ticker, timeframe]);

  useRuntimeWorkloadFlag("trade:flow", flowEnabled, {
    kind: "poll",
    label: "Trade flow",
    detail: "15s",
    priority: 5,
  });

  const tickerFlowQuery = useQuery({
    queryKey: ["trade-flow", ticker],
    queryFn: () =>
      listFlowEventsRequest({
        underlying: ticker,
        limit: TRADE_FLOW_LIVE_LIMIT,
        blocking: false,
        queueRefresh: true,
      }),
    enabled: flowEnabled,
    staleTime: 15_000,
    refetchInterval: flowEnabled ? 15_000 : false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const historicalFlowQuery = useQuery({
    queryKey: [
      "trade-flow-history",
      ticker,
      historicalFlowWindow.from,
      historicalFlowWindow.to,
      historicalBucketSeconds,
    ],
    queryFn: () =>
      listFlowEventsRequest({
        underlying: ticker,
        limit: TRADE_FLOW_HISTORY_LIMIT,
        from: historicalFlowWindow.from,
        to: historicalFlowWindow.to,
        historicalBucketSeconds,
        blocking: false,
      }),
    enabled: flowEnabled,
    staleTime: 15_000,
    refetchInterval: flowEnabled ? 15_000 : false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });

  useEffect(() => {
    if (!ticker) {
      return;
    }

    const historicalKey = `${ticker}:${historicalFlowWindow.from}:${historicalFlowWindow.to}:${historicalBucketSeconds}`;
    if (historicalFlowEventsRef.current.key !== historicalKey) {
      historicalFlowEventsRef.current = { key: historicalKey, events: [] };
    }
    const liveEvents =
      tickerFlowQuery.data?.events?.map((event) => mapFlowEventToUi(event)) ||
      [];
    const incomingHistoricalEvents =
      historicalFlowQuery.data?.events?.map((event) => mapFlowEventToUi(event)) ||
      [];
    const historicalReason = String(
      historicalFlowQuery.data?.source?.ibkrReason || "",
    ).toLowerCase();
    const historicalRefreshTransient =
      historicalFlowQuery.isPending ||
      historicalFlowQuery.isError ||
      historicalReason.includes("refreshing") ||
      historicalReason.includes("error") ||
      historicalReason.includes("failed");
    if (incomingHistoricalEvents.length > 0 || !historicalRefreshTransient) {
      historicalFlowEventsRef.current = {
        key: historicalKey,
        events: incomingHistoricalEvents,
      };
    }
    const historicalEvents = incomingHistoricalEvents.length
      ? incomingHistoricalEvents
      : historicalFlowEventsRef.current.events;
    const events = mergeFlowEventFeeds(liveEvents, historicalEvents).sort(
      (left, right) => (right.premium || 0) - (left.premium || 0),
    );
    const status = events.length
      ? "live"
      : tickerFlowQuery.isPending || historicalFlowQuery.isPending
        ? "loading"
        : tickerFlowQuery.isError && historicalFlowQuery.isError
          ? "offline"
          : "empty";

    publishTradeFlowSnapshot(ticker, {
      events,
      status,
      source: tickerFlowQuery.data?.source || historicalFlowQuery.data?.source || null,
    });
  }, [
    ticker,
    historicalFlowQuery.data,
    historicalFlowQuery.isError,
    historicalFlowQuery.isPending,
    historicalBucketSeconds,
    historicalFlowWindow.from,
    historicalFlowWindow.to,
    tickerFlowQuery.data,
    tickerFlowQuery.isError,
    tickerFlowQuery.isPending,
  ]);

  return null;
};

const TradeOptionChainRuntime = ({
  ticker,
  expirationValue,
  chainCoverage = DEFAULT_OPTION_CHAIN_COVERAGE,
  enabled = true,
  background = false,
}) => {
  const normalizedChainCoverage =
    normalizeTradeOptionChainCoverage(chainCoverage);
  const expirationsQuery = useGetOptionExpirations(
    { underlying: ticker },
    {
      query: {
        enabled: Boolean(enabled && ticker),
        ...OPTION_EXPIRATION_QUERY_DEFAULTS,
      },
    },
  );
  const expirationOptions = useMemo(
    () => buildExpirationOptions(expirationsQuery.data?.expirations || []),
    [expirationsQuery.data?.expirations],
  );

  const activeExpiration = useMemo(() => {
    if (!expirationOptions.length) {
      return null;
    }

    return (
      expirationOptions.find((option) =>
        doesExpirationOptionMatchValue(option, expirationValue),
      ) ||
      expirationOptions[0]
    );
  }, [expirationOptions, expirationValue]);
  const orderedExpirationOptions = useMemo(() => {
    const activeKey = getExpirationChainKey(activeExpiration);
    if (!activeKey) {
      return expirationOptions;
    }

    return [
      activeExpiration,
      ...expirationOptions.filter(
        (option) => getExpirationChainKey(option) !== activeKey,
      ),
    ];
  }, [activeExpiration, expirationOptions]);
  const {
    activeChainKey,
    activeRequest,
    backgroundRequest,
    batchExpirationOptions,
    batchExpirationChunks,
  } = useMemo(
    () =>
      resolveTradeOptionChainHydrationPlan({
        orderedExpirationOptions,
        activeExpiration,
        background,
        autoBatchEnabled: OPTION_CHAIN_AUTO_BATCH_ENABLED,
        coverage: normalizedChainCoverage,
      }),
    [activeExpiration, background, normalizedChainCoverage, orderedExpirationOptions],
  );
  const batchExpirationChunkSignature = useMemo(
    () =>
      batchExpirationChunks
        .map((chunk) =>
          chunk.map(getExpirationChainKey).filter(Boolean).join(","),
        )
        .join("|"),
    [batchExpirationChunks],
  );
  const [enabledBatchChunkCount, setEnabledBatchChunkCount] = useState(0);
  useEffect(() => {
    setEnabledBatchChunkCount(0);
  }, [
    activeChainKey,
    batchExpirationChunkSignature,
    batchExpirationChunks.length,
    normalizedChainCoverage,
    ticker,
  ]);
  const batchQueryIndexByChainKey = useMemo(() => {
    const entries = new Map();
    batchExpirationChunks.forEach((chunk, index) => {
      chunk
        .map(getExpirationChainKey)
        .filter(Boolean)
        .forEach((chainKey) => {
          entries.set(chainKey, index);
        });
    });
    return entries;
  }, [batchExpirationChunks]);
  const trackedChainKeySet = useMemo(() => {
    const keys = new Set(
      orderedExpirationOptions
        .slice(0, background ? 1 : orderedExpirationOptions.length)
        .map(getExpirationChainKey)
        .filter(Boolean),
    );
    if (activeChainKey) {
      keys.add(activeChainKey);
    }
    return keys;
  }, [activeChainKey, background, orderedExpirationOptions]);
  const activeOptionChainQuery = useQuery({
    queryKey: getTradeOptionChainQueryKey(
      ticker,
      activeChainKey,
      activeRequest.strikesAroundMoney,
      activeRequest.strikeCoverage,
      OPTION_CHAIN_METADATA_HYDRATION,
    ),
    queryFn: async ({ signal }) => {
      const startedAt = nowMs();
      try {
        return await getOptionChainRequest(
          {
            underlying: ticker,
            expirationDate: activeExpiration?.isoDate || undefined,
            ...buildOptionChainCoverageRequestParams(activeRequest),
            quoteHydration: OPTION_CHAIN_METADATA_HYDRATION,
          },
          { signal },
        );
      } finally {
        recordOptionHydrationMetric("activeChainMs", nowMs() - startedAt);
      }
    },
    enabled: Boolean(
      enabled && ticker && activeExpiration?.isoDate && activeChainKey,
    ),
    ...OPTION_CHAIN_QUERY_DEFAULTS,
  });
  useEffect(() => {
    if (
      !enabled ||
      background ||
      batchExpirationChunks.length === 0 ||
      enabledBatchChunkCount > 0
    ) {
      return undefined;
    }

    if (
      activeOptionChainQuery.isSuccess ||
      activeOptionChainQuery.isError ||
      activeOptionChainQuery.fetchStatus === "idle"
    ) {
      setEnabledBatchChunkCount(1);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setEnabledBatchChunkCount(1);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [
    activeOptionChainQuery.fetchStatus,
    activeOptionChainQuery.isError,
    activeOptionChainQuery.isSuccess,
    background,
    batchExpirationChunks.length,
    enabled,
    enabledBatchChunkCount,
  ]);
  const batchOptionChainQueries = useQueries({
    queries: batchExpirationChunks.map((chunk, index) => {
      const chainKeys = chunk.map(getExpirationChainKey).filter(Boolean);
      const expirationDates = chunk
        .map((expiration) => expiration.isoDate)
        .filter(Boolean);

      return {
        queryKey: getTradeOptionChainBatchQueryKey(
          ticker,
          chainKeys,
          backgroundRequest.strikesAroundMoney,
          backgroundRequest.strikeCoverage,
        ),
        queryFn: async ({ signal }) => {
          const startedAt = nowMs();
          try {
            return await batchOptionChainsRequest(
              {
                underlying: ticker,
                expirationDates,
                ...buildOptionChainCoverageRequestParams(backgroundRequest),
                quoteHydration: OPTION_CHAIN_METADATA_HYDRATION,
              },
              { signal },
            );
          } finally {
            recordOptionHydrationMetric("batchChainMs", nowMs() - startedAt);
          }
        },
        enabled: Boolean(
          enabled &&
            ticker &&
            expirationDates.length > 0 &&
            index < enabledBatchChunkCount,
        ),
        ...OPTION_CHAIN_QUERY_DEFAULTS,
      };
    }),
  });
  const completedEnabledBatchChunkCount = batchOptionChainQueries
    .slice(0, enabledBatchChunkCount)
    .filter((query) => query?.isSuccess || query?.isError).length;
  const batchOptionChainQuerySignature = batchOptionChainQueries
    .map((query) =>
      [
        query?.dataUpdatedAt || 0,
        query?.errorUpdatedAt || 0,
        query?.fetchStatus || "idle",
        query?.status || "pending",
      ].join(":"),
    )
    .join("|");
  const batchFetchStatusByChunkIndex = useMemo(
    () => batchOptionChainQueries.map((query) => query?.fetchStatus || "idle"),
    [batchOptionChainQuerySignature],
  );
  useEffect(() => {
    if (
      !enabled ||
      background ||
      batchExpirationChunks.length === 0 ||
      enabledBatchChunkCount >= batchExpirationChunks.length
    ) {
      return;
    }

    if (completedEnabledBatchChunkCount >= enabledBatchChunkCount) {
      setEnabledBatchChunkCount((current) =>
        Math.min(
          batchExpirationChunks.length,
          current + OPTION_CHAIN_BATCH_ACTIVE_CHUNKS,
        ),
      );
    }
  }, [
    background,
    batchExpirationChunks.length,
    completedEnabledBatchChunkCount,
    enabled,
    enabledBatchChunkCount,
  ]);
  const batchResultsByChainKey = useMemo(
    () =>
      new Map(
        batchOptionChainQueries.flatMap((query) =>
          (query.data?.results || []).map((result) => [
            formatOptionExpirationIsoDate(result.expirationDate),
            result,
          ]),
        ),
      ),
    [batchOptionChainQuerySignature],
  );

  useEffect(() => {
    setOptionHydrationDiagnostics({
      ticker: ticker || null,
      expiration: activeChainKey || null,
      expirationCacheStatus: expirationsQuery.data?.debug?.cacheStatus ?? null,
      expirationReturnedCount:
        expirationsQuery.data?.debug?.returnedCount ??
        expirationsQuery.data?.expirations?.length ??
        0,
      expirationRequestedCount:
        expirationsQuery.data?.debug?.requestedCount ?? null,
      expirationComplete: expirationsQuery.data?.debug?.complete ?? undefined,
      expirationCapped: expirationsQuery.data?.debug?.capped ?? undefined,
      expirationStale: expirationsQuery.data?.debug?.stale ?? undefined,
      expirationDegraded: expirationsQuery.data?.debug?.degraded ?? undefined,
      expirationReason: expirationsQuery.data?.debug?.reason ?? null,
      metadataQueueDepth: Math.max(
        0,
        batchExpirationChunks.length - enabledBatchChunkCount,
      ),
      fullQueueDepth:
        activeRequest.coverage === "full" &&
        activeOptionChainQuery.fetchStatus === "fetching"
          ? 1
          : 0,
      pauseReason: !enabled
        ? "disabled"
        : background
          ? "background"
          : !ticker
            ? "missing-ticker"
            : null,
    });
  }, [
    activeChainKey,
    activeOptionChainQuery.fetchStatus,
    activeRequest.coverage,
    background,
    batchExpirationChunks.length,
    enabled,
    enabledBatchChunkCount,
    expirationsQuery.data?.debug?.cacheStatus,
    expirationsQuery.data?.debug?.capped,
    expirationsQuery.data?.debug?.complete,
    expirationsQuery.data?.debug?.degraded,
    expirationsQuery.data?.debug?.reason,
    expirationsQuery.data?.debug?.requestedCount,
    expirationsQuery.data?.debug?.returnedCount,
    expirationsQuery.data?.debug?.stale,
    expirationsQuery.data?.expirations?.length,
    ticker,
  ]);

  useEffect(() => {
    if (!ticker) {
      return;
    }

    const currentSnapshot = getTradeOptionChainSnapshot(ticker);
    const validKeys = new Set(
      expirationOptions.map(getExpirationChainKey).filter(Boolean),
    );
    const validValues = new Set(
      expirationOptions.map((option) => option.value).filter(Boolean),
    );
    const filteredRowsByExpiration = Object.fromEntries(
      Object.entries(currentSnapshot.rowsByExpiration || {}).filter(
        ([expiration]) =>
          validKeys.has(expiration) || validValues.has(expiration),
      ),
    );
    const filteredCoverageByExpiration = Object.fromEntries(
      Object.entries(currentSnapshot.coverageByExpiration || {}).filter(
        ([expiration]) =>
          validKeys.has(expiration) || validValues.has(expiration),
      ),
    );
    const tickerInfo = ensureTradeTickerInfo(ticker, ticker);
    const rowsByExpiration = { ...filteredRowsByExpiration };
    const coverageByExpiration = { ...filteredCoverageByExpiration };
    const staleExpirationKeySet = new Set(
      (currentSnapshot.staleExpirations || []).filter(
        (expiration) =>
          validKeys.has(expiration) || validValues.has(expiration),
      ),
    );
    const refreshingExpirationKeySet = new Set();

    const hasRowsForExpiration = (expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      return Boolean(
        (chainKey && rowsByExpiration[chainKey]?.length) ||
          (expiration?.value && rowsByExpiration[expiration.value]?.length),
      );
    };

    const markExpirationStale = (expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      if (chainKey && hasRowsForExpiration(expiration)) {
        staleExpirationKeySet.add(chainKey);
      }
    };

    const applyChainResult = (expiration, data, query, coverage = "window") => {
      const chainKey = getExpirationChainKey(expiration);
      if (!chainKey) {
        return;
      }

      if (data?.contracts?.length) {
        const nextRows = buildLiveAwareOptionChainRows(
          data.contracts,
          tickerInfo.price,
        );
        rowsByExpiration[chainKey] = nextRows;
        coverageByExpiration[chainKey] = coverage;
        staleExpirationKeySet.delete(chainKey);
        return;
      }

      if (
        query?.isError ||
        (query?.isSuccess && data && !data.contracts?.length)
      ) {
        markExpirationStale(expiration);
      }
    };

    const markRefreshingExpiration = (expiration, query) => {
      const chainKey = getExpirationChainKey(expiration);
      if (
        chainKey &&
        query?.fetchStatus === "fetching" &&
        hasRowsForExpiration(expiration)
      ) {
        staleExpirationKeySet.add(chainKey);
        refreshingExpirationKeySet.add(chainKey);
      }
    };

    applyChainResult(
      activeExpiration,
      activeOptionChainQuery.data,
      activeOptionChainQuery,
      activeRequest.coverage,
    );
    batchExpirationOptions.forEach((expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      const result = chainKey ? batchResultsByChainKey.get(chainKey) : null;
      if (!result) {
        return;
      }
      applyChainResult(
        expiration,
        {
          contracts: result.contracts || [],
        },
        {
          isSuccess: result.status !== "failed",
          isError: result.status === "failed",
        },
        backgroundRequest.coverage,
      );
    });
    markRefreshingExpiration(activeExpiration, activeOptionChainQuery);
    batchExpirationOptions.forEach((expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      const queryIndex = chainKey
        ? batchQueryIndexByChainKey.get(chainKey)
        : null;
      if (typeof queryIndex === "number") {
        markRefreshingExpiration(expiration, {
          fetchStatus: batchFetchStatusByChunkIndex[queryIndex],
        });
      }
    });

    const statusByExpiration = Object.fromEntries(
      expirationOptions
        .map((expiration) => {
          const chainKey = getExpirationChainKey(expiration);
          if (!chainKey) {
            return null;
          }

          if (hasRowsForExpiration(expiration)) {
            return [chainKey, "loaded"];
          }

          if (chainKey === activeChainKey) {
            if (activeOptionChainQuery.isError) {
              return [chainKey, "failed"];
            }
            if (
              activeOptionChainQuery.fetchStatus === "fetching" ||
              activeOptionChainQuery.isPending
            ) {
              return [chainKey, "loading"];
            }
            if (activeOptionChainQuery.isSuccess) {
              return [chainKey, "empty"];
            }
          }

          const batchResult = batchResultsByChainKey.get(chainKey);
          if (batchResult) {
            return [chainKey, batchResult.status];
          }

          if (
            batchQueryIndexByChainKey.has(chainKey) &&
            (() => {
              const queryIndex = batchQueryIndexByChainKey.get(chainKey);
              return (
                queryIndex < enabledBatchChunkCount &&
                batchFetchStatusByChunkIndex[queryIndex] === "fetching"
              );
            })()
          ) {
            return [chainKey, "loading"];
          }

          return [chainKey, "queued"];
        })
        .filter(Boolean),
    );
    const trackedStatusValues = Array.from(trackedChainKeySet).map(
      (key) => statusByExpiration[key] || "queued",
    );
    const loadedExpirationCount = trackedStatusValues.filter(
      (value) => value === "loaded",
    ).length;
    const emptyExpirationCount = trackedStatusValues.filter(
      (value) => value === "empty",
    ).length;
    const failedExpirationCount = trackedStatusValues.filter(
      (value) => value === "failed",
    ).length;
    const loadingExpirations = expirationOptions
      .filter((expiration) => {
        const chainKey = getExpirationChainKey(expiration);
        return chainKey && statusByExpiration[chainKey] === "loading";
      })
      .map(getExpirationChainKey)
      .filter(Boolean);
    const totalExpirationCount = trackedChainKeySet.size;
    const completedExpirationCount =
      loadedExpirationCount + emptyExpirationCount + failedExpirationCount;
    const queuedExpirationCount = trackedStatusValues.filter(
      (value) => value === "queued",
    ).length;
    const loadingExpirationCount = loadingExpirations.length;
    const hasAnyChainError = failedExpirationCount > 0;
    const status = expirationsQuery.isPending
      ? "loading"
      : expirationsQuery.isError
        ? "offline"
        : totalExpirationCount === 0
          ? "empty"
          : loadingExpirationCount || queuedExpirationCount
            ? "loading"
            : loadedExpirationCount > 0
              ? "live"
              : hasAnyChainError
                ? "offline"
                : "empty";

    publishTradeOptionChainSnapshot(ticker, {
      expirationOptions,
      rowsByExpiration,
      loadingExpirations,
      refreshingExpirations: Array.from(refreshingExpirationKeySet),
      staleExpirations: Array.from(staleExpirationKeySet),
      statusByExpiration,
      coverageByExpiration,
      loadedExpirationCount,
      completedExpirationCount,
      emptyExpirationCount,
      failedExpirationCount,
      totalExpirationCount,
      updatedAt: Date.now(),
      status,
    });
  }, [
    activeChainKey,
    activeExpiration,
    activeOptionChainQuery.data,
    activeOptionChainQuery.dataUpdatedAt,
    activeOptionChainQuery.errorUpdatedAt,
    activeOptionChainQuery.fetchStatus,
    activeOptionChainQuery.isError,
    activeOptionChainQuery.isPending,
    activeOptionChainQuery.isSuccess,
    activeRequest.coverage,
    backgroundRequest.coverage,
    batchExpirationOptions,
    batchFetchStatusByChunkIndex,
    batchQueryIndexByChainKey,
    batchResultsByChainKey,
    enabledBatchChunkCount,
    background,
    expirationOptions,
    expirationsQuery.isError,
    expirationsQuery.isPending,
    ticker,
    trackedChainKeySet,
  ]);

  return null;
};

const TradeContractSelectionRuntime = ({
  ticker,
  contract,
  onPatchContract,
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const { expirationOptions, resolvedExpiration, chainRows } =
    resolveTradeOptionChainSnapshot(chainSnapshot, contract.exp);

  useEffect(() => {
    if (!expirationOptions.length) {
      return;
    }
    if (
      expirationOptions.some((option) =>
        doesExpirationOptionMatchValue(option, contract.exp),
      )
    ) {
      return;
    }

    const nextExpiration = resolvedExpiration || expirationOptions[0];
    const atmRow = (chainRows || []).find((row) => row.isAtm);
    onPatchContract({
      exp: nextExpiration?.value || contract.exp,
      strike: atmRow?.k ?? contract.strike,
    });
  }, [
    chainRows,
    contract.exp,
    contract.strike,
    expirationOptions,
    onPatchContract,
    resolvedExpiration,
  ]);

  useEffect(() => {
    if (!chainRows.length) {
      return;
    }
    if (chainRows.some((row) => row.k === contract.strike)) {
      return;
    }

    const atmRow =
      chainRows.find((row) => row.isAtm) ||
      chainRows[Math.floor(chainRows.length / 2)];
    onPatchContract({ strike: atmRow?.k ?? contract.strike });
  }, [chainRows, contract.strike, onPatchContract]);

  return null;
};

const TradeOptionQuoteRuntime = ({
  ticker,
  contract,
  heldContracts,
  enabled,
  visibleRows = [],
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const { chainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    contract.exp,
  );

  const quoteSubscriptionPlan = useMemo(
    () =>
      buildTradeOptionQuoteSubscriptionPlan({
        chainRows,
        contract,
        heldContracts,
        visibleRows,
      }),
    [chainRows, contract, heldContracts, visibleRows],
  );
  const executionProviderContractIds =
    quoteSubscriptionPlan.executionProviderContractIds;
  const visibleProviderContractIds =
    quoteSubscriptionPlan.visibleProviderContractIds;
  const requestedProviderContractIds =
    quoteSubscriptionPlan.requestedProviderContractIds;

  useEffect(() => {
    setOptionHydrationDiagnostics({
      ticker,
      expiration: contract.exp,
      requestedQuotes: requestedProviderContractIds.length,
      pendingQuotes: 0,
      activeQuoteSubscriptions:
        requestedProviderContractIds.length,
      pinnedQuoteSubscriptions: executionProviderContractIds.length,
      rotatingQuoteSubscriptions: 0,
      quoteMode: "websocket-backend-admission-visible-window",
    });
  }, [
    contract.exp,
    executionProviderContractIds.length,
    requestedProviderContractIds.length,
    ticker,
  ]);

  useIbkrOptionQuoteStream({
    underlying: ticker,
    providerContractIds: executionProviderContractIds,
    enabled: Boolean(
      enabled &&
        ticker &&
        executionProviderContractIds.length > 0,
    ),
    owner: `trade-option-execution:${ticker || "unknown"}`,
    intent: "execution-live",
    requiresGreeks: true,
  });

  useIbkrOptionQuoteStream({
    underlying: ticker,
    providerContractIds: visibleProviderContractIds,
    enabled: Boolean(
      enabled &&
        ticker &&
        visibleProviderContractIds.length > 0,
    ),
    owner: `trade-option-visible:${ticker || "unknown"}`,
    intent: "visible-live",
    requiresGreeks: true,
  });

  return null;
};

export const TradeScreen = ({
  sym,
  symPing,
  session,
  environment,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  isVisible = false,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const positions = usePositions();
  const [tradeRootRef, tradeRootSize] = useElementSize();
  const tradeWidth = tradeRootSize.width;
  const { isPhone: tradeIsPhone, isNarrow: tradeIsNarrow } =
    responsiveFlags(tradeWidth);
  const tradeLayout = tradeIsPhone ? "phone" : tradeIsNarrow ? "tablet" : "desktop";
  const tradeTopGridTemplate = tradeIsPhone
    ? "minmax(0, 1fr)"
    : tradeIsNarrow
      ? "minmax(0, 1fr) minmax(min(100%, 320px), 0.9fr)"
      : "minmax(520px, 1.25fr) minmax(300px, 0.75fr) minmax(320px, 0.8fr)";
  const tradeMiddleGridTemplate = tradeIsNarrow
    ? "minmax(0, 1fr)"
    : "1.55fr 0.95fr 1.2fr";
  const tradeBottomGridTemplate = tradeIsPhone
    ? "minmax(0, 1fr)"
    : tradeIsNarrow
      ? "minmax(0, 1fr) minmax(min(100%, 360px), 0.9fr)"
      : "minmax(280px, 1fr) minmax(280px, 1fr) minmax(360px, 1.4fr)";
  const tradeTopHeight = tradeIsNarrow ? "auto" : dim(560);
  const tradeMiddleHeight = tradeIsNarrow ? "auto" : dim(320);
  const tradeBottomHeight = tradeIsNarrow ? "auto" : dim(300);
  // Initialize from persisted state, falling back to sym prop or sensible defaults
  const initialTicker = (() => {
    const resolved = resolveInitialTradeTicker({
      persistedActive: _initialState.tradeActiveTicker,
      sym,
      symPing,
    });
    ensureTradeTickerInfo(resolved, resolved);
    return resolved;
  })();
  const initialRecent = (() => {
    const persistedRecent = _initialState.tradeRecentTickers;
    if (Array.isArray(persistedRecent) && persistedRecent.length > 0) {
      const valid = persistedRecent
        .map((ticker) => {
          ensureTradeTickerInfo(ticker, ticker);
          return ticker;
        })
        .filter(Boolean);
      if (valid.length > 0) return valid;
    }
    return [initialTicker, "QQQ", "NVDA"].filter(
      (t, i, a) => a.indexOf(t) === i,
    );
  })();
  const initialContracts = (() => {
    const persistedContracts = _initialState.tradeContracts;
    return persistedContracts && typeof persistedContracts === "object"
      ? persistedContracts
      : {};
  })();
  const initialWorkspaces = (() =>
    normalizeTradeWorkspaces({
      recentTickers: initialRecent,
      contracts: initialContracts,
      stored:
        _initialState.tradeWorkspaces &&
        typeof _initialState.tradeWorkspaces === "object"
          ? _initialState.tradeWorkspaces
          : {},
    }))();
  const [activeTicker, setActiveTicker] = useState(initialTicker);
  const [recentTickers, setRecentTickers] = useState(initialRecent);
  const [tradeWorkspaces, setTradeWorkspaces] = useState(initialWorkspaces);
  const [tradeRecentTickerRows, setTradeRecentTickerRows] = useState(() =>
    Array.isArray(_initialState.tradeRecentTickerRows)
      ? _initialState.tradeRecentTickerRows.slice(0, 10)
      : [],
  );
  const [contracts, setContracts] = useState(initialContracts);
  const [automationContext, setAutomationContext] = useState(null);
  const [tradeTickerSearchAnchor, setTradeTickerSearchAnchor] = useState(null);
  const [tradeChainHeatmapEnabled, setTradeChainHeatmapEnabled] = useState(
    Boolean(_initialState.tradeChainHeatmapEnabled),
  );
  const [tradeOptionChainCoverage, setTradeOptionChainCoverage] = useState(() =>
    normalizeTradeOptionChainCoverage(
      _initialState.tradeOptionChainCoverage ?? DEFAULT_OPTION_CHAIN_COVERAGE,
    ),
  );
  const [visibleOptionChainRows, setVisibleOptionChainRows] = useState([]);
  const stockAggregateStreamingEnabled = Boolean(
    brokerConfigured && brokerAuthenticated,
  );
  const activeTickerInfo = ensureTradeTickerInfo(activeTicker, activeTicker);
  const activeWorkspace =
    tradeWorkspaces[activeTicker] || createTradeWorkspace(activeTicker);
  const contract =
    contracts[activeTicker] ||
    activeWorkspace.selectedContract ||
    (() => {
      return {
        strike: getAtmStrikeFromPrice(activeTickerInfo.price) ?? null,
        cp: "C",
        exp: "",
      };
    })();
  const tradeLiveStreamsEnabled = Boolean(isVisible && !tradeTickerSearchAnchor);
  const tradeBrokerStreamingEnabled = Boolean(
    tradeLiveStreamsEnabled && stockAggregateStreamingEnabled,
  );
  const broadFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    { subscribe: isVisible },
  );
  const activeTickerTradeFlowSnapshot = useTradeFlowSnapshot(activeTicker, {
    subscribe: isVisible,
  });
  const activeTickerBroadFlowEvents = useMemo(
    () => filterFlowEventsForSymbol(broadFlowSnapshot.flowEvents || [], activeTicker),
    [activeTicker, broadFlowSnapshot.flowEvents],
  );
  const activeTickerChartFlowEvents = useMemo(
    () =>
      mergeFlowEventFeeds(
        activeTickerTradeFlowSnapshot.events || [],
        activeTickerBroadFlowEvents,
      ),
    [activeTickerBroadFlowEvents, activeTickerTradeFlowSnapshot.events],
  );
  useRuntimeWorkloadFlag("trade:streams", tradeBrokerStreamingEnabled, {
    kind: "stream",
    label: "Trade live streams",
    detail: activeTicker,
    priority: 2,
  });
  const trimRecentTickers = useCallback((tickers) => {
    const unique = [...new Set(tickers.map(normalizeTradeTickerSymbol).filter(Boolean))];
    return unique.slice(-TRADE_RECENT_TICKER_LIMIT);
  }, []);
  const upsertTradeWorkspace = useCallback((ticker, patch = {}) => {
    const normalized = normalizeTradeTickerSymbol(ticker);
    if (!normalized) return;
    setTradeWorkspaces((current) => {
      const existing = current[normalized] || createTradeWorkspace(normalized);
      const next = {
        ...current,
        [normalized]: {
          ...existing,
          ...patch,
          ticker: normalized,
          id: normalized,
          updatedAt: new Date().toISOString(),
        },
      };
      return next;
    });
  }, []);
  const updateContract = useCallback(
    (patch) => {
      const nextContract = { ...contract, ...patch };
      setContracts((current) => ({
        ...current,
        [activeTicker]: nextContract,
      }));
      upsertTradeWorkspace(activeTicker, { selectedContract: nextContract });
    },
    [activeTicker, contract, upsertTradeWorkspace],
  );
  const tradePositionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(isVisible && brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const tradeOrdersQuery = useListOrders(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(isVisible && brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const heldContracts = useMemo(() => {
    if (brokerConfigured) {
      if (!brokerAuthenticated || !accountId) {
        return [];
      }

      return (tradePositionsQuery.data?.positions || [])
        .filter(
          (position) =>
            isOpenPositionRow(position) &&
            position.symbol === activeTicker &&
            position.assetClass === "option" &&
            position.optionContract,
        )
        .map((position) => ({
          strike: position.optionContract.strike,
          cp: position.optionContract.right === "call" ? "C" : "P",
          exp: formatExpirationLabel(position.optionContract.expirationDate),
          providerContractId: position.optionContract.providerContractId,
          entry: position.averagePrice,
          qty: Math.abs(position.quantity),
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
        }));
    }

    return positions.positions
      .filter(
        (position) =>
          position.kind === "option" && position.ticker === activeTicker,
      )
      .map((position) => ({
        strike: position.strike,
        cp: position.cp,
        exp: position.exp,
        providerContractId: null,
        entry: position.entry,
        qty: position.qty,
        pnl: null,
        pct: null,
      }));
  }, [
    accountId,
    activeTicker,
    brokerAuthenticated,
    brokerConfigured,
    environment,
    positions.positions,
    tradePositionsQuery.data,
  ]);
  const handleVisibleOptionChainRowsChange = useCallback((rows) => {
    const nextRows = Array.isArray(rows) ? rows : [];
    setVisibleOptionChainRows((current) =>
      buildTradeChainRowsSignature(current) ===
      buildTradeChainRowsSignature(nextRows)
        ? current
        : nextRows,
    );
  }, []);

  // Persist trade state changes
  useEffect(() => {
    persistState({ tradeActiveTicker: activeTicker });
  }, [activeTicker]);
  useEffect(() => {
    persistState({ tradeRecentTickers: recentTickers });
  }, [recentTickers]);
  useEffect(() => {
    persistState({ tradeWorkspaces });
  }, [tradeWorkspaces]);
  useEffect(() => {
    persistState({ tradeRecentTickerRows });
  }, [tradeRecentTickerRows]);
  useEffect(() => {
    persistState({ tradeContracts: contracts });
  }, [contracts]);
  useEffect(() => {
    persistState({ tradeChainHeatmapEnabled });
  }, [tradeChainHeatmapEnabled]);
  useEffect(() => {
    persistState({ tradeOptionChainCoverage });
  }, [tradeOptionChainCoverage]);
  useEffect(() => {
    setVisibleOptionChainRows([]);
  }, [activeTicker, contract.exp, tradeOptionChainCoverage]);
  useEffect(() => {
    if (typeof activeWorkspace.chainHeatmapEnabled === "boolean") {
      setTradeChainHeatmapEnabled(activeWorkspace.chainHeatmapEnabled);
    }
  }, [activeTicker]);

  // Helper: focus a ticker, and add to recent strip if not present
  const focusTicker = useCallback((ticker, fallbackName = ticker) => {
    const normalized = normalizeTradeTickerSymbol(ticker);
    if (!normalized) return;
    ensureTradeTickerInfo(normalized, fallbackName);
    upsertTradeWorkspace(normalized, {});
    setActiveTicker(normalized);
    setRecentTickers((prev) =>
      prev.includes(normalized)
        ? prev
        : trimRecentTickers([...prev, normalized]),
    );
  }, [trimRecentTickers, upsertTradeWorkspace]);
  const closeTicker = useCallback(
    (ticker) => {
      const normalized = normalizeTradeTickerSymbol(ticker);
      setRecentTickers((prev) => {
        const filtered = prev.filter((t) => t !== normalized);
        if (normalized === activeTicker && filtered.length > 0)
          setActiveTicker(filtered[0]);
        return filtered;
      });
    },
    [activeTicker],
  );
  const reorderTradeTickers = useCallback((fromTicker, toTicker, side = "before") => {
    const normalizedFrom = normalizeTradeTickerSymbol(fromTicker);
    const normalizedTo = normalizeTradeTickerSymbol(toTicker);
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) return;

    setRecentTickers((current) => {
      const fromIndex = current.indexOf(normalizedFrom);
      const toIndex = current.indexOf(normalizedTo);
      if (fromIndex < 0 || toIndex < 0) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      let insertIndex = toIndex + (side === "after" ? 1 : 0);
      if (fromIndex < insertIndex) insertIndex -= 1;
      insertIndex = Math.max(0, Math.min(insertIndex, next.length));
      next.splice(insertIndex, 0, moved);

      return next.every((ticker, index) => ticker === current[index]) ? current : next;
    });
  }, []);
  const openEquitySearch = useCallback(
    () => setTradeTickerSearchAnchor("equity"),
    [],
  );
  // Watchlist sync
  useLayoutEffect(() => {
    if (!symPing || symPing.n === 0) return;
    const normalizedSym = normalizeTradeTickerSymbol(symPing.sym);
    if (!normalizedSym) return;
    ensureTradeTickerInfo(normalizedSym, normalizedSym);
    focusTicker(normalizedSym);
    if (Object.hasOwn(symPing, "automationCandidate")) {
      setAutomationContext(symPing.automationCandidate || null);
    }
    if (symPing.contract) {
      const incoming = symPing.contract;
      setContracts((current) => {
        const info = ensureTradeTickerInfo(normalizedSym, normalizedSym);
        const existing = current[normalizedSym] || {
          strike: getAtmStrikeFromPrice(info.price) ?? null,
          cp: "C",
          exp: incoming.exp || "",
        };

        return {
          ...current,
          [normalizedSym]: {
            ...existing,
            ...incoming,
          },
        };
      });
      upsertTradeWorkspace(normalizedSym, {
        selectedContract: {
          ...(tradeWorkspaces[normalizedSym]?.selectedContract ||
            createTradeWorkspace(normalizedSym).selectedContract),
          ...incoming,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symPing && symPing.n]);

  // Strategy → pick a strike near the desired delta on the active ticker's chain
  const applyStrategy = useCallback(
    (strategy) => {
      const snapshot = getTradeOptionChainSnapshot(activeTicker);
      const { expirationOptions, chainRows } = resolveTradeOptionChainSnapshot(
        snapshot,
        contract.exp,
      );
      if (!chainRows.length) {
        toast.push({
          kind: "info",
          title: "Chain still loading",
          body: "Wait for a live option chain before applying a strategy preset.",
        });
        return;
      }
      const chain = chainRows;
      let bestStrike = chain[0].k;
      let bestDist = Infinity;
      for (const row of chain) {
        const d = Math.abs(strategy.cp === "C" ? row.cDelta : row.pDelta);
        const dist = Math.abs(d - strategy.deltaTarget);
        if (dist < bestDist) {
          bestDist = dist;
          bestStrike = row.k;
        }
      }
      const targetExpiration = expirationOptions.length
        ? expirationOptions.reduce(
            (closest, option) =>
              Math.abs(option.dte - strategy.dte) <
              Math.abs(closest.dte - strategy.dte)
                ? option
                : closest,
            expirationOptions[0],
          ).value
        : contract.exp;
      updateContract({
        strike: bestStrike,
        cp: strategy.cp,
        exp: targetExpiration,
      });
    },
    [activeTicker, contract.exp, toast, updateContract],
  );

  // Slot prop adapter for existing components that expect { ticker, strike, cp, exp }
  const slot = useMemo(
    () => ({ ticker: activeTicker, ...contract }),
    [activeTicker, contract],
  );
  const toggleTabSearch = useCallback(
    () =>
      setTradeTickerSearchAnchor((anchor) =>
        anchor === "tabs" ? null : "tabs",
      ),
    [],
  );
  const closeTradeTickerSearch = useCallback(
    () => setTradeTickerSearchAnchor(null),
    [],
  );
  const handleEquitySearchOpenChange = useCallback((open) => {
    setTradeTickerSearchAnchor(open ? "equity" : null);
  }, []);
  const handleRememberTradeTickerRow = useCallback((row) => {
    const normalized = row?.ticker?.trim?.().toUpperCase?.();
    if (!normalized) return;
    const rowKey = [
      normalized,
      row?.market || "",
      row?.normalizedExchangeMic || row?.primaryExchange || "",
      row?.providerContractId || "",
    ].join("|");
    setTradeRecentTickerRows((current) =>
      [
        row,
        ...current.filter((entry) => {
          const entryTicker = entry?.ticker?.trim?.().toUpperCase?.();
          const entryKey = [
            entryTicker,
            entry?.market || "",
            entry?.normalizedExchangeMic || entry?.primaryExchange || "",
            entry?.providerContractId || "",
          ].join("|");
          return entryKey !== rowKey;
        }),
      ].slice(0, 10),
    );
  }, []);
  const handleSelectUniverseTicker = useCallback(
    (result) => {
      const nextTicker = normalizeTradeTickerSymbol(result?.ticker);
      if (!nextTicker) {
        return;
      }

      ensureTradeTickerInfo(nextTicker, result?.name || nextTicker);
      handleRememberTradeTickerRow(result);
      focusTicker(nextTicker, result?.name || nextTicker);
      setTradeTickerSearchAnchor(null);
    },
    [focusTicker, handleRememberTradeTickerRow],
  );
  const handleSelectContract = useCallback(
    (strike, cp) => updateContract({ strike, cp }),
    [updateContract],
  );
  const handleChangeExpiration = useCallback(
    (exp) => updateContract({ exp }),
    [updateContract],
  );
  const handleChangeOptionChainCoverage = useCallback(
    (value) => {
      const nextCoverage = normalizeTradeOptionChainCoverage(value);
      setTradeOptionChainCoverage((current) =>
        current === nextCoverage ? current : nextCoverage,
      );
      clearTradeOptionChainSnapshot(activeTicker);
      queryClient.invalidateQueries({
        queryKey: ["trade-option-chain", activeTicker],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: ["trade-option-chain-batch", activeTicker],
        exact: false,
      });
    },
    [activeTicker, queryClient],
  );
  const handleRetryExpiration = useCallback(
    (expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      if (!chainKey) {
        return;
      }

      const queryKey = ["trade-option-chain", activeTicker, chainKey];
      queryClient.invalidateQueries({ queryKey, exact: false });
      queryClient.refetchQueries({
        queryKey,
        exact: false,
        type: "active",
      });
      queryClient.invalidateQueries({
        queryKey: ["trade-option-chain-batch", activeTicker],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/options/expirations"],
        exact: false,
      });
    },
    [activeTicker, queryClient],
  );
  const handleLoadPosition = useCallback(
    ({ ticker, strike, cp, exp }) => {
      focusTicker(ticker);
      setContracts((current) => ({
        ...current,
        [ticker]: { strike, cp, exp },
      }));
    },
    [focusTicker],
  );
  const renderTradeTickerSearch = useCallback(
    (open, embedded = true) => (
      <MiniChartTickerSearch
        open={open}
        ticker={activeTicker}
        recentTickerRows={tradeRecentTickerRows}
        contextSymbols={recentTickers}
        embedded={embedded}
        onClose={closeTradeTickerSearch}
        onSelectTicker={handleSelectUniverseTicker}
        onRememberTickerRow={handleRememberTradeTickerRow}
      />
    ),
    [
      activeTicker,
      closeTradeTickerSearch,
      handleRememberTradeTickerRow,
      handleSelectUniverseTicker,
      recentTickers,
      tradeRecentTickerRows,
    ],
  );

  useEffect(() => {
    if (isVisible) {
      return;
    }

    queryClient.removeQueries({
      predicate: (query) => isTradeHeavyQueryKey(query.queryKey, activeTicker),
      type: "inactive",
    });
    clearTradeFlowSnapshot(activeTicker);
  }, [activeTicker, isVisible, queryClient]);

  const automationContract = asRecord(automationContext?.selectedContract);
  const automationContractCp = automationContract.right === "put" ? "P" : "C";
  const automationContractExp = formatExpirationLabel(
    automationContract.expirationDate,
  );
  const automationContextVisible =
    automationContext &&
    String(automationContext.symbol || "").toUpperCase() === activeTicker;
  const automationContractMatches =
    automationContextVisible &&
    Number(automationContract.strike) === Number(contract.strike) &&
    automationContractCp === contract.cp &&
    automationContractExp === contract.exp;
  const workspaceReferenceLines = (activeWorkspace.levels || [])
    .filter((level) => Number.isFinite(Number(level.price)))
    .map((level) => ({
      price: Number(level.price),
      color:
        level.tone === "stop"
          ? T.red
          : level.tone === "support"
            ? T.green
            : level.tone === "resistance"
              ? T.amber
              : T.cyan,
      lineWidth: 1,
      axisLabelVisible: true,
      title: level.label || "Level",
    }));
  return (
    <div
      ref={tradeRootRef}
      data-trade-layout={tradeLayout}
      className="ra-panel-enter"
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* Tab strip */}
      <div style={{ position: "relative", flexShrink: 0, overflow: "visible" }}>
        <TickerTabStrip
          recent={recentTickers}
          active={activeTicker}
          workspacesByTicker={tradeWorkspaces}
          onSelect={focusTicker}
          onClose={closeTicker}
          onAddNew={toggleTabSearch}
          onReorder={reorderTradeTickers}
        />
        {renderTradeTickerSearch(tradeTickerSearchAnchor === "tabs", false)}
      </div>
      <TradeQuoteRuntime
        ticker={activeTicker}
        enabled={tradeLiveStreamsEnabled}
        stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
      />
      <TradeOptionChainRuntime
        ticker={activeTicker}
        expirationValue={contract.exp}
        chainCoverage={tradeOptionChainCoverage}
        enabled={isVisible && !tradeTickerSearchAnchor}
      />
      <TradeFlowRuntime
        ticker={activeTicker}
        enabled={tradeLiveStreamsEnabled}
        timeframe={activeWorkspace.equityChart?.timeframe || "5m"}
      />
      <TradeContractSelectionRuntime
        ticker={activeTicker}
        contract={contract}
        onPatchContract={updateContract}
      />
      <TradeOptionQuoteRuntime
        ticker={activeTicker}
        contract={contract}
        heldContracts={heldContracts}
        enabled={tradeBrokerStreamingEnabled}
        visibleRows={visibleOptionChainRows}
      />
      {/* Main workspace */}
      <div
        className="ra-panel-enter"
        style={{
          flex: 1,
          padding: sp(tradeIsPhone ? 4 : 6),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "auto",
          minWidth: 0,
        }}
      >
        {/* Compact ticker header */}
        <MemoTradeTickerHeader
          ticker={activeTicker}
          expirationValue={contract.exp}
        />
        {automationContextVisible && (
          <div
            className="ra-panel-enter ra-focus-rail"
            style={{
              ...motionVars({
                accent: automationContractMatches ? T.cyan : T.amber,
              }),
              background: automationContractMatches ? `${T.cyan}12` : `${T.amber}12`,
              border: `1px solid ${
                automationContractMatches ? `${T.cyan}35` : `${T.amber}45`
              }`,
              borderRadius: dim(6),
              padding: sp("8px 10px"),
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: sp(12),
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  gap: sp(8),
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    color: T.text,
                    fontFamily: T.display,
                    fontSize: fs(11),
                    fontWeight: 400,
                  }}
                >
                  Signal-options context
                </span>
                <span
                  style={{
                    color: automationContractMatches ? T.cyan : T.amber,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    fontWeight: 400,
                  }}
                >
                  {automationContractMatches ? "MATCHED" : "MANUAL OVERRIDE"}
                </span>
              </div>
              <div
                style={{
                  color: T.textSec,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  marginTop: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {automationContext.direction?.toUpperCase?.() || "SIGNAL"} ·{" "}
                {automationContext.timeframe || "timeframe"} · planned{" "}
                {formatOptionContractLabel(
                  {
                    exp: automationContractExp,
                    strike: automationContract.strike,
                    cp: automationContractCp,
                  },
                  { includeSymbol: false },
                )}{" "}
                · fill{" "}
                {Number.isFinite(
                  Number(asRecord(automationContext.orderPlan).simulatedFillPrice),
                )
                  ? Number(
                      asRecord(automationContext.orderPlan).simulatedFillPrice,
                    ).toFixed(2)
                  : MISSING_VALUE}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAutomationContext(null)}
              style={{
                padding: sp("6px 8px"),
                borderRadius: dim(4),
                border: `1px solid ${T.border}`,
                background: T.bg0,
                color: T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 400,
                cursor: "pointer",
              }}
            >
              CLEAR
            </button>
          </div>
        )}
        {/* Top zone: Equity chart + selected contract chart + order ticket */}
        <div
          data-testid="trade-top-zone"
          className="ra-panel-enter"
          style={{
            display: "grid",
            gridTemplateColumns: tradeTopGridTemplate,
            gap: sp(6),
            height: tradeTopHeight,
            flexShrink: 0,
            minWidth: 0,
            alignItems: "stretch",
          }}
        >
          <MemoTradeEquityPanel
            ticker={activeTicker}
            flowEvents={activeTickerChartFlowEvents}
            historicalDataEnabled={isVisible && !tradeTickerSearchAnchor}
            stockAggregateStreamingEnabled={tradeBrokerStreamingEnabled}
            onOpenSearch={openEquitySearch}
            searchOpen={tradeTickerSearchAnchor === "equity"}
            onSearchOpenChange={handleEquitySearchOpenChange}
            searchContent={renderTradeTickerSearch(
              tradeTickerSearchAnchor === "equity",
            )}
            workspaceChart={activeWorkspace.equityChart}
            onWorkspaceChartChange={(patch) =>
              upsertTradeWorkspace(activeTicker, {
                equityChart: {
                  ...activeWorkspace.equityChart,
                  ...patch,
                },
              })
            }
            referenceLines={workspaceReferenceLines}
          />
          <MemoTradeContractDetailPanel
            ticker={activeTicker}
            contract={contract}
            heldContracts={heldContracts}
            flowEvents={activeTickerChartFlowEvents}
            historicalDataEnabled={isVisible && !tradeTickerSearchAnchor}
            liveDataEnabled={tradeLiveStreamsEnabled}
          />
          <MemoTradeOrderTicket
            slot={slot}
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            gatewayTradingReady={gatewayTradingReady}
            gatewayTradingMessage={gatewayTradingMessage}
            brokerPositions={tradePositionsQuery.data?.positions || []}
            brokerOrders={tradeOrdersQuery.data?.orders || []}
            brokerPositionContextReady={Boolean(
              brokerAuthenticated && accountId && tradePositionsQuery.data,
            )}
            brokerOrderContextReady={Boolean(
              brokerAuthenticated &&
                accountId &&
                tradeOrdersQuery.data &&
                !tradeOrdersQuery.data.degraded,
            )}
            automationContext={automationContextVisible ? automationContext : null}
          />
        </div>
        {/* Middle zone: options chain + spot flow + options flow */}
        <div
          data-testid="trade-middle-zone"
          className="ra-panel-enter"
          style={{
            display: "grid",
            gridTemplateColumns: tradeMiddleGridTemplate,
            gap: sp(6),
            height: tradeMiddleHeight,
            flexShrink: 0,
            minWidth: 0,
            alignItems: "stretch",
          }}
        >
          <MemoTradeChainPanel
            ticker={activeTicker}
            contract={contract}
            heldContracts={heldContracts}
            onSelectContract={handleSelectContract}
            onChangeExp={handleChangeExpiration}
            onRetryExpiration={handleRetryExpiration}
            heatmapEnabled={tradeChainHeatmapEnabled}
            onToggleHeatmap={() =>
              setTradeChainHeatmapEnabled((current) => {
                const next = !current;
                upsertTradeWorkspace(activeTicker, { chainHeatmapEnabled: next });
                return next;
              })
            }
            chainCoverageValue={tradeOptionChainCoverage}
            chainCoverageOptions={OPTION_CHAIN_COVERAGE_VALUES}
            onChangeChainCoverage={handleChangeOptionChainCoverage}
            onVisibleRowsChange={handleVisibleOptionChainRowsChange}
          />
          <MemoTradeSpotFlowPanel ticker={activeTicker} />
          <MemoTradeOptionsFlowPanel ticker={activeTicker} />
        </div>
        {/* Bottom zone: Strategy/Greeks + L2/Tape/Flow tabs + Positions */}
        <div
          data-testid="trade-bottom-zone"
          className="ra-panel-enter"
          style={{
            display: "grid",
            gridTemplateColumns: tradeBottomGridTemplate,
            gap: sp(6),
            height: tradeBottomHeight,
            flexShrink: 0,
            minWidth: 0,
            alignItems: "stretch",
          }}
        >
          <MemoTradeStrategyGreeksPanel
            slot={slot}
            onApplyStrategy={applyStrategy}
          />
          <MemoTradeL2Panel
            slot={slot}
            accountId={accountId}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            isVisible={isVisible}
            streamingPaused={!tradeBrokerStreamingEnabled}
          />
          <MemoTradePositionsPanel
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            gatewayTradingReady={gatewayTradingReady}
            gatewayTradingMessage={gatewayTradingMessage}
            isVisible={isVisible}
            streamingPaused={!tradeBrokerStreamingEnabled}
            onLoadPosition={handleLoadPosition}
          />
        </div>
      </div>
    </div>
  );
};

export default TradeScreen;
