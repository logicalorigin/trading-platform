// Glossary copy for the GEX screen. Each entry is rendered inside
// `InfoTooltipIcon` next to a metric, signal, factor, or control. Replaces
// the long-form education sections that the InsiderFinance reference puts
// at the bottom of its page.

export const GEX_GLOSSARY = Object.freeze({
  netGex: {
    label: "Net GEX",
    definition:
      "Net Gamma Exposure aggregates dealer call gamma minus put gamma across the chain.",
    interpretation:
      "Positive net GEX means dealers buy dips and sell rips (dampening); negative means they amplify moves.",
  },
  ratio: {
    label: "Ratio",
    definition:
      "Call GEX divided by the absolute value of put GEX.",
    interpretation:
      "Above 1 = call-heavy positioning; below 1 = put-heavy. Useful as a quick read on dealer skew.",
  },
  callGex: {
    label: "Call GEX",
    definition:
      "Total positive gamma exposure from outstanding call open interest, scaled by spot.",
    interpretation:
      "Higher call GEX concentrates dealer hedging above spot — typically pinning price near call walls.",
  },
  putGex: {
    label: "Put GEX",
    definition:
      "Total negative gamma exposure from outstanding put open interest, scaled by spot.",
    interpretation:
      "Higher (more negative) put GEX flags dealer support below spot; breakdowns can accelerate quickly.",
  },
  totalGex: {
    label: "Total GEX",
    definition:
      "Absolute call GEX plus absolute put GEX — the gross size of dealer gamma the chain produces.",
    interpretation:
      "Use this as the magnitude lens. Big total GEX means hedging flows dominate intraday price action.",
  },
  callWall: {
    label: "Call Wall",
    definition:
      "The above-spot strike with the strongest positive net gamma concentration.",
    interpretation:
      "Acts as resistance: dealers sell into rallies near the wall to stay hedged. Breakouts above can squeeze.",
  },
  putWall: {
    label: "Put Wall",
    definition:
      "The below-spot strike with the strongest negative net gamma concentration.",
    interpretation:
      "Acts as support: dealer buying defends the wall. Breakdowns below typically expand realized volatility.",
  },
  zeroGamma: {
    label: "Zero Gamma",
    definition:
      "The price at which cumulative dealer gamma flips from net-negative to net-positive.",
    interpretation:
      "Crossing this level changes character: above it dealers dampen moves; below it they amplify them.",
  },
  concentration0dte: {
    label: "0DTE Exp",
    definition:
      "Share of total gamma exposure concentrated in contracts expiring today.",
    interpretation:
      "High 0DTE share means intraday pinning and quick gamma decay risk into the close.",
  },
  concentrationWeekly: {
    label: "Weekly Exp",
    definition:
      "Share of total gamma exposure expiring within the next 7 days.",
    interpretation:
      "A heavy weekly share keeps dealer hedging nimble — expect sharper reactions around weekly OPEX.",
  },
  concentrationMonthly: {
    label: "Monthly Exp",
    definition:
      "Share of total gamma exposure expiring within the next 30 days.",
    interpretation:
      "Sets the medium-term gamma backdrop. Watch for regime shifts near the monthly OPEX.",
  },
  signalVolatility: {
    label: "Volatility",
    definition:
      "Triggered when the gamma regime favors selling vol (long gamma) or warns of expansion (put-wall break).",
    interpretation:
      "Long-gamma volatility signals favor mean-reversion; put-wall warnings flag breakdown risk.",
  },
  signalMagnet: {
    label: "Magnet",
    definition:
      "Fires when the peak-gamma strike is within ~2% of spot.",
    interpretation:
      "Price tends to gravitate toward this level as dealer hedging concentrates flow there.",
  },
  signalSupport: {
    label: "Support",
    definition:
      "Marks the zero-gamma price below spot.",
    interpretation:
      "If price tags this level, the regime can flip from dampening to amplifying intraday moves.",
  },
  squeezeProbability: {
    label: "Squeeze Probability",
    definition:
      "0–100 score combining gamma regime, wall proximity, flow alignment, volume confirmation, and DEX bias.",
    interpretation:
      "Higher score raises the odds of a directional squeeze; the headline pairs the score with a verdict.",
  },
  factorGamma: {
    label: "Gamma Regime",
    definition:
      "Awards points only when net dealer gamma is negative — the structural condition for a squeeze.",
    interpretation:
      "Long-gamma regimes don't squeeze. This factor is binary: 0 or 25.",
  },
  factorWall: {
    label: "Wall Proximity",
    definition:
      "Scores how close spot is to the relevant call/put wall (within ~2% earns full credit).",
    interpretation:
      "Closer-to-wall = more dealer-hedge cascade potential when the wall is breached.",
  },
  factorFlow: {
    label: "Flow Alignment",
    definition:
      "Weights the share of incoming option premium going in the squeeze direction.",
    interpretation:
      "Without aligned flow, dealers don't get pushed into chasing hedges.",
  },
  factorVolume: {
    label: "Volume Confirm",
    definition:
      "Awards full credit only when underlying volume runs above its 30-day average.",
    interpretation:
      "Squeezes need participation — option-only setups without volume tend to fade.",
  },
  factorDex: {
    label: "DEX Bias",
    definition:
      "Scores net dealer-delta hedge demand in the squeeze direction.",
    interpretation:
      "When dealers are short delta in the same direction, every move forces buying that compounds the squeeze.",
  },
  ivSimulation: {
    label: "IV Scenario",
    definition:
      "Scales provider implied volatility for the projected Gamma Price Profile only.",
    interpretation:
      "Current GEX metrics stay anchored to IBKR gamma/open interest; no local IV estimate is used when provider IV is missing.",
  },
  heatmapColors: {
    label: "Heatmap Colors",
    definition:
      "Each strike-expiration cell uses its own net GEX for color: green = positive/call-heavy, red = negative/put-heavy, brightness = magnitude.",
    interpretation:
      "Use the heatmap to spot strike-and-date concentrations the strike profile alone would average out.",
  },
});

export const getGexGlossaryEntry = (key) => GEX_GLOSSARY[key] || null;

export const formatGexGlossaryTooltip = (key) => {
  const entry = getGexGlossaryEntry(key);
  if (!entry) return "";
  return `${entry.definition} ${entry.interpretation}`;
};
