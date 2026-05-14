const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(asRecord(value), key);

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const topCockpitCounterEntries = (counter, limit = 4) =>
  Object.entries(asRecord(counter))
    .map(([label, count]) => [label, Number(count)])
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);

const incrementCounter = (counter, value) => {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
};

const deriveReasonCounters = (events) => {
  const skipReasons = {};
  const entryGateReasons = {};
  const optionChainReasons = {};

  events.forEach((event) => {
    const payload = asRecord(asRecord(event).payload);
    incrementCounter(skipReasons, payload.reason || payload.skipReason);

    const entryGate = asRecord(payload.entryGate);
    if (Array.isArray(entryGate.reasons)) {
      entryGate.reasons.forEach((reason) =>
        incrementCounter(entryGateReasons, reason),
      );
    }

    incrementCounter(optionChainReasons, asRecord(payload.chainDebug).reason);
    incrementCounter(
      optionChainReasons,
      asRecord(payload.expirationsDebug).reason,
    );
  });

  return {
    skipReasons,
    entryGateReasons,
    optionChainReasons,
  };
};

const countBlockedCandidates = (candidates) =>
  candidates.filter((candidate) => {
    const record = asRecord(candidate);
    return record.actionStatus === "blocked" || record.status === "skipped";
  }).length;

const countFilledCandidates = (candidates) =>
  candidates.filter((candidate) =>
    ["shadow_filled", "partial_shadow", "closed"].includes(
      String(asRecord(candidate).actionStatus || ""),
    ),
  ).length;

const countEventsOfType = (events, eventType) =>
  events.filter(
    (event) => asRecord(event).eventType === eventType,
  ).length;

const orderedMetricRows = (metrics, keys, limit = 4) =>
  keys
    .map((key) => [key, finiteNumber(asRecord(metrics)[key])])
    .filter(([, count]) => count > 0)
    .slice(0, limit);

const readinessIncidentRows = (incidents, limit = 4) =>
  (Array.isArray(incidents) ? incidents : [])
    .map((incident) => {
      const record = asRecord(incident);
      const source = String(record.source || "unknown");
      const reason = String(record.reason || "unknown");
      return [`${source} / ${reason}`, finiteNumber(record.count)];
    })
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);

export const buildCockpitGateSummary = (cockpit) => {
  const record = asRecord(cockpit);
  const diagnostics = asRecord(record.diagnostics);
  const signalFreshness = asRecord(diagnostics.signalFreshness);
  const tradePath = asRecord(diagnostics.tradePath);
  const kpis = asRecord(record.kpis);
  const signals = Array.isArray(record.signals) ? record.signals : [];
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const events = Array.isArray(record.events) ? record.events : [];
  const fallbackFresh = signals.filter(
    (signal) => asRecord(signal).fresh === true,
  ).length;
  const fallbackNotFresh = Math.max(0, signals.length - fallbackFresh);
  const fallbackEntryEvents = countEventsOfType(
    events,
    "signal_options_shadow_entry",
  );
  const reasonCounters = deriveReasonCounters(events);
  const diagnosticsHasFreshness =
    hasOwn(signalFreshness, "fresh") || hasOwn(signalFreshness, "notFresh");
  const diagnosticsHasTradePath =
    hasOwn(tradePath, "blockedCandidates") ||
    hasOwn(tradePath, "shadowFilledCandidates");
  const diagnosticSkipRows = topCockpitCounterEntries(diagnostics.skipReasons);
  const diagnosticEntryRows = topCockpitCounterEntries(
    diagnostics.entryGateReasons,
  );
  const diagnosticOptionRows = topCockpitCounterEntries(
    diagnostics.optionChainReasons,
  );
  const diagnosticSkipCategoryRows = topCockpitCounterEntries(
    diagnostics.skipCategories,
  );
  const lifecycle = asRecord(diagnostics.lifecycle);
  const markHealth = asRecord(diagnostics.markHealth);

  return {
    signalFreshness: {
      fresh: diagnosticsHasFreshness
        ? finiteNumber(signalFreshness.fresh)
        : fallbackFresh,
      notFresh: diagnosticsHasFreshness
        ? finiteNumber(signalFreshness.notFresh)
        : fallbackNotFresh,
    },
    tradePath: {
      blockedCandidates: diagnosticsHasTradePath
        ? finiteNumber(tradePath.blockedCandidates)
        : finiteNumber(kpis.blockedCandidates, countBlockedCandidates(candidates)),
      shadowFilledCandidates: diagnosticsHasTradePath
        ? finiteNumber(tradePath.shadowFilledCandidates)
        : Math.max(
            finiteNumber(kpis.shadowFilledCandidates),
            countFilledCandidates(candidates),
            fallbackEntryEvents,
          ),
      markEvents: diagnosticsHasTradePath
        ? finiteNumber(tradePath.markEvents)
        : countEventsOfType(events, "signal_options_shadow_mark"),
      gatewayBlocks: diagnosticsHasTradePath
        ? finiteNumber(tradePath.gatewayBlocks)
        : countEventsOfType(events, "signal_options_gateway_blocked"),
      activePositions: diagnosticsHasTradePath
        ? finiteNumber(tradePath.activePositions)
        : finiteNumber(kpis.activePositions),
    },
    skipReasonRows: diagnosticSkipRows.length
      ? diagnosticSkipRows
      : topCockpitCounterEntries(reasonCounters.skipReasons),
    skipCategoryRows: diagnosticSkipCategoryRows,
    entryGateRows: diagnosticEntryRows.length
      ? diagnosticEntryRows
      : topCockpitCounterEntries(reasonCounters.entryGateReasons),
    optionChainRows: diagnosticOptionRows.length
      ? diagnosticOptionRows
      : topCockpitCounterEntries(reasonCounters.optionChainReasons),
    readinessRows: readinessIncidentRows(diagnostics.readinessIncidents),
    lifecycleRows: orderedMetricRows(lifecycle, [
      "candidates",
      "contractsSelected",
      "liquidityAccepted",
      "shadowEntries",
      "shadowMarks",
      "shadowExits",
    ]),
    markHealthRows: orderedMetricRows(markHealth, [
      "activePositions",
      "fresh",
      "stale",
      "unmarked",
      "markFailures",
    ]),
  };
};

export const buildAttentionStream = ({
  attentionItems = [],
  ruleAdherence = [],
  gatewayReady = true,
  gatewayBlocks = 0,
} = {}) => {
  const stream = [];
  (Array.isArray(attentionItems) ? attentionItems : []).forEach((item, index) => {
    const record = asRecord(item);
    stream.push({
      id: record.id || `attention-${index}`,
      kind: "attention",
      kindLabel: record.stage ? String(record.stage).toUpperCase() : "ATTENTION",
      severity: record.severity || "info",
      title: record.symbol || record.title || record.stage || "Attention",
      summary: record.summary || record.detail || "",
    });
  });
  (Array.isArray(ruleAdherence) ? ruleAdherence : []).forEach((rule, index) => {
    const record = asRecord(rule);
    const status = record.status;
    if (status !== "fail" && status !== "warning") return;
    stream.push({
      id: `rule-${record.id || index}`,
      kind: "rule",
      kindLabel: "RULE",
      severity: status === "fail" ? "critical" : "warning",
      title: record.label || record.id || "Rule",
      summary: record.detail || "",
    });
  });
  if (!gatewayReady) {
    stream.push({
      id: "gateway-not-ready",
      kind: "gateway",
      kindLabel: "GATEWAY",
      severity: "warning",
      title: "Data bridge not ready",
      summary: "Start the broker bridge to resume signal evaluation.",
    });
  }
  if (finiteNumber(gatewayBlocks) > 0) {
    stream.push({
      id: "gateway-blocks",
      kind: "gateway",
      kindLabel: "GATEWAY",
      severity: "warning",
      title: `${finiteNumber(gatewayBlocks)} gateway blocks`,
      summary: "Recent candidates were rejected at the gateway. Inspect events.",
    });
  }
  return stream;
};

export const isDiagRowsHealthy = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  return rows.every((row) => {
    const count = Array.isArray(row) ? row[1] : null;
    return finiteNumber(count) === 0;
  });
};

export const isGateSummaryHealthy = (tradePath) => {
  const record = asRecord(tradePath);
  return (
    finiteNumber(record.blockedCandidates) === 0 &&
    finiteNumber(record.gatewayBlocks) === 0
  );
};
