import { and, eq, inArray, sql } from "drizzle-orm";

import { brokerOrderMutationsTable, db } from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

export type SnapTradeOrderMutationOperation = "submit" | "replace" | "cancel";

export type SnapTradeOrderMutationClaim = {
  id: string;
};

const UNRESOLVED_STATUSES = [
  "inflight",
  "reconciliation_required",
] as const;

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const boundedReason = (value: unknown, fallback: string): string =>
  String(value || "").trim().slice(0, 128) || fallback;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readString = (
  record: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value) return value;
  }
  return null;
};

const reconciliationRequiredError = (input: {
  accountId: string;
  operation: SnapTradeOrderMutationOperation;
  brokerOrderId: string | null;
  reason: string | null;
}): HttpError =>
  new HttpError(
    409,
    "A prior SnapTrade order action has an unknown outcome; reconcile before retrying",
    {
      code: "snaptrade_order_mutation_reconcile_required",
      expose: true,
      data: {
        provider: "snaptrade",
        accountId: input.accountId,
        operation: input.operation,
        orderId: input.brokerOrderId,
        status: "reconcile_required",
        outcome: "unknown",
        reason: input.reason || "prior_mutation_outcome_unknown",
        reconcileRequired: true,
        retryable: false,
      },
    },
  );

export async function beginSnapTradeOrderMutation(input: {
  appUserId: string;
  accountId: string;
  operation: SnapTradeOrderMutationOperation;
  brokerOrderId?: string | null;
  metadata?: Record<string, unknown>;
  now?: Date;
}): Promise<SnapTradeOrderMutationClaim> {
  const now = input.now ?? new Date();
  const brokerOrderId = input.brokerOrderId?.trim() || null;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`snaptrade-order-mutation:${input.appUserId}:${input.accountId}`}))`,
    );
    const [unresolved] = await tx
      .select({
        operation: brokerOrderMutationsTable.operation,
        brokerOrderId: brokerOrderMutationsTable.brokerOrderId,
        reason: brokerOrderMutationsTable.reason,
      })
      .from(brokerOrderMutationsTable)
      .where(
        and(
          eq(brokerOrderMutationsTable.appUserId, input.appUserId),
          eq(brokerOrderMutationsTable.accountId, input.accountId),
          eq(brokerOrderMutationsTable.provider, "snaptrade"),
          inArray(brokerOrderMutationsTable.status, UNRESOLVED_STATUSES),
        ),
      )
      .limit(1);
    if (unresolved) {
      throw reconciliationRequiredError({
        accountId: input.accountId,
        operation: unresolved.operation,
        brokerOrderId: unresolved.brokerOrderId,
        reason: unresolved.reason,
      });
    }

    const [created] = await tx
      .insert(brokerOrderMutationsTable)
      .values({
        appUserId: input.appUserId,
        accountId: input.accountId,
        provider: "snaptrade",
        operation: input.operation,
        status: "inflight",
        brokerOrderId,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: brokerOrderMutationsTable.id });
    if (!created) {
      throw new Error("SnapTrade order mutation journal claim was not created");
    }
    return created;
  });
}

async function settleSnapTradeOrderMutation(input: {
  appUserId: string;
  claim: SnapTradeOrderMutationClaim;
  status: "succeeded" | "rejected" | "reconciliation_required";
  brokerOrderId?: string | null;
  reason?: string | null;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const [updated] = await db
    .update(brokerOrderMutationsTable)
    .set({
      status: input.status,
      brokerOrderId: input.brokerOrderId?.trim() || null,
      reason:
        input.status === "succeeded"
          ? null
          : boundedReason(
              input.reason,
              input.status === "rejected"
                ? "provider_rejected"
                : "broker_outcome_unknown",
            ),
      resolvedAt: input.status === "reconciliation_required" ? null : now,
      updatedAt: now,
    })
    .where(
      and(
        eq(brokerOrderMutationsTable.id, input.claim.id),
        eq(brokerOrderMutationsTable.appUserId, input.appUserId),
        eq(brokerOrderMutationsTable.status, "inflight"),
      ),
    )
    .returning({ id: brokerOrderMutationsTable.id });
  if (!updated) {
    throw new Error("SnapTrade order mutation journal state changed unexpectedly");
  }
}

export async function completeSnapTradeOrderMutation(input: {
  appUserId: string;
  claim: SnapTradeOrderMutationClaim;
  brokerOrderId?: string | null;
  now?: Date;
}): Promise<void> {
  await settleSnapTradeOrderMutation({ ...input, status: "succeeded" });
}

export async function rejectSnapTradeOrderMutation(input: {
  appUserId: string;
  claim: SnapTradeOrderMutationClaim;
  brokerOrderId?: string | null;
  reason?: string | null;
  now?: Date;
}): Promise<void> {
  await settleSnapTradeOrderMutation({ ...input, status: "rejected" });
}

export async function requireSnapTradeOrderMutationReconciliation(input: {
  appUserId: string;
  claim: SnapTradeOrderMutationClaim;
  brokerOrderId?: string | null;
  reason: string;
  now?: Date;
}): Promise<void> {
  await settleSnapTradeOrderMutation({
    ...input,
    status: "reconciliation_required",
  });
}

export async function recordSnapTradeOrderMutationOutcome(input: {
  appUserId: string;
  accountId: string;
  operation: SnapTradeOrderMutationOperation;
  claim: SnapTradeOrderMutationClaim;
  outcome: "succeeded" | "rejected" | "reconciliation_required";
  brokerOrderId?: string | null;
  reason?: string | null;
  now?: Date;
}): Promise<boolean> {
  try {
    if (input.outcome === "succeeded") {
      await completeSnapTradeOrderMutation(input);
    } else if (input.outcome === "rejected") {
      await rejectSnapTradeOrderMutation(input);
    } else {
      await requireSnapTradeOrderMutationReconciliation({
        ...input,
        reason: boundedReason(input.reason, "broker_outcome_unknown"),
      });
    }
    return true;
  } catch (error) {
    logger.error(
      {
        err: error,
        appUserId: input.appUserId,
        accountId: input.accountId,
        operation: input.operation,
        outcome: input.outcome,
      },
      "SnapTrade mutation journal update failed; inflight fence retained",
    );
    return false;
  }
}

export function snapTradeMutationFailureRequiresReconciliation(input: {
  error: unknown;
  networkCode: string;
  failedCode: string;
}): "network_error" | "upstream_response_unknown" | null {
  if (!(input.error instanceof HttpError)) return null;
  if (input.error.code === input.networkCode) return "network_error";
  if (input.error.code !== input.failedCode) return null;
  const status = Number(recordValue(input.error.data).status);
  const definiteClientRejection =
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 499 &&
    ![408, 409, 425, 429].includes(status);
  return definiteClientRejection ? null : "upstream_response_unknown";
}

export function parseSnapTradeCancelResponse(
  payload: unknown,
  expectedOrderId: string,
): { orderId: string; status: string } {
  const response = recordValue(payload);
  const orderId = readString(response, [
    "brokerage_order_id",
    "brokerageOrderId",
  ]);
  if (!orderId || orderId !== expectedOrderId) {
    throw new HttpError(502, "SnapTrade order cancel returned invalid data", {
      code: "snaptrade_order_cancel_invalid_response",
      expose: false,
    });
  }
  const rawResponse = recordValue(
    response["raw_response"] ?? response["rawResponse"],
  );
  return {
    orderId,
    status:
      readString(response, ["status", "state"]) ??
      readString(rawResponse, ["status", "state"]) ??
      "CANCEL_REQUESTED",
  };
}
