import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";

export const AUDIT_PAGE_SIZE = 40;

export const AUDIT_STAGE_CHIPS = [
  { id: "signal", label: "Signal", matches: (type) => /signal/.test(type) && !/options/.test(type) },
  { id: "candidate", label: "Candidate", matches: (type) => /candidate/.test(type) },
  { id: "eligible", label: "Eligible", matches: (type) => /eligible/.test(type) },
  { id: "submitted", label: "Submitted", matches: (type) => /submit|order|entry/.test(type) && !/skipped|blocked/.test(type) },
  { id: "filled", label: "Filled", matches: (type) => /fill|filled/.test(type) },
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
  const orderPlan = asRecord(payload.orderPlan || candidate.orderPlan);
  const liquidity = asRecord(payload.liquidity || orderPlan.liquidity);
  const markResolution = asRecord(payload.markResolution);
  const stop = asRecord(payload.stop);
  const contract = normalizeAuditContract(payload);
  const quote = normalizeAuditQuote(payload);
  const stage = resolveAuditStage(event?.eventType);
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
