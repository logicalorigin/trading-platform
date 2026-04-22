function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeNumber(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(precision);
}

function formatPercent(value, precision = 0) {
  const numeric = normalizeNumber(value, precision);
  return numeric == null ? "--" : `${numeric}%`;
}

function formatDecimal(value, precision = 2) {
  const numeric = normalizeNumber(value, precision);
  return numeric == null ? "--" : String(numeric);
}

function formatStrikeSlot(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "ATM";
  }
  const numeric = Number(value);
  if (numeric === 0) {
    return "ATM";
  }
  return numeric > 0 ? `OTM +${numeric}` : `ITM ${numeric}`;
}

function pushDiff(diffs, key, label, currentValue, nextValue) {
  if (currentValue === nextValue) {
    return;
  }
  diffs.push({
    key,
    label,
    current: currentValue,
    next: nextValue,
  });
}

function readStageConfig(setup = null) {
  return setup?.rayalgo?.stagedConfigUi || {};
}

export function diffResearchSetupSnapshots(currentSetup = null, targetSetup = null) {
  if (!currentSetup || !targetSetup) {
    return [];
  }
  const currentTop = currentSetup.topRail || {};
  const nextTop = targetSetup.topRail || {};
  const currentRay = currentSetup.rayalgo || {};
  const nextRay = targetSetup.rayalgo || {};
  const currentStage = readStageConfig(currentSetup);
  const nextStage = readStageConfig(targetSetup);
  const diffs = [];

  pushDiff(diffs, "symbol", "Symbol", normalizeText(currentTop.marketSymbol, "SPY"), normalizeText(nextTop.marketSymbol, "SPY"));
  pushDiff(diffs, "strategy", "Strategy", normalizeText(currentTop.strategy, "smc"), normalizeText(nextTop.strategy, "smc"));
  pushDiff(diffs, "direction", "Direction", currentStage?.entryGate?.allow_shorts ? "Puts" : "Calls", nextStage?.entryGate?.allow_shorts ? "Puts" : "Calls");
  pushDiff(diffs, "chartTf", "Chart TF", normalizeText(currentRay.candleTf, "auto"), normalizeText(nextRay.candleTf, "auto"));
  pushDiff(diffs, "window", "Window", normalizeText(currentRay.chartRange, "1W"), normalizeText(nextRay.chartRange, "1W"));
  pushDiff(diffs, "optionTf", "Option TF", normalizeText(currentTop.optionCandleTf, "1m"), normalizeText(nextTop.optionCandleTf, "1m"));
  pushDiff(diffs, "dte", "DTE", `${Number(currentStage?.dteSelection?.dte_floor) || 0}D`, `${Number(nextStage?.dteSelection?.dte_floor) || 0}D`);
  pushDiff(diffs, "strike", "Strike", formatStrikeSlot(currentStage?.dteSelection?.strike_slot), formatStrikeSlot(nextStage?.dteSelection?.strike_slot));
  pushDiff(
    diffs,
    "exit",
    "Exit",
    `${formatPercent((Number(currentStage?.exitGovernor?.max_loss_1to3dte_pct) || 0) * 100)} / ${formatPercent((Number(currentStage?.exitGovernor?.take_profit_pct) || 0) * 100)} / ${formatPercent((Number(currentStage?.exitGovernor?.trail_option_pnl_floor_1dte) || 0) * 100)} / ${formatPercent((Number(currentStage?.exitGovernor?.trail_entry_drawdown_pct) || 0) * 100)}`,
    `${formatPercent((Number(nextStage?.exitGovernor?.max_loss_1to3dte_pct) || 0) * 100)} / ${formatPercent((Number(nextStage?.exitGovernor?.take_profit_pct) || 0) * 100)} / ${formatPercent((Number(nextStage?.exitGovernor?.trail_option_pnl_floor_1dte) || 0) * 100)} / ${formatPercent((Number(nextStage?.exitGovernor?.trail_entry_drawdown_pct) || 0) * 100)}`,
  );
  pushDiff(diffs, "regime", "Regime", normalizeText(currentStage?.entryGate?.regime_filter, "none"), normalizeText(nextStage?.entryGate?.regime_filter, "none"));
  pushDiff(diffs, "execution", "Exec", normalizeText(currentTop.executionFidelity, "sub_candle"), normalizeText(nextTop.executionFidelity, "sub_candle"));
  pushDiff(diffs, "conviction", "Conviction", formatDecimal(currentStage?.entryGate?.min_conviction, 2), formatDecimal(nextStage?.entryGate?.min_conviction, 2));
  pushDiff(
    diffs,
    "v2Profile",
    "V2 Profile",
    normalizeText(currentRay?.stagedConfigUi?.runSettings?.profileName, "default"),
    normalizeText(nextRay?.stagedConfigUi?.runSettings?.profileName, "default"),
  );
  pushDiff(diffs, "bundle", "Bundle", normalizeText(currentRay.selectedRayalgoBundleId, "custom"), normalizeText(nextRay.selectedRayalgoBundleId, "custom"));
  return diffs;
}

export function buildOptimizerCandidateDiffs(currentSetup = null, candidate = null) {
  if (!currentSetup || !candidate) {
    return [];
  }
  const currentTop = currentSetup.topRail || {};
  const diffs = [];
  pushDiff(diffs, "dte", "DTE", `${Number(currentTop.dte) || 0}D`, `${Number(candidate.dte) || 0}D`);
  pushDiff(diffs, "regime", "Regime", normalizeText(currentTop.regimeFilter, "none"), normalizeText(candidate.regime, "none"));
  pushDiff(
    diffs,
    "exit",
    "Exit",
    `${formatPercent((Number(currentTop.slPct) || 0) * 100)} / ${formatPercent((Number(currentTop.tpPct) || 0) * 100)} / ${formatPercent((Number(currentTop.trailStartPct) || 0) * 100)} / ${formatPercent((Number(currentTop.trailPct) || 0) * 100)}`,
    `${formatPercent((Number(candidate.sl) || 0) * 100)} / ${formatPercent((Number(candidate.tp) || 0) * 100)} / ${formatPercent((Number(candidate.trailStartPct) || 0) * 100)} / ${formatPercent((Number(candidate.trailPct) || 0) * 100)}`,
  );
  return diffs;
}
