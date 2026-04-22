import {
  DEFAULT_RESEARCH_STRATEGY,
  normalizeResearchStrategy,
} from "../config/strategyPresets.js";

export function normalizeOverlayStrategy(strategy) {
  const normalized = String(strategy || "").trim().toLowerCase();
  return normalized === "all" ? DEFAULT_RESEARCH_STRATEGY : normalized;
}

export function filterOverlayGroupsByStrategy(groups, normalizedStrategy) {
  const filteredGroups = {};
  for (const [barIndex, overlays] of Object.entries(groups || {})) {
    const filteredOverlays = (Array.isArray(overlays) ? overlays : [])
      .filter((overlay) => normalizeOverlayStrategy(overlay?.strat) === normalizedStrategy);
    if (filteredOverlays.length) {
      filteredGroups[barIndex] = filteredOverlays;
    }
  }
  return filteredGroups;
}

export function filterIndicatorEventsByStrategy(indicatorEvents, strategy) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  return (Array.isArray(indicatorEvents) ? indicatorEvents : [])
    .filter((event) => normalizeOverlayStrategy(event?.strategy) === normalizedStrategy);
}

export function filterIndicatorZonesByStrategy(indicatorZones, strategy) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  return (Array.isArray(indicatorZones) ? indicatorZones : [])
    .filter((zone) => normalizeOverlayStrategy(zone?.strategy) === normalizedStrategy);
}

export function filterIndicatorWindowsByStrategy(indicatorWindows, strategy) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  return (Array.isArray(indicatorWindows) ? indicatorWindows : [])
    .filter((indicatorWindow) => {
      const signalRefs = Array.isArray(indicatorWindow?.signalRefs) ? indicatorWindow.signalRefs : [];
      if (signalRefs.length) {
        return signalRefs.every((signalRef) => (
          normalizeOverlayStrategy(signalRef?.strategy) === normalizedStrategy
        ));
      }
      return normalizeOverlayStrategy(indicatorWindow?.strategy) === normalizedStrategy;
    });
}

export function filterTradeOverlaysByStrategy(tradeOverlays, strategy) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  return (Array.isArray(tradeOverlays) ? tradeOverlays : [])
    .filter((overlay) => normalizeOverlayStrategy(overlay?.strat) === normalizedStrategy);
}
