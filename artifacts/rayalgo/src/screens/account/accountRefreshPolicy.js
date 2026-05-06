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
  accountStreamFresh = false,
  orderStreamFresh = false,
  shadowMode = false,
} = {}) => {
  const visible = Boolean(isVisible);
  const brokerStreamFresh = Boolean(accountStreamFresh && orderStreamFresh);

  if (!visible) {
    return {
      primary: false,
      secondary: false,
      trades: false,
      chart: false,
      health: false,
      streamBacked: brokerStreamFresh,
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
    health: shadowMode ? false : ACCOUNT_REFRESH_INTERVALS.health,
    streamBacked: brokerStreamFresh,
  };
};
