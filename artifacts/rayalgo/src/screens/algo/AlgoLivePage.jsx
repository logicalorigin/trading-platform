import { useMemo } from "react";
import {
  Activity,
  Check,
  Clock,
  Layers,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
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
import { OperationsKpiStrip } from "./OperationsKpiStrip";
import { OperationsPositionsTable } from "./OperationsPositionsTable";
import { OperationsSignalDrill } from "./OperationsSignalDrill";
import { OperationsSignalTable } from "./OperationsSignalTable";
import { OperationsStatusOrb } from "./OperationsStatusOrb";
import { OperationsTransitionsStrip } from "./OperationsTransitionsStrip";
import { PipelineStrip } from "./PipelineStrip.jsx";
import {
  STRATEGY_SIGNAL_TIMEFRAMES,
  asRecord,
  compactButtonStyle,
  formatMoney,
  numberFrom,
  optionProviderContractId,
} from "./algoHelpers";
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
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        background: T.bg1,
        padding: sp("14px 16px"),
        minWidth: 0,
        width: "min(100%, 460px)",
      }}
    >
      <SectionHeader title="Setup Shadow Deployment" />
      <div
        style={{
          color: T.textDim,
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
            border: `1px dashed ${T.border}`,
            borderRadius: dim(RADII.sm),
            color: T.textDim,
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
              color: T.onAccent,
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
  candidates.forEach((candidate) => {
    addContract(asRecord(candidate).selectedContract, asRecord(candidate).symbol);
  });
  positions.forEach((position) => {
    addContract(asRecord(position).selectedContract, asRecord(position).symbol);
  });
  ledgerPositions.forEach((position) => {
    addContract(asRecord(position).optionContract, asRecord(position).symbol);
  });
  return Array.from(groups, ([underlying, ids]) => ({
    underlying,
    providerContractIds: Array.from(ids),
  }));
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
  if (tone === "green") return T.green;
  if (tone === "amber") return T.amber;
  if (tone === "red") return T.red;
  if (tone === "cyan") return T.cyan;
  if (tone === "muted") return T.textMuted;
  return T.textDim;
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
        color: T.textSec,
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
  signalOptionsProfile,
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
  setStrategySettingsDraft,
  handleSaveStrategySettings,
  updateStrategySettingsMutation,
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
  const optionQuoteGroups = useMemo(
    () =>
      buildAlgoOptionQuoteGroups({
        candidates: signalOptionsCandidates,
        positions: signalOptionsPositions,
        ledgerPositions: focusedLedgerPositions,
      }),
    [
      focusedLedgerPositions,
      signalOptionsCandidates,
      signalOptionsPositions,
    ],
  );

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
  const scanButtonLabel = runShadowScanMutation?.isPending
    ? "SCANNING..."
    : "SCAN NOW";
  const hasActivitySummary = Boolean(activitySummary?.segments?.length);
  const denseOperationsLayout = algoIsPhone || algoIsNarrow;
  const algoIsPocketWidth =
    Number.isFinite(Number(algoLayoutWidth)) && Number(algoLayoutWidth) > 0
      ? Number(algoLayoutWidth) < 520
      : false;
  const snapshotFacts = [
    {
      label: "Snapshot",
      value: refreshPending
        ? "refreshing"
        : cockpitGeneratedAt
          ? formatRelativeTimeShort(cockpitGeneratedAt)
          : "waiting",
      detail: focusedDeployment?.lastEvaluatedAt
        ? `scan ${formatRelativeTimeShort(focusedDeployment.lastEvaluatedAt)}`
        : "no scan yet",
      color: refreshPending ? T.amber : T.textSec,
      icon: Clock,
      severity: refreshPending ? "warning" : "neutral",
    },
    {
      label: "Latest event",
      value: latestEvent ? formatEnumLabel(latestEvent.eventType) : "none",
      detail: latestEvent
        ? formatRelativeTimeShort(latestEvent.occurredAt)
        : "no execution events",
      color: latestEvent ? T.cyan : T.textDim,
      icon: Activity,
      severity: "neutral",
    },
    {
      label: "Candidates",
      value: String(cockpitKpis?.candidates ?? signalOptionsCandidates.length),
      detail: `${blockedCandidates} blocked`,
      color: blockedCandidates > 0 ? T.amber : T.green,
      icon: Layers,
      severity: blockedCandidates > 0 ? "warning" : "neutral",
    },
    {
      label: "Risk",
      value: riskRecord.dailyHaltActive ? "halt active" : "within limits",
      detail: `loss left ${formatMoney(cockpitKpis?.dailyLossRemaining, 0)}`,
      color: riskRecord.dailyHaltActive ? T.red : T.green,
      icon: riskRecord.dailyHaltActive ? ShieldAlert : ShieldCheck,
      severity: riskRecord.dailyHaltActive ? "critical" : "neutral",
    },
    {
      label: "Open premium",
      value: formatMoney(openPremiumValue, 0),
      detail: `${riskRecord.openSymbols ?? cockpitKpis?.openSymbols ?? 0}/${riskRecord.maxOpenSymbols ?? cockpitKpis?.maxOpenSymbols ?? "?"} symbols`,
      color:
        openPremiumUsage != null && openPremiumUsage >= 0.7
          ? T.amber
          : T.textSec,
      icon: Wallet,
      severity:
        openPremiumUsage != null && openPremiumUsage >= 0.7
          ? "warning"
          : "neutral",
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

      <div
        data-testid="algo-operations-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("6px 10px"),
          background: T.bg0,
          borderBottom: `1px solid ${T.border}`,
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
              color: T.text,
              fontFamily: T.sans,
              fontSize: fs(13),
              fontWeight: 600,
              letterSpacing: "0.01em",
            }}
          >
            RayReplica Shadow
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
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            tf
            <select
              value={strategySettingsDraft?.signalTimeframe || "5m"}
              onChange={(event) =>
                setStrategySettingsDraft?.((current) => ({
                  ...current,
                  signalTimeframe: event.target.value,
                }))
              }
              disabled={updateStrategySettingsMutation?.isPending}
              style={{
                background: T.bg1,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.xs),
                padding: sp("1px 4px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              {STRATEGY_SIGNAL_TIMEFRAMES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            h=
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={strategySettingsDraft?.timeHorizon ?? 8}
              onChange={(event) =>
                setStrategySettingsDraft?.((current) => ({
                  ...current,
                  timeHorizon: numberFrom(event.target.value, 8),
                }))
              }
              disabled={updateStrategySettingsMutation?.isPending}
              style={{
                width: dim(48),
                background: T.bg1,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.xs),
                padding: sp("1px 4px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                textAlign: "center",
              }}
            />
          </label>
          {!algoIsPhone && signalMonitorProfile?.watchlistId ? (
            <span
              style={{
                color: T.textMuted,
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
          <button
            type="button"
            onClick={handleSaveStrategySettings}
            disabled={
              !handleSaveStrategySettings ||
              updateStrategySettingsMutation?.isPending
            }
            aria-label="Apply strategy settings"
            title="Apply strategy settings"
            style={{
              ...compactButtonStyle({
                disabled:
                  !handleSaveStrategySettings ||
                  updateStrategySettingsMutation?.isPending,
              }),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: sp(3),
              border: "none",
              background: T.accent,
              color: T.onAccent,
            }}
          >
            <Check
              size={HEADER_ICON_SIZE}
              strokeWidth={2}
              aria-hidden="true"
            />
            {updateStrategySettingsMutation?.isPending ? "SAVING..." : "APPLY"}
          </button>
          {focusedDeployment ? (
            <span
              aria-hidden="true"
              style={{
                width: 1,
                height: dim(18),
                background: T.border,
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
                  focusedDeployment.enabled ? T.amber : T.green
                }`,
                background: "transparent",
                color: focusedDeployment.enabled ? T.amber : T.green,
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
                border: `1px solid ${T.accent}`,
                background: "transparent",
                color: T.accent,
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
          {algoIsPhone ? null : (
            <span
              style={{
                color: T.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                marginLeft: sp(4),
              }}
            >
              Realized{" "}
              <span style={{ color: realizedToday >= 0 ? T.green : T.red }}>
                {formatMoney(realizedToday, 2)}
              </span>
              {" · "}
              Unrealized{" "}
              <span style={{ color: unrealized >= 0 ? T.green : T.red }}>
                {formatMoney(unrealized, 2)}
              </span>
            </span>
          )}
        </div>
      </div>

      <div
        data-testid="algo-snapshot-details"
        data-algo-pocket-grid={algoIsPocketWidth ? "two" : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: algoIsPocketWidth
            ? "repeat(2, minmax(0, 1fr))"
            : denseOperationsLayout
              ? "repeat(auto-fit, minmax(145px, 1fr))"
              : "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 1,
          border: `1px solid ${T.border}`,
          borderRadius: dim(RADII.sm),
          background: T.border,
          padding: sp(1),
          minWidth: 0,
        }}
      >
        {snapshotFacts.map((fact) => {
          const FactIcon = fact.icon;
          const isCritical = fact.severity === "critical";
          const isWarning = fact.severity === "warning";
          const cardBackground = isCritical
            ? T.redBg
            : isWarning
              ? T.amberBg
              : T.bg1;
          const iconTone = isCritical
            ? T.red
            : isWarning
              ? T.amber
              : fact.color;
          return (
            <div
              key={fact.label}
              title={`${fact.label}: ${fact.value}${fact.detail ? ` · ${fact.detail}` : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(denseOperationsLayout ? 4 : 5),
                borderRadius: dim(RADII.xs),
                background: cardBackground,
                padding: sp(denseOperationsLayout ? "3px 6px" : "3px 7px"),
                minHeight: dim(denseOperationsLayout ? 26 : 28),
                minWidth: 0,
              }}
            >
              {FactIcon ? (
                <FactIcon
                  size={13}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  style={{ color: iconTone, flex: "0 0 auto" }}
                />
              ) : null}
              <span
                style={{
                  color: T.textMuted,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: "0 1 auto",
                  minWidth: 0,
                }}
              >
                {fact.label}
              </span>
              <span
                style={{
                  color: fact.color,
                  fontFamily: T.sans,
                  fontSize: textSize("bodyStrong"),
                  fontWeight: 600,
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {fact.value}
              </span>
              <span
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: denseOperationsLayout ? "none" : "inline",
                }}
              >
                {fact.detail}
              </span>
            </div>
          );
        })}
      </div>

      <OperationsKpiStrip
        cockpitKpis={cockpitKpis}
        cockpitSignalFreshness={cockpitSignalFreshness}
        cockpitTradePath={cockpitTradePath}
        signalOptionsPerformanceSummary={signalOptionsPerformanceSummary}
        signalOptionsPositions={signalOptionsPositions}
        signalOptionsCandidates={signalOptionsCandidates}
        deploymentId={focusedDeployment?.id || null}
        algoIsPhone={algoIsPhone}
        algoIsNarrow={algoIsNarrow}
        algoIsPocketWidth={algoIsPocketWidth}
      />

      <div
        data-testid="algo-operations-pipeline-strip"
        style={{
          background: "transparent",
          border: "none",
          borderRadius: 0,
          padding: 0,
          minWidth: 0,
        }}
      >
        <PipelineStrip
          stages={cockpitStageItems}
          selectedStageId={selectedStage?.id}
          onSelectStage={(id) => setSelectedPipelineStageId(id)}
          narrow
        />
      </div>

      <div
        data-testid="algo-operations-compact-status-row"
        data-algo-pocket-grid={algoIsPocketWidth ? "two" : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: algoIsPocketWidth
            ? "repeat(2, minmax(0, 1fr))"
            : denseOperationsLayout
              ? "repeat(auto-fit, minmax(150px, 1fr))"
              : "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 1,
          border: `1px solid ${T.border}`,
          borderRadius: dim(RADII.sm),
          background: T.border,
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {hasActivitySummary ? (
          <div
            style={{
              minWidth: 0,
              background: T.bg1,
              gridColumn: algoIsPhone ? "1 / -1" : undefined,
            }}
          >
            <ActivitySummaryInline activitySummary={activitySummary} />
          </div>
        ) : null}
        <div
          style={{
            minWidth: 0,
            background: T.bg1,
          }}
        >
          <OperationsAttentionStrip
            items={attentionStream}
            maxInline={algoIsPhone ? 2 : 3}
            embedded
          />
        </div>
        <div
          style={{
            minWidth: 0,
            background: T.bg1,
          }}
        >
          <OperationsTransitionsStrip
            transitions={transitions || []}
            maxInline={algoIsPhone ? 2 : 4}
            embedded
          />
        </div>
      </div>

      <div
        data-testid="algo-live-grid"
        style={{
          display: "grid",
          gridTemplateColumns:
            algoIsPhone || algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) 380px",
          gap: sp(8),
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
          <OperationsSignalTable
            signals={visibleSignalRows}
            candidates={signalOptionsCandidates}
            signalMatrixStates={signalMatrixStates}
            algoIsPhone={algoIsPhone}
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

        <div
          data-testid="algo-live-right-column"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(algoIsPhone ? 3 : 6),
            minWidth: 0,
          }}
        >
          {rightRail}
        </div>
      </div>
    </div>
  );
};

export default AlgoLivePage;
