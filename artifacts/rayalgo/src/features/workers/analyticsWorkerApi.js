import {
  clusterChartEvents,
  flowEventsToChartEventConversion,
} from "../charting/chartEvents";
import {
  buildFlowChartBuckets,
  buildFlowTooltipModel,
  summarizeFlowChartBucketPlacement,
} from "../charting/flowChartEvents";
import {
  buildDteBucketsFromEvents,
  buildFlowClockFromEvents,
  buildFlowTideFromEvents,
  buildMarketOrderFlowFromEvents,
  buildPutCallSummaryFromEvents,
  buildSectorFlowFromEvents,
  buildTickerFlowFromEvents,
} from "../flow/flowAnalytics";
import { buildOptionChainRowsFromApi } from "../trade/optionChainRows";

export const analyticsWorkerApi = {
  flowEventsToChartEventConversion(events = [], symbol = "") {
    return flowEventsToChartEventConversion(events, symbol);
  },

  buildFlowChartOverlayModel({ events = [], model }) {
    const buckets = buildFlowChartBuckets(events, model);
    return {
      buckets,
      diagnostics: summarizeFlowChartBucketPlacement(events, model),
      tooltips: buckets.map((bucket) => ({
        bucketId: bucket.id,
        tooltip: buildFlowTooltipModel(bucket),
      })),
    };
  },

  buildFlowDashboardModels({ events = [], symbols = [] }) {
    return {
      marketOrderFlow: buildMarketOrderFlowFromEvents(events),
      tide: buildFlowTideFromEvents(events),
      tickerFlow: buildTickerFlowFromEvents(events),
      clock: buildFlowClockFromEvents(events),
      sectorFlow: buildSectorFlowFromEvents(events),
      dteBuckets: buildDteBucketsFromEvents(events),
      putCallSummary: buildPutCallSummaryFromEvents(events),
      premiumBySymbol: buildTickerFlowFromEvents(events).filter((entry) =>
        symbols.length ? symbols.includes(entry.sym) : true,
      ),
    };
  },

  buildOptionChainRows({ contracts = [], spotPrice = null }) {
    return buildOptionChainRowsFromApi(contracts, spotPrice);
  },

  clusterChartEvents(events = [], options = {}) {
    return clusterChartEvents(events, options);
  },
};
