export type AccountReturnPointInput = {
  netLiquidation: number;
  deposits?: number | null;
  withdrawals?: number | null;
};

export type TransferAdjustedReturnPoint = {
  externalTransfer: number;
  pnlDelta: number;
  cumulativePnl: number;
  capitalBase: number;
  returnPercent: number;
};

export type TransferAdjustedReturnSummary = {
  startNav: number | null;
  transferAdjustedPreviousNav: number | null;
  transferAdjustedStartNav: number | null;
  endNav: number | null;
  capitalBase: number | null;
  cumulativePnl: number | null;
  returnPercent: number | null;
};

export function finiteAccountNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function ratioToPercentPoint(value: unknown): number | null {
  const numeric = finiteAccountNumber(value);
  return numeric === null ? null : numeric * 100;
}

export function externalTransferAmount(
  point: Pick<AccountReturnPointInput, "deposits" | "withdrawals">,
): number {
  return (finiteAccountNumber(point.deposits) ?? 0) - (finiteAccountNumber(point.withdrawals) ?? 0);
}

export function calculateTransferAdjustedReturnSeries<T extends AccountReturnPointInput>(
  points: readonly T[],
): TransferAdjustedReturnPoint[] {
  const firstPoint = points[0] ?? null;
  const firstPointTransfer = firstPoint ? externalTransferAmount(firstPoint) : 0;
  const initialPreviousNav = firstPoint
    ? firstPointTransfer > 0
      ? Math.max(0, firstPoint.netLiquidation - firstPointTransfer)
      : firstPoint.netLiquidation - firstPointTransfer
    : null;
  const baseline =
    initialPreviousNav !== null && Math.abs(initialPreviousNav) > 0
      ? initialPreviousNav
      : (firstPoint?.netLiquidation ?? 0);
  let previousNav: number | null = initialPreviousNav;
  let cumulativePnl = 0;
  let capitalBase = Math.max(
    Math.abs(baseline),
    Math.abs(firstPoint?.netLiquidation ?? 0),
  );

  return points.map((point, index) => {
    const transfer = externalTransferAmount(point);
    if (index > 0 && transfer > 0) {
      capitalBase += transfer;
    }
    const pnlDelta =
      previousNav === null ? 0 : point.netLiquidation - previousNav - transfer;
    cumulativePnl += pnlDelta;
    previousNav = point.netLiquidation;

    return {
      externalTransfer: transfer,
      pnlDelta,
      cumulativePnl,
      capitalBase,
      returnPercent: capitalBase ? (cumulativePnl / capitalBase) * 100 : 0,
    };
  });
}

export function calculateTransferAdjustedReturnSummary<T extends AccountReturnPointInput>(
  points: readonly T[],
): TransferAdjustedReturnSummary {
  const firstPoint = points[0] ?? null;
  const firstNav = firstPoint ? finiteAccountNumber(firstPoint.netLiquidation) : null;
  if (firstNav === null) {
    return {
      startNav: null,
      transferAdjustedPreviousNav: null,
      transferAdjustedStartNav: null,
      endNav: null,
      capitalBase: null,
      cumulativePnl: null,
      returnPercent: null,
    };
  }

  const firstTransfer = externalTransferAmount(firstPoint);
  const transferAdjustedPreviousNav =
    firstTransfer > 0 ? Math.max(0, firstNav - firstTransfer) : firstNav - firstTransfer;
  const series = calculateTransferAdjustedReturnSeries(points);
  const last = series[series.length - 1] ?? null;
  const lastPoint = points[points.length - 1] ?? null;

  return {
    startNav: firstNav,
    transferAdjustedPreviousNav,
    transferAdjustedStartNav:
      transferAdjustedPreviousNav !== 0 ? transferAdjustedPreviousNav : firstNav,
    endNav: lastPoint ? finiteAccountNumber(lastPoint.netLiquidation) : null,
    capitalBase: last?.capitalBase ?? null,
    cumulativePnl: last?.cumulativePnl ?? null,
    returnPercent: last?.returnPercent ?? null,
  };
}

export function transferAdjustedPnlDelta<T extends AccountReturnPointInput>(
  currentPoint: T,
  previousPoint: T,
): number | null {
  const previous = finiteAccountNumber(previousPoint.netLiquidation);
  const current = finiteAccountNumber(currentPoint.netLiquidation);
  if (previous === null || current === null) {
    return null;
  }
  return current - previous - externalTransferAmount(currentPoint);
}

export function buildTransferAdjustedPnlSeries<T extends AccountReturnPointInput>(
  points: readonly T[],
): number[] {
  return calculateTransferAdjustedReturnSeries(points).map((point) => point.cumulativePnl);
}
