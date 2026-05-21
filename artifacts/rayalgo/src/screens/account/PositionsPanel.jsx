import { Fragment, memo, useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, LineChart } from "lucide-react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import {
  getStoredOptionQuoteSnapshot,
  useIbkrOptionQuoteStream,
  useStoredOptionQuoteSnapshotVersion,
} from "../../features/platform/live-streams";
import { FONT_WEIGHTS, MISSING_VALUE, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  cellSubTextStyle,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountPrice,
  formatAccountSignedMoney,
  formatNumber,
  moveTableFocus,
  mutedLabelStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";
import { Button, MicroSparkline } from "../../components/platform/primitives.jsx";
import { getOpenPositionRows } from "../../features/account/accountPositionRows.js";
import { useRuntimeTickerSnapshots } from "../../features/platform/runtimeTickerStore";
import {
  SPARKLINE_RENDER_POINT_LIMIT,
  TABLE_SPARKLINE_COMPACT_HEIGHT,
  TABLE_SPARKLINE_COMPACT_WIDTH,
  TABLE_SPARKLINE_HEIGHT,
  TABLE_SPARKLINE_WIDTH,
  buildDetailedFallbackSparklineData,
} from "../../features/platform/sparklineConfig";
import { normalizeTickerSymbol } from "../../features/platform/tickerIdentity";
import { buildPositionsAtDateInspectorState } from "./positionsAtDateInspectorModel.js";
import { AppTooltip } from "@/components/ui/tooltip";

const ASSET_FILTERS = [
  { value: "all", label: "All" },
  { value: "Stocks", label: "Stock" },
  { value: "ETF", label: "ETF" },
  { value: "Options", label: "Option" },
];

const SOURCE_FILTERS = [
  { value: "all", label: "All Sources" },
  { value: "manual", label: "Manual" },
  { value: "automation", label: "Automation" },
  { value: "watchlist_backtest", label: "Watchlist BT" },
  { value: "mixed", label: "Mixed" },
];

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "category-automation"
    : sourceType === "watchlist_backtest"
      ? "category-backtest"
      : sourceType === "mixed"
        ? "category-mixed"
        : "default";

const compactKeyPart = (value) => String(value ?? "").trim();

const positionOpenOrderKey = (rowId, order, index) =>
  [
    rowId,
    order?.id,
    order?.accountId,
    order?.symbol,
    order?.side,
    order?.type,
    order?.placedAt,
    index,
  ]
    .map(compactKeyPart)
    .filter(Boolean)
    .join(":");

const positionSourceAttributionKey = (rowId, source, index) =>
  [
    rowId,
    source?.candidateId,
    source?.sourceEventId,
    source?.sourceType,
    source?.quantity,
    index,
  ]
    .map(compactKeyPart)
    .filter(Boolean)
    .join(":");

const headerCellStyle = (active) => ({
  ...tableCellStyle,
  ...tableHeaderStyle,
  color: active ? T.accent : T.textSec,
});

const SortButton = ({ id, label, sort, setSort, align = "right" }) => (
  <button
    type="button"
    onClick={() =>
      setSort((current) => ({
        id,
        dir: current.id === id && current.dir === "desc" ? "asc" : "desc",
      }))
    }
    style={{
      border: "none",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      cursor: "pointer",
      textTransform: "inherit",
      letterSpacing: "inherit",
      width: "100%",
      textAlign: align,
      padding: 0,
    }}
  >
    {label} {sort.id === id ? (sort.dir === "desc" ? "▼" : "▲") : ""}
  </button>
);

const lotColumns = ["Account", "Qty", "Avg Cost", "Market Value", "Unrealized"];

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null) return numeric;
  }
  return null;
};

const firstPositiveFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null && numeric > 0) return numeric;
  }
  return null;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const isInternalOptionIdentifier = (value) =>
  /^twsopt:/i.test(String(value ?? "").trim());

const firstDisplayText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !isInternalOptionIdentifier(text)) return text;
  }
  return "";
};

const optionProviderContractId = (contract) =>
  String(contract?.providerContractId || contract?.conid || "").trim();

const formatOptionRightLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") return "CALL";
  if (normalized === "put" || normalized === "p") return "PUT";
  return normalized ? normalized.toUpperCase() : MISSING_VALUE;
};

const compactOptionDate = (year, month, day) => {
  const shortYear = String(year).slice(-2).padStart(2, "0");
  return `${Number(month)}/${Number(day)}/${shortYear}`;
};

const formatOptionExpiryLabel = (value) => {
  const text = firstText(value);
  if (!text) return "";

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoDate) {
    return compactOptionDate(isoDate[1], isoDate[2], isoDate[3]);
  }

  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compactDate) {
    return compactOptionDate(compactDate[1], compactDate[2], compactDate[3]);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return compactOptionDate(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth() + 1,
      parsed.getUTCDate(),
    );
  }

  return text;
};

const optionContractLabel = (contract) => {
  const underlying = firstDisplayText(contract?.underlying, contract?.symbol);
  const expiry = formatOptionExpiryLabel(
    firstText(contract?.expirationDate, contract?.exp, contract?.expiry),
  );
  const strike = contract?.strike == null ? "" : formatNumber(contract.strike, 4);
  const right = formatOptionRightLabel(contract?.right || contract?.cp);
  return [underlying, expiry, strike, right]
    .filter((value) => value && value !== MISSING_VALUE)
    .join(" ") || MISSING_VALUE;
};

const formatOptionPrice = (value, maskValues) =>
  value == null ? MISSING_VALUE : formatAccountPrice(value, 2, maskValues);

const formatQuoteBidAsk = (quote, maskValues) => {
  const bid = firstFiniteNumber(quote?.bid);
  const ask = firstFiniteNumber(quote?.ask);
  if (bid == null && ask == null) return MISSING_VALUE;
  return `${formatOptionPrice(bid, maskValues)} / ${formatOptionPrice(ask, maskValues)}`;
};

const quoteMid = (quote) => {
  const bid = firstFiniteNumber(quote?.bid);
  const ask = firstFiniteNumber(quote?.ask);
  return bid != null && ask != null && bid > 0 && ask > 0
    ? (bid + ask) / 2
    : null;
};

const liveQuoteChangeFieldsAreUsable = (liveQuote) => {
  const price = firstPositiveFiniteNumber(
    liveQuote?.mark,
    liveQuote?.mid,
    liveQuote?.last,
    liveQuote?.price,
    quoteMid(liveQuote),
  );
  if (price == null) return false;

  const change = firstFiniteNumber(
    liveQuote?.dayChange,
    liveQuote?.change,
    liveQuote?.netChange,
  );
  const changePercent = firstFiniteNumber(
    liveQuote?.dayChangePercent,
    liveQuote?.changePercent,
    liveQuote?.percentChange,
  );
  if (change == null || changePercent == null) return true;

  const previous = price - change;
  if (!Number.isFinite(previous) || previous <= 0) return false;
  const impliedPercent = (change / previous) * 100;
  const tolerance = Math.max(2, Math.abs(changePercent) * 0.05);
  return Math.abs(impliedPercent - changePercent) <= tolerance;
};

const mergeLiveOptionQuote = (quote, liveQuote) => {
  if (!liveQuote) return quote || null;
  const current = quote || {};
  const liveHasUsableChange = liveQuoteChangeFieldsAreUsable(liveQuote);
  const bid = firstPositiveFiniteNumber(liveQuote.bid, current.bid);
  const ask = firstPositiveFiniteNumber(liveQuote.ask, current.ask);
  const last = firstPositiveFiniteNumber(
    liveQuote.last,
    liveQuote.price,
    current.last,
    current.price,
  );
  const mid = firstPositiveFiniteNumber(liveQuote.mid, current.mid, quoteMid({ bid, ask }));
  return {
    ...current,
    bid,
    ask,
    mid,
    last,
    price: firstPositiveFiniteNumber(
      liveQuote.price,
      liveQuote.last,
      current.price,
      current.last,
    ),
    mark: firstPositiveFiniteNumber(
      liveQuote.mark,
      mid,
      liveQuote.price,
      liveQuote.last,
      current.mark,
    ),
    dayChange: liveHasUsableChange
      ? firstFiniteNumber(
          liveQuote.dayChange,
          liveQuote.change,
          liveQuote.netChange,
          current.dayChange,
        )
      : current.dayChange,
    dayChangePercent: liveHasUsableChange
      ? firstFiniteNumber(
          liveQuote.dayChangePercent,
          liveQuote.changePercent,
          liveQuote.percentChange,
          current.dayChangePercent,
        )
      : current.dayChangePercent,
    impliedVolatility: firstFiniteNumber(liveQuote.impliedVolatility, current.impliedVolatility),
    delta: firstFiniteNumber(liveQuote.delta, current.delta),
    gamma: firstFiniteNumber(liveQuote.gamma, current.gamma),
    theta: firstFiniteNumber(liveQuote.theta, current.theta),
    vega: firstFiniteNumber(liveQuote.vega, current.vega),
    openInterest: firstFiniteNumber(liveQuote.openInterest, current.openInterest),
    volume: firstFiniteNumber(liveQuote.volume, current.volume),
    quoteFreshness: firstText(liveQuote.freshness, current.quoteFreshness, current.freshness),
    marketDataMode: firstText(liveQuote.marketDataMode, current.marketDataMode),
    quoteUpdatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, current.quoteUpdatedAt),
    dataUpdatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, current.dataUpdatedAt),
    updatedAt: firstText(liveQuote.updatedAt, current.updatedAt),
  };
};

const applyLiveOptionQuoteToRow = (row, liveQuote) => {
  if (!liveQuote) return row;
  const optionQuote = mergeLiveOptionQuote(row.optionQuote, liveQuote);
  const mark = firstFiniteNumber(
    optionQuote?.mark,
    optionQuote?.mid,
    quoteMid(optionQuote),
    optionQuote?.last,
    optionQuote?.price,
    row.mark,
  );
  const quantity = firstFiniteNumber(row.quantity);
  const averageCost = firstFiniteNumber(row.averageCost);
  const multiplier = firstFiniteNumber(
    row.optionContract?.multiplier,
    row.optionContract?.sharesPerContract,
    100,
  );
  const marketValue =
    mark != null && quantity != null && multiplier != null
      ? mark * quantity * multiplier
      : row.marketValue;
  const unrealizedPnl =
    mark != null && averageCost != null && quantity != null && multiplier != null
      ? (mark - averageCost) * quantity * multiplier
      : row.unrealizedPnl;
  const costBasis =
    averageCost != null && quantity != null && multiplier != null
      ? Math.abs(averageCost * quantity * multiplier)
      : null;
  const perContractDayChange = firstFiniteNumber(optionQuote?.dayChange);
  const dayChange =
    perContractDayChange != null && quantity != null && multiplier != null
      ? perContractDayChange * quantity * multiplier
      : row.dayChange;
  const delta = firstFiniteNumber(optionQuote?.delta);

  return {
    ...row,
    optionQuote,
    mark,
    dayChange,
    dayChangePercent: firstFiniteNumber(optionQuote?.dayChangePercent, row.dayChangePercent),
    unrealizedPnl,
    unrealizedPnlPercent:
      unrealizedPnl != null && costBasis
        ? (unrealizedPnl / costBasis) * 100
        : row.unrealizedPnlPercent,
    marketValue,
    betaWeightedDelta:
      delta != null && quantity != null && multiplier != null
        ? delta * quantity * multiplier
        : row.betaWeightedDelta,
  };
};

const buildDisplayTotals = (rows, fallbackTotals) => {
  if (!rows.length) {
    return fallbackTotals || {};
  }
  return rows.reduce(
    (acc, row) => {
      const marketValue = firstFiniteNumber(row.marketValue);
      const unrealizedPnl = firstFiniteNumber(row.unrealizedPnl);
      const dayChange = firstFiniteNumber(row.dayChange);
      if (marketValue != null) {
        acc.netExposure += marketValue;
        if (marketValue >= 0) acc.grossLong += marketValue;
        else acc.grossShort += marketValue;
      }
      if (unrealizedPnl != null) acc.unrealizedPnl += unrealizedPnl;
      if (dayChange != null) acc.dayChange += dayChange;
      return acc;
    },
    {
      netExposure: 0,
      grossLong: 0,
      grossShort: 0,
      unrealizedPnl: 0,
      dayChange: 0,
      weightPercent: rows.length ? 100 : null,
    },
  );
};

const applyDisplayWeights = (rows) => {
  const totalAbsMarketValue = rows.reduce(
    (sum, row) => sum + Math.abs(firstFiniteNumber(row.marketValue) ?? 0),
    0,
  );
  if (totalAbsMarketValue <= 0) return rows;
  return rows.map((row) => ({
    ...row,
    weightPercent:
      (Math.abs(firstFiniteNumber(row.marketValue) ?? 0) / totalAbsMarketValue) * 100,
  }));
};

const formatQuoteMarkLast = (quote, maskValues) => {
  const mark = firstFiniteNumber(quote?.mark, quote?.mid);
  const last = firstFiniteNumber(quote?.last, quote?.price);
  if (mark == null && last == null) return MISSING_VALUE;
  return `Mark ${formatOptionPrice(mark, maskValues)} · Last ${formatOptionPrice(last, maskValues)}`;
};

const formatGreek = (label, value, digits = 2) => {
  const numeric = finiteNumber(value);
  return numeric == null ? null : `${label} ${numeric.toFixed(digits)}`;
};

const formatIv = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  const pct = Math.abs(numeric) <= 3 ? numeric * 100 : numeric;
  return `IV ${pct.toFixed(1)}%`;
};

const formatMetricCount = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) return MISSING_VALUE;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return formatNumber(numeric, 0);
};

const formatTimestampDetail = (value) => {
  const text = firstText(value);
  return text ? formatAppDateTime(text) : "";
};

const quoteFreshnessDetail = (quote) =>
  [
    firstText(quote?.quoteFreshness, quote?.freshness),
    firstText(quote?.marketDataMode),
    formatTimestampDetail(
      firstText(quote?.quoteUpdatedAt, quote?.dataUpdatedAt, quote?.updatedAt),
    ),
  ]
    .filter(Boolean)
    .join(" · ");

const optionInlineDetail = (row, maskValues) => {
  const contract = row?.optionContract || null;
  if (!contract) {
    return [
      row?.description || row?.assetClass || "Position",
      row?.sector || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const quoteBidAsk = formatQuoteBidAsk(row?.optionQuote, maskValues);
  const underlying = row?.underlyingMarket || null;
  const underlyingPrice = firstFiniteNumber(underlying?.price);
  const underlyingBid = firstFiniteNumber(underlying?.bid);
  const underlyingAsk = firstFiniteNumber(underlying?.ask);
  const underlyingSymbol = firstDisplayText(underlying?.symbol, contract?.underlying, row?.symbol);
  const underlyingMarket =
    underlyingPrice != null && underlyingSymbol
      ? `${underlyingSymbol} ${formatAccountPrice(underlyingPrice, 2, maskValues)}`
      : null;
  const underlyingBidAsk =
    underlyingBid != null || underlyingAsk != null
      ? `U bid/ask ${formatOptionPrice(underlyingBid, maskValues)} / ${formatOptionPrice(underlyingAsk, maskValues)}`
      : null;

  return [
    optionContractLabel(contract),
    quoteBidAsk !== MISSING_VALUE ? `Opt ${quoteBidAsk}` : null,
    underlyingMarket || null,
    underlyingBidAsk,
  ]
    .filter(Boolean)
    .join(" · ");
};

const optionDetailMetrics = (row, currency, maskValues) => {
  const contract = row?.optionContract || null;
  const quote = row?.optionQuote || null;
  const underlying = row?.underlyingMarket || null;
  const automation = row?.automationContext || null;
  if (!contract && !quote && !underlying && !automation) return [];

  const greeksMain = [
    formatGreek("Δ", quote?.delta, 2),
    formatIv(quote?.impliedVolatility),
  ].filter(Boolean);
  const greeksDetail = [
    formatGreek("Γ", quote?.gamma, 3),
    formatGreek("θ", quote?.theta, 3),
    formatGreek("V", quote?.vega, 3),
  ].filter(Boolean);
  const openInterest = formatMetricCount(quote?.openInterest);
  const volume = formatMetricCount(quote?.volume);
  const underlyingPrice = firstFiniteNumber(underlying?.price);
  const underlyingBid = firstFiniteNumber(underlying?.bid);
  const underlyingAsk = firstFiniteNumber(underlying?.ask);

  return [
    contract
      ? {
          label: "Contract",
          value: optionContractLabel(contract),
          detail: [
            firstDisplayText(contract?.ticker, contract?.localSymbol),
            contract?.providerContractId ? `conid ${contract.providerContractId}` : null,
            contract?.multiplier ? `x${formatNumber(contract.multiplier, 0)}` : null,
          ].filter(Boolean).join(" · "),
        }
      : null,
    quote
      ? {
          label: "Bid / Ask",
          value: formatQuoteBidAsk(quote, maskValues),
          detail: quoteFreshnessDetail(quote),
        }
      : null,
    quote
      ? {
          label: "Mark / Last",
          value: formatQuoteMarkLast(quote, maskValues),
          detail: quote?.spreadPctOfMid != null
            ? `Spread ${formatAccountPercent(quote.spreadPctOfMid, 2, maskValues)}`
            : quote?.spreadCents != null
              ? `Spread ${formatNumber(quote.spreadCents, 0)}c`
              : "",
        }
      : null,
    quote
      ? {
          label: "Greeks",
          value: greeksMain.join(" · ") || MISSING_VALUE,
          detail: greeksDetail.join(" · "),
        }
      : null,
    quote
      ? {
          label: "OI / Vol",
          value: `OI ${openInterest} · Vol ${volume}`,
          detail: "",
        }
      : null,
    underlying
      ? {
          label: "Underlying",
          value: [
            underlying?.symbol,
            underlyingPrice != null ? formatAccountPrice(underlyingPrice, 2, maskValues) : null,
          ].filter(Boolean).join(" ") || MISSING_VALUE,
          detail:
            underlyingBid != null || underlyingAsk != null
              ? `Bid / ask ${formatOptionPrice(underlyingBid, maskValues)} / ${formatOptionPrice(underlyingAsk, maskValues)}`
              : firstText(underlying?.updatedAt),
        }
      : null,
    automation
      ? {
          label: "Exit / Risk",
          value: [
            automation?.stopPrice != null
              ? `Stop ${formatAccountPrice(automation.stopPrice, 2, maskValues)}`
              : null,
            automation?.premiumAtRisk != null
              ? `Risk ${formatAccountMoney(automation.premiumAtRisk, currency, true, maskValues)}`
              : null,
          ].filter(Boolean).join(" · ") || MISSING_VALUE,
          detail: [
            automation?.peakPrice != null
              ? `Peak ${formatAccountPrice(automation.peakPrice, 2, maskValues)}`
              : null,
            automation?.timeframe,
            automation?.lastMarkedAt
              ? `Marked ${formatTimestampDetail(automation.lastMarkedAt)}`
              : null,
          ].filter(Boolean).join(" · "),
        }
      : null,
  ].filter(Boolean);
};

const optionDetailGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
  gap: sp(5),
};

const OptionDetailMetric = ({ metric }) => (
  <div
    style={{
      border: "none",
      borderRadius: dim(RADII.xs),
      background: T.bg0,
      padding: sp("5px 6px"),
      minWidth: 0,
    }}
  >
    <div style={mutedLabelStyle}>{metric.label}</div>
    <div
      style={{
        marginTop: sp(2),
        color: T.text,
        fontFamily: T.data,
        fontSize: textSize("body"),
        fontWeight: FONT_WEIGHTS.regular,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {metric.value || MISSING_VALUE}
    </div>
    {metric.detail ? (
      <div
        style={{
          marginTop: sp(2),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {metric.detail}
      </div>
    ) : null}
  </div>
);

const PositionOptionDetails = ({ row, currency, maskValues, style }) => {
  const metrics = optionDetailMetrics(row, currency, maskValues);
  if (!metrics.length) return null;
  return (
    <div style={{ ...optionDetailGridStyle, ...style }}>
      {metrics.map((metric) => (
        <OptionDetailMetric key={`${row.id}:option:${metric.label}`} metric={metric} />
      ))}
    </div>
  );
};

export const buildPositionOptionQuoteGroups = (rows) => {
  const groups = new Map();
  rows.forEach((row) => {
    const contract = row?.optionContract;
    const providerContractId = optionProviderContractId(contract);
    const underlying = firstDisplayText(
      contract?.underlying,
      row?.underlyingMarket?.symbol,
      row?.symbol,
    ).toUpperCase();
    if (!providerContractId || !underlying) return;
    if (!groups.has(underlying)) groups.set(underlying, new Set());
    groups.get(underlying).add(providerContractId);
  });
  return Array.from(groups, ([underlying, ids]) => ({
    underlying,
    providerContractIds: Array.from(ids),
  }));
};

const PositionOptionQuoteStreamGroup = ({ underlying, providerContractIds, enabled }) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(enabled && underlying && providerContractIds.length),
    owner: `account-positions:${underlying}`,
    intent: "account-monitor-live",
    requiresGreeks: true,
  });
  return null;
};

export const PositionOptionQuoteStreams = ({ groups = [], enabled = true }) => (
  <>
    {groups.map((group) => (
      <PositionOptionQuoteStreamGroup
        key={group.underlying}
        underlying={group.underlying}
        providerContractIds={group.providerContractIds}
        enabled={enabled}
      />
    ))}
  </>
);

export const useLiveOptionPositionRows = ({
  rows: inputRows = [],
  enabled = true,
  totals = null,
} = {}) => {
  const optionQuoteGroups = useMemo(
    () => buildPositionOptionQuoteGroups(inputRows),
    [inputRows],
  );
  const providerContractIds = useMemo(
    () =>
      Array.from(
        new Set(
          optionQuoteGroups.flatMap((group) => group.providerContractIds),
        ),
      ),
    [optionQuoteGroups],
  );
  const quoteVersion = useStoredOptionQuoteSnapshotVersion(
    enabled ? providerContractIds : [],
  );
  const rows = useMemo(() => {
    if (!enabled || !providerContractIds.length) {
      return applyDisplayWeights(inputRows);
    }
    const liveQuoteByProviderContractId = Object.fromEntries(
      providerContractIds.map((providerContractId) => [
        providerContractId,
        getStoredOptionQuoteSnapshot(providerContractId),
      ]),
    );
    return applyDisplayWeights(
      inputRows.map((row) =>
        applyLiveOptionQuoteToRow(
          row,
          liveQuoteByProviderContractId[
            optionProviderContractId(row.optionContract)
          ],
        ),
      ),
    );
  }, [
    enabled,
    inputRows,
    providerContractIds,
    quoteVersion,
  ]);
  const displayTotals = useMemo(
    () => buildDisplayTotals(rows, totals),
    [rows, totals],
  );

  return {
    rows,
    displayTotals,
    optionQuoteGroups,
    providerContractIds,
  };
};

export const __positionsPanelInternalsForTests = {
  applyLiveOptionQuoteToRow,
};

const marketForAssetClass = (assetClass) => {
  const normalized = String(assetClass || "").toLowerCase();
  if (normalized === "etf") return "etf";
  if (normalized === "options") return "options";
  return "stocks";
};

const resolvePositionSparklineSymbol = (row) => {
  const symbol = firstDisplayText(
    row?.marketDataSymbol,
    row?.optionContract?.underlying,
    row?.underlyingMarket?.symbol,
    row?.symbol,
  );
  const normalized = normalizeTickerSymbol(symbol);
  return normalized && !isInternalOptionIdentifier(normalized) ? normalized : "";
};

const buildPositionFallbackSparklineData = (row, snapshot, symbol) => {
  const current = firstPositiveFiniteNumber(
    snapshot?.price,
    snapshot?.mark,
    row?.underlyingMarket?.price,
    row?.underlyingMarket?.mark,
    row?.mark,
    row?.marketPrice,
    row?.averageCost,
  );
  if (current == null) return [];

  const percent = firstFiniteNumber(
    row?.dayChangePercent,
    snapshot?.pct,
    snapshot?.changePercent,
    row?.unrealizedPnlPercent,
  );
  const previous = firstPositiveFiniteNumber(
    row?.underlyingMarket?.previousClose,
    row?.previousClose,
    row?.averageCost,
  );
  const start =
    percent != null && percent > -99
      ? current / (1 + percent / 100)
      : previous ?? current * 0.9975;

  return buildDetailedFallbackSparklineData({
    symbol,
    current,
    previous: start,
    pointCount: SPARKLINE_RENDER_POINT_LIMIT,
  });
};

const resolvePositionSparklineData = (snapshot, row, symbol) => {
  if (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars.length >= 2) {
    return snapshot.sparkBars;
  }
  if (Array.isArray(snapshot?.spark) && snapshot.spark.length >= 2) {
    return snapshot.spark;
  }
  return buildPositionFallbackSparklineData(row, snapshot, symbol);
};

const resolvePositionSparklinePositive = (row, snapshot) => {
  const percent = firstFiniteNumber(
    row?.dayChangePercent,
    snapshot?.pct,
    snapshot?.changePercent,
  );
  if (percent != null) return percent >= 0;

  const change = firstFiniteNumber(row?.dayChange, snapshot?.chg, snapshot?.change);
  if (change != null) return change >= 0;

  return null;
};

const mobileFilterRailStyle = {
  display: "flex",
  gap: sp(4),
  flexWrap: "nowrap",
  overflowX: "auto",
  minWidth: 0,
  maxWidth: "100%",
  paddingBottom: sp(1),
  WebkitOverflowScrolling: "touch",
};

const mobileRowListStyle = {
  display: "grid",
  gap: sp(1),
  padding: sp("4px 5px 5px"),
};

const mobilePositionGrid = "minmax(44px, 0.76fr) minmax(54px, 0.88fr) minmax(46px, 0.7fr) minmax(54px, 0.82fr) minmax(50px, 0.76fr) 48px";

const mobileHeaderStyle = {
  display: "grid",
  gridTemplateColumns: mobilePositionGrid,
  gap: sp(3),
  padding: sp("0 5px"),
  color: T.textDim,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const mobileHeaderEndStyle = { textAlign: "right" };
const mobileMinWidthStyle = { minWidth: 0 };
const mobileActionRailStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: sp(2),
};
const mobilePillWrapStyle = {
  display: "flex",
  gap: sp(3),
  flexWrap: "wrap",
};
const mobileTaxLotRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: sp(5),
  color: T.textSec,
  fontFamily: T.data,
  fontSize: textSize("body"),
};

const mobileScanShellStyle = (active = false) => ({
  border: "none",
  borderRadius: dim(RADII.xs),
  background: active ? `${T.cyan}10` : T.bg1,
  boxShadow: active ? `inset 2px 0 0 ${T.cyan}` : "none",
  minWidth: 0,
  overflow: "hidden",
});

const mobileScanRowStyle = {
  width: "100%",
  minHeight: dim(40),
  padding: sp("4px 5px"),
  border: "none",
  background: "transparent",
  display: "grid",
  gridTemplateColumns: mobilePositionGrid,
  gap: sp(3),
  alignItems: "center",
  textAlign: "left",
  cursor: "pointer",
  minWidth: 0,
};

const mobileCellTextStyle = (tone = T.textSec, align = "right") => ({
  color: tone,
  fontFamily: T.data,
  fontSize: textSize("body"),
  fontWeight: FONT_WEIGHTS.medium,
  fontVariantNumeric: "tabular-nums",
  textAlign: align,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
});

const mobileDetailStyle = {
  borderTop: `1px solid ${T.border}`,
  padding: sp("6px 7px 7px"),
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: sp("5px 8px"),
};

const mobileIconButtonStyle = {
  width: dim(22),
  height: dim(22),
  padding: 0,
  border: "none",
  borderRadius: dim(RADII.xs),
  background: T.bg1,
  color: T.textSec,
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const MobileIconButton = ({ label, onClick, children, expanded = null, ...buttonProps }) => (
  <AppTooltip content={label}>
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded == null ? undefined : expanded}
      onClick={onClick}
      style={mobileIconButtonStyle}
      {...buttonProps}
    >
      {children}
    </button>
  </AppTooltip>
);

const positionSparklineShellStyle = (compact = false, inline = false) => ({
  display: inline ? "inline-flex" : "block",
  alignItems: inline ? "center" : undefined,
  width: dim(compact ? TABLE_SPARKLINE_COMPACT_WIDTH : TABLE_SPARKLINE_WIDTH),
  height: dim(compact ? TABLE_SPARKLINE_COMPACT_HEIGHT : TABLE_SPARKLINE_HEIGHT),
  marginTop: inline ? 0 : sp(compact ? 2 : 3),
  flexShrink: inline ? 0 : undefined,
  overflow: "hidden",
  opacity: 0.95,
});

const PositionTrendSparkline = ({
  row,
  snapshotsBySymbol,
  compact = false,
  inline = false,
}) => {
  const symbol = resolvePositionSparklineSymbol(row);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const data = resolvePositionSparklineData(snapshot, row, symbol);
  if (data.length < 2) return null;

  return (
    <span
      data-testid="account-position-sparkline"
      title={`${symbol} intraday trend`}
      style={positionSparklineShellStyle(compact, inline)}
    >
      <MicroSparkline
        data={data}
        positive={resolvePositionSparklinePositive(row, snapshot)}
        width={compact ? TABLE_SPARKLINE_COMPACT_WIDTH : TABLE_SPARKLINE_WIDTH}
        height={compact ? TABLE_SPARKLINE_COMPACT_HEIGHT : TABLE_SPARKLINE_HEIGHT}
        style={{ width: "100%", height: "100%" }}
        ariaHidden
      />
    </span>
  );
};

const MobileMetric = ({ label, value, tone = T.text }) => (
  <div style={{ minWidth: 0 }}>
    <div style={mutedLabelStyle}>{label}</div>
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
      {value}
    </div>
  </div>
);

const MobileDetailMetric = ({ label, value, tone = T.textSec }) => (
  <div style={{ minWidth: 0 }}>
    <div style={mutedLabelStyle}>{label}</div>
    <div style={mobileCellTextStyle(tone, "left")}>{value}</div>
  </div>
);

const positionMobileRowSignature = (row) =>
  JSON.stringify([
    row?.id,
    row?.symbol,
    row?.quantity,
    row?.assetClass,
    row?.mark,
    row?.dayChange,
    row?.dayChangePercent,
    row?.unrealizedPnl,
    row?.unrealizedPnlPercent,
    row?.marketValue,
    row?.averageCost,
    row?.weightPercent,
    row?.sourceType,
    row?.strategyLabel,
    row?.accounts,
    row?.openOrders,
    row?.lots,
    row?.optionContract,
    row?.optionQuote,
    row?.underlyingMarket,
    row?.automationContext,
  ]);

const MobilePositionRow = memo(({
  row,
  expanded,
  currency,
  maskValues,
  snapshotsBySymbol,
  onRowAction,
  onRowKeyDown,
}) => (
  <article style={mobileScanShellStyle(expanded)}>
    <div
      data-testid="account-position-scan-row"
      data-action="toggle"
      data-row-id={row.id}
      role="button"
      tabIndex={0}
      onClick={onRowAction}
      onKeyDown={onRowKeyDown}
      style={mobileScanRowStyle}
    >
      <div
        style={{
          ...mobileMinWidthStyle,
          display: "flex",
          alignItems: "flex-start",
          gap: sp(5),
        }}
      >
        <PositionTrendSparkline
          row={row}
          snapshotsBySymbol={snapshotsBySymbol}
          compact
          inline
        />
        <div style={mobileMinWidthStyle}>
          <div style={mobileCellTextStyle(T.text, "left")}>{row.symbol}</div>
          <div style={cellSubTextStyle(T.textDim)}>
            {optionInlineDetail(row, maskValues) ||
              `${row.quantity < 0 ? "Short" : "Long"} · ${row.assetClass || "Position"}`}
          </div>
        </div>
      </div>
      <div
        title={`${formatNumber(row.quantity, 4)} @ ${formatAccountPrice(row.mark, 2, maskValues)}`}
        style={mobileCellTextStyle(row.quantity < 0 ? T.red : T.textSec)}
      >
        {formatNumber(row.quantity, 3)} @ {formatAccountPrice(row.mark, 2, maskValues)}
      </div>
      <div style={mobileCellTextStyle(toneForValue(row.dayChange))}>
        {formatAccountMoney(row.dayChange, currency, true, maskValues)}
      </div>
      <div style={mobileCellTextStyle(toneForValue(row.unrealizedPnl))}>
        {formatAccountMoney(row.unrealizedPnl, currency, true, maskValues)}
      </div>
      <div style={mobileCellTextStyle(T.textSec)}>
        {formatAccountMoney(row.marketValue, currency, true, maskValues)}
      </div>
      <div style={mobileActionRailStyle}>
        <MobileIconButton
          label={`Open ${row.symbol} chart`}
          data-action="chart"
          data-row-id={row.id}
          data-symbol={row.symbol}
          onClick={onRowAction}
        >
          <LineChart size={13} strokeWidth={1.8} aria-hidden="true" />
        </MobileIconButton>
        <MobileIconButton
          label={expanded ? `Collapse ${row.symbol} details` : `Expand ${row.symbol} details`}
          data-action="expand"
          data-row-id={row.id}
          expanded={expanded}
          onClick={onRowAction}
        >
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
          )}
        </MobileIconButton>
      </div>
    </div>
    {expanded ? (
      <div
        data-testid="account-position-expanded-details"
        style={mobileDetailStyle}
      >
        <MobileDetailMetric label="Avg Cost" value={formatAccountPrice(row.averageCost, 2, maskValues)} />
        <MobileDetailMetric
          label="Unreal %"
          value={formatAccountPercent(row.unrealizedPnlPercent, 2, maskValues)}
          tone={toneForValue(row.unrealizedPnlPercent)}
        />
        <MobileDetailMetric
          label="Day %"
          value={formatAccountPercent(row.dayChangePercent, 2, maskValues)}
          tone={toneForValue(row.dayChangePercent)}
        />
        <MobileDetailMetric label="Weight" value={formatAccountPercent(row.weightPercent, 2, maskValues)} />
        <PositionOptionDetails
          row={row}
          currency={currency}
          maskValues={maskValues}
          style={{ gridColumn: "1 / -1", minWidth: 0 }}
        />
        <div style={mobileMinWidthStyle}>
          <div style={{ ...mutedLabelStyle, marginBottom: sp(3) }}>Accounts</div>
          <div style={mobilePillWrapStyle}>
            {(row.accounts || []).slice(0, 3).map((accountId) => (
              <Pill key={`${row.id}:${accountId}`} tone="cyan">
                {accountId}
              </Pill>
            ))}
            {row.sourceType ? (
              <Pill tone={sourceTone(row.sourceType)}>
                {row.strategyLabel || row.sourceType}
              </Pill>
            ) : null}
          </div>
        </div>
        <div style={mobileMinWidthStyle}>
          <div style={{ ...mutedLabelStyle, marginBottom: sp(3) }}>Orders</div>
          {row.openOrders?.length ? (
            <div style={mobilePillWrapStyle}>
              {row.openOrders.slice(0, 3).map((order, index) => (
                <Pill
                  key={positionOpenOrderKey(row.id, order, index)}
                  tone={/buy/i.test(order.side) ? "side-buy" : "side-sell"}
                >
                  {order.side} {formatNumber(order.quantity, 2)}
                </Pill>
              ))}
            </div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: textSize("caption") }}>No working orders.</div>
          )}
        </div>
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <div style={{ ...mutedLabelStyle, marginBottom: sp(3) }}>Tax Lots</div>
          {row.lots?.length ? (
            <div style={{ display: "grid", gap: sp(2) }}>
              {row.lots.slice(0, 4).map((lot, index) => (
                <div
                  key={`${row.id}:mobile-lot:${index}`}
                  style={mobileTaxLotRowStyle}
                >
                  <span>{lot.accountId} · {formatNumber(lot.quantity, 4)} @ {formatAccountPrice(lot.averageCost, 2, maskValues)}</span>
                  <span style={{ color: toneForValue(lot.unrealizedPnl) }}>
                    {formatAccountMoney(lot.unrealizedPnl, currency, false, maskValues)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: textSize("body") }}>
              No tax-lot detail recorded yet.
            </div>
          )}
        </div>
      </div>
    ) : null}
  </article>
), (previous, next) => (
  previous.expanded === next.expanded &&
  previous.currency === next.currency &&
  previous.maskValues === next.maskValues &&
  previous.onRowAction === next.onRowAction &&
  previous.onRowKeyDown === next.onRowKeyDown &&
  (
    previous.row === next.row ||
    positionMobileRowSignature(previous.row) === positionMobileRowSignature(next.row)
  )
));

const dateLabel = (date) => {
  if (!date) return "Live";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
};

const ActivityTone = ({ activity }) => {
  const tone = activity?.type === "trade_buy"
    ? "side-buy"
    : activity?.type === "trade_sell"
      ? "side-sell"
      : Number(activity?.amount) >= 0
        ? "pnl-positive"
        : "pnl-negative";
  return (
    <Pill tone={tone}>
      {String(activity?.type || "event").replace(/_/g, " ")}
    </Pill>
  );
};

export const PositionsAtDateInspector = ({
  query,
  activeDate,
  pinnedDate,
  currentPositionsCount = 0,
  currency,
  maskValues = false,
  onClearPin,
  onJumpToChart,
}) => {
  const data = query.data || null;
  const inspecting = Boolean(activeDate);
  const inspectorState = buildPositionsAtDateInspectorState({
    activeDate,
    pinnedDate,
    response: data,
    currentPositionsCount,
  });
  const positions = inspectorState.positions;
  const activity = inspectorState.activity;
  const balance = inspectorState.balance;
  const title = pinnedDate
    ? `Positions @ ${dateLabel(pinnedDate)}`
    : activeDate
      ? `Positions @ ${dateLabel(activeDate)}`
      : inspectorState.title;

  return (
    <Panel
      title={title}
      rightRail={
        inspecting
          ? inspectorState.rightRail
          : `${formatNumber(currentPositionsCount, 0)} current positions`
      }
      loading={Boolean(inspecting && query.isLoading)}
      error={inspecting ? query.error : null}
      onRetry={inspecting ? query.refetch : undefined}
      minHeight={136}
      action={
        pinnedDate ? (
          <Button variant="secondary" onClick={onClearPin}>
            Clear Pin
          </Button>
        ) : null
      }
    >
      {!inspecting ? (
        <EmptyState
          title="Move over the equity curve"
          body="Hover a date to preview that day's positions and activity. Click the chart to pin the date for inspection."
        />
      ) : inspectorState.unavailable ? (
        <EmptyState
          title="No positions for this date"
          body={inspectorState.message || "No historical position snapshot or account activity exists for the selected date."}
        />
      ) : (
        <div style={{ display: "grid", gap: sp(6) }}>
          {balance ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(${dim(118)}px, 1fr))`,
                gap: sp(5),
              }}
            >
              {[
                ["Net Liq", formatAccountMoney(balance.netLiquidation, currency, false, maskValues), T.text],
                ["Day P&L", formatAccountSignedMoney(balance.dayPnl, currency, false, maskValues), toneForValue(balance.dayPnl)],
                ["Cash", formatAccountMoney(balance.cash, currency, false, maskValues), T.text],
                ["Buying Power", formatAccountMoney(balance.buyingPower, currency, false, maskValues), T.text],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  style={{
                    border: "none",
                    borderRadius: dim(RADII.xs),
                    background: T.bg0,
                    padding: sp("5px 6px"),
                    minWidth: 0,
                  }}
                >
                  <div style={mutedLabelStyle}>{label}</div>
                  <div
                    style={{
                      marginTop: sp(2),
                      color,
                      fontFamily: T.data,
                      fontSize: textSize("bodyStrong"),
                      fontWeight: FONT_WEIGHTS.regular,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
            <Pill tone="cyan">
              {positions.length} positions
            </Pill>
            <Pill tone="purple">
              {activity.length} activity rows
            </Pill>
            {balance?.dayPnlPercent != null ? (
              <Pill tone={Number(balance.dayPnlPercent) >= 0 ? "pnl-positive" : "pnl-negative"}>
                {formatAccountPercent(balance.dayPnlPercent, 2, maskValues)}
              </Pill>
            ) : null}
            {data?.snapshotDate ? (
              <Pill tone="default">
                as of {formatAppDateTime(data.snapshotDate)}
              </Pill>
            ) : null}
          </div>
          {!positions.length && inspectorState.message ? (
            <div style={{ color: T.textMuted, fontSize: textSize("caption"), lineHeight: 1.35 }}>
              {inspectorState.message}
            </div>
          ) : null}

          <div
            data-account-sidebar-grid
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0, 1fr) minmax(${dim(280)}px, 0.8fr)`,
              gap: sp(7),
              alignItems: "start",
            }}
          >
            <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr style={tableHeaderStyle}>
                    {["Symbol", "Qty", "Mark", "Unreal P&L", "Mkt Value"].map((column) => (
                      <th key={column} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.slice(0, 8).map((row) => (
                    <tr key={row.id} className="ra-table-row">
                      <td style={{ ...tableCellStyle, color: T.text, fontWeight: FONT_WEIGHTS.regular }}>
                        <button
                          type="button"
                          onClick={() => onJumpToChart?.(row.symbol)}
                          style={{
                            border: "none",
                            padding: 0,
                            background: "transparent",
                            color: T.text,
                            cursor: "pointer",
                          }}
                        >
                          <MarketIdentityInline
                            item={{
                              ticker: row.symbol,
                              name: row.description || row.symbol,
                              market: marketForAssetClass(row.assetClass),
                            }}
                            size={14}
                            showMark={false}
                            showChips
                            style={{ maxWidth: dim(150) }}
                          />
                        </button>
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatNumber(row.quantity, 3)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatAccountPrice(row.mark, 2, maskValues)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: FONT_WEIGHTS.regular }}>
                        {formatAccountMoney(row.unrealizedPnl, currency, false, maskValues)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                        {formatAccountMoney(row.marketValue, currency, false, maskValues)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {positions.length > 8 ? (
                <div style={{ color: T.textDim, fontSize: textSize("body"), marginTop: sp(3) }}>
                  Showing 8 of {formatNumber(positions.length, 0)} positions.
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: sp(4) }}>
              <div style={mutedLabelStyle}>DATE ACTIVITY</div>
              {activity.length ? (
                activity.slice(0, 7).map((row) => (
                  <div
                    key={row.id}
                    style={{
                      border: "none",
                      borderRadius: dim(RADII.xs),
                      background: T.bg0,
                      padding: sp("4px 5px"),
                      display: "grid",
                      gap: sp(3),
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: sp(5) }}>
                      <ActivityTone activity={row} />
                      <span style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("body") }}>
                        {formatAppDateTime(row.timestamp)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: sp(5),
                        color: T.textSec,
                        fontFamily: T.data,
                        fontSize: textSize("body"),
                      }}
                    >
                      <span>{row.symbol || row.source}</span>
                      <span style={{ color: toneForValue(row.realizedPnl ?? row.amount), fontWeight: FONT_WEIGHTS.regular }}>
                        {row.realizedPnl != null
                          ? formatAccountMoney(row.realizedPnl, currency, true, maskValues)
                          : formatAccountMoney(row.amount, currency, true, maskValues)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: T.textDim, fontSize: textSize("caption") }}>
                  No account activity is recorded for this date.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export const PositionsPanel = ({
  query,
  currency,
  assetFilter,
  onAssetFilterChange,
  sourceFilter = "all",
  onSourceFilterChange,
  onJumpToChart,
  rightRail = "IBKR positions + lots",
  emptyBody = "Positions from the IBKR account stream will appear here. Tax lots fill in from the local ledger as fills are observed.",
  maskValues = false,
  isPhone = false,
  showFilters = true,
  onPositionSelect,
  liveOptionQuotesEnabled = true,
  streamLiveOptionQuotes = true,
}) => {
  const [sort, setSort] = useState({ id: "marketValue", dir: "desc" });
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const sourceFilteredRows = useMemo(
    () =>
      getOpenPositionRows(query.data?.positions || []).filter((row) =>
        sourceFilter === "all" ? true : row.sourceType === sourceFilter,
      ),
    [query.data?.positions, sourceFilter],
  );
  const { rows, displayTotals, optionQuoteGroups } = useLiveOptionPositionRows({
    rows: sourceFilteredRows,
    enabled: liveOptionQuotesEnabled,
    totals: query.data?.totals,
  });
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.id];
      const bv = b[sort.id];
      const numericA = Number(av);
      const numericB = Number(bv);
      const result =
        Number.isFinite(numericA) && Number.isFinite(numericB)
          ? numericA - numericB
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.dir === "desc" ? -result : result;
    });
    return copy;
  }, [rows, sort]);
  const positionSparklineSymbols = useMemo(
    () =>
      Array.from(
        new Set(sortedRows.map(resolvePositionSparklineSymbol).filter(Boolean)),
      ),
    [sortedRows],
  );
  const tickerSnapshotsBySymbol = useRuntimeTickerSnapshots(positionSparklineSymbols);
  const totalDayChange = useMemo(
    () =>
      rows.reduce(
        (sum, row) =>
          sum + (Number.isFinite(Number(row.dayChange)) ? Number(row.dayChange) : 0),
        0,
      ),
    [rows],
  );

  const toggleExpanded = useCallback((rowId) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const handlePositionToggle = useCallback(
    (row) => {
      if (!row?.id) return;
      onPositionSelect?.(row);
      toggleExpanded(row.id);
    },
    [onPositionSelect, toggleExpanded],
  );

  const rowById = useMemo(
    () => new Map(sortedRows.map((row) => [row.id, row])),
    [sortedRows],
  );

  const handleMobileRowAction = useCallback(
    (event) => {
      const { action, rowId, symbol } = event.currentTarget.dataset;
      if (!rowId) {
        return;
      }
      const row = rowById.get(rowId);
      if (row) {
        onPositionSelect?.(row);
      }
      if (action === "chart") {
        event.stopPropagation();
        onJumpToChart?.(symbol);
        return;
      }
      if (action === "expand") {
        event.stopPropagation();
      }
      toggleExpanded(rowId);
    },
    [onJumpToChart, onPositionSelect, rowById, toggleExpanded],
  );

  const handleMobileRowKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      handleMobileRowAction(event);
    },
    [handleMobileRowAction],
  );

  const positionsTablePanel = (
    <Panel
      title={`Current Positions · ${rows.length}`}
      rightRail={rightRail}
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={rows.length ? 144 : 174}
      noPad
      action={showFilters ? (
        <div style={isPhone ? mobileFilterRailStyle : { display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          <ToggleGroup options={ASSET_FILTERS} value={assetFilter} onChange={onAssetFilterChange} />
          {onSourceFilterChange ? (
            <ToggleGroup
              options={SOURCE_FILTERS}
              value={sourceFilter}
              onChange={onSourceFilterChange}
            />
          ) : null}
        </div>
      ) : null}
    >
      {streamLiveOptionQuotes ? (
        <PositionOptionQuoteStreams
          groups={optionQuoteGroups}
          enabled={liveOptionQuotesEnabled}
        />
      ) : null}
      {!rows.length ? (
        <div style={{ padding: sp(7) }}>
          <EmptyState
            title="No open positions"
            body={emptyBody}
          />
        </div>
      ) : isPhone ? (
        <div
          data-testid="account-positions-row-list"
          style={mobileRowListStyle}
        >
          <div aria-hidden="true" style={mobileHeaderStyle}>
            <span>Symbol</span>
            <span style={mobileHeaderEndStyle}>Qty/Mark</span>
            <span style={mobileHeaderEndStyle}>Day</span>
            <span style={mobileHeaderEndStyle}>P&L</span>
            <span style={mobileHeaderEndStyle}>Value</span>
            <span />
          </div>
          {sortedRows.map((row) => (
            <MobilePositionRow
              key={row.id}
              row={row}
              expanded={expandedRows.has(row.id)}
              currency={currency}
              maskValues={maskValues}
              snapshotsBySymbol={tickerSnapshotsBySymbol}
              onRowAction={handleMobileRowAction}
              onRowKeyDown={handleMobileRowKeyDown}
            />
          ))}
          <div
            data-testid="account-positions-summary-row"
            className="ra-hide-scrollbar"
            style={{
              background: T.bg1,
              borderRadius: dim(RADII.sm),
              display: "flex",
              flexWrap: "nowrap",
              overflowX: "auto",
              minWidth: 0,
            }}
          >
            {[
              ["Day", formatAccountMoney(totalDayChange, currency, true, maskValues), toneForValue(totalDayChange)],
              ["Net", formatAccountMoney(displayTotals.netExposure, currency, true, maskValues), undefined],
              ["Unreal", formatAccountMoney(displayTotals.unrealizedPnl, currency, true, maskValues), toneForValue(displayTotals.unrealizedPnl)],
              ["Weight", formatAccountPercent(displayTotals.weightPercent, 2, maskValues), undefined],
            ].map(([label, value, tone], index) => (
              <div
                key={label}
                style={{
                  flex: "1 1 auto",
                  minWidth: dim(72),
                  padding: sp("4px 10px"),
                  borderLeft: index === 0 ? "none" : `1px solid ${T.border}`,
                }}
              >
                <MobileMetric label={label} value={value} tone={tone} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          data-testid="account-positions-table-scroll"
          className="ra-hide-scrollbar"
          style={{ overflowX: "auto" }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1160 }}>
            <thead>
              <tr style={tableHeaderStyle}>
                {[
                  ["symbol", "Symbol", "left"],
                  ["quantity", "Qty"],
                  ["averageCost", "Avg Cost"],
                  ["mark", "Mark"],
                  ["dayChangePercent", "Day %"],
                  ["dayChange", "Day $"],
                  ["unrealizedPnl", "Unreal P&L"],
                  ["unrealizedPnlPercent", "Unreal %"],
                  ["marketValue", "Mkt Value"],
                  ["weightPercent", "Weight"],
                  ["betaWeightedDelta", "β Δ"],
                ].map(([id, label, align]) => (
                  <th key={id} style={headerCellStyle(sort.id === id)}>
                    <SortButton
                      id={id}
                      label={label}
                      sort={sort}
                      setSort={setSort}
                      align={align === "left" ? "left" : "right"}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    tabIndex={0}
                    onKeyDown={moveTableFocus}
                    style={{
                      outline: "none",
                      cursor: "pointer",
                      background: expandedRows.has(row.id) ? `${T.accent}14` : "transparent",
                    }}
                    onClick={() => handlePositionToggle(row)}
                  >
                    <td style={{ ...tableCellStyle, minWidth: 164 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: sp(6) }}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePositionToggle(row);
                          }}
                          aria-expanded={expandedRows.has(row.id)}
                          style={{
                            width: 16,
                            height: 16,
                            border: "none",
                            borderRadius: dim(RADII.xs),
                            background: T.bg0,
                            color: T.textSec,
                            cursor: "pointer",
                            fontSize: textSize("caption"),
                            fontWeight: FONT_WEIGHTS.regular,
                            flexShrink: 0,
                          }}
                        >
                          {expandedRows.has(row.id) ? "−" : "+"}
                        </button>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: sp(6),
                            minWidth: 0,
                          }}
                        >
                          <PositionTrendSparkline
                            row={row}
                            snapshotsBySymbol={tickerSnapshotsBySymbol}
                            inline
                          />
                          <div style={{ minWidth: 0 }}>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onPositionSelect?.(row);
                                onJumpToChart?.(row.symbol);
                              }}
                              style={{
                                border: "none",
                                padding: 0,
                                background: "transparent",
                                color: T.text,
                                fontSize: textSize("body"),
                                fontWeight: FONT_WEIGHTS.regular,
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <MarketIdentityInline
                                item={{
                                  ticker: row.symbol,
                                  name: row.description || row.symbol,
                                  market: marketForAssetClass(row.assetClass),
                                  sector: row.sector || null,
                                }}
                                size={14}
                                showMark={false}
                                showChips
                                style={{ maxWidth: dim(148) }}
                              />
                            </button>
                            <div
                              style={{
                                marginTop: sp(1),
                                color: T.textDim,
                                fontSize: textSize("body"),
                                whiteSpace: "normal",
                                lineHeight: 1.25,
                              }}
                            >
                              {optionInlineDetail(row, maskValues)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: row.quantity < 0 ? T.red : T.text }}>
                      {formatNumber(row.quantity, 4)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatAccountPrice(row.averageCost, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatAccountPrice(row.mark, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChangePercent) }}>
                      {formatAccountPercent(row.dayChangePercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChange) }}>
                      {formatAccountMoney(row.dayChange, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: FONT_WEIGHTS.regular }}>
                      {formatAccountMoney(row.unrealizedPnl, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnlPercent) }}>
                      {formatAccountPercent(row.unrealizedPnlPercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatAccountMoney(row.marketValue, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatAccountPercent(row.weightPercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatNumber(row.betaWeightedDelta, 2)}
                    </td>
                  </tr>
                  {expandedRows.has(row.id) ? (
                    <tr>
                      <td
                        colSpan={11}
                        style={{
                          ...tableCellStyle,
                          padding: sp("6px 8px 7px 24px"),
                          whiteSpace: "normal",
                          background: `${T.accent}08`,
                        }}
                      >
                          <div style={{ display: "grid", gap: sp(6) }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
                            {(row.accounts || []).map((accountId) => (
                              <Pill key={`${row.id}:${accountId}`} tone="cyan">
                                {accountId}
                              </Pill>
                            ))}
                            {row.assetClass ? <Pill tone="purple">{row.assetClass}</Pill> : null}
                            {row.sourceType ? (
                              <Pill tone={sourceTone(row.sourceType)}>
                                {row.strategyLabel || row.sourceType}
                              </Pill>
                            ) : null}
                            {row.attributionStatus && row.attributionStatus !== "attributed" ? (
                              <Pill tone={row.attributionStatus === "mixed" ? "amber" : "default"}>
                                {row.attributionStatus}
                              </Pill>
                              ) : null}
                            </div>

                            <PositionOptionDetails
                              row={row}
                              currency={currency}
                              maskValues={maskValues}
                            />

                            <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr) auto",
                              gap: sp(8),
                              alignItems: "start",
                            }}
                          >
                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Tax Lots</div>
                              {row.lots?.length ? (
                                <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                                    <thead>
                                      <tr>
                                        {lotColumns.map((label) => (
                                          <th
                                            key={label}
                                            style={{
                                              ...tableHeaderStyle,
                                              ...tableCellStyle,
                                            }}
                                          >
                                            {label}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.lots.slice(0, 6).map((lot, index) => (
                                        <tr key={`${row.id}:lot:${index}`}>
                                          <td style={tableCellStyle}>{lot.accountId}</td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatNumber(lot.quantity, 4)}
                                          </td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatAccountPrice(lot.averageCost, 2, maskValues)}
                                          </td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatAccountMoney(lot.marketValue, currency, false, maskValues)}
                                          </td>
                                          <td
                                            style={{
                                              ...tableCellStyle,
                                              textAlign: "right",
                                              color: toneForValue(lot.unrealizedPnl),
                                            }}
                                          >
                                            {formatAccountMoney(lot.unrealizedPnl, currency, false, maskValues)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div style={{ color: T.textMuted, fontSize: textSize("body") }}>
                                  No tax-lot detail recorded yet.
                                </div>
                              )}
                            </div>

                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Source Attribution</div>
                              {row.sourceAttribution?.length ? (
                                <div style={{ display: "grid", gap: sp(3), marginBottom: sp(6) }}>
                                  {row.sourceAttribution.slice(0, 6).map((source, index) => (
                                    <div
                                      key={positionSourceAttributionKey(row.id, source, index)}
                                      style={{
                                        borderBottom: `1px solid ${T.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
                                        <Pill tone={sourceTone(source.sourceType)}>
                                          {source.strategyLabel || source.sourceType}
                                        </Pill>
                                        <Pill tone="cyan">
                                          Qty {formatNumber(source.quantity, 3)}
                                        </Pill>
                                      </div>
                                      <div
                                        style={{
                                          color: T.textDim,
                                          fontSize: textSize("caption"),
                                          fontFamily: T.sans,
                                        }}
                                      >
                                        {source.deploymentName || source.candidateId || source.sourceEventId || "Manual ledger fill"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                  <div style={{ color: T.textMuted, fontSize: textSize("body"), marginBottom: sp(8) }}>
                                  Source attribution is unavailable for this position.
                                </div>
                              )}
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Open Orders</div>
                              {row.openOrders?.length ? (
                                <div style={{ display: "grid", gap: sp(3) }}>
                                  {row.openOrders.slice(0, 6).map((order, index) => (
                                    <div
                                      key={positionOpenOrderKey(row.id, order, index)}
                                      style={{
                                        borderBottom: `1px solid ${T.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                                        <Pill tone={/buy/i.test(order.side) ? "side-buy" : "side-sell"}>
                                          {order.side}
                                        </Pill>
                                        <Pill tone="default">{order.type}</Pill>
                                        <Pill tone="accent">{order.status}</Pill>
                                      </div>
                                      <div
                                        style={{
                                          color: T.textSec,
                                          fontSize: textSize("body"),
                                          fontFamily: T.sans,
                                          lineHeight: 1.4,
                                        }}
                                      >
                                        {formatNumber(order.quantity, 2)} @{" "}
                                        {order.limitPrice != null
                                          ? formatAccountPrice(order.limitPrice, 2, maskValues)
                                          : order.stopPrice != null
                                            ? formatAccountPrice(order.stopPrice, 2, maskValues)
                                            : "Market"}
                                      </div>
                                      <div
                                        style={{
                                          color: T.textDim,
                                          fontSize: textSize("caption"),
                                          fontFamily: T.sans,
                                        }}
                                      >
                                        {order.accountId}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ color: T.textMuted, fontSize: textSize("body") }}>
                                  No working orders tied to this position.
                                </div>
                              )}
                            </div>

                            <div style={{ display: "grid", gap: sp(6), minWidth: dim(100) }}>
                              <Button
                                variant="secondary"
                                onClick={() => onJumpToChart?.(row.symbol)}
                              >
                                Chart
                              </Button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr
                style={{
                  background: T.bg1,
                  position: "sticky",
                  bottom: 0,
                  zIndex: 1,
                }}
              >
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: FONT_WEIGHTS.regular }} colSpan={5}>
                  Totals
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(totalDayChange), fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountMoney(totalDayChange, currency, false, maskValues)}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    textAlign: "right",
                    color: toneForValue(displayTotals.unrealizedPnl),
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {formatAccountMoney(displayTotals.unrealizedPnl, currency, false, maskValues)}
                </td>
                <td />
                <td style={{ ...tableCellStyle, textAlign: "right", color: T.text, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountMoney(displayTotals.netExposure, currency, true, maskValues)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", fontWeight: FONT_WEIGHTS.regular }}>
                  {formatAccountPercent(displayTotals.weightPercent, 2, maskValues)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                  Long {formatAccountMoney(displayTotals.grossLong, currency, true, maskValues)} · Short{" "}
                  {formatAccountMoney(displayTotals.grossShort, currency, true, maskValues)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );

  return positionsTablePanel;
};

export default PositionsPanel;
