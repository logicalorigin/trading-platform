import { EMPTY_PREMIUM_FLOW_SUMMARY, resolvePremiumFlowDisplayState } from "../platform/premiumFlowIndicator";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";
import { fmtM, formatRelativeTimeShort } from "../../lib/formatters";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { AppTooltip } from "@/components/ui/tooltip";


const PremiumFlowSparkline = ({ timeline = [], color, dense = false }) => {
  const width = 96;
  const height = dense ? 14 : 18;
  const values = (timeline || [])
    .map((point) => point?.value)
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: dense ? dim(56) : dim(76),
          height,
          borderBottom: `1px solid ${T.borderLight}`,
          opacity: 0.5,
        }}
      />
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      width={dense ? dim(56) : dim(76)}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const formatSignedPremiumFlow = (value) => {
  const numeric = Number.isFinite(value) ? value : 0;
  const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}${fmtM(Math.abs(numeric))}`;
};

const PremiumFlowStatusGlyph = ({ state, dense = false, color }) => {
  const size = dense ? 7 : 8;
  if (state?.isScanning) {
    return (
      <span
        aria-hidden="true"
        data-premium-flow-glyph
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          border: `1px solid ${T.borderLight}`,
          borderTopColor: color,
          borderRightColor: color,
          borderRadius: "50%",
          animation: "premiumFlowSpin 760ms linear infinite",
        }}
      />
    );
  }

  if (state?.isQueued) {
    return (
      <span
        aria-hidden="true"
        data-premium-flow-glyph
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          background: color,
          borderRadius: "50%",
          opacity: 0.5,
          animation: "premiumFlowPulse 1200ms ease-in-out infinite",
        }}
      />
    );
  }

  return null;
};

export const MiniChartPremiumFlowIndicator = ({
  symbol,
  summary,
  flowStatus,
  providerSummary,
  dense = false,
  compact = false,
}) => {
  const resolvedSummary = summary || EMPTY_PREMIUM_FLOW_SUMMARY;
  const normalizedSymbol = normalizeTickerSymbol(symbol);
  const tone =
    resolvedSummary.direction === "call"
      ? T.green
      : resolvedSummary.direction === "put"
        ? T.red
        : T.textMuted;
  const displayState = resolvePremiumFlowDisplayState({
    symbol: normalizedSymbol,
    summary: resolvedSummary,
    flowStatus,
    providerSummary,
  });
  const glyphState = {
    ...displayState,
    isScanning: displayState.kind === "scanning",
  };
  const statusLabel = displayState.label;
  const statusTone = displayState.isError
    ? T.red
    : displayState.isStale
      ? T.amber
      : displayState.isScanning
        ? T.accent
        : displayState.isLiveSource
          ? T.green
        : T.textDim;
  const hasFlow = resolvedSummary.eventCount > 0;
  const callPct = !hasFlow
    ? 50
    : resolvedSummary.puts <= 0
      ? 100
      : resolvedSummary.calls <= 0
        ? 0
        : Math.min(92, Math.max(8, Math.round(resolvedSummary.callShare * 100)));
  const putPct = hasFlow ? 100 - callPct : 50;
  const height = compact || dense ? 32 : 52;
  const latestLabel = resolvedSummary.latestOccurredAt
    ? formatRelativeTimeShort(resolvedSummary.latestOccurredAt)
    : null;
  const titleDetail = displayState.errorMessage
    ? ` · ${displayState.errorMessage}`
    : "";
  const compactStatusLabel =
    statusLabel === "IBKR snapshot live"
      ? "IBKR live"
      : statusLabel === "Premium flow"
        ? "Flow"
        : statusLabel === "Snapshot prem"
          ? "Snapshot"
          : statusLabel;

  return (
    <AppTooltip content={`${normalizedSymbol} options premium flow: ${formatSignedPremiumFlow(
        resolvedSummary.netPremium,
      )} · ${statusLabel}${titleDetail}`}><div
      data-chart-control-root
      data-testid="market-premium-flow-strip"
      data-flow-source-provider={displayState.sourceProvider || ""}
      data-flow-source-status={displayState.sourceStatus || ""}
      data-flow-source-live={displayState.isLiveSource ? "true" : "false"}
      data-flow-fallback-used={
        providerSummary?.fallbackUsed || displayState.sourceStatus === "fallback"
          ? "true"
          : "false"
      }
      style={{
        height,
        flexShrink: 0,
        borderTop: `1px solid ${T.border}`,
        background: T.bg2,
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
        gridTemplateRows: dense || compact ? "1fr 5px" : "1fr 6px 1fr",
        gap: dense ? 2 : 3,
        alignItems: "center",
        padding: dense ? "3px 6px" : "4px 8px",
        fontFamily: T.mono,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(5),
          minWidth: 0,
          color: T.textSec,
          fontSize: fs(dense ? 8 : 9),
          fontWeight: 400,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={{ color: T.textMuted }}>FLOW</span>
        <PremiumFlowStatusGlyph
          state={glyphState}
          dense={dense}
          color={statusTone}
        />
        <span
          style={{
            color: tone,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {formatSignedPremiumFlow(resolvedSummary.netPremium)}
        </span>
        <span
          role="status"
          aria-live="polite"
          aria-label={`${normalizedSymbol} options premium flow ${statusLabel}`}
          style={{
            color: statusTone,
            fontWeight: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {compact ? compactStatusLabel : statusLabel}
        </span>
      </div>
      {!compact ? (
        <PremiumFlowSparkline
          timeline={resolvedSummary.timeline}
          color={tone}
          dense={dense}
        />
      ) : null}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          height: dense ? 5 : 6,
          background: T.bg0,
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: `${callPct}%`,
            background: hasFlow ? T.green : T.border,
            opacity: hasFlow ? 0.78 : 0.45,
          }}
        />
        <span
          aria-hidden="true"
          style={{
            width: `${putPct}%`,
            background: hasFlow ? T.red : T.borderLight,
            opacity: hasFlow ? 0.78 : 0.45,
          }}
        />
      </div>
      {!dense && !compact ? (
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            justifyContent: "space-between",
            gap: sp(6),
            minWidth: 0,
            color: T.textDim,
            fontSize: fs(8),
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            C {fmtM(resolvedSummary.calls)} / P {fmtM(resolvedSummary.puts)}
          </span>
          <span>
            {resolvedSummary.eventCount} evt
            {resolvedSummary.unusualCount ? ` / ${resolvedSummary.unusualCount} unusual` : ""}
            {latestLabel ? ` / ${latestLabel}` : ""}
          </span>
        </div>
      ) : null}
    </div></AppTooltip>
  );
};

// ─── MINI CHART CELL ───
// Single chart cell for the multi-chart grid. Compact: ticker header, candles, volume strip.
