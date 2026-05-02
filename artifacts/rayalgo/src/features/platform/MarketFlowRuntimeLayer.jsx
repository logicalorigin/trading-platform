import { memo, useEffect, useMemo } from "react";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  buildMarketFlowStoreKey,
  clearMarketFlowSnapshot,
  publishMarketFlowSnapshot,
  setFlowScannerControlState,
  useFlowScannerControlState,
} from "./marketFlowStore";
import { useLiveMarketFlow } from "./useLiveMarketFlow";

export const SharedMarketFlowRuntime = memo(({
  symbols = [],
  enabled = true,
  intervalMs = 10_000,
}) => {
  const storeKey = useMemo(() => buildMarketFlowStoreKey(symbols), [symbols]);
  const snapshot = useLiveMarketFlow(symbols, {
    enabled,
    intervalMs,
  });

  useEffect(() => {
    publishMarketFlowSnapshot(storeKey, snapshot);
  }, [storeKey, snapshot]);

  useEffect(() => () => {
    clearMarketFlowSnapshot(storeKey);
  }, [storeKey]);

  return null;
});

export const BroadFlowScannerRuntime = memo(({
  symbols = [],
  enabled = true,
}) => {
  const flowScannerControl = useFlowScannerControlState();
  const scannerEnabled = Boolean(flowScannerControl.enabled);
  const runtimeActive = Boolean(enabled && scannerEnabled);
  const snapshot = useLiveMarketFlow(symbols, {
    enabled: runtimeActive,
    scannerConfig: flowScannerControl.config,
  });

  useEffect(() => {
    setFlowScannerControlState(
      { ownerActive: runtimeActive },
      { persistConfig: false },
    );
    return () => {
      setFlowScannerControlState(
        { ownerActive: false },
        { persistConfig: false },
      );
    };
  }, [runtimeActive]);

  useEffect(
    () => () => {
      clearMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY);
    },
    [],
  );

  useEffect(() => {
    if (!scannerEnabled) {
      clearMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY);
      return undefined;
    }
    publishMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY, snapshot);
    return undefined;
  }, [scannerEnabled, snapshot]);

  return null;
});
