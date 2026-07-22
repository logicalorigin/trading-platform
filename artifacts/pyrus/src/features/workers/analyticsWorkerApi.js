import { flowEventsToChartEventConversion } from "../charting/chartEvents";
import { mapFlowEventToUi } from "../flow/flowEventMapper";

export const analyticsWorkerApi = {
  mapFlowEventsToUi(events = [], preferences) {
    return events.map((event) => mapFlowEventToUi(event, preferences));
  },

  flowEventsToChartEventConversion(events = [], symbol = "") {
    return flowEventsToChartEventConversion(events, symbol);
  },
};
