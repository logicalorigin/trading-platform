const EXIT_REASON_COLORS = {
  take_profit: "#10b981",
  trailing_stop: "#3b82f6",
  time_exit: "#f59e0b",
  time_decay_cliff: "#f59e0b",
  zombie_kill: "#8b5cf6",
  stop_loss: "#ef4444",
  max_loss_breaker: "#dc2626",
  expired: "#94a3b8",
};

const MAX_LOSS_THRESHOLDS = [5, 10, 15, 20, 25, 30, 35, 40, 50, 60];

function round(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(digits);
}

function quantile(values, percentile) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].filter((value) => Number.isFinite(Number(value))).sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, Number(percentile) || 0));
  const position = (sorted.length - 1) * clamped;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values) {
  const numeric = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!numeric.length) {
    return null;
  }
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function percentileSeries(values, percentiles = []) {
  return percentiles.map(([label, percentile]) => ({
    label,
    value: round(quantile(values, percentile), 1),
  }));
}

function prettifyExitReason(reason) {
  return String(reason || "unknown").replace(/_/g, " ");
}

function buildScatterPoint(trade) {
  return {
    tradeId: trade.tradeId || trade.id || trade.ts,
    ts: trade.et || trade.ts || null,
    exitReason: trade.er || "unknown",
    exitLabel: prettifyExitReason(trade.er),
    color: EXIT_REASON_COLORS[trade.er] || "#64748b",
    mfePct: round(trade.maxFavorablePct, 2) || 0,
    maePct: round(trade.maxAdversePct, 2) || 0,
    pnlPct: round(trade.realizedReturnPct, 2) || 0,
    pnl: round(trade.pnl, 2) || 0,
    capturePct: round(trade.capturePct, 1),
    giveBackPct: round(trade.giveBackPct, 2),
    barsHeld: Number.isFinite(Number(trade.bh)) ? Number(trade.bh) : 0,
    barsToPeak: Number.isFinite(Number(trade.barsToPeak)) ? Number(trade.barsToPeak) : null,
  };
}

export function buildExcursionAnalytics({ trades = [], metrics = {}, tfMin = 5 } = {}) {
  const normalizedTrades = (Array.isArray(trades) ? trades : []).filter(Boolean);
  const tradePoints = normalizedTrades.map(buildScatterPoint);
  const excursionTrades = normalizedTrades.filter((trade) => Number.isFinite(Number(trade.maxFavorablePct)) && Number.isFinite(Number(trade.maxAdversePct)));
  const winners = normalizedTrades.filter((trade) => (Number(trade.pnl) || 0) > 0);
  const losers = normalizedTrades.filter((trade) => (Number(trade.pnl) || 0) <= 0);
  const winnerMfe = winners.map((trade) => Number(trade.maxFavorablePct) || 0).filter((value) => value > 0);
  const loserMae = losers.map((trade) => Number(trade.maxAdversePct) || 0).filter((value) => value > 0);
  const captureValues = normalizedTrades.map((trade) => trade.capturePct).filter((value) => Number.isFinite(Number(value)));
  const winnerBarsToPeak = winners.map((trade) => Number(trade.barsToPeak)).filter((value) => Number.isFinite(value) && value >= 0);
  const overviewWarnings = [];

  const recoveryByMae = MAX_LOSS_THRESHOLDS.map((thresholdPct) => {
    const affected = excursionTrades.filter((trade) => (Number(trade.maxAdversePct) || 0) >= thresholdPct);
    const recovered = affected.filter((trade) => (Number(trade.realizedReturnPct) || 0) > 0);
    return {
      thresholdPct,
      recoveryPct: affected.length ? round((recovered.length / affected.length) * 100, 1) : null,
      sampleCount: affected.length,
    };
  });

  const maxLossEvidence = recoveryByMae.find((bucket) => bucket.sampleCount > 0 && bucket.recoveryPct === 0) || null;
  const timePercentiles = percentileSeries(winnerBarsToPeak, [["p50", 0.5], ["p80", 0.8], ["p90", 0.9]]).map((entry) => ({
    ...entry,
    minutes: entry.value == null ? null : round(entry.value * tfMin, 0),
  }));
  const trailDistribution = percentileSeries(winnerMfe, [["p10", 0.1], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p90", 0.9]]);
  const exitBreakdown = Object.values(normalizedTrades.reduce((summary, trade) => {
    const key = trade.er || "unknown";
    if (!summary[key]) {
      summary[key] = {
        key,
        label: prettifyExitReason(key),
        color: EXIT_REASON_COLORS[key] || "#64748b",
        count: 0,
        wins: 0,
        pnl: 0,
        pnlPctTotal: 0,
        mfeTotal: 0,
        maeTotal: 0,
        captureTotal: 0,
        captureCount: 0,
        giveBackTotal: 0,
        giveBackCount: 0,
      };
    }
    const bucket = summary[key];
    bucket.count += 1;
    bucket.pnl += Number(trade.pnl) || 0;
    bucket.pnlPctTotal += Number(trade.realizedReturnPct) || 0;
    bucket.mfeTotal += Number(trade.maxFavorablePct) || 0;
    bucket.maeTotal += Number(trade.maxAdversePct) || 0;
    if ((Number(trade.pnl) || 0) > 0) {
      bucket.wins += 1;
    }
    if (Number.isFinite(Number(trade.capturePct))) {
      bucket.captureTotal += Number(trade.capturePct);
      bucket.captureCount += 1;
    }
    if (Number.isFinite(Number(trade.giveBackPct))) {
      bucket.giveBackTotal += Number(trade.giveBackPct);
      bucket.giveBackCount += 1;
    }
    return summary;
  }, {})).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    color: bucket.color,
    count: bucket.count,
    winRatePct: round((bucket.wins / Math.max(bucket.count, 1)) * 100, 1) || 0,
    avgPnl: round(bucket.pnl / Math.max(bucket.count, 1), 2) || 0,
    avgPnlPct: round(bucket.pnlPctTotal / Math.max(bucket.count, 1), 2) || 0,
    avgMfePct: round(bucket.mfeTotal / Math.max(bucket.count, 1), 2) || 0,
    avgMaePct: round(bucket.maeTotal / Math.max(bucket.count, 1), 2) || 0,
    avgCapturePct: bucket.captureCount ? round(bucket.captureTotal / bucket.captureCount, 1) : null,
    avgGiveBackPct: bucket.giveBackCount ? round(bucket.giveBackTotal / bucket.giveBackCount, 2) : null,
  })).sort((left, right) => right.count - left.count);

  const totalTrades = normalizedTrades.length;
  const coveragePct = totalTrades ? round((excursionTrades.length / totalTrades) * 100, 1) : 0;
  if (totalTrades < 10) {
    overviewWarnings.push("Limited sample size. Calibration and excursion distributions may shift materially with more trades.");
  }
  if (coveragePct < 100) {
    overviewWarnings.push(`Excursion coverage is ${coveragePct}% of closed trades. Some range-derived analytics are partial.`);
  }
  if (!winnerMfe.length) {
    overviewWarnings.push("No winning trades with measurable favorable excursion yet.");
  }
  if (!maxLossEvidence) {
    overviewWarnings.push("No zero-recovery MAE threshold is visible yet. Max-loss guidance is limited.");
  }

  return {
    warnings: overviewWarnings,
    coverage: {
      totalTrades,
      excursionTrades: excursionTrades.length,
      coveragePct,
    },
    overview: {
      netPnl: Number(metrics.pnl) || 0,
      winRatePct: Number(metrics.wr) || 0,
      profitFactor: metrics.pf ?? 0,
      maxDrawdownPct: Number(metrics.dd) || 0,
      avgHoldBars: Number(metrics.avgBars) || 0,
      avgHoldMinutes: round((Number(metrics.avgBars) || 0) * tfMin, 0) || 0,
      captureRatioPct: round(mean(captureValues), 1) || 0,
      medianWinnerMfePct: round(quantile(winnerMfe, 0.5), 1),
      medianLoserMaePct: round(quantile(loserMae, 0.5), 1),
      pctWinnerPeakWithin30: winners.length ? round((winnerBarsToPeak.filter((barsToPeak) => barsToPeak * tfMin <= 30).length / winners.length) * 100, 1) : null,
      pctWinnerPeakWithin60: winners.length ? round((winnerBarsToPeak.filter((barsToPeak) => barsToPeak * tfMin <= 60).length / winners.length) * 100, 1) : null,
    },
    scatter: {
      mfeVsPnl: tradePoints,
      maeVsPnl: tradePoints,
    },
    exitBreakdown,
    calibration: {
      trailActivationPct: round(quantile(winnerMfe, 0.25), 1),
      trailDistribution,
      maxLossThresholdPct: maxLossEvidence?.thresholdPct ?? null,
      recoveryByMae,
      timeCliffBars: round(quantile(winnerBarsToPeak, 0.8), 1),
      timeCliffMinutes: round((quantile(winnerBarsToPeak, 0.8) || 0) * tfMin, 0),
      timePercentiles,
    },
  };
}
