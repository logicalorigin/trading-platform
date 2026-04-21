import {
  buildCandidatesForMode,
  buildWalkForwardWindows,
  getStrategyCatalogItem,
  listStrategies,
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
import { normalizeSymbol } from "../lib/values";

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

type PromoteRunInput = {
  runId: string;
  name: string;
  notes: string | null;
};

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

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))];
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
    throw new HttpError(400, "Selected timeframe is not supported by this strategy.", {
      code: "backtest_timeframe_unsupported",
    });
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

function tradeToResponse(trade: BacktestRunTrade) {
  return {
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
  const strategy = getStrategyCatalogItem(input.strategyId, input.strategyVersion);
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

  return {
    run: runSummaryToResponse(run),
    study: studyRecordToResponse(study),
    trades: trades.map(tradeToResponse),
    points: points.map(pointToResponse),
    datasets: datasetRows.map(({ dataset }) => datasetToResponse(dataset)),
  };
}

export async function createBacktestRun(input: CreateRunInput) {
  const study = await getStudyOrThrow(input.studyId);
  const strategy = getStrategyCatalogItem(study.strategyId, study.strategyVersion);
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

export async function createBacktestSweep(input: CreateSweepInput) {
  const study = await getStudyOrThrow(input.studyId);
  const strategy = getStrategyCatalogItem(study.strategyId, study.strategyVersion);
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
    .orderBy(asc(backtestRunsTable.sortRank), desc(backtestRunsTable.createdAt));

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
