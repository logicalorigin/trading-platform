import { useSyncExternalStore } from "react";
import type { MarketBar } from "./types";

type ActiveChartBarState = {
  historicalBars: MarketBar[];
  hasExhaustedOlderHistory: boolean;
  updatedAt: number;
  version: number;
};

type ActiveChartBarEntry = {
  state: ActiveChartBarState;
  listeners: Set<() => void>;
};

const MAX_ACTIVE_CHART_BAR_SCOPES = 24;
const activeChartBarEntries = new Map<string, ActiveChartBarEntry>();

const EMPTY_ACTIVE_CHART_BAR_STATE: ActiveChartBarState = {
  historicalBars: [],
  hasExhaustedOlderHistory: false,
  updatedAt: 0,
  version: 0,
};

const ensureActiveChartBarEntry = (scopeKey: string): ActiveChartBarEntry => {
  const existing = activeChartBarEntries.get(scopeKey);
  if (existing) {
    return existing;
  }

  const created: ActiveChartBarEntry = {
    state: EMPTY_ACTIVE_CHART_BAR_STATE,
    listeners: new Set(),
  };
  activeChartBarEntries.set(scopeKey, created);
  return created;
};

const pruneInactiveChartBarEntries = () => {
  if (activeChartBarEntries.size <= MAX_ACTIVE_CHART_BAR_SCOPES) {
    return;
  }

  const removableEntries = Array.from(activeChartBarEntries.entries())
    .filter(([, entry]) => entry.listeners.size === 0)
    .sort((left, right) => left[1].state.updatedAt - right[1].state.updatedAt);

  while (
    activeChartBarEntries.size > MAX_ACTIVE_CHART_BAR_SCOPES &&
    removableEntries.length
  ) {
    const [scopeKey] = removableEntries.shift() || [];
    if (!scopeKey) {
      break;
    }
    activeChartBarEntries.delete(scopeKey);
  }
};

const emitScopeChange = (scopeKey: string) => {
  const entry = activeChartBarEntries.get(scopeKey);
  if (!entry) {
    return;
  }

  Array.from(entry.listeners).forEach((listener) => listener());
};

export const updateActiveChartBarState = (
  scopeKey: string,
  updater: (current: ActiveChartBarState) => ActiveChartBarState,
): ActiveChartBarState => {
  const normalizedScopeKey = scopeKey.trim();
  if (!normalizedScopeKey) {
    return EMPTY_ACTIVE_CHART_BAR_STATE;
  }

  const entry = ensureActiveChartBarEntry(normalizedScopeKey);
  const nextState = updater(entry.state);
  if (nextState === entry.state) {
    return entry.state;
  }

  entry.state = {
    ...nextState,
    updatedAt: Date.now(),
    version: entry.state.version + 1,
  };
  emitScopeChange(normalizedScopeKey);
  pruneInactiveChartBarEntries();
  return entry.state;
};

export const clearActiveChartBarState = (scopeKey?: string | null) => {
  if (!scopeKey?.trim()) {
    return;
  }

  const normalizedScopeKey = scopeKey.trim();
  const entry = activeChartBarEntries.get(normalizedScopeKey);
  if (!entry) {
    return;
  }

  entry.state = {
    ...EMPTY_ACTIVE_CHART_BAR_STATE,
    updatedAt: Date.now(),
    version: entry.state.version + 1,
  };
  emitScopeChange(normalizedScopeKey);
};

const subscribeToActiveChartBarState = (
  scopeKey: string,
  listener: () => void,
) => {
  const normalizedScopeKey = scopeKey.trim();
  if (!normalizedScopeKey) {
    return () => {};
  }

  const entry = ensureActiveChartBarEntry(normalizedScopeKey);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

const getActiveChartBarStateSnapshot = (
  scopeKey?: string | null,
): ActiveChartBarState => {
  if (!scopeKey?.trim()) {
    return EMPTY_ACTIVE_CHART_BAR_STATE;
  }

  return ensureActiveChartBarEntry(scopeKey.trim()).state;
};

export const useActiveChartBarState = (
  scopeKey?: string | null,
): ActiveChartBarState => {
  const normalizedScopeKey = scopeKey?.trim() || "";
  useSyncExternalStore(
    (listener) => subscribeToActiveChartBarState(normalizedScopeKey, listener),
    () => getActiveChartBarStateSnapshot(normalizedScopeKey).version,
    () => 0,
  );

  return getActiveChartBarStateSnapshot(normalizedScopeKey);
};
