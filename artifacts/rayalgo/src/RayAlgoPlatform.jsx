import {
  createContext,
  Fragment,
  memo,
  useState,
  useEffect,
  useRef,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  lazy,
  Suspense,
  startTransition,
  useDeferredValue,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ComposedChart,
} from "recharts";
import * as d3 from "d3";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  Gauge,
  GripVertical,
  Power,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  getBars as getBarsRequest,
  getFlowUniverse as getFlowUniverseRequest,
  getGetNewsQueryOptions,
  getGetQuoteSnapshotsQueryOptions,
  getGetResearchEarningsCalendarQueryOptions,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalMonitorStateQueryKey,
  getListAlgoDeploymentsQueryOptions,
  getListBacktestDraftStrategiesQueryOptions,
  getListSignalMonitorEventsQueryKey,
  listFlowEvents as listFlowEventsRequest,
  useCancelOrder,
  useEvaluateSignalMonitor,
  useGetNews,
  useGetQuoteSnapshots,
  useGetResearchEarningsCalendar,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
  useListAlgoDeployments,
  useListBacktestDraftStrategies,
  useListExecutionEvents,
  useListOrders,
  useListSignalMonitorEvents,
  useSearchUniverseTickers,
  useCreateAlgoDeployment,
  useEnableAlgoDeployment,
  useGetSession,
  useListAccounts,
  useListPositions,
  useListWatchlists,
  usePauseAlgoDeployment,
  usePlaceOrder,
  usePreviewOrder,
  useReplaceOrder,
  useSubmitOrders,
  useUpdateSignalMonitorProfile,
} from "@workspace/api-client-react";
import {
  ResearchSparkline,
  ResearchChartFrame,
  ResearchChartSurface,
  ResearchChartWidgetHeader,
  ResearchChartWidgetFooter,
  ResearchChartWidgetSidebar,
  RayReplicaSettingsMenu,
  RAY_REPLICA_PINE_SCRIPT_KEY,
  resolveRayReplicaRuntimeSettings,
  buildResearchChartModelIncremental,
  getActiveChartBarStoreEntryCount,
  getChartHydrationStatsSnapshot,
  sanitizeChartHydrationStatsForDiagnostics,
  getBrokerStockAggregateDebugStats,
  useIndicatorLibrary,
  useDrawingHistory,
  useBrokerStockAggregateStream,
  useBrokerStreamedBars,
  useHistoricalBarStream,
  useIbkrLatencyStats,
  setBrokerStockAggregateStreamPaused,
  useChartHydrationStats,
  usePrependableHistoricalBars,
  DISPLAY_CHART_OUTSIDE_RTH,
  DISPLAY_CHART_PRICE_TIMEFRAME,
  expandLocalRollupLimit,
  getChartBarLimit,
  getChartTimeframeOptions,
  getChartTimeframeValues,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
  resolveLocalRollupBaseTimeframe,
  resolveChartTimeframeFavorites,
  resolveDisplayChartPrice,
  resolveSpotChartFrameLayout,
  rollupMarketBars,
  normalizeChartTimeframe,
  recordChartBarScopeState,
  toggleChartTimeframeFavorite,
  useStockMinuteAggregateSymbolsVersion,
  flowEventsToChartEvents,
} from "./features/charting";
import { useOptionChartBars } from "./features/charting/useOptionChartBars.js";
import {
  AlgoDraftStrategiesPanel,
  BacktestWorkspace,
} from "./features/backtesting/BacktestingPanels";
import {
  getOptionQuoteSnapshotCacheSize,
  useIbkrAccountSnapshotStream,
  useIbkrOptionChainStream,
  useIbkrOrderSnapshotStream,
  useIbkrQuoteSnapshotStream,
  useShadowAccountSnapshotStream,
  useStoredOptionQuoteSnapshot,
} from "./features/platform/live-streams";
import { usePageVisible } from "./features/platform/usePageVisible";
import BloombergLiveDock from "./features/platform/BloombergLiveDock";
import {
  getRuntimeWorkloadStats,
  useRuntimeWorkloadFlag,
  useRuntimeWorkloadStats,
} from "./features/platform/workloadStats";
import {
  HYDRATION_PRIORITY,
  HYDRATION_PRIORITY_HEADER,
  buildHydrationRequestOptions,
  useHydrationIntent,
} from "./features/platform/hydrationCoordinator";
import {
  getIbkrConnection,
  getIbkrGatewayBadges,
  getIbkrConnectionTone,
  getIbkrStreamStateMeta,
  formatIbkrPingMs,
  IbkrPingWavelength,
  resolveIbkrGatewayHealth,
} from "./features/platform/IbkrConnectionStatus";
import { buildHeaderIbkrPopoverModel } from "./features/platform/ibkrPopoverModel";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  buildMarketFlowStoreKey,
  clearMarketFlowSnapshot,
  setFlowScannerControlState,
  getMarketFlowStoreEntryCount,
  publishMarketFlowSnapshot,
  useFlowScannerControlState,
  useMarketFlowSnapshot,
  useMarketFlowSnapshotForStoreKey,
} from "./features/platform/marketFlowStore";
import {
  FLOW_BUILT_IN_PRESETS,
  FLOW_MIN_PREMIUM_OPTIONS,
  FLOW_TAPE_FILTER_OPTIONS,
  buildFlowTapePresetPatch,
  setFlowTapeFilterState,
  useFlowTapeFilterState,
} from "./features/platform/flowFilterStore";
import {
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
  getHeaderBroadcastSpeedDurations,
  HEADER_BROADCAST_SPEED_PRESETS,
  resolveHeaderBroadcastSpeedPreset,
} from "./features/platform/headerBroadcastModel";
import {
  SIGNAL_MONITOR_TIMEFRAMES,
  buildMarketActivityLanes,
  normalizeSignalMonitorTimeframe,
} from "./features/platform/marketActivityLaneModel";
import {
  buildSmartTickerSuggestions,
  flattenTickerSuggestionGroups,
} from "./features/platform/tickerSearch/model";
import {
  MarketIdentityChips,
  MarketIdentityInline,
  MarketIdentityMark,
  resolveMarketIdentity,
} from "./features/platform/marketIdentity";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  FLOW_SCANNER_CONFIG_LIMITS,
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_SCOPE,
  buildFlowScannerSymbols,
  filterFlowScannerEvents,
  normalizeFlowScannerConfig,
  runFlowScannerBatch,
} from "./features/platform/marketFlowScannerConfig";
import {
  EMPTY_PREMIUM_FLOW_SUMMARY,
  buildPremiumFlowBySymbol,
  resolvePremiumFlowDisplayState,
} from "./features/platform/premiumFlowIndicator";
import {
  calculateOptionTradePremium,
  classifyOptionMoneyness,
  inferFlowBias,
} from "./features/platform/optionsPremiumModel";
import { publishMarketAlertsSnapshot } from "./features/platform/marketAlertsStore";
import {
  publishSignalMonitorSnapshot,
  useSignalMonitorSnapshot,
  useSignalMonitorStateForSymbol,
} from "./features/platform/signalMonitorStore";
import {
  WATCHLIST_SORT_MODE,
  buildWatchlistRows,
  countWatchlistSymbols,
  sortWatchlistRows,
} from "./features/platform/watchlistModel";
import {
  getTradeFlowStoreEntryCount,
  useTradeFlowSnapshot,
} from "./features/platform/tradeFlowStore";
import {
  getTradeOptionChainStoreEntryCount,
  publishTradeOptionChainSnapshot,
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "./features/platform/tradeOptionChainStore";
import {
  normalizeFlowOptionExpirationIso,
  normalizeFlowOptionRight,
  normalizeFlowOptionStrike,
} from "./features/platform/flowOptionChartIdentity";
import { buildSignalOptionsDeviation } from "./features/trade/automationDeviationModel";
import {
  TICKET_ASSET_MODES,
  TICKET_ORDER_TYPES,
  TRADING_EXECUTION_MODES,
  buildTwsBracketOrders,
  formatTicketOrderType,
  getDefaultTicketRiskPrices,
  isTwsStructuredOrderPayload,
  normalizeTicketAssetMode,
  normalizeTicketOrderType,
  normalizeTradingExecutionMode,
  resolveTicketOrderPrices,
  validateTicketBracket,
} from "./features/trade/ibkrOrderTicketModel";
import {
  getCurrentTheme,
  MISSING_VALUE,
  RAYALGO_STORAGE_KEY,
  T,
  dim,
  fs,
  setCurrentDensity,
  setCurrentScale,
  setCurrentTheme,
  sp,
} from "./lib/uiTokens";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
  useValueFlash,
} from "./lib/motion";
import {
  clearChartHydrationScope,
  consumeChartLivePatchPending,
  recordChartHydrationMetric,
} from "./features/charting/chartHydrationStats";
import {
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "./features/charting/chartBarsPayloads";
import { useUserPreferences } from "./features/preferences/useUserPreferences";
import {
  formatPreferenceDateTime,
  formatPreferenceTimeZoneLabel,
  USER_PREFERENCES_UPDATED_EVENT,
} from "./features/preferences/userPreferenceModel";
import {
  formatAppDate,
  formatAppTime,
  formatAppTimeForPreferences,
} from "./lib/timeZone";
import { isOpenPositionRow } from "./screens/account/accountPositionRows.js";

const MarketScreen = lazy(() => import("./screens/MarketScreen"));
const FlowScreen = lazy(() => import("./screens/FlowScreen"));
const TradeScreen = lazy(() => import("./screens/TradeScreen"));
const AccountScreen = lazy(() => import("./screens/AccountScreen"));
const ResearchScreen = lazy(() => import("./screens/ResearchScreen"));
const AlgoScreen = lazy(() => import("./screens/AlgoScreen"));
const BacktestScreen = lazy(() => import("./screens/BacktestScreen"));
const DiagnosticsScreen = lazy(() => import("./screens/DiagnosticsScreen"));
const SettingsScreen = lazy(() => import("./screens/SettingsScreen"));
const MemoMarketScreen = memo(MarketScreen);
const MemoFlowScreen = memo(FlowScreen);
const MemoTradeScreen = memo(TradeScreen);
const MemoAccountScreen = memo(AccountScreen);
const MemoResearchScreen = memo(ResearchScreen);
const MemoAlgoScreen = memo(AlgoScreen);
const MemoBacktestScreen = memo(BacktestScreen);
const MemoDiagnosticsScreen = memo(DiagnosticsScreen);
const MemoSettingsScreen = memo(SettingsScreen);

export const PhotonicsObservatory = lazy(
  () => import("./features/research/PhotonicsObservatory"),
);

// ═══════════════════════════════════════════════════════════════════
// FONTS
// ═══════════════════════════════════════════════════════════════════
const FONT_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{width:100%;height:100%;overflow:hidden}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:#2a3348;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#3a4560}
.ra-scrollbar-hidden{scrollbar-width:none;-ms-overflow-style:none}
.ra-scrollbar-hidden::-webkit-scrollbar{display:none}
::-webkit-scrollbar-track{background:transparent}
input[type=range]{accent-color:#3b82f6}
@keyframes toastSlideIn{from{opacity:0;transform:translateX(20px) scale(0.96)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes toastSlideOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(20px)}}
@keyframes pulseAlert{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0.6)}50%{box-shadow:0 0 0 4px rgba(245,158,11,0)}}
@keyframes pulseAlertLoss{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.6)}50%{box-shadow:0 0 0 4px rgba(239,68,68,0)}}
@keyframes premiumFlowSpin{to{transform:rotate(360deg)}}
@keyframes premiumFlowPulse{0%,100%{opacity:0.38;transform:scale(0.82)}50%{opacity:1;transform:scale(1)}}
@keyframes ibkrStatusPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0.28)}50%{box-shadow:0 0 0 3px rgba(245,158,11,0)}}
@keyframes headerBroadcastScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion: reduce){[data-premium-flow-glyph]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-wave] *{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-bridge-spinner],[data-ibkr-state-pulse]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-header-broadcast-track]{animation:none!important;transform:none!important}}
[data-header-broadcast-viewport]:hover [data-header-broadcast-track],[data-header-broadcast-viewport]:focus-within [data-header-broadcast-track]{animation-play-state:paused!important}
`;

// ─── PERSISTENCE LAYER ───
// Safe localStorage wrapper. Wrapped in try/catch so it degrades gracefully in
// sandboxed iframes (e.g. Claude.ai artifact preview) where storage is blocked.
// On Replit and other standalone deployments, persistence works normally.
export const _initialState = (() => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {};
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
})();
export const persistState = (patch) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = JSON.parse(
      window.localStorage.getItem(RAYALGO_STORAGE_KEY) || "{}",
    );
    const next = { ...current, ...patch };
    window.localStorage.setItem(RAYALGO_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent("rayalgo:workspace-settings-updated", { detail: next }),
    );
  } catch (e) {}
};

const readPersistedState = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
};

export const persistChartTimeframeFavorites = (role, favorites) => {
  const current = readPersistedState();
  persistState({
    chartTimeframeFavorites: {
      ...(current.chartTimeframeFavorites || {}),
      [role]: favorites,
    },
  });
  try {
    window.dispatchEvent(
      new CustomEvent("rayalgo:workspace-settings-updated", {
        detail: readPersistedState(),
      }),
    );
  } catch (_e) {}
};

export const useChartTimeframeFavorites = (role) => {
  const [favoriteTimeframes, setFavoriteTimeframes] = useState(() =>
    resolveChartTimeframeFavorites(
      _initialState.chartTimeframeFavorites?.[role],
      role,
    ),
  );

  useEffect(() => {
    const refresh = () => {
      setFavoriteTimeframes(
        resolveChartTimeframeFavorites(
          readPersistedState().chartTimeframeFavorites?.[role],
          role,
        ),
      );
    };
    refresh();
    window.addEventListener("rayalgo:workspace-settings-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("rayalgo:workspace-settings-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [role]);

  const toggleFavoriteTimeframe = useCallback(
    (timeframe) => {
      setFavoriteTimeframes((current) => {
        const next = toggleChartTimeframeFavorite(current, timeframe, role);
        persistChartTimeframeFavorites(role, next);
        return next;
      });
    },
    [role],
  );

  return { favoriteTimeframes, toggleFavoriteTimeframe };
};

const WATCHLISTS_QUERY_KEY = ["/api/watchlists"];
const HEADER_KPI_CONFIG = [
  { symbol: "VIXY", label: "Volatility" },
  { symbol: "IEF", label: "Treasuries" },
  { symbol: "UUP", label: "Dollar" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "USO", label: "Crude" },
];
const HEADER_KPI_SYMBOLS = HEADER_KPI_CONFIG.map((item) => item.symbol);

export const platformJsonRequest = async (
  path,
  { method = "GET", body, timeoutMs = 8_000 } = {},
) => {
  const controller =
    timeoutMs > 0 && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  let response;
  try {
    response = await fetch(path, {
      method,
      signal: controller?.signal,
      headers:
        body == null
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let payload = null;
    try {
      payload = await response.json();
      message =
        payload?.detail || payload?.message || payload?.error || message;
    } catch (error) {}
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.code = payload?.code || null;
    requestError.payload = payload;
    throw requestError;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const IBKR_BRIDGE_SESSION_KEYS = {
  launchUrl: "rayalgo.ibkrBridgeLaunchUrl",
  launchInFlightUntil: "rayalgo.ibkrBridgeLaunchInFlightUntil",
  managementToken: "rayalgo.ibkrBridgeManagementToken",
};
const IBKR_BRIDGE_LAUNCH_COOLDOWN_MS = 90_000;

const openIbkrProtocolLauncher = () => {
  return null;
};

const closeIbkrProtocolLauncher = (launcher) => {
  if (!launcher || launcher.closed) {
    return;
  }

  try {
    launcher.close();
  } catch {
    // Ignore popup cleanup failures.
  }
};

const navigateIbkrProtocolLauncher = (launcher, url) => {
  if (!url || typeof window === "undefined") {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  if (launcher && !launcher.closed) {
    try {
      launcher.location.href = url;
      return true;
    } catch {
      // Fall through to same-tab navigation.
    }
  }

  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
};

const readIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key) || null;
  } catch {
    return null;
  }
};

const writeIbkrBridgeSessionValue = (key, value) => {
  if (!value || typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
};

const removeIbkrBridgeSessionValue = (key) => {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage only keeps local bridge controls available in this tab.
  }
};

const clearIbkrBridgeSessionValues = () => {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      window.sessionStorage.removeItem(key);
    });
  } catch {
    // Ignore storage cleanup failures.
  }
};

const invalidateIbkrRuntimeQueries = (queryClient) => {
  const stringPrefixes = [
    "/api/session",
    "/api/broker-connections",
    "/api/accounts",
    "/api/positions",
    "/api/orders",
    "/api/quotes/snapshot",
    "/api/options",
    "/api/flow/events",
  ];
  stringPrefixes.forEach((prefix) => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          typeof key[0] === "string" &&
          key[0].startsWith(prefix)
        );
      },
    });
  });

  [
    "market-sparklines",
    "market-performance-baselines",
    "trade-market-depth",
    "trade-option-chain",
    "broker-executions",
  ].forEach((key) => {
    queryClient.invalidateQueries({ queryKey: [key], exact: false });
  });
};

// React context provides the toggle to children + holds state that triggers re-renders
const ThemeContext = createContext({ theme: "dark", toggle: () => {} });

// Toast notifications — globally accessible via useToast()
const ToastContext = createContext({ push: () => {}, toasts: [] });
export const useToast = () => useContext(ToastContext);

// Local position context. Order-entry simulation has been removed, but a small
// UI-local store remains for legacy state paths that may still read this context.
const PositionsContext = createContext({
  positions: [],
  addPosition: () => {},
  closePosition: () => {},
  closeAll: () => {},
  updateStops: () => {},
  rollPosition: () => {},
});
export const usePositions = () => useContext(PositionsContext);

export const AccountSelectionContext = createContext({
  accounts: [],
  selectedAccountId: null,
  setSelectedAccountId: () => {},
});
export const useAccountSelection = () => useContext(AccountSelectionContext);

// ═══════════════════════════════════════════════════════════════════
// STATIC DATA / GENERATORS
// ═══════════════════════════════════════════════════════════════════

const rng = (seed) => {
  let x = seed;
  return () => {
    x = (x * 16807 + 7) % 2147483647;
    return (x - 1) / 2147483646;
  };
};
const hashSymbol = (symbol = "") =>
  symbol.split("").reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);

const genSparkline = (seed, points = 48, base = 100, vol = 1) => {
  const r = rng(seed);
  let v = base;
  return Array.from({ length: points }, (_, i) => {
    v += (r() - 0.48) * vol;
    return { i, v: +v.toFixed(2) };
  });
};

const WATCHLIST = [
  {
    sym: "SPY",
    name: "SPDR S&P 500",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "QQQ",
    name: "Invesco QQQ",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IWM",
    name: "iShares Russ 2000",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "VIXY",
    name: "ProShares VIX Short-Term Futures ETF",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "AAPL",
    name: "Apple Inc",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "MSFT",
    name: "Microsoft Corp",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "NVDA",
    name: "NVIDIA Corp",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "AMZN",
    name: "Amazon.com",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "META",
    name: "Meta Platforms",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "TSLA",
    name: "Tesla Inc",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "UUP",
    name: "Invesco DB US Dollar Index Bullish Fund",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IEF",
    name: "iShares 7-10 Year Treasury Bond ETF",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
];
const DEFAULT_WATCHLIST_BY_SYMBOL = Object.fromEntries(
  WATCHLIST.map((item) => [item.sym, { ...item, spark: [...item.spark] }]),
);

const genBars = (seed, count = 78, base = 582) => {
  const r = rng(seed);
  let p = base;
  return Array.from({ length: count }, (_, i) => {
    const drift = (r() - 0.48) * 1.5;
    const o = +p.toFixed(2);
    const c = +(o + drift).toFixed(2);
    const h = +(Math.max(o, c) + r() * 0.8).toFixed(2);
    const l = +(Math.min(o, c) - r() * 0.8).toFixed(2);
    const hr = 9 + Math.floor((i * 6.5) / count);
    const mn = Math.floor(((i * 6.5 * 60) / count) % 60);
    const vol = Math.round(
      (500000 + r() * 800000) * (i < 6 ? 2.5 : i > count - 6 ? 2.0 : 0.6 + r()),
    );
    // UOA overlay: ~15% of bars have UOA activity. Intensity 0.2-0.9 of volume.
    const hasUoa = r() < 0.15;
    const uoa = hasUoa ? +(0.2 + r() * 0.7).toFixed(2) : 0;
    p = c;
    return {
      time: `${hr}:${String(mn).padStart(2, "0")}`,
      o,
      h,
      l,
      c,
      v: vol,
      i,
      uoa,
    };
  });
};

// Tradable ticker info (price + IV + chart identity metadata)
const TRADE_TICKER_INFO = {
  SPY: {
    name: "SPDR S&P 500",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 100,
    chainSeed: 200,
    optSeed: 300,
  },
  QQQ: {
    name: "Invesco QQQ",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 101,
    chainSeed: 201,
    optSeed: 301,
  },
  NVDA: {
    name: "NVIDIA Corp",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 102,
    chainSeed: 202,
    optSeed: 302,
  },
  TSLA: {
    name: "Tesla Inc",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 103,
    chainSeed: 203,
    optSeed: 303,
  },
  AAPL: {
    name: "Apple Inc",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 104,
    chainSeed: 204,
    optSeed: 304,
  },
  META: {
    name: "Meta Platforms",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 105,
    chainSeed: 205,
    optSeed: 305,
  },
  AMZN: {
    name: "Amazon.com",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 106,
    chainSeed: 206,
    optSeed: 306,
  },
  MSFT: {
    name: "Microsoft Corp",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 107,
    chainSeed: 207,
    optSeed: 307,
  },
};

export const ensureTradeTickerInfo = (symbol, fallbackName = symbol) => {
  const normalized = symbol.toUpperCase();
  if (!TRADE_TICKER_INFO[normalized]) {
    const hash = hashSymbol(normalized);
    TRADE_TICKER_INFO[normalized] = {
      name: fallbackName,
      price: null,
      chg: null,
      pct: null,
      iv: null,
      barSeed: 400 + (hash % 200),
      chainSeed: 700 + (hash % 200),
      optSeed: 1000 + (hash % 200),
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      updatedAt: null,
      spark: [],
      sparkBars: [],
    };
  } else if (
    fallbackName &&
    (!TRADE_TICKER_INFO[normalized].name ||
      TRADE_TICKER_INFO[normalized].name === normalized)
  ) {
    TRADE_TICKER_INFO[normalized].name = fallbackName;
  }

  if (!Array.isArray(TRADE_TICKER_INFO[normalized].spark)) {
    TRADE_TICKER_INFO[normalized].spark = [];
  }
  if (!Array.isArray(TRADE_TICKER_INFO[normalized].sparkBars)) {
    TRADE_TICKER_INFO[normalized].sparkBars = [];
  }

  return TRADE_TICKER_INFO[normalized];
};

const runtimeTickerSnapshotListeners = new Map();
const runtimeTickerSnapshotVersions = new Map();

const normalizeRuntimeTickerSymbols = (symbols) => (
  Array.from(
    new Set(
      (symbols || [])
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  ).sort()
);

const areDateValuesEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftMs =
    left instanceof Date
      ? left.getTime()
      : typeof left === "string" || typeof left === "number"
        ? Date.parse(String(left))
        : Number.NaN;
  const rightMs =
    right instanceof Date
      ? right.getTime()
      : typeof right === "string" || typeof right === "number"
        ? Date.parse(String(right))
        : Number.NaN;

  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return left == null && right == null;
  }

  return leftMs === rightMs;
};

const areSparkPointsEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftPoints = Array.isArray(left) ? left : [];
  const rightPoints = Array.isArray(right) ? right : [];
  if (leftPoints.length !== rightPoints.length) {
    return false;
  }

  for (let index = 0; index < leftPoints.length; index += 1) {
    const current = leftPoints[index];
    const next = rightPoints[index];
    if (!current || !next || current.i !== next.i || current.v !== next.v) {
      return false;
    }
  }

  return true;
};

const resolveRuntimeBarTimeMs = (bar) => {
  if (!bar) {
    return null;
  }
  if (bar.timestamp instanceof Date) {
    return bar.timestamp.getTime();
  }
  if (typeof bar.timestamp === "string" || typeof bar.timestamp === "number") {
    const parsed = Date.parse(String(bar.timestamp));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (bar.time instanceof Date) {
    return bar.time.getTime();
  }
  if (typeof bar.time === "string" || typeof bar.time === "number") {
    const parsed = Date.parse(String(bar.time));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const areSparkBarsEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftBars = Array.isArray(left) ? left : [];
  const rightBars = Array.isArray(right) ? right : [];
  if (leftBars.length !== rightBars.length) {
    return false;
  }

  for (let index = 0; index < leftBars.length; index += 1) {
    const current = leftBars[index];
    const next = rightBars[index];
    if (
      resolveRuntimeBarTimeMs(current) !== resolveRuntimeBarTimeMs(next) ||
      (current?.close ?? current?.c ?? null) !== (next?.close ?? next?.c ?? null) ||
      (current?.volume ?? current?.v ?? null) !== (next?.volume ?? next?.v ?? null)
    ) {
      return false;
    }
  }

  return true;
};

const isRuntimeTickerFieldEqual = (field, currentValue, nextValue) => {
  if (field === "updatedAt") {
    return areDateValuesEqual(currentValue, nextValue);
  }
  if (field === "spark") {
    return areSparkPointsEqual(currentValue, nextValue);
  }
  if (field === "sparkBars") {
    return areSparkBarsEqual(currentValue, nextValue);
  }
  return Object.is(currentValue, nextValue);
};

const applyRuntimeTickerInfoPatch = (symbol, fallbackName, patch) => {
  const tradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
  let changed = false;

  Object.entries(patch).forEach(([field, nextValue]) => {
    if (isRuntimeTickerFieldEqual(field, tradeInfo[field], nextValue)) {
      return;
    }

    tradeInfo[field] = nextValue;
    changed = true;
  });

  return {
    tradeInfo,
    changed,
  };
};

const notifyRuntimeTickerSnapshotSymbols = (symbols) => {
  normalizeRuntimeTickerSymbols(symbols).forEach((symbol) => {
    runtimeTickerSnapshotVersions.set(
      symbol,
      (runtimeTickerSnapshotVersions.get(symbol) ?? 0) + 1,
    );
    Array.from(runtimeTickerSnapshotListeners.get(symbol) || []).forEach((listener) =>
      listener(),
    );
  });
};

const subscribeToRuntimeTickerSnapshotSymbols = (symbols, listener) => {
  const normalizedSymbols = normalizeRuntimeTickerSymbols(symbols);
  normalizedSymbols.forEach((symbol) => {
    const listeners = runtimeTickerSnapshotListeners.get(symbol) || new Set();
    listeners.add(listener);
    runtimeTickerSnapshotListeners.set(symbol, listeners);
  });

  return () => {
    normalizedSymbols.forEach((symbol) => {
      const listeners = runtimeTickerSnapshotListeners.get(symbol);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        runtimeTickerSnapshotListeners.delete(symbol);
      }
    });
  };
};

export const useRuntimeTickerSnapshot = (
  symbol,
  fallback = null,
  { subscribe = true } = {},
) => {
  const normalizedSymbol = useMemo(() => normalizeTickerSymbol(symbol), [symbol]);
  useSyncExternalStore(
    subscribe && normalizedSymbol
      ? (listener) =>
          subscribeToRuntimeTickerSnapshotSymbols([normalizedSymbol], listener)
      : () => () => {},
    subscribe && normalizedSymbol
      ? () => runtimeTickerSnapshotVersions.get(normalizedSymbol) ?? 0
      : () => 0,
    () => 0,
  );
  return getRuntimeTickerSnapshot(normalizedSymbol, fallback) || fallback;
};

const useRuntimeTickerSnapshots = (symbols) => {
  const normalizedSymbols = useMemo(
    () => normalizeRuntimeTickerSymbols(symbols),
    [symbols],
  );
  const symbolsKey = useMemo(
    () => normalizedSymbols.join(","),
    [normalizedSymbols],
  );

  const version = useSyncExternalStore(
    (listener) => subscribeToRuntimeTickerSnapshotSymbols(normalizedSymbols, listener),
    () =>
      normalizedSymbols
        .map((symbol) => `${symbol}:${runtimeTickerSnapshotVersions.get(symbol) ?? 0}`)
        .join("|"),
    () => "",
  );

  return useMemo(
    () =>
      Object.fromEntries(
        normalizedSymbols.map((symbol) => [
          symbol,
          getRuntimeTickerSnapshot(symbol, null),
        ]),
      ),
    [normalizedSymbols, symbolsKey, version],
  );
};

export const publishRuntimeTickerSnapshot = (symbol, fallbackName, patch) => {
  const normalizedSymbol = normalizeTickerSymbol(symbol);
  if (!normalizedSymbol) {
    return null;
  }

  const result = applyRuntimeTickerInfoPatch(
    normalizedSymbol,
    fallbackName,
    patch,
  );
  if (result?.changed) {
    notifyRuntimeTickerSnapshotSymbols([normalizedSymbol]);
  }
  return result?.tradeInfo || null;
};

const buildFallbackWatchlistItem = (symbol, index, name) => {
  const existing = DEFAULT_WATCHLIST_BY_SYMBOL[symbol];
  if (existing)
    return {
      ...existing,
      price: null,
      chg: null,
      pct: null,
      spark: [],
      name: existing.name || name || symbol,
      sparkBars: existing.sparkBars || [],
    };

  return {
    sym: symbol,
    name: name || symbol,
    price: null,
    chg: null,
    pct: null,
    spark: [],
    sparkBars: [],
  };
};

const buildSparklineFromHistoricalBars = (bars, fallback) => {
  if (!Array.isArray(bars) || bars.length < 2) {
    return Array.isArray(fallback) ? fallback : [];
  }

  return bars.map((bar, index) => ({
    i: index,
    v: bar.close,
  }));
};

const computeTrailingReturnPercent = (currentPrice, baselinePrice) => {
  if (
    typeof currentPrice !== "number" ||
    Number.isNaN(currentPrice) ||
    typeof baselinePrice !== "number" ||
    Number.isNaN(baselinePrice) ||
    baselinePrice === 0
  ) {
    return null;
  }

  return ((currentPrice - baselinePrice) / baselinePrice) * 100;
};

// Strategy templates — delta target informs strike selection
const TRADE_STRATEGIES = [
  {
    id: "long_call_atm",
    name: "Call ATM",
    desc: "Bullish, ~50Δ",
    cp: "C",
    deltaTarget: 0.5,
    qty: 3,
    dte: 7,
    color: "#10b981",
  },
  {
    id: "long_put_atm",
    name: "Put ATM",
    desc: "Bearish, ~50Δ",
    cp: "P",
    deltaTarget: 0.5,
    qty: 3,
    dte: 7,
    color: "#ef4444",
  },
  {
    id: "long_call_otm",
    name: "Call OTM",
    desc: "Aggressive, 30Δ",
    cp: "C",
    deltaTarget: 0.3,
    qty: 5,
    dte: 7,
    color: "#10b981",
  },
  {
    id: "0dte_lotto",
    name: "0DTE Lotto",
    desc: "High R/R · Δ20",
    cp: "C",
    deltaTarget: 0.2,
    qty: 10,
    dte: 0,
    color: "#f59e0b",
  },
  {
    id: "itm_call",
    name: "ITM Call",
    desc: "Conservative, 70Δ",
    cp: "C",
    deltaTarget: 0.7,
    qty: 2,
    dte: 14,
    color: "#10b981",
  },
  {
    id: "long_put_otm",
    name: "Put OTM",
    desc: "Hedge, 25Δ",
    cp: "P",
    deltaTarget: 0.25,
    qty: 5,
    dte: 7,
    color: "#ef4444",
  },
];

// L2 order book generator — bids + asks for current selection (mock)
const genL2Book = (mid, spread, seed) => {
  const r = rng(seed);
  const tickSize = 0.01;
  const halfSpread = spread / 2;
  const bestBid = +(mid - halfSpread).toFixed(2);
  const bestAsk = +(mid + halfSpread).toFixed(2);
  const bids = [],
    asks = [];
  for (let i = 0; i < 8; i++) {
    const bidPrice = +(bestBid - i * tickSize).toFixed(2);
    const askPrice = +(bestAsk + i * tickSize).toFixed(2);
    const baseBidSize = (5 + i * 8) * (0.5 + r());
    const baseAskSize = (5 + i * 8) * (0.5 + r());
    bids.push({
      price: bidPrice,
      size: Math.round(baseBidSize),
      mm: 1 + Math.floor(r() * 4),
    });
    asks.push({
      price: askPrice,
      size: Math.round(baseAskSize),
      mm: 1 + Math.floor(r() * 4),
    });
  }
  return { bids, asks };
};

// Time & sales — recent prints
const genTradeTape = (mid, seed) => {
  const r = rng(seed);
  const prints = [];
  let t = 14 * 60 + 30;
  for (let i = 0; i < 12; i++) {
    const sec = Math.floor(r() * 30);
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    const price = +(mid + (r() - 0.5) * 0.06).toFixed(2);
    const size = Math.round(1 + r() * 50);
    const side = r() < 0.55 ? "B" : "A";
    prints.push({ time, price, size, side });
    t -= Math.floor(r() * 5) + 1;
  }
  return prints;
};

// Available expirations for the Trade tab exp selector
const EXPIRATIONS = [
  { v: "04/17", dte: 0, tag: "0DTE" },
  { v: "04/18", dte: 1, tag: "1d" },
  { v: "04/25", dte: 8, tag: "Wkly" },
  { v: "05/02", dte: 15, tag: "2w" },
  { v: "05/16", dte: 29, tag: "Mthly" },
  { v: "06/20", dte: 64, tag: "Qtrly" },
  { v: "09/19", dte: 155, tag: "LEAP" },
];

// Intraday flow prints per ticker — for overlaying on equity chart
const genTradeFlowMarkers = (seed) => {
  const r = rng(seed);
  const n = 5 + Math.floor(r() * 4);
  return Array.from({ length: n }, () => ({
    barIdx: Math.floor(r() * 70) + 2,
    cp: r() > 0.45 ? "C" : "P",
    size: r() > 0.7 ? "lg" : r() > 0.35 ? "md" : "sm",
    golden: r() > 0.82,
  }));
};
const TRADE_FLOW_MARKERS = Object.fromEntries(
  Object.entries(TRADE_TICKER_INFO).map(([sym, info]) => [
    sym,
    genTradeFlowMarkers(info.barSeed + 555),
  ]),
);

const syncRuntimeMarketData = (
  symbols,
  watchlistItems,
  quotes,
  { sparklineBarsBySymbol = {}, performanceBaselineBySymbol = {} } = {},
) => {
  const changedSymbols = new Set();
  const quoteBySymbol = Object.fromEntries(
    (quotes || []).map((quote) => [quote.symbol.toUpperCase(), quote]),
  );
  const watchlistNameBySymbol = Object.fromEntries(
    (watchlistItems || []).map((item) => {
      const symbol = item.symbol.toUpperCase();
      const fallbackName =
        DEFAULT_WATCHLIST_BY_SYMBOL[symbol]?.name ||
        TRADE_TICKER_INFO[symbol]?.name ||
        symbol;
      return [symbol, fallbackName];
    }),
  );

  const nextItems = symbols.map((symbol, index) => {
    const normalized = symbol.toUpperCase();
    const base = buildFallbackWatchlistItem(
      normalized,
      index,
      watchlistNameBySymbol[normalized],
    );
    const quote = quoteBySymbol[normalized];
    const spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[normalized],
      base.spark,
    );
    const tradeInfo = ensureTradeTickerInfo(normalized, base.name);
    const prevClose = quote?.prevClose ?? tradeInfo.prevClose ?? null;
    const price = quote?.price ?? tradeInfo.price ?? null;
    const chg =
      Number.isFinite(price) && Number.isFinite(prevClose)
        ? price - prevClose
        : (quote?.change ?? tradeInfo.chg ?? null);
    const pct =
      Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : (quote?.changePercent ?? tradeInfo.pct ?? null);
    const open = quote?.open ?? tradeInfo.open ?? null;
    const high = quote?.high ?? tradeInfo.high ?? null;
    const low = quote?.low ?? tradeInfo.low ?? null;
    const volume = quote?.volume ?? tradeInfo.volume ?? null;
    const updatedAt =
      quote?.updatedAt ??
      tradeInfo.updatedAt ??
      null;

    if (
      applyRuntimeTickerInfoPatch(normalized, base.name, {
        name: base.name,
        price,
        chg,
        pct,
        open,
        high,
        low,
        prevClose,
        volume,
        updatedAt,
        spark,
        sparkBars: sparklineBarsBySymbol[normalized] || [],
      }).changed
    ) {
      changedSymbols.add(normalized);
    }

    if (!TRADE_FLOW_MARKERS[normalized]) {
      TRADE_FLOW_MARKERS[normalized] = genTradeFlowMarkers(
        tradeInfo.barSeed + 555,
      );
    }

    return {
      ...base,
      sym: normalized,
      price,
      chg,
      pct,
      spark,
      open,
      high,
      low,
      prevClose,
      volume,
      updatedAt,
      sparkBars: sparklineBarsBySymbol[normalized] || [],
    };
  });

  WATCHLIST.splice(0, WATCHLIST.length, ...nextItems);

  Object.entries(quoteBySymbol).forEach(([symbol, quote]) => {
    const fallbackName =
      watchlistNameBySymbol[symbol] ||
      INDICES.find((item) => item.sym === symbol)?.name ||
      TRADE_TICKER_INFO[symbol]?.name ||
      symbol;
    const runtimeSparkBars = sparklineBarsBySymbol[symbol] || [];

    const currentTradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
    if (
      applyRuntimeTickerInfoPatch(symbol, fallbackName, {
        name: fallbackName,
        price: quote.price ?? currentTradeInfo.price,
        chg: quote.change ?? currentTradeInfo.chg,
        pct: quote.changePercent ?? currentTradeInfo.pct,
        open: quote.open ?? currentTradeInfo.open ?? null,
        high: quote.high ?? currentTradeInfo.high ?? null,
        low: quote.low ?? currentTradeInfo.low ?? null,
        prevClose: quote.prevClose ?? currentTradeInfo.prevClose ?? null,
        volume: quote.volume ?? currentTradeInfo.volume ?? null,
        updatedAt: quote.updatedAt ?? currentTradeInfo.updatedAt ?? null,
        spark: buildSparklineFromHistoricalBars(
          runtimeSparkBars,
          currentTradeInfo.spark,
        ),
        sparkBars: runtimeSparkBars,
      }).changed
    ) {
      changedSymbols.add(symbol);
    }
  });

  INDICES.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.price = quote?.price ?? item.price ?? null;
    item.chg =
      Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote?.change ?? null;
    item.pct =
      Number.isFinite(item.price) &&
      Number.isFinite(prevClose) &&
      prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote?.changePercent ?? null;
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
    if (
      applyRuntimeTickerInfoPatch(item.sym, item.name || item.sym, {
        name: item.name || item.sym,
        price: item.price,
        chg: item.chg,
        pct: item.pct,
        prevClose: item.prevClose ?? TRADE_TICKER_INFO[item.sym]?.prevClose ?? null,
        spark: item.spark,
        sparkBars: item.sparkBars,
      }).changed
    ) {
      changedSymbols.add(item.sym.toUpperCase());
    }
  });

  MACRO_TICKERS.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.price = quote?.price ?? item.price ?? null;
    item.chg =
      Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote?.change ?? null;
    item.pct =
      Number.isFinite(item.price) &&
      Number.isFinite(prevClose) &&
      prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote?.changePercent ?? null;
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
    if (
      applyRuntimeTickerInfoPatch(
        item.sym,
        item.label || item.name || item.sym,
        {
          name: item.label || item.name || item.sym,
          price: item.price,
          chg: item.chg,
          pct: item.pct,
          prevClose:
            item.prevClose ?? TRADE_TICKER_INFO[item.sym]?.prevClose ?? null,
          spark: item.spark,
          sparkBars: item.sparkBars,
        },
      ).changed
    ) {
      changedSymbols.add(item.sym.toUpperCase());
    }
  });

  RATES_PROXIES.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice = quote?.price ?? item.price;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    item.price = quote?.price ?? null;
    item.chg = quote?.change ?? null;
    item.pct = quote?.changePercent ?? null;
    item.d5 = d5 ?? null;
  });

  SECTORS.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice =
      quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    item.chg = quote?.changePercent ?? null;
    item.d5 = d5 ?? null;
  });

  TREEMAP_DATA.forEach((sector) => {
    sector.stocks.forEach((stock) => {
      const normalized = stock.sym.toUpperCase();
      const quote = quoteBySymbol[normalized];
      const currentPrice =
        quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
      const baseline = performanceBaselineBySymbol[normalized] ?? null;
      const d5 = computeTrailingReturnPercent(currentPrice, baseline);

      stock.d1 = quote?.changePercent ?? null;
      stock.d5 = d5 ?? null;
    });
  });

  if (changedSymbols.size > 0) {
    notifyRuntimeTickerSnapshotSymbols(Array.from(changedSymbols));
  }
};

const getRuntimeQuoteDetail = (symbol) => {
  const info =
    TRADE_TICKER_INFO[symbol] || ensureTradeTickerInfo(symbol, symbol);
  const prevClose =
    info.prevClose ??
    (typeof info.price === "number" && typeof info.chg === "number"
      ? info.price - info.chg
      : null);

  return {
    open: info.open,
    prevClose,
    high: info.high,
    low: info.low,
    volume: info.volume,
    iv: info.iv,
    updatedAt: info.updatedAt,
  };
};

const getRuntimeTickerSnapshot = (symbol, fallback = null) => {
  const info = TRADE_TICKER_INFO[symbol];
  if (info) return info;

  return fallback;
};

export const buildTrackedBreadthSummary = () => {
  const stocks = TREEMAP_DATA.flatMap((sector) => sector.stocks);
  const observedDaily = stocks.filter((stock) => isFiniteNumber(stock.d1));
  const observedFiveDay = stocks.filter((stock) => isFiniteNumber(stock.d5));
  const observedSectors = SECTORS.filter((sector) => isFiniteNumber(sector.chg));
  const total = observedDaily.length;
  const advancers = observedDaily.filter((stock) => stock.d1 > 0).length;
  const decliners = observedDaily.filter((stock) => stock.d1 < 0).length;
  const unchanged = observedDaily.filter((stock) => stock.d1 === 0).length;
  const positive5d = observedFiveDay.filter((stock) => stock.d5 > 0).length;
  const positiveSectors = observedSectors.filter((sector) => sector.chg > 0).length;
  const sortedSectors = [...observedSectors].sort(
    (left, right) => right.chg - left.chg,
  );
  const leader = sortedSectors[0] || null;
  const laggard = sortedSectors[sortedSectors.length - 1] || null;

  return {
    total,
    advancers,
    decliners,
    unchanged,
    fiveDayCoverage: observedFiveDay.length,
    sectorCoverage: observedSectors.length,
    advancePct: total > 0 ? (advancers / total) * 100 : null,
    positive5dPct:
      observedFiveDay.length > 0
        ? (positive5d / observedFiveDay.length) * 100
        : null,
    positiveSectors,
    leader,
    laggard,
  };
};

export const buildRatesProxySummary = () => {
  const sorted = [...RATES_PROXIES]
    .filter((item) => isFiniteNumber(item.pct))
    .sort((left, right) => right.pct - left.pct);
  return {
    leader: sorted[0] || null,
    laggard: sorted[sorted.length - 1] || null,
  };
};

export const buildOptionChainRowsFromApi = (contracts, spotPrice) => {
  const rowsByStrike = new Map();

  (contracts || []).forEach((quote) => {
    const strike = quote?.contract?.strike;
    const right = quote?.contract?.right;
    if (typeof strike !== "number" || !right) return;
    const quoteFreshness = quote.quoteFreshness || quote.freshness || "metadata";
    const quoteUpdatedAt =
      quote.quoteUpdatedAt ||
      quote.dataUpdatedAt ||
      (quoteFreshness !== "metadata" ? quote.updatedAt : null) ||
      null;
    const hasAnyQuoteData =
      isFiniteNumber(quote.bid) ||
      isFiniteNumber(quote.ask) ||
      isFiniteNumber(quote.last) ||
      isFiniteNumber(quote.mark) ||
      isFiniteNumber(quote.volume) ||
      isFiniteNumber(quote.openInterest) ||
      isFiniteNumber(quote.impliedVolatility) ||
      isFiniteNumber(quote.delta) ||
      isFiniteNumber(quote.gamma) ||
      isFiniteNumber(quote.theta) ||
      isFiniteNumber(quote.vega);
    const quoteCanCarryMarketData =
      quoteFreshness !== "metadata" &&
      quoteFreshness !== "pending" &&
      quoteFreshness !== "unavailable";
    const hasHydratedQuoteData =
      quoteCanCarryMarketData && (Boolean(quoteUpdatedAt) || hasAnyQuoteData);
    const quoteNumber = (value) =>
      hasHydratedQuoteData && isFiniteNumber(value) ? value : null;

    const row = rowsByStrike.get(strike) || {
      k: strike,
      cContract: null,
      cPrem: null,
      cBid: null,
      cAsk: null,
      cVol: null,
      cOi: null,
      cIv: null,
      cDelta: null,
      cGamma: null,
      cTheta: null,
      cVega: null,
      cFreshness: "metadata",
      cMarketDataMode: null,
      cQuoteUpdatedAt: null,
      pContract: null,
      pPrem: null,
      pBid: null,
      pAsk: null,
      pVol: null,
      pOi: null,
      pIv: null,
      pDelta: null,
      pGamma: null,
      pTheta: null,
      pVega: null,
      pFreshness: "metadata",
      pMarketDataMode: null,
      pQuoteUpdatedAt: null,
      isAtm: false,
    };
    const bid = quoteNumber(quote.bid);
    const ask = quoteNumber(quote.ask);
    const last = quoteNumber(quote.last);
    const markValue = quoteNumber(quote.mark);
    const mark =
      markValue != null && markValue > 0
        ? markValue
        : bid != null && ask != null && bid > 0 && ask > 0
          ? (bid + ask) / 2
          : last;

    if (right === "call") {
      row.cContract = quote.contract || null;
      row.cPrem = isFiniteNumber(mark) ? +mark.toFixed(2) : null;
      row.cBid = isFiniteNumber(bid) ? +bid.toFixed(2) : null;
      row.cAsk = isFiniteNumber(ask) ? +ask.toFixed(2) : null;
      row.cVol = quoteNumber(quote.volume);
      row.cOi = quoteNumber(quote.openInterest);
      row.cIv = quoteNumber(quote.impliedVolatility);
      row.cDelta = quoteNumber(quote.delta);
      row.cGamma = quoteNumber(quote.gamma);
      row.cTheta = quoteNumber(quote.theta);
      row.cVega = quoteNumber(quote.vega);
      row.cFreshness = quoteFreshness;
      row.cMarketDataMode = quote.marketDataMode || null;
      row.cQuoteUpdatedAt = quoteUpdatedAt;
    } else {
      row.pContract = quote.contract || null;
      row.pPrem = isFiniteNumber(mark) ? +mark.toFixed(2) : null;
      row.pBid = isFiniteNumber(bid) ? +bid.toFixed(2) : null;
      row.pAsk = isFiniteNumber(ask) ? +ask.toFixed(2) : null;
      row.pVol = quoteNumber(quote.volume);
      row.pOi = quoteNumber(quote.openInterest);
      row.pIv = quoteNumber(quote.impliedVolatility);
      row.pDelta = quoteNumber(quote.delta);
      row.pGamma = quoteNumber(quote.gamma);
      row.pTheta = quoteNumber(quote.theta);
      row.pVega = quoteNumber(quote.vega);
      row.pFreshness = quoteFreshness;
      row.pMarketDataMode = quote.marketDataMode || null;
      row.pQuoteUpdatedAt = quoteUpdatedAt;
    }

    rowsByStrike.set(strike, row);
  });

  const rows = Array.from(rowsByStrike.values()).sort(
    (left, right) => left.k - right.k,
  );
  if (!rows.length) return [];

  const fallbackAtmStrike = rows[Math.floor(rows.length / 2)]?.k ?? rows[0].k;
  const atmStrike = isFiniteNumber(spotPrice)
    ? rows.reduce(
        (closest, row) =>
          Math.abs(row.k - spotPrice) < Math.abs(closest - spotPrice)
            ? row.k
            : closest,
        rows[0].k,
      )
    : fallbackAtmStrike;

  return rows.map((row) => ({ ...row, isAtm: row.k === atmStrike }));
};

const buildMarketOrderFlowFromEvents = (events) => {
  const totals = {
    buyXL: 0,
    buyL: 0,
    buyM: 0,
    buyS: 0,
    sellXL: 0,
    sellL: 0,
    sellM: 0,
    sellS: 0,
  };

  (events || []).forEach((evt) => {
    const bucket =
      evt.premium >= 500000
        ? "XL"
        : evt.premium >= 250000
          ? "L"
          : evt.premium >= 100000
            ? "M"
            : "S";
    const amount = evt.premium / 1e6;

    if (evt.side === "BUY") {
      totals[`buy${bucket}`] += amount;
      return;
    }
    if (evt.side === "SELL") {
      totals[`sell${bucket}`] += amount;
      return;
    }

    totals[`buy${bucket}`] += amount / 2;
    totals[`sell${bucket}`] += amount / 2;
  });

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, +value.toFixed(1)]),
  );
};

export const buildFlowTideFromEvents = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 30;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    calls: 0,
    puts: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    if (evt.cp === "C") buckets[bucketIndex].calls += evt.premium;
    else buckets[bucketIndex].puts += evt.premium;
  });

  let cumNet = 0;
  return buckets.map((bucket) => {
    const net = bucket.calls - bucket.puts;
    cumNet += net;
    return { ...bucket, net, cumNet };
  });
};

const buildTickerFlowFromEvents = (events) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const entry = grouped.get(evt.ticker) || {
      sym: evt.ticker,
      calls: 0,
      puts: 0,
      contracts: 0,
      scoreTotal: 0,
    };

    if (evt.cp === "C") entry.calls += evt.premium;
    else entry.puts += evt.premium;
    entry.contracts += 1;
    entry.scoreTotal += evt.score;
    grouped.set(evt.ticker, entry);
  });

  return Array.from(grouped.values())
    .map((entry) => {
      const info = ensureTradeTickerInfo(entry.sym, entry.sym);
      return {
        sym: entry.sym,
        calls: entry.calls,
        puts: entry.puts,
        contracts: entry.contracts,
        score: entry.contracts
          ? Math.round(entry.scoreTotal / entry.contracts)
          : 0,
        px: info.price,
        chg: info.pct,
      };
    })
    .sort((left, right) => right.calls + right.puts - (left.calls + left.puts));
};

const buildFlowClockFromEvents = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 30;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    count: 0,
    prem: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    buckets[bucketIndex].count += 1;
    buckets[bucketIndex].prem += evt.premium;
  });

  return buckets;
};

const FLOW_SECTOR_BY_SYMBOL = {
  AAPL: "Technology",
  AMZN: "Cons Disc",
  META: "Comm Svcs",
  MSFT: "Technology",
  NVDA: "Technology",
  QQQ: "Index",
  SPY: "Index",
  TSLA: "Cons Disc",
  IWM: "Index",
};

const buildSectorFlowFromEvents = (events) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const sector = FLOW_SECTOR_BY_SYMBOL[evt.ticker] || "Other";
    const entry = grouped.get(sector) || { sector, calls: 0, puts: 0 };
    if (evt.cp === "C") entry.calls += evt.premium;
    else entry.puts += evt.premium;
    grouped.set(sector, entry);
  });

  return Array.from(grouped.values()).sort(
    (left, right) =>
      Math.abs(right.calls - right.puts) - Math.abs(left.calls - left.puts),
  );
};

const buildDteBucketsFromEvents = (events) => {
  const buckets = [
    { bucket: "0DTE", calls: 0, puts: 0, count: 0, match: (dte) => dte <= 0 },
    {
      bucket: "1-7d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 1 && dte <= 7,
    },
    {
      bucket: "8-30d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 8 && dte <= 30,
    },
    {
      bucket: "31-90d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 31 && dte <= 90,
    },
    { bucket: "90d+", calls: 0, puts: 0, count: 0, match: (dte) => dte > 90 },
  ];

  (events || []).forEach((evt) => {
    const bucket =
      buckets.find((entry) => entry.match(evt.dte)) ||
      buckets[buckets.length - 1];
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
    bucket.count += 1;
  });

  return buckets.map(({ match, ...bucket }) => bucket);
};

const FLOW_INDEX_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "DIA"]);

const buildPutCallSummaryFromEvents = (events) => {
  const totals = {
    equities: { calls: 0, puts: 0 },
    indices: { calls: 0, puts: 0 },
  };

  (events || []).forEach((evt) => {
    const bucket = FLOW_INDEX_SYMBOLS.has(evt.ticker)
      ? totals.indices
      : totals.equities;
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
  });

  const toRatio = ({ calls, puts }) =>
    calls > 0 ? puts / calls : calls === 0 && puts === 0 ? null : null;
  const equities = toRatio(totals.equities);
  const indices = toRatio(totals.indices);
  const calls = totals.equities.calls + totals.indices.calls;
  const puts = totals.equities.puts + totals.indices.puts;
  const total = calls > 0 ? puts / calls : calls === 0 && puts === 0 ? null : null;

  return {
    total,
    equities,
    indices,
    calls,
    puts,
  };
};

const buildTradeOptionFlowByDte = (events) => {
  const buckets = [
    {
      label: "0DTE",
      match: (dte) => dte <= 0,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
    {
      label: "1-7d",
      match: (dte) => dte >= 1 && dte <= 7,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
    {
      label: "8-30d",
      match: (dte) => dte >= 8 && dte <= 30,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
    {
      label: "30d+",
      match: (dte) => dte > 30,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
  ];

  (events || []).forEach((evt) => {
    const bucket =
      buckets.find((entry) => entry.match(evt.dte)) ||
      buckets[buckets.length - 1];
    const amount = evt.premium / 1000;
    if (evt.cp === "C") bucket.callPrem += amount;
    else bucket.putPrem += amount;
    bucket.total += amount;
  });

  return buckets.map(({ match, ...bucket }) => ({
    ...bucket,
    callPrem: +bucket.callPrem.toFixed(1),
    putPrem: +bucket.putPrem.toFixed(1),
    total: +bucket.total.toFixed(1),
  }));
};

const buildTradeOptionFlowByStrike = (events, spotPrice) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const entry = grouped.get(evt.strike) || {
      strike: evt.strike,
      callPrem: 0,
      putPrem: 0,
      total: 0,
      isATM: false,
    };
    const amount = evt.premium / 1000;
    if (evt.cp === "C") entry.callPrem += amount;
    else entry.putPrem += amount;
    entry.total += amount;
    grouped.set(evt.strike, entry);
  });

  const rows = Array.from(grouped.values()).sort(
    (left, right) => left.strike - right.strike,
  );
  if (!rows.length) return [];

  const sortedByDistance = isFiniteNumber(spotPrice)
    ? rows
        .slice()
        .sort(
          (left, right) =>
            Math.abs(left.strike - spotPrice) -
            Math.abs(right.strike - spotPrice),
        )
        .slice(0, 15)
    : rows.slice(0, 15);
  const visible = sortedByDistance.sort(
    (left, right) => left.strike - right.strike,
  );
  const atmStrike = isFiniteNumber(spotPrice)
    ? visible.reduce(
        (closest, row) =>
          Math.abs(row.strike - spotPrice) < Math.abs(closest - spotPrice)
            ? row.strike
            : closest,
        visible[0].strike,
      )
    : visible[Math.floor(visible.length / 2)]?.strike ?? visible[0].strike;

  return visible.map((row) => ({
    ...row,
    callPrem: +row.callPrem.toFixed(0),
    putPrem: +row.putPrem.toFixed(0),
    total: +row.total.toFixed(0),
    isATM: row.strike === atmStrike,
  }));
};

const buildTradeOptionFlowTimeline = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 15;
  const bucketCount = 26;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    t: index,
    callPrem: 0,
    putPrem: 0,
    net: 0,
    cumCall: 0,
    cumPut: 0,
    cumNet: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    const amount = evt.premium / 1000;
    if (evt.cp === "C") buckets[bucketIndex].callPrem += amount;
    else buckets[bucketIndex].putPrem += amount;
  });

  let cumCall = 0;
  let cumPut = 0;
  return buckets.map((bucket) => {
    cumCall += bucket.callPrem;
    cumPut += bucket.putPrem;
    const net = bucket.callPrem - bucket.putPrem;
    return {
      ...bucket,
      callPrem: +bucket.callPrem.toFixed(1),
      putPrem: +bucket.putPrem.toFixed(1),
      net: +net.toFixed(1),
      cumCall: +cumCall.toFixed(1),
      cumPut: +cumPut.toFixed(1),
      cumNet: +(cumCall - cumPut).toFixed(1),
    };
  });
};

const buildTradeFlowMarkersFromEvents = (events, barsLength) => {
  if (!barsLength) return [];

  return (events || [])
    .slice()
    .sort((left, right) => right.premium - left.premium)
    .slice(0, 8)
    .map((evt) => {
      const minutes = toSessionMinutes(evt.occurredAt);
      const normalizedMinutes =
        minutes == null
          ? 9 * 60 + 30
          : Math.max(9 * 60 + 30, Math.min(16 * 60, minutes));
      const ratio =
        (normalizedMinutes - (9 * 60 + 30)) / (16 * 60 - (9 * 60 + 30));
      return {
        barIdx: Math.max(
          0,
          Math.min(barsLength - 1, Math.round(ratio * (barsLength - 1))),
        ),
        cp: evt.cp,
        size:
          evt.premium >= 500000 ? "lg" : evt.premium >= 150000 ? "md" : "sm",
        golden: evt.golden,
      };
    });
};

const resolveApiBarTimestampMs = (value) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const buildChartBarsFromApi = (bars) =>
  (bars || []).reduce((result, bar, index) => {
    const timeMs = resolveApiBarTimestampMs(
      bar?.timestamp ?? bar?.ts ?? bar?.time,
    );
    if (timeMs == null) {
      return result;
    }

    result.push({
      time: timeMs,
      timestamp: timeMs,
      ts:
        typeof bar?.timestamp === "string"
          ? bar.timestamp
          : typeof bar?.ts === "string"
            ? bar.ts
            : new Date(timeMs).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
      vwap: Number.isFinite(bar?.vwap) ? bar.vwap : null,
      sessionVwap: Number.isFinite(bar?.sessionVwap) ? bar.sessionVwap : null,
      accumulatedVolume: Number.isFinite(bar?.accumulatedVolume)
        ? bar.accumulatedVolume
        : null,
      averageTradeSize: Number.isFinite(bar?.averageTradeSize)
        ? bar.averageTradeSize
        : null,
      source: typeof bar?.source === "string" ? bar.source : null,
      i: index,
      uoa: 0,
    });
    return result;
  }, []);

const buildMiniChartBarsFromApi = (bars) => buildChartBarsFromApi(bars);

const buildTradeBarsFromApi = (bars) => buildChartBarsFromApi(bars);

const CHART_TIMEFRAME_STEP_MS = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

const describeBrokerChartSource = (source) => {
  if (typeof source === "string" && source.endsWith(":rollup")) {
    const baseSource = source.replace(/:rollup$/, "");
    const baseLabel = describeBrokerChartSource(baseSource);
    return baseLabel ? `${baseLabel} ROLL` : "ROLL";
  }
  if (source === "ibkr-websocket-derived") return "WS";
  if (source === "polygon-delayed-websocket") return "DELAYED WS";
  if (source === "ibkr-option-quote-derived") return "LIVE";
  if (source === "ibkr+massive-gap-fill") return "IBKR + GAP";
  if (source === "ibkr-history") return "IBKR";
  return source ? "REST" : "";
};

const describeBrokerChartStatus = (status, timeframe) =>
  status === "live" ? `IBKR ${timeframe}` : status;

// ═══════════════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════════════

const SCREENS = [
  { id: "market", label: "Market", icon: "◉" },
  { id: "flow", label: "Flow", icon: "◈" },
  { id: "trade", label: "Trade", icon: "◧" },
  { id: "account", label: "Account", icon: "▣" },
  { id: "research", label: "Research", icon: "◎" },
  { id: "algo", label: "Algo", icon: "⬡" },
  { id: "backtest", label: "Backtest", icon: "⏣" },
  { id: "diagnostics", label: "Diagnostics", icon: "▤" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

// Cold load keeps hidden heavy screens out of the render tree.  Screens mount
// on first visit; background query warmup is handled separately after the shell
// is visible so charting/trade chunks do not block first paint.
const OPERATIONAL_SCREEN_PRELOAD_ORDER = [];
const INACTIVE_HEAVY_QUERY_PREFIXES = [
  ["/api/bars"],
  ["/api/flow/events"],
  ["market-sparklines"],
  ["market-performance-baselines"],
  ["option-chart-bars"],
  ["trade-flow"],
  ["trade-option-chain"],
  ["trade-option-chain-batch"],
];

const buildMountedScreenState = (activeScreen) =>
  Object.fromEntries(
    SCREENS.map(({ id }) => [id, id === activeScreen]),
  );

const scheduleIdleWork = (callback, timeout = 1_500) => {
  if (typeof window === "undefined") {
    return () => {};
  }
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback?.(idleId);
  }
  const timerId = window.setTimeout(callback, 180);
  return () => window.clearTimeout(timerId);
};

const ScreenLoadingFallback = ({ label = "Loading" }) => (
  <div
    data-testid="screen-loading-fallback"
    style={{
      flex: 1,
      minHeight: 0,
      display: "grid",
      gridTemplateRows: "minmax(180px, 44%) 1fr",
      gap: sp(10),
      padding: sp(12),
      background: T.bg0,
      color: T.textDim,
      fontFamily: T.sans,
              }}
  >
    <style>
      {`
        @keyframes rayalgoScreenFallbackPulse {
          0%, 100% { opacity: 0.42; }
          50% { opacity: 0.86; }
        }
      `}
    </style>
    <div
      style={{
        border: `1px solid ${T.border}`,
        background: T.bg1,
        animation: "rayalgoScreenFallbackPulse 1.45s ease-in-out infinite",
      }}
    />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: sp(10),
      }}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            border: `1px solid ${T.border}`,
            background: T.bg1,
            animation: `rayalgoScreenFallbackPulse ${1.55 + index * 0.12}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
    <span
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
      }}
    >
      {label}
    </span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════════

export const Pill = ({ children, active, onClick, color }) => (
  <button
    onClick={onClick}
    className={onClick ? "ra-interactive" : undefined}
    style={{
      ...motionVars({ accent: color || T.accent }),
      padding: sp("3px 7px"),
      fontSize: fs(11),
      fontFamily: T.sans,
      fontWeight: 600,
      border: `1px solid ${active ? color || T.accent : T.border}`,
      borderRadius: dim(4),
      cursor: "pointer",
      transition: "all 0.15s",
      background: active ? `${color || T.accent}18` : "transparent",
      color: active ? color || T.accent : T.textDim,
    }}
  >
    {children}
  </button>
);

// Format dollar amount in millions (or thousands if smaller). Module-level so any screen can use it.
export const fmtM = (v) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;
const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};
export const fmtCompactNumber = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};
const fmtQuoteVolume = (value) =>
  value == null || Number.isNaN(value) ? MISSING_VALUE : fmtCompactNumber(value);
export const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
const formatPriceValue = (value, digits = 2) =>
  isFiniteNumber(value) ? value.toFixed(digits) : MISSING_VALUE;
export const formatQuotePrice = (value) =>
  isFiniteNumber(value)
    ? value < 10
      ? value.toFixed(3)
      : value.toFixed(2)
    : MISSING_VALUE;
const formatSignedPrice = (value, digits = 2) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`
    : MISSING_VALUE;
export const formatSignedPercent = (value, digits = 2) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
    : MISSING_VALUE;
export const getAtmStrikeFromPrice = (price, increment = 5) =>
  isFiniteNumber(price) ? Math.round(price / increment) * increment : null;

export const QUERY_DEFAULTS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  retry: 2,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
  refetchOnMount: true,
  // Aggressively reclaim heap held by large payloads (chart bars, snapshots,
  // option chain). React Query defaults to 5 minutes, which keeps every
  // historical fetch around for the whole window — not what we want on a
  // long-running trading session.
  gcTime: 30_000,
};

// Bar/chart data is expensive on the upstream broker (each /api/bars call
// can hold an IBKR history slot for many seconds). Live updates flow in
// through the streaming aggregate hook (`useBrokerStreamedBars`), so we
// don't need React Query to repoll bars on a 15s timer. Use a long
// staleTime, no automatic refetch interval, and an explicit gcTime so
// chart caches for inactive symbols/timeframes are evicted from memory.
export const BARS_QUERY_DEFAULTS = {
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  retry: 1,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
};

const DISPLAY_CHART_PRICE_QUERY_DEFAULTS = {
  ...BARS_QUERY_DEFAULTS,
  staleTime: 60_000,
  refetchOnMount: true,
};

export const BARS_REQUEST_PRIORITY_HEADER = HYDRATION_PRIORITY_HEADER;
export const BARS_REQUEST_PRIORITY = {
  background: HYDRATION_PRIORITY.background,
  favoritePrewarm: HYDRATION_PRIORITY.near,
  visible: HYDRATION_PRIORITY.visible,
  active: HYDRATION_PRIORITY.active,
};

export const buildBarsRequestOptions = buildHydrationRequestOptions;

// Even tighter window for the heaviest non-chart payloads (option chains,
// flow batches, depth, executions, dashboard sparkline/baseline batches).
// Option chains can be hundreds of KB per underlying, so we want them evicted
// quickly when the user moves on.
export const HEAVY_PAYLOAD_GC_MS = 15_000;

export const clampNumber = (value, min, max) =>
  Math.min(max, Math.max(min, value));

const settleWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = {
            status: "fulfilled",
            value: await mapper(items[index], index),
          };
        } catch (reason) {
          results[index] = {
            status: "rejected",
            reason,
          };
        }
      }
    }),
  );

  return results;
};

const buildApiUrl = (path, params = {}) => {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost";
  const url = new URL(path, origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
};

const requestPlatformJson = async (path, params = {}) => {
  const response = await fetch(buildApiUrl(path, params), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(
      errorPayload?.detail ||
        errorPayload?.title ||
        `Request failed with status ${response.status}.`,
    );
  }

  return response.json();
};

const listBrokerExecutionsRequest = (params = {}) =>
  requestPlatformJson("/api/executions", params);

const getBrokerMarketDepthRequest = (params = {}) =>
  requestPlatformJson("/api/market-depth", params);

const FINAL_ORDER_STATUSES = new Set([
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

const formatExecutionContractLabel = (execution) => {
  if (!execution) return MISSING_VALUE;
  if (execution.assetClass === "option") {
    return execution.contractDescription || `${execution.symbol} OPTION`;
  }
  return "EQUITY";
};

const sameOptionContract = (left, right) => {
  if (!left || !right) return false;

  return (
    Number(left.strike) === Number(right.strike) &&
    String(left.right).toLowerCase() === String(right.right).toLowerCase() &&
    formatIsoDate(left.expirationDate) === formatIsoDate(right.expirationDate)
  );
};

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getEtClockParts = (value) => {
  const date = toDateValue(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );

  return { hour, minute };
};

export const formatExpirationLabel = (value) => {
  if (typeof value === "string" && /^\d{2}\/\d{2}$/.test(value)) return value;

  const date = toDateValue(value);
  if (!date) return value || MISSING_VALUE;

  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
};

export const parseExpirationValue = (value) => {
  const parsed = toDateValue(value);
  if (parsed) return parsed;
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;

  const now = new Date();
  const month = Number(match[1]);
  const day = Number(match[2]);
  let candidate = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));

  if (candidate.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) {
    candidate = new Date(Date.UTC(now.getUTCFullYear() + 1, month - 1, day));
  }

  return candidate;
};

export const formatIsoDate = (value) => {
  const date = toDateValue(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
};

const formatShortDate = (value) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  return formatAppDate(date, {
    month: "short",
    day: "numeric",
  });
};

export const formatRelativeTimeShort = (value) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return formatShortDate(date);

  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) return "now";
  if (deltaMinutes < 60) return `${deltaMinutes}m`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h`;

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d`;

  return formatShortDate(date);
};

export const formatEnumLabel = (value) =>
  String(value || MISSING_VALUE)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const orderStatusColor = (status) => {
  switch (status) {
    case "filled":
      return T.green;
    case "accepted":
    case "submitted":
    case "partially_filled":
    case "pending_submit":
      return T.accent;
    case "canceled":
    case "expired":
      return T.textDim;
    case "rejected":
      return T.red;
    default:
      return T.text;
  }
};

export const bridgeRuntimeTone = (session) => {
  if (!session?.configured?.ibkr) return { label: "offline", color: T.red };
  const bridge = session?.ibkrBridge;
  if (bridge?.competing) {
    return { label: "competing", color: T.red };
  }
  const streamMeta = getIbkrStreamStateMeta(
    bridge?.streamState,
    bridge?.streamStateReason,
  );
  if (streamMeta?.status === "reconnect_needed") {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      pulse: streamMeta.pulse,
    };
  }
  if (bridge?.connected === false) {
    return {
      label: bridge?.lastError || bridge?.lastRecoveryError ? "error" : "offline",
      color: T.red,
    };
  }
  if (
    bridge?.healthFresh === false &&
    (bridge?.connected || bridge?.authenticated || bridge?.bridgeReachable)
  ) {
    return { label: "stale", color: T.amber };
  }
  if (bridge?.connected && !bridge?.authenticated) {
    return { label: "login required", color: T.amber };
  }
  if (
    bridge?.authenticated &&
    bridge?.accountsLoaded === false
  ) {
    return { label: "checking", color: T.amber };
  }
  if (
    bridge?.authenticated &&
    (bridge?.configuredLiveMarketDataMode === false ||
      bridge?.liveMarketDataAvailable === false)
  ) {
    return { label: "delayed", color: T.amber };
  }
  if (streamMeta) {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      pulse: streamMeta.pulse,
    };
  }
  if (bridge?.strictReady === true) {
    return { label: "live", color: T.green };
  }
  if (
    bridge?.authenticated &&
    bridge?.streamFresh === false
  ) {
    return { label: "stale", color: T.amber, pulse: true };
  }
  if (bridge?.authenticated)
    return { label: "waiting", color: T.amber };
  if (bridge?.lastError) return { label: "error", color: T.red };
  return { label: "configured", color: T.textDim };
};

const bridgeTransportLabel = () => "IB Gateway";

export const bridgeRuntimeMessage = (session) => {
  if (!session?.configured?.ibkr) {
    return "Interactive Brokers is not configured in this workspace.";
  }

  const bridge = session?.ibkrBridge;
  const marketDataMode = bridge?.marketDataMode || null;
  const streamState = bridge?.streamState;
  if (streamState === "reconnect_needed") {
    return "Reconnect IBKR to create a fresh Gateway tunnel.";
  }
  if (bridge?.connected === false) {
    if (bridge?.lastRecoveryError) {
      return bridge.lastRecoveryError;
    }
    if (bridge?.lastError) {
      return bridge.lastError;
    }
    return `${bridgeTransportLabel(session)} is not connected to the broker session.`;
  }
  if (
    bridge?.healthFresh === false &&
    streamState !== "reconnect_needed"
  ) {
    return "IBKR bridge status is stale; waiting for a fresh Gateway health check.";
  }

  if (bridge?.authenticated) {
    const accountMeta = bridge.selectedAccountId
      ? ` account ${bridge.selectedAccountId}`
      : "";
    const transportMeta = bridgeTransportLabel(session);
    if (bridge?.accountsLoaded === false) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; checking account and stream readiness.`;
    }
    if (
      bridge?.configuredLiveMarketDataMode === false ||
      bridge?.liveMarketDataAvailable === false
    ) {
      const modeMeta = marketDataMode ? ` (${marketDataMode})` : "";
      return `IBKR bridge authenticated via ${transportMeta}${accountMeta}, but market data is delayed${modeMeta}.`;
    }
    if (
      streamState === "quiet" &&
      bridge?.streamStateReason === "no_active_quote_consumers"
    ) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; waiting for a live quote subscription.`;
    }
    if (
      streamState === "quiet" &&
      bridge?.streamStateReason === "market_session_quiet"
    ) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; market session is closed.`;
    }
    if (streamState === "live" || bridge?.strictReady === true) {
      return `IBKR live stream is active via ${transportMeta}${accountMeta}.`;
    }
    if (streamState === "quiet") {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; stream is quiet for an unspecified reason.`;
    }
    if (streamState === "reconnecting") {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; quote stream is reconnecting.`;
    }
    if (streamState === "reconnect_needed") {
      return "Reconnect IBKR to create a fresh Gateway tunnel.";
    }
    if (streamState === "stale" || bridge?.streamFresh === false) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; stream is stale and waiting for fresh events.`;
    }
    return `IBKR bridge authenticated via ${transportMeta}${accountMeta}; waiting for strict stream proof.`;
  }

  if (bridge?.connected) {
    return `${bridgeTransportLabel(session)} is reachable, but the broker session still needs login/authorization.`;
  }

  if (bridge?.lastRecoveryError) {
    return bridge.lastRecoveryError;
  }

  if (bridge?.lastError) {
    return bridge.lastError;
  }

  return "IBKR connectivity is configured, but the local bridge has not authenticated yet.";
};

export const resolveGatewayTradingReadiness = (session) => {
  if (!session?.configured?.ibkr) {
    return {
      ready: false,
      reason: "ibkr_not_configured",
      message: "Interactive Brokers is not configured for order routing.",
    };
  }

  const bridge = session?.ibkrBridge;
  if (!bridge) {
    return {
      ready: false,
      reason: "bridge_health_unavailable",
      message: "IB Gateway trading is unavailable until the bridge returns a fresh health check.",
    };
  }

  if (bridge.competing === true) {
    return {
      ready: false,
      reason: "gateway_competing_session",
      message: "IB Gateway is connected, but another session is competing for the broker connection.",
    };
  }

  if (bridge.healthFresh === false) {
    return {
      ready: false,
      reason: "health_stale",
      message: "IB Gateway trading is unavailable until the bridge status is fresh.",
    };
  }

  if (bridge.connected !== true) {
    return {
      ready: false,
      reason: "gateway_socket_disconnected",
      message: "IB Gateway is disconnected. Reconnect Gateway before trading.",
    };
  }

  if (bridge.authenticated !== true) {
    return {
      ready: false,
      reason: "gateway_login_required",
      message: "IB Gateway is connected, but the broker session is not authenticated.",
    };
  }

  const accountsLoaded =
    bridge.accountsLoaded === true ||
    (Array.isArray(bridge.accounts) && bridge.accounts.length > 0) ||
    Boolean(bridge.selectedAccountId);
  if (!accountsLoaded) {
    return {
      ready: false,
      reason: "accounts_unavailable",
      message: "IB Gateway is connected, but no broker accounts are loaded yet.",
    };
  }

  return {
    ready: true,
    reason: null,
    message: "IB Gateway is connected and ready for trading.",
  };
};

const ET_CLOCK_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const ET_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatClockCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.round(totalSeconds || 0));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const hhmmss = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
};

const buildMarketClockState = (now = Date.now(), preferences) => {
  const clockDate = new Date(now);
  const parts = Object.fromEntries(
    ET_CLOCK_PARTS_FORMATTER.formatToParts(clockDate).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const weekdayIndex = ET_WEEKDAY_INDEX[parts.weekday] ?? 0;
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  const currentSeconds = hour * 3600 + minute * 60 + second;
  const openSeconds = 9 * 3600 + 30 * 60;
  const closeSeconds = 16 * 3600;
  const afterHoursCloseSeconds = 20 * 3600;
  const nextBusinessDayOffset =
    weekdayIndex === 5 ? 3 : weekdayIndex === 6 ? 2 : weekdayIndex === 0 ? 1 : 1;

  const base = {
    timeLabel: `${formatPreferenceDateTime(clockDate, {
      preferences,
      context: "app",
      includeDate: false,
      includeTime: true,
      fallback: `${parts.hour}:${parts.minute}:${parts.second}`,
    })}${
      preferences?.time?.showTimeZoneBadge
        ? ` ${formatPreferenceTimeZoneLabel(preferences, "app")}`
        : ""
    }`,
    dateLabel: formatPreferenceDateTime(clockDate, {
      preferences,
      context: "app",
      includeDate: false,
      includeTime: false,
      weekdayStyle: "short",
      monthStyle: "short",
      dayStyle: "numeric",
      fallback: `${parts.weekday} ${parts.month} ${parts.day}`,
    }),
  };

  if (weekdayIndex === 0 || weekdayIndex === 6) {
    const daysUntilOpen = weekdayIndex === 6 ? 2 : 1;
    return {
      ...base,
      phase: "weekend",
      label: "Weekend",
      action: "Opens",
      timerLabel: formatClockCountdown(
        daysUntilOpen * 86400 + openSeconds - currentSeconds,
      ),
      color: T.textDim,
    };
  }

  if (currentSeconds < openSeconds) {
    return {
      ...base,
      phase: "pre",
      label: "Pre-market",
      action: "Opens",
      timerLabel: formatClockCountdown(openSeconds - currentSeconds),
      color: T.amber,
    };
  }

  if (currentSeconds < closeSeconds) {
    return {
      ...base,
      phase: "open",
      label: "Market open",
      action: "Closes",
      timerLabel: formatClockCountdown(closeSeconds - currentSeconds),
      color: T.green,
    };
  }

  if (currentSeconds < afterHoursCloseSeconds) {
    return {
      ...base,
      phase: "post",
      label: "After hours",
      action: "Opens",
      timerLabel: formatClockCountdown(
        nextBusinessDayOffset * 86400 + openSeconds - currentSeconds,
      ),
      color: T.amber,
    };
  }

  return {
    ...base,
    phase: "closed",
    label: "Closed",
    action: "Opens",
    timerLabel: formatClockCountdown(
      nextBusinessDayOffset * 86400 + openSeconds - currentSeconds,
    ),
    color: T.textDim,
  };
};

export const parseSymbolUniverseInput = (value) =>
  String(value || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol, index, values) => values.indexOf(symbol) === index);

export const formatCalendarMeta = (dateValue, timeValue) => {
  const dateLabel = formatShortDate(dateValue);
  if (!timeValue) return dateLabel;

  const normalized = String(timeValue).trim().toUpperCase();
  if (!normalized) return dateLabel;

  return `${dateLabel} · ${normalized}`;
};

export const mapNewsSentimentToScore = (sentiment) => {
  const normalized = String(sentiment || "")
    .trim()
    .toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes("bull") || normalized.includes("positive")) return 1;
  if (normalized.includes("bear") || normalized.includes("negative")) return -1;
  return 0;
};

export const daysToExpiration = (value) => {
  const date = parseExpirationValue(value);
  if (!date) return 0;

  const now = new Date();
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  return Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
};

const toSessionMinutes = (value) => {
  const parts = getEtClockParts(value);
  if (!parts) return null;
  return parts.hour * 60 + parts.minute;
};

const formatSessionBucketLabel = (minutes) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
};

export const flowProviderColor = (provider) =>
  provider === "ibkr" ? T.accent : provider === "polygon" ? T.cyan : T.textDim;

const flowEventSourceLabel = (event) => {
  const provider = (event.provider || "unknown").toUpperCase();
  const basis = event.basis === "trade" ? "TRADE" : "SNAPSHOT";
  return `${provider} ${basis}`;
};

const deriveFlowType = (event) => {
  const conditions = (event.tradeConditions || []).map((condition) =>
    String(condition).toLowerCase(),
  );

  // An "unusual" tag (volume > open interest) trumps the heuristic labels.
  // It is the strongest single signal in the event and what we want to flag.
  if (event.isUnusual) {
    return "UNUSUAL";
  }
  if (event.basis === "snapshot") {
    return event.premium >= 500000 ? "XL" : "ACTIVE";
  }
  if (
    event.premium >= 500000 ||
    conditions.some((condition) => condition.includes("block"))
  ) {
    return "BLOCK";
  }
  if (event.side === "buy" && event.premium >= 100000) {
    return "SWEEP";
  }
  if (conditions.length > 1) {
    return "MULTI";
  }

  return "SPLIT";
};

const deriveFlowScore = (event, dte) => {
  let score = 35;
  score += Math.min(35, event.premium / 20000);
  score += event.side === "buy" ? 12 : event.side === "sell" ? 5 : 0;
  score += event.sentiment === "neutral" ? 0 : 10;
  score -= Math.min(10, dte / 7);
  if (event.isUnusual) {
    // Boost unusual events noticeably so they sort to the top of any
    // score-based view, with extra credit for higher volume/OI ratios.
    score += 18 + Math.min(12, (event.unusualScore || 0) * 4);
  }
  return Math.max(10, Math.min(99, Math.round(score)));
};

const FLOW_SCANNER_UNIVERSE_QUERY_KEY = ["/api/flow/universe"];

const normalizeFlowUniverseSymbols = (symbols = []) => [
  ...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean),
  ),
];

const fetchFlowScannerUniverse = async () => {
  const payload = await getFlowUniverseRequest();
  return {
    symbols: normalizeFlowUniverseSymbols(payload?.symbols),
    coverage: payload?.coverage || null,
  };
};

export const mapFlowEventToUi = (event, preferences) => {
  const dte = daysToExpiration(event.expirationDate);
  const cp = event.right === "call" ? "C" : "P";
  const side = (event.side || "mid").toUpperCase();
  const sourceBasis =
    event.sourceBasis ||
    (event.confidence
      ? event.confidence
      : event.basis === "trade"
        ? "confirmed_trade"
        : event.provider === "polygon"
          ? "fallback_estimate"
          : "snapshot_activity");
  const confidence = event.confidence || sourceBasis;
  const premiumModel = calculateOptionTradePremium({
    executionPrice: event.price,
    mark: event.mark,
    bid: event.bid,
    ask: event.ask,
    last: event.last,
    size: event.size,
    multiplier: event.multiplier,
    sharesPerContract: event.sharesPerContract,
  });
  const premium = premiumModel.premium || event.premium || 0;
  const flowBias = inferFlowBias({ cp, side: event.side });
  const spot = isFiniteNumber(event.underlyingPrice)
    ? event.underlyingPrice
    : isFiniteNumber(event.spotPrice)
      ? event.spotPrice
      : null;
  const moneyness = classifyOptionMoneyness({
    spot,
    strike: event.strike,
    right: event.right,
    strikeSpacing: event.strikeSpacing,
    nearestStrikeDistance: event.nearestStrikeDistance,
  });
  const distancePercent = isFiniteNumber(event.distancePercent)
    ? event.distancePercent
    : spot && isFiniteNumber(event.strike)
      ? ((event.strike - spot) / spot) * 100
      : null;

  return {
    id: event.id,
    time: preferences
      ? formatAppTimeForPreferences(event.occurredAt, preferences)
      : formatAppTime(event.occurredAt),
    ticker: event.underlying,
    provider: event.provider || "unknown",
    basis: event.basis || "trade",
    sourceLabel: flowEventSourceLabel(event),
    side,
    contract: `${event.underlying} ${event.strike}${cp} ${formatExpirationLabel(event.expirationDate)}`,
    strike: event.strike,
    cp,
    price: event.price,
    bid: isFiniteNumber(event.bid) ? event.bid : null,
    ask: isFiniteNumber(event.ask) ? event.ask : null,
    last: isFiniteNumber(event.last) ? event.last : null,
    mark: isFiniteNumber(event.mark) ? event.mark : null,
    premium,
    premiumPrice: premiumModel.premiumPrice,
    premiumPriceSource: premiumModel.premiumPriceSource,
    flowBias,
    spot,
    underlyingPrice: spot,
    moneyness:
      event.moneyness && event.moneyness !== "UNKNOWN"
        ? event.moneyness
        : moneyness,
    distancePercent,
    delta: isFiniteNumber(event.delta) ? event.delta : null,
    gamma: isFiniteNumber(event.gamma) ? event.gamma : null,
    theta: isFiniteNumber(event.theta) ? event.theta : null,
    vega: isFiniteNumber(event.vega) ? event.vega : null,
    confidence,
    sourceBasis,
    vol: event.size,
    oi: isFiniteNumber(event.openInterest) ? event.openInterest : null,
    iv: isFiniteNumber(event.impliedVolatility)
      ? event.impliedVolatility
      : null,
    dte,
    type: deriveFlowType(event),
    golden:
      side === "BUY" &&
      premium >= 150000 &&
      event.sentiment === "bullish",
    score: deriveFlowScore(event, dte),
    optionTicker: event.optionTicker,
    providerContractId: event.providerContractId || null,
    expirationDate: event.expirationDate,
    occurredAt: event.occurredAt,
    sentiment: event.sentiment,
    tradeConditions: event.tradeConditions || [],
    isUnusual: Boolean(event.isUnusual),
    unusualScore: isFiniteNumber(event.unusualScore) ? event.unusualScore : 0,
  };
};

let liveMarketFlowInstanceCounter = 0;

export const useLiveMarketFlow = (
  symbols = [],
  {
    enabled = true,
    limit = 16,
    maxSymbols = 8,
    batchSize,
    unusualThreshold,
    minPremium,
    maxDte,
    mode = FLOW_SCANNER_MODE.watchlist,
    scope = FLOW_SCANNER_SCOPE.all,
    concurrency,
    scannerConfig,
    intervalMs = 10_000,
    workloadLabel = null,
  } = {},
) => {
  const { preferences: userPreferences } = useUserPreferences();
  const instanceIdRef = useRef(null);
  if (instanceIdRef.current == null) {
    liveMarketFlowInstanceCounter += 1;
    instanceIdRef.current = liveMarketFlowInstanceCounter;
  }
  const effectiveScannerConfig = useMemo(
    () =>
      normalizeFlowScannerConfig({
        ...scannerConfig,
        mode: scannerConfig?.mode ?? mode,
        scope: scannerConfig?.scope ?? scope,
        maxSymbols: scannerConfig?.maxSymbols ?? maxSymbols,
        batchSize: scannerConfig?.batchSize ?? batchSize,
        intervalMs: scannerConfig?.intervalMs ?? intervalMs,
        concurrency: scannerConfig?.concurrency ?? concurrency,
        limit: scannerConfig?.limit ?? limit,
        unusualThreshold: scannerConfig?.unusualThreshold ?? unusualThreshold,
        minPremium: scannerConfig?.minPremium ?? minPremium,
        maxDte: scannerConfig?.maxDte ?? maxDte,
      }),
    [
      batchSize,
      concurrency,
      intervalMs,
      limit,
      maxDte,
      maxSymbols,
      minPremium,
      mode,
      scannerConfig,
      scope,
      unusualThreshold,
    ],
  );
  const shouldLoadMarketUniverse =
    enabled && effectiveScannerConfig.mode !== FLOW_SCANNER_MODE.watchlist;
  const marketUniverseQuery = useQuery({
    queryKey: FLOW_SCANNER_UNIVERSE_QUERY_KEY,
    queryFn: fetchFlowScannerUniverse,
    enabled: shouldLoadMarketUniverse,
    staleTime: 60_000,
    refetchInterval: shouldLoadMarketUniverse ? 60_000 : false,
    refetchOnWindowFocus: false,
  });
  const backendMarketSymbols = marketUniverseQuery.data?.symbols || [];
  const marketUniverseCoverage = marketUniverseQuery.data?.coverage || null;
  const liveSymbols = useMemo(
    () =>
      buildFlowScannerSymbols({
        watchlistSymbols: symbols,
        marketSymbols: backendMarketSymbols.length
          ? backendMarketSymbols
          : undefined,
        config: effectiveScannerConfig,
      }),
    [symbols, backendMarketSymbols, effectiveScannerConfig],
  );
  const liveSymbolsKey = liveSymbols.join(",");
  const effectiveBatchSize = Math.max(
    1,
    Math.min(effectiveScannerConfig.batchSize, liveSymbols.length || 1),
  );
  const effectiveLimit = effectiveScannerConfig.limit;
  const effectiveIntervalMs = effectiveScannerConfig.intervalMs;
  const effectiveConcurrency = effectiveScannerConfig.concurrency;
  const normalizedThreshold =
    Number.isFinite(effectiveScannerConfig.unusualThreshold) &&
    effectiveScannerConfig.unusualThreshold > 0
      ? effectiveScannerConfig.unusualThreshold
      : undefined;
  const effectiveMinPremium =
    Number.isFinite(effectiveScannerConfig.minPremium) &&
    effectiveScannerConfig.minPremium > 0
      ? effectiveScannerConfig.minPremium
      : undefined;
  const effectiveMaxDte =
    Number.isFinite(effectiveScannerConfig.maxDte) &&
    effectiveScannerConfig.maxDte !== null
      ? effectiveScannerConfig.maxDte
      : undefined;
  useRuntimeWorkloadFlag(
    `market-flow:${instanceIdRef.current}`,
    Boolean(enabled && liveSymbols.length),
    {
      kind: "poll",
      label:
        workloadLabel ||
        (effectiveBatchSize >= 30
          ? "Flow unusual scanner"
          : "Flow watchlist base"),
      detail: `${effectiveScannerConfig.mode}:${liveSymbols.length}s/${effectiveBatchSize}b/${effectiveConcurrency}c`,
      priority: effectiveBatchSize >= 30 ? 4 : 3,
    },
  );

  // Rotate through the watchlist in batches so large lists eventually get
  // covered without slamming IBKR's snapshot rate limit on every poll.
  const offsetRef = useRef(0);
  const [scanState, setScanState] = useState({
    bySymbol: {},
    isFetching: false,
    isPending: true,
    cycle: 0,
    lastBatch: [],
    lastError: null,
  });

  // Reset rotation + cache when the symbol set changes; drop entries for
  // symbols that are no longer in the watchlist.
  useEffect(() => {
    offsetRef.current = 0;
    setScanState((prev) => {
      const allowed = new Set(liveSymbols);
      const bySymbol = {};
      for (const [symbol, value] of Object.entries(prev.bySymbol)) {
        if (allowed.has(symbol)) bySymbol[symbol] = value;
      }
      return {
        bySymbol,
        isFetching: false,
        isPending: liveSymbols.length > 0,
        cycle: 0,
        lastBatch: [],
        lastError: null,
      };
    });
  }, [liveSymbolsKey]);

  useEffect(() => {
    if (!enabled || !liveSymbols.length) return undefined;
    let cancelled = false;
    let timer = null;
    let consecutiveErrorBatches = 0;

    const schedule = (delay) => {
      if (cancelled) return;
      const visibilityMultiplier =
        typeof document !== "undefined" && document.hidden ? 6 : 1;
      timer = setTimeout(runOnce, Math.max(250, delay * visibilityMultiplier));
    };

    const runOnce = async () => {
      timer = null;
      const total = liveSymbols.length;
      const size = Math.min(effectiveBatchSize, total);
      const start = offsetRef.current % total;
      const batch = [];
      for (let i = 0; i < size; i += 1) {
        batch.push(liveSymbols[(start + i) % total]);
      }
      // Advance the offset before awaiting so symbol-set changes don't replay
      // the same batch.
      offsetRef.current = (start + size) % Math.max(1, total);
      setScanState((prev) => ({ ...prev, isFetching: true, lastBatch: batch }));

      const startedAt = Date.now();
      const results = await runFlowScannerBatch(
        batch,
        effectiveConcurrency,
        (symbol) =>
          listFlowEventsRequest({
            underlying: symbol,
            limit: effectiveLimit,
            scope: effectiveScannerConfig.scope,
            ...(normalizedThreshold !== undefined
              ? { unusualThreshold: normalizedThreshold }
              : {}),
            ...(effectiveMinPremium !== undefined
              ? { minPremium: effectiveMinPremium }
              : {}),
            ...(effectiveMaxDte !== undefined ? { maxDte: effectiveMaxDte } : {}),
          }),
      );
      if (cancelled) return;

      const now = Date.now();
      let batchHadError = false;
      setScanState((prev) => {
        const allowed = new Set(liveSymbols);
        const bySymbol = {};
        for (const [symbol, value] of Object.entries(prev.bySymbol)) {
          if (allowed.has(symbol)) bySymbol[symbol] = value;
        }
        let lastError = null;
        results.forEach((result, index) => {
          const symbol = batch[index];
          if (!allowed.has(symbol)) return;
          if (result.status === "fulfilled") {
            bySymbol[symbol] = {
              events: result.value.events || [],
              source: result.value.source || null,
              scannedAt: now,
              error: null,
            };
          } else {
            batchHadError = true;
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason ?? "Flow request failed");
            const existing = bySymbol[symbol] || { events: [], source: null };
            bySymbol[symbol] = {
              ...existing,
              scannedAt: now,
              error: message,
            };
            lastError = message;
          }
        });
        return {
          bySymbol,
          isFetching: false,
          isPending: false,
          cycle: prev.cycle + 1,
          lastBatch: batch,
          lastError,
        };
      });

      // Schedule the next batch *after* this one completes — never overlap
      // requests, and apply exponential backoff (capped) when batches error so
      // we don't hammer IBKR if the bridge is struggling.
      consecutiveErrorBatches = batchHadError ? consecutiveErrorBatches + 1 : 0;
      const elapsed = Date.now() - startedAt;
      const baseDelay = Math.max(0, effectiveIntervalMs - elapsed);
      const backoff = consecutiveErrorBatches
        ? Math.min(
            60_000,
            effectiveIntervalMs * 2 ** Math.min(consecutiveErrorBatches - 1, 4),
          )
        : 0;
      schedule(baseDelay + backoff);
    };

    runOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    effectiveBatchSize,
    effectiveConcurrency,
    effectiveIntervalMs,
    effectiveLimit,
    effectiveMaxDte,
    effectiveMinPremium,
    effectiveScannerConfig.scope,
    enabled,
    liveSymbolsKey,
    normalizedThreshold,
  ]);

  const responses = useMemo(
    () =>
      Object.entries(scanState.bySymbol).map(([symbol, value]) => ({
        symbol,
        events: value.events || [],
        source: value.source || null,
        scannedAt: value.scannedAt || null,
        error: value.error || null,
      })),
    [scanState.bySymbol],
  );
  const failures = useMemo(
    () =>
      responses
        .filter((response) => response.error)
        .map((response) => ({ symbol: response.symbol, error: response.error })),
    [responses],
  );
  const aggregatedEvents = useMemo(
    () => responses.flatMap((response) => response.events || []),
    [responses],
  );

  const flowEvents = useMemo(() => {
    if (!aggregatedEvents.length) return [];
    return filterFlowScannerEvents(
      aggregatedEvents
        .map((event) => mapFlowEventToUi(event, userPreferences))
        .sort((left, right) => {
          // Float volume-vs-OI "unusual" events to the top so the notifications
          // feed and unusual-options panel surface them ahead of routine high-
          // premium events, then fall back to premium for ranking within bands.
          if (left.isUnusual !== right.isUnusual) {
            return left.isUnusual ? -1 : 1;
          }
          if (
            left.isUnusual &&
            right.isUnusual &&
            left.unusualScore !== right.unusualScore
          ) {
            return right.unusualScore - left.unusualScore;
          }
          return right.premium - left.premium;
        }),
      effectiveScannerConfig,
    );
  }, [aggregatedEvents, effectiveScannerConfig, userPreferences]);
  const hasLiveFlow = flowEvents.length > 0;
  const flowStatus = hasLiveFlow
    ? "live"
    : scanState.isPending || (scanState.isFetching && scanState.cycle === 0)
      ? "loading"
      : failures.length > 0
        ? "offline"
        : "empty";
  const providerSummary = useMemo(() => {
    const events = aggregatedEvents;
    const providerSet = new Set(events.map((event) => event.provider).filter(Boolean));
    const fallbackUsed = responses.some((response) =>
      Boolean(response.source?.fallbackUsed),
    );
    const erroredSource =
      responses.find((response) => response.source?.status === "error")?.source ||
      null;
    const sourcesBySymbol = Object.fromEntries(
      responses.map((response) => [response.symbol, response.source]),
    );
    const appliedThresholds = responses
      .map((response) => response.source?.unusualThreshold)
      .filter((value) => Number.isFinite(value) && value > 0);
    const scannerCoverage =
      responses.find((response) => response.source?.scannerCoverage)?.source
        ?.scannerCoverage || null;
    const appliedThresholdCounts = new Map();
    appliedThresholds.forEach((value) => {
      appliedThresholdCounts.set(
        value,
        (appliedThresholdCounts.get(value) || 0) + 1,
      );
    });
    let appliedUnusualThreshold = null;
    let appliedUnusualThresholdConsistent = true;
    if (appliedThresholdCounts.size > 0) {
      let bestValue = null;
      let bestCount = -1;
      for (const [value, count] of appliedThresholdCounts) {
        if (count > bestCount) {
          bestValue = value;
          bestCount = count;
        }
      }
      appliedUnusualThreshold = bestValue;
      appliedUnusualThresholdConsistent = appliedThresholdCounts.size === 1;
    }

    let label = "No IBKR flow";
    let color = T.textMuted;
    if (scanState.isPending || (scanState.isFetching && scanState.cycle === 0)) {
      label = "Loading flow";
      color = T.accent;
    } else if (providerSet.has("ibkr") && providerSet.has("polygon")) {
      label = "Mixed sources";
      color = T.amber;
    } else if (providerSet.has("ibkr")) {
      label = "IBKR snapshot live";
      color = T.accent;
    } else if (providerSet.has("polygon")) {
      label = "Polygon trade fallback";
      color = T.cyan;
    } else if (failures.length || erroredSource) {
      label = "Flow source error";
      color = T.red;
    } else if (fallbackUsed) {
      label = "Fallback empty";
      color = T.textMuted;
    }

    const lastScannedAt = {};
    for (const [symbol, value] of Object.entries(scanState.bySymbol)) {
      if (value.scannedAt) lastScannedAt[symbol] = value.scannedAt;
    }
    const scannedSymbols = Object.keys(lastScannedAt);
    const scannedAtValues = Object.values(lastScannedAt);
    const oldestScanAt = scannedAtValues.length
      ? Math.min(...scannedAtValues)
      : null;
    const newestScanAt = scannedAtValues.length
      ? Math.max(...scannedAtValues)
      : null;
    const coverageSource = scannerCoverage || marketUniverseCoverage;
    const coverage = {
      totalSymbols: coverageSource?.targetSize || liveSymbols.length,
      scannedSymbols: Math.max(
        scannedSymbols.length,
        coverageSource?.scannedSymbols || 0,
      ),
      batchSize: effectiveBatchSize,
      currentBatch: coverageSource?.currentBatch?.length
        ? coverageSource.currentBatch
        : scanState.lastBatch,
      cycle: scanState.cycle,
      isFetching: scanState.isFetching,
      lastScannedAt,
      isRotating:
        (coverageSource?.selectedSymbols || liveSymbols.length) >
        effectiveBatchSize,
      mode: coverageSource?.mode || effectiveScannerConfig.mode,
      selectedSymbols: coverageSource?.selectedSymbols || liveSymbols.length,
      targetSize: coverageSource?.targetSize || liveSymbols.length,
      cooldownCount: coverageSource?.cooldownCount || 0,
      stale: Boolean(coverageSource?.stale),
      fallbackUsed: Boolean(coverageSource?.fallbackUsed),
      degradedReason: coverageSource?.degradedReason || null,
      rankedAt: coverageSource?.rankedAt || null,
      lastRefreshAt: coverageSource?.lastRefreshAt || null,
      lastGoodAt: coverageSource?.lastGoodAt || null,
      lastScanAt: coverageSource?.lastScanAt || null,
      oldestScanAt: coverageSource?.oldestScanAt || oldestScanAt,
      newestScanAt: coverageSource?.newestScanAt || newestScanAt,
      scope: effectiveScannerConfig.scope,
      minPremium: effectiveScannerConfig.minPremium,
      maxDte: effectiveScannerConfig.maxDte,
      concurrency: effectiveConcurrency,
    };

    return {
      label,
      color,
      fallbackUsed,
      sourcesBySymbol,
      failures,
      erroredSource,
      providers: Array.from(providerSet),
      appliedUnusualThreshold,
      appliedUnusualThresholdConsistent,
      coverage,
    };
  }, [
    aggregatedEvents,
    responses,
    failures,
    scanState,
    liveSymbols.length,
    marketUniverseCoverage,
    effectiveBatchSize,
    effectiveConcurrency,
    effectiveScannerConfig,
  ]);

  return {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
    flowTide: buildFlowTideFromEvents(flowEvents),
    tickerFlow: buildTickerFlowFromEvents(flowEvents),
    flowClock: buildFlowClockFromEvents(flowEvents),
    sectorFlow: buildSectorFlowFromEvents(flowEvents),
    dteBuckets: buildDteBucketsFromEvents(flowEvents),
    marketOrderFlow: buildMarketOrderFlowFromEvents(flowEvents),
    putCall: buildPutCallSummaryFromEvents(flowEvents),
  };
};

const SharedMarketFlowRuntime = memo(({
  symbols = [],
  enabled = true,
  intervalMs = 10_000,
}) => {
  const storeKey = useMemo(() => buildMarketFlowStoreKey(symbols), [symbols]);
  const snapshot = useLiveMarketFlow(symbols, {
    enabled,
    intervalMs,
  });

  useEffect(() => {
    publishMarketFlowSnapshot(storeKey, snapshot);
  }, [storeKey, snapshot]);

  useEffect(() => () => {
    clearMarketFlowSnapshot(storeKey);
  }, [storeKey]);

  return null;
});

const BroadFlowScannerRuntime = memo(({
  symbols = [],
  enabled = true,
}) => {
  const flowScannerControl = useFlowScannerControlState();
  const scannerEnabled = Boolean(flowScannerControl.enabled);
  const runtimeActive = Boolean(enabled && scannerEnabled);
  const snapshot = useLiveMarketFlow(symbols, {
    enabled: runtimeActive,
    scannerConfig: flowScannerControl.config,
  });

  useEffect(() => {
    setFlowScannerControlState(
      { ownerActive: runtimeActive },
      { persistConfig: false },
    );
    return () => {
      setFlowScannerControlState(
        { ownerActive: false },
        { persistConfig: false },
      );
    };
  }, [runtimeActive]);

  useEffect(
    () => () => {
      clearMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY);
    },
    [],
  );

  useEffect(() => {
    if (!scannerEnabled) {
      clearMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY);
      return undefined;
    }
    publishMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY, snapshot);
    return undefined;
  }, [scannerEnabled, snapshot]);

  return null;
});

const HeaderBroadcastSegment = ({
  item,
  duplicate = false,
  tone = T.textSec,
  accent = T.borderLight,
  children,
  onClick,
  title,
}) => {
  const interactive = !duplicate && typeof onClick === "function";
  const Component = interactive ? "button" : "div";

  return (
    <Component
      type={interactive ? "button" : undefined}
      aria-hidden={duplicate || undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick(item) : undefined}
      title={interactive ? title : undefined}
      className={interactive ? "ra-interactive" : undefined}
      style={{
        ...motionVars({ accent: tone }),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(6),
        height: dim(22),
        maxWidth: dim(360),
        padding: sp("0px 8px"),
        border: `1px solid ${accent}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: dim(3),
        background: `${tone}10`,
        color: T.textSec,
        fontFamily: T.sans,
        fontSize: fs(10),
        fontWeight: 700,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: interactive ? "pointer" : "default",
      }}
    >
      {children}
    </Component>
  );
};

const HeaderSignalTapeItem = ({ item, duplicate = false, onClick }) => {
  const isSell = item.direction === "sell";
  const tone = isSell ? T.red : T.green;
  const priceLabel =
    item.price != null && Number.isFinite(Number(item.price))
      ? formatQuotePrice(Number(item.price))
      : null;
  const title = `${item.symbol} ${item.directionLabel} ${item.timeframe || ""}`.trim();

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={item.fresh ? tone : T.border}
      onClick={(selected) => onClick?.(selected.symbol, selected.raw)}
      title={title}
    >
      <span style={{ color: tone, fontWeight: 900 }}>{item.directionLabel}</span>
      <span style={{ color: T.text }}>{item.symbol}</span>
      {item.timeframe ? (
        <span style={{ color: T.textDim, fontFamily: T.code }}>
          {item.timeframe}
        </span>
      ) : null}
      {priceLabel ? (
        <span style={{ color: T.textSec, fontFamily: T.code }}>
          {priceLabel}
        </span>
      ) : null}
      <span style={{ color: T.textMuted, fontFamily: T.code }}>
        {formatRelativeTimeShort(item.time)}
      </span>
    </HeaderBroadcastSegment>
  );
};

const HeaderUnusualTapeItem = ({ item, duplicate = false, onClick }) => {
  const isPut =
    item.right === "P" ||
    String(item.sentiment || "").toLowerCase() === "bearish";
  const tone = isPut ? T.red : T.green;
  const contractLabel =
    item.contract ||
    [
      item.strike != null ? String(item.strike) : "",
      item.right,
      formatExpirationLabel(item.expirationDate),
    ]
      .filter((part) => part && part !== MISSING_VALUE)
      .join(" ");
  const scoreLabel = item.score ? `${item.score.toFixed(1)}x` : null;
  const title = `${item.symbol} unusual ${contractLabel}`.trim();

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={T.border}
      onClick={(selected) => onClick?.(selected.raw)}
      title={title}
    >
      <span style={{ color: T.text }}>{item.symbol}</span>
      {contractLabel ? (
        <span style={{ color: tone, fontFamily: T.code }}>{contractLabel}</span>
      ) : null}
      <span style={{ color: T.textSec, fontFamily: T.code }}>
        {fmtCompactCurrency(item.premium)}
      </span>
      {scoreLabel ? (
        <span style={{ color: T.amber, fontFamily: T.code }}>{scoreLabel}</span>
      ) : null}
      <span style={{ color: T.textMuted, fontFamily: T.code }}>
        {formatRelativeTimeShort(item.time)}
      </span>
    </HeaderBroadcastSegment>
  );
};

const HeaderLaneSettingsPopover = ({ children, testId }) => (
  <div
    data-testid={testId}
    className="ra-popover-enter"
    style={{
      position: "absolute",
      top: 0,
      left: `calc(100% + ${dim(4)}px)`,
      zIndex: 80,
      width: dim(238),
      padding: sp(8),
      maxHeight: `calc(100vh - ${dim(18)}px)`,
      overflowY: "auto",
      background: T.bg0,
      border: `1px solid ${T.border}`,
      boxShadow: "0 12px 28px rgba(0,0,0,0.32)",
      color: T.text,
      fontFamily: T.sans,
    }}
  >
    {children}
  </div>
);

const HeaderLaneSettingsTitle = ({ label, status, tone = T.textDim }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      marginBottom: sp(7),
    }}
  >
    <span
      style={{
        color: T.textSec,
        fontFamily: T.code,
        fontSize: fs(9),
        fontWeight: 900,
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontFamily: T.code,
        fontSize: fs(8),
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  </div>
);

const HeaderLaneInfoRow = ({ label, value, tone = T.textSec }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      minHeight: dim(20),
      color: T.textDim,
      fontFamily: T.code,
      fontSize: fs(8),
      fontWeight: 700,
    }}
  >
    <span>{label}</span>
    <span style={{ color: tone, textAlign: "right" }}>{value}</span>
  </div>
);

const HeaderLaneSectionLabel = ({ children }) => (
  <div
    style={{
      marginTop: sp(8),
      marginBottom: sp(5),
      color: T.textMuted,
      fontFamily: T.code,
      fontSize: fs(7),
      fontWeight: 900,
      letterSpacing: "0.08em",
    }}
  >
    {children}
  </div>
);

const HeaderLaneSegmentedControl = ({ value, onChange }) => (
  <div
    role="group"
    aria-label="Header lane speed"
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: sp(4),
      marginBottom: sp(7),
    }}
  >
    {Object.entries(HEADER_BROADCAST_SPEED_PRESETS).map(([preset, config]) => {
      const active = value === preset;
      return (
        <button
          key={preset}
          type="button"
          aria-pressed={active}
          data-testid={`header-lane-speed-${preset}`}
          className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
          onClick={() => onChange(preset)}
          style={{
            ...motionVars({ accent: T.accent }),
            minHeight: dim(24),
            border: `1px solid ${active ? T.accent : T.border}`,
            background: active ? `${T.accent}18` : T.bg1,
            color: active ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.code,
            fontSize: fs(8),
            fontWeight: 900,
          }}
        >
          {config.label}
        </button>
      );
    })}
  </div>
);

const HeaderLaneToggleButton = ({
  active,
  disabled = false,
  onClick,
  children,
  testId,
  tone = T.accent,
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    disabled={disabled}
    className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
    onClick={onClick}
    style={{
      ...motionVars({ accent: tone }),
      width: "100%",
      minHeight: dim(28),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(6),
      border: `1px solid ${active ? tone : T.border}`,
      background: active ? `${tone}18` : T.bg1,
      color: disabled ? T.textMuted : active ? tone : T.textSec,
      cursor: disabled ? "default" : "pointer",
      fontFamily: T.sans,
      fontSize: fs(9),
      fontWeight: 800,
    }}
  >
    <RadioTower size={dim(12)} strokeWidth={2.3} />
    {children}
  </button>
);

const headerLaneControlInputStyle = {
  width: "100%",
  minHeight: dim(23),
  background: T.bg1,
  border: `1px solid ${T.border}`,
  color: T.textSec,
  fontFamily: T.code,
  fontSize: fs(8),
  fontWeight: 800,
  padding: sp("3px 5px"),
  outline: "none",
};

const HeaderLaneControlRow = ({ label, children }) => (
  <label
    style={{
      display: "grid",
      gridTemplateColumns: `${dim(58)} minmax(0, 1fr)`,
      alignItems: "center",
      gap: sp(6),
      minHeight: dim(25),
      color: T.textDim,
      fontFamily: T.code,
      fontSize: fs(8),
      fontWeight: 800,
    }}
  >
    <span>{label}</span>
    {children}
  </label>
);

const HeaderLaneSelectControl = ({ label, value, onChange, options, testId }) => (
  <HeaderLaneControlRow label={label}>
    <select
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </HeaderLaneControlRow>
);

const HeaderLaneTextControl = ({ label, value, onChange, testId, placeholder }) => (
  <HeaderLaneControlRow label={label}>
    <input
      data-testid={testId}
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    />
  </HeaderLaneControlRow>
);

const HeaderLaneNumberControl = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  testId,
  placeholder,
}) => (
  <HeaderLaneControlRow label={label}>
    <input
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    />
  </HeaderLaneControlRow>
);

const HeaderBroadcastLane = ({
  label,
  items,
  emptyLabel,
  testId,
  action,
  children,
  durationSeconds = 34,
  settingsOpen = false,
  onToggleSettings,
  settingsContent,
}) => {
  const shouldScroll = items.length >= 4;
  const renderedItems = shouldScroll ? [...items, ...items] : items;

  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gridTemplateColumns: "72px minmax(0, 1fr) auto",
        alignItems: "center",
        minHeight: dim(25),
        minWidth: 0,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRight: `1px solid ${T.border}`,
        }}
      >
        <button
          type="button"
          data-testid={`${testId}-settings-trigger`}
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
          style={{
            width: "100%",
            height: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: sp("0px 8px"),
            border: "none",
            background: settingsOpen ? T.bg2 : "transparent",
            color: settingsOpen ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.code,
            fontSize: fs(9),
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </button>
        {settingsOpen ? settingsContent : null}
      </div>

      <div
        data-header-broadcast-viewport
        style={{
          minWidth: 0,
          overflowX: shouldScroll ? "hidden" : "auto",
          overflowY: "hidden",
          padding: sp("1px 8px"),
        }}
      >
        {items.length ? (
          <div
            data-header-broadcast-track
            role="list"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(8),
              minWidth: "max-content",
              animation: shouldScroll
                ? `headerBroadcastScroll ${durationSeconds}s linear infinite`
                : "none",
            }}
          >
            {renderedItems.map((item, index) => {
              const duplicate = index >= items.length;
              return (
                <span
                  key={`${item.id}-${index}`}
                  role={duplicate ? "presentation" : "listitem"}
                  className={duplicate ? undefined : "ra-row-enter"}
                  style={{
                    display: "inline-flex",
                    ...(duplicate ? null : motionRowStyle(index, 10, 90)),
                  }}
                >
                  {children(item, duplicate)}
                </span>
              );
            })}
          </div>
        ) : (
          <span
            role="status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: dim(22),
              color: T.textMuted,
              fontFamily: T.code,
              fontSize: fs(10),
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {emptyLabel}
          </span>
        )}
      </div>

      <div
        style={{
          height: "100%",
          minWidth: dim(28),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderLeft: `1px solid ${T.border}`,
        }}
      >
        {action}
      </div>
    </div>
  );
};

const HeaderBroadcastScrollerStack = memo(({
  symbols = [],
  enabled = true,
  onSignalAction,
  onFlowAction,
  signalScanEnabled = false,
  signalScanPending = false,
  signalEvaluationPending = false,
  signalScanErrored = false,
  onToggleSignalScan,
}) => {
  const rootRef = useRef(null);
  const signalSnapshot = useSignalMonitorSnapshot({
    subscribeToUpdates: enabled,
  });
  const sharedFlowSnapshot = useMarketFlowSnapshot(symbols, {
    subscribe: enabled,
  });
  const flowScannerControl = useFlowScannerControlState({
    subscribe: enabled,
  });
  const broadFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    { subscribe: enabled },
  );
  const broadScanEnabled = Boolean(flowScannerControl.enabled);
  const broadScanOwnerActive = Boolean(flowScannerControl.ownerActive);
  const flowScannerConfig = flowScannerControl.config;
  const flowTapeFilters = useFlowTapeFilterState({
    subscribe: enabled,
  });
  const broadScanSnapshotActive = broadScanEnabled && broadScanOwnerActive;
  const [openSettingsLane, setOpenSettingsLane] = useState(null);
  const [speedPreset, setSpeedPreset] = useState(() =>
    resolveHeaderBroadcastSpeedPreset(_initialState.headerBroadcastSpeedPreset),
  );
  const speedDurations = useMemo(
    () => getHeaderBroadcastSpeedDurations(speedPreset),
    [speedPreset],
  );
  const changeSpeedPreset = useCallback((nextPreset) => {
    const resolved = resolveHeaderBroadcastSpeedPreset(nextPreset);
    setSpeedPreset(resolved);
    persistState({ headerBroadcastSpeedPreset: resolved });
  }, []);
  useEffect(() => {
    const listener = (event) => {
      const nextPreset = event?.detail?.headerBroadcastSpeedPreset;
      if (!nextPreset) return;
      setSpeedPreset(resolveHeaderBroadcastSpeedPreset(nextPreset));
    };
    window.addEventListener("rayalgo:workspace-settings-updated", listener);
    return () => {
      window.removeEventListener("rayalgo:workspace-settings-updated", listener);
    };
  }, []);
  const changeFlowScannerConfig = useCallback((patch) => {
    setFlowScannerControlState({
      config: normalizeFlowScannerConfig({
        ...flowScannerConfig,
        ...patch,
      }),
    });
  }, [flowScannerConfig]);
  const changeFlowTapeFilters = useCallback((patch) => {
    setFlowTapeFilterState({
      ...patch,
      activeFlowPresetId: null,
    });
  }, []);
  const changeFlowTapePreset = useCallback((presetId) => {
    setFlowTapeFilterState(buildFlowTapePresetPatch(presetId, flowTapeFilters));
  }, [flowTapeFilters]);
  const toggleBroadScan = useCallback(() => {
    setFlowScannerControlState({ enabled: !broadScanEnabled });
  }, [broadScanEnabled]);
  useEffect(() => {
    if (!openSettingsLane || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpenSettingsLane(null);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenSettingsLane(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSettingsLane]);
  const signalItems = useMemo(
    () => buildHeaderSignalTapeItems(signalSnapshot),
    [signalSnapshot],
  );
  const unusualEvents = useMemo(
    () =>
      broadScanSnapshotActive
        ? [
            ...(broadFlowSnapshot.flowEvents || []),
            ...(sharedFlowSnapshot.flowEvents || []),
          ]
        : sharedFlowSnapshot.flowEvents || [],
    [
      broadFlowSnapshot.flowEvents,
      broadScanSnapshotActive,
      sharedFlowSnapshot.flowEvents,
    ],
  );
  const unusualItems = useMemo(
    () => buildHeaderUnusualTapeItems(unusualEvents),
    [unusualEvents],
  );

  const signalBusy = Boolean(
    signalScanPending || signalEvaluationPending || signalSnapshot?.pending,
  );
  const signalHasError = Boolean(!signalBusy && signalScanErrored);
  const signalEmptyLabel = signalHasError
    ? "SIGNALS ERROR"
    : signalBusy
      ? "SYNCING"
      : signalScanEnabled
        ? "NO SIGNALS"
        : "SIGNALS OFF";
  const flowStatus = broadScanSnapshotActive
    ? broadFlowSnapshot.flowStatus
    : sharedFlowSnapshot.flowStatus;
  const flowProviderSummary = broadScanSnapshotActive
    ? broadFlowSnapshot.providerSummary
    : sharedFlowSnapshot.providerSummary;
  const flowHasError =
    flowStatus === "offline" ||
    Boolean(flowProviderSummary?.erroredSource) ||
    Boolean(flowProviderSummary?.failures?.length);
  const flowScanHasError = Boolean(broadScanSnapshotActive && flowHasError);
  const flowScanBusy = Boolean(
    broadScanSnapshotActive &&
      !flowScanHasError &&
      (flowStatus === "loading" || flowProviderSummary?.coverage?.isFetching),
  );
  const unusualEmptyLabel =
    flowStatus === "loading"
      ? "SYNCING"
      : flowHasError
        ? "FLOW OFFLINE"
        : unusualEvents.length
          ? "NO UNUSUAL FLOW"
          : "NO FLOW";

  const flowScanTone = flowScanHasError
    ? T.red
    : flowScanBusy
      ? T.amber
      : broadScanSnapshotActive
        ? T.green
        : broadScanEnabled
          ? T.textMuted
          : T.textMuted;
  const flowScanStatusLabel = flowScanHasError
    ? "SCAN ERROR"
    : flowScanBusy
      ? "SCANNING"
      : broadScanSnapshotActive
        ? "SCAN ON"
        : broadScanEnabled
          ? "SCAN IDLE"
        : "SCAN OFF";
  const broadToggleTitle = flowScanHasError
    ? "Flow scan degraded"
    : flowScanBusy
      ? "Flow scan updating"
      : broadScanSnapshotActive
        ? "Flow scan active"
        : broadScanEnabled
          ? "Open Flow page to run scan"
        : "Start Flow scan";
  const signalScanTone = signalHasError
    ? T.red
    : signalBusy
      ? T.amber
      : signalScanEnabled
        ? T.green
        : T.textMuted;
  const signalToggleTitle = signalHasError
    ? "Signal scan degraded"
    : signalBusy
      ? "Signal scan updating"
      : signalScanEnabled
        ? "Signal scan active"
        : "Start signal scan";
  const signalStatusLabel = signalHasError
    ? "SCAN ERROR"
    : signalScanPending
      ? "UPDATING"
      : signalEvaluationPending || signalSnapshot?.pending
        ? "SCANNING"
        : signalScanEnabled
          ? "SCAN ON"
          : "SCAN OFF";
  const signalLastEvaluatedAt =
    signalSnapshot?.profile?.lastEvaluatedAt ||
    signalSnapshot?.states?.find?.((state) => state?.lastEvaluatedAt)
      ?.lastEvaluatedAt ||
    null;
  const signalSettings = (
    <HeaderLaneSettingsPopover testId="header-signal-settings-popover">
      <HeaderLaneSettingsTitle
        label="SIGNALS"
        status={signalStatusLabel}
        tone={signalScanTone}
      />
      <HeaderLaneInfoRow
        label="Speed"
        value={HEADER_BROADCAST_SPEED_PRESETS[speedPreset].label}
        tone={T.textSec}
      />
      <HeaderLaneSegmentedControl
        value={speedPreset}
        onChange={changeSpeedPreset}
      />
      <HeaderLaneToggleButton
        active={signalScanEnabled}
        disabled={signalBusy || !onToggleSignalScan}
        onClick={onToggleSignalScan}
        testId="header-signal-scan-settings-toggle"
        tone={signalScanTone}
      >
        {signalScanEnabled ? "Signal Scan On" : "Signal Scan Off"}
      </HeaderLaneToggleButton>
      <div style={{ height: dim(7) }} />
      <HeaderLaneInfoRow label="Visible" value={signalItems.length} />
      <HeaderLaneInfoRow
        label="State"
        value={
          signalHasError
            ? "Error"
            : signalBusy
              ? "Evaluating"
              : signalScanEnabled
                ? "Watching"
                : "Off"
        }
        tone={signalScanTone}
      />
      <HeaderLaneInfoRow
        label="Last"
        value={
          signalLastEvaluatedAt
            ? formatRelativeTimeShort(signalLastEvaluatedAt)
            : MISSING_VALUE
        }
      />
    </HeaderLaneSettingsPopover>
  );
  const unusualCoverage = flowProviderSummary?.coverage || null;
  const unusualSettings = (
    <HeaderLaneSettingsPopover testId="header-unusual-settings-popover">
      <HeaderLaneSettingsTitle
        label="FLOW"
        status={flowScanStatusLabel}
        tone={flowScanTone}
      />
      <HeaderLaneInfoRow
        label="Speed"
        value={HEADER_BROADCAST_SPEED_PRESETS[speedPreset].label}
        tone={T.textSec}
      />
      <HeaderLaneSegmentedControl
        value={speedPreset}
        onChange={changeSpeedPreset}
      />
      <HeaderLaneToggleButton
        active={broadScanEnabled}
        onClick={toggleBroadScan}
        testId="header-unusual-settings-broad-toggle"
        tone={flowScanTone}
      >
        {broadScanSnapshotActive
          ? "Flow Scan On"
          : broadScanEnabled
            ? "Flow Scan Idle"
            : "Flow Scan Off"}
      </HeaderLaneToggleButton>
      <HeaderLaneSectionLabel>TAPE FILTERS</HeaderLaneSectionLabel>
      <HeaderLaneTextControl
        label="Include"
        value={flowTapeFilters.includeQuery}
        onChange={(value) => changeFlowTapeFilters({ includeQuery: value })}
        testId="header-flow-filter-include"
        placeholder="SPY, QQQ"
      />
      <HeaderLaneTextControl
        label="Exclude"
        value={flowTapeFilters.excludeQuery}
        onChange={(value) => changeFlowTapeFilters({ excludeQuery: value })}
        testId="header-flow-filter-exclude"
        placeholder="AAPL, TSLA"
      />
      <HeaderLaneSelectControl
        label="Flow"
        value={flowTapeFilters.filter}
        onChange={(value) => changeFlowTapeFilters({ filter: value })}
        testId="header-flow-filter-type"
        options={FLOW_TAPE_FILTER_OPTIONS.map((option) => ({
          value: option.id,
          label: option.label,
        }))}
      />
      <HeaderLaneSelectControl
        label="Min Prem"
        value={String(flowTapeFilters.minPrem)}
        onChange={(value) => changeFlowTapeFilters({ minPrem: Number(value) })}
        testId="header-flow-filter-min-premium"
        options={FLOW_MIN_PREMIUM_OPTIONS.map((option) => ({
          value: String(option.value),
          label: option.label,
        }))}
      />
      <HeaderLaneSelectControl
        label="Preset"
        value={flowTapeFilters.activeFlowPresetId || ""}
        onChange={changeFlowTapePreset}
        testId="header-flow-filter-preset"
        options={[
          { value: "", label: "None" },
          ...FLOW_BUILT_IN_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
          })),
        ]}
      />
      <HeaderLaneSectionLabel>SCANNER</HeaderLaneSectionLabel>
      <HeaderLaneSelectControl
        label="Mode"
        value={flowScannerConfig.mode}
        onChange={(value) => changeFlowScannerConfig({ mode: value })}
        testId="header-flow-scan-mode"
        options={[
          { value: FLOW_SCANNER_MODE.market, label: "Market" },
          { value: FLOW_SCANNER_MODE.watchlist, label: "Watchlist" },
        ]}
      />
      <HeaderLaneSelectControl
        label="Scope"
        value={flowScannerConfig.scope}
        onChange={(value) => changeFlowScannerConfig({ scope: value })}
        testId="header-flow-scan-scope"
        options={[
          { value: FLOW_SCANNER_SCOPE.unusual, label: "Unusual" },
          { value: FLOW_SCANNER_SCOPE.all, label: "All Flow" },
        ]}
      />
      <HeaderLaneNumberControl
        label="Symbols"
        value={flowScannerConfig.maxSymbols}
        min={FLOW_SCANNER_CONFIG_LIMITS.maxSymbols.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.maxSymbols.max}
        onChange={(value) => changeFlowScannerConfig({ maxSymbols: value })}
        testId="header-flow-scan-max-symbols"
      />
      <HeaderLaneNumberControl
        label="Batch"
        value={flowScannerConfig.batchSize}
        min={FLOW_SCANNER_CONFIG_LIMITS.batchSize.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.batchSize.max}
        onChange={(value) => changeFlowScannerConfig({ batchSize: value })}
        testId="header-flow-scan-batch-size"
      />
      <HeaderLaneNumberControl
        label="Conc"
        value={flowScannerConfig.concurrency}
        min={FLOW_SCANNER_CONFIG_LIMITS.concurrency.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.concurrency.max}
        onChange={(value) => changeFlowScannerConfig({ concurrency: value })}
        testId="header-flow-scan-concurrency"
      />
      <HeaderLaneNumberControl
        label="Vol/OI"
        value={flowScannerConfig.unusualThreshold}
        min={FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold.max}
        step={0.1}
        onChange={(value) =>
          changeFlowScannerConfig({ unusualThreshold: value })
        }
        testId="header-flow-scan-unusual-threshold"
      />
      <HeaderLaneNumberControl
        label="Min $"
        value={flowScannerConfig.minPremium}
        min={FLOW_SCANNER_CONFIG_LIMITS.minPremium.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.minPremium.max}
        step={5_000}
        onChange={(value) => changeFlowScannerConfig({ minPremium: value })}
        testId="header-flow-scan-min-premium"
      />
      <HeaderLaneNumberControl
        label="Max DTE"
        value={flowScannerConfig.maxDte}
        min={FLOW_SCANNER_CONFIG_LIMITS.maxDte.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.maxDte.max}
        onChange={(value) =>
          changeFlowScannerConfig({ maxDte: value === "" ? null : value })
        }
        testId="header-flow-scan-max-dte"
        placeholder="Any"
      />
      <div style={{ height: dim(7) }} />
      <HeaderLaneInfoRow label="Visible" value={unusualItems.length} />
      <HeaderLaneInfoRow
        label="Batch"
        value={`${flowScannerConfig.batchSize}/${flowScannerConfig.concurrency}`}
      />
      <HeaderLaneInfoRow
        label="Flow"
        value={flowStatus.toUpperCase()}
        tone={flowHasError ? T.red : flowStatus === "loading" ? T.amber : T.textSec}
      />
      <HeaderLaneInfoRow
        label="Scanned"
        value={
          unusualCoverage
            ? `${unusualCoverage.scannedSymbols}/${unusualCoverage.totalSymbols}`
            : MISSING_VALUE
        }
      />
    </HeaderLaneSettingsPopover>
  );

  return (
    <div
      ref={rootRef}
      data-testid="header-broadcast-scrollers"
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateRows: "auto auto",
        minWidth: 0,
        background: T.bg0,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <HeaderBroadcastLane
        label="SIGNALS"
        items={signalItems}
        emptyLabel={signalEmptyLabel}
        testId="header-signal-tape"
        durationSeconds={speedDurations.signalDurationSeconds}
        settingsOpen={openSettingsLane === "signals"}
        onToggleSettings={() =>
          setOpenSettingsLane((lane) => (lane === "signals" ? null : "signals"))
        }
        settingsContent={signalSettings}
        action={
          <button
            type="button"
            data-testid="header-signal-scan-toggle"
            aria-label={signalToggleTitle}
            aria-pressed={signalScanEnabled}
            title={signalToggleTitle}
            disabled={signalBusy || !onToggleSignalScan}
            onClick={onToggleSignalScan}
            style={{
              width: dim(24),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: dim(3),
              background: signalScanEnabled ? `${signalScanTone}18` : "transparent",
              color: signalScanTone,
              cursor: signalBusy ? "wait" : onToggleSignalScan ? "pointer" : "default",
            }}
          >
            <RadioTower size={14} strokeWidth={2.4} />
          </button>
        }
      >
        {(item, duplicate) => (
          <HeaderSignalTapeItem
            item={item}
            duplicate={duplicate}
            onClick={onSignalAction}
          />
        )}
      </HeaderBroadcastLane>

      <HeaderBroadcastLane
        label="FLOW"
        items={unusualItems}
        emptyLabel={unusualEmptyLabel}
        testId="header-unusual-tape"
        durationSeconds={speedDurations.unusualDurationSeconds}
        settingsOpen={openSettingsLane === "unusual"}
        onToggleSettings={() =>
          setOpenSettingsLane((lane) => (lane === "unusual" ? null : "unusual"))
        }
        settingsContent={unusualSettings}
        action={
          <button
            type="button"
            data-testid="header-unusual-broad-toggle"
            aria-label={broadToggleTitle}
            aria-pressed={broadScanEnabled}
            title={broadToggleTitle}
            onClick={toggleBroadScan}
            style={{
              width: dim(24),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: dim(3),
              background: broadScanEnabled ? `${flowScanTone}18` : "transparent",
              color: flowScanTone,
              cursor: "pointer",
            }}
          >
            <RadioTower size={14} strokeWidth={2.4} />
          </button>
        }
      >
        {(item, duplicate) => (
          <HeaderUnusualTapeItem
            item={item}
            duplicate={duplicate}
            onClick={onFlowAction}
          />
        )}
      </HeaderBroadcastLane>
    </div>
  );
});

export const Badge = ({ children, color = T.textDim }) => (
  <span
    style={{
      display: "inline-block",
      padding: sp("1px 6px"),
      borderRadius: dim(3),
      fontSize: fs(9),
      fontWeight: 700,
      fontFamily: T.mono,
      letterSpacing: "0.04em",
      background: `${color}18`,
      color,
      border: `1px solid ${color}30`,
    }}
  >
    {children}
  </span>
);

export const LoadingSpinner = ({ size = 18, color = T.accent }) => (
  <span
    data-testid="loading-spinner"
    role="status"
    aria-label="Loading"
    style={{
      width: dim(size),
      height: dim(size),
      borderRadius: "50%",
      border: `2px solid ${T.border}`,
      borderTopColor: color,
      animation: "premiumFlowSpin 820ms linear infinite",
      flexShrink: 0,
    }}
  />
);

export const DataUnavailableState = ({
  title = "No live data",
  detail = "This panel is waiting on a live provider response.",
  loading = false,
  tone,
}) => (
  <div
    className="ra-panel-enter"
    style={{
      width: "100%",
      height: "100%",
      minHeight: dim(96),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: sp(12),
      textAlign: "center",
      background: T.bg0,
      border: `1px dashed ${T.border}`,
      borderRadius: dim(4),
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <div style={{ maxWidth: dim(260) }}>
      {loading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: sp(8),
          }}
        >
          <LoadingSpinner color={tone || T.accent} />
        </div>
      ) : null}
      <div
        style={{
          fontSize: fs(10),
          fontWeight: 700,
          color: tone || T.textSec,
	                letterSpacing: "0.04em",
              }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: sp(4),
          fontSize: fs(9),
          lineHeight: 1.45,
          fontFamily: T.mono,
        }}
      >
        {detail}
      </div>
    </div>
  </div>
);

const extractSparklineValues = (data = []) =>
  (Array.isArray(data) ? data : [])
    .map((point) => {
      if (typeof point === "number" && Number.isFinite(point)) {
        return point;
      }
      if (typeof point?.close === "number" && Number.isFinite(point.close)) {
        return point.close;
      }
      if (typeof point?.c === "number" && Number.isFinite(point.c)) {
        return point.c;
      }
      if (typeof point?.v === "number" && Number.isFinite(point.v)) {
        return point.v;
      }
      return null;
    })
    .filter((value) => Number.isFinite(value));

const MicroSparkline = ({
  data = [],
  positive = null,
  width = 64,
  height = 24,
}) => {
  const values = useMemo(() => extractSparklineValues(data), [data]);

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const inferredPositive = values[values.length - 1] >= values[0];
  const resolvedPositive =
    typeof positive === "boolean" ? positive : inferredPositive;
  const lineColor = resolvedPositive ? T.green : T.red;
  const plottedPoints = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
      return [x.toFixed(2), y.toFixed(2)];
    });
  const points = plottedPoints.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath = `M ${plottedPoints
    .map(([x, y], index) => `${index === 0 ? "" : "L "}${x},${y}`)
    .join(" ")} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path d={areaPath} fill={`${lineColor}1f`} />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const HeaderKpiStripItem = memo(({ symbol, label, index, onSelect }) => {
  const fallback = useMemo(
    () => buildFallbackWatchlistItem(symbol, index, label),
    [index, label, symbol],
  );
  const snapshot = useRuntimeTickerSnapshot(symbol, fallback);
  const positive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(symbol)}
      title={`${label} proxy · ${symbol}`}
      style={{
        flex: "1 1 68px",
        minWidth: dim(64),
        minHeight: dim(32),
        padding: sp("3px 6px"),
        display: "flex",
        alignItems: "center",
        gap: sp(5),
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: 0,
        color: T.text,
        cursor: "pointer",
        transition: "background 0.12s ease, color 0.12s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${T.bg3}80`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          minWidth: 0,
          flex: 1,
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: fs(7),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </span>
          <span
            style={{
              display: "block",
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textMuted,
              fontFamily: T.sans,
              lineHeight: 1.1,
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            {symbol}
          </span>
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.sans,
              color: T.text,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {formatQuotePrice(snapshot?.price)}
          </span>
          <span
            style={{
              display: "block",
              fontSize: fs(8),
              fontWeight: 700,
              fontFamily: T.sans,
              color:
                positive == null ? T.textDim : positive ? T.green : T.red,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {formatSignedPercent(snapshot?.pct)}
          </span>
        </span>
      </span>
      <span style={{ display: "block", flexShrink: 0 }}>
        <MicroSparkline
          data={
            snapshot?.sparkBars?.length
              ? snapshot.sparkBars
              : snapshot?.spark || fallback.spark
          }
          positive={positive}
          width={34}
          height={13}
        />
      </span>
    </button>
  );
});

const HeaderKpiStrip = ({ onSelect }) => (
  <div
    data-testid="platform-header-kpis"
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: sp(3),
      minWidth: 0,
      width: "100%",
      overflow: "hidden",
    }}
  >
    {HEADER_KPI_CONFIG.map(({ symbol, label }, index) => (
      <HeaderKpiStripItem
        key={symbol}
        symbol={symbol}
        label={label}
        index={index}
        onSelect={onSelect}
      />
    ))}
  </div>
);

const resolveHeaderIbkrPingMs = (connection, latencyStats) => {
  const candidates = [
    connection?.lastPingMs,
    latencyStats?.bridgeToApiMs?.p95,
    latencyStats?.totalMs?.p95,
    latencyStats?.apiToReactMs?.p95,
  ];
  return candidates.find((value) => Number.isFinite(value)) ?? null;
};

const HeaderIbkrStatusChip = ({
  label,
  connection,
  tone,
  latencyStats,
}) => {
  const Icon = tone.Icon;
  const health = resolveIbkrGatewayHealth({ connection });
  const badges = getIbkrGatewayBadges({ connection, latencyStats, health });
  const pulse = Boolean(tone.pulse);
  const pingMs = resolveHeaderIbkrPingMs(connection, latencyStats);

  return (
    <span
      data-ibkr-state-pulse={pulse ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        minWidth: 0,
        color: tone.color,
        animation: pulse ? "ibkrStatusPulse 1.8s ease-in-out infinite" : "none",
      }}
    >
      <Icon size={dim(11)} strokeWidth={2.3} color={tone.color} />
      <span
        style={{
          fontSize: fs(7),
          fontWeight: 800,
          fontFamily: T.sans,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {badges.map((badge) => (
        <span
          key={badge.label}
          style={{
            border: `1px solid ${badge.color}66`,
            background: badge.background,
            color: badge.color,
            fontSize: fs(7),
            fontWeight: 900,
            fontFamily: T.mono,
            lineHeight: 1,
            padding: sp("2px 4px"),
            whiteSpace: "nowrap",
          }}
        >
          {badge.label}
        </span>
      ))}
      <IbkrPingWavelength connection={connection} tone={tone} />
      <span
        style={{
          color: T.textDim,
          fontSize: fs(7),
          fontWeight: 800,
          fontFamily: T.mono,
          minWidth: dim(30),
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {formatIbkrPingMs(pingMs)}
      </span>
    </span>
  );
};

const HeaderIbkrDetailRow = ({
  label,
  value,
  tone = T.textSec,
  wrap = false,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(72px, 0.78fr) minmax(0, 1.22fr)",
      gap: sp(8),
      alignItems: "baseline",
      minWidth: 0,
      padding: sp("2px 0"),
      borderBottom: `1px solid ${T.border}55`,
      fontFamily: T.mono,
      fontSize: fs(8),
    }}
  >
    <span style={{ color: T.textDim, whiteSpace: "nowrap" }}>{label}</span>
    <span
      style={{
        color: tone,
        fontWeight: 800,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: wrap ? "clip" : "ellipsis",
        whiteSpace: wrap ? "normal" : "nowrap",
        wordBreak: wrap ? "break-word" : "normal",
        textAlign: "right",
      }}
    >
      {value ?? MISSING_VALUE}
    </span>
  </div>
);

const HEADER_IBKR_ICON_COMPONENTS = {
  activity: Activity,
  alert: AlertTriangle,
  gauge: Gauge,
  radioTower: RadioTower,
  shieldCheck: ShieldCheck,
};

const getHeaderIbkrIcon = (iconKey) =>
  HEADER_IBKR_ICON_COMPONENTS[iconKey] || Activity;

const HeaderIbkrMetricTile = ({ tile }) => {
  const Icon = getHeaderIbkrIcon(tile.iconKey);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("6px 7px"),
        background: T.bg1,
        border: `1px solid ${T.border}`,
      }}
    >
      <Icon size={dim(13)} strokeWidth={2.2} color={tile.tone} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.textDim,
            fontFamily: T.mono,
            fontSize: fs(7),
            fontWeight: 900,
            letterSpacing: "0.04em",
            lineHeight: 1.1,
            textTransform: "uppercase",
          }}
        >
          {tile.label}
        </div>
        <div
          style={{
            color: tile.tone,
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: 900,
            lineHeight: 1.15,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tile.value ?? MISSING_VALUE}
        </div>
        {tile.detail ? (
          <div
            style={{
              color: T.textDim,
              fontFamily: T.mono,
              fontSize: fs(7),
              lineHeight: 1.1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tile.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const HeaderIbkrConnectionSummary = ({ model }) => {
  const IssueIcon = getHeaderIbkrIcon(model.issue.iconKey);

  return (
    <div
      style={{
        display: "grid",
        gap: sp(8),
        marginBottom: sp(8),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            minWidth: 0,
            color: model.health.color,
            fontFamily: T.mono,
            fontSize: fs(10),
            fontWeight: 900,
          }}
        >
          <span
            style={{
              width: dim(8),
              height: dim(8),
              background: model.health.color,
              boxShadow: `0 0 10px ${model.health.color}66`,
            }}
          />
          <span>{model.health.label}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {model.badges.map((badge) => (
            <span
              key={badge.label}
              style={{
                border: `1px solid ${badge.color}66`,
                background: badge.background,
                color: badge.color,
                fontFamily: T.mono,
                fontSize: fs(7),
                fontWeight: 900,
                padding: sp("2px 4px"),
                whiteSpace: "nowrap",
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: sp(6),
          alignItems: "start",
          padding: sp("6px 7px"),
          background: T.bg1,
          border: `1px solid ${model.issue.tone}55`,
          color: model.issue.tone,
          fontFamily: T.mono,
          fontSize: fs(8),
          lineHeight: 1.3,
        }}
      >
        <IssueIcon size={dim(12)} strokeWidth={2.2} color={model.issue.tone} />
        <span
          style={{
            minWidth: 0,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
          }}
        >
          {model.issue.label}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        {model.tiles.map((tile) => (
          <HeaderIbkrMetricTile key={tile.label} tile={tile} />
        ))}
      </div>
    </div>
  );
};

const HeaderIbkrAdvancedDetails = ({ model }) => {
  const [open, setOpen] = useState(() => Boolean(model.autoOpenDetails));
  const openSourceRef = useRef(model.autoOpenDetails ? "auto" : "default");
  const lastIssueKeyRef = useRef(model.issue.key);

  useEffect(() => {
    const issueChanged = model.issue.key !== lastIssueKeyRef.current;
    if (issueChanged) {
      lastIssueKeyRef.current = model.issue.key;
    }

    if (model.autoOpenDetails) {
      if (issueChanged || openSourceRef.current !== "user") {
        openSourceRef.current = "auto";
        setOpen(true);
      }
      return;
    }

    if (issueChanged && openSourceRef.current === "auto") {
      openSourceRef.current = "default";
      setOpen(false);
    }
  }, [model.autoOpenDetails, model.issue.key]);

  const handleDetailsToggle = useCallback(() => {
    openSourceRef.current = "user";
    setOpen((current) => !current);
  }, []);

  return (
    <div style={{ marginTop: sp(7), display: "grid", gap: sp(6) }}>
      <button
        type="button"
        onClick={handleDetailsToggle}
        style={{
          minHeight: dim(26),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("4px 7px"),
          border: `1px solid ${T.border}`,
          background: T.bg1,
          color: T.textDim,
          cursor: "pointer",
          fontFamily: T.mono,
          fontSize: fs(8),
          fontWeight: 900,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span>Details</span>
        <ChevronDown
          size={dim(12)}
          strokeWidth={2.2}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.12s ease",
          }}
        />
      </button>

      {open ? (
        <div
          style={{
            display: "grid",
            gap: sp(8),
            padding: sp("7px 8px"),
            background: T.bg1,
            border: `1px solid ${T.border}`,
          }}
        >
          {model.detailGroups.map((group) => (
            <div key={group.title} style={{ display: "grid", gap: sp(2) }}>
              <div
                style={{
                  color: T.textMuted,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 900,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {group.title}
              </div>
              {group.rows.map((row) => (
                <HeaderIbkrDetailRow
                  key={`${group.title}:${row.label}`}
                  label={row.label}
                  value={row.value}
                  tone={row.tone}
                  wrap={row.wrap}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const HeaderStatusCluster = ({
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
}) => {
  const queryClient = useQueryClient();
  const { preferences } = useUserPreferences();
  const [marketClockNow, setMarketClockNow] = useState(() => Date.now());
  const [bridgePopoverOpen, setBridgePopoverOpen] = useState(false);
  const [bridgeLaunchUrl, setBridgeLaunchUrl] = useState(() =>
    readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchUrl),
  );
  const [bridgeLaunchInFlightUntil, setBridgeLaunchInFlightUntil] = useState(
    () =>
      Number(
        readIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil,
        ) || 0,
      ) || 0,
  );
  const [bridgeManagementToken, setBridgeManagementToken] =
    useState(() =>
      readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken),
    );
  const [bridgeLauncherBusy, setBridgeLauncherBusy] = useState(false);
  const [bridgeLauncherError, setBridgeLauncherError] = useState(null);
  useEffect(() => {
    const timer = window.setInterval(() => setMarketClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const marketClock = useMemo(
    () => buildMarketClockState(marketClockNow, preferences),
    [marketClockNow, preferences],
  );
  const gatewayConnection = getIbkrConnection(session, "tws");
  const gatewayTone = getIbkrConnectionTone(gatewayConnection);
  const gatewayLatencyStats = useIbkrLatencyStats();
  const gatewayRuntimeDiagnosticsQuery = useQuery({
    queryKey: ["platform-runtime-diagnostics", "ibkr-popover"],
    queryFn: () =>
      platformJsonRequest("/api/diagnostics/runtime", { timeoutMs: 0 }),
    enabled: bridgePopoverOpen,
    refetchInterval: bridgePopoverOpen ? 5_000 : false,
    placeholderData: (previousData) => previousData,
    retry: false,
    staleTime: 2_000,
  });
  const gatewayRuntimeError =
    gatewayRuntimeDiagnosticsQuery.error instanceof Error
      ? gatewayRuntimeDiagnosticsQuery.error.message
      : gatewayRuntimeDiagnosticsQuery.error
        ? String(gatewayRuntimeDiagnosticsQuery.error)
        : null;
  const gatewayPopoverModel = useMemo(
    () =>
      buildHeaderIbkrPopoverModel({
        connection: gatewayConnection,
        latencyStats: gatewayLatencyStats,
        runtimeDiagnostics: gatewayRuntimeDiagnosticsQuery.data,
        runtimeError: gatewayRuntimeError,
      }),
    [
      gatewayConnection,
      gatewayLatencyStats,
      gatewayRuntimeDiagnosticsQuery.data,
      gatewayRuntimeError,
    ],
  );
  const canDeactivate = Boolean(
    bridgeManagementToken &&
      gatewayConnection?.authenticated &&
      gatewayConnection?.reachable !== false,
  );
  const gatewayConnectedForBridge = Boolean(
    gatewayConnection?.authenticated &&
      gatewayConnection?.reachable !== false &&
      gatewayConnection?.competing !== true &&
      gatewayConnection?.healthFresh !== false &&
      gatewayConnection?.accountsLoaded !== false,
  );
  const bridgeLaunchInFlight = Boolean(
    !gatewayConnectedForBridge && bridgeLaunchInFlightUntil > marketClockNow,
  );
  const gatewayReconnectNeeded = Boolean(
    session?.configured?.ibkr && !gatewayConnectedForBridge,
  );
  const bridgeLauncherMessage =
    bridgeLauncherError ||
    (bridgeLaunchInFlight
      ? "IB Gateway activation is running from the Windows helper. Wait for the bridge to attach before launching again."
      : null) ||
    (bridgeLaunchUrl && !gatewayConnectedForBridge
      ? "Chrome should ask to open PowerShell for the RayAlgo IBKR bridge."
      : null) ||
    bridgeRuntimeMessage(session);
  const bridgeActionLabel =
    bridgeLauncherBusy
      ? "Preparing"
      : bridgeLaunchInFlight
        ? "Launching"
      : gatewayConnectedForBridge
          ? "Connected"
          : gatewayReconnectNeeded
            ? "Reconnect"
            : "Launch";
  const bridgeActionColor = gatewayConnectedForBridge
    ? T.green
    : gatewayReconnectNeeded
      ? T.amber
      : T.accent;
  const bridgeActionDisabled = Boolean(
    bridgeLauncherBusy ||
      bridgeLaunchInFlight ||
      gatewayConnectedForBridge,
  );
  const bridgeActionShowsBusyStyle = Boolean(
    bridgeLauncherBusy || bridgeLaunchInFlight,
  );
  const bridgeStatusPulse = Boolean(bridgeTone?.pulse);
  const surfaceStyle = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minHeight: dim(32),
    padding: sp("3px 7px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    transition: "background 0.12s ease, border-color 0.12s ease",
  };
  const microLabelStyle = {
    fontSize: fs(7),
    fontWeight: 800,
    fontFamily: T.sans,
    color: T.textMuted,
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  };

  useEffect(() => {
    if (!gatewayConnectedForBridge || bridgeLaunchInFlightUntil <= 0) {
      return;
    }
    setBridgeLaunchInFlightUntil(0);
    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil);
  }, [bridgeLaunchInFlightUntil, gatewayConnectedForBridge]);

  const handleStartBridgeLauncher = useCallback(async () => {
    const protocolLauncher = openIbkrProtocolLauncher();
    setBridgePopoverOpen(true);
    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);

    try {
      const payload = await platformJsonRequest("/api/ibkr/bridge/launcher", {
        timeoutMs: 0,
      });
      setBridgeManagementToken(payload.managementToken || null);
      setBridgeLaunchUrl(payload.launchUrl || null);
      writeIbkrBridgeSessionValue(
        IBKR_BRIDGE_SESSION_KEYS.managementToken,
        payload.managementToken,
      );
      writeIbkrBridgeSessionValue(
        IBKR_BRIDGE_SESSION_KEYS.launchUrl,
        payload.launchUrl,
      );
      const launched = navigateIbkrProtocolLauncher(
        protocolLauncher,
        payload.launchUrl,
      );
      if (launched) {
        const inFlightUntil = Date.now() + IBKR_BRIDGE_LAUNCH_COOLDOWN_MS;
        setBridgeLaunchInFlightUntil(inFlightUntil);
        writeIbkrBridgeSessionValue(
          IBKR_BRIDGE_SESSION_KEYS.launchInFlightUntil,
          String(inFlightUntil),
        );
      } else {
        setBridgeLauncherError(
          "Could not open the RayAlgo IBKR PowerShell launcher from this browser.",
        );
      }
    } catch (error) {
      closeIbkrProtocolLauncher(protocolLauncher);
      setBridgeLauncherError(
        error instanceof Error ? error.message : "Bridge launcher failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, []);

  const handleDeactivate = useCallback(async () => {
    if (!bridgeManagementToken) {
      setBridgeLauncherError("Launch a fresh bridge session before detaching.");
      return;
    }

    setBridgeLauncherBusy(true);
    setBridgeLauncherError(null);

    try {
      await platformJsonRequest("/api/ibkr/bridge/detach", {
        method: "POST",
        body: {
          managementToken: bridgeManagementToken,
        },
      });
      setBridgeManagementToken(null);
      clearIbkrBridgeSessionValues();
      setBridgeLaunchUrl(null);
      setBridgeLaunchInFlightUntil(0);
      invalidateIbkrRuntimeQueries(queryClient);
    } catch (error) {
      setBridgeLauncherError(
        error instanceof Error ? error.message : "Deactivate failed.",
      );
    } finally {
      setBridgeLauncherBusy(false);
    }
  }, [bridgeManagementToken, queryClient]);

  return (
    <div
      data-testid="platform-header-status"
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
        gap: sp(4),
        flexWrap: "nowrap",
        minWidth: 0,
      }}
    >
      <div style={{ position: "relative", display: "flex" }}>
        <button
          type="button"
          aria-label="Open IB Gateway connection details"
          aria-expanded={bridgePopoverOpen}
          onClick={() => setBridgePopoverOpen((current) => !current)}
          style={{
            ...surfaceStyle,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            minWidth: dim(220),
            gap: sp(5),
            color: T.text,
            appearance: "none",
            font: "inherit",
            cursor: "pointer",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = T.bg3;
            event.currentTarget.style.borderColor = T.textMuted;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = T.bg1;
            event.currentTarget.style.borderColor = T.border;
          }}
        >
          <span style={microLabelStyle}>IBKR</span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(3),
              minWidth: 0,
            }}
          >
            <span
              data-ibkr-state-pulse={bridgeStatusPulse ? "true" : undefined}
              style={{
                ...microLabelStyle,
                color: bridgeTone.color,
                animation: bridgeStatusPulse
                  ? "ibkrStatusPulse 1.8s ease-in-out infinite"
                  : "none",
              }}
            >
              {bridgeTone.label.toUpperCase()}
            </span>
          </span>
          <HeaderIbkrStatusChip
            label="IB Gateway"
            connection={gatewayConnection}
            tone={gatewayTone}
            latencyStats={gatewayLatencyStats}
          />
          <span style={{ ...microLabelStyle, color: T.textDim }}>
            {environment.toUpperCase()} |{" "}
            {(session?.marketDataProviders?.live || MISSING_VALUE).toUpperCase()}
          </span>
          <ChevronDown size={dim(12)} color={T.textMuted} strokeWidth={2.3} />
        </button>

        {bridgePopoverOpen ? (
          <div
            role="dialog"
            aria-label="IB Gateway bridge"
            style={{
              position: "absolute",
              top: `calc(100% + ${dim(6)})`,
              right: 0,
              zIndex: 60,
              width: `min(${dim(360)}px, calc(100vw - ${dim(16)}px))`,
              maxWidth: `calc(100vw - ${dim(16)}px)`,
              maxHeight: `calc(100vh - ${dim(96)}px)`,
              overflowY: "auto",
              boxSizing: "border-box",
              padding: sp(10),
              background: T.bg0,
              border: `1px solid ${T.border}`,
              boxShadow: "0 12px 32px rgba(0,0,0,0.34)",
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                marginBottom: sp(8),
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "baseline",
                  gap: sp(7),
                }}
              >
                <span style={{ ...microLabelStyle, color: T.textSec }}>
                  IB GATEWAY
                </span>
                <span
                  style={{
                    ...microLabelStyle,
                    color: bridgeTone.color,
                  }}
                >
                  {bridgeTone.label.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                title="Close"
                onClick={() => setBridgePopoverOpen(false)}
                style={{
                  width: dim(24),
                  height: dim(24),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1px solid ${T.border}`,
                  background: T.bg1,
                  color: T.textDim,
                  cursor: "pointer",
                }}
              >
                <X size={dim(13)} strokeWidth={2.2} />
              </button>
            </div>

            <div
              style={{
                minHeight: dim(28),
                marginBottom: sp(8),
                padding: sp("6px 8px"),
                background: T.bg1,
                border: `1px solid ${T.border}`,
                color: bridgeLauncherError ? T.red : T.textSec,
                fontSize: fs(9),
                lineHeight: 1.25,
                fontFamily: T.mono,
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              }}
            >
              {bridgeLauncherMessage}
            </div>

            <HeaderIbkrConnectionSummary model={gatewayPopoverModel} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: canDeactivate ? "1fr 1fr" : "1fr",
                gap: sp(6),
              }}
            >
              <button
                type="button"
                onClick={handleStartBridgeLauncher}
                disabled={bridgeActionDisabled}
                aria-disabled={bridgeActionDisabled}
                style={{
                  minHeight: dim(30),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: sp(6),
                  border: `1px solid ${
                    bridgeActionShowsBusyStyle ? T.border : bridgeActionColor
                  }`,
                  background: bridgeActionShowsBusyStyle
                    ? T.bg1
                    : `${bridgeActionColor}18`,
                  color: bridgeActionShowsBusyStyle ? T.textDim : bridgeActionColor,
                  cursor: bridgeActionDisabled ? "default" : "pointer",
                  fontSize: fs(9),
                  fontWeight: 800,
                  fontFamily: T.sans,
                  letterSpacing: "0.04em",
                }}
              >
                {bridgeLauncherBusy ? (
                  <RefreshCw
                    data-ibkr-bridge-spinner
                    size={dim(13)}
                    strokeWidth={2.2}
                    style={{
                      animation: "premiumFlowSpin 820ms linear infinite",
                    }}
                  />
                ) : gatewayConnectedForBridge ? (
                  <CircleCheck size={dim(13)} strokeWidth={2.2} />
                ) : gatewayReconnectNeeded ? (
                  <RefreshCw size={dim(13)} strokeWidth={2.2} />
                ) : (
                  <Power size={dim(13)} strokeWidth={2.2} />
                )}
                {bridgeActionLabel}
              </button>

              {canDeactivate ? (
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={bridgeLauncherBusy}
                  style={{
                    minHeight: dim(30),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: sp(6),
                    border: `1px solid ${T.border}`,
                    background: T.bg1,
                    color: T.textSec,
                    cursor: bridgeLauncherBusy ? "default" : "pointer",
                    fontSize: fs(9),
                    fontWeight: 800,
                    fontFamily: T.sans,
                    letterSpacing: "0.04em",
                  }}
                >
                  <X size={dim(13)} strokeWidth={2.2} />
                  Deactivate
                </button>
              ) : null}
            </div>

            <HeaderIbkrAdvancedDetails model={gatewayPopoverModel} />
          </div>
        ) : null}
      </div>

      <div
        title={`${marketClock.dateLabel} · ${marketClock.label}`}
        style={{
          ...surfaceStyle,
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          minWidth: dim(92),
          gap: 0,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          <span style={microLabelStyle}>MARKET</span>
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.sans,
              color: T.text,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {marketClock.timeLabel}
          </span>
        </div>
        <div
          style={{
            fontSize: fs(8),
            color: marketClock.color,
            fontFamily: T.sans,
            fontWeight: 700,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          {marketClock.label.toUpperCase()} {marketClock.timerLabel}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleTheme}
        title={
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }
        style={{
          width: dim(30),
          minHeight: dim(32),
          padding: 0,
          background: T.bg1,
          border: `1px solid ${T.border}`,
          borderRadius: 0,
          color: T.textSec,
          cursor: "pointer",
          fontSize: fs(12),
          lineHeight: 1,
          fontFamily: T.sans,
          fontWeight: 700,
          transition: "background 0.12s ease, border-color 0.12s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        {theme === "dark" ? "☼" : "☾"}
      </button>
    </div>
  );
};

const MemoHeaderStatusCluster = memo(HeaderStatusCluster);

const HeaderAccountStrip = ({
  accounts = [],
  primaryAccountId,
  primaryAccount,
  onSelectAccount,
  maskValues = false,
}) => {
  const maskAccountValue = (value) =>
    maskValues ? "****" : primaryAccount ? fmtCompactCurrency(value) : MISSING_VALUE;
  const metricItems = [
    {
      label: "Net Liq",
      value: maskAccountValue(primaryAccount?.netLiquidation),
      color: T.text,
    },
    {
      label: "Buying Power",
      value: maskAccountValue(primaryAccount?.buyingPower),
      color: T.green,
    },
    {
      label: "Cash",
      value: maskAccountValue(primaryAccount?.cash),
      color: T.textSec,
    },
  ];
  const labelStyle = {
    fontSize: fs(7),
    color: T.textMuted,
    fontWeight: 800,
    letterSpacing: "0.05em",
    fontFamily: T.sans,
    lineHeight: 1.05,
    whiteSpace: "nowrap",
  };
  const valueStyle = {
    fontSize: fs(9),
    fontFamily: T.sans,
    fontWeight: 800,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };
  const surfaceStyle = {
    minWidth: dim(270),
    minHeight: dim(32),
    padding: sp("3px 7px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    display: "flex",
    alignItems: "center",
    gap: sp(8),
    transition: "background 0.12s ease, border-color 0.12s ease",
  };

  return (
    <div
      data-testid="platform-header-account"
      title="Active broker account and account summary"
      style={{
        ...surfaceStyle,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = T.bg3;
        event.currentTarget.style.borderColor = T.textMuted;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = T.bg1;
        event.currentTarget.style.borderColor = T.border;
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
          flex: "0 1 auto",
        }}
      >
        <span style={labelStyle}>ACCOUNT</span>
        {accounts.length ? (
          <select
            value={primaryAccountId || ""}
            onChange={(event) => onSelectAccount(event.target.value || null)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: T.text,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 800,
              outline: "none",
              padding: 0,
              lineHeight: 1.1,
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.id}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ ...valueStyle, color: T.textDim }}>
            {primaryAccountId || MISSING_VALUE}
          </span>
        )}
      </div>
      {metricItems.map((metric) => (
        <div
          key={metric.label}
          title={metric.label}
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          <span style={labelStyle}>{metric.label}</span>
          <span style={{ ...valueStyle, color: metric.color }}>
            {metric.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const WATCHLIST_SORT_OPTIONS = [
  { id: WATCHLIST_SORT_MODE.MANUAL, label: "Manual" },
  { id: WATCHLIST_SORT_MODE.SIGNAL, label: "Signal" },
  { id: WATCHLIST_SORT_MODE.PERCENT, label: "% Chg" },
  { id: WATCHLIST_SORT_MODE.VOLUME, label: "Volume" },
  { id: WATCHLIST_SORT_MODE.ALPHA, label: "A-Z" },
];

const WATCHLIST_DIRECTION_SORTS = new Set([
  WATCHLIST_SORT_MODE.PERCENT,
  WATCHLIST_SORT_MODE.VOLUME,
  WATCHLIST_SORT_MODE.ALPHA,
]);

const isWatchlistSignalDirection = (value) =>
  value === "buy" || value === "sell";

const WatchlistRow = memo(
  ({
    item,
    itemIndex,
    selected,
    canDrag,
    dragging,
    dragOver,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onSelect,
    onAddSymbol,
    onRemoveSymbol,
    onSignalAction,
    busy = false,
  }) => {
    const fallback = useMemo(
      () =>
        buildFallbackWatchlistItem(item.sym, itemIndex, item.name || item.sym),
      [item.name, item.sym, itemIndex],
    );
    const snapshot = useRuntimeTickerSnapshot(item.sym, fallback);
    const signalState = useSignalMonitorStateForSymbol(item.sym);
    const selectedRow = selected === item.sym;
    const signalDirection = signalState?.currentSignalDirection;
    const hasSignal =
      isWatchlistSignalDirection(signalDirection) &&
      signalState?.status !== "error" &&
      signalState?.status !== "unavailable";
    const signalColor = signalDirection === "buy" ? T.green : T.red;
    const signalFresh = Boolean(signalState?.fresh);
    const pctPositive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;
    const priceValue = isFiniteNumber(snapshot?.price)
      ? snapshot.price
      : signalState?.currentSignalPrice;
    const displayName = item.name || snapshot?.name || fallback.name || item.sym;
    const quoteAge = formatRelativeTimeShort(
      snapshot?.updatedAt ||
        signalState?.latestBarAt ||
        signalState?.lastEvaluatedAt,
    );
    const identityItem = {
      ticker: item.sym,
      name: displayName,
      market: item.market,
      countryCode: item.countryCode,
      exchangeCountryCode: item.exchangeCountryCode,
      sector: item.sector,
      industry: item.industry,
      logoUrl: item.logoUrl,
    };
    const activeActionDisabled = busy || !item.canRemove || !item.id;
    const rowBackground = dragging
      ? `${T.accent}10`
      : dragOver
        ? `${T.accent}18`
        : selectedRow
          ? T.bg3
          : "transparent";

    return (
      <div
        data-testid="watchlist-row"
        data-symbol={item.sym}
        data-source={item.source}
        className={joinMotionClasses(
          "ra-row-enter",
          "ra-interactive",
          selectedRow && "ra-focus-rail",
        )}
        draggable={canDrag}
        aria-grabbed={dragging ? "true" : "false"}
        onDragStart={(event) => {
          if (!canDrag || !item.id) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          onDragStart?.(item.id);
        }}
        onDragOver={(event) => {
          if (!canDrag || !item.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDragOver?.(item.id);
        }}
        onDrop={(event) => {
          if (!canDrag || !item.id) return;
          event.preventDefault();
          onDrop?.(item.id);
        }}
        onDragEnd={onDragEnd}
        onClick={() => onSelect?.(item.sym)}
        style={{
          ...motionRowStyle(itemIndex, 7, 140),
          ...motionVars({
            accent: selectedRow
              ? T.accent
              : hasSignal
                ? signalColor
                : pctPositive == null
                  ? T.accent
                  : pctPositive
                    ? T.green
                    : T.red,
          }),
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 54px",
          gap: sp(6),
          padding: sp("7px 8px"),
          cursor: "pointer",
          alignItems: "center",
          background: rowBackground,
          borderLeft: selectedRow
            ? `2px solid ${T.accent}`
            : dragOver
              ? `2px solid ${T.accent}`
              : "2px solid transparent",
          borderBottom: `1px solid ${T.border}20`,
          opacity: dragging ? 0.55 : 1,
          transition:
            "background 0.1s ease, border-color 0.1s ease, opacity 0.1s ease",
        }}
        onMouseEnter={(event) => {
          if (!selectedRow && !dragOver) event.currentTarget.style.background = T.bg2;
        }}
        onMouseLeave={(event) => {
          if (!selectedRow && !dragOver) event.currentTarget.style.background = "transparent";
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "16px 18px minmax(42px, auto) auto auto minmax(0, 1fr)",
              alignItems: "center",
              gap: sp(4),
              minWidth: 0,
            }}
          >
            <GripVertical
              size={13}
              strokeWidth={2}
              style={{
                color: canDrag ? T.textDim : T.textMuted,
                opacity: canDrag ? 1 : 0.35,
                cursor: canDrag ? "grab" : "default",
              }}
            />
            <MarketIdentityMark item={identityItem} size={16} />
            <span
              style={{
                fontSize: fs(12),
                fontWeight: 800,
                fontFamily: T.mono,
                color: T.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.sym}
            </span>
            {item.monitoredOnly ? (
              <span
                title="Signal-monitor symbol"
                style={{
                  border: `1px solid ${T.border}`,
                  color: T.textDim,
                  fontFamily: T.mono,
                  fontSize: fs(7),
                  fontWeight: 800,
                  lineHeight: 1,
                  padding: sp("2px 3px"),
                }}
              >
                MON
              </span>
            ) : null}
            {hasSignal ? (
              <button
                type="button"
                data-testid="watchlist-signal-pill"
                data-fresh={signalFresh ? "true" : "false"}
                className={signalFresh ? "ra-status-pulse" : "ra-interactive"}
                onClick={(event) => {
                  event.stopPropagation();
                  onSignalAction?.(item.sym, signalState);
                }}
                title={`${signalDirection.toUpperCase()} ${signalFresh ? "fresh" : "stale"} signal - ${signalState?.timeframe || "monitor"} - ${signalState?.barsSinceSignal ?? MISSING_VALUE} bars`}
                style={{
                  border: `1px solid ${signalFresh ? signalColor : `${signalColor}66`}`,
                  background: signalFresh ? `${signalColor}1f` : `${signalColor}0f`,
                  color: signalFresh ? signalColor : `${signalColor}bb`,
                  cursor: "pointer",
                  fontFamily: T.mono,
                  fontSize: fs(7),
                  fontWeight: 900,
                  letterSpacing: "0.06em",
                  lineHeight: 1,
                  padding: sp("2px 3px"),
                  borderRadius: 0,
                }}
              >
                {signalDirection.toUpperCase()}
              </button>
            ) : null}
            <span
              style={{
                color: T.text,
                fontFamily: T.mono,
                fontSize: fs(11),
                fontWeight: 700,
                textAlign: "right",
                minWidth: dim(52),
              }}
            >
              {formatQuotePrice(priceValue)}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto auto auto auto",
              alignItems: "center",
              gap: sp(5),
              marginTop: sp(3),
              minWidth: 0,
            }}
          >
            <span
              title={displayName}
              style={{
                fontSize: fs(9),
                color: T.textDim,
                fontFamily: T.sans,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </span>
            <MarketIdentityChips
              item={identityItem}
              compact
              maxChips={2}
              showExchange={false}
              showMarket
              showSector={false}
            />
            <span
              style={{
                fontSize: fs(9),
                color:
                  pctPositive == null ? T.textMuted : pctPositive ? T.green : T.red,
                fontFamily: T.mono,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {formatSignedPrice(snapshot?.chg, 2)}
            </span>
            <span
              style={{
                fontSize: fs(9),
                color:
                  pctPositive == null ? T.textMuted : pctPositive ? T.green : T.red,
                fontFamily: T.mono,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {formatSignedPercent(snapshot?.pct)}
            </span>
            <span
              title="Last quote update"
              style={{
                fontSize: fs(8),
                color: T.textMuted,
                fontFamily: T.mono,
                whiteSpace: "nowrap",
              }}
            >
              {quoteAge}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(8),
              marginTop: sp(3),
            }}
          >
            <span
              title="Volume"
              style={{
                color: T.textMuted,
                fontFamily: T.mono,
                fontSize: fs(8),
                whiteSpace: "nowrap",
              }}
            >
              Vol {fmtQuoteVolume(snapshot?.volume)}
            </span>
            <MicroSparkline
              data={
                snapshot?.sparkBars?.length
                  ? snapshot.sparkBars
                  : snapshot?.spark || fallback.spark
              }
              positive={pctPositive}
              width={70}
              height={15}
            />
          </div>
        </div>
        <button
          type="button"
          data-testid={
            item.monitoredOnly ? "watchlist-add-symbol" : "watchlist-remove-symbol"
          }
          className="ra-interactive"
          onClick={(event) => {
            event.stopPropagation();
            if (item.monitoredOnly) {
              onAddSymbol?.(item.sym, displayName, item);
              return;
            }
            if (!activeActionDisabled) {
              onRemoveSymbol?.(item.id, item.sym);
            }
          }}
          disabled={item.monitoredOnly ? busy : activeActionDisabled}
          title={
            item.monitoredOnly
              ? `Add ${item.sym} to watchlist`
              : item.canRemove
                ? `Remove ${item.sym}`
                : `${item.sym} cannot be removed from this source`
          }
          style={{
            width: dim(28),
            height: dim(28),
            justifySelf: "end",
            display: "grid",
            placeItems: "center",
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            background: item.monitoredOnly ? `${T.accent}10` : "transparent",
            color: item.monitoredOnly
              ? T.accent
              : activeActionDisabled
                ? T.textMuted
                : T.textDim,
            cursor:
              (item.monitoredOnly && !busy) || !activeActionDisabled
                ? "pointer"
                : "default",
          }}
        >
          {item.monitoredOnly ? <Plus size={14} /> : <Trash2 size={13} />}
        </button>
      </div>
    );
  },
);

const Watchlist = ({
  watchlists = [],
  activeWatchlistId = null,
  items = [],
  selected,
  signalStates = [],
  onSelect,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onSetDefaultWatchlist,
  onAddSymbol,
  onReorderSymbol,
  onRemoveSymbol,
  onSignalAction,
  busy = false,
}) => {
  const rootRef = useRef(null);
  const [search, setSearch] = useState("");
  const [watchlistMenuOpen, setWatchlistMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [sortMode, setSortMode] = useState(WATCHLIST_SORT_MODE.MANUAL);
  const [sortDirection, setSortDirection] = useState("desc");
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
  const deferredAddQuery = useDeferredValue(addQuery.trim());
  const activeWatchlist =
    activeWatchlistId != null
      ? watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ||
        null
      : watchlists[0] || null;
  const activeSymbols = useMemo(
    () =>
      new Set(
        items
          .filter((item) => !item.monitoredOnly)
          .map((item) => item.sym)
          .filter(Boolean),
      ),
    [items],
  );
  const quickAddSymbols = useMemo(
    () =>
      [...new Set([...WATCHLIST, ...INDICES, ...MACRO_TICKERS].map((item) => item.sym))]
        .filter((symbol) => !activeSymbols.has(symbol))
        .slice(0, 8),
    [activeSymbols],
  );
  const itemSymbols = useMemo(
    () => items.map((item) => item.sym).filter(Boolean),
    [items],
  );
  const snapshotsBySymbol = useRuntimeTickerSnapshots(itemSymbols);
  const signalStatesBySymbol = useMemo(
    () =>
      Object.fromEntries(
        (signalStates || [])
          .map((state) => [normalizeTickerSymbol(state?.symbol), state])
          .filter(([symbol]) => Boolean(symbol)),
      ),
    [signalStates],
  );
  const addSymbolSearch = useSearchUniverseTickers(
    addMode && deferredAddQuery.length > 0
      ? {
          search: deferredAddQuery,
          markets: ["stocks", "etf", "indices", "futures", "fx", "crypto", "otc"],
          active: true,
          limit: 8,
        }
      : undefined,
    {
      query: {
        enabled: addMode && deferredAddQuery.length > 0,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return items;
    return items.filter(
      (item) =>
        item.sym.toLowerCase().includes(normalizedSearch) ||
        (item.name || "").toLowerCase().includes(normalizedSearch),
    );
  }, [items, search]);
  const sorted = useMemo(
    () =>
      sortWatchlistRows(filtered, {
        mode: sortMode,
        direction: sortDirection,
        snapshotsBySymbol,
        signalStatesBySymbol,
      }),
    [filtered, signalStatesBySymbol, snapshotsBySymbol, sortDirection, sortMode],
  );
  const itemOrder = useMemo(
    () => new Map(items.map((item, index) => [item.key || item.id || item.sym, index])),
    [items],
  );
  const monitoredOnlyCount = useMemo(
    () => items.filter((item) => item.monitoredOnly).length,
    [items],
  );
  const directionEnabled = WATCHLIST_DIRECTION_SORTS.has(sortMode);

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      (!watchlistMenuOpen && !addMode)
    ) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      setWatchlistMenuOpen(false);
      if (addMode) {
        setAddMode(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [addMode, watchlistMenuOpen]);

  const handleCreateWatchlist = () => {
    const nextName = window.prompt("New watchlist name");
    if (!nextName?.trim()) {
      return;
    }
    onCreateWatchlist?.(nextName.trim());
  };

  const handleRenameWatchlist = () => {
    if (!activeWatchlist) {
      return;
    }
    const nextName = window.prompt("Rename watchlist", activeWatchlist.name);
    if (!nextName?.trim() || nextName.trim() === activeWatchlist.name) {
      return;
    }
    onRenameWatchlist?.(activeWatchlist.id, nextName.trim());
  };

  const handleDeleteWatchlist = () => {
    if (!activeWatchlist) {
      return;
    }
    const confirmed = window.confirm(
      `Delete watchlist "${activeWatchlist.name}"?`,
    );
    if (!confirmed) {
      return;
    }
    onDeleteWatchlist?.(activeWatchlist.id);
  };

  const handleAddQuickSymbol = (symbol) => {
    onAddSymbol?.(symbol, symbol);
    setAddMode(false);
    setAddQuery("");
  };

  const handleSelectSortMode = (nextMode) => {
    setSortMode(nextMode);
    if (nextMode === WATCHLIST_SORT_MODE.ALPHA) {
      setSortDirection("asc");
    } else if (nextMode === WATCHLIST_SORT_MODE.PERCENT || nextMode === WATCHLIST_SORT_MODE.VOLUME) {
      setSortDirection("desc");
    }
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const clearDragState = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDrop = (targetItemId) => {
    if (!draggedItemId || draggedItemId === targetItemId) {
      clearDragState();
      return;
    }
    onReorderSymbol?.(draggedItemId, targetItemId);
    clearDragState();
  };

  return (
    <div
      ref={rootRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.bg1,
        borderRight: `1px solid ${T.border}`,
        position: "relative",
      }}
    >
      <div
        style={{
          padding: sp("8px 9px 7px"),
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
          <button
            type="button"
            onClick={() => setWatchlistMenuOpen((open) => !open)}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              padding: sp("6px 8px"),
              borderRadius: 0,
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.text,
              cursor: "pointer",
              fontFamily: T.mono,
              fontSize: fs(10),
              fontWeight: 800,
            }}
          >
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeWatchlist?.name || "Watchlists"}
            </span>
            <ChevronDown size={13} style={{ color: T.textDim, flexShrink: 0 }} />
          </button>
          <button
            type="button"
            onClick={handleCreateWatchlist}
            title="New watchlist"
            style={{
              width: dim(30),
              height: dim(30),
              display: "grid",
              placeItems: "center",
              borderRadius: 0,
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.accent,
              cursor: "pointer",
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: sp(4) }}>
          <button
            type="button"
            onClick={handleRenameWatchlist}
            disabled={!activeWatchlist || busy}
            style={{
              padding: sp("4px 5px"),
              borderRadius: 0,
              background: "transparent",
              border: `1px solid ${T.border}`,
              color: T.textDim,
              cursor: activeWatchlist && !busy ? "pointer" : "default",
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 700,
            }}
          >
            RENAME
          </button>
          <button
            type="button"
            onClick={() => activeWatchlist && onSetDefaultWatchlist?.(activeWatchlist.id)}
            disabled={!activeWatchlist || activeWatchlist.isDefault || busy}
            style={{
              padding: sp("4px 5px"),
              borderRadius: 0,
              background: activeWatchlist?.isDefault ? `${T.green}12` : "transparent",
              border: `1px solid ${T.border}`,
              color: activeWatchlist?.isDefault ? T.green : T.textDim,
              cursor:
                activeWatchlist && !activeWatchlist.isDefault && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 700,
            }}
          >
            {activeWatchlist?.isDefault ? "DEFAULT" : "DEFAULT"}
          </button>
          <button
            type="button"
            onClick={handleDeleteWatchlist}
            disabled={!activeWatchlist || watchlists.length <= 1 || busy}
            style={{
              padding: sp("4px 5px"),
              borderRadius: 0,
              background: "transparent",
              border: `1px solid ${T.border}`,
              color: watchlists.length <= 1 ? T.textMuted : T.red,
              cursor:
                activeWatchlist && watchlists.length > 1 && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 700,
            }}
          >
            DELETE
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: sp(3),
          }}
        >
          {WATCHLIST_SORT_OPTIONS.map((option) => {
            const active = sortMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                data-testid={`watchlist-sort-${option.id}`}
                onClick={() => handleSelectSortMode(option.id)}
                title={`Sort by ${option.label}`}
                style={{
                  padding: sp("4px 2px"),
                  borderRadius: 0,
                  background: active ? T.bg3 : "transparent",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  color: active ? T.text : T.textMuted,
                  cursor: "pointer",
                  fontFamily: T.mono,
                  fontSize: fs(7),
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: sp(5) }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(6),
              padding: sp("5px 8px"),
              borderRadius: 0,
              background: T.bg2,
              border: `1px solid ${T.border}`,
              minWidth: 0,
            }}
          >
            <Search size={13} style={{ color: T.textDim, flexShrink: 0 }} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter..."
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: fs(10),
                fontFamily: T.sans,
                color: T.text,
              }}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              directionEnabled &&
              setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
            }
            disabled={!directionEnabled}
            title={directionEnabled ? "Toggle sort direction" : "Sort direction unavailable"}
            style={{
              width: dim(44),
              borderRadius: 0,
              background: directionEnabled ? T.bg2 : "transparent",
              border: `1px solid ${T.border}`,
              color: directionEnabled ? T.textDim : T.textMuted,
              cursor: directionEnabled ? "pointer" : "default",
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 800,
            }}
          >
            {sortDirection === "desc" ? "DESC" : "ASC"}
          </button>
        </div>

        {addMode ? (
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 0,
              background: T.bg2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                padding: sp("6px 8px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Add symbol..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: fs(10),
                  fontFamily: T.mono,
                  color: T.text,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setAddMode(false);
                  setAddQuery("");
                }}
                title="Close add symbol"
                style={{
                  width: dim(22),
                  height: dim(22),
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  background: "transparent",
                  color: T.textDim,
                  cursor: "pointer",
                }}
              >
                <X size={13} />
              </button>
            </div>

            <div style={{ maxHeight: dim(180), overflowY: "auto" }}>
              {deferredAddQuery.length > 0
                ? (addSymbolSearch.data?.results || []).map((result) => (
                    <button
                      key={`${result.ticker}-${result.name}`}
                      type="button"
                      onClick={() => {
                        onAddSymbol?.(result.ticker, result.name || result.ticker, result);
                        setAddMode(false);
                        setAddQuery("");
                      }}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "56px 1fr",
                        gap: sp(8),
                        alignItems: "center",
                        padding: sp("7px 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: fs(10),
                          fontWeight: 700,
                          fontFamily: T.mono,
                          color: T.text,
                        }}
                      >
                        {result.ticker}
                      </span>
                      <span
                        style={{
                          fontSize: fs(9),
                          color: T.textSec,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {result.name || result.primaryExchange || "Equity"}
                      </span>
                    </button>
                  ))
                : quickAddSymbols.map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => handleAddQuickSymbol(symbol)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: sp("7px 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        cursor: "pointer",
                        fontFamily: T.mono,
                        fontSize: fs(10),
                        color: T.text,
                      }}
                    >
                      <span>{symbol}</span>
                      <span style={{ color: T.textMuted }}>QUICK ADD</span>
                    </button>
                  ))}
              {addMode &&
              deferredAddQuery.length > 0 &&
              !addSymbolSearch.isPending &&
              !(addSymbolSearch.data?.results || []).length ? (
                <div
                  style={{
                    padding: sp("10px 8px"),
                    color: T.textDim,
                    fontSize: fs(9),
                    fontFamily: T.mono,
                  }}
                >
                  No matching symbols.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {watchlistMenuOpen ? (
        <div
          style={{
            position: "absolute",
            top: dim(42),
            left: sp(9),
            right: sp(9),
            zIndex: 20,
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
            overflow: "hidden",
          }}
        >
          {watchlists.map((watchlist) => (
            <button
              key={watchlist.id}
              type="button"
              onClick={() => {
                onSelectWatchlist?.(watchlist.id);
                setWatchlistMenuOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                padding: sp("8px 10px"),
                background:
                  watchlist.id === activeWatchlistId ? T.bg3 : "transparent",
                border: "none",
                borderBottom: `1px solid ${T.border}20`,
                color: T.text,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(10),
                    fontWeight: 700,
                    fontFamily: T.mono,
                    color: T.text,
                  }}
                >
                  {watchlist.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                    marginTop: 1,
                  }}
                >
                  {countWatchlistSymbols(watchlist)} symbols
                </span>
              </span>
              {watchlist.isDefault ? (
                <span
                  style={{
                    color: T.green,
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    fontWeight: 700,
                  }}
                >
                  DEFAULT
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((item) => {
          const itemKey = item.key || item.id || item.sym;
          const canDrag =
            sortMode === WATCHLIST_SORT_MODE.MANUAL &&
            Boolean(item.canReorder && item.id) &&
            !busy;
          return (
            <WatchlistRow
              key={itemKey}
              item={item}
              itemIndex={itemOrder.get(itemKey) ?? -1}
              selected={selected}
              canDrag={canDrag}
              dragging={Boolean(item.id && item.id === draggedItemId)}
              dragOver={Boolean(item.id && item.id === dragOverItemId)}
              onDragStart={setDraggedItemId}
              onDragOver={(itemId) => {
                if (draggedItemId && draggedItemId !== itemId) {
                  setDragOverItemId(itemId);
                }
              }}
              onDrop={handleDrop}
              onDragEnd={clearDragState}
              onSelect={onSelect}
              onAddSymbol={onAddSymbol}
              onRemoveSymbol={onRemoveSymbol}
              onSignalAction={onSignalAction}
              busy={busy}
            />
          );
        })}
      </div>

      <div
        style={{
          padding: sp("6px 9px"),
          borderTop: `1px solid ${T.border}`,
          fontSize: fs(9),
          color: T.textMuted,
          fontFamily: T.mono,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(8),
        }}
      >
        <span>
          {sorted.length} shown
          {monitoredOnlyCount ? ` / ${monitoredOnlyCount} monitored` : ""}
        </span>
        <button
          type="button"
          onClick={() => setAddMode((current) => !current)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            border: "none",
            background: "transparent",
            color: T.accent,
            cursor: "pointer",
            fontFamily: T.mono,
            fontSize: fs(9),
            fontWeight: 800,
          }}
        >
          {addMode ? <X size={12} /> : <Plus size={12} />}
          {addMode ? "CLOSE" : "ADD"}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// CONTEXT PANEL (Right Column) — adapts per screen
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// SCREEN: MARKET
// ═══════════════════════════════════════════════════════════════════

const INDICES = [
  {
    sym: "SPY",
    name: "S&P 500",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "QQQ",
    name: "Nasdaq 100",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IWM",
    name: "Russell 2k",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "DIA",
    name: "Dow Jones",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
];

export const MACRO_TICKERS = [
  { sym: "VIXY", price: null, chg: null, pct: null, label: "Volatility" },
  { sym: "IEF", price: null, chg: null, pct: null, label: "Treasuries" },
  { sym: "UUP", price: null, chg: null, pct: null, label: "Dollar" },
  { sym: "GLD", price: null, chg: null, pct: null, label: "Gold" },
  { sym: "USO", price: null, chg: null, pct: null, label: "Crude" },
];

export const RATES_PROXIES = [
  { term: "1-3M", sym: "BIL", price: null, chg: null, pct: null, d5: null },
  {
    term: "1-3Y",
    sym: "SHY",
    price: null,
    chg: null,
    pct: null,
    d5: null,
  },
  { term: "3-7Y", sym: "IEI", price: null, chg: null, pct: null, d5: null },
  { term: "7-10Y", sym: "IEF", price: null, chg: null, pct: null, d5: null },
  { term: "20Y+", sym: "TLT", price: null, chg: null, pct: null, d5: null },
];

export const SECTORS = [
  { name: "Technology", sym: "XLK", chg: null, d5: null },
  { name: "Financials", sym: "XLF", chg: null, d5: null },
  { name: "Healthcare", sym: "XLV", chg: null, d5: null },
  { name: "Industrials", sym: "XLI", chg: null, d5: null },
  { name: "Energy", sym: "XLE", chg: null, d5: null },
  { name: "Cons Disc", sym: "XLY", chg: null, d5: null },
  { name: "Utilities", sym: "XLU", chg: null, d5: null },
  { name: "Comm Svcs", sym: "XLC", chg: null, d5: null },
  { name: "Materials", sym: "XLB", chg: null, d5: null },
  { name: "Staples", sym: "XLP", chg: null, d5: null },
  { name: "Real Estate", sym: "XLRE", chg: null, d5: null },
];

// Finviz-style treemap data: sector → stocks with market cap (billions) and performance
export const TREEMAP_DATA = [
  {
    sector: "TECHNOLOGY",
    stocks: [
      { sym: "MSFT", cap: 3100, d1: null, d5: null },
      { sym: "AAPL", cap: 2900, d1: null, d5: null },
      { sym: "NVDA", cap: 2800, d1: null, d5: null },
      { sym: "AVGO", cap: 680, d1: null, d5: null },
      { sym: "ORCL", cap: 420, d1: null, d5: null },
      { sym: "CRM", cap: 310, d1: null, d5: null },
      { sym: "AMD", cap: 260, d1: null, d5: null },
      { sym: "QCOM", cap: 210, d1: null, d5: null },
      { sym: "INTC", cap: 120, d1: null, d5: null },
      { sym: "IBM", cap: 195, d1: null, d5: null },
    ],
  },
  {
    sector: "COMM SVCS",
    stocks: [
      { sym: "GOOGL", cap: 2100, d1: null, d5: null },
      { sym: "META", cap: 1500, d1: null, d5: null },
      { sym: "NFLX", cap: 380, d1: null, d5: null },
      { sym: "TMUS", cap: 280, d1: null, d5: null },
      { sym: "DIS", cap: 200, d1: null, d5: null },
      { sym: "VZ", cap: 175, d1: null, d5: null },
    ],
  },
  {
    sector: "CONS DISC",
    stocks: [
      { sym: "AMZN", cap: 2000, d1: null, d5: null },
      { sym: "TSLA", cap: 800, d1: null, d5: null },
      { sym: "HD", cap: 380, d1: null, d5: null },
      { sym: "MCD", cap: 210, d1: null, d5: null },
      { sym: "NKE", cap: 120, d1: null, d5: null },
      { sym: "SBUX", cap: 110, d1: null, d5: null },
    ],
  },
  {
    sector: "FINANCIAL",
    stocks: [
      { sym: "BRK.B", cap: 880, d1: null, d5: null },
      { sym: "JPM", cap: 620, d1: null, d5: null },
      { sym: "V", cap: 580, d1: null, d5: null },
      { sym: "MA", cap: 440, d1: null, d5: null },
      { sym: "BAC", cap: 310, d1: null, d5: null },
      { sym: "GS", cap: 160, d1: null, d5: null },
    ],
  },
  {
    sector: "HEALTHCARE",
    stocks: [
      { sym: "LLY", cap: 750, d1: null, d5: null },
      { sym: "UNH", cap: 520, d1: null, d5: null },
      { sym: "JNJ", cap: 380, d1: null, d5: null },
      { sym: "ABBV", cap: 340, d1: null, d5: null },
      { sym: "MRK", cap: 280, d1: null, d5: null },
      { sym: "ABT", cap: 200, d1: null, d5: null },
    ],
  },
  {
    sector: "INDUSTRIAL",
    stocks: [
      { sym: "GE", cap: 200, d1: null, d5: null },
      { sym: "CAT", cap: 180, d1: null, d5: null },
      { sym: "RTX", cap: 155, d1: null, d5: null },
      { sym: "UNP", cap: 145, d1: null, d5: null },
      { sym: "BA", cap: 130, d1: null, d5: null },
      { sym: "HON", cap: 140, d1: null, d5: null },
    ],
  },
  {
    sector: "ENERGY",
    stocks: [
      { sym: "XOM", cap: 480, d1: null, d5: null },
      { sym: "CVX", cap: 290, d1: null, d5: null },
      { sym: "COP", cap: 130, d1: null, d5: null },
      { sym: "SLB", cap: 65, d1: null, d5: null },
    ],
  },
  {
    sector: "STAPLES",
    stocks: [
      { sym: "WMT", cap: 580, d1: null, d5: null },
      { sym: "PG", cap: 380, d1: null, d5: null },
      { sym: "COST", cap: 340, d1: null, d5: null },
      { sym: "KO", cap: 260, d1: null, d5: null },
    ],
  },
];

const TREEMAP_SYMBOLS = [
  ...new Set(
    TREEMAP_DATA.flatMap((sector) => sector.stocks.map((stock) => stock.sym)),
  ),
];
const MARKET_SNAPSHOT_SYMBOLS = [
  ...new Set([
    ...INDICES.map((item) => item.sym),
    ...MACRO_TICKERS.map((item) => item.sym),
    ...RATES_PROXIES.map((item) => item.sym),
    ...SECTORS.map((item) => item.sym),
    ...TREEMAP_SYMBOLS,
  ]),
];
const MARKET_PERFORMANCE_SYMBOLS = [
  ...new Set([
    ...MACRO_TICKERS.map((item) => item.sym),
    ...RATES_PROXIES.map((item) => item.sym),
    ...SECTORS.map((item) => item.sym),
    ...TREEMAP_SYMBOLS,
  ]),
];

// TreemapHeatmap — SVG-rendered, D3-powered, Finviz-quality
// Drop-in replacement for the current broken treemap

// Color scale matching Finviz: deep green → neutral → deep red
// Green/red colors stay saturated in both themes (they're vivid against any bg)
// Neutral cell + text adapt via T proxy
const heatColor = (val) => {
  if (!isFiniteNumber(val)) return T.bg3;
  if (val >= 3) return "#1a7a3c";
  if (val >= 2) return "#228b45";
  if (val >= 1) return "#2f9c51";
  if (val >= 0.5) return "#4ea866";
  if (val >= 0.1) return "#6fb481";
  if (val > -0.1) return T.bg3; // theme-aware neutral cell
  if (val >= -0.5) return "#b36a6a";
  if (val >= -1) return "#b55050";
  if (val >= -2) return "#b03838";
  if (val >= -3) return "#982828";
  return "#7d1f1f";
};
// Neutral cells use theme-aware muted text; saturated cells always use white
const heatText = (val) =>
  !isFiniteNumber(val) || Math.abs(val) < 0.1 ? T.textDim : "#ffffff";

export const TreemapHeatmap = ({ data, period, onSymClick }) => {
  const VW = 1000,
    VH = 480;

  // Build D3 hierarchy
  const root = useMemo(() => {
    const hierarchy = d3
      .hierarchy({
        name: "root",
        children: data.map((s) => ({
          name: s.sector,
          children: s.stocks.map((st) => ({
            name: st.sym,
            value: st.cap,
            chg: period === "1d" ? st.d1 : st.d5,
          })),
        })),
      })
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value);

    d3
      .treemap()
      .size([VW, VH])
      .paddingOuter(3)
      .paddingTop(20)
      .paddingInner(2)
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.2))(hierarchy);

    return hierarchy;
  }, [data, period]);

  const sectors = root.children || [];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: "block",
        borderRadius: 0,
        aspectRatio: `${VW} / ${VH}`,
      }}
    >
      {/* Background */}
      <rect width={VW} height={VH} fill={T.bg1} rx="0" />

      {sectors.map((sector, si) => {
        const sx = sector.x0,
          sy = sector.y0;
        const sw = sector.x1 - sector.x0,
          sh = sector.y1 - sector.y0;

        return (
          <g key={si}>
            {/* Sector background with thin border */}
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              fill="none"
              stroke={T.border}
              strokeWidth="1"
              rx="0"
            />

            {/* Sector label bar */}
            <rect x={sx} y={sy} width={sw} height={18} fill={T.bg2} rx="0" />
            <text
              x={sx + 6}
              y={sy + 12}
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.sans,
                fill: T.textSec,
                letterSpacing: "0.06em",
              }}
            >
              {sector.data.name}
            </text>

            {/* Stock cells */}
            {(sector.children || []).map((leaf, li) => {
              const lx = leaf.x0,
                ly = leaf.y0;
              const lw = leaf.x1 - leaf.x0,
                lh = leaf.y1 - leaf.y0;
              const val = leaf.data.chg;
              const bg = heatColor(val);
              const tc = heatText(val);

              // Adaptive font sizes based on cell pixel dimensions
              const symSize =
                lw > 90 ? 14 : lw > 60 ? 12 : lw > 40 ? 10 : lw > 25 ? 8 : 0;
              const pctSize = lw > 60 ? 11 : lw > 40 ? 9 : lw > 25 ? 7 : 0;
              const showSym = symSize > 0 && lh > 18;
              const showPct = pctSize > 0 && lh > 28;
              const cx = lx + lw / 2;
              const cy = ly + lh / 2;

              return (
                <g
                  key={li}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSymClick && onSymClick(leaf.data.name)}
                >
                  <rect
                    x={lx}
                    y={ly}
                    width={lw}
                    height={lh}
                    fill={bg}
                    rx="0"
                    onMouseEnter={(e) =>
                      e.target.setAttribute("opacity", "0.8")
                    }
                    onMouseLeave={(e) => e.target.setAttribute("opacity", "1")}
                  />
                  {showSym && (
                    <text
                      x={cx}
                      y={showPct ? cy - 2 : cy + 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{
                        fontSize: symSize,
                        fontWeight: 800,
                        fontFamily: T.mono,
                        fill: tc,
                        pointerEvents: "none",
                      }}
                    >
                      {leaf.data.name}
                    </text>
                  )}
                  {showPct && (
                    <text
                      x={cx}
                      y={cy + symSize * 0.6 + 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{
                        fontSize: pctSize,
                        fontWeight: 600,
                        fontFamily: T.mono,
                        fill: tc,
                        opacity: 0.85,
                        pointerEvents: "none",
                      }}
                    >
                      {isFiniteNumber(val)
                        ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`
                        : MISSING_VALUE}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};

// Sector-level heatmap: just sector ETFs as proportional blocks
export const SectorTreemap = ({ sectors, period }) => {
  const VW = 1000,
    VH = 60;

  const root = useMemo(() => {
    const weights = {
      XLK: 30,
      XLF: 13,
      XLV: 12,
      XLY: 10,
      XLC: 9,
      XLI: 9,
      XLP: 6,
      XLE: 4,
      XLRE: 3,
      XLU: 2,
      XLB: 2,
    };
    const hierarchy = d3
      .hierarchy({
        name: "root",
        children: sectors.map((s) => ({
          name: s.sym,
          fullName: s.name,
          value: weights[s.sym] || 3,
          chg: period === "1d" ? s.chg : s.d5,
        })),
      })
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value);

    d3.treemap().size([VW, VH]).padding(1).round(true).tile(d3.treemapSquarify)(
      hierarchy,
    );

    return hierarchy;
  }, [sectors, period]);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VW} ${VH}`}
      style={{ display: "block", borderRadius: 0 }}
    >
      <rect width={VW} height={VH} fill={T.bg1} rx="0" />
      {(root.children || []).map((leaf, i) => {
        const lx = leaf.x0,
          ly = leaf.y0;
        const lw = leaf.x1 - leaf.x0,
          lh = leaf.y1 - leaf.y0;
        const val = leaf.data.chg;
        const bg = heatColor(val);
        const cx = lx + lw / 2,
          cy = ly + lh / 2;
        return (
          <g key={i} style={{ cursor: "pointer" }}>
            <rect
              x={lx}
              y={ly}
              width={lw}
              height={lh}
              fill={bg}
              rx="0"
              onMouseEnter={(e) => e.target.setAttribute("opacity", "0.8")}
              onMouseLeave={(e) => e.target.setAttribute("opacity", "1")}
            />
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: lw > 80 ? 10 : 8,
                fontWeight: 700,
                fontFamily: T.mono,
                fill: heatText(val),
                pointerEvents: "none",
              }}
            >
              {leaf.data.name}
            </text>
            <text
              x={cx}
              y={cy + 8}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: lw > 80 ? 9 : 7,
                fontWeight: 600,
                fontFamily: T.mono,
                fill: heatText(val),
                opacity: 0.8,
                pointerEvents: "none",
              }}
            >
              {isFiniteNumber(val)
                ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`
                : MISSING_VALUE}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const NEWS = [
  {
    text: "Fed's Waller signals support for gradual rate cuts despite sticky services inflation",
    time: "2h",
    tag: "FED",
    s: 0,
  },
  {
    text: "NVIDIA Blackwell Ultra shipments to begin Q2; partners confirm record orders",
    time: "4h",
    tag: "NVDA",
    s: 1,
  },
  {
    text: "Intel posts surprise loss, guides Q1 below estimates as AI competition intensifies",
    time: "5h",
    tag: "INTC",
    s: -1,
  },
  {
    text: "PayPal bets on agentic commerce, acquires Israel-based Cymbio",
    time: "5h",
    tag: "PYPL",
    s: 1,
  },
  {
    text: "US initial jobless claims fall to 215K vs 225K expected, labor market remains tight",
    time: "7h",
    tag: "MACRO",
    s: 1,
  },
  {
    text: "Treasury 10Y yield climbs to 4.29% as markets digest hawkish Fed commentary",
    time: "9h",
    tag: "BONDS",
    s: -1,
  },
];

const EVENTS = [
  { date: "Apr 18", label: "Good Friday — Closed", type: "holiday" },
  { date: "Apr 23", label: "S&P PMI Flash", type: "econ" },
  { date: "Apr 25", label: "MSFT, GOOGL Earnings", type: "earnings" },
  { date: "May 1", label: "AAPL, AMZN Earnings", type: "earnings" },
  { date: "May 2", label: "Nonfarm Payrolls", type: "econ" },
  { date: "May 6-7", label: "FOMC Meeting", type: "fomc" },
  { date: "May 13", label: "CPI Release", type: "cpi" },
];

const COND = [
  {
    key: "vol",
    label: "Volatility",
    score: 72,
    color: T.cyan,
    items: [
      ["VIX", "16.82", "↓"],
      ["VIX %ile", "22nd", "↓"],
      ["VVIX", "14.2", "↓"],
      ["IV Rank", "18%", "↓"],
    ],
  },
  {
    key: "trend",
    label: "Trend",
    score: 78,
    color: T.green,
    items: [
      ["vs 20 SMA", "Above", "↑"],
      ["vs 50 SMA", "Above", "↑"],
      ["Duration", "14d", "→"],
      ["HH/HL", "3/3", "↑"],
    ],
  },
  {
    key: "breadth",
    label: "Breadth",
    score: 62,
    color: T.amber,
    items: [
      [">20d", "62%", "↓"],
      [">50d", "58%", "↓"],
      ["A/D", "1.82", "↑"],
      ["NH/NL", "3.3:1", "→"],
    ],
  },
  {
    key: "mom",
    label: "Momentum",
    score: 69,
    color: T.purple,
    items: [
      ["Spread", "1.82%", "→"],
      ["Lead", "XLU XLI", "↑"],
      ["%HH", "41%", "↓"],
      ["Part.", "Narrow", "↓"],
    ],
  },
];

export const Card = ({ children, style = {}, noPad, ...props }) => (
  <div
    {...props}
    style={{
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: 0,
      padding: noPad ? 0 : "8px 10px",
      overflow: "hidden",
      transition:
        "background-color var(--ra-motion-fast) var(--ra-motion-ease), border-color var(--ra-motion-fast) var(--ra-motion-ease), box-shadow var(--ra-motion-fast) var(--ra-motion-ease)",
      ...style,
    }}
  >
    {children}
  </div>
);

export const CardTitle = ({ children, right }) => (
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
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </span>
    {right}
  </div>
);

// ─── ORDER FLOW DONUT ───
// Multi-segment donut showing buy/sell volume by trade size bracket.
// Segments arranged: top→clockwise: buyXL, buyL, buyM, buyS, sellS, sellM, sellL, sellXL
// Greens shade darker for larger buy sizes, reds shade darker for larger sells
export const OrderFlowDonut = ({ flow, size = 110, thickness = 18 }) => {
  const totalBuy = flow.buyXL + flow.buyL + flow.buyM + flow.buyS;
  const totalSell = flow.sellXL + flow.sellL + flow.sellM + flow.sellS;
  const total = totalBuy + totalSell || 1;
  const net = totalBuy - totalSell;

  // 8 segments — buys (greens, light to dark) then sells (reds, dark to light)
  // ordered around the ring so XL sit at the "edges" and S sit closer to neutral
  const segs = [
    { value: flow.buyXL, color: "#047857" },
    { value: flow.buyL, color: "#10b981" },
    { value: flow.buyM, color: "#34d399" },
    { value: flow.buyS, color: "#6ee7b7" },
    { value: flow.sellS, color: "#fca5a5" },
    { value: flow.sellM, color: "#f87171" },
    { value: flow.sellL, color: "#ef4444" },
    { value: flow.sellXL, color: "#b91c1c" },
  ];

  const cx = size / 2,
    cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r - thickness;

  let cumAngle = -Math.PI / 2;
  const paths = segs.map((seg, i) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    if (angle <= 0) return null;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return (
      <path key={i} d={d} fill={seg.color} stroke={T.bg2} strokeWidth={1} />
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize={fs(7)}
        fill={T.textMuted}
        fontFamily={T.mono}
        letterSpacing="0.08em"
      >
        NET
      </text>
      <text
        x={cx}
        y={cy + fs(11)}
        textAnchor="middle"
        fontSize={fs(11)}
        fontWeight={700}
        fill={net >= 0 ? T.green : T.red}
        fontFamily={T.mono}
      >
        {net >= 0 ? "+" : ""}${Math.abs(net).toFixed(0)}M
      </text>
    </svg>
  );
};

// ─── SIZE BUCKET ROW ───
// Mirrored bar chart row — buy bar grows right-to-left, sell bar grows left-to-right
// Visual at-a-glance "is XL flow biased buy or sell?"
export const SizeBucketRow = ({ label, buy, sell, maxValue }) => {
  const buyPct = (buy / maxValue) * 100;
  const sellPct = (sell / maxValue) * 100;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr 22px 1fr 44px",
        gap: sp(4),
        alignItems: "center",
        padding: sp("2px 0"),
        fontFamily: T.mono,
        fontSize: fs(9),
      }}
    >
      <span style={{ color: T.green, fontWeight: 600, textAlign: "right" }}>
        {buy.toFixed(1)}
      </span>
      <div
        style={{ display: "flex", justifyContent: "flex-end", height: dim(8) }}
      >
        <div
          style={{
            width: `${buyPct}%`,
            height: "100%",
            background: T.green,
            opacity: 0.85,
            borderRadius: dim(1),
          }}
        />
      </div>
      <span style={{ textAlign: "center", color: T.textSec, fontWeight: 700 }}>
        {label}
      </span>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-start",
          height: dim(8),
        }}
      >
        <div
          style={{
            width: `${sellPct}%`,
            height: "100%",
            background: T.red,
            opacity: 0.85,
            borderRadius: dim(1),
          }}
        />
      </div>
      <span style={{ color: T.red, fontWeight: 600 }}>{sell.toFixed(1)}</span>
    </div>
  );
};

// ─── ORDER FLOW DISTRIBUTION CARD ───
// Combined donut + size bucket bars. Reusable across Market and Trade tabs.
const OrderFlowDistribution = ({ flow, donutSize = 96 }) => {
  const totalBuy = flow.buyXL + flow.buyL + flow.buyM + flow.buyS;
  const totalSell = flow.sellXL + flow.sellL + flow.sellM + flow.sellS;
  const buyPct = ((totalBuy / (totalBuy + totalSell)) * 100).toFixed(1);
  const maxBucket = Math.max(
    flow.buyXL,
    flow.buyL,
    flow.buyM,
    flow.buyS,
    flow.sellXL,
    flow.sellL,
    flow.sellM,
    flow.sellS,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
      <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
        <OrderFlowDonut flow={flow} size={donutSize} thickness={14} />
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
              fontSize: fs(8),
              color: T.textMuted,
              letterSpacing: "0.08em",
            }}
          >
            BUY / SELL
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: T.mono,
              fontSize: fs(10),
            }}
          >
            <span style={{ color: T.green, fontWeight: 700 }}>
              ${totalBuy.toFixed(0)}M
            </span>
            <span style={{ color: T.red, fontWeight: 700 }}>
              ${totalSell.toFixed(0)}M
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
            style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}
          >
            {buyPct}% buy pressure
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(4) }}>
        <SizeBucketRow
          label="XL"
          buy={flow.buyXL}
          sell={flow.sellXL}
          maxValue={maxBucket}
        />
        <SizeBucketRow
          label="L"
          buy={flow.buyL}
          sell={flow.sellL}
          maxValue={maxBucket}
        />
        <SizeBucketRow
          label="M"
          buy={flow.buyM}
          sell={flow.sellM}
          maxValue={maxBucket}
        />
        <SizeBucketRow
          label="S"
          buy={flow.buyS}
          sell={flow.sellS}
          maxValue={maxBucket}
        />
      </div>
    </div>
  );
};

const MULTI_CHART_LAYOUTS = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "2x2": { cols: 2, rows: 2, count: 4 },
  "2x3": { cols: 3, rows: 2, count: 6 },
  "3x3": { cols: 3, rows: 3, count: 9 },
};

const MULTI_CHART_LAYOUT_CARD_WIDTH = {
  "1x1": 720,
  "2x2": 420,
  "2x3": 360,
  "3x3": 340,
};

const MULTI_CHART_LAYOUT_CARD_HEIGHT = {
  "1x1": 540,
  "2x2": 330,
  "2x3": 302,
  "3x3": 298,
};

const MARKET_GRID_TRACK_SESSION_KEY = "rayalgo:market-grid-track-sizes";
const LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY = "rayalgo:market-grid-card-size";
const LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY = "rayalgo:market-grid-card-scale";

const buildEqualTrackWeights = (count) => {
  const safeCount = Math.max(1, count || 1);
  return Array.from({ length: safeCount }, () => 1 / safeCount);
};

const normalizeMarketGridTrackWeights = (weights, count) => {
  if (!Array.isArray(weights) || weights.length !== count) {
    return buildEqualTrackWeights(count);
  }

  const sanitized = weights.map((value) =>
    Number.isFinite(value) && value > 0 ? value : 0,
  );
  const total = sanitized.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return buildEqualTrackWeights(count);
  }

  return sanitized.map((value) => value / total);
};

const normalizeMarketGridTrackLayoutState = (value, cols, rows) => ({
  cols: normalizeMarketGridTrackWeights(value?.cols, cols),
  rows: normalizeMarketGridTrackWeights(value?.rows, rows),
});

const readMarketGridTrackSession = () => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return {};
    }

    const raw = window.sessionStorage.getItem(MARKET_GRID_TRACK_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    }

    return {};
  } catch (error) {
    return {};
  }
};

const writeMarketGridTrackSession = (nextState) => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(
      MARKET_GRID_TRACK_SESSION_KEY,
      JSON.stringify(nextState || {}),
    );
    window.sessionStorage.removeItem(LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY);
    window.sessionStorage.removeItem(LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY);
  } catch (error) {}
};

const resizeMarketGridTrackWeights = (
  weights,
  dividerIndex,
  deltaPx,
  totalTrackPx,
  minTrackPx,
) => {
  if (
    !Array.isArray(weights) ||
    dividerIndex <= 0 ||
    dividerIndex >= weights.length ||
    !(totalTrackPx > 0)
  ) {
    return weights;
  }

  const currentTrackPx = weights.map((value) => value * totalTrackPx);
  const leftIndex = dividerIndex - 1;
  const rightIndex = dividerIndex;
  const pairTotal = currentTrackPx[leftIndex] + currentTrackPx[rightIndex];
  const safeMin = Math.max(
    24,
    Math.min(minTrackPx, pairTotal / 2 - 4),
  );

  if (!(pairTotal > safeMin * 2)) {
    return weights;
  }

  const nextTrackPx = [...currentTrackPx];
  const unclampedLeft = currentTrackPx[leftIndex] + deltaPx;
  const nextLeft = clampNumber(unclampedLeft, safeMin, pairTotal - safeMin);
  const nextRight = pairTotal - nextLeft;

  nextTrackPx[leftIndex] = nextLeft;
  nextTrackPx[rightIndex] = nextRight;

  return normalizeMarketGridTrackWeights(
    nextTrackPx.map((value) => value / totalTrackPx),
    weights.length,
  );
};

const buildMarketGridResizeHandleKey = (mode, colGapIndex, rowGapIndex) =>
  [mode, Number.isFinite(colGapIndex) ? colGapIndex : "na", Number.isFinite(rowGapIndex) ? rowGapIndex : "na"].join(":");

const MINI_CHART_TIMEFRAMES = getChartTimeframeValues("mini");
const OPTION_CHART_TIMEFRAMES = getChartTimeframeOptions("option");
const buildChartBarScopeKey = (...parts) =>
  parts.filter((part) => part != null && part !== "").join("::");
const buildMarketGridViewportIdentity = (slotIndex, slot) =>
  buildChartBarScopeKey(
    "market-grid-slot",
    slotIndex,
    normalizeTickerSymbol(slot?.ticker),
    normalizeChartTimeframe(slot?.tf),
    slot?.market || "stocks",
    slot?.providerContractId || "",
  );
const buildMarketGridViewportRevisionIdentity = (slotIndex, slot, revision) =>
  buildChartBarScopeKey(
    buildMarketGridViewportIdentity(slotIndex, slot),
    `view-${Math.max(0, Number(revision) || 0)}`,
  );
const deleteMarketGridViewportSnapshots = (snapshots, identityKey) => {
  if (!identityKey || !snapshots) return false;
  let deleted = false;
  Object.keys(snapshots).forEach((key) => {
    if (key === identityKey || key.startsWith(`${identityKey}::view-`)) {
      delete snapshots[key];
      deleted = true;
    }
  });
  return deleted;
};
const buildMarketGridVisibleRangeSignature = (range) =>
  range &&
  Number.isFinite(range.from) &&
  Number.isFinite(range.to)
    ? `${range.from}:${range.to}`
    : "none";
// Trade charts feel slow when the first IBKR history request has to pull the
// entire target window. Start with a first-paint slice, warm the deeper window
// in the query cache, then switch once it is already available.
const useProgressiveChartBarLimit = ({
  scopeKey,
  timeframe,
  role = "primary",
  enabled = true,
  warmTargetLimit,
}) => {
  const targetLimit = getChartBarLimit(timeframe, role);
  const initialLimit = getInitialChartBarLimit(timeframe, role);
  const maxLimit = getMaxChartBarLimit(timeframe, role);
  const progressiveKey = `${scopeKey}::${role}::${timeframe}`;
  const activeScopeKeyRef = useRef(progressiveKey);
  const warmingKeyRef = useRef(null);
  const [requestedLimit, setRequestedLimit] = useState(initialLimit);

  useEffect(() => {
    activeScopeKeyRef.current = progressiveKey;
    warmingKeyRef.current = null;
    setRequestedLimit(initialLimit);
  }, [initialLimit, progressiveKey]);

  const hydrateLimit = useCallback(
    (nextRequestedLimit) => {
      const normalizedNextLimit = Math.min(
        maxLimit,
        Math.max(initialLimit, Math.ceil(nextRequestedLimit)),
      );

      if (!enabled || normalizedNextLimit <= requestedLimit) {
        return;
      }

      const warmingKey = `${progressiveKey}::${normalizedNextLimit}`;
      if (warmingKeyRef.current === warmingKey) {
        return;
      }

      warmingKeyRef.current = warmingKey;

      Promise.resolve()
        .then(() => warmTargetLimit(normalizedNextLimit))
        .then(() => {
          if (activeScopeKeyRef.current !== progressiveKey) {
            return;
          }

          startTransition(() => {
            setRequestedLimit((current) =>
              current < normalizedNextLimit ? normalizedNextLimit : current,
            );
          });
        })
        .catch(() => {
          if (
            activeScopeKeyRef.current === progressiveKey &&
            warmingKeyRef.current === warmingKey
          ) {
            warmingKeyRef.current = null;
          }
        });
    },
    [
      enabled,
      initialLimit,
      maxLimit,
      progressiveKey,
      requestedLimit,
      warmTargetLimit,
    ],
  );

  const hydrateFullWindow = useCallback(() => {
    if (!enabled || initialLimit >= targetLimit || requestedLimit >= targetLimit) {
      return;
    }

    hydrateLimit(targetLimit);
  }, [
    enabled,
    hydrateLimit,
    initialLimit,
    requestedLimit,
    targetLimit,
  ]);

  const expandForVisibleRange = useCallback(
    (range, loadedBarCount, options = {}) => {
      if (!enabled || !range) {
        return;
      }

      const visibleBars = Math.max(1, Math.ceil(range.to - range.from));
      const leftEdgeBufferBars = Math.max(
        24,
        Math.min(144, Math.ceil(visibleBars * 0.2)),
      );
      if (range.from > leftEdgeBufferBars) {
        return;
      }

      const resolvedLoadedBarCount = Number.isFinite(loadedBarCount)
        ? Math.ceil(loadedBarCount)
        : 0;
      const canPrependOlderHistory =
        requestedLimit >= targetLimit &&
        resolvedLoadedBarCount < maxLimit &&
        typeof options.prependOlderBars === "function" &&
        Number.isFinite(options.oldestLoadedAtMs);

      if (canPrependOlderHistory) {
        const remainingBars = Math.max(0, maxLimit - resolvedLoadedBarCount);
        const minimumPageSize =
          role === "option"
            ? getInitialChartBarLimit(timeframe, "option")
            : role === "mini"
              ? getInitialChartBarLimit(timeframe, "mini")
              : getInitialChartBarLimit(timeframe, "primary");
        const prependPageSize = Math.max(
          minimumPageSize,
          Math.ceil(visibleBars * 2),
          role === "option" ? 240 : 360,
        );
        if (remainingBars > 0) {
          options.prependOlderBars({
            pageSize: Math.min(remainingBars, prependPageSize),
          });
        }
        return;
      }

      if (requestedLimit >= maxLimit) {
        return;
      }

      const effectiveLoadedBars = Math.max(
        requestedLimit,
        resolvedLoadedBarCount,
        Math.ceil(range.to + 1),
      );
      const nextRequestedLimit = Math.max(
        targetLimit,
        Math.ceil(effectiveLoadedBars * 2),
        effectiveLoadedBars + Math.max(visibleBars * 2, 480),
      );

      hydrateLimit(nextRequestedLimit);
    },
    [
      enabled,
      hydrateLimit,
      maxLimit,
      requestedLimit,
      role,
      targetLimit,
      timeframe,
    ],
  );

  return {
    requestedLimit,
    targetLimit,
    maxLimit,
    isHydratingFullWindow: enabled && requestedLimit < targetLimit,
    hydrateFullWindow,
    expandForVisibleRange,
  };
};

const VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS = 120;

const useDebouncedVisibleRangeExpansion = (
  expandVisibleRange,
  {
    delayMs = VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS,
    resetKey = "",
  } = {},
) => {
  const expandVisibleRangeRef = useRef(expandVisibleRange);
  const latestRangeRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    expandVisibleRangeRef.current = expandVisibleRange;
  }, [expandVisibleRange]);

  const clearScheduledExpansion = useCallback(() => {
    if (timerRef.current == null) {
      return;
    }

    if (typeof window !== "undefined") {
      window.clearTimeout(timerRef.current);
    } else {
      clearTimeout(timerRef.current);
    }
    timerRef.current = null;
    latestRangeRef.current = null;
  }, []);

  useEffect(() => {
    clearScheduledExpansion();
    return clearScheduledExpansion;
  }, [clearScheduledExpansion, resetKey]);

  return useCallback(
    (range) => {
      latestRangeRef.current = range;

      const resolvedDelay = Number.isFinite(delayMs)
        ? Math.max(0, delayMs)
        : VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS;
      if (resolvedDelay === 0) {
        clearScheduledExpansion();
        expandVisibleRangeRef.current?.(range);
        return;
      }

      if (timerRef.current != null) {
        if (typeof window !== "undefined") {
          window.clearTimeout(timerRef.current);
        } else {
          clearTimeout(timerRef.current);
        }
      }

      const setTimer =
        typeof window !== "undefined" ? window.setTimeout : setTimeout;
      timerRef.current = setTimer(() => {
        const nextRange = latestRangeRef.current;
        timerRef.current = null;
        latestRangeRef.current = null;
        expandVisibleRangeRef.current?.(nextRange);
      }, resolvedDelay);
    },
    [clearScheduledExpansion, delayMs],
  );
};

const nowMs = () =>
  typeof performance !== "undefined" && Number.isFinite(performance.now())
    ? performance.now()
    : Date.now();

const measureChartBarsRequest = async ({
  scopeKey,
  metric,
  request,
}) => {
  const startedAt = nowMs();
  try {
    return await request();
  } finally {
    recordChartHydrationMetric(metric, nowMs() - startedAt, scopeKey);
  }
};

const useDisplayChartPriceFallbackBars = ({
  symbol,
  market,
  providerContractId,
  enabled,
  scopeKey,
  priority = BARS_REQUEST_PRIORITY.visible,
}) => {
  const normalizedSymbol = normalizeTickerSymbol(symbol);
  const normalizedMarket = market || null;
  const normalizedProviderContractId = providerContractId || null;

  return useQuery({
    queryKey: [
      "display-chart-price-bars",
      normalizedSymbol,
      normalizedMarket,
      normalizedProviderContractId,
    ],
    queryFn: () =>
      measureChartBarsRequest({
        scopeKey,
        metric: "displayPriceRequestMs",
        request: () =>
          getBarsRequest(
            {
              symbol: normalizedSymbol,
              timeframe: DISPLAY_CHART_PRICE_TIMEFRAME,
              limit: 2,
              market: normalizedMarket || undefined,
              outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
              source: "trades",
              allowHistoricalSynthesis: true,
              providerContractId: normalizedProviderContractId || undefined,
            },
            buildBarsRequestOptions(priority),
          ),
      }),
    enabled: Boolean(enabled && normalizedSymbol),
    ...DISPLAY_CHART_PRICE_QUERY_DEFAULTS,
  });
};

const useMeasuredChartModel = ({
  scopeKey,
  bars,
  buildInput,
  deps,
}) => {
  const initialHydrationStartedAtRef = useRef(nowMs());
  const hasRecordedFirstPaintRef = useRef(false);
  const previousBuildStateRef = useRef(null);

  useEffect(() => {
    initialHydrationStartedAtRef.current = nowMs();
    hasRecordedFirstPaintRef.current = false;
    previousBuildStateRef.current = null;
    clearChartHydrationScope(scopeKey);
  }, [scopeKey]);

  const chartModel = useMemo(() => {
    const startedAt = nowMs();
    const nextResult = buildResearchChartModelIncremental(
      buildInput,
      previousBuildStateRef.current,
    );
    previousBuildStateRef.current = nextResult.state;
    recordChartHydrationMetric("modelBuildMs", nowMs() - startedAt, scopeKey);
    return nextResult.model;
  }, deps);

  const latestBarSignature = useMemo(() => {
    const lastBar = bars[bars.length - 1];
    if (!lastBar) {
      return "empty";
    }

    return [
      bars.length,
      resolveApiBarTimestampMs(lastBar.timestamp ?? lastBar.time) ?? "",
      lastBar.close ?? lastBar.c ?? "",
      lastBar.volume ?? lastBar.v ?? "",
    ].join("|");
  }, [bars]);

  useEffect(() => {
    if (!chartModel.chartBars.length) {
      return;
    }

    const pendingLivePatchStartedAt = consumeChartLivePatchPending(scopeKey);
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      if (!hasRecordedFirstPaintRef.current) {
        recordChartHydrationMetric(
          "firstPaintMs",
          nowMs() - initialHydrationStartedAtRef.current,
          scopeKey,
        );
        hasRecordedFirstPaintRef.current = true;
      }

      if (pendingLivePatchStartedAt !== null) {
        recordChartHydrationMetric(
          "livePatchToPaintMs",
          nowMs() - pendingLivePatchStartedAt,
          scopeKey,
        );
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [chartModel.chartBars.length, latestBarSignature, scopeKey]);

  return chartModel;
};

const buildBarsPageQueryKey = ({
  queryBase,
  timeframe,
  limit,
  from,
  to,
  market = null,
  assetClass = null,
  providerContractId = null,
  historyCursor = null,
  preferCursor = false,
}) => [
  ...queryBase,
  timeframe,
  limit,
  from,
  to,
  market,
  assetClass,
  providerContractId,
  historyCursor,
  Boolean(preferCursor),
];
const MARKET_CHART_STUDIES = [
  { id: "ema-21", label: "E21" },
  { id: "ema-55", label: "E55" },
  { id: "vwap", label: "VWAP" },
  { id: "rsi-14", label: "RSI" },
  { id: "macd-12-26-9", label: "MACD" },
];
const MAX_MULTI_CHART_SLOTS = Math.max(
  ...Object.values(MULTI_CHART_LAYOUTS).map((layout) => layout.count),
);
const MARKET_GRID_INDICATOR_PRESET_VERSION = 2;
const TRADE_EQUITY_INDICATOR_PRESET_VERSION = 1;
const TRADE_OPTION_INDICATOR_PRESET_VERSION = 1;
const DEFAULT_MINI_CHART_STUDIES = [
  RAY_REPLICA_PINE_SCRIPT_KEY,
  "ema-21",
  "vwap",
];
const DEFAULT_TRADE_EQUITY_STUDIES = [
  RAY_REPLICA_PINE_SCRIPT_KEY,
  "ema-21",
  "ema-55",
];
const DEFAULT_TRADE_OPTION_STUDIES = [RAY_REPLICA_PINE_SCRIPT_KEY];

export const normalizeTickerSymbol = (value) => value?.trim?.().toUpperCase?.() || "";

const readWatchlistIdentityValue = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

const buildWatchlistIdentityPayload = (source = {}) => {
  if (!source || typeof source !== "object") {
    return {};
  }

  const normalizedExchangeMic = readWatchlistIdentityValue(
    source.normalizedExchangeMic || source.primaryExchange,
  );
  const exchangeDisplay = readWatchlistIdentityValue(
    source.exchangeDisplay || source.primaryExchange || normalizedExchangeMic,
  );
  return Object.fromEntries(
    [
      ["market", readWatchlistIdentityValue(source.market)],
      ["normalizedExchangeMic", normalizedExchangeMic],
      ["exchangeDisplay", exchangeDisplay],
      ["countryCode", readWatchlistIdentityValue(source.countryCode)],
      ["exchangeCountryCode", readWatchlistIdentityValue(source.exchangeCountryCode)],
      ["sector", readWatchlistIdentityValue(source.sector)],
      ["industry", readWatchlistIdentityValue(source.industry)],
    ].filter(([, value]) => Boolean(value)),
  );
};

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

const normalizeMiniChartStudies = (value, includeRayReplicaByDefault = false) => {
  const fallback = includeRayReplicaByDefault
    ? DEFAULT_MINI_CHART_STUDIES
    : DEFAULT_MINI_CHART_STUDIES.filter(
        (studyId) => studyId !== RAY_REPLICA_PINE_SCRIPT_KEY,
      );
  const normalized = normalizeIndicatorSelection(value, fallback);
  return includeRayReplicaByDefault
    ? mergeIndicatorSelections(DEFAULT_MINI_CHART_STUDIES, normalized)
    : normalized;
};

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

const buildDefaultMiniChartSymbols = (
  activeSym,
  count = MAX_MULTI_CHART_SLOTS,
) => {
  const seed = normalizeTickerSymbol(activeSym) || WATCHLIST[0]?.sym || "SPY";
  const watchlistSymbols = WATCHLIST.map((item) =>
    normalizeTickerSymbol(item.sym),
  ).filter(Boolean);
  const ordered = [
    seed,
    ...watchlistSymbols.filter((symbol) => symbol !== seed),
  ];

  return Array.from(
    { length: count },
    (_, index) => ordered[index] || ordered[index % ordered.length] || seed,
  );
};

const hydrateMiniChartSlot = (
  slot,
  fallbackTicker,
  includeRayReplicaByDefault = false,
) => ({
  ticker:
    normalizeTickerSymbol(slot?.ticker) ||
    fallbackTicker ||
    WATCHLIST[0]?.sym ||
    "SPY",
  tf: MINI_CHART_TIMEFRAMES.includes(normalizeChartTimeframe(slot?.tf))
    ? normalizeChartTimeframe(slot?.tf)
    : "15m",
  studies: normalizeMiniChartStudies(
    slot?.studies,
    includeRayReplicaByDefault,
  ),
  rayReplicaSettings: resolvePersistedRayReplicaSettings(
    slot?.rayReplicaSettings,
  ),
  market: slot?.market || "stocks",
  provider: slot?.provider || null,
  providers: Array.isArray(slot?.providers) ? slot.providers.filter(Boolean) : [],
  tradeProvider: slot?.tradeProvider || null,
  dataProviderPreference: slot?.dataProviderPreference || null,
  providerContractId: slot?.providerContractId || null,
  exchange:
    slot?.exchange ||
    slot?.exchangeDisplay ||
    slot?.normalizedExchangeMic ||
    slot?.primaryExchange ||
    null,
  searchResult: normalizeTickerSearchResultForStorage(slot?.searchResult) || null,
});

const buildInitialMiniChartSlots = (activeSym) => {
  const persisted = Array.isArray(_initialState.marketGridSlots)
    ? _initialState.marketGridSlots
    : [];
  const defaults = buildDefaultMiniChartSymbols(
    activeSym,
    MAX_MULTI_CHART_SLOTS,
  );
  return defaults.map((fallbackTicker, index) =>
    hydrateMiniChartSlot(
      persisted[index],
      fallbackTicker,
      _initialState.marketGridIndicatorPresetVersion !==
        MARKET_GRID_INDICATOR_PRESET_VERSION,
    ),
  );
};

const MARKET_CHART_INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[data-chart-control-root]",
  "[data-grid-resize-handle]",
  "[data-radix-popper-content-wrapper]",
  "[data-testid='ticker-search-popover']",
].join(",");

const isMarketChartInteractiveTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest(MARKET_CHART_INTERACTIVE_TARGET_SELECTOR));

const isMarketChartPlotTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest("[data-chart-plot-root]"));
const MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE = 6;

const TICKER_SEARCH_MARKET_FILTERS = [
  { value: "all", label: "All", markets: null },
  { value: "stocks", label: "Stocks", markets: ["stocks"] },
  { value: "etf", label: "ETF", markets: ["etf"] },
  { value: "indices", label: "Index", markets: ["indices"] },
  { value: "futures", label: "Futures", markets: ["futures"] },
  { value: "fx", label: "FX", markets: ["fx"] },
  { value: "crypto", label: "Crypto", markets: ["crypto"] },
];
const TICKER_SEARCH_MARKET_BY_VALUE = Object.fromEntries(
  TICKER_SEARCH_MARKET_FILTERS.map((filter) => [filter.value, filter]),
);
const TICKER_SEARCH_INITIAL_RESULT_LIMIT = 24;
const TICKER_SEARCH_RESULT_INCREMENT = 24;
const TICKER_SEARCH_SERVER_RESULT_BUFFER = 16;
const TICKER_SEARCH_CACHE_LIMIT = 500;
const TICKER_SEARCH_QUICK_PICK_LIMIT = 12;

const normalizeTickerSearchQuery = (value) =>
  value?.trim?.().replace?.(/^[\s$^]+/, "").toLowerCase?.() || "";
const normalizeTickerSearchMarketFilter = (value) =>
  TICKER_SEARCH_MARKET_BY_VALUE[value] ? value : "all";

const buildTickerSearchRowKey = (result) =>
  [
    normalizeTickerSymbol(result?.ticker),
    result?.market || "",
    result?.normalizedExchangeMic ||
      result?.primaryExchange?.trim?.().toUpperCase?.() ||
      "",
    result?.providerContractId || "",
  ].join("|");

const getTickerSearchRowStorageKey = (result) =>
  [
    normalizeTickerSymbol(result?.ticker),
    result?.market || "",
    result?.normalizedExchangeMic ||
      result?.primaryExchange?.trim?.().toUpperCase?.() ||
      "",
  ].join("|");

const isApiBackedTickerSearchRow = (result) =>
  Boolean(
    result &&
      normalizeTickerSymbol(result.ticker) &&
      result.market &&
      Array.isArray(result.providers) &&
      result.providers.length,
  );

const normalizeTickerSearchResultForStorage = (result) => {
  if (!isApiBackedTickerSearchRow(result)) return null;
  const ticker = normalizeTickerSymbol(result.ticker);
  return {
    ticker,
    name: result.name || ticker,
    market: result.market,
    rootSymbol: result.rootSymbol || ticker,
    normalizedExchangeMic:
      result.normalizedExchangeMic || result.primaryExchange || null,
    exchangeDisplay:
      result.exchangeDisplay || result.primaryExchange || result.normalizedExchangeMic || null,
    logoUrl: result.logoUrl || null,
    countryCode: result.countryCode || null,
    exchangeCountryCode: result.exchangeCountryCode || null,
    sector: result.sector || null,
    industry: result.industry || null,
    contractDescription: result.contractDescription || result.name || ticker,
    contractMeta: result.contractMeta || null,
    locale: result.locale || null,
    type: result.type || null,
    active: result.active !== false,
    primaryExchange: result.primaryExchange || result.exchangeDisplay || null,
    currencyName: result.currencyName || null,
    cik: result.cik || null,
    compositeFigi: result.compositeFigi || null,
    shareClassFigi: result.shareClassFigi || null,
    lastUpdatedAt: result.lastUpdatedAt || null,
    provider: result.provider || result.tradeProvider || result.providers[0] || null,
    providers: [...new Set(result.providers.filter(Boolean))],
    tradeProvider: result.tradeProvider || null,
    dataProviderPreference: result.dataProviderPreference || result.provider || null,
    providerContractId: result.providerContractId || null,
  };
};

const normalizePersistedTickerSearchRows = (rows, limit = Number.POSITIVE_INFINITY) => {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map(normalizeTickerSearchResultForStorage)
    .filter(Boolean);
  return Number.isFinite(limit) ? normalized.slice(0, limit) : normalized;
};

const buildTickerSearchCache = (...rowLists) => {
  const cache = {};
  for (const row of rowLists.flat()) {
    const normalized = normalizeTickerSearchResultForStorage(row);
    if (!normalized) continue;
    const storageKey = getTickerSearchRowStorageKey(normalized);
    const symbolKey = normalizeTickerSymbol(normalized.ticker);
    if (!cache[storageKey]) cache[storageKey] = normalized;
    if (symbolKey && !cache[symbolKey]) cache[symbolKey] = normalized;
  }
  return cache;
};

const getTickerSearchCachedRow = (cache, symbol) => {
  const normalized = normalizeTickerSymbol(symbol);
  return normalized ? cache?.[normalized] || null : null;
};

const compactTickerSearchCacheRows = (
  cache,
  limit = TICKER_SEARCH_CACHE_LIMIT,
) => {
  const rows = [];
  const seen = new Set();
  for (const value of Object.values(cache || {})) {
    const normalized = normalizeTickerSearchResultForStorage(value);
    if (!normalized) continue;
    const key = getTickerSearchRowStorageKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
    if (Number.isFinite(limit) && rows.length >= limit) break;
  }
  return rows;
};

const mergeTickerSearchCacheRows = (
  currentCache,
  rows,
  limit = TICKER_SEARCH_CACHE_LIMIT,
) => {
  const incomingRows = normalizePersistedTickerSearchRows(rows, limit);
  if (!incomingRows.length) {
    return currentCache || {};
  }

  const mergedRows = [
    ...incomingRows,
    ...compactTickerSearchCacheRows(currentCache, limit),
  ];
  return buildTickerSearchCache(
    Number.isFinite(limit) ? mergedRows.slice(0, limit) : mergedRows,
  );
};

const buildTickerSearchAliases = (result) => {
  const normalizedTicker = normalizeTickerSymbol(result?.ticker);
  const withoutProviderPrefix = normalizedTicker.replace(/^[A-Z]:/, "");
  const aliases = new Set([
    normalizedTicker,
    withoutProviderPrefix,
    normalizeTickerSymbol(result?.rootSymbol),
  ]);

  if (result?.market === "crypto" && withoutProviderPrefix.endsWith("USD")) {
    aliases.add(withoutProviderPrefix.slice(0, -3));
  }
  if (result?.market === "crypto" && withoutProviderPrefix && !withoutProviderPrefix.endsWith("USD")) {
    aliases.add(`${withoutProviderPrefix}USD`);
  }
  if (result?.market === "fx" && /^[A-Z]{3}$/.test(withoutProviderPrefix)) {
    aliases.add(`${withoutProviderPrefix}USD`);
    aliases.add(`${withoutProviderPrefix}.USD`);
  }
  if (/^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(withoutProviderPrefix)) {
    aliases.add(withoutProviderPrefix.replace(".", " "));
    aliases.add(withoutProviderPrefix.replace(".", ""));
  }

  return Array.from(aliases).filter(Boolean);
};

const TICKER_SEARCH_US_PRIMARY_EXCHANGE_SCORES = {
  XNAS: 680,
  XNYS: 660,
  ARCX: 640,
  XASE: 520,
  BATS: 500,
};
const TICKER_SEARCH_FX_CURRENCY_CODES = new Set([
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNH",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);
const TICKER_SEARCH_INDEX_HINTS = new Set([
  "DJI",
  "DOW",
  "MID",
  "NDX",
  "NYA",
  "OEX",
  "RUA",
  "RUT",
  "RVX",
  "SKEW",
  "SOX",
  "SPX",
  "VIX",
  "VXN",
  "XAU",
]);
const TICKER_SEARCH_CRYPTO_HINTS = new Set([
  "AAVE",
  "ADA",
  "ATOM",
  "AVAX",
  "BCH",
  "BTC",
  "DOGE",
  "DOT",
  "ETC",
  "ETH",
  "LINK",
  "LTC",
  "MATIC",
  "SHIB",
  "SOL",
  "UNI",
  "XLM",
  "XRP",
]);
const TICKER_SEARCH_FUTURES_HINTS = new Set([
  "6A",
  "6B",
  "6C",
  "6E",
  "6J",
  "6N",
  "6S",
  "CL",
  "ES",
  "GC",
  "GF",
  "HE",
  "HG",
  "HO",
  "KE",
  "LE",
  "M2K",
  "M6E",
  "MCL",
  "MES",
  "MGC",
  "MNQ",
  "MYM",
  "NG",
  "NQ",
  "PA",
  "PL",
  "RB",
  "RTY",
  "SI",
  "UB",
  "YM",
  "ZB",
  "ZC",
  "ZF",
  "ZL",
  "ZM",
  "ZN",
  "ZS",
  "ZT",
  "ZW",
]);

const normalizeTickerSearchHintQuery = (query) =>
  normalizeTickerSymbol(query).replace(/^[\s$^]+/, "").replace(/[ ./-]/g, "");

const isTickerSearchFxHint = (query) => {
  const normalized = normalizeTickerSearchHintQuery(query);
  if (TICKER_SEARCH_FX_CURRENCY_CODES.has(normalized)) return true;
  if (!/^[A-Z]{6}$/.test(normalized)) return false;
  return (
    TICKER_SEARCH_FX_CURRENCY_CODES.has(normalized.slice(0, 3)) &&
    TICKER_SEARCH_FX_CURRENCY_CODES.has(normalized.slice(3))
  );
};

const isTickerSearchIndexHint = (query) =>
  TICKER_SEARCH_INDEX_HINTS.has(normalizeTickerSearchHintQuery(query));

const isTickerSearchCryptoHint = (query) => {
  const normalized = normalizeTickerSearchHintQuery(query).replace(/^X:/, "");
  if (TICKER_SEARCH_CRYPTO_HINTS.has(normalized)) return true;
  return (
    normalized.endsWith("USD") &&
    TICKER_SEARCH_CRYPTO_HINTS.has(normalized.slice(0, -3))
  );
};

const isTickerSearchFuturesHint = (query) =>
  TICKER_SEARCH_FUTURES_HINTS.has(normalizeTickerSearchHintQuery(query));

const isLikelyTickerSearchInput = (query) => {
  const normalized = normalizeTickerSearchHintQuery(query);
  if (!normalized) return false;
  if (normalized.length <= 4) return true;
  if (/[\d.:-]/.test(normalized)) return true;
  return (
    isTickerSearchFxHint(normalized) ||
    isTickerSearchIndexHint(normalized) ||
    isTickerSearchCryptoHint(normalized) ||
    isTickerSearchFuturesHint(normalized)
  );
};

const getTickerSearchMinQueryLength = (query) =>
  isLikelyTickerSearchInput(query) ? 1 : 2;

const getTickerSearchRequestLimit = (limit) =>
  Math.max(
    Math.floor(Number(limit) || TICKER_SEARCH_INITIAL_RESULT_LIMIT) +
      TICKER_SEARCH_SERVER_RESULT_BUFFER,
    TICKER_SEARCH_INITIAL_RESULT_LIMIT,
  );

const normalizeTickerSearchExchangeKey = (result) => {
  const raw = (
    result?.normalizedExchangeMic ||
    result?.primaryExchange ||
    result?.exchangeDisplay ||
    ""
  )
    .trim()
    .toUpperCase();

  if (!raw) return "";
  if (raw === "NASDAQ") return "XNAS";
  if (raw === "NYSE") return "XNYS";
  if (raw === "ARCA") return "ARCX";
  return raw;
};

const isTickerSearchUsExactMatchCandidate = (result) =>
  result?.market === "stocks" || result?.market === "etf" || result?.market === "otc";

const scoreTickerSearchResult = (
  result,
  { query, currentTicker, recentTickerSet, watchlistTickerSet, favoriteTickerSet },
) => {
  const normalizedTicker = normalizeTickerSymbol(result?.ticker);
  const normalizedName = result?.name?.trim?.().toLowerCase?.() || "";
  const tickerAliases = buildTickerSearchAliases(result);
  if (!query || !normalizedTicker) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const uppercaseQuery = query.toUpperCase();
  const exactTickerMatch =
    tickerAliases.includes(uppercaseQuery) || normalizedTicker === uppercaseQuery;
  const strongNamePrefixMatch =
    normalizedName === query || normalizedName.startsWith(query);
  if (exactTickerMatch) score += 3000;
  else if (normalizedTicker.startsWith(query.toUpperCase())) score += 1050;
  else if (normalizedTicker.includes(query.toUpperCase())) score += 780;

  if (normalizedName === query) score += 720;
  else if (normalizedName.startsWith(query)) score += 560;
  else if (
    normalizedName
      .split(/[\s./-]+/)
      .some((part) => part && part.startsWith(query))
  ) {
    score += 500;
  } else if (normalizedName.includes(query)) {
    score += 320;
  }

  if (!exactTickerMatch) {
    if (normalizedTicker === normalizeTickerSymbol(currentTicker)) score += 40;
    if (recentTickerSet.has(normalizedTicker)) score += 140;
    if (favoriteTickerSet.has(normalizedTicker)) score += 120;
    if (watchlistTickerSet.has(normalizedTicker)) score += 90;
  }
  if (result?.providers?.includes?.("ibkr")) score += 35;
  if (result?.providerContractId) score += 20;
  if (result?.normalizedExchangeMic || result?.primaryExchange) score += 10;

  if (strongNamePrefixMatch) {
    if (/^[A-Z]{1,6}$/.test(normalizedTicker)) score += 180;
    if (/^\d/.test(normalizedTicker)) score -= 260;
    if (isTickerSearchUsExactMatchCandidate(result)) {
      score +=
        TICKER_SEARCH_US_PRIMARY_EXCHANGE_SCORES[
          normalizeTickerSearchExchangeKey(result)
        ] || 0;
      if (result?.providers?.includes?.("ibkr")) score += 160;
      if (result?.providerContractId) score += 120;
    }
  }

  if (exactTickerMatch) {
    if (result?.market === "fx" && isTickerSearchFxHint(uppercaseQuery)) score += 1500;
    if (result?.market === "crypto" && isTickerSearchCryptoHint(uppercaseQuery)) score += 1500;
    if (result?.market === "indices" && isTickerSearchIndexHint(uppercaseQuery)) score += 1500;
    if (result?.market === "futures" && isTickerSearchFuturesHint(uppercaseQuery)) score += 1500;
  }

  if (exactTickerMatch && isTickerSearchUsExactMatchCandidate(result)) {
    score +=
      TICKER_SEARCH_US_PRIMARY_EXCHANGE_SCORES[
        normalizeTickerSearchExchangeKey(result)
      ] || 0;
    if (result?.providers?.includes?.("ibkr")) score += 220;
    if (result?.providerContractId) score += 180;
  }

  return score;
};

const buildTickerSearchContractLine = (result) => {
  const meta = result?.contractMeta || {};
  if (result?.market === "futures") {
    return [meta.expiry || meta.lastTradeDateOrContractMonth, meta.multiplier]
      .filter(Boolean)
      .join(" · ");
  }
  if (result?.market === "fx") {
    return result.currencyName ? `Quote currency ${result.currencyName}` : "Currency pair";
  }
  if (result?.market === "crypto") {
    return result.currencyName ? `Pair quoted in ${result.currencyName}` : "Crypto pair";
  }
  return result?.contractDescription && result.contractDescription !== result.name
    ? result.contractDescription
    : "";
};

const isTickerSearchIbkrTradable = (result) =>
  result?.tradeProvider === "ibkr" &&
  Boolean(result?.providerContractId) &&
  result?.providers?.includes?.("ibkr");

const TickerSearchRow = ({
  result,
  id,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
  onMouseEnter,
}) => {
  const disabled = result?._disabled || !isApiBackedTickerSearchRow(result);
  const providerLabel = isTickerSearchIbkrTradable(result)
    ? "IBKR"
    : result?.providers?.length
      ? "Data only"
      : "Resolve";
  const contractLine = buildTickerSearchContractLine(result);
  const reasonChips = Array.isArray(result?._reasons)
    ? result._reasons.filter(Boolean).slice(0, 3)
    : [];
  const identity = resolveMarketIdentity(result);

  return (
    <button
      key={buildTickerSearchRowKey(result)}
      id={id}
      role="option"
      aria-selected={active}
      data-testid="ticker-search-row"
      data-ticker={normalizeTickerSymbol(result?.ticker)}
      data-market={result?.market || ""}
      data-provider-contract-id={result?.providerContractId || ""}
      disabled={false}
      className={joinMotionClasses(
        "ra-row-enter",
        "ra-interactive",
        active && "ra-focus-rail",
      )}
      onClick={() => onSelect?.(result)}
      onMouseEnter={onMouseEnter}
      title={disabled ? "Search this symbol to resolve provider metadata" : undefined}
      style={{
        ...motionVars({ accent: T.accent }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "30px 1fr auto",
        gap: sp(8),
        alignItems: "center",
        padding: sp("8px 10px"),
        background: active ? T.bg3 : "transparent",
        border: "none",
        borderBottom: `1px solid ${T.border}20`,
        textAlign: "left",
        cursor: "pointer",
        opacity: disabled ? 0.62 : 1,
      }}
    >
      <MarketIdentityMark item={result} size={24} showMarketIcon />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(5),
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 800,
              fontFamily: T.sans,
              color: T.text,
            }}
          >
            {result?.ticker}
          </span>
          <MarketIdentityChips
            identity={identity}
            compact
            maxChips={3}
            showProvider={false}
            showSector={false}
          />
        </span>
        <span
          style={{
            display: "block",
            fontSize: fs(9),
            color: T.textSec,
            fontFamily: T.sans,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
            {identity.name || result?.contractDescription || "Search to resolve"}
        </span>
        {contractLine ? (
          <span
            style={{
              display: "block",
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.sans,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {contractLine}
          </span>
        ) : null}
        {reasonChips.length ? (
          <span
            style={{
              display: "flex",
              gap: sp(4),
              marginTop: sp(3),
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            {reasonChips.map((reason) => (
              <span
                key={reason}
                style={{
                  border: `1px solid ${T.border}80`,
                  color: T.textMuted,
                  fontSize: fs(7),
                  fontFamily: T.mono,
                  lineHeight: 1.15,
                  padding: sp("1px 4px"),
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {reason}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(5),
        }}
      >
        <span
          style={{
            fontSize: fs(7),
            color: disabled ? T.amber : T.textMuted,
            fontFamily: T.mono,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {disabled ? "Search" : providerLabel}
        </span>
        <span
          role="button"
          tabIndex={-1}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) onToggleFavorite?.(result);
          }}
          style={{
            color: favorite ? T.amber : T.textMuted,
            fontSize: fs(12),
            cursor: disabled ? "default" : "pointer",
            lineHeight: 1,
          }}
        >
          {favorite ? "★" : "☆"}
        </span>
      </span>
    </button>
  );
};

const TickerSearchSkeletonRows = () => (
  <div style={{ padding: sp("4px 0") }}>
    {[0, 1, 2].map((index) => (
      <div
        key={index}
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr auto",
          gap: sp(8),
          alignItems: "center",
          padding: sp("8px 10px"),
          borderBottom: `1px solid ${T.border}20`,
        }}
      >
        <span
          style={{
            width: dim(24),
            height: dim(24),
            borderRadius: 999,
            background: T.bg3,
          }}
        />
        <span>
          <span
            style={{
              display: "block",
              height: dim(8),
              width: `${58 + index * 10}%`,
              background: T.bg3,
              marginBottom: 5,
            }}
          />
          <span
            style={{
              display: "block",
              height: dim(7),
              width: `${72 - index * 8}%`,
              background: T.bg2,
            }}
          />
        </span>
        <span style={{ width: dim(42), height: dim(8), background: T.bg3 }} />
      </div>
    ))}
  </div>
);

const buildUnresolvedTickerSearchRow = (symbol, group) => {
  const ticker = normalizeTickerSymbol(symbol);
  return {
    ticker,
    name: DEFAULT_WATCHLIST_BY_SYMBOL[ticker]?.name || "Search to resolve provider",
    market: "stocks",
    rootSymbol: ticker,
    normalizedExchangeMic: null,
    exchangeDisplay: null,
    logoUrl: null,
    countryCode: null,
    exchangeCountryCode: null,
    sector: null,
    industry: null,
    contractDescription: null,
    contractMeta: null,
    locale: null,
    type: null,
    active: true,
    primaryExchange: null,
    currencyName: null,
    cik: null,
    compositeFigi: null,
    shareClassFigi: null,
    lastUpdatedAt: null,
    provider: null,
    providers: [],
    tradeProvider: null,
    dataProviderPreference: null,
    providerContractId: null,
    _group: group,
    _disabled: true,
  };
};

const isIgnorableTickerSearchError = (error) => {
  if (!error) return false;

  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";
  const code =
    typeof error?.data?.code === "string" ? error.data.code.toLowerCase() : "";
  const name = typeof error?.name === "string" ? error.name.toLowerCase() : "";
  const causeName =
    typeof error?.cause?.name === "string" ? error.cause.name.toLowerCase() : "";

  return (
    error?.status === 499 ||
    code === "ticker_search_aborted" ||
    name === "aborterror" ||
    causeName === "aborterror" ||
    name === "cancellederror" ||
    message.includes("aborted") ||
    message.includes("canceled") ||
    message.includes("cancelled")
  );
};

const useDebouncedTickerSearchQuery = (query) => {
  const trimmedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(trimmedQuery);
  const debounceDelayMs = isLikelyTickerSearchInput(trimmedQuery) ? 120 : 220;

  useEffect(() => {
    if (!trimmedQuery) {
      setDebouncedQuery("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, debounceDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [debounceDelayMs, trimmedQuery]);

  return debouncedQuery;
};

const useTickerSearchController = ({
  open,
  query,
  marketFilter,
  currentTicker,
  recentTickerRows = [],
  watchlistSymbols = [],
  favoriteRows = [],
  popularTickers = [],
  contextSymbols = [],
  flowSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  rowCache = {},
  limit = TICKER_SEARCH_INITIAL_RESULT_LIMIT,
}) => {
  const deferredQuery = useDeferredValue(query.trim());
  const debouncedQuery = useDebouncedTickerSearchQuery(deferredQuery);
  const normalizedQuery = normalizeTickerSearchQuery(debouncedQuery);
  const selectedFilter = TICKER_SEARCH_MARKET_BY_VALUE[marketFilter] || TICKER_SEARCH_MARKET_BY_VALUE.all;
  const minimumQueryLength = getTickerSearchMinQueryLength(debouncedQuery);
  const searchEnabled = open && normalizedQuery.length >= minimumQueryLength;
  const requestLimit = getTickerSearchRequestLimit(limit);
  const searchQuery = useSearchUniverseTickers(
    searchEnabled
      ? {
          search: debouncedQuery,
          ...(selectedFilter.markets ? { markets: selectedFilter.markets } : {}),
          active: true,
          limit: requestLimit,
        }
      : undefined,
    {
      query: {
        enabled: searchEnabled,
        staleTime: 30_000,
        placeholderData: (previousData) => previousData,
        retry: false,
      },
    },
  );
  const rawSearchResults = searchQuery.data?.results || [];
  const hasDisplayableSearchError =
    searchEnabled &&
    searchQuery.isError &&
    !isIgnorableTickerSearchError(searchQuery.error);

  const rankedResults = useMemo(() => {
    if (!searchEnabled) return [];

    const recentTickerSet = new Set(
      recentTickerRows.map((row) => normalizeTickerSymbol(row?.ticker)).filter(Boolean),
    );
    const watchlistTickerSet = new Set(
      watchlistSymbols.map((symbol) => normalizeTickerSymbol(symbol)).filter(Boolean),
    );
    const favoriteTickerSet = new Set(
      favoriteRows.map((row) => normalizeTickerSymbol(row?.ticker)).filter(Boolean),
    );

    return rawSearchResults
      .map((result) => ({
        ...result,
        _kind: "result",
        _score: scoreTickerSearchResult(result, {
          query: normalizedQuery,
          currentTicker,
          recentTickerSet,
          watchlistTickerSet,
          favoriteTickerSet,
        }),
      }))
      .filter((result) => Number.isFinite(result._score))
      .sort((left, right) => {
        if (right._score !== left._score) return right._score - left._score;
        return left.ticker.localeCompare(right.ticker);
      })
      .slice(0, limit);
  }, [
    currentTicker,
    favoriteRows,
    limit,
    normalizedQuery,
    recentTickerRows,
    searchEnabled,
    rawSearchResults,
    watchlistSymbols,
  ]);

  const quickPickGroups = useMemo(() => {
    if (searchEnabled) return [];
    const smartGroups = buildSmartTickerSuggestions({
      query: "",
      currentTicker,
      recentTickerRows,
      watchlistSymbols,
      favoriteRows,
      popularTickers,
      contextSymbols,
      flowSymbols: flowSuggestionSymbols,
      signalSymbols: signalSuggestionSymbols,
      rowCache,
      maxRows: TICKER_SEARCH_INITIAL_RESULT_LIMIT,
      maxRowsPerGroup: 5,
    });
    if (smartGroups.length) return smartGroups;

    const buildRows = (symbols, group, max = TICKER_SEARCH_QUICK_PICK_LIMIT) => {
      const uniqueSymbols = Array.from(
        new Set(symbols.map(normalizeTickerSymbol).filter(Boolean)),
      );
      return (Number.isFinite(max) ? uniqueSymbols.slice(0, max) : uniqueSymbols)
        .map((symbol) => {
          const cached = getTickerSearchCachedRow(rowCache, symbol);
          return cached
            ? { ...cached, _group: group, _kind: "quick-pick" }
            : buildUnresolvedTickerSearchRow(symbol, group);
        });
    };

    const recentRows = normalizePersistedTickerSearchRows(recentTickerRows, 8).map(
      (row) => ({ ...row, _group: "Recent", _kind: "quick-pick" }),
    );
    const favoriteGroupRows = normalizePersistedTickerSearchRows(favoriteRows, 8).map(
      (row) => ({ ...row, _group: "Favorites", _kind: "quick-pick" }),
    );
    const groups = [];
    if (favoriteGroupRows.length) groups.push({ label: "Favorites", rows: favoriteGroupRows });
    if (recentRows.length) groups.push({ label: "Recent", rows: recentRows });
    groups.push({ label: "Watchlist", rows: buildRows(watchlistSymbols, "Watchlist") });
    groups.push({ label: "Popular today", rows: buildRows(popularTickers, "Popular today") });
    return groups.filter((group) => group.rows.length);
  }, [
    favoriteRows,
    currentTicker,
    contextSymbols,
    flowSuggestionSymbols,
    popularTickers,
    recentTickerRows,
    rowCache,
    searchEnabled,
    signalSuggestionSymbols,
    watchlistSymbols,
  ]);

  const suggestionGroups = useMemo(() => {
    if (!searchEnabled) return [];
    return buildSmartTickerSuggestions({
      query: debouncedQuery,
      currentTicker,
      recentTickerRows,
      watchlistSymbols,
      favoriteRows,
      popularTickers,
      contextSymbols,
      flowSymbols: flowSuggestionSymbols,
      signalSymbols: signalSuggestionSymbols,
      liveResults: rankedResults,
      rowCache,
      maxRows: 5,
      maxRowsPerGroup: 5,
    });
  }, [
    currentTicker,
    debouncedQuery,
    favoriteRows,
    contextSymbols,
    flowSuggestionSymbols,
    popularTickers,
    rankedResults,
    recentTickerRows,
    rowCache,
    searchEnabled,
    signalSuggestionSymbols,
    watchlistSymbols,
  ]);

  const { prioritySuggestionGroups, secondarySuggestionGroups } = useMemo(() => {
    if (!searchEnabled || !suggestionGroups.length) {
      return { prioritySuggestionGroups: [], secondarySuggestionGroups: suggestionGroups };
    }

    const partitioned = suggestionGroups.reduce(
      (acc, group) => {
        const priorityRows = [];
        const secondaryRows = [];
        for (const row of group.rows) {
          const reasons = Array.isArray(row?._reasons) ? row._reasons : [];
          if (reasons.includes("Exact")) {
            priorityRows.push(row);
          } else {
            secondaryRows.push(row);
          }
        }
        if (priorityRows.length) {
          acc.prioritySuggestionGroups.push({ ...group, rows: priorityRows });
        }
        if (secondaryRows.length) {
          acc.secondarySuggestionGroups.push({ ...group, rows: secondaryRows });
        }
        return acc;
      },
      { prioritySuggestionGroups: [], secondarySuggestionGroups: [] },
    );

    return partitioned;
  }, [searchEnabled, suggestionGroups]);

  const prioritySuggestionRows = useMemo(
    () => flattenTickerSuggestionGroups(prioritySuggestionGroups),
    [prioritySuggestionGroups],
  );
  const secondarySuggestionRows = useMemo(
    () => flattenTickerSuggestionGroups(secondarySuggestionGroups),
    [secondarySuggestionGroups],
  );

  const selectableResults = searchEnabled
    ? [...prioritySuggestionRows, ...rankedResults, ...secondarySuggestionRows]
    : quickPickGroups.flatMap((group) => group.rows);

  return {
    deferredQuery: debouncedQuery,
    normalizedQuery,
    searchEnabled,
    searchQuery,
    hasDisplayableSearchError,
    quickPickGroups,
    suggestionGroups,
    prioritySuggestionGroups,
    secondarySuggestionGroups,
    results: rankedResults,
    selectableResults,
    rawResultCount: rawSearchResults.length,
    requestLimit,
    hasMoreResults:
      searchEnabled &&
      !hasDisplayableSearchError &&
      (rawSearchResults.length > rankedResults.length ||
        rawSearchResults.length >= requestLimit),
  };
};

export const MiniChartTickerSearch = ({
  open,
  ticker,
  recentTickerRows = [],
  watchlistSymbols = [],
  popularTickers = [],
  contextSymbols = [],
  flowSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  embedded = false,
  strictTradeResolution = false,
  onClose,
  onSelectTicker,
  onRememberTickerRow,
}) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxIdRef = useRef(
    `ticker-search-listbox-${Math.random().toString(36).slice(2)}`,
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [marketFilter, setMarketFilter] = useState(() =>
    normalizeTickerSearchMarketFilter(_initialState.marketGridTickerSearchMarketFilter),
  );
  const [visibleResultLimit, setVisibleResultLimit] = useState(
    TICKER_SEARCH_INITIAL_RESULT_LIMIT,
  );
  const [favoriteRows, setFavoriteRows] = useState(() =>
    normalizePersistedTickerSearchRows(_initialState.marketGridTickerSearchFavorites),
  );
  const [rowCache, setRowCache] = useState(() =>
    buildTickerSearchCache(
      normalizePersistedTickerSearchRows(_initialState.marketGridTickerSearchCache),
      recentTickerRows,
      favoriteRows,
    ),
  );
  const {
    deferredQuery,
    searchEnabled,
    searchQuery,
    hasDisplayableSearchError,
    quickPickGroups,
    prioritySuggestionGroups,
    secondarySuggestionGroups,
    results,
    selectableResults,
    rawResultCount,
    hasMoreResults,
  } = useTickerSearchController({
    open,
    query,
    marketFilter,
    currentTicker: ticker,
    recentTickerRows,
    watchlistSymbols,
    favoriteRows,
    popularTickers,
    contextSymbols,
    flowSuggestionSymbols,
    signalSuggestionSymbols,
    rowCache,
    limit: visibleResultLimit,
  });
  const hasLiveResults = searchEnabled && results.length > 0;
  const prioritySuggestionRowCount =
    flattenTickerSuggestionGroups(prioritySuggestionGroups).length;
  const secondarySuggestionRowCount =
    flattenTickerSuggestionGroups(secondarySuggestionGroups).length;
  const suggestionRowCount =
    prioritySuggestionRowCount + secondarySuggestionRowCount;
  const showLoadingSkeleton =
    searchEnabled && searchQuery.isPending && !hasLiveResults && !suggestionRowCount;
  const showUpdatingState =
    searchEnabled && searchQuery.isFetching && (hasLiveResults || suggestionRowCount > 0);

  useEffect(() => {
    persistState({ marketGridTickerSearchMarketFilter: marketFilter });
  }, [marketFilter]);

  useEffect(() => {
    persistState({ marketGridTickerSearchFavorites: favoriteRows });
  }, [favoriteRows]);

  useEffect(() => {
    const rows = (searchQuery.data?.results || [])
      .map(normalizeTickerSearchResultForStorage)
      .filter(Boolean);
    if (!rows.length) return;

    setRowCache((current) => {
      const next = mergeTickerSearchCacheRows(current, rows);
      persistState({
        marketGridTickerSearchCache: compactTickerSearchCacheRows(next),
      });
      return next;
    });
  }, [searchQuery.data?.results]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, ticker]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, deferredQuery, selectableResults.length]);

  useEffect(() => {
    setVisibleResultLimit(TICKER_SEARCH_INITIAL_RESULT_LIMIT);
  }, [deferredQuery, marketFilter, open]);

  useEffect(() => {
    if (embedded || !open || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      onClose?.();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [embedded, onClose, open]);

  const handleCycleMarketFilter = useCallback((direction = 1) => {
    setMarketFilter((current) => {
      const index = TICKER_SEARCH_MARKET_FILTERS.findIndex(
        (filter) => filter.value === current,
      );
      const nextIndex =
        (Math.max(0, index) + direction + TICKER_SEARCH_MARKET_FILTERS.length) %
        TICKER_SEARCH_MARKET_FILTERS.length;
      return TICKER_SEARCH_MARKET_FILTERS[nextIndex].value;
    });
  }, []);

  const handleToggleFavorite = useCallback((result) => {
    const normalized = normalizeTickerSearchResultForStorage(result);
    if (!normalized) return;
    const key = getTickerSearchRowStorageKey(normalized);
    setFavoriteRows((current) => {
      const exists = current.some((row) => getTickerSearchRowStorageKey(row) === key);
      return exists
        ? current.filter((row) => getTickerSearchRowStorageKey(row) !== key)
        : [normalized, ...current];
    });
  }, []);

  const handleLoadMoreResults = useCallback(() => {
    setVisibleResultLimit((current) => current + TICKER_SEARCH_RESULT_INCREMENT);
  }, []);

  const handleSelect = useCallback(
    (result) => {
      if (!result) {
        return;
      }
      if (!isApiBackedTickerSearchRow(result)) {
        setQuery(normalizeTickerSymbol(result._resolutionQuery || result.ticker));
        return;
      }
      const normalized = normalizeTickerSearchResultForStorage(result);
      if (!normalized) return;
      if (!strictTradeResolution) {
        onRememberTickerRow?.(normalized);
      }
      onSelectTicker?.(normalized, {
        query: searchEnabled ? query || deferredQuery : "",
        searchEnabled,
        strictTradeResolution,
      });
    },
    [
      deferredQuery,
      onRememberTickerRow,
      onSelectTicker,
      query,
      searchEnabled,
      strictTradeResolution,
    ],
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length
            ? Math.min(current + 1, selectableResults.length - 1)
            : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length ? Math.max(current - 1, 0) : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        if (selectableResults[activeIndex]) {
          event.preventDefault();
          handleSelect(selectableResults[activeIndex]);
        }
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        handleCycleMarketFilter(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    },
    [activeIndex, handleCycleMarketFilter, handleSelect, onClose, selectableResults],
  );

  const renderTickerSearchGroups = (groups, startIndex = 0) => {
    let baseIndex = startIndex;
    return groups.map((group) => {
      const groupBaseIndex = baseIndex;
      baseIndex += group.rows.length;
      return (
        <div key={group.label}>
          <div
            style={{
              padding: sp("7px 10px 3px"),
              fontSize: fs(8),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {group.label}
          </div>
          {group.rows.map((result, offset) => {
            const index = groupBaseIndex + offset;
            return (
              <TickerSearchRow
                key={`${group.label}-${buildTickerSearchRowKey(result)}`}
                id={`${listboxIdRef.current}-option-${index}`}
                result={result}
                active={index === activeIndex}
                favorite={favoriteRows.some(
                  (row) =>
                    getTickerSearchRowStorageKey(row) ===
                    getTickerSearchRowStorageKey(result),
                )}
                onSelect={handleSelect}
                onToggleFavorite={handleToggleFavorite}
                onMouseEnter={() => setActiveIndex(index)}
              />
            );
          })}
        </div>
      );
    });
  };

  if (!open) {
    return null;
  }

  const searchPanel = (
    <div
      className="ra-popover-enter"
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: 0,
        boxShadow: "0 18px 36px rgba(0,0,0,0.32)",
        overflow: "hidden",
      }}
      >
      <div
        style={{
          display: "flex",
          gap: sp(4),
          padding: sp("7px 8px 0"),
          flexWrap: "wrap",
          background: T.bg2,
        }}
      >
        {TICKER_SEARCH_MARKET_FILTERS.map((filter) => {
          const active = marketFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              data-testid={`ticker-search-filter-${filter.value}`}
              aria-pressed={active}
              className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
              onClick={() => setMarketFilter(filter.value)}
              style={{
                ...motionVars({ accent: T.accent }),
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? `${T.accent}20` : T.bg1,
                color: active ? T.accent : T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
                padding: sp("2px 6px"),
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(6),
          padding: sp("8px 8px 6px"),
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <input
          ref={inputRef}
          data-testid="ticker-search-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxIdRef.current}
          aria-autocomplete="list"
          aria-activedescendant={
            selectableResults[activeIndex]
              ? `${listboxIdRef.current}-option-${activeIndex}`
              : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={`Search symbol or company for ${ticker}…`}
          style={{
            width: "100%",
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            padding: sp("6px 8px"),
            color: T.text,
            fontSize: fs(10),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <button
          type="button"
          className="ra-interactive"
          onClick={onClose}
          title="Close search"
          style={{
            background: "transparent",
            border: "none",
            color: T.textMuted,
            cursor: "pointer",
            fontSize: fs(12),
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div
        id={listboxIdRef.current}
        role="listbox"
        style={{ maxHeight: dim(260), overflowY: "auto", background: T.bg1 }}
      >
        {!searchEnabled ? renderTickerSearchGroups(quickPickGroups) : null}
        {searchEnabled && prioritySuggestionGroups.length
          ? renderTickerSearchGroups(prioritySuggestionGroups)
          : null}
        {showLoadingSkeleton && (
          <TickerSearchSkeletonRows />
        )}
        {showUpdatingState ? (
          <div
            style={{
              padding: sp("6px 10px 0"),
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Updating…
          </div>
        ) : null}
        {hasDisplayableSearchError && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: sp(8),
              padding: sp("10px"),
              fontSize: fs(9),
              color: T.amber,
              fontFamily: T.sans,
              background: `${T.amber}10`,
            }}
          >
            <span>Search failed</span>
            <button
              type="button"
              className="ra-interactive"
              onClick={() => searchQuery.refetch()}
              style={{
                border: `1px solid ${T.amber}`,
                background: "transparent",
                color: T.amber,
                fontFamily: T.mono,
                fontSize: fs(8),
                cursor: "pointer",
                padding: sp("2px 6px"),
              }}
            >
              retry
            </button>
          </div>
        )}
        {searchEnabled &&
        !showLoadingSkeleton &&
        !hasDisplayableSearchError &&
        !results.length &&
        !suggestionRowCount ? (
          <div
            style={{
              padding: sp("12px 10px"),
              fontSize: fs(9),
              color: T.textDim,
              fontFamily: T.sans,
            }}
          >
            No results for "{deferredQuery}".
          </div>
        ) : null}
        {searchEnabled && !hasDisplayableSearchError && results.length ? (
          <div
            style={{
              padding: sp("6px 10px 4px"),
              fontSize: fs(8),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Live matches
          </div>
        ) : null}
        {searchEnabled &&
          !hasDisplayableSearchError &&
          results.map((result, index) => (
            <TickerSearchRow
              key={buildTickerSearchRowKey(result)}
              id={`${listboxIdRef.current}-option-${prioritySuggestionRowCount + index}`}
              result={result}
              active={prioritySuggestionRowCount + index === activeIndex}
              favorite={favoriteRows.some(
                (row) =>
                  getTickerSearchRowStorageKey(row) ===
                  getTickerSearchRowStorageKey(result),
              )}
              onSelect={handleSelect}
              onToggleFavorite={handleToggleFavorite}
              onMouseEnter={() => setActiveIndex(prioritySuggestionRowCount + index)}
            />
          ))}
        {searchEnabled && secondarySuggestionGroups.length
          ? renderTickerSearchGroups(
              secondarySuggestionGroups,
              prioritySuggestionRowCount + results.length,
            )
          : null}
        {searchEnabled && !hasDisplayableSearchError && hasLiveResults && hasMoreResults ? (
          <button
            type="button"
            className="ra-interactive"
            onClick={handleLoadMoreResults}
            style={{
              width: "100%",
              border: "none",
              borderTop: `1px solid ${T.border}`,
              background: T.bg2,
              color: T.accent,
              cursor: "pointer",
              fontFamily: T.mono,
              fontSize: fs(8),
              padding: sp("8px 10px"),
              textTransform: "uppercase",
            }}
          >
            Load more matches ({results.length}/{rawResultCount}+)
          </button>
        ) : null}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div
        data-testid="ticker-search-popover"
        ref={rootRef}
        className="ra-popover-enter"
        onClick={(event) => event.stopPropagation()}
      >
        {searchPanel}
      </div>
    );
  }

  return (
    <div
      data-testid="ticker-search-popover"
      ref={rootRef}
      className="ra-popover-enter"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: dim(34),
        left: sp(6),
        right: sp(6),
        zIndex: 12,
      }}
    >
      {searchPanel}
    </div>
  );
};

export function TickerSearchLab() {
  const [selectedTicker, setSelectedTicker] = useState("SPY");
  const [selectedRow, setSelectedRow] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const popularTickers = ["SPY", "QQQ", "IWM", "AAPL", "NVDA", "MSFT", "TSLA", "AMD"];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg0,
        color: T.text,
        fontFamily: T.sans,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(24),
      }}
    >
      <style>{FONT_CSS}</style>
      <div
        style={{
          width: dim(640),
          minHeight: dim(280),
          position: "relative",
          background: T.bg1,
          border: `1px solid ${T.border}`,
          boxShadow: "0 18px 45px rgba(0,0,0,0.22)",
          padding: sp(16),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            marginBottom: sp(14),
          }}
        >
          <div
            style={{
              fontSize: fs(13),
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Ticker Search Lab
          </div>
          <div
            style={{
              fontSize: fs(10),
              color: T.textDim,
            }}
          >
            Real IBKR-backed ticker search, isolated from the rest of the platform.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(12),
            marginBottom: sp(12),
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(9),
                color: T.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: sp(3),
              }}
            >
              Selected
            </div>
            <div
              data-testid="ticker-search-selected"
              title={`Search ${selectedTicker}`}
              style={{
                fontSize: fs(16),
                fontWeight: 800,
                color: T.text,
                fontFamily: T.mono,
              }}
            >
              {selectedTicker}
            </div>
            {selectedRow?.providerContractId ? (
              <div
                style={{
                  marginTop: sp(4),
                  fontSize: fs(9),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                conid {selectedRow.providerContractId}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            data-testid="chart-symbol-search-button"
            title={`Search ${selectedTicker}`}
            onClick={() => setSearchOpen(true)}
            style={{
              border: `1px solid ${T.accent}`,
              background: `${T.accent}18`,
              color: T.accent,
              padding: sp("8px 12px"),
              fontSize: fs(10),
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Search Symbol
          </button>
        </div>

        <div
          style={{
            fontSize: fs(10),
            color: T.textDim,
            lineHeight: 1.5,
            maxWidth: dim(460),
          }}
        >
          Search by ticker or company name. Enter selects the top live row; click selects any
          visible row. The popover below uses the same live search component as the chart grid.
        </div>

        <MiniChartTickerSearch
          open={searchOpen}
          ticker={selectedTicker}
          recentTickerRows={selectedRow ? [selectedRow] : []}
          watchlistSymbols={popularTickers}
          popularTickers={popularTickers}
          onClose={() => setSearchOpen(false)}
          onSelectTicker={(result) => {
            const nextTicker = normalizeTickerSymbol(result?.ticker);
            const normalized = normalizeTickerSearchResultForStorage(result);
            if (!nextTicker || !normalized) {
              return;
            }
            setSelectedTicker(nextTicker);
            setSelectedRow(normalized);
            setSearchOpen(false);
          }}
          onRememberTickerRow={(row) => setSelectedRow(row)}
        />
      </div>
    </div>
  );
}

const PremiumFlowSparkline = ({ timeline = [], color, dense = false }) => {
  const width = 96;
  const height = dense ? 14 : 18;
  const values = (timeline || [])
    .map((point) => point?.value)
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: dense ? dim(56) : dim(76),
          height,
          borderBottom: `1px solid ${T.borderLight}`,
          opacity: 0.5,
        }}
      />
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      width={dense ? dim(56) : dim(76)}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const formatSignedPremiumFlow = (value) => {
  const numeric = Number.isFinite(value) ? value : 0;
  const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}${fmtM(Math.abs(numeric))}`;
};

const PremiumFlowStatusGlyph = ({ state, dense = false, color }) => {
  const size = dense ? 7 : 8;
  if (state?.isScanning) {
    return (
      <span
        aria-hidden="true"
        data-premium-flow-glyph
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          border: `1px solid ${T.borderLight}`,
          borderTopColor: color,
          borderRightColor: color,
          borderRadius: "50%",
          animation: "premiumFlowSpin 760ms linear infinite",
        }}
      />
    );
  }

  if (state?.isQueued) {
    return (
      <span
        aria-hidden="true"
        data-premium-flow-glyph
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          background: color,
          borderRadius: "50%",
          opacity: 0.5,
          animation: "premiumFlowPulse 1200ms ease-in-out infinite",
        }}
      />
    );
  }

  return null;
};

const MiniChartPremiumFlowIndicator = ({
  symbol,
  summary,
  flowStatus,
  providerSummary,
  dense = false,
  compact = false,
}) => {
  const resolvedSummary = summary || EMPTY_PREMIUM_FLOW_SUMMARY;
  const normalizedSymbol = normalizeTickerSymbol(symbol);
  const tone =
    resolvedSummary.direction === "call"
      ? T.green
      : resolvedSummary.direction === "put"
        ? T.red
        : T.textMuted;
  const displayState = resolvePremiumFlowDisplayState({
    symbol: normalizedSymbol,
    summary: resolvedSummary,
    flowStatus,
    providerSummary,
  });
  const statusLabel = displayState.label;
  const statusTone = displayState.isError
    ? T.red
    : displayState.isStale
      ? T.amber
      : displayState.isScanning
        ? T.accent
        : T.textDim;
  const hasFlow = resolvedSummary.eventCount > 0;
  const callPct = !hasFlow
    ? 50
    : resolvedSummary.puts <= 0
      ? 100
      : resolvedSummary.calls <= 0
        ? 0
        : Math.min(92, Math.max(8, Math.round(resolvedSummary.callShare * 100)));
  const putPct = hasFlow ? 100 - callPct : 50;
  const height = compact || dense ? 32 : 52;
  const latestLabel = resolvedSummary.latestOccurredAt
    ? formatRelativeTimeShort(resolvedSummary.latestOccurredAt)
    : null;
  const titleDetail = displayState.errorMessage
    ? ` · ${displayState.errorMessage}`
    : "";
  const compactStatusLabel =
    statusLabel === "IBKR snapshot live"
      ? "IBKR live"
      : statusLabel === "Premium flow"
        ? "Flow"
        : statusLabel === "Snapshot prem"
          ? "Snapshot"
          : statusLabel;

  return (
    <div
      data-chart-control-root
      data-testid="market-premium-flow-strip"
      style={{
        height,
        flexShrink: 0,
        borderTop: `1px solid ${T.border}`,
        background: T.bg2,
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
        gridTemplateRows: dense || compact ? "1fr 5px" : "1fr 6px 1fr",
        gap: dense ? 2 : 3,
        alignItems: "center",
        padding: dense ? "3px 6px" : "4px 8px",
        fontFamily: T.mono,
        overflow: "hidden",
      }}
      title={`${normalizedSymbol} options premium flow: ${formatSignedPremiumFlow(
        resolvedSummary.netPremium,
      )} · ${statusLabel}${titleDetail}`}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(5),
          minWidth: 0,
          color: T.textSec,
          fontSize: fs(dense ? 8 : 9),
          fontWeight: 800,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={{ color: T.textMuted }}>FLOW</span>
        <PremiumFlowStatusGlyph
          state={displayState}
          dense={dense}
          color={statusTone}
        />
        <span
          style={{
            color: tone,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {formatSignedPremiumFlow(resolvedSummary.netPremium)}
        </span>
        <span
          role="status"
          aria-live="polite"
          aria-label={`${normalizedSymbol} options premium flow ${statusLabel}`}
          style={{
            color: statusTone,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {compact ? compactStatusLabel : statusLabel}
        </span>
      </div>
      {!compact ? (
        <PremiumFlowSparkline
          timeline={resolvedSummary.timeline}
          color={tone}
          dense={dense}
        />
      ) : null}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          height: dense ? 5 : 6,
          background: T.bg0,
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: `${callPct}%`,
            background: hasFlow ? T.green : T.border,
            opacity: hasFlow ? 0.78 : 0.45,
          }}
        />
        <span
          aria-hidden="true"
          style={{
            width: `${putPct}%`,
            background: hasFlow ? T.red : T.borderLight,
            opacity: hasFlow ? 0.78 : 0.45,
          }}
        />
      </div>
      {!dense && !compact ? (
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            justifyContent: "space-between",
            gap: sp(6),
            minWidth: 0,
            color: T.textDim,
            fontSize: fs(8),
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            C {fmtM(resolvedSummary.calls)} / P {fmtM(resolvedSummary.puts)}
          </span>
          <span>
            {resolvedSummary.eventCount} evt
            {resolvedSummary.unusualCount ? ` / ${resolvedSummary.unusualCount} unusual` : ""}
            {latestLabel ? ` / ${latestLabel}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
};

// ─── MINI CHART CELL ───
// Single chart cell for the multi-chart grid. Compact: ticker header, candles, volume strip.
const MiniChartCell = ({
  slot,
  quote,
  premiumFlowSummary,
  chartEvents = [],
  premiumFlowStatus,
  premiumFlowProviderSummary,
  onFocus,
  onEnterSoloMode,
  onChangeTicker,
  onChangeTimeframe,
  favoriteTimeframes = [],
  onToggleFavoriteTimeframe,
  onChangeStudies,
  onChangeRayReplicaSettings,
  recentTickers = [],
  recentTickerRows = [],
  watchlistSymbols = [],
  popularTickers = [],
  smartSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  onRememberTicker,
  isActive,
  dense = false,
  compactFlow = false,
  stockAggregateStreamingEnabled = false,
  chartViewportIdentityKey = null,
  viewportSnapshot = null,
  onViewportSnapshotChange,
  onResetViewport,
}) => {
  const queryClient = useQueryClient();
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const ticker = slot?.ticker || WATCHLIST[0]?.sym || "SPY";
  const signalState = useSignalMonitorStateForSymbol(ticker);
  const slotMarket = slot?.market || "stocks";
  const hydratedTimeframe = normalizeChartTimeframe(slot?.tf);
  const tf = MINI_CHART_TIMEFRAMES.includes(hydratedTimeframe)
    ? hydratedTimeframe
    : "15m";
  const chartLimitRole = isActive ? "primary" : "mini";
  const currentBarsPriority = isActive
    ? BARS_REQUEST_PRIORITY.active
    : BARS_REQUEST_PRIORITY.visible;
  const selectedIndicators = normalizeMiniChartStudies(slot?.studies);
  const spotChartFrameLayout = resolveSpotChartFrameLayout(dense);
  const rayReplicaSettings = useMemo(
    () => resolvePersistedRayReplicaSettings(slot?.rayReplicaSettings),
    [slot?.rayReplicaSettings],
  );
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(null);
  const suppressNextFrameClickRef = useRef(false);
  const pendingPlotFocusRef = useRef(null);
  const prewarmedFavoriteTimeframesRef = useRef(null);
  const { drawings, addDrawing, clearDrawings } = useDrawingHistory();
  const fallbackInfo =
    DEFAULT_WATCHLIST_BY_SYMBOL[ticker] ||
    WATCHLIST.find((item) => item.sym === ticker) ||
    WATCHLIST[0];
  const chartIdentityItem = {
    ...(slot?.searchResult || {}),
    ticker,
    name: slot?.searchResult?.name || fallbackInfo?.name || ticker,
    market: slotMarket,
    exchangeDisplay:
      slot?.exchange || slot?.searchResult?.exchangeDisplay || slot?.searchResult?.primaryExchange,
    normalizedExchangeMic:
      slot?.searchResult?.normalizedExchangeMic || slot?.exchange || null,
    logoUrl: slot?.searchResult?.logoUrl || null,
    countryCode: slot?.searchResult?.countryCode || null,
    exchangeCountryCode: slot?.searchResult?.exchangeCountryCode || null,
    sector: slot?.searchResult?.sector || null,
    industry: slot?.searchResult?.industry || null,
  };
  const normalizedTimeframe = normalizeChartTimeframe(tf);
  const rollupBaseTimeframe = useMemo(
    () =>
      resolveLocalRollupBaseTimeframe(
        normalizedTimeframe,
        getChartBarLimit(tf, chartLimitRole),
        chartLimitRole,
      ),
    [chartLimitRole, normalizedTimeframe, tf],
  );
  const barsScopeKey = buildChartBarScopeKey(
    "market-mini-bars",
    ticker,
    slotMarket,
    slot?.providerContractId || null,
  );
  const baseBarsScopeKey = buildChartBarScopeKey(
    "market-mini-base-bars",
    ticker,
    slotMarket,
    slot?.providerContractId || null,
    rollupBaseTimeframe,
  );
  const chartHydrationScopeKey = buildChartBarScopeKey(
    "market-mini-chart",
    ticker,
    normalizedTimeframe,
    slotMarket,
    slot?.providerContractId || null,
  );
  useHydrationIntent({
    key: chartHydrationScopeKey,
    family: "chart-bars",
    label: `${ticker} ${normalizedTimeframe}`,
    priority: isActive ? "active" : "visible",
    active: Boolean(ticker),
    meta: {
      role: chartLimitRole,
      market: slotMarket,
      timeframe: normalizedTimeframe,
    },
  });
  const progressiveBars = useProgressiveChartBarLimit({
    scopeKey: barsScopeKey,
    timeframe: tf,
    role: chartLimitRole,
    enabled: Boolean(ticker),
    warmTargetLimit: useCallback(
      (limit) =>
        queryClient.prefetchQuery({
          queryKey: [
            "market-mini-bars",
            ticker,
            rollupBaseTimeframe,
            expandLocalRollupLimit(
              limit,
              normalizedTimeframe,
              rollupBaseTimeframe,
            ),
            slotMarket,
            slot?.providerContractId || null,
          ],
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "barsRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: expandLocalRollupLimit(
                    limit,
                    normalizedTimeframe,
                    rollupBaseTimeframe,
                  ),
                  market: slotMarket,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  providerContractId: slot?.providerContractId || undefined,
                },
                buildBarsRequestOptions(currentBarsPriority),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        }),
      [
        chartHydrationScopeKey,
        normalizedTimeframe,
        queryClient,
        rollupBaseTimeframe,
        slot?.providerContractId,
        slotMarket,
        tf,
        ticker,
        currentBarsPriority,
      ],
    ),
  });
  const baseRequestedLimit = useMemo(
    () =>
      expandLocalRollupLimit(
        progressiveBars.requestedLimit,
        normalizedTimeframe,
        rollupBaseTimeframe,
      ),
    [normalizedTimeframe, progressiveBars.requestedLimit, rollupBaseTimeframe],
  );
  const barsQuery = useQuery({
    queryKey: [
      "market-mini-bars",
      ticker,
      rollupBaseTimeframe,
      baseRequestedLimit,
      slotMarket,
      slot?.providerContractId || null,
    ],
    queryFn: () =>
      measureChartBarsRequest({
        scopeKey: chartHydrationScopeKey,
        metric: "barsRequestMs",
        request: () =>
          getBarsRequest({
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: baseRequestedLimit,
            market: slotMarket,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
            providerContractId: slot?.providerContractId || undefined,
          },
          buildBarsRequestOptions(currentBarsPriority),
        ),
      }),
    ...BARS_QUERY_DEFAULTS,
  });
  useEffect(() => {
    if (!barsQuery.data?.bars?.length) {
      return;
    }

    progressiveBars.hydrateFullWindow();
  }, [barsQuery.data?.bars?.length, progressiveBars.hydrateFullWindow]);
  const prewarmFavoriteTimeframe = useCallback(
    (nextTimeframe) => {
      const favoriteTimeframe = normalizeChartTimeframe(nextTimeframe);
      if (
        !ticker ||
        favoriteTimeframe === normalizedTimeframe ||
        !MINI_CHART_TIMEFRAMES.includes(favoriteTimeframe)
      ) {
        return;
      }

      const favoriteBaseTimeframe = resolveLocalRollupBaseTimeframe(
        favoriteTimeframe,
        getChartBarLimit(favoriteTimeframe, chartLimitRole),
        chartLimitRole,
      );
      const favoriteLimit = expandLocalRollupLimit(
        getInitialChartBarLimit(favoriteTimeframe, chartLimitRole),
        favoriteTimeframe,
        favoriteBaseTimeframe,
      );

      queryClient.prefetchQuery({
        queryKey: [
          "market-mini-bars",
          ticker,
          favoriteBaseTimeframe,
          favoriteLimit,
          slotMarket,
          slot?.providerContractId || null,
        ],
        queryFn: () =>
          measureChartBarsRequest({
            scopeKey: buildChartBarScopeKey(
              "market-mini-chart",
              ticker,
              favoriteTimeframe,
              slotMarket,
              slot?.providerContractId || null,
            ),
            metric: "favoritePrewarmRequestMs",
            request: () =>
              getBarsRequest(
                {
                  symbol: ticker,
                  timeframe: favoriteBaseTimeframe,
                  limit: favoriteLimit,
                  market: slotMarket,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  providerContractId: slot?.providerContractId || undefined,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.favoritePrewarm),
              ),
          }),
        ...BARS_QUERY_DEFAULTS,
      });
    },
    [
      chartLimitRole,
      normalizedTimeframe,
      queryClient,
      slot?.providerContractId,
      slotMarket,
      ticker,
    ],
  );
  useEffect(() => {
    if (!isActive || !barsQuery.data?.bars?.length || !favoriteTimeframes.length) {
      return;
    }

    const prewarmKey = [
      chartHydrationScopeKey,
      favoriteTimeframes.join(","),
      slotMarket,
      slot?.providerContractId || "",
    ].join("::");
    if (prewarmedFavoriteTimeframesRef.current === prewarmKey) {
      return;
    }

    prewarmedFavoriteTimeframesRef.current = prewarmKey;
    favoriteTimeframes.forEach(prewarmFavoriteTimeframe);
  }, [
    barsQuery.data?.bars?.length,
    chartHydrationScopeKey,
    favoriteTimeframes,
    isActive,
    prewarmFavoriteTimeframe,
    slot?.providerContractId,
    slotMarket,
  ]);
  const prependableBars = usePrependableHistoricalBars({
    scopeKey: baseBarsScopeKey,
    timeframe: rollupBaseTimeframe,
    bars: barsQuery.data?.bars,
    enabled: Boolean(ticker),
    fetchOlderBars: useCallback(
      async ({ from, to, limit, historyCursor, preferCursor }) => {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const baseLimit = expandLocalRollupLimit(
          limit,
          normalizedTimeframe,
          rollupBaseTimeframe,
        );
        const payload = await queryClient.fetchQuery({
          queryKey: buildBarsPageQueryKey({
            queryBase: ["market-mini-bars-prepend", ticker],
            timeframe: rollupBaseTimeframe,
            limit: baseLimit,
            from: fromIso,
            to: toIso,
            market: slotMarket,
            providerContractId: slot?.providerContractId || null,
            historyCursor: historyCursor || null,
            preferCursor: Boolean(historyCursor && preferCursor),
          }),
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "prependRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: baseLimit,
                  from: fromIso,
                  to: toIso,
                  market: slotMarket,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  providerContractId: slot?.providerContractId || undefined,
                  historyCursor: historyCursor || undefined,
                  preferCursor: historyCursor && preferCursor ? true : undefined,
                },
                buildBarsRequestOptions(currentBarsPriority),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        });

        return normalizeChartBarsPagePayload(payload, {
          context: "market-mini-prepend",
          scopeKey: chartHydrationScopeKey,
        });
      },
      [
        chartHydrationScopeKey,
        currentBarsPriority,
        normalizedTimeframe,
        queryClient,
        rollupBaseTimeframe,
        slot?.providerContractId,
        slotMarket,
        ticker,
      ],
    ),
  });
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: prependableBars.bars,
    enabled: Boolean(
      stockAggregateStreamingEnabled &&
        ticker &&
        ["stocks", "etf", "otc"].includes(slotMarket),
    ),
  });
  const liveBars = useMemo(
    () => buildMiniChartBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const hydratedBaseBars = useMemo(
    () =>
      rollupMarketBars(
        buildMiniChartBarsFromApi(prependableBars.bars),
        rollupBaseTimeframe,
        normalizedTimeframe,
      ),
    [normalizedTimeframe, prependableBars.bars, rollupBaseTimeframe],
  );
  const fetchLatestLiveBars = useCallback(async () => {
    const fallbackLimit = Math.max(2, Math.min(baseRequestedLimit, 500));
    const payload = await measureChartBarsRequest({
      scopeKey: chartHydrationScopeKey,
      metric: "liveFallbackRequestMs",
      request: () =>
        getBarsRequest(
          {
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: fallbackLimit,
            market: slotMarket,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
            providerContractId: slot?.providerContractId || undefined,
          },
          buildBarsRequestOptions(currentBarsPriority),
        ),
    });

    return normalizeLatestChartBarsPayload(payload, {
      context: "market-mini-live-fallback",
      scopeKey: chartHydrationScopeKey,
    });
  }, [
    baseRequestedLimit,
    chartHydrationScopeKey,
    currentBarsPriority,
    normalizedTimeframe,
    rollupBaseTimeframe,
    slot?.providerContractId,
    slotMarket,
    ticker,
  ]);
  const streamedLiveBars = useHistoricalBarStream({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: liveBars,
    enabled: Boolean(
      stockAggregateStreamingEnabled &&
        ticker &&
        normalizedTimeframe !== "1d" &&
        ["stocks", "etf", "otc"].includes(slotMarket),
    ),
    providerContractId: slot?.providerContractId || null,
    outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
    source: "trades",
    instrumentationScope: chartHydrationScopeKey,
    fetchLatestBars: fetchLatestLiveBars,
    streamPriority: isActive ? 100 : 10,
  });
  const bars = useMemo(
    () =>
      rollupMarketBars(
        streamedLiveBars,
        rollupBaseTimeframe,
        normalizedTimeframe,
      ),
    [normalizedTimeframe, rollupBaseTimeframe, streamedLiveBars],
  );
  const displayPriceFallbackQuery = useDisplayChartPriceFallbackBars({
    symbol: ticker,
    market: slotMarket,
    providerContractId: slot?.providerContractId || null,
    enabled: Boolean(ticker && !Number.isFinite(quote?.price)),
    scopeKey: chartHydrationScopeKey,
    priority: currentBarsPriority,
  });
  useEffect(() => {
    recordChartBarScopeState(chartHydrationScopeKey, {
      timeframe: normalizedTimeframe,
      role: chartLimitRole,
      requestedLimit: progressiveBars.requestedLimit,
      initialLimit: getInitialChartBarLimit(tf, chartLimitRole),
      targetLimit: progressiveBars.targetLimit,
      maxLimit: progressiveBars.maxLimit,
      hydratedBaseCount: hydratedBaseBars.length,
      renderedBarCount: bars.length,
      livePatchedBarCount: Math.max(0, bars.length - hydratedBaseBars.length),
      oldestLoadedAt: prependableBars.oldestLoadedAtMs
        ? new Date(prependableBars.oldestLoadedAtMs).toISOString()
        : null,
      isPrependingOlder: prependableBars.isPrependingOlder,
      hasExhaustedOlderHistory: prependableBars.hasExhaustedOlderHistory,
      olderHistoryNextBeforeAt: prependableBars.olderHistoryNextBeforeMs
        ? new Date(prependableBars.olderHistoryNextBeforeMs).toISOString()
        : null,
      emptyOlderHistoryWindowCount:
        prependableBars.emptyOlderHistoryWindowCount,
      olderHistoryPageCount: prependableBars.olderHistoryPageCount,
      olderHistoryProvider: prependableBars.olderHistoryProvider,
      olderHistoryExhaustionReason:
        prependableBars.olderHistoryExhaustionReason,
      olderHistoryProviderCursor: prependableBars.olderHistoryProviderCursor,
      olderHistoryProviderNextUrl: prependableBars.olderHistoryProviderNextUrl,
      olderHistoryProviderPageCount:
        prependableBars.olderHistoryProviderPageCount,
      olderHistoryProviderPageLimitReached:
        prependableBars.olderHistoryProviderPageLimitReached,
      olderHistoryCursor: prependableBars.olderHistoryCursor,
    });
  }, [
    bars.length,
    chartHydrationScopeKey,
    chartLimitRole,
    hydratedBaseBars.length,
    normalizedTimeframe,
    prependableBars.hasExhaustedOlderHistory,
    prependableBars.emptyOlderHistoryWindowCount,
    prependableBars.olderHistoryExhaustionReason,
    prependableBars.olderHistoryNextBeforeMs,
    prependableBars.olderHistoryPageCount,
    prependableBars.olderHistoryProvider,
    prependableBars.olderHistoryProviderCursor,
    prependableBars.olderHistoryProviderNextUrl,
    prependableBars.olderHistoryProviderPageCount,
    prependableBars.olderHistoryProviderPageLimitReached,
    prependableBars.olderHistoryCursor,
    prependableBars.isPrependingOlder,
    prependableBars.loadedBarCount,
    prependableBars.oldestLoadedAtMs,
    progressiveBars.maxLimit,
    progressiveBars.requestedLimit,
    progressiveBars.targetLimit,
    tf,
  ]);
  const chartModel = useMeasuredChartModel({
    scopeKey: chartHydrationScopeKey,
    bars,
    buildInput: {
      bars,
      timeframe: normalizedTimeframe,
      defaultVisibleBarCount: progressiveBars.targetLimit,
      selectedIndicators,
      indicatorSettings,
      indicatorRegistry,
    },
    deps: [
      bars,
      chartHydrationScopeKey,
      indicatorRegistry,
      indicatorSettings,
      normalizedTimeframe,
      progressiveBars.targetLimit,
      selectedIndicators,
    ],
  });
  const barsStatus = bars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : "empty";
  const latestBar = bars[bars.length - 1];
  const displayPrice = resolveDisplayChartPrice({
    quotePrice: quote?.price,
    canonicalBars: displayPriceFallbackQuery.data?.bars,
    renderedBars: bars,
  });
  const quotePrevClose = Number.isFinite(quote?.prevClose)
    ? quote.prevClose
    : null;
  const displayChange =
    Number.isFinite(displayPrice) && Number.isFinite(quotePrevClose)
      ? displayPrice - quotePrevClose
      : Number.isFinite(quote?.change)
        ? quote.change
        : null;
  const displayPct =
    Number.isFinite(displayPrice) &&
    Number.isFinite(quotePrevClose) &&
    quotePrevClose !== 0
      ? (displayChange / quotePrevClose) * 100
      : Number.isFinite(quote?.changePercent)
        ? quote.changePercent
        : null;
  const chartSourceLabel =
    describeBrokerChartSource(latestBar?.source) || barsStatus.toUpperCase();
  const handleFramePointerDownCapture = useCallback(
    (event) => {
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      if (isMarketChartPlotTarget(event.target)) {
        pendingPlotFocusRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        return;
      }
      suppressNextFrameClickRef.current = true;
      onFocus(ticker);
    },
    [isActive, onFocus, ticker],
  );
  const handleFramePointerMoveCapture = useCallback((event) => {
    const pending = pendingPlotFocusRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - pending.x,
      event.clientY - pending.y,
    );
    if (distance > MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE) {
      pendingPlotFocusRef.current = {
        ...pending,
        moved: true,
      };
      suppressNextFrameClickRef.current = true;
    }
  }, []);
  const handleFramePointerUpCapture = useCallback(
    (event) => {
      const pending = pendingPlotFocusRef.current;
      if (!pending || pending.pointerId !== event.pointerId) {
        return;
      }

      pendingPlotFocusRef.current = null;
      const distance = Math.hypot(
        event.clientX - pending.x,
        event.clientY - pending.y,
      );
      const moved =
        pending.moved ||
        distance > MARKET_CHART_PLOT_FOCUS_MOVE_TOLERANCE;

      if (moved) {
        suppressNextFrameClickRef.current = true;
        return;
      }

      if (!isActive && typeof onFocus === "function") {
        suppressNextFrameClickRef.current = true;
        onFocus(ticker);
      }
    },
    [isActive, onFocus, ticker],
  );
  const handleFramePointerCancelCapture = useCallback(() => {
    pendingPlotFocusRef.current = null;
  }, []);
  const handleFrameClick = useCallback(
    (event) => {
      if (suppressNextFrameClickRef.current) {
        suppressNextFrameClickRef.current = false;
        return;
      }
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      onFocus(ticker);
    },
    [isActive, onFocus, ticker],
  );
  const handleDoubleClick = useCallback(
    (event) => {
      if (isMarketChartInteractiveTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEnterSoloMode?.(ticker);
    },
    [onEnterSoloMode, ticker],
  );
  const expandVisibleLogicalRange = useCallback(
    (range) => {
      progressiveBars.expandForVisibleRange(range, prependableBars.loadedBarCount, {
        oldestLoadedAtMs: prependableBars.oldestLoadedAtMs,
        prependOlderBars: prependableBars.prependOlderBars,
      });
    },
    [
      prependableBars.loadedBarCount,
      prependableBars.oldestLoadedAtMs,
      prependableBars.prependOlderBars,
      progressiveBars.expandForVisibleRange,
    ],
  );
  const scheduleVisibleRangeExpansion = useDebouncedVisibleRangeExpansion(
    expandVisibleLogicalRange,
    { resetKey: chartHydrationScopeKey },
  );
  const handleVisibleLogicalRangeChange = useCallback(
    (range) => {
      scheduleVisibleRangeExpansion(range);
    },
    [scheduleVisibleRangeExpansion],
  );
  const rememberTicker = useCallback(
    (nextTickerOrRow) => {
      const normalized =
        typeof nextTickerOrRow === "string"
          ? normalizeTickerSymbol(nextTickerOrRow)
          : normalizeTickerSymbol(nextTickerOrRow?.ticker);
      if (!normalized) {
        return;
      }
      onRememberTicker?.(nextTickerOrRow);
    },
    [onRememberTicker],
  );
  const signalDirection = signalState?.currentSignalDirection;
  const hasSignalBorder =
    signalState?.fresh &&
    signalState?.status === "ok" &&
    (signalDirection === "buy" || signalDirection === "sell");
  const signalBorderColor =
    signalDirection === "buy" ? T.green : signalDirection === "sell" ? T.red : T.border;

  return (
    <div
      onPointerDownCapture={handleFramePointerDownCapture}
      onPointerMoveCapture={handleFramePointerMoveCapture}
      onPointerUpCapture={handleFramePointerUpCapture}
      onPointerCancelCapture={handleFramePointerCancelCapture}
      onClick={handleFrameClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        border: `1px solid ${hasSignalBorder ? signalBorderColor : "transparent"}`,
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: hasSignalBorder
          ? `0 0 0 1px ${signalBorderColor}55, 0 0 18px ${signalBorderColor}30`
          : "none",
      }}
    >
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <ResearchChartFrame
          theme={T}
          themeKey={getCurrentTheme()}
          surfaceUiStateKey="market-mini-chart"
          rangeIdentityKey={chartViewportIdentityKey || chartHydrationScopeKey}
          model={chartModel}
          compact={dense}
          drawings={drawings}
          drawMode={drawMode}
          onAddDrawing={addDrawing}
          showSurfaceToolbar={false}
          showLegend
          legend={{
            symbol: ticker,
            name: fallbackInfo?.name || ticker,
            timeframe: tf,
            statusLabel: describeBrokerChartStatus(barsStatus, tf),
            priceLabel: "Spot",
            price: displayPrice,
            changePercent: displayPct,
            meta: {
              open: latestBar?.o,
              high: latestBar?.h,
              low: latestBar?.l,
              close: latestBar?.c,
              volume: latestBar?.v,
              vwap: latestBar?.vwap,
              sessionVwap: latestBar?.sessionVwap,
              accumulatedVolume: latestBar?.accumulatedVolume,
              averageTradeSize: latestBar?.averageTradeSize,
              timestamp: latestBar?.ts,
              sourceLabel: chartSourceLabel,
            },
            studies: availableStudies,
            selectedStudies: selectedIndicators,
          }}
          hideTimeScale={false}
          referenceLines={
            typeof bars[0]?.o === "number"
              ? [
                  {
                    price: bars[0].o,
                    color: T.textMuted,
                    lineWidth: 1,
                    axisLabelVisible: false,
                    title: "",
                  },
                ]
              : []
          }
          chartEvents={chartEvents}
          style={{
            borderColor: isActive ? T.accent : T.border,
            boxShadow: isActive ? `0 0 0 1px ${T.accent}33` : "none",
          }}
          onVisibleLogicalRangeChange={handleVisibleLogicalRangeChange}
          viewportSnapshot={viewportSnapshot}
          onViewportSnapshotChange={onViewportSnapshotChange}
          persistScalePrefs={false}
          surfaceTopOverlay={(controls) => (
            <ResearchChartWidgetHeader
              theme={T}
              controls={controls}
              symbol={ticker}
              name={fallbackInfo?.name || ticker}
              price={displayPrice}
              priceLabel="Spot"
              changePercent={displayPct}
              statusLabel={describeBrokerChartStatus(barsStatus, tf)}
              timeframe={tf}
              showInlineLegend={false}
              timeframeOptions={MINI_CHART_TIMEFRAMES.map((timeframe) => ({
                value: timeframe,
                label: timeframe,
              }))}
              onChangeTimeframe={(timeframe) => onChangeTimeframe?.(timeframe)}
              favoriteTimeframes={favoriteTimeframes}
              onToggleFavoriteTimeframe={onToggleFavoriteTimeframe}
              onPrewarmTimeframe={
                isActive ? prewarmFavoriteTimeframe : undefined
              }
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
              searchContent={
                <MiniChartTickerSearch
                  open={searchOpen}
                  ticker={ticker}
                  recentTickerRows={recentTickerRows}
                  watchlistSymbols={watchlistSymbols}
                  popularTickers={popularTickers}
                  contextSymbols={recentTickers}
                  flowSuggestionSymbols={smartSuggestionSymbols}
                  signalSuggestionSymbols={signalSuggestionSymbols}
                  embedded
                  onClose={() => setSearchOpen(false)}
                  onSelectTicker={(result) => {
                    const nextTicker = normalizeTickerSymbol(result?.ticker);
                    if (!nextTicker) {
                      return;
                    }
                    ensureTradeTickerInfo(nextTicker, result?.name || nextTicker);
                    rememberTicker(result);
                    onChangeTicker?.(nextTicker, result);
                    setSearchOpen(false);
                  }}
                  onRememberTickerRow={rememberTicker}
                />
              }
              dense={dense}
              studies={availableStudies}
              selectedStudies={selectedIndicators}
              studySpecs={chartModel.studySpecs}
              showSnapshotButton={false}
              showUndoRedo={false}
              onFocusChart={() => onFocus?.(ticker)}
              focusChartActive={isActive}
              focusChartTitle={`Focus ${ticker} chart`}
              onEnterSoloMode={() => onEnterSoloMode?.(ticker)}
              soloChartTitle={`Show ${ticker} in solo layout`}
              identitySlot={
                <MarketIdentityMark
                  item={chartIdentityItem}
                  size={dense ? 16 : 20}
                  showMarketIcon
                  style={{ borderColor: isActive ? T.accent : T.border }}
                />
              }
              rightSlot={
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(dense ? 2 : 4),
                  }}
                >
                  <button
                    type="button"
                    title="Reset chart view"
                    aria-label={`Reset ${ticker} chart view`}
                    data-testid="market-chart-reset-view"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onResetViewport?.();
                      controls.reset();
                    }}
                    style={{
                      border: "none",
                      background: T.bg3,
                      color: T.textDim,
                      cursor: "pointer",
                      fontFamily: T.mono,
                      fontSize: fs(dense ? 7 : 8),
                      fontWeight: 800,
                      padding: sp(dense ? "2px 4px" : "3px 5px"),
                      lineHeight: 1,
                    }}
                  >
                    RESET
                  </button>
                  <RayReplicaSettingsMenu
                    theme={T}
                    settings={rayReplicaSettings}
                    onChange={(next) => onChangeRayReplicaSettings?.(next)}
                    dense={dense}
                    disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
                  />
                </span>
              }
              onToggleStudy={(studyId) => {
                const active = selectedIndicators.includes(studyId);
                const next = active
                  ? selectedIndicators.filter((value) => value !== studyId)
                  : [...selectedIndicators, studyId];
                onChangeStudies?.(next);
              }}
              meta={{
                open: latestBar?.o,
                high: latestBar?.h,
                low: latestBar?.l,
                close: latestBar?.c,
                volume: latestBar?.v,
                vwap: latestBar?.vwap,
                sessionVwap: latestBar?.sessionVwap,
                accumulatedVolume: latestBar?.accumulatedVolume,
                averageTradeSize: latestBar?.averageTradeSize,
                timestamp: latestBar?.ts,
                sourceLabel: chartSourceLabel,
              }}
            />
          )}
          surfaceTopOverlayHeight={spotChartFrameLayout.surfaceTopOverlayHeight}
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
              dense={dense}
            />
          )}
          surfaceLeftOverlayWidth={spotChartFrameLayout.surfaceLeftOverlayWidth}
          surfaceBottomOverlay={(controls) => (
            <ResearchChartWidgetFooter
              theme={T}
              controls={controls}
              studies={availableStudies}
              selectedStudies={selectedIndicators}
              studySpecs={chartModel.studySpecs}
              onToggleStudy={(studyId) => {
                const active = selectedIndicators.includes(studyId);
                const next = active
                  ? selectedIndicators.filter((value) => value !== studyId)
                  : [...selectedIndicators, studyId];
                onChangeStudies?.(next);
              }}
              dense={dense}
              statusText={`${describeBrokerChartStatus(barsStatus, tf)}  ${chartSourceLabel}`}
            />
          )}
          surfaceBottomOverlayHeight={spotChartFrameLayout.surfaceBottomOverlayHeight}
        />
      </div>
      <MiniChartPremiumFlowIndicator
        symbol={ticker}
        summary={premiumFlowSummary}
        flowStatus={premiumFlowStatus}
        providerSummary={premiumFlowProviderSummary}
        dense={dense}
        compact={compactFlow}
      />
    </div>
  );
};

// ─── MULTI CHART GRID ───
// Configurable grid of mini chart cells. Layout selector + independent ticker ownership per slot.
export const MultiChartGrid = ({
  activeSym,
  onSymClick,
  watchlistSymbols = [],
  popularTickers = [],
  signalSuggestionSymbols = [],
  stockAggregateStreamingEnabled = false,
  isVisible = false,
  unusualThreshold,
}) => {
  const queryClient = useQueryClient();
  const gridBodyRef = useRef(null);
  const defaultSymbolsRef = useRef(
    buildDefaultMiniChartSymbols(activeSym, MAX_MULTI_CHART_SLOTS),
  );
  const [layout, setLayout] = useState(_initialState.marketGridLayout || "2x3");
  const [soloSlotIndex, setSoloSlotIndex] = useState(
    Number.isFinite(_initialState.marketGridSoloSlotIndex)
      ? Math.max(0, _initialState.marketGridSoloSlotIndex)
      : 0,
  );
  const {
    favoriteTimeframes: miniFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleMiniFavoriteTimeframe,
  } = useChartTimeframeFavorites("mini");
  const [syncTimeframes, setSyncTimeframes] = useState(
    Boolean(_initialState.marketGridSyncTimeframes),
  );
  const [slots, setSlots] = useState(() =>
    buildInitialMiniChartSlots(activeSym),
  );
  const [recentTickers, setRecentTickers] = useState(() =>
    Array.isArray(_initialState.marketGridRecentTickers)
      ? _initialState.marketGridRecentTickers
          .map((symbol) => normalizeTickerSymbol(symbol))
          .filter(Boolean)
          .slice(0, 10)
      : [],
  );
  const [recentTickerRows, setRecentTickerRows] = useState(() =>
    normalizePersistedTickerSearchRows(_initialState.marketGridRecentTickerRows, 10),
  );
  const [gridBodyWidth, setGridBodyWidth] = useState(0);
  const [marketGridTrackState, setMarketGridTrackState] = useState(() =>
    readMarketGridTrackSession(),
  );
  const [chartViewportSnapshots, setChartViewportSnapshots] = useState({});
  const [chartViewportResetRevision, setChartViewportResetRevision] = useState(0);
  const [gridResizeHoverHandle, setGridResizeHoverHandle] = useState(null);
  const [gridResizeActiveHandle, setGridResizeActiveHandle] = useState(null);
  useEffect(() => {
    const handleWorkspaceSettings = (event) => {
      const nextLayout = event?.detail?.marketGridLayout;
      if (nextLayout && MULTI_CHART_LAYOUTS[nextLayout]) {
        setLayout((current) => (current === nextLayout ? current : nextLayout));
      }
    };
    window.addEventListener("rayalgo:workspace-settings-updated", handleWorkspaceSettings);
    window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    return () => {
      window.removeEventListener(
        "rayalgo:workspace-settings-updated",
        handleWorkspaceSettings,
      );
      window.removeEventListener(USER_PREFERENCES_UPDATED_EVENT, handleWorkspaceSettings);
    };
  }, []);
  const cfg = MULTI_CHART_LAYOUTS[layout] || MULTI_CHART_LAYOUTS["2x3"];
  const defaults = defaultSymbolsRef.current;
  const layoutTrackState = useMemo(
    () =>
      normalizeMarketGridTrackLayoutState(
        marketGridTrackState?.[layout],
        cfg.cols,
        cfg.rows,
      ),
    [cfg.cols, cfg.rows, layout, marketGridTrackState],
  );
  const setLayoutTrackState = useCallback(
    (updater) => {
      setMarketGridTrackState((current) => {
        const currentLayoutState = normalizeMarketGridTrackLayoutState(
          current?.[layout],
          cfg.cols,
          cfg.rows,
        );
        const proposedLayoutState =
          typeof updater === "function" ? updater(currentLayoutState) : updater;
        const nextLayoutState = normalizeMarketGridTrackLayoutState(
          proposedLayoutState,
          cfg.cols,
          cfg.rows,
        );
        if (
          JSON.stringify(currentLayoutState) === JSON.stringify(nextLayoutState)
        ) {
          return current;
        }
        return {
          ...(current || {}),
          [layout]: nextLayoutState,
        };
      });
    },
    [cfg.cols, cfg.rows, layout],
  );
  const visibleSlotEntries = useMemo(() => {
    if (!slots.length) {
      return [];
    }
    if (layout === "1x1") {
      const clampedIndex = Math.max(
        0,
        Math.min(slots.length - 1, soloSlotIndex || 0),
      );
      return slots[clampedIndex]
        ? [{ slot: slots[clampedIndex], index: clampedIndex }]
        : [];
    }

    return slots
      .slice(0, cfg.count)
      .map((slot, index) => ({ slot, index }));
  }, [cfg.count, layout, slots, soloSlotIndex]);
  const quoteSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          visibleSlotEntries
            .map((entry) => entry.slot?.ticker)
            .filter(Boolean),
        ),
      ).join(","),
    [visibleSlotEntries],
  );
  const streamedSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          visibleSlotEntries
            .map((entry) => normalizeTickerSymbol(entry.slot?.ticker))
            .filter(Boolean),
        ),
      ),
    [visibleSlotEntries],
  );
  const {
    flowStatus: chartFlowStatus,
    providerSummary: chartFlowProviderSummary,
    flowEvents: chartFlowEvents,
  } = useLiveMarketFlow(streamedSymbols, {
    enabled: Boolean(isVisible && streamedSymbols.length),
    limit: 16,
    maxSymbols: MAX_MULTI_CHART_SLOTS,
    batchSize: MAX_MULTI_CHART_SLOTS,
    intervalMs: 10_000,
    unusualThreshold,
    workloadLabel: "Chart premium flow",
  });
  const premiumFlowBySymbol = useMemo(
    () => buildPremiumFlowBySymbol(chartFlowEvents, streamedSymbols),
    [chartFlowEvents, streamedSymbols],
  );
  const chartEventsBySymbol = useMemo(() => {
    const grouped = {};
    streamedSymbols.forEach((symbol) => {
      grouped[symbol] = flowEventsToChartEvents(chartFlowEvents, symbol);
    });
    return grouped;
  }, [chartFlowEvents, streamedSymbols]);
  const chartFlowSuggestionSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          (chartFlowEvents || [])
            .map((event) => normalizeTickerSymbol(event?.ticker || event?.underlying))
            .filter(Boolean),
        ),
      ).slice(0, 12),
    [chartFlowEvents],
  );
  const gridQuotesQuery = useGetQuoteSnapshots(
    quoteSymbols ? { symbols: quoteSymbols } : undefined,
    {
      query: {
        enabled: Boolean(quoteSymbols),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  useIbkrQuoteSnapshotStream({
    symbols: streamedSymbols,
    enabled: Boolean(stockAggregateStreamingEnabled && streamedSymbols.length > 0),
  });
  const quotesBySymbol = useMemo(
    () =>
      Object.fromEntries(
        (gridQuotesQuery.data?.quotes || []).map((quote) => [
          normalizeTickerSymbol(quote.symbol),
          quote,
        ]),
      ),
    [gridQuotesQuery.data],
  );

  useEffect(() => {
    setSlots((current) => {
      let changed = current.length !== MAX_MULTI_CHART_SLOTS;
      const next = Array.from({ length: MAX_MULTI_CHART_SLOTS }, (_, index) => {
        const hydrated = hydrateMiniChartSlot(current[index], defaults[index]);
        const previous = current[index];
        if (
          !previous ||
          previous.ticker !== hydrated.ticker ||
          previous.tf !== hydrated.tf ||
          JSON.stringify(previous.studies || []) !==
            JSON.stringify(hydrated.studies || []) ||
          JSON.stringify(previous.rayReplicaSettings || {}) !==
            JSON.stringify(hydrated.rayReplicaSettings || {})
        ) {
          changed = true;
        }
        return hydrated;
      });
      return changed ? next : current;
    });
  }, [defaults]);

  useEffect(() => {
    persistState({
      marketGridLayout: layout,
      marketGridSoloSlotIndex: soloSlotIndex,
      marketGridSyncTimeframes: syncTimeframes,
      marketGridIndicatorPresetVersion: MARKET_GRID_INDICATOR_PRESET_VERSION,
      marketGridSlots: slots,
      marketGridRecentTickers: recentTickers,
      marketGridRecentTickerRows: recentTickerRows,
    });
  }, [layout, recentTickerRows, recentTickers, soloSlotIndex, syncTimeframes, slots]);

  useEffect(() => {
    writeMarketGridTrackSession(marketGridTrackState);
  }, [marketGridTrackState]);

  useEffect(() => {
    if (!gridBodyRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const element = gridBodyRef.current;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.round(entry?.contentRect?.width || 0);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setGridBodyWidth((current) =>
          current === nextWidth ? current : nextWidth,
        );
      });
    });

    observer.observe(element);
    setGridBodyWidth(Math.round(element.clientWidth || 0));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const denseGrid = cfg.count > 4;
  const gridGap = sp(denseGrid ? 4 : 6);
  const gridPadding = sp(denseGrid ? 4 : 6);
  const baseCardMinWidth = dim(
    MULTI_CHART_LAYOUT_CARD_WIDTH[layout] ||
      MULTI_CHART_LAYOUT_CARD_WIDTH["2x3"],
  );
  const baseCellHeight = dim(
    MULTI_CHART_LAYOUT_CARD_HEIGHT[layout] ||
      MULTI_CHART_LAYOUT_CARD_HEIGHT["2x3"],
  );
  const renderedCols = layout === "1x1" ? 1 : cfg.cols;
  const renderedRows = layout === "1x1" ? 1 : cfg.rows;
  const hasVerticalResizeGap = renderedCols > 1;
  const hasHorizontalResizeGap = renderedRows > 1;
  const showGridResizeControl = hasVerticalResizeGap || hasHorizontalResizeGap;
  const effectiveGridWidth = Math.max(0, (gridBodyWidth || 0) - gridPadding * 2);
  const trackAreaWidth = Math.max(
    0,
    effectiveGridWidth - Math.max(0, renderedCols - 1) * gridGap,
  );
  const trackAreaHeight = Math.max(0, baseCellHeight * renderedRows);
  const columnWeights = normalizeMarketGridTrackWeights(
    layoutTrackState.cols,
    renderedCols,
  );
  const rowWeights = normalizeMarketGridTrackWeights(
    layoutTrackState.rows,
    renderedRows,
  );
  const columnWidths = columnWeights.map((weight) => weight * trackAreaWidth);
  const rowHeights = rowWeights.map((weight) => weight * trackAreaHeight);
  const minRenderedColumnWidth = columnWidths.length
    ? Math.min(...columnWidths)
    : 0;
  const compactPremiumFlow = minRenderedColumnWidth > 0 && minRenderedColumnWidth < dim(240);
  const gridRenderedHeight =
    trackAreaHeight + Math.max(0, renderedRows - 1) * gridGap;
  const verticalDividerOffsets = hasVerticalResizeGap
    ? Array.from({ length: renderedCols - 1 }, (_, index) => {
        const dividerIndex = index + 1;
        const leftTrackWidth = columnWidths
          .slice(0, dividerIndex)
          .reduce((sum, value) => sum + value, 0);
        return {
          dividerIndex,
          offset:
            gridPadding +
            leftTrackWidth +
            index * gridGap +
            gridGap / 2,
        };
      })
    : [];
  const horizontalDividerOffsets = hasHorizontalResizeGap
    ? Array.from({ length: renderedRows - 1 }, (_, index) => {
        const dividerIndex = index + 1;
        const topTrackHeight = rowHeights
          .slice(0, dividerIndex)
          .reduce((sum, value) => sum + value, 0);
        return {
          dividerIndex,
          offset:
            gridPadding +
            topTrackHeight +
            index * gridGap +
            gridGap / 2,
        };
      })
    : [];
  const verticalDividerHitThickness = dim(denseGrid ? 14 : 16);
  const horizontalDividerHitThickness = dim(denseGrid ? 14 : 16);
  const intersectionHandleSize = dim(denseGrid ? 12 : 14);
  const crosshairStroke = 2;
  const gridResizeIdleColor = "rgba(166, 174, 182, 0.38)";
  const gridResizeHoverColor = "rgba(196, 203, 210, 0.74)";
  const gridScaleResetDisabled = useMemo(() => {
    const defaultColumnWeights = buildEqualTrackWeights(renderedCols);
    const defaultRowWeights = buildEqualTrackWeights(renderedRows);
    const columnsMatch =
      columnWeights.length === defaultColumnWeights.length &&
      columnWeights.every(
        (value, index) => Math.abs(value - defaultColumnWeights[index]) < 0.001,
      );
    const rowsMatch =
      rowWeights.length === defaultRowWeights.length &&
      rowHeights.length === defaultRowWeights.length &&
      rowWeights.every(
        (value, index) => Math.abs(value - defaultRowWeights[index]) < 0.001,
      );
    return columnsMatch && rowsMatch;
  }, [columnWeights, renderedCols, renderedRows, rowHeights.length, rowWeights]);
  const resetGridCardScale = useCallback(() => {
    setLayoutTrackState({
      cols: buildEqualTrackWeights(renderedCols),
      rows: buildEqualTrackWeights(renderedRows),
    });
  }, [renderedCols, renderedRows, setLayoutTrackState]);
  const resetGridChartViews = useCallback(() => {
    setChartViewportSnapshots({});
    setChartViewportResetRevision((revision) => revision + 1);
  }, []);
  const rememberViewportSnapshot = useCallback((identityKey, snapshot) => {
    if (!identityKey || !snapshot || snapshot.identityKey !== identityKey) {
      return;
    }
    setChartViewportSnapshots((current) => {
      const existing = current?.[identityKey];
      if (
        existing &&
        existing.userTouched === snapshot.userTouched &&
        existing.realtimeFollow === snapshot.realtimeFollow &&
        existing.scaleMode === snapshot.scaleMode &&
        existing.autoScale === snapshot.autoScale &&
        existing.invertScale === snapshot.invertScale &&
        buildMarketGridVisibleRangeSignature(existing.visibleLogicalRange) ===
          buildMarketGridVisibleRangeSignature(snapshot.visibleLogicalRange)
      ) {
        return current;
      }
      return {
        ...(current || {}),
        [identityKey]: snapshot,
      };
    });
  }, []);
  const clearViewportSnapshot = useCallback((identityKey) => {
    if (!identityKey) return;
    setChartViewportSnapshots((current) => {
      const next = { ...(current || {}) };
      if (!deleteMarketGridViewportSnapshots(next, identityKey)) return current;
      return next;
    });
  }, []);
  const startGridResize = useCallback(
    ({ mode, colGapIndex = null, rowGapIndex = null, handleKey }, event) => {
      event.preventDefault();
      event.stopPropagation();
      const handleElement = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const startColumnWeights = [...columnWeights];
      const startRowWeights = [...rowWeights];
      const minColumnWidth = Math.max(dim(denseGrid ? 140 : 170), baseCardMinWidth * 0.36);
      const minRowHeight = Math.max(dim(denseGrid ? 120 : 140), baseCellHeight * 0.5);
      let lastClientX = startX;
      let lastClientY = startY;
      const handlePointerMove = (moveEvent) => {
        lastClientX = moveEvent.clientX;
        lastClientY = moveEvent.clientY;
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        const nextLayoutState = {
          cols: startColumnWeights,
          rows: startRowWeights,
        };

        if (
          (mode === "x" || mode === "xy") &&
          Number.isFinite(colGapIndex) &&
          trackAreaWidth > 0
        ) {
          nextLayoutState.cols = resizeMarketGridTrackWeights(
            startColumnWeights,
            colGapIndex,
            deltaX,
            trackAreaWidth,
            minColumnWidth,
          );
        }

        if (
          (mode === "y" || mode === "xy") &&
          Number.isFinite(rowGapIndex) &&
          trackAreaHeight > 0
        ) {
          nextLayoutState.rows = resizeMarketGridTrackWeights(
            startRowWeights,
            rowGapIndex,
            deltaY,
            trackAreaHeight,
            minRowHeight,
          );
        }

        setLayoutTrackState(nextLayoutState);
      };
      const finishResize = () => {
        const hoveredHandle =
          typeof document !== "undefined"
            ? document
                .elementFromPoint(lastClientX, lastClientY)
                ?.closest?.("[data-grid-resize-handle]")
                ?.getAttribute?.("data-grid-resize-handle")
            : null;
        setGridResizeActiveHandle(null);
        setGridResizeHoverHandle(hoveredHandle || null);
        handleElement?.releasePointerCapture?.(pointerId);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
      };

      setGridResizeActiveHandle(handleKey);
      setGridResizeHoverHandle(handleKey);
      handleElement.setPointerCapture?.(pointerId);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
    },
    [
      baseCardMinWidth,
      baseCellHeight,
      columnWeights,
      rowWeights,
      denseGrid,
      setLayoutTrackState,
      trackAreaHeight,
      trackAreaWidth,
    ],
  );
  const rememberSearchRow = (tickerOrRow) => {
    const normalizedTicker =
      typeof tickerOrRow === "string"
        ? normalizeTickerSymbol(tickerOrRow)
        : normalizeTickerSymbol(tickerOrRow?.ticker);
    if (!normalizedTicker) return;

    setRecentTickers((current) =>
      [normalizedTicker, ...current.filter((value) => value !== normalizedTicker)].slice(
        0,
        10,
      ),
    );

    const normalizedRow = normalizeTickerSearchResultForStorage(tickerOrRow);
    if (normalizedRow) {
      const key = getTickerSearchRowStorageKey(normalizedRow);
      setRecentTickerRows((current) =>
        [
          normalizedRow,
          ...current.filter((row) => getTickerSearchRowStorageKey(row) !== key),
        ].slice(0, 10),
      );
    }
  };

  const updateSlot = (slotIndex, patch) => {
    if (patch?.ticker) {
      rememberSearchRow(patch.searchResult || patch);
    }
    if (
      patch?.ticker ||
      patch?.market ||
      patch?.providerContractId ||
      patch?.provider ||
      patch?.tradeProvider ||
      patch?.dataProviderPreference
    ) {
      clearViewportSnapshot(buildMarketGridViewportIdentity(slotIndex, slots[slotIndex]));
    }
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? hydrateMiniChartSlot({ ...slot, ...patch }, defaults[index])
          : slot,
      ),
    );
  };
  const updateSlotTimeframe = (slotIndex, tf) => {
    setChartViewportSnapshots((current) => {
      const next = { ...(current || {}) };
      slots.forEach((slot, index) => {
        if (syncTimeframes || index === slotIndex) {
          deleteMarketGridViewportSnapshots(
            next,
            buildMarketGridViewportIdentity(index, slot),
          );
        }
      });
      return next;
    });
    setSlots((current) =>
      current.map((slot, index) =>
        syncTimeframes || index === slotIndex
          ? hydrateMiniChartSlot({ ...slot, tf }, defaults[index])
          : slot,
      ),
    );
  };
  const focusedLabel =
    layout === "1x1"
      ? visibleSlotEntries[0]?.slot?.ticker || activeSym
      : `${cfg.count} visible`;

  return (
    <Card
      noPad
      data-testid="market-chart-grid"
      style={{ flexShrink: 0, overflow: "visible" }}
    >
      <div
        style={{
          padding: sp(denseGrid ? "5px 8px" : "6px 10px"),
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(8),
            minWidth: 0,
            flex: "1 1 220px",
          }}
        >
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.display,
              color: T.textSec,
              letterSpacing: "0.04em",
            }}
          >
            CHARTS
          </span>
          <span
            style={{
              fontSize: fs(9),
              color: T.textMuted,
              fontFamily: T.mono,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {syncTimeframes ? "sync tf" : "independent"} · broker-backed bars ·{" "}
            {focusedLabel}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            flex: "0 1 auto",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={resetGridCardScale}
            disabled={gridScaleResetDisabled}
            style={{
              padding: sp("3px 8px"),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: gridScaleResetDisabled ? T.bg3 : "rgba(255,255,255,0.08)",
              color: gridScaleResetDisabled ? T.textMuted : T.text,
              border: "none",
              borderRadius: 0,
              cursor: gridScaleResetDisabled ? "default" : "pointer",
              letterSpacing: "0.04em",
              opacity: gridScaleResetDisabled ? 0.55 : 1,
            }}
          >
            RESET SIZE
          </button>
          <button
            type="button"
            onClick={resetGridChartViews}
            data-testid="market-chart-reset-views"
            style={{
              padding: sp("3px 8px"),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: "rgba(255,255,255,0.08)",
              color: T.text,
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            RESET VIEWS
          </button>
          <button
            type="button"
            onClick={() => {
              setSyncTimeframes((current) => {
                const next = !current;
                if (next) {
                  const anchorTf = visibleSlotEntries[0]?.slot?.tf || "15m";
                  setChartViewportSnapshots({});
                  setSlots((slotList) =>
                    slotList.map((slot, index) =>
                      hydrateMiniChartSlot(
                        {
                          ...slot,
                          tf: anchorTf,
                        },
                        defaults[index],
                      ),
                    ),
                  );
                }
                return next;
              });
            }}
            style={{
              padding: sp("3px 8px"),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: syncTimeframes ? T.accent : T.bg3,
              color: syncTimeframes ? "#fff" : T.textDim,
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            SYNC TF
          </button>
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: sp(denseGrid ? 1 : 2),
              background: T.bg3,
              borderRadius: 0,
            }}
          >
            {Object.keys(MULTI_CHART_LAYOUTS).map((key) => (
              <button
                key={key}
                onClick={() => setLayout(key)}
                title={`${MULTI_CHART_LAYOUTS[key].count} charts`}
                style={{
                  padding: sp("3px 8px"),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  fontWeight: 700,
                  background: layout === key ? T.accent : "transparent",
                  color: layout === key ? "#fff" : T.textDim,
                  border: "none",
                  borderRadius: 0,
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* Grid */}
      <div
        ref={gridBodyRef}
        style={{
          position: "relative",
          padding: gridPadding,
          overflow: "visible",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: columnWidths
              .map((width) => `${Math.max(width, 0)}px`)
              .join(" "),
            gridTemplateRows: rowHeights
              .map((height) => `${Math.max(height, 0)}px`)
              .join(" "),
            gap: gridGap,
            width: `${effectiveGridWidth}px`,
            height: `${gridRenderedHeight}px`,
          }}
        >
          {visibleSlotEntries.map(({ slot, index }) => {
            const viewportIdentityKey = buildMarketGridViewportRevisionIdentity(
              index,
              slot,
              chartViewportResetRevision,
            );
            return (
              <MiniChartCell
                key={`market-chart-slot-${index}-${chartViewportResetRevision}`}
                slot={slot}
                quote={quotesBySymbol[slot.ticker]}
                premiumFlowSummary={premiumFlowBySymbol[normalizeTickerSymbol(slot.ticker)]}
                chartEvents={chartEventsBySymbol[normalizeTickerSymbol(slot.ticker)] || []}
                premiumFlowStatus={chartFlowStatus}
                premiumFlowProviderSummary={chartFlowProviderSummary}
                isActive={slot.ticker === activeSym}
                dense={denseGrid}
                compactFlow={compactPremiumFlow}
                stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
                chartViewportIdentityKey={viewportIdentityKey}
                viewportSnapshot={chartViewportSnapshots[viewportIdentityKey] || null}
                onViewportSnapshotChange={(snapshot) =>
                  rememberViewportSnapshot(viewportIdentityKey, snapshot)
                }
                onResetViewport={() => clearViewportSnapshot(viewportIdentityKey)}
                favoriteTimeframes={miniFavoriteTimeframes}
                onToggleFavoriteTimeframe={toggleMiniFavoriteTimeframe}
                onFocus={onSymClick}
                onEnterSoloMode={() => {
                  setSoloSlotIndex(index);
                  setLayout("1x1");
                  onSymClick?.(slot.ticker);
                }}
                onChangeTicker={(ticker, result) =>
                  updateSlot(index, {
                    ticker,
                    market: result?.market || "stocks",
                    provider: result?.provider || result?.tradeProvider || null,
                    providers: Array.isArray(result?.providers) ? result.providers : [],
                    tradeProvider: result?.tradeProvider || null,
                    dataProviderPreference: result?.dataProviderPreference || null,
                    providerContractId: result?.providerContractId || null,
                    exchange:
                      result?.exchangeDisplay ||
                      result?.normalizedExchangeMic ||
                      result?.primaryExchange ||
                      null,
                    searchResult: result || null,
                  })
                }
                onChangeTimeframe={(tf) => updateSlotTimeframe(index, tf)}
                onChangeStudies={(studies) => updateSlot(index, { studies })}
                onChangeRayReplicaSettings={(rayReplicaSettings) =>
                  updateSlot(index, { rayReplicaSettings })
                }
                recentTickers={recentTickers}
                recentTickerRows={recentTickerRows}
                watchlistSymbols={watchlistSymbols}
                popularTickers={popularTickers}
                smartSuggestionSymbols={chartFlowSuggestionSymbols}
                signalSuggestionSymbols={signalSuggestionSymbols}
                onRememberTicker={rememberSearchRow}
              />
            );
          })}
        </div>
        {showGridResizeControl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            {verticalDividerOffsets.map(({ dividerIndex, offset }) => {
              const handleKey = buildMarketGridResizeHandleKey(
                "x",
                dividerIndex,
                null,
              );
              const isActive = gridResizeActiveHandle === handleKey;
              const isHovered = gridResizeHoverHandle === handleKey;
              const dividerColor = isActive
                ? T.accent
                : isHovered
                  ? gridResizeHoverColor
                  : gridResizeIdleColor;
              return (
                <button
                  key={handleKey}
                  type="button"
                  data-grid-resize-handle={handleKey}
                  aria-label={`Resize market chart columns ${dividerIndex} and ${
                    dividerIndex + 1
                  }`}
                  title="Drag to resize chart columns"
                  onPointerDown={(event) =>
                    startGridResize(
                      {
                        mode: "x",
                        colGapIndex: dividerIndex,
                        handleKey,
                      },
                      event,
                    )
                  }
                  onPointerEnter={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(handleKey);
                    }
                  }}
                  onPointerLeave={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(null);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: offset - verticalDividerHitThickness / 2,
                    top: gridPadding,
                    width: verticalDividerHitThickness,
                    height: gridRenderedHeight,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "col-resize",
                    pointerEvents: "auto",
                    touchAction: "none",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left:
                        (verticalDividerHitThickness - crosshairStroke) / 2,
                      top: 0,
                      width: crosshairStroke,
                      height: "100%",
                      background: dividerColor,
                      boxShadow: isActive
                        ? `0 0 0 1px ${T.bg}, 0 0 12px rgba(91,140,255,0.35)`
                        : isHovered
                          ? `0 0 0 1px rgba(0,0,0,0.18)`
                          : "none",
                      opacity: isActive ? 1 : isHovered ? 0.92 : 0.78,
                      transition:
                        "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
                    }}
                  />
                </button>
              );
            })}
            {horizontalDividerOffsets.map(({ dividerIndex, offset }) => {
              const handleKey = buildMarketGridResizeHandleKey(
                "y",
                null,
                dividerIndex,
              );
              const isActive = gridResizeActiveHandle === handleKey;
              const isHovered = gridResizeHoverHandle === handleKey;
              const dividerColor = isActive
                ? T.accent
                : isHovered
                  ? gridResizeHoverColor
                  : gridResizeIdleColor;
              return (
                <button
                  key={handleKey}
                  type="button"
                  data-grid-resize-handle={handleKey}
                  aria-label={`Resize market chart rows ${dividerIndex} and ${
                    dividerIndex + 1
                  }`}
                  title="Drag to resize chart rows"
                  onPointerDown={(event) =>
                    startGridResize(
                      {
                        mode: "y",
                        rowGapIndex: dividerIndex,
                        handleKey,
                      },
                      event,
                    )
                  }
                  onPointerEnter={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(handleKey);
                    }
                  }}
                  onPointerLeave={() => {
                    if (!gridResizeActiveHandle) {
                      setGridResizeHoverHandle(null);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: gridPadding,
                    top: offset - horizontalDividerHitThickness / 2,
                    width: effectiveGridWidth,
                    height: horizontalDividerHitThickness,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "row-resize",
                    pointerEvents: "auto",
                    touchAction: "none",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 0,
                      top:
                        (horizontalDividerHitThickness - crosshairStroke) / 2,
                      width: "100%",
                      height: crosshairStroke,
                      background: dividerColor,
                      boxShadow: isActive
                        ? `0 0 0 1px ${T.bg}, 0 0 12px rgba(91,140,255,0.35)`
                        : isHovered
                          ? `0 0 0 1px rgba(0,0,0,0.18)`
                          : "none",
                      opacity: isActive ? 1 : isHovered ? 0.92 : 0.78,
                      transition:
                        "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
                    }}
                  />
                </button>
              );
            })}
            {verticalDividerOffsets.flatMap((verticalDivider) =>
              horizontalDividerOffsets.map((horizontalDivider) => {
                const handleKey = buildMarketGridResizeHandleKey(
                  "xy",
                  verticalDivider.dividerIndex,
                  horizontalDivider.dividerIndex,
                );
                const isActive = gridResizeActiveHandle === handleKey;
                const isHovered = gridResizeHoverHandle === handleKey;
                return (
                  <button
                    key={handleKey}
                    type="button"
                    data-grid-resize-handle={handleKey}
                    aria-label={`Resize market chart rows and columns at divider ${verticalDivider.dividerIndex}-${horizontalDivider.dividerIndex}`}
                    title="Drag diagonally to resize chart rows and columns"
                    onPointerDown={(event) =>
                      startGridResize(
                        {
                          mode: "xy",
                          colGapIndex: verticalDivider.dividerIndex,
                          rowGapIndex: horizontalDivider.dividerIndex,
                          handleKey,
                        },
                        event,
                      )
                    }
                    onPointerEnter={() => {
                      if (!gridResizeActiveHandle) {
                        setGridResizeHoverHandle(handleKey);
                      }
                    }}
                    onPointerLeave={() => {
                      if (!gridResizeActiveHandle) {
                        setGridResizeHoverHandle(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left:
                        verticalDivider.offset - intersectionHandleSize / 2,
                      top:
                        horizontalDivider.offset - intersectionHandleSize / 2,
                      width: intersectionHandleSize,
                      height: intersectionHandleSize,
                      padding: 0,
                      border: "none",
                      borderRadius: 999,
                      background: "transparent",
                      cursor: "nwse-resize",
                      pointerEvents: "auto",
                      touchAction: "none",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: 999,
                        background: isActive
                          ? T.accent
                          : isHovered
                            ? gridResizeHoverColor
                            : "rgba(166, 174, 182, 0.48)",
                        boxShadow: isActive
                          ? `0 0 0 1px ${T.bg}, 0 0 14px rgba(91,140,255,0.4)`
                          : isHovered
                            ? `0 0 0 1px ${T.bg}`
                            : `0 0 0 1px rgba(0,0,0,0.28)`,
                        opacity: isActive ? 1 : isHovered ? 0.92 : 0.8,
                        transition:
                          "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
                      }}
                    />
                  </button>
                );
              }),
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export const UNUSUAL_THRESHOLD_OPTIONS = [
  { value: 1, label: "1× OI" },
  { value: 2, label: "2× OI" },
  { value: 3, label: "3× OI" },
  { value: 5, label: "5× OI" },
  { value: 10, label: "10× OI" },
];

const SIGNAL_TIMEFRAME_LABELS = {
  "1m": "1M",
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "1d": "1D",
};

const MarketActivityLaneSection = ({
  title,
  meta,
  controls,
  children,
  compact = false,
  testId,
}) => (
  <section
    data-testid={testId}
    style={{
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      borderTop: `1px solid ${T.border}`,
      paddingTop: sp(7),
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: sp(8),
        marginBottom: sp(6),
        minWidth: 0,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.text,
            fontFamily: T.display,
            fontSize: fs(compact ? 10 : 11),
            fontWeight: 800,
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        {meta ? (
          <div
            style={{
              marginTop: 1,
              color: T.textDim,
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {controls ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: sp(4),
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {controls}
        </div>
      ) : null}
    </div>
    {children}
  </section>
);

const SignalTimeframeTypeahead = ({ value, onChange }) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxIdRef = useRef(
    `signal-timeframe-listbox-${Math.random().toString(36).slice(2)}`,
  );
  const selected = normalizeSignalMonitorTimeframe(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(SIGNAL_TIMEFRAME_LABELS[selected] || selected);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery(SIGNAL_TIMEFRAME_LABELS[selected] || selected.toUpperCase());
      setActiveIndex(0);
    }
  }, [open, selected]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const options =
    !normalizedQuery || normalizedQuery === selected
      ? SIGNAL_MONITOR_TIMEFRAMES
      : SIGNAL_MONITOR_TIMEFRAMES.filter((timeframe) =>
          timeframe.toLowerCase().includes(normalizedQuery),
        );
  const visibleOptions = options.length ? options : SIGNAL_MONITOR_TIMEFRAMES;

  const commit = useCallback(
    (timeframe) => {
      const normalized = normalizeSignalMonitorTimeframe(timeframe);
      setOpen(false);
      setQuery(SIGNAL_TIMEFRAME_LABELS[normalized] || normalized.toUpperCase());
      onChange?.(normalized);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) =>
          Math.min(current + 1, visibleOptions.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commit(visibleOptions[activeIndex] || selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    },
    [activeIndex, commit, selected, visibleOptions],
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        width: dim(56),
        minWidth: dim(56),
      }}
    >
      <input
        ref={inputRef}
        data-testid="market-signal-interval-input"
        role="combobox"
        aria-label="Signal monitor interval"
        aria-expanded={open}
        aria-controls={listboxIdRef.current}
        aria-autocomplete="list"
        aria-activedescendant={
          open ? `${listboxIdRef.current}-option-${activeIndex}` : undefined
        }
        value={query}
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          background: T.bg2,
          border: `1px solid ${T.border}`,
          color: T.textSec,
          fontFamily: T.mono,
          fontSize: fs(8),
          fontWeight: 900,
          padding: sp("5px 18px 5px 6px"),
          borderRadius: 0,
          outline: "none",
          textTransform: "uppercase",
        }}
      />
      <ChevronDown
        aria-hidden="true"
        size={dim(11)}
        strokeWidth={2.4}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          color: T.textDim,
          pointerEvents: "none",
        }}
      />
      {open ? (
        <div
          id={listboxIdRef.current}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 100,
            left: 0,
            right: 0,
            top: "calc(100% + 3px)",
            background: T.bg2,
            border: `1px solid ${T.border}`,
            boxShadow: "0 14px 28px rgba(0,0,0,0.28)",
            maxHeight: dim(150),
            overflowY: "auto",
          }}
        >
          {visibleOptions.map((timeframe, index) => {
            const active = index === activeIndex;
            const selectedOption = timeframe === selected;
            return (
              <button
                key={timeframe}
                id={`${listboxIdRef.current}-option-${index}`}
                data-testid={`market-signal-interval-option-${timeframe}`}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(timeframe)}
                style={{
                  width: "100%",
                  border: "none",
                  borderBottom: `1px solid ${T.border}55`,
                  background: active ? T.bg3 : selectedOption ? T.accentDim : T.bg2,
                  color: selectedOption ? T.accent : T.textSec,
                  cursor: "pointer",
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 900,
                  padding: sp("5px 6px"),
                  textAlign: "left",
                }}
              >
                {SIGNAL_TIMEFRAME_LABELS[timeframe]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const MarketLaneToolbar = ({ children }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: sp(4),
      minWidth: 0,
      marginBottom: sp(6),
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

const MarketIconToolButton = ({
  Icon,
  active = false,
  disabled = false,
  tone = T.accent,
  label,
  title,
  onClick,
}) => (
  <button
    type="button"
    aria-label={label}
    title={title || label}
    onClick={onClick}
    disabled={disabled}
    style={{
      width: dim(28),
      height: dim(28),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      border: `1px solid ${active ? tone : T.border}`,
      background: active ? `${tone}16` : T.bg2,
      color: active ? tone : T.textDim,
      cursor: disabled ? "wait" : "pointer",
      opacity: disabled ? 0.78 : 1,
      borderRadius: 0,
      padding: 0,
    }}
  >
    <Icon size={dim(13)} strokeWidth={2.4} />
  </button>
);

const MarketToolbarLabel = ({ Icon, label, tone = T.textDim }) => (
  <span
    title={label}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dim(28),
      height: dim(28),
      flex: "0 0 auto",
      border: `1px solid ${tone}36`,
      background: `${tone}10`,
      color: tone,
    }}
  >
    <Icon size={dim(13)} strokeWidth={2.4} />
  </span>
);

const getNotificationLaneTone = (item) => {
  if (item.kind === "alert") {
    return item.tone === "profit"
      ? { label: "ALERT", color: T.green, background: `${T.green}12` }
      : { label: "RISK", color: T.red, background: `${T.red}12` };
  }
  if (item.kind === "calendar") {
    return { label: "CAL", color: T.amber, background: `${T.amber}12` };
  }
  return { label: "NEWS", color: T.accent, background: `${T.accent}12` };
};

const getSignalLaneTone = (item) =>
  item.direction === "sell"
    ? { label: "SELL", color: T.red, background: `${T.red}12` }
    : { label: "BUY", color: T.green, background: `${T.green}12` };

const MarketSignalRow = ({ item, index, maxItems, onClick }) => {
  const tone = getSignalLaneTone(item);
  return (
    <button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      title={item.title}
      style={{
        ...motionRowStyle(index, maxItems, 100),
        ...motionVars({ accent: tone.color }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("6px 6px"),
        border: `1px solid ${tone.color}38`,
        borderLeft: `3px solid ${tone.color}`,
        background: tone.background,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone.color}1f`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
      }}
    >
      <span
        style={{
          color: tone.color,
          border: `1px solid ${tone.color}55`,
          background: `${tone.color}14`,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 900,
          letterSpacing: "0.04em",
          lineHeight: 1,
          padding: sp("3px 4px"),
          minWidth: dim(30),
          textAlign: "center",
        }}
      >
        {tone.label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 850,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.symbol}
        </span>
        <span
          style={{
            display: "block",
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.2,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </span>
      </span>
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
    </button>
  );
};

const getUnusualLaneTone = (item) => {
  const right = String(item.raw?.cp || item.raw?.right || item.type || "")
    .trim()
    .toLowerCase();
  const text = [
    item.raw?.sentiment,
    item.raw?.bias,
    item.raw?.side,
    item.side,
    item.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const isBearish = /bear|sell|sold|bid|below/.test(text);
  const isBullish = /bull|buy|bought|ask|above/.test(text);
  const isPut = right === "p" || right === "put" || /put/.test(right);
  const isCall = right === "c" || right === "call" || /call/.test(right);
  const color =
    isBearish && !isBullish
      ? T.red
      : isBullish && !isBearish
        ? T.green
        : isPut
          ? T.red
          : isCall
            ? T.green
            : T.amber;
  return {
    label: isPut ? "PUT" : isCall ? "CALL" : "UOA",
    color,
    background: `${color}12`,
  };
};

const MarketUnusualRow = ({ item, index, maxItems, onClick }) => {
  const tone = getUnusualLaneTone(item);
  return (
    <button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      title={item.title}
      style={{
        ...motionRowStyle(index, maxItems, 100),
        ...motionVars({ accent: tone.color }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("6px 6px"),
        border: `1px solid ${tone.color}34`,
        borderLeft: `3px solid ${tone.color}`,
        background: tone.background,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone.color}1f`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
      }}
    >
      <span
        style={{
          color: tone.color,
          border: `1px solid ${tone.color}55`,
          background: `${tone.color}14`,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 900,
          letterSpacing: "0.04em",
          lineHeight: 1,
          padding: sp("3px 4px"),
          minWidth: dim(34),
          textAlign: "center",
        }}
      >
        {tone.label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 850,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "block",
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.2,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </span>
      </span>
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
    </button>
  );
};

const MarketNotificationRow = ({
  item,
  index,
  maxItems,
  onClick,
  cursor = "pointer",
}) => {
  const tone = getNotificationLaneTone(item);
  return (
    <button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      title={item.title}
      style={{
        ...motionRowStyle(index, maxItems, 90),
        ...motionVars({ accent: tone.color }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("5px 6px"),
        border: `1px solid ${tone.color}33`,
        background: tone.background,
        textAlign: "left",
        cursor,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone.color}1c`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
      }}
    >
      <span
        style={{
          color: tone.color,
          border: `1px solid ${tone.color}55`,
          background: `${tone.color}12`,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 900,
          letterSpacing: "0.04em",
          lineHeight: 1,
          padding: sp("3px 4px"),
          minWidth: dim(32),
          textAlign: "center",
        }}
      >
        {tone.label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 800,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "block",
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.2,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail || item.meta}
        </span>
      </span>
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
    </button>
  );
};

export const MarketActivityPanel = ({
  notifications = [],
  highlightedUnusualFlow = [],
  signalEvents = [],
  signalStates = [],
  signalMonitorProfile = null,
  signalMonitorPending = false,
  watchlists = [],
  newsItems = [],
  calendarItems = [],
  onSymClick,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
  unusualThreshold = 1,
  onChangeUnusualThreshold,
  appliedUnusualThreshold = null,
  appliedUnusualThresholdConsistent = true,
}) => {
  const monitorTimeframe = normalizeSignalMonitorTimeframe(
    signalMonitorProfile?.timeframe,
  );
  const lanes = useMemo(
    () =>
      buildMarketActivityLanes({
        notifications,
        highlightedUnusualFlow,
        signalEvents,
        signalStates,
        selectedTimeframe: monitorTimeframe,
        newsItems,
        calendarItems,
      }),
    [
      calendarItems,
      highlightedUnusualFlow,
      monitorTimeframe,
      newsItems,
      notifications,
      signalEvents,
      signalStates,
    ],
  );
  const freshSignalCount = signalStates.filter(
    (state) =>
      normalizeSignalMonitorTimeframe(state?.timeframe) === monitorTimeframe &&
      state?.fresh &&
      state?.status === "ok" &&
      (state?.currentSignalDirection === "buy" ||
        state?.currentSignalDirection === "sell"),
  ).length;
  const monitorMeta = signalMonitorPending
    ? "SCANNING"
    : signalMonitorProfile?.enabled
      ? `${freshSignalCount} FRESH`
      : "PAUSED";
  const monitorWatchlistId = signalMonitorProfile?.watchlistId || "";
  const monitorWatchlistKnown = watchlists.some(
    (watchlist) => watchlist.id === monitorWatchlistId,
  );
  const appliedThresholdLabel = Number.isFinite(appliedUnusualThreshold) &&
    appliedUnusualThreshold > 0
    ? `${appliedUnusualThreshold % 1 === 0 ? appliedUnusualThreshold.toFixed(0) : appliedUnusualThreshold.toFixed(1)}× OI${appliedUnusualThresholdConsistent ? "" : "*"}`
    : null;
  const requestedThreshold = Number(unusualThreshold) || 1;
  const thresholdMatches =
    Number.isFinite(appliedUnusualThreshold) &&
    Math.abs(appliedUnusualThreshold - requestedThreshold) < 0.001 &&
    appliedUnusualThresholdConsistent;

  const renderEmptyLane = (title, detail) => (
    <DataUnavailableState title={title} detail={detail} />
  );

  const signalRows = lanes.signals.map((row) => ({
    ...row,
    title: `${row.directionLabel} · ${row.symbol}`,
    detail: `${row.timeframe} · ${formatQuotePrice(row.price)}`,
    meta: row.time ? formatRelativeTimeShort(row.time) : row.source.toUpperCase(),
    color: row.direction === "buy" ? T.green : T.red,
  }));
  const unusualRows = lanes.unusual.map((row) => {
    const scoreLabel =
      row.score > 0
        ? ` · ${row.score.toFixed(row.score >= 10 ? 0 : 1)}× OI`
        : "";
    return {
      ...row,
      title: `${row.symbol}${row.contract ? ` ${row.contract}` : ""}`,
      detail: `${row.side || "FLOW"} ${row.type || ""} · ${fmtM(row.premium)}${scoreLabel}`,
      meta: row.time ? formatRelativeTimeShort(row.time) : "now",
      color: T.amber,
    };
  });
  const notificationRows = lanes.notifications.map((row) => ({
    ...row,
    color:
      row.kind === "alert"
        ? row.tone === "profit"
          ? T.green
          : T.red
        : row.kind === "calendar"
          ? T.green
          : T.accent,
  }));
  const notificationTypeCounts = notificationRows.reduce(
    (counts, row) => {
      if (row.kind === "alert") counts.alerts += 1;
      if (row.kind === "news") counts.news += 1;
      if (row.kind === "calendar") counts.calendar += 1;
      return counts;
    },
    { alerts: 0, news: 0, calendar: 0 },
  );

  return (
    <Card
      data-testid="market-activity-panel-card"
      style={{
        padding: "8px 10px",
        minHeight: dim(340),
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <CardTitle
        right={
          <span
            style={{
              fontSize: fs(8),
              color: signalMonitorPending ? T.amber : T.textDim,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          >
            {monitorMeta}
          </span>
        }
      >
        Activity & Notifications
      </CardTitle>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(8),
          minHeight: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: sp(8),
            minHeight: 0,
            flex: "1 1 auto",
            alignItems: "start",
          }}
        >
          <MarketActivityLaneSection
            title="Signals"
            meta={`${SIGNAL_TIMEFRAME_LABELS[monitorTimeframe]} · ${signalRows.length} rows`}
            testId="market-activity-signals-lane"
          >
            <MarketLaneToolbar>
              <MarketIconToolButton
                Icon={Power}
                active={Boolean(signalMonitorProfile?.enabled)}
                tone={signalMonitorProfile?.enabled ? T.green : T.textDim}
                label="Toggle signal monitor"
                onClick={onToggleMonitor}
              />
              <SignalTimeframeTypeahead
                value={monitorTimeframe}
                onChange={onChangeMonitorTimeframe}
              />
              <MarketIconToolButton
                Icon={RefreshCw}
                active={Boolean(signalMonitorPending)}
                disabled={signalMonitorPending}
                tone={signalMonitorPending ? T.amber : T.accent}
                label="Scan signal monitor now"
                onClick={onScanNow}
              />
              <select
                value={monitorWatchlistId}
                onChange={(event) =>
                  onChangeMonitorWatchlist?.(event.target.value || null)
                }
                disabled={!watchlists.length}
                aria-label="Signal monitor watchlist"
                style={{
                  minWidth: 0,
                  flex: "1 1 auto",
                  width: "100%",
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  color: T.textSec,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 800,
                  padding: sp("6px 5px"),
                  borderRadius: 0,
                  outline: "none",
                }}
              >
                <option value="">DEFAULT</option>
                {monitorWatchlistId && !monitorWatchlistKnown ? (
                  <option value={monitorWatchlistId}>CURRENT</option>
                ) : null}
                {watchlists.map((watchlist) => (
                  <option key={watchlist.id} value={watchlist.id}>
                    {watchlist.name || watchlist.id}
                  </option>
                ))}
              </select>
            </MarketLaneToolbar>
            {signalRows.length ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(3),
                  overflowY: "auto",
                  minHeight: 0,
                  maxHeight: dim(230),
                }}
              >
                {signalRows.map((item, index) => (
                  <MarketSignalRow
                    key={item.id}
                    item={item}
                    index={index}
                    maxItems={signalRows.length}
                    onClick={() => onSignalAction?.(item.symbol, item.raw)}
                  />
                ))}
              </div>
            ) : (
              renderEmptyLane(
                "No signals for this interval",
                "Monitor results will appear here after the next scan.",
              )
            )}
          </MarketActivityLaneSection>

          <MarketActivityLaneSection
            title="UOA"
            meta={`${unusualRows.length} unusual prints`}
            testId="market-activity-uoa-lane"
          >
            <MarketLaneToolbar>
              <MarketToolbarLabel Icon={Gauge} label="UOA threshold" tone={T.amber} />
              <select
                data-testid="market-uoa-threshold-select"
                value={String(unusualThreshold)}
                onChange={(event) =>
                  onChangeUnusualThreshold?.(Number(event.target.value))
                }
                aria-label="Unusual options activity threshold"
                title="Volume / open interest ratio at which a print is flagged as unusual."
                style={{
                  width: dim(76),
                  flex: "0 0 auto",
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  color: T.textSec,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 800,
                  padding: sp("6px 5px"),
                  borderRadius: 0,
                  outline: "none",
                }}
              >
                {UNUSUAL_THRESHOLD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {appliedThresholdLabel ? (
                <span
                  title={
                    thresholdMatches
                      ? "Server confirmed it applied your selected unusual-options threshold."
                      : appliedUnusualThresholdConsistent
                        ? "The live feed is using a different threshold than the one you selected."
                        : "Different symbols returned different applied thresholds; showing the most common one."
                  }
                  style={{
                    minWidth: 0,
                    flex: "1 1 auto",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: thresholdMatches ? T.textDim : T.amber,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    fontWeight: 800,
                    border: `1px solid ${(thresholdMatches ? T.textDim : T.amber)}40`,
                    background: `${thresholdMatches ? T.textDim : T.amber}12`,
                    padding: sp("6px 5px"),
                    borderRadius: 0,
                    whiteSpace: "nowrap",
                    textAlign: "center",
                  }}
                >
                  {appliedThresholdLabel}
                </span>
              ) : null}
            </MarketLaneToolbar>
            {unusualRows.length ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(3),
                  overflowY: "auto",
                  minHeight: 0,
                  maxHeight: dim(230),
                }}
              >
                {unusualRows.map((item, index) => (
                  <MarketUnusualRow
                    key={item.id}
                    item={item}
                    index={index}
                    maxItems={unusualRows.length}
                    onClick={() => onSymClick?.(item.symbol)}
                  />
                ))}
              </div>
            ) : (
              renderEmptyLane(
                "No unusual options",
                "Prints meeting the selected OI threshold will appear here.",
              )
            )}
          </MarketActivityLaneSection>
        </div>

        <MarketActivityLaneSection
          title="Notifications"
          meta={`${notificationRows.length} secondary items`}
          compact
          testId="market-activity-notifications-lane"
          controls={
            <>
              {[
                ["ALERT", notificationTypeCounts.alerts, T.red],
                ["NEWS", notificationTypeCounts.news, T.accent],
                ["CAL", notificationTypeCounts.calendar, T.amber],
              ].map(([label, count, color]) => (
                <span
                  key={label}
                  style={{
                    color,
                    border: `1px solid ${color}44`,
                    background: `${color}12`,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    fontWeight: 900,
                    lineHeight: 1,
                    padding: sp("3px 4px"),
                    whiteSpace: "nowrap",
                  }}
                >
                  {label} {count}
                </span>
              ))}
            </>
          }
        >
          {notificationRows.length ? (
            <div
              className="ra-scrollbar-hidden"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: sp(4),
                overflowY: "auto",
                minHeight: 0,
                maxHeight: dim(116),
              }}
            >
              {notificationRows.map((item, index) => {
                const clickable =
                  Boolean(item.articleUrl) ||
                  (item.symbol && item.kind !== "news");
                return (
                  <MarketNotificationRow
                    key={item.id}
                    item={item}
                    index={index}
                    maxItems={notificationRows.length}
                    cursor={clickable ? "pointer" : "default"}
                    onClick={() => {
                      if (item.articleUrl && typeof window !== "undefined") {
                        window.open(item.articleUrl, "_blank", "noopener,noreferrer");
                        return;
                      }
                      if (item.symbol && item.kind !== "news") {
                        onSymClick?.(item.symbol);
                      }
                    }}
                  />
                );
              })}
            </div>
          ) : (
            renderEmptyLane(
              "No notifications",
              "Portfolio alerts, headlines, and upcoming calendar events will appear here.",
            )
          )}
        </MarketActivityLaneSection>
      </div>
    </Card>
  );
};

// MarketScreen extracted to ./screens/MarketScreen.jsx

// ═══════════════════════════════════════════════════════════════════
// SCREEN: FLOW (UOA Scanner)
// ═══════════════════════════════════════════════════════════════════

const getFlowOptionChartEmptyCopy = ({ emptyReason, requestFailed, feedIssue }) => {
  if (requestFailed) {
    return {
      title: "Option history unavailable",
      detail:
        "The chart request did not complete. Select another flow row or retry after the data service recovers.",
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

export const ContractDetailInline = ({ evt, onBack, onJumpToTrade }) => {
  const toast = useToast();
  const [alertSet, setAlertSet] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const providerContractId = evt?.providerContractId || null;
  const optionTicker =
    typeof (evt?.optionTicker || evt?.contract) === "string" &&
    (evt?.optionTicker || evt?.contract).trim()
      ? (evt?.optionTicker || evt?.contract).trim()
      : null;
  const chartSymbol = normalizeTickerSymbol(evt?.ticker || evt?.underlying || "");
  const optionExpirationIso = useMemo(
    () => normalizeFlowOptionExpirationIso(evt?.expirationDate || evt?.exp),
    [evt?.exp, evt?.expirationDate],
  );
  const optionRight = normalizeFlowOptionRight(evt?.right, evt?.cp);
  const optionStrike = normalizeFlowOptionStrike(evt?.strike);
  const [optionChartTimeframe, setOptionChartTimeframe] = useState("1m");
  const {
    favoriteTimeframes: optionFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleOptionFavoriteTimeframe,
  } = useChartTimeframeFavorites("option");
  const {
	    chartProviderContractId: effectiveProviderContractId,
	    displayBars: optionDisplayBars,
	    emptyOlderHistoryWindowCount: optionEmptyOlderHistoryWindowCount,
	    hasExhaustedOlderHistory: hasExhaustedOlderOptionHistory,
	    identityKey: optionContractIdentityKey,
	    identityReady: canRequestOptionChart,
	    isPrependingOlder: isPrependingOlderOptionHistory,
	    loadedBarCount: optionLoadedBaseBarCount,
	    oldestLoadedAtMs: optionOldestLoadedAtMs,
	    olderHistoryExhaustionReason: optionOlderHistoryExhaustionReason,
	    olderHistoryNextBeforeMs: optionOlderHistoryNextBeforeMs,
	    olderHistoryPageCount: optionOlderHistoryPageCount,
	    olderHistoryProvider: optionOlderHistoryProvider,
	    prependOlderBars: prependOlderOptionBars,
	    prewarmTimeframe: prewarmOptionTimeframe,
	    query: optionBarsQuery,
	  } = useOptionChartBars({
    scope: "flow-inspection",
    underlying: chartSymbol,
    expirationDate: optionExpirationIso,
    right: optionRight,
    strike: optionStrike,
    optionTicker,
    providerContractId,
    timeframe: optionChartTimeframe,
    enabled: true,
    liveEnabled: true,
    queryDefaults: BARS_QUERY_DEFAULTS,
    hydrationLabel: `${chartSymbol || "flow"} option inspection ${optionChartTimeframe}`,
    allowedTimeframes: OPTION_CHART_TIMEFRAMES,
    getPrewarmLimit: (nextTimeframe) =>
      getChartBarLimit(nextTimeframe, "option"),
  });
  const optionChartScopeKey = useMemo(
    () =>
      buildChartBarScopeKey(
        "flow-inspection-option-chart",
        optionContractIdentityKey,
        optionChartTimeframe,
      ),
	    [optionChartTimeframe, optionContractIdentityKey],
	  );
	  const handleOptionVisibleLogicalRangeChange = useCallback(
	    (range) => {
	      if (
	        !range ||
	        !canRequestOptionChart ||
	        hasExhaustedOlderOptionHistory ||
	        isPrependingOlderOptionHistory
	      ) {
	        return;
	      }

	      const visibleBars = Math.max(1, Math.ceil(range.to - range.from));
	      const leftEdgeBufferBars = Math.max(
	        24,
	        Math.min(144, Math.ceil(visibleBars * 0.2)),
	      );
	      if (range.from > leftEdgeBufferBars) {
	        return;
	      }

	      prependOlderOptionBars({
	        pageSize: Math.max(
	          getInitialChartBarLimit(optionChartTimeframe, "option"),
	          Math.ceil(visibleBars * 2),
	          240,
	        ),
	      });
	    },
	    [
	      canRequestOptionChart,
	      hasExhaustedOlderOptionHistory,
	      isPrependingOlderOptionHistory,
	      optionChartTimeframe,
	      prependOlderOptionBars,
	    ],
	  );
	  useEffect(() => {
	    recordChartBarScopeState(optionChartScopeKey, {
	      timeframe: optionChartTimeframe,
	      role: "option",
	      requestedLimit: getChartBarLimit(optionChartTimeframe, "option"),
	      initialLimit: getInitialChartBarLimit(optionChartTimeframe, "option"),
	      targetLimit: getChartBarLimit(optionChartTimeframe, "option"),
	      maxLimit: getMaxChartBarLimit(optionChartTimeframe, "option"),
	      hydratedBaseCount: optionLoadedBaseBarCount,
	      renderedBarCount: optionDisplayBars.length,
	      livePatchedBarCount: 0,
	      oldestLoadedAt: optionOldestLoadedAtMs
	        ? new Date(optionOldestLoadedAtMs).toISOString()
	        : null,
	      isPrependingOlder: isPrependingOlderOptionHistory,
	      hasExhaustedOlderHistory: hasExhaustedOlderOptionHistory,
	      olderHistoryNextBeforeAt: optionOlderHistoryNextBeforeMs
	        ? new Date(optionOlderHistoryNextBeforeMs).toISOString()
	        : null,
	      emptyOlderHistoryWindowCount: optionEmptyOlderHistoryWindowCount,
	      olderHistoryPageCount: optionOlderHistoryPageCount,
	      olderHistoryProvider: optionOlderHistoryProvider,
	      olderHistoryExhaustionReason: optionOlderHistoryExhaustionReason,
	    });
	  }, [
	    hasExhaustedOlderOptionHistory,
	    isPrependingOlderOptionHistory,
	    optionChartScopeKey,
	    optionChartTimeframe,
	    optionDisplayBars.length,
	    optionEmptyOlderHistoryWindowCount,
	    optionLoadedBaseBarCount,
	    optionOlderHistoryExhaustionReason,
	    optionOlderHistoryNextBeforeMs,
	    optionOlderHistoryPageCount,
	    optionOlderHistoryProvider,
	    optionOldestLoadedAtMs,
	  ]);
	  const optionChartModel = useMeasuredChartModel({
    scopeKey: optionChartScopeKey,
    bars: optionDisplayBars,
    buildInput: {
      bars: optionDisplayBars,
      timeframe: optionChartTimeframe,
      defaultVisibleBarCount: getChartBarLimit(optionChartTimeframe, "option"),
    },
    deps: [optionDisplayBars, optionChartTimeframe],
  });
  const optionLatestBar = optionDisplayBars[optionDisplayBars.length - 1] || null;
  const optionPreviousBar =
    optionDisplayBars.length > 1
      ? optionDisplayBars[optionDisplayBars.length - 2]
      : null;
  const optionLastPrice = optionLatestBar?.c ?? null;
  const optionChangePercent =
    isFiniteNumber(optionLastPrice) &&
    isFiniteNumber(optionPreviousBar?.c) &&
    optionPreviousBar.c !== 0
      ? ((optionLastPrice - optionPreviousBar.c) / optionPreviousBar.c) * 100
      : null;
  const isOptionChartLoading =
    canRequestOptionChart &&
    (optionBarsQuery.isPending || optionBarsQuery.fetchStatus === "fetching");
  const optionChartRequestFailed = Boolean(optionBarsQuery.isError);
  const optionChartEmptyReason = optionBarsQuery.data?.emptyReason || null;
  const optionChartFeedIssue = Boolean(optionBarsQuery.data?.feedIssue);
  const optionChartLoadingDetail = isOptionChartLoading
    ? "Resolving the option contract and requesting chart bars."
    : null;
  const optionChartStatusLabel = !canRequestOptionChart
    ? "missing option details"
    : isOptionChartLoading
      ? "loading option history"
      : optionChartRequestFailed
        ? "option history unavailable"
        : optionBarsQuery.data?.feedIssue &&
            optionBarsQuery.data?.dataSource === "polygon-option-aggregates"
          ? "IBKR feed issue · Polygon history"
          : optionBarsQuery.data?.dataSource === "polygon-option-aggregates"
            ? "Polygon option history"
            : optionBarsQuery.data?.dataSource === "ibkr-history"
              ? "IBKR option history"
              : optionBarsQuery.data?.resolutionSource === "none"
                ? "contract lookup unavailable"
                : "no option bars";
  const optionChartEmptyCopy = getFlowOptionChartEmptyCopy({
    emptyReason: optionChartEmptyReason,
    requestFailed: optionChartRequestFailed,
    feedIssue: optionChartFeedIssue,
  });

  if (!evt) return null;

  const isCall = evt.cp === "C";
  const cpColor = isCall ? T.green : T.red;
  const typeColor =
    evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple;
  const isSnapshotFlow = evt.basis === "snapshot";
  const voi =
    isFiniteNumber(evt.vol) && isFiniteNumber(evt.oi) && evt.oi > 0
      ? evt.vol / evt.oi
      : null;
  const sentimentScore = mapNewsSentimentToScore(evt.sentiment);
  const sideRead = isSnapshotFlow
    ? "Side inferred from bid/ask snapshot"
    : evt.side === "BUY"
      ? "Buyer initiated"
      : evt.side === "SELL"
        ? "Seller initiated"
        : "Side unavailable";
  const flowRead = isSnapshotFlow
    ? "Snapshot-derived active contract"
    : evt.type === "BLOCK"
      ? "Large negotiated block"
      : evt.type === "SWEEP"
        ? "Aggressive routed sweep"
        : "Single reported print";
  const fillPrice = isFiniteNumber(evt.premiumPrice)
    ? evt.premiumPrice
    : isFiniteNumber(evt.price)
      ? evt.price
      : null;
  const bidPrice = isFiniteNumber(evt.bid) ? evt.bid : null;
  const askPrice = isFiniteNumber(evt.ask) ? evt.ask : null;
  const fillSpread = (() => {
    if (!isFiniteNumber(fillPrice) || !isFiniteNumber(bidPrice) || !isFiniteNumber(askPrice)) {
      return {
        label: "N/A",
        shortLabel: "N/A",
        spread: null,
        spreadPct: null,
        color: T.textDim,
      };
    }
    if (askPrice < bidPrice) {
      return {
        label: "Crossed market",
        shortLabel: "CROSSED",
        spread: askPrice - bidPrice,
        spreadPct: null,
        color: T.amber,
      };
    }
    const spread = askPrice - bidPrice;
    const mid = (bidPrice + askPrice) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : null;
    if (spread <= 0) {
      return {
        label: "Locked market",
        shortLabel: "LOCK",
        spread,
        spreadPct,
        color: T.textDim,
      };
    }
    const position = (fillPrice - bidPrice) / spread;
    if (position < 0) {
      return { label: "Below bid", shortLabel: "BID-", spread, spreadPct, color: T.red };
    }
    if (position <= 0.1) {
      return { label: "At bid", shortLabel: "BID", spread, spreadPct, color: T.red };
    }
    if (position <= 0.4) {
      return { label: "Bid side", shortLabel: "BID", spread, spreadPct, color: T.red };
    }
    if (position <= 0.6) {
      return { label: "Mid", shortLabel: "MID", spread, spreadPct, color: T.textDim };
    }
    if (position <= 0.9) {
      return { label: "Ask side", shortLabel: "ASK", spread, spreadPct, color: isCall ? T.green : T.red };
    }
    if (position <= 1) {
      return { label: "At ask", shortLabel: "ASK", spread, spreadPct, color: isCall ? T.green : T.red };
    }
    return { label: "Above ask", shortLabel: "ASK+", spread, spreadPct, color: isCall ? T.green : T.red };
  })();

  const Stat = ({ label, value, color = T.text, mono = true }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        padding: sp("6px 8px"),
        background: T.bg3,
        borderRadius: dim(3),
      }}
    >
      <span
        style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.mono }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: fs(10),
          color,
          fontWeight: 700,
          fontFamily: mono ? T.mono : T.sans,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.15s ease-out" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          padding: sp("8px 12px"),
          marginBottom: sp(6),
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={onBack}
          title="Back to flow (Esc)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            padding: sp("5px 10px"),
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            color: T.textSec,
            fontSize: fs(10),
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: fs(12) }}>←</span> Back to flow
        </button>
        <div
          style={{
            width: dim(1),
            height: dim(22),
            background: T.border,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(6),
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          {evt.golden && (
            <span style={{ color: T.amber, fontSize: fs(14) }}>★</span>
          )}
          <span
            style={{
              fontSize: fs(16),
              fontWeight: 800,
              fontFamily: T.display,
              color: T.text,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {evt.ticker} {evt.strike} {isCall ? "Call" : "Put"}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: T.textDim,
              whiteSpace: "nowrap",
            }}
          >
            Exp {formatExpirationLabel(evt.expirationDate)}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: evt.dte <= 1 ? T.red : evt.dte <= 7 ? T.amber : T.textDim,
              fontWeight: 600,
            }}
          >
            {evt.dte}DTE
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: typeColor,
              fontWeight: 700,
              padding: sp("1px 6px"),
              background: T.bg3,
              borderRadius: dim(2),
            }}
          >
            {evt.type}
          </span>
          <Badge color={flowProviderColor(evt.provider)}>
            {evt.sourceLabel}
          </Badge>
        </div>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: sp(2),
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: fs(18),
              fontWeight: 800,
              fontFamily: T.mono,
              color: T.text,
            }}
          >
            {evt.premium >= 1e6
              ? `$${(evt.premium / 1e6).toFixed(2)}M`
              : `$${(evt.premium / 1e3).toFixed(0)}K`}
          </span>
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: T.textDim,
            }}
          >
            Flow premium • {evt.time} ET
          </span>
        </div>
        <div
          style={{
            width: dim(1),
            height: dim(22),
            background: T.border,
            flexShrink: 0,
          }}
        />
        <button
          onClick={() => onJumpToTrade && onJumpToTrade(evt)}
          style={{
            padding: sp("5px 10px"),
            background: T.accent,
            color: "#fff",
            border: "none",
            borderRadius: dim(4),
            cursor: "pointer",
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.sans,
            flexShrink: 0,
          }}
        >
          Open in Trade
        </button>
        <button
          onClick={() => {
            const next = !alertSet;
            setAlertSet(next);
            toast.push({
              kind: next ? "success" : "info",
              title: next ? "Alert set" : "Alert removed",
              body: next
                ? `${evt.ticker} ${evt.strike}${evt.cp} · Notify on next big activity (>$100K)`
                : `${evt.ticker} ${evt.strike}${evt.cp} · No longer watching this contract`,
            });
          }}
          style={{
            padding: sp("5px 10px"),
            background: alertSet ? `${T.amber}20` : "transparent",
            color: alertSet ? T.amber : T.textSec,
            border: `1px solid ${alertSet ? T.amber : T.border}`,
            borderRadius: dim(4),
            cursor: "pointer",
            fontSize: fs(10),
            fontWeight: 600,
            fontFamily: T.sans,
            flexShrink: 0,
          }}
        >
          🔔 {alertSet ? "Alert active" : "Set alert"}
        </button>
      </div>

      <div
        data-testid="flow-inline-execution-quality"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: sp(6),
          marginBottom: sp(6),
        }}
      >
        {[
          {
            label: "FILL",
            value: `${formatQuotePrice(fillPrice)} ${fillSpread.shortLabel}`,
            color: fillSpread.color,
          },
          {
            label: "BID",
            value: formatQuotePrice(bidPrice),
            color: T.textSec,
          },
          {
            label: "ASK",
            value: formatQuotePrice(askPrice),
            color: T.textSec,
          },
          {
            label: "SPREAD",
            value:
              isFiniteNumber(fillSpread.spread) &&
              isFiniteNumber(fillSpread.spreadPct)
                ? `${fillSpread.spread.toFixed(2)} / ${fillSpread.spreadPct.toFixed(1)}%`
                : fillSpread.shortLabel === "CROSSED"
                  ? "CROSSED"
                  : MISSING_VALUE,
            color:
              fillSpread.shortLabel === "CROSSED" ||
              (isFiniteNumber(fillSpread.spreadPct) && fillSpread.spreadPct > 10)
                ? T.amber
                : T.textDim,
          },
          {
            label: "SOURCE",
            value: evt.confidence || evt.sourceBasis || evt.sourceLabel,
            color: flowProviderColor(evt.provider),
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              padding: sp("6px 8px"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              minWidth: 0,
            }}
            title={item.label === "FILL" ? fillSpread.label : undefined}
          >
            <div
              style={{
                fontSize: fs(8),
                color: T.textMuted,
                fontFamily: T.mono,
                fontWeight: 700,
                marginBottom: sp(2),
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: fs(10),
                color: item.color,
                fontFamily: T.mono,
                fontWeight: 800,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 440px) minmax(0, 1fr)",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <Card style={{ padding: sp(8) }}>
            <div
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
                marginBottom: sp(4),
              }}
            >
              CONTRACT SNAPSHOT
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: sp(4),
              }}
            >
              <Stat label="SIDE" value={evt.side} color={evt.side === "BUY" ? T.green : evt.side === "SELL" ? T.red : T.textDim} />
              <Stat label="TYPE" value={evt.type} color={typeColor} />
              <Stat label="VOL" value={fmtCompactNumber(evt.vol)} />
              <Stat label="OI" value={fmtCompactNumber(evt.oi)} />
              <Stat
                label="V/OI"
                value={isFiniteNumber(voi) ? `${voi.toFixed(2)}x` : MISSING_VALUE}
                color={isFiniteNumber(voi) && voi > 1 ? T.amber : T.text}
              />
              <Stat
                label="IV"
                value={isFiniteNumber(evt.iv) ? `${(evt.iv * 100).toFixed(1)}%` : MISSING_VALUE}
                color={isFiniteNumber(evt.iv) ? T.cyan : T.textDim}
              />
              <Stat label="PREM" value={fmtM(evt.premium)} color={T.amber} />
              <Stat label="SCORE" value={evt.score} color={evt.score >= 80 ? T.amber : evt.score >= 60 ? T.green : T.text} />
            </div>
          </Card>

          <Card style={{ padding: sp(8) }}>
            <div
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
                marginBottom: sp(4),
              }}
            >
              EVENT READ
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(6),
                fontSize: fs(10),
                lineHeight: 1.45,
                color: T.textSec,
                fontFamily: T.sans,
              }}
            >
              <div>
                <span style={{ color: cpColor, fontWeight: 700 }}>
                  {isCall ? "Call flow" : "Put flow"}
                </span>{" "}
                with a provider-reported {evt.side.toLowerCase()} side. This panel
                now shows only event fields that came back from the live flow
                provider.
              </div>
              <div>
                <span style={{ color: T.text, fontWeight: 700 }}>{flowRead}</span>
                {" · "}
                <span
                  style={{
                    color:
                      sentimentScore > 0
                        ? T.green
                        : sentimentScore < 0
                          ? T.red
                          : T.textDim,
                    fontWeight: 700,
                  }}
                >
                  {evt.sentiment || "sentiment unavailable"}
                </span>
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono }}>
                {sideRead}
                {evt.tradeConditions?.length
                  ? ` • cond ${evt.tradeConditions.join(", ")}`
                  : ""}
              </div>
            </div>
          </Card>
        </div>

        <Card
          style={{
            padding: sp(10),
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: dim(420),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: sp(5),
            }}
          >
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
              }}
            >
              OPTION CHART
            </span>
            <span
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              {optionChartStatusLabel}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
            }}
          >
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <ResearchChartFrame
                dataTestId="flow-inspection-option-chart"
                theme={T}
                themeKey={`${getCurrentTheme()}-flow-inspection-option`}
                surfaceUiStateKey={`flow-inspection-option-${effectiveProviderContractId || optionChartScopeKey}`}
                rangeIdentityKey={optionChartScopeKey}
	                model={optionChartModel}
	                onVisibleLogicalRangeChange={handleOptionVisibleLogicalRangeChange}
	                showSurfaceToolbar={false}
                showLegend
                legend={{
                  symbol: chartSymbol || "OPTION",
                  name: evt.optionTicker || evt.contract || "Flow option",
                  timeframe: optionChartTimeframe,
                  statusLabel: optionChartStatusLabel,
                  priceLabel: "Option",
                  price: optionLastPrice,
                  changePercent: optionChangePercent,
                  meta: {
                    open: optionLatestBar?.o,
                    high: optionLatestBar?.h,
                    low: optionLatestBar?.l,
                    close: optionLatestBar?.c,
                    volume: optionLatestBar?.v,
                    timestamp: optionLatestBar?.ts,
                    sourceLabel: optionChartStatusLabel,
                  },
                }}
                compact
                style={{ minHeight: 0, width: "100%" }}
                surfaceTopOverlay={(controls) => (
                  <ResearchChartWidgetHeader
                    theme={T}
                    controls={controls}
                    symbol={chartSymbol || "OPTION"}
                    name={evt.optionTicker || evt.contract || "Flow option"}
                    priceLabel="Option"
                    price={optionLastPrice}
                    changePercent={optionChangePercent}
                    statusLabel={optionChartStatusLabel}
                    timeframe={optionChartTimeframe}
                    showInlineLegend={false}
                    timeframeOptions={OPTION_CHART_TIMEFRAMES}
                    favoriteTimeframes={optionFavoriteTimeframes}
                    onChangeTimeframe={setOptionChartTimeframe}
                    onToggleFavoriteTimeframe={toggleOptionFavoriteTimeframe}
                    onPrewarmTimeframe={prewarmOptionTimeframe}
                    dense
                    meta={{
                      open: optionLatestBar?.o,
                      high: optionLatestBar?.h,
                      low: optionLatestBar?.l,
                      close: optionLatestBar?.c,
                      volume: optionLatestBar?.v,
                      timestamp: optionLatestBar?.ts,
                      sourceLabel: optionChartStatusLabel,
                    }}
                    showSnapshotButton={false}
                  />
                )}
                surfaceTopOverlayHeight={28}
                surfaceBottomOverlay={(controls) => (
                  <ResearchChartWidgetFooter
                    theme={T}
                    controls={controls}
                    dense
                    statusText={optionChartStatusLabel}
                  />
                )}
                surfaceBottomOverlayHeight={20}
              />
              {!optionDisplayBars.length ? (
                <div
                  style={{
                    position: "absolute",
                    top: sp(30),
                    right: 0,
                    bottom: sp(22),
                    left: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                    padding: sp(12),
                  }}
                >
                  <DataUnavailableState
                    loading={Boolean(optionChartLoadingDetail)}
                    title={
                      optionChartLoadingDetail
                        ? "Loading option history"
                        : !canRequestOptionChart
                          ? "Missing option details"
                          : optionChartEmptyCopy.title
                    }
                    detail={
                      optionChartLoadingDetail
                        ? optionChartLoadingDetail
                        : !canRequestOptionChart
                          ? "This flow event is missing expiration, side, or strike details needed for charting."
                          : optionChartEmptyCopy.detail
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

// FlowScreen extracted to ./screens/FlowScreen.jsx

// ═══════════════════════════════════════════════════════════════════
// SCREEN: TRADE
// ═══════════════════════════════════════════════════════════════════

// ─── Trade tab sub-components ───

const TRADE_TIMEFRAMES = getChartTimeframeOptions("primary").map((option) => ({
  v: option.value,
  bars: getChartBarLimit(option.value, "primary"),
  tag: option.label,
}));
const TRADE_OPTION_TIMEFRAMES = getChartTimeframeOptions("option").map((option) => ({
  v: option.value,
  bars: getChartBarLimit(option.value, "option"),
  tag: option.label,
}));

// Custom SVG candlestick chart (Recharts has no native candle component).
// Renders OHLC candles with wicks, Y-axis price labels, day-open ref line,
// flow markers as vertical dashed lines, optional drawing layer (horizontal levels),
// and a crosshair with price label on hover.
const CandleChart = ({
  bars,
  markers,
  drawings,
  onAddDrawing,
  drawMode,
  height,
}) => {
  const w = 800;
  const H = height || 240;
  const padL = 38,
    padR = 8,
    padT = 6,
    padB = 16;
  const chartW = w - padL - padR;
  const chartH = H - padT - padB;

  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const range = hi - lo;
  const pad = range * 0.05;
  const yMin = lo - pad,
    yMax = hi + pad;
  const yScale = (p) => padT + chartH - ((p - yMin) / (yMax - yMin)) * chartH;
  const xScale = (i) => padL + (i / (bars.length - 1)) * chartW;
  const candleW = Math.max(2, (chartW / bars.length) * 0.7);

  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * w;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    if (sx < padL || sx > w - padR) {
      setHover(null);
      return;
    }
    const i = Math.round(((sx - padL) / chartW) * (bars.length - 1));
    const idx = Math.max(0, Math.min(bars.length - 1, i));
    const price = yMin + ((padT + chartH - sy) / chartH) * (yMax - yMin);
    setHover({ idx, sx, sy, price });
  };
  const handleMouseLeave = () => setHover(null);

  const handleClick = (e) => {
    if (!drawMode || !onAddDrawing) return;
    e.stopPropagation();
    if (hover) {
      onAddDrawing({ type: drawMode, price: hover.price, barIdx: hover.idx });
    }
  };

  const yTicks = [];
  for (let t = 0; t < 5; t++) {
    yTicks.push(yMin + ((yMax - yMin) * t) / 4);
  }
  const dayOpen = bars[0]?.o;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          cursor: drawMode ? "crosshair" : "default",
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {/* Y-axis grid + labels */}
        {yTicks.flatMap((p, i) => [
          <line
            key={`yg${i}`}
            x1={padL}
            y1={yScale(p)}
            x2={w - padR}
            y2={yScale(p)}
            stroke={T.border}
            strokeWidth={0.5}
            strokeOpacity={0.5}
          />,
          <text
            key={`yt${i}`}
            x={padL - 4}
            y={yScale(p) + 3}
            fill={T.textMuted}
            fontSize={9}
            fontFamily={T.mono}
            textAnchor="end"
          >
            {p.toFixed(2)}
          </text>,
        ])}
        {/* Day open ref line */}
        <line
          x1={padL}
          y1={yScale(dayOpen)}
          x2={w - padR}
          y2={yScale(dayOpen)}
          stroke={T.textMuted}
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
        {/* Flow markers (vertical) */}
        {(markers || []).map((m, i) => (
          <line
            key={`mk${i}`}
            x1={xScale(m.barIdx)}
            y1={padT}
            x2={xScale(m.barIdx)}
            y2={padT + chartH}
            stroke={m.cp === "C" ? T.green : T.red}
            strokeWidth={m.golden ? 1.5 : m.size === "lg" ? 1 : 0.6}
            strokeDasharray={m.golden ? "0" : m.size === "sm" ? "2 3" : "3 2"}
            strokeOpacity={m.golden ? 0.85 : m.size === "lg" ? 0.6 : 0.35}
          />
        ))}
        {/* Candles (wick + body, two elements per bar) */}
        {bars.flatMap((b, i) => {
          const up = b.c >= b.o;
          const c = up ? T.green : T.red;
          const x = xScale(i);
          const bodyTop = yScale(Math.max(b.o, b.c));
          const bodyBot = yScale(Math.min(b.o, b.c));
          return [
            <line
              key={`cw${i}`}
              x1={x}
              y1={yScale(b.h)}
              x2={x}
              y2={yScale(b.l)}
              stroke={c}
              strokeWidth={1}
            />,
            <rect
              key={`cb${i}`}
              x={x - candleW / 2}
              y={bodyTop}
              width={candleW}
              height={Math.max(1, bodyBot - bodyTop)}
              fill={c}
              stroke={c}
              strokeWidth={0.5}
            />,
          ];
        })}
        {/* Drawings (horizontal levels) */}
        {(drawings || []).map((d, i) =>
          d.type === "horizontal" ? (
            <line
              key={`dr${i}`}
              x1={padL}
              y1={yScale(d.price)}
              x2={w - padR}
              y2={yScale(d.price)}
              stroke={T.amber}
              strokeWidth={1.2}
              strokeDasharray="5 3"
            />
          ) : null,
        )}
        {/* Crosshair */}
        {hover && [
          <line
            key="chx"
            x1={hover.sx}
            y1={padT}
            x2={hover.sx}
            y2={padT + chartH}
            stroke={T.textSec}
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />,
          <line
            key="chy"
            x1={padL}
            y1={hover.sy}
            x2={w - padR}
            y2={hover.sy}
            stroke={T.textSec}
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />,
          <rect
            key="chr"
            x={w - padR - 50}
            y={hover.sy - 8}
            width={48}
            height={16}
            fill={T.bg4}
            stroke={T.border}
          />,
          <text
            key="cht"
            x={w - padR - 4}
            y={hover.sy + 3}
            fill={T.text}
            fontSize={9}
            fontFamily={T.mono}
            textAnchor="end"
            fontWeight={600}
          >
            {hover.price.toFixed(2)}
          </text>,
        ]}
      </svg>
      {/* OHLCV tooltip */}
      {hover && bars[hover.idx] && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: padL + 4,
            background: `${T.bg4}ee`,
            border: `1px solid ${T.border}`,
            borderRadius: dim(3),
            padding: sp("3px 8px"),
            fontSize: fs(9),
            fontFamily: T.mono,
            color: T.textSec,
            pointerEvents: "none",
            display: "flex",
            gap: sp(6),
          }}
        >
          <span>
            O{" "}
            <span style={{ color: T.text }}>
              {bars[hover.idx].o.toFixed(2)}
            </span>
          </span>
          <span>
            H{" "}
            <span style={{ color: T.green }}>
              {bars[hover.idx].h.toFixed(2)}
            </span>
          </span>
          <span>
            L{" "}
            <span style={{ color: T.red }}>{bars[hover.idx].l.toFixed(2)}</span>
          </span>
          <span>
            C{" "}
            <span style={{ color: T.text, fontWeight: 600 }}>
              {bars[hover.idx].c.toFixed(2)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

const TradeOptionChart = ({
  bars,
  color,
  contract,
  holding,
  timeframe = "5m",
  sourceLabel = "no live chart data",
  hydrationScopeKey,
  onChangeTimeframe,
  onOpenSearch,
  searchOpen,
  onSearchOpenChange,
  searchContent,
  onVisibleLogicalRangeChange,
}) => {
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
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
  const defaultVisibleBarCount = getChartBarLimit(timeframe, "option");
  const chartModel = useMeasuredChartModel({
    scopeKey:
      hydrationScopeKey ||
      buildChartBarScopeKey("trade-option-chart", contract, timeframe),
    bars,
    buildInput: {
      bars,
      timeframe,
      defaultVisibleBarCount,
      selectedIndicators,
      indicatorSettings,
      indicatorRegistry,
    },
    deps: [
      bars,
      defaultVisibleBarCount,
      indicatorRegistry,
      indicatorSettings,
      selectedIndicators,
      timeframe,
    ],
  });
  const referenceLines = useMemo(
    () =>
      Number.isFinite(holding?.entry)
        ? [
            {
              price: holding.entry,
              color: T.amber,
              title: "ENTRY",
              lineWidth: 2,
              axisLabelVisible: true,
            },
          ]
        : [],
    [holding],
  );
  const latestBar = bars[bars.length - 1];
  const previousClose =
    bars.length > 1 ? (bars[bars.length - 2]?.c ?? null) : null;
  const lastPrice = latestBar?.c ?? bars[bars.length - 1]?.p ?? null;
  const changePercent =
    Number.isFinite(lastPrice) &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
      ? ((lastPrice - previousClose) / previousClose) * 100
      : null;
  const toggleIndicator = (indicatorId) => {
    setSelectedIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };

  useEffect(() => {
    persistState({
      tradeOptionSelectedIndicators: selectedIndicators,
      tradeOptionIndicatorPresetVersion: TRADE_OPTION_INDICATOR_PRESET_VERSION,
    });
  }, [selectedIndicators]);

  useEffect(() => {
    persistState({ tradeOptionRayReplicaSettings: rayReplicaSettings });
  }, [rayReplicaSettings]);

  return (
    <ResearchChartFrame
      dataTestId="trade-option-chart"
      theme={T}
      themeKey={`${getCurrentTheme()}-trade-option`}
      surfaceUiStateKey="trade-option-chart"
      rangeIdentityKey={
        hydrationScopeKey ||
        buildChartBarScopeKey("trade-option-chart", contract, timeframe)
      }
      model={chartModel}
      referenceLines={referenceLines}
      showSurfaceToolbar={false}
      showLegend
      legend={{
        symbol: contract,
        name: holding ? "Held option contract" : "Option contract",
        timeframe,
        statusLabel: sourceLabel,
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
          sourceLabel,
        },
        studies: availableStudies,
        selectedStudies: selectedIndicators,
      }}
      onVisibleLogicalRangeChange={onVisibleLogicalRangeChange}
      surfaceTopOverlay={(controls) => (
        <ResearchChartWidgetHeader
          theme={T}
          controls={controls}
          symbol={contract}
          name={holding ? "Held option contract" : "Option contract"}
          price={lastPrice}
          changePercent={changePercent}
          statusLabel={sourceLabel}
          timeframe={timeframe}
          showInlineLegend={false}
          timeframeOptions={TRADE_OPTION_TIMEFRAMES.map((entry) => ({
            value: entry.v,
            label: entry.tag,
          }))}
          onChangeTimeframe={onChangeTimeframe}
          onOpenSearch={onOpenSearch}
          searchOpen={searchOpen}
          onSearchOpenChange={onSearchOpenChange}
          searchContent={searchContent}
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
            sourceLabel,
          }}
          rightSlot={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
              }}
            >
              {holding ? (
                <span
                  style={{
                    fontSize: fs(7),
                    padding: sp("1px 4px"),
                    borderRadius: dim(2),
                    background: `${T.amber}20`,
                    color: T.amber,
                    border: `1px solid ${T.amber}40`,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}
                >
                  ★ HOLDING
                </span>
              ) : null}
              <RayReplicaSettingsMenu
                theme={T}
                settings={rayReplicaSettings}
                onChange={setRayReplicaSettings}
                disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
              />
            </div>
          }
        />
      )}
      surfaceTopOverlayHeight={40}
      surfaceBottomOverlay={(controls) => (
        <ResearchChartWidgetFooter
          theme={T}
          controls={controls}
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          statusText={sourceLabel}
        />
      )}
      surfaceBottomOverlayHeight={22}
    />
  );
};

const TradeOptionsChain = ({
  chain,
  selected,
  onSelect,
  heldStrikes,
  atmStrike = null,
}) => {
  const scrollRef = useRef(null);
  const gridTemplateColumns =
    "48px 48px 52px 48px 56px 60px 60px 68px 72px 68px 60px 60px 56px 48px 52px 48px 48px";
  const chainWindowKey = `${chain.length}:${chain[0]?.k ?? "na"}:${chain[chain.length - 1]?.k ?? "na"}`;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;

    const frame = requestAnimationFrame(() => {
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
    });

    return () => cancelAnimationFrame(frame);
  }, [chainWindowKey]);

  const formatGreek = (value) =>
    value == null || Number.isNaN(value) ? MISSING_VALUE : value.toFixed(3);
  const formatIv = (value) =>
    value == null || Number.isNaN(value)
      ? MISSING_VALUE
      : `${(value * 100).toFixed(1)}%`;
  const formatPrice = (value, held) =>
    value == null || Number.isNaN(value)
      ? MISSING_VALUE
      : `${held ? "★ " : ""}${value.toFixed(2)}`;
  const formatVolume = (value, hot) =>
    value == null || Number.isNaN(value)
      ? MISSING_VALUE
      : `${hot ? "⚡" : ""}${fmtCompactNumber(value)}`;
  const columns = [
    {
      key: "cGamma",
      label: "Γ",
      side: "C",
      align: "right",
      color: T.purple,
      format: formatGreek,
    },
    {
      key: "cTheta",
      label: "Θ",
      side: "C",
      align: "right",
      color: T.red,
      format: formatGreek,
    },
    {
      key: "cVega",
      label: "V",
      side: "C",
      align: "right",
      color: T.cyan,
      format: formatGreek,
    },
    {
      key: "cDelta",
      label: "Δ",
      side: "C",
      align: "right",
      color: T.textSec,
      format: (value) => (value == null ? MISSING_VALUE : value.toFixed(2)),
    },
    {
      key: "cIv",
      label: "IV",
      side: "C",
      align: "right",
      color: T.textDim,
      format: formatIv,
    },
    {
      key: "cOi",
      label: "OI",
      side: "C",
      align: "right",
      color: T.textDim,
      format: (value) => fmtCompactNumber(value),
    },
    {
      key: "cVol",
      label: "VOL",
      side: "C",
      align: "right",
      color: T.textDim,
      hot: true,
      format: (value, row) =>
        formatVolume(value, row.cVol / Math.max(row.cOi, 1) > 0.5),
    },
    {
      key: "cPrem",
      label: "LAST",
      side: "C",
      align: "right",
      color: T.green,
      heldAware: true,
      format: (value, _row, held) => formatPrice(value, held),
    },
    {
      key: "k",
      label: "STRIKE",
      side: null,
      align: "center",
      strike: true,
      format: (value) => value,
    },
    {
      key: "pPrem",
      label: "LAST",
      side: "P",
      align: "left",
      color: T.red,
      heldAware: true,
      format: (value, _row, held) => formatPrice(value, held),
    },
    {
      key: "pVol",
      label: "VOL",
      side: "P",
      align: "left",
      color: T.textDim,
      hot: true,
      format: (value, row) =>
        formatVolume(value, row.pVol / Math.max(row.pOi, 1) > 0.5),
    },
    {
      key: "pOi",
      label: "OI",
      side: "P",
      align: "left",
      color: T.textDim,
      format: (value) => fmtCompactNumber(value),
    },
    {
      key: "pIv",
      label: "IV",
      side: "P",
      align: "left",
      color: T.textDim,
      format: formatIv,
    },
    {
      key: "pDelta",
      label: "Δ",
      side: "P",
      align: "left",
      color: T.textSec,
      format: (value) => (value == null ? MISSING_VALUE : value.toFixed(2)),
    },
    {
      key: "pVega",
      label: "V",
      side: "P",
      align: "left",
      color: T.cyan,
      format: formatGreek,
    },
    {
      key: "pTheta",
      label: "Θ",
      side: "P",
      align: "left",
      color: T.red,
      format: formatGreek,
    },
    {
      key: "pGamma",
      label: "Γ",
      side: "P",
      align: "left",
      color: T.purple,
      format: formatGreek,
    },
  ];

  return (
    <div
      ref={scrollRef}
      style={{
        height: "100%",
        overflow: "auto",
        fontSize: fs(9),
        fontFamily: T.mono,
        touchAction: "pan-x pan-y",
      }}
    >
      <div style={{ minWidth: 980 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns,
            gap: sp(2),
            padding: sp("3px 6px"),
            borderBottom: `1px solid ${T.border}`,
            position: "sticky",
            top: 0,
            background: T.bg2,
            zIndex: 1,
          }}
        >
          {columns.map((column) => (
            <span
              key={column.key}
              style={{
                color: T.textMuted,
                fontSize: fs(7),
                textAlign: column.align,
                letterSpacing: "0.06em",
                fontWeight: column.strike ? 700 : 600,
              }}
            >
              {column.label}
            </span>
          ))}
        </div>
        {chain.map((row) => {
          const isAtmRow = atmStrike != null ? row.k === atmStrike : row.isAtm;
          return (
          <div
            key={row.k}
            style={{
              display: "grid",
              gridTemplateColumns,
              gap: sp(2),
              padding: sp("2px 6px"),
              borderBottom: `1px solid ${T.border}10`,
              background: isAtmRow ? `${T.accent}08` : "transparent",
            }}
          >
            {columns.map((column) => {
              if (column.strike) {
                return (
                  <span
                    key={column.key}
                    style={{
                      color: isAtmRow ? T.accent : T.text,
                      fontWeight: 700,
                      textAlign: "center",
                    }}
                  >
                    {column.format(row[column.key], row, false)}
                  </span>
                );
              }

              const isSelected =
                selected &&
                selected.strike === row.k &&
                selected.cp === column.side;
              const held = Boolean(
                heldStrikes &&
                heldStrikes.find(
                  (item) => item.strike === row.k && item.cp === column.side,
                ),
              );
              const background = isSelected
                ? `${column.side === "C" ? T.green : T.red}25`
                : held && column.heldAware
                  ? `${T.amber}18`
                  : "transparent";
              const border =
                held && column.heldAware
                  ? `1px solid ${T.amber}60`
                  : "1px solid transparent";
              const value = row[column.key];

              return (
                <span
                  key={column.key}
                  onClick={() => onSelect(row.k, column.side)}
                  style={{
                    color: column.hot
                      ? (column.side === "C"
                          ? row.cVol / Math.max(row.cOi, 1)
                          : row.pVol / Math.max(row.pOi, 1)) > 0.5
                        ? T.amber
                        : column.color
                      : column.color,
                    fontWeight:
                      column.key.endsWith("Prem") || column.hot ? 600 : 500,
                    textAlign: column.align,
                    cursor: "pointer",
                    padding: sp("0 2px"),
                    background,
                    borderRadius: dim(2),
                    border,
                  }}
                >
                  {column.format(value, row, held)}
                </span>
              );
            })}
          </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── PAYOFF DIAGRAM ───
// SVG visualization of the option's P&L at expiration as a function of underlying price.
// Replaces the static breakeven/max-loss/POP grid with a payoff curve.
// Side-aware: BUY (long) vs SELL (short) flip the curve.
const PayoffDiagram = ({
  optType,
  strike,
  premium,
  qty,
  currentPrice,
  side,
}) => {
  const isCall = optType === "C";
  const isLong = side === "BUY";
  const debit = premium * qty * 100;
  const resolvedCurrentPrice = isFiniteNumber(currentPrice)
    ? currentPrice
    : isFiniteNumber(strike)
      ? strike
      : 1;

  // P&L at expiration for any underlying price S
  const pnl = (S) => {
    const intrinsic = isCall
      ? Math.max(0, S - strike)
      : Math.max(0, strike - S);
    const longPnl = (intrinsic - premium) * qty * 100;
    return isLong ? longPnl : -longPnl;
  };

  // X range: 25% above and below current price gives enough room for visible breakeven
  const xMin = resolvedCurrentPrice * 0.75;
  const xMax = resolvedCurrentPrice * 1.25;
  const STEPS = 80;
  const points = [];
  for (let i = 0; i <= STEPS; i++) {
    const S = xMin + (xMax - xMin) * (i / STEPS);
    points.push({ s: S, p: pnl(S) });
  }

  // Y range
  const yMax = Math.max(...points.map((p) => p.p));
  const yMin = Math.min(...points.map((p) => p.p));
  const yRange = Math.max(yMax - yMin, 1);
  const yPad = yRange * 0.18;
  const yTop = yMax + yPad;
  const yBot = yMin - yPad;

  // Breakeven price
  const breakeven = isCall ? strike + premium : strike - premium;

  // Determine if max profit/loss is theoretically capped or unlimited
  // BUY CALL: max loss = debit (capped), max profit = ∞
  // BUY PUT:  max loss = debit (capped), max profit = (strike - prem) * qty * 100 (capped)
  // SELL CALL: max profit = credit (capped), max loss = ∞
  // SELL PUT:  max profit = credit (capped), max loss = (strike - prem) * qty * 100 (capped)
  const maxProfitUnlimited =
    (isLong && isCall) || (!isLong && !isCall && false); // selling put has capped loss but profit is the credit
  const maxLossUnlimited = !isLong && isCall; // selling naked call

  const visibleMaxProfit = Math.max(...points.map((p) => p.p));
  const visibleMaxLoss = Math.min(...points.map((p) => p.p));

  // SVG dimensions
  const W = 280,
    H = 120;
  const padL = 6,
    padR = 6,
    padT = 18,
    padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xOf = (s) => padL + ((s - xMin) / (xMax - xMin)) * innerW;
  const yOf = (p) => padT + ((yTop - p) / (yTop - yBot)) * innerH;
  const y0 = yOf(0);

  // Split curve into segments at zero crossings, color each by sign
  const segments = [];
  let currentSeg = [];
  let currentSign = null;
  points.forEach((p) => {
    const sign = p.p >= 0 ? "+" : "-";
    if (currentSign === null) {
      currentSign = sign;
      currentSeg.push(p);
    } else if (sign === currentSign) {
      currentSeg.push(p);
    } else {
      const prev = currentSeg[currentSeg.length - 1];
      // Linear interpolation to find zero crossing
      const t = -prev.p / (p.p - prev.p);
      const crossX = prev.s + t * (p.s - prev.s);
      const crossPoint = { s: crossX, p: 0 };
      currentSeg.push(crossPoint);
      segments.push({ sign: currentSign, points: currentSeg });
      currentSeg = [crossPoint, p];
      currentSign = sign;
    }
  });
  if (currentSeg.length > 0)
    segments.push({ sign: currentSign, points: currentSeg });

  // Tick prices for the x-axis: just current and strike (those are the anchors that matter)
  const fmtMoney = (v) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`;

  return (
    <div style={{ background: T.bg3, borderRadius: dim(3), padding: sp(4) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: sp("0 4px 2px"),
          fontSize: fs(7),
          fontFamily: T.mono,
          color: T.textMuted,
          letterSpacing: "0.06em",
        }}
      >
        <span>P&L AT EXPIRATION</span>
        <span style={{ display: "flex", gap: sp(6) }}>
          <span>
            <span style={{ color: T.accent }}>━</span> now $
            {isFiniteNumber(currentPrice)
              ? currentPrice.toFixed(2)
              : MISSING_VALUE}
          </span>
          <span>
            <span style={{ color: T.amber }}>┃</span> strike ${strike}
          </span>
        </span>
      </div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        {/* Zero P&L line */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={y0}
          y2={y0}
          stroke={T.textMuted}
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.5}
        />

        {/* Filled areas under each segment */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const fillColor = seg.sign === "+" ? T.green : T.red;
          const linePath = seg.points
            .map((p) => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`)
            .join(" L ");
          const firstX = xOf(seg.points[0].s).toFixed(1);
          const lastX = xOf(seg.points[seg.points.length - 1].s).toFixed(1);
          const fillD = `M ${firstX},${y0} L ${linePath} L ${lastX},${y0} Z`;
          return (
            <path
              key={`fill-${i}`}
              d={fillD}
              fill={fillColor}
              fillOpacity={0.13}
            />
          );
        })}

        {/* Strike vertical line */}
        {strike >= xMin && strike <= xMax && (
          <line
            x1={xOf(strike)}
            x2={xOf(strike)}
            y1={padT}
            y2={padT + innerH}
            stroke={T.amber}
            strokeWidth={0.8}
            strokeDasharray="2 2"
            opacity={0.7}
          />
        )}

        {/* Breakeven vertical line */}
        {breakeven >= xMin && breakeven <= xMax && (
          <>
            <line
              x1={xOf(breakeven)}
              x2={xOf(breakeven)}
              y1={padT}
              y2={padT + innerH}
              stroke={T.textDim}
              strokeWidth={0.6}
              strokeDasharray="3 2"
            />
            <text
              x={xOf(breakeven)}
              y={padT - 4}
              fontSize={fs(8)}
              fontFamily={T.mono}
              fill={T.textDim}
              textAnchor="middle"
              fontWeight={600}
            >
              BE ${breakeven.toFixed(2)}
            </text>
          </>
        )}

        {/* Current price vertical line */}
        {currentPrice >= xMin && currentPrice <= xMax && (
          <line
            x1={xOf(currentPrice)}
            x2={xOf(currentPrice)}
            y1={padT}
            y2={padT + innerH}
            stroke={T.accent}
            strokeWidth={1.2}
            opacity={0.9}
          />
        )}

        {/* Curve segments */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const lineColor = seg.sign === "+" ? T.green : T.red;
          const lineD =
            "M " +
            seg.points
              .map((p) => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`)
              .join(" L ");
          return (
            <path
              key={`line-${i}`}
              d={lineD}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
          );
        })}

        {/* Top right: max profit label */}
        <text
          x={W - padR - 2}
          y={padT - 2}
          fontSize={fs(8)}
          fontFamily={T.mono}
          fill={T.green}
          textAnchor="end"
          fontWeight={700}
        >
          {maxProfitUnlimited ? "Max +∞" : `Max +${fmtMoney(visibleMaxProfit)}`}
        </text>
        {/* Bottom right: max loss label */}
        <text
          x={W - padR - 2}
          y={H - 4}
          fontSize={fs(8)}
          fontFamily={T.mono}
          fill={T.red}
          textAnchor="end"
          fontWeight={700}
        >
          {maxLossUnlimited ? "Max −∞" : `Max ${fmtMoney(visibleMaxLoss)}`}
        </text>

        {/* X axis baseline */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={padT + innerH}
          y2={padT + innerH}
          stroke={T.border}
          strokeWidth={0.5}
        />
        {/* X axis ticks */}
        <text
          x={padL}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.mono}
          fill={T.textMuted}
        >
          ${xMin.toFixed(0)}
        </text>
        <text
          x={padL + innerW}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.mono}
          fill={T.textMuted}
          textAnchor="end"
        >
          ${xMax.toFixed(0)}
        </text>
      </svg>
    </div>
  );
};

export const TradeOrderTicket = ({
  slot,
  chainRows = [],
  expiration,
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  automationContext = null,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { preferences: ticketPreferences } = useUserPreferences();
  const confirmBrokerOrders = ticketPreferences.trading.confirmOrders !== false;
  const objectValue = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = useMemo(
    () => ensureTradeTickerInfo(slot.ticker, slot.ticker),
    [slot.ticker],
  );
  const info = useRuntimeTickerSnapshot(slot.ticker, fallback);
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((r) => r.k === slot.strike);
  const prem = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : null;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : null;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : null;
  const rawDelta = row ? (slot.cp === "C" ? row.cDelta : row.pDelta) : null;
  const spread =
    isFiniteNumber(ask) && isFiniteNumber(bid) ? ask - bid : null;
  const spreadPct =
    isFiniteNumber(spread) && isFiniteNumber(prem) && prem > 0
      ? (spread / prem) * 100
      : null;
  const delta = isFiniteNumber(rawDelta) ? Math.abs(rawDelta) : null;
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const expInfo = expiration || {
    value: slot.exp,
    label: slot.exp,
    dte: daysToExpiration(slot.exp),
    actualDate: parseExpirationValue(slot.exp),
  };
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const [ticketAssetMode, setTicketAssetMode] = useState("option");
  const normalizedTicketAssetMode = normalizeTicketAssetMode(ticketAssetMode);
  const ticketIsShares = normalizedTicketAssetMode === "equity";
  const ticketIsOptions = !ticketIsShares;
  const equityPrice = isFiniteNumber(info?.price) ? info.price : null;
  const optionQuoteReady =
    Boolean(row) &&
    isFiniteNumber(prem) &&
    isFiniteNumber(bid) &&
    isFiniteNumber(ask) &&
    isFiniteNumber(rawDelta);
  const equityQuoteReady = isFiniteNumber(equityPrice);
  const optionTicketReady =
    optionQuoteReady && Boolean(selectedContractMeta && expInfo.actualDate);
  const shareTicketReady = Boolean(slot.ticker);
  const ticketReferencePrice = ticketIsShares ? equityPrice : prem;
  const ticketInstrumentReady = ticketIsShares
    ? shareTicketReady
    : optionTicketReady;
  const ticketInstrumentLabel = ticketIsShares
    ? slot.ticker
    : `${slot.ticker} ${slot.strike}${slot.cp}`;
  const ticketInstrumentDetail = ticketIsShares
    ? "SHARES"
    : `${expInfo.label || slot.exp} · ${expInfo.dte}d`;
  const ticketQuantityUnit = ticketIsShares ? "shares" : "contracts";
  const ticketAssetClass = ticketIsShares ? "equity" : "option";
  const ticketMultiplier = ticketIsShares ? 1 : 100;
  const automationTicketContext = ticketIsOptions ? automationContext : null;
  const contractDateKey = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value).slice(0, 10)
      : date.toISOString().slice(0, 10);
  };
  const optionContractsMatch = (left, right) => {
    const leftContract = objectValue(left);
    const rightContract = objectValue(right);
    const leftProvider = String(leftContract.providerContractId || "");
    const rightProvider = String(rightContract.providerContractId || "");
    const providerMatches =
      leftProvider && rightProvider ? leftProvider === rightProvider : true;
    return (
      providerMatches &&
      String(leftContract.underlying || leftContract.ticker || "").toUpperCase() ===
        String(rightContract.underlying || rightContract.ticker || "").toUpperCase() &&
      contractDateKey(leftContract.expirationDate) ===
        contractDateKey(rightContract.expirationDate) &&
      Number(leftContract.strike) === Number(rightContract.strike) &&
      String(leftContract.right || "").toLowerCase() ===
        String(rightContract.right || "").toLowerCase()
    );
  };
  const shadowExposureQuery = useQuery({
    queryKey: [
      "/api/accounts/shadow/positions",
      "option-exposure",
      slot.ticker,
      selectedContractMeta?.providerContractId || null,
      expInfo.actualDate || null,
      slot.strike,
      slot.cp,
    ],
    queryFn: () =>
      platformJsonRequest(
        "/api/accounts/shadow/positions?mode=paper&assetClass=Options",
      ),
    enabled: Boolean(ticketIsOptions && selectedContractMeta && expInfo.actualDate),
    staleTime: 15_000,
    refetchInterval: false,
  });
  const liveOrderPayloadReady = ticketIsShares
    ? Boolean(accountId && slot.ticker)
    : Boolean(accountId && selectedContractMeta && expInfo.actualDate);
  const gatewayTradingBlocked = !gatewayTradingReady;
	  const placeOrderMutation = usePlaceOrder({
	    mutation: {
	      onSuccess: (order) => {
	        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
        toast.push({
          kind: "success",
          title: `Submitted ${ticketInstrumentLabel}`,
          body: `${order.quantity} × ${order.type.toUpperCase()} · ${order.status.toUpperCase()} · ${order.id}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Order rejected",
          body: error?.message || "The broker rejected the order.",
        });
	      },
	    },
	  });
	  const submitOrdersMutation = useSubmitOrders({
	    mutation: {
	      onSuccess: (result) => {
	        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
	        queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
	        const submittedOrderIds = Array.isArray(result?.submittedOrderIds)
	          ? result.submittedOrderIds
	          : [];
        toast.push({
          kind: "success",
          title: `Attached exits submitted ${ticketInstrumentLabel}`,
          body:
            result?.message ||
            `${submittedOrderIds.length || 2} attached IBKR orders were routed.`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Attached exits rejected",
          body:
            error?.message ||
            "The broker rejected the attached parent or exit orders.",
        });
      },
	    },
	  });
	  const placeShadowOrderMutation = useMutation({
    mutationFn: (payload) =>
      platformJsonRequest("/api/shadow/orders", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          String(query.queryKey[0] || "").includes("/api/accounts/shadow"),
      });
      toast.push({
        kind: "success",
        title: `Shadow filled ${ticketInstrumentLabel}`,
        body: `${order.filledQuantity || order.quantity} × ${String(order.side).toUpperCase()} @ $${Number(order.averageFillPrice || 0).toFixed(2)}`,
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Shadow fill rejected",
        body: error?.message || "The internal Shadow ledger rejected this fill.",
      });
    },
  });
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [shadowExposureAcknowledged, setShadowExposureAcknowledged] =
    useState(false);
  const recordAutomationDeviationMutation = useMutation({
    mutationFn: ({ deploymentId, payload }) =>
      platformJsonRequest(
        `/api/algo/deployments/${encodeURIComponent(deploymentId)}/signal-options/deviation`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onError: (error) => {
      toast.push({
        kind: "warn",
        title: "Deviation not recorded",
        body:
          error?.message ||
          "The order preview succeeded, but the automation deviation event was not saved.",
      });
    },
  });
  const previewOrderMutation = usePreviewOrder({
    mutation: {
      onSuccess: (preview, variables) => {
        setPreviewSnapshot(preview);
        const deviation = automationTicketContext
          ? buildSignalOptionsDeviation(
              automationTicketContext,
              variables?.data || orderRequest,
            )
          : null;
        if (deviation) {
          recordAutomationDeviationMutation.mutate(deviation);
        }
        toast.push({
          kind: "success",
          title: "IBKR preview ready",
          body: `${preview.symbol} · ${ticketIsShares ? "stock" : "contract"} ${preview.resolvedContractId} · ${preview.accountId}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Preview failed",
          body:
            error?.message ||
            "The bridge could not build an IBKR order payload.",
        });
      },
    },
  });
  const previewShadowOrderMutation = useMutation({
    mutationFn: (payload) =>
      platformJsonRequest("/api/shadow/orders/preview", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (preview, variables) => {
      setPreviewSnapshot(preview);
      const deviation = automationTicketContext
        ? buildSignalOptionsDeviation(
            automationTicketContext,
            variables || shadowOrderRequest,
          )
        : null;
      if (deviation) {
        recordAutomationDeviationMutation.mutate(deviation);
      }
      toast.push({
        kind: "success",
        title: "Shadow preview ready",
        body: `${preview.symbol} · ${preview.accountId} · est $${Number(preview.fillPrice || 0).toFixed(2)}`,
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Shadow preview failed",
        body:
          error?.message ||
          "The Shadow ledger could not preview this fill.",
      });
    },
  });
  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);
  const [liveConfirmError, setLiveConfirmError] = useState(null);

  // ── CONTROLLED STATE ──
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LMT");
  const [tif, setTif] = useState("DAY"); // DAY / GTC / IOC / FOK
  const [qty, setQty] = useState(3);
  const [limitPrice, setLimitPrice] = useState(
    isFiniteNumber(prem) ? prem : "",
  );
  const [stopPrice, setStopPrice] = useState(
    isFiniteNumber(prem) ? prem : "",
  );
  const initialRiskPrices = getDefaultTicketRiskPrices(prem, "BUY", "option");
  const [stopLoss, setStopLoss] = useState(initialRiskPrices.stopLoss);
  const [takeProfit, setTakeProfit] = useState(initialRiskPrices.takeProfit);
  const [attachStopLoss, setAttachStopLoss] = useState(false);
  const [attachTakeProfit, setAttachTakeProfit] = useState(false);
  const [executionMode, setExecutionMode] = useState(() =>
    normalizeTradingExecutionMode(_initialState.tradeExecutionMode),
  );
  const executionIsShadow = executionMode === "shadow";
  const selectedExecutionLabel = executionIsShadow
    ? "SHADOW PAPER"
    : brokerConfigured
      ? gatewayTradingReady
        ? `IBKR ${environment.toUpperCase()}`
        : "IBKR GATEWAY REQUIRED"
      : "IBKR REQUIRED";
  const selectedExecutionAccount = executionIsShadow
    ? "shadow"
    : brokerConfigured
      ? accountId || MISSING_VALUE
      : MISSING_VALUE;
  const selectedExecutionColor = executionIsShadow
    ? T.pink
    : brokerConfigured
      ? gatewayTradingReady
        ? T.green
        : T.amber
      : T.textDim;
  const renderTicketAssetModeControls = () => (
    <div
      data-testid="trade-ticket-asset-mode"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${TICKET_ASSET_MODES.length}, minmax(0, 1fr))`,
        gap: sp(3),
      }}
    >
      {TICKET_ASSET_MODES.map((mode) => {
        const active = normalizedTicketAssetMode === mode;
        const color = mode === "equity" ? T.cyan : T.accent;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setTicketAssetMode(mode)}
            data-testid={`trade-ticket-asset-mode-${mode}`}
            style={{
              border: `1px solid ${active ? `${color}66` : T.border}`,
              background: active ? `${color}18` : T.bg1,
              color: active ? color : T.textDim,
              borderRadius: dim(3),
              padding: sp("6px 0"),
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 900,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {mode === "equity" ? "SHARES" : "OPTIONS"}
          </button>
        );
      })}
    </div>
  );
  const renderExecutionModeControls = () => (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(8),
          padding: sp("2px 0 1px"),
        }}
      >
        <span
          style={{
            fontSize: fs(8),
            color: selectedExecutionColor,
            fontFamily: T.mono,
            fontWeight: 700,
          }}
        >
          {selectedExecutionLabel}
        </span>
        <span style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>
          {selectedExecutionAccount}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${TRADING_EXECUTION_MODES.length}, minmax(0, 1fr))`,
          gap: sp(3),
        }}
      >
        {TRADING_EXECUTION_MODES.map((mode) => {
          const active = executionMode === mode;
          const color = mode === "shadow" ? T.pink : T.green;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setExecutionMode(mode)}
              style={{
                border: `1px solid ${active ? `${color}66` : T.border}`,
                background: active ? `${color}18` : T.bg1,
                color: active ? color : T.textDim,
                borderRadius: dim(3),
                padding: sp("5px 0"),
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 900,
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              {mode === "shadow" ? "SHADOW" : "REAL"}
            </button>
          );
        })}
      </div>
      {!gatewayTradingReady && (
        <div
          style={{
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            fontSize: fs(8),
            color: T.amber,
            fontFamily: T.sans,
            lineHeight: 1.35,
          }}
        >
          {gatewayTradingMessage}
        </div>
      )}
    </>
  );
  const ticketTypeOptions = [
    ["LMT", "LMT"],
    ["MKT", "MKT"],
    ["STP", "STP"],
    ["STP_LMT", "STP LMT"],
  ];
  const renderLockedTicketControls = () => (
    <div
      style={{
        display: "grid",
        gap: sp(6),
        border: `1px solid ${T.border}`,
        background: T.bg0,
        borderRadius: dim(5),
        padding: sp(8),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(8),
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            color: T.text,
            fontFamily: T.display,
            fontSize: fs(11),
            fontWeight: 800,
          }}
        >
          {ticketInstrumentLabel}
        </span>
        <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}>
          {ticketInstrumentDetail}
        </span>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}
      >
        {["BUY", "SELL"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value)}
            style={{
              border: `1px solid ${
                side === value
                  ? value === "BUY"
                    ? T.green
                    : T.red
                  : T.border
              }`,
              background:
                side === value
                  ? `${value === "BUY" ? T.green : T.red}18`
                  : T.bg1,
              color:
                side === value
                  ? value === "BUY"
                    ? T.green
                    : T.red
                  : T.textDim,
              borderRadius: dim(3),
              padding: sp("6px 0"),
              fontFamily: T.mono,
              fontSize: fs(9),
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: sp(4),
        }}
      >
        {ticketTypeOptions.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrderType(value)}
            style={{
              border: `1px solid ${orderType === value ? T.accent : T.border}`,
              background: orderType === value ? T.accentDim : T.bg1,
              color: orderType === value ? T.accent : T.textDim,
              borderRadius: dim(3),
              padding: sp("5px 0"),
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.8fr 1fr 1fr",
          gap: sp(5),
        }}
      >
        <label
          style={{
            display: "grid",
            gap: sp(3),
            color: T.textMuted,
            fontFamily: T.mono,
            fontSize: fs(7),
            fontWeight: 900,
          }}
        >
          {ticketIsShares ? "SHARES" : "CONTRACTS"}
          <input
            type="number"
            min="1"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color: T.text,
              fontFamily: T.mono,
              fontSize: fs(10),
              padding: sp("5px 6px"),
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: sp(3),
            color: T.textMuted,
            fontFamily: T.mono,
            fontSize: fs(7),
            fontWeight: 900,
          }}
        >
          LIMIT
          <input
            type="number"
            step="0.01"
            disabled={orderType === "MKT" || orderType === "STP"}
            value={limitPrice}
            onChange={(event) => setLimitPrice(event.target.value)}
            style={{
              width: "100%",
              background:
                orderType === "MKT" || orderType === "STP" ? T.bg1 : T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color:
                orderType === "MKT" || orderType === "STP" ? T.textDim : T.text,
              fontFamily: T.mono,
              fontSize: fs(10),
              padding: sp("5px 6px"),
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: sp(3),
            color: T.textMuted,
            fontFamily: T.mono,
            fontSize: fs(7),
            fontWeight: 900,
          }}
        >
          STOP
          <input
            type="number"
            step="0.01"
            disabled={orderType !== "STP" && orderType !== "STP_LMT"}
            value={stopPrice}
            onChange={(event) => setStopPrice(event.target.value)}
            style={{
              width: "100%",
              background:
                orderType === "STP" || orderType === "STP_LMT" ? T.bg3 : T.bg1,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color:
                orderType === "STP" || orderType === "STP_LMT"
                  ? T.text
                  : T.textDim,
              fontFamily: T.mono,
              fontSize: fs(10),
              padding: sp("5px 6px"),
            }}
          />
        </label>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: sp(4),
        }}
      >
        {["DAY", "GTC", "IOC", "FOK"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTif(value)}
            style={{
              border: `1px solid ${tif === value ? T.accent : T.border}`,
              background: tif === value ? T.accentDim : T.bg1,
              color: tif === value ? T.accent : T.textDim,
              borderRadius: dim(3),
              padding: sp("4px 0"),
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}
      >
        <button
          type="button"
          disabled
          style={{
            border: `1px solid ${T.border}`,
            background: T.bg2,
            color: T.textDim,
            borderRadius: dim(4),
            padding: sp("7px 0"),
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: 800,
          }}
        >
          PREVIEW LOCKED
        </button>
        <button
          type="button"
          disabled
          style={{
            border: "none",
            background: T.bg3,
            color: T.textDim,
            borderRadius: dim(4),
            padding: sp("7px 0"),
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: 800,
          }}
        >
          QUOTE REQUIRED
        </button>
      </div>
    </div>
  );
  // When the instrument or side changes, reset prices while preserving quantity.
  useEffect(() => {
    const riskPrices = getDefaultTicketRiskPrices(
      ticketReferencePrice,
      side,
      normalizedTicketAssetMode,
    );
    setLimitPrice(isFiniteNumber(ticketReferencePrice) ? ticketReferencePrice : "");
    setStopPrice(isFiniteNumber(ticketReferencePrice) ? ticketReferencePrice : "");
    setStopLoss(riskPrices.stopLoss);
    setTakeProfit(riskPrices.takeProfit);
  }, [
    normalizedTicketAssetMode,
    side,
    slot.ticker,
    slot.strike,
    slot.cp,
    ticketReferencePrice,
  ]);

  useEffect(() => {
    persistState({ tradeExecutionMode: executionMode });
  }, [executionMode]);

  useEffect(() => {
    if (executionMode === "shadow") {
      setAttachStopLoss(false);
      setAttachTakeProfit(false);
    }
  }, [executionMode]);

  useEffect(() => {
    setPreviewSnapshot(null);
    setShadowExposureAcknowledged(false);
  }, [
    side,
    orderType,
    tif,
    qty,
    limitPrice,
    stopPrice,
    stopLoss,
    takeProfit,
    attachStopLoss,
    attachTakeProfit,
    executionMode,
    normalizedTicketAssetMode,
    ticketReferencePrice,
    slot.ticker,
    slot.strike,
    slot.cp,
    slot.exp,
    expInfo.value,
    environment,
    accountId,
    brokerConfigured,
    brokerAuthenticated,
    automationTicketContext,
  ]);
  const bidFlashClass = useValueFlash(ticketIsShares ? equityPrice : bid);
  const midFlashClass = useValueFlash(ticketReferencePrice);
  const askFlashClass = useValueFlash(ticketIsShares ? equityPrice : ask);
  const closeLiveConfirm = () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmState(null);
  };
  const runLiveConfirm = async () => {
    if (!liveConfirmState?.onConfirm) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmPending(true);
    try {
      await liveConfirmState.onConfirm();
      setLiveConfirmState(null);
    } catch (error) {
      setLiveConfirmError(formatLiveBrokerActionError(error));
    } finally {
      setLiveConfirmPending(false);
    }
  };

  if (ticketIsOptions && !ticketInstrumentReady) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: 4,
          }}
        >
          ORDER TICKET
        </div>
        {renderTicketAssetModeControls()}
        {renderExecutionModeControls()}
        {renderLockedTicketControls()}
        <DataUnavailableState
          title="No live contract quote"
          detail="Preview and submit unlock once the selected option contract has a live chain row with bid, ask, greeks, and contract metadata. Shares trading remains available from the SHARES toggle."
        />
      </div>
    );
  }

  const isLong = side === "BUY";
  const qtyNum = Number(qty) || 0;
  const orderPrices = resolveTicketOrderPrices({
    orderType,
    limitPrice,
    stopPrice,
    fallbackPrice: ticketReferencePrice,
  });
  const fillPrice = orderPrices.fillPrice;
  const orderTypeLabel = formatTicketOrderType(orderType);
  const cost = fillPrice * qtyNum * ticketMultiplier;
  const hasPositiveFillPrice = Number.isFinite(fillPrice) && fillPrice > 0;
  const fillPriceDisplay = hasPositiveFillPrice
    ? `$${fillPrice.toFixed(2)}`
    : orderType === "MKT"
      ? "MKT"
      : MISSING_VALUE;
  const stopLimitPriceDisplay =
    Number.isFinite(orderPrices.stopPrice) &&
    Number.isFinite(orderPrices.limitPrice)
      ? `$${Number(orderPrices.stopPrice).toFixed(2)} / $${Number(orderPrices.limitPrice).toFixed(2)}`
      : MISSING_VALUE;
  const costDisplay =
    Number.isFinite(cost) && hasPositiveFillPrice
      ? `$${cost.toFixed(0)}`
      : MISSING_VALUE;
  const signedCostDisplay =
    costDisplay === MISSING_VALUE ? MISSING_VALUE : `${isLong ? "−" : "+"}${costDisplay}`;
  const breakeven =
    ticketIsOptions
      ? slot.cp === "C"
        ? slot.strike + fillPrice
        : slot.strike - fillPrice
      : fillPrice;
  const beMovePct =
    isFiniteNumber(info.price) && info.price !== 0
      ? ((breakeven - info.price) / info.price) * 100
      : null;
  const pop = ticketIsOptions && isFiniteNumber(delta)
    ? Math.max(15, Math.min(75, (0.5 - Math.abs(delta - 0.5)) * 100 + 25))
    : null;
  const slPct =
    fillPrice > 0 && Number.isFinite(+stopLoss)
      ? ((+stopLoss - fillPrice) / fillPrice) * 100
      : null;
  const tpPct =
    fillPrice > 0 && Number.isFinite(+takeProfit)
      ? ((+takeProfit - fillPrice) / fillPrice) * 100
      : null;
  const automationOrderPlan = objectValue(automationTicketContext?.orderPlan);
  const automationOrderPayload = automationTicketContext
    ? {
        candidateId: automationTicketContext.id || null,
        deploymentId: automationTicketContext.deploymentId || null,
        deploymentName: automationTicketContext.deploymentName || null,
        automationCandidate: automationTicketContext,
        plannedContract: objectValue(automationTicketContext.selectedContract),
        plannedOrderPlan: automationOrderPlan,
      }
    : null;
  const optionOrderContract =
    ticketIsOptions && selectedContractMeta && expInfo.actualDate
      ? {
          ticker: selectedContractMeta.ticker,
          underlying: selectedContractMeta.underlying,
          expirationDate: expInfo.actualDate,
          strike: selectedContractMeta.strike,
          right: selectedContractMeta.right,
          multiplier: selectedContractMeta.multiplier,
          sharesPerContract: selectedContractMeta.sharesPerContract,
          providerContractId: selectedContractMeta.providerContractId,
        }
      : null;
  const orderRequest = liveOrderPayloadReady
    ? {
        accountId,
        mode: environment,
        symbol: slot.ticker,
        assetClass: ticketAssetClass,
        side: side.toLowerCase(),
        type: normalizeTicketOrderType(orderType),
        quantity: qtyNum,
        limitPrice: orderPrices.limitPrice,
        stopPrice: orderPrices.stopPrice,
        timeInForce: tif.toLowerCase(),
        optionContract: optionOrderContract,
        payload: automationOrderPayload
          ? {
              ...automationOrderPayload,
              source: "trade_broker_order",
            }
          : undefined,
      }
    : null;
  const shadowExecutionReady = ticketIsShares
    ? Boolean(slot.ticker)
    : Boolean(selectedContractMeta && expInfo.actualDate);
  const shadowOrderRequest = shadowExecutionReady
    ? {
        accountId: "shadow",
        mode: "paper",
        symbol: slot.ticker,
        assetClass: ticketAssetClass,
        side: side.toLowerCase(),
        type: normalizeTicketOrderType(orderType),
        quantity: qtyNum,
        limitPrice: orderPrices.limitPrice,
        stopPrice: orderPrices.stopPrice,
        timeInForce: tif.toLowerCase(),
        optionContract: optionOrderContract,
        payload: automationOrderPayload
          ? {
              ...automationOrderPayload,
              source: "trade_shadow_fill",
            }
          : undefined,
      }
    : null;
  const automationShadowLink = objectValue(automationTicketContext?.shadowLink);
  const automationAlreadyShadowFilled = Boolean(
    ticketIsOptions && (automationShadowLink.orderId || automationShadowLink.fillId),
  );
  const matchingShadowOptionPositions = (shadowExposureQuery.data?.positions || [])
    .filter(
      (position) =>
        position.assetClass === "Options" &&
        position.optionContract &&
        selectedContractMeta &&
        optionContractsMatch(position.optionContract, selectedContractMeta),
    );
  const matchingShadowQuantity = matchingShadowOptionPositions.reduce(
    (sum, position) => sum + (Number(position.quantity) || 0),
    0,
  );
  const matchingShadowSources = Array.from(
    new Set(
      matchingShadowOptionPositions
        .map((position) => position.strategyLabel || position.sourceType)
        .filter(Boolean),
    ),
  );
  const sameShadowContractExposure =
    ticketIsOptions &&
    matchingShadowOptionPositions.length > 0 &&
    matchingShadowQuantity > 0;
  const comparisonRequest =
    executionMode === "shadow"
      ? shadowOrderRequest
      : orderRequest || shadowOrderRequest;
  const liveDeviation = automationTicketContext
    ? buildSignalOptionsDeviation(automationTicketContext, comparisonRequest)
    : null;
  const liveDeviationFields = liveDeviation?.payload?.changedFields || [];
  const formatTicketMoney = (value, digits = 2) =>
    Number.isFinite(Number(value))
      ? `$${Number(value).toFixed(digits)}`
      : MISSING_VALUE;
  const hasAttachedExits =
    !executionIsShadow && (attachStopLoss || attachTakeProfit);
  const attachedExitCount = (attachStopLoss ? 1 : 0) + (attachTakeProfit ? 1 : 0);
  const attachedExitLabel =
    attachedExitCount === 2
      ? "2 EXITS"
      : attachStopLoss
        ? "STOP"
        : attachTakeProfit
          ? "TARGET"
          : "SINGLE";
  const attachedExitPreviewLabel = [
    attachStopLoss ? `SL ${formatTicketMoney(stopLoss)}` : null,
    attachTakeProfit ? `TP ${formatTicketMoney(takeProfit)}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const stopLossExitDisabled = executionIsShadow || !attachStopLoss;
  const takeProfitExitDisabled = executionIsShadow || !attachTakeProfit;
  const restoreAutomationPlan = () => {
    if (!automationTicketContext) {
      return;
    }
    setSide("BUY");
    setOrderType("LMT");
    setTif("DAY");
    setAttachStopLoss(false);
    setAttachTakeProfit(false);
    const plannedQuantity = Number(automationOrderPlan.quantity);
    const plannedPrice = Number(
      automationOrderPlan.entryLimitPrice ??
        automationOrderPlan.simulatedFillPrice,
    );
    if (Number.isFinite(plannedQuantity) && plannedQuantity > 0) {
      setQty(plannedQuantity);
    }
    if (Number.isFinite(plannedPrice) && plannedPrice > 0) {
      setLimitPrice(plannedPrice);
      setStopPrice(plannedPrice);
    }
    toast.push({
      kind: "info",
      title: "Signal-options plan restored",
      body: "The ticket side, quantity, order type, TIF, and limit were reset to the automation plan.",
    });
  };
  const previewPayload =
    previewSnapshot?.orderPayload &&
    typeof previewSnapshot.orderPayload === "object"
      ? previewSnapshot.orderPayload
      : null;
  const previewOrderPayload = previewPayload;

  const validateTicket = ({ requireAttachedExits = false } = {}) => {
    if (qtyNum <= 0) {
      toast.push({
        kind: "error",
        title: "Invalid quantity",
        body: `Enter a positive number of ${ticketQuantityUnit}.`,
      });
      return false;
    }
    if (ticketIsOptions && !optionTicketReady) {
      toast.push({
        kind: "info",
        title: "Contract loading",
        body: "Wait for the selected option contract to finish loading before previewing or submitting.",
      });
      return false;
    }
    if (
      orderType !== "MKT" &&
      (!Number.isFinite(fillPrice) || fillPrice <= 0)
    ) {
      toast.push({
        kind: "error",
        title: "Invalid price",
        body: `Enter a positive ${orderType === "STP" ? "stop" : "limit"} price.`,
      });
      return false;
    }
    if (
      executionIsShadow &&
      ticketIsShares &&
      orderType === "MKT" &&
      !hasPositiveFillPrice
    ) {
      toast.push({
        kind: "info",
        title: "Stock fill price required",
        body: "Shadow market fills need an underlying stock quote. Use a share limit order with a positive limit price if the quote is unavailable.",
      });
      return false;
    }
    if (
      orderType === "STP_LMT" &&
      (!Number.isFinite(orderPrices.stopPrice) || orderPrices.stopPrice <= 0)
    ) {
      toast.push({
        kind: "error",
        title: "Invalid stop trigger",
        body: "Enter a positive stop trigger for the stop-limit order.",
      });
      return false;
    }
    if (requireAttachedExits) {
      const attachedExitError = validateTicketBracket({
        side,
        entryPrice: fillPrice,
        stopLoss,
        takeProfit,
        assetMode: normalizedTicketAssetMode,
        includeStopLoss: attachStopLoss,
        includeTakeProfit: attachTakeProfit,
      });
      if (attachedExitError) {
        toast.push({
          kind: "error",
          title: "Invalid exit order",
          body: attachedExitError,
        });
        return false;
      }
    }
    return true;
  };

  const previewOrder = () => {
    if (!validateTicket()) {
      return;
    }

    if (executionMode === "shadow") {
      if (gatewayTradingBlocked) {
        toast.push({
          kind: "warn",
          title: "IB Gateway disconnected",
          body: gatewayTradingMessage,
        });
        return;
      }

      if (!shadowExecutionReady || !shadowOrderRequest) {
        toast.push({
          kind: "info",
	          title: ticketIsShares ? "Stock quote loading" : "Contract loading",
	          body: ticketIsShares
              ? "Wait for the stock quote to finish loading before previewing Shadow."
              : "Wait for the option contract to finish loading before previewing Shadow.",
	        });
	        return;
	      }

      previewShadowOrderMutation.mutate(shadowOrderRequest);
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "info",
        title: "IBKR required",
        body: "Local preview simulation has been removed. Connect the IBKR bridge to preview a live order.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "No IBKR account is active yet.",
      });
      return;
    }

    if (!liveOrderPayloadReady || !orderRequest) {
      toast.push({
        kind: "info",
        title: ticketIsShares ? "Ticker loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the ticker to finish loading before previewing a broker order."
          : "Wait for the live option chain to finish loading before previewing a broker order.",
      });
      return;
    }

    previewOrderMutation.mutate({ data: orderRequest });
  };

  const submitLiveBrokerOrder = async () => {
    if (!orderRequest) {
      toast.push({
        kind: "error",
        title: "Order unavailable",
        body: "The broker order payload is not ready yet.",
      });
      return;
    }

    if (hasAttachedExits) {
      const preview =
        previewSnapshot &&
        isTwsStructuredOrderPayload(previewSnapshot.orderPayload)
          ? previewSnapshot
          : await previewOrderMutation.mutateAsync({ data: orderRequest });

      if (!isTwsStructuredOrderPayload(preview?.orderPayload)) {
        toast.push({
          kind: "error",
          title: "Attached exits unavailable",
          body: "The current IBKR bridge did not return a structured TWS order payload for attached exit submission.",
        });
        return;
      }

      await submitOrdersMutation.mutateAsync({
        data: {
          accountId,
          mode: environment,
          confirm: true,
          ibkrOrders: buildTwsBracketOrders({
            previewPayload: preview.orderPayload,
            side,
            quantity: qtyNum,
            stopLossPrice: stopLoss,
            takeProfitPrice: takeProfit,
            includeStopLoss: attachStopLoss,
            includeTakeProfit: attachTakeProfit,
          }),
        },
      });
      return;
    }

    await placeOrderMutation.mutateAsync({
      data: {
        ...orderRequest,
        confirm: true,
      },
    });
  };

  const submitOrder = () => {
    if (!validateTicket({ requireAttachedExits: hasAttachedExits })) {
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR required",
        body: "Local order fills are disabled. Connect the IBKR bridge to submit this order.",
      });
      return;
    }

    if (gatewayTradingBlocked) {
      toast.push({
        kind: "warn",
        title: "IB Gateway disconnected",
        body: gatewayTradingMessage,
      });
      return;
    }

    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    if (!liveOrderPayloadReady || !orderRequest) {
      toast.push({
        kind: "info",
        title: ticketIsShares ? "Ticker loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the ticker to finish loading before submitting a broker order."
          : "Wait for the live option chain to finish loading before submitting a broker order.",
      });
      return;
    }

    setLiveConfirmError(null);
    if (!confirmBrokerOrders) {
      void submitLiveBrokerOrder();
      return;
    }

    setLiveConfirmState({
      title: `${side} ${ticketInstrumentLabel}`,
      detail: hasAttachedExits
        ? `Submit this ${environment.toUpperCase()} IBKR parent order with ${attachedExitCount} attached exit order${attachedExitCount === 1 ? "" : "s"}.`
        : `Submit this ${environment.toUpperCase()} broker order to Interactive Brokers for immediate routing.`,
      confirmLabel: hasAttachedExits
        ? `${side} IBKR + ${attachedExitLabel}`
        : `${side} IBKR ORDER`,
      confirmTone: isLong ? T.green : T.red,
      lines: [
        { label: "ACCOUNT", value: accountId || MISSING_VALUE },
        { label: "SYMBOL", value: slot.ticker },
        ...(ticketIsOptions
          ? [
              {
                label: "CONTRACT",
                value: `${slot.strike}${slot.cp} ${expInfo.label || slot.exp}`,
              },
            ]
          : [{ label: "ASSET", value: "SHARES" }]),
        {
          label: "TYPE",
          value: hasAttachedExits
            ? `${orderTypeLabel} + ${attachedExitLabel}`
            : orderTypeLabel,
        },
        { label: "TIF", value: tif },
        {
          label: "QTY",
          value: `${qtyNum || 0} ${ticketQuantityUnit.toUpperCase()}`,
        },
        {
          label:
            orderType === "STP" || orderType === "STP_LMT"
              ? "STOP"
              : orderType === "MKT"
                ? "MARK"
                : "LIMIT",
          value:
            orderType === "STP_LMT"
              ? stopLimitPriceDisplay
              : fillPriceDisplay,
        },
        ...(attachStopLoss
          ? [
              {
                label: "STOP LOSS",
                value: formatTicketMoney(stopLoss),
                valueColor: T.red,
              },
            ]
          : []),
        ...(attachTakeProfit
          ? [
              {
                label: "TAKE PROFIT",
                value: formatTicketMoney(takeProfit),
                valueColor: T.green,
              },
            ]
          : []),
        {
          label: isLong ? "EST COST" : "EST CREDIT",
          value: costDisplay,
          valueColor: isLong ? T.red : T.green,
        },
      ],
      onConfirm: submitLiveBrokerOrder,
    });
  };

  const submitShadowOrder = () => {
    if (!validateTicket()) {
      return;
    }
    if (gatewayTradingBlocked) {
      toast.push({
        kind: "warn",
        title: "IB Gateway disconnected",
        body: gatewayTradingMessage,
      });
      return;
    }
    if (automationAlreadyShadowFilled) {
      toast.push({
        kind: "warn",
        title: "Shadow already filled",
        body: "This signal-options candidate already has a linked Shadow order or fill. Use Account > Shadow before adding manual exposure.",
      });
      return;
    }
    if (sameShadowContractExposure && !shadowExposureAcknowledged) {
      setShadowExposureAcknowledged(true);
      toast.push({
        kind: "warn",
        title: "Shadow exposure exists",
        body: `Shadow already holds ${matchingShadowQuantity.toFixed(2)} contract(s) in this option. Click Shadow Fill again to add exposure.`,
      });
      return;
    }
    if (!shadowExecutionReady || !shadowOrderRequest) {
      toast.push({
        kind: "info",
        title: ticketIsShares ? "Stock quote loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the stock quote to finish loading before filling Shadow."
          : "Wait for the option contract to finish loading before filling Shadow.",
      });
      return;
    }
    placeShadowOrderMutation.mutate(shadowOrderRequest);
  };

  const automationContract = objectValue(automationTicketContext?.selectedContract);
  const plannedContractLabel = [
    automationContract.expirationDate,
    automationContract.strike,
    automationContract.right
      ? String(automationContract.right).toUpperCase()
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const currentContractLabel = `${expInfo.label || slot.exp} ${slot.strike}${slot.cp}`;
	  const comparisonRows = automationTicketContext
	    ? [
        {
          label: "Contract",
          planned: plannedContractLabel || MISSING_VALUE,
          current: currentContractLabel || MISSING_VALUE,
          changed: liveDeviationFields.includes("contract") || liveDeviationFields.includes("provider_contract_id"),
        },
        {
          label: "Side",
          planned: "BUY",
          current: side,
          changed: liveDeviationFields.includes("side"),
        },
        {
          label: "Qty",
          planned: automationOrderPlan.quantity ?? MISSING_VALUE,
          current: qtyNum || MISSING_VALUE,
          changed: liveDeviationFields.includes("quantity"),
        },
        {
          label: "Limit",
          planned: formatTicketMoney(automationOrderPlan.entryLimitPrice),
          current:
            orderType === "LMT"
              ? formatTicketMoney(fillPrice)
              : orderType,
          changed:
            liveDeviationFields.includes("limit_price") ||
            liveDeviationFields.includes("order_type"),
        },
	      ]
	    : [];
	  const parentPriceLabel =
	    orderType === "MKT"
	      ? ticketIsShares
          ? "LAST"
          : "MID"
	      : orderType === "STP"
	        ? "STOP"
	        : "LIMIT";
	  const parentPriceValue =
	    orderType === "MKT"
	      ? isFiniteNumber(ticketReferencePrice)
          ? formatPriceValue(ticketReferencePrice)
          : ""
	      : orderType === "STP"
	        ? stopPrice
	        : limitPrice;
	  const parentPriceDisabled = orderType === "MKT";
  const qtyPresets = ticketIsShares ? [1, 10, 25, 50, 100] : [1, 3, 5, 10];
	  const isSubmittingOrder =
	    placeOrderMutation.isPending || submitOrdersMutation.isPending;
  const previewIsPending =
    previewOrderMutation.isPending || previewShadowOrderMutation.isPending;
  const primarySubmitPending = executionIsShadow
    ? placeShadowOrderMutation.isPending
    : isSubmittingOrder;
  const primarySubmitDisabled = executionIsShadow
    ? placeShadowOrderMutation.isPending ||
      automationAlreadyShadowFilled ||
      gatewayTradingBlocked
    : isSubmittingOrder || gatewayTradingBlocked;
  const previewDisabled =
    previewIsPending || (executionIsShadow && gatewayTradingBlocked);
  const primarySubmitColor = executionIsShadow ? T.pink : isLong ? T.green : T.red;
  const primarySubmitLabel = executionIsShadow
    ? gatewayTradingBlocked
      ? "GATEWAY REQUIRED"
      : placeShadowOrderMutation.isPending
      ? "FILLING..."
      : automationAlreadyShadowFilled
        ? "SHADOW FILLED"
	        : sameShadowContractExposure && !shadowExposureAcknowledged
	          ? "ADD EXPOSURE?"
	        : sameShadowContractExposure
	            ? "CONFIRM ADD EXPOSURE"
	            : `${side} SHADOW ${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} × ${fillPriceDisplay}`
    : gatewayTradingBlocked
      ? "GATEWAY REQUIRED"
      : isSubmittingOrder
      ? "SUBMITTING..."
      : `${side} ${hasAttachedExits ? `${attachedExitLabel} ` : ""}${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} × ${fillPriceDisplay} · ${signedCostDisplay}`;
	  const previewIsTwsStructured =
	    isTwsStructuredOrderPayload(previewOrderPayload);
	  const previewDisplayOrder = previewIsTwsStructured
	    ? previewOrderPayload.order
	    : previewOrderPayload;
	  const previewDisplayPrice =
    previewSnapshot?.fillPrice ??
	    previewDisplayOrder?.price ??
	    previewDisplayOrder?.lmtPrice ??
	    previewDisplayOrder?.auxPrice ??
	    null;

	  return (
    <>
      <div
      className="ra-panel-enter"
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: fs(9),
          fontWeight: 700,
          color: T.textSec,
          fontFamily: T.display,
          letterSpacing: "0.08em",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: 4,
        }}
      >
        ORDER TICKET
      </div>
      {renderTicketAssetModeControls()}
      {automationTicketContext ? (
        <div
          style={{
            border: `1px solid ${
              automationAlreadyShadowFilled ? `${T.green}45` : `${T.cyan}35`
            }`,
            background: automationAlreadyShadowFilled
              ? `${T.green}10`
              : `${T.cyan}10`,
            borderRadius: dim(5),
            padding: sp("7px 8px"),
            display: "grid",
            gap: sp(6),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: sp(8),
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  color: T.text,
                  fontFamily: T.display,
                  fontSize: fs(10),
                  fontWeight: 800,
                }}
              >
                Signal-options plan
              </div>
              <div
                style={{
                  color: automationAlreadyShadowFilled ? T.green : T.textDim,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  marginTop: 2,
                }}
              >
                {automationAlreadyShadowFilled
                  ? "Shadow already filled"
                  : liveDeviationFields.length
                    ? `${liveDeviationFields.length} deviation${liveDeviationFields.length === 1 ? "" : "s"}`
                    : "Matched"}
              </div>
            </div>
            <button
              type="button"
              onClick={restoreAutomationPlan}
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: dim(4),
                background: T.bg0,
                color: T.cyan,
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 900,
                padding: sp("5px 7px"),
                cursor: "pointer",
              }}
            >
              RESTORE PLAN
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: sp(5),
            }}
          >
            {comparisonRows.map((row) => (
              <div
                key={row.label}
                style={{
                  border: `1px solid ${row.changed ? `${T.amber}55` : T.border}`,
                  background: row.changed ? `${T.amber}10` : T.bg0,
                  borderRadius: dim(4),
                  padding: sp("5px 6px"),
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: row.changed ? T.amber : T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    fontWeight: 900,
                  }}
                >
                  {row.label.toUpperCase()}
                </div>
                <div
                  style={{
                    color: T.text,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`Plan: ${row.planned} / Current: ${row.current}`}
                >
                  {row.planned} / {row.current}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {sameShadowContractExposure ? (
        <div
          style={{
            border: `1px solid ${T.amber}55`,
            background: `${T.amber}12`,
            borderRadius: dim(5),
            padding: sp("6px 8px"),
            display: "grid",
            gap: sp(3),
          }}
        >
          <div
            style={{
              color: T.amber,
              fontFamily: T.display,
              fontSize: fs(10),
              fontWeight: 800,
            }}
          >
            Shadow exposure exists
          </div>
          <div
            style={{
              color: T.textSec,
              fontFamily: T.mono,
              fontSize: fs(8),
              lineHeight: 1.35,
            }}
          >
            {matchingShadowQuantity.toFixed(2)} contract(s) already open in
            Shadow
            {matchingShadowSources.length
              ? ` · ${matchingShadowSources.join(" / ")}`
              : ""}
            . Manual fills will add to this same option contract.
          </div>
        </div>
      ) : null}
      {renderExecutionModeControls()}
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: fs(13),
            fontWeight: 800,
            fontFamily: T.mono,
            color: T.text,
          }}
        >
          {slot.ticker}
        </span>
        {ticketIsOptions ? (
          <span
            style={{
              fontSize: fs(12),
              fontWeight: 700,
              fontFamily: T.mono,
              color: contractColor,
            }}
          >
            {slot.strike}
            {slot.cp}
          </span>
        ) : null}
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>
          {ticketInstrumentDetail}
        </span>
      </div>
      {ticketIsShares ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 6px"),
            background: T.bg3,
            borderRadius: dim(3),
            fontFamily: T.mono,
          }}
        >
          <div className={midFlashClass}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              LAST
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                color: T.text,
                lineHeight: 1,
              }}
            >
              {equityQuoteReady ? `$${equityPrice.toFixed(2)}` : MISSING_VALUE}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              CHG
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                color:
                  Number(info?.chg) > 0
                    ? T.green
                    : Number(info?.chg) < 0
                      ? T.red
                      : T.text,
                lineHeight: 1,
              }}
            >
              {Number.isFinite(Number(info?.chg))
                ? `${Number(info.chg) >= 0 ? "+" : ""}${Number(info.chg).toFixed(2)}`
                : MISSING_VALUE}
            </div>
            <div style={{ fontSize: fs(7), color: T.textDim }}>
              {Number.isFinite(Number(info?.pct))
                ? `${Number(info.pct) >= 0 ? "+" : ""}${Number(info.pct).toFixed(2)}%`
                : MISSING_VALUE}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              VOL
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                color: T.textSec,
                lineHeight: 1,
              }}
            >
              {fmtQuoteVolume(info?.volume)}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 6px"),
            background: T.bg3,
            borderRadius: dim(3),
            fontFamily: T.mono,
          }}
        >
          <div className={bidFlashClass}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BID
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                color: T.red,
                lineHeight: 1,
              }}
            >
              ${bid.toFixed(2)}
            </div>
          </div>
          <div className={midFlashClass} style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              MID
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                color: T.text,
                lineHeight: 1,
              }}
            >
              ${prem.toFixed(2)}
            </div>
            <div
              style={{
                fontSize: fs(7),
                color: isFiniteNumber(spreadPct) && spreadPct > 3 ? T.amber : T.textDim,
              }}
            >
              {isFiniteNumber(spread) && isFiniteNumber(spreadPct)
                ? `${spread.toFixed(2)} (${spreadPct.toFixed(1)}%)`
                : MISSING_VALUE}
            </div>
          </div>
          <div className={askFlashClass} style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              ASK
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                color: T.green,
                lineHeight: 1,
              }}
            >
              ${ask.toFixed(2)}
            </div>
          </div>
        </div>
      )}
      {/* Side + Order type */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            onClick={() => setSide("BUY")}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: isLong ? `${T.green}20` : "transparent",
              border: `1px solid ${isLong ? T.green + "60" : T.border}`,
              borderRadius: dim(3),
              color: isLong ? T.green : T.textDim,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            BUY
          </button>
          <button
            onClick={() => setSide("SELL")}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: !isLong ? `${T.red}20` : "transparent",
              border: `1px solid ${!isLong ? T.red + "60" : T.border}`,
              borderRadius: dim(3),
              color: !isLong ? T.red : T.textDim,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: !isLong ? 700 : 600,
              cursor: "pointer",
            }}
          >
            SELL
          </button>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {TICKET_ORDER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{
                flex: 1,
                padding: sp("4px 0"),
                background: orderType === t ? T.accentDim : "transparent",
                border: `1px solid ${orderType === t ? T.accent : T.border}`,
                borderRadius: dim(3),
                color: orderType === t ? T.accent : T.textDim,
                fontSize: fs(t === "STP_LMT" ? 7 : 9),
                fontFamily: T.mono,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {formatTicketOrderType(t)}
            </button>
          ))}
        </div>
      </div>
      {/* QTY presets + input + LIMIT */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            orderType === "STP_LMT" ? "auto 1fr 1fr 1fr" : "auto 1fr 1fr",
          gap: sp(4),
          alignItems: "end",
        }}
      >
        <div style={{ display: "flex", gap: 2 }}>
          {qtyPresets.map((n) => (
            <button
              key={n}
              onClick={() => setQty(n)}
              style={{
                padding: sp("4px 7px"),
                background: qtyNum === n ? T.accentDim : "transparent",
                border: `1px solid ${qtyNum === n ? T.accent : T.border}`,
                borderRadius: dim(3),
                color: qtyNum === n ? T.accent : T.textDim,
                fontSize: fs(9),
                fontFamily: T.mono,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: 1,
            }}
          >
            {ticketIsShares ? "SHARES" : "CONTRACTS"}
          </div>
          <input
            type="number"
            min="1"
            aria-label={`${ticketQuantityUnit} quantity`}
            value={qty}
            onChange={(e) =>
              setQty(e.target.value === "" ? "" : Math.max(0, +e.target.value))
            }
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: T.text,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
            }}
          />
        </div>
        {orderType === "STP_LMT" ? (
          <div>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
                marginBottom: 1,
              }}
            >
              STOP
            </div>
            <input
              type="number"
              step="0.01"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              style={{
                width: "100%",
                background: T.bg3,
                border: `1px solid ${T.border}`,
                borderRadius: dim(3),
                padding: sp("3px 6px"),
                color: T.text,
                fontSize: fs(11),
                fontFamily: T.mono,
                fontWeight: 600,
              }}
            />
          </div>
        ) : null}
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: 1,
            }}
          >
            {parentPriceLabel}
          </div>
          <input
            type="number"
            step="0.01"
            aria-label={`${parentPriceLabel.toLowerCase()} price`}
            value={parentPriceValue}
            disabled={parentPriceDisabled}
            onChange={(e) =>
              orderType === "STP"
                ? setStopPrice(e.target.value)
                : setLimitPrice(e.target.value)
            }
            style={{
              width: "100%",
              background: parentPriceDisabled ? T.bg2 : T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: parentPriceDisabled ? T.textDim : T.text,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
            }}
          />
        </div>
      </div>
      {/* SL / TP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: sp(1),
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>STOP LOSS</span>
            <button
              type="button"
              aria-label="Toggle stop loss attached exit"
              data-testid="trade-ticket-stop-loss-toggle"
              disabled={executionIsShadow}
              onClick={() => setAttachStopLoss((value) => !value)}
              style={{
                border: `1px solid ${attachStopLoss ? `${T.red}55` : T.border}`,
                borderRadius: dim(3),
                background: attachStopLoss ? `${T.red}16` : "transparent",
                color: attachStopLoss ? T.red : T.textDim,
                fontFamily: T.mono,
                fontSize: fs(7),
                fontWeight: 900,
                padding: sp("1px 5px"),
                cursor: executionIsShadow ? "not-allowed" : "pointer",
                opacity: executionIsShadow ? 0.45 : 1,
              }}
            >
              {attachStopLoss ? "ON" : "OFF"}
            </button>
          </div>
          <input
            type="number"
            step="0.01"
            value={stopLoss}
            disabled={stopLossExitDisabled}
            onChange={(e) => setStopLoss(e.target.value)}
            style={{
              width: "100%",
              background: stopLossExitDisabled ? T.bg2 : T.bg3,
              border: `1px solid ${attachStopLoss ? `${T.red}45` : T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: stopLossExitDisabled ? T.textDim : T.red,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
              opacity: stopLossExitDisabled ? 0.65 : 1,
            }}
          />
          <div
            style={{
              color: attachStopLoss ? T.red : T.textDim,
              fontFamily: T.mono,
              fontSize: fs(7),
              fontWeight: 800,
              marginTop: sp(2),
            }}
          >
            {attachStopLoss && isFiniteNumber(slPct)
              ? `${slPct >= 0 ? "+" : ""}${slPct.toFixed(0)}%`
              : "OFF"}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: sp(1),
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>TAKE PROFIT</span>
            <button
              type="button"
              aria-label="Toggle take profit attached exit"
              data-testid="trade-ticket-take-profit-toggle"
              disabled={executionIsShadow}
              onClick={() => setAttachTakeProfit((value) => !value)}
              style={{
                border: `1px solid ${attachTakeProfit ? `${T.green}55` : T.border}`,
                borderRadius: dim(3),
                background: attachTakeProfit ? `${T.green}16` : "transparent",
                color: attachTakeProfit ? T.green : T.textDim,
                fontFamily: T.mono,
                fontSize: fs(7),
                fontWeight: 900,
                padding: sp("1px 5px"),
                cursor: executionIsShadow ? "not-allowed" : "pointer",
                opacity: executionIsShadow ? 0.45 : 1,
              }}
            >
              {attachTakeProfit ? "ON" : "OFF"}
            </button>
          </div>
          <input
            type="number"
            step="0.01"
            value={takeProfit}
            disabled={takeProfitExitDisabled}
            onChange={(e) => setTakeProfit(e.target.value)}
            style={{
              width: "100%",
              background: takeProfitExitDisabled ? T.bg2 : T.bg3,
              border: `1px solid ${attachTakeProfit ? `${T.green}45` : T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: takeProfitExitDisabled ? T.textDim : T.green,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
              opacity: takeProfitExitDisabled ? 0.65 : 1,
            }}
          />
          <div
            style={{
              color: attachTakeProfit ? T.green : T.textDim,
              fontFamily: T.mono,
              fontSize: fs(7),
              fontWeight: 800,
              marginTop: sp(2),
            }}
          >
            {attachTakeProfit && isFiniteNumber(tpPct)
              ? `${tpPct >= 0 ? "+" : ""}${tpPct.toFixed(0)}%`
              : "OFF"}
          </div>
        </div>
      </div>
      {/* TIF */}
      <div style={{ display: "flex", gap: 2 }}>
        {["DAY", "GTC", "IOC", "FOK"].map((t) => (
          <button
            key={t}
            onClick={() => setTif(t)}
            style={{
              flex: 1,
              padding: sp("3px 0"),
              background: tif === t ? T.accentDim : "transparent",
              border: `1px solid ${tif === t ? T.accent : T.border}`,
              borderRadius: dim(2),
              color: tif === t ? T.accent : T.textDim,
              fontSize: fs(8),
              fontFamily: T.mono,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {ticketIsOptions ? (
        <>
          <PayoffDiagram
            optType={slot.cp}
            strike={slot.strike}
            premium={fillPrice}
            qty={qtyNum || 1}
            currentPrice={info.price}
            side={side}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: sp("2px 4px"),
              fontSize: fs(8),
              fontFamily: T.mono,
            }}
          >
            <span style={{ color: T.textMuted }}>
              BE{" "}
              <span style={{ color: T.text, fontWeight: 600 }}>
                ${breakeven.toFixed(2)}
              </span>{" "}
              <span style={{ color: T.textDim }}>
                {beMovePct == null
                  ? `(${MISSING_VALUE})`
                  : `(${beMovePct >= 0 ? "+" : ""}${beMovePct.toFixed(1)}%)`}
              </span>
            </span>
            <span style={{ color: T.textMuted }}>
              {isLong ? "Risk" : "Credit"}{" "}
              <span style={{ color: isLong ? T.red : T.green, fontWeight: 600 }}>
                ${cost.toFixed(0)}
              </span>
            </span>
            <span style={{ color: T.textMuted }}>
              POP{" "}
              <span
                style={{
                  color: !isFiniteNumber(pop)
                    ? T.textDim
                    : pop >= 50
                      ? T.green
                      : pop >= 30
                        ? T.amber
                        : T.red,
                  fontWeight: 600,
                }}
              >
                {isFiniteNumber(pop) ? `${pop.toFixed(0)}%` : MISSING_VALUE}
              </span>
            </span>
          </div>
        </>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: sp(4),
            border: `1px solid ${T.border}`,
            background: T.bg0,
            borderRadius: dim(4),
            padding: sp("6px 7px"),
            fontFamily: T.mono,
          }}
        >
          {[
            ["NOTIONAL", costDisplay, T.text],
            [
              "STOP",
              attachStopLoss ? formatTicketMoney(stopLoss) : "OFF",
              attachStopLoss ? T.red : T.textDim,
            ],
            [
              "TARGET",
              attachTakeProfit ? formatTicketMoney(takeProfit) : "OFF",
              attachTakeProfit ? T.green : T.textDim,
            ],
          ].map(([label, value, color]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div
                style={{
                  color: T.textMuted,
                  fontSize: fs(7),
                  fontWeight: 900,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  color,
                  fontSize: fs(10),
                  fontWeight: 800,
                  marginTop: sp(2),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      )}
      {previewSnapshot && (
        <div
          style={{
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(4),
            fontSize: fs(8),
            fontFamily: T.mono,
          }}
        >
          <div>
            <span style={{ color: T.textMuted }}>PREVIEW</span>{" "}
            <span style={{ color: T.text, fontWeight: 700 }}>
              {previewSnapshot.accountId}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>CONID</span>{" "}
            <span style={{ color: T.accent, fontWeight: 700 }}>
              {previewSnapshot.resolvedContractId}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>TYPE</span>{" "}
            <span style={{ color: T.text }}>
              {formatEnumLabel(
                previewDisplayOrder?.orderType ||
                  previewDisplayOrder?.type ||
                  orderTypeLabel,
              )}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>TIF</span>{" "}
            <span style={{ color: T.text }}>
              {String(previewDisplayOrder?.tif || previewDisplayOrder?.timeInForce || tif).toUpperCase()}
            </span>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: T.textMuted }}>PAYLOAD</span>{" "}
            <span style={{ color: T.textSec }}>
              {String(previewDisplayOrder?.side || previewDisplayOrder?.action || side).toUpperCase()}{" "}
              {previewDisplayOrder?.quantity ?? previewDisplayOrder?.totalQuantity ?? qtyNum} {previewSnapshot.symbol}
              {previewDisplayPrice != null ? ` @ ${previewDisplayPrice}` : ""}
            </span>
          </div>
          {hasAttachedExits ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: T.textMuted }}>EXITS</span>{" "}
              <span style={{ color: previewIsTwsStructured ? T.green : T.amber }}>
                {previewIsTwsStructured
                  ? attachedExitPreviewLabel || "none"
                  : "structured TWS preview required"}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: sp(4),
          marginTop: "auto",
        }}
      >
        <button
          onClick={previewOrder}
          disabled={previewDisabled}
          style={{
            padding: sp("7px 0"),
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            color: T.textSec,
            fontSize: fs(10),
            fontFamily: T.sans,
            fontWeight: 700,
            cursor: previewIsPending
              ? "wait"
              : previewDisabled
                ? "not-allowed"
                : "pointer",
            letterSpacing: "0.04em",
            opacity: previewDisabled ? 0.7 : 1,
          }}
        >
          {previewIsPending
            ? "PREVIEWING..."
            : executionIsShadow
              ? "PREVIEW SHADOW"
            : brokerConfigured
              ? "PREVIEW IBKR"
              : "PREVIEW IBKR"}
        </button>
        <button
          onClick={executionIsShadow ? submitShadowOrder : submitOrder}
          disabled={primarySubmitDisabled}
	          style={{
            padding: sp("7px 0"),
            background: primarySubmitDisabled ? T.bg3 : primarySubmitColor,
            border: "none",
            borderRadius: dim(4),
            color: primarySubmitDisabled ? T.textDim : "#fff",
            fontSize: fs(11),
            fontFamily: T.sans,
            fontWeight: 700,
	            cursor: primarySubmitPending ? "wait" : primarySubmitDisabled ? "not-allowed" : "pointer",
	            letterSpacing: "0.04em",
	            opacity: primarySubmitPending || primarySubmitDisabled ? 0.7 : 1,
	          }}
	        >
	          {primarySubmitLabel}
	        </button>
      </div>
      </div>
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm broker order"}
        detail={
          liveConfirmState?.detail ||
          "Submit this Interactive Brokers order."
        }
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM IBKR ORDER"}
        confirmTone={liveConfirmState?.confirmTone || T.red}
        pending={liveConfirmPending}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </>
  );
};

export const TradeStrategyGreeksPanel = ({
  slot,
  chainRows = [],
  onApplyStrategy,
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((r) => r.k === slot.strike);
  if (!row) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          STRATEGY
        </div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay available after the selected contract resolves to a live option chain row with greeks."
        />
      </div>
    );
  }
  const delta = slot.cp === "C" ? row.cDelta : row.pDelta;
  const gamma = slot.cp === "C" ? row.cGamma : row.pGamma;
  const theta = slot.cp === "C" ? row.cTheta : row.pTheta;
  const vega = slot.cp === "C" ? row.cVega : row.pVega;
  if (
    !isFiniteNumber(delta) ||
    !isFiniteNumber(gamma) ||
    !isFiniteNumber(theta) ||
    !isFiniteNumber(vega)
  ) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          STRATEGY
        </div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay hidden until the selected contract includes broker-backed delta, gamma, theta, and vega."
        />
      </div>
    );
  }
  const absDelta = Math.abs(delta);
  const qty = 3;

  const GreekBar = ({ label, value, color, max, desc }) => {
    const pct = Math.min(1, Math.abs(value) / max);
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 64px",
          alignItems: "center",
          gap: sp(4),
          padding: "2px 0",
        }}
      >
        <span
          style={{
            fontSize: fs(9),
            color: T.textSec,
            fontFamily: T.mono,
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        <div
          style={{
            position: "relative",
            height: dim(12),
            background: T.bg3,
            borderRadius: dim(2),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: value < 0 ? `${50 - pct * 50}%` : "50%",
              width: `${pct * 50}%`,
              height: "100%",
              background: color,
              opacity: 0.85,
              borderRadius: dim(1),
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: dim(1),
              background: T.border,
            }}
          />
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left:
                value < 0
                  ? `${Math.max(0, 50 - pct * 50 - 0.5)}%`
                  : `${Math.min(95, 50 + pct * 50 + 1)}%`,
              transform: value < 0 ? "translateX(-100%)" : "none",
              fontSize: fs(8),
              fontFamily: T.mono,
              fontWeight: 700,
              color: T.text,
              display: "flex",
              alignItems: "center",
              paddingLeft: value < 0 ? 0 : 3,
              paddingRight: value < 0 ? 3 : 0,
            }}
          >
            {value.toFixed(3)}
          </span>
        </div>
        <span
          style={{
            fontSize: fs(9),
            color: T.textDim,
            fontFamily: T.sans,
            fontStyle: "italic",
            textAlign: "right",
          }}
        >
          {desc}
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        overflow: "hidden",
      }}
    >
      <div>
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
            marginBottom: 5,
          }}
        >
          STRATEGY
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 3,
          }}
        >
          {TRADE_STRATEGIES.map((s) => (
            <button
              key={s.id}
              onClick={(e) => {
                e.stopPropagation();
                onApplyStrategy(s);
              }}
              style={{
                padding: sp("4px 6px"),
                background: "transparent",
                border: `1px solid ${s.color}40`,
                borderLeft: `3px solid ${s.color}`,
                borderRadius: dim(3),
                color: T.text,
                fontSize: fs(9),
                fontFamily: T.sans,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              <div style={{ color: s.color, fontWeight: 700 }}>{s.name}</div>
              <div
                style={{
                  color: T.textDim,
                  fontSize: fs(8),
                  marginTop: sp(1),
                  fontStyle: "italic",
                }}
              >
                {s.desc}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
            marginBottom: sp(5),
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>GREEKS</span>
          <span style={{ fontSize: fs(7), color: T.textDim, fontWeight: 400 }}>
            PER CONTRACT
          </span>
        </div>
        <GreekBar
          label="Δ"
          value={delta}
          color={T.accent}
          max={1.0}
          desc={
            absDelta >= 0.5 ? "Strong" : absDelta >= 0.3 ? "Moderate" : "Weak"
          }
        />
        <GreekBar
          label="Γ"
          value={gamma}
          color={T.purple}
          max={0.1}
          desc={gamma > 0.05 ? "High γ-risk" : "Moderate γ"}
        />
        <GreekBar
          label="Θ"
          value={theta}
          color={T.red}
          max={0.15}
          desc={`$${Math.abs(theta * 100).toFixed(0)}/day`}
        />
        <GreekBar
          label="V"
          value={vega}
          color={T.cyan}
          max={0.2}
          desc={`$${(vega * 100).toFixed(0)}/1% IV`}
        />
      </div>
      <div
        style={{ padding: sp("4px 6px"), background: T.bg3, borderRadius: 3 }}
      >
        <div
          style={{
            fontSize: fs(6),
            color: T.textMuted,
            letterSpacing: "0.08em",
            marginBottom: 2,
          }}
        >
          POSITION × {qty}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: sp(4),
            fontSize: fs(9),
            fontFamily: T.mono,
          }}
        >
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>Δ </span>
            <span style={{ color: T.accent, fontWeight: 700 }}>
              {(delta * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>Γ </span>
            <span style={{ color: T.purple, fontWeight: 700 }}>
              {(gamma * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>Θ </span>
            <span style={{ color: T.red, fontWeight: 700 }}>
              {(theta * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>V </span>
            <span style={{ color: T.cyan, fontWeight: 700 }}>
              {(vega * qty).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const TradeL2Panel = ({
  slot,
  chainRows = [],
  flowEvents,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
  streamingPaused = false,
}) => {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const tradeFlowSnapshot = useTradeFlowSnapshot(slot.ticker);
  const effectiveFlowEvents = flowEvents?.length ? flowEvents : tradeFlowSnapshot.events;
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((r) => r.k === slot.strike);
  const mid = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : mid - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : mid + 0.04;
  const spread = ask - bid;
  const tickerFlow = useMemo(
    () => buildMarketOrderFlowFromEvents(effectiveFlowEvents),
    [effectiveFlowEvents],
  );
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const [tab, setTab] = useState("book");
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const depthQuery = useQuery({
    queryKey: [
      "trade-market-depth",
      accountId,
      slot.ticker,
      selectedContractMeta?.providerContractId,
    ],
    queryFn: () =>
      getBrokerMarketDepthRequest({
        accountId,
        symbol: slot.ticker,
        assetClass: "option",
        providerContractId: selectedContractMeta?.providerContractId,
        exchange: "SMART",
      }),
    enabled: Boolean(
      brokerAuthenticated &&
        accountId &&
        selectedContractMeta?.providerContractId &&
        !streamingPaused,
    ),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const tapeQuery = useQuery({
    queryKey: [
      "trade-contract-executions",
      accountId,
      slot.ticker,
      selectedContractMeta?.providerContractId,
    ],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        symbol: slot.ticker,
        providerContractId: selectedContractMeta?.providerContractId,
        days: 2,
        limit: 24,
      }),
    enabled: Boolean(
      brokerAuthenticated &&
        accountId &&
        selectedContractMeta?.providerContractId &&
        !streamingPaused,
    ),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !selectedContractMeta?.providerContractId ||
      streamingPaused ||
      !pageVisible ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      symbol: slot.ticker,
      assetClass: "option",
      providerContractId: selectedContractMeta.providerContractId,
      exchange: "SMART",
    });
    const source = new EventSource(`/api/streams/market-depth?${params.toString()}`);
    const handleDepth = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          [
            "trade-market-depth",
            accountId,
            slot.ticker,
            selectedContractMeta.providerContractId,
          ],
          payload,
        );
      } catch {}
    };

    source.addEventListener("depth", handleDepth);
    return () => {
      source.removeEventListener("depth", handleDepth);
      source.close();
    };
  }, [
    accountId,
    brokerAuthenticated,
    pageVisible,
    queryClient,
    selectedContractMeta?.providerContractId,
    streamingPaused,
    slot.ticker,
  ]);
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !selectedContractMeta?.providerContractId ||
      streamingPaused ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      symbol: slot.ticker,
      providerContractId: selectedContractMeta.providerContractId,
      days: "2",
      limit: "24",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          [
            "trade-contract-executions",
            accountId,
            slot.ticker,
            selectedContractMeta.providerContractId,
          ],
          payload,
        );
      } catch {}
    };

    source.addEventListener("executions", handleExecutions);
    return () => {
      source.removeEventListener("executions", handleExecutions);
      source.close();
    };
  }, [
    accountId,
    brokerAuthenticated,
    queryClient,
    selectedContractMeta?.providerContractId,
    streamingPaused,
    slot.ticker,
  ]);
  const depthLevels = depthQuery.data?.depth?.levels || [];
  const contractExecutions = tapeQuery.data?.executions || [];
  const liveStatusLabel =
    tab === "flow"
      ? effectiveFlowEvents.length
        ? "flow: external options flow"
        : "flow unavailable"
      : brokerConfigured
        ? brokerAuthenticated
          ? "IBKR book + fills"
          : "IBKR login required"
        : "broker off";

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        fontSize: fs(9),
        fontWeight: 700,
        color: tab === id ? T.text : T.textMuted,
        fontFamily: T.display,
        letterSpacing: "0.08em",
        cursor: "pointer",
        borderBottom:
          tab === id ? `2px solid ${T.accent}` : "2px solid transparent",
        paddingBottom: sp(2),
      }}
    >
      {label}
    </button>
  );

  const renderBrokerGate = (title, detail, loading = false) => (
    <DataUnavailableState
      title={title}
      detail={detail}
      loading={loading}
      tone={loading ? T.accent : undefined}
    />
  );

  const renderBookPanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract market depth",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    if (!brokerConfigured) {
      return renderBrokerGate(
        "IBKR book unavailable",
        "Depth-of-book is only available when the broker bridge is configured.",
      );
    }

    if (!brokerAuthenticated) {
      return renderBrokerGate(
        "IBKR login required",
        "Bring the local IBKR bridge online to load live price ladder data.",
      );
    }

    if (!accountId) {
      return renderBrokerGate(
        "No broker account selected",
        "Select an IBKR account to request contract depth.",
      );
    }

    if (!selectedContractMeta?.providerContractId) {
      return renderBrokerGate(
        "Contract still loading",
        "Wait for the selected option contract to resolve to a broker contract id.",
        true,
      );
    }

    if (depthQuery.isPending && !depthLevels.length) {
      return (
        <DataUnavailableState
          title="Loading IBKR depth"
          detail="Requesting the live contract price ladder from the broker bridge."
          loading
          tone={T.accent}
        />
      );
    }

    if (!depthLevels.length) {
      return renderBrokerGate(
        "No broker depth returned",
        "IBKR did not return any price ladder rows for this contract yet. This panel shows live book depth, not synthetic levels.",
      );
    }

    const bestBidLevel =
      depthLevels.find(
        (level) => typeof level.bidSize === "number" && level.bidSize > 0,
      ) || null;
    const bestAskLevel =
      depthLevels.find(
        (level) => typeof level.askSize === "number" && level.askSize > 0,
      ) || null;

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 0 6px"),
            borderBottom: `1px solid ${T.border}`,
            fontFamily: T.mono,
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BEST BID
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.green }}>
              {formatQuotePrice(bestBidLevel?.price ?? bid)}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              LEVELS
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>
              {depthLevels.length}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BEST ASK
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.red }}>
              {formatQuotePrice(bestAskLevel?.price ?? ask)}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "42px 58px 42px 34px",
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: fs(7),
            color: T.textMuted,
            letterSpacing: "0.08em",
            fontFamily: T.mono,
          }}
        >
          <span style={{ textAlign: "right" }}>BID SZ</span>
          <span style={{ textAlign: "right" }}>PRICE</span>
          <span style={{ textAlign: "right" }}>ASK SZ</span>
          <span style={{ textAlign: "right" }}>ROW</span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: sp(2),
          }}
        >
          {depthLevels.map((level) => (
            <div
              key={`${level.row}_${level.price}`}
              style={{
                display: "grid",
                gridTemplateColumns: "42px 58px 42px 34px",
                gap: sp(4),
                alignItems: "center",
                padding: sp("3px 0"),
                fontSize: fs(9),
                fontFamily: T.mono,
                borderBottom: `1px solid ${T.border}08`,
                background: level.isLastTrade ? `${T.accent}10` : "transparent",
              }}
            >
              <span
                style={{
                  color:
                    typeof level.bidSize === "number" && level.bidSize > 0
                      ? T.green
                      : T.textDim,
                  textAlign: "right",
                  fontWeight: typeof level.bidSize === "number" ? 700 : 400,
                }}
              >
                {level.bidSize != null ? level.bidSize.toFixed(0) : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: level.isLastTrade ? T.accent : T.text,
                  textAlign: "right",
                  fontWeight: 700,
                }}
              >
                {formatQuotePrice(level.price)}
              </span>
              <span
                style={{
                  color:
                    typeof level.askSize === "number" && level.askSize > 0
                      ? T.red
                      : T.textDim,
                  textAlign: "right",
                  fontWeight: typeof level.askSize === "number" ? 700 : 400,
                }}
              >
                {level.askSize != null ? level.askSize.toFixed(0) : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: T.textDim,
                  textAlign: "right",
                  fontSize: fs(8),
                }}
              >
                {level.isLastTrade && level.totalSize != null
                  ? `T ${level.totalSize.toFixed(0)}`
                  : level.row}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTapePanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract fills",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    if (!brokerConfigured) {
      return renderBrokerGate(
        "IBKR fills unavailable",
        "The tape tab shows broker executions for this contract once the bridge is configured.",
      );
    }

    if (!brokerAuthenticated) {
      return renderBrokerGate(
        "IBKR login required",
        "Bring the local IBKR bridge online to load broker executions.",
      );
    }

    if (!accountId) {
      return renderBrokerGate(
        "No broker account selected",
        "Select an IBKR account to load this contract's execution history.",
      );
    }

    if (!selectedContractMeta?.providerContractId) {
      return renderBrokerGate(
        "Contract still loading",
        "Wait for the selected option contract to resolve to a broker contract id.",
        true,
      );
    }

    if (tapeQuery.isPending && !contractExecutions.length) {
      return (
        <DataUnavailableState
          title="Loading IBKR fills"
          detail="Requesting broker executions for the selected option contract."
          loading
          tone={T.accent}
        />
      );
    }

    if (!contractExecutions.length) {
      return renderBrokerGate(
        "No broker fills yet",
        "This tab shows IBKR executions for the selected contract. It is not a public market-wide tape.",
      );
    }

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "28px 24px 52px 56px 44px",
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: fs(7),
            color: T.textMuted,
            letterSpacing: "0.08em",
            fontFamily: T.mono,
          }}
        >
          <span>SIDE</span>
          <span style={{ textAlign: "right" }}>QTY</span>
          <span style={{ textAlign: "right" }}>PRICE</span>
          <span style={{ textAlign: "right" }}>NET</span>
          <span style={{ textAlign: "right" }}>TIME</span>
        </div>
        {contractExecutions.map((execution) => (
          <div
            key={execution.id}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 24px 52px 56px 44px",
              gap: sp(4),
              alignItems: "center",
              padding: sp("4px 0"),
              fontSize: fs(9),
              fontFamily: T.mono,
              borderBottom: `1px solid ${T.border}08`,
            }}
            title={`${formatExecutionContractLabel(execution)}${execution.exchange ? ` · ${execution.exchange}` : ""}`}
          >
            <span
              style={{
                color: execution.side === "buy" ? T.green : T.red,
                fontWeight: 700,
              }}
            >
              {execution.side === "buy" ? "BUY" : "SELL"}
            </span>
            <span style={{ color: T.textDim, textAlign: "right" }}>
              {isFiniteNumber(execution.quantity)
                ? execution.quantity.toFixed(0)
                : MISSING_VALUE}
            </span>
            <span style={{ color: T.text, textAlign: "right", fontWeight: 700 }}>
              {formatQuotePrice(execution.price)}
            </span>
            <span
              style={{
                color:
                  !isFiniteNumber(execution.netAmount)
                    ? T.textDim
                    : execution.netAmount >= 0
                      ? T.green
                      : T.red,
                textAlign: "right",
              }}
            >
              {execution.netAmount != null
                ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(
                    execution.netAmount,
                  ).toFixed(0)}`
                : MISSING_VALUE}
            </span>
            <span
              style={{
                color: T.textDim,
                textAlign: "right",
                fontSize: fs(8),
              }}
            >
              {formatRelativeTimeShort(execution.executedAt)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: sp(4),
        }}
      >
        <div style={{ display: "flex", gap: sp(8), alignItems: "center" }}>
          <TabBtn id="book" label="BOOK" />
          <TabBtn id="flow" label="FLOW" />
          <TabBtn id="tape" label="TAPE" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span
            style={{
              fontSize: fs(8),
              color:
                tab === "flow"
                  ? effectiveFlowEvents.length
                    ? T.accent
                    : T.textDim
                  : brokerAuthenticated
                    ? T.green
                    : T.textDim,
              fontFamily: T.mono,
            }}
          >
            {liveStatusLabel}
          </span>
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: contractColor,
              fontWeight: 700,
            }}
          >
            {slot.strike}
            {slot.cp}
          </span>
          <span
            style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
          >
            ${spread.toFixed(2)} sprd
          </span>
        </div>
      </div>

      {tab === "book" && renderBookPanel()}

      {tab === "flow" &&
        (effectiveFlowEvents.length ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: sp(4),
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                padding: sp("4px 0"),
              }}
            >
              <OrderFlowDonut flow={tickerFlow} size={70} thickness={11} />
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
                    fontSize: fs(8),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                  }}
                >
                  {slot.ticker} BUY / SELL
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: T.mono,
                    fontSize: fs(10),
                  }}
                >
                  <span style={{ color: T.green, fontWeight: 700 }}>
                    $
                    {(
                      tickerFlow.buyXL +
                      tickerFlow.buyL +
                      tickerFlow.buyM +
                      tickerFlow.buyS
                    ).toFixed(0)}
                    M
                  </span>
                  <span style={{ color: T.red, fontWeight: 700 }}>
                    $
                    {(
                      tickerFlow.sellXL +
                      tickerFlow.sellL +
                      tickerFlow.sellM +
                      tickerFlow.sellS
                    ).toFixed(0)}
                    M
                  </span>
                </div>
                {(() => {
                  const buy =
                    tickerFlow.buyXL +
                    tickerFlow.buyL +
                    tickerFlow.buyM +
                    tickerFlow.buyS;
                  const sell =
                    tickerFlow.sellXL +
                    tickerFlow.sellL +
                    tickerFlow.sellM +
                    tickerFlow.sellS;
                  const buyPct = (buy / Math.max(buy + sell, 1)) * 100;
                  return (
                    <>
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
                        {buyPct.toFixed(1)}% buy
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div
              style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(3) }}
            >
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  marginBottom: sp(2),
                }}
              >
                BY SIZE
              </div>
              {(() => {
                const max = Math.max(
                  tickerFlow.buyXL,
                  tickerFlow.buyL,
                  tickerFlow.buyM,
                  tickerFlow.buyS,
                  tickerFlow.sellXL,
                  tickerFlow.sellL,
                  tickerFlow.sellM,
                  tickerFlow.sellS,
                );
                return (
                  <>
                    <SizeBucketRow
                      label="XL"
                      buy={tickerFlow.buyXL}
                      sell={tickerFlow.sellXL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={tickerFlow.buyL}
                      sell={tickerFlow.sellL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={tickerFlow.buyM}
                      sell={tickerFlow.sellM}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={tickerFlow.buyS}
                      sell={tickerFlow.sellS}
                      maxValue={max}
                    />
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          <DataUnavailableState
            title="No live flow tape"
            detail={`Spot flow for ${slot.ticker} is hidden until current prints are returned from the external flow provider.`}
          />
        ))}

      {tab === "tape" && renderTapePanel()}
    </div>
  );
};

export const TradePositionsPanel = ({
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  onLoadPosition,
  streamingPaused = false,
}) => {
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const pos = usePositions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("open");
  const positionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const ordersQuery = useListOrders(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const executionsQuery = useQuery({
    queryKey: ["broker-executions", accountId, environment],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        days: 7,
        limit: 64,
      }),
    enabled: Boolean(brokerAuthenticated && accountId),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      streamingPaused ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      days: "7",
      limit: "64",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          ["broker-executions", accountId, environment],
          payload,
        );
      } catch {}
    };

    source.addEventListener("executions", handleExecutions);
    return () => {
      source.removeEventListener("executions", handleExecutions);
      source.close();
    };
  }, [accountId, brokerAuthenticated, environment, queryClient, streamingPaused]);
  const refreshBrokerQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
    queryClient.invalidateQueries({ queryKey: ["broker-executions"] });
  }, [queryClient]);
  const placeOrderMutation = usePlaceOrder({
    mutation: {
      onSuccess: () => {
        refreshBrokerQueries();
      },
    },
  });
  const previewOrderMutation = usePreviewOrder();
  const replaceOrderMutation = useReplaceOrder({
    mutation: {
      onSuccess: () => {
        refreshBrokerQueries();
      },
    },
  });
  const cancelOrderMutation = useCancelOrder({
    mutation: {
      onSuccess: (response) => {
        refreshBrokerQueries();
        toast.push({
          kind: "success",
          title: "Cancel submitted",
          body: `${response.orderId} · ${response.message}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Cancel failed",
          body:
            error?.message || "The broker did not accept the cancel request.",
        });
      },
    },
  });
  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);
  const [liveConfirmError, setLiveConfirmError] = useState(null);
  const closeLiveConfirm = () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmState(null);
  };
  const runLiveConfirm = async () => {
    if (!liveConfirmState?.onConfirm) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmPending(true);
    try {
      await liveConfirmState.onConfirm();
      setLiveConfirmState(null);
    } catch (error) {
      setLiveConfirmError(formatLiveBrokerActionError(error));
    } finally {
      setLiveConfirmPending(false);
    }
  };
  const gatewayActionDisabled = !gatewayTradingReady;
  const notifyGatewayTradingUnavailable = () => {
    toast.push({
      kind: "warn",
      title: "IB Gateway disconnected",
      body: gatewayTradingMessage,
    });
  };

  const openPositions = useMemo(() => {
    if (brokerConfigured) {
      if (!brokerAuthenticated || !accountId) {
        return [];
      }

      return (positionsQuery.data?.positions || []).filter(isOpenPositionRow).map((position) => {
        const isOption = Boolean(position.optionContract);
        const expiration = isOption
          ? formatExpirationLabel(position.optionContract.expirationDate)
          : "EQUITY";
        const contract = isOption
          ? `${position.optionContract.strike} ${position.optionContract.right === "call" ? "C" : "P"} ${expiration}`
          : "EQUITY";

        return {
          _isUser: false,
          _isLive: true,
          _id: position.id,
          _brokerPosition: position,
          ticker: position.symbol,
          side: position.quantity >= 0 ? "LONG" : "SHORT",
          contract,
          qty: Math.abs(position.quantity),
          entry: position.averagePrice,
          mark: position.marketPrice,
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
          sl: null,
          tp: null,
        };
      });
    }

    return pos.positions.map((p) => ({
        _isUser: true,
        _isLive: false,
        _id: p.id,
        _position: p,
        ticker: p.ticker,
        side:
          p.kind === "option" ? (p.side === "BUY" ? "LONG" : "SHORT") : p.side,
        contract:
          p.kind === "option"
            ? `${p.strike} ${p.cp} ${p.exp}`
            : `${p.side} EQUITY`,
        qty: p.qty,
        entry: p.entry,
        mark: null,
        pnl: null,
        pct: null,
        sl: p.stopLoss ?? +(p.entry * 0.65).toFixed(2),
        tp: p.takeProfit ?? +(p.entry * 1.75).toFixed(2),
      }));
  }, [
    accountId,
    brokerAuthenticated,
    brokerConfigured,
    pos.positions,
    positionsQuery.data,
  ]);
  const liveOrders = useMemo(
    () =>
      [...(ordersQuery.data?.orders || [])].sort((left, right) => {
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      }),
    [ordersQuery.data],
  );
  const executionRows = useMemo(
    () =>
      (executionsQuery.data?.executions || []).map((execution) => ({
        id: execution.id,
        ticker: execution.symbol,
        side: String(execution.side || "").toLowerCase() === "buy" ? "BUY" : "SELL",
        contract: formatExecutionContractLabel(execution),
        qty: execution.quantity,
        price: execution.price,
        netAmount: execution.netAmount,
        exchange: execution.exchange,
        executedAt: execution.executedAt,
      })),
    [executionsQuery.data],
  );

  const totalOpenPnl = openPositions.reduce(
    (sum, position) =>
      sum + (isFiniteNumber(position.pnl) ? position.pnl : 0),
    0,
  );
  const hasOpenPnl = openPositions.some((position) => isFiniteNumber(position.pnl));
  const pendingOrderCount = liveOrders.filter(
    (order) => !FINAL_ORDER_STATUSES.has(order.status),
  ).length;
  const parseContract = (str) => {
    const parts = str.split(" ");
    return { strike: parseFloat(parts[0]), cp: parts[1], exp: parts[2] };
  };
  const buildOptionContractPayload = (optionContract) =>
    optionContract
      ? {
          ticker: optionContract.ticker,
          underlying: optionContract.underlying,
          expirationDate: optionContract.expirationDate,
          strike: optionContract.strike,
          right: optionContract.right,
          multiplier: optionContract.multiplier,
          sharesPerContract: optionContract.sharesPerContract,
          providerContractId: optionContract.providerContractId,
        }
      : null;
  const buildCloseOrderRequest = (position) => ({
    accountId,
    mode: environment,
    symbol: position.symbol,
    assetClass: position.assetClass,
    side: position.quantity >= 0 ? "sell" : "buy",
    type: "market",
    quantity: Math.abs(position.quantity),
    timeInForce: "day",
    optionContract: buildOptionContractPayload(position.optionContract),
  });
  const buildStopOrderRequest = (position, stopPrice) => ({
    accountId,
    mode: environment,
    symbol: position.symbol,
    assetClass: position.assetClass,
    side: position.quantity >= 0 ? "sell" : "buy",
    type: "stop",
    quantity: Math.abs(position.quantity),
    stopPrice,
    timeInForce: "gtc",
    optionContract: buildOptionContractPayload(position.optionContract),
  });
  const findExistingStopOrder = (position) =>
    liveOrders.find((order) => {
      if (FINAL_ORDER_STATUSES.has(order.status) || order.type !== "stop") {
        return false;
      }
      if (order.symbol !== position.symbol) {
        return false;
      }
      if (order.side !== (position.quantity >= 0 ? "sell" : "buy")) {
        return false;
      }
      if (position.optionContract || order.optionContract) {
        return sameOptionContract(order.optionContract, position.optionContract);
      }
      return true;
    }) || null;
  const historyCount = executionRows.length;
  const headerSummaryColor =
    tab === "orders"
      ? pendingOrderCount > 0
        ? T.amber
        : T.textDim
      : tab === "history" && brokerConfigured
        ? historyCount > 0
          ? T.accent
          : T.textDim
        : hasOpenPnl
          ? totalOpenPnl >= 0
            ? T.green
            : T.red
          : T.textDim;
  const headerSummaryValue =
    tab === "orders"
      ? `${pendingOrderCount} LIVE`
      : tab === "history" && brokerConfigured
        ? `${historyCount} FILLS`
        : hasOpenPnl
          ? `${totalOpenPnl >= 0 ? "+" : ""}$${totalOpenPnl.toFixed(0)}`
          : MISSING_VALUE;

  const closeRow = async (p) => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Bring the local IBKR bridge online before managing live positions.",
      });
      return;
    }

    if (p._isLive && p._brokerPosition) {
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Flatten ${p.ticker} ${p.contract}`,
        detail: "Submit a live market order to close this broker position.",
        confirmLabel: "SEND LIVE CLOSE",
        confirmTone: T.red,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "SYMBOL", value: p.ticker },
          { label: "CONTRACT", value: p.contract },
          { label: "SIDE", value: p.side },
          { label: "QTY", value: String(p.qty) },
        ],
        onConfirm: async () => {
          await placeOrderMutation.mutateAsync({
            data: {
              ...buildCloseOrderRequest(p._brokerPosition),
              confirm: true,
            },
          });
          toast.push({
            kind: "success",
            title: "Close submitted",
            body: `${p.ticker} ${p.contract} · ${p.qty} to flatten`,
          });
        },
      });
      return;
    }

    if (p._isUser) {
      pos.closePosition(p._id);
    }
    toast.push({
      kind: "success",
      title: "Position closed",
      body: `${p.ticker} ${p.contract}`,
    });
  };

  const handleCloseAll = async () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before flattening live positions.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to close",
        body: "No open positions.",
      });
      return;
    }

    if (brokerConfigured) {
      const livePositions = openPositions.filter((position) => position._isLive);
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Flatten ${livePositions.length} live position${livePositions.length === 1 ? "" : "s"}`,
        detail:
          "Submit live broker orders to flatten every open IBKR position in the active account.",
        confirmLabel: "FLATTEN LIVE POSITIONS",
        confirmTone: T.red,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "POSITIONS", value: String(livePositions.length) },
        ],
        onConfirm: async () => {
          const results = await Promise.allSettled(
            livePositions.map((position) =>
              placeOrderMutation.mutateAsync({
                data: {
                  ...buildCloseOrderRequest(position._brokerPosition),
                  confirm: true,
                },
              }),
            ),
          );
          const successCount = results.filter(
            (result) => result.status === "fulfilled",
          ).length;
          toast.push({
            kind: successCount === livePositions.length ? "success" : "warn",
            title: `Submitted ${successCount}/${livePositions.length} close order${livePositions.length === 1 ? "" : "s"}`,
            body:
              successCount === livePositions.length
                ? "All live positions received flatten requests."
                : "Some live positions could not be flattened.",
          });
        },
      });
      return;
    }

    pos.closeAll();
    toast.push({
      kind: "success",
      title: `Closed ${openPositions.length} position${openPositions.length === 1 ? "" : "s"}`,
      body: "Local positions removed.",
    });
  };

  const handleSetStops = async () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before modifying live risk controls.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "No positions",
        body: "Nothing to protect.",
      });
      return;
    }

    if (brokerConfigured) {
      const livePositions = (positionsQuery.data?.positions || []).filter(isOpenPositionRow);
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Protect ${livePositions.length} live position${livePositions.length === 1 ? "" : "s"}`,
        detail:
          "Preview and synchronize live protective stop orders for every open broker position.",
        confirmLabel: "SYNC LIVE STOPS",
        confirmTone: T.amber,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "POSITIONS", value: String(livePositions.length) },
        ],
        onConfirm: async () => {
          let protectedCount = 0;
          let failedCount = 0;

          for (const position of livePositions) {
            const referencePrice =
              isFiniteNumber(position.marketPrice) && position.marketPrice > 0
                ? position.marketPrice
                : position.averagePrice;
            if (!isFiniteNumber(referencePrice) || referencePrice <= 0) {
              failedCount += 1;
              continue;
            }

            const stopPrice = +(
              position.quantity >= 0
                ? referencePrice * 0.8
                : referencePrice * 1.2
            ).toFixed(2);
            const stopRequest = buildStopOrderRequest(position, stopPrice);

            try {
              const preview = await previewOrderMutation.mutateAsync({
                data: stopRequest,
              });
              const existingStop = findExistingStopOrder(position);

              if (existingStop && preview?.orderPayload) {
                await replaceOrderMutation.mutateAsync({
                  orderId: existingStop.id,
                  data: {
                    accountId,
                    mode: environment,
                    confirm: true,
                    order: preview.orderPayload,
                  },
                });
              } else {
                await placeOrderMutation.mutateAsync({
                  data: {
                    ...stopRequest,
                    confirm: true,
                  },
                });
              }

              protectedCount += 1;
            } catch (error) {
              failedCount += 1;
            }
          }

          toast.push({
            kind:
              failedCount === 0 ? "success" : protectedCount ? "warn" : "error",
            title: `Stops updated ${protectedCount}/${livePositions.length}`,
            body:
              failedCount === 0
                ? "Protective broker stop orders are in sync."
                : "Some positions could not be protected.",
          });
        },
      });
      return;
    }

    const userPositions = openPositions.filter((p) => p._isUser);
    userPositions.forEach((p) => {
      pos.updateStops(p._id, {
        stopLoss: +(p.entry * 0.8).toFixed(2),
        takeProfit: +(p.entry * 1.5).toFixed(2),
      });
    });
    toast.push({
      kind: "success",
      title: "Stops applied",
      body: `Protected ${userPositions.length} local position${userPositions.length === 1 ? "" : "s"}.`,
    });
  };

  const handleRollAll = () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before attempting a live roll workflow.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (brokerConfigured && accountId) {
      toast.push({
        kind: "info",
        title: "Live roll workflow disabled",
        body: "Rolling live positions remains disabled until a multi-leg IBKR workflow is implemented.",
      });
      return;
    }
    const userPositions = pos.positions.filter((p) => p.kind === "option");
    if (userPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to roll",
        body: "No option positions.",
      });
      return;
    }
    userPositions.forEach((p) => pos.rollPosition(p.id));
    toast.push({
      kind: "success",
      title: `Rolled ${userPositions.length} position${userPositions.length === 1 ? "" : "s"}`,
      body: `Extended expiration to next cycle`,
    });
  };

  const handleCancelOrder = (order) => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before canceling live orders.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    setLiveConfirmState({
      title: `Cancel ${order.symbol} ${order.type.toUpperCase()} order`,
      detail: "Send a live broker cancellation request for this working IBKR order.",
      confirmLabel: "CANCEL LIVE ORDER",
      confirmTone: T.red,
      lines: [
        { label: "ACCOUNT", value: accountId || MISSING_VALUE },
        { label: "SYMBOL", value: order.symbol },
        { label: "SIDE", value: order.side.toUpperCase() },
        { label: "TYPE", value: order.type.toUpperCase() },
        { label: "QTY", value: String(order.quantity) },
        { label: "STATUS", value: formatEnumLabel(order.status) },
      ],
      onConfirm: async () => {
        await cancelOrderMutation.mutateAsync({
          orderId: order.id,
          data: {
            accountId,
            manualIndicator: true,
            confirm: true,
          },
        });
      },
    });
  };

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: 4,
          gap: sp(4),
        }}
      >
        <div
          style={{
            display: "flex",
            gap: sp(5),
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <button
            onClick={() => setTab("open")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "open" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "open"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            OPEN{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {openPositions.length}
            </span>
          </button>
          <button
            onClick={() => setTab("history")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "history" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "history"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            HIST{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {historyCount}
            </span>
          </button>
          <button
            onClick={() => setTab("orders")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "orders" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "orders"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            ORDERS{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {brokerConfigured ? liveOrders.length : 0}
            </span>
          </button>
        </div>
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.mono,
            color: headerSummaryColor,
            whiteSpace: "nowrap",
          }}
        >
          {headerSummaryValue}
        </span>
      </div>
      {gatewayActionDisabled ? (
        <div
          style={{
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            color: T.amber,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.35,
          }}
        >
          {gatewayTradingMessage}
        </div>
      ) : null}
      {tab === "open" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {brokerConfigured && !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              IBKR is configured, but live positions stay hidden until the local
              bridge authenticates.
            </div>
          ) : brokerConfigured && !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : openPositions.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No open positions
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "34px 32px 78px 22px 48px 48px 44px 42px 18px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>TICK</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>ENTRY</span>
                <span style={{ textAlign: "right" }}>MARK</span>
                <span style={{ textAlign: "right" }}>P&L</span>
                <span style={{ textAlign: "right" }}>%</span>
                <span></span>
              </div>
              {openPositions.map((p) => {
                const isLoadable =
                  p.contract && p.contract.match(/\d+\s[CP]\s/);
                const closeDisabled = gatewayActionDisabled;
                return (
                  <div
                    key={p._id}
                    onClick={() => {
                      if (isLoadable) {
                        const parsed = parseContract(p.contract);
                        onLoadPosition({ ticker: p.ticker, ...parsed });
                      }
                    }}
                    title={
                      isLoadable
                        ? `Click to load ${p.ticker} ${p.contract} into Order Ticket`
                        : `${p.ticker} equity position`
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "34px 32px 78px 22px 48px 48px 44px 42px 18px",
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      borderBottom: `1px solid ${T.border}08`,
                      cursor: isLoadable ? "pointer" : "default",
                      alignItems: "center",
                      transition: "background 0.1s",
                      background: p._isUser ? `${T.accent}08` : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (isLoadable) e.currentTarget.style.background = T.bg3;
                    }}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = p._isUser
                        ? `${T.accent}08`
                        : "transparent")
                    }
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {p.ticker}
                    </span>
                    <span
                      style={{
                        color: p.side === "LONG" ? T.green : T.red,
                        fontWeight: 600,
                        fontSize: fs(7),
                        padding: sp("1px 4px"),
                        background:
                          p.side === "LONG" ? `${T.green}15` : `${T.red}15`,
                        borderRadius: dim(2),
                        border: `1px solid ${p.side === "LONG" ? T.green : T.red}30`,
                        textAlign: "center",
                        alignSelf: "center",
                      }}
                    >
                      {p.side}
                    </span>
                    <span style={{ color: T.textSec, fontSize: fs(8) }}>
                      {p.contract}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {p.qty}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {formatPriceValue(p.entry)}
                    </span>
                    <span
                      style={{
                        color: T.text,
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {isFiniteNumber(p.mark)
                        ? `$${p.mark.toFixed(2)}`
                        : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        color:
                          !isFiniteNumber(p.pnl)
                            ? T.textDim
                            : p.pnl >= 0
                              ? T.green
                              : T.red,
                        fontWeight: 700,
                        textAlign: "right",
                      }}
                    >
                      {isFiniteNumber(p.pnl)
                        ? `${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(0)}`
                        : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        color:
                          !isFiniteNumber(p.pct)
                            ? T.textDim
                            : p.pct >= 0
                              ? T.green
                              : T.red,
                        fontWeight: 600,
                        textAlign: "right",
                        fontSize: fs(8),
                      }}
                    >
                      {formatSignedPercent(p.pct, 1)}
                    </span>
                    <button
                      disabled={closeDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (closeDisabled) {
                          notifyGatewayTradingUnavailable();
                          return;
                        }
                        closeRow(p);
                      }}
                      title={
                        closeDisabled
                          ? gatewayTradingMessage
                          : p._isLive
                            ? "Submit broker close-out order"
                            : "Close position"
                      }
                      style={{
                        background: "transparent",
                        border: `1px solid ${T.red}40`,
                        color: T.red,
                        fontSize: fs(9),
                        fontFamily: T.mono,
                        fontWeight: 700,
                        borderRadius: dim(2),
                        cursor: closeDisabled ? "not-allowed" : "pointer",
                        padding: sp("1px 0"),
                        lineHeight: 1,
                        opacity: closeDisabled ? 0.45 : 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : tab === "history" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {!brokerConfigured ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
              padding: sp(16),
              textAlign: "center",
            }}
          >
              No broker history is available until the IBKR bridge is configured and fills exist on the selected account.
            </div>
          ) : !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Bring the local IBKR bridge online to load broker fills.
            </div>
          ) : !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : executionsQuery.isPending && !executionRows.length ? (
            <DataUnavailableState
              title="Loading broker fills"
              detail="Requesting broker execution history for the active account."
              loading
              tone={T.accent}
            />
          ) : !executionRows.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No broker executions
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "40px 30px minmax(0,1fr) 24px 50px 64px 42px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>SYM</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>PRICE</span>
                <span style={{ textAlign: "right" }}>NET</span>
                <span style={{ textAlign: "right" }}>TIME</span>
              </div>
              {executionRows.map((execution) => (
                <div
                  key={execution.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "40px 30px minmax(0,1fr) 24px 50px 64px 42px",
                    gap: sp(3),
                    padding: sp("3px 4px"),
                    fontSize: fs(9),
                    fontFamily: T.mono,
                    borderBottom: `1px solid ${T.border}08`,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700, color: T.text }}>
                    {execution.ticker}
                  </span>
                  <span
                    style={{
                      color: execution.side === "BUY" ? T.green : T.red,
                      fontWeight: 700,
                    }}
                  >
                    {execution.side}
                  </span>
                  <span
                    style={{
                      color: T.textSec,
                      fontSize: fs(8),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={execution.contract}
                  >
                    {execution.contract}
                  </span>
                  <span style={{ color: T.textDim, textAlign: "right" }}>
                    {execution.qty}
                  </span>
                  <span style={{ color: T.textDim, textAlign: "right" }}>
                    {isFiniteNumber(execution.price)
                      ? `$${execution.price.toFixed(2)}`
                      : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color:
                        !isFiniteNumber(execution.netAmount)
                          ? T.textDim
                          : execution.netAmount >= 0
                            ? T.green
                            : T.red,
                      textAlign: "right",
                    }}
                    >
                      {isFiniteNumber(execution.netAmount)
                        ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(execution.netAmount).toFixed(0)}`
                        : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color: T.textDim,
                      textAlign: "right",
                      fontSize: fs(7),
                    }}
                  >
                    {formatAppTimeForPreferences(
                      execution.executedAt,
                      userPreferences,
                    )}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {!brokerConfigured ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The live order blotter activates after IBKR is configured.
            </div>
          ) : !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Bring the local IBKR bridge online to load live IBKR
              orders.
            </div>
          ) : !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : ordersQuery.isPending && !liveOrders.length ? (
            <DataUnavailableState
              title="Loading live orders"
              detail="Requesting live IBKR orders for the active account."
              loading
              tone={T.accent}
            />
          ) : !liveOrders.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No broker orders
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "42px 30px 44px 22px 28px 58px 42px 24px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>SYM</span>
                <span>SIDE</span>
                <span>TYPE</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>FILL</span>
                <span style={{ textAlign: "right" }}>STATUS</span>
                <span style={{ textAlign: "right" }}>TIME</span>
                <span></span>
              </div>
              {liveOrders.map((order) => {
                const isTerminal = FINAL_ORDER_STATUSES.has(order.status);
                const isOption = Boolean(order.optionContract);
                const cancelDisabled =
                  isTerminal || cancelOrderMutation.isPending || gatewayActionDisabled;
                return (
                  <div
                    key={order.id}
                    onClick={() => {
                      if (!isOption) return;
                      onLoadPosition({
                        ticker: order.symbol,
                        strike: order.optionContract.strike,
                        cp: order.optionContract.right === "call" ? "C" : "P",
                        exp: formatExpirationLabel(
                          order.optionContract.expirationDate,
                        ),
                      });
                    }}
                    title={
                      isOption
                        ? `Load ${order.symbol} ${order.optionContract.strike}${order.optionContract.right === "call" ? "C" : "P"} into Order Ticket`
                        : order.id
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "42px 30px 44px 22px 28px 58px 42px 24px",
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      borderBottom: `1px solid ${T.border}08`,
                      cursor: isOption ? "pointer" : "default",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {order.symbol}
                    </span>
                    <span
                      style={{
                        color: order.side === "buy" ? T.green : T.red,
                        fontWeight: 700,
                      }}
                    >
                      {order.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span style={{ color: T.textSec }}>
                      {order.type.toUpperCase()}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {order.quantity}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {order.filledQuantity}
                    </span>
                    <span
                      style={{
                        color: orderStatusColor(order.status),
                        textAlign: "right",
                        fontSize: fs(8),
                        fontWeight: 700,
                      }}
                    >
                      {formatEnumLabel(order.status)}
                    </span>
                    <span
                      style={{
                        color: T.textDim,
                        textAlign: "right",
                        fontSize: fs(7),
                      }}
                    >
                      {formatRelativeTimeShort(order.updatedAt)}
                    </span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCancelOrder(order);
                      }}
                      disabled={cancelDisabled}
                      title={
                        gatewayActionDisabled
                          ? gatewayTradingMessage
                          : isTerminal
                            ? "Terminal order"
                            : "Cancel order"
                      }
                      style={{
                        background: "transparent",
                        border: `1px solid ${isTerminal ? T.border : T.red}40`,
                        color: isTerminal ? T.textDim : T.red,
                        fontSize: fs(9),
                        fontFamily: T.mono,
                        fontWeight: 700,
                        borderRadius: dim(2),
                        cursor:
                          cancelDisabled
                            ? "not-allowed"
                            : "pointer",
                        padding: sp("1px 0"),
                        lineHeight: 1,
                        opacity: cancelDisabled ? 0.45 : 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {tab !== "orders" ? (
        <div
          style={{
            display: "flex",
            gap: sp(4),
            borderTop: `1px solid ${T.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
          }}
        >
          <button
            onClick={handleCloseAll}
            disabled={gatewayActionDisabled}
            title={gatewayActionDisabled ? gatewayTradingMessage : "Close all positions"}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${T.red}40`,
              borderRadius: dim(3),
              color: T.red,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
              cursor: gatewayActionDisabled ? "not-allowed" : "pointer",
              opacity: gatewayActionDisabled ? 0.55 : 1,
            }}
          >
            Close All
          </button>
          <button
            onClick={handleSetStops}
            disabled={gatewayActionDisabled}
            title={gatewayActionDisabled ? gatewayTradingMessage : "Set protective stops"}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color: T.textSec,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
              cursor: gatewayActionDisabled ? "not-allowed" : "pointer",
              opacity: gatewayActionDisabled ? 0.55 : 1,
            }}
          >
            Set Stops
          </button>
          <button
            onClick={handleRollAll}
            disabled={gatewayActionDisabled}
            title={gatewayActionDisabled ? gatewayTradingMessage : "Roll option positions"}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${T.amber}40`,
              borderRadius: dim(3),
              color: T.amber,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
              cursor:
                gatewayActionDisabled ||
                (brokerConfigured && brokerAuthenticated && accountId)
                  ? "not-allowed"
                  : "pointer",
              opacity:
                gatewayActionDisabled ||
                (brokerConfigured && brokerAuthenticated && accountId)
                  ? 0.6
                  : 1,
            }}
          >
            Roll
          </button>
        </div>
      ) : (
        <div
          style={{
            borderTop: `1px solid ${T.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
          }}
        >
          {brokerConfigured
            ? `${pendingOrderCount} non-terminal order${pendingOrderCount === 1 ? "" : "s"}`
            : "Connect IBKR to enable live order management."}
        </div>
      )}
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm live broker action"}
        detail={
          liveConfirmState?.detail ||
          "Confirm this live Interactive Brokers action before sending it."
        }
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM LIVE ACTION"}
        confirmTone={liveConfirmState?.confirmTone || T.red}
        pending={liveConfirmPending}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </div>
  );
};

export const TickerUniverseSearchPanel = ({
  open,
  onSelectTicker,
  onClose,
  currentTicker = "",
}) => {
  const inputRef = useRef(null);
  const listboxIdRef = useRef(
    `ticker-search-panel-listbox-${Math.random().toString(36).slice(2)}`,
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [marketFilter, setMarketFilter] = useState(() =>
    normalizeTickerSearchMarketFilter(_initialState.marketGridTickerSearchMarketFilter),
  );
  const [visibleResultLimit, setVisibleResultLimit] = useState(
    TICKER_SEARCH_INITIAL_RESULT_LIMIT,
  );
  const [rowCache, setRowCache] = useState(() =>
    buildTickerSearchCache(
      normalizePersistedTickerSearchRows(_initialState.marketGridTickerSearchCache),
    ),
  );
  const {
    deferredQuery,
    searchEnabled,
    searchQuery,
    hasDisplayableSearchError,
    quickPickGroups,
    prioritySuggestionGroups,
    secondarySuggestionGroups,
    results,
    selectableResults,
    rawResultCount,
    hasMoreResults,
  } =
    useTickerSearchController({
      open,
      query,
      marketFilter,
      currentTicker,
      contextSymbols: currentTicker ? [currentTicker] : [],
      rowCache,
      limit: visibleResultLimit,
    });
  const hasLiveResults = searchEnabled && results.length > 0;
  const prioritySuggestionRowCount =
    flattenTickerSuggestionGroups(prioritySuggestionGroups).length;
  const secondarySuggestionRowCount =
    flattenTickerSuggestionGroups(secondarySuggestionGroups).length;
  const suggestionRowCount =
    prioritySuggestionRowCount + secondarySuggestionRowCount;
  const showLoadingSkeleton =
    searchEnabled && searchQuery.isPending && !hasLiveResults && !suggestionRowCount;
  const showUpdatingState =
    searchEnabled && searchQuery.isFetching && (hasLiveResults || suggestionRowCount > 0);

  useEffect(() => {
    persistState({ marketGridTickerSearchMarketFilter: marketFilter });
  }, [marketFilter]);

  useEffect(() => {
    const rows = (searchQuery.data?.results || [])
      .map(normalizeTickerSearchResultForStorage)
      .filter(Boolean);
    if (!rows.length) return;
    setRowCache((current) => mergeTickerSearchCacheRows(current, rows));
  }, [searchQuery.data?.results]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, deferredQuery, selectableResults.length]);

  useEffect(() => {
    setVisibleResultLimit(TICKER_SEARCH_INITIAL_RESULT_LIMIT);
  }, [deferredQuery, marketFilter, open]);

  const handleSelect = useCallback(
    (result) => {
      if (!result) {
        return;
      }
      if (!isApiBackedTickerSearchRow(result)) {
        setQuery(normalizeTickerSymbol(result._resolutionQuery || result.ticker));
        return;
      }
      onSelectTicker(result);
    },
    [onSelectTicker],
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length
            ? Math.min(current + 1, selectableResults.length - 1)
            : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length ? Math.max(current - 1, 0) : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        if (selectableResults[activeIndex]) {
          event.preventDefault();
          handleSelect(selectableResults[activeIndex]);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        setMarketFilter((current) => {
          const index = TICKER_SEARCH_MARKET_FILTERS.findIndex(
            (filter) => filter.value === current,
          );
          const direction = event.shiftKey ? -1 : 1;
          const nextIndex =
            (Math.max(0, index) + direction + TICKER_SEARCH_MARKET_FILTERS.length) %
            TICKER_SEARCH_MARKET_FILTERS.length;
          return TICKER_SEARCH_MARKET_FILTERS[nextIndex].value;
        });
      }
    },
    [activeIndex, handleSelect, onClose, selectableResults],
  );

  const handleLoadMoreResults = useCallback(() => {
    setVisibleResultLimit((current) => current + TICKER_SEARCH_RESULT_INCREMENT);
  }, []);

  const renderTickerSearchGroups = (groups, startIndex = 0) => {
    let baseIndex = startIndex;
    return groups.map((group) => {
      const groupBaseIndex = baseIndex;
      baseIndex += group.rows.length;
      return (
        <div key={group.label}>
          <div
            style={{
              padding: sp("7px 10px 3px"),
              fontSize: fs(8),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {group.label}
          </div>
          {group.rows.map((result, offset) => {
            const index = groupBaseIndex + offset;
            return (
              <TickerSearchRow
                key={`${group.label}-${buildTickerSearchRowKey(result)}`}
                id={`${listboxIdRef.current}-option-${index}`}
                result={result}
                active={index === activeIndex}
                favorite={false}
                onSelect={handleSelect}
                onMouseEnter={() => setActiveIndex(index)}
              />
            );
          })}
        </div>
      );
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="ticker-search-panel"
      style={{
        padding: sp("6px 6px 0"),
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(8),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.06em",
              }}
            >
              SEARCH UNIVERSE
            </span>
            <span
              style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
            >
              Provider-backed ticker search · multi-market
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: T.textMuted,
              cursor: "pointer",
              fontSize: fs(12),
              lineHeight: 1,
              padding: 0,
            }}
            title="Close search"
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          {TICKER_SEARCH_MARKET_FILTERS.map((filter) => {
            const active = marketFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                data-testid={`ticker-search-filter-${filter.value}`}
                aria-pressed={active}
                onClick={() => setMarketFilter(filter.value)}
                style={{
                  border: `1px solid ${active ? T.accent : T.border}`,
                  background: active ? `${T.accent}20` : T.bg1,
                  color: active ? T.accent : T.textDim,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  padding: sp("2px 6px"),
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        <input
          ref={inputRef}
          data-testid="ticker-search-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxIdRef.current}
          aria-autocomplete="list"
          aria-activedescendant={
            selectableResults[activeIndex]
              ? `${listboxIdRef.current}-option-${activeIndex}`
              : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search ticker or company..."
          style={{
            width: "100%",
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            padding: sp("7px 10px"),
            color: T.text,
            fontSize: fs(11),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <div
          id={listboxIdRef.current}
          role="listbox"
          style={{
            minHeight: dim(150),
            maxHeight: dim(220),
            overflowY: "auto",
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            background: T.bg1,
          }}
        >
          {!searchEnabled && quickPickGroups.length
            ? renderTickerSearchGroups(quickPickGroups)
            : null}
          {!searchEnabled && !quickPickGroups.length ? (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              Type a ticker, name, CUSIP, ISIN, FIGI, or IBKR conid.
            </div>
          ) : null}
          {searchEnabled && prioritySuggestionGroups.length
            ? renderTickerSearchGroups(prioritySuggestionGroups)
            : null}
          {showLoadingSkeleton && (
            <TickerSearchSkeletonRows />
          )}
          {showUpdatingState ? (
            <div
              style={{
                padding: sp("6px 10px 0"),
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Updating…
            </div>
          ) : null}
          {hasDisplayableSearchError && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: sp(8),
                padding: sp("10px"),
                fontSize: fs(10),
                color: T.amber,
                fontFamily: T.sans,
                background: `${T.amber}10`,
              }}
            >
              <span>Search failed</span>
              <button
                type="button"
                onClick={() => searchQuery.refetch()}
                style={{
                  border: `1px solid ${T.amber}`,
                  background: "transparent",
                  color: T.amber,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  cursor: "pointer",
                  padding: sp("2px 6px"),
                }}
              >
                retry
              </button>
            </div>
          )}
          {searchEnabled &&
          !showLoadingSkeleton &&
          !hasDisplayableSearchError &&
          !results.length &&
          !suggestionRowCount ? (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              No results for "{deferredQuery}".
            </div>
          ) : null}
          {searchEnabled &&
            !hasDisplayableSearchError &&
            results.map((result, index) => (
            <TickerSearchRow
              key={buildTickerSearchRowKey(result)}
              id={`${listboxIdRef.current}-option-${prioritySuggestionRowCount + index}`}
              result={result}
              active={prioritySuggestionRowCount + index === activeIndex}
              favorite={false}
              onSelect={handleSelect}
              onMouseEnter={() => setActiveIndex(prioritySuggestionRowCount + index)}
            />
          ))}
          {searchEnabled && secondarySuggestionGroups.length
            ? renderTickerSearchGroups(
                secondarySuggestionGroups,
                prioritySuggestionRowCount + results.length,
              )
            : null}
          {searchEnabled && !hasDisplayableSearchError && hasLiveResults && hasMoreResults ? (
            <button
              type="button"
              onClick={handleLoadMoreResults}
              style={{
                width: "100%",
                border: "none",
                borderTop: `1px solid ${T.border}`,
                background: T.bg2,
                color: T.accent,
                cursor: "pointer",
                fontFamily: T.mono,
                fontSize: fs(8),
                padding: sp("8px 10px"),
                textTransform: "uppercase",
              }}
            >
              Load more matches ({results.length}/{rawResultCount}+)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ─── TICKER TAB STRIP ───
// Browser-style horizontal tabs of recently-viewed tickers.
const TickerTabStripItem = ({
  ticker,
  active,
  showClose,
  workspace,
  dragging,
  dropSide,
  onSelect,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}) => {
  const fallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const info = useRuntimeTickerSnapshot(ticker, fallback);
  const signalState = useSignalMonitorStateForSymbol(ticker);
  const flow = useTradeFlowSnapshot(ticker);
  const pos = isFiniteNumber(info?.pct) ? info.pct >= 0 : null;
  const isActive = ticker === active;
  const badges = [
    workspace?.selectedContract?.strike ? "OPT" : null,
    signalState?.fresh ? "SIG" : null,
    (flow?.events || []).length ? "FLOW" : null,
  ].filter(Boolean).slice(0, 3);

  return (
    <div
      onClick={() => onSelect(ticker)}
      onPointerDown={(event) => onPointerDown?.(ticker, event)}
      onPointerMove={(event) => onPointerMove?.(ticker, event)}
      onPointerUp={(event) => onPointerUp?.(event)}
      onPointerCancel={(event) => onPointerCancel?.(event)}
      data-testid={`trade-tab-${ticker}`}
      data-trade-tab-ticker={ticker}
      className={joinMotionClasses("ra-interactive", isActive && "ra-focus-rail")}
      title={[
        ticker,
        badges.length ? `Badges: ${badges.join(", ")}` : null,
      ].filter(Boolean).join(" · ")}
      style={{
        ...motionVars({ accent: T.accent }),
        display: "flex",
        alignItems: "center",
        gap: sp(5),
        padding: sp("4px 8px 5px"),
        background: isActive ? T.bg2 : "transparent",
        borderTop: isActive
          ? `2px solid ${T.accent}`
          : "2px solid transparent",
        borderLeft:
          dropSide === "before"
            ? `3px solid ${T.accent}`
            : `1px solid ${isActive ? T.border : "transparent"}`,
        borderRight:
          dropSide === "after"
            ? `3px solid ${T.accent}`
            : `1px solid ${isActive ? T.border : "transparent"}`,
        borderTopLeftRadius: dim(4),
        borderTopRightRadius: dim(4),
        cursor: dragging ? "grabbing" : "grab",
        flexShrink: 0,
        opacity: dragging ? 0.62 : 1,
        position: "relative",
        top: 1,
        touchAction: "pan-x",
        userSelect: "none",
      }}
    >
      <MarketIdentityMark
        item={{ ticker, name: info?.name || ticker }}
        size={16}
        style={{ borderColor: isActive ? T.accent : T.border }}
      />
      <span
        style={{
          fontSize: fs(11),
          fontWeight: 700,
          fontFamily: T.mono,
          color: isActive ? T.text : T.textSec,
        }}
      >
        {ticker}
      </span>
      <span
        style={{
          fontSize: fs(9),
          fontFamily: T.mono,
          color: pos == null ? T.textDim : pos ? T.green : T.red,
          fontWeight: 600,
        }}
      >
        {formatSignedPercent(info?.pct)}
      </span>
      {badges.map((badge) => (
        <span
          key={badge}
          style={{
            border: `1px solid ${T.border}`,
            color:
              badge === "ERR"
                ? T.red
                : badge === "SIG"
                  ? T.green
                  : badge === "FLOW"
                    ? T.cyan
                    : T.textDim,
            fontFamily: T.mono,
            fontSize: fs(7),
            fontWeight: 900,
            lineHeight: 1,
            padding: sp("2px 3px"),
          }}
        >
          {badge}
        </span>
      ))}
      {showClose ? (
        <button
          data-testid={`trade-tab-close-${ticker}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose?.(ticker);
          }}
          title="Close"
          style={{
            background: "transparent",
            border: "none",
            color: T.textMuted,
            cursor: "pointer",
            fontSize: fs(11),
            padding: 0,
            lineHeight: 1,
            marginLeft: sp(2),
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
};

// Click to switch the focused ticker. ✕ removes from strip.
export const TickerTabStrip = ({
  recent,
  active,
  workspacesByTicker = {},
  onSelect,
  onClose,
  onAddNew,
  onReorder,
}) => {
  const dragRef = useRef(null);
  const dragTargetRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragVisual, setDragVisual] = useState(null);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    dragTargetRef.current = null;
    setDragVisual(null);
  }, []);

  const handleTabPointerDown = useCallback((ticker, event) => {
    if (event.button != null && event.button !== 0) return;
    dragRef.current = {
      ticker,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    setDragVisual({ ticker, overTicker: null, side: null, moved: false });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleTabPointerMove = useCallback((ticker, event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const moved =
      drag.moved ||
      Math.abs(event.clientX - drag.startX) > 4 ||
      Math.abs(event.clientY - drag.startY) > 4;
    drag.moved = moved;

    if (!moved) return;
    const tabElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-trade-tab-ticker]");
    const overTicker = tabElement?.getAttribute("data-trade-tab-ticker") || ticker;
    const rect = tabElement?.getBoundingClientRect?.() || event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    const nextVisual = {
      ticker: drag.ticker,
      overTicker: overTicker === drag.ticker ? null : overTicker,
      side: overTicker === drag.ticker ? null : side,
      moved: true,
    };
    dragTargetRef.current = nextVisual;
    setDragVisual(nextVisual);
  }, []);

  const handleTabPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const target = dragTargetRef.current;
      if (target?.overTicker && target.side) {
        onReorder?.(drag.ticker, target.overTicker, target.side);
      }
    }
    clearDrag();
  }, [clearDrag, onReorder]);

  const handleTabSelect = useCallback((ticker) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(ticker);
  }, [onSelect]);

  return (
    <div
      data-testid="trade-tab-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(1),
        padding: sp("4px 6px 0"),
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {recent.map((ticker) => (
        <TickerTabStripItem
          key={ticker}
          ticker={ticker}
          active={active}
          workspace={workspacesByTicker[ticker]}
          showClose={recent.length > 1}
          dragging={dragVisual?.ticker === ticker && dragVisual.moved}
          dropSide={dragVisual?.overTicker === ticker ? dragVisual.side : null}
          onSelect={handleTabSelect}
          onClose={onClose}
          onPointerDown={handleTabPointerDown}
          onPointerMove={handleTabPointerMove}
          onPointerUp={handleTabPointerUp}
          onPointerCancel={clearDrag}
        />
      ))}
      <button
        onClick={onAddNew}
        title="Add ticker"
        style={{
          background: "transparent",
          border: "none",
          color: T.textDim,
          cursor: "pointer",
          fontSize: fs(13),
          padding: sp("3px 8px"),
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        +
      </button>
    </div>
  );
};

// ─── COMPACT TICKER HEADER ───
// One row showing ticker + price + key stats. Replaces the wide account strip on Trade tab.
export const TradeTickerHeader = ({
  ticker,
  chainRows = [],
  expirationValue = "",
  expiration,
  chainStatus = "empty",
}) => {
  const fallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const info = useRuntimeTickerSnapshot(ticker, fallback);
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const { chainRows: snapshotChainRows, chainStatus: snapshotChainStatus } =
    resolveTradeOptionChainSnapshot(chainSnapshot, expirationValue);
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const resolvedChainStatus =
    chainRows.length || chainStatus !== "empty" ? chainStatus : snapshotChainStatus;
  const pos = isFiniteNumber(info?.pct) ? info.pct >= 0 : null;
  const atmRow =
    (isFiniteNumber(info?.price)
      ? resolvedChainRows.reduce((closest, row) => {
          if (!closest) return row;
          return Math.abs(row.k - info.price) < Math.abs(closest.k - info.price)
            ? row
            : closest;
        }, null)
      : null) ||
    resolvedChainRows.find((r) => r.isAtm);
  const impMove =
    atmRow && isFiniteNumber(atmRow.cPrem) && isFiniteNumber(atmRow.pPrem)
      ? (atmRow.cPrem + atmRow.pPrem) * 0.85
      : null;
  const impPct =
    impMove != null && isFiniteNumber(info?.price) && info.price > 0
      ? (impMove / info.price) * 100
      : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(16),
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 14px"),
        flexShrink: 0,
      }}
    >
      <MarketIdentityMark
        item={{ ticker, name: info?.name || ticker }}
        size={30}
        showMarketIcon
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8), minWidth: 0 }}>
        <span
          style={{
            fontSize: fs(20),
            fontWeight: 800,
            fontFamily: T.display,
            color: T.text,
            letterSpacing: 0,
          }}
        >
          {ticker}
        </span>
        <span
          style={{
            fontSize: fs(11),
            color: T.textDim,
            fontFamily: T.sans,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {info?.name || ticker}
        </span>
        <MarketIdentityChips
          item={{ ticker, name: info?.name || ticker }}
          compact
          maxChips={2}
          showExchange={false}
          showSector
        />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
        <span
          style={{
            fontSize: fs(22),
            fontWeight: 700,
            fontFamily: T.mono,
            color: T.text,
          }}
        >
          {formatQuotePrice(info?.price)}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 600,
            fontFamily: T.mono,
            color: pos == null ? T.textDim : pos ? T.green : T.red,
          }}
        >
          {isFiniteNumber(info?.chg)
            ? `${info.chg >= 0 ? "▲ +" : "▼ "}${Math.abs(info.chg).toFixed(2)}`
            : MISSING_VALUE}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 600,
            fontFamily: T.mono,
            color: pos == null ? T.textDim : pos ? T.green : T.red,
          }}
        >
          {isFiniteNumber(info?.pct)
            ? `(${formatSignedPercent(info.pct)})`
            : MISSING_VALUE}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          gap: sp(14),
          fontSize: fs(10),
          fontFamily: T.mono,
        }}
      >
        <div>
          <span style={{ color: T.textMuted }}>VOL </span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            {fmtQuoteVolume(info?.volume)}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>IV </span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            {isFiniteNumber(info?.iv)
              ? `${(info.iv * 100).toFixed(1)}%`
              : MISSING_VALUE}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>IMP </span>
          <span
            style={{
              color: impMove != null ? T.cyan : T.textDim,
              fontWeight: 700,
            }}
          >
            {impMove != null ? `±$${impMove.toFixed(2)}` : MISSING_VALUE}
          </span>{" "}
          <span style={{ color: T.textDim }}>
            {impPct != null ? `(${impPct.toFixed(2)}%)` : ""}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>ATM </span>
          <span style={{ color: T.accent, fontWeight: 600 }}>
            {atmRow?.k ?? getAtmStrikeFromPrice(info?.price) ?? MISSING_VALUE}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>CHAIN </span>
          <span
            style={{
              color: resolvedChainStatus === "live" ? T.accent : T.textDim,
              fontWeight: 600,
            }}
          >
            {resolvedChainStatus}
          </span>
        </div>
      </div>
    </div>
  );
};

// ─── FOCUSED EQUITY CHART PANEL ───
// Big equity chart with full controls: timeframes, drawing tools, candles, crosshair, flow markers.
// Always large (no expand toggle needed in single-ticker mode).
const EQUITY_CHART_STUDIES = [
  { id: "ema-21", label: "EMA21" },
  { id: "ema-55", label: "EMA55" },
  { id: "vwap", label: "VWAP" },
  { id: "sma-20", label: "SMA20" },
  { id: "bb-20", label: "BB20" },
  { id: "rsi-14", label: "RSI" },
  { id: "macd-12-26-9", label: "MACD" },
  { id: "atr-14", label: "ATR" },
];

export const TradeEquityPanel = ({
  ticker,
  flowEvents,
  historicalDataEnabled = true,
  stockAggregateStreamingEnabled = false,
  onOpenSearch,
  searchOpen,
  onSearchOpenChange,
  searchContent,
  workspaceChart = null,
  onWorkspaceChartChange,
  referenceLines = [],
}) => {
  const queryClient = useQueryClient();
  const tradeFlowSnapshot = useTradeFlowSnapshot(ticker);
  const effectiveFlowEvents = flowEvents?.length ? flowEvents : tradeFlowSnapshot.events;
  const tickerFallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const tickerInfo = useRuntimeTickerSnapshot(ticker, tickerFallback);
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const [tf, setTf] = useState(workspaceChart?.timeframe || "5m");
  const {
    favoriteTimeframes: primaryFavoriteTimeframes,
    toggleFavoriteTimeframe: togglePrimaryFavoriteTimeframe,
  } = useChartTimeframeFavorites("primary");
  const [drawMode, setDrawMode] = useState(null);
  const [selectedIndicators, setSelectedIndicators] = useState(() =>
    resolvePersistedIndicatorPreset({
      indicators: _initialState.tradeEquitySelectedIndicators,
      defaults: DEFAULT_TRADE_EQUITY_STUDIES,
      persistedVersion: _initialState.tradeEquityIndicatorPresetVersion,
      currentVersion: TRADE_EQUITY_INDICATOR_PRESET_VERSION,
    }),
  );
  const [rayReplicaSettings, setRayReplicaSettings] = useState(() =>
    resolvePersistedRayReplicaSettings(_initialState.tradeEquityRayReplicaSettings),
  );
  useEffect(() => {
    if (workspaceChart?.timeframe && workspaceChart.timeframe !== tf) {
      setTf(workspaceChart.timeframe);
    }
  }, [ticker, workspaceChart?.timeframe]);
  const spotChartFrameLayout = resolveSpotChartFrameLayout(false);
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const prewarmedFavoriteTimeframesRef = useRef(null);
  const { drawings, addDrawing, clearDrawings, undo, redo, canUndo, canRedo } =
    useDrawingHistory();
  const rollupBaseTimeframe = useMemo(
    () =>
      resolveLocalRollupBaseTimeframe(
        tf,
        getChartBarLimit(tf, "primary"),
        "primary",
      ),
    [tf],
  );
  const baseBarsScopeKey = buildChartBarScopeKey(
    "trade-equity-base-bars",
    ticker,
    rollupBaseTimeframe,
  );
  const chartHydrationScopeKey = buildChartBarScopeKey(
    "trade-equity-chart",
    ticker,
    tf,
  );
  const progressiveBars = useProgressiveChartBarLimit({
    scopeKey: buildChartBarScopeKey("trade-equity-bars", ticker),
    timeframe: tf,
    role: "primary",
    enabled: Boolean(historicalDataEnabled && ticker),
    warmTargetLimit: useCallback(
      (limit) =>
        queryClient.prefetchQuery({
          queryKey: [
            "trade-equity-bars",
            ticker,
            rollupBaseTimeframe,
            expandLocalRollupLimit(limit, tf, rollupBaseTimeframe),
          ],
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "barsRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: expandLocalRollupLimit(limit, tf, rollupBaseTimeframe),
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
              ),
            }),
          ...BARS_QUERY_DEFAULTS,
        }),
      [chartHydrationScopeKey, queryClient, rollupBaseTimeframe, tf, ticker],
    ),
  });
  const baseRequestedLimit = useMemo(
    () =>
      expandLocalRollupLimit(
        progressiveBars.requestedLimit,
        tf,
        rollupBaseTimeframe,
      ),
    [progressiveBars.requestedLimit, rollupBaseTimeframe, tf],
  );
  const barsQuery = useQuery({
    queryKey: [
      "trade-equity-bars",
      ticker,
      rollupBaseTimeframe,
      baseRequestedLimit,
    ],
    queryFn: () =>
      measureChartBarsRequest({
        scopeKey: chartHydrationScopeKey,
        metric: "barsRequestMs",
        request: () =>
          getBarsRequest({
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: baseRequestedLimit,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
        ),
      }),
    enabled: Boolean(historicalDataEnabled && ticker),
    ...BARS_QUERY_DEFAULTS,
  });
  useEffect(() => {
    if (!barsQuery.data?.bars?.length) {
      return;
    }

    progressiveBars.hydrateFullWindow();
  }, [barsQuery.data?.bars?.length, progressiveBars.hydrateFullWindow]);
  const prewarmFavoriteTimeframe = useCallback(
    (nextTimeframe) => {
      const favoriteTimeframe = normalizeChartTimeframe(nextTimeframe);
      if (!ticker || favoriteTimeframe === tf) {
        return;
      }

      const favoriteBaseTimeframe = resolveLocalRollupBaseTimeframe(
        favoriteTimeframe,
        getChartBarLimit(favoriteTimeframe, "primary"),
        "primary",
      );
      const favoriteLimit = expandLocalRollupLimit(
        getInitialChartBarLimit(favoriteTimeframe, "primary"),
        favoriteTimeframe,
        favoriteBaseTimeframe,
      );

      queryClient.prefetchQuery({
        queryKey: [
          "trade-equity-bars",
          ticker,
          favoriteBaseTimeframe,
          favoriteLimit,
        ],
        queryFn: () =>
          measureChartBarsRequest({
            scopeKey: buildChartBarScopeKey(
              "trade-equity-chart",
              ticker,
              favoriteTimeframe,
            ),
            metric: "favoritePrewarmRequestMs",
            request: () =>
              getBarsRequest(
                {
                  symbol: ticker,
                  timeframe: favoriteBaseTimeframe,
                  limit: favoriteLimit,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.favoritePrewarm),
              ),
          }),
        ...BARS_QUERY_DEFAULTS,
      });
    },
    [queryClient, tf, ticker],
  );
  useEffect(() => {
    if (
      !historicalDataEnabled ||
      !barsQuery.data?.bars?.length ||
      !primaryFavoriteTimeframes.length
    ) {
      return;
    }

    const prewarmKey = [
      chartHydrationScopeKey,
      primaryFavoriteTimeframes.join(","),
    ].join("::");
    if (prewarmedFavoriteTimeframesRef.current === prewarmKey) {
      return;
    }

    prewarmedFavoriteTimeframesRef.current = prewarmKey;
    primaryFavoriteTimeframes.forEach(prewarmFavoriteTimeframe);
  }, [
    barsQuery.data?.bars?.length,
    chartHydrationScopeKey,
    historicalDataEnabled,
    prewarmFavoriteTimeframe,
    primaryFavoriteTimeframes,
  ]);
  const prependableBars = usePrependableHistoricalBars({
    scopeKey: baseBarsScopeKey,
    timeframe: rollupBaseTimeframe,
    bars: barsQuery.data?.bars,
    enabled: Boolean(historicalDataEnabled && ticker),
    fetchOlderBars: useCallback(
      async ({ from, to, limit, historyCursor, preferCursor }) => {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const baseLimit = expandLocalRollupLimit(limit, tf, rollupBaseTimeframe);
        const payload = await queryClient.fetchQuery({
          queryKey: buildBarsPageQueryKey({
            queryBase: ["trade-equity-bars-prepend", ticker],
            timeframe: rollupBaseTimeframe,
            limit: baseLimit,
            from: fromIso,
            to: toIso,
            historyCursor: historyCursor || null,
            preferCursor: Boolean(historyCursor && preferCursor),
          }),
          queryFn: () =>
            measureChartBarsRequest({
              scopeKey: chartHydrationScopeKey,
              metric: "prependRequestMs",
              request: () =>
                getBarsRequest({
                  symbol: ticker,
                  timeframe: rollupBaseTimeframe,
                  limit: baseLimit,
                  from: fromIso,
                  to: toIso,
                  outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
                  source: "trades",
                  allowHistoricalSynthesis: true,
                  historyCursor: historyCursor || undefined,
                  preferCursor: historyCursor && preferCursor ? true : undefined,
                },
                buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
              ),
            }),
            ...BARS_QUERY_DEFAULTS,
          });

        return normalizeChartBarsPagePayload(payload, {
          context: "trade-equity-prepend",
          scopeKey: chartHydrationScopeKey,
        });
      },
      [chartHydrationScopeKey, queryClient, rollupBaseTimeframe, tf, ticker],
    ),
  });
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: prependableBars.bars,
    enabled: Boolean(stockAggregateStreamingEnabled && ticker),
  });
  const liveBars = useMemo(
    () => buildTradeBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const hydratedBaseBars = useMemo(
    () =>
      rollupMarketBars(
        buildTradeBarsFromApi(prependableBars.bars),
        rollupBaseTimeframe,
        tf,
      ),
    [prependableBars.bars, rollupBaseTimeframe, tf],
  );
  const fetchLatestLiveBars = useCallback(async () => {
    const fallbackLimit = Math.max(2, Math.min(baseRequestedLimit, 500));
    const payload = await measureChartBarsRequest({
      scopeKey: chartHydrationScopeKey,
      metric: "liveFallbackRequestMs",
      request: () =>
        getBarsRequest(
          {
            symbol: ticker,
            timeframe: rollupBaseTimeframe,
            limit: fallbackLimit,
            outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
            source: "trades",
            allowHistoricalSynthesis: true,
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.active),
        ),
    });

    return normalizeLatestChartBarsPayload(payload, {
      context: "trade-equity-live-fallback",
      scopeKey: chartHydrationScopeKey,
    });
  }, [baseRequestedLimit, chartHydrationScopeKey, rollupBaseTimeframe, ticker]);
  const streamedLiveBars = useHistoricalBarStream({
    symbol: ticker,
    timeframe: rollupBaseTimeframe,
    bars: liveBars,
    enabled: Boolean(
      stockAggregateStreamingEnabled && ticker && rollupBaseTimeframe !== "1d"
    ),
    outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
    source: "trades",
    instrumentationScope: chartHydrationScopeKey,
    fetchLatestBars: fetchLatestLiveBars,
    streamPriority: 90,
  });
  const bars = useMemo(
    () => rollupMarketBars(streamedLiveBars, rollupBaseTimeframe, tf),
    [rollupBaseTimeframe, streamedLiveBars, tf],
  );
  const displayPriceFallbackQuery = useDisplayChartPriceFallbackBars({
    symbol: ticker,
    enabled: Boolean(
      historicalDataEnabled && ticker && !Number.isFinite(tickerInfo?.price),
    ),
    scopeKey: chartHydrationScopeKey,
    priority: BARS_REQUEST_PRIORITY.active,
  });
  useEffect(() => {
    recordChartBarScopeState(chartHydrationScopeKey, {
      timeframe: tf,
      role: "primary",
      requestedLimit: progressiveBars.requestedLimit,
      initialLimit: getInitialChartBarLimit(tf, "primary"),
      targetLimit: progressiveBars.targetLimit,
      maxLimit: progressiveBars.maxLimit,
      hydratedBaseCount: hydratedBaseBars.length,
      renderedBarCount: bars.length,
      livePatchedBarCount: Math.max(0, bars.length - hydratedBaseBars.length),
      oldestLoadedAt: prependableBars.oldestLoadedAtMs
        ? new Date(prependableBars.oldestLoadedAtMs).toISOString()
        : null,
      isPrependingOlder: prependableBars.isPrependingOlder,
      hasExhaustedOlderHistory: prependableBars.hasExhaustedOlderHistory,
      olderHistoryNextBeforeAt: prependableBars.olderHistoryNextBeforeMs
        ? new Date(prependableBars.olderHistoryNextBeforeMs).toISOString()
        : null,
      emptyOlderHistoryWindowCount:
        prependableBars.emptyOlderHistoryWindowCount,
      olderHistoryPageCount: prependableBars.olderHistoryPageCount,
      olderHistoryProvider: prependableBars.olderHistoryProvider,
      olderHistoryExhaustionReason:
        prependableBars.olderHistoryExhaustionReason,
      olderHistoryProviderCursor: prependableBars.olderHistoryProviderCursor,
      olderHistoryProviderNextUrl: prependableBars.olderHistoryProviderNextUrl,
      olderHistoryProviderPageCount:
        prependableBars.olderHistoryProviderPageCount,
      olderHistoryProviderPageLimitReached:
        prependableBars.olderHistoryProviderPageLimitReached,
      olderHistoryCursor: prependableBars.olderHistoryCursor,
    });
  }, [
    bars.length,
    chartHydrationScopeKey,
    hydratedBaseBars.length,
    prependableBars.hasExhaustedOlderHistory,
    prependableBars.emptyOlderHistoryWindowCount,
    prependableBars.olderHistoryExhaustionReason,
    prependableBars.olderHistoryNextBeforeMs,
    prependableBars.olderHistoryPageCount,
    prependableBars.olderHistoryProvider,
    prependableBars.olderHistoryProviderCursor,
    prependableBars.olderHistoryProviderNextUrl,
    prependableBars.olderHistoryProviderPageCount,
    prependableBars.olderHistoryProviderPageLimitReached,
    prependableBars.olderHistoryCursor,
    prependableBars.isPrependingOlder,
    prependableBars.loadedBarCount,
    prependableBars.oldestLoadedAtMs,
    progressiveBars.maxLimit,
    progressiveBars.requestedLimit,
    progressiveBars.targetLimit,
    tf,
  ]);
  const barsStatus = bars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : "empty";
  const markers = useMemo(
    () =>
      effectiveFlowEvents.length
        ? buildTradeFlowMarkersFromEvents(effectiveFlowEvents, bars.length)
        : [],
    [bars.length, effectiveFlowEvents],
  );
  const chartMarkers = useMemo(
    () =>
      markers.flatMap((marker, index) => {
        const targetBar = bars[marker?.barIdx];
        const rawTime = targetBar?.time;
        const time =
          typeof rawTime === "number"
            ? rawTime > 1e12
              ? Math.floor(rawTime / 1000)
              : Math.floor(rawTime)
            : null;
        if (!time) return [];

        const isCall = marker.cp === "C";
        return [
          {
            id: `trade-flow-${ticker}-${index}-${time}`,
            time,
            barIndex: marker.barIdx,
            position: isCall ? "belowBar" : "aboveBar",
            shape: isCall ? "arrowUp" : "arrowDown",
            color: marker.golden ? T.amber : isCall ? T.green : T.red,
            size: marker.golden
              ? 1.6
              : marker.size === "lg"
                ? 1.25
                : marker.size === "md"
                  ? 1
                  : 0.8,
            text: marker.golden ? "G" : "",
          },
        ];
      }),
    [bars, markers, ticker],
  );
  const chartEvents = useMemo(
    () => flowEventsToChartEvents(effectiveFlowEvents || [], ticker),
    [effectiveFlowEvents, ticker],
  );
  const chartModel = useMeasuredChartModel({
    scopeKey: chartHydrationScopeKey,
    bars,
    buildInput: {
      bars,
      timeframe: tf,
      defaultVisibleBarCount: progressiveBars.targetLimit,
      selectedIndicators,
      indicatorSettings,
      indicatorRegistry,
      indicatorMarkers: chartMarkers,
    },
    deps: [
      bars,
      chartHydrationScopeKey,
      chartMarkers,
      indicatorRegistry,
      indicatorSettings,
      progressiveBars.targetLimit,
      selectedIndicators,
      tf,
    ],
  });
  const latestBar = bars[bars.length - 1];
  const previousClose =
    Number.isFinite(tickerInfo?.prevClose)
      ? tickerInfo.prevClose
      : bars.length > 1
        ? (bars[bars.length - 2]?.c ?? null)
        : null;
  const displayPrice = resolveDisplayChartPrice({
    quotePrice: tickerInfo?.price,
    canonicalBars: displayPriceFallbackQuery.data?.bars,
    renderedBars: bars,
  });
  const displayChange =
    Number.isFinite(displayPrice) && Number.isFinite(previousClose)
      ? displayPrice - previousClose
      : null;
  const displayPct =
    Number.isFinite(displayChange) &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
      ? (displayChange / previousClose) * 100
      : null;
  const callFlows = markers.filter((m) => m.cp === "C").length;
  const putFlows = markers.filter((m) => m.cp === "P").length;
  const toggleIndicator = (indicatorId) => {
    setSelectedIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };
  const handleChangeTimeframe = useCallback((timeframe) => {
    setTf(timeframe);
    onWorkspaceChartChange?.({ timeframe });
  }, [onWorkspaceChartChange]);

  useEffect(() => {
    persistState({
      tradeEquitySelectedIndicators: selectedIndicators,
      tradeEquityIndicatorPresetVersion: TRADE_EQUITY_INDICATOR_PRESET_VERSION,
    });
  }, [selectedIndicators]);

  useEffect(() => {
    persistState({ tradeEquityRayReplicaSettings: rayReplicaSettings });
  }, [rayReplicaSettings]);

  const expandVisibleLogicalRange = useCallback(
    (range) => {
      progressiveBars.expandForVisibleRange(range, prependableBars.loadedBarCount, {
        oldestLoadedAtMs: prependableBars.oldestLoadedAtMs,
        prependOlderBars: prependableBars.prependOlderBars,
      });
    },
    [
      prependableBars.loadedBarCount,
      prependableBars.oldestLoadedAtMs,
      prependableBars.prependOlderBars,
      progressiveBars.expandForVisibleRange,
    ],
  );
  const scheduleVisibleRangeExpansion = useDebouncedVisibleRangeExpansion(
    expandVisibleLogicalRange,
    { resetKey: chartHydrationScopeKey },
  );
  const handleVisibleLogicalRangeChange = useCallback(
    (range) => {
      scheduleVisibleRangeExpansion(range);
    },
    [scheduleVisibleRangeExpansion],
  );

  return (
    <ResearchChartFrame
      key={chartHydrationScopeKey}
      dataTestId="trade-equity-chart"
      theme={T}
      themeKey={getCurrentTheme()}
      surfaceUiStateKey="trade-equity-chart"
      rangeIdentityKey={chartHydrationScopeKey}
      model={chartModel}
      chartEvents={chartEvents}
      showSurfaceToolbar={false}
      showLegend
      legend={{
        symbol: ticker,
        name: "Equity chart",
        timeframe: tf,
        statusLabel: describeBrokerChartStatus(barsStatus, tf),
        priceLabel: "Spot",
        price: displayPrice,
        changePercent: displayPct,
        meta: {
          open: latestBar?.o,
          high: latestBar?.h,
          low: latestBar?.l,
          close: latestBar?.c,
          volume: latestBar?.v,
          vwap: latestBar?.vwap,
          sessionVwap: latestBar?.sessionVwap,
          accumulatedVolume: latestBar?.accumulatedVolume,
          averageTradeSize: latestBar?.averageTradeSize,
          timestamp: latestBar?.ts,
          sourceLabel: describeBrokerChartSource(latestBar?.source),
        },
        studies: availableStudies,
        selectedStudies: selectedIndicators,
      }}
      referenceLines={referenceLines}
      drawings={drawings}
      drawMode={drawMode}
      onAddDrawing={addDrawing}
      onVisibleLogicalRangeChange={handleVisibleLogicalRangeChange}
      surfaceTopOverlay={(controls) => (
        <ResearchChartWidgetHeader
          theme={T}
          controls={controls}
          symbol={ticker}
          name="Equity chart"
          price={displayPrice}
          changePercent={displayPct}
          statusLabel={describeBrokerChartStatus(barsStatus, tf)}
          timeframe={tf}
          showInlineLegend={false}
          timeframeOptions={TRADE_TIMEFRAMES.map((timeframe) => ({
            value: timeframe.v,
            label: timeframe.tag,
          }))}
          onChangeTimeframe={handleChangeTimeframe}
          favoriteTimeframes={primaryFavoriteTimeframes}
          onToggleFavoriteTimeframe={togglePrimaryFavoriteTimeframe}
          onPrewarmTimeframe={prewarmFavoriteTimeframe}
          onOpenSearch={onOpenSearch}
          searchOpen={searchOpen}
          onSearchOpenChange={onSearchOpenChange}
          searchContent={searchContent}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          showUndoRedo
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          rightSlot={
            <RayReplicaSettingsMenu
              theme={T}
              settings={rayReplicaSettings}
              onChange={setRayReplicaSettings}
              disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
            />
          }
          meta={{
            open: latestBar?.o,
            high: latestBar?.h,
            low: latestBar?.l,
            close: latestBar?.c,
            volume: latestBar?.v,
            vwap: latestBar?.vwap,
            sessionVwap: latestBar?.sessionVwap,
            accumulatedVolume: latestBar?.accumulatedVolume,
            averageTradeSize: latestBar?.averageTradeSize,
            timestamp: latestBar?.ts,
            sourceLabel: describeBrokerChartSource(latestBar?.source),
          }}
        />
      )}
      surfaceTopOverlayHeight={spotChartFrameLayout.surfaceTopOverlayHeight}
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
      surfaceLeftOverlayWidth={spotChartFrameLayout.surfaceLeftOverlayWidth}
      surfaceBottomOverlay={(controls) => (
        <ResearchChartWidgetFooter
          theme={T}
          controls={controls}
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          statusText={`${describeBrokerChartStatus(barsStatus, tf)}  C ${callFlows}  P ${putFlows}  UOA amber`}
        />
      )}
      surfaceBottomOverlayHeight={spotChartFrameLayout.surfaceBottomOverlayHeight}
    />
  );
};


// TradeScreen extracted to ./screens/TradeScreen.jsx


// ResearchScreen extracted to ./screens/ResearchScreen.jsx

// ═══════════════════════════════════════════════════════════════════
// SCREEN: ALGO (EDGE Algorithm Config)
// ═══════════════════════════════════════════════════════════════════

// AlgoScreen extracted to ./screens/AlgoScreen.jsx

// ═══════════════════════════════════════════════════════════════════
// SCREEN: BACKTEST
// ═══════════════════════════════════════════════════════════════════

// BacktestScreen extracted to ./screens/BacktestScreen.jsx

// ═══════════════════════════════════════════════════════════════════
// LIVE BROKER CONFIRMATION
// ═══════════════════════════════════════════════════════════════════

const formatLiveBrokerActionError = (error) => {
  const message =
    error?.message ||
    "The broker action failed before the platform received a final response.";
  if (/timeout|timed out|504|gateway timeout/i.test(message)) {
    return `${message} If this reached IBKR, the outcome may be unknown. Check open orders and executions before retrying.`;
  }
  return message;
};

const BrokerActionConfirmDialog = ({
  open,
  title,
  detail,
  lines = [],
  confirmLabel = "CONFIRM LIVE ACTION",
  confirmTone = T.red,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(16),
        background: "rgba(4, 10, 18, 0.72)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        data-testid="broker-action-confirm-dialog"
        style={{
          width: "min(100%, 520px)",
          background: T.bg1,
          border: `1px solid ${confirmTone}55`,
          borderRadius: dim(8),
          boxShadow: "0 24px 72px rgba(0,0,0,0.45)",
          padding: sp("14px 16px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 800,
              color: confirmTone,
              fontFamily: T.display,
              letterSpacing: "0.08em",
            }}
          >
            LIVE IBKR CONFIRMATION
          </span>
          <span
            style={{
              fontSize: fs(14),
              fontWeight: 800,
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: fs(9),
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.45,
            }}
          >
            {detail}
          </span>
        </div>
        {lines.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: sp(6),
              padding: sp("8px 10px"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              fontFamily: T.mono,
            }}
          >
            {lines.map((line) => (
              <Fragment key={line.label}>
                <span
                  style={{
                    fontSize: fs(8),
                    color: T.textMuted,
                    letterSpacing: "0.06em",
                  }}
                >
                  {line.label}
                </span>
                <span
                  style={{
                    fontSize: fs(8),
                    color: line.valueColor || T.text,
                    fontWeight: 700,
                    textAlign: "right",
                  }}
                >
                  {line.value}
                </span>
              </Fragment>
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(10),
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.sans,
            lineHeight: 1.4,
          }}
        >
          <span>
            This sends a live broker instruction. Review the account,
            instrument, side, size, and price before continuing.
          </span>
        </div>
        {error ? (
          <div
            data-testid="broker-action-confirm-error"
            role="alert"
            style={{
              background: `${T.red}12`,
              border: `1px solid ${T.red}45`,
              borderRadius: dim(5),
              color: T.red,
              fontSize: fs(9),
              fontFamily: T.sans,
              lineHeight: 1.4,
              padding: sp("8px 10px"),
            }}
          >
            {error}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
          <button
            onClick={onCancel}
            disabled={pending}
            style={{
              padding: sp("8px 0"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              color: T.textSec,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 700,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.65 : 1,
            }}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            style={{
              padding: sp("8px 0"),
              background: confirmTone,
              border: "none",
              borderRadius: dim(5),
              color: "#fff",
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 800,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.75 : 1,
            }}
          >
            {pending ? "SUBMITTING..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// TOAST STACK — bottom-right stacked notifications
// ═══════════════════════════════════════════════════════════════════

const ToastStack = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: dim(20),
        right: dim(20),
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const kindColor =
          t.kind === "success"
            ? T.green
            : t.kind === "error"
              ? T.red
              : t.kind === "warn"
                ? T.amber
                : T.accent;
        const kindIcon =
          t.kind === "success"
            ? "✓"
            : t.kind === "error"
              ? "✕"
              : t.kind === "warn"
                ? "⚠"
                : "ⓘ";
        return (
          <div
            key={t.id}
            onClick={() => onDismiss && onDismiss(t.id)}
            title="Click to dismiss"
            style={{
              background: T.bg2,
              border: `1px solid ${kindColor}`,
              borderLeft: `3px solid ${kindColor}`,
              borderRadius: dim(4),
              padding: sp("8px 12px"),
              minWidth: dim(260),
              maxWidth: dim(340),
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              animation: t.leaving
                ? "toastSlideOut 0.2s ease-in forwards"
                : "toastSlideIn 0.22s ease-out",
              pointerEvents: "auto",
              cursor: "pointer",
              transition: "transform 0.1s, background 0.1s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = T.bg3;
              e.currentTarget.style.transform = "translateX(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = T.bg2;
              e.currentTarget.style.transform = "translateX(0)";
            }}
          >
            <div
              style={{ display: "flex", alignItems: "flex-start", gap: sp(8) }}
            >
              <span
                style={{
                  fontSize: fs(14),
                  color: kindColor,
                  fontWeight: 700,
                  lineHeight: 1,
                  marginTop: 1,
                }}
              >
                {kindIcon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: fs(11),
                    fontWeight: 700,
                    color: T.text,
                    marginBottom: t.body ? sp(2) : 0,
                  }}
                >
                  {t.title}
                </div>
                {t.body && (
                  <div
                    style={{
                      fontSize: fs(10),
                      color: T.textSec,
                      fontFamily: T.mono,
                      lineHeight: 1.4,
                    }}
                  >
                    {t.body}
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: fs(11),
                  color: T.textMuted,
                  fontWeight: 600,
                  opacity: 0.6,
                  marginLeft: sp(4),
                  marginTop: 1,
                }}
              >
                ✕
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════

// ─── LIVE-DATA SUBSCRIPTION ISOLATION ───
// Live quote ticks, sparkline refreshes, and per-minute aggregate store updates
// used to be subscribed to from the top-level RayAlgoPlatform component, which
// forced broad shell re-renders on every change.
//
// MarketDataSubscriptionProvider now owns those subscriptions and writes into
// the runtime ticker snapshot store. Header/watchlist containers subscribe to
// only the symbols they render, so a quote tick re-renders just the affected
// panels instead of the whole terminal shell.

const MarketDataSubscriptionProvider = ({
  watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  sparklineSymbols,
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  marketStockAggregateStreamingEnabled,
  marketScreenActive = false,
  lowPriorityHistoryEnabled = true,
  children,
}) => {
  const pageVisible = usePageVisible();
  const marketAggregateStoreVersion = useStockMinuteAggregateSymbolsVersion(
    streamedAggregateSymbols,
  );
  const watchlistSymbolsKey = useMemo(
    () => (watchlistSymbols || []).join(","),
    [watchlistSymbols],
  );
  const activeWatchlistItemsKey = useMemo(
    () =>
      (activeWatchlistItems || [])
        .map((item) =>
          [
            item?.id,
            item?.symbol,
            item?.name,
            item?.assetClass,
            item?.provider,
            item?.providerContractId,
          ]
            .filter(Boolean)
            .join(":"),
        )
        .join("|"),
    [activeWatchlistItems],
  );
  const sparklineHistoryEnabled = Boolean(
    lowPriorityHistoryEnabled && marketScreenActive && sparklineSymbols.length > 0,
  );
  useRuntimeWorkloadFlag(
    "market:subscription-streams",
    Boolean(
      pageVisible &&
        marketStockAggregateStreamingEnabled &&
        streamedQuoteSymbols.length > 0,
    ),
    {
      kind: "stream",
      label: "Market runtime streams",
      detail: `${streamedQuoteSymbols.length}q/${streamedAggregateSymbols.length}a`,
      priority: 3,
    },
  );
  useRuntimeWorkloadFlag("market:sparklines", sparklineHistoryEnabled, {
    kind: "poll",
    label: "Market sparklines",
    detail: `${sparklineSymbols.length}s`,
    priority: 6,
  });
  useRuntimeWorkloadFlag(
    "market:performance-baselines",
    Boolean(
      lowPriorityHistoryEnabled &&
        marketScreenActive &&
        MARKET_PERFORMANCE_SYMBOLS.length > 0,
    ),
    {
      kind: "poll",
      label: "Market performance baselines",
      detail: `${MARKET_PERFORMANCE_SYMBOLS.length}s`,
      priority: 7,
    },
  );
  const quotesQuery = useGetQuoteSnapshots(
    { symbols: quoteSymbols.join(",") },
    {
      query: {
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const sparklineQuery = useQuery({
    queryKey: ["market-sparklines", sparklineSymbols],
    enabled: sparklineHistoryEnabled,
    queryFn: async () => {
      const results = await settleWithConcurrency(
        sparklineSymbols,
        4,
        (symbol) =>
          getBarsRequest({
            symbol,
            timeframe: "15m",
            limit: 48,
            outsideRth: true,
            source: "trades",
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.background),
        ),
      );

      return Object.fromEntries(
        results.map((result, index) => [
          sparklineSymbols[index],
          result.status === "fulfilled" ? result.value.bars || [] : [],
        ]),
      );
    },
    ...BARS_QUERY_DEFAULTS,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const marketPerformanceQuery = useQuery({
    queryKey: ["market-performance-baselines", MARKET_PERFORMANCE_SYMBOLS],
    enabled:
      lowPriorityHistoryEnabled &&
      marketScreenActive &&
      MARKET_PERFORMANCE_SYMBOLS.length > 0,
    queryFn: async () => {
      const results = await settleWithConcurrency(
        MARKET_PERFORMANCE_SYMBOLS,
        4,
        (symbol) =>
          getBarsRequest({
            symbol,
            timeframe: "1d",
            limit: 6,
            outsideRth: false,
            source: "trades",
          },
          buildBarsRequestOptions(BARS_REQUEST_PRIORITY.background),
        ),
      );

      return Object.fromEntries(
        results.map((result, index) => {
          const bars =
            result.status === "fulfilled" ? result.value.bars || [] : [];
          const baselineBar = bars.length > 5 ? bars[bars.length - 6] : bars[0];
          return [
            MARKET_PERFORMANCE_SYMBOLS[index],
            baselineBar?.close ?? null,
          ];
        }),
      );
    },
    staleTime: 300_000,
    refetchInterval: false,
    refetchOnMount: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });

  useIbkrQuoteSnapshotStream({
    symbols: streamedQuoteSymbols,
    enabled: Boolean(
      marketStockAggregateStreamingEnabled && streamedQuoteSymbols.length > 0,
    ),
  });
  useBrokerStockAggregateStream({
    symbols: streamedAggregateSymbols,
    enabled: Boolean(
      marketStockAggregateStreamingEnabled && streamedAggregateSymbols.length > 0,
    ),
  });
  const marketDataSyncKey = [
    watchlistSymbolsKey,
    activeWatchlistItemsKey,
    quotesQuery.dataUpdatedAt || 0,
    sparklineQuery.dataUpdatedAt || 0,
    marketPerformanceQuery.dataUpdatedAt || 0,
    marketAggregateStoreVersion,
  ].join("::");
  useEffect(() => {
    syncRuntimeMarketData(
      watchlistSymbols,
      activeWatchlistItems,
      quotesQuery.data?.quotes,
      {
        sparklineBarsBySymbol: sparklineQuery.data,
        performanceBaselineBySymbol: marketPerformanceQuery.data,
      },
    );
  }, [marketDataSyncKey]);

  return children;
};

const HeaderKpiStripContainer = ({ onSelect }) => {
  return <HeaderKpiStrip onSelect={onSelect} />;
};
const MemoHeaderKpiStripContainer = memo(HeaderKpiStripContainer);

const WatchlistContainer = ({
  activeWatchlist,
  watchlistSymbols,
  signalStates = [],
  ...rest
}) => {
  const items = useMemo(() => {
    return buildWatchlistRows({
      activeWatchlist,
      fallbackSymbols: watchlistSymbols,
      signalStates,
    }).map((item, index) => {
      const fallback = buildFallbackWatchlistItem(
        item.sym,
        index,
        item.name || item.sym,
      );
      return {
        ...item,
        name: item.name || fallback.name || item.sym,
      };
    });
  }, [activeWatchlist, signalStates, watchlistSymbols]);
  return (
    <Watchlist
      activeWatchlistId={activeWatchlist?.id || null}
      items={items}
      signalStates={signalStates}
      {...rest}
    />
  );
};
const MemoWatchlistContainer = memo(WatchlistContainer);

const formatLatencyMetric = (value) => (
  Number.isFinite(value) ? `${Math.round(value)}ms` : "n/a"
);

const formatWorkloadCount = (value) => (Number.isFinite(value) ? value : 0);

const LatencyDebugStrip = ({ screen, mountedScreens }) => {
  const stats = useIbkrLatencyStats();
  const chartStats = useChartHydrationStats();
  const workloadStats = useRuntimeWorkloadStats();
  const cells = [
    ["Bridge->API", stats.bridgeToApiMs],
    ["API->React", stats.apiToReactMs],
    ["Total", stats.totalMs],
  ];
  const chartCells = [
    ["Bars", chartStats.barsRequestMs],
    ["Prepend", chartStats.prependRequestMs],
    ["Model", chartStats.modelBuildMs],
    ["Paint", chartStats.firstPaintMs],
    ["Patch", chartStats.livePatchToPaintMs],
  ];
  const stream = stats.stream;
  const mountedCount = SCREENS.filter(({ id }) => mountedScreens?.[id]).length;
  const activeWorkloadLabels = workloadStats.entries
    .slice(0, 6)
    .map((entry) =>
      entry.detail ? `${entry.label}(${entry.detail})` : entry.label,
    )
    .join(" · ");

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 10000,
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(148,163,184,0.35)",
        background: "rgba(2,6,23,0.88)",
        color: "#dbeafe",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
        pointerEvents: "none",
      }}
    >
      <strong style={{ color: "#93c5fd", fontWeight: 700 }}>Latency</strong>
      {cells.map(([label, metric]) => (
        <span key={label} style={{ whiteSpace: "nowrap" }}>
          {label} p50 {formatLatencyMetric(metric.p50)} p95{" "}
          {formatLatencyMetric(metric.p95)}
        </span>
      ))}
      {chartCells.map(([label, metric]) => (
        <span key={label} style={{ whiteSpace: "nowrap", color: "#bfdbfe" }}>
          {label} p50 {formatLatencyMetric(metric.p50)} p95{" "}
          {formatLatencyMetric(metric.p95)}
        </span>
      ))}
      <span style={{ color: "#cbd5f5", whiteSpace: "nowrap" }}>
        Stream c{stream.activeConsumerCount} s{stream.unionSymbolCount} r
        {stream.reconnectCount} g{stream.streamGapCount}
      </span>
      <span style={{ color: "#a7f3d0", whiteSpace: "nowrap" }}>
        Screens {mountedCount}/{SCREENS.length} vis {screen}
      </span>
      <span style={{ color: "#fde68a", whiteSpace: "nowrap" }}>
        Work p{formatWorkloadCount(workloadStats.kindCounts.poll)} s
        {formatWorkloadCount(workloadStats.kindCounts.stream)} m
        {formatWorkloadCount(workloadStats.kindCounts.media)}
      </span>
      {activeWorkloadLabels ? (
        <span style={{ color: "#fcd34d", whiteSpace: "nowrap" }}>
          {activeWorkloadLabels}
        </span>
      ) : null}
      <span style={{ color: "#94a3b8" }}>
        n={stats.sampleCount}/{chartStats.sampleCount}
      </span>
    </div>
  );
};

export default function RayAlgoPlatform() {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const userPreferences = useUserPreferences();
  const previousPageVisibleRef = useRef(pageVisible);
  const latencyDebugEnabled = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("latency") === "1",
    [],
  );
  const [screen, setScreen] = useState(() =>
    _initialState.screen === "unusual"
      ? "flow"
      : _initialState.screen || "market",
  );
  const [mountedScreens, setMountedScreens] = useState(() =>
    buildMountedScreenState(
      _initialState.screen === "unusual"
        ? "flow"
        : _initialState.screen || "market",
    ),
  );
  const [screenWarmupPhase, setScreenWarmupPhase] = useState("initial");
  const [sym, setSym] = useState(_initialState.sym || "SPY");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    _initialState.sidebarCollapsed || false,
  );
  const [theme, setTheme] = useState(_initialState.theme || "dark");
  const [, setUiPreferenceRevision] = useState(0);
  const appearancePreferences = userPreferences.preferences?.appearance || {};
  const preferredTheme = appearancePreferences.theme;
  const preferredScale = appearancePreferences.scale;
  const preferredDensity = appearancePreferences.density;
  const preferredReducedMotion = appearancePreferences.reducedMotion;
  const [activeWatchlistId, setActiveWatchlistId] = useState(
    _initialState.activeWatchlistId || null,
  );
  const [selectedAccountId, setSelectedAccountId] = useState(
    _initialState.selectedAccountId || null,
  );
  const screenWarmupStartedRef = useRef(false);
  // Pending sym hand-off to Trade tab — bumped each time a watchlist item is clicked
  // so TradeScreen can react even when the same sym is clicked twice
  const [tradeSymPing, setTradeSymPing] = useState({
    sym: _initialState.sym || "SPY",
    n: 0,
    contract: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    window.__RAYALGO_MEMORY_DIAGNOSTICS__ = () => {
      const queries = queryClient.getQueryCache().getAll();
      const heavyPrefixes = new Set(
        INACTIVE_HEAVY_QUERY_PREFIXES.map((queryKey) => queryKey[0]),
      );
      const queryFamilies = queries.reduce((acc, query) => {
        const family = Array.isArray(query.queryKey)
          ? String(query.queryKey[0])
          : String(query.queryKey);
        acc[family] = (acc[family] || 0) + 1;
        return acc;
      }, {});

      return {
        queryCount: queries.length,
        activeQueryCount: queries.filter(
          (query) => query.getObserversCount?.() > 0,
        ).length,
        heavyQueryCount: queries.filter((query) => {
          const family = Array.isArray(query.queryKey)
            ? query.queryKey[0]
            : query.queryKey;
          return heavyPrefixes.has(family);
        }).length,
        queryFamilies,
        optionQuoteCacheSize: getOptionQuoteSnapshotCacheSize(),
        aggregateStream: getBrokerStockAggregateDebugStats(),
        chartHydration: sanitizeChartHydrationStatsForDiagnostics(
          getChartHydrationStatsSnapshot(),
        ),
        workload: getRuntimeWorkloadStats(),
        activeChartBarStoreEntries: getActiveChartBarStoreEntryCount(),
        marketFlowStoreEntries: getMarketFlowStoreEntryCount(),
        tradeFlowStoreEntries: getTradeFlowStoreEntryCount(),
        tradeOptionChainStoreEntries: getTradeOptionChainStoreEntryCount(),
      };
    };

    return () => {
      if (window.__RAYALGO_MEMORY_DIAGNOSTICS__) {
        delete window.__RAYALGO_MEMORY_DIAGNOSTICS__;
      }
    };
  }, [queryClient]);

  const sessionQuery = useGetSession({
    query: {
      staleTime: 5_000,
      refetchInterval: 5_000,
      retry: false,
    },
  });
  const sessionMetadataSettled = Boolean(
    sessionQuery.data || sessionQuery.isFetched || sessionQuery.isError,
  );
  const watchlistsQuery = useListWatchlists({
    query: {
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: false,
    },
  });
  const watchlists = useMemo(
    () => watchlistsQuery.data?.watchlists || [],
    [watchlistsQuery.data],
  );
  const defaultWatchlist = useMemo(() => {
    if (!watchlistsQuery.data?.watchlists?.length) return null;
    return (
      watchlistsQuery.data.watchlists.find((w) => w.isDefault) ||
      watchlistsQuery.data.watchlists[0]
    );
  }, [watchlistsQuery.data]);
  const activeWatchlist = useMemo(() => {
    if (!watchlistsQuery.data?.watchlists?.length) {
      return defaultWatchlist;
    }

    if (activeWatchlistId) {
      return (
        watchlistsQuery.data.watchlists.find(
          (watchlist) => watchlist.id === activeWatchlistId,
        ) || null
      );
    }

    return defaultWatchlist || watchlistsQuery.data.watchlists[0] || null;
  }, [activeWatchlistId, defaultWatchlist, watchlistsQuery.data]);
  const watchlistSymbols = useMemo(() => {
    const fallback = watchlistsQuery.data?.watchlists?.length
      ? []
      : WATCHLIST.map((item) => item.sym);
    const unique = [
      ...new Set(
        buildWatchlistRows({
          activeWatchlist,
          fallbackSymbols: fallback,
          signalStates: [],
        })
          .map((item) => item.sym)
          .filter(Boolean),
      ),
    ];
    return unique.length ? unique : ["SPY"];
  }, [activeWatchlist, watchlistsQuery.data]);
  const marketScreenWarm = Boolean(mountedScreens.market);
  const marketScreenActive = screen === "market";
  const flowScreenActive = screen === "flow";
  const tradeWarmTicker = useMemo(
    () =>
      normalizeTickerSymbol(
        _initialState.tradeActiveTicker || sym || watchlistSymbols[0] || "SPY",
      ) || "SPY",
    [sym, watchlistSymbols],
  );
  const tradeBackgroundWarmupReady = sessionMetadataSettled;
  const preloadCalendarWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 14);
    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
    };
  }, []);
  const quoteSymbols = useMemo(() => {
    return [
      ...new Set(
        [
          ...watchlistSymbols,
          ...HEADER_KPI_SYMBOLS,
          ...(marketScreenActive ? MARKET_SNAPSHOT_SYMBOLS : []),
        ].filter(Boolean),
      ),
    ];
  }, [marketScreenActive, watchlistSymbols]);
  const sparklineSymbols = useMemo(() => {
    const indexSymbols = marketScreenActive ? INDICES.map((item) => item.sym) : [];
    return [
      ...new Set(
        [...watchlistSymbols, ...indexSymbols, ...HEADER_KPI_SYMBOLS].filter(
          Boolean,
        ),
      ),
    ];
  }, [marketScreenActive, watchlistSymbols]);
  const streamedQuoteSymbols = useMemo(
    () => [
      ...new Set(
        [...quoteSymbols, ...sparklineSymbols]
          .map(normalizeTickerSymbol)
          .filter(Boolean),
      ),
    ],
    [quoteSymbols, sparklineSymbols],
  );
  const streamedAggregateSymbols = useMemo(
    () => [
      ...new Set(
        [
          ...watchlistSymbols,
          ...HEADER_KPI_SYMBOLS,
          ...(marketScreenActive ? MARKET_SNAPSHOT_SYMBOLS : []),
        ]
          .map(normalizeTickerSymbol)
          .filter(Boolean),
      ),
    ],
    [marketScreenActive, watchlistSymbols],
  );
  const accountsQuery = useListAccounts(
    { mode: sessionQuery.data?.environment || "paper" },
    {
      query: {
        enabled: Boolean(
          sessionQuery.data?.ibkrBridge?.authenticated &&
            sessionQuery.data?.ibkrBridge?.healthFresh !== false,
        ),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const accounts = accountsQuery.data?.accounts || [];
  const marketStockAggregateStreamingEnabled = Boolean(
    sessionQuery.data?.configured?.ibkr &&
      sessionQuery.data?.ibkrBridge?.authenticated &&
      sessionQuery.data?.ibkrBridge?.healthFresh !== false &&
      marketScreenActive,
  );
  const accountRealtimeEnabled = Boolean(
    pageVisible &&
      sessionQuery.data?.ibkrBridge?.authenticated &&
      sessionQuery.data?.ibkrBridge?.healthFresh !== false,
  );
  useIbkrAccountSnapshotStream({
    accountId: null,
    mode: sessionQuery.data?.environment || "paper",
    enabled: accountRealtimeEnabled,
  });
  useIbkrOrderSnapshotStream({
    accountId: null,
    mode: sessionQuery.data?.environment || "paper",
    enabled: accountRealtimeEnabled,
  });
  useShadowAccountSnapshotStream({
    enabled: Boolean(pageVisible),
  });

  useEffect(() => {
    if (!accounts.length) {
      return;
    }

    if (
      selectedAccountId &&
      accounts.some((account) => account.id === selectedAccountId)
    ) {
      return;
    }

    const bridgeSelectedAccountId = sessionQuery.data?.ibkrBridge?.selectedAccountId;
    const nextAccountId =
      bridgeSelectedAccountId &&
      accounts.some((account) => account.id === bridgeSelectedAccountId)
        ? bridgeSelectedAccountId
        : accounts[0]?.id || null;

    if (nextAccountId && nextAccountId !== selectedAccountId) {
      setSelectedAccountId(nextAccountId);
    }
  }, [accounts, selectedAccountId, sessionQuery.data?.ibkrBridge?.selectedAccountId]);

  // ── TOAST SYSTEM ──
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const timeoutMapRef = useRef({}); // tracks outer auto-dismiss timeout per toast, so manual dismiss can cancel it
  const dismissToast = useCallback((id) => {
    const timers = timeoutMapRef.current[id];
    if (timers) {
      clearTimeout(timers.dismiss);
      clearTimeout(timers.remove);
      delete timeoutMapRef.current[id];
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220);
  }, []);
  const pushToast = useCallback(
    ({ title, body, kind = "info", duration = 3500 }) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev, { id, title, body, kind, leaving: false }]);
      const dismissTimer = setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
        );
        const removeTimer = setTimeout(
          () => setToasts((prev) => prev.filter((t) => t.id !== id)),
          220,
        );
        timeoutMapRef.current[id] = {
          ...(timeoutMapRef.current[id] || {}),
          remove: removeTimer,
        };
      }, duration);
      timeoutMapRef.current[id] = { dismiss: dismissTimer };
    },
    [],
  );
  const toastValue = useMemo(
    () => ({ push: pushToast, toasts }),
    [pushToast, toasts],
  );

  const upsertWatchlistInCache = useCallback(
    (watchlist) => {
      if (!watchlist?.id) {
        return;
      }

      queryClient.setQueryData(WATCHLISTS_QUERY_KEY, (current) => {
        const currentWatchlists = Array.isArray(current?.watchlists)
          ? current.watchlists
          : [];
        const nextWatchlists = [
          ...currentWatchlists.filter((item) => item.id !== watchlist.id),
          watchlist,
        ].sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });

        return {
          ...(current || {}),
          watchlists: nextWatchlists,
        };
      });
    },
    [queryClient],
  );
  const removeWatchlistFromCache = useCallback(
    (watchlistId) => {
      if (!watchlistId) {
        return;
      }

      queryClient.setQueryData(WATCHLISTS_QUERY_KEY, (current) => {
        const currentWatchlists = Array.isArray(current?.watchlists)
          ? current.watchlists
          : [];
        return {
          ...(current || {}),
          watchlists: currentWatchlists.filter(
            (watchlist) => watchlist.id !== watchlistId,
          ),
        };
      });
    },
    [queryClient],
  );
  const invalidateWatchlists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: WATCHLISTS_QUERY_KEY });
  }, [queryClient]);
  const createWatchlistMutation = useMutation({
    mutationFn: (name) =>
      platformJsonRequest("/api/watchlists", {
        method: "POST",
        body: { name },
      }),
    onSuccess: (watchlist) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      if (watchlist?.id) {
        setActiveWatchlistId(watchlist.id);
      }
      pushToast({ title: "Watchlist created", kind: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to create watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const updateWatchlistMutation = useMutation({
    mutationFn: ({ watchlistId, body }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (watchlist) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      pushToast({ title: "Watchlist updated", kind: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to update watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const deleteWatchlistMutation = useMutation({
    mutationFn: (watchlistId) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, watchlistId) => {
      removeWatchlistFromCache(watchlistId);
      setActiveWatchlistId((current) =>
        current === watchlistId ? null : current,
      );
      invalidateWatchlists();
      pushToast({ title: "Watchlist deleted", kind: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to delete watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const addWatchlistSymbolMutation = useMutation({
    mutationFn: ({ watchlistId, symbol, name, identity = {} }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}/items`, {
        method: "POST",
        body: { symbol, name, ...identity },
      }),
    onSuccess: (watchlist, variables) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      if (variables?.symbol) {
        const nextSym = variables.symbol.toUpperCase();
        setSym(nextSym);
        setTradeSymPing((prev) => ({
          sym: nextSym,
          n: prev.n + 1,
          contract: null,
        }));
      }
      pushToast({
        title: `Added ${variables?.symbol?.toUpperCase?.() || "symbol"}`,
        kind: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to add symbol",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const removeWatchlistSymbolMutation = useMutation({
    mutationFn: ({ watchlistId, itemId }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: (watchlist, variables) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      pushToast({
        title: `Removed ${variables?.symbol || "symbol"}`,
        kind: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to remove symbol",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const reorderWatchlistMutation = useMutation({
    mutationFn: ({ watchlistId, itemIds }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}/items/reorder`, {
        method: "PUT",
        body: { itemIds },
      }),
    onSuccess: (watchlist) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
    },
    onError: (error) => {
      pushToast({
        title: "Unable to reorder watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });

  // ── LOCAL POSITION CONTEXT ──
  // Session-only UI state. Live broker positions are queried separately.
  const [positions, setPositions] = useState([]);
  const addPosition = useCallback((pos) => {
    setPositions((prev) => [
      {
        ...pos,
        id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        openedAt: Date.now(),
      },
      ...prev,
    ]);
  }, []);
  const closePosition = useCallback((id) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const closeAllPositions = useCallback(() => {
    setPositions([]);
  }, []);
  const updateStops = useCallback((id, stops) => {
    setPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...stops } : p)),
    );
  }, []);
  const rollPosition = useCallback((id) => {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              rolledAt: Date.now(),
              exp: p.exp === "04/25" ? "05/16" : "06/20",
            }
          : p,
      ),
    );
  }, []);
  const positionsValue = useMemo(
    () => ({
      positions,
      addPosition,
      closePosition,
      closeAll: closeAllPositions,
      updateStops,
      rollPosition,
    }),
    [
      positions,
      addPosition,
      closePosition,
      closeAllPositions,
      updateStops,
      rollPosition,
    ],
  );

  useEffect(() => {
    if (!watchlistsQuery.data?.watchlists?.length) {
      return;
    }
    if (
      activeWatchlistId &&
      watchlistsQuery.data.watchlists.some(
        (watchlist) => watchlist.id === activeWatchlistId,
      )
    ) {
      return;
    }
    const nextWatchlistId =
      defaultWatchlist?.id || watchlistsQuery.data.watchlists[0]?.id || null;
    if (nextWatchlistId) {
      setActiveWatchlistId(nextWatchlistId);
    }
  }, [activeWatchlistId, defaultWatchlist, watchlistsQuery.data]);

  useEffect(() => {
    if (!activeWatchlistId) return;
    persistState({ activeWatchlistId });
  }, [activeWatchlistId]);
  useEffect(() => {
    persistState({ selectedAccountId });
  }, [selectedAccountId]);

  useEffect(() => {
    if (screen === "trade") return;
    if (sym || !watchlistSymbols.length) return;

    const nextSym = watchlistSymbols[0];
    setSym(nextSym);
    setTradeSymPing((prev) => ({ sym: nextSym, n: prev.n + 1 }));
  }, [screen, watchlistSymbols, sym]);

  const session = sessionQuery.data || null;
  const environment = sessionQuery.data?.environment || "paper";
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(
    session?.ibkrBridge?.authenticated &&
      session?.ibkrBridge?.healthFresh !== false,
  );
  const gatewayTradingReadiness = resolveGatewayTradingReadiness(session);
  const gatewayTradingReady = gatewayTradingReadiness.ready;
  const gatewayTradingMessage = gatewayTradingReadiness.message;
  const stockAggregateStreamingEnabled = Boolean(
    brokerConfigured && brokerAuthenticated,
  );
  const bridgeTone = bridgeRuntimeTone(session);
  const primaryAccount =
    accounts.find((account) => account.id === selectedAccountId) ||
    accounts[0] ||
    null;
  const primaryAccountId =
    primaryAccount?.id ||
    session?.ibkrBridge?.selectedAccountId ||
    selectedAccountId ||
    null;
  const researchConfigured = Boolean(session?.configured?.research);

  useEffect(() => {
    setBrokerStockAggregateStreamPaused(!pageVisible);
    return () => {
      setBrokerStockAggregateStreamPaused(false);
    };
  }, [pageVisible]);

  useEffect(() => {
    const wasPageVisible = previousPageVisibleRef.current;
    previousPageVisibleRef.current = pageVisible;
    if (wasPageVisible || !pageVisible) {
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["/api/bars"] });
    queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
    queryClient.invalidateQueries({ queryKey: ["/api/flow/events"] });
    queryClient.invalidateQueries({ queryKey: ["market-sparklines"] });
    queryClient.invalidateQueries({ queryKey: ["market-performance-baselines"] });
    queryClient.invalidateQueries({ queryKey: ["trade-market-depth"] });
    queryClient.invalidateQueries({
      queryKey: getGetSignalMonitorStateQueryKey({ environment }),
    });
    queryClient.invalidateQueries({
      queryKey: getListSignalMonitorEventsQueryKey({ environment, limit: 100 }),
    });

    const optionsRefreshTimer = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/expirations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/chains"] });
      queryClient.invalidateQueries({ queryKey: ["trade-option-chain"] });
    }, 2_500);

    return () => {
      window.clearTimeout(optionsRefreshTimer);
    };
  }, [environment, pageVisible, queryClient]);

  useEffect(() => {
    if (mountedScreens[screen]) {
      return;
    }
    setMountedScreens((current) =>
      current[screen] ? current : { ...current, [screen]: true },
    );
  }, [mountedScreens, screen]);

  useEffect(() => {
    INACTIVE_HEAVY_QUERY_PREFIXES.forEach((queryKey) => {
      queryClient.removeQueries({
        queryKey,
        exact: false,
        type: "inactive",
      });
    });
  }, [queryClient, screen]);

  useEffect(() => {
    if (!tradeBackgroundWarmupReady) {
      return;
    }

    if (screenWarmupStartedRef.current) {
      return;
    }
    screenWarmupStartedRef.current = true;

    let cancelled = false;
    const cleanups = [];
    const queueMount = (screenId) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setMountedScreens((current) =>
          current[screenId] ? current : { ...current, [screenId]: true },
        );
      });
    };

    const warmingTimers = OPERATIONAL_SCREEN_PRELOAD_ORDER.map((screenId, index) =>
      window.setTimeout(() => {
        if (screenId !== screen) {
          queueMount(screenId);
        }
      }, 140 * (index + 1)),
    );
    cleanups.push(() => warmingTimers.forEach((timerId) => window.clearTimeout(timerId)));

    // Mark the warmup as ready shortly after the last operational preload
    // fires — `lowPriorityHistoryEnabled` keys off this phase so historical
    // backfill can start. We no longer auto-mount Research / Backtest.
    const readyTimer = window.setTimeout(() => {
      if (!cancelled) {
        setScreenWarmupPhase("ready");
      }
    }, 140 * (OPERATIONAL_SCREEN_PRELOAD_ORDER.length + 1));
    cleanups.push(() => window.clearTimeout(readyTimer));

    setScreenWarmupPhase("warming");

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [screen, tradeBackgroundWarmupReady]);

  useEffect(() => {
    if (!sessionMetadataSettled) {
      return undefined;
    }

    let cancelled = false;
    const cancelIdle = scheduleIdleWork(() => {
      if (cancelled) {
        return;
      }

      queryClient.prefetchQuery(
        getGetNewsQueryOptions(
          { limit: 6 },
          {
            query: {
              staleTime: 60_000,
              retry: false,
            },
          },
        ),
      );

      if (researchConfigured && preloadCalendarWindow.from && preloadCalendarWindow.to) {
        queryClient.prefetchQuery(
          getGetResearchEarningsCalendarQueryOptions(
            preloadCalendarWindow,
            {
              query: {
                staleTime: 300_000,
                retry: false,
              },
            },
          ),
        );
      }

      queryClient.prefetchQuery(
        getGetQuoteSnapshotsQueryOptions(
          { symbols: tradeWarmTicker },
          {
            query: {
              staleTime: 60_000,
              retry: false,
            },
          },
        ),
      );
      queryClient.prefetchQuery(
        getListBacktestDraftStrategiesQueryOptions({
          query: {
            ...QUERY_DEFAULTS,
            retry: false,
            gcTime: 5 * 60_000,
          },
        }),
      );
      queryClient.prefetchQuery(
        getListAlgoDeploymentsQueryOptions(
          { mode: environment },
          {
            query: {
              ...QUERY_DEFAULTS,
              retry: false,
              gcTime: 5 * 60_000,
            },
          },
        ),
      );
      void import("./features/research/PhotonicsObservatory");
    }, 1_000);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [
    environment,
    preloadCalendarWindow,
    queryClient,
    researchConfigured,
    sessionMetadataSettled,
    tradeWarmTicker,
  ]);
  const positionAlertsQuery = useListPositions(
    { accountId: primaryAccountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && primaryAccountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const alertingPositions = useMemo(() => {
    if (!brokerConfigured || !brokerAuthenticated || !primaryAccountId) {
      return [];
    }

    return (positionAlertsQuery.data?.positions || []).flatMap((position) => {
      const pct = position.unrealizedPnlPercent;
      if (!isFiniteNumber(pct)) {
        return [];
      }
      if (pct >= 50) {
        return [{ id: position.id, pct, kind: "profit" }];
      }
      if (pct <= -25) {
        return [{ id: position.id, pct, kind: "loss" }];
      }
      return [];
    });
  }, [
    brokerAuthenticated,
    brokerConfigured,
    primaryAccountId,
    positionAlertsQuery.data,
  ]);
  const winAlerts = alertingPositions.filter((a) => a.kind === "profit").length;
  const lossAlerts = alertingPositions.filter((a) => a.kind === "loss").length;
  const totalAlerts = winAlerts + lossAlerts;
  const marketAlertItems = useMemo(() => {
    if (!brokerConfigured || !brokerAuthenticated || !primaryAccountId) {
      return [];
    }

    return (positionAlertsQuery.data?.positions || [])
      .flatMap((position) => {
        const pct = position.unrealizedPnlPercent;
        if (!isFiniteNumber(pct)) {
          return [];
        }

        if (pct >= 50) {
          return [
            {
              id: `alert_${position.id}`,
              symbol: position.symbol,
              label: `${position.symbol} profit alert`,
              detail: `${formatSignedPercent(pct, 1)} unrealized PnL`,
              tone: "profit",
            },
          ];
        }

        if (pct <= -25) {
          return [
            {
              id: `alert_${position.id}`,
              symbol: position.symbol,
              label: `${position.symbol} risk alert`,
              detail: `${formatSignedPercent(pct, 1)} unrealized PnL`,
              tone: "risk",
            },
          ];
        }

        return [];
      })
      .slice(0, 6);
  }, [
    brokerAuthenticated,
    brokerConfigured,
    positionAlertsQuery.data,
    primaryAccountId,
  ]);
  useEffect(() => {
    publishMarketAlertsSnapshot({
      items: marketAlertItems,
      totalAlerts,
      winAlerts,
      lossAlerts,
    });
  }, [lossAlerts, marketAlertItems, totalAlerts, winAlerts]);
  const signalMonitorParams = useMemo(() => ({ environment }), [environment]);
  const signalMonitorEventsParams = useMemo(
    () => ({ environment, limit: 100 }),
    [environment],
  );
  const signalMonitorProfileQuery = useGetSignalMonitorProfile(
    signalMonitorParams,
    {
      query: {
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: false,
      },
    },
  );
  const signalMonitorProfile = signalMonitorProfileQuery.data || null;
  const signalMonitorPollMs = clampNumber(
    (signalMonitorProfile?.pollIntervalSeconds || 60) * 1000,
    15_000,
    3_600_000,
  );
  const signalMonitorStateQuery = useGetSignalMonitorState(
    signalMonitorParams,
    {
      query: {
        staleTime: 15_000,
        refetchInterval: pageVisible ? signalMonitorPollMs : false,
        retry: false,
      },
    },
  );
  const signalMonitorEventsQuery = useListSignalMonitorEvents(
    signalMonitorEventsParams,
    {
      query: {
        staleTime: 15_000,
        refetchInterval: pageVisible ? signalMonitorPollMs : false,
        retry: false,
      },
    },
  );
  useRuntimeWorkloadFlag(
    "signal-monitor:display",
    Boolean(pageVisible && signalMonitorProfile?.enabled),
    {
      kind: "poll",
      label: "Signal display",
      detail: `${Math.round(signalMonitorPollMs / 1000)}s`,
      priority: 4,
    },
  );
  const signalMonitorEvaluationInFlightRef = useRef(false);
  const signalMonitorEvaluationQueuedModeRef = useRef(null);
  const updateSignalMonitorProfileMutation = useUpdateSignalMonitorProfile({
    mutation: {
      onSuccess: (profile) => {
        queryClient.setQueryData(
          getGetSignalMonitorProfileQueryKey({
            environment: profile.environment,
          }),
          profile,
        );
        queryClient.invalidateQueries({
          queryKey: getGetSignalMonitorStateQueryKey({
            environment: profile.environment,
          }),
        });
      },
      onError: (error) => {
        pushToast({
          title: "Unable to update signal monitor",
          body: error?.message || "Request failed",
          kind: "error",
        });
      },
    },
  });
  const evaluateSignalMonitorMutation = useEvaluateSignalMonitor({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(
          getGetSignalMonitorStateQueryKey({
            environment: data.profile.environment,
          }),
          data,
        );
        queryClient.invalidateQueries({
          queryKey: getListSignalMonitorEventsQueryKey({
            environment: data.profile.environment,
            limit: 100,
          }),
        });
      },
      onError: (error) => {
        pushToast({
          title: "Signal monitor scan failed",
          body: error?.message || "Request failed",
          kind: "error",
        });
      },
      onSettled: () => {
        signalMonitorEvaluationInFlightRef.current = false;
        const queuedMode = signalMonitorEvaluationQueuedModeRef.current;
        signalMonitorEvaluationQueuedModeRef.current = null;
        if (queuedMode) {
          setTimeout(() => {
            if (signalMonitorEvaluationInFlightRef.current) {
              signalMonitorEvaluationQueuedModeRef.current = queuedMode;
              return;
            }
            signalMonitorEvaluationInFlightRef.current = true;
            evaluateSignalMonitorMutation.mutate({
              data: {
                environment,
                mode: queuedMode,
              },
            });
          }, 0);
        }
      },
    },
  });
  const runSignalMonitorEvaluation = useCallback(
    (mode = "incremental") => {
      if (signalMonitorEvaluationInFlightRef.current) {
        signalMonitorEvaluationQueuedModeRef.current = mode;
        return;
      }
      signalMonitorEvaluationInFlightRef.current = true;
      evaluateSignalMonitorMutation.mutate({
        data: {
          environment,
          mode,
        },
      });
    },
    [environment, evaluateSignalMonitorMutation.mutate],
  );
  const signalMonitorStates = signalMonitorStateQuery.data?.states || [];
  const signalMonitorEvents = signalMonitorEventsQuery.data?.events || [];
  const signalMonitorSymbols = useMemo(
    () =>
      [
        ...new Set(
          signalMonitorStates
            .map((state) => normalizeTickerSymbol(state?.symbol))
            .filter(Boolean),
        ),
      ],
    [signalMonitorStates],
  );
  const runtimeWatchlistSymbols = useMemo(
    () => [...new Set([...watchlistSymbols, ...signalMonitorSymbols])],
    [signalMonitorSymbols, watchlistSymbols],
  );
  const runtimeQuoteSymbols = useMemo(
    () => [...new Set([...quoteSymbols, ...signalMonitorSymbols])],
    [quoteSymbols, signalMonitorSymbols],
  );
  const runtimeSparklineSymbols = useMemo(
    () => [...new Set([...sparklineSymbols, ...signalMonitorSymbols])],
    [signalMonitorSymbols, sparklineSymbols],
  );
  const runtimeStreamedQuoteSymbols = useMemo(
    () => [...new Set([...streamedQuoteSymbols, ...signalMonitorSymbols])],
    [signalMonitorSymbols, streamedQuoteSymbols],
  );
  const runtimeStreamedAggregateSymbols = useMemo(
    () => [...new Set([...streamedAggregateSymbols, ...signalMonitorSymbols])],
    [signalMonitorSymbols, streamedAggregateSymbols],
  );
  useEffect(() => {
    publishSignalMonitorSnapshot({
      profile: signalMonitorProfile,
      states: signalMonitorStates,
      events: signalMonitorEvents,
      pending: evaluateSignalMonitorMutation.isPending,
    });
  }, [
    evaluateSignalMonitorMutation.isPending,
    signalMonitorEvents,
    signalMonitorProfile,
    signalMonitorStates,
  ]);
  // Persist state changes (debounced via useEffect — fires after each commit)
  useEffect(() => {
    const normalizedScreen = screen === "unusual" ? "flow" : screen;
    persistState({ screen: normalizedScreen });
    if (screen !== normalizedScreen) {
      setScreen(normalizedScreen);
    }
  }, [screen]);
  useEffect(() => {
    persistState({ sym });
  }, [sym]);
  useEffect(() => {
    persistState({ sidebarCollapsed });
  }, [sidebarCollapsed]);
  useEffect(() => {
    persistState({ theme });
  }, [theme]);
  useEffect(() => {
    if ((preferredTheme === "dark" || preferredTheme === "light") && preferredTheme !== theme) {
      setCurrentTheme(preferredTheme);
      setTheme(preferredTheme);
    }
  }, [preferredTheme, theme]);
  useEffect(() => {
    if (!["xs", "s", "m", "l", "xl"].includes(preferredScale)) {
      return;
    }
    setCurrentScale(preferredScale);
    persistState({ scale: preferredScale });
    setUiPreferenceRevision((revision) => revision + 1);
  }, [preferredScale]);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    const normalizedDensity =
      preferredDensity === "comfortable" ? "comfortable" : "compact";
    setCurrentDensity(normalizedDensity);
    setUiPreferenceRevision((revision) => revision + 1);
    root.dataset.rayalgoDensity = normalizedDensity;
    root.dataset.rayalgoReducedMotion =
      preferredReducedMotion === "on" || preferredReducedMotion === "off"
        ? preferredReducedMotion
        : "system";
  }, [preferredDensity, preferredReducedMotion]);
  // Keep the shared token module and React state in sync so T/fs/sp/dim
  // resolve against the next palette during the same render pass.
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setCurrentTheme(next);
    setTheme(next);
    userPreferences.patch({ appearance: { theme: next } });
  }, [theme, userPreferences]);

  const handleSelectWatchlist = useCallback((watchlistId) => {
    setActiveWatchlistId(watchlistId);
  }, []);

  // Watchlist sync: clicking a sidebar item updates sym AND signals Trade tab
  // to load it into the active slot
  const handleSelectSymbol = useCallback((newSym) => {
    const normalized = normalizeTickerSymbol(newSym);
    if (!normalized) {
      return;
    }
    ensureTradeTickerInfo(normalized, normalized);
    setSym(normalized);
    setTradeSymPing((prev) => ({
      sym: normalized,
      n: prev.n + 1,
      contract: null,
    }));
  }, []);
  const handleFocusMarketChart = useCallback((newSym) => {
    const normalized = normalizeTickerSymbol(newSym);
    if (!normalized) {
      return;
    }
    setSym(normalized);
  }, []);

  const handleSignalAction = useCallback((ticker, signal) => {
    const normalized = normalizeTickerSymbol(ticker);
    if (!normalized) {
      return;
    }

    ensureTradeTickerInfo(normalized, normalized);
    setSym(normalized);
    setTradeSymPing((prev) => ({
      sym: normalized,
      n: prev.n + 1,
      contract: null,
    }));
    setScreen("trade");
    pushToast({
      title: `${normalized} ${String(signal?.currentSignalDirection || signal?.direction || "signal").toUpperCase()} signal`,
      body: signal?.timeframe
        ? `${signal.timeframe} RayReplica monitor signal loaded into Trade.`
        : "RayReplica monitor signal loaded into Trade.",
      kind:
        signal?.currentSignalDirection === "sell" || signal?.direction === "sell"
          ? "warn"
          : "success",
      duration: 2600,
    });
  }, [pushToast]);

  const handleToggleSignalMonitor = useCallback(() => {
    const nextEnabled = !signalMonitorProfile?.enabled;
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment,
          enabled: nextEnabled,
        },
      },
      {
        onSuccess: () => {
          if (nextEnabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    environment,
    runSignalMonitorEvaluation,
    signalMonitorProfile?.enabled,
    updateSignalMonitorProfileMutation,
  ]);

  const handleChangeSignalMonitorTimeframe = useCallback((timeframe) => {
    const normalizedTimeframe = normalizeSignalMonitorTimeframe(timeframe);
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment,
          timeframe: normalizedTimeframe,
        },
      },
      {
        onSuccess: (profile) => {
          if (profile?.enabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    environment,
    runSignalMonitorEvaluation,
    updateSignalMonitorProfileMutation,
  ]);
  const handleChangeSignalMonitorWatchlist = useCallback((watchlistId) => {
    updateSignalMonitorProfileMutation.mutate({
      data: {
        environment,
        watchlistId: watchlistId || null,
      },
    });
  }, [
    environment,
    updateSignalMonitorProfileMutation,
  ]);
  const handleRunSignalMonitorNow = useCallback(() => {
    runSignalMonitorEvaluation("incremental");
  }, [runSignalMonitorEvaluation]);

  const handleCreateWatchlist = useCallback((name) => {
    createWatchlistMutation.mutate(name);
  }, [createWatchlistMutation]);

  const handleRenameWatchlist = useCallback((watchlistId, name) => {
    updateWatchlistMutation.mutate({ watchlistId, body: { name } });
  }, [updateWatchlistMutation]);

  const handleDeleteWatchlist = useCallback((watchlistId) => {
    deleteWatchlistMutation.mutate(watchlistId);
  }, [deleteWatchlistMutation]);

  const handleSetDefaultWatchlist = useCallback((watchlistId) => {
    updateWatchlistMutation.mutate({
      watchlistId,
      body: { isDefault: true },
    });
  }, [updateWatchlistMutation]);

  const handleAddSymbolToWatchlist = useCallback((symbol, name, identitySource) => {
    if (!activeWatchlist?.id) {
      pushToast({
        title: "No active watchlist selected",
        kind: "warn",
      });
      return;
    }
    addWatchlistSymbolMutation.mutate({
      watchlistId: activeWatchlist.id,
      symbol,
      name,
      identity: buildWatchlistIdentityPayload(identitySource),
    });
  }, [activeWatchlist?.id, addWatchlistSymbolMutation, pushToast]);

  const handleRemoveSymbolFromWatchlist = useCallback((itemId, symbol) => {
    if (!activeWatchlist?.id) {
      return;
    }
    removeWatchlistSymbolMutation.mutate({
      watchlistId: activeWatchlist.id,
      itemId,
      symbol,
    });
  }, [activeWatchlist?.id, removeWatchlistSymbolMutation]);
  const handleReorderSymbolInWatchlist = useCallback((itemId, targetItemId) => {
    if (!activeWatchlist?.id || !activeWatchlist.items?.length) {
      return;
    }

    const orderedIds = activeWatchlist.items
      .map((item) => item.id)
      .filter((id) => typeof id === "string" && id.length > 0);
    const currentIndex = orderedIds.indexOf(itemId);
    const targetIndex = orderedIds.indexOf(targetItemId);
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      return;
    }

    const nextIds = [...orderedIds];
    const [movedId] = nextIds.splice(currentIndex, 1);
    nextIds.splice(targetIndex, 0, movedId);

    reorderWatchlistMutation.mutate({
      watchlistId: activeWatchlist.id,
      itemIds: nextIds,
    });
  }, [activeWatchlist, reorderWatchlistMutation]);

  // Jump to Trade tab from Flow drawer with a contract preloaded
  const handleJumpToTradeFromFlow = useCallback((evt) => {
    const ticker = evt.ticker?.toUpperCase?.() || evt.ticker;
    if (!ticker) return;

    ensureTradeTickerInfo(ticker, ticker);
    setSym(ticker);
    setTradeSymPing((prev) => ({
      sym: ticker,
      n: prev.n + 1,
      contract: {
        strike: evt.strike,
        cp: evt.cp,
        exp: formatExpirationLabel(evt.expirationDate || evt.exp),
      },
    }));
    setScreen("trade");
  }, []);

  const handleJumpToTradeFromSignalOptionsCandidate = useCallback((candidate) => {
    const ticker = candidate?.symbol?.toUpperCase?.() || candidate?.symbol;
    if (!ticker) return;
    const selectedContract =
      candidate?.selectedContract && typeof candidate.selectedContract === "object"
        ? candidate.selectedContract
        : {};
    const strike = Number(selectedContract.strike);
    const right = selectedContract.right === "put" ? "P" : "C";

    ensureTradeTickerInfo(ticker, ticker);
    setSym(ticker);
    setTradeSymPing((prev) => ({
      sym: ticker,
      n: prev.n + 1,
      contract: {
        strike: Number.isFinite(strike) ? strike : null,
        cp: right,
        exp: formatExpirationLabel(selectedContract.expirationDate),
        providerContractId: selectedContract.providerContractId || null,
      },
      automationCandidate: candidate,
    }));
    setScreen("trade");
    pushToast({
      title: `${ticker} signal-option context loaded`,
      body: "Trade preloaded the selected contract from the shadow candidate.",
      kind: "info",
      duration: 2600,
    });
  }, [pushToast]);

  // Jump to Trade tab from Research with a ticker preloaded.
  // Research passes a plain ticker string rather than a flow event.
  const handleJumpToTradeFromResearch = useCallback((ticker) => {
    const normalized = ticker?.toUpperCase?.() || ticker;
    if (!normalized) return;

    ensureTradeTickerInfo(normalized, normalized);
    setSym(normalized);
    setTradeSymPing((prev) => ({
      sym: normalized,
      n: prev.n + 1,
      contract: null,
    }));
    setScreen("trade");
  }, []);

  const handleAccountJumpToTrade = useCallback((symbol) => {
    handleSelectSymbol(symbol);
    setScreen("trade");
  }, [handleSelectSymbol]);

  const renderScreenById = (screenId) => {
    switch (screenId) {
      case "market":
        return (
          <MemoMarketScreen
            sym={sym}
            onSymClick={handleSelectSymbol}
            onChartFocus={handleFocusMarketChart}
            symbols={watchlistSymbols}
            flowSymbols={runtimeWatchlistSymbols}
            signalSuggestionSymbols={signalMonitorSymbols}
            isVisible={marketScreenActive}
            researchConfigured={researchConfigured}
            stockAggregateStreamingEnabled={
              stockAggregateStreamingEnabled && marketScreenActive
            }
            onSignalAction={handleSignalAction}
            onScanNow={handleRunSignalMonitorNow}
            onToggleMonitor={handleToggleSignalMonitor}
            onChangeMonitorTimeframe={handleChangeSignalMonitorTimeframe}
            onChangeMonitorWatchlist={handleChangeSignalMonitorWatchlist}
            watchlists={watchlists}
          />
        );
      case "flow":
      case "unusual":
        return (
          <Suspense
            fallback={<ScreenLoadingFallback label="Loading flow" />}
          >
            <MemoFlowScreen
              session={session}
              symbols={runtimeWatchlistSymbols}
              isVisible={flowScreenActive}
              onJumpToTrade={handleJumpToTradeFromFlow}
            />
          </Suspense>
        );
      case "trade":
        return (
          <MemoTradeScreen
            sym={sym}
            symPing={tradeSymPing}
            session={session}
            environment={environment}
            accountId={primaryAccountId}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            gatewayTradingReady={gatewayTradingReady}
            gatewayTradingMessage={gatewayTradingMessage}
            isVisible={screen === "trade"}
          />
        );
      case "account":
        return (
          <MemoAccountScreen
            session={session}
            accounts={accounts}
            selectedAccountId={primaryAccountId}
            onSelectTradingAccount={setSelectedAccountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            gatewayTradingReady={gatewayTradingReady}
            gatewayTradingMessage={gatewayTradingMessage}
            isVisible={screen === "account"}
            onJumpToTrade={handleAccountJumpToTrade}
          />
        );
      case "research":
        return (
          <MemoResearchScreen
            isVisible={screen === "research"}
            onJumpToTrade={handleJumpToTradeFromResearch}
          />
        );
      case "algo":
        return (
          <MemoAlgoScreen
            session={session}
            environment={environment}
            accounts={accounts}
            selectedAccountId={primaryAccountId}
            isVisible={screen === "algo"}
            onJumpToTradeCandidate={handleJumpToTradeFromSignalOptionsCandidate}
          />
        );
      case "backtest":
        return (
          <MemoBacktestScreen
            watchlists={watchlistsQuery.data?.watchlists || []}
            defaultWatchlistId={defaultWatchlist?.id || null}
            isVisible={screen === "backtest"}
          />
        );
      case "diagnostics":
        return <MemoDiagnosticsScreen />;
      case "settings":
        return (
          <MemoSettingsScreen
            theme={theme}
            onToggleTheme={toggleTheme}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          />
        );
      default:
        return (
          <MemoMarketScreen
            sym={sym}
            onSymClick={handleSelectSymbol}
            onChartFocus={handleFocusMarketChart}
            symbols={watchlistSymbols}
            flowSymbols={runtimeWatchlistSymbols}
            signalSuggestionSymbols={signalMonitorSymbols}
            isVisible={marketScreenActive}
            researchConfigured={researchConfigured}
            stockAggregateStreamingEnabled={
              stockAggregateStreamingEnabled && marketScreenActive
            }
            onSignalAction={handleSignalAction}
            onScanNow={handleRunSignalMonitorNow}
            onToggleMonitor={handleToggleSignalMonitor}
            onChangeMonitorTimeframe={handleChangeSignalMonitorTimeframe}
            onChangeMonitorWatchlist={handleChangeSignalMonitorWatchlist}
            watchlists={watchlists}
          />
        );
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
      <ToastContext.Provider value={toastValue}>
        <PositionsContext.Provider value={positionsValue}>
        <AccountSelectionContext.Provider
          value={{
            accounts,
            selectedAccountId: primaryAccountId,
            setSelectedAccountId,
          }}
        >
        <MarketDataSubscriptionProvider
          watchlistSymbols={runtimeWatchlistSymbols}
          activeWatchlistItems={activeWatchlist?.items}
          quoteSymbols={runtimeQuoteSymbols}
          sparklineSymbols={runtimeSparklineSymbols}
          streamedQuoteSymbols={runtimeStreamedQuoteSymbols}
          streamedAggregateSymbols={runtimeStreamedAggregateSymbols}
          marketStockAggregateStreamingEnabled={marketStockAggregateStreamingEnabled}
          marketScreenActive={marketScreenActive}
          lowPriorityHistoryEnabled={
            sessionMetadataSettled && screenWarmupPhase !== "initial"
          }
        >
          <SharedMarketFlowRuntime
            symbols={runtimeWatchlistSymbols}
            enabled={
              sessionMetadataSettled &&
              (marketScreenActive || flowScreenActive || screenWarmupPhase === "ready")
            }
            intervalMs={marketScreenActive || flowScreenActive ? 10_000 : 30_000}
          />
          <BroadFlowScannerRuntime
            symbols={runtimeWatchlistSymbols}
            enabled={sessionMetadataSettled && pageVisible}
          />
          <div
            style={{
              height: "100vh",
              display: "flex",
              flexDirection: "column",
              background: T.bg0,
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            <style>{FONT_CSS}</style>
            <ToastStack toasts={toasts} onDismiss={dismissToast} />
            {latencyDebugEnabled && (
              <LatencyDebugStrip screen={screen} mountedScreens={mountedScreens} />
            )}

            {/* ══════ TOP ANCHOR BAR ══════ */}
            <div
              data-testid="platform-compact-header"
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                alignItems: "stretch",
                gap: sp(6),
                padding: sp("3px 8px"),
                minWidth: 0,
                background: T.bg1,
                borderBottom: `1px solid ${T.border}`,
                flexShrink: 0,
              }}
            >
              <div
                data-testid="platform-screen-nav"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(2),
                  minWidth: 0,
                  flexWrap: "nowrap",
                }}
              >
                {SCREENS.map((s) => {
                  const isTradeTab = s.id === "trade";
                  const hasAlerts = isTradeTab && totalAlerts > 0;
                  const alertColor = lossAlerts > winAlerts ? T.red : T.amber;
                  const pulseAnim = hasAlerts
                    ? lossAlerts > winAlerts
                      ? "pulseAlertLoss 1.8s ease-in-out infinite"
                      : "pulseAlert 1.8s ease-in-out infinite"
                    : "none";
                  return (
                    <button
                      key={s.id}
                      className={joinMotionClasses(
                        "ra-interactive",
                        screen === s.id && "ra-focus-rail",
                      )}
                      onClick={() => setScreen(s.id)}
                      style={{
                        ...motionVars({
                          accent: hasAlerts ? alertColor : T.accent,
                        }),
                        padding: sp("4px 6px"),
                        minHeight: dim(32),
                        fontSize: fs(10),
                        fontWeight: 700,
                        fontFamily: T.sans,
                        background: screen === s.id ? T.bg3 : "transparent",
                        border: `1px solid ${screen === s.id ? T.accent : T.border}`,
                        borderRadius: 0,
                        cursor: "pointer",
                        color: screen === s.id ? T.text : T.textDim,
                        transition:
                          "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                        animation: pulseAnim,
                        position: "relative",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => {
                        if (screen === s.id) return;
                        e.currentTarget.style.color = T.textSec;
                        e.currentTarget.style.background = T.bg2;
                        e.currentTarget.style.borderColor = T.textMuted;
                      }}
                      onMouseLeave={(e) => {
                        if (screen === s.id) return;
                        e.currentTarget.style.color = T.textDim;
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.borderColor = T.border;
                      }}
                      title={
                        hasAlerts
                          ? `${totalAlerts} position${totalAlerts === 1 ? "" : "s"} at alert threshold (${winAlerts} win · ${lossAlerts} loss)`
                          : s.label
                      }
                    >
                      {s.label}
                      {hasAlerts && (
                        <span
                          style={{
                            marginLeft: sp(3),
                            padding: sp("0px 4px"),
                            borderRadius: 0,
                            background: alertColor,
                            color: "#fff",
                            fontSize: fs(8),
                            fontWeight: 800,
                            fontFamily: T.sans,
                            letterSpacing: "0.04em",
                            verticalAlign: "middle",
                          }}
                        >
                          {totalAlerts}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "stretch",
                }}
              >
                <MemoHeaderKpiStripContainer
                  onSelect={handleSelectSymbol}
                />
              </div>

              <div
                data-testid="platform-header-controls"
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  justifyContent: "flex-end",
                  gap: sp(4),
                  minWidth: 0,
                  flexWrap: "nowrap",
                }}
              >
                <HeaderAccountStrip
                  accounts={accounts}
                  primaryAccountId={primaryAccountId}
                  primaryAccount={primaryAccount}
                  onSelectAccount={setSelectedAccountId}
                  maskValues={Boolean(
                    userPreferences.preferences?.appearance?.maskBalances ||
                      userPreferences.preferences?.privacy?.hideAccountValues,
                  )}
                />
                <MemoHeaderStatusCluster
                  session={session}
                  environment={environment}
                  bridgeTone={bridgeTone}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                />
              </div>
            </div>

            <HeaderBroadcastScrollerStack
              symbols={runtimeWatchlistSymbols}
              enabled={sessionMetadataSettled}
              onSignalAction={handleSignalAction}
              onFlowAction={handleJumpToTradeFromFlow}
              signalScanEnabled={Boolean(signalMonitorProfile?.enabled)}
              signalScanPending={updateSignalMonitorProfileMutation.isPending}
              signalEvaluationPending={evaluateSignalMonitorMutation.isPending}
              signalScanErrored={Boolean(
                signalMonitorProfile?.enabled &&
                  (signalMonitorStateQuery.isError ||
                    signalMonitorEventsQuery.isError ||
                    evaluateSignalMonitorMutation.isError ||
                    updateSignalMonitorProfileMutation.isError),
              )}
              onToggleSignalScan={handleToggleSignalMonitor}
            />

            {/* ══════ MAIN CONTENT (3 columns) ══════ */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Left: Watchlist */}
              <div
                style={{
                  width: sidebarCollapsed ? 40 : 248,
                  transition: "width 0.2s",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {sidebarCollapsed ? (
                  <div
                    style={{
                      height: "100%",
                      background: T.bg1,
                      borderRight: `1px solid ${T.border}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      paddingTop: sp(8),
                    }}
                  >
                    <button
                      onClick={() => setSidebarCollapsed(false)}
                      style={{
                        width: dim(28),
                        height: dim(28),
                        border: "none",
                        borderRadius: 0,
                        background: T.bg2,
                        color: T.textDim,
                        cursor: "pointer",
                        fontSize: fs(12),
                      }}
                    >
                      ☰
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative", height: "100%" }}>
                    <button
                      onClick={() => setSidebarCollapsed(true)}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 6,
                        zIndex: 2,
                        width: dim(18),
                        height: dim(18),
                        border: "none",
                        borderRadius: 0,
                        background: T.bg3,
                        color: T.textDim,
                        cursor: "pointer",
                        fontSize: fs(9),
                      }}
                    >
                      ◂
                    </button>
                    <MemoWatchlistContainer
                      watchlists={watchlistsQuery.data?.watchlists || []}
                      activeWatchlist={activeWatchlist}
                      watchlistSymbols={watchlistSymbols}
                      signalStates={signalMonitorStates}
                      selected={sym}
                      onSelect={handleSelectSymbol}
                      onSelectWatchlist={handleSelectWatchlist}
                      onCreateWatchlist={handleCreateWatchlist}
                      onRenameWatchlist={handleRenameWatchlist}
                      onDeleteWatchlist={handleDeleteWatchlist}
                      onSetDefaultWatchlist={handleSetDefaultWatchlist}
                      onAddSymbol={handleAddSymbolToWatchlist}
                      onReorderSymbol={handleReorderSymbolInWatchlist}
                      onRemoveSymbol={handleRemoveSymbolFromWatchlist}
                      onSignalAction={handleSignalAction}
                      busy={
                        createWatchlistMutation.isPending ||
                        updateWatchlistMutation.isPending ||
                        deleteWatchlistMutation.isPending ||
                        addWatchlistSymbolMutation.isPending ||
                        removeWatchlistSymbolMutation.isPending ||
                        reorderWatchlistMutation.isPending
                      }
                    />
                  </div>
                )}
              </div>

              {/* Center: Active Screen */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {SCREENS.map(({ id }) =>
                  mountedScreens[id] ? (
                    <div
                      key={id}
                      data-testid={`screen-host-${id}`}
                      aria-hidden={screen !== id}
                      style={{
                        flex: 1,
                        width: "100%",
                        minWidth: 0,
                        minHeight: 0,
                        display: screen === id ? "flex" : "none",
                        flexDirection: "column",
                      }}
                    >
                      {screen === id ? (
                        <Suspense
                          fallback={
                            <ScreenLoadingFallback
                              label={`Loading ${id}`}
                            />
                          }
                        >
                          {renderScreenById(id)}
                        </Suspense>
                      ) : (
                        <div
                          data-testid={`screen-suspended-${id}`}
                          style={{ display: "none" }}
                        />
                      )}
                    </div>
                  ) : null,
                )}
              </div>
            </div>

            {/* ══════ STATUS BAR ══════ */}
            <div
              data-testid="platform-bottom-status"
              style={{
                display: "flex",
                alignItems: "center",
                height: dim(24),
                padding: sp("0 12px"),
                background: T.bg1,
                borderTop: `1px solid ${T.border}`,
                flexShrink: 0,
                fontSize: fs(9),
                fontFamily: T.sans,
                gap: sp(12),
              }}
            >
              <span style={{ color: T.textMuted }}>
                WL {(activeWatchlist?.name || "Core").toUpperCase()}
              </span>
              <span style={{ color: T.textMuted }}>
                SYM {sym}
              </span>
              <span
                style={{
                  color: session?.configured?.ibkr ? T.green : T.red,
                }}
              >
                HIST{" "}
                {(
                  session?.marketDataProviders?.historical || MISSING_VALUE
                ).toUpperCase()}
              </span>
              <span
                style={{
                  color: session?.configured?.research ? T.green : T.red,
                }}
              >
                RSCH{" "}
                {(session?.marketDataProviders?.research || MISSING_VALUE).toUpperCase()}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: T.textMuted }}>v0.1.0</span>
            </div>
            <BloombergLiveDock />
          </div>
        </MarketDataSubscriptionProvider>
        </AccountSelectionContext.Provider>
        </PositionsContext.Provider>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}
