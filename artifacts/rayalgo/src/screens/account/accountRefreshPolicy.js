export const ACCOUNT_REFRESH_INTERVALS = Object.freeze({
  streamFresh: false,
  primaryFallback: 10_000,
  secondaryFallback: 30_000,
  tradesFallback: 60_000,
  chart: 60_000,
  health: 15_000,
  shadowPrimaryFallback: 30_000,
  shadowSecondaryFallback: 60_000,
  shadowTradesFallback: 120_000,
  shadowChart: 120_000,
});

export const buildAccountRefreshPolicy = ({
  isVisible = false,
  accountPageStreamFresh = false,
  accountStreamFresh = false,
  orderStreamFresh = false,
  shadowStreamFresh = false,
  shadowMode = false,
} = {}) => {
  const visible = Boolean(isVisible);
  const pageStreamFresh = Boolean(accountPageStreamFresh);
  const brokerStreamFresh = Boolean(accountStreamFresh && orderStreamFresh);
  const shadowFresh = Boolean(shadowStreamFresh);

  if (!visible) {
    return {
      primary: false,
      secondary: false,
      trades: false,
      chart: false,
      health: false,
      streamBacked: pageStreamFresh || (shadowMode ? shadowFresh : brokerStreamFresh),
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
      primary: shadowFresh
        ? ACCOUNT_REFRESH_INTERVALS.streamFresh
        : ACCOUNT_REFRESH_INTERVALS.shadowPrimaryFallback,
      secondary: shadowFresh
        ? ACCOUNT_REFRESH_INTERVALS.streamFresh
        : ACCOUNT_REFRESH_INTERVALS.shadowSecondaryFallback,
      trades: ACCOUNT_REFRESH_INTERVALS.shadowTradesFallback,
      chart: ACCOUNT_REFRESH_INTERVALS.shadowChart,
      health: false,
      streamBacked: shadowFresh,
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
    health: shadowMode ? false : ACCOUNT_REFRESH_INTERVALS.health,
    streamBacked: brokerStreamFresh,
  };
};
