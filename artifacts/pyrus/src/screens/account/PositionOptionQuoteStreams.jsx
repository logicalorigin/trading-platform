import { useIbkrOptionQuoteStream } from "../../features/platform/live-streams";

const normalizeOpraOptionTicker = (value) => {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return "";
  const ticker = normalized.startsWith("O:") ? normalized : `O:${normalized}`;
  return /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(ticker) ? ticker : "";
};

const normalizedProviderContractId = (value) => {
  const text = String(value || "").trim();
  return text && !normalizeOpraOptionTicker(text) ? text : "";
};

const optionQuoteProviderContractIds = (quote) =>
  uniqueProviderContractIds([
    normalizeOpraOptionTicker(quote?.providerContractId),
    normalizedProviderContractId(quote?.providerContractId),
    normalizeOpraOptionTicker(quote?.ticker),
    normalizeOpraOptionTicker(quote?.symbol),
  ]);

const optionRightCode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") return "C";
  if (normalized === "put" || normalized === "p") return "P";
  return "";
};

const optionExpirationKey = (value) => {
  const text = String(value || "").trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
  if (/^\d{8}$/.test(text)) return text;
  return "";
};

export const structuredOptionProviderContractId = (contract) => {
  const explicitTicker =
    normalizeOpraOptionTicker(contract?.providerContractId) ||
    normalizeOpraOptionTicker(contract?.ticker);
  if (explicitTicker) {
    return explicitTicker;
  }
  const underlying = String(contract?.underlying || "").trim().toUpperCase();
  const expiration = optionExpirationKey(contract?.expirationDate);
  const strike = Number(contract?.strike);
  const right = optionRightCode(contract?.right);
  if (!underlying || !expiration || !Number.isFinite(strike) || !right) {
    return "";
  }
  const opraUnderlying = underlying.replace(/[^A-Z0-9]/g, "");
  const opraExpiration = expiration.length === 8 ? expiration.slice(2) : expiration;
  const strikeKey = String(Math.round(strike * 1000)).padStart(8, "0");
  return opraUnderlying
    ? `O:${opraUnderlying}${opraExpiration}${right}${strikeKey}`
    : "";
};

const primaryOptionProviderContractId = (contract) =>
  normalizedProviderContractId(contract?.providerContractId) ||
  normalizedProviderContractId(contract?.conid);

const uniqueProviderContractIds = (providerContractIds) =>
  Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => String(providerContractId || "").trim())
        .filter(Boolean),
    ),
  );

export const optionProviderContractIds = (contract) =>
  uniqueProviderContractIds([
    structuredOptionProviderContractId(contract) ||
      primaryOptionProviderContractId(contract),
  ]);

const rowUsesNativeRobinhoodOptionQuote = (row) =>
  row?.providerSecurityType === "robinhood_option";

export const rowOptionProviderContractIds = (row) => {
  if (rowUsesNativeRobinhoodOptionQuote(row)) {
    return uniqueProviderContractIds([
      primaryOptionProviderContractId(row?.optionContract),
      normalizedProviderContractId(row?.optionQuote?.providerContractId),
    ]);
  }
  const structuredProviderContractId = structuredOptionProviderContractId(
    row?.optionContract,
  );
  return uniqueProviderContractIds([
    ...optionProviderContractIds(row?.optionContract),
    primaryOptionProviderContractId(row?.optionContract),
    ...(structuredProviderContractId
      ? []
      : optionQuoteProviderContractIds(row?.optionQuote)),
  ]);
};

const rowOptionQuoteSubscriptionProviderContractIds = (row) => {
  if (rowUsesNativeRobinhoodOptionQuote(row)) return [];
  const providerContractIds = rowOptionProviderContractIds(row);
  const opraProviderContractIds = providerContractIds.filter(
    (providerContractId) => normalizeOpraOptionTicker(providerContractId),
  );
  return opraProviderContractIds.length
    ? opraProviderContractIds
    : providerContractIds;
};

const rowOptionUnderlying = (row) => {
  const text = String(
    row?.optionContract?.underlying ||
      row?.underlyingMarket?.symbol ||
      row?.marketDataSymbol ||
      row?.symbol ||
      "",
  ).trim().toUpperCase();
  return text || null;
};

export const optionQuoteStreamGroupOwner = (
  owner = "account-position-option-quotes:ui",
  group = {},
) => {
  const baseOwner =
    String(owner || "").trim() || "account-position-option-quotes:ui";
  const scope = String(group?.underlying || "__unknown__")
    .trim()
    .toUpperCase();
  return `${baseOwner}:${scope || "__UNKNOWN__"}`;
};

export const buildPositionOptionQuoteGroups = (rows) => {
  const groups = new Map();
  rows.forEach((row) => {
    const providerContractIds = rowOptionQuoteSubscriptionProviderContractIds(row);
    if (!providerContractIds.length) return;
    const underlying = rowOptionUnderlying(row);
    const key = underlying || "__unknown__";
    const group = groups.get(key) || {
      underlying,
      providerContractIds: new Set(),
    };
    providerContractIds.forEach((providerContractId) => {
      group.providerContractIds.add(providerContractId);
    });
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) => ({
    underlying: group.underlying,
    providerContractIds: Array.from(group.providerContractIds),
  }));
};

export const buildPositionOptionQuoteStreamSubscription = (
  groups = [],
  owner = "account-position-option-quotes:ui",
) => {
  const providerContractIds = [];
  const seenProviderContractIds = new Set();
  const underlyings = new Set();
  groups.forEach((group) => {
    const normalizedUnderlying = String(group?.underlying || "")
      .trim()
      .toUpperCase();
    if (normalizedUnderlying) {
      underlyings.add(normalizedUnderlying);
    }
    (Array.isArray(group?.providerContractIds)
      ? group.providerContractIds
      : []
    ).forEach((providerContractId) => {
      const normalizedProviderContractId = String(providerContractId || "").trim();
      if (
        !normalizedProviderContractId ||
        seenProviderContractIds.has(normalizedProviderContractId)
      ) {
        return;
      }
      seenProviderContractIds.add(normalizedProviderContractId);
      providerContractIds.push(normalizedProviderContractId);
    });
  });

  if (!providerContractIds.length) {
    return null;
  }

  const underlyingList = Array.from(underlyings).sort((left, right) =>
    left.localeCompare(right),
  );
  const baseOwner =
    String(owner || "").trim() || "account-position-option-quotes:ui";
  return {
    underlying: underlyingList.length === 1 ? underlyingList[0] : null,
    providerContractIds,
    owner: `${baseOwner}:${providerContractIds.length}-contracts`,
  };
};

const PositionOptionQuoteStreamGroup = ({
  underlying,
  providerContractIds,
  enabled,
  owner = "account-position-option-quotes:ui",
  intent = "account-monitor-live",
}) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(enabled && providerContractIds.length),
    owner,
    intent,
    requiresGreeks: true,
  });
  return null;
};

export const PositionOptionQuoteStreams = ({
  groups = [],
  enabled = true,
  owner = "account-position-option-quotes:ui",
  intent = "account-monitor-live",
}) => {
  const subscription = buildPositionOptionQuoteStreamSubscription(groups, owner);
  if (!subscription) {
    return null;
  }

  return (
    <PositionOptionQuoteStreamGroup
      key={subscription.owner}
      underlying={subscription.underlying}
      providerContractIds={subscription.providerContractIds}
      enabled={enabled}
      owner={subscription.owner}
      intent={intent}
    />
  );
};
