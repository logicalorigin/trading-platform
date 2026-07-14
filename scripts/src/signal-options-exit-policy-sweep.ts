import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
  aggressiveSignalOptionsProgressiveTrailSteps,
  signalOptionsDefaultWireTrailRungs,
  tunedSignalOptionsStrategySettings,
} from "@workspace/backtest-core";
import {
  closeDatabaseConnections,
  pool,
  sharedAdvisoryLockHolder,
} from "@workspace/db";
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
  mode: "shadow";
  symbolUniverse: string[];
};

type RawDeploymentRow = Omit<DeploymentRow, "mode" | "symbolUniverse"> & {
  mode: "shadow" | "live";
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
  replayWinner: boolean;
  replayVariant: string | null;
  variantIds: string[];
  families: string[];
  maxPremiumPerEntry: number;
  wireGreekTrailMaxAgeMs: number;
};

type VariantBackfillInput = Parameters<
  typeof runSignalOptionsShadowBackfill
>[0];

const MIN_CLOSED_TRADES = 20;
const ACCOUNT_SIZE = 30_000;
const DEFAULT_VARIANT_HEARTBEAT_MS = 60_000;
const DEFAULT_VARIANT_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_WIRE_GREEK_TRAIL_MAX_AGE_MS = 45_000;
const DEFAULT_MAX_PREMIUM_PER_ENTRY = ACCOUNT_SIZE * 0.05;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
// ponytail: human-facing diagnostics stop at 400 characters; move full sanitized
// detail into a separate structured artifact if operators need deeper failures.
const MAX_DIAGNOSTIC_LENGTH = 400;
const USAGE =
  "Usage: pnpm --filter @workspace/scripts run signal-options:exit-policy-sweep (configure with SIGNAL_OPTIONS_EXIT_SWEEP_* env vars)";
const SIGNAL_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;
const EXIT_POLICY_FAMILIES = [
  "core",
  "early-grid",
  "trail-grid",
  "wire-trail",
  "control",
  "all",
] as const;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const UNSAFE_JSON_OUTPUT_PATTERN =
  /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const RISK_CAP_PATCH = {
  riskCaps: {
    maxOpenSymbols: 10,
    maxPremiumPerEntry: DEFAULT_MAX_PREMIUM_PER_ENTRY,
  },
};
const WINNING_COMBO_EXIT_POLICY = {
  hardStopPct: -30,
  trailActivationPct: 35,
  minLockedGainPct: 15,
  trailGivebackPct: 20,
  overnightExitEnabled: true,
  overnightMinGainPct: 10,
  overnightRunnerGivebackPct: 15,
} as const;
const EARLY_INVALIDATION_BAR_GRID = [2, 3, 4, 5, 6, 8, 10, 12] as const;
const EARLY_INVALIDATION_LOSS_GRID = [
  12.5, 15, 17.5, 20, 22.5, 25, 30,
] as const;
const WIRE_GREEK_TRAIL_POLICY_PATCH = {
  enabled: true,
  requireFreshGreeks: true,
  greekMaxAgeMs: DEFAULT_WIRE_GREEK_TRAIL_MAX_AGE_MS,
  deltaSizingEnabled: false,
  runnerPollIntervalSeconds: 20,
  rungByProfit: [...signalOptionsDefaultWireTrailRungs],
  deltaLoosenThreshold: 0.05,
  deltaTightenThreshold: -0.1,
  thetaBurdenTightenPct: 8,
  strongGammaMin: 0.05,
  spreadWideningMultiplier: 1.5,
} as const;
const WIRE_GREEK_TRAIL_DISABLED_POLICY_PATCH = {
  ...WIRE_GREEK_TRAIL_POLICY_PATCH,
  enabled: false,
} as const;

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

function nonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function readIntegerEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = nonEmptyEnv(env, name);
  if (!raw) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) {
    throw new Error(`${name} must be a non-negative integer at most ${max}.`);
  }
  return value;
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

function readBoundedIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
  env: NodeJS.ProcessEnv,
): number {
  const value = readIntegerEnv(name, fallback, env, max);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function parseSweepArgs(args = process.argv.slice(2)): void {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length > 0) {
    throw new Error(USAGE);
  }
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

function csvEnvValues(
  env: NodeJS.ProcessEnv,
  name: string,
  uppercase = false,
): string[] {
  const raw = nonEmptyEnv(env, name);
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (uppercase ? value.toUpperCase() : value)),
    ),
  );
}

function enableHistoricalBarEvaluation(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const primaryName = "PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
  const aliasName = "SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
  const primary = nonEmptyEnv(env, primaryName)
    ? readBooleanEnv(primaryName, false, env)
    : undefined;
  const alias = nonEmptyEnv(env, aliasName)
    ? readBooleanEnv(aliasName, false, env)
    : undefined;
  if (primary !== undefined && alias !== undefined && primary !== alias) {
    throw new Error(`Conflicting ${primaryName} and ${aliasName} values.`);
  }
  env[primaryName] = (primary ?? alias ?? true) ? "1" : "0";
}

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readSweepConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): SweepConfig {
  const reportRoot =
    nonEmptyEnv(env, "SIGNAL_OPTIONS_EXIT_SWEEP_REPORT_DIR") ??
    path.join("reports", "signal-options-exit-policy-sweeps", slug());
  const start =
    canonicalDate(
      "SIGNAL_OPTIONS_EXIT_SWEEP_START",
      nonEmptyEnv(env, "SIGNAL_OPTIONS_EXIT_SWEEP_START"),
    ) ?? "2026-04-01";
  const end = canonicalDate(
    "SIGNAL_OPTIONS_EXIT_SWEEP_END",
    nonEmptyEnv(env, "SIGNAL_OPTIONS_EXIT_SWEEP_END"),
  );
  if (end && start > end) {
    throw new Error("Sweep start must be on or before end.");
  }
  const signalTimeframe =
    nonEmptyEnv(env, "SIGNAL_OPTIONS_EXIT_SWEEP_TIMEFRAME") ??
    tunedSignalOptionsStrategySettings.signalTimeframe;
  if (
    !SIGNAL_TIMEFRAMES.includes(
      signalTimeframe as (typeof SIGNAL_TIMEFRAMES)[number],
    )
  ) {
    throw new Error(
      `SIGNAL_OPTIONS_EXIT_SWEEP_TIMEFRAME must be one of ${SIGNAL_TIMEFRAMES.join(", ")}.`,
    );
  }
  const session =
    nonEmptyEnv(env, "SIGNAL_OPTIONS_EXIT_SWEEP_SESSION") ?? "regular";
  if (session !== "regular" && session !== "all") {
    throw new Error(
      "SIGNAL_OPTIONS_EXIT_SWEEP_SESSION must be regular or all.",
    );
  }
  const replayWinner = readBooleanEnv(
    "SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_WINNER",
    false,
    env,
  );
  const replayVariant =
    nonEmptyEnv(env, "SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_VARIANT") ?? null;
  if (replayVariant && !replayWinner) {
    throw new Error(
      "SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_VARIANT requires SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_WINNER=true.",
    );
  }
  const variantIds = csvEnvValues(env, "SIGNAL_OPTIONS_EXIT_SWEEP_VARIANTS");
  const explicitFamilies = csvEnvValues(
    env,
    "SIGNAL_OPTIONS_EXIT_SWEEP_FAMILIES",
  );
  if (variantIds.length > 0 && explicitFamilies.length > 0) {
    throw new Error(
      "SIGNAL_OPTIONS_EXIT_SWEEP_VARIANTS and SIGNAL_OPTIONS_EXIT_SWEEP_FAMILIES cannot both be set.",
    );
  }
  return {
    start,
    ...(end ? { end } : {}),
    signalTimeframe,
    session,
    reportDir: path.resolve(cwd, reportRoot),
    lockWaitMs: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_LOCK_WAIT_MS",
      0,
      env,
      MAX_TIMER_DELAY_MS,
    ),
    heartbeatMs: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_HEARTBEAT_MS",
      DEFAULT_VARIANT_HEARTBEAT_MS,
      env,
      MAX_TIMER_DELAY_MS,
    ),
    variantTimeoutMs: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_VARIANT_TIMEOUT_MS",
      DEFAULT_VARIANT_TIMEOUT_MS,
      env,
      MAX_TIMER_DELAY_MS,
    ),
    timeHorizon: readBoundedIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_HORIZON",
      tunedSignalOptionsStrategySettings.pyrusSignalsSettings.timeHorizon,
      2,
      50,
      env,
    ),
    symbols: csvEnvValues(env, "SIGNAL_OPTIONS_EXIT_SWEEP_SYMBOLS", true),
    replayWinner,
    replayVariant,
    variantIds,
    families:
      variantIds.length > 0
        ? []
        : explicitFamilies.length
          ? explicitFamilies
          : ["core"],
    maxPremiumPerEntry: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_MAX_PREMIUM_PER_ENTRY",
      DEFAULT_MAX_PREMIUM_PER_ENTRY,
      env,
    ),
    wireGreekTrailMaxAgeMs: readIntegerEnv(
      "SIGNAL_OPTIONS_EXIT_SWEEP_GREEK_MAX_AGE_MS",
      DEFAULT_WIRE_GREEK_TRAIL_MAX_AGE_MS,
      env,
      MAX_TIMER_DELAY_MS,
    ),
  };
}

function withProfilePatch(exitPolicy: JsonRecord = {}): JsonRecord {
  return {
    ...RISK_CAP_PATCH,
    ...(Object.keys(exitPolicy).length ? { exitPolicy } : {}),
  };
}

function variantNumber(value: number) {
  return String(value).replace(".", "p");
}

function withWinningComboPatch(exitPolicy: JsonRecord = {}) {
  return withProfilePatch({
    ...WINNING_COMBO_EXIT_POLICY,
    ...exitPolicy,
  });
}

export function buildVariants(): ExitPolicyVariant[] {
  return [
    {
      id: "baseline-current-exits",
      description:
        "Current exit policy, configured horizon, 5m, 10 symbols max, 5% premium cap.",
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
      description:
        "Hard stop -30%, trail 35/15/20, early loss exit after 6 bars.",
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
        "Hard stop -30%, trail 35/15/20 with 5x/10x tightening, overnight +10%, early loss after 6 bars.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
      }),
    },
    {
      id: "creative-quality-conditional-v1",
      description:
        "Best h8 policy plus conditional exits: cut low-quality earlier, let high-quality runners breathe.",
      profilePatch: withWinningComboPatch({
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

export function buildEarlyInvalidationGridVariants(): ExitPolicyVariant[] {
  const variants: ExitPolicyVariant[] = [
    {
      id: "early-grid-disabled",
      description: "Winning combo with early invalidation disabled.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 0,
        earlyExitLossPct: 0,
      }),
    },
  ];

  for (const bars of EARLY_INVALIDATION_BAR_GRID) {
    for (const lossPct of EARLY_INVALIDATION_LOSS_GRID) {
      variants.push({
        id: `early-grid-b${bars}-loss${variantNumber(lossPct)}`,
        description: `Winning combo, early invalidation after ${bars} bars at -${lossPct}%.`,
        profilePatch: withWinningComboPatch({
          earlyExitBars: bars,
          earlyExitLossPct: lossPct,
        }),
      });
    }
  }

  return variants;
}

export function buildProgressiveTrailVariants(): ExitPolicyVariant[] {
  return [
    {
      id: "trail-ladder-soft",
      description:
        "Winning combo with progressive trail: flat at +25%, then slower profit locks.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 25, minLockedGainPct: 0, givebackPct: 40 },
          { activationPct: 35, minLockedGainPct: 10, givebackPct: 30 },
          { activationPct: 50, minLockedGainPct: 20, givebackPct: 30 },
          { activationPct: 75, minLockedGainPct: 30, givebackPct: 25 },
          { activationPct: 100, minLockedGainPct: 45, givebackPct: 25 },
        ],
      }),
    },
    {
      id: "trail-ladder-balanced",
      description:
        "Winning combo with progressive trail: lower activation and steadily rising locks.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 25, minLockedGainPct: 0, givebackPct: 35 },
          { activationPct: 35, minLockedGainPct: 15, givebackPct: 25 },
          { activationPct: 50, minLockedGainPct: 25, givebackPct: 25 },
          { activationPct: 75, minLockedGainPct: 35, givebackPct: 20 },
          { activationPct: 100, minLockedGainPct: 50, givebackPct: 20 },
        ],
      }),
    },
    {
      id: "trail-ladder-balanced-early8-loss25",
      description:
        "Balanced progressive trail with looser early invalidation after 8 bars at -25%.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 8,
        earlyExitLossPct: 25,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 25, minLockedGainPct: 0, givebackPct: 35 },
          { activationPct: 35, minLockedGainPct: 15, givebackPct: 25 },
          { activationPct: 50, minLockedGainPct: 25, givebackPct: 25 },
          { activationPct: 75, minLockedGainPct: 35, givebackPct: 20 },
          { activationPct: 100, minLockedGainPct: 50, givebackPct: 20 },
        ],
      }),
    },
    {
      id: "trail-ladder-aggressive",
      description:
        "Winning combo with progressive trail: early activation and faster profit locks.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
          { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
          { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
          { activationPct: 65, minLockedGainPct: 40, givebackPct: 20 },
          { activationPct: 100, minLockedGainPct: 60, givebackPct: 15 },
        ],
      }),
    },
    {
      id: "trail-ladder-aggressive-early8-loss25",
      description:
        "Aggressive progressive trail with looser early invalidation after 8 bars at -25%.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 8,
        earlyExitLossPct: 25,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
          { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
          { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
          { activationPct: 65, minLockedGainPct: 40, givebackPct: 20 },
          { activationPct: 100, minLockedGainPct: 60, givebackPct: 15 },
        ],
      }),
    },
    {
      id: "trail-ladder-runner-friendly",
      description:
        "Winning combo with progressive trail: earlier flat protection while leaving sub-5x runners wider.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 25, minLockedGainPct: 0, givebackPct: 45 },
          { activationPct: 40, minLockedGainPct: 10, givebackPct: 35 },
          { activationPct: 75, minLockedGainPct: 25, givebackPct: 30 },
          { activationPct: 150, minLockedGainPct: 60, givebackPct: 25 },
        ],
      }),
    },
  ];
}

export function buildWireTrailVariants(): ExitPolicyVariant[] {
  return [
    {
      id: "wire-trail-fixed-floor-early8-loss25",
      description:
        "Winning combo with wire/Greek structure exits, fixed premium trail, and looser early invalidation.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 8,
        earlyExitLossPct: 25,
        progressiveTrailEnabled: false,
        progressiveTrailSteps: [],
        wireGreekTrail: WIRE_GREEK_TRAIL_POLICY_PATCH,
      }),
    },
    {
      id: "wire-trail-aggressive-ladder",
      description:
        "Aggressive progressive trail plus wire/Greek structure exits with conservative Greek handling.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 6,
        earlyExitLossPct: 20,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: aggressiveSignalOptionsProgressiveTrailSteps,
        wireGreekTrail: WIRE_GREEK_TRAIL_POLICY_PATCH,
      }),
    },
    {
      id: "wire-trail-aggressive-ladder-early8-loss25",
      description:
        "Recovered top aggressive ladder with wire/Greek structure exits and looser early invalidation.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 8,
        earlyExitLossPct: 25,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: aggressiveSignalOptionsProgressiveTrailSteps,
        wireGreekTrail: WIRE_GREEK_TRAIL_POLICY_PATCH,
      }),
    },
  ];
}

export function buildControlVariants(): ExitPolicyVariant[] {
  return [
    {
      id: "control-fixed-floor-early8-loss25",
      description:
        "Winning combo with fixed premium trail, looser early invalidation, and wire trail explicitly disabled.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 8,
        earlyExitLossPct: 25,
        progressiveTrailEnabled: false,
        progressiveTrailSteps: [],
        wireGreekTrail: WIRE_GREEK_TRAIL_DISABLED_POLICY_PATCH,
      }),
    },
    {
      id: "control-aggressive-ladder-early8-loss25",
      description:
        "Recovered top aggressive ladder with looser early invalidation and wire trail explicitly disabled.",
      profilePatch: withWinningComboPatch({
        earlyExitBars: 8,
        earlyExitLossPct: 25,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: aggressiveSignalOptionsProgressiveTrailSteps,
        wireGreekTrail: WIRE_GREEK_TRAIL_DISABLED_POLICY_PATCH,
      }),
    },
  ];
}

export function buildPyrusSignalsSettingsPatch(
  config: Pick<SweepConfig, "timeHorizon">,
) {
  return {
    ...tunedSignalOptionsStrategySettings.pyrusSignalsSettings,
    timeHorizon: config.timeHorizon,
  };
}

function buildVariantUniverse() {
  return [
    ...buildVariants(),
    ...buildEarlyInvalidationGridVariants(),
    ...buildProgressiveTrailVariants(),
    ...buildWireTrailVariants(),
    ...buildControlVariants(),
  ];
}

function selectVariants(
  variants: ExitPolicyVariant[],
  config: Pick<SweepConfig, "variantIds" | "families" | "replayVariant">,
): ExitPolicyVariant[] {
  let selected: ExitPolicyVariant[];
  if (config.variantIds.length > 0) {
    const requestedIds = new Set(config.variantIds);
    const selectedVariants = variants.filter((variant) =>
      requestedIds.has(variant.id),
    );
    const missing = config.variantIds.filter(
      (variantId) => !variants.some((variant) => variant.id === variantId),
    );
    if (missing.length) {
      throw new Error(`Unknown exit-policy variants: ${missing.join(", ")}`);
    }
    selected = selectedVariants;
  } else {
    const unknownFamilies = config.families.filter(
      (family) =>
        !EXIT_POLICY_FAMILIES.includes(
          family as (typeof EXIT_POLICY_FAMILIES)[number],
        ),
    );
    if (unknownFamilies.length > 0) {
      throw new Error(
        `Unknown exit-policy families: ${unknownFamilies.join(", ")}`,
      );
    }
    if (config.families.includes("all")) {
      selected = variants;
    } else {
      const selectedFamilies = new Set(config.families);
      selected = variants.filter((variant) => {
        if (variant.id.startsWith("early-grid-")) {
          return selectedFamilies.has("early-grid");
        }
        if (variant.id.startsWith("trail-ladder-")) {
          return selectedFamilies.has("trail-grid");
        }
        if (variant.id.startsWith("wire-trail-")) {
          return selectedFamilies.has("wire-trail");
        }
        if (variant.id.startsWith("control-")) {
          return selectedFamilies.has("control");
        }
        return selectedFamilies.has("core");
      });
    }
  }
  if (selected.length === 0) {
    throw new Error("Exit-policy selection resolved to zero variants.");
  }
  if (
    config.replayVariant &&
    !selected.some((variant) => variant.id === config.replayVariant)
  ) {
    throw new Error(
      `Replay variant ${config.replayVariant} is not in the selected sweep variants.`,
    );
  }
  return selected;
}

function resolveVariantForConfig(
  variant: ExitPolicyVariant,
  config: Pick<SweepConfig, "maxPremiumPerEntry" | "wireGreekTrailMaxAgeMs">,
): ExitPolicyVariant {
  const profilePatch = asRecord(variant.profilePatch);
  const exitPolicy = asRecord(profilePatch["exitPolicy"]);
  const wireGreekTrail = asRecord(exitPolicy["wireGreekTrail"]);
  const hasWireGreekTrail = Object.keys(wireGreekTrail).length > 0;
  return {
    ...variant,
    profilePatch: {
      ...profilePatch,
      riskCaps: {
        ...asRecord(profilePatch["riskCaps"]),
        maxPremiumPerEntry: config.maxPremiumPerEntry,
      },
      ...(hasWireGreekTrail
        ? {
            exitPolicy: {
              ...exitPolicy,
              wireGreekTrail: {
                ...wireGreekTrail,
                greekMaxAgeMs: config.wireGreekTrailMaxAgeMs,
              },
            },
          }
        : {}),
    },
  };
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

function computeMaxRealizedDrawdown(
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

function computeMetrics(result: unknown): SweepMetrics {
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
  const maxDrawdownAbs = computeMaxRealizedDrawdown(closedTrades);
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

function validateSweepDeployment(deployment: RawDeploymentRow): DeploymentRow {
  if (deployment.mode !== "shadow") {
    throw new Error(`Deployment ${deployment.id} must be shadow, not live.`);
  }
  const symbolUniverse = Array.from(
    new Set(
      (Array.isArray(deployment.symbolUniverse)
        ? deployment.symbolUniverse
        : []
      )
        .filter((symbol): symbol is string => typeof symbol === "string")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (symbolUniverse.length < 8) {
    throw new Error(
      `Deployment ${deployment.id} has ${symbolUniverse.length} valid symbols; expected at least 8.`,
    );
  }
  return { ...deployment, mode: "shadow", symbolUniverse };
}

async function readSignalOptionsDeployment(): Promise<DeploymentRow> {
  const result = await pool.query<RawDeploymentRow>(
    `
      select id, name, mode, symbol_universe as "symbolUniverse"
      from algo_deployments
      where enabled = true
        and mode = 'shadow'
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
  if (!deployment) {
    throw new Error("No enabled shadow signal-options deployment found.");
  }
  return validateSweepDeployment(deployment);
}

async function acquireSignalOptionsWorkerLock(waitMs: number) {
  const deadline = Date.now() + waitMs;
  let release = await sharedAdvisoryLockHolder.acquire(
    SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
  );
  while (!release && Date.now() < deadline) {
    console.log("waiting for signal-options worker advisory lock");
    await delay(Math.min(5_000, Math.max(0, deadline - Date.now())));
    release = await sharedAdvisoryLockHolder.acquire(
      SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
    );
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
              jsonText({
                variant: input.variantId,
                status: "timeout_threshold_exceeded",
                elapsedMs,
                variantTimeoutMs: input.config.variantTimeoutMs,
              }),
            );
          } else if (!timeoutExceeded) {
            console.log(
              jsonText({
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

function sanitizeBackfillSummary(value: unknown): JsonRecord {
  const summary = asRecord(value);
  const errors = asArray(summary["errors"]).map((error) => {
    const record = asRecord(error);
    return {
      ...(typeof record["symbol"] === "string"
        ? { symbol: record["symbol"] }
        : {}),
      message: safeDiagnostic(record["message"] ?? "Backfill error"),
    };
  });
  return {
    ...summary,
    ...(Object.hasOwn(summary, "errors") ? { errors } : {}),
  };
}

async function runVariant(input: {
  deployment: DeploymentRow;
  variant: ExitPolicyVariant;
  config: SweepConfig;
  commit?: boolean;
  replay?: boolean;
}): Promise<SweepResult> {
  const started = new Date();
  try {
    const backfillInput = buildVariantBackfillInput(input);
    const result = await withVariantHeartbeat({
      variantId: input.variant.id,
      config: input.config,
      run: () => runSignalOptionsShadowBackfill(backfillInput),
    });
    const finished = new Date();
    const metrics = computeMetrics(result);
    const summary = sanitizeBackfillSummary(result.summary);
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
      summary,
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
      error: safeDiagnostic(error),
    };
  }
}

export function buildVariantBackfillInput(input: {
  deployment: Pick<DeploymentRow, "id" | "name" | "symbolUniverse">;
  variant: ExitPolicyVariant;
  config: Pick<
    SweepConfig,
    "start" | "end" | "session" | "signalTimeframe" | "timeHorizon"
  >;
  commit?: boolean;
  replay?: boolean;
  replayRunSlug?: string;
}): VariantBackfillInput {
  const replay = input.replay
    ? {
        runId: `signal-options-exit-sweep-${input.replayRunSlug ?? slug()}-${input.variant.id}`,
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
    commit: input.commit === true,
    replay,
    replaceReplayRows: Boolean(replay),
    forceDeploymentUniverse: true,
    symbolUniverseOverride: input.deployment.symbolUniverse.map((symbol) =>
      String(symbol).toUpperCase(),
    ),
    signalTimeframe: input.config.signalTimeframe,
    pyrusSignalsSettingsPatch: buildPyrusSignalsSettingsPatch(input.config),
    profilePatch: input.variant.profilePatch,
    progress: true,
    // Backtest replay: gate entries on bar-derived MTF directions from each
    // candidate's historical filterState rather than the live signal-matrix,
    // which has no coverage for historical windows. Without this every replayed
    // entry is rejected as mtf_not_aligned. See runSignalOptionsShadowBackfill.
    useBarDerivedMtf: true,
  };
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

function earlyInvalidationOutcomeStats(summary: JsonRecord | null) {
  const earlyTrades = asArray(asRecord(summary)["closedTrades"]).filter(
    (trade) => asRecord(trade)["reason"] === "early_invalidation",
  );
  let recoveredEntry = 0;
  let reachedTwentyFivePctGain = 0;
  let reachedFiftyPctGain = 0;
  let finalAboveExit = 0;
  let finalAboveEntry = 0;
  let sparseOutcomeBars = 0;

  for (const trade of earlyTrades) {
    const outcome = asRecord(asRecord(trade)["postExitOutcome"]);
    if (outcome["recoveredEntry"] === true) recoveredEntry += 1;
    if (outcome["reachedTwentyFivePctGain"] === true)
      reachedTwentyFivePctGain += 1;
    if (outcome["reachedFiftyPctGain"] === true) reachedFiftyPctGain += 1;
    if (outcome["finalAboveExit"] === true) finalAboveExit += 1;
    if (outcome["finalAboveEntry"] === true) finalAboveEntry += 1;
    if ((finiteNumber(outcome["bars"]) ?? 0) < 5) sparseOutcomeBars += 1;
  }

  return {
    earlyInvalidations: earlyTrades.length,
    earlyRecoveredEntry: recoveredEntry,
    earlyReached25Gain: reachedTwentyFivePctGain,
    earlyReached50Gain: reachedFiftyPctGain,
    earlyFinalAboveExit: finalAboveExit,
    earlyFinalAboveEntry: finalAboveEntry,
    earlySparseOutcomeBars: sparseOutcomeBars,
  };
}

function countByKey(record: Record<string, number>, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  record[value] = (record[value] ?? 0) + 1;
}

export function wireTrailOutcomeStats(summary: JsonRecord | null) {
  const closedTrades = asArray(asRecord(summary)["closedTrades"]);
  const baselineRungs = Object.create(null) as Record<string, number>;
  const selectedRungs = Object.create(null) as Record<string, number>;
  const greekFallbackReasons = Object.create(null) as Record<string, number>;
  const greekAdjustmentReasons = Object.create(null) as Record<string, number>;
  let snapshots = 0;
  let enabled = 0;
  let active = 0;
  let structureBreaks = 0;
  let structureBreakExits = 0;
  let regimeFlipAgainstPosition = 0;
  let greekFresh = 0;
  let greekUnavailable = 0;
  let deltaSizedGiveback = 0;

  for (const trade of closedTrades) {
    const record = asRecord(trade);
    if (record["reason"] === "wire_structure_break") {
      structureBreakExits += 1;
    }
    const wireTrail = asRecord(record["wireTrail"]);
    if (!Object.keys(wireTrail).length) {
      continue;
    }

    snapshots += 1;
    if (wireTrail["enabled"] === true) enabled += 1;
    if (wireTrail["active"] === true) active += 1;
    if (wireTrail["structureBreak"] === true) structureBreaks += 1;
    if (wireTrail["regimeFlipAgainstPosition"] === true) {
      regimeFlipAgainstPosition += 1;
    }
    if (wireTrail["greekFresh"] === true) {
      greekFresh += 1;
    } else if (wireTrail["greekFresh"] === false) {
      greekUnavailable += 1;
    }
    if (finiteNumber(wireTrail["deltaSizedGiveback"]) != null) {
      deltaSizedGiveback += 1;
    }
    countByKey(baselineRungs, wireTrail["baselineRung"]);
    countByKey(selectedRungs, wireTrail["selectedRung"]);
    countByKey(greekFallbackReasons, wireTrail["greekFallbackReason"]);

    const greekAdjustment = asRecord(wireTrail["greekAdjustment"]);
    for (const reason of asArray(greekAdjustment["reasons"])) {
      countByKey(greekAdjustmentReasons, reason);
    }
  }

  return {
    wireTrailSnapshots: snapshots,
    wireTrailEnabled: enabled,
    wireTrailActive: active,
    wireStructureBreaks: structureBreaks,
    wireStructureBreakExits: structureBreakExits,
    wireRegimeFlipAgainstPosition: regimeFlipAgainstPosition,
    wireGreekFresh: greekFresh,
    wireGreekUnavailable: greekUnavailable,
    wireDeltaSizedGiveback: deltaSizedGiveback,
    wireBaselineRungs: baselineRungs,
    wireSelectedRungs: selectedRungs,
    wireGreekFallbackReasons: greekFallbackReasons,
    wireGreekAdjustmentReasons: greekAdjustmentReasons,
  };
}

function reportRows(results: readonly SweepResult[]) {
  return results.map((result) => {
    const earlyStats = earlyInvalidationOutcomeStats(result.summary);
    const wireStats = wireTrailOutcomeStats(result.summary);
    return {
      variantId: result.variant.id,
      status: result.status,
      eligible: result.eligible,
      ineligibleReason: result.ineligibleReason ?? "",
      description: result.variant.description,
      profilePatch: jsonText(result.variant.profilePatch),
      realizedPnl: result.metrics.realizedPnl,
      winRate: result.metrics.winRate,
      profitFactor: result.metrics.profitFactor,
      closedTrades: result.metrics.closedTrades,
      maxDrawdownAbs: result.metrics.maxDrawdownAbs,
      openPositions: result.metrics.openPositions,
      riskAdjustedScore: result.metrics.riskAdjustedScore,
      earlyInvalidations: earlyStats.earlyInvalidations,
      earlyRecoveredEntry: earlyStats.earlyRecoveredEntry,
      earlyReached25Gain: earlyStats.earlyReached25Gain,
      earlyReached50Gain: earlyStats.earlyReached50Gain,
      earlyFinalAboveExit: earlyStats.earlyFinalAboveExit,
      earlyFinalAboveEntry: earlyStats.earlyFinalAboveEntry,
      earlySparseOutcomeBars: earlyStats.earlySparseOutcomeBars,
      wireTrailSnapshots: wireStats.wireTrailSnapshots,
      wireTrailEnabled: wireStats.wireTrailEnabled,
      wireTrailActive: wireStats.wireTrailActive,
      wireStructureBreaks: wireStats.wireStructureBreaks,
      wireStructureBreakExits: wireStats.wireStructureBreakExits,
      wireRegimeFlipAgainstPosition: wireStats.wireRegimeFlipAgainstPosition,
      wireGreekFresh: wireStats.wireGreekFresh,
      wireGreekUnavailable: wireStats.wireGreekUnavailable,
      wireDeltaSizedGiveback: wireStats.wireDeltaSizedGiveback,
      wireBaselineRungs: jsonText(wireStats.wireBaselineRungs),
      wireSelectedRungs: jsonText(wireStats.wireSelectedRungs),
      wireGreekFallbackReasons: jsonText(wireStats.wireGreekFallbackReasons),
      wireGreekAdjustmentReasons: jsonText(
        wireStats.wireGreekAdjustmentReasons,
      ),
      symbolsEvaluated:
        finiteNumber(result.summary?.["symbolsEvaluated"]) ?? "",
      signalsEvaluated:
        finiteNumber(result.summary?.["signalsEvaluated"]) ?? "",
      entriesOpened: finiteNumber(result.summary?.["entriesOpened"]) ?? "",
      exitsClosed: finiteNumber(result.summary?.["exitsClosed"]) ?? "",
      exitReasons: jsonText(result.summary?.["exitReasons"] ?? {}),
      skippedReasons: jsonText(result.summary?.["skippedReasons"] ?? {}),
      durationMs: result.durationMs,
      error: result.error ?? "",
    };
  });
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
      status: "",
      eligible: "",
      ineligibleReason: "",
      description: "",
      profilePatch: "",
      realizedPnl: "",
      winRate: "",
      profitFactor: "",
      closedTrades: "",
      maxDrawdownAbs: "",
      openPositions: "",
      riskAdjustedScore: "",
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
  const markdown = [
    "# Signal Options Exit Policy Sweep",
    "",
    `- Deployment: ${markdownText(input.deployment.name)} (${markdownText(input.deployment.id)})`,
    `- Symbols: ${input.deployment.symbolUniverse.length}`,
    `- Window: ${markdownText(input.config.start)} through ${markdownText(input.config.end ?? "latest completed trading day")}`,
    `- Signal timeframe: ${markdownText(input.config.signalTimeframe)}`,
    `- Pyrus Signals patch: \`${markdownText(jsonText(buildPyrusSignalsSettingsPatch(input.config)))}\``,
    `- Risk caps: \`${markdownText(jsonText({ maxOpenSymbols: 10, maxPremiumPerEntry: input.config.maxPremiumPerEntry }))}\``,
    `- Premium-bucket variants: excluded`,
    `- Dry variants: ${input.results.length}`,
    `- Eligible variants: ${input.ranked.length}`,
    `- ${replayReportLine(input.replayResult)}`,
    "",
    "| Rank | Variant | PnL | Score | Trades | Win % | PF | Max DD | Open | Early | Early Recovered Entry | Early Final > Exit | Exit Reasons |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...input.ranked.map((result, index) => {
      const earlyStats = earlyInvalidationOutcomeStats(result.summary);
      return [
        index + 1,
        markdownText(result.variant.id),
        result.metrics.realizedPnl.toFixed(2),
        result.metrics.riskAdjustedScore.toFixed(6),
        result.metrics.closedTrades,
        (result.metrics.winRate * 100).toFixed(1),
        Number.isFinite(result.metrics.profitFactor)
          ? result.metrics.profitFactor.toFixed(3)
          : "Infinity",
        result.metrics.maxDrawdownAbs.toFixed(2),
        result.metrics.openPositions,
        earlyStats.earlyInvalidations,
        earlyStats.earlyRecoveredEntry,
        earlyStats.earlyFinalAboveExit,
        `\`${markdownText(jsonText(result.summary?.["exitReasons"] ?? {}))}\``,
      ].join(" | ");
    }),
    "",
    "| Variant | Wire Snapshots | Wire Active | Wire Breaks | Wire Exit | Greek Fresh | Greek Unavailable | Selected Rungs | Greek Fallbacks | Greek Adjustments |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...input.ranked.map((result) => {
      const wireStats = wireTrailOutcomeStats(result.summary);
      return [
        markdownText(result.variant.id),
        wireStats.wireTrailSnapshots,
        wireStats.wireTrailActive,
        wireStats.wireStructureBreaks,
        wireStats.wireStructureBreakExits,
        wireStats.wireGreekFresh,
        wireStats.wireGreekUnavailable,
        `\`${markdownText(jsonText(wireStats.wireSelectedRungs))}\``,
        `\`${markdownText(jsonText(wireStats.wireGreekFallbackReasons))}\``,
        `\`${markdownText(jsonText(wireStats.wireGreekAdjustmentReasons))}\``,
      ].join(" | ");
    }),
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
  if (result.status !== "succeeded") {
    return `Replay failed: ${markdownText(safeDiagnostic(result.error ?? "unknown error"))}`;
  }
  if (!result.eligible) {
    return `Replay completed but is no longer eligible: ${markdownText(result.variant.id)}`;
  }
  return `Replay committed: ${markdownText(result.variant.id)}`;
}

export function selectReplayVariant(
  ranked: readonly SweepResult[],
  requestedVariantId: string | null,
): SweepResult | null {
  if (!requestedVariantId) {
    return ranked[0] ?? null;
  }
  const selected = ranked.find(
    (result) => result.variant.id === requestedVariantId,
  );
  if (!selected) {
    throw new Error(
      `Replay variant ${requestedVariantId} is not an eligible ranked result.`,
    );
  }
  return selected;
}

function assertSweepCompletion(input: {
  results: SweepResult[];
  replayRequired?: boolean;
  replayResult?: SweepResult | null;
}): void {
  if (
    input.results.length === 0 ||
    input.results.every((result) => result.status === "failed")
  ) {
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
  parseSweepArgs();
  const config = readSweepConfig();
  const variants = selectVariants(buildVariantUniverse(), config).map(
    (variant) => resolveVariantForConfig(variant, config),
  );
  await assertReportDestinationAvailable(config.reportDir);
  enableHistoricalBarEvaluation();
  let releaseLock: (() => Promise<void>) | null = null;
  let failed = false;

  try {
    releaseLock = await acquireSignalOptionsWorkerLock(config.lockWaitMs);
    if (!releaseLock) {
      throw new Error("Signal-options worker advisory lock is already held.");
    }
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
    const results: SweepResult[] = [];
    console.log(
      jsonText({
        deployment: {
          id: deployment.id,
          name: deployment.name,
          symbolCount: deployment.symbolUniverse.length,
        },
        config,
        variants: variants.length,
        pyrusSignalsSettingsPatch: buildPyrusSignalsSettingsPatch(config),
        riskCaps: {
          maxOpenSymbols: 10,
          maxPremiumPerEntry: config.maxPremiumPerEntry,
        },
      }),
    );

    for (const variant of variants) {
      console.log(`dry-run ${variant.id}`);
      const result = await runVariant({ deployment, variant, config });
      results.push(result);
      console.log(
        jsonText({
          variant: variant.id,
          status: result.status,
          metrics: result.metrics,
          exitReasons: result.summary?.["exitReasons"] ?? {},
          error: result.error,
        }),
      );
    }

    const ranked = rankResults(results);
    let replayResult: SweepResult | null = null;
    let verification: JsonRecord | null = null;
    if (config.replayWinner) {
      let selectedReplay: SweepResult | null = null;
      try {
        selectedReplay = selectReplayVariant(ranked, config.replayVariant);
      } catch (error) {
        console.warn(safeDiagnostic(error));
      }
      if (selectedReplay) {
        console.log(`replay ${selectedReplay.variant.id}`);
        replayResult = await runVariant({
          deployment,
          variant: selectedReplay.variant,
          config,
          commit: true,
          replay: true,
        });
        if (replayResult.status === "succeeded") {
          verification = await verifyReplayLedger({
            deploymentId: deployment.id,
            window: replayResult.window,
          });
        }
      }
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
    });

    console.log(
      jsonText(
        {
          reportDir: config.reportDir,
          dryVariants: results.length,
          eligibleVariants: ranked.length,
          winner: ranked[0]?.variant.id ?? null,
          winnerMetrics: ranked[0]?.metrics ?? null,
          replayCommitted: replayResult?.status === "succeeded",
          replayVariant: replayResult?.variant.id ?? null,
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
    try {
      await closeDatabaseConnections();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0 && !failed) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to close exit-policy sweep database resources.",
      );
    }
    if (cleanupErrors.length > 0) {
      console.error(
        `Sweep cleanup also failed (${cleanupErrors.length} error(s)).`,
      );
    }
  }
}

export const __signalOptionsExitPolicySweepInternalsForTests = {
  assertReportDestinationAvailable,
  assertSweepCompletion,
  buildVariantUniverse,
  computeMetrics,
  csvValue,
  enableHistoricalBarEvaluation,
  jsonText,
  markdownJson,
  markdownText,
  parseSweepArgs,
  publishReportFiles,
  readSweepConfig,
  replayReportLine,
  resolveVariantForConfig,
  safeDiagnostic,
  selectVariants,
  validateSweepDeployment,
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
