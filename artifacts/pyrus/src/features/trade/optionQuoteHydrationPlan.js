const normalizeProviderContractId = (value) => String(value || "").trim();
const OPTION_CHAIN_COVERAGE_ALL = "all";
export const TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT = 40;
export const TRADE_OPTION_VISIBLE_QUOTE_UNDERLYING_LINE_RESERVE = 1;
export const TRADE_OPTION_VISIBLE_QUOTE_LINE_RESERVE =
  TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT +
  TRADE_OPTION_VISIBLE_QUOTE_UNDERLYING_LINE_RESERVE;

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

const resolveSelectedOrAtmRowIndex = ({ chainRows = [], contract = {} }) => {
  const selectedIndex = chainRows.findIndex((row) => row.k === contract.strike);
  if (selectedIndex >= 0) {
    return selectedIndex;
  }

  const atmIndex = chainRows.findIndex((row) => row.isAtm);
  if (atmIndex >= 0) {
    return atmIndex;
  }

  return chainRows.length ? Math.floor(chainRows.length / 2) : -1;
};

const normalizeVisibleStrikeCoverage = (value) => {
  if (value === OPTION_CHAIN_COVERAGE_ALL) {
    return OPTION_CHAIN_COVERAGE_ALL;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
};

export const resolveFallbackOptionQuoteRowLimit = ({
  chainRows = [],
  visibleStrikeCoverage = null,
  maxVisibleProviderContractIds = TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT,
} = {}) => {
  const normalizedCoverage = normalizeVisibleStrikeCoverage(visibleStrikeCoverage);
  if (normalizedCoverage === OPTION_CHAIN_COVERAGE_ALL) {
    return Array.isArray(chainRows) ? chainRows.length : 0;
  }
  if (normalizedCoverage !== null) {
    return normalizedCoverage * 2 + 1;
  }

  const visibleLimit = Math.max(
    0,
    Math.floor(Number(maxVisibleProviderContractIds) || 0),
  );
  return visibleLimit > 0 ? Math.max(1, Math.ceil(visibleLimit / 2)) : 0;
};

export const buildFallbackOptionQuoteRows = ({
  chainRows = [],
  contract = {},
  maxVisibleProviderContractIds = TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT,
  visibleStrikeCoverage = null,
}) => {
  if (!Array.isArray(chainRows) || chainRows.length === 0) {
    return [];
  }

  const centerIndex = resolveSelectedOrAtmRowIndex({ chainRows, contract });
  if (centerIndex < 0) {
    return [];
  }

  const rowLimit = resolveFallbackOptionQuoteRowLimit({
    chainRows,
    visibleStrikeCoverage,
    maxVisibleProviderContractIds,
  });
  if (rowLimit <= 0) {
    return [];
  }

  const before = Math.floor((rowLimit - 1) / 2);
  const after = rowLimit - before - 1;
  let start = Math.max(0, centerIndex - before);
  let end = Math.min(chainRows.length, centerIndex + after + 1);
  if (end - start < rowLimit) {
    start = Math.max(0, end - rowLimit);
    end = Math.min(chainRows.length, start + rowLimit);
  }

  return chainRows.slice(start, end);
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
  includeFallbackVisibleRows = true,
  visibleStrikeCoverage = null,
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
  const normalizedVisibleRows = Array.isArray(visibleRows) ? visibleRows : [];
  const fallbackRowLimit = resolveFallbackOptionQuoteRowLimit({
    chainRows,
    visibleStrikeCoverage,
    maxVisibleProviderContractIds,
  });
  const visibleLimit =
    normalizeVisibleStrikeCoverage(visibleStrikeCoverage) !== null
      ? fallbackRowLimit * 2
      : Math.max(0, Math.floor(Number(maxVisibleProviderContractIds) || 0));
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
  const visibleDemandRows =
    normalizedVisibleRows.length || !includeFallbackVisibleRows
      ? normalizedVisibleRows
      : buildFallbackOptionQuoteRows({
          chainRows,
          contract,
          maxVisibleProviderContractIds: visibleLimit,
          visibleStrikeCoverage,
        });

  visibleDemandRows.forEach((row) => {
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
