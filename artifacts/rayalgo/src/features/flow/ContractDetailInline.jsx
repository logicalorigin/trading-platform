import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ResearchChartFrame,
} from "../charting/ResearchChartFrame";
import {
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
} from "../charting/ResearchChartWidgetChrome";
import {
  getChartBarLimit,
  getChartTimeframeOptions,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
} from "../charting/timeframes";
import {
  recordChartBarScopeState,
} from "../charting/chartHydrationStats";
import {
  buildChartBarScopeKey,
  useMeasuredChartModel,
} from "../charting/chartHydrationRuntime";
import { useChartTimeframeFavorites } from "../charting/useChartTimeframeFavorites";
import { useOptionChartBars } from "../charting/useOptionChartBars.js";
import { resolveOptionChartSourceState } from "../charting/chartApiBars.js";
import {
  normalizeFlowOptionExpirationIso,
  normalizeFlowOptionRight,
  normalizeFlowOptionStrike,
} from "../platform/flowOptionChartIdentity";
import { useToast } from "../platform/platformContexts.jsx";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import {
  Badge,
  Card,
  DataUnavailableState,
} from "../../components/platform/primitives.jsx";
import {
  fmtCompactNumber,
  fmtM,
  formatExpirationLabel,
  formatQuotePrice,
  isFiniteNumber,
  mapNewsSentimentToScore,
} from "../../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  getCurrentTheme,
  sp,
} from "../../lib/uiTokens";
import { flowProviderColor } from "./flowPresentation";
import { AppTooltip } from "@/components/ui/tooltip";


const OPTION_CHART_TIMEFRAMES = getChartTimeframeOptions("option");

const getFlowOptionChartEmptyCopy = ({ emptyReason, requestFailed, feedIssue }) => {
  if (requestFailed) {
    return {
      title: "Option history unavailable",
      detail:
        "The chart request did not complete. Select another flow row or retry after the data service recovers.",
    };
  }
  if (emptyReason === "no-option-aggregate-bars") {
    return {
      title: "No option trades in this window",
      detail:
        "IBKR and Polygon returned no bars for this contract and timeframe.",
    };
  }
  if (emptyReason === "polygon-not-configured") {
    return {
      title: "Option aggregate feed unavailable",
      detail:
        "IBKR did not return chart bars and the Polygon/Massive fallback is not configured.",
    };
  }
  if (
    emptyReason === "missing-provider-contract-id" ||
    emptyReason === "option_contract_resolution_error" ||
    emptyReason === "option-contract-resolution-backoff"
  ) {
    return {
      title: "Option contract lookup unavailable",
      detail:
        "IBKR did not provide a current contract id. Option aggregates will display when available.",
    };
  }
  if (feedIssue) {
    return {
      title: "Broker history unavailable",
      detail:
        "IBKR option history was unavailable and no fallback option bars were returned.",
    };
  }
  return {
    title: "No option bars",
    detail:
      emptyReason?.replaceAll("-", " ") ||
      "No chart bars were returned for this contract and timeframe.",
  };
};

export const ContractDetailInline = ({ evt, onBack, onJumpToTrade }) => {
  const toast = useToast();
  const [alertSet, setAlertSet] = useState(false);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const providerContractId = evt?.providerContractId || null;
  const optionTicker =
    typeof (evt?.optionTicker || evt?.contract) === "string" &&
    (evt?.optionTicker || evt?.contract).trim()
      ? (evt?.optionTicker || evt?.contract).trim()
      : null;
  const chartSymbol = normalizeTickerSymbol(evt?.ticker || evt?.underlying || "");
  const optionExpirationIso = useMemo(
    () => normalizeFlowOptionExpirationIso(evt?.expirationDate || evt?.exp),
    [evt?.exp, evt?.expirationDate],
  );
  const optionRight = normalizeFlowOptionRight(evt?.right, evt?.cp);
  const optionStrike = normalizeFlowOptionStrike(evt?.strike);
  const [optionChartTimeframe, setOptionChartTimeframe] = useState("1m");
  const {
    favoriteTimeframes: optionFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleOptionFavoriteTimeframe,
  } = useChartTimeframeFavorites("option");
  const {
    chartProviderContractId: effectiveProviderContractId,
    displayBars: optionDisplayBars,
    emptyOlderHistoryWindowCount: optionEmptyOlderHistoryWindowCount,
    hasExhaustedOlderHistory: hasExhaustedOlderOptionHistory,
    identityKey: optionContractIdentityKey,
    identityReady: canRequestOptionChart,
    isPrependingOlder: isPrependingOlderOptionHistory,
    loadedBarCount: optionLoadedBaseBarCount,
    oldestLoadedAtMs: optionOldestLoadedAtMs,
    olderHistoryExhaustionReason: optionOlderHistoryExhaustionReason,
    olderHistoryNextBeforeMs: optionOlderHistoryNextBeforeMs,
    olderHistoryPageCount: optionOlderHistoryPageCount,
    olderHistoryProvider: optionOlderHistoryProvider,
    prependOlderBars: prependOlderOptionBars,
    prewarmTimeframe: prewarmOptionTimeframe,
    query: optionBarsQuery,
    baseBarsCacheStale: optionBaseBarsCacheStale,
    streamStatus: optionStreamStatus,
  } = useOptionChartBars({
    scope: "flow-inspection",
    underlying: chartSymbol,
    expirationDate: optionExpirationIso,
    right: optionRight,
    strike: optionStrike,
    optionTicker,
    providerContractId,
    timeframe: optionChartTimeframe,
    enabled: true,
    liveEnabled: true,
    hydrationLabel: `${chartSymbol || "flow"} option inspection ${optionChartTimeframe}`,
    allowedTimeframes: OPTION_CHART_TIMEFRAMES,
    getPrewarmLimit: (nextTimeframe) =>
      getChartBarLimit(nextTimeframe, "option"),
  });
  const optionChartScopeKey = useMemo(
    () =>
      buildChartBarScopeKey(
        "flow-inspection-option-chart",
        optionContractIdentityKey,
        optionChartTimeframe,
      ),
    [optionChartTimeframe, optionContractIdentityKey],
  );
  const handleOptionVisibleLogicalRangeChange = useCallback(
    (range) => {
      if (
        !range ||
        !canRequestOptionChart ||
        hasExhaustedOlderOptionHistory ||
        isPrependingOlderOptionHistory
      ) {
        return;
      }

      const visibleBars = Math.max(1, Math.ceil(range.to - range.from));
      const leftEdgeBufferBars = Math.max(
        24,
        Math.min(144, Math.ceil(visibleBars * 0.2)),
      );
      if (range.from > leftEdgeBufferBars) {
        return;
      }

      prependOlderOptionBars({
        pageSize: Math.max(
          getInitialChartBarLimit(optionChartTimeframe, "option"),
          Math.ceil(visibleBars * 2),
          240,
        ),
      });
    },
    [
      canRequestOptionChart,
      hasExhaustedOlderOptionHistory,
      isPrependingOlderOptionHistory,
      optionChartTimeframe,
      prependOlderOptionBars,
    ],
  );
  useEffect(() => {
    recordChartBarScopeState(optionChartScopeKey, {
      timeframe: optionChartTimeframe,
      role: "option",
      requestedLimit: getChartBarLimit(optionChartTimeframe, "option"),
      initialLimit: getInitialChartBarLimit(optionChartTimeframe, "option"),
      targetLimit: getChartBarLimit(optionChartTimeframe, "option"),
      maxLimit: getMaxChartBarLimit(optionChartTimeframe, "option"),
      hydratedBaseCount: optionLoadedBaseBarCount,
      renderedBarCount: optionDisplayBars.length,
      livePatchedBarCount: 0,
      oldestLoadedAt: optionOldestLoadedAtMs
        ? new Date(optionOldestLoadedAtMs).toISOString()
        : null,
      isPrependingOlder: isPrependingOlderOptionHistory,
      hasExhaustedOlderHistory: hasExhaustedOlderOptionHistory,
      olderHistoryNextBeforeAt: optionOlderHistoryNextBeforeMs
        ? new Date(optionOlderHistoryNextBeforeMs).toISOString()
        : null,
      emptyOlderHistoryWindowCount: optionEmptyOlderHistoryWindowCount,
      olderHistoryPageCount: optionOlderHistoryPageCount,
      olderHistoryProvider: optionOlderHistoryProvider,
      olderHistoryExhaustionReason: optionOlderHistoryExhaustionReason,
    });
  }, [
    hasExhaustedOlderOptionHistory,
    isPrependingOlderOptionHistory,
    optionChartScopeKey,
    optionChartTimeframe,
    optionDisplayBars.length,
    optionEmptyOlderHistoryWindowCount,
    optionLoadedBaseBarCount,
    optionOlderHistoryExhaustionReason,
    optionOlderHistoryNextBeforeMs,
    optionOlderHistoryPageCount,
    optionOlderHistoryProvider,
    optionOldestLoadedAtMs,
  ]);
  const optionChartModel = useMeasuredChartModel({
    scopeKey: optionChartScopeKey,
    bars: optionDisplayBars,
    buildInput: {
      bars: optionDisplayBars,
      timeframe: optionChartTimeframe,
      defaultVisibleBarCount: getChartBarLimit(optionChartTimeframe, "option"),
    },
    deps: [optionDisplayBars, optionChartTimeframe],
  });
  const optionLatestBar = optionDisplayBars[optionDisplayBars.length - 1] || null;
  const optionPreviousBar =
    optionDisplayBars.length > 1
      ? optionDisplayBars[optionDisplayBars.length - 2]
      : null;
  const optionLastPrice = optionLatestBar?.c ?? null;
  const optionChangePercent =
    isFiniteNumber(optionLastPrice) &&
    isFiniteNumber(optionPreviousBar?.c) &&
    optionPreviousBar.c !== 0
      ? ((optionLastPrice - optionPreviousBar.c) / optionPreviousBar.c) * 100
      : null;
  const isOptionChartLoading =
    canRequestOptionChart &&
    (optionBarsQuery.isPending || optionBarsQuery.fetchStatus === "fetching");
  const optionChartRequestFailed = Boolean(optionBarsQuery.isError);
  const optionChartEmptyReason = optionBarsQuery.data?.emptyReason || null;
  const optionChartFeedIssue = Boolean(optionBarsQuery.data?.feedIssue);
  const optionChartSourceState = resolveOptionChartSourceState({
    identityReady: canRequestOptionChart,
    latestBar: optionLatestBar,
    status: optionStreamStatus,
    timeframe: optionChartTimeframe,
    liveDataEnabled: true,
    requestLoading: isOptionChartLoading,
    requestFailed: optionChartRequestFailed,
    emptyReason: optionChartEmptyReason,
    feedIssue: optionChartFeedIssue,
    dataSource: optionBarsQuery.data?.dataSource,
    resolutionSource: optionBarsQuery.data?.resolutionSource,
    responseFreshness: optionBarsQuery.data?.freshness,
    cacheStale: optionBaseBarsCacheStale,
  });
  const optionChartLoadingDetail = isOptionChartLoading
    ? "Resolving the option contract and requesting chart bars."
    : null;
  const optionChartStatusLabel = optionChartSourceState.label;
  const optionChartEmptyCopy = getFlowOptionChartEmptyCopy({
    emptyReason: optionChartEmptyReason,
    requestFailed: optionChartRequestFailed,
    feedIssue: optionChartFeedIssue,
  });

  if (!evt) return null;

  const isCall = evt.cp === "C";
  const cpColor = isCall ? T.green : T.red;
  const typeColor =
    evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple;
  const isSnapshotFlow = evt.basis === "snapshot";
  const voi =
    isFiniteNumber(evt.vol) && isFiniteNumber(evt.oi) && evt.oi > 0
      ? evt.vol / evt.oi
      : null;
  const sentimentScore = mapNewsSentimentToScore(evt.sentiment);
  const sideRead = isSnapshotFlow
    ? "Side inferred from bid/ask snapshot"
    : evt.side === "BUY"
      ? "Buyer initiated"
      : evt.side === "SELL"
        ? "Seller initiated"
        : "Side unavailable";
  const flowRead = isSnapshotFlow
    ? "Snapshot-derived active contract"
    : evt.type === "BLOCK"
      ? "Large negotiated block"
      : evt.type === "SWEEP"
        ? "Aggressive routed sweep"
        : "Single reported print";
  const fillPrice = isFiniteNumber(evt.premiumPrice)
    ? evt.premiumPrice
    : isFiniteNumber(evt.price)
      ? evt.price
      : null;
  const bidPrice = isFiniteNumber(evt.bid) ? evt.bid : null;
  const askPrice = isFiniteNumber(evt.ask) ? evt.ask : null;
  const fillSpread = (() => {
    if (!isFiniteNumber(fillPrice) || !isFiniteNumber(bidPrice) || !isFiniteNumber(askPrice)) {
      return {
        label: "N/A",
        shortLabel: "N/A",
        spread: null,
        spreadPct: null,
        color: T.textDim,
      };
    }
    if (askPrice < bidPrice) {
      return {
        label: "Crossed market",
        shortLabel: "CROSSED",
        spread: askPrice - bidPrice,
        spreadPct: null,
        color: T.amber,
      };
    }
    const spread = askPrice - bidPrice;
    const mid = (bidPrice + askPrice) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : null;
    if (spread <= 0) {
      return {
        label: "Locked market",
        shortLabel: "LOCK",
        spread,
        spreadPct,
        color: T.textDim,
      };
    }
    const position = (fillPrice - bidPrice) / spread;
    if (position < 0) {
      return { label: "Below bid", shortLabel: "BID-", spread, spreadPct, color: T.red };
    }
    if (position <= 0.1) {
      return { label: "At bid", shortLabel: "BID", spread, spreadPct, color: T.red };
    }
    if (position <= 0.4) {
      return { label: "Bid side", shortLabel: "BID", spread, spreadPct, color: T.red };
    }
    if (position <= 0.6) {
      return { label: "Mid", shortLabel: "MID", spread, spreadPct, color: T.textDim };
    }
    if (position <= 0.9) {
      return { label: "Ask side", shortLabel: "ASK", spread, spreadPct, color: isCall ? T.green : T.red };
    }
    if (position <= 1) {
      return { label: "At ask", shortLabel: "ASK", spread, spreadPct, color: isCall ? T.green : T.red };
    }
    return { label: "Above ask", shortLabel: "ASK+", spread, spreadPct, color: isCall ? T.green : T.red };
  })();

  const Stat = ({ label, value, color = T.text, mono = true }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        padding: sp("6px 8px"),
        background: T.bg3,
        borderRadius: dim(3),
      }}
    >
      <span
        style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.mono }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: fs(10),
          color,
          fontWeight: 700,
          fontFamily: mono ? T.mono : T.sans,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.15s ease-out" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          padding: sp("8px 12px"),
          marginBottom: sp(6),
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          flexWrap: "wrap",
        }}
      >
        <AppTooltip content="Back to flow (Esc)"><button
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            padding: sp("5px 10px"),
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            color: T.textSec,
            fontSize: fs(10),
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: fs(12) }}>←</span> Back to flow
        </button></AppTooltip>
        <div
          style={{
            width: dim(1),
            height: dim(22),
            background: T.border,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(6),
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          {evt.golden && (
            <span style={{ color: T.amber, fontSize: fs(14) }}>★</span>
          )}
          <span
            style={{
              fontSize: fs(16),
              fontWeight: 800,
              fontFamily: T.display,
              color: T.text,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {evt.ticker} {evt.strike} {isCall ? "Call" : "Put"}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: T.textDim,
              whiteSpace: "nowrap",
            }}
          >
            Exp {formatExpirationLabel(evt.expirationDate)}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: evt.dte <= 1 ? T.red : evt.dte <= 7 ? T.amber : T.textDim,
              fontWeight: 600,
            }}
          >
            {evt.dte}DTE
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: typeColor,
              fontWeight: 700,
              padding: sp("1px 6px"),
              background: T.bg3,
              borderRadius: dim(2),
            }}
          >
            {evt.type}
          </span>
          <Badge color={flowProviderColor(evt.provider)}>
            {evt.sourceLabel}
          </Badge>
        </div>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: sp(2),
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: fs(18),
              fontWeight: 800,
              fontFamily: T.mono,
              color: T.text,
            }}
          >
            {evt.premium >= 1e6
              ? `$${(evt.premium / 1e6).toFixed(2)}M`
              : `$${(evt.premium / 1e3).toFixed(0)}K`}
          </span>
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: T.textDim,
            }}
          >
            Flow premium • {evt.time} ET
          </span>
        </div>
        <div
          style={{
            width: dim(1),
            height: dim(22),
            background: T.border,
            flexShrink: 0,
          }}
        />
        <button
          onClick={() => onJumpToTrade && onJumpToTrade(evt)}
          style={{
            padding: sp("5px 10px"),
            background: T.accent,
            color: "#fff",
            border: "none",
            borderRadius: dim(4),
            cursor: "pointer",
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.sans,
            flexShrink: 0,
          }}
        >
          Open in Trade
        </button>
        <button
          onClick={() => {
            const next = !alertSet;
            setAlertSet(next);
            toast.push({
              kind: next ? "success" : "info",
              title: next ? "Alert set" : "Alert removed",
              body: next
                ? `${evt.ticker} ${evt.strike}${evt.cp} · Notify on next big activity (>$100K)`
                : `${evt.ticker} ${evt.strike}${evt.cp} · No longer watching this contract`,
            });
          }}
          style={{
            padding: sp("5px 10px"),
            background: alertSet ? `${T.amber}20` : "transparent",
            color: alertSet ? T.amber : T.textSec,
            border: `1px solid ${alertSet ? T.amber : T.border}`,
            borderRadius: dim(4),
            cursor: "pointer",
            fontSize: fs(10),
            fontWeight: 600,
            fontFamily: T.sans,
            flexShrink: 0,
          }}
        >
          🔔 {alertSet ? "Alert active" : "Set alert"}
        </button>
      </div>

      <div
        data-testid="flow-inline-execution-quality"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: sp(6),
          marginBottom: sp(6),
        }}
      >
        {[
          {
            label: "FILL",
            value: `${formatQuotePrice(fillPrice)} ${fillSpread.shortLabel}`,
            color: fillSpread.color,
          },
          {
            label: "BID",
            value: formatQuotePrice(bidPrice),
            color: T.textSec,
          },
          {
            label: "ASK",
            value: formatQuotePrice(askPrice),
            color: T.textSec,
          },
          {
            label: "SPREAD",
            value:
              isFiniteNumber(fillSpread.spread) &&
              isFiniteNumber(fillSpread.spreadPct)
                ? `${fillSpread.spread.toFixed(2)} / ${fillSpread.spreadPct.toFixed(1)}%`
                : fillSpread.shortLabel === "CROSSED"
                  ? "CROSSED"
                  : MISSING_VALUE,
            color:
              fillSpread.shortLabel === "CROSSED" ||
              (isFiniteNumber(fillSpread.spreadPct) && fillSpread.spreadPct > 10)
                ? T.amber
                : T.textDim,
          },
          {
            label: "SOURCE",
            value: evt.confidence || evt.sourceBasis || evt.sourceLabel,
            color: flowProviderColor(evt.provider),
          },
        ].map((item) => (
          <AppTooltip key={item.label} content={item.label === "FILL" ? fillSpread.label : undefined}><div
            key={item.label}
            style={{
              padding: sp("6px 8px"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: fs(8),
                color: T.textMuted,
                fontFamily: T.mono,
                fontWeight: 700,
                marginBottom: sp(2),
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: fs(10),
                color: item.color,
                fontFamily: T.mono,
                fontWeight: 800,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.value}
            </div>
          </div></AppTooltip>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 440px) minmax(0, 1fr)",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <Card style={{ padding: sp(8) }}>
            <div
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
                marginBottom: sp(4),
              }}
            >
              CONTRACT SNAPSHOT
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: sp(4),
              }}
            >
              <Stat label="SIDE" value={evt.side} color={evt.side === "BUY" ? T.green : evt.side === "SELL" ? T.red : T.textDim} />
              <Stat label="TYPE" value={evt.type} color={typeColor} />
              <Stat label="VOL" value={fmtCompactNumber(evt.vol)} />
              <Stat label="OI" value={fmtCompactNumber(evt.oi)} />
              <Stat
                label="V/OI"
                value={isFiniteNumber(voi) ? `${voi.toFixed(2)}x` : MISSING_VALUE}
                color={isFiniteNumber(voi) && voi > 1 ? T.amber : T.text}
              />
              <Stat
                label="IV"
                value={isFiniteNumber(evt.iv) ? `${(evt.iv * 100).toFixed(1)}%` : MISSING_VALUE}
                color={isFiniteNumber(evt.iv) ? T.cyan : T.textDim}
              />
              <Stat label="PREM" value={fmtM(evt.premium)} color={T.amber} />
              <Stat label="SCORE" value={evt.score} color={evt.score >= 80 ? T.amber : evt.score >= 60 ? T.green : T.text} />
            </div>
          </Card>

          <Card style={{ padding: sp(8) }}>
            <div
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
                marginBottom: sp(4),
              }}
            >
              EVENT READ
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(6),
                fontSize: fs(10),
                lineHeight: 1.45,
                color: T.textSec,
                fontFamily: T.sans,
              }}
            >
              <div>
                <span style={{ color: cpColor, fontWeight: 700 }}>
                  {isCall ? "Call flow" : "Put flow"}
                </span>{" "}
                with a provider-reported {evt.side.toLowerCase()} side. This panel
                now shows only event fields that came back from the live flow
                provider.
              </div>
              <div>
                <span style={{ color: T.text, fontWeight: 700 }}>{flowRead}</span>
                {" · "}
                <span
                  style={{
                    color:
                      sentimentScore > 0
                        ? T.green
                        : sentimentScore < 0
                          ? T.red
                          : T.textDim,
                    fontWeight: 700,
                  }}
                >
                  {evt.sentiment || "sentiment unavailable"}
                </span>
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono }}>
                {sideRead}
                {evt.tradeConditions?.length
                  ? ` • cond ${evt.tradeConditions.join(", ")}`
                  : ""}
              </div>
            </div>
          </Card>
        </div>

        <Card
          style={{
            padding: sp(8),
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: dim(320),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: sp(5),
            }}
          >
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
              }}
            >
              OPTION CHART
            </span>
            <span
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              {optionChartStatusLabel}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
            }}
          >
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <ResearchChartFrame
                dataTestId="flow-inspection-option-chart"
                theme={T}
                themeKey={`${getCurrentTheme()}-flow-inspection-option`}
                surfaceUiStateKey={`flow-inspection-option-${effectiveProviderContractId || optionChartScopeKey}`}
                rangeIdentityKey={optionChartScopeKey}
                model={optionChartModel}
                onVisibleLogicalRangeChange={handleOptionVisibleLogicalRangeChange}
                showSurfaceToolbar={false}
                showLegend
                legend={{
                  symbol: chartSymbol || "OPTION",
                  name: evt.optionTicker || evt.contract || "Flow option",
                  timeframe: optionChartTimeframe,
                  statusLabel: optionChartStatusLabel,
                  statusTone: optionChartSourceState.tone,
                  priceLabel: "Option",
                  price: optionLastPrice,
                  changePercent: optionChangePercent,
                  meta: {
                    open: optionLatestBar?.o,
                    high: optionLatestBar?.h,
                    low: optionLatestBar?.l,
                    close: optionLatestBar?.c,
                    volume: optionLatestBar?.v,
                    timestamp: optionLatestBar?.ts,
                    sourceLabel: optionChartStatusLabel,
                  },
                }}
                compact
                style={{ minHeight: 0, width: "100%" }}
                surfaceTopOverlay={(controls) => (
                  <ResearchChartWidgetHeader
                    theme={T}
                    controls={controls}
                    symbol={chartSymbol || "OPTION"}
                    name={evt.optionTicker || evt.contract || "Flow option"}
                    priceLabel="Option"
                    price={optionLastPrice}
                    changePercent={optionChangePercent}
                    statusLabel={optionChartStatusLabel}
                    statusTone={optionChartSourceState.tone}
                    timeframe={optionChartTimeframe}
                    showInlineLegend={false}
                    timeframeOptions={OPTION_CHART_TIMEFRAMES}
                    favoriteTimeframes={optionFavoriteTimeframes}
                    onChangeTimeframe={setOptionChartTimeframe}
                    onToggleFavoriteTimeframe={toggleOptionFavoriteTimeframe}
                    onPrewarmTimeframe={prewarmOptionTimeframe}
                    dense
                    meta={{
                      open: optionLatestBar?.o,
                      high: optionLatestBar?.h,
                      low: optionLatestBar?.l,
                      close: optionLatestBar?.c,
                      volume: optionLatestBar?.v,
                      timestamp: optionLatestBar?.ts,
                      sourceLabel: optionChartStatusLabel,
                    }}
                    showSnapshotButton={false}
                  />
                )}
                surfaceTopOverlayHeight={28}
                surfaceBottomOverlay={(controls) => (
                  <ResearchChartWidgetFooter
                    theme={T}
                    controls={controls}
                    dense
                    statusText={optionChartStatusLabel}
                  />
                )}
                surfaceBottomOverlayHeight={20}
              />
              {!optionDisplayBars.length ? (
                <div
                  style={{
                    position: "absolute",
                    top: sp(30),
                    right: 0,
                    bottom: sp(22),
                    left: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                    padding: sp(12),
                  }}
                >
                  <DataUnavailableState
                    loading={Boolean(optionChartLoadingDetail)}
                    title={
                      optionChartLoadingDetail
                        ? "Loading option history"
                        : !canRequestOptionChart
                          ? "Missing option details"
                          : optionChartEmptyCopy.title
                    }
                    detail={
                      optionChartLoadingDetail
                        ? optionChartLoadingDetail
                        : !canRequestOptionChart
                          ? "This flow event is missing expiration, side, or strike details needed for charting."
                          : optionChartEmptyCopy.detail
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
