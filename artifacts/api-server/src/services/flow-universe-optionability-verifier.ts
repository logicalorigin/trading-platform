import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { runInDbLane } from "@workspace/db";
import {
  flowUniverseRankingsTable,
  universeCatalogListingsTable,
  universeSourceMembershipsTable,
} from "@workspace/db/schema";
import { normalizeSymbol } from "../lib/values";

export type FlowUniverseOptionabilityStatus = "verified" | "rejected";
export type FlowUniverseOptionabilityProbeStatus =
  | FlowUniverseOptionabilityStatus
  | "error";

export type FlowUniverseOptionabilityCandidate = {
  symbol: string;
  market: string;
  listingKey: string;
};

export type FlowUniverseOptionabilityProbeDebug = {
  degraded?: boolean;
  stale?: boolean;
  reason?: string | null;
  backoffRemainingMs?: number | null;
};

export type FlowUniverseOptionabilityProbeResult = {
  expirations: readonly unknown[];
  debug?: FlowUniverseOptionabilityProbeDebug | null;
};

export type FlowUniverseOptionabilityClassification = {
  status: FlowUniverseOptionabilityProbeStatus;
  reason: string | null;
};

export type FlowUniverseOptionabilityFetchExpirations = (input: {
  underlying: string;
  maxExpirations?: number;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
}) => Promise<FlowUniverseOptionabilityProbeResult>;

export type FlowUniverseOptionabilityRunSummary = {
  trigger: string;
  startedAt: Date;
  completedAt: Date;
  attempted: number;
  verified: number;
  rejected: number;
  errors: number;
  skipped: number;
  skippedReason: string | null;
  candidates: number;
  sample: FlowUniverseOptionabilityRunResult[];
};

export type FlowUniverseOptionabilityRunResult = {
  symbol: string;
  status: FlowUniverseOptionabilityProbeStatus | "skipped";
  reason: string | null;
};

export type FlowUniverseOptionabilityVerifierDiagnostics = {
  enabled: boolean;
  started: boolean;
  running: boolean;
  intervalMs: number;
  batchSize: number;
  delayMs: number;
  backoffMs: number;
  maxConsecutiveErrors: number;
  force: boolean;
  lastRunAt: Date | null;
  lastCompletedAt: Date | null;
  lastSkippedReason: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  backoffUntil: Date | null;
  lastSummary: FlowUniverseOptionabilityRunSummary | null;
  totals: {
    attempted: number;
    verified: number;
    rejected: number;
    errors: number;
    skipped: number;
  };
};

type FlowUniverseOptionabilityDb = {
  select: typeof import("@workspace/db").db.select;
  update: typeof import("@workspace/db").db.update;
  insert: typeof import("@workspace/db").db.insert;
  transaction: typeof import("@workspace/db").db.transaction;
};

type LoadCandidatesInput = {
  limit: number;
  markets: readonly string[];
  prioritySymbols?: readonly string[];
  force?: boolean;
};

type MarkOptionabilityInput = FlowUniverseOptionabilityCandidate & {
  status: FlowUniverseOptionabilityStatus;
  reason: string | null;
  verifiedAt: Date;
  source?: string;
};

type FlowUniverseOptionabilityVerifierOptions = {
  db?: FlowUniverseOptionabilityDb;
  enabled?: boolean;
  intervalMs?: number;
  initialDelayMs?: number;
  batchSize?: number;
  delayMs?: number;
  backoffMs?: number;
  maxConsecutiveErrors?: number;
  markets?: readonly string[];
  force?: boolean;
  source?: string;
  now?: () => Date;
  shouldRun?: () => Promise<string | null> | string | null;
  prioritySymbols?: () => readonly string[];
  fetchExpirations: FlowUniverseOptionabilityFetchExpirations;
  loadCandidates?: (
    input: LoadCandidatesInput,
  ) => Promise<FlowUniverseOptionabilityCandidate[]>;
  markOptionability?: (input: MarkOptionabilityInput) => Promise<void>;
};

const MIN_INTERVAL_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_INITIAL_DELAY_MS = 15_000;
const MAX_BATCH_SIZE = 5;
const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_BACKOFF_MS = 5 * 60_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;
const DEFAULT_MARKETS = ["stocks", "etf"] as const;
const DEFAULT_SOURCE = "background_optionability_verifier";
const TRANSIENT_EMPTY_REASONS = new Set([
  "durable_option_expirations_after_upstream_failure",
  "option_expirations_degraded_empty",
  "options_backoff",
  "options_upstream_failure",
]);

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : fallback;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && (value ?? 0) >= 0
    ? Math.floor(value as number)
    : fallback;
}

function boundedTimerDelay(
  value: number | undefined,
  fallback: number,
  minimum = 0,
): number {
  return Math.min(
    MAX_TIMER_DELAY_MS,
    Math.max(minimum, nonNegativeInteger(value, fallback)),
  );
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

function uniqueSymbols(symbols: readonly string[] = []): string[] {
  return [
    ...new Set(
      symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    ),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

function optionabilityResolvedFilter() {
  return sql`not (
    coalesce(${universeCatalogListingsTable.contractMeta}->>'optionabilityStatus', '') in ('verified', 'rejected')
    or coalesce(${universeCatalogListingsTable.contractMeta}->'optionability'->>'status', '') in ('verified', 'rejected')
    or coalesce(${flowUniverseRankingsTable.metadata}->>'optionabilityStatus', '') in ('verified', 'rejected')
    or coalesce(${flowUniverseRankingsTable.metadata}->'optionability'->>'status', '') in ('verified', 'rejected')
  )`;
}

function baseCandidateFilters(input: {
  markets: readonly string[];
  force?: boolean;
}) {
  const markets = (
    input.markets.length ? input.markets : DEFAULT_MARKETS
  ) as Array<
    "stocks" | "etf" | "indices" | "futures" | "fx" | "crypto" | "otc"
  >;
  return [
    eq(universeCatalogListingsTable.active, true),
    // The expiration probe is Massive-backed and keyed by symbol, so candidacy
    // must not require IBKR contract hydration: with the IBKR bridge offline the
    // hydration gate strands the catalog at 'pending' and optionability never
    // converges (which in turn caps the signal-monitor expansion universe).
    // Flow lane admission applies its own hydrated+conid filters
    // (flow-universe.ts, flow-universe-planner.ts), so relaxing the sweep here
    // cannot admit unhydrated symbols into IBKR-line work.
    inArray(universeCatalogListingsTable.market, markets),
    sql`coalesce(${universeCatalogListingsTable.primaryExchange}, '') <> 'OTC'`,
    input.force ? undefined : optionabilityResolvedFilter(),
  ].filter(Boolean);
}

async function loadCandidateRows(
  db: FlowUniverseOptionabilityDb,
  input: LoadCandidatesInput & { symbols?: readonly string[] },
): Promise<FlowUniverseOptionabilityCandidate[]> {
  const filters = baseCandidateFilters(input);
  const symbolFilter =
    input.symbols && input.symbols.length
      ? inArray(universeCatalogListingsTable.normalizedTicker, [
          ...input.symbols,
        ])
      : undefined;

  const rows = await db
    .select({
      symbol: universeCatalogListingsTable.normalizedTicker,
      market: universeCatalogListingsTable.market,
      listingKey: universeCatalogListingsTable.listingKey,
    })
    .from(universeCatalogListingsTable)
    .leftJoin(
      flowUniverseRankingsTable,
      eq(
        flowUniverseRankingsTable.symbol,
        universeCatalogListingsTable.normalizedTicker,
      ),
    )
    .where(and(...(symbolFilter ? [...filters, symbolFilter] : filters)))
    .orderBy(
      sql`case when exists (
        select 1 from ${universeSourceMembershipsTable}
        where ${universeSourceMembershipsTable.normalizedTicker} = ${universeCatalogListingsTable.normalizedTicker}
          and ${universeSourceMembershipsTable.sourceId} = 'nasdaq_listed'
          and ${universeSourceMembershipsTable.active} = true
      ) then 0 when exists (
        select 1 from ${universeSourceMembershipsTable}
        where ${universeSourceMembershipsTable.normalizedTicker} = ${universeCatalogListingsTable.normalizedTicker}
          and ${universeSourceMembershipsTable.sourceId} = 'other_listed'
          and ${universeSourceMembershipsTable.active} = true
      ) then 1 else 2 end`,
      asc(universeCatalogListingsTable.normalizedTicker),
    )
    .limit(input.limit);

  return rows
    .map((row) => ({
      symbol: normalizeSymbol(row.symbol),
      market: row.market,
      listingKey: row.listingKey,
    }))
    .filter((row) => Boolean(row.symbol && row.listingKey));
}

export async function loadFlowUniverseOptionabilityCandidates(input: {
  db: FlowUniverseOptionabilityDb;
  limit: number;
  markets?: readonly string[];
  prioritySymbols?: readonly string[];
  force?: boolean;
}): Promise<FlowUniverseOptionabilityCandidate[]> {
  const limit = Math.max(0, Math.floor(input.limit || 0));
  if (limit <= 0) {
    return [];
  }

  const markets = input.markets?.length ? input.markets : DEFAULT_MARKETS;
  const prioritySymbols = uniqueSymbols(input.prioritySymbols);
  const candidates: FlowUniverseOptionabilityCandidate[] = [];
  const seen = new Set<string>();
  const append = (rows: readonly FlowUniverseOptionabilityCandidate[]) => {
    for (const row of rows) {
      const symbol = normalizeSymbol(row.symbol);
      if (!symbol || seen.has(symbol) || candidates.length >= limit) continue;
      seen.add(symbol);
      candidates.push({ ...row, symbol });
    }
  };

  if (prioritySymbols.length) {
    const priorityOrder = new Map(
      prioritySymbols.map((symbol, index) => [symbol, index]),
    );
    const priorityRows = await loadCandidateRows(input.db, {
      limit,
      markets,
      prioritySymbols,
      force: input.force,
      symbols: prioritySymbols,
    });
    append(
      priorityRows.sort(
        (left, right) =>
          (priorityOrder.get(left.symbol) ?? Number.MAX_SAFE_INTEGER) -
            (priorityOrder.get(right.symbol) ?? Number.MAX_SAFE_INTEGER) ||
          left.symbol.localeCompare(right.symbol),
      ),
    );
  }

  if (candidates.length < limit) {
    append(
      await loadCandidateRows(input.db, {
        limit: limit * 4,
        markets,
        prioritySymbols,
        force: input.force,
      }),
    );
  }

  return candidates.slice(0, limit);
}

export async function markFlowUniverseOptionability(
  input: MarkOptionabilityInput & { db: FlowUniverseOptionabilityDb },
): Promise<void> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return;
  }
  const source = input.source?.trim() || DEFAULT_SOURCE;
  const optionability = {
    optionabilityStatus: input.status,
    optionability: {
      status: input.status,
      source,
      reason: input.reason,
      verifiedAt: input.verifiedAt.toISOString(),
    },
  };

  await input.db.transaction(async (tx) => {
    await tx
      .update(universeCatalogListingsTable)
      .set({
        contractMeta: sql`coalesce(${universeCatalogListingsTable.contractMeta}, '{}'::jsonb) || ${JSON.stringify(optionability)}::jsonb`,
        updatedAt: input.verifiedAt,
      })
      .where(eq(universeCatalogListingsTable.listingKey, input.listingKey));

    await tx
      .insert(flowUniverseRankingsTable)
      .values({
        symbol,
        market: input.market,
        source: "massive",
        eligible: input.status === "verified",
        reason: input.reason,
        metadata: optionability,
        updatedAt: input.verifiedAt,
      })
      .onConflictDoUpdate({
        target: flowUniverseRankingsTable.symbol,
        set: {
          eligible: input.status === "verified",
          reason: input.reason,
          source: "massive",
          metadata: sql`coalesce(${flowUniverseRankingsTable.metadata}, '{}'::jsonb) || ${JSON.stringify(optionability)}::jsonb`,
          updatedAt: input.verifiedAt,
        },
      });
  });
}

export function classifyFlowUniverseOptionabilityProbeResult(
  result: FlowUniverseOptionabilityProbeResult,
): FlowUniverseOptionabilityClassification {
  if (result.expirations.length > 0) {
    return { status: "verified", reason: null };
  }

  const debug = result.debug ?? null;
  const reason =
    typeof debug?.reason === "string" && debug.reason.trim()
      ? debug.reason.trim()
      : null;
  if (
    debug?.stale ||
    TRANSIENT_EMPTY_REASONS.has(reason ?? "") ||
    (debug?.degraded && reason !== "option_expirations_successful_empty")
  ) {
    return {
      status: "error",
      reason: reason ?? "degraded_option_expirations",
    };
  }

  return { status: "rejected", reason: "no_option_expirations" };
}

export function createFlowUniverseOptionabilityVerifier(
  options: FlowUniverseOptionabilityVerifierOptions,
) {
  const now = options.now ?? (() => new Date());
  let runtimeOptions = {
    enabled: options.enabled ?? true,
    intervalMs: boundedTimerDelay(
      options.intervalMs,
      MIN_INTERVAL_MS,
      MIN_INTERVAL_MS,
    ),
    initialDelayMs: boundedTimerDelay(
      options.initialDelayMs,
      DEFAULT_INITIAL_DELAY_MS,
    ),
    batchSize: Math.min(
      MAX_BATCH_SIZE,
      positiveInteger(options.batchSize, MAX_BATCH_SIZE),
    ),
    delayMs: boundedTimerDelay(options.delayMs, DEFAULT_DELAY_MS),
    backoffMs: positiveInteger(options.backoffMs, DEFAULT_BACKOFF_MS),
    maxConsecutiveErrors: positiveInteger(
      options.maxConsecutiveErrors,
      DEFAULT_MAX_CONSECUTIVE_ERRORS,
    ),
    markets: [...(options.markets?.length ? options.markets : DEFAULT_MARKETS)],
    force: options.force ?? false,
    source: options.source?.trim() || DEFAULT_SOURCE,
  };

  let started = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let lastRunAt: Date | null = null;
  let lastCompletedAt: Date | null = null;
  let lastSkippedReason: string | null = null;
  let lastError: string | null = null;
  let consecutiveErrors = 0;
  let backoffUntil: Date | null = null;
  let lastSummary: FlowUniverseOptionabilityRunSummary | null = null;
  const totals = {
    attempted: 0,
    verified: 0,
    rejected: 0,
    errors: 0,
    skipped: 0,
  };

  const loadCandidates =
    options.loadCandidates ??
    ((input: LoadCandidatesInput) => {
      if (!options.db) {
        throw new Error(
          "Flow universe optionability verifier DB is not configured.",
        );
      }
      return loadFlowUniverseOptionabilityCandidates({
        db: options.db,
        ...input,
      });
    });
  const markOptionability =
    options.markOptionability ??
    ((input: MarkOptionabilityInput) => {
      if (!options.db) {
        throw new Error(
          "Flow universe optionability verifier DB is not configured.",
        );
      }
      return markFlowUniverseOptionability({
        db: options.db,
        ...input,
      });
    });

  function schedule(delayMs: number): void {
    if (!started || timer) {
      return;
    }
    timer = setTimeout(
      () => {
        timer = null;
        void runOnce("timer").finally(() => {
          schedule(runtimeOptions.intervalMs);
        });
      },
      Math.max(0, delayMs),
    );
    timer.unref?.();
  }

  function recordSkip(
    trigger: string,
    startedAt: Date,
    skippedReason: string,
  ): FlowUniverseOptionabilityRunSummary {
    const completedAt = now();
    lastSkippedReason = skippedReason;
    totals.skipped += 1;
    const summary = {
      trigger,
      startedAt,
      completedAt,
      attempted: 0,
      verified: 0,
      rejected: 0,
      errors: 0,
      skipped: 1,
      skippedReason,
      candidates: 0,
      sample: [],
    };
    lastCompletedAt = completedAt;
    lastSummary = summary;
    return summary;
  }

  async function resolveBlockReason(): Promise<string | null> {
    if (!runtimeOptions.enabled) {
      return "disabled";
    }
    if (backoffUntil && backoffUntil.getTime() > now().getTime()) {
      return "error-backoff";
    }
    return (await options.shouldRun?.()) ?? null;
  }

  async function runOnceInLane(
    trigger = "manual",
  ): Promise<FlowUniverseOptionabilityRunSummary> {
    const startedAt = now();
    lastRunAt = startedAt;
    if (running) {
      return recordSkip(trigger, startedAt, "already-running");
    }

    const initialBlockReason = await resolveBlockReason();
    if (initialBlockReason) {
      return recordSkip(trigger, startedAt, initialBlockReason);
    }

    running = true;
    lastSkippedReason = null;
    const results: FlowUniverseOptionabilityRunResult[] = [];
    let candidates: FlowUniverseOptionabilityCandidate[] = [];
    let attempted = 0;
    let verified = 0;
    let rejected = 0;
    let errors = 0;
    let skippedReason: string | null = null;

    try {
      candidates = await loadCandidates({
        limit: runtimeOptions.batchSize,
        markets: runtimeOptions.markets,
        prioritySymbols: options.prioritySymbols?.() ?? [],
        force: runtimeOptions.force,
      });
      if (!candidates.length) {
        consecutiveErrors = 0;
        return recordSkip(trigger, startedAt, "no-candidates");
      }

      for (const candidate of candidates.slice(0, runtimeOptions.batchSize)) {
        const perCandidateBlockReason = await resolveBlockReason();
        if (perCandidateBlockReason) {
          skippedReason = perCandidateBlockReason;
          results.push({
            symbol: candidate.symbol,
            status: "skipped",
            reason: perCandidateBlockReason,
          });
          break;
        }

        attempted += 1;
        try {
          const probe = await options.fetchExpirations({
            underlying: candidate.symbol,
            maxExpirations: 1,
            recordBridgeFailure: false,
          });
          const classification =
            classifyFlowUniverseOptionabilityProbeResult(probe);
          if (classification.status === "verified") {
            await markOptionability({
              ...candidate,
              status: "verified",
              reason: null,
              verifiedAt: now(),
              source: runtimeOptions.source,
            });
            verified += 1;
            results.push({
              symbol: candidate.symbol,
              status: "verified",
              reason: null,
            });
          } else if (classification.status === "rejected") {
            await markOptionability({
              ...candidate,
              status: "rejected",
              reason: classification.reason,
              verifiedAt: now(),
              source: runtimeOptions.source,
            });
            rejected += 1;
            results.push({
              symbol: candidate.symbol,
              status: "rejected",
              reason: classification.reason,
            });
          } else {
            errors += 1;
            results.push({
              symbol: candidate.symbol,
              status: "error",
              reason: classification.reason,
            });
          }
        } catch (error) {
          errors += 1;
          const reason = errorMessage(error);
          results.push({
            symbol: candidate.symbol,
            status: "error",
            reason,
          });
          lastError = reason;
        }

        if (runtimeOptions.delayMs > 0) {
          await wait(runtimeOptions.delayMs);
        }
      }

      totals.attempted += attempted;
      totals.verified += verified;
      totals.rejected += rejected;
      totals.errors += errors;

      if (
        attempted > 0 &&
        errors >= attempted &&
        verified === 0 &&
        rejected === 0
      ) {
        consecutiveErrors += 1;
      } else {
        consecutiveErrors = 0;
        if (errors === 0) {
          lastError = null;
        }
      }
      if (consecutiveErrors >= runtimeOptions.maxConsecutiveErrors) {
        backoffUntil = new Date(now().getTime() + runtimeOptions.backoffMs);
      }

      const completedAt = now();
      const summary: FlowUniverseOptionabilityRunSummary = {
        trigger,
        startedAt,
        completedAt,
        attempted,
        verified,
        rejected,
        errors,
        skipped: skippedReason ? 1 : 0,
        skippedReason,
        candidates: candidates.length,
        sample: results.slice(0, 20),
      };
      if (skippedReason) {
        lastSkippedReason = skippedReason;
        totals.skipped += 1;
      }
      lastCompletedAt = completedAt;
      lastSummary = summary;
      return summary;
    } catch (error) {
      errors += 1;
      totals.errors += 1;
      consecutiveErrors += 1;
      lastError = errorMessage(error);
      if (consecutiveErrors >= runtimeOptions.maxConsecutiveErrors) {
        backoffUntil = new Date(now().getTime() + runtimeOptions.backoffMs);
      }
      const completedAt = now();
      const summary: FlowUniverseOptionabilityRunSummary = {
        trigger,
        startedAt,
        completedAt,
        attempted,
        verified,
        rejected,
        errors,
        skipped: 0,
        skippedReason: null,
        candidates: candidates.length,
        sample: results.slice(0, 20),
      };
      lastCompletedAt = completedAt;
      lastSummary = summary;
      return summary;
    } finally {
      running = false;
    }
  }

  function runOnce(
    trigger = "manual",
  ): Promise<FlowUniverseOptionabilityRunSummary> {
    return runInDbLane(
      "background",
      async () => await runOnceInLane(trigger),
    );
  }

  function start(): void {
    if (started || !runtimeOptions.enabled) {
      return;
    }
    started = true;
    schedule(runtimeOptions.initialDelayMs);
  }

  function stop(): void {
    started = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function updateConfig(
    input: Partial<
      Pick<
        FlowUniverseOptionabilityVerifierOptions,
        | "enabled"
        | "intervalMs"
        | "initialDelayMs"
        | "batchSize"
        | "delayMs"
        | "backoffMs"
        | "maxConsecutiveErrors"
        | "markets"
        | "force"
        | "source"
      >
    >,
  ): void {
    runtimeOptions = {
      ...runtimeOptions,
      enabled: input.enabled ?? runtimeOptions.enabled,
      intervalMs: boundedTimerDelay(
        input.intervalMs,
        runtimeOptions.intervalMs,
        MIN_INTERVAL_MS,
      ),
      initialDelayMs: boundedTimerDelay(
        input.initialDelayMs,
        runtimeOptions.initialDelayMs,
      ),
      batchSize: Math.min(
        MAX_BATCH_SIZE,
        positiveInteger(input.batchSize, runtimeOptions.batchSize),
      ),
      delayMs: boundedTimerDelay(input.delayMs, runtimeOptions.delayMs),
      backoffMs: positiveInteger(input.backoffMs, runtimeOptions.backoffMs),
      maxConsecutiveErrors: positiveInteger(
        input.maxConsecutiveErrors,
        runtimeOptions.maxConsecutiveErrors,
      ),
      markets: input.markets?.length
        ? [...input.markets]
        : runtimeOptions.markets,
      force: input.force ?? runtimeOptions.force,
      source: input.source?.trim() || runtimeOptions.source,
    };
    if (!runtimeOptions.enabled) {
      stop();
    } else if (started && !timer && !running) {
      schedule(runtimeOptions.intervalMs);
    }
  }

  function getDiagnostics(): FlowUniverseOptionabilityVerifierDiagnostics {
    return {
      enabled: runtimeOptions.enabled,
      started,
      running,
      intervalMs: runtimeOptions.intervalMs,
      batchSize: runtimeOptions.batchSize,
      delayMs: runtimeOptions.delayMs,
      backoffMs: runtimeOptions.backoffMs,
      maxConsecutiveErrors: runtimeOptions.maxConsecutiveErrors,
      force: runtimeOptions.force,
      lastRunAt,
      lastCompletedAt,
      lastSkippedReason,
      lastError,
      consecutiveErrors,
      backoffUntil:
        backoffUntil && backoffUntil.getTime() > now().getTime()
          ? backoffUntil
          : null,
      lastSummary,
      totals: { ...totals },
    };
  }

  return {
    start,
    stop,
    runOnce,
    updateConfig,
    getDiagnostics,
  };
}
