import { memo, useMemo } from "react";
import { FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useNumberTick } from "../../lib/numberTick.js";
import { useRuntimeTickerSnapshot } from "./runtimeTickerStore";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";
import { MicroSparkline } from "../../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";


const HEADER_KPI_CONFIG = [
  { symbol: "VIXY", label: "Volatility" },
  { symbol: "IEF", label: "Treasuries" },
  { symbol: "UUP", label: "Dollar" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "USO", label: "Crude" },
];

export const HEADER_KPI_SYMBOLS = HEADER_KPI_CONFIG.map((item) => item.symbol);

// MicroSparkline is imported from components/platform/primitives.jsx
// (single source of truth — was previously duplicated here and in
// PlatformWatchlist.jsx).

const HeaderKpiStripItem = memo(({ symbol, label, index, onSelect, compact = false, isFirst = false }) => {
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

  return (
    <AppTooltip content={`${label} proxy · ${symbol}`}><button
      type="button"
      onClick={() => onSelect?.(symbol)}
      className="ra-header-kpi"
      style={{
        flex: compact ? "0 0 auto" : `1 1 ${dim(110)}px`,
        minWidth: dim(compact ? 90 : 108),
        minHeight: dim(compact ? 28 : 38),
        padding: sp(compact ? "2px 10px 2px 8px" : "4px 14px 4px 10px"),
        display: "flex",
        alignItems: "center",
        gap: sp(8),
        background: "transparent",
        border: "none",
        borderLeft: isFirst ? "none" : `1px solid ${T.borderLight}`,
        color: T.text,
        cursor: "pointer",
        transition: "background 0.18s ease, color 0.18s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = T.bg2;
        event.currentTarget.style.color = T.accent;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = T.text;
      }}
    >
      <span
        style={{
          minWidth: 0,
          flex: 1,
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: sp(1),
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: textSize(compact ? "micro" : "caption"),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </span>
          <span
            style={{
              display: "block",
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.1,
              letterSpacing: "0.04em",
              flexShrink: 0,
            }}
          >
            {symbol}
          </span>
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: textSize("paragraph"),
              fontWeight: FONT_WEIGHTS.label,
              fontFamily: T.sans,
              color: T.text,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            {formatQuotePrice(animatedPrice ?? snapshot?.price)}
          </span>
          <span
            style={{
              display: "block",
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              fontFamily: T.sans,
              color:
                positive == null ? T.textDim : positive ? T.green : T.red,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSignedPercent(animatedPct ?? snapshot?.pct)}
          </span>
        </span>
      </span>
      <span style={{ display: "block", flexShrink: 0 }}>
        <MicroSparkline
          data={
            snapshot?.sparkBars?.length
              ? snapshot.sparkBars
              : snapshot?.spark || fallback.spark
          }
          positive={positive}
          width={44}
          height={18}
        />
      </span>
    </button></AppTooltip>
  );
});

export const HeaderKpiStrip = memo(({ onSelect, compact = false }) => (
  <div
    data-testid="platform-header-kpis"
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: 0,
      minWidth: 0,
      width: "100%",
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: dim(RADII.sm),
      overflow: "hidden",
    }}
  >
    {HEADER_KPI_CONFIG.map(({ symbol, label }, index) => (
      <HeaderKpiStripItem
        key={symbol}
        symbol={symbol}
        label={label}
        index={index}
        onSelect={onSelect}
        compact={compact}
        isFirst={index === 0}
      />
    ))}
  </div>
));
