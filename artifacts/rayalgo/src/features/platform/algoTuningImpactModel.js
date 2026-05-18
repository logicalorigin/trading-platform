const SPREAD_TOO_WIDE = new Set(["spread_too_wide"]);
const BID_TOO_LOW = new Set(["bid_below_minimum"]);
const PREMIUM_BUDGET = new Set([
  "premium_budget_exceeded",
  "premium_budget_too_small",
]);
const REGIME_BLOCKS = new Set([
  "bear_regime_gate_failed",
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

export const buildAlgoTuningImpact = ({
  cockpit,
  profile,
  positions,
} = {}) => {
  const candidates = (cockpit?.candidates || []).slice();
  const minDte = Number(profile?.optionSelection?.minDte);
  const maxDte = Number(profile?.optionSelection?.maxDte);
  const hardStopPct = Number(profile?.exitPolicy?.hardStopPct);
  return {
    spreadTooWide: buildBlockerImpact(candidates, SPREAD_TOO_WIDE),
    bidBelowMinimum: buildBlockerImpact(candidates, BID_TOO_LOW),
    premiumBudget: buildBlockerImpact(candidates, PREMIUM_BUDGET),
    regimeBlocks: buildBlockerImpact(candidates, REGIME_BLOCKS),
    dteWindow: buildDteImpact(candidates, minDte, maxDte),
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
};
