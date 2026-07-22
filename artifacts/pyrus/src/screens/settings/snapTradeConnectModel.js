import { BROKER_LOGO_PNGS } from "../../components/brand/brokerLogoAssets.ts";

export const SNAPTRADE_CONNECTION_TYPE = "trade-if-available";

export const SNAPTRADE_BROKER_CHOICES = Object.freeze([
  {
    value: "INTERACTIVE-BROKERS-FLEX",
    label: "Interactive Brokers",
    detail: "First proof target",
    logoUrl: BROKER_LOGO_PNGS.ibkr,
  },
  {
    value: "ETRADE",
    label: "E*TRADE",
    detail: "Fallback proof broker",
    logoUrl: BROKER_LOGO_PNGS.etrade,
  },
  {
    value: "ALPACA-PAPER",
    label: "Alpaca Paper",
    detail: "Paper fixture",
    logoUrl: BROKER_LOGO_PNGS.alpaca,
  },
]);

export function canManageSnapTradeConnections(authSession) {
  return Boolean(
    authSession?.user && authSession.hasEntitlement?.("broker_connect"),
  );
}

// Brokerages hidden from the connect picker even when SnapTrade reports them as
// tradable — crypto-only exchanges we do not surface for trading.
export const HIDDEN_SNAPTRADE_BROKER_SLUGS = Object.freeze([
  "BINANCE",
  "COINBASE",
  "KRAKEN",
]);
const HIDDEN_SNAPTRADE_BROKER_SLUG_SET = new Set(HIDDEN_SNAPTRADE_BROKER_SLUGS);
const LOCAL_SNAPTRADE_BROKER_LOGOS = Object.freeze({
  "ALPACA-PAPER": BROKER_LOGO_PNGS.alpaca,
  ETRADE: BROKER_LOGO_PNGS.etrade,
  "INTERACTIVE-BROKERS-FLEX": BROKER_LOGO_PNGS.ibkr,
  WEBULL: BROKER_LOGO_PNGS.webull,
});

export function buildSnapTradeBrokerChoices(brokerages) {
  if (!Array.isArray(brokerages)) {
    return SNAPTRADE_BROKER_CHOICES;
  }
  const tradable = brokerages.filter(
    (brokerage) =>
      brokerage?.allowsTrading === true &&
      brokerage?.enabled === true &&
      typeof brokerage?.slug === "string" &&
      brokerage.slug.trim() &&
      !HIDDEN_SNAPTRADE_BROKER_SLUG_SET.has(
        brokerage.slug.trim().toUpperCase(),
      ),
  );
  return tradable.map((brokerage) => {
    const slug = brokerage.slug.trim();
    return {
      value: slug,
      label: brokerage.displayName?.trim() || slug,
      detail: brokerage.maintenanceMode
        ? "Under maintenance"
        : brokerage.isDegraded
          ? "Degraded"
          : "Live trading",
      logoUrl:
        LOCAL_SNAPTRADE_BROKER_LOGOS[slug.toUpperCase()] ||
        brokerage.squareLogoUrl ||
        brokerage.logoUrl ||
        null,
      impaired:
        brokerage.maintenanceMode === true || brokerage.isDegraded === true,
    };
  });
}

export function buildSnapTradeConnectionPortalBody(brokerSlug) {
  const broker = String(brokerSlug || "").trim();
  return {
    ...(broker ? { broker } : {}),
    connectionType: SNAPTRADE_CONNECTION_TYPE,
    showCloseButton: true,
  };
}
