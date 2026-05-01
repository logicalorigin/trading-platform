import {
  aggregateBars,
  buildCandidatesForMode,
  buildRayReplicaSignalTape,
  buildWalkForwardWindows,
  getBacktestOptionPreset,
  getStrategyCatalogItem,
  listStrategies,
  type BacktestBar,
  type BacktestTimeframe,
  type StrategyCatalogItem,
} from "@workspace/backtest-core";
import {
  algoStrategiesTable,
  backtestPromotionsTable,
  backtestRunDatasetsTable,
  backtestRunPointsTable,
  backtestRunTradesTable,
  backtestRunsTable,
  backtestStudiesTable,
  backtestStudyJobsTable,
  backtestSweepsTable,
  db,
  historicalBarDatasetsTable,
  historicalBarsTable,
  instrumentsTable,
  watchlistItemsTable,
} from "@workspace/db";
import type {
  BacktestRun,
  BacktestRunPoint,
  BacktestRunTrade,
  BacktestStudy,
  BacktestStudyJob,
  BacktestSweep,
  HistoricalBarDataset,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { getPolygonRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  PolygonMarketDataClient,
  type HistoricalOptionContract,
} from "../providers/polygon/market-data";

type NumberLike = number | string | null | undefined;

type CreateStudyInput = {
  name: string;
  strategyId: string;
  strategyVersion: string;
  directionMode: "long_only" | "long_short";
  watchlistId: string | null;
  symbols: string[];
  timeframe: string;
  startsAt: Date;
  endsAt: Date;
  parameters: Record<string, unknown>;
  portfolioRules: {
    initialCapital: number;
    positionSizePercent: number;
    maxConcurrentPositions: number;
    maxGrossExposurePercent: number;
  };
  executionProfile: {
    commissionBps: number;
    slippageBps: number;
  };
  optimizerMode: "grid" | "random" | "walk_forward";
  optimizerConfig: Record<string, unknown>;
};

type CreateRunInput = {
  studyId: string;
  name: string | null;
  parameters: Record<string, unknown> | null;
};

type CreateSweepInput = {
  studyId: string;
  mode: "grid" | "random" | "walk_forward";
  baseParameters: Record<string, unknown>;
  dimensions: Array<{ key: string; values: unknown[] }>;
  randomCandidateBudget: number | null;
  walkForwardTrainingMonths: number | null;
  walkForwardTestMonths: number | null;
  walkForwardStepMonths: number | null;
};

export type ResolveBacktestOptionContractInput = {
  underlying: string;
  occurredAt: Date;
  right: "call" | "put";
  spotPrice: number;
  contractPresetId?: string | null;
};

export type ResolvedBacktestOptionContract = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  multiplier: number;
  sharesPerContract: number;
  providerContractId: string | null;
  contractPresetId: string;
  dte: number;
};

type PromoteRunInput = {
  runId: string;
  name: string;
  notes: string | null;
};

type HistoricalBarRow = {
  startsAt: Date;
  open: NumberLike;
  high: NumberLike;
  low: NumberLike;
  close: NumberLike;
  volume: NumberLike;
};

type TradeValueFormat = "currency" | "percent" | "number" | "integer";

type BacktestComparisonBadge = {
  id: string;
  label: string;
  format: TradeValueFormat;
  latestValue: number | null;
  bestValue: number | null;
  winner: "latest" | "best" | "tie" | "none";
};

type BacktestEquityPoint = {
  occurredAt: Date;
  equity: number;
  drawdownPercent: number;
};

type BacktestChartBarRange = {
  startMs: number;
  endMs: number;
};

type BacktestTradeReasonTraceStepResponse = {
  id: string;
  kind: "entry" | "max_favorable" | "max_adverse" | "exit";
  label: string;
  occurredAt: Date;
  barIndex: number | null;
  price: number;
  deltaFromEntry: number;
  deltaPercentFromEntry: number;
  emphasis: "positive" | "negative" | "neutral";
};

type BacktestTradeExitConsequencesResponse = {
  windowBars: number;
  barsObserved: number;
  bestPrice: number;
  bestOccurredAt: Date;
  bestBarIndex: number;
  bestDelta: number;
  bestPercent: number;
  worstPrice: number;
  worstOccurredAt: Date;
  worstBarIndex: number;
  worstDelta: number;
  worstPercent: number;
};

type BacktestTradeDiagnosticsResponse = {
  holdMinutes: number;
  entryBarIndex: number | null;
  exitBarIndex: number | null;
  maxFavorablePrice: number | null;
  maxFavorableAt: Date | null;
  maxFavorableBarIndex: number | null;
  maxFavorableDelta: number | null;
  maxFavorablePercent: number | null;
  maxAdversePrice: number | null;
  maxAdverseAt: Date | null;
  maxAdverseBarIndex: number | null;
  maxAdverseDelta: number | null;
  maxAdversePercent: number | null;
  reasonTrace: BacktestTradeReasonTraceStepResponse[];
  exitConsequences: BacktestTradeExitConsequencesResponse | null;
};

const POST_EXIT_CONTINUATION_WINDOW_BARS = 10;

const OPTION_CONTRACT_LOOKAHEAD_DAYS = 60;

function getPolygonClient(): PolygonMarketDataClient {
  const config = getPolygonRuntimeConfig();

  if (!config) {
    throw new HttpError(503, "Polygon / Massive market data is not configured.", {
      code: "polygon_runtime_unavailable",
    });
  }

  return new PolygonMarketDataClient(config);
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function calculateDte(occurredAt: Date, expirationDate: Date): number {
  const start = startOfUtcDay(occurredAt).getTime();
  const expiration = startOfUtcDay(expirationDate).getTime();
  return Math.round((expiration - start) / (24 * 60 * 60 * 1_000));
}

function selectExpiryWindow(
  contracts: HistoricalOptionContract[],
  occurredAt: Date,
  targetDte: number,
  minDte: number,
  maxDte: number,
): HistoricalOptionContract[] {
  const inWindow = contracts.filter((contract) => {
    const dte = calculateDte(occurredAt, contract.expirationDate);
    return dte >= minDte && dte <= maxDte;
  });

  const candidates = inWindow.length > 0 ? inWindow : contracts;
  const expirations = [
    ...new Set(
      candidates.map((contract) => contract.expirationDate.toISOString()),
    ),
  ]
    .map((iso) => new Date(iso))
    .sort((left, right) => left.getTime() - right.getTime());

  const selectedExpiration =
    expirations.sort((left, right) => {
      const leftDte = calculateDte(occurredAt, left);
      const rightDte = calculateDte(occurredAt, right);
      const dteDelta = Math.abs(leftDte - targetDte) - Math.abs(rightDte - targetDte);

      if (dteDelta !== 0) {
        return dteDelta;
      }

      return left.getTime() - right.getTime();
    })[0] ?? null;

  if (!selectedExpiration) {
    return [];
  }

  const selectedIso = selectedExpiration.toISOString();
  return candidates.filter(
    (contract) => contract.expirationDate.toISOString() === selectedIso,
  );
}

function scoreContractStrike(
  contract: HistoricalOptionContract,
  spotPrice: number,
  right: "call" | "put",
  strikeTarget: ReturnType<typeof getBacktestOptionPreset>["strikeTarget"],
): number {
  const distance = contract.strike - spotPrice;
  const absoluteDistance = Math.abs(distance);
  const percentDistance = spotPrice > 0 ? absoluteDistance / spotPrice : absoluteDistance;
  const callOtm = distance >= 0;
  const putOtm = distance <= 0;
  const isOtm = right === "call" ? callOtm : putOtm;
  const isItm = right === "call" ? !callOtm : !putOtm;
  const stepTarget =
    strikeTarget === "otm_step_2" ? 0.02 : strikeTarget === "itm_step_1" ? 0.015 : 0.01;

  switch (strikeTarget) {
    case "atm":
      return absoluteDistance;
    case "otm_step_1":
    case "otm_step_2":
      return isOtm ? Math.abs(percentDistance - stepTarget) : 10 + percentDistance;
    case "itm_step_1":
      return isItm ? Math.abs(percentDistance - stepTarget) : 10 + percentDistance;
    default:
      return absoluteDistance;
  }
}

export async function resolveBacktestOptionContract(
  input: ResolveBacktestOptionContractInput,
): Promise<ResolvedBacktestOptionContract | null> {
  const underlying = normalizeSymbol(input.underlying);
  const preset = getBacktestOptionPreset(input.contractPresetId);
  const occurredAt = new Date(input.occurredAt);

  if (!underlying) {
    throw new HttpError(400, "A valid underlying symbol is required.", {
      code: "backtest_option_underlying_required",
    });
  }

  if (!Number.isFinite(input.spotPrice) || input.spotPrice <= 0) {
    throw new HttpError(400, "A positive spot reference price is required.", {
      code: "backtest_option_spot_price_required",
    });
  }

  const polygonClient = getPolygonClient();
  const contracts = await polygonClient.getHistoricalOptionContracts({
    underlying,
    asOf: occurredAt,
    contractType: input.right,
    expirationDateGte: startOfUtcDay(occurredAt),
    expirationDateLte: addUtcDays(
      startOfUtcDay(occurredAt),
      Math.max(preset.maxDte, preset.targetDte) + OPTION_CONTRACT_LOOKAHEAD_DAYS,
    ),
    limit: 1_000,
  });

  if (contracts.length === 0) {
    return null;
  }

  const filteredByExpiry = selectExpiryWindow(
    contracts,
    occurredAt,
    preset.targetDte,
    preset.minDte,
    preset.maxDte,
  );

  const selected =
    [...filteredByExpiry].sort((left, right) => {
      const strikeDelta =
        scoreContractStrike(left, input.spotPrice, input.right, preset.strikeTarget) -
        scoreContractStrike(right, input.spotPrice, input.right, preset.strikeTarget);

      if (strikeDelta !== 0) {
        return strikeDelta;
      }

      return left.strike - right.strike;
    })[0] ?? null;

  if (!selected) {
    return null;
  }

  return {
    ...selected,
    contractPresetId: preset.id,
    dte: calculateDte(occurredAt, selected.expirationDate),
  };
}

function numericValue(value: NumberLike): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function numericValueOrNull(value: NumberLike): number | null {
  if (value == null) {
    return null;
  }

  const parsed = numericValue(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeframeToStepMs(timeframe: string): number {
  return (
    {
      "1s": 1_000,
      "5s": 5_000,
      "15s": 15_000,
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "1h": 3_600_000,
      "1d": 86_400_000,
    }[timeframe] ?? 300_000
  );
}

function buildTradeSelectionId(
  runId: string,
  trade:
    | Pick<BacktestRunTrade, "symbol" | "entryAt">
    | {
        symbol: string;
        entryAt: Date | string;
      },
): string {
  const symbol = normalizeSymbol(trade.symbol);
  const entryAt =
    trade.entryAt instanceof Date
      ? trade.entryAt.toISOString()
      : new Date(trade.entryAt).toISOString();

  return `${runId}:${symbol}:${entryAt}`;
}

function buildOptionDatasetRole(symbol: string, entryAt: Date): string {
  return `option:${normalizeSymbol(symbol).slice(0, 8)}:${entryAt.getTime()}`;
}

function buildSelectionFocusToken(
  runId: string,
  symbol: string,
  tradeSelectionId: string | null,
  visibleLogicalRange: { from: number; to: number } | null,
): number {
  const source = [
    runId,
    symbol,
    tradeSelectionId ?? "none",
    visibleLogicalRange?.from ?? "na",
    visibleLogicalRange?.to ?? "na",
  ].join("|");

  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

function normalizeBacktestBar(row: HistoricalBarRow): BacktestBar {
  return {
    startsAt: row.startsAt,
    open: numericValue(row.open),
    high: numericValue(row.high),
    low: numericValue(row.low),
    close: numericValue(row.close),
    volume: numericValue(row.volume),
  };
}

function buildChartBarsFromBacktestBars(
  bars: BacktestBar[],
  timeframe: string,
): {
  chartBars: Array<{
    time: number;
    ts: string;
    date: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
  chartBarRanges: Array<{ startMs: number; endMs: number }>;
} {
  const fallbackStepMs = timeframeToStepMs(timeframe);
  const chartBars = bars.map((bar) => {
    const startMs = bar.startsAt.getTime();
    const ts = bar.startsAt.toISOString();

    return {
      time: Math.floor(startMs / 1000),
      ts,
      date: ts.slice(0, 10),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
    };
  });
  const chartBarRanges = bars.map((bar, index) => {
    const startMs = bar.startsAt.getTime();
    const next = bars[index + 1];

    return {
      startMs,
      endMs: next?.startsAt.getTime() ?? startMs + fallbackStepMs,
    };
  });

  return { chartBars, chartBarRanges };
}

function resolveBarIndex(
  timestampMs: number | null,
  chartBarRanges: Array<{ startMs: number; endMs: number }>,
): number | null {
  if (timestampMs == null) {
    return null;
  }

  for (let index = 0; index < chartBarRanges.length; index += 1) {
    const range = chartBarRanges[index];
    if (timestampMs >= range.startMs && timestampMs < range.endMs) {
      return index;
    }
  }

  const lastRange = chartBarRanges[chartBarRanges.length - 1];
  if (lastRange && timestampMs === lastRange.endMs) {
    return chartBarRanges.length - 1;
  }

  return null;
}

function directionalDelta(
  referencePrice: number,
  observedPrice: number,
  side: string,
): number {
  return side === "short"
    ? referencePrice - observedPrice
    : observedPrice - referencePrice;
}

function directionalPercent(delta: number, referencePrice: number): number {
  return referencePrice > 0 ? (delta / referencePrice) * 100 : 0;
}

function resolveTraceEmphasis(
  deltaFromEntry: number,
): "positive" | "negative" | "neutral" {
  if (deltaFromEntry > 0) {
    return "positive";
  }

  if (deltaFromEntry < 0) {
    return "negative";
  }

  return "neutral";
}

function buildDefaultVisibleRange(
  barCount: number,
): { from: number; to: number } | null {
  if (barCount <= 0) {
    return null;
  }

  const to = barCount - 1;
  return {
    from: Math.max(0, to - 120),
    to,
  };
}

function buildFocusedTradeVisibleRange(
  entryBarIndex: number | null,
  exitBarIndex: number | null,
  barCount: number,
): { from: number; to: number } | null {
  if (barCount <= 0) {
    return null;
  }

  const anchorFrom = entryBarIndex ?? exitBarIndex;
  const anchorTo = exitBarIndex ?? entryBarIndex;

  if (anchorFrom == null || anchorTo == null) {
    return buildDefaultVisibleRange(barCount);
  }

  return {
    from: Math.max(0, Math.min(anchorFrom, anchorTo) - 20),
    to: Math.min(barCount - 1, Math.max(anchorFrom, anchorTo) + 20),
  };
}

function buildTradeReasonTraceStep(
  id: string,
  kind: BacktestTradeReasonTraceStepResponse["kind"],
  label: string,
  occurredAt: Date,
  barIndex: number | null,
  price: number,
  deltaFromEntry: number,
  entryPrice: number,
): BacktestTradeReasonTraceStepResponse {
  return {
    id,
    kind,
    label,
    occurredAt,
    barIndex,
    price,
    deltaFromEntry,
    deltaPercentFromEntry: directionalPercent(deltaFromEntry, entryPrice),
    emphasis: resolveTraceEmphasis(deltaFromEntry),
  };
}

function buildTradeDiagnostics(
  runId: string,
  trade: BacktestRunTrade,
  bars: BacktestBar[],
  chartBarRanges: BacktestChartBarRange[],
): BacktestTradeDiagnosticsResponse | null {
  if (bars.length === 0 || chartBarRanges.length === 0) {
    return null;
  }

  const entryPrice = numericValue(trade.entryPrice);
  const exitPrice = numericValue(trade.exitPrice);
  const entryBarIndex = resolveBarIndex(
    trade.entryAt.getTime(),
    chartBarRanges,
  );
  const exitBarIndex = resolveBarIndex(trade.exitAt.getTime(), chartBarRanges);

  if (entryBarIndex == null) {
    return null;
  }

  const holdMinutes = Math.max(
    0,
    (trade.exitAt.getTime() - trade.entryAt.getTime()) / 60_000,
  );
  const tradeSelectionId = buildTradeSelectionId(runId, trade);
  const heldBarEndIndex =
    exitBarIndex == null
      ? bars.length - 1
      : Math.max(entryBarIndex, exitBarIndex - 1);
  const heldBars = bars.slice(entryBarIndex, heldBarEndIndex + 1);

  if (heldBars.length === 0) {
    return {
      holdMinutes,
      entryBarIndex,
      exitBarIndex,
      maxFavorablePrice: null,
      maxFavorableAt: null,
      maxFavorableBarIndex: null,
      maxFavorableDelta: null,
      maxFavorablePercent: null,
      maxAdversePrice: null,
      maxAdverseAt: null,
      maxAdverseBarIndex: null,
      maxAdverseDelta: null,
      maxAdversePercent: null,
      reasonTrace: [],
      exitConsequences: null,
    };
  }

  const entryExtreme = {
    price: entryPrice,
    occurredAt: trade.entryAt,
    barIndex: entryBarIndex,
    delta: 0,
  };
  let maxFavorable = entryExtreme;
  let maxAdverse = entryExtreme;

  heldBars.forEach((bar, offset) => {
    const barIndex = entryBarIndex + offset;
    const favorablePrice = trade.side === "short" ? bar.low : bar.high;
    const adversePrice = trade.side === "short" ? bar.high : bar.low;
    const favorableDelta = directionalDelta(
      entryPrice,
      favorablePrice,
      trade.side,
    );
    const adverseDelta = directionalDelta(entryPrice, adversePrice, trade.side);

    if (favorableDelta > maxFavorable.delta) {
      maxFavorable = {
        price: favorablePrice,
        occurredAt: bar.startsAt,
        barIndex,
        delta: favorableDelta,
      };
    }

    if (adverseDelta < maxAdverse.delta) {
      maxAdverse = {
        price: adversePrice,
        occurredAt: bar.startsAt,
        barIndex,
        delta: adverseDelta,
      };
    }
  });

  const exitDelta = directionalDelta(entryPrice, exitPrice, trade.side);
  const reasonTrace = [
    buildTradeReasonTraceStep(
      `${tradeSelectionId}:entry`,
      "entry",
      "Entry",
      trade.entryAt,
      entryBarIndex,
      entryPrice,
      0,
      entryPrice,
    ),
    ...(maxFavorable.delta > 0
      ? [
          buildTradeReasonTraceStep(
            `${tradeSelectionId}:max-favorable`,
            "max_favorable",
            "Max favorable",
            maxFavorable.occurredAt,
            maxFavorable.barIndex,
            maxFavorable.price,
            maxFavorable.delta,
            entryPrice,
          ),
        ]
      : []),
    ...(maxAdverse.delta < 0
      ? [
          buildTradeReasonTraceStep(
            `${tradeSelectionId}:max-adverse`,
            "max_adverse",
            "Max adverse",
            maxAdverse.occurredAt,
            maxAdverse.barIndex,
            maxAdverse.price,
            maxAdverse.delta,
            entryPrice,
          ),
        ]
      : []),
    buildTradeReasonTraceStep(
      `${tradeSelectionId}:exit`,
      "exit",
      `Exit · ${trade.exitReason}`,
      trade.exitAt,
      exitBarIndex,
      exitPrice,
      exitDelta,
      entryPrice,
    ),
  ].sort((left, right) => {
    const timeDiff = left.occurredAt.getTime() - right.occurredAt.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    const priority = {
      entry: 0,
      max_adverse: 1,
      max_favorable: 2,
      exit: 3,
    } as const;
    return priority[left.kind] - priority[right.kind];
  });

  const continuationSource =
    exitBarIndex == null
      ? []
      : bars.slice(
          exitBarIndex,
          Math.min(
            bars.length,
            exitBarIndex + POST_EXIT_CONTINUATION_WINDOW_BARS,
          ),
        );

  let exitConsequences: BacktestTradeExitConsequencesResponse | null = null;
  if (continuationSource.length > 0 && exitBarIndex != null) {
    const firstContinuationBar = continuationSource[0];
    const initialBestPrice =
      trade.side === "short"
        ? firstContinuationBar.low
        : firstContinuationBar.high;
    const initialWorstPrice =
      trade.side === "short"
        ? firstContinuationBar.high
        : firstContinuationBar.low;

    let bestContinuation = {
      price: initialBestPrice,
      occurredAt: firstContinuationBar.startsAt,
      barIndex: exitBarIndex,
      delta: directionalDelta(exitPrice, initialBestPrice, trade.side),
    };
    let worstContinuation = {
      price: initialWorstPrice,
      occurredAt: firstContinuationBar.startsAt,
      barIndex: exitBarIndex,
      delta: directionalDelta(exitPrice, initialWorstPrice, trade.side),
    };

    continuationSource.forEach((bar, offset) => {
      const barIndex = exitBarIndex + offset;
      const bestPrice = trade.side === "short" ? bar.low : bar.high;
      const worstPrice = trade.side === "short" ? bar.high : bar.low;
      const bestDelta = directionalDelta(exitPrice, bestPrice, trade.side);
      const worstDelta = directionalDelta(exitPrice, worstPrice, trade.side);

      if (bestDelta > bestContinuation.delta) {
        bestContinuation = {
          price: bestPrice,
          occurredAt: bar.startsAt,
          barIndex,
          delta: bestDelta,
        };
      }

      if (worstDelta < worstContinuation.delta) {
        worstContinuation = {
          price: worstPrice,
          occurredAt: bar.startsAt,
          barIndex,
          delta: worstDelta,
        };
      }
    });

    exitConsequences = {
      windowBars: POST_EXIT_CONTINUATION_WINDOW_BARS,
      barsObserved: continuationSource.length,
      bestPrice: bestContinuation.price,
      bestOccurredAt: bestContinuation.occurredAt,
      bestBarIndex: bestContinuation.barIndex,
      bestDelta: bestContinuation.delta,
      bestPercent: directionalPercent(bestContinuation.delta, exitPrice),
      worstPrice: worstContinuation.price,
      worstOccurredAt: worstContinuation.occurredAt,
      worstBarIndex: worstContinuation.barIndex,
      worstDelta: worstContinuation.delta,
      worstPercent: directionalPercent(worstContinuation.delta, exitPrice),
    };
  }

  return {
    holdMinutes,
    entryBarIndex,
    exitBarIndex,
    maxFavorablePrice: maxFavorable.price,
    maxFavorableAt: maxFavorable.occurredAt,
    maxFavorableBarIndex: maxFavorable.barIndex,
    maxFavorableDelta: maxFavorable.delta,
    maxFavorablePercent: directionalPercent(maxFavorable.delta, entryPrice),
    maxAdversePrice: maxAdverse.price,
    maxAdverseAt: maxAdverse.occurredAt,
    maxAdverseBarIndex: maxAdverse.barIndex,
    maxAdverseDelta: maxAdverse.delta,
    maxAdversePercent: directionalPercent(maxAdverse.delta, entryPrice),
    reasonTrace,
    exitConsequences,
  };
}

async function buildTradeDiagnosticsMap(
  runId: string,
  study: BacktestStudy,
  trades: BacktestRunTrade[],
  datasets: HistoricalBarDataset[],
): Promise<Map<string, BacktestTradeDiagnosticsResponse>> {
  const diagnosticsByTradeId = new Map<
    string,
    BacktestTradeDiagnosticsResponse
  >();
  if (trades.length === 0 || datasets.length === 0) {
    return diagnosticsByTradeId;
  }

  const barsBySymbol = new Map<
    string,
    { bars: BacktestBar[]; chartBarRanges: BacktestChartBarRange[] }
  >();
  const uniqueSymbols = [
    ...new Set(trades.map((trade) => normalizeSymbol(trade.symbol))),
  ];

  for (const symbol of uniqueSymbols) {
    const dataset = datasets.find(
      (candidate) => normalizeSymbol(candidate.symbol) === symbol,
    );

    if (!dataset) {
      continue;
    }

    const storedBars = await loadBacktestBarsForDataset(dataset.id);
    const normalizedBars =
      dataset.timeframe === study.timeframe
        ? storedBars
        : aggregateBars(storedBars, study.timeframe as BacktestTimeframe);
    const { chartBarRanges } = buildChartBarsFromBacktestBars(
      normalizedBars,
      study.timeframe,
    );
    barsBySymbol.set(symbol, {
      bars: normalizedBars,
      chartBarRanges,
    });
  }

  trades.forEach((trade) => {
    const symbol = normalizeSymbol(trade.symbol);
    const chartSource = barsBySymbol.get(symbol);

    if (!chartSource) {
      return;
    }

    const diagnostics = buildTradeDiagnostics(
      runId,
      trade,
      chartSource.bars,
      chartSource.chartBarRanges,
    );

    if (diagnostics) {
      diagnosticsByTradeId.set(
        buildTradeSelectionId(runId, trade),
        diagnostics,
      );
    }
  });

  return diagnosticsByTradeId;
}

function compareCompletedRuns(left: BacktestRun, right: BacktestRun): number {
  const leftFinished = left.finishedAt?.getTime() ?? left.createdAt.getTime();
  const rightFinished =
    right.finishedAt?.getTime() ?? right.createdAt.getTime();
  return rightFinished - leftFinished;
}

function resolveTopTradeSymbol(
  study: BacktestStudy,
  trades: BacktestRunTrade[],
): string {
  const normalizedStudySymbols = normalizeSymbols(study.symbols);
  if (trades.length === 0) {
    return normalizedStudySymbols[0] ?? "";
  }

  const symbolStats = new Map<
    string,
    { count: number; latestExitMs: number }
  >();
  trades.forEach((trade) => {
    const symbol = normalizeSymbol(trade.symbol);
    const existing = symbolStats.get(symbol) ?? {
      count: 0,
      latestExitMs: 0,
    };
    existing.count += 1;
    existing.latestExitMs = Math.max(
      existing.latestExitMs,
      trade.exitAt.getTime(),
    );
    symbolStats.set(symbol, existing);
  });

  return (
    [...symbolStats.entries()].sort((left, right) => {
      if (right[1].count !== left[1].count) {
        return right[1].count - left[1].count;
      }

      if (right[1].latestExitMs !== left[1].latestExitMs) {
        return right[1].latestExitMs - left[1].latestExitMs;
      }

      return (
        normalizedStudySymbols.indexOf(left[0]) -
        normalizedStudySymbols.indexOf(right[0])
      );
    })[0]?.[0] ??
    normalizedStudySymbols[0] ??
    ""
  );
}

function resolveSelectedSymbol(
  study: BacktestStudy,
  trades: BacktestRunTrade[],
  requestedSymbol?: string | null,
): string {
  const normalizedStudySymbols = normalizeSymbols(study.symbols);
  const normalizedRequest = normalizeSymbol(requestedSymbol ?? "");

  if (normalizedRequest && normalizedStudySymbols.includes(normalizedRequest)) {
    return normalizedRequest;
  }

  return resolveTopTradeSymbol(study, trades);
}

function resolveBestCompletedRun(runs: BacktestRun[]): BacktestRun | null {
  if (runs.length === 0) {
    return null;
  }

  const ranked = [...runs].sort((left, right) => {
    const leftRank = left.sortRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.sortRank ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftMetrics =
      (left.metrics as Record<string, unknown> | null) ?? null;
    const rightMetrics =
      (right.metrics as Record<string, unknown> | null) ?? null;
    const returnDelta =
      numericValue(rightMetrics?.totalReturnPercent as NumberLike) -
      numericValue(leftMetrics?.totalReturnPercent as NumberLike);

    if (returnDelta !== 0) {
      return returnDelta;
    }

    const sharpeDelta =
      numericValue(rightMetrics?.sharpeRatio as NumberLike) -
      numericValue(leftMetrics?.sharpeRatio as NumberLike);

    if (sharpeDelta !== 0) {
      return sharpeDelta;
    }

    return compareCompletedRuns(left, right);
  });

  return ranked[0] ?? null;
}

function resolveBadgeWinner(
  latestValue: number | null,
  bestValue: number | null,
  {
    lowerIsBetter = false,
    precision = 0.0001,
  }: {
    lowerIsBetter?: boolean;
    precision?: number;
  } = {},
): "latest" | "best" | "tie" | "none" {
  if (latestValue == null || bestValue == null) {
    return "none";
  }

  if (Math.abs(latestValue - bestValue) <= precision) {
    return "tie";
  }

  if (lowerIsBetter) {
    return latestValue < bestValue ? "latest" : "best";
  }

  return latestValue > bestValue ? "latest" : "best";
}

function thresholdKindForExitReason(
  exitReason: string,
): "take_profit" | "stop_loss" | "trail_stop" | "exit_trigger" | null {
  if (exitReason === "take_profit") {
    return "take_profit";
  }

  if (exitReason === "stop_loss") {
    return "stop_loss";
  }

  if (exitReason === "trailing_stop") {
    return "trail_stop";
  }

  return null;
}

function buildComparisonBadges(
  latestRun: BacktestRun | null,
  bestRun: BacktestRun | null,
): BacktestComparisonBadge[] {
  const latestMetrics =
    (latestRun?.metrics as Record<string, unknown> | null) ?? null;
  const bestMetrics =
    (bestRun?.metrics as Record<string, unknown> | null) ?? null;

  return [
    {
      id: "return",
      label: "Return",
      format: "percent",
      latestValue: numericValueOrNull(
        latestMetrics?.totalReturnPercent as NumberLike,
      ),
      bestValue: numericValueOrNull(
        bestMetrics?.totalReturnPercent as NumberLike,
      ),
      winner: resolveBadgeWinner(
        numericValueOrNull(latestMetrics?.totalReturnPercent as NumberLike),
        numericValueOrNull(bestMetrics?.totalReturnPercent as NumberLike),
      ),
    },
    {
      id: "sharpe",
      label: "Sharpe",
      format: "number",
      latestValue: numericValueOrNull(latestMetrics?.sharpeRatio as NumberLike),
      bestValue: numericValueOrNull(bestMetrics?.sharpeRatio as NumberLike),
      winner: resolveBadgeWinner(
        numericValueOrNull(latestMetrics?.sharpeRatio as NumberLike),
        numericValueOrNull(bestMetrics?.sharpeRatio as NumberLike),
      ),
    },
    {
      id: "drawdown",
      label: "Max DD",
      format: "percent",
      latestValue: numericValueOrNull(
        latestMetrics?.maxDrawdownPercent as NumberLike,
      ),
      bestValue: numericValueOrNull(
        bestMetrics?.maxDrawdownPercent as NumberLike,
      ),
      winner: resolveBadgeWinner(
        numericValueOrNull(latestMetrics?.maxDrawdownPercent as NumberLike),
        numericValueOrNull(bestMetrics?.maxDrawdownPercent as NumberLike),
        { lowerIsBetter: true },
      ),
    },
    {
      id: "trades",
      label: "Trades",
      format: "integer",
      latestValue: numericValueOrNull(latestMetrics?.tradeCount as NumberLike),
      bestValue: numericValueOrNull(bestMetrics?.tradeCount as NumberLike),
      winner: resolveBadgeWinner(
        numericValueOrNull(latestMetrics?.tradeCount as NumberLike),
        numericValueOrNull(bestMetrics?.tradeCount as NumberLike),
      ),
    },
  ];
}

function normalizeSymbols(symbols: string[]): string[] {
  return [
    ...new Set(
      symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    ),
  ];
}

async function resolveStudySymbols(input: CreateStudyInput): Promise<string[]> {
  const explicitSymbols = normalizeSymbols(input.symbols);
  if (explicitSymbols.length > 0) {
    return explicitSymbols;
  }

  if (!input.watchlistId) {
    throw new HttpError(400, "Backtest studies require at least one symbol.", {
      code: "backtest_symbols_required",
    });
  }

  const rows = await db
    .select({ symbol: instrumentsTable.symbol })
    .from(watchlistItemsTable)
    .innerJoin(
      instrumentsTable,
      eq(watchlistItemsTable.instrumentId, instrumentsTable.id),
    )
    .where(eq(watchlistItemsTable.watchlistId, input.watchlistId))
    .orderBy(asc(watchlistItemsTable.sortOrder));

  const symbols = normalizeSymbols(rows.map((row) => row.symbol));

  if (symbols.length === 0) {
    throw new HttpError(400, "Selected watchlist has no symbols.", {
      code: "backtest_watchlist_empty",
    });
  }

  return symbols;
}

function ensureStrategyCompatibility(
  strategy: StrategyCatalogItem | null,
  timeframe: string,
  requireRunnable: boolean,
): void {
  if (!strategy) {
    throw new HttpError(400, "Unknown backtest strategy.", {
      code: "backtest_strategy_not_found",
    });
  }

  if (!strategy.supportedTimeframes.includes(timeframe as never)) {
    throw new HttpError(
      400,
      "Selected timeframe is not supported by this strategy.",
      {
        code: "backtest_timeframe_unsupported",
      },
    );
  }

  if (requireRunnable && strategy.status !== "runnable") {
    throw new HttpError(400, "Strategy is not runnable yet.", {
      code: "backtest_strategy_blocked",
      detail: strategy.unsupportedFeatures.join("; "),
    });
  }
}

function studyRecordToResponse(study: BacktestStudy) {
  return {
    id: study.id,
    name: study.name,
    strategyId: study.strategyId,
    strategyVersion: study.strategyVersion,
    directionMode: study.directionMode,
    watchlistId: study.watchlistId ?? null,
    symbols: study.symbols,
    timeframe: study.timeframe,
    startsAt: study.startsAt,
    endsAt: study.endsAt,
    parameters: study.parameters,
    portfolioRules: study.portfolioRules as {
      initialCapital: number;
      positionSizePercent: number;
      maxConcurrentPositions: number;
      maxGrossExposurePercent: number;
    },
    executionProfile: study.executionProfile as {
      commissionBps: number;
      slippageBps: number;
    },
    optimizerMode: study.optimizerMode,
    optimizerConfig: study.optimizerConfig,
    createdAt: study.createdAt,
    updatedAt: study.updatedAt,
  };
}

function runSummaryToResponse(run: BacktestRun) {
  return {
    id: run.id,
    studyId: run.studyId,
    sweepId: run.sweepId ?? null,
    name: run.name,
    strategyId: run.strategyId,
    strategyVersion: run.strategyVersion,
    directionMode: run.directionMode,
    status: run.status,
    sortRank: run.sortRank ?? null,
    metrics: (run.metrics as Record<string, unknown> | null) ?? null,
    warnings: run.warnings,
    errorMessage: run.errorMessage ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function tradeToResponse(
  runId: string,
  trade: BacktestRunTrade,
  diagnostics: BacktestTradeDiagnosticsResponse | null,
) {
  return {
    tradeSelectionId: buildTradeSelectionId(runId, trade),
    symbol: trade.symbol,
    side: trade.side,
    entryAt: trade.entryAt,
    exitAt: trade.exitAt,
    entryPrice: numericValue(trade.entryPrice),
    exitPrice: numericValue(trade.exitPrice),
    quantity: numericValue(trade.quantity),
    entryValue: numericValue(trade.entryValue),
    exitValue: numericValue(trade.exitValue),
    grossPnl: numericValue(trade.grossPnl),
    netPnl: numericValue(trade.netPnl),
    netPnlPercent: numericValue(trade.netPnlPercent),
    barsHeld: trade.barsHeld,
    commissionPaid: numericValue(trade.commissionPaid),
    exitReason: trade.exitReason,
    diagnostics,
  };
}

function pointToResponse(point: BacktestRunPoint) {
  return {
    occurredAt: point.occurredAt,
    equity: numericValue(point.equity),
    cash: numericValue(point.cash),
    grossExposure: numericValue(point.grossExposure),
    drawdownPercent: numericValue(point.drawdownPercent),
  };
}

function datasetToResponse(dataset: HistoricalBarDataset) {
  return {
    datasetId: dataset.id,
    symbol: dataset.symbol,
    timeframe: dataset.timeframe,
    source: dataset.source,
    startsAt: dataset.startsAt,
    endsAt: dataset.endsAt,
    barCount: dataset.barCount,
    pinnedCount: dataset.pinnedCount,
    isSeeded: dataset.isSeeded,
  };
}

function jobToResponse(job: BacktestStudyJob) {
  return {
    id: job.id,
    studyId: job.studyId,
    kind: job.kind,
    runId: job.runId ?? null,
    sweepId: job.sweepId ?? null,
    status: job.status,
    progressPercent: job.progressPercent,
    attemptCount: job.attemptCount,
    errorMessage: job.errorMessage ?? null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    lastHeartbeatAt: job.lastHeartbeatAt ?? null,
    createdAt: job.createdAt,
  };
}

async function getStudyOrThrow(studyId: string): Promise<BacktestStudy> {
  const [study] = await db
    .select()
    .from(backtestStudiesTable)
    .where(eq(backtestStudiesTable.id, studyId))
    .limit(1);

  if (!study) {
    throw new HttpError(404, "Backtest study not found.", {
      code: "backtest_study_not_found",
    });
  }

  return study;
}

async function getRunOrThrow(runId: string): Promise<BacktestRun> {
  const [run] = await db
    .select()
    .from(backtestRunsTable)
    .where(eq(backtestRunsTable.id, runId))
    .limit(1);

  if (!run) {
    throw new HttpError(404, "Backtest run not found.", {
      code: "backtest_run_not_found",
    });
  }

  return run;
}

async function getSweepOrThrow(sweepId: string): Promise<BacktestSweep> {
  const [sweep] = await db
    .select()
    .from(backtestSweepsTable)
    .where(eq(backtestSweepsTable.id, sweepId))
    .limit(1);

  if (!sweep) {
    throw new HttpError(404, "Backtest sweep not found.", {
      code: "backtest_sweep_not_found",
    });
  }

  return sweep;
}

async function listRunDatasets(runId: string) {
  return db
    .select({
      dataset: historicalBarDatasetsTable,
    })
    .from(backtestRunDatasetsTable)
    .innerJoin(
      historicalBarDatasetsTable,
      eq(backtestRunDatasetsTable.datasetId, historicalBarDatasetsTable.id),
    )
    .where(eq(backtestRunDatasetsTable.runId, runId))
    .orderBy(desc(historicalBarDatasetsTable.endsAt));
}

async function listRunDatasetBindings(runId: string) {
  return db
    .select({
      dataset: historicalBarDatasetsTable,
      role: backtestRunDatasetsTable.role,
    })
    .from(backtestRunDatasetsTable)
    .innerJoin(
      historicalBarDatasetsTable,
      eq(backtestRunDatasetsTable.datasetId, historicalBarDatasetsTable.id),
    )
    .where(eq(backtestRunDatasetsTable.runId, runId))
    .orderBy(desc(historicalBarDatasetsTable.endsAt));
}

async function loadBacktestBarsForDataset(
  datasetId: string,
): Promise<BacktestBar[]> {
  const rows = await db
    .select({
      startsAt: historicalBarsTable.startsAt,
      open: historicalBarsTable.open,
      high: historicalBarsTable.high,
      low: historicalBarsTable.low,
      close: historicalBarsTable.close,
      volume: historicalBarsTable.volume,
    })
    .from(historicalBarsTable)
    .where(eq(historicalBarsTable.datasetId, datasetId))
    .orderBy(asc(historicalBarsTable.startsAt));

  return rows.map(normalizeBacktestBar);
}

async function loadRunBarsForSymbol(
  runId: string,
  symbol: string,
  timeframe: BacktestTimeframe,
): Promise<BacktestBar[]> {
  const datasetRows = await listRunDatasets(runId);
  const matchingDataset = datasetRows
    .map(({ dataset }) => dataset)
    .find((dataset) => normalizeSymbol(dataset.symbol) === symbol);

  if (!matchingDataset) {
    return [];
  }

  const storedBars = await loadBacktestBarsForDataset(matchingDataset.id);
  if (matchingDataset.timeframe === timeframe) {
    return storedBars;
  }

  return aggregateBars(storedBars, timeframe);
}

async function loadRunBarsForRole(
  runId: string,
  role: string,
  timeframe: BacktestTimeframe,
): Promise<BacktestBar[]> {
  const datasetRows = await listRunDatasetBindings(runId);
  const matchingDataset =
    datasetRows.find((binding) => binding.role === role)?.dataset ?? null;

  if (!matchingDataset) {
    return [];
  }

  const storedBars = await loadBacktestBarsForDataset(matchingDataset.id);
  if (matchingDataset.timeframe === timeframe) {
    return storedBars;
  }

  return aggregateBars(storedBars, timeframe);
}

async function loadRunPoints(runId: string): Promise<BacktestEquityPoint[]> {
  const points = await db
    .select()
    .from(backtestRunPointsTable)
    .where(eq(backtestRunPointsTable.runId, runId))
    .orderBy(asc(backtestRunPointsTable.occurredAt));

  return points.map((point) => ({
    occurredAt: point.occurredAt,
    equity: numericValue(point.equity),
    drawdownPercent: numericValue(point.drawdownPercent),
  }));
}

function buildTradeMarkerGroups(
  chartBars: Array<{ time: number }>,
  tradeOverlays: Array<{
    tradeSelectionId: string;
    dir: "long" | "short";
    profitable?: boolean | null;
    entryBarIndex: number | null;
    exitBarIndex: number | null;
  }>,
) {
  const entryGroups = new Map<
    string,
    {
      id: string;
      kind: "entry";
      time: number;
      dir: "long" | "short";
      profitable: null;
      barIndex: number | null;
      tradeSelectionIds: string[];
      label: string | null;
    }
  >();
  const exitGroups = new Map<
    string,
    {
      id: string;
      kind: "exit";
      time: number;
      dir: "long" | "short";
      profitable: boolean | null;
      barIndex: number | null;
      tradeSelectionIds: string[];
      label: string | null;
    }
  >();
  const timeToTradeIds = new Map<string, Set<string>>();

  tradeOverlays.forEach((overlay) => {
    if (overlay.entryBarIndex != null) {
      const entryTime = chartBars[overlay.entryBarIndex]?.time;
      if (typeof entryTime === "number") {
        const key = `${overlay.entryBarIndex}:${overlay.dir}`;
        const existing = entryGroups.get(key) ?? {
          id: `entry-${key}`,
          kind: "entry" as const,
          time: entryTime,
          dir: overlay.dir,
          profitable: null,
          barIndex: overlay.entryBarIndex,
          tradeSelectionIds: [],
          label: null,
        };
        existing.tradeSelectionIds.push(overlay.tradeSelectionId);
        entryGroups.set(key, existing);
        const timeKey = String(entryTime);
        const idsAtTime = timeToTradeIds.get(timeKey) ?? new Set<string>();
        idsAtTime.add(overlay.tradeSelectionId);
        timeToTradeIds.set(timeKey, idsAtTime);
      }
    }

    if (overlay.exitBarIndex != null) {
      const exitTime = chartBars[overlay.exitBarIndex]?.time;
      if (typeof exitTime === "number") {
        const key = `${overlay.exitBarIndex}:${overlay.dir}:${overlay.profitable ? "win" : "loss"}`;
        const existing = exitGroups.get(key) ?? {
          id: `exit-${key}`,
          kind: "exit" as const,
          time: exitTime,
          dir: overlay.dir,
          profitable: overlay.profitable ?? null,
          barIndex: overlay.exitBarIndex,
          tradeSelectionIds: [],
          label: null,
        };
        existing.tradeSelectionIds.push(overlay.tradeSelectionId);
        exitGroups.set(key, existing);
        const timeKey = String(exitTime);
        const idsAtTime = timeToTradeIds.get(timeKey) ?? new Set<string>();
        idsAtTime.add(overlay.tradeSelectionId);
        timeToTradeIds.set(timeKey, idsAtTime);
      }
    }
  });

  const normalizeGroup = <
    T extends {
      tradeSelectionIds: string[];
      label: string | null;
      time: number;
    },
  >(
    group: T,
  ): T => ({
    ...group,
    label:
      group.tradeSelectionIds.length > 1
        ? String(group.tradeSelectionIds.length)
        : null,
  });

  const normalizedEntryGroups = [...entryGroups.values()]
    .map(normalizeGroup)
    .sort((left, right) => left.time - right.time);
  const normalizedExitGroups = [...exitGroups.values()]
    .map(normalizeGroup)
    .sort((left, right) => left.time - right.time);

  return {
    entryGroups: normalizedEntryGroups,
    exitGroups: normalizedExitGroups,
    interactionGroups: [...normalizedEntryGroups, ...normalizedExitGroups].sort(
      (left, right) => left.time - right.time,
    ),
    timeToTradeIds: [...timeToTradeIds.entries()].map(([time, ids]) => ({
      time,
      tradeSelectionIds: [...ids],
    })),
  };
}

function buildRunIndicatorPayload(
  run: Pick<BacktestRun, "strategyId">,
  strategyParameters: Record<string, unknown>,
  selectedSymbol: string,
  signalBars: BacktestBar[],
  chartBars: Array<{ time: number; ts: string }>,
  chartBarRanges: Array<{ startMs: number; endMs: number }>,
) {
  if (run.strategyId !== "ray_replica_signals" || signalBars.length === 0) {
    return {
      indicatorEvents: [],
      indicatorZones: [],
      indicatorWindows: [],
      indicatorMarkerPayload: {
        overviewMarkers: [],
        markersByTradeId: {},
        timeToTradeIds: [],
      },
    };
  }

  const tape = buildRayReplicaSignalTape(
    signalBars,
    Object.fromEntries(
      Object.entries(strategyParameters).map(([key, value]) => [
        key,
        coerceScalarParameter(value),
      ]),
    ),
  );
  const indicatorEvents = tape.events.map((event) => {
    const timeIndex = resolveBarIndex(
      event.occurredAt.getTime(),
      chartBarRanges,
    );

    return {
      id: event.id,
      strategy: run.strategyId,
      eventType: `${event.direction}_${event.kind}`,
      ts: event.occurredAt,
      time: timeIndex != null ? chartBars[timeIndex]?.time ?? null : null,
      barIndex: timeIndex,
      direction: event.direction,
      label: event.label,
      conviction: null,
      meta: {
        symbol: selectedSymbol,
        sourceBarIndex: event.sourceBarIndex,
        sourcePrice: event.sourcePrice,
      },
    };
  });
  const indicatorWindows = tape.regimeWindows.map((window) => {
    const startBarIndex = resolveBarIndex(
      window.startAt.getTime(),
      chartBarRanges,
    );
    const endBarIndex = resolveBarIndex(
      window.endAt.getTime(),
      chartBarRanges,
    );

    return {
      id: window.id,
      strategy: run.strategyId,
      direction: window.direction,
      startTs: window.startAt,
      endTs: window.endAt,
      startBarIndex,
      endBarIndex,
      tone: window.tone,
      conviction: null,
      meta: {
        symbol: selectedSymbol,
        source: "ray_replica_signals",
      },
    };
  });
  const overviewMarkers = tape.events
    .filter((event) => event.kind === "choch")
    .map((event) => {
      const barIndex = resolveBarIndex(event.occurredAt.getTime(), chartBarRanges);
      return {
        id: `${event.id}-marker`,
        time: barIndex != null ? chartBars[barIndex]?.time ?? 0 : 0,
        barIndex,
        position:
          event.direction === "long"
            ? ("belowBar" as const)
            : ("aboveBar" as const),
        shape:
          event.direction === "long"
            ? ("arrowUp" as const)
            : ("arrowDown" as const),
        color: event.direction === "long" ? "#00bcd4" : "#e91e63",
        text: event.direction === "long" ? "BUY" : "SELL",
        size: 1,
      };
    })
    .filter((marker) => marker.time > 0);

  return {
    indicatorEvents,
    indicatorZones: [],
    indicatorWindows,
    indicatorMarkerPayload: {
      overviewMarkers,
      markersByTradeId: {},
      timeToTradeIds: [],
    },
  };
}

function resolveRunExecutionMode(
  parameters: Record<string, unknown> | null | undefined,
): "spot" | "options" {
  return parameters?.executionMode === "options" ||
    parameters?.executionMode === "signal_options"
    ? "options"
    : "spot";
}

function coerceScalarParameter(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

export function listBacktestStrategies() {
  return {
    strategies: listStrategies(),
  };
}

export async function listBacktestStudies() {
  const studies = await db
    .select()
    .from(backtestStudiesTable)
    .orderBy(desc(backtestStudiesTable.updatedAt));

  return {
    studies: studies.map(studyRecordToResponse),
  };
}

export async function createBacktestStudy(input: CreateStudyInput) {
  const strategy = getStrategyCatalogItem(
    input.strategyId,
    input.strategyVersion,
  );
  ensureStrategyCompatibility(strategy, input.timeframe, false);
  const symbols = await resolveStudySymbols(input);

  const [study] = await db
    .insert(backtestStudiesTable)
    .values({
      name: input.name,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      directionMode: input.directionMode,
      watchlistId: input.watchlistId,
      symbols,
      timeframe: input.timeframe,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      parameters: {
        ...(strategy?.defaultParameters ?? {}),
        ...input.parameters,
      },
      portfolioRules: input.portfolioRules,
      executionProfile: input.executionProfile,
      optimizerMode: input.optimizerMode,
      optimizerConfig: input.optimizerConfig,
    })
    .returning();

  return studyRecordToResponse(study);
}

export async function getBacktestStudy(studyId: string) {
  const study = await getStudyOrThrow(studyId);
  return studyRecordToResponse(study);
}

export async function listBacktestRuns(input: {
  studyId?: string;
  sweepId?: string;
  status?:
    | "queued"
    | "preparing_data"
    | "running"
    | "aggregating"
    | "completed"
    | "failed"
    | "cancel_requested"
    | "canceled";
}) {
  const filters = [
    input.studyId ? eq(backtestRunsTable.studyId, input.studyId) : undefined,
    input.sweepId ? eq(backtestRunsTable.sweepId, input.sweepId) : undefined,
    input.status ? eq(backtestRunsTable.status, input.status) : undefined,
  ].filter(Boolean);

  const runs = await db
    .select()
    .from(backtestRunsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(backtestRunsTable.createdAt));

  return {
    runs: runs.map(runSummaryToResponse),
  };
}

async function buildRunDetail(run: BacktestRun) {
  const study = await getStudyOrThrow(run.studyId);
  const trades = await db
    .select()
    .from(backtestRunTradesTable)
    .where(eq(backtestRunTradesTable.runId, run.id))
    .orderBy(asc(backtestRunTradesTable.entryAt));
  const points = await db
    .select()
    .from(backtestRunPointsTable)
    .where(eq(backtestRunPointsTable.runId, run.id))
    .orderBy(asc(backtestRunPointsTable.occurredAt));
  const datasetRows = await db
    .select({
      dataset: historicalBarDatasetsTable,
    })
    .from(backtestRunDatasetsTable)
    .innerJoin(
      historicalBarDatasetsTable,
      eq(backtestRunDatasetsTable.datasetId, historicalBarDatasetsTable.id),
    )
    .where(eq(backtestRunDatasetsTable.runId, run.id));
  const datasets = datasetRows.map(({ dataset }) => dataset);
  const tradeDiagnosticsByTradeId = await buildTradeDiagnosticsMap(
    run.id,
    study,
    trades,
    datasets,
  );

  return {
    run: runSummaryToResponse(run),
    study: studyRecordToResponse(study),
    trades: trades.map((trade) =>
      tradeToResponse(
        run.id,
        trade,
        tradeDiagnosticsByTradeId.get(buildTradeSelectionId(run.id, trade)) ??
          null,
      ),
    ),
    points: points.map(pointToResponse),
    datasets: datasets.map((dataset) => datasetToResponse(dataset)),
  };
}

export async function createBacktestRun(input: CreateRunInput) {
  const study = await getStudyOrThrow(input.studyId);
  const strategy = getStrategyCatalogItem(
    study.strategyId,
    study.strategyVersion,
  );
  ensureStrategyCompatibility(strategy, study.timeframe, true);
  const parameters = {
    ...(study.parameters ?? {}),
    ...(input.parameters ?? {}),
  };

  const result = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(backtestRunsTable)
      .values({
        studyId: study.id,
        name: input.name ?? `${study.name} Run`,
        strategyId: study.strategyId,
        strategyVersion: study.strategyVersion,
        directionMode: study.directionMode,
        status: "queued",
        symbolUniverse: study.symbols,
        parameters,
        portfolioRules: study.portfolioRules,
        executionProfile: study.executionProfile,
      })
      .returning();

    await tx.insert(backtestStudyJobsTable).values({
      studyId: study.id,
      kind: "single_run",
      runId: run.id,
      status: "queued",
      progressPercent: 0,
      payload: { parameters },
    });

    return run;
  });

  return buildRunDetail(result);
}

export async function getBacktestRun(runId: string) {
  const run = await getRunOrThrow(runId);
  return buildRunDetail(run);
}

export async function getBacktestRunChart(
  runId: string,
  input: {
    symbol?: string | null;
    selectedTradeId?: string | null;
  } = {},
) {
  const run = await getRunOrThrow(runId);
  const study = await getStudyOrThrow(run.studyId);
  const indicatorParameters = {
    ...(study.parameters ?? {}),
    ...(run.parameters ?? {}),
  };
  const executionMode = resolveRunExecutionMode(indicatorParameters);
  const trades = await db
    .select()
    .from(backtestRunTradesTable)
    .where(eq(backtestRunTradesTable.runId, run.id))
    .orderBy(asc(backtestRunTradesTable.entryAt));
  const availableSymbols = [
    ...new Set([
      ...normalizeSymbols(study.symbols),
      ...normalizeSymbols(trades.map((trade) => trade.symbol)),
    ]),
  ];
  const selectedSymbol =
    resolveSelectedSymbol(study, trades, input.symbol) ||
    availableSymbols[0] ||
    "";
  const spotBars = selectedSymbol
    ? await loadRunBarsForSymbol(
        run.id,
        selectedSymbol,
        study.timeframe as BacktestTimeframe,
      )
    : [];
  const { chartBarRanges: spotChartBarRanges } = buildChartBarsFromBacktestBars(
    spotBars,
    study.timeframe,
  );
  const tradesForSelectedSymbol = trades.filter(
    (trade) => normalizeSymbol(trade.symbol) === selectedSymbol,
  );
  const defaultTradeSelectionId =
    (tradesForSelectedSymbol.length > 0
      ? buildTradeSelectionId(
          run.id,
          tradesForSelectedSymbol[tradesForSelectedSymbol.length - 1]!,
        )
      : null) ?? null;
  const activeTradeSelectionId = tradesForSelectedSymbol.some(
    (trade) => buildTradeSelectionId(run.id, trade) === input.selectedTradeId,
  )
    ? (input.selectedTradeId ?? null)
    : defaultTradeSelectionId;
  const activeTradeRecord =
    tradesForSelectedSymbol.find(
      (trade) => buildTradeSelectionId(run.id, trade) === activeTradeSelectionId,
    ) ?? null;
  const optionBars =
    executionMode === "options" && activeTradeRecord
      ? await loadRunBarsForRole(
          run.id,
          buildOptionDatasetRole(activeTradeRecord.symbol, activeTradeRecord.entryAt),
          study.timeframe as BacktestTimeframe,
        )
      : [];
  const chartPriceContext =
    executionMode === "options" && optionBars.length > 0 ? ("option" as const) : ("spot" as const);
  const chartContextBars =
    chartPriceContext === "option" ? optionBars : spotBars;
  const { chartBars, chartBarRanges } = buildChartBarsFromBacktestBars(
    chartContextBars,
    study.timeframe,
  );

  const spotPriceAt = (timestampMs: number): number | null => {
    const barIndex = resolveBarIndex(timestampMs, spotChartBarRanges);
    return barIndex != null ? spotBars[barIndex]?.close ?? null : null;
  };

  const tradeOverlays = trades.reduce<
    Array<{
      id: string;
      tradeSelectionId: string;
      symbol: string;
      entryBarIndex: number | null;
      exitBarIndex: number | null;
      entryTs: string;
      exitTs: string;
      dir: "long" | "short";
      strat: string;
      qty: number;
      pnl: number;
      pnlPercent: number;
      er: string;
      profitable: boolean;
      pricingMode: "shares" | "options";
      chartPriceContext: "spot" | "option";
      entryPrice: number;
      exitPrice: number;
      oe: number;
      ep: number;
      exitFill: number;
      entrySpotPrice: number;
      exitSpotPrice: number;
      entryBasePrice: null;
      exitBasePrice: null;
      stopLossPrice: number | null;
      takeProfitPrice: number | null;
      trailActivationPrice: null;
      lastTrailStopPrice: number | null;
      exitTriggerPrice: number | null;
      thresholdPath: {
        segments: Array<{
          id: string;
          kind: "take_profit" | "stop_loss" | "trail_stop" | "exit_trigger";
          startBarIndex: number;
          endBarIndex: number;
          value: number;
          style: "solid" | "dashed" | "dotted";
          hit: boolean | null;
          label: string | null;
        }>;
      } | null;
    }>
  >((overlays, trade) => {
    if (normalizeSymbol(trade.symbol) !== selectedSymbol) {
      return overlays;
    }

    const entryBarIndex = resolveBarIndex(
      trade.entryAt.getTime(),
      chartBarRanges,
    );
    const exitBarIndex = resolveBarIndex(
      trade.exitAt.getTime(),
      chartBarRanges,
    );

    const tradeSelectionId = buildTradeSelectionId(run.id, trade);
    const entryPrice = numericValue(trade.entryPrice);
    const exitPrice = numericValue(trade.exitPrice);
    const netPnl = numericValue(trade.netPnl);
    const entrySpotPrice = spotPriceAt(trade.entryAt.getTime()) ?? entryPrice;
    const exitSpotPrice = spotPriceAt(trade.exitAt.getTime()) ?? exitPrice;
    const thresholdKind = thresholdKindForExitReason(trade.exitReason);
    const thresholdStyle: "solid" | "dashed" =
      thresholdKind === "trail_stop" ? "dashed" : "solid";
    const thresholdPath =
      thresholdKind && entryBarIndex != null && exitBarIndex != null
        ? {
            segments: [
              {
                id: `${tradeSelectionId}-${thresholdKind}`,
                kind: thresholdKind,
                startBarIndex: Math.min(entryBarIndex, exitBarIndex),
                endBarIndex: Math.max(entryBarIndex, exitBarIndex),
                value: exitPrice,
                style: thresholdStyle,
                hit: true,
                label:
                  thresholdKind === "take_profit"
                    ? "Take profit"
                    : thresholdKind === "trail_stop"
                      ? "Trailing stop"
                      : "Stop loss",
              },
            ],
          }
        : null;

    overlays.push({
      id: tradeSelectionId,
      tradeSelectionId,
      symbol: selectedSymbol,
      entryBarIndex,
      exitBarIndex,
      entryTs: trade.entryAt.toISOString(),
      exitTs: trade.exitAt.toISOString(),
      dir: trade.side === "short" ? "short" : "long",
      strat: run.strategyId,
      qty: numericValue(trade.quantity),
      pnl: netPnl,
      pnlPercent: numericValue(trade.netPnlPercent),
      er: trade.exitReason,
      profitable: netPnl >= 0,
      pricingMode: executionMode === "options" ? "options" : "shares",
      chartPriceContext,
      entryPrice,
      exitPrice,
      oe: entryPrice,
      ep: exitPrice,
      exitFill: exitPrice,
      entrySpotPrice,
      exitSpotPrice,
      entryBasePrice: null,
      exitBasePrice: null,
      stopLossPrice: thresholdKind === "stop_loss" ? exitPrice : null,
      takeProfitPrice: thresholdKind === "take_profit" ? exitPrice : null,
      trailActivationPrice: null,
      lastTrailStopPrice: thresholdKind === "trail_stop" ? exitPrice : null,
      exitTriggerPrice: thresholdKind ? exitPrice : null,
      thresholdPath,
    });

    return overlays;
  }, []);
  const activeTrade =
    tradeOverlays.find(
      (overlay) => overlay.tradeSelectionId === activeTradeSelectionId,
    ) ?? null;
  const defaultVisibleLogicalRange = activeTrade
    ? buildFocusedTradeVisibleRange(
        activeTrade.entryBarIndex,
        activeTrade.exitBarIndex,
        chartBars.length,
      )
    : buildDefaultVisibleRange(chartBars.length);
  const tradeMarkerGroups = buildTradeMarkerGroups(chartBars, tradeOverlays);
  const indicatorPayload = buildRunIndicatorPayload(
    run,
    indicatorParameters,
    selectedSymbol,
    spotBars,
    chartBars,
    chartBarRanges,
  );

  return {
    runId: run.id,
    studyId: study.id,
    timeframe: study.timeframe,
    chartPriceContext,
    availableSymbols,
    selectedSymbol,
    defaultTradeSelectionId,
    activeTradeSelectionId,
    chartBars,
    chartBarRanges,
    tradeOverlays,
    tradeMarkerGroups,
    indicatorEvents: indicatorPayload.indicatorEvents,
    indicatorZones: indicatorPayload.indicatorZones,
    indicatorWindows: indicatorPayload.indicatorWindows,
    indicatorMarkerPayload: indicatorPayload.indicatorMarkerPayload,
    selectionFocus: {
      token: buildSelectionFocusToken(
        run.id,
        selectedSymbol,
        activeTradeSelectionId,
        defaultVisibleLogicalRange,
      ),
      tradeSelectionId: activeTradeSelectionId,
      visibleLogicalRange: defaultVisibleLogicalRange,
    },
    defaultVisibleLogicalRange,
  };
}

export async function getBacktestStudyPreviewChart(studyId: string) {
  await getStudyOrThrow(studyId);
  const completedRuns = await db
    .select()
    .from(backtestRunsTable)
    .where(
      and(
        eq(backtestRunsTable.studyId, studyId),
        eq(backtestRunsTable.status, "completed"),
      ),
    )
    .orderBy(desc(backtestRunsTable.createdAt));
  const latestCompletedRun =
    [...completedRuns].sort(compareCompletedRuns)[0] ?? null;
  const bestCompletedRun = resolveBestCompletedRun(completedRuns);
  const [latestSeries, bestSeries] = await Promise.all([
    latestCompletedRun
      ? loadRunPoints(latestCompletedRun.id)
      : Promise.resolve([]),
    bestCompletedRun ? loadRunPoints(bestCompletedRun.id) : Promise.resolve([]),
  ]);

  return {
    studyId,
    latestCompletedRun: latestCompletedRun
      ? runSummaryToResponse(latestCompletedRun)
      : null,
    bestCompletedRun: bestCompletedRun
      ? runSummaryToResponse(bestCompletedRun)
      : null,
    comparisonBadges: buildComparisonBadges(
      latestCompletedRun,
      bestCompletedRun,
    ),
    latestSeries,
    bestSeries,
  };
}

export async function createBacktestSweep(input: CreateSweepInput) {
  const study = await getStudyOrThrow(input.studyId);
  const strategy = getStrategyCatalogItem(
    study.strategyId,
    study.strategyVersion,
  );
  ensureStrategyCompatibility(strategy, study.timeframe, true);
  const baseParameters = {
    ...(study.parameters ?? {}),
    ...input.baseParameters,
  };
  const candidateParameters = buildCandidatesForMode(
    input.mode,
    Object.fromEntries(
      Object.entries(baseParameters).map(([key, value]) => [
        key,
        coerceScalarParameter(value),
      ]),
    ),
    input.dimensions.map((dimension) => ({
      key: dimension.key,
      values: dimension.values.map(coerceScalarParameter),
    })),
    input.randomCandidateBudget ?? 100,
  );
  const walkForwardWindows =
    input.mode === "walk_forward"
      ? buildWalkForwardWindows(
          study.startsAt,
          study.endsAt,
          input.walkForwardTrainingMonths ?? 24,
          input.walkForwardTestMonths ?? 6,
          input.walkForwardStepMonths ?? 6,
        )
      : [];

  const sweep = await db.transaction(async (tx) => {
    const [createdSweep] = await tx
      .insert(backtestSweepsTable)
      .values({
        studyId: study.id,
        mode: input.mode,
        status: "queued",
        candidateTargetCount: candidateParameters.length,
        candidateCompletedCount: 0,
      })
      .returning();

    await tx.insert(backtestStudyJobsTable).values({
      studyId: study.id,
      kind: "sweep",
      sweepId: createdSweep.id,
      status: "queued",
      progressPercent: 0,
      payload: {
        mode: input.mode,
        baseParameters,
        dimensions: input.dimensions,
        randomCandidateBudget: input.randomCandidateBudget,
        walkForwardTrainingMonths: input.walkForwardTrainingMonths,
        walkForwardTestMonths: input.walkForwardTestMonths,
        walkForwardStepMonths: input.walkForwardStepMonths,
        candidateTargetCount: candidateParameters.length,
        walkForwardWindows,
      },
    });

    return createdSweep;
  });

  return {
    id: sweep.id,
    studyId: sweep.studyId,
    mode: sweep.mode,
    status: sweep.status,
    candidateTargetCount: sweep.candidateTargetCount,
    candidateCompletedCount: sweep.candidateCompletedCount,
    bestRunId: sweep.bestRunId ?? null,
    startedAt: sweep.startedAt ?? null,
    finishedAt: sweep.finishedAt ?? null,
    candidates: [],
  };
}

export async function getBacktestSweep(sweepId: string) {
  const sweep = await getSweepOrThrow(sweepId);
  const candidates = await db
    .select()
    .from(backtestRunsTable)
    .where(eq(backtestRunsTable.sweepId, sweep.id))
    .orderBy(
      asc(backtestRunsTable.sortRank),
      desc(backtestRunsTable.createdAt),
    );

  return {
    id: sweep.id,
    studyId: sweep.studyId,
    mode: sweep.mode,
    status: sweep.status,
    candidateTargetCount: sweep.candidateTargetCount,
    candidateCompletedCount: sweep.candidateCompletedCount,
    bestRunId: sweep.bestRunId ?? null,
    startedAt: sweep.startedAt ?? null,
    finishedAt: sweep.finishedAt ?? null,
    candidates: candidates.map(runSummaryToResponse),
  };
}

export async function listBacktestJobs() {
  const jobs = await db
    .select()
    .from(backtestStudyJobsTable)
    .orderBy(desc(backtestStudyJobsTable.createdAt))
    .limit(50);

  return {
    jobs: jobs.map(jobToResponse),
  };
}

export async function cancelBacktestJob(jobId: string) {
  const [job] = await db
    .update(backtestStudyJobsTable)
    .set({
      status: "cancel_requested",
      cancelRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId))
    .returning();

  if (!job) {
    throw new HttpError(404, "Backtest job not found.", {
      code: "backtest_job_not_found",
    });
  }

  return jobToResponse(job);
}

export async function promoteBacktestRun(input: PromoteRunInput) {
  const run = await getRunOrThrow(input.runId);

  if (run.status !== "completed") {
    throw new HttpError(400, "Only completed runs can be promoted.", {
      code: "backtest_run_not_completed",
    });
  }

  const study = await getStudyOrThrow(run.studyId);

  const draft = await db.transaction(async (tx) => {
    const [strategy] = await tx
      .insert(algoStrategiesTable)
      .values({
        name: input.name,
        mode: "paper",
        enabled: false,
        symbolUniverse: study.symbols,
        config: {
          source: "backtest",
          sourceRunId: run.id,
          sourceStudyId: study.id,
          strategyId: run.strategyId,
          strategyVersion: run.strategyVersion,
          parameters: run.parameters,
          portfolioRules: run.portfolioRules,
          executionProfile: run.executionProfile,
          metrics: run.metrics,
          notes: input.notes,
        },
      })
      .returning();

    await tx.insert(backtestPromotionsTable).values({
      studyId: study.id,
      runId: run.id,
      algoStrategyId: strategy.id,
      notes: input.notes,
    });

    return strategy;
  });

  return {
    id: draft.id,
    runId: run.id,
    studyId: study.id,
    name: draft.name,
    enabled: draft.enabled,
    mode: draft.mode,
    symbolUniverse: draft.symbolUniverse,
    config: draft.config,
    promotedAt: new Date(),
  };
}

export async function listBacktestDraftStrategies() {
  const rows = await db
    .select({
      promotion: backtestPromotionsTable,
      strategy: algoStrategiesTable,
    })
    .from(backtestPromotionsTable)
    .innerJoin(
      algoStrategiesTable,
      eq(backtestPromotionsTable.algoStrategyId, algoStrategiesTable.id),
    )
    .orderBy(desc(backtestPromotionsTable.promotedAt));

  return {
    drafts: rows.map(({ promotion, strategy }) => ({
      id: strategy.id,
      runId: promotion.runId,
      studyId: promotion.studyId,
      name: strategy.name,
      enabled: strategy.enabled,
      mode: strategy.mode,
      symbolUniverse: strategy.symbolUniverse,
      config: strategy.config,
      promotedAt: promotion.promotedAt,
    })),
  };
}
