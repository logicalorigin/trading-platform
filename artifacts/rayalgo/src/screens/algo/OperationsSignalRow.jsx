import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  HelpCircle,
  MinusCircle,
  Radar,
  Send,
} from "lucide-react";
import {
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
  TableExpandableRow,
} from "../../components/platform/primitives.jsx";
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
  signalActionLabel,
  signalFreshnessLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
} from "./algoHelpers";

const COMPACT_COLUMNS = [
  { key: "signal", label: "Signal", track: "minmax(0, 1fr)" },
  { key: "since", label: "Since", track: "minmax(0, 0.42fr)" },
  { key: "action", label: "Action", track: "minmax(0, 1fr)" },
  { key: "execution", label: "Execution", track: "minmax(0, 0.92fr)" },
  { key: "decision", label: "Decision", track: "minmax(0, 1.08fr)" },
  { key: "rowAction", label: "Act", width: 48 },
];

const COMPACT_COLUMN_SORTS = {
  signal: { sortKey: "symbol", title: "Sort by symbol" },
  since: { sortKey: "newest", title: "Sort by latest signal" },
  decision: { sortKey: "score", title: "Sort by decision score" },
};

const SIGNAL_ICON_SIZE = 12;

const columnTrack = (column) => {
  if (column.track) return column.track;
  if (column.width) return `${column.width}px`;
  if (column.minWidth) return `minmax(${column.minWidth}px, 1fr)`;
  return "minmax(0, 1fr)";
};

const COMPACT_COLUMN_TEMPLATE = COMPACT_COLUMNS.map(columnTrack).join(" ");

const directionMeta = (direction) => {
  const value = String(direction || "").toLowerCase();
  if (value === "buy" || value === "long" || value === "bullish") {
    return {
      label: "BUY",
      trend: "BULLISH",
      tone: T.green,
      primitive: "buy",
    };
  }
  if (value === "sell" || value === "short" || value === "bearish") {
    return {
      label: "SELL",
      trend: "BEARISH",
      tone: T.red,
      primitive: "sell",
    };
  }
  return {
    label: MISSING_VALUE,
    trend: MISSING_VALUE,
    tone: T.textDim,
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
  if (!candidate) return { Icon: MinusCircle, tone: T.textDim };
  const reason = String(candidate.reason || "");
  if (
    reason === "missing_bid_ask" ||
    reason === "spread_too_wide" ||
    reason === "bid_below_minimum"
  ) {
    return { Icon: AlertTriangle, tone: T.amber };
  }
  if (
    asRecord(candidate.quote).bid != null ||
    asRecord(candidate.liquidity).bid != null
  ) {
    return { Icon: CheckCircle2, tone: T.green };
  }
  return { Icon: MinusCircle, tone: T.textDim };
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

const missingDisplay = (main, detail = MISSING_VALUE) => ({ main, detail });

const missingContractDisplay = (candidate, blocker) => {
  if (!candidate) return missingDisplay("Monitor only", "not in action queue");
  if (blocker !== MISSING_VALUE) return missingDisplay("Not selected", blocker);
  const actionStatus = candidate?.actionStatus || candidate?.status;
  if (actionStatus) {
    return missingDisplay("Selection pending", signalOptionsActionLabel(actionStatus));
  }
  return missingDisplay("Selection pending", "option chain scan");
};

const missingQuoteDisplay = ({ candidate, blocker, selectedContractId }) => {
  if (selectedContractId) return missingDisplay("Quote pending", "waiting for bid/ask");
  if (!candidate) return missingDisplay("Not requested", "monitor signal only");
  if (blocker !== MISSING_VALUE) {
    return missingDisplay("Not requested", "blocked before quote");
  }
  return missingDisplay("Waiting on contract", "selection pending");
};

const missingGreeksDisplay = ({
  candidate,
  blocker,
  hasQuote,
  selectedContractId,
}) => {
  if (hasQuote) return missingDisplay("Greeks unavailable", "quote lacks greeks");
  if (selectedContractId) return missingDisplay("Quote pending", "greeks wait for quote");
  if (!candidate) return missingDisplay("Not requested", "monitor signal only");
  if (blocker !== MISSING_VALUE) {
    return missingDisplay("Not requested", "blocked before quote");
  }
  return missingDisplay("Waiting on quote", "selection pending");
};

const statusPillMeta = (signal, candidate, blocker) => {
  if (blocker !== MISSING_VALUE) {
    return { label: blocker, tone: T.red, Icon: Ban };
  }
  const actionStatus = candidate?.actionStatus || candidate?.status;
  if (actionStatus) {
    const label = signalOptionsActionLabel(actionStatus);
    const normalized = String(actionStatus).toLowerCase();
    if (normalized.includes("block") || normalized.includes("mismatch")) {
      return { label, tone: T.red, Icon: Ban };
    }
    if (
      normalized.includes("ready") ||
      normalized.includes("filled") ||
      normalized.includes("available")
    ) {
      return { label, tone: T.green, Icon: CheckCircle2 };
    }
    if (normalized.includes("stale")) {
      return { label, tone: T.amber, Icon: Clock };
    }
    return {
      label,
      tone: signalOptionsActionColor(actionStatus) || T.textDim,
      Icon: Radar,
    };
  }
  if (signal?.status === "unavailable") {
    return { label: "Unavailable", tone: T.textDim, Icon: MinusCircle };
  }
  if (signal?.fresh === false) {
    return { label: "Stale", tone: T.amber, Icon: Clock };
  }
  return { label: "Awaiting scan", tone: T.cyan, Icon: Radar };
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
}) => {
  const Icon = iconOverride || meta.Icon;
  const tone = toneOverride || meta.tone;
  if (compact) {
    return (
      <span
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
          border: `1px solid ${tone}44`,
          background: `${tone}18`,
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
      title={meta.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        maxWidth: "100%",
        minWidth: 0,
        padding: sp("1px 6px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${tone}33`,
        background: `${tone}1A`,
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
  clear: { tone: T.green, label: "Gate clear" },
  liquidity: { tone: T.amber, label: "Liquidity" },
  risk: { tone: T.red, label: "Risk" },
  gateway: { tone: T.red, label: "Gateway" },
  contract_resolution: { tone: T.amber, label: "Contract" },
  signal_policy: { tone: T.amber, label: "Policy" },
  marking: { tone: T.amber, label: "Marking" },
  other: { tone: T.textDim, label: "Other" },
};

const resolveDecisionDetailMeta = ({ candidate, gate, blocker, statusMeta }) => {
  if (!candidate) {
    return {
      tone: T.cyan,
      shortLabel: "Monitor only",
      fullLabel: "No action candidate resolved",
    };
  }
  if (blocker !== MISSING_VALUE) {
    const base = DECISION_DETAIL_META[gate.category] || DECISION_DETAIL_META.other;
    return {
      tone: gate.tone || base.tone,
      shortLabel: gate.detail || blocker,
      fullLabel: `${base.label}: ${gate.detail || blocker}`,
    };
  }

  const actionStatus = String(candidate?.actionStatus || candidate?.status || "").trim();
  if (actionStatus && actionStatus !== "candidate") {
    return {
      tone: statusMeta.tone || T.textDim,
      shortLabel: statusMeta.label,
      fullLabel: statusMeta.label,
    };
  }

  if (String(statusMeta?.label || "").toLowerCase() === "awaiting scan") {
    return {
      tone: T.cyan,
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

const signalFallbackState = (signal, directionPrimitive) => {
  if (!signal?.timeframe) return null;
  return {
    timeframe: String(signal.timeframe),
    currentSignalDirection: directionPrimitive,
    currentSignalAt: signal.signalAt,
    currentSignalPrice: signal.signalPrice,
    barsSinceSignal: signal.barsSinceSignal,
    fresh: signal.fresh,
    status: signal.status,
    latestBarAt: signal.latestBarAt,
  };
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
    main: detail.length ? detail.join(" · ") : action,
    detail: compactJoin([action, formatContractDetail(candidate.selectedContract).main]),
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
  tone = T.textSec,
  detailTone = T.textMuted,
  icon = null,
  detailExtra = null,
  titleValue,
}) => (
  <span
    title={[
      titleValue ?? (typeof value === "string" ? value : null),
      detail,
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
      {detailExtra ? (
        <span style={{ flex: "0 0 auto", display: "inline-flex" }}>
          {detailExtra}
        </span>
      ) : null}
    </span>
  </span>
);

const SignalHeroCell = ({
  signalRecord,
  candidate,
  direction,
  tfMatrix,
  fallbackState,
  freshnessRatio,
  price,
  priceFlashClassName,
  sparklineData,
  signalMove,
}) => (
  <span
    data-testid="algo-signal-hero-cell"
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
          tone={T.textSec}
          className={signalRecord.fresh ? "ra-signal-glyph-fresh" : undefined}
        />
        <StrategyTag candidate={candidate} signal={signalRecord} />
        <span
          style={{
            color: T.text,
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
          color: T.textDim,
          fontSize: textSize("caption"),
          whiteSpace: "nowrap",
          lineHeight: 1.12,
        }}
      >
        <SignalDots
          testId="algo-signal-dots"
          statesByTimeframe={tfMatrix}
          fallbackState={fallbackState}
          style={{ minWidth: dim(36), gap: sp(4) }}
        />
        <span
          className={priceFlashClassName}
          style={{
            color: T.textSec,
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
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {[
            signalMove?.detail && signalMove.detail !== MISSING_VALUE
              ? signalMove.detail
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || MISSING_VALUE}
        </span>
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
  pushDistinctLabel(parts, sync?.label);
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
      style={{
        display: "grid",
        gap: sp(2),
        minWidth: 0,
        overflow: "hidden",
        lineHeight: 1.12,
      }}
    >
      <span
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
          border: `1px solid ${(verdict?.tone || statusMeta.tone)}40`,
          background: `${verdict?.tone || statusMeta.tone}1C`,
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
          color: decisionDetailMeta?.tone || T.textMuted,
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

const resolveRowAction = ({ candidate, blocker, signalRecord, verdict }) => {
  if (signalRecord?.status === "unavailable" || !candidate) return null;
  if (blocker !== MISSING_VALUE) {
    return {
      id: "why",
      label: "Why?",
      title: blocker,
      tone: T.amber,
      Icon: HelpCircle,
    };
  }
  if (verdict?.bucket !== "try") return null;
  return {
    id: "submit",
    label: "Submit",
    title: "Open pre-filled trade ticket",
    tone: T.green,
    Icon: Send,
  };
};

const RowActionButton = ({ action, onAction }) => {
  if (!action) {
    return (
      <span
        aria-hidden="true"
        style={{
          color: T.textDim,
          display: "inline-flex",
          justifyContent: "center",
          width: "100%",
        }}
      >
        -
      </span>
    );
  }
  const Icon = action.Icon;
  return (
    <button
      type="button"
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
        border: `1px solid ${action.tone}44`,
        background: `${action.tone}18`,
        color: action.tone,
        cursor: "pointer",
      }}
    >
      <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
};

export const OperationsSignalTableHeader = ({
  algoIsPhone,
  sortKey = "newest",
  onSortChange,
}) => (
  <div
    style={{
      display: algoIsPhone ? "none" : "grid",
      gridTemplateColumns: COMPACT_COLUMN_TEMPLATE,
      gap: sp(2),
      alignItems: "center",
      padding: sp("2px 6px"),
      borderBottom: `1px solid ${T.border}`,
      background: T.bg1,
      color: T.textMuted,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      letterSpacing: 0,
      textTransform: "uppercase",
      position: "sticky",
      top: 0,
      zIndex: 1,
    }}
  >
    {COMPACT_COLUMNS.map((column) => {
      const sort = COMPACT_COLUMN_SORTS[column.key];
      const active = sort?.sortKey === sortKey;
      const content = (
        <>
          <span>{column.label}</span>
          {sort ? (
            <ChevronDown
              size={11}
              strokeWidth={1.8}
              aria-hidden="true"
              style={{
                color: active ? T.accent : T.textMuted,
                transform: active && sort.sortKey === "symbol" ? "rotate(180deg)" : "none",
              }}
            />
          ) : null}
          {column.key === "execution" ? (
            <span style={{ color: T.textMuted, fontSize: textSize("caption") }}>
              Spread
            </span>
          ) : null}
        </>
      );

      return (
        <span
          key={column.key}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {sort ? (
            <button
              type="button"
              onClick={() => onSortChange?.(sort.sortKey)}
              aria-pressed={active}
              title={sort.title}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(4),
                minWidth: 0,
                padding: 0,
                border: 0,
                background: "transparent",
                color: active ? T.text : T.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                letterSpacing: 0,
                textTransform: "uppercase",
                cursor: "pointer",
                textDecoration: active ? `underline ${T.accent}66` : "none",
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

export const OperationsSignalRow = ({
  signal,
  candidate,
  expanded,
  onToggle,
  expandedContent,
  algoIsPhone,
  tfMatrix = null,
  tickerSnapshot = null,
  scoreBreakdown: providedScoreBreakdown = null,
  onRowAction,
}) => {
  const signalRecord = asRecord(signal);
  const liveQuote = getStoredOptionQuoteSnapshot(
    optionProviderContractId(candidate?.selectedContract),
  );
  const effectiveQuote = mergeOptionQuoteSnapshot(candidate?.quote, liveQuote);
  const signalState = signalDisplay(signalRecord);
  const direction = signalState.direction;
  const blocker = candidateBlockerLabel(candidate);
  const selectedContractId = optionProviderContractId(candidate?.selectedContract);
  const rawContract = formatContractDetail(candidate?.selectedContract);
  const contract = hasDisplayValue(rawContract.main)
    ? rawContract
    : missingContractDisplay(candidate, blocker);
  const actionPlan = actionPlanDisplay(signalRecord, candidate);
  const rawQuote = formatQuoteSummary(effectiveQuote, candidate?.liquidity);
  const hasQuote = hasDisplayValue(rawQuote.main);
  const quote = hasQuote
    ? rawQuote
    : missingQuoteDisplay({ candidate, blocker, selectedContractId });
  const quoteState = liquidityMeta(candidate);
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
      liquidity: candidate?.liquidity,
    });
  const actionabilityScore =
    scoreBreakdown?.score == null ? null : Number(scoreBreakdown.score);
  const actionabilitySignalRecord = {
    ...signalRecord,
    score: Number.isFinite(actionabilityScore) ? actionabilityScore : null,
  };
  const gate = resolveCandidateGateDisplay(candidate);
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
  const signalMove = resolveSignalMove(signalRecord, tickerSnapshot);
  const freshnessRatio = resolveFreshnessRatio(signalRecord);
  const fallbackState = signalFallbackState(signalRecord, direction.primitive);
  const freshAndHot = Boolean(
    signalRecord.fresh &&
      Number.isFinite(actionabilityScore) &&
      actionabilityScore >= SCORE_FRESH_ROW_GLOW,
  );
  const sparklineData = resolveSparklineData(tickerSnapshot, signalRecord);
  const spreadGauge = quoteGaugeInput(effectiveQuote, candidate?.liquidity);
  const verdict = resolveSignalVerdict({
    signal: actionabilitySignalRecord,
    signalRecord: actionabilitySignalRecord,
    blocker,
    statusMeta,
  });
  const rowAction = resolveRowAction({ candidate, blocker, signalRecord, verdict });
  const quoteAge = formatQuoteAge(effectiveQuote?.ageMs ?? effectiveQuote?.cacheAgeMs);
  const actionValue = actionPlan.main;
  const actionDetail = compactJoin([actionPlan.detail, contract.detail]);
  const executionValue = compactQuoteText(quote.main);
  const executionDetail = compactJoin([
    compactQuoteText(quote.detail),
    quoteAge,
    compactGreeksText(greeks.main !== MISSING_VALUE ? greeks.main : greeks.detail),
  ]);
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
    "ra-signal-row-focus",
    freshAndHot && !algoIsPhone ? "ra-signal-row-glow" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const handleRowAction = (actionId) => {
    onRowAction?.({ actionId, signal: signalRecord, candidate });
  };
  const mobileVerdictMeta = {
    label: verdict?.label || statusMeta.label,
    tone: verdict?.tone || statusMeta.tone,
    Icon: verdict?.Icon || statusMeta.Icon,
  };
  const showMobileSignalDots =
    direction.primitive &&
    Object.values(asRecord(tfMatrix)).some((state) => {
      const timeframeDirection = asRecord(state).currentSignalDirection;
      return timeframeDirection && timeframeDirection !== direction.primitive;
    });
  const mobileDecisionDetail = compactJoin([
    since.main,
    blocker !== MISSING_VALUE
      ? blocker
      : gate.category === "clear"
        ? "Gate clear"
        : gate.detail || gate.label,
  ]);
  return (
    <TableExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      rowHeight={algoIsPhone ? 72 : 56}
      expandedHeight={320}
      selectionAccent={direction.tone}
      borderTone={T.border}
      dataTestId={`algo-signal-row-${signalRecord.symbol}`}
      rowClassName={rowClassName}
      rowStyle={{ "--ra-motion-accent": direction.tone }}
      row={
        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsPhone
              ? "minmax(0, 1fr) auto"
              : COMPACT_COLUMN_TEMPLATE,
            gap: algoIsPhone ? sp(5) : sp(2),
            alignItems: "center",
            paddingLeft: algoIsPhone ? sp(8) : sp(8),
            paddingRight: sp(5),
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            fontFamily: T.sans,
            fontSize: fs(11),
            color: T.text,
            lineHeight: 1.12,
            boxShadow: `inset ${algoIsPhone ? 2 : 3}px 0 0 ${direction.tone}`,
            background: freshAndHot
              ? `linear-gradient(90deg, ${verdict.tone}${algoIsPhone ? "0D" : "12"} 0%, transparent 55%)`
              : "transparent",
          }}
        >
          {algoIsPhone ? (
            <>
              <span
                style={{
                  display: "grid",
                  gap: sp(2),
                  minWidth: 0,
                  height: "100%",
                  alignContent: "center",
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
                    tone={T.textSec}
                    size={16}
                    className={signalRecord.fresh ? "ra-signal-glyph-fresh" : undefined}
                  />
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: FONT_WEIGHTS.medium,
                    }}
                  >
                    {signalRecord.symbol || MISSING_VALUE}
                  </span>
                  <span style={{ color: direction.tone, flex: "0 0 auto" }}>
                    {direction.label}
                  </span>
                  {showMobileSignalDots ? (
                    <SignalDots
                      testId="algo-signal-dots"
                      statesByTimeframe={tfMatrix}
                      fallbackState={fallbackState}
                      style={{ minWidth: dim(36), gap: sp(4) }}
                    />
                  ) : null}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(4),
                    minWidth: 0,
                    color: T.text,
                    fontSize: fs(11),
                    fontWeight: FONT_WEIGHTS.medium,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    lineHeight: 1.12,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {actionValue}
                  </span>
                  <span
                    className={priceFlashClassName}
                    style={{
                      color: T.textMuted,
                      fontVariantNumeric: "tabular-nums",
                      flex: "0 0 auto",
                    }}
                  >
                    {underlyingPrice}
                  </span>
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(5),
                    minWidth: 0,
                    color: T.textDim,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.regular,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    lineHeight: 1.12,
                  }}
                >
                  <StrategyTag candidate={candidate} signal={signalRecord} />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {mobileDecisionDetail}
                  </span>
                </span>
              </span>
              <span
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  minWidth: dim(20),
                  alignSelf: "center",
                }}
              >
                <StatusPill
                  meta={mobileVerdictMeta}
                  compact
                />
              </span>
            </>
          ) : (
            <>
              <SignalHeroCell
                signalRecord={signalRecord}
                candidate={candidate}
                direction={direction}
                tfMatrix={tfMatrix}
                fallbackState={fallbackState}
                freshnessRatio={freshnessRatio}
                price={underlyingPrice}
                priceFlashClassName={priceFlashClassName}
                sparklineData={sparklineData}
                signalMove={signalMove}
              />
              <DataCell
                value={since.main}
                detail={since.detail}
                tone={signalRecord.fresh ? T.green : T.amber}
                titleValue={compactJoin([
                  since.main !== MISSING_VALUE ? `${since.main} since signal` : null,
                  since.detail,
                  signalRecord.signalAt,
                ])}
              />
              <DataCell
                value={actionValue}
                detail={actionDetail}
                tone={
                  signalState.freshness === "FRESH"
                    ? T.green
                    : signalState.freshness === "STALE"
                      ? T.amber
                      : T.textDim
                  }
                titleValue={compactJoin([
                  actionPlan.main,
                  actionPlan.detail,
                  contract.main,
                  contract.detail,
                ])}
              />
              <DataCell
                value={executionValue}
                detail={executionDetail}
                tone={quoteState.tone}
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
                titleValue={executionTitle}
                icon={
                  <QuoteIcon
                    size={SIGNAL_ICON_SIZE}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    style={{ color: quoteState.tone }}
                  />
                }
              />
              <DecisionCell
                actionabilitySignalRecord={actionabilitySignalRecord}
                blocker={blocker}
                decisionDetailMeta={decisionDetailMeta}
                statusMeta={statusMeta}
                sync={sync}
                latest={latest}
                latestTime={latestTime}
                verdict={verdict}
              />
              <span
                style={{
                  display: "inline-flex",
                  justifyContent: "center",
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <RowActionButton action={rowAction} onAction={handleRowAction} />
              </span>
            </>
          )}
        </div>
      }
      expandedContent={expandedContent}
    />
  );
};

export default OperationsSignalRow;
