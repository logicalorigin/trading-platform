import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";
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
    fontSize: fs(7),
    color: T.textMuted,
    fontWeight: 400,
    letterSpacing: "0.05em",
    fontFamily: T.sans,
    lineHeight: 1.05,
    whiteSpace: "nowrap",
  };
  const valueStyle = {
    fontSize: fs(9),
    fontFamily: T.sans,
    fontWeight: 400,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };
  const surfaceStyle = {
    minWidth: dim(270),
    minHeight: dim(32),
    padding: sp("3px 7px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    display: "flex",
    alignItems: "center",
    gap: sp(8),
    transition: "background 0.12s ease, border-color 0.12s ease",
  };

  return (
    <AppTooltip content="Active broker account and account summary"><div
      data-testid="platform-header-account"
      style={{
        ...surfaceStyle,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = T.bg3;
        event.currentTarget.style.borderColor = T.textMuted;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = T.bg1;
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
        <span style={labelStyle}>ACCOUNT</span>
        {accounts.length ? (
          <select
            value={primaryAccountId || ""}
            onChange={(event) => onSelectAccount(event.target.value || null)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: T.text,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 400,
              outline: "none",
              padding: 0,
              lineHeight: 1.1,
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
