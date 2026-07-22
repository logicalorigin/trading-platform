import { createHash } from "node:crypto";

import {
  algoAccountControlsTable,
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  db,
  executionEventsTable,
  type AlgoTargetExecution,
} from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import {
  AlgoAllowancePolicyError,
  resolveAlgoAllowancePool,
} from "./algo-allowance-policy";

const SNAPSHOT_MAX_BYTES = 16_000;
const ACTION_IDENTITY_MAX_LENGTH = 128;
const UNRESOLVED_EXECUTION_STATUSES = [
  "pending",
  "reviewed",
  "submitted",
  "reconciliation_required",
] as const;
const OPEN_EXPOSURE_STATUSES = [
  "opening",
  "open",
  "closing",
  "manual_takeover",
  "attention",
] as const;

export type AlgoTargetEntryAdmission = {
  netLiquidation: number;
  buyingPower: number;
  observedAt: Date;
  maxCapitalAgeMs: number;
};

type ReserveAlgoTargetExecutionBase = {
  appUserId: string;
  deploymentId: string;
  targetId: string;
  sourceEventId: string;
  actionIdentity: string;
  contractSnapshot: Record<string, unknown>;
  orderSnapshot: Record<string, unknown>;
  requestedQuantity: number;
  occurredAt?: Date;
};

export type ReserveAlgoTargetExecutionInput =
  | (ReserveAlgoTargetExecutionBase & {
      action: "entry";
      premiumAtRisk: number;
      entryAdmission: AlgoTargetEntryAdmission;
    })
  | (ReserveAlgoTargetExecutionBase & {
      action: "exit";
      premiumAtRisk: null;
      entryAdmission?: never;
    });

export type AlgoTargetExecutionIdentityInput = Pick<
  ReserveAlgoTargetExecutionInput,
  | "appUserId"
  | "deploymentId"
  | "targetId"
  | "sourceEventId"
  | "action"
  | "actionIdentity"
>;

function invalidReservation(message: string): never {
  throw new HttpError(422, message, {
    code: "algo_target_execution_invalid",
    expose: true,
  });
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

function snapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidReservation("Target execution snapshots must be objects.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(canonicalJsonValue(value));
  } catch {
    return invalidReservation(
      "Target execution snapshots must be serializable.",
    );
  }
  if (
    !serialized ||
    Buffer.byteLength(serialized, "utf8") > SNAPSHOT_MAX_BYTES
  ) {
    return invalidReservation("Target execution snapshot is too large.");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function quantity(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return invalidReservation(
      "Target option quantity must be a whole contract.",
    );
  }
  return value.toFixed(6);
}

function premium(
  value: number | null,
  action: "entry" | "exit",
): string | null {
  if (value === null) {
    return action === "exit"
      ? null
      : invalidReservation("Entry premium at risk is required.");
  }
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (action === "entry" && value === 0)
  ) {
    return invalidReservation("Target premium at risk is invalid.");
  }
  const micros = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(micros)) {
    return invalidReservation("Target premium at risk is invalid.");
  }
  return (micros / 1_000_000).toFixed(6);
}

function occurrence(value: Date | undefined): Date {
  const occurredAt = value ?? new Date();
  return occurredAt instanceof Date && Number.isFinite(occurredAt.getTime())
    ? occurredAt
    : invalidReservation("Target execution time is invalid.");
}

function storedAmount(value: string | null): number {
  const amount = Number(value);
  if (value === null || !Number.isFinite(amount) || amount < 0) {
    throw new HttpError(409, "Current algo premium exposure is unavailable.", {
      code: "algo_premium_exposure_unknown",
      expose: true,
    });
  }
  return amount;
}

function outstandingReservation(input: {
  premiumAtRisk: string | null;
  requestedQuantity: string;
  filledQuantity: string;
}): number {
  const premiumAtRisk = storedAmount(input.premiumAtRisk);
  const requestedQuantity = Number(input.requestedQuantity);
  const filledQuantity = Number(input.filledQuantity);
  if (
    !Number.isFinite(requestedQuantity) ||
    requestedQuantity <= 0 ||
    !Number.isFinite(filledQuantity) ||
    filledQuantity < 0 ||
    filledQuantity > requestedQuantity
  ) {
    throw new HttpError(409, "Current algo premium reservation is unavailable.", {
      code: "algo_premium_reservation_unknown",
      expose: true,
    });
  }
  return premiumAtRisk * ((requestedQuantity - filledQuantity) / requestedQuantity);
}

function assertEntryCapacity(input: {
  targetAllowance: { unit: "usd" | "percent"; value: number };
  totalAlgoAllowance: { unit: "usd" | "percent"; value: number };
  targetPremiumAtRisk: number;
  targetPremiumReserved: number;
  accountPremiumAtRisk: number;
  accountPremiumReserved: number;
  requestedPremium: number;
  admission: AlgoTargetEntryAdmission;
  now: Date;
}): void {
  let pool;
  try {
    pool = resolveAlgoAllowancePool({
      targetAllowance: input.targetAllowance,
      totalAlgoAllowance: input.totalAlgoAllowance,
      targetExposureUsd: input.targetPremiumAtRisk,
      targetReservationUsd: input.targetPremiumReserved,
      accountExposureUsd: input.accountPremiumAtRisk,
      accountReservationUsd: input.accountPremiumReserved,
      netLiquidation: input.admission.netLiquidation,
      buyingPower: input.admission.buyingPower,
      capitalObservedAt: input.admission.observedAt,
      now: input.now,
      maxCapitalAgeMs: input.admission.maxCapitalAgeMs,
    });
  } catch (error) {
    if (error instanceof AlgoAllowancePolicyError) {
      throw new HttpError(409, error.message, {
        code:
          error.code === "algo_allowance_capital_stale"
            ? "algo_capital_base_stale"
            : error.code,
        expose: true,
      });
    }
    throw error;
  }
  const requestedMicros = BigInt(Math.round(input.requestedPremium * 1_000_000));
  const targetMicros = BigInt(Math.round(pool.target.remainingUsd * 1_000_000));
  const accountMicros = BigInt(Math.round(pool.account.remainingUsd * 1_000_000));
  if (requestedMicros > targetMicros || requestedMicros > accountMicros) {
    throw new HttpError(409, "No whole option contract fits the live caps.", {
      code: "algo_entry_cap_exhausted",
      expose: true,
      data: {
        targetPremiumRemaining: pool.target.remainingUsd,
        accountPremiumRemaining: pool.account.remainingUsd,
      },
    });
  }
}

export function buildAlgoTargetExecutionIdentity(
  input: AlgoTargetExecutionIdentityInput,
) {
  const actionIdentity = input.actionIdentity.trim();
  if (
    !actionIdentity ||
    actionIdentity.length > ACTION_IDENTITY_MAX_LENGTH ||
    !input.appUserId.trim() ||
    !input.deploymentId.trim() ||
    !input.targetId.trim() ||
    !input.sourceEventId.trim()
  ) {
    invalidReservation("Target execution identity is invalid.");
  }
  const digest = createHash("sha256")
    .update("pyrus:algo-target-execution:v1\0")
    .update(
      JSON.stringify([
        input.appUserId,
        input.deploymentId,
        input.targetId,
        input.sourceEventId,
        input.action,
        actionIdentity,
      ]),
    )
    .digest("hex");
  const variant = (
    (Number.parseInt(digest.slice(16, 17), 16) & 0b0011) |
    0b1000
  ).toString(16);
  return {
    executionKey: `algo-target:${input.action}:${digest}`,
    clientOrderId: [
      digest.slice(0, 8),
      digest.slice(8, 12),
      `8${digest.slice(13, 16)}`,
      `${variant}${digest.slice(17, 20)}`,
      digest.slice(20, 32),
    ].join("-"),
  };
}

function executionConflict(): never {
  throw new HttpError(
    409,
    "This target execution identity already has different order facts.",
    { code: "algo_target_execution_conflict", expose: true },
  );
}

function assertIdempotentMatch(
  row: AlgoTargetExecution,
  expected: {
    appUserId: string;
    deploymentId: string;
    targetId: string;
    sourceEventId: string;
    action: "entry" | "exit";
    clientOrderId: string;
    contractSnapshot: Record<string, unknown>;
    orderSnapshot: Record<string, unknown>;
    requestedQuantity: string;
    premiumAtRisk: string | null;
  },
): AlgoTargetExecution {
  if (
    row.appUserId !== expected.appUserId ||
    row.deploymentId !== expected.deploymentId ||
    row.targetId !== expected.targetId ||
    row.sourceEventId !== expected.sourceEventId ||
    row.action !== expected.action ||
    row.clientOrderId !== expected.clientOrderId ||
    Number(row.requestedQuantity) !== Number(expected.requestedQuantity) ||
    (row.premiumAtRisk === null) !== (expected.premiumAtRisk === null) ||
    (row.premiumAtRisk !== null &&
      Number(row.premiumAtRisk) !== Number(expected.premiumAtRisk)) ||
    JSON.stringify(canonicalJsonValue(row.contractSnapshot)) !==
      JSON.stringify(expected.contractSnapshot) ||
    JSON.stringify(canonicalJsonValue(row.orderSnapshot)) !==
      JSON.stringify(expected.orderSnapshot)
  ) {
    executionConflict();
  }
  return row;
}

export async function reserveAlgoTargetExecution(
  input: ReserveAlgoTargetExecutionInput,
): Promise<AlgoTargetExecution> {
  const identity = buildAlgoTargetExecutionIdentity(input);
  const contractSnapshot = snapshot(input.contractSnapshot);
  const orderSnapshot = snapshot(input.orderSnapshot);
  const requestedQuantity = quantity(input.requestedQuantity);
  const premiumAtRisk = premium(input.premiumAtRisk, input.action);
  const occurredAt = occurrence(input.occurredAt);
  const expected = {
    appUserId: input.appUserId,
    deploymentId: input.deploymentId,
    targetId: input.targetId,
    sourceEventId: input.sourceEventId,
    action: input.action,
    clientOrderId: identity.clientOrderId,
    contractSnapshot,
    orderSnapshot,
    requestedQuantity,
    premiumAtRisk,
  };

  return db.transaction(async (transaction) => {
    const [deployment] = await transaction
      .select({
        id: algoDeploymentsTable.id,
        appUserId: algoDeploymentsTable.appUserId,
        mode: algoDeploymentsTable.mode,
        enabled: algoDeploymentsTable.enabled,
        isDraft: algoDeploymentsTable.isDraft,
        archivedAt: algoDeploymentsTable.archivedAt,
      })
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.id, input.deploymentId))
      .limit(1)
      .for("update");
    if (!deployment) {
      throw new HttpError(404, "Algorithm deployment not found.", {
        code: "algo_deployment_not_found",
      });
    }
    if (deployment.appUserId !== input.appUserId) {
      throw new HttpError(403, "Algorithm deployment access denied.", {
        code: "algo_deployment_forbidden",
      });
    }
    if (
      input.action === "entry" &&
      (deployment.mode !== "live" ||
        !deployment.enabled ||
        deployment.isDraft ||
        deployment.archivedAt)
    ) {
      throw new HttpError(409, "The live deployment is not running.", {
        code: "algo_live_deployment_not_running",
        expose: true,
      });
    }

    const [target] = await transaction
      .select({
        deploymentId: algoDeploymentTargetsTable.deploymentId,
        brokerAccountId: algoDeploymentTargetsTable.brokerAccountId,
        lifecycle: algoDeploymentTargetsTable.lifecycle,
        executionEnabled: algoDeploymentTargetsTable.executionEnabled,
        allowanceUnit: algoDeploymentTargetsTable.allowanceUnit,
        allowanceValue: algoDeploymentTargetsTable.allowanceValue,
      })
      .from(algoDeploymentTargetsTable)
      .where(eq(algoDeploymentTargetsTable.id, input.targetId))
      .limit(1)
      .for("update");
    if (
      !target ||
      target.deploymentId !== input.deploymentId ||
      !target.brokerAccountId
    ) {
      throw new HttpError(404, "Algorithm broker target not found.", {
        code: "algo_target_not_found",
      });
    }
    const lifecycleAllowed =
      target.lifecycle === "active" ||
      (input.action === "exit" && target.lifecycle === "draining");
    if (!lifecycleAllowed) {
      throw new HttpError(409, "The target lifecycle blocks this action.", {
        code: "algo_target_lifecycle_blocked",
        expose: true,
      });
    }
    if (input.action === "entry" && !target.executionEnabled) {
      throw new HttpError(409, "This target is not enabled for execution.", {
        code: "algo_target_execution_disabled",
        expose: true,
      });
    }

    if (input.action === "entry") {
      const [account] = await transaction
        .select({
          id: brokerAccountsTable.id,
          appUserId: brokerAccountsTable.appUserId,
        })
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.id, target.brokerAccountId))
        .limit(1)
        .for("update");
      if (!account || account.appUserId !== input.appUserId) {
        throw new HttpError(403, "Algorithm broker target access denied.", {
          code: "algo_target_forbidden",
        });
      }
      const [unresolved] = await transaction
        .select({ id: algoTargetExecutionsTable.id })
        .from(algoTargetExecutionsTable)
        .innerJoin(
          algoDeploymentTargetsTable,
          eq(algoDeploymentTargetsTable.id, algoTargetExecutionsTable.targetId),
        )
        .where(
          and(
            eq(
              algoDeploymentTargetsTable.brokerAccountId,
              target.brokerAccountId,
            ),
            inArray(
              algoTargetExecutionsTable.status,
              UNRESOLVED_EXECUTION_STATUSES,
            ),
            ne(algoTargetExecutionsTable.executionKey, identity.executionKey),
          ),
        )
        .limit(1);
      if (unresolved) {
        throw new HttpError(
          409,
          "A broker mutation or reconciliation is still unresolved.",
          { code: "algo_broker_mutation_unresolved", expose: true },
        );
      }

      const admission = input.entryAdmission;
      if (!admission) {
        invalidReservation("Entry admission capital is required.");
      }
      const [accountControl] = await transaction
        .select({
          appUserId: algoAccountControlsTable.appUserId,
          unit: algoAccountControlsTable.totalAlgoAllowanceUnit,
          value: algoAccountControlsTable.totalAlgoAllowanceValue,
        })
        .from(algoAccountControlsTable)
        .where(eq(algoAccountControlsTable.brokerAccountId, account.id))
        .limit(1)
        .for("update");
      if (!accountControl || accountControl.appUserId !== input.appUserId) {
        throw new HttpError(409, "A total algo allowance is required before live execution.", {
          code: "algo_account_total_allowance_required",
          expose: true,
        });
      }

      const [positions, reservations] = await Promise.all([
        transaction
          .select({
            targetId: algoTargetPositionsTable.targetId,
            premiumBasis: algoTargetPositionsTable.premiumBasis,
          })
          .from(algoTargetPositionsTable)
          .innerJoin(
            algoDeploymentTargetsTable,
            eq(algoDeploymentTargetsTable.id, algoTargetPositionsTable.targetId),
          )
          .where(
            and(
              eq(algoTargetPositionsTable.appUserId, input.appUserId),
              eq(algoDeploymentTargetsTable.brokerAccountId, account.id),
              inArray(algoTargetPositionsTable.status, OPEN_EXPOSURE_STATUSES),
            ),
          ),
        transaction
          .select({
            targetId: algoTargetExecutionsTable.targetId,
            premiumAtRisk: algoTargetExecutionsTable.premiumAtRisk,
            requestedQuantity: algoTargetExecutionsTable.requestedQuantity,
            filledQuantity: algoTargetExecutionsTable.filledQuantity,
          })
          .from(algoTargetExecutionsTable)
          .innerJoin(
            algoDeploymentTargetsTable,
            eq(algoDeploymentTargetsTable.id, algoTargetExecutionsTable.targetId),
          )
          .where(
            and(
              eq(algoTargetExecutionsTable.appUserId, input.appUserId),
              eq(algoTargetExecutionsTable.action, "entry"),
              eq(algoDeploymentTargetsTable.brokerAccountId, account.id),
              inArray(
                algoTargetExecutionsTable.status,
                UNRESOLVED_EXECUTION_STATUSES,
              ),
              ne(algoTargetExecutionsTable.executionKey, identity.executionKey),
            ),
          ),
      ]);
      let accountPremiumAtRisk = 0;
      let targetPremiumAtRisk = 0;
      for (const position of positions) {
        const amount = storedAmount(position.premiumBasis);
        accountPremiumAtRisk += amount;
        if (position.targetId === input.targetId) targetPremiumAtRisk += amount;
      }
      let accountPremiumReserved = 0;
      let targetPremiumReserved = 0;
      for (const reservation of reservations) {
        const amount = outstandingReservation(reservation);
        accountPremiumReserved += amount;
        if (reservation.targetId === input.targetId) {
          targetPremiumReserved += amount;
        }
      }
      assertEntryCapacity({
        targetAllowance: {
          unit: target.allowanceUnit,
          value: Number(target.allowanceValue),
        },
        totalAlgoAllowance: {
          unit: accountControl.unit,
          value: Number(accountControl.value),
        },
        targetPremiumAtRisk,
        targetPremiumReserved,
        accountPremiumAtRisk,
        accountPremiumReserved,
        requestedPremium: Number(premiumAtRisk),
        admission,
        now: occurredAt,
      });
    }

    const [sourceEvent] = await transaction
      .select({ deploymentId: executionEventsTable.deploymentId })
      .from(executionEventsTable)
      .where(eq(executionEventsTable.id, input.sourceEventId))
      .limit(1);
    if (!sourceEvent || sourceEvent.deploymentId !== input.deploymentId) {
      throw new HttpError(409, "The target source event is invalid.", {
        code: "algo_target_source_event_invalid",
        expose: true,
      });
    }

    if (input.action === "exit") {
      const [conflictingExit] = await transaction
        .select({ id: algoTargetExecutionsTable.id })
        .from(algoTargetExecutionsTable)
        .where(
          and(
            eq(algoTargetExecutionsTable.targetId, input.targetId),
            eq(algoTargetExecutionsTable.action, "exit"),
            inArray(
              algoTargetExecutionsTable.status,
              UNRESOLVED_EXECUTION_STATUSES,
            ),
            ne(algoTargetExecutionsTable.executionKey, identity.executionKey),
          ),
        )
        .limit(1);
      if (conflictingExit) {
        throw new HttpError(
          409,
          "Another target close or reconciliation is still unresolved.",
          { code: "algo_target_close_conflict", expose: true },
        );
      }
    }

    const [existing] = await transaction
      .select()
      .from(algoTargetExecutionsTable)
      .where(eq(algoTargetExecutionsTable.executionKey, identity.executionKey))
      .limit(1);
    if (existing) return assertIdempotentMatch(existing, expected);

    const [inserted] = await transaction
      .insert(algoTargetExecutionsTable)
      .values({
        ...expected,
        executionKey: identity.executionKey,
        status: "pending",
        filledQuantity: "0.000000",
        occurredAt,
      })
      .onConflictDoNothing({
        target: algoTargetExecutionsTable.executionKey,
      })
      .returning();
    if (inserted) return inserted;

    const [winner] = await transaction
      .select()
      .from(algoTargetExecutionsTable)
      .where(eq(algoTargetExecutionsTable.executionKey, identity.executionKey))
      .limit(1);
    return winner
      ? assertIdempotentMatch(winner, expected)
      : executionConflict();
  });
}
