import { useSyncExternalStore } from "react";

const INITIAL_SNAPSHOT = {
  transitioning: false,
  targetSection: null,
};

let snapshot = INITIAL_SNAPSHOT;
let version = 0;
const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshotVersion = () => version;

const notify = () => {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
};

export const getAccountSectionTransitionSnapshot = () => snapshot;

export const setAccountSectionTransitionSnapshot = (next = INITIAL_SNAPSHOT) => {
  const transitioning = Boolean(next.transitioning);
  const targetSection =
    next.targetSection === "real" || next.targetSection === "shadow"
      ? next.targetSection
      : null;
  snapshot = {
    transitioning,
    targetSection: transitioning ? targetSection : null,
  };
  notify();
};

export const useAccountSectionTransitionSnapshot = () => {
  const token = useSyncExternalStore(subscribe, getSnapshotVersion, () => 0);
  return { ...snapshot, version: token };
};
