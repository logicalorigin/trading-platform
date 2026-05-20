import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { tunedSignalOptionsStrategySettings } from "@workspace/backtest-core";
import { pool } from "@workspace/db";
import { runSignalOptionsShadowBackfill } from "../../artifacts/api-server/src/services/signal-options-automation";
import { SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY } from "../../artifacts/api-server/src/services/signal-options-worker";

type JsonRecord = Record<string, unknown>;

export type ExitPolicyVariant = {
  id: string;
  description: string;
  profilePatch: JsonRecord;
};

type SweepMetrics = {
  realizedPnl: number;
  winRate: number;
  profitFactor: number;
  closedTrades: number;
  maxDrawdownAbs: number;
  openPositions: number;
  riskAdjustedScore: number;
};

export type SweepResult = {
  variant: ExitPolicyVariant;
  status: "succeeded" | "failed";
  eligible: boolean;
  ineligibleReason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  metrics: SweepMetrics;
  window: JsonRecord | null;
  summary: JsonRecord | null;
  error: string | null;
};

type DeploymentRow = {
  id: string;
  name: string;
  mode: "paper" | "live";
  symbolUniverse: unknown[];
};

type SweepConfig = {
  start: string;
  end?: string;
  signalTimeframe: string;
  session: string;
  reportDir: string;
  lockWaitMs: number;
  heartbeatMs: number;
  variantTimeoutMs: number;
  timeHorizon: number;
  symbols: string[];
};

const MIN_CLOSED_TRADES = 20;
const ACCOUNT_SIZE = 30_000;
const DEFAULT_VARIANT_HEARTBEAT_MS = 60_000;
const DEFAULT_VARIANT_TIMEOUT_MS = 20 * 60_000;
const RISK_CAP_PATCH = {
  riskCaps: {
    maxOpenSymbols: 10,
    maxPremiumPerEntry: ACCOUNT_SIZE * 0.05,
  },
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function readBoundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readSweepConfig(): SweepConfig {
  const reportRoot =
    process.env["SIGNAL_OPTIONS_EXIT_SWEEP_REPORT_DIR"] ??
    path.join("reports", "signal-options-exit-policy-sweeps", slug());
  const end = process.env["SIGNAL_OPTIONS_EXIT_SWEEP_END"];
  return {
    start: process.env["SIGNAL_OPTIONS_EXIT_SWEEP_START"] ?? "2026-04-01",
    ...(end ? { end } : {}),
    signalTimeframe:
      process.env["SIGNAL_OPTIONS_EXIT_SWEEP_TIMEFRAME"] ??
      tunedSignalOptionsStrategySettings.signalTimeframe,
    session: process.env["SIGNAL_OPTIONS_EXIT_SWEEP_SESSION"] ?? "regular",
    reportDir: path.resolve(process.cwd(), reportRoot),
    lockWaitMs: readIntegerEnv("SIGNAL_OPTIONS_EXIT_SWEEP_LOCK_WAIT_MS", 0),
    heartbeatMs: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_HEARTBEAT_MS",
      DEFAULT_VARIANT_HEARTBEAT_MS,
    ),
    variantTimeoutMs: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_VARIANT_TIMEOUT_MS",
      DEFAULT_VARIANT_TIMEOUT_MS,
    ),
    timeHorizon: readBoundedIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_HORIZON",
      tunedSignalOptionsStrategySettings.rayReplicaSettings.timeHorizon,
      2,
      50,
    ),
    symbols:
      process.env["SIGNAL_OPTIONS_EXIT_SWEEP_SYMBOLS"]
        ?.split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean) ?? [],
  };
}

function withProfilePatch(exitPolicy: JsonRecord = {}): JsonRecord {
  return {
    ...RISK_CAP_PATCH,
    ...(Object.keys(exitPolicy).length ? { exitPolicy } : {}),
  };
}

export function buildVariants(): ExitPolicyVariant[] {
  return [
    {
      id: "baseline-current-exits",
      description: "Current exit policy, configured horizon, 5m, 10 symbols max, 5% premium cap.",
      profilePatch: withProfilePatch(),
    },
    {
      id: "hard-stop-25",
      description: "Tighter hard stop at -25%.",
      profilePatch: withProfilePatch({ hardStopPct: -25 }),
    },
    {
      id: "hard-stop-30",
      description: "Tighter hard stop at -30%.",
      profilePatch: withProfilePatch({ hardStopPct: -30 }),
    },
    {
      id: "hard-stop-35",
      description: "Tighter hard stop at -35%.",
      profilePatch: withProfilePatch({ hardStopPct: -35 }),
    },
    {
      id: "trail-30-15-20",
      description: "Earlier trail at +30%, lock +15%, give back 20%.",
      profilePatch: withProfilePatch({
        trailActivationPct: 30,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
      }),
    },
    {
      id: "trail-35-15-20",
      description: "Trail at +35%, lock +15%, give back 20%.",
      profilePatch: withProfilePatch({
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
      }),
    },
    {
      id: "early-3-bars-loss-15",
      description: "Exit if still down 15% after 3 signal bars.",
      profilePatch: withProfilePatch({
        earlyExitBars: 3,
        earlyExitLossPct: 15,
      }),
    },
    {
      id: "early-6-bars-loss-20",
      description: "Exit if still down 20% after 6 signal bars.",
      profilePatch: withProfilePatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
      }),
    },
    {
      id: "overnight-positive-only",
      description: "Do not hold overnight unless position is at least flat.",
      profilePatch: withProfilePatch({
        overnightExitEnabled: true,
        overnightMinGainPct: 0,
        overnightRunnerGivebackPct: 15,
      }),
    },
    {
      id: "overnight-gain-10",
      description: "Do not hold overnight unless mark is up at least 10%.",
      profilePatch: withProfilePatch({
        overnightExitEnabled: true,
        overnightMinGainPct: 10,
        overnightRunnerGivebackPct: 15,
      }),
    },
    {
      id: "overnight-gain-20",
      description: "Do not hold overnight unless mark is up at least 20%.",
      profilePatch: withProfilePatch({
        overnightExitEnabled: true,
        overnightMinGainPct: 20,
        overnightRunnerGivebackPct: 15,
      }),
    },
    {
      id: "combo-hard30-trail35-early6",
      description: "Hard stop -30%, trail 35/15/20, early loss exit after 6 bars.",
      profilePatch: withProfilePatch({
        hardStopPct: -30,
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
        earlyExitBars: 6,
        earlyExitLossPct: 20,
      }),
    },
    {
      id: "combo-hard30-overnight10",
      description: "Hard stop -30% with overnight +10% minimum hold rule.",
      profilePatch: withProfilePatch({
        hardStopPct: -30,
        overnightExitEnabled: true,
        overnightMinGainPct: 10,
        overnightRunnerGivebackPct: 15,
      }),
    },
    {
      id: "combo-trail35-overnight10",
      description: "Trail 35/15/20 with overnight +10% minimum hold rule.",
      profilePatch: withProfilePatch({
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
        overnightExitEnabled: true,
        overnightMinGainPct: 10,
        overnightRunnerGivebackPct: 15,
      }),
    },
    {
      id: "combo-hard30-trail35-overnight10-early6",
      description:
        "Hard stop -30%, trail 35/15/20, overnight +10%, early loss after 6 bars.",
      profilePatch: withProfilePatch({
        hardStopPct: -30,
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
        overnightExitEnabled: true,
        overnightMinGainPct: 10,
        overnightRunnerGivebackPct: 15,
        earlyExitBars: 6,
        earlyExitLossPct: 20,
      }),
    },
    {
      id: "creative-quality-conditional-v1",
      description:
        "Best h8 policy plus conditional exits: cut low-quality earlier, let high-quality runners breathe.",
      profilePatch: withProfilePatch({
        hardStopPct: -30,
        trailActivationPct: 35,
        minLockedGainPct: 15,
        trailGivebackPct: 20,
        overnightExitEnabled: true,
        overnightMinGainPct: 10,
        overnightRunnerGivebackPct: 15,
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        conditionalQualityExitsEnabled: true,
        lowQualityEarlyExitBars: 4,
        lowQualityEarlyExitLossPct: 15,
        highQualityEarlyExitBars: 8,
        highQualityEarlyExitLossPct: 25,
        weakLiquidityTrailGivebackPct: 15,
        strongLiquidityTrailGivebackPct: 25,
        highQualityOvernightMinGainPct: -100,
      }),
    },
  ];
}

export function buildRayReplicaSettingsPatch(config: Pick<SweepConfig, "timeHorizon">) {
  return {
    ...tunedSignalOptionsStrategySettings.rayReplicaSettings,
    timeHorizon: config.timeHorizon,
  };
}

function selectVariants(variants: ExitPolicyVariant[]): ExitPolicyVariant[] {
  const requested = process.env["SIGNAL_OPTIONS_EXIT_SWEEP_VARIANTS"]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!requested?.length) {
    return variants;
  }
  const requestedIds = new Set(requested);
  const selected = variants.filter((variant) => requestedIds.has(variant.id));
  const missing = requested.filter(
    (variantId) => !variants.some((variant) => variant.id === variantId),
  );
  if (missing.length) {
    throw new Error(`Unknown exit-policy variants: ${missing.join(", ")}`);
  }
  return selected;
}

function computeMaxRealizedDrawdown(closedTrades: readonly unknown[]): number {
  const pnlByDay = new Map<string, number>();
  for (const trade of closedTrades) {
    const record = asRecord(trade);
    const day = String(record["closedAt"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      continue;
    }
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

function computeMetrics(result: unknown): SweepMetrics {
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

function compareResults(left: SweepResult, right: SweepResult): number {
  return (
    right.metrics.riskAdjustedScore - left.metrics.riskAdjustedScore ||
    right.metrics.realizedPnl - left.metrics.realizedPnl ||
    right.metrics.profitFactor - left.metrics.profitFactor ||
    right.metrics.closedTrades - left.metrics.closedTrades ||
    left.metrics.openPositions - right.metrics.openPositions ||
    left.variant.id.localeCompare(right.variant.id)
  );
}

function rankResults(results: readonly SweepResult[]): SweepResult[] {
  return results
    .filter(
      (result) =>
        result.status === "succeeded" &&
        result.metrics.closedTrades >= MIN_CLOSED_TRADES,
    )
    .map((result) => ({ ...result, eligible: true, ineligibleReason: null }))
    .sort(compareResults);
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
          name = 'RayReplica Signal Options Shadow Paper'
          or config->'parameters'->>'executionMode' = 'signal_options'
        )
      order by
        case when name = 'RayReplica Signal Options Shadow Paper' then 0 else 1 end,
        updated_at desc
      limit 1
    `,
  );
  const deployment = result.rows[0];
  if (!deployment) {
    throw new Error("No enabled shadow signal-options deployment found.");
  }
  if (!Array.isArray(deployment.symbolUniverse) || deployment.symbolUniverse.length < 8) {
    throw new Error(
      `Deployment ${deployment.id} has ${deployment.symbolUniverse.length} symbols; expected at least 8.`,
    );
  }
  return deployment;
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

async function withVariantHeartbeat<T>(input: {
  variantId: string;
  config: SweepConfig;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  let warnedAboutTimeout = false;
  const heartbeat =
    input.config.heartbeatMs > 0
      ? setInterval(() => {
          const elapsedMs = Date.now() - startedAt;
          const timeoutExceeded =
            input.config.variantTimeoutMs > 0 &&
            elapsedMs >= input.config.variantTimeoutMs;
          if (timeoutExceeded && !warnedAboutTimeout) {
            warnedAboutTimeout = true;
            console.warn(
              JSON.stringify({
                variant: input.variantId,
                status: "timeout_threshold_exceeded",
                elapsedMs,
                variantTimeoutMs: input.config.variantTimeoutMs,
              }),
            );
          } else {
            console.log(
              JSON.stringify({
                variant: input.variantId,
                status: "running",
                elapsedMs,
              }),
            );
          }
        }, input.config.heartbeatMs)
      : null;
  heartbeat?.unref?.();
  try {
    return await input.run();
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

async function runVariant(input: {
  deployment: DeploymentRow;
  variant: ExitPolicyVariant;
  config: SweepConfig;
}): Promise<SweepResult> {
  const started = new Date();
  try {
    const rayReplicaSettingsPatch = buildRayReplicaSettingsPatch(input.config);
    const result = await withVariantHeartbeat({
      variantId: input.variant.id,
      config: input.config,
      run: () =>
        runSignalOptionsShadowBackfill({
          deploymentId: input.deployment.id,
          start: input.config.start,
          end: input.config.end,
          session: input.config.session,
          commit: false,
          replay: false,
          replaceReplayRows: false,
          forceDeploymentUniverse: true,
          symbolUniverseOverride: input.deployment.symbolUniverse.map((symbol) =>
            String(symbol).toUpperCase(),
          ),
          signalTimeframe: input.config.signalTimeframe,
          rayReplicaSettingsPatch,
          profilePatch: input.variant.profilePatch,
          progress: true,
        }),
    });
    const finished = new Date();
    const metrics = computeMetrics(result);
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
      metrics,
      window: asRecord(result.window),
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
      metrics: emptyMetrics(),
      window: null,
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
    status: result.status,
    eligible: result.eligible,
    ineligibleReason: result.ineligibleReason ?? "",
    description: result.variant.description,
    profilePatch: JSON.stringify(result.variant.profilePatch),
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
    exitReasons: JSON.stringify(result.summary?.["exitReasons"] ?? {}),
    skippedReasons: JSON.stringify(result.summary?.["skippedReasons"] ?? {}),
    durationMs: result.durationMs,
    error: result.error ?? "",
  }));
}

async function writeReports(input: {
  reportDir: string;
  deployment: DeploymentRow;
  config: SweepConfig;
  results: SweepResult[];
  ranked: SweepResult[];
}) {
  await mkdir(input.reportDir, { recursive: true });
  const rows = reportRows(input.results);
  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(","),
    ...rows.map((row) => {
      const record = row as Record<string, unknown>;
      return headers.map((header) => csvValue(record[header])).join(",");
    }),
  ].join("\n");
  const markdown = [
    "# Signal Options Exit Policy Sweep",
    "",
    `- Deployment: ${input.deployment.name} (${input.deployment.id})`,
    `- Symbols: ${input.deployment.symbolUniverse.length}`,
    `- Window: ${input.config.start} through ${input.config.end ?? "latest completed trading day"}`,
    `- Signal timeframe: ${input.config.signalTimeframe}`,
    `- RayReplica patch: \`${JSON.stringify(buildRayReplicaSettingsPatch(input.config))}\``,
    `- Risk caps: \`${JSON.stringify(RISK_CAP_PATCH.riskCaps)}\``,
    `- Premium-bucket variants: excluded`,
    `- Dry variants: ${input.results.length}`,
    `- Eligible variants: ${input.ranked.length}`,
    "",
    "| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open | Exit Reasons |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...input.ranked.map((result, index) =>
      [
        index + 1,
        result.variant.id,
        result.metrics.realizedPnl.toFixed(2),
        result.metrics.riskAdjustedScore.toFixed(6),
        result.metrics.closedTrades,
        (result.metrics.winRate * 100).toFixed(1),
        Number.isFinite(result.metrics.profitFactor)
          ? result.metrics.profitFactor.toFixed(3)
          : "Infinity",
        result.metrics.maxDrawdownAbs.toFixed(2),
        result.metrics.openPositions,
        `\`${JSON.stringify(result.summary?.["exitReasons"] ?? {})}\``,
      ].join(" | "),
    ),
  ].join("\n");

  await writeFile(path.join(input.reportDir, "results.json"), `${JSON.stringify(input, null, 2)}\n`);
  await writeFile(path.join(input.reportDir, "results.csv"), `${csv}\n`);
  await writeFile(path.join(input.reportDir, "report.md"), `${markdown}\n`);
}

async function main() {
  const config = readSweepConfig();
  const releaseLock = await acquireSignalOptionsWorkerLock(config.lockWaitMs);
  if (!releaseLock) {
    throw new Error("Signal-options worker advisory lock is already held.");
  }

  try {
    const deployment = await readSignalOptionsDeployment();
    if (config.symbols.length) {
      const requested = new Set(config.symbols);
      deployment.symbolUniverse = deployment.symbolUniverse.filter((symbol) =>
        requested.has(String(symbol).toUpperCase()),
      );
      if (!deployment.symbolUniverse.length) {
        throw new Error(
          `No deployment symbols matched SIGNAL_OPTIONS_EXIT_SWEEP_SYMBOLS=${config.symbols.join(",")}`,
        );
      }
    }
    const variants = selectVariants(buildVariants());
    const results: SweepResult[] = [];
    console.log(
      JSON.stringify({
        deployment: {
          id: deployment.id,
          name: deployment.name,
          symbolCount: deployment.symbolUniverse.length,
        },
        config,
        variants: variants.length,
        rayReplicaSettingsPatch: buildRayReplicaSettingsPatch(config),
        riskCaps: RISK_CAP_PATCH.riskCaps,
      }),
    );

    for (const variant of variants) {
      console.log(`dry-run ${variant.id}`);
      const result = await runVariant({ deployment, variant, config });
      results.push(result);
      console.log(
        JSON.stringify({
          variant: variant.id,
          status: result.status,
          metrics: result.metrics,
          exitReasons: result.summary?.["exitReasons"] ?? {},
          error: result.error,
        }),
      );
    }

    const ranked = rankResults(results);
    await writeReports({
      reportDir: config.reportDir,
      deployment,
      config,
      results,
      ranked,
    });

    console.log(
      JSON.stringify(
        {
          reportDir: config.reportDir,
          dryVariants: results.length,
          eligibleVariants: ranked.length,
          winner: ranked[0]?.variant.id ?? null,
          winnerMetrics: ranked[0]?.metrics ?? null,
        },
        null,
        2,
      ),
    );
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
