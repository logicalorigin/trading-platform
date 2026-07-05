import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AppTooltip } from "@/components/ui/tooltip";
import { Select } from "../../components/platform/primitives.jsx";
import {
  Activity,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  CSS_COLOR,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatEnumLabel, formatRelativeTimeShort } from "../../lib/formatters";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { FailurePointTooltip } from "../../components/platform/FailurePointTooltip.jsx";
import { OperationsAttentionStrip } from "./OperationsAttentionStrip";
import { resolveOperationsStatus } from "./OperationsStatusOrb";
import { OperationsTransitionsStrip } from "./OperationsTransitionsStrip";
import {
  asRecord,
  buildSignalIndicatorMetrics,
  compactButtonStyle,
  formatMoney,
  formatPct,
  normalizeStrategySignalTimeframe,
  optionProviderContractId,
} from "./algoHelpers";
import { normalizeAlgoMtfRequiredCount } from "./algoTimeframeControls";
import {
  AlgoIndicatorKpiTable,
  AlgoOverviewMetric as OverviewMetric,
  AlgoPipelineOverview as PipelineOverview,
} from "./AlgoOperationsPrimitives";
import { filterAccountPositionRowsForDeployment } from "./algoAccountPositions";
import { buildAttentionStream } from "../algoCockpitDiagnosticsModel";
import { useIbkrOptionQuoteStream } from "../../features/platform/live-streams";
import { AlgoDeploymentTabs } from "./AlgoDeploymentTabs.jsx";
import { IbkrStatusWave } from "../../features/platform/IbkrConnectionStatus";
import {
  canonicalizeStreamState,
  streamStateTokenVar,
} from "../../features/platform/streamSemantics";
import { buildAlgoStatusFailurePoint } from "../../features/platform/failurePointModel.js";
import { OperationsPositionsTable } from "./OperationsPositionsTable";
import { OperationsSignalTable } from "./OperationsSignalTable";

export const preloadAlgoLivePageModules = () => Promise.resolve();

const EmptyOperationsState = ({
  candidateDrafts,
  setupDataSettled,
  deploymentListUnavailable = false,
  selectedDraft,
  setSelectedDraftId,
  deploymentName,
  setDeploymentName,
  symbolUniverseInput,
  setSymbolUniverseInput,
  handleCreateDeployment,
  createDeploymentMutation,
}) => {
  const title = !setupDataSettled
    ? "Loading Signal Operations"
    : deploymentListUnavailable
      ? "Signal-Options Deployment Data Unavailable"
      : candidateDrafts.length
      ? "Create Signal-Options Deployment"
      : "Signal-Options Deployment Unavailable";
  const summary = !setupDataSettled
    ? "Fetching algo deployments and signal-options automation state."
    : deploymentListUnavailable
      ? "The deployment list is temporarily unavailable. Existing signal-options deployments may still be present; refresh to retry the request."
      : candidateDrafts.length
      ? "Create a shadow deployment from an available strategy draft."
      : "No signal-options deployments are available yet. The default shadow deployment should be seeded at startup.";

  return (
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
        <SectionHeader title={title} />
        <div
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            lineHeight: 1.45,
            marginBottom: sp(8),
          }}
        >
          {summary}
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
            Loading algo deployments and signal-options state...
          </div>
        ) : deploymentListUnavailable ? (
          <div
            data-testid="algo-deployments-unavailable"
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
            Waiting for a fresh deployment list...
          </div>
        ) : candidateDrafts.length ? (
          <div style={{ display: "grid", gap: sp(7) }}>
            <Select
              value={selectedDraft?.id || ""}
              onChange={(next) => setSelectedDraftId(next)}
              options={candidateDrafts.map((draft) => ({
                value: draft.id,
                label: `${draft.name} · ${draft.mode} · ${draft.symbolUniverse.length} syms`,
              }))}
              style={{ width: "100%" }}
            />
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
              }}
            />
            <button
              type="button"
              onClick={() => handleCreateDeployment()}
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
                : "CREATE SIGNAL-OPTIONS DEPLOYMENT"}
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
            Restart the API or check the default signal-options seed if this stays
            empty.
          </div>
        )}
      </div>
    </div>
  );
};

export const resolveAlgoOverviewMetricGridTemplate = ({
  algoIsPhone = false,
  algoIsPocketWidth = false,
  denseOperationsLayout = false,
} = {}) => {
  if (algoIsPhone && algoIsPocketWidth) {
    return "repeat(2, minmax(0, 1fr))";
  }
  return denseOperationsLayout
    ? "repeat(auto-fit, minmax(104px, max-content))"
    : "repeat(auto-fit, minmax(128px, max-content))";
};

const EMPTY_STA_TABLE_SNAPSHOT = Object.freeze({
  signature: "",
  signalRows: Object.freeze([]),
  rowCount: 0,
  receivedCount: 0,
  actionCount: 0,
  historyCount: 0,
  activeFilterLabel: "All",
});

export const resolveEffectiveStaMtfAlignmentConfig = ({
  mtfAlignmentDraft = null,
  signalOptionsProfile = null,
} = {}) => {
  const source = mtfAlignmentDraft ?? signalOptionsProfile?.entryGate?.mtfAlignment;
  if (!source) return null;
  const timeframes = Array.isArray(source.timeframes) ? source.timeframes : [];
  return {
    ...source,
    timeframes,
    requiredCount: normalizeAlgoMtfRequiredCount(
      source.requiredCount,
      timeframes,
    ),
  };
};

export const alignSignalCycleStageWithStaTable = (
  stages = [],
  staTableSnapshot = null,
) => {
  if (!staTableSnapshot || !Array.isArray(stages)) return stages;
  return stages.map((stage) => {
    const record = asRecord(stage);
    if (record.id !== "signal_detected") return stage;
    return {
      ...record,
      count: staTableSnapshot.rowCount,
      detail: `${staTableSnapshot.rowCount.toLocaleString()} table-visible STA rows`,
    };
  });
};

const resolveDeploymentAccountLabel = ({ deployment, accountId }) => {
  const providerAccountId = deployment?.providerAccountId || null;
  if (providerAccountId) {
    return providerAccountId;
  }
  return accountId || null;
};

const headerChipStyle = ({ color = CSS_COLOR.textMuted, active = false } = {}) => ({
  display: "inline-flex",
  alignItems: "center",
  minHeight: dim(20),
  padding: sp("2px 6px"),
  border: `1px solid ${active ? color : CSS_COLOR.border}`,
  borderRadius: dim(RADII.pill),
  background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : CSS_COLOR.bg1,
  color,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: 600,
  letterSpacing: "0.03em",
  lineHeight: 1,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
});

const headerActionButtonStyle = ({ color, disabled = false, divided = false } = {}) => ({
  ...compactButtonStyle({ disabled }),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: dim(32),
  minHeight: dim(30),
  padding: sp("6px 8px"),
  border: "none",
  borderLeft: divided ? `1px solid ${CSS_COLOR.border}` : "none",
  borderRadius: 0,
  background: "transparent",
  color: disabled ? CSS_COLOR.textMuted : color,
});

export const resolveAttentionSeverity = (attentionItems = []) => {
  if (!attentionItems?.length) return null;
  if (attentionItems.some((item) => item?.severity === "warning")) return "warning";
  return "info";
};

const resolveHeaderScanWaveMotion = (status) => {
  const state = canonicalizeStreamState(status, "no-subscribers");
  if (state === "healthy") return "fast";
  if (state === "checking" || state === "capacity-limited" || state === "reconnecting") {
    return "slow";
  }
  return "flat";
};

export const resolveHeaderScanWave = ({
  scanRunning = false,
  refreshPending = false,
  deploymentEnabled = false,
  signalScanReady = true,
  attentionSeverity = null,
} = {}) => {
  const infoOnlyScanPause = signalScanReady === false && attentionSeverity === "info";
  if (infoOnlyScanPause) {
    const status = scanRunning ? "healthy" : refreshPending ? "checking" : "no-subscribers";
    const state = canonicalizeStreamState(status, "no-subscribers");
    const badgeLabel =
      state === "healthy"
        ? scanRunning
          ? "scanning"
          : "running"
        : state === "checking"
          ? "syncing"
          : "paused";
    return {
      status: state,
      wave: resolveHeaderScanWaveMotion(state),
      color: streamStateTokenVar(state),
      label: `Signal-options ${badgeLabel}`,
      badgeLabel,
      active: state !== "no-subscribers",
    };
  }

  const operationsStatus = resolveOperationsStatus({
    gatewayReady: signalScanReady,
    scanOn: deploymentEnabled,
    deploymentEnabled,
    attentionSeverity,
  });
  const status =
    operationsStatus === "warning"
      ? "offline"
      : scanRunning
        ? "healthy"
        : refreshPending
          ? "checking"
          : operationsStatus === "healthy"
            ? "healthy"
          : operationsStatus === "attention"
            ? "capacity-limited"
            : "no-subscribers";
  const state = canonicalizeStreamState(status, "no-subscribers");
  const badgeLabel =
    state === "healthy"
      ? scanRunning
        ? "scanning"
        : "running"
      : state === "checking"
        ? "syncing"
        : state === "capacity-limited"
          ? "attention"
          : state === "offline"
            ? "warning"
            : "paused";
  return {
    status: state,
    wave: resolveHeaderScanWaveMotion(state),
    color: streamStateTokenVar(state),
    label: `Signal-options ${badgeLabel}`,
    badgeLabel,
    active: state !== "no-subscribers",
  };
};

const buildAlgoOptionQuoteGroups = ({
  candidates = [],
  positions = [],
  ledgerPositions = [],
  signals = [],
}) => {
  const groups = new Map();
  const primaryContractKeys = new Set();
  const addContract = (contract, symbol, source = "primary") => {
    const record = asRecord(contract);
    const providerContractId = optionProviderContractId(record);
    const underlying = String(record.underlying || symbol || "").trim().toUpperCase();
    if (!providerContractId || !underlying) return;
    const contractKey = `${underlying}:${providerContractId}`;
    if (source === "preview" && primaryContractKeys.has(contractKey)) return;
    if (source !== "preview") primaryContractKeys.add(contractKey);

    const groupKey = `${source === "preview" ? "preview" : "primary"}:${underlying}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        source: source === "preview" ? "preview" : "primary",
        underlying,
        providerContractIds: [],
        providerContractIdSet: new Set(),
        requiresGreeks: true,
      });
    }
    const group = groups.get(groupKey);
    if (group.providerContractIdSet.has(providerContractId)) return;
    group.providerContractIdSet.add(providerContractId);
    group.providerContractIds.push(providerContractId);
  };
  positions.forEach((position) => {
    addContract(asRecord(position).selectedContract, asRecord(position).symbol, "primary");
  });
  ledgerPositions.forEach((position) => {
    addContract(asRecord(position).optionContract, asRecord(position).symbol, "primary");
  });
  candidates.forEach((candidate) => {
    addContract(asRecord(candidate).selectedContract, asRecord(candidate).symbol, "primary");
  });
  signals.forEach((signal) => {
    const record = asRecord(signal);
    addContract(
      asRecord(asRecord(record.contractPreview).selectedContract),
      record.symbol,
      "preview",
    );
  });
  return Array.from(groups.values()).map(({ providerContractIdSet, ...group }) => group);
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

export const buildAlgoOptionQuoteStreamSubscription = (groups = []) => {
  const providerContractIds = [];
  const seenProviderContractIds = new Set();
  const underlyings = new Set();
  let requiresGreeks = false;

  groups.forEach((group) => {
    const groupProviderContractIds = Array.isArray(group?.providerContractIds)
      ? group.providerContractIds
      : [];
    const normalizedUnderlying = String(group?.underlying || "")
      .trim()
      .toUpperCase();
    if (!normalizedUnderlying) {
      return;
    }
    groupProviderContractIds.forEach((providerContractId) => {
      const normalizedProviderContractId = String(providerContractId || "").trim();
      if (!normalizedProviderContractId || seenProviderContractIds.has(normalizedProviderContractId)) {
        return;
      }
      seenProviderContractIds.add(normalizedProviderContractId);
      providerContractIds.push(normalizedProviderContractId);
      if (normalizedUnderlying) {
        underlyings.add(normalizedUnderlying);
      }
    });
    if (group?.requiresGreeks !== false) {
      requiresGreeks = true;
    }
  });

  if (!providerContractIds.length) {
    return null;
  }

  const underlyingList = Array.from(underlyings).sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    underlying: underlyingList.length === 1 ? underlyingList[0] : null,
    providerContractIds,
    owner: `algo-option-quotes:${providerContractIds.length}-contracts`,
    requiresGreeks,
  };
};

const AlgoOptionQuoteStreamGroup = ({
  underlying,
  providerContractIds,
  owner,
  requiresGreeks = true,
}) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(providerContractIds.length),
    owner: owner || `algo-operations:${underlying}`,
    intent: "automation-live",
    requiresGreeks,
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
  const segments = activitySummary?.segments || [];
  const hasMeaningfulSegment = segments.some(
    (segment) => segment.kind !== "prefix" && segment.kind !== "noop",
  );
  if (!hasMeaningfulSegment) return null;
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
      {segments.map((segment, index) => (
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
  pnlByDeploymentId = null,
  candidateDrafts,
  setupDataSettled = true,
  deploymentListUnavailable = false,
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
  signalScanReady = true,
  signalScanBlockedReason = null,
  // Transitions
  transitions,
  // Signals
  visibleSignalRows,
  signalMonitorEventsSourceStatus = "database",
  signalOptionsCandidates,
  signalMatrixStates = [],
  selectedCandidate,
  signalOptionsProfile,
  mtfAlignmentDraft,
  staSignalTimeframes,
  onOpenCandidateInTrade,
  safeQaMode = false,
  // Positions
  signalOptionsPositions,
  signalOptionsLedgerPositionsQuery,
  // Drill
  symbolIndex,
  events,
  userPreferences,
  // Signal monitor (promoted header controls)
  strategySettingsDraft,
  // Smart summary
  activitySummary,
  // Pause / Scan-now (existing mutations + handlers)
  focusedDeployment,
  onSelectDeployment,
  onAddDeployment,
  onToggleDeploymentMode,
  modeChangePending = false,
  accountId,
  environment,
  bridgeTone,
  handleToggleDeployment,
  handleRefreshSignals,
  enableDeploymentMutation,
  pauseDeploymentMutation,
  algoExecutionScanRunning,
  // Layout
  algoIsPhone,
  algoIsNarrow,
  algoLayoutWidth = 0,
  // Slots
  rightRail,
  rightRailFallback = null,
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
  const optionQuoteGroups = useMemo(() => {
    const groups = buildAlgoOptionQuoteGroups({
      candidates: optionQuoteCandidates,
      positions: signalOptionsPositions,
      ledgerPositions: focusedLedgerPositions,
      signals: visibleSignalRows,
    }).map((group) => ({
      ...group,
      owner:
        group.source === "preview"
          ? `signal-options-preview:${focusedDeploymentId || "active"}:${group.underlying}`
          : `algo-operations:${group.underlying}`,
    }));
    return limitAlgoOptionQuoteGroups(groups, ALGO_OPTION_QUOTE_CONTRACT_LIMIT);
  }, [
    focusedDeploymentId,
    focusedLedgerPositions,
    optionQuoteCandidates,
    signalOptionsPositions,
    visibleSignalRows,
  ]);
  const optionQuoteStreamSubscription = useMemo(
    () => buildAlgoOptionQuoteStreamSubscription(optionQuoteGroups),
    [optionQuoteGroups],
  );

  useEffect(() => {
    if (!settingsDrawerOpen) return;
    settingsDrawerRef.current?.focus();
  }, [settingsDrawerOpen]);
  const renderedRightRail = rightRail ?? rightRailFallback;
  const [staTableSnapshot, setStaTableSnapshot] = useState(
    EMPTY_STA_TABLE_SNAPSHOT,
  );
  const handleStaRowsChange = useCallback((nextSnapshot) => {
    const snapshot = nextSnapshot || EMPTY_STA_TABLE_SNAPSHOT;
    setStaTableSnapshot((current) =>
      current.signature === snapshot.signature &&
      current.rowCount === snapshot.rowCount &&
      current.receivedCount === snapshot.receivedCount &&
      current.actionCount === snapshot.actionCount &&
      current.historyCount === snapshot.historyCount &&
      current.activeFilterLabel === snapshot.activeFilterLabel
        ? current
        : snapshot,
    );
  }, []);
  const effectiveMtfAlignmentConfig = useMemo(
    () =>
      resolveEffectiveStaMtfAlignmentConfig({
        mtfAlignmentDraft,
        signalOptionsProfile,
      }),
    [
      mtfAlignmentDraft,
      signalOptionsProfile,
    ],
  );
  const indicatorSignalRows = staTableSnapshot.signalRows || [];
  const indicatorTimelineBars = useMemo(() => {
    const horizon = Number(strategySettingsDraft?.timeHorizon);
    return Number.isFinite(horizon)
      ? Math.max(1, Math.min(50, Math.round(horizon)))
      : 8;
  }, [strategySettingsDraft?.timeHorizon]);
  const cockpitStageItemsForDisplay = useMemo(
    () => alignSignalCycleStageWithStaTable(cockpitStageItems, staTableSnapshot),
    [cockpitStageItems, staTableSnapshot],
  );
  // Keep the header cards tied to the rows computed by the STA table below.
  // The table owns filtering; KPI consumers only read its published snapshot.
  const liveIndicatorMetrics = useMemo(
    () =>
      buildSignalIndicatorMetrics(indicatorSignalRows, {
        timelineBars: indicatorTimelineBars,
      }),
    [indicatorSignalRows, indicatorTimelineBars],
  );

  const showEmptyOperationsState = Boolean(setupDataSettled && !deployments.length);
  if (showEmptyOperationsState) {
    return (
      <EmptyOperationsState
        candidateDrafts={candidateDrafts}
        setupDataSettled={setupDataSettled}
        deploymentListUnavailable={deploymentListUnavailable}
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
  const attentionSeverity = resolveAttentionSeverity(attentionStream);
  const realizedToday = Number(cockpitKpis?.dailyRealizedPnl ?? 0);
  const unrealized = Number(cockpitKpis?.openUnrealizedPnl ?? 0);
  const riskRecord = asRecord(cockpitRisk);
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
  const deploymentToggleLabel = focusedDeployment?.enabled ? "Pause" : "Resume";
  const scanOperationRunning = Boolean(algoExecutionScanRunning);
  const safeQaControlsPaused = Boolean(safeQaMode);
  const scanBlocked = !signalScanReady;
  const deploymentToggleDisabled =
    safeQaControlsPaused ||
    enableDeploymentMutation?.isPending ||
    pauseDeploymentMutation?.isPending;
  const scanButtonDisabled =
    safeQaControlsPaused || scanOperationRunning || scanBlocked;
  const deploymentToggleActionLabel = safeQaControlsPaused
    ? "Deployment controls paused in safe QA"
    : deploymentToggleLabel;
  const scanButtonActionLabel = safeQaControlsPaused
    ? "Signal scan paused in safe QA"
    : scanBlocked
      ? signalScanBlockedReason || "Signal scan unavailable"
    : scanOperationRunning
      ? "Signal action scan already running"
      : "Run signal scan";
  const operationsStatus = resolveOperationsStatus({
    gatewayReady,
    scanOn: Boolean(focusedDeployment?.enabled),
    deploymentEnabled: Boolean(focusedDeployment?.enabled),
    attentionSeverity,
  });
  const algoHeaderFailurePoint = buildAlgoStatusFailurePoint({
    status: operationsStatus,
    gatewayReady,
    scanOn: Boolean(focusedDeployment?.enabled),
    deploymentEnabled: Boolean(focusedDeployment?.enabled),
    attentionItems: attentionStream,
    cockpitTradePath,
  });
  const headerScanWave = resolveHeaderScanWave({
    scanRunning: scanOperationRunning,
    refreshPending,
    deploymentEnabled: Boolean(focusedDeployment?.enabled),
    signalScanReady,
    attentionSeverity,
  });
  const deploymentMode = String(
    focusedDeployment?.mode || environment || "",
  ).toUpperCase();
  const symbolCount = focusedDeployment?.symbolUniverse?.length ?? 0;
  const accountLabel = resolveDeploymentAccountLabel({
    deployment: focusedDeployment,
    accountId,
  });
  const headerStatusItems = [
    deploymentMode
      ? { label: deploymentMode, color: CSS_COLOR.textSec, active: false }
      : null,
    signalScanReady
      ? null
      : {
          label: "scan paused",
          color: CSS_COLOR.amber,
          active: true,
        },
    {
      label: gatewayReady ? "broker ready" : "broker off",
      color: gatewayReady ? CSS_COLOR.green : CSS_COLOR.amber,
      active: !gatewayReady,
    },
    bridgeTone?.label && bridgeTone.color !== CSS_COLOR.green
      ? { label: bridgeTone.label, color: bridgeTone.color, active: true }
      : null,
  ].filter(Boolean);
  const hasActivitySummary = Boolean(
    activitySummary?.segments?.some(
      (segment) => segment.kind !== "prefix" && segment.kind !== "noop",
    ),
  );
  const denseOperationsLayout = algoIsPhone || algoIsNarrow;
  const algoIsPocketWidth =
    Number.isFinite(Number(algoLayoutWidth)) && Number(algoLayoutWidth) > 0
      ? Number(algoLayoutWidth) < 520
      : false;
  const openPositions = Number(
    cockpitKpis?.openPositions ?? signalOptionsPositions?.length ?? 0,
  );
  const rawWins = Number(signalOptionsPerformanceSummary?.wins ?? 0);
  const rawLosses = Number(signalOptionsPerformanceSummary?.losses ?? 0);
  const closedTradeCount = Number(signalOptionsPerformanceSummary?.closedTrades ?? 0);
  const winRate = Number(signalOptionsPerformanceSummary?.winRatePercent);
  const inferredRecord =
    Number.isFinite(closedTradeCount) &&
    closedTradeCount > 0 &&
    rawWins + rawLosses <= 0 &&
    Number.isFinite(winRate);
  const wins = inferredRecord
    ? Math.round((closedTradeCount * winRate) / 100)
    : rawWins;
  const losses = inferredRecord
    ? Math.max(0, closedTradeCount - wins)
    : rawLosses;
  const recordTradeCount = Math.max(
    Number.isFinite(closedTradeCount) ? closedTradeCount : 0,
    (Number.isFinite(wins) ? wins : 0) + (Number.isFinite(losses) ? losses : 0),
  );
  const hasClosedRecord = recordTradeCount > 0;
  const profitFactor = Number(signalOptionsPerformanceSummary?.profitFactor);
  const recordDetail = hasClosedRecord
    ? [
        Number.isFinite(winRate) ? `${formatPct(winRate, 0)} win` : null,
        Number.isFinite(profitFactor) ? `PF ${profitFactor.toFixed(2)}` : null,
      ].filter(Boolean).join(" · ")
    : "no closed trades";
  const openSymbols = Number(
    riskRecord.openSymbols ?? cockpitKpis?.openSymbols ?? 0,
  );
  const maxOpenSymbols =
    riskRecord.maxOpenSymbols ?? cockpitKpis?.maxOpenSymbols ?? "?";
  const scanStatusLabel = scanOperationRunning
    ? "scan running"
    : refreshPending
      ? "syncing state"
      : focusedDeployment?.lastEvaluatedAt
        ? `scan ${formatRelativeTimeShort(focusedDeployment.lastEvaluatedAt)}`
        : cockpitGeneratedAt
          ? `state ${formatRelativeTimeShort(cockpitGeneratedAt)}`
          : "scan waiting";
  const headerMetaItems = [
    accountLabel ? `acct ${accountLabel}` : null,
    symbolCount ? `${symbolCount} sym` : null,
    `tf ${strategySettingsDraft?.signalTimeframe || "5m"}`,
    `h${strategySettingsDraft?.timeHorizon ?? 8}`,
    strategySettingsDraft?.bosConfirmation || "wicks",
    scanStatusLabel,
  ].filter(Boolean);
  const hasAttentionItems = attentionStream.length > 0;
  const hasRecentTransitions = Boolean(transitions?.length);
  const showCompactStatusRow =
    hasActivitySummary || hasAttentionItems || hasRecentTransitions;
  const overviewMetrics = [
    {
      label: "P&L",
      value: `R ${formatMoney(realizedToday, 0)} / U ${formatMoney(unrealized, 0)}`,
      detail: `open premium ${formatMoney(openPremiumValue, 0)}`,
      color: realizedToday + unrealized > 0 ? CSS_COLOR.green : realizedToday + unrealized < 0 ? CSS_COLOR.red : CSS_COLOR.text,
      icon: Activity,
      severity: "neutral",
    },
    {
      label: "Exposure",
      value: `${openPositions.toLocaleString()} open`,
      detail: `${openSymbols}/${maxOpenSymbols} symbols`,
      color:
        openPremiumUsage != null && openPremiumUsage >= 0.7
          ? CSS_COLOR.amber
          : CSS_COLOR.textSec,
      icon: Layers,
      severity:
        openPremiumUsage != null && openPremiumUsage >= 0.7
          ? "warning"
          : "neutral",
    },
    {
      label: "Risk",
      value: riskRecord.dailyHaltActive ? "halt active" : "within limits",
      detail: `loss left ${formatMoney(cockpitKpis?.dailyLossRemaining, 0)}`,
      color: riskRecord.dailyHaltActive ? CSS_COLOR.red : CSS_COLOR.green,
      icon: riskRecord.dailyHaltActive ? ShieldAlert : ShieldCheck,
      severity: riskRecord.dailyHaltActive ? "warning" : "neutral",
    },
    ...(cockpitKpis?.tradingAllowanceEnabled
      ? (() => {
          const cap = Number(cockpitKpis?.tradingAllowance ?? 0);
          const available = Number(cockpitKpis?.allowanceAvailable ?? 0);
          const allowanceUnrealized = Number(
            cockpitKpis?.allowanceUnrealizedPnl ?? 0,
          );
          const pctUsed =
            cap > 0
              ? Math.min(
                  100,
                  Math.max(0, Math.round(((cap - available) / cap) * 100)),
                )
              : 0;
          const low = available <= 0 || pctUsed >= 80;
          return [
            {
              label: "Allowance",
              value: `${formatMoney(available, 0)} left`,
              detail: `${pctUsed}% used · ${formatMoney(cap, 0)} cap · U ${formatMoney(allowanceUnrealized, 0)}`,
              color: low ? CSS_COLOR.amber : CSS_COLOR.green,
              icon: Wallet,
              severity: available <= 0 ? "warning" : "neutral",
            },
          ];
        })()
      : []),
    {
      label: "Record",
      value: hasClosedRecord ? `${wins}W / ${losses}L` : "No exits",
      detail: recordDetail || "session",
      color: hasClosedRecord && Number.isFinite(profitFactor) && profitFactor >= 1 ? CSS_COLOR.green : CSS_COLOR.textSec,
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
      {optionQuoteStreamSubscription ? (
        <AlgoOptionQuoteStreamGroup
          key={optionQuoteStreamSubscription.owner}
          underlying={optionQuoteStreamSubscription.underlying}
          providerContractIds={optionQuoteStreamSubscription.providerContractIds}
          owner={optionQuoteStreamSubscription.owner}
          requiresGreeks={optionQuoteStreamSubscription.requiresGreeks}
        />
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
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: sp(algoIsPhone ? 6 : 10),
              padding: algoIsPhone ? sp("6px 6px") : sp("8px 10px"),
              background: CSS_COLOR.bg0,
              borderBottom: `1px solid ${CSS_COLOR.border}`,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: sp(2),
                minWidth: 0,
                flex: "1 1 260px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(6),
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.text,
                    fontFamily: T.sans,
                    fontSize: fs(algoIsPhone ? 11 : 13),
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Pyrus Signal-Options
                </span>
                <FailurePointTooltip
                  point={algoHeaderFailurePoint}
                  disabled={algoHeaderFailurePoint?.severity === "info"}
                  side="bottom"
                  align="start"
                >
                  <span
                    role="status"
                    aria-label={headerScanWave.label}
                    data-testid="algo-operations-header-wave-badge"
                    style={{
                      ...headerChipStyle({
                        color: headerScanWave.color,
                        active: headerScanWave.active,
                      }),
                      gap: sp(4),
                      padding: sp("2px 7px 2px 5px"),
                      cursor:
                        algoHeaderFailurePoint?.severity === "info"
                          ? "default"
                          : "help",
                    }}
                  >
                    <IbkrStatusWave
                      status={headerScanWave.status}
                      wave={headerScanWave.wave}
                      color={headerScanWave.color}
                      width={algoIsPhone ? 22 : 24}
                      height={12}
                      decorative
                      dataTestId="algo-operations-header-wave"
                    />
                    <span>{headerScanWave.badgeLabel}</span>
                  </span>
                </FailurePointTooltip>
                {!algoIsPhone
                  ? headerStatusItems.map((item) => (
                      <span
                        key={item.label}
                        style={headerChipStyle({
                          color: item.color,
                          active: item.active,
                        })}
                      >
                        {item.label}
                      </span>
                    ))
                  : null}
              </div>
              <div
                data-testid="algo-operations-header-meta"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(5),
                  rowGap: sp(2),
                  flexWrap: "wrap",
                  minWidth: 0,
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {headerMetaItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
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
              {algoIsPhone ? (
                <AppTooltip content="Settings">
                  <button
                    type="button"
                    data-testid="algo-settings-drawer-open"
                    onClick={() => setSettingsDrawerOpen(true)}
                    aria-label="Open algo settings"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: dim(32),
                      height: dim(32),
                      border: `1px solid ${CSS_COLOR.border}`,
                      borderRadius: dim(RADII.pill),
                      background: CSS_COLOR.bg1,
                      color: CSS_COLOR.accent,
                      cursor: "pointer",
                    }}
                  >
                    <SettingsIcon
                      size={HEADER_ICON_SIZE}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                </AppTooltip>
              ) : null}
              {focusedDeployment ? (
                <div
                  role="group"
                  aria-label="Signal-options scan controls"
                  data-testid="algo-operations-header-actions"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    overflow: "hidden",
                    border: `1px solid ${CSS_COLOR.border}`,
                    borderRadius: dim(RADII.pill),
                    background: CSS_COLOR.bg1,
                  }}
                >
                  <AppTooltip content={deploymentToggleActionLabel}>
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleDeployment?.(focusedDeployment)
                      }
                      disabled={deploymentToggleDisabled}
                      aria-label={deploymentToggleActionLabel}
                      style={headerActionButtonStyle({
                        color: focusedDeployment.enabled ? CSS_COLOR.amber : CSS_COLOR.green,
                        disabled: deploymentToggleDisabled,
                      })}
                    >
                      <DeploymentToggleIcon
                        size={HEADER_ICON_SIZE}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                  </AppTooltip>
                  <AppTooltip content={scanButtonActionLabel}>
                    <button
                      type="button"
                      onClick={handleRefreshSignals}
                      disabled={scanButtonDisabled}
                      aria-label={scanButtonActionLabel}
                      style={headerActionButtonStyle({
                        color: CSS_COLOR.accent,
                        disabled: scanButtonDisabled,
                        divided: true,
                      })}
                    >
                      <RefreshCw
                        size={HEADER_ICON_SIZE}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                  </AppTooltip>
                </div>
              ) : null}
            </div>
          </div>

          <AlgoDeploymentTabs
            deployments={deployments}
            focusedDeploymentId={focusedDeploymentId}
            onSelectDeployment={onSelectDeployment}
            algoIsPhone={algoIsPhone}
            pnlByDeploymentId={pnlByDeploymentId}
            onToggleMode={onToggleDeploymentMode}
            modeChangePending={modeChangePending}
            onAddDeployment={onAddDeployment}
          />

          <section
            data-testid="algo-operations-overview"
            style={{
              display: "grid",
              gap: sp(algoIsPhone ? 2 : 5),
              padding: sp(algoIsPhone ? "4px 0" : denseOperationsLayout ? "6px" : "7px"),
              border: algoIsPhone ? 0 : `1px solid ${CSS_COLOR.border}`,
              borderTop: algoIsPhone ? `1px solid ${CSS_COLOR.border}` : undefined,
              borderBottom: algoIsPhone ? `1px solid ${CSS_COLOR.border}` : undefined,
              borderRadius: algoIsPhone ? 0 : dim(RADII.sm),
              background: CSS_COLOR.bg1,
              minWidth: 0,
            }}
          >
            <div data-testid="algo-snapshot-details" style={{ minWidth: 0 }}>
              <AlgoIndicatorKpiTable
                metrics={liveIndicatorMetrics}
                algoIsPhone={algoIsPhone}
                algoIsPocketWidth={algoIsPocketWidth}
                dense={denseOperationsLayout}
              />
            </div>

            <PipelineOverview
              stages={cockpitStageItemsForDisplay}
              selectedStageId={selectedStage?.id}
              onSelectStage={(id) => setSelectedPipelineStageId(id)}
              pocket={algoIsPhone && algoIsPocketWidth}
              dense={denseOperationsLayout}
              grouped
            />

            {showCompactStatusRow ? (
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
                        : "repeat(auto-fit, minmax(180px, 1fr))",
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
                  showClearState={false}
                />
                <OperationsTransitionsStrip
                  transitions={transitions || []}
                  maxInline={algoIsPhone ? 2 : 3}
                  embedded
                  showEmptyState={false}
                />
              </div>
            ) : null}
          </section>

          <OperationsSignalTable
            signals={visibleSignalRows}
            candidates={signalOptionsCandidates}
            signalMonitorEventsSourceStatus={signalMonitorEventsSourceStatus}
            signalMatrixStates={signalMatrixStates}
            signalTimeframes={staSignalTimeframes}
            mtfAlignmentConfig={effectiveMtfAlignmentConfig}
            executionTimeframe={normalizeStrategySignalTimeframe(
              strategySettingsDraft?.signalTimeframe,
            )}
            cockpitGeneratedAt={cockpitGeneratedAt}
            cockpitStageItems={cockpitStageItems}
            events={events}
            algoIsPhone={algoIsPhone}
            algoIsNarrow={algoIsNarrow}
            safeQaMode={safeQaMode}
            onOpenCandidateInTrade={onOpenCandidateInTrade}
            onStaRowsChange={handleStaRowsChange}
          />

          <OperationsPositionsTable
            positions={signalOptionsPositions}
            accountPositionsQuery={signalOptionsLedgerPositionsQuery}
            symbolIndex={symbolIndex}
            deploymentId={focusedDeploymentId}
            signalOptionsProfile={signalOptionsProfile}
            algoIsPhone={algoIsPhone}
          />
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
            {renderedRightRail}
          </div>
        ) : null}
      </div>
      {algoIsPhone && settingsDrawerOpen && typeof document !== "undefined"
        ? createPortal((
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
                background: cssColorMix(CSS_COLOR.bg0, 48),
              }}
              onClick={() => setSettingsDrawerOpen(false)}
            >
              <div
                style={{
                  width: "100%",
                  height: "90vh",
                  background: CSS_COLOR.bg0,
                  borderTop: `1px solid ${CSS_COLOR.border}`,
                  boxShadow: `0 -18px 42px ${cssColorMix(CSS_COLOR.bg0, 45)}`,
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
                  <AppTooltip content="Close settings">
                    <button
                      type="button"
                      data-testid="algo-settings-drawer-close"
                      aria-label="Close algo settings"
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
                  </AppTooltip>
                </div>
                <div style={{ flex: "1 1 auto", minHeight: 0 }}>
                  {renderedRightRail}
                </div>
              </div>
            </div>
          ), document.body)
        : null}
    </div>
  );
};

export default AlgoLivePage;
