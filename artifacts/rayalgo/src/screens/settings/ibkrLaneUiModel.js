export const LANE_SOURCE_IDS = [
  "built-in",
  "watchlists",
  "flow-universe",
  "manual",
  "system",
];

export const LANE_SOURCE_LABELS = {
  "built-in": "Built In",
  watchlists: "Watchlists",
  "flow-universe": "Flow Universe",
  manual: "Manual",
  system: "System",
};

export const LANE_SOURCE_SHORT_LABELS = {
  "built-in": "BI",
  watchlists: "WL",
  "flow-universe": "FU",
  manual: "MAN",
  system: "SYS",
};

export const SYSTEM_LANE_IDS = ["account-control", "orders-control"];

export const LANE_GROUPS = [
  {
    id: "market-data",
    label: "Market Data",
    laneIds: ["equity-live-quotes", "option-live-quotes"],
  },
  {
    id: "flow-engine",
    label: "Flow Engine",
    laneIds: ["flow-scanner", "option-chain-metadata"],
  },
  {
    id: "history",
    label: "History",
    laneIds: ["historical-bars"],
  },
  {
    id: "protected",
    label: "Protected System Lanes",
    laneIds: SYSTEM_LANE_IDS,
  },
];

export const LANE_PRESETS = [
  {
    id: "conservative",
    label: "Conservative",
    description: "Lower caps with narrow scanner and metadata demand.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Return editable lanes to backend defaults.",
  },
  {
    id: "expanded",
    label: "Expanded",
    description: "Broader flow/scanner coverage with higher caps.",
  },
  {
    id: "line-booster",
    label: "Line Booster",
    description: "Use the expanded IBKR Level 1 allowance with balanced live coverage.",
  },
];

export function isSystemLane(laneId) {
  return SYSTEM_LANE_IDS.includes(laneId);
}

export function isEditableLane(laneId) {
  return !isSystemLane(laneId);
}

export function normalizeLaneSymbol(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return /^[A-Z0-9._-]{1,24}$/.test(normalized) ? normalized : "";
}

export function normalizeLaneSymbolList(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  return [
    ...new Set(rawValues.map((symbol) => normalizeLaneSymbol(symbol)).filter(Boolean)),
  ];
}

export function mergeLanePolicy(basePolicy = {}, draftPolicy = {}) {
  const merged = {
    ...basePolicy,
    ...draftPolicy,
    sources: {
      ...(basePolicy.sources || {}),
      ...(draftPolicy.sources || {}),
    },
  };
  if (merged.manualSymbols !== undefined) {
    merged.manualSymbols = normalizeLaneSymbolList(merged.manualSymbols);
  }
  if (merged.excludedSymbols !== undefined) {
    merged.excludedSymbols = normalizeLaneSymbolList(merged.excludedSymbols);
  }
  return merged;
}

export function resolveLanePreview(lane = {}, policy = {}) {
  const maxSymbols = Math.max(1, Number.parseInt(String(policy.maxSymbols || lane.maxSymbols || 1), 10));
  const enabled = policy.enabled !== false;
  const priority = Array.isArray(policy.priority) && policy.priority.length
    ? policy.priority
    : ["system", "manual", "watchlists", "flow-universe", "built-in"];
  const priorityIndex = new Map(priority.map((sourceId, index) => [sourceId, index]));
  const availableSources = lane.availableSources || {};
  const sourceCounts = Object.fromEntries(
    LANE_SOURCE_IDS.map((sourceId) => [sourceId, 0]),
  );
  const symbolsBySymbol = new Map();

  LANE_SOURCE_IDS.forEach((sourceId) => {
    if (!policy.sources?.[sourceId]) {
      return;
    }
    const values =
      sourceId === "manual"
        ? policy.manualSymbols || []
        : availableSources[sourceId] || [];
    normalizeLaneSymbolList(values).forEach((symbol) => {
      const set = symbolsBySymbol.get(symbol) || new Set();
      set.add(sourceId);
      symbolsBySymbol.set(symbol, set);
      sourceCounts[sourceId] += 1;
    });
  });

  const desiredSymbols = Array.from(symbolsBySymbol.entries())
    .map(([symbol, sourceSet]) => ({
      symbol,
      sources: Array.from(sourceSet).sort(
        (left, right) =>
          (priorityIndex.get(left) ?? 99) - (priorityIndex.get(right) ?? 99),
      ),
    }))
    .sort((left, right) => {
      const leftPriority = Math.min(
        ...left.sources.map((sourceId) => priorityIndex.get(sourceId) ?? 99),
      );
      const rightPriority = Math.min(
        ...right.sources.map((sourceId) => priorityIndex.get(sourceId) ?? 99),
      );
      return leftPriority - rightPriority || left.symbol.localeCompare(right.symbol);
    });

  const excluded = new Set(normalizeLaneSymbolList(policy.excludedSymbols || []));
  const admittedSymbols = [];
  const droppedSymbols = [];

  desiredSymbols.forEach((entry) => {
    if (!enabled) {
      droppedSymbols.push({ ...entry, reason: "disabled" });
    } else if (excluded.has(entry.symbol)) {
      droppedSymbols.push({ ...entry, reason: "excluded" });
    } else if (admittedSymbols.length >= maxSymbols) {
      droppedSymbols.push({ ...entry, reason: "capacity" });
    } else {
      admittedSymbols.push(entry.symbol);
    }
  });

  return {
    ...lane,
    enabled,
    maxSymbols,
    desiredSymbols,
    admittedSymbols,
    droppedSymbols,
    sourceCounts,
  };
}

function clonePolicy(policy) {
  return {
    ...policy,
    sources: { ...(policy?.sources || {}) },
    manualSymbols: normalizeLaneSymbolList(policy?.manualSymbols || []),
    excludedSymbols: normalizeLaneSymbolList(policy?.excludedSymbols || []),
    priority: Array.isArray(policy?.priority) ? [...policy.priority] : undefined,
  };
}

export function buildLanePresetPatch(presetId, defaults = {}) {
  if (presetId === "balanced") {
    return Object.fromEntries(
      Object.entries(defaults)
        .filter(([laneId]) => isEditableLane(laneId))
        .map(([laneId, policy]) => [laneId, clonePolicy(policy)]),
    );
  }

  if (presetId === "conservative") {
    return {
      "equity-live-quotes": {
        enabled: true,
        sources: { watchlists: true, manual: true, system: true, "flow-universe": false, "built-in": false },
        maxSymbols: 50,
      },
      "option-live-quotes": {
        enabled: true,
        sources: { "flow-universe": true, manual: true, watchlists: false, "built-in": false, system: false },
        maxSymbols: 40,
      },
      "flow-scanner": {
        enabled: true,
        sources: { "built-in": true, manual: true, "flow-universe": false, watchlists: false, system: false },
        maxSymbols: 150,
      },
      "option-chain-metadata": {
        enabled: true,
        sources: { watchlists: true, manual: true, "flow-universe": false, "built-in": false, system: false },
        maxSymbols: 50,
      },
      "historical-bars": {
        enabled: true,
        sources: { watchlists: true, manual: true, "flow-universe": false, "built-in": false, system: false },
        maxSymbols: 40,
      },
    };
  }

  if (presetId === "expanded") {
    return {
      "equity-live-quotes": {
        enabled: true,
        sources: { watchlists: true, manual: true, system: true, "flow-universe": false, "built-in": false },
        maxSymbols: 150,
      },
      "option-live-quotes": {
        enabled: true,
        sources: { "flow-universe": true, watchlists: true, manual: true, "built-in": false, system: false },
        maxSymbols: 150,
      },
      "flow-scanner": {
        enabled: true,
        sources: { "built-in": true, "flow-universe": true, watchlists: true, manual: true, system: false },
        maxSymbols: 1000,
      },
      "option-chain-metadata": {
        enabled: true,
        sources: { "flow-universe": true, watchlists: true, manual: true, "built-in": false, system: false },
        maxSymbols: 250,
      },
      "historical-bars": {
        enabled: true,
        sources: { "flow-universe": true, watchlists: true, manual: true, "built-in": false, system: false },
        maxSymbols: 150,
      },
    };
  }

  if (presetId === "line-booster") {
    return {
      "equity-live-quotes": {
        enabled: true,
        sources: { watchlists: true, manual: true, system: true, "flow-universe": false, "built-in": false },
        maxSymbols: 120,
      },
      "option-live-quotes": {
        enabled: true,
        sources: { "flow-universe": true, watchlists: true, manual: true, "built-in": false, system: false },
        maxSymbols: 120,
      },
      "flow-scanner": {
        enabled: true,
        sources: { "built-in": true, "flow-universe": true, watchlists: true, manual: true, system: false },
        maxSymbols: 750,
      },
      "option-chain-metadata": {
        enabled: true,
        sources: { "flow-universe": true, watchlists: true, manual: true, "built-in": false, system: false },
        maxSymbols: 180,
      },
      "historical-bars": {
        enabled: true,
        sources: { "flow-universe": true, watchlists: true, manual: true, "built-in": false, system: false },
        maxSymbols: 100,
      },
    };
  }

  return {};
}

export function buildLaneWarnings({ lane, basePolicy = {}, mergedPolicy = {}, defaultPolicy = {} }) {
  if (!lane?.laneId || !isEditableLane(lane.laneId)) {
    return [];
  }

  const warnings = [];
  const baseMax = Number.parseInt(String(basePolicy.maxSymbols || lane.maxSymbols || 0), 10);
  const mergedMax = Number.parseInt(String(mergedPolicy.maxSymbols || lane.maxSymbols || 0), 10);
  const defaultMax = Number.parseInt(String(defaultPolicy.maxSymbols || baseMax || 0), 10);
  const manualCount = normalizeLaneSymbolList(mergedPolicy.manualSymbols || []).length;
  const baseManualCount = normalizeLaneSymbolList(basePolicy.manualSymbols || []).length;
  const capacityDrops = (lane.droppedSymbols || []).filter(
    (entry) => entry.reason === "capacity",
  ).length;

  if (mergedPolicy.enabled === false) {
    warnings.push({
      laneId: lane.laneId,
      code: "lane-disabled",
      severity: "warning",
      message: `${lane.label} is disabled; related data will stop updating.`,
    });
  }
  if (mergedMax > baseMax) {
    warnings.push({
      laneId: lane.laneId,
      code: "cap-increase",
      severity: "warning",
      message: `${lane.label} cap increases from ${baseMax} to ${mergedMax}.`,
    });
  }
  if (lane.laneId === "flow-scanner" && mergedMax > Math.max(defaultMax, 500)) {
    warnings.push({
      laneId: lane.laneId,
      code: "scanner-expanded",
      severity: "warning",
      message: "Flow Scanner is above the balanced cap and may increase option-chain pressure.",
    });
  }
  ["flow-universe", "watchlists", "built-in"].forEach((sourceId) => {
    if (mergedPolicy.sources?.[sourceId] && !basePolicy.sources?.[sourceId]) {
      warnings.push({
        laneId: lane.laneId,
        code: `source-${sourceId}`,
        severity: "warning",
        message: `${lane.label} now includes ${LANE_SOURCE_LABELS[sourceId]}.`,
      });
    }
  });
  if (manualCount > baseManualCount + 25) {
    warnings.push({
      laneId: lane.laneId,
      code: "manual-expansion",
      severity: "warning",
      message: `${lane.label} adds ${manualCount - baseManualCount} manual symbols.`,
    });
  }
  if (capacityDrops > 0) {
    warnings.push({
      laneId: lane.laneId,
      code: "capacity-drops",
      severity: "info",
      message: `${lane.label} is dropping ${capacityDrops} symbol${capacityDrops === 1 ? "" : "s"} at capacity.`,
    });
  }

  return warnings;
}
