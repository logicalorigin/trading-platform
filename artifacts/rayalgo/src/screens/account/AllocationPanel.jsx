import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  mutedLabelStyle,
  sectionTitleStyle,
} from "./accountUtils";

const getColors = () => [T.blue, T.cyan, T.purple, T.amber, T.green, T.pink, T.textDim];
const EPSILON = 1e-9;

const nonZeroBuckets = (rows = []) =>
  rows.filter((row) => Math.abs(Number(row?.value) || 0) > EPSILON);

const DonutLegend = ({ data, maskValues = false }) => (
  <div style={{ display: "grid", gap: sp(3), marginTop: sp(3) }}>
    {data.slice(0, 4).map((item, index) => (
      <div
        key={item.label}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: sp(4),
          color: T.textSec,
          fontSize: textSize("body"),
          fontFamily: T.sans,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: sp(5), minWidth: 0 }}>
          <span
            style={{
              width: dim(10),
              height: dim(10),
              borderRadius: dim(RADII.xs),
              background: getColors()[index % getColors().length],
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: T.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label}
          </span>
        </span>
        <span style={{ color: T.textSec, fontVariantNumeric: "tabular-nums" }}>
          {formatAccountPercent(item.weightPercent, 1, maskValues)}
        </span>
      </div>
    ))}
  </div>
);

const Donut = ({ title, data, currency, maskValues = false }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ ...sectionTitleStyle, fontSize: textSize("body"), marginBottom: sp(3) }}>{title}</div>
    <div style={{ height: dim(96) }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="86%"
            paddingAngle={0.5}
            stroke={T.bg1}
            strokeWidth={1}
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
            contentStyle={chartTooltipContentStyle}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
    <DonutLegend data={data} maskValues={maskValues} />
  </div>
);

const ExposureMetric = ({ label, value, currency, tone = T.text, maskValues = false, isFirst = false }) => (
  <div
    style={{
      flex: "1 1 auto",
      minWidth: dim(72),
      padding: sp("3px 10px"),
      borderLeft: isFirst ? "none" : `1px solid ${T.border}`,
    }}
  >
    <div style={{ ...mutedLabelStyle, fontSize: textSize("caption"), lineHeight: 1 }}>
      {label}
    </div>
    <div
      style={{
        marginTop: sp(2),
        color: tone,
        fontSize: textSize("body"),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.regular,
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

export const AllocationCompactContent = ({
  data,
  currency,
  maskValues = false,
}) => {
  const assetRows = nonZeroBuckets(data?.assetClass || []);
  const sectorRows = nonZeroBuckets(data?.sector || []);
  const exposure = data?.exposure;
  const grossLong = exposure?.grossLong || 0;
  const grossShort = exposure?.grossShort || 0;
  const grossTotal = grossLong + grossShort;
  const netExposure = exposure?.netExposure || 0;

  if (!assetRows.length) {
    return (
      <div style={{ color: T.textMuted, fontSize: textSize("body"), fontFamily: T.sans }}>
        No current allocation. Open positions and cash balances will populate these charts.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: sp(5) }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(${dim(86)}px, 0.78fr) minmax(0, 1fr)`,
          gap: sp(4),
          alignItems: "start",
        }}
      >
        <Donut
          title="By Asset Class"
          data={assetRows}
          currency={currency}
          maskValues={maskValues}
        />
        <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
          <div style={{ ...sectionTitleStyle, fontSize: textSize("body") }}>Exposure</div>
          <div
            className="ra-hide-scrollbar"
            style={{
              display: "flex",
              flexWrap: "nowrap",
              overflowX: "auto",
              background: T.bg1,
              borderRadius: dim(RADII.sm),
              minWidth: 0,
            }}
          >
            <ExposureMetric
              label="Gross"
              value={grossTotal}
              currency={currency}
              maskValues={maskValues}
              isFirst
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
              <div style={{ ...mutedLabelStyle, fontSize: textSize("caption") }}>Top Sectors</div>
              {sectorRows.slice(0, 3).map((sector) => (
                <div
                  key={sector.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: sp(5),
                    color: T.textSec,
                    fontSize: textSize("body"),
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
      </div>

      <div
        style={{
          borderTop: `1px solid ${T.border}`,
          paddingTop: sp(4),
          display: "grid",
          gap: sp(4),
        }}
      >
        <div style={mutedLabelStyle}>Long / Short / Net</div>
        <div
          style={{
            height: dim(12),
            borderRadius: dim(RADII.xs),
            overflow: "hidden",
            display: "flex",
            background: T.bg1,
          }}
        >
          <div
            style={{
              width: grossTotal ? `${(grossLong / grossTotal) * 100}%` : "50%",
              background: T.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: T.onAccent,
              fontSize: textSize("micro"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
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
              color: T.onAccent,
              fontSize: textSize("micro"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
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
            fontSize: textSize("micro"),
            fontFamily: T.sans,
          }}
        >
          <span>Gross {formatAccountMoney(grossTotal, currency, true, maskValues)}</span>
          <span style={{ color: netExposure >= 0 ? T.green : T.red, fontWeight: FONT_WEIGHTS.regular }}>
            Net {formatAccountMoney(netExposure, currency, true, maskValues)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AllocationCompactContent;
