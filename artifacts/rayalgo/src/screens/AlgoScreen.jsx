import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
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
import { AlgoAuditPanel } from "./algo/AlgoAuditPanel";
import { AlgoLivePage } from "./algo/AlgoLivePage";
import { AlgoRightRail } from "./algo/AlgoRightRail";
import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PROFILE_BOOLEAN_FIELDS,
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  SIGNAL_OPTIONS_EXPANDED_CAPACITY,
  SIGNAL_OPTIONS_LIQUIDITY_REASON_LABELS,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
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
  bridgeRuntimeMessage,
  bridgeRuntimeTone,
} from "../features/platform/bridgeRuntimeModel";
import {
  IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
  closeIbkrProtocolLauncher,
  navigateIbkrProtocolLauncher,
  openIbkrProtocolLauncher,
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
import { formatAppTimeForPreferences } from "../lib/timeZone";
import {
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


const signalOptionsRuleColor = (status) => {
  if (status === "fail") return T.red;
  if (status === "warning") return T.amber;
  return T.green;
};

const formatCockpitMetric = (metrics, key, formatter = (value) => value) =>
  Object.prototype.hasOwnProperty.call(asRecord(metrics), key)
    ? formatter(asRecord(metrics)[key])
    : MISSING_VALUE;


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
  isVisible = false,
  onJumpToTradeCandidate,
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
  const [profileSectionOpen, setProfileSectionOpen] = useState("signal");
  const [selectedPipelineStageId, setSelectedPipelineStageId] = useState("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [profileDraft, setProfileDraft] = useState(
    SIGNAL_OPTIONS_DEFAULT_PROFILE,
  );
  const [strategySettingsDraft, setStrategySettingsDraft] = useState(
    DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  );
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
  useRuntimeWorkloadFlag("algo:deployments", isVisible, {
    kind: "poll",
    label: "Algo deployments",
    detail: "15s",
    priority: 7,
  });
  const draftsQuery = useListBacktestDraftStrategies({
    query: {
      ...QUERY_DEFAULTS,
      enabled: Boolean(isVisible),
      refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
      retry: false,
    },
  });
  const deploymentsQuery = useListAlgoDeployments(
    undefined,
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(isVisible),
        refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
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
      ? { deploymentId: focusedDeployment.id, limit: 20 }
      : { limit: 20 },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(isVisible),
        refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
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
        enabled: Boolean(isVisible && focusedDeployment?.id),
        refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
        retry: false,
      },
    },
  );
  const cockpitQuery = useGetAlgoDeploymentCockpit(focusedDeployment?.id || "", {
    query: {
      ...QUERY_DEFAULTS,
      enabled: Boolean(isVisible && focusedDeployment?.id),
      refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
      retry: false,
    },
  });
  const signalOptionsPerformanceQuery = useGetSignalOptionsPerformance(
    focusedDeployment?.id || "",
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(isVisible && focusedDeployment?.id),
        refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
        retry: false,
      },
    },
  );
  const signalMonitorProfileQuery = useGetSignalMonitorProfile(
    { environment: focusedDeployment?.mode || environment },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: Boolean(isVisible && focusedDeployment?.id),
        refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
        retry: false,
      },
    },
  );
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
      setRecentTransitions([]);
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
  }, [
    cockpit?.evaluatedAt,
    events,
    focusedDeployment?.id,
    signalOptionsSignals,
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
  }, [
    cockpit?.evaluatedAt,
    events,
    focusedDeployment?.id,
    signalOptionsCandidates,
    signalOptionsPerformanceSummary,
    signalOptionsSignals,
  ]);

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

  useEffect(() => {
    setProfileDraft(cloneProfile(signalOptionsProfile));
  }, [focusedDeployment?.id, signalOptionsProfile]);

  const resolvedStrategySignalSettings = useMemo(
    () => resolveStrategySignalSettings(focusedDeployment, signalMonitorProfile),
    [focusedDeployment, signalMonitorProfile],
  );

  useEffect(() => {
    setStrategySettingsDraft(resolvedStrategySignalSettings);
  }, [
    focusedDeployment?.id,
    resolvedStrategySignalSettings.bosConfirmation,
    resolvedStrategySignalSettings.chochAtrBuffer,
    resolvedStrategySignalSettings.chochBodyExpansionAtr,
    resolvedStrategySignalSettings.chochVolumeGate,
    resolvedStrategySignalSettings.signalTimeframe,
    resolvedStrategySignalSettings.timeHorizon,
  ]);

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

  const refreshAlgoQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/algo/deployments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/algo/events"] });
    queryClient.invalidateQueries({ queryKey: ["/api/session"] });
    queryClient.invalidateQueries({
      queryKey: getGetSignalMonitorProfileQueryKey({
        environment: focusedDeployment?.mode || environment,
      }),
    });
    if (focusedDeployment?.id) {
      queryClient.invalidateQueries({
        queryKey: getGetSignalOptionsAutomationStateQueryKey(focusedDeployment.id),
      });
      queryClient.invalidateQueries({
        queryKey: getGetAlgoDeploymentCockpitQueryKey(focusedDeployment.id),
      });
      queryClient.invalidateQueries({
        queryKey: getGetSignalOptionsPerformanceQueryKey(focusedDeployment.id),
      });
    }
  };

  const startGatewayBridgeMutation = useMutation({
    mutationFn: () => signalOptionsApi("/api/ibkr/bridge/launcher"),
    onSuccess: (payload, protocolLauncher) => {
      setBridgeLauncherError(null);
      const launched = navigateIbkrProtocolLauncher(
        protocolLauncher,
        payload.launchUrl,
      );
      if (launched) {
        setBridgeLaunchInFlightUntil(
          Date.now() + IBKR_BRIDGE_LAUNCH_COOLDOWN_MS,
        );
      }
      if (!launched) {
        setBridgeLauncherError(
          "Could not open the RayAlgo IBKR PowerShell launcher from this browser.",
        );
      }
      toast.push({
        kind: "success",
        title: launched ? "Bridge launcher opened" : "Bridge launcher ready",
        body: launched
          ? "Your browser should ask to open the RayAlgo IBKR PowerShell launcher."
          : "The one-click IBKR bridge handler did not open.",
      });
    },
    onError: (error, protocolLauncher) => {
      closeIbkrProtocolLauncher(protocolLauncher);
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
      onSuccess: (state) => {
        refreshAlgoQueries();
        setProfileDraft(cloneProfile(state?.profile));
        toast.push({
          kind: "success",
          title: "Profile saved",
          body: "Signal-options automation settings were updated.",
        });
      },
      onError: (error) => {
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
      onSuccess: (payload) => {
        refreshAlgoQueries();
        if (payload?.signalMonitorProfile?.environment) {
          queryClient.setQueryData(
            getGetSignalMonitorProfileQueryKey({
              environment: payload.signalMonitorProfile.environment,
            }),
            payload.signalMonitorProfile,
          );
        }
        setStrategySettingsDraft(
          resolveStrategySignalSettings(
            payload?.deployment || focusedDeployment,
            payload?.signalMonitorProfile || signalMonitorProfile,
          ),
        );
        toast.push({
          kind: "success",
          title: "Signal settings saved",
          body: "RayAlgo signal timeframe and RayReplica settings were updated.",
        });
      },
      onError: (error) => {
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
    const protocolLauncher = openIbkrProtocolLauncher();
    startGatewayBridgeMutation.mutate(protocolLauncher);
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
      handleStartGatewayBridge();
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
      handleStartGatewayBridge();
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
      handleStartGatewayBridge();
      return;
    }
    runShadowScanMutation.mutate({ deploymentId: focusedDeployment.id });
  };

  const handleSaveStrategySettings = () => {
    if (!focusedDeployment?.id) {
      return;
    }
    const timeHorizon = Math.min(
      50,
      Math.max(2, Math.round(numberFrom(strategySettingsDraft.timeHorizon, 8))),
    );
    const signalTimeframe = STRATEGY_SIGNAL_TIMEFRAMES.includes(
      strategySettingsDraft.signalTimeframe,
    )
      ? strategySettingsDraft.signalTimeframe
      : DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;
    const bosConfirmation = RAY_REPLICA_BOS_CONFIRMATION_OPTIONS.includes(
      strategySettingsDraft.bosConfirmation,
    )
      ? strategySettingsDraft.bosConfirmation
      : DEFAULT_STRATEGY_SIGNAL_SETTINGS.bosConfirmation;

    updateStrategySettingsMutation.mutate({
      deploymentId: focusedDeployment.id,
      data: {
        signalTimeframe,
        timeHorizon,
        bosConfirmation,
        chochAtrBuffer: boundedNumberFrom(
          strategySettingsDraft.chochAtrBuffer,
          DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer,
          0,
          20,
        ),
        chochBodyExpansionAtr: boundedNumberFrom(
          strategySettingsDraft.chochBodyExpansionAtr,
          DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochBodyExpansionAtr,
          0,
          20,
        ),
        chochVolumeGate: boundedNumberFrom(
          strategySettingsDraft.chochVolumeGate,
          DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochVolumeGate,
          0,
          20,
        ),
      },
    });
  };

  const patchProfileDraft = (section, key, value) => {
    setProfileDraft((current) => ({
      ...cloneProfile(current),
      [section]: {
        ...cloneProfile(current)[section],
        [key]: value,
      },
    }));
  };

  const patchProfileDraftNested = (section, key, nestedKey, value) => {
    setProfileDraft((current) => {
      const currentProfile = cloneProfile(current);
      const sectionValue = asRecord(currentProfile[section]);
      const nestedValue = asRecord(sectionValue[key]);
      return {
        ...currentProfile,
        [section]: {
          ...sectionValue,
          [key]: {
            ...nestedValue,
            [nestedKey]: value,
          },
        },
      };
    });
  };

  const handleSaveProfile = () => {
    if (!focusedDeployment?.id) {
      return;
    }
    updateProfileMutation.mutate({
      deploymentId: focusedDeployment.id,
      data: profileDraft,
    });
  };

  const handleApplyExpandedCapacity = () => {
    if (!focusedDeployment?.id) {
      return;
    }
    const nextProfile = buildExpandedSignalOptionsProfile(profileDraft);
    setProfileDraft(nextProfile);
    updateProfileMutation.mutate({
      deploymentId: focusedDeployment.id,
      data: nextProfile,
    });
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
      color: T.accent,
    },
    {
      label: "Deployments",
      value: `${cockpitFleet?.totalDeployments ?? deployments.length}`,
      detail: deployments.length
        ? `${cockpitFleet?.enabledDeployments ?? enabledDeployments.length} enabled · ${cockpitTradePath.blockedCandidates ?? 0} blocked`
        : "none created",
      color:
        Number(cockpitTradePath.blockedCandidates) > 0
          ? T.red
          : deployments.length
            ? T.green
            : T.textDim,
    },
    {
      label: "Data Bridge",
      value: cockpitReadiness?.ready ? "READY" : bridgeTone.label.toUpperCase(),
      detail:
        cockpitReadiness?.message ||
        (session?.ibkrBridge?.transport === "tws"
          ? `IB Gateway ${session?.ibkrBridge?.sessionMode || ""} · ${activeAccountId || "no account"}`
          : `${session?.ibkrBridge?.transport || "bridge"} · ${activeAccountId || "no account"}`),
      color: cockpitReadiness?.ready ? T.green : bridgeTone.color,
    },
    {
      label: "Today P&L",
      value: formatMoney(cockpitKpis.todayPnl, 2),
      detail: `R ${formatMoney(cockpitKpis.dailyRealizedPnl, 2)} / U ${formatMoney(cockpitKpis.openUnrealizedPnl, 2)}`,
      color:
        Number(cockpitKpis.todayPnl) < 0
          ? T.red
          : Number(cockpitKpis.todayPnl) > 0
            ? T.green
            : T.textDim,
    },
    {
      label: "Latest Event",
      value: latestEvent ? formatEnumLabel(latestEvent.eventType) : "NONE",
      detail: latestEvent
        ? formatRelativeTimeShort(latestEvent.occurredAt)
        : "no execution events",
      color: latestEvent ? T.cyan : T.textDim,
    },
  ];

  const cockpitRiskCards = [
    ["Today P&L", formatMoney(cockpitKpis.todayPnl, 2), T.text],
    ["Loss left", formatMoney(cockpitKpis.dailyLossRemaining, 2), T.text],
    ["Premium", formatMoney(cockpitKpis.openPremium, 2), T.amber],
    [
      "Open symbols",
      `${cockpitKpis.openSymbols ?? 0}/${cockpitKpis.maxOpenSymbols ?? signalOptionsProfile.riskCaps.maxOpenSymbols}`,
      T.cyan,
    ],
    ["Candidates", cockpitKpis.candidates ?? signalOptionsCandidates.length, T.cyan],
    ["Blocked", cockpitKpis.blockedCandidates ?? 0, T.red],
    ["Filled", cockpitKpis.shadowFilledCandidates ?? 0, T.green],
    ["Positions", cockpitKpis.openPositions ?? signalOptionsPositions.length, T.green],
  ];

  const signalOptionsPerformanceCards = [
    [
      "Closed",
      Number(signalOptionsPerformanceSummary.closedTrades ?? 0).toLocaleString(),
      T.text,
    ],
    [
      "Realized",
      formatMoney(signalOptionsPerformanceSummary.realizedPnl, 2),
      Number(signalOptionsPerformanceSummary.realizedPnl) < 0
        ? T.red
        : Number(signalOptionsPerformanceSummary.realizedPnl) > 0
          ? T.green
          : T.text,
    ],
    [
      "Win rate",
      formatPct(signalOptionsPerformanceSummary.winRatePercent, 1),
      T.cyan,
    ],
    [
      "Profit factor",
      formatPlainPrice(signalOptionsPerformanceSummary.profitFactor, 2),
      T.amber,
    ],
    [
      "Expectancy",
      formatMoney(signalOptionsPerformanceSummary.expectancy, 2),
      T.text,
    ],
    [
      "Open premium",
      formatMoney(signalOptionsOpenExposure.openPremium, 2),
      T.amber,
    ],
    [
      "Capacity",
      `${signalOptionsOpenExposure.openSymbols ?? cockpitKpis.openSymbols ?? 0}/${signalOptionsOpenExposure.maxOpenSymbols ?? signalOptionsProfile.riskCaps.maxOpenSymbols}`,
      signalOptionsOpenExposure.atOpenSymbolCapacity ? T.amber : T.cyan,
    ],
    [
      "Unmarked",
      Number(signalOptionsOpenExposure.unmarkedPositions ?? 0).toLocaleString(),
      Number(signalOptionsOpenExposure.unmarkedPositions) ? T.amber : T.green,
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
          label: "Scan Universe",
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
  const visibleSignalRows = (
    signalOptionsSignals.length
      ? signalOptionsSignals
      : signalOptionsCandidates.map((candidate) => ({
          ...asRecord(candidate.signal),
          symbol: candidate.symbol,
          timeframe: candidate.timeframe,
          direction: candidate.direction,
          signalAt: candidate.signalAt,
          signalPrice: candidate.signalPrice,
        }))
  ).slice(0, algoIsPhone ? 4 : 6);

  return (
    <div
      ref={algoRootRef}
      data-testid="algo-screen"
      data-layout={algoIsPhone ? "phone" : algoIsNarrow ? "tablet" : "desktop"}
      style={{
        background: T.bg0,
        height: "100%",
        width: "100%",
        overflowY: "auto",
        minWidth: 0,
      }}
    >
    <div
      style={{
        width: "100%",
        padding: sp(algoIsPhone ? "10px 10px 14px" : "16px 24px 20px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(algoIsPhone ? 8 : 10),
        minWidth: 0,
      }}
    >
      {brokerConfigured && !gatewayReady && (
        <div
          className="ra-panel-enter ra-focus-rail"
          style={{
            ...motionVars({ accent: T.amber }),
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
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
                color: T.amber,
                letterSpacing: "0.04em",
              }}
            >
              SHADOW SCANS WAITING FOR DATA
            </span>
            <span
              style={{
                fontSize: textSize("caption"),
                color: T.textSec,
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
                color: T.textDim,
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
                border: `1px solid ${T.amber}`,
                background: T.amber,
                color: T.onAccent,
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
                color: bridgeLauncherError ? T.red : T.textDim,
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
        <AlgoLivePage
          deployments={deployments}
          candidateDrafts={candidateDrafts}
          selectedDraft={selectedDraft}
          setSelectedDraftId={setSelectedDraftId}
          deploymentName={deploymentName}
          setDeploymentName={setDeploymentName}
          symbolUniverseInput={symbolUniverseInput}
          setSymbolUniverseInput={setSymbolUniverseInput}
          handleCreateDeployment={handleCreateDeployment}
          createDeploymentMutation={createDeploymentMutation}
          cockpitKpis={cockpitKpis}
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
          selectedCandidate={selectedCandidate}
          signalOptionsProfile={signalOptionsProfile}
          signalOptionsPositions={signalOptionsPositions}
          symbolIndex={symbolIndex}
          events={events}
          userPreferences={userPreferences}
          signalMonitorProfile={signalMonitorProfile}
          strategySettingsDraft={strategySettingsDraft}
          setStrategySettingsDraft={setStrategySettingsDraft}
          handleSaveStrategySettings={handleSaveStrategySettings}
          updateStrategySettingsMutation={updateStrategySettingsMutation}
          activitySummary={activitySummary}
          focusedDeployment={focusedDeployment}
          handleToggleDeployment={handleToggleDeployment}
          handleRunShadowScan={handleRunShadowScan}
          enableDeploymentMutation={enableDeploymentMutation}
          pauseDeploymentMutation={pauseDeploymentMutation}
          runShadowScanMutation={runShadowScanMutation}
          algoIsPhone={algoIsPhone}
          algoIsNarrow={algoIsNarrow}
          auditPanel={
            <AlgoAuditPanel
              events={events}
              focusedDeployment={focusedDeployment}
              userPreferences={userPreferences}
            />
          }
          rightRail={
            <AlgoRightRail
              cockpit={cockpit}
              signalOptionsPositions={signalOptionsPositions}
              signalOptionsProfile={signalOptionsProfile}
              profileDraft={profileDraft}
              patchProfileDraft={patchProfileDraft}
              patchProfileDraftNested={patchProfileDraftNested}
              strategySettingsDraft={strategySettingsDraft}
              setStrategySettingsDraft={setStrategySettingsDraft}
              signalMonitorProfile={signalMonitorProfile}
              focusedDeployment={focusedDeployment}
              profileSectionOpen={profileSectionOpen}
              setProfileSectionOpen={setProfileSectionOpen}
              handleApplyExpandedCapacity={handleApplyExpandedCapacity}
              handleSaveStrategySettings={handleSaveStrategySettings}
              handleSaveProfile={handleSaveProfile}
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
