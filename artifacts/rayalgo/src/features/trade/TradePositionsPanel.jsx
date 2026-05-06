import { useCallback, useEffect, useMemo, useState } from "react";
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
  formatEnumLabel,
  formatExpirationLabel,
  formatPriceValue,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { formatAppTimeForPreferences } from "../../lib/timeZone";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";


export const TradePositionsPanel = ({
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  onLoadPosition,
  streamingPaused = false,
}) => {
  const toast = useToast();
  const { preferences: userPreferences } = useUserPreferences();
  const pos = usePositions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("open");
  const positionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const ordersQuery = useListOrders(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
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
    enabled: Boolean(brokerAuthenticated && accountId),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
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
  }, [accountId, brokerAuthenticated, environment, queryClient, streamingPaused]);
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
        const expiration = isOption
          ? formatExpirationLabel(position.optionContract.expirationDate)
          : "EQUITY";
        const contract = isOption
          ? `${position.optionContract.strike} ${position.optionContract.right === "call" ? "C" : "P"} ${expiration}`
          : "EQUITY";

        return {
          _isUser: false,
          _isLive: true,
          _id: position.id,
          _brokerPosition: position,
          ticker: position.symbol,
          side: position.quantity >= 0 ? "LONG" : "SHORT",
          contract,
          qty: Math.abs(position.quantity),
          entry: position.averagePrice,
          mark: position.marketPrice,
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
          sl: null,
          tp: null,
        };
      });
    }

    return pos.positions.map((p) => ({
        _isUser: true,
        _isLive: false,
        _id: p.id,
        _position: p,
        ticker: p.ticker,
        side:
          p.kind === "option" ? (p.side === "BUY" ? "LONG" : "SHORT") : p.side,
        contract:
          p.kind === "option"
            ? `${p.strike} ${p.cp} ${p.exp}`
            : `${p.side} EQUITY`,
        qty: p.qty,
        entry: p.entry,
        mark: null,
        pnl: null,
        pct: null,
        sl: p.stopLoss ?? +(p.entry * 0.65).toFixed(2),
        tp: p.takeProfit ?? +(p.entry * 1.75).toFixed(2),
      }));
  }, [
    accountId,
    brokerAuthenticated,
    brokerConfigured,
    pos.positions,
    positionsQuery.data,
  ]);
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
  const parseContract = (str) => {
    const parts = str.split(" ");
    return { strike: parseFloat(parts[0]), cp: parts[1], exp: parts[2] };
  };
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
        ? T.amber
        : T.textDim
      : tab === "history" && brokerConfigured
        ? historyCount > 0
          ? T.accent
          : T.textDim
        : hasOpenPnl
          ? totalOpenPnl >= 0
            ? T.green
            : T.red
          : T.textDim;
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
        confirmTone: T.red,
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
        confirmTone: T.red,
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
        confirmTone: T.amber,
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
      confirmTone: T.red,
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
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: 4,
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
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "open" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "open"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            OPEN{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {openPositions.length}
            </span>
          </button>
          <button
            onClick={() => setTab("history")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "history" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "history"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            HIST{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {historyCount}
            </span>
          </button>
          <button
            onClick={() => setTab("orders")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "orders" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "orders"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            ORDERS{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {brokerConfigured ? liveOrders.length : 0}
            </span>
          </button>
        </div>
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.mono,
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
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            color: T.amber,
            fontFamily: T.sans,
            fontSize: fs(8),
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
                color: T.amber,
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
                color: T.amber,
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
                color: T.textDim,
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
                  gridTemplateColumns:
                    "34px 32px 78px 22px 48px 48px 44px 42px 18px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>TICK</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>ENTRY</span>
                <span style={{ textAlign: "right" }}>MARK</span>
                <span style={{ textAlign: "right" }}>P&L</span>
                <span style={{ textAlign: "right" }}>%</span>
                <span></span>
              </div>
              {openPositions.map((p) => {
                const isLoadable =
                  p.contract && p.contract.match(/\d+\s[CP]\s/);
                const closeDisabled = gatewayActionDisabled;
                return (
                  <AppTooltip key={p._id} content={
                      isLoadable
                        ? `Click to load ${p.ticker} ${p.contract} into Order Ticket`
                        : `${p.ticker} equity position`
                    }><div
                    key={p._id}
                    onClick={() => {
                      if (isLoadable) {
                        const parsed = parseContract(p.contract);
                        onLoadPosition({ ticker: p.ticker, ...parsed });
                      }
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "34px 32px 78px 22px 48px 48px 44px 42px 18px",
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      borderBottom: `1px solid ${T.border}08`,
                      cursor: isLoadable ? "pointer" : "default",
                      alignItems: "center",
                      transition: "background 0.1s",
                      background: p._isUser ? `${T.accent}08` : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (isLoadable) e.currentTarget.style.background = T.bg3;
                    }}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = p._isUser
                        ? `${T.accent}08`
                        : "transparent")
                    }
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {p.ticker}
                    </span>
                    <span
                      style={{
                        color: p.side === "LONG" ? T.green : T.red,
                        fontWeight: 600,
                        fontSize: fs(7),
                        padding: sp("1px 4px"),
                        background:
                          p.side === "LONG" ? `${T.green}15` : `${T.red}15`,
                        borderRadius: dim(2),
                        border: `1px solid ${p.side === "LONG" ? T.green : T.red}30`,
                        textAlign: "center",
                        alignSelf: "center",
                      }}
                    >
                      {p.side}
                    </span>
                    <span style={{ color: T.textSec, fontSize: fs(8) }}>
                      {p.contract}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {p.qty}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {formatPriceValue(p.entry)}
                    </span>
                    <span
                      style={{
                        color: T.text,
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {isFiniteNumber(p.mark)
                        ? `$${p.mark.toFixed(2)}`
                        : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        color:
                          !isFiniteNumber(p.pnl)
                            ? T.textDim
                            : p.pnl >= 0
                              ? T.green
                              : T.red,
                        fontWeight: 700,
                        textAlign: "right",
                      }}
                    >
                      {isFiniteNumber(p.pnl)
                        ? `${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(0)}`
                        : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        color:
                          !isFiniteNumber(p.pct)
                            ? T.textDim
                            : p.pct >= 0
                              ? T.green
                              : T.red,
                        fontWeight: 600,
                        textAlign: "right",
                        fontSize: fs(8),
                      }}
                    >
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
                        border: `1px solid ${T.red}40`,
                        color: T.red,
                        fontSize: fs(9),
                        fontFamily: T.mono,
                        fontWeight: 700,
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
                color: T.textDim,
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
                color: T.amber,
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
                color: T.amber,
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
              tone={T.accent}
            />
          ) : !executionRows.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
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
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
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
                    fontSize: fs(9),
                    fontFamily: T.mono,
                    borderBottom: `1px solid ${T.border}08`,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700, color: T.text }}>
                    {execution.ticker}
                  </span>
                  <span
                    style={{
                      color: execution.side === "BUY" ? T.green : T.red,
                      fontWeight: 700,
                    }}
                  >
                    {execution.side}
                  </span>
                  <AppTooltip content={execution.contract}><span
                    style={{
                      color: T.textSec,
                      fontSize: fs(8),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {execution.contract}
                  </span></AppTooltip>
                  <span style={{ color: T.textDim, textAlign: "right" }}>
                    {execution.qty}
                  </span>
                  <span style={{ color: T.textDim, textAlign: "right" }}>
                    {isFiniteNumber(execution.price)
                      ? `$${execution.price.toFixed(2)}`
                      : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color:
                        !isFiniteNumber(execution.netAmount)
                          ? T.textDim
                          : execution.netAmount >= 0
                            ? T.green
                            : T.red,
                      textAlign: "right",
                    }}
                    >
                      {isFiniteNumber(execution.netAmount)
                        ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(execution.netAmount).toFixed(0)}`
                        : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color: T.textDim,
                      textAlign: "right",
                      fontSize: fs(7),
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
                color: T.textDim,
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
                color: T.amber,
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
                color: T.amber,
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
              tone={T.accent}
            />
          ) : !liveOrders.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
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
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
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
                const isTerminal = FINAL_ORDER_STATUSES.has(order.status);
                const isOption = Boolean(order.optionContract);
                const cancelDisabled =
                  isTerminal || cancelOrderMutation.isPending || gatewayActionDisabled;
                return (
                  <AppTooltip key={order.id} content={
                      isOption
                        ? `Load ${order.symbol} ${order.optionContract.strike}${order.optionContract.right === "call" ? "C" : "P"} into Order Ticket`
                        : order.id
                    }><div
                    key={order.id}
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
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      borderBottom: `1px solid ${T.border}08`,
                      cursor: isOption ? "pointer" : "default",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {order.symbol}
                    </span>
                    <span
                      style={{
                        color: order.side === "buy" ? T.green : T.red,
                        fontWeight: 700,
                      }}
                    >
                      {order.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span style={{ color: T.textSec }}>
                      {order.type.toUpperCase()}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {order.quantity}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {order.filledQuantity}
                    </span>
                    <span
                      style={{
                        color: orderStatusColor(order.status),
                        textAlign: "right",
                        fontSize: fs(8),
                        fontWeight: 700,
                      }}
                    >
                      {formatEnumLabel(order.status)}
                    </span>
                    <span
                      style={{
                        color: T.textDim,
                        textAlign: "right",
                        fontSize: fs(7),
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
                        border: `1px solid ${isTerminal ? T.border : T.red}40`,
                        color: isTerminal ? T.textDim : T.red,
                        fontSize: fs(9),
                        fontFamily: T.mono,
                        fontWeight: 700,
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
            borderTop: `1px solid ${T.border}`,
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
              border: `1px solid ${T.red}40`,
              borderRadius: dim(3),
              color: T.red,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
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
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color: T.textSec,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
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
              border: `1px solid ${T.amber}40`,
              borderRadius: dim(3),
              color: T.amber,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
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
            borderTop: `1px solid ${T.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
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
        confirmTone={liveConfirmState?.confirmTone || T.red}
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
