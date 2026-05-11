import type { ChartBar, ChartBarRange } from "./types";

export type ChartPositionSurfaceKind = "spot" | "option" | "mini";

export type ChartPositionOptionContract = {
  ticker?: string | null;
  underlying?: string | null;
  expirationDate?: string | Date | null;
  strike?: number | string | null;
  right?: string | null;
  cp?: string | null;
  providerContractId?: string | null;
  multiplier?: number | null;
  sharesPerContract?: number | null;
};

export type ChartPositionOverlayContext = {
  surfaceKind: ChartPositionSurfaceKind;
  symbol: string;
  optionContract?: ChartPositionOptionContract | null;
};

export type ChartPosition = {
  id?: string;
  accountId?: string | null;
  symbol?: string | null;
  assetClass?: string | null;
  quantity?: number | string | null;
  averagePrice?: number | string | null;
  marketPrice?: number | string | null;
  unrealizedPnl?: number | string | null;
  unrealizedPnlPercent?: number | string | null;
  optionContract?: ChartPositionOptionContract | null;
};

export type ChartExecution = {
  id?: string;
  accountId?: string | null;
  symbol?: string | null;
  assetClass?: string | null;
  side?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  executedAt?: string | Date | null;
  occurredAt?: string | Date | null;
  optionContract?: ChartPositionOptionContract | null;
  providerContractId?: string | null;
};

export type ChartPositionDirection = "long" | "short";

export type ChartPositionEntryLine = {
  id: string;
  price: number;
  title: string;
  direction: ChartPositionDirection;
  quantity: number;
  accountId: string | null;
  positionId: string | null;
};

export type ChartPositionFillMarker = {
  id: string;
  time: number;
  barIndex: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  direction: ChartPositionDirection;
  text: string;
  size?: number;
};

export type ChartPositionPnlBubble = {
  id: string;
  anchorPrice: number;
  direction: ChartPositionDirection;
  pnl: number;
  pnlPercent: number | null;
  label: string;
  detail: string;
};

export type ChartPositionOffPaneIndicator = {
  id: string;
  direction: "above" | "below";
  price: number;
  label: string;
};

export type ChartPositionOverlays = {
  density: "full" | "mini";
  entryLines: ChartPositionEntryLine[];
  fillMarkers: ChartPositionFillMarker[];
  pnlBubbles: ChartPositionPnlBubble[];
  offPaneIndicators: ChartPositionOffPaneIndicator[];
};

export type BuildChartPositionOverlaysInput = {
  positions?: ChartPosition[] | null;
  executions?: ChartExecution[] | null;
  chartContext?: ChartPositionOverlayContext | null;
  mark?: number | null;
  chartBars?: ChartBar[] | null;
  chartBarRanges?: ChartBarRange[] | null;
  visiblePriceRange?: { min: number; max: number } | null;
};

export const EMPTY_CHART_POSITION_OVERLAYS: ChartPositionOverlays = {
  density: "full",
  entryLines: [],
  fillMarkers: [],
  pnlBubbles: [],
  offPaneIndicators: [],
};

const normalizeSymbol = (value: unknown): string =>
  String(value || "")
    .trim()
    .toUpperCase();

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeDateKey = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return value.trim().slice(0, 10);
  }
  return "";
};

const normalizeRight = (value: unknown): "call" | "put" | "" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "c" || normalized === "call") return "call";
  if (normalized === "p" || normalized === "put") return "put";
  return "";
};

const optionContractKey = (
  contract?: ChartPositionOptionContract | null,
): string => {
  if (!contract) return "";
  const providerContractId = String(contract.providerContractId || "").trim();
  if (providerContractId) {
    return `provider:${providerContractId}`;
  }
  return [
    normalizeSymbol(contract.underlying || contract.ticker),
    normalizeDateKey(contract.expirationDate),
    finiteNumber(contract.strike),
    normalizeRight(contract.right || contract.cp),
  ].join(":");
};

const optionContractTupleKey = (
  contract?: ChartPositionOptionContract | null,
): string | null => {
  if (!contract) return null;
  const symbol = normalizeSymbol(contract.underlying || contract.ticker);
  const expirationDate = normalizeDateKey(contract.expirationDate);
  const strike = finiteNumber(contract.strike);
  const right = normalizeRight(contract.right || contract.cp);
  if (!symbol || !expirationDate || strike == null || !right) {
    return null;
  }
  return [symbol, expirationDate, strike, right].join(":");
};

const sameOptionContract = (
  left?: ChartPositionOptionContract | null,
  right?: ChartPositionOptionContract | null,
): boolean => {
  if (!left || !right) return false;
  const leftProvider = String(left.providerContractId || "").trim();
  const rightProvider = String(right.providerContractId || "").trim();
  if (leftProvider && rightProvider) {
    return leftProvider === rightProvider;
  }
  const leftTuple = optionContractTupleKey(left);
  const rightTuple = optionContractTupleKey(right);
  return Boolean(leftTuple && rightTuple && leftTuple === rightTuple);
};

const matchesChartContext = (
  item: ChartPosition | ChartExecution,
  context: ChartPositionOverlayContext,
): boolean => {
  const chartSymbol = normalizeSymbol(context.symbol);
  if (!chartSymbol) return false;

  if (context.surfaceKind === "option") {
    const itemContract =
      "optionContract" in item ? item.optionContract : null;
    const directProviderContractId =
      "providerContractId" in item ? item.providerContractId : null;
    return sameOptionContract(
      itemContract || { providerContractId: directProviderContractId },
      context.optionContract,
    );
  }

  if ("optionContract" in item && item.optionContract) {
    return false;
  }
  return normalizeSymbol(item.symbol) === chartSymbol;
};

const formatPrice = (value: number): string =>
  Math.abs(value) >= 100 ? value.toFixed(2) : value.toFixed(3).replace(/0$/, "");

const formatMoney = (value: number): string => {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
};

const formatPercent = (value: number | null): string =>
  value == null ? "" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const resolveMultiplier = (position: ChartPosition): number => {
  if (position.optionContract) {
    return (
      finiteNumber(position.optionContract.multiplier) ??
      finiteNumber(position.optionContract.sharesPerContract) ??
      100
    );
  }
  return 1;
};

const findBarIndexForTimestamp = (
  value: unknown,
  chartBars: ChartBar[],
  chartBarRanges: ChartBarRange[],
): number | null => {
  const timeMs = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  if (!Number.isFinite(timeMs) || !chartBars.length) {
    return null;
  }

  if (chartBarRanges.length === chartBars.length) {
    const rangeIndex = chartBarRanges.findIndex(
      (range) => timeMs >= range.startMs && timeMs < range.endMs,
    );
    return rangeIndex >= 0 ? rangeIndex : null;
  }

  const timeSeconds = Math.floor(timeMs / 1000);
  const first = chartBars[0];
  const last = chartBars[chartBars.length - 1];
  const fallbackStep = Math.max(1, (chartBars[1]?.time ?? last.time + 60) - first.time);
  if (timeSeconds < first.time || timeSeconds >= last.time + fallbackStep) {
    return null;
  }

  let resolvedIndex = 0;
  for (let index = 0; index < chartBars.length; index += 1) {
    if (chartBars[index].time > timeSeconds) break;
    resolvedIndex = index;
  }
  return resolvedIndex;
};

export const buildChartPositionOverlays = ({
  positions = [],
  executions = [],
  chartContext = null,
  mark = null,
  chartBars = [],
  chartBarRanges = [],
  visiblePriceRange = null,
}: BuildChartPositionOverlaysInput): ChartPositionOverlays => {
  if (!chartContext) {
    return EMPTY_CHART_POSITION_OVERLAYS;
  }

  const density = chartContext.surfaceKind === "mini" ? "mini" : "full";
  const resolvedChartBars = chartBars || [];
  const resolvedChartBarRanges = chartBarRanges || [];
  const matchedPositions = (positions || [])
    .filter((position) => matchesChartContext(position, chartContext))
    .filter((position) => {
      const quantity = finiteNumber(position.quantity);
      const averagePrice = finiteNumber(position.averagePrice);
      return Boolean(quantity && Math.abs(quantity) > 1e-9 && averagePrice != null);
    });

  if (!matchedPositions.length) {
    return { ...EMPTY_CHART_POSITION_OVERLAYS, density };
  }

  const entryLines: ChartPositionEntryLine[] = [];
  const pnlBubbles: ChartPositionPnlBubble[] = [];
  const offPaneIndicators: ChartPositionOffPaneIndicator[] = [];

  matchedPositions.forEach((position, index) => {
    const quantity = finiteNumber(position.quantity) ?? 0;
    const averagePrice = finiteNumber(position.averagePrice) ?? 0;
    const fallbackMarketPrice = finiteNumber(position.marketPrice);
    const anchorPrice = finiteNumber(mark) ?? fallbackMarketPrice ?? averagePrice;
    const direction: ChartPositionDirection = quantity >= 0 ? "long" : "short";
    const positionId = position.id ? String(position.id) : null;
    const id =
      positionId ||
      `${normalizeSymbol(position.symbol)}:${optionContractKey(position.optionContract)}:${index}`;

    const multiplier = resolveMultiplier(position);
    const computedPnl = (anchorPrice - averagePrice) * quantity * multiplier;
    const pnl = finiteNumber(mark) == null
      ? finiteNumber(position.unrealizedPnl) ?? computedPnl
      : computedPnl;
    const denominator = Math.abs(averagePrice * quantity * multiplier);
    const pnlPercent =
      denominator > 0
        ? (pnl / denominator) * 100
        : finiteNumber(position.unrealizedPnlPercent);

    const title = direction === "long" ? "LONG" : "SHORT";
    const line: ChartPositionEntryLine = {
      id,
      price: averagePrice,
      title,
      direction,
      quantity,
      accountId: position.accountId ? String(position.accountId) : null,
      positionId,
    };

    if (
      density === "mini" &&
      visiblePriceRange &&
      Number.isFinite(visiblePriceRange.min) &&
      Number.isFinite(visiblePriceRange.max) &&
      (averagePrice < visiblePriceRange.min || averagePrice > visiblePriceRange.max)
    ) {
      offPaneIndicators.push({
        id,
        direction: averagePrice > visiblePriceRange.max ? "above" : "below",
        price: averagePrice,
        label: formatPrice(averagePrice),
      });
    } else {
      entryLines.push(line);
    }

    pnlBubbles.push({
      id,
      anchorPrice,
      direction,
      pnl,
      pnlPercent,
      label: formatMoney(pnl),
      detail: `${quantity >= 0 ? "+" : ""}${quantity} @ ${formatPrice(averagePrice)} ${formatPercent(pnlPercent)}`.trim(),
    });
  });

  const fillMarkers =
    density === "mini"
      ? []
      : (executions || [])
          .filter((execution) => matchesChartContext(execution, chartContext))
          .flatMap<ChartPositionFillMarker>((execution, index) => {
            const barIndex = findBarIndexForTimestamp(
              execution.executedAt || execution.occurredAt,
              resolvedChartBars,
              resolvedChartBarRanges,
            );
            const price = finiteNumber(execution.price);
            const quantity = finiteNumber(execution.quantity);
            const side = String(execution.side || "").toLowerCase();
            if (barIndex == null || price == null || quantity == null) {
              return [];
            }
            const buy = side === "buy";
            return [
              {
                id: execution.id ? String(execution.id) : `execution-${barIndex}-${index}`,
                time: resolvedChartBars[barIndex].time,
                barIndex,
                position: buy ? "belowBar" : "aboveBar",
                shape: buy ? "arrowUp" : "arrowDown",
                direction: buy ? "long" : "short",
                text: `${buy ? "B" : "S"} ${Math.abs(quantity)} @ ${formatPrice(price)}`,
                size: 1,
              },
            ];
          });

  return {
    density,
    entryLines,
    fillMarkers,
    pnlBubbles,
    offPaneIndicators,
  };
};
