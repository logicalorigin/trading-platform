const finiteNumber = (value) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveNumber = (value) => {
  const numeric = finiteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
};

export const usesOptionEconomics = (row) => {
  const assetClass = String(row?.assetClass || "").trim().toLowerCase();
  const positionType = String(row?.positionType || "").trim().toLowerCase();
  return Boolean(
    row?.optionContract ||
      row?.selectedContract ||
      assetClass === "option" ||
      assetClass === "options" ||
      positionType === "option" ||
      row?.optionRight,
  );
};

export const strictOptionPositionMultiplier = (row) => {
  if (!usesOptionEconomics(row)) return 1;

  const contracts = [row?.optionContract, row?.selectedContract];
  const candidates = contracts.flatMap((contract) => [
    contract?.multiplier,
    contract?.sharesPerContract,
  ]);
  const multiplier = candidates.map(positiveNumber).find((value) => value != null);
  if (multiplier != null) return multiplier;

  const hasDeclaredEconomics = candidates.some(
    (value) => value != null && !(typeof value === "string" && value.trim() === ""),
  );
  if (hasDeclaredEconomics) return null;

  return contracts.some(
    (contract) => contract?.standardDeliverableVerified === true,
  )
    ? 100
    : null;
};
