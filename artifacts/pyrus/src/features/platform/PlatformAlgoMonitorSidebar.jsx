import {
  useGetAlgoDeploymentCockpit,
  useGetSignalOptionsAutomationState,
  useGetSignalOptionsPerformance,
  useListAlgoDeployments,
  useListExecutionEvents,
} from "@workspace/api-client-react";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardTitle,
  DataUnavailableState,
  MetricChip,
  StatusPill,
} from "../../components/platform/primitives.jsx";
import {
  BigDirectionGlyph,
  FRESHNESS_BAR_DENOM,
  SignalDots,
  StrategyTag,
  VerdictGlyph,
} from "../../components/platform/signal-language";
import {
  formatOptionContractLabel,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  cssColorAlpha,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { toneForDirectionalIntent } from "./semanticToneModel.js";
import { AppTooltip } from "@/components/ui/tooltip";
import { OperationsAttentionStrip } from "../../screens/algo/OperationsAttentionStrip";
import { OperationsStatusOrb } from "../../screens/algo/OperationsStatusOrb";
import {
  formatMoney,
  formatPct,
  candidateBlockerLabel,
  findSignalOptionsCandidateForSignal,
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  SIGNAL_OPTIONS_MTF_TIMEFRAMES,
  STRATEGY_SIGNAL_TIMEFRAMES,
  resolveSignalScoreBreakdown,
  resolveStableStaActionSnapshot,
  normalizeSignalOptionsMtfTimeframes,
  staRowPassesMtfAlignment,
  isMarketIdleSignalRecord,
  signalActionLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
  buildVisibleSignalRows,
  buildSignalIndicatorMetrics,
} from "../../screens/algo/algoHelpers";
import { normalizeAlgoAlignedMtfTimeframes } from "../../screens/algo/algoTimeframeControls";
import { normalizeLegacyAlgoBrandText } from "../../screens/algo/algoBranding.js";
import {
  hydrateSignalMatrixProfileTimeframe,
  SIGNALS_TABLE_TIMEFRAMES,
  signalPrimaryStateForMatrix,
} from "../signals/signalsRowModel.js";
import { setAlgoFocus } from "./algoFocusStore";
import {
  isAlgoStreamFreshnessForDeployment,
  resolveAlgoMonitorRestPolling,
} from "./algoMonitorFreshness";
import {
  useAlgoStaExecutionTimeframe,
  useAlgoStaMtfAlignmentConfig,
  useAlgoStaMtfTimeframes,
} from "./algoStaExecutionTimeframeStore.js";
import { useAlgoDeploymentFocus } from "./algoDeploymentFocusStore.js";
import { useAlgoCockpitRegistryFreshness } from "./algoCockpitStreamFreshnessRegistry";
import { ALGO_COCKPIT_STREAM_FRESH_MS, useAlgoCockpitStream } from "./live-streams";
import { buildSignalMatrixBySymbol } from "./watchlistModel";

const QUERY_DEFAULTS = {
  retry: false,
  refetchOnWindowFocus: false,
  staleTime: 15_000,
};

const ALGO_MONITOR_PIPELINE_LABEL_OVERRIDES = {
  scan_universe: "Universe",
  signal_detected: "Triggers",
};

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const numberFrom = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const toneForNumber = (value, fallback = CSS_COLOR.text) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return fallback;
  return numeric > 0 ? CSS_COLOR.green : CSS_COLOR.red;
};

const formatMoneyValue = (value, digits = 0) =>
  value == null ? MISSING_VALUE : formatMoney(value, digits);

const formatPctValue = (value, digits = 0) =>
  value == null ? MISSING_VALUE : formatPct(value, digits);

const sectionHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: sp(5),
  minWidth: 0,
  color: CSS_COLOR.textMuted,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const Section = ({ title, meta, children }) => (
  <section
    style={{
      display: "grid",
      gap: sp(4),
      minWidth: 0,
      paddingTop: sp(6),
      borderTop: `1px solid ${CSS_COLOR.borderLight}`,
    }}
  >
    <div style={sectionHeaderStyle}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </span>
      {meta ? (
        <span style={{ color: CSS_COLOR.textDim, whiteSpace: "nowrap" }}>{meta}</span>
      ) : null}
    </div>
    {children}
  </section>
);

const IconButton = ({ label, onClick, icon: Icon }) => (
  <AppTooltip content={label}>
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: dim(28),
        height: dim(32),
        display: "grid",
        placeItems: "center",
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: "transparent",
        color: CSS_COLOR.textSec,
        cursor: "pointer",
      }}
      className="ra-interactive"
    >
      <Icon size={14} strokeWidth={1.8} />
    </button>
  </AppTooltip>
);

const pickDeployment = (deployments, preferredMode) => {
  const normalizedMode = String(preferredMode || "").toLowerCase();
  return (
    deployments.find(
      (deployment) =>
        deployment.enabled &&
        String(deployment.mode || "").toLowerCase() === normalizedMode,
    ) ||
    deployments.find((deployment) => deployment.enabled) ||
    deployments.find(
      (deployment) =>
        String(deployment.mode || "").toLowerCase() === normalizedMode,
    ) ||
    deployments[0] ||
    null
  );
};

const readPositionContractLabel = (position) => {
  const contract = asRecord(position?.selectedContract || position?.optionContract);
  return formatOptionContractLabel(contract, {
    includeSymbol: false,
    fallback: firstText(position?.optionRight, contract.right, "Option").toUpperCase(),
  });
};

const readPositionPnl = (position) => {
  const direct = numberFrom(position?.unrealizedPnl, position?.pnl);
  if (direct != null) return direct;
  const entry = numberFrom(position?.entryPrice, position?.averageCost);
  const mark = numberFrom(position?.lastMarkPrice, position?.mark);
  const quantity = numberFrom(position?.quantity);
  const contract = asRecord(position?.selectedContract || position?.optionContract);
  const multiplier = numberFrom(contract.multiplier, contract.sharesPerContract, 100) ?? 100;
  return entry != null && mark != null && quantity != null
    ? (mark - entry) * quantity * multiplier
    : null;
};

const nonEmptyRecord = (value) => {
  const record = asRecord(value);
  return Object.keys(record).length ? record : null;
};

const timestampMs = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const latestTimelineMs = (candidate) => {
  const timeline = Array.isArray(candidate?.timeline) ? candidate.timeline : [];
  return timeline.reduce(
    (latest, item) => Math.max(latest, timestampMs(asRecord(item).occurredAt)),
    0,
  );
};

const signalTimestampMs = (signal) =>
  Math.max(timestampMs(signal?.signalAt), timestampMs(signal?.currentSignalAt));

const rowActivityTimestampMs = (row) =>
  Math.max(
    signalTimestampMs(row.signal),
    timestampMs(row.signal?.latestBarAt),
    timestampMs(row.signal?.updatedAt),
    timestampMs(row.signal?.lastEvaluatedAt),
    timestampMs(row.candidate?.signalAt),
    timestampMs(row.candidate?.updatedAt),
    latestTimelineMs(row.candidate),
  );

const sortNumberOrNaN = (value) => {
  if (value == null || value === "") return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
};

const firstFiniteSortNumber = (...values) => {
  for (const value of values) {
    const number = sortNumberOrNaN(value);
    if (Number.isFinite(number)) return number;
  }
  return Number.NaN;
};

const candidateSpreadRatio = (candidate) => {
  const record = asRecord(candidate);
  const quote = asRecord(record.quote);
  const liquidity = asRecord(record.liquidity);
  const orderLiquidity = asRecord(asRecord(record.orderPlan).liquidity);
  const directSpread = firstFiniteSortNumber(
    liquidity.spreadPctOfMid,
    orderLiquidity.spreadPctOfMid,
    quote.spreadPctOfMid,
  );
  if (Number.isFinite(directSpread)) {
    return directSpread >= 1 ? directSpread / 100 : directSpread;
  }
  const bid = firstFiniteSortNumber(quote.bid, liquidity.bid, orderLiquidity.bid);
  const ask = firstFiniteSortNumber(quote.ask, liquidity.ask, orderLiquidity.ask);
  const mid = firstFiniteSortNumber(
    quote.mid,
    liquidity.mid,
    orderLiquidity.mid,
    Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number.NaN,
  );
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(mid) || mid <= 0) {
    return Number.NaN;
  }
  return Math.max(0, ask - bid) / mid;
};

const signalFreshnessRailColor = (activityMs) => {
  if (!Number.isFinite(activityMs) || activityMs <= 0) return CSS_COLOR.textDim;
  const ageMs = Math.max(0, Date.now() - activityMs);
  if (ageMs < 60_000) return CSS_COLOR.green;
  if (ageMs < 5 * 60_000) return CSS_COLOR.cyan;
  if (ageMs < 30 * 60_000) return CSS_COLOR.textSec;
  return CSS_COLOR.textDim;
};

const readSignalSymbol = (signal, candidate) =>
  firstText(
    signal?.symbol,
    candidate?.symbol,
    candidate?.underlying,
    asRecord(candidate?.selectedContract).underlying,
  ).toUpperCase();

const readCandidateContractLabel = (candidate) => {
  const orderPlan = asRecord(candidate?.orderPlan);
  const contract =
    nonEmptyRecord(candidate?.selectedContract) ||
    nonEmptyRecord(candidate?.contract) ||
    nonEmptyRecord(candidate?.optionContract) ||
    nonEmptyRecord(orderPlan.contract) ||
    nonEmptyRecord(orderPlan.selectedContract);
  if (!contract) return null;
  const label = formatOptionContractLabel(contract, {
    includeSymbol: false,
    fallback: "",
  });
  return label && label !== MISSING_VALUE ? label : null;
};

const readCandidatePremiumLabel = (candidate) => {
  const premium = numberFrom(
    asRecord(candidate?.orderPlan).premiumAtRisk,
    candidate?.premiumAtRisk,
  );
  return premium == null ? null : `${formatMoney(premium, 0)} risk`;
};

const readCandidateSpreadLabel = (candidate) => {
  const spread = candidateSpreadRatio(candidate);
  return Number.isFinite(spread) ? `${formatPct(spread * 100, 0)} spread` : null;
};

const readSignalActionLabel = (signal, candidate) => {
  const direct = signalActionLabel(signal, candidate);
  if (direct && direct !== MISSING_VALUE) return direct;
  return signalActionLabel(signal, asRecord(candidate?.action));
};

const signalDirectionMeta = (direction) => {
  const value = String(direction || "").toLowerCase();
  if (value === "buy" || value === "long" || value === "bullish") {
    return { label: "BULL", primitive: "buy", tone: toneForDirectionalIntent("bullish") };
  }
  if (value === "sell" || value === "short" || value === "bearish") {
    return { label: "BEAR", primitive: "sell", tone: toneForDirectionalIntent("bearish") };
  }
  return { label: MISSING_VALUE, primitive: null, tone: CSS_COLOR.textDim };
};

const signalFreshnessRatio = (signal) => {
  const bars = numberFrom(signal?.barsSinceSignal);
  if (bars != null) {
    return Math.max(0, Math.min(1, 1 - bars / FRESHNESS_BAR_DENOM));
  }
  return signal?.fresh ? 1 : 0;
};

const scoreTone = (score) => {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return CSS_COLOR.textDim;
  if (numeric >= 75) return CSS_COLOR.green;
  if (numeric < 50) return CSS_COLOR.red;
  return CSS_COLOR.amber;
};

const signalActionStatusMeta = (signal, candidate, blocker) => {
  if (blocker !== MISSING_VALUE) {
    return { label: blocker, tone: CSS_COLOR.red, Icon: Ban };
  }
  const actionStatus = candidate?.actionStatus || candidate?.status;
  if (actionStatus) {
    const label = signalOptionsActionLabel(actionStatus);
    const normalized = String(actionStatus).toLowerCase();
    if (normalized.includes("block") || normalized.includes("mismatch")) {
      return { label, tone: CSS_COLOR.red, Icon: Ban };
    }
    if (
      normalized.includes("ready") ||
      normalized.includes("filled") ||
      normalized.includes("available")
    ) {
      return { label, tone: CSS_COLOR.green, Icon: CheckCircle2, ready: true };
    }
    return {
      label,
      tone: signalOptionsActionColor(actionStatus) || CSS_COLOR.textDim,
      Icon: ScanLine,
    };
  }
  if (isMarketIdleSignalRecord(signal)) {
    return { label: "Market idle", tone: CSS_COLOR.cyan, Icon: Clock };
  }
  if (signal?.fresh === false) {
    return { label: "Aged", tone: CSS_COLOR.amber, Icon: Clock };
  }
  return { label: "Awaiting scan", tone: CSS_COLOR.cyan, Icon: ScanLine };
};

const compactStatusLabel = (label) => {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return "--";
  if (normalized.includes("ready") || normalized.includes("try")) return "GO";
  if (normalized.includes("block") || normalized.includes("pass")) return "NO";
  if (normalized.includes("wait") || normalized.includes("pending")) return "WAIT";
  if (normalized.includes("filled")) return "FILL";
  if (normalized.includes("idle")) return "IDLE";
  if (normalized.includes("stale")) return "OLD";
  return String(label).trim().slice(0, 4).toUpperCase();
};

const signalActionSetupDetail = (candidate) =>
  [
    readCandidateContractLabel(candidate),
    readCandidatePremiumLabel(candidate),
    readCandidateSpreadLabel(candidate),
  ].filter(Boolean).join(" · ");

export const buildAlgoMonitorSignalActionRows = ({ signals = [], candidates = [] } = {}) => {
  const signalList = Array.isArray(signals) ? signals : [];
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const rows = signalList.map((signal, index) => {
        const signalRecord = asRecord(signal);
        const candidateRecord = asRecord(
          findSignalOptionsCandidateForSignal(candidateList, signalRecord),
        );
        const symbol = readSignalSymbol(signalRecord, candidateRecord);
        return {
          id: firstText(
            signalRecord.signalKey,
            candidateRecord.id,
            candidateRecord.candidateId,
            candidateRecord.signalKey,
            `${symbol || "signal"}-${index}`,
          ),
          signal: signalRecord,
          candidate: candidateRecord,
        };
      });

  return rows.sort((a, b) => {
    const signalDelta = signalTimestampMs(b.signal) - signalTimestampMs(a.signal);
    if (signalDelta) return signalDelta;
    const activityDelta = rowActivityTimestampMs(b) - rowActivityTimestampMs(a);
    if (activityDelta) return activityDelta;
    return readSignalSymbol(a.signal, a.candidate).localeCompare(
      readSignalSymbol(b.signal, b.candidate),
    );
  });
};

export const buildAlgoMonitorStaSignalRows = ({
  signalMatrixStates = [],
  signalTimeframes = SIGNALS_TABLE_TIMEFRAMES,
  signalActionTimeframes = signalTimeframes,
  universeSymbols = [],
} = {}) =>
  buildVisibleSignalRows({
    signalMatrixStates,
    signalTimeframes,
    signalActionTimeframes,
    universeSymbols,
  });

export const filterAlgoMonitorStaSignalRowsForTable = ({
  signals = [],
  signalMatrixBySymbol = {},
  mtfAlignmentConfig = null,
} = {}) =>
  (Array.isArray(signals) ? signals : []).filter((signal) =>
    staRowPassesMtfAlignment(
      { signal },
      signalMatrixBySymbol,
      mtfAlignmentConfig,
    ),
  );

export const resolveAlgoMonitorActionSignalTimeframes = ({
  signalActionTimeframe = "",
  automationProfileTimeframe = "",
  deploymentSignalTimeframe = "",
} = {}) => {
  const optionalTimeframe = (value) => {
    const timeframe = String(value || "").trim();
    return STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe) ? timeframe : "";
  };
  const syncedStaTimeframe = optionalTimeframe(signalActionTimeframe);
  const automationTimeframe = optionalTimeframe(automationProfileTimeframe);
  const deploymentTimeframe = optionalTimeframe(deploymentSignalTimeframe);
  return [
    syncedStaTimeframe ||
      automationTimeframe ||
      deploymentTimeframe ||
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe,
  ];
};

const NON_HYDRATED_ALGO_MONITOR_MATRIX_STATUSES = new Set([
  "pending",
  "unknown",
]);

const isAlgoMonitorSignalBubbleHydrated = (state) => {
  const record = asRecord(state);
  if (!Object.keys(record).length) return false;
  const status = String(record.status || "ok").trim().toLowerCase();
  return Boolean(
    record.active !== false &&
      !NON_HYDRATED_ALGO_MONITOR_MATRIX_STATUSES.has(status) &&
      (
        record.latestBarAt ||
        record.currentSignalAt ||
        record.lastEvaluatedAt ||
        record.lastError
      ),
  );
};

export const splitAlgoMonitorSignalRowsByMatrixHydration = ({
  rows = [],
  signalMatrixBySymbol = {},
  timeframes = SIGNALS_TABLE_TIMEFRAMES,
} = {}) => {
  const hydratedRows = [];
  const pendingRows = [];
  const selectedTimeframes = Array.from(
    new Set(
      (Array.isArray(timeframes) && timeframes.length
        ? timeframes
        : SIGNALS_TABLE_TIMEFRAMES
      )
        .map((timeframe) => String(timeframe || "").trim())
        .filter((timeframe) => SIGNALS_TABLE_TIMEFRAMES.includes(timeframe)),
    ),
  );
  const requiredTimeframes = selectedTimeframes.length
    ? selectedTimeframes
    : [...SIGNALS_TABLE_TIMEFRAMES];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const symbol = readSignalSymbol(row?.signal, row?.candidate);
    const rowTimeframe = String(asRecord(asRecord(row).signal).timeframe || "")
      .trim();
    const rowRequiredTimeframes =
      rowTimeframe && requiredTimeframes.includes(rowTimeframe)
        ? [rowTimeframe]
        : requiredTimeframes;
    const statesByTimeframe = asRecord(signalMatrixBySymbol?.[symbol]);
    const hydrated = Boolean(
      symbol &&
        rowRequiredTimeframes.length &&
        rowRequiredTimeframes.every((timeframe) =>
          isAlgoMonitorSignalBubbleHydrated(statesByTimeframe[timeframe]),
        ),
    );
    if (hydrated) {
      hydratedRows.push(row);
    } else {
      pendingRows.push(row);
    }
  });

  return {
    hydratedRows,
    pendingRows,
  };
};

export const resolveAlgoMonitorReadinessStatus = ({
  readinessReady = true,
  attentionItems = [],
  deploymentEnabled = false,
} = {}) => {
  const hasWarningAttention = attentionItems.some(
    (item) => item?.severity === "warning",
  );
  const hasInfoOnlyReadinessPause =
    readinessReady === false && attentionItems.length > 0 && !hasWarningAttention;
  return {
    marketDataReady: hasInfoOnlyReadinessPause ? true : readinessReady !== false,
    scanOn: Boolean(deploymentEnabled && readinessReady !== false),
  };
};

const SignalActionStatusPill = ({ signal, candidate, blocker, statusMeta }) => {
  const tone = statusMeta.tone || CSS_COLOR.textDim;
  const label = statusMeta.label || signalOptionsActionLabel("candidate");
  return (
    <AppTooltip content={label}>
      <StatusPill color={tone} dot={false} glow={Boolean(statusMeta.ready)}>
        <VerdictGlyph
          signal={signal}
          signalRecord={signal}
          blocker={blocker}
          statusMeta={statusMeta}
          size={12}
        />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {compactStatusLabel(label)}
        </span>
      </StatusPill>
    </AppTooltip>
  );
};

const SignalActionMetaCell = ({ label, value, tone = CSS_COLOR.textSec }) => (
  <MetricChip label={label} value={value} tone={tone} />
);

const SignalActionRow = ({
  row,
  onOpenAlgo,
  signalStatesByTimeframe = null,
  timeframes = SIGNALS_TABLE_TIMEFRAMES,
}) => {
  const signal = asRecord(row.signal);
  const candidate = asRecord(row.candidate);
  const symbol = readSignalSymbol(signal, candidate);
  const actionLabel = readSignalActionLabel(signal, candidate);
  const activityMs = rowActivityTimestampMs(row);
  const activityLabel =
    activityMs > 0
      ? formatRelativeTimeShort(new Date(activityMs).toISOString())
      : MISSING_VALUE;
  const setupDetail = signalActionSetupDetail(candidate) || "Awaiting scan";
  const tooltipDetail = [
    activityMs > 0 ? activityLabel : null,
    setupDetail,
  ].filter(Boolean).join(" · ");
  const direction = signalDirectionMeta(signal.direction);
  const freshnessRatio = signalFreshnessRatio(signal);
  const blocker = candidateBlockerLabel(candidate);
  const statusMeta = signalActionStatusMeta(signal, candidate, blocker);
  const scoreBreakdown = resolveSignalScoreBreakdown({
    signal,
    candidate,
    quote: candidate.quote,
    liquidity: candidate.liquidity,
  });
  const score = Number(scoreBreakdown?.score);
  const scoreLabel = Number.isFinite(score) ? score.toFixed(1) : MISSING_VALUE;
  const signalKey = firstText(signal.signalKey, candidate.signalKey, row.id);
  const signalTimeframe = firstText(
    signal.timeframe,
    candidate.timeframe,
    asRecord(candidate.signal).timeframe,
    Array.isArray(timeframes) ? timeframes[0] : null,
    DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe,
  );
  const primarySignalState = signalPrimaryStateForMatrix(signal);
  const resolvedSignalStatesByTimeframe = hydrateSignalMatrixProfileTimeframe({
    matrixStatesByTimeframe: signalStatesByTimeframe || {},
    primaryState: primarySignalState,
    profileTimeframe: signalTimeframe,
    includePrimaryFallback: false,
  });

  return (
    <AppTooltip content={`${symbol || MISSING_VALUE} ${actionLabel} - ${tooltipDetail}`}>
      <button
        type="button"
        data-testid="algo-monitor-signal-action-row"
        onClick={() => {
          if (symbol) setAlgoFocus(symbol, "action");
          onOpenAlgo?.({ signalKey, symbol: symbol || undefined });
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "start",
          gap: sp(5),
          minWidth: 0,
          minHeight: dim(72),
          padding: sp("6px 7px 6px 8px"),
          border: `1px solid ${cssColorAlpha(direction.tone, "33")}`,
          borderRadius: dim(RADII.xs),
          background: `linear-gradient(90deg, ${cssColorAlpha(direction.tone, "14")} 0%, ${CSS_COLOR.bg1} 42%)`,
          boxShadow: `inset 3px 0 0 ${direction.tone}`,
          color: CSS_COLOR.text,
          textAlign: "left",
          cursor: "pointer",
          fontFamily: T.sans,
        }}
        className="ra-interactive ra-focus-rail"
      >
        <span style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(4),
              minWidth: 0,
            }}
          >
            <BigDirectionGlyph
              direction={direction.primitive}
              freshnessRatio={freshnessRatio}
              freshnessBars={signal.barsSinceSignal}
              tone={CSS_COLOR.textSec}
              size={16}
              title={`${symbol || MISSING_VALUE} ${direction.label} signal`}
            />
            <StrategyTag candidate={candidate} signal={signal} />
            <span
              style={{
                flexShrink: 0,
                color: CSS_COLOR.text,
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.medium,
                whiteSpace: "nowrap",
              }}
            >
              {symbol || MISSING_VALUE}
            </span>
            <span
              title={actionLabel}
              style={{
                minWidth: 0,
                color: direction.tone,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {actionLabel}
            </span>
          </span>
          <span
            style={{
              display: "grid",
              // Score holds a 4-5 char value ("32.8".."100.0") + the longest label,
              // so it needs more room than TF/Age (whose "1m"/"1d" values leave slack).
              gridTemplateColumns: "minmax(52px, 0.6fr) minmax(52px, 0.8fr) minmax(72px, 1.3fr)",
              gap: sp(3),
              minWidth: 0,
            }}
          >
            <SignalActionMetaCell
              label="TF"
              value={signalTimeframe || MISSING_VALUE}
              tone={direction.tone}
            />
            <SignalActionMetaCell
              label="Age"
              value={activityLabel}
              tone={signalFreshnessRailColor(activityMs)}
            />
            <SignalActionMetaCell
              label="Score"
              value={scoreLabel}
              tone={scoreTone(score)}
            />
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(5),
              minWidth: 0,
              color: CSS_COLOR.textDim,
              fontSize: textSize("caption"),
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            <SignalDots
              testId="algo-monitor-signal-dots"
              statesByTimeframe={resolvedSignalStatesByTimeframe}
              timeframes={timeframes}
              style={{ minWidth: dim(36), gap: sp(4), flex: "0 0 auto" }}
            />
            <span
              title={setupDetail}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {setupDetail}
            </span>
          </span>
        </span>
        <SignalActionStatusPill
          signal={signal}
          candidate={candidate}
          blocker={blocker}
          statusMeta={statusMeta}
        />
      </button>
    </AppTooltip>
  );
};

const CompactMetric = ({
  label,
  value,
  detail,
  tone = CSS_COLOR.textSec,
  icon: Icon,
}) => (
  <AppTooltip content={`${label}: ${value}${detail ? ` · ${detail}` : ""}`}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: Icon ? `${dim(16)} minmax(0, 1fr)` : "minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(5),
        minWidth: 0,
        minHeight: dim(34),
        padding: sp("5px 6px"),
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg1,
      }}
    >
      {Icon ? (
        <Icon
          size={13}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{ color: tone }}
        />
      ) : null}
      <span style={{ display: "grid", gap: sp(1), minWidth: 0 }}>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: tone,
            fontFamily: T.sans,
            fontSize: fs(11),
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        {detail ? (
          <span
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  </AppTooltip>
);

const OpsSummaryBand = ({ title, metrics }) => (
  <div
    style={{
      display: "grid",
      gap: sp(3),
      minWidth: 0,
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {title}
    </span>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: sp(3),
        minWidth: 0,
      }}
    >
      {metrics.map((metric) => (
        <CompactMetric key={metric.label} {...metric} />
      ))}
    </div>
  </div>
);

const pipelineStageTone = (status) => {
  if (status === "healthy") return CSS_COLOR.green;
  if (status === "running") return CSS_COLOR.cyan;
  if (status === "idle") return CSS_COLOR.cyan;
  if (status === "attention" || status === "stale") return CSS_COLOR.amber;
  if (status === "blocked") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

const shortPipelineLabel = (stage) =>
  ALGO_MONITOR_PIPELINE_LABEL_OVERRIDES[stage?.id] ||
  String(stage?.label || "Stage")
    .replace(/\bLiquidity\/Risk\b/i, "Gate")
    .replace(/\bSelected\b/i, "")
    .replace(/\bSignal\b/i, "")
    .trim();

const IntakeMiniFunnel = ({ stages }) => {
  if (!Array.isArray(stages) || !stages.length) {
    return (
      <DataUnavailableState
        title="No intake stages"
        detail="Pipeline stages appear after the cockpit snapshot loads."
        minHeight={76}
      />
    );
  }
  return (
    <div
      data-testid="algo-monitor-intake-funnel"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(3),
        minWidth: 0,
        overflowX: "auto",
        paddingBottom: sp(1),
      }}
    >
      {stages.slice(0, 6).map((stage, index) => {
        const tone = pipelineStageTone(stage.status);
        const count = Number(stage.count);
        const stageLabel = `${stage.label || shortPipelineLabel(stage)}: ${
          Number.isFinite(count) ? count.toLocaleString() : MISSING_VALUE
        }`;
        return (
          <AppTooltip key={stage.id || index} content={stageLabel}>
            <span
              style={{
                display: "grid",
                gap: sp(1),
                minWidth: dim(58),
                maxWidth: dim(72),
                padding: sp("5px 6px"),
                border: `1px solid ${cssColorAlpha(tone, "44")}`,
                borderRadius: dim(RADII.xs),
                background: cssColorAlpha(tone, "10"),
                fontFamily: T.sans,
                flex: "1 0 0",
              }}
            >
              <span
                style={{
                  color: tone,
                  fontSize: fs(11),
                  fontWeight: FONT_WEIGHTS.medium,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {Number.isFinite(count) ? count.toLocaleString() : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontSize: textSize("caption"),
                  lineHeight: 1.1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {shortPipelineLabel(stage)}
              </span>
            </span>
          </AppTooltip>
        );
      })}
    </div>
  );
};

const PositionTile = ({ position, onOpenTradeSymbol }) => {
  const symbol = firstText(position?.symbol, asRecord(position?.selectedContract).underlying).toUpperCase();
  const pnl = readPositionPnl(position);
  const quantity = numberFrom(position?.quantity);
  const contractLabel = readPositionContractLabel(position);
  return (
    <AppTooltip content={`${symbol} ${contractLabel} - ${quantity ?? MISSING_VALUE} contracts`}>
      <button
        type="button"
        onClick={() => symbol && onOpenTradeSymbol?.(symbol)}
        style={{
          display: "grid",
          gap: sp(2),
          minWidth: 0,
          minHeight: dim(42),
          padding: sp("6px 7px"),
          border: `1px solid ${CSS_COLOR.borderLight}`,
          borderRadius: dim(RADII.xs),
          background: CSS_COLOR.bg1,
          color: CSS_COLOR.text,
          textAlign: "left",
          cursor: symbol ? "pointer" : "default",
          fontFamily: T.sans,
        }}
        className="ra-interactive"
      >
        <span style={{ display: "flex", justifyContent: "space-between", gap: sp(5), minWidth: 0 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.label }}>
            {symbol || MISSING_VALUE}
          </span>
          <span style={{ color: toneForNumber(pnl, CSS_COLOR.textDim), fontSize: textSize("caption"), whiteSpace: "nowrap" }}>
            {pnl == null ? MISSING_VALUE : formatMoney(pnl, 0)}
          </span>
        </span>
        <span style={{ minWidth: 0, color: CSS_COLOR.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: textSize("caption") }}>
          {quantity ?? MISSING_VALUE}x {contractLabel}
        </span>
      </button>
    </AppTooltip>
  );
};

export const PlatformAlgoMonitorSidebar = memo(function PlatformAlgoMonitorSidebar({
  isVisible = true,
  dataEnabled = isVisible,
  externalStreamFreshness = null,
  realtimeStreamGateReason = null,
  environment = "shadow",
  signalMatrixStates = [],
  signalActionTimeframe = "",
  headerAccessory = null,
  onOpenAlgo,
  onOpenTradeSymbol,
}) {
  const mode = environment || "shadow";
  const queryEnabled = Boolean(isVisible && dataEnabled);
  const deploymentsQuery = useListAlgoDeployments(
    undefined,
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: queryEnabled,
        refetchInterval: queryEnabled ? 30_000 : false,
      },
    },
  );
  const deployments = deploymentsQuery.isError
    ? []
    : deploymentsQuery.data?.deployments || [];
  // Sidebar deployment selection: follow the Algo screen's focused tab by
  // default; the user can pin their own (diverge) and re-follow. Falls back to
  // the mode-based auto-pick when nothing is published/pinned (e.g. off the algo
  // screen). pinnedDeploymentId === null means "following".
  const [pinnedDeploymentId, setPinnedDeploymentId] = useState(null);
  const screenFocusDeploymentId = useAlgoDeploymentFocus();
  const isFollowingDeployment = !pinnedDeploymentId;
  const focusedDeployment = useMemo(() => {
    const byId = (id) =>
      id ? deployments.find((deployment) => deployment.id === id) || null : null;
    return (
      (pinnedDeploymentId && byId(pinnedDeploymentId)) ||
      (isFollowingDeployment && byId(screenFocusDeploymentId)) ||
      pickDeployment(deployments, mode)
    );
  }, [deployments, mode, pinnedDeploymentId, isFollowingDeployment, screenFocusDeploymentId]);
  const focusedDeploymentName = normalizeLegacyAlgoBrandText(
    focusedDeployment?.name || "Pyrus Signals Shadow",
  );
  const deploymentId = focusedDeployment?.id || "";
  const sidebarSqPct = (value, digits = 2) =>
    Number.isFinite(value) ? formatPct(value, digits) : MISSING_VALUE;
  const activeStaExecutionTimeframe = useAlgoStaExecutionTimeframe();
  const activeStaMtfTimeframes = useAlgoStaMtfTimeframes();
  const activeStaMtfAlignmentConfig = useAlgoStaMtfAlignmentConfig();
  const externalStreamHydratesDeployment = isAlgoStreamFreshnessForDeployment(
    externalStreamFreshness,
    deploymentId,
  );
  const ownStreamFreshness = useAlgoCockpitStream({
    deploymentId,
    mode: focusedDeployment?.mode || mode,
    eventLimit: 20,
    enabled: Boolean(
      queryEnabled &&
        deploymentId &&
        !externalStreamHydratesDeployment &&
        !realtimeStreamGateReason,
    ),
  });
  // When another component owns the deployment-scoped EventSource (AlgoScreen
  // on the algo page — realtimeStreamGateReason gates this sidebar's own stream
  // off), read that owner's freshness from the shared registry. Without it the
  // scope check never passes here and the sidebar REST-polls forever with a
  // permanent "polling" badge even while SSE is live.
  const registryStreamFreshness = useAlgoCockpitRegistryFreshness(
    deploymentId,
    ALGO_COCKPIT_STREAM_FRESH_MS,
  );
  const streamFreshness = externalStreamHydratesDeployment
    ? externalStreamFreshness
    : registryStreamFreshness ?? ownStreamFreshness;
  const restQueriesActive = Boolean(queryEnabled && deploymentId);
  // Shell-level stream freshness is not enough to prove this deployment's cache was
  // updated. Only deployment-scoped freshness can suppress the REST catch-up polls.
  const {
    deploymentDataFreshness,
    primaryPollInterval,
    derivedPollInterval,
  } = resolveAlgoMonitorRestPolling({
    restQueriesActive,
    deploymentId,
    streamFreshness,
  });
  const cockpitQuery = useGetAlgoDeploymentCockpit(deploymentId, {
    query: {
      ...QUERY_DEFAULTS,
      enabled: restQueriesActive,
      refetchInterval: derivedPollInterval,
    },
  });
  const automationStateQuery = useGetSignalOptionsAutomationState(deploymentId, {
    query: {
      ...QUERY_DEFAULTS,
      enabled: restQueriesActive,
      refetchInterval: primaryPollInterval,
    },
  });
  const performanceQuery = useGetSignalOptionsPerformance(deploymentId, {
    query: {
      ...QUERY_DEFAULTS,
      enabled: restQueriesActive,
      refetchInterval: false,
    },
  });
  const eventsQuery = useListExecutionEvents(
    { deploymentId, limit: 20 },
    {
      query: {
        ...QUERY_DEFAULTS,
        enabled: restQueriesActive,
        refetchInterval: primaryPollInterval,
      },
    },
  );
  const cockpit = cockpitQuery.isError ? null : cockpitQuery.data || null;
  const automationState = automationStateQuery.isError
    ? null
    : automationStateQuery.data || null;
  const staActionSnapshot = useMemo(
    () =>
      resolveStableStaActionSnapshot({
        cockpit,
        signalOptionsState: automationState,
        cockpitFailed: cockpitQuery.isError,
        signalOptionsStateFailed: automationStateQuery.isError,
      }),
    [automationState, cockpit, cockpitQuery.isError, automationStateQuery.isError],
  );
  const performance = performanceQuery.isError
    ? null
    : performanceQuery.data || null;
  const primaryDetailUnavailable = Boolean(
    restQueriesActive &&
      !cockpit &&
      !automationState &&
      (cockpitQuery.isError ||
        automationStateQuery.isError ||
        (cockpitQuery.isFetched && automationStateQuery.isFetched)),
  );
  const primaryDetailLoading = Boolean(
    restQueriesActive &&
      !cockpit &&
      !automationState &&
      !primaryDetailUnavailable &&
      (cockpitQuery.isLoading || automationStateQuery.isLoading),
  );
  const detailQueryErrors = [
    cockpitQuery.isError ? "Cockpit" : null,
    automationStateQuery.isError ? "Automation" : null,
    performanceQuery.isError ? "Performance" : null,
    eventsQuery.isError ? "Events" : null,
  ].filter(Boolean);
  const performanceSummary = asRecord(performance?.summary);
  const openExposure = asRecord(performance?.openExposure);
  const cockpitKpis = asRecord(cockpit?.kpis);
  const cockpitRisk = asRecord(cockpit?.risk);
  const activePositions = Array.isArray(staActionSnapshot.activePositions)
    ? staActionSnapshot.activePositions
    : [];
  const displayedPositions = activePositions;
  const events =
    (eventsQuery.isError ? null : eventsQuery.data?.events) ||
    cockpit?.events ||
    automationState?.events ||
    [];
  const signalOptionsCandidates = Array.isArray(staActionSnapshot.candidates)
    ? staActionSnapshot.candidates
    : [];
  const signalOptionsSignals = Array.isArray(staActionSnapshot.signals)
    ? staActionSnapshot.signals
    : [];
  const actionSignalTimeframes = useMemo(
    () =>
      resolveAlgoMonitorActionSignalTimeframes({
        signalActionTimeframe: activeStaExecutionTimeframe || signalActionTimeframe,
        automationProfileTimeframe: automationState?.profile?.timeframe,
        deploymentSignalTimeframe:
          focusedDeployment?.config?.parameters?.signalTimeframe,
      }),
    [
      activeStaExecutionTimeframe,
      signalActionTimeframe,
      automationState?.profile?.timeframe,
      focusedDeployment?.config?.parameters?.signalTimeframe,
    ],
  );
  const displaySignalTimeframes = useMemo(
    () => {
      // Prefer the LIVE STA MTF selection published by AlgoScreen (the same
      // draft the STA table reads) so the sidebar's MTF set matches the table.
      // Fall back to the committed automation/deployment profile when no live
      // selection is published (e.g. AlgoScreen not mounted). In both cases,
      // force the active execution frame into MTF so the action and filter
      // lanes cannot diverge after stale persisted profile state loads.
      const live = Array.isArray(activeStaMtfTimeframes)
        ? activeStaMtfTimeframes.reduce((timeframes, item) => {
            const timeframe = String(item || "").trim();
            if (
              SIGNAL_OPTIONS_MTF_TIMEFRAMES.includes(timeframe) &&
              !timeframes.includes(timeframe)
            ) {
              timeframes.push(timeframe);
            }
            return timeframes;
          }, [])
        : [];
      if (live.length) {
        return normalizeAlgoAlignedMtfTimeframes(
          live,
          actionSignalTimeframes[0],
          live,
        );
      }
      return normalizeAlgoAlignedMtfTimeframes(
        automationState?.profile?.entryGate?.mtfAlignment?.timeframes ??
          focusedDeployment?.config?.signalOptions?.entryGate?.mtfAlignment?.timeframes,
        actionSignalTimeframes[0],
      );
    },
    [
      actionSignalTimeframes,
      activeStaMtfTimeframes,
      automationState?.profile?.entryGate?.mtfAlignment?.timeframes,
      focusedDeployment?.config?.signalOptions?.entryGate?.mtfAlignment?.timeframes,
    ],
  );
  const staSignalRows = useMemo(
    () =>
      buildAlgoMonitorStaSignalRows({
        signalMatrixStates,
        signalTimeframes: displaySignalTimeframes,
        signalActionTimeframes: actionSignalTimeframes,
        universeSymbols: focusedDeployment?.symbolUniverse || [],
      }),
    [
      actionSignalTimeframes,
      displaySignalTimeframes,
      focusedDeployment?.symbolUniverse,
      signalMatrixStates,
    ],
  );
  const signalMatrixBySymbol = useMemo(
    () => buildSignalMatrixBySymbol(signalMatrixStates, displaySignalTimeframes),
    [displaySignalTimeframes, signalMatrixStates],
  );
  const sidebarMtfAlignmentConfig = useMemo(() => {
    const source =
      activeStaMtfAlignmentConfig ??
      automationState?.profile?.entryGate?.mtfAlignment ??
      focusedDeployment?.config?.signalOptions?.entryGate?.mtfAlignment ??
      null;
    const hasLiveMtfSelection =
      Array.isArray(activeStaMtfTimeframes) && activeStaMtfTimeframes.length > 0;
    if (!source && !hasLiveMtfSelection) return null;
    return {
      ...(source || {}),
      timeframes: displaySignalTimeframes,
      requiredCount: Math.max(1, displaySignalTimeframes.length),
      enabled: source?.enabled !== false,
    };
  }, [
    activeStaMtfAlignmentConfig,
    activeStaMtfTimeframes,
    automationState?.profile?.entryGate?.mtfAlignment,
    displaySignalTimeframes,
    focusedDeployment?.config?.signalOptions?.entryGate?.mtfAlignment,
  ]);
  const staTableSignalRows = useMemo(
    () =>
      filterAlgoMonitorStaSignalRowsForTable({
        signals: staSignalRows,
        signalMatrixBySymbol,
        mtfAlignmentConfig: sidebarMtfAlignmentConfig,
      }),
    [signalMatrixBySymbol, sidebarMtfAlignmentConfig, staSignalRows],
  );
  const sidebarSq = useMemo(
    () => buildSignalIndicatorMetrics(staTableSignalRows),
    [staTableSignalRows],
  );
  const sidebarSqHasSignals = sidebarSq.signalCount > 0;
  const signalActionRows = useMemo(() => {
    return buildAlgoMonitorSignalActionRows({
      signals: staTableSignalRows,
      candidates: signalOptionsCandidates,
    });
  }, [signalOptionsCandidates, staTableSignalRows]);
  const signalMatrixHydrationSplit = useMemo(
    () =>
      splitAlgoMonitorSignalRowsByMatrixHydration({
        rows: signalActionRows,
        signalMatrixBySymbol,
        timeframes: displaySignalTimeframes,
      }),
    [displaySignalTimeframes, signalActionRows, signalMatrixBySymbol],
  );
  const matrixHydratedActionRows = signalMatrixHydrationSplit.hydratedRows;
  const matrixPendingActionRows = signalMatrixHydrationSplit.pendingRows;
  const displaySignalActionRows = useMemo(
    () => matrixHydratedActionRows.slice(0, 4),
    [matrixHydratedActionRows],
  );
  const latestEvent = events[0] || null;
  const pipelineStages = cockpit?.pipelineStages || [];
  const attentionItems = cockpit?.attentionItems || [];
  const openPnl = numberFrom(
    cockpitKpis.openUnrealizedPnl,
    openExposure.openUnrealizedPnl,
    cockpitRisk.openUnrealizedPnl,
  );
  const realizedPnl = numberFrom(
    cockpitKpis.dailyRealizedPnl,
    openExposure.dailyRealizedPnl,
    performanceSummary.realizedPnl,
  );
  const totalPnl = numberFrom(cockpitKpis.todayPnl, openExposure.dailyPnl);
  const winRate = numberFrom(performanceSummary.winRatePercent);
  const profitFactor = numberFrom(performanceSummary.profitFactor);
  const wins = numberFrom(performanceSummary.wins, 0) ?? 0;
  const losses = numberFrom(performanceSummary.losses, 0) ?? 0;
  const blockedCount = numberFrom(cockpitKpis.blockedCandidates);
  const candidateCount = numberFrom(
    cockpitKpis.candidates,
    signalOptionsCandidates.length,
  );
  const openPremium = numberFrom(openExposure.openPremium, cockpitRisk.openPremium, cockpitKpis.openPremium);
  const openSymbols = numberFrom(openExposure.openSymbols, cockpitRisk.openSymbols, cockpitKpis.openSymbols, 0) ?? 0;
  const maxOpenSymbols = numberFrom(openExposure.maxOpenSymbols, cockpitRisk.maxOpenSymbols, cockpitKpis.maxOpenSymbols);
  const dailyLossRemaining = numberFrom(cockpitKpis.dailyLossRemaining, openExposure.dailyLossRemaining);
  const dailyHaltActive = Boolean(cockpitRisk.dailyHaltActive || openExposure.dailyHaltActive);
  const combinedPnl =
    totalPnl ?? ((realizedPnl ?? 0) + (openPnl ?? 0));
  const monitorReadinessStatus = resolveAlgoMonitorReadinessStatus({
    readinessReady: cockpit ? cockpit?.readiness?.ready !== false : false,
    attentionItems,
    deploymentEnabled: focusedDeployment?.enabled,
  });
  const latestEventTime = latestEvent?.occurredAt
    ? formatRelativeTimeShort(latestEvent.occurredAt)
    : "no events";
  const recordDetail = [
    winRate != null ? `${formatPctValue(winRate, 0)} win` : null,
    profitFactor != null ? `PF ${profitFactor.toFixed(2)}` : null,
  ].filter(Boolean).join(" · ");
  const opsSummaryBands = [
    {
      title: "Runtime",
      metrics: [
        {
          label: "Scan",
          value: deploymentDataFreshness.algoFullFresh
            ? "live"
            : deploymentDataFreshness.algoPrimaryFresh
              ? "primary"
              : "polling",
          detail: focusedDeployment?.lastEvaluatedAt
            ? formatRelativeTimeShort(focusedDeployment.lastEvaluatedAt)
            : "waiting",
          tone: deploymentDataFreshness.algoFullFresh ? CSS_COLOR.green : CSS_COLOR.amber,
          icon: Clock,
        },
        {
          label: "Event",
          value: latestEvent ? "latest" : "none",
          detail: latestEventTime,
          tone: latestEvent ? CSS_COLOR.cyan : CSS_COLOR.textDim,
          icon: Activity,
        },
      ],
    },
    {
      title: "Risk",
      metrics: [
        {
          label: "Risk",
          value: dailyHaltActive ? "halt" : "clear",
          detail: `left ${formatMoneyValue(dailyLossRemaining, 0)}`,
          tone: dailyHaltActive ? CSS_COLOR.red : CSS_COLOR.green,
          icon: dailyHaltActive ? ShieldAlert : ShieldCheck,
        },
        {
          label: "Exposure",
          value: formatMoneyValue(openPremium, 0),
          detail: `${openSymbols}/${maxOpenSymbols ?? "?"} syms`,
          tone: openPremium != null && openPremium > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec,
          icon: Wallet,
        },
      ],
    },
    {
      title: "Signal Quality",
      metrics: [
        {
          label: "Correct",
          value: sidebarSqPct(sidebarSq?.correctnessPercent, 0),
          detail: sidebarSqHasSignals
            ? `${sidebarSq.signalCount} sig`
            : "no signals",
          tone:
            Number.isFinite(sidebarSq?.correctnessPercent) &&
            sidebarSq.correctnessPercent >= 50
              ? CSS_COLOR.green
              : CSS_COLOR.textSec,
          icon: ShieldCheck,
        },
        {
          label: "Expect",
          value: sidebarSqPct(sidebarSq?.expectancyPercent, 2),
          detail:
            sidebarSqHasSignals &&
            Number.isFinite(sidebarSq.payoffRatio) &&
            sidebarSq.payoffRatio > 0
              ? `pay ${sidebarSq.payoffRatio.toFixed(2)}`
              : "payoff —",
          tone: toneForNumber(sidebarSq?.expectancyPercent),
          icon: Activity,
        },
      ],
    },
  ];
  const exposureFooterMetrics = [
    {
      label: "Avg Move",
      value: sidebarSqPct(sidebarSq?.avgDirectionalMovePercent, 2),
      detail: sidebarSqHasSignals
        ? `${sidebarSq.signalCount} signals`
        : "no signals",
      tone: toneForNumber(sidebarSq?.avgDirectionalMovePercent),
    },
    {
      label: "Excursion",
      value:
        Number.isFinite(sidebarSq.avgMfePercent) ||
        Number.isFinite(sidebarSq.avgMaePercent)
        ? `${sidebarSqPct(sidebarSq.avgMfePercent, 1)} / ${sidebarSqPct(sidebarSq.avgMaePercent, 1)}`
        : MISSING_VALUE,
      detail: "MFE / MAE",
      tone: CSS_COLOR.textSec,
    },
    {
      label: "Signals",
      value: sidebarSqHasSignals
        ? sidebarSq.signalCount.toLocaleString()
        : "0",
      detail:
        sidebarSqHasSignals && Number.isFinite(sidebarSq.consistencyStdDevPercent)
          ? `±${formatPct(sidebarSq.consistencyStdDevPercent, 1)}`
          : staSignalRows.length
            ? `${staSignalRows.length} rows`
            : "dispersion",
      tone: CSS_COLOR.textSec,
    },
  ];
  const hasSignalActionRows = signalActionRows.length > 0;
  const canRenderSignalSurface = Boolean(focusedDeployment || hasSignalActionRows);
  const loading = Boolean(
    queryEnabled && deploymentsQuery.isLoading && !hasSignalActionRows,
  );

  return (
    <Card
      data-testid="platform-algo-monitor-card"
      style={{
        padding: "6px 7px",
        height: "100%",
        maxHeight: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: sp(5),
        overflowX: "hidden",
        overflowY: "auto",
      }}
    >
      <CardTitle
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: sp(5) }}>
            <IconButton label="Open Algo" onClick={onOpenAlgo} icon={ExternalLink} />
            {headerAccessory}
          </span>
        }
      >
        Algo Monitor
      </CardTitle>

      {!queryEnabled ? (
        <DataUnavailableState
          title="Algo monitor idle"
          detail="Open Algo Monitor when you need deployment, signal, or position context."
          minHeight={96}
        />
      ) : deploymentsQuery.isError && !hasSignalActionRows ? (
        <DataUnavailableState
          title="Algo monitor unavailable"
          detail="Current deployment data could not be loaded."
          minHeight={180}
        />
      ) : loading ? (
        <DataUnavailableState
          title="Loading algo monitor"
          detail="Pulling deployment cockpit data."
          loading
          loadingEndpoint="/api/algo/deployments"
          minHeight={160}
        />
      ) : !canRenderSignalSurface ? (
        <DataUnavailableState
          title="No algo deployment"
          detail="Open Algo to create or enable a shadow deployment."
          minHeight={180}
        />
      ) : primaryDetailUnavailable && !hasSignalActionRows ? (
        <DataUnavailableState
          title="Algo monitor data unavailable"
          detail="Current cockpit and automation data could not be loaded."
          minHeight={180}
        />
      ) : primaryDetailLoading && !hasSignalActionRows ? (
        <DataUnavailableState
          title="Loading algo monitor"
          detail="Pulling current deployment data."
          loading
          loadingEndpoint="/api/algo/deployments"
          minHeight={160}
        />
      ) : (
        <>
          {detailQueryErrors.length ? (
            <div
              data-testid="algo-monitor-source-errors"
              style={{ display: "flex", justifyContent: "flex-end" }}
            >
              <StatusPill color={CSS_COLOR.red} variant="outline">
                {detailQueryErrors.join(", ")} unavailable
              </StatusPill>
            </div>
          ) : null}
          <Section
            title={focusedDeployment ? "Signals → Actions" : "Signal Matrix"}
            meta={`${displaySignalActionRows.length}/${signalActionRows.length}`}
          >
            <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
              {displaySignalActionRows.length ? (
                displaySignalActionRows.map((row) => (
                  <SignalActionRow
                    key={row.id}
                    row={row}
                    onOpenAlgo={onOpenAlgo}
                    timeframes={displaySignalTimeframes}
                    signalStatesByTimeframe={
                      signalMatrixBySymbol[readSignalSymbol(row.signal, row.candidate)] ||
                      null
                    }
                  />
                ))
              ) : signalActionRows.length && matrixPendingActionRows.length ? (
                <DataUnavailableState
                  title="Hydrating signal bubbles"
                  detail={`${matrixPendingActionRows.length} action ${
                    matrixPendingActionRows.length === 1 ? "row is" : "rows are"
                  } waiting for ${displaySignalTimeframes.join(", ")} bubbles.`}
                  minHeight={86}
                  loading
                />
              ) : (
                <DataUnavailableState
                  title="No active signals"
                  detail="Signal candidates appear after the next scan."
                  minHeight={86}
                />
              )}
            </div>
          </Section>

          {primaryDetailUnavailable ? (
            <DataUnavailableState
              title="Algo monitor data unavailable"
              detail="Current cockpit and automation data could not be loaded."
              minHeight={96}
            />
          ) : primaryDetailLoading ? (
            <DataUnavailableState
              title="Loading algo monitor"
              detail="Pulling current deployment data."
              loading
              loadingEndpoint="/api/algo/deployments"
              minHeight={96}
            />
          ) : !focusedDeployment ? (
            <DataUnavailableState
              title={
                deploymentsQuery.isError
                  ? "Deployment data unavailable"
                  : deploymentsQuery.isLoading
                    ? "Loading deployment data"
                    : "No algo deployment"
              }
              detail="Current Signal Matrix rows remain available without deployment metrics."
              loading={deploymentsQuery.isLoading}
              loadingEndpoint="/api/algo/deployments"
              minHeight={96}
            />
          ) : (
            <>
          <div
            data-testid="algo-monitor-deployment"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              minWidth: 0,
              padding: sp("4px 2px 6px"),
              borderBottom: `1px solid ${CSS_COLOR.border}`,
            }}
          >
            <div style={{ minWidth: 0, display: "grid", gap: sp(1) }}>
              {deployments.length > 1 ? (
                <select
                  data-testid="algo-monitor-deployment-select"
                  value={focusedDeployment?.id || ""}
                  onChange={(event) => setPinnedDeploymentId(event.target.value)}
                  aria-label="Algo deployment"
                  style={{ minWidth: 0, maxWidth: "100%", background: "transparent", border: "none", padding: 0, color: CSS_COLOR.text, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.label, cursor: "pointer" }}
                >
                  {deployments.map((deployment) => (
                    <option key={deployment.id} value={deployment.id}>
                      {normalizeLegacyAlgoBrandText(deployment.name || "Deployment")}
                    </option>
                  ))}
                </select>
              ) : (
                <span title={focusedDeploymentName} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: CSS_COLOR.text, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.label }}>
                  {focusedDeploymentName}
                </span>
              )}
              <span title={`${String(focusedDeployment?.mode || mode).toUpperCase()} · ${focusedDeployment?.providerAccountId || "shadow"}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: CSS_COLOR.textMuted, fontFamily: T.sans, fontSize: textSize("caption"), letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {String(focusedDeployment?.mode || mode).toUpperCase()} · {focusedDeployment?.providerAccountId || "shadow"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: sp(4), flexShrink: 0 }}>
              <button
                type="button"
                data-testid="algo-monitor-deployment-follow"
                onClick={() => setPinnedDeploymentId(null)}
                disabled={isFollowingDeployment}
                title={isFollowingDeployment ? "Following the Algo screen's selection" : "Pinned — click to follow the Algo screen"}
                style={{ flexShrink: 0, border: `1px solid ${isFollowingDeployment ? CSS_COLOR.border : CSS_COLOR.accent}`, borderRadius: dim(RADII.pill), background: isFollowingDeployment ? "transparent" : cssColorMix(CSS_COLOR.accent, 12), color: isFollowingDeployment ? CSS_COLOR.textMuted : CSS_COLOR.accent, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, letterSpacing: "0.04em", textTransform: "uppercase", padding: sp("1px 6px"), cursor: isFollowingDeployment ? "default" : "pointer" }}
              >
                {isFollowingDeployment ? "Following" : "Follow"}
              </button>
              <OperationsStatusOrb
                marketDataReady={monitorReadinessStatus.marketDataReady}
                scanOn={monitorReadinessStatus.scanOn}
                deploymentEnabled={focusedDeployment?.enabled ?? true}
                attentionItems={attentionItems}
              />
            </div>
          </div>

          <Section title="Ops Summary" meta={latestEvent ? latestEventTime : ""}>
            <div
              data-testid="algo-monitor-ops-summary"
              style={{
                display: "grid",
                gap: sp(5),
                minWidth: 0,
              }}
            >
              {opsSummaryBands.map((band) => (
                <OpsSummaryBand
                  key={band.title}
                  title={band.title}
                  metrics={band.metrics}
                />
              ))}
            </div>
          </Section>

          <Section title="Intake" meta={`${Number(candidateCount || 0).toLocaleString()} cand`}>
            <IntakeMiniFunnel stages={pipelineStages} />
            <OperationsAttentionStrip
              items={attentionItems}
              maxInline={3}
              embedded
            />
          </Section>

          <Section title="Live Exposure" meta={`${displayedPositions.length} open`}>
            {displayedPositions.length ? (
              <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
                {displayedPositions.slice(0, 4).map((position, index) => (
                  <PositionTile
                    key={position.id || position.positionId || `${position.symbol}-${index}`}
                    position={position}
                    onOpenTradeSymbol={onOpenTradeSymbol}
                  />
                ))}
              </div>
            ) : (
              <DataUnavailableState
                title="No open algo positions"
                detail="Filled shadow positions will appear here."
                minHeight={86}
              />
            )}
            <div
              data-testid="algo-monitor-exposure-footer"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: sp(3),
                minWidth: 0,
                paddingTop: sp(3),
              }}
            >
              {exposureFooterMetrics.map((metric) => (
                <CompactMetric key={metric.label} {...metric} />
              ))}
            </div>
          </Section>
            </>
          )}
        </>
      )}
    </Card>
  );
});

export default PlatformAlgoMonitorSidebar;
