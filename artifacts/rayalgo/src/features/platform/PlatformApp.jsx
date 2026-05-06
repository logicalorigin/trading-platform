import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetNewsQueryOptions,
  getGetQuoteSnapshotsQueryOptions,
  getGetResearchEarningsCalendarQueryOptions,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalMonitorStateQueryKey,
  getListAlgoDeploymentsQueryOptions,
  getListBacktestDraftStrategiesQueryOptions,
  getListSignalMonitorEventsQueryKey,
  useEvaluateSignalMonitor,
  useEvaluateSignalMonitorMatrix,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
  useListSignalMonitorEvents,
  useGetSession,
  useListAccounts,
  useListPositions,
  useListWatchlists,
  useUpdateSignalMonitorProfile,
} from "@workspace/api-client-react";
import {
  getActiveChartBarStoreEntryCount,
} from "../charting/activeChartBarStore";
import {
  getChartHydrationStatsSnapshot,
  sanitizeChartHydrationStatsForDiagnostics,
} from "../charting/chartHydrationStats";
import {
  getBrokerStockAggregateDebugStats,
  setBrokerStockAggregateStreamPaused,
} from "../charting/useMassiveStockAggregateStream";
import {
  INDICES,
  MARKET_SNAPSHOT_SYMBOLS,
  WATCHLIST,
} from "../market/marketReferenceData";
import {
  getOptionQuoteSnapshotCacheSize,
  useBrokerStreamFreshnessSnapshot,
  useIbkrAccountSnapshotStream,
  useIbkrOrderSnapshotStream,
  useShadowAccountSnapshotStream,
} from "./live-streams";
import { MarketDataSubscriptionProvider } from "./MarketDataSubscriptionProvider.jsx";
import { usePageVisible } from "./usePageVisible";
import {
  BroadFlowScannerRuntime,
  SharedMarketFlowRuntime,
} from "./MarketFlowRuntimeLayer.jsx";
import {
  getRuntimeWorkloadStats,
  useRuntimeWorkloadFlag,
} from "./workloadStats";
import { useMemoryPressureMonitor } from "./useMemoryPressureSignal";
import { PlatformShell } from "./PlatformShell.jsx";
import { PlatformProviders } from "./PlatformProviders.jsx";
import { PlatformRuntimeLayer } from "./PlatformRuntimeLayer.jsx";
import { PlatformScreenRouter } from "./PlatformScreenRouter.jsx";
import { HeaderAccountStrip } from "./HeaderAccountStrip.jsx";
import {
  HEADER_KPI_SYMBOLS,
  HeaderKpiStrip,
} from "./HeaderKpiStrip.jsx";
import { MemoHeaderStatusCluster } from "./HeaderStatusCluster.jsx";
import { HeaderBroadcastScrollerStack } from "./HeaderBroadcastScrollerStack.jsx";
import { MemoWatchlistContainer } from "./PlatformWatchlist.jsx";
import { LatencyDebugStrip } from "./LatencyDebugStrip.jsx";
import { normalizeTickerSymbol } from "./tickerIdentity";
import {
  ensureTradeTickerInfo,
} from "./runtimeTickerStore";
import {
  QUERY_DEFAULTS,
} from "./queryDefaults";
import {
  bridgeRuntimeTone,
  resolveGatewayTradingReadiness,
} from "./bridgeRuntimeModel";
import {
  OPERATIONAL_SCREEN_PRELOAD_ORDER,
  buildMountedScreenState,
} from "./screenRegistry.jsx";
import {
  getMarketFlowStoreEntryCount,
} from "./marketFlowStore";
import {
  normalizeSignalMonitorTimeframe,
} from "./marketActivityLaneModel";
import { publishMarketAlertsSnapshot } from "./marketAlertsStore";
import {
  publishSignalMonitorSnapshot,
} from "./signalMonitorStore";
import {
  buildWatchlistIdentityPayload,
  buildWatchlistRows,
} from "./watchlistModel";
import {
  getTradeFlowStoreEntryCount,
} from "./tradeFlowStore";
import {
  getTradeOptionChainStoreEntryCount,
} from "./tradeOptionChainStore";
import { platformJsonRequest } from "./platformJsonRequest";
import {
  getCurrentTheme,
  setCurrentDensity,
  setCurrentScale,
  setCurrentTheme,
} from "../../lib/uiTokens";
import { setHydrationPressureState } from "./hydrationCoordinator";
import { buildPlatformWorkSchedule } from "./appWorkScheduler.js";
import { resolveIbkrWorkPressure } from "./workPressureModel.js";
import {
  _initialState,
  persistState,
} from "../../lib/workspaceState";
import { preloadDynamicImport } from "../../lib/dynamicImport";
import { getMemoryPressureSnapshot } from "./memoryPressureStore";
import {
  clampNumber,
  formatExpirationLabel,
  formatIsoDate,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useUserPreferences } from "../preferences/useUserPreferences";

// ═══════════════════════════════════════════════════════════════════
// FONTS
// ═══════════════════════════════════════════════════════════════════
const FONT_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{width:100%;height:100%;overflow:hidden}
body,button,input,select,textarea{font-family:var(--ra-font-sans,'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif)}
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

const WATCHLISTS_QUERY_KEY = ["/api/watchlists"];

// ═══════════════════════════════════════════════════════════════════
// STATIC DATA / GENERATORS
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════

// ─── LIVE-DATA SUBSCRIPTION ISOLATION ───
// Live quote ticks, sparkline refreshes, and per-minute aggregate store updates
// are isolated from the platform app root so they do not force broad shell
// re-renders on every change.
//
// MarketDataSubscriptionProvider now owns those subscriptions and writes into
// the runtime ticker snapshot store. Header/watchlist containers subscribe to
// only the symbols they render, so a quote tick re-renders just the affected
// panels instead of the whole terminal shell.

export default function PlatformApp() {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const memoryPressureSignal = useMemoryPressureMonitor();
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
  const [marketSymPing, setMarketSymPing] = useState({
    sym: _initialState.sym || "SPY",
    n: 0,
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
        memoryPressure: getMemoryPressureSnapshot(),
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
  useRuntimeWorkloadFlag("platform:session", Boolean(pageVisible), {
    kind: "poll",
    label: "Session",
    detail: "5s",
    priority: 2,
  });
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
  useRuntimeWorkloadFlag("platform:watchlists", Boolean(pageVisible), {
    kind: "poll",
    label: "Watchlists",
    detail: "60s",
    priority: 5,
  });
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
  const allWatchlistSymbolList = useMemo(() => {
    const fallback = watchlistsQuery.data?.watchlists?.length
      ? []
      : WATCHLIST.map((item) => item.sym);
    const sourceWatchlists = Array.isArray(watchlists) ? watchlists : [];
    const symbols = sourceWatchlists.length
      ? sourceWatchlists.flatMap((watchlist) =>
          buildWatchlistRows({
            activeWatchlist: watchlist,
            fallbackSymbols: [],
            signalStates: [],
          }).map((item) => item.sym),
        )
      : buildWatchlistRows({
          activeWatchlist: null,
          fallbackSymbols: fallback,
          signalStates: [],
        }).map((item) => item.sym);
    const unique = [...new Set(symbols.filter(Boolean))];
    return unique.length ? unique : watchlistSymbols;
  }, [watchlistSymbols, watchlists, watchlistsQuery.data]);
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
  const memoryPressureObserved = Boolean(
    memoryPressureSignal?.observedAt || memoryPressureSignal?.measurement,
  );
  const memoryAllowsBackgroundWarmup = Boolean(
    memoryPressureObserved && memoryPressureSignal?.level === "normal",
  );
  const memoryAllowsIdlePrefetch = memoryAllowsBackgroundWarmup;
  const tradeBackgroundWarmupReady = Boolean(
    sessionMetadataSettled && memoryAllowsBackgroundWarmup,
  );
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
      sessionQuery.data?.configured?.ibkr &&
      sessionQuery.data?.ibkrBridge?.authenticated,
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
        setMarketSymPing((prev) => ({ sym: nextSym, n: prev.n + 1 }));
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
  const brokerStreamFreshness = useBrokerStreamFreshnessSnapshot();
  const accountOrderStreamsFresh = Boolean(
    brokerStreamFreshness.accountFresh && brokerStreamFreshness.orderFresh,
  );
  const effectiveGatewayTradingReady = Boolean(
    gatewayTradingReady && accountOrderStreamsFresh,
  );
  const effectiveGatewayTradingMessage =
    gatewayTradingReady && !accountOrderStreamsFresh
      ? "Broker account and order streams are stale; live trading is paused until realtime account state refreshes."
      : gatewayTradingMessage;
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
      screenWarmupStartedRef.current = false;
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
    if (!sessionMetadataSettled || !memoryAllowsIdlePrefetch) {
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
      preloadDynamicImport(
        () => import("../research/PhotonicsObservatory.jsx"),
        { label: "PhotonicsObservatoryPrefetch" },
      );
    }, 1_000);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [
    environment,
    memoryAllowsIdlePrefetch,
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
  const ibkrWorkPressure = useMemo(
    () => resolveIbkrWorkPressure(session?.ibkrBridge),
    [session?.ibkrBridge],
  );
  const workSchedule = useMemo(
    () =>
      buildPlatformWorkSchedule({
        pageVisible,
        sessionMetadataSettled,
        activeScreen: screen,
        screenWarmupPhase,
        ibkrWorkPressure,
        memoryPressure: memoryPressureSignal,
        brokerConfigured,
        brokerAuthenticated: Boolean(session?.ibkrBridge?.authenticated),
        automationEnabled: Boolean(signalMonitorProfile?.enabled),
        tradingEnabled: Boolean(gatewayTradingReady),
      }),
    [
      brokerConfigured,
      gatewayTradingReady,
      ibkrWorkPressure,
      memoryPressureSignal,
      pageVisible,
      screen,
      screenWarmupPhase,
      sessionMetadataSettled,
      session?.ibkrBridge?.authenticated,
      signalMonitorProfile?.enabled,
    ],
  );
  useEffect(() => {
    setHydrationPressureState(workSchedule.hydrationPressure);
  }, [workSchedule.hydrationPressure]);
  useRuntimeWorkloadFlag("signal-monitor:profile", Boolean(pageVisible), {
    kind: "poll",
    label: "Signal profile",
    detail: "60s",
    priority: 6,
  });
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
  const [signalMatrixSnapshot, setSignalMatrixSnapshot] = useState(() => ({
    states: [],
    timeframes: ["2m", "5m", "15m"],
  }));
  const signalMatrixEvaluationInFlightRef = useRef(false);
  const signalMatrixSymbolsKey = useMemo(
    () => watchlistSymbols.join(","),
    [watchlistSymbols],
  );
  const evaluateSignalMonitorMatrixMutation = useEvaluateSignalMonitorMatrix({
    mutation: {
      onSuccess: (data) => {
        setSignalMatrixSnapshot({
          states: data?.states || [],
          timeframes: data?.timeframes || ["2m", "5m", "15m"],
          evaluatedAt: data?.evaluatedAt || null,
          skippedSymbols: data?.skippedSymbols || [],
          truncated: Boolean(data?.truncated),
        });
      },
      onSettled: () => {
        signalMatrixEvaluationInFlightRef.current = false;
      },
    },
  });
  const runSignalMatrixEvaluation = useCallback(() => {
    if (signalMatrixEvaluationInFlightRef.current) {
      return;
    }
    signalMatrixEvaluationInFlightRef.current = true;
    evaluateSignalMonitorMatrixMutation.mutate({
      data: {
        environment,
        watchlistId: activeWatchlist?.id || null,
        symbols: activeWatchlist?.id ? undefined : watchlistSymbols,
        timeframes: ["2m", "5m", "15m"],
      },
    });
  }, [
    activeWatchlist?.id,
    environment,
    evaluateSignalMonitorMatrixMutation.mutate,
    signalMatrixSymbolsKey,
    watchlistSymbols,
  ]);
  useEffect(() => {
    if (!pageVisible || !watchlistSymbols.length) {
      return undefined;
    }

    runSignalMatrixEvaluation();
    const interval = window.setInterval(runSignalMatrixEvaluation, signalMonitorPollMs);
    return () => window.clearInterval(interval);
  }, [
    pageVisible,
    runSignalMatrixEvaluation,
    signalMonitorPollMs,
    signalMatrixSymbolsKey,
    watchlistSymbols.length,
  ]);
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
  const broadFlowWatchlistSymbols = useMemo(
    () => [...new Set(allWatchlistSymbolList)],
    [allWatchlistSymbolList],
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
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.rayalgoTheme =
      theme === "light" ? "light" : "dark";
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
    setMarketSymPing((prev) => ({ sym: normalized, n: prev.n + 1 }));
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

  const renderScreenById = (screenId) => (
    <PlatformScreenRouter
      screenId={screenId}
      screen={screen}
      sym={sym}
      tradeSymPing={tradeSymPing}
      marketSymPing={marketSymPing}
      session={session}
      environment={environment}
      accounts={accounts}
      primaryAccountId={primaryAccountId}
      brokerConfigured={brokerConfigured}
      brokerAuthenticated={brokerAuthenticated}
      gatewayTradingReady={effectiveGatewayTradingReady}
      gatewayTradingMessage={effectiveGatewayTradingMessage}
      watchlistSymbols={watchlistSymbols}
      runtimeWatchlistSymbols={runtimeWatchlistSymbols}
      signalMonitorSymbols={signalMonitorSymbols}
      marketScreenActive={marketScreenActive}
      flowScreenActive={flowScreenActive}
      researchConfigured={researchConfigured}
      stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
      watchlists={watchlists}
      defaultWatchlist={defaultWatchlist}
      theme={theme}
      sidebarCollapsed={sidebarCollapsed}
      onSelectSymbol={handleSelectSymbol}
      onFocusMarketChart={handleFocusMarketChart}
      onSignalAction={handleSignalAction}
      onScanNow={handleRunSignalMonitorNow}
      onToggleMonitor={handleToggleSignalMonitor}
      onChangeMonitorTimeframe={handleChangeSignalMonitorTimeframe}
      onChangeMonitorWatchlist={handleChangeSignalMonitorWatchlist}
      onJumpToTradeFromFlow={handleJumpToTradeFromFlow}
      onSelectTradingAccount={setSelectedAccountId}
      onJumpToTradeFromAccount={handleAccountJumpToTrade}
      onJumpToTradeFromResearch={handleJumpToTradeFromResearch}
      onJumpToTradeFromSignalOptionsCandidate={
        handleJumpToTradeFromSignalOptionsCandidate
      }
      onToggleTheme={toggleTheme}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
    />
  );

  return (
    <PlatformProviders
      theme={theme}
      onToggleTheme={toggleTheme}
      toastValue={toastValue}
      positionsValue={positionsValue}
      accounts={accounts}
      selectedAccountId={primaryAccountId}
      onSelectAccount={setSelectedAccountId}
    >
      <PlatformRuntimeLayer
        MarketDataSubscriptionProviderComponent={MarketDataSubscriptionProvider}
        SharedMarketFlowRuntimeComponent={SharedMarketFlowRuntime}
        BroadFlowScannerRuntimeComponent={BroadFlowScannerRuntime}
        watchlistSymbols={runtimeWatchlistSymbols}
        broadFlowWatchlistSymbols={broadFlowWatchlistSymbols}
        activeWatchlistItems={activeWatchlist?.items}
        quoteSymbols={runtimeQuoteSymbols}
        sparklineSymbols={runtimeSparklineSymbols}
        streamedQuoteSymbols={runtimeStreamedQuoteSymbols}
        streamedAggregateSymbols={runtimeStreamedAggregateSymbols}
        marketStockAggregateStreamingEnabled={
          workSchedule.streams.marketStockAggregates
        }
        marketScreenActive={marketScreenActive}
        lowPriorityHistoryEnabled={workSchedule.streams.lowPriorityHistory}
        flowRuntimeEnabled={workSchedule.streams.sharedFlowRuntime}
        flowRuntimeIntervalMs={
          marketScreenActive || flowScreenActive ? 10_000 : 30_000
        }
        broadFlowRuntimeEnabled={workSchedule.streams.broadFlowRuntime}
      >
        <PlatformShell
            activeScreen={screen}
            mountedScreens={mountedScreens}
            setScreen={setScreen}
            renderScreenById={renderScreenById}
            fontCss={FONT_CSS}
            toasts={toasts}
            onDismissToast={dismissToast}
            latencyDebugEnabled={latencyDebugEnabled}
            LatencyDebugStripComponent={LatencyDebugStrip}
            HeaderKpiStripComponent={HeaderKpiStrip}
            HeaderAccountStripComponent={HeaderAccountStrip}
            HeaderStatusClusterComponent={MemoHeaderStatusCluster}
            HeaderBroadcastScrollerStackComponent={HeaderBroadcastScrollerStack}
            WatchlistComponent={MemoWatchlistContainer}
            memoryPressureSignal={memoryPressureSignal}
            activeWatchlist={activeWatchlist}
            watchlistSymbols={watchlistSymbols}
            signalMonitorStates={signalMonitorStates}
            signalMatrixStates={signalMatrixSnapshot.states}
            selectedSymbol={sym}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            onSelectSymbol={handleSelectSymbol}
            onFocusMarketChart={handleFocusMarketChart}
            onSelectWatchlist={handleSelectWatchlist}
            onCreateWatchlist={handleCreateWatchlist}
            onRenameWatchlist={handleRenameWatchlist}
            onDeleteWatchlist={handleDeleteWatchlist}
            onSetDefaultWatchlist={handleSetDefaultWatchlist}
            onAddSymbolToWatchlist={handleAddSymbolToWatchlist}
            onReorderSymbolInWatchlist={handleReorderSymbolInWatchlist}
            onRemoveSymbolFromWatchlist={handleRemoveSymbolFromWatchlist}
            onSignalAction={handleSignalAction}
            watchlists={watchlistsQuery.data?.watchlists || []}
            watchlistsBusy={{
              mutating:
                createWatchlistMutation.isPending ||
                updateWatchlistMutation.isPending ||
                deleteWatchlistMutation.isPending ||
                addWatchlistSymbolMutation.isPending ||
                removeWatchlistSymbolMutation.isPending ||
                reorderWatchlistMutation.isPending,
              totalAlerts,
              winAlerts,
              lossAlerts,
            }}
            accounts={accounts}
            primaryAccountId={primaryAccountId}
            primaryAccount={primaryAccount}
            onSelectAccount={setSelectedAccountId}
            maskAccountValues={Boolean(
              userPreferences.preferences?.appearance?.maskBalances ||
                userPreferences.preferences?.privacy?.hideAccountValues,
            )}
            session={session}
            environment={environment}
            bridgeTone={bridgeTone}
            theme={theme}
            onToggleTheme={toggleTheme}
            runtimeWatchlistSymbols={runtimeWatchlistSymbols}
            sessionMetadataSettled={sessionMetadataSettled}
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
      </PlatformRuntimeLayer>
    </PlatformProviders>
  );
}
