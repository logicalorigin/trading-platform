import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Clock,
  MinusCircle,
  ScanLine,
  Send,
} from "lucide-react";
import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { AppTooltip } from "@/components/ui/tooltip";
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
import { toneForDirectionalIntent } from "../../features/platform/semanticToneModel.js";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { formatAppTime } from "../../lib/timeZone";
import {
  extractSparklinePoints,
  MicroSparkline,
} from "../../components/platform/primitives.jsx";
import {
  hydrateSignalMatrixProfileTimeframe,
  resolveConfiguredMtfAlignment,
  resolveSignalMatrixVerdict,
  signalPrimaryStateForMatrix,
} from "../../features/signals/signalsRowModel.js";
import {
  buildSignalSparklinePointColors,
  defaultSignalSparklineColorForDirection,
  isSignalSparklineDirection,
} from "../../features/signals/signalSparklineModel.js";
import { getStoredOptionQuoteSnapshot } from "../../features/platform/live-streams";
import { useValueFlash } from "../../lib/motion.jsx";
import {
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
  ColumnHeaderCell,
  SortableColumnHeaderCell,
  TableHeaderDndContext,
} from "../../components/platform/InteractiveColumnHeader.jsx";
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
  resolveDisplayCurrentPrice,
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
export const SIGNAL_HERO_TOP_ROW_HEIGHT = 14;
export const SIGNAL_HERO_LOWER_ROW_HEIGHT = 14;
export const SIGNAL_HERO_SPARKLINE_MIN_WIDTH = 24;
export const SIGNAL_HERO_SPARKLINE_WIDTH = 40;
export const SIGNAL_HERO_SPARKLINE_MAX_WIDTH = 52;
export const SIGNAL_HERO_SPARKLINE_HEIGHT = 14;
export const SIGNAL_TRADE_BUTTON_SIZE = 14;
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
    track: "158px",
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
    track: "84px",
  },
  {
    key: "gate",
    label: "Gate",
    toggleLabel: "Decision gate",
    track: "96px",
  },
  {
    key: "matrix",
    label: "Matrix",
    toggleLabel: "Signal matrix verdict",
    track: "98px",
  },
  {
    key: "contract",
    label: "Contract",
    toggleLabel: "Selected contract",
    track: "118px",
  },
  {
    key: "quote",
    label: "Quote",
    toggleLabel: "Option quote",
    track: "98px",
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
    track: "98px",
  },
  {
    key: "process",
    label: "Stage",
    toggleLabel: "Selection stage",
    track: "136px",
  },
  {
    key: "sync",
    label: "Sync",
    toggleLabel: "Order sync",
    track: "92px",
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
    track: "116px",
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
  "process",
  "sync",
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

export const directionMeta = (direction) => {
  const value = String(direction || "").toLowerCase();
  if (value === "buy" || value === "long" || value === "bullish") {
    return {
      label: "BUY",
      trend: "BULLISH",
      tone: toneForDirectionalIntent("bullish"),
      primitive: "buy",
    };
  }
  if (value === "sell" || value === "short" || value === "bearish") {
    return {
      label: "SELL",
      trend: "BEARISH",
      tone: toneForDirectionalIntent("bearish"),
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

const contractSelectionStatusValue = (candidate) =>
  String(asRecord(candidate).contractSelectionStatus || "")
    .trim()
    .toLowerCase();

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

const formatGreekGridNumber = (value, digits) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : MISSING_VALUE;
};

const GREEK_GRID_ITEM_DEFS = [
  { key: "delta", label: "D", title: "Delta", digits: 2 },
  { key: "gamma", label: "G", title: "Gamma", digits: 3 },
  { key: "theta", label: "Th", title: "Theta", digits: 3 },
  { key: "vega", label: "V", title: "Vega", digits: 3 },
];

const greekGridItems = (quote) => {
  const record = asRecord(quote);
  return GREEK_GRID_ITEM_DEFS.map((item) => ({
    ...item,
    value: formatGreekGridNumber(record[item.key], item.digits),
  }));
};

const formatQuoteAge = (ageMs) => {
  const numeric = Number(ageMs);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  if (numeric < 1_000) return `${Math.round(numeric)}ms`;
  if (numeric < 60_000) return `${(numeric / 1_000).toFixed(1)}s`;
  if (numeric < 3_600_000) return `${(numeric / 60_000).toFixed(1)}m`;
  return `${(numeric / 3_600_000).toFixed(1)}h`;
};

const formatDiagnosticLabel = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return MISSING_VALUE;
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bIbkr\b/g, "IBKR")
    .replace(/\bDte\b/g, "DTE")
    .replace(/\bMtf\b/g, "MTF");
};

const firstDisplayLabel = (...values) => {
  for (const value of values) {
    const label = formatDiagnosticLabel(value);
    if (label !== MISSING_VALUE) return label;
  }
  return MISSING_VALUE;
};

const arrayLength = (value) => (Array.isArray(value) ? value.length : 0);

const diagnosticContractCount = (candidate) => {
  const contractSelection = asRecord(candidate?.contractSelection);
  const chainDebug = asRecord(candidate?.chainDebug);
  const attempts = Array.isArray(candidate?.chainAttempts)
    ? candidate.chainAttempts
    : [];
  const attemptCounts = attempts.map((attempt) =>
    Number(asRecord(attempt).contractCount),
  );
  const count = [
    Number(contractSelection.candidateCount),
    Number(chainDebug.contractCount),
    ...attemptCounts,
  ].find((value) => Number.isFinite(value));
  return Number.isFinite(count) ? Math.max(0, count) : null;
};

const diagnosticLiveDemandSummary = (liveQuoteDemand) => {
  const demand = asRecord(liveQuoteDemand);
  if (!Object.keys(demand).length) return null;
  const states = Array.isArray(demand.states) ? demand.states.map(asRecord) : [];
  const firstPending =
    states.find((state) => String(state.status || "").toLowerCase() === "pending") ||
    states[0] ||
    {};
  const status = String(demand.status || firstPending.status || "").toLowerCase();
  const reason = String(demand.reason || firstPending.reason || "").trim();
  const hydrationAttempts = Number(demand.hydrationAttempts);
  const hydrationWaitMs = Number(demand.hydrationWaitMs);
  const cacheAgeMs = Number(demand.cacheAgeMs ?? firstPending.cacheAgeMs);
  const requestedCount =
    arrayLength(demand.requestedProviderContractIds) ||
    arrayLength(demand.providerContractIds) ||
    states.length ||
    (demand.providerContractId ? 1 : 0);
  const detail = compactJoin([
    firstDisplayLabel(reason),
    Number.isFinite(hydrationAttempts) ? `${hydrationAttempts} attempts` : null,
    Number.isFinite(hydrationWaitMs) ? `${formatQuoteAge(hydrationWaitMs)} wait` : null,
    Number.isFinite(cacheAgeMs) ? `${formatQuoteAge(cacheAgeMs)} cache` : null,
    requestedCount > 1 ? `${requestedCount} contracts` : null,
  ]);
  return {
    status,
    reason,
    detail,
    title: compactJoin([
      `live demand ${status || MISSING_VALUE}`,
      firstDisplayLabel(reason),
      detail,
      demand.owner,
    ]),
  };
};

const resolveSelectionStageDisplay = ({
  candidate,
  blocker,
  hasSelectedContract,
  selectedContractId,
  hasQuote,
  contractIsPreview,
}) => {
  const candidateRecord = asRecord(candidate);
  const status = String(
    candidateRecord.actionStatus || candidateRecord.status || "",
  ).toLowerCase();
  const contractSelectionStatus = contractSelectionStatusValue(candidateRecord);
  const liveDemand = diagnosticLiveDemandSummary(candidateRecord.liveQuoteDemand);
  const reason = String(candidateRecord.reason || "").trim();
  const contractSelectionReason = String(
    candidateRecord.contractSelectionReason || reason || "",
  ).trim();

  if (!Object.keys(candidateRecord).length) {
    return {
      main: "Queued",
      detail: "action candidate pending",
      tone: CSS_COLOR.cyan,
      Icon: ScanLine,
      motionState: "evaluating",
    };
  }

  if (contractSelectionStatus === "deferred") {
    return {
      main: "Action deferred",
      detail: firstDisplayLabel(
        contractSelectionReason,
        "contract_selection_deferred",
      ),
      tone: CSS_COLOR.amber,
      Icon: Clock,
      motionState: "wait",
      contractMain: "Deferred",
      contractDetail: firstDisplayLabel(contractSelectionReason),
      quoteMain: "Not requested",
    };
  }

  if (hasBlockerDisplay(blocker) || status === "skipped") {
    return {
      main: "Blocked",
      detail: blocker !== MISSING_VALUE ? blocker : firstDisplayLabel(reason),
      tone: CSS_COLOR.red,
      Icon: Ban,
      motionState: "blocked",
      contractMain: "Not selected",
      quoteMain: "Not requested",
    };
  }

  if (contractSelectionStatus === "blocked") {
    return {
      main: "Blocked",
      detail: firstDisplayLabel(
        contractSelectionReason,
        "contract_selection_blocked",
      ),
      tone: CSS_COLOR.red,
      Icon: Ban,
      motionState: "blocked",
      contractMain: "Not selected",
      quoteMain: "Not requested",
    };
  }

  if (contractIsPreview) {
    return {
      main: "Preview",
      detail: "policy-only contract preview",
      tone: CSS_COLOR.textDim,
      Icon: Clock,
      motionState: null,
    };
  }

  if (liveDemand?.status === "pending") {
    const awaitingGreeks = /greek/i.test(liveDemand.reason);
    return {
      main: awaitingGreeks ? "Waiting greeks" : "Waiting quote",
      detail: liveDemand.detail,
      title: liveDemand.title,
      tone: CSS_COLOR.amber,
      Icon: Clock,
      motionState: "evaluating",
      quoteMain: awaitingGreeks ? "Greeks pending" : "Quote pending",
      quoteDetail: liveDemand.detail,
    };
  }

  if (liveDemand && ["rejected", "unavailable", "stale"].includes(liveDemand.status)) {
    return {
      main: firstDisplayLabel(liveDemand.status),
      detail: liveDemand.detail,
      title: liveDemand.title,
      tone: liveDemand.status === "stale" ? CSS_COLOR.amber : CSS_COLOR.red,
      Icon: AlertTriangle,
      motionState: liveDemand.status === "stale" ? "wait" : "blocked",
      quoteMain: firstDisplayLabel(liveDemand.status),
      quoteDetail: liveDemand.detail,
    };
  }

  if (hasSelectedContract && !hasQuote && selectedContractId) {
    return {
      main: "Contract selected",
      detail: "waiting live quote",
      tone: CSS_COLOR.amber,
      Icon: Clock,
      motionState: "evaluating",
      quoteMain: "Quote pending",
      quoteDetail: "live quote not received",
    };
  }

  if (hasSelectedContract && hasQuote) {
    return {
      main: "Priced",
      detail: "contract and quote ready",
      tone: CSS_COLOR.green,
      Icon: CheckCircle2,
      motionState: "ready",
    };
  }

  const contractCount = diagnosticContractCount(candidateRecord);
  if (contractCount != null && contractCount <= 0) {
    return {
      main: "Chain empty",
      detail: firstDisplayLabel(reason || "no_contract_for_strike_slot"),
      tone: CSS_COLOR.amber,
      Icon: AlertTriangle,
      motionState: "blocked",
      contractMain: "No contract",
    };
  }

  if (candidateRecord.optionMarketDataBackoff) {
    return {
      main: "Backoff",
      detail: firstDisplayLabel(asRecord(candidateRecord.optionMarketDataBackoff).reason),
      tone: CSS_COLOR.amber,
      Icon: Clock,
      motionState: "wait",
      contractMain: "Backoff",
    };
  }

  if (candidateRecord.selectedExpiration || candidateRecord.expirationsDebug) {
    return {
      main: "Resolving chain",
      detail:
        contractCount != null
          ? `${contractCount} contracts checked`
          : "expiration selected",
      tone: CSS_COLOR.cyan,
      Icon: ScanLine,
      motionState: "evaluating",
      contractMain: "Resolving chain",
    };
  }

  if (contractSelectionStatus === "pending" || status === "candidate") {
    return {
      main: "Resolving contract",
      detail: "expiration and chain pending",
      tone: CSS_COLOR.cyan,
      Icon: ScanLine,
      motionState: "evaluating",
      contractMain: "Resolving",
      contractDetail: "expiration and chain pending",
    };
  }

  if (status && status !== "candidate") {
    return {
      main: firstDisplayLabel(status),
      detail: firstDisplayLabel(reason),
      tone: CSS_COLOR.textSec,
      Icon: Clock,
      motionState: null,
    };
  }

  return {
    main: "Queued",
    detail: "action candidate pending",
    tone: CSS_COLOR.cyan,
    Icon: ScanLine,
    motionState: "evaluating",
  };
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

const isCandidateContractSelectionPending = (candidate) => {
  const contractSelectionStatus = contractSelectionStatusValue(candidate);
  if (contractSelectionStatus) return contractSelectionStatus === "pending";
  return candidateActionStatusValue(candidate) === "candidate";
};

const shouldShowContractSelectionStage = (candidate) => {
  const contractSelectionStatus = contractSelectionStatusValue(candidate);
  if (contractSelectionStatus) {
    return (
      contractSelectionStatus === "pending" ||
      contractSelectionStatus === "deferred"
    );
  }
  return (
    candidateActionStatusValue(candidate) === "candidate"
  );
};

const selectionStageDetail = (selectionStage) =>
  selectionStage?.contractDetail ||
  selectionStage?.quoteDetail ||
  selectionStage?.detail ||
  MISSING_VALUE;

const missingContractDisplay = (candidate, blocker, selectionStage) => {
  if (!candidate) {
    return missingDisplay(MISSING_VALUE, MISSING_VALUE);
  }
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not selected", blocker);
  if (shouldShowContractSelectionStage(candidate)) {
    return missingDisplay(
      selectionStage?.contractMain || selectionStage?.main || "Resolving",
      selectionStageDetail(selectionStage),
    );
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const missingQuoteDisplay = ({ blocker, selectedContractId, selectionStage }) => {
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not requested", blocker);
  if (hasDisplayValue(selectionStage?.quoteMain)) {
    return missingDisplay(
      selectionStage.quoteMain,
      selectionStage.quoteDetail || selectionStage.detail || MISSING_VALUE,
    );
  }
  if (selectedContractId) {
    return missingDisplay("Quote pending", MISSING_VALUE);
  }
  if (hasDisplayValue(selectionStage?.contractMain)) {
    return missingDisplay("Not requested", selectionStageDetail(selectionStage));
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const missingGreeksDisplay = ({
  candidate,
  blocker,
  selectedContractId,
  selectionStage,
} = {}) => {
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not tested", blocker);
  if (selectedContractId) {
    return missingDisplay("Greeks pending", MISSING_VALUE);
  }
  if (candidate && shouldShowContractSelectionStage(candidate)) {
    return missingDisplay("Not tested", selectionStageDetail(selectionStage));
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const missingSpreadDisplay = ({
  candidate,
  blocker,
  hasQuote,
  selectedContractId,
  selectionStage,
} = {}) => {
  if (hasBlockerDisplay(blocker)) return missingDisplay("Not priced", blocker);
  if (selectedContractId && !hasQuote) {
    return missingDisplay("Quote pending", MISSING_VALUE);
  }
  if (selectedContractId) return missingDisplay("Spread pending", MISSING_VALUE);
  if (candidate && shouldShowContractSelectionStage(candidate)) {
    return missingDisplay("Not priced", selectionStageDetail(selectionStage));
  }
  return missingDisplay(MISSING_VALUE, MISSING_VALUE);
};

const statusPillMeta = (signal, candidate, blocker) => {
  if (blocker !== MISSING_VALUE) {
    return { label: blocker, tone: CSS_COLOR.red, Icon: Ban };
  }
  const actionStatus = candidate?.actionStatus || candidate?.status;
  const contractSelectionStatus = contractSelectionStatusValue(candidate);
  if (contractSelectionStatus === "blocked") {
    return {
      label: firstDisplayLabel(
        candidate?.contractSelectionReason || candidate?.reason,
        "Contract blocked",
      ),
      tone: CSS_COLOR.red,
      Icon: Ban,
    };
  }
  if (contractSelectionStatus === "deferred") {
    return { label: "Action deferred", tone: CSS_COLOR.amber, Icon: Clock };
  }
  if (
    contractSelectionStatus === "pending" &&
    (!actionStatus || String(actionStatus).toLowerCase() === "candidate")
  ) {
    return { label: "Contract pending", tone: CSS_COLOR.cyan, Icon: ScanLine };
  }
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
      Icon: ScanLine,
    };
  }
  if (signal?.actionEligible === true) {
    return { label: "Candidate missing", tone: CSS_COLOR.red, Icon: AlertTriangle };
  }
  if (signal?.status === "unavailable") {
    return { label: "Unavailable", tone: CSS_COLOR.textDim, Icon: MinusCircle };
  }
  if (signal?.fresh === false) {
    return { label: "Aged", tone: CSS_COLOR.amber, Icon: Clock };
  }
  return { label: "Awaiting scan", tone: CSS_COLOR.cyan, Icon: ScanLine };
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
      <AppTooltip content={meta.label}>
        <span
          className={classNames(
            "ra-signal-status-pill",
            motionState ? `ra-signal-status-pill-${motionState}` : null,
            className,
          )}
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
      </AppTooltip>
    );
  }
  return (
    <AppTooltip content={meta.label}>
      <span
        className={classNames(
          "ra-signal-status-pill",
          motionState ? `ra-signal-status-pill-${motionState}` : null,
          className,
        )}
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
    </AppTooltip>
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

const resolveDecisionDetailMeta = ({
  signal,
  candidate,
  gate,
  blocker,
  statusMeta,
}) => {
  if (blocker !== MISSING_VALUE) {
    const base = DECISION_DETAIL_META[gate.category] || DECISION_DETAIL_META.other;
    return {
      tone: gate.tone || base.tone,
      shortLabel: gate.detail || blocker,
      fullLabel: `${base.label}: ${gate.detail || blocker}`,
    };
  }
  if (!candidate) {
    if (signal?.actionEligible === true) {
      return {
        tone: CSS_COLOR.red,
        shortLabel: "Candidate missing",
        fullLabel: "Fresh actionable signal has no Signal Options candidate",
      };
    }
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

// Delegate to the shared resolver so the displayed price and the Move column's
// "current" can never diverge (the divergence that produced phantom moves on
// stale rows). Same precedence: live quote -> last bar close -> fire price.
const resolveUnderlyingPrice = (signal, tickerSnapshot) =>
  resolveDisplayCurrentPrice(signal, tickerSnapshot).price;

const hasDrawableSparklineData = (value) =>
  Array.isArray(value) && extractSparklinePoints(value).length >= 2;

export const resolveSparklineData = (tickerSnapshot, signal) => {
  if (hasDrawableSparklineData(tickerSnapshot?.sparkBars)) return tickerSnapshot.sparkBars;
  if (hasDrawableSparklineData(tickerSnapshot?.spark)) return tickerSnapshot.spark;
  if (hasDrawableSparklineData(signal?.sparkBars)) return signal.sparkBars;
  if (hasDrawableSparklineData(signal?.spark)) return signal.spark;
  if (hasDrawableSparklineData(signal?.bars)) return signal.bars;
  return [];
};

export const resolveStaSparklineSignalTreatment = (
  direction,
  { hasTimeline = false } = {},
) => {
  const primitive = directionMeta(direction).primitive;
  if (!isSignalSparklineDirection(primitive)) {
    return {
      color: null,
      mode: "price",
      direction: null,
    };
  }
  if (hasTimeline) {
    return {
      color: null,
      mode: "timeline",
      direction: primitive,
    };
  }
  return {
    color: defaultSignalSparklineColorForDirection(primitive),
    mode: "current",
    direction: primitive,
  };
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

const signalSinceDisplay = (signal, signalAge) => {
  const signalTimestamp = signal?.signalAt ?? signal?.currentSignalAt;
  const signalTime = formatAppTime(signalTimestamp, {}, MISSING_VALUE);
  const ageLabel =
    signalAge?.label && signalAge.label !== MISSING_VALUE
      ? signalAge.label
      : MISSING_VALUE;
  return {
    main: ageLabel,
    detail: signalTime,
    title: compactJoin([
      signalTimestamp ? `Signal ${signalTime}` : null,
      signalTimestamp,
      ageLabel,
    ]),
  };
};

const actionIntentTokens = (label) =>
  String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const actionIntentTokenTone = (token) => {
  const normalized = String(token || "").toUpperCase();
  if (normalized === "BUY" || normalized === "CALL") return toneForDirectionalIntent("bullish");
  if (normalized === "SELL" || normalized === "PUT") return toneForDirectionalIntent("bearish");
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
    <AppTooltip
      content={[
        titleValue ?? (typeof value === "string" ? value : null),
        hasDisplayValue(detail) ? detail : null,
      ].filter(Boolean).join(" · ")}
    >
      <span
        className={signalCellClassName(motionState, className)}
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
    </AppTooltip>
  );
};

const GreeksGridCell = ({
  quote,
  fallback,
  tone = CSS_COLOR.textSec,
  titleValue,
  motionState = null,
}) => {
  const items = greekGridItems(quote);
  const hasGreekValues = items.some((item) => hasDisplayValue(item.value));
  if (!hasGreekValues) {
    return (
      <DataCell
        value={fallback?.main}
        detail={fallback?.detail}
        tone={tone}
        titleValue={titleValue}
        motionState={motionState}
      />
    );
  }

  return (
    <AppTooltip content={titleValue}>
      <span
        className={signalCellClassName(motionState)}
        data-algo-greeks-grid="2x2"
        data-testid="algo-signal-greeks-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gridTemplateRows: "repeat(2, minmax(0, 1fr))",
          alignItems: "stretch",
          columnGap: 0,
          rowGap: 0,
          minWidth: 0,
          width: "100%",
          height: "100%",
          color: tone,
          overflow: "hidden",
          lineHeight: 1,
        }}
      >
      {items.map((item, index) => {
        const leftColumn = index % 2 === 0;
        const topRow = index < 2;
        return (
          <AppTooltip key={item.key} content={`${item.title} ${item.value}`}>
            <span
              data-testid={`algo-signal-greek-${item.key}`}
            style={{
              display: "grid",
              gridTemplateColumns: "max-content minmax(0, 1fr)",
              alignItems: "center",
              gap: sp(2),
              minWidth: 0,
              padding: sp("1px 3px"),
              borderRight: leftColumn ? `1px solid ${CSS_COLOR.borderLight}` : undefined,
              borderBottom: topRow ? `1px solid ${CSS_COLOR.borderLight}` : undefined,
              boxSizing: "border-box",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: fs(8),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
              }}
            >
              {item.label}
            </span>
            <span
              aria-label={`${item.title} ${item.value}`}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: fs(9),
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {item.value}
            </span>
            </span>
          </AppTooltip>
        );
      })}
      </span>
    </AppTooltip>
  );
};

const PlanCell = ({ plan, titleValue, motionState = null }) => {
  const detail = hasDisplayValue(plan?.detail) ? plan.detail : MISSING_VALUE;
  const intentTokens = actionIntentTokens(plan?.main);
  return (
    <AppTooltip content={[titleValue, plan?.main, detail].filter(hasDisplayValue).join(" · ")}>
      <span
        className={signalCellClassName(motionState)}
        data-testid="algo-signal-plan-cell"
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
    </AppTooltip>
  );
};

const signalChartTitle = (signalRecord) => {
  const signalTimestamp = signalRecord?.signalAt || signalRecord?.currentSignalAt;
  return [
    signalTimestamp ? `Signal ${formatAppTime(signalTimestamp)}` : null,
    signalTimestamp ? `${formatRelativeTimeShort(signalTimestamp)} since` : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const SignalHeroCell = ({
  signalRecord,
  candidate,
  tfMatrix,
  timeframes,
  price,
  priceFlashClassName,
  sparklineData,
  sparklinePoints,
  sparklinePointColors,
  sparklineSignalEventCount = 0,
  sparklineSignalTreatment,
  signalMove,
  tradeButton = null,
  showSignalMove = true,
}) => {
  const hasSparkline = hasDrawableSparklineData(sparklineData);
  return (
    <span
      data-testid="algo-signal-hero-cell"
      className="ra-signal-cell-motion"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: `${dim(SIGNAL_HERO_TOP_ROW_HEIGHT)} ${dim(
          SIGNAL_HERO_LOWER_ROW_HEIGHT,
        )}`,
        gap: 0,
        alignItems: "center",
        height: dim(SIGNAL_HERO_TOP_ROW_HEIGHT + SIGNAL_HERO_LOWER_ROW_HEIGHT),
        minWidth: 0,
        overflow: "hidden",
        lineHeight: 1.12,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(4),
          width: "100%",
          height: dim(SIGNAL_HERO_TOP_ROW_HEIGHT),
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        <StrategyTag candidate={candidate} signal={signalRecord} />
        <span
          style={{
            color: CSS_COLOR.text,
            fontSize: fs(13),
            fontWeight: FONT_WEIGHTS.medium,
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {signalRecord.symbol || MISSING_VALUE}
        </span>
        {tradeButton}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          columnGap: sp(4),
          width: "100%",
          height: dim(SIGNAL_HERO_LOWER_ROW_HEIGHT),
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
          timeframes={timeframes}
          style={{
            flex: `0 0 ${dim(36)}`,
            minWidth: dim(36),
            width: dim(36),
            gap: sp(4),
          }}
        />
        {hasSparkline ? (
          <AppTooltip content={signalChartTitle(signalRecord) || undefined}>
            <span
              data-testid="algo-signal-hero-sparkline"
              data-sparkline-signal-mode={sparklineSignalTreatment.mode}
              data-sparkline-signal-events={sparklineSignalEventCount}
              data-sparkline-signal-direction={
                sparklineSignalTreatment.direction || undefined
              }
              role="img"
              aria-label={signalChartTitle(signalRecord) || undefined}
              style={{
                width: dim(SIGNAL_HERO_SPARKLINE_WIDTH),
                minWidth: dim(SIGNAL_HERO_SPARKLINE_MIN_WIDTH),
                maxWidth: dim(SIGNAL_HERO_SPARKLINE_MAX_WIDTH),
                height: dim(SIGNAL_HERO_SPARKLINE_HEIGHT),
                flex: `0 1 ${dim(SIGNAL_HERO_SPARKLINE_WIDTH)}`,
                overflow: "hidden",
              }}
            >
              <MicroSparkline
                data={sparklineData}
                points={sparklinePoints}
                positive={sparklineSignalTreatment.direction === "buy"}
                color={sparklineSignalTreatment.color}
                pointColors={sparklinePointColors}
                width={SIGNAL_HERO_SPARKLINE_WIDTH}
                height={SIGNAL_HERO_SPARKLINE_HEIGHT}
                className="ra-sparkline"
                ariaHidden
                style={{ width: "100%", height: "100%" }}
              />
            </span>
          </AppTooltip>
        ) : null}
        <span
          className={priceFlashClassName}
          style={{
            color: CSS_COLOR.textSec,
            fontVariantNumeric: "tabular-nums",
            fontWeight: FONT_WEIGHTS.medium,
            flex: `0 1 ${dim(52)}`,
            maxWidth: dim(52),
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "right",
          }}
        >
          {price}
        </span>
        {showSignalMove ? (
          <span
            style={{
              flex: "1 1 0",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
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
  );
};

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
      <AppTooltip content={compactJoin([decisionLabel, statusMeta.label, detailTitle])}>
        <span
          className={classNames(
            "ra-signal-decision-pill",
            verdict?.bucket ? `ra-signal-decision-pill-${verdict.bucket}` : null,
          )}
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
      </AppTooltip>
      <AppTooltip content={detailTitle}>
        <span
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
      </AppTooltip>
    </span>
  );
};

const PROCESS_STAGE_META = {
  signal: { label: "Signal", tone: CSS_COLOR.textSec, Icon: ScanLine },
  candidate: { label: "Candidate", tone: CSS_COLOR.cyan, Icon: ScanLine },
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

const ProcessTrailCell = ({
  progression,
  scanActive = false,
  selectionStage = null,
}) => {
  const eventCount = Number(progression?.eventCount || 0);
  if (!eventCount) {
    return (
      <DataCell
        value={selectionStage?.main || (scanActive ? "Listening" : MISSING_VALUE)}
        detail={
          selectionStage?.detail ||
          (scanActive ? "audit trail pending" : MISSING_VALUE)
        }
        tone={
          selectionStage?.tone ||
          (scanActive ? CSS_COLOR.cyan : CSS_COLOR.textDim)
        }
        titleValue={selectionStage?.title}
        motionState={
          selectionStage?.motionState || (scanActive ? "evaluating" : null)
        }
      />
    );
  }

  const latestStage = progression?.latestStage || progression?.latest?.stage;
  const latestMeta = processStageMeta(latestStage);
  const LatestIcon = selectionStage?.Icon || latestMeta.Icon;
  const stageIds = Array.isArray(progression?.stageIds)
    ? progression.stageIds.slice(-5)
    : [];
  const latestAge = progression?.latestOccurredAt
    ? formatRelativeTimeShort(new Date(progression.latestOccurredAt))
    : "";
  const detail = compactJoin([
    selectionStage?.detail,
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
    <AppTooltip content={compactJoin([selectionStage?.title, title || detail])}>
      <span
        data-testid="algo-signal-process-cell"
        className={signalCellClassName(
          selectionStage?.motionState ||
            (latestStage?.id === "blocked"
            ? "blocked"
            : latestStage?.id === "submitted" ||
                latestStage?.id === "filled" ||
                latestStage?.id === "managed" ||
                latestStage?.id === "closed"
              ? "ready"
              : scanActive
                ? "evaluating"
                : null),
        )}
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
          color: selectionStage?.tone || latestMeta.tone,
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
          {selectionStage?.main || latestMeta.label}
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
                <AppTooltip key={stageId} content={markerMeta.label}>
                  <span
                    style={{
                      width: dim(5),
                      height: dim(5),
                      borderRadius: dim(RADII.pill),
                      background: markerMeta.tone,
                      opacity: stageId === latestStage?.id ? 1 : 0.5,
                    }}
                  />
                </AppTooltip>
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
    </AppTooltip>
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
      <AppTooltip content="No row action available">
        <span
          data-testid="algo-signal-row-action-none"
          aria-label="No row action available"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: dim(28),
            height: dim(24),
            borderRadius: dim(RADII.sm),
            border: `1px solid ${CSS_COLOR.borderLight}`,
            background: cssColorAlpha(CSS_COLOR.textDim, "10"),
            color: CSS_COLOR.textDim,
          }}
        >
          <MinusCircle size={14} strokeWidth={1.7} aria-hidden="true" />
        </span>
      </AppTooltip>
    );
  }
  const Icon = action.Icon;
  return (
    <AppTooltip content={action.title || action.label}>
      <button
        type="button"
        className={classNames(
          "ra-signal-action-button",
          action.id === "submit" ? "ra-signal-action-button-ready" : null,
        )}
        data-testid={`algo-signal-row-action-${action.id}`}
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
    </AppTooltip>
  );
};

const SignalTradeButton = ({ symbol, onOpen }) => {
  if (!onOpen) return null;
  const label = `Open ${symbol || "selected"} contract in Trade`;
  return (
    <AppTooltip content={label}>
      <button
        type="button"
        data-testid="algo-signal-open-trade"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: dim(SIGNAL_TRADE_BUTTON_SIZE),
          width: dim(SIGNAL_TRADE_BUTTON_SIZE),
          height: dim(SIGNAL_TRADE_BUTTON_SIZE),
          borderRadius: dim(RADII.sm),
          border: `1px solid ${cssColorAlpha(CSS_COLOR.accent, "44")}`,
          background: cssColorAlpha(CSS_COLOR.accent, "16"),
          color: CSS_COLOR.accent,
          cursor: "pointer",
          flex: "0 0 auto",
        }}
      >
        <ArrowUpRight size={10} strokeWidth={2} aria-hidden="true" />
      </button>
    </AppTooltip>
  );
};

const CompactSignalMetric = ({
  label,
  testId,
  wide = false,
  topBorder = true,
  children,
}) => (
  <span
    data-testid={testId}
    role="cell"
    style={{
      display: "grid",
      gap: sp(1),
      gridColumn: wide ? "1 / -1" : undefined,
      minWidth: 0,
      padding: sp("3px 5px"),
      borderTop: topBorder ? `1px solid ${CSS_COLOR.borderLight}` : undefined,
      borderRight: `1px solid ${CSS_COLOR.borderLight}`,
      overflow: "hidden",
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: fs(8),
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
  onColumnReorder,
  onSortChange,
}) => {
  const visibleColumns = resolveSignalVisibleColumnObjects(columns);
  const headerRow = (
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
        const HeaderCell = onColumnReorder
          ? SortableColumnHeaderCell
          : ColumnHeaderCell;

        return (
          <HeaderCell
            key={column.key}
            as="span"
            id={column.key}
            active={active}
            label={column.label}
            onSort={sort ? () => onSortChange?.(sort.sortKey) : undefined}
            reorderable={Boolean(onColumnReorder) && column.key !== "rowAction"}
            sortDirection={sortDirection}
            sortable={Boolean(sort)}
            sortTitle={sort?.title}
            style={{
              height: "100%",
              padding: sp(
                column.key === "rowAction"
                  ? SIGNAL_TABLE_ACTION_CELL_PADDING
                  : SIGNAL_TABLE_CELL_PADDING,
              ),
              borderRight: SIGNAL_TABLE_BORDER(),
            }}
          />
        );
      })}
    </div>
  );
  if (!onColumnReorder) return headerRow;
  return (
    <TableHeaderDndContext
      columnIds={visibleColumns.map((column) => column.key)}
      onReorder={onColumnReorder}
    >
      {headerRow}
    </TableHeaderDndContext>
  );
};

export const OperationsSignalRow = ({
  signal,
  candidate,
  auditProgression = null,
  tfMatrix = null,
  timeframes = undefined,
  mtfAlignmentConfig = null,
  executionTimeframe = null,
  tickerSnapshot = null,
  scoreBreakdown: providedScoreBreakdown = null,
  signalEvents = [],
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
  const tradeCandidate = hasCandidateContract || hasPreviewContract
    ? {
        ...(contractIsPreview ? contractPreview : asRecord(candidate)),
        ...(candidate && typeof candidate === "object" ? candidate : {}),
        symbol: candidate?.symbol || contractPreview.symbol || signalRecord.symbol,
        selectedContract: effectiveSelectedContract,
      }
    : null;
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
  const primaryMatrixState = signalPrimaryStateForMatrix(signalRecord);
  const resolvedTfMatrix = hydrateSignalMatrixProfileTimeframe({
    matrixStatesByTimeframe: tfMatrix || {},
    primaryState: primaryMatrixState,
    profileTimeframe: signalRecord.timeframe || "5m",
    includePrimaryFallback: false,
  });
  const matrixVerdict = resolveSignalMatrixVerdict({
    primaryState: primaryMatrixState,
    matrixStatesByTimeframe: resolvedTfMatrix,
    profileTimeframe: signalRecord.timeframe || "5m",
    timeframes,
    includePrimaryFallback: false,
  });
  const baseMatrixDisplay = matrixVerdictDisplay(matrixVerdict);
  // Mirror the backend MTF entry gate: if the configured MTF timeframes don't
  // reach requiredCount agreement with the signal direction (a disagreeing or
  // stale-opposing frame counts against it), the row is not tradeable, so the
  // matrix readout must show that instead of a weighted-bias "Ready".
  const mtfAlignmentResult = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe: resolvedTfMatrix,
    signalDirection: direction?.primitive,
    timeframes: mtfAlignmentConfig?.timeframes,
    requiredCount: mtfAlignmentConfig?.requiredCount,
    enabled: mtfAlignmentConfig?.enabled !== false,
  });
  const matrixDisplay =
    mtfAlignmentResult.applicable && !mtfAlignmentResult.aligned
      ? {
          ...baseMatrixDisplay,
          main: scoreTierLabel("avoid"),
          tone: matrixReadinessTone("avoid"),
          motionState: matrixMotionState("avoid"),
          detail: compactJoin([
            `MTF ${mtfAlignmentResult.matches}/${mtfAlignmentResult.required}`,
            mtfAlignmentResult.opposingTimeframes.length
              ? `${mtfAlignmentResult.opposingTimeframes.join("/")} opposes`
              : null,
          ]),
          title: compactJoin([
            baseMatrixDisplay.title,
            `MTF not aligned: needs ${mtfAlignmentResult.required} of ${mtfAlignmentResult.total} frames, ${mtfAlignmentResult.matches} agree`,
          ]),
        }
      : baseMatrixDisplay;
  const candidateBlocker = candidateBlockerLabel(candidate);
  const signalBlocker = signalActionBlockerLabel(signalRecord);
  const blocker =
    candidateBlocker !== MISSING_VALUE ? candidateBlocker : signalBlocker;
  const rawContract = formatContractDetail(effectiveSelectedContract);
  const selectionStage = resolveSelectionStageDisplay({
    candidate,
    blocker,
    hasSelectedContract: hasDisplayValue(rawContract.main) && !contractIsPreview,
    selectedContractId,
    hasQuote: false,
    contractIsPreview,
  });
  const contract = hasDisplayValue(rawContract.main)
    ? {
        ...rawContract,
        detail: contractIsPreview
          ? compactJoin(["Preview", rawContract.detail])
          : rawContract.detail,
      }
    : missingContractDisplay(candidate, blocker, selectionStage);
  const actionPlan = actionPlanDisplay(signalRecord, candidate);
  const rawQuote = formatQuoteSummary(effectiveQuote, effectiveLiquidity);
  const hasQuote = hasDisplayValue(rawQuote.main);
  const liveSelectionStage = resolveSelectionStageDisplay({
    candidate,
    blocker,
    hasSelectedContract: hasDisplayValue(rawContract.main) && !contractIsPreview,
    selectedContractId,
    hasQuote,
    contractIsPreview,
  });
  const quote = hasQuote
    ? rawQuote
    : missingQuoteDisplay({
        candidate,
        blocker,
        selectedContractId,
        selectionStage: liveSelectionStage,
      });
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
    : missingGreeksDisplay({
        candidate,
        blocker,
        selectedContractId,
        selectionStage: liveSelectionStage,
      });
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
  const signalAge = resolveSignalAge(signalRecord);
  const since = signalSinceDisplay(signalRecord, signalAge);
  const signalMove = resolveSignalMove(signalRecord, tickerSnapshot, candidate);
  // A stale Move during regular trading hours is a DATA DEFECT (a fresh quote is
  // expected), so flag it loudly; outside RTH (overnight/pre/after/closed/
  // weekend/holiday) no fresh quote is expected, so mute it calmly. Resolve the
  // market session lazily -- only when the Move is actually stale.
  const moveStale = signalMove.stale === true;
  const moveIsRthDefect =
    moveStale && resolveUsEquityMarketStatus().session?.key === "rth";
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
  const sparklinePoints = useMemo(
    () => extractSparklinePoints(sparklineData),
    [sparklineData],
  );
  const sparklinePointColors = useMemo(
    () =>
      buildSignalSparklinePointColors({
        points: sparklinePoints,
        row: {
          timeframe: signalRecord.timeframe,
          direction: direction.primitive,
          currentSignalAt: signalRecord.currentSignalAt || signalRecord.signalAt,
          status:
            signalRecord.fresh === true
              ? "active-fresh"
              : direction.primitive
                ? "active-stale"
                : signalRecord.status,
        },
        signalEvents,
        colorTimeframe: executionTimeframe,
      }),
    [
      signalEvents,
      direction.primitive,
      signalRecord.fresh,
      signalRecord.currentSignalAt,
      signalRecord.signalAt,
      signalRecord.status,
      signalRecord.timeframe,
      executionTimeframe,
      sparklinePoints,
    ],
  );
  const sparklineSignalTreatment = resolveStaSparklineSignalTreatment(
    signalRecord.direction,
    { hasTimeline: Array.isArray(sparklinePointColors) },
  );
  const sparklineSignalEventCount = Array.isArray(signalEvents)
    ? signalEvents.length
    : 0;
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
    signal: signalRecord,
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
  const handleOpenTrade = tradeCandidate
    ? () => {
        onRowAction?.({
          actionId: "openTrade",
          signal: signalRecord,
          candidate: tradeCandidate,
        });
      }
    : null;
  const visibleColumns = resolveSignalVisibleColumnObjects(columns);
  const hasMoveColumn = visibleColumns.some((column) => column.key === "move");
  const rawSpreadWidth = formatSpreadWidth(spreadGauge.widthPct);
  const spread =
    rawSpreadWidth !== MISSING_VALUE
      ? missingDisplay(rawSpreadWidth, MISSING_VALUE)
      : missingSpreadDisplay({
          candidate,
          blocker,
          hasQuote,
          selectedContractId,
          selectionStage: liveSelectionStage,
        });
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
  const signalAgeFlashValue = (() => {
    const parsed = Date.parse(signalRecord.signalAt ?? signalRecord.currentSignalAt ?? "");
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const ageFlashClassName = useValueFlash(signalAgeFlashValue, {
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
  const selectionEvaluating = liveSelectionStage?.motionState === "evaluating";
  const quoteEvaluating =
    !contractIsPreview &&
    (scanActive || selectionEvaluating) &&
    candidateContractSelectionPending &&
    Boolean(candidate) &&
    blocker === MISSING_VALUE &&
    !hasQuote;
  const contractEvaluating =
    (scanActive || selectionEvaluating) &&
    candidateContractSelectionPending &&
    Boolean(candidate) &&
    blocker === MISSING_VALUE &&
    !hasDisplayValue(rawContract.main);
  const spreadEvaluating =
    quoteEvaluating ||
    (!contractIsPreview &&
      (scanActive || selectionEvaluating) &&
      candidateContractSelectionPending &&
      hasQuote &&
      !Number.isFinite(Number(spreadGauge.widthPct)));
  const greeksEvaluating =
    !contractIsPreview &&
    (scanActive || selectionEvaluating) &&
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
        tfMatrix={resolvedTfMatrix}
        timeframes={timeframes}
        price={underlyingPrice}
        priceFlashClassName={priceFlashClassName}
        sparklineData={sparklineData}
        sparklinePoints={sparklinePoints}
        sparklinePointColors={sparklinePointColors}
        sparklineSignalEventCount={sparklineSignalEventCount}
        sparklineSignalTreatment={sparklineSignalTreatment}
        signalMove={signalMove}
        tradeButton={
          <SignalTradeButton
            symbol={signalRecord.symbol}
            onOpen={handleOpenTrade}
          />
        }
        showSignalMove={!hasMoveColumn}
      />
    ),
    since: (
      <DataCell
        value={since.main}
        detail={since.detail}
        tone={signalAgeTone}
        titleValue={compactJoin([
          since.title,
          signalRecord.signalAt,
        ])}
        className={ageFlashClassName}
      />
    ),
    move: (
      <DataCell
        value={signalMove.label}
        detail={moveStale ? "stale data" : signalMove.detail}
        tone={
          moveIsRthDefect
            ? CSS_COLOR.amber
            : moveStale
              ? CSS_COLOR.textDim
              : Number(signalMove.pct) > 0
                ? CSS_COLOR.green
                : Number(signalMove.pct) < 0
                  ? CSS_COLOR.red
                  : CSS_COLOR.textDim
        }
        detailTone={moveIsRthDefect ? CSS_COLOR.amber : undefined}
        icon={
          moveIsRthDefect ? (
            <AlertTriangle size={12} color={CSS_COLOR.amber} aria-hidden />
          ) : null
        }
        titleValue={compactJoin([
          moveIsRthDefect
            ? `Data defect: quote stale during market hours (move ${signalMove.label})`
            : moveStale
              ? `Stale data — move ${signalMove.label} not from a live quote`
              : signalMove.detail,
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
      <GreeksGridCell
        quote={effectiveQuote}
        fallback={greeks}
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
          <ScanLine
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
        selectionStage={liveSelectionStage}
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
  const compactLeadMetricItems = [
    { key: "since", label: "Age", cell: desktopCells.since },
    { key: "move", label: "Move", cell: desktopCells.move },
    { key: "score", label: "Score", cell: desktopCells.score },
  ].filter((item) => visibleColumnKeys.has(item.key));
  const compactDetailMetricItems = [
    { key: "action", label: "Plan", cell: desktopCells.action },
    { key: "contract", label: "Contract", cell: desktopCells.contract },
    { key: "quote", label: "Quote", cell: desktopCells.quote },
    { key: "spread", label: "Spread", cell: desktopCells.spread },
    {
      key: "decision",
      label: "Latest",
      cell: desktopCells.decision,
      testId: "algo-signal-compact-decision",
    },
    {
      key: "gate",
      label: "Gate",
      cell: desktopCells.gate,
      visibleWhen: gate.category !== "clear",
    },
    { key: "matrix", label: "Matrix", cell: desktopCells.matrix },
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
          data-algo-density="mobile-dense"
          style={{
            display: "grid",
            gap: 0,
            minWidth: 0,
            padding: 0,
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
            data-testid="algo-signal-compact-primary"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(118px, 1fr) 48px 52px 46px 32px",
              alignItems: "stretch",
              minWidth: 0,
              minHeight: dim(36),
            }}
          >
            <span
              role="cell"
              style={{
                minWidth: 0,
                padding: sp("4px 5px 3px"),
                borderRight: `1px solid ${CSS_COLOR.borderLight}`,
                overflow: "hidden",
              }}
            >
              {desktopCells.signal}
            </span>
            {compactLeadMetricItems.map((item) => (
              <CompactSignalMetric key={item.key} label={item.label} topBorder={false}>
                {item.cell}
              </CompactSignalMetric>
            ))}
            <span
              role="cell"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 0,
                padding: sp("3px 2px"),
              }}
            >
              {desktopCells.rowAction}
            </span>
          </div>

          {compactDetailMetricItems.length ? (
            <div
              data-testid="algo-signal-compact-metrics"
              data-algo-pocket-grid="dense"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 0,
                minWidth: 0,
              }}
            >
              {compactDetailMetricItems.map((item, index) => (
                <CompactSignalMetric
                  key={item.key}
                  label={item.label}
                  testId={item.testId}
                  wide={
                    item.key === "gate" ||
                    (compactDetailMetricItems.length % 4 === 1 &&
                      index === compactDetailMetricItems.length - 1)
                  }
                >
                  {item.cell}
                </CompactSignalMetric>
              ))}
            </div>
          ) : null}
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
