import { useSyncExternalStore } from "react";

const EMPTY_MARKET_ALERTS_SNAPSHOT = Object.freeze({
  items: Object.freeze([]),
  totalAlerts: 0,
  winAlerts: 0,
  lossAlerts: 0,
});

const listeners = new Set();
let version = 0;
let snapshot = EMPTY_MARKET_ALERTS_SNAPSHOT;

const areAlertItemsEquivalent = (left = [], right = []) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem?.id !== rightItem?.id ||
      leftItem?.symbol !== rightItem?.symbol ||
      leftItem?.label !== rightItem?.label ||
      leftItem?.detail !== rightItem?.detail ||
      leftItem?.tone !== rightItem?.tone
    ) {
      return false;
    }
  }
  return true;
};

export const publishMarketAlertsSnapshot = (nextSnapshot) => {
  const normalized = nextSnapshot
    ? {
        items: nextSnapshot.items || EMPTY_MARKET_ALERTS_SNAPSHOT.items,
        totalAlerts: Number.isFinite(nextSnapshot.totalAlerts)
          ? nextSnapshot.totalAlerts
          : 0,
        winAlerts: Number.isFinite(nextSnapshot.winAlerts)
          ? nextSnapshot.winAlerts
          : 0,
        lossAlerts: Number.isFinite(nextSnapshot.lossAlerts)
          ? nextSnapshot.lossAlerts
          : 0,
      }
    : EMPTY_MARKET_ALERTS_SNAPSHOT;

  if (
    areAlertItemsEquivalent(snapshot.items, normalized.items) &&
    snapshot.totalAlerts === normalized.totalAlerts &&
    snapshot.winAlerts === normalized.winAlerts &&
    snapshot.lossAlerts === normalized.lossAlerts
  ) {
    return;
  }

  snapshot = normalized;
  version += 1;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getVersion = () => version;

export const useMarketAlertsSnapshot = ({ subscribeToUpdates = true } = {}) => {
  useSyncExternalStore(
    subscribeToUpdates ? subscribe : () => () => {},
    subscribeToUpdates ? getVersion : () => 0,
    () => 0,
  );
  return snapshot;
};
