import { CSS_COLOR, dim, FONT_WEIGHTS, MISSING_VALUE, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

export const HeaderAccountStrip = ({
  accounts = [],
  primaryAccountId,
  primaryAccount,
  onSelectAccount,
  maskValues = false,
  dense = false,
  compact = false,
  minimal = false,
}) => {
  const maskAccountValue = (value) =>
    maskValues ? "****" : primaryAccount ? fmtCompactCurrency(value) : MISSING_VALUE;
  const metricItems = [
    {
      label: "Net Liq",
      shortLabel: "NLV",
      value: maskAccountValue(primaryAccount?.netLiquidation),
      color: CSS_COLOR.text,
    },
    {
      label: "Buying Power",
      shortLabel: "BP",
      value: maskAccountValue(primaryAccount?.buyingPower),
      color: CSS_COLOR.text,
    },
    {
      label: "Cash",
      shortLabel: "Cash",
      value: maskAccountValue(primaryAccount?.cash),
      color: CSS_COLOR.textSec,
    },
  ].filter((metric) => !minimal && !(compact && metric.shortLabel === "Cash"));
  const accountLabel = minimal || compact ? "" : dense ? "Acct" : "Account";
  const labelStyle = {
    fontSize: textSize(dense || compact || minimal ? "micro" : "caption"),
    color: CSS_COLOR.textMuted,
    fontWeight: FONT_WEIGHTS.medium,
    letterSpacing: dense || compact || minimal ? 0 : "0.04em",
    textTransform: "uppercase",
    fontFamily: T.sans,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };
  const valueStyle = {
    fontSize: textSize(dense || compact || minimal ? "body" : "bodyStrong"),
    fontFamily: T.sans,
    fontVariantNumeric: "tabular-nums",
    fontWeight: FONT_WEIGHTS.medium,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "visible",
  };
  const surfaceStyle = {
    width: minimal ? "auto" : "max-content",
    minWidth: minimal ? 0 : "max-content",
    minHeight: dim(dense || compact || minimal ? 22 : 30),
    padding: sp(dense || compact || minimal ? "0px 4px" : "2px 8px"),
    boxSizing: "border-box",
    background: "transparent",
    border: "none",
    borderRadius: 0,
    display: "flex",
    alignItems: "center",
    gap: sp(dense || compact || minimal ? 5 : 10),
    overflow: "visible",
    flex: minimal ? "0 1 auto" : "0 0 max-content",
    transition: "background var(--ra-motion-fast) ease",
  };

  return (
    <AppTooltip content="Active broker account and account summary"><div
      data-testid="platform-header-account"
      className="ra-hover-accent-bg"
      style={{
        ...surfaceStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "center",
          gap: sp(dense || compact ? 3 : 5),
          minWidth: minimal ? 0 : "max-content",
          flex: minimal ? "0 1 auto" : "0 0 max-content",
        }}
      >
        {accountLabel ? <span style={labelStyle}>{accountLabel}</span> : null}
        {accounts.length ? (
          <select
            value={primaryAccountId || ""}
            onChange={(event) => onSelectAccount(event.target.value || null)}
            style={{
              width: minimal ? "auto" : "max-content",
              maxWidth: minimal ? dim(96) : "none",
              minWidth: minimal ? 0 : "max-content",
              background: "transparent",
              border: "none",
              color: CSS_COLOR.text,
              fontSize: textSize(dense || compact || minimal ? "body" : "bodyStrong"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              outline: "none",
              padding: 0,
              lineHeight: 1.2,
              overflow: "visible",
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.id}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ ...valueStyle, color: CSS_COLOR.textDim }}>
            {primaryAccountId || MISSING_VALUE}
          </span>
        )}
      </div>
      {metricItems.map((metric) => {
        const visibleLabel = dense || compact ? metric.shortLabel : metric.label;
        const metricNode = (
          <div
            key={metric.label}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "center",
              gap: sp(dense || compact ? 3 : 5),
              minWidth: "max-content",
              flex: "0 0 max-content",
              paddingLeft: sp(dense || compact ? 5 : 8),
              borderLeft: `1px solid ${CSS_COLOR.borderLight}`,
            }}
          >
            <span style={labelStyle}>{visibleLabel}</span>
            <span style={{ ...valueStyle, color: metric.color }}>
              {metric.value}
            </span>
          </div>
        );
        return visibleLabel !== metric.label ? (
          <AppTooltip key={metric.label} content={metric.label}>
            {metricNode}
          </AppTooltip>
        ) : (
          metricNode
        );
      })}
    </div></AppTooltip>
  );
};
