export const ACCOUNT_REFRESH_INTERVALS = Object.freeze({
  streamFresh: false,
  primaryFallback: 15_000,
  secondaryFallback: 30_000,
  tradesFallback: 60_000,
  chart: 300_000,
  health: 15_000,
  shadowPrimaryFallback: 30_000,
  shadowSecondaryFallback: 60_000,
  shadowTradesFallback: 120_000,
  shadowChart: 300_000,
});

export const buildAccountPageRestFallback = ({
  streamRequested = false,
  bootstrapping = false,
  primaryFresh = false,
  liveFresh = false,
  derivedFresh = false,
} = {}) => {
  if (!streamRequested) {
    return { primary: true, live: true, derived: true };
  }
  if (bootstrapping) {
    return { primary: false, live: false, derived: false };
  }
  return {
    primary: !primaryFresh,
    live: !liveFresh,
    derived: !derivedFresh,
  };
};

export const buildAccountRefreshPolicy = ({
  isVisible = false,
  accountPageStreamFresh = false,
  accountStreamFresh = false,
  orderStreamFresh = false,
  shadowMode = false,
} = {}) => {
  const visible = Boolean(isVisible);
  const pageStreamFresh = Boolean(accountPageStreamFresh);
  const brokerStreamFresh = Boolean(accountStreamFresh && orderStreamFresh);

  if (!visible) {
    return {
      primary: false,
      secondary: false,
      trades: false,
      chart: false,
      health: false,
      streamBacked: pageStreamFresh || brokerStreamFresh,
    };
  }

  if (pageStreamFresh) {
    return {
      primary: ACCOUNT_REFRESH_INTERVALS.streamFresh,
      secondary: ACCOUNT_REFRESH_INTERVALS.streamFresh,
      trades: ACCOUNT_REFRESH_INTERVALS.streamFresh,
      chart: ACCOUNT_REFRESH_INTERVALS.streamFresh,
      health: ACCOUNT_REFRESH_INTERVALS.streamFresh,
      streamBacked: true,
    };
  }

  if (shadowMode) {
    return {
      primary: ACCOUNT_REFRESH_INTERVALS.shadowPrimaryFallback,
      secondary: ACCOUNT_REFRESH_INTERVALS.shadowSecondaryFallback,
      trades: ACCOUNT_REFRESH_INTERVALS.shadowTradesFallback,
      chart: ACCOUNT_REFRESH_INTERVALS.shadowChart,
      health: false,
      streamBacked: false,
    };
  }

  return {
    primary: brokerStreamFresh
      ? ACCOUNT_REFRESH_INTERVALS.streamFresh
      : ACCOUNT_REFRESH_INTERVALS.primaryFallback,
    secondary: brokerStreamFresh
      ? ACCOUNT_REFRESH_INTERVALS.streamFresh
      : ACCOUNT_REFRESH_INTERVALS.secondaryFallback,
    trades: ACCOUNT_REFRESH_INTERVALS.tradesFallback,
    chart: ACCOUNT_REFRESH_INTERVALS.chart,
    health: ACCOUNT_REFRESH_INTERVALS.health,
    streamBacked: brokerStreamFresh,
  };
};
