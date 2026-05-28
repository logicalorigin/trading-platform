import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import LogoLoader from "../../components/LogoLoader";
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
  useBrokerStreamFreshnessStatus,
  useIbkrAccountSnapshotStream,
  useIbkrOrderSnapshotStream,
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
import { useWorkspaceLeadership } from "./workspaceLeadership.js";
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
  buildSignalMatrixRequestPlan,
  mergeSignalMatrixStates,
} from "./signalMatrixScheduler.js";
import {
  WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
  WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
  WATCHLIST_QUOTE_STREAM_ROTATION_MS,
  buildWatchlistQuoteRotationBatch,
  buildWatchlistQuoteRotationDiagnostics,
} from "./watchlistQuoteRotation.js";
import {
  QUERY_DEFAULTS,
} from "./queryDefaults";
import {
  bridgeRuntimeTone,
  resolveGatewayTradingReadiness,
} from "./bridgeRuntimeModel";
import {
  BOOT_SCREEN_MODULE_PRELOAD_ORDER,
  SCREENS,
  SCREEN_MODULE_PRELOAD_ORDER,
  SCREEN_SHELL_WARM_MOUNT_ORDER,
  buildMountedScreenState,
  getScreenModulePreloadSnapshot,
  preloadScreenModule,
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
  isSignalMonitorDegradedProfile,
  isSignalMonitorRuntimeFallbackProfile,
} from "./signalMonitorStatusModel";
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
  resolveEffectiveThemeFromState,
  resolveEffectiveThemePreference,
  setCurrentDensity,
  setCurrentScale,
  setCurrentTheme,
} from "../../lib/uiTokens";
import { setHydrationPressureState } from "./hydrationCoordinator";
import {
  buildPlatformPressureCaps,
  buildPlatformWorkSchedule,
} from "./appWorkScheduler.js";
import { resolveIbkrWorkPressure } from "./workPressureModel.js";
import {
  _initialState,
  persistState,
} from "../../lib/workspaceState";
import { preloadDynamicImport } from "../../lib/dynamicImport";
import { getMemoryPressureSnapshot } from "./memoryPressureStore";
import { captureToast } from "./notificationStore.js";
import { normalizeToastKind } from "./toastModel.js";
import {
  SCREEN_READY_EVENT,
  hasPyrusFirstScreenReady,
} from "./performanceMetrics";
import { useViewport } from "../../lib/responsive";
import {
  clampNumber,
  formatExpirationLabel,
  formatIsoDate,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
  completeBootProgressTask,
  failBootProgressTask,
  skipBootProgressTasks,
  startBootProgressTask,
  useBootProgress,
} from "../../app/bootProgress";

const SCREEN_ID_SET = new Set(SCREENS.map(({ id }) => id));

// ═══════════════════════════════════════════════════════════════════
// FONTS
// ═══════════════════════════════════════════════════════════════════
const FONT_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{width:100%;height:100%;overflow:hidden}
body,button,input,select,textarea{font-family:var(--ra-font-sans)}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:var(--ra-border-default);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--ra-surface-4)}
.ra-scrollbar-hidden{scrollbar-width:none;-ms-overflow-style:none}
.ra-scrollbar-hidden::-webkit-scrollbar{display:none}
::-webkit-scrollbar-track{background:transparent}
input[type=range]{accent-color:var(--ra-color-accent)}
@keyframes toastSlideIn{from{opacity:0;transform:translateX(20px) scale(0.96)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes toastSlideOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(20px)}}
@keyframes pulseAlert{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ra-color-status-warn) 60%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--ra-color-status-warn) 0%,transparent)}}
@keyframes pulseAlertLoss{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ra-color-pnl-negative) 60%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--ra-color-pnl-negative) 0%,transparent)}}
@keyframes premiumFlowSpin{to{transform:rotate(360deg)}}
@keyframes premiumFlowPulse{0%,100%{opacity:0.38;transform:scale(0.82)}50%{opacity:1;transform:scale(1)}}
@keyframes ibkrStatusPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ibkr-step-tone,var(--ra-color-status-warn)) 28%,transparent)}50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--ibkr-step-tone,var(--ra-color-status-warn)) 0%,transparent)}}
@keyframes ibkrStepIconPulse{0%,100%{opacity:0.72;transform:scale(0.92)}50%{opacity:1;transform:scale(1.08)}}
@keyframes ibkrStepIconDispatch{0%,100%{opacity:0.74;transform:translateX(-1px) scale(0.95)}45%{opacity:1;transform:translateX(2px) scale(1.05)}}
@keyframes ibkrStepIconSecure{0%,100%{filter:brightness(0.88);transform:rotate(-5deg) scale(0.96)}50%{filter:brightness(1.24);transform:rotate(5deg) scale(1.04)}}
@keyframes ibkrStepIconBoot{0%,100%{opacity:0.78;transform:translateY(1px) scale(0.96)}52%{opacity:1;transform:translateY(-1px) scale(1.05)}}
@keyframes ibkrStepIconLink{0%,100%{filter:drop-shadow(0 0 0 color-mix(in srgb,var(--ra-text-on-accent) 0%,transparent));transform:scaleX(0.92) scaleY(0.98)}50%{filter:drop-shadow(0 0 4px color-mix(in srgb,var(--ra-text-on-accent) 68%,transparent));transform:scaleX(1.08) scaleY(1.02)}}
@keyframes ibkrStepIconTunnel{0%,100%{opacity:0.72;transform:translateY(0) scale(0.94)}45%{opacity:1;transform:translateY(-1px) scale(1.08)}}
@keyframes ibkrStepIconQueue{0%,100%{transform:rotate(-8deg) scale(0.98)}50%{transform:rotate(8deg) scale(1.02)}}
@keyframes ibkrStepIconDetach{0%,100%{filter:brightness(0.9);transform:translateX(0) rotate(0deg)}40%{filter:brightness(1.25);transform:translateX(-1px) rotate(-7deg)}70%{transform:translateX(1px) rotate(5deg)}}
@keyframes ibkrStepIconPower{0%,100%{opacity:0.74;transform:scale(0.92)}50%{opacity:1;transform:scale(1.08)}}
@keyframes ibkrStepCheckPop{0%{opacity:0;transform:scale(0.68)}68%{opacity:1;transform:scale(1.14)}100%{opacity:1;transform:scale(1)}}
@keyframes ibkrStepLineFill{from{opacity:0.35;transform:scaleX(0)}to{opacity:1;transform:scaleX(1)}}
@keyframes headerBroadcastScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes raPulseHit{0%{transform:scale(1)}30%{transform:scale(1.18)}60%{transform:scale(0.97)}100%{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){[data-pulse-hit]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-premium-flow-glyph]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-wave] *{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-bridge-spinner],[data-ibkr-state-pulse],[data-ibkr-step-complete] *,[data-ibkr-step-motion],[data-ibkr-step-motion] *,[data-ibkr-step-line]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-header-broadcast-track]{animation:none!important;transform:none!important}}
[data-header-broadcast-viewport]:hover [data-header-broadcast-track],[data-header-broadcast-viewport]:focus-within [data-header-broadcast-track]{animation-play-state:paused!important}
`;

const WATCHLISTS_QUERY_KEY = ["/api/watchlists"];
const SIGNAL_MONITOR_DISPLAY_POLL_MS = 15_000;
const SIGNAL_MATRIX_TIMEFRAMES = ["2m", "5m", "15m"];
const OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS = 150;
const OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS = 250;
const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;
const WATCHLIST_SIDEBAR_WIDTH_MIN = 196;
const WATCHLIST_SIDEBAR_WIDTH_MAX = 320;
const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;
const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;
const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;
const STARTUP_PROTECTION_COOLDOWN_MS = 8_000;
const SIGNAL_MONITOR_BACKGROUND_RESUME_DELAY_MS = 3_000;
const SIGNAL_MATRIX_BACKGROUND_RESUME_DELAY_MS = 6_000;
const INITIAL_MARKET_DATA_WATCHLIST_LIMIT = 8;
const OPEN_POSITION_MARKET_DATA_LIMIT = 16;
const RECENT_SIGNAL_QUOTE_PIN_LIMIT = 4;
const RECENT_SIGNAL_QUOTE_PIN_MS = 30 * 60_000;
const SCREEN_SHELL_WARM_MOUNT_IDLE_DELAY_MS = 2_000;
const SCREEN_SHELL_WARM_MOUNT_IDLE_STAGGER_MS = 700;

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

const resolveRecentSignalMarketDataSymbols = (
  states = [],
  nowMs = Date.now(),
) => {
  const cutoffMs = nowMs - RECENT_SIGNAL_QUOTE_PIN_MS;
  return states
    .filter((state) => {
      if (!state || state.active === false) return false;
      if (state.fresh) return true;
      const signalAt = Date.parse(state.currentSignalAt || "");
      return Number.isFinite(signalAt) && signalAt >= cutoffMs;
    })
    .sort((left, right) => {
      const leftFresh = left?.fresh ? 1 : 0;
      const rightFresh = right?.fresh ? 1 : 0;
      if (leftFresh !== rightFresh) return rightFresh - leftFresh;
      return (
        (Date.parse(right?.currentSignalAt || "") || 0) -
        (Date.parse(left?.currentSignalAt || "") || 0)
      );
    })
    .map((state) => normalizeTickerSymbol(state?.symbol))
    .filter(Boolean)
    .filter((symbol, index, symbols) => symbols.indexOf(symbol) === index)
    .slice(0, RECENT_SIGNAL_QUOTE_PIN_LIMIT);
};

const resolveQuoteStreamGateReason = ({
  pageVisible,
  workspaceLeader,
  sessionMetadataSettled,
  brokerConfigured,
  brokerAuthenticated,
  quoteStreamEnabled,
}) => {
  if (!pageVisible) return "page-hidden";
  if (!workspaceLeader) return "workspace-passive";
  if (!sessionMetadataSettled) return "session-not-ready";
  if (!brokerConfigured) return "ibkr-not-configured";
  if (!brokerAuthenticated) return "ibkr-not-ready";
  if (!quoteStreamEnabled) return "runtime-disabled";
  return null;
};

const publishWatchlistQuoteStreamDiagnostics = (snapshot) => {
  if (typeof window === "undefined") return;
  window.__PYRUS_WATCHLIST_QUOTE_STREAM_DIAGNOSTICS__ = snapshot;
};

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

const readWarmupTestOverrides = () => {
  if (typeof window === "undefined") {
    return {
      disableOperationalCodePreload: false,
      disableHiddenScreenWarmMount: false,
      disableBackgroundDataWarmup: false,
      disableResearchWorkspacePreload: false,
    };
  }

  const source =
    window.__PYRUS_PERF_WARMUP_OVERRIDES__ ||
    window.__PYRUS_PERF_WARMUP_OVERRIDES__ ||
    {};
  const overrides =
    source && typeof source === "object" && !Array.isArray(source)
      ? source
      : {};

  return {
    disableOperationalCodePreload:
      overrides.disableOperationalCodePreload === true,
    disableHiddenScreenWarmMount:
      overrides.disableHiddenScreenWarmMount === true,
    disableBackgroundDataWarmup:
      overrides.disableBackgroundDataWarmup === true,
    disableResearchWorkspacePreload:
      overrides.disableResearchWorkspacePreload === true,
  };
};

const publishWarmupSnapshot = (snapshot) => {
  if (typeof window === "undefined") {
    return;
  }
  window.__PYRUS_PERF_WARMUP_SNAPSHOT__ = snapshot;
  window.__PYRUS_PERF_WARMUP_SNAPSHOT__ = snapshot;
};

const platformNowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const EMPTY_SCREEN_READINESS = {
  frameReady: false,
  criticalReady: false,
  derivedReady: false,
  backgroundAllowed: false,
};

const EMPTY_BACKGROUND_RESUME_READY = {
  screen: null,
  signalDisplay: false,
  signalMatrix: false,
};

const resolveOpenPositionMarketDataSymbol = (position) => {
  const normalized = normalizeTickerSymbol(
    position?.marketDataSymbol ||
      position?.optionContract?.underlying ||
      position?.underlyingMarket?.symbol ||
      position?.symbol,
  );
  return normalized && !normalized.startsWith("TWSOPT:") ? normalized : "";
};

const openPositionMarketDataWeight = (position) => {
  const marketValue = Math.abs(Number(position?.marketValue));
  if (Number.isFinite(marketValue)) return marketValue;

  const pnl = Math.abs(Number(position?.unrealizedPnl));
  if (Number.isFinite(pnl)) return pnl;

  const quantity = Math.abs(Number(position?.quantity));
  return Number.isFinite(quantity) ? quantity : 0;
};

const isOpenMarketDataPosition = (position) => {
  const quantity = Number(position?.quantity);
  return !Number.isFinite(quantity) || Math.abs(quantity) > 1e-9;
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
  const bootProgress = useBootProgress();
  const pageVisible = usePageVisible();
  const workspaceLeadership = useWorkspaceLeadership({
    artifactId: "artifacts/pyrus",
  });
  const workspaceLeader = Boolean(workspaceLeadership.isLeader);
  const platformWorkVisible = Boolean(pageVisible && workspaceLeader);
  const viewport = useViewport();
  const isPhone = viewport.flags.isPhone;
  const memoryPressureSignal = useMemoryPressureMonitor();
  const userPreferences = useUserPreferences();
  const startupRefreshQueuedRef = useRef(false);
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
  const [firstScreenReady, setFirstScreenReady] = useState(false);
  const [startupProtectionActive, setStartupProtectionActive] = useState(true);
  const [screenWarmupPhase, setScreenWarmupPhase] = useState("initial");
  const [warmupSnapshotRevision, setWarmupSnapshotRevision] = useState(0);
  const [screenReadiness, setScreenReadiness] = useState({});
  const [backgroundResumeReady, setBackgroundResumeReady] = useState(
    EMPTY_BACKGROUND_RESUME_READY,
  );
  const activateScreen = useCallback((nextScreen) => {
    const normalizedScreen = nextScreen === "unusual" ? "flow" : nextScreen;
    if (!SCREEN_ID_SET.has(normalizedScreen)) {
      return;
    }
    setMountedScreens((current) =>
      current[normalizedScreen]
        ? current
        : { ...current, [normalizedScreen]: true },
    );
    setScreen(normalizedScreen);
  }, []);
  useEffect(() => {
    [
      "session",
      "watchlists",
      "accounts",
      "signal-profile",
      "signal-state",
      "first-screen",
    ].forEach((taskId) => startBootProgressTask(taskId));
  }, []);
  const [sym, setSym] = useState(_initialState.sym || "SPY");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    _initialState.sidebarCollapsed || false,
  );
  const [watchlistSidebarWidth, setWatchlistSidebarWidth] = useState(() => {
    const persistedWidth = Number(_initialState.watchlistSidebarWidth);
    return Number.isFinite(persistedWidth)
      ? clampNumber(
          persistedWidth,
          WATCHLIST_SIDEBAR_WIDTH_MIN,
          WATCHLIST_SIDEBAR_WIDTH_MAX,
        )
      : WATCHLIST_SIDEBAR_WIDTH_DEFAULT;
  });
  const [activitySidebarCollapsed, setActivitySidebarCollapsed] = useState(
    _initialState.activitySidebarCollapsed || false,
  );
  const [activitySidebarWidth, setActivitySidebarWidth] = useState(() => {
    const persistedWidth = Number(
      _initialState.activitySidebarWidth ?? _initialState.marketActivityPanelWidth,
    );
    return Number.isFinite(persistedWidth)
      ? clampNumber(
          persistedWidth,
          ACTIVITY_SIDEBAR_WIDTH_MIN,
          ACTIVITY_SIDEBAR_WIDTH_MAX,
        )
      : ACTIVITY_SIDEBAR_WIDTH_DEFAULT;
  });
  const [marketUnusualThreshold, setMarketUnusualThreshold] = useState(() => {
    const stored = Number(_initialState.marketUnusualThreshold);
    return Number.isFinite(stored) && stored > 0
      ? clampNumber(stored, 0.1, 100)
      : 1;
  });
  const [theme, setTheme] = useState(() => {
    const initialTheme = resolveEffectiveThemeFromState(_initialState);
    setCurrentTheme(initialTheme);
    return initialTheme;
  });
  const [, setUiPreferenceRevision] = useState(0);
  const appearancePreferences = userPreferences.preferences?.appearance || {};
  const preferredTheme = appearancePreferences.theme;
  const preferredScale = appearancePreferences.scale;
  const preferredDensity = appearancePreferences.density;
  const preferredReducedMotion = appearancePreferences.reducedMotion;
  const preferredAccentPreset = appearancePreferences.accentPreset;
  const maskAccountValues = useMemo(
    () =>
      Boolean(
        userPreferences.preferences?.appearance?.maskBalances ||
          userPreferences.preferences?.privacy?.hideAccountValues,
      ),
    [
      userPreferences.preferences?.appearance?.maskBalances,
      userPreferences.preferences?.privacy?.hideAccountValues,
    ],
  );
  const [activeWatchlistId, setActiveWatchlistId] = useState(
    _initialState.activeWatchlistId || null,
  );
  const [selectedAccountId, setSelectedAccountId] = useState(
    _initialState.selectedAccountId || null,
  );
  const warmupTestOverrides = useMemo(readWarmupTestOverrides, []);
  const bootScreenShellWarmMountCompleteRef = useRef(false);
  const screenCodePreloadStartedRef = useRef(false);
  const screenCodePreloadCompleteRef = useRef(false);
  const screenShellWarmMountCompleteRef = useRef(false);
  const researchWorkspaceCodePreloadCompleteRef = useRef(false);
  const researchWorkspaceDataPreloadCompleteRef = useRef(false);
  const warmupTimelineBaseMsRef = useRef(platformNowMs());
  const warmupTimelineRef = useRef({});
  const markWarmupTimeline = useCallback((key) => {
    if (!key || warmupTimelineRef.current[key] != null) {
      return;
    }
    warmupTimelineRef.current = {
      ...warmupTimelineRef.current,
      [key]: Math.max(
        0,
        Math.round(platformNowMs() - warmupTimelineBaseMsRef.current),
      ),
    };
    setWarmupSnapshotRevision((revision) => revision + 1);
  }, []);
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

  const handleScreenReadiness = useCallback((screenId, patch = {}) => {
    if (!screenId) return;
    setScreenReadiness((current) => {
      const previous = current[screenId] || EMPTY_SCREEN_READINESS;
      const next = {
        frameReady:
          patch.frameReady == null
            ? previous.frameReady
            : Boolean(patch.frameReady) || previous.frameReady,
        criticalReady:
          patch.criticalReady == null
            ? previous.criticalReady
            : Boolean(patch.criticalReady),
        derivedReady:
          patch.derivedReady == null
            ? previous.derivedReady
            : Boolean(patch.derivedReady),
        backgroundAllowed:
          patch.backgroundAllowed == null
            ? previous.backgroundAllowed
            : Boolean(patch.backgroundAllowed),
      };

      if (next.derivedReady || next.backgroundAllowed) {
        next.criticalReady = true;
      }

      if (
        previous.frameReady === next.frameReady &&
        previous.criticalReady === next.criticalReady &&
        previous.derivedReady === next.derivedReady &&
        previous.backgroundAllowed === next.backgroundAllowed
      ) {
        return current;
      }

      return {
        ...current,
        [screenId]: {
          ...next,
          updatedAt: Date.now(),
        },
      };
    });
  }, []);

  const updateBackgroundResumeReady = useCallback((key, value) => {
    setBackgroundResumeReady((current) =>
      current.screen === screen && current[key] === value
        ? current
        : { ...current, screen, [key]: value },
    );
  }, [screen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleScreenReady = (event) => {
      setFirstScreenReady(true);
      markWarmupTimeline("firstScreenReadyAtMs");
      const readyScreenId = event?.detail?.screenId;
      completeBootProgressTask("first-screen", {
        detail: readyScreenId
          ? `${readyScreenId} screen ready`
          : "First screen ready",
      });
      if (readyScreenId) {
        if (readyScreenId === screen) {
          setScreenWarmupPhase("ready");
          markWarmupTimeline("screenWarmupReadyAtMs");
        }
        handleScreenReadiness(readyScreenId, {
          frameReady: true,
        });
      }
    };
    window.addEventListener(SCREEN_READY_EVENT, handleScreenReady);
    if (hasPyrusFirstScreenReady()) {
      setFirstScreenReady(true);
      setScreenWarmupPhase("ready");
      markWarmupTimeline("firstScreenReadyAtMs");
      markWarmupTimeline("screenWarmupReadyAtMs");
      completeBootProgressTask("first-screen", {
        detail: "First screen ready",
      });
    }

    return () => {
      window.removeEventListener(SCREEN_READY_EVENT, handleScreenReady);
    };
  }, [handleScreenReadiness, markWarmupTimeline, screen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    if (!firstScreenReady || !platformWorkVisible) {
      setStartupProtectionActive(true);
      return undefined;
    }

    setStartupProtectionActive(true);
    const timer = window.setTimeout(
      () => setStartupProtectionActive(false),
      STARTUP_PROTECTION_COOLDOWN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [firstScreenReady, platformWorkVisible]);

  useEffect(() => {
    setBackgroundResumeReady({ ...EMPTY_BACKGROUND_RESUME_READY, screen });
  }, [pageVisible, screen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const getMemoryDiagnostics = () => {
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
    window.__PYRUS_MEMORY_DIAGNOSTICS__ = getMemoryDiagnostics;
    window.__PYRUS_MEMORY_DIAGNOSTICS__ = getMemoryDiagnostics;

    return () => {
      if (window.__PYRUS_MEMORY_DIAGNOSTICS__ === getMemoryDiagnostics) {
        delete window.__PYRUS_MEMORY_DIAGNOSTICS__;
      }
      if (window.__PYRUS_MEMORY_DIAGNOSTICS__ === getMemoryDiagnostics) {
        delete window.__PYRUS_MEMORY_DIAGNOSTICS__;
      }
    };
  }, [queryClient]);

  const sessionQuery = useGetSession({
    query: {
      staleTime: 5_000,
      refetchInterval: pageVisible ? 5_000 : false,
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
      refetchInterval: pageVisible ? 60_000 : false,
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
  const activeScreenReadiness =
    screenReadiness[screen] || EMPTY_SCREEN_READINESS;
  const activeScreenFrameReady = Boolean(
    activeScreenReadiness.frameReady,
  );
  const activeScreenCriticalReady = Boolean(
    activeScreenReadiness.criticalReady,
  );
  const activeScreenBackgroundAllowed = Boolean(
    activeScreenReadiness.backgroundAllowed,
  );
  const backgroundDataWarmupEnabled = Boolean(
    workspaceLeader &&
      !isPhone &&
      !warmupTestOverrides.disableBackgroundDataWarmup,
  );
  const activeScreenBackgroundDataAllowed = Boolean(
    activeScreenBackgroundAllowed && backgroundDataWarmupEnabled,
  );
  const frameAuxiliaryDataEnabled = Boolean(
    platformWorkVisible &&
      sessionMetadataSettled &&
      activeScreenFrameReady &&
      (backgroundDataWarmupEnabled || isPhone),
  );
  useEffect(() => {
    if (!platformWorkVisible || !activeScreenCriticalReady) {
      updateBackgroundResumeReady("signalDisplay", false);
      return undefined;
    }

    const timer = window.setTimeout(
      () => updateBackgroundResumeReady("signalDisplay", true),
      SIGNAL_MONITOR_BACKGROUND_RESUME_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    activeScreenCriticalReady,
    platformWorkVisible,
    screen,
    updateBackgroundResumeReady,
  ]);
  useEffect(() => {
    if (
      !platformWorkVisible ||
      !activeScreenBackgroundDataAllowed ||
      screenWarmupPhase !== "ready"
    ) {
      updateBackgroundResumeReady("signalMatrix", false);
      return undefined;
    }

    const timer = window.setTimeout(
      () => updateBackgroundResumeReady("signalMatrix", true),
      SIGNAL_MATRIX_BACKGROUND_RESUME_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    activeScreenBackgroundDataAllowed,
    platformWorkVisible,
    screen,
    screenWarmupPhase,
    updateBackgroundResumeReady,
  ]);
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
  const memoryPressureLevel = memoryPressureSignal?.level || "normal";
  const platformPressureCaps = useMemo(
    () => buildPlatformPressureCaps(memoryPressureLevel),
    [memoryPressureLevel],
  );
  const memoryBlocksOperationalPreload = memoryPressureLevel === "critical";
  const memoryAllowsBackgroundWarmup = Boolean(
    memoryPressureObserved && memoryPressureSignal?.level === "normal",
  );
  const memoryAllowsIdlePrefetch = Boolean(
    firstScreenReady &&
      !startupProtectionActive &&
      memoryAllowsBackgroundWarmup &&
      backgroundDataWarmupEnabled,
  );
  const operationalCodePreloadReady = Boolean(
    platformWorkVisible &&
      firstScreenReady &&
      !startupProtectionActive &&
      !isPhone &&
      !warmupTestOverrides.disableOperationalCodePreload,
  );
  const screenCodePreloadReady = operationalCodePreloadReady;
  const backgroundScreenPreloadReady = Boolean(
    operationalCodePreloadReady &&
      sessionMetadataSettled &&
      memoryAllowsBackgroundWarmup,
  );
  const hiddenScreenPreloadPolicy = useMemo(
    () =>
      buildPlatformWorkSchedule({
        pageVisible: platformWorkVisible,
        sessionMetadataSettled,
        activeScreen: screen,
        screenWarmupPhase,
        startupProtectionActive,
        memoryPressure: memoryPressureSignal,
        mobileViewport: isPhone,
      }).hiddenScreenPreload,
    [
      isPhone,
      memoryPressureSignal,
      platformWorkVisible,
      screen,
      screenWarmupPhase,
      sessionMetadataSettled,
      startupProtectionActive,
    ],
  );
  const hiddenScreenWarmMountAllowed = Boolean(
    hiddenScreenPreloadPolicy.mountScreens &&
      !warmupTestOverrides.disableHiddenScreenWarmMount,
  );
  useEffect(() => {
    if (
      activeScreenBackgroundDataAllowed &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive
    ) {
      markWarmupTimeline("backgroundDataWarmupGateOpenedAtMs");
    }
  }, [
    activeScreenBackgroundDataAllowed,
    markWarmupTimeline,
    screenWarmupPhase,
    startupProtectionActive,
  ]);
  const preloadCalendarWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 14);
    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
    };
  }, []);
  const visibleWatchlistMarketDataSymbols = useMemo(
    () => watchlistSymbols.slice(0, INITIAL_MARKET_DATA_WATCHLIST_LIMIT),
    [watchlistSymbols],
  );
  const broadMarketDataSymbols = useMemo(() => {
    const limit = platformPressureCaps.broadMarketSymbolLimit;
    if (limit === 0) {
      return [];
    }
    return limit == null ? watchlistSymbols : watchlistSymbols.slice(0, limit);
  }, [platformPressureCaps.broadMarketSymbolLimit, watchlistSymbols]);
  const broadMarketDataHydrationReady = Boolean(
    platformWorkVisible &&
      activeScreenBackgroundDataAllowed &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive &&
      !memoryBlocksOperationalPreload &&
      platformPressureCaps.broadMarketSymbolLimit !== 0,
  );
  const quoteSymbols = useMemo(() => {
    return [
      ...new Set(
        [
          sym,
          ...HEADER_KPI_SYMBOLS,
          ...visibleWatchlistMarketDataSymbols,
          ...(broadMarketDataHydrationReady ? broadMarketDataSymbols : []),
          ...(marketScreenActive && broadMarketDataHydrationReady
            ? MARKET_SNAPSHOT_SYMBOLS
            : []),
        ].filter(Boolean),
      ),
    ];
  }, [
    broadMarketDataHydrationReady,
    broadMarketDataSymbols,
    marketScreenActive,
    sym,
    visibleWatchlistMarketDataSymbols,
  ]);
  const sparklineSymbols = useMemo(() => {
    const indexSymbols =
      marketScreenActive && broadMarketDataHydrationReady
        ? INDICES.map((item) => item.sym)
        : [];
    return [
      ...new Set(
        [
          sym,
          ...visibleWatchlistMarketDataSymbols,
          ...HEADER_KPI_SYMBOLS,
          ...(broadMarketDataHydrationReady ? broadMarketDataSymbols : []),
          ...indexSymbols,
        ].filter(Boolean),
      ),
    ];
  }, [
    broadMarketDataHydrationReady,
    broadMarketDataSymbols,
    marketScreenActive,
    sym,
    visibleWatchlistMarketDataSymbols,
    watchlistSymbols,
  ]);
  const streamedAggregateSymbols = useMemo(
    () => [
      ...new Set(
        [
          sym,
          ...HEADER_KPI_SYMBOLS,
          ...visibleWatchlistMarketDataSymbols,
          ...(broadMarketDataHydrationReady ? broadMarketDataSymbols : []),
          ...(marketScreenActive && broadMarketDataHydrationReady
            ? MARKET_SNAPSHOT_SYMBOLS
            : []),
        ]
          .map(normalizeTickerSymbol)
          .filter(Boolean),
      ),
    ],
    [
      broadMarketDataHydrationReady,
      broadMarketDataSymbols,
      marketScreenActive,
      sym,
      visibleWatchlistMarketDataSymbols,
      watchlistSymbols,
    ],
  );
  const accountsQuery = useListAccounts(
    { mode: sessionQuery.data?.environment || "paper" },
    {
      query: {
        enabled: Boolean(sessionQuery.data),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const accounts = accountsQuery.data?.accounts || [];
  useEffect(() => {
    if (!sessionMetadataSettled) {
      return;
    }
    if (sessionQuery.isError) {
      failBootProgressTask("session", sessionQuery.error || "Session unavailable", {
        detail: "Session unavailable",
      });
      return;
    }
    completeBootProgressTask("session", { detail: "Session loaded" });
  }, [sessionMetadataSettled, sessionQuery.error, sessionQuery.isError]);
  useEffect(() => {
    if (!watchlistsQuery.data && !watchlistsQuery.isFetched && !watchlistsQuery.isError) {
      return;
    }
    if (watchlistsQuery.isError) {
      failBootProgressTask(
        "watchlists",
        watchlistsQuery.error || "Watchlists unavailable",
        { detail: "Watchlists unavailable" },
      );
      return;
    }
    completeBootProgressTask("watchlists", { detail: "Watchlists loaded" });
  }, [
    watchlistsQuery.data,
    watchlistsQuery.error,
    watchlistsQuery.isError,
    watchlistsQuery.isFetched,
  ]);
  useEffect(() => {
    if (!sessionQuery.data && sessionMetadataSettled) {
      skipBootProgressTasks(["accounts"], "Accounts skipped without a session");
      return;
    }
    if (!sessionQuery.data) {
      return;
    }
    if (!accountsQuery.data && !accountsQuery.isFetched && !accountsQuery.isError) {
      return;
    }
    if (accountsQuery.isError) {
      failBootProgressTask("accounts", accountsQuery.error || "Accounts unavailable", {
        detail: "Accounts unavailable",
      });
      return;
    }
    completeBootProgressTask("accounts", { detail: "Accounts loaded" });
  }, [
    accountsQuery.data,
    accountsQuery.error,
    accountsQuery.isError,
    accountsQuery.isFetched,
    sessionMetadataSettled,
    sessionQuery.data,
  ]);
  const marketStockAggregateStreamingEnabled = Boolean(
    sessionQuery.data?.configured?.ibkr &&
      sessionQuery.data?.ibkrBridge?.authenticated &&
      sessionQuery.data?.ibkrBridge?.healthFresh !== false &&
      marketScreenActive,
  );

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
      const normalizedKind = normalizeToastKind(kind);
      captureToast({ title, body, kind: normalizedKind });
      setToasts((prev) => [
        ...prev,
        { id, title, body, kind: normalizedKind, leaving: false },
      ]);
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
  // The platform signal lane drives the shadow algo scanner, so keep it pinned
  // to the paper signal-monitor profile instead of the broker session mode.
  const signalMonitorEnvironment = "paper";
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(
    session?.ibkrBridge?.authenticated &&
      session?.ibkrBridge?.healthFresh !== false,
  );
  const gatewayTradingReadiness = resolveGatewayTradingReadiness(session);
  const gatewayTradingReady = gatewayTradingReadiness.ready;
  const gatewayTradingMessage = gatewayTradingReadiness.message;
  const brokerStreamFreshness = useBrokerStreamFreshnessStatus();
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
  const effectiveGatewayTradingBlockReason =
    gatewayTradingReady && !accountOrderStreamsFresh ? "streams_stale" : "gateway";
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
    setBrokerStockAggregateStreamPaused(!platformWorkVisible);
    return () => {
      setBrokerStockAggregateStreamPaused(false);
    };
  }, [platformWorkVisible]);

  useEffect(() => {
    if (
      startupRefreshQueuedRef.current ||
      !platformWorkVisible ||
      !firstScreenReady ||
      startupProtectionActive
    ) {
      return;
    }
    startupRefreshQueuedRef.current = true;

    queryClient.invalidateQueries({ queryKey: WATCHLISTS_QUERY_KEY });
    queryClient.invalidateQueries({
      queryKey: getGetSignalMonitorStateQueryKey({
        environment: signalMonitorEnvironment,
      }),
    });

    const cleanupTasks = [];
    const queueInvalidation = (delayMs, invalidate, timeoutMs = 4_000) => {
      const timerId = window.setTimeout(() => {
        const cancelIdle = scheduleIdleWork(invalidate, timeoutMs);
        cleanupTasks.push(cancelIdle);
      }, delayMs);
      cleanupTasks.push(() => window.clearTimeout(timerId));
    };

    queueInvalidation(250, () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
    }, 2_000);
    queueInvalidation(750, () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bars"] });
      queryClient.invalidateQueries({ queryKey: ["market-sparklines"] });
      queryClient.invalidateQueries({
        queryKey: ["market-performance-baselines"],
      });
    }, 5_000);
    queueInvalidation(1_500, () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flow/events"] });
      queryClient.invalidateQueries({ queryKey: ["trade-market-depth"] });
      queryClient.invalidateQueries({
        queryKey: getListSignalMonitorEventsQueryKey({
          environment: signalMonitorEnvironment,
          limit: 100,
        }),
      });
    }, 5_000);
    queueInvalidation(2_500, () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/expirations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/chains"] });
      queryClient.invalidateQueries({ queryKey: ["trade-option-chain"] });
    }, 6_000);

    return () => {
      cleanupTasks.forEach((cleanup) => cleanup());
    };
  }, [
    firstScreenReady,
    platformWorkVisible,
    queryClient,
    signalMonitorEnvironment,
    startupProtectionActive,
  ]);

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
    if (
      !screenCodePreloadReady ||
      screenCodePreloadStartedRef.current ||
      screenCodePreloadCompleteRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const preloadOrder = SCREEN_MODULE_PRELOAD_ORDER;
    markWarmupTimeline("screenCodePreloadQueuedAtMs");
    screenCodePreloadStartedRef.current = true;

    void Promise.allSettled(
      preloadOrder.map((screenId, index) =>
        new Promise((resolve, reject) => {
          const timerId = window.setTimeout(
            () => {
              if (cancelled) {
                resolve(null);
                return;
              }
              preloadScreenModule(screenId).then(resolve, reject);
            },
            OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS +
              OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS * index,
          );
          timers.push(timerId);
        }),
      ),
    ).then((settled) => {
      if (!cancelled && settled.every((entry) => entry.status === "fulfilled")) {
        screenCodePreloadCompleteRef.current = true;
        markWarmupTimeline("screenCodePreloadCompleteAtMs");
      }
    });

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      if (!screenCodePreloadCompleteRef.current) {
        screenCodePreloadStartedRef.current = false;
      }
    };
  }, [
    screenCodePreloadReady,
    markWarmupTimeline,
  ]);

  useEffect(() => {
    if (isPhone) {
      skipBootProgressTasks(
        BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
        "Screen preloads skipped on phone layout",
      );
      return;
    }
    if (!pageVisible && firstScreenReady && !startupProtectionActive) {
      skipBootProgressTasks(
        BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
        "Screen preloads skipped while workspace is inactive",
      );
      return;
    }
    if (warmupTestOverrides.disableOperationalCodePreload) {
      skipBootProgressTasks(
        BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
        "Screen preloads disabled by warmup override",
      );
      return;
    }
    if (
      firstScreenReady &&
      !startupProtectionActive &&
      !backgroundScreenPreloadReady
    ) {
      skipBootProgressTasks(
        BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
        "Screen preload gate did not open during startup",
      );
    }
  }, [
    backgroundScreenPreloadReady,
    firstScreenReady,
    isPhone,
    pageVisible,
    startupProtectionActive,
    warmupTestOverrides.disableOperationalCodePreload,
  ]);

  useEffect(() => {
    if (
      !pageVisible ||
      isPhone ||
      !firstScreenReady ||
      !backgroundScreenPreloadReady ||
      bootScreenShellWarmMountCompleteRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    let idleCleanup = null;
    markWarmupTimeline("bootScreenShellWarmMountQueuedAtMs");
    idleCleanup = scheduleIdleWork(() => {
      if (cancelled) {
        return;
      }
      void Promise.allSettled(
        BOOT_SCREEN_MODULE_PRELOAD_ORDER.map((screenId) =>
          preloadScreenModule(screenId),
        ),
      ).then(() => {
        if (cancelled) {
          return;
        }
        setMountedScreens((current) => {
          const next = { ...current };
          BOOT_SCREEN_MODULE_PRELOAD_ORDER.forEach((screenId) => {
            next[screenId] = true;
          });
          return next;
        });
        bootScreenShellWarmMountCompleteRef.current = true;
        markWarmupTimeline("bootScreenShellWarmMountCompleteAtMs");
      });
    }, 6_000);

    return () => {
      cancelled = true;
      idleCleanup?.();
    };
  }, [
    backgroundScreenPreloadReady,
    firstScreenReady,
    isPhone,
    markWarmupTimeline,
    pageVisible,
  ]);

  useEffect(() => {
    if (
      !pageVisible ||
      isPhone ||
      screenWarmupPhase !== "ready" ||
      !hiddenScreenWarmMountAllowed ||
      memoryBlocksOperationalPreload ||
      screenShellWarmMountCompleteRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const idleCleanups = [];
    const warmMountOrder = SCREEN_SHELL_WARM_MOUNT_ORDER.filter(
      (screenId) => screenId !== screen,
    );
    markWarmupTimeline("hiddenScreenWarmMountQueuedAtMs");

    warmMountOrder.forEach((screenId, index) => {
      const timerId = window.setTimeout(
        () => {
          if (cancelled) {
            return;
          }
          const cancelIdle = scheduleIdleWork(() => {
            if (cancelled) {
              return;
            }
            setMountedScreens((current) =>
              current[screenId] ? current : { ...current, [screenId]: true },
            );
          }, 12_000);
          idleCleanups.push(cancelIdle);
        },
        SCREEN_SHELL_WARM_MOUNT_IDLE_DELAY_MS +
          SCREEN_SHELL_WARM_MOUNT_IDLE_STAGGER_MS * index,
      );
      timers.push(timerId);
    });

    const completeTimer = window.setTimeout(
      () => {
        screenShellWarmMountCompleteRef.current = true;
        markWarmupTimeline("hiddenScreenWarmMountCompleteAtMs");
      },
      SCREEN_SHELL_WARM_MOUNT_IDLE_DELAY_MS +
        SCREEN_SHELL_WARM_MOUNT_IDLE_STAGGER_MS * warmMountOrder.length +
        12_000,
    );
    timers.push(completeTimer);

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      idleCleanups.forEach((cleanup) => cleanup());
      if (!screenShellWarmMountCompleteRef.current) {
        screenShellWarmMountCompleteRef.current = false;
      }
    };
  }, [
    hiddenScreenWarmMountAllowed,
    memoryBlocksOperationalPreload,
    isPhone,
    markWarmupTimeline,
    pageVisible,
    screen,
    screenWarmupPhase,
  ]);

  useEffect(() => {
    if (
      !operationalCodePreloadReady ||
      screenWarmupPhase !== "ready" ||
      !memoryAllowsBackgroundWarmup ||
      warmupTestOverrides.disableResearchWorkspacePreload ||
      researchWorkspaceCodePreloadCompleteRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const idleCleanups = [];
    const queueIdleCodePreload = (delayMs, callback, timeoutMs = 10_000) => {
      const timerId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        const cancelIdle = scheduleIdleWork(() => {
          if (!cancelled) {
            callback();
          }
        }, timeoutMs);
        idleCleanups.push(cancelIdle);
      }, delayMs);
      timers.push(timerId);
    };

    researchWorkspaceCodePreloadCompleteRef.current = true;
    markWarmupTimeline("researchWorkspaceCodePreloadQueuedAtMs");
    queueIdleCodePreload(2_500, () => {
      if (cancelled) {
        return;
      }
      preloadDynamicImport(
        () => import("../research/PhotonicsObservatory.jsx"),
        { label: "PhotonicsObservatoryPrefetch" },
      );
      markWarmupTimeline("researchWorkspaceCodePreloadFiredAtMs");
    });

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      idleCleanups.forEach((cleanup) => cleanup());
    };
  }, [
    markWarmupTimeline,
    memoryAllowsBackgroundWarmup,
    operationalCodePreloadReady,
    screenWarmupPhase,
  ]);

  useEffect(() => {
    if (
      !operationalCodePreloadReady ||
      screenWarmupPhase !== "ready" ||
      !memoryAllowsIdlePrefetch ||
      warmupTestOverrides.disableResearchWorkspacePreload ||
      researchWorkspaceDataPreloadCompleteRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const idleCleanups = [];
    const queueIdleDataPreload = (delayMs, callback, timeoutMs = 8_000) => {
      const timerId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        const cancelIdle = scheduleIdleWork(() => {
          if (!cancelled) {
            callback();
          }
        }, timeoutMs);
        idleCleanups.push(cancelIdle);
      }, delayMs);
      timers.push(timerId);
    };

    researchWorkspaceDataPreloadCompleteRef.current = true;
    markWarmupTimeline("researchWorkspaceDataPreloadQueuedAtMs");
    queueIdleDataPreload(4_000, () => {
      void import("../research/data/runtime.js")
        .then(({ loadResearchRuntimeMeta }) => loadResearchRuntimeMeta())
        .catch(() => {})
        .finally(() => markWarmupTimeline("researchWorkspaceMetaLoadedAtMs"));
    });
    queueIdleDataPreload(5_500, () => {
      void import("../research/data/runtime.js")
        .then(({ loadResearchThemeDataset }) => loadResearchThemeDataset("ai"))
        .catch(() => {})
        .finally(() => markWarmupTimeline("researchWorkspaceThemeLoadedAtMs"));
    });

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      idleCleanups.forEach((cleanup) => cleanup());
    };
  }, [
    markWarmupTimeline,
    memoryAllowsIdlePrefetch,
    operationalCodePreloadReady,
    screenWarmupPhase,
  ]);

  useEffect(() => {
    if (
      !sessionMetadataSettled ||
      !memoryAllowsIdlePrefetch ||
      !activeScreenBackgroundDataAllowed
    ) {
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

      if (
        screen === "research" &&
        researchConfigured &&
        preloadCalendarWindow.from &&
        preloadCalendarWindow.to
      ) {
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
      if (screen === "backtest") {
        queryClient.prefetchQuery(
          getListBacktestDraftStrategiesQueryOptions({
            query: {
              ...QUERY_DEFAULTS,
              retry: false,
              gcTime: 5 * 60_000,
            },
          }),
        );
      }
      if (screen === "algo") {
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
      }
      if (screen === "research") {
        preloadDynamicImport(
          () => import("../research/PhotonicsObservatory.jsx"),
          { label: "PhotonicsObservatoryPrefetch" },
        );
      }
    }, 1_000);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [
    environment,
    activeScreenBackgroundDataAllowed,
    memoryAllowsIdlePrefetch,
    preloadCalendarWindow,
    queryClient,
    researchConfigured,
    screen,
    sessionMetadataSettled,
    tradeWarmTicker,
  ]);
  const positionAlertsQuery = useListPositions(
    { accountId: primaryAccountId, mode: environment },
    {
      query: {
        enabled: Boolean(
          pageVisible &&
            activeScreenBackgroundAllowed &&
            backgroundDataWarmupEnabled &&
            screenWarmupPhase === "ready" &&
            !startupProtectionActive &&
            !memoryBlocksOperationalPreload &&
            brokerAuthenticated &&
            primaryAccountId,
        ),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const openPositionMarketDataSymbols = useMemo(() => {
    if (!brokerConfigured || !brokerAuthenticated || !primaryAccountId) {
      return [];
    }

    const symbols = [];
    const seen = new Set();
    [...(positionAlertsQuery.data?.positions || [])]
      .filter(isOpenMarketDataPosition)
      .sort(
        (left, right) =>
          openPositionMarketDataWeight(right) -
          openPositionMarketDataWeight(left),
      )
      .forEach((position) => {
        if (symbols.length >= OPEN_POSITION_MARKET_DATA_LIMIT) return;
        const symbol = resolveOpenPositionMarketDataSymbol(position);
        if (!symbol || seen.has(symbol)) return;
        seen.add(symbol);
        symbols.push(symbol);
      });
    return symbols;
  }, [
    brokerAuthenticated,
    brokerConfigured,
    positionAlertsQuery.data,
    primaryAccountId,
  ]);
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
  const watchlistsMutating =
    createWatchlistMutation.isPending ||
    updateWatchlistMutation.isPending ||
    deleteWatchlistMutation.isPending ||
    addWatchlistSymbolMutation.isPending ||
    removeWatchlistSymbolMutation.isPending ||
    reorderWatchlistMutation.isPending;
  const watchlistsBusy = useMemo(
    () => ({
      mutating: watchlistsMutating,
      totalAlerts,
      winAlerts,
      lossAlerts,
    }),
    [lossAlerts, totalAlerts, watchlistsMutating, winAlerts],
  );
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
  const signalMonitorParams = useMemo(
    () => ({ environment: signalMonitorEnvironment }),
    [signalMonitorEnvironment],
  );
  const signalMonitorEventsParams = useMemo(
    () => ({ environment: signalMonitorEnvironment, limit: 100 }),
    [signalMonitorEnvironment],
  );
  const signalMonitorProfileQuery = useGetSignalMonitorProfile(
    signalMonitorParams,
    {
      query: {
        staleTime: 60_000,
        refetchInterval: platformWorkVisible ? 60_000 : false,
        retry: false,
      },
    },
  );
  const signalMonitorProfile = signalMonitorProfileQuery.data || null;
  const signalMonitorProfileDegraded =
    isSignalMonitorDegradedProfile(signalMonitorProfile);
  const ibkrWorkPressure = useMemo(
    () => resolveIbkrWorkPressure(session?.ibkrBridge),
    [session?.ibkrBridge],
  );
  const workSchedule = useMemo(
    () =>
      buildPlatformWorkSchedule({
        pageVisible: platformWorkVisible,
        sessionMetadataSettled,
        activeScreen: screen,
        screenWarmupPhase,
        activeScreenBackgroundAllowed: activeScreenBackgroundDataAllowed,
        startupProtectionActive,
        ibkrWorkPressure,
        memoryPressure: memoryPressureSignal,
        brokerConfigured,
        brokerAuthenticated: Boolean(session?.ibkrBridge?.authenticated),
        mobileViewport: isPhone,
        automationEnabled: Boolean(
          signalMonitorProfile?.enabled && !signalMonitorProfileDegraded,
        ),
        tradingEnabled: Boolean(gatewayTradingReady),
      }),
    [
      brokerConfigured,
      gatewayTradingReady,
      ibkrWorkPressure,
      isPhone,
      memoryPressureSignal,
      platformWorkVisible,
      screen,
      screenWarmupPhase,
      startupProtectionActive,
      activeScreenBackgroundDataAllowed,
      sessionMetadataSettled,
      session?.ibkrBridge?.authenticated,
      signalMonitorProfileDegraded,
      signalMonitorProfile?.enabled,
    ],
  );
  useIbkrAccountSnapshotStream({
    accountId: null,
    mode: environment,
    enabled: workSchedule.streams.accountRealtime,
  });
  useIbkrOrderSnapshotStream({
    accountId: null,
    mode: environment,
    enabled: workSchedule.streams.accountRealtime,
  });
  useEffect(() => {
    setHydrationPressureState(workSchedule.hydrationPressure);
  }, [workSchedule.hydrationPressure]);
  useRuntimeWorkloadFlag("signal-monitor:profile", platformWorkVisible, {
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
  const signalWorkFastScreen = Boolean(
    marketScreenActive ||
      flowScreenActive ||
      screen === "trade" ||
      screen === "algo",
  );
  const signalMonitorDisplayPollMs = Math.min(
    signalMonitorPollMs,
    SIGNAL_MONITOR_DISPLAY_POLL_MS,
  );
  const signalMonitorRuntimePollMs = Math.max(
    signalWorkFastScreen
      ? signalMonitorDisplayPollMs
      : Math.max(signalMonitorPollMs, 60_000),
    platformPressureCaps.signalDisplayPollMinMs || 0,
  );
  const signalMonitorDisplayReady = Boolean(
    platformWorkVisible && firstScreenReady && signalMonitorProfile?.enabled,
  );
  const signalMonitorEventsReady = Boolean(
    signalMonitorDisplayReady &&
      backgroundResumeReady.screen === screen &&
      backgroundResumeReady.signalDisplay,
  );
  const signalMonitorStateQuery = useGetSignalMonitorState(
    signalMonitorParams,
    {
      query: {
        enabled: signalMonitorDisplayReady,
        staleTime: 15_000,
        refetchInterval: signalMonitorDisplayReady
          ? signalMonitorRuntimePollMs
          : false,
        retry: false,
      },
    },
  );
  const signalMonitorEventsQuery = useListSignalMonitorEvents(
    signalMonitorEventsParams,
    {
      query: {
        enabled: signalMonitorEventsReady,
        staleTime: 15_000,
        refetchInterval: signalMonitorEventsReady
          ? signalMonitorRuntimePollMs
          : false,
        retry: false,
      },
    },
  );
  useEffect(() => {
    if (
      !signalMonitorProfileQuery.data &&
      !signalMonitorProfileQuery.isFetched &&
      !signalMonitorProfileQuery.isError
    ) {
      return;
    }
    if (signalMonitorProfileQuery.isError) {
      failBootProgressTask(
        "signal-profile",
        signalMonitorProfileQuery.error || "Signal profile unavailable",
        { detail: "Signal profile unavailable" },
      );
      return;
    }
    completeBootProgressTask("signal-profile", {
      detail: "Signal profile loaded",
    });
  }, [
    signalMonitorProfileQuery.data,
    signalMonitorProfileQuery.error,
    signalMonitorProfileQuery.isError,
    signalMonitorProfileQuery.isFetched,
  ]);
  useEffect(() => {
    if (
      signalMonitorProfileQuery.data ||
      signalMonitorProfileQuery.isFetched ||
      signalMonitorProfileQuery.isError
    ) {
      if (!signalMonitorProfileQuery.data?.enabled) {
        skipBootProgressTasks(["signal-state"], "Signal monitor disabled");
        return;
      }
    }
    if (!signalMonitorDisplayReady) {
      return;
    }
    if (
      !signalMonitorStateQuery.data &&
      !signalMonitorStateQuery.isFetched &&
      !signalMonitorStateQuery.isError
    ) {
      return;
    }
    if (signalMonitorStateQuery.isError) {
      failBootProgressTask(
        "signal-state",
        signalMonitorStateQuery.error || "Signal state unavailable",
        { detail: "Signal state unavailable" },
      );
      return;
    }
    completeBootProgressTask("signal-state", { detail: "Signal state loaded" });
  }, [
    signalMonitorDisplayReady,
    signalMonitorProfileQuery.data,
    signalMonitorProfileQuery.isError,
    signalMonitorProfileQuery.isFetched,
    signalMonitorStateQuery.data,
    signalMonitorStateQuery.error,
    signalMonitorStateQuery.isError,
    signalMonitorStateQuery.isFetched,
  ]);
  const signalMonitorDegraded = Boolean(
    signalMonitorProfileDegraded ||
      isSignalMonitorDegradedProfile(signalMonitorStateQuery.data?.profile),
  );
  const signalMonitorRuntimeFallback = Boolean(
    isSignalMonitorRuntimeFallbackProfile(signalMonitorProfile) ||
      isSignalMonitorRuntimeFallbackProfile(signalMonitorStateQuery.data?.profile),
  );
  useRuntimeWorkloadFlag(
    "signal-monitor:display",
    signalMonitorDisplayReady,
    {
      kind: "poll",
      label: "Signal display",
      detail: `${Math.round(signalMonitorRuntimePollMs / 1000)}s`,
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
        queryClient.invalidateQueries({
          queryKey: getListSignalMonitorEventsQueryKey({
            environment: profile.environment,
            limit: 100,
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
                environment: signalMonitorEnvironment,
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
    timeframes: SIGNAL_MATRIX_TIMEFRAMES,
  }));
  const signalMatrixEvaluationInFlightRef = useRef(false);
  const signalMatrixRotationCursorRef = useRef(0);
  const signalMatrixLastPlanRef = useRef(null);
  const signalMatrixAutomaticRunCountRef = useRef(0);
  const signalMatrixUniverseRef = useRef([]);
  const signalMatrixStatesRef = useRef([]);
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
  const recentSignalMarketDataSymbols = useMemo(
    () => resolveRecentSignalMarketDataSymbols(signalMonitorStates),
    [signalMonitorStates],
  );
  const quoteStreamPinnedSymbols = useMemo(
    () =>
      [
        ...new Set(
          [
            sym,
            ...HEADER_KPI_SYMBOLS,
            ...(marketScreenActive ? MARKET_SNAPSHOT_SYMBOLS : []),
            ...visibleWatchlistMarketDataSymbols,
            ...openPositionMarketDataSymbols,
            ...recentSignalMarketDataSymbols,
          ]
            .map(normalizeTickerSymbol)
            .filter(Boolean),
        ),
      ],
    [
      marketScreenActive,
      openPositionMarketDataSymbols,
      recentSignalMarketDataSymbols,
      sym,
      visibleWatchlistMarketDataSymbols,
    ],
  );
  const [watchlistQuoteRotationCursor, setWatchlistQuoteRotationCursor] =
    useState(0);
  const [watchlistQuoteLastTouchedBySymbol, setWatchlistQuoteLastTouchedBySymbol] =
    useState({});
  const watchlistQuoteRotationBatch = useMemo(
    () =>
      buildWatchlistQuoteRotationBatch({
        watchlistSymbols,
        pinnedSymbols: quoteStreamPinnedSymbols,
        cursor: watchlistQuoteRotationCursor,
        batchSize: WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
      }),
    [
      quoteStreamPinnedSymbols,
      watchlistQuoteRotationCursor,
      watchlistSymbols,
    ],
  );
  const streamedQuoteSymbols = useMemo(
    () => watchlistQuoteRotationBatch.symbols,
    [watchlistQuoteRotationBatch.symbols],
  );
  const streamedQuoteSymbolsKey = useMemo(
    () => streamedQuoteSymbols.join(","),
    [streamedQuoteSymbols],
  );
  const quoteStreamGateReason = useMemo(
    () =>
      resolveQuoteStreamGateReason({
        pageVisible,
        workspaceLeader,
        sessionMetadataSettled,
        brokerConfigured,
        brokerAuthenticated: Boolean(session?.ibkrBridge?.authenticated),
        quoteStreamEnabled: workSchedule.streams.watchlistQuoteStream,
      }),
    [
      brokerConfigured,
      pageVisible,
      session?.ibkrBridge?.authenticated,
      sessionMetadataSettled,
      workspaceLeader,
      workSchedule.streams.watchlistQuoteStream,
    ],
  );
  useEffect(() => {
    if (
      quoteStreamGateReason ||
      watchlistQuoteRotationBatch.rotatingUniverseSize <= 0
    ) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setWatchlistQuoteRotationCursor((cursor) =>
        buildWatchlistQuoteRotationBatch({
          watchlistSymbols,
          pinnedSymbols: quoteStreamPinnedSymbols,
          cursor,
          batchSize: WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
        }).nextCursor,
      );
    }, WATCHLIST_QUOTE_STREAM_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [
    quoteStreamGateReason,
    quoteStreamPinnedSymbols,
    watchlistQuoteRotationBatch.rotatingUniverseSize,
    watchlistSymbols,
  ]);
  useEffect(() => {
    if (quoteStreamGateReason || streamedQuoteSymbols.length === 0) {
      return;
    }
    const universe = new Set(
      [...watchlistSymbols, ...streamedQuoteSymbols]
        .map(normalizeTickerSymbol)
        .filter(Boolean),
    );
    const touchedAt = new Date().toISOString();
    setWatchlistQuoteLastTouchedBySymbol((current) => {
      const next = {};
      Object.entries(current || {}).forEach(([symbol, value]) => {
        if (universe.has(symbol)) {
          next[symbol] = value;
        }
      });
      streamedQuoteSymbols.forEach((symbol) => {
        next[symbol] = touchedAt;
      });
      return next;
    });
  }, [quoteStreamGateReason, streamedQuoteSymbols.length, streamedQuoteSymbolsKey, watchlistSymbols]);
  const watchlistQuoteStreamDiagnostics = useMemo(
    () =>
      buildWatchlistQuoteRotationDiagnostics({
        batch: watchlistQuoteRotationBatch,
        watchlistSymbols,
        lastTouchedAtBySymbol: watchlistQuoteLastTouchedBySymbol,
        cycleWindowMs: WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
        disabledReason: quoteStreamGateReason,
      }),
    [
      quoteStreamGateReason,
      watchlistQuoteLastTouchedBySymbol,
      watchlistQuoteRotationBatch,
      watchlistSymbols,
    ],
  );
  useEffect(() => {
    publishWatchlistQuoteStreamDiagnostics(watchlistQuoteStreamDiagnostics);
    return () => {
      if (
        typeof window !== "undefined" &&
        window.__PYRUS_WATCHLIST_QUOTE_STREAM_DIAGNOSTICS__ ===
          watchlistQuoteStreamDiagnostics
      ) {
        delete window.__PYRUS_WATCHLIST_QUOTE_STREAM_DIAGNOSTICS__;
      }
    };
  }, [watchlistQuoteStreamDiagnostics]);
  const signalMatrixUniverseSymbols = useMemo(
    () =>
      [
        ...new Set(
          allWatchlistSymbolList
            .map((symbol) => normalizeTickerSymbol(symbol))
            .filter(Boolean),
        ),
      ],
    [allWatchlistSymbolList],
  );
  const signalMatrixPrioritySymbols = useMemo(
    () =>
      [
        ...new Set(
          [
            sym,
            ...watchlistSymbols,
            ...visibleWatchlistMarketDataSymbols,
            ...openPositionMarketDataSymbols,
            ...signalMonitorSymbols,
          ]
            .map((symbol) => normalizeTickerSymbol(symbol))
            .filter(Boolean),
        ),
      ],
    [
      openPositionMarketDataSymbols,
      signalMonitorSymbols,
      sym,
      visibleWatchlistMarketDataSymbols,
      watchlistSymbols,
    ],
  );
  const signalMatrixSymbolsKey = useMemo(
    () => signalMatrixUniverseSymbols.join(","),
    [signalMatrixUniverseSymbols],
  );
  const signalMatrixBackgroundReady = Boolean(
    backgroundResumeReady.screen === screen &&
      backgroundResumeReady.signalMatrix &&
      activeScreenBackgroundDataAllowed &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive,
  );
  useEffect(() => {
    const mountedScreenIds = Object.keys(mountedScreens).filter(
      (screenId) => mountedScreens[screenId],
    );
    const snapshot = {
      version: 1,
      activeScreen: screen,
      firstScreenReady,
      pageVisible,
      screenWarmupPhase,
      mountedScreens: mountedScreenIds,
      mountedScreenMap: mountedScreens,
      mountedScreenCount: mountedScreenIds.length,
      overrides: warmupTestOverrides,
      completions: {
        bootScreenShellWarmMountComplete:
          bootScreenShellWarmMountCompleteRef.current,
        screenCodePreloadComplete: screenCodePreloadCompleteRef.current,
        screenShellWarmMountComplete:
          screenShellWarmMountCompleteRef.current,
        researchWorkspaceCodePreloadComplete:
          researchWorkspaceCodePreloadCompleteRef.current,
        researchWorkspaceDataPreloadComplete:
          researchWorkspaceDataPreloadCompleteRef.current,
      },
      queues: {
        bootScreenShellWarmMountStarted:
          warmupTimelineRef.current.bootScreenShellWarmMountQueuedAtMs != null,
        bootScreenShellWarmMountCompleted:
          warmupTimelineRef.current.bootScreenShellWarmMountCompleteAtMs != null,
        screenCodePreloadStarted:
          warmupTimelineRef.current.screenCodePreloadQueuedAtMs != null,
        screenCodePreloadCompleted:
          warmupTimelineRef.current.screenCodePreloadCompleteAtMs != null,
        hiddenScreenWarmMountStarted:
          warmupTimelineRef.current.hiddenScreenWarmMountQueuedAtMs != null,
        hiddenScreenWarmMountCompleted:
          warmupTimelineRef.current.hiddenScreenWarmMountCompleteAtMs != null,
        backgroundDataWarmupGateOpened:
          warmupTimelineRef.current.backgroundDataWarmupGateOpenedAtMs != null,
        researchWorkspaceCodePreloadStarted:
          warmupTimelineRef.current.researchWorkspaceCodePreloadQueuedAtMs != null,
        researchWorkspaceCodePreloadFired:
          warmupTimelineRef.current.researchWorkspaceCodePreloadFiredAtMs != null,
        researchWorkspaceDataPreloadStarted:
          warmupTimelineRef.current.researchWorkspaceDataPreloadQueuedAtMs != null,
        researchWorkspaceMetaLoaded:
          warmupTimelineRef.current.researchWorkspaceMetaLoadedAtMs != null,
        researchWorkspaceThemeLoaded:
          warmupTimelineRef.current.researchWorkspaceThemeLoadedAtMs != null,
      },
      timelineMs: warmupTimelineRef.current,
      screenModulePreloads: getScreenModulePreloadSnapshot(),
      gates: {
        workspaceLeader,
        workspaceLeadershipReason: workspaceLeadership.reason,
        operationalCodePreloadReady,
        hiddenScreenWarmMountEnabled: hiddenScreenWarmMountAllowed,
        backgroundDataWarmupEnabled,
        activeScreenFrameReady,
        activeScreenBackgroundAllowed,
        activeScreenBackgroundDataAllowed,
        frameAuxiliaryDataEnabled,
        broadMarketDataHydrationReady,
        startupProtectionActive,
        memoryPressureObserved,
        memoryPressureLevel,
        memoryBlocksOperationalPreload,
        memoryAllowsIdlePrefetch,
        signalMonitorDisplayReady,
        signalMatrixBackgroundReady,
      },
      backgroundResumeReady,
      screenReadiness,
      warmupSnapshotRevision,
    };
    publishWarmupSnapshot(snapshot);

    return () => {
      if (
        typeof window !== "undefined" &&
        window.__PYRUS_PERF_WARMUP_SNAPSHOT__ === snapshot
      ) {
        delete window.__PYRUS_PERF_WARMUP_SNAPSHOT__;
        delete window.__PYRUS_PERF_WARMUP_SNAPSHOT__;
      }
    };
  }, [
    activeScreenBackgroundAllowed,
    activeScreenBackgroundDataAllowed,
    activeScreenFrameReady,
    backgroundDataWarmupEnabled,
    backgroundResumeReady,
    broadMarketDataHydrationReady,
    firstScreenReady,
    frameAuxiliaryDataEnabled,
    hiddenScreenWarmMountAllowed,
    memoryAllowsIdlePrefetch,
    memoryBlocksOperationalPreload,
    memoryPressureLevel,
    memoryPressureObserved,
    mountedScreens,
    operationalCodePreloadReady,
    pageVisible,
    screen,
    screenReadiness,
    screenWarmupPhase,
    signalMatrixBackgroundReady,
    signalMonitorDisplayReady,
    startupProtectionActive,
    warmupSnapshotRevision,
    warmupTestOverrides,
    workspaceLeader,
    workspaceLeadership.reason,
  ]);
  const signalMatrixPriorityReady = Boolean(
    pageVisible &&
      signalMatrixUniverseSymbols.length &&
      signalMonitorDisplayReady &&
      signalMatrixPrioritySymbols.length,
  );
  const signalMatrixPollMs = Math.max(
    signalMonitorPollMs,
    platformPressureCaps.signalMatrixPollMinMs || 0,
  );
  useEffect(() => {
    signalMatrixUniverseRef.current = signalMatrixUniverseSymbols;
    setSignalMatrixSnapshot((current) => ({
      ...current,
      states: mergeSignalMatrixStates({
        currentStates: current.states,
        knownSymbols: signalMatrixUniverseSymbols,
      }),
    }));
  }, [signalMatrixUniverseSymbols, signalMatrixSymbolsKey]);
  useEffect(() => {
    signalMatrixStatesRef.current = signalMatrixSnapshot.states;
  }, [signalMatrixSnapshot.states]);
  const evaluateSignalMonitorMatrixMutation = useEvaluateSignalMonitorMatrix({
    mutation: {
      onSuccess: (data) => {
        const lastPlan = signalMatrixLastPlanRef.current;
        setSignalMatrixSnapshot((current) => ({
          states: mergeSignalMatrixStates({
            currentStates: current.states,
            incomingStates: data?.states || [],
            knownSymbols: signalMatrixUniverseRef.current,
          }),
          timeframes:
            data?.timeframes || current.timeframes || SIGNAL_MATRIX_TIMEFRAMES,
          evaluatedAt: data?.evaluatedAt || current.evaluatedAt || null,
          skippedSymbols: data?.skippedSymbols || current.skippedSymbols || [],
          truncated: Boolean(data?.truncated || current.truncated),
          coverage: {
            ...(data?.coverage || {}),
            ...(lastPlan?.coverage || {}),
            cacheStatus: data?.cacheStatus || null,
            refreshing: Boolean(data?.refreshing),
            backgroundPaused: Boolean(lastPlan?.backgroundPaused),
          },
        }));
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
    const plan = buildSignalMatrixRequestPlan({
      symbols: signalMatrixUniverseSymbols,
      prioritySymbols: signalMatrixPrioritySymbols,
      currentStates: signalMatrixStatesRef.current,
      timeframes: SIGNAL_MATRIX_TIMEFRAMES,
      pressureLevel: memoryPressureLevel,
      backgroundReady: signalMatrixBackgroundReady,
      startupProtectionActive,
      cursor: signalMatrixRotationCursorRef.current,
      pollMs: signalMatrixPollMs,
    });
    if (!plan.requestSymbols.length) {
      return;
    }
    signalMatrixRotationCursorRef.current = plan.nextCursor;
    signalMatrixLastPlanRef.current = plan;
    signalMatrixEvaluationInFlightRef.current = true;
    const requestOrigin =
      signalMatrixAutomaticRunCountRef.current === 0 ? "startup" : "poll";
    signalMatrixAutomaticRunCountRef.current += 1;
    evaluateSignalMonitorMatrixMutation.mutate({
      data: {
        environment: signalMonitorEnvironment,
        watchlistId: null,
        symbols: plan.requestSymbols,
        timeframes: SIGNAL_MATRIX_TIMEFRAMES,
        clientRole: workspaceLeader ? "leader" : "follower",
        requestOrigin,
      },
    });
  }, [
    evaluateSignalMonitorMatrixMutation.mutate,
    memoryPressureLevel,
    signalMonitorEnvironment,
    signalMatrixBackgroundReady,
    signalMatrixPrioritySymbols,
    signalMatrixPollMs,
    signalMatrixSymbolsKey,
    signalMatrixUniverseSymbols,
    startupProtectionActive,
    workspaceLeader,
  ]);
  const signalMatrixRuntimeReady = Boolean(
    platformWorkVisible &&
      !startupProtectionActive &&
      signalMatrixUniverseSymbols.length &&
      signalMonitorDisplayReady &&
      (signalMatrixPriorityReady || signalMatrixBackgroundReady),
  );
  useEffect(() => {
    if (!signalMatrixRuntimeReady) {
      return undefined;
    }

    runSignalMatrixEvaluation();
    const interval = window.setInterval(
      runSignalMatrixEvaluation,
      signalMatrixPollMs,
    );
    return () => window.clearInterval(interval);
  }, [
    runSignalMatrixEvaluation,
    signalMatrixRuntimeReady,
    signalMatrixPollMs,
    signalMatrixSymbolsKey,
    signalMatrixUniverseSymbols.length,
  ]);
  const headerBroadcastSignalMatrixStates = signalMatrixSnapshot.states;
  const runSignalMonitorEvaluation = useCallback(
    (mode = "incremental", { notify = false } = {}) => {
      if (signalMonitorEvaluationInFlightRef.current) {
        signalMonitorEvaluationQueuedModeRef.current = mode;
        if (notify) {
          pushToast({
            title: "Signal scan queued",
            body: "A scan is already running; this request will run next.",
            kind: "info",
          });
        }
        return;
      }
      signalMonitorEvaluationInFlightRef.current = true;
      evaluateSignalMonitorMutation.mutate(
        {
          data: {
            environment: signalMonitorEnvironment,
            mode,
          },
        },
        notify
          ? {
              onSuccess: (data) => {
                pushToast({
                  title: "Signal scan complete",
                  body: `${data?.states?.length || 0} symbols evaluated.`,
                  kind: "success",
                });
              },
            }
          : undefined,
      );
    },
    [evaluateSignalMonitorMutation, pushToast, signalMonitorEnvironment],
  );
  const runtimeWatchlistSymbols = useMemo(
    () => [...new Set(watchlistSymbols)],
    [watchlistSymbols],
  );
  const broadFlowWatchlistSymbols = useMemo(
    () => {
      const symbols = [...new Set(allWatchlistSymbolList.filter(Boolean))];
      const limit = platformPressureCaps.broadFlowSymbolLimit;
      if (limit === 0) {
        return [];
      }
      return limit == null ? symbols : symbols.slice(0, limit);
    },
    [allWatchlistSymbolList, platformPressureCaps.broadFlowSymbolLimit],
  );
  const runtimeQuoteSymbols = useMemo(
    () => [...new Set([...quoteSymbols, ...openPositionMarketDataSymbols])],
    [openPositionMarketDataSymbols, quoteSymbols],
  );
  const runtimeSparklineSymbols = useMemo(
    () => [...new Set([...sparklineSymbols, ...openPositionMarketDataSymbols])],
    [openPositionMarketDataSymbols, sparklineSymbols],
  );
  const prioritySparklineSymbols = useMemo(
    () => {
      const symbols = [
        ...new Set([
          ...visibleWatchlistMarketDataSymbols,
          ...openPositionMarketDataSymbols,
        ]),
      ];
      const limit = platformPressureCaps.prioritySparklineSymbolLimit;
      if (limit === 0) {
        return [];
      }
      return limit == null ? symbols : symbols.slice(0, limit);
    },
    [
      openPositionMarketDataSymbols,
      platformPressureCaps.prioritySparklineSymbolLimit,
      visibleWatchlistMarketDataSymbols,
    ],
  );
  const runtimeStreamedQuoteSymbols = useMemo(
    () => [...new Set(streamedQuoteSymbols)],
    [streamedQuoteSymbols],
  );
  const runtimeStreamedAggregateSymbols = useMemo(
    () => [...new Set(streamedAggregateSymbols)],
    [streamedAggregateSymbols],
  );
  useEffect(() => {
    publishSignalMonitorSnapshot({
      profile: signalMonitorProfile,
      states: signalMonitorStates,
      events: signalMonitorEvents,
      universe: signalMonitorStateQuery.data?.universe || null,
      pending: evaluateSignalMonitorMutation.isPending,
      degraded: signalMonitorDegraded,
    });
  }, [
    evaluateSignalMonitorMutation.isPending,
    signalMonitorEvents,
    signalMonitorDegraded,
    signalMonitorProfile,
    signalMonitorStateQuery.data?.universe,
    signalMonitorStates,
  ]);
  // Persist state changes (debounced via useEffect — fires after each commit)
  useEffect(() => {
    const normalizedScreen = screen === "unusual" ? "flow" : screen;
    persistState({ screen: normalizedScreen });
    if (screen !== normalizedScreen) {
      activateScreen(normalizedScreen);
    }
  }, [activateScreen, screen]);
  useEffect(() => {
    persistState({ sym });
  }, [sym]);
  useEffect(() => {
    persistState({ sidebarCollapsed });
  }, [sidebarCollapsed]);
  useEffect(() => {
    persistState({ watchlistSidebarWidth });
  }, [watchlistSidebarWidth]);
  useEffect(() => {
    persistState({ activitySidebarCollapsed });
  }, [activitySidebarCollapsed]);
  useEffect(() => {
    persistState({ activitySidebarWidth });
  }, [activitySidebarWidth]);
  useEffect(() => {
    persistState({ marketUnusualThreshold });
  }, [marketUnusualThreshold]);
  useEffect(() => {
    persistState({ theme });
  }, [theme]);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const normalizedTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.pyrusTheme = normalizedTheme;
    document.documentElement.dataset.pyrusTheme = normalizedTheme;
  }, [theme]);
  useEffect(() => {
    const resolvedTheme = resolveEffectiveThemePreference(preferredTheme, theme);
    if (resolvedTheme !== theme) {
      setCurrentTheme(resolvedTheme);
      setTheme(resolvedTheme);
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
    const normalizedAccentPreset = ["pyrus", "coral", "amber", "green", "aurora"].includes(
      preferredAccentPreset,
    )
      ? preferredAccentPreset
      : "pyrus";
    root.dataset.pyrusAccentPreset = normalizedAccentPreset;
    root.dataset.pyrusAccentPreset = normalizedAccentPreset;
  }, [preferredAccentPreset]);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    const normalizedDensity =
      preferredDensity === "comfortable" ? "comfortable" : "compact";
    setCurrentDensity(normalizedDensity);
    setUiPreferenceRevision((revision) => revision + 1);
    root.dataset.pyrusDensity = normalizedDensity;
    root.dataset.pyrusDensity = normalizedDensity;
    const normalizedReducedMotion =
      preferredReducedMotion === "on" || preferredReducedMotion === "off"
        ? preferredReducedMotion
        : "system";
    root.dataset.pyrusReducedMotion = normalizedReducedMotion;
    root.dataset.pyrusReducedMotion = normalizedReducedMotion;
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
    activateScreen("trade");
  }, [activateScreen]);

  const handleToggleSignalMonitor = useCallback(() => {
    const nextEnabled = !signalMonitorProfile?.enabled;
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment: signalMonitorEnvironment,
          enabled: nextEnabled,
        },
      },
      {
        onSuccess: () => {
          pushToast({
            title: nextEnabled ? "Signal monitor enabled" : "Signal monitor disabled",
            kind: nextEnabled ? "success" : "info",
          });
          if (nextEnabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    runSignalMonitorEvaluation,
    signalMonitorEnvironment,
    signalMonitorProfile?.enabled,
    pushToast,
    updateSignalMonitorProfileMutation,
  ]);

  const handleChangeSignalMonitorTimeframe = useCallback((timeframe) => {
    const normalizedTimeframe = normalizeSignalMonitorTimeframe(timeframe);
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment: signalMonitorEnvironment,
          timeframe: normalizedTimeframe,
        },
      },
      {
        onSuccess: (profile) => {
          pushToast({
            title: "Signal timeframe updated",
            body: `${normalizedTimeframe} monitor timeframe saved.`,
            kind: "success",
          });
          if (profile?.enabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    runSignalMonitorEvaluation,
    signalMonitorEnvironment,
    pushToast,
    updateSignalMonitorProfileMutation,
  ]);
  const handleChangeSignalMonitorWatchlist = useCallback((watchlistId) => {
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment: signalMonitorEnvironment,
          watchlistId: watchlistId || null,
        },
      },
      {
        onSuccess: (profile) => {
          pushToast({
            title: "Signal watchlist updated",
            kind: "success",
          });
          if (profile?.enabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    runSignalMonitorEvaluation,
    signalMonitorEnvironment,
    pushToast,
    updateSignalMonitorProfileMutation,
  ]);
  const handleChangeSignalMonitorFreshWindowBars = useCallback((freshWindowBars) => {
    const numeric = Number(freshWindowBars);
    if (!Number.isFinite(numeric)) return;
    const clamped = Math.max(1, Math.min(20, Math.round(numeric)));
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment: signalMonitorEnvironment,
          freshWindowBars: clamped,
        },
      },
      {
        onSuccess: (profile) => {
          pushToast({
            title: "Signal freshness updated",
            body: `${clamped} bars saved.`,
            kind: "success",
          });
          if (profile?.enabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    runSignalMonitorEvaluation,
    signalMonitorEnvironment,
    pushToast,
    updateSignalMonitorProfileMutation,
  ]);
  const handleChangeSignalMonitorMaxSymbols = useCallback((maxSymbols) => {
    const numeric = Number(maxSymbols);
    if (!Number.isFinite(numeric)) return;
    const clamped = Math.max(1, Math.min(250, Math.round(numeric)));
    updateSignalMonitorProfileMutation.mutate(
      {
        data: {
          environment: signalMonitorEnvironment,
          maxSymbols: clamped,
        },
      },
      {
        onSuccess: (profile) => {
          pushToast({
            title: "Signal universe limit updated",
            body: `${clamped} symbols saved.`,
            kind: "success",
          });
          if (profile?.enabled) {
            runSignalMonitorEvaluation("incremental");
          }
        },
      },
    );
  }, [
    runSignalMonitorEvaluation,
    signalMonitorEnvironment,
    pushToast,
    updateSignalMonitorProfileMutation,
  ]);
  const handleRunSignalMonitorNow = useCallback(() => {
    runSignalMonitorEvaluation("incremental", { notify: true });
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
    activateScreen("trade");
  }, [activateScreen]);

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
    activateScreen("trade");
  }, [activateScreen]);

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
    activateScreen("trade");
  }, [activateScreen]);

  const handleAccountJumpToTrade = useCallback((symbol) => {
    handleSelectSymbol(symbol);
    activateScreen("trade");
  }, [activateScreen, handleSelectSymbol]);

  const renderScreenById = useCallback((screenId) => (
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
      gatewayTradingBlockReason={effectiveGatewayTradingBlockReason}
      watchlistSymbols={watchlistSymbols}
      runtimeWatchlistSymbols={runtimeWatchlistSymbols}
      signalMonitorSymbols={signalMonitorSymbols}
      signalMatrixStates={signalMatrixSnapshot.states}
      marketScreenActive={marketScreenActive}
      flowScreenActive={flowScreenActive}
      researchConfigured={researchConfigured}
      stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
      watchlists={watchlists}
      defaultWatchlist={defaultWatchlist}
      marketUnusualThreshold={marketUnusualThreshold}
      theme={theme}
      sidebarCollapsed={sidebarCollapsed}
      activitySidebarCollapsed={activitySidebarCollapsed}
      onSelectSymbol={handleSelectSymbol}
      onFocusMarketChart={handleFocusMarketChart}
      onSignalAction={handleSignalAction}
      onScanNow={handleRunSignalMonitorNow}
      onToggleMonitor={handleToggleSignalMonitor}
      onChangeMonitorTimeframe={handleChangeSignalMonitorTimeframe}
      onChangeMonitorWatchlist={handleChangeSignalMonitorWatchlist}
      onJumpToTradeFromFlow={handleJumpToTradeFromFlow}
      onJumpToTradeFromAccount={handleAccountJumpToTrade}
      onJumpToTradeFromResearch={handleJumpToTradeFromResearch}
      onJumpToTradeFromSignalOptionsCandidate={
        handleJumpToTradeFromSignalOptionsCandidate
      }
      onToggleTheme={toggleTheme}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      onToggleActivitySidebar={() =>
        setActivitySidebarCollapsed((current) => !current)
      }
      onScreenReadiness={handleScreenReadiness}
    />
  ), [
    accounts,
    activitySidebarCollapsed,
    brokerAuthenticated,
    brokerConfigured,
    defaultWatchlist,
    effectiveGatewayTradingBlockReason,
    effectiveGatewayTradingMessage,
    effectiveGatewayTradingReady,
    environment,
    flowScreenActive,
    handleAccountJumpToTrade,
    handleChangeSignalMonitorTimeframe,
    handleChangeSignalMonitorWatchlist,
    handleFocusMarketChart,
    handleJumpToTradeFromFlow,
    handleJumpToTradeFromResearch,
    handleJumpToTradeFromSignalOptionsCandidate,
    handleRunSignalMonitorNow,
    handleScreenReadiness,
    handleSelectSymbol,
    handleSignalAction,
    handleToggleSignalMonitor,
    marketScreenActive,
    marketSymPing,
    marketUnusualThreshold,
    primaryAccountId,
    researchConfigured,
    runtimeWatchlistSymbols,
    screen,
    session,
    sidebarCollapsed,
    signalMatrixSnapshot.states,
    signalMonitorSymbols,
    stockAggregateStreamingEnabled,
    sym,
    theme,
    toggleTheme,
    tradeSymPing,
    watchlistSymbols,
    watchlists,
  ]);

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
        prioritySparklineSymbols={prioritySparklineSymbols}
        streamedQuoteSymbols={runtimeStreamedQuoteSymbols}
        streamedAggregateSymbols={runtimeStreamedAggregateSymbols}
        quoteStreamRuntimeEnabled={workSchedule.streams.watchlistQuoteStream}
        quoteStreamDisabledReason={quoteStreamGateReason}
        quoteStreamCoverageDiagnostics={watchlistQuoteStreamDiagnostics}
        marketStockAggregateStreamingEnabled={
          workSchedule.streams.marketStockAggregates
        }
        marketScreenActive={marketScreenActive}
        lowPriorityHistoryEnabled={workSchedule.streams.lowPriorityHistory}
        sparklineHistoryEnabled={platformPressureCaps.sparklineEnabled}
        sparklineConcurrency={platformPressureCaps.sparklineConcurrency}
        flowRuntimeEnabled={workSchedule.streams.sharedFlowRuntime}
        flowRuntimeIntervalMs={
          marketScreenActive || flowScreenActive ? 10_000 : 30_000
        }
        broadFlowRuntimeEnabled={workSchedule.streams.broadFlowRuntime}
        broadFlowScannerConfig={platformPressureCaps.broadFlowScannerConfig}
      >
        <PlatformShell
            activeScreen={screen}
            mountedScreens={mountedScreens}
            setScreen={activateScreen}
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
            headerSignalMatrixStates={headerBroadcastSignalMatrixStates}
            selectedSymbol={sym}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            watchlistSidebarWidth={watchlistSidebarWidth}
            setWatchlistSidebarWidth={setWatchlistSidebarWidth}
            activitySidebarCollapsed={activitySidebarCollapsed}
            setActivitySidebarCollapsed={setActivitySidebarCollapsed}
            activitySidebarWidth={activitySidebarWidth}
            setActivitySidebarWidth={setActivitySidebarWidth}
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
            watchlistsBusy={watchlistsBusy}
            accounts={accounts}
            primaryAccountId={primaryAccountId}
            primaryAccount={primaryAccount}
            onSelectAccount={setSelectedAccountId}
            maskAccountValues={maskAccountValues}
            brokerAuthenticated={brokerAuthenticated}
            session={session}
            environment={environment}
            bridgeTone={bridgeTone}
            theme={theme}
            onToggleTheme={toggleTheme}
            runtimeWatchlistSymbols={runtimeWatchlistSymbols}
            sessionMetadataSettled={sessionMetadataSettled}
            frameAuxiliaryDataEnabled={frameAuxiliaryDataEnabled}
            onFlowAction={handleJumpToTradeFromFlow}
            signalScanEnabled={Boolean(
              signalMonitorProfile?.enabled && !signalMonitorDegraded,
            )}
            signalScanPending={updateSignalMonitorProfileMutation.isPending}
            signalEvaluationPending={evaluateSignalMonitorMutation.isPending}
            signalScanErrored={Boolean(
              (!signalMonitorRuntimeFallback && signalMonitorDegraded) ||
                (signalMonitorProfile?.enabled &&
                  (signalMonitorStateQuery.isError ||
                    signalMonitorEventsQuery.isError ||
                    evaluateSignalMonitorMutation.isError ||
                    updateSignalMonitorProfileMutation.isError)),
            )}
            onToggleSignalScan={handleToggleSignalMonitor}
            onChangeSignalMonitorTimeframe={handleChangeSignalMonitorTimeframe}
            onChangeSignalMonitorFreshWindowBars={handleChangeSignalMonitorFreshWindowBars}
            onChangeSignalMonitorMaxSymbols={handleChangeSignalMonitorMaxSymbols}
        />
      </PlatformRuntimeLayer>
      {!bootProgress.complete ? (
        <div
          className="pyrus-boot-progress-overlay"
          data-testid="pyrus-boot-progress-overlay"
        >
          <LogoLoader
            bootHandoffElapsedMs={null}
            label="Loading workspace"
            progress={bootProgress}
            testId="workspace-boot-progress-loader"
          />
        </div>
      ) : null}
    </PlatformProviders>
  );
}
