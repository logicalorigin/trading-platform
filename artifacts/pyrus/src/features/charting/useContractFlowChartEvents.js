import { useMemo } from "react";
import {
  filterFlowEventsForLoadedChartWindow,
  filterFlowEventsForChartLookbackWindow,
  filterFlowEventsForOptionContract,
  mergeFlowEventFeeds,
  resolveFlowEventChartLoadedWindow,
  resolveFlowEventSourceBasis,
} from "./chartEvents";
import { filterFlowEventsForChartDisplay } from "../platform/flowFilterStore";
import { useFlowChartEventConversion } from "../workers/analyticsClient";

const EMPTY_FLOW_EVENTS = Object.freeze([]);
const EMPTY_CHART_BARS = Object.freeze([]);

const asFlowEvents = (events) =>
  Array.isArray(events) ? events : EMPTY_FLOW_EVENTS;

const asPinnedEventFeed = (event) =>
  event && typeof event === "object" ? [event] : EMPTY_FLOW_EVENTS;

const keepRealChartFlowEvents = (events) =>
  asFlowEvents(events).filter(
    (event) => resolveFlowEventSourceBasis(event) !== "fallback_estimate",
  );

export const buildContractChartFlowEvents = ({
  flowEvents = EMPTY_FLOW_EVENTS,
  supplementalFlowEvents = EMPTY_FLOW_EVENTS,
  pinnedEvent = null,
  flowTapeFilters,
  contract = {},
  timeframe = "1m",
  chartBars = EMPTY_CHART_BARS,
} = {}) => {
  const pinnedEvents = keepRealChartFlowEvents(asPinnedEventFeed(pinnedEvent));
  const mergedEvents = keepRealChartFlowEvents(
    mergeFlowEventFeeds(
      asFlowEvents(flowEvents),
      asFlowEvents(supplementalFlowEvents),
      pinnedEvents,
    ),
  );
  const displayEvents = filterFlowEventsForChartDisplay(
    mergedEvents,
    flowTapeFilters,
  );
  const contractEvents = filterFlowEventsForOptionContract(
    displayEvents,
    contract,
  );
  const pinnedContractEvents = filterFlowEventsForOptionContract(
    pinnedEvents,
    contract,
  );
  const eventsWithPinnedSelection = mergeFlowEventFeeds(
    contractEvents,
    pinnedContractEvents,
  );
  const loadedWindow = resolveFlowEventChartLoadedWindow(chartBars, timeframe);

  if (loadedWindow) {
    return filterFlowEventsForLoadedChartWindow(
      eventsWithPinnedSelection,
      loadedWindow,
      { pinnedEvents },
    );
  }

  return mergeFlowEventFeeds(
    filterFlowEventsForChartLookbackWindow(
      eventsWithPinnedSelection,
      timeframe,
    ),
    pinnedContractEvents,
  );
};

export const useContractFlowChartEvents = ({
  flowEvents = EMPTY_FLOW_EVENTS,
  supplementalFlowEvents = EMPTY_FLOW_EVENTS,
  pinnedEvent = null,
  flowTapeFilters,
  contract = {},
  timeframe = "1m",
  chartBars = EMPTY_CHART_BARS,
  symbol = "",
} = {}) => {
  const contractFlowEvents = useMemo(
    () =>
      buildContractChartFlowEvents({
        flowEvents,
        supplementalFlowEvents,
        pinnedEvent,
        flowTapeFilters,
        contract,
        timeframe,
        chartBars,
      }),
    [
      flowEvents,
      supplementalFlowEvents,
      pinnedEvent,
      flowTapeFilters,
      chartBars,
      contract?.symbol,
      contract?.providerContractId,
      contract?.optionTicker,
      contract?.expirationDate,
      contract?.right,
      contract?.strike,
      timeframe,
    ],
  );
  const conversion = useFlowChartEventConversion(
    contractFlowEvents,
    symbol || contract?.symbol || "",
  );

  return useMemo(
    () => ({
      events: contractFlowEvents,
      conversion,
      chartEvents: conversion.events,
    }),
    [contractFlowEvents, conversion],
  );
};
