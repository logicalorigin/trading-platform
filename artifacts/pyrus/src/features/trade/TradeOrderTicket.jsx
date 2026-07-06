import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetSnapTradeAccountPortfolioQueryKey,
  getGetSnapTradeRecentOrdersQueryKey,
  useCheckSnapTradeEquityOrderImpact,
  usePlaceOrder,
  usePreviewOrder,
  useGetSnapTradeRecentOrders,
  useSearchSnapTradeAccountSymbols,
  useSubmitSnapTradeEquityOrder,
  useSubmitOrders,
} from "@workspace/api-client-react";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import {
  toneForDirectionalIntent,
  toneForOptionSide,
} from "../platform/semanticToneModel.js";
import { useToast } from "../platform/platformContexts.jsx";
import { platformJsonRequest } from "../platform/platformJsonRequest";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  TICKET_ASSET_MODES,
  TICKET_ORDER_TYPES,
  TRADING_EXECUTION_MODES,
  buildTwsBracketOrders,
  formatTicketOrderType,
  getDefaultTicketRiskPrices,
  isTwsStructuredOrderPayload,
  normalizeTicketAssetMode,
  normalizeTicketOrderType,
  normalizeTradingExecutionMode,
  resolveTicketOrderPrices,
  validateTicketBracket,
} from "./ibkrOrderTicketModel";
import { resolveSellCallTicketIntent } from "./optionSellCallIntent.js";
import {
  BrokerActionConfirmDialog,
  formatLiveBrokerActionError,
} from "./BrokerActionConfirmDialog.jsx";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  daysToExpiration,
  fmtQuoteVolume,
  formatEnumLabel,
  formatOptionContractLabel,
  formatPriceValue,
  isFiniteNumber,
  parseExpirationValue,
} from "../../lib/formatters";
import { useValueFlash } from "../../lib/motion";
import { buildSignalOptionsDeviation } from "./automationDeviationModel";
import { buildTicketReadinessModel } from "./tradeTicketReadinessModel.js";
import { useSnapTradeExecutionAccountState } from "../broker/snapTradeExecutionAccountStore.js";
import { buildSnapTradeEquityOrderDraft } from "./snapTradeOrderTicketModel.js";
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
import {
  DataUnavailableState,
  MetricChip,
  SegmentedControl,
  SeverityRail,
} from "../../components/platform/primitives.jsx";

import { PayoffDiagram } from "./PayoffDiagram.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

const readinessToneColor = (tone) =>
  tone === "good" ? CSS_COLOR.green : tone === "warn" ? CSS_COLOR.amber : tone === "bad" ? CSS_COLOR.red : CSS_COLOR.textDim;
const TRADE_BUY_TONE = toneForDirectionalIntent("buy");
const TRADE_SELL_TONE = toneForDirectionalIntent("sell");
const toneForOrderSide = (side) =>
  toneForDirectionalIntent(side, TRADE_BUY_TONE);
const AUTH_SESSION_QUERY_KEY = ["auth-session"];

async function readAuthSession({ signal }) {
  const response = await fetch("/api/auth/session", {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error("Auth session unavailable");
  }
  return response.json();
}

const TicketReadinessStrip = ({ model }) => {
  const tone = readinessToneColor(model?.tone);
  return (
    <div
      data-testid="trade-ticket-readiness-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(6),
        minWidth: 0,
        border: `1px solid ${cssColorAlpha(tone, "38")}`,
        background: cssColorAlpha(tone, "10"),
        padding: sp("6px 7px"),
      }}
    >
      <SeverityRail tone={tone} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(5),
          minWidth: 0,
          flexWrap: "wrap",
        }}
      >
        <MetricChip label="Route" value={model?.label || "Unknown"} tone={tone} />
        <span
          style={{
            minWidth: 0,
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {model?.detail || "waiting"}
        </span>
      </div>
    </div>
  );
};

export const TradeOrderTicket = ({
  slot,
  chainRows = [],
  expiration,
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  brokerPositions = [],
  brokerOrders = [],
  brokerPositionContextReady = false,
  brokerOrderContextReady = false,
  gatewayTradingReady = false,
  gatewayTradingMessage = "IBKR Client Portal must be connected before trading.",
  gatewayTradingBlockReason = "client_portal",
  automationContext = null,
  requestedSide = null,
  requestedNonce = 0,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { preferences: ticketPreferences } = useUserPreferences();
  const confirmBrokerOrders = ticketPreferences.trading.confirmOrders !== false;
  const objectValue = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = useMemo(
    () => ensureTradeTickerInfo(slot.ticker, slot.ticker),
    [slot.ticker],
  );
  const info = useRuntimeTickerSnapshot(slot.ticker, fallback);
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((r) => r.k === slot.strike);
  const prem = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : null;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : null;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : null;
  const rawDelta = row ? (slot.cp === "C" ? row.cDelta : row.pDelta) : null;
  const spread =
    isFiniteNumber(ask) && isFiniteNumber(bid) ? ask - bid : null;
  const spreadPct =
    isFiniteNumber(spread) && isFiniteNumber(prem) && prem > 0
      ? (spread / prem) * 100
      : null;
  const delta = isFiniteNumber(rawDelta) ? Math.abs(rawDelta) : null;
  const contractColor = toneForOptionSide(slot.cp, CSS_COLOR.textDim);
  const expInfo = expiration || {
    value: slot.exp,
    label: slot.exp,
    dte: daysToExpiration(slot.exp),
    actualDate: parseExpirationValue(slot.exp),
  };
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const [ticketAssetMode, setTicketAssetMode] = useState("option");
  const normalizedTicketAssetMode = normalizeTicketAssetMode(ticketAssetMode);
  const ticketIsShares = normalizedTicketAssetMode === "equity";
  const ticketIsOptions = !ticketIsShares;
  const equityPrice = isFiniteNumber(info?.price) ? info.price : null;
  const optionQuoteReady =
    Boolean(row) &&
    isFiniteNumber(prem) &&
    isFiniteNumber(bid) &&
    isFiniteNumber(ask) &&
    isFiniteNumber(rawDelta);
  const equityQuoteReady = isFiniteNumber(equityPrice);
  const optionTicketReady =
    optionQuoteReady && Boolean(selectedContractMeta && expInfo.actualDate);
  const shareTicketReady = Boolean(slot.ticker);
  const ticketReferencePrice = ticketIsShares ? equityPrice : prem;
  const ticketInstrumentReady = ticketIsShares
    ? shareTicketReady
    : optionTicketReady;
  const ticketOptionContract = selectedContractMeta || {
    ticker: slot.ticker,
    symbol: slot.ticker,
    expirationDate: expInfo.actualDate || slot.exp,
    exp: expInfo.label || slot.exp,
    strike: slot.strike,
    right: slot.cp,
    cp: slot.cp,
  };
  const ticketOptionContractLabel = formatOptionContractLabel(ticketOptionContract, {
    symbol: slot.ticker,
    fallback: `${slot.ticker} ${slot.strike}${slot.cp}`,
  });
  const ticketOptionContractShortLabel = formatOptionContractLabel(
    ticketOptionContract,
    {
      symbol: slot.ticker,
      includeSymbol: false,
      fallback: `${slot.strike}${slot.cp}`,
    },
  );
  const ticketInstrumentLabel = ticketIsShares
    ? slot.ticker
    : ticketOptionContractLabel;
  const ticketInstrumentDetail = ticketIsShares
    ? "SHARES"
    : `${expInfo.label || slot.exp} · ${expInfo.dte}d`;
  const ticketQuantityUnit = ticketIsShares ? "shares" : "contracts";
  const ticketAssetClass = ticketIsShares ? "equity" : "option";
  const ticketMultiplier = ticketIsShares ? 1 : 100;
  const automationTicketContext = ticketIsOptions ? automationContext : null;
  const contractDateKey = (value) => {
    if (!value) return null;
    const date = parseExpirationValue(value);
    return !date || Number.isNaN(date.getTime())
      ? String(value).slice(0, 10)
      : date.toISOString().slice(0, 10);
  };
  const optionContractsMatch = (left, right) => {
    const leftContract = objectValue(left);
    const rightContract = objectValue(right);
    const leftProvider = String(leftContract.providerContractId || "");
    const rightProvider = String(rightContract.providerContractId || "");
    const providerMatches =
      leftProvider && rightProvider ? leftProvider === rightProvider : true;
    return (
      providerMatches &&
      String(leftContract.underlying || leftContract.ticker || "").toUpperCase() ===
        String(rightContract.underlying || rightContract.ticker || "").toUpperCase() &&
      contractDateKey(leftContract.expirationDate) ===
        contractDateKey(rightContract.expirationDate) &&
      Number(leftContract.strike) === Number(rightContract.strike) &&
      String(leftContract.right || "").toLowerCase() ===
        String(rightContract.right || "").toLowerCase()
    );
  };
  const shadowExposureQuery = useQuery({
    queryKey: [
      "/api/accounts/shadow/positions",
      "option-exposure",
      slot.ticker,
      selectedContractMeta?.providerContractId || null,
      expInfo.actualDate || null,
      slot.strike,
      slot.cp,
    ],
    queryFn: () =>
      platformJsonRequest(
        "/api/accounts/shadow/positions?mode=shadow&assetClass=option&liveQuotes=false",
      ),
    enabled: Boolean(ticketIsOptions && selectedContractMeta && expInfo.actualDate),
    staleTime: 15_000,
    refetchInterval: false,
  });
  const snapTradeExecutionState = useSnapTradeExecutionAccountState();
  const snapTradeAccount = snapTradeExecutionState.selectedAccount || null;
  const snapTradeAccountReady = Boolean(snapTradeAccount?.executionReady);
  const liveBrokerRoute = ticketIsShares ? "snaptrade" : "ibkr";
  const snapTradeAuthSessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: readAuthSession,
    enabled: Boolean(liveBrokerRoute === "snaptrade" && snapTradeAccountReady),
    staleTime: 60_000,
    retry: false,
  });
  const snapTradeCsrfToken = snapTradeAuthSessionQuery.data?.csrfToken || "";
  const snapTradeCsrfHeaders = useMemo(
    () => (snapTradeCsrfToken ? { "x-csrf-token": snapTradeCsrfToken } : {}),
    [snapTradeCsrfToken],
  );
  const liveOrderPayloadReady = ticketIsShares
    ? Boolean(snapTradeAccountReady && slot.ticker)
    : Boolean(accountId && selectedContractMeta && expInfo.actualDate);
  const gatewayTradingBlocked = !gatewayTradingReady;
  const gatewayTradingBlockedLabel =
    gatewayTradingBlockReason === "streams_stale"
      ? "STREAMS STALE"
      : "SESSION REQUIRED";
  const placeOrderMutation = usePlaceOrder({
    mutation: {
      onSuccess: (order) => {
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
        toast.push({
          kind: "success",
          title: `Submitted ${ticketInstrumentLabel}`,
          body: `${order.quantity} × ${order.type.toUpperCase()} · ${order.status.toUpperCase()} · ${order.id}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Order rejected",
          body: error?.message || "The broker rejected the order.",
        });
      },
    },
  });
  const submitOrdersMutation = useSubmitOrders({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
        const submittedOrderIds = Array.isArray(result?.submittedOrderIds)
          ? result.submittedOrderIds
          : [];
        toast.push({
          kind: "success",
          title: `Attached exits submitted ${ticketInstrumentLabel}`,
          body:
            result?.message ||
            `${submittedOrderIds.length || 2} attached IBKR orders were routed.`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Attached exits rejected",
          body:
            error?.message ||
            "The broker rejected the attached parent or exit orders.",
        });
      },
    },
  });
  const placeShadowOrderMutation = useMutation({
    mutationFn: (payload) =>
      platformJsonRequest("/api/shadow/orders", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          String(query.queryKey[0] || "").includes("/api/accounts/shadow"),
      });
      toast.push({
        kind: "success",
        title: `Shadow filled ${ticketInstrumentLabel}`,
        body: `${order.filledQuantity || order.quantity} × ${String(order.side).toUpperCase()} @ ${Number(order.averageFillPrice || 0).toFixed(2)}`,
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Shadow fill rejected",
        body: error?.message || "The internal Shadow ledger rejected this fill.",
      });
    },
  });
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [shadowExposureAcknowledged, setShadowExposureAcknowledged] =
    useState(false);
  const recordAutomationDeviationMutation = useMutation({
    mutationFn: ({ deploymentId, payload }) =>
      platformJsonRequest(
        `/api/algo/deployments/${encodeURIComponent(deploymentId)}/signal-options/deviation`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onError: (error) => {
      toast.push({
        kind: "warn",
        title: "Deviation not recorded",
        body:
          error?.message ||
          "The order preview succeeded, but the automation deviation event was not saved.",
      });
    },
  });
  const previewOrderMutation = usePreviewOrder({
    mutation: {
      onSuccess: (preview, variables) => {
        setPreviewSnapshot(preview);
        const deviation = automationTicketContext
          ? buildSignalOptionsDeviation(
              automationTicketContext,
              variables?.data || orderRequest,
            )
          : null;
        if (deviation) {
          recordAutomationDeviationMutation.mutate(deviation);
        }
        toast.push({
          kind: "success",
          title: "IBKR preview ready",
          body: `${preview.symbol} · ${ticketIsShares ? "stock" : "contract"} ${preview.resolvedContractId} · ${preview.accountId}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Preview failed",
          body:
            error?.message ||
            "The bridge could not build an IBKR order payload.",
        });
      },
    },
  });
  const previewShadowOrderMutation = useMutation({
    mutationFn: (payload) =>
      platformJsonRequest("/api/shadow/orders/preview", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (preview, variables) => {
      setPreviewSnapshot(preview);
      const deviation = automationTicketContext
        ? buildSignalOptionsDeviation(
            automationTicketContext,
            variables || shadowOrderRequest,
          )
        : null;
      if (deviation) {
        recordAutomationDeviationMutation.mutate(deviation);
      }
      toast.push({
        kind: "success",
        title: "Shadow preview ready",
        body: `${preview.symbol} · ${preview.accountId} · est fill ${Number(preview.fillPrice || 0).toFixed(2)}`,
      });
    },
    onError: (error) => {
      toast.push({
        kind: "error",
        title: "Shadow preview failed",
        body:
          error?.message ||
          "The Shadow ledger could not preview this fill.",
      });
    },
  });
  const submitSnapTradeOrderMutation = useSubmitSnapTradeEquityOrder({
    request: { headers: snapTradeCsrfHeaders },
    mutation: {
      onSuccess: (result, variables) => {
        const submittedAccountId = variables?.accountId;
        if (submittedAccountId) {
          void queryClient.invalidateQueries({
            queryKey: getGetSnapTradeAccountPortfolioQueryKey(submittedAccountId),
          });
          void queryClient.invalidateQueries({
            queryKey: getGetSnapTradeRecentOrdersQueryKey(submittedAccountId),
          });
        }
        toast.push({
          kind: "success",
          title: `Submitted ${ticketInstrumentLabel}`,
          body: [
            result?.order?.action,
            result?.order?.units,
            result?.order?.symbol,
            result?.order?.status,
            result?.order?.brokerageOrderId,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "SnapTrade order rejected",
          body: error?.message || "SnapTrade rejected the equity order.",
        });
      },
    },
  });
  const snapTradeImpactMutation = useCheckSnapTradeEquityOrderImpact({
    request: { headers: snapTradeCsrfHeaders },
  });
  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);
  const [liveConfirmError, setLiveConfirmError] = useState(null);

  // ── CONTROLLED STATE ──
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LMT");
  const [tif, setTif] = useState("DAY"); // DAY / GTC / IOC / FOK
  const [qty, setQty] = useState(3);
  const [limitPrice, setLimitPrice] = useState(
    isFiniteNumber(prem) ? prem : "",
  );
  const [stopPrice, setStopPrice] = useState(
    isFiniteNumber(prem) ? prem : "",
  );
  const initialRiskPrices = getDefaultTicketRiskPrices(prem, "BUY", "option");
  const [stopLoss, setStopLoss] = useState(initialRiskPrices.stopLoss);
  const [takeProfit, setTakeProfit] = useState(initialRiskPrices.takeProfit);
  const [attachStopLoss, setAttachStopLoss] = useState(false);
  const [attachTakeProfit, setAttachTakeProfit] = useState(false);
  const [executionMode, setExecutionMode] = useState(() =>
    normalizeTradingExecutionMode(_initialState.tradeExecutionMode),
  );
  const executionIsShadow = executionMode === "shadow";
  const liveUsesSnapTrade =
    !executionIsShadow && liveBrokerRoute === "snaptrade";
  const snapTradeSymbolSearchText = String(slot.ticker || "")
    .trim()
    .toUpperCase();
  const snapTradeSymbolSearchQuery = useSearchSnapTradeAccountSymbols(
    snapTradeAccount?.id || "",
    { query: snapTradeSymbolSearchText },
    {
      query: {
        enabled: Boolean(
          liveUsesSnapTrade &&
            snapTradeAccountReady &&
            snapTradeAccount?.id &&
            snapTradeSymbolSearchText,
        ),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const snapTradeBestSymbol = snapTradeSymbolSearchQuery.data?.bestMatch || null;
  const snapTradeRecentOrdersQuery = useGetSnapTradeRecentOrders(
    snapTradeAccount?.id || "",
    {
      query: {
        enabled: Boolean(
          liveUsesSnapTrade &&
            snapTradeAccountReady &&
            snapTradeAccount?.id,
        ),
        staleTime: 15_000,
        retry: false,
      },
    },
  );
  const snapTradeRecentOrders = snapTradeRecentOrdersQuery.data?.orders || [];
  const latestSnapTradeOrder = snapTradeRecentOrders[0] || null;
  const latestSnapTradeOrderStatus =
    latestSnapTradeOrder?.status ||
    (snapTradeRecentOrdersQuery.isError
      ? "ERROR"
      : snapTradeRecentOrdersQuery.isFetching
        ? "REFRESHING"
        : "NO RECENT ORDERS");
  const latestSnapTradeOrderDetail = latestSnapTradeOrder
    ? [
        latestSnapTradeOrder.action,
        latestSnapTradeOrder.filledQuantity != null &&
        latestSnapTradeOrder.totalQuantity != null
          ? `${latestSnapTradeOrder.filledQuantity}/${latestSnapTradeOrder.totalQuantity}`
          : latestSnapTradeOrder.totalQuantity,
        latestSnapTradeOrder.symbol || latestSnapTradeOrder.optionTicker,
        latestSnapTradeOrder.brokerageOrderId,
      ]
        .filter(Boolean)
        .join(" · ")
    : snapTradeRecentOrdersQuery.isFetching
      ? "Updating"
      : snapTradeRecentOrdersQuery.isError
        ? "Unavailable"
        : "Last 24h clear";
  const snapTradeExecutionAccountLabel =
    snapTradeAccount?.displayName || "Sync SnapTrade";
  const selectedExecutionLabel = executionIsShadow
    ? "SHADOW"
    : liveUsesSnapTrade
      ? snapTradeAccountReady
        ? "SNAPTRADE LIVE"
        : "SNAPTRADE SETUP"
    : brokerConfigured
      ? gatewayTradingReady
        ? `IBKR ${environment.toUpperCase()}`
        : gatewayTradingBlockReason === "streams_stale"
          ? "IBKR STREAMS STALE"
          : "IBKR GATEWAY REQUIRED"
      : "IBKR REQUIRED";
  const selectedExecutionAccount = executionIsShadow
    ? "shadow"
    : liveUsesSnapTrade
      ? snapTradeExecutionAccountLabel
    : brokerConfigured
      ? accountId || MISSING_VALUE
      : MISSING_VALUE;
  const selectedExecutionColor = executionIsShadow
    ? CSS_COLOR.pink
    : liveUsesSnapTrade
      ? snapTradeAccountReady
        ? CSS_COLOR.green
        : CSS_COLOR.amber
    : brokerConfigured
      ? gatewayTradingReady
        ? CSS_COLOR.green
        : CSS_COLOR.amber
      : CSS_COLOR.textDim;
  const ticketEntryReferencePrice = ticketIsOptions
    ? side === "SELL"
      ? isFiniteNumber(bid)
        ? bid
        : ticketReferencePrice
      : isFiniteNumber(ask)
        ? ask
        : ticketReferencePrice
    : ticketReferencePrice;
  const selectSide = (nextSide) => {
    setSide(nextSide);
    if (ticketIsOptions && slot.cp === "C" && nextSide === "SELL") {
      setOrderType("LMT");
    }
  };
  // Preselect side when the docked collapsed bar requests it (BUY/SELL pills).
  // Keyed on requestedNonce so re-tapping the same pill re-asserts the side.
  useEffect(() => {
    if (requestedSide === "BUY" || requestedSide === "SELL") {
      selectSide(requestedSide);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedNonce, requestedSide]);
  const renderTicketAssetModeControls = () => (
    <div data-testid="trade-ticket-asset-mode">
      <SegmentedControl
        ariaLabel="Asset mode"
        options={TICKET_ASSET_MODES.map((mode) => ({
          value: mode,
          label: mode === "equity" ? "SHARES" : "OPTIONS",
        }))}
        value={normalizedTicketAssetMode}
        onChange={setTicketAssetMode}
        buttonTestId="trade-ticket-asset-mode"
      />
    </div>
  );
  const renderExecutionModeControls = () => (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(8),
          padding: sp("2px 0 1px"),
        }}
      >
        <span
          style={{
            fontSize: textSize("body"),
            color: selectedExecutionColor,
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {selectedExecutionLabel}
        </span>
        <span style={{ fontSize: textSize("caption"), color: CSS_COLOR.textDim, fontFamily: T.sans }}>
          {selectedExecutionAccount}
        </span>
      </div>
      <SegmentedControl
        ariaLabel="Execution mode"
        options={TRADING_EXECUTION_MODES.map((mode) => ({
          value: mode,
          label: mode === "shadow" ? "SHADOW" : "REAL",
        }))}
        value={executionMode}
        onChange={setExecutionMode}
      />
      {!executionIsShadow && liveUsesSnapTrade && !snapTradeAccountReady ? (
        <div
          style={{
            background: `${cssColorMix(CSS_COLOR.amber, 7)}`,
            border: `1px solid ${cssColorMix(CSS_COLOR.amber, 21)}`,
            borderRadius: dim(RADII.xs),
            padding: sp("6px 8px"),
            fontSize: textSize("body"),
            color: CSS_COLOR.amber,
            fontFamily: T.sans,
            lineHeight: 1.35,
          }}
        >
          Sync an execution-ready SnapTrade account in Settings before
          submitting shares.
        </div>
      ) : null}
      {!executionIsShadow && !liveUsesSnapTrade && !gatewayTradingReady && (
        <div
          style={{
            background: `${cssColorMix(CSS_COLOR.amber, 7)}`,
            border: `1px solid ${cssColorMix(CSS_COLOR.amber, 21)}`,
            borderRadius: dim(RADII.xs),
            padding: sp("6px 8px"),
            fontSize: textSize("body"),
            color: CSS_COLOR.amber,
            fontFamily: T.sans,
            lineHeight: 1.35,
          }}
        >
          {gatewayTradingMessage}
        </div>
      )}
    </>
  );
  const ticketTypeOptions = TICKET_ORDER_TYPES.map((value) => [
    value,
    formatTicketOrderType(value),
  ]);
  const renderLockedTicketControls = () => (
    <div
      style={{
        display: "grid",
        gap: sp(6),
        border: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg0,
        borderRadius: dim(RADII.sm),
        padding: sp(8),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(8),
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: fs(11),
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {ticketInstrumentLabel}
        </span>
        <span style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("body") }}>
          {ticketInstrumentDetail}
        </span>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}
      >
        {["BUY", "SELL"].map((value) => {
          const sideColor = toneForOrderSide(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => selectSide(value)}
              style={{
                border: `1px solid ${side === value ? sideColor : CSS_COLOR.border}`,
                background: side === value ? sideColor : "transparent",
                color: side === value ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                borderRadius: dim(RADII.xs),
                padding: sp("6px 0"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.regular,
                cursor: "pointer",
              }}
            >
              {value}
            </button>
          );
        })}
      </div>
      <SegmentedControl
        ariaLabel="Order type"
        options={ticketTypeOptions.map(([value, label]) => ({
          value,
          label,
        }))}
        value={orderType}
        onChange={setOrderType}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.8fr 1fr 1fr",
          gap: sp(5),
        }}
      >
        <label
          style={{
            display: "grid",
            gap: sp(5),
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {ticketIsShares ? "Shares" : "Contracts"}
          <input
            type="number"
            min="1"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            style={{
              width: "100%",
              background: CSS_COLOR.bg1,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: textSize("paragraphMuted"),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              padding: sp("8px 10px"),
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: sp(3),
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          Limit
          <input
            type="number"
            step="0.01"
            disabled={orderType === "MKT" || orderType === "STP"}
            value={limitPrice}
            onChange={(event) => setLimitPrice(event.target.value)}
            style={{
              width: "100%",
              background: CSS_COLOR.bg1,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              color:
                orderType === "MKT" || orderType === "STP" ? CSS_COLOR.textMuted : CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: textSize("paragraphMuted"),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              padding: sp("8px 10px"),
              opacity: orderType === "MKT" || orderType === "STP" ? 0.5 : 1,
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: sp(5),
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Stop
          <input
            type="number"
            step="0.01"
            disabled={orderType !== "STP" && orderType !== "STP_LMT"}
            value={stopPrice}
            onChange={(event) => setStopPrice(event.target.value)}
            style={{
              width: "100%",
              background: CSS_COLOR.bg1,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              color:
                orderType === "STP" || orderType === "STP_LMT"
                  ? CSS_COLOR.text
                  : CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("paragraphMuted"),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              padding: sp("8px 10px"),
              opacity:
                orderType === "STP" || orderType === "STP_LMT" ? 1 : 0.5,
            }}
          />
        </label>
      </div>
      <SegmentedControl
        ariaLabel="Time in force"
        options={["DAY", "GTC", "IOC", "FOK"]}
        value={tif}
        onChange={setTif}
      />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}
      >
        <button
          type="button"
          disabled
          style={{
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg1,
            color: CSS_COLOR.textMuted,
            borderRadius: dim(RADII.sm),
            padding: sp("10px 0"),
            fontFamily: T.sans,
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: 0,
          }}
        >
          Preview Locked
        </button>
        <button
          type="button"
          disabled
          style={{
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg1,
            color: CSS_COLOR.textMuted,
            borderRadius: dim(RADII.sm),
            padding: sp("10px 0"),
            fontFamily: T.sans,
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: 0,
          }}
        >
          Quote Required
        </button>
      </div>
    </div>
  );
  // When the instrument or side changes, reset prices while preserving quantity.
  useEffect(() => {
    const riskPrices = getDefaultTicketRiskPrices(
      ticketEntryReferencePrice,
      side,
      normalizedTicketAssetMode,
    );
    setLimitPrice(
      isFiniteNumber(ticketEntryReferencePrice) ? ticketEntryReferencePrice : "",
    );
    setStopPrice(
      isFiniteNumber(ticketEntryReferencePrice) ? ticketEntryReferencePrice : "",
    );
    setStopLoss(riskPrices.stopLoss);
    setTakeProfit(riskPrices.takeProfit);
  }, [
    normalizedTicketAssetMode,
    side,
    slot.ticker,
    slot.strike,
    slot.cp,
    ticketEntryReferencePrice,
  ]);

  useEffect(() => {
    persistState({ tradeExecutionMode: executionMode });
  }, [executionMode]);

  useEffect(() => {
    if (executionMode === "shadow" || liveUsesSnapTrade) {
      setAttachStopLoss(false);
      setAttachTakeProfit(false);
    }
  }, [executionMode, liveUsesSnapTrade]);

  useEffect(() => {
    setPreviewSnapshot(null);
    setShadowExposureAcknowledged(false);
  }, [
    side,
    orderType,
    tif,
    qty,
    limitPrice,
    stopPrice,
    stopLoss,
    takeProfit,
    attachStopLoss,
    attachTakeProfit,
    executionMode,
    normalizedTicketAssetMode,
    ticketReferencePrice,
    ticketEntryReferencePrice,
    brokerPositions.length,
    brokerOrders.length,
    brokerPositionContextReady,
    brokerOrderContextReady,
    slot.ticker,
    slot.strike,
    slot.cp,
    slot.exp,
    expInfo.value,
    environment,
    accountId,
    brokerConfigured,
    brokerAuthenticated,
    automationTicketContext,
    liveBrokerRoute,
    snapTradeAccount?.id,
    snapTradeAccountReady,
  ]);
  const bidFlashClass = useValueFlash(ticketIsShares ? equityPrice : bid);
  const midFlashClass = useValueFlash(ticketReferencePrice);
  const askFlashClass = useValueFlash(ticketIsShares ? equityPrice : ask);
  const closeLiveConfirm = () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmError(null);
    setLiveConfirmState(null);
  };
  const lockedReadinessModel = buildTicketReadinessModel({
    executionMode,
    brokerRoute: liveBrokerRoute,
    gatewayTradingReady,
    brokerConfigured,
    brokerAuthenticated,
    accountId,
    snapTradeExecutionReady: snapTradeAccountReady,
    snapTradeExecutionBlockers: snapTradeAccount?.executionBlockers || [],
    ticketInstrumentReady,
    quoteReady: ticketIsShares ? equityQuoteReady : optionQuoteReady,
    spreadPct,
    previewPending:
      previewOrderMutation.isPending || previewShadowOrderMutation.isPending,
    submitPending:
      placeOrderMutation.isPending ||
      placeShadowOrderMutation.isPending ||
      submitOrdersMutation.isPending ||
      submitSnapTradeOrderMutation.isPending,
  });
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

  if (ticketIsOptions && !ticketInstrumentReady) {
    return (
      <div
        data-testid="trade-order-ticket"
        style={{
          background: CSS_COLOR.bg1,
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.md),
          padding: sp("16px 18px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
        }}
      >
        <div
          style={{
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            paddingBottom: sp(4),
          }}
        >
          ORDER TICKET
        </div>
        {renderTicketAssetModeControls()}
        {renderExecutionModeControls()}
        <TicketReadinessStrip model={lockedReadinessModel} />
        {renderLockedTicketControls()}
        <DataUnavailableState
          title="No live contract quote"
          detail="Preview and submit unlock once the selected option contract has a live chain row with bid, ask, greeks, and contract metadata. Shares trading remains available from the SHARES toggle."
        />
      </div>
    );
  }

  const isLong = side === "BUY";
  const selectedSideColor = isLong ? TRADE_BUY_TONE : TRADE_SELL_TONE;
  const qtyNum = Number(qty) || 0;
  const orderPrices = resolveTicketOrderPrices({
    orderType,
    limitPrice,
    stopPrice,
    fallbackPrice: ticketEntryReferencePrice,
  });
  const snapTradeOrderDraft = liveUsesSnapTrade
    ? buildSnapTradeEquityOrderDraft({
        account: snapTradeAccount,
        symbol: slot.ticker,
        side,
        orderType,
        tif,
        quantity: qtyNum,
        orderPrices,
      })
    : { ready: false, reason: "route", body: null };
  const snapTradeDraftBlockMessage =
    {
      snaptrade_account:
        "Select an execution-ready SnapTrade account in Settings.",
      symbol: "Select a ticker before submitting a SnapTrade order.",
      quantity: "Enter a positive share quantity.",
      price: "Enter a positive limit price.",
      stop: "Enter a positive stop trigger.",
    }[snapTradeOrderDraft.reason] ||
    "The SnapTrade order payload is not ready yet.";
  const snapTradeDraftButtonLabel =
    {
      symbol: "SYMBOL REQUIRED",
      quantity: "QTY REQUIRED",
      price: "PRICE REQUIRED",
      stop: "STOP REQUIRED",
    }[snapTradeOrderDraft.reason] || "SNAPTRADE BLOCKED";
  const fillPrice = orderPrices.fillPrice;
  const orderTypeLabel = formatTicketOrderType(orderType);
  const cost = fillPrice * qtyNum * ticketMultiplier;
  const hasPositiveFillPrice = Number.isFinite(fillPrice) && fillPrice > 0;
  const fillPriceDisplay = hasPositiveFillPrice
    ? fillPrice.toFixed(2)
    : orderType === "MKT"
      ? "MKT"
      : MISSING_VALUE;
  const stopLimitPriceDisplay =
    Number.isFinite(orderPrices.stopPrice) &&
    Number.isFinite(orderPrices.limitPrice)
      ? `${Number(orderPrices.stopPrice).toFixed(2)} / ${Number(orderPrices.limitPrice).toFixed(2)}`
      : MISSING_VALUE;
  const costDisplay =
    Number.isFinite(cost) && hasPositiveFillPrice
      ? `$${cost.toFixed(0)}`
      : MISSING_VALUE;
  const signedCostDisplay =
    costDisplay === MISSING_VALUE ? MISSING_VALUE : `${isLong ? "−" : "+"}${costDisplay}`;
  const breakeven =
    ticketIsOptions
      ? slot.cp === "C"
        ? slot.strike + fillPrice
        : slot.strike - fillPrice
      : fillPrice;
  const beMovePct =
    isFiniteNumber(info.price) && info.price !== 0
      ? ((breakeven - info.price) / info.price) * 100
      : null;
  const pop = ticketIsOptions && isFiniteNumber(delta)
    ? Math.max(15, Math.min(75, (0.5 - Math.abs(delta - 0.5)) * 100 + 25))
    : null;
  const slPct =
    fillPrice > 0 && Number.isFinite(+stopLoss)
      ? ((+stopLoss - fillPrice) / fillPrice) * 100
      : null;
  const tpPct =
    fillPrice > 0 && Number.isFinite(+takeProfit)
      ? ((+takeProfit - fillPrice) / fillPrice) * 100
      : null;
  const automationOrderPlan = objectValue(automationTicketContext?.orderPlan);
  const automationOrderPayload = automationTicketContext
    ? {
        candidateId: automationTicketContext.id || null,
        deploymentId: automationTicketContext.deploymentId || null,
        deploymentName: automationTicketContext.deploymentName || null,
        automationCandidate: automationTicketContext,
        plannedContract: objectValue(automationTicketContext.selectedContract),
        plannedOrderPlan: automationOrderPlan,
      }
    : null;
  const optionOrderContract =
    ticketIsOptions && selectedContractMeta && expInfo.actualDate
      ? {
          ticker: selectedContractMeta.ticker,
          underlying: selectedContractMeta.underlying,
          expirationDate: expInfo.actualDate,
          strike: selectedContractMeta.strike,
          right: selectedContractMeta.right,
          multiplier: selectedContractMeta.multiplier,
          sharesPerContract: selectedContractMeta.sharesPerContract,
          providerContractId: selectedContractMeta.providerContractId,
        }
      : null;
  const automationShadowLink = objectValue(automationTicketContext?.shadowLink);
  const automationAlreadyShadowFilled = Boolean(
    ticketIsOptions && (automationShadowLink.orderId || automationShadowLink.fillId),
  );
  const matchingShadowOptionPositions = (shadowExposureQuery.data?.positions || [])
    .filter(
      (position) =>
        (position.positionType === "option" || position.assetClass === "Options") &&
        position.optionContract &&
        selectedContractMeta &&
        optionContractsMatch(position.optionContract, selectedContractMeta),
    );
  const matchingShadowQuantity = matchingShadowOptionPositions.reduce(
    (sum, position) => sum + (Number(position.quantity) || 0),
    0,
  );
  const matchingShadowSources = Array.from(
    new Set(
      matchingShadowOptionPositions
        .map((position) => position.strategyLabel || position.sourceType)
        .filter(Boolean),
    ),
  );
  const sameShadowContractExposure =
    ticketIsOptions &&
    matchingShadowOptionPositions.length > 0 &&
    matchingShadowQuantity > 0;
  const sellCallIntent = resolveSellCallTicketIntent({
    side,
    assetMode: normalizedTicketAssetMode,
    selectedContract: optionOrderContract,
    symbol: slot.ticker,
    quantity: qtyNum,
    positions: brokerPositions,
    orders: brokerOrders,
    executionMode,
    brokerPositionContextReady,
    brokerOrderContextReady,
    shadowPositionContextReady: Boolean(shadowExposureQuery.data),
    shadowMatchingQuantity: matchingShadowQuantity,
  });
  const ticketActionLabel =
    side === "BUY"
      ? ticketIsOptions
        ? "BUY TO OPEN"
        : "BUY"
      : sellCallIntent.applies
        ? sellCallIntent.actionLabel
        : "SELL";
  const includeSellCallIntentFields =
    sellCallIntent.applies && sellCallIntent.allowed;
  const optionOrderIntentFields = {
    ...(includeSellCallIntentFields && sellCallIntent.positionEffect
      ? { positionEffect: sellCallIntent.positionEffect }
      : {}),
    ...(includeSellCallIntentFields && sellCallIntent.strategyIntent
      ? { strategyIntent: sellCallIntent.strategyIntent }
      : {}),
  };
  const shadowSellToCloseIntent =
    sellCallIntent.applies && sellCallIntent.strategyIntent === "sell_to_close";
  const shadowAddExposureWarningActive =
    sameShadowContractExposure && !shadowSellToCloseIntent;
  const orderRequest = !liveUsesSnapTrade && liveOrderPayloadReady
    ? {
        accountId,
        mode: environment,
        symbol: slot.ticker,
        assetClass: ticketAssetClass,
        side: side.toLowerCase(),
        type: normalizeTicketOrderType(orderType),
        quantity: qtyNum,
        limitPrice: orderPrices.limitPrice,
        stopPrice: orderPrices.stopPrice,
        timeInForce: tif.toLowerCase(),
        optionContract: optionOrderContract,
        ...optionOrderIntentFields,
        payload: automationOrderPayload
          ? {
              ...automationOrderPayload,
              source: "trade_broker_order",
            }
          : undefined,
      }
    : null;
  const shadowExecutionReady = ticketIsShares
    ? Boolean(slot.ticker)
    : Boolean(selectedContractMeta && expInfo.actualDate);
  const shadowOrderRequest = shadowExecutionReady
    ? {
        accountId: "shadow",
        mode: "shadow",
        symbol: slot.ticker,
        assetClass: ticketAssetClass,
        side: side.toLowerCase(),
        type: normalizeTicketOrderType(orderType),
        quantity: qtyNum,
        limitPrice: orderPrices.limitPrice,
        stopPrice: orderPrices.stopPrice,
        timeInForce: tif.toLowerCase(),
        optionContract: optionOrderContract,
        ...optionOrderIntentFields,
        payload: automationOrderPayload
          ? {
              ...automationOrderPayload,
              source: "trade_shadow_fill",
            }
          : undefined,
      }
    : null;
  const comparisonRequest =
    executionMode === "shadow"
      ? shadowOrderRequest
      : orderRequest || shadowOrderRequest;
  const liveDeviation = automationTicketContext
    ? buildSignalOptionsDeviation(automationTicketContext, comparisonRequest)
    : null;
  const liveDeviationFields = liveDeviation?.payload?.changedFields || [];
  const formatTicketMoney = (value, digits = 2) =>
    Number.isFinite(Number(value))
      ? `$${Number(value).toFixed(digits)}`
      : MISSING_VALUE;
  const formatTicketPrice = (value, digits = 2) =>
    Number.isFinite(Number(value))
      ? Number(value).toFixed(digits)
      : MISSING_VALUE;
  const hasAttachedExits =
    !executionIsShadow && !liveUsesSnapTrade && (attachStopLoss || attachTakeProfit);
  const attachedExitCount = (attachStopLoss ? 1 : 0) + (attachTakeProfit ? 1 : 0);
  const attachedExitLabel =
    attachedExitCount === 2
      ? "2 EXITS"
      : attachStopLoss
        ? "STOP"
        : attachTakeProfit
          ? "TARGET"
          : "SINGLE";
  const attachedExitPreviewLabel = [
    attachStopLoss ? `SL ${formatTicketPrice(stopLoss)}` : null,
    attachTakeProfit ? `TP ${formatTicketPrice(takeProfit)}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const attachedExitTogglesDisabled = executionIsShadow || liveUsesSnapTrade;
  const stopLossExitDisabled =
    attachedExitTogglesDisabled || !attachStopLoss;
  const takeProfitExitDisabled =
    attachedExitTogglesDisabled || !attachTakeProfit;
  const restoreAutomationPlan = () => {
    if (!automationTicketContext) {
      return;
    }
    setSide("BUY");
    setOrderType("LMT");
    setTif("DAY");
    setAttachStopLoss(false);
    setAttachTakeProfit(false);
    const plannedQuantity = Number(automationOrderPlan.quantity);
    const plannedPrice = Number(
      automationOrderPlan.entryLimitPrice ??
        automationOrderPlan.simulatedFillPrice,
    );
    if (Number.isFinite(plannedQuantity) && plannedQuantity > 0) {
      setQty(plannedQuantity);
    }
    if (Number.isFinite(plannedPrice) && plannedPrice > 0) {
      setLimitPrice(plannedPrice);
      setStopPrice(plannedPrice);
    }
    toast.push({
      kind: "info",
      title: "Signal-options plan restored",
      body: "The ticket side, quantity, order type, TIF, and limit were reset to the automation plan.",
    });
  };
  const previewOrderPayload =
    previewSnapshot?.orderPayload &&
    typeof previewSnapshot.orderPayload === "object"
      ? previewSnapshot.orderPayload
      : null;

  const validateTicket = ({ requireAttachedExits = false } = {}) => {
    if (qtyNum <= 0) {
      toast.push({
        kind: "error",
        title: "Invalid quantity",
        body: `Enter a positive number of ${ticketQuantityUnit}.`,
      });
      return false;
    }
    if (ticketIsOptions && !optionTicketReady) {
      toast.push({
        kind: "info",
        title: "Contract loading",
        body: "Wait for the selected option contract to finish loading before previewing or submitting.",
      });
      return false;
    }
    if (sellCallIntent.applies && !sellCallIntent.allowed) {
      toast.push({
        kind: sellCallIntent.contextPending ? "info" : "warn",
        title: sellCallIntent.contextPending
          ? "Call coverage loading"
          : "Call sale blocked",
        body:
          sellCallIntent.blockedReason ||
          "This call sale cannot be routed with the current account coverage.",
      });
      return false;
    }
    if (
      orderType !== "MKT" &&
      (!Number.isFinite(fillPrice) || fillPrice <= 0)
    ) {
      toast.push({
        kind: "error",
        title: "Invalid price",
        body: `Enter a positive ${orderType === "STP" ? "stop" : "limit"} price.`,
      });
      return false;
    }
    if (
      executionIsShadow &&
      ticketIsShares &&
      orderType === "MKT" &&
      !hasPositiveFillPrice
    ) {
      toast.push({
        kind: "info",
        title: "Stock fill price required",
        body: "Shadow market fills need an underlying stock quote. Use a share limit order with a positive limit price if the quote is unavailable.",
      });
      return false;
    }
    if (
      orderType === "STP_LMT" &&
      (!Number.isFinite(orderPrices.stopPrice) || orderPrices.stopPrice <= 0)
    ) {
      toast.push({
        kind: "error",
        title: "Invalid stop trigger",
        body: "Enter a positive stop trigger for the stop-limit order.",
      });
      return false;
    }
    if (requireAttachedExits) {
      const attachedExitError = validateTicketBracket({
        side,
        entryPrice: fillPrice,
        stopLoss,
        takeProfit,
        assetMode: normalizedTicketAssetMode,
        includeStopLoss: attachStopLoss,
        includeTakeProfit: attachTakeProfit,
      });
      if (attachedExitError) {
        toast.push({
          kind: "error",
          title: "Invalid exit order",
          body: attachedExitError,
        });
        return false;
      }
    }
    return true;
  };

  const previewOrder = async () => {
    if (!validateTicket()) {
      return;
    }

    if (executionMode === "shadow") {
      if (!shadowExecutionReady || !shadowOrderRequest) {
        toast.push({
          kind: "info",
	          title: ticketIsShares ? "Stock quote loading" : "Contract loading",
	          body: ticketIsShares
              ? "Wait for the stock quote to finish loading before previewing Shadow."
              : "Wait for the option contract to finish loading before previewing Shadow.",
	        });
	        return;
	      }

      previewShadowOrderMutation.mutate(shadowOrderRequest);
      return;
    }

    if (liveUsesSnapTrade) {
      if (!snapTradeCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before previewing a SnapTrade order.",
        });
        return;
      }
      if (!snapTradeAccount?.id || !snapTradeOrderDraft.ready || !snapTradeOrderDraft.body) {
        toast.push({
          kind: "warn",
          title: "SnapTrade preview blocked",
          body: snapTradeDraftBlockMessage,
        });
        return;
      }
      if (snapTradeSymbolSearchQuery.isFetching) {
        toast.push({
          kind: "info",
          title: "Symbol lookup loading",
          body: "Wait for SnapTrade to resolve this ticker for the selected brokerage account.",
        });
        return;
      }
      if (snapTradeSymbolSearchQuery.isError) {
        toast.push({
          kind: "warn",
          title: "Symbol lookup failed",
          body: "SnapTrade could not resolve this ticker for the selected brokerage account.",
        });
        return;
      }
      if (!snapTradeBestSymbol?.id) {
        toast.push({
          kind: "warn",
          title: "Symbol not tradable",
          body: "SnapTrade did not return a tradable symbol for this ticker in the selected account.",
        });
        return;
      }

      try {
        const preview = await snapTradeImpactMutation.mutateAsync({
          accountId: snapTradeAccount.id,
          data: {
            action: snapTradeOrderDraft.body.action,
            universalSymbolId: snapTradeBestSymbol.id,
            symbol:
              snapTradeBestSymbol.symbol ||
              snapTradeOrderDraft.body.symbol ||
              slot.ticker,
            orderType: snapTradeOrderDraft.body.orderType,
            timeInForce: snapTradeOrderDraft.body.timeInForce,
            units: snapTradeOrderDraft.body.units ?? null,
            notionalValue: snapTradeOrderDraft.body.notionalValue ?? null,
            price: snapTradeOrderDraft.body.price ?? null,
            stop: snapTradeOrderDraft.body.stop ?? null,
          },
        });
        const previewPrice =
          preview?.order?.price ??
          (Number.isFinite(ticketEntryReferencePrice)
            ? ticketEntryReferencePrice
            : null);
        setPreviewSnapshot({
          accountId: preview?.account?.id || snapTradeAccount.id,
          resolvedContractId:
            preview?.order?.universalSymbolId || snapTradeBestSymbol.id,
          symbol:
            preview?.order?.symbol ||
            snapTradeBestSymbol.symbol ||
            slot.ticker,
          fillPrice: previewPrice,
          orderPayload: {
            route: "SNAPTRADE",
            action: preview?.order?.action || snapTradeOrderDraft.body.action,
            side: String(
              preview?.order?.action || snapTradeOrderDraft.body.action,
            ).toLowerCase(),
            orderType:
              preview?.order?.orderType || snapTradeOrderDraft.body.orderType,
            timeInForce:
              preview?.order?.timeInForce ||
              snapTradeOrderDraft.body.timeInForce,
            quantity:
              preview?.order?.units ?? snapTradeOrderDraft.body.units ?? qtyNum,
            totalQuantity:
              preview?.order?.units ?? snapTradeOrderDraft.body.units ?? qtyNum,
            price: previewPrice,
            stop: preview?.order?.stop ?? snapTradeOrderDraft.body.stop ?? null,
            tradeId: preview?.trade?.id || null,
            expiresAt: preview?.trade?.expiresAt || null,
            estimatedCommission:
              preview?.impact?.estimatedCommission ?? null,
            remainingCash: preview?.impact?.remainingCash ?? null,
          },
        });
        toast.push({
          kind: "success",
          title: "SnapTrade preview ready",
          body: [
            preview?.order?.action || snapTradeOrderDraft.body.action,
            preview?.order?.units ?? snapTradeOrderDraft.body.units,
            preview?.order?.symbol ||
              snapTradeBestSymbol.symbol ||
              slot.ticker,
            preview?.trade?.id,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      } catch (error) {
        toast.push({
          kind: "error",
          title: "SnapTrade preview failed",
          body:
            error?.message ||
            "SnapTrade could not simulate this equity order.",
        });
      }
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "info",
        title: "IBKR required",
        body: "Local preview simulation has been removed. Connect IBKR Client Portal to preview a live order.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "No IBKR account is active yet.",
      });
      return;
    }

    if (!liveOrderPayloadReady || !orderRequest) {
      toast.push({
        kind: "info",
        title: ticketIsShares ? "Ticker loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the ticker to finish loading before previewing a broker order."
          : "Wait for the live option chain to finish loading before previewing a broker order.",
      });
      return;
    }

    previewOrderMutation.mutate({ data: orderRequest });
  };

  const submitLiveBrokerOrder = async () => {
    if (liveUsesSnapTrade) {
      if (!snapTradeCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before submitting a SnapTrade order.",
        });
        return;
      }
      if (!snapTradeAccount?.id || !snapTradeOrderDraft.ready || !snapTradeOrderDraft.body) {
        toast.push({
          kind: "error",
          title: "SnapTrade order unavailable",
          body: snapTradeDraftBlockMessage,
        });
        return;
      }

      await submitSnapTradeOrderMutation.mutateAsync({
        accountId: snapTradeAccount.id,
        data: snapTradeOrderDraft.body,
      });
      return;
    }

    if (!orderRequest) {
      toast.push({
        kind: "error",
        title: "Order unavailable",
        body: "The broker order payload is not ready yet.",
      });
      return;
    }

    if (hasAttachedExits) {
      const preview = await previewOrderMutation.mutateAsync({ data: orderRequest });

      if (!isTwsStructuredOrderPayload(preview?.orderPayload)) {
        toast.push({
          kind: "error",
          title: "Attached exits unavailable",
          body: "The current IBKR broker session did not return a structured order payload for attached exit submission.",
        });
        return;
      }

      await submitOrdersMutation.mutateAsync({
        data: {
          accountId,
          mode: environment,
          confirm: true,
          parentOrderRequest: orderRequest,
          ibkrOrders: buildTwsBracketOrders({
            previewPayload: preview.orderPayload,
            side,
            quantity: qtyNum,
            stopLossPrice: stopLoss,
            takeProfitPrice: takeProfit,
            includeStopLoss: attachStopLoss,
            includeTakeProfit: attachTakeProfit,
          }),
        },
      });
      return;
    }

    await placeOrderMutation.mutateAsync({
      data: {
        ...orderRequest,
        confirm: true,
      },
    });
  };

  const submitOrder = () => {
    if (!validateTicket({ requireAttachedExits: hasAttachedExits })) {
      return;
    }

    if (liveUsesSnapTrade) {
      if (!snapTradeAccountReady || !snapTradeAccount?.id) {
        toast.push({
          kind: "warn",
          title: "SnapTrade account required",
          body: "Sync and select an execution-ready SnapTrade account in Settings before submitting shares.",
        });
        return;
      }
      if (snapTradeAuthSessionQuery.isPending) {
        toast.push({
          kind: "info",
          title: "Auth session loading",
          body: "Wait for the app session token before submitting a SnapTrade order.",
        });
        return;
      }
      if (!snapTradeCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before submitting a SnapTrade order.",
        });
        return;
      }
      if (!snapTradeOrderDraft.ready || !snapTradeOrderDraft.body) {
        toast.push({
          kind: "warn",
          title: "SnapTrade order blocked",
          body: snapTradeDraftBlockMessage,
        });
        return;
      }

      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `${ticketActionLabel} ${ticketInstrumentLabel}`,
        detail: `Submit this live SnapTrade equity order through ${snapTradeExecutionAccountLabel}.`,
        confirmLabel: `${ticketActionLabel} SNAPTRADE ORDER`,
        confirmTone: selectedSideColor,
        lines: [
          { label: "ACCOUNT", value: snapTradeExecutionAccountLabel },
          { label: "SYMBOL", value: slot.ticker },
          { label: "ROUTE", value: "SNAPTRADE" },
          { label: "ASSET", value: "SHARES" },
          { label: "TYPE", value: orderTypeLabel },
          { label: "TIF", value: tif },
          {
            label: "QTY",
            value: `${qtyNum || 0} ${ticketQuantityUnit.toUpperCase()}`,
          },
          {
            label:
              orderType === "STP" || orderType === "STP_LMT"
                ? "STOP"
                : orderType === "MKT"
                  ? "MARK"
                  : "LIMIT",
            value:
              orderType === "STP_LMT"
                ? stopLimitPriceDisplay
                : fillPriceDisplay,
          },
          {
            label: isLong ? "EST COST" : "EST CREDIT",
            value: costDisplay,
            valueColor: isLong ? CSS_COLOR.red : CSS_COLOR.green,
          },
        ],
        onConfirm: submitLiveBrokerOrder,
      });
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR required",
        body: "Local order fills are disabled. Connect IBKR Client Portal to submit this order.",
      });
      return;
    }

    if (gatewayTradingBlocked) {
      toast.push({
        kind: "warn",
        title: "IBKR session unavailable",
        body: gatewayTradingMessage,
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

    if (!liveOrderPayloadReady || !orderRequest) {
      toast.push({
        kind: "info",
        title: ticketIsShares ? "Ticker loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the ticker to finish loading before submitting a broker order."
          : "Wait for the live option chain to finish loading before submitting a broker order.",
      });
      return;
    }

    setLiveConfirmError(null);
    if (!confirmBrokerOrders && environment !== "live") {
      void submitLiveBrokerOrder();
      return;
    }

    setLiveConfirmState({
      title: `${ticketActionLabel} ${ticketInstrumentLabel}`,
      detail: hasAttachedExits
        ? `Submit this ${environment.toUpperCase()} IBKR parent order with ${attachedExitCount} attached exit order${attachedExitCount === 1 ? "" : "s"}.`
        : `Submit this ${environment.toUpperCase()} broker order to Interactive Brokers for immediate routing.`,
      confirmLabel: hasAttachedExits
        ? `${ticketActionLabel} IBKR + ${attachedExitLabel}`
        : `${ticketActionLabel} IBKR ORDER`,
      confirmTone: selectedSideColor,
      lines: [
        { label: "ACCOUNT", value: accountId || MISSING_VALUE },
        { label: "SYMBOL", value: slot.ticker },
        ...(ticketIsOptions
          ? [
              {
                label: "CONTRACT",
                value: ticketOptionContractShortLabel,
              },
            ]
          : [{ label: "ASSET", value: "SHARES" }]),
        {
          label: "TYPE",
          value: hasAttachedExits
            ? `${orderTypeLabel} + ${attachedExitLabel}`
            : orderTypeLabel,
        },
        { label: "TIF", value: tif },
        {
          label: "QTY",
          value: `${qtyNum || 0} ${ticketQuantityUnit.toUpperCase()}`,
        },
        {
          label:
            orderType === "STP" || orderType === "STP_LMT"
              ? "STOP"
              : orderType === "MKT"
                ? "MARK"
                : "LIMIT",
          value:
            orderType === "STP_LMT"
              ? stopLimitPriceDisplay
              : fillPriceDisplay,
        },
        ...(attachStopLoss
          ? [
              {
                label: "STOP LOSS",
                value: formatTicketPrice(stopLoss),
                valueColor: CSS_COLOR.red,
              },
            ]
          : []),
        ...(attachTakeProfit
          ? [
              {
                label: "TAKE PROFIT",
                value: formatTicketPrice(takeProfit),
                valueColor: CSS_COLOR.green,
              },
            ]
          : []),
        ...(sellCallIntent.applies
          ? [
              { label: "INTENT", value: sellCallIntent.intentLabel },
              {
                label: "COVERAGE",
                value:
                  sellCallIntent.strategyIntent === "covered_call"
                    ? `${sellCallIntent.coverage.coveredCallCapacity} covered / ${sellCallIntent.coverage.reservedShares} reserved sh`
                    : `${sellCallIntent.coverage.availableMatchingLongCallContracts} available long call(s)`,
              },
            ]
          : []),
        {
          label: isLong ? "EST COST" : "EST CREDIT",
          value: costDisplay,
          valueColor: isLong ? CSS_COLOR.red : CSS_COLOR.green,
        },
      ],
      onConfirm: submitLiveBrokerOrder,
    });
  };

  const submitShadowOrder = () => {
    if (!validateTicket()) {
      return;
    }
    if (automationAlreadyShadowFilled) {
      toast.push({
        kind: "warn",
        title: "Shadow already filled",
        body: "This signal-options candidate already has a linked Shadow order or fill. Use Account > Shadow before adding manual exposure.",
      });
      return;
    }
    if (shadowAddExposureWarningActive && !shadowExposureAcknowledged) {
      setShadowExposureAcknowledged(true);
      toast.push({
        kind: "warn",
        title: "Shadow exposure exists",
        body: `Shadow already holds ${matchingShadowQuantity.toFixed(2)} contract(s) in this option. Click Shadow Fill again to add exposure.`,
      });
      return;
    }
    if (!shadowExecutionReady || !shadowOrderRequest) {
      toast.push({
        kind: "info",
        title: ticketIsShares ? "Stock quote loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the stock quote to finish loading before filling Shadow."
          : "Wait for the option contract to finish loading before filling Shadow.",
      });
      return;
    }
    placeShadowOrderMutation.mutate(shadowOrderRequest);
  };

  const automationContract = objectValue(automationTicketContext?.selectedContract);
  const plannedContractLabel = formatOptionContractLabel(automationContract, {
    includeSymbol: false,
    fallback: "",
  });
  const currentContractLabel = formatOptionContractLabel(
    {
      exp: expInfo.label || slot.exp,
      strike: slot.strike,
      cp: slot.cp,
    },
    { includeSymbol: false },
  );
  const comparisonRows = automationTicketContext
    ? [
        {
          label: "Contract",
          planned: plannedContractLabel || MISSING_VALUE,
          current: currentContractLabel || MISSING_VALUE,
          changed: liveDeviationFields.includes("contract") || liveDeviationFields.includes("provider_contract_id"),
        },
        {
          label: "Side",
          planned: "BUY",
          current: side,
          changed: liveDeviationFields.includes("side"),
        },
        {
          label: "Qty",
          planned: automationOrderPlan.quantity ?? MISSING_VALUE,
          current: qtyNum || MISSING_VALUE,
          changed: liveDeviationFields.includes("quantity"),
        },
        {
          label: "Limit",
          planned: formatTicketPrice(automationOrderPlan.entryLimitPrice),
          current:
            orderType === "LMT"
              ? formatTicketPrice(fillPrice)
              : orderType,
          changed:
            liveDeviationFields.includes("limit_price") ||
            liveDeviationFields.includes("order_type"),
        },
      ]
    : [];
  const parentPriceLabel =
    orderType === "MKT"
      ? ticketIsShares
        ? "LAST"
        : side === "SELL"
          ? "BID"
          : "ASK"
      : orderType === "STP"
        ? "STOP"
        : "LIMIT";
  const parentPriceValue =
    orderType === "MKT"
      ? isFiniteNumber(ticketEntryReferencePrice)
        ? formatPriceValue(ticketEntryReferencePrice)
        : ""
      : orderType === "STP"
        ? stopPrice
        : limitPrice;
  const parentPriceDisabled = orderType === "MKT";
  const qtyPresets = ticketIsShares ? [1, 10, 25, 50, 100] : [1, 3, 5, 10];
  const ibkrSubmitPending =
    placeOrderMutation.isPending || submitOrdersMutation.isPending;
  const previewIsPending =
    previewOrderMutation.isPending ||
    previewShadowOrderMutation.isPending ||
    snapTradeImpactMutation.isPending;
  const primarySubmitPending = executionIsShadow
    ? placeShadowOrderMutation.isPending
    : liveUsesSnapTrade
      ? submitSnapTradeOrderMutation.isPending
      : ibkrSubmitPending;
  const sellCallSubmitBlocked = sellCallIntent.applies && !sellCallIntent.allowed;
  const snapTradeAuthLoading =
    liveUsesSnapTrade &&
    snapTradeAccountReady &&
    snapTradeAuthSessionQuery.isPending;
  const ticketReadinessModel = buildTicketReadinessModel({
    executionMode,
    brokerRoute: liveBrokerRoute,
    gatewayTradingReady,
    brokerConfigured,
    brokerAuthenticated,
    accountId,
    snapTradeExecutionReady: snapTradeAccountReady,
    snapTradeExecutionBlockers: snapTradeAccount?.executionBlockers || [],
    ticketInstrumentReady,
    quoteReady: ticketIsShares ? equityQuoteReady : optionQuoteReady,
    spreadPct,
    previewPending: previewIsPending,
    submitPending: primarySubmitPending,
    sellCallBlocked: sellCallSubmitBlocked,
    shadowExposureWarning: shadowAddExposureWarningActive,
    automationDeviationCount: liveDeviationFields.length,
  });
  const primarySubmitDisabled = executionIsShadow
    ? placeShadowOrderMutation.isPending ||
      automationAlreadyShadowFilled ||
      sellCallSubmitBlocked
    : liveUsesSnapTrade
      ? submitSnapTradeOrderMutation.isPending ||
        snapTradeAuthLoading ||
        !snapTradeCsrfToken ||
        !snapTradeOrderDraft.ready ||
        sellCallSubmitBlocked
      : ibkrSubmitPending || gatewayTradingBlocked || sellCallSubmitBlocked;
  const previewDisabled =
    previewIsPending ||
    sellCallSubmitBlocked;
  const primarySubmitColor = executionIsShadow ? CSS_COLOR.pink : selectedSideColor;
  const primarySubmitLabel = executionIsShadow
    ? placeShadowOrderMutation.isPending
      ? "FILLING..."
      : automationAlreadyShadowFilled
        ? "SHADOW FILLED"
        : sellCallSubmitBlocked
          ? sellCallIntent.actionLabel
	        : shadowAddExposureWarningActive && !shadowExposureAcknowledged
	          ? "ADD EXPOSURE?"
	        : shadowAddExposureWarningActive
	            ? "CONFIRM ADD EXPOSURE"
	            : `${ticketActionLabel} SHADOW ${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} × ${fillPriceDisplay}`
    : liveUsesSnapTrade
      ? submitSnapTradeOrderMutation.isPending
        ? "SUBMITTING..."
        : !snapTradeAccountReady
          ? "SNAPTRADE ACCOUNT REQUIRED"
          : snapTradeAuthLoading
            ? "AUTH LOADING..."
            : !snapTradeCsrfToken
              ? "AUTH SESSION REQUIRED"
              : !snapTradeOrderDraft.ready
                ? snapTradeDraftButtonLabel
                : `${ticketActionLabel} SNAPTRADE ${qtyNum || 0} sh × ${fillPriceDisplay} · ${signedCostDisplay}`
    : gatewayTradingBlocked
      ? gatewayTradingBlockedLabel
      : ibkrSubmitPending
      ? "SUBMITTING..."
      : sellCallSubmitBlocked
        ? sellCallIntent.actionLabel
      : `${ticketActionLabel} ${hasAttachedExits ? `${attachedExitLabel} ` : ""}${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} × ${fillPriceDisplay} · ${signedCostDisplay}`;
	  const previewIsTwsStructured =
	    isTwsStructuredOrderPayload(previewOrderPayload);
	  const previewDisplayOrder = previewIsTwsStructured
	    ? previewOrderPayload.order
	    : previewOrderPayload;
	  const previewDisplayPrice =
    previewSnapshot?.fillPrice ??
	    previewDisplayOrder?.price ??
	    previewDisplayOrder?.lmtPrice ??
	    previewDisplayOrder?.auxPrice ??
	    null;
  const sellCallStatusColor = !sellCallIntent.applies
    ? CSS_COLOR.textDim
    : sellCallIntent.allowed
      ? sellCallIntent.strategyIntent === "covered_call"
        ? CSS_COLOR.cyan
        : CSS_COLOR.green
      : sellCallIntent.contextPending
        ? CSS_COLOR.amber
        : CSS_COLOR.red;
  const sellCallCoverageRows = sellCallIntent.applies
    ? [
        [
          "AVAIL CALLS",
          `${sellCallIntent.coverage.availableMatchingLongCallContracts.toFixed(2)} ct`,
        ],
        [
          "SHARES",
          `${Math.floor(sellCallIntent.coverage.longUnderlyingShares)} sh`,
        ],
        [
          "RESERVED",
          `${Math.floor(sellCallIntent.coverage.reservedShares)} sh`,
        ],
        [
          "COVERAGE",
          `${sellCallIntent.coverage.coveredCallCapacity.toFixed(2)} ct`,
        ],
      ]
    : [];

  return (
    <>
      <div
        data-testid="trade-order-ticket"
        className="ra-panel-enter"
        style={{
          background: CSS_COLOR.bg1,
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.md),
          padding: sp("16px 18px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(12),
          minWidth: 0,
        }}
      >
      <div
        style={{
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.regular,
          color: CSS_COLOR.textSec,
          fontFamily: T.sans,
          letterSpacing: "0.04em",
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          paddingBottom: sp(4),
        }}
      >
        ORDER TICKET
      </div>
      {renderTicketAssetModeControls()}
      {automationTicketContext ? (
        <div
          style={{
            border: `1px solid ${
              automationAlreadyShadowFilled ? `${cssColorMix(CSS_COLOR.green, 27)}` : `${cssColorMix(CSS_COLOR.cyan, 21)}`
            }`,
            background: automationAlreadyShadowFilled
              ? `${cssColorMix(CSS_COLOR.green, 6)}`
              : `${cssColorMix(CSS_COLOR.cyan, 6)}`,
            borderRadius: dim(RADII.sm),
            padding: sp("7px 8px"),
            display: "grid",
            gap: sp(6),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: sp(8),
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  color: CSS_COLOR.text,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  fontWeight: FONT_WEIGHTS.regular,
                }}
              >
                Signal-options plan
              </div>
              <div
                style={{
                  color: automationAlreadyShadowFilled ? CSS_COLOR.green : CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("body"),
                  marginTop: sp(2),
                }}
              >
                {automationAlreadyShadowFilled
                  ? "Shadow already filled"
                  : liveDeviationFields.length
                    ? `${liveDeviationFields.length} deviation${liveDeviationFields.length === 1 ? "" : "s"}`
                    : "Matched"}
              </div>
            </div>
            <button
              type="button"
              onClick={restoreAutomationPlan}
              style={{
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                background: CSS_COLOR.bg0,
                color: CSS_COLOR.cyan,
                fontFamily: T.sans,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.regular,
                padding: sp("5px 7px"),
                cursor: "pointer",
              }}
            >
              RESTORE PLAN
            </button>
          </div>
          <div
            className="ra-hide-scrollbar"
            style={{
              display: "flex",
              flexWrap: "nowrap",
              overflowX: "auto",
              border: `1px solid ${CSS_COLOR.border}`,
              background: CSS_COLOR.bg0,
              borderRadius: dim(RADII.xs),
              minWidth: 0,
            }}
          >
            {comparisonRows.map((row, index) => (
              <div
                key={row.label}
                style={{
                  flex: "1 1 auto",
                  minWidth: dim(78),
                  padding: sp("5px 8px"),
                  borderLeft: index === 0 ? "none" : `1px solid ${CSS_COLOR.border}`,
                  background: row.changed ? `${cssColorMix(CSS_COLOR.amber, 6)}` : "transparent",
                }}
              >
                <div
                  style={{
                    color: row.changed ? CSS_COLOR.amber : CSS_COLOR.textMuted,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {row.label.toUpperCase()}
                </div>
                <AppTooltip content={`Plan: ${row.planned} / Current: ${row.current}`}><div
                  style={{
                    color: CSS_COLOR.text,
                    fontFamily: T.sans,
                    fontSize: textSize("body"),
                    marginTop: sp(2),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.planned} / {row.current}
                </div></AppTooltip>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {shadowAddExposureWarningActive ? (
        <div
          style={{
            border: `1px solid ${cssColorMix(CSS_COLOR.amber, 33)}`,
            background: `${cssColorMix(CSS_COLOR.amber, 7)}`,
            borderRadius: dim(RADII.sm),
            padding: sp("6px 8px"),
            display: "grid",
            gap: sp(3),
          }}
        >
          <div
            style={{
              color: CSS_COLOR.amber,
              fontFamily: T.sans,
              fontSize: fs(10),
              fontWeight: FONT_WEIGHTS.regular,
            }}
          >
            Shadow exposure exists
          </div>
          <div
            style={{
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("body"),
              lineHeight: 1.35,
            }}
          >
            {matchingShadowQuantity.toFixed(2)} contract(s) already open in
            Shadow
            {matchingShadowSources.length
              ? ` · ${matchingShadowSources.join(" / ")}`
              : ""}
            . Manual fills will add to this same option contract.
          </div>
        </div>
      ) : null}
      {renderExecutionModeControls()}
      <TicketReadinessStrip model={ticketReadinessModel} />
      {liveUsesSnapTrade ? (
        <div
          data-testid="snaptrade-recent-orders-status"
          style={{
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg0,
            borderRadius: dim(RADII.xs),
            padding: sp("5px 7px"),
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.35fr)",
            gap: sp(7),
            alignItems: "center",
            fontFamily: T.sans,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.regular,
              }}
            >
              RECENT ORDERS
            </div>
            <div
              style={{
                color: snapTradeRecentOrdersQuery.isError
                  ? CSS_COLOR.red
                  : snapTradeRecentOrdersQuery.isFetching
                    ? CSS_COLOR.amber
                    : latestSnapTradeOrder
                      ? CSS_COLOR.green
                      : CSS_COLOR.textDim,
                fontSize: fs(10),
                fontWeight: FONT_WEIGHTS.regular,
                marginTop: sp(1),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {latestSnapTradeOrderStatus}
            </div>
          </div>
          <div
            style={{
              minWidth: 0,
              color: CSS_COLOR.textSec,
              fontSize: textSize("body"),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "right",
            }}
          >
            {latestSnapTradeOrderDetail}
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(4) }}>
        <span
          style={{
            fontSize: fs(13),
            fontWeight: FONT_WEIGHTS.regular,
            fontFamily: T.sans,
            color: CSS_COLOR.text,
          }}
        >
          {slot.ticker}
        </span>
        {ticketIsOptions ? (
          <span
            style={{
              fontSize: fs(12),
              fontWeight: FONT_WEIGHTS.regular,
              fontFamily: T.sans,
              color: contractColor,
            }}
          >
            {slot.strike}
            {slot.cp}
          </span>
        ) : null}
        <span style={{ fontSize: textSize("caption"), color: CSS_COLOR.textDim, fontFamily: T.sans }}>
          {ticketInstrumentDetail}
        </span>
      </div>
      {ticketIsShares ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 6px"),
            background: CSS_COLOR.bg1,
            borderRadius: dim(RADII.xs),
            fontFamily: T.sans,
          }}
        >
          <div className={midFlashClass}>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
              }}
            >
              LAST
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.regular,
                color: CSS_COLOR.text,
                lineHeight: 1,
              }}
            >
              {equityQuoteReady ? equityPrice.toFixed(2) : MISSING_VALUE}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
              }}
            >
              CHG
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.regular,
                color:
                  Number(info?.chg) > 0
                    ? CSS_COLOR.green
                    : Number(info?.chg) < 0
                      ? CSS_COLOR.red
                      : CSS_COLOR.text,
                lineHeight: 1,
              }}
            >
              {Number.isFinite(Number(info?.chg))
                ? `${Number(info.chg) >= 0 ? "+" : "-"}${Math.abs(Number(info.chg)).toFixed(2)}`
                : MISSING_VALUE}
            </div>
            <div style={{ fontSize: textSize("caption"), color: CSS_COLOR.textDim }}>
              {Number.isFinite(Number(info?.pct))
                ? `${Number(info.pct) >= 0 ? "+" : ""}${Number(info.pct).toFixed(2)}%`
                : MISSING_VALUE}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
              }}
            >
              VOL
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.regular,
                color: CSS_COLOR.textSec,
                lineHeight: 1,
              }}
            >
              {fmtQuoteVolume(info?.volume)}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 6px"),
            background: CSS_COLOR.bg1,
            borderRadius: dim(RADII.xs),
            fontFamily: T.sans,
          }}
        >
          <div className={bidFlashClass}>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
              }}
            >
              BID
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.regular,
                color: CSS_COLOR.red,
                lineHeight: 1,
              }}
            >
              {bid.toFixed(2)}
            </div>
          </div>
          <div className={midFlashClass} style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
              }}
            >
              MID
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.regular,
                color: CSS_COLOR.text,
                lineHeight: 1,
              }}
            >
              {prem.toFixed(2)}
            </div>
            <div
              style={{
                fontSize: textSize("caption"),
                color: isFiniteNumber(spreadPct) && spreadPct > 3 ? CSS_COLOR.amber : CSS_COLOR.textDim,
              }}
            >
              {isFiniteNumber(spread) && isFiniteNumber(spreadPct)
                ? `${spread.toFixed(2)} (${spreadPct.toFixed(1)}%)`
                : MISSING_VALUE}
            </div>
          </div>
          <div className={askFlashClass} style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
              }}
            >
              ASK
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: FONT_WEIGHTS.regular,
                color: TRADE_BUY_TONE,
                lineHeight: 1,
              }}
            >
              {ask.toFixed(2)}
            </div>
          </div>
        </div>
      )}
      {/* Side + Order type */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(3) }}>
        <div style={{ display: "flex", gap: sp(2) }}>
          <button
            onClick={() => selectSide("BUY")}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: isLong ? TRADE_BUY_TONE : "transparent",
              border: `1px solid ${isLong ? TRADE_BUY_TONE : CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              color: isLong ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
              fontSize: fs(ticketIsOptions ? 8 : 10),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1.15,
              cursor: "pointer",
            }}
          >
            {ticketIsOptions ? "BUY TO OPEN" : "BUY"}
          </button>
          <button
            onClick={() => selectSide("SELL")}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: !isLong ? CSS_COLOR.red : "transparent",
              border: `1px solid ${!isLong ? CSS_COLOR.red : CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              color: !isLong ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
              fontSize: fs(ticketIsOptions ? 8 : 10),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1.15,
              cursor: "pointer",
            }}
          >
            {sellCallIntent.applies ? sellCallIntent.actionLabel : "SELL"}
          </button>
        </div>
        <SegmentedControl
          ariaLabel="Order type"
          options={TICKET_ORDER_TYPES.map((t) => ({ value: t, label: formatTicketOrderType(t) }))}
          value={orderType}
          onChange={setOrderType}
        />
      </div>
      {sellCallIntent.applies ? (
        <div
          style={{
            border: `1px solid ${cssColorAlpha(sellCallStatusColor, "55")}`,
            background: cssColorAlpha(sellCallStatusColor, "12"),
            borderRadius: dim(RADII.xs),
            padding: sp("6px 7px"),
            display: "grid",
            gap: sp(5),
            fontFamily: T.sans,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: sp(8),
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                color: sellCallStatusColor,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.regular,
              }}
            >
              {sellCallIntent.intentLabel}
            </span>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular }}>
              {sellCallIntent.coverage.underlying || slot.ticker}
            </span>
          </div>
          <div
            className="ra-hide-scrollbar"
            style={{
              display: "flex",
              flexWrap: "nowrap",
              overflowX: "auto",
              border: `1px solid ${CSS_COLOR.border}`,
              background: CSS_COLOR.bg0,
              borderRadius: dim(RADII.xs),
              minWidth: 0,
            }}
          >
            {sellCallCoverageRows.map(([label, value], index) => (
              <div
                key={label}
                style={{
                  flex: "1 1 auto",
                  minWidth: dim(70),
                  padding: sp("4px 8px"),
                  borderLeft: index === 0 ? "none" : `1px solid ${CSS_COLOR.border}`,
                }}
              >
                <div
                  style={{
                    color: CSS_COLOR.textMuted,
                    fontSize: fs(6),
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    color: CSS_COLOR.text,
                    fontSize: textSize("body"),
                    fontWeight: FONT_WEIGHTS.regular,
                    marginTop: sp(1),
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
          {!sellCallIntent.allowed ? (
            <div
              style={{
                color: sellCallStatusColor,
                fontSize: textSize("caption"),
                lineHeight: 1.35,
              }}
            >
              {sellCallIntent.blockedReason}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* QTY presets + input + LIMIT */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            orderType === "STP_LMT" ? "auto 1fr 1fr 1fr" : "auto 1fr 1fr",
          gap: sp(4),
          alignItems: "end",
        }}
      >
        <div style={{ display: "flex", gap: sp(2) }}>
          {qtyPresets.map((n) => (
            <button
              key={n}
              onClick={() => setQty(n)}
              style={{
                padding: sp("4px 7px"),
                background: qtyNum === n ? CSS_COLOR.accent : "transparent",
                border: `1px solid ${qtyNum === n ? CSS_COLOR.accent : CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                color: qtyNum === n ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.regular,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              marginBottom: sp(1),
            }}
          >
            {ticketIsShares ? "SHARES" : "CONTRACTS"}
          </div>
          <input
            type="number"
            min="1"
            aria-label={`${ticketQuantityUnit} quantity`}
            value={qty}
            onChange={(e) =>
              setQty(e.target.value === "" ? "" : Math.max(0, +e.target.value))
            }
            style={{
              width: "100%",
              background: CSS_COLOR.bg1,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              padding: sp("3px 6px"),
              color: CSS_COLOR.text,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
            }}
          />
        </div>
        {orderType === "STP_LMT" ? (
          <div>
            <div
              style={{
                fontSize: fs(6),
                color: CSS_COLOR.textMuted,
                letterSpacing: "0.04em",
                marginBottom: sp(1),
              }}
            >
              STOP
            </div>
            <input
              type="number"
              step="0.01"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              style={{
                width: "100%",
                background: CSS_COLOR.bg1,
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                padding: sp("3px 6px"),
                color: CSS_COLOR.text,
                fontSize: fs(11),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.regular,
              }}
            />
          </div>
        ) : null}
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              marginBottom: sp(1),
            }}
          >
            {parentPriceLabel}
          </div>
          <input
            type="number"
            step="0.01"
            aria-label={`${parentPriceLabel.toLowerCase()} price`}
            value={parentPriceValue}
            disabled={parentPriceDisabled}
            onChange={(e) =>
              orderType === "STP"
                ? setStopPrice(e.target.value)
                : setLimitPrice(e.target.value)
            }
            style={{
              width: "100%",
              background: parentPriceDisabled ? CSS_COLOR.bg2 : CSS_COLOR.bg3,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              padding: sp("3px 6px"),
              color: parentPriceDisabled ? CSS_COLOR.textDim : CSS_COLOR.text,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
            }}
          />
        </div>
      </div>
      {/* SL / TP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              marginBottom: sp(1),
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>STOP LOSS</span>
            <button
              type="button"
              aria-label="Toggle stop loss attached exit"
              data-testid="trade-ticket-stop-loss-toggle"
              disabled={attachedExitTogglesDisabled}
              onClick={() => setAttachStopLoss((value) => !value)}
              style={{
                border: `1px solid ${attachStopLoss ? CSS_COLOR.red : CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                background: attachStopLoss ? CSS_COLOR.red : "transparent",
                color: attachStopLoss ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.regular,
                padding: sp("1px 5px"),
                cursor: attachedExitTogglesDisabled ? "not-allowed" : "pointer",
                opacity: attachedExitTogglesDisabled ? 0.45 : 1,
              }}
            >
              {attachStopLoss ? "ON" : "OFF"}
            </button>
          </div>
          <input
            type="number"
            step="0.01"
            value={stopLoss}
            disabled={stopLossExitDisabled}
            onChange={(e) => setStopLoss(e.target.value)}
            style={{
              width: "100%",
              background: stopLossExitDisabled ? CSS_COLOR.bg2 : CSS_COLOR.bg3,
              border: `1px solid ${attachStopLoss ? `${cssColorMix(CSS_COLOR.red, 27)}` : CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              padding: sp("3px 6px"),
              color: stopLossExitDisabled ? CSS_COLOR.textDim : CSS_COLOR.red,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              opacity: stopLossExitDisabled ? 0.65 : 1,
            }}
          />
          <div
            style={{
              color: attachStopLoss ? CSS_COLOR.red : CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              marginTop: sp(2),
            }}
          >
            {attachStopLoss && isFiniteNumber(slPct)
              ? `${slPct >= 0 ? "+" : ""}${slPct.toFixed(0)}%`
              : "OFF"}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              marginBottom: sp(1),
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>TAKE PROFIT</span>
            <button
              type="button"
              aria-label="Toggle take profit attached exit"
              data-testid="trade-ticket-take-profit-toggle"
              disabled={attachedExitTogglesDisabled}
              onClick={() => setAttachTakeProfit((value) => !value)}
              style={{
                border: `1px solid ${attachTakeProfit ? CSS_COLOR.green : CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                background: attachTakeProfit ? CSS_COLOR.green : "transparent",
                color: attachTakeProfit ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.regular,
                padding: sp("1px 5px"),
                cursor: attachedExitTogglesDisabled ? "not-allowed" : "pointer",
                opacity: attachedExitTogglesDisabled ? 0.45 : 1,
              }}
            >
              {attachTakeProfit ? "ON" : "OFF"}
            </button>
          </div>
          <input
            type="number"
            step="0.01"
            value={takeProfit}
            disabled={takeProfitExitDisabled}
            onChange={(e) => setTakeProfit(e.target.value)}
            style={{
              width: "100%",
              background: takeProfitExitDisabled ? CSS_COLOR.bg2 : CSS_COLOR.bg3,
              border: `1px solid ${attachTakeProfit ? `${cssColorMix(CSS_COLOR.green, 27)}` : CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              padding: sp("3px 6px"),
              color: takeProfitExitDisabled ? CSS_COLOR.textDim : CSS_COLOR.green,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              opacity: takeProfitExitDisabled ? 0.65 : 1,
            }}
          />
          <div
            style={{
              color: attachTakeProfit ? CSS_COLOR.green : CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              marginTop: sp(2),
            }}
          >
            {attachTakeProfit && isFiniteNumber(tpPct)
              ? `${tpPct >= 0 ? "+" : ""}${tpPct.toFixed(0)}%`
              : "OFF"}
          </div>
        </div>
      </div>
      {/* TIF */}
      <SegmentedControl
        ariaLabel="Time in force"
        options={["DAY", "GTC", "IOC", "FOK"]}
        value={tif}
        onChange={setTif}
      />
      {ticketIsOptions ? (
        <>
          <PayoffDiagram
            optType={slot.cp}
            strike={slot.strike}
            premium={fillPrice}
            qty={qtyNum || 1}
            currentPrice={info.price}
            side={side}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: sp("2px 4px"),
              fontSize: textSize("body"),
              fontFamily: T.sans,
            }}
          >
            <span style={{ color: CSS_COLOR.textMuted }}>
              BE{" "}
              <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>
                {breakeven.toFixed(2)}
              </span>{" "}
              <span style={{ color: CSS_COLOR.textDim }}>
                {beMovePct == null
                  ? `(${MISSING_VALUE})`
                  : `(${beMovePct >= 0 ? "+" : ""}${beMovePct.toFixed(1)}%)`}
              </span>
            </span>
            <span style={{ color: CSS_COLOR.textMuted }}>
              {isLong ? "Risk" : "Credit"}{" "}
              <span style={{ color: isLong ? CSS_COLOR.red : CSS_COLOR.green, fontWeight: FONT_WEIGHTS.regular }}>
                ${cost.toFixed(0)}
              </span>
            </span>
            <span style={{ color: CSS_COLOR.textMuted }}>
              POP{" "}
              <span
                style={{
                  color: !isFiniteNumber(pop)
                    ? CSS_COLOR.textDim
                    : pop >= 50
                      ? CSS_COLOR.green
                      : pop >= 30
                        ? CSS_COLOR.amber
                        : CSS_COLOR.red,
                  fontWeight: FONT_WEIGHTS.regular,
                }}
              >
                {isFiniteNumber(pop) ? `${pop.toFixed(0)}%` : MISSING_VALUE}
              </span>
            </span>
          </div>
        </>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: sp(4),
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg0,
            borderRadius: dim(RADII.xs),
            padding: sp("6px 7px"),
            fontFamily: T.sans,
          }}
        >
          {[
            ["NOTIONAL", costDisplay, CSS_COLOR.text],
            [
              "STOP",
              attachStopLoss ? formatTicketMoney(stopLoss) : "OFF",
              attachStopLoss ? CSS_COLOR.red : CSS_COLOR.textDim,
            ],
            [
              "TARGET",
              attachTakeProfit ? formatTicketMoney(takeProfit) : "OFF",
              attachTakeProfit ? CSS_COLOR.green : CSS_COLOR.textDim,
            ],
          ].map(([label, value, color]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div
                style={{
                  color: CSS_COLOR.textMuted,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.regular,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  color,
                  fontSize: fs(10),
                  fontWeight: FONT_WEIGHTS.regular,
                  marginTop: sp(2),
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
      )}
      {previewSnapshot && (
        <div
          style={{
            background: CSS_COLOR.bg1,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            padding: sp("6px 8px"),
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(4),
            fontSize: textSize("body"),
            fontFamily: T.sans,
          }}
        >
          <div>
            <span style={{ color: CSS_COLOR.textMuted }}>PREVIEW</span>{" "}
            <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>
              {previewSnapshot.accountId}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textMuted }}>CONID</span>{" "}
            <span style={{ color: CSS_COLOR.accent, fontWeight: FONT_WEIGHTS.regular }}>
              {previewSnapshot.resolvedContractId}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textMuted }}>TYPE</span>{" "}
            <span style={{ color: CSS_COLOR.text }}>
              {formatEnumLabel(
                previewDisplayOrder?.orderType ||
                  previewDisplayOrder?.type ||
                  orderTypeLabel,
              )}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textMuted }}>TIF</span>{" "}
            <span style={{ color: CSS_COLOR.text }}>
              {String(previewDisplayOrder?.tif || previewDisplayOrder?.timeInForce || tif).toUpperCase()}
            </span>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: CSS_COLOR.textMuted }}>PAYLOAD</span>{" "}
            <span style={{ color: CSS_COLOR.textSec }}>
              {String(previewDisplayOrder?.side || previewDisplayOrder?.action || side).toUpperCase()}{" "}
              {previewDisplayOrder?.quantity ?? previewDisplayOrder?.totalQuantity ?? qtyNum} {previewSnapshot.symbol}
              {Number.isFinite(Number(previewDisplayPrice))
                ? ` @ ${Number(previewDisplayPrice).toFixed(2)}`
                : ""}
            </span>
          </div>
          {hasAttachedExits ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: CSS_COLOR.textMuted }}>EXITS</span>{" "}
              <span style={{ color: previewIsTwsStructured ? CSS_COLOR.green : CSS_COLOR.amber }}>
                {previewIsTwsStructured
                  ? attachedExitPreviewLabel || "none"
                  : "structured TWS preview required"}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: sp(4),
          marginTop: "auto",
        }}
      >
        <button
          onClick={previewOrder}
          disabled={previewDisabled}
          style={{
            padding: sp("7px 0"),
            background: CSS_COLOR.bg1,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.textSec,
            fontSize: fs(10),
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
            cursor: previewIsPending
              ? "wait"
              : previewDisabled
                ? "not-allowed"
                : "pointer",
            letterSpacing: "0.04em",
            opacity: previewDisabled ? 0.7 : 1,
          }}
        >
          {previewIsPending
            ? "PREVIEWING..."
            : executionIsShadow
              ? "PREVIEW SHADOW"
              : liveUsesSnapTrade
                ? "PREVIEW SNAPTRADE"
              : "PREVIEW IBKR"}
        </button>
        <button
          onClick={executionIsShadow ? submitShadowOrder : submitOrder}
          disabled={primarySubmitDisabled}
	          style={{
            padding: sp("7px 0"),
            background: primarySubmitDisabled ? CSS_COLOR.bg3 : primarySubmitColor,
            border: "none",
            borderRadius: dim(RADII.xs),
            color: primarySubmitDisabled ? CSS_COLOR.textDim : CSS_COLOR.onAccent,
            fontSize: fs(ticketIsOptions ? 9 : 11),
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
            lineHeight: 1.15,
            minHeight: 34,
            overflowWrap: "anywhere",
	            cursor: primarySubmitPending ? "wait" : primarySubmitDisabled ? "not-allowed" : "pointer",
	            letterSpacing: "0.04em",
	            opacity: primarySubmitPending || primarySubmitDisabled ? 0.7 : 1,
	          }}
	        >
	          {primarySubmitLabel}
	        </button>
      </div>
      </div>
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm broker order"}
        detail={
          liveConfirmState?.detail ||
          "Submit this Interactive Brokers order."
        }
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM IBKR ORDER"}
        confirmTone={liveConfirmState?.confirmTone || CSS_COLOR.red}
        pending={liveConfirmPending}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </>
  );
};
