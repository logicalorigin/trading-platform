import { TrendingDown, TrendingUp } from "lucide-react";
import { RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
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
  shadowMode = false,
  isPhone = false,
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
        gap: sp(isPhone ? 8 : 14),
        padding: sp(isPhone ? "16px 4px 4px" : "20px 4px 8px"),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            color: T.textMuted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          {shadowMode ? "Shadow Portfolio" : "Portfolio"}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isPhone ? "1fr" : "auto 1fr",
          alignItems: "flex-end",
          gap: sp(isPhone ? 10 : 24),
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(isPhone ? 28 : 38),
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.025em",
            lineHeight: 1,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {formatMoney(netLiquidation, currency, maskValues)}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: sp(isPhone ? 8 : 16),
            paddingBottom: sp(isPhone ? 0 : 6),
          }}
        >
          {dayPositive !== null ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(5),
                padding: sp("4px 10px"),
                background: `${dayTone}12`,
                borderRadius: dim(RADII.pill),
                color: dayTone,
                fontFamily: T.sans,
                fontSize: textSize("paragraph"),
                fontWeight: 500,
              }}
            >
              <DayIcon size={14} />
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(dayPnl, currency, maskValues)}
              </span>
              {formatPercent(dayPnlPercent, maskValues) ? (
                <span
                  style={{
                    color: dayTone,
                    opacity: 0.75,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatPercent(dayPnlPercent, maskValues)}
                </span>
              ) : null}
              <span style={{ color: T.textMuted, fontWeight: 400 }}>today</span>
            </div>
          ) : null}
          {totalPositive !== null && !isPhone ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(5),
                color: T.textSec,
                fontFamily: T.sans,
                fontSize: textSize("paragraphMuted"),
              }}
            >
              <span style={{ color: T.textMuted }}>All-time</span>
              <span
                style={{
                  color: totalTone,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 500,
                }}
              >
                {formatMoney(totalPnl, currency, maskValues)}
              </span>
              {formatPercent(totalPnlPercent, maskValues) ? (
                <span
                  style={{
                    color: totalTone,
                    opacity: 0.75,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatPercent(totalPnlPercent, maskValues)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default AccountHeroBlock;
