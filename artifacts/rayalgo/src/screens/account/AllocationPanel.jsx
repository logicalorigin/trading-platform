import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { T, dim, fs, sp } from "../../RayAlgoPlatform";
import {
  EmptyState,
  Panel,
  formatMoney,
  formatPercent,
  mutedLabelStyle,
  sectionTitleStyle,
} from "./accountUtils";

const COLORS = ["#22c55e", "#38bdf8", "#f97316", "#eab308", "#f43f5e", "#a78bfa", "#94a3b8"];

const Donut = ({ title, data, currency }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ ...sectionTitleStyle, fontSize: fs(10), marginBottom: sp(8) }}>
      {title}
    </div>
    <div style={{ height: dim(170) }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="84%"
            paddingAngle={2}
            stroke={T.bg1}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => [
              formatMoney(value, currency, true),
              `${item.payload.label} ${formatPercent(item.payload.weightPercent)}`,
            ]}
            contentStyle={{
              background: T.bg0,
              border: `1px solid ${T.border}`,
              fontSize: fs(10),
              color: T.text,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
    <div style={{ display: "grid", gap: 5 }}>
      {data.slice(0, 5).map((item, index) => (
        <div
          key={item.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: sp(8),
            color: T.textSec,
            fontSize: fs(10),
            fontFamily: T.sans,
          }}
        >
          <span>
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                background: COLORS[index % COLORS.length],
                marginRight: 6,
              }}
            />
            {item.label}
          </span>
          <span>{formatPercent(item.weightPercent)}</span>
        </div>
      ))}
    </div>
  </div>
);

export const AllocationPanel = ({ query, currency }) => {
  const exposure = query.data?.exposure;
  const exposureData = exposure
    ? [
        { label: "Gross long", value: exposure.grossLong },
        { label: "Gross short", value: exposure.grossShort },
        { label: "Net", value: exposure.netExposure },
      ]
    : [];

  return (
    <Panel
      title="Allocation"
      subtitle="Asset class, sector, long/short exposure"
      loading={query.isLoading}
      error={query.error}
      minHeight={300}
    >
      {!query.data?.assetClass?.length ? (
        <EmptyState
          title="No current allocation"
          body="Open positions and cash balances from the account stream will populate these allocation charts."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(16) }}>
          <Donut title="By Asset Class" data={query.data.assetClass} currency={currency} />
          <Donut title="By Sector" data={query.data.sector || []} currency={currency} />
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ ...mutedLabelStyle, marginBottom: sp(6) }}>
              Long / short / net exposure
            </div>
            <div style={{ height: dim(92) }}>
              <ResponsiveContainer>
                <BarChart data={exposureData} layout="vertical" margin={{ left: 74, right: 14 }}>
                  <XAxis type="number" hide />
                  <Tooltip
                    formatter={(value) => formatMoney(value, currency, true)}
                    contentStyle={{
                      background: T.bg0,
                      border: `1px solid ${T.border}`,
                      fontSize: fs(10),
                    }}
                  />
                  <Bar dataKey="value" radius={0} isAnimationActive={false}>
                    {exposureData.map((entry, index) => (
                      <Cell
                        key={entry.label}
                        fill={index === 1 ? T.red : index === 2 ? T.accent : T.green}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default AllocationPanel;
