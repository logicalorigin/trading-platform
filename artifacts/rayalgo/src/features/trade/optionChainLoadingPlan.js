export const OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY = 5;
export const OPTION_CHAIN_BATCH_CHUNK_SIZE = 2;
export const OPTION_CHAIN_BATCH_ACTIVE_CHUNKS = 1;
export const OPTION_CHAIN_FULL_STRIKE_COVERAGE = "full";
export const OPTION_CHAIN_METADATA_HYDRATION = "metadata";
export const OPTION_CHAIN_SNAPSHOT_HYDRATION = "snapshot";
export const OPTION_CHAIN_AUTO_BATCH_ENABLED = true;
export const OPTION_CHAIN_COVERAGE_ALL = "all";
export const OPTION_CHAIN_COVERAGE_VALUES = Object.freeze([
  5,
  10,
  15,
  20,
  OPTION_CHAIN_COVERAGE_ALL,
]);
export const DEFAULT_OPTION_CHAIN_COVERAGE = 5;

export const getExpirationChainKey = (expiration) =>
  expiration?.chainKey || expiration?.isoDate || expiration?.value || null;

export const chunkValues = (values, chunkSize) => {
  const chunks = [];
  const normalizedChunkSize = Math.max(1, chunkSize);
  for (let index = 0; index < values.length; index += normalizedChunkSize) {
    chunks.push(values.slice(index, index + normalizedChunkSize));
  }
  return chunks;
};

export const normalizeTradeOptionChainCoverage = (value) => {
  if (value === OPTION_CHAIN_COVERAGE_ALL) {
    return OPTION_CHAIN_COVERAGE_ALL;
  }

  const numericValue =
    typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return OPTION_CHAIN_COVERAGE_VALUES.includes(numericValue)
    ? numericValue
    : DEFAULT_OPTION_CHAIN_COVERAGE;
};

export const resolveActiveOptionChainRequestParams = (coverage) => {
  const normalizedCoverage = normalizeTradeOptionChainCoverage(coverage);
  if (normalizedCoverage === OPTION_CHAIN_COVERAGE_ALL) {
    return {
      strikesAroundMoney: undefined,
      strikeCoverage: OPTION_CHAIN_FULL_STRIKE_COVERAGE,
      coverage: "full",
    };
  }

  return {
    strikesAroundMoney: normalizedCoverage,
    strikeCoverage: null,
    coverage: "window",
  };
};

export const resolveBackgroundOptionChainRequestParams = (coverage) => {
  const normalizedCoverage = normalizeTradeOptionChainCoverage(coverage);
  const strikesAroundMoney =
    normalizedCoverage === OPTION_CHAIN_COVERAGE_ALL
      ? DEFAULT_OPTION_CHAIN_COVERAGE
      : normalizedCoverage;

  return {
    strikesAroundMoney,
    strikeCoverage: null,
    coverage: "window",
  };
};

export const resolveTradeOptionChainHydrationPlan = ({
  orderedExpirationOptions = [],
  activeExpiration = null,
  background = false,
  autoBatchEnabled = OPTION_CHAIN_AUTO_BATCH_ENABLED,
  batchChunkSize = OPTION_CHAIN_BATCH_CHUNK_SIZE,
  coverage = DEFAULT_OPTION_CHAIN_COVERAGE,
} = {}) => {
  const activeChainKey = getExpirationChainKey(activeExpiration);
  const activeRequest = resolveActiveOptionChainRequestParams(coverage);
  const backgroundRequest = resolveBackgroundOptionChainRequestParams(coverage);
  const batchExpirationOptions =
    background || !autoBatchEnabled
      ? []
      : orderedExpirationOptions.filter((expiration) =>
          Boolean(getExpirationChainKey(expiration)) &&
          getExpirationChainKey(expiration) !== activeChainKey,
        );

  return {
    activeChainKey,
    activeRequest,
    backgroundRequest,
    batchExpirationOptions,
    batchExpirationChunks: chunkValues(batchExpirationOptions, batchChunkSize),
  };
};
