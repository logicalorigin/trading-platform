import {
  PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
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

export const NUMERIC_SETTING_TYPES = new Set([
  "number",
  "slider",
  "logSlider",
]);

export const isNumericSettingType = (type) => NUMERIC_SETTING_TYPES.has(type);

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

const SETTING_FIELD_SECTIONS = [
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
        type: "slider",
        step: 1,
        min: 2,
        max: 50,
        unit: "bars",
      },
      {
        slice: "strategy",
        path: "bosConfirmation",
        label: "BOS CONFIRMATION",
        type: "segmented",
        options: PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
      },
      {
        slice: "strategy",
        path: "chochAtrBuffer",
        label: "CHOCH ATR BUFFER",
        type: "slider",
        step: 0.05,
        min: 0,
        max: 20,
        unit: "x ATR",
      },
      {
        slice: "strategy",
        path: "chochBodyExpansionAtr",
        label: "CHOCH BODY ATR",
        type: "slider",
        step: 0.05,
        min: 0,
        max: 20,
        unit: "x ATR",
      },
      {
        slice: "strategy",
        path: "chochVolumeGate",
        label: "CHOCH VOLUME GATE",
        type: "slider",
        step: 0.05,
        min: 0,
        max: 20,
        unit: "x avg",
      },
    ],
  },
  {
    sectionId: "risk",
    sectionLabel: "Risk",
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
    sectionLabel: "Gates",
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
    sectionId: "contract",
    sectionLabel: "Contract",
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
        path: "optionSelection.callStrikeSlots",
        label: "CALL STRIKE SLOTS",
        type: "array",
      },
      {
        slice: "profile",
        path: "optionSelection.putStrikeSlots",
        label: "PUT STRIKE SLOTS",
        type: "array",
      },
      {
        slice: "profile",
        path: "optionSelection.callStrikeSlot",
        label: "CALL STRIKE SLOT",
        type: "select",
        options: SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
        coerce: Number,
        dirtySummary: false,
      },
      {
        slice: "profile",
        path: "optionSelection.putStrikeSlot",
        label: "PUT STRIKE SLOT",
        type: "select",
        options: SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS,
        coerce: Number,
        dirtySummary: false,
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

export const allSettingFields = SETTING_FIELD_SECTIONS.flatMap((section) =>
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

const COMPACT_HALT_SETTING_PATHS = new Set(
  [
    ...COMPACT_HALT_SETTING_PAIRS.map((pair) => pair.settingPath),
    ...COMPACT_HALT_STANDALONE_SETTINGS.map((item) => item.settingPath),
  ],
);

export const isCompactHaltSettingPath = (path) =>
  COMPACT_HALT_SETTING_PATHS.has(path);

export const getSettingFieldByPath = (path) =>
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

const field = (path, overrides = {}) => {
  const match = getSettingFieldByPath(path);
  if (!match) {
    throw new Error(`Unknown algo setting field path: ${path}`);
  }
  return { ...match, ...overrides };
};

export const SETTINGS_SECTIONS = [
  {
    id: "signal",
    label: "Signal",
    defaultOpen: false,
    fields: [
      field("signalTimeframe", { compactLabel: "Timeframe" }),
      field("timeHorizon", { compactLabel: "Horizon" }),
      field("bosConfirmation", { compactLabel: "BOS" }),
      field("chochAtrBuffer", { compactLabel: "CHOCH ATR" }),
      field("chochBodyExpansionAtr", { compactLabel: "Body ATR" }),
      field("chochVolumeGate", { compactLabel: "Volume" }),
    ],
  },
  {
    id: "risk",
    label: "Risk",
    defaultOpen: true,
    fields: [
      field("riskCaps.maxPremiumPerEntry", { compactLabel: "Max Premium" }),
      field("riskCaps.maxContracts", { compactLabel: "Contracts" }),
      field("riskCaps.maxOpenSymbols", { compactLabel: "Open Symbols" }),
      field("riskCaps.maxDailyLoss", { compactLabel: "Daily Halt" }),
    ],
  },
  {
    id: "gates",
    label: "Gates",
    defaultOpen: false,
    fields: [
      field("entryGate.mtfAlignment.enabled", { compactLabel: "MTF Gate" }),
      field("entryGate.mtfAlignment.requiredCount", { compactLabel: "MTF Count" }),
      field("entryGate.bearishRegime.minAdx", { compactLabel: "Bear ADX" }),
      field("entryGate.bearishRegime.enabled", { compactLabel: "Bear Gate" }),
      field("entryGate.bearishRegime.rejectFullyBullishMtf", {
        compactLabel: "Reject Bull MTF",
        compactWide: true,
      }),
    ],
  },
  {
    id: "contract",
    label: "Contract",
    defaultOpen: true,
    fields: [
      {
        kind: "contractSelect",
        id: "contract-selection",
        fieldPaths: [
          "optionSelection.minDte",
          "optionSelection.targetDte",
          "optionSelection.maxDte",
          "optionSelection.allowZeroDte",
          "optionSelection.callStrikeSlots",
          "optionSelection.putStrikeSlots",
          "optionSelection.callStrikeSlot",
          "optionSelection.putStrikeSlot",
        ],
        fields: [
          field("optionSelection.minDte", { compactLabel: "Min DTE" }),
          field("optionSelection.targetDte", { compactLabel: "Target DTE" }),
          field("optionSelection.maxDte", { compactLabel: "Max DTE" }),
          field("optionSelection.allowZeroDte", { compactLabel: "0DTE" }),
          field("optionSelection.callStrikeSlots", { compactLabel: "Call Slots" }),
          field("optionSelection.putStrikeSlots", { compactLabel: "Put Slots" }),
          field("optionSelection.callStrikeSlot", { compactLabel: "Call Slot" }),
          field("optionSelection.putStrikeSlot", { compactLabel: "Put Slot" }),
        ],
      },
    ],
  },
  {
    id: "fills",
    label: "Fills",
    defaultOpen: false,
    fields: [
      field("liquidityGate.maxSpreadPctOfMid", { compactLabel: "Max Spread" }),
      field("liquidityGate.minBid", { compactLabel: "Min Bid" }),
      field("liquidityGate.requireBidAsk", { compactLabel: "Bid/Ask" }),
      field("liquidityGate.requireFreshQuote", { compactLabel: "Fresh Quote" }),
      field("fillPolicy.ttlSeconds", { compactLabel: "TTL" }),
      field("fillPolicy.chaseSteps", { compactLabel: "Chase Ladder", compactWide: true }),
    ],
  },
  {
    id: "exits",
    label: "Exits",
    defaultOpen: true,
    fields: [
      {
        kind: "exitTrack",
        id: "exit-track",
        fieldPaths: [
          "exitPolicy.hardStopPct",
          "exitPolicy.earlyExitLossPct",
          "exitPolicy.trailActivationPct",
          "exitPolicy.minLockedGainPct",
          "exitPolicy.tightenAtFiveXGivebackPct",
          "exitPolicy.tightenAtTenXGivebackPct",
        ],
        fields: [
          field("exitPolicy.hardStopPct", { compactLabel: "Stop" }),
          field("exitPolicy.earlyExitLossPct", { compactLabel: "Early Loss" }),
          field("exitPolicy.trailActivationPct", { compactLabel: "Trail On" }),
          field("exitPolicy.minLockedGainPct", { compactLabel: "Lock" }),
          field("exitPolicy.tightenAtFiveXGivebackPct", { compactLabel: "5x" }),
          field("exitPolicy.tightenAtTenXGivebackPct", { compactLabel: "10x" }),
        ],
      },
      field("exitPolicy.earlyExitBars", { compactLabel: "Early Bars" }),
      field("exitPolicy.progressiveTrailEnabled", { compactLabel: "Prog Trail" }),
      field("exitPolicy.progressiveTrailSteps", {
        compactLabel: "Prog Steps",
        compactWide: true,
      }),
      field("exitPolicy.trailGivebackPct", { compactLabel: "Trail Giveback" }),
      field("exitPolicy.flipOnOppositeSignal", { compactLabel: "Flip Exit" }),
      field("exitPolicy.overnightExitEnabled", { compactLabel: "Overnight" }),
      field("exitPolicy.overnightMinGainPct", { compactLabel: "ON Min" }),
      field("exitPolicy.overnightRunnerGivebackPct", { compactLabel: "ON Giveback" }),
    ],
  },
  {
    id: "qualityExits",
    label: "Quality Exits",
    defaultOpen: false,
    fields: [
      field("exitPolicy.conditionalQualityExitsEnabled", { compactLabel: "Enabled" }),
      field("exitPolicy.lowQualityEarlyExitBars", { compactLabel: "Low Bars" }),
      field("exitPolicy.lowQualityEarlyExitLossPct", { compactLabel: "Low Loss" }),
      field("exitPolicy.highQualityEarlyExitBars", { compactLabel: "High Bars" }),
      field("exitPolicy.highQualityEarlyExitLossPct", { compactLabel: "High Loss" }),
      field("exitPolicy.weakLiquidityTrailGivebackPct", { compactLabel: "Weak Liq" }),
      field("exitPolicy.strongLiquidityTrailGivebackPct", { compactLabel: "Strong Liq" }),
      field("exitPolicy.highQualityOvernightMinGainPct", {
        compactLabel: "HQ ON Min",
        compactWide: true,
      }),
    ],
  },
];

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
    .filter((field) => field.dirty && field.dirtySummary !== false);

export const countDirtyFieldsBySection = (dirtyFields) =>
  dirtyFields.reduce((counts, field) => {
    if (field.dirtySummary === false) return counts;
    counts[field.sectionLabel] = (counts[field.sectionLabel] || 0) + 1;
    return counts;
  }, {});
