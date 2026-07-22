const SPREAD_TOO_WIDE = new Set(["spread_too_wide"]);
const BID_TOO_LOW = new Set(["bid_below_minimum"]);
const PREMIUM_BUDGET = new Set([
  "premium_budget_exceeded",
  "premium_budget_too_small",
]);
const REGIME_BLOCKS = new Set([
  "mtf_not_aligned",
  "inverse_put_blocked",
  "entry_gate_failed",
]);

const sampleTopSymbols = (candidates, limit = 3) => {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const symbol = String(candidate?.symbol || "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(symbol);
    if (result.length >= limit) break;
  }
  return result;
};

const buildBlockerImpact = (candidates, reasonSet) => {
  const matching = (candidates || []).filter((candidate) =>
    reasonSet.has(String(candidate?.reason || "")),
  );
  return {
    count: matching.length,
    sampleSymbols: sampleTopSymbols(matching, 3),
  };
};

const isOutsideDteBounds = (candidate, minDte, maxDte) => {
  const dte = Number(candidate?.dte);
  if (!Number.isFinite(dte)) return false;
  if (Number.isFinite(minDte) && dte < minDte) return true;
  if (Number.isFinite(maxDte) && dte > maxDte) return true;
  return false;
};

const buildDteImpact = (candidates, minDte, maxDte) => {
  const matching = (candidates || []).filter((candidate) =>
    isOutsideDteBounds(candidate, minDte, maxDte),
  );
  return {
    count: matching.length,
    sampleSymbols: sampleTopSymbols(matching, 3),
  };
};

const buildHardStopImpact = (positions, hardStopPct) => {
  if (!Number.isFinite(hardStopPct)) {
    return { count: 0, sampleSymbols: [], triggers: [] };
  }
  const triggers = (positions || [])
    .map((position) => {
      const entry = Number(position?.entryPrice);
      const mark = Number(position?.lastMarkPrice);
      if (!Number.isFinite(entry) || !Number.isFinite(mark)) return null;
      const triggerPrice = entry * (1 + hardStopPct / 100);
      const distance = mark - triggerPrice;
      const distancePct =
        Math.abs(entry) > 0 ? (distance / Math.abs(entry)) * 100 : 0;
      return {
        symbol: String(position.symbol || "").toUpperCase(),
        triggerPrice,
        mark,
        distance,
        distancePct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
  return {
    count: triggers.length,
    sampleSymbols: triggers.slice(0, 3).map((trigger) => trigger.symbol),
    triggers,
  };
};

const buildTrailImpact = (positions) => {
  const trailing = (positions || []).filter((position) => {
    const peak = Number(position?.peakPrice);
    const entry = Number(position?.entryPrice);
    return Number.isFinite(peak) && Number.isFinite(entry) && peak > entry;
  });
  return {
    count: trailing.length,
    total: positions?.length ?? 0,
    sampleSymbols: sampleTopSymbols(trailing, 3),
  };
};

const collectNumericValues = (candidates, extractor) =>
  (candidates || [])
    .map(extractor)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);

const distributionOf = (values, { bucketCount = 10 } = {}) => {
  if (!values.length) {
    return { buckets: [], min: 0, max: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { buckets: [values.length], min, max };
  }
  const buckets = Array(bucketCount).fill(0);
  const range = max - min;
  for (const value of values) {
    const ratio = (value - min) / range;
    const index = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(ratio * bucketCount)),
    );
    buckets[index] += 1;
  }
  return { buckets, min, max };
};

const thresholdPositionWithin = (distribution, threshold) => {
  if (!distribution.buckets.length) return null;
  const range = distribution.max - distribution.min;
  if (range <= 0) return 0.5;
  if (!Number.isFinite(Number(threshold))) return null;
  const ratio = (Number(threshold) - distribution.min) / range;
  return Math.max(0, Math.min(1, ratio));
};

const buildHistogramView = (values, threshold) => {
  const distribution = distributionOf(values);
  return {
    buckets: distribution.buckets,
    min: distribution.min,
    max: distribution.max,
    thresholdPosition: thresholdPositionWithin(distribution, threshold),
  };
};

export const buildAlgoTuningImpact = ({
  cockpit,
  profile,
  positions,
} = {}) => {
  const candidates = (cockpit?.candidates || []).slice();
  const configuredMinDte = Number(profile?.optionSelection?.minDte);
  const configuredMaxDte = Number(profile?.optionSelection?.maxDte);
  const minDte = profile?.optionSelection?.allowZeroDte
    ? configuredMinDte
    : Math.max(1, configuredMinDte);
  const maxDte = Math.max(minDte, configuredMaxDte);
  const hardStopPct = Number(profile?.exitPolicy?.hardStopPct);
  const spreadThreshold = Number(profile?.liquidityGate?.maxSpreadPctOfMid);
  const bidThreshold = Number(profile?.liquidityGate?.minBid);
  const premiumThreshold = Number(profile?.riskCaps?.maxPremiumPerEntry);

  const spreadValues = collectNumericValues(
    candidates,
    (candidate) => candidate?.liquidity?.spreadPctOfMid,
  );
  const bidValues = collectNumericValues(
    candidates,
    (candidate) => candidate?.liquidity?.bid,
  );
  const premiumValues = collectNumericValues(
    candidates,
    (candidate) => candidate?.orderPlan?.premiumAtRisk,
  );
  const dteValues = collectNumericValues(
    candidates,
    (candidate) => candidate?.dte,
  );

  return {
    spreadTooWide: {
      ...buildBlockerImpact(candidates, SPREAD_TOO_WIDE),
      histogram: buildHistogramView(spreadValues, spreadThreshold),
    },
    bidBelowMinimum: {
      ...buildBlockerImpact(candidates, BID_TOO_LOW),
      histogram: buildHistogramView(bidValues, bidThreshold),
    },
    premiumBudget: {
      ...buildBlockerImpact(candidates, PREMIUM_BUDGET),
      histogram: buildHistogramView(premiumValues, premiumThreshold),
    },
    regimeBlocks: buildBlockerImpact(candidates, REGIME_BLOCKS),
    dteWindow: {
      ...buildDteImpact(candidates, minDte, maxDte),
      histogram: buildHistogramView(dteValues, maxDte),
    },
    hardStop: buildHardStopImpact(positions, hardStopPct),
    trailing: buildTrailImpact(positions),
  };
};

export const __internalsForTests = {
  SPREAD_TOO_WIDE,
  BID_TOO_LOW,
  PREMIUM_BUDGET,
  REGIME_BLOCKS,
  sampleTopSymbols,
  isOutsideDteBounds,
  distributionOf,
  thresholdPositionWithin,
};
