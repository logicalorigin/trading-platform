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
  RADII,
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
import {
  buildAttentionStream,
  buildCockpitGateSummary,
  isDiagRowsHealthy,
  isGateSummaryHealthy,
} from "./algoCockpitDiagnosticsModel";
import { TabBar } from "../components/ui/tabs.jsx";
import { SectionHeader } from "../components/ui/SectionHeader.jsx";
import { AlgoStatusBar } from "./algo/AlgoStatusBar.jsx";
import { DiagPanel } from "./algo/DiagPanel.jsx";
import { ProfileSection } from "./algo/ProfileSection.jsx";
import { KpiTile } from "./algo/KpiTile.jsx";
import { HeroKpi } from "./algo/HeroKpi.jsx";
import { AttentionList } from "./algo/AttentionList.jsx";
import { PipelineStrip } from "./algo/PipelineStrip.jsx";

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
    mtfAlignment: {
      enabled: true,
      requiredCount: 2,
    },
    blockedPutSymbols: [
      "SQQQ",
      "SH",
      "PSQ",
      "DOG",
      "SDS",
      "QID",
      "TWM",
      "SPXU",
      "SDOW",
      "TZA",
    ],
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
    hardStopPct: -40,
    trailActivationPct: 40,
    minLockedGainPct: 10,
    trailGivebackPct: 25,
    tightenAtFiveXGivebackPct: 35,
    tightenAtTenXGivebackPct: 25,
    flipOnOppositeSignal: true,
  },
};

const SIGNAL_OPTIONS_EXPANDED_CAPACITY = {
  maxOpenSymbols: 5,
  maxDailyLoss: 1000,
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
      mtfAlignment: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.mtfAlignment,
        ...asRecord(asRecord(rawProfile.entryGate).mtfAlignment),
      },
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
  const [primaryTab, setPrimaryTab] = useState("now");
  const [diagExpansion, setDiagExpansion] = useState({});
  const [profileSectionOpen, setProfileSectionOpen] = useState("risk");
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
    color = T.accent,
    fill = false,
    disabled = false,
  } = {}) => ({
    padding: sp("6px 12px"),
    borderRadius: dim(RADII.pill),
    border: "none",
    background: active ? `${color}18` : T.bg2,
    color: active ? color : T.text,
    fontSize: fs(9),
    fontFamily: T.sans,
    fontWeight: active ? 600 : 500,
    letterSpacing: "0.02em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
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
        padding: sp(algoIsPhone ? "12px 12px 16px" : "20px 28px 24px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(algoIsPhone ? 10 : 14),
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
                fontWeight: 400,
                fontFamily: T.sans,
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
                border: `1px solid ${T.amber}55`,
                background: `${T.amber}18`,
                color: T.amber,
                fontFamily: T.sans,
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
      <TabBar
        dataTestId="algo-primary-tabs"
        value={primaryTab}
        onChange={setPrimaryTab}
        dense={algoIsPhone}
        sticky={algoIsPhone}
        tabs={[
          { id: "now", label: "Now" },
          {
            id: "signals",
            label: "Signals",
            badge:
              Number(cockpitTradePath?.blockedCandidates) > 0
                ? cockpitTradePath.blockedCandidates
                : null,
          },
          { id: "positions", label: "Positions" },
          { id: "diagnostics", label: "Diagnostics" },
          { id: "profile", label: "Profile" },
          {
            id: "events",
            label: "Events",
            badge: events.length || null,
          },
          {
            id: "drafts",
            label: "Drafts",
            badge: candidateDrafts.length || null,
          },
        ]}
      />
      <div
        key={primaryTab}
        data-testid="algo-tab-content"
        data-tab={primaryTab}
        className="ra-panel-enter"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
          minWidth: 0,
        }}
      >
        {primaryTab === "now" && (() => {
          if (!deployments.length) {
            return (
              <div
                style={{
                  border: "none",
                  borderRadius: dim(RADII.md),
                  background: T.bg2,
                  padding: sp("12px 14px"),
                  minWidth: 0,
                }}
              >
                <SectionHeader title="Setup Shadow Deployment" />
                {candidateDrafts.length ? (
                  <div style={{ display: "grid", gap: sp(7) }}>
                    <select
                      value={selectedDraft?.id || ""}
                      onChange={(event) => setSelectedDraftId(event.target.value)}
                      style={{
                        width: "100%",
                        background: T.bg1,
                        border: "none",
                        borderRadius: dim(RADII.md),
                        padding: sp("8px 10px"),
                        color: T.text,
                        fontSize: fs(10),
                        fontFamily: T.sans,
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
                        background: T.bg1,
                        border: "none",
                        borderRadius: dim(RADII.md),
                        padding: sp("8px 10px"),
                        color: T.text,
                        fontSize: fs(10),
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
                        background: T.bg1,
                        border: "none",
                        borderRadius: dim(RADII.md),
                        padding: sp("8px 10px"),
                        color: T.text,
                        fontSize: fs(10),
                        fontFamily: T.sans,
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
                      borderRadius: dim(RADII.sm),
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
            );
          }
          const freshSignals = Number(cockpitSignalFreshness.fresh ?? 0);
          const staleSignals = Number(cockpitSignalFreshness.notFresh ?? 0);
          const activePositions = Number(
            cockpitKpis.openPositions ?? signalOptionsPositions.length,
          );
          const candidatesCount = Number(
            cockpitKpis.candidates ?? signalOptionsCandidates.length,
          );
          const blockedCount = Number(cockpitTradePath.blockedCandidates ?? 0);
          const filledCount = Number(cockpitTradePath.shadowFilledCandidates ?? 0);
          const todayPnl = Number(cockpitKpis.todayPnl ?? 0);
          const realizedPnl = Number(cockpitKpis.dailyRealizedPnl ?? 0);
          const unrealizedPnl = Number(cockpitKpis.openUnrealizedPnl ?? 0);
          const winRate = signalOptionsPerformanceSummary.winRatePercent;
          const ruleFail = signalOptionsRuleAdherence.some(
            (rule) => asRecord(rule).status === "fail",
          );
          const ruleWarn = signalOptionsRuleAdherence.some(
            (rule) => asRecord(rule).status === "warning",
          );
          const ruleFailCount = signalOptionsRuleAdherence.filter(
            (rule) => asRecord(rule).status === "fail",
          ).length;
          const ruleWarnCount = signalOptionsRuleAdherence.filter(
            (rule) => asRecord(rule).status === "warning",
          ).length;
          return (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(8),
                minWidth: 0,
              }}
            >
              <HeroKpi
                pnlValue={todayPnl}
                pnlValueDisplay={formatMoney(todayPnl, 2)}
                pnlPercentDisplay={
                  Number.isFinite(realizedPnl)
                    ? `R ${formatMoney(realizedPnl, 0)} · U ${formatMoney(unrealizedPnl, 0)}`
                    : "—"
                }
                wins={
                  Number.isFinite(winRate)
                    ? Math.round((filledCount * winRate) / 100)
                    : 0
                }
                losses={
                  Number.isFinite(winRate)
                    ? Math.max(
                        0,
                        filledCount -
                          Math.round((filledCount * winRate) / 100),
                      )
                    : filledCount
                }
                activePositions={activePositions}
                unrealizedDisplay={formatMoney(unrealizedPnl, 0)}
                freshSignals={freshSignals}
                freshSignalsDetail={
                  staleSignals > 0 ? `${staleSignals} stale` : null
                }
                rulesState={
                  ruleFail ? "FAIL" : ruleWarn ? "REVIEW" : "OK"
                }
                rulesDetail={
                  ruleFail
                    ? `${ruleFailCount} failing`
                    : ruleWarn
                      ? `${ruleWarnCount} review`
                      : "all green"
                }
                candidates={candidatesCount}
                candidatesDetail={
                  blockedCount > 0 ? `${blockedCount} blocked` : null
                }
                todayFired={filledCount}
                todayFiredDetail={
                  Number.isFinite(winRate)
                    ? `${formatPct(winRate, 0)} win`
                    : null
                }
                narrow={algoIsPhone || algoIsNarrow}
              />
            </div>
          );
        })()}

        {primaryTab === "diagnostics" && (() => {
          const diagPanels = [
            { key: "skip-categories", title: "Skip Categories", rows: cockpitSkipCategoryRows, color: T.red },
            { key: "skip-reasons", title: "Skip Reasons", rows: cockpitSkipReasonRows, color: T.red },
            { key: "readiness", title: "Readiness", rows: cockpitReadinessRows, color: T.amber },
            { key: "mark-health", title: "Mark Health", rows: cockpitMarkHealthRows, color: T.cyan },
            { key: "lifecycle", title: "Lifecycle", rows: cockpitLifecycleRows, color: T.green },
            { key: "entry-gate", title: "Entry Gate", rows: cockpitEntryGateRows, color: T.amber },
            { key: "option-chain", title: "Option Chain", rows: cockpitOptionChainRows, color: T.cyan },
          ];
          const gateHealthy = isGateSummaryHealthy(cockpitTradePath);
          const resolveExpanded = (panel) => {
            const healthy = isDiagRowsHealthy(panel.rows);
            const override = diagExpansion[panel.key];
            return typeof override === "boolean" ? override : !healthy;
          };
          const expandedPanels = diagPanels.filter((panel) => resolveExpanded(panel));
          const collapsedPanels = diagPanels.filter((panel) => !resolveExpanded(panel));
          return (
            <div
              data-testid="algo-cockpit-diagnostics"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(8),
                minWidth: 0,
              }}
            >
              <SectionHeader
                title="Diagnostics"
                right={
                  <div style={{ display: "flex", gap: sp(5) }}>
                    <button
                      type="button"
                      data-testid="algo-diag-expand-all"
                      onClick={() =>
                        setDiagExpansion(
                          Object.fromEntries(diagPanels.map((p) => [p.key, true])),
                        )
                      }
                      style={{
                        padding: sp("4px 10px"),
                        fontSize: fs(9),
                        fontFamily: T.sans,
                        fontWeight: 500,
                        color: T.textSec,
                        background: T.bg2,
                        border: "none",
                        borderRadius: dim(RADII.pill),
                        cursor: "pointer",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      data-testid="algo-diag-collapse-all"
                      onClick={() =>
                        setDiagExpansion(
                          Object.fromEntries(diagPanels.map((p) => [p.key, false])),
                        )
                      }
                      style={{
                        padding: sp("4px 10px"),
                        fontSize: fs(9),
                        fontFamily: T.sans,
                        fontWeight: 500,
                        color: T.textSec,
                        background: T.bg2,
                        border: "none",
                        borderRadius: dim(RADII.pill),
                        cursor: "pointer",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Collapse all
                    </button>
                  </div>
                }
              />

              <div
                data-testid="algo-diag-gate-summary"
                style={{
                  border: "none",
                  borderRadius: dim(RADII.md),
                  background: T.bg1,
                  padding: sp("8px 10px"),
                  display: "grid",
                  gridTemplateColumns: algoIsPhone
                    ? "repeat(2, minmax(0, 1fr))"
                    : "repeat(6, minmax(0, 1fr))",
                  gap: sp(6),
                }}
              >
                {[
                  ["Fresh", cockpitSignalFreshness.fresh ?? 0, T.green],
                  ["Stale", cockpitSignalFreshness.notFresh ?? 0, T.amber],
                  ["Blocked", cockpitTradePath.blockedCandidates ?? 0, T.red],
                  ["Filled", cockpitTradePath.shadowFilledCandidates ?? 0, T.green],
                  ["Marks", cockpitTradePath.markEvents ?? 0, T.cyan],
                  ["Gateway", cockpitTradePath.gatewayBlocks ?? 0, T.amber],
                ].map(([label, value, color]) => {
                  const isAlarm =
                    (label === "Blocked" || label === "Gateway") &&
                    Number(value) > 0;
                  return (
                    <div key={label} style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: T.textMuted,
                          fontFamily: T.sans,
                          fontSize: fs(7),
                          letterSpacing: "0.08em",
                        }}
                      >
                        {String(label).toUpperCase()}
                      </div>
                      <div
                        style={{
                          color: isAlarm
                            ? color
                            : Number(value) > 0 && label !== "Stale"
                              ? color
                              : T.text,
                          fontFamily: T.sans,
                          fontSize: fs(11),
                          marginTop: sp(2),
                        }}
                      >
                        {Number(value || 0).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {expandedPanels.length ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: algoIsPhone
                      ? "1fr"
                      : algoIsNarrow
                        ? "repeat(2, minmax(0, 1fr))"
                        : "repeat(3, minmax(0, 1fr))",
                    gap: sp(8),
                    minWidth: 0,
                  }}
                >
                  {expandedPanels.map((panel) => (
                    <DiagPanel
                      key={panel.key}
                      title={panel.title}
                      color={panel.color}
                      rows={panel.rows}
                      healthy={isDiagRowsHealthy(panel.rows)}
                      expanded={true}
                      onToggle={() =>
                        setDiagExpansion((current) => ({
                          ...current,
                          [panel.key]: false,
                        }))
                      }
                    />
                  ))}
                </div>
              ) : null}

              {collapsedPanels.length ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: sp(5),
                    paddingTop: sp(2),
                  }}
                >
                  <span
                    style={{
                      fontFamily: T.sans,
                      fontSize: fs(7),
                      color: T.textMuted,
                      letterSpacing: "0.08em",
                      alignSelf: "center",
                      marginRight: sp(2),
                    }}
                  >
                    {gateHealthy && expandedPanels.length === 0
                      ? "ALL HEALTHY · "
                      : "HEALTHY · "}
                  </span>
                  {collapsedPanels.map((panel) => (
                    <DiagPanel
                      key={panel.key}
                      title={panel.title}
                      color={panel.color}
                      rows={panel.rows}
                      healthy={isDiagRowsHealthy(panel.rows)}
                      expanded={false}
                      onToggle={() =>
                        setDiagExpansion((current) => ({
                          ...current,
                          [panel.key]: true,
                        }))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })()}

        {primaryTab === "signals" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoDetailGridTemplate,
            gap: sp(10),
            minWidth: 0,
          }}
        >
          <div
            data-testid="algo-signal-action-panel"
            style={{
              border: "none",
              borderRadius: dim(RADII.md),
              background: T.bg1,
              padding: sp("9px 10px"),
              minWidth: 0,
            }}
          >
            <SectionHeader
              title={<>Signal -&gt; Action</>}
              subtitle="universe signal mapping and candidate queue"
              right={<Badge color={T.cyan}>SHADOW ONLY</Badge>}
            />

            {!visibleSignalRows.length ? (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: dim(RADII.sm),
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
                        borderRadius: dim(RADII.sm),
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
                                fontFamily: T.sans,
                                fontSize: fs(7),
                                letterSpacing: "0.08em",
                              }}
                            >
                              {label.toUpperCase()}
                            </div>
                            <div
                              style={{
                                color: label === "Action" ? tone : T.text,
                                fontFamily: T.sans,
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
              border: "none",
              borderRadius: dim(RADII.md),
              background: T.bg1,
              padding: sp("9px 10px"),
              minWidth: 0,
            }}
          >
            <SectionHeader title="Selected Action" />
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
                      border: "none",
                      borderRadius: dim(RADII.md),
                      background: T.bg2,
                      padding: sp("7px 8px"),
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        color: T.textMuted,
                        fontFamily: T.sans,
                        fontSize: fs(7),
                        letterSpacing: "0.08em",
                      }}
                    >
                      {String(label).toUpperCase()}
                    </div>
                    <div
                      style={{
                        color: T.text,
                        fontFamily: T.sans,
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
        )}

        {primaryTab === "now" && (() => {
          const attentionStream = buildAttentionStream({
            attentionItems: cockpitAttentionItems,
            ruleAdherence: signalOptionsRuleAdherence,
            gatewayReady,
            gatewayBlocks: cockpitTradePath.gatewayBlocks,
          });
          const openCount = attentionStream.length;
          const criticalCount = attentionStream.filter(
            (item) => item.severity === "critical",
          ).length;
          return (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPhone
                  ? "minmax(0, 1fr)"
                  : "minmax(0, 1.6fr) minmax(0, 1fr)",
                gap: sp(8),
                minWidth: 0,
              }}
            >
              <div
                style={{
                  border: "none",
                  borderRadius: dim(RADII.md),
                  background: T.bg1,
                  padding: sp("9px 10px"),
                  minWidth: 0,
                }}
              >
                <SectionHeader
                  title="Pipeline"
                  right={
                    <span
                      style={{
                        color: T.textMuted,
                        fontFamily: T.sans,
                        fontSize: fs(9),
                        letterSpacing: "0.04em",
                      }}
                    >
                      scan → signal → action → contract → gate → shadow → exit
                    </span>
                  }
                />
                <PipelineStrip
                  stages={cockpitStageItems}
                  selectedStageId={selectedStage?.id}
                  onSelectStage={(id) => setSelectedPipelineStageId(id)}
                  narrow={algoIsPhone}
                />
                <div
                  style={{
                    marginTop: sp(8),
                    border: "none",
                    borderRadius: dim(RADII.md),
                    background: T.bg2,
                    padding: sp("7px 9px"),
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: T.textMuted,
                      fontFamily: T.sans,
                      fontSize: fs(7),
                      letterSpacing: "0.08em",
                    }}
                  >
                    SELECTED STAGE
                  </div>
                  <div
                    style={{
                      color: T.text,
                      fontFamily: T.sans,
                      fontSize: fs(10),
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
                      marginTop: sp(2),
                    }}
                  >
                    {selectedStage?.detail || "No timestamp"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  border: "none",
                  borderRadius: dim(RADII.md),
                  background: T.bg1,
                  padding: sp("9px 10px"),
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(6),
                }}
              >
                <SectionHeader
                  title="Attention"
                  spacing="none"
                  right={
                    <Badge
                      color={
                        criticalCount > 0
                          ? T.red
                          : openCount > 0
                            ? T.amber
                            : T.green
                      }
                    >
                      {openCount ? `${openCount} OPEN` : "CLEAR"}
                    </Badge>
                  }
                />
                <AttentionList items={attentionStream} />
              </div>
            </div>
          );
        })()}

        {primaryTab === "now" && (() => {
          const recentSignals = signalOptionsSignals.slice(0, 5);
          return (
            <div
              data-testid="algo-now-recent-signals"
              style={{
                border: "none",
                borderRadius: dim(RADII.md),
                background: T.bg1,
                padding: sp("9px 10px"),
                minWidth: 0,
              }}
            >
              <SectionHeader
                title="Recent signal mapping"
                right={
                  <button
                    type="button"
                    onClick={() => setPrimaryTab("signals")}
                    style={{
                      padding: sp("3px 8px"),
                      fontSize: fs(9),
                      fontFamily: T.sans,
                      fontWeight: 500,
                      color: T.accent,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      letterSpacing: "0.02em",
                    }}
                  >
                    see all in Signals →
                  </button>
                }
              />
              {recentSignals.length ? (
                <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
                  {recentSignals.map((signal, index) => {
                    const symbol = String(
                      signal?.symbol || signal?.ticker || "—",
                    ).toUpperCase();
                    const direction =
                      signal?.direction === "short" ||
                      signal?.direction === "bearish"
                        ? "short"
                        : "long";
                    const score =
                      Number.isFinite(Number(signal?.score)) ||
                      Number.isFinite(Number(signal?.confidence))
                        ? Number(signal?.score ?? signal?.confidence)
                        : null;
                    const action = signalActionLabel(
                      signal,
                      signal?.action || signal?.mappedAction,
                    );
                    const freshness = signalFreshnessLabel(signal);
                    const tone =
                      freshness === "fresh"
                        ? T.green
                        : freshness === "stale"
                          ? T.amber
                          : T.textDim;
                    return (
                      <div
                        key={signal?.id || `${symbol}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: algoIsPhone
                            ? "minmax(0, 1fr) auto"
                            : "60px minmax(0, 1fr) minmax(0, 2fr) auto",
                          gap: sp(8),
                          alignItems: "center",
                          padding: sp("3px 0"),
                          borderBottom:
                            index < recentSignals.length - 1
                              ? `1px solid ${T.border}`
                              : "none",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            color: T.textMuted,
                            fontFamily: T.sans,
                            fontSize: fs(8),
                          }}
                        >
                          {symbol}
                        </span>
                        {!algoIsPhone && (
                          <span
                            style={{
                              color: T.textSec,
                              fontFamily: T.sans,
                              fontSize: fs(8),
                              letterSpacing: "0.04em",
                            }}
                          >
                            {direction === "short" ? "▼ short" : "▲ long"}
                            {score != null ? ` ${score.toFixed(2)}` : ""}
                          </span>
                        )}
                        {!algoIsPhone && (
                          <span
                            style={{
                              color: T.text,
                              fontFamily: T.sans,
                              fontSize: fs(8),
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            → {action}
                          </span>
                        )}
                        <span
                          style={{
                            color: tone,
                            fontFamily: T.sans,
                            fontSize: fs(8),
                            letterSpacing: "0.04em",
                            textAlign: "right",
                          }}
                        >
                          {freshness}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.sans,
                    fontSize: fs(9),
                    padding: sp("8px 0"),
                  }}
                >
                  No signals yet — fresh universe signals will appear here as
                  the algo evaluates.
                </div>
              )}
            </div>
          );
        })()}

        {(primaryTab === "signals" ||
          primaryTab === "positions" ||
          primaryTab === "profile") && (
        <div
          style={{
            border: "none",
            borderRadius: dim(RADII.md),
            background: T.bg1,
            padding: sp("9px 10px"),
            minWidth: 0,
          }}
        >
          {primaryTab === "signals" && (
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
                      borderRadius: dim(RADII.sm),
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
                          borderRadius: dim(RADII.sm),
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
                              fontFamily: T.sans,
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
                            fontFamily: T.sans,
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
                  border: "none",
                  borderRadius: dim(RADII.md),
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
                        fontFamily: T.sans,
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
                        fontFamily: T.sans,
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
                            border: "none",
                            borderRadius: dim(RADII.md),
                            background: T.bg1,
                            padding: sp("6px 7px"),
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              color: T.textMuted,
                              fontFamily: T.sans,
                              fontSize: fs(7),
                              letterSpacing: "0.08em",
                            }}
                          >
                            {String(label).toUpperCase()}
                          </div>
                          <div
                            style={{
                              color: T.text,
                              fontFamily: T.sans,
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

          {primaryTab === "positions" && (
            <div style={{ display: "grid", gap: sp(7) }}>
              {!signalOptionsPositions.length ? (
                <div
                  style={{
                    border: `1px dashed ${T.border}`,
                    borderRadius: dim(RADII.sm),
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
                        border: "none",
                        borderRadius: dim(RADII.md),
                        background: T.bg2,
                        padding: sp("8px 9px"),
                        minWidth: 0,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            color: T.text,
                            fontFamily: T.sans,
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
                            fontFamily: T.sans,
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
                              fontFamily: T.sans,
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
                              fontFamily: T.sans,
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

          {primaryTab === "profile" && (() => {
            const numberFieldStyle = {
              border: "none",
              borderRadius: dim(RADII.md),
              background: T.bg2,
              padding: sp("7px 9px"),
              display: "flex",
              flexDirection: "column",
              gap: sp(4),
            };
            const labelTextStyle = {
              color: T.textMuted,
              fontFamily: T.sans,
              fontSize: fs(7),
              letterSpacing: "0.08em",
            };
            const inputStyle = {
              background: T.bg3,
              border: "none",
              borderRadius: dim(3),
              color: T.text,
              padding: sp("5px 7px"),
              fontFamily: T.sans,
              fontSize: fs(9),
              outline: "none",
            };
            const renderNumberField = (section, key, label, step) => (
              <label key={`${section}.${key}`} style={numberFieldStyle}>
                <span style={labelTextStyle}>{label.toUpperCase()}</span>
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
                  style={inputStyle}
                />
              </label>
            );
            const renderBoolean = (checked, onChange, label, key) => (
              <label
                key={key}
                style={{
                  border: "none",
                  borderRadius: dim(RADII.md),
                  background: T.bg2,
                  padding: sp("7px 9px"),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: sp(10),
                }}
              >
                <span
                  style={{
                    color: T.textSec,
                    fontFamily: T.sans,
                    fontSize: fs(8),
                  }}
                >
                  {label.toUpperCase()}
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(checked)}
                  onChange={(event) => onChange(event.target.checked)}
                />
              </label>
            );
            const gridStyle = {
              display: "grid",
              gridTemplateColumns: algoIsPhone
                ? "1fr"
                : "repeat(auto-fit, minmax(140px, 1fr))",
              gap: sp(6),
              minWidth: 0,
            };
            const numberByKey = (section, key) =>
              profileNumberFields.find(
                ([s, k]) => s === section && k === key,
              );
            const callSlot = SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.find(
              (option) =>
                option.value === profileDraft?.optionSelection?.callStrikeSlot,
            );
            const putSlot = SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.find(
              (option) =>
                option.value === profileDraft?.optionSelection?.putStrikeSlot,
            );
            const riskSummary = `${formatMoney(profileDraft?.riskCaps?.maxPremiumPerEntry)}/entry · ${profileDraft?.riskCaps?.maxOpenSymbols ?? "?"} sym · ${formatMoney(profileDraft?.riskCaps?.maxDailyLoss)} halt`;
            const gatesSummary = `bear ADX ${profileDraft?.entryGate?.bearishRegime?.minAdx ?? "?"} · ${profileDraft?.entryGate?.bearishRegime?.enabled ? "bear on" : "bear off"}`;
            const strikesSummary = `${profileDraft?.optionSelection?.minDte ?? 0}-${profileDraft?.optionSelection?.maxDte ?? 0} DTE · call ${callSlot?.label || "?"} · put ${putSlot?.label || "?"}`;
            const fillsSummary = `${formatPct(profileDraft?.liquidityGate?.maxSpreadPctOfMid, 0)} spread · ${profileDraft?.fillPolicy?.ttlSeconds ?? "?"}s · chase ${formatChaseSteps(profileDraft?.fillPolicy?.chaseSteps)}`;
            const exitsSummary = `stop ${profileDraft?.exitPolicy?.hardStopPct ?? "?"}% · trail ${profileDraft?.exitPolicy?.trailActivationPct ?? "?"}/${profileDraft?.exitPolicy?.trailGivebackPct ?? "?"}`;
            const toggleSection = (id) =>
              setProfileSectionOpen((current) => (current === id ? null : id));
            return (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(7),
                }}
              >
                <div
                  data-testid="algo-profile-capacity-banner"
                  style={{
                    border: `1px solid ${T.amber}35`,
                    borderRadius: dim(RADII.sm),
                    background: `${T.amber}0d`,
                    padding: sp("8px 10px"),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(10),
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: T.amber,
                        fontFamily: T.sans,
                        fontSize: fs(8),
                        letterSpacing: "0.08em",
                      }}
                    >
                      EXPANDED CAPACITY
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.sans,
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
                    disabled={
                      !focusedDeployment || updateProfileMutation.isPending
                    }
                    style={{
                      ...compactButtonStyle({
                        disabled:
                          !focusedDeployment ||
                          updateProfileMutation.isPending,
                      }),
                      border: `1px solid ${T.amber}55`,
                      background: `${T.amber}18`,
                      color: T.amber,
                    }}
                  >
                    {updateProfileMutation.isPending ? "SAVING..." : "APPLY"}
                  </button>
                </div>

                <ProfileSection
                  id="risk"
                  title="Risk caps"
                  summary={riskSummary}
                  expanded={profileSectionOpen === "risk"}
                  onToggle={() => toggleSection("risk")}
                >
                  <div style={gridStyle}>
                    {numberByKey("riskCaps", "maxPremiumPerEntry") &&
                      renderNumberField(...numberByKey("riskCaps", "maxPremiumPerEntry"))}
                    {numberByKey("riskCaps", "maxContracts") &&
                      renderNumberField(...numberByKey("riskCaps", "maxContracts"))}
                    {numberByKey("riskCaps", "maxOpenSymbols") &&
                      renderNumberField(...numberByKey("riskCaps", "maxOpenSymbols"))}
                    {numberByKey("riskCaps", "maxDailyLoss") &&
                      renderNumberField(...numberByKey("riskCaps", "maxDailyLoss"))}
                  </div>
                </ProfileSection>

                <ProfileSection
                  id="gates"
                  title="Signal gates"
                  summary={gatesSummary}
                  expanded={profileSectionOpen === "gates"}
                  onToggle={() => toggleSection("gates")}
                >
                  <div style={gridStyle}>
                    <label style={numberFieldStyle}>
                      <span style={labelTextStyle}>BEAR ADX MIN</span>
                      <input
                        type="number"
                        step={1}
                        value={
                          profileDraft?.entryGate?.bearishRegime?.minAdx ??
                          SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.bearishRegime
                            .minAdx
                        }
                        onChange={(event) =>
                          patchProfileDraftNested(
                            "entryGate",
                            "bearishRegime",
                            "minAdx",
                            numberFrom(event.target.value, 0),
                          )
                        }
                        style={inputStyle}
                      />
                    </label>
                    {renderBoolean(
                      profileDraft?.entryGate?.bearishRegime?.enabled,
                      (value) =>
                        patchProfileDraftNested(
                          "entryGate",
                          "bearishRegime",
                          "enabled",
                          value,
                        ),
                      "Bear gate enabled",
                      "entryGate.bearishRegime.enabled",
                    )}
                    {renderBoolean(
                      profileDraft?.entryGate?.bearishRegime
                        ?.rejectFullyBullishMtf,
                      (value) =>
                        patchProfileDraftNested(
                          "entryGate",
                          "bearishRegime",
                          "rejectFullyBullishMtf",
                          value,
                        ),
                      "Reject bullish MTF puts",
                      "entryGate.bearishRegime.rejectFullyBullishMtf",
                    )}
                  </div>
                </ProfileSection>

                <ProfileSection
                  id="strikes"
                  title="Strike slots"
                  summary={strikesSummary}
                  expanded={profileSectionOpen === "strikes"}
                  onToggle={() => toggleSection("strikes")}
                >
                  <div style={gridStyle}>
                    {numberByKey("optionSelection", "minDte") &&
                      renderNumberField(...numberByKey("optionSelection", "minDte"))}
                    {numberByKey("optionSelection", "targetDte") &&
                      renderNumberField(...numberByKey("optionSelection", "targetDte"))}
                    {numberByKey("optionSelection", "maxDte") &&
                      renderNumberField(...numberByKey("optionSelection", "maxDte"))}
                    {[
                      ["optionSelection", "callStrikeSlot", "Call strike slot"],
                      ["optionSelection", "putStrikeSlot", "Put strike slot"],
                    ].map(([section, key, label]) => (
                      <label key={`${section}.${key}`} style={numberFieldStyle}>
                        <span style={labelTextStyle}>{label.toUpperCase()}</span>
                        <select
                          value={profileDraft?.[section]?.[key] ?? ""}
                          onChange={(event) =>
                            patchProfileDraft(
                              section,
                              key,
                              Number(event.target.value),
                            )
                          }
                          style={inputStyle}
                        >
                          {SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    {renderBoolean(
                      profileDraft?.optionSelection?.allowZeroDte,
                      (value) =>
                        patchProfileDraft("optionSelection", "allowZeroDte", value),
                      "Allow 0DTE",
                      "optionSelection.allowZeroDte",
                    )}
                  </div>
                </ProfileSection>

                <ProfileSection
                  id="fills"
                  title="Fills (limit · spread · chase)"
                  summary={fillsSummary}
                  expanded={profileSectionOpen === "fills"}
                  onToggle={() => toggleSection("fills")}
                >
                  <div style={gridStyle}>
                    {numberByKey("liquidityGate", "maxSpreadPctOfMid") &&
                      renderNumberField(
                        ...numberByKey("liquidityGate", "maxSpreadPctOfMid"),
                      )}
                    {numberByKey("liquidityGate", "minBid") &&
                      renderNumberField(...numberByKey("liquidityGate", "minBid"))}
                    {numberByKey("fillPolicy", "ttlSeconds") &&
                      renderNumberField(...numberByKey("fillPolicy", "ttlSeconds"))}
                    {renderBoolean(
                      profileDraft?.liquidityGate?.requireBidAsk,
                      (value) =>
                        patchProfileDraft("liquidityGate", "requireBidAsk", value),
                      "Require bid/ask",
                      "liquidityGate.requireBidAsk",
                    )}
                    {renderBoolean(
                      profileDraft?.liquidityGate?.requireFreshQuote,
                      (value) =>
                        patchProfileDraft(
                          "liquidityGate",
                          "requireFreshQuote",
                          value,
                        ),
                      "Require fresh quote",
                      "liquidityGate.requireFreshQuote",
                    )}
                  </div>
                  <label
                    style={{ ...numberFieldStyle, gridColumn: "1 / -1" }}
                  >
                    <span style={labelTextStyle}>CHASE LADDER %</span>
                    <input
                      value={formatChaseSteps(
                        profileDraft?.fillPolicy?.chaseSteps,
                      )}
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
                      style={inputStyle}
                    />
                  </label>
                </ProfileSection>

                <ProfileSection
                  id="exits"
                  title="Exits"
                  summary={exitsSummary}
                  expanded={profileSectionOpen === "exits"}
                  onToggle={() => toggleSection("exits")}
                >
                  <div style={gridStyle}>
                    {numberByKey("exitPolicy", "hardStopPct") &&
                      renderNumberField(...numberByKey("exitPolicy", "hardStopPct"))}
                    {numberByKey("exitPolicy", "trailActivationPct") &&
                      renderNumberField(
                        ...numberByKey("exitPolicy", "trailActivationPct"),
                      )}
                    {numberByKey("exitPolicy", "minLockedGainPct") &&
                      renderNumberField(
                        ...numberByKey("exitPolicy", "minLockedGainPct"),
                      )}
                    {numberByKey("exitPolicy", "trailGivebackPct") &&
                      renderNumberField(
                        ...numberByKey("exitPolicy", "trailGivebackPct"),
                      )}
                    {numberByKey("exitPolicy", "tightenAtFiveXGivebackPct") &&
                      renderNumberField(
                        ...numberByKey("exitPolicy", "tightenAtFiveXGivebackPct"),
                      )}
                    {numberByKey("exitPolicy", "tightenAtTenXGivebackPct") &&
                      renderNumberField(
                        ...numberByKey("exitPolicy", "tightenAtTenXGivebackPct"),
                      )}
                    {renderBoolean(
                      profileDraft?.exitPolicy?.flipOnOppositeSignal,
                      (value) =>
                        patchProfileDraft(
                          "exitPolicy",
                          "flipOnOppositeSignal",
                          value,
                        ),
                      "Exit on opposite signal",
                      "exitPolicy.flipOnOppositeSignal",
                    )}
                  </div>
                </ProfileSection>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: sp(10),
                    flexWrap: "wrap",
                    marginTop: sp(4),
                  }}
                >
                  <div
                    style={{
                      color: T.textDim,
                      fontFamily: T.sans,
                      fontSize: fs(8),
                    }}
                  >
                    Premium {formatMoney(signalOptionsProfile.riskCaps.maxPremiumPerEntry)} ·
                    spread {formatPct(signalOptionsProfile.liquidityGate.maxSpreadPctOfMid, 0)}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={
                      !focusedDeployment || updateProfileMutation.isPending
                    }
                    style={{
                      ...compactButtonStyle({
                        disabled:
                          !focusedDeployment ||
                          updateProfileMutation.isPending,
                      }),
                      border: "none",
                      background: T.green,
                      color: "#fff",
                    }}
                  >
                    {updateProfileMutation.isPending
                      ? "SAVING..."
                      : "SAVE PROFILE"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
        )}
      </div>


      {primaryTab === "events" && (
      <div
        style={{
          background: T.bg2,
          border: "none",
          borderRadius: dim(RADII.sm),
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
                fontFamily: T.sans,
                color: T.text,
              }}
            >
              Execution Events
            </div>
            <div
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.sans }}
            >
              {focusedDeployment
                ? `filtered to ${focusedDeployment.name}`
                : "latest automation events"}
            </div>
          </div>
          <span
            style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.sans }}
          >
            {events.length} rows
          </span>
        </div>

        {!events.length ? (
          <div
            style={{
              padding: sp("18px 10px"),
              border: `1px dashed ${T.border}`,
              borderRadius: dim(RADII.sm),
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
                gridTemplateColumns: `${dim(64)}px ${dim(132)}px 1fr ${dim(88)}px`,
                gap: sp(8),
                alignItems: "start",
                padding: sp("8px 0"),
                borderBottom: `1px solid ${T.border}08`,
                fontSize: fs(9),
              }}
            >
              <span style={{ color: T.textDim, fontFamily: T.sans }}>
                {formatAppTimeForPreferences(event.occurredAt, userPreferences)}
              </span>
              <span
                style={{ color: T.accent, fontFamily: T.sans, fontWeight: 400 }}
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
                  fontFamily: T.sans,
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

      {primaryTab === "drafts" && (
        <AlgoDraftStrategiesPanel
          theme={T}
          scale={{ fs, sp, dim }}
          isVisible={isVisible && primaryTab === "drafts"}
        />
      )}
    </div>
    </div>
  );
};

export default AlgoScreen;
