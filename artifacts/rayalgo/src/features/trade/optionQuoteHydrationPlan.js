const normalizeProviderContractId = (value) => String(value || "").trim();

const pushProviderContractId = (target, seen, providerContractId) => {
  const normalized = normalizeProviderContractId(providerContractId);
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(normalized);
};

const resolveSelectedProviderContractId = ({ chainRows = [], contract = {} }) => {
  const selectedRow = chainRows.find((row) => row.k === contract.strike) || null;
  return (
    (contract.cp === "P"
      ? selectedRow?.pContract?.providerContractId
      : selectedRow?.cContract?.providerContractId) ||
    contract.providerContractId ||
    null
  );
};

export const buildTradeOptionProviderContractIdPlan = ({
  chainRows = [],
  contract = {},
  heldContracts = [],
  visibleRows = [],
}) => {
  const collected = [];
  const seen = new Set();

  pushProviderContractId(
    collected,
    seen,
    resolveSelectedProviderContractId({ chainRows, contract }),
  );

  heldContracts.forEach((holding) => {
    pushProviderContractId(collected, seen, holding?.providerContractId);
  });

  visibleRows.forEach((row) => {
    pushProviderContractId(collected, seen, row.cContract?.providerContractId);
    pushProviderContractId(collected, seen, row.pContract?.providerContractId);
  });

  return collected;
};

export const buildTradeOptionQuoteSubscriptionPlan = ({
  chainRows = [],
  contract = {},
  heldContracts = [],
  visibleRows = [],
}) => {
  const executionProviderContractIds = [];
  const executionSeen = new Set();

  pushProviderContractId(
    executionProviderContractIds,
    executionSeen,
    resolveSelectedProviderContractId({ chainRows, contract }),
  );
  heldContracts.forEach((holding) => {
    pushProviderContractId(
      executionProviderContractIds,
      executionSeen,
      holding?.providerContractId,
    );
  });

  const visibleProviderContractIds = [];
  const visibleSeen = new Set(executionProviderContractIds);
  visibleRows.forEach((row) => {
    pushProviderContractId(
      visibleProviderContractIds,
      visibleSeen,
      row.cContract?.providerContractId,
    );
    pushProviderContractId(
      visibleProviderContractIds,
      visibleSeen,
      row.pContract?.providerContractId,
    );
  });

  return {
    executionProviderContractIds,
    visibleProviderContractIds,
    requestedProviderContractIds: [
      ...executionProviderContractIds,
      ...visibleProviderContractIds,
    ],
  };
};
