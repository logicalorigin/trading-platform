import type { BacktestBar } from "./types";

export const SIGNAL_FORWARD_RETURN_DATASET_VERSION =
  "signal-forward-return-v1" as const;

export const DEFAULT_SIGNAL_FORWARD_RETURN_HORIZONS_BARS = [1, 3, 6] as const;

// Cost/spread hurdle a forward return must EXCEED to count as a hit, expressed
// in the same underlying-%-move units as realizedReturnPercent (e.g. 0.05 =
// 0.05% = 5bps). A barely-positive underlying move does not survive real
// trading frictions (bid/ask spread, slippage), so a hit requires clearing this
// hurdle rather than merely being > 0. Overridable per dataset via
// SignalForwardReturnDatasetInput.costHurdlePercent or per signal via
// SignalForwardReturnSignal.spreadPctOfMid.
export const DEFAULT_SIGNAL_FORWARD_RETURN_COST_HURDLE_PERCENT = 0.05;

export type SignalForwardReturnDirection = "long" | "short";

export type SignalForwardReturnReason =
  | "score_missing"
  | "missing_symbol_bars"
  | "missing_entry_bar"
  | "entry_bar_after_signal"
  | "session_boundary_aligned_to_next_bar"
  | "duplicate_signal"
  | "overlapping_signal_window"
  | "incomplete_forward_window"
  | "mixed_symbol_dataset";

export type SignalForwardReturnWindowStatus =
  | "complete"
  | "missing_entry_bar"
  | "incomplete_window";

export type SignalForwardReturnRowStatus = "complete" | "partial" | "invalid";

export type SignalForwardReturnSignal = {
  signalId: string;
  signalAt: Date;
  symbol: string;
  direction: SignalForwardReturnDirection;
  score?: number | null;
  sourceStrategy: string;
  sourceProfile: string;
  sourceTimeframe: string;
  // Optional per-signal cost hurdle override, in the same underlying-%-move
  // units as realizedReturnPercent. When present and finite (>= 0), this
  // signal's own spread/cost is used as its hit hurdle instead of the
  // dataset-wide or default hurdle.
  spreadPctOfMid?: number | null;
};

export type SignalForwardReturnWindow = {
  horizonBars: number;
  status: SignalForwardReturnWindowStatus;
  reason: "missing_entry_bar" | "incomplete_forward_window" | null;
  expectedBars: number;
  availableBars: number;
  exitBarAt: Date | null;
  exitPrice: number | null;
  realizedReturnPercent: number | null;
  maxAdverseExcursionPercent: number | null;
  maxFavorableExcursionPercent: number | null;
  hit: boolean | null;
};

export type SignalForwardReturnRow = {
  datasetVersion: typeof SIGNAL_FORWARD_RETURN_DATASET_VERSION;
  signalId: string;
  signalAt: Date;
  symbol: string;
  direction: SignalForwardReturnDirection;
  score: number | null;
  sourceStrategy: string;
  sourceProfile: string;
  sourceTimeframe: string;
  entryBarAt: Date | null;
  entryPrice: number | null;
  status: SignalForwardReturnRowStatus;
  reasons: SignalForwardReturnReason[];
  windows: SignalForwardReturnWindow[];
};

export type SignalForwardReturnDataset = {
  version: typeof SIGNAL_FORWARD_RETURN_DATASET_VERSION;
  metadata: {
    horizonsBars: number[];
    rowCount: number;
    completeCount: number;
    partialCount: number;
    invalidCount: number;
    symbols: string[];
    hasMixedSymbols: boolean;
  };
  rows: SignalForwardReturnRow[];
};

export type SignalForwardReturnDatasetInput = {
  signals: SignalForwardReturnSignal[];
  barsBySymbol: Record<string, BacktestBar[]>;
  horizonsBars?: readonly number[];
  // Defaults to the historical signal-bar-close contract. Callers whose
  // signal is known before a bar opens can explicitly measure from that open.
  entryTiming?: "bar_close" | "bar_open";
  // Dataset-wide cost/spread hurdle (underlying-%-move units) a forward return
  // must exceed to count as a hit. Defaults to
  // DEFAULT_SIGNAL_FORWARD_RETURN_COST_HURDLE_PERCENT. Overridden per signal by
  // spreadPctOfMid when that is present and finite.
  costHurdlePercent?: number;
};

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 390 * 60_000,
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeHorizons(horizons?: readonly number[]): number[] {
  const source = horizons?.length
    ? horizons
    : DEFAULT_SIGNAL_FORWARD_RETURN_HORIZONS_BARS;
  return [...new Set(source)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
}

function roundPercent(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sourceKey(signal: SignalForwardReturnSignal, symbol: string): string {
  return [
    symbol,
    signal.sourceStrategy,
    signal.sourceProfile,
    signal.sourceTimeframe,
  ].join("|");
}

function duplicateKey(signal: SignalForwardReturnSignal, symbol: string): string {
  return `${sourceKey(signal, symbol)}|${signal.signalAt.getTime()}`;
}

function timeframeMs(value: string): number {
  return TIMEFRAME_MS[value] ?? 60_000;
}

function pushReason(
  reasons: SignalForwardReturnReason[],
  reason: SignalForwardReturnReason,
): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function buildMissingEntryWindow(horizonBars: number): SignalForwardReturnWindow {
  return {
    horizonBars,
    status: "missing_entry_bar",
    reason: "missing_entry_bar",
    expectedBars: horizonBars,
    availableBars: 0,
    exitBarAt: null,
    exitPrice: null,
    realizedReturnPercent: null,
    maxAdverseExcursionPercent: null,
    maxFavorableExcursionPercent: null,
    hit: null,
  };
}

function resolveCostHurdlePercent(
  signalSpreadPctOfMid: number | null | undefined,
  datasetHurdlePercent: number | undefined,
): number {
  if (
    signalSpreadPctOfMid != null &&
    Number.isFinite(signalSpreadPctOfMid) &&
    signalSpreadPctOfMid >= 0
  ) {
    return signalSpreadPctOfMid;
  }
  if (
    datasetHurdlePercent != null &&
    Number.isFinite(datasetHurdlePercent) &&
    datasetHurdlePercent >= 0
  ) {
    return datasetHurdlePercent;
  }
  return DEFAULT_SIGNAL_FORWARD_RETURN_COST_HURDLE_PERCENT;
}

function calculateDirectionalReturn(
  direction: SignalForwardReturnDirection,
  entryPrice: number,
  exitPrice: number,
): number {
  const raw =
    direction === "long"
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
  return roundPercent(raw * 100);
}

function calculateExcursions(
  direction: SignalForwardReturnDirection,
  entryPrice: number,
  bars: BacktestBar[],
): {
  maxAdverseExcursionPercent: number;
  maxFavorableExcursionPercent: number;
} {
  const adverseValues: number[] = [];
  const favorableValues: number[] = [];

  bars.forEach((bar) => {
    if (direction === "long") {
      adverseValues.push(((bar.low - entryPrice) / entryPrice) * 100);
      favorableValues.push(((bar.high - entryPrice) / entryPrice) * 100);
      return;
    }

    adverseValues.push(((entryPrice - bar.high) / entryPrice) * 100);
    favorableValues.push(((entryPrice - bar.low) / entryPrice) * 100);
  });

  return {
    maxAdverseExcursionPercent: roundPercent(Math.min(...adverseValues)),
    maxFavorableExcursionPercent: roundPercent(Math.max(...favorableValues)),
  };
}

function buildWindow(input: {
  bars: BacktestBar[];
  entryIndex: number;
  entryPrice: number;
  entryTiming: "bar_close" | "bar_open";
  direction: SignalForwardReturnDirection;
  horizonBars: number;
  costHurdlePercent: number;
}): SignalForwardReturnWindow {
  const startsAtEntry = input.entryTiming === "bar_open";
  const exitIndex =
    input.entryIndex + input.horizonBars - (startsAtEntry ? 1 : 0);
  const availableBars = Math.max(
    0,
    input.bars.length - input.entryIndex - (startsAtEntry ? 0 : 1),
  );

  if (exitIndex >= input.bars.length) {
    return {
      horizonBars: input.horizonBars,
      status: "incomplete_window",
      reason: "incomplete_forward_window",
      expectedBars: input.horizonBars,
      availableBars,
      exitBarAt: null,
      exitPrice: null,
      realizedReturnPercent: null,
      maxAdverseExcursionPercent: null,
      maxFavorableExcursionPercent: null,
      hit: null,
    };
  }

  const forwardBars = input.bars.slice(
    input.entryIndex + (startsAtEntry ? 0 : 1),
    exitIndex + 1,
  );
  const exitBar = input.bars[exitIndex];
  const realizedReturnPercent = calculateDirectionalReturn(
    input.direction,
    input.entryPrice,
    exitBar.close,
  );
  const excursions = calculateExcursions(
    input.direction,
    input.entryPrice,
    forwardBars,
  );

  return {
    horizonBars: input.horizonBars,
    status: "complete",
    reason: null,
    expectedBars: input.horizonBars,
    availableBars: input.horizonBars,
    exitBarAt: exitBar.startsAt,
    exitPrice: exitBar.close,
    realizedReturnPercent,
    maxAdverseExcursionPercent: excursions.maxAdverseExcursionPercent,
    maxFavorableExcursionPercent: excursions.maxFavorableExcursionPercent,
    hit: realizedReturnPercent > input.costHurdlePercent,
  };
}

export function buildSignalForwardReturnDataset(
  input: SignalForwardReturnDatasetInput,
): SignalForwardReturnDataset {
  const horizonsBars = normalizeHorizons(input.horizonsBars);
  const entryTiming = input.entryTiming ?? "bar_close";
  const symbols = [
    ...new Set(input.signals.map((item) => normalizeSymbol(item.symbol))),
  ].sort();
  const hasMixedSymbols = symbols.length > 1;
  const duplicateCounts = new Map<string, number>();

  input.signals.forEach((item) => {
    const symbol = normalizeSymbol(item.symbol);
    const key = duplicateKey(item, symbol);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  });

  const priorSignalAtBySource = new Map<string, number>();
  const rows = input.signals.map((item): SignalForwardReturnRow => {
    const symbol = normalizeSymbol(item.symbol);
    const reasons: SignalForwardReturnReason[] = [];
    const bars = (input.barsBySymbol[symbol] ?? [])
      .slice()
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

    if (item.score == null || !Number.isFinite(item.score)) {
      pushReason(reasons, "score_missing");
    }
    if (bars.length === 0) {
      pushReason(reasons, "missing_symbol_bars");
    }

    const entryIndex = bars.findIndex(
      (bar) => bar.startsAt.getTime() >= item.signalAt.getTime(),
    );
    const entryBar = entryIndex >= 0 ? bars[entryIndex] : null;

    if (!entryBar) {
      pushReason(reasons, "missing_entry_bar");
    } else if (entryBar.startsAt.getTime() > item.signalAt.getTime()) {
      pushReason(reasons, "entry_bar_after_signal");
      if (dateKey(entryBar.startsAt) !== dateKey(item.signalAt)) {
        pushReason(reasons, "session_boundary_aligned_to_next_bar");
      }
    }

    if ((duplicateCounts.get(duplicateKey(item, symbol)) ?? 0) > 1) {
      pushReason(reasons, "duplicate_signal");
    }

    const key = sourceKey(item, symbol);
    const priorSignalAt = priorSignalAtBySource.get(key);
    if (priorSignalAt != null) {
      const maxHorizonMs =
        Math.max(...horizonsBars) * timeframeMs(item.sourceTimeframe);
      if (item.signalAt.getTime() - priorSignalAt < maxHorizonMs) {
        pushReason(reasons, "overlapping_signal_window");
      }
    }
    if (priorSignalAt == null || item.signalAt.getTime() > priorSignalAt) {
      priorSignalAtBySource.set(key, item.signalAt.getTime());
    }

    const costHurdlePercent = resolveCostHurdlePercent(
      item.spreadPctOfMid,
      input.costHurdlePercent,
    );
    const windows = entryBar
      ? horizonsBars.map((horizonBars) =>
          buildWindow({
            bars,
            entryIndex,
            entryPrice:
              entryTiming === "bar_open" ? entryBar.open : entryBar.close,
            entryTiming,
            direction: item.direction,
            horizonBars,
            costHurdlePercent,
          }),
        )
      : horizonsBars.map(buildMissingEntryWindow);

    if (windows.some((window) => window.status === "incomplete_window")) {
      pushReason(reasons, "incomplete_forward_window");
    }
    if (hasMixedSymbols) {
      pushReason(reasons, "mixed_symbol_dataset");
    }

    const hasInvalidWindow = windows.some(
      (window) => window.status === "missing_entry_bar",
    );
    const hasPartialWindow = windows.some(
      (window) => window.status === "incomplete_window",
    );
    const status: SignalForwardReturnRowStatus = hasInvalidWindow
      ? "invalid"
      : hasPartialWindow || reasons.includes("score_missing")
        ? "partial"
        : "complete";

    return {
      datasetVersion: SIGNAL_FORWARD_RETURN_DATASET_VERSION,
      signalId: item.signalId,
      signalAt: item.signalAt,
      symbol,
      direction: item.direction,
      score: item.score ?? null,
      sourceStrategy: item.sourceStrategy,
      sourceProfile: item.sourceProfile,
      sourceTimeframe: item.sourceTimeframe,
      entryBarAt: entryBar?.startsAt ?? null,
      entryPrice:
        entryBar == null
          ? null
          : entryTiming === "bar_open"
            ? entryBar.open
            : entryBar.close,
      status,
      reasons,
      windows,
    };
  });

  return {
    version: SIGNAL_FORWARD_RETURN_DATASET_VERSION,
    metadata: {
      horizonsBars,
      rowCount: rows.length,
      completeCount: rows.filter((row) => row.status === "complete").length,
      partialCount: rows.filter((row) => row.status === "partial").length,
      invalidCount: rows.filter((row) => row.status === "invalid").length,
      symbols,
      hasMixedSymbols,
    },
    rows,
  };
}
