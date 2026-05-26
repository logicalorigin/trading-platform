import { useChartHydrationStats } from "../charting/chartHydrationStats";
import { useIbkrLatencyStats } from "../charting/useMassiveStockAggregateStream";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { SCREENS } from "./screenRegistry.jsx";
import { useRuntimeWorkloadStats } from "./workloadStats";
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

const formatLatencyMetric = (value) => (
  Number.isFinite(value) ? `${Math.round(value)}ms` : "n/a"
);

const formatWorkloadCount = (value) => (Number.isFinite(value) ? value : 0);

export const LatencyDebugStrip = ({ screen, mountedScreens }) => {
  const stats = useIbkrLatencyStats();
  const chartStats = useChartHydrationStats();
  const workloadStats = useRuntimeWorkloadStats();
  const cells = [
    ["Bridge->API", stats.bridgeToApiMs],
    ["API->React", stats.apiToReactMs],
    ["Total", stats.totalMs],
  ];
  const chartCells = [
    ["Bars", chartStats.barsRequestMs],
    ["Prepend", chartStats.prependRequestMs],
    ["Model", chartStats.modelBuildMs],
    ["Paint", chartStats.firstPaintMs],
    ["Patch", chartStats.livePatchToPaintMs],
  ];
  const stream = stats.stream;
  const mountedCount = SCREENS.filter(({ id }) => mountedScreens?.[id]).length;
  const activeWorkloadLabels = workloadStats.entries
    .slice(0, 6)
    .map((entry) =>
      entry.detail ? `${entry.label}(${entry.detail})` : entry.label,
    )
    .join(" · ");

  return (
    <div
      style={{
        position: "fixed",
        right: dim(12),
        bottom: dim(12),
        zIndex: 10000,
        display: "flex",
        gap: sp(8),
        alignItems: "center",
        padding: sp("8px 10px"),
        borderRadius: dim(RADII.md),
        border: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.data,
        fontSize: textSize("bodyStrong"),
        boxShadow: ELEVATION.lg,
        pointerEvents: "none",
      }}
    >
      <strong style={{ color: CSS_COLOR.blue, fontWeight: FONT_WEIGHTS.regular }}>Latency</strong>
      {cells.map(([label, metric]) => (
        <span key={label} style={{ whiteSpace: "nowrap" }}>
          {label} p50 {formatLatencyMetric(metric.p50)} p95{" "}
          {formatLatencyMetric(metric.p95)}
        </span>
      ))}
      {chartCells.map(([label, metric]) => (
        <span key={label} style={{ whiteSpace: "nowrap", color: CSS_COLOR.textSec }}>
          {label} p50 {formatLatencyMetric(metric.p50)} p95{" "}
          {formatLatencyMetric(metric.p95)}
        </span>
      ))}
      <span style={{ color: CSS_COLOR.textSec, whiteSpace: "nowrap" }}>
        Stream c{stream.activeConsumerCount} s{stream.unionSymbolCount} r
        {stream.reconnectCount} g{stream.streamGapCount}
      </span>
      <span style={{ color: CSS_COLOR.green, whiteSpace: "nowrap" }}>
        Screens {mountedCount}/{SCREENS.length} vis {screen}
      </span>
      <span style={{ color: CSS_COLOR.amber, whiteSpace: "nowrap" }}>
        Work p{formatWorkloadCount(workloadStats.kindCounts.poll)} s
        {formatWorkloadCount(workloadStats.kindCounts.stream)} m
        {formatWorkloadCount(workloadStats.kindCounts.media)}
      </span>
      {activeWorkloadLabels ? (
        <span style={{ color: CSS_COLOR.amber, whiteSpace: "nowrap" }}>
          {activeWorkloadLabels}
        </span>
      ) : null}
      <span style={{ color: CSS_COLOR.textDim }}>
        n={stats.sampleCount}/{chartStats.sampleCount}
      </span>
    </div>
  );
};
