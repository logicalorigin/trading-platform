import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getGetAlgoDeploymentCockpitQueryKey,
  getGetSignalOptionsAutomationStateQueryKey,
  getGetSignalOptionsPerformanceQueryKey,
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
  useUpdateSignalOptionsExecutionProfile,
} from "@workspace/api-client-react";
import {
  AlgoDraftStrategiesPanel,
} from "../features/backtesting/BacktestingPanels";
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
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
} from "../lib/motion";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import { buildCockpitGateSummary } from "./algoCockpitDiagnosticsModel";

const SIGNAL_OPTIONS_DEFAULT_PROFILE = {
  version: "v1",
  mode: "shadow",
  optionSelection: {
    minDte: 1,
    targetDte: 1,
    maxDte: 3,
    allowZeroDte: false,
    callStrikeSlot: 3,
    putStrikeSlot: 2,
  },
  riskCaps: {
    maxPremiumPerEntry: 500,
    maxContracts: 3,
    maxOpenSymbols: 5,
    maxDailyLoss: 1000,
  },
  liquidityGate: {
    maxSpreadPctOfMid: 35,
    minBid: 0.01,
    requireBidAsk: true,
    requireFreshQuote: true,
  },
  entryGate: {
    bearishRegime: {
      enabled: true,
      minAdx: 25,
      rejectFullyBullishMtf: true,
    },
  },
  fillPolicy: {
    chaseMode: "aggressive",
    ttlSeconds: 20,
    chaseSteps: [0, 0.35, 0.65, 0.9],
  },
  exitPolicy: {
    hardStopPct: -50,
    trailActivationPct: 150,
    minLockedGainPct: 25,
    trailGivebackPct: 45,
    tightenAtFiveXGivebackPct: 35,
    tightenAtTenXGivebackPct: 25,
    flipOnOppositeSignal: true,
  },
};

const SIGNAL_OPTIONS_EXPANDED_CAPACITY = {
  maxOpenSymbols: 10,
  maxDailyLoss: 2000,
};

const SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS = [
  { value: 0, label: "Lower -2" },
  { value: 1, label: "Lower -1" },
  { value: 2, label: "ATM lower" },
  { value: 3, label: "ATM upper" },
  { value: 4, label: "Upper +1" },
  { value: 5, label: "Upper +2" },
];

const SIGNAL_OPTIONS_ACTION_LABELS = {
  candidate: "Awaiting Scan",
  blocked: "Blocked",
  shadow_filled: "Shadow Filled",
  partial_shadow: "Partial Shadow",
  manual_override: "Manual Override",
  closed: "Closed",
  mismatch: "Mismatch",
};

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const cloneProfile = (profile) =>
  JSON.parse(JSON.stringify(profile || SIGNAL_OPTIONS_DEFAULT_PROFILE));

const signalOptionsActionLabel = (status) =>
  SIGNAL_OPTIONS_ACTION_LABELS[status] || formatEnumLabel(status || "candidate");

const numberFrom = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mergeSignalOptionsProfile = (source) => {
  const config = asRecord(source);
  const signalOptions = asRecord(config.signalOptions);
  const rawProfile = Object.keys(signalOptions).length ? signalOptions : {};
  const parameters = asRecord(config.parameters);
  const profile = cloneProfile({
    ...SIGNAL_OPTIONS_DEFAULT_PROFILE,
    ...rawProfile,
    optionSelection: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection,
      ...asRecord(rawProfile.optionSelection),
    },
    riskCaps: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps,
      ...asRecord(rawProfile.riskCaps),
    },
    liquidityGate: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.liquidityGate,
      ...asRecord(rawProfile.liquidityGate),
    },
    entryGate: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate,
      ...asRecord(rawProfile.entryGate),
      bearishRegime: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.bearishRegime,
        ...asRecord(asRecord(rawProfile.entryGate).bearishRegime),
      },
    },
    fillPolicy: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.fillPolicy,
      ...asRecord(rawProfile.fillPolicy),
    },
    exitPolicy: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy,
      ...asRecord(rawProfile.exitPolicy),
    },
  });

  if (parameters.executionMode === "signal_options") {
    profile.optionSelection.minDte = numberFrom(
      parameters.signalOptionsMinDte,
      profile.optionSelection.minDte,
    );
    profile.optionSelection.maxDte = Math.max(
      profile.optionSelection.minDte,
      numberFrom(parameters.signalOptionsMaxDte, profile.optionSelection.maxDte),
    );
    profile.optionSelection.targetDte = Math.min(
      profile.optionSelection.maxDte,
      Math.max(
        profile.optionSelection.minDte,
        numberFrom(
          parameters.signalOptionsTargetDte,
          profile.optionSelection.targetDte,
        ),
      ),
    );
    profile.optionSelection.callStrikeSlot = numberFrom(
      parameters.signalOptionsCallStrikeSlot,
      profile.optionSelection.callStrikeSlot,
    );
    profile.optionSelection.putStrikeSlot = numberFrom(
      parameters.signalOptionsPutStrikeSlot,
      profile.optionSelection.putStrikeSlot,
    );
    profile.riskCaps.maxPremiumPerEntry = numberFrom(
      parameters.signalOptionsMaxPremium,
      profile.riskCaps.maxPremiumPerEntry,
    );
    profile.riskCaps.maxContracts = numberFrom(
      parameters.signalOptionsMaxContracts,
      profile.riskCaps.maxContracts,
    );
    profile.riskCaps.maxOpenSymbols = numberFrom(
      parameters.signalOptionsMaxOpenSymbols,
      profile.riskCaps.maxOpenSymbols,
    );
    profile.riskCaps.maxDailyLoss = numberFrom(
      parameters.signalOptionsMaxDailyLoss,
      profile.riskCaps.maxDailyLoss,
    );
    profile.liquidityGate.maxSpreadPctOfMid = numberFrom(
      parameters.signalOptionsMaxSpreadPct,
      profile.liquidityGate.maxSpreadPctOfMid,
    );
  }

  return profile;
};

const buildExpandedSignalOptionsProfile = (profile) => {
  const currentProfile = cloneProfile(profile);
  return {
    ...currentProfile,
    riskCaps: {
      ...asRecord(currentProfile.riskCaps),
      ...SIGNAL_OPTIONS_EXPANDED_CAPACITY,
    },
  };
};

const signalOptionsApi = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload?.detail || payload?.message || payload?.error || message;
    } catch {
      // best effort error body
    }
    throw new Error(message);
  }
  return response.json();
};

const formatMoney = (value, digits = 0) =>
  Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })}`
    : MISSING_VALUE;

const formatPlainPrice = (value, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : MISSING_VALUE;

const formatPct = (value, digits = 1) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : MISSING_VALUE;

const formatChaseSteps = (steps) =>
  Array.isArray(steps)
    ? steps.map((step) => `${Math.round(Number(step) * 100)}`).join(", ")
    : "";

const parseChaseSteps = (value, fallback = []) => {
  const parsed = String(value || "")
    .split(/[,\s/]+/)
    .map((item) => Number(item.trim().replace(/%$/, "")))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.min(1, Math.max(0, item > 1 ? item / 100 : item)));
  return parsed.length ? Array.from(new Set(parsed)).sort((a, b) => a - b) : fallback;
};

const formatContractLabel = (contract) => {
  const label = formatOptionContractLabel(asRecord(contract), {
    includeSymbol: false,
    fallback: "",
  });
  return label || MISSING_VALUE;
};

const signalOptionsActionColor = (status) => {
  if (status === "shadow_filled") return T.green;
  if (status === "manual_override" || status === "partial_shadow") return T.amber;
  if (status === "blocked" || status === "mismatch") return T.red;
  if (status === "closed") return T.textDim;
  return T.cyan;
};

const cockpitStageColor = (status) => {
  if (status === "healthy") return T.green;
  if (status === "running") return T.cyan;
  if (status === "attention" || status === "stale") return T.amber;
  if (status === "blocked") return T.red;
  return T.textDim;
};

const cockpitAttentionColor = (severity) => {
  if (severity === "critical") return T.red;
  if (severity === "warning") return T.amber;
  return T.cyan;
};

const signalOptionsRuleColor = (status) => {
  if (status === "fail") return T.red;
  if (status === "warning") return T.amber;
  return T.green;
};

const formatCockpitMetric = (metrics, key, formatter = (value) => value) =>
  Object.prototype.hasOwnProperty.call(asRecord(metrics), key)
    ? formatter(asRecord(metrics)[key])
    : MISSING_VALUE;

const shadowLinkSummary = (shadowLink) => {
  const link = asRecord(shadowLink);
  if (!Object.keys(link).length) return "No Shadow ledger link";
  const parts = [
    link.orderId ? "order linked" : null,
    link.fillId ? "fill linked" : null,
    link.positionId ? "position linked" : null,
    link.attributionStatus ? String(link.attributionStatus).replace(/_/g, " ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Shadow ledger link pending";
};

const signalActionLabel = (signal, action) => {
  const signalRecord = asRecord(signal);
  const actionRecord = asRecord(action);
  const direction = signalRecord.direction || actionRecord.signalDirection;
  const optionAction = actionRecord.optionAction;
  if (optionAction) return formatEnumLabel(optionAction).toUpperCase();
  if (direction === "sell") return "BUY PUT";
  if (direction === "buy") return "BUY CALL";
  return MISSING_VALUE;
};

const signalFreshnessLabel = (signal) => {
  const signalRecord = asRecord(signal);
  if (signalRecord.fresh === true) return "FRESH";
  if (signalRecord.fresh === false) return "STALE";
  return MISSING_VALUE;
};

const signalBarsSinceLabel = (signal) => {
  const barsSinceSignal = asRecord(signal).barsSinceSignal;
  return Number.isFinite(Number(barsSinceSignal))
    ? `${Number(barsSinceSignal)} bars`
    : MISSING_VALUE;
};

const signalFilterStateLabel = (signal) => {
  const filterState = asRecord(asRecord(signal).filterState);
  const entries = Object.entries(filterState)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 3)
    .map(([key, value]) => `${formatEnumLabel(key)} ${String(value)}`);
  return entries.length ? entries.join(" / ") : MISSING_VALUE;
};

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
  const algoTwoColumnTemplate = algoIsNarrow
    ? "minmax(0, 1fr)"
    : "minmax(320px, 0.95fr) minmax(420px, 1.35fr)";
  const algoCandidateGridTemplate = algoIsNarrow
    ? "minmax(0, 1fr)"
    : "minmax(280px, 0.95fr) minmax(360px, 1.25fr)";
  const algoProfileGridTemplate = algoIsPhone
    ? "minmax(0, 1fr)"
    : algoIsNarrow
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(3, minmax(0, 1fr))";
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const queryClient = useQueryClient();
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [symbolUniverseInput, setSymbolUniverseInput] = useState("");
  const [focusedDeploymentId, setFocusedDeploymentId] = useState(null);
  const [automationTab, setAutomationTab] = useState("Candidates");
  const [secondaryPanel, setSecondaryPanel] = useState(null);
  const [selectedPipelineStageId, setSelectedPipelineStageId] = useState("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [profileDraft, setProfileDraft] = useState(
    SIGNAL_OPTIONS_DEFAULT_PROFILE,
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
  const cockpit = cockpitQuery.data || null;
  const signalOptionsPerformance = signalOptionsPerformanceQuery.data || null;
  const signalOptionsState = signalOptionsStateQuery.data || null;
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
  const cockpitEntryGateRows = cockpitGateSummary.entryGateRows;
  const cockpitOptionChainRows = cockpitGateSummary.optionChainRows;
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
        return Object.keys(asRecord(candidate.action)).length > 0;
      }
      if (selectedPipelineStageId === "contract_selected") return hasContract;
      if (selectedPipelineStageId === "liquidity_risk_gate") {
        return (
          actionStatus === "blocked" ||
          candidate.status === "skipped" ||
          Object.keys(asRecord(candidate.liquidity)).length > 0
        );
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

  const profileNumberFields = [
    ["optionSelection", "minDte", "Min DTE", 1],
    ["optionSelection", "targetDte", "Target DTE", 1],
    ["optionSelection", "maxDte", "Max DTE", 1],
    ["riskCaps", "maxPremiumPerEntry", "Max premium", 25],
    ["riskCaps", "maxContracts", "Max contracts", 1],
    ["riskCaps", "maxOpenSymbols", "Max open symbols", 1],
    ["riskCaps", "maxDailyLoss", "Daily halt", 50],
    ["liquidityGate", "maxSpreadPctOfMid", "Max spread %", 1],
    ["liquidityGate", "minBid", "Min bid", 0.01],
    ["fillPolicy", "ttlSeconds", "Fill TTL seconds", 1],
    ["exitPolicy", "hardStopPct", "Hard stop %", 1],
    ["exitPolicy", "trailActivationPct", "Trail activates %", 5],
    ["exitPolicy", "minLockedGainPct", "Minimum locked gain %", 5],
    ["exitPolicy", "trailGivebackPct", "Trail giveback %", 5],
    ["exitPolicy", "tightenAtFiveXGivebackPct", "5x giveback %", 5],
    ["exitPolicy", "tightenAtTenXGivebackPct", "10x giveback %", 5],
  ];

  const profileBooleanFields = [
    ["optionSelection", "allowZeroDte", "Allow 0DTE"],
    ["liquidityGate", "requireBidAsk", "Require bid/ask"],
    ["liquidityGate", "requireFreshQuote", "Require fresh quote"],
    ["exitPolicy", "flipOnOppositeSignal", "Exit on opposite signal"],
  ];

  const compactButtonStyle = ({
    active = false,
    color = T.border,
    fill = false,
    disabled = false,
  } = {}) => ({
    padding: sp("6px 10px"),
    borderRadius: dim(4),
    border: `1px solid ${active ? color : T.border}`,
    background: active ? `${color}18` : T.bg0,
    color: active ? T.text : T.textSec,
    fontSize: fs(8),
    fontFamily: T.mono,
    fontWeight: 400,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.62 : 1,
    width: fill ? "100%" : "auto",
    whiteSpace: "nowrap",
  });

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
        padding: sp(algoIsPhone ? 6 : 12),
        display: "flex",
        flexDirection: "column",
        gap: sp(10),
        height: "100%",
        width: "100%",
        overflowY: "auto",
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
            borderRadius: dim(6),
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
                fontWeight: 400,
                fontFamily: T.display,
                color: T.amber,
                letterSpacing: "0.05em",
              }}
            >
              SHADOW SCANS WAITING FOR DATA
            </span>
            <span
              style={{
                fontSize: fs(9),
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
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
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
                borderRadius: dim(4),
                border: `1px solid ${T.amber}55`,
                background: `${T.amber}18`,
                color: T.amber,
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 400,
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
                fontSize: fs(8),
                color: bridgeLauncherError ? T.red : T.textDim,
                fontFamily: T.mono,
                lineHeight: 1.45,
                wordBreak: "break-word",
              }}
            >
              {bridgeLauncherError}
            </div>
          )}
        </div>
      )}

      <div
        data-testid="algo-cockpit"
        className="ra-panel-enter"
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp(algoIsPhone ? "9px 10px" : "12px 14px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
          minWidth: 0,
        }}
      >
        <div
          data-testid="algo-command-bar"
          style={{
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(260px, 0.95fr) minmax(240px, 0.7fr) minmax(420px, 1.35fr)",
            gap: sp(10),
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(7),
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: fs(13),
                  fontWeight: 400,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Execution Control Plane
              </span>
              <Badge color={T.cyan}>SHADOW</Badge>
              <Badge color={gatewayReady ? T.green : T.amber}>
                {gatewayReady ? "DATA READY" : "DATA BLOCKED"}
              </Badge>
              <Badge color={focusedDeployment?.enabled ? T.green : T.textDim}>
                {focusedDeployment?.enabled ? "ENABLED" : "PAUSED"}
              </Badge>
            </div>
            <div
              style={{
                color: T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
                marginTop: sp(3),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {focusedDeployment
                ? `${focusedDeployment.name} · ${String(focusedDeployment.mode || environment).toUpperCase()} · ${focusedDeployment.symbolUniverse.length} symbols`
                : "No deployment selected"}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: T.textMuted,
                fontFamily: T.mono,
                fontSize: fs(7),
                letterSpacing: "0.08em",
                marginBottom: sp(3),
              }}
            >
              ACTIVE DEPLOYMENT
            </div>
            {deployments.length ? (
              <select
                value={focusedDeployment?.id || ""}
                onChange={(event) => setFocusedDeploymentId(event.target.value)}
                style={{
                  width: "100%",
                  background: T.bg3,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(4),
                  color: T.text,
                  padding: sp("7px 9px"),
                  fontFamily: T.mono,
                  fontSize: fs(9),
                  outline: "none",
                }}
              >
                {deployments.map((deployment) => (
                  <option key={deployment.id} value={deployment.id}>
                    {deployment.name} · {String(deployment.mode || "").toUpperCase()} · {deployment.enabled ? "enabled" : "paused"}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: dim(4),
                  color: T.textDim,
                  fontFamily: T.mono,
                  fontSize: fs(9),
                  padding: sp("7px 9px"),
                }}
              >
                create from a promoted draft
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: sp(6),
              flexWrap: "wrap",
              justifyContent: algoIsNarrow ? "flex-start" : "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => refreshAlgoQueries()}
              disabled={deploymentsQuery.isFetching || cockpitQuery.isFetching}
              style={compactButtonStyle({
                disabled: deploymentsQuery.isFetching || cockpitQuery.isFetching,
              })}
            >
              REFRESH
            </button>
            <button
              type="button"
              onClick={() => focusedDeployment && handleToggleDeployment(focusedDeployment)}
              disabled={
                !focusedDeployment ||
                enableDeploymentMutation.isPending ||
                pauseDeploymentMutation.isPending ||
                gatewayBridgeLaunching
              }
              style={compactButtonStyle({
                active: Boolean(focusedDeployment?.enabled),
                color: focusedDeployment?.enabled ? T.amber : T.green,
                disabled:
                  !focusedDeployment ||
                  enableDeploymentMutation.isPending ||
                  pauseDeploymentMutation.isPending ||
                  gatewayBridgeLaunching,
              })}
            >
              {focusedDeployment?.enabled ? "PAUSE" : "ENABLE"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAutomationTab("Profile");
                setSecondaryPanel(null);
              }}
              disabled={!focusedDeployment}
              style={compactButtonStyle({
                active: automationTab === "Profile" && !secondaryPanel,
                color: T.amber,
                disabled: !focusedDeployment,
              })}
            >
              RISK/PROFILE
            </button>
            <button
              type="button"
              onClick={handleRunShadowScan}
              disabled={
                !focusedDeployment ||
                runShadowScanMutation.isPending ||
                gatewayBridgeLaunching
              }
              style={{
                ...compactButtonStyle({
                  disabled:
                    !focusedDeployment ||
                    runShadowScanMutation.isPending ||
                    gatewayBridgeLaunching,
                }),
                border: "none",
                background: !focusedDeployment
                  ? T.textMuted
                  : gatewayReady
                    ? T.cyan
                    : T.amber,
                color: "#031216",
              }}
            >
              {runShadowScanMutation.isPending
                ? "SCANNING..."
                : !gatewayReady
                  ? gatewayBridgeLaunching
                    ? "PREPARING..."
                    : "START DATA"
                  : "RUN SCAN"}
            </button>
            <button
              type="button"
              data-testid="algo-secondary-activity"
              onClick={() =>
                setSecondaryPanel(secondaryPanel === "activity" ? null : "activity")
              }
              style={compactButtonStyle({
                active: secondaryPanel === "activity",
                color: T.accent,
              })}
            >
              ACTIVITY {events.length}
            </button>
            <button
              type="button"
              data-testid="algo-secondary-drafts"
              onClick={() =>
                setSecondaryPanel(secondaryPanel === "drafts" ? null : "drafts")
              }
              style={compactButtonStyle({
                active: secondaryPanel === "drafts",
                color: T.accent,
              })}
            >
              DRAFTS {candidateDrafts.length}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(280px, 0.85fr) minmax(0, 1.4fr)",
            gap: sp(10),
            minWidth: 0,
          }}
        >
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("9px 10px"),
              minWidth: 0,
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
              <div>
                <div
                  style={{
                    color: T.text,
                    fontFamily: T.display,
                    fontSize: fs(11),
                    fontWeight: 400,
                  }}
                >
                  {deployments.length ? "Deployment Focus" : "Setup Shadow Deployment"}
                </div>
                <div
                  style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}
                >
                  {deployments.length
                    ? "select, enable, scan, inspect"
                    : "promoted draft -> shadow automation"}
                </div>
              </div>
              <Badge color={bridgeTone.color}>{bridgeTone.label.toUpperCase()}</Badge>
            </div>

            {deployments.length ? (
              <div style={{ display: "grid", gap: sp(7) }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: sp(6),
                  }}
                >
                  {[
                    ["Account", focusedDeployment?.providerAccountId || "shadow"],
                    [
                      "Last eval",
                      formatRelativeTimeShort(focusedDeployment?.lastEvaluatedAt),
                    ],
                    [
                      "Last signal",
                      formatRelativeTimeShort(focusedDeployment?.lastSignalAt),
                    ],
                    [
                      "Updated",
                      formatRelativeTimeShort(focusedDeployment?.updatedAt),
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        border: `1px solid ${T.border}`,
                        borderRadius: dim(4),
                        background: T.bg2,
                        padding: sp("6px 7px"),
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          color: T.textMuted,
                          fontFamily: T.mono,
                          fontSize: fs(7),
                          letterSpacing: "0.08em",
                        }}
                      >
                        {String(label).toUpperCase()}
                      </div>
                      <div
                        style={{
                          color: T.text,
                          fontFamily: T.mono,
                          fontSize: fs(9),
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
                <div style={{ display: "flex", gap: sp(5), flexWrap: "wrap" }}>
                  {deployments.slice(0, 4).map((deployment) => {
                    const active = focusedDeployment?.id === deployment.id;
                    const tone = deployment.enabled
                      ? T.green
                      : deployment.lastError
                        ? T.red
                        : T.textDim;
                    return (
                      <button
                        key={deployment.id}
                        type="button"
                        className={joinMotionClasses(
                          "ra-interactive",
                          active && "ra-focus-rail",
                        )}
                        onClick={() => setFocusedDeploymentId(deployment.id)}
                        style={compactButtonStyle({
                          active,
                          color: tone,
                        })}
                      >
                        {deployment.name}
                      </button>
                    );
                  })}
                </div>
                {focusedDeployment?.lastError && (
                  <div
                    style={{
                      color: T.red,
                      fontFamily: T.sans,
                      fontSize: fs(9),
                      lineHeight: 1.4,
                    }}
                  >
                    {focusedDeployment.lastError}
                  </div>
                )}
              </div>
            ) : candidateDrafts.length ? (
              <div style={{ display: "grid", gap: sp(7) }}>
                <select
                  value={selectedDraft?.id || ""}
                  onChange={(event) => setSelectedDraftId(event.target.value)}
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 9px"),
                    color: T.text,
                    fontSize: fs(9),
                    fontFamily: T.mono,
                    outline: "none",
                  }}
                >
                  {candidateDrafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.name} · {draft.mode} · {draft.symbolUniverse.length} syms
                    </option>
                  ))}
                </select>
                <input
                  value={deploymentName}
                  onChange={(event) => setDeploymentName(event.target.value)}
                  placeholder="Deployment name"
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 9px"),
                    color: T.text,
                    fontSize: fs(9),
                    fontFamily: T.sans,
                    outline: "none",
                  }}
                />
                <input
                  value={symbolUniverseInput}
                  onChange={(event) => setSymbolUniverseInput(event.target.value)}
                  placeholder="SPY, QQQ, NVDA"
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 9px"),
                    color: T.text,
                    fontSize: fs(9),
                    fontFamily: T.mono,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleCreateDeployment}
                  disabled={createDeploymentMutation.isPending}
                  style={{
                    ...compactButtonStyle({
                      fill: true,
                      disabled: createDeploymentMutation.isPending,
                    }),
                    border: "none",
                    background: T.accent,
                    color: "#fff",
                  }}
                >
                  {createDeploymentMutation.isPending
                    ? "CREATING..."
                    : "CREATE SHADOW DEPLOYMENT"}
                </button>
              </div>
            ) : (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: dim(5),
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  lineHeight: 1.45,
                  padding: sp("14px 10px"),
                }}
              >
                No promoted draft strategies are available yet. Promote a completed
                backtest run first, then return here to create a Shadow signal deployment.
              </div>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: algoMetricsGridTemplate,
              gap: sp(7),
              minWidth: 0,
            }}
          >
            {cockpitMetricCards.map((metric, index) => (
              <div
                key={metric.label}
                className="ra-row-enter"
                style={{
                  ...motionRowStyle(index, 12, 70),
                  ...motionVars({ accent: metric.color }),
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg0,
                  padding: sp("8px 9px"),
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    letterSpacing: "0.08em",
                  }}
                >
                  {metric.label.toUpperCase()}
                </div>
                <div
                  style={{
                    color: metric.color,
                    fontFamily: T.mono,
                    fontSize: fs(11),
                    fontWeight: 400,
                    marginTop: sp(3),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {metric.value}
                </div>
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    marginTop: sp(2),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {metric.detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          data-testid="algo-cockpit-diagnostics"
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: dim(5),
            background: T.bg0,
            padding: sp("9px 10px"),
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(180px, 0.7fr) repeat(3, minmax(0, 1fr))",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: T.text,
                fontFamily: T.display,
                fontSize: fs(11),
                fontWeight: 400,
              }}
            >
              Gate Summary
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: sp(5),
                marginTop: sp(7),
              }}
            >
              {[
                ["Fresh", cockpitSignalFreshness.fresh ?? 0, T.green],
                ["Stale", cockpitSignalFreshness.notFresh ?? 0, T.amber],
                ["Blocked", cockpitTradePath.blockedCandidates ?? 0, T.red],
                ["Filled", cockpitTradePath.shadowFilledCandidates ?? 0, T.green],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    background: T.bg2,
                    padding: sp("6px 7px"),
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: T.textMuted,
                      fontFamily: T.mono,
                      fontSize: fs(7),
                      letterSpacing: "0.08em",
                    }}
                  >
                    {String(label).toUpperCase()}
                  </div>
                  <div
                    style={{
                      color,
                      fontFamily: T.mono,
                      fontSize: fs(10),
                      marginTop: sp(2),
                    }}
                  >
                    {Number(value || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {[
            ["Skip Reasons", cockpitSkipReasonRows, T.red],
            ["Entry Gate", cockpitEntryGateRows, T.amber],
            ["Option Chain", cockpitOptionChainRows, T.cyan],
          ].map(([title, rows, color]) => (
            <div
              key={title}
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: dim(4),
                background: T.bg2,
                padding: sp("7px 8px"),
                minWidth: 0,
              }}
            >
              <div
                style={{
                  color,
                  fontFamily: T.mono,
                  fontSize: fs(7),
                  letterSpacing: "0.08em",
                  marginBottom: sp(6),
                }}
              >
                {String(title).toUpperCase()}
              </div>
              {rows.length ? (
                <div style={{ display: "grid", gap: sp(5), minWidth: 0 }}>
                  {rows.map(([label, count]) => (
                    <div
                      key={label}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        gap: sp(7),
                        alignItems: "center",
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          color: T.textSec,
                          fontFamily: T.mono,
                          fontSize: fs(8),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatEnumLabel(label)}
                      </span>
                      <span
                        style={{
                          color: T.text,
                          fontFamily: T.mono,
                          fontSize: fs(8),
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                  }}
                >
                  none
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          data-testid="algo-signal-options-performance"
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: dim(5),
            background: T.bg0,
            padding: sp("9px 10px"),
            display: "grid",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(8),
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: T.text,
                  fontFamily: T.display,
                  fontSize: fs(11),
                  fontWeight: 400,
                }}
              >
                Performance vs Rules
              </div>
              <div
                style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}
              >
                {signalOptionsPerformance
                  ? `${signalOptionsPerformance.range || "1M"} shadow automation`
                  : signalOptionsPerformanceQuery.isError
                    ? "performance unavailable"
                    : "loading performance"}
              </div>
            </div>
            <Badge
              color={
                signalOptionsRuleAdherence.some((rule) => asRecord(rule).status === "fail")
                  ? T.red
                  : signalOptionsRuleAdherence.some(
                      (rule) => asRecord(rule).status === "warning",
                    )
                    ? T.amber
                    : T.green
              }
            >
              {signalOptionsRuleAdherence.some((rule) => asRecord(rule).status === "fail")
                ? "RULE FAIL"
                : signalOptionsRuleAdherence.some(
                      (rule) => asRecord(rule).status === "warning",
                    )
                  ? "REVIEW"
                  : "RULES OK"}
            </Badge>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: algoIsPhone
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(4, minmax(0, 1fr))",
              gap: sp(6),
              minWidth: 0,
            }}
          >
            {signalOptionsPerformanceCards.map(([label, value, color]) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(4),
                  background: T.bg2,
                  padding: sp("6px 7px"),
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    letterSpacing: "0.08em",
                  }}
                >
                  {String(label).toUpperCase()}
                </div>
                <div
                  style={{
                    color,
                    fontFamily: T.mono,
                    fontSize: fs(9),
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: algoIsNarrow
                ? "minmax(0, 1fr)"
                : "minmax(0, 1.25fr) minmax(240px, 0.75fr)",
              gap: sp(8),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: sp(5),
                minWidth: 0,
              }}
            >
              {signalOptionsRuleAdherence.slice(0, 9).map((rule, index) => {
                const ruleRecord = asRecord(rule);
                const color = signalOptionsRuleColor(ruleRecord.status);
                return (
                  <div
                    key={ruleRecord.id || index}
                    style={{
                      display: "grid",
                      gridTemplateColumns: algoIsPhone
                        ? "minmax(0, 1fr)"
                        : "minmax(130px, 0.55fr) minmax(0, 1fr) minmax(52px, 0.2fr)",
                      gap: sp(7),
                      alignItems: "center",
                      border: `1px solid ${color}35`,
                      borderRadius: dim(4),
                      background: `${color}0d`,
                      padding: sp("6px 7px"),
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        color,
                        fontFamily: T.mono,
                        fontSize: fs(8),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {String(ruleRecord.label || ruleRecord.id || "Rule").toUpperCase()}
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.sans,
                        fontSize: fs(8),
                        lineHeight: 1.35,
                        minWidth: 0,
                      }}
                    >
                      {ruleRecord.detail || MISSING_VALUE}
                    </div>
                    <div
                      style={{
                        color,
                        fontFamily: T.mono,
                        fontSize: fs(8),
                        textAlign: algoIsPhone ? "left" : "right",
                      }}
                    >
                      {formatEnumLabel(ruleRecord.status || "pass")}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: dim(4),
                background: T.bg2,
                padding: sp("7px 8px"),
                minWidth: 0,
              }}
            >
              <div
                style={{
                  color: T.amber,
                  fontFamily: T.mono,
                  fontSize: fs(7),
                  letterSpacing: "0.08em",
                  marginBottom: sp(6),
                }}
              >
                TOP BLOCKERS
              </div>
              {signalOptionsTopBlockers.length ? (
                <div style={{ display: "grid", gap: sp(5), minWidth: 0 }}>
                  {signalOptionsTopBlockers.slice(0, 5).map((blocker, index) => {
                    const blockerRecord = asRecord(blocker);
                    return (
                      <div
                        key={blockerRecord.reason || index}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: sp(7),
                          alignItems: "center",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            color: T.textSec,
                            fontFamily: T.mono,
                            fontSize: fs(8),
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {blockerRecord.label || formatEnumLabel(blockerRecord.reason)}
                        </span>
                        <span
                          style={{
                            color: T.text,
                            fontFamily: T.mono,
                            fontSize: fs(8),
                          }}
                        >
                          {Number(blockerRecord.count || 0).toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                  }}
                >
                  none
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(0, 1.25fr) minmax(320px, 0.9fr)",
            gap: sp(10),
            minWidth: 0,
          }}
        >
          <div
            data-testid="algo-signal-action-panel"
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("9px 10px"),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                marginBottom: sp(8),
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    color: T.text,
                    fontFamily: T.display,
                    fontSize: fs(11),
                    fontWeight: 400,
                  }}
                >
                  Signal -&gt; Action
                </div>
                <div
                  style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}
                >
                  universe signal mapping and candidate queue
                </div>
              </div>
              <Badge color={T.cyan}>SHADOW ONLY</Badge>
            </div>

            {!visibleSignalRows.length ? (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: dim(5),
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  lineHeight: 1.45,
                  padding: sp("14px 10px"),
                }}
              >
                No RayReplica signal states are available for this deployment yet.
              </div>
            ) : (
              <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
                {visibleSignalRows.map((signal, index) => {
                  const signalRecord = asRecord(signal);
                  const linkedCandidate = signalOptionsCandidates.find(
                    (candidate) =>
                      asRecord(candidate.signal).signalKey &&
                      asRecord(candidate.signal).signalKey === signalRecord.signalKey,
                  );
                  const tone =
                    signalRecord.fresh === false
                      ? T.amber
                      : linkedCandidate
                        ? signalOptionsActionColor(
                            linkedCandidate.actionStatus || linkedCandidate.status,
                          )
                        : T.textDim;
                  return (
                    <div
                      key={
                        signalRecord.signalKey ||
                        `${signalRecord.symbol}:${signalRecord.timeframe}:${index}`
                      }
                      className="ra-row-enter"
                      style={{
                        ...motionRowStyle(index, 9, 60),
                        border: `1px solid ${tone}35`,
                        borderRadius: dim(5),
                        background: `${tone}10`,
                        padding: sp("8px 9px"),
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: algoIsPhone
                            ? "minmax(0, 1fr)"
                            : "minmax(90px, 0.7fr) minmax(110px, 0.85fr) minmax(110px, 0.85fr) minmax(130px, 1fr)",
                          gap: sp(7),
                          alignItems: "center",
                        }}
                      >
                        {[
                          [
                            "Signal",
                            `${signalRecord.symbol || MISSING_VALUE} ${signalRecord.direction || MISSING_VALUE}`,
                          ],
                          [
                            "Freshness",
                            `${signalFreshnessLabel(signalRecord)} · ${signalBarsSinceLabel(signalRecord)}`,
                          ],
                          [
                            "Action",
                            signalActionLabel(signalRecord, linkedCandidate?.action),
                          ],
                          [
                            "Outcome",
                            linkedCandidate
                              ? signalOptionsActionLabel(
                                  linkedCandidate.actionStatus || linkedCandidate.status,
                                )
                              : "Awaiting scan",
                          ],
                        ].map(([label, value]) => (
                          <div key={label} style={{ minWidth: 0 }}>
                            <div
                              style={{
                                color: T.textMuted,
                                fontFamily: T.mono,
                                fontSize: fs(7),
                                letterSpacing: "0.08em",
                              }}
                            >
                              {label.toUpperCase()}
                            </div>
                            <div
                              style={{
                                color: label === "Action" ? tone : T.text,
                                fontFamily: T.mono,
                                fontSize: fs(9),
                                fontWeight: 400,
                                marginTop: sp(3),
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("9px 10px"),
              minWidth: 0,
            }}
          >
            <div
              style={{
                color: T.text,
                fontFamily: T.display,
                fontSize: fs(11),
                fontWeight: 400,
                marginBottom: sp(8),
              }}
            >
              Selected Action
            </div>
            {selectedCandidate ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: algoIsPhone
                    ? "minmax(0, 1fr)"
                    : "repeat(2, minmax(0, 1fr))",
                  gap: sp(6),
                }}
              >
                {[
                  ["Signal", `${selectedCandidate.symbol} ${selectedCandidate.direction}`],
                  [
                    "Mapped to",
                    signalActionLabel(selectedCandidate.signal, selectedCandidate.action),
                  ],
                  ["Contract", formatContractLabel(selectedCandidate.selectedContract)],
                  [
                    "Limit",
                    formatMoney(asRecord(selectedCandidate.orderPlan).entryLimitPrice, 2),
                  ],
                  [
                    "Spread",
                    formatPct(asRecord(selectedCandidate.liquidity).spreadPctOfMid),
                  ],
                  ["Shadow", shadowLinkSummary(selectedCandidate.shadowLink)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(4),
                      background: T.bg2,
                      padding: sp("7px 8px"),
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        color: T.textMuted,
                        fontFamily: T.mono,
                        fontSize: fs(7),
                        letterSpacing: "0.08em",
                      }}
                    >
                      {String(label).toUpperCase()}
                    </div>
                    <div
                      style={{
                        color: T.text,
                        fontFamily: T.mono,
                        fontSize: fs(9),
                        marginTop: sp(3),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => handleOpenCandidateInTrade(selectedCandidate)}
                  disabled={
                    !onJumpToTradeCandidate ||
                    !asRecord(selectedCandidate.selectedContract).strike
                  }
                  style={{
                    ...compactButtonStyle({
                      fill: true,
                      disabled:
                        !onJumpToTradeCandidate ||
                        !asRecord(selectedCandidate.selectedContract).strike,
                    }),
                    gridColumn: "1 / -1",
                    color: T.text,
                    border: `1px solid ${T.accent}55`,
                    background: `${T.accent}16`,
                  }}
                >
                  INSPECT CONTRACT
                </button>
              </div>
            ) : (
              <div
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  lineHeight: 1.45,
                }}
              >
                Fresh RayReplica signals will appear here before scans resolve
                shadow option contracts.
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(0, 1.35fr) minmax(320px, 0.95fr)",
            gap: sp(10),
            minWidth: 0,
          }}
        >
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("9px 10px"),
              minWidth: 0,
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
              <div>
                <div
                  style={{
                    color: T.text,
                    fontFamily: T.display,
                    fontSize: fs(11),
                    fontWeight: 400,
                  }}
                >
                  Pipeline + Attention
                </div>
                <div
                  style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}
                >
                  scan -&gt; signal -&gt; action -&gt; contract -&gt; gate -&gt; shadow -&gt; exit
                </div>
              </div>
              <Badge
                color={
                  cockpitAttentionItems.some((item) => item.severity === "critical")
                    ? T.red
                    : cockpitAttentionItems.length
                      ? T.amber
                      : T.green
                }
              >
                {cockpitAttentionItems.length
                  ? `${cockpitAttentionItems.length} OPEN`
                  : "CLEAR"}
              </Badge>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPhone
                  ? "minmax(0, 1fr)"
                  : "repeat(auto-fit, minmax(92px, 1fr))",
                gap: sp(6),
              }}
            >
              {cockpitStageItems.map((stage, index) => {
                const color = cockpitStageColor(stage.status);
                const selected = selectedStage?.id === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    className="ra-row-enter"
                    onClick={() => setSelectedPipelineStageId(stage.id)}
                    style={{
                      ...motionRowStyle(index, 8, 60),
                      textAlign: "left",
                      border: `1px solid ${selected ? color : T.border}`,
                      borderRadius: dim(5),
                      background: selected ? `${color}14` : T.bg2,
                      padding: sp("7px 8px"),
                      cursor: "pointer",
                      minHeight: dim(72),
                    }}
                  >
                    <div
                      style={{
                        color: T.text,
                        fontFamily: T.sans,
                        fontSize: fs(8),
                        lineHeight: 1.2,
                        minHeight: dim(20),
                      }}
                    >
                      {stage.label}
                    </div>
                    <div
                      style={{
                        color,
                        fontFamily: T.mono,
                        fontSize: fs(12),
                        marginTop: sp(5),
                      }}
                    >
                      {stage.count}
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.mono,
                        fontSize: fs(7),
                        marginTop: sp(2),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatEnumLabel(stage.status)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPhone
                  ? "minmax(0, 1fr)"
                  : "minmax(0, 1fr) minmax(0, 1fr)",
                gap: sp(8),
                marginTop: sp(8),
              }}
            >
              <div
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg2,
                  padding: sp("7px 8px"),
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    letterSpacing: "0.08em",
                  }}
                >
                  SELECTED STAGE
                </div>
                <div
                  style={{
                    color: selectedStage
                      ? cockpitStageColor(selectedStage.status)
                      : T.textDim,
                    fontFamily: T.mono,
                    fontSize: fs(9),
                    marginTop: sp(3),
                  }}
                >
                  {selectedStage?.label || "No stage"}
                </div>
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.sans,
                    fontSize: fs(8),
                    lineHeight: 1.35,
                    marginTop: sp(3),
                  }}
                >
                  {selectedStage?.detail || "No timestamp"}
                </div>
              </div>
              <div
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg2,
                  padding: sp("7px 8px"),
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    letterSpacing: "0.08em",
                  }}
                >
                  TOP ATTENTION
                </div>
                {cockpitAttentionItems.length ? (
                  <>
                    <div
                      style={{
                        color: cockpitAttentionColor(cockpitAttentionItems[0].severity),
                        fontFamily: T.mono,
                        fontSize: fs(9),
                        marginTop: sp(3),
                      }}
                    >
                      {cockpitAttentionItems[0].symbol ||
                        formatEnumLabel(cockpitAttentionItems[0].stage)}
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.sans,
                        fontSize: fs(8),
                        lineHeight: 1.35,
                        marginTop: sp(3),
                      }}
                    >
                      {cockpitAttentionItems[0].summary}
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      color: T.textDim,
                      fontFamily: T.sans,
                      fontSize: fs(8),
                      lineHeight: 1.35,
                      marginTop: sp(3),
                    }}
                  >
                    No active blockers or drift detected.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("9px 10px"),
              minWidth: 0,
            }}
          >
            <div
              style={{
                color: T.text,
                fontFamily: T.display,
                fontSize: fs(11),
                fontWeight: 400,
                marginBottom: sp(8),
              }}
            >
              Risk + Source Backtest
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: sp(6),
              }}
            >
              {cockpitRiskCards.slice(0, 8).map(([label, value, color]) => (
                <div
                  key={label}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    background: T.bg2,
                    padding: sp("6px 7px"),
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: T.textMuted,
                      fontFamily: T.mono,
                      fontSize: fs(7),
                      letterSpacing: "0.08em",
                    }}
                  >
                    {String(label).toUpperCase()}
                  </div>
                  <div
                    style={{
                      color,
                      fontFamily: T.mono,
                      fontSize: fs(9),
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: sp(6),
                marginTop: sp(7),
              }}
            >
              {cockpitBacktestCards.slice(0, 4).map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    background: T.bg2,
                    padding: sp("6px 7px"),
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: T.textMuted,
                      fontFamily: T.mono,
                      fontSize: fs(7),
                      letterSpacing: "0.08em",
                    }}
                  >
                    {String(label).toUpperCase()}
                  </div>
                  <div
                    style={{
                      color: T.text,
                      fontFamily: T.mono,
                      fontSize: fs(9),
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
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: dim(5),
            background: T.bg0,
            padding: sp("9px 10px"),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: sp(6),
              flexWrap: "wrap",
              marginBottom: sp(8),
            }}
          >
            {["Candidates", "Positions", "Profile"].map((tab) => (
              <button
                key={tab}
                data-testid={`algo-signal-options-tab-${tab.toLowerCase()}`}
                type="button"
                onClick={() => {
                  setAutomationTab(tab);
                  setSecondaryPanel(null);
                }}
                style={compactButtonStyle({
                  active: automationTab === tab && !secondaryPanel,
                  color: T.accent,
                })}
              >
                {tab.toUpperCase()}
              </button>
            ))}
            <button
              data-testid="algo-signal-options-tab-events"
              type="button"
              onClick={() => setSecondaryPanel("activity")}
              style={compactButtonStyle({
                active: secondaryPanel === "activity",
                color: T.accent,
              })}
            >
              EVENTS
            </button>
          </div>

          {automationTab === "Candidates" && !secondaryPanel && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoCandidateGridTemplate,
                gap: sp(8),
                minWidth: 0,
              }}
            >
              <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
                {!displayedSignalOptionsCandidates.length ? (
                  <div
                    style={{
                      border: `1px dashed ${T.border}`,
                      borderRadius: dim(5),
                      color: T.textDim,
                      fontFamily: T.sans,
                      fontSize: fs(10),
                      lineHeight: 1.45,
                      padding: sp("14px 10px"),
                    }}
                  >
                    {selectedPipelineStageId === "all"
                      ? "No potential actions yet. Fresh RayReplica universe signals will appear here before scans resolve shadow option contracts."
                      : "No candidates match the selected pipeline stage."}
                  </div>
                ) : (
                  displayedSignalOptionsCandidates.slice(0, 6).map((candidate, index) => {
                    const selected = selectedCandidate?.id === candidate.id;
                    const tone = signalOptionsActionColor(
                      candidate.actionStatus || candidate.status,
                    );
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        className={joinMotionClasses(
                          "ra-row-enter",
                          "ra-interactive",
                          selected && "ra-focus-rail",
                        )}
                        onClick={() => setSelectedCandidateId(candidate.id)}
                        style={{
                          ...motionRowStyle(index, 10, 70),
                          ...motionVars({ accent: tone }),
                          textAlign: "left",
                          border: `1px solid ${selected ? tone : T.border}`,
                          borderRadius: dim(5),
                          background: selected ? `${tone}12` : T.bg2,
                          padding: sp("8px 9px"),
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: sp(8),
                          }}
                        >
                          <span
                            style={{
                              color: T.text,
                              fontFamily: T.mono,
                              fontSize: fs(9),
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {candidate.symbol}{" "}
                            {signalActionLabel(candidate.signal, candidate.action)}
                          </span>
                          <Badge color={tone}>
                            {signalOptionsActionLabel(
                              candidate.actionStatus || candidate.status,
                            ).toUpperCase()}
                          </Badge>
                        </div>
                        <div
                          style={{
                            color: T.textDim,
                            fontFamily: T.mono,
                            fontSize: fs(8),
                            marginTop: sp(3),
                          }}
                        >
                          {candidate.timeframe} · {candidate.direction} ·{" "}
                          {candidate.optionRight?.toUpperCase() || "OPTION"} ·{" "}
                          {formatRelativeTimeShort(candidate.signalAt)}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg2,
                  padding: sp("8px 9px"),
                  minWidth: 0,
                }}
              >
                {selectedCandidate ? (
                  <div style={{ display: "grid", gap: sp(6) }}>
                    <div
                      style={{
                        color: T.text,
                        fontFamily: T.display,
                        fontSize: fs(12),
                        fontWeight: 400,
                      }}
                    >
                      {selectedCandidate.symbol}{" "}
                      {selectedCandidate.direction?.toUpperCase()} Signal
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.mono,
                        fontSize: fs(8),
                        lineHeight: 1.35,
                      }}
                    >
                      {selectedCandidate.timeframe} · signal{" "}
                      {formatRelativeTimeShort(selectedCandidate.signalAt)} · spot{" "}
                      {formatPlainPrice(selectedCandidate.signalPrice, 2)} ·{" "}
                      {signalFreshnessLabel(selectedCandidate.signal)}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: algoIsPhone
                          ? "minmax(0, 1fr)"
                          : "repeat(2, minmax(0, 1fr))",
                        gap: sp(6),
                      }}
                    >
                      {[
                        ["Filter", signalFilterStateLabel(selectedCandidate.signal)],
                        ["Destination", "Shadow account"],
                        ["Bid / Ask", `${formatMoney(asRecord(selectedCandidate.liquidity).bid, 2)} / ${formatMoney(asRecord(selectedCandidate.liquidity).ask, 2)}`],
                        ["Premium", formatMoney(asRecord(selectedCandidate.orderPlan).premiumAtRisk)],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          style={{
                            border: `1px solid ${T.border}`,
                            borderRadius: dim(4),
                            background: T.bg0,
                            padding: sp("6px 7px"),
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              color: T.textMuted,
                              fontFamily: T.mono,
                              fontSize: fs(7),
                              letterSpacing: "0.08em",
                            }}
                          >
                            {String(label).toUpperCase()}
                          </div>
                          <div
                            style={{
                              color: T.text,
                              fontFamily: T.mono,
                              fontSize: fs(9),
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
                    {selectedCandidate.reason && (
                      <div
                        style={{
                          color: T.amber,
                          fontFamily: T.sans,
                          fontSize: fs(9),
                          lineHeight: 1.4,
                        }}
                      >
                        {formatEnumLabel(selectedCandidate.reason)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      color: T.textDim,
                      fontFamily: T.sans,
                      fontSize: fs(10),
                      lineHeight: 1.45,
                    }}
                  >
                    Select a candidate to inspect its contract, fill simulation,
                    liquidity gate, Shadow ledger link, and signal mapping.
                  </div>
                )}
              </div>
            </div>
          )}

          {automationTab === "Positions" && !secondaryPanel && (
            <div style={{ display: "grid", gap: sp(7) }}>
              {!signalOptionsPositions.length ? (
                <div
                  style={{
                    border: `1px dashed ${T.border}`,
                    borderRadius: dim(5),
                    color: T.textDim,
                    fontFamily: T.sans,
                    fontSize: fs(10),
                    lineHeight: 1.45,
                    padding: sp("14px 10px"),
                  }}
                >
                  No open shadow option positions. Filled signal-options entries
                  will appear here with marks, stops, and premium exposure.
                </div>
              ) : (
                signalOptionsPositions.map((position, index) => {
                  const contract = asRecord(position.selectedContract);
                  const multiplier = numberFrom(contract.multiplier, 100);
                  const mark = numberFrom(position.lastMarkPrice, NaN);
                  const entry = numberFrom(position.entryPrice, NaN);
                  const quantity = numberFrom(position.quantity, 0);
                  const unrealized =
                    Number.isFinite(mark) && Number.isFinite(entry)
                      ? (mark - entry) * quantity * multiplier
                      : null;
                  return (
                    <div
                      key={position.id || position.candidateId}
                      className="ra-row-enter"
                      style={{
                        ...motionRowStyle(index, 10, 70),
                        display: "grid",
                        gridTemplateColumns: algoIsPhone
                          ? "minmax(0, 1fr)"
                          : "minmax(160px, 1fr) repeat(4, minmax(82px, 0.7fr))",
                        gap: sp(8),
                        alignItems: "center",
                        border: `1px solid ${T.border}`,
                        borderRadius: dim(5),
                        background: T.bg2,
                        padding: sp("8px 9px"),
                        minWidth: 0,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            color: T.text,
                            fontFamily: T.mono,
                            fontSize: fs(9),
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {position.symbol} {formatContractLabel(contract)}
                        </div>
                        <div
                          style={{
                            color: T.textDim,
                            fontFamily: T.mono,
                            fontSize: fs(8),
                            marginTop: sp(2),
                          }}
                        >
                          {position.timeframe} · opened{" "}
                          {formatRelativeTimeShort(position.openedAt)}
                        </div>
                      </div>
                      {[
                        ["Qty", quantity],
                        ["Entry", formatPlainPrice(entry, 2)],
                        ["Mark", formatPlainPrice(mark, 2)],
                        ["P&L", formatMoney(unrealized, 2)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <div
                            style={{
                              color: T.textMuted,
                              fontFamily: T.mono,
                              fontSize: fs(7),
                              letterSpacing: "0.08em",
                            }}
                          >
                            {label.toUpperCase()}
                          </div>
                          <div
                            style={{
                              color:
                                label === "P&L" && Number(unrealized) < 0
                                  ? T.red
                                  : label === "P&L" && Number(unrealized) > 0
                                    ? T.green
                                    : T.text,
                              fontFamily: T.mono,
                              fontSize: fs(9),
                              marginTop: sp(2),
                            }}
                          >
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {automationTab === "Profile" && !secondaryPanel && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoProfileGridTemplate,
                gap: sp(8),
              }}
            >
              <div
                style={{
                  gridColumn: "1 / -1",
                  border: `1px solid ${T.amber}35`,
                  borderRadius: dim(5),
                  background: `${T.amber}0d`,
                  padding: sp("8px 9px"),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: sp(10),
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: T.amber,
                      fontFamily: T.mono,
                      fontSize: fs(8),
                      letterSpacing: "0.08em",
                    }}
                  >
                    EXPANDED CAPACITY
                  </div>
                  <div
                    style={{
                      color: T.textDim,
                      fontFamily: T.mono,
                      fontSize: fs(8),
                      marginTop: sp(2),
                    }}
                  >
                    {SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxOpenSymbols} symbols ·{" "}
                    {formatMoney(SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxDailyLoss)} halt
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="signal-options-expanded-capacity"
                  onClick={handleApplyExpandedCapacity}
                  disabled={!focusedDeployment || updateProfileMutation.isPending}
                  style={{
                    ...compactButtonStyle({
                      disabled: !focusedDeployment || updateProfileMutation.isPending,
                    }),
                    border: `1px solid ${T.amber}55`,
                    background: `${T.amber}18`,
                    color: T.amber,
                  }}
                >
                  {updateProfileMutation.isPending ? "SAVING..." : "APPLY"}
                </button>
              </div>
              {profileNumberFields.map(([section, key, label, step]) => (
                <label
                  key={`${section}.${key}`}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(5),
                    background: T.bg2,
                    padding: sp("8px 9px"),
                    display: "flex",
                    flexDirection: "column",
                    gap: sp(5),
                  }}
                >
                  <span
                    style={{
                      color: T.textMuted,
                      fontFamily: T.mono,
                      fontSize: fs(7),
                      letterSpacing: "0.08em",
                    }}
                  >
                    {label.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step={step}
                    value={profileDraft?.[section]?.[key] ?? ""}
                    onChange={(event) =>
                      patchProfileDraft(
                        section,
                        key,
                        numberFrom(event.target.value, 0),
                      )
                    }
                    style={{
                      background: T.bg3,
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(4),
                      color: T.text,
                      padding: sp("6px 8px"),
                      fontFamily: T.mono,
                      fontSize: fs(9),
                      outline: "none",
                    }}
                  />
                </label>
              ))}
              {[
                ["optionSelection", "callStrikeSlot", "Call strike slot"],
                ["optionSelection", "putStrikeSlot", "Put strike slot"],
              ].map(([section, key, label]) => (
                <label
                  key={`${section}.${key}`}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(5),
                    background: T.bg2,
                    padding: sp("8px 9px"),
                    display: "flex",
                    flexDirection: "column",
                    gap: sp(5),
                  }}
                >
                  <span
                    style={{
                      color: T.textMuted,
                      fontFamily: T.mono,
                      fontSize: fs(7),
                      letterSpacing: "0.08em",
                    }}
                  >
                    {label.toUpperCase()}
                  </span>
                  <select
                    value={profileDraft?.[section]?.[key] ?? ""}
                    onChange={(event) =>
                      patchProfileDraft(section, key, Number(event.target.value))
                    }
                    style={{
                      background: T.bg3,
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(4),
                      color: T.text,
                      padding: sp("6px 8px"),
                      fontFamily: T.mono,
                      fontSize: fs(9),
                      outline: "none",
                    }}
                  >
                    {SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg2,
                  padding: sp("8px 9px"),
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(5),
                }}
              >
                <span
                  style={{
                    color: T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    letterSpacing: "0.08em",
                  }}
                >
                  BEAR ADX MIN
                </span>
                <input
                  type="number"
                  step={1}
                  value={
                    profileDraft?.entryGate?.bearishRegime?.minAdx ??
                    SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.bearishRegime.minAdx
                  }
                  onChange={(event) =>
                    patchProfileDraftNested(
                      "entryGate",
                      "bearishRegime",
                      "minAdx",
                      numberFrom(event.target.value, 0),
                    )
                  }
                  style={{
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    color: T.text,
                    padding: sp("6px 8px"),
                    fontFamily: T.mono,
                    fontSize: fs(9),
                    outline: "none",
                  }}
                />
              </label>
              {profileBooleanFields.map(([section, key, label]) => (
                <label
                  key={`${section}.${key}`}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(5),
                    background: T.bg2,
                    padding: sp("8px 9px"),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(10),
                  }}
                >
                  <span
                    style={{
                      color: T.textSec,
                      fontFamily: T.mono,
                      fontSize: fs(8),
                    }}
                  >
                    {label.toUpperCase()}
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(profileDraft?.[section]?.[key])}
                    onChange={(event) =>
                      patchProfileDraft(section, key, event.target.checked)
                    }
                  />
                </label>
              ))}
              {[
                ["enabled", "Bear gate enabled"],
                ["rejectFullyBullishMtf", "Reject bullish MTF puts"],
              ].map(([key, label]) => (
                <label
                  key={`entryGate.bearishRegime.${key}`}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(5),
                    background: T.bg2,
                    padding: sp("8px 9px"),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(10),
                  }}
                >
                  <span
                    style={{
                      color: T.textSec,
                      fontFamily: T.mono,
                      fontSize: fs(8),
                    }}
                  >
                    {label.toUpperCase()}
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(
                      profileDraft?.entryGate?.bearishRegime?.[key],
                    )}
                    onChange={(event) =>
                      patchProfileDraftNested(
                        "entryGate",
                        "bearishRegime",
                        key,
                        event.target.checked,
                      )
                    }
                  />
                </label>
              ))}
              <label
                style={{
                  gridColumn: "1 / -1",
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg2,
                  padding: sp("8px 9px"),
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(5),
                }}
              >
                <span
                  style={{
                    color: T.textMuted,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    letterSpacing: "0.08em",
                  }}
                >
                  CHASE LADDER %
                </span>
                <input
                  value={formatChaseSteps(profileDraft?.fillPolicy?.chaseSteps)}
                  onChange={(event) =>
                    patchProfileDraft(
                      "fillPolicy",
                      "chaseSteps",
                      parseChaseSteps(
                        event.target.value,
                        profileDraft?.fillPolicy?.chaseSteps || [],
                      ),
                    )
                  }
                  style={{
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    color: T.text,
                    padding: sp("6px 8px"),
                    fontFamily: T.mono,
                    fontSize: fs(9),
                    outline: "none",
                  }}
                />
              </label>
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: sp(10),
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                  }}
                >
                  Premium {formatMoney(signalOptionsProfile.riskCaps.maxPremiumPerEntry)} ·
                  spread {formatPct(signalOptionsProfile.liquidityGate.maxSpreadPctOfMid, 0)}
                </div>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={!focusedDeployment || updateProfileMutation.isPending}
                  style={{
                    ...compactButtonStyle({
                      disabled: !focusedDeployment || updateProfileMutation.isPending,
                    }),
                    border: "none",
                    background: T.green,
                    color: "#fff",
                  }}
                >
                  {updateProfileMutation.isPending ? "SAVING..." : "SAVE PROFILE"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>


      {secondaryPanel === "activity" && (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          flex: "0 1 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: sp(8),
            marginBottom: sp(8),
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                fontFamily: T.display,
                color: T.text,
              }}
            >
              Execution Events
            </div>
            <div
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              {focusedDeployment
                ? `filtered to ${focusedDeployment.name}`
                : "latest automation events"}
            </div>
          </div>
          <span
            style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
          >
            {events.length} rows
          </span>
        </div>

        {!events.length ? (
          <div
            style={{
              padding: sp("18px 10px"),
              border: `1px dashed ${T.border}`,
              borderRadius: dim(5),
              fontSize: fs(10),
              color: T.textDim,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            No execution events have been recorded yet.
          </div>
        ) : (
          events.map((event, index) => (
            <div
              key={event.id}
              className="ra-row-enter"
              style={{
                ...motionRowStyle(index, 10, 140),
                display: "grid",
                gridTemplateColumns: "64px 132px 1fr 88px",
                gap: sp(8),
                alignItems: "start",
                padding: sp("8px 0"),
                borderBottom: `1px solid ${T.border}08`,
                fontSize: fs(9),
              }}
            >
              <span style={{ color: T.textDim, fontFamily: T.mono }}>
                {formatAppTimeForPreferences(event.occurredAt, userPreferences)}
              </span>
              <span
                style={{ color: T.accent, fontFamily: T.mono, fontWeight: 400 }}
              >
                {formatEnumLabel(event.eventType)}
              </span>
              <span
                style={{
                  color: T.textSec,
                  fontFamily: T.sans,
                  lineHeight: 1.4,
                }}
              >
                {event.summary}
              </span>
              <span
                style={{
                  color: event.symbol ? T.text : T.textDim,
                  fontFamily: T.mono,
                  textAlign: "right",
                }}
              >
                {event.symbol || event.providerAccountId || "system"}
              </span>
            </div>
          ))
        )}
      </div>
      )}

      {secondaryPanel === "drafts" && (
        <AlgoDraftStrategiesPanel
          theme={T}
          scale={{ fs, sp, dim }}
          isVisible={isVisible && secondaryPanel === "drafts"}
        />
      )}
    </div>
  );
};

export default AlgoScreen;
