import { useChartHydrationStats } from "../charting/chartHydrationStats";
import { useIbkrLatencyStats } from "../charting/useMassiveStockAggregateStream";
import { FONT_WEIGHTS, T, dim, sp, textSize } from "../../lib/uiTokens";
import { SCREENS } from "./screenRegistry.jsx";
import { useRuntimeWorkloadStats } from "./workloadStats";
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
        borderRadius: dim(10),
        border: `1px solid ${T.border}`,
        background: T.bg0,
        color: T.text,
        fontFamily: T.data,
        fontSize: textSize("bodyStrong"),
        boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
        pointerEvents: "none",
      }}
    >
      <strong style={{ color: T.blue, fontWeight: FONT_WEIGHTS.regular }}>Latency</strong>
      {cells.map(([label, metric]) => (
        <span key={label} style={{ whiteSpace: "nowrap" }}>
          {label} p50 {formatLatencyMetric(metric.p50)} p95{" "}
          {formatLatencyMetric(metric.p95)}
        </span>
      ))}
      {chartCells.map(([label, metric]) => (
        <span key={label} style={{ whiteSpace: "nowrap", color: T.textSec }}>
          {label} p50 {formatLatencyMetric(metric.p50)} p95{" "}
          {formatLatencyMetric(metric.p95)}
        </span>
      ))}
      <span style={{ color: T.textSec, whiteSpace: "nowrap" }}>
        Stream c{stream.activeConsumerCount} s{stream.unionSymbolCount} r
        {stream.reconnectCount} g{stream.streamGapCount}
      </span>
      <span style={{ color: T.green, whiteSpace: "nowrap" }}>
        Screens {mountedCount}/{SCREENS.length} vis {screen}
      </span>
      <span style={{ color: T.amber, whiteSpace: "nowrap" }}>
        Work p{formatWorkloadCount(workloadStats.kindCounts.poll)} s
        {formatWorkloadCount(workloadStats.kindCounts.stream)} m
        {formatWorkloadCount(workloadStats.kindCounts.media)}
      </span>
      {activeWorkloadLabels ? (
        <span style={{ color: T.amber, whiteSpace: "nowrap" }}>
          {activeWorkloadLabels}
        </span>
      ) : null}
      <span style={{ color: T.textDim }}>
        n={stats.sampleCount}/{chartStats.sampleCount}
      </span>
    </div>
  );
};
