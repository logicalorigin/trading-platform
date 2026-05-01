export const OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY = 5;
export const OPTION_CHAIN_EXPANDED_STRIKES_AROUND_MONEY = 6;
export const OPTION_CHAIN_BATCH_CHUNK_SIZE = 2;
export const OPTION_CHAIN_BATCH_ACTIVE_CHUNKS = 1;
export const OPTION_CHAIN_FULL_STRIKE_COVERAGE = "full";
export const OPTION_CHAIN_METADATA_HYDRATION = "metadata";
export const OPTION_CHAIN_SNAPSHOT_HYDRATION = "snapshot";
export const OPTION_CHAIN_AUTO_BATCH_ENABLED = true;

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

export const shouldHydrateActiveFullCoverage = ({
  activeExpiration = null,
  expandedChainKeys = [],
  background = false,
  activeFastHydrationStatus = null,
} = {}) => {
  if (background || !activeExpiration) {
    return false;
  }

  const activeChainKey = getExpirationChainKey(activeExpiration);
  if (!activeChainKey) {
    return false;
  }

  if (new Set(expandedChainKeys.filter(Boolean)).has(activeChainKey)) {
    return true;
  }

  return (
    activeFastHydrationStatus === "empty" ||
    activeFastHydrationStatus === "failed"
  );
};

export const resolveTradeOptionChainHydrationPlan = ({
  orderedExpirationOptions = [],
  activeExpiration = null,
  expandedChainKeys = [],
  background = false,
  autoBatchEnabled = OPTION_CHAIN_AUTO_BATCH_ENABLED,
  batchChunkSize = OPTION_CHAIN_BATCH_CHUNK_SIZE,
} = {}) => {
  const activeChainKey = getExpirationChainKey(activeExpiration);
  const expandedChainKeySet = new Set(expandedChainKeys.filter(Boolean));
  const batchExpirationOptions =
    background || !autoBatchEnabled
      ? []
      : orderedExpirationOptions.filter((expiration) =>
          Boolean(getExpirationChainKey(expiration)),
        );
  const expandedActiveExpiration = shouldHydrateActiveFullCoverage({
    activeExpiration,
    expandedChainKeys: Array.from(expandedChainKeySet),
    background,
  })
    ? activeExpiration
    : null;

  return {
    activeChainKey,
    batchExpirationOptions,
    batchExpirationChunks: chunkValues(batchExpirationOptions, batchChunkSize),
    expandedActiveExpiration,
    expandedActiveChainKey: getExpirationChainKey(expandedActiveExpiration),
  };
};
