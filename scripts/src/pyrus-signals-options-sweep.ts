import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { runSignalOptionsShadowBackfill } from "../../artifacts/api-server/src/services/signal-options-automation";
import { SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY } from "../../artifacts/api-server/src/services/signal-options-worker";

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
  symbolUniverse: unknown[];
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
const DEFAULT_MTF_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h"] as const;
const ALL_MTF_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : null;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function numberToken(value: number): string {
  return String(value).replace(".", "p");
}

function readSweepConfig(): SweepConfig {
  const smoke = readBooleanEnv(
    "PYRUS_SIGNALS_SWEEP_SMOKE",
    false,
  );
  const mtfSweep =
    readBooleanEnv("PYRUS_SIGNALS_SWEEP_MTF", false) ||
    readBooleanEnv("SIGNAL_OPTIONS_MTF_SWEEP", false);
  const explicitStart =
    process.env["PYRUS_SIGNALS_SWEEP_START"] ??
    process.env["SIGNAL_OPTIONS_SWEEP_START"];
  const explicitEnd =
    process.env["PYRUS_SIGNALS_SWEEP_END"] ??
    process.env["SIGNAL_OPTIONS_SWEEP_END"];
  if (mtfSweep && (!explicitStart || !explicitEnd)) {
    throw new Error(
      "MTF sweeps require PYRUS_SIGNALS_SWEEP_START and PYRUS_SIGNALS_SWEEP_END so the two-day window is explicit.",
    );
  }
  const start =
    explicitStart ??
    (smoke ? "2026-05-04" : "2026-04-01");
  const end =
    explicitEnd ??
    (smoke ? "2026-05-05" : undefined);
  const reportRoot =
    process.env["PYRUS_SIGNALS_SWEEP_REPORT_DIR"] ??
    path.join("reports", "pyrus-signals-options-sweeps", slug());

  return {
    start,
    end,
    session: process.env["PYRUS_SIGNALS_SWEEP_SESSION"] ?? "regular",
    signalTimeframe:
      process.env["PYRUS_SIGNALS_SWEEP_SIGNAL_TIMEFRAME"] ??
      "5m",
    smoke,
    replayWinner:
      !smoke &&
      readBooleanEnv(
        "PYRUS_SIGNALS_SWEEP_REPLAY_WINNER",
        readBooleanEnv("SIGNAL_OPTIONS_SWEEP_REPLAY_WINNER", !mtfSweep),
      ),
    lockWaitMs: readIntegerEnv(
      "PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS",
      readIntegerEnv("PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS", 0),
    ),
    reportDir: path.resolve(process.cwd(), reportRoot),
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

export function buildStageBVariants(timeHorizons: readonly number[]): SweepVariant[] {
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

export function computeMaxRealizedDrawdown(closedTrades: readonly unknown[]): number {
  const pnlByDay = new Map<string, number>();
  for (const trade of closedTrades) {
    const record = asRecord(trade);
    const day = String(record["closedAt"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    pnlByDay.set(day, (pnlByDay.get(day) ?? 0) + (finiteNumber(record["pnl"]) ?? 0));
  }

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const day of Array.from(pnlByDay.keys()).sort()) {
    cumulative += pnlByDay.get(day) ?? 0;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return Number(maxDrawdown.toFixed(2));
}

export function computeSweepMetrics(result: unknown): SweepMetrics {
  const record = asRecord(result);
  const summary = asRecord(record["summary"]);
  const closedTrades = asArray(summary["closedTrades"]);
  const realizedPnl =
    finiteNumber(summary["realizedPnl"]) ??
    closedTrades.reduce<number>(
      (total, trade) => total + (finiteNumber(asRecord(trade)["pnl"]) ?? 0),
      0,
    );
  const wins =
    finiteNumber(summary["winningTrades"]) ??
    closedTrades.filter((trade) => (finiteNumber(asRecord(trade)["pnl"]) ?? 0) > 0)
      .length;
  const losses =
    finiteNumber(summary["losingTrades"]) ??
    closedTrades.filter((trade) => (finiteNumber(asRecord(trade)["pnl"]) ?? 0) < 0)
      .length;
  const grossProfit = closedTrades.reduce<number>((total, trade) => {
    const pnl = finiteNumber(asRecord(trade)["pnl"]) ?? 0;
    return pnl > 0 ? total + pnl : total;
  }, 0);
  const grossLossAbs = Math.abs(
    closedTrades.reduce<number>((total, trade) => {
      const pnl = finiteNumber(asRecord(trade)["pnl"]) ?? 0;
      return pnl < 0 ? total + pnl : total;
    }, 0),
  );
  const maxDrawdownAbs = computeMaxRealizedDrawdown(closedTrades);
  const closedTradeCount = closedTrades.length || wins + losses;
  return {
    realizedPnl: Number(realizedPnl.toFixed(2)),
    winRate: closedTradeCount ? wins / closedTradeCount : 0,
    profitFactor:
      grossLossAbs === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLossAbs,
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

async function readSignalOptionsDeployment(): Promise<DeploymentRow> {
  const result = await pool.query<DeploymentRow>(
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
  if (!deployment) throw new Error("No enabled shadow signal-options deployment found.");
  if (!Array.isArray(deployment.symbolUniverse) || deployment.symbolUniverse.length === 0) {
    throw new Error(`Deployment ${deployment.id} has an empty symbol universe.`);
  }
  // Optional research subset (env-gated; default = full deployment universe). Lets a sweep
  // skip the illiquid tail of a large universe — which still loads + evaluates bars but
  // yields ~no tradeable option entries — WITHOUT mutating the live deployment row.
  //   PYRUS_SIGNALS_SWEEP_SYMBOLS=SPY,NVDA,...  explicit list (intersected w/ universe, universe order)
  //   PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT=90        first-N of the deployment universe
  const fullUniverse = deployment.symbolUniverse as string[];
  const explicit = (process.env["PYRUS_SIGNALS_SWEEP_SYMBOLS"] ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const limit = readIntegerEnv("PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT", 0);
  let universe = fullUniverse;
  if (explicit.length) {
    const wanted = new Set(explicit);
    const kept = fullUniverse.filter((s) => wanted.has(s));
    universe = kept.length ? kept : explicit;
  } else if (limit > 0 && limit < fullUniverse.length) {
    universe = fullUniverse.slice(0, limit);
  }
  if (universe.length !== fullUniverse.length) {
    console.log(JSON.stringify({
      symbolSubset: { from: fullUniverse.length, to: universe.length, first: universe[0], last: universe[universe.length - 1] },
    }));
  }
  return { ...deployment, symbolUniverse: universe };
}

async function tryAcquireSignalOptionsWorkerLock() {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY],
    );
    if (result.rows[0]?.locked !== true) {
      client.release();
      return null;
    }
    return async () => {
      try {
        await client.query("select pg_advisory_unlock($1)", [
          SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
        ]);
      } finally {
        client.release();
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

async function acquireSignalOptionsWorkerLock(waitMs: number) {
  const deadline = Date.now() + waitMs;
  let release = await tryAcquireSignalOptionsWorkerLock();
  while (!release && Date.now() < deadline) {
    console.log("waiting for signal-options worker advisory lock");
    await delay(Math.min(5_000, Math.max(0, deadline - Date.now())));
    release = await tryAcquireSignalOptionsWorkerLock();
  }
  return release;
}

async function runVariant(input: {
  deployment: DeploymentRow;
  variant: SweepVariant;
  config: SweepConfig;
  commit: boolean;
  replay: boolean;
}): Promise<SweepResult> {
  const started = new Date();
  try {
    const replay = input.replay
      ? {
          runId: `pyrus-signals-sweep-${slug()}-${input.variant.id}`,
          marketDate: input.config.start,
          deploymentId: input.deployment.id,
          deploymentName: input.deployment.name,
        }
      : null;
    const result = await runSignalOptionsShadowBackfill({
      deploymentId: input.deployment.id,
      start: input.config.start,
      end: input.config.end,
      session: input.config.session,
      commit: input.commit,
      replay,
      replaceReplayRows: input.replay,
      forceDeploymentUniverse: true,
      signalTimeframe: input.config.signalTimeframe,
      pyrusSignalsSettingsPatch: input.variant.pyrusSignalsSettingsPatch,
      profilePatch: input.variant.profilePatch,
    });
    const finished = new Date();
    const metrics = computeSweepMetrics(result);
    return {
      variant: input.variant,
      status: "succeeded",
      eligible: metrics.closedTrades >= MIN_CLOSED_TRADES,
      ineligibleReason:
        metrics.closedTrades >= MIN_CLOSED_TRADES
          ? null
          : `closed trades below ${MIN_CLOSED_TRADES}`,
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
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function csvValue(value: unknown): string {
  const text =
    typeof value === "number" && !Number.isFinite(value)
      ? String(value)
      : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
  await mkdir(input.reportDir, { recursive: true });
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
    `- Deployment: ${input.deployment.name} (${input.deployment.id})`,
    `- Symbols: ${input.deployment.symbolUniverse.length}`,
    `- Window: ${input.config.start} through ${input.config.end ?? "latest completed trading day"}`,
    `- Signal timeframe: ${input.config.signalTimeframe}`,
    `- Dry variants: ${input.results.length}`,
    `- Eligible variants: ${input.ranked.length}`,
    winner
      ? `- Winner: ${winner.variant.id} score ${winner.metrics.riskAdjustedScore}`
      : "- Winner: none",
    "",
    "| Rank | Variant | Pyrus Patch | Profile Patch | PnL | Score | Trades | PF | Max DD | Open |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...input.ranked.slice(0, 20).map((result, index) =>
      [
        index + 1,
        result.variant.id,
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
    input.replayResult
      ? `Replay committed: ${input.replayResult.variant.id}`
      : "Replay committed: no",
    input.verification
      ? `\n\`\`\`json\n${JSON.stringify(input.verification, null, 2)}\n\`\`\``
      : "",
  ].join("\n");

  await writeFile(path.join(input.reportDir, "results.json"), `${JSON.stringify(input, null, 2)}\n`);
  await writeFile(path.join(input.reportDir, "results.csv"), `${csv}\n`);
  await writeFile(path.join(input.reportDir, "report.md"), `${markdown}\n`);
}

async function verifyReplayLedger(input: {
  deploymentId: string;
  window: JsonRecord | null;
}) {
  const from = String(input.window?.["from"] ?? "");
  const to = String(input.window?.["to"] ?? "");
  if (!from || !to) return { skipped: true, reason: "missing replay window" };

  const result = await pool.query<JsonRecord>(
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
  return result.rows[0] ?? {};
}

async function main() {
  const config = readSweepConfig();
  const releaseLock = await acquireSignalOptionsWorkerLock(config.lockWaitMs);
  if (!releaseLock) throw new Error("Signal-options worker advisory lock is already held.");

  try {
    const deployment = await readSignalOptionsDeployment();
    const stageA = config.smoke ? buildStageAVariants().slice(0, 2) : buildStageAVariants();
    const mtfVariants = config.smoke
      ? buildMtfEntryGateVariants().slice(0, 3)
      : buildMtfEntryGateVariants();
    const results: SweepResult[] = [];
    console.log(JSON.stringify({
      deployment: {
        id: deployment.id,
        name: deployment.name,
        symbolCount: deployment.symbolUniverse.length,
      },
      config,
      stageAVariants: config.mtfSweep ? 0 : stageA.length,
      mtfVariants: config.mtfSweep ? mtfVariants.length : 0,
    }));

    const initialVariants = config.mtfSweep ? mtfVariants : stageA;
    for (const variant of initialVariants) {
      console.log(`dry-run ${variant.id}`);
      results.push(await runVariant({ deployment, variant, config, commit: false, replay: false }));
    }

    let ranked = rankSweepResults(results);
    if (!config.smoke && !config.mtfSweep) {
      const topHorizons = ranked
        .filter((result) => result.variant.stage === "A")
        .slice(0, 2)
        .map((result) => finiteNumber(result.variant.pyrusSignalsSettingsPatch["timeHorizon"]))
        .filter((value): value is number => value !== null);
      if (topHorizons.length < 2) {
        throw new Error("Fewer than two eligible Stage A horizons; refusing Stage B.");
      }

      for (const variant of buildStageBVariants(topHorizons)) {
        console.log(`dry-run ${variant.id}`);
        results.push(await runVariant({ deployment, variant, config, commit: false, replay: false }));
      }
      ranked = rankSweepResults(results);
    }

    let replayResult: SweepResult | null = null;
    let verification: JsonRecord | null = null;
    const winner = ranked[0] ?? null;
    if (winner && config.replayWinner) {
      console.log(`replay ${winner.variant.id}`);
      replayResult = await runVariant({
        deployment,
        variant: winner.variant,
        config,
        commit: true,
        replay: true,
      });
      verification = await verifyReplayLedger({
        deploymentId: deployment.id,
        window: replayResult.window,
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

    console.log(JSON.stringify({
      reportDir: config.reportDir,
      dryVariants: results.length,
      eligibleVariants: ranked.length,
      winner: winner?.variant.id ?? null,
      replayCommitted: replayResult?.status === "succeeded",
      verification,
    }, null, 2));
  } finally {
    await releaseLock();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
