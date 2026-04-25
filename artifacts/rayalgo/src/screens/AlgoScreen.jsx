import {
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
  formatEtTime,
  formatRelativeTimeShort,
  parseSymbolUniverseInput,
  useToast,
} from "../RayAlgoPlatform";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";

export const AlgoScreen = ({
  session,
  environment,
  accounts = [],
  selectedAccountId = null,
  isVisible = false,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [symbolUniverseInput, setSymbolUniverseInput] = useState("");
  const [focusedDeploymentId, setFocusedDeploymentId] = useState(null);
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(session?.ibkrBridge?.authenticated);
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

  const refreshAlgoQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/algo/deployments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/algo/events"] });
  };

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

    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the local bridge before creating a live deployment.",
      });
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
        },
      },
    });
  };

  const handleToggleDeployment = (deployment) => {
    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the local bridge before changing deployment state.",
      });
      return;
    }

    if (deployment.enabled) {
      pauseDeploymentMutation.mutate({ deploymentId: deployment.id });
      return;
    }

    enableDeploymentMutation.mutate({ deploymentId: deployment.id });
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
      {brokerConfigured && !brokerAuthenticated && (
        <div
          style={{
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
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
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
              {deployments.map((deployment) => {
                const tone = deployment.enabled
                  ? T.green
                  : deployment.lastError
                    ? T.red
                    : T.textDim;
                return (
                  <div
                    key={deployment.id}
                    onClick={() => setFocusedDeploymentId(deployment.id)}
                    style={{
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
                        pauseDeploymentMutation.isPending
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
                          pauseDeploymentMutation.isPending
                            ? "wait"
                            : "pointer",
                        whiteSpace: "nowrap",
                        opacity:
                          enableDeploymentMutation.isPending ||
                          pauseDeploymentMutation.isPending
                            ? 0.7
                            : 1,
                      }}
                    >
                      {deployment.enabled ? "PAUSE" : "ENABLE"}
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
          events.map((event) => (
            <div
              key={event.id}
              style={{
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
                {formatEtTime(event.occurredAt)}
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
