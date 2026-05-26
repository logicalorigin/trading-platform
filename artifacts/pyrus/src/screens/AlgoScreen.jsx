import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Suspense,
  lazy,
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
  useGetSignalMonitorProfile,
  useCreateAlgoDeployment,
  useEnableAlgoDeployment,
  useGetAlgoDeploymentCockpit,
  useGetSignalOptionsPerformance,
  useGetSignalOptionsAutomationState,
  useListAlgoDeployments,
  useListBacktestDraftStrategies,
  useListExecutionEvents,
  usePauseAlgoDeployment,
  useRunSignalOptionsShadowScan,
  useUpdateAlgoDeploymentStrategySettings,
  useUpdateSignalOptionsExecutionProfile,
} from "@workspace/api-client-react";
import { saveAllAlgoAdjustments } from "./algo/saveAllAlgoAdjustments";
import { useServerSyncedDraft } from "./algo/useServerSyncedDraft";
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
  mergeSignalOptionsProfile,
  numberFrom,
  parseChaseSteps,
  resolveStrategySignalSettings,
  shadowLinkSummary,
  signalActionLabel,
  signalBarsSinceLabel,
  signalFilterStateLabel,
  signalFreshnessLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
  signalOptionsApi,
} from "./algo/algoHelpers";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  useAlgoCockpitStream,
  useShadowAccountSnapshotStream,
} from "../features/platform/live-streams";
import {
  bridgeRuntimeMessage,
  bridgeRuntimeTone,
} from "../features/platform/bridgeRuntimeModel";
import {
  IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
  closeIbkrProtocolLauncher,
  navigateIbkrProtocolLauncher,
  openIbkrProtocolLauncher,
  shouldUseRemoteIbkrLaunchBrowser,
} from "../features/platform/ibkrBridgeSession";
import { QUERY_DEFAULTS } from "../features/platform/queryDefaults";
import { useToast } from "../features/platform/platformContexts.jsx";
import { Badge } from "../components/platform/primitives.jsx";
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
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
} from "../lib/motion";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import {
  buildTransitionsBufferStore,
  collectEventTransitions,
  diffSignalSnapshots,
  limitToWindow,
} from "../features/platform/algoTransitionsModel";
import { summarizeCockpitDelta } from "../features/platform/algoActivitySummary";
import {
  buildKpiSample,
  pruneAlgoKpiHistory,
  pushAlgoKpiSample,
} from "../features/platform/algoKpiHistoryStore";
import {
  buildAttentionStream,
  buildCockpitGateSummary,
  isDiagRowsHealthy,
  isGateSummaryHealthy,
} from "./algoCockpitDiagnosticsModel";
import { SectionHeader } from "../components/ui/SectionHeader.jsx";
import { AlgoStatusBar } from "./algo/AlgoStatusBar.jsx";
import { DiagPanel } from "./algo/DiagPanel.jsx";
import { ProfileSection } from "./algo/ProfileSection.jsx";
import { KpiTile } from "./algo/KpiTile.jsx";
import { HeroKpi } from "./algo/HeroKpi.jsx";
import { AttentionList } from "./algo/AttentionList.jsx";
import { PipelineStrip } from "./algo/PipelineStrip.jsx";

const LazyAlgoAuditPanel = lazy(() =>
  import("./algo/AlgoAuditPanel").then((module) => ({
    default: module.AlgoAuditPanel,
  })),
);
const LazyAlgoLivePage = lazy(() =>
  import("./algo/AlgoLivePage").then((module) => ({
    default: module.AlgoLivePage,
  })),
);
const LazyAlgoRightRail = lazy(() =>
  import("./algo/AlgoRightRail").then((module) => ({
    default: module.AlgoRightRail,
  })),
);

const ALGO_CRITICAL_FALLBACK_DELAY_MS = 1_000;
const ALGO_DERIVED_FALLBACK_DELAY_MS = 6_000;

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


const isGatewayReadyForAlgo = (session) => {
  const bridge = asRecord(session?.ibkrBridge);
  return Boolean(
    session?.configured?.ibkr &&
      bridge.healthFresh &&
      bridge.connected &&
      bridge.authenticated &&
      bridge.accountsLoaded &&
      bridge.configuredLiveMarketDataMode,
  );
};

export const AlgoScreen = ({
  session,
  environment,
  accounts = [],
  selectedAccountId = null,
  signalMatrixStates = [],
  isVisible = false,
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
  const [bridgeLauncherError, setBridgeLauncherError] = useState(null);
  const [bridgeLaunchClock, setBridgeLaunchClock] = useState(() => Date.now());
  const [bridgeLaunchInFlightUntil, setBridgeLaunchInFlightUntil] = useState(0);
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(session?.ibkrBridge?.authenticated);
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
  const algoCockpitStreamFreshness = useAlgoCockpitStream({
    deploymentId: focusedDeploymentId,
    mode: environment || "paper",
    enabled: Boolean(isVisible),
  });
  const shadowAccountStreamFreshness = useShadowAccountSnapshotStream({
    enabled: Boolean(isVisible),
  });
  const [algoCriticalFallbackReady, setAlgoCriticalFallbackReady] = useState(false);
  const [algoDerivedFallbackReady, setAlgoDerivedFallbackReady] = useState(false);
  const algoTimingStagesRef = useRef(new Set());
  const autoInitialScanDeploymentIdsRef = useRef(new Set());
  useEffect(() => {
    if (!isVisible) {
      algoTimingStagesRef.current = new Set();
    }
  }, [isVisible]);
  useEffect(() => {
    if (!isVisible || algoCockpitStreamFreshness.algoCriticalFresh) {
      setAlgoCriticalFallbackReady(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setAlgoCriticalFallbackReady(true);
    }, ALGO_CRITICAL_FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [algoCockpitStreamFreshness.algoCriticalFresh, isVisible]);
  useEffect(() => {
    if (!isVisible || algoCockpitStreamFreshness.algoFullFresh) {
      setAlgoDerivedFallbackReady(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setAlgoDerivedFallbackReady(true);
    }, ALGO_DERIVED_FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [algoCockpitStreamFreshness.algoFullFresh, isVisible]);
  const algoCriticalReady = Boolean(
    isVisible &&
      (algoCockpitStreamFreshness.algoCriticalFresh ||
        algoCriticalFallbackReady),
  );
  useEffect(() => {
    const derivedReady = Boolean(
      isVisible &&
        (algoCockpitStreamFreshness.algoFullFresh ||
          algoDerivedFallbackReady),
    );
    onReadinessChange?.({
      criticalReady: algoCriticalReady,
      derivedReady,
      backgroundAllowed: derivedReady,
    });
  }, [
    algoCriticalReady,
    algoCockpitStreamFreshness.algoFullFresh,
    algoDerivedFallbackReady,
    isVisible,
    onReadinessChange,
  ]);
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
    if (!algoCriticalReady) {
      return;
    }
    markAlgoTiming("critical-data-ready", {
      source: algoCockpitStreamFreshness.algoCriticalFresh
        ? "stream"
        : "rest-fallback",
    });
  }, [
    algoCockpitStreamFreshness.algoCriticalFresh,
    algoCriticalReady,
    markAlgoTiming,
  ]);
  useEffect(() => {
    if (
      !isVisible ||
      !(algoCockpitStreamFreshness.algoFullFresh || algoDerivedFallbackReady)
    ) {
      return;
    }
    markAlgoTiming("derived-data-ready", {
      source: algoCockpitStreamFreshness.algoFullFresh ? "stream" : "rest-fallback",
    });
  }, [
    algoCockpitStreamFreshness.algoFullFresh,
    algoDerivedFallbackReady,
    isVisible,
    markAlgoTiming,
  ]);
  const algoCriticalQueriesEnabled = Boolean(isVisible);
  const algoDerivedQueriesEnabled = Boolean(isVisible);
  const algoPostCriticalQueriesEnabled = Boolean(isVisible);
  const algoRoutineRefetchInterval =
    isVisible && !algoCockpitStreamFreshness.algoCriticalFresh
      ? QUERY_DEFAULTS.refetchInterval
      : false;
  const algoDerivedRefetchInterval =
    isVisible && !algoCockpitStreamFreshness.algoFullFresh
      ? QUERY_DEFAULTS.refetchInterval
      : false;
  const signalOptionsLedgerPositionsRefetchInterval =
    algoPostCriticalQueriesEnabled && !shadowAccountStreamFreshness.accountFresh
      ? QUERY_DEFAULTS.refetchInterval
      : false;
  useRuntimeWorkloadFlag("algo:cockpit", isVisible, {
    kind: algoCockpitStreamFreshness.algoCriticalFresh ? "stream" : "poll",
    label: "Algo cockpit",
    detail: algoCockpitStreamFreshness.algoCriticalFresh ? "SSE" : "15s fallback",
    priority: 7,
  });
  const draftsQuery = useListBacktestDraftStrategies({
    query: {
      ...QUERY_DEFAULTS,
      enabled: algoPostCriticalQueriesEnabled,
      refetchInterval: algoDerivedRefetchInterval,
      retry: false,
    },
  });
  const deploymentsQuery = useListAlgoDeployments(
    undefined,
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: algoCriticalQueriesEnabled,
        refetchInterval: algoRoutineRefetchInterval,
        retry: false,
      },
    },
  );
  const deployments = deploymentsQuery.data?.deployments || [];
  const candidateDrafts = useMemo(() => {
    const drafts = draftsQuery.data?.drafts || [];
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
        enabled: algoCriticalQueriesEnabled,
        refetchInterval: algoRoutineRefetchInterval,
        retry: false,
      },
    },
  );
  const events = eventsQuery.data?.events || [];
  const signalOptionsStateQuery = useGetSignalOptionsAutomationState(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(algoCriticalQueriesEnabled && focusedDeployment?.id),
        refetchInterval: algoRoutineRefetchInterval,
        retry: false,
      },
    },
  );
  const cockpitQuery = useGetAlgoDeploymentCockpit(focusedDeployment?.id || "", {
    query: {
      ...QUERY_DEFAULTS,
      enabled: Boolean(algoDerivedQueriesEnabled && focusedDeployment?.id),
      refetchInterval: algoDerivedRefetchInterval,
      retry: false,
    },
  });
  const signalOptionsPerformanceQuery = useGetSignalOptionsPerformance(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(algoDerivedQueriesEnabled && focusedDeployment?.id),
        refetchInterval: algoDerivedRefetchInterval,
        retry: false,
      },
    },
  );
  const signalMonitorProfileQuery = useGetSignalMonitorProfile(
    { environment: focusedDeployment?.mode || environment },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(algoDerivedQueriesEnabled && focusedDeployment?.id),
        refetchInterval: algoDerivedRefetchInterval,
        retry: false,
      },
    },
  );
  const signalOptionsLedgerPositionsQuery = useGetAccountPositions(
    "shadow",
    {
      mode: "paper",
      assetClass: "Options",
    },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: algoPostCriticalQueriesEnabled,
        staleTime: shadowAccountStreamFreshness.accountFresh
          ? 30_000
          : QUERY_DEFAULTS.staleTime,
        refetchInterval: signalOptionsLedgerPositionsRefetchInterval,
        retry: false,
      },
    },
  );
  const deploymentsSettled = Boolean(
    deploymentsQuery.data ||
      deploymentsQuery.isFetched ||
      deploymentsQuery.isError,
  );
  const draftsSettled = Boolean(
    draftsQuery.data || draftsQuery.isFetched || draftsQuery.isError,
  );
  const signalOptionsStateSettled = Boolean(
    signalOptionsStateQuery.data ||
      signalOptionsStateQuery.isFetched ||
      signalOptionsStateQuery.isError,
  );
  const cockpitSettled = Boolean(
    cockpitQuery.data || cockpitQuery.isFetched || cockpitQuery.isError,
  );
  const algoSetupDataSettled = Boolean(deploymentsSettled && draftsSettled);
  const cockpit = cockpitQuery.data || null;
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
  const signalMonitorProfile = signalMonitorProfileQuery.data || null;
  const signalOptionsProfile =
    signalOptionsState?.profile || SIGNAL_OPTIONS_DEFAULT_PROFILE;
  const signalOptionsCandidates =
    cockpit?.candidates || signalOptionsState?.candidates || [];
  const signalOptionsSignals =
    cockpit?.signals || signalOptionsState?.signals || [];
  const signalOptionsPositions =
    cockpit?.activePositions || signalOptionsState?.activePositions || [];
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
      setFocusedDeploymentId(null);
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

  useEffect(() => {
    if (!signalOptionsCandidates.length) {
      setSelectedCandidateId(null);
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

  const startGatewayBridgeMutation = useMutation({
    mutationFn: ({ useRemoteDesktopLaunch }) =>
      signalOptionsApi(
        useRemoteDesktopLaunch
          ? "/api/ibkr/remote-launch"
          : "/api/ibkr/bridge/launcher",
        useRemoteDesktopLaunch
          ? {
              method: "POST",
              body: JSON.stringify({ autoLogin: false }),
            }
          : undefined,
      ),
    onSuccess: (payload, variables) => {
      setBridgeLauncherError(null);
      const launched = variables.useRemoteDesktopLaunch
        ? Boolean(payload.remoteLaunch?.jobId)
        : navigateIbkrProtocolLauncher(
            variables.protocolLauncher,
            payload.launchUrl,
          );
      if (launched) {
        setBridgeLaunchInFlightUntil(
          Date.now() + IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
        );
      }
      if (!launched) {
        setBridgeLauncherError(
          variables.useRemoteDesktopLaunch
            ? "No paired Windows desktop accepted the IBKR bridge launch request."
            : "Could not open the PYRUS IBKR PowerShell launcher from this browser.",
        );
      }
      toast.push({
        kind: "success",
        title: launched
          ? variables.useRemoteDesktopLaunch
            ? "Bridge launch sent"
            : "Bridge launcher opened"
          : "Bridge launcher ready",
        body: launched && variables.useRemoteDesktopLaunch
          ? "The paired Windows desktop should start the PYRUS IBKR helper."
          : launched
          ? "Your browser should ask to open the PYRUS IBKR PowerShell launcher."
          : "The one-click IBKR bridge handler did not open.",
      });
    },
    onError: (error, variables) => {
      closeIbkrProtocolLauncher(variables?.protocolLauncher);
      setBridgeLauncherError(error?.message || "Gateway bridge launch failed.");
      toast.push({
        kind: "error",
        title: "Bridge launcher failed",
        body: error?.message || "The IB Gateway bridge launcher could not start.",
      });
    },
  });
  useEffect(() => {
    if (
      !isVisible ||
      brokerAuthenticated ||
      bridgeLaunchInFlightUntil <= bridgeLaunchClock
    ) {
      return undefined;
    }
    const timer = window.setInterval(() => setBridgeLaunchClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [bridgeLaunchClock, bridgeLaunchInFlightUntil, brokerAuthenticated, isVisible]);
  useEffect(() => {
    if (brokerAuthenticated && bridgeLaunchInFlightUntil > 0) {
      setBridgeLaunchInFlightUntil(0);
    }
  }, [bridgeLaunchInFlightUntil, brokerAuthenticated]);
  const bridgeLaunchInFlight = Boolean(
    !brokerAuthenticated && bridgeLaunchInFlightUntil > bridgeLaunchClock,
  );
  const gatewayBridgeLaunching = Boolean(
    startGatewayBridgeMutation.isPending || bridgeLaunchInFlight,
  );

  const runShadowScanMutation = useRunSignalOptionsShadowScan({
    mutation: {
      onSuccess: (state) => {
        refreshAlgoQueries();
        if (
          state?.status === "already_running" ||
          state?.reason === "signal_options_scan_running"
        ) {
          toast.push({
            kind: "info",
            title: "Shadow scan already running",
            body: "The active signal-options scan will finish before another one starts.",
          });
          return;
        }
        setSelectedCandidateId(state?.candidates?.[0]?.id || null);
        toast.push({
          kind: "success",
          title: "Shadow scan complete",
          body: `${state?.candidates?.length || 0} signal-option candidates in the queue.`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Shadow scan failed",
          body: error?.message || "The signal-options scan could not finish.",
        });
      },
    },
  });

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
      onSuccess: (state, variables) => {
        const deploymentId = variables?.deploymentId || focusedDeployment?.id;
        if (deploymentId && state) {
          queryClient.setQueryData(
            getGetSignalOptionsAutomationStateQueryKey(deploymentId),
            state,
          );
        }
        if (state?.deployment) {
          setDeploymentCache(state.deployment);
        }
        refreshAlgoQueries({
          includeDeployments: !state?.deployment,
          includeSignalOptionsState: false,
        });
        profileDraftState.markClean(state?.profile || variables?.data);
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
          body: `${deployment.name} · ${deployment.providerAccountId} · ${deployment.mode.toUpperCase()}`,
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
          body: deployment.name,
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
          body: deployment.name,
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

  const handleStartGatewayBridge = () => {
    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR data not configured",
        body: "Configure the IB Gateway bridge before starting Shadow automation.",
      });
      return;
    }
    if (gatewayBridgeLaunching) {
      return;
    }
    const useRemoteDesktopLaunch = shouldUseRemoteIbkrLaunchBrowser();
    const protocolLauncher = useRemoteDesktopLaunch
      ? null
      : openIbkrProtocolLauncher();
    startGatewayBridgeMutation.mutate({
      protocolLauncher,
      useRemoteDesktopLaunch,
    });
  };

  const handleCreateDeployment = () => {
    if (!selectedDraft) {
      toast.push({
        kind: "warn",
        title: "No promoted strategy",
        body: "Promote a completed backtest run before creating a deployment.",
      });
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR data not configured",
        body: "Market-data connectivity must be configured before creating a Shadow deployment.",
      });
      return;
    }

    if (!gatewayReady) {
      toast.push({
        kind: "warn",
        title: "Data bridge required",
        body: "Start the IB Gateway bridge before creating a Shadow signal deployment.",
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
    if (!deployment.enabled && !gatewayReady) {
      toast.push({
        kind: "warn",
        title: "Data bridge required",
        body: "Start the IB Gateway bridge before enabling a Shadow signal deployment.",
      });
      return;
    }

    if (deployment.enabled) {
      pauseDeploymentMutation.mutate({ deploymentId: deployment.id });
      return;
    }

    enableDeploymentMutation.mutate({ deploymentId: deployment.id });
  };

  const handleRunShadowScan = () => {
    if (!focusedDeployment?.id) {
      toast.push({
        kind: "warn",
        title: "No deployment selected",
        body: "Select a deployment before running the signal-options scan.",
      });
      return;
    }
    if (!gatewayReady) {
      toast.push({
        kind: "warn",
        title: "Data bridge required",
        body: "Start the IB Gateway bridge before running a Shadow signal-options scan.",
      });
      return;
    }
    runShadowScanMutation.mutate({ deploymentId: focusedDeployment.id });
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
  };

  const handleOpenCandidateInTrade = (candidate) => {
    if (!candidate || !onJumpToTradeCandidate) {
      return;
    }
    onJumpToTradeCandidate({
      ...candidate,
      deploymentId: focusedDeployment?.id || candidate.deploymentId || null,
      deploymentName:
        focusedDeployment?.name || candidate.deploymentName || null,
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

  const cockpitStageItems = cockpitPipelineStages.length
    ? cockpitPipelineStages
    : [
        {
          id: "scan_universe",
          label: "Signal Symbols",
          status: gatewayReady ? "waiting" : "blocked",
          count: focusedDeployment?.symbolUniverse?.length || 0,
          latestAt: focusedDeployment?.lastEvaluatedAt || null,
          detail: gatewayReady ? "ready to scan" : bridgeRuntimeMessage(session),
        },
      ];
  const selectedStage =
    cockpitStageItems.find((stage) => stage.id === selectedPipelineStageId) ||
    cockpitStageItems[0] ||
    null;
  const visibleSignalRows = signalOptionsSignals.length
    ? signalOptionsSignals
    : signalOptionsCandidates.map((candidate) => ({
        ...asRecord(candidate.signal),
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        direction: candidate.direction,
        signalAt: candidate.signalAt,
        signalPrice: candidate.signalPrice,
      }));
  const algoSignalSurfaceSettled = Boolean(
    focusedDeployment?.id &&
      (signalOptionsStateSettled || cockpitSettled),
  );
  const algoSignalSurfaceEmpty = Boolean(
    focusedDeployment?.id &&
      visibleSignalRows.length === 0 &&
      signalOptionsCandidates.length === 0,
  );
  useEffect(() => {
    const deploymentId = focusedDeployment?.id || null;
    if (
      !isVisible ||
      !deploymentId ||
      !focusedDeployment?.enabled ||
      !gatewayReady ||
      !algoSignalSurfaceSettled ||
      !algoSignalSurfaceEmpty ||
      runShadowScanMutation.isPending ||
      autoInitialScanDeploymentIdsRef.current.has(deploymentId)
    ) {
      return;
    }

    autoInitialScanDeploymentIdsRef.current.add(deploymentId);
    runShadowScanMutation.mutate({ deploymentId });
  }, [
    algoSignalSurfaceEmpty,
    algoSignalSurfaceSettled,
    focusedDeployment?.enabled,
    focusedDeployment?.id,
    gatewayReady,
    isVisible,
    runShadowScanMutation,
    runShadowScanMutation.isPending,
  ]);

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
      {brokerConfigured && !gatewayReady && (
        <div
          className="ra-panel-enter ra-focus-rail"
          style={{
            ...motionVars({ accent: CSS_COLOR.amber }),
            background: `${cssColorMix(CSS_COLOR.amber, 7)}`,
            border: `1px solid ${cssColorMix(CSS_COLOR.amber, 21)}`,
            borderRadius: dim(RADII.sm),
            padding: sp("10px 12px"),
            display: "flex",
            justifyContent: "space-between",
            gap: sp(12),
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
            <span
              style={{
                fontSize: fs(11),
                fontWeight: FONT_WEIGHTS.regular,
                fontFamily: T.sans,
                color: CSS_COLOR.amber,
                letterSpacing: "0.04em",
              }}
            >
              SHADOW SCANS WAITING FOR DATA
            </span>
            <span
              style={{
                fontSize: textSize("caption"),
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                lineHeight: 1.45,
              }}
            >
              {bridgeRuntimeMessage(session)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <div
              style={{
                fontSize: textSize("body"),
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                textAlign: "right",
              }}
            >
              bridge {bridgeTone.label}
              <br />
              {activeAccountId || "no active account"}
            </div>
            <button
              type="button"
              onClick={handleStartGatewayBridge}
              disabled={gatewayBridgeLaunching}
              style={{
                padding: sp("7px 10px"),
                borderRadius: dim(RADII.xs),
                border: `1px solid ${CSS_COLOR.amber}`,
                background: CSS_COLOR.amber,
                color: CSS_COLOR.onAccent,
                fontFamily: T.sans,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.regular,
                cursor:
                  gatewayBridgeLaunching ? "wait" : "pointer",
                opacity: gatewayBridgeLaunching ? 0.72 : 1,
              }}
            >
              {gatewayBridgeLaunching ? "PREPARING..." : "START DATA"}
            </button>
          </div>
          {bridgeLauncherError && (
            <div
              style={{
                gridColumn: "1 / -1",
                width: "100%",
                fontSize: textSize("body"),
                color: bridgeLauncherError ? CSS_COLOR.red : CSS_COLOR.textDim,
                fontFamily: T.sans,
                lineHeight: 1.45,
                wordBreak: "break-word",
              }}
            >
              {bridgeLauncherError}
            </div>
          )}
        </div>
      )}

      <AlgoStatusBar
        focusedDeployment={focusedDeployment}
        deployments={deployments}
        onSelectDeployment={setFocusedDeploymentId}
        gatewayReady={gatewayReady}
        gatewayBridgeLaunching={gatewayBridgeLaunching}
        environment={environment}
        bridgeTone={bridgeTone}
        accountId={activeAccountId}
        lastEvalMsAgo={
          focusedDeployment?.lastEvaluatedAt
            ? Date.now() -
              new Date(focusedDeployment.lastEvaluatedAt).getTime()
            : null
        }
        lastEvalLabel={formatRelativeTimeShort(
          focusedDeployment?.lastEvaluatedAt,
        )}
        lastSignalLabel={formatRelativeTimeShort(
          focusedDeployment?.lastSignalAt,
        )}
        onRefresh={() => refreshAlgoQueries()}
        onToggleEnable={() =>
          focusedDeployment && handleToggleDeployment(focusedDeployment)
        }
        onRunScan={handleRunShadowScan}
        refreshPending={
          deploymentsQuery.isFetching || cockpitQuery.isFetching
        }
        togglePending={
          enableDeploymentMutation.isPending ||
          pauseDeploymentMutation.isPending
        }
        scanPending={runShadowScanMutation.isPending}
        narrow={algoIsNarrow}
      />
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
        <Suspense fallback={null}>
        <LazyAlgoLivePage
          deployments={deployments}
          candidateDrafts={candidateDrafts}
          setupDataSettled={algoSetupDataSettled}
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
          latestEvent={latestEvent}
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
          transitions={visibleTransitions}
          visibleSignalRows={visibleSignalRows}
          signalOptionsCandidates={signalOptionsCandidates}
          signalMatrixStates={signalMatrixStates}
          selectedCandidate={selectedCandidate}
          signalOptionsProfile={signalOptionsProfile}
          onOpenCandidateInTrade={handleOpenCandidateInTrade}
          signalOptionsPositions={signalOptionsPositions}
          signalOptionsLedgerPositionsQuery={signalOptionsLedgerPositionsQuery}
          symbolIndex={symbolIndex}
          events={events}
          userPreferences={userPreferences}
          signalMonitorProfile={signalMonitorProfile}
          strategySettingsDraft={strategySettingsDraft}
          activitySummary={activitySummary}
          focusedDeployment={focusedDeployment}
          handleToggleDeployment={handleToggleDeployment}
          handleRunShadowScan={handleRunShadowScan}
          enableDeploymentMutation={enableDeploymentMutation}
          pauseDeploymentMutation={pauseDeploymentMutation}
          runShadowScanMutation={runShadowScanMutation}
          algoIsPhone={algoIsPhone}
          algoIsNarrow={algoIsNarrow}
          algoLayoutWidth={algoRootSize.width}
          auditPanel={
            <Suspense fallback={null}>
              <LazyAlgoAuditPanel
                events={events}
                focusedDeployment={focusedDeployment}
                userPreferences={userPreferences}
                algoIsPhone={algoIsPhone}
              />
            </Suspense>
          }
          rightRail={
            <Suspense fallback={null}>
              <LazyAlgoRightRail
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
            </Suspense>
          }
        />
        </Suspense>
      </div>
    </div>
    </div>
  );
};

export default AlgoScreen;
