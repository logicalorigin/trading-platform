import { memo, useMemo } from "react";
import { CSS_COLOR, dim, FONT_WEIGHTS, sp, T, textSize } from "../../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useNumberTick } from "../../lib/numberTick.js";
import { useRuntimeTickerSnapshot } from "./runtimeTickerStore";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";

export const DEFAULT_HEADER_KPI_CONFIG = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "VXX", label: "Volatility" },
  { symbol: "UUP", label: "Dollar" },
  { symbol: "USO", label: "Crude" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "TLT", label: "Treasuries" },
];

const KNOWN_SYMBOL_LABELS = Object.fromEntries(
  DEFAULT_HEADER_KPI_CONFIG.map(({ symbol, label }) => [symbol, label]),
);

const normalizeKpiConfig = (config) => {
  if (!Array.isArray(config) || config.length === 0) return DEFAULT_HEADER_KPI_CONFIG;
  const seen = new Set();
  const out = [];
  for (const entry of config) {
    if (!entry) continue;
    const rawSymbol = typeof entry === "string" ? entry : entry.symbol;
    const symbol = String(rawSymbol || "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const label = (typeof entry === "object" && entry.label) || KNOWN_SYMBOL_LABELS[symbol] || symbol;
    out.push({ symbol, label });
  }
  return out.length ? out : DEFAULT_HEADER_KPI_CONFIG;
};

export const HEADER_KPI_SYMBOLS = DEFAULT_HEADER_KPI_CONFIG.map((item) => item.symbol);

const HeaderKpiStripItem = memo(({ symbol, label, index, onSelect, compact = false, dense = false, isFirst = false }) => {
  const isDense = dense && !compact;
  const fallback = useMemo(
    () => buildFallbackWatchlistItem(symbol, index, label),
    [index, label, symbol],
  );
  const snapshot = useRuntimeTickerSnapshot(symbol, fallback);
  const positive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;
  // 420ms tick — fast enough that streaming updates don't pile up, slow
  // enough that the human eye registers movement. Reduced-motion drops
  // straight to the target value (the hook handles that).
  const animatedPrice = useNumberTick(snapshot?.price, 420);
  const animatedPct = useNumberTick(snapshot?.pct, 420);
  const priceLabel = formatQuotePrice(animatedPrice ?? snapshot?.price);
  const percentLabel = formatSignedPercent(animatedPct ?? snapshot?.pct);
  const compactPercentLabel = percentLabel.replace(/(\.\d)\d(?=%)/, "$1");
  const displayPercentLabel = compact ? compactPercentLabel : percentLabel;
  const displayPriceLabel = compact
    ? priceLabel.replace(/(\.\d)\d$/, "$1")
    : priceLabel;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(symbol)}
      className="ra-header-kpi ra-hover-accent-bgfg"
      style={{
        flex: "0 0 max-content",
        width: "max-content",
        minWidth: "max-content",
        minHeight: dim(isDense || compact ? 20 : 24),
        padding: sp(isDense ? "0px 3px" : compact ? "0px 2px" : "1px 4px"),
        boxSizing: "border-box",
        display: "inline-grid",
        gridTemplateColumns: "max-content max-content max-content",
        alignItems: "center",
        gap: sp(compact ? 2 : 4),
        background: "transparent",
        border: "none",
        borderLeft: isFirst ? "none" : `1px solid ${CSS_COLOR.borderLight}`,
        color: CSS_COLOR.text,
        cursor: "pointer",
        overflow: "visible",
        transition: "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
      }}
    >
      <span
        style={{
          minWidth: "max-content",
          flex: "0 0 auto",
          textAlign: "left",
          display: "block",
          whiteSpace: "nowrap",
          overflow: "visible",
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          color: CSS_COLOR.textSec,
          fontFamily: T.sans,
          lineHeight: 1.1,
          letterSpacing: 0,
        }}
      >
        {symbol}
      </span>
      <span
        style={{
          minWidth: "max-content",
          display: "block",
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          fontFamily: T.data,
          color: CSS_COLOR.text,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {displayPriceLabel}
      </span>
      <span
        style={{
          minWidth: "max-content",
          display: "block",
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          fontFamily: T.data,
          color:
            positive == null ? CSS_COLOR.textDim : positive ? CSS_COLOR.green : CSS_COLOR.red,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {displayPercentLabel}
      </span>
    </button>
  );
});

export const HeaderKpiStrip = memo(({ onSelect, compact = false, dense = false, maxItems = null, symbols = null }) => {
  const resolvedConfig = normalizeKpiConfig(symbols);
  const items = Number.isFinite(maxItems)
    ? resolvedConfig.slice(0, Math.max(1, maxItems))
    : resolvedConfig;

  return (
    <div
      data-testid="platform-header-kpis"
      className="ra-hide-scrollbar"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: 0,
        flex: "1 1 auto",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        background: "transparent",
        border: "none",
        borderRadius: 0,
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      {items.map(({ symbol, label }, index) => (
        <HeaderKpiStripItem
          key={symbol}
          symbol={symbol}
          label={label}
          index={index}
          onSelect={onSelect}
          compact={compact}
          dense={dense}
          isFirst={index === 0}
        />
      ))}
    </div>
  );
});
