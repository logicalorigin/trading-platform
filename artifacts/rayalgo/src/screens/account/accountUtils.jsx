import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../RayAlgoPlatform";

export const ACCOUNT_RANGES = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

export const formatMoney = (value, currency = "USD", compact = false) => {
  if (value == null || Number.isNaN(Number(value))) return MISSING_VALUE;
  const numeric = Number(value);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (compact && Math.abs(numeric) >= 1e6) {
    return `${symbol}${(numeric / 1e6).toFixed(2)}M`;
  }
  if (compact && Math.abs(numeric) >= 1e3) {
    return `${symbol}${(numeric / 1e3).toFixed(1)}K`;
  }
  return `${symbol}${numeric.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(numeric) >= 100 ? 0 : 2,
  })}`;
};

export const formatNumber = (value, digits = 2) => {
  if (value == null || Number.isNaN(Number(value))) return MISSING_VALUE;
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
};

export const formatPercent = (value, digits = 2) => {
  if (value == null || Number.isNaN(Number(value))) return MISSING_VALUE;
  return `${Number(value).toFixed(digits)}%`;
};

export const formatSignedMoney = (value, currency = "USD", compact = false) => {
  if (value == null || Number.isNaN(Number(value))) return MISSING_VALUE;
  const numeric = Number(value);
  const formatted = formatMoney(Math.abs(numeric), currency, compact);
  return `${numeric >= 0 ? "+" : "-"}${formatted}`;
};

export const toneForValue = (value) => {
  if (value == null || Number.isNaN(Number(value))) return T.textDim;
  return Number(value) >= 0 ? T.green : T.red;
};

export const metricTitle = (metric) => {
  if (!metric) return "Provider field unavailable";
  const parts = [
    metric.source ? `Source: ${metric.source}` : null,
    metric.field ? `Field: ${metric.field}` : null,
    metric.updatedAt ? `Updated: ${new Date(metric.updatedAt).toLocaleString()}` : null,
  ].filter(Boolean);
  return parts.join("\n") || "Provider field unavailable";
};

export const panelStyle = {
  background: `linear-gradient(145deg, ${T.bg1}, ${T.bg2})`,
  border: `1px solid ${T.border}`,
  borderRadius: 0,
  boxShadow: "0 18px 45px rgba(0,0,0,0.18)",
};

export const sectionTitleStyle = {
  fontSize: fs(11),
  color: T.text,
  fontFamily: T.sans,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const mutedLabelStyle = {
  fontSize: fs(9),
  color: T.textMuted,
  fontFamily: T.sans,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

export const denseButtonStyle = (active = false) => ({
  height: dim(24),
  padding: sp("0 8px"),
  border: `1px solid ${active ? T.accent : T.border}`,
  background: active ? `${T.accent}22` : T.bg2,
  color: active ? T.accent : T.textSec,
  fontSize: fs(10),
  fontFamily: T.sans,
  fontWeight: 800,
  cursor: "pointer",
});

export const tableHeaderStyle = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: T.bg1,
  color: T.textMuted,
  fontSize: fs(9),
  fontFamily: T.sans,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  borderBottom: `1px solid ${T.border}`,
};

export const tableCellStyle = {
  padding: sp("7px 8px"),
  borderBottom: `1px solid ${T.border}`,
  fontSize: fs(10),
  fontFamily: T.sans,
  color: T.textSec,
  whiteSpace: "nowrap",
};

export const EmptyState = ({ title, body, action }) => (
  <div
    style={{
      minHeight: dim(120),
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: sp(8),
      padding: sp(16),
      color: T.textDim,
      fontSize: fs(11),
      fontFamily: T.sans,
      border: `1px dashed ${T.border}`,
      background: "rgba(15,23,42,0.35)",
    }}
  >
    <div style={{ color: T.text, fontWeight: 800 }}>{title}</div>
    <div style={{ lineHeight: 1.5 }}>{body}</div>
    {action}
  </div>
);

export const Panel = ({
  title,
  subtitle,
  action,
  children,
  loading,
  error,
  minHeight = 220,
}) => (
  <section
    tabIndex={0}
    style={{
      ...panelStyle,
      minHeight: dim(minHeight),
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      outline: "none",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(10),
        padding: sp("10px 12px 8px"),
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div>
        <div style={sectionTitleStyle}>{title}</div>
        {subtitle ? (
          <div style={{ ...mutedLabelStyle, marginTop: 3 }}>{subtitle}</div>
        ) : null}
      </div>
      {action}
    </div>
    <div style={{ flex: 1, minHeight: 0, padding: sp(12) }}>
      {loading ? <SkeletonRows /> : error ? <InlineError error={error} /> : children}
    </div>
  </section>
);

export const SkeletonRows = ({ rows = 4 }) => (
  <div style={{ display: "grid", gap: sp(8) }}>
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        style={{
          height: dim(index === 0 ? 42 : 30),
          background:
            "linear-gradient(90deg, rgba(30,41,59,0.7), rgba(51,65,85,0.45), rgba(30,41,59,0.7))",
          border: `1px solid ${T.border}`,
        }}
      />
    ))}
  </div>
);

export const InlineError = ({ error }) => (
  <div
    role="alert"
    style={{
      padding: sp(12),
      color: T.red,
      background: "rgba(239,68,68,0.08)",
      border: `1px solid ${T.red}55`,
      fontSize: fs(11),
      fontFamily: T.sans,
      lineHeight: 1.5,
    }}
  >
    {error?.message || "Unable to load this account panel."}
  </div>
);
