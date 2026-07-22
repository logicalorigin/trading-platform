import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  sharedAdvisoryLockHolder,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  manageSignalOptionsLiveTargetPosition,
  type SignalOptionsLiveTargetPositionContext,
} from "./signal-options-live-target-exit";

const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 100;
const POSITION_INTERVAL_MS = 5_000;
const POSITION_ADVISORY_LOCK_KEY = 1_930_514_024;

export type SignalOptionsLiveTargetPositionWorkerDependencies = {
  listPositions?: (input: {
    limit: number;
  }) => Promise<SignalOptionsLiveTargetPositionContext[]>;
  managePosition?: typeof manageSignalOptionsLiveTargetPosition;
};

async function listLiveTargetPositions(input: {
  limit: number;
}): Promise<SignalOptionsLiveTargetPositionContext[]> {
  const rows = await db
    .select({
      position: algoTargetPositionsTable,
      deploymentOwnerId: algoDeploymentsTable.appUserId,
      deploymentConfig: algoDeploymentsTable.config,
      lifecycle: algoDeploymentTargetsTable.lifecycle,
      accountId: brokerAccountsTable.id,
      accountOwnerId: brokerAccountsTable.appUserId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      connectionOwnerId: brokerConnectionsTable.appUserId,
      provider: brokerConnectionsTable.brokerProvider,
    })
    .from(algoTargetPositionsTable)
    .innerJoin(
      algoDeploymentsTable,
      eq(algoDeploymentsTable.id, algoTargetPositionsTable.deploymentId),
    )
    .innerJoin(
      algoDeploymentTargetsTable,
      eq(algoDeploymentTargetsTable.id, algoTargetPositionsTable.targetId),
    )
    .innerJoin(
      brokerAccountsTable,
      eq(brokerAccountsTable.id, algoDeploymentTargetsTable.brokerAccountId),
    )
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(algoTargetPositionsTable.status, "open"),
        eq(algoDeploymentsTable.mode, "live"),
        eq(algoDeploymentsTable.isDraft, false),
        isNull(algoDeploymentsTable.archivedAt),
        inArray(algoDeploymentTargetsTable.lifecycle, ["active", "draining"]),
        eq(brokerAccountsTable.mode, "live"),
        eq(brokerConnectionsTable.connectionType, "broker"),
        eq(brokerConnectionsTable.status, "connected"),
        eq(brokerConnectionsTable.brokerProvider, "robinhood"),
      ),
    )
    .orderBy(asc(algoTargetPositionsTable.openedAt))
    .limit(input.limit);

  return rows.flatMap((row) => {
    const contract = row.position.contractSnapshot;
    const expiration = contract["expiration"];
    if (
      !row.deploymentOwnerId ||
      row.position.appUserId !== row.deploymentOwnerId ||
      row.accountOwnerId !== row.deploymentOwnerId ||
      row.connectionOwnerId !== row.deploymentOwnerId ||
      row.provider !== "robinhood" ||
      row.position.status !== "open" ||
      typeof expiration !== "string" ||
      !expiration.trim()
    ) {
      return [];
    }
    return [
      {
        appUserId: row.deploymentOwnerId,
        deploymentId: row.position.deploymentId,
        targetId: row.position.targetId,
        accountId: row.accountId,
        providerAccountId: row.providerAccountId,
        provider: "robinhood" as const,
        symbol: row.position.symbol,
        deploymentConfig: row.deploymentConfig,
        position: {
          id: row.position.id,
          appUserId: row.position.appUserId,
          deploymentId: row.position.deploymentId,
          targetId: row.position.targetId,
          strategyPositionKey: row.position.strategyPositionKey,
          symbol: row.position.symbol,
          status: "open" as const,
          quantity: row.position.quantity,
          premiumBasis: row.position.premiumBasis,
          providerPositionId: row.position.providerPositionId,
          expiration,
          contractSnapshot: row.position.contractSnapshot,
          managementState: row.position.managementState,
        },
      },
    ];
  });
}

function managementFailure(error: unknown) {
  return {
    code:
      error instanceof HttpError && error.code
        ? error.code
        : "algo_target_position_management_failed",
    message:
      error instanceof HttpError && error.expose
        ? error.message
        : "The live target position could not be managed.",
  };
}

export async function runSignalOptionsLiveTargetPositionBatch(
  input: { limit?: number } = {},
  dependencies: SignalOptionsLiveTargetPositionWorkerDependencies = {},
) {
  const requestedLimit = Number(input.limit ?? DEFAULT_BATCH_LIMIT);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(MAX_BATCH_LIMIT, Math.max(1, requestedLimit))
    : DEFAULT_BATCH_LIMIT;
  const positions = await (
    dependencies.listPositions ?? listLiveTargetPositions
  )({ limit });
  const manage = dependencies.managePosition ?? manageSignalOptionsLiveTargetPosition;
  const results = [];

  for (const context of positions) {
    try {
      const managed = await manage(context);
      results.push({
        positionId: context.position.id,
        status: managed.status,
        code: null,
        message: null,
      });
    } catch (error) {
      results.push({
        positionId: context.position.id,
        status: "failed" as const,
        ...managementFailure(error),
      });
    }
  }

  return {
    attempted: results.length,
    managed: results.filter((result) => result.status !== "failed").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runScheduledPositionManagement() {
  let lease: Awaited<ReturnType<typeof sharedAdvisoryLockHolder.acquire>> = null;
  try {
    lease = await sharedAdvisoryLockHolder.acquire(POSITION_ADVISORY_LOCK_KEY);
    if (lease) {
      const result = await runSignalOptionsLiveTargetPositionBatch();
      if (result.failed > 0) {
        logger.warn(
          { attempted: result.attempted, failed: result.failed },
          "Signal Options live target position management completed with failures",
        );
      }
    }
  } catch (error) {
    logger.warn(
      { err: error },
      "Signal Options live target position management failed",
    );
  } finally {
    if (lease) await lease().catch(() => {});
    if (started) {
      timer = setTimeout(
        () => void runScheduledPositionManagement(),
        POSITION_INTERVAL_MS,
      );
      timer.unref?.();
    }
  }
}

export function startSignalOptionsLiveTargetPositionWorker(): void {
  if (started) return;
  started = true;
  void runScheduledPositionManagement();
}

export function stopSignalOptionsLiveTargetPositionWorker(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
