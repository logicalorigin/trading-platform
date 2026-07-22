import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
} from "../platform/queryDefaults";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import {
  toneForDirectionalIntent,
  toneForOptionSide,
} from "../platform/semanticToneModel.js";
import { useTradeFlowSnapshot } from "../platform/tradeFlowStore";
import { resolveTradeFlowPanelState } from "./tradeFlowPanelState.js";
import {
  resolveTradeL2QuoteState,
  resolveTradeL2TapeState,
} from "./tradeL2PanelState.js";
import {
  formatExecutionContractLabel,
  listBrokerExecutionsRequest,
  normalizeBrokerExecutionsPayload,
} from "./tradeBrokerRequests";
import { buildMarketOrderFlowFromEvents } from "../flow/flowAnalytics";
import {
  OrderFlowDonut,
  SizeBucketRow,
} from "../flow/OrderFlowVisuals.jsx";
import {
  formatOptionContractLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
  isFiniteNumber,
} from "../../lib/formatters";
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
import {
  DataUnavailableState,
  SegmentedControl,
  surfaceStyle,
} from "../../components/platform/primitives.jsx";
import { useListMotionKeys } from "../../lib/motion.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

const TRADE_BUY_TONE = toneForDirectionalIntent("buy");
const TRADE_SELL_TONE = toneForDirectionalIntent("sell");

const TradeL2StateNotice = ({ state, onRetry = null }) => {
  const tone =
    state.kind === "offline" || state.kind === "stale"
      ? state.kind === "offline"
        ? CSS_COLOR.red
        : CSS_COLOR.amber
      : state.kind === "refreshing"
        ? CSS_COLOR.accent
        : CSS_COLOR.amber;
  return (
    <div
      role={
        state.kind === "offline" || state.kind === "stale" ? "alert" : "status"
      }
      data-testid="trade-l2-data-status"
      style={{
        minHeight: dim(44),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        padding: sp("5px 8px"),
        borderLeft: `2px solid ${tone}`,
        background: cssColorMix(tone, 5),
        color: tone,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      <span>
        <span>{state.notice}</span>
        {state.detail ? (
          <span
            style={{
              display: "block",
              marginTop: sp(2),
              color: CSS_COLOR.textMuted,
            }}
          >
            {state.detail}
          </span>
        ) : null}
      </span>
      {typeof onRetry === "function" ? (
        <button
          type="button"
          className="ra-touch-target-y"
          onClick={onRetry}
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
  );
};

export const TradeL2Panel = ({
  slot,
  chainRows = [],
  flowEvents,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
  isVisible = false,
  streamingPaused = false,
}) => {
  const queryClient = useQueryClient();
  const tradeFlowSnapshot = useTradeFlowSnapshot(slot.ticker);
  const parentFlowEventsProvided = flowEvents !== undefined;
  const effectiveFlowEvents = parentFlowEventsProvided
    ? Array.isArray(flowEvents)
      ? flowEvents
      : []
    : tradeFlowSnapshot.events || [];
  const flowDisplayState = resolveTradeFlowPanelState({
    enabled: !streamingPaused,
    status: parentFlowEventsProvided
      ? effectiveFlowEvents.length
        ? "live"
        : "empty"
      : tradeFlowSnapshot.status,
    events: effectiveFlowEvents,
  });
  const chainSnapshot = useTradeOptionChainSnapshot(slot.ticker);
  const { chainRows: snapshotChainRows } = resolveTradeOptionChainSnapshot(
    chainSnapshot,
    slot.exp,
  );
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const row = resolvedChainRows.find((r) => r.k === slot.strike);
  const contractLabel = formatOptionContractLabel(
    {
      ticker: slot.ticker,
      symbol: slot.ticker,
      expirationDate: slot.exp,
      exp: slot.exp,
      strike: slot.strike,
      cp: slot.cp,
    },
    {
      includeSymbol: false,
      fallback: `${slot.strike}${slot.cp}`,
    },
  );
  const quoteState = resolveTradeL2QuoteState({ row, cp: slot.cp });
  const tickerFlow = useMemo(
    () => buildMarketOrderFlowFromEvents(effectiveFlowEvents),
    [effectiveFlowEvents],
  );
  const contractColor = toneForOptionSide(slot.cp, CSS_COLOR.textDim);
  const [tab, setTab] = useState("book");
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const brokerExecutionEnabled = Boolean(
    isVisible &&
      brokerConfigured &&
      brokerAuthenticated &&
      accountId &&
      selectedContractMeta?.providerContractId &&
      !streamingPaused,
  );
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
    enabled: brokerExecutionEnabled,
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    if (
      !brokerExecutionEnabled ||
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
        const payload = normalizeBrokerExecutionsPayload(JSON.parse(event.data));
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
    brokerExecutionEnabled,
    queryClient,
    selectedContractMeta?.providerContractId,
    slot.ticker,
  ]);
  const contractExecutions = tapeQuery.data?.executions || [];
  const tapeState = resolveTradeL2TapeState({
    hasContractRow: Boolean(row),
    brokerConfigured,
    brokerAuthenticated,
    accountId,
    providerContractId: selectedContractMeta?.providerContractId,
    queryEnabled: brokerExecutionEnabled,
    isPending: tapeQuery.isPending,
    isError: tapeQuery.isError,
    isFetching: tapeQuery.isFetching,
    executions: contractExecutions,
  });
  // Item 13, D4 — one-shot enter emphasis when a new broker fill lands on the
  // tape. Keyed by execution id so only freshly-arrived rows animate in.
  const executionMotionKeys = useListMotionKeys(
    contractExecutions,
    (execution) => execution.id,
  );
  const newExecutionIds = useMemo(
    () =>
      new Set(
        executionMotionKeys.filter((entry) => entry.isNew).map((entry) => entry.key),
    ),
    [executionMotionKeys],
  );
  const tapeStatusLabel =
    {
      locked: "contract waiting",
      unavailable: "broker off",
      auth: "IBKR login required",
      account: "account required",
      waiting: "fills waiting",
      loading: "loading fills",
      error: "fills unavailable",
      stale: "fills stale",
      refreshing: "refreshing fills",
      ready: "broker fills",
      empty: "no broker fills",
    }[tapeState.kind] || "fills unavailable";
  const liveStatusLabel =
    tab === "flow"
      ? `flow: ${flowDisplayState.metaLabel.toLowerCase()}`
      : tab === "tape"
        ? tapeStatusLabel
        : "option depth unavailable";
  const liveStatusTone =
    tab === "flow"
      ? flowDisplayState.kind === "offline"
        ? CSS_COLOR.red
        : flowDisplayState.kind === "stale" ||
            flowDisplayState.kind === "waiting"
          ? CSS_COLOR.amber
          : flowDisplayState.kind === "live"
            ? CSS_COLOR.accent
            : CSS_COLOR.textDim
      : tab === "tape"
        ? tapeState.kind === "error"
          ? CSS_COLOR.red
          : tapeState.kind === "stale" || tapeState.kind === "waiting"
            ? CSS_COLOR.amber
            : tapeState.kind === "ready"
              ? CSS_COLOR.green
              : CSS_COLOR.textDim
        : CSS_COLOR.textDim;

  const renderBrokerGate = (title, detail, { loading = false } = {}) => (
    <DataUnavailableState
      title={title}
      detail={detail}
      loading={loading}
      tone={loading ? CSS_COLOR.accent : undefined}
    />
  );

  const renderBookPanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract market depth",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    return renderBrokerGate(
      "Option depth unavailable",
      "Massive provides realtime option quotes and trades, but not depth-of-book. Broker market-data depth is disabled for options.",
    );
  };

  const renderTapePanel = () => {
    if (!tapeState.showRows) {
      return (
        <DataUnavailableState
          title={tapeState.title}
          detail={tapeState.detail}
          loading={tapeState.kind === "loading"}
          loadingEndpoint={
            tapeState.kind === "loading"
              ? "/api/executions"
              : undefined
          }
          tone={
            tapeState.kind === "loading" ? CSS_COLOR.accent : undefined
          }
          variant={tapeState.kind === "error" ? "error" : undefined}
          action={
            tapeState.kind === "error" ? (
              <button
                type="button"
                className="ra-touch-target-y"
                onClick={() => void tapeQuery.refetch()}
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
                Retry fills
              </button>
            ) : undefined
          }
        />
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
        {tapeState.notice ? (
          <TradeL2StateNotice
            state={tapeState}
            onRetry={
              tapeState.kind === "stale"
                ? () => void tapeQuery.refetch()
                : null
            }
          />
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${dim(28)}px ${dim(24)}px ${dim(52)}px ${dim(56)}px ${dim(44)}px`,
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: textSize("caption"),
            color: CSS_COLOR.textMuted,
            letterSpacing: "0.04em",
            fontFamily: T.sans,
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
            className={newExecutionIds.has(execution.id) ? "ra-row-enter" : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: `${dim(28)}px ${dim(24)}px ${dim(52)}px ${dim(56)}px ${dim(44)}px`,
              gap: sp(4),
              alignItems: "center",
              padding: sp("4px 0"),
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 3)}`,
            }}
          >
            <span
              style={{
                color: execution.side === "buy" ? TRADE_BUY_TONE : TRADE_SELL_TONE,
                fontWeight: FONT_WEIGHTS.regular,
              }}
            >
              {execution.side === "buy" ? "BUY" : "SELL"}
            </span>
            <span style={{ color: CSS_COLOR.textDim, textAlign: "right" }}>
              {isFiniteNumber(execution.quantity)
                ? execution.quantity.toFixed(0)
                : MISSING_VALUE}
            </span>
            <span style={{ color: CSS_COLOR.text, textAlign: "right", fontWeight: FONT_WEIGHTS.regular }}>
              {formatQuotePrice(execution.price)}
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
              {execution.netAmount != null
                ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(
                    execution.netAmount,
                  ).toFixed(0)}`
                : MISSING_VALUE}
            </span>
            <span
              style={{
                color: CSS_COLOR.textDim,
                textAlign: "right",
                fontSize: textSize("body"),
              }}
            >
              {formatRelativeTimeShort(execution.executedAt)}
            </span>
          </div></AppTooltip>
        ))}
      </div>
    );
  };
  const flowGateTitle =
    flowDisplayState.notice ||
    (flowDisplayState.kind === "loading"
      ? "Loading flow tape"
      : "No live flow tape");
  const flowGateDetail =
    flowDisplayState.detail ||
    (flowDisplayState.kind === "loading"
      ? `Requesting current external flow prints for ${slot.ticker}.`
      : `No current external flow prints were returned for ${slot.ticker}.`);

  return (
    <div
      data-testid="trade-l2-content"
      data-book-quote-state={quoteState.kind}
      data-flow-state={flowDisplayState.kind}
      data-tape-state={tapeState.kind}
      style={{
        ...surfaceStyle(),
        padding: sp("12px 14px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(8),
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: sp(6),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          paddingBottom: sp(4),
        }}
      >
        <SegmentedControl
          ariaLabel="Market data view"
          options={[
            { value: "book", label: "BOOK" },
            { value: "flow", label: "FLOW" },
            { value: "tape", label: "TAPE" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: textSize("body"),
              color: liveStatusTone,
              fontFamily: T.sans,
            }}
          >
            {liveStatusLabel}
          </span>
          <span
            style={{
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              color: contractColor,
              fontWeight: FONT_WEIGHTS.regular,
            }}
          >
            {contractLabel}
          </span>
          <span
            style={{ fontSize: textSize("body"), color: CSS_COLOR.textDim, fontFamily: T.sans }}
          >
            {quoteState.spread == null
              ? `${MISSING_VALUE} sprd`
              : `${quoteState.spread.toFixed(2)} sprd`}
          </span>
        </div>
      </div>

      {tab === "book" && renderBookPanel()}

      {tab === "flow" &&
        (flowDisplayState.showEvents ? (
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
            {flowDisplayState.notice ? (
              <TradeL2StateNotice state={flowDisplayState} />
            ) : null}
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
                    fontSize: textSize("body"),
                    color: CSS_COLOR.textMuted,
                    letterSpacing: "0.04em",
                  }}
                >
                  {slot.ticker} BUY / SELL
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: T.sans,
                    fontSize: fs(10),
                  }}
                >
                  <span style={{ color: TRADE_BUY_TONE, fontWeight: FONT_WEIGHTS.regular }}>
                    $
                    {(
                      tickerFlow.buyXL +
                      tickerFlow.buyL +
                      tickerFlow.buyM +
                      tickerFlow.buyS
                    ).toFixed(0)}
                    M
                  </span>
                  <span style={{ color: CSS_COLOR.red, fontWeight: FONT_WEIGHTS.regular }}>
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
                          borderRadius: dim(RADII.xs),
                          overflow: "hidden",
                          background: CSS_COLOR.bg1,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: TRADE_BUY_TONE,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: CSS_COLOR.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: textSize("body"),
                          color: CSS_COLOR.textDim,
                          fontFamily: T.sans,
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
              style={{ borderTop: `1px solid ${CSS_COLOR.border}`, paddingTop: sp(3) }}
            >
              <div
                style={{
                  fontSize: textSize("body"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
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
            title={flowGateTitle}
            detail={flowGateDetail}
            loading={flowDisplayState.kind === "loading"}
            variant={
              flowDisplayState.kind === "offline"
                ? "error"
                : flowDisplayState.kind === "stale" ||
                    flowDisplayState.kind === "waiting"
                  ? "warning"
                  : undefined
            }
          />
        ))}

      {tab === "tape" && renderTapePanel()}
    </div>
  );
};
