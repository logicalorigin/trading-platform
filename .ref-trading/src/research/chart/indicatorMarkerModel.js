const SIGNAL_CLUSTER_GAP_BARS = 18;

function toChartTime(bar) {
  const time = Number(bar?.time);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function createBaseMarker(event, time) {
  const direction = event?.direction === "short" ? "short" : "long";
  const displayText = String(event?.displayText || "").trim();
  return {
    id: event.id,
    barIndex: event.barIndex,
    time,
    direction,
    strategy: event.strategy,
    eventType: event.eventType,
    label: String(event.label || "").trim(),
    displayText,
    activeTimeframe: String(event?.meta?.scoring?.activeTimeframe || "").trim() || null,
    signalRole: String(event?.signalRole || event?.meta?.scoring?.signalRole || "").trim() || null,
    score: Number.isFinite(Number(event?.score)) ? Number(event.score) : null,
    rawScore: Number.isFinite(Number(event?.rawScore)) ? Number(event.rawScore) : null,
    shape: event?.eventType === "signal_fire"
      ? (direction === "short" ? "arrowDown" : "arrowUp")
      : ["bos", "choch", "order_block_touch", "fvg_touch"].includes(event.eventType)
        ? "square"
        : "circle",
  };
}

function createOverviewMarker(baseMarker) {
  return {
    ...baseMarker,
    text: baseMarker.eventType === "signal_fire"
      ? baseMarker.displayText
      : "",
  };
}

function createSelectedMarker(baseMarker) {
  return {
    ...baseMarker,
    text: baseMarker.eventType === "signal_fire"
      ? baseMarker.displayText
      : "",
  };
}

function registerTime(target, time, tradeIds = []) {
  const key = String(time);
  const current = target.get(key) || [];
  for (const tradeId of Array.isArray(tradeIds) ? tradeIds : []) {
    if (tradeId && !current.includes(tradeId)) {
      current.push(tradeId);
    }
  }
  if (current.length) {
    target.set(key, current);
  }
}

export function buildIndicatorMarkerPayload(chartBars, indicatorEvents) {
  const orderedEvents = (Array.isArray(indicatorEvents) ? indicatorEvents : [])
    .filter((event) => event?.barIndex != null)
    .slice()
    .sort((left, right) => {
      if (left.barIndex !== right.barIndex) {
        return left.barIndex - right.barIndex;
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    });

  const overviewMarkers = [];
  const markersByTradeId = {};
  const timeToTradeIds = new Map();
  let lastVisibleSignalBarIndex = null;
  let lastVisibleSignalDirection = null;

  for (const event of orderedEvents) {
    const bar = chartBars[event.barIndex];
    const time = toChartTime(bar);
    if (time == null) {
      continue;
    }

    const tradeSelectionIds = Array.isArray(event.tradeSelectionIds) ? event.tradeSelectionIds.filter(Boolean) : [];
    const baseMarker = createBaseMarker(event, time);
    registerTime(timeToTradeIds, time, tradeSelectionIds);

    if (event.eventType === "signal_fire") {
      const gapBars = lastVisibleSignalBarIndex == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, event.barIndex - lastVisibleSignalBarIndex);
      const isNewCluster = baseMarker.direction !== lastVisibleSignalDirection || gapBars > SIGNAL_CLUSTER_GAP_BARS;
      if (isNewCluster) {
        overviewMarkers.push(createOverviewMarker(baseMarker));
        lastVisibleSignalBarIndex = event.barIndex;
        lastVisibleSignalDirection = baseMarker.direction;
      }
    }

    for (const tradeSelectionId of tradeSelectionIds) {
      const current = markersByTradeId[tradeSelectionId] || [];
      current.push(createSelectedMarker(baseMarker));
      markersByTradeId[tradeSelectionId] = current;
    }
  }

  return {
    overviewMarkers,
    markersByTradeId,
    timeToTradeIds,
  };
}
