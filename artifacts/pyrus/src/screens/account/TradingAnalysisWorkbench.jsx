import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Filter, Search, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { useNumberTick } from "../../lib/numberTick";
import { useValueFlash } from "../../lib/motion.jsx";
import { normalizeLegacyAlgoBrandText } from "../algo/algoBranding.js";
import { normalizeAccountPositionTypeFilter } from "../../features/account/accountPositionTypes";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  PYRUS_STORAGE_KEY,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAppDate, formatAppDateTime } from "../../lib/timeZone";
import { ACCOUNT_RANGES } from "./accountRanges";
import {
  Panel,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountPrice,
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "./accountUtils";
import {
  buildAccountTradingAnalysisModel,
  getAccountTradeId,
  resolveAccountTradeContractDetails,
} from "./accountTradingAnalysis";
import {
  buildSymbolSparklineMap,
  buildTradingAnalysisKpis,
  buildTradingAnalysisScopeLabel,
  describeActiveAnalysisFilters,
  filterAccountAnalysisTrades,
  normalizeTradingAnalysisFilters,
  tradeHasOptionFields,
} from "./tradingAnalysisModel";
import {
  DataUnavailableState,
  Icon,
  MicroSparkline,
  RichTooltipContent,
  SegmentedControl,
  Skeleton,
  TableExpandableRow,
  TextField,
} from "../../components/platform/primitives.jsx";
import { ContainerLoadingStatus } from "../../components/platform/ContainerLoadingStatus.jsx";
import {
  SortableColumnHeaderCell,
  TableHeaderDndContext,
} from "../../components/platform/InteractiveColumnHeader.jsx";
import {
  normalizeColumnOrder,
  orderColumnsById,
  reorderColumnOrder,
} from "../../components/platform/tableColumnInteractions.js";
import { Button } from "../../components/ui/Button.jsx";
import {
  PaginationFooter,
  paginateRows,
} from "../../components/platform/TablePagination.jsx";
import {
  LifecycleTimeline,
  TradePriceChart,
} from "./tradingAnalysis/TradeForensics";
import { _initialState, persistState } from "../../lib/workspaceState";

const VIEW_OPTIONS = [
  { value: "patterns", label: "Patterns" },
  { value: "trades", label: "Trades" },
];

const ASSET_OPTIONS = [
  { value: "all", label: "All" },
  { value: "equity", label: "Stocks + ETFs" },
  { value: "stock", label: "Stocks" },
  { value: "etf", label: "ETFs" },
  { value: "option", label: "Options" },
];

const HOLD_OPTIONS = [
  { value: "intraday-fast", label: "<=30m" },
  { value: "intraday", label: "30m-4h" },
  { value: "swing", label: "4h-1d" },
  { value: "multi-day", label: "Multi-day" },
];

const FEE_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Mid" },
  { value: "high", label: "High" },
];

const PNL_OPTIONS = [
  { value: "all", label: "All" },
  { value: "winners", label: "Winners" },
  { value: "losers", label: "Losers" },
];

const SIDE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
];

const TABLE_COLUMNS = [
  { key: "symbol", label: "Symbol", track: "minmax(130px, 1.2fr)" },
  { key: "side", label: "Side", track: "minmax(56px, 0.55fr)" },
  { key: "source", label: "Source", track: "minmax(118px, 1fr)" },
  { key: "entryExit", label: "Entry -> Exit", track: "minmax(150px, 1.15fr)" },
  { key: "quantity", label: "Qty", track: "minmax(58px, 0.5fr)" },
  { key: "hold", label: "Hold", track: "minmax(60px, 0.55fr)" },
  { key: "commissions", label: "Comms", track: "minmax(78px, 0.7fr)" },
  {
    key: "realizedPnl",
    label: "Realized P&L",
    track: "minmax(90px, 0.8fr)",
  },
  { key: "percent", label: "%", track: "minmax(58px, 0.45fr)" },
];
const TABLE_COLUMN_IDS = TABLE_COLUMNS.map((column) => column.key);
const TRADE_TABLE_ACTION_TRACK = "26px";

const tradeTableGridTemplate = (columns) =>
  [...columns.map((column) => column.track), TRADE_TABLE_ACTION_TRACK].join(
    " ",
  );

const PAGE_SIZE = 25;
const SYMBOL_PAGE_SIZE = 8;

const finiteNumber = (value) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const arrayValue = (value) => (Array.isArray(value) ? value : []);

const queryInitialLoading = (query) =>
  Boolean(
    !query?.data &&
      (query?.isLoading ||
        query?.isFetching ||
        (query?.isPending && query?.fetchStatus !== "idle")),
  );

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

const tradeContractLabel = (trade) => {
  const contract = resolveAccountTradeContractDetails(trade);
  if (
    !contract.right &&
    contract.strike == null &&
    !contract.expirationDate
  ) {
    return "—";
  }
  return [
    contract.right ? contract.right.toUpperCase() : "OPTION",
    contract.strike ?? null,
    contract.expirationDate,
    contract.multiplier == null ? null : `×${formatNumber(contract.multiplier, 0)}`,
  ]
    .filter((value) => value != null && value !== "")
    .join(" · ");
};

const marketForAssetClass = (assetClass) => {
  const normalized = normalizeAccountPositionTypeFilter(assetClass);
  if (normalized === "etf") return "etf";
  if (normalized === "option") return "options";
  return "stocks";
};

const sectionCardStyle = (style = {}) => ({
  borderTop: `1px solid ${CSS_COLOR.border}`,
  background: CSS_COLOR.bg1,
  minWidth: 0,
  overflow: "hidden",
  ...style,
});

const SectionCard = ({
  title,
  right,
  children,
  loading = false,
  empty = false,
  emptyTitle = "No data",
  emptyBody = "This section will populate once matching trades are available.",
  minHeight = 180,
  loadingWaitItems = null,
  style,
}) => (
  <section className="ra-panel-enter" style={sectionCardStyle(style)}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(4),
        padding: sp("8px 10px"),
        borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
      }}
    >
      <h3
        style={{
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontSize: textSize("bodyStrong"),
          fontWeight: FONT_WEIGHTS.label,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          margin: 0,
        }}
      >
        {title}
      </h3>
      {right}
    </div>
    <div
      style={{
        padding: sp("8px 10px 10px"),
        minHeight: dim(minHeight),
        minWidth: 0,
      }}
    >
      {loading ? (
        <div style={{ display: "grid", gap: sp(5) }}>
          <ContainerLoadingStatus
            items={
              loadingWaitItems || [
                {
                  id: `${title}:analysis`,
                  label: `${title} analysis`,
                  status: "loading",
                  detail: "closed trades and account analysis model",
                  endpoint: "/api/accounts/closed-trades",
                },
              ]
            }
            testId="account-analysis-section-loading-waits"
          />
          <Skeleton height={dim(18)} />
          <Skeleton height={dim(Math.max(80, minHeight - 46))} />
        </div>
      ) : empty ? (
        <DataUnavailableState
          variant="neutral"
          title={emptyTitle}
          detail={emptyBody}
          minHeight={Math.max(96, minHeight - 20)}
        />
      ) : (
        children
      )}
    </div>
  </section>
);

const metricValue = ({ kind, value, currency, maskValues }) => {
  if (kind === "money")
    return formatAccountMoney(value, currency, true, maskValues);
  if (kind === "signedMoney")
    return formatAccountSignedMoney(value, currency, true, maskValues);
  if (kind === "percent") return formatAccountPercent(value, 0, maskValues);
  if (kind === "duration") {
    if (maskValues) return "****";
    const numeric = finiteNumber(value);
    return numeric == null ? "—" : `${formatNumber(numeric / 60, 1)}h`;
  }
  if (kind === "ratio") {
    if (maskValues) return "****";
    return value == null ? "—" : formatNumber(value, 2);
  }
  return formatNumber(value, 0);
};

const MaskedPerformanceState = ({
  minHeight = 120,
  title = "Performance hidden",
}) => (
  <div
    role="status"
    style={{
      alignContent: "center",
      color: CSS_COLOR.textSec,
      display: "grid",
      gap: sp(3),
      minHeight: dim(minHeight),
      padding: sp("12px 10px"),
      textAlign: "center",
    }}
  >
    <strong
      style={{
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontSize: textSize("paragraphMuted"),
      }}
    >
      {title}
    </strong>
    <span
      style={{
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("body"),
      }}
    >
      Turn off privacy masking to view outcome geometry.
    </span>
  </div>
);

const MetricReadout = ({
  label,
  value,
  kind = "number",
  tone,
  currency,
  maskValues,
  hero = false,
  compact = false,
}) => {
  const ticked = useNumberTick(typeof value === "number" ? value : null, 600);
  const flashClass = useValueFlash(typeof value === "number" ? value : null);
  const displayValue = typeof value === "number" ? ticked : value;
  const financialMetric =
    kind === "money" || kind === "signedMoney" || kind === "ratio";
  const color =
    maskValues && financialMetric
      ? CSS_COLOR.textSec
      : tone ||
        (kind === "money" || kind === "signedMoney"
          ? toneForValue(value)
          : CSS_COLOR.text);
  return (
    <div
      className={["ra-panel-enter", flashClass].filter(Boolean).join(" ")}
      style={{
        minWidth: 0,
        display: "grid",
        gap: sp(hero ? 4 : 3),
      }}
    >
      <div
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize(compact ? "label" : "caption"),
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontFamily: T.data,
          fontSize: textSize(
            hero ? "displayHero" : compact ? "bodyStrong" : "displayMedium",
          ),
          fontWeight: FONT_WEIGHTS.emphasis,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {metricValue({ kind, value: displayValue, currency, maskValues })}
      </div>
    </div>
  );
};

const KpiStrip = ({
  trades,
  analysis,
  currency,
  maskValues,
  loading,
  isPhone,
}) => {
  const kpis = useMemo(
    () => buildTradingAnalysisKpis({ trades, currency }),
    [currency, trades],
  );
  const metrics = kpis.metrics;
  const decisionMetrics = [
    { label: "Expectancy", value: metrics.expectancy, kind: "money" },
    { label: "Win rate", value: metrics.winRatePercent, kind: "percent" },
    { label: "Profit factor", value: metrics.profitFactor, kind: "ratio" },
    {
      label: "Max drawdown",
      value: metrics.maxDrawdown,
      kind: "money",
      tone: CSS_COLOR.amber,
    },
  ];
  const supportingMetrics = [
    { label: "Trades", value: metrics.trades, kind: "number" },
    { label: "Avg Hold", value: metrics.averageHoldMinutes, kind: "duration" },
    {
      label: "Commissions",
      value: metrics.commissions,
      kind: "money",
      tone: CSS_COLOR.textSec,
    },
    { label: "Sharpe", value: metrics.sharpeRatio, kind: "ratio" },
    { label: "Sortino", value: metrics.sortinoRatio, kind: "ratio" },
    { label: "Calmar", value: metrics.calmarRatio, kind: "ratio" },
  ];
  const curveRows = arrayValue(analysis?.waterfall);

  return (
    <section
      data-testid="account-analysis-kpi-strip"
      style={{
        display: "grid",
        background: CSS_COLOR.bg1,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        minWidth: 0,
      }}
    >
      <div
        data-testid="account-analysis-performance-brief"
        style={{
          display: "grid",
          gridTemplateColumns: isPhone
            ? "minmax(0, 1fr)"
            : "minmax(0, 1.55fr) minmax(300px, 0.85fr)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            borderRight: isPhone ? "none" : `1px solid ${CSS_COLOR.border}`,
            display: "grid",
            gap: sp(5),
            minWidth: 0,
            padding: sp(isPhone ? "12px 12px 8px" : "14px 16px 10px"),
          }}
        >
          <div
            style={{
              alignItems: "end",
              display: "flex",
              gap: sp(8),
              justifyContent: "space-between",
              minWidth: 0,
            }}
          >
            <MetricReadout
              label="Net P&L"
              value={loading ? null : metrics.netPnl}
              kind="money"
              currency={currency}
              maskValues={maskValues}
              hero
            />
            <span
              style={{
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                paddingBottom: sp(3),
                whiteSpace: "nowrap",
              }}
            >
              {loading
                ? "Loading closed trades"
                : metrics.outcomeCount < metrics.trades
                  ? `${metrics.outcomeCount} of ${metrics.trades} outcomes available`
                  : curveRows.length < metrics.trades
                  ? `Latest ${curveRows.length} of ${metrics.trades} trades`
                  : `${metrics.trades} closed ${metrics.trades === 1 ? "trade" : "trades"}`}
            </span>
          </div>
          {loading ? (
            <Skeleton height={dim(isPhone ? 126 : 172)} radius={RADII.sm} />
          ) : maskValues ? (
            <MaskedPerformanceState
              minHeight={isPhone ? 126 : 172}
              title="Performance chart hidden"
            />
          ) : curveRows.length ? (
            <WaterfallChart
              rows={curveRows}
              currency={currency}
              maskValues={maskValues}
              height={isPhone ? 126 : 172}
            />
          ) : (
            <DataUnavailableState
              variant="neutral"
              title="No closed-trade curve yet"
              detail={
                metrics.trades
                  ? "The cumulative result will appear once complete outcomes are available."
                  : "The cumulative result will appear after a matching trade closes."
              }
              minHeight={isPhone ? 126 : 172}
            />
          )}
        </div>

        <div
          data-testid="account-analysis-decision-metrics"
          style={{
            borderTop: isPhone ? `1px solid ${CSS_COLOR.border}` : "none",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            minWidth: 0,
            padding: sp(isPhone ? "10px 12px 12px" : "14px 16px"),
          }}
        >
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Decision metrics
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              marginTop: sp(6),
              minWidth: 0,
            }}
          >
            {decisionMetrics.map((metric, index) => (
              <div
                key={metric.label}
                style={{
                  borderLeft:
                    index % 2 ? `1px solid ${CSS_COLOR.borderLight}` : "none",
                  borderTop:
                    index > 1 ? `1px solid ${CSS_COLOR.borderLight}` : "none",
                  minWidth: 0,
                  padding: sp("10px 8px"),
                }}
              >
                <MetricReadout
                  {...metric}
                  value={loading ? null : metric.value}
                  tone={loading ? CSS_COLOR.textMuted : metric.tone}
                  currency={currency}
                  maskValues={maskValues}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        data-testid="account-analysis-secondary-metrics"
        style={{
          borderTop: `1px solid ${CSS_COLOR.border}`,
          display: "grid",
          gap: sp(5),
          padding: sp(isPhone ? "9px 12px 11px" : "9px 16px 11px"),
        }}
      >
        <div
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Risk & efficiency
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isPhone
              ? "repeat(3, minmax(0, 1fr))"
              : "repeat(6, minmax(0, 1fr))",
            minWidth: 0,
          }}
        >
          {supportingMetrics.map((metric, index) => (
            <div
              key={metric.label}
              style={{
                borderLeft:
                  index % (isPhone ? 3 : 6)
                    ? `1px solid ${CSS_COLOR.borderLight}`
                    : "none",
                borderTop:
                  isPhone && index > 2
                    ? `1px solid ${CSS_COLOR.borderLight}`
                    : "none",
                minWidth: 0,
                padding: sp("6px 8px"),
              }}
            >
              <MetricReadout
                {...metric}
                value={loading ? null : metric.value}
                tone={loading ? CSS_COLOR.textMuted : metric.tone}
                currency={currency}
                maskValues={maskValues}
                compact
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const toneColor = (tone) =>
  tone === "green"
    ? CSS_COLOR.green
    : tone === "red"
      ? CSS_COLOR.red
      : tone === "amber"
        ? CSS_COLOR.amber
        : tone === "cyan"
          ? CSS_COLOR.cyan
          : CSS_COLOR.accent;

const insightKind = (card) => {
  if (card?.tone === "green") return "What worked";
  if (card?.tone === "red") return "What hurt";
  return "Watch next";
};

const InsightArticle = ({
  card,
  currency,
  maskValues,
  onLensActivate,
  onTradeSelect,
  primary = false,
  isPhone = false,
}) => {
  const color = toneColor(card.tone);
  return (
    <article
      style={{
        alignContent: "start",
        background: primary ? CSS_COLOR.bg2 : "transparent",
        borderLeft: primary ? `3px solid ${color}` : "none",
        borderTop: primary ? "none" : `1px solid ${CSS_COLOR.borderLight}`,
        display: "grid",
        gap: sp(primary ? 6 : 4),
        minWidth: 0,
        padding: sp(primary ? "12px 14px" : "9px 10px"),
      }}
    >
      <div
        style={{
          color,
          fontFamily: T.sans,
          fontSize: textSize("label"),
          fontWeight: FONT_WEIGHTS.label,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {insightKind(card)}
      </div>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          gap: sp(6),
          justifyContent: "space-between",
          minWidth: 0,
        }}
      >
        <strong
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: textSize(primary ? "displaySmall" : "bodyStrong"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.label}
        </strong>
        <span
          style={{
            color: toneForValue(card.value),
            fontFamily: T.data,
            fontSize: textSize(primary ? "bodyStrong" : "caption"),
            whiteSpace: "nowrap",
          }}
        >
          {formatAccountMoney(card.value, currency, true, maskValues)}
        </span>
      </div>
      <div
        style={{
          color: CSS_COLOR.textSec,
          display: "-webkit-box",
          fontFamily: T.sans,
          fontSize: textSize(primary ? "paragraphMuted" : "caption"),
          lineHeight: primary ? 1.4 : 1.3,
          overflow: "hidden",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: primary ? 2 : 1,
        }}
      >
        {card.symbol ? `${card.symbol} · ` : ""}
        {card.description}
      </div>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: sp(4),
          justifyContent: "flex-end",
          minHeight: dim(isPhone ? 40 : 24),
        }}
      >
        {card.lens?.kind ? (
          <Button
            className={isPhone ? "ra-touch-target" : undefined}
            dataTestId={`account-analysis-insight-filter-${card.key}`}
            size="xs"
            variant="ghost"
            onClick={() => onLensActivate?.(card.lens)}
          >
            Use filter
          </Button>
        ) : null}
        {card.tradeId ? (
          <Button
            className={isPhone ? "ra-touch-target" : undefined}
            dataTestId={`account-analysis-insight-inspect-${card.key}`}
            size="xs"
            variant="ghost"
            onClick={() => onTradeSelect?.(card.tradeId)}
          >
            Inspect trade
          </Button>
        ) : null}
      </div>
    </article>
  );
};

const InsightsRow = ({
  analysis,
  currency,
  maskValues,
  onLensActivate,
  onTradeSelect,
  isPhone,
}) => {
  const cards = useMemo(
    () =>
      [
        ...arrayValue(analysis?.representativeTrades),
        ...arrayValue(analysis?.issueCards),
      ].slice(0, 5),
    [analysis],
  );
  if (!cards.length) return null;
  if (maskValues) {
    return (
      <section
        data-testid="account-analysis-insights"
        style={{
          background: CSS_COLOR.bg1,
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          padding: sp(isPhone ? "10px 12px" : "12px 16px"),
        }}
      >
        <MaskedPerformanceState
          minHeight={isPhone ? 132 : 156}
          title="Decision notes hidden"
        />
      </section>
    );
  }
  const issueKeys = new Set(
    arrayValue(analysis?.issueCards).map((card) => card.key),
  );
  const primaryCard = cards.find((card) => issueKeys.has(card.key)) || cards[0];
  const secondaryCards = cards.filter((card) => card.key !== primaryCard.key);
  const secondaryGrid = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isPhone
          ? "minmax(0, 1fr)"
          : "repeat(2, minmax(0, 1fr))",
        minWidth: 0,
      }}
    >
      {secondaryCards.map((card) => (
        <InsightArticle
          key={card.key}
          card={card}
          currency={currency}
          maskValues={maskValues}
          onLensActivate={onLensActivate}
          onTradeSelect={onTradeSelect}
          isPhone={isPhone}
        />
      ))}
    </div>
  );

  return (
    <section
      data-testid="account-analysis-insights"
      style={{
        background: CSS_COLOR.bg1,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        display: "grid",
        gap: sp(6),
        minWidth: 0,
        padding: sp(isPhone ? "10px 12px 12px" : "10px 16px 14px"),
      }}
    >
      <div>
        <div
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.label,
          }}
        >
          Decision notes
        </div>
        <div
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            marginTop: sp(2),
          }}
        >
          Evidence from the closed trades in this scope
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gap: sp(6),
          gridTemplateColumns: isPhone
            ? "minmax(0, 1fr)"
            : "minmax(280px, 1.05fr) minmax(0, 1.45fr)",
          minWidth: 0,
        }}
      >
        <InsightArticle
          card={primaryCard}
          currency={currency}
          maskValues={maskValues}
          onLensActivate={onLensActivate}
          onTradeSelect={onTradeSelect}
          primary
          isPhone={isPhone}
        />
        {isPhone ? (
          <details>
            <summary
              className="ra-interactive ra-touch-target"
              style={{
                color: CSS_COLOR.textSec,
                cursor: "pointer",
                fontFamily: T.sans,
                fontSize: textSize("bodyStrong"),
                padding: sp("8px 2px"),
              }}
            >
              {secondaryCards.length} more decision notes
            </summary>
            {secondaryGrid}
          </details>
        ) : (
          secondaryGrid
        )}
      </div>
    </section>
  );
};

const ChipButton = ({ active, children, onClick }) => (
  <button
    type="button"
    className="ra-interactive ra-touch-target"
    aria-pressed={active}
    onClick={onClick}
    style={{
      minHeight: dim(24),
      padding: sp("0 9px"),
      border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
      borderRadius: dim(RADII.pill),
      background: active
        ? `${cssColorMix(CSS_COLOR.accent, 9)}`
        : CSS_COLOR.bg2,
      color: active ? CSS_COLOR.accent : CSS_COLOR.textSec,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      cursor: "pointer",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </button>
);

const FilterRail = ({
  filters,
  dispatch,
  sourceOptions,
  strategyOptions,
  onReset,
  compact = false,
}) => {
  const normalized = normalizeTradingAnalysisFilters(filters);
  const patch = (patchValue) => dispatch({ type: "patch", patch: patchValue });
  return (
    <aside
      data-testid="account-analysis-filter-rail"
      style={{
        width: compact ? "100%" : dim(220),
        minWidth: compact ? 0 : dim(220),
        position: compact ? "static" : "sticky",
        top: compact ? undefined : dim(8),
        alignSelf: "start",
        maxHeight: compact ? undefined : `calc(100vh - ${dim(80)})`,
        overflowY: "auto",
        borderRight: compact ? "none" : `1px solid ${CSS_COLOR.border}`,
        background: compact ? CSS_COLOR.bg1 : CSS_COLOR.bg0,
        padding: sp(compact ? 4 : "8px 8px 12px"),
        display: "grid",
        gap: sp(5),
      }}
    >
      <FilterSection title="Focus">
        <div style={{ display: "grid", gap: sp(4) }}>
          <ChipButton
            active={normalized.recentOnly}
            onClick={() => patch({ recentOnly: !normalized.recentOnly })}
          >
            Recent
          </ChipButton>
          <TextField
            aria-label="Filter by symbol"
            value={normalized.symbol}
            onChange={(event) =>
              patch({ symbol: event.target.value.toUpperCase() })
            }
            placeholder="Filter by ticker"
            leadingIcon={
              <Icon as={Search} context="inline" aria-hidden="true" />
            }
            style={{ width: "100%" }}
          />
        </div>
      </FilterSection>

      <FilterSection title="Asset">
        <SegmentedControl
          options={ASSET_OPTIONS}
          value={normalized.assetClass}
          onChange={(value) => patch({ assetClass: value })}
          ariaLabel="Asset class"
          buttonTestId="account-analysis-asset"
          radioGroup
        />
      </FilterSection>

      <FilterSection title="P&L">
        <SegmentedControl
          options={PNL_OPTIONS}
          value={normalized.pnlSign}
          onChange={(value) => patch({ pnlSign: value })}
          ariaLabel="P&L sign"
          buttonTestId="account-analysis-pnl"
          radioGroup
        />
      </FilterSection>

      <FilterSection title="Side">
        <SegmentedControl
          options={SIDE_OPTIONS}
          value={normalized.side}
          onChange={(value) => patch({ side: value })}
          ariaLabel="Trade side"
          buttonTestId="account-analysis-side"
          radioGroup
        />
      </FilterSection>

      <FilterSection title="Hold">
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
          {HOLD_OPTIONS.map((option) => (
            <ChipButton
              key={option.value}
              active={normalized.holdDurations.includes(option.value)}
              onClick={() =>
                dispatch({
                  type: "toggleArray",
                  key: "holdDurations",
                  value: option.value,
                })
              }
            >
              {option.label}
            </ChipButton>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Fee Drag">
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
          {FEE_OPTIONS.map((option) => (
            <ChipButton
              key={option.value}
              active={normalized.feeDrags.includes(option.value)}
              onClick={() =>
                dispatch({
                  type: "toggleArray",
                  key: "feeDrags",
                  value: option.value,
                })
              }
            >
              {option.label}
            </ChipButton>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Source">
        <select
          aria-label="Trade source"
          value={normalized.sourceType}
          onChange={(event) => patch({ sourceType: event.target.value })}
          style={selectStyle}
        >
          <option value="all">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Strategy">
        <select
          aria-label="Trading strategy"
          value={normalized.strategy}
          onChange={(event) => patch({ strategy: event.target.value })}
          style={selectStyle}
        >
          <option value="all">All strategies</option>
          {strategyOptions.map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy}
            </option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Date Range">
        <div style={{ display: "grid", gap: sp(3) }}>
          <TextField
            aria-label="Start date"
            type="date"
            value={normalized.from}
            onChange={(event) => patch({ from: event.target.value })}
            style={{ width: "100%" }}
          />
          <TextField
            aria-label="End date"
            type="date"
            value={normalized.to}
            onChange={(event) => patch({ to: event.target.value })}
            style={{ width: "100%" }}
          />
        </div>
      </FilterSection>

      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        style={{ width: "100%" }}
      >
        Reset
      </Button>
    </aside>
  );
};

const selectStyle = {
  width: "100%",
  height: dim(26),
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  background: CSS_COLOR.bg2,
  color: CSS_COLOR.text,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  padding: sp("0 8px"),
  outline: "none",
};

const FilterSection = ({ title, children }) => (
  <div
    style={{
      display: "grid",
      gap: sp(3),
      paddingBottom: sp(4),
      borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
      minWidth: 0,
    }}
  >
    <div style={mutedLabelStyle}>{title}</div>
    {children}
  </div>
);

const ActiveChips = ({ filters, dispatch, onClearAll }) => {
  const chips = describeActiveAnalysisFilters(filters);
  if (!chips.length) return null;
  return (
    <div
      data-testid="account-analysis-active-chips"
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(3),
        flexWrap: "wrap",
        padding: sp("6px 10px"),
        background: CSS_COLOR.bg1,
        borderTop: `1px solid ${CSS_COLOR.borderLight}`,
        borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
      }}
    >
      {chips.map((chip) => (
        <button
          key={`${chip.key}:${chip.value ?? ""}:${chip.label}`}
          type="button"
          className="ra-interactive ra-touch-target"
          aria-label={`Remove filter ${chip.label}`}
          onClick={() =>
            dispatch({ type: "remove", key: chip.key, value: chip.value })
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            border: `1px solid ${cssColorMix(CSS_COLOR.accent, 33)}`,
            borderRadius: dim(RADII.pill),
            background: `${cssColorMix(CSS_COLOR.accent, 8)}`,
            color: CSS_COLOR.accent,
            minHeight: dim(22),
            padding: sp("0 8px"),
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            cursor: "pointer",
          }}
        >
          {chip.label}
          <Icon as={X} size={12} aria-hidden="true" />
        </button>
      ))}
      <Button
        className="ra-touch-target"
        variant="ghost"
        size="xs"
        onClick={onClearAll}
      >
        Clear all
      </Button>
    </div>
  );
};

const buildByHourRows = (trades) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const byHour = new Map();
  arrayValue(trades).forEach((trade) => {
    if (!trade?.closeDate) return;
    const date = new Date(trade.closeDate);
    if (Number.isNaN(date.getTime())) return;
    const pnl = finiteNumber(trade.realizedPnl);
    const hour = formatter.format(date);
    const current = byHour.get(hour) || {
      hour,
      pnl: 0,
      count: 0,
      outcomeCount: 0,
    };
    current.count += 1;
    if (pnl != null) {
      current.pnl += pnl;
      current.outcomeCount += 1;
    }
    byHour.set(hour, current);
  });
  return Array.from(byHour.values())
    .map((row) => ({
      ...row,
      pnl: row.outcomeCount === row.count ? row.pnl : null,
    }))
    .sort((left, right) => left.hour.localeCompare(right.hour));
};

const groupToChartRows = (groups, labelKey = "label") =>
  arrayValue(groups).map((group) => ({
    key: group.key,
    label: group[labelKey] || group.label || group.key,
    count: group.count || 0,
    pnl:
      group.count > 0 && group.outcomeCount === group.count
        ? group.realizedPnl
        : null,
    winRatePercent: group.winRatePercent,
    expectancy: group.expectancy,
    profitFactor: group.profitFactor,
    trades: group.trades || [],
  }));

const ChartTooltip = ({ active, payload, label, currency, maskValues }) => {
  if (!active || !payload?.length) return null;
  const metrics = payload
    .filter((item) => item?.value != null)
    .slice(0, 3)
    .map((item) => ({
      label: item.name || item.dataKey,
      value:
        item.dataKey === "pnl" || item.dataKey === "cumulative"
          ? formatAccountMoney(item.value, currency, true, maskValues)
          : formatNumber(item.value, 0),
    }));
  return (
    <div className="ra-tooltip-content">
      <RichTooltipContent title={label} metrics={metrics} />
    </div>
  );
};

const PnlBarChart = ({
  data,
  currency,
  maskValues,
  layout = "horizontal",
  height = 180,
  ariaLabel = "P&L by analysis bucket",
}) =>
  maskValues ? (
    <MaskedPerformanceState minHeight={height} />
  ) : (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height: dim(height) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={layout}
          margin={{
            top: 8,
            right: 8,
            bottom: 8,
            left: layout === "vertical" ? 58 : 0,
          }}
        >
          <CartesianGrid stroke={CSS_COLOR.borderLight} vertical={false} />
          {layout === "vertical" ? (
            <>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fill: CSS_COLOR.textDim, fontSize: 10 }}
                width={56}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={{ fill: CSS_COLOR.textDim, fontSize: 10 }}
              />
              <YAxis
                tick={{ fill: CSS_COLOR.textDim, fontSize: 10 }}
                width={44}
              />
            </>
          )}
          <Tooltip
            content={(props) => (
              <ChartTooltip
                {...props}
                currency={currency}
                maskValues={maskValues}
              />
            )}
          />
          <Bar dataKey="pnl" name="P&L" radius={[2, 2, 0, 0]}>
            {data.map((row) => (
              <Cell
                key={row.key || row.label}
                fill={(row.pnl || 0) >= 0 ? CSS_COLOR.green : CSS_COLOR.red}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

const WaterfallChart = ({
  rows,
  currency,
  maskValues,
  height = 220,
}) => {
  const data = arrayValue(rows).map((row, index) => ({
    key: row.id || index,
    label: `${index + 1}`,
    pnl: row.pnl,
    cumulative: row.cumulative,
    symbol: row.symbol,
  }));
  if (maskValues) {
    return <MaskedPerformanceState minHeight={height} />;
  }
  if (!data.length) return null;
  const finalPnl = data[data.length - 1]?.cumulative ?? 0;
  return (
    <div
      role="img"
      aria-label={
        maskValues
          ? `Cumulative P&L curve for ${data.length} closed trades`
          : `Cumulative P&L curve ending at ${formatAccountMoney(finalPnl, currency, true)}`
      }
      style={{ width: "100%", height: dim(height) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 2, left: 0 }}
        >
          <CartesianGrid stroke={CSS_COLOR.borderLight} vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: CSS_COLOR.textDim, fontSize: 9 }}
            interval="preserveStartEnd"
          />
          <YAxis
            axisLine={false}
            hide={maskValues}
            tickLine={false}
            tick={{ fill: CSS_COLOR.textDim, fontSize: 9 }}
            width={44}
          />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                {...props}
                currency={currency}
                maskValues={maskValues}
              />
            )}
          />
          <Bar
            dataKey="pnl"
            name="Trade"
            fillOpacity={0.22}
            radius={[2, 2, 0, 0]}
          >
            {data.map((row) => (
              <Cell
                key={row.key}
                fill={(row.pnl || 0) >= 0 ? CSS_COLOR.green : CSS_COLOR.red}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="cumulative"
            name="Cumulative"
            stroke={toneForValue(finalPnl)}
            dot={false}
            strokeWidth={2.5}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

const SymbolTable = ({
  rows,
  sparklineMap,
  currency,
  maskValues,
  onSymbolSelect,
}) => {
  const [page, setPage] = useState(0);
  const paginatedRows = paginateRows(rows, page, SYMBOL_PAGE_SIZE);
  const visibleRows = paginatedRows.pageRows;
  useEffect(() => {
    setPage(0);
  }, [rows]);
  useEffect(() => {
    if (paginatedRows.safePage !== page) {
      setPage(paginatedRows.safePage);
    }
  }, [page, paginatedRows.safePage]);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
      <div className="ra-hide-scrollbar" style={{ overflowX: "auto" }}>
        <table
          aria-label="Trading performance by symbol"
          style={{
            width: "100%",
            minWidth: dim(520),
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: textSize("caption"),
                textTransform: "uppercase",
              }}
            >
              {["Symbol", "Trades", "Win", "Net P&L", "Trend"].map((column) => (
                <th
                  key={column}
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: sp("4px 5px"),
                    borderBottom: `1px solid ${CSS_COLOR.border}`,
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className="ra-table-row">
                <td
                  style={{
                    padding: sp("5px"),
                    color: CSS_COLOR.cyan,
                    fontFamily: T.data,
                  }}
                >
                  <button
                    type="button"
                    className="ra-interactive ra-touch-target-y"
                    aria-label={`Filter analysis to ${row.key}`}
                    onClick={() => onSymbolSelect?.(row.key)}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      color: CSS_COLOR.cyan,
                      cursor: "pointer",
                    }}
                  >
                    {row.key}
                  </button>
                </td>
                <td style={symbolCellStyle}>{formatNumber(row.count, 0)}</td>
                <td style={symbolCellStyle}>
                  {formatAccountPercent(row.winRatePercent, 0, maskValues)}
                </td>
                <td
                  style={{
                    ...symbolCellStyle,
                    color: maskValues
                      ? CSS_COLOR.textSec
                      : toneForValue(row.pnl),
                  }}
                >
                  {formatAccountMoney(row.pnl, currency, true, maskValues)}
                </td>
                <td style={symbolCellStyle}>
                  {maskValues ? (
                    "Hidden"
                  ) : (
                    <MicroSparkline
                      data={sparklineMap.get(row.key)}
                      width={72}
                      height={18}
                      ariaHidden
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationFooter
        dataTestId="account-analysis-symbol-pagination"
        label="Rows"
        onPageChange={setPage}
        page={paginatedRows.safePage}
        pageCount={paginatedRows.pageCount}
        pageSize={SYMBOL_PAGE_SIZE}
        total={paginatedRows.total}
      />
    </div>
  );
};

const symbolCellStyle = {
  padding: sp("5px"),
  color: CSS_COLOR.textSec,
  fontFamily: T.data,
  fontSize: textSize("caption"),
};

const AttributionTable = ({ rows, currency, maskValues }) => {
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      {rows.slice(0, 8).map((row) => (
        <div
          key={`${row.kind}:${row.key}`}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            gap: sp(5),
            alignItems: "center",
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
            paddingBottom: sp(3),
          }}
        >
          <span
            style={{
              color: CSS_COLOR.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.label}
          </span>
          <span>{formatNumber(row.count, 0)} trades</span>
          <span
            style={{
              color: maskValues
                ? CSS_COLOR.textSec
                : toneForValue(row.realizedPnl),
              fontFamily: T.data,
            }}
          >
            {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
          </span>
        </div>
      ))}
    </div>
  );
};

const OutcomeDistribution = ({ trades, currency, maskValues }) => {
  const pnls = arrayValue(trades)
    .map((trade) => finiteNumber(trade?.realizedPnl))
    .filter((value) => value != null);
  if (!pnls.length) return null;
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);
  const span = max - min || 1;
  const bucketCount = 12;
  const buckets = Array.from({ length: bucketCount }, () => 0);
  pnls.forEach((pnl) => {
    const idx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(((pnl - min) / span) * bucketCount)),
    );
    buckets[idx] += 1;
  });
  if (maskValues) {
    return <MaskedPerformanceState minHeight={126} />;
  }
  const bucketWidth = span / bucketCount;
  const bucketRows = buckets.map((count, index) => ({
    count,
    key: `outcome-${index}`,
    midpoint: min + (index + 0.5) * bucketWidth,
  }));
  return (
    <div style={{ display: "grid", gap: sp(6), placeItems: "center" }}>
      <div
        role="img"
        aria-label="Trade outcome distribution from losses to gains"
        style={{ height: dim(76), width: "100%" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bucketRows}
            margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
          >
            <XAxis dataKey="key" hide />
            <YAxis hide />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {bucketRows.map((row) => (
                <Cell
                  key={row.key}
                  fill={row.midpoint < 0 ? CSS_COLOR.red : CSS_COLOR.green}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          color: CSS_COLOR.textDim,
          fontSize: textSize("caption"),
          fontFamily: T.data,
        }}
      >
        <span>{formatAccountMoney(min, currency, true, maskValues)}</span>
        <span>0</span>
        <span>{formatAccountMoney(max, currency, true, maskValues)}</span>
      </div>
    </div>
  );
};

const PatternsView = ({
  trades,
  analysis,
  currency,
  maskValues,
  loading,
  isPhone,
  onLensActivate,
}) => {
  const byHour = useMemo(() => buildByHourRows(trades), [trades]);
  const symbolRows = useMemo(
    () =>
      groupToChartRows(analysis?.bucketGroups?.symbol).sort(
        (a, b) => Math.abs(b.pnl) - Math.abs(a.pnl),
      ),
    [analysis],
  );
  const holdRows = useMemo(
    () => groupToChartRows(analysis?.bucketGroups?.holdDuration),
    [analysis],
  );
  const exitRows = useMemo(
    () => groupToChartRows(analysis?.bucketGroups?.exitReason),
    [analysis],
  );
  const dteRows = useMemo(
    () => groupToChartRows(analysis?.bucketGroups?.dte),
    [analysis],
  );
  const strikeRows = useMemo(
    () => groupToChartRows(analysis?.bucketGroups?.strikeSlot),
    [analysis],
  );
  const driverRows = useMemo(
    () => groupToChartRows(analysis?.bucketGroups?.mfeGiveback),
    [analysis],
  );
  const sparklineMap = useMemo(() => buildSymbolSparklineMap(trades), [trades]);
  const hasOptions = trades.some(tradeHasOptionFields);
  const empty = !loading && !trades.length;
  return (
    <div
      data-testid="account-analysis-patterns-view"
      style={{
        display: "grid",
        gap: sp(isPhone ? 6 : 8),
        minWidth: 0,
        padding: sp(isPhone ? 4 : 6),
      }}
    >
      <div
        data-testid="account-analysis-pattern-primary-grid"
        style={{
          display: "grid",
          gap: sp(isPhone ? 6 : 8),
          gridTemplateColumns: isPhone
            ? "minmax(0, 1fr)"
            : "minmax(0, 1.55fr) minmax(280px, 0.75fr)",
          minWidth: 0,
        }}
      >
        <SectionCard
          title="Where results came from"
          right={<span style={mutedLabelStyle}>By symbol</span>}
          loading={loading}
          empty={empty || !symbolRows.length}
          minHeight={isPhone ? 250 : 354}
        >
          <SymbolTable
            rows={symbolRows}
            sparklineMap={sparklineMap}
            currency={currency}
            maskValues={maskValues}
            onSymbolSelect={(symbol) =>
              onLensActivate?.({ kind: "symbol", input: { symbol } })
            }
          />
        </SectionCard>
        <div style={{ display: "grid", gap: sp(isPhone ? 6 : 8), minWidth: 0 }}>
          <SectionCard
            title="When performance landed"
            right={<span style={mutedLabelStyle}>Close hour ET</span>}
            loading={loading}
            empty={empty || !byHour.length}
            minHeight={isPhone ? 180 : 164}
          >
            <PnlBarChart
              data={byHour.map((row) => ({
                ...row,
                label: `${row.hour}:00`,
              }))}
              currency={currency}
              maskValues={maskValues}
              height={isPhone ? 170 : 154}
              ariaLabel="Realized P&L by close hour"
            />
          </SectionCard>
          <SectionCard
            title="Holding-time edge"
            right={<span style={mutedLabelStyle}>Frequency + result</span>}
            loading={loading}
            empty={empty || !holdRows.length}
            minHeight={isPhone ? 180 : 174}
          >
            {maskValues ? (
              <MaskedPerformanceState minHeight={isPhone ? 170 : 164} />
            ) : (
              <div
                role="img"
                aria-label="Trade count and realized P&L by holding period"
                style={{ width: "100%", height: dim(isPhone ? 170 : 164) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={holdRows}
                    margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                  >
                    <CartesianGrid
                      stroke={CSS_COLOR.borderLight}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: CSS_COLOR.textDim, fontSize: 10 }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: CSS_COLOR.textDim, fontSize: 10 }}
                      width={32}
                    />
                    <YAxis yAxisId="right" orientation="right" hide />
                    <Tooltip
                      content={(props) => (
                        <ChartTooltip
                          {...props}
                          currency={currency}
                          maskValues={maskValues}
                        />
                      )}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="count"
                      name="Trades"
                      fill={CSS_COLOR.cyan}
                      radius={[2, 2, 0, 0]}
                    />
                    <Line
                      yAxisId="right"
                      dataKey="pnl"
                      name="P&L"
                      stroke={CSS_COLOR.accent}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div
        data-testid="account-analysis-diagnostic-grid"
        style={{
          display: "grid",
          gap: sp(isPhone ? 6 : 8),
          gridTemplateColumns: isPhone
            ? "minmax(0, 1fr)"
            : "minmax(220px, 0.65fr) minmax(0, 1.35fr)",
          minWidth: 0,
        }}
      >
        <SectionCard
          title="Outcome range"
          right={<span style={mutedLabelStyle}>Loss → gain</span>}
          loading={loading}
          empty={empty}
          minHeight={188}
        >
          <OutcomeDistribution
            trades={trades}
            currency={currency}
            maskValues={maskValues}
          />
        </SectionCard>
        <div
          style={{
            display: "grid",
            gap: sp(isPhone ? 6 : 8),
            gridTemplateColumns: isPhone
              ? "minmax(0, 1fr)"
              : "minmax(260px, 0.85fr) minmax(0, 1.15fr)",
            minWidth: 0,
          }}
        >
          <SectionCard
            title="Why exits paid"
            right={<span style={mutedLabelStyle}>By exit reason</span>}
            loading={loading}
            empty={empty || !exitRows.length}
            minHeight={188}
          >
            <PnlBarChart
              data={exitRows.slice(0, 8)}
              currency={currency}
              maskValues={maskValues}
              layout="vertical"
              ariaLabel="Realized P&L by exit reason"
            />
          </SectionCard>
          <SectionCard
            title="Attribution drivers"
            loading={loading}
            empty={
              empty ||
              !arrayValue(analysis?.attribution?.contributionRows).length
            }
            minHeight={188}
          >
            <AttributionTable
              rows={arrayValue(analysis?.attribution?.contributionRows)}
              currency={currency}
              maskValues={maskValues}
            />
          </SectionCard>
        </div>
      </div>

      {hasOptions ? (
        <div
          style={{
            display: "grid",
            gap: sp(isPhone ? 6 : 8),
            gridTemplateColumns: isPhone
              ? "minmax(0, 1fr)"
              : "minmax(0, 1.15fr) minmax(280px, 0.85fr)",
            minWidth: 0,
          }}
        >
          <SectionCard
            title="Options structure"
            right={<span style={mutedLabelStyle}>DTE + strike slot</span>}
            loading={loading}
            empty={!dteRows.length && !strikeRows.length}
          >
            <div style={{ display: "grid", gap: sp(5) }}>
              <PnlBarChart
                data={dteRows}
                currency={currency}
                maskValues={maskValues}
                height={136}
                ariaLabel="Options P&L by days to expiration"
              />
              <PnlBarChart
                data={strikeRows.slice(0, 8)}
                currency={currency}
                maskValues={maskValues}
                height={136}
                ariaLabel="Options P&L by strike slot"
              />
            </div>
          </SectionCard>
          <SectionCard
            title="Outcome driver"
            right={<span style={mutedLabelStyle}>MFE giveback</span>}
            loading={loading}
            empty={!driverRows.length}
          >
            <PnlBarChart
              data={driverRows}
              currency={currency}
              maskValues={maskValues}
              layout="vertical"
              ariaLabel="Options P&L by outcome driver"
            />
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
};

const tradeSortValue = (trade, key) => {
  if (key === "symbol") return normalizeSymbol(trade?.symbol) || null;
  if (key === "side") return normalizeText(trade?.side).toLowerCase() || null;
  if (key === "source") {
    return (
      normalizeText(
      trade?.strategyLabel,
      normalizeText(trade?.sourceType, trade?.source),
      ) || null
    );
  }
  if (key === "entryExit") {
    const value = trade?.closeDate || trade?.openDate;
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (key === "quantity") return finiteNumber(trade?.quantity);
  if (key === "hold") return finiteNumber(trade?.holdDurationMinutes);
  if (key === "commissions") return finiteNumber(trade?.commissions);
  if (key === "percent") return finiteNumber(trade?.realizedPnlPercent);
  return finiteNumber(trade?.realizedPnl);
};

const sortTrades = (trades, sort) => {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...arrayValue(trades)].sort((left, right) => {
    const leftValue = tradeSortValue(left, sort.key);
    const rightValue = tradeSortValue(right, sort.key);
    if (leftValue == null || rightValue == null) {
      if (leftValue == null && rightValue == null) return 0;
      return leftValue == null ? 1 : -1;
    }
    if (typeof leftValue === "string" || typeof rightValue === "string") {
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    }
    return (leftValue - rightValue) * direction;
  });
};

const formatHold = (minutes) => {
  const numeric = finiteNumber(minutes);
  if (numeric == null) return "—";
  return numeric < 60
    ? `${formatNumber(numeric, 0)}m`
    : `${formatNumber(numeric / 60, 1)}h`;
};

const TradeRow = ({
  trade,
  columns = TABLE_COLUMNS,
  expanded,
  onToggle,
  currency,
  maskValues,
  lifecycleRows,
  lifecycleOrdersKnown,
  onJumpToChart,
  isPhone,
}) => {
  const tradeId = getAccountTradeId(trade);
  const rowGrid = isPhone
    ? "minmax(0, 1fr) minmax(70px, auto) 26px"
    : tradeTableGridTemplate(columns);
  const renderDesktopCell = (columnKey) => {
    if (columnKey === "symbol") {
      return (
        <div style={{ minWidth: 0 }}>
          <MarketIdentityInline
            item={{
              ticker: trade.symbol,
              market: marketForAssetClass(
                trade.positionType || trade.assetClass,
              ),
            }}
            size={14}
            showMark={false}
            showChips={!isPhone}
            style={{ maxWidth: dim(150) }}
          />
        </div>
      );
    }
    if (columnKey === "side") return <div>{trade.side || "—"}</div>;
    if (columnKey === "source") {
      return (
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {trade.strategyLabel || trade.sourceType || trade.source || "—"}
        </div>
      );
    }
    if (columnKey === "entryExit") {
      return (
        <div style={{ color: CSS_COLOR.textDim }}>
          {formatAppDate(trade.openDate)} {"->"}{" "}
          {formatAppDate(trade.closeDate)}
        </div>
      );
    }
    if (columnKey === "quantity") {
      return (
        <div style={{ fontFamily: T.data }}>
          {formatNumber(trade.quantity, 2)}
        </div>
      );
    }
    if (columnKey === "hold") {
      return (
        <div style={{ fontFamily: T.data }}>
          {formatHold(trade.holdDurationMinutes)}
        </div>
      );
    }
    if (columnKey === "commissions") {
      return (
        <div style={{ fontFamily: T.data }}>
          {formatAccountMoney(trade.commissions, currency, true, maskValues)}
        </div>
      );
    }
    if (columnKey === "percent") {
      return (
        <div style={{ fontFamily: T.data }}>
          {formatAccountPercent(trade.realizedPnlPercent, 1, maskValues)}
        </div>
      );
    }
    return (
      <div
        style={{
          color: maskValues
            ? CSS_COLOR.textSec
            : toneForValue(trade.realizedPnl),
          fontFamily: T.data,
        }}
      >
        {formatAccountMoney(
          trade.realizedPnl,
          trade.currency || currency,
          true,
          maskValues,
        )}
      </div>
    );
  };
  const row = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: rowGrid,
        gap: sp(4),
        alignItems: "center",
        width: "100%",
        minWidth: 0,
        padding: sp(isPhone ? "0 8px" : "0 10px"),
        color: CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      {isPhone ? (
        <div style={{ minWidth: 0 }}>
          <MarketIdentityInline
            item={{
              ticker: trade.symbol,
              market: marketForAssetClass(
                trade.positionType || trade.assetClass,
              ),
            }}
            size={14}
            showMark={false}
            showChips={false}
            style={{ maxWidth: dim(140) }}
          />
          <div
            style={{ color: CSS_COLOR.textDim, fontSize: textSize("label") }}
          >
            {trade.side || "—"} · {formatHold(trade.holdDurationMinutes)}
          </div>
        </div>
      ) : null}
      {isPhone ? (
        <div
          style={{
            color: maskValues
              ? CSS_COLOR.textSec
              : toneForValue(trade.realizedPnl),
            fontFamily: T.data,
            textAlign: "right",
          }}
        >
          {formatAccountMoney(
            trade.realizedPnl,
            trade.currency || currency,
            true,
            maskValues,
          )}
        </div>
      ) : (
        columns.map((column) => (
          <div key={column.key} style={{ minWidth: 0 }}>
            {renderDesktopCell(column.key)}
          </div>
        ))
      )}
      <Icon
        as={expanded ? ChevronDown : ChevronRight}
        context="inline"
        aria-hidden="true"
      />
    </div>
  );
  return (
    <TableExpandableRow
      dataTestId="account-analysis-trade-row"
      expanded={expanded}
      onToggle={onToggle}
      rowHeight={isPhone ? 64 : 38}
      expandedHeight={isPhone ? 1400 : 1000}
      selectionAccent={CSS_COLOR.cyan}
      rowClassName="ra-table-row"
      row={row}
      expandedContent={
        <TradeExpandedDetail
          trade={trade}
          tradeId={tradeId}
          currency={currency}
          maskValues={maskValues}
          lifecycleRows={lifecycleRows}
          lifecycleOrdersKnown={lifecycleOrdersKnown}
          onJumpToChart={onJumpToChart}
        />
      }
    />
  );
};

const DetailMetric = ({ label, value, tone = CSS_COLOR.text }) => (
  <div style={{ minWidth: 0 }}>
    <div
      style={{
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("micro"),
        textTransform: "uppercase",
        letterSpacing: 0,
      }}
    >
      {label}
    </div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: textSize("body"),
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value ?? "—"}
    </div>
  </div>
);

const TradeAuditTrail = ({ trade, tradeId, maskValues }) => {
  const contract = resolveAccountTradeContractDetails(trade);
  const rows = [
    { label: "Account", value: trade.accountId, sensitive: true },
    { label: "Trade record", value: tradeId, sensitive: true },
    {
      label: "Provider / source",
      value: [trade.source, trade.sourceType].filter(Boolean).join(" / "),
    },
    {
      label: "Deployment",
      value: [
        normalizeLegacyAlgoBrandText(trade.deploymentName),
        trade.deploymentId,
      ]
        .filter(Boolean)
        .join(" · "),
      sensitive: true,
    },
    { label: "Candidate", value: trade.candidateId, sensitive: true },
    { label: "Source event", value: trade.sourceEventId, sensitive: true },
    {
      label: "Linked orders",
      value: arrayValue(trade.orderIds).join(", "),
      sensitive: true,
    },
    {
      label: "Provider contract",
      value: contract.providerContractId,
      sensitive: true,
    },
  ].filter((row) => normalizeText(row.value));

  return (
    <div data-testid="account-analysis-trade-audit" style={{ display: "grid" }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(96px, 0.35fr) minmax(0, 1fr)",
            gap: sp(6),
            borderTop: `1px solid ${CSS_COLOR.borderLight}`,
            padding: sp("6px 8px"),
          }}
        >
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.label,
            }}
          >
            {row.label}
          </div>
          <div
            style={{
              color: CSS_COLOR.textSec,
              fontFamily: T.data,
              fontSize: textSize("caption"),
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {maskValues && row.sensitive ? "Hidden" : row.value}
          </div>
        </div>
      ))}
    </div>
  );
};

const ExitConsequences = ({ trade, currency, maskValues }) => {
  const mfe = finiteNumber(trade?.mfePercent);
  const giveback = finiteNumber(trade?.givebackPercent);
  const peak = finiteNumber(trade?.peakPrice);
  if (mfe == null && giveback == null && peak == null) {
    return (
      <DataUnavailableState
        variant="neutral"
        title="No exit consequence data"
        detail="MFE, giveback, or continuation fields are not available for this trade."
        minHeight={120}
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: sp(5) }}>
      <DetailMetric
        label="Max Favorable"
        value={mfe == null ? "—" : formatAccountPercent(mfe, 0, maskValues)}
        tone={maskValues || mfe == null ? CSS_COLOR.textSec : CSS_COLOR.green}
      />
      <DetailMetric
        label="Giveback"
        value={
          giveback == null ? "—" : formatAccountPercent(giveback, 0, maskValues)
        }
        tone={
          maskValues || giveback == null ? CSS_COLOR.textSec : CSS_COLOR.amber
        }
      />
      <DetailMetric
        label="Peak Price"
        value={peak == null ? "—" : formatAccountPrice(peak, 2, maskValues)}
        tone={CSS_COLOR.textSec}
      />
      <DetailMetric
        label="Exit"
        value={formatAccountPrice(trade?.avgClose, 2, maskValues)}
        tone={maskValues ? CSS_COLOR.textSec : toneForValue(trade?.realizedPnl)}
      />
      <div
        style={{
          color: CSS_COLOR.textDim,
          fontSize: textSize("caption"),
          lineHeight: 1.35,
        }}
      >
        Best continuation and worst follow-through require post-exit bar
        windows. This account view uses the trade-level MFE/giveback fields when
        continuation bars are unavailable.
      </div>
    </div>
  );
};

const TradeExpandedDetail = ({
  trade,
  tradeId,
  currency,
  maskValues,
  lifecycleRows,
  lifecycleOrdersKnown,
  onJumpToChart,
}) => (
  <div
    data-testid="account-analysis-trade-expanded"
    style={{
      padding: sp("10px 12px 14px"),
      background: CSS_COLOR.bg2,
      borderLeft: `2px solid ${CSS_COLOR.cyan}`,
      display: "grid",
      gap: sp(8),
      minWidth: 0,
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: sp(6),
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.label,
        }}
      >
        {trade.symbol || "Trade"} · {tradeId}
      </div>
      {trade.symbol && onJumpToChart ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onJumpToChart(trade.symbol)}
        >
          Chart
        </Button>
      ) : null}
    </div>
    <TradePriceChart
      trade={trade}
      currency={currency}
      maskValues={maskValues}
    />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(138)}px, 1fr))`,
        gap: sp(5),
      }}
    >
      <DetailMetric
        label="Realized"
        value={formatAccountMoney(
          trade.realizedPnl,
          trade.currency || currency,
          true,
          maskValues,
        )}
        tone={maskValues ? CSS_COLOR.textSec : toneForValue(trade.realizedPnl)}
      />
      <DetailMetric
        label="Return"
        value={formatAccountPercent(trade.realizedPnlPercent, 2, maskValues)}
      />
      <DetailMetric
        label="Hold"
        value={formatHold(trade.holdDurationMinutes)}
      />
      <DetailMetric label="Quantity" value={formatNumber(trade.quantity, 3)} />
      <DetailMetric
        label="Commissions"
        value={formatAccountMoney(
          trade.commissions,
          currency,
          true,
          maskValues,
        )}
      />
      <DetailMetric
        label="Premium at risk"
        value={formatAccountMoney(
          trade.premiumAtRisk,
          trade.currency || currency,
          true,
          maskValues,
        )}
      />
      <DetailMetric
        label="Opened"
        value={trade.openDate ? formatAppDateTime(trade.openDate) : "—"}
      />
      <DetailMetric
        label="Closed"
        value={trade.closeDate ? formatAppDateTime(trade.closeDate) : "—"}
      />
      <DetailMetric
        label="Entry"
        value={formatAccountPrice(trade.avgOpen, 2, maskValues)}
      />
      <DetailMetric
        label="Exit"
        value={formatAccountPrice(trade.avgClose, 2, maskValues)}
      />
      <DetailMetric
        label="Signal price"
        value={formatAccountPrice(trade.signalPrice, 2, maskValues)}
      />
      <DetailMetric
        label="Strike distance"
        value={formatAccountPercent(trade.strikeDistancePct, 2, maskValues)}
      />
      <DetailMetric
        label="Source"
        value={trade.sourceType || trade.source || "—"}
      />
      <DetailMetric
        label="Strategy"
        value={
          trade.strategyLabel ||
          normalizeLegacyAlgoBrandText(trade.deploymentName) ||
          trade.candidateId ||
          "—"
        }
      />
      <DetailMetric
        label="Exit Reason"
        value={
          trade.exitReason ? String(trade.exitReason).replaceAll("_", " ") : "—"
        }
      />
      <DetailMetric
        label="Contract"
        value={tradeContractLabel(trade)}
      />
      <DetailMetric
        label="DTE / Slot"
        value={`${trade.dte == null ? "—" : formatNumber(trade.dte, 0)} / ${trade.strikeSlot == null ? "—" : formatNumber(trade.strikeSlot, 0)}`}
      />
      <DetailMetric
        label="MFE / Giveback"
        value={`${trade.mfePercent == null ? "—" : formatAccountPercent(trade.mfePercent, 0, maskValues)} / ${trade.givebackPercent == null ? "—" : formatAccountPercent(trade.givebackPercent, 0, maskValues)}`}
      />
      <DetailMetric
        label="Regime"
        value={
          trade.adx == null && !Array.isArray(trade.mtfDirections)
            ? "—"
            : `ADX ${trade.adx == null ? "—" : formatNumber(trade.adx, 1)} · MTF ${Array.isArray(trade.mtfDirections) ? trade.mtfDirections.join("/") : "—"}`
        }
      />
    </div>
    <LifecycleTimeline
      rows={lifecycleRows}
      currency={currency}
      maskValues={maskValues}
    />
    {lifecycleOrdersKnown ? null : (
      <div
        role="status"
        style={{ color: CSS_COLOR.textMuted, fontSize: textSize("caption") }}
      >
        Related order history is not loaded yet.
      </div>
    )}
    <div className="ra-account-analysis-card-grid ra-account-analysis-card-grid--two">
      <SectionCard title="Audit Trail" minHeight={150}>
        <TradeAuditTrail
          trade={trade}
          tradeId={tradeId}
          maskValues={maskValues}
        />
      </SectionCard>
      <SectionCard title="Exit Consequences" minHeight={150}>
        <ExitConsequences
          trade={trade}
          currency={currency}
          maskValues={maskValues}
        />
      </SectionCard>
    </div>
  </div>
);

const TradesView = ({
  trades,
  analysis,
  query,
  currency,
  maskValues,
  selectedTradeId,
  onTradeSelect,
  onJumpToChart,
  isPhone,
}) => {
  const [sort, setSort] = useState({ key: "entryExit", direction: "desc" });
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeColumnOrder(
      _initialState.tradingAnalysisTradeColumnOrder,
      TABLE_COLUMN_IDS,
    ),
  );
  const [page, setPage] = useState(0);
  const orderedColumns = useMemo(
    () => orderColumnsById(TABLE_COLUMNS, columnOrder, (column) => column.key),
    [columnOrder],
  );
  const sortedRows = useMemo(() => sortTrades(trades, sort), [sort, trades]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sortedRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(0);
  }, [trades]);
  useEffect(() => {
    persistState({
      tradingAnalysisTradeColumnOrder: normalizeColumnOrder(
        columnOrder,
        TABLE_COLUMN_IDS,
      ),
    });
  }, [columnOrder]);

  const reorderTradeColumn = (activeColumnId, overColumnId) => {
    setColumnOrder((current) =>
      reorderColumnOrder(current, activeColumnId, overColumnId, {
        fallbackColumnIds: TABLE_COLUMN_IDS,
        validColumnIds: TABLE_COLUMN_IDS,
      }),
    );
  };

  const toggleSort = (key) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  };

  if (queryInitialLoading(query)) {
    return (
      <div style={{ padding: sp(4), display: "grid", gap: sp(3) }}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} height={dim(36)} />
        ))}
      </div>
    );
  }

  if (!sortedRows.length) {
    return (
      <div style={{ padding: sp(4) }}>
        <DataUnavailableState
          variant="neutral"
          title="No trades match the current filters."
          detail="Clear filters or expand the date range to inspect more closed trades."
          minHeight={180}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="account-analysis-trades-view"
      role="region"
      aria-label="Closed trades"
      onKeyDown={(event) => {
        if (event.key === "Escape" && selectedTradeId) {
          onTradeSelect?.("");
        }
      }}
      style={{ display: "grid", gap: sp(4), padding: sp(4), minWidth: 0 }}
    >
      {!isPhone ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: tradeTableGridTemplate(orderedColumns),
            gap: sp(4),
            padding: sp("6px 10px"),
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: CSS_COLOR.bg1,
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            textTransform: "uppercase",
            letterSpacing: 0,
          }}
        >
          <TableHeaderDndContext
            columnIds={orderedColumns.map((column) => column.key)}
            onReorder={reorderTradeColumn}
          >
            {orderedColumns.map((column) => (
              <SortableColumnHeaderCell
                key={column.key}
                as="div"
                id={column.key}
                active={sort.key === column.key}
                label={column.label}
                onSort={() => toggleSort(column.key)}
                sortDirection={sort.key === column.key ? sort.direction : null}
                sortable
                sortTitle={`Sort by ${column.label}`}
                style={{
                  color:
                    sort.key === column.key
                      ? CSS_COLOR.text
                      : CSS_COLOR.textDim,
                  padding: 0,
                }}
              />
            ))}
          </TableHeaderDndContext>
          <span />
        </div>
      ) : null}
      <div
        style={{
          borderTop: `1px solid ${CSS_COLOR.border}`,
          overflow: "hidden",
          background: CSS_COLOR.bg1,
        }}
      >
        {pageRows.map((trade) => {
          const tradeId = getAccountTradeId(trade);
          const expanded = Boolean(
            selectedTradeId && selectedTradeId === tradeId,
          );
          return (
            <TradeRow
              key={tradeId}
              trade={trade}
              columns={orderedColumns}
              expanded={expanded}
              onToggle={() => onTradeSelect?.(expanded ? "" : tradeId)}
              currency={currency}
              maskValues={maskValues}
              lifecycleRows={expanded ? analysis?.lifecycleRows : []}
              lifecycleOrdersKnown={analysis?.lifecycleOrdersKnown === true}
              onJumpToChart={onJumpToChart}
              isPhone={isPhone}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(5),
        }}
      >
        <Button
          size="xs"
          variant="ghost"
          disabled={safePage <= 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}
        >
          Previous
        </Button>
        <span
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          Page {safePage + 1} of {pageCount}
        </span>
        <Button
          size="xs"
          variant="ghost"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
};

const sourceOptionsForTrades = (trades) =>
  Array.from(
    new Set(
      arrayValue(trades)
        .map((trade) =>
          normalizeText(trade?.sourceType, normalizeText(trade?.source)),
        )
        .filter(Boolean),
    ),
  ).sort();

const strategyOptionsForTrades = (trades) =>
  Array.from(
    new Set(
      arrayValue(trades)
        .map((trade) =>
          normalizeText(
            trade?.strategyLabel,
            normalizeText(
              normalizeLegacyAlgoBrandText(trade?.deploymentName),
              normalizeText(trade?.candidateId),
            ),
          ),
        )
        .filter(Boolean),
    ),
  ).sort();

const HeaderStrip = ({
  range,
  onRangeChange,
  scopeLabel,
  isPhone,
  onOpenFilters,
  activeView,
  onViewChange,
}) => (
  <header
    data-testid="account-analysis-scope-toolbar"
    style={{
      borderBottom: `1px solid ${CSS_COLOR.border}`,
      display: "grid",
      gap: sp(isPhone ? 7 : 6),
      gridTemplateColumns: isPhone
        ? "minmax(0, 1fr)"
        : "minmax(220px, 1fr) auto",
      minWidth: 0,
      padding: sp(isPhone ? "10px 12px" : "9px 12px"),
    }}
  >
    <div style={{ alignSelf: "center", minWidth: 0 }}>
      <div
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize("label"),
          fontWeight: FONT_WEIGHTS.label,
          letterSpacing: "0.08em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        Scope
      </div>
      <div
        style={{
          color: CSS_COLOR.textSec,
          fontFamily: T.sans,
          fontSize: textSize(isPhone ? "body" : "bodyStrong"),
          marginTop: sp(2),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {scopeLabel}
      </div>
    </div>
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: sp(isPhone ? 5 : 4),
        justifyContent: isPhone ? "space-between" : "flex-end",
        minWidth: 0,
      }}
    >
      <SegmentedControl
        options={VIEW_OPTIONS}
        value={activeView}
        onChange={onViewChange}
        ariaLabel="Trading analysis view"
        buttonTestId="account-analysis-view"
        radioGroup
      />
      {isPhone ? (
        <select
          aria-label="Trading analysis range"
          value={range}
          onChange={(event) => onRangeChange(event.target.value)}
          style={{
            ...selectStyle,
            height: dim(44),
            minWidth: dim(66),
            width: "auto",
          }}
        >
          {ACCOUNT_RANGES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
      {!isPhone ? (
        <SegmentedControl
          options={ACCOUNT_RANGES}
          value={range}
          onChange={onRangeChange}
          ariaLabel="Trading analysis range"
          buttonTestId="account-analysis-range"
          radioGroup
        />
      ) : null}
      {isPhone ? (
        <Button
          className="ra-touch-target"
          dataTestId="account-analysis-open-filters"
          size="sm"
          variant="secondary"
          leftIcon={<Icon as={Filter} context="control" aria-hidden="true" />}
          onClick={onOpenFilters}
        >
          Filters
        </Button>
      ) : null}
    </div>
  </header>
);

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const MobileFilterDrawer = ({ open, onClose, children }) => {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Trading analysis filters"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        gridTemplateColumns: "minmax(0, min(330px, 88vw)) minmax(0, 1fr)",
      }}
    >
      <div
        style={{
          background: CSS_COLOR.bg1,
          boxShadow: `0 0 0 1px ${CSS_COLOR.border}, ${ELEVATION.lg}`,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: sp(4),
            borderBottom: `1px solid ${CSS_COLOR.border}`,
          }}
        >
          <div
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.label,
            }}
          >
            Filters
          </div>
          <Button
            ref={closeButtonRef}
            className="ra-touch-target"
            dataTestId="account-analysis-close-filters"
            size="xs"
            variant="ghost"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
        {children}
      </div>
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        style={{ border: "none", background: cssColorMix(CSS_COLOR.bg0, 35) }}
      />
    </div>
  );
};

export const TradingAnalysisWorkbench = ({
  query,
  trades = [],
  allTrades = [],
  orders = null,
  filters,
  dispatchFilters,
  range,
  onRangeChange,
  currency,
  maskValues,
  selectedTradeId,
  onTradeSelect,
  onActiveViewChange,
  onJumpToChart,
  isPhone = false,
  nowMs,
}) => {
  const [activeView, setActiveView] = useState(() => {
    try {
      const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed.accountAnalysisView === "trades" ? "trades" : "patterns";
    } catch {
      return "patterns";
    }
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const normalizedFilters = useMemo(
    () => normalizeTradingAnalysisFilters(filters),
    [filters],
  );
  const sourceOptions = useMemo(
    () => sourceOptionsForTrades(allTrades),
    [allTrades],
  );
  const strategyOptions = useMemo(
    () => strategyOptionsForTrades(allTrades),
    [allTrades],
  );
  const visibleTrades = useMemo(
    () =>
      filterAccountAnalysisTrades({
        trades,
        filters: normalizedFilters,
        range,
        nowMs,
      }),
    [normalizedFilters, nowMs, range, trades],
  );
  const scopedAnalysis = useMemo(
    () =>
      buildAccountTradingAnalysisModel({
        trades: visibleTrades,
        orders,
        selectedTradeId,
      }),
    [orders, selectedTradeId, visibleTrades],
  );
  const scopeLabel = buildTradingAnalysisScopeLabel({
    filters: normalizedFilters,
    range,
    tradeCount: visibleTrades.length,
    totalTradeCount: arrayValue(allTrades).length,
    nowMs,
  });
  const initialLoading = queryInitialLoading(query);

  useEffect(() => {
    onActiveViewChange?.(activeView);
    try {
      const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      window.localStorage.setItem(
        PYRUS_STORAGE_KEY,
        JSON.stringify({ ...parsed, accountAnalysisView: activeView }),
      );
    } catch {}
  }, [activeView, onActiveViewChange]);

  const clearAll = () => {
    dispatchFilters({ type: "reset" });
    onTradeSelect?.("");
  };

  const applyLens = (lens) => {
    if (!lens?.kind) return;
    const input = lens.input || {};
    if (lens.kind === "symbol")
      dispatchFilters({ type: "patch", patch: { symbol: input.symbol || "" } });
    else if (lens.kind === "pnl")
      dispatchFilters({
        type: "patch",
        patch: { pnlSign: input.pnlSign || "all" },
      });
    else if (lens.kind === "holdDuration")
      dispatchFilters({
        type: "patch",
        patch: { holdDurations: [input.holdDuration].filter(Boolean) },
      });
    else if (lens.kind === "feeDrag")
      dispatchFilters({
        type: "patch",
        patch: { feeDrags: [input.feeDrag].filter(Boolean) },
      });
    else if (lens.kind === "side")
      dispatchFilters({ type: "patch", patch: { side: input.side || "all" } });
    else if (lens.kind === "assetClass")
      dispatchFilters({
        type: "patch",
        patch: { assetClass: input.assetClass || "all" },
      });
    else if (lens.kind === "strategy")
      dispatchFilters({
        type: "patch",
        patch: { strategy: input.strategy || "all" },
      });
    else if (lens.kind === "source")
      dispatchFilters({
        type: "patch",
        patch: { sourceType: input.sourceType || "all" },
      });
  };

  const handleRangeChange = (nextRange) => {
    dispatchFilters({ type: "clearDateRange" });
    onRangeChange?.(nextRange);
  };

  const inspectTrade = (tradeId) => {
    if (!tradeId) return;
    setActiveView("trades");
    onTradeSelect?.(tradeId);
  };

  return (
    <Panel
      title="Trading Analysis"
      minHeight={360}
      loading={false}
      error={query?.error}
      onRetry={query?.refetch}
      noPad
    >
      <div
        data-testid="account-trading-analysis-workbench"
        className={isPhone ? "ra-touch-surface" : undefined}
        style={{ display: "grid", minWidth: 0 }}
      >
        <HeaderStrip
          range={range}
          onRangeChange={handleRangeChange}
          scopeLabel={scopeLabel}
          isPhone={isPhone}
          onOpenFilters={() => setFiltersOpen(true)}
          activeView={activeView}
          onViewChange={setActiveView}
        />
        <ActiveChips
          filters={normalizedFilters}
          dispatch={dispatchFilters}
          onClearAll={clearAll}
        />
        <KpiStrip
          trades={visibleTrades}
          analysis={scopedAnalysis}
          currency={currency}
          maskValues={maskValues}
          loading={initialLoading}
          isPhone={isPhone}
        />
        <InsightsRow
          analysis={scopedAnalysis}
          currency={currency}
          maskValues={maskValues}
          onLensActivate={applyLens}
          onTradeSelect={inspectTrade}
          isPhone={isPhone}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isPhone
              ? "minmax(0, 1fr)"
              : `${dim(220)}px minmax(0, 1fr)`,
            minWidth: 0,
          }}
        >
          {!isPhone ? (
            <FilterRail
              filters={normalizedFilters}
              dispatch={dispatchFilters}
              sourceOptions={sourceOptions}
              strategyOptions={strategyOptions}
              onReset={clearAll}
            />
          ) : null}
          <main
            aria-label={
              activeView === "patterns" ? "Trading patterns" : "Closed trades"
            }
            style={{ minWidth: 0, background: CSS_COLOR.bg0 }}
          >
            {activeView === "patterns" ? (
              <PatternsView
                trades={visibleTrades}
                analysis={scopedAnalysis}
                currency={currency}
                maskValues={maskValues}
                loading={initialLoading}
                isPhone={isPhone}
                onLensActivate={applyLens}
              />
            ) : (
              <TradesView
                trades={visibleTrades}
                analysis={scopedAnalysis}
                query={query}
                currency={currency}
                maskValues={maskValues}
                selectedTradeId={selectedTradeId}
                onTradeSelect={onTradeSelect}
                onJumpToChart={onJumpToChart}
                isPhone={isPhone}
              />
            )}
          </main>
        </div>
        <MobileFilterDrawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        >
          <FilterRail
            filters={normalizedFilters}
            dispatch={dispatchFilters}
            sourceOptions={sourceOptions}
            strategyOptions={strategyOptions}
            onReset={clearAll}
            compact
          />
        </MobileFilterDrawer>
      </div>
    </Panel>
  );
};

export default TradingAnalysisWorkbench;
