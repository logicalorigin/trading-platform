import { useIbkrOptionQuoteStream } from "../../features/platform/live-streams";

const isOpraOptionTicker = (value) =>
  /^O:/i.test(String(value ?? "").trim());

const normalizedProviderContractId = (value) => {
  const text = String(value || "").trim();
  return text && !isOpraOptionTicker(text) ? text : "";
};

const optionProviderContractId = (contract) =>
  normalizedProviderContractId(contract?.providerContractId || contract?.conid);

const rowOptionProviderContractId = (row) =>
  optionProviderContractId(row?.optionContract) ||
  normalizedProviderContractId(row?.optionQuote?.providerContractId);

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

export const buildPositionOptionQuoteGroups = (rows) => {
  const groups = new Map();
  rows.forEach((row) => {
    const providerContractId = rowOptionProviderContractId(row);
    if (!providerContractId) return;
    const underlying = rowOptionUnderlying(row);
    const key = underlying || "__unknown__";
    const group = groups.get(key) || {
      underlying,
      providerContractIds: new Set(),
    };
    group.providerContractIds.add(providerContractId);
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) => ({
    underlying: group.underlying,
    providerContractIds: Array.from(group.providerContractIds),
  }));
};

const PositionOptionQuoteStreamGroup = ({
  underlying,
  providerContractIds,
  enabled,
  owner = "account-position-option-quotes:ui",
}) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(enabled && providerContractIds.length),
    owner,
    intent: "account-monitor-live",
    requiresGreeks: false,
  });
  return null;
};

export const PositionOptionQuoteStreams = ({
  groups = [],
  enabled = true,
  owner = "account-position-option-quotes:ui",
}) => (
  <>
    {groups.map((group) => (
      <PositionOptionQuoteStreamGroup
        key={group.underlying || group.providerContractIds.join(",")}
        underlying={group.underlying}
        providerContractIds={group.providerContractIds}
        enabled={enabled}
        owner={owner}
      />
    ))}
  </>
);
