#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const API_BASE_URL = (
  process.env.BACKTEST_API_BASE_URL ??
  process.env.API_BASE_URL ??
  "http://127.0.0.1:8080/api"
).replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL;
const FROM_DATE = process.env.BACKTEST_FROM_DATE ?? "2026-01-01";
const TO_DATE = process.env.BACKTEST_TO_DATE ?? "2026-05-08";

const PORTFOLIO_RULES = {
  initialCapital: 25000,
  positionSizePercent: 12,
  maxConcurrentPositions: 4,
  maxGrossExposurePercent: 100,
};
const EXECUTION_PROFILE = {
  commissionBps: 1,
  slippageBps: 3,
};
const OPTIMIZER_CONFIG = {
  randomCandidateBudget: 24,
  walkForwardTrainingMonths: 24,
  walkForwardTestMonths: 6,
  walkForwardStepMonths: 6,
};

function usage() {
  console.error(
    [
      "Usage: DATABASE_URL=postgres://... node scripts/run-options-contract-sweeps.mjs",
      "",
      "Optional env:",
      "  BACKTEST_API_BASE_URL=http://127.0.0.1:8080/api",
      "  BACKTEST_FROM_DATE=2026-01-01",
      "  BACKTEST_TO_DATE=2026-05-08",
    ].join("\n"),
  );
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${text}`,
    );
  }
  return body;
}

function readSignalOptionsDeployment() {
  if (!DATABASE_URL) {
    usage();
    throw new Error("DATABASE_URL is required");
  }

  const sql = `
    select json_build_object(
      'id', id,
      'name', name,
      'symbolUniverse', symbol_universe,
      'config', config
    )::text
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
    limit 1;
  `;

  const stdout = execFileSync(
    "psql",
    [DATABASE_URL, "--tuples-only", "--no-align", "--quiet", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();

  if (!stdout) {
    throw new Error(
      "No enabled shadow signal-options deployment found in algo_deployments",
    );
  }

  const deployment = JSON.parse(stdout);
  if (
    !Array.isArray(deployment.symbolUniverse) ||
    deployment.symbolUniverse.length === 0
  ) {
    throw new Error(`Deployment ${deployment.id} has an empty symbol universe`);
  }

  return deployment;
}

function studyBody({ name, symbols, parameters }) {
  return {
    name,
    strategyId: "ray_replica_signals",
    strategyVersion: "v1",
    directionMode: "long_only",
    watchlistId: null,
    symbols,
    timeframe: "5m",
    startsAt: `${FROM_DATE}T00:00:00.000Z`,
    endsAt: `${TO_DATE}T23:59:59.999Z`,
    parameters,
    portfolioRules: PORTFOLIO_RULES,
    executionProfile: EXECUTION_PROFILE,
    optimizerMode: "grid",
    optimizerConfig: OPTIMIZER_CONFIG,
  };
}

async function createStudyAndSweep({ name, symbols, parameters, dimensions }) {
  const study = await request("/backtests/studies", {
    method: "POST",
    body: JSON.stringify(studyBody({ name, symbols, parameters })),
  });
  const sweep = await request("/backtests/sweeps", {
    method: "POST",
    body: JSON.stringify({
      studyId: study.id,
      mode: "grid",
      baseParameters: parameters,
      dimensions,
      randomCandidateBudget: null,
      walkForwardTrainingMonths: null,
      walkForwardTestMonths: null,
      walkForwardStepMonths: null,
    }),
  });

  return { study, sweep };
}

async function main() {
  const deployment = readSignalOptionsDeployment();
  const symbols = deployment.symbolUniverse;

  const presetStudy = await createStudyAndSweep({
    name: `RayReplica Options Preset YTD 5m ${FROM_DATE}..${TO_DATE}`,
    symbols,
    parameters: {
      executionMode: "options",
      contractPresetId: "atm_weekly",
      timeHorizon: 10,
    },
    dimensions: [
      {
        key: "contractPresetId",
        values: [
          "atm_weekly",
          "delta_30_proxy",
          "delta_60_proxy",
          "lotto_0dte",
          "signal_options_1_3d",
        ],
      },
    ],
  });

  const signalOptionsStudy = await createStudyAndSweep({
    name: `RayReplica Signal Options DTE Strike Grid YTD 5m ${FROM_DATE}..${TO_DATE}`,
    symbols,
    parameters: {
      executionMode: "signal_options",
      timeHorizon: 10,
      signalOptionsMinDte: 1,
      signalOptionsTargetDte: 1,
      signalOptionsMaxDte: 14,
      signalOptionsCallStrikeSlot: 3,
      signalOptionsPutStrikeSlot: 2,
      signalOptionsMaxPremium: 500,
      signalOptionsMaxContracts: 3,
      signalOptionsMaxOpenSymbols: 5,
      signalOptionsMaxDailyLoss: 1000,
      signalOptionsMaxSpreadPct: 35,
    },
    dimensions: [
      { key: "signalOptionsTargetDte", values: [1, 2, 3, 5, 7] },
      { key: "signalOptionsCallStrikeSlot", values: [2, 3, 4] },
      { key: "signalOptionsPutStrikeSlot", values: [1, 2, 3] },
    ],
  });

  console.log(
    JSON.stringify(
      {
        deployment: {
          id: deployment.id,
          name: deployment.name,
          symbolCount: symbols.length,
        },
        range: { from: FROM_DATE, to: TO_DATE },
        studies: [
          {
            id: presetStudy.study.id,
            name: presetStudy.study.name,
            sweepId: presetStudy.sweep.id,
            candidates: presetStudy.sweep.candidateTargetCount,
          },
          {
            id: signalOptionsStudy.study.id,
            name: signalOptionsStudy.study.name,
            sweepId: signalOptionsStudy.sweep.id,
            candidates: signalOptionsStudy.sweep.candidateTargetCount,
          },
        ],
        workerCommand:
          "DATABASE_URL=postgres://... BACKTEST_API_BASE_URL=http://127.0.0.1:8080/api pnpm --filter @workspace/backtest-worker run dev",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
