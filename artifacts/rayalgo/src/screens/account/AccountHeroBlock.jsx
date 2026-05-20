import { TrendingDown, TrendingUp } from "lucide-react";
import { FONT_WEIGHTS, T, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { useNumberTick } from "../../lib/numberTick.js";
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
}) => {
  const metrics = summary?.metrics || {};
  const netLiquidation = metrics.netLiquidation?.value;
  const dayPnl = metrics.dayPnl?.value;
  const dayPnlPercent = metrics.dayPnlPercent?.value;

  // Animate the hero net liquidation value when it changes (rAF-driven,
  // respects prefers-reduced-motion). Disabled when masked since the
  // bullets aren't a number.
  const animatedNet = useNumberTick(
    maskValues ? null : Number.isFinite(Number(netLiquidation)) ? Number(netLiquidation) : null,
    520,
  );
  const animatedDayPnl = useNumberTick(
    maskValues ? null : Number.isFinite(Number(dayPnl)) ? Number(dayPnl) : null,
    520,
  );
  const displayNet = animatedNet ?? netLiquidation;
  const displayDayPnl = animatedDayPnl ?? dayPnl;
  const dayPositive = Number.isFinite(Number(dayPnl)) ? Number(dayPnl) >= 0 : null;
  const dayTone =
    dayPositive === null ? T.textDim : dayPositive ? T.green : T.red;
  const DayIcon = dayPositive === false ? TrendingDown : TrendingUp;
  return (
    <section
      data-testid="account-hero-block"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: sp("2px 4px 2px"),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: sp(isPhone ? 6 : 8),
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(isPhone ? 18 : 24),
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            fontWeight: FONT_WEIGHTS.label,
            whiteSpace: "nowrap",
            flexShrink: 1,
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatMoney(displayNet, currency, maskValues)}
        </div>
        {dayPositive !== null ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
              padding: sp("2px 6px"),
              border: `1px solid ${dayTone}40`,
              borderRadius: 999,
              background: `${dayTone}12`,
              color: dayTone,
              flexShrink: 0,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            <DayIcon size={11} />
            <span style={{ fontWeight: FONT_WEIGHTS.medium, fontVariantNumeric: "tabular-nums" }}>{formatMoney(displayDayPnl, currency, maskValues)}</span>
            {formatPercent(dayPnlPercent, maskValues) ? (
              <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(dayPnlPercent, maskValues)}
              </span>
            ) : null}
            <span style={{ color: T.textMuted, marginLeft: sp(1) }}>today</span>
          </span>
        ) : null}
      </div>
    </section>
  );
};

export default AccountHeroBlock;
