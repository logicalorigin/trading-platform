import { memo, useMemo } from "react";
import { FONT_WEIGHTS, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useNumberTick } from "../../lib/numberTick.js";
import { useRuntimeTickerSnapshot } from "./runtimeTickerStore";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";


const CSS_COLOR = Object.freeze({
  bg0: "var(--ra-surface-0)",
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  bg4: "var(--ra-surface-4)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  borderFocus: "var(--ra-border-focus)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  accentDim: "var(--ra-accent-dim)",
  accentHoverBg: "var(--ra-accent-hover-bg)",
  accentActiveBg: "var(--ra-accent-active-bg)",
  blue: "var(--ra-blue-500)",
  purple: "var(--ra-purple-500)",
  cyan: "var(--ra-cyan-500)",
  pink: "var(--ra-pink-500)",
  green: "var(--ra-green-500)",
  greenDim: "var(--ra-green-dim)",
  greenBg: "var(--ra-green-bg)",
  red: "var(--ra-red-500)",
  redDim: "var(--ra-red-dim)",
  redBg: "var(--ra-red-bg)",
  amber: "var(--ra-amber-500)",
  amberDim: "var(--ra-amber-dim)",
  amberBg: "var(--ra-amber-bg)",
  pulseLive: "var(--ra-green-500)",
  pulseAlert: "var(--ra-amber-500)",
  pulseLoss: "var(--ra-red-500)",
  onAccent: "var(--ra-on-accent)",
});

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
      className="ra-header-kpi"
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
        transition: "background 0.12s ease, color 0.12s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = CSS_COLOR.accentHoverBg;
        event.currentTarget.style.color = CSS_COLOR.accent;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = CSS_COLOR.text;
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
          fontFamily: T.sans,
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
          fontFamily: T.sans,
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
