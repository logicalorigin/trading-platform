import { useEffect, useMemo, useState } from "react";
import {
  getMassiveOptionBars,
  getMassiveOptionReplayDataset,
} from "../../lib/brokerClient.js";
import { buildChartDisplayModel } from "../chart/displayModel.js";
import {
  formatMarketTimestamp,
  getBarTimeMs,
  getEpochMsForMarketDateTime,
  parseMarketTimestamp,
} from "../market/time.js";
import { normalizeOptionHistoryBars } from "../options/history.js";
import {
  AUTO_STRIKE_SLOT_LABEL,
  formatStrikeSlotLabel,
} from "../options/strikeSelection.js";
import { buildIndicatorMarkerPayload } from "../chart/indicatorMarkerModel.js";
import {
  filterIndicatorEventsByStrategy,
  filterIndicatorWindowsByStrategy,
  filterIndicatorZonesByStrategy,
} from "../chart/researchChartOverlayFilters.js";

const OPTION_PANE_RANGE_KEY = "2Y";
const OPTION_PANE_LOOKBACK_DAYS = 1;
const OPTION_PANE_LOOKAHEAD_DAYS = 1;
const OPTION_PANE_MIN_VISIBLE_BARS_BY_TF = {
  "1m": 90,
  "2m": 84,
  "5m": 72,
  "15m": 48,
  "30m": 32,
  "1h": 24,
  D: 12,
};

function deriveTfMin(bars) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return 1;
  }
  const deltas = [];
  const step = Math.max(1, Math.floor(bars.length / 500));
  for (let index = 0; index < bars.length - 1; index += step) {
    const current = Number(bars[index]?.time);
    const next = Number(bars[index + 1]?.time);
    if (Number.isFinite(current) && Number.isFinite(next) && next > current) {
      deltas.push(Math.round((next - current) / 60000));
    }
  }
  if (!deltas.length) {
    return 1;
  }
  deltas.sort((left, right) => left - right);
  return Math.max(1, deltas[Math.floor(deltas.length / 2)]);
}

function shiftTradingDate(dateText, offset) {
  if (!dateText || !Number.isFinite(Number(offset)) || Number(offset) === 0) {
    return dateText;
  }

  const date = new Date(String(dateText).trim() + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }

  let remaining = Math.abs(Number(offset));
  const direction = Number(offset) > 0 ? 1 : -1;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + direction);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return date.toISOString().slice(0, 10);
}

function getTradeDateText(timestamp) {
  return String(timestamp || "").split(" ")[0] || null;
}

function getTradeTimestampMs(timestamp) {
  return parseMarketTimestamp(timestamp);
}

function buildSelectionWindow(selectedTrade, latestSpotMs = null) {
  if (!selectedTrade?.ts) {
    return null;
  }

  const entryMs = getTradeTimestampMs(selectedTrade.ts);
  if (!Number.isFinite(entryMs)) {
    return null;
  }

  const exitMs = getTradeTimestampMs(selectedTrade.et);
  const endMsCandidate = Number.isFinite(exitMs)
    ? exitMs
    : (Number.isFinite(latestSpotMs) && latestSpotMs >= entryMs ? latestSpotMs : entryMs);
  const endMs = Math.max(entryMs, endMsCandidate);
  const hasExit = Number.isFinite(exitMs);
  const entryDate = getTradeDateText(selectedTrade.ts);
  if (!entryDate) {
    return null;
  }

  const fromDate = shiftTradingDate(entryDate, -OPTION_PANE_LOOKBACK_DAYS);
  const endDate = formatMarketTimestamp(endMs).split(" ")[0];
  const toDate = shiftTradingDate(endDate, hasExit ? OPTION_PANE_LOOKAHEAD_DAYS : 0);
  return {
    entryMs,
    endMs,
    exitMs: Number.isFinite(exitMs) ? exitMs : null,
    fromDate,
    toDate,
    fromMs: getEpochMsForMarketDateTime(fromDate, 9, 30),
    dataEndMs: hasExit
      ? getEpochMsForMarketDateTime(toDate, 16, 1)
      : endMs,
  };
}

function filterSeriesByWindow(bars, selectionWindow) {
  if (!selectionWindow) {
    return [];
  }
  const fromMs = Number(selectionWindow.fromMs);
  const endMs = Number(selectionWindow.dataEndMs ?? selectionWindow.endMs);
  return (Array.isArray(bars) ? bars : []).filter((bar) => {
    const time = getBarTimeMs(bar);
    return Number.isFinite(time)
      && (!Number.isFinite(fromMs) || time >= fromMs)
      && (!Number.isFinite(endMs) || time <= endMs);
  });
}

function buildOptionDefaultVisibleLogicalRange({
  chartBarsLength,
  tradeOverlay = null,
  optionCandleTf = "1m",
  tradeHasExit = false,
}) {
  if (!Number.isFinite(chartBarsLength) || chartBarsLength <= 0) {
    return null;
  }

  const minVisibleBars = Math.max(
    1,
    Math.min(
      chartBarsLength,
      OPTION_PANE_MIN_VISIBLE_BARS_BY_TF[optionCandleTf] || 24,
    ),
  );

  if (!tradeOverlay) {
    return {
      from: Math.max(-0.5, chartBarsLength - minVisibleBars - 0.5),
      to: chartBarsLength - 0.5,
    };
  }

  const entryIndex = Number.isInteger(tradeOverlay?.entryBarIndex)
    ? tradeOverlay.entryBarIndex
    : 0;
  const rawEndIndex = Number.isInteger(tradeOverlay?.exitBarIndex)
    ? tradeOverlay.exitBarIndex
    : (tradeHasExit ? entryIndex : chartBarsLength - 1);
  const endIndex = Math.max(entryIndex, Math.min(chartBarsLength - 1, rawEndIndex));
  const tradeSpanBars = Math.max(1, endIndex - entryIndex + 1);
  const desiredVisibleBars = Math.min(
    chartBarsLength,
    Math.max(minVisibleBars, Math.round(tradeSpanBars * 1.8)),
  );
  const extraBars = Math.max(0, desiredVisibleBars - tradeSpanBars);
  const leftPaddingBars = Math.max(2, Math.floor(extraBars * 0.35));
  const rightPaddingBars = Math.max(2, extraBars - leftPaddingBars);

  let fromIndex = Math.max(0, entryIndex - leftPaddingBars);
  let toIndex = Math.min(chartBarsLength - 1, endIndex + rightPaddingBars);
  const visibleBars = toIndex - fromIndex + 1;
  if (visibleBars < desiredVisibleBars) {
    const missingBars = desiredVisibleBars - visibleBars;
    const extendRight = Math.min(chartBarsLength - 1 - toIndex, missingBars);
    toIndex += extendRight;
    const remainingBars = missingBars - extendRight;
    const extendLeft = Math.min(fromIndex, remainingBars);
    fromIndex -= extendLeft;
  }

  return {
    from: Math.max(-0.5, fromIndex - 0.5),
    to: Math.min(chartBarsLength - 0.5, toIndex + 0.5),
  };
}

function getTradeDirectionRight(trade) {
  return String(trade?.dir || "").trim().toLowerCase() === "short" ? "put" : "call";
}

function buildReplayEntryKey(entryTs, right, strategyUsed = "") {
  return [
    String(entryTs || "").trim(),
    String(right || "").trim().toLowerCase(),
    String(strategyUsed || "").trim().toLowerCase(),
  ].join("|");
}

function resolveSpotPriceAtEntry(selectedTrade, spotBars) {
  const entryMs = getTradeTimestampMs(selectedTrade?.ts);
  if (Number.isFinite(entryMs)) {
    const matchedBar = (Array.isArray(spotBars) ? spotBars : []).find((bar) => getBarTimeMs(bar) === entryMs) || null;
    if (matchedBar) {
      const open = Number(matchedBar?.o);
      const close = Number(matchedBar?.c);
      if (Number.isFinite(open) && open > 0) {
        return open;
      }
      if (Number.isFinite(close) && close > 0) {
        return close;
      }
    }
  }

  const fallbackSpot = Number(selectedTrade?.sp);
  return Number.isFinite(fallbackSpot) && fallbackSpot > 0 ? fallbackSpot : null;
}

function buildSelectedTradeReplayCandidate(selectedTrade, spotPrice) {
  const entryTs = String(selectedTrade?.ts || "").trim();
  const entryDate = getTradeDateText(entryTs);
  const direction = String(selectedTrade?.dir || "").trim().toLowerCase();
  if (!entryTs || !entryDate || !["long", "short"].includes(direction)) {
    return null;
  }

  if (!Number.isFinite(spotPrice)) {
    return null;
  }

  const right = getTradeDirectionRight(selectedTrade);
  return {
    key: buildReplayEntryKey(entryTs, right, selectedTrade?.strat || ""),
    signalTs: String(selectedTrade?.signalTs || entryTs).trim() || entryTs,
    entryTs,
    entryDate,
    direction,
    spotPrice,
  };
}

function buildTradeContractSummary(selectedTrade, optionTicker) {
  if (!optionTicker) {
    return null;
  }
  const strike = Number(selectedTrade?.k);
  return {
    optionTicker,
    expiryDate: String(selectedTrade?.expiryDate || "").trim() || null,
    strike: Number.isFinite(strike) ? strike : null,
    right: getTradeDirectionRight(selectedTrade),
    actualDteAtEntry: Number.isFinite(Number(selectedTrade?.actualDteAtEntry))
      ? Number(selectedTrade.actualDteAtEntry)
      : null,
    selectionStrikeSlot: Number.isFinite(Number(selectedTrade?.selectionStrikeSlot))
      ? Number(selectedTrade.selectionStrikeSlot)
      : null,
    selectionStrikeLabel: String(selectedTrade?.selectionStrikeLabel || "").trim() || null,
    selectionMoneyness: String(selectedTrade?.selectionMoneyness || "").trim() || null,
    selectionSteps: Number.isFinite(Number(selectedTrade?.selectionSteps))
      ? Number(selectedTrade.selectionSteps)
      : null,
  };
}

function formatLegacyStrikeSummary(moneyness, strikeSteps) {
  const tone = String(moneyness || "").trim().toUpperCase();
  if (!tone) {
    return AUTO_STRIKE_SLOT_LABEL;
  }
  if (tone === "ATM") {
    return "ATM";
  }
  const steps = Number.isFinite(Number(strikeSteps)) ? Number(strikeSteps) : 1;
  return `${tone} ${steps} step${steps === 1 ? "" : "s"}`;
}

function formatSelectionSpecSummary(selectionSpec = {}) {
  const minDte = Number.isFinite(Number(selectionSpec?.minDte)) ? Number(selectionSpec.minDte) : null;
  const maxDte = Number.isFinite(Number(selectionSpec?.maxDte)) ? Number(selectionSpec.maxDte) : null;
  const targetDte = Number.isFinite(Number(selectionSpec?.targetDte)) ? Number(selectionSpec.targetDte) : null;
  let dteLabel = "--D";
  if (minDte != null && maxDte != null) {
    dteLabel = minDte === maxDte ? `${minDte}D` : `${minDte}-${maxDte}D`;
  } else if (targetDte != null) {
    dteLabel = `${targetDte}D`;
  }

  const strikeSlot = Number(selectionSpec?.strikeSlot);
  const strikeLabel = Number.isFinite(strikeSlot)
    ? formatStrikeSlotLabel(strikeSlot)
    : formatLegacyStrikeSummary(selectionSpec?.moneyness, selectionSpec?.strikeSteps);

  return `${dteLabel} · ${strikeLabel}`;
}

function createResolutionMeta({
  status = "idle",
  resolutionSource = "replay_dataset",
  selectionSummary = "",
  selectedTrade = null,
  entrySpotPrice = null,
  selectionFromDate = null,
  selectionToDate = null,
  optionTicker = null,
  skipReason = null,
  barCount = 0,
  lastBarTs = null,
  message = null,
} = {}) {
  const normalizedSource = String(resolutionSource || "replay_dataset").trim().toLowerCase() || "replay_dataset";
  return {
    status: String(status || "idle"),
    resolutionSource: normalizedSource,
    resolutionLabel: normalizedSource === "direct_ticker" ? "Direct ticker" : "Massive resolution",
    selectionSummary: String(selectionSummary || "").trim() || "--",
    entryTs: String(selectedTrade?.ts || "").trim() || null,
    exitTs: String(selectedTrade?.et || "").trim() || null,
    entrySpotPrice: Number.isFinite(Number(entrySpotPrice)) ? Number(entrySpotPrice) : null,
    requestedWindow: {
      fromDate: String(selectionFromDate || "").trim() || null,
      toDate: String(selectionToDate || "").trim() || null,
    },
    optionTicker: String(optionTicker || "").trim() || null,
    skipReason: String(skipReason || "").trim() || null,
    barCount: Math.max(0, Number(barCount) || 0),
    lastBarTs: String(lastBarTs || "").trim() || null,
    message: String(message || "").trim() || null,
  };
}

function describeReplaySkipReason(reason) {
  const normalized = String(reason || "").trim().toLowerCase();
  if (!normalized) {
    return "Massive could not resolve a real contract for the selected trade.";
  }
  if (normalized === "contract_not_found") {
    return "Massive could not find a contract in the configured DTE and strike window for the selected trade.";
  }
  if (normalized === "bars_not_found") {
    return "Massive resolved a contract but returned no historical bars for the selected trade window.";
  }
  if (normalized === "invalid_chain") {
    return "Massive found an option chain for the selected trade date, but it could not resolve the requested strike slot.";
  }
  return "Massive could not resolve a real contract for the selected trade (" + normalized + ").";
}

export function useResearchOptionChart({
  selectedTrade = null,
  executionMode = "option_history",
  marketSymbol = "SPY",
  optionSelectionSpec = {},
  optionCandleTf = "1m",
  apiCreds = {},
  spotBars = [],
  indicatorOverlayTape = null,
  indicatorWindowTape = null,
  defaultIv = 0.20,
} = {}) {
  void executionMode;
  void defaultIv;

  const [resolvedBars, setResolvedBars] = useState([]);
  const [resolvedContract, setResolvedContract] = useState(null);
  const [replayStatus, setReplayStatus] = useState("idle");
  const [replayError, setReplayError] = useState(null);
  const [resolutionMeta, setResolutionMeta] = useState(null);
  const stableSelectionSpec = useMemo(() => ({
    targetDte: optionSelectionSpec?.targetDte ?? null,
    minDte: optionSelectionSpec?.minDte ?? null,
    maxDte: optionSelectionSpec?.maxDte ?? null,
    strikeSlot: optionSelectionSpec?.strikeSlot ?? null,
    moneyness: optionSelectionSpec?.moneyness ?? null,
    strikeSteps: optionSelectionSpec?.strikeSteps ?? null,
  }), [
    optionSelectionSpec?.targetDte,
    optionSelectionSpec?.maxDte,
    optionSelectionSpec?.minDte,
    optionSelectionSpec?.moneyness,
    optionSelectionSpec?.strikeSlot,
    optionSelectionSpec?.strikeSteps,
  ]);

  const directOptionTicker = String(selectedTrade?.optionTicker || "").trim();
  const selectionSummary = useMemo(
    () => formatSelectionSpecSummary(stableSelectionSpec),
    [stableSelectionSpec],
  );
  const resolvedEntrySpotPrice = useMemo(
    () => resolveSpotPriceAtEntry(selectedTrade, spotBars),
    [selectedTrade?.sp, selectedTrade?.ts, spotBars],
  );
  const latestSpotMs = useMemo(() => {
    if (String(selectedTrade?.et || "").trim()) {
      return null;
    }
    return Array.isArray(spotBars) && spotBars.length
      ? getBarTimeMs(spotBars[spotBars.length - 1])
      : null;
  }, [selectedTrade?.et, spotBars]);
  const replayCandidate = useMemo(
    () => buildSelectedTradeReplayCandidate(selectedTrade, resolvedEntrySpotPrice),
    [
      resolvedEntrySpotPrice,
      selectedTrade?.dir,
      selectedTrade?.signalTs,
      selectedTrade?.strat,
      selectedTrade?.ts,
    ],
  );
  const selectionWindow = useMemo(
    () => buildSelectionWindow(selectedTrade, latestSpotMs),
    [latestSpotMs, selectedTrade?.et, selectedTrade?.ts],
  );
  const selectionFromDate = selectionWindow?.fromDate || null;
  const selectionToDate = selectionWindow?.toDate || null;
  const normalizedUnderlying = String(marketSymbol || "").trim().toUpperCase();
  const directTradeContract = useMemo(
    () => buildTradeContractSummary(selectedTrade, directOptionTicker),
    [directOptionTicker, selectedTrade],
  );

  useEffect(() => {
    let cancelled = false;

    if (!selectedTrade) {
      setResolvedBars([]);
      setResolvedContract(null);
      setReplayStatus("empty");
      setReplayError(null);
      setResolutionMeta(null);
      return () => {
        cancelled = true;
      };
    }

    if (!selectionFromDate || !selectionToDate) {
      setResolvedBars([]);
      setResolvedContract(directTradeContract);
      setReplayStatus("empty");
      setReplayError("Selected trade is missing timing needed to load Massive bars.");
      setResolutionMeta(createResolutionMeta({
        status: "error",
        resolutionSource: directOptionTicker ? "direct_ticker" : "replay_dataset",
        selectionSummary,
        selectedTrade,
        entrySpotPrice: resolvedEntrySpotPrice,
        selectionFromDate,
        selectionToDate,
        optionTicker: directOptionTicker || directTradeContract?.optionTicker || null,
        skipReason: "missing_timing",
        message: "Selected trade is missing timing needed to load Massive bars.",
      }));
      return () => {
        cancelled = true;
      };
    }

    const loadRealOptionHistory = async () => {
      setResolvedBars([]);
      setResolvedContract(directTradeContract);
      setReplayStatus("loading");
      setReplayError(null);
      setResolutionMeta(createResolutionMeta({
        status: "loading",
        resolutionSource: directOptionTicker ? "direct_ticker" : "replay_dataset",
        selectionSummary,
        selectedTrade,
        entrySpotPrice: resolvedEntrySpotPrice,
        selectionFromDate,
        selectionToDate,
        optionTicker: directOptionTicker || directTradeContract?.optionTicker || null,
        message: directOptionTicker
          ? "Loading Massive bars for the selected trade contract."
          : "Resolving a real Massive contract for the selected trade.",
      }));

      try {
        if (directOptionTicker) {
          const payload = await getMassiveOptionBars({
            optionTicker: directOptionTicker,
            from: selectionFromDate,
            to: selectionToDate,
            multiplier: 1,
            timespan: "minute",
            adjusted: true,
            sort: "asc",
            limit: 50000,
            apiKey: apiCreds.MASSIVE_API_KEY || apiCreds.POLYGON_API_KEY || "",
          });
          if (cancelled) {
            return;
          }

          const nextBars = filterSeriesByWindow(
            normalizeOptionHistoryBars(payload?.bars || []),
            selectionWindow,
          );
          setResolvedContract(directTradeContract);
          setResolvedBars(nextBars);
          setReplayStatus(nextBars.length ? "ready" : "empty");
          setReplayError(null);
          setResolutionMeta(createResolutionMeta({
            status: nextBars.length ? "ready" : "empty",
            resolutionSource: "direct_ticker",
            selectionSummary,
            selectedTrade,
            entrySpotPrice: resolvedEntrySpotPrice,
            selectionFromDate,
            selectionToDate,
            optionTicker: directOptionTicker,
            skipReason: nextBars.length ? null : "bars_not_found",
            barCount: nextBars.length,
            lastBarTs: nextBars[nextBars.length - 1]?.ts || null,
            message: nextBars.length
              ? "Loaded Massive bars from the selected trade contract."
              : "No Massive option bars were found for the selected trade contract window.",
          }));
          return;
        }

        if (!normalizedUnderlying) {
          throw new Error("Underlying symbol is required to resolve a Massive contract for the selected trade.");
        }
        if (!replayCandidate) {
          throw new Error("Selected trade is missing the timing, direction, or spot price needed to resolve a Massive contract.");
        }

        const payload = await getMassiveOptionReplayDataset({
          underlyingTicker: normalizedUnderlying,
          replayEndDate: selectionToDate,
          selectionSpec: stableSelectionSpec,
          candidates: [replayCandidate],
          apiKey: apiCreds.MASSIVE_API_KEY || apiCreds.POLYGON_API_KEY || "",
        });
        if (cancelled) {
          return;
        }

        const nextContract = payload?.contractsByKey?.[replayCandidate.key] || null;
        if (!nextContract?.optionTicker) {
          const skipReason = payload?.skippedByKey?.[replayCandidate.key]?.reason || null;
          const message = describeReplaySkipReason(skipReason);
          setResolvedContract(null);
          setResolvedBars([]);
          setReplayStatus("empty");
          setReplayError(message);
          setResolutionMeta(createResolutionMeta({
            status: "empty",
            resolutionSource: "replay_dataset",
            selectionSummary,
            selectedTrade,
            entrySpotPrice: resolvedEntrySpotPrice,
            selectionFromDate,
            selectionToDate,
            skipReason,
            message,
          }));
          return;
        }

        const nextBars = filterSeriesByWindow(
          normalizeOptionHistoryBars(payload?.barsByTicker?.[nextContract.optionTicker] || []),
          selectionWindow,
        );
        setResolvedContract(nextContract);
        setResolvedBars(nextBars);
        setReplayStatus(nextBars.length ? "ready" : "empty");
        setReplayError(nextBars.length ? null : "No Massive option bars were found for the resolved contract window.");
        setResolutionMeta(createResolutionMeta({
          status: nextBars.length ? "ready" : "empty",
          resolutionSource: "replay_dataset",
          selectionSummary,
          selectedTrade,
          entrySpotPrice: resolvedEntrySpotPrice,
          selectionFromDate,
          selectionToDate,
          optionTicker: nextContract.optionTicker,
          skipReason: nextBars.length ? null : "bars_not_found",
          barCount: nextBars.length,
          lastBarTs: nextBars[nextBars.length - 1]?.ts || null,
          message: nextBars.length
            ? "Resolved a real Massive contract and loaded its historical bars."
            : "No Massive option bars were found for the resolved contract window.",
        }));
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setResolvedBars([]);
        setResolvedContract(directTradeContract);
        setReplayStatus("error");
        setReplayError(nextError?.message || "Failed to load Massive option history.");
        setResolutionMeta(createResolutionMeta({
          status: "error",
          resolutionSource: directOptionTicker ? "direct_ticker" : "replay_dataset",
          selectionSummary,
          selectedTrade,
          entrySpotPrice: resolvedEntrySpotPrice,
          selectionFromDate,
          selectionToDate,
          optionTicker: directOptionTicker || directTradeContract?.optionTicker || null,
          message: nextError?.message || "Failed to load Massive option history.",
        }));
      }
    };

    loadRealOptionHistory();
    return () => {
      cancelled = true;
    };
  }, [
    apiCreds.MASSIVE_API_KEY,
    apiCreds.POLYGON_API_KEY,
    directOptionTicker,
    directTradeContract,
    normalizedUnderlying,
    replayCandidate,
    resolvedEntrySpotPrice,
    selectionSummary,
    selectedTrade,
    selectionFromDate,
    selectionToDate,
    selectionWindow,
    stableSelectionSpec,
  ]);

  const effectiveContract = directOptionTicker ? directTradeContract : resolvedContract;
  const effectiveOptionTicker = String(effectiveContract?.optionTicker || "").trim();
  const hasResolvedContract = effectiveOptionTicker.length > 0;
  const optionChartMode = hasResolvedContract ? "massive" : "unavailable";
  const optionBars = resolvedBars;
  const optionChartStatus = hasResolvedContract ? replayStatus : (replayStatus === "loading" ? "loading" : "empty");
  const optionChartError = replayError || null;
  const tfMin = useMemo(() => deriveTfMin(optionBars), [optionBars]);
  const resolvedIndicatorOverlayTape = useMemo(() => ({
    events: Array.isArray(indicatorOverlayTape?.events) ? indicatorOverlayTape.events : [],
    zones: Array.isArray(indicatorOverlayTape?.zones) ? indicatorOverlayTape.zones : [],
    windows: Array.isArray(indicatorWindowTape?.windows)
      ? indicatorWindowTape.windows
      : (Array.isArray(indicatorOverlayTape?.windows) ? indicatorOverlayTape.windows : []),
  }), [indicatorOverlayTape, indicatorWindowTape]);

  const overlayStrategy = useMemo(
    () => selectedTrade?.strat,
    [selectedTrade?.strat],
  );
  const {
    chartBars,
    chartBarRanges,
    tradeOverlays,
    entriesByBarIndex,
    exitsByBarIndex,
    indicatorEvents: rawIndicatorEvents,
    indicatorZones: rawIndicatorZones,
    indicatorWindows: rawIndicatorWindows,
  } = useMemo(
    () => buildChartDisplayModel({
      bars: optionBars,
      dailyBars: [],
      chartRange: OPTION_PANE_RANGE_KEY,
      effectiveTf: optionCandleTf,
      tfMin,
      trades: selectedTrade ? [selectedTrade] : [],
      pricingMode: "option_history",
      chartPriceContext: "option",
      indicatorOverlayTape: resolvedIndicatorOverlayTape,
    }),
    [optionBars, optionCandleTf, resolvedIndicatorOverlayTape, selectedTrade, tfMin],
  );
  const indicatorEvents = useMemo(
    () => filterIndicatorEventsByStrategy(rawIndicatorEvents, overlayStrategy),
    [overlayStrategy, rawIndicatorEvents],
  );
  const indicatorZones = useMemo(
    () => filterIndicatorZonesByStrategy(rawIndicatorZones, overlayStrategy),
    [overlayStrategy, rawIndicatorZones],
  );
  const indicatorWindows = useMemo(
    () => filterIndicatorWindowsByStrategy(rawIndicatorWindows, overlayStrategy),
    [overlayStrategy, rawIndicatorWindows],
  );
  const optionIndicatorMarkerPayload = useMemo(
    () => buildIndicatorMarkerPayload(chartBars, indicatorEvents),
    [chartBars, indicatorEvents],
  );
  const optionDefaultVisibleLogicalRange = useMemo(
    () => buildOptionDefaultVisibleLogicalRange({
      chartBarsLength: chartBars.length,
      tradeOverlay: tradeOverlays[0] || null,
      optionCandleTf,
      tradeHasExit: Boolean(String(selectedTrade?.et || "").trim()),
    }),
    [chartBars.length, optionCandleTf, selectedTrade?.et, tradeOverlays],
  );

  const optionChartSourceLabel = useMemo(() => {
    if (!selectedTrade) {
      return "Massive history";
    }
    if (!hasResolvedContract) {
      return replayStatus === "loading" ? "Resolving Massive contract" : "No Massive contract";
    }
    const lastBar = chartBars[chartBars.length - 1];
    if (!lastBar) {
      return directOptionTicker ? "Massive" : "Massive · resolved from selected trade";
    }
    return (directOptionTicker ? "Massive" : "Massive · resolved from selected trade") + " · " + (lastBar.ts || formatMarketTimestamp(lastBar.time));
  }, [chartBars, directOptionTicker, hasResolvedContract, replayStatus, selectedTrade]);

  const optionChartEmptyStateLabel = useMemo(() => {
    if (!selectedTrade) {
      return "Select a trade to inspect real option pricing from Massive.";
    }
    if (replayStatus === "loading") {
      return directOptionTicker
        ? "Loading selected trade pricing from Massive..."
        : "Resolving a real Massive contract for the selected trade...";
    }
    if (replayError) {
      return replayError;
    }
    if (!hasResolvedContract) {
      return "Massive could not resolve a real contract for the selected trade.";
    }
    if (replayStatus === "empty") {
      return "No Massive option bars were found for the selected trade window.";
    }
    return "No Massive option history available for the selected trade.";
  }, [directOptionTicker, hasResolvedContract, replayError, replayStatus, selectedTrade]);

  return {
    optionChartMode,
    optionBars,
    optionChartBars: chartBars,
    optionChartBarRanges: chartBarRanges,
    optionDefaultVisibleLogicalRange,
    optionTradeOverlays: tradeOverlays,
    optionEntriesByBarIndex: entriesByBarIndex,
    optionExitsByBarIndex: exitsByBarIndex,
    optionIndicatorMarkerPayload,
    optionIndicatorZones: indicatorZones,
    optionIndicatorWindows: indicatorWindows,
    optionChartStatus,
    optionChartError,
    optionChartSourceLabel,
    optionChartEmptyStateLabel,
    resolvedOptionContract: effectiveContract,
    resolvedOptionTicker: effectiveOptionTicker || null,
    optionResolutionMeta: resolutionMeta,
  };
}
