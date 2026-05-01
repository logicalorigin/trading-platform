const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const nonEmptyString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const upper = (value) => (nonEmptyString(value) || "").toUpperCase();

const lower = (value) => (nonEmptyString(value) || "").toLowerCase();

const finiteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateKey = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const numbersDiffer = (left, right, tolerance = 0.005) => {
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  if (leftNumber === null && rightNumber === null) return false;
  if (leftNumber === null || rightNumber === null) return true;
  return Math.abs(leftNumber - rightNumber) > tolerance;
};

const plannedContractFields = (contract) => {
  const value = asRecord(contract);
  return {
    expirationDate: dateKey(value.expirationDate),
    strike: finiteNumber(value.strike),
    right: lower(value.right) === "put" ? "put" : "call",
    providerContractId: nonEmptyString(value.providerContractId),
  };
};

const actualContractFields = (contract) => {
  const value = asRecord(contract);
  return {
    expirationDate: dateKey(value.expirationDate),
    strike: finiteNumber(value.strike),
    right: lower(value.right) === "put" ? "put" : "call",
    providerContractId: nonEmptyString(value.providerContractId),
  };
};

export function buildSignalOptionsDeviation(automationContext, orderRequest) {
  const candidate = asRecord(automationContext);
  const actual = asRecord(orderRequest);
  const deploymentId = nonEmptyString(candidate.deploymentId);
  const candidateId = nonEmptyString(candidate.id);
  const symbol = upper(candidate.symbol || actual.symbol);
  if (!deploymentId || !candidateId || !symbol || !Object.keys(actual).length) {
    return null;
  }

  const plannedContract = asRecord(candidate.selectedContract);
  const plannedOrderPlan = asRecord(candidate.orderPlan);
  const actualContract = asRecord(actual.optionContract);
  const planned = plannedContractFields(plannedContract);
  const resolvedActual = actualContractFields(actualContract);
  const changedFields = [];

  if (upper(actual.symbol) !== symbol) {
    changedFields.push("symbol");
  }

  if (
    planned.expirationDate !== resolvedActual.expirationDate ||
    numbersDiffer(planned.strike, resolvedActual.strike, 0) ||
    planned.right !== resolvedActual.right
  ) {
    changedFields.push("contract");
  }

  if (
    (planned.providerContractId || resolvedActual.providerContractId) &&
    planned.providerContractId !== resolvedActual.providerContractId
  ) {
    changedFields.push("provider_contract_id");
  }

  if (numbersDiffer(plannedOrderPlan.quantity, actual.quantity, 0)) {
    changedFields.push("quantity");
  }

  if (lower(actual.side) !== "buy") {
    changedFields.push("side");
  }

  if (lower(actual.type) !== "limit") {
    changedFields.push("order_type");
  }

  if (numbersDiffer(plannedOrderPlan.entryLimitPrice, actual.limitPrice)) {
    changedFields.push("limit_price");
  }

  if (actual.stopPrice != null) {
    changedFields.push("stop_price");
  }

  if (lower(actual.timeInForce || "day") !== "day") {
    changedFields.push("time_in_force");
  }

  if (!changedFields.length) {
    return null;
  }

  return {
    deploymentId,
    payload: {
      candidateId,
      symbol,
      source: "trade_preview",
      changedFields,
      plannedContract,
      plannedOrderPlan,
      actualOrderRequest: actual,
      automationCandidate: candidate,
      metadata: {
        deploymentName: nonEmptyString(candidate.deploymentName),
        plannedDirection: lower(candidate.direction),
        plannedOptionRight: planned.right,
      },
    },
  };
}
