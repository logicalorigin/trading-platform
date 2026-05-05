import { normalizeChartTimeframe } from "../charting/timeframes";
import { normalizeTickerSymbol } from "./tickerIdentity";

export const LINKED_WORKSPACE_GROUP_IDS = Object.freeze(["A", "B", "C"]);
export const LINKED_WORKSPACE_PANEL_IDS = Object.freeze([
  "market",
  "trade",
  "flow",
  "account",
  "research",
]);

export const DEFAULT_LINKED_WORKSPACE_PANELS = Object.freeze({
  market: "A",
  trade: "A",
  flow: "A",
  account: "A",
  research: "A",
});

const DEFAULT_SYMBOL = "SPY";
const DEFAULT_TIMEFRAME = "15m";

export const isLinkedWorkspaceGroupId = (value) =>
  LINKED_WORKSPACE_GROUP_IDS.includes(value);

export const isLinkedWorkspacePanelId = (value) =>
  LINKED_WORKSPACE_PANEL_IDS.includes(value);

export const normalizeLinkedWorkspaceGroupId = (value) =>
  isLinkedWorkspaceGroupId(value) ? value : null;

const normalizeSymbol = (value, fallback = DEFAULT_SYMBOL) =>
  normalizeTickerSymbol(value) || normalizeTickerSymbol(fallback) || DEFAULT_SYMBOL;

const normalizeTimeframe = (value, fallback = DEFAULT_TIMEFRAME) => {
  const rawValue = typeof value === "string" ? value.trim().toLowerCase() : value;
  const rawFallback =
    typeof fallback === "string" ? fallback.trim().toLowerCase() : fallback;
  return (
    normalizeChartTimeframe(rawValue) ||
    normalizeChartTimeframe(rawFallback) ||
    DEFAULT_TIMEFRAME
  );
};

const normalizePanelGroup = (panels, panelId) => {
  if (!Object.prototype.hasOwnProperty.call(panels || {}, panelId)) {
    return DEFAULT_LINKED_WORKSPACE_PANELS[panelId] || null;
  }
  const rawGroup = panels?.[panelId];
  if (rawGroup == null) {
    return null;
  }
  return (
    normalizeLinkedWorkspaceGroupId(rawGroup) ||
    DEFAULT_LINKED_WORKSPACE_PANELS[panelId] ||
    null
  );
};

export function normalizeLinkedWorkspaceState(input = {}, fallbackContext = {}) {
  const fallbackSymbol = normalizeSymbol(fallbackContext.symbol);
  const fallbackTimeframe = normalizeTimeframe(fallbackContext.timeframe);
  const sourceGroups =
    input?.groups && typeof input.groups === "object" ? input.groups : {};
  const sourcePanels =
    input?.panels && typeof input.panels === "object" ? input.panels : {};

  const groups = Object.fromEntries(
    LINKED_WORKSPACE_GROUP_IDS.map((groupId) => {
      const source = sourceGroups[groupId] || {};
      return [
        groupId,
        {
          symbol: normalizeSymbol(source.symbol, fallbackSymbol),
          timeframe: normalizeTimeframe(source.timeframe, fallbackTimeframe),
          updatedAt:
            typeof source.updatedAt === "string" ? source.updatedAt : null,
        },
      ];
    }),
  );

  const panels = Object.fromEntries(
    LINKED_WORKSPACE_PANEL_IDS.map((panelId) => [
      panelId,
      normalizePanelGroup(sourcePanels, panelId),
    ]),
  );

  const activeGroup =
    normalizeLinkedWorkspaceGroupId(input?.activeGroup) ||
    panels.market ||
    DEFAULT_LINKED_WORKSPACE_PANELS.market;
  const lastBroadcast =
    input?.lastBroadcast && typeof input.lastBroadcast === "object"
      ? {
          sourcePanel:
            typeof input.lastBroadcast.sourcePanel === "string"
              ? input.lastBroadcast.sourcePanel
              : "external",
          groupId:
            normalizeLinkedWorkspaceGroupId(input.lastBroadcast.groupId) ||
            activeGroup,
          symbol: normalizeSymbol(input.lastBroadcast.symbol, groups[activeGroup].symbol),
          timeframe: normalizeTimeframe(
            input.lastBroadcast.timeframe,
            groups[activeGroup].timeframe,
          ),
          sequence: Number.isFinite(input.lastBroadcast.sequence)
            ? Math.max(0, Math.floor(input.lastBroadcast.sequence))
            : 0,
          updatedAt:
            typeof input.lastBroadcast.updatedAt === "string"
              ? input.lastBroadcast.updatedAt
              : null,
        }
      : null;

  return {
    version: 1,
    activeGroup,
    panels,
    groups,
    lastBroadcast,
  };
}

export function setLinkedWorkspaceActiveGroup(state, groupId) {
  const normalized = normalizeLinkedWorkspaceState(state);
  const nextGroupId = normalizeLinkedWorkspaceGroupId(groupId);
  return nextGroupId
    ? {
        ...normalized,
        activeGroup: nextGroupId,
      }
    : normalized;
}

export function setLinkedWorkspacePanelGroup(state, panelId, groupId) {
  const normalized = normalizeLinkedWorkspaceState(state);
  if (!isLinkedWorkspacePanelId(panelId)) {
    return normalized;
  }
  return {
    ...normalized,
    panels: {
      ...normalized.panels,
      [panelId]: groupId == null ? null : normalizeLinkedWorkspaceGroupId(groupId),
    },
  };
}

export function applyLinkedWorkspaceBroadcast(
  state,
  {
    sourcePanel = "external",
    groupId = null,
    symbol = null,
    timeframe = null,
    updatedAt = null,
  } = {},
) {
  const normalized = normalizeLinkedWorkspaceState(state);
  const sourcePanelGroup = isLinkedWorkspacePanelId(sourcePanel)
    ? normalized.panels[sourcePanel]
    : null;
  const targetGroupId =
    normalizeLinkedWorkspaceGroupId(groupId) ||
    sourcePanelGroup ||
    normalized.activeGroup;

  if (!targetGroupId) {
    return normalized;
  }

  const currentGroup = normalized.groups[targetGroupId];
  const nextSymbol = symbol
    ? normalizeSymbol(symbol, currentGroup.symbol)
    : currentGroup.symbol;
  const nextTimeframe = timeframe
    ? normalizeTimeframe(timeframe, currentGroup.timeframe)
    : currentGroup.timeframe;
  const nextUpdatedAt =
    typeof updatedAt === "string"
      ? updatedAt
      : new Date().toISOString();

  return {
    ...normalized,
    activeGroup: targetGroupId,
    groups: {
      ...normalized.groups,
      [targetGroupId]: {
        ...currentGroup,
        symbol: nextSymbol,
        timeframe: nextTimeframe,
        updatedAt: nextUpdatedAt,
      },
    },
    lastBroadcast: {
      sourcePanel,
      groupId: targetGroupId,
      symbol: nextSymbol,
      timeframe: nextTimeframe,
      sequence: (normalized.lastBroadcast?.sequence || 0) + 1,
      updatedAt: nextUpdatedAt,
    },
  };
}

export function resolveLinkedWorkspacePanelContext(
  state,
  panelId,
  fallbackContext = {},
) {
  const normalized = normalizeLinkedWorkspaceState(state, fallbackContext);
  const groupId = isLinkedWorkspacePanelId(panelId)
    ? normalized.panels[panelId]
    : null;
  if (!groupId) {
    return {
      linked: false,
      groupId: null,
      symbol: normalizeSymbol(fallbackContext.symbol),
      timeframe: normalizeTimeframe(fallbackContext.timeframe),
    };
  }
  const group = normalized.groups[groupId];
  const broadcastSequence =
    normalized.lastBroadcast?.groupId === groupId
      ? normalized.lastBroadcast.sequence || 0
      : 0;
  return {
    linked: true,
    groupId,
    symbol: group.symbol,
    timeframe: group.timeframe,
    updatedAt: group.updatedAt,
    broadcastSequence,
  };
}

export function getLinkedWorkspacePanelsForGroup(state, groupId) {
  const normalized = normalizeLinkedWorkspaceState(state);
  const normalizedGroupId = normalizeLinkedWorkspaceGroupId(groupId);
  if (!normalizedGroupId) {
    return [];
  }
  return LINKED_WORKSPACE_PANEL_IDS.filter(
    (panelId) => normalized.panels[panelId] === normalizedGroupId,
  );
}
