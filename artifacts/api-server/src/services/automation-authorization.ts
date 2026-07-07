import {
  algoDeploymentsTable,
  brokerAccountsTable,
  db,
  shadowAccountsTable,
} from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import type { AuthenticatedSession } from "./auth";
import { recordAuditEvent } from "./audit-events";

type DeploymentListResponse = {
  deployments: Array<{ id: string }>;
  pnlByDeployment?: Record<string, unknown>;
};

type ExecutionEventsResponse = {
  events: Array<{ deploymentId: string | null }>;
};

function isAdmin(session: AuthenticatedSession): boolean {
  return session.user.role === "admin";
}

async function selectReadableDeploymentIds(
  session: AuthenticatedSession,
  deploymentIds: string[],
): Promise<Set<string>> {
  if (isAdmin(session) || deploymentIds.length === 0) {
    return new Set(deploymentIds);
  }

  const rows = await db
    .select({ id: algoDeploymentsTable.id })
    .from(algoDeploymentsTable)
    .leftJoin(
      brokerAccountsTable,
      eq(algoDeploymentsTable.providerAccountId, brokerAccountsTable.providerAccountId),
    )
    .leftJoin(
      shadowAccountsTable,
      eq(algoDeploymentsTable.providerAccountId, shadowAccountsTable.id),
    )
    .where(
      and(
        inArray(algoDeploymentsTable.id, deploymentIds),
        or(
          eq(brokerAccountsTable.appUserId, session.user.id),
          eq(shadowAccountsTable.appUserId, session.user.id),
        ),
      ),
    );

  return new Set(rows.map((row) => row.id));
}

async function recordCrossUserDeploymentDenied(
  session: AuthenticatedSession,
  deploymentId: string,
): Promise<void> {
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "entitlement.denied",
    resource: { type: "algo_deployment", id: deploymentId },
    payload: { reason: "cross_user_algo_deployment_read" },
  });
}

export async function assertCanReadAlgoDeployment(
  session: AuthenticatedSession,
  deploymentId: string,
): Promise<void> {
  if (isAdmin(session)) {
    return;
  }

  const [deployment] = await db
    .select({ id: algoDeploymentsTable.id })
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);

  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }

  const readableIds = await selectReadableDeploymentIds(session, [deploymentId]);
  if (!readableIds.has(deploymentId)) {
    await recordCrossUserDeploymentDenied(session, deploymentId);
    throw new HttpError(403, "Algorithm deployment access denied.", {
      code: "algo_deployment_forbidden",
    });
  }
}

export async function filterAlgoDeploymentListForSession<
  T extends DeploymentListResponse,
>(session: AuthenticatedSession, response: T): Promise<T> {
  if (isAdmin(session)) {
    return response;
  }

  const deploymentIds = response.deployments.map((deployment) => deployment.id);
  const readableIds = await selectReadableDeploymentIds(session, deploymentIds);
  const deployments = response.deployments.filter((deployment) =>
    readableIds.has(deployment.id),
  );
  const pnlByDeployment = response.pnlByDeployment
    ? Object.fromEntries(
        Object.entries(response.pnlByDeployment).filter(([deploymentId]) =>
          readableIds.has(deploymentId),
        ),
      )
    : undefined;

  return {
    ...response,
    deployments,
    ...(pnlByDeployment ? { pnlByDeployment } : {}),
  };
}

export async function filterExecutionEventsForSession<
  T extends ExecutionEventsResponse,
>(session: AuthenticatedSession, response: T): Promise<T> {
  if (isAdmin(session)) {
    return response;
  }

  const deploymentIds = [
    ...new Set(
      response.events
        .map((event) => event.deploymentId)
        .filter((deploymentId): deploymentId is string => Boolean(deploymentId)),
    ),
  ];
  const readableIds = await selectReadableDeploymentIds(session, deploymentIds);

  return {
    ...response,
    events: response.events.filter(
      (event) => event.deploymentId && readableIds.has(event.deploymentId),
    ),
  };
}

export async function firstReadableAlgoDeploymentId(
  session: AuthenticatedSession,
  deploymentIds: string[],
): Promise<string | null> {
  const readableIds = await selectReadableDeploymentIds(session, deploymentIds);
  return deploymentIds.find((deploymentId) => readableIds.has(deploymentId)) ?? null;
}
