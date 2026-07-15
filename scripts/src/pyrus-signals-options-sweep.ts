import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

type JsonRecord = Record<string, unknown>;

export type SweepVariant = {
  id: string;
  stage: "A" | "B" | "MTF";
  pyrusSignalsSettingsPatch: JsonRecord;
  profilePatch?: JsonRecord;
  winnerEligible?: boolean;
};

export type SweepMetrics = {
  realizedPnl: number;
  winRate: number;
  profitFactor: number;
  closedTrades: number;
  maxDrawdownAbs: number;
  openPositions: number;
  riskAdjustedScore: number;
};

export type SweepResult = {
  variant: SweepVariant;
  status: "succeeded" | "failed";
  eligible: boolean;
  ineligibleReason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  window: JsonRecord | null;
  timeframe: string | null;
  metrics: SweepMetrics;
  summary: JsonRecord | null;
  error: string | null;
};

type DeploymentRow = {
  id: string;
  name: string;
  mode: "shadow" | "live";
  symbolUniverse: string[];
};

type RunSignalOptionsShadowBackfill =
  typeof import("../../artifacts/api-server/src/services/signal-options-automation").runSignalOptionsShadowBackfill;

type SweepRuntime = {
  pool: typeof import("@workspace/db").pool;
  closeDatabaseConnections: typeof import("@workspace/db").closeDatabaseConnections;
  sharedAdvisoryLockHolder: typeof import("@workspace/db").sharedAdvisoryLockHolder;
  runSignalOptionsShadowBackfill: RunSignalOptionsShadowBackfill;
  workerLockKey: typeof import("../../artifacts/api-server/src/services/signal-options-worker").SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY;
};

type SweepConfig = {
  start: string;
  end?: string;
  session: string;
  signalTimeframe: string;
  smoke: boolean;
  replayWinner: boolean;
  lockWaitMs: number;
  reportDir: string;
  mtfSweep: boolean;
};

const STAGE_A_TIME_HORIZONS = [4, 6, 8, 10, 12, 16, 20] as const;
const BOS_CONFIRMATIONS = ["close", "wicks"] as const;
const CHOCH_ATR_BUFFERS = [0, 0.25, 0.5] as const;
const BODY_EXPANSIONS = [0, 0.5] as const;
const VOLUME_GATES = [0, 1.0] as const;
const MIN_CLOSED_TRADES = 20;
const MAX_LOCK_WAIT_MS = 30 * 60_000;
const MAX_DIAGNOSTIC_LENGTH = 400;
const USAGE =
  "Usage: pnpm --filter @workspace/scripts run pyrus-signals:signal-options-sweep (configure with PYRUS_SIGNALS_SWEEP_* env vars)";
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const UNSAFE_JSON_OUTPUT_PATTERN =
  /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const DEFAULT_MTF_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h"] as const;
const ALL_MTF_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;

async function loadSweepRuntime(): Promise<SweepRuntime> {
  const database = await import("@workspace/db");
  try {
    const [automation, worker] = await Promise.all([
      import(
        "../../artifacts/api-server/src/services/signal-options-automation"
      ),
      import("../../artifacts/api-server/src/services/signal-options-worker"),
    ]);
    return {
      pool: database.pool,
      closeDatabaseConnections: database.closeDatabaseConnections,
      sharedAdvisoryLockHolder: database.sharedAdvisoryLockHolder,
      runSignalOptionsShadowBackfill: automation.runSignalOptionsShadowBackfill,
      workerLockKey: worker.SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
    };
  } catch (error) {
    try {
      await database.closeDatabaseConnections();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Failed to load sweep runtime and close database resources.",
      );
    }
    throw error;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseSweepArgs(args = process.argv.slice(2)): void {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length > 0) throw new Error(USAGE);
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = stripVTControlCharacters(
    (raw || "Unknown sweep error")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
      .replace(
        /([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/giu,
        "$1?[redacted]",
      ),
  )
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown sweep error";
  return diagnostic.length <= MAX_DIAGNOSTIC_LENGTH
    ? diagnostic
    : `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function nonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function enableHistoricalBarEvaluation(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const primaryName = "PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
  const aliasName = "SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
  if (!nonEmptyEnv(env, primaryName) && !nonEmptyEnv(env, aliasName)) {
    env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] = "1";
    return;
  }
  env[primaryName] = readAliasedBooleanEnv(primaryName, aliasName, false, env)
    ? "1"
    : "0";
}

function readBooleanEnv(
  name: string,
  fallback: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = nonEmptyEnv(env, name)?.toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(
    `${name} must be true or false (also accepts 1/0, yes/no, on/off).`,
  );
}

function readAliasedBooleanEnv(
  name: string,
  alias: string,
  fallback: boolean,
  env: NodeJS.ProcessEnv,
): boolean {
  const primary = nonEmptyEnv(env, name)
    ? readBooleanEnv(name, fallback, env)
    : undefined;
  const legacy = nonEmptyEnv(env, alias)
    ? readBooleanEnv(alias, fallback, env)
    : undefined;
  if (primary !== undefined && legacy !== undefined && primary !== legacy) {
    throw new Error(`Conflicting ${name} and ${alias} values.`);
  }
  return primary ?? legacy ?? fallback;
}

function readIntegerEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = nonEmptyEnv(env, name);
  if (!raw) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readAliasedIntegerEnv(
  name: string,
  alias: string,
  fallback: number,
  env: NodeJS.ProcessEnv,
): number {
  const primary = nonEmptyEnv(env, name)
    ? readIntegerEnv(name, fallback, env)
    : undefined;
  const legacy = nonEmptyEnv(env, alias)
    ? readIntegerEnv(alias, fallback, env)
    : undefined;
  if (primary !== undefined && legacy !== undefined && primary !== legacy) {
    throw new Error(`Conflicting ${name} and ${alias} values.`);
  }
  return primary ?? legacy ?? fallback;
}

function readAliasedTextEnv(
  name: string,
  alias: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const primary = nonEmptyEnv(env, name);
  const legacy = nonEmptyEnv(env, alias);
  if (primary && legacy && primary !== legacy) {
    throw new Error(`Conflicting ${name} and ${alias} values.`);
  }
  return primary ?? legacy;
}

function canonicalDate(
  name: string,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must be a real YYYY-MM-DD date.`);
  }
  return value;
}

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function numberToken(value: number): string {
  return String(value).replace(".", "p");
}

function readSweepConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): SweepConfig {
  const smoke = readBooleanEnv("PYRUS_SIGNALS_SWEEP_SMOKE", false, env);
  const mtfSweep = readAliasedBooleanEnv(
    "PYRUS_SIGNALS_SWEEP_MTF",
    "SIGNAL_OPTIONS_MTF_SWEEP",
    false,
    env,
  );
  const explicitStart = canonicalDate(
    "PYRUS_SIGNALS_SWEEP_START",
    readAliasedTextEnv(
      "PYRUS_SIGNALS_SWEEP_START",
      "SIGNAL_OPTIONS_SWEEP_START",
      env,
    ),
  );
  const explicitEnd = canonicalDate(
    "PYRUS_SIGNALS_SWEEP_END",
    readAliasedTextEnv(
      "PYRUS_SIGNALS_SWEEP_END",
      "SIGNAL_OPTIONS_SWEEP_END",
      env,
    ),
  );
  if (mtfSweep && (!explicitStart || !explicitEnd)) {
    throw new Error(
      "MTF sweeps require PYRUS_SIGNALS_SWEEP_START and PYRUS_SIGNALS_SWEEP_END so the two-day window is explicit.",
    );
  }
  const start = explicitStart ?? (smoke ? "2026-05-04" : "2026-04-01");
  const end = explicitEnd ?? (smoke ? "2026-05-05" : undefined);
  if (end && start > end) {
    throw new Error("Sweep start must be on or before end.");
  }
  const reportRoot =
    nonEmptyEnv(env, "PYRUS_SIGNALS_SWEEP_REPORT_DIR") ??
    path.join("reports", "pyrus-signals-options-sweeps", slug());
  const session = nonEmptyEnv(env, "PYRUS_SIGNALS_SWEEP_SESSION") ?? "regular";
  if (session !== "regular" && session !== "all") {
    throw new Error("PYRUS_SIGNALS_SWEEP_SESSION must be regular or all.");
  }
  const signalTimeframe =
    nonEmptyEnv(env, "PYRUS_SIGNALS_SWEEP_SIGNAL_TIMEFRAME") ?? "5m";
  if (
    !ALL_MTF_TIMEFRAMES.includes(
      signalTimeframe as (typeof ALL_MTF_TIMEFRAMES)[number],
    )
  ) {
    throw new Error(
      `PYRUS_SIGNALS_SWEEP_SIGNAL_TIMEFRAME must be one of ${ALL_MTF_TIMEFRAMES.join(", ")}.`,
    );
  }
  const replayWinner = readAliasedBooleanEnv(
    "PYRUS_SIGNALS_SWEEP_REPLAY_WINNER",
    "SIGNAL_OPTIONS_SWEEP_REPLAY_WINNER",
    !mtfSweep,
    env,
  );
  const lockWaitMs = readAliasedIntegerEnv(
    "PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS",
    "SIGNAL_OPTIONS_SWEEP_LOCK_WAIT_MS",
    0,
    env,
  );
  if (lockWaitMs > MAX_LOCK_WAIT_MS) {
    throw new Error(
      `PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS must be at most ${MAX_LOCK_WAIT_MS}.`,
    );
  }

  return {
    start,
    end,
    session,
    signalTimeframe,
    smoke,
    replayWinner: !smoke && replayWinner,
    lockWaitMs,
    reportDir: path.resolve(cwd, reportRoot),
    mtfSweep,
  };
}

export function buildStageAVariants(): SweepVariant[] {
  return STAGE_A_TIME_HORIZONS.map((timeHorizon) => ({
    id: `stage-a-h${timeHorizon}`,
    stage: "A",
    pyrusSignalsSettingsPatch: { timeHorizon },
  }));
}

export function buildStageBVariants(
  timeHorizons: readonly number[],
): SweepVariant[] {
  const variants: SweepVariant[] = [];
  for (const timeHorizon of timeHorizons) {
    for (const bosConfirmation of BOS_CONFIRMATIONS) {
      for (const chochAtrBuffer of CHOCH_ATR_BUFFERS) {
        for (const chochBodyExpansionAtr of BODY_EXPANSIONS) {
          for (const chochVolumeGate of VOLUME_GATES) {
            variants.push({
              id: [
                "stage-b",
                `h${timeHorizon}`,
                `bos-${bosConfirmation}`,
                `atr-${numberToken(chochAtrBuffer)}`,
                `body-${numberToken(chochBodyExpansionAtr)}`,
                `vol-${numberToken(chochVolumeGate)}`,
              ].join("-"),
              stage: "B",
              pyrusSignalsSettingsPatch: {
                timeHorizon,
                bosConfirmation,
                chochAtrBuffer,
                chochBodyExpansionAtr,
                chochVolumeGate,
              },
            });
          }
        }
      }
    }
  }
  return variants;
}

function mtfProfilePatch(input: {
  enabled?: boolean;
  timeframes: readonly string[];
  requiredCount: number;
  preset?: string;
}): JsonRecord {
  return {
    entryGate: {
      mtfAlignment: {
        enabled: input.enabled ?? true,
        requiredCount: input.requiredCount,
        timeframes: [...input.timeframes],
        preset: input.preset ?? "custom",
      },
    },
  };
}

export function buildMtfEntryGateVariants(): SweepVariant[] {
  return [
    {
      id: "diagnostic-no-mtf",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        enabled: false,
        timeframes: DEFAULT_MTF_TIMEFRAMES,
        requiredCount: 1,
      }),
      winnerEligible: false,
    },
    {
      id: "baseline-live-five-q1",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: DEFAULT_MTF_TIMEFRAMES,
        requiredCount: 1,
      }),
    },
    {
      id: "baseline-default-five-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: DEFAULT_MTF_TIMEFRAMES,
        requiredCount: 2,
      }),
    },
    {
      id: "scalp-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["1m", "2m", "5m"],
        requiredCount: 2,
        preset: "scalp",
      }),
    },
    {
      id: "intraday-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["5m", "15m", "1h"],
        requiredCount: 2,
        preset: "balanced",
      }),
    },
    {
      id: "mixed-fast-hour-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["1m", "5m", "1h"],
        requiredCount: 2,
        preset: "balanced",
      }),
    },
    {
      id: "balanced-six-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ALL_MTF_TIMEFRAMES,
        requiredCount: 2,
        preset: "six_frame",
      }),
    },
    {
      id: "balanced-six-q3",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ALL_MTF_TIMEFRAMES,
        requiredCount: 3,
        preset: "six_frame",
      }),
    },
    {
      id: "higher-confirm-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["15m", "1h", "1d"],
        requiredCount: 2,
        preset: "higher_timeframe",
      }),
    },
    {
      id: "higher-confirm-q3",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["15m", "1h", "1d"],
        requiredCount: 3,
        preset: "higher_timeframe",
      }),
    },
    {
      id: "swing-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["5m", "15m", "1h", "1d"],
        requiredCount: 2,
        preset: "higher_timeframe",
      }),
    },
    {
      id: "fast-plus-daily-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["1m", "5m", "1d"],
        requiredCount: 2,
        preset: "balanced",
      }),
    },
    {
      id: "hour-daily-q2",
      stage: "MTF",
      pyrusSignalsSettingsPatch: {},
      profilePatch: mtfProfilePatch({
        timeframes: ["1h", "1d"],
        requiredCount: 2,
        preset: "higher_timeframe",
      }),
    },
  ];
}

type ClosedTradeEvidence = { day: string; pnl: number };

function closedTradeEvidence(trade: unknown): ClosedTradeEvidence | null {
  const record = asRecord(trade);
  const closedAt = record["closedAt"];
  const pnl = finiteNumber(record["pnl"]);
  if (
    typeof closedAt !== "string" ||
    pnl === null ||
    Number.isNaN(Date.parse(closedAt))
  ) {
    return null;
  }
  const day = closedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsedDay = new Date(`${day}T00:00:00.000Z`);
  return parsedDay.toISOString().slice(0, 10) === day ? { day, pnl } : null;
}

function maxRealizedDrawdown(
  closedTrades: readonly ClosedTradeEvidence[],
): number {
  const pnlByDay = new Map<string, number>();
  for (const trade of closedTrades) {
    pnlByDay.set(trade.day, (pnlByDay.get(trade.day) ?? 0) + trade.pnl);
  }

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const day of Array.from(pnlByDay.keys()).sort()) {
    cumulative += pnlByDay.get(day) ?? 0;
    if (!Number.isFinite(cumulative)) {
      throw new Error(
        "Sweep metrics require finite aggregate financial evidence.",
      );
    }
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return Number(maxDrawdown.toFixed(2));
}

export function computeMaxRealizedDrawdown(
  closedTrades: readonly unknown[],
): number {
  return maxRealizedDrawdown(
    closedTrades
      .map(closedTradeEvidence)
      .filter((trade): trade is ClosedTradeEvidence => trade !== null),
  );
}

export function computeSweepMetrics(result: unknown): SweepMetrics {
  const record = asRecord(result);
  const summary = asRecord(record["summary"]);
  const closedTrades = asArray(summary["closedTrades"])
    .map(closedTradeEvidence)
    .filter((trade): trade is ClosedTradeEvidence => trade !== null);
  const realizedPnl = closedTrades.reduce<number>(
    (total, trade) => total + trade.pnl,
    0,
  );
  const wins = closedTrades.filter((trade) => trade.pnl > 0).length;
  const grossProfit = closedTrades.reduce<number>((total, trade) => {
    return trade.pnl > 0 ? total + trade.pnl : total;
  }, 0);
  const grossLossAbs = Math.abs(
    closedTrades.reduce<number>((total, trade) => {
      return trade.pnl < 0 ? total + trade.pnl : total;
    }, 0),
  );
  if (![realizedPnl, grossProfit, grossLossAbs].every(Number.isFinite)) {
    throw new Error(
      "Sweep metrics require finite aggregate financial evidence.",
    );
  }
  const maxDrawdownAbs = maxRealizedDrawdown(closedTrades);
  const closedTradeCount = closedTrades.length;
  return {
    realizedPnl: Number(realizedPnl.toFixed(2)),
    winRate: closedTradeCount ? wins / closedTradeCount : 0,
    profitFactor:
      grossLossAbs === 0
        ? grossProfit > 0
          ? Infinity
          : 0
        : grossProfit / grossLossAbs,
    closedTrades: closedTradeCount,
    maxDrawdownAbs,
    openPositions: asArray(record["openPositions"]).length,
    riskAdjustedScore: Number(
      (realizedPnl / Math.max(500, maxDrawdownAbs)).toFixed(6),
    ),
  };
}

function compareSweepResults(left: SweepResult, right: SweepResult): number {
  return (
    right.metrics.riskAdjustedScore - left.metrics.riskAdjustedScore ||
    right.metrics.realizedPnl - left.metrics.realizedPnl ||
    right.metrics.profitFactor - left.metrics.profitFactor ||
    right.metrics.closedTrades - left.metrics.closedTrades ||
    left.metrics.openPositions - right.metrics.openPositions ||
    left.variant.id.localeCompare(right.variant.id)
  );
}

export function rankSweepResults(
  results: readonly SweepResult[],
  minClosedTrades = MIN_CLOSED_TRADES,
): SweepResult[] {
  return results
    .filter(
      (result) =>
        result.status === "succeeded" &&
        result.variant.winnerEligible !== false &&
        result.metrics.closedTrades >= minClosedTrades,
    )
    .map((result) => ({ ...result, eligible: true, ineligibleReason: null }))
    .sort(compareSweepResults);
}

function resolveSweepEligibility(
  variant: SweepVariant,
  closedTrades: number,
): Pick<SweepResult, "eligible" | "ineligibleReason"> {
  if (variant.winnerEligible === false) {
    return {
      eligible: false,
      ineligibleReason: "variant excluded from winner selection",
    };
  }
  if (closedTrades < MIN_CLOSED_TRADES) {
    return {
      eligible: false,
      ineligibleReason: `closed trades below ${MIN_CLOSED_TRADES}`,
    };
  }
  return { eligible: true, ineligibleReason: null };
}

function emptyMetrics(): SweepMetrics {
  return {
    realizedPnl: 0,
    winRate: 0,
    profitFactor: 0,
    closedTrades: 0,
    maxDrawdownAbs: 0,
    openPositions: 0,
    riskAdjustedScore: 0,
  };
}

function validateSweepDeployment(
  deployment: Omit<DeploymentRow, "symbolUniverse"> & {
    symbolUniverse: unknown[];
  },
): void {
  if (deployment.mode !== "shadow") {
    throw new Error(
      `Deployment ${deployment.id} must be shadow, received ${deployment.mode}.`,
    );
  }
  if (
    !Array.isArray(deployment.symbolUniverse) ||
    deployment.symbolUniverse.length === 0
  ) {
    throw new Error(
      `Deployment ${deployment.id} has an empty symbol universe.`,
    );
  }
}

function selectSweepSymbolUniverse(
  fullUniverse: readonly unknown[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const universe = Array.from(
    new Set(
      fullUniverse
        .filter((symbol): symbol is string => typeof symbol === "string")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (universe.length === 0) {
    throw new Error("The signal-options deployment has no valid symbols.");
  }

  const explicitValue = nonEmptyEnv(env, "PYRUS_SIGNALS_SWEEP_SYMBOLS");
  if (explicitValue && nonEmptyEnv(env, "PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT")) {
    throw new Error(
      "PYRUS_SIGNALS_SWEEP_SYMBOLS and PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT cannot both be set.",
    );
  }
  if (explicitValue) {
    const wanted = new Set(
      explicitValue
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    );
    const selected = universe.filter((symbol) => wanted.has(symbol));
    if (selected.length === 0) {
      throw new Error(
        "PYRUS_SIGNALS_SWEEP_SYMBOLS does not match the deployment universe.",
      );
    }
    return selected;
  }

  const limit = readIntegerEnv("PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT", 0, env);
  return limit > 0 ? universe.slice(0, limit) : universe;
}

async function readSignalOptionsDeployment(
  runtime: Pick<SweepRuntime, "pool">,
): Promise<DeploymentRow> {
  const result = await runtime.pool.query<DeploymentRow>(
    `
      select id, name, mode, symbol_universe as "symbolUniverse"
      from algo_deployments
      where enabled = true
        and provider_account_id = 'shadow'
        and (
          name = 'Pyrus Signals Options Shadow'
          or config->'parameters'->>'executionMode' = 'signal_options'
        )
      order by
        case when name = 'Pyrus Signals Options Shadow' then 0 else 1 end,
        updated_at desc
      limit 1
    `,
  );
  const deployment = result.rows[0];
  if (!deployment)
    throw new Error("No enabled shadow signal-options deployment found.");
  validateSweepDeployment(deployment);
  // Optional research subset (env-gated; default = full deployment universe). Lets a sweep
  // skip the illiquid tail of a large universe — which still loads + evaluates bars but
  // yields ~no tradeable option entries — WITHOUT mutating the live deployment row.
  //   PYRUS_SIGNALS_SWEEP_SYMBOLS=SPY,NVDA,...  explicit list (intersected w/ universe, universe order)
  //   PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT=90        first-N of the deployment universe
  const universe = selectSweepSymbolUniverse(deployment.symbolUniverse);
  if (universe.length !== deployment.symbolUniverse.length) {
    console.log(
      jsonText({
        symbolSubset: {
          from: deployment.symbolUniverse.length,
          to: universe.length,
          first: universe[0],
          last: universe[universe.length - 1],
        },
      }),
    );
  }
  return { ...deployment, symbolUniverse: universe };
}

async function acquireSignalOptionsWorkerLock(
  waitMs: number,
  runtime: Pick<SweepRuntime, "sharedAdvisoryLockHolder" | "workerLockKey">,
) {
  const deadline = Date.now() + waitMs;
  let release = await runtime.sharedAdvisoryLockHolder.acquire(
    runtime.workerLockKey,
  );
  while (!release && Date.now() < deadline) {
    console.log("waiting for signal-options worker advisory lock");
    await delay(Math.min(5_000, Math.max(0, deadline - Date.now())));
    release = await runtime.sharedAdvisoryLockHolder.acquire(
      runtime.workerLockKey,
    );
  }
  return release;
}

type RunVariantInput = {
  deployment: DeploymentRow;
  variant: SweepVariant;
  config: SweepConfig;
  commit: boolean;
  replay: boolean;
};

function buildVariantBackfillInput(
  input: RunVariantInput,
): Parameters<RunSignalOptionsShadowBackfill>[0] {
  const replay = input.replay
    ? {
        runId: `pyrus-signals-sweep-${slug()}-${input.variant.id}`,
        marketDate: input.config.start,
        deploymentId: input.deployment.id,
        deploymentName: input.deployment.name,
      }
    : null;
  return {
    deploymentId: input.deployment.id,
    start: input.config.start,
    end: input.config.end,
    session: input.config.session,
    commit: input.commit,
    replay,
    replaceReplayRows: input.replay,
    forceDeploymentUniverse: true,
    symbolUniverseOverride: input.deployment.symbolUniverse,
    useBarDerivedMtf: true,
    signalTimeframe: input.config.signalTimeframe,
    pyrusSignalsSettingsPatch: input.variant.pyrusSignalsSettingsPatch,
    profilePatch: input.variant.profilePatch,
  };
}

async function runVariant(
  input: RunVariantInput,
  runtime: Pick<SweepRuntime, "runSignalOptionsShadowBackfill">,
): Promise<SweepResult> {
  const started = new Date();
  try {
    const result = await runtime.runSignalOptionsShadowBackfill(
      buildVariantBackfillInput(input),
    );
    const finished = new Date();
    const metrics = computeSweepMetrics(result);
    return {
      variant: input.variant,
      status: "succeeded",
      ...resolveSweepEligibility(input.variant, metrics.closedTrades),
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      window: asRecord(result.window),
      timeframe: String(result.timeframe ?? ""),
      metrics,
      summary: asRecord(result.summary),
      error: null,
    };
  } catch (error) {
    const finished = new Date();
    return {
      variant: input.variant,
      status: "failed",
      eligible: false,
      ineligibleReason: "run failed",
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      window: null,
      timeframe: null,
      metrics: emptyMetrics(),
      summary: null,
      error: safeDiagnostic(error),
    };
  }
}

function csvValue(value: unknown): string {
  const raw =
    typeof value === "number" && !Number.isFinite(value)
      ? String(value)
      : String(value ?? "");
  const text =
    typeof value === "string" && /^[\t ]*[=+@-]/.test(value)
      ? `'${value}`
      : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function markdownText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n\u2028\u2029]+/gu, " ")
    .replace(/([\\`*_[\]{}()#+.!|~>-])/gu, "\\$1");
}

function jsonText(value: unknown, space?: number): string {
  return (
    JSON.stringify(
      value,
      (_key, item) =>
        typeof item === "number" && !Number.isFinite(item)
          ? String(item)
          : item,
      space,
    ) ?? "null"
  ).replace(
    UNSAFE_JSON_OUTPUT_PATTERN,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

function markdownJson(value: unknown): string {
  return jsonText(value, 2).replaceAll("`", "\\u0060");
}

type ReportFiles = Record<"results.json" | "results.csv" | "report.md", string>;

async function assertReportDestinationAvailable(
  reportDir: string,
): Promise<void> {
  try {
    await lstat(reportDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Report destination already exists: ${reportDir}`);
}

async function publishReportFiles(
  reportDir: string,
  files: ReportFiles,
): Promise<void> {
  const parent = path.dirname(reportDir);
  await mkdir(parent, { recursive: true });
  const temporaryDir = await mkdtemp(
    path.join(parent, `.${path.basename(reportDir)}.tmp-`),
  );
  try {
    await Promise.all(
      Object.entries(files).map(([name, contents]) =>
        writeFile(path.join(temporaryDir, name), contents),
      ),
    );
    await rename(temporaryDir, reportDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function reportRows(results: readonly SweepResult[]) {
  return results.map((result) => ({
    variantId: result.variant.id,
    stage: result.variant.stage,
    status: result.status,
    eligible: result.eligible,
    ineligibleReason: result.ineligibleReason ?? "",
    pyrusSignalsPatch: JSON.stringify(result.variant.pyrusSignalsSettingsPatch),
    profilePatch: JSON.stringify(result.variant.profilePatch ?? {}),
    realizedPnl: result.metrics.realizedPnl,
    winRate: result.metrics.winRate,
    profitFactor: result.metrics.profitFactor,
    closedTrades: result.metrics.closedTrades,
    maxDrawdownAbs: result.metrics.maxDrawdownAbs,
    openPositions: result.metrics.openPositions,
    riskAdjustedScore: result.metrics.riskAdjustedScore,
    symbolsEvaluated: finiteNumber(result.summary?.["symbolsEvaluated"]) ?? "",
    signalsEvaluated: finiteNumber(result.summary?.["signalsEvaluated"]) ?? "",
    entriesOpened: finiteNumber(result.summary?.["entriesOpened"]) ?? "",
    exitsClosed: finiteNumber(result.summary?.["exitsClosed"]) ?? "",
    error: result.error ?? "",
  }));
}

async function writeReports(input: {
  reportDir: string;
  deployment: DeploymentRow;
  config: SweepConfig;
  results: SweepResult[];
  ranked: SweepResult[];
  replayResult?: SweepResult | null;
  verification?: JsonRecord | null;
}) {
  const rows = reportRows(input.results);
  const headers = Object.keys(
    rows[0] ?? {
      variantId: "",
      stage: "",
      status: "",
      eligible: "",
      ineligibleReason: "",
      patch: "",
      realizedPnl: "",
      winRate: "",
      profitFactor: "",
      closedTrades: "",
      maxDrawdownAbs: "",
      openPositions: "",
      riskAdjustedScore: "",
      symbolsEvaluated: "",
      signalsEvaluated: "",
      entriesOpened: "",
      exitsClosed: "",
      error: "",
    },
  );
  const csv = [
    headers.join(","),
    ...rows.map((row) => {
      const record = row as Record<string, unknown>;
      return headers.map((header) => csvValue(record[header])).join(",");
    }),
  ].join("\n");
  const winner = input.ranked[0] ?? null;
  const markdown = [
    "# Pyrus Signals Options Sweep",
    "",
    `- Deployment: ${markdownText(input.deployment.name)} (${markdownText(input.deployment.id)})`,
    `- Symbols: ${input.deployment.symbolUniverse.length}`,
    `- Window: ${input.config.start} through ${input.config.end ?? "latest completed trading day"}`,
    `- Signal timeframe: ${input.config.signalTimeframe}`,
    `- Dry variants: ${input.results.length}`,
    `- Eligible variants: ${input.ranked.length}`,
    winner
      ? `- Winner: ${markdownText(winner.variant.id)} score ${winner.metrics.riskAdjustedScore}`
      : "- Winner: none",
    "",
    "| Rank | Variant | Pyrus Patch | Profile Patch | PnL | Score | Trades | PF | Max DD | Open |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...input.ranked
      .slice(0, 20)
      .map((result, index) =>
        [
          index + 1,
          markdownText(result.variant.id),
          `\`${JSON.stringify(result.variant.pyrusSignalsSettingsPatch)}\``,
          `\`${JSON.stringify(result.variant.profilePatch ?? {})}\``,
          result.metrics.realizedPnl.toFixed(2),
          result.metrics.riskAdjustedScore.toFixed(6),
          result.metrics.closedTrades,
          Number.isFinite(result.metrics.profitFactor)
            ? result.metrics.profitFactor.toFixed(3)
            : "Infinity",
          result.metrics.maxDrawdownAbs.toFixed(2),
          result.metrics.openPositions,
        ].join(" | "),
      ),
    "",
    replayReportLine(input.replayResult),
    input.verification
      ? `\n\`\`\`json\n${markdownJson(input.verification)}\n\`\`\``
      : "",
  ].join("\n");

  await publishReportFiles(input.reportDir, {
    "results.json": `${jsonText(input, 2)}\n`,
    "results.csv": `${csv}\n`,
    "report.md": `${markdown}\n`,
  });
}

function replayReportLine(result?: SweepResult | null): string {
  if (!result) return "Replay committed: no";
  if (result.status === "failed") {
    return `Replay failed: ${markdownText(result.error ?? "unknown error")}`;
  }
  if (!result.eligible || result.metrics.closedTrades < MIN_CLOSED_TRADES) {
    return `Replay completed but is no longer eligible: ${markdownText(result.variant.id)}`;
  }
  return `Replay committed: ${markdownText(result.variant.id)}`;
}

type ReplayLedgerMode = "own" | "shadow_orders";

function replayLedgerMode(
  env: NodeJS.ProcessEnv = process.env,
): ReplayLedgerMode {
  return env["PYRUS_BACKTEST_LEDGER"]?.trim().toLowerCase() === "own"
    ? "own"
    : "shadow_orders";
}

async function verifyReplayLedger(input: {
  deploymentId: string;
  window: JsonRecord | null;
  ledgerMode: ReplayLedgerMode;
  serviceCompleted: boolean;
  runtime: Pick<SweepRuntime, "pool">;
}) {
  if (!input.serviceCompleted) {
    return {
      ledgerMode: input.ledgerMode,
      serviceCompletion: false,
      skipped: true,
      reason: "replay service did not complete successfully",
    };
  }
  if (input.ledgerMode === "own") {
    return {
      ledgerMode: "own",
      serviceCompletion: true,
      reason:
        "Committed replay completed through the own-backtest-ledger service path.",
    };
  }
  const from = String(input.window?.["from"] ?? "");
  const to = String(input.window?.["to"] ?? "");
  if (!from || !to) {
    return {
      ledgerMode: "shadow_orders",
      skipped: true,
      reason: "missing replay window",
    };
  }

  const result = await input.runtime.pool.query<JsonRecord>(
    `
      with replay_orders as (
        select o.*
        from shadow_orders o
        where o.source = 'signal_options_replay'
          and o.placed_at >= $2::timestamptz
          and o.placed_at <= $3::timestamptz
          and (
            o.payload->'replay'->>'deploymentId' = $1
            or o.payload->'metadata'->>'deploymentId' = $1
            or o.payload->>'sourceDeploymentId' = $1
            or o.payload->'metadata'->>'positionKey' like ('signal_options_replay:%:' || $1 || ':%')
          )
      )
      select
        count(*)::int as "orderCount",
        count(*) filter (where source_event_id is null)::int as "ordersWithNullSourceEventId",
        count(*) filter (
          where payload->'metadata'->>'sourceType' is null
             or payload->'metadata'->>'positionKey' is null
        )::int as "ordersWithNullSourceMetadata",
        count(*) filter (
          where not exists (
            select 1 from shadow_fills f where f.order_id = replay_orders.id
          )
        )::int as "ordersWithoutFills",
        count(distinct payload->'metadata'->>'runId')::int as "runIdCount",
        array_remove(array_agg(distinct payload->'metadata'->>'runId'), null) as "runIds"
      from replay_orders
    `,
    [input.deploymentId, from, to],
  );
  return { ledgerMode: "shadow_orders", ...(result.rows[0] ?? {}) };
}

function assertSweepCompletion(input: {
  results: readonly SweepResult[];
  replayRequired?: boolean;
  replayResult?: SweepResult | null;
  verification?: JsonRecord | null;
}): void {
  if (!input.results.some((result) => result.status === "succeeded")) {
    throw new Error("Every sweep variant failed; inspect the written report.");
  }
  if (input.replayRequired && !input.replayResult) {
    throw new Error(
      "Winner replay was requested but no eligible winner was available.",
    );
  }
  if (!input.replayResult) return;
  if (input.replayResult.status !== "succeeded") {
    throw new Error(
      `Winner replay failed: ${input.replayResult.error ?? "unknown error"}`,
    );
  }
  if (
    !input.replayResult.eligible ||
    input.replayResult.metrics.closedTrades < MIN_CLOSED_TRADES
  ) {
    throw new Error("Winner replay completed but is no longer eligible.");
  }

  const verification = asRecord(input.verification);
  if (
    verification["ledgerMode"] === "own" &&
    verification["serviceCompletion"] === true
  ) {
    return;
  }
  const invalidCounts = [
    "ordersWithNullSourceEventId",
    "ordersWithNullSourceMetadata",
    "ordersWithoutFills",
  ].filter((key) => finiteNumber(verification[key]) !== 0);
  if (
    verification["ledgerMode"] !== "shadow_orders" ||
    verification["skipped"] === true ||
    finiteNumber(verification["orderCount"]) === null ||
    (finiteNumber(verification["orderCount"]) ?? 0) < 1 ||
    finiteNumber(verification["runIdCount"]) !== 1 ||
    invalidCounts.length > 0
  ) {
    throw new Error(
      "Replay ledger verification failed; inspect the written report.",
    );
  }
}

async function main() {
  parseSweepArgs();
  const config = readSweepConfig();
  await assertReportDestinationAvailable(config.reportDir);
  enableHistoricalBarEvaluation();
  let runtime: SweepRuntime | null = null;
  let releaseLock: (() => Promise<void>) | null = null;
  let failed = false;

  try {
    runtime = await loadSweepRuntime();
    releaseLock = await acquireSignalOptionsWorkerLock(
      config.lockWaitMs,
      runtime,
    );
    if (!releaseLock) {
      throw new Error("Signal-options worker advisory lock is already held.");
    }
    const deployment = await readSignalOptionsDeployment(runtime);
    const stageA = config.smoke
      ? buildStageAVariants().slice(0, 2)
      : buildStageAVariants();
    const mtfVariants = config.smoke
      ? buildMtfEntryGateVariants().slice(0, 3)
      : buildMtfEntryGateVariants();
    const results: SweepResult[] = [];
    console.log(
      jsonText({
        deployment: {
          id: deployment.id,
          name: deployment.name,
          symbolCount: deployment.symbolUniverse.length,
        },
        config,
        stageAVariants: config.mtfSweep ? 0 : stageA.length,
        mtfVariants: config.mtfSweep ? mtfVariants.length : 0,
      }),
    );

    const initialVariants = config.mtfSweep ? mtfVariants : stageA;
    for (const variant of initialVariants) {
      console.log(`dry-run ${variant.id}`);
      results.push(
        await runVariant(
          { deployment, variant, config, commit: false, replay: false },
          runtime,
        ),
      );
    }

    let ranked = rankSweepResults(results);
    if (!config.smoke && !config.mtfSweep) {
      const topHorizons = ranked
        .filter((result) => result.variant.stage === "A")
        .slice(0, 2)
        .map((result) =>
          finiteNumber(result.variant.pyrusSignalsSettingsPatch["timeHorizon"]),
        )
        .filter((value): value is number => value !== null);
      if (topHorizons.length < 2) {
        await writeReports({
          reportDir: config.reportDir,
          deployment,
          config,
          results,
          ranked,
          replayResult: null,
          verification: null,
        });
        throw new Error(
          "Fewer than two eligible Stage A horizons; refusing Stage B.",
        );
      }

      for (const variant of buildStageBVariants(topHorizons)) {
        console.log(`dry-run ${variant.id}`);
        results.push(
          await runVariant(
            { deployment, variant, config, commit: false, replay: false },
            runtime,
          ),
        );
      }
      ranked = rankSweepResults(results);
    }

    let replayResult: SweepResult | null = null;
    let verification: JsonRecord | null = null;
    const winner = ranked[0] ?? null;
    if (winner && config.replayWinner) {
      console.log(`replay ${winner.variant.id}`);
      replayResult = await runVariant(
        {
          deployment,
          variant: winner.variant,
          config,
          commit: true,
          replay: true,
        },
        runtime,
      );
      verification = await verifyReplayLedger({
        deploymentId: deployment.id,
        window: replayResult.window,
        ledgerMode: replayLedgerMode(),
        serviceCompleted: replayResult.status === "succeeded",
        runtime,
      });
    }

    await writeReports({
      reportDir: config.reportDir,
      deployment,
      config,
      results,
      ranked,
      replayResult,
      verification,
    });
    assertSweepCompletion({
      results,
      replayRequired: config.replayWinner,
      replayResult,
      verification,
    });

    console.log(
      jsonText(
        {
          reportDir: config.reportDir,
          dryVariants: results.length,
          eligibleVariants: ranked.length,
          winner: winner?.variant.id ?? null,
          replayCommitted: replayResult?.status === "succeeded",
          verification,
        },
        2,
      ),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (runtime) {
      try {
        await runtime.closeDatabaseConnections();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0 && !failed) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to close sweep database resources.",
      );
    }
    if (cleanupErrors.length > 0) {
      console.error(
        `Sweep cleanup also failed (${cleanupErrors.length} error(s)).`,
      );
    }
  }
}

export const __pyrusSignalsOptionsSweepInternalsForTests = {
  assertReportDestinationAvailable,
  assertSweepCompletion,
  buildVariantBackfillInput,
  csvValue,
  enableHistoricalBarEvaluation,
  jsonText,
  markdownJson,
  markdownText,
  parseSweepArgs,
  publishReportFiles,
  readSweepConfig,
  replayLedgerMode,
  replayReportLine,
  resolveSweepEligibility,
  safeDiagnostic,
  selectSweepSymbolUniverse,
  validateSweepDeployment,
  verifyReplayLedger,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(safeDiagnostic(error));
    process.exitCode = 1;
  });
}
