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

export const buildPositionOptionQuoteGroups = (rows) => {
  const providerContractIds = new Set();
  rows.forEach((row) => {
    const providerContractId = rowOptionProviderContractId(row);
    if (!providerContractId) return;
    providerContractIds.add(providerContractId);
  });
  const ids = Array.from(providerContractIds);
  return ids.length
    ? [
        {
          underlying: null,
          providerContractIds: ids,
        },
      ]
    : [];
};

const PositionOptionQuoteStreamGroup = ({
  underlying,
  providerContractIds,
  enabled,
}) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(enabled && providerContractIds.length),
    owner: "account-position-option-quotes:ui",
    intent: "account-monitor-live",
    requiresGreeks: true,
  });
  return null;
};

export const PositionOptionQuoteStreams = ({ groups = [], enabled = true }) => (
  <>
    {groups.map((group) => (
      <PositionOptionQuoteStreamGroup
        key={group.underlying || "account-position-option-quotes"}
        underlying={group.underlying}
        providerContractIds={group.providerContractIds}
        enabled={enabled}
      />
    ))}
  </>
);
