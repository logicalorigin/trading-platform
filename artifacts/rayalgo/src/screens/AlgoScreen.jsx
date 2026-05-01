import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useCreateAlgoDeployment,
  useEnableAlgoDeployment,
  useListAlgoDeployments,
  useListBacktestDraftStrategies,
  useListExecutionEvents,
  usePauseAlgoDeployment,
} from "@workspace/api-client-react";
import {
  AlgoDraftStrategiesPanel,
} from "../features/backtesting/BacktestingPanels";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  Badge,
  QUERY_DEFAULTS,
  bridgeRuntimeMessage,
  bridgeRuntimeTone,
  formatEnumLabel,
  formatRelativeTimeShort,
  parseSymbolUniverseInput,
  useToast,
} from "../RayAlgoPlatform";
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

const SIGNAL_OPTIONS_TABS = ["Candidates", "Risk", "Events"];

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
      Math.max(profile.optionSelection.minDte, profile.optionSelection.targetDte),
    );
    profile.riskCaps.maxPremiumPerEntry = numberFrom(
      parameters.signalOptionsMaxPremium,
      profile.riskCaps.maxPremiumPerEntry,
    );
    profile.riskCaps.maxContracts = numberFrom(
      parameters.signalOptionsMaxContracts,
      profile.riskCaps.maxContracts,
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

const openIbkrProtocolLauncher = () => {
  return null;
};

const closeIbkrProtocolLauncher = (launcher) => {
  if (!launcher || launcher.closed) {
    return;
  }

  try {
    launcher.close();
  } catch {
    // Ignore popup cleanup failures.
  }
};

const navigateIbkrProtocolLauncher = (launcher, url) => {
  if (!url || typeof window === "undefined") {
    closeIbkrProtocolLauncher(launcher);
    return false;
  }

  if (launcher && !launcher.closed) {
    try {
      launcher.location.href = url;
      return true;
    } catch {
      // Fall through to same-tab navigation.
    }
  }

  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
};

const IBKR_BRIDGE_LAUNCH_COOLDOWN_MS = 90_000;

const formatMoney = (value, digits = 0) =>
  Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })}`
    : MISSING_VALUE;

const formatNumber = (value, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : MISSING_VALUE;

const formatPct = (value, digits = 1) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : MISSING_VALUE;

const formatContractLabel = (contract) => {
  const value = asRecord(contract);
  const right = String(value.right || "").toUpperCase();
  const strike = Number.isFinite(Number(value.strike))
    ? Number(value.strike).toLocaleString()
    : MISSING_VALUE;
  return [value.expirationDate, strike, right].filter(Boolean).join(" ");
};

const signalOptionsActionColor = (status) => {
  if (status === "shadow_filled" || status === "live_submitted") return T.green;
  if (status === "manual_override" || status === "partial_shadow") return T.amber;
  if (status === "blocked" || status === "mismatch") return T.red;
  if (status === "closed") return T.textDim;
  if (status === "live_previewed") return T.purple;
  return T.cyan;
};

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
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const queryClient = useQueryClient();
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [symbolUniverseInput, setSymbolUniverseInput] = useState("");
  const [focusedDeploymentId, setFocusedDeploymentId] = useState(null);
  const [automationTab, setAutomationTab] = useState("Candidates");
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
      refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
      retry: false,
    },
  });
  const deploymentsQuery = useListAlgoDeployments(
    { mode: environment },
    {
      query: {
        ...QUERY_DEFAULTS,
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
        refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
        retry: false,
      },
    },
  );
  const events = eventsQuery.data?.events || [];
  const signalOptionsStateQuery = useQuery({
    queryKey: [
      "signal-options-state",
      focusedDeployment?.id || "__none__",
    ],
    queryFn: () =>
      signalOptionsApi(
        `/api/algo/deployments/${encodeURIComponent(focusedDeployment.id)}/signal-options/state`,
      ),
    enabled: Boolean(isVisible && focusedDeployment?.id),
    ...QUERY_DEFAULTS,
    refetchInterval: isVisible ? QUERY_DEFAULTS.refetchInterval : false,
    retry: false,
  });
  const signalOptionsState = signalOptionsStateQuery.data || null;
  const signalOptionsProfile =
    signalOptionsState?.profile || SIGNAL_OPTIONS_DEFAULT_PROFILE;
  const signalOptionsCandidates = signalOptionsState?.candidates || [];
  const signalOptionsPositions = signalOptionsState?.activePositions || [];
  const signalOptionsEvents = signalOptionsState?.events || [];
  const selectedCandidate =
    signalOptionsCandidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    ) ||
    signalOptionsCandidates[0] ||
    null;
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
  }, [
    focusedDeployment?.id,
    signalOptionsProfile.optionSelection?.minDte,
    signalOptionsProfile.optionSelection?.maxDte,
    signalOptionsProfile.riskCaps?.maxPremiumPerEntry,
    signalOptionsProfile.riskCaps?.maxContracts,
    signalOptionsProfile.riskCaps?.maxOpenSymbols,
    signalOptionsProfile.riskCaps?.maxDailyLoss,
    signalOptionsProfile.liquidityGate?.maxSpreadPctOfMid,
    signalOptionsProfile.exitPolicy?.hardStopPct,
    signalOptionsProfile.exitPolicy?.trailActivationPct,
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
    if (focusedDeployment?.id) {
      queryClient.invalidateQueries({
        queryKey: ["signal-options-state", focusedDeployment.id],
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
          ? "Chrome should ask to open PowerShell for the RayAlgo IBKR bridge."
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
    if (brokerAuthenticated || bridgeLaunchInFlightUntil <= bridgeLaunchClock) {
      return undefined;
    }
    const timer = window.setInterval(() => setBridgeLaunchClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [bridgeLaunchClock, bridgeLaunchInFlightUntil, brokerAuthenticated]);
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

  const runShadowScanMutation = useMutation({
    mutationFn: (deploymentId) =>
      signalOptionsApi(
        `/api/algo/deployments/${encodeURIComponent(deploymentId)}/signal-options/shadow-scan`,
        { method: "POST" },
      ),
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
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ deploymentId, profile }) =>
      signalOptionsApi(
        `/api/algo/deployments/${encodeURIComponent(deploymentId)}/signal-options/profile`,
        {
          method: "PATCH",
          body: JSON.stringify(profile),
        },
      ),
    onSuccess: (state) => {
      refreshAlgoQueries();
      setProfileDraft(cloneProfile(state?.profile));
      toast.push({
        kind: "success",
        title: "Risk profile saved",
        body: "Signal-options automation settings were updated.",
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Risk save failed",
        body: error?.message || "The signal-options profile could not be saved.",
      });
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
    runShadowScanMutation.mutate(focusedDeployment.id);
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
      profile: profileDraft,
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

  return (
    <div
      style={{
        padding: sp(12),
        display: "flex",
        flexDirection: "column",
        gap: sp(10),
        height: "100%",
        overflowY: "auto",
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
                fontWeight: 700,
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
                fontWeight: 900,
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
            fontWeight: 700,
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
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
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
              value: `${deployments.length}`,
              detail: deployments.length
                ? `${enabledDeployments.length} enabled`
                : "none created",
              color: deployments.length ? T.green : T.textDim,
            },
            {
              label: "Bridge",
              value: bridgeTone.label.toUpperCase(),
              detail:
                session?.ibkrBridge?.transport === "tws"
                  ? `IB Gateway ${session?.ibkrBridge?.sessionMode || ""} · ${activeAccountId || "no account"}`
                  : `${session?.ibkrBridge?.transport || "bridge"} · ${activeAccountId || "no account"}`,
              color: bridgeTone.color,
            },
            {
              label: "Environment",
              value: environment.toUpperCase(),
              detail: session?.marketDataProviders?.live
                ? `live md ${session.marketDataProviders.live}`
                : "session loading",
              color: environment === "live" ? T.red : T.green,
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
                    fontWeight: 700,
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
                  fontWeight: 700,
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
          gridTemplateColumns: "minmax(320px, 0.95fr) minmax(420px, 1.35fr)",
          gap: sp(10),
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
                  fontWeight: 700,
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
                    fontWeight: 600,
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
                  fontWeight: 700,
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
                  fontWeight: 700,
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
                            fontWeight: 700,
                            fontFamily: T.sans,
                            color: T.text,
                          }}
                        >
                          {deployment.name}
                        </span>
                        <Badge color={tone}>
                          {deployment.enabled ? "ENABLED" : "PAUSED"}
                        </Badge>
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
                        fontWeight: 700,
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
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Signal Options Automation
              </span>
              <Badge color={T.cyan}>SHADOW</Badge>
              <Badge color={focusedDeployment?.enabled ? T.green : T.textDim}>
                {focusedDeployment?.enabled ? "DEPLOYMENT ENABLED" : "PAUSED"}
              </Badge>
            </div>
            <div
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              Spot RayReplica signals -&gt; option contract candidates, virtual
              fills, runner exits
            </div>
          </div>
          <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
            {SIGNAL_OPTIONS_TABS.map((tab) => (
              <button
                key={tab}
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
                  fontWeight: 800,
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
                fontWeight: 900,
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
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
              detail: `${signalOptionsProfile.optionSelection.minDte}-${signalOptionsProfile.optionSelection.maxDte}D, no 0DTE`,
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
                  fontWeight: 900,
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

        {automationTab === "Candidates" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(280px, 0.95fr) minmax(360px, 1.25fr)",
              gap: sp(10),
              minHeight: dim(250),
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
              {!signalOptionsCandidates.length ? (
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
                  No signal-options candidates yet. Run a scan to evaluate fresh
                  RayReplica signals and resolve shadow option contracts.
                </div>
              ) : (
                signalOptionsCandidates.slice(0, 12).map((candidate, index) => {
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
                            fontWeight: 900,
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
                          fontWeight: 800,
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
                            spot {formatNumber(selectedCandidate.signalPrice)}
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
                        fontWeight: 900,
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
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
                            fontWeight: 800,
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
                            <span style={{ color: tone, fontWeight: 900 }}>
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

        {automationTab === "Risk" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: sp(8),
            }}
          >
            {[
              ["riskCaps", "maxPremiumPerEntry", "Max premium", 25],
              ["riskCaps", "maxContracts", "Max contracts", 1],
              ["riskCaps", "maxOpenSymbols", "Max open symbols", 1],
              ["riskCaps", "maxDailyLoss", "Daily halt", 50],
              ["liquidityGate", "maxSpreadPctOfMid", "Max spread %", 1],
              ["optionSelection", "minDte", "Min DTE", 1],
              ["optionSelection", "maxDte", "Max DTE", 1],
              ["exitPolicy", "hardStopPct", "Hard stop %", 1],
              ["exitPolicy", "trailActivationPct", "Trail activates %", 5],
            ].map(([section, key, label, step]) => (
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
                  fontWeight: 900,
                  cursor: updateProfileMutation.isPending ? "wait" : "pointer",
                  opacity: updateProfileMutation.isPending ? 0.72 : 1,
                }}
              >
                {updateProfileMutation.isPending ? "SAVING..." : "SAVE RISK"}
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
            {!signalOptionsEvents.length ? (
              <div
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  padding: sp("18px 0"),
                }}
              >
                No signal-options automation events have been recorded.
              </div>
            ) : (
              signalOptionsEvents.slice(0, 12).map((event, index) => (
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
                      fontWeight: 900,
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
          padding: sp("12px 14px"),
          flex: 1,
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
                fontWeight: 700,
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
                style={{ color: T.accent, fontFamily: T.mono, fontWeight: 700 }}
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
