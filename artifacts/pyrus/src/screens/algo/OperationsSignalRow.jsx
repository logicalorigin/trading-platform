import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  MinusCircle,
  Radar,
  Send,
} from "lucide-react";
import {
  CSS_COLOR,
  cssColorAlpha,
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import {
  MicroSparkline,
} from "../../components/platform/primitives.jsx";
import { resolveSignalMatrixVerdict } from "../../features/signals/signalsRowModel.js";
import { getStoredOptionQuoteSnapshot } from "../../features/platform/live-streams";
import { useValueFlash } from "../../lib/motion.jsx";
import {
  BigDirectionGlyph,
  FRESHNESS_BAR_DENOM,
  SCORE_FRESH_ROW_GLOW,
  SignalDots,
  SpreadGauge,
  StrategyTag,
  VerdictGlyph,
  resolveSignalVerdict,
  resolveSpreadWidthFraction,
  spreadGaugeTone,
} from "../../components/platform/signal-language";
import {
  asRecord,
  candidateBlockerLabel,
  candidateLatestActivityLabel,
  formatContractDetail,
  formatMoney,
  mergeOptionQuoteSnapshot,
  optionProviderContractId,
  formatQuoteGreeksSummary,
  formatQuoteSummary,
  resolveCandidateGateDisplay,
  resolveCandidateSyncDisplay,
  resolveSignalAge,
  resolveSignalMove,
  resolveSignalScoreBreakdown,
  signalActionBlockerLabel,
  signalActionLabel,
  signalFreshnessLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
} from "./algoHelpers";

export const SIGNAL_TABLE_ROW_HEIGHT = 32;
export const SIGNAL_TABLE_HEADER_HEIGHT = 22;

const SIGNAL_ICON_SIZE = 12;
const SIGNAL_TABLE_CELL_PADDING = "0 3px";
const SIGNAL_TABLE_ACTION_CELL_PADDING = "0 1px";
const SIGNAL_TABLE_BORDER = () => `1px solid ${CSS_COLOR.borderLight}`;

const columnTrack = (column) => {
  if (column.track) return column.track;
  if (column.width) return `${column.width}px`;
  if (column.minWidth) return `minmax(${column.minWidth}px, 1fr)`;
  return "minmax(0, 1fr)";
};

export const ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS = [
  "signal",
  "since",
  "decision",
  "rowAction",
];

export const SIGNAL_TABLE_COLUMNS = [
  {
    key: "signal",
    label: "Signal",
    toggleLabel: "Signal",
    track: "minmax(158px, 1.25fr)",
    sortKey: "symbol",
    title: "Sort by symbol",
  },
  {
    key: "since",
    label: "Age",
    toggleLabel: "Signal age",
    track: "76px",
    sortKey: "bars",
    title: "Sort by bars since signal",
  },
  {
    key: "move",
    label: "Move",
    toggleLabel: "Move since signal",
    track: "64px",
    sortKey: "move",
    title: "Sort by move since signal",
  },
  {
    key: "action",
    label: "Plan",
    toggleLabel: "Action plan",
    track: "minmax(84px, 0.58fr)",
  },
  {
    key: "gate",
    label: "Gate",
    toggleLabel: "Decision gate",
    track: "minmax(96px, 0.76fr)",
  },
  {
    key: "matrix",
    label: "Matrix",
    toggleLabel: "Signal matrix verdict",
    track: "minmax(98px, 0.72fr)",
  },
  {
    key: "contract",
    label: "Contract",
    toggleLabel: "Selected contract",
    track: "minmax(118px, 0.9fr)",
  },
  {
    key: "quote",
    label: "Quote",
    toggleLabel: "Option quote",
    track: "minmax(98px, 0.72fr)",
    sortKey: "quoteAge",
    title: "Sort by quote freshness",
  },
  {
    key: "spread",
    label: "Spread",
    toggleLabel: "Bid ask spread",
    track: "82px",
    sortKey: "spread",
    title: "Sort by spread width",
  },
  {
    key: "greeks",
    label: "Greeks",
    toggleLabel: "Quote greeks",
    track: "minmax(98px, 0.72fr)",
  },
  {
    key: "process",
    label: "Process",
    toggleLabel: "Audit progression",
    track: "minmax(124px, 0.9fr)",
  },
  {
    key: "sync",
    label: "Sync",
    toggleLabel: "Order sync",
    track: "minmax(92px, 0.7fr)",
  },
  {
    key: "score",
    label: "Score",
    toggleLabel: "Actionability quality",
    track: "74px",
    sortKey: "score",
    title: "Sort by decision score",
  },
  {
    key: "decision",
    label: "Latest",
    toggleLabel: "Decision",
    track: "minmax(116px, 0.9fr)",
    sortKey: "latest",
    title: "Sort by latest decision activity",
  },
  { key: "rowAction", label: "Act", toggleLabel: "Row action", width: 42 },
];

export const DEFAULT_SIGNAL_COLUMN_ORDER = SIGNAL_TABLE_COLUMNS.map(
  (column) => column.key,
);

export const DEFAULT_SIGNAL_VISIBLE_COLUMNS = [
  "signal",
  "since",
  "move",
  "action",
  "gate",
  "matrix",
  "contract",
  "quote",
  "spread",
  "greeks",
  "score",
  "decision",
  "rowAction",
];

export const SIGNAL_COLUMN_BY_KEY = new Map(
  SIGNAL_TABLE_COLUMNS.map((column) => [column.key, column]),
);

const SIGNAL_COLUMN_KEYS = new Set(DEFAULT_SIGNAL_COLUMN_ORDER);
const ALWAYS_VISIBLE_SIGNAL_COLUMN_KEYS = new Set(ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS);

const classNames = (...values) => values.filter(Boolean).join(" ") || undefined;

const signalCellClassName = (motionState, className) =>
  classNames(
    "ra-signal-cell-motion",
    motionState ? `ra-signal-cell-${motionState}` : null,
    className,
  );

export const normalizeSignalColumnOrder = (value) => {
  const requested = Array.isArray(value) ? value : [];
  const seen = new Set();
  const next = [];
  requested.forEach((columnId) => {
    if (!SIGNAL_COLUMN_KEYS.has(columnId) || seen.has(columnId)) return;
    seen.add(columnId);
    next.push(columnId);
  });
  DEFAULT_SIGNAL_COLUMN_ORDER.forEach((columnId) => {
    if (seen.has(columnId)) return;
    seen.add(columnId);
    next.push(columnId);
  });
  return next;
};

export const normalizeSignalVisibleColumns = (value) => {
  const requested = Array.isArray(value) ? value : DEFAULT_SIGNAL_VISIBLE_COLUMNS;
  const visible = new Set(
    requested.filter((columnId) => SIGNAL_COLUMN_KEYS.has(columnId)),
  );
  ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS.forEach((columnId) => visible.add(columnId));
  return normalizeSignalColumnOrder(DEFAULT_SIGNAL_COLUMN_ORDER).filter((columnId) =>
    visible.has(columnId),
  );
};

export const resolveSignalVisibleColumnObjects = (columns) => {
  const source = Array.isArray(columns) ? columns : DEFAULT_SIGNAL_VISIBLE_COLUMNS;
  const seen = new Set();
  return source
    .map((column) =>
      typeof column === "string" ? SIGNAL_COLUMN_BY_KEY.get(column) : column,
    )
    .filter((column) => {
      if (!column || !SIGNAL_COLUMN_KEYS.has(column.key) || seen.has(column.key)) {
        return false;
      }
      seen.add(column.key);
      return true;
    });
};

export const signalColumnTemplate = (columns) =>
  resolveSignalVisibleColumnObjects(columns).map(columnTrack).join(" ");

export const signalTableMinWidth = (columns) => {
  const count = resolveSignalVisibleColumnObjects(columns).length;
  if (count <= 6) return "100%";
  return dim(Math.max(760, count * 92));
};

const directionMeta = (direction) => {
  const value = String(direction || "").toLowerCase();
  if (value === "buy" || value === "long" || value === "bullish") {
    return {
      label: "BUY",
      trend: "BULLISH",
      tone: CSS_COLOR.green,
      primitive: "buy",
    };
  }
  if (value === "sell" || value === "short" || value === "bearish") {
    return {
      label: "SELL",
      trend: "BEARISH",
      tone: CSS_COLOR.red,
      primitive: "sell",
    };
  }
  return {
    label: MISSING_VALUE,
    trend: MISSING_VALUE,
    tone: CSS_COLOR.textDim,
    primitive: null,
  };
};

const formatScore = (value) => {
  if (value == null) return MISSING_VALUE;
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(1) : MISSING_VALUE;
};

const formatBars = (value) => {
  if (value == null) return MISSING_VALUE;
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : MISSING_VALUE;
};

const liquidityMeta = (candidate) => {
  if (!candidate) return { Icon: MinusCircle, tone: CSS_COLOR.textDim };
  const reason = String(candidate.reason || "");
  if (
    reason === "missing_bid_ask" ||
    reason === "spread_too_wide" ||
    reason === "bid_below_minimum"
  ) {
    return { Icon: AlertTriangle, tone: CSS_COLOR.amber };
  }
  if (
    asRecord(candidate.quote).bid != null ||
    asRecord(candidate.liquidity).bid != null
  ) {
    return { Icon: CheckCircle2, tone: CSS_COLOR.green };
  }
  return { Icon: MinusCircle, tone: CSS_COLOR.textDim };
};

const hasDisplayValue = (value) =>
  value != null && String(value).trim() && value !== MISSING_VALUE;

const compactJoin = (parts) => {
  const values = parts.filter(hasDisplayValue);
  return values.length ? values.join(" · ") : MISSING_VALUE;
};

const compactQuoteText = (value) => {
  if (!hasDisplayValue(value)) return MISSING_VALUE;
  return String(value)
    .replace(/\s+\/\s+/g, "/")
    .replace(/\bmid\s+/gi, "")
    .replace(/\bmark\s+/gi, "")
    .replace(/\blast\s+/gi, "")
    .replace(/\bspr\s+/gi, "");
};

const compactGreeksText = (value) => {
  if (!hasDisplayValue(value)) return MISSING_VALUE;
  return String(value).replace(/\s+\/\s+/g, "/");
};

const formatQuoteAge = (ageMs) => {
  const numeric = Number(ageMs);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  if (numeric < 1_000) return `${Math.round(numeric)}ms`;
  if (numeric < 60_000) return `${(numeric / 1_000).toFixed(1)}s`;
  if (numeric < 3_600_000) return `${(numeric / 60_000).toFixed(1)}m`;
  return `${(numeric / 3_600_000).toFixed(1)}h`;
};

export const formatSpreadWidth = (widthPct) => {
  if (widthPct == null || widthPct === "") return MISSING_VALUE;
  const numeric = Number(widthPct);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  const pct = numeric * 100;
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
};

const scoreTone = (score) => {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return CSS_COLOR.textDim;
  if (numeric >= 75) return CSS_COLOR.green;
  if (numeric < 50) return CSS_COLOR.red;
  return CSS_COLOR.amber;
};

const scoreTierLabel = (tier) => {
  const normalized = String(tier || "").trim();
  if (!normalized) return MISSING_VALUE;
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const matrixScoreLabel = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)}%` : MISSING_VALUE;
};

const matrixReadinessTone = (readiness) => {
  switch (readiness) {
    case "ready":
      return CSS_COLOR.green;
    case "watch":
      return CSS_COLOR.blue;
    case "wait":
      return CSS_COLOR.amber;
    case "avoid":
      return CSS_COLOR.red;
    default:
      return CSS_COLOR.textDim;
  }
};

const matrixMotionState = (readiness) => {
  if (readiness === "ready") return "ready";
  if (readiness === "avoid") return "blocked";
  return null;
};

const missingDisplay = (main, detail = MISSING_VALUE) => ({ main, detail });

const hasBlockerDisplay = (blocker) => hasDisplayValue(blocker);

const candidateActionStatusValue = (candidate) =>
  String(candidate?.actionStatus || candidate?.status || "")
    .trim()
    .toLowerCase();

const isCandidateContractSelectionPending = (candidate) =>
  candidateActionStatusValue(candidate) === "candidate";

const missingContractDisplay = (candidate, blocker) => {
  if (!candidate) {
    return missingDisplay(MISSING_VALUE, MISSING_VALUE);
  }
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not selected", blocker);
  if (isCandidateContractSelectionPending(candidate)) {
    return missingDisplay("Selecting", MISSING_VALUE);
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const missingQuoteDisplay = ({ blocker, selectedContractId }) => {
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not requested", blocker);
  if (selectedContractId) {
    return missingDisplay("Quote pending", MISSING_VALUE);
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const missingGreeksDisplay = ({ blocker, selectedContractId } = {}) => {
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not tested", blocker);
  if (selectedContractId) {
    return missingDisplay("Greeks pending", MISSING_VALUE);
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const missingSpreadDisplay = ({ blocker, hasQuote, selectedContractId } = {}) => {
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not priced", blocker);
  if (selectedContractId && !hasQuote) {
    return missingDisplay("Quote pending", MISSING_VALUE);
  }
  if (selectedContractId) return missingDisplay("Spread pending", MISSING_VALUE);
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const statusPillMeta = (signal, candidate, blocker) => {
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
      return { label, tone: CSS_COLOR.green, Icon: CheckCircle2 };
    }
    if (normalized.includes("stale")) {
      return { label, tone: CSS_COLOR.amber, Icon: Clock };
    }
    return {
      label,
      tone: signalOptionsActionColor(actionStatus) || CSS_COLOR.textDim,
      Icon: Radar,
    };
  }
  if (signal?.status === "unavailable") {
    return { label: "Unavailable", tone: CSS_COLOR.textDim, Icon: MinusCircle };
  }
  if (signal?.fresh === false) {
    return { label: "Aged", tone: CSS_COLOR.amber, Icon: Clock };
  }
  return { label: "Awaiting scan", tone: CSS_COLOR.cyan, Icon: Radar };
};

const compactPillLabel = (label) => {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return "--";
  if (normalized.includes("ready") || normalized.includes("try")) return "GO";
  if (normalized.includes("block") || normalized.includes("pass")) return "NO";
  if (normalized.includes("wait") || normalized.includes("pending")) return "WAIT";
  if (normalized.includes("stale")) return "OLD";
  if (normalized.includes("unavailable")) return "--";
  return String(label).trim().slice(0, 4).toUpperCase();
};

const StatusPill = ({
  meta,
  iconOverride = null,
  toneOverride = null,
  compact = false,
  motionState = null,
  className = null,
}) => {
  const Icon = iconOverride || meta.Icon;
  const tone = toneOverride || meta.tone;
  if (compact) {
    return (
      <span
        className={classNames(
          "ra-signal-status-pill",
          motionState ? `ra-signal-status-pill-${motionState}` : null,
          className,
        )}
        title={meta.label}
        aria-label={meta.label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(3),
          minWidth: dim(34),
          height: dim(20),
          flex: "0 0 auto",
          padding: sp("0 6px"),
          borderRadius: dim(RADII.pill),
          border: `1px solid ${cssColorAlpha(tone, "44")}`,
          background: cssColorAlpha(tone, "18"),
          color: tone,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
        }}
      >
        {Icon ? (
          <Icon size={12} strokeWidth={1.9} aria-hidden="true" />
        ) : null}
        <span>{compactPillLabel(meta.label)}</span>
      </span>
    );
  }
  return (
    <span
      className={classNames(
        "ra-signal-status-pill",
        motionState ? `ra-signal-status-pill-${motionState}` : null,
        className,
      )}
      title={meta.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        maxWidth: "100%",
        minWidth: 0,
        padding: sp("1px 6px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${cssColorAlpha(tone, "33")}`,
        background: cssColorAlpha(tone, "1A"),
        color: tone,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        lineHeight: 1.2,
        verticalAlign: "middle",
      }}
    >
      {Icon ? (
        <Icon
          size={SIGNAL_ICON_SIZE}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{ flex: "0 0 auto" }}
        />
      ) : null}
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {meta.label}
      </span>
    </span>
  );
};

const DECISION_DETAIL_META = {
  clear: { tone: CSS_COLOR.green, label: "Gate clear" },
  liquidity: { tone: CSS_COLOR.amber, label: "Liquidity" },
  risk: { tone: CSS_COLOR.red, label: "Risk" },
  gateway: { tone: CSS_COLOR.red, label: "Gateway" },
  contract_resolution: { tone: CSS_COLOR.amber, label: "Contract" },
  signal_policy: { tone: CSS_COLOR.amber, label: "Policy" },
  marking: { tone: CSS_COLOR.amber, label: "Marking" },
  other: { tone: CSS_COLOR.textDim, label: "Other" },
};

const resolveDecisionDetailMeta = ({ candidate, gate, blocker, statusMeta }) => {
  if (blocker !== MISSING_VALUE) {
    const base = DECISION_DETAIL_META[gate.category] || DECISION_DETAIL_META.other;
    return {
      tone: gate.tone || base.tone,
      shortLabel: gate.detail || blocker,
      fullLabel: `${base.label}: ${gate.detail || blocker}`,
    };
  }
  if (!candidate) {
    return {
      tone: CSS_COLOR.cyan,
      shortLabel: "Monitor only",
      fullLabel: "No action candidate resolved",
    };
  }

  const actionStatus = String(candidate?.actionStatus || candidate?.status || "").trim();
  if (actionStatus && actionStatus !== "candidate") {
    return {
      tone: statusMeta.tone || CSS_COLOR.textDim,
      shortLabel: statusMeta.label,
      fullLabel: statusMeta.label,
    };
  }

  if (String(statusMeta?.label || "").toLowerCase() === "awaiting scan") {
    return {
      tone: CSS_COLOR.cyan,
      shortLabel: "Awaiting scan",
      fullLabel: "Candidate awaiting next scan",
    };
  }

  const base = DECISION_DETAIL_META[gate.category] || DECISION_DETAIL_META.clear;
  return {
    tone: gate.tone || base.tone,
    shortLabel: gate.category === "clear" ? "Gate clear" : gate.label,
    fullLabel: compactJoin([gate.label, gate.detail]),
  };
};

const finiteNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveNumberOrNull = (value) => {
  const numeric = finiteNumberOrNull(value);
  return numeric != null && numeric > 0 ? numeric : null;
};

const resolveUnderlyingPrice = (signal, tickerSnapshot) =>
  finiteNumberOrNull(tickerSnapshot?.price) ??
  finiteNumberOrNull(tickerSnapshot?.last) ??
  finiteNumberOrNull(tickerSnapshot?.mark) ??
  finiteNumberOrNull(signal?.signalPrice);

const resolveSparklineData = (tickerSnapshot, signal) => {
  if (Array.isArray(tickerSnapshot?.sparkBars) && tickerSnapshot.sparkBars.length >= 2) {
    return tickerSnapshot.sparkBars;
  }
  if (Array.isArray(tickerSnapshot?.spark) && tickerSnapshot.spark.length >= 2) {
    return tickerSnapshot.spark;
  }
  if (Array.isArray(signal?.sparkBars) && signal.sparkBars.length >= 2) {
    return signal.sparkBars;
  }
  if (Array.isArray(signal?.spark) && signal.spark.length >= 2) {
    return signal.spark;
  }
  if (Array.isArray(signal?.bars) && signal.bars.length >= 2) {
    return signal.bars;
  }
  return [];
};

const resolveFreshnessRatio = (signal) => {
  const bars = finiteNumberOrNull(signal?.barsSinceSignal);
  if (bars != null) {
    return Math.max(0, Math.min(1, 1 - bars / FRESHNESS_BAR_DENOM));
  }
  return signal?.fresh ? 1 : 0;
};

const quoteGaugeInput = (quote, liquidity) => {
  const quoteRecord = asRecord(quote);
  const liquidityRecord = asRecord(liquidity);
  const bid = positiveNumberOrNull(quoteRecord.bid) ?? positiveNumberOrNull(liquidityRecord.bid);
  const ask = positiveNumberOrNull(quoteRecord.ask) ?? positiveNumberOrNull(liquidityRecord.ask);
  const mid = positiveNumberOrNull(quoteRecord.mid) ?? positiveNumberOrNull(liquidityRecord.mid);
  const widthPct = resolveSpreadWidthFraction({ bid, ask, mid });
  return { bid, ask, mid, widthPct };
};

const signalDisplay = (signal) => {
  const score = formatScore(signal?.score);
  const freshness = signalFreshnessLabel(signal);
  const direction = directionMeta(signal?.direction);
  return {
    main: direction.trend,
    detail: [
      score !== MISSING_VALUE ? `score ${score}` : null,
      freshness !== MISSING_VALUE ? freshness : null,
    ].filter(Boolean).join(" · ") || MISSING_VALUE,
    direction,
    freshness,
  };
};

const signalPrimaryStateForMatrix = (signal) => ({
  symbol: signal?.symbol,
  timeframe: signal?.timeframe,
  currentSignalDirection: signal?.currentSignalDirection || signal?.direction,
  currentSignalAt: signal?.currentSignalAt || signal?.signalAt,
  currentSignalPrice: signal?.currentSignalPrice ?? signal?.price ?? null,
  latestBarAt: signal?.latestBarAt || signal?.signalAt || null,
  barsSinceSignal: signal?.barsSinceSignal,
  fresh: signal?.fresh,
  status: signal?.status || "ok",
  active: signal?.active ?? true,
  lastEvaluatedAt: signal?.lastEvaluatedAt || signal?.signalAt || null,
});

const matrixVerdictDisplay = (verdict) => {
  const reasons = Array.isArray(verdict?.reasonCodes) ? verdict.reasonCodes : [];
  const main = scoreTierLabel(verdict?.tradeReadiness);
  const detail = compactJoin([
    scoreTierLabel(verdict?.regime),
    matrixScoreLabel(verdict?.readinessScore),
  ]);
  return {
    main,
    detail,
    tone: matrixReadinessTone(verdict?.tradeReadiness),
    title: compactJoin([
      verdict?.label,
      verdict?.detail,
      reasons.length ? reasons.map(scoreTierLabel).join(" · ") : null,
    ]),
    motionState: matrixMotionState(verdict?.tradeReadiness),
  };
};

const signalSinceDisplay = (signal, signalAge, bars) => {
  const elapsed = formatRelativeTimeShort(signal?.signalAt ?? signal?.currentSignalAt);
  const barLabel =
    signalAge?.label && signalAge.label !== MISSING_VALUE
      ? signalAge.label
      : bars !== MISSING_VALUE
        ? `${bars} bars`
        : null;
  return {
    main: compactJoin([barLabel, signal?.timeframe]),
    detail: elapsed !== MISSING_VALUE ? `${elapsed} since` : MISSING_VALUE,
  };
};

const actionIntentTokens = (label) =>
  String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const actionIntentTokenTone = (token) => {
  const normalized = String(token || "").toUpperCase();
  if (normalized === "BUY" || normalized === "CALL") return CSS_COLOR.green;
  if (normalized === "SELL" || normalized === "PUT") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

const actionPlanDisplay = (signal, candidate) => {
  const action = signalActionLabel(signal, candidate?.action);
  if (!candidate) {
    return { main: action, detail: MISSING_VALUE };
  }
  const limit = formatMoney(asRecord(candidate.orderPlan).entryLimitPrice, 2);
  const quantity = Number(asRecord(candidate.orderPlan).quantity);
  const premium = formatMoney(asRecord(candidate.orderPlan).premiumAtRisk, 0);
  const sizeAndLimit = [
    Number.isFinite(quantity) && quantity > 0 ? `${quantity}ct` : null,
    limit !== MISSING_VALUE ? `@ ${limit}` : null,
  ].filter(Boolean).join(" ");
  const detail = [
    sizeAndLimit || null,
    premium !== MISSING_VALUE ? `${premium} risk` : null,
  ].filter(Boolean);
  return {
    main: action,
    detail: detail.length ? detail.join(" · ") : MISSING_VALUE,
  };
};

const latestTimelineItem = (candidate) => {
  const timeline = Array.isArray(asRecord(candidate).timeline)
    ? asRecord(candidate).timeline
    : [];
  return asRecord(timeline[timeline.length - 1]);
};

const DataCell = ({
  value,
  detail,
  tone = CSS_COLOR.textSec,
  detailTone = CSS_COLOR.textMuted,
  icon = null,
  detailExtra = null,
  titleValue,
  motionState = null,
  className = null,
}) => {
  const hasDetail = hasDisplayValue(detail) || Boolean(detailExtra);
  return (
    <span
      className={signalCellClassName(motionState, className)}
      title={[
        titleValue ?? (typeof value === "string" ? value : null),
        hasDisplayValue(detail) ? detail : null,
      ].filter(Boolean).join(" · ")}
      style={{
        display: "grid",
        gap: 0,
        minWidth: 0,
        color: tone,
        overflow: "hidden",
        lineHeight: 1.12,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(3),
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          lineHeight: 1.12,
        }}
      >
        {icon ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              flex: "0 0 auto",
            }}
          >
            {icon}
          </span>
        ) : null}
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
      </span>
      {hasDetail ? (
        <span
          style={{
            color: detailTone,
            fontSize: textSize("caption"),
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            minWidth: 0,
            lineHeight: 1.12,
          }}
        >
          {hasDisplayValue(detail) ? (
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {detail}
            </span>
          ) : null}
          {detailExtra ? (
            <span style={{ flex: "0 0 auto", display: "inline-flex" }}>
              {detailExtra}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
};

const PlanCell = ({ plan, titleValue, motionState = null }) => {
  const detail = hasDisplayValue(plan?.detail) ? plan.detail : MISSING_VALUE;
  const intentTokens = actionIntentTokens(plan?.main);
  return (
    <span
      className={signalCellClassName(motionState)}
      data-testid="algo-signal-plan-cell"
      title={[titleValue, plan?.main, detail].filter(hasDisplayValue).join(" · ")}
      style={{
        display: "grid",
        gap: 0,
        minWidth: 0,
        overflow: "hidden",
        lineHeight: 1.08,
      }}
    >
      <span
        data-testid="algo-signal-plan-intent"
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: sp(3),
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1.05,
        }}
      >
        {intentTokens.length
          ? intentTokens.map((token, index) => (
              <span
                key={`${token}-${index}`}
                data-plan-token={token.toUpperCase()}
                data-testid={`algo-signal-plan-token-${token.toUpperCase()}`}
                style={{
                  color: actionIntentTokenTone(token),
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {token}
              </span>
            ))
          : MISSING_VALUE}
      </span>
      {hasDisplayValue(detail) ? (
        <span
          data-testid="algo-signal-plan-detail"
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: CSS_COLOR.textMuted,
            fontSize: textSize("caption"),
            lineHeight: 1.08,
          }}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
};

const SignalHeroCell = ({
  signalRecord,
  candidate,
  direction,
  tfMatrix,
  freshnessRatio,
  price,
  priceFlashClassName,
  sparklineData,
  signalMove,
  showSignalMove = true,
}) => (
  <span
    data-testid="algo-signal-hero-cell"
    className="ra-signal-cell-motion"
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 0,
      alignItems: "center",
      minWidth: 0,
      overflow: "hidden",
      lineHeight: 1.12,
    }}
  >
    <span
      style={{
        display: "grid",
        gap: 0,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(4),
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <BigDirectionGlyph
          direction={direction.primitive}
          freshnessRatio={freshnessRatio}
          freshnessBars={signalRecord.barsSinceSignal}
          tone={CSS_COLOR.textSec}
          className={
            signalRecord.fresh && signalRecord.actionEligible !== false
              ? "ra-signal-glyph-fresh"
              : undefined
          }
        />
        <StrategyTag candidate={candidate} signal={signalRecord} />
        <span
          style={{
            color: CSS_COLOR.text,
            fontSize: fs(13),
            fontWeight: FONT_WEIGHTS.medium,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {signalRecord.symbol || MISSING_VALUE}
        </span>
        <span
          style={{
            color: direction.tone,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            flex: "0 0 auto",
          }}
        >
          {direction.label}
        </span>
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          minWidth: 0,
          overflow: "hidden",
          color: CSS_COLOR.textDim,
          fontSize: textSize("caption"),
          whiteSpace: "nowrap",
          lineHeight: 1.12,
        }}
      >
        <SignalDots
          testId="algo-signal-dots"
          statesByTimeframe={tfMatrix}
          style={{ minWidth: dim(36), gap: sp(4) }}
        />
        <span
          className={priceFlashClassName}
          style={{
            color: CSS_COLOR.textSec,
            fontVariantNumeric: "tabular-nums",
            fontWeight: FONT_WEIGHTS.medium,
            flex: "0 0 auto",
          }}
        >
          {price}
        </span>
        {sparklineData.length >= 2 ? (
          <span
            data-testid="algo-signal-hero-sparkline"
            style={{
              width: dim(40),
              height: dim(14),
              minWidth: dim(40),
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            <MicroSparkline
              data={sparklineData}
              positive={direction.primitive === "buy"}
              width={40}
              height={14}
              style={{ width: "100%", height: "100%" }}
            />
          </span>
        ) : null}
        {showSignalMove ? (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {[
              signalMove?.label && signalMove.label !== MISSING_VALUE
                ? signalMove.label
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || MISSING_VALUE}
          </span>
        ) : null}
      </span>
    </span>
  </span>
);

const pushDistinctLabel = (parts, value) => {
  if (!hasDisplayValue(value)) return;
  const normalized = String(value).trim().toLowerCase();
  if (parts.some((part) => String(part).trim().toLowerCase() === normalized)) return;
  parts.push(value);
};

const decisionDetailText = ({
  decisionDetailMeta,
  statusMeta,
  sync,
  latest,
  latestTime,
}) => {
  const parts = [];
  const detailLabel = decisionDetailMeta?.shortLabel;
  if (detailLabel && detailLabel !== "Gate clear") {
    pushDistinctLabel(parts, detailLabel);
  }
  pushDistinctLabel(parts, statusMeta?.label);
  if (sync?.label === "Mismatch" || sync?.label === "Event only") {
    pushDistinctLabel(parts, sync.label);
  }
  if (!parts.length) pushDistinctLabel(parts, latest);
  pushDistinctLabel(parts, latestTime);
  return compactJoin(parts);
};

const DecisionCell = ({
  actionabilitySignalRecord,
  blocker,
  decisionDetailMeta,
  statusMeta,
  sync,
  latest,
  latestTime,
  verdict,
  motionState = null,
}) => {
  const decisionLabel = verdict?.label || statusMeta.label;
  const detailText = decisionDetailText({
    decisionDetailMeta,
    statusMeta,
    sync,
    latest,
    latestTime,
  });
  const detailTitle = compactJoin([
    decisionDetailMeta?.fullLabel,
    sync?.detail,
    latest,
    latestTime,
  ]);

  return (
    <span
      className={signalCellClassName(motionState)}
      style={{
        display: "grid",
        gap: sp(2),
        minWidth: 0,
        overflow: "hidden",
        lineHeight: 1.12,
      }}
    >
      <span
        className={classNames(
          "ra-signal-decision-pill",
          verdict?.bucket ? `ra-signal-decision-pill-${verdict.bucket}` : null,
        )}
        title={compactJoin([decisionLabel, statusMeta.label, detailTitle])}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(4),
          width: "fit-content",
          maxWidth: "100%",
          minWidth: 0,
          padding: sp("2px 7px 2px 3px"),
          borderRadius: dim(RADII.pill),
          border: `1px solid ${cssColorAlpha(verdict?.tone || statusMeta.tone, "40")}`,
          background: cssColorAlpha(verdict?.tone || statusMeta.tone, "1C"),
          color: verdict?.tone || statusMeta.tone,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <VerdictGlyph
          signal={actionabilitySignalRecord}
          signalRecord={actionabilitySignalRecord}
          blocker={blocker}
          statusMeta={statusMeta}
          size={18}
        />
        <span
          style={{
            fontWeight: FONT_WEIGHTS.medium,
            fontSize: fs(12),
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {decisionLabel}
        </span>
      </span>
      <span
        title={detailTitle}
        style={{
          color: decisionDetailMeta?.tone || CSS_COLOR.textMuted,
          fontSize: textSize("caption"),
          lineHeight: 1.12,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detailText}
      </span>
    </span>
  );
};

const PROCESS_STAGE_META = {
  signal: { label: "Signal", tone: CSS_COLOR.textSec, Icon: Radar },
  candidate: { label: "Candidate", tone: CSS_COLOR.cyan, Icon: Radar },
  eligible: { label: "Eligible", tone: CSS_COLOR.green, Icon: CheckCircle2 },
  submitted: { label: "Submitted", tone: CSS_COLOR.green, Icon: Send },
  filled: { label: "Filled", tone: CSS_COLOR.green, Icon: CheckCircle2 },
  managed: { label: "Managed", tone: CSS_COLOR.cyan, Icon: CheckCircle2 },
  closed: { label: "Closed", tone: CSS_COLOR.textSec, Icon: CheckCircle2 },
  blocked: { label: "Blocked", tone: CSS_COLOR.red, Icon: Ban },
  event: { label: "Event", tone: CSS_COLOR.textMuted, Icon: Clock },
};

const processStageMeta = (stage) => {
  const id = String(stage?.id || "event");
  return PROCESS_STAGE_META[id] || {
    label: stage?.label || "Event",
    tone: CSS_COLOR.textMuted,
    Icon: Clock,
  };
};

const ProcessTrailCell = ({ progression, scanActive = false }) => {
  const eventCount = Number(progression?.eventCount || 0);
  if (!eventCount) {
    return (
      <DataCell
        value={scanActive ? "Listening" : MISSING_VALUE}
        detail={scanActive ? "Audit trail pending" : MISSING_VALUE}
        tone={scanActive ? CSS_COLOR.cyan : CSS_COLOR.textDim}
        motionState={scanActive ? "evaluating" : null}
      />
    );
  }

  const latestStage = progression?.latestStage || progression?.latest?.stage;
  const latestMeta = processStageMeta(latestStage);
  const LatestIcon = latestMeta.Icon;
  const stageIds = Array.isArray(progression?.stageIds)
    ? progression.stageIds.slice(-5)
    : [];
  const latestAge = progression?.latestOccurredAt
    ? formatRelativeTimeShort(new Date(progression.latestOccurredAt))
    : "";
  const detail = compactJoin([
    `${eventCount} event${eventCount === 1 ? "" : "s"}`,
    latestAge,
    progression?.detail,
  ]);
  const title = (progression?.events || [])
    .slice(-6)
    .map((row) =>
      compactJoin([
        row?.stage?.label,
        row?.summary,
        row?.detailText,
        row?.occurredAt,
      ]),
    )
    .filter((value) => value !== MISSING_VALUE)
    .join("\n");

  return (
    <span
      data-testid="algo-signal-process-cell"
      className={signalCellClassName(
        latestStage?.id === "blocked"
          ? "blocked"
          : latestStage?.id === "submitted" ||
              latestStage?.id === "filled" ||
              latestStage?.id === "managed" ||
              latestStage?.id === "closed"
            ? "ready"
            : scanActive
              ? "evaluating"
              : null,
      )}
      title={title || detail}
      style={{
        display: "grid",
        gap: sp(2),
        minWidth: 0,
        overflow: "hidden",
        lineHeight: 1.12,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(4),
          minWidth: 0,
          overflow: "hidden",
          color: latestMeta.tone,
          whiteSpace: "nowrap",
        }}
      >
        <LatestIcon size={SIGNAL_ICON_SIZE} strokeWidth={1.8} aria-hidden="true" />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {latestMeta.label}
        </span>
        {stageIds.length ? (
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              flex: "0 0 auto",
            }}
          >
            {stageIds.map((stageId) => {
              const markerMeta = processStageMeta({ id: stageId });
              return (
                <span
                  key={stageId}
                  title={markerMeta.label}
                  style={{
                    width: dim(5),
                    height: dim(5),
                    borderRadius: dim(RADII.pill),
                    background: markerMeta.tone,
                    opacity: stageId === latestStage?.id ? 1 : 0.5,
                  }}
                />
              );
            })}
          </span>
        ) : null}
      </span>
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontSize: textSize("caption"),
          lineHeight: 1.12,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detail}
      </span>
    </span>
  );
};

const resolveRowAction = ({ candidate, blocker, signalRecord, verdict }) => {
  if (signalRecord?.status === "unavailable" || !candidate) return null;
  if (blocker !== MISSING_VALUE) return null;
  if (verdict?.bucket !== "try") return null;
  return {
    id: "submit",
    label: "Submit",
    title: "Open pre-filled trade ticket",
    tone: CSS_COLOR.green,
    Icon: Send,
  };
};

const RowActionButton = ({ action, onAction }) => {
  if (!action) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: "100%",
          height: dim(24),
        }}
      />
    );
  }
  const Icon = action.Icon;
  return (
    <button
      type="button"
      className={classNames(
        "ra-signal-action-button",
        action.id === "submit" ? "ra-signal-action-button-ready" : null,
      )}
      data-testid={`algo-signal-row-action-${action.id}`}
      title={action.title || action.label}
      aria-label={action.label}
      onClick={(event) => {
        event.stopPropagation();
        onAction?.(action.id);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim(28),
        height: dim(24),
        borderRadius: dim(RADII.sm),
        border: `1px solid ${cssColorAlpha(action.tone, "44")}`,
        background: cssColorAlpha(action.tone, "18"),
        color: action.tone,
        cursor: "pointer",
      }}
    >
      <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
};

const CompactSignalMetric = ({ label, wide = false, children }) => (
  <span
    role="cell"
    style={{
      display: "grid",
      gap: sp(2),
      gridColumn: wide ? "1 / -1" : undefined,
      minWidth: 0,
      padding: sp("5px 6px"),
      borderRadius: dim(RADII.sm),
      border: `1px solid ${CSS_COLOR.borderLight}`,
      background: CSS_COLOR.bg2,
      overflow: "hidden",
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: fs(9),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    <span style={{ minWidth: 0, overflow: "hidden" }}>{children}</span>
  </span>
);

export const OperationsSignalTableHeader = ({
  columns = DEFAULT_SIGNAL_VISIBLE_COLUMNS,
  sortKey = "newest",
  sortDirection = "desc",
  onSortChange,
}) => {
  const visibleColumns = resolveSignalVisibleColumnObjects(columns);
  return (
    <div
      role="row"
      style={{
        display: "grid",
        gridTemplateColumns: signalColumnTemplate(visibleColumns),
        gap: 0,
        alignItems: "center",
        height: dim(SIGNAL_TABLE_HEADER_HEIGHT),
        padding: 0,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg1,
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: 0,
        textTransform: "none",
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      {visibleColumns.map((column) => {
      const sort = column.sortKey
        ? {
            sortKey: column.sortKey,
            title: column.title || `Sort by ${column.label}`,
          }
        : null;
      const active = sort?.sortKey === sortKey;
      const ariaSort = active
        ? sortDirection === "asc"
          ? "ascending"
          : "descending"
        : "none";
      const content = (
        <>
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {column.label}
          </span>
          {sort ? (
            <ChevronDown
              size={11}
              strokeWidth={1.8}
              aria-hidden="true"
              style={{
                color: active ? CSS_COLOR.accent : CSS_COLOR.textMuted,
                transform: active && sortDirection === "asc" ? "rotate(180deg)" : "none",
              }}
            />
          ) : null}
        </>
      );

      return (
        <span
          key={column.key}
          role="columnheader"
          aria-sort={sort ? ariaSort : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            height: "100%",
            padding: sp(
              column.key === "rowAction"
                ? SIGNAL_TABLE_ACTION_CELL_PADDING
                : SIGNAL_TABLE_CELL_PADDING,
            ),
            borderRight: SIGNAL_TABLE_BORDER(),
            boxSizing: "border-box",
            minWidth: 0,
          }}
        >
          {sort ? (
            <button
              type="button"
              onClick={() => onSortChange?.(sort.sortKey)}
              aria-pressed={active}
              aria-label={`${sort.title}; ${
                active ? `currently ${ariaSort}` : "not sorted"
              }`}
              title={sort.title}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(4),
                minWidth: 0,
                height: "100%",
                padding: 0,
                border: 0,
                background: "transparent",
                color: active ? CSS_COLOR.text : CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                letterSpacing: 0,
                textTransform: "none",
                cursor: "pointer",
                textDecoration: active ? `underline ${cssColorMix(CSS_COLOR.accent, 40)}` : "none",
                textUnderlineOffset: dim(3),
              }}
            >
              {content}
            </button>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: sp(4),
                minWidth: 0,
              }}
            >
              {content}
            </span>
          )}
        </span>
      );
      })}
    </div>
  );
};

export const OperationsSignalRow = ({
  signal,
  candidate,
  auditProgression = null,
  tfMatrix = null,
  tickerSnapshot = null,
  scoreBreakdown: providedScoreBreakdown = null,
  onRowAction,
  columns = DEFAULT_SIGNAL_VISIBLE_COLUMNS,
  scanActive = false,
  alt = false,
  compact = false,
}) => {
  const signalRecord = asRecord(signal);
  const contractPreview = asRecord(signalRecord.contractPreview);
  const candidateContract = asRecord(candidate?.selectedContract);
  const previewContract = asRecord(contractPreview.selectedContract);
  const hasCandidateContract = Object.keys(candidateContract).length > 0;
  const hasPreviewContract = Object.keys(previewContract).length > 0;
  const effectiveSelectedContract = hasCandidateContract
    ? candidate?.selectedContract
    : hasPreviewContract
      ? previewContract
      : candidate?.selectedContract;
  const contractIsPreview = !hasCandidateContract && hasPreviewContract;
  const selectedContractId = optionProviderContractId(effectiveSelectedContract);
  const liveQuote = getStoredOptionQuoteSnapshot(selectedContractId);
  const previewQuote = contractIsPreview ? asRecord(contractPreview.quote) : null;
  const previewLiquidity = contractIsPreview
    ? asRecord(contractPreview.liquidity)
    : null;
  const effectiveQuote = mergeOptionQuoteSnapshot(
    candidate?.quote ?? previewQuote,
    liveQuote,
  );
  const effectiveLiquidity = candidate?.liquidity ?? previewLiquidity;
  const signalState = signalDisplay(signalRecord);
  const direction = signalState.direction;
  const matrixVerdict = resolveSignalMatrixVerdict({
    primaryState: signalPrimaryStateForMatrix(signalRecord),
    matrixStatesByTimeframe: tfMatrix || {},
    profileTimeframe: signalRecord.timeframe || "5m",
  });
  const matrixDisplay = matrixVerdictDisplay(matrixVerdict);
  const candidateBlocker = candidateBlockerLabel(candidate);
  const signalBlocker = signalActionBlockerLabel(signalRecord);
  const blocker =
    candidateBlocker !== MISSING_VALUE ? candidateBlocker : signalBlocker;
  const rawContract = formatContractDetail(effectiveSelectedContract);
  const contract = hasDisplayValue(rawContract.main)
    ? {
        ...rawContract,
        detail: contractIsPreview
          ? compactJoin(["Preview", rawContract.detail])
          : rawContract.detail,
      }
    : missingContractDisplay(candidate, blocker);
  const actionPlan = actionPlanDisplay(signalRecord, candidate);
  const rawQuote = formatQuoteSummary(effectiveQuote, effectiveLiquidity);
  const hasQuote = hasDisplayValue(rawQuote.main);
  const quote = hasQuote
    ? rawQuote
    : missingQuoteDisplay({ candidate, blocker, selectedContractId });
  const quoteState = liquidityMeta(
    contractIsPreview
      ? {
          reason: contractPreview.reason,
          quote: previewQuote,
          liquidity: previewLiquidity,
        }
      : candidate,
  );
  const QuoteIcon = quoteState.Icon;
  const rawGreeks = formatQuoteGreeksSummary(effectiveQuote);
  const greeks = hasDisplayValue(rawGreeks.main)
    ? rawGreeks
    : missingGreeksDisplay({ candidate, blocker, hasQuote, selectedContractId });
  const scoreBreakdown =
    providedScoreBreakdown ||
    resolveSignalScoreBreakdown({
      signal: signalRecord,
      candidate,
      quote: effectiveQuote,
      liquidity: effectiveLiquidity,
    });
  const actionabilityScore =
    scoreBreakdown?.score == null ? null : Number(scoreBreakdown.score);
  const actionabilitySignalRecord = {
    ...signalRecord,
    score: Number.isFinite(actionabilityScore) ? actionabilityScore : null,
  };
  const gate =
    candidateBlocker !== MISSING_VALUE
      ? resolveCandidateGateDisplay(candidate)
      : signalBlocker !== MISSING_VALUE
        ? {
            category: "signal_policy",
            label: "Policy",
            detail: signalBlocker,
            tone: CSS_COLOR.amber,
          }
        : resolveCandidateGateDisplay(candidate);
  const sync = resolveCandidateSyncDisplay(candidate);
  const statusMeta = statusPillMeta(signalRecord, candidate, blocker);
  const latest = candidateLatestActivityLabel(candidate);
  const latestTimeline = latestTimelineItem(candidate);
  const latestTime = latestTimeline.occurredAt
    ? formatRelativeTimeShort(latestTimeline.occurredAt)
    : signalRecord.signalAt
      ? formatRelativeTimeShort(signalRecord.signalAt)
      : MISSING_VALUE;
  const underlyingPriceValue = resolveUnderlyingPrice(signalRecord, tickerSnapshot);
  const liveUnderlyingPrice = finiteNumberOrNull(tickerSnapshot?.price);
  const priceFlashClassName = useValueFlash(liveUnderlyingPrice);
  const underlyingPrice = formatMoney(underlyingPriceValue, 2);
  const bars = formatBars(signalRecord.barsSinceSignal);
  const signalAge = resolveSignalAge(signalRecord);
  const since = signalSinceDisplay(signalRecord, signalAge, bars);
  const signalMove = resolveSignalMove(signalRecord, tickerSnapshot, candidate);
  const freshnessRatio = resolveFreshnessRatio(signalRecord);
  const signalAgeBlocked =
    signalRecord.actionEligible === false || Boolean(signalRecord.actionBlocker);
  const signalAgeTone =
    signalRecord.fresh && !signalAgeBlocked ? CSS_COLOR.green : CSS_COLOR.amber;
  const freshAndHot = Boolean(
    signalRecord.fresh &&
      !signalAgeBlocked &&
      Number.isFinite(actionabilityScore) &&
      actionabilityScore >= SCORE_FRESH_ROW_GLOW,
  );
  const sparklineData = resolveSparklineData(tickerSnapshot, signalRecord);
  const spreadGauge = quoteGaugeInput(effectiveQuote, effectiveLiquidity);
  const verdict = resolveSignalVerdict({
    signal: actionabilitySignalRecord,
    signalRecord: actionabilitySignalRecord,
    blocker,
    statusMeta,
  });
  const rowAction = resolveRowAction({ candidate, blocker, signalRecord, verdict });
  const quoteAge = formatQuoteAge(effectiveQuote?.ageMs ?? effectiveQuote?.cacheAgeMs);
  const executionTitle = compactJoin([
    quote.main,
    quote.detail,
    quoteAge !== MISSING_VALUE ? `age ${quoteAge}` : null,
    greeks.main,
    greeks.detail,
    greeks.full,
  ]);
  const decisionDetailMeta = resolveDecisionDetailMeta({
    candidate,
    gate,
    blocker,
    statusMeta,
  });
  const rowClassName = [
    "ra-table-row",
    alt ? "ra-position-table-row--alt" : null,
    "ra-signal-row-focus",
    freshAndHot ? "ra-signal-row-glow" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const handleRowAction = (actionId) => {
    onRowAction?.({ actionId, signal: signalRecord, candidate });
  };
  const visibleColumns = resolveSignalVisibleColumnObjects(columns);
  const hasMoveColumn = visibleColumns.some((column) => column.key === "move");
  const rawSpreadWidth = formatSpreadWidth(spreadGauge.widthPct);
  const spread =
    rawSpreadWidth !== MISSING_VALUE
      ? missingDisplay(rawSpreadWidth, MISSING_VALUE)
      : missingSpreadDisplay({ blocker, hasQuote, selectedContractId });
  const spreadWidth = spread.main;
  const quoteTone = contractIsPreview ? CSS_COLOR.textDim : quoteState.tone;
  const spreadTone = contractIsPreview
    ? CSS_COLOR.textDim
    : Number.isFinite(Number(spreadGauge.widthPct))
      ? spreadGaugeTone(spreadGauge.widthPct)
      : quoteState.tone;
  const contractTone =
    hasDisplayValue(rawContract.main) && !contractIsPreview
      ? CSS_COLOR.textSec
      : CSS_COLOR.textDim;
  const greeksTone =
    hasDisplayValue(rawGreeks.main) && !contractIsPreview
      ? CSS_COLOR.textSec
      : CSS_COLOR.textDim;
  const quoteDetail = quoteAge !== MISSING_VALUE ? `age ${quoteAge}` : quote.detail;
  const spreadDetail =
    quoteAge !== MISSING_VALUE
      ? `age ${quoteAge}`
      : spread.detail !== MISSING_VALUE
        ? spread.detail
        : quote.detail;
  const scoreValue = formatScore(actionabilityScore);
  const scoreDetail = compactJoin([
    scoreTierLabel(scoreBreakdown?.tier),
    ...(Array.isArray(scoreBreakdown?.reasonLabels)
      ? scoreBreakdown.reasonLabels.slice(0, 1)
      : []),
  ]);
  const scoreTitle = compactJoin([
    scoreBreakdown?.label,
    ...(Array.isArray(scoreBreakdown?.reasonLabels)
      ? scoreBreakdown.reasonLabels
      : []),
  ]);
  const quoteFlashValue =
    finiteNumberOrNull(effectiveQuote?.mid) ??
    finiteNumberOrNull(effectiveQuote?.mark) ??
    finiteNumberOrNull(effectiveQuote?.last) ??
    finiteNumberOrNull(effectiveQuote?.bid) ??
    finiteNumberOrNull(effectiveQuote?.ask);
  const ageFlashClassName = useValueFlash(finiteNumberOrNull(signalRecord.barsSinceSignal), {
    classify: (next, previous) => {
      const nextNumber = finiteNumberOrNull(next);
      const previousNumber = finiteNumberOrNull(previous);
      if (nextNumber == null || previousNumber == null || nextNumber === previousNumber) {
        return null;
      }
      return nextNumber > previousNumber ? "down" : "up";
    },
  });
  const signalMoveFlashClassName = useValueFlash(finiteNumberOrNull(signalMove.value));
  const quoteFlashClassName = useValueFlash(quoteFlashValue);
  const spreadFlashClassName = useValueFlash(finiteNumberOrNull(spreadGauge.widthPct), {
    classify: (next, previous) => {
      const nextNumber = finiteNumberOrNull(next);
      const previousNumber = finiteNumberOrNull(previous);
      if (nextNumber == null || previousNumber == null || nextNumber === previousNumber) {
        return null;
      }
      return nextNumber < previousNumber ? "up" : "down";
    },
  });
  const scoreFlashClassName = useValueFlash(actionabilityScore);
  const awaitingScan = /awaiting scan/i.test(statusMeta.label);
  const candidateContractSelectionPending =
    isCandidateContractSelectionPending(candidate);
  const quoteEvaluating =
    !contractIsPreview &&
    scanActive &&
    candidateContractSelectionPending &&
    Boolean(candidate) &&
    blocker === MISSING_VALUE &&
    !hasQuote;
  const contractEvaluating =
    scanActive &&
    candidateContractSelectionPending &&
    Boolean(candidate) &&
    blocker === MISSING_VALUE &&
    !hasDisplayValue(rawContract.main);
  const spreadEvaluating =
    quoteEvaluating ||
    (!contractIsPreview &&
      scanActive &&
      candidateContractSelectionPending &&
      hasQuote &&
      !Number.isFinite(Number(spreadGauge.widthPct)));
  const greeksEvaluating =
    !contractIsPreview &&
    scanActive &&
    candidateContractSelectionPending &&
    Boolean(selectedContractId) &&
    !hasDisplayValue(rawGreeks.main);
  const scoreEvaluating = scanActive && !Number.isFinite(actionabilityScore);
  const gateMotionState =
    blocker !== MISSING_VALUE || gate.category !== "clear"
      ? "blocked"
      : scanActive && awaitingScan
        ? "evaluating"
        : "ready";
  const syncMotionState =
    sync.label === "Synced"
      ? "ready"
      : sync.label === "Mismatch"
        ? "blocked"
        : scanActive
          ? "evaluating"
          : null;
  const decisionMotionState =
    verdict?.bucket === "try"
      ? "ready"
      : verdict?.bucket === "pass"
        ? "blocked"
        : scanActive || awaitingScan
          ? "evaluating"
          : "wait";
  const rowActionMotionState = rowAction?.id === "submit" ? "ready" : null;
  const desktopCells = {
    signal: (
      <SignalHeroCell
        signalRecord={signalRecord}
        candidate={candidate}
        direction={direction}
        tfMatrix={tfMatrix}
        freshnessRatio={freshnessRatio}
        price={underlyingPrice}
        priceFlashClassName={priceFlashClassName}
        sparklineData={sparklineData}
        signalMove={signalMove}
        showSignalMove={!hasMoveColumn}
      />
    ),
    since: (
      <DataCell
        value={since.main}
        detail={since.detail}
        tone={signalAgeTone}
        titleValue={compactJoin([
          since.main !== MISSING_VALUE ? `${since.main} since signal` : null,
          since.detail,
          signalRecord.signalAt,
        ])}
        className={ageFlashClassName}
      />
    ),
    move: (
      <DataCell
        value={signalMove.label}
        detail={signalMove.detail}
        tone={
          Number(signalMove.pct) > 0
            ? CSS_COLOR.green
            : Number(signalMove.pct) < 0
              ? CSS_COLOR.red
              : CSS_COLOR.textDim
        }
        titleValue={compactJoin([
          signalMove.detail,
          underlyingPrice !== MISSING_VALUE ? `underlying ${underlyingPrice}` : null,
        ])}
        className={signalMoveFlashClassName}
      />
    ),
    action: (
      <PlanCell
        plan={actionPlan}
        titleValue={compactJoin([
          actionPlan.main,
          actionPlan.detail,
          contract.main,
          contract.detail,
        ])}
        motionState={contractEvaluating ? "evaluating" : null}
      />
    ),
    contract: (
      <DataCell
        value={contract.main}
        detail={contract.detail}
        tone={contractTone}
        titleValue={compactJoin([contract.main, contract.detail])}
        motionState={
          contractEvaluating
            ? "evaluating"
            : hasDisplayValue(rawContract.main) && !contractIsPreview
              ? "ready"
              : null
        }
      />
    ),
    quote: (
      <DataCell
        value={compactQuoteText(quote.main)}
        detail={quoteDetail}
        tone={quoteTone}
        titleValue={executionTitle}
        motionState={
          quoteEvaluating ? "evaluating" : hasQuote && !contractIsPreview ? "ready" : null
        }
        className={quoteFlashClassName}
        icon={
          hasQuote ? (
            <QuoteIcon
              size={SIGNAL_ICON_SIZE}
              strokeWidth={1.8}
              aria-hidden="true"
              style={{ color: quoteTone }}
            />
          ) : null
        }
      />
    ),
    spread: (
      <DataCell
        value={spreadWidth}
        detail={spreadDetail}
        tone={spreadTone}
        motionState={
          spreadEvaluating ? "evaluating" : hasQuote && !contractIsPreview ? "ready" : null
        }
        className={spreadFlashClassName}
        detailExtra={
          hasQuote ? (
            <SpreadGauge
              bid={spreadGauge.bid}
              ask={spreadGauge.ask}
              mid={spreadGauge.mid}
              widthPct={spreadGauge.widthPct}
            />
          ) : null
        }
        titleValue={compactJoin([spreadWidth, quote.main, quote.detail])}
      />
    ),
    greeks: (
      <DataCell
        value={compactGreeksText(greeks.main)}
        detail={compactGreeksText(greeks.detail)}
        tone={greeksTone}
        titleValue={compactJoin([greeks.main, greeks.detail, greeks.full])}
        motionState={
          greeksEvaluating
            ? "evaluating"
            : hasDisplayValue(rawGreeks.main) && !contractIsPreview
              ? "ready"
              : null
        }
      />
    ),
    gate: (
      <DataCell
        value={gate.category === "clear" ? MISSING_VALUE : gate.label}
        detail={gate.category === "clear" ? MISSING_VALUE : gate.detail}
        tone={gate.tone}
        titleValue={compactJoin([gate.label, gate.detail, blocker])}
        motionState={gateMotionState}
      />
    ),
    matrix: (
      <DataCell
        value={matrixDisplay.main}
        detail={matrixDisplay.detail}
        tone={matrixDisplay.tone}
        titleValue={matrixDisplay.title}
        motionState={matrixDisplay.motionState}
        icon={
          <Radar
            size={SIGNAL_ICON_SIZE}
            strokeWidth={1.8}
            aria-hidden="true"
            style={{ color: matrixDisplay.tone }}
          />
        }
      />
    ),
    process: (
      <ProcessTrailCell
        progression={auditProgression}
        scanActive={scanActive}
      />
    ),
    sync: (
      <DataCell
        value={sync.label}
        detail={sync.detail}
        tone={sync.tone}
        titleValue={compactJoin([sync.label, sync.detail])}
        motionState={syncMotionState}
      />
    ),
    score: (
      <DataCell
        value={scoreValue}
        detail={scoreDetail}
        tone={scoreTone(actionabilityScore)}
        titleValue={scoreTitle}
        motionState={scoreEvaluating ? "evaluating" : null}
        className={scoreFlashClassName}
      />
    ),
    decision: (
      <DecisionCell
        actionabilitySignalRecord={actionabilitySignalRecord}
        blocker={blocker}
        decisionDetailMeta={decisionDetailMeta}
        statusMeta={statusMeta}
        sync={sync}
        latest={latest}
        latestTime={latestTime}
        verdict={verdict}
        motionState={decisionMotionState}
      />
    ),
    rowAction: (
      <span
        style={{
          display: "inline-flex",
          justifyContent: "center",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <span className={signalCellClassName(rowActionMotionState)}>
          <RowActionButton action={rowAction} onAction={handleRowAction} />
        </span>
      </span>
    ),
  };
  const visibleColumnKeys = new Set(visibleColumns.map((column) => column.key));
  const compactMetricItems = [
    { key: "since", label: "Age", cell: desktopCells.since },
    { key: "move", label: "Move", cell: desktopCells.move },
    { key: "action", label: "Plan", cell: desktopCells.action },
    { key: "score", label: "Score", cell: desktopCells.score },
    { key: "contract", label: "Contract", cell: desktopCells.contract },
    { key: "quote", label: "Quote", cell: desktopCells.quote },
    { key: "spread", label: "Spread", cell: desktopCells.spread },
    { key: "greeks", label: "Greeks", cell: desktopCells.greeks },
    {
      key: "gate",
      label: "Gate",
      cell: desktopCells.gate,
      visibleWhen: gate.category !== "clear",
    },
    { key: "process", label: "Process", cell: desktopCells.process },
    {
      key: "sync",
      label: "Sync",
      cell: desktopCells.sync,
      visibleWhen: sync.label === "Mismatch" || sync.label === "Event only",
    },
  ].filter(
    (item) => visibleColumnKeys.has(item.key) && item.visibleWhen !== false,
  );
  if (compact) {
    return (
      <div
        data-testid={`algo-signal-row-${signalRecord.symbol}`}
        role="row"
        className={rowClassName}
        style={{
          "--ra-motion-accent": direction.tone,
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: sp(6),
            minWidth: 0,
            padding: sp("7px 6px 8px"),
            boxSizing: "border-box",
            fontFamily: T.sans,
            fontSize: fs(11),
            color: CSS_COLOR.text,
            lineHeight: 1.12,
            boxShadow: `inset 2px 0 0 ${direction.tone}`,
            background: freshAndHot
              ? `linear-gradient(90deg, ${cssColorAlpha(verdict.tone, "12")} 0%, transparent 70%)`
              : "transparent",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: sp(6),
              minWidth: 0,
            }}
          >
            <span
              role="cell"
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              {desktopCells.signal}
            </span>
            <span
              role="cell"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
                minWidth: dim(32),
              }}
            >
              {desktopCells.rowAction}
            </span>
          </div>

          {compactMetricItems.length ? (
            <div
              data-testid="algo-signal-compact-metrics"
              data-algo-pocket-grid="two"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: sp(4),
                minWidth: 0,
              }}
            >
              {compactMetricItems.map((item, index) => (
                <CompactSignalMetric
                  key={item.key}
                  label={item.label}
                  wide={
                    item.key === "gate" ||
                    item.key === "process" ||
                    item.key === "sync" ||
                    (compactMetricItems.length % 2 === 1 &&
                      index === compactMetricItems.length - 1)
                  }
                >
                  {item.cell}
                </CompactSignalMetric>
              ))}
            </div>
          ) : null}

          <span
            role="cell"
            data-testid="algo-signal-compact-decision"
            style={{
              display: "grid",
              minWidth: 0,
              paddingTop: sp(5),
              borderTop: `1px solid ${CSS_COLOR.borderLight}`,
            }}
          >
            {desktopCells.decision}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid={`algo-signal-row-${signalRecord.symbol}`}
      role="row"
      className={rowClassName}
      style={{
        "--ra-motion-accent": direction.tone,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: signalColumnTemplate(visibleColumns),
          gap: 0,
          alignItems: "center",
          width: "100%",
          height: dim(SIGNAL_TABLE_ROW_HEIGHT),
          boxSizing: "border-box",
          fontFamily: T.sans,
          fontSize: fs(11),
          color: CSS_COLOR.text,
          lineHeight: 1.08,
          boxShadow: `inset 2px 0 0 ${direction.tone}`,
          background: freshAndHot
            ? `linear-gradient(90deg, ${cssColorAlpha(verdict.tone, "12")} 0%, transparent 55%)`
            : "transparent",
        }}
      >
        {visibleColumns.map((column) => (
          <span
            key={column.key}
            role="cell"
            style={{
              minWidth: 0,
              height: "100%",
              padding: sp(
                column.key === "rowAction"
                  ? SIGNAL_TABLE_ACTION_CELL_PADDING
                  : SIGNAL_TABLE_CELL_PADDING,
              ),
              borderRight: SIGNAL_TABLE_BORDER(),
              boxSizing: "border-box",
              display: "grid",
              alignItems: "center",
              overflow: "hidden",
            }}
          >
            {desktopCells[column.key]}
          </span>
        ))}
      </div>
    </div>
  );
};

export default OperationsSignalRow;
