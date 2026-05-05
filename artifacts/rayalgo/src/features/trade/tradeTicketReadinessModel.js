const cleanText = (value) => String(value || "").trim();

const uppercaseText = (value) => cleanText(value).toUpperCase();

const isFinitePositive = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
};

export const normalizeTicketFreshness = (value, fallback = "metadata") => {
  const normalized = cleanText(value || fallback).toLowerCase();
  if (
    [
      "live",
      "delayed",
      "delayed_frozen",
      "frozen",
      "metadata",
      "pending",
      "stale",
      "unavailable",
    ].includes(normalized)
  ) {
    return normalized;
  }
  return fallback;
};

export const formatTicketFreshnessLabel = (value) => {
  const freshness = normalizeTicketFreshness(value, "unavailable");
  if (freshness === "delayed_frozen") return "delayed frozen";
  return freshness.replaceAll("_", " ");
};

const formatStrike = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return cleanText(value) || "--";
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
};

const formatDte = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.max(0, Math.round(numeric))}DTE`;
};

const resolveOptionRight = (cp) => {
  const normalized = uppercaseText(cp);
  if (normalized === "P" || normalized === "PUT") return "P";
  return "C";
};

export const buildTradeTicketReadiness = ({
  accountId = null,
  brokerConfigured = false,
  cp = "C",
  dte = null,
  environment = "paper",
  equityPrice = null,
  equityQuoteReady = false,
  expirationLabel = null,
  gatewayTradingMessage = "IB Gateway must be connected before trading.",
  gatewayTradingReady = false,
  optionQuoteReady = false,
  optionTicketReady = false,
  providerContractId = null,
  quoteFreshness = null,
  quoteMarketDataMode = null,
  strike = null,
  ticketIsShares = false,
  ticker = null,
  tradingExecutionMode = "shadow",
} = {}) => {
  const symbol = uppercaseText(ticker) || "TICKER";
  const right = resolveOptionRight(cp);
  const executionMode = tradingExecutionMode === "real" ? "real" : "shadow";
  const assetLabel = ticketIsShares ? "SHARES" : "OPTION";
  const instrumentLabel = ticketIsShares
    ? symbol
    : `${symbol} ${formatStrike(strike)}${right}`;
  const dteLabel = formatDte(dte);
  const instrumentDetail = ticketIsShares
    ? "Equity order ticket"
    : [`Exp ${cleanText(expirationLabel) || "pending"}`, dteLabel]
        .filter(Boolean)
        .join(" · ");
  const freshness = normalizeTicketFreshness(
    quoteFreshness,
    ticketIsShares ? "live" : "metadata",
  );
  const marketMode = uppercaseText(quoteMarketDataMode);
  const quoteLabel = ticketIsShares
    ? equityQuoteReady || isFinitePositive(equityPrice)
      ? "stock quote ready"
      : "stock quote loading"
    : optionTicketReady
      ? `${formatTicketFreshnessLabel(freshness)} option quote`
      : optionQuoteReady
        ? "option quote ready · contract id pending"
        : freshness === "pending"
          ? "option quote hydrating"
          : "option quote loading";
  const quoteTone =
    ticketIsShares && (equityQuoteReady || isFinitePositive(equityPrice))
      ? "good"
      : ticketIsShares
        ? "warn"
        : optionTicketReady
          ? freshness === "live"
            ? "good"
            : freshness === "delayed" || freshness === "delayed_frozen"
              ? "warn"
              : "neutral"
          : "warn";
  const providerId = cleanText(providerContractId);
  const providerLabel = ticketIsShares
    ? "equity route"
    : providerId
      ? `IBKR ${providerId}`
      : "contract id pending";
  const routeLabel =
    executionMode === "shadow"
      ? "shadow paper"
      : brokerConfigured
        ? `IBKR ${uppercaseText(environment) || "LIVE"}`
        : "IBKR required";
  const accountLabel =
    executionMode === "shadow"
      ? "shadow"
      : brokerConfigured
        ? cleanText(accountId) || "account pending"
        : "account unavailable";
  const blockers = [];
  if (!ticketIsShares && !optionTicketReady) {
    blockers.push(
      optionQuoteReady
        ? "Contract id is still pending for the selected option."
        : "Selected option needs a live chain row with bid, ask, greeks, and contract metadata.",
    );
  }
  if (executionMode === "real" && !brokerConfigured) {
    blockers.push("IBKR broker configuration is required for real orders.");
  }
  if (!gatewayTradingReady) {
    blockers.push(gatewayTradingMessage);
  }
  if (executionMode === "real" && brokerConfigured && !cleanText(accountId)) {
    blockers.push("Broker account is still resolving.");
  }

  const state = blockers.length ? "blocked" : "ready";
  return {
    accountLabel,
    assetLabel,
    blockedReason: blockers[0] || null,
    blockers,
    chips: [
      {
        id: "asset",
        label: "Asset",
        tone: ticketIsShares ? "info" : "accent",
        value: assetLabel,
      },
      {
        id: "route",
        label: "Route",
        tone: !gatewayTradingReady ? "warn" : executionMode === "shadow" ? "shadow" : "good",
        value: routeLabel,
      },
      {
        id: "quote",
        label: "Quote",
        tone: quoteTone,
        value: quoteLabel,
      },
      {
        id: "provider",
        label: ticketIsShares ? "Provider" : "Contract",
        tone: ticketIsShares || providerId ? "neutral" : "warn",
        value: marketMode ? `${providerLabel} · ${marketMode}` : providerLabel,
      },
    ],
    executionMode,
    instrumentDetail,
    instrumentLabel,
    state,
    statusLabel: state === "ready" ? "guarded preview ready" : "blocked",
  };
};
