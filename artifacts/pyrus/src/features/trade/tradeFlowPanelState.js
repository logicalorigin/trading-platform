export const resolveTradeFlowPanelState = ({
  enabled = true,
  status = "empty",
  events = [],
} = {}) => {
  const normalizedStatus = String(status || "empty").toLowerCase();
  const showEvents = Array.isArray(events) && events.length > 0;

  if (normalizedStatus === "offline") {
    return {
      kind: "offline",
      metaLabel: "OFFLINE",
      showEvents,
      notice: showEvents ? "Showing last captured flow" : "Flow unavailable",
      detail: "The current flow source could not be read.",
    };
  }
  if (normalizedStatus === "stale") {
    return {
      kind: "stale",
      metaLabel: "STALE",
      showEvents,
      notice: showEvents
        ? "Showing last captured flow"
        : "Flow data is stale",
      detail: "Live refresh is unavailable; values may be out of date.",
    };
  }
  if (!enabled) {
    return {
      kind: "waiting",
      metaLabel: "WAITING",
      showEvents,
      notice: showEvents
        ? "Showing last captured flow"
        : "Flow waiting for chart data",
      detail: showEvents
        ? "Live flow resumes after the primary chart is ready."
        : "Flow starts after the primary chart is ready.",
    };
  }
  if (showEvents) {
    return {
      kind: "live",
      metaLabel: "LIVE",
      showEvents: true,
      notice: null,
      detail: null,
    };
  }
  if (normalizedStatus === "loading") {
    return {
      kind: "loading",
      metaLabel: "LOADING",
      showEvents,
      notice: null,
      detail: null,
    };
  }
  return {
    kind: "empty",
    metaLabel: "NO FLOW",
    showEvents: false,
    notice: null,
    detail: null,
  };
};
