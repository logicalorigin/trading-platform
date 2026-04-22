import {
  normalizeRayAlgoSignalClass,
  RAYALGO_EVENT_TYPE_TREND_CHANGE,
} from "./rayalgoCore.js";

const DEFAULT_WINDOW_SECONDS = 300;
const COMPONENT_KEYS = ["emaCross", "bosRecent", "chochRecent", "obDir", "sweepDir", "bandTrend", "bandRetest"];

export function computeRayAlgoParityReport(options = {}) {
  const {
    symbol = "AMEX:SPY",
    timeframe = "5",
    pineSignals = [],
    localSignals = [],
    windowSeconds = DEFAULT_WINDOW_SECONDS,
  } = options;

  const normalizedWindow = Math.max(1, Math.round(Number(windowSeconds) || DEFAULT_WINDOW_SECONDS));
  const pine = normalizeSignals(pineSignals);
  const local = normalizeSignals(localSignals);

  const byDirection = {
    buy: buildDirectionStats("buy", pine, local, normalizedWindow),
    sell: buildDirectionStats("sell", pine, local, normalizedWindow),
  };

  const overall = buildOverallStats(byDirection);
  const unmatchedExamples = buildUnmatchedExamples(byDirection, 20);

  return {
    symbol,
    timeframe,
    windowSec: normalizedWindow,
    counts: {
      pine: pine.length,
      local: local.length,
      matched: byDirection.buy.matched + byDirection.sell.matched,
    },
    buy: stripDirectionInternals(byDirection.buy),
    sell: stripDirectionInternals(byDirection.sell),
    overall,
    unmatchedExamples,
  };
}

function buildDirectionStats(direction, pine, local, windowSeconds) {
  const pineRows = pine.filter((row) => row.direction === direction);
  const localRows = local.filter((row) => row.direction === direction);
  const localTaken = new Set();
  const pairs = [];

  for (const pineRow of pineRows) {
    let bestIndex = -1;
    let bestDelta = Infinity;
    for (let index = 0; index < localRows.length; index += 1) {
      if (localTaken.has(index)) {
        continue;
      }
      const localRow = localRows[index];
      if (!signalClassesCanMatch(pineRow.signalClass, localRow.signalClass)) {
        continue;
      }
      const delta = Math.abs(localRow.tsMs - pineRow.tsMs);
      if (delta > windowSeconds * 1000) {
        continue;
      }
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      localTaken.add(bestIndex);
      pairs.push({
        pine: pineRow,
        local: localRows[bestIndex],
        deltaMs: Math.abs(localRows[bestIndex].tsMs - pineRow.tsMs),
      });
    }
  }

  const matched = pairs.length;
  const precision = localRows.length ? matched / localRows.length : 0;
  const recall = pineRows.length ? matched / pineRows.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const medianTimingSec = median(pairs.map((pair) => pair.deltaMs / 1000));
  const diagnostics = computePairDiagnostics(pairs);
  const unmatchedPine = pineRows.filter((row) => !pairs.some((pair) => pair.pine.signalId === row.signalId));
  const unmatchedLocal = localRows.filter((row) => !pairs.some((pair) => pair.local.signalId === row.signalId));

  return {
    direction,
    pineCount: pineRows.length,
    localCount: localRows.length,
    matched,
    precision,
    recall,
    f1,
    medianTimingSec,
    convictionCompared: diagnostics.convictionCompared,
    convictionMae: diagnostics.convictionMae,
    convictionMedianAbsError: diagnostics.convictionMedianAbsError,
    regimeCompared: diagnostics.regimeCompared,
    regimeMatchRate: diagnostics.regimeMatchRate,
    componentCompared: diagnostics.componentCompared,
    componentMatchRate: diagnostics.componentMatchRate,
    signalClassCompared: diagnostics.signalClassCompared,
    signalClassMatchRate: diagnostics.signalClassMatchRate,
    componentComparedByKey: diagnostics.componentComparedByKey,
    componentMatchedByKey: diagnostics.componentMatchedByKey,
    componentMatchRateByKey: diagnostics.componentMatchRateByKey,
    unmatchedPine,
    unmatchedLocal,
  };
}

function buildOverallStats(byDirection) {
  const pineTotal = byDirection.buy.pineCount + byDirection.sell.pineCount;
  const localTotal = byDirection.buy.localCount + byDirection.sell.localCount;
  const matchedTotal = byDirection.buy.matched + byDirection.sell.matched;
  const precision = localTotal ? matchedTotal / localTotal : 0;
  const recall = pineTotal ? matchedTotal / pineTotal : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const medianTimingSec = median([
    byDirection.buy.matched > 0 ? byDirection.buy.medianTimingSec : null,
    byDirection.sell.matched > 0 ? byDirection.sell.medianTimingSec : null,
  ].filter((value) => Number.isFinite(value)));
  const convictionMetrics = mergeRatioMetrics({
    leftCount: byDirection.buy.convictionCompared,
    leftValue: byDirection.buy.convictionMae,
    rightCount: byDirection.sell.convictionCompared,
    rightValue: byDirection.sell.convictionMae,
  });
  const regimeMetrics = mergeRatioMetrics({
    leftCount: byDirection.buy.regimeCompared,
    leftValue: byDirection.buy.regimeMatchRate,
    rightCount: byDirection.sell.regimeCompared,
    rightValue: byDirection.sell.regimeMatchRate,
  });
  const componentMetrics = mergeRatioMetrics({
    leftCount: byDirection.buy.componentCompared,
    leftValue: byDirection.buy.componentMatchRate,
    rightCount: byDirection.sell.componentCompared,
    rightValue: byDirection.sell.componentMatchRate,
  });
  const signalClassMetrics = mergeRatioMetrics({
    leftCount: byDirection.buy.signalClassCompared,
    leftValue: byDirection.buy.signalClassMatchRate,
    rightCount: byDirection.sell.signalClassCompared,
    rightValue: byDirection.sell.signalClassMatchRate,
  });

  return {
    precision: round6(precision),
    recall: round6(recall),
    f1: round6(f1),
    medianTimingSec: round6(medianTimingSec || 0),
    convictionMae: round6(convictionMetrics.value || 0),
    regimeMatchRate: round6(regimeMetrics.value || 0),
    componentMatchRate: round6(componentMetrics.value || 0),
    signalClassMatchRate: round6(signalClassMetrics.value || 0),
  };
}

function buildUnmatchedExamples(byDirection, limit) {
  const examples = [];
  for (const direction of ["buy", "sell"]) {
    for (const row of byDirection[direction].unmatchedPine.slice(0, limit)) {
      examples.push({
        source: "pine",
        direction,
        signalId: row.signalId,
        ts: row.ts,
        symbol: row.symbol,
      });
      if (examples.length >= limit) {
        return examples;
      }
    }
    for (const row of byDirection[direction].unmatchedLocal.slice(0, limit)) {
      examples.push({
        source: "local",
        direction,
        signalId: row.signalId,
        ts: row.ts,
        symbol: row.symbol,
      });
      if (examples.length >= limit) {
        return examples;
      }
    }
  }
  return examples;
}

function computePairDiagnostics(pairs) {
  const convictionErrors = [];
  let convictionCompared = 0;
  let regimeCompared = 0;
  let regimeMatched = 0;
  let signalClassCompared = 0;
  let signalClassMatched = 0;
  let componentCompared = 0;
  let componentMatched = 0;
  const componentComparedByKey = Object.fromEntries(COMPONENT_KEYS.map((key) => [key, 0]));
  const componentMatchedByKey = Object.fromEntries(COMPONENT_KEYS.map((key) => [key, 0]));

  for (const pair of pairs) {
    if (Number.isFinite(pair.pine.conviction) && Number.isFinite(pair.local.conviction)) {
      convictionCompared += 1;
      convictionErrors.push(Math.abs(pair.pine.conviction - pair.local.conviction));
    }

    if (pair.pine.regime && pair.local.regime) {
      regimeCompared += 1;
      if (pair.pine.regime === pair.local.regime) {
        regimeMatched += 1;
      }
    }

    if (pair.pine.signalClass || pair.local.signalClass) {
      signalClassCompared += 1;
      if (signalClassesCanMatch(pair.pine.signalClass, pair.local.signalClass)) {
        signalClassMatched += 1;
      }
    }

    for (const key of COMPONENT_KEYS) {
      const pineComponent = pair.pine.components?.[key];
      const localComponent = pair.local.components?.[key];
      if (!Number.isFinite(pineComponent) || !Number.isFinite(localComponent)) {
        continue;
      }
      componentCompared += 1;
      componentComparedByKey[key] += 1;
      if (pineComponent === localComponent) {
        componentMatched += 1;
        componentMatchedByKey[key] += 1;
      }
    }
  }

  const componentMatchRateByKey = {};
  for (const key of COMPONENT_KEYS) {
    const compared = componentComparedByKey[key];
    componentMatchRateByKey[key] = compared > 0
      ? componentMatchedByKey[key] / compared
      : 0;
  }

  return {
    convictionCompared,
    convictionMae: convictionCompared ? average(convictionErrors) : 0,
    convictionMedianAbsError: convictionCompared ? median(convictionErrors) : 0,
    regimeCompared,
    regimeMatchRate: regimeCompared ? regimeMatched / regimeCompared : 0,
    signalClassCompared,
    signalClassMatchRate: signalClassCompared ? signalClassMatched / signalClassCompared : 0,
    componentCompared,
    componentMatchRate: componentCompared ? componentMatched / componentCompared : 0,
    componentComparedByKey,
    componentMatchedByKey,
    componentMatchRateByKey,
  };
}

function mergeRatioMetrics({ leftCount, leftValue, rightCount, rightValue }) {
  const aCount = Number(leftCount) || 0;
  const bCount = Number(rightCount) || 0;
  const total = aCount + bCount;
  if (total <= 0) {
    return { count: 0, value: 0 };
  }
  return {
    count: total,
    value: (((Number(leftValue) || 0) * aCount) + ((Number(rightValue) || 0) * bCount)) / total,
  };
}

function stripDirectionInternals(stats) {
  const componentByKey = {};
  for (const key of COMPONENT_KEYS) {
    componentByKey[key] = round6(stats.componentMatchRateByKey?.[key] || 0);
  }

  return {
    precision: round6(stats.precision),
    recall: round6(stats.recall),
    f1: round6(stats.f1),
    medianTimingSec: round6(stats.medianTimingSec || 0),
    convictionMae: round6(stats.convictionMae || 0),
    convictionMedianAbsError: round6(stats.convictionMedianAbsError || 0),
    regimeMatchRate: round6(stats.regimeMatchRate || 0),
    componentMatchRate: round6(stats.componentMatchRate || 0),
    signalClassMatchRate: round6(stats.signalClassMatchRate || 0),
    componentMatchByKey: componentByKey,
    pine: stats.pineCount,
    local: stats.localCount,
    matched: stats.matched,
  };
}

function normalizeSignals(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const ts = row?.ts || row?.barTime || row?.receivedAt || row?.createdAt;
      const tsMs = parseTimestamp(ts);
      const direction = normalizeDirection(row?.direction || row?.action || row?.side);
      if (!Number.isFinite(tsMs) || !direction) {
        return null;
      }
      return {
        signalId: row.signalId || `${direction}:${tsMs}:${row?.source || "unknown"}`,
        ts,
        tsMs,
        direction,
        symbol: row.symbol || null,
        eventType: String(row?.eventType || row?.meta?.eventType || "").trim().toLowerCase() || null,
        signalClass: normalizeRayAlgoSignalClass(
          row?.signalClass || row?.meta?.signalClass || row?.eventType || row?.meta?.eventType || null,
          null,
        ),
        conviction: toFiniteNumber(row?.conviction),
        regime: normalizeRegime(row?.regime),
        components: normalizeComponents(row?.components),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.tsMs - b.tsMs);
}

function signalClassesCanMatch(left, right) {
  const normalizedLeft = normalizeRayAlgoSignalClass(left, null);
  const normalizedRight = normalizeRayAlgoSignalClass(right, null);
  if (!normalizedLeft || !normalizedRight) {
    return true;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return (
    (normalizedLeft === RAYALGO_EVENT_TYPE_TREND_CHANGE && normalizedRight == null)
    || (normalizedRight === RAYALGO_EVENT_TYPE_TREND_CHANGE && normalizedLeft == null)
  );
}

function parseTimestamp(value) {
  if (value == null || value === "") {
    return NaN;
  }
  if (typeof value === "number") {
    return value > 100000000000 ? value : value * 1000;
  }
  const text = String(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeDirection(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("b") || text === "long") {
    return "buy";
  }
  if (text.startsWith("s") || text === "short") {
    return "sell";
  }
  return null;
}

function normalizeRegime(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "bull" || text === "bear" || text === "range") {
    return text;
  }
  return null;
}

function normalizeComponents(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const normalized = {};
  for (const key of COMPONENT_KEYS) {
    normalized[key] = normalizeSigned(value[key]);
  }
  return normalized;
}

function normalizeSigned(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 0) return 1;
    if (numeric < 0) return -1;
    return 0;
  }
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  if (text === "buy" || text === "long" || text === "bull" || text === "up" || text === "true") {
    return 1;
  }
  if (text === "sell" || text === "short" || text === "bear" || text === "down" || text === "false") {
    return -1;
  }
  return 0;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function median(values) {
  const rows = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!rows.length) {
    return 0;
  }
  const mid = Math.floor(rows.length / 2);
  if (rows.length % 2 === 1) {
    return rows[mid];
  }
  return (rows[mid - 1] + rows[mid]) / 2;
}

function average(values) {
  const rows = values.filter((value) => Number.isFinite(value));
  if (!rows.length) {
    return 0;
  }
  return rows.reduce((sum, value) => sum + value, 0) / rows.length;
}

function round6(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}
