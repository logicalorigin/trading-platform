import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MeasuredChartFrame } from "../../features/charting/MeasuredChartFrame.jsx";
import { CSS_COLOR, textSize } from "../../lib/uiTokens.jsx";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";

// The premium-tide cumulative-net AreaChart, split into its own lazy module so
// the recharts vendor chunk (~71 kB gzip) stays off FlowScreen's cold path.
// FlowScreen renders this inside <Suspense> with a matching MeasuredChartFrame
// fallback, so the Flow chrome paints first and the chart streams in without
// layout shift.
const FlowPremiumTideChart = ({ flowTide }) => (
  <MeasuredChartFrame
    height={200}
    minHeight={200}
    placeholderLabel="Preparing premium tide"
    testId="flow-premium-tide-frame"
  >
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={flowTide}>
        <CartesianGrid
          stroke={CSS_COLOR.borderLight || CSS_COLOR.border}
          strokeDasharray="0"
          vertical={false}
        />
        <XAxis
          dataKey="time"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: textSize("caption"), fill: CSS_COLOR.textMuted }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: textSize("caption"), fill: CSS_COLOR.textMuted }}
          tickFormatter={(value) => `$${(value / 1e6).toFixed(1)}M`}
        />
        <Tooltip
          contentStyle={chartTooltipContentStyle}
          formatter={(value) =>
            `${value >= 0 ? "+" : ""}$${(value / 1e6).toFixed(2)}M`
          }
        />
        <ReferenceLine y={0} stroke={CSS_COLOR.textMuted} strokeDasharray="0" />
        <Area
          type="monotone"
          dataKey="cumNet"
          stroke={CSS_COLOR.accent}
          strokeWidth={1.25}
          fill={CSS_COLOR.accent}
          fillOpacity={0.18}
        />
      </AreaChart>
    </ResponsiveContainer>
  </MeasuredChartFrame>
);

export default FlowPremiumTideChart;
