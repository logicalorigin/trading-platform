import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { platformJsonRequest } from "./platformJsonRequest";

const normalizeLineUsageDetail = (value) =>
  value === "full" ? "full" : "compact";

export const IBKR_LINE_USAGE_FALLBACK_POLL_INTERVAL_MS = 10_000;

const readLineUsageSnapshot = (detail = "compact") =>
  platformJsonRequest(
    `/api/settings/ibkr-line-usage?detail=${encodeURIComponent(
      normalizeLineUsageDetail(detail),
    )}`,
  );

const sharedLineUsageSnapshots = new Map();
const sharedLineUsageListeners = new Map();

const readSnapshotTimestamp = (snapshot) => {
  const timestamp = snapshot?.updatedAt || snapshot?.admission?.generatedAt;
  const parsed = timestamp ? Date.parse(String(timestamp)) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const getSharedLineUsageSnapshot = (detail = "compact") =>
  sharedLineUsageSnapshots.get(normalizeLineUsageDetail(detail)) || null;

const publishSharedLineUsageSnapshot = (detail = "compact", snapshot = null) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const key = normalizeLineUsageDetail(detail);
  const current = sharedLineUsageSnapshots.get(key) || null;
  const incomingTimestamp = readSnapshotTimestamp(snapshot);
  const currentTimestamp = readSnapshotTimestamp(current);
  if (
    incomingTimestamp !== null &&
    currentTimestamp !== null &&
    incomingTimestamp < currentTimestamp
  ) {
    return;
  }
  sharedLineUsageSnapshots.set(key, snapshot);
  const listeners = sharedLineUsageListeners.get(key);
  if (!listeners) {
    return;
  }
  listeners.forEach((listener) => listener());
};

const subscribeSharedLineUsageSnapshot = (detail = "compact", listener) => {
  const key = normalizeLineUsageDetail(detail);
  let listeners = sharedLineUsageListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    sharedLineUsageListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      sharedLineUsageListeners.delete(key);
    }
  };
};

export const __ibkrLineUsageSnapshotInternalsForTests = {
  getSharedLineUsageSnapshot,
  publishSharedLineUsageSnapshot,
  resetSharedLineUsageSnapshotsForTests() {
    sharedLineUsageSnapshots.clear();
    sharedLineUsageListeners.clear();
  },
};

export const useIbkrLineUsageSnapshot = ({
  enabled = true,
  lineUsageSnapshot = null,
  lineUsageStreamEnabled = true,
  lineUsagePollInterval = IBKR_LINE_USAGE_FALLBACK_POLL_INTERVAL_MS,
  lineUsageDetail = "compact",
} = {}) => {
  const active = Boolean(enabled);
  const normalizedDetail = normalizeLineUsageDetail(lineUsageDetail);
  const [streamedLineUsage, setStreamedLineUsage] = useState(lineUsageSnapshot);
  const [lineUsageError, setLineUsageError] = useState(null);
  const lineUsageRequestRef = useRef(null);
  const sharedLineUsage = useSyncExternalStore(
    useCallback(
      (listener) => subscribeSharedLineUsageSnapshot(normalizedDetail, listener),
      [normalizedDetail],
    ),
    useCallback(
      () => getSharedLineUsageSnapshot(normalizedDetail),
      [normalizedDetail],
    ),
    useCallback(
      () => getSharedLineUsageSnapshot(normalizedDetail),
      [normalizedDetail],
    ),
  );
  const effectiveLineUsage =
    lineUsageSnapshot || sharedLineUsage || streamedLineUsage || null;

  const reload = useCallback(() => {
    if (!active || lineUsageSnapshot) {
      return Promise.resolve(lineUsageSnapshot || null);
    }
    if (lineUsageRequestRef.current) {
      return lineUsageRequestRef.current;
    }
    const request = readLineUsageSnapshot(normalizedDetail)
      .then((payload) => {
        setStreamedLineUsage(payload);
        publishSharedLineUsageSnapshot(normalizedDetail, payload);
        setLineUsageError(null);
        return payload;
      })
      .catch((error) => {
        setLineUsageError(error);
        throw error;
      })
      .finally(() => {
        if (lineUsageRequestRef.current === request) {
          lineUsageRequestRef.current = null;
        }
      });
    lineUsageRequestRef.current = request;
    return request;
  }, [active, normalizedDetail, lineUsageSnapshot]);

  useEffect(() => {
    if (lineUsageSnapshot) {
      publishSharedLineUsageSnapshot(normalizedDetail, lineUsageSnapshot);
    }
    setStreamedLineUsage(lineUsageSnapshot ?? null);
  }, [lineUsageSnapshot, normalizedDetail]);

  useEffect(() => {
    if (!active || lineUsageSnapshot) {
      return undefined;
    }

    if (
      !lineUsageStreamEnabled ||
      typeof window === "undefined" ||
      typeof window.EventSource !== "function"
    ) {
      let cancelled = false;
      const load = () => {
        reload().catch(() => {});
      };
      load();
      const interval = window.setInterval(() => {
        if (!cancelled) load();
      }, lineUsagePollInterval);
      return () => {
        cancelled = true;
        window.clearInterval(interval);
      };
    }

    const source = new window.EventSource(
      `/api/settings/ibkr-line-usage/stream?detail=${encodeURIComponent(
        normalizedDetail,
      )}`,
    );
    source.addEventListener("ibkr-line-usage", (event) => {
      try {
        const payload = JSON.parse(event.data);
        setStreamedLineUsage(payload);
        publishSharedLineUsageSnapshot(normalizedDetail, payload);
        setLineUsageError(null);
      } catch (error) {
        setLineUsageError(error);
      }
    });
    source.addEventListener("error", () => {
      setLineUsageError(new Error("IBKR line usage stream is reconnecting."));
    });
    return () => source.close();
  }, [
    active,
    lineUsagePollInterval,
    lineUsageSnapshot,
    lineUsageStreamEnabled,
    normalizedDetail,
    reload,
  ]);

  return {
    lineUsageSnapshot: effectiveLineUsage,
    loading: active && !effectiveLineUsage && !lineUsageSnapshot,
    error: lineUsageError,
    reload,
  };
};
