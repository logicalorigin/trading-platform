import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { T, dim, sp, textSize } from "../../lib/uiTokens";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  secondaryButtonStyle,
  toneForValue,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";


const SORT_OPTIONS = [
  { value: "realizedPnl", label: "P&L" },
  { value: "expectancy", label: "Exp" },
  { value: "winRatePercent", label: "Win" },
  { value: "closedTrades", label: "Trades" },
];

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const arrayValue = (value) => (Array.isArray(value) ? value : []);

const PatternMetric = ({ label, value, tone = T.text }) => (
  <div
    style={{
      border: `1px solid ${T.border}`,
      borderRadius: dim(4),
      background: T.bg0,
      padding: sp("5px 6px"),
      minWidth: 0,
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontWeight: 900,
        fontSize: textSize("metric"),
        lineHeight: 1.15,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
  </div>
);

const toneColor = (tone) =>
  tone === "green"
    ? T.green
    : tone === "red"
      ? T.red
      : tone === "amber"
        ? T.amber
        : tone === "cyan"
          ? T.cyan
          : tone === "pink"
            ? T.pink
            : T.textSec;

const AnalysisCard = ({
  card,
  currency,
  maskValues,
  onActivate,
}) => {
  if (!card) return null;
  const color = toneColor(card.tone);
  const disabled = card.disabled || !card.tradeId;
  return (
    <button
      type="button"
      className="ra-interactive"
      disabled={disabled}
      onClick={() => onActivate?.(card)}
      style={{
        border: `1px solid ${color}55`,
        borderRadius: dim(5),
        background: `${color}12`,
        padding: sp("6px 7px"),
        textAlign: "left",
        display: "grid",
        gap: sp(3),
        color: T.textSec,
        minWidth: 0,
        opacity: disabled ? 0.76 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(6),
          alignItems: "center",
        }}
      >
        <span
          style={{
            color,
            fontFamily: T.data,
            fontWeight: 900,
            fontSize: textSize("control"),
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.label}
        </span>
        <span style={{ color: toneForValue(card.value), fontFamily: T.data, fontWeight: 900 }}>
          {formatAccountMoney(card.value, currency, true, maskValues)}
        </span>
      </div>
      <div style={{ fontSize: textSize("caption"), lineHeight: 1.3 }}>
        {card.symbol ? `${card.symbol} · ` : ""}
        {card.description}
      </div>
      {card.meta ? (
        <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
          {formatNumber(card.meta.count || 0, 0)} trades ·{" "}
          {formatAccountPercent(card.meta.winRatePercent, 0, maskValues)}
        </div>
      ) : disabled ? (
        <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
          Waiting for ledger data
        </div>
      ) : null}
    </button>
  );
};

const readinessTone = (state) =>
  state === "ready" ? T.green : state === "waiting" ? T.amber : T.textDim;

const AnalysisReadinessStrip = ({ readiness = [] }) => {
  const rows = arrayValue(readiness);
  if (!rows.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
        gap: sp(4),
      }}
    >
      {rows.map((row) => {
        const color = readinessTone(row.state);
        return (
          <div
            key={row.key}
            style={{
              border: `1px solid ${color}44`,
              borderRadius: dim(4),
              background: `${color}0f`,
              padding: sp("4px 5px"),
              display: "grid",
              gap: sp(1),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(5),
                minWidth: 0,
              }}
            >
              <span style={{ ...mutedLabelStyle, color }}>{row.label}</span>
              <span style={{ color, fontFamily: T.data, fontSize: textSize("label"), fontWeight: 900 }}>
                {formatNumber(row.value || 0, 0)}
              </span>
            </div>
            <div
              style={{
                color: T.textDim,
                fontFamily: T.data,
                fontSize: textSize("label"),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const lensInputForBucket = (group) => {
  if (!group) return {};
  if (group.kind === "side") return { side: group.key };
  if (group.kind === "holdDuration") return { holdDuration: group.key };
  if (group.kind === "feeDrag") return { feeDrag: group.key };
  if (group.kind === "strategy") return { strategy: group.key, label: group.label };
  if (group.kind === "assetClass") return { assetClass: group.key };
  return {};
};

const lensMatchesBucket = (lens, group) => {
  if (!lens || !group || lens.kind !== group.kind) return false;
  if (group.kind === "side") return lens.side === group.key;
  if (group.kind === "holdDuration") return lens.holdDuration === group.key;
  if (group.kind === "feeDrag") return lens.feeDrag === group.key;
  if (group.kind === "strategy") return lens.strategy === group.key;
  if (group.kind === "assetClass") return lens.assetClass === group.key;
  return false;
};

const BucketDrilldownStrip = ({
  groups = [],
  currency,
  maskValues,
  selectedLens,
  onLensChange,
}) => {
  const rows = arrayValue(groups).filter((group) => group?.count).slice(0, 8);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={mutedLabelStyle}>BUCKET DRILLDOWN</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: sp(4),
        }}
      >
        {rows.map((group) => {
          const active = lensMatchesBucket(selectedLens, group);
          const pnlTone = toneForValue(group.realizedPnl);
          return (
            <button
              type="button"
              key={`${group.kind}:${group.key}`}
              className="ra-interactive"
              onClick={() => onLensChange?.(group.kind, lensInputForBucket(group))}
              style={{
                border: `1px solid ${active ? T.cyan : T.border}`,
                borderRadius: dim(4),
                background: active ? `${T.cyan}14` : T.bg0,
                padding: sp("5px 6px"),
                display: "grid",
                gap: sp(2),
                minWidth: 0,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: sp(5),
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: active ? T.cyan : T.text,
                    fontFamily: T.data,
                    fontSize: textSize("control"),
                    fontWeight: 900,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {group.label}
                </span>
                <span style={{ color: pnlTone, fontFamily: T.data, fontSize: textSize("label"), fontWeight: 900 }}>
                  {formatAccountMoney(group.realizedPnl, currency, true, maskValues)}
                </span>
              </div>
              <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
                {formatNumber(group.count, 0)} trades ·{" "}
                {formatAccountPercent(group.winRatePercent, 0, maskValues)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const EMPTY_ANALYSIS_CARDS = [
  {
    key: "empty-best-winner",
    label: "Best Winner",
    description: "Waiting for closed trades",
    value: null,
    tone: "green",
    disabled: true,
  },
  {
    key: "empty-worst-loss",
    label: "Worst Loss",
    description: "Waiting for closed trades",
    value: null,
    tone: "red",
    disabled: true,
  },
  {
    key: "empty-fee-drag",
    label: "Fee Drag",
    description: "Waiting for commissions",
    value: null,
    tone: "amber",
    disabled: true,
  },
  {
    key: "empty-weak-bucket",
    label: "Weak Bucket",
    description: "Waiting for repeat patterns",
    value: null,
    tone: "cyan",
    disabled: true,
  },
];

const PatternTooltip = ({ active, payload, currency, maskValues }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div
      style={{
        background: T.bg0,
        border: `1px solid ${T.border}`,
        borderRadius: dim(4),
        padding: sp(6),
        color: T.text,
        fontSize: textSize("caption"),
        fontFamily: T.data,
      }}
    >
      <div style={{ fontWeight: 900 }}>{row.symbol || row.hour || row.weekday || row.label}</div>
      <div style={{ color: toneForValue(row.realizedPnl) }}>
        {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
      </div>
      <div style={{ color: T.textSec }}>
        {formatNumber(row.closedTrades || 0, 0)} trades ·{" "}
        {formatAccountPercent(row.winRatePercent, 0, maskValues)}
      </div>
    </div>
  );
};

const TickerRows = ({
  rows,
  currency,
  maskValues,
  onSymbolSelect,
  selectedSymbol,
}) => (
  <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: dim(220) }}>
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: dim(720) }}>
      <thead>
        <tr
          style={{
            color: T.textMuted,
            fontFamily: T.data,
            fontSize: textSize("tableHeader"),
            textTransform: "uppercase",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          {["Symbol", "P&L", "Win", "Exp", "PF", "Trades", "Hold", "Open"].map((column) => (
            <th key={column} style={{ padding: sp("4px 5px"), textAlign: "left" }}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.symbol}
            className="ra-table-row"
            style={{
              background:
                selectedSymbol && row.symbol === selectedSymbol
                  ? `${T.cyan}14`
                  : "transparent",
            }}
          >
            <td style={{ padding: sp("5px"), color: T.text, fontFamily: T.data, fontWeight: 900 }}>
              <button
                type="button"
                onClick={() => onSymbolSelect?.(row.symbol)}
                className="ra-interactive"
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.cyan,
                  fontFamily: T.data,
                  fontWeight: 900,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {row.symbol}
              </button>
            </td>
            <td style={{ padding: sp("5px"), color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
              {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatAccountPercent(row.winRatePercent, 0, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: toneForValue(row.expectancy), fontFamily: T.data }}>
              {formatAccountMoney(row.expectancy, currency, true, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {row.profitFactor == null ? "----" : formatNumber(row.profitFactor, 2)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatNumber(row.closedTrades || 0, 0)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {row.averageHoldMinutes == null
                ? "----"
                : `${formatNumber(row.averageHoldMinutes / 60, 1)}h`}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatNumber(row.openQuantity || 0, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const TradingPatternsPanel = ({
  query,
  snapshotMutation,
  accountId,
  range,
  currency,
  maskValues = false,
  onSymbolSelect,
  selectedLens,
  onLensChange,
  analysis,
  onTradeSelect,
}) => {
  const [sortKey, setSortKey] = useState("realizedPnl");
  const packet = query.data || {};
  const summary = packet.summary || {};
  const snapshot = packet.snapshot || {};
  const tickerRows = useMemo(() => {
    const rows = arrayValue(packet.tickerStats);
    return [...rows].sort((left, right) => {
      const delta = (finiteNumber(right?.[sortKey]) ?? 0) - (finiteNumber(left?.[sortKey]) ?? 0);
      return delta || String(left?.symbol || "").localeCompare(String(right?.symbol || ""));
    });
  }, [packet.tickerStats, sortKey]);
  const topRows = tickerRows.slice(0, 8);
  const worstRows = [...tickerRows]
    .sort((left, right) => (finiteNumber(left?.realizedPnl) ?? 0) - (finiteNumber(right?.realizedPnl) ?? 0))
    .slice(0, 6);
  const sourceRows = arrayValue(packet.sourceStats).slice(0, 5);
  const hourRows = arrayValue(packet.timeStats?.byHour).map((row) => ({
    ...row,
    label: row.hour,
  }));
  const chartRows = topRows.map((row) => ({
    symbol: row.symbol,
    realizedPnl: finiteNumber(row.realizedPnl) ?? 0,
    closedTrades: finiteNumber(row.closedTrades) ?? 0,
    winRatePercent: finiteNumber(row.winRatePercent),
  }));
  const loading = query.isLoading || query.isPending;
  const refreshing = snapshotMutation?.isPending;
  const selectedSymbol = selectedLens?.symbol || "";
  const selectedSourceType = selectedLens?.sourceType || "all";
  const selectedCloseHour = selectedLens?.closeHour ?? null;
  const bestTrade = summary.bestTrade || null;
  const worstTrade = summary.worstTrade || null;
  const selectSymbol = (symbol) => {
    onSymbolSelect?.(symbol);
    onLensChange?.("symbol", { symbol });
  };
  const activateAnalysisCard = (card) => {
    if (card?.disabled) return;
    if (card?.lens?.kind) {
      onLensChange?.(card.lens.kind, card.lens.input || {});
    }
    if (card?.tradeId) {
      onTradeSelect?.(card.tradeId);
    }
  };
  const representativeCards = arrayValue(analysis?.representativeTrades).slice(0, 4);
  const issueCards = arrayValue(analysis?.issueCards).slice(0, 5);
  const analysisCards = representativeCards.length || issueCards.length
    ? [...representativeCards, ...issueCards]
    : EMPTY_ANALYSIS_CARDS;
  const readinessRows = arrayValue(analysis?.readiness);
  const drilldownGroups = [
    ...arrayValue(analysis?.bucketGroups?.side),
    ...arrayValue(analysis?.bucketGroups?.holdDuration),
    ...arrayValue(analysis?.bucketGroups?.feeDrag),
    ...arrayValue(analysis?.bucketGroups?.strategy),
  ]
    .filter((group) => group?.key && group.key !== "unknown")
    .sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0));
  const panelEmptyBody = snapshotMutation
    ? "Persist or refresh a Shadow analysis snapshot after trades or a watchlist backtest."
    : "Closed trades will populate account trading analysis once Flex or broker history is available.";

  return (
    <Panel
      title="Trading Analysis"
      rightRail={
        loading
          ? "Loading analysis packet"
          : snapshot.persisted
          ? `Snapshot ${formatAppDateTime(snapshot.createdAt)}`
          : `Live packet · ${formatNumber(summary.closedTrades || summary.count || 0, 0)} closed trades`
      }
      loading={loading}
      error={query.error || snapshotMutation?.error}
      onRetry={query.refetch}
      minHeight={270}
      action={
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", alignItems: "center" }}>
          <ToggleGroup options={SORT_OPTIONS} value={sortKey} onChange={setSortKey} />
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onLensChange?.("pnl", { pnlSign: "winners" })}
            style={{
              ...secondaryButtonStyle,
              color: selectedLens?.pnlSign === "winners" ? T.green : T.textSec,
              borderColor: selectedLens?.pnlSign === "winners" ? T.green : T.border,
            }}
          >
            Winners
          </button>
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onLensChange?.("pnl", { pnlSign: "losers" })}
            style={{
              ...secondaryButtonStyle,
              color: selectedLens?.pnlSign === "losers" ? T.red : T.textSec,
              borderColor: selectedLens?.pnlSign === "losers" ? T.red : T.border,
            }}
          >
            Losers
          </button>
          {snapshotMutation ? (
            <button
              type="button"
              className="ra-interactive"
              disabled={refreshing}
              onClick={() =>
                snapshotMutation.mutate({
                  accountId,
                  data: { range },
                })
              }
              style={{
                ...secondaryButtonStyle,
                color: refreshing ? T.textMuted : T.pink,
                borderColor: refreshing ? T.border : T.pink,
                cursor: refreshing ? "wait" : "pointer",
              }}
            >
              {refreshing ? "Refreshing" : "Snapshot"}
            </button>
          ) : null}
        </div>
      }
    >
      <div style={{ display: "grid", gap: sp(7) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: sp(5),
          }}
        >
          {analysisCards.map((card) => (
            <AnalysisCard
              key={card.key}
              card={card}
              currency={currency}
              maskValues={maskValues}
              onActivate={activateAnalysisCard}
            />
          ))}
        </div>

        <AnalysisReadinessStrip readiness={readinessRows} />

        <BucketDrilldownStrip
          groups={drilldownGroups}
          currency={currency}
          maskValues={maskValues}
          selectedLens={selectedLens}
          onLensChange={onLensChange}
        />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))",
              gap: sp(4),
            }}
          >
            <PatternMetric label="Trades" value={formatNumber(summary.closedTrades || 0, 0)} />
            <PatternMetric
              label="P&L"
              value={formatAccountMoney(summary.realizedPnl, currency, true, maskValues)}
              tone={toneForValue(summary.realizedPnl)}
            />
            <PatternMetric
              label="Win"
              value={formatAccountPercent(summary.winRatePercent, 0, maskValues)}
              tone={T.green}
            />
            <PatternMetric
              label="Exp"
              value={formatAccountMoney(summary.expectancy, currency, true, maskValues)}
              tone={toneForValue(summary.expectancy)}
            />
            <PatternMetric
              label="PF"
              value={summary.profitFactor == null ? "----" : formatNumber(summary.profitFactor, 2)}
              tone={T.cyan}
            />
            <PatternMetric label="Events" value={formatNumber(summary.tradeEvents || 0, 0)} tone={T.purple} />
            <PatternMetric label="Open Lots" value={formatNumber(summary.openLots || 0, 0)} tone={T.cyan} />
            <PatternMetric
              label="Anomalies"
              value={formatNumber(summary.anomalies || 0, 0)}
              tone={(summary.anomalies || 0) ? T.amber : T.textSec}
            />
          </div>

        {!tickerRows.length ? (
          <div
            style={{
              border: `1px dashed ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp(10),
            }}
          >
            <EmptyState
              title="No trading analysis yet"
              body={panelEmptyBody}
            />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: sp(7),
            }}
          >
            <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
              <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", alignItems: "center" }}>
                <Pill tone="green">Best Tickers</Pill>
                <Pill tone="red">Worst {worstRows[0]?.symbol || "----"}</Pill>
                <Pill tone="purple">{formatNumber(summary.symbolsTraded || 0, 0)} symbols</Pill>
              </div>
              <div style={{ width: "100%", height: dim(130) }}>
                <ResponsiveContainer>
                  <BarChart data={chartRows} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="symbol" tick={{ fill: T.textMuted, fontSize: textSize("tableCell") }} stroke={T.border} />
                    <YAxis
                      tick={{ fill: T.textMuted, fontSize: textSize("tableCell") }}
                      stroke={T.border}
                      tickFormatter={(value) => formatAccountMoney(value, currency, true, maskValues)}
                      width={48}
                    />
                    <Tooltip content={<PatternTooltip currency={currency} maskValues={maskValues} />} />
                    <Bar dataKey="realizedPnl" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {chartRows.map((row) => (
                        <Cell key={row.symbol} fill={(row.realizedPnl ?? 0) >= 0 ? T.green : T.red} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <TickerRows
                rows={topRows}
                currency={currency}
                maskValues={maskValues}
                onSymbolSelect={selectSymbol}
                selectedSymbol={selectedSymbol}
              />
            </div>

            <div style={{ display: "grid", gap: sp(5), alignContent: "start" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: sp(4),
                }}
              >
                <PatternMetric
                  label={`Best ${bestTrade?.symbol || "----"}`}
                  value={formatAccountMoney(bestTrade?.realizedPnl, currency, true, maskValues)}
                  tone={toneForValue(bestTrade?.realizedPnl)}
                />
                <PatternMetric
                  label={`Worst ${worstTrade?.symbol || "----"}`}
                  value={formatAccountMoney(worstTrade?.realizedPnl, currency, true, maskValues)}
                  tone={toneForValue(worstTrade?.realizedPnl)}
                />
              </div>
              <div style={{ display: "grid", gap: sp(3) }}>
                <div style={mutedLabelStyle}>SOURCE BREAKDOWN</div>
                {sourceRows.map((row) => (
                  <button
                    type="button"
                    key={row.key || row.label}
                    onClick={() => onLensChange?.("source", row)}
                    className="ra-interactive"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: sp(4),
                      border: `1px solid ${
                        selectedSourceType !== "all" && selectedSourceType === row.sourceType
                          ? T.pink
                          : T.border
                      }`,
                      borderRadius: dim(4),
                      background:
                        selectedSourceType !== "all" && selectedSourceType === row.sourceType
                          ? `${T.pink}14`
                          : "transparent",
                      padding: sp("4px 5px"),
                      color: T.textSec,
                      fontFamily: T.data,
                      fontSize: textSize("tableCell"),
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.label || row.sourceType}
                    </span>
                    <span style={{ color: toneForValue(row.realizedPnl), fontWeight: 900 }}>
                      {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gap: sp(3) }}>
                <div style={mutedLabelStyle}>CLOSE HOUR HEAT</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: sp(2) }}>
                  {hourRows.map((row) => (
                    <AppTooltip key={row.hour} content={`${row.hour}:00 ${formatAccountMoney(row.realizedPnl, currency, true, maskValues)}`}><button
                      type="button"
                      key={row.hour}
                      onClick={() => onLensChange?.("hour", row)}
                      className="ra-interactive"
                      style={{
                        minHeight: dim(22),
                        border: `1px solid ${
                          selectedCloseHour === row.hour
                            ? T.cyan
                            : (row.realizedPnl ?? 0) >= 0
                              ? `${T.green}55`
                              : `${T.red}55`
                        }`,
                        borderRadius: dim(3),
                        background:
                          selectedCloseHour === row.hour
                            ? `${T.cyan}18`
                            : (row.realizedPnl ?? 0) >= 0
                              ? `${T.green}18`
                              : `${T.red}18`,
                        color: (row.realizedPnl ?? 0) >= 0 ? T.green : T.red,
                        display: "grid",
                        placeItems: "center",
                        fontFamily: T.data,
                        fontSize: textSize("label"),
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      {row.hour}
                    </button></AppTooltip>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gap: sp(3) }}>
                <div style={mutedLabelStyle}>WORST TICKERS</div>
                {worstRows.slice(0, 4).map((row) => (
                  <button
                    type="button"
                    key={row.symbol}
                    onClick={() => selectSymbol(row.symbol)}
                    className="ra-interactive"
                    style={{
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(4),
                      background: T.bg0,
                      padding: sp("4px 5px"),
                      display: "flex",
                      justifyContent: "space-between",
                      gap: sp(5),
                      color: T.textSec,
                      fontFamily: T.data,
                      fontSize: textSize("tableCell"),
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ color: T.cyan, fontWeight: 900 }}>{row.symbol}</span>
                    <span style={{ color: toneForValue(row.realizedPnl), fontWeight: 900 }}>
                      {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
};

export default TradingPatternsPanel;
