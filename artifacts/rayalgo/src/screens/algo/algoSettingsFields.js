import {
  RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
  SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
  STRATEGY_SIGNAL_TIMEFRAMES,
  formatChaseSteps,
  formatMoney,
  formatProgressiveTrailSteps,
} from "./algoHelpers";

export const getPathValue = (source, path) =>
  String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => (value == null ? undefined : value[key]), source);

const optionLabel = (options = [], value) => {
  const match = options.find((option) =>
    typeof option === "string" ? option === value : option.value === value,
  );
  if (!match) return String(value ?? "");
  return typeof match === "string" ? match : match.label;
};

export const formatSettingValue = (field, value) => {
  if (field.type === "boolean") return value ? "ON" : "OFF";
  if (field.type === "select") return optionLabel(field.options, value);
  if (field.format === "money") return formatMoney(value);
  if (field.format === "chaseSteps") return formatChaseSteps(value);
  if (field.format === "progressiveTrailSteps")
    return formatProgressiveTrailSteps(value);
  if (value == null || value === "") return "blank";
  return String(value);
};

export const settingFields = [
  {
    sectionId: "signal",
    sectionLabel: "Signal",
    columns: 3,
    fields: [
      {
        slice: "strategy",
        path: "signalTimeframe",
        label: "SIGNAL TIMEFRAME",
        type: "select",
        options: STRATEGY_SIGNAL_TIMEFRAMES,
      },
      {
        slice: "strategy",
        path: "timeHorizon",
        label: "TIME HORIZON",
        type: "number",
        step: 1,
        min: 2,
        max: 50,
        unit: "bars",
      },
      {
        slice: "strategy",
        path: "bosConfirmation",
        label: "BOS CONFIRMATION",
        type: "select",
        options: RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
      },
      {
        slice: "strategy",
        path: "chochAtrBuffer",
        label: "CHOCH ATR BUFFER",
        type: "number",
        step: 0.05,
        min: 0,
        max: 20,
        unit: "x ATR",
      },
      {
        slice: "strategy",
        path: "chochBodyExpansionAtr",
        label: "CHOCH BODY ATR",
        type: "number",
        step: 0.05,
        min: 0,
        max: 20,
        unit: "x ATR",
      },
      {
        slice: "strategy",
        path: "chochVolumeGate",
        label: "CHOCH VOLUME GATE",
        type: "number",
        step: 0.05,
        min: 0,
        max: 20,
        unit: "x avg",
      },
    ],
  },
  {
    sectionId: "risk",
    sectionLabel: "Risk Limits",
    columns: 2,
    fields: [
      {
        slice: "profile",
        path: "riskCaps.maxPremiumPerEntry",
        label: "MAX PREMIUM",
        type: "number",
        step: 25,
        min: 1,
        max: 1_000_000,
        unit: "USD",
        format: "money",
        impact: "premiumBudget",
      },
      {
        slice: "profile",
        path: "riskCaps.maxContracts",
        label: "MAX CONTRACTS",
        type: "number",
        step: 1,
        min: 1,
        max: 500,
        unit: "contracts",
      },
      {
        slice: "profile",
        path: "riskCaps.maxOpenSymbols",
        label: "MAX OPEN SYMBOLS",
        type: "number",
        step: 1,
        min: 1,
        max: 500,
        unit: "symbols",
      },
      {
        slice: "profile",
        path: "riskCaps.maxDailyLoss",
        label: "DAILY HALT",
        type: "number",
        step: 50,
        min: 1,
        max: 10_000_000,
        unit: "USD",
        format: "money",
      },
    ],
  },
  {
    sectionId: "gates",
    sectionLabel: "Signal Gates",
    columns: 2,
    fields: [
      {
        slice: "profile",
        path: "entryGate.mtfAlignment.enabled",
        label: "MTF GATE ENABLED",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "entryGate.mtfAlignment.requiredCount",
        label: "MTF REQUIRED COUNT",
        type: "number",
        step: 1,
        min: 1,
        max: 3,
        unit: "matches",
      },
      {
        slice: "profile",
        path: "entryGate.bearishRegime.minAdx",
        label: "BEAR ADX MIN",
        type: "number",
        step: 1,
        min: 0,
        max: 200,
        unit: "ADX",
        impact: "regimeBlocks",
        readOnlyImpact: true,
      },
      {
        slice: "profile",
        path: "entryGate.bearishRegime.enabled",
        label: "BEAR GATE ENABLED",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "entryGate.bearishRegime.rejectFullyBullishMtf",
        label: "REJECT BULLISH MTF PUTS",
        type: "boolean",
      },
    ],
  },
  {
    sectionId: "strikes",
    sectionLabel: "Strike Slots",
    columns: 3,
    fields: [
      {
        slice: "profile",
        path: "optionSelection.minDte",
        label: "MIN DTE",
        type: "number",
        step: 1,
        min: 0,
        max: 90,
        unit: "days",
        impact: "dteWindow",
      },
      {
        slice: "profile",
        path: "optionSelection.targetDte",
        label: "TARGET DTE",
        type: "number",
        step: 1,
        min: 0,
        max: 90,
        unit: "days",
      },
      {
        slice: "profile",
        path: "optionSelection.maxDte",
        label: "MAX DTE",
        type: "number",
        step: 1,
        min: 0,
        max: 90,
        unit: "days",
        impact: "dteWindow",
      },
      {
        slice: "profile",
        path: "optionSelection.callStrikeSlot",
        label: "CALL STRIKE SLOT",
        type: "select",
        options: SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
        coerce: Number,
      },
      {
        slice: "profile",
        path: "optionSelection.putStrikeSlot",
        label: "PUT STRIKE SLOT",
        type: "select",
        options: SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
        coerce: Number,
      },
      {
        slice: "profile",
        path: "optionSelection.allowZeroDte",
        label: "ALLOW 0DTE",
        type: "boolean",
      },
    ],
  },
  {
    sectionId: "fills",
    sectionLabel: "Fills",
    columns: 3,
    fields: [
      {
        slice: "profile",
        path: "liquidityGate.maxSpreadPctOfMid",
        label: "MAX SPREAD %",
        type: "number",
        step: 1,
        min: 0,
        max: 500,
        unit: "% of mid",
        impact: "spreadTooWide",
      },
      {
        slice: "profile",
        path: "liquidityGate.minBid",
        label: "MIN BID",
        type: "number",
        step: 0.01,
        min: 0,
        max: 1000,
        unit: "USD",
        impact: "bidBelowMinimum",
      },
      {
        slice: "profile",
        path: "fillPolicy.ttlSeconds",
        label: "FILL TTL SECONDS",
        type: "number",
        step: 1,
        min: 1,
        max: 600,
        unit: "seconds",
      },
      {
        slice: "profile",
        path: "liquidityGate.requireBidAsk",
        label: "REQUIRE BID/ASK",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "liquidityGate.requireFreshQuote",
        label: "REQUIRE FRESH QUOTE",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "fillPolicy.chaseSteps",
        label: "CHASE LADDER %",
        type: "text",
        format: "chaseSteps",
        fullWidth: true,
        unit: "comma-separated %",
      },
    ],
  },
  {
    sectionId: "exits",
    sectionLabel: "Exits",
    columns: 3,
    fields: [
      {
        slice: "profile",
        path: "exitPolicy.hardStopPct",
        label: "HARD STOP %",
        type: "number",
        step: 1,
        min: -100,
        max: 0,
        unit: "% from entry",
        impact: "hardStop",
        warningWhenNonZero: false,
      },
      {
        slice: "profile",
        path: "exitPolicy.trailActivationPct",
        label: "TRAIL ACTIVATES %",
        type: "number",
        step: 5,
        min: 0,
        max: 10000,
        unit: "% gain",
      },
      {
        slice: "profile",
        path: "exitPolicy.minLockedGainPct",
        label: "MIN LOCKED GAIN %",
        type: "number",
        step: 5,
        min: 0,
        max: 10000,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.trailGivebackPct",
        label: "TRAIL GIVEBACK %",
        type: "number",
        step: 5,
        min: 0,
        max: 100,
        unit: "%",
        impact: "trailing",
        warningWhenNonZero: false,
      },
      {
        slice: "profile",
        path: "exitPolicy.progressiveTrailEnabled",
        label: "PROGRESSIVE TRAIL",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "exitPolicy.progressiveTrailSteps",
        label: "PROGRESSIVE TRAIL STEPS",
        type: "text",
        format: "progressiveTrailSteps",
        fullWidth: true,
        unit: "activation/lock/giveback",
      },
      {
        slice: "profile",
        path: "exitPolicy.tightenAtFiveXGivebackPct",
        label: "5X GIVEBACK %",
        type: "number",
        step: 5,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.tightenAtTenXGivebackPct",
        label: "10X GIVEBACK %",
        type: "number",
        step: 5,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.earlyExitBars",
        label: "EARLY EXIT BARS",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "bars",
      },
      {
        slice: "profile",
        path: "exitPolicy.earlyExitLossPct",
        label: "EARLY EXIT LOSS %",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.overnightMinGainPct",
        label: "OVERNIGHT MIN GAIN %",
        type: "number",
        step: 1,
        min: -100,
        max: 10000,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.overnightRunnerGivebackPct",
        label: "OVERNIGHT GIVEBACK %",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.flipOnOppositeSignal",
        label: "EXIT ON OPPOSITE SIGNAL",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "exitPolicy.overnightExitEnabled",
        label: "OVERNIGHT EXIT ENABLED",
        type: "boolean",
      },
    ],
  },
  {
    sectionId: "qualityExits",
    sectionLabel: "Quality Exits",
    columns: 3,
    fields: [
      {
        slice: "profile",
        path: "exitPolicy.conditionalQualityExitsEnabled",
        label: "QUALITY EXITS ENABLED",
        type: "boolean",
      },
      {
        slice: "profile",
        path: "exitPolicy.lowQualityEarlyExitBars",
        label: "LOW QUALITY EXIT BARS",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "bars",
      },
      {
        slice: "profile",
        path: "exitPolicy.lowQualityEarlyExitLossPct",
        label: "LOW QUALITY LOSS %",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.highQualityEarlyExitBars",
        label: "HIGH QUALITY EXIT BARS",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "bars",
      },
      {
        slice: "profile",
        path: "exitPolicy.highQualityEarlyExitLossPct",
        label: "HIGH QUALITY LOSS %",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.weakLiquidityTrailGivebackPct",
        label: "WEAK LIQUIDITY GIVEBACK %",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.strongLiquidityTrailGivebackPct",
        label: "STRONG LIQUIDITY GIVEBACK %",
        type: "number",
        step: 1,
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        slice: "profile",
        path: "exitPolicy.highQualityOvernightMinGainPct",
        label: "HIGH QUALITY OVERNIGHT MIN %",
        type: "number",
        step: 1,
        min: -100,
        max: 10000,
        unit: "%",
      },
    ],
  },
];

export const allSettingFields = settingFields.flatMap((section) =>
  section.fields.map((field) => ({ ...field, sectionLabel: section.sectionLabel })),
);

export const COMPACT_HALT_SETTING_PAIRS = [
  { controlId: "dailyLoss", settingPath: "riskCaps.maxDailyLoss", label: "Daily" },
  { controlId: "openSymbols", settingPath: "riskCaps.maxOpenSymbols", label: "Symbols" },
  { controlId: "premiumBudget", settingPath: "riskCaps.maxPremiumPerEntry", label: "Budget" },
  { controlId: "bearishRegime", settingPath: "entryGate.bearishRegime.minAdx", label: "Bear" },
  { controlId: "spreadGate", settingPath: "liquidityGate.maxSpreadPctOfMid", label: "Spread" },
  { controlId: "minBidGate", settingPath: "liquidityGate.minBid", label: "Min bid" },
];

export const COMPACT_HALT_STANDALONE_SETTINGS = [
  { groupId: "risk", id: "maxContracts", settingPath: "riskCaps.maxContracts", label: "Contracts" },
];

export const COMPACT_RAIL_SETTING_GROUPS = [
  {
    groupId: "signal",
    label: "Signal",
    columns: 4,
    items: [
      {
        id: "mtfPolicy",
        label: "MTF",
        togglePath: "entryGate.mtfAlignment.enabled",
        toggleLabel: "Gate",
        valuePath: "entryGate.mtfAlignment.requiredCount",
        valueLabel: "Count",
      },
      { settingPath: "signalTimeframe", label: "TF" },
      { settingPath: "timeHorizon", label: "Bars" },
      { settingPath: "bosConfirmation", label: "BOS" },
      { settingPath: "chochAtrBuffer", label: "CHOCH" },
      { settingPath: "chochBodyExpansionAtr", label: "Body" },
      { settingPath: "chochVolumeGate", label: "Volume" },
      { settingPath: "entryGate.bearishRegime.enabled", label: "Bear gate" },
      {
        settingPath: "entryGate.bearishRegime.rejectFullyBullishMtf",
        label: "Reject bull",
      },
    ],
  },
  {
    groupId: "quote",
    label: "Quote / Fills",
    columns: 4,
    items: [
      { settingPath: "liquidityGate.requireBidAsk", label: "Req bid/ask" },
      {
        id: "freshQuotePolicy",
        label: "Fresh quote",
        togglePath: "liquidityGate.requireFreshQuote",
        toggleLabel: "Req",
        valuePath: "fillPolicy.ttlSeconds",
        valueLabel: "TTL",
      },
      { settingPath: "fillPolicy.chaseSteps", label: "Chase", wide: true },
    ],
  },
  {
    groupId: "strike",
    label: "Strike",
    columns: 4,
    items: [
      {
        id: "minDtePolicy",
        label: "Min DTE",
        togglePath: "optionSelection.allowZeroDte",
        toggleLabel: "0DTE",
        valuePath: "optionSelection.minDte",
        valueLabel: "Min",
      },
      { settingPath: "optionSelection.targetDte", label: "Target" },
      { settingPath: "optionSelection.maxDte", label: "Max" },
      { settingPath: "optionSelection.callStrikeSlot", label: "Call slot" },
      { settingPath: "optionSelection.putStrikeSlot", label: "Put slot" },
    ],
  },
  {
    groupId: "exitLadder",
    label: "Exit Ladder",
    columns: 4,
    items: [
      { settingPath: "exitPolicy.hardStopPct", label: "Stop" },
      { settingPath: "exitPolicy.trailActivationPct", label: "Trail on" },
      { settingPath: "exitPolicy.minLockedGainPct", label: "Lock" },
      { settingPath: "exitPolicy.trailGivebackPct", label: "Giveback" },
      { settingPath: "exitPolicy.progressiveTrailEnabled", label: "Prog trail" },
      {
        settingPath: "exitPolicy.progressiveTrailSteps",
        label: "Ladder",
        wide: true,
      },
      { settingPath: "exitPolicy.tightenAtFiveXGivebackPct", label: "5x" },
      { settingPath: "exitPolicy.tightenAtTenXGivebackPct", label: "10x" },
      { settingPath: "exitPolicy.earlyExitBars", label: "Early bars" },
      { settingPath: "exitPolicy.earlyExitLossPct", label: "Early loss" },
      { settingPath: "exitPolicy.flipOnOppositeSignal", label: "Flip exit" },
    ],
  },
  {
    groupId: "overnight",
    label: "Overnight",
    columns: 4,
    items: [
      {
        id: "overnightPolicy",
        label: "Overnight",
        togglePath: "exitPolicy.overnightExitEnabled",
        toggleLabel: "Exit",
        valuePath: "exitPolicy.overnightMinGainPct",
        valueLabel: "Min",
      },
      { settingPath: "exitPolicy.overnightRunnerGivebackPct", label: "Giveback" },
    ],
  },
  {
    groupId: "qualityExits",
    label: "Quality Exits",
    columns: 4,
    items: [
      {
        settingPath: "exitPolicy.conditionalQualityExitsEnabled",
        label: "Quality",
      },
      { settingPath: "exitPolicy.lowQualityEarlyExitBars", label: "Low bars" },
      { settingPath: "exitPolicy.lowQualityEarlyExitLossPct", label: "Low loss" },
      { settingPath: "exitPolicy.highQualityEarlyExitBars", label: "High bars" },
      { settingPath: "exitPolicy.highQualityEarlyExitLossPct", label: "High loss" },
      {
        settingPath: "exitPolicy.weakLiquidityTrailGivebackPct",
        label: "Weak liq",
      },
      {
        settingPath: "exitPolicy.strongLiquidityTrailGivebackPct",
        label: "Strong liq",
      },
      {
        settingPath: "exitPolicy.highQualityOvernightMinGainPct",
        label: "HQ overnight",
      },
    ],
  },
];

const COMPACT_HALT_SETTING_PATHS = new Set(
  [
    ...COMPACT_HALT_SETTING_PAIRS.map((pair) => pair.settingPath),
    ...COMPACT_HALT_STANDALONE_SETTINGS.map((item) => item.settingPath),
  ],
);

const compactRailItemPaths = (item) =>
  [item.settingPath, item.togglePath, item.valuePath].filter(Boolean);

const COMPACT_RAIL_SETTING_PATHS = new Set(
  COMPACT_RAIL_SETTING_GROUPS.flatMap((group) =>
    group.items.flatMap(compactRailItemPaths),
  ),
);

const COMPACT_SETTING_PATHS = new Set([
  ...COMPACT_HALT_SETTING_PATHS,
  ...COMPACT_RAIL_SETTING_PATHS,
]);

export const isCompactHaltSettingPath = (path) =>
  COMPACT_HALT_SETTING_PATHS.has(path);

export const isCompactRailSettingPath = (path) =>
  COMPACT_RAIL_SETTING_PATHS.has(path);

export const isCompactSettingPath = (path) =>
  COMPACT_SETTING_PATHS.has(path);

const getSettingFieldByPath = (path) =>
  allSettingFields.find((item) => item.path === path) || null;

export const getCompactHaltSettingField = (controlId) => {
  const pair = COMPACT_HALT_SETTING_PAIRS.find(
    (item) => item.controlId === controlId,
  );
  if (!pair) return null;
  const field = getSettingFieldByPath(pair.settingPath);
  return field ? { ...field, compactLabel: pair.label } : null;
};

export const getCompactHaltStandaloneFields = (groupId) =>
  COMPACT_HALT_STANDALONE_SETTINGS
    .filter((item) => item.groupId === groupId)
    .map((item) => {
      const field = getSettingFieldByPath(item.settingPath);
      return field
        ? { ...field, compactId: item.id, compactLabel: item.label }
        : null;
    })
    .filter(Boolean);

const resolveCompactRailItem = (item) => {
  if (item.settingPath) {
    const field = getSettingFieldByPath(item.settingPath);
    return field
      ? {
          kind: "field",
          ...field,
          compactId: item.id || item.settingPath,
          compactLabel: item.label || field.label,
          compactWide: Boolean(item.wide),
        }
      : null;
  }

  const toggleField = getSettingFieldByPath(item.togglePath);
  const valueField = getSettingFieldByPath(item.valuePath);
  if (!toggleField || !valueField) return null;
  return {
    kind: "compound",
    compactId: item.id,
    compactLabel: item.label,
    toggleField: {
      ...toggleField,
      compactLabel: item.toggleLabel || toggleField.label,
    },
    valueField: {
      ...valueField,
      compactLabel: item.valueLabel || valueField.label,
    },
    compactWide: Boolean(item.wide),
  };
};

export const compactRailSettingGroups = COMPACT_RAIL_SETTING_GROUPS
  .map((group) => ({
    ...group,
    items: group.items.map(resolveCompactRailItem).filter(Boolean),
  }))
  .filter((group) => group.items.length > 0);

export const settingsRegionFields = settingFields
  .map((section) => ({
    ...section,
    fields: section.fields.filter(
      (field) => !isCompactSettingPath(field.path),
    ),
  }))
  .filter((section) => section.fields.length > 0);

export const collectDirtySettingFields = ({
  profileDraft,
  profileBaseline,
  strategyDraft,
  strategyBaseline,
  isEqual = Object.is,
}) =>
  allSettingFields
    .map((field) => {
      const draftRoot = field.slice === "profile" ? profileDraft : strategyDraft;
      const baselineRoot =
        field.slice === "profile" ? profileBaseline : strategyBaseline;
      const currentValue = getPathValue(draftRoot, field.path);
      const previousValue = getPathValue(baselineRoot, field.path);
      return {
        ...field,
        currentValue,
        previousValue,
        dirty: !isEqual(currentValue, previousValue),
      };
    })
    .filter((field) => field.dirty);

export const countDirtyFieldsBySection = (dirtyFields) =>
  dirtyFields.reduce((counts, field) => {
    counts[field.sectionLabel] = (counts[field.sectionLabel] || 0) + 1;
    return counts;
  }, {});
