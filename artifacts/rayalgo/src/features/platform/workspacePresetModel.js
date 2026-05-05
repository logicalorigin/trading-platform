import { normalizeLinkedWorkspaceGroupId } from "./linkedWorkspaceModel";

export const WORKSPACE_PRESET_IDS = Object.freeze([
  "market_monitor",
  "options_trade",
  "flow_review",
  "market_calendar",
  "risk_review",
  "automation_desk",
]);

const MARKET_GRID_LAYOUTS = Object.freeze(["1x1", "2x2", "2x3", "3x3"]);
const FLOW_DENSITY_OPTIONS = Object.freeze(["compact", "comfortable"]);
const FLOW_ROWS_OPTIONS = Object.freeze([24, 40, 60, 100]);
const FLOW_SORT_OPTIONS = Object.freeze([
  "time",
  "premium",
  "score",
  "ratio",
  "ticker",
  "expiration",
  "right",
  "strike",
  "size",
  "oi",
  "dte",
  "iv",
  "mark",
  "spot",
  "moneyness",
  "distance",
  "delta",
  "gamma",
  "theta",
  "vega",
  "sourceBasis",
  "confidence",
]);
const FLOW_SORT_DIR_OPTIONS = Object.freeze(["asc", "desc"]);
const FLOW_FILTER_OPTIONS = Object.freeze([
  "all",
  "calls",
  "puts",
  "unusual",
  "golden",
  "sweep",
  "block",
  "cluster",
]);
const FLOW_PRESET_OPTIONS = Object.freeze([
  "ask-calls",
  "bid-puts",
  "zero-dte",
  "premium-50k",
  "premium-250k",
  "vol-oi",
  "sweeps",
  "blocks",
  "repeats",
  "golden",
]);
const FLOW_COLUMN_OPTIONS = Object.freeze([
  "side",
  "execution",
  "type",
  "fill",
  "bidAsk",
  "bid",
  "ask",
  "spread",
  "premium",
  "size",
  "oi",
  "ratio",
  "dte",
  "iv",
  "spot",
  "moneyness",
  "distance",
  "delta",
  "gamma",
  "theta",
  "vega",
  "sourceBasis",
  "confidence",
  "score",
]);
const DEFAULT_FLOW_COLUMN_ORDER = Object.freeze(FLOW_COLUMN_OPTIONS);
const DEFAULT_FLOW_VISIBLE_COLUMNS = Object.freeze([
  "side",
  "execution",
  "type",
  "fill",
  "bidAsk",
  "premium",
  "size",
  "oi",
  "ratio",
  "dte",
  "iv",
  "spot",
  "score",
]);
const ACCOUNT_SECTION_OPTIONS = Object.freeze(["real", "shadow"]);
const ACCOUNT_ORDER_TAB_OPTIONS = Object.freeze(["working", "history"]);
const TRADE_L2_TAB_OPTIONS = Object.freeze(["book", "flow", "tape"]);
const TRADE_POSITIONS_TAB_OPTIONS = Object.freeze(["open", "history", "orders"]);

export const WORKSPACE_PRESET_MANAGED_KEYS = Object.freeze([
  "screen",
  "sidebarCollapsed",
  "marketGridLayout",
  "marketGridSoloSlotIndex",
  "marketGridSyncTimeframes",
  "flowActivePresetId",
  "flowFilter",
  "flowMinPrem",
  "flowSortBy",
  "flowSortDir",
  "flowIncludeQuery",
  "flowExcludeQuery",
  "flowDensity",
  "flowRowsPerPage",
  "flowLivePaused",
  "flowShowUnusualScanner",
  "flowFiltersOpen",
  "flowColumnsOpen",
  "flowColumnOrder",
  "flowVisibleColumns",
  "tradeChainHeatmapEnabled",
  "tradeL2Tab",
  "tradePositionsTab",
  "accountSection",
  "accountOrderTab",
]);

const BASE_PRESET_DEFAULTS = Object.freeze({
  sidebarCollapsed: false,
  marketGridLayout: "2x3",
  marketGridSoloSlotIndex: 0,
  marketGridSyncTimeframes: false,
  flowActivePresetId: null,
  flowFilter: "all",
  flowMinPrem: 0,
  flowSortBy: "time",
  flowSortDir: "desc",
  flowIncludeQuery: "",
  flowExcludeQuery: "",
  flowDensity: "compact",
  flowRowsPerPage: 40,
  flowLivePaused: false,
  flowShowUnusualScanner: true,
  flowFiltersOpen: true,
  flowColumnsOpen: false,
  flowColumnOrder: DEFAULT_FLOW_COLUMN_ORDER,
  flowVisibleColumns: DEFAULT_FLOW_VISIBLE_COLUMNS,
  tradeChainHeatmapEnabled: true,
  tradeL2Tab: "book",
  tradePositionsTab: "open",
  accountSection: "real",
  accountOrderTab: "working",
  activeLinkedGroup: "A",
});

const definePreset = (id, label, screen, defaults = {}) =>
  Object.freeze({
    id,
    label,
    screen,
    defaults: Object.freeze({
      ...BASE_PRESET_DEFAULTS,
      ...defaults,
    }),
  });

export const WORKSPACE_PRESET_DEFINITIONS = Object.freeze([
  definePreset("market_monitor", "Market Monitor", "market", {
    sidebarCollapsed: false,
    marketGridLayout: "2x3",
    marketGridSyncTimeframes: true,
    activeLinkedGroup: "A",
  }),
  definePreset("options_trade", "Options Trade", "trade", {
    sidebarCollapsed: true,
    marketGridLayout: "1x1",
    flowColumnsOpen: false,
    tradeChainHeatmapEnabled: true,
    tradeL2Tab: "book",
    tradePositionsTab: "open",
    activeLinkedGroup: "A",
  }),
  definePreset("flow_review", "Flow Review", "flow", {
    sidebarCollapsed: true,
    flowActivePresetId: "premium-250k",
    flowFilter: "all",
    flowMinPrem: 250_000,
    flowSortBy: "premium",
    flowSortDir: "desc",
    flowFiltersOpen: true,
    flowColumnsOpen: true,
    activeLinkedGroup: "B",
  }),
  definePreset("market_calendar", "Market Calendar", "market", {
    sidebarCollapsed: false,
    marketGridLayout: "1x1",
    marketGridSyncTimeframes: false,
    activeLinkedGroup: "A",
  }),
  definePreset("risk_review", "Risk Review", "account", {
    sidebarCollapsed: true,
    accountSection: "real",
    accountOrderTab: "working",
    tradePositionsTab: "orders",
    activeLinkedGroup: "C",
  }),
  definePreset("automation_desk", "Automation Desk", "algo", {
    sidebarCollapsed: true,
    marketGridLayout: "2x2",
    flowShowUnusualScanner: false,
    activeLinkedGroup: "C",
  }),
]);

const WORKSPACE_PRESET_BY_ID = new Map(
  WORKSPACE_PRESET_DEFINITIONS.map((preset) => [preset.id, preset]),
);
const SCREEN_TO_PRESET_ID = Object.freeze({
  market: "market_monitor",
  flow: "flow_review",
  trade: "options_trade",
  account: "risk_review",
  algo: "automation_desk",
});

export const normalizeWorkspacePresetId = (value, fallback = "market_monitor") =>
  WORKSPACE_PRESET_BY_ID.has(value) ? value : fallback;

export const inferWorkspacePresetIdForScreen = (screen) =>
  SCREEN_TO_PRESET_ID[screen] || "market_monitor";

export const getWorkspacePresetDefinition = (presetId) =>
  WORKSPACE_PRESET_BY_ID.get(normalizeWorkspacePresetId(presetId)) ||
  WORKSPACE_PRESET_BY_ID.get("market_monitor");

const isRecord = (value) =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const enumValue = (value, options, fallback) =>
  options.includes(value) ? value : fallback;

const booleanValue = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;

const numberValue = (value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const stringValue = (value, fallback = "") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);

const nullableEnumValue = (value, options, fallback = null) => {
  if (value == null || value === "") return null;
  return options.includes(value) ? value : fallback;
};

const normalizeColumnList = (value, fallback) => {
  const fallbackList = Array.isArray(fallback) ? fallback : [];
  if (!Array.isArray(value)) return [...fallbackList];
  const seen = new Set();
  const next = [];
  value.forEach((columnId) => {
    if (!FLOW_COLUMN_OPTIONS.includes(columnId) || seen.has(columnId)) return;
    seen.add(columnId);
    next.push(columnId);
  });
  return next.length ? next : [...fallbackList];
};

export function normalizeWorkspacePresetSnapshot(presetId, input = {}) {
  const preset = getWorkspacePresetDefinition(presetId);
  const source = isRecord(input) ? input : {};
  const defaults = preset.defaults;
  const flowSortBy = enumValue(
    source.flowSortBy,
    FLOW_SORT_OPTIONS,
    defaults.flowSortBy,
  );

  return {
    screen: preset.screen,
    sidebarCollapsed: booleanValue(source.sidebarCollapsed, defaults.sidebarCollapsed),
    marketGridLayout: enumValue(
      source.marketGridLayout,
      MARKET_GRID_LAYOUTS,
      defaults.marketGridLayout,
    ),
    marketGridSoloSlotIndex: numberValue(
      source.marketGridSoloSlotIndex,
      defaults.marketGridSoloSlotIndex,
      0,
      8,
    ),
    marketGridSyncTimeframes: booleanValue(
      source.marketGridSyncTimeframes,
      defaults.marketGridSyncTimeframes,
    ),
    flowActivePresetId: nullableEnumValue(
      source.flowActivePresetId,
      FLOW_PRESET_OPTIONS,
      defaults.flowActivePresetId,
    ),
    flowFilter: enumValue(source.flowFilter, FLOW_FILTER_OPTIONS, defaults.flowFilter),
    flowMinPrem: numberValue(source.flowMinPrem, defaults.flowMinPrem, 0),
    flowSortBy,
    flowSortDir: enumValue(
      source.flowSortDir,
      FLOW_SORT_DIR_OPTIONS,
      defaults.flowSortDir,
    ),
    flowIncludeQuery: stringValue(source.flowIncludeQuery, defaults.flowIncludeQuery),
    flowExcludeQuery: stringValue(source.flowExcludeQuery, defaults.flowExcludeQuery),
    flowDensity: enumValue(
      source.flowDensity,
      FLOW_DENSITY_OPTIONS,
      defaults.flowDensity,
    ),
    flowRowsPerPage: enumValue(
      numberValue(source.flowRowsPerPage, defaults.flowRowsPerPage),
      FLOW_ROWS_OPTIONS,
      defaults.flowRowsPerPage,
    ),
    flowLivePaused: booleanValue(source.flowLivePaused, defaults.flowLivePaused),
    flowShowUnusualScanner: booleanValue(
      source.flowShowUnusualScanner,
      defaults.flowShowUnusualScanner,
    ),
    flowFiltersOpen: booleanValue(source.flowFiltersOpen, defaults.flowFiltersOpen),
    flowColumnsOpen: booleanValue(source.flowColumnsOpen, defaults.flowColumnsOpen),
    flowColumnOrder: normalizeColumnList(
      source.flowColumnOrder,
      defaults.flowColumnOrder,
    ),
    flowVisibleColumns: normalizeColumnList(
      source.flowVisibleColumns,
      defaults.flowVisibleColumns,
    ),
    tradeChainHeatmapEnabled: booleanValue(
      source.tradeChainHeatmapEnabled,
      defaults.tradeChainHeatmapEnabled,
    ),
    tradeL2Tab: enumValue(source.tradeL2Tab, TRADE_L2_TAB_OPTIONS, defaults.tradeL2Tab),
    tradePositionsTab: enumValue(
      source.tradePositionsTab,
      TRADE_POSITIONS_TAB_OPTIONS,
      defaults.tradePositionsTab,
    ),
    accountSection: enumValue(
      source.accountSection,
      ACCOUNT_SECTION_OPTIONS,
      defaults.accountSection,
    ),
    accountOrderTab: enumValue(
      source.accountOrderTab,
      ACCOUNT_ORDER_TAB_OPTIONS,
      defaults.accountOrderTab,
    ),
    activeLinkedGroup:
      normalizeLinkedWorkspaceGroupId(source.activeLinkedGroup) ||
      normalizeLinkedWorkspaceGroupId(source.linkedWorkspace?.activeGroup) ||
      defaults.activeLinkedGroup,
  };
}

export function captureWorkspacePresetSnapshot(context = {}, presetId) {
  const workspaceState = isRecord(context.workspaceState)
    ? context.workspaceState
    : {};
  return normalizeWorkspacePresetSnapshot(presetId, {
    ...workspaceState,
    ...(typeof context.sidebarCollapsed === "boolean"
      ? { sidebarCollapsed: context.sidebarCollapsed }
      : null),
    activeLinkedGroup:
      context.activeLinkedGroup ||
      context.linkedWorkspace?.activeGroup ||
      workspaceState.linkedWorkspace?.activeGroup,
  });
}

export function resolveWorkspacePresetSnapshot(presetId, savedSnapshot = null) {
  return normalizeWorkspacePresetSnapshot(
    presetId,
    savedSnapshot || getWorkspacePresetDefinition(presetId).defaults,
  );
}

export function normalizeWorkspacePresetsState(input = {}, context = {}) {
  const source = isRecord(input) ? input : {};
  const activePresetId = normalizeWorkspacePresetId(
    source.activePresetId,
    inferWorkspacePresetIdForScreen(context.screen),
  );
  const sourcePresets = isRecord(source.presets) ? source.presets : {};
  const presets = {};
  WORKSPACE_PRESET_IDS.forEach((presetId) => {
    if (isRecord(sourcePresets[presetId])) {
      presets[presetId] = normalizeWorkspacePresetSnapshot(
        presetId,
        sourcePresets[presetId],
      );
    }
  });
  if (!presets[activePresetId] && isRecord(context.workspaceState)) {
    presets[activePresetId] = captureWorkspacePresetSnapshot(
      context,
      activePresetId,
    );
  }
  return {
    version: 1,
    activePresetId,
    presets,
  };
}

export function switchWorkspacePreset(state, targetPresetId, currentSnapshot) {
  const normalized = normalizeWorkspacePresetsState(state);
  const nextPresetId = normalizeWorkspacePresetId(
    targetPresetId,
    normalized.activePresetId,
  );
  const currentPresetId = normalized.activePresetId;
  const presets = {
    ...normalized.presets,
    [currentPresetId]: normalizeWorkspacePresetSnapshot(
      currentPresetId,
      currentSnapshot,
    ),
  };
  const snapshot = resolveWorkspacePresetSnapshot(
    nextPresetId,
    presets[nextPresetId],
  );
  return {
    state: {
      version: 1,
      activePresetId: nextPresetId,
      presets,
    },
    snapshot,
    preset: getWorkspacePresetDefinition(nextPresetId),
  };
}

export function restoreWorkspacePresetDefaults(state, presetId) {
  const normalized = normalizeWorkspacePresetsState(state);
  const nextPresetId = normalizeWorkspacePresetId(
    presetId,
    normalized.activePresetId,
  );
  const presets = { ...normalized.presets };
  delete presets[nextPresetId];
  return {
    state: {
      version: 1,
      activePresetId: nextPresetId,
      presets,
    },
    snapshot: resolveWorkspacePresetSnapshot(nextPresetId),
    preset: getWorkspacePresetDefinition(nextPresetId),
  };
}

export function buildWorkspacePresetStoragePatch(snapshot) {
  const normalized = normalizeWorkspacePresetSnapshot(
    inferWorkspacePresetIdForScreen(snapshot?.screen),
    snapshot,
  );
  return Object.fromEntries(
    WORKSPACE_PRESET_MANAGED_KEYS.map((key) => [key, normalized[key]]),
  );
}
