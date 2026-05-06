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
  useCreateAlgoDeployment,
  useEnableAlgoDeployment,
  useGetAlgoDeploymentCockpit,
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

const SIGNAL_OPTIONS_TABS = ["Candidates", "Positions", "Profile", "Events"];

const SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS = [
  { value: 0, label: "Lower -2" },
  { value: 1, label: "Lower -1" },
  { value: 2, label: "ATM lower" },
  { value: 3, label: "ATM upper" },
  { value: 4, label: "Upper +1" },
  { value: 5, label: "Upper +2" },
];

const SIGNAL_OPTIONS_ACTION_LABELS = {
  candidate: "Candidate",
  blocked: "Blocked",
  shadow_filled: "Shadow Filled",
  partial_shadow: "Partial Shadow",
  manual_override: "Manual Override",
  live_previewed: "Live Previewed",
  live_submitted: "Live Submitted",
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

const formatDurationMs = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return MISSING_VALUE;
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

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
  if (status === "shadow_filled" || status === "live_submitted") return T.green;
  if (status === "manual_override" || status === "partial_shadow") return T.amber;
  if (status === "blocked" || status === "mismatch") return T.red;
  if (status === "closed") return T.textDim;
  if (status === "live_previewed") return T.purple;
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
  const [selectedPipelineStageId, setSelectedPipelineStageId] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
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
    { mode: environment },
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
  const cockpit = cockpitQuery.data || null;
  const signalOptionsState = signalOptionsStateQuery.data || null;
  const signalOptionsProfile =
    signalOptionsState?.profile || SIGNAL_OPTIONS_DEFAULT_PROFILE;
  const signalOptionsCandidates =
    cockpit?.candidates || signalOptionsState?.candidates || [];
  const signalOptionsPositions =
    cockpit?.activePositions || signalOptionsState?.activePositions || [];
  const signalOptionsEvents =
    cockpit?.events || signalOptionsState?.events || [];
  const cockpitFleet = cockpit?.fleet || null;
  const cockpitReadiness = cockpit?.readiness || null;
  const cockpitKpis = asRecord(cockpit?.kpis);
  const cockpitPipelineStages = cockpit?.pipelineStages || [];
  const cockpitAttentionItems = cockpit?.attentionItems || [];
  const cockpitSourceBacktest = cockpit?.sourceBacktest || null;
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
  const filteredSignalOptionsEvents = useMemo(() => {
    if (eventFilter === "all") return signalOptionsEvents;
    return signalOptionsEvents.filter((event) => {
      const type = String(event.eventType || "");
      if (eventFilter === "blockers") {
        return type.includes("skipped") || type.includes("blocked");
      }
      if (eventFilter === "fills") return type.includes("entry");
      if (eventFilter === "exits") return type.includes("exit");
      if (eventFilter === "profile") return type.includes("profile");
      if (eventFilter === "gateway") return type.includes("gateway");
      return true;
    });
  }, [eventFilter, signalOptionsEvents]);
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
        title: "IBKR not configured",
        body: "Configure the IB Gateway bridge before starting automation.",
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
        title: "IBKR not configured",
        body: "Broker connectivity must be configured before deploying an algorithm.",
      });
      return;
    }

    if (!gatewayReady) {
      toast.push({
        kind: "warn",
        title: "Gateway bridge required",
        body: "Start the IB Gateway bridge before creating an executable deployment.",
      });
      handleStartGatewayBridge();
      return;
    }

    if (!activeAccountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    createDeploymentMutation.mutate({
      data: {
        strategyId: selectedDraft.id,
        name:
          deploymentName.trim() ||
          `${selectedDraft.name} ${environment.toUpperCase()}`,
        providerAccountId: activeAccountId,
        mode: environment,
        symbolUniverse: parseSymbolUniverseInput(symbolUniverseInput),
        config: {
          sourceDraftId: selectedDraft.id,
          sourceRunId: selectedDraft.runId,
          sourceStudyId: selectedDraft.studyId,
          promotedAt: selectedDraft.promotedAt,
          signalOptions: mergeSignalOptionsProfile(selectedDraft.config),
        },
      },
    });
  };

  const handleToggleDeployment = (deployment) => {
    if (!deployment.enabled && !gatewayReady) {
      toast.push({
        kind: "warn",
        title: "Gateway bridge required",
        body: "Start the IB Gateway bridge before enabling an algo deployment.",
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
        title: "Gateway bridge required",
        body: "Start the IB Gateway bridge before running a signal-options scan.",
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

  const handleSaveProfile = () => {
    if (!focusedDeployment?.id) {
      return;
    }
    updateProfileMutation.mutate({
      deploymentId: focusedDeployment.id,
      data: profileDraft,
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
              ALGO DEPLOYMENTS BLOCKED
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
              {gatewayBridgeLaunching ? "PREPARING..." : "START BRIDGE"}
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
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("12px 14px"),
        }}
      >
        <div
          style={{
            fontSize: fs(12),
            fontWeight: 400,
            fontFamily: T.display,
            color: T.text,
            marginBottom: 10,
          }}
        >
          Execution Control Plane
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoMetricsGridTemplate,
            gap: sp(8),
          }}
        >
          {[
            {
              label: "Promoted Drafts",
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
                ? `${cockpitFleet?.enabledDeployments ?? enabledDeployments.length} enabled · ${cockpitFleet?.activeBlockers ?? 0} blockers`
                : "none created",
              color:
                Number(cockpitFleet?.activeBlockers) > 0
                  ? T.red
                  : deployments.length
                    ? T.green
                    : T.textDim,
            },
            {
              label: "Bridge",
              value: cockpitReadiness?.ready
                ? "READY"
                : bridgeTone.label.toUpperCase(),
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
              value: latestEvent
                ? formatEnumLabel(latestEvent.eventType)
                : "NONE",
              detail: latestEvent
                ? formatRelativeTimeShort(latestEvent.occurredAt)
                : "no execution events yet",
              color: latestEvent ? T.cyan : T.textDim,
            },
          ].map((metric, index) => (
            <div
              key={metric.label}
              className="ra-row-enter"
              style={{
                ...motionRowStyle(index, 18, 90),
                ...motionVars({ accent: metric.color }),
                padding: sp("10px 12px"),
                borderRadius: dim(6),
                background: T.bg0,
                border: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(4),
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    width: dim(6),
                    height: dim(6),
                    borderRadius: "50%",
                    background: metric.color,
                  }}
                />
                <span
                  style={{
                    fontSize: fs(9),
                    fontWeight: 400,
                    fontFamily: T.sans,
                    color: T.text,
                  }}
                >
                  {metric.label}
                </span>
              </div>
              <div
                style={{
                  fontSize: fs(11),
                  fontWeight: 400,
                  fontFamily: T.mono,
                  color: metric.color,
                  marginBottom: 3,
                }}
              >
                {metric.value}
              </div>
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {metric.detail}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: algoTwoColumnTemplate,
          gap: sp(10),
          minWidth: 0,
        }}
      >
        <div
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: dim(6),
            padding: sp("12px 14px"),
            display: "flex",
            flexDirection: "column",
            gap: sp(8),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: sp(8),
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
                Create Deployment
              </div>
              <div
                style={{
                  fontSize: fs(9),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Promoted strategy -&gt; IBKR execution account
              </div>
            </div>
            <Badge
              color={
                brokerAuthenticated
                  ? T.green
                  : brokerConfigured
                    ? T.amber
                    : T.textDim
              }
            >
              {bridgeTone.label.toUpperCase()}
            </Badge>
          </div>

          {!candidateDrafts.length ? (
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
              No promoted draft strategies are available yet. Promote a
              completed backtest run first, then return here to create an
              execution deployment.
            </div>
          ) : (
            <>
              <div>
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  PROMOTED STRATEGY
                </div>
                <select
                  value={selectedDraft?.id || ""}
                  onChange={(event) => setSelectedDraftId(event.target.value)}
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 10px"),
                    color: T.text,
                    fontSize: fs(10),
                    fontFamily: T.mono,
                    fontWeight: 400,
                    outline: "none",
                  }}
                >
                  {candidateDrafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.name} · {draft.mode} ·{" "}
                      {draft.symbolUniverse.length} syms
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  DEPLOYMENT NAME
                </div>
                <input
                  value={deploymentName}
                  onChange={(event) => setDeploymentName(event.target.value)}
                  placeholder="Deployment name"
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 10px"),
                    color: T.text,
                    fontSize: fs(10),
                    fontFamily: T.sans,
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  SYMBOL UNIVERSE
                </div>
                <input
                  value={symbolUniverseInput}
                  onChange={(event) =>
                    setSymbolUniverseInput(event.target.value)
                  }
                  placeholder="SPY, QQQ, NVDA"
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 10px"),
                    color: T.text,
                    fontSize: fs(10),
                    fontFamily: T.mono,
                    outline: "none",
                  }}
                />
              </div>

              <div
                style={{
                  background: T.bg3,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  padding: sp("8px 10px"),
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: sp(4),
                  fontSize: fs(8),
                  fontFamily: T.mono,
                }}
              >
                <div>
                  <span style={{ color: T.textMuted }}>ACCOUNT</span>{" "}
                  <span style={{ color: activeAccountId ? T.text : T.amber }}>
                    {activeAccountId || "waiting"}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.textMuted }}>MODE</span>{" "}
                  <span
                    style={{ color: environment === "live" ? T.red : T.green }}
                  >
                    {environment.toUpperCase()}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.textMuted }}>RUN</span>{" "}
                  <span style={{ color: T.textSec }}>
                    {selectedDraft?.runId
                      ? selectedDraft.runId.slice(0, 8)
                      : MISSING_VALUE}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.textMuted }}>PROMOTED</span>{" "}
                  <span style={{ color: T.textSec }}>
                    {selectedDraft
                      ? formatRelativeTimeShort(selectedDraft.promotedAt)
                      : MISSING_VALUE}
                  </span>
                </div>
              </div>

              <button
                onClick={handleCreateDeployment}
                disabled={createDeploymentMutation.isPending}
                style={{
                  padding: sp("8px 0"),
                  background: T.accent,
                  border: "none",
                  borderRadius: dim(4),
                  color: "#fff",
                  fontSize: fs(10),
                  fontFamily: T.sans,
                  fontWeight: 400,
                  cursor: createDeploymentMutation.isPending
                    ? "wait"
                    : "pointer",
                  opacity: createDeploymentMutation.isPending ? 0.7 : 1,
                  letterSpacing: "0.04em",
                }}
              >
                {createDeploymentMutation.isPending
                  ? "CREATING..."
                  : `CREATE ${environment.toUpperCase()} DEPLOYMENT`}
              </button>
            </>
          )}
        </div>

        <div
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: dim(6),
            padding: sp("12px 14px"),
            display: "flex",
            flexDirection: "column",
            gap: sp(8),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: sp(8),
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
                Deployments
              </div>
              <div
                style={{
                  fontSize: fs(9),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {environment.toUpperCase()} execution profiles
              </div>
            </div>
            <span
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              {enabledDeployments.length}/{deployments.length} enabled
            </span>
          </div>

          {!deployments.length ? (
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
              No deployments exist for this environment yet.
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: sp(6) }}
            >
              {deployments.map((deployment, index) => {
                const tone = deployment.enabled
                  ? T.green
                  : deployment.lastError
                    ? T.red
                    : T.textDim;
                return (
                  <div
                    key={deployment.id}
                    className={joinMotionClasses(
                      "ra-row-enter",
                      "ra-interactive",
                      focusedDeployment?.id === deployment.id && "ra-focus-rail",
                    )}
                    onClick={() => setFocusedDeploymentId(deployment.id)}
                    style={{
                      ...motionRowStyle(index, 16, 160),
                      ...motionVars({ accent: tone }),
                      background:
                        focusedDeployment?.id === deployment.id ? T.bg3 : T.bg0,
                      border: `1px solid ${focusedDeployment?.id === deployment.id ? T.accent : T.border}`,
                      borderRadius: dim(5),
                      padding: sp("10px 12px"),
                      display: "flex",
                      justifyContent: "space-between",
                      gap: sp(10),
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(4),
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: sp(6),
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(10),
                            fontWeight: 400,
                            fontFamily: T.sans,
                            color: T.text,
                          }}
                        >
                          {deployment.name}
                        </span>
                        <Badge color={tone}>
                          {deployment.enabled ? "ENABLED" : "PAUSED"}
                        </Badge>
                        {focusedDeployment?.id === deployment.id &&
                          cockpitAttentionItems.length > 0 && (
                            <Badge color={cockpitAttentionColor(cockpitAttentionItems[0].severity)}>
                              {cockpitAttentionItems.length} ATTENTION
                            </Badge>
                          )}
                        <span
                          style={{
                            fontSize: fs(8),
                            color: T.textDim,
                            fontFamily: T.mono,
                          }}
                        >
                          {deployment.providerAccountId}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(0, auto))",
                          gap: sp(8),
                          fontSize: fs(8),
                          fontFamily: T.mono,
                          color: T.textSec,
                        }}
                      >
                        <span>
                          <span style={{ color: T.textMuted }}>SYMS</span>{" "}
                          {deployment.symbolUniverse.length}
                        </span>
                        <span>
                          <span style={{ color: T.textMuted }}>EVAL</span>{" "}
                          {formatRelativeTimeShort(deployment.lastEvaluatedAt)}
                        </span>
                        <span>
                          <span style={{ color: T.textMuted }}>SIGNAL</span>{" "}
                          {formatRelativeTimeShort(deployment.lastSignalAt)}
                        </span>
                        <span>
                          <span style={{ color: T.textMuted }}>UPDATED</span>{" "}
                          {formatRelativeTimeShort(deployment.updatedAt)}
                        </span>
                      </div>
                      {deployment.lastError && (
                        <div
                          style={{
                            fontSize: fs(8),
                            color: T.red,
                            fontFamily: T.sans,
                            lineHeight: 1.4,
                          }}
                        >
                          {deployment.lastError}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleDeployment(deployment);
                      }}
                      disabled={
                        enableDeploymentMutation.isPending ||
                        pauseDeploymentMutation.isPending ||
                        gatewayBridgeLaunching
                      }
                      style={{
                        alignSelf: "center",
                        padding: sp("6px 10px"),
                        background: deployment.enabled
                          ? "transparent"
                          : T.green,
                        border: deployment.enabled
                          ? `1px solid ${T.amber}50`
                          : "none",
                        borderRadius: dim(4),
                        color: deployment.enabled ? T.amber : "#fff",
                        fontSize: fs(9),
                        fontFamily: T.sans,
                        fontWeight: 400,
                        cursor:
                          enableDeploymentMutation.isPending ||
                          pauseDeploymentMutation.isPending ||
                          gatewayBridgeLaunching
                            ? "wait"
                            : "pointer",
                        whiteSpace: "nowrap",
                        opacity:
                          enableDeploymentMutation.isPending ||
                          pauseDeploymentMutation.isPending ||
                          gatewayBridgeLaunching
                            ? 0.7
                            : 1,
                      }}
                    >
                      {deployment.enabled
                        ? "PAUSE"
                        : !gatewayReady
                          ? gatewayBridgeLaunching
                            ? "PREPARING..."
                            : "START BRIDGE"
                          : "ENABLE"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("12px 14px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(10),
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: fs(12),
                  fontWeight: 400,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Signal Options Automation
              </span>
              <Badge color={T.cyan}>SHADOW</Badge>
              <Badge color={gatewayReady ? T.green : T.amber}>
                {gatewayReady ? "DATA READY" : "DATA BLOCKED"}
              </Badge>
              <Badge color={focusedDeployment?.enabled ? T.green : T.textDim}>
                {focusedDeployment?.enabled ? "DEPLOYMENT ENABLED" : "PAUSED"}
              </Badge>
            </div>
            <div
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              Spot RayReplica signals -&gt; option contract candidates, virtual
              fills, runner exits · no broker order submission in v1
            </div>
          </div>
          <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => refreshAlgoQueries()}
              disabled={deploymentsQuery.isFetching || cockpitQuery.isFetching}
              title="Refresh deployments, cockpit snapshot, and execution events"
              style={{
                padding: sp("6px 10px"),
                borderRadius: dim(4),
                border: `1px solid ${T.border}`,
                background: T.bg0,
                color: T.textSec,
                fontSize: fs(8),
                fontFamily: T.mono,
                fontWeight: 400,
                cursor:
                  deploymentsQuery.isFetching || cockpitQuery.isFetching
                    ? "wait"
                    : "pointer",
                opacity:
                  deploymentsQuery.isFetching || cockpitQuery.isFetching ? 0.72 : 1,
              }}
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
              title={
                !focusedDeployment
                  ? "Select a deployment first"
                  : !focusedDeployment.enabled && cockpitReadiness?.enableDisabledReason
                    ? cockpitReadiness.enableDisabledReason
                    : focusedDeployment.enabled
                      ? "Pause this deployment"
                      : "Enable this deployment"
              }
              style={{
                padding: sp("6px 10px"),
                borderRadius: dim(4),
                border: focusedDeployment?.enabled
                  ? `1px solid ${T.amber}55`
                  : "none",
                background: focusedDeployment?.enabled ? "transparent" : T.green,
                color: focusedDeployment?.enabled ? T.amber : "#fff",
                fontSize: fs(8),
                fontFamily: T.mono,
                fontWeight: 400,
                cursor:
                  enableDeploymentMutation.isPending ||
                  pauseDeploymentMutation.isPending ||
                  gatewayBridgeLaunching
                    ? "wait"
                    : "pointer",
                opacity:
                  !focusedDeployment ||
                  enableDeploymentMutation.isPending ||
                  pauseDeploymentMutation.isPending ||
                  gatewayBridgeLaunching
                    ? 0.72
                    : 1,
              }}
            >
              {focusedDeployment?.enabled ? "PAUSE" : "ENABLE"}
            </button>
            <button
              type="button"
              onClick={() => setAutomationTab("Profile")}
              disabled={!focusedDeployment}
              title={
                cockpitReadiness?.profileDisabledReason ||
                "Edit risk caps and signal-options profile"
              }
              style={{
                padding: sp("6px 10px"),
                borderRadius: dim(4),
                border: `1px solid ${T.amber}55`,
                background: `${T.amber}12`,
                color: T.amber,
                fontSize: fs(8),
                fontFamily: T.mono,
                fontWeight: 400,
                cursor: focusedDeployment ? "pointer" : "not-allowed",
                opacity: focusedDeployment ? 1 : 0.6,
              }}
            >
              RISK/PROFILE
            </button>
            {SIGNAL_OPTIONS_TABS.map((tab) => (
              <button
                key={tab}
                data-testid={`algo-signal-options-tab-${tab.toLowerCase()}`}
                type="button"
                onClick={() => setAutomationTab(tab)}
                style={{
                  padding: sp("6px 10px"),
                  borderRadius: dim(4),
                  border: `1px solid ${automationTab === tab ? T.accent : T.border}`,
                  background: automationTab === tab ? `${T.accent}18` : T.bg0,
                  color: automationTab === tab ? T.text : T.textSec,
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  fontWeight: 400,
                  cursor: "pointer",
                }}
              >
                {tab.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={handleRunShadowScan}
              disabled={
                !focusedDeployment ||
                runShadowScanMutation.isPending ||
                gatewayBridgeLaunching
              }
              style={{
                padding: sp("6px 10px"),
                borderRadius: dim(4),
                border: "none",
                background: !focusedDeployment
                  ? T.textMuted
                  : gatewayReady
                    ? T.cyan
                    : T.amber,
                color: "#031216",
                fontSize: fs(8),
                fontFamily: T.mono,
                fontWeight: 400,
                cursor:
                  runShadowScanMutation.isPending ||
                  gatewayBridgeLaunching
                    ? "wait"
                    : "pointer",
                opacity:
                  runShadowScanMutation.isPending ||
                  gatewayBridgeLaunching
                    ? 0.72
                    : 1,
              }}
            >
              {runShadowScanMutation.isPending
                ? "SCANNING..."
                : !gatewayReady
                  ? gatewayBridgeLaunching
                    ? "PREPARING..."
                    : "START BRIDGE"
                  : "RUN SCAN"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoMetricsGridTemplate,
            gap: sp(8),
          }}
        >
          {[
            {
              label: "Candidates",
              value: signalOptionsCandidates.length,
              detail: selectedCandidate
                ? `${selectedCandidate.symbol} ${selectedCandidate.direction}`
                : "queue empty",
              color: signalOptionsCandidates.length ? T.cyan : T.textDim,
            },
            {
              label: "Open Shadow",
              value: signalOptionsPositions.length,
              detail: `${signalOptionsState?.risk?.openSymbols || 0}/${signalOptionsState?.risk?.maxOpenSymbols || signalOptionsProfile.riskCaps.maxOpenSymbols} symbols`,
              color: signalOptionsPositions.length ? T.green : T.textDim,
            },
            {
              label: "Daily P&L",
              value: formatMoney(signalOptionsState?.risk?.dailyPnl, 2),
              detail: `R ${formatMoney(signalOptionsState?.risk?.dailyRealizedPnl, 2)} / U ${formatMoney(signalOptionsState?.risk?.openUnrealizedPnl, 2)}`,
              color:
                Number(signalOptionsState?.risk?.dailyPnl) < 0
                  ? T.red
                  : Number(signalOptionsState?.risk?.dailyPnl) > 0
                    ? T.green
                    : T.textDim,
            },
            {
              label: "Premium Cap",
              value: formatMoney(signalOptionsProfile.riskCaps.maxPremiumPerEntry),
              detail: `${signalOptionsProfile.riskCaps.maxContracts} contracts max`,
              color: T.amber,
            },
            {
              label: "Liquidity Gate",
              value: formatPct(
                signalOptionsProfile.liquidityGate.maxSpreadPctOfMid,
                0,
              ),
              detail: `${signalOptionsProfile.optionSelection.minDte}-${signalOptionsProfile.optionSelection.maxDte}D, ${
                signalOptionsProfile.optionSelection.allowZeroDte
                  ? "0DTE allowed"
                  : "no 0DTE"
              }`,
              color: T.purple,
            },
          ].map((metric, index) => (
            <div
              key={metric.label}
              className="ra-row-enter"
              style={{
                ...motionRowStyle(index, 14, 80),
                padding: sp("9px 10px"),
                borderRadius: dim(5),
                background: T.bg0,
                border: `1px solid ${T.border}`,
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
                  fontSize: fs(12),
                  fontWeight: 400,
                  marginTop: 2,
                }}
              >
                {metric.value}
              </div>
              <div
                style={{
                  color: T.textDim,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  marginTop: 2,
                }}
              >
                {metric.detail}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(0, 1.45fr) minmax(280px, 0.75fr)",
            gap: sp(10),
          }}
        >
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("10px 12px"),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
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
                  Pipeline
                </div>
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                  }}
                >
                  scan -&gt; signal -&gt; contract -&gt; gate -&gt; shadow -&gt; manage -&gt; exit
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPipelineStageId("all")}
                style={{
                  border: `1px solid ${selectedPipelineStageId === "all" ? T.accent : T.border}`,
                  background:
                    selectedPipelineStageId === "all" ? `${T.accent}18` : T.bg2,
                  color: selectedPipelineStageId === "all" ? T.text : T.textSec,
                  borderRadius: dim(4),
                  padding: sp("5px 8px"),
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  fontWeight: 400,
                  cursor: "pointer",
                }}
              >
                ALL
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPhone
                  ? "minmax(0, 1fr)"
                  : "repeat(7, minmax(96px, 1fr))",
                gap: sp(6),
              }}
            >
              {(cockpitPipelineStages.length
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
                  ]
              ).map((stage, index) => {
                const color = cockpitStageColor(stage.status);
                const selected = selectedPipelineStageId === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setSelectedPipelineStageId(stage.id)}
                    className="ra-row-enter"
                    style={{
                      ...motionRowStyle(index, 9, 60),
                      ...motionVars({ accent: color }),
                      textAlign: "left",
                      minHeight: dim(86),
                      border: `1px solid ${selected ? color : T.border}`,
                      borderRadius: dim(5),
                      background: selected ? `${color}14` : T.bg2,
                      padding: sp("8px 9px"),
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: sp(5),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: sp(5),
                      }}
                    >
                      <span
                        style={{
                          color: T.text,
                          fontSize: fs(8),
                          fontFamily: T.sans,
                          fontWeight: 400,
                          lineHeight: 1.2,
                        }}
                      >
                        {stage.label}
                      </span>
                      <span
                        style={{
                          width: dim(7),
                          height: dim(7),
                          borderRadius: "50%",
                          background: color,
                          flex: "0 0 auto",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        color,
                        fontFamily: T.mono,
                        fontSize: fs(13),
                        fontWeight: 400,
                      }}
                    >
                      {stage.count}
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.mono,
                        fontSize: fs(7),
                        lineHeight: 1.35,
                      }}
                    >
                      {formatEnumLabel(stage.status)} ·{" "}
                      {stage.latestAt
                        ? formatRelativeTimeShort(stage.latestAt)
                        : "no timestamp"}
                      <br />
                      {stage.detail}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("10px 12px"),
              display: "flex",
              flexDirection: "column",
              gap: sp(8),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: sp(8),
              }}
            >
              <div
                style={{
                  color: T.text,
                  fontFamily: T.display,
                  fontSize: fs(11),
                  fontWeight: 400,
                }}
              >
                Attention
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
            {!cockpitAttentionItems.length ? (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: dim(5),
                  padding: sp("14px 10px"),
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  lineHeight: 1.45,
                }}
              >
                No active blockers or drift detected. Last cockpit snapshot{" "}
                {formatRelativeTimeShort(cockpit?.generatedAt)}.
              </div>
            ) : (
              cockpitAttentionItems.slice(0, 6).map((item, index) => {
                const color = cockpitAttentionColor(item.severity);
                return (
                  <div
                    key={item.id}
                    className="ra-row-enter"
                    style={{
                      ...motionRowStyle(index, 10, 80),
                      ...motionVars({ accent: color }),
                      border: `1px solid ${color}35`,
                      borderRadius: dim(5),
                      background: `${color}10`,
                      padding: sp("8px 9px"),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: sp(8),
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          color,
                          fontFamily: T.mono,
                          fontSize: fs(8),
                          fontWeight: 400,
                        }}
                      >
                        {item.symbol || formatEnumLabel(item.stage)}
                      </span>
                      <span
                        style={{
                          color: T.textDim,
                          fontFamily: T.mono,
                          fontSize: fs(7),
                        }}
                      >
                        {formatRelativeTimeShort(item.occurredAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        color: T.text,
                        fontFamily: T.sans,
                        fontSize: fs(9),
                        fontWeight: 400,
                        marginTop: sp(4),
                        lineHeight: 1.3,
                      }}
                    >
                      {item.summary}
                    </div>
                    <div
                      style={{
                        color: T.textSec,
                        fontFamily: T.sans,
                        fontSize: fs(8),
                        lineHeight: 1.35,
                        marginTop: sp(3),
                      }}
                    >
                      {item.detail}
                    </div>
                    <div
                      style={{
                        color: T.textDim,
                        fontFamily: T.mono,
                        fontSize: fs(7),
                        marginTop: sp(4),
                      }}
                    >
                      {item.action}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) minmax(0, 1fr)",
            gap: sp(10),
          }}
        >
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("10px 12px"),
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
              Risk + P&L
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPhone
                  ? "minmax(0, 1fr)"
                  : "repeat(4, minmax(0, 1fr))",
                gap: sp(6),
              }}
            >
              {[
                ["Today P&L", formatMoney(cockpitKpis.todayPnl, 2)],
                ["Loss left", formatMoney(cockpitKpis.dailyLossRemaining, 2)],
                ["Premium", formatMoney(cockpitKpis.openPremium, 2)],
                [
                  "Open symbols",
                  `${cockpitKpis.openSymbols ?? 0}/${cockpitKpis.maxOpenSymbols ?? signalOptionsProfile.riskCaps.maxOpenSymbols}`,
                ],
                ["Candidates", cockpitKpis.candidates ?? signalOptionsCandidates.length],
                ["Blocked", cockpitKpis.blockedCandidates ?? 0],
                ["Filled", cockpitKpis.shadowFilledCandidates ?? 0],
                ["Positions", cockpitKpis.openPositions ?? signalOptionsPositions.length],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    background: T.bg2,
                    padding: sp("7px 8px"),
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
                      fontSize: fs(10),
                      fontWeight: 400,
                      marginTop: sp(3),
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("10px 12px"),
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
              Source Backtest
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: sp(6),
              }}
            >
              {[
                ["Strategy", cockpitSourceBacktest?.strategyName || MISSING_VALUE],
                [
                  "Run",
                  cockpitSourceBacktest?.runName ||
                    cockpitSourceBacktest?.sourceRunId?.slice(0, 8) ||
                    MISSING_VALUE,
                ],
                [
                  "Net P&L",
                  formatCockpitMetric(
                    cockpitSourceBacktest?.metrics,
                    "netPnl",
                    (value) => formatMoney(value, 2),
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
                  formatCockpitMetric(
                    cockpitSourceBacktest?.metrics,
                    "tradeCount",
                    (value) => Number(value).toLocaleString(),
                  ),
                ],
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
                      fontSize: fs(10),
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
        </div>

        {automationTab === "Candidates" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: algoCandidateGridTemplate,
              gap: sp(10),
              minHeight: dim(180),
              minWidth: 0,
            }}
          >
            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: dim(5),
                background: T.bg0,
                padding: sp(8),
                display: "flex",
                flexDirection: "column",
                gap: sp(6),
                minWidth: 0,
              }}
            >
              {!displayedSignalOptionsCandidates.length ? (
                <div
                  style={{
                    padding: sp("26px 10px"),
                    border: `1px dashed ${T.border}`,
                    borderRadius: dim(5),
                    color: T.textDim,
                    fontSize: fs(10),
                    fontFamily: T.sans,
                    lineHeight: 1.45,
                  }}
                >
                  {selectedPipelineStageId === "all"
                    ? "No signal-options candidates yet. Run a scan to evaluate fresh RayReplica signals and resolve shadow option contracts."
                    : "No candidates match the selected pipeline stage."}
                </div>
              ) : (
                displayedSignalOptionsCandidates.slice(0, 12).map((candidate, index) => {
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
                        ...motionRowStyle(index, 12, 90),
                        ...motionVars({ accent: tone }),
                        textAlign: "left",
                        border: `1px solid ${selected ? tone : T.border}`,
                        borderRadius: dim(5),
                        background: selected ? `${tone}12` : T.bg2,
                        padding: sp("9px 10px"),
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: sp(8),
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            color: T.text,
                            fontFamily: T.mono,
                            fontSize: fs(10),
                            fontWeight: 400,
                          }}
                        >
                          {candidate.symbol} {candidate.optionRight?.toUpperCase()}
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
                          marginTop: 4,
                        }}
                      >
                        {candidate.timeframe} · {candidate.direction} ·{" "}
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
                background: T.bg0,
                padding: sp("10px 12px"),
                minWidth: 0,
              }}
            >
              {!selectedCandidate ? (
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.sans,
                    fontSize: fs(10),
                    padding: sp("24px 0"),
                  }}
                >
                  Select a candidate to inspect its contract, fill simulation,
                  liquidity gate, and Trade handoff.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: sp(10),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: sp(10),
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: T.text,
                          fontFamily: T.display,
                          fontSize: fs(14),
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
                          marginTop: 3,
                        }}
                      >
                        {selectedCandidate.timeframe} · signal{" "}
                        {formatRelativeTimeShort(selectedCandidate.signalAt)} ·
                            spot {formatPlainPrice(selectedCandidate.signalPrice, 2)}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: sp(6),
                            flexWrap: "wrap",
                            marginTop: sp(6),
                          }}
                        >
                          <Badge
                            color={signalOptionsActionColor(
                              selectedCandidate.actionStatus ||
                                selectedCandidate.status,
                            )}
                          >
                            {signalOptionsActionLabel(
                              selectedCandidate.actionStatus ||
                                selectedCandidate.status,
                            ).toUpperCase()}
                          </Badge>
                          <Badge
                            color={
                              selectedCandidate.syncStatus === "synced"
                                ? T.green
                                : selectedCandidate.syncStatus === "mismatch"
                                  ? T.red
                                  : T.amber
                            }
                          >
                            {formatEnumLabel(
                              selectedCandidate.syncStatus || "synced",
                            ).toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                      <button
                        type="button"
                      onClick={() => handleOpenCandidateInTrade(selectedCandidate)}
                      disabled={
                        !onJumpToTradeCandidate ||
                        !asRecord(selectedCandidate.selectedContract).strike
                      }
                      style={{
                        padding: sp("7px 10px"),
                        borderRadius: dim(4),
                        border: `1px solid ${T.accent}55`,
                        background: `${T.accent}18`,
                        color: T.text,
                        fontFamily: T.mono,
                        fontSize: fs(8),
                        fontWeight: 400,
                        cursor: "pointer",
                        opacity:
                          !asRecord(selectedCandidate.selectedContract).strike
                            ? 0.55
                            : 1,
                      }}
                    >
                      OPEN IN TRADE
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: algoIsPhone
                        ? "minmax(0, 1fr)"
                        : algoIsNarrow
                          ? "repeat(2, minmax(0, 1fr))"
                          : "repeat(4, minmax(0, 1fr))",
                      gap: sp(8),
                    }}
                  >
                    {[
                      {
                        label: "Contract",
                        value: formatContractLabel(
                          selectedCandidate.selectedContract,
                        ),
                      },
                      {
                        label: "Limit",
                        value: formatMoney(
                          asRecord(selectedCandidate.orderPlan).entryLimitPrice,
                          2,
                        ),
                      },
                      {
                        label: "Fill",
                        value: formatMoney(
                          asRecord(selectedCandidate.orderPlan)
                            .simulatedFillPrice,
                          2,
                        ),
                      },
                      {
                        label: "Quantity",
                        value:
                          asRecord(selectedCandidate.orderPlan).quantity ??
                          MISSING_VALUE,
                      },
                      {
                        label: "Mid",
                        value: formatMoney(
                          asRecord(selectedCandidate.liquidity).mid,
                          2,
                        ),
                      },
                      {
                        label: "Spread",
                        value: formatPct(
                          asRecord(selectedCandidate.liquidity).spreadPctOfMid,
                        ),
                      },
                      {
                        label: "Bid / Ask",
                        value: `${formatMoney(
                          asRecord(selectedCandidate.liquidity).bid,
                          2,
                        )} / ${formatMoney(
                          asRecord(selectedCandidate.liquidity).ask,
                          2,
                        )}`,
                      },
                      {
                        label: "Quote",
                        value:
                          asRecord(selectedCandidate.liquidity)
                            .quoteFreshness || MISSING_VALUE,
                      },
                      {
                        label: "Quote Age",
                        value: formatDurationMs(
                          asRecord(selectedCandidate.quote).ageMs,
                        ),
                      },
                      {
                        label: "Premium",
                        value: formatMoney(
                          asRecord(selectedCandidate.orderPlan).premiumAtRisk,
                        ),
                      },
                      {
                        label: "Shadow",
                        value: shadowLinkSummary(selectedCandidate.shadowLink),
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          border: `1px solid ${T.border}`,
                          borderRadius: dim(4),
                          background: T.bg2,
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
                          {item.label.toUpperCase()}
                        </div>
                        <div
                          style={{
                            color: T.text,
                            fontFamily: T.mono,
                            fontSize: fs(10),
                            fontWeight: 400,
                            marginTop: 3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedCandidate.reason && (
                    <div
                      style={{
                        color: T.amber,
                        fontFamily: T.sans,
                        fontSize: fs(10),
                        lineHeight: 1.45,
                      }}
                    >
                      {formatEnumLabel(selectedCandidate.reason)}
                    </div>
                  )}

                  <div
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: sp(8),
                      display: "grid",
                      gap: sp(6),
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
                      TIMELINE
                    </div>
                    {Array.isArray(selectedCandidate.timeline) &&
                    selectedCandidate.timeline.length ? (
                      selectedCandidate.timeline.slice(-8).map((item, index) => {
                        const tone = String(item.type || "").includes("skipped")
                          ? T.amber
                          : String(item.type || "").includes("exit")
                            ? T.textDim
                            : String(item.type || "").includes("deviation")
                              ? T.purple
                              : T.cyan;
                        return (
                          <div
                            key={item.id || `${item.type}:${index}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "84px 132px 1fr",
                              gap: sp(8),
                              alignItems: "center",
                              fontSize: fs(8),
                              fontFamily: T.mono,
                              borderBottom: `1px solid ${T.border}20`,
                              paddingBottom: sp(4),
                            }}
                          >
                            <span style={{ color: T.textDim }}>
                              {formatAppTimeForPreferences(
                                item.occurredAt,
                                userPreferences,
                              )}
                            </span>
                            <span style={{ color: tone, fontWeight: 400 }}>
                              {formatEnumLabel(item.type)}
                            </span>
                            <span
                              style={{
                                color: T.textSec,
                                fontFamily: T.sans,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.summary || item.reason || "Lifecycle event"}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ color: T.textMuted, fontSize: fs(9) }}>
                        No lifecycle events linked yet.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {automationTab === "Positions" && (
          <div
            style={{
              display: "grid",
              gap: sp(8),
            }}
          >
            {!signalOptionsPositions.length ? (
              <div
                style={{
                  padding: sp("22px 10px"),
                  border: `1px dashed ${T.border}`,
                  borderRadius: dim(5),
                  color: T.textDim,
                  fontSize: fs(10),
                  fontFamily: T.sans,
                  lineHeight: 1.45,
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
                const stop = numberFrom(position.stopPrice, NaN);
                const distanceToStop =
                  Number.isFinite(mark) && Number.isFinite(stop) && mark > 0
                    ? ((mark - stop) / mark) * 100
                    : null;
                const positionTone =
                  distanceToStop != null && distanceToStop <= 20
                    ? T.amber
                    : Number(unrealized) < 0
                      ? T.red
                      : T.green;
                return (
                  <div
                    key={position.id || position.candidateId}
                    className="ra-row-enter"
                    style={{
                      ...motionRowStyle(index, 12, 80),
                      display: "grid",
                      gridTemplateColumns: algoIsPhone
                        ? "minmax(0, 1fr)"
                        : "minmax(160px, 1fr) repeat(6, minmax(82px, 0.7fr))",
                      gap: sp(8),
                      alignItems: "center",
                      border: `1px solid ${positionTone === T.amber ? `${T.amber}55` : T.border}`,
                      borderRadius: dim(5),
                      background:
                        positionTone === T.amber ? `${T.amber}10` : T.bg0,
                      padding: sp("9px 10px"),
                      minWidth: 0,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: T.text,
                          fontFamily: T.mono,
                          fontSize: fs(10),
                          fontWeight: 400,
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
                          marginTop: 3,
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
	                      ["Stop", formatPlainPrice(position.stopPrice, 2)],
	                      [
	                        "Stop dist",
                        distanceToStop == null
                          ? MISSING_VALUE
                          : formatPct(distanceToStop, 1),
                      ],
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
                            fontSize: fs(10),
                            fontWeight: 400,
                            marginTop: 3,
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

        {automationTab === "Profile" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: algoProfileGridTemplate,
              gap: sp(8),
            }}
          >
            {profileNumberFields.map(([section, key, label, step]) => (
              <label
                key={`${section}.${key}`}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg0,
                  padding: sp("8px 10px"),
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
                    fontSize: fs(10),
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
                  background: T.bg0,
                  padding: sp("8px 10px"),
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
                    fontSize: fs(10),
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
            {profileBooleanFields.map(([section, key, label]) => (
              <label
                key={`${section}.${key}`}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  background: T.bg0,
                  padding: sp("8px 10px"),
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
                    fontWeight: 400,
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
            <label
              style={{
                gridColumn: "1 / -1",
                border: `1px solid ${T.border}`,
                borderRadius: dim(5),
                background: T.bg0,
                padding: sp("8px 10px"),
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
                  fontSize: fs(10),
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
                paddingTop: sp(2),
              }}
            >
              <div
                style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}
              >
                Fill ladder{" "}
                {(profileDraft?.fillPolicy?.chaseSteps || [])
                  .map((step) => `${Math.round(step * 100)}%`)
                  .join(" / ")}{" "}
                · runner trail locks{" "}
                {formatPct(profileDraft?.exitPolicy?.minLockedGainPct, 0)}
              </div>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={!focusedDeployment || updateProfileMutation.isPending}
                style={{
                  padding: sp("7px 12px"),
                  borderRadius: dim(4),
                  border: "none",
                  background: T.green,
                  color: "#fff",
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 400,
                  cursor: updateProfileMutation.isPending ? "wait" : "pointer",
                  opacity: updateProfileMutation.isPending ? 0.72 : 1,
                }}
              >
                {updateProfileMutation.isPending ? "SAVING..." : "SAVE PROFILE"}
              </button>
            </div>
          </div>
        )}

        {automationTab === "Events" && (
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp("8px 10px"),
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
              {[
                ["all", "All"],
                ["blockers", "Blockers"],
                ["fills", "Fills"],
                ["exits", "Exits"],
                ["profile", "Profile"],
                ["gateway", "Gateway"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEventFilter(value)}
                  style={{
                    border: `1px solid ${eventFilter === value ? T.accent : T.border}`,
                    background:
                      eventFilter === value ? `${T.accent}18` : T.bg2,
                    color: eventFilter === value ? T.text : T.textSec,
                    borderRadius: dim(4),
                    padding: sp("5px 8px"),
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    fontWeight: 400,
                    cursor: "pointer",
                  }}
                >
                  {label.toUpperCase()}
                </button>
              ))}
            </div>
            {!filteredSignalOptionsEvents.length ? (
              <div
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  padding: sp("18px 0"),
                }}
              >
                No signal-options automation events match this filter.
              </div>
            ) : (
              filteredSignalOptionsEvents.slice(0, 12).map((event, index) => (
                <div
                  key={event.id}
                  className="ra-row-enter"
                  style={{
                    ...motionRowStyle(index, 10, 90),
                    display: "grid",
                    gridTemplateColumns: "72px 150px 1fr 84px",
                    gap: sp(8),
                    padding: sp("7px 0"),
                    borderBottom: `1px solid ${T.border}10`,
                    fontSize: fs(8),
                  }}
                >
                  <span style={{ color: T.textDim, fontFamily: T.mono }}>
                    {formatAppTimeForPreferences(
                      event.occurredAt,
                      userPreferences,
                    )}
                  </span>
                  <span
                    style={{
                      color: T.cyan,
                      fontFamily: T.mono,
                      fontWeight: 400,
                    }}
                  >
                    {formatEnumLabel(event.eventType)}
                  </span>
                  <span style={{ color: T.textSec, fontFamily: T.sans }}>
                    {event.summary}
                  </span>
                  <span
                    style={{
                      color: event.symbol ? T.text : T.textDim,
                      fontFamily: T.mono,
                      textAlign: "right",
                    }}
                  >
                    {event.symbol || "system"}
                  </span>
                  <details
                    style={{
                      gridColumn: "1 / -1",
                      color: T.textDim,
                      fontFamily: T.mono,
                      fontSize: fs(7),
                    }}
                  >
                    <summary style={{ cursor: "pointer", color: T.textMuted }}>
                      payload
                    </summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowX: "auto",
                        margin: sp("6px 0 0"),
                        padding: sp("7px 8px"),
                        border: `1px solid ${T.border}`,
                        borderRadius: dim(4),
                        background: T.bg2,
                      }}
                    >
                      {JSON.stringify(event.payload || {}, null, 2)}
                    </pre>
                  </details>
                </div>
              ))
            )}
          </div>
        )}
      </div>

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

      <AlgoDraftStrategiesPanel
        theme={T}
        scale={{ fs, sp, dim }}
        isVisible={isVisible}
      />
    </div>
  );
};

export default AlgoScreen;
