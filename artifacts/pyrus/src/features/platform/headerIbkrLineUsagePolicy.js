export const shouldActivateHeaderIbkrLineUsage = ({
  popoverOpen = false,
  safeQaMode = false,
  lineUsageAvailable = false,
} = {}) => Boolean(!safeQaMode && lineUsageAvailable);

export const selectHeaderIbkrLineUsageSnapshot = ({
  popoverOpen = false,
  lineUsageSnapshot = null,
} = {}) => lineUsageSnapshot;
