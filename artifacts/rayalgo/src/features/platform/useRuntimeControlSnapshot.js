import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBrokerStreamFreshnessSnapshot } from "./live-streams";
import { useFlowScannerControlState } from "./marketFlowStore";
import { platformJsonRequest } from "./platformJsonRequest";
import { buildRuntimeControlSnapshot } from "./runtimeControlModel.js";

const readLineUsageSnapshot = () =>
  platformJsonRequest("/api/settings/ibkr-line-usage", { timeoutMs: 3_000 });

export const useRuntimeControlSnapshot = ({
  enabled = true,
  runtimeDiagnostics = null,
  runtimeDiagnosticsEnabled = true,
  runtimeDiagnosticsQueryKey = "runtime-control",
  runtimeDiagnosticsRefetchInterval = 5_000,
  lineUsageSnapshot = null,
  lineUsageEnabled = true,
  lineUsageStreamEnabled = true,
  lineUsagePollInterval = 2_000,
  workloadStats = null,
  hydrationStats = null,
  memoryPressure = null,
} = {}) => {
  const active = Boolean(enabled);
  const shouldFetchRuntimeDiagnostics = Boolean(
    active && runtimeDiagnosticsEnabled && !runtimeDiagnostics,
  );
  const runtimeDiagnosticsQuery = useQuery({
    queryKey: ["platform-runtime-diagnostics", runtimeDiagnosticsQueryKey],
    queryFn: () =>
      platformJsonRequest("/api/diagnostics/runtime", { timeoutMs: 6_500 }),
    enabled: shouldFetchRuntimeDiagnostics,
    refetchInterval: shouldFetchRuntimeDiagnostics
      ? runtimeDiagnosticsRefetchInterval
      : false,
    placeholderData: (previousData) => previousData,
    retry: false,
    staleTime: Math.min(2_000, runtimeDiagnosticsRefetchInterval),
  });

  const [streamedLineUsage, setStreamedLineUsage] = useState(lineUsageSnapshot);
  const [lineUsageError, setLineUsageError] = useState(null);
  const refreshLineUsage = useCallback(() => {
    if (!active || !lineUsageEnabled) {
      return Promise.resolve(null);
    }
    return readLineUsageSnapshot()
      .then((payload) => {
        setStreamedLineUsage(payload);
        setLineUsageError(null);
        return payload;
      })
      .catch((error) => {
        setLineUsageError(error);
        throw error;
      });
  }, [active, lineUsageEnabled]);

  useEffect(() => {
    setStreamedLineUsage(lineUsageSnapshot ?? null);
  }, [lineUsageSnapshot]);

  useEffect(() => {
    if (!active || !lineUsageEnabled || lineUsageSnapshot) {
      return undefined;
    }

    if (
      !lineUsageStreamEnabled ||
      typeof window === "undefined" ||
      typeof window.EventSource !== "function"
    ) {
      let cancelled = false;
      const load = () => {
        refreshLineUsage().catch(() => {});
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

    const source = new window.EventSource("/api/settings/ibkr-line-usage/stream");
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
    lineUsageEnabled,
    lineUsagePollInterval,
    lineUsageStreamEnabled,
    lineUsageSnapshot,
    refreshLineUsage,
  ]);

  const brokerStreamFreshness = useBrokerStreamFreshnessSnapshot(active);
  const flowScannerControl = useFlowScannerControlState({ subscribe: active });
  const effectiveRuntimeDiagnostics =
    runtimeDiagnostics || runtimeDiagnosticsQuery.data || null;
  const effectiveLineUsage = lineUsageSnapshot || streamedLineUsage || null;
  const snapshot = useMemo(
    () =>
      buildRuntimeControlSnapshot({
        runtimeDiagnostics: effectiveRuntimeDiagnostics,
        lineUsageSnapshot: effectiveLineUsage,
        brokerStreamFreshness,
        flowScannerControl,
        workloadStats,
        hydrationStats,
        memoryPressure,
      }),
    [
      brokerStreamFreshness,
      effectiveLineUsage,
      effectiveRuntimeDiagnostics,
      flowScannerControl,
      hydrationStats,
      memoryPressure,
      workloadStats,
    ],
  );

  const reload = useCallback(() => {
    const pending = [];
    if (shouldFetchRuntimeDiagnostics) {
      pending.push(runtimeDiagnosticsQuery.refetch());
    }
    if (active && lineUsageEnabled && !lineUsageSnapshot) {
      pending.push(refreshLineUsage().catch(() => null));
    }
    return Promise.all(pending);
  }, [
    active,
    lineUsageEnabled,
    lineUsageSnapshot,
    refreshLineUsage,
    runtimeDiagnosticsQuery,
    shouldFetchRuntimeDiagnostics,
  ]);

  return {
    snapshot,
    lineUsage: snapshot.lineUsage,
    bridgeGovernor: snapshot.bridgeGovernor,
    streams: snapshot.streams,
    flowScanner: snapshot.flowScanner,
    runtimeDiagnostics: effectiveRuntimeDiagnostics,
    lineUsageSnapshot: effectiveLineUsage,
    loading:
      runtimeDiagnosticsQuery.isLoading ||
      (active && lineUsageEnabled && !effectiveLineUsage && !lineUsageSnapshot),
    runtimeError: runtimeDiagnosticsQuery.error || null,
    lineUsageError,
    error: runtimeDiagnosticsQuery.error || lineUsageError,
    reload,
  };
};
