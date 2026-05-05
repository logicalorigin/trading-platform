import { useSyncExternalStore } from "react";
import { RAYALGO_STORAGE_KEY } from "../../lib/uiTokens";

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
  { id: "momentum", label: "Momentum", sortBy: "score" },
  { id: "earnings-week", label: "Earnings Wk", sortBy: "premium" },
  { id: "unusual-calls", label: "Unusual Calls", filter: "unusual", sortBy: "premium" },
  { id: "unusual-puts", label: "Unusual Puts", filter: "unusual", sortBy: "premium" },
  { id: "high-rvol", label: "High RelVol", sortBy: "ratio" },
  { id: "held-positions", label: "Held Pos", sortBy: "premium" },
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

const normalizeFlowPresetSymbol = (value) =>
  value?.trim?.().toUpperCase?.() || "";

const normalizeFlowPresetSymbolSet = (symbols = []) =>
  new Set(
    (Array.isArray(symbols) ? symbols : Array.from(symbols || []))
      .map((symbol) => normalizeFlowPresetSymbol(symbol))
      .filter(Boolean),
  );

const getFlowPresetEventTicker = (event) =>
  normalizeFlowPresetSymbol(
    event?.ticker ||
      event?.underlying ||
      event?.underlyingSymbol ||
      event?.symbol ||
      "",
  );

const normalizeMinPremium = (value) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
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

const flowOptionRight = (event) => {
  const raw = String(event?.cp || event?.right || "").toUpperCase();
  if (raw.startsWith("P")) return "P";
  if (raw.startsWith("C")) return "C";
  return "";
};

const hasEarningsWeekSignal = (event) =>
  Boolean(
    event?.earningsSoon ||
      event?.earningsThisWeek ||
      event?.hasEarningsThisWeek ||
      event?.earningsWithinDays <= 7 ||
      event?.calendarEventType === "earnings",
  );

const hasHeldPositionSignal = (event) =>
  Boolean(
    event?.heldPosition ||
      event?.hasOpenPosition ||
      event?.positionOpen ||
      event?.positionQuantity,
  );

export const decorateFlowEventsWithPresetContext = (
  events = [],
  { earningsSymbols = [], positionSymbols = [] } = {},
) => {
  const earningsSet = normalizeFlowPresetSymbolSet(earningsSymbols);
  const positionSet = normalizeFlowPresetSymbolSet(positionSymbols);
  if (!earningsSet.size && !positionSet.size) {
    return Array.isArray(events) ? events : [];
  }

  return (Array.isArray(events) ? events : []).map((event) => {
    const ticker = getFlowPresetEventTicker(event);
    if (!ticker) return event;
    const patch = {};
    if (earningsSet.has(ticker) && !hasEarningsWeekSignal(event)) {
      patch.earningsSoon = true;
      patch.earningsWithinDays = 7;
    }
    if (positionSet.has(ticker) && !hasHeldPositionSignal(event)) {
      patch.heldPosition = true;
    }
    return Object.keys(patch).length ? { ...event, ...patch } : event;
  });
};

export const flowEventMatchesBuiltInPreset = (
  presetId,
  event,
  clusterFor = () => null,
) => {
  if (!presetId) return true;
  const right = flowOptionRight(event);
  const side = String(event?.side || "").toUpperCase();
  if (presetId === "momentum") {
    return Boolean(event?.golden) || Number(event?.score || 0) >= 75;
  }
  if (presetId === "earnings-week") {
    return hasEarningsWeekSignal(event);
  }
  if (presetId === "unusual-calls") {
    return right === "C" && Boolean(event?.isUnusual);
  }
  if (presetId === "unusual-puts") {
    return right === "P" && Boolean(event?.isUnusual);
  }
  if (presetId === "high-rvol") {
    return Boolean(event?.isUnusual) || Number(event?.unusualScore || 0) >= 1;
  }
  if (presetId === "held-positions") {
    return hasHeldPositionSignal(event);
  }
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
    return Number(event?.premium || 0) >= 50_000;
  }
  if (presetId === "premium-250k") {
    return Number(event?.premium || 0) >= 250_000;
  }
  if (presetId === "vol-oi") {
    return Boolean(event?.isUnusual) || Number(event?.unusualScore || 0) >= 1;
  }
  if (presetId === "sweeps") return event?.type === "SWEEP";
  if (presetId === "blocks") return event?.type === "BLOCK";
  if (presetId === "repeats") return clusterFor(event) !== null;
  if (presetId === "golden") return Boolean(event?.golden);
  return true;
};

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
