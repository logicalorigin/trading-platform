const normalizeSignalDirection = (value) => {
  const direction = String(value || "").trim().toLowerCase();
  if (direction === "buy" || direction === "long" || direction === "bullish") {
    return "buy";
  }
  if (direction === "sell" || direction === "short" || direction === "bearish") {
    return "sell";
  }
  return "none";
};

export const resolveSignalFrameColor = (direction, theme) => {
  if (direction === "buy") {
    return theme.blue || theme.cyan || theme.accent || theme.green;
  }
  if (direction === "sell") {
    return theme.red;
  }
  return theme.border;
};

export const resolveSignalFrameState = (signalState, theme) => {
  const direction = normalizeSignalDirection(signalState?.currentSignalDirection);
  const active =
    signalState?.fresh &&
    signalState?.status === "ok" &&
    (direction === "buy" || direction === "sell");
  const color = resolveSignalFrameColor(direction, theme);

  return {
    active: Boolean(active),
    direction: active ? direction : "none",
    color,
    label: active
      ? `${String(direction).toUpperCase()} signal · ${
          signalState?.timeframe || "monitor"
        } · ${signalState?.barsSinceSignal ?? "?"} bars`
      : "No fresh signal",
  };
};
