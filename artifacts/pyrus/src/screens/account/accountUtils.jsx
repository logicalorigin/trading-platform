import {
  useState,
} from "react";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import { AppTooltip } from "@/components/ui/tooltip";
import { ContainerLoadingStatus } from "../../components/platform/ContainerLoadingStatus.jsx";
import { Badge, SegmentedControl, Skeleton } from "../../components/platform/primitives.jsx";
import { normalizeAccountCurrency } from "./accountCurrency.js";

const NUMBER_FORMATTER_CACHE_LIMIT = 64;
const numberFormatterCache = new Map();

const finiteDisplayNumber = (value) => {
  if (
    value == null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getNumberFormatter = (key, options) => {
  const cached = numberFormatterCache.get(key);
  if (cached) {
    return cached;
  }
  if (numberFormatterCache.size >= NUMBER_FORMATTER_CACHE_LIMIT) {
    const oldestKey = numberFormatterCache.keys().next().value;
    if (oldestKey) {
      numberFormatterCache.delete(oldestKey);
    }
  }
  const formatter = new Intl.NumberFormat(undefined, options);
  numberFormatterCache.set(key, formatter);
  return formatter;
};

export const formatMoney = (value, currency = "USD", compact = false) => {
  const numeric = finiteDisplayNumber(value);
  const normalizedCurrency = normalizeAccountCurrency(currency);
  if (numeric == null || !normalizedCurrency) return MISSING_VALUE;
  const symbol = normalizedCurrency === "USD" ? "$" : `${normalizedCurrency} `;
  if (compact && Math.abs(numeric) >= 1e6) {
    return `${symbol}${(numeric / 1e6).toFixed(2)}M`;
  }
  if (compact && Math.abs(numeric) >= 1e3) {
    return `${symbol}${(numeric / 1e3).toFixed(1)}K`;
  }
  const maximumFractionDigits = Math.abs(numeric) >= 100 ? 0 : 2;
  return `${symbol}${getNumberFormatter(
    `money:${maximumFractionDigits}`,
    { maximumFractionDigits },
  ).format(numeric)}`;
};

export const ACCOUNT_VALUE_MASK = "****";

export const maskAccountValue = (value, maskValues = false) =>
  maskValues ? ACCOUNT_VALUE_MASK : value;

// Account identifiers must never render in full (Security Requirement: mask
// account identifiers in the UI). Show only the last four characters behind a
// dot prefix, e.g. "••••1234".
export const maskAccountId = (id) => {
  const raw = id == null ? "" : String(id).trim();
  if (!raw) return MISSING_VALUE;
  return `••••${raw.slice(-4)}`;
};

export const formatAccountMoney = (
  value,
  currency = "USD",
  compact = false,
  maskValues = false,
) => (maskValues ? ACCOUNT_VALUE_MASK : formatMoney(value, currency, compact));

export const formatNumber = (value, digits = 2) => {
  const numeric = finiteDisplayNumber(value);
  if (numeric == null) return MISSING_VALUE;
  return getNumberFormatter(
    `number:${digits}`,
    { maximumFractionDigits: digits },
  ).format(numeric);
};

export const formatAccountPrice = (value, digits = 2, maskValues = false) => {
  if (maskValues) return ACCOUNT_VALUE_MASK;
  const numeric = finiteDisplayNumber(value);
  if (numeric == null) return MISSING_VALUE;
  return getNumberFormatter(
    `price:${digits}`,
    {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    },
  ).format(numeric);
};

export const formatPercent = (value, digits = 2) => {
  const numeric = finiteDisplayNumber(value);
  return numeric == null ? MISSING_VALUE : `${numeric.toFixed(digits)}%`;
};

export const formatSignedMoney = (value, currency = "USD", compact = false) => {
  const numeric = finiteDisplayNumber(value);
  if (numeric == null) return MISSING_VALUE;
  const formatted = formatMoney(Math.abs(numeric), currency, compact);
  if (formatted === MISSING_VALUE) return MISSING_VALUE;
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
  const numeric = finiteDisplayNumber(value);
  if (numeric == null) return "var(--ra-pnl-neutral)";
  return numeric >= 0 ? "var(--ra-pnl-positive)" : "var(--ra-pnl-negative)";
};

export const cellSubTextStyle = (tone = CSS_COLOR.textMuted, role = "text") => ({
  color: tone,
  fontFamily: role === "data" ? T.data : T.sans,
  fontSize: textSize("caption"),
  ...(role === "data" ? { fontVariantNumeric: "tabular-nums" } : {}),
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

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
    return CSS_COLOR.bg1;
  },
  border: "none",
  get borderRadius() {
    return dim(RADII.md);
  },
  get boxShadow() {
    return ELEVATION.sm;
  },
};

export const sectionTitleStyle = {
  get fontSize() {
    return textSize("displaySmall");
  },
  get color() {
    return CSS_COLOR.text;
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.label,
  letterSpacing: 0,
  lineHeight: 1.2,
};

export const sectionEyebrowStyle = {
  get fontSize() {
    return textSize("caption");
  },
  get color() {
    return CSS_COLOR.textMuted;
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

export const mutedLabelStyle = {
  get fontSize() {
    return textSize("caption");
  },
  get color() {
    return CSS_COLOR.textMuted;
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.02em",
};

const tokenTone = (tokenName) => `var(${tokenName})`;

const toneColorMap = () => ({
  default: CSS_COLOR.textDim,
  accent: CSS_COLOR.accent,
  green: CSS_COLOR.green,
  red: CSS_COLOR.red,
  amber: CSS_COLOR.amber,
  cyan: CSS_COLOR.cyan,
  purple: CSS_COLOR.purple,
  pink: CSS_COLOR.pink,
  "pnl-positive": tokenTone("--ra-pnl-positive"),
  "pnl-negative": tokenTone("--ra-pnl-negative"),
  "side-buy": tokenTone("--ra-side-buy"),
  "side-sell": tokenTone("--ra-side-sell"),
  "status-filled": tokenTone("--ra-status-filled"),
  "status-working": tokenTone("--ra-status-working"),
  "status-rejected": tokenTone("--ra-status-rejected"),
  "stream-healthy": tokenTone("--ra-stream-healthy"),
  "stream-offline": tokenTone("--ra-stream-offline"),
  "category-automation": tokenTone("--ra-category-automation"),
  "category-replay": tokenTone("--ra-category-replay"),
  "category-backtest": tokenTone("--ra-category-backtest"),
  "category-mixed": tokenTone("--ra-category-mixed"),
});

export const denseButtonStyle = (active = false) => ({
  height: dim(22),
  padding: sp("0 10px"),
  borderRadius: dim(RADII.pill),
  border: "none",
  background: active ? CSS_COLOR.bg1 : "transparent",
  color: active ? CSS_COLOR.text : CSS_COLOR.textDim,
  boxShadow: active ? ELEVATION.sm : "none",
  fontSize: textSize("control"),
  fontFamily: T.sans,
  fontWeight: active ? FONT_WEIGHTS.label : FONT_WEIGHTS.medium,
  cursor: "pointer",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  transition: "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
});

export const primaryButtonStyle = {
  get height() {
    return dim(24);
  },
  get padding() {
    return sp("0 12px");
  },
  borderRadius: dim(RADII.pill),
  border: "none",
  get background() {
    return CSS_COLOR.accent;
  },
  get color() {
    return CSS_COLOR.onAccent;
  },
  get fontSize() {
    return textSize("control");
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.label,
  cursor: "pointer",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

export const secondaryButtonStyle = {
  get height() {
    return dim(24);
  },
  get padding() {
    return sp("0 12px");
  },
  borderRadius: dim(RADII.pill),
  border: "none",
  get background() {
    return CSS_COLOR.bg2;
  },
  get color() {
    return CSS_COLOR.text;
  },
  get fontSize() {
    return textSize("control");
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.medium,
  cursor: "pointer",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

export const ghostButtonStyle = {
  get height() {
    return dim(24);
  },
  get padding() {
    return sp("0 12px");
  },
  borderRadius: dim(RADII.pill),
  border: "none",
  background: "transparent",
  get color() {
    return CSS_COLOR.textSec;
  },
  get fontSize() {
    return textSize("control");
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.medium,
  cursor: "pointer",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

export const controlInputStyle = {
  get height() {
    return dim(24);
  },
  get padding() {
    return sp("0 10px");
  },
  get borderRadius() {
    return dim(RADII.sm);
  },
  border: "none",
  get background() {
    return CSS_COLOR.bg2;
  },
  get color() {
    return CSS_COLOR.text;
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
    return dim(RADII.xs);
  },
  get border() {
    return `1px solid ${CSS_COLOR.border}`;
  },
  get background() {
    return CSS_COLOR.bg0;
  },
  get color() {
    return CSS_COLOR.text;
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
    return CSS_COLOR.bg1;
  },
  get color() {
    return CSS_COLOR.textSec;
  },
  get fontSize() {
    return textSize("body");
  },
  get fontFamily() {
    return T.sans;
  },
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  get borderBottom() {
    return `1px solid ${CSS_COLOR.border}`;
  },
};

export const tableCellStyle = {
  get padding() {
    return sp("3px 8px");
  },
  get borderBottom() {
    return `1px solid ${CSS_COLOR.borderLight}`;
  },
  get fontSize() {
    return textSize("body");
  },
  get fontFamily() {
    return T.sans;
  },
  get color() {
    return CSS_COLOR.textSec;
  },
  fontVariantNumeric: "tabular-nums",
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
  const colorMap = toneColorMap();
  const color =
    colorMap[tone] ||
    (typeof tone === "string" &&
    (tone.startsWith("var(") || tone.startsWith("#") || tone.startsWith("rgb"))
      ? tone
      : colorMap.default);
  return (
    <AppTooltip content={title}><Badge
      color={color}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
        ...style,
      }}
    >
      {children}
    </Badge></AppTooltip>
  );
};

// ToggleGroup is a thin alias for SegmentedControl kept for backward
// compatibility with existing call sites; the sliding indicator now
// carries the active affordance.
export const ToggleGroup = ({
  options,
  value,
  onChange,
  ariaLabel,
  radioGroup = false,
}) => (
  <SegmentedControl
    options={options}
    value={value}
    onChange={onChange}
    ariaLabel={ariaLabel}
    radioGroup={radioGroup}
  />
);

export const EmptyState = ({ title, body, action }) => (
  <div
    className="ra-panel-enter"
    style={{
      minHeight: dim(96),
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: sp(8),
      padding: sp("16px 18px"),
      color: CSS_COLOR.textMuted,
      fontSize: textSize("body"),
      fontFamily: T.sans,
      border: `1px dashed ${CSS_COLOR.border}`,
      borderRadius: dim(RADII.md),
      background: CSS_COLOR.bg1,
      textAlign: "center",
    }}
  >
    <div
      style={{
        color: CSS_COLOR.text,
        fontSize: textSize("paragraphMuted"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: 0,
      }}
    >
      {title}
    </div>
    <div style={{ lineHeight: 1.5, color: CSS_COLOR.textMuted }}>{body}</div>
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
  loadingWaitItems,
  loadingEndpoint,
  error,
  onRetry,
  minHeight = 0,
  noPad = false,
  fillBody = false,
  compact = false,
  className,
}) => (
  <section
    aria-label={title}
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
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: sp(compact ? 4 : 8),
        padding: sp(compact ? "4px 5px 3px" : "6px 10px 4px"),
        background: CSS_COLOR.bg1,
        flexWrap: "wrap",
      }}
    >
      {/* Hairline divider in place of a hard 1px border — the gradient
          fades to transparent at the left/right edges so the divider
          feels integrated with the surface rather than slicing across.
          Absolute-positioned at the bottom so it doesn't reflow flex
          children. */}
      <span
        aria-hidden="true"
        className="ra-hairline-h"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      />
      <div style={{ minWidth: 0, flex: compact ? "1 1 72px" : "1 1 180px" }}>
        <div
          style={{
            ...sectionTitleStyle,
            fontSize: textSize("bodyStrong"),
          }}
        >
          {title}
        </div>
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
            {subtitle ? (
              <div style={{ ...mutedLabelStyle, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {subtitle}
              </div>
            ) : <span />}
            {rightRail ? (
              <div
                style={{
                  color: CSS_COLOR.textDim,
                  fontSize: textSize("label"),
                  fontFamily: T.data,
                  fontWeight: FONT_WEIGHTS.regular,
                  minWidth: 0,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flexShrink: 1,
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
    <div
      style={{
        flex: fillBody ? "1 1 auto" : "0 1 auto",
        display: fillBody ? "flex" : undefined,
        flexDirection: fillBody ? "column" : undefined,
        minHeight: 0,
        padding: noPad ? 0 : sp(compact ? 4 : 6),
      }}
    >
      {loading ? (
        <div style={{ display: "grid", gap: sp(8) }}>
          <ContainerLoadingStatus
            items={
              loadingWaitItems || [
                {
                  id: `${title || "account-panel"}:loading`,
                  label: title || "Account panel",
                  status: "loading",
                  detail: subtitle,
                  endpoint: loadingEndpoint,
                },
              ]
            }
            testId="account-panel-loading-waits"
          />
          <SkeletonRows />
        </div>
      ) : error ? <InlineError error={error} onRetry={onRetry} /> : children}
    </div>
  </section>
);

export const SectionHeader = ({ title, rightSlot, onToggle, expanded }) => {
  const interactive = typeof onToggle === "function";
  const inner = (
    <>
      <div style={{ display: "flex", gap: sp(3), alignItems: "center", minWidth: 0 }}>
        {interactive ? (
          <span
            aria-hidden
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.data,
              fontSize: textSize("label"),
              width: 10,
              display: "inline-block",
              transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform var(--ra-motion-fast) ease",
            }}
          >
            ▾
          </span>
        ) : null}
        <div style={{ ...mutedLabelStyle, fontSize: textSize("caption") }}>{title}</div>
      </div>
      {rightSlot ? (
        <div
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.data,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {rightSlot}
        </div>
      ) : null}
    </>
  );
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="ra-interactive"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(5),
          border: "none",
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          background: "transparent",
          color: "inherit",
          textAlign: "left",
          width: "100%",
          padding: sp("0 0 2px 0"),
          cursor: "pointer",
        }}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(5),
        paddingBottom: sp(2),
        borderBottom: `1px solid ${CSS_COLOR.border}`,
      }}
    >
      {inner}
    </div>
  );
};

const COLLAPSIBLE_STORAGE_PREFIX = "pyrus:account:";

const readStoredOpen = (storageKey) => {
  if (typeof window === "undefined" || !storageKey) return null;
  try {
    const raw = window.localStorage.getItem(
      `${COLLAPSIBLE_STORAGE_PREFIX}${storageKey}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const writeStoredOpen = (storageKey, map) => {
  if (typeof window === "undefined" || !storageKey) return;
  try {
    window.localStorage.setItem(
      `${COLLAPSIBLE_STORAGE_PREFIX}${storageKey}`,
      JSON.stringify(map),
    );
  } catch {
    /* ignore */
  }
};

export const useCollapsibleSections = (storageKey, defaults = {}) => {
  const [overrides, setOverrides] = useState(() => readStoredOpen(storageKey) || {});
  const isOpen = (key) => (key in overrides ? overrides[key] : defaults[key] ?? true);
  const toggle = (key) => {
    setOverrides((prev) => {
      const next = { ...prev, [key]: !isOpen(key) };
      writeStoredOpen(storageKey, next);
      return next;
    });
  };
  return { isOpen, toggle };
};

export const SkeletonRows = ({ rows = 4 }) => (
  <div style={{ display: "grid", gap: sp(6) }}>
    {Array.from({ length: rows }).map((_, index) => (
      <Skeleton
        key={index}
        height={dim(index === 0 ? 34 : 24)}
        radius={RADII.sm}
      />
    ))}
  </div>
);

export const InlineError = ({ error, onRetry }) => (
  <div
    role="alert"
    style={{
      padding: sp(10),
      color: CSS_COLOR.red,
      background: CSS_COLOR.redBg,
      border: `1px solid ${cssColorMix(CSS_COLOR.red, 33)}`,
      borderRadius: dim(RADII.sm),
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
        style={{ ...secondaryButtonStyle, marginTop: sp(10), color: CSS_COLOR.red }}
      >
        Retry
      </button>
    ) : null}
  </div>
);
