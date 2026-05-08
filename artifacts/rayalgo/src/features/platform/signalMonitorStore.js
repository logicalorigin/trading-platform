import { useMemo, useSyncExternalStore } from "react";
import { isSignalMonitorDegradedProfile } from "./signalMonitorStatusModel";

const EMPTY_SIGNAL_MONITOR_SNAPSHOT = Object.freeze({
  profile: null,
  states: Object.freeze([]),
  events: Object.freeze([]),
  pending: false,
  degraded: false,
});

const globalListeners = new Set();
const symbolListeners = new Map();
const symbolVersions = new Map();
let snapshotVersion = 0;
let signalMonitorSnapshot = EMPTY_SIGNAL_MONITOR_SNAPSHOT;
let signalStatesBySymbol = Object.freeze({});

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

const areSignalStatesEquivalent = (left, right) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.symbol === right.symbol &&
    left.timeframe === right.timeframe &&
    left.currentSignalDirection === right.currentSignalDirection &&
    left.barsSinceSignal === right.barsSinceSignal &&
    left.fresh === right.fresh &&
    left.status === right.status &&
    String(left.lastEvaluatedAt || "") === String(right.lastEvaluatedAt || "")
  );
};

const notifySymbol = (symbol) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  symbolVersions.set(normalized, (symbolVersions.get(normalized) ?? 0) + 1);
  Array.from(symbolListeners.get(normalized) || []).forEach((listener) => listener());
};

export const publishSignalMonitorSnapshot = (nextSnapshot) => {
  const degraded = Boolean(
    nextSnapshot?.degraded ||
      isSignalMonitorDegradedProfile(nextSnapshot?.profile),
  );
  const nextStates =
    degraded && !(nextSnapshot?.states || []).length
      ? signalMonitorSnapshot.states
      : nextSnapshot?.states || EMPTY_SIGNAL_MONITOR_SNAPSHOT.states;
  const nextEvents =
    degraded && !(nextSnapshot?.events || []).length
      ? signalMonitorSnapshot.events
      : nextSnapshot?.events || EMPTY_SIGNAL_MONITOR_SNAPSHOT.events;
  const normalizedStates = {};
  nextStates.forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    if (symbol) {
      normalizedStates[symbol] = state;
    }
  });

  const changedSymbols = new Set();
  const previousSymbols = Object.keys(signalStatesBySymbol);
  const nextSymbols = Object.keys(normalizedStates);
  previousSymbols.forEach((symbol) => {
    if (!areSignalStatesEquivalent(signalStatesBySymbol[symbol], normalizedStates[symbol])) {
      changedSymbols.add(symbol);
    }
  });
  nextSymbols.forEach((symbol) => {
    if (!areSignalStatesEquivalent(signalStatesBySymbol[symbol], normalizedStates[symbol])) {
      changedSymbols.add(symbol);
    }
  });

  signalMonitorSnapshot = nextSnapshot
    ? {
        profile: nextSnapshot.profile || null,
        states: nextStates,
        events: nextEvents,
        pending: Boolean(nextSnapshot.pending),
        degraded,
      }
    : EMPTY_SIGNAL_MONITOR_SNAPSHOT;
  signalStatesBySymbol = normalizedStates;
  snapshotVersion += 1;
  globalListeners.forEach((listener) => listener());
  changedSymbols.forEach((symbol) => notifySymbol(symbol));
};

const subscribe = (listener) => {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
};

const subscribeSymbol = (symbol, listener) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return () => {};
  }
  const listeners = symbolListeners.get(normalized) || new Set();
  listeners.add(listener);
  symbolListeners.set(normalized, listeners);
  return () => {
    const current = symbolListeners.get(normalized);
    current?.delete(listener);
    if (current && current.size === 0) {
      symbolListeners.delete(normalized);
    }
  };
};

const getSnapshotVersion = () => snapshotVersion;

const getSignalStateForSymbol = (symbol) =>
  signalStatesBySymbol[normalizeSymbol(symbol)] || null;

const getSignalStateVersionForSymbol = (symbol) =>
  symbolVersions.get(normalizeSymbol(symbol)) ?? 0;

export const useSignalMonitorSnapshot = ({ subscribeToUpdates = true } = {}) => {
  useSyncExternalStore(
    subscribeToUpdates ? subscribe : () => () => {},
    subscribeToUpdates ? getSnapshotVersion : () => 0,
    () => 0,
  );
  return signalMonitorSnapshot;
};

export const useSignalMonitorStateForSymbol = (
  symbol,
  { subscribeToUpdates = true } = {},
) => {
  const normalizedSymbol = useMemo(() => normalizeSymbol(symbol), [symbol]);
  useSyncExternalStore(
    subscribeToUpdates
      ? (listener) => subscribeSymbol(normalizedSymbol, listener)
      : () => () => {},
    subscribeToUpdates
      ? () => getSignalStateVersionForSymbol(normalizedSymbol)
      : () => 0,
    () => 0,
  );
  return getSignalStateForSymbol(normalizedSymbol);
};
