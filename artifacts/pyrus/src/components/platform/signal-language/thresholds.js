// Signal score thresholds, on the 0-100 scale produced by
// resolveSignalScoreBreakdown (mtfAlignment<=25 + freshness<=20 +
// trendStrength<=15 + liquidity<=20 + riskFit<=10 + dataQuality<=10 = 100).
// SCORE_HOT matches the breakdown's own "high" tier cutoff (>=75).
export const SCORE_HOT = 75;
export const SCORE_COLD = 40;
export const SCORE_TRY = 70;
export const SCORE_FRESH_ROW_GLOW = 70;
export const FRESHNESS_BAR_DENOM = 10;
export const SPREAD_TIGHT_PCT = 0.01;
export const SPREAD_WIDE_PCT = 0.03;
export const SIGNAL_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h"];
