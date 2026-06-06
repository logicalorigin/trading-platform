import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isPyrusSafeQaMode } from "../../app/qa-mode";
import LogoLoader from "../../components/LogoLoader";
import {
  getGetNewsQueryOptions,
  getGetQuoteSnapshotsQueryOptions,
  getGetResearchEarningsCalendarQueryOptions,
  getGetSessionQueryKey,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalMonitorStateQueryKey,
  getListAlgoDeploymentsQueryOptions,
  getListBacktestDraftStrategiesQueryOptions,
  getListSignalMonitorEventsQueryKey,
  getListWatchlistsQueryKey,
  evaluateSignalMonitorMatrix,
  listSignalMonitorEvents,
  useEvaluateSignalMonitor,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
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
  resolvePyrusSignalsRuntimeSettings,
} from "../charting/pyrusSignalsPineAdapter";
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
  getOptionQuoteSnapshotListenerCount,
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
import { useRuntimeControlSnapshot } from "./useRuntimeControlSnapshot";
import { getMemoryPressureSnapshot } from "./memoryPressureStore";
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
import { buildHeaderSignalContextSymbols } from "./headerBroadcastModel.js";
import { MemoWatchlistContainer } from "./PlatformWatchlist.jsx";
import { LatencyDebugStrip } from "./LatencyDebugStrip.jsx";
import { normalizeTickerSymbol } from "./tickerIdentity";
import {
  ensureTradeTickerInfo,
  getRuntimeTickerStoreEntryCount,
} from "./runtimeTickerStore";
import {
  buildSignalMatrixPendingStates,
  buildSignalMatrixRequestPlan,
  buildSignalMatrixStoredStateBootstrapRequest,
  buildSignalMatrixSymbolSets,
  mergeSignalMatrixStates,
  resolveSignalMatrixActiveScreenRequestTaskLimit,
  resolveSignalMatrixActiveScreenRequestSymbolLimit,
  resolveSignalMatrixBusyQueueDelayMs,
  resolveSignalMatrixCatchupDelayMs,
  resolveSignalMatrixExactCellLimit,
  resolveSignalMatrixStaVisiblePageExactCellLimit,
  resolveSignalMatrixStaVisiblePageRequestTaskLimit,
  signalMatrixStatesEqual,
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
  SCREEN_BOOT_DATA_DEPS,
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
  readSignalMatrixSnapshotCache,
  writeSignalMatrixSnapshotCache,
} from "../signals/signalMatrixSnapshotCache.js";
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
import {
  createPlatformFreshnessBus,
  usePlatformFreshnessQueryHydration,
  usePlatformFreshnessQueryPublisher,
} from "./platformFreshnessBus";
import { resolveIbkrWorkPressure } from "./workPressureModel.js";
import {
  _initialState,
  persistState,
} from "../../lib/workspaceState";
import { preloadDynamicImport } from "../../lib/dynamicImport";
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
  reclassifyBootBlocking,
  skipBootProgressTasks,
  startBootProgressTask,
  useBootProgress,
} from "../../app/bootProgress";

const SCREEN_ID_SET = new Set(SCREENS.map(({ id }) => id));
const BOOT_INFRA_TASK_IDS = [
  "static-html",
  "react-root",
  "app-content-chunk",
  "workspace-route-chunk",
  "first-screen",
];
const SIGNAL_MONITOR_EVENT_PAGE_SIZE = 1_000;
const SIGNAL_MONITOR_EVENT_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const SIGNAL_MONITOR_EVENT_LOOKAHEAD_MS = 5 * 60 * 1000;

const buildSignalMonitorEventWindow = (nowMs = Date.now()) => ({
  from: new Date(nowMs - SIGNAL_MONITOR_EVENT_LOOKBACK_MS).toISOString(),
  to: new Date(nowMs + SIGNAL_MONITOR_EVENT_LOOKAHEAD_MS).toISOString(),
});

const fetchAllSignalMonitorEventPages = async (params, options = {}) => {
  const events = [];
  const seenCursors = new Set();
  let cursor = null;
  let lastPage = null;

  do {
    const page = await listSignalMonitorEvents(
      {
        ...params,
        ...buildSignalMonitorEventWindow(),
        ...(cursor ? { cursor } : {}),
      },
      options,
    );
    lastPage = page;
    events.push(...(page.events || []));
    if (!page.hasMore || !page.nextCursor) {
      return {
        events,
        nextCursor: null,
        hasMore: false,
      };
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Signal monitor event history cursor repeated.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (!options.signal?.aborted);

  return {
    events,
    nextCursor: lastPage?.nextCursor ?? null,
    hasMore: Boolean(lastPage?.hasMore),
  };
};

const resolveInitialPlatformScreen = (screenId) => {
  const normalizedScreen = screenId === "unusual" ? "flow" : screenId || "market";
  return SCREEN_ID_SET.has(normalizedScreen) ? normalizedScreen : "market";
};

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
@keyframes ibkrStepIconQueue{0%,100%{opacity:.76;transform:rotate(-12deg) scale(.94)}45%{opacity:1;transform:rotate(12deg) scale(1.08)}70%{transform:rotate(0deg) scale(1.02)}}
@keyframes ibkrStepIconDetach{0%,100%{filter:brightness(.86);transform:translateX(0) rotate(0deg) scale(.96)}36%{filter:brightness(1.28);transform:translateX(-2px) rotate(-10deg) scale(1.05)}68%{filter:brightness(1.12);transform:translateX(2px) rotate(7deg) scale(1.02)}}
@keyframes ibkrStepIconPower{0%,100%{opacity:.68;transform:scale(.88)}48%{opacity:1;transform:scale(1.12)}70%{transform:scale(.98)}}
@keyframes ibkrStepLineChase{0%{background-position:100% 0;opacity:.52}50%{opacity:1}100%{background-position:-100% 0;opacity:.52}}
@keyframes ibkrDeactivateProgressSweep{0%{opacity:.42;transform:translateX(-115%)}45%{opacity:1}100%{opacity:.42;transform:translateX(230%)}}
@keyframes ibkrStepCheckPop{0%{opacity:0;transform:scale(0.68)}68%{opacity:1;transform:scale(1.14)}100%{opacity:1;transform:scale(1)}}
@keyframes ibkrStepLineFill{from{opacity:0.35;transform:scaleX(0)}to{opacity:1;transform:scaleX(1)}}
@keyframes headerBroadcastScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes raPulseHit{0%{transform:scale(1)}30%{transform:scale(1.18)}60%{transform:scale(0.97)}100%{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){[data-pulse-hit]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-premium-flow-glyph]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-wave] *{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-bridge-spinner],[data-ibkr-operation-title-spinner],[data-ibkr-deactivate-activity-glyph] svg,[data-ibkr-deactivate-progress-track] span,[data-ibkr-state-pulse],[data-ibkr-step-complete] *,[data-ibkr-step-motion],[data-ibkr-step-motion] *,[data-ibkr-step-line]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-header-broadcast-track]{animation:none!important;transform:none!important}}
[data-header-broadcast-viewport]:hover [data-header-broadcast-track],[data-header-broadcast-viewport]:focus-within [data-header-broadcast-track]{animation-play-state:paused!important}
`;

const SESSION_QUERY_KEY = getGetSessionQueryKey();
const WATCHLISTS_QUERY_KEY = getListWatchlistsQueryKey();
const PLATFORM_FRESHNESS_FAMILY = Object.freeze({
  session: "session",
  watchlists: "watchlists",
  signalProfile: "signal-monitor-profile",
  signalState: "signal-monitor-state",
  signalEvents: "signal-monitor-events",
});
const PLATFORM_FRESHNESS_TTL_MS = Object.freeze({
  session: 5_000,
  watchlists: 60_000,
  signalProfile: 60_000,
  signalState: 15_000,
  signalEvents: 15_000,
});
const SIGNAL_MONITOR_DISPLAY_POLL_MS = 15_000;
const SIGNAL_MATRIX_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"];
const SIGNAL_MATRIX_TIMEFRAME_SET = new Set(SIGNAL_MATRIX_TIMEFRAMES);
const PRIORITY_SCREEN_MODULE_PRELOAD_ORDER = ["account", "signals", "algo"];
const PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS = 500;
const OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS = 20_000;
const OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS = 1_500;
const LAUNCH_AUXILIARY_SURFACE_DELAY_MS = 30_000;
const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;
const WATCHLIST_SIDEBAR_WIDTH_MIN = 196;
const WATCHLIST_SIDEBAR_WIDTH_MAX = 320;
const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;
const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;
const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;
const STARTUP_PROTECTION_COOLDOWN_MS = 8_000;
const SIGNAL_MONITOR_BACKGROUND_RESUME_DELAY_MS = 3_000;
const SIGNAL_MATRIX_BACKGROUND_RESUME_DELAY_MS = 6_000;
const SIGNAL_MATRIX_CATCHUP_COOLDOWN_MS = 30_000;
const SIGNAL_MATRIX_PARTIAL_CACHE_CATCHUP_DELAY_MS = 10_000;
const SIGNAL_MATRIX_TRUNCATED_CATCHUP_DELAY_MS = 5_000;
const SIGNAL_MATRIX_STA_VISIBLE_CATCHUP_DELAY_MS = 250;
const SIGNAL_MATRIX_REQUEST_TIMEOUT_MS = 45_000;
const SIGNAL_MATRIX_REQUEST_WATCHDOG_GRACE_MS = 3_000;
const SIGNAL_MATRIX_GLOBAL_BUSY_RETRY_MS = 1_000;
const SIGNAL_MATRIX_EXACT_CELL_LIMIT_RETRY_TTL_MS = 60_000;
const SIGNAL_MATRIX_OPTIMISTIC_PENDING_CELL_LIMIT = 240;
const SIGNAL_MATRIX_GLOBAL_REQUEST_COORDINATOR_KEY =
  "__PYRUS_SIGNAL_MATRIX_REQUEST_COORDINATOR__";
const SIGNAL_MATRIX_SURFACE_REQUEST_REASONS = new Set([
  "algo-monitor-sidebar",
  "algo-signal-table",
]);
const RECENT_SIGNAL_QUOTE_PIN_MS = 30 * 60_000;
const SCREEN_SHELL_WARM_MOUNT_IDLE_DELAY_MS = 2_000;
const SCREEN_SHELL_WARM_MOUNT_IDLE_STAGGER_MS = 700;

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeSignalMatrixRequestSymbols = (symbols = []) => {
  const seen = new Set();
  const result = [];
  (Array.isArray(symbols) ? symbols : []).forEach((symbol) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

const normalizeSignalMatrixRequestTimeframes = (
  timeframes = [],
  fallback = SIGNAL_MATRIX_TIMEFRAMES,
) => {
  const seen = new Set();
  const result = [];
  (Array.isArray(timeframes) ? timeframes : []).forEach((timeframe) => {
    const normalized = String(timeframe || "").trim();
    if (
      !normalized ||
      !SIGNAL_MATRIX_TIMEFRAME_SET.has(normalized) ||
      seen.has(normalized)
    ) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result.length ? result : [...fallback];
};

const signalMatrixSymbolListsEqual = (left = [], right = []) =>
  left.length === right.length &&
  left.every((symbol, index) => symbol === right[index]);

const SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT = 500;
const SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY = "__signalMonitorUniverseScope";
const SIGNAL_MONITOR_UNIVERSE_SCOPES = new Set([
  "selected_watchlist",
  "all_watchlists",
  "all_watchlists_plus_universe",
  "high_beta_500",
]);

const resolveSignalMonitorUniverseScopeSetting = (settings) => {
  const raw = asRecord(settings)[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY];
  const value = typeof raw === "string" ? raw : "";
  return SIGNAL_MONITOR_UNIVERSE_SCOPES.has(value) ? value : null;
};

const buildSignalMonitorPyrusSettingsPatch = (currentSettings, draftSettings) => {
  const current = asRecord(currentSettings);
  const resolved = resolvePyrusSignalsRuntimeSettings(draftSettings || {});
  const universeScope =
    resolveSignalMonitorUniverseScopeSetting(draftSettings) ??
    resolveSignalMonitorUniverseScopeSetting(currentSettings) ??
    "all_watchlists_plus_universe";
  return {
    ...current,
    ...resolved,
    [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]: universeScope,
    marketStructure: {
      ...asRecord(current.marketStructure),
      timeHorizon: resolved.timeHorizon,
      bosConfirmation: resolved.bosConfirmation,
      chochAtrBuffer: resolved.chochAtrBuffer,
      chochBodyExpansionAtr: resolved.chochBodyExpansionAtr,
      chochVolumeGate: resolved.chochVolumeGate,
    },
    bands: {
      ...asRecord(current.bands),
      basisLength: resolved.basisLength,
      atrLength: resolved.atrLength,
      atrSmoothing: resolved.atrSmoothing,
      volatilityMultiplier: resolved.volatilityMultiplier,
    },
    confirmation: {
      ...asRecord(current.confirmation),
      adxLength: resolved.adxLength,
      volumeMaLength: resolved.volumeMaLength,
      mtf1: resolved.mtf1,
      mtf2: resolved.mtf2,
      mtf3: resolved.mtf3,
      requireMtf1: resolved.requireMtf1,
      requireMtf2: resolved.requireMtf2,
      requireMtf3: resolved.requireMtf3,
      signalFiltersEnabled: resolved.signalFiltersEnabled,
      requireAdx: resolved.requireAdx,
      adxMin: resolved.adxMin,
      requireVolScoreRange: resolved.requireVolScoreRange,
      volScoreMin: resolved.volScoreMin,
      volScoreMax: resolved.volScoreMax,
      restrictToSelectedSessions: resolved.restrictToSelectedSessions,
      sessions: resolved.sessions,
    },
    risk: {
      ...asRecord(current.risk),
      signalOffsetAtr: resolved.signalOffsetAtr,
      tp1Rr: resolved.tp1Rr,
      tp2Rr: resolved.tp2Rr,
      tp3Rr: resolved.tp3Rr,
    },
    appearance: {
      ...asRecord(current.appearance),
      waitForBarClose: resolved.waitForBarClose,
    },
  };
};
const PLATFORM_PRESSURE_LEVELS = new Set([
  "normal",
  "watch",
  "high",
]);

const normalizePlatformPressureLevel = (level) =>
  PLATFORM_PRESSURE_LEVELS.has(level) ? level : null;

const resolveSignalMatrixPressureLevel = ({ memoryPressureLevel, server }) => {
  const appLevel = normalizePlatformPressureLevel(memoryPressureLevel) || "normal";
  return (
    normalizePlatformPressureLevel(server?.effectivePressureLevel) ||
    normalizePlatformPressureLevel(server?.apiPressureLevel) ||
    normalizePlatformPressureLevel(server?.pressureLevel) ||
    appLevel
  );
};

const getSignalMatrixExactCellLimitRejection = (error) => {
  const payload = error?.data || error?.payload || null;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.code !== "signal_monitor_matrix_cells_limit_exceeded") {
    return null;
  }
  const data = asRecord(payload.data);
  const maxCells = Number(data.maxCells);
  if (!Number.isFinite(maxCells) || maxCells <= 0) {
    return null;
  }
  return {
    maxCells: Math.floor(maxCells),
    pressure: normalizePlatformPressureLevel(data.pressure) || null,
    requestedCells: Number(data.requestedCells) || null,
  };
};

const signalMatrixModuleRequestCoordinator = {
  owner: null,
  startedAt: 0,
};

const getSignalMatrixRequestCoordinator = () => {
  if (typeof window === "undefined") {
    return signalMatrixModuleRequestCoordinator;
  }
  const existing = window[SIGNAL_MATRIX_GLOBAL_REQUEST_COORDINATOR_KEY];
  if (existing && typeof existing === "object") {
    return existing;
  }
  const coordinator = { owner: null, startedAt: 0 };
  window[SIGNAL_MATRIX_GLOBAL_REQUEST_COORDINATOR_KEY] = coordinator;
  return coordinator;
};

const clearStaleSignalMatrixRequestLease = (nowMs = Date.now()) => {
  const coordinator = getSignalMatrixRequestCoordinator();
  if (
    coordinator.owner &&
    nowMs - (coordinator.startedAt || 0) >
      SIGNAL_MATRIX_REQUEST_TIMEOUT_MS + SIGNAL_MATRIX_REQUEST_WATCHDOG_GRACE_MS
  ) {
    coordinator.owner = null;
    coordinator.startedAt = 0;
  }
  return coordinator;
};

const hasActiveSignalMatrixRequestLease = (nowMs = Date.now()) => {
  const coordinator = clearStaleSignalMatrixRequestLease(nowMs);
  return Boolean(coordinator.owner);
};

const claimSignalMatrixRequestLease = (owner, nowMs = Date.now()) => {
  const coordinator = clearStaleSignalMatrixRequestLease(nowMs);
  if (coordinator.owner && coordinator.owner !== owner) {
    return false;
  }
  coordinator.owner = owner;
  coordinator.startedAt = nowMs;
  return true;
};

const releaseSignalMatrixRequestLease = (owner) => {
  const coordinator = getSignalMatrixRequestCoordinator();
  if (coordinator.owner === owner) {
    coordinator.owner = null;
    coordinator.startedAt = 0;
  }
};

// ═══════════════════════════════════════════════════════════════════
// STATIC DATA / GENERATORS
// ═══════════════════════════════════════════════════════════════════

const INACTIVE_HEAVY_QUERY_PREFIXES = [
  ["/api/bars"],
  ["/api/flow/events"],
  ["/api/universe/logos"],
  ["/api/universe/logo-proxy"],
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
    .filter((symbol, index, symbols) => symbols.indexOf(symbol) === index);
};

const resolveQuoteStreamGateReason = ({
  workspaceLeader,
  sessionMetadataSettled,
  brokerConfigured,
  brokerAuthenticated,
  quoteStreamEnabled,
}) => {
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
  primaryReady: false,
  derivedReady: false,
  backgroundAllowed: false,
};

const EMPTY_BACKGROUND_RESUME_READY = {
  screen: null,
  signalDisplay: false,
  signalMatrix: false,
};
const EMPTY_SIGNAL_MONITOR_STATES = Object.freeze([]);
const EMPTY_SIGNAL_MONITOR_EVENTS = Object.freeze([]);

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
  const platformFreshnessBus = useMemo(
    () => createPlatformFreshnessBus({ artifactId: "artifacts/pyrus" }),
    [],
  );
  useEffect(
    () => () => {
      platformFreshnessBus.close();
    },
    [platformFreshnessBus],
  );
  const bootProgress = useBootProgress();
  const pageVisible = usePageVisible();
  const safeQaMode = isPyrusSafeQaMode();
  const workspaceLeadership = useWorkspaceLeadership({
    artifactId: "artifacts/pyrus",
  });
  const workspaceLeader = Boolean(workspaceLeadership.isLeader);
  const platformRealtimeWorkActive = Boolean(workspaceLeader && !safeQaMode);
  const viewport = useViewport();
  const isPhone = viewport.flags.isPhone;
  const memoryPressureSignal = useMemoryPressureMonitor();
  const footerApiSourceRuntime = useRuntimeControlSnapshot({
    enabled: platformRealtimeWorkActive,
    runtimeDiagnosticsQueryKey: "footer-api-sources",
    runtimeDiagnosticsRefetchInterval: 3_000,
    lineUsageStreamEnabled: true,
    lineUsagePollInterval: 2_000,
    memoryPressure: memoryPressureSignal,
  });
  const userPreferences = useUserPreferences();
  const startupRefreshQueuedRef = useRef(false);
  const initialScreenRef = useRef(resolveInitialPlatformScreen(_initialState.screen));
  const initialScreen = initialScreenRef.current;
  const initialScreenBootDataDeps =
    SCREEN_BOOT_DATA_DEPS[initialScreen] || SCREEN_BOOT_DATA_DEPS.market;
  const latencyDebugEnabled = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("latency") === "1",
    [],
  );
  const [screen, setScreen] = useState(initialScreen);
  const [signalsScreenMatrixRequest, setSignalsScreenMatrixRequest] = useState(() => ({
    clientRole: null,
    prioritySymbols: [],
    reason: null,
    requestOrigin: null,
    symbols: [],
    timeframes: SIGNAL_MATRIX_TIMEFRAMES,
    revision: 0,
  }));
  const signalMatrixRouteRequestActive = screen === "signals" || screen === "algo";
  const signalMatrixSurfaceRequestActive = Boolean(
    signalsScreenMatrixRequest.symbols.length &&
      SIGNAL_MATRIX_SURFACE_REQUEST_REASONS.has(
        signalsScreenMatrixRequest.reason,
      ),
  );
  const signalMatrixRequestActive =
    signalMatrixRouteRequestActive || signalMatrixSurfaceRequestActive;
  const signalsScreenSafeWorkVisible = Boolean(
    safeQaMode && workspaceLeader && screen === "signals",
  );
  const signalMatrixForegroundWorkVisible = Boolean(
    signalMatrixRequestActive,
  );
  const signalMonitorWorkVisible = Boolean(
    platformRealtimeWorkActive ||
      signalsScreenSafeWorkVisible ||
      signalMatrixForegroundWorkVisible,
  );
  const signalMatrixRequestClientRole =
    workspaceLeader || signalMatrixForegroundWorkVisible ? "leader" : "follower";
  const [mountedScreens, setMountedScreens] = useState(() =>
    buildMountedScreenState(initialScreen),
  );
  const [firstScreenReady, setFirstScreenReady] = useState(false);
  const [startupProtectionActive, setStartupProtectionActive] = useState(true);
  const [screenWarmupPhase, setScreenWarmupPhase] = useState("initial");
  const [auxiliarySurfacesReady, setAuxiliarySurfacesReady] = useState(false);
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
    reclassifyBootBlocking([
      ...BOOT_INFRA_TASK_IDS,
      ...initialScreenBootDataDeps,
    ]);
  }, [initialScreenBootDataDeps]);
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
  const firstScreenBootCompleteRef = useRef(false);
  const bootScreenShellWarmMountCompleteRef = useRef(false);
  const priorityScreenCodePreloadStartedRef = useRef(false);
  const priorityScreenCodePreloadCompleteRef = useRef(false);
  const screenCodePreloadStartedRef = useRef(false);
  const screenCodePreloadCompleteRef = useRef(false);
  const screenShellWarmMountCompleteRef = useRef(false);
  const researchWorkspaceCodePreloadCompleteRef = useRef(false);
  const researchWorkspaceDataPreloadCompleteRef = useRef(false);
  const auxiliarySurfacesReadyRef = useRef(false);
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
        primaryReady:
          patch.primaryReady == null
            ? previous.primaryReady
            : Boolean(patch.primaryReady),
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
        next.primaryReady = true;
      }

      if (
        previous.frameReady === next.frameReady &&
        previous.primaryReady === next.primaryReady &&
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
      const readyScreenId = event?.detail?.screenId;
      markWarmupTimeline("firstScreenFrameReadyAtMs");
      if (readyScreenId) {
        handleScreenReadiness(readyScreenId, {
          frameReady: true,
        });
      }
    };
    window.addEventListener(SCREEN_READY_EVENT, handleScreenReady);
    if (hasPyrusFirstScreenReady()) {
      markWarmupTimeline("firstScreenFrameReadyAtMs");
      handleScreenReadiness(screen, {
        frameReady: true,
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

    if (!firstScreenReady || !signalMonitorWorkVisible) {
      setStartupProtectionActive(true);
      return undefined;
    }

    setStartupProtectionActive(true);
    const timer = window.setTimeout(
      () => setStartupProtectionActive(false),
      STARTUP_PROTECTION_COOLDOWN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [firstScreenReady, signalMonitorWorkVisible]);

  useEffect(() => {
    setBackgroundResumeReady((current) => {
      if (
        current.screen === screen &&
        current.signalDisplay === EMPTY_BACKGROUND_RESUME_READY.signalDisplay &&
        current.signalMatrix === EMPTY_BACKGROUND_RESUME_READY.signalMatrix
      ) {
        return current;
      }
      return { ...EMPTY_BACKGROUND_RESUME_READY, screen };
    });
  }, [screen]);

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
        runtimeTickerStoreEntries: getRuntimeTickerStoreEntryCount(),
        optionQuoteCacheListeners: getOptionQuoteSnapshotListenerCount(),
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
      refetchInterval: 5_000,
      retry: false,
    },
  });
  usePlatformFreshnessQueryHydration({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.session,
    freshnessKey: SESSION_QUERY_KEY,
    queryKey: SESSION_QUERY_KEY,
    queryClient,
  });
  usePlatformFreshnessQueryPublisher({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.session,
    freshnessKey: SESSION_QUERY_KEY,
    data: sessionQuery.data,
    enabled: Boolean(sessionQuery.data),
    ttlMs: PLATFORM_FRESHNESS_TTL_MS.session,
    payloadSizeClass: "small",
    sourceVisible: pageVisible,
  });
  const sessionMetadataSettled = Boolean(
    sessionQuery.data || sessionQuery.isFetched || sessionQuery.isError,
  );
  useRuntimeWorkloadFlag("platform:session", true, {
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
  usePlatformFreshnessQueryHydration({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.watchlists,
    freshnessKey: WATCHLISTS_QUERY_KEY,
    queryKey: WATCHLISTS_QUERY_KEY,
    queryClient,
  });
  usePlatformFreshnessQueryPublisher({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.watchlists,
    freshnessKey: WATCHLISTS_QUERY_KEY,
    data: watchlistsQuery.data,
    enabled: Boolean(watchlistsQuery.data),
    ttlMs: PLATFORM_FRESHNESS_TTL_MS.watchlists,
    payloadSizeClass: "small",
    sourceVisible: pageVisible,
  });
  const watchlists = useMemo(
    () => watchlistsQuery.data?.watchlists || [],
    [watchlistsQuery.data],
  );
  useRuntimeWorkloadFlag(
    "platform:watchlists",
    true,
    {
      kind: "poll",
      label: "Watchlists",
      detail: "60s",
      priority: 5,
    },
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
  const activeScreenPrimaryReady = Boolean(
    activeScreenReadiness.primaryReady,
  );
  const activeScreenBackgroundAllowed = Boolean(
    activeScreenReadiness.backgroundAllowed,
  );
  useEffect(() => {
    if (firstScreenBootCompleteRef.current || !activeScreenPrimaryReady) {
      return;
    }
    firstScreenBootCompleteRef.current = true;
    setFirstScreenReady(true);
    setScreenWarmupPhase("ready");
    markWarmupTimeline("firstScreenReadyAtMs");
    markWarmupTimeline("screenWarmupReadyAtMs");
    completeBootProgressTask("first-screen", {
      detail: `${screen} screen ready`,
    });
  }, [activeScreenPrimaryReady, markWarmupTimeline, screen]);
  useEffect(() => {
    if (
      auxiliarySurfacesReadyRef.current ||
      safeQaMode ||
      isPhone ||
      !firstScreenReady ||
      screenWarmupPhase !== "ready" ||
      startupProtectionActive
    ) {
      return undefined;
    }

    let cancelled = false;
    let cancelIdle = null;
    markWarmupTimeline("auxiliarySurfacesQueuedAtMs");
    const timerId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      cancelIdle = scheduleIdleWork(() => {
        if (cancelled) {
          return;
        }
        auxiliarySurfacesReadyRef.current = true;
        setAuxiliarySurfacesReady(true);
        markWarmupTimeline("auxiliarySurfacesReadyAtMs");
      }, 8_000);
    }, LAUNCH_AUXILIARY_SURFACE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      cancelIdle?.();
    };
  }, [
    firstScreenReady,
    isPhone,
    markWarmupTimeline,
    safeQaMode,
    screenWarmupPhase,
    startupProtectionActive,
  ]);
  const backgroundDataWarmupEnabled = Boolean(
    workspaceLeader &&
      !safeQaMode &&
      !isPhone &&
      !warmupTestOverrides.disableBackgroundDataWarmup,
  );
  const activeScreenBackgroundDataAllowed = Boolean(
    activeScreenBackgroundAllowed && backgroundDataWarmupEnabled,
  );
  const priorityScreenCodePreloadPending = Boolean(
    priorityScreenCodePreloadStartedRef.current &&
      !priorityScreenCodePreloadCompleteRef.current,
  );
  const frameAuxiliaryDataEnabled = Boolean(
    platformRealtimeWorkActive &&
      sessionMetadataSettled &&
      activeScreenBackgroundDataAllowed &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive &&
      !priorityScreenCodePreloadPending &&
      (backgroundDataWarmupEnabled || isPhone),
  );
  useEffect(() => {
    if (!platformRealtimeWorkActive || !activeScreenPrimaryReady) {
      updateBackgroundResumeReady("signalDisplay", false);
      return undefined;
    }

    const timer = window.setTimeout(
      () => updateBackgroundResumeReady("signalDisplay", true),
      SIGNAL_MONITOR_BACKGROUND_RESUME_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    activeScreenPrimaryReady,
    platformRealtimeWorkActive,
    screen,
    updateBackgroundResumeReady,
  ]);
  useEffect(() => {
    if (
      !platformRealtimeWorkActive ||
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
    platformRealtimeWorkActive,
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
  const signalMatrixPressureLevel = useMemo(
    () =>
      resolveSignalMatrixPressureLevel({
        memoryPressureLevel,
        server: memoryPressureSignal?.server,
      }),
    [
      memoryPressureLevel,
      memoryPressureSignal?.server?.apiPressureLevel,
      memoryPressureSignal?.server?.effectivePressureLevel,
      memoryPressureSignal?.server?.pressureLevel,
    ],
  );
  const platformPressureCaps = useMemo(
    () => buildPlatformPressureCaps(memoryPressureLevel),
    [memoryPressureLevel],
  );
  const signalMatrixPressureCaps = useMemo(
    () => buildPlatformPressureCaps(signalMatrixPressureLevel),
    [signalMatrixPressureLevel],
  );
  const activeSignalMatrixPressureLevel = signalMatrixPressureLevel;
  const signalMatrixServerPressureObserved = Boolean(
    memoryPressureSignal?.server?.effectivePressureLevel ||
      memoryPressureSignal?.server?.apiPressureLevel ||
      memoryPressureSignal?.server?.pressureLevel,
  );
  const activeSignalMatrixAdmissionPressureLevel =
    signalMatrixServerPressureObserved
      ? activeSignalMatrixPressureLevel
      : "normal";
  const memoryAllowsBackgroundWarmup = Boolean(memoryPressureObserved);
  const memoryAllowsIdlePrefetch = Boolean(
    firstScreenReady &&
      !startupProtectionActive &&
      memoryAllowsBackgroundWarmup &&
      backgroundDataWarmupEnabled,
  );
  const operationalCodePreloadReady = Boolean(
    platformRealtimeWorkActive &&
      firstScreenReady &&
      !startupProtectionActive &&
      !isPhone &&
      !warmupTestOverrides.disableOperationalCodePreload,
  );
  const screenCodePreloadReady = Boolean(
    operationalCodePreloadReady &&
      activeScreenBackgroundAllowed &&
      memoryAllowsBackgroundWarmup,
  );
  const backgroundScreenPreloadReady = Boolean(
    operationalCodePreloadReady &&
      sessionMetadataSettled &&
      memoryAllowsBackgroundWarmup,
  );
  const hiddenScreenPreloadPolicy = useMemo(
    () =>
      buildPlatformWorkSchedule({
        runtimeActive: platformRealtimeWorkActive,
        sessionMetadataSettled,
        activeScreen: screen,
        screenWarmupPhase,
        activeScreenBackgroundAllowed: activeScreenBackgroundDataAllowed,
        startupProtectionActive,
        memoryPressure: memoryPressureSignal,
        mobileViewport: isPhone,
      }).hiddenScreenPreload,
    [
      isPhone,
      memoryPressureSignal,
      platformRealtimeWorkActive,
      screen,
      screenWarmupPhase,
      sessionMetadataSettled,
      startupProtectionActive,
      activeScreenBackgroundDataAllowed,
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
  useEffect(() => {
    if (
      !operationalCodePreloadReady ||
      !activeScreenBackgroundAllowed ||
      !memoryAllowsBackgroundWarmup ||
      warmupTestOverrides.disableOperationalCodePreload ||
      priorityScreenCodePreloadStartedRef.current ||
      priorityScreenCodePreloadCompleteRef.current
    ) {
      return undefined;
    }

    const preloadOrder = PRIORITY_SCREEN_MODULE_PRELOAD_ORDER.filter(
      (screenId) => screenId !== screen,
    );
    if (!preloadOrder.length) {
      priorityScreenCodePreloadCompleteRef.current = true;
      return undefined;
    }

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      priorityScreenCodePreloadStartedRef.current = true;
      markWarmupTimeline("priorityScreenCodePreloadQueuedAtMs");
      void Promise.allSettled(
        preloadOrder.map((screenId) => preloadScreenModule(screenId)),
      ).then(() => {
        if (cancelled) {
          return;
        }
        priorityScreenCodePreloadCompleteRef.current = true;
        markWarmupTimeline("priorityScreenCodePreloadCompleteAtMs");
      });
    }, PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    activeScreenBackgroundAllowed,
    markWarmupTimeline,
    memoryAllowsBackgroundWarmup,
    operationalCodePreloadReady,
    screen,
    warmupTestOverrides.disableOperationalCodePreload,
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
    () => watchlistSymbols,
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
    platformRealtimeWorkActive &&
      activeScreenBackgroundDataAllowed &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive &&
      !priorityScreenCodePreloadPending &&
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
        enabled: Boolean(sessionQuery.data && !safeQaMode),
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
    if (safeQaMode) {
      skipBootProgressTasks(["accounts"], "Accounts skipped in safe QA mode");
      return;
    }
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
    safeQaMode,
    sessionMetadataSettled,
    sessionQuery.data,
  ]);
  const marketStockAggregateStreamingEnabled = Boolean(
    !safeQaMode &&
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
    brokerConfigured && brokerAuthenticated && !safeQaMode,
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
    setBrokerStockAggregateStreamPaused(!platformRealtimeWorkActive);
    return () => {
      setBrokerStockAggregateStreamPaused(false);
    };
  }, [platformRealtimeWorkActive]);

  useEffect(() => {
    if (
      startupRefreshQueuedRef.current ||
      !platformRealtimeWorkActive ||
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
        queryKey: getListSignalMonitorEventsQueryKey(),
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
    platformRealtimeWorkActive,
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
      void queryClient.cancelQueries({
        queryKey,
        exact: false,
      });
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
    const preloadOrder = SCREEN_MODULE_PRELOAD_ORDER.filter(
      (screenId) => screenId !== screen,
    );
    markWarmupTimeline("screenCodePreloadQueuedAtMs");
    screenCodePreloadStartedRef.current = true;

    const waitForPreloadTurn = (index) =>
      new Promise((resolve) => {
        const timerId = window.setTimeout(
          resolve,
          index === 0
            ? OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS
            : OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS,
        );
        timers.push(timerId);
      });

    const runSequentialPreload = async () => {
      let allFulfilled = true;
      for (let index = 0; index < preloadOrder.length; index += 1) {
        if (cancelled) return;
        await waitForPreloadTurn(index);
        if (cancelled) return;
        try {
          await preloadScreenModule(preloadOrder[index]);
        } catch {
          allFulfilled = false;
        }
      }
      if (!cancelled && allFulfilled) {
        screenCodePreloadCompleteRef.current = true;
        markWarmupTimeline("screenCodePreloadCompleteAtMs");
      }
    };

    void runSequentialPreload();

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      if (!screenCodePreloadCompleteRef.current) {
        screenCodePreloadStartedRef.current = false;
      }
    };
  }, [
    screen,
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
    startupProtectionActive,
    warmupTestOverrides.disableOperationalCodePreload,
  ]);

  useEffect(() => {
    if (
      isPhone ||
      !firstScreenReady ||
      !backgroundScreenPreloadReady ||
      !hiddenScreenWarmMountAllowed ||
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
    hiddenScreenWarmMountAllowed,
    isPhone,
    markWarmupTimeline,
  ]);

  useEffect(() => {
    if (
      isPhone ||
      screenWarmupPhase !== "ready" ||
      !hiddenScreenWarmMountAllowed ||
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
    isPhone,
    markWarmupTimeline,
    screen,
    screenWarmupPhase,
  ]);

  useEffect(() => {
    if (
      !operationalCodePreloadReady ||
      screen !== "research" ||
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
    screen,
    screenWarmupPhase,
  ]);

  useEffect(() => {
    if (
      !operationalCodePreloadReady ||
      screen !== "research" ||
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
    screen,
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
          activeScreenBackgroundAllowed &&
            backgroundDataWarmupEnabled &&
            screenWarmupPhase === "ready" &&
            !startupProtectionActive &&
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
    () => ({
      environment: signalMonitorEnvironment,
      limit: SIGNAL_MONITOR_EVENT_PAGE_SIZE,
    }),
    [signalMonitorEnvironment],
  );
  const signalMonitorProfileQueryKey = useMemo(
    () => getGetSignalMonitorProfileQueryKey(signalMonitorParams),
    [signalMonitorParams],
  );
  const signalMonitorStateQueryKey = useMemo(
    () => getGetSignalMonitorStateQueryKey(signalMonitorParams),
    [signalMonitorParams],
  );
  const signalMonitorEventsQueryKey = useMemo(
    () => getListSignalMonitorEventsQueryKey(signalMonitorEventsParams),
    [signalMonitorEventsParams],
  );
  const signalMonitorProfileQuery = useGetSignalMonitorProfile(
    signalMonitorParams,
    {
      query: {
        enabled: signalMonitorWorkVisible,
        staleTime: 60_000,
        refetchInterval: signalMonitorWorkVisible ? 60_000 : false,
        retry: false,
      },
    },
  );
  usePlatformFreshnessQueryHydration({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.signalProfile,
    freshnessKey: signalMonitorProfileQueryKey,
    queryKey: signalMonitorProfileQueryKey,
    queryClient,
  });
  usePlatformFreshnessQueryPublisher({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.signalProfile,
    freshnessKey: signalMonitorProfileQueryKey,
    data: signalMonitorProfileQuery.data,
    enabled: Boolean(signalMonitorProfileQuery.data),
    ttlMs: PLATFORM_FRESHNESS_TTL_MS.signalProfile,
    payloadSizeClass: "small",
    sourceVisible: pageVisible,
  });
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
        runtimeActive: platformRealtimeWorkActive,
        sessionMetadataSettled,
        activeScreen: screen,
        screenWarmupPhase,
        activeScreenBackgroundAllowed,
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
      platformRealtimeWorkActive,
      screen,
      screenWarmupPhase,
      startupProtectionActive,
      activeScreenBackgroundAllowed,
      sessionMetadataSettled,
      session?.ibkrBridge?.authenticated,
      signalMonitorProfileDegraded,
      signalMonitorProfile?.enabled,
    ],
  );
  useIbkrAccountSnapshotStream({
    accountId: null,
    mode: environment,
    enabled:
      workSchedule.streams.accountRealtime &&
      !priorityScreenCodePreloadPending,
  });
  useIbkrOrderSnapshotStream({
    accountId: null,
    mode: environment,
    enabled:
      workSchedule.streams.accountRealtime &&
      !priorityScreenCodePreloadPending,
  });
  useEffect(() => {
    setHydrationPressureState(workSchedule.hydrationPressure);
  }, [workSchedule.hydrationPressure]);
  useRuntimeWorkloadFlag(
    "signal-monitor:profile",
    Boolean(signalMonitorWorkVisible),
    {
      kind: "poll",
      label: "Signal profile",
      detail: "60s",
      priority: 6,
    },
  );
  const signalMonitorPollMs = clampNumber(
    (signalMonitorProfile?.pollIntervalSeconds || 60) * 1000,
    15_000,
    3_600_000,
  );
  const signalWorkFastScreen = Boolean(
    marketScreenActive ||
      screen === "signals" ||
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
    signalMatrixPressureCaps.signalDisplayPollMinMs || 0,
  );
  const signalMonitorForegroundReady = Boolean(signalMatrixRequestActive);
  const signalMonitorProfileAllowsDisplay = Boolean(
    signalMonitorProfile?.enabled ||
      (signalMonitorForegroundReady &&
        !signalMonitorProfileQuery.isFetched &&
        !signalMonitorProfileQuery.isError),
  );
  const signalMonitorDisplayReady = Boolean(
    signalMonitorWorkVisible &&
      (firstScreenReady || signalMonitorForegroundReady) &&
      signalMonitorProfileAllowsDisplay,
  );
  const signalMonitorEventsReady = signalMonitorDisplayReady;
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
  usePlatformFreshnessQueryHydration({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.signalState,
    freshnessKey: signalMonitorStateQueryKey,
    queryKey: signalMonitorStateQueryKey,
    queryClient,
  });
  usePlatformFreshnessQueryPublisher({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.signalState,
    freshnessKey: signalMonitorStateQueryKey,
    data: signalMonitorStateQuery.data,
    enabled: Boolean(signalMonitorStateQuery.data),
    ttlMs: PLATFORM_FRESHNESS_TTL_MS.signalState,
    payloadSizeClass: "medium",
    sourceVisible: pageVisible,
  });
  const signalMonitorEventsQuery = useQuery({
    queryKey: getListSignalMonitorEventsQueryKey(signalMonitorEventsParams),
    queryFn: ({ signal }) =>
      fetchAllSignalMonitorEventPages(signalMonitorEventsParams, { signal }),
    enabled: signalMonitorEventsReady,
    staleTime: 15_000,
    refetchInterval: signalMonitorEventsReady
      ? signalMonitorRuntimePollMs
      : false,
    retry: false,
    placeholderData: (previousData) => previousData,
  });
  usePlatformFreshnessQueryHydration({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.signalEvents,
    freshnessKey: signalMonitorEventsQueryKey,
    queryKey: signalMonitorEventsQueryKey,
    queryClient,
  });
  usePlatformFreshnessQueryPublisher({
    bus: platformFreshnessBus,
    family: PLATFORM_FRESHNESS_FAMILY.signalEvents,
    freshnessKey: signalMonitorEventsQueryKey,
    data: signalMonitorEventsQuery.data,
    enabled: Boolean(signalMonitorEventsQuery.data),
    ttlMs: PLATFORM_FRESHNESS_TTL_MS.signalEvents,
    payloadSizeClass: "medium",
    sourceVisible: pageVisible,
  });
  useEffect(() => {
    const stateProfile = signalMonitorStateQuery.data?.profile;
    if (!stateProfile?.environment || signalMonitorProfileQuery.data) {
      return;
    }
    queryClient.setQueryData(
      getGetSignalMonitorProfileQueryKey({
        environment: stateProfile.environment,
      }),
      stateProfile,
    );
  }, [
    queryClient,
    signalMonitorProfileQuery.data,
    signalMonitorStateQuery.data?.profile,
  ]);
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
          queryKey: getListSignalMonitorEventsQueryKey(),
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
          queryKey: getListSignalMonitorEventsQueryKey(),
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
  const [signalMatrixSnapshot, setSignalMatrixSnapshot] = useState(() => {
    const cachedSnapshot = readSignalMatrixSnapshotCache({
      timeframes: SIGNAL_MATRIX_TIMEFRAMES,
    });
    return cachedSnapshot || {
      states: [],
      timeframes: SIGNAL_MATRIX_TIMEFRAMES,
    };
  });
  const signalMatrixEvaluationInFlightRef = useRef(false);
  const signalMatrixEvaluationStartedAtRef = useRef(0);
  const signalMatrixRotationCursorRef = useRef(0);
  const signalMatrixLastPlanRef = useRef(null);
  const signalMatrixAutomaticRunCountRef = useRef(0);
  const signalMatrixUniverseRef = useRef([]);
  const signalMatrixStatesRef = useRef(signalMatrixSnapshot.states || []);
  const signalMatrixQueuedEvaluationRef = useRef(false);
  const signalMatrixQueuedEvaluationDelayMsRef = useRef(null);
  const signalMatrixQueuedTimerRef = useRef(null);
  const signalMatrixRunRef = useRef(null);
  const signalMatrixAbortControllerRef = useRef(null);
  const signalMatrixRequestEpochRef = useRef(0);
  const signalMatrixLastCatchupQueuedAtRef = useRef(0);
  const signalMatrixRequestOwnerRef = useRef(null);
  const signalMatrixRejectedExactCellLimitRef = useRef(null);
  const signalMatrixStoredStateBootstrapKeyRef = useRef(null);
  if (!signalMatrixRequestOwnerRef.current) {
    signalMatrixRequestOwnerRef.current = `platform-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }
  const cancelSignalMatrixEvaluation = useCallback(() => {
    signalMatrixRequestEpochRef.current += 1;
    signalMatrixAbortControllerRef.current?.abort();
    signalMatrixAbortControllerRef.current = null;
    if (signalMatrixQueuedTimerRef.current != null) {
      window.clearTimeout(signalMatrixQueuedTimerRef.current);
      signalMatrixQueuedTimerRef.current = null;
    }
    signalMatrixQueuedEvaluationRef.current = false;
    signalMatrixQueuedEvaluationDelayMsRef.current = null;
    signalMatrixEvaluationInFlightRef.current = false;
    signalMatrixEvaluationStartedAtRef.current = 0;
    releaseSignalMatrixRequestLease(signalMatrixRequestOwnerRef.current);
  }, []);
  const signalMonitorStates =
    signalMonitorStateQuery.data?.states || EMPTY_SIGNAL_MONITOR_STATES;
  const signalMonitorEvents =
    signalMonitorEventsQuery.data?.events || EMPTY_SIGNAL_MONITOR_EVENTS;
  const signalMonitorStateUniverseSymbols =
    Array.isArray(signalMonitorStateQuery.data?.universeSymbols)
      ? signalMonitorStateQuery.data.universeSymbols
      : [];
  const headerSignalContextSymbols = useMemo(
    () =>
      buildHeaderSignalContextSymbols({
        states: signalMonitorStates,
        events: signalMonitorEvents,
      }),
    [signalMonitorEvents, signalMonitorStates],
  );
  const signalMonitorSymbols = useMemo(
    () =>
      [
        ...new Set(
          [
            ...headerSignalContextSymbols,
            ...signalMonitorStates.map((state) =>
              normalizeTickerSymbol(state?.symbol),
            ),
          ].filter(Boolean),
        ),
      ],
    [headerSignalContextSymbols, signalMonitorStates],
  );
  const signalMonitorDisplaySymbols = useMemo(
    () =>
      [
        ...new Set(
          [
            ...signalMonitorStateUniverseSymbols.map((symbol) =>
              normalizeTickerSymbol(symbol),
            ),
            ...headerSignalContextSymbols,
            ...signalMonitorStates.map((state) =>
              normalizeTickerSymbol(state?.symbol),
            ),
          ].filter(Boolean),
        ),
      ],
    [
      headerSignalContextSymbols,
      signalMonitorStateUniverseSymbols,
      signalMonitorStates,
    ],
  );
  const signalsScreenMatrixSymbols = signalsScreenMatrixRequest.symbols;
  const signalsScreenMatrixPrioritySymbols =
    signalsScreenMatrixRequest.prioritySymbols?.length
      ? signalsScreenMatrixRequest.prioritySymbols
      : signalsScreenMatrixSymbols;
  const signalsScreenMatrixSymbolsKey = useMemo(
    () => signalsScreenMatrixSymbols.join(","),
    [signalsScreenMatrixSymbols],
  );
  const signalsScreenMatrixPrioritySymbolsKey = useMemo(
    () => signalsScreenMatrixPrioritySymbols.join(","),
    [signalsScreenMatrixPrioritySymbols],
  );
  const signalsScreenMatrixTimeframes =
    signalsScreenMatrixRequest.timeframes || SIGNAL_MATRIX_TIMEFRAMES;
  const signalsScreenMatrixClientRole =
    signalsScreenMatrixRequest.clientRole || null;
  const signalsScreenMatrixRequestOrigin =
    signalsScreenMatrixRequest.requestOrigin || null;
  const signalMatrixStaVisibleRequestActive = Boolean(
    signalsScreenMatrixClientRole === "algo-sta" &&
      signalsScreenMatrixRequestOrigin === "sta-visible-page" &&
      signalsScreenMatrixSymbols.length,
  );
  const signalsScreenMatrixTimeframesKey = useMemo(
    () => signalsScreenMatrixTimeframes.join(","),
    [signalsScreenMatrixTimeframes],
  );
  const handleRequestSignalMatrixHydration = useCallback((request = {}) => {
    const payload = request || {};
    const normalizedSymbols = normalizeSignalMatrixRequestSymbols(
      payload.symbols?.length ? payload.symbols : payload.missingSymbols,
    );
    const normalizedPrioritySymbols = normalizeSignalMatrixRequestSymbols(
      payload.prioritySymbols?.length
        ? payload.prioritySymbols
        : payload.requestSymbols?.length
          ? payload.requestSymbols
          : payload.missingSymbols,
    );
    const normalizedTimeframes = normalizeSignalMatrixRequestTimeframes(
      payload.timeframes,
    );
    const normalizedClientRole =
      payload.clientRole === "algo-sta" ? "algo-sta" : null;
    const normalizedRequestOrigin =
      payload.requestOrigin === "sta-visible-page" ? "sta-visible-page" : null;
    const normalizedReason = String(payload.reason || "").trim() || null;
    if (payload.force && normalizedSymbols.length) {
      const symbolSet = new Set(normalizedSymbols);
      const timeframeSet = new Set(normalizedTimeframes);
      setSignalMatrixSnapshot((current) => {
        const nextStates = current.states.filter(
          (state) =>
            !symbolSet.has(normalizeTickerSymbol(state?.symbol)) ||
            !timeframeSet.has(String(state?.timeframe || "").trim()),
        );
        signalMatrixStatesRef.current = nextStates;
        return {
          ...current,
          states: nextStates,
        };
      });
    }
    setSignalsScreenMatrixRequest((current) => {
      const sameSymbols = signalMatrixSymbolListsEqual(
        current.symbols,
        normalizedSymbols,
      );
      const samePrioritySymbols = signalMatrixSymbolListsEqual(
        current.prioritySymbols || [],
        normalizedPrioritySymbols,
      );
      const sameTimeframes = signalMatrixSymbolListsEqual(
        current.timeframes || [],
        normalizedTimeframes,
      );
      const sameMetadata =
        (current.clientRole || null) === normalizedClientRole &&
        (current.requestOrigin || null) === normalizedRequestOrigin &&
        (current.reason || null) === normalizedReason;
      if (
        sameSymbols &&
        samePrioritySymbols &&
        sameTimeframes &&
        sameMetadata &&
        !payload.force
      ) {
        return current;
      }
      signalMatrixRotationCursorRef.current = 0;
      return {
        clientRole: normalizedClientRole,
        prioritySymbols: normalizedPrioritySymbols,
        reason: normalizedReason,
        requestOrigin: normalizedRequestOrigin,
        symbols: normalizedSymbols,
        timeframes: normalizedTimeframes,
        revision: current.revision + 1,
      };
    });
  }, []);
  useEffect(() => {
    if (signalMatrixRequestActive) {
      return;
    }
    cancelSignalMatrixEvaluation();
    setSignalsScreenMatrixRequest((current) =>
      current.symbols.length
        ? {
            clientRole: null,
            prioritySymbols: [],
            reason: null,
            requestOrigin: null,
            symbols: [],
            timeframes: SIGNAL_MATRIX_TIMEFRAMES,
            revision: current.revision + 1,
          }
        : current,
    );
  }, [cancelSignalMatrixEvaluation, screen, signalMatrixRequestActive]);
  useEffect(() => {
    if (
      signalMatrixRouteRequestActive ||
      !signalMatrixSurfaceRequestActive ||
      frameAuxiliaryDataEnabled
    ) {
      return;
    }
    cancelSignalMatrixEvaluation();
    setSignalsScreenMatrixRequest((current) =>
      current.symbols.length
        ? {
            clientRole: null,
            prioritySymbols: [],
            reason: null,
            requestOrigin: null,
            symbols: [],
            timeframes: SIGNAL_MATRIX_TIMEFRAMES,
            revision: current.revision + 1,
          }
        : current,
    );
  }, [
    cancelSignalMatrixEvaluation,
    frameAuxiliaryDataEnabled,
    signalMatrixRouteRequestActive,
    signalMatrixSurfaceRequestActive,
  ]);
  const recentSignalMarketDataSymbols = useMemo(
    () => resolveRecentSignalMarketDataSymbols(signalMonitorStates),
    [signalMonitorStates],
  );
  const quoteStreamRotationSymbols = useMemo(
    () =>
      [
        ...new Set(
          [...watchlistSymbols, ...signalMonitorDisplaySymbols]
            .map(normalizeTickerSymbol)
            .filter(Boolean),
        ),
      ],
    [signalMonitorDisplaySymbols, watchlistSymbols],
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
            ...recentSignalMarketDataSymbols,
          ]
            .map(normalizeTickerSymbol)
            .filter(Boolean),
        ),
      ],
    [
      marketScreenActive,
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
        rotationSymbols: quoteStreamRotationSymbols,
        pinnedSymbols: quoteStreamPinnedSymbols,
        cursor: watchlistQuoteRotationCursor,
        batchSize: WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
      }),
    [
      quoteStreamPinnedSymbols,
      quoteStreamRotationSymbols,
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
        workspaceLeader,
        sessionMetadataSettled,
        brokerConfigured,
        brokerAuthenticated: Boolean(session?.ibkrBridge?.authenticated),
        quoteStreamEnabled: workSchedule.streams.watchlistQuoteStream,
      }),
    [
      brokerConfigured,
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
          rotationSymbols: quoteStreamRotationSymbols,
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
    quoteStreamRotationSymbols,
    watchlistQuoteRotationBatch.rotatingUniverseSize,
    watchlistSymbols,
  ]);
  useEffect(() => {
    if (quoteStreamGateReason || streamedQuoteSymbols.length === 0) {
      return;
    }
    const universe = new Set(
      quoteStreamRotationSymbols.map(normalizeTickerSymbol).filter(Boolean),
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
  }, [
    quoteStreamGateReason,
    quoteStreamRotationSymbols,
    streamedQuoteSymbols.length,
    streamedQuoteSymbolsKey,
  ]);
  const watchlistQuoteStreamDiagnostics = useMemo(
    () =>
      buildWatchlistQuoteRotationDiagnostics({
        batch: watchlistQuoteRotationBatch,
        watchlistSymbols,
        rotationSymbols: quoteStreamRotationSymbols,
        lastTouchedAtBySymbol: watchlistQuoteLastTouchedBySymbol,
        cycleWindowMs: WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
        disabledReason: quoteStreamGateReason,
      }),
    [
      quoteStreamGateReason,
      quoteStreamRotationSymbols,
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
  const signalMatrixSymbolSets = useMemo(
    () =>
      buildSignalMatrixSymbolSets({
        selectedSymbol: sym,
        visibleWatchlistSymbols: visibleWatchlistMarketDataSymbols,
        signalsScreenSymbols:
          signalMatrixRequestActive ? signalsScreenMatrixSymbols : [],
        signalsScreenPrioritySymbols:
          signalMatrixRequestActive ? signalsScreenMatrixPrioritySymbols : [],
        openPositionSymbols: openPositionMarketDataSymbols,
        signalMonitorSymbols,
        signalMonitorUniverseSymbols: signalMonitorDisplaySymbols,
        watchlistSymbols,
        wideLimit: signalMatrixPressureCaps.signalMatrixWideSymbolLimit,
        narrowLimit: signalMatrixPressureCaps.signalMatrixNarrowSymbolLimit,
      }),
    [
      openPositionMarketDataSymbols,
      signalMatrixPressureCaps.signalMatrixWideSymbolLimit,
      signalMatrixPressureCaps.signalMatrixNarrowSymbolLimit,
      signalsScreenMatrixSymbols,
      signalsScreenMatrixSymbolsKey,
      signalsScreenMatrixPrioritySymbols,
      signalsScreenMatrixPrioritySymbolsKey,
      signalMatrixRequestActive,
      signalMonitorDisplaySymbols,
      signalMonitorSymbols,
      screen,
      sym,
      visibleWatchlistMarketDataSymbols,
      watchlistSymbols,
    ],
  );
  const signalMatrixUniverseSymbols = signalMatrixSymbolSets.universeSymbols;
  const signalMatrixPrioritySymbols = signalMatrixSymbolSets.prioritySymbols;
  const signalMatrixSuggestedSignalSymbols =
    signalMatrixSymbolSets.suggestedSignalSymbols;
  const signalMatrixSymbolsKey = useMemo(
    () => signalMatrixUniverseSymbols.join(","),
    [signalMatrixUniverseSymbols],
  );
  const signalMatrixPrioritySymbolsKey = useMemo(
    () => signalMatrixPrioritySymbols.join(","),
    [signalMatrixPrioritySymbols],
  );
  const signalMatrixBackgroundReady = Boolean(
    backgroundResumeReady.screen === screen &&
      backgroundResumeReady.signalMatrix &&
      activeScreenBackgroundDataAllowed &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive,
  );
  const signalMatrixForegroundReady =
    signalMatrixRequestActive || signalMatrixBackgroundReady;
  const signalMatrixStartupProtectionActive =
    startupProtectionActive && !signalMatrixRequestActive;
  const signalMatrixActiveScreenRowsReady = Boolean(
    screen !== "signals" || signalsScreenMatrixSymbols.length,
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
        priorityScreenCodePreloadComplete:
          priorityScreenCodePreloadCompleteRef.current,
        screenCodePreloadComplete: screenCodePreloadCompleteRef.current,
        screenShellWarmMountComplete:
          screenShellWarmMountCompleteRef.current,
        researchWorkspaceCodePreloadComplete:
          researchWorkspaceCodePreloadCompleteRef.current,
        researchWorkspaceDataPreloadComplete:
          researchWorkspaceDataPreloadCompleteRef.current,
        auxiliarySurfacesReady: auxiliarySurfacesReadyRef.current,
      },
      queues: {
        bootScreenShellWarmMountStarted:
          warmupTimelineRef.current.bootScreenShellWarmMountQueuedAtMs != null,
        bootScreenShellWarmMountCompleted:
          warmupTimelineRef.current.bootScreenShellWarmMountCompleteAtMs != null,
        priorityScreenCodePreloadStarted:
          warmupTimelineRef.current.priorityScreenCodePreloadQueuedAtMs != null,
        priorityScreenCodePreloadCompleted:
          warmupTimelineRef.current.priorityScreenCodePreloadCompleteAtMs != null,
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
        auxiliarySurfacesQueued:
          warmupTimelineRef.current.auxiliarySurfacesQueuedAtMs != null,
        auxiliarySurfacesReady:
          warmupTimelineRef.current.auxiliarySurfacesReadyAtMs != null,
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
        memoryAllowsIdlePrefetch,
        priorityScreenCodePreloadPending,
        auxiliarySurfacesReady,
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
    auxiliarySurfacesReady,
    backgroundDataWarmupEnabled,
    backgroundResumeReady,
    broadMarketDataHydrationReady,
    firstScreenReady,
    frameAuxiliaryDataEnabled,
    hiddenScreenWarmMountAllowed,
    memoryAllowsIdlePrefetch,
    memoryPressureLevel,
    memoryPressureObserved,
    mountedScreens,
    operationalCodePreloadReady,
    pageVisible,
    priorityScreenCodePreloadPending,
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
    signalMatrixForegroundReady &&
      signalMatrixActiveScreenRowsReady &&
      signalMatrixUniverseSymbols.length &&
      signalMonitorDisplayReady &&
      signalMatrixPrioritySymbols.length,
  );
  const signalMatrixForegroundPollMs = signalMonitorDisplayPollMs;
  const signalMatrixBackgroundPollMs = signalMonitorPollMs;
  const signalMatrixBasePollMs = signalMatrixRequestActive
    ? signalMatrixForegroundPollMs
    : signalMatrixBackgroundPollMs;
  const signalMatrixPollMs = Math.max(
    signalMatrixBasePollMs,
    signalMatrixPressureCaps.signalMatrixPollMinMs || 0,
  );
  const signalMatrixActiveScreenRequestSymbolLimit = useMemo(
    () =>
      resolveSignalMatrixActiveScreenRequestSymbolLimit(
        activeSignalMatrixPressureLevel,
      ),
    [activeSignalMatrixPressureLevel],
  );
  const signalMatrixActiveScreenRequestTaskLimit = useMemo(
    () =>
      resolveSignalMatrixActiveScreenRequestTaskLimit(
        activeSignalMatrixAdmissionPressureLevel,
      ),
    [activeSignalMatrixAdmissionPressureLevel],
  );
  const signalMatrixActiveScreenExactCellLimit = useMemo(
    () => resolveSignalMatrixExactCellLimit(activeSignalMatrixAdmissionPressureLevel),
    [activeSignalMatrixAdmissionPressureLevel],
  );
  const signalMatrixStaVisiblePageRequestTaskLimit = useMemo(
    () =>
      resolveSignalMatrixStaVisiblePageRequestTaskLimit(
        activeSignalMatrixPressureLevel,
      ),
    [activeSignalMatrixPressureLevel],
  );
  const signalMatrixStaVisiblePageExactCellLimit = useMemo(
    () =>
      resolveSignalMatrixStaVisiblePageExactCellLimit(
        activeSignalMatrixPressureLevel,
      ),
    [activeSignalMatrixPressureLevel],
  );
  const signalMatrixRequestTaskLimit = useMemo(() => {
    if (!signalMatrixRequestActive || !signalMatrixUniverseSymbols.length) {
      return null;
    }
    if (signalMatrixStaVisibleRequestActive) {
      return signalMatrixStaVisiblePageRequestTaskLimit;
    }
    return signalMatrixActiveScreenRequestTaskLimit;
  }, [
    signalMatrixActiveScreenRequestTaskLimit,
    signalMatrixRequestActive,
    signalMatrixStaVisiblePageRequestTaskLimit,
    signalMatrixStaVisibleRequestActive,
    signalMatrixUniverseSymbols.length,
  ]);
  const signalMatrixRequestExactCellLimit = useMemo(() => {
    if (!signalMatrixRequestActive || !signalMatrixUniverseSymbols.length) {
      return null;
    }
    if (signalMatrixStaVisibleRequestActive) {
      return signalMatrixStaVisiblePageExactCellLimit;
    }
    return signalMatrixActiveScreenExactCellLimit;
  }, [
    signalMatrixActiveScreenExactCellLimit,
    signalMatrixRequestActive,
    signalMatrixStaVisiblePageExactCellLimit,
    signalMatrixStaVisibleRequestActive,
    signalMatrixUniverseSymbols.length,
  ]);
  const signalMatrixRequestSymbolLimit = useMemo(() => {
    if (screen !== "signals") {
      return null;
    }
    if (!signalsScreenMatrixPrioritySymbols.length) {
      return signalMatrixActiveScreenRequestSymbolLimit;
    }
    return Math.min(
      signalMatrixActiveScreenRequestSymbolLimit,
      signalsScreenMatrixPrioritySymbols.length,
    );
  }, [
    screen,
    signalMatrixActiveScreenRequestSymbolLimit,
    signalsScreenMatrixPrioritySymbols.length,
  ]);
  const signalMatrixRequestTimeframes = useMemo(() => {
    if (signalMatrixRequestActive && signalsScreenMatrixSymbols.length) {
      return signalsScreenMatrixTimeframes;
    }
    return SIGNAL_MATRIX_TIMEFRAMES;
  }, [
    signalMatrixRequestActive,
    signalsScreenMatrixSymbols.length,
    signalsScreenMatrixTimeframes,
    signalsScreenMatrixTimeframesKey,
  ]);
  const signalMatrixRequestTimeframesKey = useMemo(
    () => signalMatrixRequestTimeframes.join(","),
    [signalMatrixRequestTimeframes],
  );
  const signalMatrixBusyQueueDelayMs = useMemo(
    () => resolveSignalMatrixBusyQueueDelayMs(signalMatrixPressureLevel),
    [signalMatrixPressureLevel],
  );
  const signalMatrixCatchupDelayMs = useMemo(
    () => resolveSignalMatrixCatchupDelayMs(signalMatrixPressureLevel),
    [signalMatrixPressureLevel],
  );
  const signalMatrixEffectiveCatchupDelayMs = useMemo(() => {
    if (signalMatrixCatchupDelayMs == null) {
      return null;
    }
    return signalMatrixStaVisibleRequestActive
      ? Math.min(
          signalMatrixCatchupDelayMs,
          SIGNAL_MATRIX_STA_VISIBLE_CATCHUP_DELAY_MS,
        )
      : signalMatrixCatchupDelayMs;
  }, [signalMatrixCatchupDelayMs, signalMatrixStaVisibleRequestActive]);
  const signalMatrixRuntimeReady = Boolean(
      signalMonitorWorkVisible &&
      !signalMatrixStartupProtectionActive &&
      signalMatrixActiveScreenRowsReady &&
      signalMatrixUniverseSymbols.length &&
      signalMonitorDisplayReady &&
      (signalMatrixPriorityReady || signalMatrixBackgroundReady),
  );
  const signalMatrixBootstrapSymbols = useMemo(
    () => {
      const visibleSymbols = new Set(
        [sym, ...visibleWatchlistMarketDataSymbols]
          .map((symbol) => normalizeTickerSymbol(symbol))
          .filter(Boolean),
      );
      return signalMatrixPrioritySymbols.filter((symbol) =>
        visibleSymbols.has(symbol),
      );
    },
    [signalMatrixPrioritySymbols, sym, visibleWatchlistMarketDataSymbols],
  );
  const signalMatrixBootstrapComplete = useMemo(
    () => {
      if (!signalMatrixBootstrapSymbols.length) {
        return true;
      }
      const stateKeys = new Set(
        signalMatrixSnapshot.states
          .map((state) => {
            const symbol = normalizeTickerSymbol(state?.symbol);
            const timeframe = String(state?.timeframe || "").trim();
            return symbol && timeframe ? `${symbol}:${timeframe}` : null;
          })
          .filter(Boolean),
      );
      return signalMatrixBootstrapSymbols.every((symbol) =>
        signalMatrixRequestTimeframes.every((timeframe) =>
          stateKeys.has(`${symbol}:${timeframe}`),
        ),
      );
    },
    [
      signalMatrixBootstrapSymbols,
      signalMatrixRequestTimeframes,
      signalMatrixRequestTimeframesKey,
      signalMatrixSnapshot.states,
    ],
  );
  const signalMonitorProfileBootstrapPending = Boolean(
    signalMonitorWorkVisible &&
      firstScreenReady &&
      !signalMonitorProfileQuery.data &&
      !signalMonitorProfileQuery.isFetched &&
      !signalMonitorProfileQuery.isError,
  );
  const signalMonitorStateBootstrapComplete = Boolean(
    !signalMonitorWorkVisible ||
      !firstScreenReady ||
      signalMonitorProfileQuery.isError ||
      (signalMonitorProfileQuery.isFetched && !signalMonitorProfile?.enabled) ||
      signalMonitorStateQuery.data ||
      signalMonitorStateQuery.isFetched ||
      signalMonitorStateQuery.isError,
  );
  const signalHydrationBootstrapActive = Boolean(
    signalMonitorWorkVisible &&
      firstScreenReady &&
      !signalMatrixStartupProtectionActive &&
      (
        signalMonitorProfileBootstrapPending ||
        !signalMonitorStateBootstrapComplete ||
        (signalMatrixRuntimeReady && !signalMatrixBootstrapComplete)
      ),
  );
  useEffect(() => {
    signalMatrixUniverseRef.current = signalMatrixUniverseSymbols;
    setSignalMatrixSnapshot((current) => {
      const nextStates = mergeSignalMatrixStates({
        currentStates: current.states,
        knownSymbols: signalMatrixUniverseSymbols,
      });
      if (signalMatrixStatesEqual(current.states, nextStates)) {
        return current.coverage ? { ...current, coverage: null } : current;
      }
      return {
        ...current,
        states: nextStates,
        coverage: null,
      };
    });
  }, [signalMatrixUniverseSymbols, signalMatrixSymbolsKey]);
  useEffect(() => {
    signalMatrixStatesRef.current = signalMatrixSnapshot.states;
  }, [signalMatrixSnapshot.states]);
  useEffect(() => {
    writeSignalMatrixSnapshotCache(signalMatrixSnapshot, {
      timeframes: SIGNAL_MATRIX_TIMEFRAMES,
    });
  }, [signalMatrixSnapshot]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const lastPlan = signalMatrixLastPlanRef.current;
    const snapshot = {
      version: 1,
      pressureLevel: signalMatrixPressureLevel,
      appPressureLevel: memoryPressureLevel,
      serverPressureLevel:
        memoryPressureSignal?.server?.effectivePressureLevel ||
        memoryPressureSignal?.server?.apiPressureLevel ||
        memoryPressureSignal?.server?.pressureLevel ||
        null,
      pollMs: signalMatrixPollMs,
      runtimeReady:
        signalMonitorWorkVisible &&
        !signalMatrixStartupProtectionActive &&
        signalMatrixUniverseSymbols.length > 0 &&
        signalMonitorDisplayReady &&
        (signalMatrixPriorityReady || signalMatrixBackgroundReady),
      bootstrapActive: signalHydrationBootstrapActive,
      bootstrapSymbols: signalMatrixBootstrapSymbols,
      bootstrapComplete: signalMatrixBootstrapComplete,
      profileBootstrapPending: signalMonitorProfileBootstrapPending,
      stateBootstrapComplete: signalMonitorStateBootstrapComplete,
      activeScreenRequestSymbolLimit: signalMatrixActiveScreenRequestSymbolLimit,
      activeScreenRequestTaskLimit: signalMatrixActiveScreenRequestTaskLimit,
      requestSymbolLimit: signalMatrixRequestSymbolLimit,
      requestTaskLimit: signalMatrixRequestTaskLimit,
      selectedTimeframe: lastPlan?.coverage?.selectedTimeframe ?? null,
      baseRequestSymbolLimit:
        lastPlan?.coverage?.baseRequestSymbolLimit ?? null,
      timeframeSymbolLimit:
        lastPlan?.coverage?.timeframeSymbolLimit ?? null,
      effectiveRequestSymbolLimit:
        lastPlan?.coverage?.effectiveRequestSymbolLimit ??
        lastPlan?.coverage?.requestSymbolLimit ??
        signalMatrixRequestSymbolLimit,
      requestTimeframes: signalMatrixRequestTimeframes,
      busyQueueDelayMs: signalMatrixBusyQueueDelayMs,
      catchupDelayMs: signalMatrixEffectiveCatchupDelayMs,
      requestTimeoutMs: SIGNAL_MATRIX_REQUEST_TIMEOUT_MS,
      inFlight: signalMatrixEvaluationInFlightRef.current,
      inFlightAgeMs:
        signalMatrixEvaluationInFlightRef.current &&
        signalMatrixEvaluationStartedAtRef.current
          ? Math.max(0, Date.now() - signalMatrixEvaluationStartedAtRef.current)
          : 0,
      globalInFlight: hasActiveSignalMatrixRequestLease(Date.now()),
      globalInFlightAgeMs:
        getSignalMatrixRequestCoordinator().startedAt > 0
          ? Math.max(
              0,
              Date.now() - getSignalMatrixRequestCoordinator().startedAt,
            )
          : 0,
      queued: signalMatrixQueuedEvaluationRef.current,
      universeSymbols: signalMatrixUniverseSymbols,
      prioritySymbols: signalMatrixPrioritySymbols,
      headerSignalContextSymbols,
      suggestedSignalSymbols: signalMatrixSuggestedSignalSymbols,
      stateCount: signalMatrixSnapshot.states.length,
      states: signalMatrixSnapshot.states.map((state) => ({
        symbol: state?.symbol,
        timeframe: state?.timeframe,
        status: state?.status,
        direction: state?.currentSignalDirection || null,
        fresh: Boolean(state?.fresh),
        latestBarAt: state?.latestBarAt || null,
        lastEvaluatedAt: state?.lastEvaluatedAt || null,
      })),
      skippedSymbols: signalMatrixSnapshot.skippedSymbols || [],
      truncated: Boolean(signalMatrixSnapshot.truncated),
      coverage: signalMatrixSnapshot.coverage || null,
      lastPlan: lastPlan
        ? {
            requestSymbols: lastPlan.requestSymbols,
            prioritySymbols: lastPlan.prioritySymbols,
            backgroundSymbols: lastPlan.backgroundSymbols,
            timeframes: lastPlan.timeframes,
            nextCursor: lastPlan.nextCursor,
            coverage: lastPlan.coverage,
          }
        : null,
    };

    window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__ = snapshot;
    return () => {
      if (window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__ === snapshot) {
        delete window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__;
      }
    };
  }, [
    memoryPressureLevel,
    memoryPressureSignal?.server?.apiPressureLevel,
    memoryPressureSignal?.server?.effectivePressureLevel,
    memoryPressureSignal?.server?.pressureLevel,
    signalMonitorWorkVisible,
    signalMatrixBackgroundReady,
    signalMatrixActiveScreenRequestSymbolLimit,
    signalMatrixActiveScreenRequestTaskLimit,
    signalMatrixRequestSymbolLimit,
    signalMatrixRequestTaskLimit,
    signalMatrixRequestTimeframes,
    signalMatrixRequestTimeframesKey,
    signalMatrixBusyQueueDelayMs,
    signalMatrixEffectiveCatchupDelayMs,
    signalMatrixPollMs,
    signalMatrixPressureLevel,
    signalMatrixPriorityReady,
    signalMatrixPrioritySymbols,
    headerSignalContextSymbols,
    signalHydrationBootstrapActive,
    signalMatrixBootstrapComplete,
    signalMatrixBootstrapSymbols,
    signalMatrixSuggestedSignalSymbols,
    signalMatrixSnapshot,
    signalMatrixStartupProtectionActive,
    signalMatrixSymbolsKey,
    signalMatrixUniverseSymbols,
    signalMonitorDisplayReady,
    signalMonitorProfileBootstrapPending,
    signalMonitorStateBootstrapComplete,
  ]);
  const scheduleSignalMatrixEvaluation = useCallback((delayMs = 0) => {
    const resolvedDelayMs = Math.max(0, Number(delayMs) || 0);
    signalMatrixQueuedEvaluationRef.current = true;
    signalMatrixQueuedEvaluationDelayMsRef.current = resolvedDelayMs;
    if (signalMatrixQueuedTimerRef.current != null) {
      window.clearTimeout(signalMatrixQueuedTimerRef.current);
    }
    signalMatrixQueuedTimerRef.current = window.setTimeout(() => {
      signalMatrixQueuedTimerRef.current = null;
      signalMatrixQueuedEvaluationRef.current = false;
      signalMatrixQueuedEvaluationDelayMsRef.current = null;
      signalMatrixRunRef.current?.({ queueIfBusy: true });
    }, resolvedDelayMs);
  }, []);
  const evaluateSignalMonitorMatrixMutation = useMutation({
    mutationFn: ({ data, signal }) =>
      evaluateSignalMonitorMatrix(data, {
        signal,
        timeoutMs: SIGNAL_MATRIX_REQUEST_TIMEOUT_MS,
      }),
    onSuccess: (data, variables) => {
      if (variables?.epoch !== signalMatrixRequestEpochRef.current) {
        return;
      }
	        signalMatrixRejectedExactCellLimitRef.current = null;
	        const lastPlan = signalMatrixLastPlanRef.current;
        const skippedSymbols = Array.isArray(data?.skippedSymbols)
          ? data.skippedSymbols
          : [];
        const profileDisabled = data?.profile?.enabled === false;
        if (profileDisabled) {
          signalMatrixQueuedEvaluationRef.current = false;
          signalMatrixQueuedEvaluationDelayMsRef.current = null;
          signalMatrixRotationCursorRef.current = 0;
          signalMatrixLastCatchupQueuedAtRef.current = 0;
          if (signalMatrixQueuedTimerRef.current != null) {
            window.clearTimeout(signalMatrixQueuedTimerRef.current);
            signalMatrixQueuedTimerRef.current = null;
          }
        }
        const expectedStateCount =
          (lastPlan?.requestSymbols?.length || 0) *
          (lastPlan?.timeframes?.length || SIGNAL_MATRIX_TIMEFRAMES.length);
        const responseTaskCount = Number(data?.coverage?.taskCount);
        const expectedResponseStateCount =
          Number.isFinite(responseTaskCount) && responseTaskCount > 0
            ? responseTaskCount
            : expectedStateCount;
        const responseRequestedSymbols = Number(data?.coverage?.requestedSymbols);
        const storedStateBootstrapResponse = Boolean(
          lastPlan?.coverage?.storedStateBootstrap,
        );
        const partialStatePayload =
          !profileDisabled &&
          !storedStateBootstrapResponse &&
          expectedResponseStateCount > 0 &&
          (!Number.isFinite(responseRequestedSymbols) ||
            responseRequestedSymbols > 0) &&
          (Array.isArray(data?.states) ? data.states.length : 0) <
            expectedResponseStateCount;
        const activeSignalsCatchupPending = Boolean(
          !profileDisabled &&
            signalMatrixEffectiveCatchupDelayMs != null &&
          signalsScreenMatrixSymbols.length > 0 &&
            (lastPlan?.coverage?.missingTaskCount ??
              lastPlan?.coverage?.missingSymbols ??
              0) >
              (lastPlan?.coverage?.requestTaskCount ??
                lastPlan?.requestSymbols?.length ??
                0),
        );
        const progressiveMatrixCatchupPending = Boolean(
          !profileDisabled &&
            signalMatrixEffectiveCatchupDelayMs != null &&
            (lastPlan?.coverage?.pendingTaskCount ??
              lastPlan?.coverage?.pendingSymbols ??
              0) > 0 &&
            (lastPlan?.requestSymbols?.length || 0) > 0,
        );
        const storedStateBootstrapCatchupPending = Boolean(
          !profileDisabled &&
            signalMatrixEffectiveCatchupDelayMs != null &&
            lastPlan?.coverage?.storedStateBootstrap &&
            (lastPlan?.coverage?.missingTaskCount ??
              lastPlan?.coverage?.missingSymbols ??
              0) > 0,
        );
        const responseStateCount = Array.isArray(data?.states)
          ? data.states.length
          : 0;
        if (
          progressiveMatrixCatchupPending &&
          responseStateCount > 0 &&
          !partialStatePayload
        ) {
          signalMatrixRotationCursorRef.current = 0;
        }

        if (
          !profileDisabled &&
          signalMatrixEffectiveCatchupDelayMs != null &&
          (data?.truncated || skippedSymbols.length || partialStatePayload)
        ) {
          signalMatrixRotationCursorRef.current = 0;
          const nowMs = Date.now();
          if (
            nowMs - signalMatrixLastCatchupQueuedAtRef.current >=
            SIGNAL_MATRIX_CATCHUP_COOLDOWN_MS
          ) {
            signalMatrixLastCatchupQueuedAtRef.current = nowMs;
            signalMatrixQueuedEvaluationRef.current = true;
            signalMatrixQueuedEvaluationDelayMsRef.current =
              data?.truncated || skippedSymbols.length
                ? Math.max(
                    SIGNAL_MATRIX_TRUNCATED_CATCHUP_DELAY_MS,
                    signalMatrixEffectiveCatchupDelayMs ?? 0,
                  )
                : signalMatrixStaVisibleRequestActive
                  ? signalMatrixEffectiveCatchupDelayMs
                  : Math.max(
                      SIGNAL_MATRIX_PARTIAL_CACHE_CATCHUP_DELAY_MS,
                      signalMatrixEffectiveCatchupDelayMs ?? 0,
                    );
          }
        } else if (activeSignalsCatchupPending) {
          signalMatrixQueuedEvaluationRef.current = true;
          signalMatrixQueuedEvaluationDelayMsRef.current =
            signalMatrixEffectiveCatchupDelayMs;
        } else if (storedStateBootstrapCatchupPending) {
          signalMatrixQueuedEvaluationRef.current = true;
          signalMatrixQueuedEvaluationDelayMsRef.current =
            signalMatrixEffectiveCatchupDelayMs;
        } else if (progressiveMatrixCatchupPending) {
          signalMatrixQueuedEvaluationRef.current = true;
          signalMatrixQueuedEvaluationDelayMsRef.current =
            signalMatrixEffectiveCatchupDelayMs;
        }

        setSignalMatrixSnapshot((current) => {
          const nextStates = mergeSignalMatrixStates({
            currentStates: current.states,
            incomingStates: data?.states || [],
            knownSymbols: signalMatrixUniverseRef.current,
          });
          signalMatrixStatesRef.current = nextStates;

          return {
            states: nextStates,
            timeframes:
              data?.timeframes || current.timeframes || SIGNAL_MATRIX_TIMEFRAMES,
            evaluatedAt: data?.evaluatedAt || current.evaluatedAt || null,
            skippedSymbols,
            truncated: Boolean(data?.truncated),
            coverage: {
              ...(lastPlan?.coverage || {}),
              ...(data?.coverage || {}),
              planCoverage: lastPlan?.coverage || null,
              cacheStatus: data?.cacheStatus || null,
              refreshing: Boolean(data?.refreshing),
              backgroundPaused: Boolean(lastPlan?.backgroundPaused),
            },
          };
	        });
    },
    onError: (error, variables) => {
      if (variables?.epoch !== signalMatrixRequestEpochRef.current) {
        return;
      }
	        const rejection = getSignalMatrixExactCellLimitRejection(error);
	        if (!rejection) {
	          return;
	        }
	        signalMatrixRejectedExactCellLimitRef.current = {
	          ...rejection,
	          observedAt: Date.now(),
	        };
	        signalMatrixQueuedEvaluationRef.current = true;
	        signalMatrixQueuedEvaluationDelayMsRef.current = 0;
    },
    onSettled: (_data, _error, variables) => {
      if (variables?.epoch !== signalMatrixRequestEpochRef.current) {
        return;
      }
        releaseSignalMatrixRequestLease(signalMatrixRequestOwnerRef.current);
        signalMatrixEvaluationInFlightRef.current = false;
        signalMatrixEvaluationStartedAtRef.current = 0;
        signalMatrixAbortControllerRef.current = null;
        if (!signalMatrixQueuedEvaluationRef.current) {
          return;
        }

        signalMatrixQueuedEvaluationRef.current = false;
        const delayMs = signalMatrixQueuedEvaluationDelayMsRef.current ?? 0;
        signalMatrixQueuedEvaluationDelayMsRef.current = null;
        scheduleSignalMatrixEvaluation(delayMs);
      },
  });
  const runSignalMatrixEvaluation = useCallback((options = {}) => {
    if (
      !signalMonitorWorkVisible ||
      signalMatrixStartupProtectionActive ||
      !signalMatrixUniverseSymbols.length ||
      !signalMonitorDisplayReady ||
      !(signalMatrixPriorityReady || signalMatrixBackgroundReady)
    ) {
      return;
    }
    const nowMs = Date.now();
    if (signalMatrixEvaluationInFlightRef.current) {
      if (options.queueIfBusy) {
        signalMatrixQueuedEvaluationRef.current = true;
        signalMatrixQueuedEvaluationDelayMsRef.current = Math.max(
          signalMatrixQueuedEvaluationDelayMsRef.current ?? 0,
          signalMatrixBusyQueueDelayMs,
        );
      }
      return;
    }
    const globalRequestInFlight = hasActiveSignalMatrixRequestLease(nowMs);
    if (globalRequestInFlight) {
      scheduleSignalMatrixEvaluation(
        options.queueIfBusy
          ? Math.max(
              signalMatrixBusyQueueDelayMs,
              SIGNAL_MATRIX_GLOBAL_BUSY_RETRY_MS,
            )
          : SIGNAL_MATRIX_GLOBAL_BUSY_RETRY_MS,
        );
      return;
    }
    const liveMemoryPressureSignal = getMemoryPressureSnapshot();
    const liveSignalMatrixPressureLevel = resolveSignalMatrixPressureLevel({
      memoryPressureLevel:
        liveMemoryPressureSignal?.level || signalMatrixPressureLevel,
      server: liveMemoryPressureSignal?.server || memoryPressureSignal?.server,
    });
    const liveSignalMatrixServerPressureObserved = Boolean(
      liveMemoryPressureSignal?.server?.effectivePressureLevel ||
        liveMemoryPressureSignal?.server?.apiPressureLevel ||
        liveMemoryPressureSignal?.server?.pressureLevel ||
        memoryPressureSignal?.server?.effectivePressureLevel ||
        memoryPressureSignal?.server?.apiPressureLevel ||
        memoryPressureSignal?.server?.pressureLevel,
    );
    const liveActiveSignalMatrixPressureLevel =
      liveSignalMatrixServerPressureObserved
        ? liveSignalMatrixPressureLevel
        : "normal";
	    const rejectedExactCellLimit =
	      signalMatrixRejectedExactCellLimitRef.current &&
	      nowMs - signalMatrixRejectedExactCellLimitRef.current.observedAt <=
	        SIGNAL_MATRIX_EXACT_CELL_LIMIT_RETRY_TTL_MS
	        ? signalMatrixRejectedExactCellLimitRef.current.maxCells
	        : null;
	    if (
	      signalMatrixRejectedExactCellLimitRef.current &&
	      rejectedExactCellLimit == null
	    ) {
	      signalMatrixRejectedExactCellLimitRef.current = null;
	    }
	    const baseLiveSignalMatrixRequestExactCellLimit =
	      signalMatrixRequestExactCellLimit == null
	        ? null
	        : signalMatrixStaVisibleRequestActive
	          ? resolveSignalMatrixStaVisiblePageExactCellLimit(
	              liveActiveSignalMatrixPressureLevel,
	            )
	          : resolveSignalMatrixExactCellLimit(liveActiveSignalMatrixPressureLevel);
	    const liveSignalMatrixRequestExactCellLimit =
	      baseLiveSignalMatrixRequestExactCellLimit == null
	        ? null
	        : rejectedExactCellLimit == null
	          ? baseLiveSignalMatrixRequestExactCellLimit
	          : Math.min(
	              baseLiveSignalMatrixRequestExactCellLimit,
	              rejectedExactCellLimit,
	            );
	    const baseLiveSignalMatrixRequestTaskLimit =
	      signalMatrixRequestTaskLimit == null
	        ? null
	        : signalMatrixStaVisibleRequestActive
	          ? resolveSignalMatrixStaVisiblePageRequestTaskLimit(
	              liveActiveSignalMatrixPressureLevel,
	            )
	          : resolveSignalMatrixActiveScreenRequestTaskLimit(
	              liveActiveSignalMatrixPressureLevel,
	            );
	    const liveSignalMatrixRequestTaskLimit =
	      baseLiveSignalMatrixRequestTaskLimit == null ||
	      liveSignalMatrixRequestExactCellLimit == null
	        ? baseLiveSignalMatrixRequestTaskLimit
	        : Math.min(
	            baseLiveSignalMatrixRequestTaskLimit,
	            liveSignalMatrixRequestExactCellLimit,
	          );
    if (!claimSignalMatrixRequestLease(signalMatrixRequestOwnerRef.current, nowMs)) {
      scheduleSignalMatrixEvaluation(
        options.queueIfBusy
          ? Math.max(
              signalMatrixBusyQueueDelayMs,
              SIGNAL_MATRIX_GLOBAL_BUSY_RETRY_MS,
            )
          : SIGNAL_MATRIX_GLOBAL_BUSY_RETRY_MS,
      );
      return;
    }
    const storedStateBootstrapRequest =
      buildSignalMatrixStoredStateBootstrapRequest({
          symbols: signalMatrixUniverseSymbols,
          currentStates: signalMatrixStatesRef.current,
          timeframes: signalMatrixRequestTimeframes,
          lastBootstrapKey: signalMatrixStoredStateBootstrapKeyRef.current,
        });
    const plan = storedStateBootstrapRequest
      ? {
          requestSymbols: storedStateBootstrapRequest.symbols,
          prioritySymbols: storedStateBootstrapRequest.symbols,
          backgroundSymbols: [],
          timeframes: storedStateBootstrapRequest.timeframes,
          matrixTimeframes: storedStateBootstrapRequest.timeframes,
          requestCells: [],
          missingCells: [],
          nextCursor: signalMatrixRotationCursorRef.current,
          backgroundReady: signalMatrixBackgroundReady,
          backgroundPaused: false,
          startupProtectionActive: false,
          pressureLevel: liveActiveSignalMatrixPressureLevel,
          coverage: storedStateBootstrapRequest.coverage,
        }
      : buildSignalMatrixRequestPlan({
          symbols: signalMatrixUniverseSymbols,
          prioritySymbols: signalMatrixPrioritySymbols,
          currentStates: signalMatrixStatesRef.current,
          timeframes: signalMatrixRequestTimeframes,
          pressureLevel: liveActiveSignalMatrixPressureLevel,
          backgroundReady: signalMatrixBackgroundReady,
          startupProtectionActive: signalMatrixStartupProtectionActive,
          cursor: signalMatrixRotationCursorRef.current,
          pollMs: signalMatrixPollMs,
          nowMs,
          requestSymbolLimit: signalMatrixRequestSymbolLimit,
          requestTaskLimit: liveSignalMatrixRequestTaskLimit,
          requestExactCellLimit: liveSignalMatrixRequestExactCellLimit,
        });
    if (!plan.requestSymbols.length) {
      releaseSignalMatrixRequestLease(signalMatrixRequestOwnerRef.current);
      if (signalMatrixSurfaceRequestActive && !signalMatrixRouteRequestActive) {
        setSignalsScreenMatrixRequest((current) =>
          current.symbols.length
            ? {
                clientRole: null,
                prioritySymbols: [],
                reason: null,
                requestOrigin: null,
                symbols: [],
                timeframes: SIGNAL_MATRIX_TIMEFRAMES,
                revision: current.revision + 1,
              }
            : current,
        );
      }
      return;
    }
    if (storedStateBootstrapRequest) {
      signalMatrixStoredStateBootstrapKeyRef.current =
        storedStateBootstrapRequest.key;
    } else {
      signalMatrixRotationCursorRef.current = plan.nextCursor;
    }
    signalMatrixLastPlanRef.current = plan;
    signalMatrixEvaluationInFlightRef.current = true;
    signalMatrixEvaluationStartedAtRef.current = Date.now();
    const optimisticPendingRequestCells =
      plan.requestCells.length > SIGNAL_MATRIX_OPTIMISTIC_PENDING_CELL_LIMIT
        ? plan.requestCells.slice(0, SIGNAL_MATRIX_OPTIMISTIC_PENDING_CELL_LIMIT)
        : plan.requestCells;
    const pendingMatrixStates = buildSignalMatrixPendingStates({
      requestCells: optimisticPendingRequestCells,
      currentStates: signalMatrixStatesRef.current,
      evaluatedAt: new Date(signalMatrixEvaluationStartedAtRef.current).toISOString(),
    });
    if (pendingMatrixStates.length) {
      setSignalMatrixSnapshot((current) => {
        const nextStates = mergeSignalMatrixStates({
          currentStates: current.states,
          incomingStates: pendingMatrixStates,
          knownSymbols: signalMatrixUniverseRef.current,
        });
        if (signalMatrixStatesEqual(current.states, nextStates)) {
          return current;
        }
        signalMatrixStatesRef.current = nextStates;
        return {
          ...current,
          states: nextStates,
          timeframes: current.timeframes || SIGNAL_MATRIX_TIMEFRAMES,
          coverage: {
            ...(current.coverage || {}),
            optimisticPendingCellCount: pendingMatrixStates.length,
            pendingCellCount: plan.requestCells.length,
          },
        };
      });
    }
    const automaticRequestOrigin =
      signalMatrixAutomaticRunCountRef.current === 0 ? "startup" : "poll";
    signalMatrixAutomaticRunCountRef.current += 1;
    const requestEpoch = signalMatrixRequestEpochRef.current + 1;
    signalMatrixRequestEpochRef.current = requestEpoch;
    const abortController =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    signalMatrixAbortControllerRef.current = abortController;
    evaluateSignalMonitorMatrixMutation.mutate({
      epoch: requestEpoch,
      signal: abortController?.signal,
      data: {
        environment: signalMonitorEnvironment,
        watchlistId: null,
        cells: storedStateBootstrapRequest ? undefined : plan.requestCells,
        symbols: storedStateBootstrapRequest
          ? storedStateBootstrapRequest.symbols
          : plan.requestSymbols,
        timeframes: storedStateBootstrapRequest
          ? storedStateBootstrapRequest.timeframes
          : plan.timeframes,
        clientRole: signalsScreenMatrixClientRole || signalMatrixRequestClientRole,
        requestOrigin:
          signalsScreenMatrixRequestOrigin || automaticRequestOrigin,
      },
    });
  }, [
    evaluateSignalMonitorMatrixMutation.mutate,
    signalMatrixPressureLevel,
    signalMatrixRequestSymbolLimit,
    signalMatrixRequestTaskLimit,
    signalMatrixRequestExactCellLimit,
    signalMatrixRequestTimeframes,
    signalMatrixRequestTimeframesKey,
    signalMatrixBusyQueueDelayMs,
    signalMatrixEffectiveCatchupDelayMs,
    scheduleSignalMatrixEvaluation,
    memoryPressureSignal?.server?.apiPressureLevel,
    memoryPressureSignal?.server?.effectivePressureLevel,
    memoryPressureSignal?.server?.pressureLevel,
    signalMonitorWorkVisible,
    signalMonitorEnvironment,
    signalMatrixBackgroundReady,
    signalMatrixPrioritySymbols,
    signalMatrixPrioritySymbolsKey,
    signalMatrixPriorityReady,
    signalMatrixPollMs,
    signalMatrixSymbolsKey,
    signalMatrixUniverseSymbols,
    signalMonitorDisplayReady,
    signalMatrixRequestActive,
    signalMatrixRequestClientRole,
    signalMatrixRouteRequestActive,
    signalMatrixStartupProtectionActive,
    signalMatrixStaVisibleRequestActive,
    signalMatrixSurfaceRequestActive,
    signalsScreenMatrixClientRole,
    signalsScreenMatrixRequestOrigin,
    screen,
  ]);
  useEffect(() => {
    signalMatrixRunRef.current = runSignalMatrixEvaluation;
  }, [runSignalMatrixEvaluation]);
  useEffect(() => {
    if (!signalMatrixRuntimeReady || !signalsScreenMatrixSymbols.length) {
      return;
    }
    signalMatrixRunRef.current?.({ queueIfBusy: true });
  }, [
    signalMatrixRuntimeReady,
    signalsScreenMatrixRequest.revision,
    signalsScreenMatrixSymbols.length,
    signalsScreenMatrixSymbolsKey,
  ]);
  useEffect(
    () => () => {
      if (signalMatrixQueuedTimerRef.current != null) {
        window.clearTimeout(signalMatrixQueuedTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!signalMatrixRuntimeReady || typeof window === "undefined") {
      return undefined;
    }

    const watchdogMs =
      SIGNAL_MATRIX_REQUEST_TIMEOUT_MS + SIGNAL_MATRIX_REQUEST_WATCHDOG_GRACE_MS;
    const interval = window.setInterval(() => {
      if (!signalMatrixEvaluationInFlightRef.current) {
        return;
      }
      const startedAt = signalMatrixEvaluationStartedAtRef.current;
      if (!startedAt || Date.now() - startedAt < watchdogMs) {
        return;
      }

      signalMatrixEvaluationInFlightRef.current = false;
      signalMatrixEvaluationStartedAtRef.current = 0;
      releaseSignalMatrixRequestLease(signalMatrixRequestOwnerRef.current);
      signalMatrixQueuedEvaluationRef.current = false;
      signalMatrixQueuedEvaluationDelayMsRef.current = null;
      signalMatrixRunRef.current?.();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [signalMatrixRuntimeReady]);
  useEffect(() => {
    if (!signalMatrixRuntimeReady) {
      return undefined;
    }

    runSignalMatrixEvaluation({ queueIfBusy: true });
    const interval = window.setInterval(
      runSignalMatrixEvaluation,
      signalMatrixPollMs,
    );
    return () => window.clearInterval(interval);
  }, [
    runSignalMatrixEvaluation,
    signalMatrixRuntimeReady,
    signalMatrixPrioritySymbolsKey,
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
    () => [...new Set(quoteSymbols)],
    [quoteSymbols],
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
    const clamped = Math.max(
      1,
      Math.min(SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT, Math.round(numeric)),
    );
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
  const handleApplySignalMonitorPyrusSettings = useCallback((nextSettings) => {
    const pyrusSignalsSettings = buildSignalMonitorPyrusSettingsPatch(
      signalMonitorProfile?.pyrusSignalsSettings,
      nextSettings,
    );
    return updateSignalMonitorProfileMutation.mutateAsync(
      {
        data: {
          environment: signalMonitorEnvironment,
          pyrusSignalsSettings,
        },
      },
      {
        onSuccess: (profile) => {
          pushToast({
            title: "Signal settings applied",
            body: "Pyrus indicator controls saved; running a fresh scan.",
            kind: "success",
          });
          if (profile?.enabled) {
            runSignalMonitorEvaluation("incremental");
            signalMatrixRunRef.current?.({ queueIfBusy: true });
          }
        },
      },
    );
  }, [
    runSignalMonitorEvaluation,
    signalMonitorEnvironment,
    signalMonitorProfile?.pyrusSignalsSettings,
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
      signalMonitorEnvironment={signalMonitorEnvironment}
      signalMonitorSymbols={signalMonitorSymbols}
      signalMonitorDisplaySymbols={signalMonitorDisplaySymbols}
      signalMonitorEvents={signalMonitorEvents}
      signalMonitorEventsLoaded={Boolean(
        signalMonitorEventsQuery.data || signalMonitorEventsQuery.isFetched,
      )}
      signalMatrixStates={signalMatrixSnapshot.states}
      signalMatrixCoverage={signalMatrixSnapshot.coverage || null}
      marketScreenActive={marketScreenActive}
      flowScreenActive={flowScreenActive}
      researchConfigured={researchConfigured}
      safeQaMode={safeQaMode}
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
      onChangeMonitorFreshWindowBars={handleChangeSignalMonitorFreshWindowBars}
      onChangeMonitorMaxSymbols={handleChangeSignalMonitorMaxSymbols}
      onApplyPyrusSignalsSettings={handleApplySignalMonitorPyrusSettings}
      onRequestSignalMatrixHydration={handleRequestSignalMatrixHydration}
      onJumpToTradeFromSignals={handleJumpToTradeFromResearch}
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
    handleChangeSignalMonitorFreshWindowBars,
    handleChangeSignalMonitorMaxSymbols,
    handleChangeSignalMonitorTimeframe,
    handleChangeSignalMonitorWatchlist,
    handleFocusMarketChart,
    handleJumpToTradeFromFlow,
    handleJumpToTradeFromResearch,
    handleJumpToTradeFromSignalOptionsCandidate,
    handleApplySignalMonitorPyrusSettings,
    handleRunSignalMonitorNow,
    handleRequestSignalMatrixHydration,
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
    safeQaMode,
    screen,
    session,
    sidebarCollapsed,
    signalMatrixSnapshot.states,
    signalMonitorEnvironment,
    signalMonitorDisplaySymbols,
    signalMonitorEvents,
    signalMonitorEventsQuery.data,
    signalMonitorEventsQuery.isFetched,
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
        quoteSymbols={safeQaMode ? [] : runtimeQuoteSymbols}
        sparklineSymbols={safeQaMode ? [] : runtimeSparklineSymbols}
        prioritySparklineSymbols={safeQaMode ? [] : prioritySparklineSymbols}
        streamedQuoteSymbols={safeQaMode ? [] : runtimeStreamedQuoteSymbols}
        streamedAggregateSymbols={safeQaMode ? [] : runtimeStreamedAggregateSymbols}
        quoteStreamRuntimeEnabled={
          !safeQaMode &&
          workSchedule.streams.watchlistQuoteStream &&
          !priorityScreenCodePreloadPending &&
          !signalHydrationBootstrapActive
        }
        positionQuoteStreamRuntimeEnabled={
          !safeQaMode &&
          workSchedule.streams.positionQuoteStream
        }
        quoteStreamDisabledReason={quoteStreamGateReason}
        quoteStreamCoverageDiagnostics={watchlistQuoteStreamDiagnostics}
        marketStockAggregateStreamingEnabled={
          !safeQaMode &&
          workSchedule.streams.marketStockAggregates &&
          !priorityScreenCodePreloadPending &&
          !signalHydrationBootstrapActive
        }
        marketScreenActive={marketScreenActive}
        lowPriorityHistoryEnabled={
          !safeQaMode &&
          workSchedule.streams.lowPriorityHistory &&
          !priorityScreenCodePreloadPending &&
          !signalHydrationBootstrapActive
        }
        sparklineHistoryEnabled={
          !safeQaMode &&
          platformPressureCaps.sparklineEnabled &&
          !signalHydrationBootstrapActive
        }
        sparklineConcurrency={platformPressureCaps.sparklineConcurrency}
        flowRuntimeEnabled={
          workSchedule.streams.sharedFlowRuntime &&
          !priorityScreenCodePreloadPending
        }
        flowRuntimeIntervalMs={
          marketScreenActive || flowScreenActive ? 10_000 : 30_000
        }
        broadFlowRuntimeEnabled={
          workSchedule.streams.broadFlowRuntime &&
          !priorityScreenCodePreloadPending
        }
        broadFlowScannerConfig={platformPressureCaps.broadFlowScannerConfig}
        platformFreshnessBus={platformFreshnessBus}
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
            apiSourcePressureSnapshot={footerApiSourceRuntime.snapshot}
            activeWatchlist={activeWatchlist}
            watchlistSymbols={watchlistSymbols}
            signalMonitorStates={signalMonitorStates}
            signalMonitorProfile={signalMonitorProfile}
            signalMonitorEvents={signalMonitorEvents}
            signalMonitorEventsLoaded={Boolean(
              signalMonitorEventsQuery.data || signalMonitorEventsQuery.isFetched,
            )}
            signalMatrixStates={signalMatrixSnapshot.states}
            headerSignalMatrixStates={headerBroadcastSignalMatrixStates}
            onRequestSignalMatrixHydration={handleRequestSignalMatrixHydration}
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
            safeQaMode={safeQaMode}
            runtimeWatchlistSymbols={runtimeWatchlistSymbols}
            sessionMetadataSettled={sessionMetadataSettled}
            auxiliarySurfacesReady={auxiliarySurfacesReady}
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
