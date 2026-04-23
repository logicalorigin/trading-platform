import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { T, fs, sp } from "../../RayAlgoPlatform";
import {
  ACCOUNT_RANGES,
  EmptyState,
  Panel,
  denseButtonStyle,
  formatMoney,
  formatPercent,
} from "./accountUtils";

const ChartTooltip = ({ active, payload, label, currency }) => {
  if (!active || !payload?.length) return null;
  const nav = payload.find((item) => item.dataKey === "netLiquidation")?.value;
  const ret = payload.find((item) => item.dataKey === "returnPercent")?.value;
  return (
    <div
      style={{
        background: T.bg0,
        border: `1px solid ${T.border}`,
        padding: sp(8),
        color: T.text,
        fontSize: fs(10),
        fontFamily: T.sans,
      }}
    >
      <div style={{ color: T.textMuted }}>{new Date(label).toLocaleString()}</div>
      <div style={{ fontWeight: 800 }}>{formatMoney(nav, currency)}</div>
      <div style={{ color: T.green }}>{formatPercent(ret)}</div>
    </div>
  );
};

export const EquityCurvePanel = ({
  query,
  range,
  onRangeChange,
  currency,
}) => {
  const data = (query.data?.points || []).map((point) => ({
    ...point,
    timestampMs: new Date(point.timestamp).getTime(),
  }));

  return (
    <Panel
      title="Equity Curve"
      subtitle="Flex daily NAV stitched with local intraday snapshots"
      loading={query.isLoading}
      error={query.error}
      minHeight={300}
      action={
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          {ACCOUNT_RANGES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onRangeChange(item)}
              style={denseButtonStyle(item === range)}
            >
              {item}
            </button>
          ))}
        </div>
      }
    >
      {!query.data?.flexConfigured ? (
        <EmptyState
          title="Flex token required for lifetime history"
          body="Add IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID to enable daily NAV, deposits, withdrawals, dividends, fees, and lifetime trade history. Intraday bridge snapshots will appear once the account stream is connected."
        />
      ) : !data.length ? (
        <EmptyState
          title="No equity history yet"
          body="The Flex job is configured, but no NAV rows have been imported. Run Test Flex token or wait for the daily refresh."
        />
      ) : (
        <div style={{ width: "100%", height: 238 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="accountEquityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.green} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={T.green} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tick={{ fill: T.textMuted, fontSize: fs(9) }}
                tickFormatter={(value) =>
                  new Date(value).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                }
                minTickGap={28}
                stroke={T.border}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: T.textMuted, fontSize: fs(9) }}
                tickFormatter={(value) => formatMoney(value, currency, true)}
                width={62}
                stroke={T.border}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: T.textMuted, fontSize: fs(9) }}
                tickFormatter={(value) => `${value.toFixed(0)}%`}
                width={42}
                stroke={T.border}
              />
              <Tooltip content={<ChartTooltip currency={currency} />} />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="netLiquidation"
                stroke={T.green}
                fill="url(#accountEquityFill)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="benchmarkPercent"
                stroke={T.accent}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
};

export default EquityCurvePanel;
