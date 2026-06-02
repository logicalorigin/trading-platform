import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";

export const AUDIT_PAGE_SIZE = 40;

export const AUDIT_STAGE_CHIPS = [
  { id: "signal", label: "Signal", matches: (type) => /signal/.test(type) && !/options/.test(type) },
  { id: "candidate", label: "Candidate", matches: (type) => /candidate/.test(type) },
  { id: "eligible", label: "Eligible", matches: (type) => /eligible/.test(type) },
  { id: "submitted", label: "Submitted", matches: (type) => /submit|order|entry/.test(type) && !/skipped|blocked/.test(type) },
  { id: "filled", label: "Filled", matches: (type) => /fill|filled/.test(type) },
  { id: "managed", label: "Managed", matches: (type) => /mark|managed|position/.test(type) && !/skipped|blocked|failed|unavailable/.test(type) },
  { id: "closed", label: "Closed", matches: (type) => /closed|exit/.test(type) },
  { id: "blocked", label: "Blocked", matches: (type) => /blocked|skipped|gateway/.test(type) },
  { id: "config", label: "Config", matches: (type) => /strategy_settings|profile|enabled|paused|deployment/.test(type) },
];

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const nonEmptyRecord = (value) => {
  const record = asRecord(value);
  return Object.keys(record).length ? record : null;
};

const firstRecord = (...values) => {
  for (const value of values) {
    const record = nonEmptyRecord(value);
    if (record) return record;
  }
  return {};
};

const finiteNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const normalizeAuditKeyText = (value) => String(value || "").trim().toUpperCase();

const addAuditKey = (keys, type, value) => {
  const text = normalizeAuditKeyText(value);
  if (text) keys.add(`${type}:${text}`);
};

const timestampMs = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRight = (value) => {
  const right = String(value || "").trim().toLowerCase();
  if (right === "call" || right === "c") return "C";
  if (right === "put" || right === "p") return "P";
  return right ? right.toUpperCase() : "";
};

const formatStrike = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: numeric % 1 === 0 ? 0 : 2,
  });
};

export const resolveAuditStage = (eventType) => {
  const type = String(eventType || "").toLowerCase();
  return AUDIT_STAGE_CHIPS.find((chip) => chip.matches(type)) || {
    id: "event",
    label: "Event",
    matches: () => false,
  };
};

export const matchesAuditStage = (eventType, stageIds) => {
  if (!stageIds.length) return true;
  const type = String(eventType || "").toLowerCase();
  return stageIds.some((id) => {
    const chip = AUDIT_STAGE_CHIPS.find((entry) => entry.id === id);
    return chip ? chip.matches(type) : false;
  });
};

const normalizeAuditContract = (payload) => {
  const position = asRecord(payload.position);
  const candidate = asRecord(payload.candidate);
  const contract = firstRecord(
    payload.selectedContract,
    position.selectedContract,
    candidate.selectedContract,
    payload.contract,
  );
  const underlying = firstText(contract.underlying, candidate.symbol, position.symbol);
  const expirationDate = firstText(contract.expirationDate, contract.expiration);
  const strike = finiteNumber(contract.strike);
  const right = normalizeRight(contract.right || contract.optionRight);
  const ticker = firstText(contract.ticker, contract.optionTicker, contract.symbol);
  const providerContractId = firstText(contract.providerContractId, contract.conid);
  const strikeLabel = formatStrike(strike);
  const contractLabel = [
    expirationDate,
    strikeLabel && right ? `${strikeLabel}${right}` : strikeLabel || right,
  ].filter(Boolean).join(" ");

  return {
    expirationDate,
    providerContractId,
    right,
    strike,
    ticker,
    underlying,
    label: contractLabel || ticker || providerContractId || "",
  };
};

const normalizeAuditQuote = (payload) => {
  const candidate = asRecord(payload.candidate);
  const quote = firstRecord(payload.quote, candidate.quote, payload.optionQuote);
  return {
    ask: finiteNumber(quote.ask),
    bid: finiteNumber(quote.bid),
    last: finiteNumber(quote.last),
    mark: finiteNumber(quote.mark),
    marketDataMode: firstText(quote.marketDataMode),
    quoteFreshness: firstText(quote.quoteFreshness),
    updatedAt: firstText(quote.quoteUpdatedAt, quote.dataUpdatedAt, quote.updatedAt),
  };
};

export const normalizeAuditEvent = (event) => {
  const payload = asRecord(event?.payload);
  const metadata = asRecord(payload.metadata);
  const readiness = asRecord(payload.readiness);
  const position = asRecord(payload.position);
  const candidate = asRecord(payload.candidate);
  const candidateSignal = asRecord(candidate.signal);
  const orderPlan = asRecord(payload.orderPlan || candidate.orderPlan);
  const liquidity = asRecord(payload.liquidity || orderPlan.liquidity);
  const markResolution = asRecord(payload.markResolution);
  const stop = asRecord(payload.stop);
  const contract = normalizeAuditContract(payload);
  const quote = normalizeAuditQuote(payload);
  const stage = resolveAuditStage(event?.eventType);
  const candidateId = firstText(
    payload.candidateId,
    candidate.id,
    position.candidateId,
    orderPlan.candidateId,
  );
  const signalKey = firstText(
    payload.signalKey,
    candidate.signalKey,
    candidateSignal.signalKey,
    position.signalKey,
  );
  const reason = firstText(
    payload.reason,
    orderPlan.reason,
    readiness.reason,
    payload.message,
  );
  const source = firstText(
    payload.source,
    metadata.runSource,
    markResolution.source,
    quote.marketDataMode,
  );
  const symbol = firstText(event?.symbol, contract.underlying, candidate.symbol, position.symbol).toUpperCase();
  const quantity = finiteNumber(position.quantity, orderPlan.quantity, payload.quantity);
  const premiumAtRisk = finiteNumber(position.premiumAtRisk, orderPlan.premiumAtRisk, payload.premiumAtRisk);
  const pnl = finiteNumber(payload.pnl, position.pnl, position.unrealizedPnl, position.realizedPnl);
  const stopPrice = finiteNumber(stop.stopPrice, position.stopPrice);
  const count = finiteNumber(payload.count, readiness.count);
  const detailText = firstText(reason, readiness.message, liquidity.reason);
  const searchText = [
    event?.eventType,
    event?.summary,
    symbol,
    event?.providerAccountId,
    stage.label,
    reason,
    readiness.message,
    source,
    contract.label,
    contract.ticker,
    contract.providerContractId,
    normalizeLegacyAlgoBrandText(metadata.deploymentName),
  ].join(" ").toUpperCase();

  return {
    id: event?.id,
    account: firstText(event?.providerAccountId, payload.providerAccountId),
    candidateId,
    contract,
    count,
    detailText,
    eventType: event?.eventType,
    occurredAt: event?.occurredAt,
    payload,
    pnl,
    premiumAtRisk,
    quantity,
    quote,
    reason,
    searchText,
    signalKey,
    source,
    stage,
    stopPrice,
    summary: firstText(event?.summary, event?.eventType),
    symbol,
    metadata: {
      deploymentId: firstText(metadata.deploymentId, event?.deploymentId),
      deploymentName: normalizeLegacyAlgoBrandText(firstText(metadata.deploymentName)),
      runId: firstText(metadata.runId, event?.algoRunId),
      runMode: firstText(metadata.runMode),
    },
  };
};

const auditContractKeys = (contract) => {
  const record = asRecord(contract);
  const keys = new Set();
  addAuditKey(keys, "contract", record.providerContractId || record.conid);
  addAuditKey(keys, "contract", record.ticker || record.optionTicker || record.localSymbol);
  return keys;
};

const signalAuditMatchKeys = (signal, candidate) => {
  const signalRecord = asRecord(signal);
  const candidateRecord = asRecord(candidate);
  const candidateSignal = asRecord(candidateRecord.signal);
  const contractPreview = asRecord(signalRecord.contractPreview);
  const previewContract = asRecord(contractPreview.selectedContract);
  const selectedContract = asRecord(candidateRecord.selectedContract);
  const keys = new Set();
  addAuditKey(keys, "signal", signalRecord.signalKey);
  addAuditKey(keys, "signal", candidateRecord.signalKey);
  addAuditKey(keys, "signal", candidateSignal.signalKey);
  addAuditKey(keys, "candidate", candidateRecord.id);
  addAuditKey(keys, "candidate", signalRecord.signalKey);
  auditContractKeys(previewContract).forEach((key) => keys.add(key));
  auditContractKeys(selectedContract).forEach((key) => keys.add(key));

  const symbol = firstText(
    signalRecord.symbol,
    candidateRecord.symbol,
    candidateSignal.symbol,
  ).toUpperCase();
  const timeframe = firstText(
    signalRecord.timeframe,
    candidateRecord.timeframe,
    candidateSignal.timeframe,
  ).toUpperCase();
  const direction = firstText(
    signalRecord.direction,
    candidateRecord.direction,
    candidateSignal.direction,
  ).toUpperCase();
  if (symbol) {
    addAuditKey(keys, "symbol", symbol);
    addAuditKey(keys, "signal-row", [symbol, timeframe, direction].filter(Boolean).join("|"));
  }
  return keys;
};

const auditEventMatchKeys = (row) => {
  const payload = asRecord(row?.payload);
  const candidate = asRecord(payload.candidate);
  const position = asRecord(payload.position);
  const strongKeys = new Set();
  const fallbackKeys = new Set();
  addAuditKey(strongKeys, "signal", row?.signalKey);
  addAuditKey(strongKeys, "candidate", row?.candidateId);
  addAuditKey(strongKeys, "candidate", candidate.id);
  addAuditKey(strongKeys, "candidate", position.candidateId);
  auditContractKeys(row?.contract).forEach((key) => strongKeys.add(key));
  addAuditKey(fallbackKeys, "symbol", row?.symbol);
  return strongKeys.size ? strongKeys : fallbackKeys;
};

export const signalAuditRowKey = (signal, candidate) => {
  const signalRecord = asRecord(signal);
  const candidateRecord = asRecord(candidate);
  const candidateSignal = asRecord(candidateRecord.signal);
  const symbol = firstText(
    signalRecord.symbol,
    candidateRecord.symbol,
    candidateSignal.symbol,
  ).toUpperCase();
  const timeframe = firstText(
    signalRecord.timeframe,
    candidateRecord.timeframe,
    candidateSignal.timeframe,
  ).toUpperCase();
  const direction = firstText(
    signalRecord.direction,
    candidateRecord.direction,
    candidateSignal.direction,
  ).toUpperCase();
  return firstText(
    signalRecord.signalKey,
    candidateRecord.signalKey,
    candidateSignal.signalKey,
    candidateRecord.id,
    [symbol, timeframe, direction].filter(Boolean).join("|"),
  );
};

const summarizeSignalAuditProgression = (rows) => {
  const events = [...rows]
    .filter((row) => row?.stage?.id !== "config")
    .sort((left, right) => timestampMs(left.occurredAt) - timestampMs(right.occurredAt));
  const stageIds = [];
  events.forEach((row) => {
    const id = row?.stage?.id;
    if (!id || id === "event" || stageIds.includes(id)) return;
    stageIds.push(id);
  });
  const latest = events[events.length - 1] || null;
  const latestStage = latest?.stage || null;
  const detail = firstText(latest?.detailText, latest?.reason, latest?.summary);
  return {
    detail,
    eventCount: events.length,
    events,
    latest,
    latestOccurredAt: latest?.occurredAt || "",
    latestStage,
    searchText: events.map((row) => row.searchText).join(" "),
    stageIds,
  };
};

export const buildSignalAuditProgressions = ({ events = [], rows = [] } = {}) => {
  const rowEntries = rows.map((row, index) => {
    const key = firstText(row?.auditKey, signalAuditRowKey(row?.signal, row?.candidate), `row:${index}`);
    return {
      key,
      matchKeys: signalAuditMatchKeys(row?.signal, row?.candidate),
    };
  });
  const keyToRowKey = new Map();
  rowEntries.forEach((entry) => {
    entry.matchKeys.forEach((matchKey) => {
      if (!keyToRowKey.has(matchKey)) keyToRowKey.set(matchKey, entry.key);
    });
  });
  const buckets = new Map(rowEntries.map((entry) => [entry.key, []]));

  (Array.isArray(events) ? events : [])
    .map(normalizeAuditEvent)
    .forEach((row) => {
      const matchKeys = auditEventMatchKeys(row);
      let rowKey = null;
      for (const matchKey of matchKeys) {
        rowKey = keyToRowKey.get(matchKey);
        if (rowKey) break;
      }
      if (!rowKey || !buckets.has(rowKey)) return;
      buckets.get(rowKey).push(row);
    });

  const progressions = new Map();
  buckets.forEach((bucket, key) => {
    if (!bucket.length) return;
    progressions.set(key, summarizeSignalAuditProgression(bucket));
  });
  return progressions;
};

export const auditRowMatchesQuery = (row, query) => {
  const normalized = String(query || "").trim().toUpperCase();
  if (!normalized) return true;
  return String(row?.searchText || "").includes(normalized);
};

export const buildAuditSummary = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    blocked: safeRows.filter((row) => row.stage.id === "blocked").length,
    config: safeRows.filter((row) => row.stage.id === "config").length,
    latestOccurredAt: safeRows.reduce((latest, row) => {
      const timestamp = Date.parse(row.occurredAt || "");
      return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
    }, 0),
    trades: safeRows.filter((row) =>
      row.stage.id === "submitted" ||
      row.stage.id === "filled" ||
      row.stage.id === "closed",
    ).length,
  };
};
