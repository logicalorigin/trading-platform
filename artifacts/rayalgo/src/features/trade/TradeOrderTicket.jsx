import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  usePlaceOrder,
  usePreviewOrder,
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
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";

import { PayoffDiagram } from "./PayoffDiagram.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

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
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  gatewayTradingBlockReason = "gateway",
  automationContext = null,
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
  const contractColor = slot.cp === "C" ? T.green : T.red;
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
        "/api/accounts/shadow/positions?mode=paper&assetClass=Options",
      ),
    enabled: Boolean(ticketIsOptions && selectedContractMeta && expInfo.actualDate),
    staleTime: 15_000,
    refetchInterval: false,
  });
  const liveOrderPayloadReady = ticketIsShares
    ? Boolean(accountId && slot.ticker)
    : Boolean(accountId && selectedContractMeta && expInfo.actualDate);
  const gatewayTradingBlocked = !gatewayTradingReady;
  const gatewayTradingBlockedLabel =
    gatewayTradingBlockReason === "streams_stale"
      ? "STREAMS STALE"
      : "GATEWAY REQUIRED";
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
  const selectedExecutionLabel = executionIsShadow
    ? "SHADOW PAPER"
    : brokerConfigured
      ? gatewayTradingReady
        ? `IBKR ${environment.toUpperCase()}`
        : gatewayTradingBlockReason === "streams_stale"
          ? "IBKR STREAMS STALE"
          : "IBKR GATEWAY REQUIRED"
      : "IBKR REQUIRED";
  const selectedExecutionAccount = executionIsShadow
    ? "shadow"
    : brokerConfigured
      ? accountId || MISSING_VALUE
      : MISSING_VALUE;
  const selectedExecutionColor = executionIsShadow
    ? T.pink
    : brokerConfigured
      ? gatewayTradingReady
        ? T.green
        : T.amber
      : T.textDim;
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
  const renderTicketAssetModeControls = () => (
    <div
      data-testid="trade-ticket-asset-mode"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${TICKET_ASSET_MODES.length}, minmax(0, 1fr))`,
        gap: sp(3),
      }}
    >
      {TICKET_ASSET_MODES.map((mode) => {
        const active = normalizedTicketAssetMode === mode;
        const color = mode === "equity" ? T.cyan : T.accent;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setTicketAssetMode(mode)}
            data-testid={`trade-ticket-asset-mode-${mode}`}
            style={{
              border: `1px solid ${active ? `${color}66` : T.border}`,
              background: active ? `${color}18` : T.bg1,
              color: active ? color : T.textDim,
              borderRadius: dim(3),
              padding: sp("6px 0"),
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {mode === "equity" ? "SHARES" : "OPTIONS"}
          </button>
        );
      })}
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
            fontSize: fs(8),
            color: selectedExecutionColor,
            fontFamily: T.sans,
            fontWeight: 400,
          }}
        >
          {selectedExecutionLabel}
        </span>
        <span style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.sans }}>
          {selectedExecutionAccount}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${TRADING_EXECUTION_MODES.length}, minmax(0, 1fr))`,
          gap: sp(3),
        }}
      >
        {TRADING_EXECUTION_MODES.map((mode) => {
          const active = executionMode === mode;
          const color = mode === "shadow" ? T.pink : T.green;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setExecutionMode(mode)}
              style={{
                border: `1px solid ${active ? `${color}66` : T.border}`,
                background: active ? `${color}18` : T.bg1,
                color: active ? color : T.textDim,
                borderRadius: dim(3),
                padding: sp("5px 0"),
                fontFamily: T.sans,
                fontSize: fs(8),
                fontWeight: 400,
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              {mode === "shadow" ? "SHADOW" : "REAL"}
            </button>
          );
        })}
      </div>
      {!gatewayTradingReady && (
        <div
          style={{
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            fontSize: fs(8),
            color: T.amber,
            fontFamily: T.sans,
            lineHeight: 1.35,
          }}
        >
          {gatewayTradingMessage}
        </div>
      )}
    </>
  );
  const ticketTypeOptions = [
    ["LMT", "LMT"],
    ["MKT", "MKT"],
    ["STP", "STP"],
    ["STP_LMT", "STP LMT"],
  ];
  const renderLockedTicketControls = () => (
    <div
      style={{
        display: "grid",
        gap: sp(6),
        border: `1px solid ${T.border}`,
        background: T.bg0,
        borderRadius: dim(5),
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
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(11),
            fontWeight: 400,
          }}
        >
          {ticketInstrumentLabel}
        </span>
        <span style={{ color: T.textDim, fontFamily: T.sans, fontSize: fs(8) }}>
          {ticketInstrumentDetail}
        </span>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}
      >
        {["BUY", "SELL"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => selectSide(value)}
            style={{
              border: `1px solid ${
                side === value
                  ? value === "BUY"
                    ? T.green
                    : T.red
                  : T.border
              }`,
              background:
                side === value
                  ? `${value === "BUY" ? T.green : T.red}18`
                  : T.bg1,
              color:
                side === value
                  ? value === "BUY"
                    ? T.green
                    : T.red
                  : T.textDim,
              borderRadius: dim(3),
              padding: sp("6px 0"),
              fontFamily: T.sans,
              fontSize: fs(9),
              fontWeight: 400,
              cursor: "pointer",
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: sp(4),
        }}
      >
        {ticketTypeOptions.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrderType(value)}
            style={{
              border: `1px solid ${orderType === value ? T.accent : T.border}`,
              background: orderType === value ? T.accentDim : T.bg1,
              color: orderType === value ? T.accent : T.textDim,
              borderRadius: dim(3),
              padding: sp("5px 0"),
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
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
            gap: sp(3),
            color: T.textMuted,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: 400,
          }}
        >
          {ticketIsShares ? "SHARES" : "CONTRACTS"}
          <input
            type="number"
            min="1"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color: T.text,
              fontFamily: T.sans,
              fontSize: fs(10),
              padding: sp("5px 6px"),
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: sp(3),
            color: T.textMuted,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: 400,
          }}
        >
          LIMIT
          <input
            type="number"
            step="0.01"
            disabled={orderType === "MKT" || orderType === "STP"}
            value={limitPrice}
            onChange={(event) => setLimitPrice(event.target.value)}
            style={{
              width: "100%",
              background:
                orderType === "MKT" || orderType === "STP" ? T.bg1 : T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color:
                orderType === "MKT" || orderType === "STP" ? T.textDim : T.text,
              fontFamily: T.sans,
              fontSize: fs(10),
              padding: sp("5px 6px"),
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: sp(3),
            color: T.textMuted,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: 400,
          }}
        >
          STOP
          <input
            type="number"
            step="0.01"
            disabled={orderType !== "STP" && orderType !== "STP_LMT"}
            value={stopPrice}
            onChange={(event) => setStopPrice(event.target.value)}
            style={{
              width: "100%",
              background:
                orderType === "STP" || orderType === "STP_LMT" ? T.bg3 : T.bg1,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color:
                orderType === "STP" || orderType === "STP_LMT"
                  ? T.text
                  : T.textDim,
              fontFamily: T.sans,
              fontSize: fs(10),
              padding: sp("5px 6px"),
            }}
          />
        </label>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: sp(4),
        }}
      >
        {["DAY", "GTC", "IOC", "FOK"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTif(value)}
            style={{
              border: `1px solid ${tif === value ? T.accent : T.border}`,
              background: tif === value ? T.accentDim : T.bg1,
              color: tif === value ? T.accent : T.textDim,
              borderRadius: dim(3),
              padding: sp("4px 0"),
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
              cursor: "pointer",
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4) }}
      >
        <button
          type="button"
          disabled
          style={{
            border: `1px solid ${T.border}`,
            background: T.bg2,
            color: T.textDim,
            borderRadius: dim(4),
            padding: sp("7px 0"),
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: 400,
          }}
        >
          PREVIEW LOCKED
        </button>
        <button
          type="button"
          disabled
          style={{
            border: "none",
            background: T.bg3,
            color: T.textDim,
            borderRadius: dim(4),
            padding: sp("7px 0"),
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: 400,
          }}
        >
          QUOTE REQUIRED
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
    if (executionMode === "shadow") {
      setAttachStopLoss(false);
      setAttachTakeProfit(false);
    }
  }, [executionMode]);

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
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(4),
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 400,
            color: T.textSec,
            fontFamily: T.sans,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          ORDER TICKET
        </div>
        {renderTicketAssetModeControls()}
        {renderExecutionModeControls()}
        {renderLockedTicketControls()}
        <DataUnavailableState
          title="No live contract quote"
          detail="Preview and submit unlock once the selected option contract has a live chain row with bid, ask, greeks, and contract metadata. Shares trading remains available from the SHARES toggle."
        />
      </div>
    );
  }

  const isLong = side === "BUY";
  const qtyNum = Number(qty) || 0;
  const orderPrices = resolveTicketOrderPrices({
    orderType,
    limitPrice,
    stopPrice,
    fallbackPrice: ticketEntryReferencePrice,
  });
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
        position.assetClass === "Options" &&
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
  const orderRequest = liveOrderPayloadReady
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
        mode: "paper",
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
    !executionIsShadow && (attachStopLoss || attachTakeProfit);
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
  const stopLossExitDisabled = executionIsShadow || !attachStopLoss;
  const takeProfitExitDisabled = executionIsShadow || !attachTakeProfit;
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
  const previewPayload =
    previewSnapshot?.orderPayload &&
    typeof previewSnapshot.orderPayload === "object"
      ? previewSnapshot.orderPayload
      : null;
  const previewOrderPayload = previewPayload;

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

  const previewOrder = () => {
    if (!validateTicket()) {
      return;
    }

    if (executionMode === "shadow") {
      if (gatewayTradingBlocked) {
        toast.push({
          kind: "warn",
          title: "IB Gateway disconnected",
          body: gatewayTradingMessage,
        });
        return;
      }

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

    if (!brokerConfigured) {
      toast.push({
        kind: "info",
        title: "IBKR required",
        body: "Local preview simulation has been removed. Connect the IBKR bridge to preview a live order.",
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
          body: "The current IBKR bridge did not return a structured TWS order payload for attached exit submission.",
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

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR required",
        body: "Local order fills are disabled. Connect the IBKR bridge to submit this order.",
      });
      return;
    }

    if (gatewayTradingBlocked) {
      toast.push({
        kind: "warn",
        title: "IB Gateway disconnected",
        body: gatewayTradingMessage,
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
      confirmTone: isLong ? T.green : T.red,
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
                valueColor: T.red,
              },
            ]
          : []),
        ...(attachTakeProfit
          ? [
              {
                label: "TAKE PROFIT",
                value: formatTicketPrice(takeProfit),
                valueColor: T.green,
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
          valueColor: isLong ? T.red : T.green,
        },
      ],
      onConfirm: submitLiveBrokerOrder,
    });
  };

  const submitShadowOrder = () => {
    if (!validateTicket()) {
      return;
    }
    if (gatewayTradingBlocked) {
      toast.push({
        kind: "warn",
        title: "IB Gateway disconnected",
        body: gatewayTradingMessage,
      });
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
  const isSubmittingOrder =
    placeOrderMutation.isPending || submitOrdersMutation.isPending;
  const previewIsPending =
    previewOrderMutation.isPending || previewShadowOrderMutation.isPending;
  const primarySubmitPending = executionIsShadow
    ? placeShadowOrderMutation.isPending
    : isSubmittingOrder;
  const sellCallSubmitBlocked = sellCallIntent.applies && !sellCallIntent.allowed;
  const primarySubmitDisabled = executionIsShadow
    ? placeShadowOrderMutation.isPending ||
      automationAlreadyShadowFilled ||
      gatewayTradingBlocked ||
      sellCallSubmitBlocked
    : isSubmittingOrder || gatewayTradingBlocked || sellCallSubmitBlocked;
  const previewDisabled =
    previewIsPending ||
    sellCallSubmitBlocked ||
    (executionIsShadow && gatewayTradingBlocked);
  const primarySubmitColor = executionIsShadow ? T.pink : isLong ? T.green : T.red;
  const primarySubmitLabel = executionIsShadow
    ? gatewayTradingBlocked
      ? gatewayTradingBlockedLabel
      : placeShadowOrderMutation.isPending
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
    : gatewayTradingBlocked
      ? gatewayTradingBlockedLabel
      : isSubmittingOrder
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
    ? T.textDim
    : sellCallIntent.allowed
      ? sellCallIntent.strategyIntent === "covered_call"
        ? T.cyan
        : T.green
      : sellCallIntent.contextPending
        ? T.amber
        : T.red;
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
          "CAPACITY",
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
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(4),
          minWidth: 0,
        }}
      >
      <div
        style={{
          fontSize: fs(9),
          fontWeight: 400,
          color: T.textSec,
          fontFamily: T.sans,
          letterSpacing: "0.08em",
          borderBottom: `1px solid ${T.border}`,
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
              automationAlreadyShadowFilled ? `${T.green}45` : `${T.cyan}35`
            }`,
            background: automationAlreadyShadowFilled
              ? `${T.green}10`
              : `${T.cyan}10`,
            borderRadius: dim(5),
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
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: fs(10),
                  fontWeight: 400,
                }}
              >
                Signal-options plan
              </div>
              <div
                style={{
                  color: automationAlreadyShadowFilled ? T.green : T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(8),
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
                border: `1px solid ${T.border}`,
                borderRadius: dim(4),
                background: T.bg0,
                color: T.cyan,
                fontFamily: T.sans,
                fontSize: fs(8),
                fontWeight: 400,
                padding: sp("5px 7px"),
                cursor: "pointer",
              }}
            >
              RESTORE PLAN
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: sp(5),
            }}
          >
            {comparisonRows.map((row) => (
              <div
                key={row.label}
                style={{
                  border: `1px solid ${row.changed ? `${T.amber}55` : T.border}`,
                  background: row.changed ? `${T.amber}10` : T.bg0,
                  borderRadius: dim(4),
                  padding: sp("5px 6px"),
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: row.changed ? T.amber : T.textMuted,
                    fontFamily: T.sans,
                    fontSize: fs(7),
                    fontWeight: 400,
                  }}
                >
                  {row.label.toUpperCase()}
                </div>
                <AppTooltip content={`Plan: ${row.planned} / Current: ${row.current}`}><div
                  style={{
                    color: T.text,
                    fontFamily: T.sans,
                    fontSize: fs(8),
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
            border: `1px solid ${T.amber}55`,
            background: `${T.amber}12`,
            borderRadius: dim(5),
            padding: sp("6px 8px"),
            display: "grid",
            gap: sp(3),
          }}
        >
          <div
            style={{
              color: T.amber,
              fontFamily: T.sans,
              fontSize: fs(10),
              fontWeight: 400,
            }}
          >
            Shadow exposure exists
          </div>
          <div
            style={{
              color: T.textSec,
              fontFamily: T.sans,
              fontSize: fs(8),
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
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(4) }}>
        <span
          style={{
            fontSize: fs(13),
            fontWeight: 400,
            fontFamily: T.sans,
            color: T.text,
          }}
        >
          {slot.ticker}
        </span>
        {ticketIsOptions ? (
          <span
            style={{
              fontSize: fs(12),
              fontWeight: 400,
              fontFamily: T.sans,
              color: contractColor,
            }}
          >
            {slot.strike}
            {slot.cp}
          </span>
        ) : null}
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.sans }}>
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
            background: T.bg3,
            borderRadius: dim(3),
            fontFamily: T.sans,
          }}
        >
          <div className={midFlashClass}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              LAST
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                color: T.text,
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
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              CHG
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                color:
                  Number(info?.chg) > 0
                    ? T.green
                    : Number(info?.chg) < 0
                      ? T.red
                      : T.text,
                lineHeight: 1,
              }}
            >
              {Number.isFinite(Number(info?.chg))
                ? `${Number(info.chg) >= 0 ? "+" : "-"}${Math.abs(Number(info.chg)).toFixed(2)}`
                : MISSING_VALUE}
            </div>
            <div style={{ fontSize: fs(7), color: T.textDim }}>
              {Number.isFinite(Number(info?.pct))
                ? `${Number(info.pct) >= 0 ? "+" : ""}${Number(info.pct).toFixed(2)}%`
                : MISSING_VALUE}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              VOL
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                color: T.textSec,
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
            background: T.bg3,
            borderRadius: dim(3),
            fontFamily: T.sans,
          }}
        >
          <div className={bidFlashClass}>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BID
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                color: T.red,
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
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              MID
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                color: T.text,
                lineHeight: 1,
              }}
            >
              {prem.toFixed(2)}
            </div>
            <div
              style={{
                fontSize: fs(7),
                color: isFiniteNumber(spreadPct) && spreadPct > 3 ? T.amber : T.textDim,
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
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              ASK
            </div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 400,
                color: T.green,
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
              background: isLong ? `${T.green}20` : "transparent",
              border: `1px solid ${isLong ? T.green + "60" : T.border}`,
              borderRadius: dim(3),
              color: isLong ? T.green : T.textDim,
              fontSize: fs(ticketIsOptions ? 8 : 10),
              fontFamily: T.sans,
              fontWeight: 400,
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
              background: !isLong ? `${T.red}20` : "transparent",
              border: `1px solid ${!isLong ? T.red + "60" : T.border}`,
              borderRadius: dim(3),
              color: !isLong ? T.red : T.textDim,
              fontSize: fs(ticketIsOptions ? 8 : 10),
              fontFamily: T.sans,
              fontWeight: 400,
              lineHeight: 1.15,
              cursor: "pointer",
            }}
          >
            {sellCallIntent.applies ? sellCallIntent.actionLabel : "SELL"}
          </button>
        </div>
        <div style={{ display: "flex", gap: sp(2) }}>
          {TICKET_ORDER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{
                flex: 1,
                padding: sp("4px 0"),
                background: orderType === t ? T.accentDim : "transparent",
                border: `1px solid ${orderType === t ? T.accent : T.border}`,
                borderRadius: dim(3),
                color: orderType === t ? T.accent : T.textDim,
                fontSize: fs(t === "STP_LMT" ? 7 : 9),
                fontFamily: T.sans,
                fontWeight: 400,
                cursor: "pointer",
              }}
            >
              {formatTicketOrderType(t)}
            </button>
          ))}
        </div>
      </div>
      {sellCallIntent.applies ? (
        <div
          style={{
            border: `1px solid ${sellCallStatusColor}55`,
            background: `${sellCallStatusColor}12`,
            borderRadius: dim(4),
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
                fontSize: fs(8),
                fontWeight: 400,
              }}
            >
              {sellCallIntent.intentLabel}
            </span>
            <span style={{ color: T.textDim, fontSize: fs(7), fontWeight: 400 }}>
              {sellCallIntent.coverage.underlying || slot.ticker}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: sp(4),
            }}
          >
            {sellCallCoverageRows.map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: T.textMuted,
                    fontSize: fs(6),
                    fontWeight: 400,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    color: T.text,
                    fontSize: fs(8),
                    fontWeight: 400,
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
                fontSize: fs(7),
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
                background: qtyNum === n ? T.accentDim : "transparent",
                border: `1px solid ${qtyNum === n ? T.accent : T.border}`,
                borderRadius: dim(3),
                color: qtyNum === n ? T.accent : T.textDim,
                fontSize: fs(9),
                fontFamily: T.sans,
                fontWeight: 400,
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
              color: T.textMuted,
              letterSpacing: "0.08em",
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
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: T.text,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 400,
            }}
          />
        </div>
        {orderType === "STP_LMT" ? (
          <div>
            <div
              style={{
                fontSize: fs(6),
                color: T.textMuted,
                letterSpacing: "0.08em",
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
                background: T.bg3,
                border: `1px solid ${T.border}`,
                borderRadius: dim(3),
                padding: sp("3px 6px"),
                color: T.text,
                fontSize: fs(11),
                fontFamily: T.sans,
                fontWeight: 400,
              }}
            />
          </div>
        ) : null}
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
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
              background: parentPriceDisabled ? T.bg2 : T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: parentPriceDisabled ? T.textDim : T.text,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 400,
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
              color: T.textMuted,
              letterSpacing: "0.08em",
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
              disabled={executionIsShadow}
              onClick={() => setAttachStopLoss((value) => !value)}
              style={{
                border: `1px solid ${attachStopLoss ? `${T.red}55` : T.border}`,
                borderRadius: dim(3),
                background: attachStopLoss ? `${T.red}16` : "transparent",
                color: attachStopLoss ? T.red : T.textDim,
                fontFamily: T.sans,
                fontSize: fs(7),
                fontWeight: 400,
                padding: sp("1px 5px"),
                cursor: executionIsShadow ? "not-allowed" : "pointer",
                opacity: executionIsShadow ? 0.45 : 1,
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
              background: stopLossExitDisabled ? T.bg2 : T.bg3,
              border: `1px solid ${attachStopLoss ? `${T.red}45` : T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: stopLossExitDisabled ? T.textDim : T.red,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 400,
              opacity: stopLossExitDisabled ? 0.65 : 1,
            }}
          />
          <div
            style={{
              color: attachStopLoss ? T.red : T.textDim,
              fontFamily: T.sans,
              fontSize: fs(7),
              fontWeight: 400,
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
              color: T.textMuted,
              letterSpacing: "0.08em",
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
              disabled={executionIsShadow}
              onClick={() => setAttachTakeProfit((value) => !value)}
              style={{
                border: `1px solid ${attachTakeProfit ? `${T.green}55` : T.border}`,
                borderRadius: dim(3),
                background: attachTakeProfit ? `${T.green}16` : "transparent",
                color: attachTakeProfit ? T.green : T.textDim,
                fontFamily: T.sans,
                fontSize: fs(7),
                fontWeight: 400,
                padding: sp("1px 5px"),
                cursor: executionIsShadow ? "not-allowed" : "pointer",
                opacity: executionIsShadow ? 0.45 : 1,
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
              background: takeProfitExitDisabled ? T.bg2 : T.bg3,
              border: `1px solid ${attachTakeProfit ? `${T.green}45` : T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: takeProfitExitDisabled ? T.textDim : T.green,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 400,
              opacity: takeProfitExitDisabled ? 0.65 : 1,
            }}
          />
          <div
            style={{
              color: attachTakeProfit ? T.green : T.textDim,
              fontFamily: T.sans,
              fontSize: fs(7),
              fontWeight: 400,
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
      <div style={{ display: "flex", gap: sp(2) }}>
        {["DAY", "GTC", "IOC", "FOK"].map((t) => (
          <button
            key={t}
            onClick={() => setTif(t)}
            style={{
              flex: 1,
              padding: sp("3px 0"),
              background: tif === t ? T.accentDim : "transparent",
              border: `1px solid ${tif === t ? T.accent : T.border}`,
              borderRadius: dim(2),
              color: tif === t ? T.accent : T.textDim,
              fontSize: fs(8),
              fontFamily: T.sans,
              fontWeight: 400,
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>
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
              fontSize: fs(8),
              fontFamily: T.sans,
            }}
          >
            <span style={{ color: T.textMuted }}>
              BE{" "}
              <span style={{ color: T.text, fontWeight: 400 }}>
                {breakeven.toFixed(2)}
              </span>{" "}
              <span style={{ color: T.textDim }}>
                {beMovePct == null
                  ? `(${MISSING_VALUE})`
                  : `(${beMovePct >= 0 ? "+" : ""}${beMovePct.toFixed(1)}%)`}
              </span>
            </span>
            <span style={{ color: T.textMuted }}>
              {isLong ? "Risk" : "Credit"}{" "}
              <span style={{ color: isLong ? T.red : T.green, fontWeight: 400 }}>
                ${cost.toFixed(0)}
              </span>
            </span>
            <span style={{ color: T.textMuted }}>
              POP{" "}
              <span
                style={{
                  color: !isFiniteNumber(pop)
                    ? T.textDim
                    : pop >= 50
                      ? T.green
                      : pop >= 30
                        ? T.amber
                        : T.red,
                  fontWeight: 400,
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
            border: `1px solid ${T.border}`,
            background: T.bg0,
            borderRadius: dim(4),
            padding: sp("6px 7px"),
            fontFamily: T.sans,
          }}
        >
          {[
            ["NOTIONAL", costDisplay, T.text],
            [
              "STOP",
              attachStopLoss ? formatTicketMoney(stopLoss) : "OFF",
              attachStopLoss ? T.red : T.textDim,
            ],
            [
              "TARGET",
              attachTakeProfit ? formatTicketMoney(takeProfit) : "OFF",
              attachTakeProfit ? T.green : T.textDim,
            ],
          ].map(([label, value, color]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div
                style={{
                  color: T.textMuted,
                  fontSize: fs(7),
                  fontWeight: 400,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  color,
                  fontSize: fs(10),
                  fontWeight: 400,
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
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(4),
            fontSize: fs(8),
            fontFamily: T.sans,
          }}
        >
          <div>
            <span style={{ color: T.textMuted }}>PREVIEW</span>{" "}
            <span style={{ color: T.text, fontWeight: 400 }}>
              {previewSnapshot.accountId}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>CONID</span>{" "}
            <span style={{ color: T.accent, fontWeight: 400 }}>
              {previewSnapshot.resolvedContractId}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>TYPE</span>{" "}
            <span style={{ color: T.text }}>
              {formatEnumLabel(
                previewDisplayOrder?.orderType ||
                  previewDisplayOrder?.type ||
                  orderTypeLabel,
              )}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>TIF</span>{" "}
            <span style={{ color: T.text }}>
              {String(previewDisplayOrder?.tif || previewDisplayOrder?.timeInForce || tif).toUpperCase()}
            </span>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: T.textMuted }}>PAYLOAD</span>{" "}
            <span style={{ color: T.textSec }}>
              {String(previewDisplayOrder?.side || previewDisplayOrder?.action || side).toUpperCase()}{" "}
              {previewDisplayOrder?.quantity ?? previewDisplayOrder?.totalQuantity ?? qtyNum} {previewSnapshot.symbol}
              {Number.isFinite(Number(previewDisplayPrice))
                ? ` @ ${Number(previewDisplayPrice).toFixed(2)}`
                : ""}
            </span>
          </div>
          {hasAttachedExits ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: T.textMuted }}>EXITS</span>{" "}
              <span style={{ color: previewIsTwsStructured ? T.green : T.amber }}>
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
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            color: T.textSec,
            fontSize: fs(10),
            fontFamily: T.sans,
            fontWeight: 400,
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
            : brokerConfigured
              ? "PREVIEW IBKR"
              : "PREVIEW IBKR"}
        </button>
        <button
          onClick={executionIsShadow ? submitShadowOrder : submitOrder}
          disabled={primarySubmitDisabled}
	          style={{
            padding: sp("7px 0"),
            background: primarySubmitDisabled ? T.bg3 : primarySubmitColor,
            border: "none",
            borderRadius: dim(4),
            color: primarySubmitDisabled ? T.textDim : T.onAccent,
            fontSize: fs(ticketIsOptions ? 9 : 11),
            fontFamily: T.sans,
            fontWeight: 400,
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
        confirmTone={liveConfirmState?.confirmTone || T.red}
        pending={liveConfirmPending}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </>
  );
};
