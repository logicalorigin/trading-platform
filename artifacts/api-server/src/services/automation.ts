import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { assertAlgoGatewayReady } from "./algo-gateway";
import { normalizeAlgoDeploymentProviderAccountId } from "./algo-deployment-account";
import {
  getSignalMonitorProfile,
  updateSignalMonitorProfile,
} from "./signal-monitor";

type CreateAlgoDeploymentInput = {
  strategyId: string;
  name: string;
  providerAccountId: string;
  mode: "paper" | "live";
  symbolUniverse?: string[];
  config?: Record<string, unknown>;
};

type ListAlgoDeploymentsInput = {
  mode?: "paper" | "live";
};

type ListExecutionEventsInput = {
  deploymentId?: string;
  limit?: number;
};

const STRATEGY_SIGNAL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function getStrategyOrThrow(strategyId: string) {
  const [strategy] = await db
    .select()
    .from(algoStrategiesTable)
    .where(eq(algoStrategiesTable.id, strategyId))
    .limit(1);

  if (!strategy) {
    throw new HttpError(404, "Algorithm strategy not found.", {
      code: "algo_strategy_not_found",
    });
  }

  return strategy;
}

async function getDeploymentOrThrow(deploymentId: string) {
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);

  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }

  return deployment;
}

function readTimeHorizon(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "Invalid time horizon.", {
      code: "algo_strategy_time_horizon_invalid",
      detail: "timeHorizon must be a number from 2 through 50.",
      expose: true,
    });
  }
  const horizon = Math.round(parsed);
  if (horizon < 2 || horizon > 50) {
    throw new HttpError(400, "Invalid time horizon.", {
      code: "algo_strategy_time_horizon_invalid",
      detail: "timeHorizon must be a number from 2 through 50.",
      expose: true,
    });
  }
  return horizon;
}

function readSignalTimeframe(value: unknown): string {
  const timeframe = String(value || "").trim();
  if (!STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe as never)) {
    throw new HttpError(400, "Unsupported signal timeframe.", {
      code: "algo_strategy_timeframe_invalid",
      detail: `Use one of ${STRATEGY_SIGNAL_TIMEFRAMES.join(", ")}.`,
      expose: true,
    });
  }
  return timeframe;
}

function deploymentToResponse(
  deployment: typeof algoDeploymentsTable.$inferSelect,
) {
  return {
    id: deployment.id,
    strategyId: deployment.strategyId,
    name: deployment.name,
    mode: deployment.mode,
    enabled: deployment.enabled,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    config: deployment.config,
    lastEvaluatedAt: deployment.lastEvaluatedAt ?? null,
    lastSignalAt: deployment.lastSignalAt ?? null,
    lastError: deployment.lastError ?? null,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
  };
}

function executionEventToResponse(
  event: typeof executionEventsTable.$inferSelect,
) {
  return {
    id: event.id,
    deploymentId: event.deploymentId ?? null,
    algoRunId: event.algoRunId ?? null,
    providerAccountId: event.providerAccountId ?? null,
    symbol: event.symbol ?? null,
    eventType: event.eventType,
    summary: event.summary,
    payload: event.payload,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export async function listAlgoDeployments(input: ListAlgoDeploymentsInput) {
  const rows = await db
    .select()
    .from(algoDeploymentsTable)
    .where(
      input.mode
        ? eq(algoDeploymentsTable.mode, input.mode)
        : undefined,
    )
    .orderBy(desc(algoDeploymentsTable.updatedAt));

  return {
    deployments: rows.map(deploymentToResponse),
  };
}

export async function createAlgoDeployment(input: CreateAlgoDeploymentInput) {
  const strategy = await getStrategyOrThrow(input.strategyId);
  const config = {
    ...(strategy.config as Record<string, unknown>),
    ...(input.config ?? {}),
  };
  const providerAccountId = normalizeAlgoDeploymentProviderAccountId({
    providerAccountId: input.providerAccountId,
    config,
  });

  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      strategyId: strategy.id,
      name: input.name,
      mode: input.mode,
      enabled: false,
      providerAccountId,
      symbolUniverse:
        input.symbolUniverse && input.symbolUniverse.length > 0
          ? input.symbolUniverse
          : strategy.symbolUniverse,
      config,
    })
    .returning();

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: "deployment_created",
    summary: `Created deployment ${deployment.name}`,
    payload: {
      strategyId: deployment.strategyId,
      mode: deployment.mode,
      symbolUniverse: deployment.symbolUniverse,
      requestedProviderAccountId: input.providerAccountId,
      providerAccountNormalized: providerAccountId !== input.providerAccountId,
    },
  });

  return deploymentToResponse(deployment);
}

export async function setAlgoDeploymentEnabled(input: {
  deploymentId: string;
  enabled: boolean;
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);

  if (input.enabled) {
    await assertAlgoGatewayReady();
  }
  const providerAccountId = input.enabled
    ? normalizeAlgoDeploymentProviderAccountId({
        providerAccountId: existing.providerAccountId,
        config: existing.config,
      })
    : existing.providerAccountId;

  const [deployment] = await db
    .update(algoDeploymentsTable)
    .set({
      enabled: input.enabled,
      providerAccountId,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
    .returning();

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: input.enabled ? "deployment_enabled" : "deployment_paused",
    summary: input.enabled
      ? `Enabled deployment ${deployment.name}`
      : `Paused deployment ${deployment.name}`,
    payload: {
      enabled: input.enabled,
      previousProviderAccountId: existing.providerAccountId,
      providerAccountNormalized: providerAccountId !== existing.providerAccountId,
    },
  });

  return deploymentToResponse(deployment);
}

export async function updateAlgoDeploymentStrategySettings(input: {
  deploymentId: string;
  timeHorizon: unknown;
  signalTimeframe: unknown;
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);
  const timeHorizon = readTimeHorizon(input.timeHorizon);
  const signalTimeframe = readSignalTimeframe(input.signalTimeframe);
  const config = asRecord(existing.config);
  const parameters = asRecord(config.parameters);
  const nextConfig = {
    ...config,
    parameters: {
      ...parameters,
      timeHorizon,
      signalTimeframe,
    },
  };
  const profile = await getSignalMonitorProfile({
    environment: existing.mode,
  });
  const nextRayReplicaSettings = {
    ...asRecord(profile.rayReplicaSettings),
    timeHorizon,
  };

  const [updated] = await db
    .update(algoDeploymentsTable)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
    .returning();

  const signalMonitorProfile = await updateSignalMonitorProfile({
    environment: existing.mode,
    timeframe: signalTimeframe,
    rayReplicaSettings: nextRayReplicaSettings,
  });
  const deployment = updated ?? existing;

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: "deployment_strategy_settings_updated",
    summary: `Updated strategy signal settings for ${deployment.name}`,
    payload: {
      timeHorizon,
      signalTimeframe,
      previousParameters: parameters,
      signalMonitorProfileId: signalMonitorProfile.id,
    },
  });

  return {
    deployment: deploymentToResponse(deployment),
    signalMonitorProfile,
  };
}

export async function listExecutionEvents(input: ListExecutionEventsInput) {
  const rows = await db
    .select()
    .from(executionEventsTable)
    .where(
      input.deploymentId
        ? and(eq(executionEventsTable.deploymentId, input.deploymentId))
        : undefined,
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));

  return {
    events: rows.map(executionEventToResponse),
  };
}
