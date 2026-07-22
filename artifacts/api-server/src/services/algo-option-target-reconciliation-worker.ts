import {
  algoDeploymentTargetsTable,
  algoTargetExecutionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  sharedAdvisoryLockHolder,
} from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  isAlgoOptionBrokerProvider,
  type AlgoOptionBrokerProvider,
} from "./algo-option-broker-adapter";
import { createDefaultAlgoOptionBrokerDispatcher } from "./algo-option-provider-dispatcher";

const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 100;
const RECONCILIATION_INTERVAL_MS = 5_000;
const RECONCILIATION_ADVISORY_LOCK_KEY = 1_930_514_023;

export type AlgoOptionTargetReconciliationWork = {
  executionId: string;
  appUserId: string;
  deploymentId: string;
  targetId: string;
  accountId: string;
  provider: AlgoOptionBrokerProvider;
  action: "entry" | "exit";
};

type ReconcileInput = AlgoOptionTargetReconciliationWork;

export type AlgoOptionTargetReconciliationDependencies = {
  listExecutions?: (input: {
    limit: number;
  }) => Promise<AlgoOptionTargetReconciliationWork[]>;
  reconcile?: (input: ReconcileInput) => Promise<{ state: string }>;
};

async function listReconciliationWork(input: {
  limit: number;
}): Promise<AlgoOptionTargetReconciliationWork[]> {
  const rows = await db
    .select({
      executionId: algoTargetExecutionsTable.id,
      appUserId: algoTargetExecutionsTable.appUserId,
      deploymentId: algoTargetExecutionsTable.deploymentId,
      targetId: algoTargetExecutionsTable.targetId,
      accountId: brokerAccountsTable.id,
      provider: brokerConnectionsTable.brokerProvider,
      action: algoTargetExecutionsTable.action,
    })
    .from(algoTargetExecutionsTable)
    .innerJoin(
      algoDeploymentTargetsTable,
      eq(algoDeploymentTargetsTable.id, algoTargetExecutionsTable.targetId),
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
      inArray(algoTargetExecutionsTable.status, [
        "submitted",
        "reconciliation_required",
      ]),
    )
    .orderBy(asc(algoTargetExecutionsTable.occurredAt))
    .limit(input.limit);

  return rows.flatMap((row) =>
    row.provider && isAlgoOptionBrokerProvider(row.provider)
      ? [{ ...row, provider: row.provider }]
      : [],
  );
}

function reconciliationFailure(error: unknown) {
  return {
    code:
      error instanceof HttpError && error.code
        ? error.code
        : "algo_target_reconciliation_failed",
    message:
      error instanceof HttpError && error.expose
        ? error.message
        : "The target execution could not be reconciled.",
  };
}

export async function runAlgoOptionTargetReconciliationBatch(
  input: { limit?: number } = {},
  dependencies: AlgoOptionTargetReconciliationDependencies = {},
) {
  const requestedLimit = Number(input.limit ?? DEFAULT_BATCH_LIMIT);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(MAX_BATCH_LIMIT, Math.max(1, requestedLimit))
    : DEFAULT_BATCH_LIMIT;
  const work = await (dependencies.listExecutions ?? listReconciliationWork)({
    limit,
  });
  const dispatcher = createDefaultAlgoOptionBrokerDispatcher();
  const reconcile =
    dependencies.reconcile ?? ((item: ReconcileInput) => dispatcher.reconcile(item));
  const results = [];

  for (const item of work) {
    try {
      const reconciliation = await reconcile(item);
      results.push({
        executionId: item.executionId,
        provider: item.provider,
        status: reconciliation.state,
        code: null,
        message: null,
      });
    } catch (error) {
      results.push({
        executionId: item.executionId,
        provider: item.provider,
        status: "failed" as const,
        ...reconciliationFailure(error),
      });
    }
  }

  return {
    attempted: results.length,
    reconciled: results.filter((result) => result.status !== "failed").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runScheduledReconciliation() {
  let lease: Awaited<ReturnType<typeof sharedAdvisoryLockHolder.acquire>> = null;
  try {
    lease = await sharedAdvisoryLockHolder.acquire(
      RECONCILIATION_ADVISORY_LOCK_KEY,
    );
    if (lease) {
      const result = await runAlgoOptionTargetReconciliationBatch();
      if (result.failed > 0) {
        logger.warn(
          { attempted: result.attempted, failed: result.failed },
          "Algo option target reconciliation completed with failures",
        );
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "Algo option target reconciliation failed");
  } finally {
    if (lease) await lease().catch(() => {});
    if (started) {
      timer = setTimeout(
        () => void runScheduledReconciliation(),
        RECONCILIATION_INTERVAL_MS,
      );
      timer.unref?.();
    }
  }
}

export function startAlgoOptionTargetReconciliationWorker(): void {
  if (started) return;
  started = true;
  void runScheduledReconciliation();
}

export function stopAlgoOptionTargetReconciliationWorker(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
