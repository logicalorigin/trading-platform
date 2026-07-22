import { useSyncExternalStore } from "react";
import { normalizeBrokerActivityBadges } from "../../components/brand/brokerLogoBubblesModel.js";
import { normalizeToastKind } from "./toastModel.js";

const LAST_READ_STORAGE_PREFIX = "pyrus.notifications.lastReadAt.v2";
const RING_BUFFER_LIMIT = 50;

const listeners = new Set();
const snapshotsByUser = new Map();

const normalizeUserId = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const buildNotificationLastReadStorageKey = (userId) =>
  `${LAST_READ_STORAGE_PREFIX}.${encodeURIComponent(normalizeUserId(userId) || "anonymous")}`;

const readLastReadFromStorage = (userId) => {
  if (!userId || typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage?.getItem(
      buildNotificationLastReadStorageKey(userId),
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const writeLastReadToStorage = (userId, value) => {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(
      buildNotificationLastReadStorageKey(userId),
      String(value),
    );
  } catch {
    /* swallow */
  }
};

let activeUserId = null;
let version = 0;

const createSnapshot = (userId) => ({
  userId,
  toasts: [],
  lastReadAt: readLastReadFromStorage(userId),
  version: ++version,
});

let snapshot = createSnapshot(null);

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
export const getNotificationSnapshot = getSnapshot;

const replaceSnapshot = (next) => {
  snapshot = {
    ...next,
    userId: activeUserId,
    version: ++version,
  };
  if (activeUserId) {
    snapshotsByUser.set(activeUserId, snapshot);
  }
  emit();
};

export const setNotificationUser = (userId) => {
  const nextUserId = normalizeUserId(userId);
  if (nextUserId === activeUserId) return false;

  activeUserId = nextUserId;
  snapshot = nextUserId
    ? snapshotsByUser.get(nextUserId) || createSnapshot(nextUserId)
    : createSnapshot(null);
  emit();
  return true;
};

export const captureToast = (spec) => {
  if (!spec || typeof spec !== "object") return false;
  const userId = normalizeUserId(spec.userId);
  if (!userId || userId !== activeUserId) return false;

  const entry = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: normalizeToastKind(spec.kind),
    title: typeof spec.title === "string" ? spec.title : "",
    body: typeof spec.body === "string" ? spec.body : "",
    brokers: normalizeBrokerActivityBadges(spec.brokers).all,
    timestamp: Date.now(),
  };
  const nextToasts = [entry, ...snapshot.toasts].slice(0, RING_BUFFER_LIMIT);
  replaceSnapshot({ ...snapshot, toasts: nextToasts });
  return true;
};

export const markNotificationsRead = (userId, timestamp = Date.now()) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || normalizedUserId !== activeUserId) return false;

  const now =
    Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  writeLastReadToStorage(normalizedUserId, now);
  replaceSnapshot({ ...snapshot, lastReadAt: now });
  return true;
};

export const useNotificationSnapshot = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const computeUnseenCount = (toasts, lastReadAt) => {
  if (!Array.isArray(toasts) || toasts.length === 0) return 0;
  if (!Number.isFinite(lastReadAt) || lastReadAt <= 0) return toasts.length;
  return toasts.filter((toast) => toast.timestamp > lastReadAt).length;
};
