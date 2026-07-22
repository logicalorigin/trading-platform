import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  ShieldCheck,
  Ticket,
  XCircle,
} from "lucide-react";
import {
  useGetAccountPositions,
  useListOrders,
} from "@workspace/api-client-react";
import {
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
} from "../platform/queryDefaults";
import { usePositions, useToast } from "../platform/platformContexts.jsx";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  FINAL_ORDER_STATUSES,
  formatExecutionContractLabel,
  listBrokerExecutionsRequest,
  normalizeBrokerExecutionsPayload,
  orderStatusColor,
} from "./tradeBrokerRequests";
import { isOpenPositionRow } from "../account/accountPositionRows.js";
import {
  buildIbkrCloseReviewIntent,
} from "../account/positionOrderActions.js";
import {
  buildPositionDisplayModel,
  formatPositionQuoteFreshnessLabel,
  formatPositionSpreadLabel,
} from "../account/positionDisplayModel.js";
import {
  buildPositionTradeManagement,
  orderMatchesManagementPosition,
} from "../account/positionTradeManagement.js";
import { useValueFlash } from "../../lib/motion.jsx";
import {
  formatEnumLabel,
  formatExpirationLabel,
  formatOptionContractLabel,
  formatPriceValue,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { formatAppTimeForPreferences } from "../../lib/timeZone";
import {
  CSS_COLOR,
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
import { DataUnavailableState, MicroSparkline, SegmentedControl } from "../../components/platform/primitives.jsx";
import { useRuntimeTickerSnapshots } from "../platform/runtimeTickerStore";
import { toneForDirectionalIntent } from "../platform/semanticToneModel.js";
import {
  SPARKLINE_RENDER_POINT_LIMIT,
  buildDetailedFallbackSparklineData,
} from "../platform/sparklineConfig";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { PositionRowActionMenu } from "../account/PositionRowActionMenu.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

const TRADE_BUY_TONE = toneForDirectionalIntent("buy");
const TRADE_SELL_TONE = toneForDirectionalIntent("sell");
const toneForTradeSide = (side) =>
  toneForDirectionalIntent(side, TRADE_BUY_TONE);

const compactOrderKeyPart = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || "_";
};

export const getTradeLiveOrderRowId = (order) => {
  if (order?.id) {
    return String(order.id);
  }

  return [
    order?.accountId,
    order?.symbol,
    order?.side,
    order?.type,
    order?.quantity,
    order?.filledQuantity,
    order?.status,
    order?.updatedAt,
  ]
    .map(compactOrderKeyPart)
    .join("|");
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
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

const tradePositionIsOption = (position) =>
  Boolean(position?.optionContract || position?._brokerPosition?.optionContract);

const buildTradePositionFallbackSparklineData = (position, snapshot, symbol) => {
  const snapshotsBySymbol = symbol && snapshot ? { [symbol]: snapshot } : {};
  const current = resolveTradeSpotPrice(position, snapshotsBySymbol);
  if (current == null) return [];

  const canonicalPosition = position?._brokerPosition || position;
  const underlyingMarket =
    position?.underlyingMarket || canonicalPosition?.underlyingMarket;
  const percent = firstNumber(
    snapshot?.pct,
    snapshot?.changePercent,
    underlyingMarket?.dayChangePercent,
    !tradePositionIsOption(position) ? position?.pct : null,
  );
  const start =
    percent != null && percent > -99
      ? current / (1 + percent / 100)
      : firstPositiveNumber(
          underlyingMarket?.previousClose,
          underlyingMarket?.prevClose,
          !tradePositionIsOption(position) ? position?.entry : null,
        );
  if (start == null) return [];

  return buildDetailedFallbackSparklineData({
    symbol,
    current,
    previous: start,
    pointCount: SPARKLINE_RENDER_POINT_LIMIT,
  });
};

const resolveTradePositionSparklineData = (snapshot, position, symbol) => {
  if (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars.length >= 2) {
    return snapshot.sparkBars;
  }
  if (Array.isArray(snapshot?.spark) && snapshot.spark.length >= 2) {
    return snapshot.spark;
  }
  return buildTradePositionFallbackSparklineData(position, snapshot, symbol);
};

const quoteMid = (quote) => {
  const bid = firstPositiveNumber(quote?.bid);
  const ask = firstPositiveNumber(quote?.ask);
  return bid != null && ask != null ? (bid + ask) / 2 : null;
};

const resolveTradeSpotSymbol = (position) =>
  normalizeTickerSymbol(
    position?.marketDataSymbol ||
      position?._brokerPosition?.marketDataSymbol ||
      position?.ticker ||
      position?.optionContract?.underlying ||
      position?.symbol,
  );

const resolveTradeSpotPrice = (position, snapshotsBySymbol = {}) => {
  const symbol = resolveTradeSpotSymbol(position);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const canonicalPosition = position?._brokerPosition || position;
  const underlyingMarket =
    position?.underlyingMarket || canonicalPosition?.underlyingMarket;
  const equityFallback = tradePositionIsOption(position)
    ? null
    : firstPositiveNumber(
        canonicalPosition?.mark,
        canonicalPosition?.marketPrice,
        position?.mark,
        position?.entry,
      );
  return firstPositiveNumber(
    snapshot?.price,
    snapshot?.mark,
    snapshot?.last,
    quoteMid(snapshot),
    underlyingMarket?.price,
    underlyingMarket?.mark,
    quoteMid(underlyingMarket),
    equityFallback,
  );
};

const tradeSpotTitle = (position, snapshotsBySymbol = {}) => {
  const symbol = resolveTradeSpotSymbol(position);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const canonicalPosition = position?._brokerPosition || position;
  const underlyingMarket =
    position?.underlyingMarket || canonicalPosition?.underlyingMarket;
  const price = resolveTradeSpotPrice(position, snapshotsBySymbol);
  const updatedAt = firstText(
    snapshot?.dataUpdatedAt,
    snapshot?.updatedAt,
    underlyingMarket?.dataUpdatedAt,
    underlyingMarket?.updatedAt,
  );
  return [
    "Underlying spot",
    price != null ? formatPriceValue(price) : null,
    updatedAt ? formatRelativeTimeShort(updatedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const resolveTradePositionSparklinePositive = (position, snapshot) => {
  const canonicalPosition = position?._brokerPosition || position;
  const underlyingMarket =
    position?.underlyingMarket || canonicalPosition?.underlyingMarket;
  const percent = firstNumber(
    snapshot?.pct,
    snapshot?.changePercent,
    underlyingMarket?.dayChangePercent,
    !tradePositionIsOption(position) ? position?.pct : null,
  );
  if (percent != null) return percent >= 0;

  const change = firstNumber(
    snapshot?.chg,
    snapshot?.change,
    underlyingMarket?.dayChange,
    !tradePositionIsOption(position) ? position?.dayChange : null,
  );
  return change != null ? change >= 0 : null;
};

const normalizeTradePositionOptionRight = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") return "C";
  if (normalized === "put" || normalized === "p") return "P";
  return null;
};

const buildTradePositionLoadIntent = (position) => {
  const ticker = normalizeTickerSymbol(position?.ticker);
  if (!ticker) return null;

  const canonicalPosition = position?._brokerPosition || position;
  const isOption = Boolean(
    position?.optionLoadContract ||
      position?.optionContract ||
      canonicalPosition?.optionContract,
  );
  if (!isOption) return { ticker, assetMode: "equity" };

  const contract = position?.optionLoadContract;
  const strike = Number(contract?.strike);
  const cp = normalizeTradePositionOptionRight(contract?.cp);
  const exp = String(contract?.exp ?? "").trim();
  if (!Number.isFinite(strike) || strike <= 0 || !cp || !exp) return null;

  return { ...contract, ticker, assetMode: "option", strike, cp, exp };
};

const resolveTradePositionsViewState = ({
  enabled = false,
  data = null,
  isPending = false,
  isError = false,
  isFetching = false,
} = {}) => {
  if (!enabled) return { kind: "idle", preserveRows: false };

  const preserveRows = data != null;
  if (!preserveRows && isPending) {
    return { kind: "loading", preserveRows: false };
  }
  if (!preserveRows && isError) {
    return { kind: "error", preserveRows: false };
  }
  if (preserveRows && isError) {
    return { kind: "stale", preserveRows: true };
  }
  if (preserveRows && isFetching) {
    return { kind: "refreshing", preserveRows: true };
  }
  return { kind: "ready", preserveRows };
};

export const __tradePositionsPanelInternalsForTests = {
  buildTradePositionFallbackSparklineData,
  buildTradePositionLoadIntent,
  resolveTradePositionSparklinePositive,
  resolveTradePositionsViewState,
  resolveTradeSpotPrice,
  resolveTradeSpotSymbol,
  tradeManagementStopBadge,
  tradeManagementTrailBadge,
};

const openPositionColumn = ({
  id,
  label,
  title = label,
  width,
  minWidth = width,
  track = null,
  align = "right",
  groupEdge = null,
}) => ({
  id,
  label,
  title,
  width,
  minWidth,
  track,
  align,
  groupEdge,
});

const OPEN_POSITION_COLUMNS = [
  openPositionColumn({ id: "ticker", label: "Tick", title: "Ticker", width: "minmax(68px, 1fr)", minWidth: "68px", align: "left" }),
  openPositionColumn({ id: "side", label: "Side", width: "minmax(32px, max-content)", minWidth: "32px", align: "center" }),
  openPositionColumn({ id: "contract", label: "Contract", width: "minmax(70px, 1fr)", minWidth: "70px", align: "left" }),
  openPositionColumn({ id: "spot", label: "Spot", title: "Underlying price", width: "minmax(40px, max-content)", minWidth: "40px" }),
  openPositionColumn({ id: "opened", label: "Open", width: "minmax(36px, max-content)", minWidth: "36px" }),
  openPositionColumn({ id: "bid", label: "Bid", width: "minmax(40px, max-content)", minWidth: "40px" }),
  openPositionColumn({ id: "ask", label: "Ask", width: "minmax(40px, max-content)", minWidth: "40px" }),
  openPositionColumn({ id: "quantity", label: "Qty", width: "minmax(30px, max-content)", minWidth: "30px" }),
  openPositionColumn({ id: "averageCost", label: "Avg", title: "Average cost", width: "minmax(40px, max-content)", minWidth: "40px" }),
  openPositionColumn({ id: "mark", label: "Mark", width: "minmax(40px, max-content)", minWidth: "40px" }),
  openPositionColumn({ id: "stop", label: "SL", title: "Stop loss", width: "minmax(52px, max-content)", minWidth: "52px", groupEdge: "start" }),
  openPositionColumn({ id: "trail", label: "TRL", title: "Trailing stop", width: "minmax(52px, max-content)", minWidth: "52px", groupEdge: "end" }),
  openPositionColumn({ id: "pnl", label: "P&L $", width: "minmax(46px, max-content)", minWidth: "46px" }),
  openPositionColumn({ id: "pnlPercent", label: "P&L %", width: "minmax(38px, max-content)", minWidth: "38px" }),
  openPositionColumn({ id: "actions", label: "", title: "Actions", width: "minmax(96px, max-content)", minWidth: "96px", align: "center" }),
];
const OPEN_POSITION_COLUMN_BY_ID = new Map(OPEN_POSITION_COLUMNS.map((column) => [column.id, column]));
const openPositionColumnWidth = (column) => {
  const width = Number.parseFloat(String(column?.minWidth ?? column?.width ?? ""));
  return Number.isFinite(width) ? width : 0;
};
const OPEN_POSITION_GRID_TEMPLATE = OPEN_POSITION_COLUMNS.map(
  (column) => column.track || column.width,
).join(" ");
const OPEN_POSITION_TABLE_MIN_WIDTH = OPEN_POSITION_COLUMNS.reduce(
  (sum, column) => sum + openPositionColumnWidth(column),
  0,
);
const EXECUTION_GRID_TEMPLATE = "40px 30px minmax(0,1fr) 24px 50px 64px 42px";
const EXECUTION_TABLE_MIN_WIDTH = 460;
const LIVE_ORDER_GRID_TEMPLATE = "42px 30px 44px 22px 28px 58px 42px";
const LIVE_ORDER_TABLE_MIN_WIDTH = 416;

const tradeVisualAlign = (align = "right") => (align === "right" ? "center" : align);

const tradeNumericCellStyle = (color = CSS_COLOR.textSec) => ({
  color,
  textAlign: "center",
  fontFamily: T.data,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const tradeOpenPositionBoundaryStyle = (column = {}) => ({
  borderLeft: column.groupEdge === "start" ? `1px solid ${CSS_COLOR.border}` : undefined,
  borderRight:
    column.groupEdge === "end"
      ? `1px solid ${CSS_COLOR.border}`
      : `1px solid ${cssColorMix(CSS_COLOR.border, 10)}`,
  boxSizing: "border-box",
});

const tradeOpenPositionHeaderCellStyle = (column) => ({
  ...tradeOpenPositionBoundaryStyle(column),
  minWidth: 0,
  padding: sp("2px 3px"),
  color: CSS_COLOR.textMuted,
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  letterSpacing: 0,
  textAlign: tradeVisualAlign(column.align),
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const tradeOpenPositionCellStyle = (id, color = CSS_COLOR.textSec, extra = {}) => {
  const column = OPEN_POSITION_COLUMN_BY_ID.get(id) || {};
  const alignedStyle =
    column.align === "right"
      ? tradeNumericCellStyle(color)
      : {
          color,
          textAlign: tradeVisualAlign(column.align || "left"),
          fontFamily: T.sans,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        };
  return {
    ...tradeOpenPositionBoundaryStyle(column),
    minWidth: 0,
    padding: sp("2px 3px"),
    ...alignedStyle,
    ...extra,
  };
};

const tradePnlTone = (value) =>
  !isFiniteNumber(value) ? CSS_COLOR.textDim : value >= 0 ? CSS_COLOR.green : CSS_COLOR.red;

const tradeSignedMoney = (value) =>
  isFiniteNumber(value) ? `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}` : MISSING_VALUE;

const tradeManagementPrice = (level) =>
  level?.price != null ? formatPriceValue(level.price) : MISSING_VALUE;

const tradeManagementDistanceLabel = (management) => {
  if (!isFiniteNumber(management?.riskDistancePct)) return MISSING_VALUE;
  return `${Math.abs(management.riskDistancePct).toFixed(1)}${
    management.riskDistancePct <= 0 ? "% past" : "% away"
  }`;
};

function tradeManagementStopBadge(management) {
  if (!management.stop) return null;
  return formatSignedPercent(management.stopProjectedReturnPct, 1);
}

function tradeManagementTrailBadge(management) {
  if (!management.trail) return null;
  return formatSignedPercent(management.trailProjectedReturnPct, 1);
}

const TradeManagementLevelCell = ({ value, badge, badgeTone = CSS_COLOR.textDim }) => (
  <span
    style={{
      position: "relative",
      display: "block",
      minWidth: 0,
      minHeight: dim(19),
      paddingTop: badge ? dim(6) : 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
  >
    {badge ? (
      <span
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          maxWidth: "100%",
          color: badgeTone,
          fontFamily: T.data,
          fontSize: fs(9),
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {badge}
      </span>
    ) : null}
    <span>{value}</span>
  </span>
);

const tradeManagementTone = (management) => {
  if (management.status === "breached") return CSS_COLOR.red;
  if (isFiniteNumber(management.riskDistancePct) && management.riskDistancePct <= 10) {
    return CSS_COLOR.amber;
  }
  return CSS_COLOR.textSec;
};

const TradeSpotPriceCell = ({ position, snapshotsBySymbol }) => {
  const spotPrice = resolveTradeSpotPrice(position, snapshotsBySymbol);
  const flashClassName = useValueFlash(spotPrice);
  return (
    <AppTooltip content={tradeSpotTitle(position, snapshotsBySymbol)}>
      <span
        style={tradeOpenPositionCellStyle(
          "spot",
          isFiniteNumber(spotPrice) ? CSS_COLOR.text : CSS_COLOR.textDim,
        )}
      >
        <span
          className={flashClassName}
          style={{
            display: "inline-flex",
            justifyContent: "center",
            maxWidth: "100%",
            padding: sp("1px 2px"),
            borderRadius: dim(RADII.xs),
            whiteSpace: "nowrap",
          }}
        >
          {isFiniteNumber(spotPrice) ? formatPriceValue(spotPrice) : MISSING_VALUE}
        </span>
      </span>
    </AppTooltip>
  );
};

const tradePositionOrders = (position, liveOrders) => {
  const rowOrders = Array.isArray(position?.openOrders) ? position.openOrders : [];
  const brokerOrders = Array.isArray(position?._brokerPosition?.openOrders)
    ? position._brokerPosition.openOrders
    : [];
  const liveMatches = position?._brokerPosition
    ? liveOrders.filter((order) =>
        orderMatchesManagementPosition(position._brokerPosition, order),
      )
    : [];
  return [...rowOrders, ...brokerOrders, ...liveMatches];
};

const tradeManagementForPosition = (position, liveOrders) =>
  buildPositionTradeManagement(position._brokerPosition || position, {
    openOrders: tradePositionOrders(position, liveOrders),
    mark: position.mark ?? position.entry,
    quantity: position.side === "SHORT" ? -position.qty : position.qty,
    side: position.side,
    localStopLoss: position.sl,
  });

const tradePositionDisplay = (position) =>
  buildPositionDisplayModel({
    ...position,
    quantity: position?.qty ?? position?.quantity,
    averageCost: position?.entry ?? position?.averageCost,
    averagePrice: position?.entry ?? position?.averagePrice,
    mark: position?.mark ?? position?.marketPrice,
  });

const formatTradeSpread = (quote) =>
  formatPositionSpreadLabel(quote, (value) => `${value.toFixed(1)}%`);

const TradePositionSparkline = ({ position, snapshotsBySymbol }) => {
  const symbol = normalizeTickerSymbol(position?.ticker);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const data = resolveTradePositionSparklineData(snapshot, position, symbol);
  if (data.length < 2) return null;

  return (
    <AppTooltip content={`${symbol} intraday trend`}>
      <span
        data-testid="trade-position-sparkline"
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: dim(34),
          height: dim(11),
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <MicroSparkline
          data={data}
          positive={resolveTradePositionSparklinePositive(position, snapshot)}
          width={34}
          height={11}
          style={{ width: "100%", height: "100%" }}
          ariaHidden
        />
      </span>
    </AppTooltip>
  );
};

export const TradePositionsPanel = ({
  accountId,
  accountProvider = "unknown",
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IBKR Client Portal must be connected before trading.",
  onLoadPosition,
  isVisible = false,
  safeQaMode = false,
  streamingPaused = false,
}) => {
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const pos = usePositions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("open");
  const directIbkrAccount =
    String(accountProvider ?? "").trim().toLowerCase() === "ibkr";
  const brokerAccountMode = directIbkrAccount ? "live" : environment;
  const brokerPanelEnabled = Boolean(
    isVisible &&
      !safeQaMode &&
      brokerAuthenticated &&
      accountId &&
      directIbkrAccount,
  );
  const positionsQuery = useGetAccountPositions(
    accountId || "",
    { mode: brokerAccountMode, liveQuotes: false, detail: "full" },
    {
      query: {
        enabled: brokerPanelEnabled,
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const positionsViewState = resolveTradePositionsViewState({
    enabled: brokerPanelEnabled,
    data: positionsQuery.data,
    isPending: positionsQuery.isPending,
    isError: positionsQuery.isError,
    isFetching: positionsQuery.isFetching,
  });
  const ordersQuery = useListOrders(
    { accountId, mode: brokerAccountMode },
    {
      query: {
        enabled: brokerPanelEnabled,
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const executionsQuery = useQuery({
    queryKey: ["broker-executions", accountId, brokerAccountMode],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        days: 7,
      }),
    enabled: brokerPanelEnabled,
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerPanelEnabled ||
      streamingPaused ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      days: "7",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = normalizeBrokerExecutionsPayload(JSON.parse(event.data));
        queryClient.setQueryData(
          ["broker-executions", accountId, brokerAccountMode],
          payload,
        );
      } catch {}
    };

    source.addEventListener("executions", handleExecutions);
    return () => {
      source.removeEventListener("executions", handleExecutions);
      source.close();
    };
  }, [
    accountId,
    brokerAccountMode,
    brokerPanelEnabled,
    queryClient,
    streamingPaused,
  ]);
  const gatewayActionDisabled = !gatewayTradingReady;
  const notifyGatewayTradingUnavailable = () => {
    toast.push({
      kind: "warn",
      title: "IBKR session unavailable",
      body: gatewayTradingMessage,
    });
  };
  const openPositions = useMemo(() => {
    if (brokerConfigured) {
      if (!brokerAuthenticated || !accountId) {
        return [];
      }

      return (positionsQuery.data?.positions || []).filter(isOpenPositionRow).map((position) => {
        const isOption = Boolean(position.optionContract);
        const marketDataTicker =
          normalizeTickerSymbol(
            position.marketDataSymbol ||
              position.optionContract?.underlying ||
              position.symbol,
          ) || position.symbol;
        const optionRight = normalizeTradePositionOptionRight(
          position.optionContract?.right,
        );
        const contract = isOption
          ? formatOptionContractLabel(position.optionContract, {
              includeSymbol: false,
            })
          : "EQUITY";

        return {
          _isUser: false,
          _isLive: true,
          _id: position.id,
          _brokerPosition: position,
          ticker: marketDataTicker,
          marketDataSymbol: marketDataTicker,
          underlyingMarket: position.underlyingMarket ?? null,
          side: position.quantity >= 0 ? "LONG" : "SHORT",
          contract,
          optionContract: position.optionContract ?? null,
          openOrders: position.openOrders ?? [],
          optionLoadContract: isOption && optionRight
            ? {
                strike: position.optionContract.strike,
                cp: optionRight,
                exp: formatExpirationLabel(position.optionContract.expirationDate),
                providerContractId:
                  position.optionContract.providerContractId || null,
              }
            : null,
          qty: Math.abs(position.quantity),
          entry: position.averageCost,
          mark: position.mark,
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
          openedAt: position.openedAt ?? null,
          openedAtSource: position.openedAtSource ?? null,
          quote: position.quote ?? position.optionQuote ?? null,
          sl:
            position.riskOverlay?.activeStopPrice ??
            position.stopLoss ??
            position.automationContext?.activeStopPrice ??
            position.automationContext?.stopLossPrice ??
            position.automationContext?.stopPrice ??
            null,
        };
      });
    }

    return pos.positions.map((p) => {
      const optionRight = normalizeTradePositionOptionRight(p.cp);
      const optionLoadContract =
        p.kind === "option" && optionRight
          ? {
              strike: p.strike,
              cp: optionRight,
              exp: p.exp,
            }
          : null;
      const optionContractLabel = optionLoadContract
        ? formatOptionContractLabel(
            {
              ticker: p.ticker,
              symbol: p.ticker,
              expirationDate: p.exp,
              exp: p.exp,
              strike: p.strike,
              right: p.cp,
              cp: p.cp,
            },
            { includeSymbol: false },
          )
        : null;
      const optionContract =
        p.kind === "option"
          ? {
              ticker: p.ticker,
              underlying: p.ticker,
              expirationDate: p.exp,
              strike: p.strike,
              right: String(p.cp ?? "").toUpperCase().startsWith("P") ? "put" : "call",
              multiplier: 100,
              sharesPerContract: 100,
            }
          : null;

      return {
        _isUser: true,
        _isLive: false,
        _id: p.id,
        _position: p,
        ticker: p.ticker,
        side:
          p.kind === "option" ? (p.side === "BUY" ? "LONG" : "SHORT") : p.side,
        contract:
          p.kind === "option"
            ? optionContractLabel
            : `${p.side} EQUITY`,
        optionContract,
        openOrders: [],
        optionLoadContract,
        qty: p.qty,
        entry: p.entry,
        mark: null,
        pnl: null,
        pct: null,
        openedAt: p.openedAt ?? p.createdAt ?? null,
        openedAtSource: p.openedAt || p.createdAt ? "manual" : null,
        quote: null,
        sl: p.stopLoss ?? +(p.entry * 0.65).toFixed(2),
      };
    });
  }, [
    accountId,
    brokerAuthenticated,
    brokerConfigured,
    pos.positions,
    positionsQuery.data,
  ]);
  const openPositionSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          openPositions
            .map(resolveTradeSpotSymbol)
            .filter(Boolean),
        ),
      ),
    [openPositions],
  );
  const tickerSnapshotsBySymbol = useRuntimeTickerSnapshots(openPositionSymbols);
  const liveOrders = useMemo(
    () =>
      [...(ordersQuery.data?.orders || [])].sort((left, right) => {
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      }),
    [ordersQuery.data],
  );
  const executionRows = useMemo(
    () =>
      (executionsQuery.data?.executions || []).map((execution) => ({
        id: execution.id,
        ticker: execution.symbol,
        side: String(execution.side || "").toLowerCase() === "buy" ? "BUY" : "SELL",
        contract: formatExecutionContractLabel(execution),
        qty: execution.quantity,
        price: execution.price,
        netAmount: execution.netAmount,
        exchange: execution.exchange,
        executedAt: execution.executedAt,
      })),
    [executionsQuery.data],
  );

  const totalOpenPnl = openPositions.reduce(
    (sum, position) =>
      sum + (isFiniteNumber(position.pnl) ? position.pnl : 0),
    0,
  );
  const hasOpenPnl = openPositions.some((position) => isFiniteNumber(position.pnl));
  const pendingOrderCount = liveOrders.filter(
    (order) => !FINAL_ORDER_STATUSES.has(order.status),
  ).length;
  const historyCount = executionRows.length;
  const headerSummaryColor =
    tab === "orders"
      ? pendingOrderCount > 0
        ? CSS_COLOR.amber
        : CSS_COLOR.textDim
      : tab === "history" && brokerConfigured
        ? historyCount > 0
          ? CSS_COLOR.accent
          : CSS_COLOR.textDim
        : hasOpenPnl
          ? totalOpenPnl >= 0
            ? CSS_COLOR.green
            : CSS_COLOR.red
          : CSS_COLOR.textDim;
  const headerSummaryValue =
    tab === "orders"
      ? `${pendingOrderCount} LIVE`
      : tab === "history" && brokerConfigured
        ? `${historyCount} FILLS`
        : hasOpenPnl
          ? `${totalOpenPnl >= 0 ? "+" : ""}$${totalOpenPnl.toFixed(0)}`
          : MISSING_VALUE;

  const closeRow = async (p, closeLoadIntent, disabledReason) => {
    if (p._isLive && p._brokerPosition) {
      if (gatewayActionDisabled) {
        notifyGatewayTradingUnavailable();
        return;
      }
      if (!closeLoadIntent || !onLoadPosition) {
        toast.push({
          kind: "warn",
          title: "Close review unavailable",
          body: disabledReason || "This position cannot be safely loaded into the close-review ticket.",
        });
        return;
      }
      onLoadPosition?.(closeLoadIntent);
      return;
    }

    if (p._isUser) {
      pos.closePosition(p._id);
    }
    toast.push({
      kind: "success",
      title: "Position closed",
      body: `${p.ticker} ${p.contract}`,
    });
  };

  const handleCloseAll = () => {
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to close",
        body: "No open positions.",
      });
      return;
    }

    pos.closeAll();
    toast.push({
      kind: "success",
      title: `Closed ${openPositions.length} position${openPositions.length === 1 ? "" : "s"}`,
      body: "Local positions removed.",
    });
  };

  const handleSetStops = () => {
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "No positions",
        body: "Nothing to protect.",
      });
      return;
    }

    const userPositions = openPositions.filter((p) => p._isUser);
    userPositions.forEach((p) => {
      pos.updateStops(p._id, {
        stopLoss: +(p.entry * 0.8).toFixed(2),
        takeProfit: +(p.entry * 1.5).toFixed(2),
      });
    });
    toast.push({
      kind: "success",
      title: "Stops applied",
      body: `Protected ${userPositions.length} local position${userPositions.length === 1 ? "" : "s"}.`,
    });
  };

  const handleProtectRow = (p) => {
    if (p._isUser) {
      pos.updateStops(p._id, {
        stopLoss: +(p.entry * 0.8).toFixed(2),
        takeProfit: +(p.entry * 1.5).toFixed(2),
      });
      toast.push({
        kind: "success",
        title: "Stops applied",
        body: `${p.ticker} ${p.contract} local risk levels updated.`,
      });
    }
  };

  return (
    <div
      style={{
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        padding: sp("12px 14px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(8),
        overflow: "hidden",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          paddingBottom: sp(4),
          gap: sp(4),
        }}
      >
        <div
          style={{
            display: "flex",
            gap: sp(5),
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <SegmentedControl
            ariaLabel="Trade positions view"
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "open",
                label: (
                  <>
                    OPEN{" "}
                    <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular }}>
                      {openPositions.length}
                    </span>
                  </>
                ),
              },
              {
                value: "history",
                label: (
                  <>
                    HIST{" "}
                    <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular }}>
                      {historyCount}
                    </span>
                  </>
                ),
              },
              {
                value: "orders",
                label: (
                  <>
                    ORDERS{" "}
                    <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular }}>
                      {brokerConfigured ? liveOrders.length : 0}
                    </span>
                  </>
                ),
              },
            ]}
          />
        </div>
        <span
          style={{
            fontSize: fs(10),
            fontWeight: FONT_WEIGHTS.regular,
            fontFamily: T.sans,
            color: headerSummaryColor,
            whiteSpace: "nowrap",
          }}
        >
          {headerSummaryValue}
        </span>
      </div>
      {gatewayActionDisabled ? (
        <DataUnavailableState
          variant="warning"
          title={gatewayTradingMessage}
          detail=""
        />
      ) : null}
      {tab === "open" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {positionsViewState.kind === "stale" ||
          positionsViewState.kind === "refreshing" ? (
            <div
              role={positionsViewState.kind === "stale" ? "alert" : "status"}
              data-testid="trade-positions-data-status"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                minHeight: dim(28),
                padding: sp("4px 8px"),
                borderLeft: `2px solid ${
                  positionsViewState.kind === "stale"
                    ? CSS_COLOR.amber
                    : CSS_COLOR.accent
                }`,
                background: cssColorMix(
                  positionsViewState.kind === "stale"
                    ? CSS_COLOR.amber
                    : CSS_COLOR.accent,
                  5,
                ),
                color:
                  positionsViewState.kind === "stale"
                    ? CSS_COLOR.amber
                    : CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              <span>
                {positionsViewState.kind === "stale"
                  ? "Showing last positions · refresh failed"
                  : "Refreshing positions"}
              </span>
              {positionsViewState.kind === "stale" ? (
                <button
                  type="button"
                  className="ra-touch-target-y"
                  onClick={() => void positionsQuery.refetch()}
                  style={{
                    border: `1px solid ${CSS_COLOR.border}`,
                    background: CSS_COLOR.bg1,
                    color: CSS_COLOR.textSec,
                    borderRadius: dim(RADII.xs),
                    padding: sp("4px 8px"),
                    fontSize: textSize("caption"),
                    fontFamily: T.sans,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {brokerConfigured && !brokerAuthenticated ? (
            <DataUnavailableState
              fill
              variant="warning"
              title="IBKR authentication required"
              detail="IBKR is configured, but live positions stay hidden until Client Portal authenticates."
            />
          ) : brokerConfigured && !directIbkrAccount ? (
            <DataUnavailableState
              fill
              variant="warning"
              title="Select a direct IBKR account"
              detail="Live position management is available only when the selected account is bound to Interactive Brokers."
            />
          ) : brokerConfigured && !accountId ? (
            <DataUnavailableState
              fill
              variant="warning"
              title="No active IBKR account"
              detail="The Client Portal session is authenticated, but no IBKR account is active yet."
            />
          ) : positionsViewState.kind === "loading" ? (
            <DataUnavailableState
              fill
              loading
              variant="info"
              title="Loading open positions"
              detail="Requesting positions for the active IBKR account."
            />
          ) : positionsViewState.kind === "error" ? (
            <DataUnavailableState
              fill
              variant="error"
              title="Positions unavailable"
              detail="The active IBKR account could not be read. Retry without leaving Trade."
              action={
                <button
                  type="button"
                  className="ra-touch-target-y"
                  onClick={() => void positionsQuery.refetch()}
                  style={{
                    border: `1px solid ${cssColorMix(CSS_COLOR.red, 33)}`,
                    background: CSS_COLOR.bg1,
                    color: CSS_COLOR.text,
                    borderRadius: dim(RADII.xs),
                    padding: sp("4px 10px"),
                    fontSize: textSize("caption"),
                    fontFamily: T.sans,
                    cursor: "pointer",
                  }}
                >
                  Retry positions
                </button>
              }
            />
          ) : openPositions.length === 0 ? (
            <DataUnavailableState
              fill
              title="No open positions"
              detail="Open positions appear here once trades are filled on the active account."
            />
          ) : (
            <div
              data-testid="trade-open-positions-table-scroll"
              className="ra-hide-scrollbar ra-dense-table-scroll"
              style={{ overflowX: "auto" }}
            >
              <div
                role="table"
                aria-label="Open trade positions"
                style={{ minWidth: dim(OPEN_POSITION_TABLE_MIN_WIDTH) }}
              >
                <div
                  role="row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: OPEN_POSITION_GRID_TEMPLATE,
                    gap: 0,
                    borderTop: `1px solid ${CSS_COLOR.border}`,
                    borderBottom: `1px solid ${CSS_COLOR.border}`,
                  }}
                >
                  {OPEN_POSITION_COLUMNS.map((column) => (
                    <AppTooltip key={column.id} content={column.title}>
                      <span
                        role="columnheader"
                        style={tradeOpenPositionHeaderCellStyle(column)}
                      >
                        {column.label}
                      </span>
                    </AppTooltip>
                  ))}
                </div>
              {openPositions.map((p, rowIndex) => {
                const loadIntent = buildTradePositionLoadIntent(p);
                const isLoadable = Boolean(loadIntent && onLoadPosition);
                const closeReview = p._isLive
                  ? buildIbkrCloseReviewIntent({
                      accountId,
                      provider: accountProvider,
                      position: p._brokerPosition,
                    })
                  : null;
                const closeLoadIntent =
                  loadIntent && closeReview?.intent
                    ? {
                        ...loadIntent,
                        closeReviewIntent: closeReview.intent,
                      }
                    : null;
                const closeDisabled = p._isLive
                  ? gatewayActionDisabled || !closeLoadIntent || !onLoadPosition
                  : false;
                const closeDisabledReason = gatewayActionDisabled
                  ? gatewayTradingMessage
                  : closeReview?.reason ||
                    (!onLoadPosition
                      ? "The trade ticket is unavailable."
                      : "This position cannot be loaded into a close review.");
                const display = tradePositionDisplay(p);
                const spread = formatTradeSpread(display.quote);
                const quoteFreshness = formatPositionQuoteFreshnessLabel(display.quote);
                const bidText =
                  display.quote?.bid != null ? formatPriceValue(display.quote.bid) : MISSING_VALUE;
                const askText =
                  display.quote?.ask != null ? formatPriceValue(display.quote.ask) : MISSING_VALUE;
                const entryText = isFiniteNumber(p.entry) ? formatPriceValue(p.entry) : MISSING_VALUE;
                const markText = isFiniteNumber(p.mark) ? formatPriceValue(p.mark) : MISSING_VALUE;
                const openedText = display.openedLabel || MISSING_VALUE;
                const management = tradeManagementForPosition(p, liveOrders);
                const linkedWorkingOrders = tradePositionOrders(p, liveOrders).filter(
                  (order) => !FINAL_ORDER_STATUSES.has(order.status),
                );
                const managementTitle = [
                  management.stop
                    ? `${management.trail ? "HSL" : "SL"} ${tradeManagementPrice(management.stop)}`
                    : null,
                  management.trail ? `TRL ${tradeManagementPrice(management.trail)}` : null,
                  isFiniteNumber(management.riskDistancePct)
                    ? `Distance ${tradeManagementDistanceLabel(management)}`
                    : null,
                  management.riskAmount != null
                    ? `Risk $${management.riskAmount.toFixed(0)}`
                    : null,
                  management.statusLabel,
                ].filter(Boolean).join(" · ");
                const rowBackground = rowIndex % 2
                  ? cssColorMix(CSS_COLOR.bg1, 72)
                  : "transparent";
                const loadPositionIntoTicket = () => {
                  if (!isLoadable) return;
                  onLoadPosition(loadIntent);
                };
                return (
                  <div
		                  key={p._id}
                    role="row"
		                    style={{
	                      display: "grid",
	                      gridTemplateColumns: OPEN_POSITION_GRID_TEMPLATE,
	                      gap: 0,
                      padding: sp("1px 0"),
                      fontSize: textSize("caption"),
                      fontFamily: T.sans,
                      borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
                      alignItems: "center",
                      background: rowBackground,
                      boxShadow: p._isUser ? `inset 1px 0 0 ${CSS_COLOR.accent}` : "none",
                    }}
                  >
	                    <span
	                      style={tradeOpenPositionCellStyle("ticker", CSS_COLOR.text, {
	                        display: "inline-flex",
	                        alignItems: "center",
	                        gap: sp(4),
	                        fontWeight: FONT_WEIGHTS.regular,
	                      })}
	                    >
	                      <TradePositionSparkline
	                        position={p}
	                        snapshotsBySymbol={tickerSnapshotsBySymbol}
	                      />
	                      <span
	                        style={{
	                          minWidth: 0,
	                          overflow: "hidden",
	                          textOverflow: "ellipsis",
	                          whiteSpace: "nowrap",
	                        }}
	                      >
	                        {p.ticker}
	                      </span>
                    </span>
                    <span
                      style={tradeOpenPositionCellStyle("side", CSS_COLOR.textSec, {
                        fontWeight: FONT_WEIGHTS.regular,
                        fontSize: textSize("caption"),
                        padding: sp("1px 4px"),
                        background: CSS_COLOR.bg0,
                        borderRadius: dim(RADII.xs),
                        border: `1px solid ${CSS_COLOR.border}`,
                        textAlign: "center",
                        alignSelf: "center",
                      })}
                    >
                      {p.side}
                    </span>
                    <span style={tradeOpenPositionCellStyle("contract", CSS_COLOR.textSec)}>
                      {p.contract}
                    </span>
                    <TradeSpotPriceCell
                      position={p}
                      snapshotsBySymbol={tickerSnapshotsBySymbol}
                    />
                    <AppTooltip content={[display.ageLabel, display.openedSourceLabel].filter(Boolean).join(" · ") || undefined}>
                      <span
                        style={tradeOpenPositionCellStyle(
                          "opened",
                          display.openedLabel ? CSS_COLOR.textSec : CSS_COLOR.textDim,
                        )}
                      >
                        {openedText}
                      </span>
                    </AppTooltip>
                    <AppTooltip content={[spread, quoteFreshness].filter(Boolean).join(" · ")}>
                      <span
                        style={tradeOpenPositionCellStyle(
                          "bid",
                          display.quote?.bid != null ? CSS_COLOR.textSec : CSS_COLOR.textDim,
                        )}
                      >
                        {bidText}
                      </span>
                    </AppTooltip>
                    <AppTooltip content={[spread, quoteFreshness].filter(Boolean).join(" · ")}>
                      <span
                        style={tradeOpenPositionCellStyle(
                          "ask",
                          display.quote?.ask != null ? CSS_COLOR.textSec : CSS_COLOR.textDim,
                        )}
                      >
                        {askText}
                      </span>
                    </AppTooltip>
                    <span style={tradeOpenPositionCellStyle("quantity", CSS_COLOR.textDim)}>
                      {p.qty}
                    </span>
                    <span style={tradeOpenPositionCellStyle("averageCost", CSS_COLOR.textSec)}>
                      {entryText}
                    </span>
                    <span style={tradeOpenPositionCellStyle("mark", CSS_COLOR.text)}>
                      {markText}
                    </span>
                    <AppTooltip content={managementTitle}>
                      <span
                        style={tradeOpenPositionCellStyle(
                          "stop",
                          management.stop
                            ? management.trail
                              ? CSS_COLOR.textSec
                              : tradeManagementTone(management)
                            : CSS_COLOR.textDim,
                        )}
                      >
                        <TradeManagementLevelCell
                          value={tradeManagementPrice(management.stop)}
                          badge={tradeManagementStopBadge(management)}
                          badgeTone={tradePnlTone(management.stopProjectedReturnPct)}
                        />
                      </span>
                    </AppTooltip>
                    <AppTooltip content={managementTitle}>
                      <span
                        style={tradeOpenPositionCellStyle(
                          "trail",
                          management.trail ? tradeManagementTone(management) : CSS_COLOR.textDim,
                        )}
                      >
                        <TradeManagementLevelCell
                          value={tradeManagementPrice(management.trail)}
                          badge={tradeManagementTrailBadge(management)}
                          badgeTone={tradePnlTone(management.trailProjectedReturnPct)}
                        />
                      </span>
                    </AppTooltip>
                    <span style={tradeOpenPositionCellStyle("pnl", tradePnlTone(p.pnl))}>
                      {tradeSignedMoney(p.pnl)}
                    </span>
                    <span style={tradeOpenPositionCellStyle("pnlPercent", tradePnlTone(p.pct))}>
                      {formatSignedPercent(p.pct, 1)}
                    </span>
                    <span
                      style={tradeOpenPositionCellStyle("actions", CSS_COLOR.textSec, {
                        display: "inline-flex",
                        justifyContent: "center",
                        overflow: "visible",
                        padding: 0,
                      })}
                    >
                      <PositionRowActionMenu
                        testId="trade-position-row-action-menu"
                        symbol={p.ticker}
                        contractLabel={p.contract}
                        sideLabel={p.side}
                        statusText={management.statusLabel}
                        primaryAction={{
                          id: "trade",
                          label: "Trade",
                          description: isLoadable
                            ? `Load ${p.ticker} ${p.contract} into the order ticket`
                            : "This position cannot be loaded into the order ticket",
                          Icon: Ticket,
                          onSelect: loadPositionIntoTicket,
                          disabled: !isLoadable,
                        }}
                        quoteItems={[
                          {
                            label: "Mark",
                            value: markText,
                          },
                          {
                            label: "Bid / Ask",
                            value: `${bidText} / ${askText}`,
                          },
                          {
                            label: "P&L",
                            value: tradeSignedMoney(p.pnl),
                            tone: tradePnlTone(p.pnl),
                          },
                          {
                            label: "Stop",
                            value: tradeManagementPrice(management.stop),
                            tone: management.stop ? tradeManagementTone(management) : CSS_COLOR.textMuted,
                          },
                        ]}
                        utilityActions={[
                          {
                            id: "orders",
                            label: linkedWorkingOrders.length
                              ? `${linkedWorkingOrders.length} order${linkedWorkingOrders.length === 1 ? "" : "s"}`
                              : "Orders",
                            description: linkedWorkingOrders.length
                              ? "Open the live order blotter"
                              : "No linked working orders",
                            Icon: ClipboardList,
                            onSelect: () => setTab("orders"),
                            disabled: !linkedWorkingOrders.length,
                            tone: "warning",
                          },
                          p._isLive
                            ? null
                            : {
                                id: "protect",
                                label: "Protect",
                                description: "Update local protective levels",
                                Icon: ShieldCheck,
                                onSelect: () => handleProtectRow(p),
                                disabled: false,
                                tone: "success",
                              },
                        ]}
                        managementActions={[
                          {
                            id: "close",
                            label: "Close position",
                            description: closeDisabled
                              ? closeDisabledReason
                              : p._isLive
                                ? "Review an account-bound DAY limit order before anything is submitted"
                                : "Close local position",
                            Icon: XCircle,
                            onSelect: () =>
                              closeRow(p, closeLoadIntent, closeDisabledReason),
                            disabled: closeDisabled,
                            tone: "danger",
                          },
                        ]}
                      />
                    </span>
                  </div>
                );
              })}
              </div>
            </div>
          )}
        </div>
      ) : tab === "history" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {!brokerConfigured ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
              padding: sp(16),
              textAlign: "center",
            }}
          >
              No broker history is available until IBKR Client Portal is configured and fills exist on the selected account.
            </div>
          ) : !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Connect IBKR Client Portal to load broker fills.
            </div>
          ) : !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The Client Portal session is authenticated, but no IBKR account is active yet.
            </div>
          ) : executionsQuery.isPending && !executionRows.length ? (
            <DataUnavailableState
              title="Loading broker fills"
              detail="Requesting broker execution history for the active account."
              loading
              loadingEndpoint="/api/ibkr/executions"
              tone={CSS_COLOR.accent}
            />
          ) : !executionRows.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No broker executions
            </div>
          ) : (
            <div
              data-testid="trade-executions-table-scroll"
              className="ra-hide-scrollbar ra-dense-table-scroll"
              style={{ overflowX: "auto" }}
            >
              <div
                role="table"
                aria-label="Broker executions"
                style={{ minWidth: dim(EXECUTION_TABLE_MIN_WIDTH) }}
              >
              <div
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: EXECUTION_GRID_TEMPLATE,
                  gap: sp(3),
                  fontSize: textSize("caption"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
                  padding: sp("0 4px"),
                }}
              >
                <span role="columnheader">SYM</span>
                <span role="columnheader">SIDE</span>
                <span role="columnheader">CONTRACT</span>
                <span role="columnheader" style={{ textAlign: "right" }}>QTY</span>
                <span role="columnheader" style={{ textAlign: "right" }}>PRICE</span>
                <span role="columnheader" style={{ textAlign: "right" }}>NET</span>
                <span role="columnheader" style={{ textAlign: "right" }}>TIME</span>
              </div>
              {executionRows.map((execution) => (
                <div
	                  key={execution.id}
                    role="row"
	                  style={{
	                    display: "grid",
	                    gridTemplateColumns: EXECUTION_GRID_TEMPLATE,
                    gap: sp(3),
                    padding: sp("3px 4px"),
                    fontSize: textSize("caption"),
                    fontFamily: T.sans,
                    borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.text }}>
                    {execution.ticker}
                  </span>
                  <span
                    style={{
                      color: execution.side === "BUY" ? TRADE_BUY_TONE : TRADE_SELL_TONE,
                      fontWeight: FONT_WEIGHTS.regular,
                    }}
                  >
                    {execution.side}
                  </span>
                  <AppTooltip content={execution.contract}><span
                    style={{
                      color: CSS_COLOR.textSec,
                      fontSize: textSize("body"),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {execution.contract}
                  </span></AppTooltip>
                  <span style={{ color: CSS_COLOR.textDim, textAlign: "right" }}>
                    {execution.qty}
                  </span>
                  <span style={{ color: CSS_COLOR.textDim, textAlign: "right" }}>
                    {isFiniteNumber(execution.price)
                      ? execution.price.toFixed(2)
                      : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color:
                        !isFiniteNumber(execution.netAmount)
                          ? CSS_COLOR.textDim
                          : execution.netAmount >= 0
                            ? CSS_COLOR.green
                            : CSS_COLOR.red,
                      textAlign: "right",
                    }}
                    >
                      {isFiniteNumber(execution.netAmount)
                        ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(execution.netAmount).toFixed(0)}`
                        : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color: CSS_COLOR.textDim,
                      textAlign: "right",
                      fontSize: textSize("caption"),
                    }}
                  >
                    {formatAppTimeForPreferences(
                      execution.executedAt,
                      userPreferences,
                    )}
                  </span>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {!brokerConfigured ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The live order blotter activates after IBKR is configured.
            </div>
          ) : !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Connect IBKR Client Portal to load live IBKR
              orders.
            </div>
          ) : !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The Client Portal session is authenticated, but no IBKR account is active yet.
            </div>
          ) : ordersQuery.isPending && !liveOrders.length ? (
            <DataUnavailableState
              title="Loading live orders"
              detail="Requesting live IBKR orders for the active account."
              loading
              loadingEndpoint="/api/ibkr/orders"
              tone={CSS_COLOR.accent}
            />
          ) : !liveOrders.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: CSS_COLOR.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No broker orders
            </div>
          ) : (
            <div
              data-testid="trade-live-orders-table-scroll"
              className="ra-hide-scrollbar ra-dense-table-scroll"
              style={{ overflowX: "auto" }}
            >
              <div
                role="table"
                aria-label="Live broker orders"
                style={{ minWidth: dim(LIVE_ORDER_TABLE_MIN_WIDTH) }}
              >
              <div
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: LIVE_ORDER_GRID_TEMPLATE,
                  gap: sp(3),
                  fontSize: textSize("caption"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
                  padding: sp("0 4px"),
                }}
              >
                <span role="columnheader">SYM</span>
                <span role="columnheader">SIDE</span>
                <span role="columnheader">TYPE</span>
                <span role="columnheader" style={{ textAlign: "right" }}>QTY</span>
                <span role="columnheader" style={{ textAlign: "right" }}>FILL</span>
                <span role="columnheader" style={{ textAlign: "right" }}>STATUS</span>
                <span role="columnheader" style={{ textAlign: "right" }}>TIME</span>
              </div>
              {liveOrders.map((order) => {
                const orderRowId = getTradeLiveOrderRowId(order);
                const isOption = Boolean(order.optionContract);
                const contractLabel = isOption
                  ? formatOptionContractLabel(order.optionContract, {
                      symbol: order.symbol,
                    })
                  : order.symbol;
                const loadOrderIntoTicket = () => {
                  if (!isOption) return;
                  onLoadPosition?.({
                    ticker: order.symbol,
                    strike: order.optionContract.strike,
                    cp: order.optionContract.right === "call" ? "C" : "P",
                    exp: formatExpirationLabel(
                      order.optionContract.expirationDate,
                    ),
                  });
                };
                return (
                  <AppTooltip key={orderRowId} content={
                      isOption
                        ? `Load ${contractLabel} into Order Ticket`
                        : order.id
                    }><div
                    role="row"
                    style={{
	                      display: "grid",
	                      gridTemplateColumns: LIVE_ORDER_GRID_TEMPLATE,
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: textSize("caption"),
                      fontFamily: T.sans,
                      borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
	                      alignItems: "center",
                    }}
                  >
                    {isOption ? (
                      <button
                        type="button"
                        className="ra-touch-target-y"
                        aria-label={`Load ${contractLabel} into Order Ticket`}
                        onClick={loadOrderIntoTicket}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: CSS_COLOR.text,
                          cursor: "pointer",
                          font: "inherit",
                          fontWeight: FONT_WEIGHTS.regular,
                          textAlign: "left",
                        }}
                      >
                        {order.symbol}
                      </button>
                    ) : (
                      <span style={{ fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.text }}>
                        {order.symbol}
                      </span>
                    )}
                    <span
                      style={{
                        color: toneForTradeSide(order.side),
                        fontWeight: FONT_WEIGHTS.regular,
                      }}
                    >
                      {order.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span style={{ color: CSS_COLOR.textSec }}>
                      {order.type.toUpperCase()}
                    </span>
                    <span style={{ color: CSS_COLOR.textDim, textAlign: "right" }}>
                      {order.quantity}
                    </span>
                    <span style={{ color: CSS_COLOR.textDim, textAlign: "right" }}>
                      {order.filledQuantity}
                    </span>
                    <span
                      style={{
                        color: orderStatusColor(order.status),
                        textAlign: "right",
                        fontSize: textSize("body"),
                        fontWeight: FONT_WEIGHTS.regular,
                      }}
                    >
                      {formatEnumLabel(order.status)}
                    </span>
                    <span
                      style={{
                        color: CSS_COLOR.textDim,
                        textAlign: "right",
                        fontSize: textSize("caption"),
                      }}
                    >
                      {formatRelativeTimeShort(order.updatedAt)}
                    </span>
                  </div></AppTooltip>
                );
              })}
              </div>
            </div>
          )}
        </div>
      )}
      {tab !== "orders" && !brokerConfigured ? (
        <div
          style={{
            display: "flex",
            gap: sp(4),
            borderTop: `1px solid ${CSS_COLOR.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
          }}
        >
          <AppTooltip content="Close all positions"><button
            onClick={handleCloseAll}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${cssColorMix(CSS_COLOR.red, 25)}`,
              borderRadius: dim(RADII.xs),
              color: CSS_COLOR.red,
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              cursor: "pointer",
            }}
          >
            Close All
          </button></AppTooltip>
          <AppTooltip content="Set protective stops"><button
            onClick={handleSetStops}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              color: CSS_COLOR.textSec,
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              cursor: "pointer",
            }}
          >
            Set Stops
          </button></AppTooltip>
        </div>
      ) : tab === "orders" ? (
        <div
          style={{
            borderTop: `1px solid ${CSS_COLOR.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
            fontSize: textSize("body"),
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
          }}
        >
          {brokerConfigured
            ? `${pendingOrderCount} non-terminal order${pendingOrderCount === 1 ? "" : "s"}`
            : "Connect IBKR to enable live order management."}
        </div>
      ) : null}
    </div>
  );
};

// ─── FOCUSED EQUITY CHART PANEL ───
// Big equity chart with full controls: timeframes, drawing tools, candles, crosshair, flow markers.
// Always large (no expand toggle needed in single-ticker mode).
const EQUITY_CHART_STUDIES = [
  { id: "ema-21", label: "EMA21" },
  { id: "ema-55", label: "EMA55" },
  { id: "vwap", label: "VWAP" },
  { id: "sma-20", label: "SMA20" },
  { id: "bb-20", label: "BB20" },
  { id: "rsi-14", label: "RSI" },
  { id: "macd-12-26-9", label: "MACD" },
  { id: "atr-14", label: "ATR" },
];
