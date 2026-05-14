import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  acquireFlowScannerOwner,
  buildMarketFlowStoreKey,
  clearMarketFlowSnapshot,
  publishMarketFlowSnapshot,
  useFlowScannerControlState,
} from "./marketFlowStore";
import { publishTradeFlowSnapshotsByTicker } from "./tradeFlowStore";
import {
  FLOW_SCANNER_MODE,
  normalizeFlowScannerConfig,
} from "./marketFlowScannerConfig";
import { useLiveMarketFlow } from "./useLiveMarketFlow";

const buildPendingFlowSource = (reason = "options_flow_refreshing") => ({
  provider: "none",
  status: "empty",
  ibkrStatus: "empty",
  ibkrReason: reason,
});
const BROAD_FLOW_STARTUP_DELAY_MS = 2_500;

const resolveTradeFlowPublishSource = (snapshot, symbol) =>
  snapshot?.providerSummary?.sourcesBySymbol?.[symbol] ||
  snapshot?.providerSummary?.erroredSource ||
  (snapshot?.flowStatus === "loading" || snapshot?.providerSummary?.coverage?.isFetching
    ? buildPendingFlowSource()
    : null);

const publishRuntimeTradeFlowSnapshots = (symbols, snapshot) => {
  const sourceBySymbol = {};
  symbols.forEach((symbol) => {
    const source = resolveTradeFlowPublishSource(snapshot, symbol);
    if (source) {
      sourceBySymbol[symbol] = source;
    }
  });
  publishTradeFlowSnapshotsByTicker({
    symbols,
    events: snapshot?.flowEvents || [],
    status: snapshot?.flowStatus || "empty",
    source: snapshot?.providerSummary?.erroredSource || null,
    sourceBySymbol,
    includeEmpty: true,
    preserveExistingOnEmpty: true,
  });
};

export const SharedMarketFlowRuntime = memo(({
  symbols = [],
  enabled = true,
  intervalMs = 10_000,
}) => {
  const storeKey = useMemo(() => buildMarketFlowStoreKey(symbols), [symbols]);
  const snapshot = useLiveMarketFlow(symbols, {
    enabled,
    intervalMs,
    blocking: true,
  });

  useEffect(() => {
    publishMarketFlowSnapshot(storeKey, snapshot);
    publishRuntimeTradeFlowSnapshots(symbols, snapshot);
  }, [storeKey, snapshot, symbols]);

  useEffect(() => () => {
    clearMarketFlowSnapshot(storeKey);
  }, [storeKey]);

  return null;
});

export const BroadFlowScannerRuntime = memo(({
  symbols = [],
  enabled = true,
}) => {
  const ownerTokenRef = useRef(Symbol("broad-flow-scanner-runtime"));
  const flowScannerControl = useFlowScannerControlState();
  const symbolsKey = symbols.join(",");
  const [startupReady, setStartupReady] = useState(false);
  const scannerEnabled = Boolean(flowScannerControl.enabled);
  useEffect(() => {
    if (!enabled || !symbols.length) {
      setStartupReady(false);
      return undefined;
    }

    setStartupReady(false);
    const timer = setTimeout(() => {
      setStartupReady(true);
    }, BROAD_FLOW_STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, symbols.length, symbolsKey]);
  const runtimeActive = Boolean(enabled && scannerEnabled && startupReady);
  const broadScannerConfig = useMemo(
    () =>
      normalizeFlowScannerConfig({
        ...flowScannerControl.config,
        mode: FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
      }),
    [flowScannerControl.config],
  );
  const snapshot = useLiveMarketFlow(symbols, {
    enabled: runtimeActive,
    scannerConfig: broadScannerConfig,
    blocking: false,
  });

  useEffect(() => {
    if (!runtimeActive) {
      return undefined;
    }
    return acquireFlowScannerOwner(ownerTokenRef.current);
  }, [runtimeActive]);

  useEffect(
    () => () => {
      clearMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY);
    },
    [],
  );

  useEffect(() => {
    if (!runtimeActive) {
      clearMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY);
      return undefined;
    }
    publishMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY, snapshot);
    publishRuntimeTradeFlowSnapshots(symbols, snapshot);
    return undefined;
  }, [runtimeActive, snapshot, symbols]);

  return null;
});
