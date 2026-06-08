import { useCallback, useEffect, useRef, useState } from "react";
import { platformJsonRequest } from "./platformJsonRequest";

const normalizeLineUsageDetail = (value) =>
  value === "full" ? "full" : "compact";

const readLineUsageSnapshot = (detail = "compact") =>
  platformJsonRequest(
    `/api/settings/ibkr-line-usage?detail=${encodeURIComponent(
      normalizeLineUsageDetail(detail),
    )}`,
  );

export const useIbkrLineUsageSnapshot = ({
  enabled = true,
  lineUsageSnapshot = null,
  lineUsageStreamEnabled = true,
  lineUsagePollInterval = 2_000,
  lineUsageDetail = "compact",
} = {}) => {
  const active = Boolean(enabled);
  const [streamedLineUsage, setStreamedLineUsage] = useState(lineUsageSnapshot);
  const [lineUsageError, setLineUsageError] = useState(null);
  const lineUsageRequestRef = useRef(null);
  const effectiveLineUsage = lineUsageSnapshot || streamedLineUsage || null;

  const reload = useCallback(() => {
    if (!active || lineUsageSnapshot) {
      return Promise.resolve(lineUsageSnapshot || null);
    }
    if (lineUsageRequestRef.current) {
      return lineUsageRequestRef.current;
    }
    const request = readLineUsageSnapshot(lineUsageDetail)
      .then((payload) => {
        setStreamedLineUsage(payload);
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
  }, [active, lineUsageDetail, lineUsageSnapshot]);

  useEffect(() => {
    setStreamedLineUsage(lineUsageSnapshot ?? null);
  }, [lineUsageSnapshot]);

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
        normalizeLineUsageDetail(lineUsageDetail),
      )}`,
    );
    source.addEventListener("ibkr-line-usage", (event) => {
      try {
        setStreamedLineUsage(JSON.parse(event.data));
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
    lineUsageDetail,
    lineUsagePollInterval,
    lineUsageSnapshot,
    lineUsageStreamEnabled,
    reload,
  ]);

  return {
    lineUsageSnapshot: effectiveLineUsage,
    loading: active && !effectiveLineUsage && !lineUsageSnapshot,
    error: lineUsageError,
    reload,
  };
};
