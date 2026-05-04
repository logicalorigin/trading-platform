import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useCancelOrder,
  useListOrders,
  useListPositions,
  usePlaceOrder,
  usePreviewOrder,
  useReplaceOrder,
  useSubmitOrders,
} from "@workspace/api-client-react";
import {
  DISPLAY_CHART_OUTSIDE_RTH,
  resolveDisplayChartPrice,
} from "../charting/displayChartSession";
import { RayReplicaSettingsMenu } from "../charting/RayReplicaSettingsMenu";
import { ResearchChartFrame } from "../charting/ResearchChartFrame";
import {
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
  ResearchChartWidgetSidebar,
} from "../charting/ResearchChartWidgetChrome";
import {
  expandLocalRollupLimit,
  resolveLocalRollupBaseTimeframe,
  rollupMarketBars,
} from "../charting/timeframeRollups";
import { flowEventsToChartEvents } from "../charting/chartEvents";
import {
  getInitialChartBarLimit,
  normalizeChartTimeframe,
} from "../charting/timeframes";
import { recordChartBarScopeState } from "../charting/chartHydrationStats";
import { resolveSpotChartFrameLayout } from "../charting/spotChartFrameLayout";
import {
  useBrokerStreamedBars,
  useHistoricalBarStream,
  usePrependableHistoricalBars,
} from "../charting/useMassiveStreamedStockBars";
import { useDrawingHistory } from "../charting/useDrawingHistory";
import { useIndicatorLibrary } from "../charting/pineScripts";
import {
  buildTradeBarsFromApi,
  describeBrokerChartSource,
  describeBrokerChartStatus,
  useDisplayChartPriceFallbackBars,
} from "../charting/chartApiBars";
import {
  buildRayReplicaIndicatorSettings,
  isRayReplicaIndicatorSelected,
  resolvePersistedIndicatorPreset,
  resolvePersistedRayReplicaSettings,
} from "../charting/chartIndicatorPersistence";
import {
  buildChartBarScopeKey,
  measureChartBarsRequest,
  useDebouncedVisibleRangeExpansion,
  useMeasuredChartModel,
  useProgressiveChartBarLimit,
} from "../charting/chartHydrationRuntime";
import {
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "../charting/chartBarsPayloads";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
  buildBarsRequestOptions,
} from "../platform/queryDefaults";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import { useTradeFlowSnapshot } from "../platform/tradeFlowStore";
import { usePageVisible } from "../platform/usePageVisible";
import { usePositions, useToast } from "../platform/platformContexts.jsx";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  DEFAULT_TRADE_EQUITY_STUDIES,
  TRADE_EQUITY_INDICATOR_PRESET_VERSION,
  TRADE_TIMEFRAMES,
  buildTradeBarsPageQueryKey as buildBarsPageQueryKey,
  buildTradeFlowMarkersFromEvents,
} from "./tradeChartState";
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
  BrokerActionConfirmDialog,
  formatLiveBrokerActionError,
} from "./BrokerActionConfirmDialog.jsx";
import {
  FINAL_ORDER_STATUSES,
  formatExecutionContractLabel,
  getBrokerMarketDepthRequest,
  listBrokerExecutionsRequest,
  orderStatusColor,
  sameOptionContract,
} from "./tradeBrokerRequests";
import { buildMarketOrderFlowFromEvents } from "../flow/flowAnalytics";
import {
  OrderFlowDonut,
  SizeBucketRow,
} from "../flow/OrderFlowVisuals.jsx";
import { isOpenPositionRow } from "../account/accountPositionRows.js";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  daysToExpiration,
  fmtCompactNumber,
  formatEnumLabel,
  formatExpirationLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
  parseExpirationValue,
} from "../../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  getCurrentTheme,
  sp,
} from "../../lib/uiTokens";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";


export const TradeL2Panel = ({
  slot,
  chainRows = [],
  flowEvents,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
  streamingPaused = false,
}) => {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const tradeFlowSnapshot = useTradeFlowSnapshot(slot.ticker);
  const effectiveFlowEvents = flowEvents?.length ? flowEvents : tradeFlowSnapshot.events;
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((r) => r.k === slot.strike);
  const mid = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : mid - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : mid + 0.04;
  const spread = ask - bid;
  const tickerFlow = useMemo(
    () => buildMarketOrderFlowFromEvents(effectiveFlowEvents),
    [effectiveFlowEvents],
  );
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const [tab, setTab] = useState("book");
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const depthQuery = useQuery({
    queryKey: [
      "trade-market-depth",
      accountId,
      slot.ticker,
      selectedContractMeta?.providerContractId,
    ],
    queryFn: () =>
      getBrokerMarketDepthRequest({
        accountId,
        symbol: slot.ticker,
        assetClass: "option",
        providerContractId: selectedContractMeta?.providerContractId,
        exchange: "SMART",
      }),
    enabled: Boolean(
      brokerAuthenticated &&
        accountId &&
        selectedContractMeta?.providerContractId &&
        !streamingPaused,
    ),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const tapeQuery = useQuery({
    queryKey: [
      "trade-contract-executions",
      accountId,
      slot.ticker,
      selectedContractMeta?.providerContractId,
    ],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        symbol: slot.ticker,
        providerContractId: selectedContractMeta?.providerContractId,
        days: 2,
        limit: 24,
      }),
    enabled: Boolean(
      brokerAuthenticated &&
        accountId &&
        selectedContractMeta?.providerContractId &&
        !streamingPaused,
    ),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !selectedContractMeta?.providerContractId ||
      streamingPaused ||
      !pageVisible ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      symbol: slot.ticker,
      assetClass: "option",
      providerContractId: selectedContractMeta.providerContractId,
      exchange: "SMART",
    });
    const source = new EventSource(`/api/streams/market-depth?${params.toString()}`);
    const handleDepth = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          [
            "trade-market-depth",
            accountId,
            slot.ticker,
            selectedContractMeta.providerContractId,
          ],
          payload,
        );
      } catch {}
    };

    source.addEventListener("depth", handleDepth);
    return () => {
      source.removeEventListener("depth", handleDepth);
      source.close();
    };
  }, [
    accountId,
    brokerAuthenticated,
    pageVisible,
    queryClient,
    selectedContractMeta?.providerContractId,
    streamingPaused,
    slot.ticker,
  ]);
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !selectedContractMeta?.providerContractId ||
      streamingPaused ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      symbol: slot.ticker,
      providerContractId: selectedContractMeta.providerContractId,
      days: "2",
      limit: "24",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          [
            "trade-contract-executions",
            accountId,
            slot.ticker,
            selectedContractMeta.providerContractId,
          ],
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
    queryClient,
    selectedContractMeta?.providerContractId,
    streamingPaused,
    slot.ticker,
  ]);
  const depthLevels = depthQuery.data?.depth?.levels || [];
  const contractExecutions = tapeQuery.data?.executions || [];
  const liveStatusLabel =
    tab === "flow"
      ? effectiveFlowEvents.length
        ? "flow: external options flow"
        : "flow unavailable"
      : brokerConfigured
        ? brokerAuthenticated
          ? "IBKR book + fills"
          : "IBKR login required"
        : "broker off";

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        fontSize: fs(9),
        fontWeight: 700,
        color: tab === id ? T.text : T.textMuted,
        fontFamily: T.display,
        letterSpacing: "0.08em",
        cursor: "pointer",
        borderBottom:
          tab === id ? `2px solid ${T.accent}` : "2px solid transparent",
        paddingBottom: sp(2),
      }}
    >
      {label}
    </button>
  );

  const renderBrokerGate = (title, detail, loading = false) => (
    <DataUnavailableState
      title={title}
      detail={detail}
      loading={loading}
      tone={loading ? T.accent : undefined}
    />
  );

  const renderBookPanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract market depth",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    if (!brokerConfigured) {
      return renderBrokerGate(
        "IBKR book unavailable",
        "Depth-of-book is only available when the broker bridge is configured.",
      );
    }

    if (!brokerAuthenticated) {
      return renderBrokerGate(
        "IBKR login required",
        "Bring the local IBKR bridge online to load live price ladder data.",
      );
    }

    if (!accountId) {
      return renderBrokerGate(
        "No broker account selected",
        "Select an IBKR account to request contract depth.",
      );
    }

    if (!selectedContractMeta?.providerContractId) {
      return renderBrokerGate(
        "Contract still loading",
        "Wait for the selected option contract to resolve to a broker contract id.",
        true,
      );
    }

    if (depthQuery.isPending && !depthLevels.length) {
      return (
        <DataUnavailableState
          title="Loading IBKR depth"
          detail="Requesting the live contract price ladder from the broker bridge."
          loading
          tone={T.accent}
        />
      );
    }

    if (!depthLevels.length) {
      return renderBrokerGate(
        "No broker depth returned",
        "IBKR did not return any price ladder rows for this contract yet. This panel shows live book depth, not synthetic levels.",
      );
    }

    const bestBidLevel =
      depthLevels.find(
        (level) => typeof level.bidSize === "number" && level.bidSize > 0,
      ) || null;
    const bestAskLevel =
      depthLevels.find(
        (level) => typeof level.askSize === "number" && level.askSize > 0,
      ) || null;

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 0 6px"),
            borderBottom: `1px solid ${T.border}`,
            fontFamily: T.mono,
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BEST BID
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.green }}>
              {formatQuotePrice(bestBidLevel?.price ?? bid)}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              LEVELS
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>
              {depthLevels.length}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BEST ASK
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.red }}>
              {formatQuotePrice(bestAskLevel?.price ?? ask)}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "42px 58px 42px 34px",
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: fs(7),
            color: T.textMuted,
            letterSpacing: "0.08em",
            fontFamily: T.mono,
          }}
        >
          <span style={{ textAlign: "right" }}>BID SZ</span>
          <span style={{ textAlign: "right" }}>PRICE</span>
          <span style={{ textAlign: "right" }}>ASK SZ</span>
          <span style={{ textAlign: "right" }}>ROW</span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: sp(2),
          }}
        >
          {depthLevels.map((level) => (
            <div
              key={`${level.row}_${level.price}`}
              style={{
                display: "grid",
                gridTemplateColumns: "42px 58px 42px 34px",
                gap: sp(4),
                alignItems: "center",
                padding: sp("3px 0"),
                fontSize: fs(9),
                fontFamily: T.mono,
                borderBottom: `1px solid ${T.border}08`,
                background: level.isLastTrade ? `${T.accent}10` : "transparent",
              }}
            >
              <span
                style={{
                  color:
                    typeof level.bidSize === "number" && level.bidSize > 0
                      ? T.green
                      : T.textDim,
                  textAlign: "right",
                  fontWeight: typeof level.bidSize === "number" ? 700 : 400,
                }}
              >
                {level.bidSize != null ? level.bidSize.toFixed(0) : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: level.isLastTrade ? T.accent : T.text,
                  textAlign: "right",
                  fontWeight: 700,
                }}
              >
                {formatQuotePrice(level.price)}
              </span>
              <span
                style={{
                  color:
                    typeof level.askSize === "number" && level.askSize > 0
                      ? T.red
                      : T.textDim,
                  textAlign: "right",
                  fontWeight: typeof level.askSize === "number" ? 700 : 400,
                }}
              >
                {level.askSize != null ? level.askSize.toFixed(0) : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: T.textDim,
                  textAlign: "right",
                  fontSize: fs(8),
                }}
              >
                {level.isLastTrade && level.totalSize != null
                  ? `T ${level.totalSize.toFixed(0)}`
                  : level.row}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTapePanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract fills",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    if (!brokerConfigured) {
      return renderBrokerGate(
        "IBKR fills unavailable",
        "The tape tab shows broker executions for this contract once the bridge is configured.",
      );
    }

    if (!brokerAuthenticated) {
      return renderBrokerGate(
        "IBKR login required",
        "Bring the local IBKR bridge online to load broker executions.",
      );
    }

    if (!accountId) {
      return renderBrokerGate(
        "No broker account selected",
        "Select an IBKR account to load this contract's execution history.",
      );
    }

    if (!selectedContractMeta?.providerContractId) {
      return renderBrokerGate(
        "Contract still loading",
        "Wait for the selected option contract to resolve to a broker contract id.",
        true,
      );
    }

    if (tapeQuery.isPending && !contractExecutions.length) {
      return (
        <DataUnavailableState
          title="Loading IBKR fills"
          detail="Requesting broker executions for the selected option contract."
          loading
          tone={T.accent}
        />
      );
    }

    if (!contractExecutions.length) {
      return renderBrokerGate(
        "No broker fills yet",
        "This tab shows IBKR executions for the selected contract. It is not a public market-wide tape.",
      );
    }

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "28px 24px 52px 56px 44px",
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: fs(7),
            color: T.textMuted,
            letterSpacing: "0.08em",
            fontFamily: T.mono,
          }}
        >
          <span>SIDE</span>
          <span style={{ textAlign: "right" }}>QTY</span>
          <span style={{ textAlign: "right" }}>PRICE</span>
          <span style={{ textAlign: "right" }}>NET</span>
          <span style={{ textAlign: "right" }}>TIME</span>
        </div>
        {contractExecutions.map((execution) => (
          <AppTooltip key={execution.id} content={`${formatExecutionContractLabel(execution)}${execution.exchange ? ` · ${execution.exchange}` : ""}`}><div
            key={execution.id}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 24px 52px 56px 44px",
              gap: sp(4),
              alignItems: "center",
              padding: sp("4px 0"),
              fontSize: fs(9),
              fontFamily: T.mono,
              borderBottom: `1px solid ${T.border}08`,
            }}
          >
            <span
              style={{
                color: execution.side === "buy" ? T.green : T.red,
                fontWeight: 700,
              }}
            >
              {execution.side === "buy" ? "BUY" : "SELL"}
            </span>
            <span style={{ color: T.textDim, textAlign: "right" }}>
              {isFiniteNumber(execution.quantity)
                ? execution.quantity.toFixed(0)
                : MISSING_VALUE}
            </span>
            <span style={{ color: T.text, textAlign: "right", fontWeight: 700 }}>
              {formatQuotePrice(execution.price)}
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
              {execution.netAmount != null
                ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(
                    execution.netAmount,
                  ).toFixed(0)}`
                : MISSING_VALUE}
            </span>
            <span
              style={{
                color: T.textDim,
                textAlign: "right",
                fontSize: fs(8),
              }}
            >
              {formatRelativeTimeShort(execution.executedAt)}
            </span>
          </div></AppTooltip>
        ))}
      </div>
    );
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
          paddingBottom: sp(4),
        }}
      >
        <div style={{ display: "flex", gap: sp(8), alignItems: "center" }}>
          <TabBtn id="book" label="BOOK" />
          <TabBtn id="flow" label="FLOW" />
          <TabBtn id="tape" label="TAPE" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span
            style={{
              fontSize: fs(8),
              color:
                tab === "flow"
                  ? effectiveFlowEvents.length
                    ? T.accent
                    : T.textDim
                  : brokerAuthenticated
                    ? T.green
                    : T.textDim,
              fontFamily: T.mono,
            }}
          >
            {liveStatusLabel}
          </span>
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: contractColor,
              fontWeight: 700,
            }}
          >
            {slot.strike}
            {slot.cp}
          </span>
          <span
            style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
          >
            ${spread.toFixed(2)} sprd
          </span>
        </div>
      </div>

      {tab === "book" && renderBookPanel()}

      {tab === "flow" &&
        (effectiveFlowEvents.length ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: sp(4),
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                padding: sp("4px 0"),
              }}
            >
              <OrderFlowDonut flow={tickerFlow} size={70} thickness={11} />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(2),
                }}
              >
                <div
                  style={{
                    fontSize: fs(8),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                  }}
                >
                  {slot.ticker} BUY / SELL
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: T.mono,
                    fontSize: fs(10),
                  }}
                >
                  <span style={{ color: T.green, fontWeight: 700 }}>
                    $
                    {(
                      tickerFlow.buyXL +
                      tickerFlow.buyL +
                      tickerFlow.buyM +
                      tickerFlow.buyS
                    ).toFixed(0)}
                    M
                  </span>
                  <span style={{ color: T.red, fontWeight: 700 }}>
                    $
                    {(
                      tickerFlow.sellXL +
                      tickerFlow.sellL +
                      tickerFlow.sellM +
                      tickerFlow.sellS
                    ).toFixed(0)}
                    M
                  </span>
                </div>
                {(() => {
                  const buy =
                    tickerFlow.buyXL +
                    tickerFlow.buyL +
                    tickerFlow.buyM +
                    tickerFlow.buyS;
                  const sell =
                    tickerFlow.sellXL +
                    tickerFlow.sellL +
                    tickerFlow.sellM +
                    tickerFlow.sellS;
                  const buyPct = (buy / Math.max(buy + sell, 1)) * 100;
                  return (
                    <>
                      <div
                        style={{
                          display: "flex",
                          height: dim(4),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: T.green,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: T.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textDim,
                          fontFamily: T.mono,
                        }}
                      >
                        {buyPct.toFixed(1)}% buy
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div
              style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(3) }}
            >
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  marginBottom: sp(2),
                }}
              >
                BY SIZE
              </div>
              {(() => {
                const max = Math.max(
                  tickerFlow.buyXL,
                  tickerFlow.buyL,
                  tickerFlow.buyM,
                  tickerFlow.buyS,
                  tickerFlow.sellXL,
                  tickerFlow.sellL,
                  tickerFlow.sellM,
                  tickerFlow.sellS,
                );
                return (
                  <>
                    <SizeBucketRow
                      label="XL"
                      buy={tickerFlow.buyXL}
                      sell={tickerFlow.sellXL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={tickerFlow.buyL}
                      sell={tickerFlow.sellL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={tickerFlow.buyM}
                      sell={tickerFlow.sellM}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={tickerFlow.buyS}
                      sell={tickerFlow.sellS}
                      maxValue={max}
                    />
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          <DataUnavailableState
            title="No live flow tape"
            detail={`Spot flow for ${slot.ticker} is hidden until current prints are returned from the external flow provider.`}
          />
        ))}

      {tab === "tape" && renderTapePanel()}
    </div>
  );
};
