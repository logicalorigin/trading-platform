import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Flame,
  MinusCircle,
  Radar,
  Snowflake,
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
import { formatEnumLabel, formatRelativeTimeShort } from "../../lib/formatters";
import {
  MicroSparkline,
  TableExpandableRow,
} from "../../components/platform/primitives.jsx";
import { getStoredOptionQuoteSnapshot } from "../../features/platform/live-streams";
import { useValueFlash } from "../../lib/motion.jsx";
import {
  BigDirectionGlyph,
  ConfluenceChip,
  FRESHNESS_BAR_DENOM,
  SCORE_COLD,
  SCORE_FRESH_ROW_GLOW,
  SCORE_HOT,
  SCORE_TRY,
  SIGNAL_TIMEFRAMES,
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
  signalActionLabel,
  signalFreshnessLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
} from "./algoHelpers";

const COLUMNS = [
  { key: "signalHero", label: "Signal", width: 250 },
  { key: "contract", label: "Contract", width: 190 },
  { key: "action", label: "Action plan", width: 178 },
  { key: "quote", label: "Option quote", width: 190 },
  { key: "greeks", label: "Greeks / OI", width: 146 },
  { key: "state", label: "State", width: null },
];

const SIGNAL_ICON_SIZE = 12;

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

const scoreTone = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return T.textDim;
  if (num >= SCORE_TRY) return T.green;
  if (num >= 5) return T.amber;
  return T.red;
};

const ScorePill = ({ score }) => {
  const label = formatScore(score);
  const tone = scoreTone(score);
  const numeric = Number(score);
  const ScoreIcon =
    Number.isFinite(numeric) && numeric >= SCORE_HOT
      ? Flame
      : Number.isFinite(numeric) && numeric < SCORE_COLD
        ? Snowflake
        : null;
  return (
    <span
      title={`Score ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(2),
        minWidth: dim(34),
        height: dim(16),
        padding: sp("1px 5px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${tone}44`,
        background: `${tone}1A`,
        color: tone,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
      }}
    >
      {ScoreIcon ? (
        <ScoreIcon size={10} strokeWidth={2} aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
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
          width: dim(20),
          height: dim(20),
          flex: "0 0 auto",
          borderRadius: dim(RADII.pill),
          border: `1px solid ${tone}44`,
          background: `${tone}18`,
          color: tone,
        }}
      >
        {Icon ? (
          <Icon size={12} strokeWidth={1.9} aria-hidden="true" />
        ) : null}
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

const actionPlanDisplay = (signal, candidate) => {
  const action = signalActionLabel(signal, candidate?.action);
  if (!candidate) {
    return { main: action, detail: MISSING_VALUE };
  }
  const limit = formatMoney(asRecord(candidate.orderPlan).entryLimitPrice, 2);
  const quantity = Number(asRecord(candidate.orderPlan).quantity);
  const premium = formatMoney(asRecord(candidate.orderPlan).premiumAtRisk, 0);
  const detail = [
    Number.isFinite(quantity) && quantity > 0 ? `${quantity} ct` : null,
    limit !== MISSING_VALUE ? `limit ${limit}` : null,
    premium !== MISSING_VALUE ? `risk ${premium}` : null,
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
      gap: 1,
      minWidth: 0,
      color: tone,
      overflow: "hidden",
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
        gap: sp(4),
        minWidth: 0,
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
  agreeCount,
  freshnessRatio,
  price,
  priceFlashClassName,
  sparklineData,
  bars,
  blocker,
  statusMeta,
}) => (
  <span
    data-testid="algo-signal-hero-cell"
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: sp(4),
      alignItems: "center",
      minWidth: 0,
      overflow: "hidden",
    }}
  >
    <span
      style={{
        display: "grid",
        gap: 2,
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
          tone={direction.tone}
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
        <ScorePill score={signalRecord.score} />
        <ConfluenceChip
          agreeCount={agreeCount}
          total={SIGNAL_TIMEFRAMES.length}
          direction={direction.primitive}
        />
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
          {[signalRecord.timeframe, bars !== MISSING_VALUE ? `${bars} bars` : null]
            .filter(Boolean)
            .join(" · ") || MISSING_VALUE}
        </span>
      </span>
    </span>
    <VerdictGlyph
      signal={signalRecord}
      signalRecord={signalRecord}
      blocker={blocker}
      statusMeta={statusMeta}
    />
  </span>
);

export const OperationsSignalTableHeader = ({ algoIsPhone }) => (
  <div
    style={{
      display: algoIsPhone ? "none" : "grid",
      gridTemplateColumns: COLUMNS.map((column) =>
        column.width ? `${column.width}px` : "minmax(0, 1fr)",
      ).join(" "),
      gap: sp(3),
      alignItems: "center",
      padding: sp("3px 6px"),
      borderBottom: `1px solid ${T.border}`,
      background: T.bg1,
      color: T.textMuted,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      position: "sticky",
      top: 0,
      zIndex: 1,
    }}
  >
    {COLUMNS.map((column) => (
      <span
        key={column.key}
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: sp(4),
          minWidth: 0,
        }}
      >
        <span>{column.label}</span>
        {column.key === "quote" ? (
          <span style={{ color: T.textMuted, fontSize: textSize("caption") }}>
            Spread
          </span>
        ) : null}
      </span>
    ))}
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
  const hasContract = hasDisplayValue(rawContract.main);
  const contract = hasContract ? rawContract : missingContractDisplay(candidate, blocker);
  const actionPlan = actionPlanDisplay(signalRecord, candidate);
  const rawQuote = formatQuoteSummary(effectiveQuote, candidate?.liquidity);
  const hasQuote = hasDisplayValue(rawQuote.main);
  const quote = hasQuote
    ? rawQuote
    : missingQuoteDisplay({ candidate, blocker, selectedContractId });
  const quoteState = liquidityMeta(candidate);
  const QuoteIcon = quoteState.Icon;
  const rawGreeks = formatQuoteGreeksSummary(effectiveQuote);
  const hasGreeks = hasDisplayValue(rawGreeks.main);
  const greeks = hasGreeks
    ? rawGreeks
    : missingGreeksDisplay({ candidate, blocker, hasQuote, selectedContractId });
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
  const freshnessRatio = resolveFreshnessRatio(signalRecord);
  const fallbackState = signalFallbackState(signalRecord, direction.primitive);
  const agreeCount = direction.primitive
    ? SIGNAL_TIMEFRAMES.filter(
        (timeframe) => tfMatrix?.[timeframe]?.currentSignalDirection === direction.primitive,
      ).length
    : 0;
  const scoreNumber = Number(signalRecord.score);
  const freshAndHot = Boolean(
    signalRecord.fresh &&
      Number.isFinite(scoreNumber) &&
      scoreNumber >= SCORE_FRESH_ROW_GLOW,
  );
  const sparklineData = resolveSparklineData(tickerSnapshot, signalRecord);
  const spreadGauge = quoteGaugeInput(effectiveQuote, candidate?.liquidity);
  const verdict = resolveSignalVerdict({
    signal: signalRecord,
    signalRecord,
    blocker,
    statusMeta,
  });
  const rowClassName = [
    "ra-signal-row-focus",
    freshAndHot && !algoIsPhone ? "ra-signal-row-glow" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TableExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      rowHeight={58}
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
              : COLUMNS.map((column) =>
                  column.width ? `${column.width}px` : "minmax(0, 1fr)",
                ).join(" "),
            gap: algoIsPhone ? sp(6) : sp(3),
            alignItems: "center",
            paddingLeft: algoIsPhone ? sp(8) : sp(10),
            paddingRight: sp(6),
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            fontFamily: T.sans,
            fontSize: fs(11),
            color: T.text,
            boxShadow: `inset ${algoIsPhone ? 2 : 3}px 0 0 ${direction.tone}`,
            background: freshAndHot
              ? `linear-gradient(90deg, ${direction.tone}${algoIsPhone ? "0D" : "12"} 0%, transparent 55%)`
              : "transparent",
          }}
        >
          {algoIsPhone ? (
            <>
              <span
                style={{
                  display: "grid",
                  gap: 1,
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
                    tone={direction.tone}
                    size={16}
                    className={signalRecord.fresh ? "ra-signal-glyph-fresh" : undefined}
                  />
                  <StrategyTag candidate={candidate} signal={signalRecord} />
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
                  <span style={{ flex: "0 0 auto" }}>
                    <ScorePill score={signalRecord.score} />
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
                      flex: "0 0 auto",
                    }}
                  >
                    {underlyingPrice}
                  </span>
                  {sparklineData.length >= 2 ? (
                    <span
                      data-testid="algo-signal-mobile-sparkline"
                      style={{
                        width: dim(32),
                        height: dim(10),
                        minWidth: dim(32),
                        overflow: "hidden",
                        flex: "0 0 auto",
                      }}
                    >
                      <MicroSparkline
                        data={sparklineData}
                        positive={direction.primitive === "buy"}
                        width={32}
                        height={10}
                        style={{ width: "100%", height: "100%" }}
                      />
                    </span>
                  ) : null}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {[signalRecord.timeframe, bars !== MISSING_VALUE ? `${bars} bars` : null]
                      .filter(Boolean)
                      .join(" · ") || MISSING_VALUE}
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
                  meta={statusMeta}
                  iconOverride={verdict.Icon}
                  toneOverride={verdict.tone}
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
                agreeCount={agreeCount}
                freshnessRatio={freshnessRatio}
                price={underlyingPrice}
                priceFlashClassName={priceFlashClassName}
                sparklineData={sparklineData}
                bars={bars}
                blocker={blocker}
                statusMeta={statusMeta}
              />
              <DataCell
                value={contract.main}
                detail={contract.detail}
                tone={hasContract ? T.textSec : T.textDim}
              />
              <DataCell
                value={actionPlan.main}
                detail={actionPlan.detail}
                tone={
                  signalState.freshness === "FRESH"
                    ? T.green
                    : signalState.freshness === "STALE"
                      ? T.amber
                      : T.textDim
                }
              />
              <DataCell
                value={quote.main}
                detail={quote.detail}
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
                icon={
                  <QuoteIcon
                    size={SIGNAL_ICON_SIZE}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    style={{ color: quoteState.tone }}
                  />
                }
              />
              <DataCell
                value={greeks.main}
                detail={greeks.detail}
                tone={hasGreeks ? T.textSec : T.textDim}
              />
              <DataCell
                value={<StatusPill meta={statusMeta} />}
                detail={
                  latest !== MISSING_VALUE
                    ? `${latest}${latestTime !== MISSING_VALUE ? ` · ${latestTime}` : ""}`
                    : candidate?.syncStatus
                      ? formatEnumLabel(candidate.syncStatus)
                      : latestTime
                }
                tone={statusMeta.tone}
                titleValue={statusMeta.label}
              />
            </>
          )}
        </div>
      }
      expandedContent={expandedContent}
    />
  );
};

export default OperationsSignalRow;
