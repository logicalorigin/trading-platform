import { useSyncExternalStore } from "react";

let activePauseCount = 0;
let pauseExpiresAt = 0;
let expiryTimer = null;
let version = 0;
const listeners = new Set();

const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

const clearExpiryTimer = () => {
  if (expiryTimer != null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
};

const isPaused = () =>
  activePauseCount > 0 && pauseExpiresAt > 0 && Date.now() < pauseExpiresAt;

const scheduleExpiry = () => {
  clearExpiryTimer();
  if (!isPaused()) return;
  expiryTimer = setTimeout(() => {
    activePauseCount = 0;
    pauseExpiresAt = 0;
    emit();
  }, Math.max(0, pauseExpiresAt - Date.now()));
};

export const beginCriticalApiMutationPause = ({ ttlMs = 15_000 } = {}) => {
  activePauseCount += 1;
  pauseExpiresAt = Math.max(pauseExpiresAt, Date.now() + Math.max(1, ttlMs));
  scheduleExpiry();
  emit();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePauseCount = Math.max(0, activePauseCount - 1);
    if (activePauseCount === 0) {
      pauseExpiresAt = 0;
      clearExpiryTimer();
    }
    emit();
  };
};

export const waitForCriticalApiMutationPauseSettle = (delayMs = 300) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, delayMs));
  });

const subscribe = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => {
  void version;
  return isPaused();
};

export const useCriticalApiMutationPause = () =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);
