export const DEFAULT_OPTION_QUOTE_LINE_BUDGET = 80;
export const DEFAULT_OPTION_QUOTE_ROTATION_MS = 3_000;

export const buildTradeOptionProviderContractIdPlan = ({
  chainRows = [],
  contract = {},
  heldContracts = [],
}) => {
  const collected = [];
  const seen = new Set();
  const pushProviderContractId = (providerContractId) => {
    const normalized = String(providerContractId || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    collected.push(normalized);
  };

  const selectedRow = chainRows.find((row) => row.k === contract.strike) || null;
  const selectedProviderContractId =
    contract.cp === "P"
      ? selectedRow?.pContract?.providerContractId
      : selectedRow?.cContract?.providerContractId;
  pushProviderContractId(selectedProviderContractId);

  heldContracts.forEach((holding) => {
    pushProviderContractId(holding.providerContractId);
  });

  const centerStrike =
    selectedRow?.k ??
    chainRows.find((row) => row.isAtm)?.k ??
    contract.strike ??
    null;

  [...chainRows]
    .sort((left, right) => {
      if (centerStrike == null) {
        return left.k - right.k;
      }
      return (
        Math.abs(left.k - centerStrike) - Math.abs(right.k - centerStrike) ||
        left.k - right.k
      );
    })
    .forEach((row) => {
      pushProviderContractId(row.cContract?.providerContractId);
      pushProviderContractId(row.pContract?.providerContractId);
    });

  return collected;
};

export const selectRotatingProviderContractIds = ({
  providerContractIds = [],
  lineBudget = DEFAULT_OPTION_QUOTE_LINE_BUDGET,
  rotationIndex = 0,
}) => {
  const normalizedBudget = Math.max(1, Math.floor(lineBudget));
  if (providerContractIds.length <= normalizedBudget) {
    return {
      activeProviderContractIds: providerContractIds,
      pinnedProviderContractIds: providerContractIds,
      rotatingProviderContractIds: [],
      pendingProviderContractIds: [],
    };
  }

  const pinnedBudget = Math.max(1, Math.floor(normalizedBudget / 2));
  const pinnedProviderContractIds = providerContractIds.slice(0, pinnedBudget);
  const rotatingProviderContractIds = providerContractIds.slice(pinnedBudget);
  const rotatingBudget = normalizedBudget - pinnedProviderContractIds.length;
  const start =
    rotatingProviderContractIds.length > 0
      ? (rotationIndex * rotatingBudget) % rotatingProviderContractIds.length
      : 0;
  const activeRotatingProviderContractIds =
    rotatingBudget > 0
      ? Array.from(
          { length: Math.min(rotatingBudget, rotatingProviderContractIds.length) },
          (_, offset) => {
            const index = (start + offset) % rotatingProviderContractIds.length;
            return rotatingProviderContractIds[index];
          },
        )
      : [];
  const activeProviderContractIds = [
    ...pinnedProviderContractIds,
    ...activeRotatingProviderContractIds,
  ];
  const activeSet = new Set(activeProviderContractIds);

  return {
    activeProviderContractIds,
    pinnedProviderContractIds,
    rotatingProviderContractIds,
    pendingProviderContractIds: providerContractIds.filter(
      (providerContractId) => !activeSet.has(providerContractId),
    ),
  };
};
