import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ResearchChartFrame,
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
} from "../charting/ResearchChartFrame";
import { DISPLAY_CHART_OUTSIDE_RTH } from "../charting/displayChartSession";
import {
  getChartBarLimit,
  getChartTimeframeOptions,
  normalizeChartTimeframe,
} from "../charting/timeframes";
import {
  recordChartBarScopeState,
} from "../charting/chartHydrationStats";
import {
  buildChartBarScopeKey,
  resolveChartHydrationPolicy,
  resolveChartHydrationRequestPolicy,
  useDebouncedVisibleRangeExpansion,
  useMeasuredChartModel,
  useProgressiveChartBarLimit,
  useUnderfilledChartBackfill,
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
  formatOptionContractLabel,
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
  const flowOptionContractLabel = formatOptionContractLabel(
    {
      ...evt,
      ticker: evt?.ticker || evt?.underlying,
      symbol: evt?.ticker || evt?.underlying,
      expirationDate: optionExpirationIso || evt?.expirationDate || evt?.exp,
      right: optionRight || evt?.right,
      cp: evt?.cp,
      strike: optionStrike ?? evt?.strike,
    },
    {
      symbol: chartSymbol || evt?.ticker || evt?.underlying,
      fallback: optionTicker || "Flow option",
    },
  );
  const flowOptionContractShortLabel = formatOptionContractLabel(
    {
      ...evt,
      ticker: evt?.ticker || evt?.underlying,
      symbol: evt?.ticker || evt?.underlying,
      expirationDate: optionExpirationIso || evt?.expirationDate || evt?.exp,
      right: optionRight || evt?.right,
      cp: evt?.cp,
      strike: optionStrike ?? evt?.strike,
    },
    {
      symbol: chartSymbol || evt?.ticker || evt?.underlying,
      includeSymbol: false,
      fallback: optionTicker || "Flow option",
    },
  );
  const [optionChartTimeframe, setOptionChartTimeframe] = useState("1m");
  const [optionChartIntervalRevision, setOptionChartIntervalRevision] =
    useState(0);
  const {
    favoriteTimeframes: optionFavoriteTimeframes,
    toggleFavoriteTimeframe: toggleOptionFavoriteTimeframe,
  } = useChartTimeframeFavorites("option");
  const optionProgressiveScopeKey = useMemo(
    () =>
      buildChartBarScopeKey(
        "flow-inspection-option-bars",
        chartSymbol,
        optionExpirationIso,
        optionRight,
        Number.isFinite(optionStrike) ? optionStrike : null,
        optionTicker,
        providerContractId,
      ),
    [
      chartSymbol,
      optionExpirationIso,
      optionRight,
      optionStrike,
      optionTicker,
      providerContractId,
    ],
  );
  const optionProgressiveBars = useProgressiveChartBarLimit({
    scopeKey: optionProgressiveScopeKey,
    timeframe: optionChartTimeframe,
    role: "option",
    enabled: true,
    warmTargetLimit: useCallback(() => Promise.resolve(), []),
  });
  const optionChartHydrationPolicy = useMemo(
    () =>
      resolveChartHydrationPolicy({
        timeframe: optionChartTimeframe,
        role: "option",
      }),
    [optionChartTimeframe],
  );
  const optionChartRequestPolicy = useMemo(
    () =>
      resolveChartHydrationRequestPolicy({
        timeframe: optionChartTimeframe,
        role: "option",
        requestedLimit: optionProgressiveBars.requestedLimit,
      }),
    [optionChartTimeframe, optionProgressiveBars.requestedLimit],
  );
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
    barsLimit: optionProgressiveBars.requestedLimit,
    outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
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
  useEffect(() => {
    if (optionBarsQuery.data?.bars?.length) {
      optionProgressiveBars.hydrateFullWindow();
    }
  }, [
    optionBarsQuery.data?.bars?.length,
    optionProgressiveBars.hydrateFullWindow,
  ]);
  useUnderfilledChartBackfill({
    scopeKey: optionChartScopeKey,
    enabled: Boolean(canRequestOptionChart && optionBarsQuery.data?.bars?.length),
    loadedBarCount: optionDisplayBars.length,
    requestedLimit: optionProgressiveBars.requestedLimit,
    minPageSize: optionChartHydrationPolicy.initialLimit,
    isPrependingOlder: isPrependingOlderOptionHistory,
    hasExhaustedOlderHistory: hasExhaustedOlderOptionHistory,
    prependOlderBars: prependOlderOptionBars,
  });
  const expandOptionVisibleLogicalRange = useCallback(
    (range) => {
      if (!canRequestOptionChart) {
        return;
      }

      optionProgressiveBars.expandForVisibleRange(range, optionDisplayBars.length, {
        hasExhaustedOlderHistory: hasExhaustedOlderOptionHistory,
        isHydratingRequestedWindow:
          optionBarsQuery.fetchStatus === "fetching" &&
          optionChartRequestPolicy.baseLimit > optionLoadedBaseBarCount,
        isPrependingOlder: isPrependingOlderOptionHistory,
        oldestLoadedAtMs: optionOldestLoadedAtMs,
        prependOlderBars: prependOlderOptionBars,
      });
    },
    [
      canRequestOptionChart,
      hasExhaustedOlderOptionHistory,
      isPrependingOlderOptionHistory,
      optionBarsQuery.fetchStatus,
      optionDisplayBars.length,
      optionChartRequestPolicy.baseLimit,
      optionLoadedBaseBarCount,
      optionOldestLoadedAtMs,
      optionProgressiveBars.expandForVisibleRange,
      prependOlderOptionBars,
    ],
  );
  const scheduleOptionVisibleRangeExpansion = useDebouncedVisibleRangeExpansion(
    expandOptionVisibleLogicalRange,
    {
      resetKey: optionChartScopeKey,
      recheckKey: [
        optionChartScopeKey,
        optionDisplayBars.length,
        optionBarsQuery.fetchStatus === "fetching" ? "fetching" : "settled",
        isPrependingOlderOptionHistory ? "prepending" : "ready",
        hasExhaustedOlderOptionHistory ? "exhausted" : "open",
      ].join(":"),
    },
  );
  const handleOptionChartTimeframeChange = useCallback((timeframe) => {
    const nextTimeframe = normalizeChartTimeframe(timeframe);
    if (!nextTimeframe || nextTimeframe === optionChartTimeframe) {
      return;
    }
    setOptionChartTimeframe(nextTimeframe);
    setOptionChartIntervalRevision((revision) => revision + 1);
  }, [optionChartTimeframe]);
  const optionChartViewportLayoutKey = optionChartIntervalRevision
    ? buildChartBarScopeKey(
        "flow-inspection-option-viewport",
        optionChartTimeframe,
        optionChartIntervalRevision,
      )
    : null;
  useEffect(() => {
    recordChartBarScopeState(optionChartScopeKey, {
      timeframe: optionChartTimeframe,
      role: "option",
      requestedLimit: optionProgressiveBars.requestedLimit,
      initialLimit: optionChartHydrationPolicy.initialLimit,
      baseRequestedLimit: optionChartRequestPolicy.baseLimit,
      targetLimit: optionProgressiveBars.targetLimit,
      maxLimit: optionProgressiveBars.maxLimit,
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
    optionChartHydrationPolicy.initialLimit,
    optionChartRequestPolicy.baseLimit,
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
    optionProgressiveBars.maxLimit,
    optionProgressiveBars.requestedLimit,
    optionProgressiveBars.targetLimit,
  ]);
  const optionChartModel = useMeasuredChartModel({
    scopeKey: optionChartScopeKey,
    bars: optionDisplayBars,
    buildInput: {
      bars: optionDisplayBars,
      timeframe: optionChartTimeframe,
      defaultVisibleBarCount: optionProgressiveBars.targetLimit,
    },
    deps: [
      optionDisplayBars,
      optionChartTimeframe,
      optionProgressiveBars.targetLimit,
    ],
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
        style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.sans }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: fs(10),
          color,
          fontWeight: 400,
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
            fontWeight: 400,
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
              fontWeight: 400,
              fontFamily: T.sans,
              color: T.text,
              letterSpacing: 0,
              whiteSpace: "nowrap",
            }}
          >
            {flowOptionContractLabel}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.sans,
              color: T.textDim,
              whiteSpace: "nowrap",
            }}
          >
            Exp {formatExpirationLabel(evt.expirationDate)}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.sans,
              color: evt.dte <= 1 ? T.red : evt.dte <= 7 ? T.amber : T.textDim,
              fontWeight: 400,
            }}
          >
            {evt.dte}DTE
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.sans,
              color: typeColor,
              fontWeight: 400,
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
              fontWeight: 400,
              fontFamily: T.sans,
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
              fontFamily: T.sans,
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
            fontWeight: 400,
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
                ? `${flowOptionContractShortLabel} · Notify on next big activity (>$100K)`
                : `${flowOptionContractShortLabel} · No longer watching this contract`,
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
            fontWeight: 400,
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
          gridTemplateColumns: `repeat(auto-fit, minmax(${dim(110)}px, 1fr))`,
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
                fontFamily: T.sans,
                fontWeight: 400,
                marginBottom: sp(2),
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: fs(10),
                color: item.color,
                fontFamily: T.sans,
                fontWeight: 400,
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
          gridTemplateColumns: `minmax(0, ${dim(440)}px) minmax(0, 1fr)`,
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
                fontWeight: 400,
                fontFamily: T.sans,
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
                fontWeight: 400,
                fontFamily: T.sans,
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
                <span style={{ color: cpColor, fontWeight: 400 }}>
                  {isCall ? "Call flow" : "Put flow"}
                </span>{" "}
                with a provider-reported {evt.side.toLowerCase()} side. This panel
                now shows only event fields that came back from the live flow
                provider.
              </div>
              <div>
                <span style={{ color: T.text, fontWeight: 400 }}>{flowRead}</span>
                {" · "}
                <span
                  style={{
                    color:
                      sentimentScore > 0
                        ? T.green
                        : sentimentScore < 0
                          ? T.red
                          : T.textDim,
                    fontWeight: 400,
                  }}
                >
                  {evt.sentiment || "sentiment unavailable"}
                </span>
              </div>
              <div style={{ color: T.textDim, fontFamily: T.sans }}>
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
                fontWeight: 400,
                fontFamily: T.sans,
                color: T.textSec,
                letterSpacing: "0.04em",
              }}
            >
              OPTION CHART
            </span>
            <span
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.sans }}
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
                viewportLayoutKey={optionChartViewportLayoutKey}
                model={optionChartModel}
                placement="inspection"
                positionOverlayContext={{
                  surfaceKind: "option",
                  symbol: chartSymbol,
                  optionContract: {
                    ticker: optionTicker,
                    underlying: chartSymbol,
                    expirationDate: optionExpirationIso,
                    strike: optionStrike,
                    right: optionRight,
                    providerContractId: effectiveProviderContractId || providerContractId,
                  },
                }}
                onVisibleLogicalRangeChange={scheduleOptionVisibleRangeExpansion}
                showLegend
                legend={{
                  symbol: chartSymbol || "OPTION",
                  name: flowOptionContractLabel,
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
                style={{ minHeight: 0, width: "100%" }}
                surfaceTopOverlay={(controls) => (
                  <ResearchChartWidgetHeader
                    theme={T}
                    controls={controls}
                    symbol={chartSymbol || "OPTION"}
                    name={flowOptionContractLabel}
                    priceLabel="Option"
                    price={optionLastPrice}
                    changePercent={optionChangePercent}
                    statusLabel={optionChartStatusLabel}
                    statusTone={optionChartSourceState.tone}
                    timeframe={optionChartTimeframe}
                    showInlineLegend={false}
                    timeframeOptions={OPTION_CHART_TIMEFRAMES}
                    favoriteTimeframes={optionFavoriteTimeframes}
                    onChangeTimeframe={handleOptionChartTimeframeChange}
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
                surfaceBottomOverlay={(controls) => (
                  <ResearchChartWidgetFooter
                    theme={T}
                    controls={controls}
                    dense
                    statusText={optionChartStatusLabel}
                  />
                )}
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
