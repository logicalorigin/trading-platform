import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  formatAccountMoney,
  formatAccountPercent,
  mutedLabelStyle,
  sectionTitleStyle,
} from "./accountUtils";

const getColors = () => [T.blue, T.cyan, T.purple, T.amber, T.green, "#f43f5e", T.textDim];
const EPSILON = 1e-9;

const nonZeroBuckets = (rows = []) =>
  rows.filter((row) => Math.abs(Number(row?.value) || 0) > EPSILON);

const DonutLegend = ({ data, maskValues = false, compact = false }) => (
  <div style={{ display: "grid", gap: sp(compact ? 2 : 3) }}>
    {data.slice(0, compact ? 4 : 6).map((item, index) => (
      <div
        key={item.label}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: sp(compact ? 4 : 6),
          color: T.textSec,
          fontSize: fs(compact ? 7 : 8),
          fontFamily: T.sans,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: sp(5), minWidth: 0 }}>
          <span
            style={{
              width: 7,
              height: 7,
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
        <span style={{ color: T.textDim }}>
          {formatAccountPercent(item.weightPercent, 1, maskValues)}
        </span>
      </div>
    ))}
  </div>
);

const Donut = ({ title, data, currency, maskValues = false, compact = false }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ ...sectionTitleStyle, fontSize: fs(8), marginBottom: sp(3) }}>{title}</div>
    <div style={{ height: dim(compact ? 70 : 96) }}>
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
              formatAccountMoney(value, currency, true, maskValues),
              `${item.payload.label} ${formatAccountPercent(item.payload.weightPercent, 1, maskValues)}`,
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
    <DonutLegend data={data} maskValues={maskValues} compact={compact} />
  </div>
);

const ExposureMetric = ({ label, value, currency, tone = T.text, maskValues = false }) => (
  <div
    style={{
      minWidth: 0,
      borderTop: `1px solid ${T.border}`,
      padding: sp("3px 0"),
    }}
  >
    <div style={{ ...mutedLabelStyle, fontSize: fs(7), lineHeight: 1 }}>
      {label}
    </div>
    <div
      style={{
        marginTop: sp(2),
        color: tone,
        fontSize: fs(10),
        fontFamily: T.mono,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {formatAccountMoney(value, currency, true, maskValues)}
    </div>
  </div>
);

export const AllocationPanel = ({ query, currency, maskValues = false, compact = false }) => {
  const assetRows = nonZeroBuckets(query.data?.assetClass || []);
  const sectorRows = nonZeroBuckets(query.data?.sector || []);
  const exposure = query.data?.exposure;
  const grossLong = exposure?.grossLong || 0;
  const grossShort = exposure?.grossShort || 0;
  const grossTotal = grossLong + grossShort;
  const netExposure = exposure?.netExposure || 0;

  return (
    <Panel
      title="Allocation & Exposure"
      subtitle={compact ? undefined : "Asset class, sector, and gross exposure mix"}
      rightRail={compact ? undefined : "Sectors via Polygon reference"}
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={compact ? 246 : 232}
    >
      {!assetRows.length ? (
        <EmptyState
          title="No current allocation"
          body="Open positions and cash balances from the account stream will populate these allocation charts."
        />
      ) : (
        <div style={{ display: "grid", gap: sp(5) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compact ? "minmax(86px, 0.78fr) minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
              gap: sp(compact ? 4 : 5),
              alignItems: compact ? "start" : undefined,
            }}
          >
            <Donut
              title="By Asset Class"
              data={assetRows}
              currency={currency}
              maskValues={maskValues}
              compact={compact}
            />
            {compact ? (
              <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
                <div style={{ ...sectionTitleStyle, fontSize: fs(8) }}>Exposure</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    columnGap: sp(8),
                    rowGap: 0,
                  }}
                >
                  <ExposureMetric
                    label="Gross"
                    value={grossTotal}
                    currency={currency}
                    maskValues={maskValues}
                  />
                  <ExposureMetric
                    label="Net"
                    value={netExposure}
                    currency={currency}
                    tone={netExposure >= 0 ? T.green : T.red}
                    maskValues={maskValues}
                  />
                  <ExposureMetric
                    label="Long"
                    value={grossLong}
                    currency={currency}
                    tone={T.green}
                    maskValues={maskValues}
                  />
                  <ExposureMetric
                    label="Short"
                    value={grossShort}
                    currency={currency}
                    tone={T.red}
                    maskValues={maskValues}
                  />
                </div>
                {sectorRows.length ? (
                  <div
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: sp(4),
                      display: "grid",
                      gap: sp(2),
                    }}
                  >
                    <div style={{ ...mutedLabelStyle, fontSize: fs(7) }}>Top Sectors</div>
                    {sectorRows.slice(0, 3).map((sector) => (
                      <div
                        key={sector.label}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: sp(5),
                          color: T.textSec,
                          fontSize: fs(8),
                          fontFamily: T.sans,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {sector.label}
                        </span>
                        <span style={{ color: T.textDim }}>
                          {formatAccountPercent(sector.weightPercent, 1, maskValues)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <Donut
                title="By Sector"
                data={sectorRows}
                currency={currency}
                maskValues={maskValues}
                compact={compact}
              />
            )}
          </div>

          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              paddingTop: sp(compact ? 4 : 5),
              display: "grid",
              gap: sp(compact ? 4 : 5),
            }}
          >
            <div style={mutedLabelStyle}>Long / Short / Net</div>
            <div
              style={{
                height: dim(compact ? 12 : 13),
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
                  fontSize: fs(compact ? 7 : 8),
                  fontFamily: T.mono,
                  fontWeight: 800,
                }}
              >
                L {formatAccountMoney(grossLong, currency, true, maskValues)}
              </div>
              <div
                style={{
                  width: grossTotal ? `${(grossShort / grossTotal) * 100}%` : "50%",
                  background: T.red,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  fontSize: fs(compact ? 7 : 8),
                  fontFamily: T.mono,
                  fontWeight: 800,
                }}
              >
                S {formatAccountMoney(grossShort, currency, true, maskValues)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: sp(6),
                flexWrap: "wrap",
                color: T.textDim,
                fontSize: fs(compact ? 7 : 8),
                fontFamily: T.mono,
              }}
            >
              <span>Gross {formatAccountMoney(grossTotal, currency, true, maskValues)}</span>
              <span style={{ color: netExposure >= 0 ? T.green : T.red, fontWeight: 800 }}>
                Net {formatAccountMoney(netExposure, currency, true, maskValues)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default AllocationPanel;
