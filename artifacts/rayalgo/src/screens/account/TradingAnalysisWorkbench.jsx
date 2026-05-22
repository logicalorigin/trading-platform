import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  Filter,
  Lightbulb,
  Search,
  Trophy,
  X,
} from "lucide-react";
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
import {
  FONT_WEIGHTS,
  LEGACY_RAYALGO_STORAGE_KEY,
  PYRUS_STORAGE_KEY,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAppDate, formatAppDateTime } from "../../lib/timeZone";
import {
  ACCOUNT_RANGES,
  Panel,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountPrice,
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "./accountUtils";
import { getAccountTradeId } from "./accountTradingAnalysis";
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
  Button,
  DataUnavailableState,
  Icon,
  MicroSparkline,
  RichTooltipContent,
  SegmentedControl,
  Skeleton,
  TableExpandableRow,
  TextField,
  ThresholdHistogram,
} from "../../components/platform/primitives.jsx";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
import { LifecycleTimeline, TradePriceChart } from "./tradingAnalysis/TradeForensics";

const VIEW_OPTIONS = [
  { value: "patterns", label: "Patterns" },
  { value: "trades", label: "Trades" },
];

const ASSET_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Stocks", label: "Stocks" },
  { value: "Options", label: "Options" },
  { value: "Futures", label: "Futures" },
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
  { key: "symbol", label: "Symbol" },
  { key: "side", label: "Side" },
  { key: "source", label: "Source" },
  { key: "entryExit", label: "Entry -> Exit" },
  { key: "quantity", label: "Qty" },
  { key: "hold", label: "Hold" },
  { key: "commissions", label: "Comms" },
  { key: "realizedPnl", label: "Net P&L" },
  { key: "percent", label: "%" },
];

const PAGE_SIZE = 25;
const SYMBOL_PAGE_SIZE = 8;

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const arrayValue = (value) => (Array.isArray(value) ? value : []);

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

const marketForAssetClass = (assetClass) => {
  const normalized = String(assetClass || "").toLowerCase();
  if (normalized === "etf") return "etf";
  if (normalized === "options") return "options";
  return "stocks";
};

const sectionCardStyle = (style = {}) => ({
  border: `1px solid ${T.border}`,
  borderRadius: dim(RADII.md),
  background: T.bg1,
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
        borderBottom: `1px solid ${T.borderLight}`,
      }}
    >
      <div
        style={{
          color: T.text,
          fontFamily: T.sans,
          fontSize: textSize("bodyStrong"),
          fontWeight: FONT_WEIGHTS.label,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      {right}
    </div>
    <div style={{ padding: sp("8px 10px 10px"), minHeight: dim(minHeight), minWidth: 0 }}>
      {loading ? (
        <div style={{ display: "grid", gap: sp(5) }}>
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
  if (kind === "money") return formatAccountMoney(value, currency, true, maskValues);
  if (kind === "signedMoney") return formatAccountSignedMoney(value, currency, true, maskValues);
  if (kind === "percent") return formatAccountPercent(value, 0, maskValues);
  if (kind === "duration") {
    if (maskValues) return "****";
    return value == null ? "—" : `${formatNumber(Number(value) / 60, 1)}h`;
  }
  if (kind === "ratio") return value == null ? "—" : formatNumber(value, 2);
  return formatNumber(value, 0);
};

const MetricCard = ({ label, value, kind = "number", tone, currency, maskValues, sparkline }) => {
  const ticked = useNumberTick(typeof value === "number" ? value : null, 600);
  const flashClass = useValueFlash(typeof value === "number" ? value : null);
  const displayValue = typeof value === "number" ? ticked : value;
  const color = tone || (kind === "money" || kind === "signedMoney" ? toneForValue(value) : T.text);
  return (
    <div
      className={["ra-panel-enter", flashClass].filter(Boolean).join(" ")}
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        background: T.bg1,
        padding: sp("8px 10px"),
        minWidth: 0,
        display: "grid",
        gap: sp(4),
      }}
    >
      <div
        style={{
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: 0,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontFamily: T.data,
          fontSize: textSize("displayMedium"),
          fontWeight: FONT_WEIGHTS.emphasis,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {metricValue({ kind, value: displayValue, currency, maskValues })}
      </div>
      {maskValues ? null : (
        <MicroSparkline
          data={arrayValue(sparkline)}
          width={80}
          height={16}
          ariaHidden
          style={{ width: dim(80), maxWidth: "100%" }}
        />
      )}
    </div>
  );
};

const KpiStrip = ({ trades, currency, maskValues, loading }) => {
  const kpis = useMemo(
    () => buildTradingAnalysisKpis({ trades, currency }),
    [currency, trades],
  );
  const metrics = kpis.metrics;
  const cards = [
    { label: "Trades", value: metrics.trades, kind: "number" },
    { label: "Net P&L", value: metrics.netPnl, kind: "money" },
    { label: "Win %", value: metrics.winRatePercent, kind: "percent" },
    { label: "Expectancy", value: metrics.expectancy, kind: "money" },
    { label: "Profit Factor", value: metrics.profitFactor, kind: "ratio" },
    { label: "Avg Hold", value: metrics.averageHoldMinutes, kind: "duration" },
    { label: "Commissions", value: metrics.commissions, kind: "money", tone: T.textSec },
    { label: "Max DD", value: metrics.maxDrawdown, kind: "money", tone: T.amber },
    { label: "Sharpe", value: metrics.sharpeRatio, kind: "ratio" },
    { label: "Sortino", value: metrics.sortinoRatio, kind: "ratio" },
    { label: "Calmar", value: metrics.calmarRatio, kind: "ratio" },
  ];
  return (
    <div
      data-testid="account-analysis-kpi-strip"
      className="ra-hide-scrollbar"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(132)}px, 1fr))`,
        gap: sp(3),
        padding: sp("8px 10px"),
        overflowX: "auto",
      }}
    >
      {loading
        ? Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} height={dim(70)} radius={RADII.md} />
          ))
        : cards.map((card) => (
            <MetricCard
              key={card.label}
              {...card}
              currency={currency}
              maskValues={maskValues}
              sparkline={kpis.sparkline}
            />
          ))}
    </div>
  );
};

const toneColor = (tone) =>
  tone === "green"
    ? T.green
    : tone === "red"
      ? T.red
      : tone === "amber"
        ? T.amber
        : tone === "cyan"
          ? T.cyan
          : T.accent;

const insightIcon = (card) => {
  if (card?.key?.includes("best")) return Trophy;
  if (card?.tone === "red" || card?.tone === "amber") return AlertTriangle;
  if (card?.key?.includes("typical")) return Clock3;
  return Lightbulb;
};

const InsightsRow = ({ analysis, currency, maskValues, onLensActivate, onTradeSelect }) => {
  const cards = useMemo(
    () => [
      ...arrayValue(analysis?.representativeTrades),
      ...arrayValue(analysis?.issueCards),
    ].slice(0, 5),
    [analysis],
  );
  if (!cards.length) return null;
  return (
    <div
      data-testid="account-analysis-insights"
      className="ra-hide-scrollbar"
      style={{
        display: "flex",
        gap: sp(3),
        overflowX: "auto",
        padding: sp("0 10px 8px"),
        WebkitOverflowScrolling: "touch",
      }}
    >
      {cards.map((card) => {
        const color = toneColor(card.tone);
        const IconComponent = insightIcon(card);
        return (
          <article
            key={card.key}
            style={{
              flex: `0 0 ${dim(280)}px`,
              minHeight: dim(96),
              border: `1px solid ${T.border}`,
              borderLeft: `2px solid ${color}`,
              borderRadius: dim(RADII.md),
              background: T.bg2,
              padding: sp("8px 10px"),
              display: "grid",
              gap: sp(5),
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", gap: sp(6), alignItems: "center", minWidth: 0 }}>
              <Icon as={IconComponent} size={16} color={color} aria-hidden="true" />
              <div
                style={{
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: textSize("bodyStrong"),
                  fontWeight: FONT_WEIGHTS.label,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  marginLeft: "auto",
                  color: toneForValue(card.value),
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  whiteSpace: "nowrap",
                }}
              >
                {formatAccountMoney(card.value, currency, true, maskValues)}
              </div>
            </div>
            <div
              style={{
                color: T.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                lineHeight: 1.25,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {card.symbol ? `${card.symbol} · ` : ""}
              {card.description}
            </div>
            <div style={{ display: "flex", gap: sp(4), justifyContent: "space-between" }}>
              {card.lens?.kind ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onLensActivate?.(card.lens)}
                  style={{ padding: sp("0 2px") }}
                >
                  Filter
                </Button>
              ) : <span />}
              {card.tradeId ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onTradeSelect?.(card.tradeId)}
                  style={{ padding: sp("0 2px") }}
                >
                  Inspect
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
};

const ChipButton = ({ active, children, onClick }) => (
  <button
    type="button"
    className="ra-interactive"
    aria-pressed={active}
    onClick={onClick}
    style={{
      minHeight: dim(24),
      padding: sp("0 9px"),
      border: `1px solid ${active ? T.accent : T.border}`,
      borderRadius: dim(RADII.pill),
      background: active ? `${T.accent}18` : T.bg2,
      color: active ? T.accent : T.textSec,
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
        width: compact ? "100%" : dim(240),
        minWidth: compact ? 0 : dim(240),
        position: compact ? "static" : "sticky",
        top: compact ? undefined : dim(58),
        alignSelf: "start",
        maxHeight: compact ? undefined : `calc(100vh - ${dim(80)})`,
        overflowY: "auto",
        borderRight: compact ? "none" : `1px solid ${T.border}`,
        background: T.bg1,
        padding: sp(4),
        display: "grid",
        gap: sp(5),
      }}
    >
      <FilterSection title="Lens">
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
          <ChipButton
            active={normalized.pnlSign === "winners"}
            onClick={() => patch({ pnlSign: normalized.pnlSign === "winners" ? "all" : "winners" })}
          >
            Winners
          </ChipButton>
          <ChipButton
            active={normalized.pnlSign === "losers"}
            onClick={() => patch({ pnlSign: normalized.pnlSign === "losers" ? "all" : "losers" })}
          >
            Losers
          </ChipButton>
          <ChipButton
            active={normalized.side === "long"}
            onClick={() => patch({ side: normalized.side === "long" ? "all" : "long" })}
          >
            Long
          </ChipButton>
          <ChipButton
            active={normalized.side === "short"}
            onClick={() => patch({ side: normalized.side === "short" ? "all" : "short" })}
          >
            Short
          </ChipButton>
          <ChipButton
            active={normalized.recentOnly}
            onClick={() => patch({ recentOnly: !normalized.recentOnly })}
          >
            Recent
          </ChipButton>
        </div>
      </FilterSection>

      <FilterSection title="Symbol">
        <TextField
          value={normalized.symbol}
          onChange={(event) => patch({ symbol: event.target.value.toUpperCase() })}
          placeholder="Filter by ticker"
          leadingIcon={<Icon as={Search} context="inline" aria-hidden="true" />}
          style={{ width: "100%" }}
        />
      </FilterSection>

      <FilterSection title="Asset">
        <SegmentedControl
          options={ASSET_OPTIONS}
          value={normalized.assetClass}
          onChange={(value) => patch({ assetClass: value })}
          ariaLabel="Asset class"
          buttonTestId="account-analysis-asset"
        />
      </FilterSection>

      <FilterSection title="P&L">
        <SegmentedControl
          options={PNL_OPTIONS}
          value={normalized.pnlSign}
          onChange={(value) => patch({ pnlSign: value })}
          ariaLabel="P&L sign"
          buttonTestId="account-analysis-pnl"
        />
      </FilterSection>

      <FilterSection title="Side">
        <SegmentedControl
          options={SIDE_OPTIONS}
          value={normalized.side}
          onChange={(value) => patch({ side: value })}
          ariaLabel="Trade side"
          buttonTestId="account-analysis-side"
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
          value={normalized.sourceType}
          onChange={(event) => patch({ sourceType: event.target.value })}
          style={selectStyle}
        >
          <option value="all">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Strategy">
        <select
          value={normalized.strategy}
          onChange={(event) => patch({ strategy: event.target.value })}
          style={selectStyle}
        >
          <option value="all">All strategies</option>
          {strategyOptions.map((strategy) => (
            <option key={strategy} value={strategy}>{strategy}</option>
          ))}
        </select>
      </FilterSection>

      <FilterSection title="Date Range">
        <div style={{ display: "grid", gap: sp(3) }}>
          <TextField
            type="date"
            value={normalized.from}
            onChange={(event) => patch({ from: event.target.value })}
            style={{ width: "100%" }}
          />
          <TextField
            type="date"
            value={normalized.to}
            onChange={(event) => patch({ to: event.target.value })}
            style={{ width: "100%" }}
          />
        </div>
      </FilterSection>

      <Button variant="ghost" size="sm" onClick={onReset} style={{ width: "100%" }}>
        Reset
      </Button>
    </aside>
  );
};

const selectStyle = {
  width: "100%",
  height: dim(26),
  border: `1px solid ${T.border}`,
  borderRadius: dim(RADII.sm),
  background: T.bg2,
  color: T.text,
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
      borderBottom: `1px solid ${T.borderLight}`,
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
        background: T.bg1,
        borderTop: `1px solid ${T.borderLight}`,
        borderBottom: `1px solid ${T.borderLight}`,
      }}
    >
      {chips.map((chip) => (
        <button
          key={`${chip.key}:${chip.value ?? ""}:${chip.label}`}
          type="button"
          className="ra-interactive"
          onClick={() => dispatch({ type: "remove", key: chip.key, value: chip.value })}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            border: `1px solid ${T.accent}55`,
            borderRadius: dim(RADII.pill),
            background: `${T.accent}14`,
            color: T.accent,
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
      <Button variant="ghost" size="xs" onClick={onClearAll}>
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
    const hour = formatter.format(date);
    const current = byHour.get(hour) || { hour, pnl: 0, count: 0 };
    current.pnl += finiteNumber(trade.realizedPnl) ?? 0;
    current.count += 1;
    byHour.set(hour, current);
  });
  return Array.from(byHour.values()).sort((left, right) => left.hour.localeCompare(right.hour));
};

const groupToChartRows = (groups, labelKey = "label") =>
  arrayValue(groups).map((group) => ({
    key: group.key,
    label: group[labelKey] || group.label || group.key,
    count: group.count || 0,
    pnl: group.realizedPnl || 0,
    winRatePercent: group.winRatePercent,
    expectancy: group.expectancy,
    profitFactor: group.profitFactor,
    trades: group.trades || [],
  }));

const ChartTooltip = ({ active, payload, label, currency }) => {
  if (!active || !payload?.length) return null;
  const metrics = payload
    .filter((item) => item?.value != null)
    .slice(0, 3)
    .map((item) => ({
      label: item.name || item.dataKey,
      value:
        item.dataKey === "pnl"
          ? formatAccountMoney(item.value, currency, true)
          : formatNumber(item.value, 0),
    }));
  return (
    <div className="ra-tooltip-content">
      <RichTooltipContent title={label} metrics={metrics} />
    </div>
  );
};

const PnlBarChart = ({ data, currency, layout = "horizontal", height = 180 }) => (
  <div style={{ width: "100%", height: dim(height) }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 8, bottom: 8, left: layout === "vertical" ? 58 : 0 }}
      >
        <CartesianGrid stroke={T.borderLight} vertical={false} />
        {layout === "vertical" ? (
          <>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" tick={{ fill: T.textDim, fontSize: 10 }} width={56} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={{ fill: T.textDim, fontSize: 10 }} />
            <YAxis tick={{ fill: T.textDim, fontSize: 10 }} width={44} />
          </>
        )}
        <Tooltip content={(props) => <ChartTooltip {...props} currency={currency} />} />
        <Bar dataKey="pnl" name="P&L" radius={[2, 2, 0, 0]}>
          {data.map((row) => (
            <Cell key={row.key || row.label} fill={(row.pnl || 0) >= 0 ? T.green : T.red} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

const WaterfallChart = ({ rows, currency, onTradeSelect }) => {
  const data = arrayValue(rows).map((row, index) => ({
    key: row.id || index,
    label: `${index + 1}`,
    pnl: row.pnl,
    cumulative: row.cumulative,
    symbol: row.symbol,
  }));
  if (!data.length) return null;
  return (
    <div style={{ width: "100%", height: dim(220) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={T.borderLight} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: T.textDim, fontSize: 10 }} />
          <YAxis tick={{ fill: T.textDim, fontSize: 10 }} width={48} />
          <Tooltip content={(props) => <ChartTooltip {...props} currency={currency} />} />
          <Bar
            dataKey="pnl"
            name="Trade"
            radius={[2, 2, 0, 0]}
            onClick={(entry) => onTradeSelect?.(entry?.key)}
          >
            {data.map((row) => (
              <Cell key={row.key} fill={(row.pnl || 0) >= 0 ? T.green : T.red} />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="cumulative"
            name="Cumulative"
            stroke={T.cyan}
            dot={false}
            strokeWidth={1.5}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

const SymbolTable = ({ rows, sparklineMap, currency, maskValues, onSymbolSelect }) => {
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
        <table style={{ width: "100%", minWidth: dim(520), borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: T.textMuted, fontSize: textSize("caption"), textTransform: "uppercase" }}>
              {["Symbol", "Trades", "Win", "Net P&L", "Trend"].map((column) => (
                <th key={column} style={{ textAlign: "left", padding: sp("4px 5px"), borderBottom: `1px solid ${T.border}` }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className="ra-table-row">
                <td style={{ padding: sp("5px"), color: T.cyan, fontFamily: T.data }}>
                  <button
                    type="button"
                    className="ra-interactive"
                    onClick={() => onSymbolSelect?.(row.key)}
                    style={{ border: "none", background: "transparent", padding: 0, color: T.cyan, cursor: "pointer" }}
                  >
                    {row.key}
                  </button>
                </td>
                <td style={symbolCellStyle}>{formatNumber(row.count, 0)}</td>
                <td style={symbolCellStyle}>{formatAccountPercent(row.winRatePercent, 0, maskValues)}</td>
                <td style={{ ...symbolCellStyle, color: toneForValue(row.pnl) }}>
                  {formatAccountMoney(row.pnl, currency, true, maskValues)}
                </td>
                <td style={symbolCellStyle}>
                  <MicroSparkline data={sparklineMap.get(row.key)} width={72} height={18} ariaHidden />
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
  color: T.textSec,
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
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            borderBottom: `1px solid ${T.borderLight}`,
            paddingBottom: sp(3),
          }}
        >
          <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.label}
          </span>
          <span>{formatNumber(row.count, 0)} trades</span>
          <span style={{ color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
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
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(((pnl - min) / span) * bucketCount)));
    buckets[idx] += 1;
  });
  const thresholdPosition = Math.min(1, Math.max(0, (0 - min) / span));
  return (
    <div style={{ display: "grid", gap: sp(6), placeItems: "center" }}>
      <ThresholdHistogram buckets={buckets} thresholdPosition={thresholdPosition} width={220} height={54} />
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", color: T.textDim, fontSize: textSize("caption"), fontFamily: T.data }}>
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
  onLensActivate,
  onTradeSelect,
}) => {
  const byHour = useMemo(() => buildByHourRows(trades), [trades]);
  const symbolRows = useMemo(
    () => groupToChartRows(analysis?.bucketGroups?.symbol).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    [analysis],
  );
  const holdRows = useMemo(() => groupToChartRows(analysis?.bucketGroups?.holdDuration), [analysis]);
  const exitRows = useMemo(() => groupToChartRows(analysis?.bucketGroups?.exitReason), [analysis]);
  const dteRows = useMemo(() => groupToChartRows(analysis?.bucketGroups?.dte), [analysis]);
  const strikeRows = useMemo(() => groupToChartRows(analysis?.bucketGroups?.strikeSlot), [analysis]);
  const driverRows = useMemo(() => groupToChartRows(analysis?.bucketGroups?.mfeGiveback), [analysis]);
  const sparklineMap = useMemo(() => buildSymbolSparklineMap(trades), [trades]);
  const hasOptions = trades.some(tradeHasOptionFields);
  const empty = !loading && !trades.length;
  return (
    <div
      data-testid="account-analysis-patterns-view"
      style={{ display: "grid", gap: sp(4), padding: sp(4), minWidth: 0 }}
    >
      <SectionCard
        title="Cumulative P&L"
        right={<span style={mutedLabelStyle}>Last {arrayValue(analysis?.waterfall).length} trades</span>}
        loading={loading}
        empty={empty || !arrayValue(analysis?.waterfall).length}
        minHeight={260}
      >
        <WaterfallChart rows={analysis?.waterfall} currency={currency} onTradeSelect={onTradeSelect} />
      </SectionCard>

      <div className="ra-account-analysis-card-grid">
        <SectionCard title="By Symbol" loading={loading} empty={empty || !symbolRows.length}>
          <SymbolTable
            rows={symbolRows}
            sparklineMap={sparklineMap}
            currency={currency}
            maskValues={maskValues}
            onSymbolSelect={(symbol) => onLensActivate?.({ kind: "symbol", input: { symbol } })}
          />
        </SectionCard>
        <SectionCard title="By Time" loading={loading} empty={empty || !byHour.length}>
          <PnlBarChart data={byHour.map((row) => ({ ...row, label: `${row.hour}:00` }))} currency={currency} />
        </SectionCard>
        <SectionCard title="Hold Profile" loading={loading} empty={empty || !holdRows.length}>
          <div style={{ width: "100%", height: dim(180) }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={holdRows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid stroke={T.borderLight} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: T.textDim, fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: T.textDim, fontSize: 10 }} width={32} />
                <YAxis yAxisId="right" orientation="right" hide />
                <Tooltip content={(props) => <ChartTooltip {...props} currency={currency} />} />
                <Bar yAxisId="left" dataKey="count" name="Trades" fill={T.cyan} radius={[2, 2, 0, 0]} />
                <Line yAxisId="right" dataKey="pnl" name="P&L" stroke={T.accent} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="ra-account-analysis-card-grid">
        <SectionCard title="Exit Reasons" loading={loading} empty={empty || !exitRows.length}>
          <PnlBarChart data={exitRows.slice(0, 8)} currency={currency} layout="vertical" />
        </SectionCard>
        <SectionCard title="Outcome Distribution" loading={loading} empty={empty}>
          <OutcomeDistribution trades={trades} currency={currency} maskValues={maskValues} />
        </SectionCard>
        <SectionCard title="Attribution" loading={loading} empty={empty || !arrayValue(analysis?.attribution?.contributionRows).length}>
          <AttributionTable
            rows={arrayValue(analysis?.attribution?.contributionRows)}
            currency={currency}
            maskValues={maskValues}
          />
        </SectionCard>
      </div>

      {hasOptions ? (
        <div className="ra-account-analysis-card-grid ra-account-analysis-card-grid--two">
          <SectionCard title="By Bucket" loading={loading} empty={!dteRows.length && !strikeRows.length}>
            <div style={{ display: "grid", gap: sp(5) }}>
              <PnlBarChart data={dteRows} currency={currency} height={136} />
              <PnlBarChart data={strikeRows.slice(0, 8)} currency={currency} height={136} />
            </div>
          </SectionCard>
          <SectionCard title="By Outcome Driver" loading={loading} empty={!driverRows.length}>
            <PnlBarChart data={driverRows} currency={currency} layout="vertical" />
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
};

const tradeSortValue = (trade, key) => {
  if (key === "symbol") return normalizeSymbol(trade?.symbol);
  if (key === "side") return normalizeText(trade?.side).toLowerCase();
  if (key === "source") return normalizeText(trade?.strategyLabel, normalizeText(trade?.sourceType, trade?.source));
  if (key === "entryExit") return new Date(trade?.closeDate || trade?.openDate || 0).getTime();
  if (key === "quantity") return finiteNumber(trade?.quantity) ?? 0;
  if (key === "hold") return finiteNumber(trade?.holdDurationMinutes) ?? 0;
  if (key === "commissions") return finiteNumber(trade?.commissions) ?? 0;
  if (key === "percent") return finiteNumber(trade?.realizedPnlPercent) ?? 0;
  return finiteNumber(trade?.realizedPnl) ?? 0;
};

const sortTrades = (trades, sort) => {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...arrayValue(trades)].sort((left, right) => {
    const leftValue = tradeSortValue(left, sort.key);
    const rightValue = tradeSortValue(right, sort.key);
    if (typeof leftValue === "string" || typeof rightValue === "string") {
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    }
    return ((leftValue || 0) - (rightValue || 0)) * direction;
  });
};

const formatHold = (minutes) =>
  minutes == null || Number.isNaN(Number(minutes))
    ? "—"
    : Number(minutes) < 60
      ? `${formatNumber(minutes, 0)}m`
      : `${formatNumber(Number(minutes) / 60, 1)}h`;

const TradeRow = ({
  trade,
  expanded,
  onToggle,
  currency,
  maskValues,
  lifecycleRows,
  onJumpToChart,
  isPhone,
}) => {
  const tradeId = getAccountTradeId(trade);
  const rowGrid = isPhone
    ? "minmax(0, 1fr) minmax(70px, auto) 26px"
    : "minmax(130px, 1.2fr) minmax(56px, 0.55fr) minmax(118px, 1fr) minmax(150px, 1.15fr) minmax(58px, 0.5fr) minmax(60px, 0.55fr) minmax(78px, 0.7fr) minmax(90px, 0.8fr) minmax(58px, 0.45fr) 26px";
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
        color: T.textSec,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      <div style={{ minWidth: 0 }}>
        <MarketIdentityInline
          item={{ ticker: trade.symbol, market: marketForAssetClass(trade.assetClass) }}
          size={14}
          showMark={false}
          showChips={!isPhone}
          style={{ maxWidth: dim(isPhone ? 140 : 150) }}
        />
        {isPhone ? (
          <div style={{ color: T.textDim, fontSize: textSize("label") }}>
            {trade.side || "—"} · {formatHold(trade.holdDurationMinutes)}
          </div>
        ) : null}
      </div>
      {isPhone ? (
        <div style={{ color: toneForValue(trade.realizedPnl), fontFamily: T.data, textAlign: "right" }}>
          {formatAccountMoney(trade.realizedPnl, trade.currency || currency, true, maskValues)}
        </div>
      ) : (
        <>
          <div>{trade.side || "—"}</div>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {trade.strategyLabel || trade.sourceType || trade.source || "—"}
          </div>
          <div style={{ color: T.textDim }}>
            {formatAppDate(trade.openDate)} {"->"} {formatAppDate(trade.closeDate)}
          </div>
          <div style={{ fontFamily: T.data }}>{formatNumber(trade.quantity, 2)}</div>
          <div style={{ fontFamily: T.data }}>{formatHold(trade.holdDurationMinutes)}</div>
          <div style={{ fontFamily: T.data }}>
            {formatAccountMoney(trade.commissions, currency, true, maskValues)}
          </div>
          <div style={{ color: toneForValue(trade.realizedPnl), fontFamily: T.data }}>
            {formatAccountMoney(trade.realizedPnl, trade.currency || currency, true, maskValues)}
          </div>
          <div style={{ fontFamily: T.data }}>
            {formatAccountPercent(trade.realizedPnlPercent, 1, maskValues)}
          </div>
        </>
      )}
      <Icon as={expanded ? ChevronDown : ChevronRight} context="inline" aria-hidden="true" />
    </div>
  );
  return (
    <TableExpandableRow
      dataTestId="account-analysis-trade-row"
      expanded={expanded}
      onToggle={onToggle}
      rowHeight={isPhone ? 54 : 38}
      expandedHeight={isPhone ? 900 : 760}
      selectionAccent={T.cyan}
      rowClassName="ra-table-row"
      row={row}
      expandedContent={
        <TradeExpandedDetail
          trade={trade}
          tradeId={tradeId}
          currency={currency}
          maskValues={maskValues}
          lifecycleRows={lifecycleRows}
          onJumpToChart={onJumpToChart}
        />
      }
    />
  );
};

const DetailMetric = ({ label, value, tone = T.text }) => (
  <div style={{ minWidth: 0 }}>
    <div
      style={{
        color: T.textDim,
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

const ReasonTrace = ({ lifecycleRows, currency, maskValues }) => {
  const rows = arrayValue(lifecycleRows);
  if (!rows.length) {
    return (
      <DataUnavailableState
        variant="neutral"
        title="No reason trace"
        detail="This trade does not have linked lifecycle events yet."
        minHeight={120}
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: sp(4) }}>
      {rows.map((row) => (
        <div
          key={`${row.key}:${row.at || ""}`}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: sp(6),
            border: `1px solid ${T.borderLight}`,
            borderRadius: dim(RADII.sm),
            background: T.bg0,
            padding: sp("6px 8px"),
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.label }}>
              {row.label}
            </div>
            <div style={{ color: T.textDim, fontSize: textSize("label"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.detail}
            </div>
          </div>
          <div style={{ color: row.tone === "green" ? T.green : row.tone === "red" ? T.red : T.textSec, fontFamily: T.data, textAlign: "right", fontSize: textSize("caption") }}>
            {typeof row.value === "number"
              ? row.key === "result"
                ? formatAccountMoney(row.value, currency, true, maskValues)
                : formatAccountPrice(row.value, 2, maskValues)
              : row.value || (row.at ? formatAppDateTime(row.at) : "—")}
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
        tone={mfe == null ? T.textSec : T.green}
      />
      <DetailMetric
        label="Giveback"
        value={giveback == null ? "—" : formatAccountPercent(giveback, 0, maskValues)}
        tone={giveback == null ? T.textSec : T.amber}
      />
      <DetailMetric
        label="Peak Price"
        value={peak == null ? "—" : formatAccountPrice(peak, 2, maskValues)}
        tone={T.textSec}
      />
      <DetailMetric
        label="Exit"
        value={formatAccountPrice(trade?.avgClose, 2, maskValues)}
        tone={toneForValue(trade?.realizedPnl)}
      />
      <div style={{ color: T.textDim, fontSize: textSize("caption"), lineHeight: 1.35 }}>
        Best continuation and worst follow-through require post-exit bar windows. This account view uses the
        trade-level MFE/giveback fields when continuation bars are unavailable.
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
  onJumpToChart,
}) => (
  <div
    data-testid="account-analysis-trade-expanded"
    style={{
      padding: sp("10px 12px 14px"),
      background: T.bg2,
      borderLeft: `2px solid ${T.cyan}`,
      display: "grid",
      gap: sp(8),
      minWidth: 0,
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: sp(6), flexWrap: "wrap" }}>
      <div style={{ color: T.text, fontFamily: T.sans, fontWeight: FONT_WEIGHTS.label }}>
        {trade.symbol || "Trade"} · {tradeId}
      </div>
      {trade.symbol && onJumpToChart ? (
        <Button size="xs" variant="ghost" onClick={() => onJumpToChart(trade.symbol)}>
          Chart
        </Button>
      ) : null}
    </div>
    <TradePriceChart trade={trade} currency={currency} maskValues={maskValues} />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(138)}px, 1fr))`,
        gap: sp(5),
      }}
    >
      <DetailMetric label="Realized" value={formatAccountMoney(trade.realizedPnl, trade.currency || currency, true, maskValues)} tone={toneForValue(trade.realizedPnl)} />
      <DetailMetric label="Gross" value={formatAccountMoney((finiteNumber(trade.realizedPnl) ?? 0) + Math.abs(finiteNumber(trade.commissions) ?? 0), currency, true, maskValues)} />
      <DetailMetric label="Hold" value={formatHold(trade.holdDurationMinutes)} />
      <DetailMetric label="Quantity" value={formatNumber(trade.quantity, 3)} />
      <DetailMetric label="Entry" value={formatAccountPrice(trade.avgOpen, 2, maskValues)} />
      <DetailMetric label="Exit" value={formatAccountPrice(trade.avgClose, 2, maskValues)} />
      <DetailMetric label="Source" value={trade.sourceType || trade.source || "—"} />
      <DetailMetric label="Strategy" value={trade.strategyLabel || trade.deploymentName || trade.candidateId || "—"} />
      <DetailMetric label="Exit Reason" value={trade.exitReason ? String(trade.exitReason).replaceAll("_", " ") : "—"} />
      <DetailMetric
        label="Contract"
        value={
          trade.optionRight || trade.strike || trade.expirationDate
            ? `${String(trade.optionRight || trade.selectedContract?.right || "option").toUpperCase()} ${trade.strike ?? trade.selectedContract?.strike ?? "strike"} ${trade.expirationDate || trade.selectedContract?.expirationDate || ""}`.trim()
            : "—"
        }
      />
      <DetailMetric label="DTE / Slot" value={`${trade.dte == null ? "—" : formatNumber(trade.dte, 0)} / ${trade.strikeSlot == null ? "—" : formatNumber(trade.strikeSlot, 0)}`} />
      <DetailMetric label="MFE / Giveback" value={`${trade.mfePercent == null ? "—" : formatAccountPercent(trade.mfePercent, 0, maskValues)} / ${trade.givebackPercent == null ? "—" : formatAccountPercent(trade.givebackPercent, 0, maskValues)}`} />
      <DetailMetric label="Regime" value={trade.adx == null && !Array.isArray(trade.mtfDirections) ? "—" : `ADX ${trade.adx == null ? "—" : formatNumber(trade.adx, 1)} · MTF ${Array.isArray(trade.mtfDirections) ? trade.mtfDirections.join("/") : "—"}`} />
      <DetailMetric label="Commissions" value={formatAccountMoney(trade.commissions, currency, true, maskValues)} />
    </div>
    <LifecycleTimeline rows={lifecycleRows} currency={currency} maskValues={maskValues} />
    <div className="ra-account-analysis-card-grid ra-account-analysis-card-grid--two">
      <SectionCard title="Reason Trace" minHeight={150}>
        <ReasonTrace lifecycleRows={lifecycleRows} currency={currency} maskValues={maskValues} />
      </SectionCard>
      <SectionCard title="Exit Consequences" minHeight={150}>
        <ExitConsequences trade={trade} currency={currency} maskValues={maskValues} />
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
  const [page, setPage] = useState(0);
  const sortedRows = useMemo(() => sortTrades(trades, sort), [sort, trades]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sortedRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(0);
  }, [trades]);

  const toggleSort = (key) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  };

  if (query?.isLoading || query?.isPending) {
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
            gridTemplateColumns: "minmax(130px, 1.2fr) minmax(56px, 0.55fr) minmax(118px, 1fr) minmax(150px, 1.15fr) minmax(58px, 0.5fr) minmax(60px, 0.55fr) minmax(78px, 0.7fr) minmax(90px, 0.8fr) minmax(58px, 0.45fr) 26px",
            gap: sp(4),
            padding: sp("6px 10px"),
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: T.bg1,
            borderBottom: `1px solid ${T.border}`,
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            textTransform: "uppercase",
            letterSpacing: 0,
          }}
        >
          {TABLE_COLUMNS.map((column) => (
            <button
              key={column.key}
              type="button"
              className="ra-interactive"
              onClick={() => toggleSort(column.key)}
              style={{
                border: "none",
                background: "transparent",
                color: sort.key === column.key ? T.text : T.textDim,
                textAlign: "left",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                textTransform: "inherit",
                letterSpacing: 0,
              }}
            >
              {column.label}
              {sort.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
            </button>
          ))}
          <span />
        </div>
      ) : null}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: dim(RADII.md), overflow: "hidden", background: T.bg1 }}>
        {pageRows.map((trade) => {
          const tradeId = getAccountTradeId(trade);
          const expanded = Boolean(selectedTradeId && selectedTradeId === tradeId);
          return (
            <TradeRow
              key={tradeId}
              trade={trade}
              expanded={expanded}
              onToggle={() => onTradeSelect?.(expanded ? "" : tradeId)}
              currency={currency}
              maskValues={maskValues}
              lifecycleRows={expanded ? analysis?.lifecycleRows : []}
              onJumpToChart={onJumpToChart}
              isPhone={isPhone}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: sp(5) }}>
        <Button size="xs" variant="ghost" disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
          Previous
        </Button>
        <span style={{ color: T.textDim, fontFamily: T.sans, fontSize: textSize("caption") }}>
          Page {safePage + 1} of {pageCount}
        </span>
        <Button size="xs" variant="ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
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
        .map((trade) => normalizeText(trade?.sourceType, normalizeText(trade?.source)))
        .filter(Boolean),
    ),
  ).sort();

const strategyOptionsForTrades = (trades) =>
  Array.from(
    new Set(
      arrayValue(trades)
        .map((trade) => normalizeText(trade?.strategyLabel, normalizeText(trade?.deploymentName, normalizeText(trade?.candidateId))))
        .filter(Boolean),
    ),
  ).sort();

const HeaderStrip = ({
  range,
  onRangeChange,
  scopeLabel,
  isPhone,
  onOpenFilters,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(6),
      padding: sp("8px 10px"),
      borderBottom: `1px solid ${T.border}`,
      minWidth: 0,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          color: T.text,
          fontFamily: T.sans,
          fontSize: textSize("displaySmall"),
          fontWeight: FONT_WEIGHTS.label,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        Trading Analysis Workbench
      </div>
      <div
        style={{
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {scopeLabel}
      </div>
    </div>
    <div style={{ display: "flex", gap: sp(4), alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
      {isPhone ? (
        <Button
          size="sm"
          variant="tonal"
          leftIcon={<Icon as={Filter} context="control" aria-hidden="true" />}
          onClick={onOpenFilters}
        >
          Filters
        </Button>
      ) : null}
      {!isPhone ? (
        <SegmentedControl
          options={ACCOUNT_RANGES}
          value={range}
          onChange={onRangeChange}
          ariaLabel="Trading analysis range"
          buttonTestId="account-analysis-range"
        />
      ) : (
        <span
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: dim(RADII.pill),
            background: T.bg2,
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            padding: sp("3px 8px"),
          }}
        >
          {range}
        </span>
      )}
    </div>
  </div>
);

const MobileFilterDrawer = ({ open, onClose, children }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trading analysis filters"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)",
      }}
    >
      <div style={{ background: T.bg1, boxShadow: `0 0 0 1px ${T.border}, 0 24px 64px rgba(0,0,0,0.35)`, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sp(4), borderBottom: `1px solid ${T.border}` }}>
          <div style={{ color: T.text, fontFamily: T.sans, fontWeight: FONT_WEIGHTS.label }}>Filters</div>
          <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        style={{ border: "none", background: "rgba(0,0,0,0.35)" }}
      />
    </div>
  );
};

export const TradingAnalysisWorkbench = ({
  query,
  trades = [],
  allTrades = [],
  analysis,
  filters,
  dispatchFilters,
  range,
  onRangeChange,
  currency,
  maskValues,
  selectedTradeId,
  onTradeSelect,
  onJumpToChart,
  isPhone = false,
  nowMs,
}) => {
  const [activeView, setActiveView] = useState(() => {
    try {
      const raw =
        window.localStorage.getItem(PYRUS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_RAYALGO_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed.accountAnalysisView === "trades" ? "trades" : "patterns";
    } catch {
      return "patterns";
    }
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const normalizedFilters = normalizeTradingAnalysisFilters(filters);
  const sourceOptions = useMemo(() => sourceOptionsForTrades(allTrades), [allTrades]);
  const strategyOptions = useMemo(() => strategyOptionsForTrades(allTrades), [allTrades]);
  const visibleTrades = useMemo(
    () => filterAccountAnalysisTrades({ trades, filters: normalizedFilters, range, nowMs }),
    [filters, normalizedFilters, nowMs, range, trades],
  );
  const scopedAnalysis = analysis;
  const scopeLabel = buildTradingAnalysisScopeLabel({
    filters: normalizedFilters,
    range,
    tradeCount: visibleTrades.length,
    totalTradeCount: arrayValue(allTrades).length,
    nowMs,
  });

  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem(PYRUS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_RAYALGO_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      window.localStorage.setItem(
        PYRUS_STORAGE_KEY,
        JSON.stringify({ ...parsed, accountAnalysisView: activeView }),
      );
    } catch {}
  }, [activeView]);

  const clearAll = () => {
    dispatchFilters({ type: "reset" });
    onTradeSelect?.("");
  };

  const applyLens = (lens) => {
    if (!lens?.kind) return;
    const input = lens.input || {};
    if (lens.kind === "symbol") dispatchFilters({ type: "patch", patch: { symbol: input.symbol || "" } });
    else if (lens.kind === "pnl") dispatchFilters({ type: "patch", patch: { pnlSign: input.pnlSign || "all" } });
    else if (lens.kind === "holdDuration") dispatchFilters({ type: "patch", patch: { holdDurations: [input.holdDuration].filter(Boolean) } });
    else if (lens.kind === "feeDrag") dispatchFilters({ type: "patch", patch: { feeDrags: [input.feeDrag].filter(Boolean) } });
    else if (lens.kind === "side") dispatchFilters({ type: "patch", patch: { side: input.side || "all" } });
    else if (lens.kind === "assetClass") dispatchFilters({ type: "patch", patch: { assetClass: input.assetClass || "all" } });
    else if (lens.kind === "strategy") dispatchFilters({ type: "patch", patch: { strategy: input.strategy || "all" } });
    else if (lens.kind === "source") dispatchFilters({ type: "patch", patch: { sourceType: input.sourceType || "all" } });
  };

  const handleRangeChange = (nextRange) => {
    dispatchFilters({ type: "clearDateRange" });
    onRangeChange?.(nextRange);
  };

  return (
    <Panel
      title="Trading Analysis"
      rightRail="Workbench"
      minHeight={360}
      loading={false}
      error={query?.error}
      onRetry={query?.refetch}
      noPad
    >
      <div data-testid="account-trading-analysis-workbench" style={{ display: "grid", minWidth: 0 }}>
        <HeaderStrip
          range={range}
          onRangeChange={handleRangeChange}
          scopeLabel={scopeLabel}
          isPhone={isPhone}
          onOpenFilters={() => setFiltersOpen(true)}
        />
        <ActiveChips filters={normalizedFilters} dispatch={dispatchFilters} onClearAll={clearAll} />
        <KpiStrip
          trades={visibleTrades}
          currency={currency}
          maskValues={maskValues}
          loading={query?.isLoading || query?.isPending}
        />
        <InsightsRow
          analysis={scopedAnalysis}
          currency={currency}
          maskValues={maskValues}
          onLensActivate={applyLens}
          onTradeSelect={onTradeSelect}
        />
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: T.bg0,
            borderTop: `1px solid ${T.borderLight}`,
            borderBottom: `1px solid ${T.border}`,
            padding: sp("6px 10px"),
          }}
        >
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={activeView}
            onChange={setActiveView}
            ariaLabel="Trading analysis view"
            buttonTestId="account-analysis-view"
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isPhone ? "minmax(0, 1fr)" : `${dim(240)}px minmax(0, 1fr)`,
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
          <main style={{ minWidth: 0, background: T.bg0 }}>
            {activeView === "patterns" ? (
              <PatternsView
                trades={visibleTrades}
                analysis={scopedAnalysis}
                currency={currency}
                maskValues={maskValues}
                loading={query?.isLoading || query?.isPending}
                onLensActivate={applyLens}
                onTradeSelect={onTradeSelect}
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
        <MobileFilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)}>
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
