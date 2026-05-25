import { useIbkrOptionQuoteStream } from "../../features/platform/live-streams";

const isInternalOptionIdentifier = (value) =>
  /^twsopt:/i.test(String(value ?? "").trim());

const isOpraOptionTicker = (value) =>
  /^O:/i.test(String(value ?? "").trim());

const normalizedProviderContractId = (value) => {
  const text = String(value || "").trim();
  return text && !isOpraOptionTicker(text) ? text : "";
};

const firstDisplayText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !isInternalOptionIdentifier(text)) return text;
  }
  return "";
};

const optionProviderContractId = (contract) =>
  normalizedProviderContractId(contract?.providerContractId || contract?.conid);

const rowOptionProviderContractId = (row) =>
  optionProviderContractId(row?.optionContract) ||
  normalizedProviderContractId(row?.optionQuote?.providerContractId);

export const buildPositionOptionQuoteGroups = (rows) => {
  const groups = new Map();
  rows.forEach((row) => {
    const contract = row?.optionContract;
    const providerContractId = rowOptionProviderContractId(row);
    const underlying = firstDisplayText(
      contract?.underlying,
      row?.underlyingMarket?.symbol,
      row?.symbol,
    ).toUpperCase();
    if (!providerContractId || !underlying) return;
    if (!groups.has(underlying)) groups.set(underlying, new Set());
    groups.get(underlying).add(providerContractId);
  });
  return Array.from(groups, ([underlying, ids]) => ({
    underlying,
    providerContractIds: Array.from(ids),
  }));
};

const PositionOptionQuoteStreamGroup = ({
  underlying,
  providerContractIds,
  enabled,
}) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(enabled && underlying && providerContractIds.length),
    owner: `account-positions:${underlying}`,
    intent: "visible-live",
    requiresGreeks: true,
  });
  return null;
};

export const PositionOptionQuoteStreams = ({ groups = [], enabled = true }) => (
  <>
    {groups.map((group) => (
      <PositionOptionQuoteStreamGroup
        key={group.underlying}
        underlying={group.underlying}
        providerContractIds={group.providerContractIds}
        enabled={enabled}
      />
    ))}
  </>
);
