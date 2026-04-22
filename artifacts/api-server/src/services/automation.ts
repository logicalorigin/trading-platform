import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { HttpError } from "../lib/errors";

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

  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      strategyId: strategy.id,
      name: input.name,
      mode: input.mode,
      enabled: false,
      providerAccountId: input.providerAccountId,
      symbolUniverse:
        input.symbolUniverse && input.symbolUniverse.length > 0
          ? input.symbolUniverse
          : strategy.symbolUniverse,
      config: {
        ...(strategy.config as Record<string, unknown>),
        ...(input.config ?? {}),
      },
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
    },
  });

  return deploymentToResponse(deployment);
}

export async function setAlgoDeploymentEnabled(input: {
  deploymentId: string;
  enabled: boolean;
}) {
  const [deployment] = await db
    .update(algoDeploymentsTable)
    .set({
      enabled: input.enabled,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
    .returning();

  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: input.enabled ? "deployment_enabled" : "deployment_paused",
    summary: input.enabled
      ? `Enabled deployment ${deployment.name}`
      : `Paused deployment ${deployment.name}`,
    payload: {
      enabled: input.enabled,
    },
  });

  return deploymentToResponse(deployment);
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
