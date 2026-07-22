const BROKER_LABELS = Object.freeze({
  alpaca: "Alpaca",
  brokerage: "Brokerage",
  etrade: "E*TRADE",
  ibkr: "IBKR",
  robinhood: "Robinhood",
  schwab: "Schwab",
  shadow: "Shadow",
  snaptrade: "SnapTrade",
  webull: "Webull",
});

const normalizeProvider = (value) => {
  const provider = String(value || "").trim().toLowerCase();
  return Object.hasOwn(BROKER_LABELS, provider) ? provider : "brokerage";
};

export const brokerActivityLabel = (provider) =>
  BROKER_LABELS[normalizeProvider(provider)];

export const normalizeBrokerActivityBadges = (brokers = [], maxVisible = 3) => {
  const byProvider = new Map();
  for (const input of Array.isArray(brokers) ? brokers : []) {
    const rawProvider =
      input && typeof input === "object" ? input.provider : input;
    const provider = normalizeProvider(rawProvider);
    if (byProvider.has(provider)) continue;
    const providedLabel =
      input && typeof input === "object" && typeof input.label === "string"
        ? input.label.trim()
        : "";
    byProvider.set(provider, {
      provider,
      label:
        provider !== "brokerage" && providedLabel
          ? providedLabel.slice(0, 48)
          : BROKER_LABELS[provider],
    });
  }
  const all = [...byProvider.values()];
  const visibleLimit = Math.max(1, Math.floor(Number(maxVisible) || 3));
  return {
    all,
    visible: all.slice(0, visibleLimit),
    overflow: Math.max(0, all.length - visibleLimit),
    accessibleLabel: all.length
      ? `Brokers: ${all.map((badge) => badge.label).join(", ")}`
      : "",
  };
};
