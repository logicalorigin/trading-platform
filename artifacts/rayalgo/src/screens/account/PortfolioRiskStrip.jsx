import { buildPortfolioRiskStripModel } from "../../features/account/accountPortfolioRiskStripModel.js";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  mutedLabelStyle,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";

const toneColor = (tone) => {
  switch (tone) {
    case "green":
      return T.green;
    case "red":
      return T.red;
    case "amber":
      return T.amber;
    case "cyan":
      return T.cyan;
    case "purple":
      return T.purple;
    case "pink":
      return T.pink;
    case "accent":
      return T.accent;
    default:
      return T.text;
  }
};

const formatCardValue = (card, currency, maskValues) => {
  if (card.valueKind === "text") {
    return card.text || "----";
  }
  if (card.valueKind === "percent") {
    return formatAccountPercent(card.value, 1, maskValues);
  }
  if (card.valueKind === "signedMoney") {
    return formatAccountSignedMoney(card.value, currency, true, maskValues);
  }
  return formatAccountMoney(card.value, currency, true, maskValues);
};

export const PortfolioRiskStrip = ({
  summary,
  riskData,
  positionsResponse,
  accountMode = "real",
  brokerAuthenticated = false,
  gatewayTradingReady = false,
  isLoading = false,
  maskValues = false,
  compact = false,
}) => {
  const model = buildPortfolioRiskStripModel({
    summary,
    riskData,
    positionsResponse,
    accountMode,
    brokerAuthenticated,
    gatewayTradingReady,
    isLoading,
  });

  return (
    <section
      data-testid="account-portfolio-risk-strip"
      className="ra-panel-enter"
      style={{
        display: "grid",
        gridTemplateColumns: compact
          ? "repeat(2, minmax(0, 1fr))"
          : "repeat(auto-fit, minmax(126px, 1fr))",
        gap: sp(compact ? 3 : 4),
        border: `1px solid ${T.border}`,
        borderRadius: dim(5),
        background: T.bg0,
        padding: sp(compact ? 3 : 4),
        minWidth: 0,
      }}
    >
      {model.cards.map((card) => (
        <AppTooltip key={card.id} content={card.detail}>
          <div
            data-testid={`account-risk-strip-${card.id}`}
            style={{
              minHeight: dim(compact ? 38 : 42),
              minWidth: 0,
              display: "grid",
              alignContent: "center",
              gap: sp(2),
              padding: sp(compact ? "3px 5px" : "4px 6px"),
              borderLeft: `2px solid ${toneColor(card.tone)}`,
              background:
                card.tone === "default" ? "transparent" : `${toneColor(card.tone)}12`,
            }}
          >
            <div
              style={{
                ...mutedLabelStyle,
                fontSize: fs(7),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {card.label}
            </div>
            {card.id === "live-state" ? (
              <div style={{ minWidth: 0 }}>
                <Pill tone={card.tone}>{formatCardValue(card, model.currency, maskValues)}</Pill>
              </div>
            ) : (
              <div
                style={{
                  color: toneColor(card.tone),
                  fontSize: fs(compact ? 10 : 11),
                  fontFamily: T.mono,
                  fontWeight: 900,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatCardValue(card, model.currency, maskValues)}
              </div>
            )}
            <div
              style={{
                color: T.textDim,
                fontSize: fs(8),
                fontFamily: T.data,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {card.detail}
            </div>
          </div>
        </AppTooltip>
      ))}
    </section>
  );
};

export default PortfolioRiskStrip;
