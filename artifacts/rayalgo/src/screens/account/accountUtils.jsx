import { MISSING_VALUE, T, dim, sp, textSize } from "../../lib/uiTokens";
import { formatAppDateTime } from "../../lib/timeZone";
export { ACCOUNT_RANGES, normalizeAccountRange } from "./accountRanges";

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

export const ACCOUNT_VALUE_MASK = "****";

export const maskAccountValue = (value, maskValues = false) =>
  maskValues ? ACCOUNT_VALUE_MASK : value;

export const formatAccountMoney = (
  value,
  currency = "USD",
  compact = false,
  maskValues = false,
) => (maskValues ? ACCOUNT_VALUE_MASK : formatMoney(value, currency, compact));

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

export const formatAccountSignedMoney = (
  value,
  currency = "USD",
  compact = false,
  maskValues = false,
) => (maskValues ? ACCOUNT_VALUE_MASK : formatSignedMoney(value, currency, compact));

export const formatAccountPercent = (
  value,
  digits = 2,
  maskValues = false,
) => (maskValues ? ACCOUNT_VALUE_MASK : formatPercent(value, digits));

export const toneForValue = (value) => {
  if (value == null || Number.isNaN(Number(value))) return T.textDim;
  return Number(value) >= 0 ? T.green : T.red;
};

export const metricTitle = (metric) => {
  if (!metric) return "Provider field unavailable";
  const parts = [
    metric.source ? `Source: ${metric.source}` : null,
    metric.field ? `Field: ${metric.field}` : null,
    metric.updatedAt ? `Updated: ${formatAppDateTime(metric.updatedAt)}` : null,
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
    return textSize("panelTitle");
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
    return textSize("label");
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
  pink: {
    color: T.pink,
    border: `${T.pink}44`,
    bg: T.bg1 === "#ffffff" ? T.bg1 : `${T.pink}18`,
  },
});

export const denseButtonStyle = (active = false) => ({
  height: dim(21),
  padding: sp("0 6px"),
  borderRadius: dim(4),
  border: `1px solid ${active ? T.accent : T.border}`,
  background: active ? (T.bg1 === "#ffffff" ? T.bg1 : T.accent) : T.bg2,
  color: active ? (T.bg1 === "#ffffff" ? T.accent : "#ffffff") : T.textSec,
  fontSize: textSize("control"),
  fontFamily: T.data,
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
});

export const primaryButtonStyle = {
  get height() {
    return dim(22);
  },
  get padding() {
    return sp("0 8px");
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
    return textSize("control");
  },
  get fontFamily() {
    return T.data;
  },
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

export const secondaryButtonStyle = {
  get height() {
    return dim(22);
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
    return T.bg2;
  },
  get color() {
    return T.textSec;
  },
  get fontSize() {
    return textSize("control");
  },
  get fontFamily() {
    return T.data;
  },
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

export const ghostButtonStyle = {
  get height() {
    return dim(22);
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
  background: "transparent",
  get color() {
    return T.textDim;
  },
  get fontSize() {
    return textSize("control");
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
    return dim(22);
  },
  get padding() {
    return sp("0 7px");
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
    return textSize("control");
  },
  get fontFamily() {
    return T.sans;
  },
  outline: "none",
};

export const controlSelectStyle = {
  get height() {
    return dim(22);
  },
  get padding() {
    return sp("0 7px");
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
    return textSize("control");
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
    return textSize("tableHeader");
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
    return sp("3px 5px");
  },
  get borderBottom() {
    return `1px solid ${T.border}`;
  },
  get fontSize() {
    return textSize("tableCell");
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
        minHeight: dim(15),
        padding: sp("0 4px"),
        borderRadius: dim(4),
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        fontSize: textSize("label"),
        fontFamily: T.data,
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
          className={active ? "ra-focus-rail ra-interactive" : "ra-interactive"}
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
  className,
  style,
}) => {
  const paletteMap = toneValueMap();
  const palette = paletteMap[tone] || paletteMap.default;
  return (
    <div
      title={title}
      className={className || (flat ? undefined : "ra-panel-enter")}
      style={{
        minWidth: dim(flat ? 0 : compact ? 86 : 108),
        padding: sp(flat ? (compact ? "1px 5px" : "2px 7px") : compact ? "5px 7px" : "7px 9px"),
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
          fontSize: textSize(compact ? "metric" : "bodyStrong"),
          fontFamily: T.data,
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
            fontSize: textSize(compact ? "label" : "caption"),
            fontFamily: T.data,
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
    className="ra-panel-enter"
    style={{
      minHeight: dim(72),
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: sp(5),
      padding: sp(8),
      color: T.textDim,
      fontSize: textSize("body"),
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
  minHeight = 0,
  noPad = false,
  className,
}) => (
  <section
    tabIndex={0}
    className={className || "ra-panel-enter"}
    style={{
      ...panelStyle,
      minHeight: minHeight ? dim(minHeight) : undefined,
      display: "flex",
      flexDirection: "column",
      alignSelf: "start",
      overflow: "hidden",
      outline: "none",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(5),
        padding: sp("4px 6px 3px"),
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
              gap: sp(5),
              marginTop: sp(1),
              flexWrap: "wrap",
            }}
          >
            {subtitle ? <div style={mutedLabelStyle}>{subtitle}</div> : <span />}
            {rightRail ? (
              <div
                style={{
                  color: T.textDim,
                  fontSize: textSize("label"),
                  fontFamily: T.data,
                  fontWeight: 800,
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
    <div style={{ flex: "0 1 auto", minHeight: 0, padding: noPad ? 0 : sp(6) }}>
      {loading ? <SkeletonRows /> : error ? <InlineError error={error} onRetry={onRetry} /> : children}
    </div>
  </section>
);

export const SkeletonRows = ({ rows = 4 }) => (
  <div style={{ display: "grid", gap: sp(6) }}>
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        className="ra-skeleton"
        style={{
          height: dim(index === 0 ? 34 : 24),
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
      padding: sp(10),
      color: T.red,
      background: T.redBg,
      border: `1px solid ${T.red}55`,
      borderRadius: dim(5),
      fontSize: textSize("body"),
      fontFamily: T.sans,
      lineHeight: 1.5,
    }}
  >
    <div>{error?.message || "Unable to load this account panel."}</div>
    {typeof onRetry === "function" ? (
      <button
        type="button"
        className="ra-interactive"
        onClick={onRetry}
        style={{ ...secondaryButtonStyle, marginTop: sp(10), color: T.red }}
      >
        Retry
      </button>
    ) : null}
  </div>
);
