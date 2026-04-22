function toChartTime(bar) {
  const time = Number(bar?.time);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

export function buildTradeMarkerGroups(chartBars, tradeOverlays) {
  const entryGroups = new Map();
  const exitGroups = new Map();

  function registerTime(target, time, tradeIds) {
    const key = String(time);
    const current = target.get(key) || [];
    for (const tradeId of tradeIds) {
      if (tradeId && !current.includes(tradeId)) {
        current.push(tradeId);
      }
    }
    if (current.length) {
      target.set(key, current);
    }
  }

  for (const overlay of Array.isArray(tradeOverlays) ? tradeOverlays : []) {
    if (overlay?.entryBarIndex != null) {
      const bar = chartBars[overlay.entryBarIndex];
      const time = toChartTime(bar);
      if (time != null) {
        const key = `${time}|entry|${overlay.dir}`;
        const current = entryGroups.get(key) || {
          id: key,
          time,
          dir: overlay.dir === "short" ? "short" : "long",
          barIndex: overlay.entryBarIndex,
          overlays: [],
        };
        current.overlays.push(overlay);
        if (!Number.isInteger(current.barIndex) && Number.isInteger(overlay.entryBarIndex)) {
          current.barIndex = overlay.entryBarIndex;
        }
        entryGroups.set(key, current);
      }
    }

    if (overlay?.exitBarIndex != null) {
      const bar = chartBars[overlay.exitBarIndex];
      const time = toChartTime(bar);
      if (time != null) {
        const profitable = Number(overlay.pnl) >= 0;
        const key = `${time}|exit|${overlay.dir}|${profitable ? "profit" : "loss"}`;
        const current = exitGroups.get(key) || {
          id: key,
          time,
          dir: overlay.dir === "short" ? "short" : "long",
          profitable,
          barIndex: overlay.exitBarIndex,
          overlays: [],
        };
        current.overlays.push(overlay);
        if (!Number.isInteger(current.barIndex) && Number.isInteger(overlay.exitBarIndex)) {
          current.barIndex = overlay.exitBarIndex;
        }
        exitGroups.set(key, current);
      }
    }
  }

  const sortGroups = (left, right) => {
    if (left.time !== right.time) {
      return left.time - right.time;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  };

  const orderedEntryGroups = [...entryGroups.values()].sort(sortGroups);
  const orderedExitGroups = [...exitGroups.values()].sort(sortGroups);
  const interactionGroups = [
    ...orderedEntryGroups.map((group) => ({
      ...group,
      kind: "entry",
      barIndex: Number.isInteger(group?.barIndex) ? group.barIndex : (group?.overlays?.[0]?.entryBarIndex ?? null),
    })),
    ...orderedExitGroups.map((group) => ({
      ...group,
      kind: "exit",
      barIndex: Number.isInteger(group?.barIndex) ? group.barIndex : (group?.overlays?.[0]?.exitBarIndex ?? null),
    })),
  ];
  const timeToTradeIds = new Map();
  for (const group of [...orderedEntryGroups, ...orderedExitGroups]) {
    const overlays = Array.isArray(group?.overlays) ? group.overlays : [];
    if (!overlays.length) {
      continue;
    }
    const tradeIds = overlays.map((overlay) => overlay.tradeSelectionId).filter(Boolean);
    registerTime(timeToTradeIds, group.time, tradeIds);
  }

  return {
    entryGroups: orderedEntryGroups,
    exitGroups: orderedExitGroups,
    interactionGroups,
    timeToTradeIds,
  };
}
