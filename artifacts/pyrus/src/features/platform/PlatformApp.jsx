import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Suspense,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isPyrusSafeQaMode } from "../../app/qa-mode";
import { NeuralLoader } from "../../components/neural/NeuralLoader";
import {
  getGetNewsQueryOptions,
  getGetQuoteSnapshotsQueryOptions,
  getGetResearchEarningsCalendarQueryOptions,
  getGetSessionQueryKey,
  getGetSignalMonitorProfileQueryKey,
  getListAlgoDeploymentsQueryOptions,
  getListBacktestDraftStrategiesQueryOptions,
  getListSignalMonitorEventsQueryKey,
  getListWatchlistsQueryKey,
  listSignalMonitorEvents,
  useEvaluateSignalMonitor,
  useGetSignalMonitorProfile,
  useGetSession,
  useListAccounts,
  useListPositions,
  useListWatchlists,
  useUpdateSignalMonitorProfile,
} from "@workspace/api-client-react";
import { getActiveChartBarStoreEntryCount } from "../charting/activeChartBarStore";
import {
  getChartHydrationStatsSnapshot,
  sanitizeChartHydrationStatsForDiagnostics,
} from "../charting/chartHydrationStats";
import { resolvePyrusSignalsRuntimeSettings } from "../charting/pyrusSignalsPineAdapter";
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
  useSignalMonitorMatrixStream,
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
import { useCriticalApiMutationPause } from "./criticalApiMutationPause.js";
import { HeaderAccountStrip } from "./HeaderAccountStrip.jsx";
import { HEADER_KPI_SYMBOLS, HeaderKpiStrip } from "./HeaderKpiStrip.jsx";
// HeaderStatusCluster is a large (~101KB) header chunk. Split it out of the
// eager PlatformApp chunk and lazy-load it, eagerly warming the chunk at module
// load so it typically resolves before the header paints. Name + prop contract
// preserved so downstream render sites need no changes. Its only fallback risk
// is a brief horizontal reflow of adjacent header items (it sits in a
// fixed-height header row), which eager preload makes near-zero.
const loadHeaderStatusCluster = () =>
  import("./HeaderStatusCluster.jsx").then((m) => ({
    default: m.MemoHeaderStatusCluster,
  }));
const LazyHeaderStatusCluster = lazyWithRetry(loadHeaderStatusCluster, {
  label: "HeaderStatusCluster",
});
void preloadDynamicImport(loadHeaderStatusCluster, {
  label: "HeaderStatusCluster",
});
const MemoHeaderStatusCluster = (props) => (
  <Suspense fallback={null}>
    <LazyHeaderStatusCluster {...props} />
  </Suspense>
);
// HeaderBroadcastScrollerStack stays eagerly imported on purpose: it is a
// full-width, multi-lane above-the-fold row (3-row CSS grid) whose height is
// dim()-scaled and varies by phone/collapsed state, so a Suspense fallback
// cannot reserve its height reliably — lazy-loading it would risk a vertical
// layout shift. Keeping it eager costs ~35KB but guarantees no header pop.
import { HeaderBroadcastScrollerStack } from "./HeaderBroadcastScrollerStack.jsx";
import { buildHeaderSignalContextSymbols } from "./headerBroadcastModel.js";
import { MemoWatchlistContainer } from "./PlatformWatchlist.jsx";
import { LatencyDebugStrip } from "./LatencyDebugStrip.jsx";
import { normalizeTickerSymbol } from "./tickerIdentity";
import {
  ensureTradeTickerInfo,
  getRuntimeTickerStoreEntryCount,
} from "./runtimeTickerStore";
import { applyRuntimeSignalStatePrices } from "./runtimeMarketDataModel";
import {
  buildSignalMatrixSymbolSets,
  mergeSignalMatrixStreamSnapshot,
  mergeSignalMatrixStates,
  resolveSignalMatrixActiveScreenRequestTaskLimit,
  resolveSignalMatrixActiveScreenRequestSymbolLimit,
  resolveSignalMatrixExactCellLimit,
} from "./signalMatrixScheduler.js";
import {
  WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
  WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
  WATCHLIST_QUOTE_STREAM_ROTATION_MS,
  buildWatchlistQuoteRotationBatch,
  buildWatchlistQuoteRotationDiagnostics,
  resolveWatchlistQuoteStreamBatchSize,
} from "./watchlistQuoteRotation.js";
import { QUERY_DEFAULTS } from "./queryDefaults";
import {
  bridgeRuntimeTone,
  resolveGatewayTradingReadiness,
} from "./bridgeRuntimeModel";
import {
  BOOT_SCREEN_MODULE_PRELOAD_ORDER,
  SCREENS,
  SCREEN_MODULE_PRELOAD_ORDER,
  buildMountedScreenState,
  getScreenModulePreloadSnapshot,
  preloadScreenModule,
} from "./screenRegistry.jsx";
import {
  resolveBootBlockingTaskIds,
  resolveScreenBootDataDeps,
} from "./bootPolicy.js";
import {
  EMPTY_SCREEN_READINESS,
  normalizeScreenReadinessPatch,
} from "./screenReadinessPolicy.js";
import {
  readBootWarmStart,
  shouldRunStartupRefresh,
  writeBootWarmStart,
} from "./bootWarmStartCache.js";
import { getMarketFlowStoreEntryCount } from "./marketFlowStore";
import { normalizeSignalMonitorTimeframe } from "./marketActivityLaneModel";
import { publishMarketAlertsSnapshot } from "./marketAlertsStore";
import { publishSignalMonitorSnapshot } from "./signalMonitorStore";
import {
  useAlgoStaExecutionTimeframe,
  useAlgoStaMtfTimeframes,
} from "./algoStaExecutionTimeframeStore.js";
import {
  isSignalMonitorDegradedProfile,
  isSignalMonitorRuntimeFallbackProfile,
} from "./signalMonitorStatusModel";
import {
  buildWatchlistIdentityPayload,
  buildWatchlistRows,
} from "./watchlistModel";
import { getTradeFlowStoreEntryCount } from "./tradeFlowStore";
import { getTradeOptionChainStoreEntryCount } from "./tradeOptionChainStore";
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
  shouldRunSignalMatrixStream,
  shouldRunSignalMonitorDisplay,
} from "./appWorkScheduler.js";
import {
  createPlatformFreshnessBus,
  usePlatformFreshnessQueryHydration,
  usePlatformFreshnessQueryPublisher,
} from "./platformFreshnessBus";
import { resolveIbkrWorkPressure } from "./workPressureModel.js";
import { _initialState, persistState } from "../../lib/workspaceState";
import { lazyWithRetry, preloadDynamicImport } from "../../lib/dynamicImport";
import { normalizeInitialPlatformScreen } from "./initialPlatformScreen";
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
  getBootProgressSnapshot,
  reclassifyBootBlocking,
  skipBootProgressTasks,
  startBootProgressTask,
  useBootProgress,
} from "../../app/bootProgress";

const SCREEN_ID_SET = new Set(SCREENS.map(({ id }) => id));
const readInitialUrlScreen = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const requested = new URLSearchParams(window.location.search).get("screen");
    const normalizedScreen = requested === "unusual" ? "flow" : requested;
    return normalizedScreen && SCREEN_ID_SET.has(normalizedScreen)
      ? normalizedScreen
      : null;
  } catch {
    return null;
  }
};
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
  let sourceStatus = "database";

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
    sourceStatus = page.sourceStatus || sourceStatus;
    events.push(...(page.events || []));
    if (!page.hasMore || !page.nextCursor) {
      return {
        events,
        nextCursor: null,
        hasMore: false,
        sourceStatus,
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
    sourceStatus,
  };
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
@keyframes toastProgress{from{transform:scaleX(1)}to{transform:scaleX(0)}}
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
@keyframes brokerRingArc{to{stroke-dashoffset:-100}}
@keyframes brokerRingBreathe{0%,100%{opacity:.42}50%{opacity:1}}
@keyframes brokerRingSweep{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
@keyframes brokerRingGlow{0%,100%{filter:drop-shadow(0 0 0 transparent)}45%{filter:drop-shadow(0 0 6px var(--broker-ring-color,transparent))}}
@keyframes brokerRingSheen{from{stroke-dashoffset:0}to{stroke-dashoffset:-100}}
@keyframes brokerCheckPop{0%{opacity:0;transform:scale(.6)}70%{opacity:1;transform:scale(1.18)}100%{opacity:1;transform:scale(1)}}
@keyframes brokerCheckDraw{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}
@keyframes brokerErrorShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-2px)}40%{transform:translateX(2px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
[data-broker-check="draw"] path,[data-broker-check="draw"] polyline{stroke-dasharray:24;animation:brokerCheckDraw var(--motion-base,300ms) var(--ease-out-quart,cubic-bezier(0.25,1,0.5,1)) 700ms both}
@media (prefers-reduced-motion: reduce){[data-broker-ring],[data-broker-ring] *,[data-broker-check],[data-broker-check] *{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-pulse-hit]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-premium-flow-glyph]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-wave] *{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-ibkr-bridge-spinner],[data-ibkr-operation-title-spinner],[data-ibkr-deactivate-activity-glyph] svg,[data-ibkr-deactivate-progress-track] span,[data-ibkr-state-pulse],[data-ibkr-step-complete] *,[data-ibkr-step-motion],[data-ibkr-step-motion] *,[data-ibkr-step-line]{animation:none!important}}
@media (prefers-reduced-motion: reduce){[data-header-broadcast-track]{animation:none!important;transform:none!important}}
[data-header-broadcast-viewport]:hover [data-header-broadcast-track],[data-header-broadcast-viewport]:focus-within [data-header-broadcast-track]{animation-play-state:paused!important}
`;

const SESSION_QUERY_KEY = getGetSessionQueryKey();
const EMPTY_UNIVERSE_SYMBOLS = Object.freeze([]);
const SESSION_REFETCH_INTERVAL_MS = 20_000;
// Hard cap on the boot overlay: if a blocking task never settles, release the
// overlay but preserve whether the first screen actually reported visible content.
const BOOT_OVERLAY_WATCHDOG_MS = 8_000;
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
const SIGNAL_MATRIX_FULL_TIMEFRAMES_KEY = SIGNAL_MATRIX_TIMEFRAMES.join(",");
const SIGNAL_MATRIX_STA_BOOTSTRAP_TIMEFRAMES = Object.freeze([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
]);
const SIGNAL_MATRIX_FULL_TIMEFRAME_WIDEN_DELAY_MS = 1_500;
const AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED = false;
const PRIORITY_SCREEN_MODULE_PRELOAD_ORDER = [
  "account",
  "signals",
  "trade",
  "algo",
];
const PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS = 0;
const OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS = 0;
const OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS = 0;
const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;
const WATCHLIST_SIDEBAR_WIDTH_MIN = 196;
const WATCHLIST_SIDEBAR_WIDTH_MAX = 320;
const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;
const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;
const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;
const RECENT_SIGNAL_QUOTE_PIN_MS = 30 * 60_000;
const HEADER_SIGNAL_MATRIX_SYMBOL_LIMIT = 24;

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

const filterSignalMatrixStatesForSymbols = ({
  states = [],
  symbols = [],
  maxStates = null,
}) => {
  const symbolSet = new Set(normalizeSignalMatrixRequestSymbols(symbols));
  if (!symbolSet.size) {
    return [];
  }

  const boundedStates = [];
  const resolvedMaxStates =
    Number.isFinite(maxStates) && maxStates > 0 ? Math.floor(maxStates) : null;
  for (const state of Array.isArray(states) ? states : []) {
    if (
      resolvedMaxStates != null &&
      boundedStates.length >= resolvedMaxStates
    ) {
      break;
    }
    const symbol = normalizeTickerSymbol(state?.symbol);
    if (!symbol || !symbolSet.has(symbol)) {
      continue;
    }
    boundedStates.push(state);
  }
  return boundedStates;
};

// Must match the backend SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT (api-server signal-monitor.ts);
// clamps the operator's maxSymbols input + FE universe slicing. Raised 500 -> 2000 with
// the backend. (Also duplicated in SignalsScreen.jsx — keep in lockstep.)
const SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT = 2000;
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

const resolveSignalMonitorUniverseSource = (universeScope) =>
  universeScope === "selected_watchlist"
    ? "selected_watchlist"
    : universeScope === "all_watchlists"
      ? "all_watchlists"
      : universeScope === "high_beta_500"
        ? "high_beta_500"
        : "watchlists_plus_ranked_universe";

const resolveSignalMonitorUniverseSymbolLimit = (maxSymbols) => {
  const numeric = Number(maxSymbols);
  if (!Number.isFinite(numeric)) {
    return SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT;
  }
  return Math.min(
    SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
    Math.max(1, Math.floor(numeric)),
  );
};

const normalizeSignalMonitorUniverseSymbols = (
  symbols = [],
  maxSymbols = SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
) => {
  const limit = resolveSignalMonitorUniverseSymbolLimit(maxSymbols);
  const seen = new Set();
  const result = [];
  (Array.isArray(symbols) ? symbols : []).forEach((symbol) => {
    if (result.length >= limit) return;
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result.length ? result : EMPTY_UNIVERSE_SYMBOLS;
};

const normalizeSignalMatrixStreamTimeframes = (
  timeframes,
  fallback = SIGNAL_MATRIX_STA_BOOTSTRAP_TIMEFRAMES,
) => {
  const selected = new Set();
  const source = Array.isArray(timeframes) ? timeframes : [timeframes];
  source.forEach((timeframe) => {
    const normalized = String(timeframe || "").trim();
    if (SIGNAL_MATRIX_TIMEFRAME_SET.has(normalized)) {
      selected.add(normalized);
    }
  });
  if (!selected.size) {
    return Array.isArray(fallback) ? [...fallback] : [];
  }
  return SIGNAL_MATRIX_TIMEFRAMES.filter((timeframe) =>
    selected.has(timeframe),
  );
};

const buildSignalMatrixStaBootstrapTimeframes = ({
  staExecutionTimeframe,
  staMtfTimeframes,
  profileTimeframe,
} = {}) => {
  const liveStaTimeframes = normalizeSignalMatrixStreamTimeframes(
    staMtfTimeframes,
    [],
  );
  if (liveStaTimeframes.length) {
    return liveStaTimeframes;
  }
  return normalizeSignalMatrixStreamTimeframes(
    [
      ...SIGNAL_MATRIX_STA_BOOTSTRAP_TIMEFRAMES,
      staExecutionTimeframe,
      profileTimeframe,
    ],
    SIGNAL_MATRIX_STA_BOOTSTRAP_TIMEFRAMES,
  );
};

const SIGNAL_MONITOR_LOCAL_EXPANSION_SYMBOLS = Object.freeze(
  normalizeSignalMonitorUniverseSymbols([
    ...WATCHLIST.map((item) => item.sym),
    ...MARKET_SNAPSHOT_SYMBOLS,
    ...HEADER_KPI_SYMBOLS,
  ]),
);

const buildSignalMonitorPyrusSettingsPatch = (
  currentSettings,
  draftSettings,
) => {
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
const PLATFORM_PRESSURE_LEVELS = new Set(["normal", "watch", "high"]);
const PLATFORM_PRESSURE_LEVEL_RANK = {
  normal: 0,
  watch: 1,
  high: 2,
};

const normalizePlatformPressureLevel = (level) =>
  PLATFORM_PRESSURE_LEVELS.has(level) ? level : null;

const maxPlatformPressureLevel = (...levels) =>
  levels.reduce((maxLevel, level) => {
    const normalized = normalizePlatformPressureLevel(level);
    if (!normalized) return maxLevel;
    return PLATFORM_PRESSURE_LEVEL_RANK[normalized] >
      PLATFORM_PRESSURE_LEVEL_RANK[maxLevel]
      ? normalized
      : maxLevel;
  }, "normal");

const resolveServerResourcePressureLevel = (server) =>
  normalizePlatformPressureLevel(server?.resourceLevel);

const resolveSignalMatrixPressureLevel = ({ memoryPressureLevel, server }) => {
  const appLevel =
    normalizePlatformPressureLevel(memoryPressureLevel) || "normal";
  const serverResourceLevel = resolveServerResourcePressureLevel(server);
  if (serverResourceLevel) {
    return maxPlatformPressureLevel(appLevel, serverResourceLevel);
  }
  const serverFallbackLevel =
    normalizePlatformPressureLevel(server?.effectivePressureLevel) ||
    normalizePlatformPressureLevel(server?.apiPressureLevel) ||
    normalizePlatformPressureLevel(server?.pressureLevel);
  return maxPlatformPressureLevel(appLevel, serverFallbackLevel);
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

const RECENT_SIGNAL_MARKET_DATA_SYMBOL_LIMIT = 16;
const WATCHLIST_MARKET_DATA_SYMBOL_LIMIT = 48;
const HEADER_SIGNAL_MATRIX_STATE_LIMIT =
  (HEADER_SIGNAL_MATRIX_SYMBOL_LIMIT + 1) * SIGNAL_MATRIX_TIMEFRAMES.length;
const WATCHLIST_SIGNAL_MATRIX_STATE_LIMIT =
  WATCHLIST_MARKET_DATA_SYMBOL_LIMIT * SIGNAL_MATRIX_TIMEFRAMES.length;

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
    .slice(0, RECENT_SIGNAL_MARKET_DATA_SYMBOL_LIMIT);
};

const resolveQuoteStreamGateReason = ({
  workspaceLeader,
  sessionMetadataSettled,
  brokerConfigured,
  brokerAuthenticated,
  massiveStockRealtimeConfigured,
  quoteStreamEnabled,
}) => {
  if (!workspaceLeader) return "workspace-passive";
  if (!sessionMetadataSettled) return "session-not-ready";
  if (!brokerConfigured && !massiveStockRealtimeConfigured) {
    return "market-data-not-configured";
  }
  if (!brokerAuthenticated && !massiveStockRealtimeConfigured) {
    return "ibkr-not-ready";
  }
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

const scheduleReadinessWork = (callback) => {
  if (typeof window === "undefined") {
    return () => {};
  }
  if (typeof window.requestAnimationFrame === "function") {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame?.(frameId);
  }
  const timerId = window.setTimeout(callback, 0);
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

  const source = window.__PYRUS_PERF_WARMUP_OVERRIDES__ || {};
  const overrides =
    source && typeof source === "object" && !Array.isArray(source)
      ? source
      : {};

  return {
    disableOperationalCodePreload:
      overrides.disableOperationalCodePreload === true,
    disableHiddenScreenWarmMount:
      overrides.disableHiddenScreenWarmMount === true,
    disableBackgroundDataWarmup: overrides.disableBackgroundDataWarmup === true,
    disableResearchWorkspacePreload:
      overrides.disableResearchWorkspacePreload === true,
  };
};

const publishWarmupSnapshot = (snapshot) => {
  if (typeof window === "undefined") {
    return;
  }
  window.__PYRUS_PERF_WARMUP_SNAPSHOT__ = snapshot;
};

const platformNowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const EMPTY_BACKGROUND_RESUME_READY = {
  screen: null,
  signalDisplay: false,
  signalMatrix: false,
};
const EMPTY_SIGNAL_MONITOR_STATES = Object.freeze([]);
const EMPTY_SIGNAL_MONITOR_EVENTS = Object.freeze([]);
// React-query errors do not carry a typed rate-limit flag, so sniff the status
// / message the same way describeUserFacingRuntimeError does (429, route
// admission, request shed). Used to paint the SIGNALS lane amber ("retrying")
// rather than red (hard failure) when the backend is pacing requests.
const isSignalTransportRateLimitError = (error) => {
  if (!error) return false;
  const status = Number(error.status ?? error.response?.status);
  if (status === 429) return true;
  const text = [
    error.message,
    error.detail,
    error.body,
    error.data?.message,
    error.data?.detail,
    error.response?.data?.message,
    error.response?.data?.detail,
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .join(" ");
  return (
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("route admission") ||
    text.includes("request shed")
  );
};
const SIGNAL_MATRIX_RETIRED_SNAPSHOT_CACHE_KEYS = Object.freeze([
  "pyrus:signal-matrix-snapshot:v5",
  "pyrus:signal-matrix-snapshot:v4",
  "pyrus:signal-matrix-snapshot:v3",
  "pyrus:signal-matrix-snapshot:v2",
  "pyrus:signal-matrix-snapshot:v1",
]);

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
  const criticalApiMutationPaused = useCriticalApiMutationPause();
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
    runtimeDiagnosticsEnabled: true,
    runtimeDiagnosticsQueryKey: "footer-api-sources",
    memoryPressure: memoryPressureSignal,
  });
  const userPreferences = useUserPreferences();
  const startupRefreshQueuedRef = useRef(false);
  const initialScreenRef = useRef(
    readInitialUrlScreen() ??
      normalizeInitialPlatformScreen(_initialState.screen),
  );
  const initialScreen = initialScreenRef.current;
  const initialBootBlockingTaskIds = useMemo(
    () => resolveBootBlockingTaskIds(initialScreen),
    [initialScreen],
  );
  const bootWarmStart = useMemo(
    () => (safeQaMode ? null : readBootWarmStart()),
    [safeQaMode],
  );
  const startupRefreshEnabled = shouldRunStartupRefresh({
    warmStart: bootWarmStart,
  });
  const latencyDebugEnabled = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("latency") === "1",
    [],
  );
  const [screen, setScreen] = useState(initialScreen);
  const signalMatrixRouteRequestActive =
    screen === "signals" || screen === "algo";
  // The signal-matrix evaluation container claims a global single-owner lease and
  // drives heavy work; only run it where the matrix is actually shown (Signals /
  // Algo). It used to be hardcoded on
  // for every screen, so it ran on Account/Market/Trade and starved their loading.
  const signalMatrixRequestActive = signalMatrixRouteRequestActive;
  const signalsScreenSafeWorkVisible = Boolean(
    safeQaMode && workspaceLeader && screen === "signals",
  );
  const signalMatrixForegroundWorkVisible = Boolean(signalMatrixRequestActive);
  const signalMonitorWorkVisible = Boolean(
    platformRealtimeWorkActive ||
      signalsScreenSafeWorkVisible ||
      signalMatrixForegroundWorkVisible,
  );
  const signalMatrixRequestClientRole =
    workspaceLeader || signalMatrixForegroundWorkVisible
      ? "leader"
      : "follower";
  const [mountedScreens, setMountedScreens] = useState(() =>
    buildMountedScreenState(initialScreen),
  );
  const [firstScreenReady, setFirstScreenReady] = useState(false);
  const [startupProtectionActive, setStartupProtectionActive] = useState(true);
  const [screenWarmupPhase, setScreenWarmupPhase] = useState("initial");
  const [auxiliarySurfacesReady, setAuxiliarySurfacesReady] = useState(false);
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
  // URL deep-link: `?screen=<id>` activates that screen once on mount. This is the
  // only entry point for hidden screens (e.g. `market-demo`) that are intentionally
  // absent from the nav. Invalid ids are ignored by activateScreen's guard.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const requested = new URLSearchParams(window.location.search).get(
        "screen",
      );
      if (requested) {
        activateScreen(requested);
      }
    } catch {
      // Malformed URL — fall back to the persisted/default screen.
    }
  }, [activateScreen]);
  useEffect(() => {
    reclassifyBootBlocking(initialBootBlockingTaskIds);
  }, [initialBootBlockingTaskIds]);
  useEffect(() => {
    try {
      const storage = window.localStorage;
      SIGNAL_MATRIX_RETIRED_SNAPSHOT_CACHE_KEYS.forEach((key) => {
        storage.removeItem(key);
      });
    } catch (_error) {
      // Storage can be unavailable in hardened browser modes.
    }
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
  useEffect(() => {
    if (!bootWarmStart) {
      return;
    }
    // Warm reload: the heavy screen data is already hydrated from localStorage /
    // IndexedDB caches, so dismiss the boot overlay immediately instead of
    // blocking on the cold session/watchlists round-trips. The live queries still
    // fetch and their settle effects reconcile; bootProgress ignores status
    // changes once a task is settled, so a later live failure cannot re-block the
    // overlay. Live trading/quote gates keep using live session state.
    const screenDeps = resolveScreenBootDataDeps(initialScreen);
    ["session", "watchlists"]
      .filter((taskId) => screenDeps.includes(taskId))
      .forEach((taskId) =>
        completeBootProgressTask(taskId, {
          detail: "Restored from last session",
        }),
      );
  }, [bootWarmStart, initialScreen]);
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
      _initialState.activitySidebarWidth ??
        _initialState.marketActivityPanelWidth,
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
    // Diagnostics-only: keep the published perf snapshot's timeline fresh
    // imperatively instead of bumping render state, which used to re-render the
    // whole root ~20x during boot. Coarser snapshot fields refresh on the next
    // effect run via its other boot-state deps.
    if (
      typeof window !== "undefined" &&
      window.__PYRUS_PERF_WARMUP_SNAPSHOT__
    ) {
      window.__PYRUS_PERF_WARMUP_SNAPSHOT__.timelineMs =
        warmupTimelineRef.current;
    }
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
      const next = normalizeScreenReadinessPatch(previous, patch);

      if (
        previous.frameReady === next.frameReady &&
        previous.contentReady === next.contentReady &&
        previous.primaryReady === next.primaryReady &&
        previous.derivedReady === next.derivedReady &&
        previous.backgroundAllowed === next.backgroundAllowed &&
        previous.error === next.error
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

  const updateBackgroundResumeReady = useCallback(
    (key, value) => {
      setBackgroundResumeReady((current) =>
        current.screen === screen && current[key] === value
          ? current
          : { ...current, screen, [key]: value },
      );
    },
    [screen],
  );

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
    let cancelled = false;
    const cancelReadiness = scheduleReadinessWork(() => {
      if (!cancelled) {
        setStartupProtectionActive(false);
      }
    });
    return () => {
      cancelled = true;
      cancelReadiness();
    };
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

    return () => {
      if (window.__PYRUS_MEMORY_DIAGNOSTICS__ === getMemoryDiagnostics) {
        delete window.__PYRUS_MEMORY_DIAGNOSTICS__;
      }
    };
  }, [queryClient]);

  const sessionQuery = useGetSession({
    query: {
      staleTime: SESSION_REFETCH_INTERVAL_MS,
      refetchInterval: pageVisible ? SESSION_REFETCH_INTERVAL_MS : false,
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
  useRuntimeWorkloadFlag("platform:session", pageVisible, {
    kind: "poll",
    label: "Session",
    detail: "20s visible",
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
  useRuntimeWorkloadFlag("platform:watchlists", true, {
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
  const marketScreenActive = screen === "market";
  const flowScreenActive = screen === "flow";
  const activeScreenReadiness =
    screenReadiness[screen] || EMPTY_SCREEN_READINESS;
  const activeScreenFrameReady = Boolean(activeScreenReadiness.frameReady);
  const activeScreenPrimaryReady = Boolean(activeScreenReadiness.primaryReady);
  const activeScreenFrameReadyRef = useRef(activeScreenFrameReady);
  const activeScreenIdRef = useRef(screen);
  activeScreenFrameReadyRef.current = activeScreenFrameReady;
  activeScreenIdRef.current = screen;
  const activeScreenBackgroundAllowed = Boolean(
    activeScreenReadiness.backgroundAllowed,
  );
  useEffect(() => {
    if (firstScreenBootCompleteRef.current || !activeScreenFrameReady) {
      return;
    }
    firstScreenBootCompleteRef.current = true;
    setFirstScreenReady(true);
    setScreenWarmupPhase("ready");
    markWarmupTimeline("firstScreenReadyAtMs");
    markWarmupTimeline("screenWarmupReadyAtMs");
    // The active screen reports frameReady even when its chunk failed to load
    // (so the boot overlay still lifts to the screen's error fallback). Settle
    // the boot task as failed in that case so boot telemetry reflects the error
    // instead of recording a clean boot.
    if (activeScreenReadiness.error) {
      failBootProgressTask("first-screen", activeScreenReadiness.error, {
        detail: `${screen} screen failed to load`,
      });
    } else {
      completeBootProgressTask("first-screen", {
        detail: `${screen} screen frame ready`,
      });
    }
  }, [
    activeScreenFrameReady,
    activeScreenReadiness.error,
    markWarmupTimeline,
    screen,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const nowMs = () =>
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const deadlineMs = nowMs() + BOOT_OVERLAY_WATCHDOG_MS;
    let released = false;
    const releaseBootWatchdog = () => {
      if (released || nowMs() < deadlineMs) {
        return;
      }
      released = true;
      if (getBootProgressSnapshot().complete) {
        return;
      }
      if (!firstScreenBootCompleteRef.current) {
        firstScreenBootCompleteRef.current = true;
        setFirstScreenReady(true);
        setScreenWarmupPhase("ready");
        markWarmupTimeline("firstScreenReadyAtMs");
        markWarmupTimeline("screenWarmupReadyAtMs");
        if (activeScreenFrameReadyRef.current) {
          completeBootProgressTask("first-screen", {
            detail: `${activeScreenIdRef.current} screen frame ready`,
          });
        } else {
          failBootProgressTask(
            "first-screen",
            new Error(
              `${activeScreenIdRef.current} screen did not report frame readiness before the boot watchdog.`,
            ),
            {
              detail: "Boot watchdog released before first screen frame-ready",
            },
          );
        }
      }
      initialBootBlockingTaskIds.forEach((taskId) => {
        if (taskId === "first-screen") {
          return;
        }
        completeBootProgressTask(taskId, {
          detail: "Boot watchdog dismissed the loading overlay",
        });
      });
    };
    const releaseBootWatchdogFromPageEvent = () => {
      releaseBootWatchdog();
    };
    const timer = window.setTimeout(
      releaseBootWatchdog,
      BOOT_OVERLAY_WATCHDOG_MS,
    );
    document?.addEventListener?.(
      "visibilitychange",
      releaseBootWatchdogFromPageEvent,
    );
    window.addEventListener("pageshow", releaseBootWatchdogFromPageEvent);
    window.addEventListener("focus", releaseBootWatchdogFromPageEvent);
    return () => {
      window.clearTimeout(timer);
      document?.removeEventListener?.(
        "visibilitychange",
        releaseBootWatchdogFromPageEvent,
      );
      window.removeEventListener("pageshow", releaseBootWatchdogFromPageEvent);
      window.removeEventListener("focus", releaseBootWatchdogFromPageEvent);
    };
  }, [initialBootBlockingTaskIds, markWarmupTimeline]);
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
    let cancelReadiness = null;
    markWarmupTimeline("auxiliarySurfacesQueuedAtMs");
    cancelReadiness = scheduleReadinessWork(() => {
      if (cancelled) {
        return;
      }
      auxiliarySurfacesReadyRef.current = true;
      setAuxiliarySurfacesReady(true);
      markWarmupTimeline("auxiliarySurfacesReadyAtMs");
    });

    return () => {
      cancelled = true;
      cancelReadiness?.();
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

    let cancelled = false;
    const cancelReadiness = scheduleReadinessWork(() => {
      if (!cancelled) {
        updateBackgroundResumeReady("signalDisplay", true);
      }
    });
    return () => {
      cancelled = true;
      cancelReadiness();
    };
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

    let cancelled = false;
    const cancelReadiness = scheduleReadinessWork(() => {
      if (!cancelled) {
        updateBackgroundResumeReady("signalMatrix", true);
      }
    });
    return () => {
      cancelled = true;
      cancelReadiness();
    };
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
      memoryPressureSignal?.server?.resourceLevel,
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
    memoryPressureSignal?.server?.resourceLevel ||
      memoryPressureSignal?.server?.effectivePressureLevel ||
      memoryPressureSignal?.server?.apiPressureLevel ||
      memoryPressureSignal?.server?.pressureLevel,
  );
  const activeSignalMatrixAdmissionPressureLevel =
    signalMatrixServerPressureObserved
      ? activeSignalMatrixPressureLevel
      : "normal";
  const memoryAllowsBackgroundWarmup = Boolean(memoryPressureLevel !== "high");
  const memoryAllowsIdlePrefetch = Boolean(
    firstScreenReady &&
      !startupProtectionActive &&
      memoryAllowsBackgroundWarmup &&
      backgroundDataWarmupEnabled,
  );
  const operationalCodePreloadReady = Boolean(
    // Code preload is intentionally NOT gated on platformRealtimeWorkActive
    // (= workspaceLeader). Downloading a screen's JS chunk is cheap and does not
    // need the single-tab realtime lease that data streams do, so follower tabs
    // should warm their screen code too — otherwise non-leader tabs hit cold
    // chunks on first navigation. We keep the safe-QA exclusion, the
    // first-screen + startup-protection window (so preloads never compete with
    // first paint), the phone guard, and the test override.
    !safeQaMode &&
      firstScreenReady &&
      !startupProtectionActive &&
      !isPhone &&
      !warmupTestOverrides.disableOperationalCodePreload,
  );
  const screenCodePreloadReady = Boolean(
    AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED &&
      operationalCodePreloadReady &&
      activeScreenBackgroundAllowed &&
      memoryAllowsBackgroundWarmup,
  );
  const backgroundScreenPreloadReady = Boolean(
    AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED &&
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
    AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED &&
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
      !screenCodePreloadReady ||
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
    let timerId = null;
    const runPriorityScreenPreload = () => {
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
    };

    if (PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS > 0) {
      timerId = window.setTimeout(
        runPriorityScreenPreload,
        PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS,
      );
    } else {
      runPriorityScreenPreload();
    }

    return () => {
      cancelled = true;
      if (timerId != null) {
        window.clearTimeout(timerId);
      }
    };
  }, [markWarmupTimeline, screen, screenCodePreloadReady]);
  const preloadCalendarWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 14);
    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
    };
  }, []);
  const watchlistMarketDataSymbols = useMemo(
    () =>
      [
        ...new Set(
          [
            sym,
            ...HEADER_KPI_SYMBOLS,
            ...(marketScreenActive ? MARKET_SNAPSHOT_SYMBOLS : []),
            ...watchlistSymbols,
          ]
            .map(normalizeTickerSymbol)
            .filter(Boolean),
        ),
      ].slice(0, WATCHLIST_MARKET_DATA_SYMBOL_LIMIT),
    [marketScreenActive, sym, watchlistSymbols],
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
          ...watchlistMarketDataSymbols,
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
    watchlistMarketDataSymbols,
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
          ...watchlistMarketDataSymbols,
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
    watchlistMarketDataSymbols,
    watchlistSymbols,
  ]);
  const baseStreamedAggregateSymbols = useMemo(
    () => [
      ...new Set(
        [
          sym,
          ...HEADER_KPI_SYMBOLS,
          ...watchlistMarketDataSymbols,
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
      watchlistMarketDataSymbols,
      watchlistSymbols,
    ],
  );
  const brokerAccountsReadyForBoot = Boolean(
    sessionQuery.data?.ibkrBridge?.authenticated === true &&
      sessionQuery.data?.ibkrBridge?.accountsLoaded !== false &&
      sessionQuery.data?.ibkrBridge?.healthFresh !== false,
  );
  const accountsQueryEnabled = Boolean(
    sessionQuery.data && !safeQaMode && brokerAccountsReadyForBoot,
  );
  const accountsQuery = useListAccounts(
    { mode: sessionQuery.data?.environment || "shadow" },
    {
      query: {
        enabled: accountsQueryEnabled,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const accounts = accountsQuery.data?.accounts || [];
  // The Accounts screen tab strip lists real brokerage accounts, which are
  // live-mode entities regardless of the app trading environment (the shadow
  // ledger is its own trailing tab there). Fetch them with mode "live" so the
  // per-account tabs render in a shadow environment too, while the
  // environment-driven accountsQuery above keeps serving the header/algo
  // surfaces. When the environment is "live" both hooks share one query key,
  // so this adds no extra request.
  // Unlike the boot-gated query above, this one must not wait for the IBKR
  // bridge: SnapTrade-backed accounts are served from the DB without it, and
  // /api/accounts itself degrades (503 problem) when no broker source exists.
  const accountScreenAccountsQueryEnabled = Boolean(
    sessionQuery.data && !safeQaMode,
  );
  const accountScreenAccountsQuery = useListAccounts(
    { mode: "live" },
    {
      query: {
        enabled: accountScreenAccountsQueryEnabled,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const accountScreenAccounts =
    accountScreenAccountsQuery.data?.accounts || [];
  useEffect(() => {
    if (!sessionMetadataSettled) {
      return;
    }
    if (sessionQuery.isError) {
      failBootProgressTask(
        "session",
        sessionQuery.error || "Session unavailable",
        {
          detail: "Session unavailable",
        },
      );
      return;
    }
    completeBootProgressTask("session", { detail: "Session loaded" });
  }, [sessionMetadataSettled, sessionQuery.error, sessionQuery.isError]);
  useEffect(() => {
    if (
      !watchlistsQuery.data &&
      !watchlistsQuery.isFetched &&
      !watchlistsQuery.isError
    ) {
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
    // Record a successful boot so the next warm reload can dismiss the overlay
    // optimistically (see the warm-start effect near mount). Only stamp once both
    // blocking data tasks have settled without error; re-stamping on refetch keeps
    // the warm window anchored to recent activity.
    if (safeQaMode) {
      return;
    }
    if (sessionQuery.isError || watchlistsQuery.isError) {
      return;
    }
    if (!sessionQuery.data || !sessionMetadataSettled) {
      return;
    }
    if (!watchlistsQuery.data && !watchlistsQuery.isFetched) {
      return;
    }
    writeBootWarmStart({ environment: sessionQuery.data?.environment });
  }, [
    safeQaMode,
    sessionMetadataSettled,
    sessionQuery.data,
    sessionQuery.isError,
    watchlistsQuery.data,
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
    if (!brokerAccountsReadyForBoot) {
      skipBootProgressTasks(
        ["accounts"],
        "Accounts deferred until broker account data is available",
      );
      return;
    }
    if (
      !accountsQuery.data &&
      !accountsQuery.isFetched &&
      !accountsQuery.isError
    ) {
      return;
    }
    if (accountsQuery.isError) {
      failBootProgressTask(
        "accounts",
        accountsQuery.error || "Accounts unavailable",
        {
          detail: "Accounts unavailable",
        },
      );
      return;
    }
    completeBootProgressTask("accounts", { detail: "Accounts loaded" });
  }, [
    accountsQuery.data,
    accountsQuery.error,
    accountsQuery.isError,
    accountsQuery.isFetched,
    brokerAccountsReadyForBoot,
    safeQaMode,
    sessionMetadataSettled,
    sessionQuery.data,
  ]);
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

    const bridgeSelectedAccountId =
      sessionQuery.data?.ibkrBridge?.selectedAccountId;
    const nextAccountId =
      bridgeSelectedAccountId &&
      accounts.some((account) => account.id === bridgeSelectedAccountId)
        ? bridgeSelectedAccountId
        : accounts[0]?.id || null;

    if (nextAccountId && nextAccountId !== selectedAccountId) {
      setSelectedAccountId(nextAccountId);
    }
  }, [
    accounts,
    selectedAccountId,
    sessionQuery.data?.ibkrBridge?.selectedAccountId,
  ]);

  // ── TOAST SYSTEM ──
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const timeoutMapRef = useRef({}); // tracks outer auto-dismiss timeout per toast, so manual dismiss can cancel it
  const dismissToast = useCallback((id) => {
    const timers = timeoutMapRef.current[id];
    if (timers) {
      clearTimeout(timers.dismiss);
      clearTimeout(timers.remove);
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    // Tracked in the map (not a bare timer) so an unmount mid-dismiss can cancel
    // it and we never call setToasts on an unmounted tree.
    const removeTimer = setTimeout(() => {
      delete timeoutMapRef.current[id];
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 220);
    timeoutMapRef.current[id] = { remove: removeTimer };
  }, []);
  const pushToast = useCallback(
    ({ title, body, kind = "info", duration = 3500 }) => {
      const id = ++toastIdRef.current;
      const normalizedKind = normalizeToastKind(kind);
      captureToast({ title, body, kind: normalizedKind });
      setToasts((prev) => [
        ...prev,
        { id, title, body, kind: normalizedKind, duration, leaving: false },
      ]);
      const dismissTimer = setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
        );
        const removeTimer = setTimeout(() => {
          delete timeoutMapRef.current[id];
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 220);
        timeoutMapRef.current[id] = {
          ...(timeoutMapRef.current[id] || {}),
          remove: removeTimer,
        };
      }, duration);
      timeoutMapRef.current[id] = { dismiss: dismissTimer };
    },
    [],
  );
  useEffect(() => {
    const timeoutMap = timeoutMapRef.current;
    return () => {
      Object.values(timeoutMap).forEach((timers) => {
        if (!timers) return;
        clearTimeout(timers.dismiss);
        clearTimeout(timers.remove);
      });
    };
  }, []);
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
  const environment = sessionQuery.data?.environment || "shadow";
  // The platform signal lane drives the shadow algo scanner, so keep it pinned
  // to the shadow signal-monitor profile instead of the broker session mode.
  const signalMonitorEnvironment = "shadow";
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(
    session?.ibkrBridge?.authenticated &&
      session?.ibkrBridge?.healthFresh !== false,
  );
  const massiveStockRealtimeConfigured = Boolean(session?.configured?.massive);
  const marketDataProviderConfigurationReady = Boolean(
    sessionQuery.data || sessionQuery.isFetched,
  );
  const ibkrStockAggregateStreamingConfigured = Boolean(
    brokerConfigured && brokerAuthenticated,
  );
  const stockAggregateStreamingConfigured = Boolean(
    massiveStockRealtimeConfigured || ibkrStockAggregateStreamingConfigured,
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
    gatewayTradingReady && !accountOrderStreamsFresh
      ? "streams_stale"
      : "gateway";
  const stockAggregateStreamingEnabled = Boolean(
    stockAggregateStreamingConfigured && platformRealtimeWorkActive,
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
      !startupRefreshEnabled ||
      !platformRealtimeWorkActive ||
      !firstScreenReady ||
      startupProtectionActive
    ) {
      return;
    }
    startupRefreshQueuedRef.current = true;

    queryClient.invalidateQueries({ queryKey: WATCHLISTS_QUERY_KEY });

    const cleanupTasks = [];
    const invalidateUnlessActiveScreen = (screenIds, invalidate) => {
      const blockedScreens = Array.isArray(screenIds) ? screenIds : [screenIds];
      if (blockedScreens.includes(activeScreenIdRef.current)) {
        return;
      }
      invalidate();
    };
    const queueInvalidation = (delayMs, invalidate, timeoutMs = 4_000) => {
      const timerId = window.setTimeout(() => {
        const cancelIdle = scheduleIdleWork(invalidate, timeoutMs);
        cleanupTasks.push(cancelIdle);
      }, delayMs);
      cleanupTasks.push(() => window.clearTimeout(timerId));
    };

    queueInvalidation(
      250,
      () => {
        queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
      },
      2_000,
    );
    queueInvalidation(
      750,
      () => {
        invalidateUnlessActiveScreen(["market", "trade"], () => {
          queryClient.invalidateQueries({ queryKey: ["/api/bars"] });
          queryClient.invalidateQueries({ queryKey: ["market-sparklines"] });
          queryClient.invalidateQueries({
            queryKey: ["market-performance-baselines"],
          });
        });
      },
      5_000,
    );
    queueInvalidation(
      1_500,
      () => {
        invalidateUnlessActiveScreen("flow", () => {
          queryClient.invalidateQueries({ queryKey: ["/api/flow/events"] });
        });
        invalidateUnlessActiveScreen("trade", () => {
          queryClient.invalidateQueries({ queryKey: ["trade-market-depth"] });
        });
        invalidateUnlessActiveScreen(["signals", "algo"], () => {
          queryClient.invalidateQueries({
            queryKey: getListSignalMonitorEventsQueryKey(),
          });
        });
      },
      5_000,
    );
    queueInvalidation(
      2_500,
      () => {
        invalidateUnlessActiveScreen("trade", () => {
          queryClient.invalidateQueries({
            queryKey: ["/api/options/expirations"],
          });
          queryClient.invalidateQueries({ queryKey: ["/api/options/chains"] });
          queryClient.invalidateQueries({ queryKey: ["trade-option-chain"] });
        });
      },
      6_000,
    );

    return () => {
      cleanupTasks.forEach((cleanup) => cleanup());
    };
  }, [
    firstScreenReady,
    platformRealtimeWorkActive,
    queryClient,
    signalMonitorEnvironment,
    startupRefreshEnabled,
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
        const delayMs =
          index === 0
            ? OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS
            : OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS;
        if (delayMs <= 0) {
          resolve();
          return;
        }
        const timerId = window.setTimeout(resolve, delayMs);
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
  }, [screen, screenCodePreloadReady, markWarmupTimeline]);

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
    // Tracks whether the deferred preload actually fired. The complete ref is
    // set up-front to block re-scheduling while we wait, but is rolled back in
    // cleanup if we tear down before firing — otherwise an interrupted attempt
    // (navigation / memory pressure during the idle delay) would permanently
    // disable the preload for the session.
    let completed = false;
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
      completed = true;
    });

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      idleCleanups.forEach((cleanup) => cleanup());
      if (!completed) {
        researchWorkspaceCodePreloadCompleteRef.current = false;
      }
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
    // See the code-preload effect above: the complete ref is set up-front to
    // block re-scheduling but rolled back in cleanup if neither deferred load
    // fired, so an interrupted attempt stays eligible to re-run.
    let completed = false;
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
      completed = true;
      void import("../research/data/runtime.js")
        .then(({ loadResearchThemeDataset }) => loadResearchThemeDataset("ai"))
        .catch(() => {})
        .finally(() => markWarmupTimeline("researchWorkspaceThemeLoadedAtMs"));
    });

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
      idleCleanups.forEach((cleanup) => cleanup());
      if (!completed) {
        researchWorkspaceDataPreloadCompleteRef.current = false;
      }
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
          getGetResearchEarningsCalendarQueryOptions(preloadCalendarWindow, {
            query: {
              staleTime: 300_000,
              retry: false,
            },
          }),
        );
      }

      if (
        marketDataProviderConfigurationReady &&
        !massiveStockRealtimeConfigured
      ) {
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
      }
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
    marketDataProviderConfigurationReady,
    massiveStockRealtimeConfigured,
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
  const signalMonitorEventsQueryKey = useMemo(
    () => getListSignalMonitorEventsQueryKey(signalMonitorEventsParams),
    [signalMonitorEventsParams],
  );
  useEffect(() => {
    if (!criticalApiMutationPaused) {
      return;
    }
    void queryClient.cancelQueries({
      queryKey: getListSignalMonitorEventsQueryKey(),
    });
  }, [criticalApiMutationPaused, queryClient]);
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
        activeScreenBackgroundAllowed: activeScreenBackgroundDataAllowed,
        startupProtectionActive,
        ibkrWorkPressure,
        memoryPressure: memoryPressureSignal,
        brokerConfigured,
        brokerAuthenticated: Boolean(session?.ibkrBridge?.authenticated),
        massiveStockRealtimeConfigured,
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
      massiveStockRealtimeConfigured,
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
    enabled:
      workSchedule.streams.accountRealtime && !priorityScreenCodePreloadPending,
  });
  useIbkrOrderSnapshotStream({
    accountId: null,
    mode: environment,
    enabled:
      workSchedule.streams.accountRealtime && !priorityScreenCodePreloadPending,
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
  const signalMonitorDisplayReady = shouldRunSignalMonitorDisplay({
    workVisible: signalMonitorWorkVisible,
    firstScreenReady,
    foregroundReady: signalMonitorForegroundReady,
    profileEnabled: Boolean(signalMonitorProfile?.enabled),
    profileFetched: signalMonitorProfileQuery.isFetched,
    profileError: signalMonitorProfileQuery.isError,
  });
  const signalMonitorEventsReady = Boolean(
    signalMonitorDisplayReady &&
      screen !== "algo" &&
      screen !== "trade" &&
      !criticalApiMutationPaused,
  );
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
      if (
        !signalMonitorForegroundReady &&
        !signalMonitorProfileQuery.data?.enabled
      ) {
        skipBootProgressTasks(["signal-state"], "Signal monitor disabled");
        return;
      }
    }
    if (!signalMonitorDisplayReady) {
      return;
    }
    completeBootProgressTask("signal-state", {
      detail: "Signal matrix stream active",
    });
  }, [
    signalMonitorDisplayReady,
    signalMonitorForegroundReady,
    signalMonitorProfileQuery.data,
    signalMonitorProfileQuery.isError,
    signalMonitorProfileQuery.isFetched,
  ]);
  const signalMonitorDegraded = Boolean(signalMonitorProfileDegraded);
  const signalMonitorRuntimeFallback = Boolean(
    isSignalMonitorRuntimeFallbackProfile(signalMonitorProfile),
  );
  useRuntimeWorkloadFlag("signal-monitor:display", signalMonitorDisplayReady, {
    kind: "poll",
    label: "Signal display",
    detail: `${Math.round(signalMonitorRuntimePollMs / 1000)}s`,
    priority: 4,
  });
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
      onSuccess: () => {
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
  const [signalMatrixSnapshot, setSignalMatrixSnapshot] = useState(() => ({
    states: [],
    timeframes: SIGNAL_MATRIX_TIMEFRAMES,
  }));
  const signalMatrixUniverseRef = useRef([]);
  const signalMatrixStatesRef = useRef(signalMatrixSnapshot.states || []);
  const signalMatrixBootstrapTimeframesKeyRef = useRef("");
  const [signalMatrixBootstrapSequence, setSignalMatrixBootstrapSequence] =
    useState(0);
  const [
    signalMatrixFullTimeframeStreamEnabled,
    setSignalMatrixFullTimeframeStreamEnabled,
  ] = useState(false);
  // Matrix SSE transport-error, inferred by the stream after repeated terminal
  // closes (EventSource hides the HTTP status). Cleared on the next open.
  const [signalMatrixTransportErrored, setSignalMatrixTransportErrored] =
    useState(false);
  const activeStaExecutionTimeframe = useAlgoStaExecutionTimeframe();
  const activeStaMtfTimeframes = useAlgoStaMtfTimeframes();
  const signalMonitorEvents =
    signalMonitorEventsQuery.data?.events || EMPTY_SIGNAL_MONITOR_EVENTS;
  const signalMonitorEventsSourceStatus =
    signalMonitorEventsQuery.data?.sourceStatus || "database";
  // Matrix truth is states only (SSE snapshot as base, REST as fill). Events
  // are history: the backend reconciles stored states from canonical events
  // at startup and latches identity in transport, so overlaying events onto
  // matrix cells client-side would only re-derive what the states already say.
  const signalMonitorPublishedStates = useMemo(() => {
    return mergeSignalMatrixStates({
      currentStates: signalMatrixSnapshot.states,
      incomingStates: EMPTY_SIGNAL_MONITOR_STATES,
    });
  }, [signalMatrixSnapshot.states]);
  const signalMonitorUniverseScope = useMemo(
    () =>
      resolveSignalMonitorUniverseScopeSetting(
        signalMonitorProfile?.pyrusSignalsSettings,
      ) || "all_watchlists_plus_universe",
    [signalMonitorProfile?.pyrusSignalsSettings],
  );
  const signalMonitorUniverseSymbolLimit = useMemo(
    () =>
      resolveSignalMonitorUniverseSymbolLimit(signalMonitorProfile?.maxSymbols),
    [signalMonitorProfile?.maxSymbols],
  );
  const signalMonitorUniverseSymbols = useMemo(() => {
    const selectedWatchlistSymbols = watchlistSymbols;
    const allWatchlistSymbols = allWatchlistSymbolList.length
      ? allWatchlistSymbolList
      : selectedWatchlistSymbols;
    const scopedSymbols =
      signalMonitorUniverseScope === "selected_watchlist"
        ? selectedWatchlistSymbols
        : signalMonitorUniverseScope === "all_watchlists"
          ? allWatchlistSymbols
          : [...allWatchlistSymbols, ...SIGNAL_MONITOR_LOCAL_EXPANSION_SYMBOLS];
    return normalizeSignalMonitorUniverseSymbols(
      [...scopedSymbols, sym, ...openPositionMarketDataSymbols],
      signalMonitorUniverseSymbolLimit,
    );
  }, [
    allWatchlistSymbolList,
    openPositionMarketDataSymbols,
    signalMonitorUniverseScope,
    signalMonitorUniverseSymbolLimit,
    sym,
    watchlistSymbols,
  ]);
  const headerSignalContextSymbols = useMemo(
    () =>
      buildHeaderSignalContextSymbols({
        states: signalMonitorPublishedStates,
        events: signalMonitorEvents,
      }),
    [signalMonitorEvents, signalMonitorPublishedStates],
  );
  const signalMonitorSymbols = useMemo(
    () => [
      ...new Set(
        [
          ...headerSignalContextSymbols,
          ...signalMonitorPublishedStates.map((state) =>
            normalizeTickerSymbol(state?.symbol),
          ),
        ].filter(Boolean),
      ),
    ],
    [headerSignalContextSymbols, signalMonitorPublishedStates],
  );
  const signalMonitorDisplaySymbols = useMemo(
    () => [
      ...new Set(
        [
          ...signalMonitorUniverseSymbols.map((symbol) =>
            normalizeTickerSymbol(symbol),
          ),
          ...headerSignalContextSymbols,
          ...signalMonitorPublishedStates.map((state) =>
            normalizeTickerSymbol(state?.symbol),
          ),
        ].filter(Boolean),
      ),
    ],
    [
      headerSignalContextSymbols,
      signalMonitorPublishedStates,
      signalMonitorUniverseSymbols,
    ],
  );
  const handleSignalMatrixStreamStates = useCallback(
    (incomingStates, kind, payload = null) => {
      if (!Array.isArray(incomingStates)) {
        return;
      }
      if (kind === "bootstrap") {
        const payloadTimeframes = Array.isArray(payload?.timeframes)
          ? payload.timeframes
          : incomingStates.map((state) => state?.timeframe);
        signalMatrixBootstrapTimeframesKeyRef.current =
          normalizeSignalMatrixStreamTimeframes(payloadTimeframes, []).join(
            ",",
          );
        setSignalMatrixBootstrapSequence((sequence) => sequence + 1);
      }
      const nextCoverage =
        payload && typeof payload === "object" && payload.coverage
          ? payload.coverage
          : null;
      const nextSkippedSymbols = Array.isArray(payload?.skippedSymbols)
        ? payload.skippedSymbols
        : null;
      const nextTruncated =
        payload && typeof payload === "object" && "truncated" in payload
          ? Boolean(payload.truncated)
          : null;
      const hydrationSource =
        kind === "bootstrap" ? "stream-bootstrap" : "stream-delta";
      const taggedStates = incomingStates.map((state) =>
        state && typeof state === "object"
          ? { ...state, displayHydrationSource: hydrationSource }
          : state,
      );
      setSignalMatrixSnapshot((current) => {
        const nextSnapshot = mergeSignalMatrixStreamSnapshot({
          currentSnapshot: current,
          incomingStates: taggedStates,
          kind,
          coverage: nextCoverage,
          skippedSymbols: nextSkippedSymbols,
          truncated: nextTruncated,
          knownSymbols: signalMatrixUniverseRef.current,
        });
        signalMatrixStatesRef.current =
          nextSnapshot.states || EMPTY_SIGNAL_MONITOR_STATES;
        return nextSnapshot;
      });
    },
    [],
  );
  const recentSignalMarketDataSymbols = useMemo(
    () => resolveRecentSignalMarketDataSymbols(signalMonitorPublishedStates),
    [signalMonitorPublishedStates],
  );
  const quoteStreamRotationSymbols = useMemo(
    () => [
      ...new Set(
        [
          ...watchlistMarketDataSymbols,
          ...headerSignalContextSymbols,
          ...recentSignalMarketDataSymbols,
          // Keep the full signal-scanning universe off the Trade screen quote
          // stream. Trade charts share the browser/proxy connection budget with
          // long-lived SSE streams; subscribing ~1.5k background symbols can
          // starve visible /api/bars hydration before the request reaches the API.
          ...(screen === "trade" ? [] : signalMonitorUniverseSymbols),
        ]
          .map(normalizeTickerSymbol)
          .filter(Boolean),
      ),
    ],
    [
      headerSignalContextSymbols,
      recentSignalMarketDataSymbols,
      screen,
      watchlistMarketDataSymbols,
      signalMonitorUniverseSymbols,
    ],
  );
  const quoteStreamPinnedSymbols = useMemo(
    () => [
      ...new Set(
        [
          sym,
          ...HEADER_KPI_SYMBOLS,
          ...(marketScreenActive ? MARKET_SNAPSHOT_SYMBOLS : []),
          ...watchlistMarketDataSymbols,
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
      watchlistMarketDataSymbols,
    ],
  );
  const activeVisibleQuoteSymbols = quoteStreamPinnedSymbols;
  const watchlistQuoteStreamBatchSize = useMemo(
    () =>
      resolveWatchlistQuoteStreamBatchSize({
        defaultBatchSize: WATCHLIST_QUOTE_STREAM_BATCH_SIZE,
        activeVisibleSymbolCount: activeVisibleQuoteSymbols.length,
      }),
    [activeVisibleQuoteSymbols.length],
  );
  const [watchlistQuoteRotationCursor, setWatchlistQuoteRotationCursor] =
    useState(0);
  const [
    watchlistQuoteLastTouchedBySymbol,
    setWatchlistQuoteLastTouchedBySymbol,
  ] = useState({});
  const watchlistQuoteRotationBatch = useMemo(
    () =>
      buildWatchlistQuoteRotationBatch({
        watchlistSymbols,
        rotationSymbols: quoteStreamRotationSymbols,
        pinnedSymbols: quoteStreamPinnedSymbols,
        cursor: watchlistQuoteRotationCursor,
        batchSize: watchlistQuoteStreamBatchSize,
      }),
    [
      quoteStreamPinnedSymbols,
      quoteStreamRotationSymbols,
      watchlistQuoteRotationCursor,
      watchlistQuoteStreamBatchSize,
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
        massiveStockRealtimeConfigured,
        quoteStreamEnabled: workSchedule.streams.watchlistQuoteStream,
      }),
    [
      brokerConfigured,
      massiveStockRealtimeConfigured,
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
      setWatchlistQuoteRotationCursor(
        (cursor) =>
          buildWatchlistQuoteRotationBatch({
            watchlistSymbols,
            rotationSymbols: quoteStreamRotationSymbols,
            pinnedSymbols: quoteStreamPinnedSymbols,
            cursor,
            batchSize: watchlistQuoteStreamBatchSize,
          }).nextCursor,
      );
    }, WATCHLIST_QUOTE_STREAM_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [
    quoteStreamGateReason,
    quoteStreamPinnedSymbols,
    quoteStreamRotationSymbols,
    watchlistQuoteStreamBatchSize,
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
        watchlistPrioritySymbols: watchlistMarketDataSymbols,
        signalsScreenSymbols: [],
        signalsScreenPrioritySymbols: [],
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
      signalMonitorDisplaySymbols,
      signalMonitorSymbols,
      sym,
      watchlistMarketDataSymbols,
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
  const signalMatrixStreamUsesProfileUniverse = true;
  const signalMatrixStaBootstrapTimeframes = useMemo(
    () =>
      buildSignalMatrixStaBootstrapTimeframes({
        staExecutionTimeframe: activeStaExecutionTimeframe,
        staMtfTimeframes: activeStaMtfTimeframes,
        profileTimeframe: signalMonitorProfile?.timeframe,
      }),
    [
      activeStaExecutionTimeframe,
      activeStaMtfTimeframes,
      signalMonitorProfile?.timeframe,
    ],
  );
  const signalMatrixStreamTimeframes = signalMatrixFullTimeframeStreamEnabled
    ? SIGNAL_MATRIX_TIMEFRAMES
    : signalMatrixStaBootstrapTimeframes;
  const signalMatrixStreamTimeframesKey =
    signalMatrixStreamTimeframes.join(",");
  const signalMatrixProfileUniverseStreamKey = useMemo(
    () =>
      [
        signalMonitorProfile?.id || "",
        signalMonitorProfile?.updatedAt || "",
        signalMonitorUniverseScope,
        signalMonitorUniverseSymbolLimit,
      ].join(":"),
    [
      signalMonitorProfile?.id,
      signalMonitorProfile?.updatedAt,
      signalMonitorUniverseScope,
      signalMonitorUniverseSymbolLimit,
    ],
  );
  useEffect(() => {
    signalMatrixBootstrapTimeframesKeyRef.current = "";
    setSignalMatrixBootstrapSequence(0);
    setSignalMatrixFullTimeframeStreamEnabled(false);
  }, [signalMatrixProfileUniverseStreamKey]);
  const signalMatrixObservedUniverseSymbols = useMemo(
    () =>
      normalizeSignalMonitorUniverseSymbols(
        [
          ...signalMatrixUniverseSymbols,
          ...signalMonitorPublishedStates.map((state) => state?.symbol),
        ],
        SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
      ),
    [signalMatrixUniverseSymbols, signalMonitorPublishedStates],
  );
  const signalMatrixUniverseDescriptor = useMemo(() => {
    const universeSet = new Set(signalMatrixObservedUniverseSymbols);
    const pinnedSourceSymbols =
      signalMonitorUniverseScope === "selected_watchlist"
        ? watchlistSymbols
        : allWatchlistSymbolList.length
          ? allWatchlistSymbolList
          : watchlistSymbols;
    const pinnedSymbols = normalizeSignalMonitorUniverseSymbols(
      pinnedSourceSymbols,
      Number.MAX_SAFE_INTEGER,
    ).filter((symbol) => universeSet.has(symbol)).length;
    const coverageScopeSymbols = Number(
      signalMatrixSnapshot.coverage?.activeScopeSymbols,
    );
    const profileUniverseScopeSymbols = signalMatrixStreamUsesProfileUniverse
      ? signalMonitorUniverseSymbolLimit
      : 0;
    const resolvedSymbols = Math.max(
      signalMatrixObservedUniverseSymbols.length,
      Number.isFinite(coverageScopeSymbols) ? coverageScopeSymbols : 0,
      profileUniverseScopeSymbols,
    );
    return {
      mode: signalMonitorUniverseScope,
      configuredMaxSymbols: signalMonitorUniverseSymbolLimit,
      resolvedSymbols,
      pinnedSymbols,
      expansionSymbols: Math.max(0, resolvedSymbols - pinnedSymbols),
      shortfall: Math.max(
        0,
        signalMonitorUniverseSymbolLimit - resolvedSymbols,
      ),
      source: resolveSignalMonitorUniverseSource(signalMonitorUniverseScope),
      fallbackUsed: false,
      degradedReason: null,
      rankedAt: null,
    };
  }, [
    allWatchlistSymbolList,
    signalMatrixObservedUniverseSymbols,
    signalMatrixSnapshot.coverage?.activeScopeSymbols,
    signalMatrixStreamUsesProfileUniverse,
    signalMonitorUniverseScope,
    signalMonitorUniverseSymbolLimit,
    watchlistSymbols,
  ]);
  // Push-based signal matrix over SSE. The server-owned producer keeps signal
  // evaluation alive, so the UI stream can yield on Trade where visible chart
  // hydration needs the browser/proxy connection budget.
  // Scoped to the always-on monitored universe (watchlist + monitored + open
  // positions) — NOT the signals screen. Runs alongside the poll; merge is idempotent.
  const signalMatrixStreamReady = shouldRunSignalMatrixStream({
    profileUniverse: signalMatrixStreamUsesProfileUniverse,
    universeSymbolCount: signalMatrixUniverseSymbols.length,
    screen,
    foregroundReady: signalMatrixRequestActive,
    backgroundAllowed: activeScreenBackgroundDataAllowed,
    screenWarmupPhase,
    startupProtectionActive,
    criticalApiMutationPaused,
  });
  const signalMatrixStaBootstrapReceived = Boolean(
    signalMatrixBootstrapSequence > 0 &&
      signalMatrixBootstrapTimeframesKeyRef.current ===
        signalMatrixStreamTimeframesKey,
  );
  const signalMatrixStreamPriorityGateActive = Boolean(
    signalMatrixStreamReady &&
      !signalMatrixStaBootstrapReceived &&
      signalMonitorProfile?.enabled !== false,
  );
  const signalMatrixAuxiliaryStreamGateReason =
    signalMatrixStreamPriorityGateActive ? "signal-matrix-bootstrap" : null;
  useEffect(() => {
    if (
      !signalMatrixStreamReady ||
      signalMatrixFullTimeframeStreamEnabled ||
      !signalMatrixStaBootstrapReceived ||
      signalMatrixStreamTimeframesKey === SIGNAL_MATRIX_FULL_TIMEFRAMES_KEY
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setSignalMatrixFullTimeframeStreamEnabled(true);
    }, SIGNAL_MATRIX_FULL_TIMEFRAME_WIDEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    signalMatrixFullTimeframeStreamEnabled,
    signalMatrixStaBootstrapReceived,
    signalMatrixStreamReady,
    signalMatrixStreamTimeframesKey,
  ]);
  useSignalMonitorMatrixStream({
    environment: signalMonitorEnvironment,
    symbols: signalMatrixStreamUsesProfileUniverse
      ? EMPTY_UNIVERSE_SYMBOLS
      : signalMatrixUniverseSymbols,
    timeframes: signalMatrixStreamTimeframes,
    profileUniverse: signalMatrixStreamUsesProfileUniverse,
    profileUniverseKey: signalMatrixProfileUniverseStreamKey,
    enabled: signalMatrixStreamReady,
    onStates: handleSignalMatrixStreamStates,
    onTransportError: setSignalMatrixTransportErrored,
  });
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
  const signalMatrixActiveScreenRowsReady = true;
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
          warmupTimelineRef.current.bootScreenShellWarmMountCompleteAtMs !=
          null,
        priorityScreenCodePreloadStarted:
          warmupTimelineRef.current.priorityScreenCodePreloadQueuedAtMs != null,
        priorityScreenCodePreloadCompleted:
          warmupTimelineRef.current.priorityScreenCodePreloadCompleteAtMs !=
          null,
        screenCodePreloadStarted:
          warmupTimelineRef.current.screenCodePreloadQueuedAtMs != null,
        screenCodePreloadCompleted:
          warmupTimelineRef.current.screenCodePreloadCompleteAtMs != null,
        backgroundDataWarmupGateOpened:
          warmupTimelineRef.current.backgroundDataWarmupGateOpenedAtMs != null,
        researchWorkspaceCodePreloadStarted:
          warmupTimelineRef.current.researchWorkspaceCodePreloadQueuedAtMs !=
          null,
        researchWorkspaceCodePreloadFired:
          warmupTimelineRef.current.researchWorkspaceCodePreloadFiredAtMs !=
          null,
        researchWorkspaceDataPreloadStarted:
          warmupTimelineRef.current.researchWorkspaceDataPreloadQueuedAtMs !=
          null,
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
        automaticBackgroundScreenPreloadEnabled:
          AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED,
        operationalCodePreloadReady,
        hiddenScreenWarmMountEnabled: hiddenScreenWarmMountAllowed,
        backgroundDataWarmupEnabled,
        activeScreenFrameReady,
        activeScreenBackgroundAllowed,
        activeScreenBackgroundDataAllowed,
        frameAuxiliaryDataEnabled,
        broadMarketDataHydrationReady,
        startupProtectionActive,
        criticalApiMutationPaused,
        memoryPressureObserved,
        memoryPressureLevel,
        memoryAllowsIdlePrefetch,
        priorityScreenCodePreloadPending,
        auxiliarySurfacesReady,
        signalMonitorDisplayReady,
        signalMatrixStreamReady,
        signalMatrixBackgroundReady,
      },
      backgroundResumeReady,
      screenReadiness,
    };
    publishWarmupSnapshot(snapshot);

    return () => {
      if (
        typeof window !== "undefined" &&
        window.__PYRUS_PERF_WARMUP_SNAPSHOT__ === snapshot
      ) {
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
    signalMatrixStreamReady,
    signalMatrixBackgroundReady,
    signalMonitorDisplayReady,
    startupProtectionActive,
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
    () =>
      resolveSignalMatrixExactCellLimit(
        activeSignalMatrixAdmissionPressureLevel,
      ),
    [activeSignalMatrixAdmissionPressureLevel],
  );
  const signalMatrixRequestTaskLimit = useMemo(() => {
    if (!signalMatrixRequestActive || !signalMatrixUniverseSymbols.length) {
      return null;
    }
    return signalMatrixActiveScreenRequestTaskLimit;
  }, [
    signalMatrixActiveScreenRequestTaskLimit,
    signalMatrixRequestActive,
    signalMatrixUniverseSymbols.length,
  ]);
  const signalMatrixRequestExactCellLimit = useMemo(() => {
    if (!signalMatrixRequestActive || !signalMatrixUniverseSymbols.length) {
      return null;
    }
    return signalMatrixActiveScreenExactCellLimit;
  }, [
    signalMatrixActiveScreenExactCellLimit,
    signalMatrixRequestActive,
    signalMatrixUniverseSymbols.length,
  ]);
  const signalMatrixRequestSymbolLimit = useMemo(() => {
    if (screen !== "signals") {
      return null;
    }
    return signalMatrixActiveScreenRequestSymbolLimit;
  }, [screen, signalMatrixActiveScreenRequestSymbolLimit]);
  const signalMatrixRequestTimeframes = SIGNAL_MATRIX_TIMEFRAMES;
  const signalMatrixRequestTimeframesKey = SIGNAL_MATRIX_TIMEFRAMES.join(",");
  const signalMatrixRuntimeReady = Boolean(
    signalMonitorWorkVisible &&
      !signalMatrixStartupProtectionActive &&
      signalMatrixActiveScreenRowsReady &&
      signalMatrixUniverseSymbols.length &&
      signalMonitorDisplayReady &&
      (signalMatrixPriorityReady || signalMatrixBackgroundReady),
  );
  const signalMatrixBootstrapSymbols = EMPTY_UNIVERSE_SYMBOLS;
  const signalMatrixBootstrapComplete = true;
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
      (signalMonitorProfileQuery.isFetched &&
        !signalMonitorForegroundReady &&
        !signalMonitorProfile?.enabled) ||
      signalMatrixBootstrapComplete ||
      signalMonitorPublishedStates.length > 0,
  );
  const signalHydrationBootstrapActive = Boolean(
    signalMonitorWorkVisible &&
      firstScreenReady &&
      !signalMatrixStartupProtectionActive &&
      (signalMonitorProfileBootstrapPending ||
        !signalMonitorStateBootstrapComplete),
  );
  useEffect(() => {
    signalMatrixUniverseRef.current = signalMatrixStreamUsesProfileUniverse
      ? EMPTY_UNIVERSE_SYMBOLS
      : signalMatrixUniverseSymbols;
    setSignalMatrixSnapshot((current) => {
      // Pressure caps narrow new Signal Matrix subscriptions. They must not
      // prune rows that were already published into the visible matrix.
      if (signalMatrixStreamUsesProfileUniverse) return current;
      if (!current.coverage) return current;
      return { ...current, coverage: null };
    });
  }, [
    signalMatrixStreamUsesProfileUniverse,
    signalMatrixUniverseSymbols,
    signalMatrixSymbolsKey,
  ]);
  useEffect(() => {
    signalMatrixStatesRef.current = signalMatrixSnapshot.states;
  }, [signalMatrixSnapshot.states]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
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
        (signalMatrixStreamUsesProfileUniverse ||
          signalMatrixUniverseSymbols.length > 0) &&
        signalMonitorDisplayReady &&
        (signalMatrixPriorityReady || signalMatrixBackgroundReady),
      bootstrapActive: signalHydrationBootstrapActive,
      bootstrapSymbols: signalMatrixBootstrapSymbols,
      bootstrapComplete: signalMatrixBootstrapComplete,
      profileBootstrapPending: signalMonitorProfileBootstrapPending,
      stateBootstrapComplete: signalMonitorStateBootstrapComplete,
      activeScreenRequestSymbolLimit:
        signalMatrixActiveScreenRequestSymbolLimit,
      activeScreenRequestTaskLimit: signalMatrixActiveScreenRequestTaskLimit,
      requestSymbolLimit: signalMatrixRequestSymbolLimit,
      requestTaskLimit: signalMatrixRequestTaskLimit,
      requestTimeframes: signalMatrixRequestTimeframes,
      streamTimeframes: signalMatrixStreamTimeframes,
      streamTimeframeMode: signalMatrixFullTimeframeStreamEnabled
        ? "full"
        : "sta-bootstrap",
      universeSymbols: signalMatrixObservedUniverseSymbols,
      resolvedUniverseSymbols: signalMatrixUniverseDescriptor.resolvedSymbols,
      streamProfileUniverse: signalMatrixStreamUsesProfileUniverse,
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
    signalMatrixPollMs,
    signalMatrixPressureLevel,
    signalMatrixPriorityReady,
    signalMatrixPrioritySymbols,
    signalMatrixObservedUniverseSymbols,
    headerSignalContextSymbols,
    signalHydrationBootstrapActive,
    signalMatrixBootstrapComplete,
    signalMatrixBootstrapSymbols,
    signalMatrixSuggestedSignalSymbols,
    signalMatrixSnapshot,
    signalMatrixStartupProtectionActive,
    signalMatrixStreamUsesProfileUniverse,
    signalMatrixFullTimeframeStreamEnabled,
    signalMatrixStreamTimeframes,
    signalMatrixStreamTimeframesKey,
    signalMatrixUniverseDescriptor.resolvedSymbols,
    signalMatrixSymbolsKey,
    signalMatrixUniverseSymbols,
    signalMonitorDisplayReady,
    signalMonitorProfileBootstrapPending,
    signalMonitorStateBootstrapComplete,
  ]);
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
  const broadFlowWatchlistSymbols = useMemo(() => {
    const symbols = [...new Set(allWatchlistSymbolList.filter(Boolean))];
    const limit = platformPressureCaps.broadFlowSymbolLimit;
    if (limit === 0) {
      return [];
    }
    return limit == null ? symbols : symbols.slice(0, limit);
  }, [allWatchlistSymbolList, platformPressureCaps.broadFlowSymbolLimit]);
  const runtimeQuoteSymbols = useMemo(
    () => [...new Set(quoteSymbols)],
    [quoteSymbols],
  );
  const runtimeSparklineSymbols = useMemo(
    () => [
      ...new Set([
        ...sparklineSymbols,
        ...recentSignalMarketDataSymbols,
        ...openPositionMarketDataSymbols,
      ]),
    ],
    [
      openPositionMarketDataSymbols,
      recentSignalMarketDataSymbols,
      sparklineSymbols,
    ],
  );
  const runtimeHistorySparklineSymbols = useMemo(
    () =>
      signalMatrixRouteRequestActive || screen === "trade"
        ? []
        : runtimeSparklineSymbols,
    [runtimeSparklineSymbols, screen, signalMatrixRouteRequestActive],
  );
  const prioritySparklineSymbols = useMemo(() => {
    const symbols = [
      ...new Set([
        ...recentSignalMarketDataSymbols,
        ...watchlistMarketDataSymbols,
        ...openPositionMarketDataSymbols,
      ]),
    ];
    const limit = platformPressureCaps.prioritySparklineSymbolLimit;
    if (limit === 0) {
      return [];
    }
    return limit == null ? symbols : symbols.slice(0, limit);
  }, [
    openPositionMarketDataSymbols,
    platformPressureCaps.prioritySparklineSymbolLimit,
    recentSignalMarketDataSymbols,
    watchlistMarketDataSymbols,
  ]);
  const runtimePrioritySparklineSymbols = useMemo(
    () =>
      signalMatrixRouteRequestActive || screen === "trade"
        ? []
        : prioritySparklineSymbols,
    [prioritySparklineSymbols, screen, signalMatrixRouteRequestActive],
  );
  const runtimeStreamedQuoteSymbols = useMemo(
    () => [...new Set(streamedQuoteSymbols)],
    [streamedQuoteSymbols],
  );
  const runtimeAggregateOnlySparklineSymbols = useMemo(
    () =>
      signalMatrixRouteRequestActive && screen !== "trade"
        ? [
            ...new Set([
              ...runtimeSparklineSymbols,
              ...prioritySparklineSymbols,
              ...signalMonitorDisplaySymbols,
            ]),
          ]
        : [],
    [
      prioritySparklineSymbols,
      runtimeSparklineSymbols,
      screen,
      signalMatrixRouteRequestActive,
      signalMonitorDisplaySymbols,
    ],
  );
  const runtimeStreamedAggregateSymbols = useMemo(
    () => [
      ...new Set([
        ...baseStreamedAggregateSymbols,
        ...runtimeAggregateOnlySparklineSymbols,
      ]),
    ],
    [baseStreamedAggregateSymbols, runtimeAggregateOnlySparklineSymbols],
  );
  const headerBroadcastSignalMatrixStates = useMemo(
    () =>
      filterSignalMatrixStatesForSymbols({
        states: signalMonitorPublishedStates,
        symbols: [
          sym,
          ...headerSignalContextSymbols.slice(
            0,
            HEADER_SIGNAL_MATRIX_SYMBOL_LIMIT,
          ),
        ],
        maxStates: HEADER_SIGNAL_MATRIX_STATE_LIMIT,
      }),
    [headerSignalContextSymbols, signalMonitorPublishedStates, sym],
  );
  const watchlistSignalSymbols = useMemo(
    () =>
      [
        ...new Set(
          [
            ...watchlistMarketDataSymbols,
            ...headerSignalContextSymbols,
            ...recentSignalMarketDataSymbols,
          ]
            .map(normalizeTickerSymbol)
            .filter(Boolean),
        ),
      ].slice(0, WATCHLIST_MARKET_DATA_SYMBOL_LIMIT),
    [
      headerSignalContextSymbols,
      recentSignalMarketDataSymbols,
      watchlistMarketDataSymbols,
    ],
  );
  const watchlistSignalMonitorStates = useMemo(
    () =>
      filterSignalMatrixStatesForSymbols({
        states: signalMonitorPublishedStates,
        symbols: watchlistSignalSymbols,
        maxStates: WATCHLIST_SIGNAL_MATRIX_STATE_LIMIT,
      }),
    [signalMonitorPublishedStates, watchlistSignalSymbols],
  );
  const watchlistSignalMatrixStates = useMemo(
    () =>
      filterSignalMatrixStatesForSymbols({
        states: signalMonitorPublishedStates,
        symbols: watchlistSignalSymbols,
        maxStates: WATCHLIST_SIGNAL_MATRIX_STATE_LIMIT,
      }),
    [signalMonitorPublishedStates, watchlistSignalSymbols],
  );
  const activitySignalMatrixStates = signalMonitorPublishedStates;
  useEffect(() => {
    applyRuntimeSignalStatePrices(
      watchlistSignalMonitorStates,
      activeWatchlist?.items,
    );
  }, [activeWatchlist?.items, watchlistSignalMonitorStates]);
  const signalMonitorRateLimited = Boolean(
    isSignalTransportRateLimitError(signalMonitorProfileQuery.error) ||
      isSignalTransportRateLimitError(signalMonitorEventsQuery.error),
  );
  // Profile fetch failed: we cannot trust "disabled" (there is no profile), so
  // surface uncertainty (amber) rather than a neutral OFF. Rate-limit wins as a
  // more specific amber cause.
  const signalMonitorStreamErrored = Boolean(
    signalMonitorProfileQuery.isError && !signalMonitorRateLimited,
  );
  useEffect(() => {
    publishSignalMonitorSnapshot({
      profile: signalMonitorProfile,
      states: signalMonitorPublishedStates,
      events: signalMonitorEvents,
      universe: signalMatrixUniverseDescriptor,
      pending: evaluateSignalMonitorMutation.isPending,
      degraded: signalMonitorDegraded,
      // Matrix SSE repeatedly dead → hard transport failure (red).
      transportError: signalMatrixTransportErrored,
      rateLimited: signalMonitorRateLimited,
      streamErrored: signalMonitorStreamErrored,
    });
  }, [
    evaluateSignalMonitorMutation.isPending,
    signalMatrixUniverseDescriptor,
    signalMonitorEvents,
    signalMonitorDegraded,
    signalMonitorProfile,
    signalMonitorPublishedStates,
    signalMatrixTransportErrored,
    signalMonitorRateLimited,
    signalMonitorStreamErrored,
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
  }, [theme]);
  useEffect(() => {
    const resolvedTheme = resolveEffectiveThemePreference(
      preferredTheme,
      theme,
    );
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
    const normalizedAccentPreset = [
      "pyrus",
      "coral",
      "amber",
      "green",
      "aurora",
    ].includes(preferredAccentPreset)
      ? preferredAccentPreset
      : "pyrus";
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
    const normalizedReducedMotion =
      preferredReducedMotion === "on" || preferredReducedMotion === "off"
        ? preferredReducedMotion
        : "system";
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

  const handleSignalAction = useCallback(
    (ticker, signal) => {
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
    },
    [activateScreen],
  );

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
            title: nextEnabled
              ? "Signal monitor enabled"
              : "Signal monitor disabled",
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

  const handleChangeSignalMonitorTimeframe = useCallback(
    (timeframe) => {
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
    },
    [
      runSignalMonitorEvaluation,
      signalMonitorEnvironment,
      pushToast,
      updateSignalMonitorProfileMutation,
    ],
  );
  const handleChangeSignalMonitorWatchlist = useCallback(
    (watchlistId) => {
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
    },
    [
      runSignalMonitorEvaluation,
      signalMonitorEnvironment,
      pushToast,
      updateSignalMonitorProfileMutation,
    ],
  );
  const handleChangeSignalMonitorFreshWindowBars = useCallback(
    (freshWindowBars) => {
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
    },
    [
      runSignalMonitorEvaluation,
      signalMonitorEnvironment,
      pushToast,
      updateSignalMonitorProfileMutation,
    ],
  );
  const handleChangeSignalMonitorMaxSymbols = useCallback(
    (maxSymbols) => {
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
    },
    [
      runSignalMonitorEvaluation,
      signalMonitorEnvironment,
      pushToast,
      updateSignalMonitorProfileMutation,
    ],
  );
  const handleApplySignalMonitorPyrusSettings = useCallback(
    (nextSettings) => {
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
            }
          },
        },
      );
    },
    [
      runSignalMonitorEvaluation,
      signalMonitorEnvironment,
      signalMonitorProfile?.pyrusSignalsSettings,
      pushToast,
      updateSignalMonitorProfileMutation,
    ],
  );
  const handleRunSignalMonitorNow = useCallback(() => {
    runSignalMonitorEvaluation("incremental", { notify: true });
  }, [runSignalMonitorEvaluation]);

  const handleCreateWatchlist = useCallback(
    (name) => {
      createWatchlistMutation.mutate(name);
    },
    [createWatchlistMutation],
  );

  const handleRenameWatchlist = useCallback(
    (watchlistId, name) => {
      updateWatchlistMutation.mutate({ watchlistId, body: { name } });
    },
    [updateWatchlistMutation],
  );

  const handleDeleteWatchlist = useCallback(
    (watchlistId) => {
      deleteWatchlistMutation.mutate(watchlistId);
    },
    [deleteWatchlistMutation],
  );

  const handleSetDefaultWatchlist = useCallback(
    (watchlistId) => {
      updateWatchlistMutation.mutate({
        watchlistId,
        body: { isDefault: true },
      });
    },
    [updateWatchlistMutation],
  );

  const handleAddSymbolToWatchlist = useCallback(
    (symbol, name, identitySource) => {
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
    },
    [activeWatchlist?.id, addWatchlistSymbolMutation, pushToast],
  );

  const handleRemoveSymbolFromWatchlist = useCallback(
    (itemId, symbol) => {
      if (!activeWatchlist?.id) {
        return;
      }
      removeWatchlistSymbolMutation.mutate({
        watchlistId: activeWatchlist.id,
        itemId,
        symbol,
      });
    },
    [activeWatchlist?.id, removeWatchlistSymbolMutation],
  );
  const handleReorderSymbolInWatchlist = useCallback(
    (itemId, targetItemId) => {
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
    },
    [activeWatchlist, reorderWatchlistMutation],
  );

  // Jump to Trade tab from Flow drawer with a contract preloaded
  const handleJumpToTradeFromFlow = useCallback(
    (evt) => {
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
    },
    [activateScreen],
  );

  const handleJumpToTradeFromSignalOptionsCandidate = useCallback(
    (candidate) => {
      const ticker = candidate?.symbol?.toUpperCase?.() || candidate?.symbol;
      if (!ticker) return;
      const selectedContract =
        candidate?.selectedContract &&
        typeof candidate.selectedContract === "object"
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
    },
    [activateScreen],
  );

  // Jump to Trade tab from Research with a ticker preloaded.
  // Research passes a plain ticker string rather than a flow event.
  const handleJumpToTradeFromResearch = useCallback(
    (ticker) => {
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
    },
    [activateScreen],
  );

  const handleAccountJumpToTrade = useCallback(
    (symbol) => {
      handleSelectSymbol(symbol);
      activateScreen("trade");
    },
    [activateScreen, handleSelectSymbol],
  );

  const renderScreenById = useCallback(
    (screenId) => (
      <PlatformScreenRouter
        screenId={screenId}
        screen={screen}
        sym={sym}
        tradeSymPing={tradeSymPing}
        marketSymPing={marketSymPing}
        session={session}
        environment={environment}
        accounts={accounts}
        accountScreenAccounts={accountScreenAccounts}
        primaryAccountId={primaryAccountId}
        brokerConfigured={brokerConfigured}
        brokerAuthenticated={brokerAuthenticated}
        massiveStockRealtimeConfigured={massiveStockRealtimeConfigured}
        marketDataProviderConfigurationReady={
          marketDataProviderConfigurationReady
        }
        gatewayTradingReady={effectiveGatewayTradingReady}
        gatewayTradingMessage={effectiveGatewayTradingMessage}
        gatewayTradingBlockReason={effectiveGatewayTradingBlockReason}
        watchlistSymbols={watchlistSymbols}
        runtimeWatchlistSymbols={runtimeWatchlistSymbols}
        signalMonitorEnvironment={signalMonitorEnvironment}
        signalMonitorSymbols={signalMonitorSymbols}
        signalMonitorDisplaySymbols={signalMonitorDisplaySymbols}
        signalMonitorProfile={signalMonitorProfile}
        signalMonitorProfileLoading={signalMonitorProfileQuery.isLoading}
        signalMonitorProfileError={signalMonitorProfileQuery.error || null}
        signalMonitorState={null}
        signalMonitorStateLoaded
        signalMonitorStateLoading={false}
        signalMonitorStateError={null}
        signalMonitorDataManagedByPlatform
        signalMonitorEvents={signalMonitorEvents}
        signalMonitorEventsSourceStatus={signalMonitorEventsSourceStatus}
        signalMonitorEventsLoaded={Boolean(
          signalMonitorEventsQuery.data || signalMonitorEventsQuery.isFetched,
        )}
        signalMatrixStates={signalMonitorPublishedStates}
        signalMatrixCoverage={signalMatrixSnapshot.coverage || null}
        signalMatrixUniverse={signalMatrixUniverseDescriptor}
        realtimeStreamGateReason={signalMatrixAuxiliaryStreamGateReason}
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
        onChangeMonitorFreshWindowBars={
          handleChangeSignalMonitorFreshWindowBars
        }
        onChangeMonitorMaxSymbols={handleChangeSignalMonitorMaxSymbols}
        onApplyPyrusSignalsSettings={handleApplySignalMonitorPyrusSettings}
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
    ),
    [
      accountScreenAccounts,
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
      handleScreenReadiness,
      handleSelectSymbol,
      handleSignalAction,
      handleToggleSignalMonitor,
      marketScreenActive,
      marketSymPing,
      marketUnusualThreshold,
      massiveStockRealtimeConfigured,
      marketDataProviderConfigurationReady,
      primaryAccountId,
      researchConfigured,
      runtimeWatchlistSymbols,
      safeQaMode,
      screen,
      session,
      sidebarCollapsed,
      signalMonitorPublishedStates,
      signalMonitorEnvironment,
      signalMonitorDisplaySymbols,
      signalMonitorEvents,
      signalMonitorEventsQuery.data,
      signalMonitorEventsQuery.isFetched,
      signalMonitorEventsSourceStatus,
      signalMonitorSymbols,
      signalMatrixAuxiliaryStreamGateReason,
      stockAggregateStreamingEnabled,
      sym,
      theme,
      toggleTheme,
      tradeSymPing,
      watchlistSymbols,
      watchlists,
    ],
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
      marketDataProviderConfiguration={{
        massiveStockRealtimeConfigured,
        marketDataProviderConfigurationReady,
      }}
    >
      <PlatformRuntimeLayer
        MarketDataSubscriptionProviderComponent={MarketDataSubscriptionProvider}
        SharedMarketFlowRuntimeComponent={SharedMarketFlowRuntime}
        BroadFlowScannerRuntimeComponent={BroadFlowScannerRuntime}
        watchlistSymbols={runtimeWatchlistSymbols}
        broadFlowWatchlistSymbols={broadFlowWatchlistSymbols}
        activeWatchlistItems={activeWatchlist?.items}
        quoteSymbols={safeQaMode ? [] : runtimeQuoteSymbols}
        activeVisibleQuoteSymbols={safeQaMode ? [] : activeVisibleQuoteSymbols}
        sparklineSymbols={safeQaMode ? [] : runtimeHistorySparklineSymbols}
        prioritySparklineSymbols={
          safeQaMode ? [] : runtimePrioritySparklineSymbols
        }
        aggregateOnlySparklineSymbols={
          safeQaMode ? [] : runtimeAggregateOnlySparklineSymbols
        }
        streamedQuoteSymbols={safeQaMode ? [] : runtimeStreamedQuoteSymbols}
        streamedAggregateSymbols={
          safeQaMode ? [] : runtimeStreamedAggregateSymbols
        }
        quoteStreamRuntimeEnabled={
          !safeQaMode && workSchedule.streams.watchlistQuoteStream
        }
        massiveStockRealtimeConfigured={massiveStockRealtimeConfigured}
        marketDataProviderConfigurationReady={
          marketDataProviderConfigurationReady
        }
        quoteStreamDisabledReason={quoteStreamGateReason}
        quoteStreamCoverageDiagnostics={watchlistQuoteStreamDiagnostics}
        marketStockAggregateStreamingEnabled={
          !safeQaMode && workSchedule.streams.marketStockAggregates
        }
        marketScreenActive={marketScreenActive}
        realtimeQuoteCoverageRequired={
          !safeQaMode &&
          massiveStockRealtimeConfigured &&
          !quoteStreamGateReason
        }
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
          HeaderStatusClusterComponent={null}
          HeaderBroadcastScrollerStackComponent={HeaderBroadcastScrollerStack}
          WatchlistComponent={MemoWatchlistContainer}
          memoryPressureSignal={memoryPressureSignal}
          apiSourcePressureSnapshot={footerApiSourceRuntime.snapshot}
          activeWatchlist={activeWatchlist}
          watchlistSymbols={watchlistSymbols}
          signalMonitorStates={watchlistSignalMonitorStates}
          signalMonitorProfile={signalMonitorProfile}
          signalActionTimeframe={signalMonitorProfile?.timeframe}
          signalMonitorEvents={signalMonitorEvents}
          signalMonitorEventsLoaded={Boolean(
            signalMonitorEventsQuery.data || signalMonitorEventsQuery.isFetched,
          )}
          headerSignalMatrixStates={headerBroadcastSignalMatrixStates}
          watchlistSignalMatrixStates={signalMonitorPublishedStates}
          activitySignalMatrixStates={activitySignalMatrixStates}
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
          realtimeStreamGateReason={signalMatrixAuxiliaryStreamGateReason}
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
                (signalMonitorEventsQuery.isError ||
                  evaluateSignalMonitorMutation.isError ||
                  updateSignalMonitorProfileMutation.isError)),
          )}
          onToggleSignalScan={handleToggleSignalMonitor}
          onChangeSignalMonitorTimeframe={handleChangeSignalMonitorTimeframe}
          onChangeSignalMonitorFreshWindowBars={
            handleChangeSignalMonitorFreshWindowBars
          }
          onChangeSignalMonitorMaxSymbols={handleChangeSignalMonitorMaxSymbols}
        />
      </PlatformRuntimeLayer>
      {!bootProgress.complete ? (
        <div
          className="pyrus-boot-progress-overlay"
          data-testid="pyrus-boot-progress-overlay"
        >
          <NeuralLoader
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
