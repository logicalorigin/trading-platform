import { useEffect, useMemo, useRef, useState } from "react";
import { wrap } from "comlink";
import { flowEventsToChartEventConversion } from "../charting/chartEvents";

const WORKER_MIN_FLOW_EVENT_COUNT = 40;
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
  event.occurredAt ||
  event.sip_timestamp ||
  event.participant_timestamp ||
  event.trf_timestamp ||
  event.exchange_timestamp ||
  event.timestamp ||
  event.dateTime ||
  event.t ||
  event.updatedAt ||
  event.createdAt ||
  event.time ||
  "";

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
    if (conversionSymbolRef.current !== symbol) {
      setConversion(buildPendingFlowChartEventConversion(inputEvents));
    }
    workerApi
      .flowEventsToChartEventConversion(inputEvents, symbol)
      .then((nextConversion) => {
        if (cancelled || revisionRef.current !== revision) {
          return;
        }
        conversionSymbolRef.current = symbol;
        setConversion(
          nextConversion || flowEventsToChartEventConversion(inputEvents, symbol),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[rayalgo] analytics worker flow conversion failed", error);
          conversionSymbolRef.current = symbol;
          setConversion(flowEventsToChartEventConversion(inputEvents, symbol));
        }
      });

    return () => {
      cancelled = true;
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
