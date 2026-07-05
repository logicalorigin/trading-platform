import { useMemo, useSyncExternalStore } from "react";
import { isSignalMonitorDegradedProfile } from "./signalMonitorStatusModel";

const EMPTY_SIGNAL_MONITOR_SNAPSHOT = Object.freeze({
  profile: null,
  states: Object.freeze([]),
  events: Object.freeze([]),
  universe: null,
  pending: false,
  degraded: false,
  // Transport surface (set by the stream consumer + query wiring in the host).
  // Distinct from `degraded`, which is derived purely from profile content:
  // - transportError: hard transport failure (e.g. matrix SSE repeatedly dead).
  // - rateLimited: request pacing / 429 — amber, retrying.
  // - streamErrored: we cannot confirm the real state (e.g. profile fetch
  //   itself failed), so surface uncertainty rather than a neutral OFF.
  transportError: false,
  rateLimited: false,
  streamErrored: false,
});

const globalListeners = new Set();
const symbolListeners = new Map();
const symbolVersions = new Map();
let snapshotVersion = 0;
let signalMonitorSnapshot = EMPTY_SIGNAL_MONITOR_SNAPSHOT;
let signalStatesBySymbol = Object.freeze({});

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";
const normalizeTimeframe = (timeframe) => String(timeframe || "").trim();

const stateTimeMs = (state) =>
  Math.max(
    Date.parse(state?.lastEvaluatedAt || "") || 0,
    Date.parse(state?.currentSignalAt || "") || 0,
    Date.parse(state?.latestBarAt || "") || 0,
  );

export const selectPreferredSignalMonitorState = (
  current,
  candidate,
  preferredTimeframe = "",
) => {
  if (!current) return candidate || null;
  if (!candidate) return current;

  const timeframe = normalizeTimeframe(preferredTimeframe);
  if (timeframe) {
    const currentMatches = normalizeTimeframe(current?.timeframe) === timeframe;
    const candidateMatches = normalizeTimeframe(candidate?.timeframe) === timeframe;
    if (currentMatches !== candidateMatches) {
      return candidateMatches ? candidate : current;
    }
  }

  // Prefer the timeframe the backend marked actionable (replaces the old
  // frontend `fresh` heuristic — actionability is backend-authored).
  if (Boolean(current?.actionEligible) !== Boolean(candidate?.actionEligible)) {
    return candidate?.actionEligible ? candidate : current;
  }

  return stateTimeMs(candidate) >= stateTimeMs(current) ? candidate : current;
};

const areSignalStatesEquivalent = (left, right) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.symbol === right.symbol &&
    left.timeframe === right.timeframe &&
    left.currentSignalDirection === right.currentSignalDirection &&
    // Tape items render trend-first, so a pure trendDirection flip must notify
    // subscribers (mirrors trendDirectionOf in signalMatrixStateMerge.js).
    left.trendDirection === right.trendDirection &&
    (left.indicatorSnapshot?.trendDirection ?? null) ===
      (right.indicatorSnapshot?.trendDirection ?? null) &&
    String(left.currentSignalAt || "") === String(right.currentSignalAt || "") &&
    left.currentSignalPrice === right.currentSignalPrice &&
    left.currentSignalClose === right.currentSignalClose &&
    left.currentSignalMfePercent === right.currentSignalMfePercent &&
    left.currentSignalMaePercent === right.currentSignalMaePercent &&
    areStructuredValuesEquivalent(
      readSignalStateFilterState(left),
      readSignalStateFilterState(right),
    ) &&
    String(left.latestBarAt || "") === String(right.latestBarAt || "") &&
    left.barsSinceSignal === right.barsSinceSignal &&
    left.fresh === right.fresh &&
    left.status === right.status &&
    String(left.lastEvaluatedAt || "") === String(right.lastEvaluatedAt || "")
  );
};

const areSignalStateArraysEquivalent = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((state, index) =>
    areSignalStatesEquivalent(state, right[index]),
  );
};

const areStructuredValuesEquivalent = (left, right) => {
  if (left === right) return true;
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

const readSignalStateFilterState = (state) =>
  state?.filterState ?? state?.indicatorSnapshot?.filterState ?? null;

const areSignalMonitorSnapshotsEquivalent = (left, right) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    Boolean(left.pending) === Boolean(right.pending) &&
    Boolean(left.degraded) === Boolean(right.degraded) &&
    Boolean(left.transportError) === Boolean(right.transportError) &&
    Boolean(left.rateLimited) === Boolean(right.rateLimited) &&
    Boolean(left.streamErrored) === Boolean(right.streamErrored) &&
    areStructuredValuesEquivalent(left.profile, right.profile) &&
    areSignalStateArraysEquivalent(left.states, right.states) &&
    areStructuredValuesEquivalent(left.events, right.events) &&
    areStructuredValuesEquivalent(left.universe, right.universe)
  );
};

const notifySymbol = (symbol) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  if (Object.prototype.hasOwnProperty.call(signalStatesBySymbol, normalized)) {
    symbolVersions.set(normalized, (symbolVersions.get(normalized) ?? 0) + 1);
  } else {
    symbolVersions.delete(normalized);
  }
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
  const preferredTimeframe = normalizeTimeframe(nextSnapshot?.profile?.timeframe);
  nextStates.forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    if (symbol) {
      normalizedStates[symbol] = selectPreferredSignalMonitorState(
        normalizedStates[symbol],
        state,
        preferredTimeframe,
      );
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

  const nextNormalizedSnapshot = nextSnapshot
    ? {
        profile: nextSnapshot.profile || null,
        states: nextStates,
        events: nextEvents,
        universe: nextSnapshot.universe || null,
        pending: Boolean(nextSnapshot.pending),
        degraded,
        transportError: Boolean(nextSnapshot.transportError),
        rateLimited: Boolean(nextSnapshot.rateLimited),
        streamErrored: Boolean(nextSnapshot.streamErrored),
      }
    : EMPTY_SIGNAL_MONITOR_SNAPSHOT;

  const snapshotChanged = !areSignalMonitorSnapshotsEquivalent(
    signalMonitorSnapshot,
    nextNormalizedSnapshot,
  );

  signalMonitorSnapshot = snapshotChanged
    ? nextNormalizedSnapshot
    : signalMonitorSnapshot;
  signalStatesBySymbol = normalizedStates;
  if (snapshotChanged) {
    snapshotVersion += 1;
    globalListeners.forEach((listener) => listener());
  }
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

export const getSignalMonitorSnapshotForTests = () => signalMonitorSnapshot;

export const getSignalMonitorSnapshotVersionForTests = getSnapshotVersion;

export const subscribeToSignalMonitorSnapshotForTests = subscribe;

export const __signalMonitorStoreTestHooks = {
  subscribeSymbol,
  symbolVersion: getSignalStateVersionForSymbol,
  symbolVersionCount: () => symbolVersions.size,
};

export const resetSignalMonitorStoreForTests = () => {
  globalListeners.clear();
  symbolListeners.clear();
  symbolVersions.clear();
  snapshotVersion = 0;
  signalMonitorSnapshot = EMPTY_SIGNAL_MONITOR_SNAPSHOT;
  signalStatesBySymbol = Object.freeze({});
};

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
