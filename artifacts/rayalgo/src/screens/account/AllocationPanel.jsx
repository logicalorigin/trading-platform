import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  formatMoney,
  formatPercent,
  mutedLabelStyle,
  sectionTitleStyle,
} from "./accountUtils";

const getColors = () => [T.blue, T.cyan, T.purple, T.amber, T.green, "#f43f5e", T.textDim];

const DonutLegend = ({ data }) => (
  <div style={{ display: "grid", gap: sp(5) }}>
    {data.slice(0, 6).map((item, index) => (
      <div
        key={item.label}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: sp(8),
          color: T.textSec,
          fontSize: fs(10),
          fontFamily: T.sans,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: sp(6), minWidth: 0 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: getColors()[index % getColors().length],
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: T.textSec,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label}
          </span>
        </span>
        <span style={{ color: T.textDim }}>{formatPercent(item.weightPercent, 1)}</span>
      </div>
    ))}
  </div>
);

const Donut = ({ title, data, currency }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ ...sectionTitleStyle, fontSize: fs(9), marginBottom: sp(8) }}>{title}</div>
    <div style={{ height: dim(168) }}>
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
              <Cell key={entry.label} fill={getColors()[index % getColors().length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => [
              formatMoney(value, currency, true),
              `${item.payload.label} ${formatPercent(item.payload.weightPercent, 1)}`,
            ]}
            contentStyle={{
              background: T.bg0,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              fontSize: fs(10),
              color: T.text,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
    <DonutLegend data={data} />
  </div>
);

export const AllocationPanel = ({ query, currency }) => {
  const exposure = query.data?.exposure;
  const grossLong = exposure?.grossLong || 0;
  const grossShort = exposure?.grossShort || 0;
  const grossTotal = grossLong + grossShort;
  const netExposure = exposure?.netExposure || 0;

  return (
    <Panel
      title="Allocation & Exposure"
      subtitle="Asset class, sector, and gross exposure mix"
      rightRail="Sectors via Polygon reference"
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={340}
    >
      {!query.data?.assetClass?.length ? (
        <EmptyState
          title="No current allocation"
          body="Open positions and cash balances from the account stream will populate these allocation charts."
        />
      ) : (
        <div style={{ display: "grid", gap: sp(14) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: sp(12),
            }}
          >
            <Donut title="By Asset Class" data={query.data.assetClass} currency={currency} />
            <Donut title="By Sector" data={query.data.sector || []} currency={currency} />
          </div>

          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              paddingTop: sp(8),
              display: "grid",
              gap: sp(8),
            }}
          >
            <div style={mutedLabelStyle}>Long / Short / Net</div>
            <div
              style={{
                height: dim(18),
                borderRadius: dim(4),
                overflow: "hidden",
                display: "flex",
                background: T.bg3,
              }}
            >
              <div
                style={{
                  width: grossTotal ? `${(grossLong / grossTotal) * 100}%` : "50%",
                  background: T.green,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  fontWeight: 800,
                }}
              >
                L {formatMoney(grossLong, currency, true)}
              </div>
              <div
                style={{
                  width: grossTotal ? `${(grossShort / grossTotal) * 100}%` : "50%",
                  background: T.red,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  fontWeight: 800,
                }}
              >
                S {formatMoney(grossShort, currency, true)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: sp(8),
                flexWrap: "wrap",
                color: T.textDim,
                fontSize: fs(9),
                fontFamily: T.mono,
              }}
            >
              <span>Gross {formatMoney(grossTotal, currency, true)}</span>
              <span style={{ color: netExposure >= 0 ? T.green : T.red, fontWeight: 800 }}>
                Net {formatMoney(netExposure, currency, true)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default AllocationPanel;
