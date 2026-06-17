export const shouldActivateHeaderIbkrLineUsage = ({
  safeQaMode = false,
  lineUsageAvailable = false,
} = {}) => Boolean(!safeQaMode && lineUsageAvailable);

export const selectHeaderIbkrLineUsageSnapshot = ({
  lineUsageSnapshot = null,
} = {}) => lineUsageSnapshot;
