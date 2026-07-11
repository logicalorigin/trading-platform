import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getGetAlgoDeploymentCockpitQueryKey,
  getGetAccountPositionsQueryKey,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalOptionsAutomationStateQueryKey,
  getGetSignalOptionsPerformanceQueryKey,
  getListAlgoDeploymentsQueryKey,
  getListExecutionEventsQueryKey,
  getListSignalMonitorEventsQueryKey,
  useGetAccountPositions,
  useCreateAlgoDeployment,
  useEnableAlgoDeployment,
  useGetAlgoDeploymentCockpit,
  useGetSignalOptionsPerformance,
  useGetSignalOptionsAutomationState,
  useListAlgoDeployments,
  useListBacktestDraftStrategies,
  useListExecutionEvents,
  usePauseAlgoDeployment,
  useSetAlgoDeploymentMode,
  useUpdateAlgoDeploymentStrategySettings,
  useUpdateSignalOptionsExecutionProfile,
} from "@workspace/api-client-react";
import {
  ALGO_DEPLOYMENT_KIND,
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PROFILE_BOOLEAN_FIELDS,
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  SIGNAL_OPTIONS_LIQUIDITY_REASON_LABELS,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
  STRATEGY_SIGNAL_TIMEFRAMES,
  asRecord,
  boundedNumberFrom,
  buildVisibleSignalRows,
  candidateMatchesReasonCategory,
  candidateReasonCategory,
  cloneProfile,
  cockpitAttentionColor,
  cockpitStageColor,
  compactButtonStyle,
  formatChaseSteps,
  formatContractLabel,
  formatLiquidityFreshness,
  formatLiquidityReason,
  mergeStaSignalPipelineStages,
  mergeSignalOptionsProfile,
  numberFrom,
  normalizeStrategySignalTimeframes,
  parseChaseSteps,
  resolveStrategySignalSettings,
  resolveStableStaActionSnapshot,
  shadowLinkSummary,
  signalActionLabel,
  signalBarsSinceLabel,
  signalFilterStateLabel,
  signalFreshnessLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
} from "./algo/algoHelpers";
import { normalizeAlgoAlignedMtfTimeframes } from "./algo/algoTimeframeControls";
import { CreateDeploymentModal } from "./algo/CreateDeploymentModal.jsx";
import {
  planAlgoAdjustmentsSaveReconciliation,
  saveAllAlgoAdjustments,
} from "./algo/saveAllAlgoAdjustments";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.jsx";
import { buildCockpitGateSummary as buildCockpitGateSummaryImpl } from "./algoCockpitDiagnosticsModel";
import { AlgoRightRail } from "./algo/AlgoRightRail.jsx";
import { normalizeLegacyAlgoBrandText } from "./algo/algoBranding.js";
import { useServerSyncedDraft } from "./algo/useServerSyncedDraft";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  useAlgoCockpitStream,
  useShadowAccountSnapshotStream,
} from "../features/platform/live-streams";
import { useAuthSession } from "../features/auth/authSession.jsx";
import { useAccountTab } from "../features/platform/useAccountTab.js";
import {
  clearAlgoStaExecutionTimeframe,
  publishAlgoStaExecutionTimeframe,
  publishAlgoStaMtfAlignmentConfig,
  publishAlgoStaMtfTimeframes,
} from "../features/platform/algoStaExecutionTimeframeStore.js";
import {
  clearAlgoDeploymentFocus,
  publishAlgoDeploymentFocus,
} from "../features/platform/algoDeploymentFocusStore.js";
import {
  QUERY_DEFAULTS,
  retryUnlessTimeout,
} from "../features/platform/queryDefaults";
import { useToast } from "../features/platform/platformContexts.jsx";
import {
  beginCriticalApiMutationPause,
  useCriticalApiMutationPause,
  waitForCriticalApiMutationPauseSettle,
} from "../features/platform/criticalApiMutationPause.js";
import {
  formatOptionContractLabel,
  parseSymbolUniverseInput,
} from "../lib/formatters";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import { formatAppTimeForPreferences } from "../lib/timeZone";
import { CSS_COLOR, MISSING_VALUE, sp } from "../lib/uiTokens.jsx";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import { retryDynamicImport } from "../lib/dynamicImport";

let algoLivePageImport = null;
const loadAlgoLivePage = () => {
  if (!algoLivePageImport) {
    algoLivePageImport = retryDynamicImport(
      () => import("./algo/AlgoLivePage"),
      { label: "AlgoLivePage", reloadOnFailure: false },
    ).catch((error) => {
      algoLivePageImport = null;
      throw error;
    });
  }
  return algoLivePageImport;
};
const LazyAlgoLivePage = lazy(() =>
  loadAlgoLivePage().then((mod) => ({ default: mod.AlgoLivePage })),
);
const preloadAlgoLivePage = () =>
  loadAlgoLivePage().then((mod) => mod.preloadAlgoLivePageModules?.());

const AlgoLivePageLoadingStatus = () => (
  <div
    role="status"
    data-testid="algo-live-page-loading"
    style={{ padding: sp("18px 0"), color: CSS_COLOR.textMuted }}
  >
    Loading algo workspace
  </div>
);

// Warm both nested live-page code and the lazily-imported runtime helpers.
// The route component itself resolves first so navigation can paint its real
// container while this compact status truthfully reports the remaining work.
export const preloadScreenModules = () =>
  Promise.all([preloadAlgoLivePage(), loadAlgoRuntimeHelpers()]).then(
    () => undefined,
  );

// 25s, not 8s: a save round-trip is ~0.8s when the API event loop is healthy,
// but under the heavy-DB-fan-out freeze the loop stalls 12-90s and the PATCH
// queues behind it. An 8s budget timed out mid-freeze -> the Signal/Profile task
// threw -> the perpetual "Save partially failed" even though the write would have
// succeeded. The pre-save connection pause (beginCriticalApiMutationPause) sheds
// SSE load so the loop unblocks faster during the save; 25s then rides out a
// typical freeze with headroom. (The real cure is the DB-fan-out fix; this stops
// the save from being collateral damage until then.)
const ALGO_SETTINGS_SAVE_TIMEOUT_MS = 25_000;
const ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS = 300;
const ALGO_SETTINGS_SAVE_PAUSE_TTL_MS =
  ALGO_SETTINGS_SAVE_TIMEOUT_MS + ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS + 5_000;
const ALGO_SETTINGS_SAVE_REQUEST_OPTIONS = Object.freeze({
  timeoutMs: ALGO_SETTINGS_SAVE_TIMEOUT_MS,
});

const EMPTY_ALGO_DEPLOYMENTS = Object.freeze([]);
const EMPTY_ALGO_DRAFTS = Object.freeze([]);
const EMPTY_ALGO_EVENTS = Object.freeze([]);
const EMPTY_SIGNAL_OPTIONS_CANDIDATES = Object.freeze([]);
const EMPTY_SIGNAL_OPTIONS_SIGNALS = Object.freeze([]);
const EMPTY_SIGNAL_OPTIONS_POSITIONS = Object.freeze([]);

const latestIsoFromRows = (items, fields) => {
  const latestMs = (Array.isArray(items) ? items : []).reduce(
    (latest, item) => {
      const record = asRecord(item);
      return Math.max(
        latest,
        ...fields.map((field) => Date.parse(record[field] || "") || 0),
      );
    },
    0,
  );
  return latestMs ? new Date(latestMs).toISOString() : null;
};

const isAlgoExecutionScanStageRunning = (stage) => {
  const record = asRecord(stage);
  const scanAgeMs = Number(record.scanAgeMs);
  return (
    String(record.status || "").toLowerCase() === "running" ||
    record.running === true ||
    Boolean(
      record.scanStartedAt && Number.isFinite(scanAgeMs) && scanAgeMs >= 0,
    )
  );
};

const signalOptionsRuleColor = (status) => {
  if (status === "fail") return CSS_COLOR.red;
  if (status === "warning") return CSS_COLOR.amber;
  return CSS_COLOR.green;
};

const cloneStrategySettings = (settings) => ({
  ...DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  ...(settings || {}),
});

const EMPTY_COCKPIT_GATE_SUMMARY = Object.freeze({
  signalFreshness: Object.freeze({}),
  tradePath: Object.freeze({}),
  skipReasonRows: Object.freeze([]),
  skipCategoryRows: Object.freeze([]),
  entryGateRows: Object.freeze([]),
  optionChainRows: Object.freeze([]),
  readinessRows: Object.freeze([]),
  lifecycleRows: Object.freeze([]),
  markHealthRows: Object.freeze([]),
});

const createEmptyTransitionsStore = () => ({
  push: () => [],
  get: () => [],
  prune: () => {},
});

const DEFAULT_ALGO_RUNTIME_HELPERS = Object.freeze({
  buildTransitionsBufferStore: createEmptyTransitionsStore,
  collectEventTransitions: () => [],
  diffSignalSnapshots: () => [],
  limitToWindow: (transitions = []) => transitions,
  summarizeCockpitDelta: () => null,
  buildKpiSample: () => ({}),
  pruneAlgoKpiHistory: () => {},
  pushAlgoKpiSample: () => {},
  buildCockpitGateSummary: () => EMPTY_COCKPIT_GATE_SUMMARY,
});

let algoRuntimeHelpersImport = null;
const loadAlgoRuntimeHelpers = () => {
  if (!algoRuntimeHelpersImport) {
    algoRuntimeHelpersImport = retryDynamicImport(
      () =>
        Promise.all([
          import("../features/platform/algoTransitionsModel"),
          import("../features/platform/algoActivitySummary"),
          import("../features/platform/algoKpiHistoryStore"),
        ]),
      { label: "AlgoRuntimeHelpers", reloadOnFailure: false },
    )
      .then(([transitions, activity, kpi]) => ({
        buildTransitionsBufferStore:
          transitions.buildTransitionsBufferStore ||
          DEFAULT_ALGO_RUNTIME_HELPERS.buildTransitionsBufferStore,
        collectEventTransitions:
          transitions.collectEventTransitions ||
          DEFAULT_ALGO_RUNTIME_HELPERS.collectEventTransitions,
        diffSignalSnapshots:
          transitions.diffSignalSnapshots ||
          DEFAULT_ALGO_RUNTIME_HELPERS.diffSignalSnapshots,
        limitToWindow:
          transitions.limitToWindow ||
          DEFAULT_ALGO_RUNTIME_HELPERS.limitToWindow,
        summarizeCockpitDelta:
          activity.summarizeCockpitDelta ||
          DEFAULT_ALGO_RUNTIME_HELPERS.summarizeCockpitDelta,
        buildKpiSample:
          kpi.buildKpiSample || DEFAULT_ALGO_RUNTIME_HELPERS.buildKpiSample,
        pruneAlgoKpiHistory:
          kpi.pruneAlgoKpiHistory ||
          DEFAULT_ALGO_RUNTIME_HELPERS.pruneAlgoKpiHistory,
        pushAlgoKpiSample:
          kpi.pushAlgoKpiSample ||
          DEFAULT_ALGO_RUNTIME_HELPERS.pushAlgoKpiSample,
        buildCockpitGateSummary: buildCockpitGateSummaryImpl,
      }))
      .catch((error) => {
        algoRuntimeHelpersImport = null;
        throw error;
      });
  }
  return algoRuntimeHelpersImport;
};

// Market data now comes from Massive; the IBKR bridge is retired and the signal-options
// algo pipeline is shadow-first, so "ready" here means market data is configured/available,
// not that an IBKR gateway is connected.
const isMarketDataReadyForAlgo = (session) =>
  Boolean(session?.configured?.massive);

export const AlgoScreen = ({
  session,
  environment,
  accounts = [],
  accountTabsAccounts = accounts,
  selectedAccountId = null,
  signalMonitorEventsLoaded = false,
  signalMonitorState = null,
  signalMatrixStates = [],
  realtimeStreamGateReason = null,
  isVisible = false,
  safeQaMode = false,
  onScanNow,
  onJumpToTradeCandidate,
  onReadinessChange,
}) => {
  const [algoRootRef, algoRootSize] = useElementSize();
  const { isPhone: algoIsPhone, isNarrow: algoIsNarrow } = responsiveFlags(
    algoRootSize.width,
  );
  const algoMetricsGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(5, minmax(0, 1fr))";
  const algoCommandGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "minmax(230px, 0.95fr) minmax(230px, 0.85fr)"
      : "minmax(260px, 0.95fr) minmax(240px, 0.7fr) minmax(420px, 1.35fr)";
  const algoTwoColumnTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "minmax(220px, 0.85fr) minmax(0, 1.15fr)"
      : "minmax(320px, 0.95fr) minmax(420px, 1.35fr)";
  const algoCandidateGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "minmax(220px, 0.85fr) minmax(0, 1.15fr)"
      : "minmax(280px, 0.95fr) minmax(360px, 1.25fr)";
  const algoDetailGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "minmax(0, 1.15fr) minmax(240px, 0.85fr)"
      : "minmax(0, 1.25fr) minmax(320px, 0.9fr)";
  const algoPerformanceGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "minmax(0, 1.2fr) minmax(220px, 0.8fr)"
      : "minmax(0, 1.25fr) minmax(240px, 0.75fr)";
  const algoProfileGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(3, minmax(0, 1fr))";
  const algoDiagnosticsGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "minmax(150px, 0.65fr) repeat(2, minmax(0, 1fr))"
      : "minmax(180px, 0.7fr) repeat(3, minmax(0, 1fr))";
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const queryClient = useQueryClient();
  const authSession = useAuthSession();
  const csrfToken = authSession.csrfToken || "";
  const csrfHeaders = useMemo(
    () => (csrfToken ? { "x-csrf-token": csrfToken } : {}),
    [csrfToken],
  );
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [symbolUniverseInput, setSymbolUniverseInput] = useState("");
  const [focusedDeploymentId, setFocusedDeploymentId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingLiveSwitch, setPendingLiveSwitch] = useState(null);
  const [diagExpansion, setDiagExpansion] = useState({});
  const [selectedPipelineStageId, setSelectedPipelineStageId] = useState("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const saveAllInFlightRef = useRef(false);
  const [saveAllPending, setSaveAllPending] = useState(false);
  const criticalApiMutationPaused = useCriticalApiMutationPause();
  const [algoRuntimeHelpers, setAlgoRuntimeHelpers] = useState(
    DEFAULT_ALGO_RUNTIME_HELPERS,
  );
  const marketDataConfigured = Boolean(session?.configured?.massive);
  const marketDataReady = isMarketDataReadyForAlgo(session);
  const activeAccount =
    accounts.find((account) => account.id === selectedAccountId) ||
    accounts[0] ||
    null;
  const activeAccountId =
    activeAccount?.id ||
    selectedAccountId ||
    session?.ibkrBridge?.selectedAccountId ||
    null;
  const [algoAccountTabRaw, setAlgoAccountTab] = useAccountTab("shadow");
  const positionAccounts = accountTabsAccounts.length
    ? accountTabsAccounts
    : accounts;
  const algoAccountTab = useMemo(() => {
    if (algoAccountTabRaw === "all" || algoAccountTabRaw === "shadow") {
      return algoAccountTabRaw;
    }
    return positionAccounts.some((account) => account.id === algoAccountTabRaw)
      ? algoAccountTabRaw
      : "shadow";
  }, [algoAccountTabRaw, positionAccounts]);
  const algoPositionsAccountId =
    algoAccountTab === "shadow"
      ? "shadow"
      : algoAccountTab === "all"
        ? "combined"
        : algoAccountTab;
  const algoPositionsUseShadowOverlay = algoAccountTab === "shadow";
  useEffect(() => {
    if (!isVisible || algoRuntimeHelpers !== DEFAULT_ALGO_RUNTIME_HELPERS) {
      return undefined;
    }
    let cancelled = false;
    loadAlgoRuntimeHelpers()
      .then((helpers) => {
        if (!cancelled) {
          setAlgoRuntimeHelpers(helpers);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [algoRuntimeHelpers, isVisible]);
  const algoLiveDataQueriesEnabled = Boolean(
    isVisible && !criticalApiMutationPaused,
  );
  const algoRealtimeStreamsEnabled = Boolean(
    algoLiveDataQueriesEnabled && !realtimeStreamGateReason,
  );
  const algoCockpitStreamFreshness = useAlgoCockpitStream({
    deploymentId: focusedDeploymentId,
    mode: environment || "shadow",
    enabled: algoRealtimeStreamsEnabled,
  });
  const shadowAccountStreamFreshness = useShadowAccountSnapshotStream({
    enabled: algoRealtimeStreamsEnabled,
  });
  const algoTimingStagesRef = useRef(new Set());
  useEffect(() => {
    if (!isVisible) {
      algoTimingStagesRef.current = new Set();
    }
  }, [isVisible]);
  const markAlgoTiming = useCallback((stage, detail) => {
    if (algoTimingStagesRef.current.has(stage)) {
      return;
    }
    algoTimingStagesRef.current.add(stage);
    markRouteDataTiming("algo", stage, detail);
  }, []);
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    markAlgoTiming("route-module-loaded");
  }, [isVisible, markAlgoTiming]);
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    markAlgoTiming("primary-data-ready", {
      source: algoCockpitStreamFreshness.algoPrimaryFresh
        ? "stream"
        : "rest-catchup",
    });
  }, [algoCockpitStreamFreshness.algoPrimaryFresh, isVisible, markAlgoTiming]);
  const algoSetupQueriesEnabled = Boolean(isVisible);
  const algoPrimaryQueriesEnabled = Boolean(algoLiveDataQueriesEnabled);
  const algoDerivedRestQueriesEnabled = Boolean(algoLiveDataQueriesEnabled);
  const algoBackgroundQueriesEnabled = Boolean(
    algoDerivedRestQueriesEnabled && !safeQaMode,
  );
  const algoPostPrimaryQueriesEnabled = Boolean(
    algoLiveDataQueriesEnabled &&
      // Shadow positions arrive over SSE, so REST only catches up when the stream
      // is not fresh. Broker/combined tabs have no stream and always use REST.
      (algoPositionsUseShadowOverlay
        ? !shadowAccountStreamFreshness.accountFresh
        : true),
  );
  const algoRoutineRefetchInterval =
    isVisible && !algoCockpitStreamFreshness.algoPrimaryFresh
      ? QUERY_DEFAULTS.refetchInterval
      : false;
  const algoDerivedRefetchInterval =
    isVisible && !algoCockpitStreamFreshness.algoFullFresh
      ? QUERY_DEFAULTS.refetchInterval
      : false;
  const signalOptionsLedgerPositionsRefetchInterval =
    algoPostPrimaryQueriesEnabled ? 60_000 : false;
  useRuntimeWorkloadFlag("algo:cockpit", isVisible, {
    kind: algoCockpitStreamFreshness.algoPrimaryFresh ? "stream" : "poll",
    label: "Algo cockpit",
    detail: algoCockpitStreamFreshness.algoPrimaryFresh
      ? "SSE"
      : "REST catch-up",
    priority: 7,
  });
  const draftsQuery = useListBacktestDraftStrategies({
    query: {
      ...QUERY_DEFAULTS,
      enabled: algoSetupQueriesEnabled,
      refetchInterval: algoDerivedRefetchInterval,
      retry: false,
    },
  });
  const deploymentsQuery = useListAlgoDeployments(undefined, {
    query: {
      ...QUERY_DEFAULTS,
      enabled: algoSetupQueriesEnabled,
      // One transient blip (an API reload gap, a queued-pool 5xx) must not
      // latch the "deployment list unavailable" banner: when the cockpit
      // stream is fresh the routine interval is `false`, so an errored query
      // would otherwise never refetch and the banner persists until a manual
      // refresh. Keep polling while errored so recovery is guaranteed, and
      // retry transient failures. Timeouts stay terminal (retryUnlessTimeout)
      // and the banner still renders on persistent failure — the fail-visible
      // contract (automation.test.ts: no stale substitution) is unchanged.
      refetchInterval: (query) =>
        query.state.status === "error"
          ? QUERY_DEFAULTS.refetchInterval
          : algoRoutineRefetchInterval,
      retry: retryUnlessTimeout(2),
    },
  });
  const deploymentsResponse = deploymentsQuery.isError
    ? null
    : deploymentsQuery.data;
  const deployments =
    deploymentsResponse?.deployments || EMPTY_ALGO_DEPLOYMENTS;
  const deploymentPnlById = deploymentsResponse?.pnlByDeployment || null;
  const deploymentListUnavailable = Boolean(
    !deploymentsQuery.isFetching && deploymentsQuery.isError,
  );
  const draftsResponse = draftsQuery.isError ? null : draftsQuery.data;
  const candidateDrafts = useMemo(() => {
    const drafts = draftsResponse?.drafts || EMPTY_ALGO_DRAFTS;
    const matchingMode = drafts.filter((draft) => draft.mode === environment);
    return matchingMode.length ? matchingMode : drafts;
  }, [draftsResponse, environment]);
  const selectedDraft =
    candidateDrafts.find((draft) => draft.id === selectedDraftId) ||
    candidateDrafts[0] ||
    null;
  const focusedDeployment =
    deployments.find((deployment) => deployment.id === focusedDeploymentId) ||
    deployments[0] ||
    null;
  const eventsQuery = useListExecutionEvents(
    focusedDeployment
      ? { deploymentId: focusedDeployment.id, limit: 100 }
      : { limit: 100 },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: algoLiveDataQueriesEnabled,
        refetchInterval: algoRoutineRefetchInterval,
        retry: false,
      },
    },
  );
  const eventsResponse = eventsQuery.isError ? null : eventsQuery.data;
  const events = eventsResponse?.events || EMPTY_ALGO_EVENTS;
  const signalOptionsStateQuery = useGetSignalOptionsAutomationState(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(algoPrimaryQueriesEnabled && focusedDeployment?.id),
        refetchInterval: algoRoutineRefetchInterval,
        retry: false,
      },
    },
  );
  const cockpitQuery = useGetAlgoDeploymentCockpit(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(
          algoDerivedRestQueriesEnabled && focusedDeployment?.id,
        ),
        refetchInterval: algoDerivedRefetchInterval,
        retry: false,
      },
    },
  );
  const signalOptionsPerformanceQuery = useGetSignalOptionsPerformance(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(algoBackgroundQueriesEnabled && focusedDeployment?.id),
        refetchInterval: algoDerivedRefetchInterval,
        retry: false,
      },
    },
  );
  const signalOptionsLedgerPositionsQuery = useGetAccountPositions(
    algoPositionsAccountId,
    algoPositionsUseShadowOverlay
      ? {
          mode: "shadow",
          assetClass: "all",
          source: "automation",
          detail: "fast",
          liveQuotes: true,
        }
      : {
          mode: "live",
          assetClass: "all",
          detail: "fast",
          liveQuotes: true,
        },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: algoPostPrimaryQueriesEnabled,
        staleTime: shadowAccountStreamFreshness.accountFresh
          ? 30_000
          : QUERY_DEFAULTS.staleTime,
        refetchInterval: signalOptionsLedgerPositionsRefetchInterval,
        retry: false,
      },
    },
  );
  const signalOptionsLedgerPositionsQueryForDisplay =
    signalOptionsLedgerPositionsQuery.isError
      ? { ...signalOptionsLedgerPositionsQuery, data: undefined }
      : signalOptionsLedgerPositionsQuery;
  const deploymentsSettled = Boolean(
    deploymentListUnavailable ||
      deploymentsQuery.data ||
      deploymentsQuery.isFetched ||
      deploymentsQuery.isError,
  );
  const draftsSettled = Boolean(
    draftsQuery.data || draftsQuery.isFetched || draftsQuery.isError,
  );
  const cockpitSettled = Boolean(
    cockpitQuery.data || cockpitQuery.isFetched || cockpitQuery.isError,
  );
  const algoSetupDataSettled = Boolean(deploymentsSettled && draftsSettled);
  const algoDerivedRestSettled = Boolean(
    !focusedDeployment?.id || cockpitSettled,
  );
  const algoDerivedReady = Boolean(
    isVisible &&
      (algoCockpitStreamFreshness.algoFullFresh || algoDerivedRestSettled),
  );
  useEffect(() => {
    onReadinessChange?.({
      contentReady: Boolean(isVisible),
      primaryReady: Boolean(isVisible),
      derivedReady: algoDerivedReady,
      backgroundAllowed: Boolean(isVisible && !safeQaMode && algoDerivedReady),
    });
  }, [algoDerivedReady, isVisible, onReadinessChange, safeQaMode]);
  useEffect(() => {
    if (!isVisible || !algoDerivedReady) {
      return;
    }
    markAlgoTiming("derived-data-ready", {
      source: algoCockpitStreamFreshness.algoFullFresh
        ? "stream"
        : "rest-catchup",
    });
  }, [
    algoCockpitStreamFreshness.algoFullFresh,
    algoDerivedReady,
    isVisible,
    markAlgoTiming,
  ]);
  const cockpit = cockpitQuery.isError ? null : cockpitQuery.data || null;
  const cockpitKpis = asRecord(cockpit?.kpis);
  const cockpitRisk = asRecord(cockpit?.risk);
  const {
    buildTransitionsBufferStore,
    collectEventTransitions,
    diffSignalSnapshots,
    limitToWindow,
    summarizeCockpitDelta,
    buildKpiSample,
    pruneAlgoKpiHistory,
    pushAlgoKpiSample,
    buildCockpitGateSummary,
  } = algoRuntimeHelpers;
  const transitionsStoreRef = useRef(null);
  if (transitionsStoreRef.current === null) {
    transitionsStoreRef.current = buildTransitionsBufferStore();
  }
  const prevCockpitSignalsRef = useRef(null);
  const [recentTransitions, setRecentTransitions] = useState([]);
  const [transitionsNow, setTransitionsNow] = useState(() => Date.now());
  const prevActivitySnapshotRef = useRef(null);
  const prevActivityPerformanceRef = useRef(null);
  const [activitySummary, setActivitySummary] = useState(null);
  const signalOptionsPerformance = signalOptionsPerformanceQuery.isError
    ? null
    : signalOptionsPerformanceQuery.data || null;
  const signalOptionsState = signalOptionsStateQuery.isError
    ? null
    : signalOptionsStateQuery.data || null;
  const cockpitDataAvailable = Boolean(
    cockpit &&
      !cockpitQuery.isError &&
      cockpit.stale !== true &&
      cockpit.degraded !== true &&
      cockpit.cacheStatus !== "stale" &&
      cockpit.cacheStatus !== "unavailable",
  );
  const performanceDataAvailable = Boolean(
    signalOptionsPerformance &&
      !signalOptionsPerformanceQuery.isError &&
      signalOptionsPerformance.stale !== true &&
      signalOptionsPerformance.degraded !== true &&
      signalOptionsPerformance.cacheStatus !== "stale" &&
      signalOptionsPerformance.cacheStatus !== "unavailable",
  );
  const signalOptionsStateDataAvailable = Boolean(
    signalOptionsState &&
      !signalOptionsStateQuery.isError &&
      signalOptionsState.stale !== true &&
      signalOptionsState.degraded !== true &&
      signalOptionsState.cacheStatus !== "stale" &&
      signalOptionsState.cacheStatus !== "unavailable",
  );
  const cockpitPnlDataAvailable = Boolean(
    cockpitDataAvailable &&
      cockpitKpis.dailyRealizedPnl != null &&
      Number.isFinite(Number(cockpitKpis.dailyRealizedPnl)) &&
      cockpitKpis.openUnrealizedPnl != null &&
      Number.isFinite(Number(cockpitKpis.openUnrealizedPnl)),
  );
  const cockpitRiskDataAvailable = Boolean(
    cockpitDataAvailable &&
      typeof cockpitRisk.dailyHaltActive === "boolean" &&
      cockpitRisk.maxDailyLoss != null &&
      Number.isFinite(Number(cockpitRisk.maxDailyLoss)) &&
      cockpitRisk.dailyPnl != null &&
      Number.isFinite(Number(cockpitRisk.dailyPnl)) &&
      cockpitRisk.openSymbols != null &&
      Number.isFinite(Number(cockpitRisk.openSymbols)) &&
      cockpitRisk.maxOpenSymbols != null &&
      Number.isFinite(Number(cockpitRisk.maxOpenSymbols)),
  );
  const cockpitPositionDataAvailable = Boolean(
    cockpitDataAvailable &&
      cockpitKpis.openPositions != null &&
      Number.isFinite(Number(cockpitKpis.openPositions)),
  );
  const positionDataAvailable = Boolean(
    cockpitPositionDataAvailable || signalOptionsStateDataAvailable,
  );
  const signalMonitorProfile = signalMonitorState?.profile || null;
  const signalMonitorUniverseSymbols = Array.isArray(
    signalMonitorState?.universeSymbols,
  )
    ? signalMonitorState.universeSymbols
    : [];
  const signalMatrixStateUniverseSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(signalMatrixStates) ? signalMatrixStates : [])
            .map((state) =>
              String(asRecord(state).symbol || "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean),
        ),
      ),
    [signalMatrixStates],
  );
  const staSignalUniverseSymbols = signalMonitorUniverseSymbols.length
    ? signalMonitorUniverseSymbols
    : signalMatrixStateUniverseSymbols.length
      ? signalMatrixStateUniverseSymbols
      : focusedDeployment?.symbolUniverse || [];
  const signalScanReady = true;
  const signalMatrixRowsAvailable = Boolean(
    Array.isArray(signalMatrixStates) && signalMatrixStates.length,
  );
  const signalMatrixFeedSettled = Boolean(
    signalMatrixRowsAvailable ||
      signalMonitorEventsLoaded ||
      signalMonitorState ||
      algoCockpitStreamFreshness.algoFullFresh,
  );
  const deploymentSignalOptionsBaselineAvailable = useMemo(() => {
    const config = asRecord(focusedDeployment?.config);
    const signalOptions = asRecord(config.signalOptions);
    if (Object.keys(signalOptions).length) {
      return true;
    }
    const parameters = asRecord(config.parameters);
    return (
      parameters.executionMode === "signal_options" ||
      Object.keys(parameters).some((key) => key.startsWith("signalOptions"))
    );
  }, [focusedDeployment?.config]);
  const deploymentSignalOptionsProfile = useMemo(
    () =>
      focusedDeployment?.config && deploymentSignalOptionsBaselineAvailable
        ? mergeSignalOptionsProfile(focusedDeployment.config)
        : null,
    [deploymentSignalOptionsBaselineAvailable, focusedDeployment?.config],
  );
  const signalOptionsProfile =
    signalOptionsState?.profile ||
    deploymentSignalOptionsProfile ||
    SIGNAL_OPTIONS_DEFAULT_PROFILE;
  const controlBaselineReady = Boolean(focusedDeployment);
  const staActionSnapshot = useMemo(
    () =>
      resolveStableStaActionSnapshot({
        cockpit,
        signalOptionsState,
        cockpitFailed: cockpitQuery.isError,
        signalOptionsStateFailed: signalOptionsStateQuery.isError,
      }),
    [
      cockpit,
      cockpitQuery.isError,
      signalOptionsState,
      signalOptionsStateQuery.isError,
    ],
  );
  const signalOptionsCandidates =
    staActionSnapshot.candidates || EMPTY_SIGNAL_OPTIONS_CANDIDATES;
  const signalOptionsSignals =
    staActionSnapshot.signals || EMPTY_SIGNAL_OPTIONS_SIGNALS;
  const signalOptionsPositions =
    staActionSnapshot.activePositions || EMPTY_SIGNAL_OPTIONS_POSITIONS;
  const cockpitPipelineStages = cockpit?.pipelineStages || [];
  const cockpitAttentionItems = cockpit?.attentionItems || [];
  const cockpitGateSummary = buildCockpitGateSummary(cockpit);
  const cockpitSignalFreshness = cockpitGateSummary.signalFreshness;
  const cockpitTradePath = cockpitGateSummary.tradePath;
  const cockpitSkipReasonRows = cockpitGateSummary.skipReasonRows;
  const cockpitSkipCategoryRows = cockpitGateSummary.skipCategoryRows;
  const cockpitEntryGateRows = cockpitGateSummary.entryGateRows;
  const cockpitOptionChainRows = cockpitGateSummary.optionChainRows;
  const cockpitReadinessRows = cockpitGateSummary.readinessRows;
  const cockpitLifecycleRows = cockpitGateSummary.lifecycleRows;
  const cockpitMarkHealthRows = cockpitGateSummary.markHealthRows;
  const signalOptionsPerformanceSummary = asRecord(
    signalOptionsPerformance?.summary,
  );
  const signalOptionsRuleAdherence = Array.isArray(
    signalOptionsPerformance?.ruleAdherence,
  )
    ? signalOptionsPerformance.ruleAdherence
    : [];
  const signalOptionsTopBlockers = Array.isArray(
    signalOptionsPerformance?.topBlockers,
  )
    ? signalOptionsPerformance.topBlockers
    : [];
  const selectedCandidate =
    signalOptionsCandidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    ) ||
    signalOptionsCandidates[0] ||
    null;
  const displayedSignalOptionsCandidates = useMemo(() => {
    if (selectedPipelineStageId === "all") {
      return signalOptionsCandidates;
    }

    return signalOptionsCandidates.filter((candidate) => {
      const actionStatus = String(
        candidate.actionStatus || candidate.status || "",
      );
      const hasContract =
        Object.keys(asRecord(candidate.selectedContract)).length > 0;
      const timeline = Array.isArray(candidate.timeline)
        ? candidate.timeline
        : [];
      if (selectedPipelineStageId === "signal_detected") return true;
      if (selectedPipelineStageId === "action_mapped") {
        return (
          Object.keys(asRecord(candidate.action)).length > 0 ||
          candidateMatchesReasonCategory(candidate, ["signal_policy"])
        );
      }
      if (selectedPipelineStageId === "contract_selected") {
        return (
          hasContract ||
          candidateMatchesReasonCategory(candidate, ["contract_resolution"])
        );
      }
      if (selectedPipelineStageId === "liquidity_risk_gate") {
        return (
          candidateMatchesReasonCategory(candidate, ["liquidity", "risk"]) ||
          Object.keys(asRecord(candidate.liquidity)).length > 0
        );
      }
      if (selectedPipelineStageId === "position_managed") {
        return candidateMatchesReasonCategory(candidate, ["marking"]);
      }
      if (selectedPipelineStageId === "order_shadow") {
        return (
          ["shadow_filled", "partial_shadow", "mismatch", "closed"].includes(
            actionStatus,
          ) || Object.keys(asRecord(candidate.shadowLink)).length > 0
        );
      }
      if (selectedPipelineStageId === "exit_close") {
        return timeline.some((item) =>
          String(asRecord(item).type || "").includes("exit"),
        );
      }
      return true;
    });
  }, [selectedPipelineStageId, signalOptionsCandidates]);
  const symbolIndex = useMemo(() => {
    const index = {};
    for (const signal of signalOptionsSignals || []) {
      const symbol = String(asRecord(signal).symbol || "").toUpperCase();
      if (!symbol) continue;
      index[symbol] = index[symbol] || {};
      index[symbol].signal = signal;
    }
    for (const candidate of signalOptionsCandidates || []) {
      const symbol = String(asRecord(candidate).symbol || "").toUpperCase();
      if (!symbol) continue;
      index[symbol] = index[symbol] || {};
      if (!index[symbol].candidate) {
        index[symbol].candidate = candidate;
      }
    }
    for (const position of signalOptionsPositions || []) {
      const symbol = String(asRecord(position).symbol || "").toUpperCase();
      if (!symbol) continue;
      index[symbol] = index[symbol] || {};
      index[symbol].position = position;
    }
    return index;
  }, [signalOptionsSignals, signalOptionsCandidates, signalOptionsPositions]);

  useEffect(() => {
    const store = transitionsStoreRef.current;
    if (!store) return;
    const deploymentId = focusedDeployment?.id || null;
    store.prune(deploymentId);
    setRecentTransitions(store.get(deploymentId));
    prevCockpitSignalsRef.current = null;
  }, [focusedDeployment?.id]);

  useEffect(() => {
    const store = transitionsStoreRef.current;
    if (!store) return;
    const deploymentId = focusedDeployment?.id || null;
    if (!deploymentId) {
      setRecentTransitions((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const evaluatedAt = cockpit?.evaluatedAt;
    const prevSignals = prevCockpitSignalsRef.current;
    const transitions = prevSignals
      ? diffSignalSnapshots(prevSignals, signalOptionsSignals, evaluatedAt)
      : [];
    const eventTransitions = collectEventTransitions(events, {
      sinceMs: Date.now() - 60_000,
    });
    const next = store.push(deploymentId, [
      ...transitions,
      ...eventTransitions,
    ]);
    prevCockpitSignalsRef.current = signalOptionsSignals;
    setRecentTransitions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on
    // cockpit settle / deployment switch. `events` and `signalOptionsSignals`
    // mint new refs every render before queries resolve and would loop the
    // effect; we capture them via closure instead.
  }, [cockpit?.evaluatedAt, focusedDeployment?.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTransitionsNow(Date.now());
    }, 5_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    prevActivitySnapshotRef.current = null;
    prevActivityPerformanceRef.current = null;
    setActivitySummary(null);
  }, [focusedDeployment?.id]);

  useEffect(() => {
    if (!focusedDeployment?.id) {
      setActivitySummary(null);
      return;
    }
    const nextSnapshot = cockpit
      ? {
          evaluatedAt: cockpit.evaluatedAt,
          signals: signalOptionsSignals,
          candidates: signalOptionsCandidates,
        }
      : null;
    const prevSnapshot = prevActivitySnapshotRef.current;
    const prevPerformance = prevActivityPerformanceRef.current;
    const summary = summarizeCockpitDelta({
      prevSnapshot,
      nextSnapshot,
      recentEvents: events,
      prevPerformance,
      nextPerformance: signalOptionsPerformanceSummary,
      nowMs: Date.now(),
    });
    setActivitySummary(summary);
    prevActivitySnapshotRef.current = nextSnapshot;
    prevActivityPerformanceRef.current = signalOptionsPerformanceSummary;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute
    // on cockpit settle / deployment switch; `events` is captured by closure
    // and never destabilises the effect (using it as a dep would re-fire on
    // every render before the events query resolves).
  }, [cockpit?.evaluatedAt, focusedDeployment?.id]);

  useEffect(() => {
    pruneAlgoKpiHistory(focusedDeployment?.id || null);
  }, [focusedDeployment?.id]);

  useEffect(() => {
    if (!focusedDeployment?.id || !cockpit?.evaluatedAt) return;
    pushAlgoKpiSample(
      focusedDeployment.id,
      buildKpiSample({
        cockpitKpis,
        cockpitSignalFreshness,
        signalOptionsPerformanceSummary,
        signalOptionsPositions,
        timestampMs: Date.now(),
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on
    // cockpit.evaluatedAt (which fires once per scan) instead of the
    // asRecord() wrappers, which mint a new reference every render.
  }, [cockpit?.evaluatedAt, focusedDeployment?.id]);

  const visibleTransitions = useMemo(
    () =>
      limitToWindow(recentTransitions, {
        windowMs: 60_000,
        nowMs: transitionsNow,
      }),
    [recentTransitions, transitionsNow],
  );

  useEffect(() => {
    if (!candidateDrafts.length) {
      setSelectedDraftId("");
      return;
    }

    if (!candidateDrafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(candidateDrafts[0].id);
    }
  }, [candidateDrafts, selectedDraftId]);

  useEffect(() => {
    if (!selectedDraft) {
      setDeploymentName("");
      setSymbolUniverseInput("");
      return;
    }

    setDeploymentName(`${selectedDraft.name} ${environment.toUpperCase()}`);
    setSymbolUniverseInput(selectedDraft.symbolUniverse.join(", "));
  }, [selectedDraft?.id, environment]);

  useEffect(() => {
    if (!deployments.length) {
      setFocusedDeploymentId((current) => (current === null ? current : null));
      return;
    }

    if (
      !focusedDeploymentId ||
      !deployments.some((deployment) => deployment.id === focusedDeploymentId)
    ) {
      setFocusedDeploymentId(deployments[0].id);
    }
  }, [deployments, focusedDeploymentId]);

  const resolvedStrategySignalSettings = useMemo(
    () =>
      resolveStrategySignalSettings(focusedDeployment, signalMonitorProfile),
    [focusedDeployment, signalMonitorProfile],
  );

  const profileDraftState = useServerSyncedDraft(signalOptionsProfile, {
    syncKeys: [focusedDeployment?.id],
    clone: cloneProfile,
  });
  const strategySettingsDraftState = useServerSyncedDraft(
    resolvedStrategySignalSettings,
    {
      syncKeys: [focusedDeployment?.id],
      clone: cloneStrategySettings,
    },
  );
  const profileDraft = profileDraftState.draft;
  const profileDirty = profileDraftState.isDirty;
  const strategySettingsDraft = strategySettingsDraftState.draft;
  const strategyDirty = strategySettingsDraftState.isDirty;
  const staActionSignalTimeframes = useMemo(
    () =>
      normalizeStrategySignalTimeframes(strategySettingsDraft?.signalTimeframe),
    [strategySettingsDraft?.signalTimeframe],
  );
  const staSignalTimeframes = useMemo(
    () =>
      normalizeAlgoAlignedMtfTimeframes(
        profileDraft?.entryGate?.mtfAlignment?.timeframes,
        staActionSignalTimeframes[0],
      ),
    [
      profileDraft?.entryGate?.mtfAlignment?.timeframes,
      staActionSignalTimeframes[0],
    ],
  );
  useEffect(() => {
    // Publish BOTH the live-draft execution TF and the live-draft MTF companion
    // set so the Algo Monitor sidebar reflects the same selection as the STA
    // table (which reads profileDraft directly). Cleared on unmount below.
    publishAlgoStaExecutionTimeframe(staActionSignalTimeframes[0] || "");
    publishAlgoStaMtfTimeframes(staSignalTimeframes);
    publishAlgoStaMtfAlignmentConfig(
      profileDraft?.entryGate?.mtfAlignment || null,
    );
  }, [
    profileDraft?.entryGate?.mtfAlignment,
    staActionSignalTimeframes,
    staSignalTimeframes,
  ]);
  useEffect(
    () => () => {
      clearAlgoStaExecutionTimeframe();
    },
    [],
  );
  // Publish the focused deployment so the global Algo Monitor sidebar can follow
  // the active tab (the sidebar may also pin its own selection). Cleared on
  // unmount so other screens fall back to the sidebar's own pick.
  useEffect(() => {
    publishAlgoDeploymentFocus(focusedDeploymentId || "");
  }, [focusedDeploymentId]);
  useEffect(() => () => clearAlgoDeploymentFocus(), []);

  useEffect(() => {
    if (!signalOptionsCandidates.length) {
      setSelectedCandidateId((current) => (current === null ? current : null));
      return;
    }
    if (
      !selectedCandidateId ||
      !signalOptionsCandidates.some(
        (candidate) => candidate.id === selectedCandidateId,
      )
    ) {
      setSelectedCandidateId(signalOptionsCandidates[0].id);
    }
  }, [selectedCandidateId, signalOptionsCandidates]);

  const setDeploymentCache = (deployment) => {
    if (!deployment?.id) return;
    queryClient.setQueryData(getListAlgoDeploymentsQueryKey(), (current) => {
      const deployments = Array.isArray(current?.deployments)
        ? current.deployments
        : null;
      if (!deployments) return current;
      return {
        ...current,
        deployments: deployments.map((item) =>
          item.id === deployment.id ? deployment : item,
        ),
      };
    });
  };

  const refreshAlgoQueries = ({
    includeDeployments = true,
    includeSignalMonitorProfile = true,
    includeSignalOptionsState = true,
    includeSignalOptionsPerformance = true,
  } = {}) => {
    if (includeDeployments) {
      queryClient.invalidateQueries({ queryKey: ["/api/algo/deployments"] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/algo/events"] });
    queryClient.invalidateQueries({ queryKey: ["/api/session"] });
    if (includeSignalMonitorProfile) {
      queryClient.invalidateQueries({
        queryKey: getGetSignalMonitorProfileQueryKey({
          environment: focusedDeployment?.mode || environment,
        }),
      });
    }
    if (focusedDeployment?.id) {
      if (includeSignalOptionsState) {
        queryClient.invalidateQueries({
          queryKey: getGetSignalOptionsAutomationStateQueryKey(
            focusedDeployment.id,
          ),
        });
      }
      queryClient.invalidateQueries({
        queryKey: getGetAlgoDeploymentCockpitQueryKey(focusedDeployment.id),
      });
      if (includeSignalOptionsPerformance) {
        queryClient.invalidateQueries({
          queryKey: getGetSignalOptionsPerformanceQueryKey(
            focusedDeployment.id,
          ),
        });
      }
    }
  };

  const updateProfileMutation = useUpdateSignalOptionsExecutionProfile({
    request: { ...ALGO_SETTINGS_SAVE_REQUEST_OPTIONS, headers: csrfHeaders },
    mutation: {
      onMutate: (variables) => {
        if (variables?.deploymentId) {
          void queryClient.cancelQueries({
            queryKey: getGetSignalOptionsAutomationStateQueryKey(
              variables.deploymentId,
            ),
          });
        }
      },
      onSuccess: (payload, variables) => {
        const deploymentId = variables?.deploymentId || focusedDeployment?.id;
        if (deploymentId && payload) {
          queryClient.setQueryData(
            getGetSignalOptionsAutomationStateQueryKey(deploymentId),
            (current) => {
              if (!current || typeof current !== "object") {
                return current;
              }
              return {
                ...current,
                ...(payload.deployment
                  ? { deployment: payload.deployment }
                  : {}),
                ...(payload.profile ? { profile: payload.profile } : {}),
              };
            },
          );
        }
        if (payload?.deployment) {
          setDeploymentCache(payload.deployment);
        }
        refreshAlgoQueries({
          includeDeployments: !payload?.deployment,
          includeSignalMonitorProfile: false,
          includeSignalOptionsState: true,
          includeSignalOptionsPerformance: false,
        });
        profileDraftState.markClean(payload?.profile || variables?.data);
        if (!variables?.silent) {
          toast.push({
            kind: "success",
            title: "Profile saved",
            body: "Signal-options automation settings were updated.",
          });
        }
      },
      onError: (error, variables) => {
        if (variables?.silent) return;
        toast.push({
          kind: "error",
          title: "Profile save failed",
          body:
            error?.message || "The signal-options profile could not be saved.",
        });
      },
    },
  });

  const updateStrategySettingsMutation =
    useUpdateAlgoDeploymentStrategySettings({
      request: { ...ALGO_SETTINGS_SAVE_REQUEST_OPTIONS, headers: csrfHeaders },
      mutation: {
        onMutate: () => {
          void queryClient.cancelQueries({
            queryKey: getGetSignalMonitorProfileQueryKey({
              environment: focusedDeployment?.mode || environment,
            }),
          });
        },
        onSuccess: (payload, variables) => {
          if (payload?.signalMonitorProfile?.environment) {
            queryClient.setQueryData(
              getGetSignalMonitorProfileQueryKey({
                environment: payload.signalMonitorProfile.environment,
              }),
              payload.signalMonitorProfile,
            );
          }
          if (payload?.deployment) {
            setDeploymentCache(payload.deployment);
          }
          refreshAlgoQueries({
            includeDeployments: !payload?.deployment,
            includeSignalMonitorProfile: !payload?.signalMonitorProfile,
            includeSignalOptionsPerformance: false,
          });
          strategySettingsDraftState.markClean(
            resolveStrategySignalSettings(
              payload?.deployment || focusedDeployment,
              payload?.signalMonitorProfile || signalMonitorProfile,
            ),
          );
          if (!variables?.silent) {
            toast.push({
              kind: "success",
              title: "Signal settings saved",
              body: "PYRUS signal timeframe and Pyrus Signals settings were updated.",
            });
          }
        },
        onError: (error, variables) => {
          if (variables?.silent) return;
          toast.push({
            kind: "error",
            title: "Signal settings failed",
            body:
              error?.message ||
              "The strategy signal settings could not be saved.",
          });
        },
      },
    });

  const createDeploymentMutation = useCreateAlgoDeployment({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        setFocusedDeploymentId(deployment.id);
        setCreateModalOpen(false);
        toast.push({
          kind: "success",
          title: "Deployment created",
          body: `${normalizeLegacyAlgoBrandText(deployment.name)} · ${deployment.providerAccountId} · ${deployment.mode.toUpperCase()}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Create failed",
          body: error?.message || "The deployment could not be created.",
        });
      },
    },
  });
  const enableDeploymentMutation = useEnableAlgoDeployment({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        toast.push({
          kind: "success",
          title: "Deployment enabled",
          body: normalizeLegacyAlgoBrandText(deployment.name),
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Enable failed",
          body: error?.message || "The deployment could not be enabled.",
        });
      },
    },
  });
  const pauseDeploymentMutation = usePauseAlgoDeployment({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        toast.push({
          kind: "success",
          title: "Deployment paused",
          body: normalizeLegacyAlgoBrandText(deployment.name),
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Pause failed",
          body: error?.message || "The deployment could not be paused.",
        });
      },
    },
  });
  const setDeploymentModeMutation = useSetAlgoDeploymentMode({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        setPendingLiveSwitch(null);
        toast.push({
          kind: "success",
          title: `Mode set to ${String(deployment.mode || "").toUpperCase()}`,
          body:
            deployment.mode === "live"
              ? `${normalizeLegacyAlgoBrandText(deployment.name)} · paused — enable to start live trading`
              : normalizeLegacyAlgoBrandText(deployment.name),
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Mode change failed",
          body: error?.message || "The deployment mode could not be changed.",
        });
      },
    },
  });

  const handleCreateDeployment = (
    kind = ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS,
    overnightFields = null,
  ) => {
    if (!marketDataConfigured) {
      toast.push({
        kind: "warn",
        title: "Market data not configured",
        body: "Market-data streaming (Massive) must be configured before creating a deployment.",
      });
      return;
    }

    if (kind === ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT) {
      // No overnight strategy exists, so reuse an existing signal-options
      // strategyId purely as the required FK; the kind is driven entirely by
      // config.overnightSpot below. Override the strategy's inherited
      // signal-options config (parameters.executionMode / source / signalOptions)
      // so the shallow {...strategy.config, ...config} merge can't misclassify
      // this as a signal-options deployment.
      const overnightStrategyId =
        selectedDraft?.id || deployments[0]?.strategyId || null;
      if (!overnightStrategyId) {
        toast.push({
          kind: "warn",
          title: "No strategy available",
          body: "An existing strategy is required to seed an overnight deployment.",
        });
        return;
      }
      const symbols = parseSymbolUniverseInput(symbolUniverseInput);
      if (!symbols.length) {
        toast.push({
          kind: "warn",
          title: "Symbols required",
          body: "Add at least one symbol for the overnight deployment.",
        });
        return;
      }
      const notional = Number(overnightFields?.defaultOrderNotional);
      if (!Number.isFinite(notional) || notional <= 0) {
        toast.push({
          kind: "warn",
          title: "Order notional required",
          body: "Set a positive order notional for the overnight deployment.",
        });
        return;
      }
      const maxNotional = Number(overnightFields?.maxOrderNotional);
      createDeploymentMutation.mutate({
        data: {
          strategyId: overnightStrategyId,
          name: deploymentName.trim() || "Overnight Shadow",
          providerAccountId: "shadow",
          mode: "shadow",
          symbolUniverse: symbols,
          config: {
            source: "overnight_spot_manual",
            parameters: { overnightSpotTrading: true },
            signalOptions: null,
            marketDataAccountId: activeAccountId || "shadow",
            executionAccountId: "shadow",
            overnightSpot: {
              enabled: true,
              executionMode: "shadow",
              tradingSession: overnightFields?.tradingSession || "overnight",
              defaultOrderNotional: notional,
              maxOrderNotional:
                Number.isFinite(maxNotional) && maxNotional > 0
                  ? maxNotional
                  : notional * 2,
              signalTimeframe: overnightFields?.signalTimeframe || "15m",
            },
          },
        },
      });
      return;
    }

    if (!selectedDraft) {
      toast.push({
        kind: "warn",
        title: "No strategy draft",
        body: "Select a strategy draft before creating a custom signal-options deployment.",
      });
      return;
    }

    createDeploymentMutation.mutate({
      data: {
        strategyId: selectedDraft.id,
        name:
          deploymentName.trim() ||
          `${selectedDraft.name} ${environment.toUpperCase()}`,
        providerAccountId: "shadow",
        mode: environment,
        symbolUniverse: parseSymbolUniverseInput(symbolUniverseInput),
        config: {
          sourceDraftId: selectedDraft.id,
          sourceRunId: selectedDraft.runId,
          sourceStudyId: selectedDraft.studyId,
          promotedAt: selectedDraft.promotedAt,
          marketDataAccountId: activeAccountId || "shadow",
          executionAccountId: "shadow",
          signalOptions: mergeSignalOptionsProfile(selectedDraft.config),
        },
      },
    });
  };

  const handleToggleDeployment = (deployment) => {
    if (deployment.enabled) {
      pauseDeploymentMutation.mutate({ deploymentId: deployment.id });
      return;
    }

    enableDeploymentMutation.mutate({ deploymentId: deployment.id });
  };

  // Shadow/live mode toggle. Switching to live is real-money intent, so it goes
  // through a confirmation; switching back to shadow is safe and applies directly.
  const handleToggleDeploymentMode = (deployment) => {
    if (!deployment) return;
    const targetMode = deployment.mode === "live" ? "shadow" : "live";
    if (targetMode === "live") {
      setPendingLiveSwitch({
        deploymentId: deployment.id,
        name: normalizeLegacyAlgoBrandText(deployment.name),
        wasEnabled: Boolean(deployment.enabled),
      });
      return;
    }
    setDeploymentModeMutation.mutate({
      deploymentId: deployment.id,
      data: { mode: "shadow" },
    });
  };

  const confirmLiveSwitch = () => {
    if (!pendingLiveSwitch) return;
    setDeploymentModeMutation.mutate({
      deploymentId: pendingLiveSwitch.deploymentId,
      data: { mode: "live" },
    });
  };

  const handleRefreshSignals = () => {
    if (!onScanNow) {
      toast.push({
        kind: "warn",
        title: "Signal scan unavailable",
        body: "Signal scanning is not available from this surface yet.",
      });
      return;
    }
    onScanNow();
  };

  const patchProfileDraftPath = (path, value) => {
    profileDraftState.patch(path, value);
  };

  const patchStrategySettingsPath = (path, value) => {
    strategySettingsDraftState.patch(path, value);
  };

  const handleDiscardAllAdjustments = () => {
    profileDraftState.reset();
    strategySettingsDraftState.reset();
  };

  const handleSaveAllAdjustments = async () => {
    if (saveAllInFlightRef.current) {
      return;
    }
    const deploymentId = focusedDeployment?.id;
    // Only fire the signal-options Profile PATCH for deployments that ACTUALLY
    // have a signal-options profile. Overnight/spot deployments still render an
    // (editable, default-seeded) Profile section, but the backend rejects that
    // PATCH with 400 "not a signal-options deployment". The same gate drives the
    // post-save reconciliation so a skipped Profile leg is never marked clean or
    // reported as saved (which silently dropped the edits while claiming success).
    const shouldSaveProfile =
      profileDirty && deploymentSignalOptionsBaselineAvailable;
    saveAllInFlightRef.current = true;
    setSaveAllPending(true);
    const releaseConnectionPause = beginCriticalApiMutationPause({
      ttlMs: ALGO_SETTINGS_SAVE_PAUSE_TTL_MS,
    });
    try {
      void queryClient.cancelQueries({
        queryKey: getListSignalMonitorEventsQueryKey(),
      });
      void queryClient.cancelQueries({
        queryKey: getListAlgoDeploymentsQueryKey(),
      });
      void queryClient.cancelQueries({
        queryKey: getListExecutionEventsQueryKey(),
      });
      void queryClient.cancelQueries({
        queryKey: getGetAccountPositionsQueryKey("shadow"),
      });
      if (deploymentId) {
        void queryClient.cancelQueries({
          queryKey: getGetSignalOptionsAutomationStateQueryKey(deploymentId),
        });
        void queryClient.cancelQueries({
          queryKey: getGetAlgoDeploymentCockpitQueryKey(deploymentId),
        });
        void queryClient.cancelQueries({
          queryKey: getGetSignalOptionsPerformanceQueryKey(deploymentId),
        });
      }
      await waitForCriticalApiMutationPauseSettle(
        ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS,
      );
      const result = await saveAllAlgoAdjustments({
        deploymentId,
        profileDraft,
        strategySettingsDraft,
        profileDirty: shouldSaveProfile,
        strategyDirty,
        updateProfileMutation,
        updateStrategySettingsMutation,
        onPartialFailure: ({ failures }) => {
          toast.push({
            kind: "error",
            title: "Save partially failed",
            body: failures
              .map(
                (failure) =>
                  `${failure.section}: ${
                    failure.error?.message || "save failed"
                  }`,
              )
              .join(" · "),
          });
        },
      });

      if (result.ok) {
        const reconciliation = planAlgoAdjustmentsSaveReconciliation({
          profileDirty,
          strategyDirty,
          profileSaved: shouldSaveProfile,
        });
        if (reconciliation.markProfileClean) {
          profileDraftState.markClean(
            result.profileResult?.profile || profileDraft,
          );
        }
        if (reconciliation.markStrategyClean) {
          strategySettingsDraftState.markClean(
            resolveStrategySignalSettings(
              result.strategyResult?.deployment || focusedDeployment,
              result.strategyResult?.signalMonitorProfile ||
                signalMonitorProfile,
            ),
          );
        }
        if (reconciliation.savedSections.length) {
          toast.push({
            kind: "success",
            title: "Algo settings saved",
            body: `${reconciliation.savedSections.join(" and ")} adjustments were updated.`,
          });
        } else if (reconciliation.profileSkipped) {
          toast.push({
            kind: "info",
            title: "Profile changes not saved",
            body: "This deployment has no signal-options profile, so those profile adjustments were not applied.",
          });
        }
      }
    } catch (error) {
      toast.push({
        kind: "error",
        title: "Save failed",
        body: error?.message || "Algo settings could not be saved.",
      });
    } finally {
      releaseConnectionPause();
      saveAllInFlightRef.current = false;
      setSaveAllPending(false);
    }
  };

  const handleOpenCandidateInTrade = (candidate) => {
    if (!candidate || !onJumpToTradeCandidate) {
      return;
    }
    onJumpToTradeCandidate({
      ...candidate,
      deploymentId: focusedDeployment?.id || candidate.deploymentId || null,
      deploymentName:
        normalizeLegacyAlgoBrandText(
          focusedDeployment?.name || candidate.deploymentName || "",
        ) || null,
    });
  };

  const profileNumberFields = PROFILE_NUMBER_FIELDS;
  const profileBooleanFields = PROFILE_BOOLEAN_FIELDS;

  const visibleSignalRows = useMemo(
    () =>
      buildVisibleSignalRows({
        signalMatrixStates,
        signalTimeframes: staSignalTimeframes,
        signalActionTimeframes: staActionSignalTimeframes,
        universeSymbols: staSignalUniverseSymbols,
      }),
    [
      signalMatrixStates,
      staActionSignalTimeframes,
      staSignalTimeframes,
      staSignalUniverseSymbols,
    ],
  );
  const signalTableScanFallback = useMemo(() => {
    const pollIntervalSeconds = Number(
      signalMonitorProfile?.pollIntervalSeconds,
    );
    return {
      lastSignalScanAt: latestIsoFromRows(visibleSignalRows, [
        "lastEvaluatedAt",
        "updatedAt",
      ]),
      latestSignalBarAt: latestIsoFromRows(visibleSignalRows, ["latestBarAt"]),
      latestSignalAt: latestIsoFromRows(visibleSignalRows, [
        "currentSignalAt",
        "signalAt",
      ]),
      pollIntervalMs:
        Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0
          ? pollIntervalSeconds * 1000
          : null,
    };
  }, [signalMonitorProfile, visibleSignalRows]);
  const signalMatrixFreshnessDetail = signalTableScanFallback.lastSignalScanAt
    ? "signal matrix current"
    : signalMatrixFeedSettled
      ? "waiting for live signal matrix data"
      : "connecting to Signal Matrix";
  const cockpitStageItems = useMemo(() => {
    const fallbackStages = [
      {
        id: "scan_universe",
        label: "Signal Symbols",
        status: signalTableScanFallback.lastSignalScanAt
          ? "healthy"
          : "waiting",
        count: visibleSignalRows.length || staSignalUniverseSymbols.length || 0,
        latestAt:
          signalTableScanFallback.lastSignalScanAt ||
          focusedDeployment?.lastEvaluatedAt ||
          null,
        lastSignalScanAt: signalTableScanFallback.lastSignalScanAt,
        latestSignalBarAt: signalTableScanFallback.latestSignalBarAt,
        latestSignalAt: signalTableScanFallback.latestSignalAt,
        pollIntervalMs: signalTableScanFallback.pollIntervalMs,
        signalSourcePolicy: signalOptionsState?.signalSourcePolicy || null,
        detail: signalMatrixFreshnessDetail,
      },
    ];
    return mergeStaSignalPipelineStages({
      stages: cockpitPipelineStages.length
        ? cockpitPipelineStages
        : fallbackStages,
      signalRows: visibleSignalRows,
      deploymentSymbolUniverse: staSignalUniverseSymbols,
      candidates: signalOptionsCandidates,
      scanFallback: signalTableScanFallback,
      signalMatrixFreshnessDetail,
      signalSourcePolicy: signalOptionsState?.signalSourcePolicy || null,
    });
  }, [
    cockpitPipelineStages,
    focusedDeployment?.lastEvaluatedAt,
    signalMatrixFreshnessDetail,
    signalOptionsCandidates,
    signalOptionsState?.signalSourcePolicy,
    staSignalUniverseSymbols,
    signalTableScanFallback,
    visibleSignalRows,
  ]);
  const algoExecutionScanRunning = cockpitStageItems.some((stage) => {
    const record = asRecord(stage);
    return (
      String(record.id || "") === "scan_universe" &&
      isAlgoExecutionScanStageRunning(record)
    );
  });
  const selectedStage =
    cockpitStageItems.find((stage) => stage.id === selectedPipelineStageId) ||
    cockpitStageItems[0] ||
    null;
  return (
    <div
      ref={algoRootRef}
      data-testid="algo-screen"
      data-layout={algoIsPhone ? "phone" : algoIsNarrow ? "tablet" : "desktop"}
      style={{
        background: CSS_COLOR.bg0,
        height: "100%",
        width: "100%",
        overflowY: "auto",
        minWidth: 0,
        WebkitOverflowScrolling: algoIsPhone ? "touch" : undefined,
      }}
    >
      <div
        style={{
          width: "100%",
          padding: sp(algoIsPhone ? "6px 6px 14px" : "16px 24px 20px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(algoIsPhone ? 5 : 10),
          minWidth: 0,
        }}
      >
        <div
          data-testid="algo-live-content"
          className="ra-panel-enter"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(10),
            minWidth: 0,
          }}
        >
          <Suspense fallback={<AlgoLivePageLoadingStatus />}>
            <LazyAlgoLivePage
            deployments={deployments}
            pnlByDeploymentId={deploymentPnlById}
            candidateDrafts={candidateDrafts}
            setupDataSettled={algoSetupDataSettled}
            deploymentListUnavailable={deploymentListUnavailable}
            selectedDraft={selectedDraft}
            setSelectedDraftId={setSelectedDraftId}
            deploymentName={deploymentName}
            setDeploymentName={setDeploymentName}
            symbolUniverseInput={symbolUniverseInput}
            setSymbolUniverseInput={setSymbolUniverseInput}
            handleCreateDeployment={handleCreateDeployment}
            createDeploymentMutation={createDeploymentMutation}
            cockpitKpis={cockpitKpis}
            cockpitRisk={cockpitRisk}
            cockpitGeneratedAt={cockpit?.generatedAt}
            cockpitPnlDataAvailable={cockpitPnlDataAvailable}
            cockpitRiskDataAvailable={cockpitRiskDataAvailable}
            cockpitPositionDataAvailable={cockpitPositionDataAvailable}
            performanceDataAvailable={performanceDataAvailable}
            positionDataAvailable={positionDataAvailable}
            refreshPending={
              deploymentsQuery.isFetching || cockpitQuery.isFetching
            }
            cockpitSignalFreshness={cockpitSignalFreshness}
            cockpitTradePath={cockpitTradePath}
            signalOptionsPerformanceSummary={signalOptionsPerformanceSummary}
            cockpitStageItems={cockpitStageItems}
            selectedStage={selectedStage}
            setSelectedPipelineStageId={setSelectedPipelineStageId}
            cockpitAttentionItems={cockpitAttentionItems}
            signalOptionsRuleAdherence={signalOptionsRuleAdherence}
            marketDataReady={marketDataReady}
            signalScanReady={signalScanReady}
            signalScanBlockedReason={null}
            transitions={visibleTransitions}
            visibleSignalRows={visibleSignalRows}
            signalOptionsCandidates={signalOptionsCandidates}
            signalMatrixStates={signalMatrixStates}
            selectedCandidate={selectedCandidate}
            signalOptionsProfile={signalOptionsProfile}
            mtfAlignmentDraft={profileDraft?.entryGate?.mtfAlignment}
            staSignalTimeframes={staSignalTimeframes}
            onOpenCandidateInTrade={handleOpenCandidateInTrade}
            safeQaMode={safeQaMode}
            signalOptionsPositions={signalOptionsPositions}
            signalOptionsLedgerPositionsQuery={
              signalOptionsLedgerPositionsQueryForDisplay
            }
            positionAccountTabId={algoAccountTab}
            positionAccounts={positionAccounts}
            onSelectPositionAccountTab={setAlgoAccountTab}
            positionAccountUsesShadowOverlay={algoPositionsUseShadowOverlay}
            symbolIndex={symbolIndex}
            events={events}
            userPreferences={userPreferences}
            strategySettingsDraft={strategySettingsDraft}
            activitySummary={activitySummary}
            focusedDeployment={focusedDeployment}
            onSelectDeployment={setFocusedDeploymentId}
            onAddDeployment={() => setCreateModalOpen(true)}
            onToggleDeploymentMode={handleToggleDeploymentMode}
            modeChangePending={setDeploymentModeMutation.isPending}
            accountId={activeAccountId}
            environment={environment}
            handleToggleDeployment={handleToggleDeployment}
            handleRefreshSignals={handleRefreshSignals}
            enableDeploymentMutation={enableDeploymentMutation}
            pauseDeploymentMutation={pauseDeploymentMutation}
            algoExecutionScanRunning={algoExecutionScanRunning}
            algoIsPhone={algoIsPhone}
            algoIsNarrow={algoIsNarrow}
            algoLayoutWidth={algoRootSize.width}
            rightRail={
              <AlgoRightRail
                cockpit={cockpit}
                signalOptionsPositions={signalOptionsPositions}
                signalOptionsProfile={signalOptionsProfile}
                profileDraft={profileDraft}
                profileBaseline={profileDraftState.baseline}
                profileDirty={profileDirty}
                patchProfileDraftPath={patchProfileDraftPath}
                strategySettingsDraft={strategySettingsDraft}
                strategyBaseline={strategySettingsDraftState.baseline}
                strategyDirty={strategyDirty}
                patchStrategySettingsPath={patchStrategySettingsPath}
                focusedDeployment={focusedDeployment}
                controlBaselineReady={controlBaselineReady}
                saveAllPending={saveAllPending}
                handleSaveAllAdjustments={handleSaveAllAdjustments}
                handleDiscardAllAdjustments={handleDiscardAllAdjustments}
                updateProfileMutation={updateProfileMutation}
                updateStrategySettingsMutation={updateStrategySettingsMutation}
                cockpitSkipCategoryRows={cockpitSkipCategoryRows}
                cockpitSkipReasonRows={cockpitSkipReasonRows}
                cockpitReadinessRows={cockpitReadinessRows}
                cockpitMarkHealthRows={cockpitMarkHealthRows}
                cockpitLifecycleRows={cockpitLifecycleRows}
                cockpitEntryGateRows={cockpitEntryGateRows}
                cockpitOptionChainRows={cockpitOptionChainRows}
                cockpitSignalFreshness={cockpitSignalFreshness}
                cockpitTradePath={cockpitTradePath}
                diagExpansion={diagExpansion}
                setDiagExpansion={setDiagExpansion}
                algoIsPhone={algoIsPhone}
                algoIsNarrow={algoIsNarrow}
              />
            }
            />
          </Suspense>
          <CreateDeploymentModal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            candidateDrafts={candidateDrafts}
            selectedDraft={selectedDraft}
            setSelectedDraftId={setSelectedDraftId}
            deploymentName={deploymentName}
            setDeploymentName={setDeploymentName}
            symbolUniverseInput={symbolUniverseInput}
            setSymbolUniverseInput={setSymbolUniverseInput}
            createPending={createDeploymentMutation.isPending}
            onCreate={handleCreateDeployment}
          />
          <ConfirmDialog
            open={Boolean(pendingLiveSwitch)}
            eyebrow="Switch to live"
            title="Run this algo with real money?"
            detail={
              pendingLiveSwitch
                ? `${pendingLiveSwitch.name} will switch from shadow to LIVE. It will be paused on switch — you must enable it to start placing real orders.`
                : ""
            }
            confirmLabel="Switch to live"
            destructive
            pending={setDeploymentModeMutation.isPending}
            onConfirm={confirmLiveSwitch}
            onCancel={() => setPendingLiveSwitch(null)}
            dialogTestId="algo-live-switch-confirm"
          />
        </div>
      </div>
    </div>
  );
};

export default AlgoScreen;
