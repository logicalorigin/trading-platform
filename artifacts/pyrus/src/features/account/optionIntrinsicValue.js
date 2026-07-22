const positiveFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export const optionIntrinsicValue = (optionContract, underlyingPrice) => {
  const spot = positiveFiniteNumber(underlyingPrice);
  const strike = positiveFiniteNumber(optionContract?.strike);
  const right = String(optionContract?.right ?? optionContract?.cp ?? "")
    .trim()
    .toLowerCase();
  if (spot == null || strike == null) return null;
  if (right === "call" || right === "c") {
    return Math.max(0, spot - strike);
  }
  if (right === "put" || right === "p") {
    return Math.max(0, strike - spot);
  }
  return null;
};

export const floorOptionMarkAtIntrinsic = ({
  mark,
  optionContract,
  underlyingPrice,
}) => {
  const quoteMark = positiveFiniteNumber(mark);
  if (quoteMark == null) return null;
  const intrinsic = optionIntrinsicValue(optionContract, underlyingPrice);
  return intrinsic == null ? quoteMark : Math.max(quoteMark, intrinsic);
};
