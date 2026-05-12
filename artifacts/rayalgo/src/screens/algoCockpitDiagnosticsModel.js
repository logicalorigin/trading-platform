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

const countEntryEvents = (events) =>
  events.filter(
    (event) => asRecord(event).eventType === "signal_options_shadow_entry",
  ).length;

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
  const fallbackEntryEvents = countEntryEvents(events);
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
    },
    skipReasonRows: diagnosticSkipRows.length
      ? diagnosticSkipRows
      : topCockpitCounterEntries(reasonCounters.skipReasons),
    entryGateRows: diagnosticEntryRows.length
      ? diagnosticEntryRows
      : topCockpitCounterEntries(reasonCounters.entryGateReasons),
    optionChainRows: diagnosticOptionRows.length
      ? diagnosticOptionRows
      : topCockpitCounterEntries(reasonCounters.optionChainReasons),
  };
};
