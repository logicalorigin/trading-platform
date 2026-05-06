const normalizeProviderContractId = (value) => String(value || "").trim();
export const TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT = 40;

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
  maxVisibleProviderContractIds = TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT,
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
  const visibleLimit = Math.max(
    0,
    Math.floor(Number(maxVisibleProviderContractIds) || 0),
  );
  const pushVisibleProviderContractId = (providerContractId) => {
    if (visibleProviderContractIds.length >= visibleLimit) {
      return;
    }
    pushProviderContractId(
      visibleProviderContractIds,
      visibleSeen,
      providerContractId,
    );
  };
  visibleRows.forEach((row) => {
    pushVisibleProviderContractId(row.cContract?.providerContractId);
    pushVisibleProviderContractId(row.pContract?.providerContractId);
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
