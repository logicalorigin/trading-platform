import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRuntimeDiagnostics } from "@workspace/api-client-react";
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
    retry: false,
    staleTime: Math.min(2_000, runtimeDiagnosticsRefetchInterval),
  });

  const brokerStreamFreshness = useBrokerStreamFreshnessSnapshot(active);
  const flowScannerControl = useFlowScannerControlState({ subscribe: active });
  const effectiveRuntimeDiagnostics =
    runtimeDiagnostics ||
    (runtimeDiagnosticsQuery.isError ? null : runtimeDiagnosticsQuery.data) ||
    null;
  const snapshot = useMemo(
    () =>
      buildRuntimeControlSnapshot({
        runtimeDiagnostics: effectiveRuntimeDiagnostics,
        brokerStreamFreshness,
        flowScannerControl,
        workloadStats,
        hydrationStats,
        memoryPressure,
      }),
    [
      brokerStreamFreshness,
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
    return Promise.all(pending);
  }, [
    runtimeDiagnosticsQuery,
    shouldFetchRuntimeDiagnostics,
  ]);

  return {
    snapshot,
    streams: snapshot.streams,
    flowScanner: snapshot.flowScanner,
    runtimeDiagnostics: effectiveRuntimeDiagnostics,
    loading: runtimeDiagnosticsQuery.isLoading,
    runtimeError: runtimeDiagnosticsQuery.error || null,
    error: runtimeDiagnosticsQuery.error || null,
    reload,
  };
};
