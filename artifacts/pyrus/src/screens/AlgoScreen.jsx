import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getGetAlgoDeploymentCockpitQueryKey,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalOptionsAutomationStateQueryKey,
  getGetSignalOptionsPerformanceQueryKey,
  getListAlgoDeploymentsQueryKey,
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
  useUpdateAlgoDeploymentStrategySettings,
  useUpdateSignalOptionsExecutionProfile,
} from "@workspace/api-client-react";
import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PROFILE_BOOLEAN_FIELDS,
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  SIGNAL_OPTIONS_EXPANDED_CAPACITY,
  SIGNAL_OPTIONS_LIQUIDITY_REASON_LABELS,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
  STRATEGY_SIGNAL_TIMEFRAMES,
  asRecord,
  boundedNumberFrom,
  buildVisibleSignalRows,
  buildExpandedSignalOptionsProfile,
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
  formatMoney,
  formatPct,
  formatPlainPrice,
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
import {
  AlgoLivePage,
  preloadAlgoLivePageModules,
} from "./algo/AlgoLivePage";
import { AlgoRightRail } from "./algo/AlgoRightRail.jsx";
import { normalizeLegacyAlgoBrandText } from "./algo/algoBranding.js";
import { useServerSyncedDraft } from "./algo/useServerSyncedDraft";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  useAlgoCockpitStream,
  useShadowAccountSnapshotStream,
} from "../features/platform/live-streams";
import {
  bridgeRuntimeTone,
  hasGatewayLiveDataProof,
} from "../features/platform/bridgeRuntimeModel";
import {
  clearAlgoStaExecutionTimeframe,
  publishAlgoStaExecutionTimeframe,
  publishAlgoStaMtfTimeframes,
} from "../features/platform/algoStaExecutionTimeframeStore.js";
import { QUERY_DEFAULTS } from "../features/platform/queryDefaults";
import { useToast } from "../features/platform/platformContexts.jsx";
import {
  formatEnumLabel,
  formatOptionContractLabel,
  formatRelativeTimeShort,
  parseSymbolUniverseInput,
} from "../lib/formatters";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import { formatAppTimeForPreferences } from "../lib/timeZone";
import {
  CSS_COLOR,
  MISSING_VALUE,
  sp,
} from "../lib/uiTokens.jsx";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import { retryDynamicImport } from "../lib/dynamicImport";

export const preloadScreenModules = () => preloadAlgoLivePageModules();

const ALGO_PRIMARY_FALLBACK_DELAY_MS = 0;
const EMPTY_ALGO_DEPLOYMENTS = Object.freeze([]);
const EMPTY_ALGO_DRAFTS = Object.freeze([]);
const EMPTY_ALGO_EVENTS = Object.freeze([]);
const EMPTY_SIGNAL_OPTIONS_CANDIDATES = Object.freeze([]);
const EMPTY_SIGNAL_OPTIONS_SIGNALS = Object.freeze([]);
const EMPTY_SIGNAL_OPTIONS_POSITIONS = Object.freeze([]);
const retainPreviousData = (previousData) => previousData;

const sourceArrayTimestampMs = (item) => {
  const record = asRecord(item);
  return Math.max(
    Date.parse(record.updatedAt || "") || 0,
    Date.parse(record.createdAt || "") || 0,
    Date.parse(record.signalAt || "") || 0,
    Date.parse(record.currentSignalAt || "") || 0,
    Date.parse(record.lastEvaluatedAt || "") || 0,
    Date.parse(record.latestBarAt || "") || 0,
  );
};

const sourceArrayLatestTimestampMs = (items) =>
  (Array.isArray(items) ? items : []).reduce(
    (latest, item) => Math.max(latest, sourceArrayTimestampMs(item)),
    0,
  );

const latestIsoFromRows = (items, fields) => {
  const latestMs = (Array.isArray(items) ? items : []).reduce((latest, item) => {
    const record = asRecord(item);
    return Math.max(
      latest,
      ...fields.map((field) => Date.parse(record[field] || "") || 0),
    );
  }, 0);
  return latestMs ? new Date(latestMs).toISOString() : null;
};

const preferNonEmptySourceArray = (primary, fallback, emptyValue) => {
  const primaryArray = Array.isArray(primary) ? primary : null;
  const fallbackArray = Array.isArray(fallback) ? fallback : null;
  if (primaryArray?.length && fallbackArray?.length) {
    const primaryLatestMs = sourceArrayLatestTimestampMs(primaryArray);
    const fallbackLatestMs = sourceArrayLatestTimestampMs(fallbackArray);
    if (fallbackLatestMs > primaryLatestMs) return fallbackArray;
    if (
      fallbackLatestMs === primaryLatestMs &&
      fallbackArray.length > primaryArray.length
    ) {
      return fallbackArray;
    }
    return primaryArray;
  }
  if (primaryArray?.length) return primaryArray;
  if (fallbackArray?.length) return fallbackArray;
  return primaryArray || fallbackArray || emptyValue;
};

const isAlgoExecutionScanStageRunning = (stage) => {
  const record = asRecord(stage);
  const scanAgeMs = Number(record.scanAgeMs);
  return (
    String(record.status || "").toLowerCase() === "running" ||
    record.running === true ||
    Boolean(record.scanStartedAt && Number.isFinite(scanAgeMs) && scanAgeMs >= 0)
  );
};

const signalOptionsRuleColor = (status) => {
  if (status === "fail") return CSS_COLOR.red;
  if (status === "warning") return CSS_COLOR.amber;
  return CSS_COLOR.green;
};

const formatCockpitMetric = (metrics, key, formatter = (value) => value) =>
  Object.prototype.hasOwnProperty.call(asRecord(metrics), key)
    ? formatter(asRecord(metrics)[key])
    : MISSING_VALUE;

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
          import("./algoCockpitDiagnosticsModel"),
        ]),
      { label: "AlgoRuntimeHelpers", reloadOnFailure: false },
    )
      .then(([transitions, activity, kpi, diagnostics]) => ({
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
          transitions.limitToWindow || DEFAULT_ALGO_RUNTIME_HELPERS.limitToWindow,
        summarizeCockpitDelta:
          activity.summarizeCockpitDelta ||
          DEFAULT_ALGO_RUNTIME_HELPERS.summarizeCockpitDelta,
        buildKpiSample:
          kpi.buildKpiSample || DEFAULT_ALGO_RUNTIME_HELPERS.buildKpiSample,
        pruneAlgoKpiHistory:
          kpi.pruneAlgoKpiHistory ||
          DEFAULT_ALGO_RUNTIME_HELPERS.pruneAlgoKpiHistory,
        pushAlgoKpiSample:
          kpi.pushAlgoKpiSample || DEFAULT_ALGO_RUNTIME_HELPERS.pushAlgoKpiSample,
        buildCockpitGateSummary:
          diagnostics.buildCockpitGateSummary ||
          DEFAULT_ALGO_RUNTIME_HELPERS.buildCockpitGateSummary,
      }))
      .catch((error) => {
        algoRuntimeHelpersImport = null;
        throw error;
      });
  }
  return algoRuntimeHelpersImport;
};


const isGatewayReadyForAlgo = (session) => {
  const bridge = asRecord(session?.ibkrBridge);
  return Boolean(
    session?.configured?.ibkr &&
      bridge.connected &&
      bridge.authenticated &&
      bridge.accountsLoaded &&
      bridge.configuredLiveMarketDataMode &&
      (bridge.healthFresh || hasGatewayLiveDataProof(bridge)),
  );
};

export const AlgoScreen = ({
  session,
  environment,
  accounts = [],
  selectedAccountId = null,
  signalMonitorEventsSourceStatus = "database",
  signalMonitorEventsLoaded = false,
  signalMonitorState = null,
  signalMatrixStates = [],
  isVisible = false,
  safeQaMode = false,
  onScanNow,
  onJumpToTradeCandidate,
  onReadinessChange,
}) => {
  const [algoRootRef, algoRootSize] = useElementSize();
  const { isPhone: algoIsPhone, isNarrow: algoIsNarrow } =
    responsiveFlags(algoRootSize.width);
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
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [symbolUniverseInput, setSymbolUniverseInput] = useState("");
  const [focusedDeploymentId, setFocusedDeploymentId] = useState(null);
  const [diagExpansion, setDiagExpansion] = useState({});
  const [selectedPipelineStageId, setSelectedPipelineStageId] = useState("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const saveAllInFlightRef = useRef(false);
  const [saveAllPending, setSaveAllPending] = useState(false);
  const [algoRuntimeHelpers, setAlgoRuntimeHelpers] = useState(
    DEFAULT_ALGO_RUNTIME_HELPERS,
  );
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const gatewayReady = isGatewayReadyForAlgo(session);
  const bridgeTone = bridgeRuntimeTone(session);
  const activeAccount =
    accounts.find((account) => account.id === selectedAccountId) ||
    accounts[0] ||
    null;
  const activeAccountId =
    activeAccount?.id ||
    selectedAccountId ||
    session?.ibkrBridge?.selectedAccountId ||
    null;
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
  const algoLiveDataQueriesEnabled = Boolean(isVisible);
  const algoCockpitStreamFreshness = useAlgoCockpitStream({
    deploymentId: focusedDeploymentId,
    mode: environment || "shadow",
    enabled: algoLiveDataQueriesEnabled,
  });
  const shadowAccountStreamFreshness = useShadowAccountSnapshotStream({
    enabled: algoLiveDataQueriesEnabled,
  });
  const [algoPrimaryFallbackReady, setAlgoPrimaryFallbackReady] = useState(false);
  const algoTimingStagesRef = useRef(new Set());
  useEffect(() => {
    if (!isVisible) {
      algoTimingStagesRef.current = new Set();
    }
  }, [isVisible]);
  useEffect(() => {
    if (!isVisible || algoCockpitStreamFreshness.algoPrimaryFresh) {
      setAlgoPrimaryFallbackReady(false);
      return undefined;
    }
    if (ALGO_PRIMARY_FALLBACK_DELAY_MS <= 0) {
      setAlgoPrimaryFallbackReady(true);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setAlgoPrimaryFallbackReady(true);
    }, ALGO_PRIMARY_FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [algoCockpitStreamFreshness.algoPrimaryFresh, isVisible]);
  const algoPrimaryDataReady = Boolean(
    isVisible &&
      (algoCockpitStreamFreshness.algoPrimaryFresh ||
        algoPrimaryFallbackReady),
  );
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
    if (!algoPrimaryDataReady) {
      return;
    }
    markAlgoTiming("primary-data-ready", {
      source: algoCockpitStreamFreshness.algoPrimaryFresh
        ? "stream"
        : "rest-catchup",
    });
  }, [
    algoCockpitStreamFreshness.algoPrimaryFresh,
    algoPrimaryDataReady,
    markAlgoTiming,
  ]);
  const algoSetupQueriesEnabled = Boolean(isVisible);
  const algoPrimaryQueriesEnabled = Boolean(algoLiveDataQueriesEnabled);
  const algoDerivedRestQueriesEnabled = Boolean(
    algoLiveDataQueriesEnabled,
  );
  const algoBackgroundQueriesEnabled = Boolean(
    algoDerivedRestQueriesEnabled && !safeQaMode,
  );
  const algoPostPrimaryQueriesEnabled = Boolean(
    algoLiveDataQueriesEnabled &&
      !shadowAccountStreamFreshness.accountFresh,
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
    algoPostPrimaryQueriesEnabled && !shadowAccountStreamFreshness.accountFresh
      ? 60_000
      : false;
  useRuntimeWorkloadFlag("algo:cockpit", isVisible, {
    kind: algoCockpitStreamFreshness.algoPrimaryFresh ? "stream" : "poll",
    label: "Algo cockpit",
    detail: algoCockpitStreamFreshness.algoPrimaryFresh ? "SSE" : "REST catch-up",
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
  const deploymentsQuery = useListAlgoDeployments(
    undefined,
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: algoSetupQueriesEnabled,
        refetchInterval: algoRoutineRefetchInterval,
        retry: false,
      },
    },
  );
  const deployments = deploymentsQuery.data?.deployments || EMPTY_ALGO_DEPLOYMENTS;
  const deploymentListEmptyUnavailable = Boolean(
    deploymentsQuery.data?.cacheStatus === "unavailable" && !deployments.length,
  );
  const deploymentListUnavailable = Boolean(
    deploymentListEmptyUnavailable && !deploymentsQuery.isFetching,
  );
  const candidateDrafts = useMemo(() => {
    const drafts = draftsQuery.data?.drafts || EMPTY_ALGO_DRAFTS;
    const matchingMode = drafts.filter((draft) => draft.mode === environment);
    return matchingMode.length ? matchingMode : drafts;
  }, [draftsQuery.data, environment]);
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
  const events = eventsQuery.data?.events || EMPTY_ALGO_EVENTS;
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
  const cockpitQuery = useGetAlgoDeploymentCockpit(focusedDeployment?.id || "", {
    query: {
      ...QUERY_DEFAULTS,
      enabled: Boolean(algoDerivedRestQueriesEnabled && focusedDeployment?.id),
      refetchInterval: algoDerivedRefetchInterval,
      retry: false,
    },
  });
  const signalOptionsPerformanceQuery = useGetSignalOptionsPerformance(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(
          algoBackgroundQueriesEnabled && focusedDeployment?.id,
        ),
        refetchInterval: algoDerivedRefetchInterval,
        retry: false,
      },
    },
  );
  const signalOptionsLedgerPositionsQuery = useGetAccountPositions(
    "shadow",
    {
      mode: "shadow",
      assetClass: "all",
      source: "automation",
      liveQuotes: false,
    },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: algoPostPrimaryQueriesEnabled,
        staleTime: shadowAccountStreamFreshness.accountFresh
          ? 30_000
          : QUERY_DEFAULTS.staleTime,
        refetchInterval: signalOptionsLedgerPositionsRefetchInterval,
        placeholderData: retainPreviousData,
        retry: false,
      },
    },
  );
  const deploymentsSettled = Boolean(
    deploymentListUnavailable ||
      (!deploymentListEmptyUnavailable &&
        (deploymentsQuery.data || deploymentsQuery.isFetched)) ||
      deploymentsQuery.isError,
  );
  const draftsSettled = Boolean(
    draftsQuery.data || draftsQuery.isFetched || draftsQuery.isError,
  );
  const signalOptionsStateSettled = Boolean(
    (!signalOptionsStateQuery.isPlaceholderData &&
      (signalOptionsStateQuery.data || signalOptionsStateQuery.isFetched)) ||
      signalOptionsStateQuery.isError,
  );
  const cockpitSettled = Boolean(
    (!cockpitQuery.isPlaceholderData &&
      (cockpitQuery.data || cockpitQuery.isFetched)) ||
      cockpitQuery.isError,
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
  }, [
    algoDerivedReady,
    algoPrimaryDataReady,
    isVisible,
    onReadinessChange,
    safeQaMode,
  ]);
  useEffect(() => {
    if (!isVisible || !algoDerivedReady) {
      return;
    }
    markAlgoTiming("derived-data-ready", {
      source: algoCockpitStreamFreshness.algoFullFresh ? "stream" : "rest-catchup",
    });
  }, [
    algoCockpitStreamFreshness.algoFullFresh,
    algoDerivedReady,
    isVisible,
    markAlgoTiming,
  ]);
  const cockpit = cockpitQuery.data || null;
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
  const signalOptionsPerformance = signalOptionsPerformanceQuery.data || null;
  const signalOptionsState = signalOptionsStateQuery.data || null;
  const signalMonitorProfile = signalMonitorState?.profile || null;
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
  const signalOptionsSourceHealth = staActionSnapshot.sourceHealth || null;
  const cockpitFleet = cockpit?.fleet || null;
  const cockpitReadiness = cockpit?.readiness || null;
  const cockpitKpis = asRecord(cockpit?.kpis);
  const cockpitPipelineStages = cockpit?.pipelineStages || [];
  const cockpitAttentionItems = cockpit?.attentionItems || [];
  const cockpitSourceBacktest = cockpit?.sourceBacktest || null;
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
  const signalOptionsOpenExposure = asRecord(
    signalOptionsPerformance?.openExposure,
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
      const actionStatus = String(candidate.actionStatus || candidate.status || "");
      const hasContract = Object.keys(asRecord(candidate.selectedContract)).length > 0;
      const timeline = Array.isArray(candidate.timeline) ? candidate.timeline : [];
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
  const enabledDeployments = deployments.filter(
    (deployment) => deployment.enabled,
  );
  const latestEvent = events[0] || null;

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
  }, [
    cockpit?.evaluatedAt,
    focusedDeployment?.id,
  ]);

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
    () => resolveStrategySignalSettings(focusedDeployment, signalMonitorProfile),
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
  const setProfileDraft = profileDraftState.replace;
  const profileDirty = profileDraftState.isDirty;
  const strategySettingsDraft = strategySettingsDraftState.draft;
  const strategyDirty = strategySettingsDraftState.isDirty;
  const staActionSignalTimeframes = useMemo(
    () => normalizeStrategySignalTimeframes(strategySettingsDraft?.signalTimeframe),
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
  }, [staActionSignalTimeframes, staSignalTimeframes]);
  useEffect(
    () => () => {
      clearAlgoStaExecutionTimeframe();
    },
    [],
  );

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
      queryClient.invalidateQueries({
        queryKey: getGetSignalOptionsPerformanceQueryKey(focusedDeployment.id),
      });
    }
  };

  const updateProfileMutation = useUpdateSignalOptionsExecutionProfile({
    mutation: {
      onMutate: async (variables) => {
        if (variables?.deploymentId) {
          await queryClient.cancelQueries({
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
          body: error?.message || "The signal-options profile could not be saved.",
        });
      },
    },
  });

  const updateStrategySettingsMutation = useUpdateAlgoDeploymentStrategySettings({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({
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
          body: error?.message || "The strategy signal settings could not be saved.",
        });
      },
    },
  });

  const createDeploymentMutation = useCreateAlgoDeployment({
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        setFocusedDeploymentId(deployment.id);
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

  const handleCreateDeployment = () => {
    if (!selectedDraft) {
      toast.push({
        kind: "warn",
        title: "No strategy draft",
        body: "Select a strategy draft before creating a custom signal-options deployment.",
      });
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR data not configured",
        body: "Market-data connectivity must be configured before creating a signal-options shadow deployment.",
      });
      return;
    }

    if (!activeAccountId) {
      toast.push({
        kind: "warn",
        title: "No data account selected",
        body: "The bridge is authenticated, but no IBKR data account is active yet.",
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
          marketDataAccountId: activeAccountId,
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

  const handleApplyExpandedCapacity = () => {
    if (!focusedDeployment?.id) {
      return;
    }
    const nextProfile = buildExpandedSignalOptionsProfile(profileDraft);
    setProfileDraft(nextProfile);
  };

  const handleDiscardAllAdjustments = () => {
    profileDraftState.reset();
    strategySettingsDraftState.reset();
  };

  const handleSaveAllAdjustments = async () => {
    if (saveAllInFlightRef.current) {
      return;
    }
    saveAllInFlightRef.current = true;
    setSaveAllPending(true);
    try {
      const { saveAllAlgoAdjustments } = await retryDynamicImport(
        () => import("./algo/saveAllAlgoAdjustments"),
        { label: "SaveAllAlgoAdjustments", reloadOnFailure: false },
      );
      const result = await saveAllAlgoAdjustments({
        deploymentId: focusedDeployment?.id,
        profileDraft,
        strategySettingsDraft,
        profileDirty,
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
        toast.push({
          kind: "success",
          title: "Algo settings saved",
          body: "Signal and profile adjustments were updated.",
        });
      }
    } finally {
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

  const cockpitMetricCards = [
    {
      label: "Drafts",
      value: `${draftsQuery.data?.drafts?.length || 0}`,
      detail: selectedDraft
        ? `${selectedDraft.name} · ${selectedDraft.mode}`
        : "awaiting promotion",
      color: CSS_COLOR.accent,
    },
    {
      label: "Deployments",
      value: `${cockpitFleet?.totalDeployments ?? deployments.length}`,
      detail: deployments.length
        ? `${cockpitFleet?.enabledDeployments ?? enabledDeployments.length} enabled · ${cockpitTradePath.blockedCandidates ?? 0} blocked`
        : "none created",
      color:
        Number(cockpitTradePath.blockedCandidates) > 0
          ? CSS_COLOR.red
          : deployments.length
            ? CSS_COLOR.green
            : CSS_COLOR.textDim,
    },
    {
      label: "Data Bridge",
      value: cockpitReadiness?.ready ? "READY" : bridgeTone.label.toUpperCase(),
      detail:
        cockpitReadiness?.message ||
        (session?.ibkrBridge?.transport === "tws"
          ? `IB Gateway ${session?.ibkrBridge?.sessionMode || ""} · ${activeAccountId || "no account"}`
          : `${session?.ibkrBridge?.transport || "bridge"} · ${activeAccountId || "no account"}`),
      color: cockpitReadiness?.ready ? CSS_COLOR.green : bridgeTone.color,
    },
    {
      label: "Today P&L",
      value: formatMoney(cockpitKpis.todayPnl, 2),
      detail: `R ${formatMoney(cockpitKpis.dailyRealizedPnl, 2)} / U ${formatMoney(cockpitKpis.openUnrealizedPnl, 2)}`,
      color:
        Number(cockpitKpis.todayPnl) < 0
          ? CSS_COLOR.red
          : Number(cockpitKpis.todayPnl) > 0
            ? CSS_COLOR.green
            : CSS_COLOR.textDim,
    },
    {
      label: "Latest Event",
      value: latestEvent ? formatEnumLabel(latestEvent.eventType) : "NONE",
      detail: latestEvent
        ? formatRelativeTimeShort(latestEvent.occurredAt)
        : "no execution events",
      color: latestEvent ? CSS_COLOR.cyan : CSS_COLOR.textDim,
    },
  ];

  const cockpitRiskCards = [
    ["Today P&L", formatMoney(cockpitKpis.todayPnl, 2), CSS_COLOR.text],
    ["Loss left", formatMoney(cockpitKpis.dailyLossRemaining, 2), CSS_COLOR.text],
    ["Premium", formatMoney(cockpitKpis.openPremium, 2), CSS_COLOR.amber],
    [
      "Open symbols",
      `${cockpitKpis.openSymbols ?? 0}/${cockpitKpis.maxOpenSymbols ?? signalOptionsProfile.riskCaps.maxOpenSymbols}`,
      CSS_COLOR.cyan,
    ],
    ["Candidates", cockpitKpis.candidates ?? signalOptionsCandidates.length, CSS_COLOR.cyan],
    ["Blocked", cockpitKpis.blockedCandidates ?? 0, CSS_COLOR.red],
    ["Filled", cockpitKpis.shadowFilledCandidates ?? 0, CSS_COLOR.green],
    ["Positions", cockpitKpis.openPositions ?? signalOptionsPositions.length, CSS_COLOR.green],
  ];

  const signalOptionsPerformanceCards = [
    [
      "Closed",
      Number(signalOptionsPerformanceSummary.closedTrades ?? 0).toLocaleString(),
      CSS_COLOR.text,
    ],
    [
      "Realized",
      formatMoney(signalOptionsPerformanceSummary.realizedPnl, 2),
      Number(signalOptionsPerformanceSummary.realizedPnl) < 0
        ? CSS_COLOR.red
        : Number(signalOptionsPerformanceSummary.realizedPnl) > 0
          ? CSS_COLOR.green
          : CSS_COLOR.text,
    ],
    [
      "Win rate",
      formatPct(signalOptionsPerformanceSummary.winRatePercent, 1),
      CSS_COLOR.cyan,
    ],
    [
      "Profit factor",
      formatPlainPrice(signalOptionsPerformanceSummary.profitFactor, 2),
      CSS_COLOR.amber,
    ],
    [
      "Expectancy",
      formatMoney(signalOptionsPerformanceSummary.expectancy, 2),
      CSS_COLOR.text,
    ],
    [
      "Open premium",
      formatMoney(signalOptionsOpenExposure.openPremium, 2),
      CSS_COLOR.amber,
    ],
    [
      "Symbol slots",
      `${signalOptionsOpenExposure.openSymbols ?? cockpitKpis.openSymbols ?? 0}/${signalOptionsOpenExposure.maxOpenSymbols ?? signalOptionsProfile.riskCaps.maxOpenSymbols}`,
      signalOptionsOpenExposure.atOpenSymbolCapacity ? CSS_COLOR.amber : CSS_COLOR.cyan,
    ],
    [
      "Unmarked",
      Number(signalOptionsOpenExposure.unmarkedPositions ?? 0).toLocaleString(),
      Number(signalOptionsOpenExposure.unmarkedPositions) ? CSS_COLOR.amber : CSS_COLOR.green,
    ],
  ];

  const cockpitBacktestCards = [
    ["Strategy", cockpitSourceBacktest?.strategyName || MISSING_VALUE],
    [
      "Run",
      cockpitSourceBacktest?.runName ||
        cockpitSourceBacktest?.sourceRunId?.slice(0, 8) ||
        MISSING_VALUE,
    ],
    [
      "Net P&L",
      formatCockpitMetric(cockpitSourceBacktest?.metrics, "netPnl", (value) =>
        formatMoney(value, 2),
      ),
    ],
    [
      "Win rate",
      formatCockpitMetric(
        cockpitSourceBacktest?.metrics,
        "winRatePercent",
        (value) => formatPct(value, 1),
      ),
    ],
    [
      "Max DD",
      formatCockpitMetric(
        cockpitSourceBacktest?.metrics,
        "maxDrawdownPercent",
        (value) => formatPct(value, 1),
      ),
    ],
    [
      "Trades",
      formatCockpitMetric(cockpitSourceBacktest?.metrics, "tradeCount", (value) =>
        Number(value).toLocaleString(),
      ),
    ],
  ];

  const visibleSignalRows = useMemo(
    () =>
      buildVisibleSignalRows({
        signalMatrixStates,
        signalTimeframes: staSignalTimeframes,
        signalActionTimeframes: staActionSignalTimeframes,
        universeSymbols: focusedDeployment?.symbolUniverse || [],
      }),
    [
      focusedDeployment?.symbolUniverse,
      signalMatrixStates,
      staActionSignalTimeframes,
      staSignalTimeframes,
    ],
  );
  const signalTableScanFallback = useMemo(() => {
    const pollIntervalSeconds = Number(signalMonitorProfile?.pollIntervalSeconds);
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
        status: signalTableScanFallback.lastSignalScanAt ? "healthy" : "waiting",
        count:
          visibleSignalRows.length ||
          focusedDeployment?.symbolUniverse?.length ||
          0,
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
      stages: cockpitPipelineStages.length ? cockpitPipelineStages : fallbackStages,
      signalRows: visibleSignalRows,
      deploymentSymbolUniverse: focusedDeployment?.symbolUniverse || [],
      candidates: signalOptionsCandidates,
      scanFallback: signalTableScanFallback,
      signalMatrixFreshnessDetail,
      signalSourcePolicy: signalOptionsState?.signalSourcePolicy || null,
    });
  }, [
    cockpitPipelineStages,
    focusedDeployment?.lastEvaluatedAt,
    focusedDeployment?.symbolUniverse,
    signalMatrixFreshnessDetail,
    signalOptionsCandidates,
    signalOptionsState?.signalSourcePolicy,
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
        <AlgoLivePage
            deployments={deployments}
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
            cockpitRisk={cockpit?.risk}
            cockpitGeneratedAt={cockpit?.generatedAt}
            refreshPending={deploymentsQuery.isFetching || cockpitQuery.isFetching}
            cockpitSignalFreshness={cockpitSignalFreshness}
            cockpitTradePath={cockpitTradePath}
            signalOptionsPerformanceSummary={signalOptionsPerformanceSummary}
            cockpitStageItems={cockpitStageItems}
            selectedStage={selectedStage}
            setSelectedPipelineStageId={setSelectedPipelineStageId}
            cockpitAttentionItems={cockpitAttentionItems}
            signalOptionsRuleAdherence={signalOptionsRuleAdherence}
            gatewayReady={gatewayReady}
            signalScanReady={signalScanReady}
            signalScanBlockedReason={null}
            transitions={visibleTransitions}
            visibleSignalRows={visibleSignalRows}
            signalMonitorEventsSourceStatus={signalMonitorEventsSourceStatus}
            signalOptionsCandidates={signalOptionsCandidates}
            signalOptionsSourceHealth={signalOptionsSourceHealth}
            signalMatrixStates={signalMatrixStates}
            selectedCandidate={selectedCandidate}
            signalOptionsProfile={signalOptionsProfile}
            mtfAlignmentDraft={profileDraft?.entryGate?.mtfAlignment}
            staSignalTimeframes={staSignalTimeframes}
            onOpenCandidateInTrade={handleOpenCandidateInTrade}
            safeQaMode={safeQaMode}
            signalOptionsPositions={signalOptionsPositions}
            signalOptionsLedgerPositionsQuery={signalOptionsLedgerPositionsQuery}
            symbolIndex={symbolIndex}
            events={events}
            userPreferences={userPreferences}
            strategySettingsDraft={strategySettingsDraft}
            activitySummary={activitySummary}
            focusedDeployment={focusedDeployment}
            onSelectDeployment={setFocusedDeploymentId}
            accountId={activeAccountId}
            environment={environment}
            bridgeTone={bridgeTone}
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
                handleApplyExpandedCapacity={handleApplyExpandedCapacity}
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
      </div>
    </div>
    </div>
  );
};

export default AlgoScreen;
