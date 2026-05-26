import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Clock,
  Layers,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  CSS_COLOR,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatEnumLabel, formatRelativeTimeShort } from "../../lib/formatters";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { OperationsAttentionStrip } from "./OperationsAttentionStrip";
import { OperationsPositionsTable } from "./OperationsPositionsTable";
import { OperationsSignalDrill } from "./OperationsSignalDrill";
import { OperationsSignalTable } from "./OperationsSignalTable";
import { OperationsStatusOrb } from "./OperationsStatusOrb";
import { OperationsTransitionsStrip } from "./OperationsTransitionsStrip";
import {
  asRecord,
  compactButtonStyle,
  formatMoney,
  formatPct,
  optionProviderContractId,
} from "./algoHelpers";
import {
  AlgoOverviewMetric as OverviewMetric,
  AlgoPipelineOverview as PipelineOverview,
} from "./AlgoOperationsPrimitives";
import { filterAccountPositionRowsForDeployment } from "./algoAccountPositions";
import { buildAttentionStream } from "../algoCockpitDiagnosticsModel";
import { useIbkrOptionQuoteStream } from "../../features/platform/live-streams";

const EmptyOperationsState = ({
  candidateDrafts,
  setupDataSettled,
  selectedDraft,
  setSelectedDraftId,
  deploymentName,
  setDeploymentName,
  symbolUniverseInput,
  setSymbolUniverseInput,
  handleCreateDeployment,
  createDeploymentMutation,
}) => (
  <div
    style={{
      minHeight: "60vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 0,
      padding: sp("12px 0"),
    }}
  >
    <div
      style={{
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        background: CSS_COLOR.bg1,
        padding: sp("14px 16px"),
        minWidth: 0,
        width: "min(100%, 460px)",
      }}
    >
      <SectionHeader title="Setup Shadow Deployment" />
      <div
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          lineHeight: 1.45,
          marginBottom: sp(8),
        }}
      >
        Shadow deployments paper-trade a promoted backtest strategy in real time.
      </div>
      {!setupDataSettled ? (
        <div
          data-testid="algo-setup-loading"
          style={{
            border: `1px dashed ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: fs(10),
            lineHeight: 1.45,
            padding: sp("14px 10px"),
          }}
        >
          Loading promoted drafts and shadow deployments...
        </div>
      ) : candidateDrafts.length ? (
        <div style={{ display: "grid", gap: sp(7) }}>
          <select
            value={selectedDraft?.id || ""}
            onChange={(event) => setSelectedDraftId(event.target.value)}
            style={{
              width: "100%",
              background: CSS_COLOR.bg1,
              border: "none",
              borderRadius: dim(RADII.md),
              padding: sp("8px 10px"),
              color: CSS_COLOR.text,
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
              background: CSS_COLOR.bg1,
              border: "none",
              borderRadius: dim(RADII.md),
              padding: sp("8px 10px"),
              color: CSS_COLOR.text,
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
              background: CSS_COLOR.bg1,
              border: "none",
              borderRadius: dim(RADII.md),
              padding: sp("8px 10px"),
              color: CSS_COLOR.text,
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
              background: CSS_COLOR.accent,
              color: CSS_COLOR.onAccent,
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
            border: `1px dashed ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            color: CSS_COLOR.textDim,
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
  </div>
);

const buildAlgoOptionQuoteGroups = ({
  candidates = [],
  positions = [],
  ledgerPositions = [],
}) => {
  const groups = new Map();
  const addContract = (contract, symbol) => {
    const record = asRecord(contract);
    const providerContractId = optionProviderContractId(record);
    const underlying = String(record.underlying || symbol || "").trim().toUpperCase();
    if (!providerContractId || !underlying) return;
    if (!groups.has(underlying)) groups.set(underlying, new Set());
    groups.get(underlying).add(providerContractId);
  };
  positions.forEach((position) => {
    addContract(asRecord(position).selectedContract, asRecord(position).symbol);
  });
  ledgerPositions.forEach((position) => {
    addContract(asRecord(position).optionContract, asRecord(position).symbol);
  });
  candidates.forEach((candidate) => {
    addContract(asRecord(candidate).selectedContract, asRecord(candidate).symbol);
  });
  return Array.from(groups, ([underlying, ids]) => ({
    underlying,
    providerContractIds: Array.from(ids),
  }));
};

const ALGO_OPTION_QUOTE_CANDIDATE_LIMIT = 12;
const ALGO_OPTION_QUOTE_CONTRACT_LIMIT = 16;

const limitAlgoOptionQuoteGroups = (
  groups,
  contractLimit = ALGO_OPTION_QUOTE_CONTRACT_LIMIT,
) => {
  let remaining = Math.max(0, Math.floor(contractLimit));
  if (!remaining) return [];

  return groups.flatMap((group) => {
    if (!remaining) return [];
    const providerContractIds = group.providerContractIds.slice(0, remaining);
    remaining -= providerContractIds.length;
    return providerContractIds.length
      ? [{ ...group, providerContractIds }]
      : [];
  });
};

const AlgoOptionQuoteStreamGroup = ({ underlying, providerContractIds }) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(underlying && providerContractIds.length),
    owner: `algo-operations:${underlying}`,
    intent: "automation-live",
    requiresGreeks: true,
  });
  return null;
};

const HEADER_ICON_SIZE = 13;

const activitySegmentColor = (tone) => {
  if (tone === "green") return CSS_COLOR.green;
  if (tone === "amber") return CSS_COLOR.amber;
  if (tone === "red") return CSS_COLOR.red;
  if (tone === "cyan") return CSS_COLOR.cyan;
  if (tone === "muted") return CSS_COLOR.textMuted;
  return CSS_COLOR.textDim;
};

const ActivitySummaryInline = ({ activitySummary }) => {
  if (!activitySummary?.segments?.length) return null;
  return (
    <div
      data-testid="algo-activity-summary"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: sp(5),
        rowGap: sp(2),
        padding: sp("2px 6px"),
        color: CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        minHeight: dim(24),
        minWidth: 0,
      }}
    >
      {activitySummary.segments.map((segment, index) => (
        <span
          key={`${segment.kind}-${index}`}
          style={{
            color: activitySegmentColor(segment.tone),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: segment.kind === "prefix" ? "0.04em" : "0.01em",
            textTransform: segment.kind === "prefix" ? "uppercase" : "none",
          }}
        >
          {segment.text}
        </span>
      ))}
    </div>
  );
};

export const AlgoLivePage = ({
  // Empty state
  deployments,
  candidateDrafts,
  setupDataSettled = true,
  selectedDraft,
  setSelectedDraftId,
  deploymentName,
  setDeploymentName,
  symbolUniverseInput,
  setSymbolUniverseInput,
  handleCreateDeployment,
  createDeploymentMutation,
  // KPI strip
  cockpitKpis,
  cockpitRisk,
  cockpitGeneratedAt,
  latestEvent,
  refreshPending,
  cockpitSignalFreshness,
  cockpitTradePath,
  signalOptionsPerformanceSummary,
  // Pipeline
  cockpitStageItems,
  selectedStage,
  setSelectedPipelineStageId,
  // Attention
  cockpitAttentionItems,
  signalOptionsRuleAdherence,
  gatewayReady,
  // Transitions
  transitions,
  // Signals
  visibleSignalRows,
  signalOptionsCandidates,
  signalMatrixStates = [],
  selectedCandidate,
  signalOptionsProfile,
  onOpenCandidateInTrade,
  // Positions
  signalOptionsPositions,
  signalOptionsLedgerPositionsQuery,
  // Drill
  symbolIndex,
  events,
  userPreferences,
  // Signal monitor (promoted header controls)
  signalMonitorProfile,
  strategySettingsDraft,
  // Smart summary
  activitySummary,
  // Pause / Scan-now (existing mutations + handlers)
  focusedDeployment,
  handleToggleDeployment,
  handleRunShadowScan,
  enableDeploymentMutation,
  pauseDeploymentMutation,
  runShadowScanMutation,
  // Layout
  algoIsPhone,
  algoIsNarrow,
  algoLayoutWidth = 0,
  // Slots
  auditPanel,
  rightRail,
}) => {
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const settingsDrawerRef = useRef(null);
  const focusedDeploymentId = focusedDeployment?.id || null;
  const focusedLedgerPositions = useMemo(
    () =>
      filterAccountPositionRowsForDeployment({
        rows: signalOptionsLedgerPositionsQuery?.data?.positions || [],
        deploymentId: focusedDeploymentId,
      }),
    [
      focusedDeploymentId,
      signalOptionsLedgerPositionsQuery?.data?.positions,
    ],
  );
  const visibleSignalSymbols = useMemo(
    () =>
      new Set(
        (visibleSignalRows || [])
          .map((row) => String(asRecord(row).symbol || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    [visibleSignalRows],
  );
  const optionQuoteCandidates = useMemo(() => {
    const seen = new Set();
    const selectedId = asRecord(selectedCandidate).id;
    const selectedSymbol = String(
      asRecord(selectedCandidate).symbol || "",
    ).trim().toUpperCase();
    const selectedCandidates = [];
    const visibleCandidates = [];

    (signalOptionsCandidates || []).forEach((candidate) => {
      const record = asRecord(candidate);
      const id = String(record.id || "");
      const symbol = String(record.symbol || "").trim().toUpperCase();
      const key = id || symbol;
      if (!key || seen.has(key)) return;
      const selected = Boolean(
        (selectedId && id === selectedId) ||
          (selectedSymbol && symbol === selectedSymbol),
      );
      if (!selected && !visibleSignalSymbols.has(symbol)) return;
      seen.add(key);
      if (selected) {
        selectedCandidates.push(candidate);
        return;
      }
      visibleCandidates.push(candidate);
    });

    return [...selectedCandidates, ...visibleCandidates].slice(
      0,
      ALGO_OPTION_QUOTE_CANDIDATE_LIMIT,
    );
  }, [selectedCandidate, signalOptionsCandidates, visibleSignalSymbols]);
  const optionQuoteGroups = useMemo(
    () =>
      limitAlgoOptionQuoteGroups(
        buildAlgoOptionQuoteGroups({
          candidates: optionQuoteCandidates,
          positions: signalOptionsPositions,
          ledgerPositions: focusedLedgerPositions,
        }),
      ),
    [
      focusedLedgerPositions,
      optionQuoteCandidates,
      signalOptionsPositions,
    ],
  );

  useEffect(() => {
    if (!settingsDrawerOpen) return;
    settingsDrawerRef.current?.focus();
  }, [settingsDrawerOpen]);

  if (!deployments.length) {
    return (
      <EmptyOperationsState
        candidateDrafts={candidateDrafts}
        setupDataSettled={setupDataSettled}
        selectedDraft={selectedDraft}
        setSelectedDraftId={setSelectedDraftId}
        deploymentName={deploymentName}
        setDeploymentName={setDeploymentName}
        symbolUniverseInput={symbolUniverseInput}
        setSymbolUniverseInput={setSymbolUniverseInput}
        handleCreateDeployment={handleCreateDeployment}
        createDeploymentMutation={createDeploymentMutation}
      />
    );
  }

  const attentionStream = buildAttentionStream({
    attentionItems: cockpitAttentionItems,
    ruleAdherence: signalOptionsRuleAdherence,
    gatewayReady,
    gatewayBlocks: cockpitTradePath.gatewayBlocks,
  });
  const realizedToday = Number(cockpitKpis?.dailyRealizedPnl ?? 0);
  const unrealized = Number(cockpitKpis?.openUnrealizedPnl ?? 0);
  const riskRecord = asRecord(cockpitRisk);
  const blockedCandidates = Number(cockpitKpis?.blockedCandidates ?? 0);
  const openPremiumValue = Number(
    riskRecord.openPremium ?? cockpitKpis?.openPremium ?? 0,
  );
  const maxOpenPremium = Number(
    riskRecord.maxOpenPremium ?? cockpitKpis?.maxOpenPremium,
  );
  const openPremiumUsage =
    Number.isFinite(openPremiumValue) &&
    Number.isFinite(maxOpenPremium) &&
    maxOpenPremium > 0
      ? Math.abs(openPremiumValue) / maxOpenPremium
      : null;
  const DeploymentToggleIcon = focusedDeployment?.enabled ? Pause : Play;
  const deploymentToggleLabel = focusedDeployment?.enabled ? "PAUSE" : "RESUME";
  const scanMutationPending = Boolean(runShadowScanMutation?.isPending);
  const scanButtonLabel = scanMutationPending ? "SCANNING..." : "SCAN NOW";
  const hasActivitySummary = Boolean(activitySummary?.segments?.length);
  const denseOperationsLayout = algoIsPhone || algoIsNarrow;
  const algoIsPocketWidth =
    Number.isFinite(Number(algoLayoutWidth)) && Number(algoLayoutWidth) > 0
      ? Number(algoLayoutWidth) < 520
      : false;
  const candidatesCount = Number(
    cockpitKpis?.candidates ?? signalOptionsCandidates.length,
  );
  const freshSignals = Number(cockpitSignalFreshness?.fresh ?? 0);
  const totalSignals =
    freshSignals + Number(cockpitSignalFreshness?.notFresh ?? 0);
  const freshSignalsPct =
    totalSignals > 0 ? formatPct((freshSignals / totalSignals) * 100, 0) : null;
  const openPositions = Number(
    cockpitKpis?.openPositions ?? signalOptionsPositions?.length ?? 0,
  );
  const pendingCandidates = Number(
    cockpitTradePath?.pendingCandidates ??
      signalOptionsCandidates?.filter(
        (candidate) =>
          candidate?.actionStatus === "candidate" ||
          candidate?.status === "candidate",
      ).length ??
      0,
  );
  const wins = Number(signalOptionsPerformanceSummary?.wins ?? 0);
  const losses = Number(signalOptionsPerformanceSummary?.losses ?? 0);
  const winRate = Number(signalOptionsPerformanceSummary?.winRatePercent);
  const profitFactor = Number(signalOptionsPerformanceSummary?.profitFactor);
  const recordDetail = [
    Number.isFinite(winRate) ? `${formatPct(winRate, 0)} win` : null,
    Number.isFinite(profitFactor) ? `PF ${profitFactor.toFixed(2)}` : null,
  ].filter(Boolean).join(" · ");
  const overviewMetrics = [
    {
      label: "Scan",
      value: scanMutationPending
        ? "scanning"
        : refreshPending
          ? "syncing data"
          : cockpitGeneratedAt
            ? formatRelativeTimeShort(cockpitGeneratedAt)
            : "waiting",
      detail: focusedDeployment?.lastEvaluatedAt
        ? `scan ${formatRelativeTimeShort(focusedDeployment.lastEvaluatedAt)}`
        : "no scan yet",
      color: scanMutationPending || refreshPending
        ? CSS_COLOR.amber
        : CSS_COLOR.textSec,
      icon: Clock,
      severity: scanMutationPending || refreshPending ? "warning" : "neutral",
    },
    {
      label: "Event",
      value: latestEvent ? formatEnumLabel(latestEvent.eventType) : "none",
      detail: latestEvent
        ? formatRelativeTimeShort(latestEvent.occurredAt)
        : "no execution events",
      color: latestEvent ? CSS_COLOR.cyan : CSS_COLOR.textDim,
      icon: Activity,
      severity: "neutral",
    },
    {
      label: "Signals",
      value: `${freshSignals} / ${totalSignals}`,
      detail: freshSignalsPct ? `${freshSignalsPct} fresh` : "no scan yet",
      color: freshSignals > 0 ? CSS_COLOR.green : CSS_COLOR.textSec,
      icon: Layers,
      severity: "neutral",
    },
    {
      label: "Flow",
      value: `${candidatesCount.toLocaleString()} candidates`,
      detail: `${blockedCandidates.toLocaleString()} blocked${
        pendingCandidates > 0 ? ` · ${pendingCandidates.toLocaleString()} pending` : ""
      }`,
      color: blockedCandidates > 0 ? CSS_COLOR.amber : CSS_COLOR.green,
      icon: Layers,
      severity: blockedCandidates > 0 ? "warning" : "neutral",
    },
    {
      label: "Risk",
      value: riskRecord.dailyHaltActive ? "halt active" : "within limits",
      detail: `loss left ${formatMoney(cockpitKpis?.dailyLossRemaining, 0)}`,
      color: riskRecord.dailyHaltActive ? CSS_COLOR.red : CSS_COLOR.green,
      icon: riskRecord.dailyHaltActive ? ShieldAlert : ShieldCheck,
      severity: riskRecord.dailyHaltActive ? "critical" : "neutral",
    },
    {
      label: "Exposure",
      value: formatMoney(openPremiumValue, 0),
      detail: `${riskRecord.openSymbols ?? cockpitKpis?.openSymbols ?? 0}/${riskRecord.maxOpenSymbols ?? cockpitKpis?.maxOpenSymbols ?? "?"} symbols`,
      color:
        openPremiumUsage != null && openPremiumUsage >= 0.7
          ? CSS_COLOR.amber
          : CSS_COLOR.textSec,
      icon: Wallet,
      severity:
        openPremiumUsage != null && openPremiumUsage >= 0.7
          ? "warning"
          : "neutral",
    },
    {
      label: "P&L",
      value: `R ${formatMoney(realizedToday, 0)} / U ${formatMoney(unrealized, 0)}`,
      detail: `${openPositions.toLocaleString()} open`,
      color: realizedToday + unrealized > 0 ? CSS_COLOR.green : realizedToday + unrealized < 0 ? CSS_COLOR.red : CSS_COLOR.text,
      icon: Wallet,
      severity: "neutral",
    },
    {
      label: "Record",
      value: `${wins}W / ${losses}L`,
      detail: recordDetail || "session",
      color: Number.isFinite(profitFactor) && profitFactor >= 1 ? CSS_COLOR.green : CSS_COLOR.textSec,
      icon: ShieldCheck,
      severity: "neutral",
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(algoIsPhone ? 3 : 6),
        minWidth: 0,
      }}
    >
      {optionQuoteGroups.map((group) => (
        <AlgoOptionQuoteStreamGroup
          key={group.underlying}
          underlying={group.underlying}
          providerContractIds={group.providerContractIds}
        />
      ))}

      {algoIsPhone ? (
        <button
          type="button"
          data-testid="algo-settings-drawer-open"
          onClick={() => setSettingsDrawerOpen(true)}
          style={{
            ...compactButtonStyle({ active: true, fill: false }),
            alignSelf: "flex-end",
            minHeight: dim(26),
            padding: sp("4px 9px"),
            border: `1px solid ${CSS_COLOR.accent}`,
            background: CSS_COLOR.accent,
            color: CSS_COLOR.onAccent,
          }}
        >
          Settings
        </button>
      ) : null}

      <div
        data-testid="algo-live-grid"
        style={{
          display: "grid",
          gridTemplateColumns:
            algoIsPhone
              ? "minmax(0, 1fr)"
              : algoIsNarrow
                ? "minmax(0, 1fr) 320px"
              : "minmax(0, 1fr) 380px",
          gap: sp(algoIsPhone ? 5 : 8),
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <div
          data-testid="algo-live-main-column"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(algoIsPhone ? 3 : 6),
            minWidth: 0,
          }}
        >
          <div
            data-testid="algo-operations-header"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(algoIsPhone ? 5 : 8),
              padding: algoIsPhone ? sp("4px 6px") : sp("6px 10px"),
              background: CSS_COLOR.bg0,
              borderBottom: `1px solid ${CSS_COLOR.border}`,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: sp(8),
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.text,
                  fontFamily: T.sans,
                  fontSize: fs(algoIsPhone ? 11 : 13),
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                }}
              >
                Pyrus Signals Shadow
              </span>
              <OperationsStatusOrb
                gatewayReady={gatewayReady}
                scanOn={Boolean(focusedDeployment?.enabled)}
                deploymentEnabled={focusedDeployment?.enabled}
                attentionItems={attentionStream}
              />
            </div>
            <div
              data-testid="algo-operations-header-monitor"
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(2),
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                tf {strategySettingsDraft?.signalTimeframe || "5m"} · h
                {strategySettingsDraft?.timeHorizon ?? 8} ·{" "}
                {strategySettingsDraft?.bosConfirmation || "wicks"}
              </span>
              {!algoIsPhone && signalMonitorProfile?.watchlistId ? (
                <span
                  style={{
                    color: CSS_COLOR.textMuted,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    maxWidth: dim(120),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  wl {signalMonitorProfile.watchlistId}
                </span>
              ) : null}
              {focusedDeployment ? (
                <span
                  aria-hidden="true"
                  style={{
                    width: 1,
                    height: dim(18),
                    background: CSS_COLOR.border,
                    marginInline: sp(1),
                  }}
                />
              ) : null}
              {focusedDeployment ? (
                <button
                  type="button"
                  onClick={() =>
                    handleToggleDeployment?.(focusedDeployment)
                  }
                  disabled={
                    enableDeploymentMutation?.isPending ||
                    pauseDeploymentMutation?.isPending
                  }
                  aria-label={focusedDeployment.enabled ? "Pause" : "Resume"}
                  title={focusedDeployment.enabled ? "Pause" : "Resume"}
                  style={{
                    ...compactButtonStyle({
                      disabled:
                        enableDeploymentMutation?.isPending ||
                        pauseDeploymentMutation?.isPending,
                    }),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: sp(3),
                    border: `1px solid ${
                      focusedDeployment.enabled ? CSS_COLOR.amber : CSS_COLOR.green
                    }`,
                    background: "transparent",
                    color: focusedDeployment.enabled ? CSS_COLOR.amber : CSS_COLOR.green,
                  }}
                >
                  <DeploymentToggleIcon
                    size={HEADER_ICON_SIZE}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {deploymentToggleLabel}
                </button>
              ) : null}
              {focusedDeployment ? (
                <button
                  type="button"
                  onClick={handleRunShadowScan}
                  disabled={runShadowScanMutation?.isPending}
                  aria-label="Scan now"
                  title="Scan now"
                  style={{
                    ...compactButtonStyle({
                      disabled: runShadowScanMutation?.isPending,
                    }),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: sp(3),
                    border: `1px solid ${CSS_COLOR.accent}`,
                    background: "transparent",
                    color: CSS_COLOR.accent,
                  }}
                >
                  <RefreshCw
                    size={HEADER_ICON_SIZE}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {scanButtonLabel}
                </button>
              ) : null}
            </div>
          </div>

          <section
            data-testid="algo-operations-overview"
            style={{
              display: "grid",
              gap: sp(algoIsPhone ? 4 : 7),
              padding: sp(algoIsPhone ? "5px" : denseOperationsLayout ? "7px" : "8px"),
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              background: CSS_COLOR.bg1,
              minWidth: 0,
            }}
          >
            <div
              data-testid="algo-snapshot-details"
              data-algo-pocket-grid={algoIsPocketWidth ? "two" : undefined}
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPocketWidth
                  ? "repeat(2, minmax(0, 1fr))"
                  : denseOperationsLayout
                    ? "repeat(auto-fit, minmax(132px, 1fr))"
                    : "repeat(auto-fit, minmax(150px, 1fr))",
                gap: sp(4),
                minWidth: 0,
              }}
            >
              {overviewMetrics.map((metric) => (
                <OverviewMetric
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  detail={metric.detail}
                  tone={metric.color}
                  icon={metric.icon}
                  severity={metric.severity}
                />
              ))}
            </div>

            <PipelineOverview
              stages={cockpitStageItems}
              selectedStageId={selectedStage?.id}
              onSelectStage={(id) => setSelectedPipelineStageId(id)}
              pocket={algoIsPocketWidth}
              dense={denseOperationsLayout}
            />

            <div
              data-testid="algo-operations-compact-status-row"
              data-algo-pocket-grid={algoIsPocketWidth ? "two" : undefined}
              style={{
                display: "grid",
                gridTemplateColumns: algoIsPocketWidth
                  ? "minmax(0, 1fr)"
                  : denseOperationsLayout
                    ? "repeat(auto-fit, minmax(160px, 1fr))"
                    : hasActivitySummary
                      ? "minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)"
                      : "minmax(0, 1fr) minmax(0, 1fr)",
                gap: sp(6),
                alignItems: "center",
                minWidth: 0,
                paddingTop: sp(2),
                borderTop: `1px solid ${CSS_COLOR.border}`,
              }}
            >
              {hasActivitySummary ? (
                <ActivitySummaryInline activitySummary={activitySummary} />
              ) : null}
              <OperationsAttentionStrip
                items={attentionStream}
                maxInline={algoIsPhone ? 2 : 3}
                embedded
              />
              <OperationsTransitionsStrip
                transitions={transitions || []}
                maxInline={algoIsPhone ? 2 : 3}
                embedded
              />
            </div>
          </section>

          <OperationsSignalTable
            signals={visibleSignalRows}
            candidates={signalOptionsCandidates}
            signalMatrixStates={signalMatrixStates}
            cockpitGeneratedAt={cockpitGeneratedAt}
            cockpitStageItems={cockpitStageItems}
            algoIsPhone={algoIsPhone}
            algoIsNarrow={algoIsNarrow}
            onOpenCandidateInTrade={onOpenCandidateInTrade}
            renderDrill={({ signal, candidate }) => {
              const symbol = String(signal?.symbol || "").toUpperCase();
              const indexed = symbolIndex?.[symbol] || {};
              return (
                <OperationsSignalDrill
                  signal={signal}
                  candidate={candidate || indexed.candidate}
                  position={indexed.position}
                  events={events || []}
                  userPreferences={userPreferences}
                  signalOptionsProfile={signalOptionsProfile}
                />
              );
            }}
          />

          <OperationsPositionsTable
            positions={signalOptionsPositions}
            accountPositionsQuery={signalOptionsLedgerPositionsQuery}
            symbolIndex={symbolIndex}
            deploymentId={focusedDeploymentId}
            signalOptionsProfile={signalOptionsProfile}
            algoIsPhone={algoIsPhone}
          />

          {auditPanel}
        </div>

        {!algoIsPhone ? (
          <div
            data-testid="algo-live-right-column"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: sp(6),
              minWidth: 0,
              height: "calc(100vh - 120px)",
              maxHeight: "calc(100vh - 120px)",
              position: "sticky",
              top: dim(44),
            }}
          >
            {rightRail}
          </div>
        ) : null}
      </div>
      {algoIsPhone && settingsDrawerOpen ? (
        <div
          data-testid="algo-settings-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Algo settings"
          tabIndex={-1}
          ref={settingsDrawerRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSettingsDrawerOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "flex-end",
            background: "rgba(0,0,0,0.48)",
          }}
          onClick={() => setSettingsDrawerOpen(false)}
        >
          <div
            style={{
              width: "100%",
              height: "90vh",
              background: CSS_COLOR.bg0,
              borderTop: `1px solid ${CSS_COLOR.border}`,
              boxShadow: "0 -18px 42px rgba(0,0,0,0.45)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                padding: sp("6px 8px"),
                borderBottom: `1px solid ${CSS_COLOR.border}`,
                flex: "0 0 auto",
              }}
            >
              <button
                type="button"
                data-testid="algo-settings-drawer-close"
                aria-label="Close algo settings"
                title="Close settings"
                onClick={() => setSettingsDrawerOpen(false)}
                style={{
                  ...compactButtonStyle(),
                  width: dim(30),
                  minWidth: dim(30),
                  height: dim(30),
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div style={{ flex: "1 1 auto", minHeight: 0 }}>
              {rightRail}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AlgoLivePage;
