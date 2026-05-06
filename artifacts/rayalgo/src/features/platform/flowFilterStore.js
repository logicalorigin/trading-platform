import { useSyncExternalStore } from "react";
import { RAYALGO_STORAGE_KEY } from "../../lib/uiTokens";
import { normalizeTickerSymbol } from "./tickerIdentity";

export const FLOW_TAPE_FILTER_OPTIONS = Object.freeze([
  { id: "all", label: "All" },
  { id: "calls", label: "Calls" },
  { id: "puts", label: "Puts" },
  { id: "unusual", label: "Unusual" },
  { id: "golden", label: "Golden" },
  { id: "sweep", label: "Sweep" },
  { id: "block", label: "Block" },
  { id: "cluster", label: "Repeat" },
]);

export const FLOW_MIN_PREMIUM_OPTIONS = Object.freeze([
  { value: 0, label: "All" },
  { value: 50_000, label: "$50K" },
  { value: 100_000, label: "$100K" },
  { value: 250_000, label: "$250K" },
]);

export const FLOW_BUILT_IN_PRESETS = Object.freeze([
  { id: "ask-calls", label: "Ask Calls", sortBy: "premium" },
  { id: "bid-puts", label: "Bid Puts", sortBy: "premium" },
  { id: "zero-dte", label: "0DTE", sortBy: "premium" },
  { id: "premium-50k", label: "$50K+", minPrem: 50_000, sortBy: "premium" },
  { id: "premium-250k", label: "$250K+", minPrem: 250_000, sortBy: "premium" },
  { id: "vol-oi", label: "Vol > OI", sortBy: "ratio" },
  { id: "sweeps", label: "Sweeps", filter: "sweep" },
  { id: "blocks", label: "Blocks", filter: "block" },
  { id: "repeats", label: "Repeats", filter: "cluster" },
  { id: "golden", label: "Golden", filter: "golden" },
]);

const FLOW_TAPE_FILTER_IDS = new Set(
  FLOW_TAPE_FILTER_OPTIONS.map((option) => option.id),
);
const FLOW_BUILT_IN_PRESET_IDS = new Set(
  FLOW_BUILT_IN_PRESETS.map((preset) => preset.id),
);

const DEFAULT_FLOW_TAPE_FILTER_STATE = Object.freeze({
  activeFlowPresetId: null,
  filter: "all",
  minPrem: 0,
  includeQuery: "",
  excludeQuery: "",
});

const readPersistedState = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {};
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
};

const persistFlowTapeFilterState = (state) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = readPersistedState();
    window.localStorage.setItem(
      RAYALGO_STORAGE_KEY,
      JSON.stringify({
        ...current,
        flowActivePresetId: state.activeFlowPresetId,
        flowFilter: state.filter,
        flowMinPrem: state.minPrem,
        flowIncludeQuery: state.includeQuery,
        flowExcludeQuery: state.excludeQuery,
      }),
    );
  } catch (_error) {}
};

const normalizeOptionalString = (value) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const normalizeMinPremium = (value) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
};

export const parseFlowTapeTickerTokens = (value) =>
  Array.from(
    new Set(
      String(value || "")
        .split(/[\s,]+/)
        .map((token) => normalizeTickerSymbol(token))
        .filter(Boolean),
    ),
  );

export const getFlowTapeEventSymbol = (event) =>
  normalizeTickerSymbol(
    event?.ticker ||
      event?.underlying ||
      event?.underlyingSymbol ||
      event?.rootSymbol ||
      event?.symbol,
  );

export const getFlowTapeEventRight = (event) => {
  const right = String(event?.cp || event?.right || "")
    .trim()
    .toUpperCase();
  if (right === "CALL") return "C";
  if (right === "PUT") return "P";
  return right;
};

const getFlowTapeEventType = (event) =>
  String(event?.type || event?.tradeType || "")
    .trim()
    .toUpperCase();

const getFlowTapeEventPremium = (event) => {
  const premium = Number(event?.premium ?? 0);
  return Number.isFinite(premium) ? premium : 0;
};

const getFlowTapeEventTime = (event) =>
  event?.occurredAt || event?.time || event?.timestamp || "";

export const getFlowTapeEventClusterKey = (event) => {
  const symbol = getFlowTapeEventSymbol(event);
  const right = getFlowTapeEventRight(event);
  const expiration = event?.expirationDate || event?.exp || "";
  const strike = event?.strike ?? "";
  return (
    event?.optionTicker ||
    [symbol, strike, right, expiration].filter(Boolean).join("_")
  );
};

export const buildFlowTapeEventClusters = (events = []) => {
  const clusters = new Map();
  (events || []).forEach((event) => {
    const key = getFlowTapeEventClusterKey(event);
    if (!key) return;
    const time = getFlowTapeEventTime(event);
    const current = clusters.get(key) || {
      count: 0,
      totalPrem: 0,
      ids: [],
      firstTime: time,
      lastTime: time,
    };
    current.count += 1;
    current.totalPrem += getFlowTapeEventPremium(event);
    current.ids.push(event?.id);
    if (!current.firstTime || (time && time < current.firstTime)) {
      current.firstTime = time;
    }
    if (!current.lastTime || (time && time > current.lastTime)) {
      current.lastTime = time;
    }
    clusters.set(key, current);
  });
  return clusters;
};

export const getFlowTapeEventCluster = (event, clusters) => {
  const key = getFlowTapeEventClusterKey(event);
  const cluster = clusters?.get?.(key) || null;
  return cluster && cluster.count >= 2 ? cluster : null;
};

export const flowTapePresetMatches = (
  presetId,
  event,
  clusterFor = () => null,
) => {
  if (!presetId) return true;
  const right = getFlowTapeEventRight(event);
  const side = String(event?.side || "").toUpperCase();
  const type = getFlowTapeEventType(event);
  const premium = getFlowTapeEventPremium(event);
  if (presetId === "ask-calls") {
    return right === "C" && side === "BUY";
  }
  if (presetId === "bid-puts") {
    return right === "P" && side === "SELL";
  }
  if (presetId === "zero-dte") {
    return Number.isFinite(event?.dte) && event.dte <= 1;
  }
  if (presetId === "premium-50k") {
    return premium >= 50_000;
  }
  if (presetId === "premium-250k") {
    return premium >= 250_000;
  }
  if (presetId === "vol-oi") {
    return Boolean(event?.isUnusual) || (event?.unusualScore || 0) >= 1;
  }
  if (presetId === "sweeps") return type === "SWEEP";
  if (presetId === "blocks") return type === "BLOCK";
  if (presetId === "repeats") return clusterFor(event) !== null;
  if (presetId === "golden") return Boolean(event?.golden);
  return true;
};

export const flowTapeEventMatchesFilters = (
  event,
  filters = DEFAULT_FLOW_TAPE_FILTER_STATE,
  {
    includeTokens = parseFlowTapeTickerTokens(filters?.includeQuery),
    excludeTokens = parseFlowTapeTickerTokens(filters?.excludeQuery),
    clusterFor = () => null,
  } = {},
) => {
  const resolved = normalizeFlowTapeFilterState(filters);
  const ticker = getFlowTapeEventSymbol(event);
  const right = getFlowTapeEventRight(event);
  const type = getFlowTapeEventType(event);

  if (includeTokens.length && !includeTokens.includes(ticker)) return false;
  if (excludeTokens.includes(ticker)) return false;
  if (resolved.filter === "calls" && right !== "C") return false;
  if (resolved.filter === "puts" && right !== "P") return false;
  if (resolved.filter === "unusual" && !event?.isUnusual) return false;
  if (resolved.filter === "golden" && !event?.golden) return false;
  if (resolved.filter === "sweep" && type !== "SWEEP") return false;
  if (resolved.filter === "block" && type !== "BLOCK") return false;
  if (resolved.filter === "cluster" && clusterFor(event) === null) return false;
  if (!flowTapePresetMatches(resolved.activeFlowPresetId, event, clusterFor)) {
    return false;
  }
  return getFlowTapeEventPremium(event) >= resolved.minPrem;
};

export const filterFlowTapeEvents = (
  events = [],
  filters = DEFAULT_FLOW_TAPE_FILTER_STATE,
  { clusterFor } = {},
) => {
  const resolved = normalizeFlowTapeFilterState(filters);
  const includeTokens = parseFlowTapeTickerTokens(resolved.includeQuery);
  const excludeTokens = parseFlowTapeTickerTokens(resolved.excludeQuery);
  const clusters = clusterFor ? null : buildFlowTapeEventClusters(events);
  const resolveCluster =
    clusterFor || ((event) => getFlowTapeEventCluster(event, clusters));

  return (events || []).filter((event) =>
    flowTapeEventMatchesFilters(event, resolved, {
      includeTokens,
      excludeTokens,
      clusterFor: resolveCluster,
    }),
  );
};

export const flowTapeFiltersAreActive = (filters = DEFAULT_FLOW_TAPE_FILTER_STATE) => {
  const resolved = normalizeFlowTapeFilterState(filters);
  return Boolean(
    resolved.activeFlowPresetId ||
      resolved.filter !== "all" ||
      resolved.minPrem > 0 ||
      resolved.includeQuery.trim() ||
      resolved.excludeQuery.trim(),
  );
};

export const normalizeFlowTapeFilterState = (value = {}) => {
  const input = value && typeof value === "object" ? value : {};
  const filter = FLOW_TAPE_FILTER_IDS.has(input.filter) ? input.filter : "all";
  const activeFlowPresetId = FLOW_BUILT_IN_PRESET_IDS.has(
    input.activeFlowPresetId,
  )
    ? input.activeFlowPresetId
    : null;

  return {
    ...DEFAULT_FLOW_TAPE_FILTER_STATE,
    activeFlowPresetId,
    filter,
    minPrem: normalizeMinPremium(input.minPrem),
    includeQuery: normalizeOptionalString(input.includeQuery),
    excludeQuery: normalizeOptionalString(input.excludeQuery),
  };
};

const readInitialFlowTapeFilterState = () => {
  const persisted = readPersistedState();
  return normalizeFlowTapeFilterState({
    activeFlowPresetId: persisted.flowActivePresetId,
    filter: persisted.flowFilter,
    minPrem: persisted.flowMinPrem,
    includeQuery: persisted.flowIncludeQuery,
    excludeQuery: persisted.flowExcludeQuery,
  });
};

const listeners = new Set();
let version = 0;
let flowTapeFilterState = readInitialFlowTapeFilterState();

const getFlowTapeFilterVersion = () => version;

const subscribeToFlowTapeFilterState = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notifyFlowTapeFilterListeners = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

export const getFlowTapeFilterState = () => flowTapeFilterState;

export const setFlowTapeFilterState = (patch = {}) => {
  const next = normalizeFlowTapeFilterState({
    ...flowTapeFilterState,
    ...(patch || {}),
  });

  if (JSON.stringify(next) === JSON.stringify(flowTapeFilterState)) {
    return flowTapeFilterState;
  }

  flowTapeFilterState = next;
  persistFlowTapeFilterState(next);
  notifyFlowTapeFilterListeners();
  return next;
};

export const resetFlowTapeFilterStateForTests = (
  state = DEFAULT_FLOW_TAPE_FILTER_STATE,
) => {
  flowTapeFilterState = normalizeFlowTapeFilterState(state);
  notifyFlowTapeFilterListeners();
};

export const getFlowBuiltInPreset = (presetId) =>
  FLOW_BUILT_IN_PRESETS.find((preset) => preset.id === presetId) || null;

export const buildFlowTapePresetPatch = (presetId, currentState) => {
  const current = normalizeFlowTapeFilterState(currentState);
  const preset = getFlowBuiltInPreset(presetId);
  if (!preset) {
    return { activeFlowPresetId: null };
  }
  if (current.activeFlowPresetId === preset.id) {
    return { activeFlowPresetId: null };
  }
  return {
    activeFlowPresetId: preset.id,
    filter: preset.filter || "all",
    minPrem: Number.isFinite(preset.minPrem) ? preset.minPrem : current.minPrem,
  };
};

export const useFlowTapeFilterState = ({ subscribe = true } = {}) => {
  useSyncExternalStore(
    subscribe ? subscribeToFlowTapeFilterState : () => () => {},
    subscribe ? getFlowTapeFilterVersion : () => 0,
    () => 0,
  );

  return getFlowTapeFilterState();
};
