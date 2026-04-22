import React from "react";
import ResearchSpotChart from "./ResearchSpotChart.jsx";
import { B, BORDER, CARD, F, FS, G, M, R, SH1, Y } from "./insights/shared.jsx";
import {
  LinkToggleChip,
  PANEL_HEADER_BACKGROUND,
  PANEL_RADIUS,
  PANEL_VIEWPORT_BACKGROUND,
  SelectionDropdown,
  TEXT,
} from "./chartUi.jsx";
import { parseOptionTicker } from "../../research/options/optionTicker.js";
import { DEFAULT_RESEARCH_STRATEGY, getStrategyLabel } from "../../research/config/strategyPresets.js";
import { formatMarketDateLabel } from "../../research/market/time.js";
import {
  DEFAULT_CHART_TYPE,
  VOLUME_CHART_TYPE,
} from "../../research/chart/volumeChartType.js";

const OPTION_TIMEFRAME_OPTIONS = ["1m", "2m", "5m", "15m", "30m", "1h", "D"];
const OPTION_TIMEFRAME_MENU_SECTIONS = [
  {
    label: "Intraday",
    options: OPTION_TIMEFRAME_OPTIONS.filter((value) => value.endsWith("m") || value.endsWith("h"))
      .map((value) => ({ value, label: value })),
  },
  {
    label: "Higher",
    options: OPTION_TIMEFRAME_OPTIONS.filter((value) => value === "D")
      .map((value) => ({ value, label: value })),
  },
];
const OPTION_CHART_TYPE_MENU_SECTIONS = [
  {
    label: "Price",
    options: [
      { value: DEFAULT_CHART_TYPE, label: "Candles" },
      { value: VOLUME_CHART_TYPE, label: "Volume candles" },
    ],
  },
];

function formatTimestamp(value) {
  const text = String(value || "").trim();
  return text || "--";
}

function formatTradePnl(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { label: "--", tone: "neutral" };
  }
  return {
    label: (numeric >= 0 ? "+" : "-") + "$" + Math.abs(numeric).toFixed(2),
    tone: numeric >= 0 ? "positive" : "negative",
  };
}

function resolveTradeEntryPrice(trade) {
  const numeric = Number(trade?.oe);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function resolveTradeExitPrice(trade) {
  const exitFill = Number(trade?.exitFill);
  if (Number.isFinite(exitFill) && exitFill >= 0) {
    return exitFill;
  }
  const exitMark = Number(trade?.ep);
  return Number.isFinite(exitMark) && exitMark >= 0 ? exitMark : null;
}

function resolveTradeBarsHeld(trade) {
  const entryBarIndex = Number(trade?.entryBarIndex);
  const exitBarIndex = Number(trade?.exitBarIndex);
  if (!Number.isFinite(entryBarIndex) || !Number.isFinite(exitBarIndex)) {
    return null;
  }
  return Math.max(1, Math.round(exitBarIndex - entryBarIndex + 1));
}

function formatTradeExpiry(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "--";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return formatMarketDateLabel(text);
  }
  const normalized = new Date(text);
  if (Number.isNaN(normalized.getTime())) {
    return text;
  }
  return normalized.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTradeReason(value) {
  const text = String(value || "").trim();
  return text ? text.replace(/_/g, " ") : "";
}

function formatStrike(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.?0+$/, "");
}

function formatMoney(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return "$" + numeric.toFixed(digits);
}

function formatResolutionWindow(resolutionMeta = null) {
  const fromDate = String(resolutionMeta?.requestedWindow?.fromDate || "").trim();
  const toDate = String(resolutionMeta?.requestedWindow?.toDate || "").trim();
  if (fromDate && toDate) {
    return fromDate === toDate ? fromDate : `${fromDate} -> ${toDate}`;
  }
  return fromDate || toDate || "--";
}

function formatResolutionBars(resolutionMeta = null) {
  if (!resolutionMeta) {
    return "--";
  }
  if (resolutionMeta.status === "loading") {
    return "Pending";
  }
  return `${Math.max(0, Number(resolutionMeta.barCount) || 0)} bars`;
}

function clampPricePrecision(value, min = 2, max = 4) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

function detectNumericPrecision(value, maxPrecision = 4) {
  const numeric = Math.abs(Number(value));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  for (let precision = 0; precision <= maxPrecision; precision += 1) {
    if (Math.abs(Number(numeric.toFixed(precision)) - numeric) < 1e-8) {
      return precision;
    }
  }
  return maxPrecision;
}

function deriveOptionPricePrecision(bars = []) {
  let detectedPrecision = 0;
  let minPositive = Infinity;
  let inspectedValues = 0;

  for (const bar of Array.isArray(bars) ? bars : []) {
    for (const field of ["o", "h", "l", "c"]) {
      const value = Math.abs(Number(bar?.[field]));
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value > 0) {
        minPositive = Math.min(minPositive, value);
      }
      detectedPrecision = Math.max(detectedPrecision, detectNumericPrecision(value));
      inspectedValues += 1;
      if (inspectedValues >= 400) {
        break;
      }
    }
    if (inspectedValues >= 400) {
      break;
    }
  }

  const minimumPrecision = Number.isFinite(minPositive) && minPositive < 0.1 ? 3 : 2;
  return clampPricePrecision(Math.max(minimumPrecision, detectedPrecision));
}

function resolveContractDetails(trade, resolvedOptionContract, optionChartStatus = "idle") {
  const rawTicker = String(resolvedOptionContract?.optionTicker || trade?.optionTicker || "").trim();
  const actualDteAtEntry = Number.isFinite(Number(resolvedOptionContract?.actualDteAtEntry))
    ? Number(resolvedOptionContract.actualDteAtEntry)
    : (rawTicker && Number.isFinite(Number(trade?.actualDteAtEntry)) ? Number(trade.actualDteAtEntry) : null);
  const parsed = parseOptionTicker(rawTicker);
  if (parsed) {
    return {
      contract: parsed.optionTicker,
      expiry: parsed.expiry,
      strike: formatStrike(parsed.strike),
      side: parsed.rightCode === "C" ? "Call" : "Put",
      actualDteAtEntry,
    };
  }
  if (rawTicker) {
    return {
      contract: rawTicker,
      expiry: "--",
      strike: "--",
      side: "--",
      actualDteAtEntry,
    };
  }
  if (optionChartStatus === "loading") {
    return {
      contract: "Resolving Massive contract...",
      expiry: "--",
      strike: "--",
      side: "--",
      actualDteAtEntry: null,
    };
  }
  return {
    contract: "Massive contract unavailable",
    expiry: "--",
    strike: "--",
    side: "--",
    actualDteAtEntry: null,
  };
}

function CompactBadge({ label, value, tone = "neutral" }) {
  const color = tone === "positive" ? G : tone === "negative" ? R : tone === "accent" ? B : "#0f172a";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        padding: "4px 8px",
        border: "1px solid " + BORDER,
        borderRadius: 999,
        background: "#ffffff",
      }}
    >
      <span style={{ fontSize: 9, fontFamily: FS, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontSize: 11, fontFamily: F, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </span>
    </div>
  );
}

function ResearchWorkbenchOptionPanel({
  marketSymbol,
  selectedTrade,
  selectedTradeId,
  optionChartMode,
  optionChartBars,
  optionChartBarRanges,
  optionDefaultVisibleLogicalRange,
  optionTradeOverlays,
  optionEntriesByBarIndex,
  optionExitsByBarIndex,
  optionIndicatorMarkerPayload,
  optionIndicatorZones,
  optionIndicatorWindows,
  optionChartStatus,
  optionChartError,
  optionChartSourceLabel,
  optionChartEmptyStateLabel,
  contractSelectionLabel = "",
  resolvedOptionContract,
  resolvedOptionTicker,
  optionResolutionMeta = null,
  optionCandleTf = "1m",
  optionChartType = DEFAULT_CHART_TYPE,
  setOptionCandleTf = null,
  setOptionChartType = null,
  rayalgoCandleColorMode = "rayalgo",
  showSignals = true,
  showZones = true,
  linkedViewportStore = null,
  coordinationModel = null,
}) {
  void optionChartMode;
  const {
    chartsLinked = true,
    setChartsLinked = null,
    viewportLeaderChartId = "spot",
    onViewportChange = null,
    chartId = "option",
    selectionLinkToken = 0,
    selectionLinkSourceChartId = null,
  } = coordinationModel || {};
  const tradePnl = formatTradePnl(selectedTrade?.pnl);
  const contract = resolveContractDetails(selectedTrade, resolvedOptionContract, optionChartStatus);
  const optionPricePrecision = React.useMemo(
    () => deriveOptionPricePrecision(optionChartBars),
    [optionChartBars],
  );
  const selectedTradeHeaderSummary = React.useMemo(() => {
    if (!selectedTrade) {
      return null;
    }
    const strategyLabel = getStrategyLabel(
      String(selectedTrade?.strat || DEFAULT_RESEARCH_STRATEGY).trim() || DEFAULT_RESEARCH_STRATEGY,
    );
    const entryPrice = resolveTradeEntryPrice(selectedTrade);
    const exitPrice = resolveTradeExitPrice(selectedTrade);
    const barsHeld = resolveTradeBarsHeld(selectedTrade);
    const expiryLabel = formatTradeExpiry(contract.expiry !== "--" ? contract.expiry : selectedTrade?.expiryDate);
    const summaryParts = [
      Number.isFinite(entryPrice) ? `Entry ${formatMoney(entryPrice, optionPricePrecision)}` : null,
      Number.isFinite(exitPrice) ? `Exit ${formatMoney(exitPrice, optionPricePrecision)}` : "Open",
      Number.isFinite(barsHeld) ? `${barsHeld} bars` : null,
      expiryLabel !== "--" ? expiryLabel : null,
    ].filter(Boolean);
    return {
      directionLabel: selectedTrade?.dir === "short" ? "Short" : "Long",
      directionTone: selectedTrade?.dir === "short" ? "negative" : "positive",
      strategyLabel,
      summaryLabel: summaryParts.join(" · "),
      reasonLabel: formatTradeReason(selectedTrade?.er),
    };
  }, [contract.expiry, optionPricePrecision, selectedTrade]);
  const [openMenu, setOpenMenu] = React.useState(null);
  const [selectionPulseActive, setSelectionPulseActive] = React.useState(false);
  const controlsRef = React.useRef(null);
  const statusTone = optionChartStatus === "error"
    ? R
    : optionChartStatus === "loading"
      ? Y
      : optionChartStatus === "ready"
        ? B
        : M;
  const hasResolvedContract = Boolean(String(resolvedOptionTicker || selectedTrade?.optionTicker || "").trim());
  const pricingPill = hasResolvedContract
    ? "Massive"
    : (optionChartStatus === "loading" ? "Resolving" : "No Contract");
  const contractSummary = [
    contract.expiry !== "--" ? "Exp " + contract.expiry : null,
    contract.side !== "--" ? contract.side + " " + contract.strike : null,
    Number.isFinite(Number(contract.actualDteAtEntry)) ? String(Number(contract.actualDteAtEntry)) + "D" : null,
  ].filter(Boolean).join(" · ") || "Resolved from Massive contract metadata when available";
  const statusLine = optionChartError || optionResolutionMeta?.message || optionChartSourceLabel || pricingPill;
  const tradeWindowLabel = selectedTrade
    ? `${formatTimestamp(selectedTrade.ts)} -> ${formatTimestamp(selectedTrade.et)}`
    : "Awaiting selection";
  const viewLabel = `${optionCandleTf} · ${optionChartBars.length}`;
  const chartTypeValue = optionChartType === VOLUME_CHART_TYPE ? "Volume candles" : "Candles";
  const statusDetail = Number.isFinite(Number(contract.actualDteAtEntry))
    ? `${statusLine} · ${Number(contract.actualDteAtEntry)}D entry`
    : statusLine;
  const compactStatusText = optionChartError
    ? optionChartError
    : (optionChartStatus === "loading" ? "Loading Massive history" : statusDetail);
  const resolutionWindowLabel = formatResolutionWindow(optionResolutionMeta);
  const resolutionBarsLabel = formatResolutionBars(optionResolutionMeta);
  const resolutionPathLabel = !selectedTrade
    ? "Awaiting trade"
    : optionResolutionMeta?.resolutionSource === "direct_ticker"
      ? "Trade ticker"
      : optionResolutionMeta?.resolutionSource === "replay_dataset"
        ? "Massive replay"
        : (optionChartStatus === "loading" ? "Resolving" : "Pending");
  const optionChartRangeKey = "option-panel:"
    + (selectedTradeId || "empty")
    + "|" + optionCandleTf;
  const provenanceItems = selectedTrade ? [
    { label: "Link", value: selectionLinkSourceChartId === "spot" ? "Spot-linked" : "Active", tone: selectionLinkSourceChartId === "spot" ? "accent" : "neutral" },
    { label: "Path", value: resolutionPathLabel, tone: hasResolvedContract ? "accent" : "neutral" },
    { label: "Input", value: optionResolutionMeta?.selectionSummary || "--" },
    { label: "Entry", value: formatMoney(optionResolutionMeta?.entrySpotPrice) },
    { label: "Window", value: resolutionWindowLabel },
    { label: "Bars", value: resolutionBarsLabel, tone: Number(optionResolutionMeta?.barCount) > 0 ? "accent" : "neutral" },
  ] : [];

  React.useEffect(() => {
    if (!openMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!controlsRef.current?.contains(event.target)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  React.useEffect(() => {
    if (!selectionLinkToken || selectionLinkSourceChartId !== "spot") {
      return undefined;
    }
    setSelectionPulseActive(true);
    const timer = window.setTimeout(() => {
      setSelectionPulseActive(false);
    }, 950);
    return () => window.clearTimeout(timer);
  }, [selectionLinkSourceChartId, selectionLinkToken]);

  return (
    <div
      style={{
        background: CARD,
        border: "1px solid " + (selectionPulseActive ? `${B}60` : BORDER),
        borderRadius: PANEL_RADIUS,
        display: "flex",
        flexDirection: "column",
        minHeight: 620,
        overflow: "hidden",
        boxShadow: selectionPulseActive
          ? "0 0 0 1px rgba(79,70,229,0.10), 0 16px 34px rgba(79,70,229,0.12)"
          : SH1,
        transition: "border-color 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      <div
        style={{
          padding: "7px 9px",
          borderBottom: "1px solid " + BORDER,
          background: PANEL_HEADER_BACKGROUND,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div
            ref={controlsRef}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              minWidth: 0,
              flex: "1 1 300px",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 250px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8", whiteSpace: "nowrap" }}>
                  {selectionLinkSourceChartId === "spot" ? "Spot-linked option" : "Option Replay"}
                </div>
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: statusTone,
                    boxShadow: `0 0 0 3px ${statusTone}12`,
                    flexShrink: 0,
                  }}
                />
                <div style={{ fontSize: 11, fontFamily: F, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {contractSummary}
                </div>
              </div>
              <div style={{ marginTop: 1, fontSize: 13, fontFamily: F, fontWeight: 700, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {contract.contract}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <SelectionDropdown
                label="Interval"
                value={optionCandleTf}
                selectedValue={optionCandleTf}
                sections={OPTION_TIMEFRAME_MENU_SECTIONS}
                open={openMenu === "timeframe"}
                onToggle={() => setOpenMenu((current) => (current === "timeframe" ? null : "timeframe"))}
                onSelect={(value) => {
                  if (typeof setOptionCandleTf === "function") {
                    setOptionCandleTf(value);
                  }
                  setOpenMenu(null);
                }}
                width={184}
              />
              <SelectionDropdown
                label="Style"
                value={chartTypeValue}
                selectedValue={optionChartType}
                sections={OPTION_CHART_TYPE_MENU_SECTIONS}
                open={openMenu === "chart-type"}
                onToggle={() => setOpenMenu((current) => (current === "chart-type" ? null : "chart-type"))}
                onSelect={(value) => {
                  if (typeof setOptionChartType === "function") {
                    setOptionChartType(value);
                  }
                  setOpenMenu(null);
                }}
                width={190}
              />
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            <LinkToggleChip
              linked={chartsLinked}
              driving={chartsLinked && viewportLeaderChartId === chartId}
              onClick={() => {
                if (typeof setChartsLinked === "function") {
                  setChartsLinked(!chartsLinked, { preferredLeaderChartId: chartId });
                }
              }}
              title={chartsLinked
                ? (viewportLeaderChartId === chartId
                  ? "Charts are linked. This chart is currently driving the shared viewport."
                  : "Charts are linked. This chart follows contextual viewport changes.")
                : "Charts are unlinked. Toggle to relink the spot and option charts."}
            />
            <CompactBadge label="Feed" value={pricingPill} tone={hasResolvedContract ? "accent" : "neutral"} />
            <CompactBadge label="View" value={viewLabel} />
          </div>
        </div>

        {selectedTradeHeaderSummary ? (
          <div
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              paddingTop: 6,
              borderTop: "1px solid " + BORDER,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 6px",
                borderRadius: 999,
                background: selectedTradeHeaderSummary.directionTone === "negative" ? `${R}18` : `${G}18`,
                color: selectedTradeHeaderSummary.directionTone === "negative" ? R : G,
                fontSize: 10,
                fontFamily: FS,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {selectedTradeHeaderSummary.directionLabel}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, flex: "1 1 320px" }}>
              <span style={{ fontSize: 12, fontFamily: F, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}>
                {selectedTradeHeaderSummary.strategyLabel}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: F,
                  fontWeight: 800,
                  color: tradePnl.tone === "positive" ? G : tradePnl.tone === "negative" ? R : TEXT,
                  whiteSpace: "nowrap",
                }}
              >
                {tradePnl.label}
              </span>
              {selectedTradeHeaderSummary.summaryLabel ? (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: F,
                    color: "#475569",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                    flex: "0 1 auto",
                  }}
                >
                  {selectedTradeHeaderSummary.summaryLabel}
                </span>
              ) : null}
              {selectedTradeHeaderSummary.reasonLabel ? (
                <span style={{ fontSize: 11, fontFamily: F, color: "#64748b", whiteSpace: "nowrap" }}>
                  {selectedTradeHeaderSummary.reasonLabel}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
            paddingTop: 6,
            borderTop: "1px solid " + BORDER,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: "1 1 220px" }}>
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: statusTone,
                flexShrink: 0,
              }}
            />
            <div style={{ fontSize: 11, fontFamily: F, color: statusTone, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {compactStatusText}
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: F,
              color: "#64748b",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontVariantNumeric: "tabular-nums",
              minWidth: 0,
              flex: "1 1 220px",
              textAlign: "right",
            }}
          >
            {tradeWindowLabel}
          </div>
        </div>

        {provenanceItems.length ? (
          <div
            style={{
              marginTop: 6,
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              paddingTop: 6,
              borderTop: "1px dashed #dbe3ee",
            }}
          >
            {provenanceItems.map((item) => (
              <CompactBadge key={item.label} label={item.label} value={item.value} tone={item.tone} />
            ))}
          </div>
        ) : null}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          minHeight: 320,
          height: "clamp(320px, 44vh, 560px)",
          position: "relative",
          padding: "2px 4px 4px",
          background: PANEL_VIEWPORT_BACKGROUND,
        }}
      >
        <ResearchSpotChart
          bars={optionChartBars}
          barRanges={optionChartBarRanges}
          defaultVisibleLogicalRange={optionDefaultVisibleLogicalRange}
          tradeOverlays={optionTradeOverlays}
          entriesByBarIndex={optionEntriesByBarIndex}
          exitsByBarIndex={optionExitsByBarIndex}
          indicatorMarkerPayload={optionIndicatorMarkerPayload}
          indicatorZones={optionIndicatorZones}
          indicatorWindows={optionIndicatorWindows}
          tvStudies={{}}
          strategy={selectedTrade?.strat || "rayalgo"}
          rangePresetKey={optionChartRangeKey}
          symbol={String(resolvedOptionTicker || selectedTrade?.optionTicker || marketSymbol || "OPTION")}
          emptyStateLabel={optionChartEmptyStateLabel || "Select a trade to inspect real option pricing from Massive."}
          selectedTradeId={selectedTradeId}
          selectedTradeSourceChartId={selectionLinkSourceChartId}
          onTradeSelect={null}
          chartId={chartId}
          linkEnabled={chartsLinked}
          linkedViewportStore={linkedViewportStore}
          onVisibleTimeBoundsChange={onViewportChange}
          showSignals={showSignals}
          showZones={showZones}
          chartType={optionChartType}
          rayalgoCandleColorMode={rayalgoCandleColorMode}
          pricePrecision={optionPricePrecision}
          tradeThresholdDisplay="active-lines"
          showFocusTradeCard={false}
        />
      </div>
    </div>
  );
}

export default React.memo(ResearchWorkbenchOptionPanel);
