import { useSyncExternalStore } from "react";

const LAST_READ_STORAGE_KEY = "pyrus.notifications.lastReadAt.v1";
const RING_BUFFER_LIMIT = 50;

const listeners = new Set();

const readLastReadFromStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  try {
    const raw = window.localStorage.getItem(LAST_READ_STORAGE_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const writeLastReadToStorage = (value) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(LAST_READ_STORAGE_KEY, String(value));
  } catch {
    /* swallow */
  }
};

let snapshot = {
  toasts: [],
  lastReadAt: readLastReadFromStorage(),
  version: 0,
};

const emit = () => {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore listener errors */
    }
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => snapshot;

const replaceSnapshot = (next) => {
  snapshot = { ...next, version: snapshot.version + 1 };
  emit();
};

export const captureToast = (spec) => {
  if (!spec || typeof spec !== "object") return;
  const entry = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: typeof spec.kind === "string" ? spec.kind : "info",
    title: typeof spec.title === "string" ? spec.title : "",
    body: typeof spec.body === "string" ? spec.body : "",
    timestamp: Date.now(),
  };
  const nextToasts = [entry, ...snapshot.toasts].slice(0, RING_BUFFER_LIMIT);
  replaceSnapshot({ ...snapshot, toasts: nextToasts });
};

export const markNotificationsRead = () => {
  const now = Date.now();
  writeLastReadToStorage(now);
  replaceSnapshot({ ...snapshot, lastReadAt: now });
};

export const useNotificationSnapshot = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const computeUnseenCount = (toasts, lastReadAt) => {
  if (!Array.isArray(toasts) || toasts.length === 0) return 0;
  if (!Number.isFinite(lastReadAt) || lastReadAt <= 0) return toasts.length;
  return toasts.filter((toast) => toast.timestamp > lastReadAt).length;
};
