export const EMPTY_INDICATOR_MARKER_PAYLOAD = {
  overviewMarkers: [],
  markersByTradeId: {},
  timeToTradeIds: new Map(),
};

export const EMPTY_HOVER_SNAPSHOT = Object.freeze({
  hud: null,
  hoverTradeId: null,
});

export function markerFallsWithinRange(marker, visibleBarRange) {
  if (!visibleBarRange) {
    return true;
  }
  const markerBarIndex = Number(marker?.barIndex);
  if (!Number.isFinite(markerBarIndex)) {
    return true;
  }
  return markerBarIndex >= visibleBarRange.from && markerBarIndex <= visibleBarRange.to;
}

export function buildTradeMarkers(
  tradeMarkerGroups,
  selectedTradeId,
  hoveredTradeId,
  { bullColor = "#22c55e", bearColor = "#ef4444", withAlpha = (color) => color } = {},
) {
  const markers = [];
  const timeToTradeIds = tradeMarkerGroups?.timeToTradeIds || new Map();
  const interactionGroups = Array.isArray(tradeMarkerGroups?.interactionGroups)
    ? tradeMarkerGroups.interactionGroups
    : [];

  function pushGroupedMarker(group, kind) {
    const overlays = Array.isArray(group?.overlays) ? group.overlays : [];
    if (!overlays.length) {
      return;
    }
    const selectedOverlay = overlays.find((overlay) => overlay.tradeSelectionId === selectedTradeId) || null;
    const hoveredOverlay = overlays.find((overlay) => overlay.tradeSelectionId === hoveredTradeId) || null;
    const isSelected = Boolean(selectedOverlay);
    const isHovered = !isSelected && Boolean(hoveredOverlay);
    const countLabel = overlays.length > 1 ? String(overlays.length) : "";
    const directionColor = group.dir === "short" ? bearColor : bullColor;
    const markerPosition = kind === "entry"
      ? (group.dir === "short" ? "aboveBar" : "belowBar")
      : (group.dir === "short" ? "belowBar" : "aboveBar");
    const foregroundShape = kind === "exit"
      ? "square"
      : (group.dir === "short" ? "arrowDown" : "arrowUp");
    const foregroundText = kind === "exit"
      ? (countLabel || "X")
      : countLabel;
    const foregroundSize = isSelected
      ? 1.12
      : isHovered
        ? 1.08
        : overlays.length > 1
          ? 1.14
          : 0.98;
    const ringSize = isSelected
      ? 1.6
      : isHovered
        ? 1.52
        : overlays.length > 1
          ? 1.58
          : 1.4;
    const ringAlpha = isSelected ? 0.99 : isHovered ? 0.98 : 0.94;
    const colorAlpha = isSelected ? 0.96 : isHovered ? 0.9 : selectedTradeId ? 0.46 : 0.78;
    const barIndex = kind === "entry"
      ? (overlays[0]?.entryBarIndex ?? null)
      : (overlays[0]?.exitBarIndex ?? null);

    markers.push({
      id: `${group.id}-${kind}-ring`,
      barIndex,
      time: group.time,
      position: markerPosition,
      shape: "circle",
      color: withAlpha("#ffffff", ringAlpha),
      text: "",
      size: ringSize,
    });

    markers.push({
      id: `${group.id}-${kind}`,
      barIndex,
      time: group.time,
      position: markerPosition,
      shape: foregroundShape,
      color: withAlpha(directionColor, colorAlpha),
      text: foregroundText,
      size: foregroundSize,
    });
  }

  (tradeMarkerGroups?.entryGroups || []).forEach((group) => pushGroupedMarker(group, "entry"));
  (tradeMarkerGroups?.exitGroups || []).forEach((group) => pushGroupedMarker(group, "exit"));

  return { markers, timeToTradeIds, interactionGroups };
}

export function buildMarkerSetSignature(markers = []) {
  return markers
    .map((marker) => [
      marker?.id,
      marker?.barIndex,
      marker?.position,
      marker?.shape,
      marker?.color,
      marker?.text,
      marker?.size,
    ].join(":"))
    .join("|");
}

function buildIndicatorMarker(
  marker,
  isHighlighted = false,
  {
    bearColor = "#ef4444",
    signalBuyColor = "#2563eb",
    getStrategyOverlayColor = () => signalBuyColor,
    withAlpha = (color) => color,
  } = {},
  ) {
  const direction = marker?.direction === "short" ? "short" : "long";
  const isSignalFire = marker?.eventType === "signal_fire";
  const signalRole = String(marker?.signalRole || "").trim().toLowerCase();
  const isAdvisorySignal = isSignalFire && signalRole === "advisory";
  const strategyColor = getStrategyOverlayColor(marker?.strategy);
  const signalAlpha = isAdvisorySignal
    ? (isHighlighted ? 0.84 : 0.66)
    : (isHighlighted ? 0.98 : 0.86);
  const signalSize = isAdvisorySignal
    ? (isHighlighted ? 1.12 : 0.98)
    : (isHighlighted ? 1.26 : 1.14);
  return {
    id: marker?.id,
    barIndex: marker?.barIndex,
    time: marker?.time,
    position: direction === "short" ? "aboveBar" : "belowBar",
    shape: marker?.shape || (isSignalFire ? (direction === "short" ? "arrowDown" : "arrowUp") : "circle"),
    color: isSignalFire
      ? withAlpha(direction === "short" ? bearColor : signalBuyColor, signalAlpha)
      : withAlpha(strategyColor, isHighlighted ? 0.82 : 0.72),
    text: String(marker?.text || ""),
    size: isSignalFire
      ? signalSize
      : (isHighlighted ? 0.78 : 0.66),
  };
}

export function resolveIndicatorMarkers(
  indicatorMarkerPayload,
  selectedTradeId,
  {
    emptyIndicatorMarkerPayload = EMPTY_INDICATOR_MARKER_PAYLOAD,
    bearColor = "#ef4444",
    signalBuyColor = "#2563eb",
    getStrategyOverlayColor = () => signalBuyColor,
    withAlpha = (color) => color,
  } = {},
) {
  const payload = indicatorMarkerPayload || emptyIndicatorMarkerPayload;
  const overviewMarkers = Array.isArray(payload?.overviewMarkers) ? payload.overviewMarkers : [];
  const selectedMarkers = selectedTradeId && payload?.markersByTradeId
    ? payload.markersByTradeId[selectedTradeId] || []
    : [];
  const mergedMarkers = new Map();

  for (const marker of overviewMarkers) {
    mergedMarkers.set(marker?.id, buildIndicatorMarker(marker, false, {
      bearColor,
      signalBuyColor,
      getStrategyOverlayColor,
      withAlpha,
    }));
  }
  for (const marker of Array.isArray(selectedMarkers) ? selectedMarkers : []) {
    mergedMarkers.set(marker?.id, buildIndicatorMarker(marker, true, {
      bearColor,
      signalBuyColor,
      getStrategyOverlayColor,
      withAlpha,
    }));
  }

  return {
    markers: [...mergedMarkers.values()],
    timeToTradeIds: payload?.timeToTradeIds || new Map(),
  };
}

function hoverHudMatches(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return Number(left.time) === Number(right.time)
    && Number(left.open) === Number(right.open)
    && Number(left.high) === Number(right.high)
    && Number(left.low) === Number(right.low)
    && Number(left.close) === Number(right.close)
    && Number(left.volume) === Number(right.volume);
}

function hoverSnapshotMatches(left, right) {
  return String(left?.hoverTradeId || "") === String(right?.hoverTradeId || "")
    && hoverHudMatches(left?.hud, right?.hud);
}

export function createHoverSnapshotStore(emptySnapshot = EMPTY_HOVER_SNAPSHOT) {
  let snapshot = emptySnapshot;
  const listeners = new Set();
  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(nextSnapshot) {
      const normalized = nextSnapshot?.hud || nextSnapshot?.hoverTradeId
        ? nextSnapshot
        : emptySnapshot;
      if (hoverSnapshotMatches(snapshot, normalized)) {
        return;
      }
      snapshot = normalized;
      listeners.forEach((listener) => listener());
    },
    reset() {
      if (snapshot === emptySnapshot) {
        return;
      }
      snapshot = emptySnapshot;
      listeners.forEach((listener) => listener());
    },
  };
}
