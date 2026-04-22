export function normalizeIndicatorOverlayTape(tape = null) {
  if (
    tape
    && Array.isArray(tape.events)
    && Array.isArray(tape.zones)
    && Array.isArray(tape.windows)
  ) {
    return tape;
  }
  return {
    events: Array.isArray(tape?.events) ? tape.events : [],
    zones: Array.isArray(tape?.zones) ? tape.zones : [],
    windows: Array.isArray(tape?.windows) ? tape.windows : [],
  };
}

export function resolveChartOverlaySourceBars({
  chartBars = [],
  executionBars = [],
} = {}) {
  if (Array.isArray(chartBars) && chartBars.length > 0) {
    return chartBars;
  }
  return Array.isArray(executionBars) ? executionBars : [];
}

export function resolveResearchExecutionOverlayState({
  signalOverlayTape = null,
  localIndicatorOverlayTapesByTf = null,
  replayIndicatorOverlayTape = null,
} = {}) {
  const normalizedReplayIndicatorOverlayTape = normalizeIndicatorOverlayTape(replayIndicatorOverlayTape);
  return {
    chartIndicatorOverlayTape: signalOverlayTape || normalizedReplayIndicatorOverlayTape,
    chartIndicatorOverlayTapesByTf: localIndicatorOverlayTapesByTf || {},
    replayIndicatorOverlayTape: normalizedReplayIndicatorOverlayTape,
  };
}
