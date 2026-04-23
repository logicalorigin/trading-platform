import {
  aggregateBars,
  buildCandidatesForMode,
  buildRayReplicaSignalTape,
  buildWalkForwardWindows,
  rankCandidateResults,
  runBacktest,
  type BacktestBar,
  type BacktestMetrics,
  type BacktestPoint,
  type BacktestTrade,
  type StudyDefinition,
} from "@workspace/backtest-core";
import {
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
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  API_BASE_URL,
  BAR_STORAGE_TARGET_BYTES,
  JOB_STALE_AFTER_MS,
  MAX_JOB_ATTEMPTS,
  MAX_PARALLEL_SWEEP_RUNS,
  WORKER_POLL_INTERVAL_MS,
} from "./runtime";

type ApiBarsResponse = {
  symbol: string;
  timeframe: string;
  bars: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
};

type ApiResolvedOptionContractResponse = {
  contract: {
    ticker: string;
    underlying: string;
    expirationDate: string;
    strike: number;
    right: "call" | "put";
    multiplier: number;
    sharesPerContract: number;
    providerContractId: string | null;
    contractPresetId: string;
    dte: number;
  } | null;
};

type StudyRow = typeof backtestStudiesTable.$inferSelect;
type RunRow = typeof backtestRunsTable.$inferSelect;
type SweepRow = typeof backtestSweepsTable.$inferSelect;
type JobRow = typeof backtestStudyJobsTable.$inferSelect;
type DatasetRow = typeof historicalBarDatasetsTable.$inferSelect;

type LoadedDataset = {
  dataset: DatasetRow;
  bars: BacktestBar[];
};

type RunDatasetBinding = {
  dataset: DatasetRow;
  role: string;
};

type PersistedResult = {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  points: BacktestPoint[];
  warnings: string[];
};

type HistoricalBarsRequest = {
  symbol: string;
  timeframe: string;
  from: Date;
  to: Date;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
};

type ResolvedOptionContract = {
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

type OptionPositionState = {
  symbol: string;
  right: "call" | "put";
  dataset: DatasetRow;
  bars: BacktestBar[];
  contract: ResolvedOptionContract;
  entryAt: Date;
  entryPrice: number;
  quantity: number;
  entryValue: number;
  entryCommissionPaid: number;
};

type SimulatedOptionTrade = BacktestTrade & {
  dataset: DatasetRow;
  bars: BacktestBar[];
  contract: ResolvedOptionContract;
  entryCommissionPaid: number;
  exitCommissionPaid: number;
};

const benchmarkSymbols = ["SPY", "QQQ"] as const;

const newYorkTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeBar(bar: ApiBarsResponse["bars"][number]): BacktestBar {
  return {
    startsAt: new Date(bar.timestamp),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function isRegularSessionBar(date: Date): boolean {
  const parts = newYorkTimeFormatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 570 && totalMinutes <= 960;
}

function filterRegularSessionBars(timeframe: string, bars: BacktestBar[]): BacktestBar[] {
  if (timeframe === "1d") {
    return bars;
  }

  return bars.filter((bar) => isRegularSessionBar(bar.startsAt));
}

function timeframeToDays(timeframe: string): number {
  switch (timeframe) {
    case "1m":
      return 60;
    case "5m":
    case "15m":
      return 180;
    case "1h":
      return 365;
    case "1d":
      return 3650;
    default:
      return 60;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} from ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchBarsRange(input: HistoricalBarsRequest): Promise<BacktestBar[]> {
  const url = new URL(`${API_BASE_URL}/bars`);
  url.searchParams.set("symbol", input.symbol);
  url.searchParams.set("timeframe", input.timeframe);
  url.searchParams.set("from", input.from.toISOString());
  url.searchParams.set("to", input.to.toISOString());
  url.searchParams.set("limit", "50000");
  if (input.assetClass) {
    url.searchParams.set("assetClass", input.assetClass);
  }
  if (input.providerContractId) {
    url.searchParams.set("providerContractId", input.providerContractId);
  }

  const payload = await fetchJson<ApiBarsResponse>(url.toString());
  return filterRegularSessionBars(
    input.timeframe,
    payload.bars.map(normalizeBar),
  );
}

async function fetchBarsSegmented(input: HistoricalBarsRequest): Promise<BacktestBar[]> {
  const segmentDays = timeframeToDays(input.timeframe);
  const results: BacktestBar[] = [];
  let cursor = new Date(input.from.getTime());

  while (cursor < input.to) {
    const segmentEnd = new Date(
      Math.min(
        input.to.getTime(),
        cursor.getTime() + segmentDays * 24 * 60 * 60 * 1000,
      ),
    );
    const nextBars = await fetchBarsRange({
      ...input,
      from: cursor,
      to: segmentEnd,
    });
    results.push(...nextBars);
    cursor = new Date(segmentEnd.getTime() + 60_000);
  }

  return results
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
    .filter((bar, index, allBars) => {
      const previous = allBars[index - 1];
      return !previous || previous.startsAt.getTime() !== bar.startsAt.getTime();
    });
}

function estimateByteSize(bars: BacktestBar[]): number {
  return bars.length * 64;
}

async function getStoredBarStorageBytes(): Promise<number> {
  const [row] = await db
    .select({
      totalBytes: sql<number>`coalesce(sum(${historicalBarDatasetsTable.byteSize}), 0)`,
    })
    .from(historicalBarDatasetsTable);

  return row?.totalBytes ?? 0;
}

async function evictNonPinnedDatasets(): Promise<void> {
  let totalBytes = await getStoredBarStorageBytes();

  if (totalBytes <= BAR_STORAGE_TARGET_BYTES) {
    return;
  }

  const candidates = await db
    .select()
    .from(historicalBarDatasetsTable)
    .where(eq(historicalBarDatasetsTable.pinnedCount, 0))
    .orderBy(asc(historicalBarDatasetsTable.lastAccessedAt));

  for (const dataset of candidates) {
    if (totalBytes <= BAR_STORAGE_TARGET_BYTES) {
      break;
    }

    await db
      .delete(historicalBarsTable)
      .where(eq(historicalBarsTable.datasetId, dataset.id));
    await db
      .delete(historicalBarDatasetsTable)
      .where(eq(historicalBarDatasetsTable.id, dataset.id));
    totalBytes -= dataset.byteSize;
  }
}

async function insertBars(datasetId: string, bars: BacktestBar[]): Promise<void> {
  const chunkSize = 1000;
  for (let index = 0; index < bars.length; index += chunkSize) {
    const chunk = bars.slice(index, index + chunkSize);
    await db.insert(historicalBarsTable).values(
      chunk.map((bar) => ({
        datasetId,
        startsAt: bar.startsAt,
        open: String(bar.open),
        high: String(bar.high),
        low: String(bar.low),
        close: String(bar.close),
        volume: String(bar.volume),
      })),
    );
  }
}

async function loadBarsFromDataset(
  dataset: DatasetRow,
  from: Date,
  to: Date,
): Promise<BacktestBar[]> {
  const rows = await db
    .select()
    .from(historicalBarsTable)
    .where(
      and(
        eq(historicalBarsTable.datasetId, dataset.id),
        gt(historicalBarsTable.startsAt, new Date(from.getTime() - 1)),
        lte(historicalBarsTable.startsAt, to),
      ),
    )
    .orderBy(asc(historicalBarsTable.startsAt));

  await db
    .update(historicalBarDatasetsTable)
    .set({ lastAccessedAt: new Date(), updatedAt: new Date() })
    .where(eq(historicalBarDatasetsTable.id, dataset.id));

  return rows.map((row) => ({
    startsAt: row.startsAt,
    open: safeNumber(row.open),
    high: safeNumber(row.high),
    low: safeNumber(row.low),
    close: safeNumber(row.close),
    volume: safeNumber(row.volume),
  }));
}

async function findCoveringDataset(
  symbol: string,
  timeframe: string,
  from: Date,
  to: Date,
): Promise<DatasetRow | null> {
  const [dataset] = await db
    .select()
    .from(historicalBarDatasetsTable)
    .where(
      and(
        eq(historicalBarDatasetsTable.symbol, symbol),
        eq(historicalBarDatasetsTable.timeframe, timeframe),
        eq(historicalBarDatasetsTable.sessionMode, "regular"),
        lte(historicalBarDatasetsTable.startsAt, from),
        gt(historicalBarDatasetsTable.endsAt, new Date(to.getTime() - 1)),
      ),
    )
    .orderBy(desc(historicalBarDatasetsTable.endsAt))
    .limit(1);

  return dataset ?? null;
}

async function persistDataset(
  symbol: string,
  timeframe: string,
  from: Date,
  to: Date,
  bars: BacktestBar[],
  isSeeded: boolean,
): Promise<DatasetRow> {
  const [dataset] = await db
    .insert(historicalBarDatasetsTable)
    .values({
      symbol,
      timeframe,
      source: "massive",
      sessionMode: "regular",
      startsAt: from,
      endsAt: to,
      barCount: bars.length,
      byteSize: estimateByteSize(bars),
      pinnedCount: 0,
      isSeeded,
      lastAccessedAt: new Date(),
    })
    .returning();

  await insertBars(dataset.id, bars);
  await evictNonPinnedDatasets();
  return dataset;
}

async function loadDataset(
  input: {
    symbol: string;
    timeframe: string;
    from: Date;
    to: Date;
    preferSeededMinuteDataset: boolean;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
  },
): Promise<LoadedDataset> {
  const canonicalTimeframe =
    input.preferSeededMinuteDataset && input.timeframe !== "1m"
      ? "1m"
      : input.timeframe;
  const existingDataset = await findCoveringDataset(
    input.symbol,
    canonicalTimeframe,
    input.from,
    input.to,
  );

  if (existingDataset) {
    const existingBars = await loadBarsFromDataset(
      existingDataset,
      input.from,
      input.to,
    );
    return {
      dataset: existingDataset,
      bars:
        canonicalTimeframe === input.timeframe
          ? existingBars
          : aggregateBars(existingBars, input.timeframe as never),
    };
  }

  const fetchedBars = await fetchBarsSegmented({
    symbol: input.symbol,
    timeframe: canonicalTimeframe,
    from: input.from,
    to: input.to,
    assetClass: input.assetClass,
    providerContractId: input.providerContractId,
  });
  const dataset = await persistDataset(
    input.symbol,
    canonicalTimeframe,
    input.from,
    input.to,
    fetchedBars,
    canonicalTimeframe === "1m" &&
      benchmarkSymbols.includes(input.symbol as never),
  );

  return {
    dataset,
    bars:
      canonicalTimeframe === input.timeframe
        ? fetchedBars
        : aggregateBars(fetchedBars, input.timeframe as never),
  };
}

async function loadStudyData(study: StudyRow): Promise<{
  barsBySymbol: Record<string, BacktestBar[]>;
  datasets: DatasetRow[];
}> {
  const barsBySymbol: Record<string, BacktestBar[]> = {};
  const datasets: DatasetRow[] = [];

  for (const symbol of study.symbols) {
    const loaded = await loadDataset({
      symbol,
      timeframe: study.timeframe,
      from: study.startsAt,
      to: study.endsAt,
      preferSeededMinuteDataset: benchmarkSymbols.includes(symbol as never),
      assetClass: "equity",
    });

    barsBySymbol[symbol] = loaded.bars;
    datasets.push(loaded.dataset);
  }

  return { barsBySymbol, datasets };
}

async function pinDatasetsToRun(
  runId: string,
  bindings: RunDatasetBinding[],
): Promise<void> {
  if (bindings.length === 0) {
    return;
  }

  await db.insert(backtestRunDatasetsTable).values(
    bindings.map(({ dataset, role }) => ({
      runId,
      datasetId: dataset.id,
      role,
    })),
  );

  const uniqueDatasetIds = [...new Set(bindings.map(({ dataset }) => dataset.id))];

  await db
    .update(historicalBarDatasetsTable)
    .set({
      pinnedCount: sql`${historicalBarDatasetsTable.pinnedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        historicalBarDatasetsTable.id,
        uniqueDatasetIds,
      ),
    );
}

function buildStudyDefinition(
  study: StudyRow,
  parametersOverride?: Record<string, unknown>,
): StudyDefinition {
  return {
    strategyId: study.strategyId,
    strategyVersion: study.strategyVersion,
    symbols: study.symbols,
    timeframe: study.timeframe as never,
    from: study.startsAt,
    to: study.endsAt,
    parameters: {
      ...(study.parameters ?? {}),
      ...(parametersOverride ?? {}),
    } as Record<string, string | number | boolean>,
    executionProfile: study.executionProfile as {
      commissionBps: number;
      slippageBps: number;
    },
    portfolioRules: study.portfolioRules as {
      initialCapital: number;
      positionSizePercent: number;
      maxConcurrentPositions: number;
      maxGrossExposurePercent: number;
    },
  };
}

function computeCommission(value: number, commissionBps: number): number {
  return value * (commissionBps / 10_000);
}

function applySlippage(price: number, side: "buy" | "sell", slippageBps: number): number {
  const multiplier = slippageBps / 10_000;
  return side === "buy" ? price * (1 + multiplier) : price * (1 - multiplier);
}

function calculateSharpe(points: BacktestPoint[]): number {
  if (points.length < 3) {
    return 0;
  }

  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previousEquity = points[index - 1]?.equity ?? 0;
    const currentEquity = points[index]?.equity ?? 0;

    if (previousEquity <= 0) {
      continue;
    }

    returns.push((currentEquity - previousEquity) / previousEquity);
  }

  if (returns.length < 2) {
    return 0;
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) {
    return 0;
  }

  return (mean / standardDeviation) * Math.sqrt(252);
}

function buildMetrics(
  points: BacktestPoint[],
  trades: BacktestTrade[],
  initialCapital: number,
): BacktestMetrics {
  const endingEquity = points[points.length - 1]?.equity ?? initialCapital;
  const netPnl = endingEquity - initialCapital;
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const profitFactor =
    Math.abs(
      wins.reduce((sum, trade) => sum + trade.netPnl, 0) /
        (losses.reduce((sum, trade) => sum + trade.netPnl, 0) || -1),
    ) || 0;
  const maxDrawdownPercent = Math.abs(
    points.reduce(
      (minimum, point) => Math.min(minimum, point.drawdownPercent),
      0,
    ),
  );
  const totalReturnPercent = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;
  const returnOverMaxDrawdown =
    maxDrawdownPercent === 0 ? totalReturnPercent : totalReturnPercent / Math.abs(maxDrawdownPercent);

  return {
    netPnl,
    totalReturnPercent,
    maxDrawdownPercent,
    tradeCount: trades.length,
    winRatePercent: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor,
    sharpeRatio: calculateSharpe(points),
    returnOverMaxDrawdown,
  };
}

function resolveExecutionMode(study: StudyDefinition): "spot" | "options" {
  return study.parameters["executionMode"] === "options" ? "options" : "spot";
}

function buildOptionDatasetRole(symbol: string, entryAt: Date): string {
  return `option:${symbol.toUpperCase().slice(0, 8)}:${entryAt.getTime()}`;
}

function findBarIndexAtOrAfter(bars: BacktestBar[], timestampMs: number): number | null {
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index]!.startsAt.getTime() >= timestampMs) {
      return index;
    }
  }

  return null;
}

function findBarIndexAtOrBefore(bars: BacktestBar[], timestampMs: number): number | null {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index]!.startsAt.getTime() <= timestampMs) {
      return index;
    }
  }

  return null;
}

function closeOptionTrade(
  position: OptionPositionState,
  exitBar: BacktestBar,
  exitPrice: number,
  exitReason: string,
  commissionPaid: number,
): SimulatedOptionTrade {
  const exitValue = exitPrice * position.quantity * position.contract.multiplier;
  const grossPnl = exitValue - position.entryValue;
  const netPnl = grossPnl - position.entryCommissionPaid - commissionPaid;
  const barsHeld = Math.max(
    (findBarIndexAtOrBefore(position.bars, exitBar.startsAt.getTime()) ?? 0) -
      (findBarIndexAtOrBefore(position.bars, position.entryAt.getTime()) ?? 0),
    1,
  );

  return {
    symbol: position.symbol,
    side: "long",
    entryAt: position.entryAt,
    exitAt: exitBar.startsAt,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    entryValue: position.entryValue,
    exitValue,
    grossPnl,
    netPnl,
    netPnlPercent: position.entryValue > 0 ? (netPnl / position.entryValue) * 100 : 0,
    barsHeld,
    commissionPaid: position.entryCommissionPaid + commissionPaid,
    exitReason,
    dataset: position.dataset,
    bars: position.bars,
    contract: position.contract,
    entryCommissionPaid: position.entryCommissionPaid,
    exitCommissionPaid: commissionPaid,
  };
}

async function resolveOptionContractForSignal(input: {
  underlying: string;
  occurredAt: Date;
  right: "call" | "put";
  spotPrice: number;
  contractPresetId?: string | null;
}): Promise<ResolvedOptionContract | null> {
  const url = new URL(`${API_BASE_URL}/backtests/internal/resolve-option-contract`);
  const payload = await fetchJson<ApiResolvedOptionContractResponse>(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      occurredAt: input.occurredAt.toISOString(),
    }),
  });

  if (!payload.contract) {
    return null;
  }

  return {
    ...payload.contract,
    expirationDate: new Date(payload.contract.expirationDate),
  };
}

function buildOptionPoints(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  trades: SimulatedOptionTrade[],
): BacktestPoint[] {
  const timestamps = [
    ...new Set(
      [
        ...Object.values(barsBySymbol).flatMap((bars) =>
          bars.map((bar) => bar.startsAt.getTime()),
        ),
        ...trades.flatMap((trade) => [
          trade.entryAt.getTime(),
          trade.exitAt.getTime(),
        ]),
      ].sort((left, right) => left - right),
    ),
  ];
  const entriesByTime = new Map<number, SimulatedOptionTrade[]>();
  const exitsByTime = new Map<number, SimulatedOptionTrade[]>();

  trades.forEach((trade) => {
    const entryKey = trade.entryAt.getTime();
    const exitKey = trade.exitAt.getTime();
    entriesByTime.set(entryKey, [...(entriesByTime.get(entryKey) ?? []), trade]);
    exitsByTime.set(exitKey, [...(exitsByTime.get(exitKey) ?? []), trade]);
  });

  const activeTrades = new Map<string, SimulatedOptionTrade>();
  const points: BacktestPoint[] = [];
  let cash = study.portfolioRules.initialCapital;
  let peakEquity = study.portfolioRules.initialCapital;

  timestamps.forEach((timestamp) => {
    const exits = exitsByTime.get(timestamp) ?? [];
    exits.forEach((trade) => {
      cash += trade.exitValue - trade.exitCommissionPaid;
      activeTrades.delete(trade.symbol);
    });

    const entries = entriesByTime.get(timestamp) ?? [];
    entries.forEach((trade) => {
      cash -= trade.entryValue + trade.entryCommissionPaid;
      activeTrades.set(trade.symbol, trade);
    });

    let grossExposure = 0;
    activeTrades.forEach((trade) => {
      const priceIndex =
        findBarIndexAtOrBefore(trade.bars, timestamp) ??
        findBarIndexAtOrBefore(trade.bars, trade.entryAt.getTime());
      const markPrice = priceIndex != null ? trade.bars[priceIndex]?.close : trade.entryPrice;

      if (typeof markPrice === "number" && Number.isFinite(markPrice)) {
        grossExposure += markPrice * trade.quantity * trade.contract.multiplier;
      }
    });

    const equity = cash + grossExposure;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPercent =
      peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;

    points.push({
      occurredAt: new Date(timestamp),
      equity,
      cash,
      grossExposure,
      drawdownPercent,
    });
  });

  return points;
}

async function runOptionsBacktest(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
): Promise<{
  result: PersistedResult;
  datasetBindings: RunDatasetBinding[];
}> {
  const warnings: string[] = [];
  const trades: SimulatedOptionTrade[] = [];
  const datasetBindings: RunDatasetBinding[] = [];
  const positions = new Map<string, OptionPositionState>();
  let cash = study.portfolioRules.initialCapital;

  const signalEvents = Object.entries(barsBySymbol)
    .flatMap(([symbol, bars]) =>
      buildRayReplicaSignalTape(bars, study.parameters).events
        .filter((event) => event.kind === "choch")
        .map((event) => ({
          ...event,
          symbol,
          spotBars: bars,
          spotBar: bars[event.barIndex] ?? null,
        })),
    )
    .sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.symbol.localeCompare(right.symbol),
    );

  for (const event of signalEvents) {
    const spotBar = event.spotBar;
    if (!spotBar) {
      continue;
    }

    const desiredRight = event.direction === "long" ? "call" : "put";
    const existingPosition = positions.get(event.symbol) ?? null;

    if (existingPosition && existingPosition.right !== desiredRight) {
      const exitBarIndex =
        findBarIndexAtOrAfter(existingPosition.bars, event.occurredAt.getTime()) ??
        existingPosition.bars.length - 1;
      const exitBar = existingPosition.bars[exitBarIndex];

      if (!exitBar) {
        warnings.push(
          `${event.symbol}: unable to find option exit bars for ${existingPosition.contract.ticker}. Trade dropped.`,
        );
        positions.delete(event.symbol);
      } else {
        if (exitBar.startsAt.getTime() < event.occurredAt.getTime()) {
          warnings.push(
            `${event.symbol}: exit for ${existingPosition.contract.ticker} fell back to the last available intraday bar.`,
          );
        }

        const exitPrice = applySlippage(
          exitBar.open,
          "sell",
          study.executionProfile.slippageBps,
        );
        const exitValue =
          exitPrice * existingPosition.quantity * existingPosition.contract.multiplier;
        const exitCommissionPaid = computeCommission(
          exitValue,
          study.executionProfile.commissionBps,
        );

        cash += exitValue - exitCommissionPaid;
        trades.push(
          closeOptionTrade(
            existingPosition,
            exitBar,
            exitPrice,
            `${event.direction === "long" ? "bullish" : "bearish"}_choch`,
            exitCommissionPaid,
          ),
        );
        positions.delete(event.symbol);
      }
    }

    if (positions.has(event.symbol)) {
      continue;
    }

    if (positions.size >= study.portfolioRules.maxConcurrentPositions) {
      warnings.push(
        `${event.symbol}: skipped ${desiredRight} entry at ${event.occurredAt.toISOString()} because the portfolio was already at max concurrent positions.`,
      );
      continue;
    }

    const contract = await resolveOptionContractForSignal({
      underlying: event.symbol,
      occurredAt: event.occurredAt,
      right: desiredRight,
      spotPrice: spotBar.close,
      contractPresetId:
        typeof study.parameters["contractPresetId"] === "string"
          ? study.parameters["contractPresetId"]
          : null,
    });

    if (!contract) {
      warnings.push(
        `${event.symbol}: no historical ${desiredRight} contract matched the preset at ${event.occurredAt.toISOString()}.`,
      );
      continue;
    }

    const optionTo = new Date(
      Math.min(study.to.getTime(), contract.expirationDate.getTime()),
    );
    const optionData = await loadDataset({
      symbol: contract.ticker,
      timeframe: study.timeframe,
      from: event.occurredAt,
      to: optionTo,
      preferSeededMinuteDataset: false,
      assetClass: "option",
      providerContractId: contract.providerContractId,
    });
    const entryBarIndex = findBarIndexAtOrAfter(
      optionData.bars,
      event.occurredAt.getTime(),
    );

    if (entryBarIndex == null) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} had no usable intraday bars at or after ${event.occurredAt.toISOString()}; trade skipped.`,
      );
      continue;
    }

    const entryBar = optionData.bars[entryBarIndex];
    if (!entryBar) {
      continue;
    }

    if (entryBar.startsAt.getTime() > event.occurredAt.getTime()) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} filled on the next available intraday bar after the signal.`,
      );
    }

    const entryPrice = applySlippage(
      entryBar.open,
      "buy",
      study.executionProfile.slippageBps,
    );
    const contractCost = entryPrice * contract.multiplier;
    const targetPositionValue =
      study.portfolioRules.initialCapital *
      (study.portfolioRules.positionSizePercent / 100);
    const quantity = Math.floor(targetPositionValue / contractCost);

    if (quantity <= 0) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} premium was too high for the configured position size.`,
      );
      continue;
    }

    const entryValue = entryPrice * quantity * contract.multiplier;
    const entryCommissionPaid = computeCommission(
      entryValue,
      study.executionProfile.commissionBps,
    );
    const totalCost = entryValue + entryCommissionPaid;

    if (cash < totalCost) {
      warnings.push(
        `${event.symbol}: insufficient cash to open ${contract.ticker} at ${entryBar.startsAt.toISOString()}.`,
      );
      continue;
    }

    cash -= totalCost;
    positions.set(event.symbol, {
      symbol: event.symbol,
      right: desiredRight,
      dataset: optionData.dataset,
      bars: optionData.bars,
      contract,
      entryAt: entryBar.startsAt,
      entryPrice,
      quantity,
      entryValue,
      entryCommissionPaid,
    });
  }

  positions.forEach((position, symbol) => {
    const exitBar = position.bars[position.bars.length - 1];

    if (!exitBar) {
      warnings.push(`${symbol}: unable to liquidate ${position.contract.ticker} at run end.`);
      return;
    }

    const exitPrice = applySlippage(
      exitBar.close,
      "sell",
      study.executionProfile.slippageBps,
    );
    const exitValue = exitPrice * position.quantity * position.contract.multiplier;
    const exitCommissionPaid = computeCommission(
      exitValue,
      study.executionProfile.commissionBps,
    );
    cash += exitValue - exitCommissionPaid;
    trades.push(
      closeOptionTrade(
        position,
        exitBar,
        exitPrice,
        "end_of_run",
        exitCommissionPaid,
      ),
    );
  });

  const sortedTrades = trades.sort(
    (left, right) =>
      left.entryAt.getTime() - right.entryAt.getTime() ||
      left.symbol.localeCompare(right.symbol),
  );
  const points = buildOptionPoints(study, barsBySymbol, sortedTrades);

  sortedTrades.forEach((trade) => {
    datasetBindings.push({
      dataset: trade.dataset,
      role: buildOptionDatasetRole(trade.symbol, trade.entryAt),
    });
  });

  const baseTrades = sortedTrades.map(
    ({
      dataset: _dataset,
      bars: _bars,
      contract: _contract,
      entryCommissionPaid: _entryCommissionPaid,
      exitCommissionPaid: _exitCommissionPaid,
      ...trade
    }) => trade,
  );

  return {
    result: {
      metrics: buildMetrics(
        points,
        baseTrades,
        study.portfolioRules.initialCapital,
      ),
      trades: baseTrades,
      points,
      warnings,
    },
    datasetBindings,
  };
}

async function executeStudyRun(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  primaryDatasetBindings: RunDatasetBinding[],
): Promise<{
  result: PersistedResult;
  datasetBindings: RunDatasetBinding[];
}> {
  if (
    resolveExecutionMode(study) === "options" &&
    study.strategyId === "ray_replica_signals"
  ) {
    const optionResult = await runOptionsBacktest(study, barsBySymbol);
    return {
      result: optionResult.result,
      datasetBindings: [...primaryDatasetBindings, ...optionResult.datasetBindings],
    };
  }

  return {
    result: runBacktest(study, barsBySymbol),
    datasetBindings: primaryDatasetBindings,
  };
}

async function clearRunArtifacts(runId: string): Promise<void> {
  await db.delete(backtestRunTradesTable).where(eq(backtestRunTradesTable.runId, runId));
  await db.delete(backtestRunPointsTable).where(eq(backtestRunPointsTable.runId, runId));
  await db.delete(backtestRunDatasetsTable).where(eq(backtestRunDatasetsTable.runId, runId));
}

async function persistRunArtifacts(
  run: RunRow,
  datasetBindings: RunDatasetBinding[],
  result: PersistedResult,
): Promise<void> {
  await clearRunArtifacts(run.id);

  if (result.trades.length > 0) {
    await db.insert(backtestRunTradesTable).values(
      result.trades.map((trade) => ({
        runId: run.id,
        symbol: trade.symbol,
        side: trade.side,
        entryAt: trade.entryAt,
        exitAt: trade.exitAt,
        entryPrice: String(trade.entryPrice),
        exitPrice: String(trade.exitPrice),
        quantity: String(trade.quantity),
        entryValue: String(trade.entryValue),
        exitValue: String(trade.exitValue),
        grossPnl: String(trade.grossPnl),
        netPnl: String(trade.netPnl),
        netPnlPercent: String(trade.netPnlPercent),
        barsHeld: trade.barsHeld,
        commissionPaid: String(trade.commissionPaid),
        exitReason: trade.exitReason,
      })),
    );
  }

  if (result.points.length > 0) {
    const pointChunkSize = 1000;
    for (let index = 0; index < result.points.length; index += pointChunkSize) {
      const chunk = result.points.slice(index, index + pointChunkSize);
      await db.insert(backtestRunPointsTable).values(
        chunk.map((point) => ({
          runId: run.id,
          occurredAt: point.occurredAt,
          equity: String(point.equity),
          cash: String(point.cash),
          grossExposure: String(point.grossExposure),
          drawdownPercent: String(point.drawdownPercent),
        })),
      );
    }
  }

  await pinDatasetsToRun(run.id, datasetBindings);

  await db
    .update(backtestRunsTable)
    .set({
      status: "completed",
      metrics: result.metrics,
      warnings: result.warnings,
      errorMessage: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestRunsTable.id, run.id));
}

async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  await db
    .update(backtestRunsTable)
    .set({
      status: "failed",
      errorMessage,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestRunsTable.id, runId));
}

async function heartbeat(jobId: string, progressPercent: number): Promise<void> {
  await db
    .update(backtestStudyJobsTable)
    .set({
      lastHeartbeatAt: new Date(),
      progressPercent,
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId));
}

async function markJobFailed(jobId: string, error: Error): Promise<void> {
  await db
    .update(backtestStudyJobsTable)
    .set({
      status: "failed",
      errorMessage: error.message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId));
}

async function markJobCompleted(jobId: string): Promise<void> {
  await db
    .update(backtestStudyJobsTable)
    .set({
      status: "completed",
      progressPercent: 100,
      finishedAt: new Date(),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId));
}

async function getFreshJob(jobId: string): Promise<JobRow | null> {
  const [job] = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.id, jobId))
    .limit(1);

  return job ?? null;
}

async function shouldCancel(jobId: string): Promise<boolean> {
  const job = await getFreshJob(jobId);
  return job?.status === "cancel_requested";
}

async function markSweepStatus(
  sweepId: string,
  status: "running" | "completed" | "failed" | "canceled",
  updates: Partial<SweepRow> = {},
): Promise<void> {
  await db
    .update(backtestSweepsTable)
    .set({
      status,
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(backtestSweepsTable.id, sweepId));
}

async function processSingleRun(job: JobRow): Promise<void> {
  if (!job.runId) {
    throw new Error(`Job ${job.id} has no runId.`);
  }

  const [run, study] = await Promise.all([
    db
      .select()
      .from(backtestRunsTable)
      .where(eq(backtestRunsTable.id, job.runId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(backtestStudiesTable)
      .where(eq(backtestStudiesTable.id, job.studyId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!run || !study) {
    throw new Error(`Job ${job.id} references missing study or run.`);
  }

  await db
    .update(backtestRunsTable)
    .set({ status: "preparing_data", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(backtestRunsTable.id, run.id));

  await heartbeat(job.id, 10);
  const { barsBySymbol, datasets } = await loadStudyData(study);

  if (await shouldCancel(job.id)) {
    await db
      .update(backtestRunsTable)
      .set({ status: "canceled", finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(backtestRunsTable.id, run.id));
    return;
  }

  await db
    .update(backtestRunsTable)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(backtestRunsTable.id, run.id));

  await heartbeat(job.id, 40);
  const primaryDatasetBindings = datasets.map((dataset) => ({
    dataset,
    role: "primary",
  }));
  const execution = await executeStudyRun(
    buildStudyDefinition(study, run.parameters),
    barsBySymbol,
    primaryDatasetBindings,
  );
  await db
    .update(backtestRunsTable)
    .set({ status: "aggregating", updatedAt: new Date() })
    .where(eq(backtestRunsTable.id, run.id));

  await heartbeat(job.id, 80);
  await persistRunArtifacts(run, execution.datasetBindings, execution.result);
}

function sliceBarsByWindow(
  barsBySymbol: Record<string, BacktestBar[]>,
  from: Date,
  to: Date,
): Record<string, BacktestBar[]> {
  return Object.fromEntries(
    Object.entries(barsBySymbol).map(([symbol, bars]) => [
      symbol,
      bars.filter((bar) => bar.startsAt >= from && bar.startsAt <= to),
    ]),
  );
}

function mergeWindowMetrics(results: PersistedResult[]): BacktestMetrics {
  return results.reduce<BacktestMetrics>(
    (aggregate, result, index) => ({
      netPnl: aggregate.netPnl + result.metrics.netPnl,
      totalReturnPercent:
        aggregate.totalReturnPercent +
        result.metrics.totalReturnPercent / results.length,
      maxDrawdownPercent:
        index === 0
          ? result.metrics.maxDrawdownPercent
          : Math.min(aggregate.maxDrawdownPercent, result.metrics.maxDrawdownPercent),
      tradeCount: aggregate.tradeCount + result.metrics.tradeCount,
      winRatePercent:
        aggregate.winRatePercent + result.metrics.winRatePercent / results.length,
      profitFactor:
        aggregate.profitFactor + result.metrics.profitFactor / results.length,
      sharpeRatio:
        aggregate.sharpeRatio + result.metrics.sharpeRatio / results.length,
      returnOverMaxDrawdown:
        aggregate.returnOverMaxDrawdown +
        result.metrics.returnOverMaxDrawdown / results.length,
    }),
    {
      netPnl: 0,
      totalReturnPercent: 0,
      maxDrawdownPercent: 0,
      tradeCount: 0,
      winRatePercent: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      returnOverMaxDrawdown: 0,
    },
  );
}

async function processSweep(job: JobRow): Promise<void> {
  if (!job.sweepId) {
    throw new Error(`Job ${job.id} has no sweepId.`);
  }

  const [study, sweep] = await Promise.all([
    db
      .select()
      .from(backtestStudiesTable)
      .where(eq(backtestStudiesTable.id, job.studyId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(backtestSweepsTable)
      .where(eq(backtestSweepsTable.id, job.sweepId!))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!study || !sweep) {
    throw new Error(`Job ${job.id} references missing study or sweep.`);
  }

  await markSweepStatus(sweep.id, "running", { startedAt: new Date() });
  await heartbeat(job.id, 10);

  const payload = (job.payload ?? {}) as {
    mode?: "grid" | "random" | "walk_forward";
    baseParameters?: Record<string, unknown>;
    dimensions?: Array<{ key: string; values: unknown[] }>;
    randomCandidateBudget?: number;
    walkForwardTrainingMonths?: number;
    walkForwardTestMonths?: number;
    walkForwardStepMonths?: number;
  };

  const baseParameters = {
    ...(study.parameters ?? {}),
    ...(payload.baseParameters ?? {}),
  } as Record<string, string | number | boolean>;
  const dimensions =
    payload.dimensions?.map((dimension) => ({
      key: dimension.key,
      values: dimension.values.filter(
        (value): value is string | number | boolean =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      ),
    })) ?? [];
  const candidateParameters = buildCandidatesForMode(
    payload.mode ?? sweep.mode,
    baseParameters,
    dimensions,
    payload.randomCandidateBudget ?? 100,
  );

  const { barsBySymbol, datasets } = await loadStudyData(study);
  const results: Array<{
    run: RunRow;
    datasetBindings: RunDatasetBinding[];
    result: PersistedResult;
  }> = [];

  const windows =
    sweep.mode === "walk_forward"
      ? buildWalkForwardWindows(
          study.startsAt,
          study.endsAt,
          payload.walkForwardTrainingMonths ?? 24,
          payload.walkForwardTestMonths ?? 6,
          payload.walkForwardStepMonths ?? 6,
        )
      : [];

  let effectiveCandidates = candidateParameters;

  if (
    sweep.mode === "walk_forward" &&
    windows.length > 0 &&
    resolveExecutionMode(buildStudyDefinition(study, baseParameters)) !== "options"
  ) {
    const firstTrainingWindow = windows[0]!;
    const trainingBars = sliceBarsByWindow(
      barsBySymbol,
      firstTrainingWindow.trainingFrom,
      firstTrainingWindow.trainingTo,
    );
    const trainingResults = rankCandidateResults(
      candidateParameters.map((parameters) => ({
        parameters,
        result: runBacktest(
          {
            ...buildStudyDefinition(study),
            from: firstTrainingWindow.trainingFrom,
            to: firstTrainingWindow.trainingTo,
            parameters,
          },
          trainingBars,
        ),
      })),
    );
    effectiveCandidates = trainingResults.slice(0, 20).map((candidate) => candidate.parameters);
  }

  for (let index = 0; index < effectiveCandidates.length; index += MAX_PARALLEL_SWEEP_RUNS) {
    if (await shouldCancel(job.id)) {
      await markSweepStatus(sweep.id, "canceled", { finishedAt: new Date() });
      return;
    }

    const batch = effectiveCandidates.slice(index, index + MAX_PARALLEL_SWEEP_RUNS);

    const batchRunValues: Array<typeof backtestRunsTable.$inferInsert> = batch.map(
      (parameters, batchIndex) => ({
        studyId: study.id,
        sweepId: sweep.id,
        name: `${study.name} Candidate ${index + batchIndex + 1}`,
        strategyId: study.strategyId,
        strategyVersion: study.strategyVersion,
        directionMode: study.directionMode,
        status: "running",
        symbolUniverse: study.symbols,
        parameters,
        portfolioRules: study.portfolioRules,
        executionProfile: study.executionProfile,
        startedAt: new Date(),
      }),
    );

    const batchRuns = await db
      .insert(backtestRunsTable)
      .values(batchRunValues)
      .returning();

    const batchResults = await Promise.all(
      batchRuns.map(async (run) => {
        const parameters = run.parameters as Record<string, string | number | boolean>;
        const studyDefinition = buildStudyDefinition(study, parameters);
        const primaryDatasetBindings = datasets.map((dataset) => ({
          dataset,
          role: "primary",
        }));

        if (sweep.mode === "walk_forward" && windows.length > 0) {
          const windowResults = await Promise.all(
            windows.map(async (window) =>
              (
                await executeStudyRun(
                  {
                    ...studyDefinition,
                    from: window.testFrom,
                    to: window.testTo,
                    parameters,
                  },
                  sliceBarsByWindow(barsBySymbol, window.testFrom, window.testTo),
                  primaryDatasetBindings,
                )
              ).result,
            ),
          );

          return {
            run,
            datasetBindings: primaryDatasetBindings,
            result: {
              metrics: mergeWindowMetrics(windowResults),
              trades: windowResults[0]?.trades ?? [],
              points: windowResults[0]?.points ?? [],
              warnings: windowResults.flatMap((windowResult) => windowResult.warnings),
            },
          };
        }

        const execution = await executeStudyRun(
          studyDefinition,
          barsBySymbol,
          primaryDatasetBindings,
        );

        return {
          run,
          datasetBindings: execution.datasetBindings,
          result: execution.result,
        };
      }),
    );

    for (const batchResult of batchResults) {
      await persistRunArtifacts(
        batchResult.run,
        batchResult.datasetBindings,
        batchResult.result,
      );
      results.push(batchResult);
    }

    const completedCount = Math.min(index + batch.length, effectiveCandidates.length);
    await db
      .update(backtestSweepsTable)
      .set({
        candidateCompletedCount: completedCount,
        updatedAt: new Date(),
      })
      .where(eq(backtestSweepsTable.id, sweep.id));

    await heartbeat(
      job.id,
      Math.round((completedCount / Math.max(effectiveCandidates.length, 1)) * 100),
    );
  }

  const ranked = rankCandidateResults(
    results.map(({ run, result }) => ({
      parameters: run.parameters as Record<string, string | number | boolean>,
      result,
    })),
  );

  const runByMetricKey = new Map(
    results.map(({ run, result }) => [
      JSON.stringify(run.parameters),
      { run, result },
    ]),
  );

  for (const [rank, candidate] of ranked.entries()) {
    const matched = runByMetricKey.get(JSON.stringify(candidate.parameters));
    if (!matched) {
      continue;
    }

    await db
      .update(backtestRunsTable)
      .set({
        sortRank: rank + 1,
        updatedAt: new Date(),
      })
      .where(eq(backtestRunsTable.id, matched.run.id));
  }

  const winningCandidate = ranked[0];
  const winningRun = winningCandidate
    ? runByMetricKey.get(JSON.stringify(winningCandidate.parameters))?.run ?? null
    : null;

  await markSweepStatus(sweep.id, "completed", {
    bestRunId: winningRun?.id ?? null,
    finishedAt: new Date(),
    rankingSummary: {
      bestRunId: winningRun?.id ?? null,
      candidateCount: ranked.length,
    },
  });
}

async function recoverStaleJobs(): Promise<void> {
  const staleThreshold = new Date(Date.now() - JOB_STALE_AFTER_MS);
  const jobs = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(
      and(
        inArray(backtestStudyJobsTable.status, [
          "preparing_data",
          "running",
          "aggregating",
        ]),
        lte(backtestStudyJobsTable.lastHeartbeatAt, staleThreshold),
      ),
    );

  for (const job of jobs) {
    if (job.attemptCount < MAX_JOB_ATTEMPTS) {
      await db
        .update(backtestStudyJobsTable)
        .set({
          status: "queued",
          errorMessage: "Recovered stale job for retry.",
          updatedAt: new Date(),
        })
        .where(eq(backtestStudyJobsTable.id, job.id));
      continue;
    }

    await db
      .update(backtestStudyJobsTable)
      .set({
        status: "failed",
        errorMessage: "Job became stale too many times.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(backtestStudyJobsTable.id, job.id));
  }

  const canceledQueuedJobs = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.status, "cancel_requested"));

  for (const job of canceledQueuedJobs) {
    if (job.startedAt) {
      continue;
    }

    await db
      .update(backtestStudyJobsTable)
      .set({
        status: "canceled",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(backtestStudyJobsTable.id, job.id));
  }
}

async function claimNextJob(): Promise<JobRow | null> {
  const [job] = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.status, "queued"))
    .orderBy(asc(backtestStudyJobsTable.createdAt))
    .limit(1);

  if (!job) {
    return null;
  }

  const [claimed] = await db
    .update(backtestStudyJobsTable)
    .set({
      status: "preparing_data",
      startedAt: job.startedAt ?? new Date(),
      lastHeartbeatAt: new Date(),
      attemptCount: job.attemptCount + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backtestStudyJobsTable.id, job.id),
        eq(backtestStudyJobsTable.status, "queued"),
      ),
    )
    .returning();

  return claimed ?? null;
}

async function processJob(job: JobRow): Promise<void> {
  try {
    if (job.kind === "single_run") {
      await processSingleRun(job);
    } else if (job.kind === "sweep") {
      await processSweep(job);
    } else {
      throw new Error(`Unsupported job kind: ${job.kind}`);
    }

    const freshJob = await getFreshJob(job.id);
    if (freshJob?.status === "cancel_requested") {
      await db
        .update(backtestStudyJobsTable)
        .set({
          status: "canceled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backtestStudyJobsTable.id, job.id));
      return;
    }

    await markJobCompleted(job.id);
  } catch (error) {
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));
    logger.error({ err: resolvedError, jobId: job.id }, "Backtest job failed");

    if (job.runId) {
      await markRunFailed(job.runId, resolvedError.message);
    }

    if (job.sweepId) {
      await markSweepStatus(job.sweepId, "failed", {
        finishedAt: new Date(),
      });
    }

    await markJobFailed(job.id, resolvedError);
  }
}

async function seedBenchmarks(): Promise<void> {
  const now = new Date();
  const from = new Date(now.getTime());
  from.setUTCFullYear(from.getUTCFullYear() - 10);

  for (const symbol of benchmarkSymbols) {
    const existing = await findCoveringDataset(symbol, "1m", from, now);
    if (existing) {
      logger.info({ symbol, datasetId: existing.id }, "Benchmark dataset already seeded");
      continue;
    }

    logger.info({ symbol }, "Seeding benchmark dataset");
    const bars = await fetchBarsSegmented({
      symbol,
      timeframe: "1m",
      from,
      to: now,
      assetClass: "equity",
    });
    await persistDataset(symbol, "1m", from, now, bars, true);
    logger.info({ symbol, barCount: bars.length }, "Benchmark dataset seeded");
  }
}

async function runWorkerLoop(): Promise<void> {
  logger.info({ apiBaseUrl: API_BASE_URL }, "Backtest worker started");

  while (true) {
    try {
      await recoverStaleJobs();
      const job = await claimNextJob();
      if (job) {
        logger.info({ jobId: job.id, kind: job.kind }, "Claimed backtest job");
        await processJob(job);
      } else {
        await wait(WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        "Backtest worker loop failed",
      );
      await wait(WORKER_POLL_INTERVAL_MS);
    }
  }
}

const command = process.argv[2];

if (command === "seed-benchmarks") {
  seedBenchmarks()
    .then(() => {
      logger.info("Benchmark seed complete");
      process.exit(0);
    })
    .catch((error) => {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        "Benchmark seed failed",
      );
      process.exit(1);
    });
} else {
  runWorkerLoop().catch((error) => {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)) },
      "Backtest worker crashed",
    );
    process.exit(1);
  });
}
