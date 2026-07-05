export const SNAPTRADE_CONNECTION_TYPE = "trade-if-available";

export const SNAPTRADE_BROKER_CHOICES = Object.freeze([
  {
    value: "INTERACTIVE-BROKERS-FLEX",
    label: "Interactive Brokers",
    detail: "First proof target",
  },
  {
    value: "ETRADE",
    label: "E*TRADE",
    detail: "Fallback proof broker",
  },
  {
    value: "ALPACA-PAPER",
    label: "Alpaca Paper",
    detail: "Paper fixture",
  },
]);

export function canManageSnapTradeConnections(user) {
  return user?.role === "admin";
}

// Brokerages hidden from the connect picker even when SnapTrade reports them as
// tradable — crypto-only exchanges we do not surface for trading.
export const HIDDEN_SNAPTRADE_BROKER_SLUGS = Object.freeze([
  "BINANCE",
  "COINBASE",
  "KRAKEN",
]);
const HIDDEN_SNAPTRADE_BROKER_SLUG_SET = new Set(HIDDEN_SNAPTRADE_BROKER_SLUGS);

export function buildSnapTradeBrokerChoices(brokerages) {
  const tradable = (Array.isArray(brokerages) ? brokerages : []).filter(
    (brokerage) =>
      brokerage?.allowsTrading === true &&
      brokerage?.enabled === true &&
      typeof brokerage?.slug === "string" &&
      brokerage.slug.trim() &&
      !HIDDEN_SNAPTRADE_BROKER_SLUG_SET.has(
        brokerage.slug.trim().toUpperCase(),
      ),
  );
  if (!tradable.length) {
    return SNAPTRADE_BROKER_CHOICES;
  }
  return tradable.map((brokerage) => ({
    value: brokerage.slug,
    label: brokerage.displayName || brokerage.slug,
    detail: brokerage.maintenanceMode
      ? "Under maintenance"
      : brokerage.isDegraded
        ? "Degraded"
        : "Live trading",
    logoUrl: brokerage.squareLogoUrl || brokerage.logoUrl || null,
    impaired:
      brokerage.maintenanceMode === true || brokerage.isDegraded === true,
  }));
}

export function buildSnapTradeConnectionPortalBody(brokerSlug) {
  const broker = String(brokerSlug || "").trim();
  return {
    ...(broker ? { broker } : {}),
    connectionType: SNAPTRADE_CONNECTION_TYPE,
    showCloseButton: true,
  };
}
