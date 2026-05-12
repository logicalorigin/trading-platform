import { useEffect, useMemo, useRef, useState } from "react";
import { wrap } from "comlink";
import {
  flowEventsToChartEventConversion,
  resolveFlowEventChartTimeResolution,
} from "../charting/chartEvents";

const WORKER_MIN_FLOW_EVENT_COUNT = 250;
const WORKER_FLOW_EVENT_FALLBACK_MS = 750;
const EMPTY_FLOW_EVENTS = Object.freeze([]);
const EMPTY_FLOW_CHART_EVENT_CONVERSION = Object.freeze({
  events: Object.freeze([]),
  rawInputCount: 0,
  flowRecordCount: 0,
  convertedEventCount: 0,
  droppedInvalidTimeCount: 0,
  droppedSymbolCount: 0,
});

let analyticsWorker = null;
let analyticsWorkerApi = null;
let analyticsWorkerUnavailable = false;

const canCreateAnalyticsWorker = () =>
  typeof window !== "undefined" && typeof Worker !== "undefined";

export const getAnalyticsWorkerApi = () => {
  if (analyticsWorkerUnavailable || !canCreateAnalyticsWorker()) {
    return null;
  }
  if (analyticsWorkerApi) {
    return analyticsWorkerApi;
  }

  try {
    analyticsWorker = new Worker(new URL("./analyticsWorker.js", import.meta.url), {
      type: "module",
    });
    analyticsWorkerApi = wrap(analyticsWorker);
    return analyticsWorkerApi;
  } catch (error) {
    analyticsWorkerUnavailable = true;
    console.warn("[rayalgo] analytics worker unavailable; using sync transforms", error);
    return null;
  }
};

export const disposeAnalyticsWorkerForTests = () => {
  analyticsWorker?.terminate?.();
  analyticsWorker = null;
  analyticsWorkerApi = null;
  analyticsWorkerUnavailable = false;
};

const readFlowEventSignatureTime = (event = {}) =>
  resolveFlowEventChartTimeResolution(event)?.iso || "";

export const buildFlowEventSignature = (events = [], symbol = "") =>
  [
    symbol || "",
    events.length,
    ...events.map((event) =>
      [
        event?.id || "",
        event?.ticker || event?.underlying || event?.symbol || "",
        event?.optionTicker || event?.providerContractId || event?.contract || "",
        readFlowEventSignatureTime(event),
      ].join(":"),
    ),
  ].join("|");

export const buildPendingFlowChartEventConversion = (events = []) => {
  const rawInputCount = Array.isArray(events) ? events.length : 0;
  if (!rawInputCount) {
    return EMPTY_FLOW_CHART_EVENT_CONVERSION;
  }
  return {
    events: [],
    rawInputCount,
    flowRecordCount: 0,
    convertedEventCount: 0,
    droppedInvalidTimeCount: 0,
    droppedSymbolCount: 0,
  };
};

const shouldUseAnalyticsWorkerForFlowEvents = (events, minWorkerEventCount) =>
  canCreateAnalyticsWorker() && events.length >= minWorkerEventCount;

export const useFlowChartEventConversion = (
  events = [],
  symbol = "",
  { minWorkerEventCount = WORKER_MIN_FLOW_EVENT_COUNT } = {},
) => {
  const inputEvents = Array.isArray(events) ? events : EMPTY_FLOW_EVENTS;
  const syncConversion = useMemo(
    () =>
      shouldUseAnalyticsWorkerForFlowEvents(inputEvents, minWorkerEventCount)
        ? null
        : flowEventsToChartEventConversion(inputEvents, symbol),
    [inputEvents, minWorkerEventCount, symbol],
  );
  const [conversion, setConversion] = useState(() =>
    syncConversion || buildPendingFlowChartEventConversion(inputEvents),
  );
  const revisionRef = useRef(0);
  const conversionSymbolRef = useRef(symbol);
  const signature = useMemo(
    () => buildFlowEventSignature(inputEvents, symbol),
    [inputEvents, symbol],
  );

  useEffect(() => {
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;

    if (syncConversion) {
      conversionSymbolRef.current = symbol;
      setConversion(syncConversion);
      return undefined;
    }

    const workerApi = getAnalyticsWorkerApi();
    if (!workerApi) {
      const nextConversion = flowEventsToChartEventConversion(inputEvents, symbol);
      conversionSymbolRef.current = symbol;
      setConversion(nextConversion);
      return undefined;
    }

    let cancelled = false;
    const fallbackTimer = setTimeout(() => {
      if (cancelled || revisionRef.current !== revision) {
        return;
      }
      conversionSymbolRef.current = symbol;
      setConversion(flowEventsToChartEventConversion(inputEvents, symbol));
    }, WORKER_FLOW_EVENT_FALLBACK_MS);
    if (conversionSymbolRef.current !== symbol) {
      setConversion(buildPendingFlowChartEventConversion(inputEvents));
    }
    workerApi
      .flowEventsToChartEventConversion(inputEvents, symbol)
      .then((nextConversion) => {
        if (cancelled || revisionRef.current !== revision) {
          return;
        }
        clearTimeout(fallbackTimer);
        conversionSymbolRef.current = symbol;
        setConversion(
          nextConversion || flowEventsToChartEventConversion(inputEvents, symbol),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          clearTimeout(fallbackTimer);
          console.warn("[rayalgo] analytics worker flow conversion failed", error);
          conversionSymbolRef.current = symbol;
          setConversion(flowEventsToChartEventConversion(inputEvents, symbol));
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [inputEvents, signature, symbol, syncConversion]);

  if (syncConversion) {
    return syncConversion;
  }
  if (conversionSymbolRef.current !== symbol) {
    return buildPendingFlowChartEventConversion(inputEvents);
  }
  return conversion;
};
