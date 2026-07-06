import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CircleDollarSign,
  ClipboardList,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  XCircle,
} from "lucide-react";
import {
  useCancelOrder,
  useListOrders,
  useListPositions,
  usePlaceOrder,
  usePreviewOrder,
  useReplaceOrder,
} from "@workspace/api-client-react";
import {
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
} from "../platform/queryDefaults";
import { usePositions, useToast } from "../platform/platformContexts.jsx";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  BrokerActionConfirmDialog,
  formatLiveBrokerActionError,
} from "./BrokerActionConfirmDialog.jsx";
import {
  FINAL_ORDER_STATUSES,
  formatExecutionContractLabel,
  listBrokerExecutionsRequest,
  orderStatusColor,
  sameOptionContract,
} from "./tradeBrokerRequests";
import { isOpenPositionRow } from "../account/accountPositionRows.js";
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
import { DataUnavailableState, MicroSparkline, SegmentedControl } from "../../components/platform/primitives.jsx";
import { useRegisterPositionMarketDataSymbols } from "../platform/positionMarketDataStore";
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

const buildTradePositionFallbackSparklineData = (position, snapshot, symbol) => {
  const current = firstPositiveNumber(snapshot?.price, position?.mark, position?.entry);
  if (current == null) return [];

  const percent = firstNumber(position?.pct, snapshot?.pct, snapshot?.changePercent);
  const start =
    percent != null && percent > -99
      ? current / (1 + percent / 100)
      : firstPositiveNumber(position?.entry) ?? current * 0.9975;

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
    position?.ticker ||
      position?.optionContract?.underlying ||
      position?.symbol,
  );

const resolveTradeSpotPrice = (position, snapshotsBySymbol = {}) => {
  const symbol = resolveTradeSpotSymbol(position);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const equityFallback = position?.optionContract
    ? null
    : firstPositiveNumber(position?.mark, position?.marketPrice, position?.entry);
  return firstPositiveNumber(
    snapshot?.price,
    snapshot?.mark,
    snapshot?.last,
    quoteMid(snapshot),
    equityFallback,
  );
};

const tradeSpotTitle = (position, snapshotsBySymbol = {}) => {
  const symbol = resolveTradeSpotSymbol(position);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const price = resolveTradeSpotPrice(position, snapshotsBySymbol);
  const updatedAt = firstText(snapshot?.dataUpdatedAt, snapshot?.updatedAt);
  return [
    "Underlying spot",
    price != null ? formatPriceValue(price) : null,
    updatedAt ? formatRelativeTimeShort(updatedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  openPositionColumn({ id: "actions", label: "", title: "Actions", width: "minmax(74px, max-content)", minWidth: "74px", align: "center" }),
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
const LIVE_ORDER_GRID_TEMPLATE = "42px 30px 44px 22px 28px 58px 42px 24px";
const LIVE_ORDER_TABLE_MIN_WIDTH = 440;

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

const tradeManagementDistanceBadge = (management) => {
  if (!isFiniteNumber(management?.riskDistancePct)) return MISSING_VALUE;
  return `${management.riskDistancePct <= 0 ? "-" : "+"}${Math.abs(
    management.riskDistancePct,
  ).toFixed(1)}%`;
};

const tradeManagementStopBadge = (management) => {
  if (!management.stop || management.trail) return null;
  return tradeManagementDistanceBadge(management);
};

const tradeManagementTrailBadge = (management) => {
  if (!management.trail) return null;
  return tradeManagementDistanceBadge(management);
};

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

const tradeManagementBadgeTone = (management) =>
  management.status === "breached"
    ? CSS_COLOR.red
    : isFiniteNumber(management.riskDistancePct) && management.riskDistancePct <= 10
      ? CSS_COLOR.amber
      : CSS_COLOR.textDim;

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
          positive={isFiniteNumber(position?.pct) ? position.pct >= 0 : null}
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
  const brokerPanelEnabled = Boolean(
    isVisible && !safeQaMode && brokerAuthenticated && accountId,
  );
  const positionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: brokerPanelEnabled,
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const ordersQuery = useListOrders(
    { accountId, mode: environment },
    {
      query: {
        enabled: brokerPanelEnabled,
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const executionsQuery = useQuery({
    queryKey: ["broker-executions", accountId, environment],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        days: 7,
        limit: 64,
      }),
    enabled: brokerPanelEnabled,
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !isVisible ||
      safeQaMode ||
      streamingPaused ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      days: "7",
      limit: "64",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          ["broker-executions", accountId, environment],
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
    brokerAuthenticated,
    environment,
    isVisible,
    queryClient,
    safeQaMode,
    streamingPaused,
  ]);
  const refreshBrokerQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
    queryClient.invalidateQueries({ queryKey: ["broker-executions"] });
  }, [queryClient]);
  const placeOrderMutation = usePlaceOrder({
    mutation: {
      onSuccess: () => {
        refreshBrokerQueries();
      },
    },
  });
  const previewOrderMutation = usePreviewOrder();
  const replaceOrderMutation = useReplaceOrder({
    mutation: {
      onSuccess: () => {
        refreshBrokerQueries();
      },
    },
  });
  const cancelOrderMutation = useCancelOrder({
    mutation: {
      onSuccess: (response) => {
        refreshBrokerQueries();
        toast.push({
          kind: "success",
          title: "Cancel submitted",
          body: `${response.orderId} · ${response.message}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Cancel failed",
          body:
            error?.message || "The broker did not accept the cancel request.",
        });
      },
    },
  });
  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);
  const [liveConfirmError, setLiveConfirmError] = useState(null);
  const closeLiveConfirm = () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmState(null);
  };
  const runLiveConfirm = async () => {
    if (!liveConfirmState?.onConfirm) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmPending(true);
    try {
      await liveConfirmState.onConfirm();
      setLiveConfirmState(null);
    } catch (error) {
      setLiveConfirmError(formatLiveBrokerActionError(error));
    } finally {
      setLiveConfirmPending(false);
    }
  };
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
          side: position.quantity >= 0 ? "LONG" : "SHORT",
          contract,
          optionContract: position.optionContract ?? null,
          openOrders: position.openOrders ?? [],
          optionLoadContract: isOption
            ? {
                strike: position.optionContract.strike,
                cp: position.optionContract.right === "call" ? "C" : "P",
                exp: formatExpirationLabel(position.optionContract.expirationDate),
              }
            : null,
          qty: Math.abs(position.quantity),
          entry: position.averagePrice,
          mark: position.marketPrice,
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
          openedAt: position.openedAt ?? null,
          openedAtSource: position.openedAtSource ?? null,
          quote: position.quote ?? null,
          sl:
            position.riskOverlay?.activeStopPrice ??
            position.stopLoss ??
            position.stopLossPrice ??
            position.automationContext?.activeStopPrice ??
            position.automationContext?.stopLossPrice ??
            position.automationContext?.stopPrice ??
            null,
        };
      });
    }

    return pos.positions.map((p) => {
      const optionLoadContract =
        p.kind === "option"
          ? {
              strike: p.strike,
              cp: p.cp,
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
  useRegisterPositionMarketDataSymbols(
    `trade-positions:${environment}:${accountId || "none"}`,
    openPositionSymbols,
    isVisible,
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
  const buildOptionContractPayload = (optionContract) =>
    optionContract
      ? {
          ticker: optionContract.ticker,
          underlying: optionContract.underlying,
          expirationDate: optionContract.expirationDate,
          strike: optionContract.strike,
          right: optionContract.right,
          multiplier: optionContract.multiplier,
          sharesPerContract: optionContract.sharesPerContract,
          providerContractId: optionContract.providerContractId,
        }
      : null;
  const buildCloseOrderRequest = (position) => ({
    accountId,
    mode: environment,
    symbol: position.symbol,
    assetClass: position.assetClass,
    side: position.quantity >= 0 ? "sell" : "buy",
    type: "market",
    quantity: Math.abs(position.quantity),
    timeInForce: "day",
    optionContract: buildOptionContractPayload(position.optionContract),
  });
  const buildStopOrderRequest = (position, stopPrice) => ({
    accountId,
    mode: environment,
    symbol: position.symbol,
    assetClass: position.assetClass,
    side: position.quantity >= 0 ? "sell" : "buy",
    type: "stop",
    quantity: Math.abs(position.quantity),
    stopPrice,
    timeInForce: "gtc",
    optionContract: buildOptionContractPayload(position.optionContract),
  });
  const findExistingStopOrder = (position) =>
    liveOrders.find((order) => {
      if (FINAL_ORDER_STATUSES.has(order.status) || order.type !== "stop") {
        return false;
      }
      if (order.symbol !== position.symbol) {
        return false;
      }
      if (order.side !== (position.quantity >= 0 ? "sell" : "buy")) {
        return false;
      }
      if (position.optionContract || order.optionContract) {
        return sameOptionContract(order.optionContract, position.optionContract);
      }
      return true;
    }) || null;
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

  const closeRow = async (p) => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Connect IBKR Client Portal before managing live positions.",
      });
      return;
    }

    if (p._isLive && p._brokerPosition) {
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Flatten ${p.ticker} ${p.contract}`,
        detail: "Submit a live market order to close this broker position.",
        confirmLabel: "SEND LIVE CLOSE",
        confirmTone: CSS_COLOR.red,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "SYMBOL", value: p.ticker },
          { label: "CONTRACT", value: p.contract },
          { label: "SIDE", value: p.side },
          { label: "QTY", value: String(p.qty) },
        ],
        onConfirm: async () => {
          await placeOrderMutation.mutateAsync({
            data: {
              ...buildCloseOrderRequest(p._brokerPosition),
              confirm: true,
            },
          });
          toast.push({
            kind: "success",
            title: "Close submitted",
            body: `${p.ticker} ${p.contract} · ${p.qty} to flatten`,
          });
        },
      });
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

  const handleCloseAll = async () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate IBKR Client Portal before flattening live positions.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The Client Portal session is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to close",
        body: "No open positions.",
      });
      return;
    }

    if (brokerConfigured) {
      const livePositions = openPositions.filter((position) => position._isLive);
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Flatten ${livePositions.length} live position${livePositions.length === 1 ? "" : "s"}`,
        detail:
          "Submit live broker orders to flatten every open IBKR position in the active account.",
        confirmLabel: "FLATTEN LIVE POSITIONS",
        confirmTone: CSS_COLOR.red,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "POSITIONS", value: String(livePositions.length) },
        ],
        onConfirm: async () => {
          const results = await Promise.allSettled(
            livePositions.map((position) =>
              placeOrderMutation.mutateAsync({
                data: {
                  ...buildCloseOrderRequest(position._brokerPosition),
                  confirm: true,
                },
              }),
            ),
          );
          const successCount = results.filter(
            (result) => result.status === "fulfilled",
          ).length;
          toast.push({
            kind: successCount === livePositions.length ? "success" : "warn",
            title: `Submitted ${successCount}/${livePositions.length} close order${livePositions.length === 1 ? "" : "s"}`,
            body:
              successCount === livePositions.length
                ? "All live positions received flatten requests."
                : "Some live positions could not be flattened.",
          });
        },
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

  const handleSetStops = async () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate IBKR Client Portal before modifying live risk controls.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The Client Portal session is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "No positions",
        body: "Nothing to protect.",
      });
      return;
    }

    if (brokerConfigured) {
      const livePositions = (positionsQuery.data?.positions || []).filter(isOpenPositionRow);
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Protect ${livePositions.length} live position${livePositions.length === 1 ? "" : "s"}`,
        detail:
          "Preview and synchronize live protective stop orders for every open broker position.",
        confirmLabel: "SYNC LIVE STOPS",
        confirmTone: CSS_COLOR.amber,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "POSITIONS", value: String(livePositions.length) },
        ],
        onConfirm: async () => {
          let protectedCount = 0;
          let failedCount = 0;

          for (const position of livePositions) {
            const referencePrice =
              isFiniteNumber(position.marketPrice) && position.marketPrice > 0
                ? position.marketPrice
                : position.averagePrice;
            if (!isFiniteNumber(referencePrice) || referencePrice <= 0) {
              failedCount += 1;
              continue;
            }

            const stopPrice = +(
              position.quantity >= 0
                ? referencePrice * 0.8
                : referencePrice * 1.2
            ).toFixed(2);
            const stopRequest = buildStopOrderRequest(position, stopPrice);

            try {
              const preview = await previewOrderMutation.mutateAsync({
                data: stopRequest,
              });
              const existingStop = findExistingStopOrder(position);

              if (existingStop && preview?.orderPayload) {
                await replaceOrderMutation.mutateAsync({
                  orderId: existingStop.id,
                  data: {
                    accountId,
                    mode: environment,
                    confirm: true,
                    order: preview.orderPayload,
                  },
                });
              } else {
                await placeOrderMutation.mutateAsync({
                  data: {
                    ...stopRequest,
                    confirm: true,
                  },
                });
              }

              protectedCount += 1;
            } catch (error) {
              failedCount += 1;
            }
          }

          toast.push({
            kind:
              failedCount === 0 ? "success" : protectedCount ? "warn" : "error",
            title: `Stops updated ${protectedCount}/${livePositions.length}`,
            body:
              failedCount === 0
                ? "Protective broker stop orders are in sync."
                : "Some positions could not be protected.",
          });
        },
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

  const handleProtectRow = async (p) => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate IBKR Client Portal before modifying live risk controls.",
      });
      return;
    }

    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The Client Portal session is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    if (p._isLive && p._brokerPosition) {
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Protect ${p.ticker} ${p.contract}`,
        detail: "Preview and synchronize a protective live stop for this broker position.",
        confirmLabel: "SYNC LIVE STOP",
        confirmTone: CSS_COLOR.amber,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "SYMBOL", value: p.ticker },
          { label: "CONTRACT", value: p.contract },
          { label: "SIDE", value: p.side },
          { label: "QTY", value: String(p.qty) },
        ],
        onConfirm: async () => {
          const position = p._brokerPosition;
          const referencePrice =
            isFiniteNumber(position.marketPrice) && position.marketPrice > 0
              ? position.marketPrice
              : position.averagePrice;
          if (!isFiniteNumber(referencePrice) || referencePrice <= 0) {
            throw new Error("A live mark or average price is required before syncing a stop.");
          }

          const stopPrice = +(
            position.quantity >= 0
              ? referencePrice * 0.8
              : referencePrice * 1.2
          ).toFixed(2);
          const stopRequest = buildStopOrderRequest(position, stopPrice);
          const preview = await previewOrderMutation.mutateAsync({
            data: stopRequest,
          });
          const existingStop = findExistingStopOrder(position);

          if (existingStop && preview?.orderPayload) {
            await replaceOrderMutation.mutateAsync({
              orderId: existingStop.id,
              data: {
                accountId,
                mode: environment,
                confirm: true,
                order: preview.orderPayload,
              },
            });
          } else {
            await placeOrderMutation.mutateAsync({
              data: {
                ...stopRequest,
                confirm: true,
              },
            });
          }

          toast.push({
            kind: "success",
            title: "Stop updated",
            body: `${p.ticker} ${p.contract} protected near ${formatPriceValue(stopPrice)}.`,
          });
        },
      });
      return;
    }

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

  const handleRollRow = (p) => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (p._isUser && p._position?.kind === "option") {
      pos.rollPosition(p._id);
      toast.push({
        kind: "success",
        title: "Position rolled",
        body: `${p.ticker} ${p.contract} extended to the next cycle.`,
      });
      return;
    }

    toast.push({
      kind: "info",
      title: "Roll workflow disabled",
      body: "Live multi-leg rolls still need the broker roll workflow.",
    });
  };

  const handleRollAll = () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate IBKR Client Portal before attempting a live roll workflow.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The Client Portal session is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (brokerConfigured && accountId) {
      toast.push({
        kind: "info",
        title: "Live roll workflow disabled",
        body: "Rolling live positions remains disabled until a multi-leg IBKR workflow is implemented.",
      });
      return;
    }
    const userPositions = pos.positions.filter((p) => p.kind === "option");
    if (userPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to roll",
        body: "No option positions.",
      });
      return;
    }
    userPositions.forEach((p) => pos.rollPosition(p.id));
    toast.push({
      kind: "success",
      title: `Rolled ${userPositions.length} position${userPositions.length === 1 ? "" : "s"}`,
      body: `Extended expiration to next cycle`,
    });
  };

  const handleCancelOrder = (order) => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate IBKR Client Portal before canceling live orders.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The Client Portal session is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    setLiveConfirmState({
      title: `Cancel ${order.symbol} ${order.type.toUpperCase()} order`,
      detail: "Send a live broker cancellation request for this working IBKR order.",
      confirmLabel: "CANCEL LIVE ORDER",
      confirmTone: CSS_COLOR.red,
      lines: [
        { label: "ACCOUNT", value: accountId || MISSING_VALUE },
        { label: "SYMBOL", value: order.symbol },
        { label: "SIDE", value: order.side.toUpperCase() },
        { label: "TYPE", value: order.type.toUpperCase() },
        { label: "QTY", value: String(order.quantity) },
        { label: "STATUS", value: formatEnumLabel(order.status) },
      ],
      onConfirm: async () => {
        await cancelOrderMutation.mutateAsync({
          orderId: order.id,
          data: {
            accountId,
            manualIndicator: true,
            confirm: true,
          },
        });
      },
    });
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
          {brokerConfigured && !brokerAuthenticated ? (
            <DataUnavailableState
              fill
              variant="warning"
              title="IBKR authentication required"
              detail="IBKR is configured, but live positions stay hidden until Client Portal authenticates."
            />
          ) : brokerConfigured && !accountId ? (
            <DataUnavailableState
              fill
              variant="warning"
              title="No active IBKR account"
              detail="The Client Portal session is authenticated, but no IBKR account is active yet."
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
                const isLoadable = Boolean(p.optionLoadContract);
                const closeDisabled = gatewayActionDisabled;
                const protectDisabled = gatewayActionDisabled;
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
                const firstLinkedOrder = linkedWorkingOrders[0] || null;
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
                  onLoadPosition({
                    ticker: p.ticker,
                    ...p.optionLoadContract,
                  });
                };
                return (
                  <AppTooltip key={p._id} content={
                      isLoadable
                        ? `Click to load ${p.ticker} ${p.contract} into Order Ticket`
                        : `${p.ticker} equity position`
                    }><div
	                    key={p._id}
                      role="row"
                    onClick={() => {
                      loadPositionIntoTicket();
                    }}
	                    style={{
	                      display: "grid",
	                      gridTemplateColumns: OPEN_POSITION_GRID_TEMPLATE,
	                      gap: 0,
                      padding: sp("1px 0"),
                      fontSize: textSize("caption"),
                      fontFamily: T.sans,
                      borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
                      cursor: isLoadable ? "pointer" : "default",
                      alignItems: "center",
                      transition: "background var(--ra-motion-micro)",
                      background: rowBackground,
                      boxShadow: p._isUser ? `inset 1px 0 0 ${CSS_COLOR.accent}` : "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = CSS_COLOR.bg2;
                    }}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = rowBackground)
                    }
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
                          badgeTone={tradeManagementBadgeTone(management)}
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
                          badgeTone={tradeManagementBadgeTone(management)}
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
                            : "Equity position ticket loading is not wired from this panel yet",
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
                          {
                            id: "cancel",
                            label: "Cancel",
                            description: firstLinkedOrder
                              ? `Cancel ${firstLinkedOrder.type} ${firstLinkedOrder.side} order`
                              : "No linked order to cancel",
                            Icon: XCircle,
                            onSelect: () => handleCancelOrder(firstLinkedOrder),
                            disabled: !firstLinkedOrder || gatewayActionDisabled,
                            tone: "danger",
                          },
                          {
                            id: "protect",
                            label: "Protect",
                            description: protectDisabled
                              ? gatewayTradingMessage
                              : "Preview and sync a protective stop",
                            Icon: ShieldCheck,
                            onSelect: () => handleProtectRow(p),
                            disabled: protectDisabled,
                            tone: "success",
                          },
                          {
                            id: "quote",
                            label: "Quote",
                            description: [spread, quoteFreshness].filter(Boolean).join(" · ") || "Quote unavailable",
                            Icon: CircleDollarSign,
                            disabled: true,
                            tone: "info",
                          },
                          {
                            id: "risk",
                            label: "Risk",
                            description: managementTitle || "No risk controls found",
                            Icon: ShieldCheck,
                            disabled: true,
                            tone: management.status === "breached" ? "danger" : "warning",
                          },
                          {
                            id: "alert",
                            label: "Alert",
                            description: "Price alerts are not wired to trade positions yet",
                            Icon: Bell,
                            disabled: true,
                            tone: "warning",
                          },
                        ]}
                        managementActions={[
                          {
                            id: "adjust",
                            label: "Adjust",
                            description: "Manual stop and target adjustment is not wired yet",
                            Icon: SlidersHorizontal,
                            disabled: true,
                            tone: "warning",
                          },
                          {
                            id: "close",
                            label: "Close",
                            description: closeDisabled
                              ? gatewayTradingMessage
                              : p._isLive
                                ? "Submit broker close-out order"
                                : "Close local position",
                            Icon: XCircle,
                            onSelect: () => closeRow(p),
                            disabled: closeDisabled,
                            tone: "danger",
                          },
                          {
                            id: "roll",
                            label: "Roll",
                            description: p._isUser && p._position?.kind === "option"
                              ? "Roll this local option position"
                              : "Live roll workflow is not wired yet",
                            Icon: RotateCcw,
                            onSelect: () => handleRollRow(p),
                            disabled: closeDisabled || !(p._isUser && p._position?.kind === "option"),
                            tone: "info",
                          },
                        ]}
                      />
                    </span>
                  </div></AppTooltip>
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
                <span role="columnheader"></span>
              </div>
              {liveOrders.map((order) => {
                const orderRowId = getTradeLiveOrderRowId(order);
                const isTerminal = FINAL_ORDER_STATUSES.has(order.status);
                const isOption = Boolean(order.optionContract);
                const cancelDisabled =
                  isTerminal || cancelOrderMutation.isPending || gatewayActionDisabled;
                return (
                  <AppTooltip key={orderRowId} content={
                      isOption
                        ? `Load ${formatOptionContractLabel(order.optionContract, {
                            symbol: order.symbol,
                          })} into Order Ticket`
                        : order.id
                    }><div
                    role="row"
                    onClick={() => {
                      if (!isOption) return;
                      onLoadPosition({
                        ticker: order.symbol,
                        strike: order.optionContract.strike,
                        cp: order.optionContract.right === "call" ? "C" : "P",
                        exp: formatExpirationLabel(
                          order.optionContract.expirationDate,
                        ),
                      });
                    }}
                    style={{
	                      display: "grid",
	                      gridTemplateColumns: LIVE_ORDER_GRID_TEMPLATE,
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: textSize("caption"),
                      fontFamily: T.sans,
                      borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
                      cursor: isOption ? "pointer" : "default",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.text }}>
                      {order.symbol}
                    </span>
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
                    <AppTooltip content={
                        gatewayActionDisabled
                          ? gatewayTradingMessage
                          : isTerminal
                            ? "Terminal order"
                            : "Cancel order"
                      }><button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCancelOrder(order);
                      }}
                      disabled={cancelDisabled}
                      style={{
                        background: "transparent",
                        border: `1px solid ${cssColorAlpha(isTerminal ? CSS_COLOR.border : CSS_COLOR.red, "40")}`,
                        color: isTerminal ? CSS_COLOR.textDim : CSS_COLOR.red,
                        fontSize: textSize("caption"),
                        fontFamily: T.sans,
                        fontWeight: FONT_WEIGHTS.regular,
                        borderRadius: dim(RADII.xs),
                        cursor:
                          cancelDisabled
                            ? "not-allowed"
                            : "pointer",
                        padding: sp("1px 0"),
                        lineHeight: 1,
                        opacity: cancelDisabled ? 0.45 : 1,
                      }}
                    >
                      ✕
                    </button></AppTooltip>
                  </div></AppTooltip>
                );
              })}
              </div>
            </div>
          )}
        </div>
      )}
      {tab !== "orders" ? (
        <div
          style={{
            display: "flex",
            gap: sp(4),
            borderTop: `1px solid ${CSS_COLOR.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
          }}
        >
          <AppTooltip content={gatewayActionDisabled ? gatewayTradingMessage : "Close all positions"}><button
            onClick={handleCloseAll}
            disabled={gatewayActionDisabled}
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
              cursor: gatewayActionDisabled ? "not-allowed" : "pointer",
              opacity: gatewayActionDisabled ? 0.55 : 1,
            }}
          >
            Close All
          </button></AppTooltip>
          <AppTooltip content={gatewayActionDisabled ? gatewayTradingMessage : "Set protective stops"}><button
            onClick={handleSetStops}
            disabled={gatewayActionDisabled}
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
              cursor: gatewayActionDisabled ? "not-allowed" : "pointer",
              opacity: gatewayActionDisabled ? 0.55 : 1,
            }}
          >
            Set Stops
          </button></AppTooltip>
          <AppTooltip content={gatewayActionDisabled ? gatewayTradingMessage : "Roll option positions"}><button
            onClick={handleRollAll}
            disabled={gatewayActionDisabled}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 25)}`,
              borderRadius: dim(RADII.xs),
              color: CSS_COLOR.amber,
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              cursor:
                gatewayActionDisabled ||
                (brokerConfigured && brokerAuthenticated && accountId)
                  ? "not-allowed"
                  : "pointer",
              opacity:
                gatewayActionDisabled ||
                (brokerConfigured && brokerAuthenticated && accountId)
                  ? 0.6
                  : 1,
            }}
          >
            Roll
          </button></AppTooltip>
        </div>
      ) : (
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
      )}
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm live broker action"}
        detail={
          liveConfirmState?.detail ||
          "Confirm this live Interactive Brokers action before sending it."
        }
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM LIVE ACTION"}
        confirmTone={liveConfirmState?.confirmTone || CSS_COLOR.red}
        pending={liveConfirmPending}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
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
