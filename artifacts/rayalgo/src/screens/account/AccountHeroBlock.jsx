import { TrendingDown, TrendingUp } from "lucide-react";
import { FONT_WEIGHTS, T, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatAccountMoney, formatAccountPercent } from "./accountUtils";

const MASKED = "•••••";

const formatMoney = (value, currency, masked) => {
  if (masked) return MASKED;
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return formatAccountMoney(Number(value), currency, true, false);
};

const formatPercent = (value, masked) => {
  if (masked) return MASKED;
  if (value == null || !Number.isFinite(Number(value))) return null;
  return formatAccountPercent(Number(value), 2, false);
};

export const AccountHeroBlock = ({
  summary,
  currency = "USD",
  maskValues = false,
  shadowMode: _shadowMode = false,
  isPhone = false,
  sectionControl = null,
}) => {
  const metrics = summary?.metrics || {};
  const netLiquidation = metrics.netLiquidation?.value;
  const dayPnl = metrics.dayPnl?.value;
  const dayPnlPercent = metrics.dayPnlPercent?.value;
  const totalPnl = metrics.totalPnl?.value;
  const totalPnlPercent = metrics.totalPnlPercent?.value;
  const dayPositive = Number.isFinite(Number(dayPnl)) ? Number(dayPnl) >= 0 : null;
  const totalPositive = Number.isFinite(Number(totalPnl))
    ? Number(totalPnl) >= 0
    : null;
  const dayTone =
    dayPositive === null ? T.textDim : dayPositive ? T.green : T.red;
  const totalTone =
    totalPositive === null ? T.textDim : totalPositive ? T.green : T.red;
  const DayIcon = dayPositive === false ? TrendingDown : TrendingUp;
  return (
    <section
      data-testid="account-hero-block"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(isPhone ? 3 : 4),
        padding: sp(isPhone ? "6px 4px 4px" : "10px 4px 6px"),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: sp(isPhone ? 8 : 12),
        }}
      >
        <div
          style={{
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(isPhone ? 22 : 38),
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.025em",
            lineHeight: 1,
            fontWeight: FONT_WEIGHTS.label,
            whiteSpace: "nowrap",
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatMoney(netLiquidation, currency, maskValues)}
        </div>
        {sectionControl ? (
          <div style={{ flexShrink: 0, maxWidth: "100%" }}>{sectionControl}</div>
        ) : null}
      </div>
      {dayPositive !== null || (totalPositive !== null && !isPhone) ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: sp(isPhone ? 6 : 10),
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {dayPositive !== null ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(3),
                color: dayTone,
              }}
            >
              <DayIcon size={11} />
              <span style={{ fontWeight: FONT_WEIGHTS.medium, fontVariantNumeric: "tabular-nums" }}>{formatMoney(dayPnl, currency, maskValues)}</span>
              {formatPercent(dayPnlPercent, maskValues) ? (
                <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
                  {formatPercent(dayPnlPercent, maskValues)}
                </span>
              ) : null}
              <span style={{ color: T.textMuted, marginLeft: sp(1) }}>today</span>
            </span>
          ) : null}
          {totalPositive !== null && !isPhone ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(3),
                color: T.textSec,
              }}
            >
              <span style={{ color: T.textMuted }}>All-time</span>
              <span style={{ color: totalTone }}>
                {formatMoney(totalPnl, currency, maskValues)}
              </span>
              {formatPercent(totalPnlPercent, maskValues) ? (
                <span style={{ color: totalTone, opacity: 0.75 }}>
                  {formatPercent(totalPnlPercent, maskValues)}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default AccountHeroBlock;
