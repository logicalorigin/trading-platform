import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetSnapTradeAccountPortfolioQueryKey,
  getGetSnapTradeRecentOrdersQueryKey,
  useCancelOrder,
  useCheckSnapTradeEquityOrderImpact,
  useContinueIbkrOrderReply,
  useCreateTaxOrderPreflight,
  useGetIbkrPortalReadiness,
  useGetSchwabReadiness,
  useListOrders,
  usePlaceOrder,
  usePreviewOrder,
  usePreviewOrderReplacement,
  useReplaceOrder,
  useGetSnapTradeRecentOrders,
  useSearchSnapTradeAccountSymbols,
  useSubmitSnapTradeEquityOrder,
  useSubmitOrders,
  useSyncRobinhoodConnections,
  useSyncSchwabConnections,
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
import { useAuthSession } from "../auth/authSession.jsx";
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
import {
  OPTION_ORDER_ACTIONS,
  resolveOptionActionAvailability,
  resolveOptionOrderIntent,
} from "./optionOrderIntentModel.js";
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
  buildRobinhoodEquityOrderDraft,
  placeRobinhoodEquityOrderRequest,
  reviewRobinhoodEquityOrderRequest,
} from "./robinhoodEquityOrderRequests.js";
import {
  buildSchwabEquityOrderDraft,
  previewSchwabEquityOrderRequest,
  submitSchwabEquityOrderRequest,
} from "./schwabEquityOrderRequests.js";
import {
  buildBrokerOptionOrderDraft,
  placeBrokerOptionOrderRequest,
  readBrokerSubmitReconciliation,
  reviewBrokerOptionOrderRequest,
} from "./brokerOptionOrderRequests.js";
import {
  buildManualIbkrSingleLegOrderRequest,
  buildPreparedIbkrOrderSubmission,
  buildPreparedIbkrReplacementPreview,
  buildPreparedIbkrReplacementSubmission,
  formatIbkrOrderSideSize,
  ibkrCancelToast,
  ibkrLifecycleRequiresReconciliation,
  ibkrOrderNeedsFillReconciliation,
  isIbkrOrderReconciliationError,
  isIbkrOrderRejected,
  isIbkrLiveReadinessReady,
  isIbkrReplacementStateError,
  readIbkrOrderWarning,
  resolveExplicitIbkrAccount,
} from "./ibkrLiveEquityOrderModel.js";
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
const IBKR_TERMINAL_ORDER_STATUSES = new Set([
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

export const resolveIbkrLiveSubmitBlock = ({
  brokerConfigured,
  gatewayTradingBlocked,
  gatewayTradingMessage,
  accountId,
  liveOrderPayloadReady,
  orderRequest,
  ticketIsShares,
}) => {
  if (!brokerConfigured) {
    return {
      reason: "broker_required",
      toast: {
        kind: "warn",
        title: "IBKR required",
        body: "Local order fills are disabled. Connect IBKR Client Portal to submit this order.",
      },
    };
  }

  if (gatewayTradingBlocked) {
    return {
      reason: "gateway_blocked",
      toast: {
        kind: "warn",
        title: "IBKR session unavailable",
        body: gatewayTradingMessage,
      },
    };
  }

  if (!accountId) {
    return {
      reason: "missing_account",
      toast: {
        kind: "warn",
        title: "No broker account selected",
        body: "The Client Portal session is authenticated, but no IBKR account is active yet.",
      },
    };
  }

  if (!liveOrderPayloadReady || !orderRequest) {
    return {
      reason: "order_payload_unavailable",
      toast: {
        kind: "info",
        title: ticketIsShares ? "Ticker loading" : "Contract loading",
        body: ticketIsShares
          ? "Wait for the ticker to finish loading before submitting a broker order."
          : "Wait for the live option chain to finish loading before submitting a broker order.",
      },
    };
  }

  return null;
};

export const submitIbkrLiveOrderAfterGate = async ({
  brokerConfigured,
  gatewayTradingBlocked,
  gatewayTradingMessage,
  accountId,
  liveOrderPayloadReady,
  orderRequest,
  ticketIsShares,
  toast,
  submit,
}) => {
  const block = resolveIbkrLiveSubmitBlock({
    brokerConfigured,
    gatewayTradingBlocked,
    gatewayTradingMessage,
    accountId,
    liveOrderPayloadReady,
    orderRequest,
    ticketIsShares,
  });

  if (block) {
    toast.push(block.toast);
    return { submitted: false, reason: block.reason };
  }

  await submit();
  return { submitted: true, reason: null };
};

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

const taxPreflightToneColor = (state, pending) => {
  if (pending) return CSS_COLOR.cyan;
  if (state?.action === "block") return CSS_COLOR.red;
  if (state?.action === "warn_ack_required") return CSS_COLOR.amber;
  if (state?.action === "allow") return CSS_COLOR.green;
  return CSS_COLOR.textDim;
};

const formatTaxPreflightAction = (state, pending) => {
  if (pending) return "Checking";
  if (state?.action === "block") return "Blocked";
  if (state?.action === "warn_ack_required") return "Ack required";
  if (state?.action === "allow") return "Clear";
  return "Not run";
};

const TaxComplianceStrip = ({ state, pending }) => {
  const tone = taxPreflightToneColor(state, pending);
  const warnings = Array.isArray(state?.warnings) ? state.warnings : [];
  const reasons = Array.isArray(state?.reasons) ? state.reasons : [];
  const acknowledgements = Array.isArray(state?.requiredAcknowledgements)
    ? state.requiredAcknowledgements
    : [];
  const detail = pending
    ? "Checking tax and same-account order conflicts."
    : warnings[0] ||
      reasons[0] ||
      (acknowledgements.length
        ? `${acknowledgements.length} acknowledgement${acknowledgements.length === 1 ? "" : "s"} required`
        : "Runs before live submission.");
  return (
    <div
      data-testid="trade-ticket-tax-compliance-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(6),
        minWidth: 0,
        border: `1px solid ${cssColorAlpha(tone, "34")}`,
        background: cssColorAlpha(tone, "08"),
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
        <MetricChip label="Tax" value={formatTaxPreflightAction(state, pending)} tone={tone} />
        <MetricChip
          label="Wash"
          value={state?.washSaleRisk ? String(state.washSaleRisk).toUpperCase() : MISSING_VALUE}
          tone={state?.washSaleRisk === "unknown" ? CSS_COLOR.amber : tone}
        />
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
          {detail}
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
  requestedAssetMode = null,
  requestedAssetModeNonce = 0,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const authSession = useAuthSession();
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
  const [equityBroker, setEquityBroker] = useState("snaptrade");
  const [optionBroker, setOptionBroker] = useState("ibkr");
  const [optionAction, setOptionAction] = useState("buy_to_open");
  const [selectedIbkrAccountId, setSelectedIbkrAccountId] = useState("");
  const [selectedRobinhoodAccountId, setSelectedRobinhoodAccountId] =
    useState("");
  const [selectedSchwabAccountId, setSelectedSchwabAccountId] = useState("");
  const normalizedTicketAssetMode = normalizeTicketAssetMode(ticketAssetMode);
  const ibkrRouteSelected =
    normalizedTicketAssetMode === "equity"
      ? equityBroker === "ibkr"
      : optionBroker === "ibkr";
  const ibkrReadinessQuery = useGetIbkrPortalReadiness({
    query: {
      enabled: ibkrRouteSelected,
      staleTime: 5_000,
      retry: false,
    },
  });
  const ibkrExecutionAccounts = ibkrReadinessQuery.data?.executionTargets || [];
  const selectedIbkrAccount = resolveExplicitIbkrAccount(
    ibkrExecutionAccounts,
    selectedIbkrAccountId,
  );
  const inheritedIbkrAccount = resolveExplicitIbkrAccount(
    ibkrExecutionAccounts,
    accountId,
  );
  const ibkrLiveReadinessReady = isIbkrLiveReadinessReady(
    ibkrReadinessQuery.data,
    selectedIbkrAccount,
  );
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
  const optionOrderIntent = resolveOptionOrderIntent({
    action: optionAction,
    right: selectedContractMeta?.right || slot.cp,
  });
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
  const liveBrokerRoute = ticketIsShares ? equityBroker : optionBroker;
  const snapTradeRouteSelected = liveBrokerRoute === "snaptrade";
  const robinhoodRouteSelected = liveBrokerRoute === "robinhood";
  const schwabRouteSelected = liveBrokerRoute === "schwab";
  const robinhoodCsrfToken = robinhoodRouteSelected
    ? authSession.csrfToken || ""
    : "";
  const robinhoodCsrfHeaders = useMemo(
    () => (robinhoodCsrfToken ? { "x-csrf-token": robinhoodCsrfToken } : {}),
    [robinhoodCsrfToken],
  );
  const robinhoodSyncMutation = useSyncRobinhoodConnections({
    request: { headers: robinhoodCsrfHeaders },
  });
  const robinhoodAccounts = useMemo(
    () =>
      (robinhoodSyncMutation.data?.accounts || []).filter(
        (account) =>
          account.agentic === true && account.executionReady === true,
      ),
    [robinhoodSyncMutation.data],
  );
  const robinhoodAccount =
    robinhoodAccounts.find(
      (account) => account.id === selectedRobinhoodAccountId,
    ) ||
    robinhoodAccounts[0] ||
    null;
  const robinhoodAccountReady = Boolean(robinhoodAccount?.executionReady);
  useEffect(() => {
    if (robinhoodAccount?.id !== selectedRobinhoodAccountId) {
      setSelectedRobinhoodAccountId(robinhoodAccount?.id || "");
    }
  }, [robinhoodAccount?.id, selectedRobinhoodAccountId]);
  useEffect(() => {
    if (
      robinhoodRouteSelected &&
      robinhoodCsrfToken &&
      !robinhoodSyncMutation.data &&
      !robinhoodSyncMutation.isPending &&
      !robinhoodSyncMutation.isError
    ) {
      robinhoodSyncMutation.mutate();
    }
  }, [
    robinhoodCsrfToken,
    robinhoodRouteSelected,
    robinhoodSyncMutation.data,
    robinhoodSyncMutation.isError,
    robinhoodSyncMutation.isPending,
    robinhoodSyncMutation.mutate,
  ]);
  const schwabCsrfToken = schwabRouteSelected
    ? authSession.csrfToken || ""
    : "";
  const schwabCsrfHeaders = useMemo(
    () => (schwabCsrfToken ? { "x-csrf-token": schwabCsrfToken } : {}),
    [schwabCsrfToken],
  );
  const schwabReadinessQuery = useGetSchwabReadiness({
    query: {
      enabled: schwabRouteSelected,
      retry: false,
      staleTime: 15_000,
    },
  });
  const schwabSyncMutation = useSyncSchwabConnections({
    request: { headers: schwabCsrfHeaders },
  });
  const schwabAccounts = useMemo(
    () =>
      (schwabSyncMutation.data?.accounts || []).filter(
        (account) => account.executionReady === true,
      ),
    [schwabSyncMutation.data],
  );
  const schwabAccount =
    schwabAccounts.find((account) => account.id === selectedSchwabAccountId) ||
    schwabAccounts[0] ||
    null;
  const schwabAccountReady = Boolean(schwabAccount?.executionReady);
  useEffect(() => {
    if (schwabAccount?.id !== selectedSchwabAccountId) {
      setSelectedSchwabAccountId(schwabAccount?.id || "");
    }
  }, [schwabAccount?.id, selectedSchwabAccountId]);
  useEffect(() => {
    if (
      schwabRouteSelected &&
      schwabCsrfToken &&
      schwabReadinessQuery.data?.user?.connected === true &&
      !schwabSyncMutation.data &&
      !schwabSyncMutation.isPending &&
      !schwabSyncMutation.isError
    ) {
      schwabSyncMutation.mutate();
    }
  }, [
    schwabCsrfToken,
    schwabReadinessQuery.data?.user?.connected,
    schwabRouteSelected,
    schwabSyncMutation.data,
    schwabSyncMutation.isError,
    schwabSyncMutation.isPending,
    schwabSyncMutation.mutate,
  ]);
  const directOptionAccount =
    optionBroker === "snaptrade"
      ? snapTradeAccount
      : optionBroker === "robinhood"
        ? robinhoodAccount
        : optionBroker === "schwab"
          ? schwabAccount
          : null;
  const directOptionAccountReady = Boolean(directOptionAccount?.executionReady);
  const snapTradeAuthEnabled = Boolean(
    snapTradeRouteSelected && snapTradeAccountReady,
  );
  const snapTradeCsrfToken = snapTradeAuthEnabled
    ? authSession.csrfToken || ""
    : "";
  const snapTradeCsrfHeaders = useMemo(
    () => (snapTradeCsrfToken ? { "x-csrf-token": snapTradeCsrfToken } : {}),
    [snapTradeCsrfToken],
  );
  const taxPreflightCsrfToken = authSession.csrfToken || snapTradeCsrfToken;
  const taxPreflightCsrfHeaders = useMemo(
    () =>
      taxPreflightCsrfToken ? { "x-csrf-token": taxPreflightCsrfToken } : {},
    [taxPreflightCsrfToken],
  );
  const liveOrderPayloadReady = ticketIsShares
    ? Boolean(
        (liveBrokerRoute === "robinhood"
          ? robinhoodAccountReady
          : liveBrokerRoute === "schwab"
            ? schwabAccountReady
            : liveBrokerRoute === "ibkr"
              ? ibkrLiveReadinessReady && selectedIbkrAccount
              : snapTradeAccountReady) && slot.ticker,
      )
    : optionBroker === "ibkr"
      ? Boolean(
          ibkrLiveReadinessReady &&
            selectedIbkrAccount &&
            selectedContractMeta &&
            expInfo.actualDate,
        )
      : Boolean(
          directOptionAccountReady && selectedContractMeta && expInfo.actualDate,
        );
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
        if (liveUsesIbkr) {
          setActiveIbkrOrder({
            ...order,
            reconciliationRequired: ibkrLifecycleRequiresReconciliation(
              "place",
              order,
            ),
          });
          setReplacementLimitPrice(order.limitPrice ?? "");
          setPreviewSnapshot(null);
          setIbkrCancelAttempted(false);
          setIbkrReplacementLocked(false);
        }
        const placementConfirmed =
          !liveUsesIbkr ||
          !ibkrLifecycleRequiresReconciliation("place", order);
        toast.push({
          kind: placementConfirmed ? "success" : "warn",
          title: placementConfirmed
            ? `Submitted ${ticketInstrumentLabel}`
            : "Placement requires reconciliation",
          body: placementConfirmed
            ? `${order.quantity} × ${order.type.toUpperCase()} · ${order.status.toUpperCase()}`
            : "Stop here and reconcile the broker order before any further action.",
        });
      },
      onError: (error) => {
        if (readIbkrOrderWarning(error)) return;
        if (
          liveUsesIbkr &&
          isIbkrOrderReconciliationError(error)
        ) {
          return;
        }
        toast.push({
          kind: "error",
          title: "Order rejected",
          body: error?.message || "The broker rejected the order.",
        });
      },
    },
  });
  const continueIbkrOrderReplyMutation = useContinueIbkrOrderReply();
  const previewOrderReplacementMutation = usePreviewOrderReplacement();
  const replaceOrderMutation = useReplaceOrder();
  const cancelOrderMutation = useCancelOrder();
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
  const [activeIbkrOrder, setActiveIbkrOrder] = useState(null);
  const [replacementLimitPrice, setReplacementLimitPrice] = useState("");
  const [ibkrSubmitLocked, setIbkrSubmitLocked] = useState(false);
  const [directBrokerReconciliationLock, setDirectBrokerReconciliationLock] =
    useState(null);
  const [ibkrReplacementLocked, setIbkrReplacementLocked] = useState(false);
  const [ibkrCancelAttempted, setIbkrCancelAttempted] = useState(false);
  const recoveredIbkrLifecycleKeyRef = useRef("");
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
        if (liveUsesIbkr) {
          setTaxPreflightState(preview.taxPreflight || null);
          setIbkrSubmitLocked(false);
          setIbkrReplacementLocked(false);
          setIbkrCancelAttempted(false);
          setActiveIbkrOrder(null);
        }
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
          body: liveUsesIbkr
            ? `${preview.symbol} · ${variables?.data?.quantity ?? qtyNum} ${ticketQuantityUnit} · ${String(variables?.data?.type ?? normalizeTicketOrderType(orderType)).toUpperCase()} DAY · regular hours`
            : `${preview.symbol} · ${ticketIsShares ? "stock" : "contract"} ${preview.resolvedContractId}`,
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
        const reconciliationRequired = result?.reconcileRequired === true;
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
          kind: reconciliationRequired ? "warn" : "success",
          title: reconciliationRequired
            ? "Submitted; reconciliation required"
            : `Submitted ${ticketInstrumentLabel}`,
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
  const robinhoodImpactMutation = useMutation({
    mutationFn: reviewRobinhoodEquityOrderRequest,
  });
  const submitRobinhoodOrderMutation = useMutation({
    mutationFn: placeRobinhoodEquityOrderRequest,
  });
  const schwabEquityPreviewMutation = useMutation({
    mutationFn: previewSchwabEquityOrderRequest,
  });
  const submitSchwabEquityOrderMutation = useMutation({
    mutationFn: submitSchwabEquityOrderRequest,
  });
  const brokerOptionReviewMutation = useMutation({
    mutationFn: reviewBrokerOptionOrderRequest,
  });
  const submitBrokerOptionMutation = useMutation({
    mutationFn: placeBrokerOptionOrderRequest,
  });
  const taxPreflightMutation = useCreateTaxOrderPreflight({
    request: { headers: taxPreflightCsrfHeaders },
  });
  const [taxPreflightState, setTaxPreflightState] = useState(null);
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
    !executionIsShadow && ticketIsShares && liveBrokerRoute === "snaptrade";
  const liveUsesRobinhood =
    !executionIsShadow && ticketIsShares && liveBrokerRoute === "robinhood";
  const liveUsesSchwab =
    !executionIsShadow && ticketIsShares && liveBrokerRoute === "schwab";
  const liveUsesIbkr =
    !executionIsShadow && liveBrokerRoute === "ibkr";
  const liveUsesBrokerOption =
    !executionIsShadow && ticketIsOptions && optionBroker !== "ibkr";
  const liveUsesDirectBroker =
    liveUsesSnapTrade ||
    liveUsesRobinhood ||
    liveUsesSchwab ||
    liveUsesBrokerOption;
  const activeIbkrOrdersQuery = useListOrders(
    { accountId: selectedIbkrAccount?.accountId, mode: "live" },
    {
      query: {
        enabled: Boolean(liveUsesIbkr && activeIbkrOrder?.id),
        staleTime: 1_000,
        refetchInterval: activeIbkrOrder?.id ? 2_000 : false,
        retry: false,
      },
    },
  );
  const queriedIbkrOrder = (activeIbkrOrdersQuery.data?.orders || []).find(
    (order) => order.id === activeIbkrOrder?.id,
  );
  const trackedIbkrOrder = queriedIbkrOrder
    ? {
        ...activeIbkrOrder,
        ...queriedIbkrOrder,
        reconciliationRequired: Boolean(
          activeIbkrOrder?.reconciliationRequired ||
            queriedIbkrOrder.reconciliationRequired,
        ),
      }
    : activeIbkrOrder;
  const trackedIbkrOrderStatus = String(
    trackedIbkrOrder?.status || "pending_submit",
  ).toLowerCase();
  const trackedIbkrOrderTerminal = IBKR_TERMINAL_ORDER_STATUSES.has(
    trackedIbkrOrderStatus,
  );
  const trackedIbkrOrderIsMarket =
    trackedIbkrOrder?.type === "market" ||
    (trackedIbkrOrder?.type == null && trackedIbkrOrder?.limitPrice == null);
  const trackedIbkrOrderReadPending = Boolean(
    activeIbkrOrder?.id && activeIbkrOrdersQuery.isPending,
  );
  const trackedIbkrOrderReadMissing = Boolean(
    activeIbkrOrder?.id &&
      activeIbkrOrdersQuery.isSuccess &&
      !queriedIbkrOrder,
  );
  const trackedIbkrOrderReadFailed = Boolean(
    activeIbkrOrder?.id && activeIbkrOrdersQuery.isError,
  );
  const trackedIbkrOrderRequiresReconciliation = Boolean(
    trackedIbkrOrder?.reconciliationRequired ||
      ibkrOrderNeedsFillReconciliation(trackedIbkrOrder) ||
      trackedIbkrOrderReadMissing ||
      trackedIbkrOrderReadFailed,
  );
  const ibkrLifecyclePending =
    previewOrderReplacementMutation.isPending ||
    replaceOrderMutation.isPending ||
    cancelOrderMutation.isPending ||
    continueIbkrOrderReplyMutation.isPending ||
    trackedIbkrOrderReadPending;
  const ibkrWarningDecisionOpen = liveConfirmState?.kind === "ibkr_warning";
  const controlledIbkrOrder = ibkrReadinessQuery.data?.controlledOrder;
  useEffect(() => {
    if (!liveUsesIbkr || !controlledIbkrOrder) return;
    const recoveryKey = [
      controlledIbkrOrder.status,
      controlledIbkrOrder.accountId,
      controlledIbkrOrder.orderId,
      controlledIbkrOrder.limitPrice,
      controlledIbkrOrder.replacementUsed,
      controlledIbkrOrder.cancelAttempted,
      controlledIbkrOrder.reason,
    ].join(":");
    if (recoveredIbkrLifecycleKeyRef.current === recoveryKey) return;
    recoveredIbkrLifecycleKeyRef.current = recoveryKey;
    if (controlledIbkrOrder.status === "none") return;

    setSelectedIbkrAccountId(controlledIbkrOrder.accountId || "");
    setActiveIbkrOrder({
      id: controlledIbkrOrder.orderId || null,
      accountId: controlledIbkrOrder.accountId || null,
      symbol: controlledIbkrOrder.symbol || slot.ticker,
      side: controlledIbkrOrder.side || "buy",
      quantity: controlledIbkrOrder.quantity || 1,
      type: controlledIbkrOrder.limitPrice == null ? "market" : "limit",
      limitPrice: controlledIbkrOrder.limitPrice,
      filledQuantity: 0,
      status:
        controlledIbkrOrder.status === "active"
          ? "pending_submit"
          : "unknown",
      reconciliationRequired:
        controlledIbkrOrder.status === "reconciliation_required",
    });
    setIbkrSubmitLocked(true);
    setIbkrReplacementLocked(controlledIbkrOrder.replacementUsed === true);
    setIbkrCancelAttempted(controlledIbkrOrder.cancelAttempted === true);
  }, [controlledIbkrOrder, liveUsesIbkr, slot.ticker]);
  useEffect(() => {
    if (
      !activeIbkrOrder?.id ||
      (!trackedIbkrOrderReadMissing &&
        !trackedIbkrOrderReadFailed &&
        !ibkrOrderNeedsFillReconciliation(queriedIbkrOrder))
    ) {
      return;
    }
    setActiveIbkrOrder((current) =>
      current ? { ...current, reconciliationRequired: true } : current,
    );
  }, [
    activeIbkrOrder?.id,
    queriedIbkrOrder,
    trackedIbkrOrderReadFailed,
    trackedIbkrOrderReadMissing,
  ]);
  const directOptionCsrfToken = liveUsesBrokerOption
    ? authSession.csrfToken || ""
    : "";
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
  const robinhoodExecutionAccountLabel =
    robinhoodAccount?.displayName || "Sync Robinhood";
  const schwabExecutionAccountLabel =
    schwabAccount?.displayName || "Sync Schwab";
  const directOptionExecutionAccountLabel =
    directOptionAccount?.displayName || `Sync ${formatEnumLabel(optionBroker)}`;
  const selectedExecutionLabel = executionIsShadow
    ? "SHADOW"
    : liveUsesSnapTrade
      ? snapTradeAccountReady
        ? "SNAPTRADE LIVE"
        : "SNAPTRADE SETUP"
    : liveUsesRobinhood
      ? robinhoodAccountReady
        ? "ROBINHOOD LIVE"
        : "ROBINHOOD SETUP"
    : liveUsesSchwab
      ? schwabAccountReady
        ? "SCHWAB LIVE"
        : "SCHWAB SETUP"
    : liveUsesIbkr
      ? ibkrLiveReadinessReady
        ? "IBKR LIVE"
        : selectedIbkrAccount
          ? "IBKR LIVE NOT READY"
          : "IBKR ACCOUNT REQUIRED"
    : liveUsesBrokerOption
      ? directOptionAccountReady
        ? `${optionBroker.toUpperCase()} LIVE`
        : `${optionBroker.toUpperCase()} SETUP`
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
    : liveUsesRobinhood
      ? robinhoodExecutionAccountLabel
    : liveUsesSchwab
      ? schwabExecutionAccountLabel
    : liveUsesIbkr
      ? selectedIbkrAccount?.maskedAccountId || "Select an IBKR account"
    : liveUsesBrokerOption
      ? directOptionExecutionAccountLabel
    : brokerConfigured
      ? inheritedIbkrAccount?.maskedAccountId || "IBKR account"
      : MISSING_VALUE;
  const selectedExecutionColor = executionIsShadow
    ? CSS_COLOR.pink
    : liveUsesSnapTrade
      ? snapTradeAccountReady
        ? CSS_COLOR.green
        : CSS_COLOR.amber
    : liveUsesRobinhood
      ? robinhoodAccountReady
        ? CSS_COLOR.green
        : CSS_COLOR.amber
    : liveUsesSchwab
      ? schwabAccountReady
        ? CSS_COLOR.green
        : CSS_COLOR.amber
    : liveUsesIbkr
      ? ibkrLiveReadinessReady
        ? CSS_COLOR.green
        : CSS_COLOR.amber
    : liveUsesBrokerOption
      ? directOptionAccountReady
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
    if (ticketIsOptions) {
      const nextAction = nextSide === "SELL" ? "sell_to_close" : "buy_to_open";
      const nextIntent = resolveOptionOrderIntent({
        action: nextAction,
        right: selectedContractMeta?.right || slot.cp,
      });
      if (nextIntent) {
        setOptionAction(nextAction);
        setSide(nextIntent.side);
      }
    } else {
      setSide(nextSide);
    }
    if (ticketIsOptions && nextSide === "SELL") {
      setOrderType("LMT");
    }
  };
  const selectTicketAssetMode = (nextMode) => {
    setTicketAssetMode(nextMode);
    if (normalizeTicketAssetMode(nextMode) === "option" && optionOrderIntent) {
      setSide(optionOrderIntent.side);
    }
  };
  useEffect(() => {
    if (requestedAssetMode === "equity" || requestedAssetMode === "option") {
      selectTicketAssetMode(requestedAssetMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAssetMode, requestedAssetModeNonce]);
  // Preselect side when the docked collapsed bar requests it (BUY/SELL pills).
  // Keyed on requestedNonce so re-tapping the same pill re-asserts the side.
  useEffect(() => {
    if (requestedSide === "BUY" || requestedSide === "SELL") {
      selectSide(requestedSide);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedNonce, requestedSide]);
  const selectEquityBroker = (broker) => {
    const nextBroker = ["ibkr", "robinhood", "schwab"].includes(broker)
      ? broker
      : "snaptrade";
    setEquityBroker(nextBroker);
    setPreviewSnapshot(null);
    setTaxPreflightState(null);
    setIbkrSubmitLocked(
      nextBroker === "ibkr" && Boolean(activeIbkrOrder?.id),
    );
    if (nextBroker === "ibkr") {
      setOrderType("LMT");
      setTif("DAY");
      setAttachStopLoss(false);
      setAttachTakeProfit(false);
    }
    if (
      (nextBroker === "robinhood" && tif !== "DAY" && tif !== "GTC") ||
      (nextBroker === "schwab" && tif === "IOC")
    ) {
      setTif("DAY");
    }
    if (nextBroker === "robinhood" && robinhoodSyncMutation.isError) {
      robinhoodSyncMutation.reset();
    }
    if (nextBroker === "schwab" && schwabSyncMutation.isError) {
      schwabSyncMutation.reset();
    }
  };
  const selectOptionBroker = (broker) => {
    const nextBroker = ["snaptrade", "robinhood", "schwab"].includes(broker)
      ? broker
      : "ibkr";
    setOptionBroker(nextBroker);
    setPreviewSnapshot(null);
    setTaxPreflightState(null);
    setIbkrSubmitLocked(
      nextBroker === "ibkr" && Boolean(activeIbkrOrder?.id),
    );
    if (nextBroker !== "ibkr" && optionAction !== "buy_to_open") {
      setOptionAction("buy_to_open");
      setSide("BUY");
    }
    if (
      ["ibkr", "snaptrade", "schwab"].includes(nextBroker) &&
      orderType !== "MKT" &&
      orderType !== "LMT"
    ) {
      setOrderType("LMT");
    }
    if (nextBroker === "ibkr") {
      setTif("DAY");
      setAttachStopLoss(false);
      setAttachTakeProfit(false);
    }
    if (
      (nextBroker === "robinhood" && tif !== "DAY" && tif !== "GTC") ||
      (nextBroker === "schwab" && tif === "IOC")
    ) {
      setTif("DAY");
    }
    if (nextBroker === "robinhood" && robinhoodSyncMutation.isError) {
      robinhoodSyncMutation.reset();
    }
    if (nextBroker === "schwab" && schwabSyncMutation.isError) {
      schwabSyncMutation.reset();
    }
  };
  const renderTicketAssetModeControls = () => (
    <div data-testid="trade-ticket-asset-mode">
      <SegmentedControl
        ariaLabel="Asset mode"
        options={TICKET_ASSET_MODES.map((mode) => ({
          value: mode,
          label: mode === "equity" ? "SHARES" : "OPTIONS",
        }))}
        value={normalizedTicketAssetMode}
        onChange={selectTicketAssetMode}
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
      {ticketIsShares ? (
        <SegmentedControl
          ariaLabel="Equity broker"
          options={[
            { value: "ibkr", label: "IBKR" },
            { value: "snaptrade", label: "SNAPTRADE" },
            { value: "robinhood", label: "ROBINHOOD" },
            {
              value: "schwab",
              label: schwabAccountReady ? "SCHWAB" : "SCHWAB (NOT READY)",
            },
          ]}
          value={equityBroker}
          onChange={selectEquityBroker}
        />
      ) : null}
      {ticketIsOptions ? (
        <SegmentedControl
          ariaLabel="Options broker"
          options={[
            { value: "ibkr", label: "IBKR" },
            { value: "snaptrade", label: "SNAPTRADE" },
            { value: "robinhood", label: "ROBINHOOD" },
            {
              value: "schwab",
              label: schwabAccountReady ? "SCHWAB" : "SCHWAB (NOT READY)",
            },
          ]}
          value={optionBroker}
          onChange={selectOptionBroker}
        />
      ) : null}
      {liveUsesIbkr ? (
        <select
          aria-label="IBKR execution account"
          value={selectedIbkrAccount?.accountId || ""}
          disabled={Boolean(
            trackedIbkrOrderRequiresReconciliation ||
              (trackedIbkrOrder?.id && !trackedIbkrOrderTerminal),
          )}
          onChange={(event) => {
            setSelectedIbkrAccountId(event.target.value);
            setPreviewSnapshot(null);
            setTaxPreflightState(null);
            setIbkrSubmitLocked(false);
            setIbkrReplacementLocked(false);
            setIbkrCancelAttempted(false);
            setActiveIbkrOrder(null);
          }}
          style={{
            width: "100%",
            background: CSS_COLOR.bg1,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            padding: sp("5px 7px"),
          }}
        >
          <option value="">Select a live IBKR account</option>
          {ibkrExecutionAccounts.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {account.maskedAccountId}
            </option>
          ))}
        </select>
      ) : null}
      {robinhoodRouteSelected && robinhoodAccounts.length ? (
        <select
          aria-label="Robinhood execution account"
          value={robinhoodAccount?.id || ""}
          onChange={(event) => setSelectedRobinhoodAccountId(event.target.value)}
          style={{
            width: "100%",
            background: CSS_COLOR.bg1,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            padding: sp("5px 7px"),
          }}
        >
          {robinhoodAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName}
            </option>
          ))}
        </select>
      ) : null}
      {schwabRouteSelected && schwabAccounts.length ? (
        <select
          aria-label="Schwab execution account"
          value={schwabAccount?.id || ""}
          onChange={(event) => setSelectedSchwabAccountId(event.target.value)}
          style={{
            width: "100%",
            background: CSS_COLOR.bg1,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            padding: sp("5px 7px"),
          }}
        >
          {schwabAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName}
            </option>
          ))}
        </select>
      ) : null}
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
      {!executionIsShadow && liveUsesRobinhood && !robinhoodAccountReady ? (
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
          {robinhoodSyncMutation.isPending
            ? "Loading execution-ready Robinhood Agentic accounts."
            : "Connect and sync an execution-ready Robinhood Agentic account in Settings before submitting shares."}
        </div>
      ) : null}
      {!executionIsShadow && liveUsesSchwab && !schwabAccountReady ? (
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
          {schwabSyncMutation.isPending
            ? "Loading execution-ready Schwab accounts."
            : "Connect and sync an execution-ready Schwab account in Settings before submitting shares."}
        </div>
      ) : null}
      {!executionIsShadow && liveUsesBrokerOption && !directOptionAccountReady ? (
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
          Sync an execution-ready {formatEnumLabel(optionBroker)} account in
          Settings before submitting options.
        </div>
      ) : null}
      {!executionIsShadow &&
      liveUsesBrokerOption &&
      optionAction !== "buy_to_open" ? (
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
          Non-IBKR option closing and short-opening actions stay blocked until
          this ticket has account-scoped position and working-order context.
        </div>
      ) : null}
      {!executionIsShadow && !liveUsesSnapTrade && !gatewayTradingReady &&
        !liveUsesRobinhood && !liveUsesSchwab && !liveUsesBrokerOption &&
        !liveUsesIbkr && (
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
  const ticketOrderTypes =
    liveUsesIbkr
      ? ["MKT", "LMT"]
      : ticketIsOptions && ["snaptrade", "schwab"].includes(optionBroker)
      ? ["MKT", "LMT"]
      : TICKET_ORDER_TYPES;
  const ticketTimeInForceOptions = liveUsesIbkr
    ? ["DAY"]
    : robinhoodRouteSelected
    ? ["DAY", "GTC"]
    : schwabRouteSelected
      ? ["DAY", "GTC", "FOK"]
      : ["DAY", "GTC", "IOC", "FOK"];
  const ticketTypeOptions = ticketOrderTypes.map((value) => [
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
        options={ticketTimeInForceOptions}
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
    optionAction,
    slot.ticker,
    slot.strike,
    slot.cp,
    ticketEntryReferencePrice,
  ]);

  useEffect(() => {
    persistState({ tradeExecutionMode: executionMode });
  }, [executionMode]);

  useEffect(() => {
    if (
      executionMode === "shadow" ||
      liveUsesIbkr ||
      liveUsesSnapTrade ||
      liveUsesRobinhood ||
      liveUsesSchwab ||
      liveUsesBrokerOption
    ) {
      setAttachStopLoss(false);
      setAttachTakeProfit(false);
    }
  }, [
    executionMode,
    liveUsesIbkr,
    liveUsesBrokerOption,
    liveUsesRobinhood,
    liveUsesSchwab,
    liveUsesSnapTrade,
  ]);

  useEffect(() => {
    setPreviewSnapshot(null);
    setShadowExposureAcknowledged(false);
    if (liveUsesIbkr) {
      setTaxPreflightState(null);
    }
  }, [
    side,
    optionAction,
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
    selectedIbkrAccountId,
    brokerConfigured,
    brokerAuthenticated,
    automationTicketContext,
    liveBrokerRoute,
    liveUsesIbkr,
    robinhoodAccount?.id,
    robinhoodAccountReady,
    schwabAccount?.id,
    schwabAccountReady,
    snapTradeAccount?.id,
    snapTradeAccountReady,
  ]);
  const bidFlashClass = useValueFlash(ticketIsShares ? equityPrice : bid);
  const midFlashClass = useValueFlash(ticketReferencePrice);
  const askFlashClass = useValueFlash(ticketIsShares ? equityPrice : ask);
  const closeLiveConfirm = async () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmError(null);
    const closingState = liveConfirmState;
    if (!closingState?.onCancel) {
      setLiveConfirmState(null);
      return;
    }
    setLiveConfirmPending(true);
    try {
      await closingState.onCancel();
      setLiveConfirmState((current) =>
        current === closingState ? null : current,
      );
    } catch (error) {
      setLiveConfirmError(formatLiveBrokerActionError(error));
    } finally {
      setLiveConfirmPending(false);
    }
  };
  const lockedReadinessModel = buildTicketReadinessModel({
    executionMode,
    brokerRoute:
      liveUsesRobinhood || liveUsesSchwab || liveUsesBrokerOption
        ? "snaptrade"
        : liveBrokerRoute,
    gatewayTradingReady: liveUsesIbkr ? true : gatewayTradingReady,
    brokerConfigured: liveUsesIbkr
      ? ibkrLiveReadinessReady
      : brokerConfigured,
    brokerAuthenticated: liveUsesIbkr
      ? ibkrLiveReadinessReady
      : brokerAuthenticated,
    accountId: liveUsesIbkr
      ? selectedIbkrAccount?.accountId || null
      : accountId,
    snapTradeExecutionReady: liveUsesRobinhood
      ? robinhoodAccountReady
      : liveUsesSchwab
        ? schwabAccountReady
        : liveUsesBrokerOption
          ? directOptionAccountReady
          : snapTradeAccountReady,
    snapTradeExecutionBlockers:
      liveUsesRobinhood || liveUsesSchwab || liveUsesBrokerOption
        ? [`${liveBrokerRoute} account`]
        : snapTradeAccount?.executionBlockers || [],
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
    const confirmingState = liveConfirmState;
    const lockDirectBrokerSubmission = (reconciliation) => {
      setDirectBrokerReconciliationLock(reconciliation);
      setLiveConfirmState((current) =>
        current === confirmingState
          ? {
              ...current,
              confirmLabel: "STOP / RECONCILE",
              cancelLabel: "Close",
              onConfirm: null,
            }
          : current,
      );
    };
    try {
      const result = await confirmingState.onConfirm();
      const reconciliation = readBrokerSubmitReconciliation(result);
      if (liveUsesDirectBroker && reconciliation) {
        lockDirectBrokerSubmission(reconciliation);
        setLiveConfirmError(
          "The broker accepted the order, but local reconciliation is required before another action.",
        );
        return;
      }
      setLiveConfirmState((current) =>
        current === confirmingState ? null : current,
      );
    } catch (error) {
      const reconciliation = readBrokerSubmitReconciliation(error);
      if (liveUsesDirectBroker && reconciliation) {
        lockDirectBrokerSubmission(reconciliation);
      }
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
  const robinhoodOrderDraft = liveUsesRobinhood
    ? buildRobinhoodEquityOrderDraft({
        account: robinhoodAccount,
        symbol: slot.ticker,
        side,
        orderType,
        tif,
        quantity: qtyNum,
        orderPrices,
      })
    : { ready: false, reason: "route", body: null };
  const schwabEquityOrderDraft = liveUsesSchwab
    ? buildSchwabEquityOrderDraft({
        account: schwabAccount,
        symbol: slot.ticker,
        side,
        orderType,
        tif,
        quantity: qtyNum,
        orderPrices,
      })
    : { ready: false, reason: "route", body: null };
  const brokerOptionOrderDraft = liveUsesBrokerOption
    ? buildBrokerOptionOrderDraft({
        broker: optionBroker,
        account: directOptionAccount,
        contractSymbol:
          selectedContractMeta?.ticker ||
          selectedContractMeta?.providerContractId,
        multiplier: selectedContractMeta?.multiplier,
        sharesPerContract: selectedContractMeta?.sharesPerContract,
        underlyingSymbol:
          selectedContractMeta?.underlying ||
          selectedContractMeta?.ticker ||
          slot.ticker,
        expiration: expInfo.actualDate,
        strike: selectedContractMeta?.strike ?? slot.strike,
        right: selectedContractMeta?.right || slot.cp,
        side,
        positionEffect: optionOrderIntent?.positionEffect,
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
  const robinhoodDraftBlockMessage =
    {
      robinhood_account:
        "Select an execution-ready Robinhood Agentic account.",
      symbol: "Select a ticker before submitting a Robinhood order.",
      quantity: "Enter a positive share quantity.",
      price: "Enter a positive limit price.",
      stop: "Enter a positive stop trigger.",
      order_type: "Select a supported Robinhood order type.",
      time_in_force: "Robinhood equity orders support DAY or GTC.",
    }[robinhoodOrderDraft.reason] ||
    "The Robinhood order payload is not ready yet.";
  const robinhoodDraftButtonLabel =
    {
      quantity: "QTY REQUIRED",
      price: "PRICE REQUIRED",
      stop: "STOP REQUIRED",
      time_in_force: "DAY / GTC REQUIRED",
    }[robinhoodOrderDraft.reason] || "ROBINHOOD BLOCKED";
  const schwabEquityDraftBlockMessage =
    {
      schwab_account: "Select an execution-ready Schwab account.",
      symbol: "Select a ticker before submitting a Schwab order.",
      quantity: "Enter a positive whole-share quantity.",
      price: "Enter a positive limit price.",
      stop: "Enter a positive stop trigger.",
      order_type: "Select a supported Schwab order type.",
      time_in_force: "Schwab equity orders do not support IOC.",
    }[schwabEquityOrderDraft.reason] ||
    "The Schwab equity order payload is not ready yet.";
  const schwabEquityDraftButtonLabel =
    {
      quantity: "WHOLE QTY REQUIRED",
      price: "PRICE REQUIRED",
      stop: "STOP REQUIRED",
      time_in_force: "TIF REQUIRED",
    }[schwabEquityOrderDraft.reason] || "SCHWAB BLOCKED";
  const brokerOptionDraftBlockMessage =
    {
      robinhood_account:
        "Select an execution-ready Robinhood Agentic account.",
      snaptrade_account: "Select an execution-ready SnapTrade account.",
      schwab_account: "Select an execution-ready Schwab account.",
      symbol: "The selected option underlying is not supported by this broker.",
      expiration: "The selected option expiration is unavailable.",
      strike: "The selected option strike is invalid.",
      option_type: "The selected contract right is invalid.",
      contract_identity:
        "The selected option contract does not have an executable contract ticker.",
      contract_economics:
        "Mini and adjusted option contracts are not enabled for direct broker execution.",
      position_effect:
        "Non-IBKR option sells require broker-specific position context and are not enabled.",
      order_type: `${formatEnumLabel(optionBroker)} options do not support this order type.`,
      time_in_force: `${formatEnumLabel(optionBroker)} options do not support this time in force.`,
      quantity: "Enter a positive whole-contract quantity.",
      price: "Enter a positive option limit price.",
      stop: "Enter a positive option stop trigger.",
    }[brokerOptionOrderDraft.reason] ||
    `The ${formatEnumLabel(optionBroker)} option order payload is not ready yet.`;
  const brokerOptionDraftButtonLabel =
    {
      position_effect: "OPTION SELL BLOCKED",
      quantity: "WHOLE QTY REQUIRED",
      price: "PRICE REQUIRED",
      stop: "STOP REQUIRED",
      order_type: "ORDER TYPE BLOCKED",
      time_in_force: "TIF BLOCKED",
    }[brokerOptionOrderDraft.reason] ||
    `${optionBroker.toUpperCase()} BLOCKED`;
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
  const optionActionAvailabilityByAction = Object.fromEntries(
    OPTION_ORDER_ACTIONS.map((action) => [
      action,
      resolveOptionActionAvailability({
        action,
        executionMode,
        broker: liveBrokerRoute,
        positionContextReady: Boolean(shadowExposureQuery.data),
        matchingLongQuantity: matchingShadowQuantity,
        quantity: qtyNum,
      }),
    ]),
  );
  const optionActionAvailability =
    optionActionAvailabilityByAction[optionAction] || {
      enabled: false,
      reason: "Choose a valid option action.",
    };
  const optionActionChoices = OPTION_ORDER_ACTIONS.map((action) => ({
    action,
    ...(resolveOptionOrderIntent({
      action,
      right: selectedContractMeta?.right || slot.cp,
    }) || {}),
    availability: optionActionAvailabilityByAction[action],
  }));
  const optionActionBlocked =
    ticketIsOptions && !optionActionAvailability.enabled;
  const selectOptionOrderAction = (nextAction) => {
    if (!optionActionAvailabilityByAction[nextAction]?.enabled) return;
    const nextIntent = resolveOptionOrderIntent({
      action: nextAction,
      right: selectedContractMeta?.right || slot.cp,
    });
    if (!nextIntent) return;
    setOptionAction(nextAction);
    setSide(nextIntent.side);
    if (nextIntent.side === "SELL") setOrderType("LMT");
  };
  const ticketActionLabel = ticketIsOptions
    ? optionOrderIntent?.actionLabel || "OPTION ACTION REQUIRED"
    : side === "BUY"
      ? "BUY"
      : "SELL";
  const optionOrderIntentFields =
    ticketIsOptions && optionOrderIntent
      ? {
          optionAction: optionOrderIntent.action,
          positionEffect: optionOrderIntent.positionEffect,
          ...(optionOrderIntent.strategyIntent
            ? { strategyIntent: optionOrderIntent.strategyIntent }
            : {}),
        }
      : {};
  const shadowSellToCloseIntent =
    ticketIsOptions && optionAction === "sell_to_close";
  const shadowAddExposureWarningActive =
    sameShadowContractExposure && !shadowSellToCloseIntent;
  const ibkrOrderAccountId = liveUsesIbkr
    ? selectedIbkrAccount?.accountId || ""
    : accountId;
  const orderRequest =
    !liveUsesSnapTrade &&
    !liveUsesRobinhood &&
    !liveUsesSchwab &&
    !liveUsesBrokerOption &&
    liveOrderPayloadReady
    ? liveUsesIbkr
      ? buildManualIbkrSingleLegOrderRequest({
          accountId: ibkrOrderAccountId,
          symbol: slot.ticker,
          assetClass: ticketAssetClass,
          side,
          quantity: qtyNum,
          optionAction,
          optionContract: optionOrderContract,
          orderType,
          limitPrice: orderPrices.limitPrice,
        })
      : {
        accountId: ibkrOrderAccountId,
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
  const buildTaxPreflightOrder = (route, targetAccountId) => ({
    accountId: targetAccountId,
    mode: "live",
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
    route,
    intent:
      optionOrderIntent?.strategyIntent ||
      optionOrderIntent?.positionEffect ||
      null,
  });
  const runTaxPreflight = async (route, targetAccountId) => {
    if (!targetAccountId) {
      toast.push({
        kind: "warn",
        title: "Tax preflight blocked",
        body: "No account is available for the live-order tax preflight.",
      });
      return null;
    }
    if (!taxPreflightCsrfToken) {
      const blocked = {
        action: "block",
        washSaleRisk: "unknown",
        selfTradeRisk: "possible",
        reasons: ["auth_session_required"],
        warnings: ["Refresh the app session before running tax preflight."],
        requiredAcknowledgements: [],
      };
      setTaxPreflightState(blocked);
      toast.push({
        kind: "warn",
        title: "Tax preflight blocked",
        body: "Refresh the app session before submitting a live order.",
      });
      return null;
    }

    try {
      const result = await taxPreflightMutation.mutateAsync({
        accountId: targetAccountId,
        data: { order: buildTaxPreflightOrder(route, targetAccountId) },
      });
      setTaxPreflightState(result);
      if (result?.action === "block") {
        toast.push({
          kind: "warn",
          title: "Order blocked by preflight",
          body:
            (Array.isArray(result.reasons) && result.reasons[0]) ||
            "Resolve the tax/compliance preflight issue before submitting.",
        });
      } else if (result?.action === "warn_ack_required") {
        toast.push({
          kind: "warn",
          title: "Tax acknowledgement required",
          body:
            (Array.isArray(result.warnings) && result.warnings[0]) ||
            "Review the confirmation before submitting this live order.",
        });
      }
      return result;
    } catch (error) {
      const blocked = {
        action: "block",
        washSaleRisk: "unknown",
        selfTradeRisk: "possible",
        reasons: ["preflight_unavailable"],
        warnings: [
          error?.message ||
            "Tax/compliance preflight is unavailable, so live submission is blocked.",
        ],
        requiredAcknowledgements: [],
      };
      setTaxPreflightState(blocked);
      toast.push({
        kind: "error",
        title: "Tax preflight unavailable",
        body:
          error?.message ||
          "The tax/compliance preflight service did not return a decision.",
      });
      return null;
    }
  };
  const buildTaxPreflightConfirmLines = (preflight) => {
    if (!preflight) return [];
    const action =
      preflight.action === "allow"
        ? "CLEAR"
        : preflight.action === "warn_ack_required"
          ? "ACK REQUIRED"
          : "BLOCKED";
    const actionColor =
      preflight.action === "allow"
        ? CSS_COLOR.green
        : preflight.action === "warn_ack_required"
          ? CSS_COLOR.amber
          : CSS_COLOR.red;
    const acknowledgements = Array.isArray(preflight.requiredAcknowledgements)
      ? preflight.requiredAcknowledgements
      : [];
    return [
      { label: "TAX", value: action, valueColor: actionColor },
      {
        label: "WASH",
        value: preflight.washSaleRisk
          ? String(preflight.washSaleRisk).toUpperCase()
          : MISSING_VALUE,
        valueColor:
          preflight.washSaleRisk === "unknown"
            ? CSS_COLOR.amber
            : CSS_COLOR.text,
      },
      ...(acknowledgements.length
        ? [
            {
              label: "ACKS",
              value: String(acknowledgements.length),
              valueColor: CSS_COLOR.amber,
            },
          ]
        : []),
    ];
  };
  const buildTaxSubmissionFields = (preflight) => ({
    taxPreflightToken:
      typeof preflight?.preflightToken === "string"
        ? preflight.preflightToken
        : null,
    taxAcknowledgements: Array.isArray(preflight?.requiredAcknowledgements)
      ? preflight.requiredAcknowledgements
      : [],
  });
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
    !executionIsShadow &&
    !liveUsesIbkr &&
    !liveUsesSnapTrade &&
    !liveUsesRobinhood &&
    !liveUsesSchwab &&
    !liveUsesBrokerOption &&
    (attachStopLoss || attachTakeProfit);
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
  const attachedExitTogglesDisabled =
    executionIsShadow ||
    liveUsesIbkr ||
    liveUsesSnapTrade ||
    liveUsesRobinhood ||
    liveUsesSchwab ||
    liveUsesBrokerOption;
  const stopLossExitDisabled =
    attachedExitTogglesDisabled || !attachStopLoss;
  const takeProfitExitDisabled =
    attachedExitTogglesDisabled || !attachTakeProfit;
  const restoreAutomationPlan = () => {
    if (!automationTicketContext) {
      return;
    }
    setSide("BUY");
    setOptionAction("buy_to_open");
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
    if ((ticketIsOptions || liveUsesIbkr) && !Number.isInteger(qtyNum)) {
      toast.push({
        kind: "error",
        title: "Whole quantity required",
        body: `Enter a positive whole number of ${ticketQuantityUnit}.`,
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
    if (optionActionBlocked) {
      toast.push({
        kind: "warn",
        title: "Option action blocked",
        body: optionActionAvailability.reason,
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
    if (liveUsesDirectBroker && directBrokerReconciliationLock) {
      toast.push({
        kind: "warn",
        title: "Broker outcome unknown",
        body: "Reconcile the prior submission with the broker before sending or previewing another order.",
      });
      return;
    }

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

    if (liveUsesBrokerOption) {
      if (!directOptionCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: `Refresh the app session before previewing a ${formatEnumLabel(optionBroker)} option order.`,
        });
        return;
      }
      if (
        !directOptionAccount?.id ||
        !brokerOptionOrderDraft.ready ||
        !brokerOptionOrderDraft.body
      ) {
        toast.push({
          kind: "warn",
          title: `${formatEnumLabel(optionBroker)} option preview blocked`,
          body: brokerOptionDraftBlockMessage,
        });
        return;
      }

      try {
        const preview = await brokerOptionReviewMutation.mutateAsync({
          broker: optionBroker,
          accountId: directOptionAccount.id,
          csrfToken: directOptionCsrfToken,
          body: brokerOptionOrderDraft.body,
        });
        const previewOrder = preview?.order || brokerOptionOrderDraft.body;
        const previewPrice =
          previewOrder?.limitPrice ??
          previewOrder?.price ??
          preview?.review?.quote?.markPrice ??
          (Number.isFinite(ticketEntryReferencePrice)
            ? ticketEntryReferencePrice
            : null);
        const estimatedValue = Number.isFinite(
          preview?.review?.estimate?.premium,
        )
          ? preview.review.estimate.premium
          : Number.isFinite(preview?.impact?.estimatedCashChange)
            ? Math.abs(preview.impact.estimatedCashChange)
            : Number.isFinite(previewPrice)
              ? previewPrice * qtyNum * 100
              : null;
        setPreviewSnapshot({
          ...preview,
          provider: optionBroker,
          assetClass: "option",
          directBroker: true,
          accountId: preview?.account?.id || directOptionAccount.id,
          resolvedContractId:
            previewOrder?.optionId ||
            previewOrder?.occSymbol ||
            `${optionBroker.toUpperCase()} OPTION`,
          symbol:
            previewOrder?.chainSymbol ||
            previewOrder?.underlyingSymbol ||
            slot.ticker,
          fillPrice: previewPrice,
          orderPayload: {
            route: optionBroker.toUpperCase(),
            ...previewOrder,
          },
          brokerReview: {
            estimatedValue,
            estimatedFee:
              preview?.review?.estimate?.totalFee ??
              preview?.impact?.estimatedFeeTotal ??
              null,
            collateralAmount:
              preview?.review?.estimate?.collateralAmount ?? null,
            alerts: preview?.review?.alerts || [],
            marketDataDisclosure:
              preview?.review?.marketDataDisclosure || null,
            previewAccepted: optionBroker === "schwab",
          },
        });
        toast.push({
          kind: "success",
          title: `${formatEnumLabel(optionBroker)} option preview ready`,
          body: [
            previewOrder?.action ||
              previewOrder?.instruction ||
              `${previewOrder?.side || side} ${previewOrder?.positionEffect || ""}`,
            previewOrder?.quantity ?? previewOrder?.units ?? qtyNum,
            previewOrder?.chainSymbol || previewOrder?.underlyingSymbol || slot.ticker,
            directOptionExecutionAccountLabel,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      } catch (error) {
        toast.push({
          kind: "error",
          title: `${formatEnumLabel(optionBroker)} option preview failed`,
          body:
            error?.message ||
            `${formatEnumLabel(optionBroker)} could not review this option order.`,
        });
      }
      return;
    }

    if (liveUsesRobinhood) {
      if (!robinhoodCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before previewing a Robinhood order.",
        });
        return;
      }
      if (
        !robinhoodAccount?.id ||
        !robinhoodOrderDraft.ready ||
        !robinhoodOrderDraft.body
      ) {
        toast.push({
          kind: "warn",
          title: "Robinhood preview blocked",
          body: robinhoodDraftBlockMessage,
        });
        return;
      }

      try {
        const preview = await robinhoodImpactMutation.mutateAsync({
          accountId: robinhoodAccount.id,
          csrfToken: robinhoodCsrfToken,
          body: robinhoodOrderDraft.body,
        });
        const previewPrice =
          preview?.order?.limitPrice ??
          (side === "BUY"
            ? preview?.review?.askPrice
            : preview?.review?.bidPrice) ??
          preview?.review?.lastTradePrice ??
          null;
        const estimatedValue = Number.isFinite(preview?.order?.notionalValue)
          ? preview.order.notionalValue
          : Number.isFinite(previewPrice) &&
              Number.isFinite(preview?.order?.quantity)
            ? previewPrice * preview.order.quantity
            : null;
        setPreviewSnapshot({
          ...preview,
          provider: "robinhood",
          accountId: preview?.account?.id || robinhoodAccount.id,
          resolvedContractId: "ROBINHOOD",
          symbol: preview?.order?.symbol || slot.ticker,
          fillPrice: previewPrice,
          orderPayload: {
            route: "ROBINHOOD",
            ...preview?.order,
          },
          estimatedValue,
        });
        toast.push({
          kind: "success",
          title: "Robinhood preview ready",
          body: [
            preview?.order?.side,
            preview?.order?.quantity,
            preview?.order?.symbol,
            robinhoodExecutionAccountLabel,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      } catch (error) {
        toast.push({
          kind: "error",
          title: "Robinhood preview failed",
          body:
            error?.message ||
            "Robinhood could not review this equity order.",
        });
      }
      return;
    }

    if (liveUsesSchwab) {
      if (!schwabCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before previewing a Schwab order.",
        });
        return;
      }
      if (
        !schwabAccount?.id ||
        !schwabEquityOrderDraft.ready ||
        !schwabEquityOrderDraft.body
      ) {
        toast.push({
          kind: "warn",
          title: "Schwab preview blocked",
          body: schwabEquityDraftBlockMessage,
        });
        return;
      }

      try {
        const preview = await schwabEquityPreviewMutation.mutateAsync({
          accountId: schwabAccount.id,
          csrfToken: schwabCsrfToken,
          body: schwabEquityOrderDraft.body,
        });
        setPreviewSnapshot({
          ...preview,
          provider: "schwab",
          assetClass: "equity",
          directBroker: true,
          accountId: preview?.account?.id || schwabAccount.id,
          resolvedContractId: "SCHWAB PREVIEW",
          symbol: slot.ticker,
          fillPrice,
          orderPayload: {
            route: "SCHWAB",
            ...schwabEquityOrderDraft.body,
          },
          brokerReview: {
            estimatedValue: cost,
            estimatedFee: null,
            collateralAmount: null,
            alerts: [],
            marketDataDisclosure: null,
            previewAccepted: true,
          },
        });
        toast.push({
          kind: "success",
          title: "Schwab preview ready",
          body: [side, qtyNum, slot.ticker, schwabExecutionAccountLabel]
            .filter(Boolean)
            .join(" · "),
        });
      } catch (error) {
        toast.push({
          kind: "error",
          title: "Schwab preview failed",
          body: error?.message || "Schwab could not preview this equity order.",
        });
      }
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
      if (!liveUsesIbkr) {
        toast.push({
          kind: "info",
          title: "IBKR required",
          body: "Local preview simulation has been removed. Connect IBKR Client Portal to preview a live order.",
        });
        return;
      }
    }

    if (!ibkrOrderAccountId) {
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

  function openIbkrWarning({
    challenge,
    taxPreflightToken,
    operation,
    nextLimitPrice = null,
  }) {
    const warningOrder =
      operation === "replace" ? trackedIbkrOrder : orderRequest;
    setLiveConfirmError(null);
    setLiveConfirmState({
      kind: "ibkr_warning",
      title: "IBKR warning requires a decision",
      detail:
        operation === "replace"
          ? "Accept to transmit the price change. Declining leaves the original order live."
          : "Accept to transmit this live order. Declining stops this order submission.",
      confirmLabel: "ACCEPT WARNING",
      cancelLabel: "DECLINE ORDER",
      confirmTone: CSS_COLOR.amber,
      lines: [
        {
          label: "ACCOUNT",
          value: selectedIbkrAccount?.maskedAccountId || MISSING_VALUE,
        },
        { label: "SYMBOL", value: trackedIbkrOrder?.symbol || slot.ticker },
        { label: "SIDE / SIZE", value: formatIbkrOrderSideSize(warningOrder) },
        {
          label:
            operation === "replace"
              ? "NEW LIMIT"
              : orderRequest?.type === "market"
                ? "TYPE"
                : "LIMIT",
          value:
            operation !== "replace" && orderRequest?.type === "market"
              ? "MARKET"
              : formatTicketMoney(
                  operation === "replace"
                    ? nextLimitPrice
                    : trackedIbkrOrder?.limitPrice || orderRequest?.limitPrice,
                ),
        },
        ...(challenge.messages || []).map((message, index) => ({
          label: `WARNING ${index + 1}`,
          value: message,
          valueColor: CSS_COLOR.amber,
        })),
      ],
      onConfirm: () =>
        continueIbkrWarning({
          challenge,
          taxPreflightToken,
          operation,
          nextLimitPrice,
          confirmed: true,
        }),
      onCancel: () =>
        continueIbkrWarning({
          challenge,
          taxPreflightToken,
          operation,
          nextLimitPrice,
          confirmed: false,
        }),
    });
  }

  async function continueIbkrWarning({
    challenge,
    taxPreflightToken,
    operation,
    nextLimitPrice,
    confirmed,
  }) {
    let result;
    try {
      result = await continueIbkrOrderReplyMutation.mutateAsync({
        data: {
          taxPreflightToken,
          challengeId: challenge.challengeId,
          confirmed,
        },
      });
    } catch (error) {
      if (isIbkrOrderRejected(error)) {
        setLiveConfirmState(null);
        if (operation === "place") {
          setPreviewSnapshot(null);
        }
        toast.push({
          kind: "error",
          title:
            operation === "replace"
              ? "Price change rejected"
              : "Order rejected",
          body:
            error?.message ||
            "IBKR definitively rejected the instruction; no reconciliation is required.",
        });
        return;
      }
      setActiveIbkrOrder((current) => ({
        ...(current || orderRequest || {}),
        status: current?.status || "unknown",
        reconciliationRequired: true,
      }));
      setLiveConfirmState(null);
      toast.push({
        kind: "warn",
        title: "STOP / RECONCILE",
        body: "The warning-reply outcome is unknown. Check the broker order before any further action.",
      });
      return;
    }
    if (result.status === "warning") {
      openIbkrWarning({
        challenge: result,
        taxPreflightToken,
        operation: result.operation || operation,
        nextLimitPrice,
      });
      return;
    }
    if (result.status === "declined") {
      setLiveConfirmState(null);
      if (operation === "replace") {
        setIbkrReplacementLocked(false);
      } else {
        setIbkrSubmitLocked(false);
        setPreviewSnapshot(null);
      }
      toast.push({
        kind: operation === "replace" ? "warn" : "info",
        title: operation === "replace" ? "Price change declined" : "Order declined",
        body:
          operation === "replace"
            ? "The original IBKR order remains live."
            : "The live order was not transmitted after the warning.",
      });
      return;
    }

    const reconciliationRequired = ibkrLifecycleRequiresReconciliation(
      operation,
      result,
    );
    setActiveIbkrOrder((current) => ({
      ...(current || orderRequest || {}),
      id: result.orderId || current?.id,
      status: String(result.orderStatus || "submitted").toLowerCase(),
      placementConfirmed: result.placementConfirmed,
      replacementConfirmed: result.replacementConfirmed,
      reconciliationRequired,
      ...(operation === "replace" ? { limitPrice: nextLimitPrice } : {}),
    }));
    setLiveConfirmState(null);
    void queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    toast.push({
      kind: reconciliationRequired ? "warn" : "success",
      title: reconciliationRequired
        ? "STOP / RECONCILE"
        : operation === "replace"
          ? "Price change acknowledged"
          : "Order acknowledged",
      body: reconciliationRequired
        ? "IBKR acknowledged the request, but order status still requires reconciliation."
        : `IBKR reports ${String(result.orderStatus || "submitted").toUpperCase()}.`,
    });
  }

  const submitLiveBrokerOrder = async (taxPreflight = taxPreflightState) => {
    const taxSubmissionFields = buildTaxSubmissionFields(taxPreflight);
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

      return submitSnapTradeOrderMutation.mutateAsync({
        accountId: snapTradeAccount.id,
        data: {
          ...snapTradeOrderDraft.body,
          ...taxSubmissionFields,
        },
      });
    }

    if (liveUsesRobinhood) {
      if (
        !robinhoodCsrfToken ||
        !robinhoodAccount?.id ||
        !robinhoodOrderDraft.ready ||
        !robinhoodOrderDraft.body
      ) {
        throw new Error(robinhoodDraftBlockMessage);
      }
      const result = await submitRobinhoodOrderMutation.mutateAsync({
        accountId: robinhoodAccount.id,
        csrfToken: robinhoodCsrfToken,
        body: {
          ...robinhoodOrderDraft.body,
          ...taxSubmissionFields,
        },
      });
      const reconciliationRequired = result?.reconcileRequired === true;
      setPreviewSnapshot((current) => ({
        ...(current?.provider === "robinhood" ? current : {}),
        ...result,
        provider: "robinhood",
        accountId: result?.account?.id || robinhoodAccount.id,
        resolvedContractId:
          result?.order?.brokerageOrderId || "ROBINHOOD SUBMITTED",
        symbol: result?.order?.symbol || slot.ticker,
        fillPrice:
          current?.provider === "robinhood"
            ? current.fillPrice
            : result?.order?.limitPrice ?? result?.order?.stopPrice ?? null,
        orderPayload: {
          route: "ROBINHOOD",
          ...result?.order,
        },
      }));
      toast.push({
        kind: reconciliationRequired ? "warn" : "success",
        title: reconciliationRequired
          ? "Submitted; reconciliation required"
          : `Submitted ${ticketInstrumentLabel}`,
        body: [
          result?.order?.side,
          result?.order?.quantity,
          result?.order?.symbol,
          result?.order?.state,
          result?.order?.brokerageOrderId,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      return result;
    }

    if (liveUsesSchwab) {
      if (
        !schwabCsrfToken ||
        !schwabAccount?.id ||
        !schwabEquityOrderDraft.ready ||
        !schwabEquityOrderDraft.body
      ) {
        throw new Error(schwabEquityDraftBlockMessage);
      }
      const result = await submitSchwabEquityOrderMutation.mutateAsync({
        accountId: schwabAccount.id,
        csrfToken: schwabCsrfToken,
        body: {
          ...schwabEquityOrderDraft.body,
          ...taxSubmissionFields,
        },
      });
      const reconciliationRequired = result?.reconcileRequired === true;
      setPreviewSnapshot((current) => ({
        ...(current?.provider === "schwab" && current?.assetClass === "equity"
          ? current
          : {}),
        ...result,
        provider: "schwab",
        assetClass: "equity",
        directBroker: true,
        accountId: result?.account?.id || schwabAccount.id,
        resolvedContractId: result?.orderId || "SCHWAB SUBMITTED",
        symbol: slot.ticker,
        fillPrice: current?.fillPrice ?? fillPrice,
        orderPayload: {
          route: "SCHWAB",
          ...schwabEquityOrderDraft.body,
          orderId: result?.orderId || null,
          status: result?.status || "submitted",
        },
      }));
      toast.push({
        kind: reconciliationRequired ? "warn" : "success",
        title: reconciliationRequired
          ? "Submitted; reconciliation required"
          : `Submitted ${ticketInstrumentLabel}`,
        body: [side, qtyNum, slot.ticker, result?.status, result?.orderId]
          .filter(Boolean)
          .join(" · "),
      });
      return result;
    }

    if (liveUsesBrokerOption) {
      if (
        !directOptionCsrfToken ||
        !directOptionAccount?.id ||
        !brokerOptionOrderDraft.ready ||
        !brokerOptionOrderDraft.body
      ) {
        throw new Error(brokerOptionDraftBlockMessage);
      }
      const result = await submitBrokerOptionMutation.mutateAsync({
        broker: optionBroker,
        accountId: directOptionAccount.id,
        csrfToken: directOptionCsrfToken,
        body: {
          ...brokerOptionOrderDraft.body,
          ...taxSubmissionFields,
        },
      });
      const reconciliationRequired = result?.reconcileRequired === true;
      const resultOrder = result?.order || brokerOptionOrderDraft.body;
      setPreviewSnapshot((current) => ({
        ...(current?.provider === optionBroker && current?.assetClass === "option"
          ? current
          : {}),
        ...result,
        provider: optionBroker,
        assetClass: "option",
        directBroker: true,
        accountId: result?.account?.id || directOptionAccount.id,
        resolvedContractId:
          resultOrder?.brokerageOrderId ||
          result?.orderId ||
          `${optionBroker.toUpperCase()} SUBMITTED`,
        symbol:
          resultOrder?.chainSymbol ||
          resultOrder?.underlyingSymbol ||
          slot.ticker,
        fillPrice:
          current?.provider === optionBroker && current?.assetClass === "option"
            ? current.fillPrice
            : resultOrder?.limitPrice ?? resultOrder?.price ?? fillPrice,
        orderPayload: {
          route: optionBroker.toUpperCase(),
          ...resultOrder,
          orderId: result?.orderId || null,
          status:
            resultOrder?.state ||
            resultOrder?.status ||
            result?.status ||
            "submitted",
        },
      }));
      toast.push({
        kind: reconciliationRequired ? "warn" : "success",
        title: reconciliationRequired
          ? "Submitted; reconciliation required"
          : `Submitted ${ticketInstrumentLabel}`,
        body: [
          resultOrder?.action || resultOrder?.instruction || resultOrder?.side,
          resultOrder?.quantity ?? resultOrder?.units,
          resultOrder?.chainSymbol || resultOrder?.underlyingSymbol || slot.ticker,
          resultOrder?.state || resultOrder?.status || result?.status,
          resultOrder?.brokerageOrderId || result?.orderId,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      return result;
    }

    if (!orderRequest) {
      toast.push({
        kind: "error",
        title: "Order unavailable",
        body: "The broker order payload is not ready yet.",
      });
      return;
    }

    if (liveUsesIbkr) {
      if (ibkrSubmitLocked) {
        throw new Error(
          "This prepared IBKR order has already been submitted. Reconcile it before another attempt.",
        );
      }
      if (
        !previewSnapshot?.clientOrderId ||
        !previewSnapshot?.orderFingerprint ||
        !previewSnapshot?.taxPreflight?.preflightToken
      ) {
        throw new Error("Run a fresh IBKR what-if preview before submitting.");
      }

      setIbkrSubmitLocked(true);
      try {
        await placeOrderMutation.mutateAsync({
          data: buildPreparedIbkrOrderSubmission(
            orderRequest,
            previewSnapshot,
          ),
        });
      } catch (error) {
        const challenge = readIbkrOrderWarning(error);
        if (!challenge) {
          if (isIbkrOrderRejected(error)) {
            setPreviewSnapshot(null);
          } else if (isIbkrOrderReconciliationError(error)) {
            setActiveIbkrOrder((current) => ({
              ...(current || orderRequest || {}),
              status: current?.status || "unknown",
              reconciliationRequired: true,
            }));
          } else {
            setPreviewSnapshot(null);
          }
          throw error;
        }
        openIbkrWarning({
          challenge,
          taxPreflightToken: previewSnapshot.taxPreflight.preflightToken,
          operation: "place",
        });
      }
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
          ...taxSubmissionFields,
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
        ...taxSubmissionFields,
      },
    });
  };

  const submitOrder = async () => {
    if (liveUsesDirectBroker && directBrokerReconciliationLock) {
      toast.push({
        kind: "warn",
        title: "Broker outcome unknown",
        body: "Reconcile the prior submission with the broker before sending or previewing another order.",
      });
      return;
    }

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
      if (snapTradeAuthEnabled && authSession.isLoading) {
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

      const taxPreflight = await runTaxPreflight("snaptrade", snapTradeAccount.id);
      if (!taxPreflight || taxPreflight.action === "block") {
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
          ...buildTaxPreflightConfirmLines(taxPreflight),
        ],
        onConfirm: () => submitLiveBrokerOrder(taxPreflight),
      });
      return;
    }

    if (liveUsesRobinhood) {
      if (!robinhoodAccountReady || !robinhoodAccount?.id) {
        toast.push({
          kind: "warn",
          title: "Robinhood account required",
          body: "Connect and sync an execution-ready Robinhood Agentic account in Settings before submitting shares.",
        });
        return;
      }
      if (authSession.isLoading) {
        toast.push({
          kind: "info",
          title: "Auth session loading",
          body: "Wait for the app session token before submitting a Robinhood order.",
        });
        return;
      }
      if (!robinhoodCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before submitting a Robinhood order.",
        });
        return;
      }
      if (!robinhoodOrderDraft.ready || !robinhoodOrderDraft.body) {
        toast.push({
          kind: "warn",
          title: "Robinhood order blocked",
          body: robinhoodDraftBlockMessage,
        });
        return;
      }

      const taxPreflight = await runTaxPreflight(
        "robinhood",
        robinhoodAccount.id,
      );
      if (!taxPreflight || taxPreflight.action === "block") {
        return;
      }

      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `${ticketActionLabel} ${ticketInstrumentLabel}`,
        detail: `Submit this live Robinhood equity order through ${robinhoodExecutionAccountLabel}.`,
        confirmLabel: `${ticketActionLabel} ROBINHOOD ORDER`,
        confirmTone: selectedSideColor,
        lines: [
          { label: "ACCOUNT", value: robinhoodExecutionAccountLabel },
          { label: "SYMBOL", value: slot.ticker },
          { label: "ROUTE", value: "ROBINHOOD" },
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
          ...buildTaxPreflightConfirmLines(taxPreflight),
        ],
        onConfirm: () => submitLiveBrokerOrder(taxPreflight),
      });
      return;
    }

    if (liveUsesSchwab) {
      if (!schwabAccountReady || !schwabAccount?.id) {
        toast.push({
          kind: "warn",
          title: "Schwab account required",
          body: "Connect and sync an execution-ready Schwab account in Settings before submitting shares.",
        });
        return;
      }
      if (authSession.isLoading) {
        toast.push({
          kind: "info",
          title: "Auth session loading",
          body: "Wait for the app session token before submitting a Schwab order.",
        });
        return;
      }
      if (!schwabCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: "Refresh the app session before submitting a Schwab order.",
        });
        return;
      }
      if (!schwabEquityOrderDraft.ready || !schwabEquityOrderDraft.body) {
        toast.push({
          kind: "warn",
          title: "Schwab order blocked",
          body: schwabEquityDraftBlockMessage,
        });
        return;
      }

      const taxPreflight = await runTaxPreflight("schwab", schwabAccount.id);
      if (!taxPreflight || taxPreflight.action === "block") {
        return;
      }

      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `${ticketActionLabel} ${ticketInstrumentLabel}`,
        detail: `Submit this live Schwab equity order through ${schwabExecutionAccountLabel}.`,
        confirmLabel: `${ticketActionLabel} SCHWAB ORDER`,
        confirmTone: selectedSideColor,
        lines: [
          { label: "ACCOUNT", value: schwabExecutionAccountLabel },
          { label: "SYMBOL", value: slot.ticker },
          { label: "ROUTE", value: "SCHWAB" },
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
          ...buildTaxPreflightConfirmLines(taxPreflight),
        ],
        onConfirm: () => submitLiveBrokerOrder(taxPreflight),
      });
      return;
    }

    if (liveUsesBrokerOption) {
      if (!directOptionAccountReady || !directOptionAccount?.id) {
        toast.push({
          kind: "warn",
          title: `${formatEnumLabel(optionBroker)} account required`,
          body: `Sync an execution-ready ${formatEnumLabel(optionBroker)} account in Settings before submitting options.`,
        });
        return;
      }
      if (authSession.isLoading) {
        toast.push({
          kind: "info",
          title: "Auth session loading",
          body: `Wait for the app session token before submitting a ${formatEnumLabel(optionBroker)} option order.`,
        });
        return;
      }
      if (!directOptionCsrfToken) {
        toast.push({
          kind: "warn",
          title: "Auth session required",
          body: `Refresh the app session before submitting a ${formatEnumLabel(optionBroker)} option order.`,
        });
        return;
      }
      if (!brokerOptionOrderDraft.ready || !brokerOptionOrderDraft.body) {
        toast.push({
          kind: "warn",
          title: `${formatEnumLabel(optionBroker)} option order blocked`,
          body: brokerOptionDraftBlockMessage,
        });
        return;
      }

      const taxPreflight = await runTaxPreflight(
        optionBroker,
        directOptionAccount.id,
      );
      if (!taxPreflight || taxPreflight.action === "block") {
        return;
      }

      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `${ticketActionLabel} ${ticketInstrumentLabel}`,
        detail: `Submit this live ${formatEnumLabel(optionBroker)} option order through ${directOptionExecutionAccountLabel}.`,
        confirmLabel: `${ticketActionLabel} ${optionBroker.toUpperCase()} ORDER`,
        confirmTone: selectedSideColor,
        lines: [
          { label: "ACCOUNT", value: directOptionExecutionAccountLabel },
          { label: "SYMBOL", value: slot.ticker },
          { label: "CONTRACT", value: ticketOptionContractShortLabel },
          { label: "ROUTE", value: optionBroker.toUpperCase() },
          { label: "TYPE", value: orderTypeLabel },
          { label: "TIF", value: tif },
          {
            label: "QTY",
            value: `${qtyNum || 0} ${ticketQuantityUnit.toUpperCase()}`,
          },
          {
            label: orderType === "MKT" ? "MARK" : "LIMIT",
            value: fillPriceDisplay,
          },
          {
            label: isLong ? "EST COST" : "EST CREDIT",
            value: costDisplay,
            valueColor: isLong ? CSS_COLOR.red : CSS_COLOR.green,
          },
          ...buildTaxPreflightConfirmLines(taxPreflight),
        ],
        onConfirm: () => submitLiveBrokerOrder(taxPreflight),
      });
      return;
    }

    await submitIbkrLiveOrderAfterGate({
      brokerConfigured: liveUsesIbkr
        ? ibkrLiveReadinessReady
        : brokerConfigured,
      gatewayTradingBlocked: liveUsesIbkr ? false : gatewayTradingBlocked,
      gatewayTradingMessage,
      accountId: ibkrOrderAccountId,
      liveOrderPayloadReady,
      orderRequest,
      ticketIsShares,
      toast,
      submit: async () => {
        const taxPreflight = liveUsesIbkr
          ? previewSnapshot?.taxPreflight || null
          : await runTaxPreflight("ibkr", ibkrOrderAccountId);
        if (!taxPreflight || taxPreflight.action === "block") {
          if (liveUsesIbkr && !previewSnapshot) {
            toast.push({
              kind: "warn",
              title: "Fresh preview required",
              body: "Run the IBKR what-if preview before submitting this live order.",
            });
          }
          return;
        }
        const taxRequiresAcknowledgement =
          taxPreflight.action === "warn_ack_required";

        setLiveConfirmError(null);
        if (
          !liveUsesIbkr &&
          !confirmBrokerOrders &&
          environment !== "live" &&
          !taxRequiresAcknowledgement
        ) {
          void submitLiveBrokerOrder(taxPreflight);
          return;
        }

        setLiveConfirmState({
          title: `${ticketActionLabel} ${ticketInstrumentLabel}`,
          detail: hasAttachedExits
            ? `Submit this ${environment.toUpperCase()} IBKR parent order with ${attachedExitCount} attached exit order${attachedExitCount === 1 ? "" : "s"}.`
            : `Submit this ${liveUsesIbkr ? "LIVE" : environment.toUpperCase()} broker order to Interactive Brokers for immediate routing.`,
          confirmLabel: hasAttachedExits
            ? `${ticketActionLabel} IBKR + ${attachedExitLabel}`
            : `${ticketActionLabel} IBKR ORDER`,
          confirmTone: selectedSideColor,
          lines: [
            {
              label: "ACCOUNT",
              value: liveUsesIbkr
                ? selectedIbkrAccount?.maskedAccountId || MISSING_VALUE
                : inheritedIbkrAccount?.maskedAccountId || "IBKR account",
            },
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
                    ? "TYPE"
                    : "LIMIT",
              value:
                orderType === "STP_LMT"
                  ? stopLimitPriceDisplay
                  : orderType === "MKT"
                    ? "MARKET"
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
            ...(ticketIsOptions && optionOrderIntent
              ? [
                  {
                    label: "ACTION",
                    value: `${optionOrderIntent.abbreviation} · ${optionOrderIntent.intentLabel}`,
                  },
                ]
              : []),
            ...buildTaxPreflightConfirmLines(taxPreflight),
            {
              label: isLong ? "EST COST" : "EST CREDIT",
              value: costDisplay,
              valueColor: isLong ? CSS_COLOR.red : CSS_COLOR.green,
            },
          ],
          onConfirm: () => submitLiveBrokerOrder(taxPreflight),
        });
      },
    });
  };

  const submitPreparedIbkrReplacement = async (preview, nextLimitPrice) => {
    if (ibkrReplacementLocked) {
      throw new Error(
        "This prepared price change has already been sent. Reconcile it before another attempt.",
      );
    }
    setIbkrReplacementLocked(true);
    try {
      const order = await replaceOrderMutation.mutateAsync({
        orderId: trackedIbkrOrder.id,
        data: buildPreparedIbkrReplacementSubmission({
          accountId: selectedIbkrAccount.accountId,
          limitPrice: nextLimitPrice,
          preview,
        }),
      });
      const reconciliationRequired = ibkrLifecycleRequiresReconciliation(
        "replace",
        order,
      );
      setActiveIbkrOrder((current) => ({
        ...current,
        ...order,
        reconciliationRequired,
      }));
      void queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast.push({
        kind: reconciliationRequired ? "warn" : "success",
        title: reconciliationRequired
          ? "STOP / RECONCILE"
          : "Price change confirmed",
        body: `${order.symbol} · ${String(order.status).toUpperCase()} · ${formatTicketMoney(order.limitPrice)}`,
      });
    } catch (error) {
      const challenge = readIbkrOrderWarning(error);
      if (!challenge) {
        if (isIbkrOrderRejected(error)) {
          setLiveConfirmState(null);
          toast.push({
            kind: "error",
            title: "Price change rejected",
            body:
              error?.message ||
              "IBKR definitively rejected the price change; the original order remains live.",
          });
          return;
        }
        setActiveIbkrOrder((current) => ({
          ...current,
          reconciliationRequired: true,
        }));
        setLiveConfirmState(null);
        toast.push({
          kind: "warn",
          title: "STOP / RECONCILE",
          body: "The price-change outcome is unknown. Check the broker order before any further action.",
        });
        return;
      }
      openIbkrWarning({
        challenge,
        taxPreflightToken: preview.taxPreflight.preflightToken,
        operation: "replace",
        nextLimitPrice,
      });
    }
  };

  const previewIbkrReplacement = async () => {
    const nextLimitPrice = Number(replacementLimitPrice);
    if (
      !selectedIbkrAccount ||
      !trackedIbkrOrder?.id ||
      trackedIbkrOrderTerminal ||
      trackedIbkrOrderRequiresReconciliation ||
      ibkrReplacementLocked ||
      ibkrCancelAttempted ||
      Number(trackedIbkrOrder.filledQuantity || 0) > 0 ||
      !Number.isFinite(nextLimitPrice) ||
      nextLimitPrice <= 0
    ) {
      toast.push({
        kind: "warn",
        title: "Price change blocked",
        body: "A live, completely unfilled limit order and positive new price are required.",
      });
      return;
    }
    let preview;
    try {
      preview = await previewOrderReplacementMutation.mutateAsync({
        orderId: trackedIbkrOrder.id,
        data: buildPreparedIbkrReplacementPreview({
          accountId: selectedIbkrAccount.accountId,
          limitPrice: nextLimitPrice,
        }),
      });
    } catch (error) {
      const requiresReconciliation = isIbkrReplacementStateError(error);
      if (requiresReconciliation) {
        setActiveIbkrOrder((current) => ({
          ...current,
          reconciliationRequired: true,
        }));
      }
      toast.push({
        kind: requiresReconciliation ? "warn" : "error",
        title: requiresReconciliation
          ? "STOP / RECONCILE"
          : "Price-change preview unavailable",
        body:
          error?.message ||
          "IBKR could not prepare the price-only replacement.",
      });
      return;
    }
    setLiveConfirmError(null);
    setLiveConfirmState({
      title: `Change ${trackedIbkrOrder.symbol} limit price`,
      detail:
        "Submit this prepared price-only change to the existing live IBKR order.",
      confirmLabel: "CHANGE LIVE LIMIT",
      confirmTone: CSS_COLOR.amber,
      lines: [
        { label: "ACCOUNT", value: selectedIbkrAccount.maskedAccountId },
        { label: "FROM", value: formatTicketMoney(trackedIbkrOrder.limitPrice) },
        { label: "TO", value: formatTicketMoney(nextLimitPrice) },
        {
          label: "WHAT-IF COMM",
          value: preview.whatIf?.commission || MISSING_VALUE,
        },
        ...buildTaxPreflightConfirmLines(preview.taxPreflight),
      ],
      onConfirm: () =>
        submitPreparedIbkrReplacement(preview, nextLimitPrice),
    });
  };

  const confirmIbkrCancellation = () => {
    if (
      !selectedIbkrAccount ||
      !trackedIbkrOrder?.id ||
      trackedIbkrOrderTerminal ||
      trackedIbkrOrderRequiresReconciliation ||
      ibkrCancelAttempted ||
      ibkrLifecyclePending ||
      ibkrWarningDecisionOpen
    ) {
      return;
    }
    setLiveConfirmError(null);
    setLiveConfirmState({
      title: `Cancel ${trackedIbkrOrder.symbol} live order`,
      detail:
        "Send one cancellation request and wait for IBKR to confirm terminal cancellation.",
      confirmLabel: "CANCEL LIVE ORDER",
      confirmTone: CSS_COLOR.red,
      lines: [
        { label: "ACCOUNT", value: selectedIbkrAccount.maskedAccountId },
        { label: "STATUS", value: trackedIbkrOrderStatus.toUpperCase() },
        { label: "FILLED", value: String(trackedIbkrOrder.filledQuantity || 0) },
      ],
      onConfirm: async () => {
        setIbkrCancelAttempted(true);
        try {
          const result = await cancelOrderMutation.mutateAsync({
            orderId: trackedIbkrOrder.id,
            data: {
              accountId: selectedIbkrAccount.accountId,
              mode: "live",
              confirm: true,
            },
          });
          setActiveIbkrOrder((current) => ({
            ...current,
            status: result.status,
            filledQuantity: result.filledQuantity,
            cancelConfirmed: result.cancelConfirmed,
            reconciliationRequired: ibkrLifecycleRequiresReconciliation(
              "cancel",
              result,
            ),
          }));
          void queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
          toast.push(ibkrCancelToast(result));
        } catch (error) {
          setActiveIbkrOrder((current) => ({
            ...current,
            reconciliationRequired: true,
          }));
          setLiveConfirmState(null);
          toast.push({
            kind: "warn",
            title: "STOP / RECONCILE",
            body:
              "The cancellation outcome is unknown. Check the broker order; this ticket will not send another cancellation.",
          });
        }
      },
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
  const qtyPresets = ticketIsShares
    ? [1, 10, 25, 50, 100]
    : [1, 3, 5, 10];
  const ibkrSubmitPending =
    placeOrderMutation.isPending ||
    submitOrdersMutation.isPending ||
    continueIbkrOrderReplyMutation.isPending;
  const taxPreflightPending = !executionIsShadow && taxPreflightMutation.isPending;
  const previewIsPending =
    previewOrderMutation.isPending ||
    previewShadowOrderMutation.isPending ||
    snapTradeImpactMutation.isPending ||
    robinhoodImpactMutation.isPending ||
    schwabEquityPreviewMutation.isPending ||
    brokerOptionReviewMutation.isPending;
  const directOptionAccountSyncPending =
    (optionBroker === "robinhood" && robinhoodSyncMutation.isPending) ||
    (optionBroker === "schwab" && schwabSyncMutation.isPending);
  const primarySubmitPending = executionIsShadow
    ? placeShadowOrderMutation.isPending
    : liveUsesSnapTrade
      ? submitSnapTradeOrderMutation.isPending ||
        Boolean(directBrokerReconciliationLock) ||
        taxPreflightPending
      : liveUsesRobinhood
        ? robinhoodSyncMutation.isPending ||
          submitRobinhoodOrderMutation.isPending ||
          Boolean(directBrokerReconciliationLock) ||
          taxPreflightPending
      : liveUsesSchwab
        ? schwabSyncMutation.isPending ||
          submitSchwabEquityOrderMutation.isPending ||
          Boolean(directBrokerReconciliationLock) ||
          taxPreflightPending
      : liveUsesBrokerOption
        ? directOptionAccountSyncPending ||
          submitBrokerOptionMutation.isPending ||
          Boolean(directBrokerReconciliationLock) ||
          taxPreflightPending
      : ibkrSubmitPending || taxPreflightPending;
  const optionActionSubmitBlocked = optionActionBlocked;
  const snapTradeAuthLoading =
    liveUsesSnapTrade &&
    snapTradeAccountReady &&
    (snapTradeAuthEnabled && authSession.isLoading);
  const robinhoodAuthLoading = liveUsesRobinhood && authSession.isLoading;
  const schwabAuthLoading = liveUsesSchwab && authSession.isLoading;
  const brokerOptionAuthLoading = liveUsesBrokerOption && authSession.isLoading;
  const readinessUsesDirectAccount =
    liveUsesRobinhood || liveUsesSchwab || liveUsesBrokerOption;
  const readinessDirectAccountReady = liveUsesRobinhood
    ? robinhoodAccountReady
    : liveUsesSchwab
      ? schwabAccountReady
      : directOptionAccountReady;
  const baseTicketReadinessModel = buildTicketReadinessModel({
    executionMode,
    brokerRoute: readinessUsesDirectAccount ? "snaptrade" : liveBrokerRoute,
    gatewayTradingReady: liveUsesIbkr ? true : gatewayTradingReady,
    brokerConfigured: liveUsesIbkr
      ? ibkrLiveReadinessReady
      : brokerConfigured,
    brokerAuthenticated: liveUsesIbkr
      ? ibkrLiveReadinessReady
      : brokerAuthenticated,
    accountId: liveUsesIbkr
      ? selectedIbkrAccount?.accountId || null
      : accountId,
    snapTradeExecutionReady: readinessUsesDirectAccount
      ? readinessDirectAccountReady
      : snapTradeAccountReady,
    snapTradeExecutionBlockers: readinessUsesDirectAccount
      ? [`${liveBrokerRoute} account`]
      : snapTradeAccount?.executionBlockers || [],
    ticketInstrumentReady,
    quoteReady: ticketIsShares ? equityQuoteReady : optionQuoteReady,
    spreadPct,
    previewPending: previewIsPending,
    submitPending: primarySubmitPending,
    sellCallBlocked: optionActionSubmitBlocked,
    shadowExposureWarning: shadowAddExposureWarningActive,
    automationDeviationCount: liveDeviationFields.length,
  });
  const ticketReadinessModel =
    readinessUsesDirectAccount &&
    baseTicketReadinessModel.detail === "SnapTrade route ready"
      ? {
          ...baseTicketReadinessModel,
          detail: `${formatEnumLabel(liveBrokerRoute)} route ready`,
        }
      : baseTicketReadinessModel;
  const primarySubmitDisabled = executionIsShadow
    ? placeShadowOrderMutation.isPending ||
      automationAlreadyShadowFilled ||
      optionActionSubmitBlocked
    : liveUsesSnapTrade
      ? submitSnapTradeOrderMutation.isPending ||
        Boolean(directBrokerReconciliationLock) ||
        taxPreflightPending ||
        snapTradeAuthLoading ||
        !snapTradeCsrfToken ||
        !snapTradeOrderDraft.ready ||
        optionActionSubmitBlocked
      : liveUsesRobinhood
        ? robinhoodSyncMutation.isPending ||
          submitRobinhoodOrderMutation.isPending ||
          Boolean(directBrokerReconciliationLock) ||
          taxPreflightPending ||
          robinhoodAuthLoading ||
          !robinhoodCsrfToken ||
          !robinhoodOrderDraft.ready ||
          optionActionSubmitBlocked
      : liveUsesSchwab
        ? schwabSyncMutation.isPending ||
          submitSchwabEquityOrderMutation.isPending ||
          Boolean(directBrokerReconciliationLock) ||
          taxPreflightPending ||
          schwabAuthLoading ||
          !schwabCsrfToken ||
          !schwabEquityOrderDraft.ready ||
          optionActionSubmitBlocked
      : liveUsesBrokerOption
        ? directOptionAccountSyncPending ||
          submitBrokerOptionMutation.isPending ||
          Boolean(directBrokerReconciliationLock) ||
          taxPreflightPending ||
          brokerOptionAuthLoading ||
          !directOptionCsrfToken ||
          !brokerOptionOrderDraft.ready ||
          optionActionSubmitBlocked
      : liveUsesIbkr
        ? ibkrSubmitPending ||
          !selectedIbkrAccount ||
          !ibkrLiveReadinessReady ||
          !previewSnapshot?.clientOrderId ||
          !previewSnapshot?.orderFingerprint ||
          !previewSnapshot?.taxPreflight?.preflightToken ||
          ibkrSubmitLocked
        : ibkrSubmitPending ||
        taxPreflightPending ||
        gatewayTradingBlocked ||
        optionActionSubmitBlocked;
  const previewDisabled =
    previewIsPending ||
    (liveUsesDirectBroker && Boolean(directBrokerReconciliationLock)) ||
    (liveUsesRobinhood &&
      (!robinhoodCsrfToken || !robinhoodOrderDraft.ready)) ||
    (liveUsesSchwab &&
      (!schwabCsrfToken || !schwabEquityOrderDraft.ready)) ||
    (liveUsesBrokerOption &&
      (!directOptionCsrfToken || !brokerOptionOrderDraft.ready)) ||
    (liveUsesIbkr &&
      (!selectedIbkrAccount ||
        !ibkrLiveReadinessReady ||
        (ibkrSubmitLocked &&
          ((Boolean(trackedIbkrOrder?.id) && !trackedIbkrOrderTerminal) ||
            trackedIbkrOrderRequiresReconciliation)))) ||
    optionActionSubmitBlocked;
  const primarySubmitColor = executionIsShadow ? CSS_COLOR.pink : selectedSideColor;
  const primarySubmitLabel = executionIsShadow
    ? placeShadowOrderMutation.isPending
      ? "FILLING..."
      : automationAlreadyShadowFilled
        ? "SHADOW FILLED"
        : optionActionSubmitBlocked
          ? "OPTION ACTION BLOCKED"
	        : shadowAddExposureWarningActive && !shadowExposureAcknowledged
	          ? "ADD EXPOSURE?"
	        : shadowAddExposureWarningActive
	            ? "CONFIRM ADD EXPOSURE"
	            : `${ticketActionLabel} SHADOW ${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} × ${fillPriceDisplay}`
    : liveUsesSnapTrade
      ? taxPreflightPending
        ? "CHECKING TAX..."
        : submitSnapTradeOrderMutation.isPending
        ? "SUBMITTING..."
        : directBrokerReconciliationLock
          ? "STOP / RECONCILE"
        : !snapTradeAccountReady
          ? "SNAPTRADE ACCOUNT REQUIRED"
          : snapTradeAuthLoading
            ? "AUTH LOADING..."
            : !snapTradeCsrfToken
              ? "AUTH SESSION REQUIRED"
              : !snapTradeOrderDraft.ready
                ? snapTradeDraftButtonLabel
                : `${ticketActionLabel} SNAPTRADE ${qtyNum || 0} sh × ${fillPriceDisplay} · ${signedCostDisplay}`
    : liveUsesRobinhood
      ? robinhoodSyncMutation.isPending
        ? "SYNCING ROBINHOOD..."
        : taxPreflightPending
          ? "CHECKING TAX..."
          : submitRobinhoodOrderMutation.isPending
            ? "SUBMITTING..."
            : directBrokerReconciliationLock
              ? "STOP / RECONCILE"
            : !robinhoodAccountReady
              ? "ROBINHOOD ACCOUNT REQUIRED"
              : robinhoodAuthLoading
                ? "AUTH LOADING..."
                : !robinhoodCsrfToken
                  ? "AUTH SESSION REQUIRED"
                  : !robinhoodOrderDraft.ready
                    ? robinhoodDraftButtonLabel
                    : `${ticketActionLabel} ROBINHOOD ${qtyNum || 0} sh × ${fillPriceDisplay} · ${signedCostDisplay}`
    : liveUsesSchwab
      ? schwabSyncMutation.isPending
        ? "SYNCING SCHWAB..."
        : taxPreflightPending
          ? "CHECKING TAX..."
          : submitSchwabEquityOrderMutation.isPending
            ? "SUBMITTING..."
            : directBrokerReconciliationLock
              ? "STOP / RECONCILE"
            : !schwabAccountReady
              ? "SCHWAB ACCOUNT REQUIRED"
              : schwabAuthLoading
                ? "AUTH LOADING..."
                : !schwabCsrfToken
                  ? "AUTH SESSION REQUIRED"
                  : !schwabEquityOrderDraft.ready
                    ? schwabEquityDraftButtonLabel
                    : `${ticketActionLabel} SCHWAB ${qtyNum || 0} sh × ${fillPriceDisplay} · ${signedCostDisplay}`
    : liveUsesBrokerOption
      ? directOptionAccountSyncPending
        ? `SYNCING ${optionBroker.toUpperCase()}...`
        : taxPreflightPending
          ? "CHECKING TAX..."
          : submitBrokerOptionMutation.isPending
            ? "SUBMITTING..."
            : directBrokerReconciliationLock
              ? "STOP / RECONCILE"
            : !directOptionAccountReady
              ? `${optionBroker.toUpperCase()} ACCOUNT REQUIRED`
              : brokerOptionAuthLoading
                ? "AUTH LOADING..."
                : !directOptionCsrfToken
                  ? "AUTH SESSION REQUIRED"
                  : !brokerOptionOrderDraft.ready
                    ? brokerOptionDraftButtonLabel
                    : `${ticketActionLabel} ${optionBroker.toUpperCase()} ${qtyNum || 0} ct × ${fillPriceDisplay} · ${signedCostDisplay}`
    : liveUsesIbkr
      ? !selectedIbkrAccount
          ? "SELECT IBKR ACCOUNT"
          : !ibkrLiveReadinessReady
            ? "IBKR LIVE NOT READY"
          : trackedIbkrOrderRequiresReconciliation
            ? "STOP / RECONCILE"
          : ibkrSubmitPending
            ? "SUBMITTING..."
            : !previewSnapshot?.clientOrderId
                ? "PREVIEW REQUIRED"
              : ibkrSubmitLocked
                ? trackedIbkrOrderTerminal
                  ? "PREVIEW NEXT ORDER"
                  : "ACTIVE ORDER LOCKED"
                : orderType === "MKT"
                  ? `${ticketActionLabel} IBKR ${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} · MARKET`
                  : `${ticketActionLabel} IBKR ${qtyNum || 0} ${ticketIsShares ? "sh" : "ct"} × ${fillPriceDisplay} · ${signedCostDisplay}`
    : gatewayTradingBlocked
      ? gatewayTradingBlockedLabel
      : taxPreflightPending
        ? "CHECKING TAX..."
      : ibkrSubmitPending
      ? "SUBMITTING..."
      : optionActionSubmitBlocked
        ? "OPTION ACTION BLOCKED"
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
  const robinhoodReviewSnapshot =
    previewSnapshot?.provider === "robinhood" && !previewSnapshot?.directBroker
      ? previewSnapshot.review
      : null;
  const robinhoodPlacementSnapshot =
    previewSnapshot?.provider === "robinhood" &&
    !previewSnapshot?.directBroker &&
    previewSnapshot.submittedAt
      ? previewSnapshot
      : null;
  const directBrokerReviewSnapshot = previewSnapshot?.directBroker
    ? previewSnapshot.brokerReview
    : null;
  const directBrokerPlacementSnapshot =
    previewSnapshot?.directBroker && previewSnapshot.submittedAt
      ? previewSnapshot
      : null;
  const directBrokerPlacementStatus =
    directBrokerPlacementSnapshot?.order?.state ||
    directBrokerPlacementSnapshot?.order?.status ||
    directBrokerPlacementSnapshot?.status ||
    previewDisplayOrder?.status ||
    "SUBMITTED";
  const robinhoodEstimateIsCredit =
    String(previewDisplayOrder?.side || side).toUpperCase() === "SELL";
  const optionActionStatusColor = optionActionSubmitBlocked
    ? CSS_COLOR.amber
    : selectedSideColor;

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
      {!executionIsShadow ? (
        <TaxComplianceStrip
          state={taxPreflightState}
          pending={taxPreflightMutation.isPending}
        />
      ) : null}
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
        {ticketIsOptions ? (
          <div
            role="group"
            aria-label="Option action"
            data-testid="trade-ticket-option-actions"
            style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: sp(2) }}
          >
            {optionActionChoices.map((choice) => {
              const selected = choice.action === optionAction;
              const tone = choice.side === "BUY" ? TRADE_BUY_TONE : TRADE_SELL_TONE;
              const enabled = choice.availability?.enabled === true;
              return (
                <button
                  key={choice.action}
                  type="button"
                  aria-label={choice.actionLabel}
                  aria-pressed={selected}
                  disabled={!enabled}
                  title={enabled ? choice.actionLabel : choice.availability?.reason}
                  onClick={() => selectOptionOrderAction(choice.action)}
                  style={{
                    minWidth: 0,
                    padding: sp("4px 2px"),
                    background: selected ? tone : "transparent",
                    border: `1px solid ${selected ? tone : CSS_COLOR.border}`,
                    borderRadius: dim(RADII.xs),
                    color: selected ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                    fontSize: fs(8),
                    fontFamily: T.sans,
                    fontWeight: FONT_WEIGHTS.regular,
                    lineHeight: 1.15,
                    cursor: enabled ? "pointer" : "not-allowed",
                    opacity: enabled || selected ? 1 : 0.4,
                  }}
                >
                  {choice.abbreviation}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: sp(2) }}>
            <button
              type="button"
              onClick={() => selectSide("BUY")}
              style={{
                flex: 1,
                padding: sp("4px 0"),
                background: isLong ? TRADE_BUY_TONE : "transparent",
                border: `1px solid ${isLong ? TRADE_BUY_TONE : CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                color: isLong ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                fontSize: fs(10),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.regular,
                lineHeight: 1.15,
                cursor: "pointer",
              }}
            >
              BUY
            </button>
            <button
              type="button"
              onClick={() => selectSide("SELL")}
              style={{
                flex: 1,
                padding: sp("4px 0"),
                background: !isLong ? TRADE_SELL_TONE : "transparent",
                border: `1px solid ${!isLong ? TRADE_SELL_TONE : CSS_COLOR.border}`,
                borderRadius: dim(RADII.xs),
                color: !isLong ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                fontSize: fs(10),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.regular,
                lineHeight: 1.15,
                cursor: "pointer",
              }}
            >
              SELL
            </button>
          </div>
        )}
        <SegmentedControl
          ariaLabel="Order type"
          options={ticketTypeOptions.map(([value, label]) => ({ value, label }))}
          value={orderType}
          onChange={setOrderType}
        />
      </div>
      {ticketIsOptions && optionOrderIntent ? (
        <div
          data-testid="trade-ticket-option-intent"
          style={{
            border: `1px solid ${cssColorAlpha(optionActionStatusColor, "55")}`,
            background: cssColorAlpha(optionActionStatusColor, "12"),
            borderRadius: dim(RADII.xs),
            padding: sp("6px 7px"),
            display: "grid",
            gap: sp(3),
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
                color: optionActionStatusColor,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.regular,
              }}
            >
              {optionOrderIntent.intentLabel}
            </span>
            <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular }}>
              {optionOrderIntent.abbreviation} · {optionOrderIntent.positionEffect.toUpperCase()}
            </span>
          </div>
          <div
            style={{
              color: optionActionStatusColor,
              fontSize: textSize("caption"),
              lineHeight: 1.35,
            }}
          >
            {optionActionSubmitBlocked
              ? optionActionAvailability.reason
              : optionOrderIntent.detail}
          </div>
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
              type="button"
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
            step={ticketIsOptions || liveUsesIbkr ? "1" : "any"}
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
        options={ticketTimeInForceOptions}
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
            <span style={{ color: CSS_COLOR.textMuted }}>
              {robinhoodPlacementSnapshot || directBrokerPlacementSnapshot
                ? "PLACED"
                : "PREVIEW"}
            </span>{" "}
            <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>
              {liveUsesIbkr
                ? selectedIbkrAccount?.maskedAccountId || "IBKR account"
                : ticketIsOptions && optionBroker === "ibkr"
                  ? inheritedIbkrAccount?.maskedAccountId || "IBKR account"
                  : previewSnapshot.accountId}
            </span>
          </div>
          <div>
            <span style={{ color: CSS_COLOR.textMuted }}>
              {previewSnapshot.provider === "robinhood" ||
              previewSnapshot.directBroker
                ? "ORDER"
                : "CONID"}
            </span>{" "}
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
          {liveUsesIbkr && previewSnapshot.whatIf ? (
            <>
              <div>
                <span style={{ color: CSS_COLOR.textMuted }}>WHAT-IF COMM</span>{" "}
                <span style={{ color: CSS_COLOR.text }}>
                  {previewSnapshot.whatIf.commission || MISSING_VALUE}
                </span>
              </div>
              <div>
                <span style={{ color: CSS_COLOR.textMuted }}>MARGIN Δ</span>{" "}
                <span style={{ color: CSS_COLOR.text }}>
                  {previewSnapshot.whatIf.initialMarginChange || MISSING_VALUE}
                </span>
              </div>
              {previewSnapshot.whatIf.warnings?.length ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>WARNINGS</span>{" "}
                  <span style={{ color: CSS_COLOR.amber }}>
                    {previewSnapshot.whatIf.warnings.join(" · ")}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
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
          {robinhoodReviewSnapshot ? (
            <>
              {[
                [
                  "LAST",
                  formatTicketMoney(robinhoodReviewSnapshot.lastTradePrice),
                  CSS_COLOR.text,
                ],
                [
                  "PREV CLOSE",
                  formatTicketMoney(robinhoodReviewSnapshot.previousClose),
                  CSS_COLOR.text,
                ],
                [
                  "BID / ASK",
                  `${formatTicketMoney(robinhoodReviewSnapshot.bidPrice)} / ${formatTicketMoney(robinhoodReviewSnapshot.askPrice)}`,
                  CSS_COLOR.text,
                ],
                [
                  robinhoodEstimateIsCredit ? "EST CREDIT" : "EST COST",
                  formatTicketMoney(previewSnapshot.estimatedValue),
                  robinhoodEstimateIsCredit ? CSS_COLOR.green : CSS_COLOR.red,
                ],
              ].map(([label, value, color], index) => (
                <div
                  key={label}
                  style={{ gridColumn: index > 1 ? "1 / -1" : undefined }}
                >
                  <span style={{ color: CSS_COLOR.textMuted }}>{label}</span>{" "}
                  <span style={{ color }}>{value}</span>
                </div>
              ))}
              {robinhoodReviewSnapshot.alerts?.length ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>ALERTS</span>{" "}
                  <span style={{ color: CSS_COLOR.amber }}>
                    {robinhoodReviewSnapshot.alerts.join(" · ")}
                  </span>
                </div>
              ) : null}
              {robinhoodReviewSnapshot.marketDataDisclosure ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>MARKET DATA</span>{" "}
                  <span style={{ color: CSS_COLOR.textSec }}>
                    {robinhoodReviewSnapshot.marketDataDisclosure}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
          {directBrokerReviewSnapshot ? (
            <>
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: CSS_COLOR.textMuted }}>
                  {side === "SELL" ? "EST CREDIT" : "EST COST"}
                </span>{" "}
                <span
                  style={{ color: side === "SELL" ? CSS_COLOR.green : CSS_COLOR.red }}
                >
                  {formatTicketMoney(directBrokerReviewSnapshot.estimatedValue)}
                </span>
              </div>
              {directBrokerReviewSnapshot.estimatedFee != null &&
              Number.isFinite(Number(directBrokerReviewSnapshot.estimatedFee)) ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>EST FEES</span>{" "}
                  <span style={{ color: CSS_COLOR.text }}>
                    {formatTicketMoney(directBrokerReviewSnapshot.estimatedFee)}
                  </span>
                </div>
              ) : null}
              {directBrokerReviewSnapshot.collateralAmount != null &&
              Number.isFinite(
                Number(directBrokerReviewSnapshot.collateralAmount),
              ) ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>COLLATERAL</span>{" "}
                  <span style={{ color: CSS_COLOR.amber }}>
                    {formatTicketMoney(
                      directBrokerReviewSnapshot.collateralAmount,
                    )}
                  </span>
                </div>
              ) : null}
              {directBrokerReviewSnapshot.previewAccepted ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>REVIEW</span>{" "}
                  <span style={{ color: CSS_COLOR.green }}>
                    BROKER PREVIEW ACCEPTED
                  </span>
                </div>
              ) : null}
              {directBrokerReviewSnapshot.alerts?.length ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>ALERTS</span>{" "}
                  <span style={{ color: CSS_COLOR.amber }}>
                    {directBrokerReviewSnapshot.alerts.join(" · ")}
                  </span>
                </div>
              ) : null}
              {directBrokerReviewSnapshot.marketDataDisclosure ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>MARKET DATA</span>{" "}
                  <span style={{ color: CSS_COLOR.textSec }}>
                    {directBrokerReviewSnapshot.marketDataDisclosure}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
          {robinhoodPlacementSnapshot ? (
            <>
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: CSS_COLOR.textMuted }}>STATUS</span>{" "}
                <span style={{ color: CSS_COLOR.green }}>
                  {robinhoodPlacementSnapshot.order?.state || "SUBMITTED"}
                </span>
              </div>
              {robinhoodPlacementSnapshot.alerts?.length ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>ALERTS</span>{" "}
                  <span style={{ color: CSS_COLOR.amber }}>
                    {robinhoodPlacementSnapshot.alerts.join(" · ")}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
          {directBrokerPlacementSnapshot ? (
            <>
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: CSS_COLOR.textMuted }}>STATUS</span>{" "}
                <span style={{ color: CSS_COLOR.green }}>
                  {String(directBrokerPlacementStatus).toUpperCase()}
                </span>
              </div>
              {directBrokerPlacementSnapshot.alerts?.length ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: CSS_COLOR.textMuted }}>ALERTS</span>{" "}
                  <span style={{ color: CSS_COLOR.amber }}>
                    {directBrokerPlacementSnapshot.alerts.join(" · ")}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
      {liveUsesIbkr &&
      (trackedIbkrOrder?.id || trackedIbkrOrderRequiresReconciliation) ? (
        <div
          data-testid="trade-ticket-ibkr-live-order"
          style={{
            border: `1px solid ${CSS_COLOR.border}`,
            background: CSS_COLOR.bg0,
            borderRadius: dim(RADII.xs),
            padding: sp("7px 8px"),
            display: "grid",
            gap: sp(6),
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8) }}>
            <span style={{ color: CSS_COLOR.textMuted }}>LIVE ORDER</span>
            <span
              style={{
                color:
                  trackedIbkrOrderStatus === "canceled"
                    ? CSS_COLOR.green
                    : trackedIbkrOrderStatus === "pending_cancel"
                      ? CSS_COLOR.amber
                      : trackedIbkrOrderTerminal
                        ? CSS_COLOR.red
                        : CSS_COLOR.accent,
              }}
            >
              {trackedIbkrOrderStatus.toUpperCase()}
            </span>
          </div>
          <div style={{ color: CSS_COLOR.textSec }}>
            {trackedIbkrOrder.symbol || slot.ticker} · {trackedIbkrOrder.side?.toUpperCase() || "BUY"} {trackedIbkrOrder.quantity || 0} {trackedIbkrOrder.assetClass === "option" ? "contract(s)" : "share(s)"} ·{" "}
            {trackedIbkrOrderIsMarket
              ? "MKT"
              : `LMT ${formatTicketMoney(trackedIbkrOrder.limitPrice)}`} · filled {trackedIbkrOrder.filledQuantity || 0}
          </div>
          {trackedIbkrOrderRequiresReconciliation ? (
            <div
              role="alert"
              style={{
                border: `1px solid ${CSS_COLOR.red}`,
                background: cssColorAlpha(CSS_COLOR.red, 0.08),
                color: CSS_COLOR.red,
                borderRadius: dim(RADII.xs),
                padding: sp("6px 8px"),
              }}
            >
              STOP / RECONCILE — do not retry, replace, or cancel from this ticket. Check the live broker order first.
            </div>
          ) : ibkrCancelAttempted && !trackedIbkrOrderTerminal ? (
            <div role="status" style={{ color: CSS_COLOR.amber }}>
              CANCEL SENT — read-only while broker status is reconciled.
            </div>
          ) : null}
          {!trackedIbkrOrderTerminal &&
          trackedIbkrOrderStatus !== "pending_cancel" &&
          !trackedIbkrOrderRequiresReconciliation &&
          !ibkrCancelAttempted ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: trackedIbkrOrderIsMarket
                  ? "1fr"
                  : "1fr auto auto",
                gap: sp(4),
              }}
            >
              {!trackedIbkrOrderIsMarket ? (
                <>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    aria-label="replacement limit price"
                    value={replacementLimitPrice}
                    onChange={(event) => setReplacementLimitPrice(event.target.value)}
                    disabled={ibkrLifecyclePending || ibkrReplacementLocked}
                    style={{
                      minWidth: 0,
                      background: CSS_COLOR.bg1,
                      border: `1px solid ${CSS_COLOR.border}`,
                      color: CSS_COLOR.text,
                      padding: sp("4px 6px"),
                    }}
                  />
                  <button
                    type="button"
                    onClick={previewIbkrReplacement}
                    disabled={
                      ibkrLifecyclePending ||
                      ibkrReplacementLocked ||
                      Number(trackedIbkrOrder.filledQuantity || 0) > 0
                    }
                    style={{
                      border: `1px solid ${CSS_COLOR.border}`,
                      background: CSS_COLOR.bg1,
                      color: CSS_COLOR.amber,
                      padding: sp("4px 7px"),
                    }}
                  >
                    {previewOrderReplacementMutation.isPending
                      ? "CHECKING..."
                      : ibkrReplacementLocked
                        ? "CHANGE USED"
                        : "PREVIEW CHANGE"}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={confirmIbkrCancellation}
                disabled={ibkrLifecyclePending || ibkrWarningDecisionOpen}
                style={{
                  border: `1px solid ${CSS_COLOR.red}`,
                  background: "transparent",
                  color: CSS_COLOR.red,
                  padding: sp("4px 7px"),
                }}
              >
                CANCEL
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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
              : liveUsesRobinhood
                ? "PREVIEW ROBINHOOD"
              : liveUsesSchwab
                ? "PREVIEW SCHWAB"
              : liveUsesBrokerOption
                ? `PREVIEW ${optionBroker.toUpperCase()}`
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
        cancelLabel={liveConfirmState?.cancelLabel || "Cancel"}
        confirmTone={liveConfirmState?.confirmTone || CSS_COLOR.red}
        pending={liveConfirmPending}
        requireExplicitDecision={liveConfirmState?.kind === "ibkr_warning"}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </>
  );
};
