import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRuntimeDiagnostics } from "@workspace/api-client-react";
import {
  IBKR_LINE_USAGE_FALLBACK_POLL_INTERVAL_MS,
  useIbkrLineUsageSnapshot,
} from "./useIbkrLineUsageSnapshot.js";
import { useBrokerStreamFreshnessSnapshot } from "./live-streams";
import { useFlowScannerControlState } from "./marketFlowStore";
import { buildRuntimeControlSnapshot } from "./runtimeControlModel.js";

const RUNTIME_DIAGNOSTICS_COMPACT_HEADERS = {
  "x-pyrus-diagnostics-detail": "compact",
};

const readRuntimeDiagnosticsSnapshot = (signal) =>
  getRuntimeDiagnostics({
    ...(signal ? { signal } : {}),
    headers: RUNTIME_DIAGNOSTICS_COMPACT_HEADERS,
  });

export const useRuntimeControlSnapshot = ({
  enabled = true,
  runtimeDiagnostics = null,
  runtimeDiagnosticsEnabled = true,
  runtimeDiagnosticsQueryKey = "runtime-control",
  runtimeDiagnosticsRefetchInterval = 5_000,
  lineUsageSnapshot = null,
  lineUsageEnabled = true,
  lineUsageStreamEnabled = true,
  lineUsagePollInterval = IBKR_LINE_USAGE_FALLBACK_POLL_INTERVAL_MS,
  lineUsageDetail = "compact",
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
    queryFn: ({ signal }) => readRuntimeDiagnosticsSnapshot(signal),
    enabled: shouldFetchRuntimeDiagnostics,
    refetchInterval: shouldFetchRuntimeDiagnostics
      ? runtimeDiagnosticsRefetchInterval
      : false,
    placeholderData: (previousData) => previousData,
    retry: false,
    staleTime: Math.min(2_000, runtimeDiagnosticsRefetchInterval),
  });

  const {
    lineUsageSnapshot: effectiveLineUsage,
    loading: lineUsageLoading,
    error: lineUsageError,
    reload: reloadLineUsage,
  } = useIbkrLineUsageSnapshot({
    enabled: active && lineUsageEnabled,
    lineUsageSnapshot,
    lineUsageStreamEnabled,
    lineUsagePollInterval,
    lineUsageDetail,
  });

  const brokerStreamFreshness = useBrokerStreamFreshnessSnapshot(active);
  const flowScannerControl = useFlowScannerControlState({ subscribe: active });
  const effectiveRuntimeDiagnostics =
    runtimeDiagnostics || runtimeDiagnosticsQuery.data || null;
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
      pending.push(reloadLineUsage().catch(() => null));
    }
    return Promise.all(pending);
  }, [
    active,
    lineUsageEnabled,
    lineUsageSnapshot,
    reloadLineUsage,
    runtimeDiagnosticsQuery,
    shouldFetchRuntimeDiagnostics,
  ]);

  return {
    snapshot,
    lineUsage: snapshot.lineUsage,
    streams: snapshot.streams,
    flowScanner: snapshot.flowScanner,
    runtimeDiagnostics: effectiveRuntimeDiagnostics,
    lineUsageSnapshot: effectiveLineUsage,
    loading:
      runtimeDiagnosticsQuery.isLoading ||
      lineUsageLoading,
    runtimeError: runtimeDiagnosticsQuery.error || null,
    lineUsageError,
    error: runtimeDiagnosticsQuery.error || lineUsageError,
    reload,
  };
};
