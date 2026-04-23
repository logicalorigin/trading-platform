import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";

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
  get background() {
    return T.bg1;
  },
  get border() {
    return `1px solid ${T.border}`;
  },
  get borderRadius() {
    return dim(6);
  },
  get boxShadow() {
    return T.bg0 === "#f5f5f4"
      ? "0 8px 20px rgba(15,23,42,0.05)"
      : "0 8px 20px rgba(0,0,0,0.12)";
  },
};

export const sectionTitleStyle = {
  get fontSize() {
    return fs(10);
  },
  get color() {
    return T.text;
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const mutedLabelStyle = {
  get fontSize() {
    return fs(8);
  },
  get color() {
    return T.textMuted;
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const toneValueMap = () => ({
  default: { color: T.textDim, border: T.border, bg: T.bg2 },
  accent: {
    color: T.accent,
    border: `${T.accent}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : T.accentDim,
  },
  green: {
    color: T.green,
    border: `${T.green}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : T.greenBg,
  },
  red: {
    color: T.red,
    border: `${T.red}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : T.redBg,
  },
  amber: {
    color: T.amber,
    border: `${T.amber}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : T.amberBg,
  },
  cyan: {
    color: T.cyan,
    border: `${T.cyan}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : `${T.cyan}18`,
  },
  purple: {
    color: T.purple,
    border: `${T.purple}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : `${T.purple}18`,
  },
});

export const denseButtonStyle = (active = false) => ({
  height: dim(25),
  padding: sp("0 9px"),
  borderRadius: dim(4),
  border: `1px solid ${active ? T.accent : T.border}`,
  background: active ? (T.bg1 === "#ffffff" ? T.bg1 : T.accent) : T.bg2,
  color: active ? (T.bg1 === "#ffffff" ? T.accent : "#ffffff") : T.textSec,
  fontSize: fs(9),
  fontFamily: T.mono,
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
});

export const primaryButtonStyle = {
  get height() {
    return dim(28);
  },
  get padding() {
    return sp("0 10px");
  },
  get borderRadius() {
    return dim(4);
  },
  border: "none",
  get background() {
    return T.accent;
  },
  color: "#ffffff",
  get fontSize() {
    return fs(9);
  },
  get fontFamily() {
    return T.mono;
  },
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

export const secondaryButtonStyle = {
  get height() {
    return dim(28);
  },
  get padding() {
    return sp("0 10px");
  },
  get borderRadius() {
    return dim(4);
  },
  get border() {
    return `1px solid ${T.border}`;
  },
  get background() {
    return T.bg2;
  },
  get color() {
    return T.textSec;
  },
  get fontSize() {
    return fs(9);
  },
  get fontFamily() {
    return T.mono;
  },
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

export const ghostButtonStyle = {
  get height() {
    return dim(28);
  },
  get padding() {
    return sp("0 10px");
  },
  get borderRadius() {
    return dim(4);
  },
  get border() {
    return `1px solid ${T.border}`;
  },
  background: "transparent",
  get color() {
    return T.textDim;
  },
  get fontSize() {
    return fs(9);
  },
  get fontFamily() {
    return T.mono;
  },
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

export const controlInputStyle = {
  get height() {
    return dim(28);
  },
  get padding() {
    return sp("0 8px");
  },
  get borderRadius() {
    return dim(4);
  },
  get border() {
    return `1px solid ${T.border}`;
  },
  get background() {
    return T.bg0;
  },
  get color() {
    return T.text;
  },
  get fontSize() {
    return fs(9);
  },
  get fontFamily() {
    return T.sans;
  },
  outline: "none",
};

export const controlSelectStyle = {
  get height() {
    return dim(28);
  },
  get padding() {
    return sp("0 8px");
  },
  get borderRadius() {
    return dim(4);
  },
  get border() {
    return `1px solid ${T.border}`;
  },
  get background() {
    return T.bg0;
  },
  get color() {
    return T.text;
  },
  get fontSize() {
    return fs(9);
  },
  get fontFamily() {
    return T.sans;
  },
  outline: "none",
  cursor: "pointer",
};

export const tableHeaderStyle = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  get background() {
    return T.bg2;
  },
  get color() {
    return T.textMuted;
  },
  get fontSize() {
    return fs(8);
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  get borderBottom() {
    return `1px solid ${T.border}`;
  },
};

export const tableCellStyle = {
  get padding() {
    return sp("5px 7px");
  },
  get borderBottom() {
    return `1px solid ${T.border}`;
  },
  get fontSize() {
    return fs(9);
  },
  get fontFamily() {
    return T.sans;
  },
  get color() {
    return T.textSec;
  },
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

export const moveTableFocus = (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }

  const row = event.currentTarget;
  const next =
    event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;

  if (next?.focus) {
    event.preventDefault();
    next.focus();
  }
};

export const Pill = ({ children, tone = "default", title, style }) => {
  const paletteMap = toneValueMap();
  const palette = paletteMap[tone] || paletteMap.default;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
        minHeight: dim(18),
        padding: sp("0 6px"),
        borderRadius: dim(4),
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        fontSize: fs(8),
        fontFamily: T.mono,
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </span>
  );
};

export const ToggleGroup = ({ options, value, onChange }) => (
  <div
    style={{
      display: "inline-flex",
      gap: 1,
      padding: 2,
      border: `1px solid ${T.border}`,
      borderRadius: dim(4),
      background: T.bg2,
      flexWrap: "wrap",
    }}
  >
    {options.map((option) => {
      const item = typeof option === "string" ? { value: option, label: option } : option;
      const active = item.value === value;
      return (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          style={denseButtonStyle(active)}
        >
          {item.label}
        </button>
      );
    })}
  </div>
);

export const StatTile = ({
  label,
  value,
  subvalue,
  tone = "default",
  title,
  align = "left",
  compact = false,
  flat = false,
  style,
}) => {
  const paletteMap = toneValueMap();
  const palette = paletteMap[tone] || paletteMap.default;
  return (
    <div
      title={title}
      style={{
        minWidth: dim(flat ? 0 : compact ? 94 : 116),
        padding: sp(flat ? (compact ? "1px 6px" : "3px 8px") : compact ? "6px 8px" : "8px 10px"),
        borderRadius: flat ? 0 : dim(5),
        border: flat ? "none" : `1px solid ${T.border}`,
        background: flat ? "transparent" : T.bg2,
        textAlign: align,
        ...style,
      }}
    >
      <div style={mutedLabelStyle}>{label}</div>
      <div
        style={{
          marginTop: sp(compact ? 1 : 4),
          color: palette.color === T.textDim ? T.text : palette.color,
          fontSize: fs(compact ? 12 : 14),
          fontFamily: T.mono,
          fontWeight: 800,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {subvalue ? (
        <div
          style={{
            marginTop: sp(compact ? 1 : 3),
            color: T.textDim,
            fontSize: fs(compact ? 8 : 9),
            fontFamily: T.mono,
            lineHeight: 1.3,
          }}
        >
          {subvalue}
        </div>
      ) : null}
    </div>
  );
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
      borderRadius: dim(5),
      background: `${T.bg0}aa`,
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
  rightRail,
  action,
  children,
  loading,
  error,
  onRetry,
  minHeight = 220,
  noPad = false,
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
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: sp(10),
        padding: sp("8px 10px 7px"),
        borderBottom: `1px solid ${T.border}`,
        background: T.bg1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={sectionTitleStyle}>{title}</div>
        {subtitle || rightRail ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(8),
              marginTop: sp(3),
              flexWrap: "wrap",
            }}
          >
            {subtitle ? <div style={mutedLabelStyle}>{subtitle}</div> : <span />}
            {rightRail ? (
              <div
                style={{
                  color: T.textDim,
                  fontSize: fs(9),
                  fontFamily: T.mono,
                }}
              >
                {rightRail}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {action}
    </div>
    <div style={{ flex: 1, minHeight: 0, padding: noPad ? 0 : sp(10) }}>
      {loading ? <SkeletonRows /> : error ? <InlineError error={error} onRetry={onRetry} /> : children}
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
          borderRadius: dim(4),
          background: `linear-gradient(90deg, ${T.bg2}, ${T.bg3}, ${T.bg2})`,
          border: `1px solid ${T.border}`,
        }}
      />
    ))}
  </div>
);

export const InlineError = ({ error, onRetry }) => (
  <div
    role="alert"
    style={{
      padding: sp(12),
      color: T.red,
      background: T.redBg,
      border: `1px solid ${T.red}55`,
      borderRadius: dim(5),
      fontSize: fs(11),
      fontFamily: T.sans,
      lineHeight: 1.5,
    }}
  >
    <div>{error?.message || "Unable to load this account panel."}</div>
    {typeof onRetry === "function" ? (
      <button
        type="button"
        onClick={onRetry}
        style={{ ...secondaryButtonStyle, marginTop: sp(10), color: T.red }}
      >
        Retry
      </button>
    ) : null}
  </div>
);
