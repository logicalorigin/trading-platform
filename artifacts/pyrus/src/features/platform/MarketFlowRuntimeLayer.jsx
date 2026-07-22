import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  acquireFlowScannerOwner,
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
const BROAD_FLOW_STARTUP_DELAY_MS = 0;

const normalizeRuntimeSymbols = (symbols = []) =>
  Array.from(
    new Set(
      (symbols || [])
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  );

const useStableRuntimeSymbols = (symbols = []) => {
  const normalized = normalizeRuntimeSymbols(symbols);
  const key = normalized.join(",");
  const ref = useRef({ key: "", symbols: [] });
  if (ref.current.key !== key) {
    ref.current = { key, symbols: normalized };
  }
  return ref.current;
};

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
    status: snapshot?.staleFlowEvents
      ? "stale"
      : snapshot?.flowStatus || "empty",
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
  const stableSymbols = useStableRuntimeSymbols(symbols);
  const snapshot = useLiveMarketFlow(stableSymbols.symbols, {
    enabled,
    intervalMs,
    blocking: true,
  });

  useEffect(() => {
    publishRuntimeTradeFlowSnapshots(stableSymbols.symbols, snapshot);
  }, [snapshot, stableSymbols]);

  return null;
});

export const BroadFlowScannerRuntime = memo(({
  symbols = [],
  enabled = true,
  scannerConfig = null,
  startupDelayMs = BROAD_FLOW_STARTUP_DELAY_MS,
}) => {
  const ownerTokenRef = useRef(Symbol("broad-flow-scanner-runtime"));
  const stableSymbols = useStableRuntimeSymbols(symbols);
  const flowScannerControl = useFlowScannerControlState();
  const [startupReady, setStartupReady] = useState(false);
  const scannerEnabled = Boolean(flowScannerControl.enabled);
  useEffect(() => {
    if (!enabled) {
      setStartupReady(false);
      return undefined;
    }

    const delay = Math.max(0, Number(startupDelayMs) || 0);
    if (delay <= 0) {
      setStartupReady(true);
      return undefined;
    }

    setStartupReady(false);
    const timer = setTimeout(() => {
      setStartupReady(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [enabled, startupDelayMs]);
  const runtimeActive = Boolean(enabled && scannerEnabled && startupReady);
  const broadScannerConfig = useMemo(
    () =>
      normalizeFlowScannerConfig({
        ...flowScannerControl.config,
        ...(scannerConfig || {}),
        mode: FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
      }),
    [flowScannerControl.config, scannerConfig],
  );
  const snapshot = useLiveMarketFlow(stableSymbols.symbols, {
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
      return undefined;
    }
    publishMarketFlowSnapshot(BROAD_MARKET_FLOW_STORE_KEY, snapshot);
    publishRuntimeTradeFlowSnapshots(stableSymbols.symbols, snapshot);
    return undefined;
  }, [runtimeActive, snapshot, stableSymbols]);

  return null;
});
