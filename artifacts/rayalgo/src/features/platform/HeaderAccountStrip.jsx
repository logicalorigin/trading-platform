import { FONT_WEIGHTS, MISSING_VALUE, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
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
}) => {
  const maskAccountValue = (value) =>
    maskValues ? "****" : primaryAccount ? fmtCompactCurrency(value) : MISSING_VALUE;
  const metricItems = [
    {
      label: "Net Liq",
      value: maskAccountValue(primaryAccount?.netLiquidation),
      color: T.text,
    },
    {
      label: "Buying Power",
      value: maskAccountValue(primaryAccount?.buyingPower),
      color: T.green,
    },
    {
      label: "Cash",
      value: maskAccountValue(primaryAccount?.cash),
      color: T.textSec,
    },
  ];
  const labelStyle = {
    fontSize: textSize("caption"),
    color: T.textMuted,
    fontWeight: FONT_WEIGHTS.medium,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    fontFamily: T.sans,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };
  const valueStyle = {
    fontSize: textSize("paragraphMuted"),
    fontFamily: T.sans,
    fontVariantNumeric: "tabular-nums",
    fontWeight: FONT_WEIGHTS.medium,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
  const surfaceStyle = {
    minWidth: dim(280),
    minHeight: dim(38),
    padding: sp("6px 14px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: dim(RADII.sm),
    display: "flex",
    alignItems: "center",
    gap: sp(14),
    transition: "background 0.12s ease, border-color 0.12s ease",
  };

  return (
    <AppTooltip content="Active broker account and account summary"><div
      data-testid="platform-header-account"
      style={{
        ...surfaceStyle,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = T.accent;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = T.border;
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
          flex: "0 1 auto",
        }}
      >
        <span style={labelStyle}>Account</span>
        {accounts.length ? (
          <select
            value={primaryAccountId || ""}
            onChange={(event) => onSelectAccount(event.target.value || null)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: T.text,
              fontSize: textSize("paragraphMuted"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              outline: "none",
              padding: 0,
              lineHeight: 1.2,
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.id}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ ...valueStyle, color: T.textDim }}>
            {primaryAccountId || MISSING_VALUE}
          </span>
        )}
      </div>
      {metricItems.map((metric) => (
        <AppTooltip key={metric.label} content={metric.label}><div
          key={metric.label}
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          <span style={labelStyle}>{metric.label}</span>
          <span style={{ ...valueStyle, color: metric.color }}>
            {metric.value}
          </span>
        </div></AppTooltip>
      ))}
    </div></AppTooltip>
  );
};
