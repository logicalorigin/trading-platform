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

export type ChartPositionRiskOverlay = {
  openedAt?: string | Date | null;
  entryPrice?: number | string | null;
  hardStopPrice?: number | string | null;
  stopLossPrice?: number | string | null;
  stopPrice?: number | string | null;
  activeStopPrice?: number | string | null;
  activeStopKind?: string | null;
  takeProfitPrice?: number | string | null;
  profitTargetPrice?: number | string | null;
  targetPrice?: number | string | null;
  trailActive?: boolean | null;
  trailStopPrice?: number | string | null;
  trailHasTakenOver?: boolean | null;
  trailActivationPrice?: number | string | null;
  trailActivationPct?: number | string | null;
  givebackPct?: number | string | null;
  minLockedGainPct?: number | string | null;
  peakPrice?: number | string | null;
};

export type ChartPositionOpenOrder = {
  id?: string | null;
  side?: string | null;
  type?: string | null;
  limitPrice?: number | string | null;
  stopPrice?: number | string | null;
  price?: number | string | null;
  auxPrice?: number | string | null;
  updatedAt?: string | Date | null;
};

export type ChartPositionOverlayContext = {
  surfaceKind: ChartPositionSurfaceKind;
  symbol: string;
  accountId?: string | null;
  optionContract?: ChartPositionOptionContract | null;
};

export type ChartPosition = {
  id?: string;
  accountId?: string | null;
  symbol?: string | null;
  assetClass?: string | null;
  quantity?: number | string | null;
  averagePrice?: number | string | null;
  averageCost?: number | string | null;
  marketPrice?: number | string | null;
  mark?: number | string | null;
  unrealizedPnl?: number | string | null;
  unrealizedPnlPercent?: number | string | null;
  optionContract?: ChartPositionOptionContract | null;
  stopLoss?: number | string | null;
  takeProfit?: number | string | null;
  openedAt?: string | Date | null;
  riskOverlay?: ChartPositionRiskOverlay | null;
  automationContext?: Record<string, unknown> | null;
  lastStop?: Record<string, unknown> | null;
  lastWireTrail?: Record<string, unknown> | null;
  openOrders?: ChartPositionOpenOrder[] | null;
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

export type ChartPositionRiskLineKind =
  | "stopLoss"
  | "hardStop"
  | "takeProfit"
  | "trailingStop";

export type ChartPositionRiskLinePoint = {
  time: number;
  barIndex: number;
  price: number;
};

export type ChartPositionRiskLinePath = {
  id: string;
  kind: ChartPositionRiskLineKind;
  label: "SL" | "HSL" | "TP" | "TRL";
  direction: ChartPositionDirection;
  currentPrice: number;
  points: ChartPositionRiskLinePoint[];
  fallbackOnly: boolean;
  accountId: string | null;
  positionId: string | null;
};

export type ChartPositionOverlays = {
  density: "full" | "mini";
  entryLines: ChartPositionEntryLine[];
  fillMarkers: ChartPositionFillMarker[];
  pnlBubbles: ChartPositionPnlBubble[];
  offPaneIndicators: ChartPositionOffPaneIndicator[];
  riskLinePaths: ChartPositionRiskLinePath[];
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

export type ChartPositionOverlayAccountSection = "real" | "shadow";

export type ChartPositionOverlayAccountRequest = {
  accountId: string | null;
  params?: {
    mode: "paper";
    assetClass: "option" | "stock";
    liveQuotes: false;
  };
};

export const resolveChartPositionOverlayAccountRequest = ({
  accountSection = "real",
  chartContext = null,
  selectedAccountId = null,
}: {
  accountSection?: ChartPositionOverlayAccountSection | null;
  chartContext?: ChartPositionOverlayContext | null;
  selectedAccountId?: string | null;
}): ChartPositionOverlayAccountRequest => {
  const accountId =
    chartContext?.accountId ||
    (accountSection === "shadow" ? "shadow" : selectedAccountId) ||
    null;

  if (accountId !== "shadow") {
    return { accountId };
  }

  return {
    accountId,
    params: {
      mode: "paper",
      assetClass:
        chartContext?.surfaceKind === "option" || chartContext?.optionContract
          ? "option"
          : "stock",
      liveQuotes: false,
    },
  };
};

export const EMPTY_CHART_POSITION_OVERLAYS: ChartPositionOverlays = {
  density: "full",
  entryLines: [],
  fillMarkers: [],
  pnlBubbles: [],
  offPaneIndicators: [],
  riskLinePaths: [],
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

const firstFiniteNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const firstRecord = (...values: unknown[]): Record<string, unknown> => {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
};

const firstDateLike = (...values: unknown[]): string | Date | null => {
  for (const value of values) {
    if (value instanceof Date) return value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const normalizeDateParts = (year: number, month: number, day: number): string => {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : "";
};

const normalizeDateKey = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.trim()) {
    const dateOnlyMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnlyMatch) {
      return normalizeDateParts(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]),
        Number(dateOnlyMatch[3]),
      );
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
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

type ResolvedRiskOverlay = {
  openedAt: string | Date | null;
  entryPrice: number | null;
  hardStopPrice: number | null;
  takeProfitPrice: number | null;
  stopPrice: number | null;
  activeStopPrice: number | null;
  activeStopKind: "hard_stop" | "trailing_stop" | null;
  trailActive: boolean;
  trailStopPrice: number | null;
  trailHasTakenOver: boolean;
  trailActivationPrice: number | null;
  trailActivationPct: number | null;
  givebackPct: number | null;
  minLockedGainPct: number | null;
  peakPrice: number | null;
};

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

const readActiveStopKind = (
  value: unknown,
): "hard_stop" | "trailing_stop" | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "hard_stop" || normalized === "trailing_stop"
    ? normalized
    : null;
};

const trailingStopIsMoreProtective = ({
  direction,
  hardStopPrice,
  trailStopPrice,
}: {
  direction: ChartPositionDirection;
  hardStopPrice: number | null;
  trailStopPrice: number | null;
}): boolean => {
  if (trailStopPrice == null) return false;
  if (hardStopPrice == null) return true;
  return direction === "short"
    ? trailStopPrice < hardStopPrice
    : trailStopPrice > hardStopPrice;
};

const stopPriceLooksLikeTrailingStop = ({
  direction,
  entryPrice,
  stopPrice,
}: {
  direction: ChartPositionDirection;
  entryPrice: number | null;
  stopPrice: number | null;
}): boolean => {
  if (entryPrice == null || stopPrice == null) return false;
  return direction === "short" ? stopPrice < entryPrice : stopPrice > entryPrice;
};

const normalizeOrderSide = (value: unknown): "buy" | "sell" | "" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "buy" || normalized === "bought") return "buy";
  if (normalized === "sell" || normalized === "sold") return "sell";
  return "";
};

const normalizeOrderType = (value: unknown): string =>
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const orderClosesPositionDirection = (
  order: ChartPositionOpenOrder,
  direction: ChartPositionDirection,
): boolean => {
  const side = normalizeOrderSide(order.side);
  if (!side) return true;
  return direction === "short" ? side === "buy" : side === "sell";
};

const selectRiskOrderPrice = ({
  current,
  candidate,
  direction,
  kind,
}: {
  current: number | null;
  candidate: number | null;
  direction: ChartPositionDirection;
  kind: "stop" | "target";
}): number | null => {
  if (candidate == null) return current;
  if (current == null) return candidate;
  if (kind === "target") {
    return direction === "short"
      ? Math.max(current, candidate)
      : Math.min(current, candidate);
  }
  return direction === "short"
    ? Math.min(current, candidate)
    : Math.max(current, candidate);
};

const resolveOpenOrderRiskOverlay = (
  orders: ChartPositionOpenOrder[] | null | undefined,
  direction: ChartPositionDirection,
): {
  hardStopPrice: number | null;
  stopPrice: number | null;
  trailStopPrice: number | null;
  takeProfitPrice: number | null;
  trailActive: boolean;
  activeStopKind: "hard_stop" | "trailing_stop" | null;
} => {
  let hardStopPrice: number | null = null;
  let stopPrice: number | null = null;
  let trailStopPrice: number | null = null;
  let takeProfitPrice: number | null = null;

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (!orderClosesPositionDirection(order, direction)) {
      return;
    }
    const type = normalizeOrderType(order.type);
    const isTrailing =
      type === "trail" ||
      type === "trailing" ||
      type === "trailing_stop" ||
      type === "trail_stop";
    const isStop =
      isTrailing ||
      type === "stop" ||
      type === "stp" ||
      type === "stop_limit" ||
      type === "stp_lmt";
    const isLimit = type === "limit" || type === "lmt";

    if (isStop) {
      const price = firstFiniteNumber(
        order.stopPrice,
        order.auxPrice,
        type === "stop" || type === "stp" ? order.price : null,
      );
      if (isTrailing) {
        trailStopPrice = selectRiskOrderPrice({
          current: trailStopPrice,
          candidate: price,
          direction,
          kind: "stop",
        });
      } else {
        hardStopPrice = selectRiskOrderPrice({
          current: hardStopPrice,
          candidate: price,
          direction,
          kind: "stop",
        });
      }
      stopPrice = selectRiskOrderPrice({
        current: stopPrice,
        candidate: price,
        direction,
        kind: "stop",
      });
      return;
    }

    if (isLimit) {
      takeProfitPrice = selectRiskOrderPrice({
        current: takeProfitPrice,
        candidate: firstFiniteNumber(order.limitPrice, order.price),
        direction,
        kind: "target",
      });
    }
  });

  return {
    hardStopPrice,
    stopPrice,
    trailStopPrice,
    takeProfitPrice,
    trailActive: trailStopPrice != null,
    activeStopKind: trailStopPrice != null ? "trailing_stop" : hardStopPrice != null ? "hard_stop" : null,
  };
};

const resolveRiskOverlay = (
  position: ChartPosition,
  averagePrice: number,
  direction: ChartPositionDirection,
): ResolvedRiskOverlay | null => {
  const explicit = readRecord(position.riskOverlay);
  const automation = readRecord(position.automationContext);
  const lastStop = readRecord(position.lastStop);
  const wireTrail = firstRecord(position.lastWireTrail, lastStop.wireTrail);
  const management = {
    ...firstRecord(lastStop.tradeManagement, lastStop.management, lastStop.greekManagement),
    ...firstRecord(wireTrail.tradeManagement, wireTrail.management, wireTrail.stop),
    ...firstRecord(
    automation.tradeManagement,
    automation.management,
    automation.stop,
    ),
  };
  const openOrderRisk = resolveOpenOrderRiskOverlay(position.openOrders, direction);
  const entryPrice = firstFiniteNumber(
    explicit.entryPrice,
    automation.entryPrice,
    lastStop.entryPrice,
    averagePrice,
  );
  const stopPrice = firstFiniteNumber(
    explicit.stopPrice,
    management.stopPrice,
    automation.stopPrice,
    lastStop.stopPrice,
    lastStop.activeStopPrice,
    wireTrail.stopPrice,
    openOrderRisk.stopPrice,
  );
  const explicitActiveStopPrice = firstFiniteNumber(
    explicit.activeStopPrice,
    management.activeStopPrice,
    automation.activeStopPrice,
    lastStop.activeStopPrice,
  );
  const explicitActiveStopKind = readActiveStopKind(
    explicit.activeStopKind ??
      management.activeStopKind ??
      automation.activeStopKind ??
      lastStop.activeStopKind ??
      openOrderRisk.activeStopKind,
  );
  const takeProfitPrice = firstFiniteNumber(
    explicit.takeProfitPrice,
    explicit.profitTargetPrice,
    explicit.targetPrice,
    position.takeProfit,
    management.takeProfitPrice,
    management.profitTargetPrice,
    management.targetPrice,
    automation.takeProfitPrice,
    automation.profitTargetPrice,
    automation.targetPrice,
    lastStop.takeProfitPrice,
    lastStop.profitTargetPrice,
    lastStop.targetPrice,
    openOrderRisk.takeProfitPrice,
  );
  const explicitTrailStopPrice = firstFiniteNumber(
    explicit.trailStopPrice,
    management.trailStopPrice,
    lastStop.trailStopPrice,
    wireTrail.trailStopPrice,
    openOrderRisk.trailStopPrice,
  );
  const trailActive =
    readBoolean(explicit.trailActive) === true ||
    readBoolean(management.trailActive) === true ||
    readBoolean(lastStop.trailActive) === true ||
    readBoolean(wireTrail.trailActive) === true ||
    openOrderRisk.trailActive ||
    explicitTrailStopPrice != null ||
    stopPriceLooksLikeTrailingStop({ direction, entryPrice, stopPrice });
  const hardStopPrice = firstFiniteNumber(
    explicit.hardStopPrice,
    explicit.stopLossPrice,
    management.hardStopPrice,
    automation.stopLossPrice,
    management.stopLossPrice,
    lastStop.hardStopPrice,
    lastStop.stopLossPrice,
    openOrderRisk.hardStopPrice,
    position.stopLoss,
    trailActive ? null : stopPrice,
  );
  const trailStopPrice = firstFiniteNumber(
    explicitTrailStopPrice,
    trailActive ? stopPrice : null,
  );
  const explicitTrailHasTakenOver =
    readBoolean(explicit.trailHasTakenOver) === true ||
    readBoolean(management.trailHasTakenOver) === true ||
    readBoolean(automation.trailHasTakenOver) === true ||
    readBoolean(lastStop.trailHasTakenOver) === true ||
    readBoolean(wireTrail.trailHasTakenOver) === true ||
    explicitActiveStopKind === "trailing_stop";
  const trailHasTakenOver =
    explicitActiveStopKind === "hard_stop"
      ? false
      : explicitTrailHasTakenOver ||
        (trailActive &&
          trailingStopIsMoreProtective({
            direction,
            hardStopPrice,
            trailStopPrice,
          }));
  const activeStopKind =
    explicitActiveStopKind ??
    (trailHasTakenOver
      ? "trailing_stop"
      : hardStopPrice != null
        ? "hard_stop"
        : trailStopPrice != null
          ? "trailing_stop"
          : null);
  const activeStopPrice =
    explicitActiveStopPrice ??
    (activeStopKind === "trailing_stop" ? trailStopPrice : hardStopPrice) ??
    stopPrice;

  if (hardStopPrice == null && takeProfitPrice == null && trailStopPrice == null) {
    return null;
  }

  return {
    openedAt: firstDateLike(
      explicit.openedAt,
      position.openedAt,
      automation.purchasedAt,
      automation.openedAt,
      automation.signalAt,
    ),
    entryPrice,
    hardStopPrice,
    takeProfitPrice,
    stopPrice,
    activeStopPrice,
    activeStopKind,
    trailActive,
    trailStopPrice,
    trailHasTakenOver,
    trailActivationPrice: firstFiniteNumber(
      explicit.trailActivationPrice,
      management.trailActivationPrice,
      automation.trailActivationPrice,
      lastStop.trailActivationPrice,
      wireTrail.trailActivationPrice,
    ),
    trailActivationPct: firstFiniteNumber(
      explicit.trailActivationPct,
      management.trailActivationPct,
      automation.trailActivationPct,
      lastStop.trailActivationPct,
      wireTrail.trailActivationPct,
    ),
    givebackPct: firstFiniteNumber(
      explicit.givebackPct,
      management.givebackPct,
      automation.givebackPct,
      lastStop.givebackPct,
      wireTrail.givebackPct,
    ),
    minLockedGainPct: firstFiniteNumber(
      explicit.minLockedGainPct,
      management.minLockedGainPct,
      automation.minLockedGainPct,
      lastStop.minLockedGainPct,
      wireTrail.minLockedGainPct,
      0,
    ),
    peakPrice: firstFiniteNumber(
      explicit.peakPrice,
      automation.peakPrice,
      management.peakPrice,
      lastStop.peakPrice,
      wireTrail.peakPrice,
    ),
  };
};

const buildHorizontalRiskPoints = (
  chartBars: ChartBar[],
  startIndex: number,
  price: number,
): ChartPositionRiskLinePoint[] =>
  chartBars.slice(startIndex).map((bar, offset) => ({
    time: bar.time,
    barIndex: startIndex + offset,
    price,
  }));

const buildCurrentRiskSegment = (
  chartBars: ChartBar[],
  startIndex: number,
  price: number,
): ChartPositionRiskLinePoint[] => {
  if (!chartBars.length) {
    return [];
  }
  const segmentStart = Math.max(startIndex, chartBars.length - 2);
  return buildHorizontalRiskPoints(chartBars, segmentStart, price);
};

const buildTrailingRiskPoints = ({
  chartBars,
  startIndex,
  direction,
  riskOverlay,
}: {
  chartBars: ChartBar[];
  startIndex: number;
  direction: ChartPositionDirection;
  riskOverlay: ResolvedRiskOverlay;
}): { points: ChartPositionRiskLinePoint[]; fallbackOnly: boolean } => {
  const currentTrailPrice = riskOverlay.trailStopPrice;
  if (!riskOverlay.trailActive || currentTrailPrice == null) {
    return { points: [], fallbackOnly: false };
  }

  const entryPrice = riskOverlay.entryPrice;
  const givebackPct = riskOverlay.givebackPct;
  const minLockedGainPct = riskOverlay.minLockedGainPct ?? 0;
  const hasActivation =
    riskOverlay.trailActivationPrice != null ||
    riskOverlay.trailActivationPct != null;
  const canReconstruct =
    direction === "long" &&
    entryPrice != null &&
    entryPrice > 0 &&
    givebackPct != null &&
    hasActivation;

  if (!canReconstruct) {
    return {
      points: buildCurrentRiskSegment(chartBars, startIndex, currentTrailPrice),
      fallbackOnly: true,
    };
  }

  let peakPrice = entryPrice;
  const points: ChartPositionRiskLinePoint[] = [];
  chartBars.slice(startIndex).forEach((bar, offset) => {
    const barHigh = finiteNumber(bar.h) ?? finiteNumber(bar.c);
    if (barHigh == null) return;
    peakPrice = Math.max(peakPrice, barHigh);
    const trailActive =
      riskOverlay.trailActivationPrice != null
        ? peakPrice >= riskOverlay.trailActivationPrice
        : ((peakPrice - entryPrice) / entryPrice) * 100 >=
          (riskOverlay.trailActivationPct ?? Number.POSITIVE_INFINITY);
    if (!trailActive) return;
    const lockedPrice = entryPrice * (1 + minLockedGainPct / 100);
    // Clamp giveback to [0, 100]% so malformed data can't drive the trail line
    // to a negative or zero price via peakPrice * (1 - giveback/100).
    const boundedGivebackPct = Math.min(Math.max(givebackPct, 0), 100);
    const trailPrice = Math.max(
      lockedPrice,
      peakPrice * (1 - boundedGivebackPct / 100),
    );
    points.push({
      time: bar.time,
      barIndex: startIndex + offset,
      price: Number(trailPrice.toFixed(2)),
    });
  });

  if (!points.length) {
    return {
      points: buildCurrentRiskSegment(chartBars, startIndex, currentTrailPrice),
      fallbackOnly: true,
    };
  }

  points[points.length - 1] = {
    ...points[points.length - 1],
    price: currentTrailPrice,
  };

  return { points, fallbackOnly: false };
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
      const averagePrice =
        finiteNumber(position.averagePrice) ?? finiteNumber(position.averageCost);
      return Boolean(quantity && Math.abs(quantity) > 1e-9 && averagePrice != null);
    });

  if (!matchedPositions.length) {
    return { ...EMPTY_CHART_POSITION_OVERLAYS, density };
  }

  const entryLines: ChartPositionEntryLine[] = [];
  const pnlBubbles: ChartPositionPnlBubble[] = [];
  const offPaneIndicators: ChartPositionOffPaneIndicator[] = [];
  const riskLinePaths: ChartPositionRiskLinePath[] = [];

  matchedPositions.forEach((position, index) => {
    const quantity = finiteNumber(position.quantity) ?? 0;
    const averagePrice =
      finiteNumber(position.averagePrice) ?? finiteNumber(position.averageCost) ?? 0;
    const fallbackMarketPrice =
      finiteNumber(position.marketPrice) ?? finiteNumber(position.mark);
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

    const riskOverlay = resolveRiskOverlay(position, averagePrice, direction);
    if (riskOverlay && resolvedChartBars.length) {
      const startIndex =
        findBarIndexForTimestamp(
          riskOverlay.openedAt,
          resolvedChartBars,
          resolvedChartBarRanges,
        ) ?? 0;
      if (riskOverlay.hardStopPrice != null) {
        const points = buildHorizontalRiskPoints(
          resolvedChartBars,
          startIndex,
          riskOverlay.hardStopPrice,
        );
        if (points.length) {
          const hardStopIsContext = riskOverlay.trailHasTakenOver;
          riskLinePaths.push({
            id: hardStopIsContext ? `${id}:hsl` : `${id}:sl`,
            kind: hardStopIsContext ? "hardStop" : "stopLoss",
            label: hardStopIsContext ? "HSL" : "SL",
            direction,
            currentPrice: riskOverlay.hardStopPrice,
            points,
            fallbackOnly: false,
            accountId: position.accountId ? String(position.accountId) : null,
            positionId,
          });
        }
      }

      if (riskOverlay.takeProfitPrice != null) {
        const points = buildHorizontalRiskPoints(
          resolvedChartBars,
          startIndex,
          riskOverlay.takeProfitPrice,
        );
        if (points.length) {
          riskLinePaths.push({
            id: `${id}:tp`,
            kind: "takeProfit",
            label: "TP",
            direction,
            currentPrice: riskOverlay.takeProfitPrice,
            points,
            fallbackOnly: false,
            accountId: position.accountId ? String(position.accountId) : null,
            positionId,
          });
        }
      }

      const trailingPath = buildTrailingRiskPoints({
        chartBars: resolvedChartBars,
        startIndex,
        direction,
        riskOverlay,
      });
      if (
        trailingPath.points.length &&
        riskOverlay.trailStopPrice != null &&
        riskOverlay.trailHasTakenOver
      ) {
        riskLinePaths.push({
          id: `${id}:trl`,
          kind: "trailingStop",
          label: "TRL",
          direction,
          currentPrice: riskOverlay.trailStopPrice,
          points: trailingPath.points,
          fallbackOnly: trailingPath.fallbackOnly,
          accountId: position.accountId ? String(position.accountId) : null,
          positionId,
        });
      }
    }
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
    riskLinePaths,
  };
};
