import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { DataUnavailableState, MicroSparkline } from "../../components/platform/primitives.jsx";
import { useRuntimeTickerSnapshots } from "../platform/runtimeTickerStore";
import {
  SPARKLINE_RENDER_POINT_LIMIT,
  buildDetailedFallbackSparklineData,
} from "../platform/sparklineConfig";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { AppTooltip } from "@/components/ui/tooltip";

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

const OPEN_POSITION_GRID_TEMPLATE =
  "72px 36px 76px 42px 48px 48px 38px 48px 48px 52px 44px 18px";

const tradeNumericCellStyle = (color = CSS_COLOR.textSec) => ({
  color,
  textAlign: "right",
  fontFamily: T.data,
  fontVariantNumeric: "tabular-nums",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const tradePnlTone = (value) =>
  !isFiniteNumber(value) ? CSS_COLOR.textDim : value >= 0 ? CSS_COLOR.green : CSS_COLOR.red;

const tradeSignedMoney = (value) =>
  isFiniteNumber(value) ? `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}` : MISSING_VALUE;

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
    <span
      data-testid="trade-position-sparkline"
      title={`${symbol} intraday trend`}
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
  );
};

export const TradePositionsPanel = ({
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  onLoadPosition,
  isVisible = false,
  streamingPaused = false,
}) => {
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const pos = usePositions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("open");
  const brokerPanelEnabled = Boolean(isVisible && brokerAuthenticated && accountId);
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
  }, [accountId, brokerAuthenticated, environment, isVisible, queryClient, streamingPaused]);
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
      title: "IB Gateway disconnected",
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
          sl: null,
          tp: null,
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
        tp: p.takeProfit ?? +(p.entry * 1.75).toFixed(2),
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
            .map((position) => normalizeTickerSymbol(position.ticker))
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
        body: "Bring the local IBKR bridge online before managing live positions.",
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
        body: "Authenticate the bridge before flattening live positions.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
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
        body: "Authenticate the bridge before modifying live risk controls.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
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

  const handleRollAll = () => {
    if (gatewayActionDisabled) {
      notifyGatewayTradingUnavailable();
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before attempting a live roll workflow.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
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
        body: "Authenticate the bridge before canceling live orders.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
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
          <button
            onClick={() => setTab("open")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              color: tab === "open" ? CSS_COLOR.text : CSS_COLOR.textMuted,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "open"
                  ? `2px solid ${CSS_COLOR.accent}`
                  : "2px solid transparent",
              paddingBottom: sp(2),
              whiteSpace: "nowrap",
            }}
          >
            OPEN{" "}
            <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular }}>
              {openPositions.length}
            </span>
          </button>
          <button
            onClick={() => setTab("history")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              color: tab === "history" ? CSS_COLOR.text : CSS_COLOR.textMuted,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "history"
                  ? `2px solid ${CSS_COLOR.accent}`
                  : "2px solid transparent",
              paddingBottom: sp(2),
              whiteSpace: "nowrap",
            }}
          >
            HIST{" "}
            <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular }}>
              {historyCount}
            </span>
          </button>
          <button
            onClick={() => setTab("orders")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              color: tab === "orders" ? CSS_COLOR.text : CSS_COLOR.textMuted,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "orders"
                  ? `2px solid ${CSS_COLOR.accent}`
                  : "2px solid transparent",
              paddingBottom: sp(2),
              whiteSpace: "nowrap",
            }}
          >
            ORDERS{" "}
            <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular }}>
              {brokerConfigured ? liveOrders.length : 0}
            </span>
          </button>
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
        <div
          style={{
            background: `${cssColorMix(CSS_COLOR.amber, 7)}`,
            border: `1px solid ${cssColorMix(CSS_COLOR.amber, 21)}`,
            borderRadius: dim(RADII.xs),
            padding: sp("6px 8px"),
            color: CSS_COLOR.amber,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            lineHeight: 1.35,
          }}
        >
          {gatewayTradingMessage}
        </div>
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
              IBKR is configured, but live positions stay hidden until the local
              bridge authenticates.
            </div>
          ) : brokerConfigured && !accountId ? (
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
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : openPositions.length === 0 ? (
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
              No open positions
            </div>
          ) : (
            <>
              <div
                style={{
	                  display: "grid",
	                  gridTemplateColumns: OPEN_POSITION_GRID_TEMPLATE,
	                  gap: sp(3),
                  fontSize: textSize("caption"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
                  padding: "0 4px",
                }}
              >
                <span>TICK</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>OPEN</span>
                <span style={{ textAlign: "right" }}>BID</span>
                <span style={{ textAlign: "right" }}>ASK</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>ENTRY</span>
                <span style={{ textAlign: "right" }}>MARK</span>
                <span style={{ textAlign: "right" }}>P&L $</span>
                <span style={{ textAlign: "right" }}>P&L %</span>
                <span></span>
              </div>
              {openPositions.map((p) => {
                const isLoadable = Boolean(p.optionLoadContract);
                const closeDisabled = gatewayActionDisabled;
                const display = tradePositionDisplay(p);
                const spread = formatTradeSpread(display.quote);
                const quoteFreshness = formatPositionQuoteFreshnessLabel(display.quote);
                const bidText =
                  display.quote?.bid != null ? formatPriceValue(display.quote.bid) : MISSING_VALUE;
                const askText =
                  display.quote?.ask != null ? formatPriceValue(display.quote.ask) : MISSING_VALUE;
                const entryText = isFiniteNumber(p.entry) ? formatPriceValue(p.entry) : MISSING_VALUE;
                const markText = isFiniteNumber(p.mark) ? formatPriceValue(p.mark) : MISSING_VALUE;
                const openedText =
                  display.openedLabel && display.ageLabel
                    ? `${display.openedLabel} · ${display.ageLabel}`
                    : display.openedLabel || MISSING_VALUE;
                return (
                  <AppTooltip key={p._id} content={
                      isLoadable
                        ? `Click to load ${p.ticker} ${p.contract} into Order Ticket`
                        : `${p.ticker} equity position`
                    }><div
                    key={p._id}
                    onClick={() => {
                      if (isLoadable) {
                        onLoadPosition({
                          ticker: p.ticker,
                          ...p.optionLoadContract,
                        });
                      }
                    }}
	                    style={{
	                      display: "grid",
	                      gridTemplateColumns: OPEN_POSITION_GRID_TEMPLATE,
	                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: textSize("caption"),
                      fontFamily: T.sans,
                      borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
                      cursor: isLoadable ? "pointer" : "default",
                      alignItems: "center",
                      transition: "background 0.1s",
                      background: "transparent",
                      boxShadow: p._isUser ? `inset 1px 0 0 ${CSS_COLOR.accent}` : "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = CSS_COLOR.bg2;
                    }}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
	                    <span
	                      style={{
	                        minWidth: 0,
	                        display: "inline-flex",
	                        alignItems: "center",
	                        gap: sp(4),
	                        color: CSS_COLOR.text,
	                        fontWeight: FONT_WEIGHTS.regular,
	                      }}
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
                      style={{
                        color: CSS_COLOR.textSec,
                        fontWeight: FONT_WEIGHTS.regular,
                        fontSize: textSize("caption"),
                        padding: sp("1px 4px"),
                        background: CSS_COLOR.bg0,
                        borderRadius: dim(2),
                        border: `1px solid ${CSS_COLOR.border}`,
                        textAlign: "center",
                        alignSelf: "center",
                      }}
                    >
                      {p.side}
                    </span>
                    <span style={{ color: CSS_COLOR.textSec, fontSize: textSize("body") }}>
                      {p.contract}
                    </span>
                    <span
                      title={display.openedSourceLabel || undefined}
                      style={{ color: display.openedLabel ? CSS_COLOR.textSec : CSS_COLOR.textDim, textAlign: "right" }}
                    >
                      {openedText}
                    </span>
                    <span
                      title={[spread, quoteFreshness].filter(Boolean).join(" · ")}
                      style={tradeNumericCellStyle(display.quote?.bid != null ? CSS_COLOR.textSec : CSS_COLOR.textDim)}
                    >
                      {bidText}
                    </span>
                    <span
                      title={[spread, quoteFreshness].filter(Boolean).join(" · ")}
                      style={tradeNumericCellStyle(display.quote?.ask != null ? CSS_COLOR.textSec : CSS_COLOR.textDim)}
                    >
                      {askText}
                    </span>
                    <span style={tradeNumericCellStyle(CSS_COLOR.textDim)}>
                      {p.qty}
                    </span>
                    <span style={tradeNumericCellStyle(CSS_COLOR.textSec)}>
                      {entryText}
                    </span>
                    <span style={tradeNumericCellStyle(CSS_COLOR.text)}>
                      {markText}
                    </span>
                    <span style={tradeNumericCellStyle(tradePnlTone(p.pnl))}>
                      {tradeSignedMoney(p.pnl)}
                    </span>
                    <span style={tradeNumericCellStyle(tradePnlTone(p.pct))}>
                      {formatSignedPercent(p.pct, 1)}
                    </span>
                    <AppTooltip content={
                        closeDisabled
                          ? gatewayTradingMessage
                          : p._isLive
                            ? "Submit broker close-out order"
                            : "Close position"
                      }><button
                      disabled={closeDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (closeDisabled) {
                          notifyGatewayTradingUnavailable();
                          return;
                        }
                        closeRow(p);
                      }}
                      style={{
                        background: "transparent",
                        border: `1px solid ${cssColorMix(CSS_COLOR.red, 25)}`,
                        color: CSS_COLOR.red,
                        fontSize: textSize("caption"),
                        fontFamily: T.sans,
                        fontWeight: FONT_WEIGHTS.regular,
                        borderRadius: dim(2),
                        cursor: closeDisabled ? "not-allowed" : "pointer",
                        padding: sp("1px 0"),
                        lineHeight: 1,
                        opacity: closeDisabled ? 0.45 : 1,
                      }}
                    >
                      ✕
                    </button></AppTooltip>
                  </div></AppTooltip>
                );
              })}
            </>
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
              No broker history is available until the IBKR bridge is configured and fills exist on the selected account.
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
              Bring the local IBKR bridge online to load broker fills.
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
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : executionsQuery.isPending && !executionRows.length ? (
            <DataUnavailableState
              title="Loading broker fills"
              detail="Requesting broker execution history for the active account."
              loading
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
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "40px 30px minmax(0,1fr) 24px 50px 64px 42px",
                  gap: sp(3),
                  fontSize: textSize("caption"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
                  padding: "0 4px",
                }}
              >
                <span>SYM</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>PRICE</span>
                <span style={{ textAlign: "right" }}>NET</span>
                <span style={{ textAlign: "right" }}>TIME</span>
              </div>
              {executionRows.map((execution) => (
                <div
                  key={execution.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "40px 30px minmax(0,1fr) 24px 50px 64px 42px",
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
                      color: execution.side === "BUY" ? CSS_COLOR.green : CSS_COLOR.red,
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
            </>
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
              Bring the local IBKR bridge online to load live IBKR
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
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : ordersQuery.isPending && !liveOrders.length ? (
            <DataUnavailableState
              title="Loading live orders"
              detail="Requesting live IBKR orders for the active account."
              loading
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
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "42px 30px 44px 22px 28px 58px 42px 24px",
                  gap: sp(3),
                  fontSize: textSize("caption"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
                  padding: "0 4px",
                }}
              >
                <span>SYM</span>
                <span>SIDE</span>
                <span>TYPE</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>FILL</span>
                <span style={{ textAlign: "right" }}>STATUS</span>
                <span style={{ textAlign: "right" }}>TIME</span>
                <span></span>
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
                      gridTemplateColumns:
                        "42px 30px 44px 22px 28px 58px 42px 24px",
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
                        color: order.side === "buy" ? CSS_COLOR.green : CSS_COLOR.red,
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
                        borderRadius: dim(2),
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
            </>
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
              borderRadius: dim(3),
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
              borderRadius: dim(3),
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
              borderRadius: dim(3),
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
